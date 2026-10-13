// Audit trail (admin only): logins, access denials and every state-changing action.
import { useEffect, useState } from 'react';
import { LogIn, RefreshCw, ScrollText, ShieldAlert, ShieldX } from 'lucide-react';
import { useTheme } from '../theme.jsx';
import { useApi } from '../api/useApi.js';
import { Group, Badge, ErrorState, Loading, PageHeader, Panel, Segmented, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

const OUTCOME_TONE = { success: 'good', denied: 'critical', failure: 'warning' };

export default function Audit() {
  const { c } = useTheme();
  const [outcome, setOutcome] = useState('');
  const { data, error, loading, reload } = useApi('/api/audit?limit=1000');
  useEffect(() => { const t = setInterval(reload, 5000); return () => clearInterval(t); }, [reload]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} />;
  const entries = data.entries;
  const n = (fn) => entries.filter(fn).length;

  const columns = [
    { key: 'ts', label: 'Time', render: (e) => <span className="num">{fmt.dateTime(e.ts)}</span> },
    { key: 'event', label: 'Event', render: (e) => <span className="mono small">{e.event}</span> },
    { key: 'outcome', label: 'Outcome', render: (e) => <Badge color={c[OUTCOME_TONE[e.outcome]]} dot>{e.outcome}</Badge> },
    { key: 'actor', label: 'Who', sortValue: (e) => e.actor?.email, render: (e) => (e.actor
      ? <><span className="mono small">{e.actor.email}</span><div className="faint small">{e.actor.role}</div></>
      : <span className="faint">anonymous</span>) },
    { key: 'detail', label: 'Detail', sortable: false, render: (e) => (
      <span className="mono small muted">{Object.entries(e.detail || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ') || '—'}</span>
    ) },
  ];

  return (
    <>
      <PageHeader eyebrow="Governance · append-only" title="Audit log"
        subtitle="Append-only record of sign-ins, denied requests and every action that changes state (claims, approvals, acknowledgements, replay control)."
        actions={<button type="button" className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button>} />

      <Group title="Audit trail">
      <div className="grid g-4">
        <Stat variant="accent" tone="accent" icon={ScrollText} label="Events recorded" value={fmt.num(entries.length)} sub="Kept in memory since server start" />
        <Stat tone="good" icon={LogIn} label="Sign-ins" value={n((e) => e.event === 'auth.login' && e.outcome === 'success')} sub="Successful logins" />
        <Stat tone="critical" icon={ShieldX} label="Access denied" value={n((e) => e.outcome === 'denied')} sub="403s from the RBAC checks" />
        <Stat tone="warning" icon={ShieldAlert} label="Failed sign-ins" value={n((e) => e.event === 'auth.login' && e.outcome === 'failure')} sub="Wrong email or password" />
      </div>

      <Panel className="mt" flush bordered title="Events" subtitle="Newest first">
        <DataTable rows={outcome ? entries.filter((e) => e.outcome === outcome) : entries} columns={columns} searchKeys={['event']} pageSize={20}
          toolbar={<Segmented value={outcome} onChange={setOutcome} options={[
            { value: '', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'denied', label: 'Denied' }, { value: 'failure', label: 'Failure' },
          ]} />} />
      </Panel>
      </Group>
    </>
  );
}
