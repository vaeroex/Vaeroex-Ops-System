/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic server boundary tests; no external clients. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText, filename);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest); };
const originalLoad = Module._load;
let allowed = true, adminAvailable = true, failure = null, returned = null;
const calls = [], checks = [];
const admin = { rpc: async (name, args) => { calls.push({ name, args }); if (failure === 'throw') throw new Error('PRIVATE PROVIDER PAYLOAD SECRET'); return failure ? { data: null, error: { message: 'PRIVATE CUSTOMER ANSWER SECRET' } } : { data: returned, error: null }; } };
Module._load = function(request, ...rest) {
  if (request === 'server-only') return {};
  if (request === '@/lib/admin/vaeroex-admin') return { getVaeroexAdminAccess: async () => ({ allowed, admin: adminAvailable ? admin : null }) };
  if (request === '@/lib/ai/usage') return { getWorkspaceTokenBudget: () => ({ monthlyTokens: 2_000_000 }) };
  if (request === '@/lib/vsi/config') return { getVsiConfig: () => ({ workspaceMonthlyBudgetUsd: 50 }) };
  return originalLoad.call(this, request, ...rest);
};
const { getAdminUsageData } = require('../lib/admin/usage-data.ts');
const { decodeAdminUsageSnapshot, USAGE_METRIC_KEYS, USAGE_COVERAGE } = require('../lib/admin/usage-metrics.ts');
const { adminReportPeriod, adminWorkspaceFilter, adminReportPage } = require('../lib/admin/report-period.ts');
assert(USAGE_COVERAGE.some(row => row.feature === 'kpi_semantic_classification_v1' && /not measured/.test(row.measurement)));
assert(USAGE_COVERAGE.some(row => row.feature === 'evidence_retrieval_services' && /excluded/.test(row.measurement)));
assert(USAGE_COVERAGE.some(row => row.feature === 'document_extraction_services' && /outside/.test(row.measurement)));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const input = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z', workspaceId: A, page: 2, workspacePage: 3 };
const budget = { monthlyTokenBudget: 2_000_000, monthlyVsiBudgetUsd: 50 };
const totals = values => ({ ...Object.fromEntries(USAGE_METRIC_KEYS.map(key => [key, 0])), ...values });
function fixture() {
 const complete = totals({ estimatedSpendUsd: 0.01234567, uncertainEstimateUsd: 0.25, unknownCostCount: 1, usageRecords: 7501, vsiQuestions: 9, vsiCompleted: 5, vsiFailed: 1, vsiPending: 3, inputTokens: 2300, latencySamples: 2, latencyTotalMs: 2500 });
 return {
  start: input.start, end: input.end, previousStart: '2026-09-24T00:00:00.000Z', page: 2, pageSize: 25, workspacePage: 3, workspacePageSize: 25,
  totals: complete, previous: totals({ estimatedSpendUsd: 0.01 }), unassignedTotals: totals(), outstandingReservedUsd: 0.5,
  trend: [{ day: '2026-10-05T00:00:00.000Z', totals: complete }], features: [{ ...complete, feature: 'vsi' }],
  workspaces: [{ ...complete, id: A, name: 'Synthetic workspace', monthAiTokens: 1000, monthVsiSpendUsd: 0.25, outstandingVsiReservedUsd: 0.5 }],
  workspaceCount: 76, workspaceOptions: [{ id: A, name: 'Synthetic workspace' }, { id: B, name: 'Another synthetic workspace' }],
  details: [{ ...complete, id: B, workspaceId: A, feature: 'vsi', source: 'vsi_cost_events', status: 'completed', createdAt: '2026-10-05T00:00:00.000Z' }],
  detailCount: 15001, budgetPeriodStart: '2026-10-01T00:00:00.000Z', budgetResetsAt: '2026-11-01T00:00:00.000Z'
 };
}
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push(name); }
function assertUnavailable(value, name) {
 assert.ok(value.error, name); assert.equal(value.details.length, 0); assert.equal(value.workspaces.length, 0); assert.doesNotMatch(JSON.stringify(value), /PRIVATE|SECRET|private\.invalid/); checks.push(name);
}
(async () => {
 // UTC accounting remains authoritative over local calendar / DST boundaries.
 const now = new Date('2026-11-01T09:30:00.000Z');
 check('UTC month resets remain explicit', adminReportPeriod('month', now), { range: 'month', start: '2026-11-01T00:00:00.000Z', end: now.toISOString() });
 for (const [range, days] of [['24h', 1], ['7d', 7], ['30d', 30], ['90d', 90]]) {
  const period = adminReportPeriod(range, now); check(`${range} shares exact end and elapsed duration`, [period.end, Date.parse(period.end) - Date.parse(period.start)], [now.toISOString(), days * 86400000]);
 }
 check('invalid period falls back to documented UTC month', adminReportPeriod('PRIVATE PROMPT', now).range, 'month');
 check('workspace IDs normalize', adminWorkspaceFilter(A.toUpperCase()), A);
 check('invalid workspace is not interpolated into filters', adminWorkspaceFilter('id.eq.anything,private.invalid'), '');
 for (const value of [undefined, '-1', '0', '1.5', '100001', '1;drop table', 'Infinity']) check(`page parser rejects ${String(value)}`, adminReportPage(value), 1);
 check('valid page preserved', adminReportPage('27'), 27);

 returned = fixture();
 const report = await getAdminUsageData(input);
 check('complete fixture accepted', report.error, null);
 check('full-period totals are not detail page sums', [report.totals.usageRecords, report.details.length, report.detailCount], [7501, 1, 15001]);
 check('fractional dollars keep recorded precision', report.totals.estimatedSpendUsd, 0.01234567);
 check('selected time, workspace and independent page bounds reach database', calls[0], { name: 'admin_usage_snapshot_v1', args: { p_start: input.start, p_end: input.end, p_workspace_id: A, p_page: 2, p_page_size: 25, p_workspace_page: 3 } });
 check('configured budget stays separate from selected report period', [report.workspaces[0].monthlyTokenBudget, report.workspaces[0].monthlyVsiBudgetUsd, report.budgetResetsAt], [2_000_000, 50, '2026-11-01T00:00:00.000Z']);
 check('latency uses sample denominator', report.details[0].latencyMs, 1250);
 const offsetInput = { ...input, start: '2026-09-30T17:00:00-07:00', end: '2026-10-07T17:00:00-07:00' };
 await getAdminUsageData(offsetInput);check('timezone offsets normalize to the same accounting bounds', [calls.at(-1).args.p_start, calls.at(-1).args.p_end], [input.start, input.end]);
 await getAdminUsageData({ ...input, workspaceId: null, page: -3, workspacePage: 999999 });
 check('all-workspace scope and page limits are explicit', [calls.at(-1).args.p_workspace_id, calls.at(-1).args.p_page, calls.at(-1).args.p_workspace_page], [null, 1, 100000]);

 for (const [name, change] of [
  ['raw top-level provider payload', f => { f.raw_payload = 'PRIVATE PROVIDER SECRET'; }],
  ['unknown metric and nested payload', f => { f.totals.prompt = 'PRIVATE PROMPT'; f.details[0].provider_attempts = [{ raw: 'SECRET' }]; f.features[0].answer = 'PRIVATE ANSWER'; f.workspaces[0].chat_title = 'PRIVATE CHAT'; }]
 ]) {
  const f = fixture(); change(f); const dto = decodeAdminUsageSnapshot(f, input, budget);check(`${name} does not invalidate safe known fields`, dto.error, null);assert.doesNotMatch(JSON.stringify(dto), /PRIVATE|SECRET|raw_payload|provider_attempts|chat_title/);checks.push(`${name} excluded from DTO`);
 }
 for (const [name, change] of [
  ['missing financial field', f => { delete f.totals.estimatedSpendUsd; }],
  ['negative cost', f => { f.totals.estimatedSpendUsd = -1; }],
  ['nonfinite cost', f => { f.totals.estimatedSpendUsd = Infinity; }],
  ['numeric text masquerading as cost', f => { f.totals.estimatedSpendUsd = '0.25'; }],
  ['unrecognized workflow text', f => { f.features[0].feature = 'PRIVATE PROMPT'; }],
  ['raw error masquerading as status', f => { f.details[0].status = 'PRIVATE PROVIDER SECRET'; }],
  ['invalid timestamp', f => { f.details[0].createdAt = 'PRIVATE DATE'; }],
  ['non-UUID detail identifier', f => { f.details[0].id = 'PRIVATE ID'; }],
  ['missing reservation measurement', f => { delete f.outstandingReservedUsd; }],
  ['missing trend table', f => { delete f.trend; }]
 ]) { const f = fixture();change(f);assertUnavailable(decodeAdminUsageSnapshot(f, input, budget), `${name} is unavailable rather than false zero`); }
 for (const f of [null, {}, [], { totals: {} }]) { returned=f;assertUnavailable(await getAdminUsageData(input), 'missing report cannot become a successful zero report'); }
 for (const kind of ['error', 'throw']) { failure=kind;assertUnavailable(await getAdminUsageData(input), `${kind} is sanitized`); }
 failure=null;returned=fixture();
 for (const bad of [{ start: 'nonsense' }, { end: input.start }, { start: '2020-01-01T00:00:00Z' }, { workspaceId: 'PRIVATE QUESTION' }]) { const before=calls.length;assertUnavailable(await getAdminUsageData({ ...input, ...bad }), 'invalid scope safely rejected');check('invalid scope makes no database call', calls.length,before); }
 allowed=false;let before=calls.length;assertUnavailable(await getAdminUsageData(input), 'ordinary user denied at reusable loader');check('denied user makes no privileged call',calls.length,before);
 allowed=true;adminAvailable=false;before=calls.length;assertUnavailable(await getAdminUsageData(input),'missing admin client safely unavailable');check('missing client makes no database call',calls.length,before);
 console.log(JSON.stringify({ passed: true, suite: 'Admin usage loader, strict DTO, UTC period, privacy and authorization', checks: checks.length, externalCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
