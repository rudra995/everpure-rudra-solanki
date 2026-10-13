// Row-level and field-level access rules, applied to query results before they leave
// the server.
//
//   Row level   : a user with only ':own' permissions sees only reports they own.
//   Field level : owner emails are masked without 'pii:read';
//                 cost columns are removed without a cost permission for that row.
//
// Ownership = the report's canonical owner from the data (most frequent valid email),
// unless an approved ownership claim has re-assigned it (see ownership.js).
import { PERMISSIONS as P, can } from './permissions.js';
import { effectiveOwner } from '../services/ownership.js';

const OWNER_FIELDS = ['canonical_owner', 'suggested_owner', 'owner'];

// Columns that reveal spend. Removed entirely (not zeroed) when the user may not see cost.
const COST_FIELDS = [
  'credits_valid', 'credits_invalid_snapshots', 'credits_excluded_negative', 'credit_cost_usd',
  'aws_cost_usd', 'fully_loaded_cost_usd', 'eligible_credits', 'eligible_credit_cost_usd',
  'eligible_fully_loaded_cost_usd', 'credits_per_view', 'credit_cost_per_view_usd',
  'fully_loaded_cost_per_view_usd', 'credit_share', 'credit_rank', 'cost_per_view_rank',
  'orphaned_credits', 'orphaned_credit_cost_usd', 'total_queries', 'eligible_views',
  'credits_clean', 'aws_hosting_cost_usd',
];

export function maskEmail(email) {
  if (!email) return email;
  return String(email).replace(/^[^@]+/, '***');
}

export function ownsReport(user, reportId, canonicalOwner) {
  return effectiveOwner(reportId, canonicalOwner)?.toLowerCase() === user.email.toLowerCase();
}

// Does this user see every report, or only their own?
export function reportScope(user) {
  return can(user, P.REPORTS_READ_ALL) || !can(user, P.REPORTS_READ_OWN) ? 'all' : 'own';
}

// Row filter: drop reports outside the user's scope.
export function filterByScope(user, rows) {
  if (reportScope(user) === 'all') return rows;
  return rows.filter((r) => ownsReport(user, r.report_id, r.canonical_owner ?? r.suggested_owner));
}

// Field filter for one row: apply ownership override, mask emails, strip cost.
export function shapeRow(user, row) {
  const out = { ...row };
  if ('canonical_owner' in out) {
    const owner = effectiveOwner(out.report_id, out.canonical_owner);
    if (owner !== out.canonical_owner) out.owner_reassigned = true;
    out.canonical_owner = owner;
  }

  const own = out.report_id && ownsReport(user, out.report_id, out.canonical_owner ?? out.suggested_owner);
  const seesCost = can(user, P.COST_READ_ALL) || (can(user, P.COST_READ_OWN) && own);
  const seesPii = can(user, P.PII_READ) && (reportScope(user) === 'all' || own);

  if (!seesCost) for (const f of COST_FIELDS) delete out[f];
  if (!seesPii) for (const f of OWNER_FIELDS) if (f in out) out[f] = maskEmail(out[f]);
  return out;
}

export function shapeRows(user, rows) {
  return filterByScope(user, rows).map((r) => shapeRow(user, r));
}
