/* =============================================================================
   02_account_usage_sim.sql  -  split RAW into the two "source systems".
   Engine: DuckDB  (Snowflake twin: sql/snowflake/03_account_usage_sim.sql)
   -----------------------------------------------------------------------------
   In a real deployment the data arrives from two places:
     1. Snowflake itself  -> SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY
                             and WAREHOUSE_METERING_HISTORY (credits)
     2. The portal        -> its own usage log (views, latency, refresh, owner, AWS)
   The CSV mixes both, so we split it back out. The cost engine in 04 then does what
   a real FinOps pipeline does: JOIN credit logs to portal usage on the query tag
   (= report_id) and the time period.

   SIMULATION NOTES:
   - Real ACCOUNT_USAGE views are one row per query / per hour. The CSV is already
     summed per report per snapshot, so our tables keep that grain.
   - There is no timestamp in the source. ASSUMPTION: the 20 rows per report are 20
     sequential monthly snapshots in file order. period_start is SYNTHETIC
     (snapshot 1 = 2025-01-01) and only exists so the join looks like the real one.
     No trend or seasonality analysis is done on it.
   ============================================================================= */

-- ------------------------------------------------------- typed base view ---
-- The one place where VARCHAR becomes typed values. TRY_CAST returns NULL instead of
-- failing; audit.dq_rule_counts counts any parse failure (expected 0). Scales match
-- the source exactly (credits/AWS 2 dp, latency 1 dp), so no value is rounded.
CREATE OR REPLACE VIEW staging.v_typed_snapshot AS
WITH ordered AS (
    SELECT r.*,
           -- 0-based position in the file, same as source_row in clean.csv
           _file_row_number - MIN(_file_row_number) OVER () AS source_row
    FROM raw.report_telemetry_raw r
)
SELECT
    source_row,
    ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY source_row)          AS snapshot_seq,
    DATE '2025-01-01'
      + TO_MONTHS(CAST(ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY source_row) - 1 AS INTEGER))
                                                                            AS period_start,  -- SYNTHETIC
    report_id,
    report_name,
    owner_email                                          AS owner_email_raw,
    last_refresh_status,
    TRY_CAST(monthly_active_views       AS BIGINT)        AS monthly_active_views,
    TRY_CAST(snowflake_credits_consumed AS DECIMAL(12,2)) AS snowflake_credits_consumed,
    TRY_CAST(avg_load_time_sec          AS DECIMAL(6,1))  AS avg_load_time_sec,
    TRY_CAST(aws_hosting_cost_usd       AS DECIMAL(12,2)) AS aws_hosting_cost_usd,
    TRY_CAST(query_count_last_30d       AS BIGINT)        AS query_count_last_30d,
    TRY_CAST(concurrent_user_peak       AS BIGINT)        AS concurrent_user_peak,
    -- raw text kept alongside so parse failures can be detected
    monthly_active_views       AS _raw_views,
    snowflake_credits_consumed AS _raw_credits,
    avg_load_time_sec          AS _raw_latency,
    aws_hosting_cost_usd       AS _raw_aws
FROM ordered;

-- ------------------------------------------------- portal source system ---
CREATE OR REPLACE TABLE portal.report_registry AS
SELECT report_id,
       MIN(report_name)            AS report_name,
       COUNT(DISTINCT report_name) AS name_variants   -- expect 1 (checked in audit)
FROM staging.v_typed_snapshot
GROUP BY report_id;

CREATE OR REPLACE TABLE portal.report_usage_log AS
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
FROM staging.v_typed_snapshot;

-- ------------------------------------------- simulated ACCOUNT_USAGE logs ---
-- Column names follow SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY where they exist.
-- query_tag is how a real portal labels its queries (ALTER SESSION SET QUERY_TAG = 'RPT_200').
-- Credits are copied AS-IS, negatives included: this is the "log"; the defect lives here
-- and is handled in staging, never by editing the source table.
CREATE OR REPLACE TABLE account_usage_sim.query_attribution_history AS
SELECT 'Q-' || report_id || '-' || LPAD(CAST(snapshot_seq AS VARCHAR), 2, '0') AS query_id,
       'PI_REPORTING_WH'                                          AS warehouse_name,
       report_id                                                  AS query_tag,
       CAST(period_start AS TIMESTAMP)                            AS start_time,
       CAST(period_start + INTERVAL 1 MONTH AS TIMESTAMP)         AS end_time,
       snowflake_credits_consumed                                 AS credits_attributed_compute,
       query_count_last_30d                                       AS query_count
FROM staging.v_typed_snapshot;

-- Warehouse-level bill per period. In real Snowflake this is the invoice number, and
-- attributed credits should add up to it (checked in 06_reconciliation.sql).
CREATE OR REPLACE TABLE account_usage_sim.warehouse_metering_history AS
SELECT warehouse_name,
       start_time,
       end_time,
       SUM(credits_attributed_compute) AS credits_used
FROM account_usage_sim.query_attribution_history
GROUP BY warehouse_name, start_time, end_time;
