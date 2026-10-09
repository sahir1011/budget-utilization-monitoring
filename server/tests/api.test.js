// End-to-end API tests against an in-memory MongoDB seeded with the real reference data.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;
let server;
let base;
const tokens = {};

async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('bums-test');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
  const { createApp } = require('../app');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const [k, email, pw] of [
    ['admin', 'admin@example.com', 'Admin@12345'],
    ['finance', 'finance@example.com', 'Finance@12345'],
    ['head', 'head.mojs@example.com', 'Head@12345'],
  ]) {
    const r = await api('POST', '/auth/login', { body: { email, password: pw } });
    assert.equal(r.status, 200, `login ${email}`);
    tokens[k] = r.data.token;
  }
});

test.after(async () => {
  server && server.close();
  await mongoose.disconnect();
  mongod && (await mongod.stop());
});

test('rejects bad credentials and operator injection', async () => {
  assert.equal((await api('POST', '/auth/login', { body: { email: 'admin@example.com', password: 'nope' } })).status, 401);
  assert.equal((await api('POST', '/auth/login', { body: { email: { $gt: '' }, password: 'x' } })).status, 400);
  assert.equal((await api('GET', '/dashboard')).status, 401);
});

test('dashboard totals equal the sum of published BE 2026-27 allocations', async () => {
  const { FY27 } = require('../seed/data');
  const expected = FY27.reduce((a, l) => a + l[3], 0) * 10_000_000;
  const r = await api('GET', '/dashboard?fy=2026-27', { token: tokens.finance });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.allocated, expected);
  const deptSum = r.data.byDepartment.reduce((a, d) => a + d.allocated, 0);
  assert.equal(deptSum, expected);
  const spentSum = r.data.byDepartment.reduce((a, d) => a + d.spent, 0);
  assert.equal(spentSum, r.data.summary.spent);
});

test('closed FY 2025-26 spend equals published RE exactly', async () => {
  const r = await api('GET', '/budgets?fy=2025-26', { token: tokens.finance });
  const jjm = r.data.items.find((b) => b.code === 'MOJS-JJM-2526');
  assert.equal(jjm.metrics.spent, 17000 * 10_000_000);
  assert.equal(jjm.metrics.utilization, 25.37);
  assert.equal(jjm.metrics.health, 'UNDER_UTILIZED');
});

test('monitoring engine raised the expected alert types', async () => {
  const r = await api('GET', '/alerts/stats', { token: tokens.admin });
  for (const t of ['UNDER_UTILIZATION', 'OVERSPENDING', 'SPIKE']) assert.ok(r.data.byType[t] > 0, `expected ${t} alerts`);
});

test('department head is restricted to own department', async () => {
  const r = await api('GET', '/budgets', { token: tokens.head });
  assert.ok(r.data.items.length > 0);
  assert.ok(r.data.items.every((b) => b.department.code === 'MOJS'));
  const all = await api('GET', '/budgets', { token: tokens.finance });
  const foreign = all.data.items.find((b) => b.department.code === 'MOD');
  assert.equal((await api('GET', `/budgets/${foreign.id}`, { token: tokens.head })).status, 403);
  assert.equal((await api('POST', '/budgets', { token: tokens.head, body: {} })).status, 403);
  assert.equal((await api('GET', '/users', { token: tokens.finance })).status, 403);
  assert.equal((await api('GET', '/audit-logs', { token: tokens.head })).status, 403);
});

