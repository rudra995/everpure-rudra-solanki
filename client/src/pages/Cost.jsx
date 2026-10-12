// Snowflake cost attribution (brief, Task 3): credits per report and unit cost per
// active user view. Numbers come straight from the SQL suite's marts.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { Badge, Card, ErrorState, Kpi, Loading, Notice, PageHeader, Segmented } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

// Unit cost for a set of reports, computed the same way as the SQL (ratio of sums over
// eligible snapshots), so a Report Owner's figure is comparable to the platform's.
export function ownCostTotals(reports) {
  const sum = (k) => reports.reduce((a, r) => a + Number(r[k] || 0), 0);
  const views = sum('eligible_views');
  return {
    reports: reports.length,
    credits: sum('credits_valid'),
    creditCost: sum('credit_cost_usd'),
    aws: sum('aws_cost_usd'),
    views,
    costPerView: views ? sum('eligible_credit_cost_usd') / views : null,
    creditsPerView: views ? sum('eligible_credits') / views : null,
    fullyLoadedPerView: views ? sum('eligible_fully_loaded_cost_usd') / views : null,
  };
}

const WASTE_LABEL = {
  HIGH_CREDITS_LOW_USAGE: 'Top-quartile credits, bottom-quartile views',
  HAD_ZERO_VIEW_SNAPSHOT: 'Spent credits in a snapshot with zero views',
};

