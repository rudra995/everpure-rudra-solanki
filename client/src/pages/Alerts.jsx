// Live alert feed (brief, Task 2). Alerts arrive over Socket.IO the moment the replayed
// telemetry breaches a rule. Every alert is kept and counted; "Group by report" only
// changes how the list is displayed.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Pause, Play, BellOff, Bell } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useApi } from '../api/useApi.js';
import { api } from '../api/http.js';
import { Card, Kpi, Notice, PageHeader, Segmented, SeverityBadge, Empty } from '../components/ui.jsx';
import { fmt } from '../format.js';

const RANK = { WARNING: 1, HIGH: 2, CRITICAL: 3 };
const PAGE = 60;

export default function Alerts() {
  const { can } = useAuth();
  const live = useLive();
  const { alerts, connected, simulator, acknowledge, clearUnseen, toastsOn, setToastsOn } = live;
  const stats = useApi('/api/alerts/stats');
  const [type, setType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [view, setView] = useState('events');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const canAck = can([P.ALERTS_ACK_ALL, P.ALERTS_ACK_OWN]);
  const isAdmin = can(P.ALERTS_READ_ALL);

  // While this page is open, new alerts count as seen.
  useEffect(() => { clearUnseen(); }, [alerts.length, clearUnseen]);
  // Refresh the server-side counters every few seconds.
  useEffect(() => { const t = setInterval(stats.reload, 4000); return () => clearInterval(t); }, [stats.reload]);

  const filtered = useMemo(() => alerts.filter((a) => (type === 'all' || a.type === type)
    && (severity === 'all' || a.severity === severity)), [alerts, type, severity]);

  const groups = useMemo(() => {
    const byReport = new Map();
    for (const a of filtered) {
      const g = byReport.get(a.report_id) || { report_id: a.report_id, report_name: a.report_name, items: [], worst: a.severity, latency: 0, refresh: 0 };
      g.items.push(a);
      if (RANK[a.severity] > RANK[g.worst]) g.worst = a.severity;
      if (a.type === 'LATENCY_BREACH') g.latency += 1; else g.refresh += 1;
      byReport.set(a.report_id, g);
    }
    return [...byReport.values()];
  }, [filtered]);

  async function control(action, intervalMs) {
    setBusy(true);
    try {
      const { simulator: s } = await api.post(`/api/simulator/${action}`, intervalMs ? { interval_ms: intervalMs } : {});
      live.setSimulator((prev) => ({ ...prev, ...s }));
    } finally { setBusy(false); }
  }

  const s = stats.data?.stats;
  const unacked = alerts.filter((a) => !a.acknowledged_at).length;

  return (
    <>
      <PageHeader title="Live alerts"
        subtitle={`An alert is raised every time a dashboard takes longer than 15 s to load or an automated refresh fails or times out. ${isAdmin ? 'You receive alerts for every report.' : 'You receive alerts for the reports you own.'}`}
        actions={<>
          <span className="role-chip"><span className={`live-dot ${connected ? 'on' : ''}`} />{connected ? 'Connected' : 'Reconnecting…'}</span>
          {can(P.SIMULATOR_CONTROL) && (simulator?.running
            ? <button type="button" className="btn" disabled={busy} onClick={() => control('stop')}><Pause size={14} />Pause replay</button>
            : <button type="button" className="btn primary" disabled={busy} onClick={() => control('start')}><Play size={14} />Start replay</button>)}
        </>} />

      <div className="grid grid-4">
        <Kpi label="Received live (this session)" value={fmt.num(live.received)} hint={`Replay cycle ${simulator?.cycle ?? '–'} · snapshot ${simulator?.last_seq ?? '–'} of 20`} />
        <Kpi label="Latency breaches" value={fmt.num(s?.LATENCY_BREACH)} tone="high" hint={stats.data?.scope === 'all' ? 'Server total since start' : 'Your reports, in memory'} />
        <Kpi label="Refresh failures" value={fmt.num(s?.REFRESH_FAILURE)} tone="critical" hint="FAILED or TIMED_OUT" />
        <Kpi label="Unacknowledged" value={fmt.num(s?.unacknowledged)} tone="warning" hint={`${unacked} in this feed`} />
      </div>

      <Card className="mt" flush
        title={view === 'events' ? `${filtered.length} alerts` : `${groups.length} reports with alerts`}
        subtitle="Newest first"
        actions={<>
          <Segmented value={type} onChange={setType} options={[{ value: 'all', label: 'All types' }, { value: 'LATENCY_BREACH', label: 'Latency' }, { value: 'REFRESH_FAILURE', label: 'Refresh' }]} />
          <Segmented value={severity} onChange={setSeverity} options={[{ value: 'all', label: 'All' }, { value: 'WARNING', label: 'Warning' }, { value: 'HIGH', label: 'High' }, { value: 'CRITICAL', label: 'Critical' }]} />
          <Segmented value={view} onChange={setView} options={[{ value: 'events', label: 'Every event' }, { value: 'grouped', label: 'Group by report' }]} />
          <button type="button" className="btn ghost sm" title={toastsOn ? 'Mute critical pop-ups' : 'Show critical pop-ups'} onClick={() => setToastsOn(!toastsOn)}>
            {toastsOn ? <Bell size={15} /> : <BellOff size={15} />}
          </button>
        </>}>
        {filtered.length === 0 && <Empty>{simulator?.running ? 'No alerts match these filters yet.' : 'The replay is paused, so no new alerts are arriving.'}</Empty>}

        {view === 'events' && (
          <ul className="feed">
            {filtered.slice(0, limit).map((a) => (
              <li key={a.id} className={`feed-item sev-${a.severity} ${a.acknowledged_at ? 'acked' : ''} ${a.fresh ? 'fresh' : ''}`}>
                <span className="stripe" />
                <div>
                  <div className="feed-title">{a.message}</div>
                  <div className="feed-meta">
                    <Link to={`/reports/${a.report_id}`}>{a.report_id}</Link>
                    <span>{a.type === 'LATENCY_BREACH' ? 'Latency breach' : 'Refresh failure'}</span>
                    <span>Snapshot {a.snapshot_seq}</span>
                    {isAdmin && <span className="mono">{a.owner ?? 'no owner'}</span>}
                    <span>{fmt.time(a.created_at)}</span>
                    {a.acknowledged_at && <span>Acknowledged by {a.acknowledged_by}</span>}
                  </div>
                </div>
                <div className="row">
                  <SeverityBadge value={a.severity} />
                  {canAck && !a.acknowledged_at && (
                    <button type="button" className="btn sm" onClick={() => acknowledge(a.id).catch(() => {})}><Check size={13} />Ack</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {view === 'grouped' && (
          <ul className="feed">
            {groups.slice(0, limit).map((g) => {
              const open = g.items.filter((a) => !a.acknowledged_at);
              return (
                <li key={g.report_id} className={`feed-item sev-${g.worst} ${open.length ? '' : 'acked'}`}>
                  <span className="stripe" />
                  <div>
                    <div className="feed-title row" style={{ gap: 8 }}>
                      <Link to={`/reports/${g.report_id}`}>{g.report_id}</Link>
                      <span className="faint" style={{ fontWeight: 400 }}>{g.report_name}</span>
                      <span className="count-pill">×{g.items.length}</span>
                    </div>
                    <div className="feed-meta">
                      <span>{g.latency} latency · {g.refresh} refresh</span>
                      <span>Latest: {g.items[0].message}</span>
                      <span>{fmt.time(g.items[0].created_at)}</span>
                    </div>
                  </div>
                  <div className="row">
                    <SeverityBadge value={g.worst} />
                    {canAck && open.length > 0 && (
                      <button type="button" className="btn sm" onClick={() => Promise.all(open.map((a) => acknowledge(a.id))).catch(() => {})}>
                        <Check size={13} />Ack {open.length}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(view === 'events' ? filtered.length : groups.length) > limit && (
          <div className="table-foot" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn sm" onClick={() => setLimit(limit + PAGE)}>Show more</button>
          </div>
        )}
      </Card>

      <div className="mt">
        <Notice>
          No cooldown and no suppression: the brief says alerts fire <i>whenever</i> a rule is breached, so every breach is delivered and counted.
          Severity (WARNING 15–30 s, HIGH 30–45 s, CRITICAL over 45 s) helps prioritise; grouping changes the display only.
          UNKNOWN refresh status is treated as &quot;needs review&quot;, not a failure.
        </Notice>
      </div>
    </>
  );
}
