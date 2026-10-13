// One report: health now, cost split (Snowflake + AWS, if the role may see cost) and its
// 20 snapshots. The x-axis is the snapshot number, never a date: the data has no timestamps.
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Eye, FileWarning, Lock, RefreshCw, Snowflake, Timer } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { Group, Badge, ErrorState, Loading, Notice, PageHeader, Panel, SeverityBadge, SplitBar, Stat, StatusBadge, Legend } from '../components/ui.jsx';
import { ChartTooltip, axis } from '../components/charts.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

export default function ReportDetail() {
  const { reportId } = useParams();
  const { c } = useTheme();
  const { data, error, loading } = useApi(`/api/reports/${reportId}`);

  if (loading) return <Loading />;
  if (error) {
    return (
      <>
        <Link to="/health" className="btn sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} />Back</Link>
        {error.status === 403 ? (
          <div className="panel empty" style={{ padding: 48 }}>
            <Lock size={26} color="var(--critical)" />
            <h3 style={{ margin: '10px 0 4px', color: 'var(--text)' }}>{reportId} belongs to another owner</h3>
            <div>Report Owners can only open their own reports. The server returned 403 and wrote this attempt to the audit log.</div>
          </div>
        ) : <ErrorState error={error} />}
      </>
    );
  }

  const { report: r, cost, snapshots } = data;
  const price = cost && Number(cost.credits_valid) ? Number(cost.credit_cost_usd) / Number(cost.credits_valid) : null;
  const chart = snapshots?.map((s) => ({
    ...s,
    label: `#${s.snapshot_seq}`,
    failed: ['FAILED', 'TIMED_OUT'].includes(s.last_refresh_status) ? Number(s.avg_load_time_sec) : null,
    snowflake: price !== null && s.credits_clean !== null && s.credits_clean !== undefined ? Number(s.credits_clean) * price : null,
    aws: s.aws_hosting_cost_usd !== undefined ? Number(s.aws_hosting_cost_usd) : null,
  }));
  const awsPerView = cost && Number(cost.eligible_views) ? (Number(cost.eligible_fully_loaded_cost_usd) - Number(cost.eligible_credit_cost_usd)) / Number(cost.eligible_views) : null;

  const columns = [
    { key: 'snapshot_seq', label: '#', render: (s) => <span className="num faint">{s.snapshot_seq}</span> },
    { key: 'last_refresh_status', label: 'Refresh', render: (s) => <StatusBadge value={s.last_refresh_status} /> },
    { key: 'avg_load_time_sec', label: 'Load time', align: 'right', render: (s) => <span className="num strong" style={{ color: c[SEVERITY_KEY[s.latency_severity]] }}>{fmt.sec(s.avg_load_time_sec)}</span> },
    { key: 'latency_severity', label: 'Severity', render: (s) => <SeverityBadge value={s.latency_severity} /> },
    { key: 'monthly_active_views', label: 'Views', align: 'right', render: (s) => <span className="num">{fmt.num(s.monthly_active_views)}</span> },
    { key: 'concurrent_user_peak', label: 'Peak users', align: 'right', render: (s) => <span className="num">{fmt.num(s.concurrent_user_peak)}</span> },
    ...(cost ? [
      { key: 'credits_clean', label: 'Credits', align: 'right', render: (s) => <span className="num">{fmt.num(s.credits_clean, 2)}</span> },
      { key: 'aws_hosting_cost_usd', label: 'AWS', align: 'right', render: (s) => <span className="num">{fmt.usd(s.aws_hosting_cost_usd)}</span> },
      { key: 'credit_cost_per_view_usd', label: 'Snowflake / view', align: 'right', render: (s) => <span className="num">{fmt.usd(s.credit_cost_per_view_usd, 3)}</span> },
    ] : []),
    { key: 'flags', label: 'Flags', sortable: false, render: (s) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {s.is_orphaned && <Badge color={c.ownership}>{s.owner_missing ? 'Owner NaN' : 'ORPHANED_REPORT'}</Badge>}
        {s.credits_invalid && <Badge color={c.critical} title="Negative credits in source: excluded from cost">Negative credits</Badge>}
        {s.monthly_active_views === 0 && <Badge color={c.unknown} title="Zero views: cost per view undefined">Zero views</Badge>}
        {s.usage_inconsistent && <Badge color={c.serious} title="Concurrent peak above monthly views">Usage inconsistent</Badge>}
        {s.aws_cost_usage_mismatch && <Badge color={c.aws} title="AWS cost per view above the Tukey fence">AWS outlier</Badge>}
      </div>) },
  ];

  return (
    <>
      <Link to="/health" className="btn sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} />Back to health</Link>
      <PageHeader title={`${r.report_id} · ${r.report_name}`} />
      <div className="row wrap" style={{ gap: 8, margin: '-6px 0 16px' }}>
        <span className="pill">Owner <b className="mono">{r.canonical_owner ?? '—'}</b></span>
        {r.currently_orphaned && <Badge color={c.ownership}>Currently orphaned</Badge>}
        {r.owner_reassigned && <Badge color={c.accent}>Ownership claimed</Badge>}
        {cost && <Badge color={c.unknown}>{cost.owner_distinct_count} different owner emails in source</Badge>}
      </div>

      <Group title="Current state">
      <div className="grid g-5">
        <Stat variant="accent" tone="latency" icon={Clock} label="Load time now" value={fmt.sec(r.latest_load_time_sec)} sub={<SeverityBadge value={r.latest_latency_severity} />} spark={chart} sparkKey="avg_load_time_sec" />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh now" value={<StatusBadge value={r.latest_refresh_status} />} sub={`Failure rate ${fmt.pct(r.refresh_failure_rate)} over 20`} />
        <Stat tone="serious" icon={Timer} label="p95 load time" value={fmt.sec(r.p95_load_time_sec)} sub={`${fmt.pct(r.latency_breach_rate)} of snapshots over 15 s`} />
        <Stat tone="ownership" icon={FileWarning} label="Orphaned snapshots" value={`${r.orphaned_snapshots} / 20`} sub={r.currently_orphaned ? 'Latest snapshot has no owner' : 'Owner on latest snapshot'} />
        {cost
          ? <Stat tone="snowflake" icon={Snowflake} label="Cost per view" value={fmt.usd(cost.fully_loaded_cost_per_view_usd, 3)} sub={`${fmt.usd(cost.credit_cost_per_view_usd, 3)} Snowflake + ${fmt.usd(awsPerView, 3)} AWS`} />
          : <Stat tone="usage" icon={Eye} label="Avg load (20)" value={fmt.sec(r.avg_load_time_sec)} sub="Mean of all snapshots" />}
      </div>
      </Group>

      {snapshots ? (
        <>
          <Group title="History and cost" subtitle="Across the 20 snapshots">
          <div className={`grid ${cost ? 'g-2' : ''} mt`}>
            <Panel title="Load time by snapshot" subtitle="Bar colour = severity · red dot = refresh FAILED or TIMED_OUT · line = 15 s threshold">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: -14 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" {...axis(c)} interval={1} />
                  <YAxis {...axis(c)} axisLine={false} unit="s" domain={[0, 60]} />
                  <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip title={(l) => `Snapshot ${l}`} names={{ avg_load_time_sec: 'Load time', failed: 'Refresh failed at' }} format={(v) => `${Number(v).toFixed(1)}s`} />} />
                  <ReferenceLine y={15} stroke={c.warning} strokeDasharray="4 3" />
                  <Bar dataKey="avg_load_time_sec" radius={[4, 4, 0, 0]}>
                    {chart.map((s) => <Cell key={s.snapshot_seq} fill={c[SEVERITY_KEY[s.latency_severity]]} />)}
                  </Bar>
                  <Line dataKey="failed" stroke="none" dot={{ r: 5, fill: c.critical, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <Legend items={['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ label: s, color: c[SEVERITY_KEY[s]] }))} />
            </Panel>
            {cost && (
              <Panel title="Cost by snapshot" subtitle="Snowflake compute + AWS hosting · gaps = negative credits excluded">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: 2 }} barCategoryGap="18%">
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" {...axis(c)} interval={1} />
                    <YAxis {...axis(c)} axisLine={false} width={48} tickFormatter={fmt.usdCompact} />
                    <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`} names={{ snowflake: 'Snowflake', aws: 'AWS' }} format={(v) => fmt.usd(v, 0)} />} />
                    <Bar dataKey="snowflake" stackId="a" fill={c.snowflake} />
                    <Bar dataKey="aws" stackId="a" fill="url(#pi-hatch)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <Legend items={[{ label: 'Snowflake compute', color: c.snowflake }, { label: 'AWS hosting', color: c.aws }]} />
              </Panel>
            )}
          </div>

          <div className={`grid ${cost ? 'g-main' : ''} mt`}>
            <Panel title="Monthly active views by snapshot" subtitle="Usage that the cost is divided by">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: -10 }}>
                  <defs><linearGradient id="g-views" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c.usage} stopOpacity={0.4} /><stop offset="100%" stopColor={c.usage} stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" {...axis(c)} interval={1} />
                  <YAxis {...axis(c)} axisLine={false} />
                  <Tooltip content={<ChartTooltip title={(l) => `Snapshot ${l}`} names={{ monthly_active_views: 'Views' }} />} />
                  <Area type="monotone" dataKey="monthly_active_views" stroke={c.usage} strokeWidth={2} fill="url(#g-views)" dot={{ r: 2.5, fill: c.usage }} />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
            {cost && (
              <Panel title="Cost attribution">
                <div className="stat-value" style={{ marginTop: 0 }}>{fmt.usd(Number(cost.credit_cost_usd) + Number(cost.aws_cost_usd), 0)}</div>
                <div className="stat-sub" style={{ marginBottom: 12 }}>Total over 20 snapshots · rank {cost.credit_rank} of 100 by credits</div>
                <SplitBar parts={[
                  { label: 'Snowflake', value: Number(cost.credit_cost_usd), color: c.snowflake, display: fmt.usd(cost.credit_cost_usd, 0) },
                  { label: 'AWS', value: Number(cost.aws_cost_usd), color: c.aws, display: fmt.usd(cost.aws_cost_usd, 0) },
                ]} />
                <dl className="dl" style={{ marginTop: 16 }}>
                  <dt>Valid credits</dt><dd>{fmt.num(cost.credits_valid, 2)}</dd>
                  <dt>Negative snapshots excluded</dt><dd>{cost.credits_invalid_snapshots} ({fmt.num(cost.credits_excluded_negative, 2)} credits)</dd>
                  <dt>Eligible views</dt><dd>{fmt.num(cost.eligible_views)}</dd>
                  <dt>Credits per view</dt><dd>{fmt.num(cost.credits_per_view, 4)}</dd>
                  <dt>Share of platform credits</dt><dd>{fmt.pct(cost.credit_share, 2)}</dd>
                </dl>
              </Panel>
            )}
          </div>
          </Group>

          <Panel className="mt" flush bordered title="Snapshots" subtitle="Every flag the cleaning rules raised for this report">
            <DataTable rows={snapshots.map((s) => ({ ...s, id: s.snapshot_seq }))} columns={columns} pageSize={20} initialSort={{ key: 'snapshot_seq', dir: 'asc' }} />
          </Panel>
        </>
      ) : (
        <div className="mt"><Notice>Your role sees this report&apos;s health summary only. Snapshot detail and cost belong to report owners, FinOps and admins.</Notice></div>
      )}
    </>
  );
}
