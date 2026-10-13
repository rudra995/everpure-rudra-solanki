// Role-based access control, permission style.
//
// Code never checks a role name. Routes ask for a PERMISSION (e.g. 'cost:read:all'),
// and a role is just a named bundle of permissions. Adding a role, or changing what a
// role may do, is an edit to this one file.
//
// Users don't get roles directly either: like an enterprise SSO setup, the identity
// provider puts users in GROUPS, and GROUP_TO_ROLE maps groups to roles.
// Anything not listed here is denied (least privilege).

export const PERMISSIONS = {
  HEALTH_READ: 'health:read',             // system health views
  REPORTS_READ_ALL: 'reports:read:all',   // every report (otherwise: own reports only)
  REPORTS_READ_OWN: 'reports:read:own',
  COST_READ_ALL: 'cost:read:all',         // Snowflake credit attribution, all reports
  COST_READ_OWN: 'cost:read:own',         // ...only reports you own
  PII_READ: 'pii:read',                   // owner emails unmasked
  ORPHANED_READ: 'orphaned:read',
  ORPHANED_CLAIM: 'orphaned:claim',       // request ownership of an orphaned report
  ORPHANED_APPROVE: 'orphaned:approve',   // approve/reject ownership requests (review gate)
  ALERTS_READ_ALL: 'alerts:read:all',
  ALERTS_READ_OWN: 'alerts:read:own',
  ALERTS_ACK_ALL: 'alerts:ack:all',
  ALERTS_ACK_OWN: 'alerts:ack:own',
  DQ_READ_SUMMARY: 'dq:read:summary',     // data-quality counts + reconciliation
  DQ_READ_ISSUES: 'dq:read:issues',       // row-level issue log
  AUDIT_READ: 'audit:read',
  SIMULATOR_CONTROL: 'simulator:control',
};

const P = PERMISSIONS;

export const ROLES = {
  // BI platform team: runs the portal, owns governance decisions.
  platform_admin: {
    label: 'Platform Admin',
    permissions: Object.values(P),
  },
  // Cloud cost team: sees every dollar, changes nothing, doesn't need personal data.
  finops_analyst: {
    label: 'FinOps Analyst',
    permissions: [P.HEALTH_READ, P.REPORTS_READ_ALL, P.COST_READ_ALL, P.ORPHANED_READ, P.DQ_READ_SUMMARY],
  },
  // Analyst who built dashboards: full detail, but only for reports they own.
  report_owner: {
    label: 'Report Owner',
    permissions: [P.HEALTH_READ, P.REPORTS_READ_OWN, P.COST_READ_OWN, P.PII_READ,
                  P.ORPHANED_READ, P.ORPHANED_CLAIM, P.ALERTS_READ_OWN, P.ALERTS_ACK_OWN],
  },
  // Business user (e.g. Deal Strategy): is the platform healthy? Nothing else.
  business_viewer: {
    label: 'Business Viewer',
    permissions: [P.HEALTH_READ],
  },
};

// Identity-provider group -> role (what Okta / Entra ID would send in a real SSO login).
export const GROUP_TO_ROLE = {
  'pi-platform-admins': 'platform_admin',
  'pi-finops': 'finops_analyst',
  'pi-report-owners': 'report_owner',
  'pi-business-users': 'business_viewer',
};

export function roleForGroups(groups = []) {
  // First matching group wins, in order of privilege. Unknown groups grant nothing.
  for (const role of ['platform_admin', 'finops_analyst', 'report_owner', 'business_viewer']) {
    if (groups.some((g) => GROUP_TO_ROLE[g] === role)) return role;
  }
  return null;
}

export function permissionsForRole(role) {
  return ROLES[role]?.permissions ?? [];
}

export function can(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}
