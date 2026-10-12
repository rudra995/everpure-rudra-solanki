/* =============================================================================
   03_account_usage_sim.sql  -  split RAW into the two "source systems".
   Role: PI_DEPLOY
   -----------------------------------------------------------------------------
   In a real deployment the data arrives from two places:
     1. Snowflake itself  -> SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY
                             and WAREHOUSE_METERING_HISTORY (credits)
     2. The portal        -> its own usage log (views, latency, refresh, owner, AWS)
   The CSV mixes both, so we split it back out. That lets the cost engine in 05
   do what a real FinOps pipeline does: JOIN credit logs to portal usage on the
   query tag (= report_id) and the time period.

   SIMULATION NOTES (also in the README):
   - The real ACCOUNT_USAGE views are one row per query / per hour. The CSV is
     already summed per report per snapshot, so our tables keep that grain.
   - There is no timestamp in the source. ASSUMPTION: the 20 rows per report are
     20 sequential monthly snapshots in file order. period_start is SYNTHETIC
     (snapshot 1 = 2025-01-01) and only exists so the join looks like the real
     one. No trend or seasonality analysis is done on it.
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- ------------------------------------------------------- typed base view ---
-- One place where VARCHAR becomes typed values. TRY_TO_NUMBER returns NULL instead
-- of failing, and AUDIT.DQ_RULE_COUNTS counts any such parse failure (expected 0).
-- Scales match the source exactly (credits/AWS 2 dp, latency 1 dp), checked in profiling,
-- so no value is rounded by the cast.
CREATE OR REPLACE VIEW STAGING.V_TYPED_SNAPSHOT AS
WITH ordered AS (
    SELECT r.*,
           -- 0-based position in the file, same as source_row in clean.csv
           _file_row_number - MIN(_file_row_number) OVER () AS source_row
    FROM RAW.REPORT_TELEMETRY_RAW r
)
SELECT
    source_row,
    ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY source_row)       AS snapshot_seq,
    DATEADD(month,
            ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY source_row) - 1,
            '2025-01-01'::DATE)                                          AS period_start,  -- SYNTHETIC
    report_id,
    report_name,
    owner_email                                        AS owner_email_raw,
    last_refresh_status,
    TRY_TO_NUMBER(monthly_active_views)                AS monthly_active_views,
    TRY_TO_NUMBER(snowflake_credits_consumed, 12, 2)   AS snowflake_credits_consumed,
    TRY_TO_NUMBER(avg_load_time_sec, 6, 1)             AS avg_load_time_sec,
    TRY_TO_NUMBER(aws_hosting_cost_usd, 12, 2)         AS aws_hosting_cost_usd,
    TRY_TO_NUMBER(query_count_last_30d)                AS query_count_last_30d,
    TRY_TO_NUMBER(concurrent_user_peak)                AS concurrent_user_peak,
    -- raw text kept alongside so parse failures can be detected
    monthly_active_views       AS _raw_views,
    snowflake_credits_consumed AS _raw_credits,
    avg_load_time_sec          AS _raw_latency,
    aws_hosting_cost_usd       AS _raw_aws
FROM ordered;

-- ------------------------------------------------- portal source system ---
CREATE OR REPLACE TABLE PORTAL.REPORT_REGISTRY AS
SELECT report_id,
       MIN(report_name)            AS report_name,
       COUNT(DISTINCT report_name) AS name_variants   -- expect 1 (checked in AUDIT)
FROM STAGING.V_TYPED_SNAPSHOT
GROUP BY report_id;

CREATE OR REPLACE TABLE PORTAL.REPORT_USAGE_LOG AS
SELECT source_row,
       snapshot_seq,
       period_start,
       report_id,
       owner_email_raw,
       last_refresh_status,
       monthly_active_views,
       avg_load_time_sec,
       aws_hosting_cost_usd,
       concurrent_user_peak
FROM STAGING.V_TYPED_SNAPSHOT;

-- ------------------------------------------- simulated ACCOUNT_USAGE logs ---
-- Column names follow SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY where they exist.
-- query_tag is how a real portal would label its queries (ALTER SESSION SET QUERY_TAG = 'RPT_200').
-- Credits are copied AS-IS, negatives included: this is the "log", the defect lives here
-- and is handled in STAGING, never by editing the source table.
CREATE OR REPLACE TABLE ACCOUNT_USAGE_SIM.QUERY_ATTRIBUTION_HISTORY AS
SELECT 'Q-' || report_id || '-' || LPAD(snapshot_seq, 2, '0')  AS query_id,
       'PI_REPORTING_WH'                                       AS warehouse_name,
       report_id                                               AS query_tag,
       period_start::TIMESTAMP_LTZ                             AS start_time,
       DATEADD(month, 1, period_start)::TIMESTAMP_LTZ          AS end_time,
       snowflake_credits_consumed                              AS credits_attributed_compute,
       query_count_last_30d                                    AS query_count
FROM STAGING.V_TYPED_SNAPSHOT;

-- Warehouse-level bill per period. In real Snowflake this is the number on the invoice,
-- and attributed credits should add up to it (checked in 07_reconciliation.sql).
CREATE OR REPLACE TABLE ACCOUNT_USAGE_SIM.WAREHOUSE_METERING_HISTORY AS
SELECT warehouse_name,
       start_time,
       end_time,
       SUM(credits_attributed_compute) AS credits_used
FROM ACCOUNT_USAGE_SIM.QUERY_ATTRIBUTION_HISTORY
GROUP BY warehouse_name, start_time, end_time;
