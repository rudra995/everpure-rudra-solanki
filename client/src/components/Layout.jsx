// App shell: a slim top bar (brand, current page, live status, alerts bell, user) and the
// Staggered Menu for navigation. The menu only lists pages this role may open.
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, Bell, LogOut, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { NAV } from '../nav.js';
import StaggeredMenu from './StaggeredMenu.jsx';
import { fmt } from '../format.js';

const initials = (name = '') => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

const ROLE_NOTE = {
  platform_admin: 'Full access, approves ownership claims',
  finops_analyst: 'All cost data, owner emails hidden',
  report_owner: 'Only the reports you own',
  business_viewer: 'Platform health only',
};

export default function Layout() {
  const { user, can, logout } = useAuth();
  const live = useLive();
  const { c } = useTheme();
  const location = useLocation();
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pages = NAV.filter((n) => !n.perm || can(n.perm));
  const isActive = (to) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));
  const idx = pages.findIndex((p) => isActive(p.to));
  const crumb = location.pathname.startsWith('/reports/') ? `Report ${location.pathname.split('/')[2]}` : pages[idx]?.label ?? 'Summary';

  const items = pages.map((p) => ({
    ...p,
    active: isActive(p.to),
    badge: p.badge === 'alerts' && live.unseen > 0 ? (live.unseen > 99 ? '99+' : live.unseen) : null,
  }));

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark"><Activity size={18} color="#fffaf3" /></span>
          <span><span className="brand-name" style={{ display: 'block' }}>Pure Insights</span><span className="brand-sub">Command Centre</span></span>
        </Link>
        <span className="divider-v hide-sm" />
        <span className="crumb hide-sm">{idx >= 0 && <span className="faint">{String(idx + 1).padStart(2, '0')} · </span>}<b>{crumb}</b></span>
        <span className="spacer" />
        <span className="pill hide-sm" title="Real-time feed over WebSocket">
          <span className={`live-dot ${live.connected ? 'on' : ''}`} />{live.connected ? 'Live' : 'Reconnecting'}
        </span>
        {live.receivesAlerts && (
          <div style={{ position: 'relative' }} ref={bellRef}>
            <button type="button" className="icon-btn" onClick={() => setBellOpen((o) => !o)} title="Recent alerts">
              <Bell size={16} />
              {live.unseen > 0 && <span className="dot-badge">{live.unseen > 99 ? '99+' : live.unseen}</span>}
            </button>
            {bellOpen && (
              <div className="popover">
                <div className="panel-head bordered" style={{ padding: '13px 16px' }}>
                  <div><div className="panel-title">Latest alerts</div><div className="panel-sub">{fmt.num(live.received)} received since you signed in</div></div>
                  <Link to="/alerts" className="btn sm" onClick={() => { setBellOpen(false); live.clearUnseen(); }}>See all</Link>
                </div>
                <ul className="feed" style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {live.alerts.slice(0, 7).map((a) => (
                    <li key={a.id} className="feed-item" style={{ gridTemplateColumns: '8px 1fr', padding: '10px 16px' }}>
                      <span className="live-dot" style={{ background: c[SEVERITY_KEY[a.severity]] }} />
                      <div><div className="small strong">{a.message}</div><div className="feed-meta">{a.report_id} · {a.severity} · {fmt.time(a.created_at)}</div></div>
                    </li>
                  ))}
                  {!live.alerts.length && <li className="empty">No alerts yet</li>}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="row hide-sm" style={{ gap: 10 }}>
          <div className="avatar">{initials(user.name)}</div>
          <div style={{ lineHeight: 1.2 }}>
            <div className="small strong">{user.name}</div>
            <div className="xs faint">{user.roleLabel}</div>
          </div>
        </div>
      </header>

      <StaggeredMenu
        items={items}
        colors={['#fbd7b6', '#f39a52', '#e2611b']}
        footer={(
          <>
            <div className="row" style={{ gap: 12 }}>
              <div className="avatar">{initials(user.name)}</div>
              <div style={{ lineHeight: 1.3 }}>
                <div className="strong">{user.name}</div>
                <div className="small faint">{user.roleLabel} · {ROLE_NOTE[user.role]}</div>
              </div>
            </div>
            <button type="button" className="btn" onClick={logout} style={{ alignSelf: 'flex-start' }}><LogOut size={14} />Sign out</button>
          </>
        )}
      />

      <main className="content"><Outlet /></main>

      <div className="toasts">
        {live.toasts.map(({ id, alert }) => (
          <div key={id} className="toast">
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
