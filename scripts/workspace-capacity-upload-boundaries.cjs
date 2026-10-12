/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated upload qualification; no customer credentials. */
// Run under the existing capacity OS network sandbox. Retain every uploaded
// original and preparation result; this is a boundary check, not a load pass.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { openState, readProcessMetrics } = require('./workspace-capacity-state.cjs');
const privateJson = file => { assert.equal(fs.statSync(file).mode & 0o077, 0, 'private_configuration_required'); return JSON.parse(fs.readFileSync(file, 'utf8')); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main(runtimeFile, expectedCommit, mode = 'all') {
  assert(['all', 'browser-only', '--supported-profile'].includes(mode), 'bounded_check_mode_required');
  assert(/^[a-f0-9]{40}$/.test(expectedCommit), 'exact_application_commit_required');
  const cfg = privateJson(runtimeFile), plan = privateJson(cfg.planFile), processesFile = path.join(cfg.out, 'processes.json');
  const initial = privateJson(processesFile), adapters = privateJson(path.join(cfg.out, 'adapters.private.json'));
  assert.equal(cfg.syntheticOnly, true); assert.equal(cfg.paidCredentialsPresent, false);
  const uploadProfile = mode === '--supported-profile' ? 'supported_rows_v1' : 'agreed_large_rows_v1';
  if (mode === '--supported-profile') assert.equal(cfg.uploadProfile, uploadProfile, 'runtime_supported_profile_required');
  assert.equal(initial.sourceCommit, expectedCommit); assert.equal(initial.buildMode, 'production'); assert.equal(initial.diagnosticPreload, false);
  assert.equal(plan.runId, cfg.runId); assert.equal(adapters.runId, cfg.runId); assert.equal(adapters.instanceNonce, initial.instanceNonce);
  assert.equal(adapters.sourceCommit, expectedCommit); assert.equal(process.env.NODE_EXTRA_CA_CERTS, cfg.cert);
  assert.equal(new URL(cfg.appOrigin).hostname, '127.0.0.1'); assert.equal(new URL(cfg.appOrigin).protocol, 'https:');
  const net = require('node:net');
  const denial = await new Promise(resolve => { const s = net.connect({ host: '192.0.2.1', port: 9 }); s.on('connect', () => { s.destroy(); resolve('connected'); }); s.on('error', e => resolve(e.code)); s.setTimeout(2000, () => { s.destroy(); resolve('timeout'); }); });
  assert.equal(denial, 'EPERM', 'kernel_external_network_denial_required');
  const executionId = randomUUID(), output = path.join(cfg.out, 'upload-boundaries', executionId);
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const { uploadCsv, uploadRecordCount, uploadTargetBytes, guardedFetch } = await import('../docs/security/audit-evidence/stage-3/http/core.mjs');
  const owner = plan.actors.find(a => a.active && a.role === 'owner'), adapter = adapters.upload.byActor[owner.id];
  assert(adapter && adapter.path === '/app/sources' && adapter.encoding === 'multipart', 'captured_owner_upload_required');
  const state = await openState({ configFile: cfg.configFile, planFile: cfg.planFile, outputDir: cfg.out });
  const results = [], browserErrors = [], foreignRequests = []; let browser;
  const guard = () => { const now = privateJson(processesFile); assert.equal(now.buildId, initial.buildId); assert.equal(now.sourceCommit, expectedCommit); assert.equal(now.instanceNonce, initial.instanceNonce); assert.equal(now.app.pid, initial.app.pid); process.kill(now.app.pid, 0); };
  const metrics = () => ({ observedAt: new Date().toISOString(), ...readProcessMetrics(path.join(cfg.out, 'process-metrics'), [initial.app.pid]) });
  const evidence = () => ({ kind: 'isolated_upload_boundary_verification', executionId, runId: cfg.runId, sourceCommit: expectedCommit, buildId: initial.buildId, uploadProfile,
    schemaFingerprint: state.schemaFingerprint, nextConfigOverride: initial.nextConfigOverride, osExternalNetworkDenied: denial,
    results, browserErrors, foreignRequests, allOriginalsAndRowsRetained: true, activeUserCapacityClaim: false,
    limits: 'Sequential component checks with local Supabase; 30-second diagnostic bound is not a relaxed workload threshold. Over-limit uploads are preparation failures, never successful import workload samples.' });
  const record = result => { results.push(result); write('result.json', evidence()); console.log(JSON.stringify({ case: result.label, rows: result.expectedRows, bytes: result.bytes, status: result.status, ackMs: result.ackMs, preparationAccepted: result.preparationAccepted, stagedRows: result.persisted.stagedRows, browserAutomatic: result.browser?.automatic || false })); };
  function csvCase(sequence) { const csv = uploadCsv(sequence, uploadProfile), expectedRows = uploadProfile === 'supported_rows_v1' ? 1000 : uploadRecordCount(sequence); assert.equal(Buffer.byteLength(csv), uploadTargetBytes(sequence)); assert.equal(csv.trimEnd().split('\n').length - 1, expectedRows); return { csv, expectedRows }; }
  function boundaryCase() { const csv = uploadCsv(0) + '2026-09-01,100,boundary-row-1001\n'; return { csv, expectedRows: 1001 }; }
  function responseRedirect(headers, expectedRows) {
    const locations = [headers.get('location'), headers.get('x-action-redirect')?.split(';')[0]].filter(Boolean); assert(locations.length, 'automatic_action_redirect_required');
    for (const raw of locations) assert.equal(new URL(raw, cfg.appOrigin).origin, cfg.appOrigin, 'external_redirect_denied');
    const url = new URL(locations.at(-1), cfg.appOrigin); assert(/^\/app\/sources\/[a-f0-9-]{36}$/.test(url.pathname), 'saved_source_destination_required');
    assert.equal(url.searchParams.get('section'), 'imported');
    if (expectedRows <= 1000) { assert.equal(url.searchParams.get('error'), null); assert(url.searchParams.get('message')?.startsWith('Data extracted from 1000 rows'), 'correct_preparation_feedback_required'); }
    else { assert(url.searchParams.get('error')?.includes(`contains ${expectedRows} data rows`), 'truthful_row_count_required'); assert(url.searchParams.get('error').includes('no rows were staged'), 'truthful_limit_feedback_required'); }
    return url;
  }
  async function persisted(id, filename, csv, expectedRows) {
    const files = (await state.db.query('select id,workspace_id,original_name,file_size_bytes,storage_bucket,storage_path,import_status,processing_status,processing_error,imported_rows,created_by from public.file_uploads where workspace_id=$1 and original_name=$2', [owner.workspaceId, filename])).rows;
    assert.equal(files.length, 1, 'exactly_one_saved_original_required'); const f = files[0]; assert.equal(f.id, id); assert.equal(f.created_by, owner.id); assert.equal(Number(f.file_size_bytes), Buffer.byteLength(csv));
    const stored = await state.actorClient(owner.id).storage.from(f.storage_bucket).download(f.storage_path); assert(!stored.error, 'owner_storage_download_required');
    const bytes = Buffer.from(await stored.data.arrayBuffer()); assert.equal(bytes.length, Buffer.byteLength(csv)); assert.equal(sha(bytes), sha(csv), 'original_must_be_byte_identical');
    const importRows = (await state.db.query('select row_number,status,data_json,imported_record_id from public.file_import_rows where workspace_id=$1 and file_upload_id=$2 order by row_number', [owner.workspaceId, id])).rows;
    const imports = (await state.db.query('select id,status,rows_total,rows_imported,reviewed_at,imported_at from public.file_imports where workspace_id=$1 and file_upload_id=$2', [owner.workspaceId, id])).rows;
    const counts = (await state.db.query('select (select count(*)::int from public.kpis where workspace_id=$1 and source_file_id=$2) kpis,(select count(*)::int from public.operational_metrics where workspace_id=$1 and source_file_id=$2) metrics', [owner.workspaceId, id])).rows[0];
    assert.equal(counts.kpis, 0); assert.equal(counts.metrics, 0); assert.equal(Number(f.imported_rows), 0);
    if (expectedRows <= 1000) { assert.equal(f.import_status, 'extracted'); assert.equal(f.processing_status, 'ready'); assert.equal(f.processing_error, null); assert.equal(importRows.length, 1000); assert.equal(imports.length, 1); assert.equal(imports[0].status, 'needs_review'); assert.equal(imports[0].rows_total, 1000); assert.equal(imports[0].rows_imported, 0); assert.equal(imports[0].imported_at, null); assert(importRows.every(r => r.status === 'staged' && r.imported_record_id === null)); assert.equal(new Set(importRows.map(r => r.row_number)).size, 1000); const markers = new Set(importRows.map(r => r.data_json.Marker)); for (const line of csv.trimEnd().split('\n').slice(1)) assert(markers.has(line.split(',')[2]), 'staged_row_loss_or_duplicate'); }
    else { assert.equal(f.import_status, 'failed'); assert.equal(f.processing_status, 'failed'); assert(f.processing_error.includes(`contains ${expectedRows} data rows`)); assert(f.processing_error.includes('no rows were staged')); assert.equal(importRows.length, 0); assert.equal(imports.length, 0); }
    return { fileId: id, fileSizeBytes: Number(f.file_size_bytes), originalSha256: sha(csv), storedSha256: sha(bytes), originalRetained: true, ownerDownloadVerified: true,
      importStatus: f.import_status, processingStatus: f.processing_status, processingError: f.processing_error, stagedRows: importRows.length, importRecords: imports.length, kpiWrites: counts.kpis, metricWrites: counts.metrics, duplicateOrLostStagedRows: 0 };
  }
  async function http(label, fixture) {
    guard(); const id = randomUUID(), filename = `SYNTHETIC-UPLOAD-BOUNDARY-${id}.csv`, body = new FormData();
    for (const e of adapter.entries) if (e.fileFixture) body.append(e.name, new Blob([fixture.csv], { type: 'text/csv' }), filename); else body.append(e.name, e.value.replaceAll('{{logicalId}}', id));
    const before = metrics(), start = performance.now(); const response = await guardedFetch(cfg.appOrigin, adapter.path, { method: 'POST', timeoutMs: 30000, headers: { ...adapter.headers, cookie: state.sessions.actors[owner.id].cookie, origin: cfg.appOrigin, 'x-audit-run-id': cfg.runId, 'x-audit-logical-id': id }, body });
    const ackMs = performance.now() - start, after = metrics(); assert.equal(response.status, 303, 'action_completion_redirect_required'); const url = responseRedirect(response.headers, fixture.expectedRows);
    record({ label, transport: 'captured_authenticated_server_action', expectedRows: fixture.expectedRows, bytes: Buffer.byteLength(fixture.csv), status: response.status, ackMs, preparationAccepted: fixture.expectedRows <= 1000,
      workloadMutationAckThresholdMs: 2000, individuallyWithinAckThreshold: ackMs <= 2000, persisted: await persisted(url.pathname.split('/').at(-1), filename, fixture.csv, fixture.expectedRows), resourceSnapshots: { before, after } }); guard();
  }
  async function browserCase(label, fixture, width) {
    guard(); const id = randomUUID(), filename = `SYNTHETIC-UPLOAD-BOUNDARY-${id}.csv`;
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addCookies(state.sessions.actors[owner.id].cookie.split(';').map(s => { const i = s.indexOf('='); return { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim(), url: cfg.appOrigin }; }));
    await context.route('**/*', route => { const u = new URL(route.request().url()); if ([cfg.appOrigin, state.apiOrigin].includes(u.origin)) return route.continue(); foreignRequests.push({ origin: u.origin, method: route.request().method() }); return route.abort('blockedbyclient'); });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => browserErrors.push({ label, name: e.name }));
      await page.goto(cfg.appOrigin + '/app/sources', { waitUntil: 'domcontentloaded' }); assert.equal(new URL(page.url()).pathname, '/app/sources');
      await page.locator('#workspace-file-upload > summary').click(); await page.locator('input[name=file]').setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(fixture.csv) }); await page.locator('input[name=display_name]').fill('SYNTHETIC boundary ' + id);
      const before = metrics(), start = performance.now(), action = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).origin === cfg.appOrigin && !!r.request().headers()['next-action']);
      const transition = page.waitForURL(u => /^\/app\/sources\/[a-f0-9-]{36}$/.test(u.pathname) && u.searchParams.get('section') === 'imported');
      await page.getByRole('button', { name: 'Upload and prepare review', exact: true }).click(); const response = await action; const ackMs = performance.now() - start; assert.equal(response.status(), 303);
      const url = responseRedirect(new Headers(await response.allHeaders()), fixture.expectedRows); await transition;
      const feedback = url.searchParams.get(fixture.expectedRows <= 1000 ? 'message' : 'error'); await page.getByText(feedback, { exact: false }).first().waitFor();
      // A URL change and toast can precede the streamed destination. Require
      // the actual saved source, not just the loading shell, without reloading.
      await page.getByRole('heading', { name: 'SYNTHETIC boundary ' + id, exact: true }).waitFor();
      await page.getByText('Loading Vaeroex module', { exact: true }).waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]')); assert.equal(new URL(page.url()).pathname, url.pathname);
      await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
      record({ label, transport: 'authenticated_browser', width, expectedRows: fixture.expectedRows, bytes: Buffer.byteLength(fixture.csv), status: response.status(), ackMs, preparationAccepted: fixture.expectedRows <= 1000,
        workloadMutationAckThresholdMs: 2000, individuallyWithinAckThreshold: ackMs <= 2000, browser: { automatic: true, feedbackVisible: true, pendingCleared: true, destinationRendered: true, manualRecoveryNavigation: false, transitionMs: performance.now() - start },
        persisted: await persisted(url.pathname.split('/').at(-1), filename, fixture.csv, fixture.expectedRows), resourceSnapshots: { before, after: metrics() } }); guard();
    } finally { await context.close(); }
  }
  try {
    if (mode === 'all') { await http('http-1000', csvCase(0)); await http('http-1001', boundaryCase()); await http('http-10000', csvCase(16)); await http('http-50000', csvCase(19)); }
    if (mode === '--supported-profile') { await http('supported-http-1000-medium', csvCase(16)); await http('supported-http-1000-large', csvCase(19)); }
    browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking'] });
    if (mode === '--supported-profile') await browserCase('supported-browser-mobile-1000-large', csvCase(19), 390);
    else { await browserCase('browser-desktop-1000', csvCase(0), 1440); await browserCase('browser-mobile-1001', boundaryCase(), 390); }
    assert.equal(foreignRequests.length, 0); assert.equal(browserErrors.length, 0); write('result.json', { ...evidence(), passed: true }); console.log(JSON.stringify({ passed: true, cases: results.length, evidence: path.join(output, 'result.json'), capacityClaim: false }));
  } catch (error) { write('result.json', { ...evidence(), passed: false, failure: { name: error.name, code: error.code || null, reason: /^[a-z0-9_ :.-]+$/i.test(error.message) ? error.message : 'boundary_assertion_failed' } }); throw error; }
  finally { if (browser) await browser.close(); await state.close(); }
}
if (require.main === module) main(...process.argv.slice(2)).catch(e => { console.error(JSON.stringify({ boundaryCheckFailed: true, error: e.name, code: e.code || null })); process.exitCode = 1; });
module.exports = { main };
