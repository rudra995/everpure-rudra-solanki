-- Run the whole DuckDB suite with the DuckDB CLI (no Python needed), from the repo root:
--     duckdb data/pure_insights.duckdb < sql/duckdb/run_all.sql
-- Or with Python:   python sql/duckdb/run_duckdb.py
.read sql/duckdb/01_ddl_and_load.sql
.read sql/duckdb/02_account_usage_sim.sql
.read sql/duckdb/03_staging.sql
.read sql/duckdb/04_cost_attribution.sql
.read sql/duckdb/05_data_quality.sql
.read sql/duckdb/06_reconciliation.sql
SELECT * FROM marts.platform_unit_cost;
