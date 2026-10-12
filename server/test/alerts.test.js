// Alert rules (brief, Task 2) and the "whenever = no cooldown" guarantee.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, latencySeverity, alertStats, resetAlerts } from '../src/realtime/alerts.js';
import { setup } from './helpers.js';
import { step, status } from '../src/realtime/simulator.js';

const snap = (over) => ({ report_id: 'RPT_1', report_name: 'Dash 1', avg_load_time_sec: 5, last_refresh_status: 'SUCCESS', ...over });

describe('latency rule: "exceeds 15 seconds"', () => {
  for (const [sec, expected] of [[15.0, null], [15.1, 'WARNING'], [30.0, 'WARNING'], [30.1, 'HIGH'], [45.0, 'HIGH'], [45.1, 'CRITICAL'], [55.0, 'CRITICAL']]) {
    test(`${sec}s -> ${expected ?? 'no alert'}`, () => assert.equal(latencySeverity(sec), expected));
  }
});

describe('refresh rule: "automated refreshes fail"', () => {
  test('FAILED and TIMED_OUT alert', () => {
    assert.equal(evaluate(snap({ last_refresh_status: 'FAILED' }))[0].type, 'REFRESH_FAILURE');
    assert.equal(evaluate(snap({ last_refresh_status: 'TIMED_OUT' }))[0].type, 'REFRESH_FAILURE');
  });
  test('UNKNOWN and SUCCESS do not alert', () => {
    assert.equal(evaluate(snap({ last_refresh_status: 'UNKNOWN' })).length, 0);
    assert.equal(evaluate(snap({})).length, 0);
  });
  test('slow AND failed raises two alerts', () => {
    const types = evaluate(snap({ avg_load_time_sec: 50, last_refresh_status: 'FAILED' })).map((a) => a.type);
    assert.deepEqual(types.sort(), ['LATENCY_BREACH', 'REFRESH_FAILURE']);
  });
});

describe('full replay: every breach alerts, nothing suppressed', () => {
  before(async () => { await setup(); resetAlerts(); });

  test('one pass over 2,000 snapshots raises exactly 1,490 latency + 564 refresh alerts', () => {
    const total = status().total_snapshots;
    assert.equal(total, 2000);
    for (let i = 0; i < total; i++) step();
    const s = alertStats();
    // These equal the data-quality rule counts (latency_over_15s, refresh_failed):
    // proof that no alert was swallowed by a cooldown or dedup.
    assert.equal(s.LATENCY_BREACH, 1490);
    assert.equal(s.REFRESH_FAILURE, 564);
    assert.equal(s.total, 1490 + 564);
  });
});
