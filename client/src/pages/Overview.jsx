// Landing page. Shows what this role is allowed to see, nothing more: every block is
// fetched only if the user has the permission for it.
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Clock, FileWarning, Gauge, XCircle } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useLive } from '../live/LiveContext.jsx';
import { Card, Kpi, Loading, Notice, PageHeader, StackBar, COLORS, ErrorState } from '../components/ui.jsx';
import { RecentAlerts, TelemetryTicker } from '../components/LiveWidgets.jsx';
import { fmt } from '../format.js';
import { ownCostTotals } from './Cost.jsx';

export default function Overview() {
  const { user, can } = useAuth();
  const { receivesAlerts, received } = useLive();
  const health = useApi('/api/health/reports');
  const costAll = useApi(can(P.COST_READ_ALL) ? '/api/cost/summary' : null);
  const costOwn = useApi(!can(P.COST_READ_ALL) && can(P.COST_READ_OWN) ? '/api/cost/reports' : null);
  const orphaned = useApi(can(P.ORPHANED_READ) ? '/api/orphaned' : null);
  const dq = useApi(can(P.DQ_READ_SUMMARY) ? '/api/data-quality/summary' : null);

  if (health.loading) return <Loading />;
  if (health.error) return <ErrorState error={health.error} />;

  const reports = health.data.reports;
  const count = (fn) => reports.filter(fn).length;
  const sev = (s) => count((r) => r.latest_latency_severity === s);
  const status = (s) => count((r) => r.latest_refresh_status === s);
  const scopeOwn = health.data.scope === 'own';

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        subtitle={scopeOwn
          ? `Health and cost for the ${reports.length} reports you own.`
          : 'Platform health across all 100 portal reports, based on each report\'s latest snapshot (20 per report).'}
      />

      <div className="grid grid-4">
        <Kpi icon={Gauge} label={scopeOwn ? 'Your reports' : 'Reports monitored'} value={reports.length} hint="Latest of 20 snapshots each" />
        <Kpi icon={Clock} label="Load time over 15 s" value={count((r) => r.latest_latency_severity !== 'OK')} tone="high" hint={`${sev('CRITICAL')} critical (over 45 s)`} />
        <Kpi icon={XCircle} label="Refresh failing" value={status('FAILED') + status('TIMED_OUT')} tone="critical" hint={`${status('FAILED')} failed · ${status('TIMED_OUT')} timed out`} />
        <Kpi icon={FileWarning} label="Currently orphaned" value={count((r) => r.currently_orphaned)} tone="warning" hint="No owner on latest snapshot" />
      </div>

      <div className="grid grid-3 mt">
        <Card className="span-2" title="Latest snapshot health" subtitle="Severity: WARNING 15–30 s · HIGH 30–45 s · CRITICAL over 45 s">
          <div className="stack" style={{ gap: 22 }}>
            <div>
              <div className="small muted" style={{ marginBottom: 8, fontWeight: 600 }}>Dashboard load latency</div>
              <StackBar segments={['OK', 'WARNING', 'HIGH', 'CRITICAL'].map((s) => ({ label: s === 'OK' ? 'OK (≤ 15 s)' : s, value: sev(s), color: COLORS[s] }))} />
            </div>
            <div>
              <div className="small muted" style={{ marginBottom: 8, fontWeight: 600 }}>Automated refresh</div>
              <StackBar segments={['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({ label: s === 'UNKNOWN' ? 'UNKNOWN (needs review)' : s.replace('_', ' '), value: status(s), color: COLORS[s] }))} />
            </div>
          </div>
        </Card>

        {can(P.COST_READ_ALL) && costAll.data && (
          <Kpi hero icon={Activity} label="Unit cost per active user view"
               value={fmt.usd(costAll.data.summary.credit_cost_per_view_usd, 4)}
               hint={`Snowflake credit cost · ${fmt.num(costAll.data.summary.credits_per_view, 4)} credits per view at ${fmt.usd(costAll.data.summary.credit_price_usd)}/credit`}>
            <div className="kpi-extra">
              <div><span>Credit cost</span><span>{fmt.usdCompact(costAll.data.summary.credit_cost_usd)}</span></div>
              <div><span>Active user views</span><span>{fmt.compact(costAll.data.summary.eligible_views)}</span></div>
              <div><span>Fully loaded (+ AWS)</span><span>{fmt.usd(costAll.data.summary.fully_loaded_cost_per_view_usd, 4)}</span></div>
              <div><span>Strict</span><span>{fmt.usd(costAll.data.summary.strict_credit_cost_per_view_usd, 4)}</span></div>
            </div>
          </Kpi>
        )}
        {!can(P.COST_READ_ALL) && costOwn.data && (() => {
          const t = ownCostTotals(costOwn.data.reports);
          return <Kpi hero icon={Activity} label="Your unit cost per active view" value={fmt.usd(t.costPerView, 4)} hint={`Snowflake credit cost across your ${t.reports} reports`}>
            <div className="kpi-extra">
              <div><span>Credit cost</span><span>{fmt.usd(t.creditCost, 0)}</span></div>
              <div><span>Active user views</span><span>{fmt.num(t.views)}</span></div>
              <div><span>Credits per view</span><span>{fmt.num(t.creditsPerView, 4)}</span></div>
              <div><span>Fully loaded (+ AWS)</span><span>{fmt.usd(t.fullyLoadedPerView, 4)}</span></div>
            </div>
          </Kpi>;
        })()}
        {!can([P.COST_READ_ALL, P.COST_READ_OWN]) && (
          <Card title="Your access">
            <Notice>Your role sees the platform health summary only. Cost data, owner details and alerts are limited to other roles.</Notice>
          </Card>
        )}
      </div>

      <div className="grid grid-2 mt">
        {receivesAlerts && (
          <Card title="Latest alerts" subtitle={`${received} received live this session`} actions={<Link to="/alerts" className="btn sm">Open feed</Link>} flush>
            <RecentAlerts />
          </Card>
        )}
        <Card title="Live telemetry" subtitle="Snapshots replayed from the source data" flush className={receivesAlerts ? '' : 'span-2'}>
          <TelemetryTicker limit={receivesAlerts ? 6 : 8} />
        </Card>
      </div>

      {(orphaned.data || dq.data) && (
        <div className="grid grid-2 mt">
          {orphaned.data && (
            <Card title="Orphaned reports" actions={<Link to="/orphaned" className="btn sm">Review</Link>}>
              <dl className="dl">
                <dt>Orphaned records (rows)</dt><dd className="num">{orphaned.data.summary.orphaned_records}</dd>
                <dt>Missing email (NaN)</dt><dd className="num">{orphaned.data.summary.missing_email_records}</dd>
                <dt>Placeholder ORPHANED_REPORT</dt><dd className="num">{orphaned.data.summary.sentinel_records}</dd>
                <dt>Reports currently orphaned</dt><dd className="num">{orphaned.data.summary.reports_currently_orphaned}</dd>
              </dl>
            </Card>
          )}
          {dq.data && (
            <Card title="Data validation" actions={<Link to="/data-quality" className="btn sm">Details</Link>}>
              <div className="row" style={{ gap: 12 }}>
                {dq.data.reconciliation_passed
                  ? <CheckCircle2 size={28} color="var(--ok)" />
                  : <AlertTriangle size={28} color="var(--critical)" />}
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {dq.data.reconciliation.filter((c) => c.status === 'PASS').length} / {dq.data.reconciliation.length} reconciliation checks pass
                  </div>
                  <div className="muted small">Raw vs cleaned vs cost marts: no rows lost, totals agree, every defect counted.</div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
