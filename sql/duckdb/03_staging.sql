/* =============================================================================
   03_staging.sql  -  cleaning and flagging. Mirrors analysis/clean.py rule for rule.
   Engine: DuckDB  (Snowflake twin: sql/snowflake/04_staging.sql)
   -----------------------------------------------------------------------------
   Principles (same as the Python pipeline):
   - No row is ever filtered out. Problems become boolean flags.
   - An untrustworthy value becomes NULL in a *_clean column; the original stays visible.
   - Thresholds are defined once in v_config, not scattered through the SQL.
   ============================================================================= */

-- --------------------------------------------------------------- config ---
CREATE OR REPLACE VIEW staging.v_config AS
SELECT CAST(3.00 AS DECIMAL(6,2)) AS credit_price_usd,      -- ASSUMPTION: ~Enterprise on-demand $/credit
       CAST(15.0 AS DECIMAL(6,1)) AS latency_alert_sec,     -- from the brief
       CAST(30.0 AS DECIMAL(6,1)) AS latency_high_sec,      -- our severity tier
       CAST(45.0 AS DECIMAL(6,1)) AS latency_critical_sec,  -- our severity tier
       'ORPHANED_REPORT'          AS orphan_sentinel;

-- ------------------------------------------------- join the two sources ---
-- The attribution join: portal usage <-> credit log on query_tag + period.
-- LEFT JOIN so a usage row with no credit record would still appear (with NULL
-- credits) instead of silently vanishing; audit checks there are none.
CREATE OR REPLACE VIEW staging.v_snapshot_joined AS
SELECT u.*,
       r.report_name,
       q.credits_attributed_compute AS snowflake_credits_consumed,
       q.query_count                AS query_count_last_30d,
       q.query_id
FROM portal.report_usage_log u
JOIN portal.report_registry r
  ON r.report_id = u.report_id
LEFT JOIN account_usage_sim.query_attribution_history q
  ON q.query_tag = u.report_id
 AND q.start_time = CAST(u.period_start AS TIMESTAMP);

-- ------------------------------------------------------ row-level flags ---
CREATE OR REPLACE VIEW staging.v_snapshot_flagged AS
WITH base AS (
    SELECT j.*,
           c.*,
           -- Rule 1: orphaned owner. The source writes missing emails as the TEXT 'nan'
           -- (pandas' NaN serialised to CSV); real NULL / blank handled too.
           (j.owner_email_raw IS NULL
            OR TRIM(j.owner_email_raw) IN ('', 'nan', 'NaN', 'NULL', 'None'))  AS owner_missing,
           COALESCE(j.owner_email_raw = c.orphan_sentinel, FALSE)             AS owner_sentinel
    FROM staging.v_snapshot_joined j
    CROSS JOIN staging.v_config c
)
SELECT
    source_row, snapshot_seq, period_start, report_id, report_name, query_id,
    owner_email_raw,

    -- Rule 1: orphaned owner (brief defect 1)
    owner_missing,
    owner_sentinel,
    (owner_missing OR owner_sentinel)                          AS is_orphaned,
    CASE WHEN owner_missing OR owner_sentinel THEN NULL
         ELSE owner_email_raw END                              AS owner_email_clean,

    -- Rule 2: negative credits (brief defect 2). NOT abs(): that would invent a value.
    snowflake_credits_consumed,
    (snowflake_credits_consumed < 0)                           AS credits_invalid,
    CASE WHEN snowflake_credits_consumed < 0 THEN NULL
         ELSE snowflake_credits_consumed END                   AS credits_clean,

    -- Rule 3: latency breach + severity tier (brief defect 3). Value kept as-is.
    avg_load_time_sec,
    (avg_load_time_sec > latency_alert_sec)                    AS latency_breach,
    CASE WHEN avg_load_time_sec > latency_critical_sec THEN 'CRITICAL'
         WHEN avg_load_time_sec > latency_high_sec     THEN 'HIGH'
         WHEN avg_load_time_sec > latency_alert_sec    THEN 'WARNING'
         ELSE 'OK' END                                         AS latency_severity,

    -- Rule 4: refresh status. UNKNOWN = needs review, NOT a failure.
    last_refresh_status,
    (last_refresh_status IN ('FAILED', 'TIMED_OUT'))           AS refresh_failed,
    (last_refresh_status = 'UNKNOWN')                          AS refresh_needs_review,
    (last_refresh_status NOT IN ('SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN')) AS refresh_status_unexpected,

    -- Rule 5: zero usage -> no cost per view (divide by zero)
    monthly_active_views,
    (monthly_active_views = 0)                                 AS zero_usage,

    -- Rule 6: more concurrent users than monthly views is impossible
    concurrent_user_peak,
    (concurrent_user_peak > monthly_active_views)              AS usage_inconsistent,

    aws_hosting_cost_usd,
    query_count_last_30d,
    credit_price_usd
FROM base;

-- ---------------------------------------- AWS cost vs usage (defect 4) ---
-- Tukey fence on AWS cost per view, computed over rows with views > 0.
-- PERCENTILE_CONT = linear interpolation = pandas' default quantile, so the fence
-- matches analysis/clean.py exactly. Division by NULLIF(views, 0) gives NULL, never
-- a fake $0, when there are no views.
CREATE OR REPLACE VIEW staging.v_aws_fence AS
WITH per_view AS (
    SELECT aws_hosting_cost_usd / NULLIF(monthly_active_views, 0) AS aws_cost_per_view
    FROM staging.v_snapshot_flagged
    WHERE monthly_active_views > 0
)
SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY aws_cost_per_view) AS q1,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY aws_cost_per_view) AS q3,
       q3 + 1.5 * (q3 - q1)                                            AS upper_fence
