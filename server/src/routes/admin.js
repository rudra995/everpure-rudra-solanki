// Governance endpoints: data quality, reconciliation, audit trail, simulator control.
import { Router } from 'express';
import { db, SQL } from '../data/index.js';
import { PERMISSIONS as P } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { audit, listAudit } from '../audit/auditLog.js';
import * as simulator from '../realtime/simulator.js';

export const dataQuality = Router();

// GET /api/data-quality/summary  ->  rows caught per rule + reconciliation checks
dataQuality.get('/summary', requireAny(P.DQ_READ_SUMMARY), async (_req, res) => {
  const [rules, reconciliation] = await Promise.all([db.query(SQL.dqRuleCounts), db.query(SQL.reconciliation)]);
  res.json({
    rules,
    reconciliation,
    reconciliation_passed: reconciliation.every((c) => c.status === 'PASS'),
  });
});

// GET /api/data-quality/issues?rule=&limit=  ->  row-level issue log (admin only: contains raw emails)
dataQuality.get('/issues', requireAny(P.DQ_READ_ISSUES), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  let rows = await db.query(SQL.dqIssues);
  if (req.query.rule) rows = rows.filter((r) => r.rule === req.query.rule);
  res.json({ total: rows.length, count: Math.min(limit, rows.length), issues: rows.slice(0, limit) });
});

export const auditRoutes = Router();

// GET /api/audit?limit=&event=&outcome=
auditRoutes.get('/', requireAny(P.AUDIT_READ), (req, res) => {
  const entries = listAudit({ limit: Math.min(Number(req.query.limit) || 200, 5000), event: req.query.event, outcome: req.query.outcome });
  res.json({ count: entries.length, entries });
});

export const simulatorRoutes = Router();

// GET /api/simulator  ->  status (any signed-in user)
simulatorRoutes.get('/', (_req, res) => res.json({ simulator: simulator.status() }));

// POST /api/simulator/start { interval_ms }   POST /api/simulator/stop
simulatorRoutes.post('/start', requireAny(P.SIMULATOR_CONTROL), (req, res) => {
  const s = simulator.start(req.body?.interval_ms);
  audit('simulator.start', { user: req.user, ip: req.ip, detail: { interval_ms: s.interval_ms } });
  res.json({ simulator: s });
});
simulatorRoutes.post('/stop', requireAny(P.SIMULATOR_CONTROL), (req, res) => {
  const s = simulator.stop();
  audit('simulator.stop', { user: req.user, ip: req.ip });
  res.json({ simulator: s });
});
