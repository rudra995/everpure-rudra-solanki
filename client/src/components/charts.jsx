// Chart helpers: a themed tooltip, shared axis styling and the snapshot heatmap.
import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
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
// How "bad" a report looks for the chosen metric, used to pick the worst N for the compact view.
const SCORE = {
  latency: (rs) => rs.reduce((a, r) => a + ({ OK: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 }[r.latency_severity] ?? 0), 0),
  refresh: (rs) => rs.filter((r) => ['FAILED', 'TIMED_OUT'].includes(r.last_refresh_status)).length,
  ownership: (rs) => rs.filter((r) => r.owner_missing || r.owner_sentinel).length,
};
const METRIC_WORD = { latency: 'slowest', refresh: 'least reliable', ownership: 'most often orphaned' };
const COMPACT = 25;

// Reports (columns) x snapshots (rows) heatmap. Metric: latency | refresh | ownership.
// Compact by default: the 25 worst reports for the metric, worst first; a toggle shows all.
export function Heatmap({ rows, metric, rowHeight = 14 }) {
  const { c } = useTheme();
  const navigate = useNavigate();
  const [tip, setTip] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const index = new Map(rows.map((r) => [`${r.report_id}|${r.snapshot_seq}`, r]));
  const byReport = new Map();
  for (const r of rows) byReport.set(r.report_id, [...(byReport.get(r.report_id) ?? []), r]);
  const allIds = [...byReport.keys()].sort();
  const compact = !showAll && allIds.length > COMPACT;
  const reports = compact
    ? [...allIds].sort((a, b) => SCORE[metric](byReport.get(b)) - SCORE[metric](byReport.get(a)) || a.localeCompare(b)).slice(0, COMPACT)
    : allIds;
  const labelEvery = reports.length <= 30 ? 1 : 10;

  const colorOf = (r) => {
    if (!r) return 'transparent';
    if (metric === 'refresh') return c[STATUS_KEY[r.last_refresh_status]];
    if (metric === 'ownership') return r.owner_missing ? c.ownership : r.owner_sentinel ? c.refresh : `${c.unknown}55`;
    return r.latency_severity === 'OK' ? `${c.good}${r.avg_load_time_sec < 7.5 ? '66' : 'bb'}` : c[SEVERITY_KEY[r.latency_severity]];
  };

  return (
    <div onMouseLeave={() => setTip(null)}>
      <div className="heat-toolbar">
        <span className="small muted">
          {compact ? `Showing the ${COMPACT} ${METRIC_WORD[metric]} reports, worst first` : `Showing all ${allIds.length} reports`}
        </span>
        {allIds.length > COMPACT && (
          <button type="button" className="btn sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show worst ${COMPACT}` : `Show all ${allIds.length}`}
          </button>
        )}
      </div>
      <div className="heat-rows">
        <div className="heat-ylabels" style={{ gridTemplateRows: `repeat(20, ${rowHeight}px)`, gap: 3 }}>
          {Array.from({ length: 20 }, (_, i) => <span key={i} style={{ lineHeight: `${rowHeight}px` }}>{i === 0 || (i + 1) % 5 === 0 ? `#${i + 1}` : ''}</span>)}
        </div>
        <div className="heat" style={{ gap: 3, gridTemplateColumns: `repeat(${reports.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(20, ${rowHeight}px)`, gridAutoFlow: 'column' }}>
          {reports.flatMap((id) => Array.from({ length: 20 }, (_, i) => {
            const r = index.get(`${id}|${i + 1}`);
            return (
              <div key={`${id}-${i}`} className="heat-cell" style={{ background: colorOf(r), borderRadius: compact ? 4 : 2 }}
                onMouseMove={(e) => setTip({ r, x: e.clientX, y: e.clientY })}
                onClick={() => navigate(`/reports/${id}`)} />
            );
          }))}
        </div>
      </div>
      <div className="heat-rows" style={{ marginTop: 6 }}>
        <span />
        <div className="heat" style={{ gap: 3, gridTemplateColumns: `repeat(${reports.length}, minmax(0, 1fr))` }}>
          {reports.map((id, i) => (
            <span key={id} className="xs faint" style={{ textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible' }}>
              {i % labelEvery === 0 ? (labelEvery === 1 ? id.slice(4) : id) : ''}
            </span>
          ))}
        </div>
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
  if (metric === 'ownership') return [{ label: 'Owner present', color: `${c.unknown}55` }, { label: 'Missing (NaN)', color: c.ownership }, { label: 'ORPHANED_REPORT', color: c.refresh }];
  return LAT_ORDER.map((s) => ({ label: s === 'OK' ? 'OK ≤ 15 s' : s, color: c[SEVERITY_KEY[s]] }));
}

// Donut for part-to-whole (<= 6 parts): centre total and a value legend.
export function Donut({ parts, centerLabel, centerValue, format = (v) => fmt.num(v), size = 132 }) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 1;
  return (
    <div className="donut-wrap" style={{ gridTemplateColumns: `${size}px 1fr` }}>
      <div className="donut-box" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={parts} dataKey="value" nameKey="label" innerRadius={size * 0.34} outerRadius={size * 0.49} paddingAngle={2} cornerRadius={4} stroke="none" isAnimationActive={false}>
              {parts.map((p) => <Cell key={p.label} fill={p.fill ?? p.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }) => (active && payload?.length ? (
              <div className="tt"><div className="tt-row"><span><span className="sw" style={{ background: payload[0].payload.color }} />{payload[0].name}</span><b>{format(payload[0].value)}</b></div></div>) : null)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><b>{centerValue ?? format(total)}</b><span>{centerLabel}</span></div>
      </div>
      <div className="vlegend">
        {parts.map((p) => (
          <div key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b>{format(p.value)}</b><em>{((p.value / total) * 100).toFixed(0)}%</em></div>
        ))}
      </div>
    </div>
  );
}
