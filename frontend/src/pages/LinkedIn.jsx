import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { NavLink } from 'react-router-dom';
import { SummaryButton, SummaryRow } from '../components/SummaryPanel.jsx';

// ── Constants ──────────────────────────────────────────────────────────
const INTENT_COLORS = {
  high:   { bg: 'rgba(0,229,160,0.12)',   border: 'rgba(0,229,160,0.3)',   text: '#00e5a0' },
  medium: { bg: 'rgba(255,185,0,0.12)',   border: 'rgba(255,185,0,0.3)',   text: '#ffb900' },
  low:    { bg: 'rgba(136,136,160,0.12)', border: 'rgba(136,136,160,0.3)', text: '#8888a0' },
};

const DM_COLORS = {
  'high':    '#ff6b35',
  'medium':  '#4d9fff',
  'low':     '#c88cff',
  'C-Suite': '#ff6b35',
  'Founder': '#ff6b35',
  'VP':      '#4d9fff',
  'Director':'#4d9fff',
  'Manager': '#c88cff',
  'Unknown': '#55556a',
};

const STAGES = {
  posts:      'Searching LinkedIn posts',
  posts_done: 'Posts collected',
  comments:   'Fetching comments',
  round1:     'AI screening',
  round1_done:'AI screen complete',
  enrichment: 'Enriching profiles',
  round2:     'AI qualifying',
  complete:   'Pipeline complete',
};

const DATE_OPTIONS = [
  { value: 'past-24h',     label: 'Past 24 hours' },
  { value: 'past-week',    label: 'Past week' },
  { value: 'past-month',   label: 'Past month' },
  { value: 'past-quarter', label: 'Past quarter' },
];

const TABS = ['KEYWORDS', 'DASHBOARD'];

