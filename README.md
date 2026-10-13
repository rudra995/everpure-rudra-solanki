# Pure Insights Command Centre

An admin dashboard for an analytics portal that moved off Tableau Server and lost its admin visibility. It monitors report health and orphaned reports, pushes real-time alerts when a dashboard is slow or a refresh fails, and attributes Snowflake compute cost to every report down to a cost per active user view.

Built for Everpure's Case Study 3 (Technical Data & AI Validation – Monetization) by Rudra Solanki.

| Brief deliverable | Where |
|---|---|
| 1. Full-stack codebase (React + Node.js) | [`frontend/`](frontend/), [`backend/`](backend/) |
| 2. REST API & WebSocket specification | [`docs/api_spec.md`](docs/api_spec.md) |
| 3. Snowflake cost allocation SQL suite | [`sql/`](sql/) (start with [`sql/README.md`](sql/README.md)) |
| Defect log, assumptions, reconciliation | [`docs/validation_report.md`](docs/validation_report.md) |

## Quick start

Needs Node.js 20 or later. No accounts, no `.env` file, no database setup.

```bash
npm run setup      # installs backend and frontend
npm run dev        # starts the API and the dashboard; open the local address it prints
```

The backend builds its DuckDB database from `sql/duckdb/` on first start. Sign in as any demo user with the password `demo123`:

| User | Role | Sees |
|---|---|---|
| admin@company.com | Platform Admin | Everything; approves ownership claims; audit log |
| finops@company.com | FinOps Analyst | All health and cost data, owner emails masked; read-only |
| user_3@company.com | Report Owner | Only their own 12 reports; can claim orphaned reports |
| viewer@company.com | Business Viewer | Platform health only |

Tests: `npm test` runs the 57 backend tests. For the 16 Python cleaning tests: `pip install -r requirements.txt`, then `python -m pytest analysis`.

## Architecture

![Architecture](docs/architecture.svg)

The CSV is loaded into DuckDB (default, runs locally) or Snowflake, and the same SQL views run on both. The Express backend queries those views, checks access on every request and replays the data as live telemetry. The React frontend calls the REST API and receives alerts over WebSocket.

| Layer | Stack |
|---|---|
| Frontend | React, Vite, Recharts, Socket.IO client |
| Backend | Node.js, Express 5, JWT, Socket.IO |
| Data | DuckDB (default) or Snowflake, same SQL views |
| Cleaning and checks | Python, pandas, pytest |

## What it does

### 1. Monitoring with role-based access

- **Permissions, not roles.** Each route checks a permission such as `cost:read:all`. The JWT carries identity only; the server works out permissions on every request.
- **Filtering on the server.** Report Owners only ever receive their own reports, owner emails are masked for anyone without `pii:read`, and cost fields are removed for roles without cost access. Calling a hidden endpoint returns a 403 and is written to the audit log.
- **System health.** Latest load time and refresh status per report, severity, p95 and failure rates across 20 snapshots, and a health map of the worst reports.
- **Orphaned reports.** 245 of 2,000 rows have no owner (missing email or `ORPHANED_REPORT`). A report counts as orphaned when its latest snapshot has no owner (14 reports). Ownership is never reassigned silently: an owner requests it and an admin approves it, never the same person.

### 2. Real-time alerts

- Every load time **over 15 s** and every **`FAILED` or `TIMED_OUT`** refresh raises an alert. The brief says *whenever*, so nothing is throttled; a test checks that one full replay gives exactly 1,490 latency and 564 refresh alerts.
- Severity tiers: WARNING 15–30 s, HIGH 30–45 s, CRITICAL over 45 s.
- Delivered over Socket.IO. The token is checked at the handshake and the server places each connection in rooms by permission (`alerts:all`, `telemetry:all`, `telemetry:masked`, `owner:<email>`), so a client never receives data it isn't allowed to see.
- The source data is a static file, so the backend replays it snapshot by snapshot as telemetry.

