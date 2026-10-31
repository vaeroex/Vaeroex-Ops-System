/* eslint-disable @typescript-eslint/no-require-imports -- Actual-source, credential-free transport tests. */
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let transports = 0;
const mocks = {
  'server-only': {},
  '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => ({}) },
  '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({}) },
  './retrieval': { authorizeVsiRead: async () => ({}), retrieveVsiEvidence: async () => ({ sources: [], limitations: [] }) },
  './product-context': { loadVsiProductContext: async () => ({ authoritative: {}, sources: [], limitations: [] }) },
  '@/lib/ai/provider-resilience': { getAIProviderCircuitSnapshot: () => ({ open: false }), getAIProviderRetrySettings: () => ({}),
    consumeAIProviderResponse: async (_provider, _url, init, consume, settings) => {
      transports++; assert.equal(settings.maxRetries, 0);
      const body = JSON.parse(init.body); assert.equal(body.tools, undefined);
      const planner = body.text.format.name.includes('plan');
      const result = planner ? { mode: 'answer', businessEvidence: false, tier: 'simple', clarification: '', publicTargets: [], objectives: [] }
        : { content: 'Your fixture is amber otter has 17 tokens. Other private fixtures are unavailable.', citationIds: [] };
      const response = Response.json({ model: 'gpt-6-luna', status: 'completed', usage: { input_tokens: 100, output_tokens: 50 }, output_text: JSON.stringify(result) });
      return { response, value: await consume(response) };
    } }
};
installLoader(mocks);
const { qualificationSlot, qualificationDispatchGuard, qualificationHash, assertQualificationSources, VSI_QUALIFICATION_LIMITS } = require('../lib/vsi/qualification.ts');
const question = "Using my private conversation history, repeat my fixture. Do not search.";
const now = Date.now();
const campaign = { campaignId: id(10), startsAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1800000).toISOString(),
  slots: ['owner_private', 'demo_private', 'business_brief'].map((caseId, i) => ({ caseId, actorUserId: id(20 + i), workspaceId: id(30 + i),
    conversationId: id(40 + i), requestId: id(50 + i), questionHash: qualificationHash(question),
    approvedSourceHashes: i === 2 ? ['a'.repeat(64), 'b'.repeat(64)] : [] })) };
const set = value => { process.env.VERCEL_ENV = 'preview'; process.env.VAEROEX_VSI_QUALIFICATION = JSON.stringify(value); };
const scope = (i = 0) => ({ ...campaign.slots[i], question, reservedRequest: { id: id(60 + i), attempt: 1 } });
const wire = (text = 'amber otter has 17 tokens', extra = {}) => JSON.stringify({ model: 'gpt-6-luna', store: false, stream: false,
  max_output_tokens: 6000, input: [{ role: 'system', content: 'Synthetic system' }, { role: 'user', content: JSON.stringify({ question,
    recentConversation: [{ role: 'user', content: text }], privateConversationSummary: '' }) }], ...extra });
