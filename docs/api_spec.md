# REST API & WebSocket Specification

Pure Insights Command Centre backend (`backend/`, Node.js + Express 5 + Socket.IO).

- Base URL (local): `http://localhost:4000`. REST under `/api`, WebSocket on the same port.
- All payloads are JSON. Timestamps are ISO 8601 (UTC).
- Data comes from the SQL marts in DuckDB (default) or Snowflake (`DATA_SOURCE=snowflake`). The same queries run on both and return identical results.

## 1. Authentication

The client signs in once and sends the JWT on every request:

```
Authorization: Bearer <token>
```

The token carries identity only (user id, email, name, identity-provider groups; issuer `pure-insights`; expires after 8 h by default). On every request the server maps the groups to a role and the role to permissions again, so a role or permission inside a token is never trusted.

### POST /api/auth/login

Public. Request:

```json
{ "email": "admin@company.com", "password": "demo123" }
```

Response `200`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "u-admin", "name": "Asha Mehta", "email": "admin@company.com",
    "groups": ["pi-platform-admins"], "role": "platform_admin", "roleLabel": "Platform Admin",
    "permissions": ["health:read", "reports:read:all", "cost:read:all", "pii:read", "..."]
  }
}
```

`401 invalid_credentials` for an unknown email or a wrong password (same message for both, so the endpoint does not reveal which emails exist).

### GET /api/auth/me

Any signed-in user. Returns `{ "user": { ... } }` with the server-computed role and permissions; the frontend uses it to decide what to show.

### GET /api/auth/demo-users

Public. The four demo identities for the sign-in screen (no secrets).

## 2. Roles and permissions

Routes check **permissions**, never role names. Groups come from the identity provider (mocked), roles are bundles of permissions, and anything not granted is denied.

| Permission | Platform Admin | FinOps Analyst | Report Owner | Business Viewer |
|---|:-:|:-:|:-:|:-:|
| `health:read` | ✓ | ✓ | ✓ | ✓ |
| `reports:read:all` / `reports:read:own` | all | all | own | – |
| `cost:read:all` / `cost:read:own` | all | all | own | – |
| `pii:read` (unmasked owner emails) | ✓ | – | own reports | – |
| `orphaned:read` | ✓ | ✓ | ✓ | – |
| `orphaned:claim` | ✓ | – | ✓ | – |
| `orphaned:approve` | ✓ | – | – | – |
| `alerts:read:*` / `alerts:ack:*` | all | – | own | – |
| `dq:read:summary` | ✓ | ✓ | – | – |
| `dq:read:issues` (row-level, raw emails) | ✓ | – | – | – |
| `audit:read` | ✓ | – | – | – |
| `simulator:control` | ✓ | – | – | – |

Besides the endpoint check, two filters are applied to the results before they leave the server:

- **Row level:** a user with only `:own` permissions gets only the reports they own (canonical owner, or the new owner after an approved claim).
- **Field level:** owner emails are masked (`***@company.com`) without `pii:read`, and cost columns are removed entirely without a cost permission for that row.

Denied requests are written to the audit log.

## 3. Errors

```json
{ "error": "forbidden", "message": "Requires permission: cost:read:all" }
```

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Invalid input (e.g. report id not `RPT_###`, claim reason under 5 characters) |
| 401 | `unauthenticated` / `invalid_credentials` | Missing, invalid or expired token; wrong sign-in |
| 403 | `forbidden` | Missing permission, someone else's report, or approving your own claim |
| 404 | `not_found` | Unknown report, claim, alert or endpoint |
| 409 | `conflict` | Report not currently orphaned, duplicate pending claim, claim already decided |
| 500 | `internal_error` | Unexpected error (details are logged, never returned) |

## 4. REST endpoints

"Scope" means the result is filtered to the caller's reports (`own`) or not (`all`); the response includes `"scope"` where that applies.

### Health (brief, Task 1)

