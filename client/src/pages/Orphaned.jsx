// Orphaned reports (brief, Task 1 + defect 1) and the ownership review gate:
// a Report Owner requests a currently orphaned report, a Platform Admin approves or rejects.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, UserPlus, X } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { api } from '../api/http.js';
import { Badge, Card, ErrorState, Kpi, Loading, Modal, Notice, PageHeader, Segmented, Empty } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

const CLAIM_TONE = { PENDING: 'warning', APPROVED: 'ok', REJECTED: 'critical' };

export default function Orphaned() {
  const { user, can } = useAuth();
  const canClaim = can(P.ORPHANED_CLAIM);
  const canApprove = can(P.ORPHANED_APPROVE);
  const orphaned = useApi('/api/orphaned');
  const claims = useApi(canClaim || canApprove ? '/api/orphaned/claims' : null);
  const [scope, setScope] = useState('current');
  const [claiming, setClaiming] = useState(null);   // report row being claimed
  const [deciding, setDeciding] = useState(null);   // { claim, approve }
  const [text, setText] = useState('');
  const [formError, setFormError] = useState(null);

  const reports = orphaned.data?.reports ?? [];
  const rows = useMemo(() => (scope === 'current' ? reports.filter((r) => r.report_currently_orphaned) : reports), [reports, scope]);
  const pendingFor = useMemo(() => new Set((claims.data?.claims ?? []).filter((c) => c.status === 'PENDING').map((c) => c.report_id)), [claims.data]);
  // Column: any cost visible (owners see it for their own rows). KPI: platform-wide total, cost:read:all only.
  const seesCost = reports.some((r) => r.orphaned_credit_cost_usd !== undefined);
  const seesAllCost = can(P.COST_READ_ALL);

  if (orphaned.loading) return <Loading />;
  if (orphaned.error) return <ErrorState error={orphaned.error} />;
  const s = orphaned.data.summary;

  const refresh = () => { orphaned.reload(); claims.reload(); };
  const close = () => { setClaiming(null); setDeciding(null); setText(''); setFormError(null); };

  async function submitClaim() {
    try {
      await api.post(`/api/orphaned/${claiming.report_id}/claims`, { reason: text });
      close(); refresh();
    } catch (e) { setFormError(e.message); }
  }
  async function submitDecision() {
    try {
      await api.post(`/api/orphaned/claims/${deciding.claim.id}/${deciding.approve ? 'approve' : 'reject'}`, { note: text });
      close(); refresh();
    } catch (e) { setFormError(e.message); }
  }

  const columns = [
    { key: 'report_id', label: 'Report', render: (r) => <><Link to={`/reports/${r.report_id}`} onClick={(e) => e.stopPropagation()}><b>{r.report_id}</b></Link><div className="faint small">{r.report_name}</div></> },
    { key: 'report_currently_orphaned', label: 'Status', sortValue: (r) => (r.report_currently_orphaned ? 1 : 0), render: (r) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {r.report_currently_orphaned ? <Badge tone="warning">Orphaned now</Badge> : <Badge>Had gaps</Badge>}
        {r.owner_reassigned && <Badge tone="accent">Claimed</Badge>}
      </div>
    ) },
    { key: 'canonical_owner', label: 'Most frequent owner', title: 'Most frequent valid email across the 20 snapshots (a suggestion, not proof)',
      render: (r) => <span className="mono small">{r.canonical_owner ?? '—'}</span> },
    { key: 'orphaned_snapshots', label: 'Orphaned snapshots', align: 'right', render: (r) => <span className="num">{r.orphaned_snapshots} / 20</span> },
    { key: 'missing_email_snapshots', label: 'NaN', align: 'right', render: (r) => <span className="num">{r.missing_email_snapshots}</span> },
    { key: 'sentinel_snapshots', label: 'ORPHANED_REPORT', align: 'right', render: (r) => <span className="num">{r.sentinel_snapshots}</span> },
    { key: 'last_orphaned_snapshot', label: 'Last orphaned', align: 'right', render: (r) => <span className="num">#{r.last_orphaned_snapshot}</span> },
    ...(seesCost ? [{ key: 'orphaned_credit_cost_usd', label: 'Unowned spend', align: 'right', title: 'Snowflake credit cost on snapshots with no owner',
      render: (r) => <span className="num">{fmt.usd(r.orphaned_credit_cost_usd, 0)}</span> }] : []),
    ...(canClaim ? [{ key: 'action', label: '', sortable: false, render: (r) => {
      if (!r.report_currently_orphaned) return null;
      if (pendingFor.has(r.report_id)) return <Badge tone="warning">Claim pending</Badge>;
      if (r.canonical_owner?.toLowerCase() === user.email.toLowerCase()) return <Badge tone="ok">Yours</Badge>;
      return <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setClaiming(r); }}><UserPlus size={13} />Claim</button>;
    } }] : []),
  ];

  const claimList = claims.data?.claims ?? [];

  return (
    <>
      <PageHeader title="Orphaned reports"
        subtitle="A record is orphaned when its owner email is missing (NaN) or the placeholder ORPHANED_REPORT. No report is orphaned in all 20 snapshots, so a report counts as currently orphaned when its latest snapshot has no owner." />

      <div className="grid grid-4">
        <Kpi label="Orphaned records" value={s.orphaned_records} tone="warning" hint={`${s.missing_email_records} NaN · ${s.sentinel_records} ORPHANED_REPORT`} />
        <Kpi label="Reports currently orphaned" value={s.reports_currently_orphaned} tone="critical" hint="Latest snapshot has no owner" />
        <Kpi label="Reports ever orphaned" value={s.reports_ever_orphaned} hint="At least one snapshot without owner" />
        {seesAllCost
          ? <Kpi label="Unowned Snowflake spend" value={fmt.usd(reports.reduce((a, r) => a + (r.orphaned_credit_cost_usd || 0), 0), 0)} hint="Credit cost on orphaned snapshots" />
          : <Kpi label="Pending claims" value={claimList.filter((c) => c.status === 'PENDING').length} hint="Waiting for admin review" />}
      </div>

      {(canClaim || canApprove) && (
        <Card className="mt" title={canApprove ? 'Ownership claims · review queue' : 'Your ownership claims'}
          subtitle={canApprove ? 'Approving reassigns the report everywhere: access, alerts and cost. You cannot decide your own claim.' : 'An admin reviews every claim before ownership changes.'} flush>
          {claimList.length === 0 && <Empty>{canApprove ? 'No claims yet.' : 'You have not claimed any reports. Use Claim on a currently orphaned report below.'}</Empty>}
          {claimList.length > 0 && (
            <table className="table">
              <thead><tr><th>Report</th><th>Requested by</th><th>Reason</th><th>Status</th><th>Decision</th><th /></tr></thead>
              <tbody>
                {claimList.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.report_id}</b><div className="faint small">{c.report_name}</div></td>
                    <td><span className="mono small">{c.requested_by}</span><div className="faint small">{fmt.dateTime(c.requested_at)}</div></td>
                    <td style={{ maxWidth: 320 }}>{c.reason}</td>
                    <td><Badge tone={CLAIM_TONE[c.status]}>{c.status}</Badge></td>
                    <td className="small">{c.decided_by ? <><span className="mono">{c.decided_by}</span>{c.decision_note && <div className="faint">{c.decision_note}</div>}</> : <span className="faint">—</span>}</td>
                    <td className="right">
                      {canApprove && c.status === 'PENDING' && (
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="btn sm primary" onClick={() => setDeciding({ claim: c, approve: true })}><Check size={13} />Approve</button>
                          <button type="button" className="btn sm danger" onClick={() => setDeciding({ claim: c, approve: false })}><X size={13} />Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card className="mt" title="Reports with orphaned snapshots" flush>
        <DataTable rows={rows} columns={columns} searchKeys={['report_id', 'report_name', 'canonical_owner']}
          initialSort={{ key: 'orphaned_snapshots', dir: 'desc' }}
          toolbar={<Segmented value={scope} onChange={setScope} options={[
            { value: 'current', label: `Currently orphaned (${s.reports_currently_orphaned})` },
            { value: 'all', label: `Ever orphaned (${s.reports_ever_orphaned})` },
          ]} />} />
      </Card>

      <div className="mt">
        <Notice>
          Orphaned rows are kept, never dropped. Every report also has 7–13 different owner emails across its snapshots, so the
          &quot;most frequent owner&quot; is a suggestion. That&apos;s why ownership changes need a human claim and an admin approval.
        </Notice>
      </div>

      {claiming && (
        <Modal title={`Claim ${claiming.report_id}`} onClose={close}
          footer={<><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" onClick={submitClaim}>Submit claim</button></>}>
          <p className="muted" style={{ margin: 0 }}>{claiming.report_name} has no owner on its latest snapshot. A Platform Admin will review your request.</p>
          <div className="field">
            <label htmlFor="reason">Why should you own this report?</label>
            <textarea id="reason" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I built this dashboard for the Deal Strategy team" autoFocus />
          </div>
          {formError && <div className="error-text">{formError}</div>}
        </Modal>
      )}

      {deciding && (
        <Modal title={`${deciding.approve ? 'Approve' : 'Reject'} claim for ${deciding.claim.report_id}`} onClose={close}
          footer={<><button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="button" className={`btn ${deciding.approve ? 'primary' : 'danger'}`} onClick={submitDecision}>{deciding.approve ? 'Approve' : 'Reject'}</button></>}>
          <dl className="dl">
            <dt>Requested by</dt><dd className="mono">{deciding.claim.requested_by}</dd>
            <dt>Reason</dt><dd>{deciding.claim.reason}</dd>
          </dl>
          <div className="field">
            <label htmlFor="note">Note (optional, saved in the audit log)</label>
            <textarea id="note" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Confirmed with the team lead" />
          </div>
          {formError && <div className="error-text">{formError}</div>}
        </Modal>
      )}
    </>
  );
}
