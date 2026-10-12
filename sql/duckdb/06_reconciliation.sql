/* =============================================================================
   06_reconciliation.sql  -  prove the numbers add up, inside the database.
   Engine: DuckDB  (Snowflake twin: sql/snowflake/07_reconciliation.sql)
   -----------------------------------------------------------------------------
   Each check computes the same quantity along two independent paths and compares.
   status = PASS when |a - b| <= tolerance. Any FAIL means a join dropped or
   duplicated rows, or a rule was applied inconsistently.
   The cross-engine check (pandas vs DuckDB vs Snowflake) is analysis/reconcile.py.
   ============================================================================= */

CREATE OR REPLACE VIEW audit.reconciliation_checks AS
WITH
raw_side AS (
    SELECT COUNT(*)                                        AS rows_raw,
           SUM(TRY_CAST(snowflake_credits_consumed AS DECIMAL(12,2))) AS credits_raw,
           SUM(TRY_CAST(aws_hosting_cost_usd AS DECIMAL(12,2))) AS aws_raw
    FROM raw.report_telemetry_raw
),
snap AS (
    SELECT COUNT(*)                                        AS rows_clean,
           COUNT(DISTINCT source_row)                      AS distinct_rows,
           COUNT_IF(query_id IS NULL)                      AS unmatched_credit_rows,
           SUM(credits_clean)                              AS credits_valid,
           SUM(CASE WHEN credits_invalid THEN snowflake_credits_consumed ELSE 0 END) AS credits_negative,
           SUM(credit_cost_usd)                            AS credit_cost,
           SUM(aws_hosting_cost_usd)                       AS aws_cost,
           COUNT_IF(per_view_eligible)                     AS eligible,
           COUNT_IF(NOT per_view_eligible)                 AS ineligible,
           COUNT_IF(is_orphaned)                           AS orphaned,
           COUNT_IF(owner_missing) + COUNT_IF(owner_sentinel) AS orphan_parts
    FROM staging.v_snapshot_clean
),
mart AS (
    SELECT SUM(credits_valid)    AS credits_valid,
           SUM(credit_cost_usd)  AS credit_cost,
           SUM(fully_loaded_cost_usd) AS fully_loaded_cost,
           SUM(eligible_credit_cost_usd) AS eligible_credit_cost,
           SUM(eligible_views)   AS eligible_views,
           MIN(snapshots)        AS min_snapshots,
           MAX(snapshots)        AS max_snapshots,
           COUNT(*)              AS reports
    FROM marts.report_cost_attribution
),
plat AS (SELECT * FROM marts.platform_unit_cost),
meter AS (SELECT SUM(credits_used) AS metered FROM account_usage_sim.warehouse_metering_history),
attrib AS (SELECT SUM(credits_attributed_compute) AS attributed FROM account_usage_sim.query_attribution_history),
checks AS (
              SELECT 1  AS check_id, 'Row count: RAW = STAGING (no row dropped)'           AS check_name, CAST(raw_side.rows_raw AS DOUBLE) AS value_a, CAST(snap.rows_clean AS DOUBLE) AS value_b, CAST(0 AS DOUBLE) AS tolerance FROM raw_side, snap
    UNION ALL SELECT 2,  'No duplicated rows after joins (distinct source_row = rows)',       snap.distinct_rows, snap.rows_clean, 0 FROM snap
    UNION ALL SELECT 3,  'Every usage row matched a credit log row (unmatched = 0)',          snap.unmatched_credit_rows, 0, 0 FROM snap
    UNION ALL SELECT 4,  'Credits: valid + excluded negatives = raw total',                   snap.credits_valid + snap.credits_negative, raw_side.credits_raw, 0.001 FROM snap, raw_side
    UNION ALL SELECT 5,  'Credits: snapshot level = report mart',                             snap.credits_valid, mart.credits_valid, 0.001 FROM snap, mart
    UNION ALL SELECT 6,  'Credits: attributed (query log) = metered (warehouse bill)',        attrib.attributed, meter.metered, 0.001 FROM attrib, meter
    UNION ALL SELECT 7,  'AWS cost: staging = raw',                                           snap.aws_cost, raw_side.aws_raw, 0.001 FROM snap, raw_side
    UNION ALL SELECT 8,  'Credit cost: report mart = snapshot level',                         mart.credit_cost, snap.credit_cost, 0.01 FROM mart, snap
    UNION ALL SELECT 9,  'Fully loaded cost: report mart = credit cost + AWS (snapshot level)', mart.fully_loaded_cost, snap.credit_cost + snap.aws_cost, 0.01 FROM mart, snap
    UNION ALL SELECT 10, 'Credit cost per view: platform = SUM(mart)/SUM(mart views)',        plat.credit_cost_per_view_usd, mart.eligible_credit_cost / NULLIF(mart.eligible_views, 0), 0.000001 FROM plat, mart
    UNION ALL SELECT 11, 'Eligible + ineligible snapshots = all rows',                        snap.eligible + snap.ineligible, snap.rows_clean, 0 FROM snap
    UNION ALL SELECT 12, 'Orphaned = missing email + sentinel (no overlap)',                  snap.orphaned, snap.orphan_parts, 0 FROM snap
    UNION ALL SELECT 13, 'Every report has exactly 20 snapshots (min)',                       mart.min_snapshots, 20, 0 FROM mart
    UNION ALL SELECT 14, 'Every report has exactly 20 snapshots (max)',                       mart.max_snapshots, 20, 0 FROM mart
    UNION ALL SELECT 15, 'Report count = 100',                                                mart.reports, 100, 0 FROM mart
)
SELECT check_id, check_name, value_a, value_b,
       ABS(value_a - value_b) AS abs_diff,
       CASE WHEN ABS(value_a - value_b) <= tolerance THEN 'PASS' ELSE 'FAIL' END AS status
FROM checks
ORDER BY check_id;

-- NOTE on check 6: warehouse_metering_history is simulated from the attribution log in 02,
-- so it passes by construction here. It is kept because in a real account the two come
-- from different Snowflake views and this exact check catches unattributed (idle / untagged)
-- warehouse spend.

SELECT * FROM audit.reconciliation_checks;
