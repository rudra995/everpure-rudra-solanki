// Ownership claims for orphaned reports: a human review gate.
//
//   1. A Report Owner REQUESTS ownership of a currently orphaned report (with a reason).
//   2. A Platform Admin APPROVES or REJECTS it. The approver can never be the requester
//      (separation of duties), and every step is written to the audit log.
//   3. Once approved, the report's effective owner changes everywhere: row-level access,
//      alert routing and the dashboards all follow the new owner.
//
// State is in memory for the demo (resets on restart); in production this is a table.
const claims = [];
const overrides = new Map(); // report_id -> owner email (approved claims)
let nextId = 1;

export function effectiveOwner(reportId, canonicalOwner) {
  return overrides.get(reportId) ?? canonicalOwner ?? null;
}

export function listClaims({ requesterEmail } = {}) {
  return claims
    .filter((c) => !requesterEmail || c.requested_by.toLowerCase() === requesterEmail.toLowerCase())
    .slice()
    .reverse();
}

export function createClaim({ reportId, reportName, requester, reason }) {
  if (claims.some((c) => c.report_id === reportId && c.status === 'PENDING')) {
    const err = new Error(`A pending claim already exists for ${reportId}`);
    err.status = 409;
    throw err;
  }
  const claim = {
    id: nextId++,
    report_id: reportId,
    report_name: reportName,
    requested_by: requester.email,
    reason: String(reason || '').slice(0, 500),
    status: 'PENDING',
    requested_at: new Date().toISOString(),
    decided_by: null,
    decided_at: null,
    decision_note: null,
  };
  claims.push(claim);
  return claim;
}

export function decideClaim({ claimId, decider, approve, note }) {
  const claim = claims.find((c) => c.id === Number(claimId));
  if (!claim) {
    const err = new Error('Claim not found');
    err.status = 404;
    throw err;
  }
  if (claim.status !== 'PENDING') {
    const err = new Error(`Claim already ${claim.status}`);
    err.status = 409;
    throw err;
  }
  if (claim.requested_by.toLowerCase() === decider.email.toLowerCase()) {
    const err = new Error('Separation of duties: you cannot decide your own claim');
    err.status = 403;
    throw err;
  }
  claim.status = approve ? 'APPROVED' : 'REJECTED';
  claim.decided_by = decider.email;
  claim.decided_at = new Date().toISOString();
  claim.decision_note = note ? String(note).slice(0, 500) : null;
  if (approve) overrides.set(claim.report_id, claim.requested_by);
  return claim;
}

export function resetOwnership() {
  claims.length = 0;
  overrides.clear();
  nextId = 1;
}
