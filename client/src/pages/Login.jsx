// Sign-in. The four demo identities stand in for company SSO; clicking one signs in with
// the shared demo password, or the form below takes any email + password.
import { useEffect, useState } from 'react';
import { Activity, BellRing, DollarSign, ShieldCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/http.js';

const ROLE_SUMMARY = {
  platform_admin: 'Everything: alerts, approvals, data quality, audit log',
  finops_analyst: 'All cost attribution; owner emails masked; read-only',
  report_owner: 'Only reports they own; can claim orphaned reports',
  business_viewer: 'Platform health summary only',
};

export default function Login() {
  const { login } = useAuth();
  const [demo, setDemo] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/api/auth/demo-users').then((r) => setDemo(r.users)).catch(() => setError('Cannot reach the API. Is the server running on port 4000?')); }, []);

  async function signIn(e, p) {
    setBusy(true);
    setError(null);
    try {
      await login(e, p);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-side">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark"><Activity size={17} color="#fff" /></div>
          <div><div className="brand-name">Pure Insights</div><div className="brand-sub">Command Centre</div></div>
        </div>
        <div>
          <h1>Admin visibility for the analytics portal.</h1>
          <p>Report health, refresh failures, ownership and Snowflake compute cost, in one place, with real-time alerts.</p>
          <div className="login-points">
            <div><BellRing size={16} />Live alerts when load time exceeds 15 s or a refresh fails</div>
            <div><DollarSign size={16} />Snowflake credits attributed to every report</div>
            <div><ShieldCheck size={16} />Role-based access enforced on the server</div>
          </div>
        </div>
        <div className="small" style={{ color: '#5f6b82' }}>Case Study 3 · Rudra Solanki</div>
      </div>

      <div className="login-main">
        <div className="login-card">
          <h2>Sign in</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>Pick a demo identity to see how the dashboard changes by role.</p>

          <div className="demo-users">
            {demo.map((u) => (
              <button key={u.id} type="button" className="demo-user" disabled={busy} onClick={() => signIn(u.email, 'demo123')}>
                <div className="avatar">{u.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                <div className="who">
                  <b>{u.roleLabel}</b>
                  <span>{ROLE_SUMMARY[u.role]}</span>
                  <span className="mono" style={{ display: 'block', fontSize: 11.5 }}>{u.email}</span>
                </div>
                <ChevronRight size={16} color="var(--text-3)" />
              </button>
            ))}
          </div>

          <div className="divider">or with email</div>
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); signIn(email, password); }}>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>Sign in</button>
          </form>
          {error && <p className="error-text">{error}</p>}
          <p className="faint small">Demo password for all users: <span className="mono">demo123</span></p>
        </div>
      </div>
    </div>
  );
}
