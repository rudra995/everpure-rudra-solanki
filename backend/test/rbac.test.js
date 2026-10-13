// Proves the access-control matrix is enforced by the SERVER, role by role.
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, login, api } from './helpers.js';
import { listAudit } from '../src/audit/auditLog.js';

let app;
const tokens = {};
before(async () => {
  app = await setup();
  for (const who of ['admin', 'finops', 'owner', 'viewer']) tokens[who] = await login(who);
});

const MASKED = /^\*\*\*@/;

describe('authentication', () => {
  test('no token -> 401', async () => {
    assert.equal((await request(app).get('/api/health/summary')).status, 401);
  });
  test('forged token -> 401', async () => {
    const res = await request(app).get('/api/health/summary').set('authorization', 'Bearer abc.def.ghi');
    assert.equal(res.status, 401);
  });
  test('wrong password -> 401 with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@company.com', password: 'nope' });
    assert.equal(res.status, 401);
    assert.equal(res.body.message, 'Email or password is incorrect');
  });
  test('/me returns role and server-computed permissions', async () => {
    const res = await api.get(tokens.finops, '/api/auth/me');
    assert.equal(res.body.user.role, 'finops_analyst');
    assert.ok(res.body.user.permissions.includes('cost:read:all'));
    assert.ok(!res.body.user.permissions.includes('pii:read'));
  });
});

describe('Business Viewer: health only', () => {
  test('can read health, owner emails masked', async () => {
    const res = await api.get(tokens.viewer, '/api/health/reports');
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 100);
    assert.ok(res.body.reports.every((r) => MASKED.test(r.canonical_owner)));
  });
  for (const url of ['/api/cost/summary', '/api/cost/reports', '/api/orphaned', '/api/alerts', '/api/data-quality/summary', '/api/audit']) {
    test(`denied ${url} -> 403`, async () => {
      assert.equal((await api.get(tokens.viewer, url)).status, 403);
    });
  }
  test('report drill-down has no cost and no snapshots', async () => {
    const res = await api.get(tokens.viewer, '/api/reports/RPT_200');
    assert.equal(res.status, 200);
    assert.equal(res.body.cost, undefined);
    assert.equal(res.body.snapshots, undefined);
  });
  test('denials are written to the audit log', () => {
    const denied = listAudit({ event: 'access.denied' }).filter((e) => e.actor?.role === 'business_viewer');
    assert.ok(denied.length >= 6);
  });
});

describe('FinOps Analyst: all cost, no personal data, no actions', () => {
  test('platform unit cost = Snowflake credit cost per active view', async () => {
    const res = await api.get(tokens.finops, '/api/cost/summary');
    assert.equal(res.status, 200);
    assert.ok(Math.abs(res.body.summary.credit_cost_per_view_usd - 2.429756) < 1e-6);
  });
  test('sees all 100 reports with cost, emails masked', async () => {
    const res = await api.get(tokens.finops, '/api/cost/reports');
    assert.equal(res.body.count, 100);
    assert.ok(res.body.reports.every((r) => r.credits_valid !== undefined && MASKED.test(r.canonical_owner)));
  });
  test('showback emails masked', async () => {
    const res = await api.get(tokens.finops, '/api/cost/showback');
    assert.ok(res.body.owners.every((o) => MASKED.test(o.canonical_owner)));
  });
  test('data-quality summary yes, row-level issue log no', async () => {
    assert.equal((await api.get(tokens.finops, '/api/data-quality/summary')).status, 200);
    assert.equal((await api.get(tokens.finops, '/api/data-quality/issues')).status, 403);
  });
  test('cannot read alerts or control the simulator', async () => {
    assert.equal((await api.get(tokens.finops, '/api/alerts')).status, 403);
    assert.equal((await api.post(tokens.finops, '/api/simulator/start')).status, 403);
  });
});

