// frontend/src/components/SummaryPanel.jsx

import { useState, useEffect, useRef } from 'react';

// ── localStorage cache — persists across sessions, keyed by profileUrl ─
const CACHE_PREFIX = 'apify_summary_cache_';

// ── In-memory tracker for in-flight requests ────────────────────────────
const inFlight = {};

function cacheGet(profileUrl) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + profileUrl);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheSet(profileUrl, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + profileUrl, JSON.stringify(data));
  } catch {}
}

function cacheClear(profileUrl) {
  try {
    localStorage.removeItem(CACHE_PREFIX + profileUrl);
  } catch {}
}

// ── Module-level fetch — survives component unmount ──────────────────
async function startFetch(url) {
  if (!inFlight[url]) return; // must be initialised by caller
  try {
    const res = await fetch('/api/apify-summary/profile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileUrl: url, apifyToken: localStorage.getItem('apifyKey') || '' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Summary failed');
    cacheSet(url, data);
    inFlight[url]?.callbacks.forEach(cb => cb(data, null));
    delete inFlight[url];
  } catch (err) {
    inFlight[url]?.callbacks.forEach(cb => cb(null, err.message));
    delete inFlight[url];
  }
}

// ── Tag pill ───────────────────────────────────────────────────────────
function Tag({ label, color = 'info' }) {
  const colors = {
    info:   { bg: 'rgba(77,159,255,0.1)',  border: 'rgba(77,159,255,0.25)',  text: 'var(--info)'   },
    accent: { bg: 'rgba(0,229,160,0.1)',   border: 'rgba(0,229,160,0.25)',   text: 'var(--accent)' },
    warm:   { bg: 'rgba(255,180,77,0.1)',  border: 'rgba(255,180,77,0.25)',  text: '#ffb44d'       },
  };
  const c = colors[color] || colors.info;
  return (
    <span style={{
      padding: '2px 8px',
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 20,
      fontSize: 10,
      color: c.text,
      fontFamily: 'var(--font-mono)',
    }}>{label}</span>
  );
}

