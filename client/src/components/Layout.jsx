// App shell: sidebar (only the pages this role may open), top bar with the signed-in
// identity, and the CRITICAL alert toasts.
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, LogOut, Siren, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { NAV } from '../nav.js';
import { api } from '../api/http.js';

const initials = (name = '') => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const ROLE_NOTE = {
  platform_admin: 'Full access',
  finops_analyst: 'All cost data · owner emails masked',
  report_owner: 'Own reports only',
  business_viewer: 'Health summary only · emails masked',
};

export default function Layout() {
  const { user, can, logout } = useAuth();
  const { connected, unseen, toasts, dismissToast, simulator } = useLive();
  const [source, setSource] = useState(null);

  useEffect(() => { api.get('/healthz').then((h) => setSource(h.data_source)).catch(() => {}); }, []);

  const sections = [...new Set(NAV.map((n) => n.section))];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={17} color="#fff" /></div>
          <div>
            <div className="brand-name">Pure Insights</div>
            <div className="brand-sub">Command Centre</div>
          </div>
        </div>

        <nav className="nav">
          {sections.map((section) => {
            const items = NAV.filter((n) => n.section === section && (!n.perm || can(n.perm)));
            if (!items.length) return null;
            return (
              <div key={section} className="nav">
                <div className="nav-label">{section}</div>
                {items.map(({ to, label, icon: Icon, badge }) => (
                  <NavLink key={to} to={to} end={to === '/'}>
                    <Icon size={16} />{label}
                    {badge === 'alerts' && unseen > 0 && <span className="nav-badge">{unseen > 99 ? '99+' : unseen}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="row"><span>Live feed</span><span className="row" style={{ gap: 6 }}><span className={`live-dot ${connected ? 'on' : ''}`} />{connected ? 'Connected' : 'Offline'}</span></div>
          <div className="row"><span>Replay</span><span>{simulator?.running ? (simulator.last_seq ? `Snapshot ${simulator.last_seq}/20` : 'Running') : 'Paused'}</span></div>
          <div className="row"><span>Data source</span><span>{{ duckdb: 'DuckDB', snowflake: 'Snowflake' }[source] ?? '—'}</span></div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="role-chip"><b>{user.roleLabel}</b><span className="faint">{ROLE_NOTE[user.role]}</span></span>
          <div className="spacer" />
          <div className="row">
            <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
              <div className="faint small">{user.email}</div>
            </div>
            <div className="avatar">{initials(user.name)}</div>
            <button type="button" className="btn ghost sm" onClick={logout} title="Sign out"><LogOut size={15} /></button>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>

      <div className="toasts">
        {toasts.map(({ id, alert }) => (
          <div key={id} className="toast">
            <div className="row between">
              <div className="toast-title"><Siren size={14} />Critical · {alert.report_id}</div>
              <button type="button" className="btn ghost sm" onClick={() => dismissToast(id)}><X size={13} /></button>
            </div>
            <div className="toast-body">{alert.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
