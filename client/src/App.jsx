import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Websites from './pages/Websites.jsx';
import Leads from './pages/Leads.jsx';
import NonLeads from './pages/NonLeads.jsx';
import WebsiteDetails from './pages/WebsiteDetails.jsx';
import Updates from './pages/Updates.jsx';
import Notifications from './pages/Notifications.jsx';
import MonitoringHistory from './pages/MonitoringHistory.jsx';
import Settings from './pages/Settings.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-ink-950 dark:text-slate-400">
        Loading workspace...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <SocketProvider>
      <DataProvider>{children}</DataProvider>
    </SocketProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/websites" element={<Websites />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/non-leads" element={<NonLeads />} />
        <Route path="/websites/:id" element={<WebsiteDetails />} />
        <Route path="/updates" element={<Updates />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/history" element={<MonitoringHistory />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
