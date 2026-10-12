// Data validation: every defect rule with its count and the action taken, the
// reconciliation checks, and (admins only) the row-level issue log.
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { Badge, Card, ErrorState, Kpi, Loading, PageHeader } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

// What each rule means and what the cleaning did about it (mirrors analysis/clean.py and the SQL staging layer).
const RULES = {
  orphaned_owner_nan: ['Owner email missing (NaN)', 'Flag is_orphaned, owner = NULL, row kept'],
  orphaned_owner_sentinel: ['Owner email = ORPHANED_REPORT', 'Flag is_orphaned, owner = NULL, row kept'],
  negative_credits: ['Negative Snowflake credits', 'Set to NULL and excluded from cost; original value logged (not abs())'],
  latency_over_15s: ['Load time over 15 s', 'Value kept; flagged and alerted with a severity tier'],
  latency_at_55s_cap: ['Load time exactly 55.0 s (the maximum)', 'Kept as a plausible real spike; CRITICAL'],
  aws_cost_usage_mismatch: ['AWS cost per view above the Tukey fence ($1.35)', 'Flagged for review; AWS kept out of the headline unit cost'],
  owner_conflict_reports: ['Reports with several different owner emails', 'Canonical owner = most frequent valid email; flagged'],
  refresh_failed: ['Refresh FAILED or TIMED_OUT', 'Alert raised for every occurrence'],
  refresh_status_unknown: ['Refresh status UNKNOWN (not in the brief)', 'Own category: needs review, not a failure'],
  refresh_status_unexpected: ['Refresh status outside the known set', 'Would be flagged'],
  zero_usage: ['Zero monthly active views', 'Cost per view = NULL (no divide by zero); waste candidate'],
  concurrent_exceeds_monthly_views: ['Concurrent peak above monthly views (impossible)', 'Flagged, kept in headline; excluded in the strict figure'],
  numeric_parse_failures: ['Numbers that failed to parse', 'Would be flagged'],
  report_name_variants: ['Report IDs with more than one name', 'Would be flagged'],
  raw_rows: ['Rows in the source file', 'All kept'],
  per_view_eligible_rows: ['Rows eligible for unit cost', 'Valid credits and views above 0'],
};

const SECTIONS = [
  { title: 'Defects named in the brief', match: (c) => c.startsWith('brief defect') },
  { title: 'Hidden issues found during validation', match: (c) => c === 'hidden issue' || c === 'alert source' },
  { title: 'Schema checks and totals', match: (c) => c === 'schema check' || c === 'info' },
];

