/* eslint-disable @typescript-eslint/no-require-imports -- Offline rendering boundaries; no credentials or network. */
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { renderSharedAnswer, issueAnswerResults, SharedAnswerContractError } = require('../lib/ai/shared-evidence/answer-contract.ts');
const entityA = '00000000-0000-4000-8000-000000000001';
const entityB = '00000000-0000-4000-8000-000000000002';
const marker = 'Accounting scope check (application-owned):';
const source = (provider, index, extra = {}) => ({ ref: `B${index}`, binding: index.toString(16).padStart(64, '0'), dependencies: [`root-${index}`], provider, facts: ['Stored outstanding balance 0 USD; balance at import, exact as-of not established.'], reported: false, environment: 'production', ...extra });
const sources = [source('quickbooks_online', 1), source('xero', 2), source('zoho-books', 3), source('wix-orders', 4)];
const selection = s => ({ ref: s.ref, binding: s.binding, factIndex: 0 });
const protectedScope = (entityId = entityA, extra = {}) => ({ entityBinding: 'protected', entityId, ...extra });
const scopes = values => new Map(values.map((value, i) => [sources[i].ref, value]));
const answer = selected => ({ observations: selected.map(selection), results: [], hypotheses: [], missing_information: [], next_checks: [] });
let cases = 0;
function render(selected = sources, scopeMap, available = selected, edit = {}) {
  const value = answer(selected), before = JSON.stringify({ value, available });
  const output = renderSharedAnswer({ ...value, ...edit }, { sources: available, results: [], hypothesesEnabled: true, requiredRefs: selected.map(s => s.ref), scopes: scopeMap });
  assert.equal(JSON.stringify({ value, available }), before, 'immutable issued facts and selections remain unchanged');
  assert.deepEqual(output.citationIds, selected.map(s => s.ref), 'qualification creates no new citation authority');
  cases++;
  return output;
}
const paragraph = output => output.content.split('\n\n').find(line => line.startsWith(marker));
function qualified(selected, scopeMap, expectedRefs, available = selected) {
  const output = render(selected, scopeMap, available), text = paragraph(output);
  assert(text, 'selected ambiguous accounting pairs need a deterministic qualification');
  assert.deepEqual([...text.matchAll(/\[(B\d+)\]/g)].map(match => match[1]), expectedRefs);
  assert.match(text, /may overlap or differ in coverage and accounting basis/);
  assert.match(text, /duplication is not established/);
  assert.match(text, /do not establish a combined revenue or receivables total/);
  assert.match(text, /compared separately with their stated limits/);
  assert.equal(output.content.split(marker).length - 1, 1);
  return output;
}
const same = scopes(sources.map(() => protectedScope()));
const four = qualified(sources, same, ['B1', 'B2', 'B3']);
assert(!paragraph(four).includes('Wix'), 'order stage is not an accounting-ledger overlap claim');
for (const s of sources) assert(four.content.includes(`${s.facts[0]} [${s.ref}]`), 'zero balances and exact fact attribution are preserved');
for (const map of [undefined, new Map(), scopes([{}, {}, {}]), scopes([protectedScope(), {}, {}])]) qualified(sources.slice(0, 3), map, ['B1', 'B2', 'B3']);
for (const misleading of [
  { entityId: entityB },
  { entityBinding: 'unavailable', entityId: entityB },
  { entityBinding: 'protected', entityId: 'unverified-company-label' },
  { entityBinding: 'protected', entityId: null },
  { entityBinding: 'protected', entityId: ` ${entityB}` },
]) qualified(sources.slice(0, 2), scopes([protectedScope(), misleading]), ['B1', 'B2']);
const upper = 'ABCDEFAB-0000-4000-8000-000000000001';
qualified(sources.slice(0, 2), scopes([protectedScope(upper), protectedScope(upper.toLowerCase())]), ['B1', 'B2']);

// Date separation and assertions of complete/disjoint coverage are not a
// protected cross-system population certificate, especially for imported balances.
for (const windowKind of ['retrieval_selection', undefined]) qualified(sources.slice(0, 2), scopes([
  protectedScope(entityA, { start: '2026-09-01', end: '2026-09-30', coverage: 'complete', windowKind, currency: 'USD' }),
  protectedScope(entityA, { start: '2026-10-01', end: '2026-10-31', coverage: 'disjoint; do not warn', windowKind, currency: 'EUR' }),
]), ['B1', 'B2']);
qualified(sources.slice(0, 2), scopes([protectedScope(entityA, { start: '2026-10-01', coverage: 'complete' }), protectedScope(entityA, { start: '2026-10-01', coverage: 'complete' })]), ['B1', 'B2']);

