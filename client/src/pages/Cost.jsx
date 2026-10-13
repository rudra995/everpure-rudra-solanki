// Cost attribution (brief, Task 3). Total cost is shown everywhere as its two parts:
//   Snowflake compute (valid credits x credit price)  +  AWS hosting.
// Unit cost per active user view = cost / monthly active views over eligible snapshots
// (credits not negative, views > 0), always a ratio of sums.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis } from 'recharts';
import { Cloud, Coins, Eye, Gauge, MinusCircle, Server, Snowflake } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useTheme } from '../theme.jsx';
import { Group, Badge, ErrorState, Loading, Notice, PageHeader, Panel, Segmented, SplitBar, Stat, Legend } from '../components/ui.jsx';
import { ChartTooltip, Donut, axis } from '../components/charts.jsx';
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
    reports: reports.length,
    credits: sum('credits_valid'),
    snowflake: sum('credit_cost_usd'),
    aws: sum('aws_cost_usd'),
    views,
    snowPerView: views ? eligSnow / views : null,
    awsPerView: views ? (eligTotal - eligSnow) / views : null,
    totalPerView: views ? eligTotal / views : null,
    creditsPerView: views ? sum('eligible_credits') / views : null,
  };
}

// Per-report split, derived from the mart's eligible columns.
const withSplit = (r) => {
  const views = n(r.eligible_views);
  const awsElig = n(r.eligible_fully_loaded_cost_usd) - n(r.eligible_credit_cost_usd);
  return {
    ...r,
    total_cost_usd: n(r.credit_cost_usd) + n(r.aws_cost_usd),
    aws_per_view_usd: views ? awsElig / views : null,
  };
};

