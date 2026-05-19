import { createContext, useContext, useState, useRef } from "react";

const SettingsContext = createContext();

export const DEFAULT_KEYWORDS = [
  { keyword: "struggling with lead generation" },
  { keyword: "can't find qualified leads" },
  { keyword: "our sales pipeline is dry" },
  { keyword: "looking for a prospecting tool" },
  { keyword: "need more B2B leads" },
  { keyword: "using AI for sales outreach" },
  { keyword: "automate LinkedIn outreach" },
  { keyword: "hiring SDR" },
  { keyword: "scaling our sales team" },
  { keyword: "just launched our product" },
];

export function SettingsProvider({ children }) {
  // ── Credentials ────────────────────────────────────────────────────
  const [connectSafelyKey, setConnectSafelyKeyState] = useState(
    localStorage.getItem("connectSafelyKey") || ""
  );
  const [accountId, setAccountIdState] = useState(
    localStorage.getItem("accountId") || ""
  );

  // ── Keywords ───────────────────────────────────────────────────────
  const [keywords, setKeywordsState] = useState(() => {
    try {
      const stored = localStorage.getItem("keywords");
      return stored ? JSON.parse(stored) : DEFAULT_KEYWORDS;
    } catch {
      return DEFAULT_KEYWORDS;
    }
  });

  // ── Pipeline Settings ──────────────────────────────────────────────
  const [pipelineSettings, setPipelineSettingsState] = useState(() => {
    try {
      const stored = localStorage.getItem("pipelineSettings");
      return stored ? JSON.parse(stored) : {
        postLimit: 20,
        commentLimit: 100,
        datePosted: 'past-month',
        minScore: 6,
      };
    } catch {
      return { postLimit: 20, commentLimit: 100, datePosted: 'past-month', minScore: 6 };
    }
  });

  // ── Outreach API Keys ──────────────────────────────────────────────
  const [apolloKey, setApolloKeyState] = useState(
    localStorage.getItem('apolloKey') || ''
  );
  const [hunterKey, setHunterKeyState] = useState(
    localStorage.getItem('hunterKey') || ''
  );
  const [apifyKey, setApifyKeyState] = useState(
    localStorage.getItem('apifyKey') || ''
  );


  const [pbApiKey, setPbApiKeyState] = useState(
  localStorage.getItem('pbApiKey') || ''
  );
  const [pbActivityAgentId, setPbActivityAgentIdState] = useState(
    localStorage.getItem('pbActivityAgentId') || ''
  );
  const [pbProfileAgentId, setPbProfileAgentIdState] = useState(
    localStorage.getItem('pbProfileAgentId') || ''
  );
  const [pbLinkedinCookie, setPbLinkedinCookieState] = useState(
    localStorage.getItem('pbLinkedinCookie') || ''
  );


  const [productDescription, setProductDescriptionState] = useState(
    localStorage.getItem('productDescription') || ''
  );
  const [targetAudience, setTargetAudienceState] = useState(
    localStorage.getItem('targetAudience') || ''
  );
  const [targetJobTitles, setTargetJobTitlesState] = useState(
    localStorage.getItem('targetJobTitles') || 'CEO, Founder, CTO, VP of Engineering'
  );
  const [minCompanyScore, setMinCompanyScoreState] = useState(
    Number(localStorage.getItem('minCompanyScore')) || 7
  );

  // ── Outreach Runtime State ─────────────────────────────────────────
  const [outreachRuns, setOutreachRunsState] = useState(() => {
    try {
      const stored = localStorage.getItem('outreachRuns');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [activeOutreachRunId, setActiveOutreachRunId] = useState(null);
  const [outreachStatus, setOutreachStatus] = useState('idle');
  const [outreachLogs, setOutreachLogs] = useState([]);

  function addOutreachLog(msg, type = 'info') {
    setOutreachLogs(prev => [...prev.slice(-99), {
      time: new Date().toLocaleTimeString(),
      msg,
      type,
    }]);
  }

  // ── Maps Runtime State ─────────────────────────────────────────────
  const [mapsRuns, setMapsRunsState] = useState(() => {
    try {
      const stored = localStorage.getItem('mapsRuns');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [activeMapsRunId, setActiveMapsRunId] = useState(null);
  const [mapsStatus, setMapsStatus] = useState('idle');
  const [mapsLogs, setMapsLogs] = useState([]);

  function addMapsLog(msg, type = 'info') {
    setMapsLogs(prev => [...prev.slice(-99), {
      time: new Date().toLocaleTimeString(),
      msg,
      type,
    }]);
  }

  // Maps searches config
  const [mapsSearches, setMapsSearchesState] = useState(() => {
    try {
      const stored = localStorage.getItem('mapsSearches');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  function setMapsSearches(searches) {
    setMapsSearchesState(searches);
    localStorage.setItem('mapsSearches', JSON.stringify(searches));
  }

  function addMapsRun(runId) {
    const newRun = {
      runId,
      startedAt: new Date().toISOString(),
      leads: [],
      status: 'running',
    };
    setMapsRunsState(prev => {
      const updated = [...prev, newRun];
      localStorage.setItem('mapsRuns', JSON.stringify(updated));
      return updated;
    });
    setActiveMapsRunId(runId);
  }

  function addLeadToMapsRun(runId, lead) {
    setMapsRunsState(prev => {
      const updated = prev.map(r =>
        r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r
      );
      localStorage.setItem('mapsRuns', JSON.stringify(updated));
      return updated;
    });
  }

  function completeMapsRun(runId) {
    setMapsRunsState(prev => {
      const updated = prev.map(r =>
        r.runId === runId ? { ...r, status: 'done' } : r
      );
      localStorage.setItem('mapsRuns', JSON.stringify(updated));
      return updated;
    });
  }

  function deleteMapsRun(runId) {
    setMapsRunsState(prev => {
      const updated = prev.filter(r => r.runId !== runId);
      localStorage.setItem('mapsRuns', JSON.stringify(updated));
      return updated;
    });
  }

  // ── Pipeline Runtime State (persists across page navigation) ───────
  const [pipelineStatus, setPipelineStatus] = useState('idle');
  const [pipelineRuns, setPipelineRunsState] = useState(() => {
  try {
    const stored = localStorage.getItem('pipelineRuns');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
});
const [activeRunId, setActiveRunId] = useState(null);

const [targetLocations, setTargetLocationsState] = useState(
  localStorage.getItem('targetLocations') || 'United States'
);
// Apollo's `organization_num_employees_ranges` expects comma-separated
// numeric ranges (e.g. "11,50"), not the old letter codes (A-H) this
// app started with. Migrate any legacy values left in localStorage.
const LEGACY_RANGE_MAP = {
  A: '1,10',     B: '11,50',     C: '51,200',     D: '201,500',
  E: '501,1000', F: '1001,5000', G: '5001,10000', H: '10001',
};
const DEFAULT_EMPLOYEE_RANGES = ['11,50', '51,200', '201,500'];

const [employeeRanges, setEmployeeRangesState] = useState(() => {
  try {
    const stored = localStorage.getItem('employeeRanges');
    if (!stored) return DEFAULT_EMPLOYEE_RANGES;
    const parsed = JSON.parse(stored);
    const migrated = parsed
      .map(v => LEGACY_RANGE_MAP[v] || v)
      .filter(v => /^\d+(,\d+)?$/.test(v));
    return migrated.length ? migrated : DEFAULT_EMPLOYEE_RANGES;
  } catch { return DEFAULT_EMPLOYEE_RANGES; }
});

function setTargetLocations(v) { setTargetLocationsState(v); localStorage.setItem('targetLocations', v); }
function setEmployeeRanges(v) { setEmployeeRangesState(v); localStorage.setItem('employeeRanges', JSON.stringify(v)); }



function addPipelineRun(runId) {
  const newRun = {
    runId,
    startedAt: new Date().toISOString(),
    leads: [],
    status: 'running',
  };
  setPipelineRunsState(prev => {
    const updated = [...prev, newRun];
    localStorage.setItem('pipelineRuns', JSON.stringify(updated));
    return updated;
  });
  setActiveRunId(runId);
  return newRun;
}

function addLeadToRun(runId, lead) {
  setPipelineRunsState(prev => {
    const updated = prev.map(r =>
      r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r
    );
    localStorage.setItem('pipelineRuns', JSON.stringify(updated));
    return updated;
  });
}

function completeRun(runId) {
  setPipelineRunsState(prev => {
    const updated = prev.map(r =>
      r.runId === runId ? { ...r, status: 'done' } : r
    );
    localStorage.setItem('pipelineRuns', JSON.stringify(updated));
    return updated;
  });
}

function deleteRun(runId) {
  setPipelineRunsState(prev => {
    const updated = prev.filter(r => r.runId !== runId);
    localStorage.setItem('pipelineRuns', JSON.stringify(updated));
    return updated;
  });
}
  const [pipelineLogs, setPipelineLogs] = useState([]);
  const [pipelineProgress, setPipelineProgress] = useState(null);
  const abortRef = useRef(null);

  // ── Setters ────────────────────────────────────────────────────────
  function setConnectSafelyKey(key) {
    setConnectSafelyKeyState(key);
    localStorage.setItem("connectSafelyKey", key);
  }

  function setAccountId(id) {
    setAccountIdState(id);
    localStorage.setItem("accountId", id);
  }

  function setKeywords(kws) {
    setKeywordsState(kws);
    localStorage.setItem("keywords", JSON.stringify(kws));
  }

  function setPipelineSettings(settings) {
    setPipelineSettingsState(settings);
    localStorage.setItem("pipelineSettings", JSON.stringify(settings));
  }
  
  // ── Outreach Setters ───────────────────────────────────────────────
  function setApolloKey(v) { setApolloKeyState(v); localStorage.setItem('apolloKey', v); }
  function setHunterKey(v) { setHunterKeyState(v); localStorage.setItem('hunterKey', v); }
  function setApifyKey(v) { setApifyKeyState(v); localStorage.setItem('apifyKey', v); }

  function setPbApiKey(v) { setPbApiKeyState(v); localStorage.setItem('pbApiKey', v); }
  function setPbActivityAgentId(v) { setPbActivityAgentIdState(v); localStorage.setItem('pbActivityAgentId', v); }
  function setPbProfileAgentId(v) { setPbProfileAgentIdState(v); localStorage.setItem('pbProfileAgentId', v); }
  function setPbLinkedinCookie(v) { setPbLinkedinCookieState(v); localStorage.setItem('pbLinkedinCookie', v); }
 
  function setProductDescription(v) { setProductDescriptionState(v); localStorage.setItem('productDescription', v); }
  function setTargetAudience(v) { setTargetAudienceState(v); localStorage.setItem('targetAudience', v); }
  function setTargetJobTitles(v) { setTargetJobTitlesState(v); localStorage.setItem('targetJobTitles', v); }
  function setMinCompanyScore(v) { setMinCompanyScoreState(v); localStorage.setItem('minCompanyScore', String(v)); }

  function addOutreachRun(runId) {
    const newRun = {
      runId,
      startedAt: new Date().toISOString(),
      companies: [],
      leads: [],
      status: 'running',
    };
    setOutreachRunsState(prev => {
      const updated = [...prev, newRun];
      localStorage.setItem('outreachRuns', JSON.stringify(updated));
      return updated;
    });
    setActiveOutreachRunId(runId);
  }

  function addCompanyToRun(runId, company) {
    setOutreachRunsState(prev => {
      const updated = prev.map(r =>
        r.runId === runId ? { ...r, companies: [...r.companies, company] } : r
      );
      localStorage.setItem('outreachRuns', JSON.stringify(updated));
      return updated;
    });
  }

  function addLeadToOutreachRun(runId, lead) {
    setOutreachRunsState(prev => {
      const updated = prev.map(r =>
        r.runId === runId ? { ...r, leads: [...r.leads, lead] } : r
      );
      localStorage.setItem('outreachRuns', JSON.stringify(updated));
      return updated;
    });
  }

  function completeOutreachRun(runId) {
    setOutreachRunsState(prev => {
      const updated = prev.map(r =>
        r.runId === runId ? { ...r, status: 'done' } : r
      );
      localStorage.setItem('outreachRuns', JSON.stringify(updated));
      return updated;
    });
  }

  function deleteOutreachRun(runId) {
    setOutreachRunsState(prev => {
      const updated = prev.filter(r => r.runId !== runId);
      localStorage.setItem('outreachRuns', JSON.stringify(updated));
      return updated;
    });
  }

  const isOutreachConfigured = Boolean(
    apolloKey.trim() && hunterKey.trim() && apifyKey.trim() &&
    productDescription.trim() && targetAudience.trim()
  );

  function saveSettings(key, id) {
    setConnectSafelyKey(key);
    setAccountId(id);
  }

  function addLog(msg, type = 'info') {
    setPipelineLogs(prev => [...prev.slice(-99), {
      time: new Date().toLocaleTimeString(),
      msg,
      type,
    }]);
  }

  const isConfigured = Boolean(connectSafelyKey.trim() && accountId.trim());

  return (
    <SettingsContext.Provider
      value={{
        // Credentials
        connectSafelyKey,
        setConnectSafelyKey,
        accountId,
        setAccountId,
        saveSettings,

        // Keywords
        keywords,
        setKeywords,
        DEFAULT_KEYWORDS,

        // Pipeline config
        pipelineSettings,
        setPipelineSettings,

        // Outreach API keys
        apolloKey, setApolloKey,
        hunterKey, setHunterKey,
        apifyKey, setApifyKey,
        productDescription, setProductDescription,
        targetAudience, setTargetAudience,
        targetJobTitles, setTargetJobTitles,
        minCompanyScore, setMinCompanyScore,
        isOutreachConfigured,

        // Outreach runtime
        outreachRuns,
        activeOutreachRunId,
        setActiveOutreachRunId,
        addOutreachRun,
        addCompanyToRun,
        addLeadToOutreachRun,
        completeOutreachRun,
        deleteOutreachRun,
        outreachStatus,
        setOutreachStatus,
        outreachLogs,
        setOutreachLogs,
        addOutreachLog,
        targetLocations, setTargetLocations,
        employeeRanges, setEmployeeRanges,
        // Auth check
        isConfigured,

        mapsRuns,
        activeMapsRunId,
        setActiveMapsRunId,
        addMapsRun,
        addLeadToMapsRun,
        completeMapsRun,
        deleteMapsRun,
        mapsSearches,
        setMapsSearches,
        mapsStatus,
        setMapsStatus,
        mapsLogs,
        setMapsLogs,
        addMapsLog,

        // Pipeline runtime (persists across navigation)
        pipelineStatus,
        setPipelineStatus,
        pipelineRuns,
        activeRunId,
        setActiveRunId,
        addPipelineRun,
        addLeadToRun,
        completeRun,
        deleteRun,
        pipelineLogs,
        setPipelineLogs,
        pipelineProgress,
        setPipelineProgress,
        abortRef,
        addLog,

        pbApiKey, setPbApiKey,
        pbActivityAgentId, setPbActivityAgentId,
        pbProfileAgentId, setPbProfileAgentId,
        pbLinkedinCookie, setPbLinkedinCookie,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}