export default function LinkedIn() {
  const {
    connectSafelyKey, accountId, keywords, setKeywords,
    DEFAULT_KEYWORDS, isConfigured, pipelineSettings, setPipelineSettings,
    pipelineStatus: status, setPipelineStatus: setStatus,
    pipelineLogs: logs, setPipelineLogs: setLogs,
    pipelineProgress: progress, setPipelineProgress: setProgress,
    abortRef, addLog,
    pipelineRuns, activeRunId, setActiveRunId,
    addPipelineRun, addLeadToRun, completeRun, deleteRun,
  } = useSettings();

  const [activeTab, setActiveTab] = useState('KEYWORDS');
  const [newKeyword, setNewKeyword] = useState('');
  const [edited, setEdited] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [filter, setFilter] = useState({ intent: 'all', minScore: 0, search: '' });
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState('confidenceScore');
  const [sortDir, setSortDir] = useState('desc');
  const [logOpen, setLogOpen] = useState(true);


  // Active run
  const activeRun = pipelineRuns.find(r => r.runId === activeRunId)
    || pipelineRuns[pipelineRuns.length - 1];
  const leads = activeRun?.leads || [];
  const totalAllLeads = pipelineRuns.reduce((s, r) => s + r.leads.length, 0);

  // ── Keywords functions ─────────────────────────────────────────────
  function addKeyword() {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (keywords.find(k => k.keyword.toLowerCase() === trimmed.toLowerCase())) return;
    setKeywords([...keywords, { keyword: trimmed }]);
    setNewKeyword('');
    setEdited(true);
  }

  function removeKeyword(keyword) {
    setKeywords(keywords.filter(k => k.keyword !== keyword));
    setEdited(true);
  }

  function resetToDefaults() {
    setKeywords(DEFAULT_KEYWORDS);
    setEdited(false);
  }

  function savePipelineSettings() {
    setPipelineSettings(pipelineSettings);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  // ── Pipeline functions ─────────────────────────────────────────────
  async function runPipeline() {
    setStatus('running');
    setLogs([]);
    setProgress(null);
    setActiveTab('DASHBOARD');

    const controller = new AbortController();
    abortRef.current = controller;

    const newRunId = `run_${Date.now()}`;
    addPipelineRun(newRunId);

    try {
      addLog(`Starting pipeline with ${keywords.length} keywords...`, 'info');

      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectSafelyKey, accountId, keywords, pipelineSettings }),
        signal: controller.signal,
      });

      addLog(`Server responded: HTTP ${res.status}`, res.ok ? 'info' : 'error');

      if (!res.ok) {
        const errText = await res.text();
        addLog(`Server error: ${errText}`, 'error');
        setStatus('error');
        return;
      }

      addLog('SSE stream connected — waiting for events...', 'info');

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
            if (event === 'start') addLog(`Pipeline started — ${payload.totalKeywords} keywords`);
            else if (event === 'progress') { setProgress(payload); if (payload.message) addLog(payload.message); }
            else if (event === 'lead') { addLeadToRun(newRunId, payload); addLog(`✓ ${payload.commenterName} @ ${payload.currentCompany}`, 'success'); }
            else if (event === 'warning') addLog(`⚠ ${payload.message}`, 'warn');
            else if (event === 'complete') { setStatus('done'); completeRun(newRunId); addLog(`Complete — ${payload.totalLeads} leads`, 'success'); }
            else if (event === 'error') { setStatus('error'); addLog(`Error: ${payload.message}`, 'error'); }
          } catch { }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') { setStatus('error'); addLog(`Connection error: ${err.message}`, 'error'); }
      else setStatus('idle');
    }
  }

  function stopPipeline() {
    abortRef.current?.abort();
    setStatus('idle');
    addLog('Pipeline stopped by user', 'warn');
  }

  async function downloadExcel(runsToExport, filename, exportType = 'single') {
    setExporting(true);
    try {
      const leadsToExport = runsToExport.flatMap(r => r.leads);
      const res = await fetch('/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToExport, runs: runsToExport, exportType, filename }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename || 'leads'}_${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addLog(`Export failed: ${err.message}`, 'error');
    } finally {
      setExporting(false);
    }
  }

  const displayLeads = leads
    .filter(l => {
      if (filter.intent !== 'all' && l.intentLevel !== filter.intent) return false;
      if (l.confidenceScore < filter.minScore) return false;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        return (
          (l.commenterName || '').toLowerCase().includes(q) ||
          (l.currentCompany || '').toLowerCase().includes(q) ||
          (l.companyIndustry || '').toLowerCase().includes(q) ||
          (l.comment || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const va = a[sortBy] ?? 0;
      const vb = b[sortBy] ?? 0;
      return sortDir === 'desc'
        ? (typeof va === 'string' ? vb.localeCompare(va) : vb - va)
        : (typeof va === 'string' ? va.localeCompare(vb) : va - vb);
    });

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const isRunning = status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ padding: '20px 40px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--surface)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>LINKEDIN SCRAPER</div>
          <h1 style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-0.8px' }}>LinkedIn</h1>

          {status === 'idle' && pipelineRuns.length === 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'var(--surface2)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
              <span>○</span> Ready to run
            </div>
          )}
          {status === 'running' && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
              <span style={{ animation: 'pulse 1s infinite' }}>●</span>
              {progress ? `${STAGES[progress.stage] || progress.stage}${progress.current && progress.total ? ` — ${progress.current}/${progress.total}` : ''}` : 'Pipeline running...'}
            </div>
          )}
          {status === 'done' && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>
              <span>✓</span> Complete — {leads.length} leads
            </div>
          )}
          {status === 'error' && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,68,85,0.08)', border: '1px solid rgba(255,68,85,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff4455' }}>
              <span>✕</span> Pipeline failed — check activity log
            </div>
          )}
          {status === 'idle' && pipelineRuns.length > 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)' }}>
              <span>■</span> {pipelineRuns.length} run{pipelineRuns.length > 1 ? 's' : ''} — {totalAllLeads} total leads
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {leads.length > 0 && (
            <button onClick={() => downloadExcel([activeRun], `run_${pipelineRuns.indexOf(activeRun) + 1}`)} disabled={exporting} style={{ padding: '9px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid rgba(0,229,160,0.4)', borderRadius: 'var(--radius)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              ↓ THIS RUN ({leads.length})
            </button>
          )}
          {pipelineRuns.length > 1 && totalAllLeads > 0 && (
            <button onClick={() => downloadExcel(pipelineRuns, 'all_runs', 'all')} disabled={exporting} style={{ padding: '9px 16px', background: 'transparent', color: 'var(--info)', border: '1px solid rgba(77,159,255,0.4)', borderRadius: 'var(--radius)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              ↓ ALL RUNS ({totalAllLeads})
            </button>
          )}
          {!isConfigured ? (
            <NavLink to="/settings">
              <button style={{ padding: '10px 22px', background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer' }}>⚙ CONFIGURE FIRST</button>
            </NavLink>
          ) : isRunning ? (
            <button onClick={stopPipeline} style={{ padding: '10px 22px', background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#000', borderRadius: 1 }} /> STOP
            </button>
          ) : (
            <button onClick={runPipeline} style={{ padding: '10px 28px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 8, animation: 'glow 3s infinite', cursor: 'pointer' }}>
              <span>▶</span> RUN PIPELINE
            </button>
          )}
        </div>
      </div>

      {/* Page tabs */}
      <div style={{ display: 'flex', padding: '0 40px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', background: 'none', color: activeTab === tab ? 'var(--accent)' : 'var(--text3)', borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
            {tab}
            {tab === 'DASHBOARD' && leads.length > 0 && (
              <span style={{ marginLeft: 8, background: 'rgba(0,229,160,0.15)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: 'var(--accent)' }}>{leads.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* ── KEYWORDS TAB ── */}
          {activeTab === 'KEYWORDS' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>

              {/* Pipeline Settings */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 28, overflow: 'hidden', maxWidth: 860 }}>
                <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text3)' }}>PIPELINE SETTINGS</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {settingsSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>✓ Saved</span>}
                    <button onClick={savePipelineSettings} style={{ padding: '6px 14px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 11, borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>SAVE</button>
                  </div>
                </div>

                <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                  <SettingField label="DATE RANGE" hint="How far back to search posts">
                    <select value={pipelineSettings.datePosted} onChange={e => setPipelineSettings({ ...pipelineSettings, datePosted: e.target.value })} style={selectStyle}>
                      {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </SettingField>

                  <SettingField label="POSTS PER KEYWORD" hint="Max posts to fetch (5–50)">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="range" min={5} max={50} step={5} value={pipelineSettings.postLimit} onChange={e => setPipelineSettings({ ...pipelineSettings, postLimit: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', width: 28, textAlign: 'right' }}>{pipelineSettings.postLimit}</span>
                    </div>
                  </SettingField>

                  <SettingField label="MIN QUALIFY SCORE" hint="AI screening minimum score (1–10)">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="range" min={1} max={10} step={1} value={pipelineSettings.minScore} onChange={e => setPipelineSettings({ ...pipelineSettings, minScore: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', width: 24, textAlign: 'right' }}>{pipelineSettings.minScore}</span>
                    </div>
                  </SettingField>
                </div>

                <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', gap: 24, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', flexWrap: 'wrap' }}>
                  <span>Up to <strong style={{ color: 'var(--text2)' }}>{keywords.length * pipelineSettings.postLimit}</strong> posts</span>
                  <span>Qualify threshold: <strong style={{ color: 'var(--accent)' }}>{pipelineSettings.minScore}+</strong></span>
                  <span>Date range: <strong style={{ color: 'var(--text2)' }}>{DATE_OPTIONS.find(o => o.value === pipelineSettings.datePosted)?.label}</strong></span>
                </div>
              </div>

              {/* Add keyword */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-end', maxWidth: 860 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>NEW KEYWORD</label>
                  <input
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addKeyword()}
                    placeholder="e.g. struggling with data quality"
                    style={{ width: '100%', padding: '9px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <button onClick={addKeyword} disabled={!newKeyword.trim()} style={{ padding: '9px 20px', background: newKeyword.trim() ? 'var(--accent)' : 'var(--surface2)', color: newKeyword.trim() ? '#000' : 'var(--text3)', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: newKeyword.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                  + ADD
                </button>
                {edited && (
                  <button onClick={resetToDefaults} style={{ padding: '9px 16px', background: 'var(--warn-dim)', color: 'var(--warn)', border: '1px solid rgba(255,107,53,0.3)', borderRadius: 'var(--radius)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Reset
                  </button>
                )}
              </div>

              {/* Keywords list */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', maxWidth: 860 }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between' }}>
                  <span>KEYWORDS</span>
                  <span>{keywords.length} configured</span>
                </div>
                {keywords.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>No keywords yet — add one above</div>
                ) : (
                  keywords.map((kw, i) => (
                    <div key={kw.keyword} style={{ display: 'flex', alignItems: 'center', padding: '13px 20px', borderBottom: i < keywords.length - 1 ? '1px solid var(--border)' : 'none', gap: 14, transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', width: 28, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                      <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)' }}>{kw.keyword}</span>
                      <button onClick={() => removeKeyword(kw.keyword)} style={{ background: 'none', color: 'var(--text3)', fontSize: 16, padding: '0 4px', cursor: 'pointer', transition: 'color 0.15s', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--warn)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                      >×</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {/* ── Dashboard tab ── */}
          {activeTab === 'DASHBOARD' && (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                
                {/* Left column: run tabs + stats + table */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Run tabs */}
                {pipelineRuns.length > 0 && (
                    <div style={{ display: 'flex', padding: '0 40px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', overflowX: 'auto', flexShrink: 0 }}>
                    {pipelineRuns.map((run, idx) => {
                        const isActive = run.runId === (activeRunId || pipelineRuns[pipelineRuns.length - 1]?.runId);
                        const runDate = new Date(run.startedAt).toLocaleDateString();
                        const runTime = new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return (
                        <div key={run.runId} onClick={() => setActiveRunId(run.runId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', cursor: 'pointer', borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent', color: isActive ? 'var(--accent)' : 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
                            <span style={{ fontWeight: 700 }}>Run {idx + 1}</span>
                            <span style={{ opacity: 0.7 }}>{runDate} {runTime}</span>
                            <span style={{ background: isActive ? 'rgba(0,229,160,0.15)' : 'var(--surface2)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: isActive ? 'var(--accent)' : 'var(--text3)' }}>{run.leads.length}</span>
                            {run.status === 'running' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite', display: 'inline-block' }} />}
                            <span onClick={e => { e.stopPropagation(); deleteRun(run.runId); }} style={{ marginLeft: 2, opacity: 0.4, fontSize: 14, cursor: 'pointer', transition: 'opacity 0.15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>×</span>
                        </div>
                        );
                    })}
                    </div>
                )}

                {/* Stats bar */}
                {(isRunning || leads.length > 0) && (
                    <div style={{ padding: '12px 40px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0, background: 'var(--surface)', flexWrap: 'wrap' }}>

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexShrink: 0 }}>
                        <StatChip label="TOTAL" value={leads.length} color="var(--accent)" />
                        <StatChip label="HIGH" value={leads.filter(l => l.intentLevel === 'high').length} color="#ffb900" />
                        <StatChip label="SCORE ≥8" value={leads.filter(l => l.confidenceScore >= 8).length} color="#4d9fff" />
                        <StatChip label="C-SUITE" value={leads.filter(l => ['C-Suite','Founder','high'].includes(l.decisionMakerLevel)).length} color="#ff6b35" />
                    </div>

                    {/* Divider */}
                    <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />

                    {/* Filters */}
                    {leads.length > 0 && (
                        <>
                        <input value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} placeholder="Search name, company, comment..." style={{ padding: '6px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', width: 220 }} />
                        {['all', 'high', 'medium', 'low'].map(v => (
                            <button key={v} onClick={() => setFilter(f => ({ ...f, intent: v }))} style={{ padding: '5px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', cursor: 'pointer', background: filter.intent === v ? 'var(--accent-dim)' : 'var(--surface2)', color: filter.intent === v ? 'var(--accent)' : 'var(--text3)', border: filter.intent === v ? '1px solid rgba(0,229,160,0.3)' : '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            {v === 'all' ? 'ALL INTENT' : v.toUpperCase()}
                            </button>
                        ))}
                        <select value={filter.minScore} onChange={e => setFilter(f => ({ ...f, minScore: Number(e.target.value) }))} style={{ padding: '5px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text2)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>
                            <option value={0}>MIN SCORE: ANY</option>
                            <option value={6}>MIN SCORE: 6+</option>
                            <option value={7}>MIN SCORE: 7+</option>
                            <option value={8}>MIN SCORE: 8+</option>
                            <option value={9}>MIN SCORE: 9+</option>
                        </select>
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{displayLeads.length} results</span>
                        </>
                    )}

                    {/* Running indicator */}
                    {isRunning && progress && (
                        <div style={{ marginLeft: leads.length ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s infinite' }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                            {STAGES[progress.stage] || progress.stage}
                            {progress.current && progress.total ? ` (${progress.current}/${progress.total})` : ''}
                        </span>
                        </div>
                    )}
                    </div>
                )}

                {/* Table */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {pipelineRuns.length === 0 ? (
                    <EmptyState isConfigured={isConfigured} />
                    ) : leads.length === 0 && !isRunning ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>No leads in this run</div>
                    ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                        <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                            {[
                            { key: 'commenterName',      label: 'NAME' },
                            { key: 'currentRole',        label: 'ROLE' },
                            { key: 'currentCompany',     label: 'COMPANY' },
                            { key: 'companyIndustry',    label: 'INDUSTRY' },
                            { key: 'decisionMakerLevel', label: 'SENIORITY' },
                            { key: 'intentLevel',        label: 'INTENT' },
                            { key: 'confidenceScore',    label: 'SCORE' },
                            { key: null,                 label: 'COMMENT' },
                            { key: null,                 label: 'LINKS' },
                            ].map(col => (
                            <th key={col.label} onClick={() => col.key && toggleSort(col.key)} style={{ padding: '11px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', color: sortBy === col.key ? 'var(--accent)' : 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: col.key ? 'pointer' : 'default', userSelect: 'none' }}>
                                {col.label}{sortBy === col.key && <span style={{ marginLeft: 4 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                            </th>
                            ))}
                        </tr>
                        </thead>
                        <tbody>
                        {displayLeads.map((lead, i) => <LeadRow key={`${lead.profileUrl}-${i}`} lead={lead} />)}
                        {isRunning && (
                            <tr>
                            <td colSpan={9} style={{ padding: '16px', textAlign: 'center' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 16 }}>◌</span>
                                Scanning for leads…
                                </div>
                            </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                    )}
                </div>

                </div> {/* end left column */}

                {/* Activity Log — starts from run tabs, full height */}
                <div style={{ width: logOpen ? 300 : 36, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', flexShrink: 0, transition: 'width 0.2s ease', overflow: 'hidden' }}>
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
                        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Logs will appear here</div>
                    )}
                    </div>
                )}
                </div>

            </div>
            )}
        </div>
      </div>
    </div>
  );
}

// ── Sub components ─────────────────────────────────────────────────────
// ── REPLACE YOUR ENTIRE LeadRow FUNCTION WITH THIS ──────────────────
// Also update the import at the top of LinkedIn.jsx to:
// import { SummaryButton, SummaryRow } from '../components/SummaryPanel.jsx';

// ── REPLACE YOUR ENTIRE LeadRow FUNCTION WITH THIS ──────────────────
// Import at top of LinkedIn.jsx:
// import { SummaryButton, SummaryRow } from '../components/SummaryPanel.jsx';

function LeadRow({ lead }) {
  const [expanded, setExpanded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const intent = INTENT_COLORS[lead.intentLevel] || INTENT_COLORS.low;
  const dmColor = DM_COLORS[lead.decisionMakerLevel] || 'var(--text3)';

  return (
    <>
      {/* ── Main row ── */}
      <tr
        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.1s', animation: 'slideIn 0.25s ease' }}
        onClick={() => setExpanded(v => !v)}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 600 }}>{lead.commenterName}</div>
        </td>
        <td style={{ padding: '12px 16px', color: 'var(--text2)', maxWidth: 180 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.currentRole || lead.designation || '—'}</div>
        </td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 600 }}>{lead.currentCompany || lead.companyName || '—'}</div>
        </td>
        <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{lead.companyIndustry || '—'}</td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <span style={{ color: dmColor, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
            {lead.decisionMakerLevel ? lead.decisionMakerLevel.toUpperCase() : '—'}
          </span>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: intent.bg, border: `1px solid ${intent.border}`, color: intent.text, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
            {(lead.intentLevel || 'low').toUpperCase()}
          </span>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: lead.confidenceScore >= 8 ? 'rgba(0,229,160,0.15)' : lead.confidenceScore >= 6 ? 'rgba(255,185,0,0.15)' : 'var(--surface2)', border: `2px solid ${lead.confidenceScore >= 8 ? 'var(--accent)' : lead.confidenceScore >= 6 ? '#ffb900' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: lead.confidenceScore >= 8 ? 'var(--accent)' : lead.confidenceScore >= 6 ? '#ffb900' : 'var(--text3)' }}>
            {lead.confidenceScore}
          </div>
        </td>
        <td style={{ padding: '12px 16px', maxWidth: 200 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)', fontSize: 12 }}>{lead.comment}</div>
        </td>
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {lead.profileUrl && (
              <a href={lead.profileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)', padding: '3px 8px', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4 }}>PROFILE</a>
            )}
            {lead.postUrl && (
              <a href={lead.postUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4 }}>POST</a>
            )}
          </div>
        </td>
      </tr>

      {/* ── Expanded info row ── */}
      {expanded && (
        <tr style={{ borderBottom: summaryOpen ? 'none' : '1px solid var(--border)' }}>
          <td colSpan={9} style={{ padding: 0 }}>
            <div style={{ padding: '20px 40px', background: 'var(--surface2)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20 }}>
              <InfoBlock title="COMMENT">
                <p style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>{lead.comment}</p>
              </InfoBlock>
              <InfoBlock title="AI REASONING">
                <p style={{ color: 'var(--text2)', fontSize: 12, marginBottom: 8 }}>
                  <strong style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>AI SCREEN — </strong>{lead.round1Reason}
                </p>
                <p style={{ color: 'var(--text2)', fontSize: 12 }}>
                  <strong style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>AI QUALIFY — </strong>{lead.round2Reason}
                </p>
              </InfoBlock>
              <InfoBlock title="COMPANY">
                <p style={{ color: 'var(--text2)', fontSize: 12, lineHeight: 1.7 }}>
                  <Row k="Size"      v={lead.companySize} />
                  <Row k="Followers" v={lead.companyFollowers?.toLocaleString()} />
                  <Row k="Location"  v={lead.companyLocation} />
                  <Row k="Website"   v={lead.companyWebsite} isLink />
                  <Row k="LinkedIn"  v={lead.companyLinkedinUrl} isLink />
                </p>
              </InfoBlock>
              <InfoBlock title="SOURCE">
                <Row k="Keyword" v={lead.keyword} />
              </InfoBlock>
            </div>
          </td>
        </tr>
      )}

      {/* ── Summary content row — appears below expanded row ── */}
      {summaryOpen && (
        <SummaryRow
          profileUrl={lead.profileUrl}
          name={lead.commenterName}
          colSpan={9}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </>
  );
}

function Row({ k, v, isLink }) {
  if (!v) return null;
  return (
    <span style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
      <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 10, width: 70, flexShrink: 0 }}>{k}</span>
      {isLink ? <a href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noreferrer" style={{ color: 'var(--info)', fontSize: 12 }}>{v}</a> : <span>{v}</span>}
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

function StatChip({ label, value, color }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color, fontFamily: 'var(--font-display)', letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function SettingField({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

function EmptyState({ isConfigured }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--text3)' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', border: '2px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>⬡</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text2)', marginBottom: 6 }}>No runs yet</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>
          {isConfigured ? 'Click RUN PIPELINE to start scanning LinkedIn' : 'Go to Settings and add your ConnectSafely credentials first'}
        </div>
      </div>
    </div>
  );
}

const selectStyle = {
  padding: '9px 14px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  width: '100%',
};