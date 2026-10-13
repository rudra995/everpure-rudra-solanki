// Command-centre overview. Every block loads only if the role has the permission for it;
// the numbers are scoped by the server (a Report Owner only ever sees their own reports).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Cloud, Eye, FileWarning, Gauge, RefreshCw, ShieldCheck, Snowflake, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { ErrorState, Loading, Notice, PageHeader, Panel, Segmented, SplitBar, Stat, Legend } from '../components/ui.jsx';
import { Heatmap, heatLegend } from '../components/charts.jsx';
import { AlertStream, TelemetryTape } from '../components/LiveWidgets.jsx';
import { bySnapshot } from '../data.js';
import { fmt } from '../format.js';
import { costTotals } from './Cost.jsx';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

export default function Overview() {
  const { user, can } = useAuth();
  const { c } = useTheme();
  const live = useLive();
  const health = useApi('/api/health/reports');
  const snapsQ = useApi('/api/health/snapshots');
  const costAll = useApi(can(P.COST_READ_ALL) ? '/api/cost/summary' : null);
  const costOwn = useApi(!can(P.COST_READ_ALL) && can(P.COST_READ_OWN) ? '/api/cost/reports' : null);
  const orphaned = useApi(can(P.ORPHANED_READ) ? '/api/orphaned' : null);
  const dq = useApi(can(P.DQ_READ_SUMMARY) ? '/api/data-quality/summary' : null);
  const [metric, setMetric] = useState('latency');

  const snaps = snapsQ.data?.snapshots ?? [];
  const series = useMemo(() => bySnapshot(snaps), [snaps]);

  if (health.loading) return <Loading />;
  if (health.error) return <ErrorState error={health.error} />;

  const reports = health.data.reports;
  const count = (fn) => reports.filter(fn).length;
  const sev = (s) => count((r) => r.latest_latency_severity === s);
  const status = (s) => count((r) => r.latest_refresh_status === s);
  const scopeOwn = health.data.scope === 'own';
  const avgLatency = snaps.length ? snaps.reduce((a, r) => a + Number(r.avg_load_time_sec), 0) / snaps.length : null;
  const views = snaps.reduce((a, r) => a + Number(r.monthly_active_views || 0), 0);

  let cost = null;
  if (costAll.data) {
    const s = costAll.data.summary;
    cost = { snow: Number(s.credit_cost_usd), aws: Number(s.aws_cost_usd), snowPV: Number(s.credit_cost_per_view_usd), totalPV: Number(s.fully_loaded_cost_per_view_usd) };
  } else if (costOwn.data) {
    const t = costTotals(costOwn.data.reports);
    cost = { snow: t.snowflake, aws: t.aws, snowPV: t.snowPerView, totalPV: t.totalPerView };
  }

  return (
    <>
      <PageHeader eyebrow={scopeOwn ? 'Your reports' : 'Platform overview'}
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle={scopeOwn
          ? `Health, cost and alerts for the ${reports.length} reports you own.`
          : 'Health of all 100 portal reports. "Now" means each report\'s latest snapshot (20 of 20).'}
        actions={live.simulator?.running && <span className="pill"><span className="live-dot on" />Replaying snapshot <b>#{live.simulator.last_seq ?? '–'}</b> · cycle {live.simulator.cycle}</span>} />

      <div className="grid g-6">
        <Stat tone="accent" icon={Gauge} label={scopeOwn ? 'Your reports' : 'Reports monitored'} value={reports.length} sub={`${fmt.num(snaps.length)} snapshots analysed`} />
        <Stat tone="latency" icon={Clock} label="Avg load time" value={fmt.sec(avgLatency)} sub="Across all snapshots" spark={series} sparkKey="avgLatency" />
        <Stat tone="serious" icon={AlertTriangle} label="Over 15 s now" value={count((r) => r.latest_latency_severity !== 'OK')} sub={`${sev('CRITICAL')} critical (over 45 s)`} spark={series} sparkKey="breachRate" />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh failing now" value={status('FAILED') + status('TIMED_OUT')} sub={`${status('FAILED')} failed · ${status('TIMED_OUT')} timed out`} spark={series} sparkKey="failureRate" />
        <Stat tone="ownership" icon={FileWarning} label="Orphaned now" value={count((r) => r.currently_orphaned)} sub="No owner on latest snapshot" />
        <Stat tone="usage" icon={Eye} label="Monthly active views" value={fmt.compact(views)} sub="Sum over snapshots" spark={series} sparkKey="views" />
      </div>

      <div className="grid g-main mt">
        <Panel title="Report health map" subtitle="Every report (columns) × snapshots 1–20 (rows). Hover a cell for detail, click to open the report."
          actions={<Segmented value={metric} onChange={setMetric} options={[
            { value: 'latency', label: 'Latency', color: c.latency }, { value: 'refresh', label: 'Refresh', color: c.refresh },
            { value: 'ownership', label: 'Ownership', color: c.ownership }]} />}>
          {snapsQ.loading ? <div className="skeleton" style={{ height: 260 }} /> : <Heatmap rows={snaps} metric={metric} rowHeight={17} />}
          <div style={{ marginTop: 12 }}><Legend items={heatLegend(metric, c)} /></div>
        </Panel>

        <div className="stack">
          {cost ? (
            <div className="hero">
              <div className="hero-label">{scopeOwn ? 'Your cost per active view' : 'Cost per active user view'}</div>
              <div className="hero-value">{fmt.usd(cost.totalPV, 4)}</div>
              <div className="hero-eq">
                <span className="row" style={{ gap: 5 }}><Snowflake size={14} color={c.snowflake} /><b>{fmt.usd(cost.snowPV, 4)}</b></span>
                <span>+</span>
                <span className="row" style={{ gap: 5 }}><Cloud size={14} color={c.aws} /><b>{fmt.usd(cost.totalPV - cost.snowPV, 4)}</b></span>
              </div>
              <div style={{ marginTop: 16 }}>
                <SplitBar parts={[
                  { label: 'Snowflake', value: cost.snow, color: c.snowflake, display: fmt.usdCompact(cost.snow) },
                  { label: 'AWS', value: cost.aws, color: c.aws, display: fmt.usdCompact(cost.aws) },
                ]} />
              </div>
              <Link to="/cost" className="btn sm" style={{ marginTop: 14 }}>Cost attribution <ArrowRight size={13} /></Link>
            </div>
          ) : (
            <Panel title="Your access"><Notice>Your role sees platform health only. Cost, owner details and alerts belong to other roles; the server enforces this on every request.</Notice></Panel>
          )}
          <Panel title="Right now" subtitle="Latest snapshot of each report">
            <div className="stack" style={{ gap: 16 }}>
              <div>
                <div className="small muted" style={{ marginBottom: 7 }}>Load latency</div>
                <SplitBar thin parts={['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ label: s === 'OK' ? 'OK' : s, value: sev(s), color: c[SEVERITY_KEY[s]], display: sev(s) }))} />
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 7 }}>Automated refresh</div>
                <SplitBar thin parts={['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({ label: s.replace('_', ' '), value: status(s), color: c[STATUS_KEY[s]], display: status(s) }))} />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className={`grid ${live.receivesAlerts ? 'g-main' : ''} mt`}>
        {live.receivesAlerts && (
          <Panel flush bordered title="Live alert stream" subtitle={`${fmt.num(live.received)} delivered over WebSocket this session · every breach, no cooldown`}
            actions={<Link to="/alerts" className="btn sm">Open operations <ArrowRight size={13} /></Link>}>
            <AlertStream limit={6} compact />
          </Panel>
        )}
        <Panel title="Live telemetry" subtitle="Snapshots streaming from the replay">
          <TelemetryTape limit={live.receivesAlerts ? 6 : 12} />
        </Panel>
      </div>

      {(orphaned.data || dq.data) && (
        <div className="grid g-2 mt">
          {orphaned.data && (
            <Panel title="Orphaned reports" icon={FileWarning} iconColor={c.ownership} actions={<Link to="/orphaned" className="btn sm">Review</Link>}>
              <div className="grid g-3">
                <div><div className="stat-value" style={{ marginTop: 0 }}>{orphaned.data.summary.orphaned_records}</div><div className="stat-sub">orphaned records</div></div>
                <div><div className="stat-value" style={{ marginTop: 0, color: c.ownership }}>{orphaned.data.summary.reports_currently_orphaned}</div><div className="stat-sub">reports orphaned now</div></div>
                <div><div className="stat-value" style={{ marginTop: 0 }}>{orphaned.data.summary.reports_ever_orphaned}</div><div className="stat-sub">ever orphaned</div></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <SplitBar thin parts={[
                  { label: 'Missing email (NaN)', value: orphaned.data.summary.missing_email_records, color: c.ownership, display: orphaned.data.summary.missing_email_records },
                  { label: 'ORPHANED_REPORT', value: orphaned.data.summary.sentinel_records, color: c.aws, display: orphaned.data.summary.sentinel_records },
                ]} />
              </div>
            </Panel>
          )}
          {dq.data && (
            <Panel title="Data validation" icon={ShieldCheck} iconColor={c.good} actions={<Link to="/data-quality" className="btn sm">Details</Link>}>
              <div className="row" style={{ gap: 14 }}>
                {dq.data.reconciliation_passed ? <CheckCircle2 size={34} color={c.good} /> : <XCircle size={34} color={c.critical} />}
                <div>
                  <div className="stat-value" style={{ marginTop: 0 }}>{dq.data.reconciliation.filter((x) => x.status === 'PASS').length} / {dq.data.reconciliation.length}</div>
                  <div className="stat-sub">reconciliation checks pass: no rows lost, totals agree between raw data, staging and cost marts</div>
                </div>
              </div>
              <div className="legend" style={{ marginTop: 14 }}>
                {['orphaned_owner_nan', 'negative_credits', 'latency_over_15s', 'aws_cost_usage_mismatch'].map((r) => {
                  const row = dq.data.rules.find((x) => x.rule === r);
                  return <span key={r}><span className="sw" style={{ background: c.accent }} />{r.replace(/_/g, ' ')}<b>{row?.rows_flagged}</b></span>;
                })}
              </div>
            </Panel>
          )}
        </div>
      )}
    </>
  );
}
