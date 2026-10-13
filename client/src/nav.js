// Sidebar entries and the permission each page needs (any of the listed ones).
// The same permissions guard the routes in App.jsx and, independently, the API.
import { BellRing, DollarSign, FileWarning, Gauge, LayoutDashboard, ScrollText, ShieldCheck } from 'lucide-react';
import { P } from './auth/AuthContext.jsx';

export const NAV = [
  { section: 'Monitor', to: '/', label: 'Overview', icon: LayoutDashboard },
  { section: 'Monitor', to: '/health', label: 'System health', icon: Gauge, perm: P.HEALTH_READ },
  { section: 'Monitor', to: '/alerts', label: 'Live operations', icon: BellRing, perm: [P.ALERTS_READ_ALL, P.ALERTS_READ_OWN], badge: 'alerts' },
  { section: 'Govern', to: '/orphaned', label: 'Orphaned reports', icon: FileWarning, perm: P.ORPHANED_READ },
  { section: 'Govern', to: '/cost', label: 'Cost attribution', icon: DollarSign, perm: [P.COST_READ_ALL, P.COST_READ_OWN] },
  { section: 'Validate', to: '/data-quality', label: 'Data quality', icon: ShieldCheck, perm: P.DQ_READ_SUMMARY },
  { section: 'Validate', to: '/audit', label: 'Audit log', icon: ScrollText, perm: P.AUDIT_READ },
];
