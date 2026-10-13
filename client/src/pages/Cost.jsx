// Cost (brief, Task 3). The cost of a report is shown everywhere as two parts:
//   Snowflake compute (valid credits x credit price)  +  AWS hosting.
// Unit cost per active user view = cost / monthly active views over eligible snapshots
// (credits not negative, views > 0), always a ratio of sums.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useTheme } from '../theme.jsx';
import { Badge, ErrorState, Legend, Loading, PageHeader, Panel, SectionTitle, Segmented, SplitBar } from '../components/ui.jsx';
import { ChartTooltip, axis } from '../components/charts.jsx';
import DataTable from '../components/DataTable.jsx';
import { awsPerView } from '../data.js';
import { fmt } from '../format.js';

const n = (v) => Number(v || 0);

// Unit-cost split for a set of report rows (same maths as the SQL marts).
export function costTotals(reports) {
  const sum = (k) => reports.reduce((a, r) => a + n(r[k]), 0);
  const views = sum('eligible_views');
  const eligSnow = sum('eligible_credit_cost_usd');
  const eligTotal = sum('eligible_fully_loaded_cost_usd');
  return {
    reports: reports.length, credits: sum('credits_valid'), snowflake: sum('credit_cost_usd'), aws: sum('aws_cost_usd'), views,
    snowPerView: views ? eligSnow / views : null,
    awsPerView: views ? (eligTotal - eligSnow) / views : null,
    totalPerView: views ? eligTotal / views : null,
    creditsPerView: views ? sum('eligible_credits') / views : null,
  };
}

const withSplit = (r) => {
  const views = n(r.eligible_views);
  return { ...r, total_cost_usd: n(r.credit_cost_usd) + n(r.aws_cost_usd), aws_per_view_usd: views ? (n(r.eligible_fully_loaded_cost_usd) - n(r.eligible_credit_cost_usd)) / views : null };
};