test('budget lifecycle: create, record expenditure, overspend alert, audit trail', async () => {
  const depts = await api('GET', '/departments', { token: tokens.admin });
  const mojs = depts.data.items.find((d) => d.code === 'MOJS');
  const create = await api('POST', '/budgets', {
    token: tokens.finance,
    body: { code: 'MOJS-TEST-Q3', title: 'Test quarterly allocation', department: mojs.id, financialYear: '2026-27', periodType: 'QUARTERLY', quarter: 2, allocatedAmount: 100 * 10_000_000, allocationDate: '2026-07-01' },
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  assert.equal(create.data.periodStart, '2026-06-30T18:30:00.000Z'); // 1 Jul 2026, 00:00 IST

  const form = new FormData();
  form.append('budget', create.data.id);
  form.append('amount', String(120 * 10_000_000));
  form.append('category', 'Capital Works');
  form.append('date', '2026-08-10');
  form.append('description', 'Test payment');
  form.append('documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'sanction.pdf');
  const res = await fetch(`${base}/expenditures`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.head}` }, body: form });
  const exp = await res.json();
  assert.equal(res.status, 201, JSON.stringify(exp));
  assert.equal(exp.documents.length, 1);

  const detail = await api('GET', `/budgets/${create.data.id}`, { token: tokens.head });
  assert.equal(detail.data.budget.metrics.utilization, 120);
  assert.ok(detail.data.alerts.some((a) => a.type === 'OVERSPENDING' && a.severity === 'CRITICAL'));

  // Out-of-period date rejected
  const bad = new FormData();
  for (const [k, v] of Object.entries({ budget: create.data.id, amount: '100', category: 'Other', date: '2026-12-10', description: 'x' })) bad.append(k, v);
  const badRes = await fetch(`${base}/expenditures`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.finance}` }, body: bad });
  assert.equal(badRes.status, 400);

  // Allocation revision requires a reason
  assert.equal((await api('PATCH', `/budgets/${create.data.id}`, { token: tokens.finance, body: { allocatedAmount: 150 * 10_000_000 } })).status, 400);
  const rev = await api('PATCH', `/budgets/${create.data.id}`, { token: tokens.finance, body: { allocatedAmount: 150 * 10_000_000, revisionReason: 'Supplementary grant' } });
  assert.equal(rev.status, 200);
  const after = await api('GET', `/budgets/${create.data.id}`, { token: tokens.finance });
  assert.equal(after.data.budget.metrics.utilization, 80);
  assert.ok(after.data.alerts.find((a) => a.type === 'OVERSPENDING').status === 'RESOLVED');

  const logs = await api('GET', '/audit-logs?entity=Budget', { token: tokens.admin });
  assert.ok(logs.data.items.some((l) => l.action === 'UPDATE' && l.changes && l.changes.allocatedAmount));
});

test('alert workflow and threshold configuration', async () => {
  const list = await api('GET', '/alerts?status=OPEN', { token: tokens.head });
  assert.ok(list.data.items.length > 0);
  const id = list.data.items[0].id;
  assert.equal((await api('PATCH', `/alerts/${id}/acknowledge`, { token: tokens.head, body: { note: 'Looking into it' } })).status, 200);
  assert.equal((await api('PATCH', `/alerts/${id}/resolve`, { token: tokens.head, body: {} })).status, 400);
  assert.equal((await api('PATCH', `/alerts/${id}/resolve`, { token: tokens.head, body: { note: 'Releases resumed' } })).status, 200);

  assert.equal((await api('PUT', '/settings/thresholds', { token: tokens.finance, body: {} })).status, 403);
  const cur = await api('GET', '/settings/thresholds', { token: tokens.admin });
  const next = JSON.parse(JSON.stringify(cur.data.value));
  next.inactivity.days = 45;
  const put = await api('PUT', '/settings/thresholds', { token: tokens.admin, body: next });
  assert.equal(put.status, 200);
  assert.equal(put.data.value.inactivity.days, 45);
});

test('reports export CSV and PDF', async () => {
  const csv = await api('GET', '/reports/export?type=department-summary&format=csv&fy=2026-27', { token: tokens.finance, raw: true });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.ok(text.includes('Ministry of Defence'));
  const pdf = await api('GET', '/reports/export?type=budgets&format=pdf&fy=2026-27', { token: tokens.head, raw: true });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});
