# Cloud Cost Allocation SQL Suite

Task 3 of the case study: SQL against **simulated Snowflake `ACCOUNT_USAGE` logs** that attributes credit consumption to individual reports and calculates **unit cost per active user view**.

The same suite is written twice, so you can review it whichever way is easiest:

| Folder | Engine | What you need |
|---|---|---|
| [`duckdb/`](duckdb/) | DuckDB (embedded, runs locally) | Python, or just the DuckDB CLI. No account. |
| [`snowflake/`](snowflake/) | Snowflake | A Snowflake account (deployed and verified on a trial account) |

Both versions use the same layers, the same rules and the same names, and they produce identical results. [`../analysis/reconciliation.md`](../analysis/reconciliation.md) proves it: pandas, DuckDB and Snowflake are compared rule by rule, report by report and row by row.

**Just want to read the outputs?** Every result view is exported to [`results/`](results/) as CSV.

## Run it (DuckDB, about 5 seconds)

From the repo root:

```bash
pip install -r requirements.txt
python sql/duckdb/run_duckdb.py
```

Or, without Python, using the [DuckDB CLI](https://duckdb.org/docs/installation/):

```bash
duckdb data/pure_insights.duckdb < sql/duckdb/run_all.sql
```

The script prints the data-quality counts, the 15 reconciliation checks and the platform unit cost. It also rebuilds `results/`.

## Layers

```
data/raw/case_study_3.csv
        │
   raw                  exact copy of the CSV, every column text, file order kept
        │
   account_usage_sim    QUERY_ATTRIBUTION_HISTORY, WAREHOUSE_METERING_HISTORY  (Snowflake's credit logs)
   portal               REPORT_REGISTRY, REPORT_USAGE_LOG                      (the portal's own telemetry)
        │  joined on query_tag (= report_id) + period
   staging              cleaning views: one flag per defect, bad values set to NULL, nothing deleted
        │
   marts                cost per report, platform unit cost, owner showback,
                        orphaned spend, waste candidates, report health
   audit                rule counts, row-level issue log, reconciliation checks
```

## Files

| Step | DuckDB | Snowflake | What it does |
|---|---|---|---|
| Setup | n/a | `00_bootstrap.sql` | Warehouse, spend cap, roles, key-pair service user (one-time, run manually as ACCOUNTADMIN) |
| Load | `01_ddl_and_load.sql` | `01_ddl.sql`, `02_load.sql` | Schemas, raw table, load the CSV with file row numbers |
| Simulate | `02_account_usage_sim.sql` | `03_account_usage_sim.sql` | Split the CSV into simulated `ACCOUNT_USAGE` credit logs and the portal usage log |
| Clean | `03_staging.sql` | `04_staging.sql` | Flag every defect; canonical owner; AWS-vs-usage outlier fence; cost columns |
| **Cost engine** | **`04_cost_attribution.sql`** | **`05_cost_attribution.sql`** | **Credits per report, unit cost per active user view, showback, orphaned spend, waste** |
| Data quality | `05_data_quality.sql` | `06_data_quality.sql` | Rows caught by each rule; issue log |
| Reconcile | `06_reconciliation.sql` | `07_reconciliation.sql` | 15 checks, each computing a total two independent ways |
| *Extra* | n/a | `08_security.sql` | *Optional hardening, not required by the brief:* masking policy on owner email, row access policy for report owners, least-privilege grants |
| *Extra* | n/a | `09_security_tests.sql` | *Optional:* proves each role sees only what it should |

## Key definitions

- **Unit cost per active user view (headline)** = SUM(valid credits × $3.00) / SUM(monthly_active_views).
  - Only eligible snapshots count: negative credits are filtered out (brief defect 2), and zero-view snapshots are excluded because their cost per view is undefined.
  - It's a ratio of sums, not an average of per-row ratios, so a 1-view snapshot doesn't weigh as much as a 1,400-view one.
- **Also reported:**
  - credits per view (needs no price assumption);
  - "fully loaded" (credits + AWS hosting) per view;
  - a "strict" figure that also drops the 93 rows where concurrent users exceed monthly views.
- **$3.00 per credit is an assumption** (roughly Snowflake Enterprise on-demand pricing). It's defined once, in `staging.v_config`.
- **Simulation note:**
  - The real `ACCOUNT_USAGE` views have one row per query or per hour; the CSV is already summed per report per snapshot, so the simulated tables keep that grain.
  - The data has no timestamp. The 20 rows per report are treated as monthly snapshots in file order, and `period_start` is synthetic. It's used only for the join, never for trend analysis.

## Results (identical in pandas, DuckDB and Snowflake)

| Metric | Value |
|---|---|
| Valid credits attributed | 1,206,352.48 |
| Negative credits excluded | 24 rows |
| Snowflake credit cost | $3,619,057.44 |
| **Credit cost per active user view** | **$2.4298** |
| Credits per view | 0.8099 |
| Fully loaded cost per view (credits + AWS) | $2.7354 |
| Strict credit cost per view | $2.3318 |
