// WebSocket delivery: authentication at handshake and per-role / per-owner routing.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, login } from './helpers.js';
import { attachSocket } from '../src/realtime/socket.js';
import { step } from '../src/realtime/simulator.js';

let server, url;
const tokens = {};
const clients = {};
const received = { admin: [], owner: [], viewer: [], finops: [] };
const telemetry = { admin: [], owner: [], viewer: [], finops: [] };

function open(token) {
  return new Promise((resolve, reject) => {
    const c = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    c.on('welcome', (w) => resolve({ c, w }));
    c.on('connect_error', (e) => reject(e));
  });
}

before(async () => {
  const app = await setup();
  server = http.createServer(app);
  attachSocket(server);
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
  for (const who of ['admin', 'owner', 'viewer', 'finops']) {
    tokens[who] = await login(who);
    const { c, w } = await open(tokens[who]);
    clients[who] = { c, welcome: w };
    c.on('alert', (a) => received[who].push(a));
    c.on('telemetry', (t) => telemetry[who].push(t));
  }
  // Replay 400 snapshots (snapshot 1-4 of every report) and let events flush.
  for (let i = 0; i < 400; i++) step();
  await new Promise((r) => setTimeout(r, 500));
});

after(() => {
  for (const { c } of Object.values(clients)) c.close();
  server.close();
});

describe('handshake', () => {
  test('connection without a token is refused', async () => {
    await assert.rejects(open(undefined), /unauthorized/);
  });
  test('connection with a forged token is refused', async () => {
    await assert.rejects(open('not.a.jwt'), /unauthorized/);
  });
});

describe('routing', () => {
  test('admin receives every alert', () => {
    assert.ok(received.admin.length > 0);
  });
  test('report owner receives only alerts for their own reports', () => {
    assert.ok(received.owner.length > 0);
    assert.ok(received.owner.length < received.admin.length);
    assert.ok(received.owner.every((a) => a.owner === 'user_3@company.com'));
  });
  test('viewer and finops receive no alerts', () => {
    assert.equal(received.viewer.length, 0);
    assert.equal(received.finops.length, 0);
  });
  test('viewer telemetry covers all reports but masks owner emails', () => {
    assert.equal(telemetry.viewer.length, 400);
    assert.ok(telemetry.viewer.every((t) => t.canonical_owner.startsWith('***@')));
  });
  test('admin telemetry has real emails; owner telemetry is own reports only', () => {
    assert.ok(telemetry.admin.every((t) => !t.canonical_owner.startsWith('***@')));
    assert.ok(telemetry.owner.length > 0 && telemetry.owner.every((t) => t.canonical_owner === 'user_3@company.com'));
  });
});
