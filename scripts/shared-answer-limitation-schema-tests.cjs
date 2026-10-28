/* eslint-disable @typescript-eslint/no-require-imports -- Credential-free wire-schema/rendering regressions. */
const assert = require('node:assert/strict'), path = require('node:path');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
const { sharedAnswerJsonSchema, sharedAnswerJsonSchemaForResults, renderSharedAnswer, issueAnswerResults } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { serializeVsiProviderRequest } = require('../lib/vsi/answer-context.ts');
let positives = 0, negatives = 0;
const source = (ref, binding, provider, facts) => ({ ref, binding, provider, facts, dependencies: [binding], reported: false, environment: 'production',
  factTimes: [{ factIndexes: facts.map((_, i) => i), date: '2026-10-01', basis: 'invoice_or_bill_date', valueTiming: 'balance_at_import' }] });
const originals = [
  source('B1', 'a'.repeat(64), 'quickbooks_online', ['Invoice amount: 1800 USD.', 'Outstanding at import: 600 USD.']),
  source('B2', 'b'.repeat(64), 'wix', ['Order total: 500 USD; NOT_PAID.', 'Order total: 0 USD; PAID.']),
  source('B3', 'c'.repeat(64), 'xero', ['Invoice count: 1 count.', 'Billed contribution: 1200 USD.', 'Outstanding at import: 300 USD.']),
  source('B4', 'd'.repeat(64), 'zoho-books', ['Invoice total: 800 USD.', 'Outstanding at import: 0 USD.'])
];
const selection = (s, factIndex = 0) => ({ ref: s.ref, binding: s.binding, factIndex });
const observed = originals.flatMap(s => s.facts.map((_, i) => selection(s, i)));
const descriptors = sources => sources.map(s => ({ ref: s.ref, binding: s.binding, supportOnly: s.supportOnly === true }));
const schemaFor = (sources, results = []) => sharedAnswerJsonSchemaForResults(results, true, [], sources.map(s => s.ref), descriptors(sources));
const contextFor = (sources = originals, results = []) => ({ sources, results, hypothesesEnabled: true });
const comparison = premises => ({ kind: 'selected_fact_time_comparison', premises });
const empty = observations => ({ observations, results: [], hypotheses: [], missing_information: [], next_checks: [] });
const valid = (answer, sources = originals, results = []) => {
  assert(ajv.compile(schemaFor(sources, results))(answer), 'generated answer satisfies the actual per-source schema');
  const result = renderSharedAnswer(answer, contextFor(sources, results)); positives++; return result;
};
const schemaDenied = (answer, sources = originals, results = []) => { assert.equal(ajv.compile(schemaFor(sources, results))(answer), false); negatives++; };
const runtimeDenied = (answer, rule, sources = originals, results = []) => {
  assert.throws(() => renderSharedAnswer(answer, contextFor(sources, results)), error => error.rule === rule); negatives++;
};
// Sanitized structural reconstruction of Evaluation09, not a new model answer:
// the date assessment was present; an additional cross-original prose item failed.
const limitation = { premises: [observed[0], observed[2], observed[5], observed[7]], text: 'Record correspondence and complete coverage are not established by these excerpts.' };
const retainedShape = { ...empty(observed), missing_information: [comparison(observed), limitation],
  next_checks: [{ premises: observed, text: 'Which invoice and order identifiers, payment evidence and observation times establish correspondence and coverage before reconciliation?' }] };
const before = JSON.stringify(retainedShape), baseBefore = JSON.stringify(sharedAnswerJsonSchema);
assert(ajv.compile(sharedAnswerJsonSchema)(retainedShape), 'the old structural union invited this runtime-forbidden shape');
runtimeDenied(retainedShape, 'temporal_assessment_required'); schemaDenied(retainedShape);
assert.equal(JSON.stringify(retainedShape), before, 'no runtime normalization, relocation or claim rewriting');

// Author a separate allowed response; never treat editing the rejected answer as
// a real-model pass. The app owns dates, overlap and financial boundaries.
const results = issueAnswerResults([{ fact: 'Invoice and order stages do not establish a combined revenue total.', inputSourceIds: originals.map(s => s.binding) }]);
const allowed = { ...retainedShape, results: results.map(r => r.id), missing_information: [comparison(observed), {
  premises: [observed[0], observed[1]], text: 'What is the recorded balance observation time for this invoice?' }] };
