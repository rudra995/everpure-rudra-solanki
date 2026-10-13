// Append-only audit trail of security-relevant events: logins, access denials, and every
// state-changing action (claims, approvals, alert acknowledgements, simulator control).
// Kept in memory for the demo; in production this would stream to a SIEM / log store.
const MAX_ENTRIES = 5000;
const entries = [];
let nextId = 1;

export function audit(event, { user = null, outcome = 'success', detail = {}, ip = null } = {}) {
  const entry = {
    id: nextId++,
    ts: new Date().toISOString(),
    event,                       // e.g. 'auth.login', 'access.denied', 'claim.approve'
    outcome,                     // 'success' | 'denied' | 'failure'
    actor: user ? { id: user.id, email: user.email, role: user.role } : null,
    ip,
    detail,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

export function listAudit({ limit = 200, event, outcome } = {}) {
  return entries
    .filter((e) => (!event || e.event === event) && (!outcome || e.outcome === outcome))
    .slice(-limit)
    .reverse(); // newest first
}

export function resetAudit() {
  entries.length = 0;
  nextId = 1;
}