export default function Cost() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const all = can(P.COST_READ_ALL);
  const summary = useApi(all ? '/api/cost/summary' : null);
  const reports = useApi('/api/cost/reports');
  const showback = useApi(all ? '/api/cost/showback' : null);
  const waste = useApi('/api/cost/waste');
  const [tab, setTab] = useState('reports');

  const rows = reports.data?.reports ?? [];
  const top = useMemo(() => [...rows].sort((a, b) => b.credit_cost_usd - a.credit_cost_usd).slice(0, 12), [rows]);

  if (reports.loading || summary.loading) return <Loading />;
  if (reports.error) return <ErrorState error={reports.error} />;

  const s = summary.data?.summary;
  const own = ownCostTotals(rows);

  const reportColumns = [
    { key: 'credit_rank', label: 'Rank', align: 'right', render: (r) => <span className="num faint">{r.credit_rank}</span> },
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'canonical_owner', label: 'Owner', render: (r) => <span className="mono small">{r.canonical_owner ?? '—'}</span> },
    { key: 'credits_valid', label: 'Credits', align: 'right', render: (r) => <span className="num">{fmt.num(r.credits_valid, 0)}</span> },
    { key: 'credit_cost_usd', label: 'Credit cost', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
    { key: 'credit_share', label: 'Share', align: 'right', render: (r) => <span className="num">{fmt.pct(r.credit_share, 1)}</span> },
    { key: 'eligible_views', label: 'Views', align: 'right', render: (r) => <span className="num">{fmt.num(r.eligible_views)}</span> },
    { key: 'credit_cost_per_view_usd', label: 'Cost / view', align: 'right', render: (r) => <b className="num">{fmt.usd(r.credit_cost_per_view_usd, 3)}</b> },
    { key: 'fully_loaded_cost_per_view_usd', label: '+ AWS / view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.fully_loaded_cost_per_view_usd, 3)}</span> },
    { key: 'credits_invalid_snapshots', label: 'Excluded', align: 'right', title: 'Snapshots with negative credits, excluded from cost',
      render: (r) => (r.credits_invalid_snapshots ? <Badge tone="critical">{r.credits_invalid_snapshots} negative</Badge> : <span className="faint">—</span>) },
  ];

  const showbackColumns = [
    { key: 'canonical_owner', label: 'Owner', render: (o) => <span className="mono">{o.canonical_owner}</span> },
    { key: 'reports_owned', label: 'Reports', align: 'right', render: (o) => <span className="num">{o.reports_owned}</span> },
    { key: 'credits_valid', label: 'Credits', align: 'right', render: (o) => <span className="num">{fmt.num(o.credits_valid, 0)}</span> },
    { key: 'credit_cost_usd', label: 'Credit cost', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_usd, 0)}</span> },
    { key: 'credit_share', label: 'Share', align: 'right', render: (o) => <span className="num">{fmt.pct(o.credit_share, 1)}</span> },
    { key: 'credit_cost_per_view_usd', label: 'Cost / view', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_per_view_usd, 3)}</span> },
  ];

  const wasteColumns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'reason', label: 'Why it is flagged', render: (r) => <Badge tone={r.reason === 'HIGH_CREDITS_LOW_USAGE' ? 'high' : 'warning'}>{WASTE_LABEL[r.reason] ?? r.reason}</Badge> },
    { key: 'credit_cost_usd', label: 'Credit cost', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
    { key: 'total_views', label: 'Views', align: 'right', render: (r) => <span className="num">{fmt.num(r.total_views)}</span> },
    { key: 'credit_cost_per_view_usd', label: 'Cost / view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_per_view_usd, 3)}</span> },
    { key: 'zero_view_snapshots', label: 'Zero-view snapshots', align: 'right', render: (r) => <span className="num">{r.zero_view_snapshots}</span> },
  ];

  const tabs = [
    { value: 'reports', label: `Reports (${rows.length})` },
    ...(all ? [{ value: 'showback', label: 'Owner showback' }] : []),
    { value: 'waste', label: `Expensive but unused (${waste.data?.count ?? 0})` },
  ];

  return (
    <>
      <PageHeader title="Cost attribution"
        subtitle={all
          ? 'Snowflake credits attributed to each report from the simulated ACCOUNT_USAGE logs. Negative credits are excluded, never flipped to positive.'
          : `Snowflake credits for the ${rows.length} reports you own, calculated the same way as the platform figure.`} />

      {all && s ? (
        <div className="grid grid-4">
          <Kpi hero label="Unit cost per active user view" value={fmt.usd(s.credit_cost_per_view_usd, 4)}
               hint={`Credit cost ÷ views · ${fmt.num(s.eligible_rows)} of ${fmt.num(s.snapshots)} snapshots eligible`} />
          <Kpi label="Credits per view" value={fmt.num(s.credits_per_view, 4)} hint="Needs no price assumption" />
          <Kpi label="Fully loaded per view" value={fmt.usd(s.fully_loaded_cost_per_view_usd, 4)} hint="Credits + AWS hosting" />
          <Kpi label="Strict per view" value={fmt.usd(s.strict_credit_cost_per_view_usd, 4)} hint="Also excludes usage-inconsistent rows" />
          <Kpi label="Snowflake credit cost" value={fmt.usdCompact(s.credit_cost_usd)} hint={`${fmt.num(s.credits_valid, 0)} credits at ${fmt.usd(s.credit_price_usd)}`} />
          <Kpi label="AWS hosting cost" value={fmt.usdCompact(s.aws_cost_usd)} hint="Shown separately, not in headline" />
          <Kpi label="Active user views" value={fmt.compact(s.eligible_views)} hint="Eligible snapshots only" />
          <Kpi label="Negative credits excluded" value={fmt.num(s.credits_excluded_negative, 2)} tone="critical" hint="24 snapshots, kept in the issue log" />
        </div>
      ) : (
        <div className="grid grid-4">
          <Kpi hero label="Your unit cost per view" value={fmt.usd(own.costPerView, 4)} hint="Credit cost ÷ views, eligible snapshots" />
          <Kpi label="Credits per view" value={fmt.num(own.creditsPerView, 4)} />
          <Kpi label="Snowflake credit cost" value={fmt.usd(own.creditCost, 0)} hint={`${fmt.num(own.credits, 0)} valid credits`} />
          <Kpi label="Fully loaded per view" value={fmt.usd(own.fullyLoadedPerView, 4)} hint="Credits + AWS hosting" />
        </div>
      )}

      <div className="grid grid-2 mt">
        <Card title="Highest credit cost" subtitle={`Top ${top.length} reports`}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#8a94a6' }} axisLine={false} tickLine={false} tickFormatter={fmt.usdCompact} />
              <YAxis type="category" dataKey="report_id" width={70} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#f1f3f6' }} formatter={(v) => [fmt.usd(v, 0), 'Credit cost']} />
              <Bar dataKey="credit_cost_usd" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="AWS hosting cost vs active views" subtitle="One dot per report. No pattern: AWS cost does not follow usage (brief defect 4)">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#f0f2f5" />
              <XAxis type="number" dataKey="total_views" name="Views" tick={{ fontSize: 11, fill: '#8a94a6' }} tickFormatter={fmt.compact} />
              <YAxis type="number" dataKey="aws_cost_usd" name="AWS cost" tick={{ fontSize: 11, fill: '#8a94a6' }} tickFormatter={fmt.usdCompact} />
              <ZAxis range={[36, 36]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }}
                formatter={(v, n) => [n === 'AWS cost' ? fmt.usd(v, 0) : fmt.num(v), n]}
                labelFormatter={() => ''} />
              <Scatter data={rows} fill="#ea580c" fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt" flush title="Breakdown" actions={<Segmented value={tab} onChange={setTab} options={tabs} />}>
        {tab === 'reports' && (
          <DataTable rows={rows} columns={reportColumns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
            initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)} />
        )}
        {tab === 'showback' && (showback.data
          ? <DataTable rows={showback.data.owners.map((o) => ({ ...o, id: o.canonical_owner }))} columns={showbackColumns} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} />
          : <Loading />)}
        {tab === 'waste' && (waste.data
          ? <DataTable rows={waste.data.reports} columns={wasteColumns} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)} emptyText="None of your reports are flagged." />
          : <Loading />)}
      </Card>

      <div className="mt">
        <Notice>
          <b>How the unit cost is calculated:</b> SUM(valid credits × {fmt.usd(s?.credit_price_usd ?? 3)}) ÷ SUM(monthly active views), over snapshots
          with non-negative credits and at least one view. It is a ratio of sums, not an average of per-row ratios. The {fmt.usd(s?.credit_price_usd ?? 3)}/credit
          price is an assumption (about Snowflake Enterprise on-demand).
          {tab === 'showback' && ' Showback caveat: every report has 7–13 owner emails in the source; the owner used here is the most frequent one.'}
        </Notice>
      </div>
    </>
  );
}
