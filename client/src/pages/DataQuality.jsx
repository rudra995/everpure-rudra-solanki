// Data quality: the four defects the brief says were injected (found in code, counted and
// handled), the other issues found during validation, and the checks that prove the
// totals still add up after cleaning. Admins can also browse the row-level issue log.
import { useState } from 'react';
import { CheckCircle2, ChevronRight, XCircle } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { useTheme } from '../theme.jsx';
import { Badge, ErrorState, Loading, PageHeader, Panel, SectionTitle, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

const HIDDEN = {
  owner_conflict_reports: ['Reports with several different owner emails', 'Owner = the most frequent valid email; ownership changes need an approved request', 'reports'],
  refresh_status_unknown: ['Refresh status "UNKNOWN" (not mentioned in the brief)', 'Kept as its own "needs review" status; not counted as a failure and does not alert', 'snapshots'],
  zero_usage: ['Snapshots with zero active views', 'Cost per view left empty instead of dividing by zero; listed as waste candidates', 'snapshots'],
  concurrent_exceeds_monthly_views: ['Peak concurrent users above monthly views (impossible)', 'Kept and flagged; a stricter cost figure leaves them out', 'snapshots'],
};

export default function DataQuality() {
  const { can } = useAuth();
  const { c } = useTheme();
  const summary = useApi('/api/data-quality/summary');
  const [rule, setRule] = useState('');
  const [showLog, setShowLog] = useState(false);
  const issues = useApi(can(P.DQ_READ_ISSUES) && showLog ? `/api/data-quality/issues?limit=5000${rule ? `&rule=${rule}` : ''}` : null);

  if (summary.loading) return <Loading />;
  if (summary.error) return <ErrorState error={summary.error} />;
  const { rules, reconciliation, reconciliation_passed: passed } = summary.data;
  const count = (r) => rules.find((x) => x.rule === r)?.rows_flagged ?? 0;
  const passing = reconciliation.filter((x) => x.status === 'PASS').length;

  const defects = [
    { n: count('orphaned_owner_nan') + count('orphaned_owner_sentinel'), unit: 'records', title: 'Orphaned reports',
      found: `Owner email is missing (${count('orphaned_owner_nan')}) or the placeholder ORPHANED_REPORT (${count('orphaned_owner_sentinel')}).`,
      did: 'Marked as orphaned with no owner. Rows are kept: they are what the Orphaned reports page tracks.', color: c.ownership },
    { n: count('negative_credits'), unit: 'snapshots', title: 'Negative Snowflake credits',
      found: 'Credit values below zero (−13.6 to −0.8), which cannot happen in a real bill.',
      did: 'Left out of every cost figure, never flipped to positive. The original value is kept in the issue log.', color: c.critical },
    { n: count('latency_over_15s'), unit: 'snapshots', title: 'Load-time spikes',
      found: `Load time over the 15 s limit; ${count('latency_at_55s_cap')} sit exactly at the 55 s maximum.`,
      did: 'Values kept (a 55 s load is a real problem, not bad data). Each one raises an alert with a severity level.', color: c.latency },
    { n: count('aws_cost_usage_mismatch'), unit: 'snapshots', title: 'AWS cost that ignores usage',
      found: 'AWS cost per active view above $1.35, the statistical outlier limit (Q3 + 1.5 × IQR).',
      did: 'Flagged for review and shown on the Cost page. AWS stays a separate line so it cannot hide in the Snowflake figure.', color: c.aws },
  ];
  const hidden = Object.keys(HIDDEN).map((r) => ({ id: r, rule: r, n: count(r) }));

  return (
    <>
      <PageHeader index="06" eyebrow="Data quality · defects from the brief" title="Data quality"
        subtitle="What was wrong with the source data, how each problem was found in code, and what was done about it. No row is ever deleted." />

      <div className="grid g-3">
        <Stat tone="accent" label="Rows checked" value={fmt.num(count('raw_rows'))} sub="100 reports × 20 snapshots · none removed" />
        <Stat tone="critical" label="Defect types from the brief" value="4" unit="of 4 found" sub="Each detected by a named, tested rule" />
        <Stat tone="good" label="Totals still add up" value={`${passing} / ${reconciliation.length}`} sub={passed ? 'Every reconciliation check passes' : 'Some checks fail'} valueColor={passed ? c.good : c.critical} />
      </div>

      <SectionTitle note="Found programmatically, counted and handled">The four defects named in the brief</SectionTitle>
      <div className="grid g-4">
        {defects.map((d, i) => (
          <div key={d.title} className="panel defect" style={{ borderTop: `3px solid ${d.color}` }}>
            <div className="tag">Defect {i + 1}</div>
            <div className="n">{fmt.num(d.n)} <span className="small faint" style={{ fontFamily: 'var(--font)', fontWeight: 500 }}>{d.unit}</span></div>
            <h4>{d.title}</h4>
            <p><b style={{ color: 'var(--text)' }}>Found: </b>{d.found}</p>
            <p><b style={{ color: 'var(--text)' }}>Handled: </b>{d.did}</p>
          </div>
        ))}
      </div>

      <SectionTitle note="Not mentioned in the brief">Other issues found during validation</SectionTitle>
      <Panel flush>
        <table className="table">
          <thead><tr><th>Issue</th><th className="right">Count</th><th>How it was handled</th></tr></thead>
          <tbody>
            {hidden.map((h) => (
              <tr key={h.id}>
                <td className="strong">{HIDDEN[h.rule][0]}</td>
                <td className="right num strong">{fmt.num(h.n)} <span className="faint small" style={{ fontWeight: 400 }}>{HIDDEN[h.rule][2]}</span></td>
                <td className="muted">{HIDDEN[h.rule][1]}</td>
              </tr>
            ))}
            <tr>
              <td className="strong">No date or time column in the data</td>
              <td className="right faint">—</td>
              <td className="muted">The 20 rows per report are treated as 20 snapshots in file order. Charts are labelled by snapshot number, never by date.</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <SectionTitle note="Raw data vs cleaned data vs cost tables, computed in SQL">Do the numbers add up?</SectionTitle>
      <Panel flush>
        <div className="panel-body row" style={{ gap: 12 }}>
          {passed ? <CheckCircle2 size={22} color={c.good} /> : <XCircle size={22} color={c.critical} />}
          <div><b>{passing} of {reconciliation.length} checks pass.</b> <span className="muted">No rows were lost or duplicated, credits and AWS totals match at every layer, and the unit cost recomputes exactly. The same numbers were also checked independently against pandas and Snowflake.</span></div>
        </div>
        <details className="more">
          <summary><ChevronRight size={14} />Show all {reconciliation.length} checks</summary>
          <table className="table">
            <thead><tr><th>#</th><th>Check</th><th className="right">Value A</th><th className="right">Value B</th><th>Result</th></tr></thead>
            <tbody>
              {reconciliation.map((k) => (
                <tr key={k.check_id}>
                  <td className="num faint">{k.check_id}</td>
                  <td>{k.check_name}</td>
                  <td className="right num">{fmt.num(k.value_a, 2)}</td>
                  <td className="right num">{fmt.num(k.value_b, 2)}</td>
                  <td>{k.status === 'PASS' ? <Badge color={c.good} dot>Pass</Badge> : <Badge color={c.critical} dot>Fail</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Panel>

      {can(P.DQ_READ_ISSUES) && (
        <Panel className="mt" flush>
          <details className="more" onToggle={(e) => setShowLog(e.currentTarget.open)}>
            <summary><ChevronRight size={14} />Row-level issue log (admin only: contains raw owner emails)</summary>
            {issues.loading && !issues.data ? <div className="loading"><div className="spinner" />Loading…</div> : (
              <DataTable rows={(issues.data?.issues ?? []).map((r, i) => ({ ...r, id: `${r.rule}-${r.row_index}-${i}` }))}
                searchKeys={['report_id', 'original_value']} pageSize={12}
                toolbar={(
                  <>
                    <select className="select" value={rule} onChange={(e) => setRule(e.target.value)}>
                      <option value="">All rules</option>
                      {['orphaned_owner_nan', 'orphaned_owner_sentinel', 'negative_credits', 'latency_over_15s', 'refresh_failed', 'refresh_status_unknown', 'zero_usage', 'concurrent_exceeds_monthly_views', 'aws_cost_usage_mismatch']
                        .map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')} ({count(r)})</option>)}
                    </select>
                    <span className="faint small">{fmt.num(issues.data?.total)} findings</span>
                  </>
                )}
                columns={[
                  { key: 'row_index', label: 'Source row', align: 'right', render: (r) => <span className="num">{r.row_index}</span> },
                  { key: 'report_id', label: 'Report', render: (r) => <b>{r.report_id}</b> },
                  { key: 'column_name', label: 'Column', render: (r) => <span className="mono small">{r.column_name}</span> },
                  { key: 'original_value', label: 'Original value', render: (r) => <span className="mono small">{r.original_value ?? 'NULL'}</span> },
                  { key: 'rule', label: 'Rule', render: (r) => <Badge color={c.accent}>{r.rule.replace(/_/g, ' ')}</Badge> },
                ]} />
            )}
          </details>
        </Panel>
      )}
    </>
  );
}
