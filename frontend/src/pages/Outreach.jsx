import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { NavLink } from 'react-router-dom';
import { SummaryButton, SummaryRow } from '../components/SummaryPanel.jsx';

const TABS = ['CONFIG', 'COMPANIES', 'LEADS'];

const SCORE_COLORS = {
  high:   { bg: 'rgba(0,229,160,0.12)', border: 'rgba(0,229,160,0.3)',  text: '#00e5a0' },
  medium: { bg: 'rgba(255,185,0,0.12)', border: 'rgba(255,185,0,0.3)',  text: '#ffb900' },
  low:    { bg: 'rgba(136,136,160,0.12)', border: 'rgba(136,136,160,0.3)', text: '#8888a0' },
};

function getScoreColor(score) {
  if (score >= 8) return SCORE_COLORS.high;
  if (score >= 6) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

function getConfidenceColor(confidence) {
  if (confidence >= 90) return { bg: 'rgba(0,229,160,0.12)', border: 'rgba(0,229,160,0.3)', text: '#00e5a0' };
  if (confidence >= 70) return { bg: 'rgba(255,185,0,0.12)', border: 'rgba(255,185,0,0.3)', text: '#ffb900' };
  return { bg: 'rgba(136,136,160,0.12)', border: 'rgba(136,136,160,0.3)', text: '#8888a0' };
}

function RunTabs({ outreachRuns, activeOutreachRunId, setActiveOutreachRunId, deleteOutreachRun, accentVar = 'var(--accent)', accentRgb = '0,229,160', countKey = 'companies' }) {
  if (!outreachRuns.length) return null;
  return (
    <div style={{ display: 'flex', padding: '0 40px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', overflowX: 'auto', flexShrink: 0 }}>
      {outreachRuns.map((run, idx) => {
        const isActive = run.runId === (activeOutreachRunId || outreachRuns[outreachRuns.length - 1]?.runId);
        const runDate = new Date(run.startedAt).toLocaleDateString();
        const runTime = new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const count = countKey === 'companies' ? `${run.companies.length} co` : `${run.leads.length} leads`;
        return (
          <div key={run.runId} onClick={() => setActiveOutreachRunId(run.runId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', cursor: 'pointer', borderBottom: isActive ? `2px solid ${accentVar}` : '2px solid transparent', color: isActive ? accentVar : 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
            <span style={{ fontWeight: 700 }}>Run {idx + 1}</span>
            <span style={{ opacity: 0.7 }}>{runDate} {runTime}</span>
            <span style={{ background: isActive ? `rgba(${accentRgb},0.15)` : 'var(--surface2)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: isActive ? accentVar : 'var(--text3)' }}>{count}</span>
            <span onClick={e => { e.stopPropagation(); deleteOutreachRun(run.runId); }} style={{ marginLeft: 2, opacity: 0.4, fontSize: 14, cursor: 'pointer', transition: 'opacity 0.15s' }} onMouseEnter={e => e.currentTarget.style.opacity = '1'} onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}>×</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Outreach() {
  const {
    apolloKey, hunterKey,
    productDescription, setProductDescription,
    targetAudience, setTargetAudience,
    targetJobTitles, setTargetJobTitles,
    minCompanyScore, setMinCompanyScore,
    isOutreachConfigured,
    outreachRuns, activeOutreachRunId, setActiveOutreachRunId,
    addOutreachRun, addCompanyToRun, addLeadToOutreachRun,
    completeOutreachRun, deleteOutreachRun,
    targetLocations, setTargetLocations,
    employeeRanges, setEmployeeRanges,
  } = useSettings();

  const [activeTab, setActiveTab] = useState('CONFIG');
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [expandedCompany, setExpandedCompany] = useState(null);
  const [expandedLead, setExpandedLead] = useState(null); // ← for leads summary

  // Lead filters
  const [filterSeniority, setFilterSeniority] = useState([]);
  const [filterDepartment, setFilterDepartment] = useState([]);
  const [filterCompany, setFilterCompany] = useState([]);
  const [filterSearch, setFilterSearch] = useState('');

  const [productInput, setProductInput] = useState(productDescription);
  const [audienceInput, setAudienceInput] = useState(targetAudience);
  const [titlesInput, setTitlesInput] = useState(targetJobTitles);
  const [scoreInput, setScoreInput] = useState(minCompanyScore);
  const [locationsInput, setLocationsInput] = useState(targetLocations);
  const [rangesInput, setRangesInput] = useState(employeeRanges);

  const activeRun = outreachRuns.find(r => r.runId === activeOutreachRunId) || outreachRuns[outreachRuns.length - 1];
  const companies = activeRun?.companies || [];
  const leads = activeRun?.leads || [];
  const [logOpen, setLogOpen] = useState(true);

  const seniorityOptions = [...new Set(leads.map(l => l.seniority).filter(Boolean))].sort();
  const departmentOptions = [...new Set(leads.map(l => l.department).filter(Boolean))].sort();
  const companyOptions = [...new Set(leads.map(l => l.companyName).filter(Boolean))].sort();

  const filteredLeads = leads.filter(lead => {
    if (filterSeniority.length && !filterSeniority.includes(lead.seniority)) return false;
    if (filterDepartment.length && !filterDepartment.includes(lead.department)) return false;
    if (filterCompany.length && !filterCompany.includes(lead.companyName)) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      const haystack = `${lead.firstName} ${lead.lastName} ${lead.title} ${lead.email}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const hasActiveFilters = filterSeniority.length || filterDepartment.length || filterCompany.length || filterSearch;

  function clearFilters() {
    setFilterSeniority([]);
    setFilterDepartment([]);
    setFilterCompany([]);
    setFilterSearch('');
  }

  function addLog(msg, type = 'info') {
    setLogs(prev => [...prev.slice(-99), { time: new Date().toLocaleTimeString(), msg, type }]);
  }

  function saveConfig() {
    setProductDescription(productInput.trim());
    setTargetAudience(audienceInput.trim());
    setTargetJobTitles(titlesInput.trim());
    setMinCompanyScore(Number(scoreInput));
    setTargetLocations(locationsInput.trim());
    setEmployeeRanges(rangesInput);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  }

  async function runDiscovery() {
    if (!apolloKey) { addLog('Apollo API key missing — go to Settings', 'error'); return; }
    if (!productDescription || !targetAudience) { addLog('Product description and target audience required — save config first', 'error'); return; }

    setStatus('discovering');
    setLogs([]);
    const newRunId = `outreach_${Date.now()}`;
    addOutreachRun(newRunId);
    setActiveTab('COMPANIES');

    try {
      addLog('Starting company discovery...', 'info');
      const res = await fetch('/api/outreach/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apolloKey, targetAudience: targetAudience || audienceInput, productDescription: productDescription || productInput, minCompanyScore: minCompanyScore || scoreInput, targetLocations: targetLocations || locationsInput, employeeRanges: employeeRanges?.length ? employeeRanges : rangesInput }),
      });

      if (!res.ok) { addLog(`Server error: ${await res.text()}`, 'error'); setStatus('error'); return; }

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
          let event = 'message', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (event === 'progress') addLog(payload.message, 'info');
            else if (event === 'company') { addCompanyToRun(newRunId, payload); addLog(`✓ Qualified: ${payload.name} (score ${payload.score})`, 'success'); }
            else if (event === 'warning') addLog(`⚠ ${payload.message}`, 'warn');
            else if (event === 'complete') { setStatus('done'); completeOutreachRun(newRunId); addLog(payload.message, 'success'); }
            else if (event === 'error') { setStatus('error'); addLog(`Error: ${payload.message}`, 'error'); }
          } catch { }
        }
      }
    } catch (err) { setStatus('error'); addLog(`Connection error: ${err.message}`, 'error'); }
  }

  async function runEnrichment() {
    if (!hunterKey) { addLog('Hunter.io key required — go to Settings', 'error'); return; }
    if (!companies.length) { addLog('No companies to enrich — run discovery first', 'error'); return; }

    setStatus('enriching');
    setActiveTab('LEADS');

    try {
      addLog(`Finding contacts for ${companies.length} companies...`, 'info');
      const res = await fetch('/api/outreach/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunterKey, companies }),
      });

      if (!res.ok) { addLog(`Server error: ${await res.text()}`, 'error'); setStatus('error'); return; }

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
          let event = 'message', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (event === 'progress') addLog(payload.message, 'info');
            else if (event === 'lead') {
              addLeadToOutreachRun(activeRun?.runId || outreachRuns[outreachRuns.length - 1]?.runId, payload);
              addLog(`✓ Contact: ${payload.firstName} ${payload.lastName} @ ${payload.companyName}`, 'success');
            }
            else if (event === 'warning') addLog(`⚠ ${payload.message}`, 'warn');
            else if (event === 'complete') { setStatus('done'); addLog(payload.message, 'success'); }
            else if (event === 'error') { setStatus('error'); addLog(`Error: ${payload.message}`, 'error'); }
          } catch { }
        }
      }
    } catch (err) { setStatus('error'); addLog(`Connection error: ${err.message}`, 'error'); }
  }

  async function downloadExcel() {
    if (!filteredLeads.length) return;
    setExporting(true);
    try {
      const res = await fetch('/api/export/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: filteredLeads, filename: `leads_${new Date().toISOString().slice(0, 10)}` }) });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `leads_${Date.now()}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { addLog(`Export failed: ${err.message}`, 'error'); } finally { setExporting(false); }
  }

  const isRunning = status === 'discovering' || status === 'enriching';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* TOP BAR */}
      <div style={{ padding: '20px 40px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: 'var(--surface)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>APOLLO PROSPECTOR</div>
          <h1 style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-0.8px' }}>Apollo</h1>
          {status === 'idle' && outreachRuns.length === 0 && <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'var(--surface2)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}><span>○</span> Ready</div>}
          {status === 'idle' && outreachRuns.length > 0 && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)' }}>
              <span>■</span> {outreachRuns.length} run{outreachRuns.length > 1 ? 's' : ''} — {outreachRuns.reduce((s, r) => s + r.companies.length, 0)} companies, {outreachRuns.reduce((s, r) => s + r.leads.length, 0)} leads
            </div>
          )}
          {status === 'discovering' && <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}><span style={{ animation: 'pulse 1s infinite' }}>●</span> Discovering companies...</div>}
          {status === 'enriching' && <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 20, background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)' }}><span style={{ animation: 'pulse 1s infinite' }}>●</span> Finding contacts...</div>}
          {status === 'done' && <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(0,229,160,0.08)', border: '1px solid rgba(0,229,160,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}><span>✓</span> Complete — {companies.length} companies, {leads.length} contacts</div>}
          {status === 'error' && <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(255,68,85,0.08)', border: '1px solid rgba(255,68,85,0.25)', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff4455' }}><span>✕</span> Error — check activity log</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {leads.length > 0 && <button onClick={downloadExcel} disabled={exporting} style={{ padding: '9px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid rgba(0,229,160,0.4)', borderRadius: 'var(--radius)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>{exporting ? '↻' : '↓'} EXPORT ({filteredLeads.length})</button>}
          {!isOutreachConfigured ? (
            <NavLink to="/settings"><button style={{ padding: '10px 22px', background: 'var(--warn)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer' }}>⚙ CONFIGURE FIRST</button></NavLink>
          ) : activeTab === 'COMPANIES' && companies.length > 0 && status !== 'enriching' ? (
            <button onClick={runEnrichment} disabled={isRunning} style={{ padding: '10px 24px', background: 'var(--info)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><span>👤</span> FIND CONTACTS</button>
          ) : activeTab !== 'LEADS' ? (
            <button onClick={runDiscovery} disabled={isRunning} style={{ padding: '10px 28px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 8, animation: 'glow 3s infinite', cursor: 'pointer' }}><span>▶</span> DISCOVER COMPANIES</button>
          ) : null}
        </div>
      </div>

      {/* PAGE TABS */}
      <div style={{ display: 'flex', padding: '0 40px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '12px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer', background: 'none', color: activeTab === tab ? 'var(--accent)' : 'var(--text3)', borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s' }}>
            {tab}
            {tab === 'COMPANIES' && companies.length > 0 && <span style={{ marginLeft: 8, background: 'rgba(0,229,160,0.15)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: 'var(--accent)' }}>{companies.length}</span>}
            {tab === 'LEADS' && leads.length > 0 && <span style={{ marginLeft: 8, background: 'rgba(77,159,255,0.15)', padding: '1px 7px', borderRadius: 10, fontSize: 10, color: 'var(--info)' }}>{leads.length}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>

          {/* CONFIG TAB — unchanged */}
          {activeTab === 'CONFIG' && (
            <div style={{ padding: '32px 40px', maxWidth: 700 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text3)' }}>PROSPECTOR CONFIGURATION</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {configSaved && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>✓ Saved</span>}
                    <button onClick={saveConfig} style={{ padding: '6px 14px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 11, borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>SAVE</button>
                  </div>
                </div>
                <div style={{ padding: '24px' }}>
                  <ConfigField label="PRODUCT DESCRIPTION" hint="What does your product/service do?">
                    <textarea value={productInput} onChange={e => setProductInput(e.target.value)} placeholder="e.g. We help B2B companies automate their sales outreach using AI..." rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                  </ConfigField>
                  <ConfigField label="TARGET AUDIENCE" hint="Who are your ideal customers?" style={{ marginTop: 20 }}>
                    <textarea value={audienceInput} onChange={e => setAudienceInput(e.target.value)} placeholder="e.g. SaaS companies in the US with 10-200 employees that need marketing automation..." rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                  </ConfigField>
                  <ConfigField label="TARGET JOB TITLES" hint="Comma separated — who to reach out to" style={{ marginTop: 20 }}>
                    <input type="text" value={titlesInput} onChange={e => setTitlesInput(e.target.value)} placeholder="CEO, Founder, CTO, VP of Engineering, Head of Product" style={inputStyle} />
                  </ConfigField>
                  <ConfigField label="MINIMUM COMPANY SCORE" hint="Only keep companies scoring this or above (1–10)" style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <input type="range" min={1} max={10} step={1} value={scoreInput} onChange={e => setScoreInput(e.target.value)} style={{ flex: 1, accentColor: 'var(--accent)' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--accent)', width: 24 }}>{scoreInput}</span>
                    </div>
                  </ConfigField>
                  <ConfigField label="TARGET LOCATIONS" hint="Comma separated countries or regions" style={{ marginTop: 20 }}>
                    <input type="text" value={locationsInput} onChange={e => setLocationsInput(e.target.value)} placeholder="United States, United Kingdom, Canada" style={inputStyle} />
                  </ConfigField>
                  <ConfigField label="COMPANY SIZE" hint="Select all sizes you want to target" style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {[{ code: '1,10', label: '1–10' }, { code: '11,50', label: '11–50' }, { code: '51,200', label: '51–200' }, { code: '201,500', label: '201–500' }, { code: '501,1000', label: '501–1000' }, { code: '1001,5000', label: '1001–5000' }, { code: '5001,10000', label: '5001–10000' }, { code: '10001', label: '10001+' }].map(({ code, label }) => {
                        const isSelected = rangesInput.includes(code);
                        return <button key={code} onClick={() => setRangesInput(prev => isSelected ? prev.filter(r => r !== code) : [...prev, code])} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'all 0.15s', background: isSelected ? 'var(--accent-dim)' : 'var(--surface2)', color: isSelected ? 'var(--accent)' : 'var(--text3)', border: isSelected ? '1px solid rgba(0,229,160,0.3)' : '1px solid var(--border)' }}>{label}</button>;
                      })}
                    </div>
                    <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{rangesInput.length} size{rangesInput.length !== 1 ? 's' : ''} selected</div>
                  </ConfigField>
                </div>
              </div>
              <div style={{ padding: '16px 20px', background: 'var(--accent-dim)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
                <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>HOW IT WORKS</div>
                <div>1. Fill in your product + audience above and save</div>
                <div>2. Click DISCOVER COMPANIES — finds + scores matching companies via Apollo</div>
                <div>3. Review companies in the COMPANIES tab</div>
                <div>4. Click FIND CONTACTS — finds decision makers via Hunter</div>
                <div>5. Review contacts in the LEADS tab and export to Excel</div>
              </div>
            </div>
          )}

          {/* COMPANIES TAB — exactly as original, no changes */}
          {activeTab === 'COMPANIES' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <RunTabs outreachRuns={outreachRuns} activeOutreachRunId={activeOutreachRunId} setActiveOutreachRunId={setActiveOutreachRunId} deleteOutreachRun={deleteOutreachRun} accentVar="var(--accent)" accentRgb="0,229,160" countKey="companies" />
              {companies.length === 0 ? (
                <EmptyState icon="🏢" title="No companies yet" subtitle={status === 'discovering' ? 'Discovering companies...' : 'Go to Config tab and click DISCOVER COMPANIES'} isRunning={status === 'discovering'} />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                      {['COMPANY', 'INDUSTRY', 'EMPLOYEES', 'LOCATION', 'SCORE', 'REASON', 'LINKS'].map(col => (
                        <th key={col} style={{ padding: '11px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company, i) => {
                      const sc = getScoreColor(company.score);
                      return (
                        <tr key={i} onClick={() => setExpandedCompany(expandedCompany === i ? null : i)} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600 }}>{company.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{company.domain}</div>
                          </td>
                          <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{company.industry || '—'}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{company.employees || '—'}</td>
                          <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{company.location || '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text, fontFamily: 'var(--font-mono)' }}>{company.score}/10</span>
                          </td>
                          <td style={{ padding: '12px 16px', color: 'var(--text2)', fontSize: 12, maxWidth: 250 }}>
                            <div style={{ overflow: expandedCompany === i ? 'visible' : 'hidden', textOverflow: expandedCompany === i ? 'unset' : 'ellipsis', whiteSpace: expandedCompany === i ? 'normal' : 'nowrap', lineHeight: 1.5 }}>{company.scoreReason}</div>
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {company.website && <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--info)', padding: '3px 8px', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 4 }}>WEB</a>}
                              {company.linkedin && <a href={company.linkedin} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', padding: '3px 8px', border: '1px solid rgba(0,229,160,0.3)', borderRadius: 4 }}>LI</a>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {status === 'discovering' && (
                      <tr><td colSpan={7} style={{ padding: '16px', textAlign: 'center' }}><div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 16 }}>◌</span> Discovering companies…</div></td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* LEADS TAB — SummaryPanel added after LINKS column */}
          {activeTab === 'LEADS' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <RunTabs
                outreachRuns={outreachRuns}
                activeOutreachRunId={activeOutreachRunId}
                setActiveOutreachRunId={setActiveOutreachRunId}
                deleteOutreachRun={deleteOutreachRun}
                accentVar="var(--info)"
                accentRgb="77,159,255"
                countKey="leads"
              />
              {leads.length === 0 ? (
                <EmptyState
                  icon="👤"
                  title="No contacts yet"
                  subtitle={status === 'enriching' ? 'Finding contacts...' : 'Go to Companies tab and click FIND CONTACTS'}
                  isRunning={status === 'enriching'}
                />
              ) : (
                <>
                  {/* FILTER BAR */}
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={filterSearch}
                      onChange={e => setFilterSearch(e.target.value)}
                      placeholder="Search name, title, email..."
                      style={{ padding: '7px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)', width: 220, boxSizing: 'border-box' }}
                    />
                    <FilterDropdown label="Seniority" options={seniorityOptions} selected={filterSeniority} setSelected={setFilterSeniority} />
                    <FilterDropdown label="Department" options={departmentOptions} selected={filterDepartment} setSelected={setFilterDepartment} />
                    <FilterDropdown label="Company" options={companyOptions} selected={filterCompany} setSelected={setFilterCompany} />
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>{filteredLeads.length} of {leads.length}</span>
                      {hasActiveFilters && (
                        <button onClick={clearFilters} style={{ padding: '5px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer' }}>CLEAR</button>
                      )}
                    </div>
                  </div>

                  {/* TABLE */}
                  {filteredLeads.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      No leads match the current filters
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                          {['PERSON', 'TITLE', 'SENIORITY', 'DEPARTMENT', 'EMAIL', 'CONFIDENCE', 'COMPANY', 'INDUSTRY', 'LOCATION', 'LINKS'].map(col => (
                            <th key={col} style={{ padding: '11px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', color: 'var(--text3)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map((lead, i) => {
                          const cc = getConfidenceColor(lead.confidence);
                          return (
                            <>
                              <tr
                                key={i}
                                style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                              >
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 600 }}>{lead.firstName} {lead.lastName}</div>
                                </td>
                                <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{lead.title || '—'}</td>
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  {lead.seniority ? (
                                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: 'rgba(77,159,255,0.12)', border: '1px solid rgba(77,159,255,0.3)', color: 'var(--info)', fontFamily: 'var(--font-mono)', textTransform: 'capitalize' }}>{lead.seniority}</span>
                                  ) : '—'}
                                </td>
                                <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{lead.department || '—'}</td>
                                <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--info)', whiteSpace: 'nowrap' }}>{lead.email || '—'}</td>
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  {lead.confidence ? (
                                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: cc.bg, border: `1px solid ${cc.border}`, color: cc.text, fontFamily: 'var(--font-mono)' }}>{lead.confidence}%</span>
                                  ) : '—'}
                                </td>
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 600 }}>{lead.companyName}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{lead.companyDomain}</div>
                                </td>
                                <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{lead.companyIndustry || '—'}</td>
                                <td style={{ padding: '12px 16px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{lead.companyLocation || '—'}</td>
                                {/* LINKS + SUMMARY BUTTON in same column */}
                                <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {lead.linkedin && (
                                      <a href={lead.linkedin} target="_blank" rel="noreferrer"
                                        style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', padding: '3px 8px', border: '1px solid rgba(0,229,160,0.3)', borderRadius: 4 }}>LI</a>
                                    )}
                                  </div>
                                </td>
                              </tr>

                              {/* Summary row — expands below this lead row when button clicked */}
                              {expandedLead === i && (
                                <SummaryRow
                                  profileUrl={lead.linkedin || ''}
                                  name={`${lead.firstName} ${lead.lastName}`}
                                  colSpan={10}
                                  onClose={() => setExpandedLead(null)}
                                />
                              )}
                            </>
                          );
                        })}
                        {status === 'enriching' && (
                          <tr>
                            <td colSpan={10} style={{ padding: '16px', textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 16 }}>◌</span>
                                Finding contacts…
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}

        </div>

        {/* ACTIVITY LOG */}
        <div style={{ width: logOpen ? 280 : 36, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--surface)', flexShrink: 0, transition: 'width 0.2s ease', overflow: 'hidden' }}>
          <div style={{ padding: '10px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: logOpen ? 'space-between' : 'center', flexShrink: 0, minHeight: 41 }}>
            {logOpen && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text3)', whiteSpace: 'nowrap' }}>ACTIVITY LOG</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {logOpen && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>{logs.length}</span>}
              <button onClick={() => setLogOpen(v => !v)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, flexShrink: 0 }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'rgba(0,229,160,0.4)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>{logOpen ? '›' : '‹'}</button>
            </div>
          </div>
          {logOpen && (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column-reverse' }}>
              {[...logs].reverse().map((log, i) => (
                <div key={i} style={{ padding: '6px 14px', animation: 'slideIn 0.15s ease' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', display: 'block', marginBottom: 2 }}>{log.time}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: log.type === 'success' ? 'var(--accent)' : log.type === 'warn' ? 'var(--warn)' : log.type === 'error' ? '#ff4455' : 'var(--text2)' }}>{log.msg}</span>
                </div>
              ))}
              {logs.length === 0 && <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>Logs will appear here</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigField({ label, hint, children, style }) {
  return (
    <div style={style}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text3)', marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{hint}</div>}
      {children}
    </div>
  );
}

function EmptyState({ icon, title, subtitle, isRunning }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16, color: 'var(--text3)' }}>
      <div style={{ fontSize: 40 }}>{isRunning ? <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> : icon}</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text2)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>{subtitle}</div>
      </div>
    </div>
  );
}

function FilterDropdown({ label, options, selected, setSelected }) {
  const [open, setOpen] = useState(false);
  function toggle(opt) { setSelected(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]); }
  const hasSelection = selected.length > 0;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{ padding: '7px 12px', background: hasSelection ? 'rgba(77,159,255,0.12)' : 'var(--surface2)', border: hasSelection ? '1px solid rgba(77,159,255,0.4)' : '1px solid var(--border)', borderRadius: 'var(--radius)', color: hasSelection ? 'var(--info)' : 'var(--text2)', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        {label.toUpperCase()}
        {hasSelection && <span style={{ background: 'rgba(77,159,255,0.25)', padding: '0 6px', borderRadius: 10, fontSize: 10 }}>{selected.length}</span>}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100 }} />
          <div style={{ position: 'absolute', top: '110%', left: 0, minWidth: 200, maxHeight: 280, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 101, padding: '6px 0' }}>
            {options.length === 0 ? (
              <div style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>No options</div>
            ) : options.map(opt => {
              const isOn = selected.includes(opt);
              return (
                <div key={opt} onClick={() => toggle(opt)} style={{ padding: '7px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: isOn ? 'var(--info)' : 'var(--text2)', background: isOn ? 'rgba(77,159,255,0.08)' : 'transparent', textTransform: 'capitalize' }} onMouseEnter={e => { if (!isOn) e.currentTarget.style.background = 'var(--surface2)'; }} onMouseLeave={e => { if (!isOn) e.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ width: 12, color: 'var(--info)' }}>{isOn ? '✓' : ''}</span>
                  {opt}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px', background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};
