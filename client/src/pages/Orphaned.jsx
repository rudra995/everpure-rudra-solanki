// Orphaned reports (brief, Task 1 + defect 1) and the ownership review gate:
// a Report Owner requests a currently orphaned report, a Platform Admin approves or rejects.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, UserPlus, X } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useApi } from '../api/useApi.js';
import { api } from '../api/http.js';
import { useTheme } from '../theme.jsx';
import { Badge, Empty, ErrorState, Loading, Modal, Notice, PageHeader, Panel, SectionTitle, Segmented, SplitBar, Stat } from '../components/ui.jsx';
import DataTable from '../components/DataTable.jsx';
import { fmt } from '../format.js';

const CLAIM_TONE = { PENDING: 'warning', APPROVED: 'good', REJECTED: 'critical' };

export default function Orphaned() {
  const { user, can } = useAuth();
  const { c } = useTheme();
  const canClaim = can(P.ORPHANED_CLAIM);
  const canApprove = can(P.ORPHANED_APPROVE);
  const orphaned = useApi('/api/orphaned');
  const claims = useApi(canClaim || canApprove ? '/api/orphaned/claims' : null);
  const [scope, setScope] = useState('current');
  const [claiming, setClaiming] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState(null);

  const reports = orphaned.data?.reports ?? [];
  const rows = useMemo(() => (scope === 'current' ? reports.filter((r) => r.report_currently_orphaned) : reports), [reports, scope]);
  const claimList = claims.data?.claims ?? [];
  const pendingFor = useMemo(() => new Set(claimList.filter((x) => x.status === 'PENDING').map((x) => x.report_id)), [claimList]);
  const seesCost = reports.some((r) => r.orphaned_credit_cost_usd !== undefined);

  if (orphaned.loading) return <Loading />;
  if (orphaned.error) return <ErrorState error={orphaned.error} />;
  const s = orphaned.data.summary;
  const pending = claimList.filter((x) => x.status === 'PENDING').length;

  const refresh = () => { orphaned.reload(); claims.reload(); };
  const close = () => { setClaiming(null); setDeciding(null); setText(''); setFormError(null); };
  async function submitClaim() {
    try { await api.post(`/api/orphaned/${claiming.report_id}/claims`, { reason: text }); close(); refresh(); } catch (e) { setFormError(e.message); }
  }
  async function submitDecision() {
    try { await api.post(`/api/orphaned/claims/${deciding.claim.id}/${deciding.approve ? 'approve' : 'reject'}`, { note: text }); close(); refresh(); } catch (e) { setFormError(e.message); }
  }

  const columns = [
    { key: 'report_id', label: 'Report', render: (r) => <><Link to={`/reports/${r.report_id}`} onClick={(e) => e.stopPropagation()}><b>{r.report_id}</b></Link><div className="faint small">{r.report_name}</div></> },
    { key: 'report_currently_orphaned', label: 'Right now', sortValue: (r) => (r.report_currently_orphaned ? 1 : 0), render: (r) => (
      <div className="row wrap" style={{ gap: 4 }}>
        {r.report_currently_orphaned ? <Badge color={c.ownership} dot>No owner</Badge> : <Badge color={c.unknown}>Has an owner</Badge>}
        {r.owner_reassigned && <Badge color={c.accent}>Claimed</Badge>}
      </div>) },
    { key: 'orphaned_snapshots', label: 'Snapshots with no owner', align: 'right', render: (r) => <span className="num">{r.orphaned_snapshots} of 20</span> },
    { key: 'missing_email_snapshots', label: 'Why', sortable: false, render: (r) => (
      <span className="small muted">{[r.missing_email_snapshots && `${r.missing_email_snapshots}× email missing`, r.sentinel_snapshots && `${r.sentinel_snapshots}× ORPHANED_REPORT`].filter(Boolean).join(', ')}</span>) },
    { key: 'canonical_owner', label: 'Most likely owner', title: 'Most frequent valid email across the 20 snapshots: a suggestion, not proof',
      render: (r) => <span className="mono small">{r.canonical_owner ?? '—'}</span> },
    ...(seesCost ? [{ key: 'orphaned_credit_cost_usd', label: 'Snowflake spend with no owner', align: 'right', render: (r) => <span className="num">{fmt.usd(r.orphaned_credit_cost_usd, 0)}</span> }] : []),
    ...(canClaim && !canApprove ? [{ key: 'action', label: '', sortable: false, render: (r) => {
      if (!r.report_currently_orphaned) return null;
      if (pendingFor.has(r.report_id)) return <Badge color={c.warning}>Request sent</Badge>;
      if (r.canonical_owner?.toLowerCase() === user.email.toLowerCase()) return <Badge color={c.good}>Likely yours</Badge>;
      return <button type="button" className="btn sm" onClick={(e) => { e.stopPropagation(); setClaiming(r); }}><UserPlus size={13} />Request ownership</button>;
    } }] : []),
  ];

  return (
    <>
      <PageHeader index="04" eyebrow="Orphaned reports · Task 1" title="Reports with no owner"
        subtitle="A record is orphaned when its owner email is missing (NaN) or set to the placeholder ORPHANED_REPORT. No report is ownerless in all 20 snapshots, so a report counts as orphaned when its latest snapshot has no owner." />

      <div className="grid g-3">
        <Stat tone="ownership" label="Reports with no owner right now" value={s.reports_currently_orphaned} sub={`${s.reports_ever_orphaned} reports lost their owner at least once`} />
        <Stat tone="aws" label="Orphaned records" value={s.orphaned_records} unit="of 2,000"
          foot={<SplitBar thin parts={[
            { label: 'Email missing', value: s.missing_email_records, color: c.ownership, display: s.missing_email_records },
            { label: 'ORPHANED_REPORT', value: s.sentinel_records, color: c.aws, display: s.sentinel_records },
          ]} />} />
        {canClaim || canApprove
          ? <Stat tone="warning" label={canApprove ? 'Ownership requests to review' : 'Your requests waiting'} value={pending} sub="An admin approves every change of owner" />
          : <Stat tone="snowflake" label="Snowflake spend with no owner" value={fmt.usdCompact(reports.reduce((a, r) => a + (r.orphaned_credit_cost_usd || 0), 0))} sub="Credit cost on orphaned snapshots" />}
      </div>

      {(canClaim || canApprove) && (
        <>
          <SectionTitle note={canApprove ? 'Approving reassigns the report everywhere: access, alerts and cost' : 'An admin reviews every request'}>
            {canApprove ? 'Ownership requests' : 'Your ownership requests'}
          </SectionTitle>
          <Panel flush>
            {claimList.length === 0 && <Empty>{canApprove ? 'No requests yet. Report owners can request an orphaned report below.' : 'You have not requested any reports yet. Use “Request ownership” in the table below.'}</Empty>}
            {claimList.length > 0 && (
              <table className="table">
                <thead><tr><th>Report</th><th>Requested by</th><th>Reason</th><th>Status</th><th>Decision</th><th /></tr></thead>
                <tbody>
                  {claimList.map((cl) => (
                    <tr key={cl.id}>
                      <td><b>{cl.report_id}</b><div className="faint small">{cl.report_name}</div></td>
                      <td><span className="mono small">{cl.requested_by}</span><div className="faint small">{fmt.dateTime(cl.requested_at)}</div></td>
                      <td style={{ maxWidth: 320 }}>{cl.reason}</td>
                      <td><Badge color={c[CLAIM_TONE[cl.status]]} dot>{cl.status.charAt(0) + cl.status.slice(1).toLowerCase()}</Badge></td>
                      <td className="small">{cl.decided_by ? <><span className="mono">{cl.decided_by}</span>{cl.decision_note && <div className="faint">{cl.decision_note}</div>}</> : <span className="faint">—</span>}</td>
                      <td className="right">
                        {canApprove && cl.status === 'PENDING' && (
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn sm primary" onClick={() => setDeciding({ claim: cl, approve: true })}><Check size={13} />Approve</button>
                            <button type="button" className="btn sm danger" onClick={() => setDeciding({ claim: cl, approve: false })}><X size={13} />Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      <SectionTitle note="Orphaned rows are kept, never deleted">Orphaned reports</SectionTitle>
      <Panel flush>
        <DataTable rows={rows} columns={columns} searchKeys={['report_id', 'report_name', 'canonical_owner']} initialSort={{ key: 'orphaned_snapshots', dir: 'desc' }}
          toolbar={<Segmented value={scope} onChange={setScope} options={[
            { value: 'current', label: `No owner now (${s.reports_currently_orphaned})` }, { value: 'all', label: `Ever without an owner (${s.reports_ever_orphaned})` }]} />} />
      </Panel>

      <div className="mt">
        <Notice>Every report has 7 to 13 different owner emails across its snapshots, so the “most likely owner” is only a suggestion. That is why a change of owner needs a request from a report owner and an approval from an admin, and the two can never be the same person.</Notice>
      </div>

      {claiming && (
        <Modal title={`Request ownership of ${claiming.report_id}`} onClose={close}
          footer={<><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" onClick={submitClaim}>Send request</button></>}>
          <p className="muted" style={{ margin: 0 }}>{claiming.report_name} has no owner on its latest snapshot. A Platform Admin will review your request.</p>
          <div className="field">
            <label htmlFor="reason">Why should you own this report?</label>
            <textarea id="reason" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I built this dashboard for the Deal Strategy team" autoFocus />
          </div>
          {formError && <div className="error-text">{formError}</div>}
        </Modal>
      )}
      {deciding && (
        <Modal title={`${deciding.approve ? 'Approve' : 'Reject'} request for ${deciding.claim.report_id}`} onClose={close}
          footer={<><button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="button" className={`btn ${deciding.approve ? 'primary' : 'danger'}`} onClick={submitDecision}>{deciding.approve ? 'Approve' : 'Reject'}</button></>}>
          <dl className="dl"><dt>Requested by</dt><dd className="mono">{deciding.claim.requested_by}</dd><dt>Reason</dt><dd>{deciding.claim.reason}</dd></dl>
          <div className="field">
            <label htmlFor="note">Note (optional, kept in the audit log)</label>
            <textarea id="note" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Confirmed with the team lead" />
          </div>
          {formError && <div className="error-text">{formError}</div>}
        </Modal>
      )}
    </>
  );
}
