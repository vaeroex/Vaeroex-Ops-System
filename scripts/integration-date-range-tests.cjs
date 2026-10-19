/* eslint-disable @typescript-eslint/no-require-imports -- Compile the production range validator for Node tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../lib/integrations/date-range.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { resolveImportRange, resolveViewRange, inclusiveDateCount, recentDateRange } = compiled.exports;
const now = new Date('2026-10-19T07:10:00Z');

test('default import is 30 inclusive UTC dates with today captured, not a future full day', () => {
  assert.deepEqual(resolveImportRange(null, null, now), { startDate: '2026-09-20', endDate: '2026-10-19', startAt: '2026-09-20T00:00:00.000Z', endAt: now.toISOString() });
});
test('older years and leap years are accepted with an exclusive next-day boundary', () => {
  assert.deepEqual(resolveImportRange('2012-01-01', '2012-12-31', now), { startDate: '2012-01-01', endDate: '2012-12-31', startAt: '2012-01-01T00:00:00.000Z', endAt: '2013-01-01T00:00:00.000Z' });
  assert.equal(inclusiveDateCount('2024-02-28', '2024-03-01'), 3);
  assert.deepEqual(recentDateRange(30, '2026-03-15'), { startDate: '2026-02-14', endDate: '2026-03-15' });
});
test('invalid, partial, future and oversized imports are rejected before provider reads', () => {
  for (const pair of [['2026-02-30', '2026-03-01'], ['2025-02-29', '2025-03-01'], ['2026-10-20','2026-10-20'], ['2026-10-19','2026-10-18'], ['2024-01-01','2025-01-01'], ['', '2026-01-01'], ['2026-01-01', null], [['2026-01-01'], '2026-02-01'], ['0000-01-01','0000-01-02']]) {
    assert.throws(() => resolveImportRange(...pair, now), /invalid_date_range/);
  }
});
test('saved history defaults to all and can browse years without import batch limits', () => {
  assert.deepEqual(resolveViewRange(undefined, undefined, now), { startDate: null, endDate: null });
  assert.deepEqual(resolveViewRange('2010-01-01', '2026-10-19', now), { startDate: '2010-01-01', endDate: '2026-10-19' });
  assert.throws(() => resolveViewRange('2026-01-01', undefined, now), /invalid_date_range/);
});
