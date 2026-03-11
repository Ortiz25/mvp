import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Shell }           from './components/layout/Shell';
import { PickerPage }      from './pages/PickerPage';
import { VideoPage }       from './pages/VideoPage';
import { SurveyPage }      from './pages/SurveyPage';
import { SuccessPage }     from './pages/SuccessPage';
import { OfflinePage }     from './pages/OfflinePage';

// If the user granted access and MikroTik bounced them back to captive.local,
// keep them on /survey (which shows the ConnectingScreen) instead of / (picker).
const GRANT_KEY = 'cp_granted';
const isGranted = () => { try { return sessionStorage.getItem(GRANT_KEY) === '1'; } catch { return false; } };

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/"        element={<PickerPage />} />
            <Route path="/watch"   element={<VideoPage />} />
            <Route path="/survey"  element={<SurveyPage />} />
            <Route path="/success" element={<SuccessPage />} />
            <Route path="/offline" element={<OfflinePage />} />
            {/* Catch-all: if grant flag is set, stay on survey (shows connecting screen).
                Otherwise go to picker. This handles MikroTik bouncing back to captive.local/. */}
            <Route path="*" element={isGranted() ? <SurveyPage /> : <Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
