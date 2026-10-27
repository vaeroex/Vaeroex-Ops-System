/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual projection, packing and renderer regression. */
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let networkAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('external_network_forbidden'); };
global.fetch = denyNetwork;
require('node:net').Socket.prototype.connect = denyNetwork;
let engineRaw = [], engineCalls = 0;
const actor = id(90), request = id(91), manifest = id(92);
const reader = { auth: {
  getUser: async () => ({ data: { user: { id: actor } }, error: null }),
  getClaims: async () => ({ data: { claims: { sub: actor, session_id: id(93) } }, error: null })
}, rpc: async (name, args) => {
  assert.equal(args.p_workspace_id, workspace);
  if (name === 'discover_shared_evidence_v1') return { data: { stage: 'catalog_only', candidates: engineRaw.map(row => ({ provider: row.data.provider, identity: row.identity })), truncated: false }, error: null };
  if (name === 'preview_shared_legacy_evidence_v1' || name === 'read_shared_typed_evidence_v1') return { data: { stage: 'unadmitted', resolved: structuredClone(name === 'preview_shared_legacy_evidence_v1' ? engineRaw[0] : engineRaw.find(row => row.identity.source_id === args.p_identity.source_id)) }, error: null };
  if (name === 'capture_legacy_evidence_v1') return { data: { reference_id: id(94), source_hash: engineRaw[0].hash }, error: null };
  if (name === 'shared_evidence_dependencies_v1') return { data: { manifestIds: [], readSources: [] }, error: null };
  if (name === 'seal_shared_evidence_manifest_v1') { assert.equal(args.p_sources.length, 3); return { data: { stage: 'database_bound', manifest_id: manifest, provider_policy_required: true }, error: null }; }
  if (name === 'validate_shared_evidence_manifest_v1') return { data: true, error: null };
  throw Error('unexpected_synthetic_rpc');
} };
installLoader({ 'server-only': {},
  '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
  '@/lib/ai/shared-evidence/qualitative-policy': { qualitativeSynthesisEnabled: () => true },
  './retrieval': { authorizeVsiRead: async () => ({ supabase: reader, workspaceId: workspace, user: { id: actor }, membership: { role: 'owner' }, workspace: { id: workspace, name: 'Synthetic workspace', industry: 'Synthetic operations' } }), retrieveVsiEvidence: async () => { throw Error('legacy_fallback_forbidden'); } },
  '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: true, status: 'active', source: 'subscription', plan_slug: 'vaeroex' }) },
  '@/lib/integrations/dashboard/server': { loadIntegrationDashboard: async () => ({ loadFailed: false, googleSheetsConnectionIds: [], dashboard: { workspaceId: workspace, observedAt: '2026-10-26T00:00:00Z', timeZone: 'UTC', timeZoneConfirmed: true, preferencesAvailable: true, unavailable: [], entries: [] } }) },
  '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => ({ ticketId: id(95) }) },
  '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({ Authorization: 'Bearer synthetic-no-access' }) },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw Error('production_client_forbidden'); } }
});
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { expandFactTimes } = require('../lib/ai/shared-evidence/fact-time.ts');
const { renderSharedAnswer } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { packVsiAnswerContext } = require('../lib/vsi/answer-context.ts');
const { withVsiSourceSnapshot } = require('../lib/vsi/research.ts');
const workspace = id(1), connection = id(2), entity = id(3);
const keys = ['invoices', 'billed', 'outstanding', 'bills', 'purchases'];
const metrics = (values, currency = 'USD') => keys.map((key, index) => ({ key, value: values[index], currency }));
const record = (n, day, values) => ({ key: ['xero', connection, id(n)], day, metrics: metrics(values) });
const raw = { identity: { kind: 'legacy_binding', binding_id: id(4), start: '2026-10-01', end: '2026-10-31' }, hash: 'a'.repeat(64), data: {
  provider: 'xero', workspace_id: workspace, entity_id: entity, connection_id: connection, time_zone: 'UTC',
  period_start: '2026-10-01', period_end: '2026-10-31', scope: 'synthetic stored records', read_sources: [], records: [
    record(10, '2026-10-13', [0, 0, 0, 1, 42]),
    record(11, '2026-10-13', [0, 0, 0, 1, 0]),
    record(12, '2026-10-14', [1, '120.50', '20.00', 0, 0]),
    record(13, '2026-10-15', [1, 0, 0, 0, 0]),
    record(14, '2026-10-15', [1, 240, 240, 0, 0])
  ]
} };
const original = JSON.stringify(raw), projected = sharedRow(raw, workspace);
assert.equal(projected.hash, raw.hash);
assert.deepEqual(projected.identity, raw.identity);
assert.equal(projected.facts.length, 25);
const times = expandFactTimes(projected.factTimes, projected.facts.length);
for (let row = 0; row < raw.data.records.length; row++) {
  const input = raw.data.records[row], family = row < 2 ? 'purchase-bill contribution' : 'sales-invoice contribution';
  input.metrics.forEach((metric, offset) => {
    const index = row * 5 + offset, count = ['invoices', 'bills'].includes(metric.key);
    const timing = metric.key === 'outstanding' ? '; balance at import; as-of unknown' : '';
    assert.equal(projected.facts[index], `${metric.key}: ${metric.value} ${count ? 'count (currency partition: USD)' : 'USD'}; ${family} dated ${input.day}${timing}.`);
    assert.deepEqual(times[index], { date: input.day, basis: 'invoice_or_bill_date', valueTiming: metric.key === 'outstanding' ? 'balance_at_import' : 'document_contribution' });
  });
}
assert.match(projected.facts[1], /billed: 0 USD; purchase-bill contribution/);
assert.match(projected.facts[16], /billed: 0 USD; sales-invoice contribution/);
assert.match(projected.facts[11], /billed: 120\.50 USD; sales-invoice contribution dated 2026-10-14/);
assert.match(projected.facts[21], /billed: 240 USD; sales-invoice contribution dated 2026-10-15/);

