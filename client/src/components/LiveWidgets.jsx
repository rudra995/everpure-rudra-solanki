// Alert rows for the live feed. Alert type keeps its metric colour (latency = violet,
// refresh = raspberry); severity uses the status colours.
import { Link } from 'react-router-dom';
import { Check, Clock, RefreshCw } from 'lucide-react';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme } from '../theme.jsx';
import { SeverityBadge, Empty } from './ui.jsx';
import { fmt } from '../format.js';

export function AlertIcon({ type }) {
  const { c } = useTheme();
  const color = type === 'LATENCY_BREACH' ? c.latency : c.refresh;
  const Icon = type === 'LATENCY_BREACH' ? Clock : RefreshCw;
  return <span className="feed-icon" style={{ background: `${color}1f`, color }}><Icon size={16} /></span>;
}

export function AlertRow({ a, showOwner, onAck, compact }) {
  return (
    <li className={`feed-item ${a.acknowledged_at ? 'acked' : ''} ${a.fresh ? 'fresh' : ''}`}>
      <AlertIcon type={a.type} />
      <div style={{ minWidth: 0 }}>
        <div className="feed-title">{a.message}</div>
        <div className="feed-meta">
          <Link to={`/reports/${a.report_id}`}>{a.report_id}</Link>
          {!compact && <span>{a.type === 'LATENCY_BREACH' ? 'Slow load' : 'Refresh failed'}</span>}
          {!compact && <span>snapshot {a.snapshot_seq}</span>}
          {showOwner && <span className="mono">{a.owner ?? 'no owner'}</span>}
          <span>{fmt.time(a.created_at)}</span>
          {a.acknowledged_at && <span>✓ acknowledged by {a.acknowledged_by}</span>}
        </div>
      </div>
      <div className="row">
        <SeverityBadge value={a.severity} />
        {onAck && !a.acknowledged_at && <button type="button" className="btn sm" onClick={() => onAck(a.id)}><Check size={13} />Acknowledge</button>}
      </div>
    </li>
  );
}

export function AlertStream({ limit = 6 }) {
  const { alerts } = useLive();
  if (!alerts.length) return <Empty>Waiting for the first alert…</Empty>;
  return (
    <ul className="feed">
      {alerts.slice(0, limit).map((a) => <AlertRow key={a.id} a={a} compact />)}
    </ul>
  );
}
