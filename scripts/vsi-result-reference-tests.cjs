/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual engine with synthetic authority and provider responses. */
const assert = require('node:assert/strict');
const path = require('node:path');
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let networkAttempts = 0;
require('node:net').Socket.prototype.connect = () => { networkAttempts++; throw Error('external_network_forbidden'); };
const ActualDate = Date;
global.Date = class extends ActualDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-27T05:00:00Z'])); }
  static now() { return new ActualDate('2026-10-27T05:00:00Z').getTime(); }
};
const workspace = id(1), actor = id(2), session = id(3), request = id(4), ticket = id(5), manifest = id(6), entity = id(7), connection = id(8);
const metricKeys = ['invoices', 'billed', 'outstanding', 'bills', 'purchases'];
const contributions = [[0, 0, 0, 1, 42], [0, 0, 0, 1, 0], [1, '120.50', '20.00', 0, 0], [1, 0, 0, 0, 0], [1, 240, 240, 0, 0]];
const xero = { identity: { kind: 'legacy_binding', binding_id: id(9), start: '2026-09-28', end: '2026-10-27' }, hash: 'a'.repeat(64), data: {
  provider: 'xero', workspace_id: workspace, entity_id: entity, connection_id: connection, time_zone: 'UTC', period_start: '2026-09-28', period_end: '2026-10-27', scope: 'connected_account', read_sources: [],
  records: Array.from({ length: 27 }, (_, n) => ({ key: ['xero', connection, id(100 + n)], day: n % 5 < 2 ? '2026-10-13' : n % 5 === 2 ? '2026-10-14' : '2026-10-15', metrics: metricKeys.map((key, k) => ({ key, value: contributions[n % 5][k], currency: 'USD' })) }))
} };
const sheet = n => ({ identity: { kind: 'sheets_ticket_source', source_id: id(200 + n), version_id: id(210 + n) }, hash: String(n + 1).repeat(64), data: {
  provider: 'google_sheets', workspace_id: workspace, entity_id: n < 2 ? entity : id(300 + n), connection_id: n < 2 ? id(220) : id(230 + n), date: n % 2 ? '2026-10-15' : '2026-10-14', time_zone: 'UTC',
  metrics: n < 2 ? [{ metric: 'Synthetic dispatches', value: 6, unit: 'count' }, { metric: 'Synthetic backlog', value: 4, unit: 'count' }]
    : [{ metric: n === 2 ? 'Legacy dispatch operational checklist' : 'Archive equipment register review', value: 1, unit: 'count' }], read_sources: []
} });
const raw = [xero, sheet(0), sheet(1), sheet(2), sheet(3)], originalRaw = JSON.stringify(raw);
let foreign = false, revoked = false, revokeAfterPlanner = false, replyVariant = 'valid', providerCalls = 0, answerCalls = 0;
const sealedCounts = [], measurements = [], diagnostics = [];
const reader = { auth: {
  getUser: async () => ({ data: { user: { id: actor } }, error: null }),
  getClaims: async () => ({ data: { claims: { sub: actor, session_id: session } }, error: null })
}, rpc: async (name, args) => {
  assert.equal(args.p_workspace_id, workspace);
  if (name === 'discover_shared_evidence_v2') return { data: require('./shared-discovery-test-support.cjs').completeCatalog(raw.map(row => ({ provider: row.data.provider, identity: row.identity }))), error: null };
  if (name === 'preview_shared_legacy_evidence_v1' || name === 'read_shared_typed_evidence_v1') {
    const source = structuredClone(name === 'preview_shared_legacy_evidence_v1' ? xero : raw.find(row => row.identity.source_id === args.p_identity.source_id));
    if (foreign) source.data.workspace_id = id(999);
    return { data: { stage: 'unadmitted', resolved: source }, error: null };
  }
  if (name === 'capture_legacy_evidence_v1') return { data: { reference_id: id(40), source_hash: xero.hash }, error: null };
  if (name === 'shared_evidence_dependencies_v1') return { data: { manifestIds: [], readSources: [] }, error: null };
  if (name === 'seal_shared_evidence_manifest_v1') {
    assert.equal(args.p_actor_user_id, undefined); assert.equal(args.p_target_id, request);
    sealedCounts.push(args.p_sources.length); assert.equal(args.p_sources.length, 5);
    return { data: { stage: 'database_bound', manifest_id: manifest, provider_policy_required: true }, error: null };
  }
  if (name === 'validate_shared_evidence_manifest_v1') return { data: !revoked, error: revoked ? { code: '42501' } : null };
  throw Error(`unexpected_synthetic_rpc:${name}`);
} };
installLoader({ 'server-only': {},
  '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
  '@/lib/ai/shared-evidence/qualitative-policy': { qualitativeSynthesisEnabled: () => true },
  './retrieval': { authorizeVsiRead: async () => ({ supabase: reader, workspaceId: workspace, user: { id: actor }, membership: { role: 'owner' }, workspace: { id: workspace, name: 'Synthetic review workspace', industry: 'Synthetic operations' } }), retrieveVsiEvidence: async () => { throw Error('legacy_fallback_forbidden'); } },
  '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: true, status: 'active', source: 'subscription', plan_slug: 'vaeroex' }) },
  '@/lib/integrations/dashboard/server': { loadIntegrationDashboard: async () => ({ loadFailed: false, googleSheetsConnectionIds: [], dashboard: { workspaceId: workspace, observedAt: '2026-10-27T00:00:00Z', timeZone: 'UTC', timeZoneConfirmed: true, preferencesAvailable: true, unavailable: [], entries: Array.from({ length: 4 }, (_, n) => ({ key: `google_sheets:${String(n + 1).repeat(64)}`, provider: 'Google Sheets', name: `Synthetic saved connection ${n}`, href: '/app/integrations', connectionState: 'connected', lastSuccessfulRefreshAt: '2026-10-14T00:00:00Z', currentUntil: '2026-10-27T00:00:00Z', freshness: 'current', unchangedCheck: false, cadence: 'Manual', results: [], hidden: false })) } }) },
  '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => ({ ticketId: ticket }) },
  '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({ Authorization: 'Bearer synthetic-result-reference-no-access' }) },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw Error('real_admin_client_forbidden'); } }
});
const generation = require('../lib/ai/shared-evidence/generation.ts');
const contract = require('../lib/ai/shared-evidence/answer-contract.ts');
const packing = require('../lib/vsi/answer-context.ts');
const { withVsiSourceSnapshot } = require('../lib/vsi/research.ts');
const baseSchema = JSON.stringify(contract.sharedAnswerJsonSchema), originalPack = packing.packVsiAnswerContext;
packing.packVsiAnswerContext = (payload, ...args) => {
  const before = JSON.stringify(payload), result = originalPack(payload, ...args);
  assert.equal(JSON.stringify(payload), before, 'packing must preserve the full canonical input');
  measurements.push({ canonical: structuredClone(payload), ...result }); return result;
};
// The stricter source-specific schema cannot fit this fixture at 45k; that
// deliberately smaller budget must reject before transport. The
// 47k test budget retains all three required originals and their facts while
// omitting both optional groups (four groups measure 47,549 characters). It
// remains below the unchanged production 48k limit.
// This is not a reconstruction of the hosted request's contents.
process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '45000';
process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS = '6000';
process.env.VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD = '50';
process.env.VAEROEX_VSI_REQUEST_RESERVE_USD = '0.25';
process.env.OPENAI_API_KEY = 'synthetic-unused-global';
const { runVsiAnswer } = require('../lib/vsi/engine.ts');
const info = console.info, error = console.error;
console.info = (...args) => { if (args[0] !== '[vsi-context-budget]') info(...args); };
console.error = (...args) => { if (args[0] === '[vsi-validation]') diagnostics.push(args[1]); else if (args[0] !== '[vsi-context-budget]') error(...args); };
let lastAnswerRequest, mockFailure;
global.fetch = async (url, init) => {
 try {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.Authorization, 'Bearer synthetic-result-reference-no-access');
  providerCalls++;
  const body = JSON.parse(init.body), payload = JSON.parse(body.input[1].content);
  assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.model, 'gpt-6-luna');
  let answer;
  if (body.text.format.name === 'vsi_research_plan_v1') {
    answer = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
    if (revokeAfterPlanner) revoked = true;
  } else {
    answerCalls++; lastAnswerRequest = structuredClone(body);
    assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
    assert.equal(payload.businessSources.length, 3, `hosted-shaped fixture packs five admitted originals into three model originals: ${measurements.at(-1).metrics.requestChars}`);
    assert.equal(payload.contextCoverage.omittedSourceGroups, 2);
    assert.deepEqual(new Set(payload.qualitative_sources.map(source => source.binding)), new Set(raw.slice(0, 3).map(source => source.hash)), 'full Xero and both relevant dispatch/backlog originals remain selected');
    assert.deepEqual(payload.sharedRelationships, []);
    assert.equal(body.text.format.schema.properties.results.maxItems, 0, 'no application result can be selected when none was issued');
    const m = measurements.at(-1);
    assert.equal(init.body.length, m.metrics.requestChars, 'actual serialized request includes final result-specific schema');
    assert.equal(Buffer.byteLength(init.body, 'utf8'), m.metrics.requestBytes);
    assert(init.body.length <= 47000); assert(m.metrics.requestBytes <= 192000);
    assert.equal(m.canonical.businessSources.length, 5); assert.equal(m.canonical.qualitative_sources.length, 5);
    assert.equal(payload.productSources.length, 6, 'exercise real product-context producer');
    for (const source of payload.qualitative_sources) {
      const canonical = m.canonical.qualitative_sources.find(s => s.ref === source.ref);
      assert.deepEqual(source, canonical, 'no selected original facts, typed dates or bindings shortened');
    }
    const selectedXero = payload.qualitative_sources.find(s => s.binding === xero.hash);
    assert.equal(selectedXero.facts.length, 135);
    const observations = payload.qualitative_sources.map(source => ({ ref: source.ref, binding: source.binding, factIndex: source === selectedXero ? 11 : 0 }));
    answer = { observations, results: [], hypotheses: [], missing_information: [{ kind: 'selected_fact_time_comparison', premises: observations }], next_checks: [] };
    const providerSchemaAccepts = ajv.compile(body.text.format.schema);
    assert(providerSchemaAccepts(answer), 'valid empty result answer satisfies actual transmitted schema');
    if (replyVariant === 'unissued') answer.results = ['f'.repeat(64)];
    if (replyVariant === 'duplicate_unissued') answer.results = ['f'.repeat(64), 'f'.repeat(64)];
    if (['unissued', 'duplicate_unissued'].includes(replyVariant)) {
      assert.equal(ajv.compile(JSON.parse(baseSchema))(answer), true, 'the former static result schema admitted this unavailable selection');
      assert.equal(providerSchemaAccepts(answer), false, 'provider schema prevents this selection, but mocked noncompliance still reaches runtime rejection');
    }
    if (replyVariant === 'omitted_original') {
      const missing = m.canonical.qualitative_sources.find(s => !payload.qualitative_sources.some(p => p.ref === s.ref));
      answer.observations.push({ ref: missing.ref, binding: missing.binding, factIndex: 0 });
    }
  }
  return new Response(JSON.stringify({ model: body.model, status: 'completed', usage: { input_tokens: 100, output_tokens: 20 }, output_text: JSON.stringify(answer) }), { status: 200 });
 } catch (e) { mockFailure = e; throw e; }
};
const input = { supabase: reader, workspaceId: workspace, actorUserId: actor, readTicket: { ticketId: ticket }, question: 'Using stored Xero invoice contributions and synthetic Google Sheets dispatch and backlog observations, give a hypothetical executive brief. No web research.', recentMessages: [], requestId: id(50), reservedRequest: { id: request, attempt: 1 } };
async function rejected(variant, rule) {
  replyVariant = variant; const before = providerCalls, count = diagnostics.length;
  await assert.rejects(() => runVsiAnswer(input));
  assert.equal(providerCalls - before, 2, 'no provider retry or output salvage');
  assert.equal(diagnostics.length, count + 1); assert.equal(diagnostics.at(-1).contractRule, rule);
  if (rule === 'result_reference') assert.deepEqual(diagnostics.at(-1).resultReference, { reason: variant === 'unissued' ? 'unknown_selected_id' : 'duplicate_selected_id', issuedCount: 0, selectedCount: variant === 'unissued' ? 1 : 2 });
}
function packedRelationshipChecks() {
  const source = (n, provider, fact) => {
    const hash = String(n).repeat(64), scope = { entityId: id(600 + n), connectionId: id(700 + n), entityBinding: 'protected', start: '2026-10-14', end: '2026-10-14', timeZone: 'UTC', currency: 'USD', coverage: 'unknown' };
    return { business: withVsiSourceSnapshot({ id: `B${n}`, title: provider, url: `/app/synthetic/${n}`, sourceType: `shared_${provider}`, sourceId: hash, evidenceDate: null, retrievedAt: '2026-10-27T00:00:00Z', text: JSON.stringify({ scope, observations: [fact] }) }), premise: { ref: `B${n}`, binding: hash, dependencies: [hash], facts: [fact], reported: false, environment: 'production', provider } };
  };
  const rows = [source(1, 'square', 'Synthetic payment observed.'), source(2, 'quickbooks_online', 'Synthetic accounting observation.'), source(3, 'harvest', 'Synthetic recorded time. ' + 'Unselected archived context. '.repeat(180)), source(4, 'clockify', 'Synthetic running time. ' + 'Unselected archived context. '.repeat(180))];
  const issued = contract.issueAnswerResults([{ fact: 'The supplied payment and accounting observations must not be added as independent revenue.', inputSourceIds: rows.slice(0, 2).map(r => r.premise.binding) }, { fact: 'The supplied time records do not prove a complete labor total.', inputSourceIds: rows.slice(2).map(r => r.premise.binding) }]);
  const payload = { question: 'Compare stored Square and QuickBooks observations.', businessSources: rows.map(r => r.business), qualitative_sources: rows.map(r => r.premise), sharedRelationships: issued, evidenceLimitations: [] };
  const canonical = JSON.stringify(payload);
  const requestJSON = json => packing.serializeVsiProviderRequest({ input: [{ role: 'system', content: 'Synthetic contract test.' }, { role: 'user', content: json }], text: { format: { type: 'json_schema', name: 'vsi_shared_answer_v2', strict: true, schema: contract.sharedAnswerJsonSchemaForResults(JSON.parse(json).sharedRelationships, true) } } }, 4000);
  const packed = originalPack(payload, 'Synthetic contract test.', 12000, { selectRelevant: true, maxBytes: 192000, requestJSON });
  const view = JSON.parse(packed.json), body = JSON.parse(requestJSON(packed.json));
  assert.equal(view.businessSources.length, 2); assert.equal(view.sharedRelationships.length, 1);
  const hashes = new Set(payload.businessSources.filter(s => packed.sourceIds.includes(s.id)).map(s => s.sourceId));
  const validatorResults = payload.sharedRelationships.filter(r => r.inputSourceIds.every(h => hashes.has(h)));
  assert.deepEqual(view.sharedRelationships, validatorResults);
  assert.deepEqual(body.text.format.schema.properties.results.items.enum, validatorResults.map(r => r.id));
  assert.equal(body.text.format.schema.properties.results.maxItems, 1);
  assert.equal(requestJSON(packed.json).length, packed.metrics.requestChars);
  assert.equal(JSON.stringify(payload), canonical, 'omitted dependency group remains in canonical payload');
  const observations = view.qualitative_sources.map(s => ({ ref: s.ref, binding: s.binding, factIndex: 0 }));
  const answer = { observations, results: [issued[0].id], hypotheses: [], missing_information: [], next_checks: [] };
  const providerSchemaAccepts = ajv.compile(body.text.format.schema);
  assert(providerSchemaAccepts(answer));
  assert.equal(providerSchemaAccepts({ ...answer, results: [issued[1].id] }), false, 'packed-out result cannot enter generated output');
  assert.equal(providerSchemaAccepts({ ...answer, results: [rows[0].premise.binding] }), false, 'source bindings are not issued result IDs');
  const context = { sources: view.qualitative_sources, results: validatorResults, hypothesesEnabled: true };
  const rendered = contract.renderSharedAnswer(answer, context);
  assert.match(rendered.content, /must not be added as independent revenue/); assert.deepEqual(new Set(rendered.citationIds), new Set(['B1', 'B2']));
  assert.throws(() => contract.renderSharedAnswer({ ...answer, results: [issued[1].id] }, context), e => e.rule === 'result_reference');
  assert.throws(() => contract.renderSharedAnswer({ ...answer, results: [issued[0].id, issued[0].id] }, context), e => e.rule === 'result_reference');
  assert.throws(() => contract.renderSharedAnswer({ ...answer, observations: observations.slice(0, 1) }, { ...context, requiredRefs: ['B1'] }), e => e.rule === 'result_dependencies');
  assert.throws(() => contract.renderSharedAnswer(answer, { ...context, sources: view.qualitative_sources.map((s, i) => i ? { ...s, environment: 'sandbox', installation: 'synthetic-other-installation' } : s) }), e => e.rule === 'environment');
  assert.equal(JSON.stringify(contract.sharedAnswerJsonSchema), baseSchema, 'factory cannot mutate the reusable schema');
  const emptyAgain = contract.sharedAnswerJsonSchemaForResults([], false);
  assert.equal(emptyAgain.properties.results.maxItems, 0);
  assert.equal(emptyAgain.properties.results.items.enum, undefined, 'later empty request cannot inherit a prior issued ID');
  return { selected: view.sharedRelationships.length, omitted: issued.length - view.sharedRelationships.length };
}
(async () => {
  const expectedRows = raw.map(row => generation.sharedRow(row, workspace));
  const prepared = await generation.prepareSharedGeneration(reader, workspace, '2026-09-28', '2026-10-27');
  assert.equal(prepared.rows.length, 5); assert.deepEqual(prepared.relationships, []);
  assert.deepEqual(prepared.rows.map(r => r.facts), expectedRows.map(r => r.facts));
  await assert.rejects(() => runVsiAnswer(input), e => e.usage.outcomeFailure === 'context_block' && !e.accountingUncertain);
  assert.equal(providerCalls, 0, 'insufficient 45k budget fails before any provider call');
  assert.equal(answerCalls, 0); assert.equal(JSON.stringify(raw), originalRaw);
  process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '47000';
  const result = await runVsiAnswer(input);
  assert.equal(providerCalls, 2); assert.equal(answerCalls, 1); assert.equal(result.citations.length, 3);
  assert.match(result.content, /^Coverage: This is a partial review/);
  for (const citation of result.citations) {
    const canonical = measurements.at(-1).canonical.businessSources.find(s => s.sourceId === citation.sourceId);
    assert(canonical); assert.equal(citation.snapshotHash, canonical.snapshotHash); assert.equal(citation.url, canonical.url);
  }
  assert.equal(lastAnswerRequest.text.format.schema.properties.results.maxItems, 0);
  await rejected('unissued', 'result_reference'); await rejected('duplicate_unissued', 'result_reference'); await rejected('omitted_original', 'fact_reference');
  const beforeForeign = providerCalls; foreign = true;
  await assert.rejects(() => runVsiAnswer(input), e => e.usage.outcomeFailure === 'evidence_unavailable'); assert.equal(providerCalls, beforeForeign); foreign = false;
  const beforeRevoke = providerCalls; replyVariant = 'valid'; revokeAfterPlanner = true;
  await assert.rejects(() => runVsiAnswer(input), e => e.usage.outcomeFailure === 'evidence_unavailable'); assert.equal(providerCalls - beforeRevoke, 1); revoked = false; revokeAfterPlanner = false;
  const relationships = packedRelationshipChecks();
  // Fault injection at the application result issuer must fail in preflight,
  // before even the planner can use the provider. No real source is changed.
  const originalIssuer = contract.issueAnswerResults;
  try {
    for (const [reason, results] of [
      ['invalid_issued_id', [{ id: 'DO_NOT_LOG_SECRET', fact: 'Synthetic invalid issued result.', inputSourceIds: [xero.hash] }]],
      ['duplicate_issued_id', Array.from({ length: 2 }, () => ({ id: 'f'.repeat(64), fact: 'Synthetic duplicate issued result.', inputSourceIds: [xero.hash] }))]
    ]) {
      contract.issueAnswerResults = () => results;
      const before = providerCalls;
      await assert.rejects(() => runVsiAnswer(input), e => e.usage.outcomeFailure === 'evidence_unavailable' && !e.accountingUncertain);
      assert.equal(providerCalls, before);
      assert.equal(diagnostics.at(-1).stage, 'answer_request_contract');
      assert.deepEqual(diagnostics.at(-1).resultReference, { reason, issuedCount: results.length, selectedCount: 0 });
    }
  } finally { contract.issueAnswerResults = originalIssuer; }
  assert.equal(JSON.stringify(raw), originalRaw); assert(sealedCounts.every(n => n === 5));
  assert.equal(JSON.stringify(contract.sharedAnswerJsonSchema), baseSchema); assert.equal(networkAttempts, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /synthetic-result-reference-no-access|120\.50|DO_NOT_LOG|[a-f0-9]{64}/, 'diagnostics contain no credentials, facts or result/source IDs');
  console.info = info; console.error = error;
  console.log(JSON.stringify({ passed: true, actualEngineAdmitted: 5, modelViewSelected: 3, omitted: 2, bothRelevantSheetsOriginalsSelected: true, fullXeroRecords: 27, fullXeroFacts: 135, emptyResultSchema: true, actualRequestSchemaValidated: true, insufficient45000BudgetDeniedBeforeTransport: true, syntheticMaxChars: 47000, requestChars: measurements.at(-1).metrics.requestChars, requestBytes: measurements.at(-1).metrics.requestBytes, malformedMockStillFailsClosed: true, exactSerializedBudget: true, canonicalRetention: true, wrongWorkspaceAndRevocationDenied: true, nonemptyRelationshipGroups: relationships, providerCallsMocked: providerCalls, externalCalls: networkAttempts, liveModelQualityProved: false }));
})().catch(e => { console.info = info; console.error = error; console.error((mockFailure || e).stack); process.exitCode = 1; });
