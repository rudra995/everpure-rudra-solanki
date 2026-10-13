// System health (brief, Task 1): load latency and refresh reliability, per report and per snapshot.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Clock, HelpCircle, RefreshCw, Timer } from 'lucide-react';
import { useApi } from '../api/useApi.js';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { Group, Badge, ErrorState, Loading, PageHeader, Panel, Segmented, SeverityBadge, Stat, StatusBadge, Legend } from '../components/ui.jsx';
import { ChartTooltip, Donut, Heatmap, axis, heatLegend } from '../components/charts.jsx';
import DataTable from '../components/DataTable.jsx';
import { bySnapshot, latencyHistogram } from '../data.js';
import { fmt } from '../format.js';

const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'latency', label: 'Over 15 s' }, { value: 'failing', label: 'Refresh failing' },
  { value: 'unknown', label: 'Unknown status' }, { value: 'orphaned', label: 'Orphaned' },
];
const MATCH = {
  all: () => true,
  latency: (r) => r.latest_latency_severity !== 'OK',
  failing: (r) => ['FAILED', 'TIMED_OUT'].includes(r.latest_refresh_status),
  unknown: (r) => r.latest_refresh_status === 'UNKNOWN',
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
  const series = useMemo(() => bySnapshot(snaps), [snaps]);
  const hist = useMemo(() => latencyHistogram(snaps).map((b) => ({ ...b, under: b.OK, over: b.WARNING + b.HIGH + b.CRITICAL })), [snaps]);
  const slowest = useMemo(() => [...reports].sort((a, b) => b.avg_load_time_sec - a.avg_load_time_sec).slice(0, 10), [reports]);
  const breach = useMemo(() => series.map((x) => ({ ...x, breachPct: x.breachRate * 100 })), [series]);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  const n = snaps.length || 1;
  const cnt = (fn) => snaps.filter(fn).length;
  const p95 = (() => { const v = snaps.map((s) => Number(s.avg_load_time_sec)).sort((a, b) => a - b); return v.length ? v[Math.floor(0.95 * (v.length - 1))] : null; })();

  const columns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'canonical_owner', label: 'Owner', render: (r) => <span className="mono small faint">{r.canonical_owner ?? '—'}</span> },
    { key: 'latest_refresh_status', label: 'Refresh now', render: (r) => <StatusBadge value={r.latest_refresh_status} /> },
    { key: 'latest_load_time_sec', label: 'Load now', align: 'right', render: (r) => <span className="num strong" style={{ color: c[SEVERITY_KEY[r.latest_latency_severity]] }}>{fmt.sec(r.latest_load_time_sec)}</span> },
    { key: 'latest_latency_severity', label: 'Severity', render: (r) => <SeverityBadge value={r.latest_latency_severity} />,
      sortValue: (r) => ['OK', 'WARNING', 'HIGH', 'CRITICAL'].indexOf(r.latest_latency_severity) },
    { key: 'avg_load_time_sec', label: 'Avg (20)', align: 'right', render: (r) => <span className="num">{fmt.sec(r.avg_load_time_sec)}</span> },
    { key: 'p95_load_time_sec', label: 'p95', align: 'right', render: (r) => <span className="num">{fmt.sec(r.p95_load_time_sec)}</span> },
    { key: 'latency_breach_rate', label: '> 15 s', align: 'right', render: (r) => (
      <div className="cellbar"><span className="num">{fmt.pct(r.latency_breach_rate)}</span><span className="track"><span style={{ width: `${r.latency_breach_rate * 100}%`, background: c.latency }} /></span></div>) },
    { key: 'refresh_failure_rate', label: 'Fail rate', align: 'right', render: (r) => (
      <div className="cellbar"><span className="num">{fmt.pct(r.refresh_failure_rate)}</span><span className="track"><span style={{ width: `${r.refresh_failure_rate * 100}%`, background: c.refresh }} /></span></div>) },
    { key: 'flags', label: 'Flags', sortValue: (r) => (r.currently_orphaned ? 1 : 0), render: (r) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {r.currently_orphaned && <Badge color={c.ownership}>Orphaned</Badge>}
        {r.owner_reassigned && <Badge color={c.accent}>Claimed</Badge>}
        {r.unknown_status_snapshots > 0 && <Badge color={c.unknown}>{r.unknown_status_snapshots} unknown</Badge>}
      </div>) },
  ];

  return (
    <>
      <PageHeader title="System health" />

      <Group title="Key metrics" subtitle="Across all snapshots">
      <div className="grid g-5">
        <Stat variant="accent" tone="latency" icon={Clock} label="Avg load time" value={fmt.sec(snaps.reduce((a, s) => a + Number(s.avg_load_time_sec), 0) / n)} sub={`p95 ${fmt.sec(p95)}`} spark={series} sparkKey="avgLatency" />
        <Stat tone="serious" icon={AlertTriangle} label="Snapshots over 15 s" value={fmt.pct(cnt((s) => s.avg_load_time_sec > 15) / n)} sub={`${fmt.num(cnt((s) => s.avg_load_time_sec > 15))} breaches · alert threshold`} spark={series} sparkKey="breachRate" />
        <Stat tone="critical" icon={Timer} label="Critical (over 45 s)" value={fmt.num(cnt((s) => s.latency_severity === 'CRITICAL'))} sub={`${cnt((s) => Number(s.avg_load_time_sec) === 55)} at the 55 s maximum`} spark={series} sparkKey="CRITICAL" />
        <Stat tone="refresh" icon={RefreshCw} label="Refresh failure rate" value={fmt.pct(cnt((s) => ['FAILED', 'TIMED_OUT'].includes(s.last_refresh_status)) / n)} sub={`${cnt((s) => s.last_refresh_status === 'FAILED')} failed · ${cnt((s) => s.last_refresh_status === 'TIMED_OUT')} timed out`} spark={series} sparkKey="failureRate" />
        <Stat tone="unknown" icon={HelpCircle} label="Unknown status" value={fmt.num(cnt((s) => s.last_refresh_status === 'UNKNOWN'))} sub="Needs review · not a failure" />
      </div>
      </Group>

      <Group title="Latency and refresh" subtitle="Per report and per snapshot">
      <Panel className="mt" title="Report health map" subtitle="Each column is a report, each row a snapshot (1 at the top). Hover for detail, click to drill in."
        actions={<Segmented value={metric} onChange={setMetric} options={[
          { value: 'latency', label: 'Latency', color: c.latency }, { value: 'refresh', label: 'Refresh', color: c.refresh }, { value: 'ownership', label: 'Ownership', color: c.ownership }]} />}>
        {snapsQ.loading ? <div className="skeleton" style={{ height: 260 }} /> : <Heatmap rows={snaps} metric={metric} />}
        <div style={{ marginTop: 12 }}><Legend items={heatLegend(metric, c)} /></div>
      </Panel>

      <div className="grid g-2 mt">
        <Panel title="Load time distribution" subtitle="All snapshots in 5-second bins, coloured by severity tier · line = 15 s alert threshold">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={hist} margin={{ top: 6, right: 4, bottom: 0, left: -14 }} barCategoryGap="12%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="bin" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Load time ${l}`} />} />
              <ReferenceLine x="15–20s" stroke={c.warning} strokeDasharray="4 3" />
              <Bar dataKey="under" stackId="a" fill={c.ink} />
              <Bar dataKey="over" stackId="a" fill="url(#pi-bar-orange)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: '≤ 15 s', color: c.ink }, { label: '> 15 s (alerted)', color: c.orange }]} />
        </Panel>
        <Panel title="Refresh problems by snapshot" subtitle="FAILED and TIMED_OUT raise alerts; UNKNOWN is tracked separately">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: -14 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip showTotal title={(l) => `Snapshot ${l}`} names={{ TIMED_OUT: 'TIMED OUT' }} />} />
              <Bar dataKey="FAILED" stackId="a" fill={c.ink} />
              <Bar dataKey="TIMED_OUT" stackId="a" fill="url(#pi-bar-orange)" />
              <Bar dataKey="UNKNOWN" stackId="a" fill={c.gray} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Legend items={[{ label: 'Failed', color: c.ink }, { label: 'Timed out', color: c.orange }, { label: 'Unknown', color: c.gray }]} />
        </Panel>
      </div>
      <div className="grid g-3">
        <Panel title="Slowest reports" subtitle="Average load time over 20 snapshots · click to open">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={slowest} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" {...axis(c)} unit="s" />
              <YAxis type="category" dataKey="report_id" width={64} {...axis(c)} axisLine={false} interval={0} />
              <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip names={{ avg_load_time_sec: 'Avg load time' }} format={(v) => `${Number(v).toFixed(1)} s`} />} />
              <Bar dataKey="avg_load_time_sec" fill="url(#pi-bar-orange-h)" radius={[0, 6, 6, 0]} cursor="pointer" onClick={(d) => navigate(`/reports/${d.report_id}`)} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Loads over 15 s, by snapshot" subtitle="Share of reports breaching the threshold">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={breach} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="seq" {...axis(c)} interval={1} />
              <YAxis {...axis(c)} axisLine={false} unit="%" domain={[0, 100]} />
              <Tooltip content={<ChartTooltip title={(l) => `Snapshot ${l}`} names={{ breachPct: 'Over 15 s' }} format={(v) => `${v.toFixed(0)}%`} />} />
              <Area type="monotone" dataKey="breachPct" stroke={c.orange} strokeWidth={2.5} fill="url(#pi-grad-orange)" dot={{ r: 3, fill: c.surface, stroke: c.orange, strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Refresh outcomes" subtitle="All snapshots">
          <Donut centerLabel="refreshes" parts={['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((st) => ({ label: { SUCCESS: 'Success', FAILED: 'Failed', TIMED_OUT: 'Timed out', UNKNOWN: 'Unknown' }[st], value: cnt((x) => x.last_refresh_status === st), color: c[STATUS_KEY[st]] }))} />
          <div className="footnote">Failed and timed out raise alerts; unknown is "needs review".</div>
        </Panel>
      </div>
      </Group>

      <Group title="Report list" subtitle="Latest snapshot per report">
      <Panel className="mt" flush title="Reports" subtitle="Click a row for its 20 snapshots" bordered>
        <DataTable rows={rows} columns={columns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
          initialSort={{ key: 'latest_load_time_sec', dir: 'desc' }} onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
          toolbar={<Segmented options={FILTERS} value={filter} onChange={setFilter} />} />
      </Panel>
      </Group>
    </>
  );
}
