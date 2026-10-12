/* =============================================================================
   02_load.sql  -  load the CSV from the stage into RAW.
   Role: PI_DEPLOY
   -----------------------------------------------------------------------------
   The file is uploaded first by run_snowflake.py with:
       PUT file://<repo>/data/raw/case_study_3.csv @RAW.LANDING AUTO_COMPRESS=TRUE OVERWRITE=TRUE
   (Manual alternative: Snowsight > Data > PURE_INSIGHTS.RAW.LANDING > "+ Files".)

   METADATA$FILE_ROW_NUMBER is captured because the data has no timestamp:
   file order is the only thing that tells us the sequence of the 20 snapshots
   per report, and Snowflake tables do not keep insert order on their own.
   ============================================================================= */

USE ROLE PI_DEPLOY;
USE WAREHOUSE PI_WH;
USE DATABASE PURE_INSIGHTS;

-- Idempotent: re-running the pipeline reloads from scratch.
TRUNCATE TABLE RAW.REPORT_TELEMETRY_RAW;

COPY INTO RAW.REPORT_TELEMETRY_RAW
FROM (
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           METADATA$FILENAME,
           METADATA$FILE_ROW_NUMBER,
           CURRENT_TIMESTAMP()
    FROM @RAW.LANDING
)
FILES = ('case_study_3.csv.gz')
FILE_FORMAT = (FORMAT_NAME = 'RAW.CSV_FF')
ON_ERROR = ABORT_STATEMENT   -- all-or-nothing: a partial load is worse than none
FORCE = TRUE;                -- allow reload of the same file on re-runs

-- Expect exactly 2000 rows, 100 reports, 1 file.
SELECT COUNT(*)                   AS rows_loaded,
       COUNT(DISTINCT report_id)  AS reports,
       COUNT(DISTINCT _source_file) AS files,
       MIN(_file_row_number)      AS first_file_row,
       MAX(_file_row_number)      AS last_file_row
FROM RAW.REPORT_TELEMETRY_RAW;