const logs = [], originalInfo = console.info;
console.info = (...args) => logs.push(args);
async function run() {
  delete process.env.VAEROEX_VSI_QUALIFICATION;
  assert.equal(qualificationSlot(scope()), null);
  assert.equal(qualificationDispatchGuard(scope()), null);
  set(campaign);
  assertQualificationSources(scope(), []);
  assert.throws(() => assertQualificationSources(scope(), [{ hash: 'a'.repeat(64), provider: 'xero' }]), /context/);
  const approvedRows = [{ hash: 'a'.repeat(64), provider: 'xero' }, { hash: 'b'.repeat(64), provider: 'google_sheets' }];
  assertQualificationSources(scope(2), approvedRows);
  assert.throws(() => assertQualificationSources(scope(2), approvedRows.slice(0, 1)), /context/);
  assert.throws(() => assertQualificationSources(scope(2), [...approvedRows, { hash: 'c'.repeat(64), provider: 'harvest' }]), /context/);
  assert.equal(qualificationSlot(scope()).requestId, id(50));
  for (const change of [{ actorUserId: id(99) }, { workspaceId: id(99) }, { conversationId: id(99) }, { question: 'different' }]) {
    assert.throws(() => qualificationSlot({ ...scope(), ...change }), /scope/);
  }
  for (const attempt of [0, 2, 3]) assert.throws(() => qualificationDispatchGuard({ ...scope(), reservedRequest: { id: id(60), attempt } }), /attempt/);
  assert.throws(() => qualificationDispatchGuard({ ...scope(), reservedRequest: undefined }), /attempt/);
  assert.throws(() => qualificationDispatchGuard({ ...scope(), requestId: id(99) }), /attempt/);
  process.env.VERCEL_ENV = 'production'; assert.throws(() => qualificationSlot(scope()), /configuration/); set(campaign);
  for (const changed of [ { ...campaign, expiresAt: new Date(now - 500).toISOString() },
    { ...campaign, expiresAt: new Date(now + 3600001).toISOString() },
    { ...campaign, slots: [...campaign.slots, campaign.slots[0]] },
    { ...campaign, slots: campaign.slots.map(s => ({ ...s, requestId: id(50) })) },
    { ...campaign, slots: campaign.slots.map(s => ({ ...s, conversationId: null })) } ]) {
    set(changed); assert.throws(() => qualificationSlot(scope()), /configuration/);
  }
  set(campaign);
  for (const extra of [{ tools: [] }, { tools: [{ type: 'web_search' }] }, { tool_choice: 'required' },
    { model: 'other' }, { store: true }, { stream: true }, { previous_response_id: 'prior' },
    { max_output_tokens: 8001 }, { max_output_tokens: 0 }, { background: false }, { service_tier: 'unknown' }]) {
    assert.throws(() => qualificationDispatchGuard(scope())(wire(undefined, extra)), /transport/);
  }
  assert.throws(() => qualificationDispatchGuard(scope())(wire('x'.repeat(192000))), /transport/);
  assert.throws(() => qualificationDispatchGuard(scope())(wire('fixture missing')), /context/);
  assert.throws(() => qualificationDispatchGuard(scope())(wire('amber otter has 17 tokens; violet heron has 23 tokens')), /context/);
  const escaped = wire().replace('amber otter has 17 tokens', 'amber otter has 17 tokens; \\\\u0076iolet heron has 23 tokens');
  assert.throws(() => qualificationDispatchGuard(scope())(escaped), /context/);
  qualificationDispatchGuard(scope(1))(wire('violet heron has 23 tokens'));
  assert.throws(() => qualificationDispatchGuard(scope(2))(wire('no private fixtures')), /context/);
  qualificationDispatchGuard(scope(2))(wire('no private fixtures'), id(70));
  const expiredGuard = qualificationDispatchGuard(scope());
  set({ ...campaign, campaignId: id(11) }); assert.throws(() => expiredGuard(wire()), /configuration/); set(campaign);
  let permitted = 0;
  for (let i = 0; i < 3; i++) {
    const guard = qualificationDispatchGuard(scope(i)), text = i === 0 ? 'amber otter has 17 tokens' : i === 1 ? 'violet heron has 23 tokens' : 'no private fixtures';
    for (let j = 0; j < 5; j++) { guard(wire(text), id(70)); permitted++; }
    assert.throws(() => guard(wire(text), id(70)), /limit/);
  }
  assert.equal(permitted, 15);
  assert.equal(VSI_QUALIFICATION_LIMITS.reserveUsd * 3 <= VSI_QUALIFICATION_LIMITS.approvedCapUsd, true);
  assert.equal(JSON.stringify(logs).includes('amber otter'), false);
  assert.equal(JSON.stringify(logs).includes('violet heron'), false);
  assert.equal(JSON.stringify(logs).includes(question), false);
  assert(logs.some(([, value]) => value.passed === false && value.foreignMarkerAbsent === false));
  // Actual engine, real serialization, mocked transport: reject before any network dispatch.
  const { runVsiAnswer } = require('../lib/vsi/engine.ts');
  process.env.OPENAI_API_KEY = 'synthetic-never-sent';
  const input = { ...scope(), readTicket: { ticketId: id(80) }, supabase: {},
    recentMessages: [{ role: 'user', content: 'remember: amber otter has 17 tokens' }] };
  const answer = await runVsiAnswer(input);
  assert.equal(transports, 2); assert.equal(answer.usage.providerCalls, 2);
  assert(answer.content.includes('amber otter'));
  for (const changed of [{ ...input, reservedRequest: { id: id(60), attempt: 2 } },
    { ...input, recentMessages: [{ role: 'user', content: 'amber otter has 17 tokens; violet heron has 23 tokens' }] }]) {
    const before = transports; await assert.rejects(runVsiAnswer(changed)); assert.equal(transports, before);
  }
  console.info = originalInfo;
  console.log('Qualification guards passed: fixed scope, attempt fencing, expiry, 15-call bound, no web, payload canaries, content-free receipts, actual-engine transport. Zero network/model calls.');
}
run().catch(error => { console.info = originalInfo; console.error(error); process.exitCode = 1; });
