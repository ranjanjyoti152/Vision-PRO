import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Playback from './pages/Playback';
import Events from './pages/Events';
import Faces from './pages/Faces';
import Settings from './pages/Settings';
import SystemMonitor from './pages/SystemMonitor';
import AIModels from './pages/AIModels';
import AIAssistant from './pages/AIAssistant';
import Heatmaps from './pages/Heatmaps';
import Analytics from './pages/Analytics';
import Users from './pages/Users';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = localStorage.getItem('visionpro_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/playback" element={<Playback />} />
            <Route path="/events" element={<Events />} />
            <Route path="/faces" element={<Faces />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/system" element={<SystemMonitor />} />
            <Route path="/models" element={<AIModels />} />
            <Route path="/users" element={<Users />} />
            <Route path="/assistant" element={<AIAssistant />} />
            <Route path="/heatmaps" element={<Heatmaps />} />
            <Route path="/analytics" element={<Analytics />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
