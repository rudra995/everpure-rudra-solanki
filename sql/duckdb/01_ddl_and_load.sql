/* =============================================================================
   01_ddl_and_load.sql  -  schemas + raw landing table, loaded from the CSV.
   Engine: DuckDB  (Snowflake twin: sql/snowflake/01_ddl.sql + 02_load.sql)
   Run from the repo root so the relative CSV path resolves.
   -----------------------------------------------------------------------------
   Layering (identical schema names in both engines):
     raw               exact copy of the CSV, every column VARCHAR, nothing fixed
     account_usage_sim tables shaped like SNOWFLAKE.ACCOUNT_USAGE (credit logs)
     portal            the portal's own telemetry (views, latency, refresh, owner, AWS)
     staging           cleaning views: same rules as analysis/clean.py
     marts             cost attribution + health views the app reads
     audit             data-quality counts and reconciliation checks
   ============================================================================= */

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS account_usage_sim;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS audit;

-- Every business column is VARCHAR (all_varchar): a bad value can never make the load
-- fail or get silently coerced, and the literal text 'nan' used for missing owner
-- emails is kept exactly as the source wrote it. Typing happens in 02.
-- _file_row_number keeps file order (1-based, like Snowflake's METADATA$FILE_ROW_NUMBER):
-- with no timestamp in the data, file order is the only sequence we have.
CREATE OR REPLACE TABLE raw.report_telemetry_raw AS
SELECT *,
       'data/raw/case_study_3.csv'  AS _source_file,
       ROW_NUMBER() OVER ()         AS _file_row_number,
       CURRENT_TIMESTAMP            AS _loaded_at
FROM read_csv('data/raw/case_study_3.csv',
              header = true,
              all_varchar = true,
              null_padding = false);

-- Expect exactly 2000 rows, 100 reports.
SELECT COUNT(*)                  AS rows_loaded,
       COUNT(DISTINCT report_id) AS reports,
       MIN(_file_row_number)     AS first_file_row,
       MAX(_file_row_number)     AS last_file_row
FROM raw.report_telemetry_raw;
