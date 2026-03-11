import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { Shell }           from './components/layout/Shell';
import { PickerPage }      from './pages/PickerPage';
import { VideoPage }       from './pages/VideoPage';
import { SurveyPage }      from './pages/SurveyPage';
import { SuccessPage }     from './pages/SuccessPage';
import { OfflinePage }     from './pages/OfflinePage';

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
            <Route path="*"        element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </SessionProvider>
  );
}
