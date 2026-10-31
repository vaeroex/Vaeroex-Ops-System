/* eslint-disable @typescript-eslint/no-require-imports -- Actual HTTP route and guard; isolated ledger outcomes, no network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { z } = require('zod');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
installLoader({ 'server-only': {} });
const qualification = require('../lib/vsi/qualification.ts');
const question = 'Using my private conversation history, repeat my fixture. Do not search.';
const scope = { actorUserId: id(1), workspaceId: id(2), conversationId: id(3), requestId: id(4), questionHash: qualification.qualificationHash(question), approvedSourceHashes: [] };
const campaign = { campaignId: id(5), startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), slots: [
  { ...scope, caseId: 'owner_private' },
  { ...scope, actorUserId: id(6), requestId: id(7), conversationId: id(8), caseId: 'demo_private' },
  { ...scope, requestId: id(9), conversationId: id(10), caseId: 'business_brief', approvedSourceHashes: ['a'.repeat(64), 'b'.repeat(64)] }
] };
process.env.VERCEL_ENV = 'preview'; process.env.VAEROEX_VSI_QUALIFICATION = JSON.stringify(campaign);
let claim = 'reserved', attempt = 1, transports = 0, engineCalls = 0, mutations = [];
class VsiHttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
class VsiEngineError extends Error { constructor(cost = 0) { super('Synthetic bounded stop'); this.usage = { estimatedCostUsd: cost, providerCalls: cost ? 1 : 0 }; this.accountingUncertain = false; } }
const mocks = {
  'server-only': {}, zod: { z }, 'next/server': { NextResponse: { json: (body, opts) => Response.json(body, opts) } },
  '@/lib/vsi/qualification': qualification,
  '@/lib/vsi/config': { getVsiConfig: () => ({ maxQuestionChars: 8000, requestReserveUsd: 0.25, workspaceMonthlyBudgetUsd: 50 }) },
  '@/lib/vsi/request-boundary': { readVsiJson: req => req.json() },
  '@/lib/vsi/sensitive-input': { hasProhibitedVsiIdentifiers: () => false },
  '@/lib/security/rate-limit': { enforceRateLimit: async () => ({ allowed: true }) },
  '@/lib/integrations/google-sheets/read-authority': { beginGoogleSheetsRead: async () => ({ ticketId: id(11) }), bindGoogleSheetsRead: async () => ({}), googleSheetsReadSources: () => [] },
  '@/lib/vsi/engine': { VsiEngineError, runVsiAnswer: async input => {
    engineCalls++;
    try {
      const guard = qualification.qualificationDispatchGuard(input);
      guard(JSON.stringify({ model: 'gpt-6-luna', store: false, stream: false, max_output_tokens: 6000,
        input: [{ role: 'system', content: 'Synthetic' }, { role: 'user', content: JSON.stringify({ question,
          recentConversation: [{ role: 'user', content: 'amber otter has 17 tokens' }] }) }] }));
    } catch { throw new VsiEngineError(); }
    transports++; throw new VsiEngineError(0.01);
  } },
  '@/lib/vsi/storage': { VsiHttpError, vsiUuid: z.string().uuid(), questionHash: qualification.qualificationHash,
    requireVsiAccess: async () => ({ workspaceId: scope.workspaceId, userId: scope.actorUserId, canEditBusinessNotes: true }),
    loadVsiConversation: async () => ({ row: { context_summary: '', parent_conversation_id: null }, conversation: { id: scope.conversationId }, exchanges: [{ id: id(12) }] }),
    settleFailedVsi: async (_access, input) => mutations.push({ action: 'settle', input }),
    mutateVsi: async (_access, action, input) => {
      mutations.push({ action, input }); assert.equal(action, 'reserve');
      if (claim === 'pending') throw new VsiHttpError(409, 'in_progress', 'Already running');
      return { state: claim, request: { id: id(12), attempt } };
    }
  }
};
const source = ts.transpileModule(fs.readFileSync(require.resolve('../lib/vsi/http.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('exports', 'require', 'module', source)(loaded.exports, name => { assert(Object.hasOwn(mocks, name), name); return mocks[name]; }, loaded);
const call = clientId => loaded.exports.vsiRoute(new Request('https://preview.example.test/api/vsi/conversations/' + scope.conversationId + '/messages', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedWorkspaceId: scope.workspaceId, message: question, requestId: clientId })
}), 'messages', scope.conversationId);
async function run() {
  const old = console.info; console.info = () => {};
  assert.equal((await call(id(20))).status, 503); assert.equal(transports, 1);
  assert.equal(mutations[0].input.requestId, scope.requestId); assert.equal(mutations[0].input.reserveUsd, 0.572);
  // A failed or expired persisted request is attempt 2 even in a new worker.
  attempt = 2; mutations = [];
  assert.equal((await call(id(21))).status, 503); assert.equal(transports, 1);
  assert.equal(mutations[0].input.requestId, scope.requestId); assert.equal(mutations[1].input.usage.estimatedCostUsd, 0);
  claim = 'pending'; const before = engineCalls;
  assert.equal((await call(id(22))).status, 409); assert.equal(engineCalls, before);
  claim = 'completed'; const response = await call(id(23));
  assert.equal(response.status, 200); assert.equal((await response.json()).replayed, true); assert.equal(engineCalls, before);
  console.info = old;
  console.log('Qualification HTTP replay tests passed: different client IDs retain one fixed durable slot; pending/completed skip engine; attempt 2 has zero transport. Mock ledger outcomes, zero network/model calls.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
