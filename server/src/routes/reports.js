// Single-report drill-down: health, cost (if allowed) and its 20 snapshots.
import { Router } from 'express';
import { db, SQL } from '../data/index.js';
import { PERMISSIONS as P, can } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { shapeRow, reportScope, ownsReport } from '../rbac/scope.js';
import { audit } from '../audit/auditLog.js';

const router = Router();
router.use(requireAny(P.HEALTH_READ));

const REPORT_ID = /^RPT_\d{3}$/;

// GET /api/reports/:reportId
router.get('/:reportId', async (req, res) => {
  const { reportId } = req.params;
  if (!REPORT_ID.test(reportId)) return res.status(400).json({ error: 'bad_request', message: 'reportId must look like RPT_200' });

  const [health] = await db.query(SQL.reportHealthOne, [reportId]);
  if (!health) return res.status(404).json({ error: 'not_found', message: `${reportId} does not exist` });

  // Row-level check: own-scope users may only open their own reports.
  if (reportScope(req.user) === 'own' && !ownsReport(req.user, reportId, health.canonical_owner)) {
    audit('access.denied', { user: req.user, outcome: 'denied', ip: req.ip, detail: { path: req.originalUrl, reason: 'not report owner' } });
    return res.status(403).json({ error: 'forbidden', message: 'You can only view reports you own' });
  }

  const body = { report: shapeRow(req.user, health) };
  if (can(req.user, P.COST_READ_ALL) || can(req.user, P.COST_READ_OWN)) {
    const [cost] = await db.query(SQL.reportCostOne, [reportId]);
    body.cost = shapeRow(req.user, cost);
  }
  // Snapshot detail is for people who can see this report fully (not Business Viewers).
  if (can(req.user, P.REPORTS_READ_ALL) || can(req.user, P.REPORTS_READ_OWN)) {
    const snaps = await db.query(SQL.reportSnapshots, [reportId]);
    const seesCost = Boolean(body.cost?.credits_valid !== undefined);
    body.snapshots = seesCost ? snaps : snaps.map(({ credits_clean, credit_cost_per_view_usd, ...s }) => s);
  }
  return res.json(body);
});

export default router;