describe('Report Owner: own reports only (row-level)', () => {
  test('cost list contains only reports they own', async () => {
    const res = await api.get(tokens.owner, '/api/cost/reports');
    assert.equal(res.status, 200);
    assert.equal(res.body.scope, 'own');
    assert.equal(res.body.count, 12); // same 12 as Snowflake's row access policy test (09)
    assert.ok(res.body.reports.every((r) => r.canonical_owner === 'user_3@company.com'));
  });
  test('health is scoped to own reports too', async () => {
    const res = await api.get(tokens.owner, '/api/health/summary');
    assert.equal(res.body.summary.reports, 12);
  });
  test('opening someone else\'s report -> 403', async () => {
    const own = (await api.get(tokens.owner, '/api/cost/reports')).body.reports.map((r) => r.report_id);
    const other = ['RPT_200', 'RPT_201', 'RPT_202', 'RPT_203'].find((id) => !own.includes(id));
    assert.equal((await api.get(tokens.owner, `/api/reports/${other}`)).status, 403);
  });
  test('own report drill-down includes cost and 20 snapshots', async () => {
    const id = (await api.get(tokens.owner, '/api/cost/reports')).body.reports[0].report_id;
    const res = await api.get(tokens.owner, `/api/reports/${id}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.cost.credits_valid !== undefined);
    assert.equal(res.body.snapshots.length, 20);
  });
  test('platform-wide cost summary is not theirs to see', async () => {
    assert.equal((await api.get(tokens.owner, '/api/cost/summary')).status, 403);
  });
});

describe('Platform Admin', () => {
  for (const url of ['/api/cost/summary', '/api/cost/showback', '/api/orphaned', '/api/alerts',
                     '/api/data-quality/summary', '/api/data-quality/issues', '/api/audit']) {
    test(`allowed ${url}`, async () => {
      assert.equal((await api.get(tokens.admin, url)).status, 200);
    });
  }
  test('reconciliation checks served by the API all pass', async () => {
    const res = await api.get(tokens.admin, '/api/data-quality/summary');
    assert.equal(res.body.reconciliation_passed, true);
  });
});

describe('orphaned reports + claim -> approve review gate', () => {
  test('summary matches the cleaning counts', async () => {
    const res = await api.get(tokens.admin, '/api/orphaned');
    assert.equal(res.body.summary.orphaned_records, 245);
    assert.equal(res.body.summary.missing_email_records, 128);
    assert.equal(res.body.summary.sentinel_records, 117);
    assert.equal(res.body.summary.reports_currently_orphaned, 14);
  });

  test('full flow: request, duplicate blocked, owner cannot approve, admin approves, access follows', async () => {
    const list = (await api.get(tokens.owner, '/api/orphaned')).body.reports;
    // A currently orphaned report the owner does NOT already own
    const target = list.find((r) => r.report_currently_orphaned && r.canonical_owner !== 'user_3@company.com');
    assert.ok(target, 'need a claimable report');

    const before = (await api.get(tokens.owner, '/api/cost/reports')).body.count;

    const created = await api.post(tokens.owner, `/api/orphaned/${target.report_id}/claims`, { reason: 'I rebuilt this dashboard last quarter' });
    assert.equal(created.status, 201);
    assert.equal(created.body.claim.status, 'PENDING');

    const dup = await api.post(tokens.owner, `/api/orphaned/${target.report_id}/claims`, { reason: 'again please' });
    assert.equal(dup.status, 409);

    const selfApprove = await api.post(tokens.owner, `/api/orphaned/claims/${created.body.claim.id}/approve`);
    assert.equal(selfApprove.status, 403);

    const approved = await api.post(tokens.admin, `/api/orphaned/claims/${created.body.claim.id}/approve`, { note: 'verified with team lead' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.claim.status, 'APPROVED');

    const after = (await api.get(tokens.owner, '/api/cost/reports')).body;
    assert.equal(after.count, before + 1);
    assert.ok(after.reports.some((r) => r.report_id === target.report_id && r.owner_reassigned));
  });

  test('cannot claim a report that is not currently orphaned', async () => {
    const health = (await api.get(tokens.admin, '/api/health/reports')).body.reports;
    const notOrphaned = health.find((r) => !r.currently_orphaned);
    const res = await api.post(tokens.owner, `/api/orphaned/${notOrphaned.report_id}/claims`, { reason: 'trying anyway' });
    assert.equal(res.status, 409);
  });
});

describe('snapshot matrix (heatmap + per-snapshot charts)', () => {
  test('admin gets all 2,000 snapshots with Snowflake and AWS cost', async () => {
    const res = await api.get(tokens.admin, '/api/health/snapshots');
    assert.equal(res.body.count, 2000);
    assert.ok(res.body.snapshots.every((s) => 'aws_hosting_cost_usd' in s && 'credit_cost_usd' in s));
  });
  test('viewer gets all snapshots but no cost columns and masked owners', async () => {
    const res = await api.get(tokens.viewer, '/api/health/snapshots');
    assert.equal(res.body.count, 2000);
    assert.ok(res.body.snapshots.every((s) => !('aws_hosting_cost_usd' in s) && !('credit_cost_usd' in s) && !('credits_clean' in s)));
    assert.ok(res.body.snapshots.every((s) => MASKED.test(s.canonical_owner)));
  });
  test('report owner gets only the 20 snapshots of each report they own', async () => {
    const own = (await api.get(tokens.owner, '/api/health/reports')).body.count;
    const res = await api.get(tokens.owner, '/api/health/snapshots');
    assert.equal(res.body.count, own * 20);
    assert.ok(res.body.snapshots.every((s) => s.canonical_owner === 'user_3@company.com'));
  });
});

describe('error codes', () => {
  test('errors thrown by the ownership service use the standard codes', async () => {
    const res = await api.post(tokens.admin, '/api/orphaned/claims/999999/approve');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
  });
});
