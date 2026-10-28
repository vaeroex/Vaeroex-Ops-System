/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free actual wire-schema and rendering regression. */
const assert = require('node:assert/strict'), path = require('node:path');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
let externalCalls = 0;
const denyNetwork = () => { externalCalls++; throw new Error('exact_binding_test_network_denied'); };
global.fetch = denyNetwork;
require('node:net').Socket.prototype.connect = denyNetwork;
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
const { sharedAnswerJsonSchema, sharedAnswerJsonSchemaForResults, renderSharedAnswer,
  issueContextFactSources, SharedAnswerContractError } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { invoiceSelections } = require('../lib/ai/shared-evidence/invoice-selection.ts');

const snapshotHash = 'c'.repeat(64);
const [support] = issueContextFactSources([{ id: 'P1', text: 'Synthetic application capability context.', snapshotHash }], null);
assert.notEqual(support.binding, snapshotHash, 'snapshot identity is not the issued context-fact binding');
const source = (ref, binding, provider, facts, date, basis, valueTiming) => ({ ref, binding, provider, facts,
  dependencies: [binding], reported: false, environment: 'production',
  factTimes: [{ factIndexes: facts.map((_, i) => i), date, basis, valueTiming }] });
const invoice = source('B1', 'a'.repeat(64), 'xero', ['Invoice amount: 0 USD.', 'Outstanding at import: 0 USD.', 'Invoice count: 1 count.'],
  '2026-10-13', 'invoice_or_bill_date', 'balance_at_import');
invoice.factTimes = [
  { factIndexes: [0, 2], date: '2026-10-13', basis: 'invoice_or_bill_date', valueTiming: 'document_contribution' },
  { factIndexes: [1], date: '2026-10-13', basis: 'invoice_or_bill_date', valueTiming: 'balance_at_import' }
];
const operations = source('B2', 'b'.repeat(64), 'google_sheets', ['Dispatches: 0 count.', 'Backlog: 4 count.'],
  '2026-10-14', 'sheet_row_date', 'row_value');
const alias = { ...invoice, ref: 'B_ALIAS' };
const sources = [invoice, operations, support, alias];
const descriptors = input => input.map(s => ({ ref: s.ref, binding: s.binding, supportOnly: s.supportOnly === true }));
const pick = (s, factIndex = 0) => ({ ref: s.ref, binding: s.binding, factIndex });
const empty = observations => ({ observations, results: [], hypotheses: [], missing_information: [], next_checks: [] });
const good = { ...empty(sources.flatMap(s => s.facts.map((_, i) => pick(s, i)))),
  hypotheses: [{ premises: [pick(invoice), pick(operations)], text: 'The separate observations may warrant reconciliation, but their correspondence is not established.' }],
  missing_information: [
    { kind: 'selected_fact_time_comparison', premises: [pick(invoice), pick(operations)] },
    { premises: [pick(invoice), pick(invoice, 1), pick(alias), pick(support)], text: 'Which observation time and source coverage should be confirmed for this invoice?' }
  ],
  next_checks: [{ premises: [pick(invoice), pick(operations), pick(support)], text: 'Check record correspondence, payment status and observation times before linking these records.' }]
};
const schemaFor = (input = sources) => sharedAnswerJsonSchemaForResults([], true, [], input.map(s => s.ref), descriptors(input));
const contextFor = (input = sources) => ({ sources: input, results: [], hypothesesEnabled: true });
const validate = ajv.compile(schemaFor());
let schemaPositive = 0, schemaNegative = 0, runtimePositive = 0, runtimeNegative = 0, malformedContexts = 0;
function schemaPass(answer, validator = validate, label = 'valid exact selections') {
  assert.equal(validator(answer), true, label); schemaPositive++;
}
function schemaFail(answer, validator = validate, label = 'invalid exact selections') {
  assert.equal(validator(answer), false, label); schemaNegative++;
}
function runtimePass(answer, input = sources) { const result = renderSharedAnswer(answer, contextFor(input)); runtimePositive++; return result; }
function runtimeFail(answer, rule, input = sources) {
  assert.throws(() => renderSharedAnswer(answer, contextFor(input)), error => !rule || (error instanceof SharedAnswerContractError && error.rule === rule)); runtimeNegative++;
}
const sourcesBefore = JSON.stringify(sources), baseBefore = JSON.stringify(sharedAnswerJsonSchema);
schemaPass(good);
const rendered = runtimePass(good);
assert.match(rendered.content, /Invoice amount: 0 USD/);
assert.match(rendered.content, /Outstanding at import: 0 USD/);
assert.match(rendered.content, /Dispatches: 0 count/);
assert.match(rendered.content, /selected date labels differ; same-period alignment is not established/);
assert.match(rendered.content, /historical balance as-of time is not established/);
assert.deepEqual(rendered.citationIds, sources.map(s => s.ref));

