import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { ThemeProvider }   from './context/ThemeContext';
import { Shell }           from './components/layout/Shell';
import { PickerPage }      from './pages/PickerPage';
import { VideoPage }       from './pages/VideoPage';
import { SurveyPage }      from './pages/SurveyPage';
import { ConnectingPage }  from './pages/ConnectingPage';
import { OfflinePage }     from './pages/OfflinePage';

export default function App() {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}
