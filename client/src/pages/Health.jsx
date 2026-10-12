// System health (brief, Task 1): latency and refresh status per report.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '../api/useApi.js';
import { Card, ErrorState, Kpi, Loading, PageHeader, Segmented, SeverityBadge, StatusBadge, Badge, COLORS } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { TelemetryTicker } from '../components/LiveWidgets.jsx';
import { fmt } from '../format.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'latency', label: 'Over 15 s' },
  { value: 'failing', label: 'Refresh failing' },
  { value: 'unknown', label: 'Unknown status' },
  { value: 'orphaned', label: 'Orphaned' },
];
const MATCH = {
  all: () => true,
  latency: (r) => r.latest_latency_severity !== 'OK',
  failing: (r) => ['FAILED', 'TIMED_OUT'].includes(r.latest_refresh_status),
  unknown: (r) => r.latest_refresh_status === 'UNKNOWN',
  orphaned: (r) => r.currently_orphaned,
};

const mean = (xs) => xs.reduce((a, b) => a + Number(b), 0) / (xs.length || 1);

export default function Health() {
  const navigate = useNavigate();
  const { data, error, loading } = useApi('/api/health/reports');
  const [filter, setFilter] = useState('all');

  const reports = data?.reports ?? [];
  const rows = useMemo(() => reports.filter(MATCH[filter]), [reports, filter]);
  const chart = useMemo(() => [...reports].sort((a, b) => b.latest_load_time_sec - a.latest_load_time_sec), [reports]);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} />;

  const columns = [
    { key: 'report_id', label: 'Report', render: (r) => <><b>{r.report_id}</b><div className="faint small">{r.report_name}</div></> },
    { key: 'canonical_owner', label: 'Owner', render: (r) => (r.canonical_owner
      ? <span className="mono small">{r.canonical_owner}</span> : <span className="faint">—</span>) },
    { key: 'latest_refresh_status', label: 'Latest refresh', render: (r) => <StatusBadge value={r.latest_refresh_status} /> },
    { key: 'latest_load_time_sec', label: 'Latest load', align: 'right', render: (r) => <span className="num">{fmt.sec(r.latest_load_time_sec)}</span> },
    { key: 'latest_latency_severity', label: 'Severity', render: (r) => <SeverityBadge value={r.latest_latency_severity} />,
      sortValue: (r) => ['OK', 'WARNING', 'HIGH', 'CRITICAL'].indexOf(r.latest_latency_severity) },
    { key: 'avg_load_time_sec', label: 'Avg (20)', align: 'right', render: (r) => <span className="num">{fmt.sec(r.avg_load_time_sec)}</span> },
    { key: 'p95_load_time_sec', label: 'p95', align: 'right', render: (r) => <span className="num">{fmt.sec(r.p95_load_time_sec)}</span> },
    { key: 'latency_breach_rate', label: '> 15 s', align: 'right', title: 'Share of the 20 snapshots over 15 s', render: (r) => <span className="num">{fmt.pct(r.latency_breach_rate)}</span> },
    { key: 'refresh_failure_rate', label: 'Fail rate', align: 'right', title: 'Share of snapshots FAILED or TIMED_OUT', render: (r) => <span className="num">{fmt.pct(r.refresh_failure_rate)}</span> },
    { key: 'currently_orphaned', label: 'Flags', sortValue: (r) => (r.currently_orphaned ? 1 : 0) + r.usage_inconsistent_snapshots, render: (r) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {r.currently_orphaned && <Badge tone="warning">Orphaned</Badge>}
        {r.owner_reassigned && <Badge tone="accent">Claimed</Badge>}
        {r.unknown_status_snapshots > 0 && <Badge title="Snapshots with UNKNOWN refresh status">{r.unknown_status_snapshots} unknown</Badge>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title="System health"
        subtitle={`Load latency and refresh status for ${data.scope === 'own' ? 'your' : 'all'} ${reports.length} reports. "Latest" is snapshot 20 of 20; averages and rates cover all 20.`} />

      <div className="grid grid-4">
        <Kpi label="Avg load time" value={fmt.sec(mean(reports.map((r) => r.avg_load_time_sec)))} hint="Mean over all snapshots" />
        <Kpi label="Snapshots over 15 s" value={fmt.pct(mean(reports.map((r) => r.latency_breach_rate)))} tone="high" hint="The alert threshold from the brief" />
        <Kpi label="Refresh failure rate" value={fmt.pct(mean(reports.map((r) => r.refresh_failure_rate)))} tone="critical" hint="FAILED or TIMED_OUT" />
        <Kpi label="Unknown refresh status" value={reports.reduce((a, r) => a + r.unknown_status_snapshots, 0)} hint="Snapshots · not counted as failures" />
      </div>

      <div className="grid grid-3 mt">
        <Card className="span-2" title="Latest load time by report" subtitle="Sorted slowest first · lines at 15 s (alert), 30 s and 45 s (severity tiers)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <XAxis dataKey="report_id" tick={false} axisLine={{ stroke: '#e6e8ec' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8a94a6' }} axisLine={false} tickLine={false} unit="s" />
              <Tooltip cursor={{ fill: '#f1f3f6' }} formatter={(v) => [`${v}s`, 'Latest load']} labelStyle={{ fontWeight: 600 }} />
              <ReferenceLine y={15} stroke={COLORS.WARNING} strokeDasharray="4 3" />
              <ReferenceLine y={30} stroke={COLORS.HIGH} strokeDasharray="4 3" />
              <ReferenceLine y={45} stroke={COLORS.CRITICAL} strokeDasharray="4 3" />
              <Bar dataKey="latest_load_time_sec" radius={[3, 3, 0, 0]}>
                {chart.map((r) => <Cell key={r.report_id} fill={COLORS[r.latest_latency_severity]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Live telemetry" subtitle="Latest replayed snapshots" flush>
          <TelemetryTicker limit={6} />
        </Card>
      </div>

      <Card className="mt" title="Reports" subtitle="Click a row for its 20 snapshots" flush>
        <DataTable rows={rows} columns={columns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
          initialSort={{ key: 'latest_load_time_sec', dir: 'desc' }}
          onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
          toolbar={<Segmented options={FILTERS} value={filter} onChange={setFilter} />} />
      </Card>
    </>
  );
}