// Every premise position must use the same issued ref/binding pair. This matrix
// compiles the actual wire schema, never a separate test-only approximation.
const locations = [
  ['observation', a => a.observations[0]],
  ['hypothesis', a => a.hypotheses[0].premises[0]],
  ['next_check', a => a.next_checks[0].premises[0]],
  ['one_original_limitation', a => a.missing_information[1].premises[0]],
  ['typed_time_comparison', a => a.missing_information[0].premises[0]]
];
const invalidSelections = [
  ['invented_binding', s => { s.binding = 'f'.repeat(64); }],
  ['other_source_binding', s => { s.binding = operations.binding; }],
  ['snapshot_not_fact_binding', s => { s.binding = snapshotHash; }],
  ['stale_binding', s => { s.binding = 'd'.repeat(64); }],
  ['prefixed_binding', s => { s.binding = `sha256:${invoice.binding}`; }],
  ['upper_case_binding', s => { s.binding = invoice.binding.toUpperCase(); }],
  ['omitted_binding', s => { delete s.binding; }],
  ['null_binding', s => { s.binding = null; }],
  ['unknown_ref', s => { s.ref = 'UNISSUED'; }],
  ['historical_only_ref', s => { s.ref = 'HISTORICAL_ONLY'; }],
  ['other_source_ref', s => { s.ref = operations.ref; }],
  ['omitted_ref', s => { delete s.ref; }],
  ['omitted_index', s => { delete s.factIndex; }],
  ['negative_index', s => { s.factIndex = -1; }],
  ['noninteger_index', s => { s.factIndex = 0.5; }],
  ['structural_index_overflow', s => { s.factIndex = 2000; }]
];
for (const [field, locate] of locations) for (const [kind, mutate] of invalidSelections) {
  const answer = structuredClone(good); mutate(locate(answer)); const before = JSON.stringify(answer);
  schemaFail(answer, validate, `${field}: ${kind}`);
  runtimeFail(answer);
  assert.equal(JSON.stringify(answer), before, 'validation must not repair or relocate an invalid selection');
}
// Product context's real issued hash must not be replaced by its snapshot hash.
for (const locate of [a => a.observations.find(s => s.ref === support.ref), a => a.next_checks[0].premises[2], a => a.missing_information[1].premises[3]]) {
  const answer = structuredClone(good); locate(answer).binding = snapshotHash;
  schemaFail(answer); runtimeFail(answer);
}

// Source-dependent schema narrows pairs, not fact cardinality, observation
// dependencies, independent originals or semantic truth. Keep those guards.
for (const [field, locate] of locations) {
  const answer = structuredClone(good); locate(answer).factIndex = invoice.facts.length;
  schemaPass(answer, validate, `${field}: in-range index syntax remains a rendering guard`);
  runtimeFail(answer, field === 'observation' ? 'fact_reference' : 'draft_support');
}
const unobserved = structuredClone(good);
unobserved.observations = unobserved.observations.filter(s => !(s.ref === invoice.ref && s.factIndex === 1));
schemaPass(unobserved); runtimeFail(unobserved, 'draft_support');
const repeated = structuredClone(good); repeated.next_checks[0].premises.push(pick(invoice));
schemaPass(repeated); runtimeFail(repeated, 'draft_support');
const repeatedObservation = structuredClone(good); repeatedObservation.observations.push(pick(invoice));
schemaPass(repeatedObservation); runtimeFail(repeatedObservation, 'duplicate_fact');
const aliasesAsIndependence = structuredClone(good); aliasesAsIndependence.hypotheses[0].premises = [pick(invoice), pick(alias)];
schemaPass(aliasesAsIndependence); runtimeFail(aliasesAsIndependence, 'independent_sources');
const supportAsIndependence = structuredClone(good); supportAsIndependence.hypotheses[0].premises = [pick(invoice), pick(support)];
schemaPass(supportAsIndependence); runtimeFail(supportAsIndependence, 'independent_sources');
const supportTime = structuredClone(good); supportTime.missing_information[0].premises = [pick(invoice), pick(support)];
schemaFail(supportTime); runtimeFail(supportTime, 'independent_sources');
const crossOriginalProse = structuredClone(good); crossOriginalProse.missing_information[1].premises = [pick(invoice), pick(operations)];
schemaFail(crossOriginalProse); runtimeFail(crossOriginalProse, 'temporal_assessment_required');
const inventedDate = structuredClone(good); inventedDate.missing_information[0].text = 'The dates align.';
schemaFail(inventedDate); runtimeFail(inventedDate);
const numericClaim = structuredClone(good); numericClaim.next_checks[0].text = 'The unpaid amount caused 50% of delays.';
schemaFail(numericClaim); runtimeFail(numericClaim, 'numeric_draft');
const falseCause = structuredClone(good); falseCause.hypotheses[0].text = 'Unpaid invoices caused all dispatch delays.';
schemaPass(falseCause);
assert.match(runtimePass(falseCause).content, /Hypothesis \(unverified model draft\)/);
// This intentionally remains an unsupported manual-review failure. The test
// establishes the label and residual limitation, not semantic acceptance.
runtimeFail(good, 'fact_reference', sources.map(s => ({ ...s, dependencies: [] })));
runtimeFail(good, 'environment', sources.map(s => s.ref === operations.ref ? { ...s, environment: 'sandbox', installation: 'synthetic-other' } : s));

