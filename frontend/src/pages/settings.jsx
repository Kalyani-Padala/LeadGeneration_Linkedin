import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';

export default function Settings() {
  const {
    connectSafelyKey, setConnectSafelyKey,
    accountId, setAccountId,
    apolloKey, setApolloKey,
    hunterKey, setHunterKey,
    apifyKey,  setApifyKey,
    serperKey,    setSerperKey,
    firecrawlKey, setFirecrawlKey,
    pbApiKey, setPbApiKey,
    pbActivityAgentId, setPbActivityAgentId,
    pbProfileAgentId,  setPbProfileAgentId,
    pbLinkedinCookie,  setPbLinkedinCookie,
  } = useSettings();

  const [csKeyInput,       setCsKeyInput]       = useState(connectSafelyKey);
  const [csIdInput,        setCsIdInput]        = useState(accountId);
  const [apolloInput,      setApolloInput]      = useState(apolloKey);
  const [hunterInput,      setHunterInput]      = useState(hunterKey);
  const [apifyInput,       setApifyInput]       = useState(apifyKey);
  const [serperInput,      setSerperInput]      = useState(serperKey);
  const [firecrawlInput,   setFirecrawlInput]   = useState(firecrawlKey);
  const [pbApiKeyInput,    setPbApiKeyInput]    = useState(pbApiKey);
  const [pbActivityIdInput,setPbActivityIdInput]= useState(pbActivityAgentId);
  const [pbProfileIdInput, setPbProfileIdInput] = useState(pbProfileAgentId);
  const [pbCookieInput,    setPbCookieInput]    = useState(pbLinkedinCookie);

  const [showCsKey,      setShowCsKey]      = useState(false);
  const [showApollo,     setShowApollo]     = useState(false);
  const [showHunter,     setShowHunter]     = useState(false);
  const [showApify,      setShowApify]      = useState(false);
  const [showSerper,     setShowSerper]     = useState(false);
  const [showFirecrawl,  setShowFirecrawl]  = useState(false);
  const [showPbKey,      setShowPbKey]      = useState(false);
  const [showPbCookie,   setShowPbCookie]   = useState(false);
  const [saved,          setSaved]          = useState(false);

  function handleSave() {
    setConnectSafelyKey(csKeyInput.trim());
    setAccountId(csIdInput.trim());
    setApolloKey(apolloInput.trim());
    setHunterKey(hunterInput.trim());
    setApifyKey(apifyInput.trim());
    setSerperKey(serperInput.trim());
    setFirecrawlKey(firecrawlInput.trim());
    setPbApiKey(pbApiKeyInput.trim());
    setPbActivityAgentId(pbActivityIdInput.trim());
    setPbProfileAgentId(pbProfileIdInput.trim());
    setPbLinkedinCookie(pbCookieInput.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{ padding: '40px 48px', maxWidth: 760 }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.15em', marginBottom: 8 }}>
          CONFIGURATION
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 32, letterSpacing: '-1px', lineHeight: 1.1 }}>Settings</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8, fontSize: 14 }}>
          All credentials are stored locally in your browser only.
        </p>
      </div>

      {/* ConnectSafely */}
      <Section icon="🔗" title="ConnectSafely API" subtitle="api.connectsafely.ai" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="Your ConnectSafely Bearer token" required>
          <PasswordInput value={csKeyInput} onChange={setCsKeyInput} show={showCsKey} onToggle={() => setShowCsKey(v => !v)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        </Field>
        <Field label="Account ID" hint="Your ConnectSafely account identifier" required style={{ marginTop: 20 }}>
          <input type="text" value={csIdInput} onChange={e => setCsIdInput(e.target.value)} placeholder="e.g. 698ed4730134a943c9c2f40a" style={inputStyle} />
        </Field>
      </Section>

      {/* Apollo */}
      <Section icon="🚀" title="Apollo.io" subtitle="Company search + contact enrichment" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="Your Apollo.io API key" required>
          <PasswordInput value={apolloInput} onChange={setApolloInput} show={showApollo} onToggle={() => setShowApollo(v => !v)} placeholder="your apollo api key" />
        </Field>
      </Section>

      {/* Hunter.io */}
      <Section icon="📧" title="Hunter.io" subtitle="Email finder" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="Your Hunter.io API key" required>
          <PasswordInput value={hunterInput} onChange={setHunterInput} show={showHunter} onToggle={() => setShowHunter(v => !v)} placeholder="your hunter.io api key" />
        </Field>
      </Section>

      {/* Apify */}
      <Section icon="🕷️" title="Apify" subtitle="Decision maker scraper" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="Your Apify API key" required>
          <PasswordInput value={apifyInput} onChange={setApifyInput} show={showApify} onToggle={() => setShowApify(v => !v)} placeholder="apify_api_..." />
        </Field>
      </Section>

      {/* Serper */}
      <Section icon="🔎" title="Serper" subtitle="Google Search API — for company intelligence" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="From serper.dev → Dashboard → API Key" required>
          <PasswordInput value={serperInput} onChange={setSerperInput} show={showSerper} onToggle={() => setShowSerper(v => !v)} placeholder="your serper api key" />
        </Field>
      </Section>

      {/* Firecrawl */}
      <Section icon="🔥" title="Firecrawl" subtitle="Website scraper — for company intelligence" style={{ marginBottom: 24 }}>
        <Field label="API Key" hint="From firecrawl.dev → Dashboard → API Key" required>
          <PasswordInput value={firecrawlInput} onChange={setFirecrawlInput} show={showFirecrawl} onToggle={() => setShowFirecrawl(v => !v)} placeholder="fc-..." />
        </Field>
      </Section>


      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={handleSave} style={{ padding: '11px 28px', background: 'var(--accent)', color: '#000', fontWeight: 700, fontSize: 13, borderRadius: 'var(--radius)', letterSpacing: '0.05em', cursor: 'pointer' }}>
          SAVE SETTINGS
        </button>
        {saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            <span>✓</span> Saved successfully
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ icon, title, subtitle, children, style }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', ...style }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid rgba(0,229,160,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
          {icon}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ padding: '24px' }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, required, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
        {required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
        {hint && <span style={{ display: 'block', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 11, marginTop: 2 }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function PasswordInput({ value, onChange, show, onToggle, placeholder }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 60 }}
      />
      <button onClick={onToggle} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }}>
        {show ? 'HIDE' : 'SHOW'}
      </button>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 14px',
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', color: 'var(--text)',
  fontSize: 13, fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
};
