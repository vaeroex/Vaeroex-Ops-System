/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS offline harness uses synchronous Node require hooks; no application lint rule is changed. */
const assert = require('node:assert/strict');
require('./qbo-customer-test-support.cjs').installLoader({ 'server-only': {} });
const { vsiEvidenceWindow } = require('../lib/vsi/evidence-window.ts');
const { VSI_SUGGESTED_PROMPTS } = require('../lib/vsi/suggested-prompts.ts');
const now = new Date('2026-10-24T00:01:00Z');
for (const prompt of VSI_SUGGESTED_PROMPTS) {
  assert.deepEqual(vsiEvidenceWindow(prompt.prompt, now), {
    start: prompt.id === 'period-comparison' ? '2026-08-26' : '2026-09-25', end: '2026-10-24'
  });
}
assert.deepEqual(vsiEvidenceWindow('Compare the last 30 days versus the prior 30 days', new Date('2024-03-01T23:59:00Z')), { start: '2024-01-02', end: '2024-03-01' });
assert.deepEqual(vsiEvidenceWindow('Compare the last 90 days with the previous year', now), { start: '2026-09-25', end: '2026-10-24' });
assert.deepEqual(vsiEvidenceWindow('Compare the last 7 days with the prior week', now), { start: '2026-09-25', end: '2026-10-24' });
console.log('Bounded UTC discovery windows passed: five actual suggestions, leap-year boundary and unsupported-range default. No coverage or comparison authority inferred.');
