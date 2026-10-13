// Routes. Every page except Login needs a session; each page also needs the permission
// listed in nav.js. Without it the route shows a "no access" message (the API would
// return 403 anyway).
import { Navigate, Route, Routes } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from './auth/AuthContext.jsx';
import { LiveProvider } from './live/LiveContext.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { NAV } from './nav.js';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Health from './pages/Health.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import Alerts from './pages/Alerts.jsx';
import Orphaned from './pages/Orphaned.jsx';
import Cost from './pages/Cost.jsx';
import DataQuality from './pages/DataQuality.jsx';
import Audit from './pages/Audit.jsx';

const PAGES = {
  '/': Overview, '/health': Health, '/alerts': Alerts, '/orphaned': Orphaned,
  '/cost': Cost, '/data-quality': DataQuality, '/audit': Audit,
};

function Guard({ perm, children }) {
  const { can } = useAuth();
  if (perm && !can(perm)) {
    return (
      <div className="panel empty" style={{ marginTop: 40 }}>
        <Lock size={22} style={{ marginBottom: 8 }} />
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>No access</div>
        <div>Your role doesn&apos;t include this page. Access is enforced by the server too.</div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading label="Starting…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <LiveProvider>
      <Routes>
        <Route element={<Layout />}>
          {NAV.map(({ to, perm }) => {
            const Page = PAGES[to];
            return <Route key={to} path={to} element={<Guard perm={perm}><Page /></Guard>} />;
          })}
          <Route path="/reports/:reportId" element={<ReportDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}
