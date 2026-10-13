// One report: how it is doing now, what it costs (Snowflake + AWS, if the role may see
// cost) and its 20 snapshots. The x-axis is the snapshot number, never a date.
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { Badge, ErrorState, Legend, Loading, Notice, PageHeader, Panel, SectionTitle, SeverityBadge, SplitBar, Stat, StatusBadge } from '../components/ui.jsx';
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
        <Link to="/health" className="btn sm" style={{ marginBottom: 18 }}><ArrowLeft size={14} />Back</Link>
        {error.status === 403 ? (
          <div className="panel empty" style={{ padding: 56 }}>
            <Lock size={26} color={c.critical} />
            <h3 style={{ margin: '12px 0 6px', color: 'var(--text)', fontFamily: 'var(--serif)', fontSize: 22 }}>{reportId} belongs to someone else</h3>
            <div>Report owners can only open their own reports. The server refused the request and recorded the attempt in the audit log.</div>
          </div>
        ) : <ErrorState error={error} />}
      </>
    );
  }

  const { report: r, cost, snapshots } = data;
  const price = cost && Number(cost.credits_valid) ? Number(cost.credit_cost_usd) / Number(cost.credits_valid) : null;
  const chart = snapshots?.map((s) => ({
    ...s,
    label: `${s.snapshot_seq}`,
    failed: ['FAILED', 'TIMED_OUT'].includes(s.last_refresh_status) ? Number(s.avg_load_time_sec) : null,
    snowflake: price !== null && s.credits_clean !== null && s.credits_clean !== undefined ? Number(s.credits_clean) * price : null,
    aws: s.aws_hosting_cost_usd !== undefined ? Number(s.aws_hosting_cost_usd) : null,
  }));
  const awsPerView = cost && Number(cost.eligible_views) ? (Number(cost.eligible_fully_loaded_cost_usd) - Number(cost.eligible_credit_cost_usd)) / Number(cost.eligible_views) : null;

  const columns = [
    { key: 'snapshot_seq', label: 'Snapshot', render: (s) => <span className="num faint">{s.snapshot_seq}</span> },
    { key: 'avg_load_time_sec', label: 'Load time', align: 'right', render: (s) => <span className="num strong">{fmt.sec(s.avg_load_time_sec)}</span> },
    { key: 'latency_severity', label: 'Speed', render: (s) => <SeverityBadge value={s.latency_severity} /> },
    { key: 'last_refresh_status', label: 'Refresh', render: (s) => <StatusBadge value={s.last_refresh_status} /> },
    { key: 'monthly_active_views', label: 'Active views', align: 'right', render: (s) => <span className="num">{fmt.num(s.monthly_active_views)}</span> },
    ...(cost ? [
      { key: 'credits_clean', label: 'Credits', align: 'right', render: (s) => <span className="num">{fmt.num(s.credits_clean, 1)}</span> },
      { key: 'aws_hosting_cost_usd', label: 'AWS', align: 'right', render: (s) => <span className="num">{fmt.usd(s.aws_hosting_cost_usd, 0)}</span> },
    ] : []),
    { key: 'flags', label: 'Data issues', sortable: false, render: (s) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {s.is_orphaned && <Badge color={c.ownership}>{s.owner_missing ? 'Owner email missing' : 'ORPHANED_REPORT'}</Badge>}
        {s.credits_invalid && <Badge color={c.critical} title="Negative credits: left out of the cost">Negative credits</Badge>}
        {s.monthly_active_views === 0 && <Badge color={c.unknown}>Zero views</Badge>}
        {s.usage_inconsistent && <Badge color={c.serious} title="Peak concurrent users above monthly views">Impossible usage</Badge>}
        {s.aws_cost_usage_mismatch && <Badge color={c.aws} title="AWS cost per view above the outlier limit">AWS outlier</Badge>}
      </div>) },
  ];

  return (
    <>
      <Link to="/health" className="btn sm" style={{ marginBottom: 18 }}><ArrowLeft size={14} />Back to system health</Link>
      <PageHeader eyebrow="Report detail" title={`${r.report_id} · ${r.report_name}`}
        subtitle={<span className="row wrap" style={{ gap: 8 }}>
          Owner <span className="mono">{r.canonical_owner ?? '—'}</span>
          {r.currently_orphaned && <Badge color={c.ownership}>No owner on the latest snapshot</Badge>}
          {r.owner_reassigned && <Badge color={c.accent}>Ownership claimed</Badge>}
        </span>} />

      <div className="grid g-4">
        <Stat tone="latency" label="Load time now" value={fmt.sec(r.latest_load_time_sec)} sub={`${fmt.pct(r.latency_breach_rate)} of its snapshots were slower than 15 s`} />
        <Stat tone="refresh" label="Last refresh" value={<StatusBadge value={r.latest_refresh_status} />} sub={`${fmt.pct(r.refresh_failure_rate)} of its refreshes failed`} />
        <Stat tone="ownership" label="Snapshots with no owner" value={r.orphaned_snapshots} unit="of 20" sub={r.currently_orphaned ? 'Including the latest one' : 'Has an owner now'} />
        {cost
          ? <Stat tone="accent" label="Cost per active view" value={fmt.usd(cost.fully_loaded_cost_per_view_usd, 2)} sub={`${fmt.usd(cost.credit_cost_per_view_usd, 2)} Snowflake + ${fmt.usd(awsPerView, 2)} AWS`}
              foot={<SplitBar thin legend={false} parts={[{ label: 'Snowflake', value: Number(cost.credit_cost_per_view_usd), color: c.snowflake }, { label: 'AWS', value: awsPerView, color: c.aws }]} />} />
          : <Stat tone="latency" label="Average load time" value={fmt.sec(r.avg_load_time_sec)} sub="Across all 20 snapshots" />}
      </div>

      {snapshots ? (
        <>
          <div className={`grid ${cost ? 'g-2' : ''} mt`}>
            <Panel title="Load time in each snapshot" subtitle="Bar colour shows the speed band. A red dot marks a failed or timed-out refresh. Dashed line: the 15 s limit.">
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: -14 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" {...axis(c)} />
                  <YAxis {...axis(c)} axisLine={false} unit="s" domain={[0, 60]} />
                  <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip title={(l) => `Snapshot ${l}`} names={{ avg_load_time_sec: 'Load time', failed: 'Refresh failed' }} format={(v) => `${Number(v).toFixed(1)} s`} />} />
                  <ReferenceLine y={15} stroke={c.accentDeep} strokeDasharray="4 3" />
                  <Bar dataKey="avg_load_time_sec" radius={[5, 5, 0, 0]}>
                    {chart.map((s) => <Cell key={s.snapshot_seq} fill={c[SEVERITY_KEY[s.latency_severity]]} />)}
                  </Bar>
                  <Line dataKey="failed" stroke="none" dot={{ r: 5, fill: c.critical, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <Legend items={[{ label: 'Under 15 s', color: c.good }, { label: '15–30 s', color: c.warning }, { label: '30–45 s', color: c.serious }, { label: 'Over 45 s', color: c.critical }]} />
            </Panel>
            {cost && (
              <Panel title="Cost in each snapshot" subtitle={`Snowflake compute plus AWS hosting. ${fmt.usd(Number(cost.credit_cost_usd) + Number(cost.aws_cost_usd), 0)} in total across 20 snapshots.`}>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chart} margin={{ top: 8, right: 6, bottom: 0, left: 2 }} barCategoryGap="18%">
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" {...axis(c)} />
                    <YAxis {...axis(c)} axisLine={false} width={46} tickFormatter={fmt.usdCompact} />
                    <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`} names={{ snowflake: 'Snowflake', aws: 'AWS' }} format={(v) => fmt.usd(v, 0)} />} />
                    <Bar dataKey="snowflake" stackId="a" fill={c.snowflake} />
                    <Bar dataKey="aws" stackId="a" fill={c.aws} radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <Legend items={[{ label: 'Snowflake compute', color: c.snowflake }, { label: 'AWS hosting', color: c.aws }]} />
              </Panel>
            )}
          </div>
          <SectionTitle note="Every data issue the cleaning rules flagged for this report">All 20 snapshots</SectionTitle>
          <Panel flush>
            <DataTable rows={snapshots.map((s) => ({ ...s, id: s.snapshot_seq }))} columns={columns} pageSize={20} initialSort={{ key: 'snapshot_seq', dir: 'asc' }} />
          </Panel>
        </>
      ) : (
        <div className="mt"><Notice>Your role sees this report&apos;s headline health only. Snapshot history and cost are for report owners, FinOps and admins.</Notice></div>
      )}
    </>
  );
}
