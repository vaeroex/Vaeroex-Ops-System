/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS regression harness loads actual source functions. */
// Real workbook approval function with an in-memory persistence adapter.
// --baseline reads the audited commit with git show; never checks out or edits it.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), baseline = process.argv.includes('--baseline');
global.fetch = async () => { throw new Error('Network disabled'); };
function load(file, mocks, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const filename = path.join(root, file);
  let source = baseline && file === 'app/app/files/actions.ts' ? execFileSync('git', ['show', 'd91be079c7beb0b6f21a4c5e6b451f90ca06e035:' + file], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(filename, 'utf8');
  if (file === 'app/app/files/actions.ts') source += '\nexport { saveWorkbookImport as auditSaveWorkbookImport };';
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText;
  const mod = { exports: {} }; cache.set(file, mod);
  Function('require', 'module', 'exports', compiled)(name => Object.hasOwn(mocks, name) ? mocks[name] : name === 'server-only' ? {} : name.startsWith('@/') ? load(name.slice(2) + '.ts', mocks, cache) : require(name), mod, mod.exports);
  return mod.exports;
}
async function scenario(failTable, failStatus) {
  const state = { kpis: [], importStatus: 'staged', fileStatus: 'ready', writes: [], claims: 0, gatewayCalls: 0 };
  const supabase = { rpc: async (name, args) => {
    if (name === 'begin_file_import_attempt_v1') state.claims++;
    if (name === 'begin_file_import_attempt_v1' && failTable === 'claim') return failStatus === 'denied' ? { data: { admitted: false, status: 'running' }, error: null } : { data: null, error: { message: 'Claim response lost' } };
    if (name === 'begin_file_import_attempt_v1') return { data: { admitted: true, status: 'running', attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' }, error: null };
    return { data: { status: state.importStatus === 'completed' && state.fileStatus === 'imported' ? 'completed' : args.p_failed ? 'reconciliation_required' : 'running' }, error: null };
  }, from(table) { let operation = 'select', value; const query = {
    select() { return query; }, eq() { return query; }, in() { return query; }, is() { return query; }, limit() { return query; },
    update(v) { operation = 'update'; value = v; return query; }, insert(v) { operation = 'insert'; value = v; return query; },
    then(resolve, reject) { return Promise.resolve().then(() => {
      if (table === failTable && operation === 'update' && (value.status === failStatus || value.import_status === failStatus)) return { data: null, error: { message: 'Synthetic finalization unavailable' } };
      if (operation !== 'select') state.writes.push({ table, operation, value });
      if (table === 'kpis' && operation === 'insert') state.kpis.push(...value);
      if (table === 'file_imports' && operation === 'update' && value.status) state.importStatus = value.status;
      if (table === 'file_uploads' && operation === 'update' && value.import_status) state.fileStatus = value.import_status;
      return { data: table === 'kpis' ? state.kpis : operation === 'update' ? [{ id: 'synthetic-acknowledged-row' }] : [], error: null };
    }).then(resolve, reject); }
  }; return query; } };
  const forbidden = () => { throw new Error('Unexpected provider/auth call'); };
  const mocks = {
    'next/cache': { revalidatePath() {} }, 'next/navigation': { redirect(url) { const error = new Error('REDIRECT'); error.url = url; throw error; } },
    '@/lib/ai/evidence-index': { indexWorksheetImportEvidence: async () => failTable === 'memory' ? ({ indexedChunks: 0, error: 'Synthetic evidence publication unavailable' }) : ({ indexedChunks: 1 }), indexFileAnalysisEvidence: forbidden },
    '@/lib/ai/vaeroex-client': {}, '@/lib/ai/usage': {}, '@/lib/ai/vaeroex-workflows': {}, '@/lib/billing/require-active-subscription': {}, '@/lib/billing/usage-limits': {}, '@/lib/kpis/settings': {}, '@/lib/kpis/semantics': {}, '@/lib/security/rate-limit': {}, '@/lib/security/tool-execution-gateway': { requireToolExecution: async () => { state.gatewayCalls++; if (failTable === 'gateway') throw new Error('This request cannot be performed because it conflicts with platform security requirements.'); } }, '@/lib/supabase/server': {}, '@/lib/workspaces/current': {}
  };
  const { auditSaveWorkbookImport } = load('app/app/files/actions.ts', mocks);
  const formData = new FormData(); formData.set('worksheet_1_enabled', 'on');
  const plan = { index: 1, name: 'Metrics', detected_type: 'kpis', selected_type: 'kpis', enabled: true, status: 'parsed', row_count: 1, columns: ['Metric', 'Value', 'Date'], mapping: { name: 'Metric', actual_value: 'Value', metric_date: 'Date' }, metric_columns: [] };
  try {
    await auditSaveWorkbookImport({ supabase, user: { id: 'synthetic-user' }, workspaceId: 'synthetic-workspace', membership: { role: 'owner' }, file: { id: 'synthetic-file', workspace_id: 'synthetic-workspace', display_name: 'Synthetic CSV', imported_rows: 0, metadata_json: {} }, importRecord: { id: 'synthetic-import', rows_total: 1, mapping_json: { mode: 'workbook', worksheets: [plan] }, errors_json: [] }, stagedRows: [{ id: 'synthetic-row', row_number: 2, data_json: { Metric: 'Revenue', Value: 100, Date: '2026-10-01' }, mapped_data_json: { __source: { worksheet_index: 1, worksheet_name: 'Metrics', row_number: 2 } } }], formData });
  } catch (error) { if (!error.url) throw error; state.redirect = error.url; }
  if (failTable === 'gateway') { assert.equal(state.gatewayCalls, 1); assert.equal(state.claims, 0); assert.equal(state.writes.length, 0); assert.equal(state.kpis.length, 0); const url = new URL(state.redirect, 'http://localhost'); assert.equal(url.pathname, '/app/sources/synthetic-file'); assert.equal(url.searchParams.get('section'), 'imported'); assert.match(url.searchParams.get('error'), /security requirements/); return { failedBoundary: 'gateway', authorizationRetained: true, claims: 0, mutations: 0, feedbackRedirect: true }; }
  if (failTable === 'claim') { assert.equal(state.writes.length, 0, 'claim loser cannot mutate row mapping/type/status or settings'); assert.equal(state.kpis.length, 0); assert(!new URL(state.redirect, 'http://localhost').searchParams.has('message')); return { failedBoundary: 'claim:' + failStatus, mutations: 0, preservedWinningState: true }; }
  assert.equal(state.kpis.length, 1, 'the original accepted business record must be retained');
  const successful = new URL(state.redirect, 'http://127.0.0.1').searchParams.has('message');
  if (baseline) assert.equal(successful, true, 'audited baseline should reproduce a false success');
  else { assert.equal(successful, false, 'a failed finalization must not report successful completion'); assert.equal(state.importStatus, 'failed'); assert.equal(state.fileStatus, 'failed'); }
  return { failedBoundary: failTable + ':' + failStatus, acceptedKpiRows: state.kpis.length, successRedirect: successful, importStatus: state.importStatus, fileStatus: state.fileStatus, finalImport: state.writes.filter(w => w.table === 'file_imports').at(-1)?.value };
}
(async () => { const results = []; if (!baseline) { results.push(await scenario('gateway', 'denied')); for (const failure of ['denied', 'ack-lost']) results.push(await scenario('claim', failure)); results.push(await scenario('memory', 'failed')); } for (const test of [['file_import_rows', 'imported'], ['file_imports', 'completed'], ['file_uploads', 'imported']]) results.push(await scenario(...test)); console.log(JSON.stringify({ status: 'passed', baseline, checks: results.length, results, limitation: 'Actual workbook function, synthetic in-memory DB and indexing adapter. No real SQL transaction/concurrent retry or UI validation.' }, null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