export default function DataQuality() {
  const { can } = useAuth();
  const summary = useApi('/api/data-quality/summary');
  const [rule, setRule] = useState('');
  const issues = useApi(can(P.DQ_READ_ISSUES) ? `/api/data-quality/issues?limit=5000${rule ? `&rule=${rule}` : ''}` : null);

  if (summary.loading) return <Loading />;
  if (summary.error) return <ErrorState error={summary.error} />;
  const { rules, reconciliation, reconciliation_passed: passed } = summary.data;
  const count = (r) => rules.find((x) => x.rule === r)?.rows_flagged ?? 0;
  const passing = reconciliation.filter((c) => c.status === 'PASS').length;

  const ruleColumns = [
    { key: 'rule', label: 'Check', render: (r) => <><b>{RULES[r.rule]?.[0] ?? r.rule}</b><div className="mono faint small">{r.rule}</div></> },
    { key: 'category', label: 'Type', render: (r) => <Badge tone={r.category.startsWith('brief') ? 'accent' : r.category === 'hidden issue' ? 'high' : 'unknown'}>{r.category}</Badge> },
    { key: 'rows_flagged', label: 'Rows', align: 'right', render: (r) => <b className="num">{fmt.num(r.rows_flagged)}</b> },
    { key: 'action', label: 'Action taken', sortable: false, render: (r) => <span className="muted">{RULES[r.rule]?.[1] ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Data quality"
        subtitle="Every rule from the cleaning pipeline, how many rows it caught and what was done. No row is ever dropped; each finding is logged with its original value." />

      <div className="grid grid-4">
        <Kpi label="Source rows" value={fmt.num(count('raw_rows'))} hint="100 reports × 20 snapshots, none dropped" />
        <Kpi label="Orphaned records" value={count('orphaned_owner_nan') + count('orphaned_owner_sentinel')} tone="warning" hint={`${count('orphaned_owner_nan')} NaN + ${count('orphaned_owner_sentinel')} placeholder`} />
        <Kpi label="Negative credit rows" value={count('negative_credits')} tone="critical" hint="Excluded from all cost figures" />
        <Kpi label="Reconciliation" value={`${passing} / ${reconciliation.length}`} tone={passed ? 'ok' : 'critical'} hint={passed ? 'All checks pass' : 'Some checks fail'} />
      </div>

      {SECTIONS.map((sec) => (
        <Card key={sec.title} className="mt" title={sec.title} flush>
          <DataTable rows={rules.filter((r) => sec.match(r.category)).map((r) => ({ ...r, id: r.rule }))} columns={ruleColumns} pageSize={20} />
        </Card>
      ))}

      <Card className="mt" title="Reconciliation checks" subtitle="Computed inside the SQL suite: raw vs staging vs marts. The same numbers are also checked against pandas and Snowflake (analysis/reconciliation.md)." flush>
        <table className="table">
          <thead><tr><th>#</th><th>Check</th><th className="right">Value A</th><th className="right">Value B</th><th className="right">Difference</th><th>Result</th></tr></thead>
          <tbody>
            {reconciliation.map((c) => (
              <tr key={c.check_id}>
                <td className="num faint">{c.check_id}</td>
                <td>{c.check_name}</td>
                <td className="right num">{fmt.num(c.value_a, 4)}</td>
                <td className="right num">{fmt.num(c.value_b, 4)}</td>
                <td className="right num">{fmt.num(c.abs_diff, 6)}</td>
                <td>{c.status === 'PASS'
                  ? <span className="row" style={{ gap: 5, color: 'var(--ok)', fontWeight: 600 }}><CheckCircle2 size={15} />PASS</span>
                  : <span className="row" style={{ gap: 5, color: 'var(--critical)', fontWeight: 600 }}><XCircle size={15} />FAIL</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {can(P.DQ_READ_ISSUES) && (
        <Card className="mt" title="Issue log" subtitle="One row per finding, with the original source value. Admin only: it contains raw owner emails." flush>
          {issues.loading && !issues.data ? <Loading /> : (
            <DataTable rows={(issues.data?.issues ?? []).map((r, i) => ({ ...r, id: `${r.rule}-${r.row_index}-${i}` }))}
              searchKeys={['report_id', 'original_value']} pageSize={12}
              toolbar={(
                <>
                  <select className="select" value={rule} onChange={(e) => setRule(e.target.value)}>
                    <option value="">All rules</option>
                    {['orphaned_owner_nan', 'orphaned_owner_sentinel', 'negative_credits', 'latency_over_15s', 'refresh_failed', 'refresh_status_unknown', 'zero_usage', 'concurrent_exceeds_monthly_views', 'aws_cost_usage_mismatch']
                      .map((r) => <option key={r} value={r}>{r} ({count(r)})</option>)}
                  </select>
                  <span className="faint small">{fmt.num(issues.data?.total)} findings</span>
                </>
              )}
              columns={[
                { key: 'row_index', label: 'Source row', align: 'right', render: (r) => <span className="num">{r.row_index}</span> },
                { key: 'report_id', label: 'Report', render: (r) => <b>{r.report_id}</b> },
                { key: 'column_name', label: 'Column', render: (r) => <span className="mono small">{r.column_name}</span> },
                { key: 'original_value', label: 'Original value', render: (r) => <span className="mono small">{r.original_value ?? 'NULL'}</span> },
                { key: 'rule', label: 'Rule', render: (r) => <Badge>{r.rule}</Badge> },
              ]} />
          )}
        </Card>
      )}
    </>
  );
}
