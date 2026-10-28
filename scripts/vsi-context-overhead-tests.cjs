/* eslint-disable @typescript-eslint/no-require-imports -- Offline synthetic full-wire qualification; no SQL, network or model calls. */
const assert = require('node:assert/strict'), path = require('node:path');
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
let externalCalls = 0;
global.fetch = async () => { externalCalls++; throw Error('external_network_forbidden'); };
require('node:net').Socket.prototype.connect = () => { externalCalls++; throw Error('external_network_forbidden'); };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = n => n.toString(16).padStart(64, '0');
const workspace = id(1), actor = id(2), ticket = id(3), now = '2026-10-28T21:00:00.000Z';
const access = { supabase: {}, workspaceId: workspace, user: { id: actor }, membership: { role: 'owner' }, workspace: { id: workspace, name: 'Synthetic dispatch qualification', industry: 'Synthetic operations' } };
require('./qbo-customer-test-support.cjs').installLoader({
  'server-only': {},
  './retrieval': { authorizeVsiRead: async () => access },
  '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: true, status: 'active', source: 'subscription', plan_slug: 'vaeroex' }) },
  '@/lib/integrations/google-sheets/read-authority': { bindGoogleSheetsRead: async () => ({ ticketId: ticket }) },
  '@/lib/integrations/dashboard/server': { loadIntegrationDashboard: async () => ({ loadFailed: false, googleSheetsConnectionIds: [], dashboard: {
    workspaceId: workspace, observedAt: now, timeZone: 'UTC', timeZoneConfirmed: true, preferencesAvailable: true, unavailable: [],
    entries: Array.from({ length: 4 }, (_, n) => ({ key: `google_sheets:${hash(n + 1)}`, provider: 'Google Sheets', name: `Synthetic saved connection ${n}`, href: '/app/integrations', connectionState: 'connected', lastSuccessfulRefreshAt: now, currentUntil: now, freshness: 'current', unchangedCheck: false, cadence: 'Manual', results: [], hidden: false }))
  } }) }
});
const { loadVsiProductContext } = require('../lib/vsi/product-context.ts');
const { sharedRow } = require('../lib/ai/shared-evidence/generation.ts');
const { invoiceSelections } = require('../lib/ai/shared-evidence/invoice-selection.ts');
const { sharedAnswerJsonSchemaForResults, issueContextFactSources, SHARED_ANSWER_INSTRUCTIONS } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { withVsiSourceSnapshot, stableVsiCitationId } = require('../lib/vsi/research.ts');
const { packVsiAnswerContext, serializeVsiProviderRequest, VsiAnswerContextLimit } = require('../lib/vsi/answer-context.ts');
const { vsiContextGroups } = require('../lib/vsi/context-selection.ts');
const { getVsiConfig } = require('../lib/vsi/config.ts');
const engine = require('../lib/vsi/engine.ts');
const oldPrompt = `${engine.VSI_SYSTEM_PROMPT.replace('Cite specific supporting source IDs inline, such as [B1], and include them in citationIds.', 'Select the supplied fact references; the application renders their citations.').replace('You may explain prior research using the attached historical web source snapshots and their original dates; do not claim those snapshots were rechecked.', 'Historical conversation and source snapshots provide dialogue context only. Select a historical reference only if it is also currently issued in qualitative_sources or contextFactSources; otherwise identify the missing eligible evidence without inventing a reference.').replace('Do useful supported arithmetic and show the inputs.', 'Numeric calculation results in a shared answer must be application-issued; never calculate them in draft prose.')}\n\n${SHARED_ANSWER_INSTRUCTIONS}`;
const prompt = engine.VSI_SHARED_SYSTEM_PROMPT;
assert.equal(typeof prompt, 'string', 'the production shared-answer prompt is exported and used directly');
const wire = system => json => {
  const view = JSON.parse(json);
  const descriptors = [...view.qualitative_sources.map(s => ({ ref: s.ref, binding: s.binding, supportOnly: s.supportOnly === true })), ...view.contextFactSources.map(s => ({ ref: s.ref, binding: s.binding, supportOnly: true }))];
  return serializeVsiProviderRequest({ input: [{ role: 'system', content: system }, { role: 'user', content: json }], reasoning: { effort: 'medium' }, max_output_tokens: 6000,
    text: { format: { type: 'json_schema', name: 'vsi_shared_answer_v2', strict: true, schema: sharedAnswerJsonSchemaForResults(view.sharedRelationships, true, invoiceSelections(view.qualitative_sources, view.question), descriptors.map(s => s.ref), descriptors) } }
  }, 6000);
};
const options = system => ({ requestJSON: wire(system), maxBytes: 192000, selectRelevant: true });
const measure = (payload, system, maxChars = 48000) => {
  try { return { accepted: true, ...packVsiAnswerContext(payload, system, maxChars, options(system)) }; }
  catch (error) { if (!(error instanceof VsiAnswerContextLimit)) throw error; return { accepted: false, metrics: error.metrics }; }
};
const source = (row, n) => {
  const canonical = withVsiSourceSnapshot({ id: `B${n + 1}`, title: row.provider, url: `/app/sources/evidence/vsi_exchange/${id(4)}?workspace=${workspace}#source-${row.hash}`, sourceType: `shared_${row.provider}`, sourceId: row.hash, evidenceDate: null, retrievedAt: now, text: JSON.stringify({ scope: row.scope, observations: row.facts, ...(row.factTimes ? { factTimes: row.factTimes } : {}) }), treatment: 'record' });
  return { ...canonical, id: stableVsiCitationId(canonical) };
};
const synthesis = (row, ref) => ({ ref, binding: row.hash, provider: row.provider, dependencies: [row.hash], facts: row.facts, ...(row.factTimes ? { factTimes: row.factTimes } : {}), ...(row.salesInvoiceFactGroups ? { salesInvoiceFactGroups: row.salesInvoiceFactGroups } : {}), reported: false, environment: 'production' });
const sheet = (n, date, wanted) => ({ identity: { kind: 'sheets_ticket_source', source_id: id(300 + n), version_id: id(310 + n) }, hash: hash(20 + n), data: {
  provider: 'google_sheets', workspace_id: workspace, entity_id: id(wanted ? 30 : 90), connection_id: id(wanted ? 31 : 91), time_zone: 'UTC', date,
  metrics: [{ metric: wanted ? 'Synthetic scenario dispatches' : 'Archived worksheet checklist', value: String(n + 1), unit: 'count' }, { metric: wanted ? 'Synthetic scenario end-of-day backlog' : 'Archived warehouse review', value: '0', unit: 'count' }], read_sources: []
} });

