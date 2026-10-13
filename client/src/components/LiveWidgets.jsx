// Live panels fed by the WebSocket: the alert stream and the telemetry tape.
// Alert type has its metric colour (latency = violet, refresh = pink); severity has its status colour.
import { Link } from 'react-router-dom';
import { Check, Clock, RefreshCw } from 'lucide-react';
import { useAuth, P } from '../auth/AuthContext.jsx';
import { useLive } from '../live/LiveContext.jsx';
import { useTheme, SEVERITY_KEY } from '../theme.jsx';
import { SeverityBadge, StatusBadge, Empty } from './ui.jsx';
import { fmt } from '../format.js';

export function AlertIcon({ type }) {
  const { c } = useTheme();
  const color = type === 'LATENCY_BREACH' ? c.latency : c.refresh;
  const Icon = type === 'LATENCY_BREACH' ? Clock : RefreshCw;
  return <span className="feed-icon" style={{ background: `${color}22`, color }}><Icon size={16} /></span>;
}

export function AlertRow({ a, showOwner, onAck }) {
  return (
    <li className={`feed-item ${a.acknowledged_at ? 'acked' : ''} ${a.fresh ? 'fresh' : ''}`}>
      <AlertIcon type={a.type} />
      <div style={{ minWidth: 0 }}>
        <div className="feed-title">{a.message}</div>
        <div className="feed-meta">
          <Link to={`/reports/${a.report_id}`}>{a.report_id}</Link>
          <span>{a.type === 'LATENCY_BREACH' ? 'Latency breach' : 'Refresh failure'}</span>
          <span>snapshot #{a.snapshot_seq}</span>
          {showOwner && <span className="mono">{a.owner ?? 'no owner'}</span>}
          <span>{fmt.time(a.created_at)}</span>
          {a.acknowledged_at && <span>✓ ack by {a.acknowledged_by}</span>}
        </div>
      </div>
      <div className="row">
        <SeverityBadge value={a.severity} />
        {onAck && !a.acknowledged_at && <button type="button" className="btn sm" onClick={() => onAck(a.id)}><Check size={13} />Ack</button>}
      </div>
    </li>
  );
}

export function AlertStream({ limit = 6, compact }) {
  const { alerts, acknowledge } = useLive();
  const { can } = useAuth();
  if (!alerts.length) return <Empty>Waiting for the first alert…</Empty>;
  const canAck = !compact && can([P.ALERTS_ACK_ALL, P.ALERTS_ACK_OWN]);
  return (
    <ul className="feed">
      {alerts.slice(0, limit).map((a) => <AlertRow key={a.id} a={a} showOwner={!compact && can(P.ALERTS_READ_ALL)} onAck={canAck ? (id) => acknowledge(id).catch(() => {}) : null} />)}
    </ul>
  );
}

export function TelemetryTape({ limit = 8 }) {
  const { telemetry, simulator } = useLive();
  const { c } = useTheme();
  if (!telemetry.length) {
    return <Empty>{simulator?.running ? 'Waiting for the next snapshot…' : 'Replay is paused. A Platform Admin can start it from Live operations.'}</Empty>;
  }
  return (
    <div className="tape">
      {telemetry.slice(0, limit).map((t) => {
        const sev = t.avg_load_time_sec > 45 ? 'CRITICAL' : t.avg_load_time_sec > 30 ? 'HIGH' : t.avg_load_time_sec > 15 ? 'WARNING' : 'OK';
        return (
          <Link key={`${t.cycle}-${t.source_row}`} to={`/reports/${t.report_id}`} className="tape-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row between"><b>{t.report_id}</b><span className="xs faint">#{t.snapshot_seq}</span></div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span className="num strong" style={{ fontSize: 17, color: c[SEVERITY_KEY[sev]] }}>{fmt.sec(t.avg_load_time_sec)}</span>
              <StatusBadge value={t.last_refresh_status} />
            </div>
            <div className="xs faint" style={{ marginTop: 4 }}>{fmt.num(t.monthly_active_views)} views · {fmt.time(t.replayed_at)}</div>
          </Link>
        );
      })}
    </div>
  );
}
