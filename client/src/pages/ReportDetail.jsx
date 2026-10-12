// One report: latest health, cost (if the role may see it) and its 20 snapshots.
// The x-axis is the snapshot number, never a date: the source data has no timestamps.
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api/useApi.js';
import { Badge, Card, ErrorState, Kpi, Loading, Notice, PageHeader, SeverityBadge, StatusBadge, COLORS } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

export default function ReportDetail() {
  const { reportId } = useParams();
  const { data, error, loading } = useApi(`/api/reports/${reportId}`);

  if (loading) return <Loading />;
  if (error) {
    return (
      <>
        <Link to="/health" className="btn sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} />Back</Link>
        <ErrorState error={error.status === 403 ? { ...error, message: error.message } : error} />
        {error.status === 403 && <p className="muted small mt">You can only open reports you own. This request was recorded in the audit log.</p>}
      </>
    );
  }

  const { report: r, cost, snapshots } = data;
  const chart = snapshots?.map((s) => ({ ...s, failed: ['FAILED', 'TIMED_OUT'].includes(s.last_refresh_status) ? s.avg_load_time_sec : null }));

  const columns = [
    { key: 'snapshot_seq', label: '#', render: (s) => <span className="num">{s.snapshot_seq}</span> },
    { key: 'last_refresh_status', label: 'Refresh', render: (s) => <StatusBadge value={s.last_refresh_status} /> },
    { key: 'avg_load_time_sec', label: 'Load time', align: 'right', render: (s) => <span className="num">{fmt.sec(s.avg_load_time_sec)}</span> },
    { key: 'latency_severity', label: 'Severity', render: (s) => <SeverityBadge value={s.latency_severity} /> },
    { key: 'monthly_active_views', label: 'Monthly views', align: 'right', render: (s) => <span className="num">{fmt.num(s.monthly_active_views)}</span> },
    { key: 'concurrent_user_peak', label: 'Peak users', align: 'right', render: (s) => <span className="num">{fmt.num(s.concurrent_user_peak)}</span> },
    ...(cost ? [
      { key: 'credits_clean', label: 'Credits', align: 'right', render: (s) => <span className="num">{fmt.num(s.credits_clean, 2)}</span> },
      { key: 'credit_cost_per_view_usd', label: 'Cost / view', align: 'right', render: (s) => <span className="num">{fmt.usd(s.credit_cost_per_view_usd, 3)}</span> },
    ] : []),
    { key: 'flags', label: 'Flags', sortable: false, render: (s) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {s.is_orphaned && <Badge tone="warning">Orphaned</Badge>}
        {s.credits_invalid && <Badge tone="critical" title="Negative credits in source: excluded from cost">Negative credits</Badge>}
        {s.monthly_active_views === 0 && <Badge title="Zero views: cost per view undefined">Zero views</Badge>}
        {s.usage_inconsistent && <Badge tone="high" title="Concurrent peak above monthly views">Usage inconsistent</Badge>}
      </div>
    ) },
  ];

  return (
    <>
      <Link to="/health" className="btn sm" style={{ marginBottom: 16 }}><ArrowLeft size={14} />Back to health</Link>
      <PageHeader title={`${r.report_id} · ${r.report_name}`}
        subtitle={<span className="row wrap" style={{ gap: 8 }}>
          Owner <span className="mono">{r.canonical_owner ?? '—'}</span>
          {r.currently_orphaned && <Badge tone="warning">Currently orphaned</Badge>}
          {r.owner_reassigned && <Badge tone="accent">Ownership claimed</Badge>}
        </span>} />

      <div className="grid grid-4">
        <Kpi label="Latest load time" value={fmt.sec(r.latest_load_time_sec)} hint={<SeverityBadge value={r.latest_latency_severity} />} />
        <Kpi label="Latest refresh" value={<StatusBadge value={r.latest_refresh_status} />} hint={`Failure rate ${fmt.pct(r.refresh_failure_rate)} over 20 snapshots`} />
        <Kpi label="p95 load time" value={fmt.sec(r.p95_load_time_sec)} hint={`${fmt.pct(r.latency_breach_rate)} of snapshots over 15 s`} />
        {cost
          ? <Kpi hero label="Credit cost per view" value={fmt.usd(cost.credit_cost_per_view_usd, 4)} hint={`${fmt.num(cost.credits_valid, 0)} valid credits · rank ${cost.credit_rank} of 100 by credits`} />
          : <Kpi label="Orphaned snapshots" value={r.orphaned_snapshots} hint="Of 20" />}
      </div>

      {snapshots ? (
        <>
          <Card className="mt" title="Load time across the 20 snapshots" subtitle="Bars = load time · red dots = refresh FAILED or TIMED_OUT · dashed line = 15 s alert threshold">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="#f0f2f5" />
                <XAxis dataKey="snapshot_seq" tick={{ fontSize: 11, fill: '#8a94a6' }} tickLine={false} axisLine={{ stroke: '#e6e8ec' }} />
                <YAxis tick={{ fontSize: 11, fill: '#8a94a6' }} axisLine={false} tickLine={false} unit="s" />
                <Tooltip labelFormatter={(l) => `Snapshot ${l}`} formatter={(v, n) => [`${v}s`, n === 'failed' ? 'Refresh failed' : 'Load time']} />
                <ReferenceLine y={15} stroke={COLORS.WARNING} strokeDasharray="4 3" />
                <Bar dataKey="avg_load_time_sec" fill="#c7cbf7" radius={[3, 3, 0, 0]} />
                <Line dataKey="failed" stroke="none" dot={{ r: 4, fill: COLORS.CRITICAL, stroke: '#fff', strokeWidth: 1.5 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card className="mt" title="Snapshots" subtitle="Every flag raised by the cleaning rules for this report" flush>
            <DataTable rows={snapshots.map((s) => ({ ...s, id: s.snapshot_seq }))} columns={columns} pageSize={20} initialSort={{ key: 'snapshot_seq', dir: 'asc' }} />
          </Card>
        </>
      ) : (
        <div className="mt"><Notice>Your role sees this report&apos;s health summary only. Snapshot detail and cost are limited to report owners, FinOps and admins.</Notice></div>
      )}

      {cost && (
        <Card className="mt" title="Cost attribution">
          <dl className="dl">
            <dt>Valid credits (sum of 20 snapshots)</dt><dd className="num">{fmt.num(cost.credits_valid, 2)}</dd>
            <dt>Credit cost</dt><dd className="num">{fmt.usd(cost.credit_cost_usd)}</dd>
            <dt>Negative credit snapshots excluded</dt><dd className="num">{cost.credits_invalid_snapshots} ({fmt.num(cost.credits_excluded_negative, 2)} credits)</dd>
            <dt>AWS hosting cost</dt><dd className="num">{fmt.usd(cost.aws_cost_usd)}</dd>
            <dt>Monthly active views (eligible)</dt><dd className="num">{fmt.num(cost.eligible_views)}</dd>
            <dt>Credits per view</dt><dd className="num">{fmt.num(cost.credits_per_view, 4)}</dd>
            <dt>Fully loaded cost per view</dt><dd className="num">{fmt.usd(cost.fully_loaded_cost_per_view_usd, 4)}</dd>
            <dt>Share of platform credits</dt><dd className="num">{fmt.pct(cost.credit_share, 2)}</dd>
            <dt>Distinct owner emails in source</dt><dd className="num">{cost.owner_distinct_count}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}