| Method | Path | Permission | Returns |
|---|---|---|---|
| GET | `/healthz` | public | `{ status, data_source, uptime_sec }` (liveness probe) |
| GET | `/api/health/summary` | `health:read` | Counts from each report's latest snapshot: reports, refresh failing, latency breaching / critical, currently orphaned, severity breakdown, averages. Scoped. |
| GET | `/api/health/reports` | `health:read` | One row per report: latest refresh status and load time, severity, p95, breach and failure rates over 20 snapshots, orphaned flags. Scoped, emails masked per role. |
| GET | `/api/health/snapshots` | `health:read` | All 20 snapshots of every report in scope (2,000 rows for all-scope roles). Cost columns only for roles with cost access. |
| GET | `/api/health/live` | `health:read` | The latest replayed snapshot per report. Scoped. |
| GET | `/api/reports/:reportId` | `health:read` | One report: `report` (health), plus `cost` if the caller may see cost, plus `snapshots` (20) for owners, FinOps and admins. `403` if an own-scope user asks for another owner's report. |

Example, `GET /api/health/summary`:

```json
{ "scope": "all",
  "summary": { "reports": 100, "reports_refresh_failing": 25, "reports_status_unknown": 5,
               "reports_latency_breaching": 76, "reports_latency_critical": 9,
               "reports_currently_orphaned": 14, "avg_load_time_sec": 27.88,
               "severity_breakdown": { "OK": 24, "WARNING": 33, "HIGH": 34, "CRITICAL": 9 } } }
```

### Orphaned reports and ownership claims (brief, Task 1)

| Method | Path | Permission | Returns / does |
|---|---|---|---|
| GET | `/api/orphaned` | `orphaned:read` | `summary` (245 orphaned records: 128 missing email + 117 `ORPHANED_REPORT`; 94 reports ever orphaned; 14 currently orphaned) and one row per report with orphaned snapshots and unowned spend. |
| GET | `/api/orphaned/claims` | `orphaned:claim` or `orphaned:approve` | Admins see all claims; owners see their own. |
| POST | `/api/orphaned/:reportId/claims` | `orphaned:claim` | Body `{ "reason": "..." }` (5+ characters). Creates a `PENDING` claim. `409` if the report is not currently orphaned or already has a pending claim. |
| POST | `/api/orphaned/claims/:id/approve` | `orphaned:approve` | Body `{ "note": "..." }` (optional). Approving moves the report to the requester everywhere (access, alerts, cost). `403` if the approver is the requester. |
| POST | `/api/orphaned/claims/:id/reject` | `orphaned:approve` | Same body; marks the claim `REJECTED`. |

### Cost attribution (brief, Task 3)

| Method | Path | Permission | Returns |
|---|---|---|---|
| GET | `/api/cost/summary` | `cost:read:all` | Platform unit cost and the figures behind it, with definitions. |
| GET | `/api/cost/reports` | `cost:read:all` or `cost:read:own` | Credit attribution per report: valid credits, Snowflake cost, AWS cost, views, cost per view, share of credits, rank, excluded negative-credit snapshots. Scoped. |
| GET | `/api/cost/showback` | `cost:read:all` | Snowflake cost grouped by canonical owner (emails masked without `pii:read`). |
| GET | `/api/cost/waste` | `cost:read:all` or `cost:read:own` | Expensive but barely used reports (top-quartile credits with bottom-quartile views, or credits spent in a zero-view snapshot). Scoped. |

Example, `GET /api/cost/summary` (abridged):

```json
{ "summary": { "credit_price_usd": 3, "credits_valid": 1206352.48, "credits_excluded_negative": -161.04,
               "credit_cost_usd": 3619057.44, "aws_cost_usd": 461949.25,
               "eligible_rows": 1972, "eligible_views": 1486905,
               "credits_per_view": 0.8099, "credit_cost_per_view_usd": 2.4298,
               "fully_loaded_cost_per_view_usd": 2.7354, "strict_credit_cost_per_view_usd": 2.3318 },
  "definitions": { "credit_cost_per_view_usd": "SUM(valid credits x credit price) / SUM(monthly active views), eligible snapshots only", "...": "..." } }
```

### Alerts (brief, Task 2)

Live delivery is over WebSocket (section 5); these endpoints load recent history and record acknowledgements.

| Method | Path | Permission | Returns / does |
|---|---|---|---|
| GET | `/api/alerts?limit=&type=&severity=&unacknowledged=true` | `alerts:read:all` or `:own` | Newest first (up to 2,000 kept in memory). Owners see only their reports' alerts. |
| GET | `/api/alerts/stats` | `alerts:read:all` or `:own` | Counts by type and severity; unacknowledged. |
| POST | `/api/alerts/:id/ack` | `alerts:ack:all` or `:own` | Marks the alert acknowledged (idempotent) and broadcasts `alert:ack`. `403` for another owner's alert. |

