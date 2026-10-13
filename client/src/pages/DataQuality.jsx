// Data validation: every defect rule with its count and the action taken, the
// reconciliation checks, and (admins only) the row-level issue log.
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Database, MailX, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { Badge, ErrorState, Loading, PageHeader, Panel, Stat } from '../components/ui.jsx';
import { ChartTooltip, axis } from '../components/charts.jsx';
import { useTheme } from '../theme.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

// What each rule means and what the cleaning did about it (mirrors analysis/clean.py and the SQL staging layer).
const RULES = {
  orphaned_owner_nan: ['Owner email missing (NaN)', 'Flag is_orphaned, owner = NULL, row kept'],
  orphaned_owner_sentinel: ['Owner email = ORPHANED_REPORT', 'Flag is_orphaned, owner = NULL, row kept'],
  negative_credits: ['Negative Snowflake credits', 'Set to NULL and excluded from cost; original value logged (not abs())'],
  latency_over_15s: ['Load time over 15 s', 'Value kept; flagged and alerted with a severity tier'],
  latency_at_55s_cap: ['Load time exactly 55.0 s (the maximum)', 'Kept as a plausible real spike; CRITICAL'],
  aws_cost_usage_mismatch: ['AWS cost per view above the Tukey fence ($1.35)', 'Flagged for review; snapshot kept, AWS shown as its own cost line'],
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
  const { c } = useTheme();
  const summary = useApi('/api/data-quality/summary');
  const [rule, setRule] = useState('');
  const issues = useApi(can(P.DQ_READ_ISSUES) ? `/api/data-quality/issues?limit=5000${rule ? `&rule=${rule}` : ''}` : null);

  if (summary.loading) return <Loading />;
  if (summary.error) return <ErrorState error={summary.error} />;
  const { rules, reconciliation, reconciliation_passed: passed } = summary.data;
  const count = (r) => rules.find((x) => x.rule === r)?.rows_flagged ?? 0;
  const passing = reconciliation.filter((x) => x.status === 'PASS').length;
  const chartRules = rules
    .filter((r) => r.category.startsWith('brief') || r.category === 'hidden issue' || r.category === 'alert source')
    .map((r) => ({ ...r, label: RULES[r.rule]?.[0] ?? r.rule }));

  const ruleColumns = [
    { key: 'rule', label: 'Check', render: (r) => <><b>{RULES[r.rule]?.[0] ?? r.rule}</b><div className="mono faint small">{r.rule}</div></> },
    { key: 'category', label: 'Type', render: (r) => <Badge color={r.category.startsWith('brief') ? c.accent : r.category === 'hidden issue' ? c.serious : r.category === 'alert source' ? c.refresh : c.unknown}>{r.category}</Badge> },
    { key: 'rows_flagged', label: 'Rows', align: 'right', render: (r) => (
      <div className="cellbar"><b className="num">{fmt.num(r.rows_flagged)}</b><span className="track"><span style={{ width: `${Math.min(100, (r.rows_flagged / 2000) * 100)}%`, background: c.accent }} /></span></div>) },
    { key: 'action', label: 'Action taken', sortable: false, render: (r) => <span className="muted">{RULES[r.rule]?.[1] ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Validation · defects found in code" title="Data quality"
        subtitle="Every rule from the cleaning pipeline, how many rows it caught and what was done. No row is ever dropped; each finding is logged with its original value." />

      <div className="grid g-4">
        <Stat tone="accent" icon={Database} label="Source rows" value={fmt.num(count('raw_rows'))} sub="100 reports × 20 snapshots, none dropped" />
        <Stat tone="ownership" icon={MailX} label="Orphaned records" value={count('orphaned_owner_nan') + count('orphaned_owner_sentinel')} sub={`${count('orphaned_owner_nan')} NaN + ${count('orphaned_owner_sentinel')} placeholder`} />
        <Stat tone="critical" icon={MinusCircle} label="Negative credit rows" value={count('negative_credits')} sub="Excluded from all cost figures" />
        <Stat tone={passed ? 'good' : 'critical'} icon={ShieldCheck} label="Reconciliation" value={`${passing} / ${reconciliation.length}`} sub={passed ? 'All checks pass' : 'Some checks fail'} />
      </div>

      <Panel className="mt" title="Rows caught per rule" subtitle="Brief defects (indigo), hidden issues found during validation (orange) and the refresh alert source (pink), out of 2,000 rows">
        <ResponsiveContainer width="100%" height={330}>
          <BarChart data={chartRules} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} />
            <XAxis type="number" {...axis(c)} />
            <YAxis type="category" dataKey="rule" width={220} {...axis(c)} axisLine={false} interval={0} tickFormatter={(v) => v.replace(/_/g, ' ')} />
            <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTooltip title={(l, p) => p?.[0]?.payload?.label ?? l} names={{ rows_flagged: 'Rows flagged' }} />} />
            <Bar dataKey="rows_flagged" radius={[0, 4, 4, 0]}>
              {chartRules.map((r) => <Cell key={r.rule} fill={r.category.startsWith('brief') ? c.accent : r.category === 'alert source' ? c.refresh : c.serious} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {SECTIONS.map((sec) => (
        <Panel key={sec.title} className="mt" title={sec.title} flush bordered>
          <DataTable rows={rules.filter((r) => sec.match(r.category)).map((r) => ({ ...r, id: r.rule }))} columns={ruleColumns} pageSize={20} />
        </Panel>
      ))}

      <Panel className="mt" bordered title="Reconciliation checks" subtitle="Computed inside the SQL suite: raw vs staging vs marts. The same numbers are also checked against pandas and Snowflake (analysis/reconciliation.md)." flush>
        <table className="table">
          <thead><tr><th>#</th><th>Check</th><th className="right">Value A</th><th className="right">Value B</th><th className="right">Difference</th><th>Result</th></tr></thead>
          <tbody>
            {reconciliation.map((k) => (
              <tr key={k.check_id}>
                <td className="num faint">{k.check_id}</td>
                <td>{k.check_name}</td>
                <td className="right num">{fmt.num(k.value_a, 4)}</td>
                <td className="right num">{fmt.num(k.value_b, 4)}</td>
                <td className="right num">{fmt.num(k.abs_diff, 6)}</td>
                <td>{k.status === 'PASS'
                  ? <span className="row" style={{ gap: 5, color: c.good, fontWeight: 600 }}><CheckCircle2 size={15} />PASS</span>
                  : <span className="row" style={{ gap: 5, color: c.critical, fontWeight: 600 }}><XCircle size={15} />FAIL</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {can(P.DQ_READ_ISSUES) && (
        <Panel className="mt" bordered title="Issue log" subtitle="One row per finding, with the original source value. Admin only: it contains raw owner emails." flush>
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
                { key: 'rule', label: 'Rule', render: (r) => <Badge color={c.accent}>{r.rule}</Badge> },
              ]} />
          )}
        </Panel>
      )}
    </>
  );
}
