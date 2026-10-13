// Chart helpers: a themed tooltip, shared axis styling and the report health map.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme, SEVERITY_KEY, STATUS_KEY } from '../theme.jsx';
import { fmt } from '../format.js';

// Recharts tooltip. format(value, key) returns the display string; showTotal adds a sum row.
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

export const axis = (c) => ({ tick: { fontSize: 11, fill: c.axis }, axisLine: { stroke: c.grid }, tickLine: false });

const ROW_H = 14;

// Report health map: one column per report, one row per snapshot (1 at the top).
// metric: 'latency' (green / yellow / orange / red by severity), 'refresh' or 'ownership'.
export function Heatmap({ rows, metric }) {
  const { c } = useTheme();
  const navigate = useNavigate();
  const [tip, setTip] = useState(null);
  const reports = [...new Set(rows.map((r) => r.report_id))].sort();
  const index = new Map(rows.map((r) => [`${r.report_id}|${r.snapshot_seq}`, r]));
  const few = reports.length <= 30;
  const cols = few ? `repeat(${reports.length}, 26px)` : `repeat(${reports.length}, minmax(5px, 1fr))`;

  const colorOf = (r) => {
    if (!r) return 'transparent';
    if (metric === 'refresh') return c[STATUS_KEY[r.last_refresh_status]];
    if (metric === 'ownership') return r.owner_missing ? c.ownership : r.owner_sentinel ? c.aws : '#eadccb';
    if (r.latency_severity === 'OK') return r.avg_load_time_sec < 7.5 ? '#9fd3b0' : c.good;
    return c[SEVERITY_KEY[r.latency_severity]];
  };

  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="heat-wrap">
        <div className="heat-y" style={{ gridTemplateRows: `repeat(20, ${ROW_H}px)`, rowGap: 3 }}>
          {Array.from({ length: 20 }, (_, i) => <span key={i}>{i === 0 ? 'Snapshot 1' : [4, 9, 14, 19].includes(i) ? i + 1 : ''}</span>)}
        </div>
        <div>
          <div className="heat" style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(20, ${ROW_H}px)`, gridAutoFlow: 'column' }}>
            {reports.flatMap((id) => Array.from({ length: 20 }, (_, i) => {
              const r = index.get(`${id}|${i + 1}`);
              return <div key={`${id}-${i}`} className="heat-cell" style={{ background: colorOf(r) }}
                onMouseMove={(e) => setTip({ r, x: e.clientX, y: e.clientY })} onClick={() => navigate(`/reports/${id}`)} />;
            }))}
          </div>
          <div className="heat-x" style={{ gridTemplateColumns: cols }}>
            {reports.map((id, i) => ((few || i % 10 === 0)
              ? <span key={id} style={{ gridColumn: `${i + 1} / span ${few ? 1 : 10}`, fontSize: few ? 9 : 10 }}>{few ? id.slice(4) : id}</span>
              : null))}
          </div>
        </div>
      </div>
      {tip?.r && (
        <div className="heat-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 230), top: tip.y + 14 }}>
          <div className="tt-title">{tip.r.report_id} · snapshot {tip.r.snapshot_seq}</div>
          <div className="tt-row"><span>Load time</span><b>{fmt.sec(tip.r.avg_load_time_sec)} ({tip.r.latency_severity})</b></div>
          <div className="tt-row"><span>Last refresh</span><b>{tip.r.last_refresh_status}</b></div>
          <div className="tt-row"><span>Owner email</span><b>{tip.r.owner_missing ? 'missing (NaN)' : tip.r.owner_sentinel ? 'ORPHANED_REPORT' : 'present'}</b></div>
          <div className="tt-row faint" style={{ marginTop: 4 }}><span>Click to open the report</span></div>
        </div>
      )}
    </div>
  );
}

export function heatLegend(metric, c) {
  if (metric === 'refresh') return [
    { label: 'Succeeded', color: c.good }, { label: 'Failed', color: c.critical }, { label: 'Timed out', color: c.serious }, { label: 'Unknown (needs review)', color: c.unknown }];
  if (metric === 'ownership') return [
    { label: 'Owner present', color: '#eadccb' }, { label: 'Email missing (NaN)', color: c.ownership }, { label: 'ORPHANED_REPORT placeholder', color: c.aws }];
  return [
    { label: 'Under 7.5 s', color: '#9fd3b0' }, { label: '7.5–15 s', color: c.good }, { label: '15–30 s (warning)', color: c.warning },
    { label: '30–45 s (high)', color: c.serious }, { label: 'Over 45 s (critical)', color: c.critical }];
}
