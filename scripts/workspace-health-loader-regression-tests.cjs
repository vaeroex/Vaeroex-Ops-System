/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node contract test with TypeScript module adapters. */
// Pure production filters/calculations execute; database, history storage, token signing and approved-note I/O are synthetic.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json')), ts = req('typescript');
// Shared lib modules are included in worker images without the UI tree. Even
// erased type imports must resolve during those image builds.
function assertSharedLoaderDependencies(source) {
    const tree = ts.createSourceFile('workspace-health.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specifiers = [];
    const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifiers.push(node.argument.literal.text);
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length && ts.isStringLiteral(node.arguments[0])) specifiers.push(node.arguments[0].text);
        ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const specifier of specifiers) {
        const resolved = specifier.startsWith('@/') ? path.resolve(root, specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(root, 'lib/intelligence', specifier) : null;
        assert(!resolved || resolved !== path.join(root, 'components') && !resolved.startsWith(path.join(root, 'components') + path.sep), 'shared Health loader must not depend on UI components, including type-only imports');
    }
}
const loaderSource = fs.readFileSync(path.join(root, 'lib/intelligence/workspace-health.ts'), 'utf8');
assertSharedLoaderDependencies(loaderSource);
for (const uiImport of [
    'import type { BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";',
    'type ForbiddenUiType = import("../../components/intelligence/BusinessHealthTrendChart").BusinessHealthTrendPoint;',
    'export type { BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";'
]) assert.throws(() => assertSharedLoaderDependencies(loaderSource + '\n' + uiImport), /must not depend on UI/);
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (r, p, ...args) { return resolve.call(this, r.startsWith('@/') ? path.join(root, r.slice(2)) : r, p, ...args); };
const originalLoad = Module._load;
let state;
const originalDate = Date;
global.Date = class extends originalDate {
    constructor(...args) { super(...(args.length ? args : ['2026-10-05T12:00:00.000Z'])); }
    static now() { return new originalDate('2026-10-05T12:00:00.000Z').getTime(); }
};
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
Module._load = function (r, p, ...args) {
    if (r === 'server-only')
        return {};
    if (r === '@/lib/kpis/load-workspace-kpis')
        return { loadActiveWorkspaceKpis: async ({ workspaceId }) => { state.trace.push(['loadActiveWorkspaceKpis', workspaceId]); return { data: state.rows.kpis || [], error: state.error === 'kpis' ? new Error('synthetic kpis unavailable') : null, complete: true }; } };
    if (r === '@/lib/ai/evidence-index')
        return { filterEligibleMemoryRowsByLifecycle: async ({ workspaceId, rows }) => { state.trace.push(['memoryEligibility', workspaceId, rows]); if (state.error === 'memoryEligibility')
                throw Error('synthetic memory unavailable'); return rows.filter(x => !x.archived_at && !x.deleted_at); } };
    if (r === '@/lib/intelligence/source-parent-eligibility') {
        const actual = originalLoad.call(this, r, p, ...args);
        return { ...actual, loadSourceParentEligibilityResult: async ({ workspaceId, rows }) => { state.trace.push(['sourceParents', workspaceId, rows]); return { eligibility: actual.buildSourceParentEligibility({ files: state.rows.file_uploads || [], imports: state.rows.file_imports || [] }), error: state.error === 'sourceParents' ? new Error('synthetic parent unavailable') : null }; } };
    }
    if (r === '@/lib/intelligence/business-health-history') {
        const actual = originalLoad.call(this, r, p, ...args);
        return { ...actual, recordDailyBusinessHealthSnapshot: async (_client, x) => { state.trace.push(['recordDaily', x]); state.writes.push(x); }, getBusinessHealthSnapshotResult: async (_client, w) => { state.trace.push(['getHistory', w]); return { snapshots: state.snapshots || [], errorMessage: state.error === 'history' ? 'synthetic history unavailable' : null }; } };
    }
    if (r === '@/lib/ai/business-notes/contextual-evidence')
        return { loadApprovedBusinessNoteContextV1: async ({ workspaceId, releaseChannel, asOf }) => { state.trace.push(['notes', workspaceId, releaseChannel, asOf]); return { records: [], error: null }; } };
    if (r === '@/lib/ai/business-health-explanation/token')
        return { trySealBusinessHealthExplanationPackage: x => { state.trace.push(['seal', x]); return 'synthetic-' + sha(JSON.stringify(x)); } };
    if (r === '@/lib/ai/business-health-explanation/storage')
        return { loadBusinessHealthAnalysisState: async ({ workspaceId, analysisPackage, requestTokenAvailable }) => { state.trace.push(['analysisState', workspaceId, analysisPackage, requestTokenAvailable]); return { status: 'available', artifact: null, message: null }; } };
    return originalLoad.call(this, r, p, ...args);
};
process.env.VERCEL_ENV = 'production';
const workspaceId = '11111111-1111-4111-8111-111111111111', userId = '22222222-2222-4222-8222-222222222222', date = '2026-10-01T12:00:00.000Z';
const settings = { id: 'setting', workspace_id: workspaceId, name: 'Revenue', category: 'Sales', weight: 5, sort_order: 0, color: '#0055aa', desired_direction: 'increase', metric_kind: 'currency', classification_confirmed: true, classification_status: 'confirmed', target: 100, archived_at: null, deleted_at: null };
const base = { kpis: [80, 90, 85].map((x, i) => ({ id: 'kpi' + i, workspace_id: workspaceId, name: 'Revenue', actual_value: x, target: 100, metric_date: '2026-10-0' + (i + 1), created_at: date, updated_at: date, unit: 'USD', category: 'Sales', archived_at: null, deleted_at: null, source_file_id: null, raw_data_json: {} })), kpi_settings: [settings], issues: [{ id: 'issue', workspace_id: workspaceId, title: 'Synthetic late delivery', description: 'Observed delay', status: 'Open', severity: 'High', created_at: date, updated_at: date, archived_at: null, deleted_at: null }], file_uploads: [{ id: 'file', workspace_id: workspaceId, display_name: 'Synthetic source', original_name: 'Source.csv', file_extension: 'csv', created_at: date, updated_at: date, archived_at: null, deleted_at: null, metadata_json: {} }] };
function client() { return { from(table) { const ops = []; const query = new Proxy({}, { get(_, key) { if (key === 'then')
            return (resolve, reject) => { state.trace.push(['query', table, ...ops]); return Promise.resolve({ data: state.rows[table] || [], error: state.error === table ? new Error('synthetic ' + table + ' unavailable') : null }).then(resolve, reject); }; return (...args) => { ops.push([key, ...args]); return query; }; } }); return query; } }; }
