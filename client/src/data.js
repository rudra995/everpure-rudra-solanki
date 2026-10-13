// Client-side aggregation of the snapshot matrix (/api/health/snapshots).
// Snapshots are numbered 1-20 per report (file order); the data has no dates, so
// every "by snapshot" chart is labelled by snapshot number, never by time.
const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

export function bySnapshot(rows) {
  const out = [];
  for (let seq = 1; seq <= 20; seq += 1) {
    const r = rows.filter((x) => x.snapshot_seq === seq);
    if (!r.length) continue;
    const count = (fn) => r.filter(fn).length;
    const hasCost = r.some((x) => x.credit_cost_usd !== undefined || x.aws_hosting_cost_usd !== undefined);
    out.push({
      seq,
      label: `#${seq}`,
      reports: r.length,
      avgLatency: sum(r.map((x) => x.avg_load_time_sec)) / r.length,
      breachRate: count((x) => x.avg_load_time_sec > 15) / r.length,
      WARNING: count((x) => x.latency_severity === 'WARNING'),
      HIGH: count((x) => x.latency_severity === 'HIGH'),
      CRITICAL: count((x) => x.latency_severity === 'CRITICAL'),
      FAILED: count((x) => x.last_refresh_status === 'FAILED'),
      TIMED_OUT: count((x) => x.last_refresh_status === 'TIMED_OUT'),
      UNKNOWN: count((x) => x.last_refresh_status === 'UNKNOWN'),
      failureRate: count((x) => ['FAILED', 'TIMED_OUT'].includes(x.last_refresh_status)) / r.length,
      views: sum(r.map((x) => x.monthly_active_views)),
      orphanNaN: count((x) => x.owner_missing),
      orphanSentinel: count((x) => x.owner_sentinel),
      ...(hasCost ? {
        snowflake: sum(r.map((x) => x.credit_cost_usd)),   // negative credits are NULL: excluded
        aws: sum(r.map((x) => x.aws_hosting_cost_usd)),
      } : {}),
    });
  }
  return out;
}

// Histogram of load times in 5-second bins, split by severity tier.
export function latencyHistogram(rows) {
  const bins = [];
  for (let lo = 0; lo < 55; lo += 5) bins.push({ bin: `${lo}–${lo + 5}s`, lo, OK: 0, WARNING: 0, HIGH: 0, CRITICAL: 0 });
  for (const r of rows) {
    const i = Math.min(Math.floor(Number(r.avg_load_time_sec) / 5), bins.length - 1);
    bins[i][r.latency_severity] += 1;
  }
  return bins;
}

// AWS cost per view for each snapshot, for the defect-4 scatter (views > 0 only).
export function awsPerView(rows) {
  return rows
    .filter((r) => r.monthly_active_views > 0 && r.aws_hosting_cost_usd !== undefined)
    .map((r) => ({
      report_id: r.report_id,
      seq: r.snapshot_seq,
      views: r.monthly_active_views,
      aws: Number(r.aws_hosting_cost_usd),
      perView: Number(r.aws_hosting_cost_usd) / r.monthly_active_views,
      outlier: Boolean(r.aws_cost_usage_mismatch),
    }));
}
