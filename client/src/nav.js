// Menu entries and the permission each page needs (any of the listed ones).
// The same permissions guard the routes in App.jsx and, independently, the API.
import { BellRing, DollarSign, FileWarning, Gauge, LayoutDashboard, ScrollText, ShieldCheck } from 'lucide-react';
import { P } from './auth/AuthContext.jsx';

export const NAV = [
  { section: 'Monitor', to: '/', label: 'Overview', icon: LayoutDashboard, hint: 'Platform status at a glance' },
  { section: 'Monitor', to: '/health', label: 'System health', icon: Gauge, perm: P.HEALTH_READ, hint: 'Latency and refresh status' },
  { section: 'Monitor', to: '/alerts', label: 'Live operations', icon: BellRing, perm: [P.ALERTS_READ_ALL, P.ALERTS_READ_OWN], badge: 'alerts', hint: 'Real-time alert stream' },
  { section: 'Govern', to: '/orphaned', label: 'Orphaned reports', icon: FileWarning, perm: P.ORPHANED_READ, hint: 'Ownership gaps and claims' },
  { section: 'Govern', to: '/cost', label: 'Cost attribution', icon: DollarSign, perm: [P.COST_READ_ALL, P.COST_READ_OWN], hint: 'Snowflake + AWS per report' },
  { section: 'Validate', to: '/data-quality', label: 'Data quality', icon: ShieldCheck, perm: P.DQ_READ_SUMMARY, hint: 'Defects and reconciliation' },
  { section: 'Validate', to: '/audit', label: 'Audit log', icon: ScrollText, perm: P.AUDIT_READ, hint: 'Sign-ins, denials, actions' },
];