const scopes = new Map(originals.map(s => [s.ref, { entityBinding: 'protected', entityId: '00000000-0000-4000-8000-000000000001' }]));
valid(allowed, originals, results);
const rendered = renderSharedAnswer(allowed, { ...contextFor(originals, results), scopes });
assert.match(rendered.content, /Accounting scope check \(application-owned\)/);
assert.match(rendered.content, /duplication is not established/);
assert.match(rendered.content, /Order total: 0 USD/); assert.match(rendered.content, /Outstanding at import: 0 USD/);
assert.match(rendered.content, /historical balance as-of time is not established/);
assert.deepEqual(rendered.citationIds, originals.map(s => s.ref));
const noModelDate = valid({ ...allowed, missing_information: [] }, originals, results);
assert.match(noModelDate.content, /Dates across all selected business observations \(application-computed\)/,
  'missing model date assessment never suppresses the mandatory application-owned comparison');
for (const text of ['These observations prove that payments caused dispatch delays.', 'The selected dates are aligned.', limitation.text]) {
  const answer = { ...retainedShape, missing_information: [comparison(observed), { ...limitation, text }] };
  schemaDenied(answer); runtimeDenied(answer, 'temporal_assessment_required');
}
for (const fields of [{ text: 'The dates align.' }, { verdict: 'caused' }, { date: '2026-10-01' }]) {
  schemaDenied({ ...retainedShape, missing_information: [{ ...comparison(observed), ...fields }] });
}

const support = { ...source('P1', 'e'.repeat(64), 'product_context', ['Application capability context.']), supportOnly: true, environment: 'supporting', factTimes: undefined };
const alias = { ...originals[0], ref: 'B_ALIAS' };
const file = { ...source('FILE', 'f'.repeat(64), 'file', ['Reviewed file observation.']), reported: 'file', environment: 'supporting' };
const mixed = [...originals, support, alias, file], mixedObserved = [...observed, selection(support), selection(alias), selection(file)];
for (const premises of [[observed[0], observed[1]], [observed[0], selection(alias), selection(support)], [selection(support)], [selection(file), selection(support)]]) {
  valid({ ...empty(mixedObserved), missing_information: [{ premises, text: 'Which source coverage and observation time should be checked?' }] }, mixed);
}
schemaDenied({ ...empty(mixedObserved), missing_information: [{ premises: [observed[0], selection(file)], text: 'What is the coverage?' }] }, mixed);
runtimeDenied({ ...empty(mixedObserved), missing_information: [{ premises: [observed[0], selection(file)], text: 'What is the coverage?' }] }, 'temporal_assessment_required', mixed);
schemaDenied({ ...empty(mixedObserved), missing_information: [comparison([observed[0], selection(support)])] }, mixed);
for (const forged of [{ ...selection(support), binding: originals[1].binding }, { ...observed[0], binding: support.binding }]) {
  const answer = { ...empty(mixedObserved), missing_information: [{ premises: [forged], text: 'Which source coverage should be checked?' }] };
  schemaDenied(answer, mixed); // Wire constraints now agree with exact runtime bindings.
  runtimeDenied(answer, 'draft_support', mixed);
}
for (const replacement of [{ ...observed[0], binding: originals[1].binding }, { ...observed[0], ref: 'UNKNOWN' }, { ...observed[0], factIndex: originals[0].facts.length }]) {
  const altered = { ...empty(observed), missing_information: [{ premises: [replacement], text: 'What is the source coverage?' }] };
  if (replacement.ref === 'UNKNOWN' || replacement.binding !== observed[0].binding) schemaDenied(altered);
  else assert(ajv.compile(schemaFor(originals))(altered), 'source-local index bounds remain an independent runtime guard');
  runtimeDenied(altered, 'draft_support');
}
// Still-current runtime boundaries: a schema-valid issued fact must also have
// been observed, and a closed comparison needs independent originals.
const unobserved = { ...empty(observed.filter(p => !(p.ref === 'B1' && p.factIndex === 1))), missing_information: [{ premises: [observed[1]], text: 'What is the source coverage?' }] };
assert(ajv.compile(schemaFor(originals))(unobserved)); runtimeDenied(unobserved, 'draft_support');
const duplicated = { ...empty(observed), missing_information: [{ premises: [observed[0], observed[0]], text: 'What is the source coverage?' }] };
assert(ajv.compile(schemaFor(originals))(duplicated)); runtimeDenied(duplicated, 'draft_support');
const sameOriginal = { ...empty(observed), missing_information: [comparison([observed[0], observed[1]])] };
assert(ajv.compile(schemaFor(originals))(sameOriginal)); runtimeDenied(sameOriginal, 'independent_sources');
valid({ ...empty([]), missing_information: [{ premises: [], text: 'Which records should be supplied?' }] }, []);
valid({ ...empty([selection(support)]), missing_information: [{ premises: [selection(support)], text: 'Which product context should be clarified?' }] }, [support]);
schemaDenied({ ...empty(observed), missing_information: [{ premises: [], text: 'Which source?' }] });
schemaDenied({ ...empty(observed), missing_information: [comparison(observed)] }, [originals[0]]);

