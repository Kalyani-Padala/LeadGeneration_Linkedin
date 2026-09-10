import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import CompanySummary, { companyCacheGet, companyCacheClear } from '../components/CompanySummary.jsx';

// ── Profile cache helpers ─────────────────────────────────────────────
const PROFILE_CACHE = 'apify_summary_cache_';

function profileCacheGet(url)       { try { const r = localStorage.getItem(PROFILE_CACHE + url); return r ? JSON.parse(r) : null; } catch { return null; } }
function profileCacheSet(url, data) { try { localStorage.setItem(PROFILE_CACHE + url, JSON.stringify(data)); } catch {} }
function profileCacheClear(url)     { try { localStorage.removeItem(PROFILE_CACHE + url); } catch {} }

// ── Profile in-flight fetch ───────────────────────────────────────────
const profileFlights = {};

async function startProfileFetch(url) {
  const flight = profileFlights[url];
  if (!flight) return;
  try {
    const res = await fetch('/api/apify-summary/profile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ profileUrl: url, apifyToken: localStorage.getItem('apifyKey') || '' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Lookup failed');
    profileCacheSet(url, data);
    profileFlights[url]?.callbacks.forEach(cb => cb(data, null));
  } catch (err) {
    profileFlights[url]?.callbacks.forEach(cb => cb(null, err.message));
  } finally {
    delete profileFlights[url];
  }
}

function attachProfileFetch(url, onDone) {
  if (!profileFlights[url]) {
    profileFlights[url] = { callbacks: [] };
    profileFlights[url].callbacks.push(onDone);
    startProfileFetch(url);
  } else {
    profileFlights[url].callbacks.push(onDone);
  }
  return () => {
    if (profileFlights[url]) {
      profileFlights[url].callbacks = profileFlights[url].callbacks.filter(cb => cb !== onDone);
    }
  };
}

function isValidLinkedIn(url) { return /linkedin\.com\/in\/[^/]+/.test(url); }
function urlToName(url)        { return url.replace(/\/$/, '').split('/in/')[1] || url; }

// ─────────────────────────────────────────────────────────────────────
//   useHistory — localStorage-backed list state (defined early so Lookup can use it)
// ─────────────────────────────────────────────────────────────────────