Alert object:

```json
{ "id": 1258, "type": "LATENCY_BREACH", "severity": "WARNING",
  "metric": "avg_load_time_sec", "value": 16.5, "threshold": 15,
  "message": "Analytics Dashboard 24 took 16.5s to load (threshold 15s)",
  "report_id": "RPT_223", "report_name": "Analytics Dashboard 24", "owner": "user_10@company.com",
  "snapshot_seq": 13, "source_row": 1223, "created_at": "2026-10-13T16:39:44.129Z",
  "acknowledged_by": null, "acknowledged_at": null }
```

Rules: `LATENCY_BREACH` when load time is over 15 s (exactly 15.0 s does not alert), severity `WARNING` 15–30 s, `HIGH` 30–45 s, `CRITICAL` over 45 s. `REFRESH_FAILURE` (severity `HIGH`) when the refresh status is `FAILED` or `TIMED_OUT`. `UNKNOWN` does not alert. One snapshot can raise both. There is no cooldown or deduplication: the brief says alerts fire *whenever* a rule is broken.

### Data quality, audit and simulator

| Method | Path | Permission | Returns / does |
|---|---|---|---|
| GET | `/api/data-quality/summary` | `dq:read:summary` | Rows caught per cleaning rule and the 15 reconciliation checks, with `reconciliation_passed`. |
| GET | `/api/data-quality/issues?rule=&limit=` | `dq:read:issues` | Row-level issue log: report, source row, column, original value, rule. |
| GET | `/api/audit?limit=&event=&outcome=` | `audit:read` | Sign-ins, access denials, claims, approvals, acknowledgements, simulator control. |
| GET | `/api/simulator` | any signed-in user | Replay status: running, interval, position, cycle. |
| POST | `/api/simulator/start` | `simulator:control` | Body `{ "interval_ms": 1000 }` (optional). Starts the telemetry replay. |
| POST | `/api/simulator/stop` | `simulator:control` | Stops the replay. |

## 5. WebSocket (Socket.IO)

The source data is a static file, so "real-time" is a replay: the backend emits the 2,000 snapshots one at a time (snapshot 1 of every report, then snapshot 2, …) every `SIM_INTERVAL_MS` (1 s by default) and loops. Each snapshot is published as telemetry and run through the alert rules.

### Connecting

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000', { auth: { token }, transports: ['websocket'] });
```

The JWT is verified in the handshake. No token or an invalid token: the connection is refused with `connect_error` `"unauthorized"`; a user with no role gets `"forbidden"`.

### Rooms (decided by the server from the caller's permissions)

| Room | Who joins | Receives |
|---|---|---|
| `alerts:all` | `alerts:read:all` (Platform Admin) | Every alert and acknowledgement |
| `telemetry:all` | all-scope users with `pii:read` (Platform Admin) | All telemetry, real owner emails |
| `telemetry:masked` | all-scope users without `pii:read` (FinOps, Viewer) | All telemetry, owner emails masked |
| `owner:<email>` | own-scope users (Report Owner) | Alerts and telemetry for their own reports only |

Events are only ever emitted to rooms, so a client can never receive data it is not allowed to see. FinOps and Viewer receive no alerts.

### Server → client events

| Event | Payload | Sent to |
|---|---|---|
| `welcome` | `{ user: { email, role }, rooms: [...], receives_alerts, simulator: {...} }` | The connecting client |
| `telemetry` | Replayed snapshot: `report_id`, `report_name`, `snapshot_seq`, `avg_load_time_sec`, `last_refresh_status`, `monthly_active_views`, `canonical_owner`, `cycle`, `replayed_at` | Telemetry rooms and the owner's room |
| `alert` | Alert object (section 4) | `alerts:all` and the report owner's room |
| `alert:ack` | The acknowledged alert | `alerts:all` and the report owner's room |
| `simulator:status` | `{ running, interval_ms, position, total_snapshots, cycle, replayed }` | Everyone (on start, stop and each new cycle) |

Clients do not send events; actions (acknowledging, claiming) go through REST so they pass the same permission checks and are audited.

### Why WebSocket rather than SSE

Alerts only flow from server to client, so Server-Sent Events would also have worked. I used Socket.IO over WebSocket because the brief names WebSockets first, Socket.IO rooms make per-role and per-owner delivery simple and safe (the server decides membership at the handshake), and it handles authentication on connect and automatic reconnection.
