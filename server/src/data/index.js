// Picks the data source once at startup. Routes only ever call db.query(sql, params);
// the SQL below runs unchanged on DuckDB and Snowflake because both engines expose the
// same schemas, views and column names (built by sql/duckdb and sql/snowflake).
import { config } from '../config.js';

let source = null;

export async function initDb() {
  source = config.dataSource === 'snowflake'
    ? await import('./snowflake.js')
    : await import('./duckdb.js');
  await source.init();
  console.log(`[data] source = ${source.name}`);
  return source.name;
}

export const db = {
  query: (sql, params) => source.query(sql, params),
  get name() { return source?.name ?? null; },
};

// Every query the API runs, in one place, so the API spec can point at them.
export const SQL = {
  healthSummary: `
    SELECT COUNT(*)                                        AS reports,
           SUM(CASE WHEN latest_refresh_status IN ('FAILED','TIMED_OUT') THEN 1 ELSE 0 END) AS reports_refresh_failing,
           SUM(CASE WHEN latest_refresh_status = 'UNKNOWN' THEN 1 ELSE 0 END)               AS reports_status_unknown,
           SUM(CASE WHEN latest_latency_severity <> 'OK' THEN 1 ELSE 0 END)                 AS reports_latency_breaching,
           SUM(CASE WHEN latest_latency_severity = 'CRITICAL' THEN 1 ELSE 0 END)            AS reports_latency_critical,
           SUM(CASE WHEN currently_orphaned THEN 1 ELSE 0 END)                              AS reports_currently_orphaned,
           AVG(avg_load_time_sec)                         AS avg_load_time_sec,
           AVG(latency_breach_rate)                       AS latency_breach_rate,
           AVG(refresh_failure_rate)                      AS refresh_failure_rate
    FROM marts.report_health`,
  reportHealth: `SELECT * FROM marts.report_health ORDER BY report_id`,
  reportHealthOne: `SELECT * FROM marts.report_health WHERE report_id = ?`,
  reportCost: `SELECT * FROM marts.report_cost_attribution ORDER BY credit_rank, report_id`,
  reportCostOne: `SELECT * FROM marts.report_cost_attribution WHERE report_id = ?`,
  reportSnapshots: `
    SELECT snapshot_seq, period_start, last_refresh_status, avg_load_time_sec, latency_severity,
           monthly_active_views, concurrent_user_peak, credits_clean, credits_invalid,
           is_orphaned, per_view_eligible, usage_inconsistent, credit_cost_per_view_usd,
           aws_hosting_cost_usd, aws_cost_usage_mismatch, owner_missing, owner_sentinel
    FROM staging.v_snapshot_clean WHERE report_id = ? ORDER BY snapshot_seq`,
  // Every snapshot (2,000 rows) with the report's canonical owner, for the latency heatmap,
  // per-snapshot charts and the AWS-vs-usage scatter. Cost columns are stripped per row by RBAC.
  snapshotMatrix: `
    SELECT s.report_id, s.report_name, s.snapshot_seq, s.avg_load_time_sec, s.latency_severity,
           s.last_refresh_status, s.is_orphaned, s.owner_missing, s.owner_sentinel,
           s.monthly_active_views, s.concurrent_user_peak, s.usage_inconsistent, s.zero_usage,
           s.credits_clean, s.credits_clean * c.credit_price_usd AS credit_cost_usd, s.credits_invalid,
           s.aws_hosting_cost_usd, s.aws_cost_usage_mismatch, s.per_view_eligible, h.canonical_owner
    FROM staging.v_snapshot_clean s
    JOIN marts.report_health h ON h.report_id = s.report_id
    CROSS JOIN staging.v_config c
    ORDER BY s.report_id, s.snapshot_seq`,
  platformUnitCost: `SELECT * FROM marts.platform_unit_cost`,
  ownerShowback: `SELECT * FROM marts.owner_showback ORDER BY credits_valid DESC`,
  wasteCandidates: `SELECT * FROM marts.waste_candidates ORDER BY credits_valid DESC`,
  orphanedSpend: `
    SELECT o.*, h.currently_orphaned AS report_currently_orphaned, h.canonical_owner
    FROM marts.orphaned_spend o
    JOIN marts.report_health h ON h.report_id = o.report_id
    ORDER BY h.currently_orphaned DESC, o.orphaned_snapshots DESC, o.report_id`,
  orphanedSummary: `
    SELECT COUNT(*)                                               AS orphaned_records,
           SUM(CASE WHEN owner_missing THEN 1 ELSE 0 END)         AS missing_email_records,
           SUM(CASE WHEN owner_sentinel THEN 1 ELSE 0 END)        AS sentinel_records,
           COUNT(DISTINCT report_id)                              AS reports_ever_orphaned,
           COUNT(DISTINCT CASE WHEN snapshot_seq = 20 THEN report_id END) AS reports_currently_orphaned
    FROM staging.v_snapshot_clean WHERE is_orphaned`,
  dqRuleCounts: `SELECT * FROM audit.dq_rule_counts`,
  reconciliation: `SELECT * FROM audit.reconciliation_checks ORDER BY check_id`,
  dqIssues: `SELECT * FROM audit.dq_issue_log`,
  // Replay order for the simulator: snapshot 1 of every report, then snapshot 2, ...
  telemetryReplay: `
    SELECT source_row, snapshot_seq, report_id, report_name, canonical_owner,
           last_refresh_status, avg_load_time_sec, monthly_active_views, concurrent_user_peak,
           is_orphaned
    FROM staging.v_snapshot_clean ORDER BY snapshot_seq, report_id`,
};
