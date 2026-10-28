/* eslint-disable @typescript-eslint/no-require-imports -- Offline isolated process qualification. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { cases, fixtures, syntheticLabel } = require('./vsi-all12-synthetic-cases.cjs');
const { presentSyntheticAnswer } = require('./vsi-all12-synthetic-runner.cjs');
const root = path.resolve(__dirname, '..');
assert.equal(cases.length, 4);
assert.deepEqual([...new Set(cases.flatMap(c => c.providers))].sort(), Object.keys(fixtures).sort());
assert.equal(Object.keys(fixtures).length, 12);
for (const file of ['lib/ai/shared-evidence/runtime-gate.ts', 'lib/ai/shared-evidence/qualitative-policy.ts', 'lib/vsi/failure-accounting-gate.ts']) assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /return false/);
// Disclosure is fixture-owned, deterministic and does not modify engine prose.
const unlabeled = 'Source-backed facts and a qualified next check.';
assert.equal(presentSyntheticAnswer(unlabeled), `${syntheticLabel}\n\n${unlabeled}`);
assert.equal(presentSyntheticAnswer(presentSyntheticAnswer(unlabeled)), presentSyntheticAnswer(unlabeled));
assert.throws(() => presentSyntheticAnswer(`${syntheticLabel}\n${syntheticLabel}`));
for (const embedded of [`This is not ${syntheticLabel}`, `Quoted scope: "${syntheticLabel}"`, `Facts first.\n${syntheticLabel}`, syntheticLabel]) assert.throws(() => presentSyntheticAnswer(embedded), /synthetic_label_not_heading/);
for (const invalid of ['', ' ', null, { synthetic: true }]) assert.throws(() => presentSyntheticAnswer(invalid));
const results = [];
function run(test, variant = 'present') {
  const text = execFileSync(process.execPath, [path.join(__dirname, 'vsi-all12-synthetic-runner.cjs'), '--case', test.id, variant], {
    cwd: root, env: { SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR: process.env.SHARED_EVIDENCE_PRIVATE_FIXTURE_DIR, TZ: 'UTC' },
    encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024,
  });
  const line = text.split('\n').find(line => line.startsWith('SYNTHETIC_RESULT '));
  assert(line, 'terminal_receipt_required');
  const value = JSON.parse(line.slice('SYNTHETIC_RESULT '.length));
  assert.equal(value.caseId, test.id); assert.equal(value.modelCalls, 0); assert.equal(value.networkAttempts, 0);
  return value;
}
for (const test of cases) {
  const result = run(test);
  assert.deepEqual(result.admittedProviders, [...test.providers].sort());
  assert.equal(result.deterministicTransportCalls, 2);
  assert(result.actualSQLAdmission && result.actualEngine && result.exactSaveAndReopen && result.onceAccounting);
  assert.equal(result.revokedProvidersDenied, test.providers.length);
  assert.equal(result.limitations.fullProductionSchemaAndRls, false);
  assert.equal(result.limitations.actualOAuthOrTokens, false);
  assert.equal(result.manualModelUsefulness, 'NOT_TESTED_MOCK_OUTPUT');
  assert(result.answer.includes(test.mockNextCheck));
  assert.equal(result.syntheticLabel, syntheticLabel);
  assert.equal(result.answer.split(syntheticLabel).length - 1, 1);
  assert.equal(result.answer, presentSyntheticAnswer(result.engineAnswer));
  assert(result.engineAnswer.includes(test.mockNextCheck));
  assert.deepEqual(result.presentation, { owner: 'isolated_fixture', label: syntheticLabel, engineAnswerUnchanged: true, renderedLabelCount: 1, savedReopenedLabelCount: 1 });
  const accountingWarning = 'Accounting scope check (application-owned):';
  for (const text of [result.engineAnswer, result.answer]) {
    if (test.id === 'accounting-and-orders') {
      const paragraph = text.split('\n\n').find(line => line.startsWith(accountingWarning)); assert(paragraph);
      for (const provider of ['QuickBooks Online', 'Xero', 'Zoho Books']) assert(paragraph.includes(provider));
      assert(text.includes('different financial stages, so their amounts must not be added'));
      assert(/Stored observation — zoho books: .*outstanding: 0 USD/.test(text));
    } else assert(!text.includes(accountingWarning));
  }
  results.push(result);
  console.log(JSON.stringify({ caseId: result.caseId, providers: result.admittedProviders, requests: result.requestSizes, admissionSaveReopen: true, mockCalls: 2, liveCalls: 0 }));
}
const accounting = cases.find(c => c.id === 'accounting-and-orders'), time = cases.find(c => c.id === 'time-coverage'), payments = cases.find(c => c.id === 'payments-and-operations');
const wrong = run(accounting, 'wrong_workspace'); assert(wrong.correctlyDenied);
const immutable = run(accounting, 'stale_binding'); assert(immutable.immutableBindingMutationDenied);
const empty = run(time, 'empty_history'); assert.deepEqual(empty.admittedProviders, ['toggl']);
assert(empty.coverage.providers.filter(p => ['harvest','clockify'].includes(p.provider)).every(p => p.empty === 1 && p.prepared === 0));
const currency = run(payments, 'missing_currency'); assert(currency.admittedProviders.includes('loyverse'));
assert(currency.moneySuppressed, 'retain categorical receipt evidence without inventing its currency');
console.log(JSON.stringify({ result: 'PASS', cases: 4, providers: 12, mockEngineCalls: 8, modelCalls: 0, sourceIsolation: true, additionalNegativePaths: 4, realModelQuality: 'UNTESTED', summaries: results.map(r => ({ caseId: r.caseId, requests: r.requestSizes })) }));
if (process.env.VSI_ALL12_REPORT_PATH) {
  const output = process.env.VSI_ALL12_REPORT_PATH;
  assert(path.isAbsolute(output));
  const parent = fs.realpathSync(path.dirname(output));
  assert(parent !== root && !parent.startsWith(root + path.sep), 'private_artifacts_outside_repository');
  const text = JSON.stringify({ synthetic: true, modelCalls: 0, realModelQuality: 'UNTESTED', results, negatives: [wrong, immutable, empty, currency] }, null, 2) + '\n';
  assert(!/Bearer\s+|sk-(?:proj-)?[A-Za-z0-9_-]{12,}/.test(text), 'credential_shaped_artifact_denied');
  fs.writeFileSync(path.join(parent, path.basename(output)), text, { mode: 0o600, flag: 'wx' });
}
