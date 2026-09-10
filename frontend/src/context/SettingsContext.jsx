import { createContext, useContext, useState, useRef } from "react";

const SettingsContext = createContext();

export const DEFAULT_KEYWORDS = [
  { keyword: "Customer support chatbot" },
  { keyword: "Generative AI" },
  { keyword: "RAG Quality" },
  { keyword: "Data pipeline latency" },
  { keyword: "Looking for vendors" },
];

export function SettingsProvider({ children }) {
  const [connectSafelyKey, setConnectSafelyKeyState] = useState(localStorage.getItem("connectSafelyKey") || "");
  const [accountId, setAccountIdState] = useState(localStorage.getItem("accountId") || "");

  const [keywords, setKeywordsState] = useState(() => {
    try { const s = localStorage.getItem("keywords"); return s ? JSON.parse(s) : DEFAULT_KEYWORDS; }
    catch { return DEFAULT_KEYWORDS; }
  });

  const [pipelineSettings, setPipelineSettingsState] = useState(() => {
    try { const s = localStorage.getItem("pipelineSettings"); return s ? JSON.parse(s) : { postLimit: 20, commentLimit: 100, datePosted: 'past-month', minScore: 6 }; }
    catch { return { postLimit: 20, commentLimit: 100, datePosted: 'past-month', minScore: 6 }; }
  });

  const [apolloKey,    setApolloKeyState]    = useState(localStorage.getItem('apolloKey')    || '');
  const [hunterKey,    setHunterKeyState]    = useState(localStorage.getItem('hunterKey')    || '');
  const [apifyKey,     setApifyKeyState]     = useState(localStorage.getItem('apifyKey')     || '');
  const [serperKey,    setSerperKeyState]    = useState(localStorage.getItem('serperKey')    || '');
  const [firecrawlKey, setFirecrawlKeyState] = useState(localStorage.getItem('firecrawlKey') || '');

  const [pbApiKey,          setPbApiKeyState]          = useState(localStorage.getItem('pbApiKey')          || '');
  const [pbActivityAgentId, setPbActivityAgentIdState] = useState(localStorage.getItem('pbActivityAgentId') || '');
  const [pbProfileAgentId,  setPbProfileAgentIdState]  = useState(localStorage.getItem('pbProfileAgentId')  || '');
  const [pbLinkedinCookie,  setPbLinkedinCookieState]  = useState(localStorage.getItem('pbLinkedinCookie')  || '');

  const [productDescription, setProductDescriptionState] = useState(localStorage.getItem('productDescription') || '');
  const [targetAudience,     setTargetAudienceState]     = useState(localStorage.getItem('targetAudience')     || '');
  const [targetJobTitles,    setTargetJobTitlesState]    = useState(localStorage.getItem('targetJobTitles')    || 'CEO, Founder, CTO, VP of Engineering');
  const [minCompanyScore,    setMinCompanyScoreState]    = useState(Number(localStorage.getItem('minCompanyScore')) || 7);

  const [targetIndustries, setTargetIndustriesState] = useState(() => {
    try { const s = localStorage.getItem('targetIndustries'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [targetTechnologies, setTargetTechnologiesState] = useState(() => {
    try { const s = localStorage.getItem('targetTechnologies'); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  const [outreachRuns, setOutreachRunsState] = useState(() => {
    try { const s = localStorage.getItem('outreachRuns'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [activeOutreachRunId, setActiveOutreachRunId] = useState(null);
  const [outreachStatus, setOutreachStatus] = useState('idle');
  const [outreachLogs,   setOutreachLogs]   = useState([]);

  function addOutreachLog(msg, type = 'info') {
    setOutreachLogs(prev => [...prev.slice(-99), { time: new Date().toLocaleTimeString(), msg, type }]);
  }

  const [mapsRuns, setMapsRunsState] = useState(() => {
    try { const s = localStorage.getItem('mapsRuns'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [activeMapsRunId, setActiveMapsRunId] = useState(null);
  const [mapsStatus, setMapsStatus] = useState('idle');
  const [mapsLogs,   setMapsLogs]   = useState([]);

  function addMapsLog(msg, type = 'info') {
    setMapsLogs(prev => [...prev.slice(-99), { time: new Date().toLocaleTimeString(), msg, type }]);
  }

  const [mapsSearches, setMapsSearchesState] = useState(() => {
    try { const s = localStorage.getItem('mapsSearches'); return s ? JSON.parse(s) : []; } catch { return []; }
  });

  function setMapsSearches(searches) { setMapsSearchesState(searches); localStorage.setItem('mapsSearches', JSON.stringify(searches)); }

  function addMapsRun(runId) {
    const newRun = { runId, startedAt: new Date().toISOString(), leads: [], status: 'running' };
    setMapsRunsState(prev => { const u = [...prev, newRun]; localStorage.setItem('mapsRuns', JSON.stringify(u)); return u; });
    setActiveMapsRunId(runId);
  }
  function addLeadToMapsRun(runId, lead) {
    setMapsRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r); localStorage.setItem('mapsRuns', JSON.stringify(u)); return u; });
  }
  function completeMapsRun(runId) {
    setMapsRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, status: 'done' } : r); localStorage.setItem('mapsRuns', JSON.stringify(u)); return u; });
  }
  function deleteMapsRun(runId) {
    setMapsRunsState(prev => { const u = prev.filter(r => r.runId !== runId); localStorage.setItem('mapsRuns', JSON.stringify(u)); return u; });
  }

  const [pipelineStatus, setPipelineStatus] = useState('idle');
  const [pipelineRuns, setPipelineRunsState] = useState(() => {
    try { const s = localStorage.getItem('pipelineRuns'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [activeRunId, setActiveRunId] = useState(null);

  const LEGACY_RANGE_MAP = { A: '1,10', B: '11,50', C: '51,200', D: '201,500', E: '501,1000', F: '1001,5000', G: '5001,10000', H: '10001' };
  const DEFAULT_EMPLOYEE_RANGES = ['11,50', '51,200', '201,500'];

  const [targetLocations, setTargetLocationsState] = useState(localStorage.getItem('targetLocations') || 'United States');
  const [employeeRanges, setEmployeeRangesState] = useState(() => {
    try {
      const s = localStorage.getItem('employeeRanges');
      if (!s) return DEFAULT_EMPLOYEE_RANGES;
      const parsed = JSON.parse(s);
      const migrated = parsed.map(v => LEGACY_RANGE_MAP[v] || v).filter(v => /^\d+(,\d+)?$/.test(v));
      return migrated.length ? migrated : DEFAULT_EMPLOYEE_RANGES;
    } catch { return DEFAULT_EMPLOYEE_RANGES; }
  });

  function setTargetLocations(v) { setTargetLocationsState(v); localStorage.setItem('targetLocations', v); }
  function setEmployeeRanges(v) { setEmployeeRangesState(v); localStorage.setItem('employeeRanges', JSON.stringify(v)); }

  function addPipelineRun(runId) {
    const newRun = { runId, startedAt: new Date().toISOString(), leads: [], status: 'running' };
    setPipelineRunsState(prev => { const u = [...prev, newRun]; localStorage.setItem('pipelineRuns', JSON.stringify(u)); return u; });
    setActiveRunId(runId);
    return newRun;
  }
  function addLeadToRun(runId, lead) {
    setPipelineRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r); localStorage.setItem('pipelineRuns', JSON.stringify(u)); return u; });
  }
  function completeRun(runId) {
    setPipelineRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, status: 'done' } : r); localStorage.setItem('pipelineRuns', JSON.stringify(u)); return u; });
  }
  function deleteRun(runId) {
    setPipelineRunsState(prev => { const u = prev.filter(r => r.runId !== runId); localStorage.setItem('pipelineRuns', JSON.stringify(u)); return u; });
  }

  const [pipelineLogs,     setPipelineLogs]     = useState([]);
  const [pipelineProgress, setPipelineProgress] = useState(null);
  const abortRef = useRef(null);

  // ── Setters ────────────────────────────────────────────────────────
  function setConnectSafelyKey(key) { setConnectSafelyKeyState(key); localStorage.setItem("connectSafelyKey", key); }
  function setAccountId(id)         { setAccountIdState(id);         localStorage.setItem("accountId", id); }
  function setKeywords(kws)         { setKeywordsState(kws);         localStorage.setItem("keywords", JSON.stringify(kws)); }
  function setPipelineSettings(s)   { setPipelineSettingsState(s);   localStorage.setItem("pipelineSettings", JSON.stringify(s)); }

  function setApolloKey(v)    { setApolloKeyState(v);    localStorage.setItem('apolloKey', v); }
  function setHunterKey(v)    { setHunterKeyState(v);    localStorage.setItem('hunterKey', v); }
  function setApifyKey(v)     { setApifyKeyState(v);     localStorage.setItem('apifyKey', v); }
  function setSerperKey(v)    { setSerperKeyState(v);    localStorage.setItem('serperKey', v); }
  function setFirecrawlKey(v) { setFirecrawlKeyState(v); localStorage.setItem('firecrawlKey', v); }

  function setPbApiKey(v)          { setPbApiKeyState(v);          localStorage.setItem('pbApiKey', v); }
  function setPbActivityAgentId(v) { setPbActivityAgentIdState(v); localStorage.setItem('pbActivityAgentId', v); }
  function setPbProfileAgentId(v)  { setPbProfileAgentIdState(v);  localStorage.setItem('pbProfileAgentId', v); }
  function setPbLinkedinCookie(v)  { setPbLinkedinCookieState(v);  localStorage.setItem('pbLinkedinCookie', v); }

  function setProductDescription(v) { setProductDescriptionState(v); localStorage.setItem('productDescription', v); }
  function setTargetAudience(v)     { setTargetAudienceState(v);     localStorage.setItem('targetAudience', v); }
  function setTargetIndustries(v)   { setTargetIndustriesState(v);   localStorage.setItem('targetIndustries', JSON.stringify(v)); }
  function setTargetTechnologies(v) { setTargetTechnologiesState(v); localStorage.setItem('targetTechnologies', JSON.stringify(v)); }
  function setTargetJobTitles(v)    { setTargetJobTitlesState(v);    localStorage.setItem('targetJobTitles', v); }
  function setMinCompanyScore(v)    { setMinCompanyScoreState(v);    localStorage.setItem('minCompanyScore', String(v)); }

  function addOutreachRun(runId) {
    const newRun = { runId, startedAt: new Date().toISOString(), companies: [], leads: [], status: 'running' };
    setOutreachRunsState(prev => { const u = [...prev, newRun]; localStorage.setItem('outreachRuns', JSON.stringify(u)); return u; });
    setActiveOutreachRunId(runId);
  }
  function addCompanyToRun(runId, company) {
    setOutreachRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, companies: [...r.companies, company] } : r); localStorage.setItem('outreachRuns', JSON.stringify(u)); return u; });
  }
  function addLeadToOutreachRun(runId, lead) {
    setOutreachRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r); localStorage.setItem('outreachRuns', JSON.stringify(u)); return u; });
  }
  function completeOutreachRun(runId) {
    setOutreachRunsState(prev => { const u = prev.map(r => r.runId === runId ? { ...r, status: 'done' } : r); localStorage.setItem('outreachRuns', JSON.stringify(u)); return u; });
  }
  function deleteOutreachRun(runId) {
    setOutreachRunsState(prev => { const u = prev.filter(r => r.runId !== runId); localStorage.setItem('outreachRuns', JSON.stringify(u)); return u; });
  }

  const isOutreachConfigured = true;

  function saveSettings(key, id) { setConnectSafelyKey(key); setAccountId(id); }

  function addLog(msg, type = 'info') {
    setPipelineLogs(prev => [...prev.slice(-99), { time: new Date().toLocaleTimeString(), msg, type }]);
  }

  const isConfigured = true;

  return (
    <SettingsContext.Provider value={{
      connectSafelyKey, setConnectSafelyKey,
      accountId, setAccountId,
      saveSettings,
      keywords, setKeywords, DEFAULT_KEYWORDS,
      pipelineSettings, setPipelineSettings,
      apolloKey, setApolloKey,
      hunterKey, setHunterKey,
      apifyKey,  setApifyKey,
      serperKey,    setSerperKey,
      firecrawlKey, setFirecrawlKey,
      productDescription, setProductDescription,
      targetAudience, setTargetAudience,
      targetIndustries, setTargetIndustries,
      targetTechnologies, setTargetTechnologies,
      targetJobTitles, setTargetJobTitles,
      minCompanyScore, setMinCompanyScore,
      isOutreachConfigured,
      outreachRuns, activeOutreachRunId, setActiveOutreachRunId,
      addOutreachRun, addCompanyToRun, addLeadToOutreachRun, completeOutreachRun, deleteOutreachRun,
      outreachStatus, setOutreachStatus, outreachLogs, setOutreachLogs, addOutreachLog,
      targetLocations, setTargetLocations,
      employeeRanges, setEmployeeRanges,
      isConfigured,
      mapsRuns, activeMapsRunId, setActiveMapsRunId,
      addMapsRun, addLeadToMapsRun, completeMapsRun, deleteMapsRun,
      mapsSearches, setMapsSearches,
      mapsStatus, setMapsStatus, mapsLogs, setMapsLogs, addMapsLog,
      pipelineStatus, setPipelineStatus,
      pipelineRuns, activeRunId, setActiveRunId,
      addPipelineRun, addLeadToRun, completeRun, deleteRun,
      pipelineLogs, setPipelineLogs, pipelineProgress, setPipelineProgress,
      abortRef, addLog,
      pbApiKey, setPbApiKey,
      pbActivityAgentId, setPbActivityAgentId,
      pbProfileAgentId, setPbProfileAgentId,
      pbLinkedinCookie, setPbLinkedinCookie,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}