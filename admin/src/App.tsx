// src/App.tsx
import { useState, useEffect } from 'react';
import { api, getToken, clearToken } from './lib/api';
import { ThemeProvider } from './context/ThemeContext';
import { Login }           from './pages/Login';
import { AdminShell }      from './components/layout/AdminShell';
import { Overview }        from './pages/Overview';
import { CampaignManager } from './pages/CampaignManager';
import { Sessions }  from './pages/Sessions';
import { Analytics } from './pages/Analytics';

function AdminApp() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('overview');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) { setChecking(false); return; }
    api.login(t).then(() => setAuthed(true)).catch(() => clearToken()).finally(() => setChecking(false));
  }, []);

  const logout = () => { clearToken(); setAuthed(false); };

  if (checking) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-app)' }}>
      <div className="w-8 h-8 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
    </div>
  );

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  return (
    <AdminShell tab={tab} onTab={setTab} onLogout={logout}>
      {tab === 'overview'  && <Overview />}
      {tab === 'campaigns' && <CampaignManager />}
      {tab === 'sessions'  && <Sessions />}
      {tab === 'analytics' && <Analytics />}
    </AdminShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AdminApp />
    </ThemeProvider>
  );
}