// Cross-source next checks and hypotheses retain their existing representation.
// False causal prose remains a manual-review failure, not semantic verification.
const cause = 'Payment collection caused the dispatch delays.';
for (const channel of ['hypotheses', 'next_checks']) {
  const text = valid({ ...empty(observed), [channel]: [{ premises: [observed[0], observed[2]], text: cause }] }).content;
  assert.match(text, /unverified model draft|model draft; not performed/);
  // This test establishes labeling only. A human must reject this unsupported
  // causal assertion; schema/runtime acceptance is not a semantic-quality pass.
}

for (const change of [s => { s.ref = ''; }, s => { s.binding = 'wrong'; }, s => { s.supportOnly = 'true'; }]) {
  const bad = descriptors(originals); change(bad[0]);
  assert.throws(() => sharedAnswerJsonSchemaForResults([], true, [], [], bad), e => e.rule === 'context_reference'); negatives++;
}
assert.throws(() => sharedAnswerJsonSchemaForResults([], true, [], [], [descriptors(originals)[0], descriptors(originals)[0]]), e => e.rule === 'context_reference'); negatives++;

// Realistic maximum-source shape: all schema overhead is serialized and counted,
// never excluded from the request guard. No private evidence is shortened.
const many = Array.from({ length: 24 }, (_, i) => source(`V${i}`, (i + 1).toString(16).padStart(64, '0'), 'synthetic_provider', ['Valid zero: 0 count.', 'Stored amount: 20 USD.']));
const auxiliary = Array.from({ length: 6 }, (_, i) => ({ ...support, ref: `P${i}`, binding: (i + 100).toString(16).padStart(64, '0') }));
const all = [...many, ...auxiliary], allBefore = JSON.stringify(all), schema = schemaFor(all);
const wire = serializeVsiProviderRequest({ input: [{ role: 'system', content: 'Synthetic schema boundary test.' }, { role: 'user', content: JSON.stringify({ qualitative_sources: many, contextFactSources: descriptors(auxiliary) }) }], text: { format: { type: 'json_schema', name: 'vsi_shared_answer_v2', strict: true, schema } } }, 4000);
assert(wire.length < 48_000, `serializedRequestChars=${wire.length}`); assert(Buffer.byteLength(wire) < 192_000);
assert.equal(JSON.stringify(all), allBefore); assert.equal(JSON.stringify(sharedAnswerJsonSchema), baseBefore);
assert.equal(ajv.compile(schema)({ ...empty(all.map(s => selection(s))), missing_information: [{ premises: [selection(many[0]), selection(many[23])], text: 'What is the coverage?' }] }), false);
console.log(JSON.stringify({ passed: true, positives, negatives, sourceGroups: 24, supportingSources: 6, serializedRequestChars: wire.length,
  retainedFailureShapeReproduced: true, runtimeUnchanged: true, missingModelAssessmentCannotSuppressAppDates: true, manualSemanticReviewRequired: true, modelCalls: 0 }));
