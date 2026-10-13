// Live operations. Alerts arrive over Socket.IO the moment the replayed
// telemetry breaches a rule: load latency over 15 s, or a refresh FAILED / TIMED_OUT.
// Every alert is delivered and counted (no cooldown); grouping only changes the display.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BellOff, Bell, Check, Clock, RefreshCw, Siren } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { Group, Empty, Notice, PageHeader, Panel, Segmented, SeverityBadge, Stat, Legend } from '../components/ui.jsx';
import { ChartTooltip, Donut, axis } from '../components/charts.jsx';
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
  const { alerts, simulator, acknowledge, clearUnseen, toastsOn, setToastsOn } = live;
  const stats = useApi('/api/alerts/stats');
  const [type, setType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [view, setView] = useState('events');
  const [limit, setLimit] = useState(PAGE);
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

  const ofSev = (v) => alerts.filter((a) => a.severity === v).length;
  const ofType = (t) => alerts.filter((a) => a.type === t).length;
  const noisy = useMemo(() => {
    const m = new Map();
    for (const a of alerts) {
      const e = m.get(a.report_id) || { id: a.report_id, latency: 0, refresh: 0 };
      e[a.type === 'LATENCY_BREACH' ? 'latency' : 'refresh'] += 1;
      m.set(a.report_id, e);
    }
    return [...m.values()].sort((x, y) => (y.latency + y.refresh) - (x.latency + x.refresh)).slice(0, 8);
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

  const s = stats.data?.stats;

  return (
    <>
      <PageHeader title="Live operations" />

      <Group title="Alert counts" subtitle="Latency breaches and refresh failures">
      <div className="grid g-4">
        <Stat variant="accent" tone="accent" icon={Bell} label="Alerts received live" value={fmt.num(live.received)} sub="This browser session" />
        <Stat tone="latency" icon={Clock} label="Latency breaches" value={fmt.num(s?.LATENCY_BREACH)} sub={stats.data?.scope === 'all' ? 'Server total since start' : 'Your reports'} />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh failures" value={fmt.num(s?.REFRESH_FAILURE)} sub="FAILED or TIMED_OUT" />
        <Stat tone="warning" icon={Siren} label="Unacknowledged" value={fmt.num(s?.unacknowledged)} sub="Waiting for an owner or admin" />
      </div>
      </Group>

      <Group title="Alert activity" subtitle="Arrival rate, severity, type and the reports raising the most alerts">
      <div className="grid g-main">
        <Panel title="Alert rate" subtitle="Alerts received per 5 seconds, last 2 minutes · updates live">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={rate} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} interval={5} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip showTotal title={(l) => `${l} ago`} names={{ latency: 'Latency breaches', refresh: 'Refresh failures' }} />} />
              <Area type="monotone" dataKey="refresh" stackId="1" stroke={c.refresh} strokeWidth={2} fill="url(#pi-grad-ink)" isAnimationActive={false} />
              <Area type="monotone" dataKey="latency" stackId="1" stroke={c.latency} strokeWidth={2.2} fill="url(#pi-grad-orange)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Latency breach', color: c.latency }, { label: 'Refresh failure', color: c.refresh }]} />
        </Panel>
        <Panel title="By severity" subtitle="Alerts in this feed">
          <Donut centerLabel="alerts" parts={['WARNING', 'HIGH', 'CRITICAL'].map((v) => ({ label: v.charAt(0) + v.slice(1).toLowerCase(), value: ofSev(v), color: c[SEVERITY_KEY[v]] }))} />
          <div className="footnote">Warning 15–30 s · High 30–45 s or refresh failure · Critical &gt; 45 s</div>
        </Panel>
      </div>
      <div className="grid g-main">
        <Panel title="Most alerted reports" subtitle="In this feed · click a bar to open the report">
          {noisy.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={noisy} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }} barCategoryGap="26%">
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...axis(c)} allowDecimals={false} />
                <YAxis type="category" dataKey="id" width={64} {...axis(c)} axisLine={false} interval={0} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal names={{ latency: 'Latency', refresh: 'Refresh' }} />} />
                <Bar dataKey="refresh" stackId="a" fill={c.refresh} cursor="pointer" onClick={(d) => navigate(`/reports/${d.id}`)} />
                <Bar dataKey="latency" stackId="a" fill="url(#pi-bar-orange-h)" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => navigate(`/reports/${d.id}`)} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No alerts yet</Empty>}
          <Legend items={[{ label: 'Latency', color: c.latency }, { label: 'Refresh', color: c.refresh }]} />
        </Panel>
        <Panel title="By type" subtitle="One snapshot can raise both">
          <Donut centerLabel="alerts" parts={[{ label: 'Latency breach', value: ofType('LATENCY_BREACH'), color: c.latency }, { label: 'Refresh failure', value: ofType('REFRESH_FAILURE'), color: c.refresh }]} />
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
