/* =============================================================================
   05_data_quality.sql  -  how many rows each rule caught, plus schema checks.
   Engine: DuckDB  (Snowflake twin: sql/snowflake/06_data_quality.sql)
   -----------------------------------------------------------------------------
   rule names match analysis/rule_counts.json so analysis/reconcile.py can compare
   pandas, DuckDB and Snowflake rule by rule.
   ============================================================================= */

CREATE OR REPLACE VIEW audit.dq_rule_counts AS
WITH s AS (SELECT * FROM staging.v_snapshot_clean),
     t AS (SELECT * FROM staging.v_typed_snapshot)
          SELECT 'raw_rows'                         AS rule, (SELECT COUNT(*) FROM raw.report_telemetry_raw) AS rows_flagged, 'info'   AS category
UNION ALL SELECT 'orphaned_owner_nan',               COUNT_IF(owner_missing),              'brief defect 1' FROM s
UNION ALL SELECT 'orphaned_owner_sentinel',          COUNT_IF(owner_sentinel),             'brief defect 1' FROM s
UNION ALL SELECT 'negative_credits',                 COUNT_IF(credits_invalid),            'brief defect 2' FROM s
UNION ALL SELECT 'latency_over_15s',                 COUNT_IF(latency_breach),             'brief defect 3' FROM s
UNION ALL SELECT 'latency_at_55s_cap',               COUNT_IF(avg_load_time_sec >= 55.0),  'brief defect 3' FROM s
UNION ALL SELECT 'aws_cost_usage_mismatch',          COUNT_IF(aws_cost_usage_mismatch),    'brief defect 4' FROM s
UNION ALL SELECT 'owner_conflict_reports',           COUNT(DISTINCT CASE WHEN owner_conflict THEN report_id END), 'hidden issue' FROM s
UNION ALL SELECT 'refresh_failed',                   COUNT_IF(refresh_failed),             'alert source'   FROM s
UNION ALL SELECT 'refresh_status_unknown',           COUNT_IF(refresh_needs_review),       'hidden issue'   FROM s
UNION ALL SELECT 'refresh_status_unexpected',        COUNT_IF(refresh_status_unexpected),  'schema check'   FROM s
UNION ALL SELECT 'zero_usage',                       COUNT_IF(zero_usage),                 'hidden issue'   FROM s
UNION ALL SELECT 'concurrent_exceeds_monthly_views', COUNT_IF(usage_inconsistent),         'hidden issue'   FROM s
UNION ALL SELECT 'per_view_eligible_rows',           COUNT_IF(per_view_eligible),          'info'           FROM s
-- Parse failures: raw text present but TRY_CAST gave NULL. Expect 0.
UNION ALL SELECT 'numeric_parse_failures',
                 COUNT_IF((monthly_active_views IS NULL AND _raw_views IS NOT NULL)
                       OR (snowflake_credits_consumed IS NULL AND _raw_credits IS NOT NULL)
                       OR (avg_load_time_sec IS NULL AND _raw_latency IS NOT NULL)
                       OR (aws_hosting_cost_usd IS NULL AND _raw_aws IS NOT NULL)),  'schema check' FROM t
-- report_id must map to exactly one report_name. Expect 0.
UNION ALL SELECT 'report_name_variants',
                 (SELECT COUNT_IF(name_variants > 1) FROM portal.report_registry),   'schema check';

-- AWS fence used by rule aws_cost_usage_mismatch, exposed for the report.
CREATE OR REPLACE VIEW audit.dq_thresholds AS
SELECT 'aws_cost_per_view_fence_usd' AS threshold, upper_fence AS value, q1, q3
FROM staging.v_aws_fence;

-- Row-level issue log, same shape as data/clean/issues.csv (one row per row x rule).
CREATE OR REPLACE VIEW audit.dq_issue_log AS
          SELECT report_id, source_row AS row_index, 'owner_email' AS column_name, owner_email_raw AS original_value, 'orphaned_owner_nan' AS rule FROM staging.v_snapshot_clean WHERE owner_missing
UNION ALL SELECT report_id, source_row, 'owner_email', owner_email_raw, 'orphaned_owner_sentinel' FROM staging.v_snapshot_clean WHERE owner_sentinel
UNION ALL SELECT report_id, source_row, 'snowflake_credits_consumed', snowflake_credits_consumed::VARCHAR, 'negative_credits' FROM staging.v_snapshot_clean WHERE credits_invalid
UNION ALL SELECT report_id, source_row, 'avg_load_time_sec', avg_load_time_sec::VARCHAR, 'latency_over_15s' FROM staging.v_snapshot_clean WHERE latency_breach
UNION ALL SELECT report_id, source_row, 'last_refresh_status', last_refresh_status, 'refresh_failed' FROM staging.v_snapshot_clean WHERE refresh_failed
UNION ALL SELECT report_id, source_row, 'last_refresh_status', last_refresh_status, 'refresh_status_unknown' FROM staging.v_snapshot_clean WHERE refresh_needs_review
UNION ALL SELECT report_id, source_row, 'monthly_active_views', monthly_active_views::VARCHAR, 'zero_usage' FROM staging.v_snapshot_clean WHERE zero_usage
UNION ALL SELECT report_id, source_row, 'concurrent_user_peak', concurrent_user_peak::VARCHAR, 'concurrent_exceeds_monthly_views' FROM staging.v_snapshot_clean WHERE usage_inconsistent
UNION ALL SELECT report_id, source_row, 'aws_hosting_cost_usd', aws_hosting_cost_usd::VARCHAR, 'aws_cost_usage_mismatch' FROM staging.v_snapshot_clean WHERE aws_cost_usage_mismatch;

SELECT * FROM audit.dq_rule_counts;
