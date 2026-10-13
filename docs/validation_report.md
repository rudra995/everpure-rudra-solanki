# Validation Report

How the source data was checked and cleaned, what was assumed, and how the numbers were verified. Source: `data/raw/case_study_3.csv`, 2,000 rows × 10 columns, 100 reports (`RPT_200`–`RPT_299`) with exactly 20 rows each, no date column.

Every rule below is a named function in `analysis/clean.py` (with tests in `analysis/test_clean.py`) and the same rule in SQL (`sql/*/staging`). No row is ever deleted; every finding is written to `data/clean/issues.csv` with the report, source row, column, original value, rule and action.

## 1. Defects named in the brief

| # | Defect | How it is detected | Rows | What was done |
|---|---|---|---|---|
| 1 | Orphaned reports | `owner_email` is missing (stored as the text `nan`) or equals `ORPHANED_REPORT` | 245 (128 + 117) | Flagged `is_orphaned`, owner set to NULL, row kept. A report is *currently orphaned* when its latest snapshot (20) is orphaned: 14 reports. No report is orphaned in all 20 snapshots; 94 are orphaned at least once. |
| 2 | Negative Snowflake credits | `snowflake_credits_consumed < 0` (range −13.6 to −0.8) | 24 | Value set to NULL and excluded from every cost figure (not made positive with abs()); original value kept in the issue log. Total excluded: −161.04 credits. |
| 3 | Load-latency spikes | `avg_load_time_sec > 15` | 1,490 (74.5%) | Values kept: a 55 s load is a real problem, not bad data. Each one raises an alert. Severity tiers: WARNING 15–30 s, HIGH 30–45 s, CRITICAL over 45 s. 6 rows sit exactly at the 55.0 s maximum. |
| 4 | AWS cost vs active users | AWS cost per active view above the Tukey fence Q3 + 1.5 × IQR = **$1.3508** (Q1 $0.1618, Q3 $0.6374, rows with views > 0) | 212 | Flagged for review. AWS is reported as its own line next to Snowflake so it cannot distort the credit figure. |

## 2. Issues not mentioned in the brief

| Issue | Rows | What was done |
|---|---|---|
| Every report has 7–13 different owner emails across its 20 rows | 100 reports | Canonical owner = most frequent valid email, flagged `owner_conflict`. Ownership changes go through a claim → admin approval step in the app. |
| A fourth refresh status, `UNKNOWN` | 100 | Kept as its own "needs review" status; not counted as a failure and does not alert. |
| `monthly_active_views = 0` | 4 | Cost per view left NULL instead of dividing by zero; listed as waste candidates. |
| `concurrent_user_peak > monthly_active_views` (impossible) | 93 | Flagged and kept in the main unit cost (the brief does not mention it); a "strict" figure that excludes them is shown alongside. |
| No timestamp column | – | The 20 rows per report are treated as 20 sequential snapshots in file order (`snapshot_seq` 1–20). Charts are labelled by snapshot number, never by date. |
| The 15 s threshold fires on 74.5% of rows | – | Every breach still alerts (the brief says "whenever"); severity tiers and grouping in the UI help people prioritise. |
| Numeric columns have near-zero correlation with each other | – | The data looks synthetic, so the dashboard shows no trend claims; e.g. the average load time by snapshot is flat at about 28 s and is labelled as such. |

Schema checks that found nothing (0 rows): refresh status outside the known set, numbers that fail to parse, report IDs with more than one name.

## 3. Assumptions and decisions

| Topic | Decision |
|---|---|
| Snapshots | 20 rows per report = 20 snapshots in file order; "latest" = snapshot 20. |
| Credit price | $3.00 per credit (about Snowflake Enterprise on-demand), one config value in `staging.v_config`. Credits per view is also reported because it needs no price. |
| Unit cost per active user view | SUM(valid credits × price) ÷ SUM(monthly active views) over eligible snapshots (credits not negative and views > 0, 1,972 rows). A ratio of sums, not an average of per-row ratios. **$2.4298** (0.8099 credits per view). With AWS hosting added: **$2.7354** ($2.4298 Snowflake + $0.3057 AWS). Strict variant: $2.3318. |
| Credit attribution | The CSV is split into simulated `ACCOUNT_USAGE` logs (`QUERY_ATTRIBUTION_HISTORY` per report via `query_tag`, `WAREHOUSE_METERING_HISTORY` per period) and a portal usage log; credits are attributed to reports through the query tag and reconciled against the warehouse bill. |
| Alerts | Every breach and every FAILED / TIMED_OUT refresh raises an alert. No cooldown or deduplication. |
| Orphaned at report level | Latest snapshot orphaned (14 reports); the 245 orphaned records are always shown as well. |
| Owner cost reporting | Showback (cost per owner for visibility), not chargeback: ownership in the source is ambiguous and $423,510 of credit cost sits on unowned snapshots, so billing teams would not be fair until owners are confirmed. |
| Roles | Four roles mapped from identity-provider groups (mocked): Platform Admin, FinOps Analyst, Report Owner, Business Viewer. |

## 4. Reconciliation

Totals are checked more than one way so that a bug in one place shows up as a mismatch.

| Check | Result |
|---|---|
| 15 checks inside the SQL suite (rows raw = staging, no duplicates, credits valid + excluded = raw, report mart = snapshot level, attributed credits = warehouse bill, AWS, unit cost recomputed, eligible + ineligible = all, orphaned = missing + placeholder, 20 snapshots per report, 100 reports) | 15/15 on DuckDB and 15/15 on Snowflake |
| pandas vs DuckDB vs Snowflake (`analysis/reconcile.py`): rule counts, fence, platform totals, all 100 reports, all 2,000 rows | 35/35 on each engine |
| Every API endpoint on DuckDB vs the same API on live Snowflake, for all four roles, every field | 26/26 identical (after the two fixes below) |

The API comparison found two real bugs, both on the DuckDB side and both now fixed:

1. **p95 load time:** DuckDB's `PERCENTILE_CONT` on a `DECIMAL(6,1)` column keeps one decimal and truncates the interpolated value (46.185 became 46.1). Snowflake and numpy both give 46.185. Fixed by casting to DOUBLE before the percentile. The earlier reconciliation did not compare p95, which is why it slipped through.
2. **Dates:** the Node DuckDB adapter turned `DATE` values into local-time strings; they are now ISO `YYYY-MM-DD`, as Snowflake returns them.

Issue-log counts differ by design: `data/clean/issues.csv` (pandas) has 2,832 rows and the SQL issue log has 2,732. The 100 extra pandas rows are the per-report owner-conflict findings; the SQL suite counts those in its rule-count table instead.

## 5. Results (headline numbers)

| Metric | Value |
|---|---|
| Valid credits / Snowflake cost | 1,206,352.48 credits / $3,619,057.44 |
| AWS hosting cost | $461,949.25 |
| Active user views (eligible) | 1,486,905 |
| Unit cost per active view (Snowflake) | $2.4298 |
| Unit cost per active view (Snowflake + AWS) | $2.7354 |
| Reports over 15 s on the latest snapshot | 76 of 100 (9 critical) |
| Reports with a failing refresh on the latest snapshot | 25 (16 failed, 9 timed out) |
| Alerts in one full replay | 1,490 latency + 564 refresh failure = the rule counts above |
