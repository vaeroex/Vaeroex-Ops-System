/* eslint-disable @typescript-eslint/no-require-imports -- Offline review calibration; no model or semantic judge. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { renderSharedAnswer, sharedAnswerJsonSchemaForResults } = require('../lib/ai/shared-evidence/answer-contract.ts');
const { cases } = require('./vsi-all12-synthetic-cases.cjs');
const Ajv = require(require.resolve('ajv', { paths: [path.dirname(require.resolve('eslint'))] }));
const ajv = new Ajv({ allErrors: true });
let networkAttempts = 0;
global.fetch = () => { networkAttempts++; throw Error('offline_only'); };

// Human review calibration, not a keyword-based acceptance algorithm. The first
// example is the actual Evaluation10 recommendation: useful for the old broad
// question, but it leaves the preregistered payment-confirmation subgoal open.
const retainedCheck = 'Before treating these counts or records as matches, obtain order or transaction identifiers linking the systems, confirm each record’s event-time basis and timezone, and verify source coverage and status. Before combining amounts, also confirm a common currency and unit, compatible periods, and that the records are non-overlapping; keep Square payment minor units distinct from receipt totals and do not count cancelled sales or refunds as active sales.';
const acceptableParaphrases = [
  'Match the waiting orders to their tender records and verify funds were received or cleared before marking them paid; payment activity alone does not confirm those orders.',
  'Reconcile receipt references to the orders awaiting confirmation, then obtain evidence of settlement for those orders. These unlinked records cannot establish their payment status.',
];
const unsupportedAssertions = [
  'The completed payment confirms that the waiting orders are paid.',
  'The receipt and payment records describe the same transaction, so funds have settled.',
  'The pending orders were caused by a payment shortfall.',
];
const sources = [
  { ref: 'PAY', binding: 'a'.repeat(64), provider: 'square', facts: ['Completed payment: 12345 USD minor units. This is not posted accounting revenue.'] },
  { ref: 'RECEIPT', binding: 'b'.repeat(64), provider: 'loyverse', facts: ['SALE total 120 USD; tax 10 USD; discount 5 USD. Receipt event 2026-09-30, creation 2026-10-01.'] },
  { ref: 'OPS', binding: 'c'.repeat(64), provider: 'google_sheets', facts: ['Orders awaiting payment confirmation: 3 count, supplied row date 2026-10-01.', 'Orders awaiting payment confirmation: 0 count, supplied row date 2026-10-02.'] },
].map(s => ({ ...s, dependencies: [s.binding], reported: false, environment: 'production' }));
const observations = sources.flatMap(s => s.facts.map((_, factIndex) => ({ ref: s.ref, binding: s.binding, factIndex })));
const context = { sources, results: [], hypothesesEnabled: true };
const schema = sharedAnswerJsonSchemaForResults([], true, [], sources.map(s => s.ref), sources.map(s => ({ ref: s.ref, binding: s.binding, supportOnly: false })));
const validate = ajv.compile(schema);
const answerFor = text => ({ observations, results: [], hypotheses: [], missing_information: [], next_checks: [{ premises: observations.map(o => ({ ...o })), text }] });
for (const text of [retainedCheck, ...acceptableParaphrases, ...unsupportedAssertions]) {
  const answer = answerFor(text), before = JSON.stringify(answer);
  assert(validate(answer));
  const rendered = renderSharedAnswer(answer, context);
  assert(rendered.content.includes(text));
  assert(rendered.content.includes('model draft; not performed'));
  assert(rendered.content.includes('confirmation: 0 count'));
  assert.deepEqual(rendered.citationIds, sources.map(s => s.ref));
  assert.equal(JSON.stringify(answer), before, 'no rewriting or automatic semantic repair');
}
// Even false prose can meet this draft syntax. The adversarial examples above
// must fail manual quality review; these tests do NOT label them safe/verified.
let guardedNegatives = 0;
for (const [mutate, rule] of [
  [a => { a.observations[0].binding = 'f'.repeat(64); }, 'fact_reference'],
  [a => { a.observations[0].ref = 'UNKNOWN'; }, 'fact_reference'],
  [a => { a.observations[0].factIndex = 99; }, 'fact_reference'],
  [a => { a.observations.push({ ...a.observations[0] }); }, 'duplicate_fact'],
  [a => { a.results.push('f'.repeat(64)); }, 'result_reference'],
  [a => { a.next_checks[0].premises[0] = { ...a.next_checks[0].premises[0], binding: 'f'.repeat(64) }; }, 'draft_support'],
]) {
  const answer = structuredClone(answerFor(retainedCheck)); mutate(answer);
  assert.throws(() => renderSharedAnswer(answer, context), error => error.rule === rule); guardedNegatives++;
}
// Decisions are now requested, not silently added by the reviewer. The question
// does not prescribe the answer, supplier IDs, expected numbers or a conclusion.
assert.match(cases[1].question, /whether the records establish payment confirmation or settlement/);
assert.match(cases[2].question, /whether a combined completed-hours comparison is supported/);
assert.match(cases[3].question, /whether these counts establish stock availability/);
for (const test of cases) {
  assert(!test.question.includes(test.mockNextCheck));
  for (const criterion of test.requiredUsefulness) assert(!test.question.includes(criterion));
}

// Optional exact private replay. Only the known synthetic, immutable files are
// accepted; no terminal, secrets, network, provider transport or live launcher.
let retainedReplay = false;
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--retained-dir');
  const directory = fs.realpathSync(process.argv[3]);
  assert(path.isAbsolute(directory));
  assert.equal(path.basename(directory), 'isolated-all12-eval-20261028-10');
  const root = path.resolve(__dirname, '..'); assert(directory !== root && !directory.startsWith(root + path.sep));
  const read = (name, expected) => {
    const file = path.join(directory, name), info = fs.lstatSync(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.size < 2000000);
    const bytes = fs.readFileSync(file); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected);
    return JSON.parse(bytes);
  };
  const request = read('payments-and-operations-call-2-request.json', '74b032c6675549c186ecf565237a2cd67206355551f7c6f38a98d4d0e199ccd4');
  const reply = read('payments-and-operations-call-2-generated.json', '2c41eb78e52b22d73d35a9ad12c0d0e5558c05da60722654e5c8f4c9ad89e91b');
  const result = read('payments-and-operations-result.json', 'caa1e4415bc18d5234248afed5dc5e8288eae27cd24218aeda70652e80f6ba7d');
  const payload = JSON.parse(request.body.input[1].content), answer = JSON.parse(reply.text);
  assert(ajv.compile(request.body.text.format.schema)(answer));
  assert.equal(answer.next_checks.length, 1); assert.equal(answer.next_checks[0].text, retainedCheck);
  const rendered = renderSharedAnswer(answer, { sources: payload.qualitative_sources, results: payload.sharedRelationships, hypothesesEnabled: true,
    requiredSourceGroups: payload.answerSourceRequirements.groups, question: payload.question });
  assert(rendered.content.includes(retainedCheck)); assert(result.answer.includes(retainedCheck));
  assert(!payload.question.includes('settlement'), 'old question did not state the mandatory settlement subgoal');
  assert.equal(result.requiredUsefulness[4], cases[1].requiredUsefulness[4], 'criterion preserved, not relaxed');
  assert.equal(result.mechanicalPass, true); retainedReplay = true;
}
assert.equal(networkAttempts, 0);
console.log(JSON.stringify({ passed: true, expressionCases: 6, guardedNegatives, retainedReplay,
  semanticJudgments: 'manual calibration only; no automatic semantic validator', applicationChanged: false,
  priorStopReclassifiedAsPass: false, modelCalls: 0, networkAttempts }));