const projectMetrics = input => sharedRow({ ...raw, data: { ...raw.data, records: [{ day: '2026-10-13', metrics: input }] } }, workspace);
const ambiguous = [
  metrics([0, 0, 0, 0, 0]), metrics([1, 0, 0, 1, 0]), metrics([2, 0, 0, 0, 0]),
  metrics([0, 50, 20, 0, 0]),
  metrics([1, 0, 0, 0, 0]).filter(metric => metric.key !== 'invoices'),
  metrics([1, 0, 0, 0, 0]).filter(metric => metric.key !== 'bills'),
  [...metrics([1, 0, 0, 0, 0]), { key: 'invoices', value: 1, currency: 'USD' }],
  [...metrics([0, 0, 0, 1, 0]), { key: 'bills', value: 1, currency: 'USD' }],
  metrics([1, 0, 0, 0, 0]).map(metric => metric.key === 'bills' ? { ...metric, currency: 'EUR' } : metric),
  metrics([1, 0, 0, 0, 0]).map(metric => metric.key === 'billed' ? { ...metric, currency: 'EUR' } : metric)
];
for (const input of ambiguous) {
  const before = JSON.stringify(input), row = projectMetrics(input);
  assert.equal(row.facts.length, input.length);
  assert(row.facts.every(fact => fact.includes('; record contribution; invoice/bill date 2026-10-13')));
  assert.equal(JSON.stringify(input), before);
}
for (const [values, family] of [
  [['01.00', 0, 0, '-0.0', 0], 'sales-invoice'],
  [['0.00', 0, 0, '01.0', 0], 'purchase-bill']
]) assert(projectMetrics(metrics(values)).facts.every(fact => fact.includes(`; ${family} contribution dated`)));
let negativeCases = 0;
for (const values of [[-1, 0, 0, 0, 0], ['1.000000000000000000000001', 0, 0, 0, 0]]) {
  assert.throws(() => projectMetrics(metrics(values)), /invalid_metric_value/); negativeCases++;
}
assert.throws(() => sharedRow(raw, id(99)), /workspace_mismatch/); negativeCases++;
assert.throws(() => sharedRow({ ...raw, data: { ...raw.data, records: [{ snapshot: { start: '2026-10-13T00:00:00Z', end: '2026-10-13T00:00:00Z', metrics: metrics([1, 0, 0, 0, 0]) } }] } }, workspace), /invalid_metric/); negativeCases++;