const SORTS = { total: 'total_cost_usd', snowflake: 'credit_cost_usd', aws: 'aws_cost_usd', perView: 'fully_loaded_cost_per_view_usd' };

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
  const [sortBy, setSortBy] = useState('total');
  const [snapMode, setSnapMode] = useState('total');
  const [tab, setTab] = useState('reports');

  const reports = useMemo(() => (reportsQ.data?.reports ?? []).map(withSplit), [reportsQ.data]);
  const top = useMemo(() => [...reports].sort((a, b) => n(b[SORTS[sortBy]]) - n(a[SORTS[sortBy]])).slice(0, 12), [reports, sortBy]);
  const snaps = snapsQ.data?.snapshots ?? [];
  const perSnap = useMemo(() => {
    const out = [];
    for (let seq = 1; seq <= 20; seq += 1) {
      const r = snaps.filter((x) => x.snapshot_seq === seq);
      if (!r.length) continue;
      const elig = r.filter((x) => x.per_view_eligible);
      const views = elig.reduce((a, x) => a + n(x.monthly_active_views), 0);
      const snow = r.reduce((a, x) => a + n(x.credit_cost_usd), 0);
      const aws = r.reduce((a, x) => a + n(x.aws_hosting_cost_usd), 0);
      out.push({
        label: `#${seq}`, snowflake: snow, aws,
        snowPV: views ? elig.reduce((a, x) => a + n(x.credit_cost_usd), 0) / views : null,
        awsPV: views ? elig.reduce((a, x) => a + n(x.aws_hosting_cost_usd), 0) / views : null,
      });
    }
    return out;
  }, [snaps]);
  const scatter = useMemo(() => awsPerView(snaps), [snaps]);
  // How many reports fall in each $0.50 band of total cost per view.
  const perViewHist = useMemo(() => {
    const bins = Array.from({ length: 8 }, (_, i) => ({ lo: i * 0.5, label: i === 7 ? '$3.5+' : `$${(i * 0.5).toFixed(1)}`, reports: 0 }));
    for (const r of reports) bins[Math.min(7, Math.floor(n(r.fully_loaded_cost_per_view_usd) / 0.5))].reports += 1;
    return bins;
  }, [reports]);

  if (reportsQ.loading || summary.loading) return <Loading />;
  if (reportsQ.error) return <ErrorState error={reportsQ.error} />;

  const s = summary.data?.summary;
  const own = costTotals(reports);
  // Platform figures from the SQL mart when available; own-scope figures otherwise.
  const t = s ? {
    snowflake: n(s.credit_cost_usd), aws: n(s.aws_cost_usd), credits: n(s.credits_valid), views: n(s.eligible_views),
    snowPerView: n(s.credit_cost_per_view_usd), totalPerView: n(s.fully_loaded_cost_per_view_usd),
    awsPerView: n(s.fully_loaded_cost_per_view_usd) - n(s.credit_cost_per_view_usd), creditsPerView: n(s.credits_per_view),
  } : own;
  const outliers = scatter.filter((p) => p.outlier);
  const usd4 = (v) => fmt.usd(v, 4);

  const reportColumns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'canonical_owner', label: 'Owner', render: (r) => <span className="mono small faint">{r.canonical_owner ?? '—'}</span> },
    { key: 'credit_cost_usd', label: 'Snowflake', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
    { key: 'aws_cost_usd', label: 'AWS', align: 'right', render: (r) => <span className="num">{fmt.usd(r.aws_cost_usd, 0)}</span> },
    { key: 'total_cost_usd', label: 'Total cost', align: 'right', render: (r) => (
      <div className="cellbar"><b className="num">{fmt.usd(r.total_cost_usd, 0)}</b>
        <span className="track"><span style={{ width: `${(n(r.credit_cost_usd) / r.total_cost_usd) * 100}%`, background: c.snowflake }} /><span style={{ flex: 1, background: c.aws }} /></span>
      </div>) },
    { key: 'eligible_views', label: 'Views', align: 'right', render: (r) => <span className="num">{fmt.num(r.eligible_views)}</span> },
    { key: 'credit_cost_per_view_usd', label: 'Snowflake / view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_per_view_usd, 3)}</span> },
    { key: 'aws_per_view_usd', label: 'AWS / view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.aws_per_view_usd, 3)}</span> },
    { key: 'fully_loaded_cost_per_view_usd', label: 'Total / view', align: 'right', render: (r) => <b className="num">{fmt.usd(r.fully_loaded_cost_per_view_usd, 3)}</b> },
    { key: 'credits_invalid_snapshots', label: 'Excluded', align: 'right', title: 'Snapshots with negative credits, excluded from cost',
      render: (r) => (r.credits_invalid_snapshots ? <Badge color={c.critical}>{r.credits_invalid_snapshots} negative</Badge> : <span className="faint">—</span>) },
  ];

  const tabs = [
    { value: 'reports', label: `All reports (${reports.length})` },
    ...(all ? [{ value: 'showback', label: 'Owner showback' }] : []),
    { value: 'waste', label: `Expensive but unused (${waste.data?.count ?? 0})` },
  ];

  return (
    <>
      <PageHeader
        title="Cost attribution" />

      <Group title="Unit cost" subtitle="Snowflake compute + AWS hosting per active view">
      <div className="grid g-main">
        <div className="hero">
          <div className="hero-label">{all ? 'Unit cost per active user view' : 'Your unit cost per active view'}</div>
          <div className="hero-value">{usd4(t.totalPerView)}</div>
          <div className="hero-eq">
            <span>=</span>
            <span className="row" style={{ gap: 6 }}><Snowflake size={15} color={'var(--hero-snow)'} /><b>{usd4(t.snowPerView)}</b> Snowflake compute</span>
            <span>+</span>
            <span className="row" style={{ gap: 6 }}><Cloud size={15} color={c.aws} /><b>{usd4(t.awsPerView)}</b> AWS hosting</span>
          </div>
          <div style={{ marginTop: 18 }}>
            <SplitBar parts={[
              { label: 'Snowflake per view', value: t.snowPerView, color: 'var(--hero-snow)', display: usd4(t.snowPerView) },
              { label: 'AWS per view', value: t.awsPerView, color: c.aws, display: usd4(t.awsPerView) },
            ]} />
          </div>
        </div>
        <Panel title="Total spend" subtitle={all ? 'All 100 reports, 20 snapshots each' : `Your ${reports.length} reports`} icon={Coins} iconColor={c.accent}>
          <div className="stat-value" style={{ marginTop: 0 }}>{fmt.usdCompact(t.snowflake + t.aws)}</div>
          <div className="stat-sub" style={{ marginBottom: 14 }}>Snowflake compute + AWS hosting</div>
          <SplitBar parts={[
            { label: 'Snowflake', value: t.snowflake, color: c.snowflake, display: fmt.usdCompact(t.snowflake) },
            { label: 'AWS', value: t.aws, color: c.aws, display: fmt.usdCompact(t.aws) },
          ]} />
        </Panel>
      </div>

      <div className="grid g-6 mt">
        <Stat variant="accent" tone="snowflake" icon={Snowflake} label="Snowflake compute" value={fmt.usdCompact(t.snowflake)} sub={`${fmt.compact(t.credits)} valid credits${s ? ` × ${fmt.usd(s.credit_price_usd)}` : ''}`} spark={perSnap} sparkKey="snowflake" />
        <Stat tone="aws" icon={Server} label="AWS hosting" value={fmt.usdCompact(t.aws)} sub="Hosting cost, all snapshots" spark={perSnap} sparkKey="aws" />
        <Stat tone="usage" icon={Eye} label="Active user views" value={fmt.compact(t.views)} sub="Eligible snapshots only" />
        <Stat tone="snowflake" icon={Gauge} label="Credits per view" value={fmt.num(t.creditsPerView, 4)} sub="No price assumption needed" />
        {s
          ? <Stat tone="latency" icon={Coins} label="Strict Snowflake / view" value={usd4(s.strict_credit_cost_per_view_usd)} sub="Also excludes usage-inconsistent rows" />
          : <Stat tone="latency" icon={Coins} label="Reports" value={own.reports} sub="That you own" />}
        <Stat tone="critical" icon={MinusCircle} label="Negative credits excluded" value={s ? fmt.num(s.credits_excluded_negative, 1) : '—'} sub="24 snapshots · logged as defects" />
      </div>
      </Group>

      <Group title="Where the cost goes" subtitle="By snapshot, report, owner and usage">
      <div className="grid g-main">
        <Panel title="Cost per view across reports" subtitle="Number of reports in each $0.50 band (Snowflake + AWS)">
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={perViewHist} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barCategoryGap="16%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip title={(l) => `${l} per view`} names={{ reports: 'Reports' }} />} />
              <ReferenceLine x={perViewHist[Math.min(7, Math.floor(t.totalPerView / 0.5))]?.label} stroke={c.ink} strokeDasharray="4 4" strokeOpacity={0.6}
                label={{ value: `platform ${fmt.usd(t.totalPerView, 2)}`, position: 'top', fill: c.axis, fontSize: 11 }} />
              <Bar dataKey="reports" radius={[6, 6, 0, 0]}>
                {perViewHist.map((b) => <Cell key={b.label} fill={b.lo + 0.5 > t.totalPerView ? 'url(#pi-bar-orange)' : c.ink} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Below platform average', color: c.ink }, { label: 'At or above average', color: c.orange }]} />
        </Panel>
        <Panel title="Spend split" subtitle="Total across all snapshots">
          <Donut centerLabel="total" centerValue={fmt.usdCompact(t.snowflake + t.aws)} format={fmt.usdCompact}
            parts={[{ label: 'Snowflake compute', value: t.snowflake, color: c.snowflake }, { label: 'AWS hosting', value: t.aws, color: c.aws }]} />
        </Panel>
      </div>
      <div className="grid g-2">
        <Panel title="Spend by snapshot" subtitle="Snapshots 1–20 per report (file order; the data has no dates)"
          actions={<Segmented value={snapMode} onChange={setSnapMode} options={[{ value: 'total', label: 'Total $' }, { value: 'perView', label: 'Per view' }]} />}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={perSnap} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} width={snapMode === 'total' ? 54 : 46} tickFormatter={snapMode === 'total' ? fmt.usdCompact : (v) => `$${v.toFixed(2)}`} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`}
                names={{ snowflake: 'Snowflake', aws: 'AWS', snowPV: 'Snowflake / view', awsPV: 'AWS / view' }}
                format={(v) => (snapMode === 'total' ? fmt.usd(v, 0) : fmt.usd(v, 4))} />} />
              <Bar dataKey={snapMode === 'total' ? 'snowflake' : 'snowPV'} stackId="a" fill={c.snowflake} />
              <Bar dataKey={snapMode === 'total' ? 'aws' : 'awsPV'} stackId="a" fill="url(#pi-bar-orange)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Snowflake compute', color: c.snowflake }, { label: 'AWS hosting', color: c.aws }]} />
        </Panel>

        <Panel title="Top reports by cost" subtitle="Click a bar to open the report"
          actions={<Segmented value={sortBy} onChange={setSortBy} options={[
            { value: 'total', label: 'Total' }, { value: 'snowflake', label: 'Snowflake', color: c.snowflake },
            { value: 'aws', label: 'AWS', color: c.aws }, { value: 'perView', label: 'Per view' }]} />}>
          <ResponsiveContainer width="100%" height={260}>
            {sortBy === 'perView' ? (
              <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%">
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...axis(c)} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                <YAxis type="category" dataKey="report_id" width={66} {...axis(c)} axisLine={false} interval={0} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal names={{ credit_cost_per_view_usd: 'Snowflake / view', aws_per_view_usd: 'AWS / view' }} format={(v) => fmt.usd(v, 3)} />} />
                <Bar dataKey="credit_cost_per_view_usd" stackId="a" fill={c.snowflake} onClick={(d) => navigate(`/reports/${d.report_id}`)} cursor="pointer" />
                <Bar dataKey="aws_per_view_usd" stackId="a" fill="url(#pi-bar-orange-h)" radius={[0, 6, 6, 0]} onClick={(d) => navigate(`/reports/${d.report_id}`)} cursor="pointer" />
              </BarChart>
            ) : (
              <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%">
                <CartesianGrid horizontal={false} />
                <XAxis type="number" {...axis(c)} tickFormatter={fmt.usdCompact} />
                <YAxis type="category" dataKey="report_id" width={66} {...axis(c)} axisLine={false} interval={0} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal names={{ credit_cost_usd: 'Snowflake', aws_cost_usd: 'AWS' }} format={(v) => fmt.usd(v, 0)} />} />
                {sortBy !== 'aws' && <Bar dataKey="credit_cost_usd" stackId="a" fill={c.snowflake} radius={sortBy === 'snowflake' ? [0, 6, 6, 0] : 0} onClick={(d) => navigate(`/reports/${d.report_id}`)} cursor="pointer" />}
                {sortBy !== 'snowflake' && <Bar dataKey="aws_cost_usd" stackId="a" fill="url(#pi-bar-orange-h)" radius={[0, 6, 6, 0]} onClick={(d) => navigate(`/reports/${d.report_id}`)} cursor="pointer" />}
              </BarChart>
            )}
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className={`grid ${all ? 'g-main' : ''} mt`}>
        <Panel title="AWS cost per view vs active views · every snapshot"
          subtitle={`Brief defect 4: AWS cost does not follow usage. ${outliers.length} snapshots sit above the Tukey fence ($1.35 per view) and are flagged.`}>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="views" name="Views" {...axis(c)} tickFormatter={fmt.compact} label={{ value: 'Monthly active views', position: 'insideBottom', offset: -2, fill: c.axis, fontSize: 11 }} height={36} />
              <YAxis type="number" dataKey="perView" name="AWS / view" scale="log" domain={[0.01, 200]} allowDataOverflow {...axis(c)} axisLine={false} width={52}
                ticks={[0.01, 0.1, 1, 10, 100]} tickFormatter={(v) => `$${v}`} />
              <ZAxis range={[22, 22]} />
              <ReferenceLine y={1.3508} stroke={c.aws} strokeDasharray="5 4" label={{ value: 'fence $1.35', fill: c.aws, fontSize: 11, position: 'insideTopRight' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: c.axis }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="tt">
                    <div className="tt-title">{p.report_id} · snapshot {p.seq}</div>
                    <div className="tt-row"><span>AWS cost</span><b>{fmt.usd(p.aws)}</b></div>
                    <div className="tt-row"><span>Views</span><b>{fmt.num(p.views)}</b></div>
                    <div className="tt-row"><span>AWS per view</span><b>{fmt.usd(p.perView, 3)}</b></div>
                    <div className="tt-row"><span>Status</span><b style={{ color: p.outlier ? c.aws : c.usage }}>{p.outlier ? 'Above fence · flagged' : 'Within fence'}</b></div>
                  </div>
                );
              }} />
              <Scatter data={scatter.filter((p) => !p.outlier)} fill={c.usage} fillOpacity={0.45} isAnimationActive={false} />
              <Scatter data={outliers} fill={c.aws} fillOpacity={0.9} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Within fence', color: c.usage, value: fmt.num(scatter.length - outliers.length) }, { label: 'Above fence (flagged)', color: c.aws, value: fmt.num(outliers.length) }]} />
        </Panel>

        {all && showback.data && (
          <Panel title="Snowflake credits by owner" subtitle="Showback: canonical owner per report. Emails masked without PII access.">
            <ResponsiveContainer width="100%" height={300}>
              <Treemap data={showback.data.owners.map((o, i) => ({ name: o.canonical_owner, size: n(o.credit_cost_usd), reports: o.reports_owned, i }))}
                dataKey="size" isAnimationActive={false} stroke="var(--panel)"
                content={<TreeCell c={c} />}>
                <Tooltip content={({ active, payload }) => (active && payload?.length ? (
                  <div className="tt"><div className="tt-title">{payload[0].payload.name}</div>
                    <div className="tt-row"><span>Snowflake cost</span><b>{fmt.usd(payload[0].payload.size, 0)}</b></div>
                    <div className="tt-row"><span>Reports</span><b>{payload[0].payload.reports}</b></div></div>) : null)} />
              </Treemap>
            </ResponsiveContainer>
          </Panel>
        )}
      </div>
      </Group>

      <Group title="Cost by report" subtitle="Per-report attribution, showback and waste">
      <Panel className="mt" flush title="Breakdown" bordered actions={<Segmented value={tab} onChange={setTab} options={tabs} />}>
        {tab === 'reports' && (
          <DataTable rows={reports} columns={reportColumns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
            initialSort={{ key: 'total_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)} />
        )}
        {tab === 'showback' && (showback.data ? (
          <DataTable rows={showback.data.owners.map((o) => ({ ...o, id: o.canonical_owner }))} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} columns={[
            { key: 'canonical_owner', label: 'Owner', render: (o) => <span className="mono">{o.canonical_owner}</span> },
            { key: 'reports_owned', label: 'Reports', align: 'right', render: (o) => <span className="num">{o.reports_owned}</span> },
            { key: 'credits_valid', label: 'Credits', align: 'right', render: (o) => <span className="num">{fmt.num(o.credits_valid, 0)}</span> },
            { key: 'credit_cost_usd', label: 'Snowflake cost', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_usd, 0)}</span> },
            { key: 'credit_share', label: 'Share', align: 'right', render: (o) => <span className="num">{fmt.pct(o.credit_share, 1)}</span> },
            { key: 'credit_cost_per_view_usd', label: 'Snowflake / view', align: 'right', render: (o) => <span className="num">{fmt.usd(o.credit_cost_per_view_usd, 3)}</span> },
          ]} />) : <Loading />)}
        {tab === 'waste' && (waste.data ? (
          <DataTable rows={waste.data.reports} initialSort={{ key: 'credit_cost_usd', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
            emptyText="None of your reports are flagged." columns={[
              { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
              { key: 'reason', label: 'Why it is flagged', render: (r) => (r.reason === 'HIGH_CREDITS_LOW_USAGE'
                ? <Badge color={c.serious}>Top-quartile credits, bottom-quartile views</Badge>
                : <Badge color={c.warning}>Spent credits in a zero-view snapshot</Badge>) },
              { key: 'credit_cost_usd', label: 'Snowflake cost', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_usd, 0)}</span> },
              { key: 'total_views', label: 'Views', align: 'right', render: (r) => <span className="num">{fmt.num(r.total_views)}</span> },
              { key: 'credit_cost_per_view_usd', label: 'Snowflake / view', align: 'right', render: (r) => <span className="num">{fmt.usd(r.credit_cost_per_view_usd, 3)}</span> },
              { key: 'zero_view_snapshots', label: 'Zero-view snapshots', align: 'right', render: (r) => <span className="num">{r.zero_view_snapshots}</span> },
            ]} />) : <Loading />)}
      </Panel>

      <div className="mt">
        <Notice>
          <b>How it is calculated.</b> Snowflake compute = valid credits × {fmt.usd(s?.credit_price_usd ?? 3)} per credit (an assumption, about Enterprise
          on-demand). AWS hosting comes straight from the source. Unit cost = SUM(cost) ÷ SUM(monthly active views) over eligible snapshots (credits not negative,
          views above 0): a ratio of sums, not an average of per-row ratios. The Snowflake part alone ({usd4(t.snowPerView)}) is the figure the brief&apos;s
          Task 3 asks for; AWS is added on top so the full cost of serving a view is visible.
        </Notice>
      </div>
      </Group>
    </>
  );
}

// Treemap tile: one blue (Snowflake) tile per owner, shade by size order.
function TreeCell({ x, y, width, height, name, size, depth, c }) {
  if (depth !== 1 || width < 2) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={c.snowflake} fillOpacity={0.35 + Math.min(0.55, size / 900000)} stroke={c.surface} strokeWidth={2} />
      {width > 90 && height > 36 && (
        <>
          <text x={x + 9} y={y + 19} fill="#fff" stroke="none" fontSize={11.5} fontWeight={600}>{String(name).replace('@company.com', '')}</text>
          <text x={x + 9} y={y + 34} fill="rgba(255,255,255,0.8)" stroke="none" fontSize={11}>{fmt.usdCompact(size)}</text>
        </>
      )}
    </g>
  );
}
