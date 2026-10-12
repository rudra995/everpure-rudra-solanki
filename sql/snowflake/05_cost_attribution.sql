/* =============================================================================
   05_cost_attribution.sql  -  the cost allocation engine (Task 3).
   Role: PI_DEPLOY
   -----------------------------------------------------------------------------
   Brief: "attribute cloud credit consumption to individual reports, calculating
   unit cost per active user view."  So the HEADLINE metric is Snowflake credits:

     credits_per_view          = SUM(valid credits) / SUM(views)            (no price assumption)
     credit_cost_per_view_usd  = SUM(valid credits x CREDIT_PRICE) / SUM(views)

   Secondary (AWS is only mentioned in the brief's defect 4, not in Task 3):
     fully_loaded_cost_per_view_usd = SUM(credit cost + AWS) / SUM(views)

   Per-view figures use ELIGIBLE snapshots only: negative credits are filtered out
   (brief defect 2) and zero-view snapshots are undefined (divide by zero).
   Rows with concurrent users > monthly views are flagged but kept (not in the brief);
   MARTS.PLATFORM_UNIT_COST also shows a "strict" figure without them.

   Why a ratio of sums and not an average of per-row ratios: averaging ratios lets a
   snapshot with 1 view count as much as one with 1,400 views. SUM/SUM is the real
   "cost per view" a FinOps team would charge back.
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- ---------------------------------------------- 1. cost per report ---
-- Built in STAGING without any security policy, then exposed in MARTS where the
-- row access policy is attached (08_security.sql). Views that rank or compare
-- reports (showback, waste) read this unfiltered base, so a report owner's row
-- filter can never change the quartiles or ranks they are shown.
CREATE OR REPLACE VIEW STAGING.V_REPORT_COST_BASE AS
WITH per_report AS (
    SELECT
        report_id,
        ANY_VALUE(report_name)                                  AS report_name,
        ANY_VALUE(canonical_owner)                              AS canonical_owner,
        ANY_VALUE(owner_conflict)                               AS owner_conflict,
        ANY_VALUE(owner_distinct_count)                         AS owner_distinct_count,
        COUNT(*)                                                AS snapshots,
        COUNT_IF(is_orphaned)                                   AS orphaned_snapshots,

        -- credits (the attribution itself)
        SUM(credits_clean)                                      AS credits_valid,
        COUNT_IF(credits_invalid)                               AS credits_invalid_snapshots,
        SUM(IFF(credits_invalid, snowflake_credits_consumed, 0)) AS credits_excluded_negative,
        SUM(credit_cost_usd)                                    AS credit_cost_usd,

        -- AWS (secondary)
        SUM(aws_hosting_cost_usd)                               AS aws_cost_usd,
        -- fully loaded = valid credit cost + ALL AWS cost (AWS is still a real bill even
        -- when that snapshot's credit value is unusable)
        COALESCE(SUM(credit_cost_usd), 0) + SUM(aws_hosting_cost_usd) AS fully_loaded_cost_usd,

        -- usage
        SUM(monthly_active_views)                               AS total_views,
        SUM(query_count_last_30d)                               AS total_queries,

        -- per-view inputs, eligible snapshots only
        COUNT_IF(per_view_eligible)                             AS eligible_snapshots,
        SUM(IFF(per_view_eligible, credits_clean, 0))           AS eligible_credits,
        SUM(IFF(per_view_eligible, credit_cost_usd, 0))         AS eligible_credit_cost_usd,
        SUM(IFF(per_view_eligible, fully_loaded_cost_usd, 0))   AS eligible_fully_loaded_cost_usd,
        SUM(IFF(per_view_eligible, monthly_active_views, 0))    AS eligible_views
    FROM STAGING.V_SNAPSHOT_CLEAN
    GROUP BY report_id
)
SELECT
    p.*,
    eligible_credits               / NULLIF(eligible_views, 0)  AS credits_per_view,
    eligible_credit_cost_usd       / NULLIF(eligible_views, 0)  AS credit_cost_per_view_usd,       -- HEADLINE
    eligible_fully_loaded_cost_usd / NULLIF(eligible_views, 0)  AS fully_loaded_cost_per_view_usd,
    -- RATIO_TO_REPORT: this report's share of all valid credits on the platform
    RATIO_TO_REPORT(credits_valid) OVER ()                      AS credit_share,
    DENSE_RANK() OVER (ORDER BY credits_valid DESC)             AS credit_rank,
    DENSE_RANK() OVER (ORDER BY eligible_credit_cost_usd / NULLIF(eligible_views, 0) DESC) AS cost_per_view_rank
FROM per_report p;

CREATE OR REPLACE VIEW MARTS.REPORT_COST_ATTRIBUTION AS
SELECT * FROM STAGING.V_REPORT_COST_BASE;

-- ---------------------------------------- 2. platform unit cost summary ---
-- The headline answer to "what does one active user view cost us in Snowflake?"
CREATE OR REPLACE VIEW MARTS.PLATFORM_UNIT_COST AS
SELECT
    COUNT(*)                                                    AS snapshots,
    COUNT(DISTINCT report_id)                                   AS reports,
    ANY_VALUE(credit_price_usd)                                 AS credit_price_usd,
    SUM(credits_clean)                                          AS credits_valid,
    SUM(IFF(credits_invalid, snowflake_credits_consumed, 0))    AS credits_excluded_negative,
    SUM(credit_cost_usd)                                        AS credit_cost_usd,
    SUM(aws_hosting_cost_usd)                                   AS aws_cost_usd,
    SUM(credit_cost_usd) + SUM(aws_hosting_cost_usd)            AS fully_loaded_cost_usd,
    SUM(monthly_active_views)                                   AS total_views,

    COUNT_IF(per_view_eligible)                                 AS eligible_rows,
    SUM(IFF(per_view_eligible, monthly_active_views, 0))        AS eligible_views,
    SUM(IFF(per_view_eligible, credits_clean, 0))
      / NULLIF(SUM(IFF(per_view_eligible, monthly_active_views, 0)), 0) AS credits_per_view,
    SUM(IFF(per_view_eligible, credit_cost_usd, 0))
      / NULLIF(SUM(IFF(per_view_eligible, monthly_active_views, 0)), 0) AS credit_cost_per_view_usd,       -- HEADLINE
    SUM(IFF(per_view_eligible, fully_loaded_cost_usd, 0))
      / NULLIF(SUM(IFF(per_view_eligible, monthly_active_views, 0)), 0) AS fully_loaded_cost_per_view_usd,

    -- Sensitivity: also drop rows where concurrent users > monthly views (suspect view counts)
    COUNT_IF(per_view_eligible AND NOT usage_inconsistent)      AS strict_rows,
    SUM(IFF(per_view_eligible AND NOT usage_inconsistent, credit_cost_usd, 0))
      / NULLIF(SUM(IFF(per_view_eligible AND NOT usage_inconsistent, monthly_active_views, 0)), 0)
                                                                AS strict_credit_cost_per_view_usd
FROM STAGING.V_SNAPSHOT_CLEAN;

-- ------------------------------------------ 3. showback by owner ---
-- FinOps "showback": who is accountable for which credits. Uses the canonical owner,
-- so every figure here inherits the ownership-ambiguity caveat (owner_conflict).
CREATE OR REPLACE VIEW MARTS.OWNER_SHOWBACK AS
SELECT
    canonical_owner,
    COUNT(*)                                                    AS reports_owned,
    COUNT_IF(owner_conflict)                                    AS reports_with_conflict,
    SUM(credits_valid)                                          AS credits_valid,
    SUM(credit_cost_usd)                                        AS credit_cost_usd,
    SUM(eligible_credit_cost_usd) / NULLIF(SUM(eligible_views), 0) AS credit_cost_per_view_usd,
    RATIO_TO_REPORT(SUM(credits_valid)) OVER ()                 AS credit_share
FROM STAGING.V_REPORT_COST_BASE
GROUP BY canonical_owner;

-- ----------------------------------------------- 4. orphaned spend ---
-- Credits consumed while the report had no accountable owner. Money nobody is
-- answerable for: the core reason the admin dashboard exists.
CREATE OR REPLACE VIEW MARTS.ORPHANED_SPEND AS
SELECT
    report_id,
    report_name,
    canonical_owner                                             AS suggested_owner,
    COUNT(*)                                                    AS orphaned_snapshots,
    COUNT_IF(owner_missing)                                     AS missing_email_snapshots,
    COUNT_IF(owner_sentinel)                                    AS sentinel_snapshots,
    SUM(credits_clean)                                          AS orphaned_credits,
    SUM(credit_cost_usd)                                        AS orphaned_credit_cost_usd,
    MAX(snapshot_seq)                                           AS last_orphaned_snapshot,
    MAX(snapshot_seq) = 20                                      AS currently_orphaned   -- latest snapshot orphaned
FROM STAGING.V_SNAPSHOT_CLEAN
WHERE is_orphaned
GROUP BY report_id, report_name, canonical_owner;

-- ------------------------------------- 5. expensive but unused ---
-- Decommission candidates: top-quartile credit spend AND bottom-quartile usage,
-- plus any report that had a zero-view snapshot. NTILE keeps the cut data-driven
-- rather than a hand-picked threshold.
CREATE OR REPLACE VIEW MARTS.WASTE_CANDIDATES AS
WITH q AS (
    SELECT r.*,
           NTILE(4) OVER (ORDER BY credits_valid DESC) AS credit_quartile,  -- 1 = most credits
           NTILE(4) OVER (ORDER BY total_views ASC)    AS usage_quartile    -- 1 = least used
    FROM STAGING.V_REPORT_COST_BASE r
),
zero_view_reports AS (
    SELECT report_id, COUNT(*) AS zero_view_snapshots
    FROM STAGING.V_SNAPSHOT_CLEAN
    WHERE zero_usage
    GROUP BY report_id
)
SELECT q.report_id, q.report_name, q.canonical_owner,
       q.credits_valid, q.credit_cost_usd, q.total_views, q.credit_cost_per_view_usd,
       q.credit_quartile, q.usage_quartile,
       COALESCE(z.zero_view_snapshots, 0) AS zero_view_snapshots,
       CASE WHEN q.credit_quartile = 1 AND q.usage_quartile = 1 THEN 'HIGH_CREDITS_LOW_USAGE'
            ELSE 'HAD_ZERO_VIEW_SNAPSHOT' END AS reason
FROM q
LEFT JOIN zero_view_reports z ON z.report_id = q.report_id
WHERE (q.credit_quartile = 1 AND q.usage_quartile = 1)
   OR z.report_id IS NOT NULL;

-- ------------------------------------------------ 6. report health ---
-- Feeds the Health page. Latest snapshot = current state; rates over all 20.
CREATE OR REPLACE VIEW MARTS.REPORT_HEALTH AS
SELECT
    report_id,
    ANY_VALUE(report_name)                                      AS report_name,
    ANY_VALUE(canonical_owner)                                  AS canonical_owner,
    MAX_BY(last_refresh_status, snapshot_seq)                   AS latest_refresh_status,
    MAX_BY(avg_load_time_sec, snapshot_seq)                     AS latest_load_time_sec,
    MAX_BY(latency_severity, snapshot_seq)                      AS latest_latency_severity,
    MAX_BY(is_orphaned, snapshot_seq)                           AS currently_orphaned,
    COUNT_IF(is_orphaned)                                       AS orphaned_snapshots,
    AVG(avg_load_time_sec)                                      AS avg_load_time_sec,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY avg_load_time_sec) AS p95_load_time_sec,
    COUNT_IF(latency_breach) / COUNT(*)                         AS latency_breach_rate,
    COUNT_IF(refresh_failed) / COUNT(*)                         AS refresh_failure_rate,
    COUNT_IF(refresh_needs_review)                              AS unknown_status_snapshots,
    COUNT_IF(usage_inconsistent)                                AS usage_inconsistent_snapshots
FROM STAGING.V_SNAPSHOT_CLEAN
GROUP BY report_id;