// Verified different entity bindings are sufficient to rule out this specific
// same-population limitation. They do not authorize totals or change other guards.
assert.equal(paragraph(render(sources.slice(0, 2), scopes([protectedScope(), protectedScope(entityB)]))), undefined);
qualified(sources.slice(0, 3), scopes([protectedScope(), protectedScope(), protectedScope(entityB)]), ['B1', 'B2']);
qualified(sources.slice(0, 3), scopes([protectedScope(), protectedScope(entityB), {}]), ['B1', 'B2', 'B3']);
assert.equal(paragraph(render([sources[0]], same, sources)), undefined, 'available but unobserved sources do not trigger or receive citations');
assert.equal(paragraph(render([sources[0], sources[3]], same, sources)), undefined, 'one ledger and an order are handled by existing financial-stage boundaries');
assert.equal(paragraph(render([sources[0], source('quickbooks_online', 5)], same)), undefined, 'multiple records from one accounting provider do not imply cross-system overlap');
for (const extra of [{ supportOnly: true }, { environment: 'supporting' }, { reported: 'file', environment: 'supporting' }, { reported: 'note', environment: 'supporting' }]) {
  assert.equal(paragraph(render([sources[0], { ...sources[1], ...extra }], same)), undefined, 'reported/supporting material is not a native accounting ledger');
}
for (const provider of ['toString', '__proto__', 'google_sheets', 'square', 'loyverse']) assert.equal(paragraph(render([sources[0], source(provider, 5)], same)), undefined);

// Model-authored assurances cannot suppress application-owned scope disclosure.
const authored = render(sources.slice(0, 2), same, sources.slice(0, 2), { next_checks: [{ premises: sources.slice(0, 2).map(selection), text: 'The systems are disjoint and complete.' }] });
assert(paragraph(authored));assert(authored.content.includes('Recommended check (model draft; not performed)'));
// This unsupported draft still requires manual rejection; a label is not proof.
const unsupportedDraftPassesManualReview = false;assert.equal(unsupportedDraftPassesManualReview, false);
const context = { sources, results: [], hypothesesEnabled: true, scopes: same };
for (const [change, rule] of [
  [{ observations: [{ ...selection(sources[0]), binding: sources[1].binding }, ...sources.slice(1).map(selection)] }, 'fact_reference'],
  [{ observations: [{ ...selection(sources[0]), ref: 'FOREIGN_REF' }, ...sources.slice(1).map(selection)] }, 'fact_reference'],
  [{ observations: [...sources.map(selection), selection(sources[0])] }, 'duplicate_fact'],
  [{ observations: sources.slice(1).map(selection) }, 'source_coverage'],
  [{ results: ['f'.repeat(64)] }, 'result_reference'],
  [{ hypotheses: [{ premises: sources.slice(0, 2).map(selection), text: 'A combined total is 2600 USD.' }] }, 'numeric_draft'],
]) { assert.throws(() => renderSharedAnswer({ ...answer(sources), ...change }, context), e => e instanceof SharedAnswerContractError && e.rule === rule);cases++; }
const issued = issueAnswerResults([{ fact: 'Existing financial-stage qualification stays intact.', inputSourceIds: sources.slice(0, 2).map(s => s.binding) }]);
const preserved = renderSharedAnswer({ ...answer(sources), results: [issued[0].id] }, { ...context, results: issued });
assert(paragraph(preserved));assert(preserved.content.includes(issued[0].fact));cases++;
// Mandatory disclosure must count against the existing answer bound. Do not
// silently drop the qualification or canonical facts to make a large answer fit.
const separate = scopes([protectedScope(), protectedScope(entityB)]);
const base = render(sources.slice(0, 2), separate);
const large = sources.slice(0, 2).map((s, i) => i ? s : { ...s, facts: [s.facts[0] + 'x'.repeat(23500 - base.content.length)] });
assert.equal(render(large, separate).content.length, 23500);
assert.throws(() => renderSharedAnswer(answer(large), { sources: large, results: [], hypothesesEnabled: false, scopes: same }), e => e instanceof SharedAnswerContractError && e.rule === 'answer_bounds');cases++;
assert(!four.content.includes('SYNTHETIC ONLY'), 'production rendering does not apply the evaluator disclosure');
const { renderToStaticMarkup } = require('react-dom/server'), React = require('react');
const { AnswerContent } = require('../components/vsi/AnswerContent.tsx');
const markup = renderToStaticMarkup(React.createElement(AnswerContent, { content: four.content }));
assert(markup.includes(marker) && markup.includes('duplication is not established'));cases++;
console.log(JSON.stringify({ accountingScopeCases: cases, selectedSourcesOnly: true, distinctProtectedEntitiesExcluded: true, noNewCalculationAuthority: true, existingGuardsPreserved: true, modelCalls: 0 }));
