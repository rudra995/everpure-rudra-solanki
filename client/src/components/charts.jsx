// Chart helpers: a themed tooltip, shared axis styling and the snapshot heatmap.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { fmt } from '../format.js';

// Recharts tooltip. format(value, name) returns the display string; showTotal adds a sum row.
export function ChartTooltip({ active, payload, label, title, format = (v) => fmt.num(v), showTotal, names = {} }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  const total = rows.reduce((a, p) => a + Number(p.value || 0), 0);
  return (
    <div className="tt">
      <div className="tt-title">{title ? title(label, payload) : label}</div>
      {rows.map((p) => (
        <div className="tt-row" key={p.dataKey}>
          <span><span className="sw" style={{ background: p.color || p.fill || p.stroke }} />{names[p.dataKey] ?? p.name}</span>
          <b>{format(p.value, p.dataKey)}</b>
        </div>
      ))}
      {showTotal && rows.length > 1 && <div className="tt-row tt-total"><span>Total</span><b>{format(total, 'total')}</b></div>}
    </div>
  );
}

export const axis = (c) => ({
  tick: { fontSize: 11, fill: c.axis },
  axisLine: { stroke: c.grid },
  tickLine: false,
});

const LAT_ORDER = ['OK', 'WARNING', 'HIGH', 'CRITICAL'];

// Reports (columns) x snapshots (rows) heatmap. Metric: latency | refresh | ownership.
export function Heatmap({ rows, metric, rowHeight = 11 }) {
  const { c } = useTheme();
  const navigate = useNavigate();
  const [tip, setTip] = useState(null);
  const reports = [...new Set(rows.map((r) => r.report_id))].sort();
  const index = new Map(rows.map((r) => [`${r.report_id}|${r.snapshot_seq}`, r]));

  const colorOf = (r) => {
    if (!r) return 'transparent';
    if (metric === 'refresh') return c[STATUS_KEY[r.last_refresh_status]];
    if (metric === 'ownership') return r.owner_missing ? c.ownership : r.owner_sentinel ? c.aws : `${c.unknown}33`;
    // latency: severity colour, with OK fading by how fast it was
    return r.latency_severity === 'OK' ? `${c.good}${r.avg_load_time_sec < 7.5 ? '66' : 'aa'}` : c[SEVERITY_KEY[r.latency_severity]];
  };

  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="heat-rows">
        <div className="heat-ylabels" style={{ gridTemplateRows: `repeat(20, ${rowHeight}px)`, gap: 2 }}>
          {Array.from({ length: 20 }, (_, i) => <span key={i} style={{ lineHeight: `${rowHeight}px` }}>{i % 4 === 0 || i === 19 ? `#${i + 1}` : ''}</span>)}
        </div>
        <div className="heat" style={{ gridTemplateColumns: `repeat(${reports.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(20, ${rowHeight}px)`, gridAutoFlow: 'column' }}>
          {reports.flatMap((id) => Array.from({ length: 20 }, (_, i) => {
            const r = index.get(`${id}|${i + 1}`);
            return (
              <div key={`${id}-${i}`} className="heat-cell" style={{ background: colorOf(r) }}
                onMouseMove={(e) => setTip({ r, x: e.clientX, y: e.clientY })}
                onClick={() => navigate(`/reports/${id}`)} />
            );
          }))}
        </div>
      </div>
      <div className="heat-axis" style={{ marginLeft: 40 }}>
        <span>{reports[0]}</span><span>{reports.length} reports →</span><span>{reports[reports.length - 1]}</span>
      </div>
      {tip?.r && (
        <div className="heat-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: tip.y + 14 }}>
          <div className="tt-title">{tip.r.report_id} · snapshot {tip.r.snapshot_seq}</div>
          <div className="tt-row"><span>Load time</span><b>{fmt.sec(tip.r.avg_load_time_sec)} · {tip.r.latency_severity}</b></div>
          <div className="tt-row"><span>Refresh</span><b>{tip.r.last_refresh_status}</b></div>
          <div className="tt-row"><span>Owner</span><b>{tip.r.owner_missing ? 'missing (NaN)' : tip.r.owner_sentinel ? 'ORPHANED_REPORT' : 'present'}</b></div>
          <div className="tt-row"><span>Views</span><b>{fmt.num(tip.r.monthly_active_views)}</b></div>
        </div>
      )}
    </div>
  );
}

export function heatLegend(metric, c) {
  if (metric === 'refresh') return ['SUCCESS', 'FAILED', 'TIMED_OUT', 'UNKNOWN'].map((s) => ({ label: s.replace('_', ' '), color: c[STATUS_KEY[s]] }));
  if (metric === 'ownership') return [{ label: 'Owner present', color: `${c.unknown}55` }, { label: 'Missing (NaN)', color: c.ownership }, { label: 'ORPHANED_REPORT', color: c.aws }];
  return LAT_ORDER.map((s) => ({ label: s === 'OK' ? 'OK ≤ 15 s' : s, color: c[SEVERITY_KEY[s]] }));
}