// Invalid protected schema context must fail before any generation. Distinct
// refs with one real binding remain allowed, while duplicate refs never do.
for (const bad of [null, {}, [null], [descriptors(sources)[0], descriptors(sources)[0]],
  [descriptors(sources)[0], { ...descriptors(sources)[0], binding: operations.binding }]]) {
  assert.throws(() => sharedAnswerJsonSchemaForResults([], true, [], [], bad), e => e instanceof SharedAnswerContractError && e.rule === 'context_reference'); malformedContexts++;
}
for (const mutate of [s => { delete s.ref; }, s => { s.ref = ''; }, s => { s.ref = 'x'.repeat(81); },
  s => { delete s.binding; }, s => { s.binding = snapshotHash + '\n'; }, s => { s.binding = 'ABC'.repeat(21) + 'D'; },
  s => { s.binding = null; }, s => { s.supportOnly = 'true'; }, s => { s.factCount = 3; }]) {
  const bad = descriptors(sources); mutate(bad[0]);
  assert.throws(() => sharedAnswerJsonSchemaForResults([], true, [], [], bad), e => e instanceof SharedAnswerContractError && e.rule === 'context_reference'); malformedContexts++;
}

// Consecutive requests with the same public refs but changed protected bindings
// cannot reuse a stale hash, and generation must not mutate shared schema state.
const different = sources.map((s, i) => ({ ...s, binding: (s.ref === alias.ref ? '1' : String(i + 1)).repeat(64),
  dependencies: [(s.ref === alias.ref ? '1' : String(i + 1)).repeat(64)] }));