async function run(fn, test) { state = { rows: structuredClone(test.empty ? {} : base), error: test.error, trace: [], writes: [] }; if (test.inactive)
    state.rows.file_uploads[0].archived_at = date; let value, error; try {
    value = await fn({ supabase: client(), workspaceId, workspace: { id: workspaceId, name: 'Synthetic owner workspace' }, userId: test.userId === null ? null : userId, comparisonTrends: [{ name: 'Revenue', changePercent: -4 }], includeAnalysis: test.includeAnalysis !== false });
}
catch (e) {
    error = { name: e.name, message: e.message };
} return { value, error, trace: state.trace, writes: state.writes }; }
(async () => {
    const shared = req(path.join(root, 'lib/intelligence/workspace-health.ts')).loadWorkspaceHealth;
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/workspace-health-extraction-contract.json'), 'utf8'));
    const cases = [{ name: 'populated' }, { name: 'empty', empty: true }, { name: 'inactive-parent', inactive: true }, { name: 'no-user', userId: null }, { name: 'analysis-disabled', includeAnalysis: false }, ...['forms', 'form_submissions', 'history'].map(error => ({ name: 'failure:' + error, error }))];
    for (const test of cases) {
        const result = await run(shared, test);
        assert.equal(result.error, undefined, test.name + ' must complete without a loader error');
        const contract = JSON.parse(JSON.stringify({ trace: result.trace, model: result.value.executiveHomepageModel, evidence: result.value.evidence, history: result.value.businessHealthHistory, analysisPackage: result.value.businessHealthAnalysisPackage, token: result.value.businessHealthAnalysisToken, state: result.value.businessHealthAnalysisState, error: result.error, writes: result.writes }, (_key, value) => value instanceof Error ? { name: value.name, message: value.message } : value));
        const expected = fixture.cases.find(x => x.name === test.name).componentHashes;
        for (const [key, value] of Object.entries(contract)) {
            assert.equal(sha(JSON.stringify(value)), expected[key], test.name + ' preserves baseline ' + key);
        }
        assert.deepEqual(Object.keys(contract), Object.keys(expected), test.name + ' checks every retained component');
        if (test.name === 'populated') {
            assert.deepEqual(contract.model, fixture.reviewablePopulatedContract.model);
            assert.deepEqual(contract.writes, fixture.reviewablePopulatedContract.writes);
            assert.deepEqual(contract.trace.filter(x => x[0] === 'query'), fixture.reviewablePopulatedContract.directQueries);
        }
        const queries = result.trace.filter(x => x[0] === 'query');
        assert.equal(queries.length, 15, test.name + ' has fifteen direct queries and one complete KPI loader');
        assert(queries.every(x => x.some(op => Array.isArray(op) && op[0] === 'eq' && op[1] === 'workspace_id' && op[2] === workspaceId)), test.name + ' scopes every query to the authenticated workspace');
    }
    // Core source failures must remain visible in evidence. The pre-existing full-view
    // consistency assertion on these failures is recorded in one-off parity evidence,
    // not blessed as the desired UI contract by this regression.
    const { loadWorkspaceHealthEvidence } = req(path.join(root, 'lib/intelligence/workspace-health.ts'));
    const errors = ['kpis', 'kpi_settings', 'issues', 'sops', 'file_uploads', 'file_imports', 'assets', 'crm_leads', 'crm_lead_history', 'ai_agent_runs', 'operational_metrics', 'people', 'business_decisions', 'business_memory_chunks', 'sourceParents', 'memoryEligibility'];
    for (const error of errors) {
        state = { rows: structuredClone(base), error, trace: [], writes: [] };
        const evidence = await loadWorkspaceHealthEvidence({ supabase: client(), workspaceId });
        assert.equal(evidence.businessHealthSourceErrors.length, 1, error + ' is not silently treated as complete data');
        assert.equal(evidence.errors.length, 1, error + ' propagates its source failure');
        assert.equal(state.writes.length, 0, 'loading evidence never writes a snapshot');
    }
    console.log(`Workspace Health loader regression passed: ${cases.length} exact baseline contracts and ${errors.length} source-error cases.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