FROM per_view;

-- ----------------------------------------------- canonical owner per report ---
-- Hidden issue: each report has 7-13 different valid emails across its snapshots.
-- Canonical owner = most frequent valid email; ties broken alphabetically (deterministic).
CREATE OR REPLACE VIEW staging.v_report_owner AS
WITH counts AS (
    SELECT report_id, owner_email_clean, COUNT(*) AS n
    FROM staging.v_snapshot_flagged
    WHERE owner_email_clean IS NOT NULL
    GROUP BY report_id, owner_email_clean
)
SELECT report_id,
       owner_email_clean                                      AS canonical_owner,
       n                                                      AS canonical_owner_snapshots,
       COUNT(*) OVER (PARTITION BY report_id)                 AS owner_distinct_count,
       COUNT(*) OVER (PARTITION BY report_id) > 1             AS owner_conflict
FROM counts
QUALIFY ROW_NUMBER() OVER (PARTITION BY report_id
                           ORDER BY n DESC, owner_email_clean ASC) = 1;

-- --------------------------------------------- final clean snapshot view ---
-- Same columns and meaning as data/clean/clean.csv.
CREATE OR REPLACE VIEW staging.v_snapshot_clean AS
SELECT f.*,
       o.canonical_owner,
       COALESCE(o.owner_distinct_count, 0)                    AS owner_distinct_count,
       COALESCE(o.owner_conflict, FALSE)                      AS owner_conflict,

       f.aws_hosting_cost_usd / NULLIF(f.monthly_active_views, 0) AS aws_cost_per_view,
       COALESCE(f.aws_hosting_cost_usd / NULLIF(f.monthly_active_views, 0) > fence.upper_fence,
                FALSE)                                        AS aws_cost_usage_mismatch,

       -- Headline = Snowflake credit cost (Task 3 is about credit consumption);
       -- fully loaded (credits + AWS) is a secondary figure. DECIMAL = exact math.
       f.credits_clean * f.credit_price_usd                   AS credit_cost_usd,
       f.credits_clean * f.credit_price_usd + f.aws_hosting_cost_usd AS fully_loaded_cost_usd,

       -- Eligible unless a brief defect (negative credits) or the maths (0 views) blocks it.
       -- usage_inconsistent is NOT excluded: not in the brief; see strict figure in marts.
       NOT (f.credits_invalid OR f.zero_usage)                AS per_view_eligible,
       CASE WHEN f.credits_invalid OR f.zero_usage THEN NULL
            ELSE f.credits_clean / f.monthly_active_views END AS credits_per_view,
       CASE WHEN f.credits_invalid OR f.zero_usage THEN NULL
            ELSE f.credits_clean * f.credit_price_usd / f.monthly_active_views END AS credit_cost_per_view_usd,
       CASE WHEN f.credits_invalid OR f.zero_usage THEN NULL
            ELSE (f.credits_clean * f.credit_price_usd + f.aws_hosting_cost_usd)
                 / f.monthly_active_views END                 AS fully_loaded_cost_per_view_usd
FROM staging.v_snapshot_flagged f
LEFT JOIN staging.v_report_owner o ON o.report_id = f.report_id
CROSS JOIN staging.v_aws_fence fence;
