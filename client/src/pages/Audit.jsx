// Audit trail (admin only): logins, access denials and every state-changing action.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../api/useApi.js';
import { Badge, Card, ErrorState, Kpi, Loading, PageHeader, Segmented } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

const OUTCOME_TONE = { success: 'ok', denied: 'critical', failure: 'warning' };

export default function Audit() {
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
    { key: 'outcome', label: 'Outcome', render: (e) => <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome}</Badge> },
    { key: 'actor', label: 'Who', sortValue: (e) => e.actor?.email, render: (e) => (e.actor
      ? <><span className="mono small">{e.actor.email}</span><div className="faint small">{e.actor.role}</div></>
      : <span className="faint">anonymous</span>) },
    { key: 'detail', label: 'Detail', sortable: false, render: (e) => (
      <span className="mono small muted">{Object.entries(e.detail || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ') || '—'}</span>
    ) },
  ];

  return (
    <>
      <PageHeader title="Audit log"
        subtitle="Append-only record of sign-ins, denied requests and every action that changes state (claims, approvals, acknowledgements, replay control)."
        actions={<button type="button" className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button>} />

      <div className="grid grid-4">
        <Kpi label="Events recorded" value={fmt.num(entries.length)} hint="Kept in memory since server start" />
        <Kpi label="Sign-ins" value={n((e) => e.event === 'auth.login' && e.outcome === 'success')} tone="ok" />
        <Kpi label="Access denied" value={n((e) => e.outcome === 'denied')} tone="critical" hint="403s from the RBAC checks" />
        <Kpi label="Failed sign-ins" value={n((e) => e.event === 'auth.login' && e.outcome === 'failure')} tone="warning" />
      </div>

      <Card className="mt" flush title="Events" subtitle="Newest first">
        <DataTable rows={outcome ? entries.filter((e) => e.outcome === outcome) : entries} columns={columns} searchKeys={['event']} pageSize={20}
          toolbar={<Segmented value={outcome} onChange={setOutcome} options={[
            { value: '', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'denied', label: 'Denied' }, { value: 'failure', label: 'Failure' },
          ]} />} />
      </Card>
    </>
  );
}
