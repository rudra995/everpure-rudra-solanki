// Small live panels fed by the socket: recent telemetry and recent alerts.
import { Link } from 'react-router-dom';
import { useLive } from '../live/LiveContext.jsx';
import { SeverityBadge, StatusBadge, Empty } from './ui.jsx';
import { fmt } from '../format.js';

export function TelemetryTicker({ limit = 8 }) {
  const { telemetry, simulator } = useLive();
  if (!telemetry.length) {
    return <Empty>{simulator?.running ? 'Waiting for the next snapshot…' : 'Replay is paused. A Platform Admin can start it from Live alerts.'}</Empty>;
  }
  return (
    <table className="table">
      <thead>
        <tr><th>Report</th><th>Snapshot</th><th className="right">Load time</th><th>Refresh</th></tr>
      </thead>
      <tbody>
        {telemetry.slice(0, limit).map((t) => (
          <tr key={`${t.cycle}-${t.source_row}`}>
            <td title={t.report_name}><Link to={`/reports/${t.report_id}`}><b>{t.report_id}</b></Link></td>
            <td className="num faint">#{t.snapshot_seq}</td>
            <td className="right num" style={{ color: t.avg_load_time_sec > 15 ? 'var(--high)' : undefined }}>{fmt.sec(t.avg_load_time_sec)}</td>
            <td><StatusBadge value={t.last_refresh_status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RecentAlerts({ limit = 6 }) {
  const { alerts } = useLive();
  if (!alerts.length) return <Empty>No alerts yet.</Empty>;
  return (
    <ul className="feed">
      {alerts.slice(0, limit).map((a) => (
        <li key={a.id} className={`feed-item sev-${a.severity} ${a.acknowledged_at ? 'acked' : ''}`}>
          <span className="stripe" />
          <div>
            <div className="feed-title">{a.message}</div>
            <div className="feed-meta"><span>{a.report_id}</span><span>{a.type === 'LATENCY_BREACH' ? 'Latency' : 'Refresh'}</span><span>{fmt.time(a.created_at)}</span></div>
          </div>
          <SeverityBadge value={a.severity} />
        </li>
      ))}
    </ul>
  );
}
