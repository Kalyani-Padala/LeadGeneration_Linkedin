import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';

const TABS = ['CONFIG', 'LEADS'];

export default function Maps() {
  const {
    apifyKey,
    mapsRuns, activeMapsRunId, setActiveMapsRunId,
    addMapsRun, addLeadToMapsRun, completeMapsRun, deleteMapsRun,
    mapsSearches, setMapsSearches,
  } = useSettings();

  const [activeTab, setActiveTab] = useState('CONFIG');
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [logOpen, setLogOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [maxResults, setMaxResults] = useState(20);

  // Form state
  const [business, setBusiness] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const [selectedZips, setSelectedZips] = useState([]);
  const [resolvedZips, setResolvedZips] = useState([]);
  const [resolvedCountry, setResolvedCountry] = useState(null);
  const [loadingZips, setLoadingZips] = useState(false);
  const [manualZip, setManualZip] = useState('');

  // Active run
  const activeRun = mapsRuns.find(r => r.runId === activeMapsRunId)
    || mapsRuns[mapsRuns.length - 1];
  const leads = activeRun?.leads || [];
  const totalAllLeads = mapsRuns.reduce((s, r) => s + r.leads.length, 0);

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev.slice(-99), {
      time: new Date().toLocaleTimeString(),
      msg,
      type,
    }]);
  }

  async function loadZips() {
  if (!country.trim() || !city.trim()) return;
  setLoadingZips(true);
  setResolvedZips([]);
  setSelectedZips([]);
  setResolvedCountry(null);
  try {
    const countryRes = await fetch(`/api/maps/country-code?name=${encodeURIComponent(country.trim())}`);
    if (!countryRes.ok) return;
    const countryData = await countryRes.json();
    setResolvedCountry(countryData);
    const zipRes = await fetch(`/api/maps/zipcodes?city=${encodeURIComponent(city.trim())}&countryCode=${countryData.code}`);
    const zipData = await zipRes.json();
    setResolvedZips(zipData.zips || []);
    setSelectedZips([]);
  } catch { }
  finally { setLoadingZips(false); }
}

