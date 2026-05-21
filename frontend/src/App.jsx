import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import LinkedIn from "./pages/LinkedIn";
import Settings from "./pages/Settings";
import Outreach from "./pages/Outreach";
import Maps from "./pages/Maps";
import Lookup from "./pages/Lookup";

const NAV_ITEMS = [
  { to: "/",        label: "LinkedIn", icon: "in" },
  { to: "/outreach",label: "Apollo",   icon: "🎯" },
  { to: "/maps",    label: "Maps",     icon: "🗺"  },
  { to: "/lookup",  label: "Lookup",   icon: "🔍" },
  { to: "/settings",label: "Settings", icon: "⚙"  },
];

function Sidebar() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{
      width: open ? 220 : 52,
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      height: "100vh",
      position: "sticky",
      top: 0,
      transition: 'width 0.2s ease',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: open ? "20px 16px 16px" : "20px 10px 16px",
        borderBottom: "1px solid var(--border)",
        display: 'flex',
        alignItems: 'center',
        justifyContent: open ? 'space-between' : 'center',
      }}>
        {open && (
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", letterSpacing: "0.15em", marginBottom: 4 }}>
              LEAD GEN
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px", color: "var(--accent)" }}>
              Pipeline
            </div>
          </div>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.borderColor = 'rgba(0,229,160,0.4)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          {open ? '‹' : '›'}
        </button>
      </div>

      <nav style={{ padding: "12px 8px", flex: 1 }}>
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={!open ? label : undefined}
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              justifyContent: open ? 'flex-start' : 'center',
              gap: 10,
              padding: open ? "10px 14px" : "10px",
              borderRadius: "var(--radius)",
              marginBottom: 2,
              fontWeight: 600,
              fontSize: 13,
              color: isActive ? "var(--accent)" : "var(--text2)",
              background: isActive ? "var(--accent-dim)" : "transparent",
              border: isActive ? "1px solid rgba(0,229,160,0.15)" : "1px solid transparent",
              transition: "all 0.15s",
              textDecoration: "none",
            })}
          >
            <span style={{ fontSize: icon === 'in' ? 13 : 16, fontWeight: icon === 'in' ? 800 : 400, flexShrink: 0 }}>{icon}</span>
            {open && label}
          </NavLink>
        ))}
      </nav>

      {open && (
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>
          v1.0.0
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <Sidebar />
        <div style={{ flex: 1, overflow: "auto" }}>
          <Routes>
            <Route path="/"         element={<LinkedIn />}  />
            <Route path="/outreach" element={<Outreach />}  />
            <Route path="/lookup"    element={<Lookup />}     />
            <Route path="/maps"     element={<Maps />}      />
            <Route path="/settings" element={<Settings />}  />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;