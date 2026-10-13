// System health (brief, Task 1: "monitor system health").
import { Router } from 'express';
import { db, SQL } from '../data/index.js';
import { PERMISSIONS as P } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { shapeRows, filterByScope, reportScope } from '../rbac/scope.js';
import { liveHealth } from '../realtime/simulator.js';

const router = Router();
router.use(requireAny(P.HEALTH_READ));

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + Number(b), 0) / xs.length : null);

// Summary is computed from the scoped rows, so a Report Owner's numbers cover only their reports.
export function summarise(rows) {
  const count = (fn) => rows.filter(fn).length;
  return {
    reports: rows.length,
    reports_refresh_failing: count((r) => ['FAILED', 'TIMED_OUT'].includes(r.latest_refresh_status)),
    reports_status_unknown: count((r) => r.latest_refresh_status === 'UNKNOWN'),
    reports_latency_breaching: count((r) => r.latest_latency_severity !== 'OK'),
    reports_latency_critical: count((r) => r.latest_latency_severity === 'CRITICAL'),
    reports_currently_orphaned: count((r) => r.currently_orphaned),
    avg_load_time_sec: mean(rows.map((r) => r.avg_load_time_sec)),
    latency_breach_rate: mean(rows.map((r) => r.latency_breach_rate)),
    refresh_failure_rate: mean(rows.map((r) => r.refresh_failure_rate)),
    severity_breakdown: ['OK', 'WARNING', 'HIGH', 'CRITICAL'].reduce(
      (acc, s) => ({ ...acc, [s]: count((r) => r.latest_latency_severity === s) }), {}),
  };
}

// GET /api/health/summary
router.get('/summary', async (req, res) => {
  const rows = filterByScope(req.user, await db.query(SQL.reportHealth));
  res.json({ scope: reportScope(req.user), summary: summarise(rows) });
});

// GET /api/health/reports  ->  per-report health (latest snapshot + rates over 20 snapshots)
router.get('/reports', async (req, res) => {
  const rows = shapeRows(req.user, await db.query(SQL.reportHealth));
  res.json({ scope: reportScope(req.user), count: rows.length, reports: rows });
});

// GET /api/health/snapshots  ->  all 20 snapshots of every report in scope (cost fields only if allowed)
router.get('/snapshots', async (req, res) => {
  const rows = shapeRows(req.user, await db.query(SQL.snapshotMatrix));
  res.json({ scope: reportScope(req.user), count: rows.length, snapshots: rows });
});

// GET /api/health/live  ->  latest replayed telemetry per report (what the simulator last saw)
router.get('/live', (req, res) => {
  const rows = shapeRows(req.user, liveHealth());
  res.json({ scope: reportScope(req.user), count: rows.length, reports: rows });
});

export default router;
