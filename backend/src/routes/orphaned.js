// Orphaned reports (brief, Task 1 + defect 1) and the ownership claim -> approve review gate.
//
// "Orphaned" at row level = owner email missing (NaN) or 'ORPHANED_REPORT' (245 records).
// At report level no report is orphaned in all 20 snapshots, so a report is
// "currently orphaned" when its LATEST snapshot is orphaned.
import { Router } from 'express';
import { db, SQL } from '../data/index.js';
import { PERMISSIONS as P, can } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { shapeRow } from '../rbac/scope.js';
import { audit } from '../audit/auditLog.js';
import { listClaims, createClaim, decideClaim } from '../services/ownership.js';

const router = Router();

// GET /api/orphaned  ->  record-level summary + per-report orphaned spend
// Owners see every orphaned report (so they can claim one), but cost and other people's
// emails are still filtered per row by shapeRow.
router.get('/', requireAny(P.ORPHANED_READ), async (req, res) => {
  const [summary] = await db.query(SQL.orphanedSummary);
  const rows = (await db.query(SQL.orphanedSpend)).map((r) => shapeRow(req.user, r));
  res.json({
    summary,
    definition: 'Record orphaned = owner_email NaN or ORPHANED_REPORT. Report currently orphaned = latest snapshot orphaned.',
    count: rows.length,
    reports: rows,
  });
});

// GET /api/orphaned/claims  ->  admins see all claims, owners see their own
router.get('/claims', requireAny(P.ORPHANED_APPROVE, P.ORPHANED_CLAIM), (req, res) => {
  const claims = can(req.user, P.ORPHANED_APPROVE) ? listClaims() : listClaims({ requesterEmail: req.user.email });
  res.json({ count: claims.length, claims });
});

// POST /api/orphaned/:reportId/claims  { reason }  ->  request ownership (status PENDING)
router.post('/:reportId/claims', requireAny(P.ORPHANED_CLAIM), async (req, res) => {
  const { reportId } = req.params;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'bad_request', message: 'A reason of at least 5 characters is required' });

  const [report] = await db.query(SQL.reportHealthOne, [reportId]);
  if (!report) return res.status(404).json({ error: 'not_found', message: `${reportId} does not exist` });
  if (!report.currently_orphaned) {
    return res.status(409).json({ error: 'conflict', message: `${reportId} is not currently orphaned` });
  }
  const claim = createClaim({ reportId, reportName: report.report_name, requester: req.user, reason });
  audit('claim.create', { user: req.user, ip: req.ip, detail: { claim_id: claim.id, report_id: reportId } });
  return res.status(201).json({ claim });
});

// POST /api/orphaned/claims/:claimId/approve | /reject  { note }
for (const action of ['approve', 'reject']) {
  router.post(`/claims/:claimId/${action}`, requireAny(P.ORPHANED_APPROVE), (req, res) => {
    const claim = decideClaim({ claimId: req.params.claimId, decider: req.user, approve: action === 'approve', note: req.body?.note });
    audit(`claim.${action}`, { user: req.user, ip: req.ip, detail: { claim_id: claim.id, report_id: claim.report_id, requested_by: claim.requested_by } });
    res.json({ claim });
  });
}

export default router;
