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
 * After grant, window.location.replace() sends the browser to:
 *   http://192.168.88.1/login?username=MAC&password=MAC&dst=http://www.google.com
 *
 * MikroTik authenticates the MAC, then redirects to dst (google.com).
 * However the Android captive portal WebView may reload captive.local/ instead
 * of following the external redirect ("bounce-back").
 *
 * When that happens the SPA remounts at / with all React state cleared.
 * We persist a 'cp_granted' flag in sessionStorage BEFORE the redirect so
 * the app can detect the bounce-back and show ConnectingPage (not PickerPage).
 *
 * ConnectingPage is a dedicated route — it never redirects away automatically,
 * it only shows the "Access Granted / Open Browser" UI.
 */
export const GRANT_KEY = 'cp_granted';
export const isGrantedFlagSet  = () => { try { return sessionStorage.getItem(GRANT_KEY) === '1'; } catch { return false; } };
export const setGrantedFlag    = () => { try { sessionStorage.setItem(GRANT_KEY, '1'); } catch {} };
export const clearGrantedFlag  = () => { try { sessionStorage.removeItem(GRANT_KEY); } catch {} };

export default function App() {
  // If MikroTik bounced the user back to captive.local after granting access,
  // go straight to /connecting — skip PickerPage entirely.
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
            {/* Catch-all: same logic as / */}
            <Route path="*"           element={landingRoute} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