// ── Section block ──────────────────────────────────────────────────────
function Section({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: '0.1em' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Button ─────────────────────────────────────────────────────────────
export function SummaryButton({ profileUrl, expanded, onToggle }) {
  const cached  = cacheGet(profileUrl);
  const loading = !!inFlight[profileUrl];
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      style={{
        padding: '5px 14px',
        background: expanded ? 'rgba(77,159,255,0.2)' : 'rgba(77,159,255,0.08)',
        color: 'var(--info)',
        border: '1px solid rgba(77,159,255,0.35)',
        borderRadius: 'var(--radius)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      {expanded
        ? '▲ HIDE SUMMARY'
        : loading
          ? '◌ Loading...'
          : cached ? '▼ VIEW SUMMARY' : '✦ GET SUMMARY'
      }
    </button>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
export function SummaryRow({ profileUrl, name, colSpan, onClose }) {
  const [state,  setState]  = useState(() => {
    if (cacheGet(profileUrl))  return 'done';
    if (inFlight[profileUrl])  return 'loading';
    return 'idle';
  });
  const [result, setResult] = useState(() => cacheGet(profileUrl) || null);
  const [error,  setError]  = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const cached = cacheGet(profileUrl);
    if (cached) { setState('done'); setResult(cached); return; }

    // fetch already running in background — attach callback to get result
    if (inFlight[profileUrl]) {
      setState('loading');
      inFlight[profileUrl].callbacks.push((data, err) => {
        if (!mountedRef.current) return;
        if (err) { setError(err); setState('error'); }
        else     { setResult(data); setState('done'); }
      });
      return;
    }

    // nothing running and no cache — start fresh
    setState('loading');
    inFlight[profileUrl] = { callbacks: [] };
    inFlight[profileUrl].callbacks.push((data, err) => {
      if (!mountedRef.current) return;
      if (err) { setError(err); setState('error'); }
      else     { setResult(data); setState('done'); }
    });
    startFetch(profileUrl);
  }, [profileUrl]);

  function handleRefresh() {
    cacheClear(profileUrl);
    delete inFlight[profileUrl];
    setResult(null);
    setError('');
    setState('loading');
    inFlight[profileUrl] = { callbacks: [] };
    inFlight[profileUrl].callbacks.push((data, err) => {
      if (!mountedRef.current) return;
      if (err) { setError(err); setState('error'); }
      else     { setResult(data); setState('done'); }
    });
    startFetch(profileUrl);
  }

  return (
    <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div style={{ padding: '10px 20px', borderTop: '2px solid rgba(77,159,255,0.2)' }}>

          {/* ── Idle ─────────────────────────────────────────────────── */}
          {state === 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
                Click ✦ GET SUMMARY to fetch this profile
              </span>
              <button onClick={onClose} style={{ marginLeft: 'auto', padding: '3px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}>✕ Close</button>
            </div>
          )}

          {/* ── Loading ──────────────────────────────────────────────── */}
          {state === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 14, color: 'var(--accent)' }}>◌</span>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                  Scraping LinkedIn profile for {name}...
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  Takes 2–4 minutes — you can browse other rows while waiting
                </div>
              </div>
              <button onClick={onClose} style={{ marginLeft: 'auto', padding: '3px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}>✕ Close</button>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────── */}
          {state === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#ff4455' }}>✕ {error}</span>
              <button onClick={handleRefresh} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--info)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}>Try again</button>
              <button onClick={onClose}       style={{ padding: '3px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)',              borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}>✕ Close</button>
            </div>
          )}

          {/* ── Done ─────────────────────────────────────────────────── */}
          {state === 'done' && result && (() => {
            const p  = result.profile  || {};
            const s  = result.summary  || {};
            const st = result.stats    || {};
            const o  = s.outreach      || {};

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 800 }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--info)', letterSpacing: '0.1em', marginBottom: 3 }}>
                      AI SUMMARY
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{name}</div>
                    {p.title && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                        {p.title}{p.company ? ` @ ${p.company}` : ''}
                        {p.location ? ` · ${p.location}` : ''}
                      </div>
                    )}
                    {p.email && (
                      <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        ✉ {p.email}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={handleRefresh} style={{ padding: '3px 10px', background: 'transparent', color: 'var(--info)', border: '1px solid rgba(77,159,255,0.3)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>↺ Refresh</button>
                    <button onClick={onClose}       style={{ padding: '3px 10px', background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)', fontSize: 10, cursor: 'pointer' }}>✕ Close</button>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* ── Who they are ── */}
                {s.summary && (
                  <Section label="WHO THEY ARE">
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                      {s.summary}
                    </div>
                  </Section>
                )}

                {/* ── Career story ── */}
                {s.careerStory && (
                  <Section label="CAREER STORY">
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                      {s.careerStory}
                    </div>
                  </Section>
                )}

                {/* ── What they talk about ── */}
                {s.activityNarrative && (
                  <Section label="WHAT THEY TALK ABOUT">
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                      {s.activityNarrative}
                    </div>
                  </Section>
                )}

                {/* ── Expertise + Interests ── */}
                {(s.expertise?.length > 0 || s.interests?.length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {s.expertise?.length > 0 && (
                      <Section label="EXPERTISE">
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {s.expertise.map((item, i) => <Tag key={i} label={item} color="accent" />)}
                        </div>
                      </Section>
                    )}
                    {s.interests?.length > 0 && (
                      <Section label="INTERESTS">
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {s.interests.map((item, i) => <Tag key={i} label={item} color="info" />)}
                        </div>
                      </Section>
                    )}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* ── Outreach section ── */}
                {(o.hook || o.talkingPoints?.length > 0 || o.icebreakers?.length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--warm, #ffb44d)', letterSpacing: '0.1em' }}>
                      OUTREACH GUIDE
                    </div>

                    {o.hook && (
                      <Section label="OPENING HOOK">
                        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, background: 'rgba(255,180,77,0.06)', border: '1px solid rgba(255,180,77,0.2)', borderRadius: 'var(--radius)', padding: '8px 12px', fontStyle: 'italic' }}>
                          "{o.hook}"
                        </div>
                      </Section>
                    )}

                    {o.talkingPoints?.length > 0 && (
                      <Section label="TALKING POINTS">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {o.talkingPoints.map((pt, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--info)', fontFamily: 'var(--font-mono)', fontSize: 10, minWidth: 16, paddingTop: 2 }}>{i + 1}.</span>
                              <span>{pt}</span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}

                    {o.icebreakers?.length > 0 && (
                      <Section label="ICEBREAKERS">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {o.icebreakers.map((qn, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 10, minWidth: 16, paddingTop: 2 }}>?</span>
                              <span>{qn}</span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}

                    {o.bestAngle && (
                      <Section label="BEST APPROACH">
                        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, background: 'rgba(0,229,160,0.06)', border: '1px solid rgba(0,229,160,0.2)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                          {o.bestAngle}
                        </div>
                      </Section>
                    )}
                  </div>
                )}

                <div style={{ borderTop: '1px solid var(--border)' }} />

                {/* ── Footer stats ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>📝 {st.postsCount ?? 0} posts</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>💬 {st.commentsCount ?? 0} comments</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>👍 {st.reactedCount ?? 0} reactions</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>📊 {st.totalActivity ?? 0} total activity</span>
                  {result.meta?.scrapedAt && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)' }}>
                      🕐 {new Date(result.meta.scrapedAt).toLocaleString()}
                    </span>
                  )}
                </div>

              </div>
            );
          })()}

        </div>
      </td>
    </tr>
  );
}