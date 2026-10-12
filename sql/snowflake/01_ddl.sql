/* =============================================================================
   01_ddl.sql  -  schemas, file format, stage, raw landing table.
   Role: PI_DEPLOY
   -----------------------------------------------------------------------------
   Layering (standard medallion-style flow):
     RAW               exact copy of the CSV, every column VARCHAR, nothing fixed
     ACCOUNT_USAGE_SIM tables shaped like SNOWFLAKE.ACCOUNT_USAGE (credit logs)
     PORTAL            the portal's own telemetry (views, latency, refresh, owner, AWS)
     STAGING           cleaning views: same rules as analysis/clean.py
     MARTS             cost attribution + health views the app reads
     AUDIT             data-quality counts and reconciliation checks
     SECURITY          masking / row access policies and the user-to-owner map
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

CREATE SCHEMA IF NOT EXISTS RAW               COMMENT = 'Untouched source landing';
CREATE SCHEMA IF NOT EXISTS ACCOUNT_USAGE_SIM COMMENT = 'Simulated SNOWFLAKE.ACCOUNT_USAGE credit logs';
CREATE SCHEMA IF NOT EXISTS PORTAL            COMMENT = 'Analytics portal telemetry (typed)';
CREATE SCHEMA IF NOT EXISTS STAGING           COMMENT = 'Cleaning + flagging views';
CREATE SCHEMA IF NOT EXISTS MARTS             COMMENT = 'Cost attribution and health, read by the app';
CREATE SCHEMA IF NOT EXISTS AUDIT             COMMENT = 'Data quality + reconciliation';
CREATE SCHEMA IF NOT EXISTS SECURITY          COMMENT = 'Governance policies';

-- File format. No NULL_IF on purpose: RAW must keep the literal text 'nan' that the
-- source uses for missing owner emails, so we can prove what the source really contained.
CREATE OR REPLACE FILE FORMAT RAW.CSV_FF
  TYPE = CSV
  SKIP_HEADER = 1
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  EMPTY_FIELD_AS_NULL = FALSE
  ERROR_ON_COLUMN_COUNT_MISMATCH = TRUE
  TRIM_SPACE = FALSE;

CREATE STAGE IF NOT EXISTS RAW.LANDING
  FILE_FORMAT = RAW.CSV_FF
  COMMENT = 'Internal stage for the case-study CSV';

-- Every business column is VARCHAR: a bad value can never make the load fail or get
-- silently coerced. Typing happens in 03, where parse failures are counted.
CREATE OR REPLACE TABLE RAW.REPORT_TELEMETRY_RAW (
    report_id                  VARCHAR,
    report_name                VARCHAR,
    owner_email                VARCHAR,
    last_refresh_status        VARCHAR,
    monthly_active_views       VARCHAR,
    snowflake_credits_consumed VARCHAR,
    avg_load_time_sec          VARCHAR,
    aws_hosting_cost_usd       VARCHAR,
    query_count_last_30d       VARCHAR,
    concurrent_user_peak       VARCHAR,
    _source_file               VARCHAR       COMMENT 'METADATA$FILENAME',
    _file_row_number           NUMBER        COMMENT 'METADATA$FILE_ROW_NUMBER - preserves file order',
    _loaded_at                 TIMESTAMP_LTZ
)
COMMENT = 'Byte-faithful copy of case_study_3.csv';