const replacePairs = (value, byRef) => {
  if (Array.isArray(value)) return value.map(item => replacePairs(item, byRef));
  if (value && typeof value === 'object') {
    const copy = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replacePairs(v, byRef)]));
    if (Object.hasOwn(copy, 'ref') && Object.hasOwn(copy, 'binding')) copy.binding = byRef.get(copy.ref).binding;
    return copy;
  }
  return value;
};
const newer = replacePairs(good, new Map(different.map(s => [s.ref, s])));
const oldSchema = schemaFor(), oldSchemaBefore = JSON.stringify(oldSchema), newerSchema = schemaFor(different);
const validateOld = ajv.compile(oldSchema), validateNew = ajv.compile(newerSchema);
schemaPass(good, validateOld); schemaFail(newer, validateOld);
schemaPass(newer, validateNew); schemaFail(good, validateNew); runtimePass(newer, different); runtimeFail(good, 'fact_reference', different);
assert.equal(JSON.stringify(oldSchema), oldSchemaBefore);
assert.deepEqual(schemaFor(), oldSchema);
const input = descriptors(sources), inputBefore = JSON.stringify(input);
const detached = sharedAnswerJsonSchemaForResults([], true, [], sources.map(s => s.ref), input), detachedBefore = JSON.stringify(detached);
assert.equal(JSON.stringify(input), inputBefore); input[0].binding = '9'.repeat(64); input[0].ref = 'LATER_MUTATION';
assert.equal(JSON.stringify(detached), detachedBefore, 'schema must not retain mutable caller-owned descriptor references');
const visit = (value, fn) => { if (value && typeof value === 'object') { fn(value); Object.values(value).forEach(child => visit(child, fn)); } };
let changed = 0;
visit(detached, value => { if (Array.isArray(value.enum) && value.enum.includes(invoice.binding)) { value.enum[0] = '8'.repeat(64); changed++; } });
assert(changed > 0, 'actual schema encodes issued bindings rather than only structural hash syntax');
assert.deepEqual(schemaFor(), oldSchema, 'one returned schema cannot contaminate a later request');
visit(oldSchema, value => { if (value.$ref) assert.match(value.$ref, /^#\//, 'wire definitions must be local, never network-resolved'); });

// Invoice eligibility is reused for every premise position. An original with
// no eligible invoices must not reopen a generic fact-selection alternative.
const invoiceQuestion = 'Review sales invoices and the separate operational observations.';
const invoiceSchema = input => sharedAnswerJsonSchemaForResults([], true, invoiceSelections(input, invoiceQuestion),
  input.map(s => s.ref), descriptors(input));
const assertSchemaReferences = schema => visit(schema, value => {
  if (value.enum) assert(value.enum.length > 0, 'empty enum is not a supported strict schema');
  if (value.anyOf) assert(value.anyOf.length > 0, 'empty anyOf is not a supported strict schema');
  if (value.$ref) {
    assert.match(value.$ref, /^#\//); assert.doesNotMatch(value.$ref, /undefined/);
    const resolved = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
    assert.notEqual(resolved, undefined, 'every local schema reference must resolve');
  }
});
const excludedInvoice = { ...invoice, salesInvoiceFactGroups: [] };
let emptyInvoiceContexts = 0, invoiceFieldDenials = 0;
for (const remaining of [[], [support], [operations]]) {
  const input = [excludedInvoice, ...remaining], schema = invoiceSchema(input), wire = ajv.compile(schema);
  assertSchemaReferences(schema);
  const base = empty(remaining.map(s => pick(s)));
  const context = { ...contextFor(input), requiredRefs: remaining.map(s => s.ref), question: invoiceQuestion };
  schemaPass(base, wire);
  if (remaining.length) {
    renderSharedAnswer(base, context); runtimePositive++;
    const allowedLimitation = { ...base, missing_information: [{ premises: remaining.map(s => pick(s)), text: 'Which source coverage should be confirmed?' }] };
    schemaPass(allowedLimitation, wire); renderSharedAnswer(allowedLimitation, context); runtimePositive++;
    const unobservedRemaining = { ...allowedLimitation, observations: [] };
    schemaPass(unobservedRemaining, wire);
    assert.throws(() => renderSharedAnswer(unobservedRemaining, { ...context, requiredRefs: [] }), e => e.rule === 'draft_support'); runtimeNegative++;
  } else {
    assert.throws(() => renderSharedAnswer(base, context), e => e.rule === 'source_coverage'); runtimeNegative++;
    const emptyLimitation = { ...base, missing_information: [{ premises: [], text: 'Which eligible records should be supplied?' }] };
    schemaPass(emptyLimitation, wire);
    assert.throws(() => renderSharedAnswer(emptyLimitation, context), e => e.rule === 'draft_support'); runtimeNegative++;
  }
  for (const [field] of locations) {
    const answer = structuredClone(base), excluded = pick(excludedInvoice), other = remaining.length ? pick(remaining[0]) : excluded;
    if (field === 'observation') answer.observations.push(excluded);
    else if (field === 'hypothesis') answer.hypotheses = [{ premises: [excluded, other], text: 'The observations might merit reconciliation.' }];
    else if (field === 'next_check') answer.next_checks = [{ premises: [excluded], text: 'Which record should be checked?' }];
    else if (field === 'one_original_limitation') answer.missing_information = [{ premises: [excluded], text: 'Which coverage is recorded?' }];
    else answer.missing_information = [{ kind: 'selected_fact_time_comparison', premises: [excluded, other] }];
    schemaFail(answer, wire, `${field}: empty invoice eligibility cannot be bypassed`);
    assert.throws(() => renderSharedAnswer(answer, context), e => e.rule === (field === 'observation' ? 'invoice_selection' : 'draft_support')); runtimeNegative++;
    invoiceFieldDenials++;
  }
  const inventedLimitation = { ...base, missing_information: [{ premises: [{ ref: 'UNKNOWN', binding: 'e'.repeat(64), factIndex: 0 }], text: 'Which source should be supplied?' }] };
  schemaFail(inventedLimitation, wire, 'no broad fallback inside nonempty limitation premises');
  emptyInvoiceContexts++;
}
const eligibleInvoice = { ...invoice, salesInvoiceFactGroups: [[0, 2]] }, invoiceSources = [eligibleInvoice, operations, support];
const eligibleSchema = invoiceSchema(invoiceSources), eligibleWire = ajv.compile(eligibleSchema);
assertSchemaReferences(eligibleSchema);
const eligibleAnswer = { ...empty([pick(eligibleInvoice), pick(eligibleInvoice, 2), pick(operations), pick(support)]),
  hypotheses: [{ premises: [pick(eligibleInvoice, 2), pick(operations)], text: 'Separate observations may warrant reconciliation without an assumed relationship.' }],
  missing_information: [
    { kind: 'selected_fact_time_comparison', premises: [pick(eligibleInvoice), pick(operations)] },
    { premises: [pick(eligibleInvoice), pick(eligibleInvoice, 2), pick(support)], text: 'What does this invoice cover?' }
  ],
  next_checks: [{ premises: [pick(eligibleInvoice, 2), pick(operations)], text: 'Check identifiers and observation times before linking records.' }]
};
const eligibleContext = { ...contextFor(invoiceSources), question: invoiceQuestion };
schemaPass(eligibleAnswer, eligibleWire);
assert.match(renderSharedAnswer(eligibleAnswer, eligibleContext).content, /Invoice amount: 0 USD/); runtimePositive++;
for (const [field, locate] of locations) {
  const answer = structuredClone(eligibleAnswer); locate(answer).factIndex = 1;
  schemaFail(answer, eligibleWire, `${field}: ineligible invoice index is unavailable everywhere`);
  assert.throws(() => renderSharedAnswer(answer, eligibleContext), e => e.rule === (field === 'observation' ? 'invoice_selection' : 'draft_support')); runtimeNegative++;
  invoiceFieldDenials++;
}
const eligibleButUnobserved = structuredClone(eligibleAnswer);
eligibleButUnobserved.observations = eligibleButUnobserved.observations.filter(s => !(s.ref === invoice.ref && s.factIndex === 2));
schemaPass(eligibleButUnobserved, eligibleWire);
assert.throws(() => renderSharedAnswer(eligibleButUnobserved, eligibleContext), e => e.rule === 'draft_support'); runtimeNegative++;

const noSources = ajv.compile(schemaFor([]));
const noEvidence = { ...empty([]), missing_information: [{ premises: [], text: 'Which source records should be supplied?' }] };
schemaPass(noEvidence, noSources); runtimePass(noEvidence, []);
schemaFail(empty([pick(invoice)]), noSources);
const onlySupport = { ...empty([pick(support)]), missing_information: [{ premises: [pick(support)], text: 'Which application capability should be clarified?' }] };
schemaPass(onlySupport, ajv.compile(schemaFor([support]))); runtimePass(onlySupport, [support]);
// Existing non-engine callers without source context retain structural syntax;
// that compatibility must never be mistaken for protected source authorization.
const generic = ajv.compile(sharedAnswerJsonSchemaForResults([], true));
const syntactic = empty([{ ref: 'NOT_IN_CURRENT_CONTEXT', binding: 'e'.repeat(64), factIndex: 0 }]);
schemaPass(syntactic, generic); runtimeFail(syntactic, 'fact_reference');
assert.equal(JSON.stringify(sources), sourcesBefore);
assert.equal(JSON.stringify(sharedAnswerJsonSchema), baseBefore);
assert.equal(externalCalls, 0);
console.log(JSON.stringify({ passed: true, selectionLocations: locations.map(([name]) => name), schemaPositive, schemaNegative,
  runtimePositive, runtimeNegative, malformedContexts, emptyInvoiceContexts, invoiceFieldDenials, exactIssuedPairs: true, snapshotIsNotFactBinding: true,
  requestStateIsolated: true, factBoundsAndPremiseSemanticsRemainRuntimeGuards: true, manualSemanticReviewRequired: true,
  syntheticOnly: true, externalCalls }));
