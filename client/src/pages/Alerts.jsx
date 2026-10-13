// Live operations (brief, Task 2). Alerts arrive over Socket.IO the moment the replayed
// telemetry breaches a rule: load latency over 15 s, or a refresh FAILED / TIMED_OUT.
// Every alert is delivered and counted (no cooldown); grouping only changes the display.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BellOff, Bell, Check, Clock, Pause, Play, Radio, RefreshCw, Siren, Zap } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useApi } from '../api/useApi.js';
import { api } from '../api/http.js';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { Group, Empty, Notice, PageHeader, Panel, Segmented, SeverityBadge, Stat, Legend } from '../components/ui.jsx';
import { ChartTooltip, axis } from '../components/charts.jsx';
import { AlertIcon, AlertRow } from '../components/LiveWidgets.jsx';
import { fmt } from '../format.js';

const RANK = { WARNING: 1, HIGH: 2, CRITICAL: 3 };
const PAGE = 50;
const BUCKET_SEC = 5;
const WINDOW_BUCKETS = 24; // 2 minutes

export default function Alerts() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { c } = useTheme();
  const live = useLive();
  const { alerts, connected, simulator, session, acknowledge, clearUnseen, toastsOn, setToastsOn } = live;
  const stats = useApi('/api/alerts/stats');
  const [type, setType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [view, setView] = useState('events');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const canAck = can([P.ALERTS_ACK_ALL, P.ALERTS_ACK_OWN]);
  const isAdmin = can(P.ALERTS_READ_ALL);

  useEffect(() => { clearUnseen(); }, [alerts.length, clearUnseen]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(stats.reload, 4000); return () => clearInterval(t); }, [stats.reload]);

  // Alerts per 5-second bucket over the last 2 minutes, by type (client receive time).
  const rate = useMemo(() => {
    const end = Math.floor(now / 1000 / BUCKET_SEC) * BUCKET_SEC * 1000;
    const buckets = Array.from({ length: WINDOW_BUCKETS }, (_, i) => ({ t: end - (WINDOW_BUCKETS - 1 - i) * BUCKET_SEC * 1000, latency: 0, refresh: 0 }));
    const start = buckets[0].t;
    for (const a of alerts) {
      if (!a.receivedAt || a.receivedAt < start) continue;
      const i = Math.min(WINDOW_BUCKETS - 1, Math.floor((a.receivedAt - start) / (BUCKET_SEC * 1000)));
      buckets[i][a.type === 'LATENCY_BREACH' ? 'latency' : 'refresh'] += 1;
    }
    return buckets.map((b) => ({ ...b, label: `${Math.round((b.t - end) / 1000)}s` }));
  }, [alerts, now]);

  const liveOnly = alerts.filter((a) => a.receivedAt);
  const sevMix = ['WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ s, n: liveOnly.filter((a) => a.severity === s).length }));
  const noisy = useMemo(() => {
    const m = new Map();
    for (const a of alerts) m.set(a.report_id, (m.get(a.report_id) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n }));
  }, [alerts]);

  const filtered = useMemo(() => alerts.filter((a) => (type === 'all' || a.type === type)
    && (severity === 'all' || a.severity === severity)), [alerts, type, severity]);
  const groups = useMemo(() => {
    const by = new Map();
    for (const a of filtered) {
      const g = by.get(a.report_id) || { report_id: a.report_id, report_name: a.report_name, items: [], worst: a.severity, latency: 0, refresh: 0 };
      g.items.push(a);
      if (RANK[a.severity] > RANK[g.worst]) g.worst = a.severity;
      if (a.type === 'LATENCY_BREACH') g.latency += 1; else g.refresh += 1;
      by.set(a.report_id, g);
    }
    return [...by.values()];
  }, [filtered]);

  async function control(action, intervalMs) {
    setBusy(true);
    try {
      const { simulator: s } = await api.post(`/api/simulator/${action}`, intervalMs ? { interval_ms: intervalMs } : {});
      live.setSimulator((prev) => ({ ...prev, ...s }));
    } finally { setBusy(false); }
  }

  const s = stats.data?.stats;
  const perMin = rate.slice(-12).reduce((a, b) => a + b.latency + b.refresh, 0);
  const uptime = session?.connectedAt ? Math.round((now - session.connectedAt) / 1000) : 0;

  return (
    <>
      <PageHeader eyebrow="Task 2 · Real-time telemetry & alerting" title="Live operations"
        subtitle={`Alerts are pushed over WebSocket the moment a dashboard takes longer than 15 s to load or an automated refresh fails. ${isAdmin ? 'You receive every report\'s alerts.' : 'You receive alerts for the reports you own only.'}`}
        actions={can(P.SIMULATOR_CONTROL) && (
          <>
            {simulator?.running
              ? <button type="button" className="btn" disabled={busy} onClick={() => control('stop')}><Pause size={14} />Pause replay</button>
              : <button type="button" className="btn primary" disabled={busy} onClick={() => control('start')}><Play size={14} />Start replay</button>}
            <Segmented value={String(simulator?.interval_ms ?? 1000)} onChange={(v) => control('start', Number(v))}
              options={[{ value: '1000', label: '1×' }, { value: '500', label: '2×' }, { value: '250', label: '4×' }]} />
          </>
        )} />

      <Group title="Session" subtitle="Connection, replay and alert counts">
      <div className="grid g-main">
        <Panel title="WebSocket session" icon={Radio} iconColor={connected ? c.good : c.critical}
          subtitle="Socket.IO connection authenticated with your JWT at the handshake. The server only emits to the rooms your role joins.">
          <div className="grid g-4" style={{ gap: 18 }}>
            <div><div className="xs faint">Status</div><div className="row strong" style={{ gap: 7, marginTop: 4 }}><span className={`live-dot ${connected ? 'on' : ''}`} />{connected ? 'Connected' : 'Reconnecting…'}</div></div>
            <div><div className="xs faint">Transport</div><div className="strong" style={{ marginTop: 4 }}>{session?.transport ?? '—'}</div></div>
            <div><div className="xs faint">Connected for</div><div className="strong num" style={{ marginTop: 4 }}>{connected ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : '—'}</div></div>
            <div><div className="xs faint">Events received</div><div className="strong num" style={{ marginTop: 4 }}>{fmt.num(live.received + live.telemetryCount)}</div></div>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="xs faint" style={{ marginBottom: 7 }}>Rooms joined (decided by the server from your permissions)</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {(session?.rooms ?? []).map((r) => <span key={r} className="room"><Zap size={11} color={c.accent} />{r}</span>)}
              {!session?.rooms?.length && <span className="faint small">—</span>}
            </div>
          </div>
        </Panel>
        <Panel title="Telemetry replay" icon={Activity} iconColor={c.accent} subtitle="The source file is static, so snapshots are replayed one by one as live telemetry.">
          <div className="row between"><span className="muted small">Snapshot</span><b className="num">{simulator?.last_seq ? `#${simulator.last_seq} of 20` : '—'}</b></div>
          <div className="progress" style={{ margin: '8px 0 14px' }}><span style={{ width: `${((simulator?.last_seq ?? 0) / 20) * 100}%` }} /></div>
          <div className="dl" style={{ gridTemplateColumns: '1fr auto' }}>
            <dt>State</dt><dd className="strong" style={{ color: simulator?.running ? c.good : c.warning }}>{simulator?.running ? 'Running' : 'Paused'}</dd>
            <dt>Cycle</dt><dd>{simulator?.cycle ?? '—'}</dd>
            <dt>Speed</dt><dd>{simulator ? `${1000 / simulator.interval_ms} snapshots / s` : '—'}</dd>
            <dt>Alert rate (last 60 s)</dt><dd className="strong">{perMin} / min</dd>
          </div>
        </Panel>
      </div>

      <div className="grid g-4 mt">
        <Stat variant="accent" tone="accent" icon={Bell} label="Alerts received live" value={fmt.num(live.received)} sub="This browser session" />
        <Stat tone="latency" icon={Clock} label="Latency breaches" value={fmt.num(s?.LATENCY_BREACH)} sub={stats.data?.scope === 'all' ? 'Server total since start' : 'Your reports'} />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh failures" value={fmt.num(s?.REFRESH_FAILURE)} sub="FAILED or TIMED_OUT" />
        <Stat tone="warning" icon={Siren} label="Unacknowledged" value={fmt.num(s?.unacknowledged)} sub="Waiting for an owner or admin" />
      </div>
      </Group>

      <Group title="Alert activity" subtitle="Rate, severity and noisiest reports">
      <div className="grid g-main mt">
        <Panel title="Alert rate" subtitle="Alerts received per 5 seconds, last 2 minutes · updates live">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={rate} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="g-lat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.latency} stopOpacity={0.5} /><stop offset="100%" stopColor={c.latency} stopOpacity={0.05} /></linearGradient>
                <linearGradient id="g-ref" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.refresh} stopOpacity={0.5} /><stop offset="100%" stopColor={c.refresh} stopOpacity={0.05} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} interval={5} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip showTotal title={(l) => `${l} ago`} names={{ latency: 'Latency breaches', refresh: 'Refresh failures' }} />} />
              <Area type="monotone" dataKey="latency" stackId="1" stroke={c.latency} strokeWidth={2} fill="url(#g-lat)" isAnimationActive={false} />
              <Area type="monotone" dataKey="refresh" stackId="1" stroke={c.refresh} strokeWidth={2} fill="url(#g-ref)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Latency breach', color: c.latency }, { label: 'Refresh failure', color: c.refresh }]} />
        </Panel>
        <Panel title="Noisiest reports" subtitle="Most alerts in this feed · click to open">
          {noisy.length ? (
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={noisy} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }} barCategoryGap="28%">
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="id" width={66} {...axis(c)} axisLine={false} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip names={{ n: 'Alerts' }} />} />
                <Bar dataKey="n" fill={c.accent} radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => navigate(`/reports/${d.id}`)} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No alerts yet</Empty>}
          <div className="small muted" style={{ margin: '6px 0 8px' }}>Severity mix (received live)</div>
          <div className="legend">
            {sevMix.map(({ s: sv, n }) => <span key={sv}><span className="sw" style={{ background: c[SEVERITY_KEY[sv]] }} />{sv}<b>{n}</b></span>)}
          </div>
        </Panel>
      </div>
      </Group>

      <Group title="Alert stream">
      <Panel className="mt" flush bordered
        title={view === 'events' ? `Alert stream · ${fmt.num(filtered.length)} events` : `Grouped · ${groups.length} reports`}
        subtitle="Newest first. Grouping changes the display only; every event is still delivered and counted."
        actions={<>
          <Segmented value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, { value: 'LATENCY_BREACH', label: 'Latency', color: c.latency }, { value: 'REFRESH_FAILURE', label: 'Refresh', color: c.refresh }]} />
          <Segmented value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'Any' }, { value: 'WARNING', label: 'Warning', color: c.warning }, { value: 'HIGH', label: 'High', color: c.serious }, { value: 'CRITICAL', label: 'Critical', color: c.critical }]} />
          <Segmented value={view} onChange={setView} options={[{ value: 'events', label: 'Every event' }, { value: 'grouped', label: 'By report' }]} />
          <button type="button" className="icon-btn" title={toastsOn ? 'Mute critical pop-ups' : 'Show critical pop-ups'} onClick={() => setToastsOn(!toastsOn)}>
            {toastsOn ? <Bell size={15} /> : <BellOff size={15} />}
          </button>
        </>}>
        {filtered.length === 0 && <Empty>{simulator?.running ? 'No alerts match these filters yet.' : 'The replay is paused, so no new alerts are arriving.'}</Empty>}
        {view === 'events' && (
          <ul className="feed">
            {filtered.slice(0, limit).map((a) => <AlertRow key={a.id} a={a} showOwner={isAdmin} onAck={canAck ? (id) => acknowledge(id).catch(() => {}) : null} />)}
          </ul>
        )}
        {view === 'grouped' && (
          <ul className="feed">
            {groups.slice(0, limit).map((g) => {
              const open = g.items.filter((a) => !a.acknowledged_at);
              return (
                <li key={g.report_id} className={`feed-item ${open.length ? '' : 'acked'}`}>
                  <AlertIcon type={g.latency >= g.refresh ? 'LATENCY_BREACH' : 'REFRESH_FAILURE'} />
                  <div>
                    <div className="feed-title row" style={{ gap: 8 }}>
                      <Link to={`/reports/${g.report_id}`}>{g.report_id}</Link><span className="faint" style={{ fontWeight: 400 }}>{g.report_name}</span>
                      <span className="count-pill">×{g.items.length}</span>
                    </div>
                    <div className="feed-meta"><span style={{ color: c.latency }}>{g.latency} latency</span><span style={{ color: c.refresh }}>{g.refresh} refresh</span><span>latest: {g.items[0].message}</span></div>
                  </div>
                  <div className="row">
                    <SeverityBadge value={g.worst} />
                    {canAck && open.length > 0 && <button type="button" className="btn sm" onClick={() => Promise.all(open.map((a) => acknowledge(a.id))).catch(() => {})}><Check size={13} />Ack {open.length}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(view === 'events' ? filtered.length : groups.length) > limit && (
          <div className="table-foot" style={{ justifyContent: 'center' }}><button type="button" className="btn sm" onClick={() => setLimit(limit + PAGE)}>Show more</button></div>
        )}
      </Panel>

      <div className="mt">
        <Notice>
          <b>No cooldown, no suppression.</b> The brief says alerts fire <i>whenever</i> a rule is breached, so every breach is delivered and counted
          (one full replay = 1,490 latency + 564 refresh alerts, exactly the data-quality counts). Severity tiers (WARNING 15–30 s, HIGH 30–45 s,
          CRITICAL over 45 s) help people prioritise. UNKNOWN refresh status means &quot;needs review&quot; and does not alert.
        </Notice>
      </div>
      </Group>
    </>
  );
}
