// Snowflake cost attribution (brief, Task 3), served from the SQL suite's marts.
import { Router } from 'express';
import { db, SQL } from '../data/index.js';
import { PERMISSIONS as P } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { shapeRows, reportScope } from '../rbac/scope.js';

const router = Router();

// GET /api/cost/summary  ->  platform unit cost per active user view (platform-wide: all-scope only)
router.get('/summary', requireAny(P.COST_READ_ALL), async (_req, res) => {
  const [summary] = await db.query(SQL.platformUnitCost);
  res.json({
    summary,
    definitions: {
      credit_cost_per_view_usd: 'HEADLINE. SUM(valid credits x credit price) / SUM(monthly active views), eligible snapshots only',
      credits_per_view: 'SUM(valid credits) / SUM(views); needs no price assumption',
      fully_loaded_cost_per_view_usd: 'Secondary. (credit cost + AWS hosting) / views',
      strict_credit_cost_per_view_usd: 'Sensitivity. Also excludes snapshots where concurrent users > monthly views',
      eligible: 'credits not negative AND monthly views > 0',
      credit_price_usd: 'Assumption: ~Snowflake Enterprise on-demand price per credit',
    },
  });
});

// GET /api/cost/reports  ->  credit attribution per report (own reports only for Report Owners)
router.get('/reports', requireAny(P.COST_READ_ALL, P.COST_READ_OWN), async (req, res) => {
  const rows = shapeRows(req.user, await db.query(SQL.reportCost));
  res.json({ scope: reportScope(req.user), count: rows.length, reports: rows });
});

// GET /api/cost/showback  ->  credits by canonical owner (FinOps showback)
router.get('/showback', requireAny(P.COST_READ_ALL), async (req, res) => {
  const rows = await db.query(SQL.ownerShowback);
  // Owner emails are the key of this view, so mask them for roles without pii:read.
  const shaped = rows.map((r) => (req.user.permissions.includes(P.PII_READ)
    ? r : { ...r, canonical_owner: String(r.canonical_owner).replace(/^[^@]+/, '***') }));
  res.json({ count: shaped.length, owners: shaped, caveat: 'Every report has 7-13 different owner emails in the source; canonical owner = most frequent valid email.' });
});

// GET /api/cost/waste  ->  expensive-but-unused candidates
router.get('/waste', requireAny(P.COST_READ_ALL, P.COST_READ_OWN), async (req, res) => {
  const rows = shapeRows(req.user, await db.query(SQL.wasteCandidates));
  res.json({ scope: reportScope(req.user), count: rows.length, reports: rows });
});

export default router;