Full REST and WebSocket reference, with payloads, errors and the permission each endpoint needs: [`docs/api_spec.md`](docs/api_spec.md).

### 3. Cost attribution in SQL

The CSV is reshaped into simulated Snowflake `ACCOUNT_USAGE` logs (`QUERY_ATTRIBUTION_HISTORY` tagged per report, `WAREHOUSE_METERING_HISTORY` as the bill) and processed in layers:

```
raw → account_usage_sim → staging (flags, nothing deleted) → marts (cost per report, unit cost, showback, waste) → audit (checks)
```

**Unit cost per active user view** = SUM(valid credits × $3.00) ÷ SUM(active views), over snapshots with valid credits and at least one view. It's a ratio of sums, not an average of per-row ratios.

| Result | Value |
|---|---|
| Valid credits attributed | 1,206,352.48 ($3.62M) |
| Cost per active user view, Snowflake | **$2.4298** (0.8099 credits) |
| Cost per active user view, Snowflake + AWS | **$2.7354** |

The suite exists for both DuckDB (`sql/duckdb/`, no account needed) and Snowflake (`sql/snowflake/`), with the same layers and names. To run the app against Snowflake, copy `.env.example` to `.env`, fill in the account and key path, and set `DATA_SOURCE=snowflake`.

### 4. Data defects and validation

| Defect (from the brief) | Rows | What was done |
|---|---:|---|
| Orphaned owner (missing or `ORPHANED_REPORT`) | 245 | Flagged and kept; drives the orphaned page |
| Negative Snowflake credits | 24 | Excluded from cost; never flipped to positive |
| Load-latency spikes (up to 55 s) | 1,490 | Kept as real; each one alerts |
| AWS cost out of line with active users | 212 | Flagged above a Tukey fence ($1.35 per view); AWS reported separately |

Also found, though not in the brief: a fourth refresh status `UNKNOWN`, 4 snapshots with zero views, 93 rows where concurrent users exceed monthly views, 7–13 different owners per report, and no date column.

Every rule is a named, tested function in pandas and the same rule in SQL. Nothing is deleted, and every finding is logged with its original value in `data/clean/issues.csv`.

**How the numbers were checked:**
- 15 reconciliation checks inside the SQL suite: 15/15 on DuckDB and on Snowflake.
- pandas vs DuckDB vs Snowflake, rule by rule and row by row: 35/35 ([`analysis/reconciliation.md`](analysis/reconciliation.md)).
- Every API endpoint on DuckDB vs live Snowflake, for all four roles: 26/26 identical. This caught two real bugs (a truncated p95 and a date format mismatch), both fixed.

## Assumptions

- The 20 rows per report are 20 snapshots in file order; the latest is snapshot 20.
- Snowflake credits cost $3.00 each, set once in `staging.v_config`.
- Owner cost is shown as showback, not chargeback, because ownership in the source is too ambiguous to bill anyone.

The full list, with reasons, is in [`docs/validation_report.md`](docs/validation_report.md).

## Limitations

- Telemetry is a replay of the static CSV, not a live feed.
- Sign-in uses mocked identity-provider groups and demo users, not a real SSO provider.
- Ownership claims, alerts and the audit log are kept in memory and reset when the backend restarts; in production they would be database tables.
- The React pages were checked in a headless browser for every role but have no automated tests.

## Repository layout

```
backend/      Express API, role-based access, Socket.IO alerts, tests
frontend/     React dashboard
sql/          duckdb/ and snowflake/ suites, results/ (exported outputs)
analysis/     pandas cleaning, tests, cross-engine reconciliation
data/         raw/ (original CSV), clean/ (cleaned data and issue log)
docs/         API spec, validation report, architecture diagram
```

`data/raw/case_study_3.csv` is the file provided with the brief, unchanged. The brief calls it `Case_Study_3_Pure_Insights_Monitoring.csv`; the file I received had a different name, so I kept the content and gave it a short name.
