/* =============================================================================
   04_staging.sql  -  cleaning and flagging. Mirrors analysis/clean.py rule for rule.
   Role: PI_DEPLOY
   -----------------------------------------------------------------------------
   Principles (same as the Python pipeline):
   - No row is ever filtered out. Problems become boolean flags.
   - An untrustworthy value becomes NULL in a *_clean column; the original stays visible.
   - Thresholds are defined once in V_CONFIG, not scattered through the SQL.
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- --------------------------------------------------------------- config ---
-- Single source of truth for every threshold. Change here, everything follows.
CREATE OR REPLACE VIEW STAGING.V_CONFIG AS
SELECT 3.00::NUMBER(6,2)  AS credit_price_usd,      -- ASSUMPTION: ~Enterprise on-demand $/credit
       15.0::NUMBER(6,1)  AS latency_alert_sec,     -- from the brief
       30.0::NUMBER(6,1)  AS latency_high_sec,      -- our severity tier
       45.0::NUMBER(6,1)  AS latency_critical_sec,  -- our severity tier
       'ORPHANED_REPORT'  AS orphan_sentinel;

-- ------------------------------------------------- join the two sources ---
-- The attribution join: portal usage <-> credit log on query_tag + period.
-- LEFT JOIN so a usage row with no credit record would still appear (with NULL
-- credits) instead of silently vanishing; AUDIT checks there are none.
CREATE OR REPLACE VIEW STAGING.V_SNAPSHOT_JOINED AS
SELECT u.*,
       r.report_name,
       q.credits_attributed_compute AS snowflake_credits_consumed,
       q.query_count                AS query_count_last_30d,
       q.query_id
FROM PORTAL.REPORT_USAGE_LOG u
JOIN PORTAL.REPORT_REGISTRY r
  ON r.report_id = u.report_id
LEFT JOIN ACCOUNT_USAGE_SIM.QUERY_ATTRIBUTION_HISTORY q
  ON q.query_tag = u.report_id
 AND q.start_time = u.period_start::TIMESTAMP_LTZ;

-- ------------------------------------------------------ row-level flags ---
CREATE OR REPLACE VIEW STAGING.V_SNAPSHOT_FLAGGED AS
WITH base AS (
    SELECT j.*,
           c.*,
           -- Rule 1: orphaned owner. The source writes missing emails as the TEXT 'nan'
           -- (pandas' NaN serialised to CSV); real NULL / blank handled too.
           (j.owner_email_raw IS NULL
            OR TRIM(j.owner_email_raw) IN ('', 'nan', 'NaN', 'NULL', 'None'))  AS owner_missing,
           (j.owner_email_raw = c.orphan_sentinel)                            AS owner_sentinel
    FROM STAGING.V_SNAPSHOT_JOINED j
    CROSS JOIN STAGING.V_CONFIG c
)
SELECT
    source_row, snapshot_seq, period_start, report_id, report_name, query_id,
    owner_email_raw,

    -- Rule 1: orphaned owner (brief defect 1)
    owner_missing,
    owner_sentinel,
    (owner_missing OR owner_sentinel)                         AS is_orphaned,
    IFF(owner_missing OR owner_sentinel, NULL, owner_email_raw) AS owner_email_clean,

    -- Rule 2: negative credits (brief defect 2). NOT abs(): that would invent a value.
    snowflake_credits_consumed,
    (snowflake_credits_consumed < 0)                          AS credits_invalid,
    IFF(snowflake_credits_consumed < 0, NULL, snowflake_credits_consumed) AS credits_clean,

    -- Rule 3: latency breach + severity tier (brief defect 3). Value kept as-is.
    avg_load_time_sec,
    (avg_load_time_sec > latency_alert_sec)                   AS latency_breach,
    CASE WHEN avg_load_time_sec > latency_critical_sec THEN 'CRITICAL'
         WHEN avg_load_time_sec > latency_high_sec     THEN 'HIGH'
         WHEN avg_load_time_sec > latency_alert_sec    THEN 'WARNING'
         ELSE 'OK' END                                        AS latency_severity,

    -- Rule 4: refresh status. UNKNOWN = needs review, NOT a failure.
    last_refresh_status,
    (last_refresh_status IN ('FAILED', 'TIMED_OUT'))          AS refresh_failed,
    (last_refresh_status = 'UNKNOWN')                         AS refresh_needs_review,
    (last_refresh_status NOT IN ('SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN')) AS refresh_status_unexpected,

    -- Rule 5: zero usage -> no cost per view (divide by zero)
    monthly_active_views,
    (monthly_active_views = 0)                                AS zero_usage,

    -- Rule 6: more concurrent users than monthly views is impossible
    concurrent_user_peak,
    (concurrent_user_peak > monthly_active_views)             AS usage_inconsistent,

    aws_hosting_cost_usd,
    query_count_last_30d,
    credit_price_usd
FROM base;

-- ---------------------------------------- AWS cost vs usage (defect 4) ---
-- Tukey fence on AWS cost per view, computed over rows with views > 0.
-- PERCENTILE_CONT = linear interpolation = pandas' default quantile, so the fence
-- matches analysis/clean.py exactly.
--
-- GOTCHA: Snowflake's DIV0NULL(x, 0) returns 0, not NULL. For zero views a cost per
-- view of $0 would look like "free"; the right answer is "undefined", so we use
-- x / NULLIF(views, 0) instead.
CREATE OR REPLACE VIEW STAGING.V_AWS_FENCE AS
WITH per_view AS (
    SELECT aws_hosting_cost_usd / NULLIF(monthly_active_views, 0) AS aws_cost_per_view
    FROM STAGING.V_SNAPSHOT_FLAGGED
    WHERE monthly_active_views > 0
)
SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY aws_cost_per_view) AS q1,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY aws_cost_per_view) AS q3,
       q3 + 1.5 * (q3 - q1)                                            AS upper_fence
FROM per_view;

-- ----------------------------------------------- canonical owner per report ---
-- Hidden issue: each report has 7-13 different valid emails across its snapshots.
-- Canonical owner = most frequent valid email; ties broken alphabetically (deterministic).
CREATE OR REPLACE VIEW STAGING.V_REPORT_OWNER AS
WITH counts AS (
    SELECT report_id, owner_email_clean, COUNT(*) AS n
    FROM STAGING.V_SNAPSHOT_FLAGGED
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
CREATE OR REPLACE VIEW STAGING.V_SNAPSHOT_CLEAN AS
SELECT f.*,
       o.canonical_owner,
       COALESCE(o.owner_distinct_count, 0)                    AS owner_distinct_count,
       COALESCE(o.owner_conflict, FALSE)                      AS owner_conflict,

       f.aws_hosting_cost_usd / NULLIF(f.monthly_active_views, 0) AS aws_cost_per_view,
       COALESCE(f.aws_hosting_cost_usd / NULLIF(f.monthly_active_views, 0) > fence.upper_fence,
                FALSE)                                        AS aws_cost_usage_mismatch,

       -- Cost columns (NUMBER = exact decimal math, no float drift).
       -- Headline = Snowflake credit cost (Task 3 is about credit consumption);
       -- fully loaded (credits + AWS) is a secondary figure.
       f.credits_clean * f.credit_price_usd                   AS credit_cost_usd,
       f.credits_clean * f.credit_price_usd + f.aws_hosting_cost_usd AS fully_loaded_cost_usd,

       -- Eligible unless a brief defect (negative credits) or the maths (0 views) blocks it.
       -- usage_inconsistent is NOT excluded: not in the brief; see strict figure in MARTS.
       NOT (f.credits_invalid OR f.zero_usage)                AS per_view_eligible,
       IFF(f.credits_invalid OR f.zero_usage, NULL,
           f.credits_clean / f.monthly_active_views)          AS credits_per_view,
       IFF(f.credits_invalid OR f.zero_usage, NULL,
           f.credits_clean * f.credit_price_usd / f.monthly_active_views) AS credit_cost_per_view_usd,
       IFF(f.credits_invalid OR f.zero_usage, NULL,
           (f.credits_clean * f.credit_price_usd + f.aws_hosting_cost_usd)
             / f.monthly_active_views)                        AS fully_loaded_cost_per_view_usd
FROM STAGING.V_SNAPSHOT_FLAGGED f
LEFT JOIN STAGING.V_REPORT_OWNER o ON o.report_id = f.report_id
CROSS JOIN STAGING.V_AWS_FENCE fence;
