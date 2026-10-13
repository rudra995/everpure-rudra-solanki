// System health (brief, Task 1): how fast reports load and whether their automated
// refreshes succeed, across all 20 snapshots of every report.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { Badge, ErrorState, Legend, Loading, PageHeader, Panel, SectionTitle, Segmented, SeverityBadge, Stat, StatusBadge } from '../components/ui.jsx';
import { ChartTooltip, Heatmap, axis, heatLegend } from '../components/charts.jsx';
import DataTable from '../components/DataTable.jsx';
import { latencyHistogram } from '../data.js';
import { fmt } from '../format.js';

const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'latency', label: 'Slow now' }, { value: 'failing', label: 'Refresh failing' }, { value: 'orphaned', label: 'No owner' },
];
const MATCH = {
  all: () => true,
  latency: (r) => r.latest_latency_severity !== 'OK',
  failing: (r) => ['FAILED', 'TIMED_OUT'].includes(r.latest_refresh_status),
  orphaned: (r) => r.currently_orphaned,
};

export default function Health() {
  const navigate = useNavigate();
  const { c } = useTheme();
  const { data, error, loading } = useApi('/api/health/reports');
  const snapsQ = useApi('/api/health/snapshots');
  const [filter, setFilter] = useState('all');
  const [metric, setMetric] = useState('latency');

  const reports = data?.reports ?? [];
  const snaps = snapsQ.data?.snapshots ?? [];
  const rows = useMemo(() => reports.filter(MATCH[filter]), [reports, filter]);
  const hist = useMemo(() => latencyHistogram(snaps), [snaps]);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  const n = snaps.length || 1;
  const cnt = (fn) => snaps.filter(fn).length;
  const slow = cnt((s) => s.avg_load_time_sec > 15);
  const failed = cnt((s) => ['FAILED', 'TIMED_OUT'].includes(s.last_refresh_status));
  const outcomes = ['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({
    s, label: { SUCCESS: 'Succeeded', FAILED: 'Failed', TIMED_OUT: 'Timed out', UNKNOWN: 'Unknown' }[s], n: cnt((x) => x.last_refresh_status === s),
  }));

  const columns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'latest_load_time_sec', label: 'Load time now', align: 'right', render: (r) => <span className="num strong">{fmt.sec(r.latest_load_time_sec)}</span> },
    { key: 'latest_latency_severity', label: 'Speed', render: (r) => <SeverityBadge value={r.latest_latency_severity} />,
      sortValue: (r) => ['OK', 'WARNING', 'HIGH', 'CRITICAL'].indexOf(r.latest_latency_severity) },
    { key: 'latest_refresh_status', label: 'Last refresh', render: (r) => <StatusBadge value={r.latest_refresh_status} /> },
    { key: 'latency_breach_rate', label: 'Slow snapshots', align: 'right', title: 'Share of the 20 snapshots over 15 s', render: (r) => (
      <div className="cellbar"><span className="num">{fmt.pct(r.latency_breach_rate)}</span><span className="track"><span style={{ width: `${r.latency_breach_rate * 100}%`, background: c.latency }} /></span></div>) },
    { key: 'refresh_failure_rate', label: 'Failed refreshes', align: 'right', title: 'Share of the 20 snapshots FAILED or TIMED_OUT', render: (r) => (
      <div className="cellbar"><span className="num">{fmt.pct(r.refresh_failure_rate)}</span><span className="track"><span style={{ width: `${r.refresh_failure_rate * 100}%`, background: c.refresh }} /></span></div>) },
    { key: 'canonical_owner', label: 'Owner', render: (r) => (r.currently_orphaned
      ? <Badge color={c.ownership}>No owner now</Badge>
      : <span className="mono small faint">{r.canonical_owner ?? '—'}</span>) },
  ];

  return (
    <>
      <PageHeader index="02" eyebrow="System health · Task 1" title="System health"
        subtitle={`How fast ${data.scope === 'own' ? 'your' : 'the'} ${reports.length} reports load and whether their automated refreshes succeed, across every snapshot.`} />

      <div className="grid g-3">
        <Stat tone="latency" label="Average load time" value={fmt.sec(snaps.reduce((a, s) => a + Number(s.avg_load_time_sec), 0) / n)}
          sub={`Across ${fmt.num(snaps.length)} snapshots · the limit is 15 s`} />
        <Stat tone="serious" label="Loads slower than 15 s" value={fmt.pct(slow / n)} sub={`${fmt.num(slow)} of ${fmt.num(snaps.length)} snapshots · each one raises an alert`} />
        <Stat tone="critical" label="Refreshes that failed" value={fmt.pct(failed / n)} sub={`${fmt.num(failed)} failed or timed out · each one raises an alert`} />
      </div>

      <SectionTitle note="Every report, every snapshot">Report health map</SectionTitle>
      <Panel title={metric === 'latency' ? 'How long each report took to load' : metric === 'refresh' ? 'How each automated refresh ended' : 'Whether each snapshot had an owner'}
        subtitle="Each column is one report and each row one of its 20 snapshots. Hover a square for details, click it to open the report."
        actions={<Segmented value={metric} onChange={setMetric} options={[
          { value: 'latency', label: 'Load time' }, { value: 'refresh', label: 'Refresh' }, { value: 'ownership', label: 'Ownership' }]} />}>
        {snapsQ.loading ? <div className="skeleton" style={{ height: 330 }} /> : <Heatmap rows={snaps} metric={metric} />}
        <div style={{ marginTop: 16 }}><Legend items={heatLegend(metric, c)} /></div>
      </Panel>

      <div className="grid g-main mt">
        <Panel title="How long reports take to load" subtitle="Every snapshot, grouped in 5-second bands. The dashed line is the 15 s alert limit.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hist} margin={{ top: 6, right: 4, bottom: 0, left: -14 }} barCategoryGap="14%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="bin" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Loaded in ${l}`} names={{ OK: 'Under 15 s', WARNING: 'Warning', HIGH: 'High', CRITICAL: 'Critical' }} />} />
              <ReferenceLine x="15–20s" stroke={c.accentDeep} strokeDasharray="4 3" />
              {['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={c[SEVERITY_KEY[s]]} radius={i === 3 ? [5, 5, 0, 0] : 0} />)}
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Under 15 s', color: c.good }, { label: '15–30 s', color: c.warning }, { label: '30–45 s', color: c.serious }, { label: 'Over 45 s', color: c.critical }]} />
        </Panel>
        <Panel title="How refreshes ended" subtitle="Failed and timed-out refreshes raise alerts. Unknown is tracked as 'needs review', not as a failure.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={outcomes} layout="vertical" margin={{ top: 4, right: 44, bottom: 0, left: 0 }} barCategoryGap="28%">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="label" width={86} {...axis(c)} axisLine={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip names={{ n: 'Snapshots' }} />} />
              <Bar dataKey="n" radius={[0, 6, 6, 0]}>
                {outcomes.map((o) => <Cell key={o.s} fill={c[STATUS_KEY[o.s]]} />)}
                <LabelList dataKey="n" position="right" style={{ fill: c.text, fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <SectionTitle note="Latest snapshot per report · click a row for its history">All reports</SectionTitle>
      <Panel flush>
        <DataTable rows={rows} columns={columns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
          initialSort={{ key: 'latest_load_time_sec', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
          toolbar={<Segmented options={FILTERS} value={filter} onChange={setFilter} />} />
      </Panel>
    </>
  );
}
