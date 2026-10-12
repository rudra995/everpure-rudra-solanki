// Alert rules (brief, Task 2): raise a real-time alert WHENEVER
//   - dashboard load latency exceeds 15 seconds, or
//   - an automated refresh fails (FAILED or TIMED_OUT).
//
// "Whenever" is taken literally: every breaching snapshot produces an alert. There is
// no cooldown and no suppression. Severity is a label to help people prioritise, it
// never hides anything. One snapshot can raise two alerts (slow AND failed).
//
// UNKNOWN refresh status is not a failure (decision in the validation report), so it
// does not alert.
import { config } from '../config.js';
import { bus, EVENTS } from './bus.js';
import { effectiveOwner } from '../services/ownership.js';

const { latencyThresholdSec, highSec, criticalSec, failureStatuses, historySize } = config.alerts;

const history = [];   // newest last, capped at historySize
let nextId = 1;
const counters = { total: 0, LATENCY_BREACH: 0, REFRESH_FAILURE: 0, WARNING: 0, HIGH: 0, CRITICAL: 0 };

export function latencySeverity(seconds) {
  if (seconds > criticalSec) return 'CRITICAL';
  if (seconds > highSec) return 'HIGH';
  if (seconds > latencyThresholdSec) return 'WARNING';
  return null; // no breach: exactly 15.0 s does NOT exceed 15 s
}

// Pure function: which alerts does this snapshot raise? (Unit-tested on its own.)
export function evaluate(snapshot) {
  const found = [];
  const latency = Number(snapshot.avg_load_time_sec);
  const sev = latencySeverity(latency);
  if (sev) {
    found.push({
      type: 'LATENCY_BREACH',
      severity: sev,
      metric: 'avg_load_time_sec',
      value: latency,
      threshold: latencyThresholdSec,
      message: `${snapshot.report_name} took ${latency}s to load (threshold ${latencyThresholdSec}s)`,
    });
  }
  if (failureStatuses.includes(snapshot.last_refresh_status)) {
    found.push({
      type: 'REFRESH_FAILURE',
      severity: 'HIGH',
      metric: 'last_refresh_status',
      value: snapshot.last_refresh_status,
      threshold: null,
      message: `${snapshot.report_name} refresh ${snapshot.last_refresh_status}`,
    });
  }
  return found;
}

// Evaluate, store and publish. Returns the alerts raised.
export function processSnapshot(snapshot) {
  const raised = evaluate(snapshot).map((a) => ({
    id: nextId++,
    ...a,
    report_id: snapshot.report_id,
    report_name: snapshot.report_name,
    owner: effectiveOwner(snapshot.report_id, snapshot.canonical_owner),
    snapshot_seq: snapshot.snapshot_seq,
    source_row: snapshot.source_row,
    created_at: new Date().toISOString(),
    acknowledged_by: null,
    acknowledged_at: null,
  }));
  for (const alert of raised) {
    history.push(alert);
    if (history.length > historySize) history.shift();
    counters.total += 1;
    counters[alert.type] += 1;
    counters[alert.severity] += 1;
    bus.emit(EVENTS.ALERT, alert);
  }
  return raised;
}

export function listAlerts({ limit = 200, type, severity, unacknowledged } = {}) {
  return history
    .filter((a) => (!type || a.type === type)
      && (!severity || a.severity === severity)
      && (!unacknowledged || !a.acknowledged_at))
    .slice(-limit)
    .reverse();
}

export function getAlert(id) {
  return history.find((a) => a.id === Number(id)) || null;
}

export function acknowledge(alert, user) {
  if (alert.acknowledged_at) return alert; // idempotent
  alert.acknowledged_by = user.email;
  alert.acknowledged_at = new Date().toISOString();
  bus.emit(EVENTS.ALERT_ACK, alert);
  return alert;
}

export function alertStats() {
  return { ...counters, in_memory: history.length, unacknowledged: history.filter((a) => !a.acknowledged_at).length };
}

export function resetAlerts() {
  history.length = 0;
  nextId = 1;
  for (const k of Object.keys(counters)) counters[k] = 0;
}