export default function Cost() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { c } = useTheme();
  const all = can(P.COST_READ_ALL);
  const summary = useApi(all ? '/api/cost/summary' : null);
  const reportsQ = useApi('/api/cost/reports');
  const snapsQ = useApi('/api/health/snapshots');
  const showback = useApi(all ? '/api/cost/showback' : null);
  const waste = useApi('/api/cost/waste');
  const [topBy, setTopBy] = useState('total');
  const [tab, setTab] = useState('reports');

  const reports = useMemo(() => (reportsQ.data?.reports ?? []).map(withSplit), [reportsQ.data]);
  const top = useMemo(() => [...reports].sort((a, b) => (topBy === 'total'
    ? b.total_cost_usd - a.total_cost_usd : n(b.fully_loaded_cost_per_view_usd) - n(a.fully_loaded_cost_per_view_usd))).slice(0, 10), [reports, topBy]);
  const scatter = useMemo(() => awsPerView(snapsQ.data?.snapshots ?? []), [snapsQ.data]);

  if (reportsQ.loading || summary.loading) return <Loading />;
  if (reportsQ.error) return <ErrorState error={reportsQ.error} />;

  const s = summary.data?.summary;
  const own = costTotals(reports);
  const t = s ? {
    snowflake: n(s.credit_cost_usd), aws: n(s.aws_cost_usd), credits: n(s.credits_valid), views: n(s.eligible_views),
    snowPerView: n(s.credit_cost_per_view_usd), totalPerView: n(s.fully_loaded_cost_per_view_usd),
    awsPerView: n(s.fully_loaded_cost_per_view_usd) - n(s.credit_cost_per_view_usd), creditsPerView: n(s.credits_per_view),
  } : own;
  const outliers = scatter.filter((p) => p.outlier);
  const usd4 = (v) => fmt.usd(v, 4);

  const reportColumns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'total_cost_usd', label: 'Total cost', align: 'right', render: (r) => (
      <div className="cellbar"><b className="num">{fmt.usd(r.total_cost_usd, 0)}</b>
        <span className="track"><span style={{ width: `${(n(r.credit_cost_usd) / r.total_cost_usd) * 100}%`, background: c.snowflake }} /><span style={{ flex: 1, background: c.aws }} /></span>
      </div>) },
    { key: 'credit_cost_usd', label: 'Snowflake', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
    { key: 'aws_cost_usd', label: 'AWS', align: 'right', render: (r) => <span className="num">{fmt.usd(r.aws_cost_usd, 0)}</span> },
    { key: 'eligible_views', label: 'Active views', align: 'right', render: (r) => <span className="num">{fmt.num(r.eligible_views)}</span> },
    { key: 'fully_loaded_cost_per_view_usd', label: 'Cost per view', align: 'right', render: (r) => (
      <span><b className="num">{fmt.usd(r.fully_loaded_cost_per_view_usd, 2)}</b> <span className="faint small num">({fmt.usd(r.credit_cost_per_view_usd, 2)} + {fmt.usd(r.aws_per_view_usd, 2)})</span></span>) },
    { key: 'credits_invalid_snapshots', label: 'Excluded', align: 'right', title: 'Snapshots with negative credits, left out of the cost',
      render: (r) => (r.credits_invalid_snapshots ? <Badge color={c.critical}>{r.credits_invalid_snapshots} negative</Badge> : <span className="faint">—</span>) },
  ];

  const tabs = [
    { value: 'reports', label: `All reports (${reports.length})` },
    { value: 'waste', label: `Expensive but barely used (${waste.data?.count ?? 0})` },
    ...(all ? [{ value: 'owners', label: 'By owner' }] : []),
  ];

  return (
    <>
      <PageHeader index="05" eyebrow="Cost · Task 3" title="What reports cost"
        subtitle={all
          ? 'Snowflake compute and AWS hosting, attributed to every report from the simulated Snowflake ACCOUNT_USAGE logs.'
          : `Snowflake compute and AWS hosting for the ${reports.length} reports you own, worked out exactly like the platform figure.`} />

      <div className="grid g-main">
        <div className="hero">
          <div className="hero-label">{all ? 'Cost of one active user view' : 'Cost of one view of your reports'}</div>
          <div className="hero-value">{usd4(t.totalPerView)}</div>
          <div className="hero-eq">
            <span className="part"><b style={{ color: c.snowflake }}>{usd4(t.snowPerView)}</b> Snowflake compute</span>
            <span>+</span>
            <span className="part"><b style={{ color: '#c9620f' }}>{usd4(t.awsPerView)}</b> AWS hosting</span>
          </div>
          <div style={{ marginTop: 20, position: 'relative', zIndex: 1 }}>
            <SplitBar parts={[
              { label: 'Snowflake', value: t.snowPerView, color: c.snowflake, display: usd4(t.snowPerView) },
              { label: 'AWS', value: t.awsPerView, color: c.aws, display: usd4(t.awsPerView) },
            ]} />
          </div>
        </div>
        <Panel title="Total spend" subtitle={all ? 'All 100 reports over 20 snapshots' : `Your ${reports.length} reports over 20 snapshots`}>
          <div className="kpi-value" style={{ marginTop: 0 }}>{fmt.usdCompact(t.snowflake + t.aws)}</div>
          <div style={{ margin: '14px 0 18px' }}>
            <SplitBar parts={[
              { label: 'Snowflake', value: t.snowflake, color: c.snowflake, display: fmt.usdCompact(t.snowflake) },
              { label: 'AWS', value: t.aws, color: c.aws, display: fmt.usdCompact(t.aws) },
            ]} />
          </div>
          <dl className="dl">
            <dt>Snowflake credits used</dt><dd>{fmt.num(t.credits, 0)}</dd>
            <dt>Active user views</dt><dd>{fmt.num(t.views)}</dd>
          </dl>
        </Panel>
      </div>

      <SectionTitle note="Click a bar to open the report">Where the money goes</SectionTitle>
      <div className="grid g-2">
        <Panel title={topBy === 'total' ? 'The 10 most expensive reports' : 'The 10 reports with the highest cost per view'}
          subtitle="Each bar is split into Snowflake compute and AWS hosting"
          actions={<Segmented value={topBy} onChange={setTopBy} options={[{ value: 'total', label: 'Total' }, { value: 'perView', label: 'Per view' }]} />}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="26%">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" {...axis(c)} tickFormatter={topBy === 'total' ? fmt.usdCompact : (v) => `$${v.toFixed(1)}`} />
              <YAxis type="category" dataKey="report_id" width={64} {...axis(c)} axisLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l, p) => `${l} · ${p?.[0]?.payload?.report_name ?? ''}`}
                names={{ credit_cost_usd: 'Snowflake', aws_cost_usd: 'AWS', credit_cost_per_view_usd: 'Snowflake per view', aws_per_view_usd: 'AWS per view' }}
                format={(v) => (topBy === 'total' ? fmt.usd(v, 0) : fmt.usd(v, 3))} />} />
              <Bar dataKey={topBy === 'total' ? 'credit_cost_usd' : 'credit_cost_per_view_usd'} stackId="a" fill={c.snowflake} cursor="pointer" onClick={(d) => navigate(`/reports/${d.report_id}`)} />
              <Bar dataKey={topBy === 'total' ? 'aws_cost_usd' : 'aws_per_view_usd'} stackId="a" fill={c.aws} radius={[0, 5, 5, 0]} cursor="pointer" onClick={(d) => navigate(`/reports/${d.report_id}`)} />
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Snowflake compute', color: c.snowflake }, { label: 'AWS hosting', color: c.aws }]} />
        </Panel>

        <Panel title="Does AWS cost follow usage? No."
          subtitle={`Each dot is one snapshot. A report with few views can still carry a large AWS bill: ${outliers.length} snapshots cost more than $1.35 of AWS per view (the outlier limit) and are flagged.`}>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 6, left: 4 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="views" name="Views" {...axis(c)} tickFormatter={fmt.compact} height={34}
                label={{ value: 'Monthly active views', position: 'insideBottom', offset: -2, fill: c.axis, fontSize: 11 }} />
              <YAxis type="number" dataKey="perView" scale="log" domain={[0.01, 200]} allowDataOverflow {...axis(c)} axisLine={false} width={50}
                ticks={[0.01, 0.1, 1, 10, 100]} tickFormatter={(v) => `$${v}`} />
              <ZAxis range={[20, 20]} />
              <ReferenceLine y={1.3508} stroke={c.accentDeep} strokeDasharray="5 4" label={{ value: 'outlier limit $1.35', fill: c.accentDeep, fontSize: 11, position: 'insideTopRight' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: c.axis }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="tt">
                    <div className="tt-title">{p.report_id} · snapshot {p.seq}</div>
                    <div className="tt-row"><span>AWS cost</span><b>{fmt.usd(p.aws)}</b></div>
                    <div className="tt-row"><span>Active views</span><b>{fmt.num(p.views)}</b></div>
                    <div className="tt-row"><span>AWS per view</span><b>{fmt.usd(p.perView, 3)}</b></div>
                    <div className="tt-row"><span /><b style={{ color: p.outlier ? c.accentDeep : c.usage }}>{p.outlier ? 'Flagged outlier' : 'Normal'}</b></div>
                  </div>
                );
              }} />
              <Scatter data={scatter.filter((p) => !p.outlier)} fill={c.usage} fillOpacity={0.4} isAnimationActive={false} />
              <Scatter data={outliers} fill={c.aws} fillOpacity={0.95} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Normal', color: c.usage, value: fmt.num(scatter.length - outliers.length) }, { label: 'Flagged outlier', color: c.aws, value: fmt.num(outliers.length) }]} />
        </Panel>
      </div>

      <SectionTitle note="Sortable · click a report for its 20 snapshots">Cost by report</SectionTitle>
      <Panel flush>
        <div className="toolbar"><Segmented value={tab} onChange={setTab} options={tabs} /></div>
        {tab === 'reports' && (
          <DataTable rows={reports} columns={reportColumns} searchKeys={['report_id', 'report_name']} pageSize={12}
            initialSort={{ key: 'total_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)} />
        )}
        {tab === 'waste' && (waste.data ? (
          <DataTable rows={waste.data.reports} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
            emptyText="None of your reports are flagged." columns={[
              { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
              { key: 'reason', label: 'Why it is flagged', render: (r) => (r.reason === 'HIGH_CREDITS_LOW_USAGE'
                ? <Badge color={c.serious}>Among the most expensive, among the least viewed</Badge>
                : <Badge color={c.warning}>Used credits in a snapshot with zero views</Badge>) },
              { key: 'credit_cost_usd', label: 'Snowflake cost', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
              { key: 'total_views', label: 'Views', align: 'right', render: (r) => <span className="num">{fmt.num(r.total_views)}</span> },
              { key: 'credit_cost_per_view_usd', label: 'Snowflake per view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_per_view_usd, 2)}</span> },
            ]} />) : <Loading />)}
        {tab === 'owners' && (showback.data ? (
          <DataTable rows={showback.data.owners.map((o) => ({ ...o, id: o.canonical_owner }))} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} columns={[
            { key: 'canonical_owner', label: 'Owner', render: (o) => <span className="mono">{o.canonical_owner}</span> },
            { key: 'reports_owned', label: 'Reports', align: 'right', render: (o) => <span className="num">{o.reports_owned}</span> },
            { key: 'credit_cost_usd', label: 'Snowflake cost', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_usd, 0)}</span> },
            { key: 'credit_share', label: 'Share of all credits', align: 'right', render: (o) => <span className="num">{fmt.pct(o.credit_share, 1)}</span> },
            { key: 'credit_cost_per_view_usd', label: 'Snowflake per view', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_per_view_usd, 2)}</span> },
          ]} />) : <Loading />)}
      </Panel>

      <Panel className="mt" flush>
        <details className="more">
          <summary><ChevronRight size={14} />How these numbers are calculated</summary>
          <div className="panel-body">
            <dl className="dl">
              <dt>Snowflake compute</dt><dd>Valid credits × {fmt.usd(s?.credit_price_usd ?? 3)} per credit (assumed price, roughly Snowflake Enterprise on-demand)</dd>
              <dt>AWS hosting</dt><dd>Taken directly from the source data</dd>
              <dt>Cost per active view</dt><dd>Total cost ÷ total monthly active views, over snapshots with valid credits and at least one view (a ratio of sums, not an average of ratios)</dd>
              <dt>The brief&apos;s Task 3 figure</dt><dd>{usd4(t.snowPerView)} per view: Snowflake compute alone. AWS is added on top so the full cost of serving a view is visible.</dd>
              <dt>Credits per view</dt><dd>{fmt.num(t.creditsPerView, 4)} (needs no price assumption)</dd>
              {s && <><dt>Strict figure</dt><dd>{usd4(s.strict_credit_cost_per_view_usd)} Snowflake per view if snapshots with impossible usage numbers are also left out</dd></>}
              {s && <><dt>Negative credits</dt><dd>24 snapshots ({fmt.num(s.credits_excluded_negative, 2)} credits) left out of every figure, never flipped to positive</dd></>}
            </dl>
          </div>
        </details>
      </Panel>
    </>
  );
}
