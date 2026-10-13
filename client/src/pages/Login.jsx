// Sign-in. The four demo identities stand in for company SSO (Okta / Entra ID groups);
// one click signs in with the shared demo password, or use the form.
import { useEffect, useState } from 'react';
import { Activity, BarChart3, ChevronRight, Crown, Eye, ShieldCheck, UserCog } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/http.js';

const ROLE_META = {
  platform_admin: { icon: Crown, color: '#7c7ff5', text: 'Everything: alerts, approvals, data quality, audit log' },
  finops_analyst: { icon: BarChart3, color: '#3987e5', text: 'All cost attribution · owner emails masked · read-only' },
  report_owner: { icon: UserCog, color: '#199e70', text: 'Only the reports they own · can claim orphaned reports' },
  business_viewer: { icon: Eye, color: '#c98500', text: 'Platform health summary only' },
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
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark"><Activity size={18} color="#fff" /></div>
          <div><div className="brand-name">Pure Insights</div><div className="brand-sub" style={{ color: '#6c7385' }}>Command Centre</div></div>
        </div>
        <div>
          <h1>Operational visibility for the <span>analytics portal</span>.</h1>
          <p style={{ marginTop: 16 }}>Report health, refresh failures, ownership and the full cost of every dashboard (Snowflake compute plus AWS hosting), with alerts streamed in real time.</p>
          <div className="login-feats">
            <div className="login-feat"><span style={{ color: '#9085e9' }}>Real-time alerts</span><b>&gt; 15 s</b>latency or failed refresh, over WebSocket</div>
            <div className="login-feat"><span style={{ color: '#3987e5' }}>Cost per view</span><b>Snowflake + AWS</b>attributed to every report</div>
            <div className="login-feat"><span style={{ color: '#199e70' }}>Access control</span><b>4 roles</b>enforced on the server</div>
          </div>
        </div>
        <div className="small" style={{ color: '#5f6b82' }}>Case Study 3 · Technical Data &amp; AI Validation · Rudra Solanki</div>
      </div>

      <div className="login-main">
        <div className="login-card">
          <div className="eyebrow">Sign in</div>
          <h2>Choose a demo identity</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>Each role sees a different dashboard. The server decides what each one may access.</p>

          <div className="demo-users">
            {demo.map((u) => {
              const meta = ROLE_META[u.role] ?? ROLE_META.business_viewer;
              const Icon = meta.icon;
              return (
                <button key={u.id} type="button" className="demo-user" disabled={busy} onClick={() => signIn(u.email, 'demo123')}>
                  <span className="role-ico" style={{ background: `${meta.color}22`, color: meta.color }}><Icon size={18} /></span>
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
