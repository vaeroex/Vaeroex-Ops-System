/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic invoice-selection, request-schema and rendering regression. */
const assert = require('node:assert/strict'), path = require('node:path');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
let engineReader;
installLoader({ 'server-only': {},
 '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => true },
 '@/lib/ai/shared-evidence/qualitative-policy': { qualitativeSynthesisEnabled: () => true },
 './retrieval': { authorizeVsiRead: async () => ({ supabase: engineReader, workspaceId: workspace, user: { id: id(500) }, membership: { role: 'owner' }, workspace: { id: workspace, name: 'Synthetic invoice fixture', industry: 'Synthetic operations' } }), retrieveVsiEvidence: async () => { throw Error('legacy_fallback_forbidden'); } },
 '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: true, status: 'active', source: 'subscription', plan_slug: 'vaeroex' }) },
 '@/lib/integrations/dashboard/server': { loadIntegrationDashboard: async () => ({ loadFailed: false, googleSheetsConnectionIds: [], dashboard: { workspaceId: workspace, observedAt: '2026-10-27T00:00:00Z', timeZone: 'UTC', timeZoneConfirmed: true, preferencesAvailable: true, unavailable: [], entries: [] } }) },
 '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => ({ ticketId: id(501) }) },
 '@/lib/ai/providers/google-data-policy': { googleSheetsOpenAIHeaders: async () => ({ Authorization: 'Bearer synthetic-invoice-selection-no-access' }) },
 '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw Error('real_admin_forbidden'); } }
});
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error('network_forbidden'); };
global.fetch = deny; require('node:net').Socket.prototype.connect = deny;
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { invoiceSelections } = require('../lib/ai/shared-evidence/invoice-selection.ts');
const { sharedAnswerJsonSchemaForResults, sharedAnswerJsonSchema, renderSharedAnswer } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { packVsiAnswerContext, serializeVsiProviderRequest } = require('../lib/vsi/answer-context.ts');
const { withVsiSourceSnapshot } = require('../lib/vsi/research.ts');
const workspace = id(1), entity = id(2), connection = id(3);
const keys = ['invoices', 'billed', 'outstanding', 'bills', 'purchases'];
const metrics = (values, currency = 'USD') => keys.map((key, index) => ({ key, value: values[index], currency }));
const rawFor = records => ({ identity: { kind: 'legacy_binding', binding_id: id(4), start: '2026-09-28', end: '2026-10-27' }, hash: 'a'.repeat(64), data: {
  provider: 'xero', workspace_id: workspace, entity_id: entity, connection_id: connection, scope: 'synthetic stored records', time_zone: 'UTC', period_start: '2026-09-28', period_end: '2026-10-27', read_sources: [], records
} });
const record = (n, date, values, currency = 'USD') => ({ key: ['xero', connection, id(100 + n)], day: date, metrics: metrics(values, currency) });
// Reproduce only the audited 27-record family/date/zero-pattern. All identifiers
// and positive amounts below are newly invented. No private receipt is loaded.
const shape = [
 ['10-06',0,1,0],['10-05',1,0,1],['10-11',0,1,0],['10-01',0,1,0],['10-02',0,1,0],
 ['10-03',1,0,0],['10-13',0,1,0],['09-29',0,1,0],['10-11',0,1,0],['10-10',0,1,0],
 ['10-08',1,0,0],['10-11',0,1,0],['10-14',0,0,0],['10-13',0,1,0],['10-13',0,1,0],
 ['10-12',1,0,1],['10-15',1,0,1],['10-14',1,0,1],['10-03',1,0,0],['10-16',0,1,0],
 ['10-14',0,0,0],['10-11',1,0,0],['10-01',0,1,0],['10-09',0,1,0],['10-11',1,0,0],
 ['10-14',0,1,0],['10-13',1,0,1]
];
const raw = rawFor(shape.map(([day, invoices, bills, outstanding], n) => record(n, `2026-${day}`, [invoices, invoices ? (n + 1) * 10 : 0, outstanding ? (n + 1) * 10 : 0, bills, bills ? (n + 1) * 3 : 0])));
const sheet = (n, date, dispatches, backlog) => ({ identity: { kind: 'sheets_ticket_source', source_id: id(300 + n), version_id: id(310 + n) }, hash: String(n + 1).repeat(64), data: {
 provider: 'google_sheets', workspace_id: workspace, entity_id: entity, connection_id: id(320), time_zone: 'UTC', date,
 metrics: [{ metric: 'Synthetic dispatches', value: dispatches, unit: 'count' }, { metric: 'Synthetic backlog', value: backlog, unit: 'count' }], read_sources: []
} });
const originals = [raw, sheet(0, '2026-10-14', 6, 4), sheet(1, '2026-10-15', 4, 7)], originalJSON = JSON.stringify(originals);
const rows = originals.map(value => sharedRow(value, workspace));
const sourceFor = (row, n) => ({ ref: `B${n + 1}`, binding: row.hash, dependencies: [row.hash], facts: row.facts, factTimes: row.factTimes,
 ...(row.salesInvoiceFactGroups ? { salesInvoiceFactGroups: row.salesInvoiceFactGroups } : {}), reported: false, provider: row.provider, environment: 'production' });