const harvest = sharedRow({ ...raw, data: { ...raw.data, provider: 'harvest', records: [{ day: '2026-10-13', metrics: [{ key: 'hours', value: '1.25' }] }] } }, workspace);
assert.deepEqual(harvest.facts, ['harvest hours: 1.25 hours; entry spent date 2026-10-13. Scope: synthetic stored records.']);
const toggl = sharedRow({ ...raw, data: { ...raw.data, provider: 'toggl', records: [{ snapshot: { start: '2026-10-13T00:00:00Z', end: '2026-10-13T00:00:00Z', metrics: [{ key: 'projects', value: 1 }] } }] } }, workspace);
assert.deepEqual(toggl.facts, ['toggl projects: 1 count; snapshot 2026-10-13T00:00:00Z through 2026-10-13T00:00:00Z. Scope: synthetic stored records.']);
assert.equal(toggl.factTimes, undefined);
const sheet = (hash, n, input) => sharedRow({ identity: { kind: 'sheets_ticket_source', source_id: id(n), version_id: id(n + 1) }, hash,
  data: { provider: 'google_sheets', workspace_id: workspace, entity_id: entity, connection_id: id(n + 2), date: '2026-10-14', time_zone: 'UTC', metrics: input, read_sources: [] } }, workspace);
const small = sheet('b'.repeat(64), 20, [{ metric: 'dispatches', value: 6, unit: 'count' }]);
assert.deepEqual(small.facts, ['Google Sheets dispatches: 6 count, supplied row date 2026-10-14.']);
const large = sheet('c'.repeat(64), 30, Array.from({ length: 100 }, (_, index) => ({ metric: `Optional synthetic metric ${index} ${'x'.repeat(110)}`, value: 1, unit: 'count' })));
const rows = [projected, small, large];
const sources = rows.map((row, index) => ({ ref: `B${index + 1}`, binding: row.hash, dependencies: [row.hash], facts: row.facts, factTimes: row.factTimes, provider: row.provider, reported: false, environment: 'production' }));
const businessSources = rows.map((row, index) => withVsiSourceSnapshot({ id: sources[index].ref, title: row.provider, url: `/app/sources/${index}`, sourceType: `shared_${row.provider}`, sourceId: row.hash,
  evidenceDate: null, retrievedAt: '2026-10-26T00:00:00Z', text: JSON.stringify({ scope: row.scope, observations: row.facts, factTimes: row.factTimes }) }));
