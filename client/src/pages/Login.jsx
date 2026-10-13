// Sign-in. The four demo identities stand in for company SSO (Okta / Entra ID groups);
// one click signs in with the shared demo password, or use the form.
import { useEffect, useState } from 'react';
import { Activity, BarChart3, ChevronRight, Crown, Eye, ShieldCheck, UserCog } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/http.js';
import { PALETTE as c } from '../theme.jsx';

const ROLE_META = {
  platform_admin: { icon: Crown, color: c.accent, text: 'Sees everything and approves ownership changes' },
  finops_analyst: { icon: BarChart3, color: c.snowflake, text: 'All cost data, owner emails hidden, read-only' },
  report_owner: { icon: UserCog, color: c.usage, text: 'Only the reports they own; can request orphaned ones' },
  business_viewer: { icon: Eye, color: c.ownership, text: 'Platform health only' },
};

export default function Login() {
  const { login } = useAuth();
  const [demo, setDemo] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/auth/demo-users').then((r) => setDemo(r.users)).catch(() => setError('Cannot reach the API. Is the server running on port 4000?'));
  }, []);

  async function signIn(e, p) {
    setBusy(true);
    setError(null);
    try { await login(e, p); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-side">
        <div className="brand">
          <span className="brand-mark"><Activity size={18} color="#fffaf3" /></span>
          <span><span className="brand-name" style={{ display: 'block' }}>Pure Insights</span><span className="brand-sub" style={{ color: '#6b4a30' }}>Command Centre</span></span>
        </div>
        <div>
          <h1>See every report&apos;s health, owner and <em>true cost</em>.</h1>
          <p style={{ marginTop: 18 }}>The admin view the analytics portal lost when it moved off Tableau: slow loads, failed refreshes, reports nobody owns, and what each one costs in Snowflake compute and AWS hosting.</p>
          <div className="login-feats">
            <div className="login-feat"><b>Live alerts</b>The moment a load passes 15 s or a refresh fails</div>
            <div className="login-feat"><b>Cost per view</b>Snowflake and AWS, for every report</div>
            <div className="login-feat"><b>4 roles</b>Each sees only what it should</div>
          </div>
        </div>
        <div className="small" style={{ color: '#6b4a30' }}>Case Study 3 · Technical Data &amp; AI Validation · Rudra Solanki</div>
      </div>

      <div className="login-main">
        <div className="login-card">
          <div className="eyebrow">Sign in</div>
          <h2>Choose who you are</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>Each role sees a different dashboard. What a role may see is decided by the server, not the browser.</p>

          <div className="demo-users">
            {demo.map((u) => {
              const meta = ROLE_META[u.role] ?? ROLE_META.business_viewer;
              const Icon = meta.icon;
              return (
                <button key={u.id} type="button" className="demo-user" disabled={busy} onClick={() => signIn(u.email, 'demo123')}>
                  <span className="role-ico" style={{ background: `${meta.color}1f`, color: meta.color }}><Icon size={18} /></span>
                  <div className="who">
                    <b>{u.roleLabel}</b>
                    <span>{meta.text}</span>
                    <span className="mono" style={{ display: 'block', fontSize: 11 }}>{u.email}</span>
                  </div>
                  <ChevronRight size={16} color="var(--text-3)" />
                </button>
              );
            })}
          </div>

          <div className="divider">or with email</div>
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); signIn(email, password); }}>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn primary" type="submit" disabled={busy}>Sign in</button>
          </form>
          {error && <p className="error-text">{error}</p>}
          <p className="faint small row" style={{ gap: 6 }}><ShieldCheck size={13} />Demo password for every user: <span className="mono">demo123</span></p>
        </div>
      </div>
    </div>
  );
}
