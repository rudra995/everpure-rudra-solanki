// App shell: a dark sidebar on the left (icon rail that expands while hovered and collapses
// when the pointer leaves; only pages this role may open; profile and sign out at the bottom)
// and a top bar with the current page, data source, live status, replay, alerts and theme.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Bell, ChevronRight, Database, LogOut, Moon, Siren, Sun, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY, ChartDefs } from '../theme.jsx';
import { NAV } from '../nav.js';
import { api } from '../api/http.js';
import { fmt } from '../format.js';

const initials = (name = '') => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const SOURCE_LABEL = { duckdb: 'DuckDB', snowflake: 'Snowflake' };

function Sidebar({ items, user, onSignOut }) {
  // Clicking a link moves focus into the sidebar; drop it so the rail collapses as soon as
  // the pointer leaves (expansion is driven by :hover only).
  const blur = (e) => e.currentTarget.blur();
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <Link to="/" className="side-logo" onClick={blur} title="Pure Insights">
        <span className="side-logo-mark"><Activity size={20} /></span>
        <span className="side-text"><b>Pure Insights</b><small>Command Centre</small></span>
      </Link>
      <div className="side-items">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={blur} title={label}
            className={({ isActive }) => `side-item ${isActive ? 'active' : ''}`}>
            <Icon size={19} /><span className="side-text">{label}</span>
            {badge ? <span className="side-badge">{badge}</span> : null}
          </NavLink>
        ))}
      </div>
      <div className="side-foot">
        <div className="side-user">
          <span className="side-avatar">{initials(user.name)}</span>
          <span className="side-text"><b>{user.name}</b><small>{user.roleLabel}</small></span>
        </div>
        <button type="button" className="side-item" onClick={(e) => { blur(e); onSignOut(); }} title="Sign out">
          <LogOut size={19} /><span className="side-text">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

export default function Layout() {
  const { user, can, logout } = useAuth();
  const live = useLive();
  const { theme, toggle, c } = useTheme();
  const location = useLocation();
  const [source, setSource] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => { api.get('/healthz').then((h) => setSource(h.data_source)).catch(() => {}); }, []);
  useEffect(() => {
    const close = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));
  const crumb = location.pathname.startsWith('/reports/') ? `Report ${location.pathname.split('/')[2]}` : current?.label ?? 'Overview';
  const sim = live.simulator;
  const items = NAV.filter((n) => !n.perm || can(n.perm)).map((n) => ({
    ...n, badge: n.badge === 'alerts' && live.unseen > 0 ? (live.unseen > 99 ? '99+' : live.unseen) : null,
  }));

  return (
    <div className="shell">
      <ChartDefs />
      <Sidebar items={items} user={user} onSignOut={logout} />

      <div className="main">
        <header className="topbar">
          <div className="crumbs"><span>Command Centre</span><ChevronRight size={14} /><b>{crumb}</b></div>
          <div className="spacer" />
          <span className="pill"><Database size={13} />Source <b>{SOURCE_LABEL[source] ?? '—'}</b></span>
          <span className="pill"><span className={`live-dot ${live.connected ? 'on' : ''}`} />{live.connected ? 'Streaming' : 'Reconnecting'}</span>
          <span className="pill" title="Telemetry replay of the 20 snapshots">Replay <b>{sim?.running ? (sim.last_seq ? `#${sim.last_seq} / 20` : 'running') : 'paused'}</b></span>

          {live.receivesAlerts && (
            <div style={{ position: 'relative' }} ref={bellRef}>
              <button type="button" className="icon-btn" onClick={() => setBellOpen((o) => !o)} title="Recent alerts">
                <Bell size={16} />
                {live.unseen > 0 && <span className="dot-badge">{live.unseen > 99 ? '99+' : live.unseen}</span>}
              </button>
              {bellOpen && (
                <div className="popover">
                  <div className="panel-head bordered" style={{ padding: '12px 14px' }}>
                    <div><div className="panel-title">Recent alerts</div><div className="panel-sub">{fmt.num(live.received)} received live this session</div></div>
                    <Link to="/alerts" className="btn sm" onClick={() => { setBellOpen(false); live.clearUnseen(); }}>Open stream</Link>
                  </div>
                  <ul className="feed" style={{ maxHeight: 340, overflowY: 'auto' }}>
                    {live.alerts.slice(0, 8).map((a) => (
                      <li key={a.id} className="feed-item" style={{ gridTemplateColumns: '8px 1fr auto', padding: '9px 14px' }}>
                        <span className="live-dot" style={{ background: c[SEVERITY_KEY[a.severity]] }} />
                        <div><div className="small strong">{a.message}</div><div className="feed-meta">{a.report_id} · {fmt.time(a.created_at)}</div></div>
                        <span className="xs faint">{a.severity}</span>
                      </li>
                    ))}
                    {!live.alerts.length && <li className="empty">No alerts yet</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          <button type="button" className="icon-btn" onClick={toggle} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        <main className="content"><Outlet /></main>
      </div>

      <div className="toasts">
        {live.toasts.map(({ id, alert }) => (
          <div key={id} className="toast">
            <span className="chip" style={{ background: `${c.critical}22`, color: c.critical, width: 30, height: 30 }}><Siren size={15} /></span>
            <div>
              <div className="toast-title">Critical · {alert.report_id}</div>
              <div className="toast-body">{alert.message}</div>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => live.dismissToast(id)}><X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