function addSearch() {
  if (!business.trim() || !resolvedCountry) return;
  // Manual ZIP wins over the suggested-chip selection. Empty = city-wide.
  const finalZips = manualZip.trim()
    ? [manualZip.trim()]
    : selectedZips;
  const newSearch = {
    id: Date.now(),
    business: business.trim(),
    country: resolvedCountry.name,
    countryCode: resolvedCountry.code,
    city: city.trim(),
    zips: finalZips,
    fallback: finalZips.length === 0,
  };
  setMapsSearches([...mapsSearches, newSearch]);
  setBusiness('');
  setCountry('');
  setCity('');
  setResolvedZips([]);
  setSelectedZips([]);
  setResolvedCountry(null);
  setManualZip('');
  setResolveError('');
}

  function removeSearch(id) {
    setMapsSearches(mapsSearches.filter(s => s.id !== id));
  }

  async function runScrape() {
    if (!apifyKey) {
      addLog('Apify API key missing — go to Settings', 'error');
      return;
    }
    if (!mapsSearches.length) {
      addLog('No searches configured — add some in CONFIG tab', 'error');
      return;
    }

    setStatus('running');
    setLogs([]);
    setActiveTab('LEADS');

    const newRunId = `maps_${Date.now()}`;
    addMapsRun(newRunId);

    try {
      addLog(`Starting scrape — ${mapsSearches.length} searches`, 'info');

      const res = await fetch('/api/maps/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searches: mapsSearches,
          apifyKey,
          maxResults,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        addLog(`Server error: ${err}`, 'error');
        setStatus('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.trim().split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;

          try {
            const payload = JSON.parse(data);
            if (event === 'start') addLog(`Scraping ${payload.total} searches...`, 'info');
            else if (event === 'progress') addLog(payload.message, 'info');
            else if (event === 'lead') {
              addLeadToMapsRun(newRunId, payload);
              addLog(`✓ ${payload.name} — ${payload.email || payload.phone}`, 'success');
            }
            else if (event === 'warning') addLog(`⚠ ${payload.message}`, 'warn');
            else if (event === 'complete') {
              setStatus('done');
              completeMapsRun(newRunId);
              addLog(payload.message, 'success');
            }
            else if (event === 'error') {
              setStatus('error');
              addLog(`Error: ${payload.message}`, 'error');
            }
          } catch { }
        }
      }
    } catch (err) {
      setStatus('error');
      addLog(`Connection error: ${err.message}`, 'error');
    }
  }

  async function downloadExcel() {
    if (!leads.length) return;
    setExporting(true);
    try {
      const res = await fetch('/api/export/maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads,
          filename: `maps_${new Date().toISOString().slice(0, 10)}`,
        }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maps_leads_${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addLog(`Export failed: ${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  const isRunning = status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ padding: '20px 40px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--surface)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>GOOGLE MAPS SCRAPER</div>
          <h1 style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-0.8px' }}>Maps</h1>

          {status === 'idle' && mapsRuns.length === 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'var(--surface2)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
              <span>○</span> Ready
            </div>
          )}
          {isRunning && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
              <span style={{ animation: 'pulse 1s infinite' }}>●</span> Scraping Google Maps...
            </div>
          )}
          {status === 'done' && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
              <span>✓</span> Complete — {leads.length} leads
            </div>
          )}
          {status === 'error' && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,68,85,0.08)', border: '1px solid rgba(255,68,85,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff4455' }}>
              <span>✕</span> Error — check activity log
            </div>
          )}
          {status === 'idle' && mapsRuns.length > 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)' }}>
              <span>■</span> {mapsRuns.length} run{mapsRuns.length > 1 ? 's' : ''} — {totalAllLeads} total leads
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {leads.length > 0 && (
            <button onClick={downloadExcel} disabled={exporting} style={{ padding: '9px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid rgba(0,229,160,0.4)', borderRadius: 'var(--radius)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {exporting ? '↻' : '↓'} EXPORT ({leads.length})
            </button>
          )}
          {!isRunning ? (
            <button onClick={runScrape} disabled={!mapsSearches.length} style={{ padding: '10px 28px', background: mapsSearches.length ? 'var(--accent)' : 'var(--surface2)', color: mapsSearches.length ? '#000' : 'var(--text3)', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 8, cursor: mapsSearches.length ? 'pointer' : 'not-allowed', animation: mapsSearches.length ? 'glow 3s infinite' : 'none' }}>
              <span>▶</span> RUN SCRAPER
            </button>
          ) : (
            <button onClick={() => setStatus('idle')} style={{ padding: '10px 22px', background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer' }}>
              ■ STOP
            </button>
          )}
        </div>
      </div>

      {/* Page tabs */}
      <div style={{ display: 'flex', padding: '0 40px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', background: 'none', color: activeTab === tab ? 'var(--accent)' : 'var(--text3)', borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
            {tab}
            {tab === 'LEADS' && leads.length > 0 && (
              <span style={{ marginLeft: 8, background: 'rgba(0,229,160,0.15)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: 'var(--accent)' }}>{leads.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* ── CONFIG TAB ── */}
          {activeTab === 'CONFIG' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>
              <div style={{ maxWidth: 900 }}>

                {/* How it works */}
                <div style={{ background: 'rgba(0,229,160,0.04)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 'var(--radius-lg)', marginBottom: 24, padding: '16px 24px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--accent)', marginBottom: 10 }}>ℹ  HOW IT WORKS</div>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: 'var(--text2)' }}>
                    <li>Fill in <strong style={{ color: 'var(--text)' }}>business type</strong>, <strong style={{ color: 'var(--text)' }}>country</strong>, and <strong style={{ color: 'var(--text)' }}>city</strong>.</li>
                    <li>Optional — narrow to one area: type a <strong style={{ color: 'var(--text)' }}>ZIP / pincode</strong> yourself, or pick one from the suggested chips below the form (US works best, other countries may not show suggestions).</li>
                    <li>Leave the ZIP empty to search the whole city.</li>
                    <li>Click <strong style={{ color: 'var(--text)' }}>+ ADD SEARCH</strong> to queue it. Add as many as you want.</li>
                    <li>Hit <strong style={{ color: 'var(--text)' }}>RUN SCRAPER</strong> — we scrape Google Maps via Apify and only keep listings that have a phone or email.</li>
                  </ol>
                </div>

                {/* Max results setting */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 24, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text3)' }}>SCRAPER SETTINGS</span>
                  </div>
                  <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em' }}>MAX RESULTS PER CITY</div>
                    <input type="range" min={5} max={100} step={5} value={maxResults} onChange={e => setMaxResults(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--accent)', width: 32 }}>{maxResults}</span>
                  </div>
                </div>

                {/* Add search form */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 24, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text3)' }}>ADD SEARCH</span>
                  </div>
                  <div style={{ padding: '20px 24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, letterSpacing: '0.1em' }}>BUSINESS TYPE</div>
                        <input
                          value={business}
                          onChange={e => setBusiness(e.target.value)}
                          placeholder="e.g. Datacenters"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, letterSpacing: '0.1em' }}>COUNTRY</div>
                        <input
                          value={country}
                          onChange={e => { setCountry(e.target.value); setResolvedCountry(null); setResolvedZips([]); setSelectedZips([]); setManualZip(''); }}
                          placeholder="e.g. United States"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, letterSpacing: '0.1em' }}>CITY</div>
                        <input
                          value={city}
                          onChange={e => { setCity(e.target.value); setResolvedCountry(null); setResolvedZips([]); setSelectedZips([]); setManualZip(''); }}
                          onBlur={loadZips}
                          placeholder="e.g. Seattle"
                          style={inputStyle}
                        />
                        {loadingZips && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                            <span style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>↻</span> Loading ZIP codes...
                          </div>
                        )}
                      </div>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 6, letterSpacing: '0.1em' }}>ZIP / PINCODE <span style={{ color: 'var(--text3)', fontWeight: 400, textTransform: 'lowercase', letterSpacing: 0 }}>(optional)</span></div>
                        <input
                          value={manualZip}
                          onChange={e => { setManualZip(e.target.value); if (e.target.value.trim()) setSelectedZips([]); }}
                          placeholder="e.g. 98101"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    {/* ZIP selector — single-select to keep the search fast */}
                    {resolvedZips.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em' }}>SELECT ONE ZIP / PINCODE</span>
                          <button onClick={() => setSelectedZips([])} style={{ background: 'none', color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)', cursor: 'pointer', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>CLEAR</button>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
                            {selectedZips.length === 1
                              ? <>1 selected — up to <strong style={{ color: 'var(--accent)' }}>{maxResults}</strong> results</>
                              : <>none selected — city-wide search, up to <strong style={{ color: 'var(--accent)' }}>{maxResults}</strong> results</>}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {resolvedZips.map(zip => {
                            const isSelected = selectedZips[0] === zip;
                            return (
                              <button
                                key={zip}
                                onClick={() => { setSelectedZips(isSelected ? [] : [zip]); setManualZip(''); }}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 20,
                                  fontSize: 11,
                                  fontFamily: 'var(--font-mono)',
                                  cursor: 'pointer',
                                  transition: 'all 0.12s',
                                  background: isSelected ? 'var(--accent-dim)' : 'var(--surface2)',
                                  color: isSelected ? 'var(--accent)' : 'var(--text3)',
                                  border: isSelected ? '1px solid rgba(0,229,160,0.3)' : '1px solid var(--border)',
                                  fontWeight: isSelected ? 700 : 400,
                                }}
                              >
                                {zip}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {resolvedZips.length === 0 && resolvedCountry && !loadingZips && !manualZip.trim() && (
                      <div style={{ marginBottom: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
                        No ZIP suggestions for this city — type one in the ZIP field above, or leave empty to search city-wide.
                      </div>
                    )}

                    {resolveError && (
                      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,68,85,0.08)', border: '1px solid rgba(255,68,85,0.2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff4455' }}>
                        {resolveError}
                      </div>
                    )}

                    <button
                      onClick={addSearch}
                      disabled={!business.trim() || !resolvedCountry}
                      style={{
                        padding: '9px 20px',
                        background: (!business.trim() || !resolvedCountry) ? 'var(--surface2)' : 'var(--accent)',
                        color: (!business.trim() || !resolvedCountry) ? 'var(--text3)' : '#000',
                        fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      + ADD SEARCH
                    </button>
                  </div>
                </div>

                {/* Searches list */}
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                  <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em' }}>
                    <span>SEARCH QUEUE</span>
                    <span>{mapsSearches.length} searches</span>
                  </div>

                  {mapsSearches.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      No searches yet — add one above
                    </div>
                  ) : (
                    mapsSearches.map((search, i) => (
                      <div key={search.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '16px 20px', borderBottom: i < mapsSearches.length - 1 ? '1px solid var(--border)' : 'none', gap: 16, transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', width: 28, flexShrink: 0, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>

                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{search.business}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text2)' }}>{search.city}, {search.country}</span>
                            <span style={{ padding: '2px 8px', borderRadius: 12, background: 'var(--accent-dim)', border: '1px solid rgba(0,229,160,0.2)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>
                              {search.countryCode}
                            </span>
                          </div>

                          {search.fallback ? (
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
                              ⚠ No ZIP codes found — will search by city name only
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {search.zips.slice(0, 10).map(zip => (
                                <span key={zip} style={{ padding: '2px 7px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{zip}</span>
                              ))}
                              {search.zips.length > 10 && (
                                <span style={{ padding: '2px 7px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>+{search.zips.length - 10} more</span>
                              )}
                            </div>
                          )}
                        </div>

                        <button onClick={() => removeSearch(search.id)} style={{ background: 'none', color: 'var(--text3)', fontSize: 16, padding: '0 4px', cursor: 'pointer', transition: 'color 0.15s', lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--warn)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                        >×</button>
                      </div>
                    ))
                  )}

                  {mapsSearches.length > 0 && (
                    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
                      Total searches: <strong style={{ color: 'var(--text2)' }}>
                        {mapsSearches.reduce((s, search) => s + Math.max(search.zips.length, 1), 0)}
                      </strong> (business × ZIP combinations)
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── LEADS TAB ── */}
          {activeTab === 'LEADS' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

              {/* Run tabs — inside LEADS */}
              {mapsRuns.length > 0 && (
                <div style={{ display: 'flex', padding: '0 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', overflowX: 'auto', flexShrink: 0 }}>
                  {mapsRuns.map((run, idx) => {
                    const isActive = run.runId === (activeMapsRunId || mapsRuns[mapsRuns.length - 1]?.runId);
                    const runDate = new Date(run.startedAt).toLocaleDateString();
                    const runTime = new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={run.runId} onClick={() => setActiveMapsRunId(run.runId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', cursor: 'pointer', borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent', color: isActive ? 'var(--accent)' : 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 700 }}>Run {idx + 1}</span>
                        <span style={{ opacity: 0.7 }}>{runDate} {runTime}</span>
                        <span style={{ background: isActive ? 'rgba(0,229,160,0.15)' : 'var(--surface2)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: isActive ? 'var(--accent)' : 'var(--text3)' }}>{run.leads.length}</span>
                        <span onClick={e => { e.stopPropagation(); deleteMapsRun(run.runId); }} style={{ opacity: 0.4, fontSize: 14, cursor: 'pointer', transition: 'opacity 0.15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>×</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {leads.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16, color: 'var(--text3)' }}>
                  <div style={{ fontSize: 40 }}>{isRunning ? <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> : '🗺'}</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text2)', marginBottom: 6 }}>No leads yet</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{isRunning ? 'Scraping Google Maps...' : 'Add searches in CONFIG tab and click RUN SCRAPER'}</div>
                  </div>
                </div>
              ) : (
                // ── Scrollable table wrapper ──
                <div style={{ flex: 1, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                        <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                            {['NAME', 'ADDRESS', 'BUSINESS', 'CITY', 'ZIPCODE', 'PHONE', 'EMAIL', 'RATING', 'LINKS'].map(col => (
                            <th key={col} style={{ padding: '11px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                                {col}
                            </th>
                            ))}
                        </tr>
                        </thead>
                        <tbody>
                        {leads.map((lead, i) => (
                            <LeadRow key={i} lead={lead} />
                        ))}
                        {isRunning && (
                            <tr>
                            <td colSpan={9} style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 16 }}>◌</span>
                                Scraping Google Maps…
                                </div>
                            </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                    </div>
              )}
            </div>
          )}
        </div>

        {/* Activity Log */}
        <div style={{ width: logOpen ? 280 : 36, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', flexShrink: 0, transition: 'width 0.2s ease', overflow: 'hidden' }}>
          <div style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: logOpen ? 'space-between' : 'center', flexShrink: 0, minHeight: 41 }}>
            {logOpen && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text3)', whiteSpace: 'nowrap' }}>ACTIVITY LOG</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {logOpen && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{logs.length}</span>}
              <button onClick={() => setLogOpen(v => !v)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'rgba(0,229,160,0.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                {logOpen ? '›' : '‹'}
              </button>
            </div>
          </div>
          {logOpen && (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column-reverse' }}>
              {[...logs].reverse().map((log, i) => (
                <div key={i} style={{ padding: '6px 14px', animation: 'slideIn 0.15s ease' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{log.time}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: log.type === 'success' ? 'var(--accent)' : log.type === 'warn' ? 'var(--warn)' : log.type === 'error' ? '#ff4455' : 'var(--text2)' }}>
                    {log.msg}
                  </span>
                </div>
              ))}
              {logs.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  Logs will appear here
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function LeadRow({ lead }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(v => !v)}
        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s', animation: 'slideIn 0.25s ease' }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 600 }}>{lead.name}</div>
        </td>
        <td style={{ padding: '12px 16px', color: 'var(--text2)', maxWidth: expanded ? 'none' : 200 }}>
            <div style={{ overflow: expanded ? 'visible' : 'hidden', textOverflow: expanded ? 'unset' : 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap', maxWidth: expanded ? 'none' : 180, fontSize: 12 }}>
                {lead.address || '—'}
            </div>
        </td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{lead.businessType}</span>
        </td>
        <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
          {lead.city}, {lead.country}
        </td>
        <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          {lead.zipCode || '—'}
        </td>
        <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
          {lead.phone || '—'}
        </td>
        <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--info)', whiteSpace: 'nowrap' }}>
          {lead.email || '—'}
        </td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          {lead.rating
            ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#ffb900' }}>★ {lead.rating}</span>
            : '—'}
        </td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {lead.website && (
              <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)', padding: '3px 8px', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4 }}>WEB</a>
            )}
            {lead.source && (
              <a href={lead.source} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', padding: '3px 8px', border: '1px solid rgba(0,229,160,0.3)', borderRadius: 4 }}>MAP</a>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

function Row({ k, v, isLink }) {
  if (!v) return null;
  return (
    <span style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
      <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 10, width: 60, flexShrink: 0 }}>{k}</span>
      {isLink ? (
        <a href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', fontSize: 12 }}>{v}</a>
      ) : (
        <span>{v}</span>
      )}
    </span>
  );
}

function InfoBlock({ title, children }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  boxSizing: 'border-box',
};