const payload = { question: 'Compare Xero invoices with Google Sheets dispatches', businessSources, qualitative_sources: sources };
const beforePacking = JSON.stringify(payload), packed = packVsiAnswerContext(payload, '', 16000, { selectRelevant: true }), wire = JSON.parse(packed.json);
assert.deepEqual(packed.sourceIds, ['B1', 'B2']);
assert(packed.initialMetrics.requestChars > 16000);
assert(packed.metrics.requestChars <= 16000);
assert.deepEqual(wire.qualitative_sources, sources.slice(0, 2));
assert.equal(JSON.stringify(payload), beforePacking);
assert.equal(wire.businessSources[0].snapshotHash, businessSources[0].snapshotHash);
assert.equal(JSON.parse(wire.businessSources[0].text).observationsRef, 'B1');
const context = { sources: sources.slice(0, 2), results: [], hypothesesEnabled: false, requiredSourceGroups: [] };
for (let factIndex = 0; factIndex < projected.facts.length; factIndex++) {
  const selection = { ref: 'B1', binding: projected.hash, factIndex };
  const answer = { observations: [selection], results: [], hypotheses: [], missing_information: [], next_checks: [] };
  const rendered = renderSharedAnswer(answer, context);
  assert(rendered.content.includes(projected.facts[factIndex]));
  assert.deepEqual(rendered.citationIds, ['B1']);
  assert.equal(wire.qualitative_sources[0].facts[factIndex], projected.facts[factIndex]);
}
assert.equal(JSON.stringify(raw), original);
assert.equal(networkAttempts, 0);
(async () => {
  // A full stored-source shape must fit admission, not merely a hand-built
  // packing fixture. Values and IDs are invented; no hosted snapshot is used.
  const full = structuredClone(raw);
  full.data.records = Array.from({ length: 27 }, (_, index) => ({ ...structuredClone(raw.data.records[index % 5]), key: ['xero', connection, id(100 + index)] }));
  const sheetRaw = (n, date) => ({ identity: { kind: 'sheets_ticket_source', source_id: id(200 + n), version_id: id(210 + n) }, hash: String(n + 1).repeat(64), data: {
    provider: 'google_sheets', workspace_id: workspace, entity_id: entity, connection_id: id(220), date, time_zone: 'UTC',
    metrics: [{ metric: 'Synthetic dispatches', value: 6, unit: 'count' }, { metric: 'Synthetic backlog', value: 4, unit: 'count' }], read_sources: []
  } });
  engineRaw = [full, sheetRaw(0, '2026-10-14'), sheetRaw(1, '2026-10-15')];
  const canonical = JSON.stringify(engineRaw), expected = engineRaw.map(row => sharedRow(row, workspace));
  const factChars = expected.reduce((sum, row) => sum + JSON.stringify(row.facts).length, 0);
  assert.equal(expected[0].facts.length, 135);
  assert(factChars <= 12000, 'all three full sources must fit the unchanged preparation budget');
  const { prepareSharedGeneration } = require('../lib/ai/shared-evidence/generation.ts');
  const prepared = await prepareSharedGeneration(reader, workspace, '2026-10-01', '2026-10-31');
  assert.equal(prepared.rows.length, 3);
  assert.deepEqual(prepared.rows[0].facts, expected[0].facts);
  process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '48000';
  process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS = '6000';
  const { runVsiAnswer } = require('../lib/vsi/engine.ts');
  let answerRequestChars = 0, answerRequestBytes = 0, retainedFacts = 0;
  const info = console.info;
  console.info = () => {};
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    engineCalls++;
    const body = JSON.parse(init.body), payload = JSON.parse(body.input[1].content);
    assert.equal(body.store, false); assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.tools, undefined);
    let answer;
    if (body.text.format.name === 'vsi_research_plan_v1') answer = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
    else {
      assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
      answerRequestChars = init.body.length; answerRequestBytes = Buffer.byteLength(init.body, 'utf8');
      assert(answerRequestChars <= 48000); assert(answerRequestBytes <= 192000);
      assert.equal(payload.businessSources.length, 3); assert.equal(payload.productSources.length, 6);
      for (const row of expected) {
        const source = payload.qualitative_sources.find(item => item.binding === row.hash);
        assert(source); assert.deepEqual(source.facts, row.facts); assert.deepEqual(source.factTimes, row.factTimes);
        retainedFacts += source.facts.length;
      }
      const xero = payload.qualitative_sources.find(item => item.binding === full.hash);
      const observations = payload.qualitative_sources.filter(item => item !== xero).map(item => ({ ref: item.ref, binding: item.binding, factIndex: 0 }));
      // Select meaningful dated invoices after the earlier opposite-family
      // zero fields, while retaining every one of the original 135 choices.
      for (const factIndex of [11, 21]) observations.push({ ref: xero.ref, binding: xero.binding, factIndex });
      answer = { observations, results: [], hypotheses: [], missing_information: [], next_checks: [] };
    }
    return new Response(JSON.stringify({ model: body.model, status: 'completed', usage: { input_tokens: 10, output_tokens: 10 }, output_text: JSON.stringify(answer) }), { status: 200 });
  };
  let result;
  try { result = await runVsiAnswer({ supabase: reader, workspaceId: workspace, actorUserId: actor, readTicket: { ticketId: id(95) }, question: 'Compare stored Xero invoice contributions and Google Sheets dispatches. No web research.', recentMessages: [], requestId: id(96), reservedRequest: { id: request, attempt: 1 } }); }
  finally { console.info = info; global.fetch = denyNetwork; }
  assert.equal(engineCalls, 2); assert.equal(retainedFacts, 139); assert.equal(result.citations.length, 3);
  assert.match(result.content, /billed: 120\.50 USD; sales-invoice contribution dated 2026-10-14/);
  assert.match(result.content, /billed: 240 USD; sales-invoice contribution dated 2026-10-15/);
  assert.equal(JSON.stringify(engineRaw), canonical);
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, xeroFacts: projected.facts.length, ambiguousMarkerCases: ambiguous.length,
    exactDecimalMarkerCases: 2, negativeCases, unchangedOtherProviderCases: 3, packedSourceGroups: packed.sourceIds.length,
    omittedWholeSourceGroups: packed.metrics.omittedSourceGroups, packedRequestChars: packed.metrics.requestChars,
    fullXeroRecords: 27, fullXeroFacts: 135, fullPreparedSourceGroups: prepared.rows.length, aggregateFactChars: factChars,
    actualEngineAnswerRequestChars: answerRequestChars, actualEngineAnswerRequestBytes: answerRequestBytes, actualEngineRetainedFacts: retainedFacts, mockedProviderCalls: engineCalls,
    everyXeroFactRenderedAtOriginalIndex: true, canonicalDataHashAndOrderPreserved: true, externalCalls: networkAttempts,
    limitation: 'Synthetic source shape proves representation and budget mechanics, not historical snapshot equivalence, model selection quality, comparable periods or completeness.' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
