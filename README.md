# Pure Insights Command Centre

Case Study 3 (Technical Data & AI Validation – Monetization). An admin dashboard for an analytics portal that moved off Tableau Server and lost its admin visibility: it monitors report health and orphaned reports, pushes real-time alerts, and attributes Snowflake compute cost to every report.

| Brief deliverable | Where |
|---|---|
| 1. Full-stack codebase (React + Node.js) | [`frontend/`](frontend/) and [`backend/`](backend/) |
| 2. REST API & WebSocket specification | [`docs/api_spec.md`](docs/api_spec.md) |
| 3. Snowflake cost allocation SQL suite | [`sql/`](sql/) (start with [`sql/README.md`](sql/README.md)) |
| Defect log, assumptions, reconciliation | [`docs/validation_report.md`](docs/validation_report.md) |

## Run it

Needs Node.js 20 or later. No accounts, no `.env` file and no database setup.

```bash
npm run setup      # installs backend and frontend
npm run dev        # API on :4000, dashboard on http://localhost:5173
```

On first start the backend builds its DuckDB database from `sql/duckdb/` (a few seconds). Sign in with any of the demo users; the password for all of them is `demo123`.

| User | Role | Sees |
|---|---|---|
| admin@company.com | Platform Admin | Everything; approves ownership claims; audit log |
| finops@company.com | FinOps Analyst | All cost data; owner emails masked; read-only |
| user_3@company.com | Report Owner | Only the 12 reports this owner has; can claim orphaned reports |
| viewer@company.com | Business Viewer | Platform health only |

Tests: `npm test` (57 backend tests). Python cleaning tests: `pip install -r requirements.txt` then `python -m pytest analysis`.

### Running on Snowflake instead of DuckDB

The SQL suite is deployed on Snowflake as well (`sql/snowflake/`). To point the app at it, copy `.env.example` to `.env`, fill in the Snowflake account and key path, and set `DATA_SOURCE=snowflake`. Every API endpoint returns identical results on both engines (compared field by field for all four roles).

## How it fits together

![Architecture](docs/architecture.svg)

- `data/raw/case_study_3.csv` is the file provided with the brief, copied unchanged. The brief calls it `Case_Study_3_Pure_Insights_Monitoring.csv`; the file I received had a different name, so I kept the content and gave it a short name.
- `analysis/` cleans the data in pandas: every defect is a named, tested rule, nothing is deleted, and every finding goes to `data/clean/issues.csv` with its original value.
- `sql/` repeats the cleaning and runs the cost engine in SQL, as a DuckDB suite and a Snowflake suite with the same layers and names.
- `backend/` (Express) reads the SQL marts, enforces role-based access on every request, and replays the snapshots as live telemetry. Every load over 15 s and every failed or timed-out refresh raises an alert pushed over Socket.IO (WebSocket).
- `frontend/` (React + Vite) shows system health, orphaned reports, live alerts, cost attribution and data quality, and changes with the signed-in role.

## Repository layout

```
backend/      Express API, role-based access, Socket.IO alerts, tests
frontend/     React dashboard
sql/          duckdb/ and snowflake/ suites, results/ (exported outputs)
analysis/     pandas cleaning, tests, cross-engine reconciliation
data/         raw/ (original CSV), clean/ (cleaned data and issue log)
docs/         API spec, validation report, architecture diagram
```
