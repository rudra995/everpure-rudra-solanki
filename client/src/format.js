// Number formatting used across the dashboard. Null/undefined render as an em dash,
// never as 0, so missing values (e.g. cost per view on a zero-view report) stay visible.
const dash = '—';
const ok = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

export const fmt = {
  num: (v, d = 0) => (ok(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : dash),
  usd: (v, d = 2) => (ok(v) ? `$${fmt.num(v, d)}` : dash),
  usdCompact: (v) => (ok(v) ? `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}` : dash),
  compact: (v) => (ok(v) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : dash),
  pct: (v, d = 0) => (ok(v) ? `${(Number(v) * 100).toFixed(d)}%` : dash),
  sec: (v) => (ok(v) ? `${Number(v).toFixed(1)}s` : dash),
  time: (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB') : dash),
  dateTime: (iso) => (iso ? new Date(iso).toLocaleString('en-GB') : dash),
};
