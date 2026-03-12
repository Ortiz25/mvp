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
 * Grant flag — persisted in sessionStorage so bounce-backs from MikroTik
 * (Android WebView reloading captive.local after grant) show ConnectingPage
 * instead of restarting the PickerPage flow.
 */
export const GRANT_KEY     = 'cp_granted';
export const isGrantedFlagSet = () => { try { return sessionStorage.getItem(GRANT_KEY) === '1'; } catch { return false; } };
export const setGrantedFlag   = () => { try { sessionStorage.setItem(GRANT_KEY, '1'); } catch {} };
export const clearGrantedFlag = () => { try { sessionStorage.removeItem(GRANT_KEY); } catch {} };

export default function App() {
  const landing = isGrantedFlagSet()
    ? <Navigate to="/connecting" replace />
    : <PickerPage />;

  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/"           element={landing} />

            {/*
              /login safety net — MikroTik may redirect clients to captive.local/login
              if the hotspot profile's login-page is misconfigured.
              nginx handles /login with a 200 response so MikroTik's keepalive
              doesn't loop, but if the React SPA ever loads at /login we
              redirect back to / so the user sees PickerPage not a blank screen.

              The REAL fix is in mikrotik-fix.rsc:
                login-page=http://captive.local/   ← trailing slash, no /login
            */}
            <Route path="/login"      element={<Navigate to="/" replace />} />

            <Route path="/watch"      element={<VideoPage />} />
            <Route path="/survey"     element={<SurveyPage />} />
            <Route path="/success"    element={<SuccessPage />} />
            <Route path="/connecting" element={<ConnectingPage />} />
            <Route path="/offline"    element={<OfflinePage />} />
            <Route path="*"           element={landing} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
