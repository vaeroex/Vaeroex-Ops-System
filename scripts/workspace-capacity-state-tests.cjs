/* eslint-disable @typescript-eslint/no-require-imports -- Local-only state harness contract tests. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CapacityState, createPlan, validatePlan, loopback, boundedMap } = require('./workspace-capacity-state.cjs');

test('small baseline retains target corpus and five active of ten registered per workspace', () => {
  const plan = createPlan({ activeUsers: 10 });
  assert.equal(plan.qualificationTarget, null); assert.equal(plan.workspaces.length, 2);
  assert.equal(plan.actors.length, 20); assert.equal(plan.actors.filter(a => a.active).length, 10);
  assert.equal(plan.corpus.activeFilesPerWorkspace, 200); assert.equal(plan.corpus.kpiObservationsPerWorkspace, 10000);
  assert.equal(plan.corpus.historyMonths, 24); assert.equal(plan.durationSeconds, 1500);
});
test('100/250/500 plans retain requested workspace and registered-user counts', () => {
  for (const activeUsers of [100, 250, 500]) { const plan = createPlan({ activeUsers }); validatePlan(plan); assert.equal(plan.workspaces.length, activeUsers / 5); assert.equal(plan.actors.length, activeUsers * 2); assert.equal(plan.qualificationTarget, activeUsers); }
});
test('unknown targets, shortened corpus, duplicate actors and role distribution are rejected', () => {
  assert.throws(() => createPlan({ activeUsers: 50 }));
  const p = createPlan(); p.corpus.kpiObservationsPerWorkspace = 9999; assert.throws(() => validatePlan(p));
  const q = createPlan(); q.actors[1].id = q.actors[0].id; assert.throws(() => validatePlan(q));
  const r = createPlan(); r.actors[1].role = 'owner'; assert.throws(() => validatePlan(r));
});
test('configuration requires literal loopback with explicit port and no query override', () => {
  assert.equal(loopback('https://127.0.0.1:4000', ['http:', 'https:']).protocol, 'https:');
  for (const u of ['https://example.invalid:443', 'http://localhost:4000', 'http://127.0.0.1', 'http://127.0.0.1:4000?override=1']) assert.throws(() => loopback(u, ['http:', 'https:']));
});
test('Auth token query and PostgREST filters are allowed only within exact local Supabase origin', async () => {
  const original = global.fetch, calls = [];
  global.fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{}'); };
  try {
    const state = new CapacityState({ runId: 'local-only', apiUrl: 'http://127.0.0.1:54321', dbUrl: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres', anonKey: 'synthetic', serviceKey: 'synthetic' }, createPlan(), '/tmp/vaeroex-capacity-unit');
    await state.safeFetch('http://127.0.0.1:54321/auth/v1/token?grant_type=password', { method: 'POST' });
    await state.safeFetch('http://127.0.0.1:54321/rest/v1/issues?select=id&workspace_id=eq.synthetic');
    assert.equal(calls.length, 2); assert(calls.every(c => c.options.redirect === 'error'));
    await assert.rejects(async () => state.safeFetch('http://127.0.0.1:54322/auth/v1/token?grant_type=password'));
    await assert.rejects(async () => state.safeFetch('https://example.invalid/auth/v1/token'));
  } finally { global.fetch = original; }
});
test('storage download concurrency is bounded and returned order is stable', async () => {
  let active = 0, peak = 0;
  const result = await boundedMap(Array.from({ length: 30 }, (_, i) => i), 4, async n => {
    active++; peak = Math.max(peak, active); await new Promise(r => setImmediate(r)); active--; return n * 2;
  });
  assert.equal(peak, 4); assert.equal(active, 0); assert.deepEqual(result, Array.from({ length: 30 }, (_, i) => i * 2));
});
test('missing process/build provenance cannot produce apparently ready telemetry', async () => {
  const state = new CapacityState({ runId: 'local-only', apiUrl: 'http://127.0.0.1:54321', dbUrl: 'postgresql://postgres:synthetic@127.0.0.1:54322/postgres', anonKey: 'synthetic', serviceKey: 'synthetic' }, createPlan(), '/tmp/vaeroex-capacity-unit');
  await assert.rejects(state.sampleTelemetry({}), /running_app_identity_required/);
});
