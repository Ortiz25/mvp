import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Shell }           from './components/layout/Shell';
import { PickerPage }      from './pages/PickerPage';
import { VideoPage }       from './pages/VideoPage';
import { SurveyPage }      from './pages/SurveyPage';
import { SuccessPage }     from './pages/SuccessPage';
import { OfflinePage }     from './pages/OfflinePage';

/**
 * After grant, window.location.replace() sends the browser to:
 *   http://192.168.88.1/login?username=MAC&password=MAC&dst=http://www.google.com
 *
 * MikroTik authenticates the MAC, then redirects to dst (google.com).
 * However the Android captive portal WebView intercepts this and may reload
 * captive.local/ instead of following the external redirect.
 *
 * When that happens, the SPA remounts at / with all state cleared.
 * We persist a 'cp_granted' flag in sessionStorage before the redirect
 * so we can detect this bounce-back and show ConnectingScreen instead of PickerPage.
 *
 * The flag is stored per-session (cleared when tab closes), so returning
 * users start fresh.
 */
const GRANT_KEY = 'cp_granted';
export const isGrantedFlagSet = () => {
  try { return sessionStorage.getItem(GRANT_KEY) === '1'; } catch { return false; }
};

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            {/* / and * both check grant flag first */}
            <Route path="/"        element={isGrantedFlagSet() ? <SurveyPage /> : <PickerPage />} />
            <Route path="/watch"   element={<VideoPage />} />
            <Route path="/survey"  element={<SurveyPage />} />
            <Route path="/success" element={<SuccessPage />} />
            <Route path="/offline" element={<OfflinePage />} />
            <Route path="*"        element={isGrantedFlagSet() ? <SurveyPage /> : <PickerPage />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