function useHistory(lsKey) {
  const [history, setHistory] = useState(() => {
    try { const s = localStorage.getItem(lsKey); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  function save(updater) {
    setHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem(lsKey, JSON.stringify(next));
      return next;
    });
  }
  return [history, save];
}

// ─────────────────────────────────────────────────────────────────────
//   Root page — owns ALL active selection AND history state
//   FIX: history is now lifted up so sidebar + main share the same
//        source of truth; cached badges update immediately.
// ─────────────────────────────────────────────────────────────────────

export default function Lookup() {
  const [tab, setTab] = useState(() => localStorage.getItem('lookup_tab') || 'profile');

  // Lifted: profile active URL
  const [activeUrl, setActiveUrl] = useState(() => {
    try { const s = localStorage.getItem('lookup_activeUrl'); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  // Lifted: company active key
  const [activeKey, setActiveKey] = useState(() => {
    try { const s = localStorage.getItem('company_activeKey'); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  // Lifted: histories (single source of truth shared by sidebar + main)
  const [profileHistory, setProfileHistory] = useHistory('lookup_history');
  const [companyHistory, setCompanyHistory] = useHistory('company_history');

  useEffect(() => { localStorage.setItem('lookup_tab', tab); }, [tab]);
  useEffect(() => {
    activeUrl == null ? localStorage.removeItem('lookup_activeUrl') : localStorage.setItem('lookup_activeUrl', JSON.stringify(activeUrl));
  }, [activeUrl]);
  useEffect(() => {
    activeKey == null ? localStorage.removeItem('company_activeKey') : localStorage.setItem('company_activeKey', JSON.stringify(activeKey));
  }, [activeKey]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
      <div style={{ width: 280, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>INTELLIGENCE</div>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>Lookup</div>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'profile', label: '👤 Profile' },
            { key: 'company', label: '🏢 Company' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '9px 0',
                background: tab === t.key ? 'var(--accent-dim)' : 'transparent',
                borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === t.key ? 'var(--accent)' : 'var(--text3)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.08em', cursor: 'pointer',
                textTransform: 'uppercase', transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'profile'
          ? <ProfileSidebar
              activeUrl={activeUrl} setActiveUrl={setActiveUrl}
              history={profileHistory} setHistory={setProfileHistory}
            />
          : <CompanySidebar
              activeKey={activeKey} setActiveKey={setActiveKey}
              history={companyHistory} setHistory={setCompanyHistory}
            />
        }
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        {tab === 'profile'
          ? <ProfileMain activeUrl={activeUrl} setHistory={setProfileHistory} />
          : <CompanyMain activeKey={activeKey} setHistory={setCompanyHistory} />
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Profile tab
// ─────────────────────────────────────────────────────────────────────

function ProfileSidebar({ activeUrl, setActiveUrl, history, setHistory }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function handleLookup(urlOverride) {
    const url = (urlOverride || input).trim().replace(/\/$/, '');
    setError('');
    if (!url)                  { setError('Paste a LinkedIn profile URL first.'); return; }
    if (!isValidLinkedIn(url)) { setError('Must be a LinkedIn URL — e.g. linkedin.com/in/username'); return; }
    setHistory(prev => {
      if (prev.find(h => h.url === url)) return prev;
      return [{ url, cachedAt: profileCacheGet(url) ? Date.now() : null }, ...prev].slice(0, 20);
    });
    setActiveUrl(url);
    setInput('');
  }

  return (
    <SidebarShell
      placeholder="linkedin.com/in/username"
      input={input} onInput={setInput}
      onSubmit={() => handleLookup()}
      error={error}
      emptyMsg={<>Paste a LinkedIn URL above<br />to look up a profile.</>}
      history={history}
      activeKey={activeUrl}
      onSelect={setActiveUrl}
      onRefresh={url => { profileCacheClear(url); setHistory(prev => prev.map(h => h.url === url ? { ...h, cachedAt: null } : h)); setActiveUrl(url); }}
      onRemove={url  => { profileCacheClear(url); setHistory(prev => prev.filter(h => h.url !== url)); if (activeUrl === url) setActiveUrl(null); }}
      getKey={h => h.url}
      getLabel={h => urlToName(h.url)}
      isCached={h => Boolean(profileCacheGet(h.url))}
      noun="profile"
    />
  );
}

function ProfileMain({ activeUrl, setHistory }) {
  if (!activeUrl) return (
    <EmptyState
      icon="🔍"
      title="Look up a LinkedIn profile"
      body={<>Paste a LinkedIn profile URL on the left.<br />Get a full AI dossier — career story, interests,<br />outreach hook, talking points, icebreakers.<br /><br />Results are cached in your browser.</>}
    />
  );

  return (
    <LookupSummary
      key={activeUrl}
      profileUrl={activeUrl}
      onCached={() => setHistory(prev => prev.map(h => h.url === activeUrl ? { ...h, cachedAt: Date.now() } : h))}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Company tab
// ─────────────────────────────────────────────────────────────────────

function CompanySidebar({ activeKey, setActiveKey, history, setHistory }) {
  const { serperKey, firecrawlKey } = useSettings();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  function handleLookup(nameOverride) {
    const name = (nameOverride || input).trim();
    setError('');
    if (!name) { setError('Enter a company name first.'); return; }
    setHistory(prev => {
      if (prev.find(h => h.name === name)) return prev;
      return [{ name, cachedAt: companyCacheGet(name) ? Date.now() : null }, ...prev].slice(0, 20);
    });
    setActiveKey(name);
    setInput('');
  }

  return (
    <SidebarShell
      placeholder="e.g. Pipedrive"
      input={input} onInput={setInput}
      onSubmit={() => handleLookup()}
      error={error}
      emptyMsg={<>Enter a company name above<br />to get an intelligence report.</>}
      history={history}
      activeKey={activeKey}
      onSelect={setActiveKey}
      onRefresh={name => { companyCacheClear(name); setHistory(prev => prev.map(h => h.name === name ? { ...h, cachedAt: null } : h)); setActiveKey(name); }}
      onRemove={name  => { companyCacheClear(name); setHistory(prev => prev.filter(h => h.name !== name)); if (activeKey === name) setActiveKey(null); }}
      getKey={h => h.name}
      getLabel={h => h.name}
      isCached={h => Boolean(companyCacheGet(h.name))}
      noun="company"
      nounPlural="companies"
    />
  );
}

function CompanyMain({ activeKey, setHistory }) {
  const { serperKey, firecrawlKey } = useSettings();

  if (!activeKey) return (
    <EmptyState
      icon="🏢"
      title="Company Intelligence"
      body={<>Enter any company name to get a full intelligence report.<br />Includes financials, key people, products, customers,<br />hiring signals, tech stack, and outreach angles.<br /><br />Powered by Serper + Firecrawl + Azure OpenAI.</>}
    />
  );

  return (
    <CompanySummary
      key={activeKey}
      companyName={activeKey}
      serperKey={serperKey}
      firecrawlKey={firecrawlKey}
      onCached={() => setHistory(prev => prev.map(h => h.name === activeKey ? { ...h, cachedAt: Date.now() } : h))}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//   LookupSummary — profile fetch + dossier render (no stop button)
// ─────────────────────────────────────────────────────────────────────

function LookupSummary({ profileUrl, onCached }) {
  const [state,  setState]  = useState(() => profileCacheGet(profileUrl) ? 'done' : 'loading');
  const [result, setResult] = useState(() => profileCacheGet(profileUrl) || null);
  const [error,  setError]  = useState('');
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const cached = profileCacheGet(profileUrl);
    if (cached) { setState('done'); setResult(cached); onCached?.(); return; }
    setState('loading'); setResult(null); setError('');
    const cleanup = attachProfileFetch(profileUrl, (data, err) => {
      if (!mounted.current) return;
      if (err) { setError(err); setState('error'); }
      else     { setResult(data); setState('done'); onCached?.(); }
    });
    return cleanup;
  }, [profileUrl]);

  function refresh() {
    profileCacheClear(profileUrl);
    setResult(null); setError(''); setState('loading');
    profileFlights[profileUrl] = { callbacks: [] };
    profileFlights[profileUrl].callbacks.push((data, err) => {
      if (!mounted.current) return;
      if (err) { setError(err); setState('error'); }
      else     { setResult(data); setState('done'); onCached?.(); }
    });
    startProfileFetch(profileUrl);
  }

  const name = urlToName(profileUrl);

  if (state === 'loading') return (
    <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 18, color: 'var(--accent)' }}>◌</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>Scraping LinkedIn profile for {name}...</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>This usually takes about a minute — you can switch tabs and come back</div>
      </div>
    </div>
  );

  if (state === 'error') return (
    <div style={{ padding: 40, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#ff4455' }}>✕ {error}</span>
      <button onClick={refresh} style={btnStyle('info')}>Try again</button>
    </div>
  );

  if (!result) return null;

  const p  = result.profile || {};
  const s  = result.summary || {};
  const st = result.stats   || {};
  const o  = s.outreach     || {};

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>AI DOSSIER</div>
          <h1 style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-0.5px', marginBottom: 4 }}>{p.name || name}</h1>
          {p.title && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{p.title}{p.company ? ` @ ${p.company}` : ''}{p.location ? ` · ${p.location}` : ''}</div>}
          {p.email && <div style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>✉ {p.email}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={refresh} style={btnStyle('info')}>↺ Refresh</button>
          {p.profileUrl && <a href={p.profileUrl} target="_blank" rel="noreferrer" style={{ padding: '6px 14px', background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 11, textDecoration: 'none' }}>↗ LinkedIn</a>}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)' }} />
      {s.summary           && <PBlock label="WHO THEY ARE"         body={s.summary} />}
      {s.careerStory       && <PBlock label="CAREER STORY"          body={s.careerStory} />}
      {s.activityNarrative && <PBlock label="WHAT THEY TALK ABOUT"  body={s.activityNarrative} />}
      {(s.expertise?.length > 0 || s.interests?.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {s.expertise?.length > 0 && <TagBlock label="EXPERTISE" items={s.expertise} color="accent" />}
          {s.interests?.length > 0 && <TagBlock label="INTERESTS"  items={s.interests}  color="info"   />}
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--border)' }} />
      {(o.hook || o.talkingPoints?.length > 0 || o.icebreakers?.length > 0 || o.bestAngle) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ffb44d', letterSpacing: '0.12em' }}>OUTREACH GUIDE</div>
          {o.hook && <TintBlock label="OPENING HOOK" tint="warm"><span style={{ fontStyle: 'italic' }}>"{o.hook}"</span></TintBlock>}
          {o.talkingPoints?.length > 0 && <NumList label="TALKING POINTS" items={o.talkingPoints} bulletColor="var(--info)" />}
          {o.icebreakers?.length   > 0 && <NumList label="ICEBREAKERS"    items={o.icebreakers}   bulletChar="?"  bulletColor="var(--accent)" />}
          {o.bestAngle && <TintBlock label="BEST APPROACH" tint="accent">{o.bestAngle}</TintBlock>}
        </div>
      )}
      <div style={{ borderTop: '1px solid var(--border)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
        <span>📝 {st.postsCount ?? 0} posts</span>
        <span>💬 {st.commentsCount ?? 0} comments</span>
        <span>👍 {st.reactedCount ?? 0} reactions</span>
        <span>📊 {st.totalActivity ?? 0} total activity</span>
        {result.meta?.scrapedAt && <span>🕐 {new Date(result.meta.scrapedAt).toLocaleString()}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Shared sidebar shell
// ─────────────────────────────────────────────────────────────────────

function SidebarShell({ placeholder, input, onInput, onSubmit, error, emptyMsg, history, activeKey, onSelect, onRefresh, onRemove, getKey, getLabel, isCached, noun, nounPlural }) {
  const plural = nounPlural ?? `${noun}s`;
  return (
    <>
      <div style={{ padding: '14px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={input} onChange={e => onInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSubmit()}
            placeholder={placeholder}
            style={{ flex: 1, padding: '8px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
          />
          <button onClick={onSubmit} style={{ padding: '8px 12px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', cursor: 'pointer', flexShrink: 0 }}>→</button>
        </div>
        {error && <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ff4455' }}>{error}</div>}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {history.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>{emptyMsg}</div>
        ) : history.map(item => {
          const key      = getKey(item);
          const label    = getLabel(item);
          const isActive = activeKey === key;
          const cached   = isCached(item);
          return (
            <div
              key={key} onClick={() => onSelect(key)}
              style={{ padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--accent-dim)' : 'transparent', borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.1s', display: 'flex', flexDirection: 'column', gap: 3 }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={e => { e.stopPropagation(); onRefresh(key); }} title="Re-fetch" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, padding: '0 2px' }}>↺</button>
                  <button onClick={e => { e.stopPropagation(); onRemove(key);  }} title="Remove"   style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, padding: '0 2px' }}>×</button>
                </div>
              </div>
              <div>
                {cached
                  ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent)', background: 'rgba(0,229,160,0.1)', border: '1px solid rgba(0,229,160,0.2)', padding: '1px 6px', borderRadius: 10 }}>✓ CACHED</span>
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>NOT FETCHED</span>
                }
              </div>
            </div>
          );
        })}
      </div>

      {history.length > 0 && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
          {history.length} {history.length !== 1 ? plural : noun} · cached in browser
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//   Small UI helpers
// ─────────────────────────────────────────────────────────────────────

function btnStyle(variant = 'info') {
  const colors = {
    info:   { color: 'var(--info)', border: 'rgba(77,159,255,0.3)' },
    danger: { color: '#ff4455',     border: 'rgba(255,68,85,0.3)'  },
  };
  const c = colors[variant] || colors.info;
  return { padding: '6px 14px', background: 'transparent', color: c.color, border: `1px solid ${c.border}`, borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
}

function EmptyState({ icon, title, body, warning }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--text3)', padding: 32 }}>
      <div style={{ fontSize: 40 }}>{icon}</div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text2)', marginBottom: 8 }}>{title}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.9, maxWidth: 400 }}>{body}</div>
      </div>
      {warning && (
        <div style={{ marginTop: 8, padding: '12px 20px', background: 'rgba(255,185,0,0.08)', border: '1px solid rgba(255,185,0,0.2)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ffb900', textAlign: 'center' }}>
          {warning}
        </div>
      )}
    </div>
  );
}

function PBlock({ label, body }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>{body}</div>
    </div>
  );
}

function TintBlock({ label, tint = 'neutral', children }) {
  const tints = {
    neutral: { bg: 'var(--surface)',        border: 'var(--border)' },
    warm:    { bg: 'rgba(255,180,77,0.06)', border: 'rgba(255,180,77,0.2)' },
    accent:  { bg: 'rgba(0,229,160,0.06)',  border: 'rgba(0,229,160,0.2)' },
  };
  const t = tints[tint];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 'var(--radius)', padding: '10px 14px' }}>{children}</div>
    </div>
  );
}

function TagBlock({ label, items, color = 'info' }) {
  const palettes = {
    info:   { bg: 'rgba(77,159,255,0.1)', border: 'rgba(77,159,255,0.25)', text: 'var(--info)'   },
    accent: { bg: 'rgba(0,229,160,0.1)',  border: 'rgba(0,229,160,0.25)', text: 'var(--accent)' },
  };
  const c = palettes[color];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {items.map((item, i) => (
          <span key={i} style={{ padding: '3px 9px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 20, fontSize: 11, color: c.text, fontFamily: 'var(--font-mono)' }}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function NumList({ label, items, bulletChar = null, bulletColor = 'var(--info)' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.12em' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
        {items.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
            <span style={{ color: bulletColor, fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 18, paddingTop: 2, fontWeight: 700 }}>{bulletChar ?? `${i + 1}.`}</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}