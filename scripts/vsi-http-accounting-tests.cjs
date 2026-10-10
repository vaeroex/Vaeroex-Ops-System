/* eslint-disable @typescript-eslint/no-require-imports -- Run the real HTTP route with isolated dependencies, no network or database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { z } = require('zod');
const workspaceId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const reservationId = '44444444-4444-4444-8444-444444444444';
let nextFailure, mutations, engineCalls, accessChecks;
class VsiEngineError extends Error {
  constructor(usage, accountingUncertain = false) { super('Synthetic answer failure'); this.usage = usage; this.accountingUncertain = accountingUncertain; }
}
class VsiHttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const mocks = {
  'server-only': {},
  'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
  zod: { z },
  '@/lib/security/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  '@/lib/vsi/request-boundary': { readVsiJson: request => request.json() },
  '@/lib/vsi/sensitive-input': { hasProhibitedVsiIdentifiers: () => false },
  '@/lib/vsi/config': { getVsiConfig: () => ({ maxQuestionChars: 8000, requestReserveUsd: 0.25, workspaceMonthlyBudgetUsd: 50 }) },
  '@/lib/vsi/engine': { VsiEngineError, runVsiAnswer: async () => { engineCalls++; throw nextFailure; } },
  '@/lib/vsi/storage': {
    VsiHttpError, vsiUuid: z.string().uuid(), questionHash: () => 'synthetic-question-hash',
    requireVsiAccess: async (_request, expected) => { accessChecks++; assert.equal(expected, workspaceId); return { workspaceId, userId: 'synthetic-actor', canEditBusinessNotes: true }; },
    loadVsiConversation: async (_access, id) => { assert.equal(id, conversationId); return { row: { context_summary: '', parent_conversation_id: null }, exchanges: [] }; },
    mutateVsi: async (_access, action, input) => {
      mutations.push({ action, input });
      if (action === 'reserve') return { state: 'reserved', request: { id: reservationId, attempt: 2 } };
      assert.equal(action, 'settle'); return { state: 'settled' };
    }
  }
};
const source = ts.transpileModule(fs.readFileSync(require.resolve('../lib/vsi/http.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', source)(loaded.exports, name => {
  assert(Object.hasOwn(mocks, name), 'Unexpected route dependency: ' + name); return mocks[name];
}, loaded);
const { vsiRoute } = loaded.exports;
const usage = (cost, costEstimated = false) => ({ model: 'gpt-6-luna', inputTokens: 2300, outputTokens: 170,
  cachedInputTokens: 200, reasoningTokens: 20, providerCalls: 3, webSearchCalls: 2, retries: 0, latencyMs: 842,
  estimatedCostUsd: cost, costEstimated });
async function check(name, failure, expectedCost, estimated) {
  nextFailure = failure; mutations = []; engineCalls = 0; accessChecks = 0;
  const request = new Request('https://preview.example.test/api/vsi/conversations/' + conversationId + '/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://preview.example.test' },
    body: JSON.stringify({ expectedWorkspaceId: workspaceId, message: 'Synthetic question', requestId })
  });
  const response = await vsiRoute(request, 'messages', conversationId);
  assert.equal(response.status, 503, name);
  assert.equal((await response.json()).code, 'answer_unavailable');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(accessChecks, 1); assert.equal(engineCalls, 1);
  assert.deepEqual(mutations.map(item => item.action), ['reserve', 'settle']);
  assert.equal(mutations[0].input.reserveUsd, 0.25);
  assert.equal(mutations[0].input.monthlyBudgetUsd, 50);
  const settlement = mutations[1].input;
  assert.equal(settlement.id, reservationId); assert.equal(settlement.attempt, 2);
  assert.equal(settlement.usage.estimatedCostUsd, expectedCost, name);
  assert.equal(settlement.usage.costEstimated, estimated);
  assert.equal(settlement.usage.failed, true);
  assert.equal(settlement.answer, undefined, 'Failure cannot become an accepted answer');
  assert.equal(settlement.question, undefined, 'Failure does not persist a new transcript exchange');
  if (failure instanceof VsiEngineError) {
    assert.equal(settlement.usage.latencyMs, 842);
    assert.equal(settlement.usage.providerCalls, failure.usage.providerCalls);
    assert.equal(settlement.usage.inputTokens, failure.usage.inputTokens);
    assert.equal(settlement.usage.webSearchCalls, failure.usage.webSearchCalls);
  }
}
(async () => {
  await check('uncertainty preserves known spending above the reserve', new VsiEngineError(usage(0.32), true), 0.32, true);
  await check('uncertainty flag also preserves known spending above the reserve', new VsiEngineError(usage(0.32, true)), 0.32, true);
  await check('uncertainty below reserve retains the conservative floor', new VsiEngineError(usage(0.012), true), 0.25, true);
  await check('fully accounted failure charges only its observed usage', new VsiEngineError(usage(0.012)), 0.012, false);
  await check('known zero-cost rejection remains free', new VsiEngineError({ ...usage(0), inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, providerCalls: 0, webSearchCalls: 0 }), 0, false);
  await check('untyped failure reserves uncertain cost', new Error('Synthetic unexpected failure'), 0.25, true);
  const logs = [], originalError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    mocks['@/lib/security/rate-limit'].enforceRateLimit = async options => { assert.equal(options.strict, true); throw new Error('DO_NOT_LOG_PRIVATE_DETAILS'); };
    mutations = []; engineCalls = 0;
    const response = await vsiRoute(new Request('https://preview.example.test/api/vsi/conversations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedWorkspaceId: workspaceId })
    }), 'create');
    assert.equal(response.status, 503); assert.deepEqual(mutations, []); assert.equal(engineCalls, 0);
    assert.deepEqual(logs[0], ['[vsi-api]', { action: 'create', operation: 'strict_rate_limit' }]);
    assert(!JSON.stringify(logs).includes('DO_NOT_LOG_PRIVATE_DETAILS'));
    const config = logs[1][1];
    for (const [key, value] of Object.entries(config)) if (key !== 'supabaseProjectRef') assert.equal(typeof value, 'boolean');
  } finally { console.error = originalError; }
  const loadDiagnosticModule = (file, dependencies) => {
    const diagnosticModule = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', 'module', code)(diagnosticModule.exports, name => dependencies[name] || (name === 'zod' ? { z } : name === 'crypto' ? require('node:crypto') : {}), diagnosticModule);
    return diagnosticModule.exports;
  };
  const captured = [], oldError = console.error;
  console.error = (...args) => captured.push(args);
  try {
    const storage = loadDiagnosticModule('../lib/vsi/storage.ts', {});
    let code = 'PGRST205';
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() { return { error: { code, message: 'PRIVATE_RECORD', details: 'SECRET_DETAILS' } }; } };
    for (const expected of ['PGRST205', 'unknown']) {
      await assert.rejects(storage.listVsiConversations({ workspaceId, userId: 'PRIVATE_ACTOR', supabase: { from: table => { assert.equal(table, 'vsi_conversations'); return query; } } }), error => error.status === 503);
      assert.deepEqual(captured.pop(), ['[vsi-storage]', { operation: 'vsi_conversations.select', code: expected }]);
      code = 'PRIVATE_RECORD';
    }
    let admin = null;
    const rate = loadDiagnosticModule('../lib/security/rate-limit.ts', { '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin } });
    const options = { action: 'vsi.manage', strict: true, userId: 'PRIVATE_ACTOR', limit: 60, windowSeconds: 60, requestHeaders: new Headers() };
    await assert.rejects(rate.enforceRateLimit(options));
    assert.deepEqual(captured.pop(), ['[vsi-rate-limit]', { operation: 'createSupabaseAdminClient', code: 'configuration_missing' }]);
    admin = { rpc: name => { assert.equal(name, 'consume_request_rate_limit_v1'); return { maybeSingle: async () => ({ error: { code: 'PGRST202', message: 'SECRET_DETAILS' } }) }; } };
    await assert.rejects(rate.enforceRateLimit(options));
    assert.deepEqual(captured.pop(), ['[vsi-rate-limit]', { operation: 'consume_request_rate_limit_v1', code: 'PGRST202' }]);
    admin = { rpc: () => ({ maybeSingle: async () => ({ data: null }) }) };
    await assert.rejects(rate.enforceRateLimit(options));
    assert.deepEqual(captured.pop(), ['[vsi-rate-limit]', { operation: 'consume_request_rate_limit_v1', code: 'empty_result' }]);
    assert.equal(captured.length, 0);
  } finally { console.error = oldError; }
  console.log(JSON.stringify({ passed: true, suite: 'VSI HTTP failed-answer accounting preserves known cost and reservation floor', scenarios: 6, paidProviderCalls: 0, databaseCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
