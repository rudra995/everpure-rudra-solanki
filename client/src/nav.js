// Pages, in menu order, with the permission each needs (any of the listed ones).
// The same permissions guard the routes in App.jsx and, independently, the API.
// Every page maps to the brief: Task 1 (health, orphaned reports), Task 2 (alerts),
// Task 3 (cost), plus the data-quality findings the brief asks to document.
import { P } from './auth/AuthContext.jsx';

export const NAV = [
  { to: '/', label: 'Summary', hint: 'What needs attention right now' },
  { to: '/health', label: 'System health', hint: 'Task 1 · load times and refreshes', perm: P.HEALTH_READ },
  { to: '/alerts', label: 'Live alerts', hint: 'Task 2 · real-time breaches', perm: [P.ALERTS_READ_ALL, P.ALERTS_READ_OWN], badge: 'alerts' },
  { to: '/orphaned', label: 'Orphaned reports', hint: 'Task 1 · reports with no owner', perm: P.ORPHANED_READ },
  { to: '/cost', label: 'Cost', hint: 'Task 3 · Snowflake + AWS per view', perm: [P.COST_READ_ALL, P.COST_READ_OWN] },
  { to: '/data-quality', label: 'Data quality', hint: 'Defects found and how they were handled', perm: P.DQ_READ_SUMMARY },
];
