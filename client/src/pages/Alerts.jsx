// Live alerts (brief, Task 2). The server pushes an alert over WebSocket the moment a
// dashboard takes longer than 15 s to load or an automated refresh fails / times out.
// Every alert is delivered and counted (no cooldown); grouping only changes the display.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bell, BellOff, Check } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { Empty, Legend, Notice, PageHeader, Panel, Segmented, SeverityBadge, Stat } from '../components/ui.jsx';
import { ChartTooltip, axis } from '../components/charts.jsx';
import { AlertIcon, AlertRow } from '../components/LiveWidgets.jsx';
import { fmt } from '../format.js';

const RANK = { WARNING: 1, HIGH: 2, CRITICAL: 3 };
const PAGE = 15;
const BUCKET_SEC = 5;
const WINDOW = 24; // 24 x 5 s = last 2 minutes

export default function Alerts() {
  const { can } = useAuth();
  const { c } = useTheme();
  const { alerts, connected, acknowledge, clearUnseen, toastsOn, setToastsOn } = useLive();
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

  // Alerts received per 5-second bucket over the last 2 minutes, split by type.
  const rate = useMemo(() => {
    const end = Math.floor(now / (BUCKET_SEC * 1000)) * BUCKET_SEC * 1000;
    const b = Array.from({ length: WINDOW }, (_, i) => ({ t: end - (WINDOW - 1 - i) * BUCKET_SEC * 1000, latency: 0, refresh: 0 }));
    for (const a of alerts) {
      if (!a.receivedAt || a.receivedAt < b[0].t) continue;
      const i = Math.min(WINDOW - 1, Math.floor((a.receivedAt - b[0].t) / (BUCKET_SEC * 1000)));
      b[i][a.type === 'LATENCY_BREACH' ? 'latency' : 'refresh'] += 1;
    }
    return b.map((x) => ({ ...x, label: x.t === end ? 'now' : `${Math.round((end - x.t) / 1000)}s ago` }));
  }, [alerts, now]);

  const sevMix = ['WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ s, label: s.charAt(0) + s.slice(1).toLowerCase(), n: alerts.filter((a) => a.severity === s).length }));
  const filtered = useMemo(() => alerts.filter((a) => (type === 'all' || a.type === type) && (severity === 'all' || a.severity === severity)), [alerts, type, severity]);
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
  const ack = (id) => acknowledge(id).catch(() => {});

  return (
    <>
      <PageHeader index="03" eyebrow="Live alerts · Task 2" title="Live alerts"
        subtitle={`Pushed to your screen the moment a report takes longer than 15 seconds to load or an automated refresh fails. ${isAdmin ? 'You see alerts for every report.' : 'You only see alerts for reports you own.'}`}
        actions={<span className="pill"><span className={`live-dot ${connected ? 'on' : ''}`} />{connected ? 'Receiving live' : 'Reconnecting…'}</span>} />

      <div className="grid g-3">
        <Stat tone="latency" label="Slow-load alerts" value={fmt.num(s?.LATENCY_BREACH)} sub="Load time over 15 s" />
        <Stat tone="refresh" label="Failed-refresh alerts" value={fmt.num(s?.REFRESH_FAILURE)} sub="Refresh failed or timed out" />
        <Stat tone="warning" label="Waiting for acknowledgement" value={fmt.num(s?.unacknowledged)} sub={isAdmin ? 'Across all reports' : 'On your reports'} />
      </div>

      <div className="grid g-main mt">
        <Panel title="Alerts arriving, last 2 minutes" subtitle="Number of alerts received every 5 seconds. Updates live.">
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={rate} margin={{ top: 6, right: 6, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="g-lat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.latency} stopOpacity={0.35} /><stop offset="100%" stopColor={c.latency} stopOpacity={0.02} /></linearGradient>
                <linearGradient id="g-ref" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.refresh} stopOpacity={0.35} /><stop offset="100%" stopColor={c.refresh} stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} interval={5} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip showTotal names={{ latency: 'Slow loads', refresh: 'Failed refreshes' }} />} />
              <Area type="monotone" dataKey="latency" stackId="1" stroke={c.latency} strokeWidth={2} fill="url(#g-lat)" isAnimationActive={false} />
              <Area type="monotone" dataKey="refresh" stackId="1" stroke={c.refresh} strokeWidth={2} fill="url(#g-ref)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Slow load', color: c.latency }, { label: 'Failed refresh', color: c.refresh }]} />
        </Panel>
        <Panel title="How serious" subtitle="Alerts in this feed by severity">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={sevMix} layout="vertical" margin={{ top: 4, right: 40, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={70} {...axis(c)} axisLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip names={{ n: 'Alerts' }} />} />
              <Bar dataKey="n" radius={[0, 6, 6, 0]}>
                {sevMix.map((x) => <Cell key={x.s} fill={c[SEVERITY_KEY[x.s]]} />)}
                <LabelList dataKey="n" position="right" style={{ fill: c.text, fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="xs faint">Warning 15–30 s · High 30–45 s or a failed refresh · Critical over 45 s</div>
        </Panel>
      </div>

      <Panel className="mt" flush bordered
        title={view === 'events' ? 'Alert feed' : 'Alert feed, grouped by report'}
        subtitle={`${fmt.num(filtered.length)} alerts, newest first`}
        actions={<>
          <Segmented value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, { value: 'LATENCY_BREACH', label: 'Slow load', color: c.latency }, { value: 'REFRESH_FAILURE', label: 'Failed refresh', color: c.refresh }]} />
          <Segmented value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'Any severity' }, { value: 'CRITICAL', label: 'Critical', color: c.critical }, { value: 'HIGH', label: 'High', color: c.serious }, { value: 'WARNING', label: 'Warning', color: c.warning }]} />
          <Segmented value={view} onChange={setView} options={[{ value: 'events', label: 'Every alert' }, { value: 'grouped', label: 'By report' }]} />
          <button type="button" className="icon-btn" title={toastsOn ? 'Mute pop-ups for critical alerts' : 'Show pop-ups for critical alerts'} onClick={() => setToastsOn(!toastsOn)}>
            {toastsOn ? <Bell size={15} /> : <BellOff size={15} />}
          </button>
        </>}>
        {filtered.length === 0 && <Empty>No alerts match these filters yet.</Empty>}
        {view === 'events' && (
          <ul className="feed">
            {filtered.slice(0, limit).map((a) => <AlertRow key={a.id} a={a} showOwner={isAdmin} onAck={canAck ? ack : null} />)}
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
                      <span className="count-pill">{g.items.length} alerts</span>
                    </div>
                    <div className="feed-meta"><span>{g.latency} slow loads</span><span>{g.refresh} failed refreshes</span><span>latest: {g.items[0].message}</span></div>
                  </div>
                  <div className="row">
                    <SeverityBadge value={g.worst} />
                    {canAck && open.length > 0 && <button type="button" className="btn sm" onClick={() => Promise.all(open.map((a) => acknowledge(a.id))).catch(() => {})}><Check size={13} />Acknowledge {open.length}</button>}
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
          <b>Every breach is alerted.</b> The brief says alerts fire <i>whenever</i> a rule is broken, so there is no cooldown or suppression:
          one full pass over the data produces 1,490 slow-load and 564 failed-refresh alerts, exactly the counts on the Data quality page.
          Grouping by report only tidies the display.
        </Notice>
      </div>
    </>
  );
}