(async () => {
  for (const name of ['VAEROEX_VSI_MAX_INPUT_CHARS', 'VAEROEX_VSI_MAX_OUTPUT_TOKENS']) delete process.env[name];
  const config = getVsiConfig();
  assert.equal(config.maxInputChars, 48000); assert.equal(config.maxProviderInputBytes, 192000); assert.equal(config.maxQuestionChars, 8000);
  assert.equal(oldPrompt.length, 12987, 'baseline is the measured hosted instruction composition');
  const product = await loadVsiProductContext(access, { ticketId: ticket });
  assert.equal(product.sources.length, 6, 'real maintained product producer, not a tiny placeholder');
  // Newly invented values and identifiers. This is a realistic mixed invoice/bill
  // family, not a replay of private hosted source records or a fit-to-966 pad.
  const raw = [{ identity: { kind: 'legacy_binding', binding_id: id(32), start: '2026-09-29', end: '2026-10-28' }, hash: hash(10), data: {
    provider: 'xero', workspace_id: workspace, entity_id: id(30), connection_id: id(33), scope: 'synthetic stored invoice observations', time_zone: 'UTC', period_start: '2026-09-29', period_end: '2026-10-28', read_sources: [],
    records: Array.from({ length: 27 }, (_, n) => ({ key: ['xero', id(33), id(100 + n)], day: `2026-10-${String(1 + n % 16).padStart(2, '0')}`, metrics: ['invoices', 'billed', 'outstanding', 'bills', 'purchases'].map((key, index) => ({ key, value: String([n % 3 === 0 ? 1 : 0, n % 3 === 0 ? n * 13 : 0, n % 3 === 0 ? n * 7 : 0, n % 3 === 0 ? 0 : 1, n % 3 === 0 ? 0 : n * 3][index]), currency: 'USD' })) }))
  } }, sheet(0, '2026-10-14', true), sheet(1, '2026-10-15', true), sheet(2, '2026-10-02', false), sheet(3, '2026-10-03', false)];
  const rawBefore = JSON.stringify(raw), rows = raw.map(value => sharedRow(value, workspace));
  const businessSources = rows.map(source);
  const question = 'Using stored Xero sales-invoice contributions and explicitly synthetic Google Sheets dispatch and backlog observations from the last thirty days, give a hypothetical executive brief. Preserve original dates, amounts, counts, units, unknown balance-as-of times and partial coverage. Explain what the sources jointly support, state missing linkage or incompatible periods, and suggest one specific next check. Do not infer invoice/order correspondence, causation, profit, ratios, balance allocation or trends. Do not search the web.';
  const payload = { question, now, privateConversationSummary: '', recentConversation: [], historicalSources: [], authoritativeProductContext: product.authoritative, productSources: product.sources.map(withVsiSourceSnapshot),
    runtimeCapabilities: { publicWebResearch: 'available', lookupThisTurn: 'not_needed', externalActions: false, textOnly: true }, businessSources,
    sharedRelationships: [], qualitative_sources: rows.map((row, n) => synthesis(row, businessSources[n].id)), contextFactSources: [],
    evidenceLimitations: ['Stored observations have source-specific periods and units. Coverage is not proven complete; do not sum overlapping accounting, invoice, order or payment evidence or infer causation.', 'The selected stored-source window is 2026-09-29 through 2026-10-28; other periods were not searched.', 'Synthetic coverage fixture: twenty-one imported days, nine missing days and one partial day; missing is not zero.', ...product.limitations],
    sourceRequirements: { datedPricingOnly: false }, livePublicLookup: null, researchStatus: { tier: null, rounds: 0, partial: false, toolAllowanceExceeded: false, limitations: [] }
  };
  payload.contextFactSources = issueContextFactSources(payload.productSources, null).map(s => ({ ref: s.ref, binding: s.binding, factCount: s.facts.length }));
  const canonical = JSON.stringify(payload), required = vsiContextGroups(businessSources, [], question).filter(g => g.required).flatMap(g => g.indexes);
  assert.deepEqual(required, [0, 1, 2]);
  const factChars = rows.reduce((sum, row) => sum + JSON.stringify(row.facts).length, 0);
  assert(factChars <= 12000, 'realistic prepared facts remain within the existing upstream fact-character cap');
  // Both measurements use the candidate exact-binding schema. This isolates
  // instruction savings; schema-growth equivalence is qualified separately.
  // The private hosted packet was not retained, so no exact replay is claimed.
  const before = measure(payload, oldPrompt), after = measure(payload, prompt);
  assert.equal(before.accepted, false, 'full previous instruction composition rejects this realistic required context');
  assert.equal(before.metrics.selectedSourceGroups, 3);
  assert.equal(after.accepted, true);
  const sameContextWireSaved = wire(oldPrompt)(after.json).length - wire(prompt)(after.json).length;
  assert(sameContextWireSaved > 2000, 'instruction reduction is material even if new headroom admits optional evidence');
  const packed = JSON.parse(after.json);
  assert.deepEqual(packed.authoritativeProductContext, payload.authoritativeProductContext);
  assert.deepEqual(packed.productSources, payload.productSources);
  assert.deepEqual(packed.contextFactSources, payload.contextFactSources);
  for (const limitation of payload.evidenceLimitations) assert(packed.evidenceLimitations.includes(limitation), 'all original coverage limitations remain');
  for (const index of required) {
    const original = payload.qualitative_sources[index], emitted = packed.qualitative_sources.find(s => s.ref === original.ref);
    assert.deepEqual(emitted, original, 'all facts, date metadata, invoice groups and exact bindings retained');
    const citation = packed.businessSources.find(s => s.id === original.ref), canonicalCitation = businessSources[index];
    assert.equal(citation.snapshotHash, canonicalCitation.snapshotHash); assert.equal(citation.url, canonicalCitation.url);
    const record = JSON.parse(citation.text); assert.equal(record.observationsRef, original.ref); assert.deepEqual(record.scope, JSON.parse(canonicalCitation.text).scope);
  }
  for (const metrics of [before.metrics, after.metrics]) assert.equal(metrics.contextChars + metrics.systemChars + metrics.inputFramingAndEscapingChars + metrics.schemaAndOutputFormatChars + metrics.otherRequestEnvelopeChars, metrics.requestChars);
  assert.equal(JSON.stringify(payload), canonical); assert.equal(JSON.stringify(raw), rawBefore);
  const body = JSON.parse(wire(prompt)(after.json)), validate = ajv.compile(body.text.format.schema);
  const invoice = packed.qualitative_sources.find(s => s.provider === 'xero'), policy = invoiceSelections(packed.qualitative_sources, question)[0];
  const answer = { observations: [{ ref: invoice.ref, binding: invoice.binding, factIndex: policy.eligible[0] }], results: [], hypotheses: [], missing_information: [], next_checks: [] };
  assert(validate(answer));
  const ineligible = invoice.facts.findIndex((_, index) => !policy.eligible.includes(index));
  assert(ineligible >= 0); assert.equal(validate({ ...answer, observations: [{ ...answer.observations[0], factIndex: ineligible }] }), false);
  assert.equal(validate({ ...answer, observations: [{ ...answer.observations[0], binding: packed.qualitative_sources.find(s => s.ref !== invoice.ref).binding }] }), false);

  // A complete-wire boundary is measured with the actual schema and envelope.
  // Append a harmless synthetic question tail only to construct the boundary;
  // the realistic growth regression above uses no byte-fitting padding.
  const boundary = structuredClone(packed);
  let measured = packVsiAnswerContext(boundary, prompt, 48000, { ...options(prompt), selectRelevant: false });
  const fill = 48000 - measured.metrics.requestChars;
  if (boundary.question.length + fill > 8000) {
    boundary.privateConversationSummary = 'Synthetic prior dialogue. '.repeat(100);
    measured = packVsiAnswerContext(boundary, prompt, 48000, { ...options(prompt), selectRelevant: false });
  }
  boundary.question += 'q'.repeat(48000 - measured.metrics.requestChars);
  assert(boundary.question.length <= 8000);
  const exact = packVsiAnswerContext(boundary, prompt, 48000, { ...options(prompt), selectRelevant: false });
  assert.equal(exact.metrics.requestChars, 48000);
  assert.throws(() => packVsiAnswerContext({ ...boundary, question: boundary.question + 'q' }, prompt, 48000, { ...options(prompt), selectRelevant: false }), VsiAnswerContextLimit);

  // Contract-boundary stress: 80-character refs exceed ordinary engine-issued
  // ref lengths, but are allowed by the shared-answer contract. These cases
  // assert rejection, not a claim that every maximum can fit simultaneously.
  const stress = structuredClone(payload); stress.businessSources = []; stress.qualitative_sources = []; stress.question = 'Review all stored observations. ' + 'Long question with quotes " and backslashes \\ and Unicode 界😀. '.repeat(150); stress.question = stress.question.slice(0, 8000);
  assert.equal(stress.question.length, 8000);
  for (let n = 0; n < 24; n++) {
    const ref = `B${String(n).padStart(2, '0')}${'r'.repeat(77)}`, binding = hash(100 + n), facts = Array.from({ length: 3 }, (_, f) => `Synthetic observation ${f}: ${n + f} count; source-specific period unknown; quoted "identifier" and path \\warehouse; 界😀.`);
    assert.equal(ref.length, 80);
    stress.qualitative_sources.push({ ref, binding, provider: 'google_sheets', dependencies: [binding], facts, factTimes: [{ factIndexes: [0, 1, 2], date: '2026-10-14', basis: 'sheet_row_date', valueTiming: 'row_value', connectionLastSyncAt: null }], reported: false, environment: 'production' });
    stress.businessSources.push(withVsiSourceSnapshot({ ...businessSources[1], id: ref, sourceId: binding, text: JSON.stringify({ scope: { entityId: id(600 + n), connectionId: id(700 + n), entityBinding: 'protected', coverage: 'partial', additive: false }, observations: facts }) }));
  }
  assert(stress.qualitative_sources.reduce((sum, s) => sum + JSON.stringify(s.facts).length, 0) <= 12000);
  const maximal = measure(stress, prompt);
  assert.equal(maximal.accepted, false, 'bounded source count does not guarantee complete-wire admission');
  assert.equal(maximal.metrics.selectedSourceGroups, 24, 'all tied required scopes remain whole');
  assert(maximal.metrics.requestBytes > maximal.metrics.requestChars);
  const withWeb = structuredClone(stress);
  withWeb.contextFactSources.push(...Array.from({ length: 24 }, (_, n) => ({ ref: `W${n + 1}`, binding: hash(800 + n), factCount: 1 })));
  withWeb.livePublicLookup = { claims: Array.from({ length: 24 }, (_, n) => ({ text: `Synthetic public claim ${n}, date unestablished.`, citationIds: [`W${n + 1}`], evidenceDate: null, dateProvenance: null })), sources: Array.from({ length: 24 }, (_, n) => ({ id: `W${n + 1}`, retrievedAt: now })) };
  const maximalWithWeb = measure(withWeb, prompt);
  assert.equal(maximalWithWeb.accepted, false); assert(maximalWithWeb.metrics.requestChars > maximal.metrics.requestChars);
  const byteBoundary = packVsiAnswerContext(packed, prompt, 48000, { ...options(prompt), selectRelevant: false });
  assert.throws(() => packVsiAnswerContext(packed, prompt, 48000, { ...options(prompt), selectRelevant: false, maxBytes: byteBoundary.metrics.requestBytes - 1 }), VsiAnswerContextLimit);
  assert.equal(externalCalls, 0);
  console.log(JSON.stringify({ passed: true, synthetic: true, exactHostedReplay: false, oldSystemChars: oldPrompt.length, newSystemChars: prompt.length, sameContextWireSaved, factChars, before: before.metrics, after: after.metrics, headroomChars: 48000 - after.metrics.requestChars, exactLimitChars: exact.metrics.requestChars, maximum24Sources: maximal.metrics, maximum24SourcesAnd30Supports: maximalWithWeb.metrics, longRefChars: 80, longQuestionChars: 8000, canonicalEvidenceUnchanged: true, wrongPairAndIneligibleInvoiceDenied: true, characterAndByteBoundaryDenied: true, externalCalls }));
})().catch(error => { console.error(error); process.exitCode = 1; });