const sources = rows.map(sourceFor), question = 'Using stored Xero sales-invoice contributions for billing/collections and Google Sheets dispatch/backlog observations, give a hypothetical executive brief.';
const descriptors = values => values.map(source => ({ ref: source.ref, binding: source.binding, supportOnly: source.supportOnly === true }));
const policies = invoiceSelections(sources, question), policy = policies[0];
assert.equal(rows[0].facts.length, 135); assert.equal(rows[0].salesInvoiceFactGroups.length, 10);
assert.deepEqual(policy.eligible, shape.flatMap(([, invoices], n) => invoices ? [n * 5, n * 5 + 1, n * 5 + 2] : []));
assert.deepEqual(policy.reviewFirst, [[80, 81, 82], [85, 86, 87], [130, 131, 132]], 'dated invoice groups for peer row dates first; then newest eligible invoice');
assert(!policy.eligible.includes(31)); assert(!policy.eligible.includes(61)); assert(!policy.eligible.includes(101));
assert(policy.eligible.includes(86)); assert(policy.eligible.includes(131));
assert.match(rows[0].facts[31], /purchase-bill contribution/); assert.match(rows[0].facts[61], /record contribution; invoice\/bill date/);
let cases = 0;
function eligibleFor(records) { const row = sharedRow(rawFor(records), workspace); return { row, policy: invoiceSelections([sourceFor(row, 0)], question)[0] }; }
for (const values of [[1, 0, 0, 0, 0], ['1', '0.00', '0.00', '0', 0]]) {
 const result = eligibleFor([record(40, '2026-10-14', values)]);
 assert.deepEqual(result.policy.eligible, [0, 1, 2], 'family markers, not nonzero monetary value, establish invoice eligibility'); cases++;
}
for (const values of [[0, 0, 0, 1, 50], [0, 0, 0, 0, 0], [1, 25, 5, 1, 10], [2, 25, 5, 0, 0]]) {
 assert.deepEqual(eligibleFor([record(41, '2026-10-14', values)]).policy.eligible, []); cases++;
}
for (const values of [[1,-25,-5,0,0],[-1,25,5,0,0]]) { assert.throws(() => eligibleFor([record(49,'2026-10-14',values)]), /invalid_metric_value/); cases++; }
const mixed = record(42, '2026-10-14', [1, 25, 5, 0, 0]); mixed.metrics[1].currency = 'EUR';
assert.deepEqual(eligibleFor([mixed]).policy.eligible, [], 'mixed-currency markers cannot issue a typed invoice group'); cases++;
const missingMarker = record(43, '2026-10-14', [1, 25, 5, 0, 0]); missingMarker.metrics.pop(); missingMarker.metrics = missingMarker.metrics.filter(m => m.key !== 'bills');
assert.deepEqual(eligibleFor([missingMarker]).policy.eligible, []); cases++;
const duplicateMarker = record(44, '2026-10-14', [1, 25, 5, 0, 0]); duplicateMarker.metrics.push({ key: 'invoices', value: 1, currency: 'USD' });
assert.deepEqual(eligibleFor([duplicateMarker]).policy.eligible, []); cases++;
const duplicates = eligibleFor([record(45, '2026-10-14', [1, 0, 0, 0, 0]), record(46, '2026-10-14', [1, 0, 0, 0, 0])]);
assert.deepEqual(duplicates.row.salesInvoiceFactGroups, [[0,1,2],[5,6,7]]); assert.equal(duplicates.row.facts[1], duplicates.row.facts[6]); cases++;
// Currency partitions are retained separately, never aggregated or converted.
const separateCurrencies = eligibleFor([record(47, '2026-10-14', [1, 0, 0, 0, 0], 'USD'), record(48, '2026-10-14', [1, 0, 0, 0, 0], 'EUR')]);
assert.deepEqual(separateCurrencies.policy.eligible, [0,1,2,5,6,7]); assert.match(separateCurrencies.row.facts[5], /currency partition: EUR/); cases++;
for (const neutral of ['Review stored Xero and Google Sheets observations.', 'Compare sales invoices and purchases.', 'Review supplier invoices.', 'Compare receivables and payables.']) { assert.deepEqual(invoiceSelections(sources, neutral), []); cases++; }
// Date proximity is guidance, not an authorization restriction or forced claim.
assert(policy.eligible.includes(6), 'older eligible invoice remains selectable');
const differentEntitySheet = { ...sources[1], factTimes: sources[1].factTimes };
assert.deepEqual(invoiceSelections([sources[0], differentEntitySheet], question)[0].reviewFirst[0], [85,86,87]);
const baseSchema = JSON.stringify(sharedAnswerJsonSchema), schema = sharedAnswerJsonSchemaForResults([], true, policies, sources.map(s => s.ref), descriptors(sources));
const accepts = ajv.compile(schema);
const pick = (source, factIndex) => ({ ref: source.ref, binding: source.binding, factIndex });
const observed = [pick(sources[0], 86), pick(sources[0], 87), pick(sources[1], 0), pick(sources[2], 0)];
const answer = { observations: observed, results: [], hypotheses: [], missing_information: [{ kind: 'selected_fact_time_comparison', premises: observed }], next_checks: [{ premises: observed, text: 'Check whether an order identifier links these invoices to dispatch records; establish the balance observation time and coverage before drawing a conclusion.' }] };
const context = { sources, results: [], hypothesesEnabled: true, question, scopes: new Map(rows.map((r, i) => [sources[i].ref, r.scope])) };
assert(accepts(answer));
for (const bad of [pick(sources[0], 31), pick(sources[0], 61), pick(sources[0], 101), { ...observed[0], binding: sources[1].binding }, { ...observed[0], ref: 'B999' }]) {
 const value = { ...answer, observations: [bad, ...observed.slice(1)] };
 assert.equal(accepts(value), false); assert.throws(() => renderSharedAnswer(value, context)); cases++;
}
for (const intent of ['Review stored Xero and Google Sheets observations.', 'Compare sales invoices and purchases.']) {
 const unrestricted = { ...answer, observations: [pick(sources[0],31),pick(sources[1],0),pick(sources[2],0)], missing_information: [], next_checks: [] };
 assert.match(renderSharedAnswer(unrestricted, { ...context, question: intent }).content, /purchase-bill contribution/);
 cases++;
}
assert.throws(() => renderSharedAnswer({ ...answer, observations: [{ ...observed[0], ref: sources[1].ref }, ...observed.slice(1)], missing_information: [], next_checks: [] }, context), e => e.rule === 'fact_reference'); cases++;
const rendered = renderSharedAnswer(answer, context);
assert.deepEqual(rendered.citationIds, ['B1', 'B2', 'B3']); assert.match(rendered.content, /billed: 180 USD; sales-invoice contribution dated 2026-10-14/);
assert.match(rendered.content, /balance at import; as-of unknown/); assert.match(rendered.content, /do not establish/);
assert.doesNotMatch(rendered.content, /Selected-date comparison|purchase-bill contribution|invented result/);
assert.throws(() => renderSharedAnswer({ ...answer, next_checks: [{ premises: observed, text: 'These invoices caused 50% of backlog.' }] }, context), e => e.rule === 'numeric_draft'); cases++;
assert.throws(() => renderSharedAnswer(answer, { ...context, sources: sources.map((s,i) => i === 1 ? { ...s, environment: 'sandbox', installation: 'other' } : s) }), e => e.rule === 'environment'); cases++;
assert.throws(() => sharedRow(raw, id(999)), /shared_workspace_mismatch/); cases++;
// No universal semantic guarantee: nonnumeric causal prose remains an unverified
// draft. Demonstrate the residual honestly instead of treating the label as proof.
const unverified = renderSharedAnswer({ ...answer, hypotheses: [{ premises: observed, text: 'These invoices caused the backlog.' }] }, context);
assert.match(unverified.content, /Hypothesis \(unverified model draft\)/); assert.match(unverified.content, /These invoices caused the backlog/);
// All 34 observations govern one application date check, even with a 2-premise
// closed subset. The 24-premise limit cannot hide the other displayed dates.
const many = [...policy.eligible.map(i => pick(sources[0], i)), ...sources.slice(1).flatMap(s => s.facts.map((_, i) => pick(s, i)))];
assert.equal(many.length, 34);
const manyAnswer = { ...answer, observations: many, next_checks: [], missing_information: [{ kind: 'selected_fact_time_comparison', premises: [pick(sources[0], 6), pick(sources[1], 0)] }] };
const allDates = renderSharedAnswer(manyAnswer, context);
assert.equal((allDates.content.match(/Application date check:/g) || []).length, 1);
assert.match(allDates.content, /invoice\/bill date 2026-10-15/); assert.match(allDates.content, /invoice\/bill date 2026-10-12/);
assert.match(allDates.content, /historical balance as-of time is not established/); assert.doesNotMatch(allDates.content, /Selected-date comparison/);
assert.equal(renderSharedAnswer({ ...manyAnswer, missing_information: [] }, context).content, allDates.content, 'closed subset cannot narrow or duplicate the all-observed date assessment');
const businessSources = rows.map((row, i) => withVsiSourceSnapshot({ id: sources[i].ref, title: row.provider, url: `/app/synthetic-source/${i}`, sourceType: `shared_${row.provider}`, sourceId: row.hash, evidenceDate: null, retrievedAt: '2026-10-27T00:00:00Z', text: JSON.stringify({ scope: row.scope, observations: row.facts, factTimes: row.factTimes, ...(row.salesInvoiceFactGroups ? { salesInvoiceFactGroups: row.salesInvoiceFactGroups } : {}) }) }));
const payload = { question, businessSources, qualitative_sources: sources, sharedRelationships: [], evidenceLimitations: [] }, before = JSON.stringify(payload);
const requestJSON = json => {
 const view = JSON.parse(json), selectedPolicies = invoiceSelections(view.qualitative_sources, view.question);
 return serializeVsiProviderRequest({ input: [{ role: 'system', content: 'Synthetic invoice selection regression.' }, { role: 'user', content: json }], text: { format: { name: 'vsi_shared_answer_v2', type: 'json_schema', strict: true, schema: sharedAnswerJsonSchemaForResults(view.sharedRelationships, true, selectedPolicies, view.qualitative_sources.map(s => s.ref), descriptors(view.qualitative_sources)) } } }, 4000);
};
const packed = packVsiAnswerContext(payload, 'Synthetic invoice selection regression.', 48000, { selectRelevant: true, maxBytes: 192000, requestJSON });
const view = JSON.parse(packed.json), body = JSON.parse(requestJSON(packed.json));
assert.equal(view.businessSources.length, 3); assert.equal(view.qualitative_sources[0].facts.length, 135);
assert.deepEqual(view.invoiceReviewOrder[0].factGroups, policy.reviewFirst);
assert.deepEqual(view.qualitative_sources, sources); assert(ajv.compile(body.text.format.schema)(answer));
assert.equal(requestJSON(packed.json).length, packed.metrics.requestChars); assert.equal(Buffer.byteLength(requestJSON(packed.json), 'utf8'), packed.metrics.requestBytes);
assert.throws(() => packVsiAnswerContext(payload, 'Synthetic invoice selection regression.', packed.metrics.requestChars - 1, { selectRelevant: true, maxBytes: 192000, requestJSON }), /vsi_answer_context_limit/);
const noInvoices = { ...payload, qualitative_sources: [{ ...sources[0], salesInvoiceFactGroups: [] }, ...sources.slice(1)] };
assert.throws(() => packVsiAnswerContext(noInvoices, '', 48000, { selectRelevant: true, requestJSON }), /vsi_sales_invoice_evidence_unavailable/);
for (const badGroups of [[[0,0]], [[999]], [[0],[0]], [[0,6]]]) {
 assert.throws(() => invoiceSelections([{ ...sources[0], salesInvoiceFactGroups: badGroups }], question), /invoice_selection_metadata_invalid/); cases++;
}
assert.equal(JSON.stringify(payload), before); assert.equal(JSON.stringify(originals), originalJSON); assert.equal(JSON.stringify(sharedAnswerJsonSchema), baseSchema);
assert.equal(networkAttempts, 0);

