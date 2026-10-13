// Telemetry simulator. The case-study data is a static file, so "real-time" is simulated
// by replaying the cleaned snapshots one at a time, in time order: snapshot 1 of every
// report, then snapshot 2, and so on (same file-order assumption as the SQL suite).
// Each replayed snapshot is published as telemetry and run through the alert rules.
// After the last snapshot it loops, so a demo can run indefinitely.
import { db, SQL } from '../data/index.js';
import { bus, EVENTS } from './bus.js';
import { processSnapshot } from './alerts.js';

const state = {
  running: false,
  intervalMs: 1000,
  cursor: 0,
  cycle: 1,
  replayed: 0,
  rows: [],
  timer: null,
  latest: new Map(), // report_id -> last replayed snapshot (live health)
};

export async function loadReplay() {
  state.rows = await db.query(SQL.telemetryReplay);
  return state.rows.length;
}

// Replay exactly one snapshot. Exported so tests can step deterministically.
export function step() {
  if (!state.rows.length) return null;
  const snap = state.rows[state.cursor];
  const event = { ...snap, replayed_at: new Date().toISOString(), cycle: state.cycle };
  state.latest.set(snap.report_id, event);
  bus.emit(EVENTS.TELEMETRY, event);
  const alerts = processSnapshot(snap);

  state.replayed += 1;
  state.cursor += 1;
  if (state.cursor >= state.rows.length) {
    state.cursor = 0;
    state.cycle += 1;
    bus.emit(EVENTS.SIMULATOR, status());
  }
  return { snapshot: event, alerts };
}

export function start(intervalMs = state.intervalMs) {
  stop();
  state.intervalMs = Math.max(50, Number(intervalMs) || 1000);
  state.running = true;
  state.timer = setInterval(step, state.intervalMs);
  bus.emit(EVENTS.SIMULATOR, status());
  return status();
}

export function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.running) {
    state.running = false;
    bus.emit(EVENTS.SIMULATOR, status());
  }
  return status();
}

export function status() {
  return {
    running: state.running,
    interval_ms: state.intervalMs,
    position: state.cursor,
    total_snapshots: state.rows.length,
    cycle: state.cycle,
    replayed: state.replayed,
  };
}

export function liveHealth() {
  return [...state.latest.values()];
}
