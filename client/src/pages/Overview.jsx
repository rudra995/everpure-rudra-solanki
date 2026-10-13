// Command-centre overview. Every block loads only if the role has the permission for it;
// the numbers are scoped by the server (a Report Owner only ever sees their own reports).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Clock, Cloud, Eye, FileWarning, Gauge, RefreshCw, ShieldCheck, Snowflake, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { Group, ErrorState, Loading, Notice, PageHeader, Panel, Segmented, SplitBar, Stat, Legend } from '../components/ui.jsx';
import { ChartTooltip, Donut, Heatmap, axis, heatLegend } from '../components/charts.jsx';
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
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`} />

      <Group title="Platform status" subtitle="Latest snapshot of every report">
      <div className="grid g-6">
        <Stat variant="accent" tone="accent" icon={Gauge} label={scopeOwn ? 'Your reports' : 'Reports monitored'} value={reports.length} sub={`${fmt.num(snaps.length)} snapshots analysed`} />
        <Stat tone="latency" icon={Clock} label="Avg load time" value={fmt.sec(avgLatency)} sub="Across all snapshots" spark={series} sparkKey="avgLatency" />
        <Stat tone="serious" icon={AlertTriangle} label="Over 15 s now" value={count((r) => r.latest_latency_severity !== 'OK')} sub={`${sev('CRITICAL')} critical (over 45 s)`} spark={series} sparkKey="breachRate" />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh failing now" value={status('FAILED') + status('TIMED_OUT')} sub={`${status('FAILED')} failed · ${status('TIMED_OUT')} timed out`} spark={series} sparkKey="failureRate" />
        <Stat tone="ownership" icon={FileWarning} label="Orphaned now" value={count((r) => r.currently_orphaned)} sub="No owner on latest snapshot" />
        <Stat tone="usage" icon={Eye} label="Monthly active views" value={fmt.compact(views)} sub="Sum over snapshots" spark={series} sparkKey="views" />
      </div>
      </Group>

      <Group title="Health and cost" subtitle="Where reports are slow, failing or unowned, and what a view costs">
      <div className="grid g-main mt">
        <Panel title="Report health map" subtitle="Every report (columns) × snapshots 1–20 (rows). Hover a cell for detail, click to open the report."
          actions={<Segmented value={metric} onChange={setMetric} options={[
            { value: 'latency', label: 'Latency', color: c.latency }, { value: 'refresh', label: 'Refresh', color: c.refresh },
            { value: 'ownership', label: 'Ownership', color: c.ownership }]} />}>
          {snapsQ.loading ? <div className="skeleton" style={{ height: 260 }} /> : <Heatmap rows={snaps} metric={metric} />}
          <div style={{ marginTop: 12 }}><Legend items={heatLegend(metric, c)} /></div>
        </Panel>

        <div className="stack">
          {cost ? (
            <div className="hero">
              <div className="hero-label">{scopeOwn ? 'Your cost per active view' : 'Cost per active user view'}</div>
              <div className="hero-value">{fmt.usd(cost.totalPV, 4)}</div>
              <div className="hero-eq">
                <span className="row" style={{ gap: 5 }}><Snowflake size={14} color={'var(--hero-snow)'} /><b>{fmt.usd(cost.snowPV, 4)}</b></span>
                <span>+</span>
                <span className="row" style={{ gap: 5 }}><Cloud size={14} color={c.aws} /><b>{fmt.usd(cost.totalPV - cost.snowPV, 4)}</b></span>
              </div>
              <div style={{ marginTop: 16 }}>
                <SplitBar parts={[
                  { label: 'Snowflake', value: cost.snow, color: 'var(--hero-snow)', display: fmt.usdCompact(cost.snow) },
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
      </Group>

      <Group title="Trends across snapshots" subtitle="Snapshots 1–20 in file order (the data has no dates)">
      <div className="grid g-3">
        {can([P.COST_READ_ALL, P.COST_READ_OWN]) ? (
          <Panel title="Spend by snapshot" subtitle="Snowflake compute + AWS hosting">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 2 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="seq" {...axis(c)} interval={1} />
                <YAxis {...axis(c)} axisLine={false} width={46} tickFormatter={fmt.usdCompact} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`} names={{ snowflake: 'Snowflake', aws: 'AWS' }} format={(v) => fmt.usd(v, 0)} />} />
                <Bar dataKey="snowflake" stackId="a" fill={c.snowflake} />
                <Bar dataKey="aws" stackId="a" fill="url(#pi-bar-orange)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <Legend items={[{ label: 'Snowflake', color: c.snowflake }, { label: 'AWS', color: c.aws }]} />
          </Panel>
        ) : (
          <Panel title="Refresh failures by snapshot" subtitle="Failed + timed out">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="seq" {...axis(c)} interval={1} />
                <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`} names={{ FAILED: 'Failed', TIMED_OUT: 'Timed out' }} />} />
                <Bar dataKey="FAILED" stackId="a" fill={c.ink} />
                <Bar dataKey="TIMED_OUT" stackId="a" fill="url(#pi-bar-orange)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        )}
        <Panel title="Average load time" subtitle="Mean across reports · dashed line = 15 s threshold">
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="seq" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} unit="s" domain={[0, 45]} />
              <Tooltip content={<ChartTooltip title={(l) => `Snapshot ${l}`} names={{ avgLatency: 'Avg load time' }} format={(v) => `${v.toFixed(1)} s`} />} />
              <ReferenceLine y={15} stroke={c.ink} strokeDasharray="4 4" strokeOpacity={0.5} />
              <Area type="monotone" dataKey="avgLatency" stroke={c.orange} strokeWidth={2.5} fill="url(#pi-grad-orange)" dot={{ r: 3, fill: c.surface, stroke: c.orange, strokeWidth: 2 }} activeDot={{ r: 5 }} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="footnote">Flat around 28 s: no trend across snapshots in the source data.</div>
        </Panel>
        <Panel title="Severity mix" subtitle="Latest snapshot per report">
          <Donut centerLabel="reports" parts={['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ label: { OK: '≤ 15 s', WARNING: '15–30 s', HIGH: '30–45 s', CRITICAL: '> 45 s' }[s], value: sev(s), color: c[SEVERITY_KEY[s]] }))} />
          <div className="footnote">{sev('WARNING') + sev('HIGH') + sev('CRITICAL')} of {reports.length} reports are over the 15 s threshold now.</div>
        </Panel>
      </div>
      </Group>

      <Group title="Live activity" subtitle="Alerts and telemetry streaming over WebSocket">
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
      </Group>

      {(orphaned.data || dq.data) && (
        <Group title="Governance" subtitle="Ownership and data validation">
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
                  { label: 'ORPHANED_REPORT', value: orphaned.data.summary.sentinel_records, color: c.ink, display: orphaned.data.summary.sentinel_records },
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
        </Group>
      )}
    </>
  );
}
