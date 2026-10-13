// Summary: the four numbers that matter, the reports that need attention now, and the
// latest alerts. Details live on the other pages; nothing here is repeated in full.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { Badge, ErrorState, Loading, PageHeader, Panel, SplitBar, Stat } from '../components/ui.jsx';
import { AlertStream } from '../components/LiveWidgets.jsx';
import { fmt } from '../format.js';
import { costTotals } from './Cost.jsx';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// How urgent a report is right now (latest snapshot): critical load > failed refresh > orphaned.
function attention(r) {
  const reasons = [];
  let score = 0;
  if (r.latest_latency_severity === 'CRITICAL') { score += 3; reasons.push('critical'); }
  else if (r.latest_latency_severity === 'HIGH') { score += 1; reasons.push('high'); }
  if (['FAILED', 'TIMED_OUT'].includes(r.latest_refresh_status)) { score += 2; reasons.push('refresh'); }
  if (r.currently_orphaned) { score += 1; reasons.push('orphaned'); }
  return { score, reasons };
}

export default function Overview() {
  const { user, can } = useAuth();
  const { c } = useTheme();
  const live = useLive();
  const health = useApi('/api/health/reports');
  const costAll = useApi(can(P.COST_READ_ALL) ? '/api/cost/summary' : null);
  const costOwn = useApi(!can(P.COST_READ_ALL) && can(P.COST_READ_OWN) ? '/api/cost/reports' : null);
  const orphaned = useApi(can(P.ORPHANED_READ) ? '/api/orphaned' : null);

  const reports = health.data?.reports ?? [];
  const urgent = useMemo(() => reports.map((r) => ({ r, ...attention(r) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.latest_load_time_sec - a.r.latest_load_time_sec).slice(0, 7), [reports]);

  if (health.loading) return <Loading />;
  if (health.error) return <ErrorState error={health.error} />;

  const count = (fn) => reports.filter(fn).length;
  const sev = (s) => count((r) => r.latest_latency_severity === s);
  const status = (s) => count((r) => r.latest_refresh_status === s);
  const scopeOwn = health.data.scope === 'own';

  let cost = null;
  if (costAll.data) {
    const s = costAll.data.summary;
    cost = { snowPV: Number(s.credit_cost_per_view_usd), totalPV: Number(s.fully_loaded_cost_per_view_usd) };
  } else if (costOwn.data) {
    const t = costTotals(costOwn.data.reports);
    cost = { snowPV: t.snowPerView, totalPV: t.totalPerView };
  }

  return (
    <>
      <PageHeader index="01" eyebrow="Summary" title={`${greeting()}, ${user.name.split(' ')[0]}.`}
        subtitle={scopeOwn
          ? `Here is how your ${reports.length} reports are doing right now, based on each report's most recent snapshot.`
          : 'Here is how the 100 portal reports are doing right now, based on each report\'s most recent snapshot.'} />

      <div className="grid g-4">
        <Stat to="/health" tone="serious" label="Reports loading slowly" value={sev('WARNING') + sev('HIGH') + sev('CRITICAL')} unit={`of ${reports.length}`}
          sub={`Over the 15 s limit · ${sev('CRITICAL')} take more than 45 s`} />
        <Stat to="/health" tone="critical" label="Refreshes failing" value={status('FAILED') + status('TIMED_OUT')} unit={`of ${reports.length}`}
          sub={`${status('FAILED')} failed, ${status('TIMED_OUT')} timed out`} />
        <Stat to={can(P.ORPHANED_READ) ? '/orphaned' : undefined} tone="ownership" label="Reports with no owner" value={count((r) => r.currently_orphaned)}
          sub={orphaned.data ? `${orphaned.data.summary.orphaned_records} orphaned records across all snapshots` : 'Owner email missing on the latest snapshot'} />
        {cost ? (
          <Stat to="/cost" tone="accent" label={scopeOwn ? 'Your cost per active view' : 'Cost per active user view'} value={fmt.usd(cost.totalPV, 2)}
            sub={`${fmt.usd(cost.snowPV, 2)} Snowflake + ${fmt.usd(cost.totalPV - cost.snowPV, 2)} AWS`}
            foot={<SplitBar thin legend={false} parts={[{ label: 'Snowflake', value: cost.snowPV, color: c.snowflake }, { label: 'AWS', value: cost.totalPV - cost.snowPV, color: c.aws }]} />} />
        ) : (
          <Stat tone="latency" label="Average load time" value={fmt.sec(reports.reduce((a, r) => a + Number(r.latest_load_time_sec), 0) / (reports.length || 1))} sub="Latest snapshot, all reports" />
        )}
      </div>

      <div className={`grid ${live.receivesAlerts ? 'g-main' : 'g-main'} mt`}>
        <Panel flush bordered title="Needs attention" subtitle="Reports with the most urgent problems right now, worst first. Click one to see its history."
          actions={<Link to="/health" className="btn sm">All reports <ArrowRight size={13} /></Link>}>
          <ul className="attn">
            {urgent.map(({ r, reasons }) => (
              <li key={r.report_id}>
                <Link to={`/reports/${r.report_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="strong">{r.report_id} <span className="faint" style={{ fontWeight: 400 }}>· {r.report_name}</span></div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 5 }}>
                    {reasons.includes('critical') && <Badge color={c.critical} dot>Loads in {fmt.sec(r.latest_load_time_sec)}</Badge>}
                    {reasons.includes('high') && <Badge color={c.serious} dot>Loads in {fmt.sec(r.latest_load_time_sec)}</Badge>}
                    {reasons.includes('refresh') && <Badge color={c[STATUS_KEY[r.latest_refresh_status]]}>Refresh {r.latest_refresh_status === 'FAILED' ? 'failed' : 'timed out'}</Badge>}
                    {reasons.includes('orphaned') && <Badge color={c.ownership}>No owner</Badge>}
                  </div>
                </Link>
                <ArrowRight size={15} color="var(--text-3)" />
              </li>
            ))}
            {!urgent.length && <li className="empty">Nothing urgent right now.</li>}
          </ul>
        </Panel>

        {live.receivesAlerts ? (
          <Panel flush bordered title="Latest alerts" subtitle="Streaming live as breaches happen"
            actions={<Link to="/alerts" className="btn sm">Open feed <ArrowRight size={13} /></Link>}>
            <AlertStream limit={6} />
          </Panel>
        ) : (
          <Panel title="Right now, at a glance" subtitle="Latest snapshot of every report">
            <div className="stack" style={{ gap: 22 }}>
              <div>
                <div className="small strong" style={{ marginBottom: 8 }}>How fast reports load</div>
                <SplitBar parts={['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ label: { OK: 'Under 15 s', WARNING: '15–30 s', HIGH: '30–45 s', CRITICAL: 'Over 45 s' }[s], value: sev(s), color: c[SEVERITY_KEY[s]], display: sev(s) }))} />
              </div>
              <div>
                <div className="small strong" style={{ marginBottom: 8 }}>Last automated refresh</div>
                <SplitBar parts={['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({ label: { SUCCESS: 'Succeeded', FAILED: 'Failed', TIMED_OUT: 'Timed out', UNKNOWN: 'Unknown' }[s], value: status(s), color: c[STATUS_KEY[s]], display: status(s) }))} />
              </div>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
