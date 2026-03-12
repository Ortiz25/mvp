import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Shell }           from './components/layout/Shell';
import { PickerPage }      from './pages/PickerPage';
import { VideoPage }       from './pages/VideoPage';
import { SurveyPage }      from './pages/SurveyPage';
import { SuccessPage }     from './pages/SuccessPage';
import { OfflinePage }     from './pages/OfflinePage';
import { ConnectingPage }  from './pages/ConnectingPage';

/**
 * Grant flag storage — uses localStorage NOT sessionStorage.
 *
 * WHY localStorage:
 *   After grant, the user taps "Open Browser" which triggers a navigation.
 *   On Android captive portal WebView, this causes a full page reload of
 *   captive.local — wiping sessionStorage entirely. localStorage survives
 *   full navigations and tab restores.
 *
 *   We store the expiry time so we can auto-clear the flag after the session
 *   ends, preventing the phone from being permanently stuck on ConnectingPage
 *   on future visits.
 *
 * FLAG FORMAT: JSON { expiresAt: ISO string }
 */
const GRANT_KEY = 'cp_granted_v2';

export function setGrantedFlag(expiresAt?: string) {
  try {
    const exp = expiresAt || new Date(Date.now() + 8 * 3600000).toISOString();
    localStorage.setItem(GRANT_KEY, JSON.stringify({ expiresAt: exp }));
  } catch {}
}

export function clearGrantedFlag() {
  try { localStorage.removeItem(GRANT_KEY); } catch {}
  // Also clear old sessionStorage key from previous versions
  try { sessionStorage.removeItem('cp_granted'); } catch {}
}

export function isGrantedFlagSet(): boolean {
  try {
    const raw = localStorage.getItem(GRANT_KEY);
    if (!raw) return false;
    const { expiresAt } = JSON.parse(raw);
    if (expiresAt && new Date(expiresAt) < new Date()) {
      // Session expired — clear flag so user can start fresh
      localStorage.removeItem(GRANT_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const landingRoute = isGrantedFlagSet()
    ? <Navigate to="/connecting" replace />
    : <PickerPage />;

  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/"           element={landingRoute} />
            <Route path="/watch"      element={<VideoPage />} />
            <Route path="/survey"     element={<SurveyPage />} />
            <Route path="/success"    element={<SuccessPage />} />
            <Route path="/connecting" element={<ConnectingPage />} />
            <Route path="/offline"    element={<OfflinePage />} />
            <Route path="*"           element={landingRoute} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