async function actualEngineChecks() {
 const ActualDate = Date;
 global.Date = class extends ActualDate { constructor(...args) { super(...(args.length ? args : ['2026-10-27T00:00:00Z'])); } static now() { return new ActualDate('2026-10-27T00:00:00Z').getTime(); } };
 const actor = id(500), request = id(502), manifest = id(503);
 let engineRaw = originals, mode = 'valid', calls = 0, answerCalls = 0, mockFailure;
 const measured = [], packingFailures = [], validated = [], sealed = [], renderRecords = [];
 let wireBindingRejections = 0, completePacking, nearLimitPacking, oversizedRequiredContext;
 engineReader = { auth: {
  getUser: async () => ({ data: { user: { id: actor } }, error: null }),
  getClaims: async () => ({ data: { claims: { sub: actor, session_id: id(504) } }, error: null })
 }, rpc: async (name, args) => {
  assert.equal(args.p_workspace_id, workspace);
  if (name === 'discover_shared_evidence_v2') return { data: require('./shared-discovery-test-support.cjs').completeCatalog(engineRaw.map(r => ({ provider: r.data.provider, identity: r.identity }))), error: null };
  if (name === 'preview_shared_legacy_evidence_v1' || name === 'read_shared_typed_evidence_v1') return { data: { stage: 'unadmitted', resolved: structuredClone(name === 'preview_shared_legacy_evidence_v1' ? engineRaw[0] : engineRaw.find(r => r.identity.source_id === args.p_identity.source_id)) }, error: null };
  if (name === 'capture_legacy_evidence_v1') return { data: { reference_id: id(505), source_hash: engineRaw[0].hash }, error: null };
  if (name === 'shared_evidence_dependencies_v1') return { data: { manifestIds: [], readSources: [] }, error: null };
  if (name === 'seal_shared_evidence_manifest_v1') { sealed.push(args.p_sources.length); assert.equal(args.p_sources.length, engineRaw.length); return { data: { stage: 'database_bound', manifest_id: manifest, provider_policy_required: true }, error: null }; }
  if (name === 'validate_shared_evidence_manifest_v1') return { data: true, error: null };
  throw Error('unexpected_synthetic_rpc');
 } };
 const packingModule = require('../lib/vsi/answer-context.ts'), realPack = packingModule.packVsiAnswerContext;
 const contractModule = require('../lib/ai/shared-evidence/answer-contract.ts'), realRender = contractModule.renderSharedAnswer;
 contractModule.renderSharedAnswer = (value, context) => { renderRecords.push(structuredClone(context)); return realRender(value, context); };
 packingModule.packVsiAnswerContext = (payload, ...args) => {
  // Deliberately corrupt only the issued context in this fault-injection case,
  // not the authority fixture or canonical preparation. The engine must stop
  // before the first provider request and classify it as unavailable evidence.
  const input = mode === 'bad_metadata' ? { ...payload, qualitative_sources: payload.qualitative_sources.map(s => s.provider === 'xero' ? { ...s, salesInvoiceFactGroups: [[9999]] } : s) } : payload;
  const canonical = JSON.stringify(payload);
  try {
   const result = realPack(input, ...args);
   assert.equal(JSON.stringify(payload), canonical);
   measured.push({ ...result, canonical: structuredClone(payload) }); return result;
  } catch (error) {
   assert.equal(JSON.stringify(payload), canonical,'failed packing cannot shorten canonical evidence');
   if (error instanceof packingModule.VsiAnswerContextLimit) packingFailures.push(error.metrics);
   throw error;
  }
 };
 process.env.VAEROEX_VSI_MAX_INPUT_CHARS = '48000'; process.env.VAEROEX_VSI_MAX_OUTPUT_TOKENS = '6000';
 process.env.VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD = '50'; process.env.VAEROEX_VSI_REQUEST_RESERVE_USD = '0.25';
 process.env.OPENAI_API_KEY = 'synthetic-unused-global';
 const { runVsiAnswer } = require('../lib/vsi/engine.ts');
 const oldInfo = console.info, oldError = console.error;
 console.info = (...args) => { if (args[0] !== '[vsi-context-budget]') oldInfo(...args); };
 console.error = (...args) => { if (args[0] === '[vsi-validation]') validated.push(args[1]); else if (args[0] !== '[vsi-context-budget]') oldError(...args); };
 global.fetch = async (url, init) => {
  try {
   assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'Bearer synthetic-invoice-selection-no-access'); calls++;
   const body = JSON.parse(init.body), view = JSON.parse(body.input[1].content);
   assert.equal(body.store, false); assert.equal(body.tools, undefined);
   let output;
   if (body.text.format.name === 'vsi_research_plan_v1') output = { mode: 'answer', businessEvidence: true, tier: 'simple', clarification: '', publicTargets: [], objectives: [] };
   else {
    answerCalls++; assert.equal(body.text.format.name, 'vsi_shared_answer_v2');
    assert.equal(view.productSources.length, 6);
    if (mode === 'optional_neighbors') assert.equal(view.businessSources.length, 5);
    else if (mode === 'near_limit') assert(view.businessSources.length >= 3 && view.businessSources.length < 5);
    else assert.equal(view.businessSources.length, 3);
    const x = view.qualitative_sources.find(s => s.provider === 'xero'), m = measured.at(-1);
    assert.equal(x.facts.length, 135); assert.deepEqual(x.facts, rows[0].facts); assert.deepEqual(x.salesInvoiceFactGroups, rows[0].salesInvoiceFactGroups);
    assert.equal(init.body.length, m.metrics.requestChars); assert.equal(Buffer.byteLength(init.body, 'utf8'), m.metrics.requestBytes);
    assert(init.body.length <= 48000); assert(m.metrics.requestBytes <= 192000);
    const review = view.invoiceReviewOrder.find(v => v.ref === x.ref);
    assert.deepEqual(review.factGroups.slice(0,2), [[80,81,82],[85,86,87]]);
    const observations = [pick(x,81),pick(x,82),pick(x,86),pick(x,87),...view.qualitative_sources.filter(s => s.provider !== 'xero').map(s => pick(s,0))];
    output = { observations, results: [], hypotheses: [], missing_information: [{ kind: 'selected_fact_time_comparison', premises: observations }], next_checks: [] };
    const providerAccepts = ajv.compile(body.text.format.schema); assert(providerAccepts(output));
    const issuedSources = [...view.qualitative_sources, ...view.contextFactSources], sourcePolicy = invoiceSelections(view.qualitative_sources, question);
    for (const issued of issuedSources) {
     const factIndex = sourcePolicy.find(policy => policy.ref === issued.ref)?.eligible[0] ?? 0;
     const valid = pick(issued, factIndex), canonicalSource = [...m.canonical.qualitative_sources, ...m.canonical.contextFactSources].find(source => source.ref === issued.ref);
     assert(canonicalSource); assert.equal(issued.binding, canonicalSource.binding);
     const withSelection = selection => ({ observations: [...observations.filter(item => JSON.stringify(item) !== JSON.stringify(valid)), selection], results: [], hypotheses: [], missing_information: [], next_checks: [] });
     assert(providerAccepts(withSelection(valid)), 'every current packed original and supporting context has a usable wire selection');
     const citation = [...view.businessSources, ...view.productSources].find(source => source.id === issued.ref);
     const other = issuedSources.find(source => source.binding !== issued.binding);
     assert(citation && other); assert.notEqual(citation.snapshotHash, issued.binding);
     for (const forged of [{ ...valid, binding: 'f'.repeat(64) }, { ...valid, binding: citation.snapshotHash }, { ...valid, binding: other.binding }, { ...valid, ref: 'B_NOT_ISSUED' }]) {
      assert.equal(providerAccepts(withSelection(forged)), false, 'all wire refs reject invented, snapshot and swapped bindings'); wireBindingRejections++;
     }
    }
    if (mode === 'provider_bad_selection') { output.observations[0] = pick(x,31); assert.equal(providerAccepts(output),false); }
    if (mode === 'provider_bad_binding') { output.observations[4].binding = 'f'.repeat(64); assert.equal(providerAccepts(output),false); }
   }
   return new Response(JSON.stringify({ model: body.model, status: 'completed', usage: { input_tokens: 100, output_tokens: 20 }, output_text: JSON.stringify(output) }), { status: 200 });
  } catch (e) { mockFailure = e; throw e; }
 };
 const engineInput = { supabase: engineReader, workspaceId: workspace, actorUserId: actor, readTicket: { ticketId: id(501) }, question, recentMessages: [], requestId: id(506), reservedRequest: { id: request, attempt: 1 } };
 try {
  const result = await runVsiAnswer(engineInput); assert.equal(calls,2); assert.equal(answerCalls,1); assert.equal(result.citations.length,3);
  const baselineContext = renderRecords.at(-1), baselineMeasurement = measured.at(-1), baselineWire = JSON.parse(baselineMeasurement.json);
  for (const source of baselineWire.qualitative_sources) assert.deepEqual(baselineContext.sources.find(candidate => candidate.ref === source.ref), source, 'actual renderer receives the unchanged issued facts and bindings');
  for (const source of baselineWire.contextFactSources) { const renderedSource = baselineContext.sources.find(candidate => candidate.ref === source.ref); assert(renderedSource); assert.equal(renderedSource.binding, source.binding); assert.equal(renderedSource.facts.length, source.factCount); }
  assert.match(result.content,/billed: 170 USD; sales-invoice contribution dated 2026-10-15/); assert.match(result.content,/billed: 180 USD; sales-invoice contribution dated 2026-10-14/);
  for (const citation of result.citations) { const issued = measured.at(-1).canonical.businessSources.find(s => s.sourceId === citation.sourceId); assert(issued); assert.equal(citation.snapshotHash,issued.snapshotHash); assert.equal(citation.url,issued.url); }
  mode = 'provider_bad_selection'; await assert.rejects(() => runVsiAnswer(engineInput), e => e.usage.validationFailure?.contractRule === 'invoice_selection'); assert.equal(calls,4,'no provider retry');
  mode = 'provider_bad_binding'; await assert.rejects(() => runVsiAnswer(engineInput), e => e.usage.validationFailure?.factReference?.reason === 'binding_mismatch'); assert.equal(calls,6,'schema violations still fail closed without retry');
  // Five available originals reuse the complete 27-record invoice and both
  // intended Sheets rows. Optional neighbors must not displace requested facts.
  // The smaller prompt now admits all five sources. Preserve that improvement
  // while retaining the exact required facts and their renderer context.
  mode = 'optional_neighbors';
  engineRaw = [...originals, ...[2,3].map(n => { const optional = sheet(n, '2026-10-15', 0, 0); optional.data.entity_id = id(900+n); optional.data.connection_id = id(910+n); optional.data.metrics = [{ metric: 'Synthetic unrelated warehouse bin observation', value: 0, unit: 'count' }]; return optional; })];
  const beforeOptionalCalls = calls;
  const optionalResult = await runVsiAnswer(engineInput), complete = measured.at(-1), completeWire = JSON.parse(complete.json), completeContext = renderRecords.at(-1);
  const assertRequiredUnchanged = (wire, rendered) => {
   for (const source of baselineWire.qualitative_sources) assert.deepEqual(wire.qualitative_sources.find(candidate => candidate.ref === source.ref),source,'all135 invoice facts, both intended Sheets originals and their exact issued bindings remain unchanged');
   for (const source of baselineContext.sources) assert.deepEqual(rendered.sources.find(candidate => candidate.ref === source.ref),source,'required and supporting renderer facts remain unchanged');
   assert.deepEqual(wire.answerSourceRequirements,baselineWire.answerSourceRequirements,'optional neighbors cannot replace required source groups');
  };
  assert.equal(calls-beforeOptionalCalls,2); assert.equal(optionalResult.citations.length,5);
  assert.equal(complete.initialMetrics.sourceGroups,5); assert(complete.initialMetrics.requestChars<=48000); assert.equal(complete.metrics.selectedSourceGroups,5); assert.equal(complete.metrics.omittedSourceGroups,0);
  assert(complete.metrics.requestChars<=48000); assert(complete.metrics.requestBytes<=192000); assert.equal(completeWire.contextCoverage,undefined,'complete packing must not claim omissions');
  assertRequiredUnchanged(completeWire,completeContext);
  assert.deepEqual(completeWire.qualitative_sources,complete.canonical.qualitative_sources,'every admitted original retains all facts and metadata');
  completePacking = { available: complete.initialMetrics.sourceGroups, selected: complete.metrics.selectedSourceGroups, requestChars: complete.metrics.requestChars, requestBytes: complete.metrics.requestBytes, stoppedBeforePlanner: false };
  // Added neutral question context independently exercises whole-group packing
  // near the unchanged cap. No source fact is shortened to construct this case.
  mode = 'near_limit';
  const nearInput = { ...engineInput, question: `${question}${' Synthetic test context.'.repeat(100)}` };
  assert(nearInput.question.length<=8000);
  const beforeNearCalls = calls;
  const nearResult = await runVsiAnswer(nearInput), near = measured.at(-1), nearWire = JSON.parse(near.json), nearContext = renderRecords.at(-1);
  assert.equal(calls-beforeNearCalls,2); assert.equal(nearResult.citations.length,near.metrics.selectedSourceGroups);
  assert.equal(near.initialMetrics.sourceGroups,5); assert(near.initialMetrics.requestChars>48000); assert(near.metrics.selectedSourceGroups>=3&&near.metrics.selectedSourceGroups<5); assert.equal(near.metrics.omittedSourceGroups,5-near.metrics.selectedSourceGroups);
  assert(near.metrics.requestChars<=48000); assert(near.metrics.requestBytes<=192000); assert.equal(nearWire.productSources.length,6);
  assertRequiredUnchanged(nearWire,nearContext);
  for(const source of nearWire.qualitative_sources) assert.deepEqual(source,near.canonical.qualitative_sources.find(candidate=>candidate.ref===source.ref),'packing retains complete selected originals');
  assert.equal(nearWire.contextCoverage.omittedSourceGroups,near.metrics.omittedSourceGroups); assert.equal(nearWire.contextCoverage.complete,false);
  nearLimitPacking = { available: near.initialMetrics.sourceGroups, selected: near.metrics.selectedSourceGroups, requestChars: near.metrics.requestChars, requestBytes: near.metrics.requestBytes, stoppedBeforePlanner: false };
  // Real excess context still stops before planning. This neutral synthetic
  // padding stays below the question limit and adds no provider or business fact.
  const oversizedInput = { ...engineInput, question: `${question}${' Synthetic test context.'.repeat(400)}`.slice(0,8000) };
  assert.equal(oversizedInput.question.length,8000); mode='oversized_required';
  const beforeOversizedCalls = calls, beforePackingFailures = packingFailures.length;
  await assert.rejects(() => runVsiAnswer(oversizedInput), error => {
   if (mockFailure) throw mockFailure;
   assert.equal(error.usage?.outcomeFailure,'context_block'); assert.equal(error.accountingUncertain,false); assert.equal(calls,beforeOversizedCalls,'required context does not fit: zero planning or answer calls');
   assert.equal(packingFailures.length,beforePackingFailures+1);
   const oversized = packingFailures.at(-1); assert(oversized); assert.equal(oversized.sourceGroups,5); assert.equal(oversized.selectedSourceGroups,3); assert(oversized.requestChars>48000);
   oversizedRequiredContext = { available: oversized.sourceGroups, selected: oversized.selectedSourceGroups, requestChars: oversized.requestChars, requestBytes: oversized.requestBytes, stoppedBeforePlanner: true, reason: 'required_context_unfit' };
   return true;
  });
  for (const variant of ['no_eligible','bad_metadata']) {
   mode=variant; engineRaw=variant==='no_eligible'?[rawFor([record(90,'2026-10-14',[0,0,0,1,25])]),...originals.slice(1)]:originals;
   const beforeCalls=calls;
   await assert.rejects(() => runVsiAnswer(engineInput), e => e.usage.outcomeFailure==='evidence_unavailable' && e.accountingUncertain===false);
   assert.equal(calls,beforeCalls,'missing typed invoice evidence and malformed selection metadata stop before paid planning');
  }
  assert.equal(JSON.stringify(originals),originalJSON); assert.equal(networkAttempts,0); assert(sealed.includes(5)); assert(sealed.every(n=>n===3||n===5));
  assert.doesNotMatch(JSON.stringify(validated),/synthetic-invoice-selection-no-access|[a-f0-9]{64}/);
  const wire=baselineMeasurement.metrics;
  return {actualEngineFull27RecordPrompt:true,actualWireSchemaBudgetMeasured:true,fullRequestChars:wire.requestChars,fullRequestBytes:wire.requestBytes,wireBindingRejections,actualWireRendererTuplesAligned:true,completePacking,nearLimitPacking,oversizedRequiredContext,preflightMissingAndMalformedDeny:true,malformedProviderResponseRejected:true,mockedProviderCalls:calls};
 } catch (e) { throw mockFailure||e; }
 finally { global.Date=ActualDate; packingModule.packVsiAnswerContext=realPack; contractModule.renderSharedAnswer=realRender; global.fetch=deny; console.info=oldInfo; console.error=oldError; }
}
actualEngineChecks().then(engine => console.log(JSON.stringify({ passed: true, retainedShapeRecords: 27, syntheticValuesAndIds: true, canonicalFacts: 135, eligibleInvoiceGroups: 10, regressionCases: cases, genuineZeroPreservedNegativeInvalidAmountsRejected: true, typedSelectionSchemaAndRenderer: true, wholeSourcePackingAndFailClosed: true, oneDateAssessmentAcross34Observations: true, dateRankingAdvisoryOnly: true, exactCitations: true, nonnumericDraftSemanticsRequireReview: true, ...engine, liveModelQualityProved: false, externalCalls: networkAttempts }))).catch(e=>{console.error(e.stack);process.exitCode=1;});
