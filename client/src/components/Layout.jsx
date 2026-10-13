// App shell: sidebar (only pages this role may open) with live connection status,
// top bar with breadcrumb, data source, alert bell, theme toggle and the signed-in user.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Bell, ChevronRight, Database, LogOut, Moon, Siren, Sun, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { NAV } from '../nav.js';
import { api } from '../api/http.js';
import { fmt } from '../format.js';

const initials = (name = '') => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const SOURCE_LABEL = { duckdb: 'DuckDB', snowflake: 'Snowflake' };

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

  const sections = [...new Set(NAV.map((n) => n.section))];
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));
  const crumb = location.pathname.startsWith('/reports/') ? `Report ${location.pathname.split('/')[2]}` : current?.label ?? 'Overview';
  const sim = live.simulator;
  const progress = sim?.last_seq ? (sim.last_seq / 20) * 100 : 0;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={18} color="#fff" /></div>
          <div><div className="brand-name">Pure Insights</div><div className="brand-sub">Command Centre</div></div>
        </div>

        <nav className="nav">
          {sections.map((section) => {
            const items = NAV.filter((n) => n.section === section && (!n.perm || can(n.perm)));
            if (!items.length) return null;
            return (
              <div key={section} className="nav-section">
                <div className="nav-label">{section}</div>
                {items.map(({ to, label, icon: Icon, badge }) => (
                  <NavLink key={to} to={to} end={to === '/'}>
                    <Icon size={16} />{label}
                    {badge === 'alerts' && live.unseen > 0 && <span className="nav-badge">{live.unseen > 99 ? '99+' : live.unseen}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="kv"><span>WebSocket</span><span className="row" style={{ gap: 6 }}><span className={`live-dot ${live.connected ? 'on' : ''}`} /><b>{live.connected ? 'Live' : 'Offline'}</b></span></div>
          <div className="kv"><span>Telemetry replay</span><b>{sim?.running ? (sim.last_seq ? `#${sim.last_seq} of 20` : 'Running') : 'Paused'}</b></div>
          <div className="progress"><span style={{ width: `${progress}%` }} /></div>
          <div className="kv"><span>Cycle</span><b>{sim?.cycle ?? '–'}</b></div>
          <div className="kv"><span>Data source</span><b>{SOURCE_LABEL[source] ?? '—'}</b></div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs"><span>Command Centre</span><ChevronRight size={14} /><b>{crumb}</b></div>
          <div className="spacer" />
          <span className="pill"><Database size={13} />Source <b>{SOURCE_LABEL[source] ?? '—'}</b></span>
          <span className="pill"><span className={`live-dot ${live.connected ? 'on' : ''}`} />{live.connected ? 'Streaming' : 'Reconnecting'}</span>

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
          <div className="row" style={{ gap: 10, paddingLeft: 6, borderLeft: '1px solid var(--border)' }}>
            <div className="avatar">{initials(user.name)}</div>
            <div style={{ lineHeight: 1.2 }}>
              <div className="small strong">{user.name}</div>
              <div className="xs faint">{user.roleLabel}</div>
            </div>
            <button type="button" className="btn ghost sm" onClick={logout} title="Sign out"><LogOut size={15} /></button>
          </div>
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
