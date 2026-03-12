import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Shell }          from './components/layout/Shell';
import { PickerPage }     from './pages/PickerPage';
import { VideoPage }      from './pages/VideoPage';
import { SurveyPage }     from './pages/SurveyPage';
import { ConnectingPage } from './pages/ConnectingPage';
import { OfflinePage }    from './pages/OfflinePage';

/**
 * NO grant flags. NO localStorage. NO sessionStorage for routing decisions.
 *
 * Routing logic is entirely server-driven:
 *   - Every page checks session.accessGranted from the server
 *   - If true → show ConnectingPage (which does the MikroTik login redirect)
 *   - If the WebView bounces back, the server still returns accessGranted=true
 *     so the user sees ConnectingPage again — not PickerPage
 *
 * The ConnectingPage does ONE thing: redirect the browser to
 *   http://192.168.88.1/login?username=MAC&password=MAC&dst=ORIG_URL
 * This is the MikroTik HTTP login endpoint. MikroTik authenticates the
 * session at network layer, then redirects to ORIG_URL.
 * The OS captive portal detector sees internet → dismisses WebView.
 */
export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/"           element={<PickerPage />} />
            <Route path="/watch"      element={<VideoPage />} />
            <Route path="/survey"     element={<SurveyPage />} />
            <Route path="/connecting" element={<ConnectingPage />} />
            <Route path="/offline"    element={<OfflinePage />} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
