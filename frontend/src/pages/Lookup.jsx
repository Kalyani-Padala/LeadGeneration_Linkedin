// frontend/src/pages/Scout.jsx

import { useState, useEffect } from 'react';
import { SummaryRow } from '../components/SummaryPanel.jsx';

const CACHE_PREFIX = 'apify_summary_cache_';

function getCached(url) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearCached(url) {
  try { localStorage.removeItem(CACHE_PREFIX + url); } catch {}
}

function isValidLinkedIn(url) {
  return /linkedin\.com\/in\/[^/]+/.test(url);
}

export default function Lookup() {
  const [input, setInput] = useState('');
  const [activeUrl, setActiveUrl] = useState(
    () => localStorage.getItem('scout_activeUrl') || null
  );
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem('scout_history');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [error, setError] = useState('');

  // Persist activeUrl whenever it changes
  useEffect(() => {
    if (activeUrl) localStorage.setItem('scout_activeUrl', activeUrl);
    else localStorage.removeItem('scout_activeUrl');
  }, [activeUrl]);

  function saveHistory(updater) {
    setHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      localStorage.setItem('scout_history', JSON.stringify(next));
      return next;
    });
  }

  function handleLookup(urlOverride) {
    const url = (urlOverride || input).trim().replace(/\/$/, '');
    setError('');

    if (!url) { setError('Paste a LinkedIn profile URL first.'); return; }
    if (!isValidLinkedIn(url)) { setError('Must be a LinkedIn profile URL — e.g. https://www.linkedin.com/in/username'); return; }

    saveHistory(prev => {
      if (prev.find(h => h.url === url)) return prev;
      return [{ url, cachedAt: getCached(url) ? Date.now() : null }, ...prev].slice(0, 20);
    });

    setActiveUrl(url);
    setInput('');
  }

  function handleRefreshHistory(url) {
    clearCached(url);
    saveHistory(prev => prev.map(h => h.url === url ? { ...h, cachedAt: null } : h));
    setActiveUrl(url);
  }

  function removeFromHistory(url) {
    clearCached(url);
    saveHistory(prev => prev.filter(h => h.url !== url));
    if (activeUrl === url) setActiveUrl(null);
  }

  function urlToName(url) {
    return url.replace(/\/$/, '').split('/in/')[1] || url;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── LEFT SIDEBAR: history ─────────────────────────────────── */}
      <div style={{ width: 260, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 4 }}>LOOKUP</div>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>Profile Lookup</div>
        </div>

        {/* Search input */}
        <div style={{ padding: '14px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="linkedin.com/in/username"
              style={{
                flex: 1,
                padding: '8px 10px',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}
            />
            <button
              onClick={() => handleLookup()}
              style={{
                padding: '8px 12px',
                background: 'var(--accent)',
                color: '#000',
                fontWeight: 700,
                fontSize: 13,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >→</button>
          </div>
          {error && (
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ff4455' }}>
              {error}
            </div>
          )}
        </div>

        {/* History list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {history.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
              Paste a LinkedIn URL above<br />to look up a profile.
            </div>
          ) : (
            history.map(({ url, cachedAt }) => {
              const isActive = activeUrl === url;
              const isCached = Boolean(getCached(url));
              const name     = urlToName(url);
              return (
                <div
                  key={url}
                  onClick={() => setActiveUrl(url)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    transition: 'all 0.1s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleRefreshHistory(url); }}
                        title="Re-fetch (clear cache)"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, padding: '0 2px' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--info)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                      >↺</button>
                      <button
                        onClick={e => { e.stopPropagation(); removeFromHistory(url); }}
                        title="Remove"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, padding: '0 2px' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ff4455'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
                      >×</button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {isCached ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--accent)', background: 'rgba(0,229,160,0.1)', border: '1px solid rgba(0,229,160,0.2)', padding: '1px 6px', borderRadius: 10 }}>
                        ✓ CACHED
                      </span>
                    ) : (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 10 }}>
                        NOT FETCHED
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {history.length > 0 && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
            {history.length} profile{history.length !== 1 ? 's' : ''} · cached in browser
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        {!activeUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'var(--text3)' }}>
            <div style={{ fontSize: 40 }}>🔍</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text2)', marginBottom: 8 }}>Scout a Profile</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.9, maxWidth: 360 }}>
                Paste any LinkedIn profile URL on the left.<br />
                Get a full AI summary — career story, interests,<br />
                outreach hook, talking points, and icebreakers.<br />
                <br />
                Results are cached in your browser.<br />
                No re-fetching unless you refresh.
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em' }}>TRY AN EXAMPLE</div>
              <button
                onClick={() => { setInput('https://www.linkedin.com/in/peter-harris-a166665'); }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--info)', background: 'transparent', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 'var(--radius)', padding: '6px 14px', cursor: 'pointer' }}
              >
                linkedin.com/in/peter-harris-a166665
              </button>
            </div>
          </div>
        ) : (
          <ScoutSummary
            key={activeUrl}
            profileUrl={activeUrl}
            onCached={() => {
              saveHistory(prev => prev.map(h =>
                h.url === activeUrl ? { ...h, cachedAt: Date.now() } : h
              ));
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── ScoutSummary — wraps SummaryRow in a fake table ───────────────────
function ScoutSummary({ profileUrl, onCached }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <SummaryRow
          profileUrl={profileUrl}
          name={profileUrl.replace(/\/$/, '').split('/in/')[1] || profileUrl}
          colSpan={1}
          onClose={() => {}}
        />
      </tbody>
    </table>
  );
}