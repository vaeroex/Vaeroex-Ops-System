/* eslint-disable @typescript-eslint/no-require-imports -- One synthetic saved-artifact mutation after the preservation matrix. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { chromium } = require('playwright');
const { validate, inspectStatus, openOwnedDatabase } = require('./workspace-capacity-confine-stack.cjs');
const { read, write, hash, session, inventory, verifyLedger, denyNetwork } = require('./intelligence-health-fixtures.cjs');
const [runtimeFile, commit, passedMatrixFile] = process.argv.slice(2);
assert(runtimeFile && /^[a-f0-9]{40}$/.test(commit) && passedMatrixFile, 'runtime_commit_successful_matrix_required');
const runtime = read(runtimeFile), ctx = validate(runtime.configFile, runtimeFile), plan = read(runtime.planFile), matrix = read(passedMatrixFile), manifest = read(path.join(runtime.out, 'processes.json'));
assert.equal(matrix.passed, true); assert.equal(matrix.sourceCommit, commit); assert.equal(matrix.runId, plan.runId); assert.equal(manifest.sourceCommit, commit); assert.equal(matrix.buildId, manifest.buildId);
assert.equal(process.env.NODE_EXTRA_CA_CERTS, runtime.cert); assert.equal(plan.kind, 'isolated_health_functional_v1');
const output = path.join(runtime.out, 'health-save-' + randomUUID()); fs.mkdirSync(output, { mode: 0o700 });
const result = { kind: 'health_existing_artifact_save_v1', sourceCommit: commit, buildId: manifest.buildId, runId: plan.runId, matrixEvidenceSha256: hash(fs.readFileSync(passedMatrixFile)), harnessSha256: hash(fs.readFileSync(__filename)), startedAt: new Date().toISOString(), generationSubmitted: false, productionTouched: false, capacityClaim: false, passed: false, errors: [], checks: [] };
const w = plan.workspaces.find(w => w.kind === 'current'), owner = plan.actors.find(a => a.kind === 'current');
let db, browser;
const save = () => write(path.join(output, 'result.json'), result);
(async () => {
  try {
    result.osNetworkDenial = await denyNetwork(); await inspectStatus(ctx); db = (await openOwnedDatabase(ctx)).db; result.databaseIdentity = await verifyLedger(db);
    const ids = plan.workspaces.map(w => w.id), reportIds = plan.workspaces.filter(w => w.reportId).map(w => w.reportId);
    const originals = async () => (await db.query('select id,to_jsonb(r) row from public.reports r where id=any($1::uuid[]) order by id', [reportIds])).rows.map(r => ({ id: r.id, sha256: hash(JSON.stringify(r.row)) }));
    const originalReports = await originals(), before = await inventory(db, ids), previous = await inventory(db, ids, true);
    const artifact = (await db.query('select output_json from public.ai_agent_runs where id=$1 and workspace_id=$2', [w.historicalRunId, w.id])).rows[0].output_json;
    const canonicalKey = hash([w.id, 'development', 'business_health', w.historicalRunId, artifact.contractVersion, artifact.fingerprint].join('\n'));
    const canonical = async () => (await db.query("select id,source_data_json from public.reports where workspace_id=$1 and source_data_json->>'saved_analysis_key'=$2", [w.id, canonicalKey])).rows;
    assert.equal((await canonical()).length, 0, 'fresh_canonical_save_required');
    const auth = await session(ctx.config, owner, runtime);
    browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking'] });
    const open = async width => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: 'America/Los_Angeles', viewport: { width, height: 1000 }, serviceWorkers: 'block' }); await context.addCookies(auth.cookies);
      await context.route('**/*', route => { if (new URL(route.request().url()).origin === runtime.appOrigin) return route.continue(); result.errors.push('nonlocal_browser_request'); return route.abort('blockedbyclient'); });
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => result.errors.push(hash(e.message))); page.on('console', m => { if (m.type() === 'error' && !m.text().includes("upgrade-insecure-requests' is ignored")) result.errors.push(hash(m.text())); });
      await page.goto(runtime.appOrigin + '/app/intelligence', { waitUntil: 'domcontentloaded' }); await page.locator('#business-health').getByRole('button', { name: 'View analysis', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByText(w.label + ' preserved historical analysis [1].', { exact: true }).waitFor(); return { context, page, dialog };
    };
    const desktop = await open(1440), button = desktop.dialog.getByRole('button', { name: 'Save Analysis', exact: true });
    await button.waitFor(); await desktop.page.waitForFunction(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Save Analysis'); return b && !b.disabled; });
    const requestPromise = desktop.page.waitForRequest(r => r.method() === 'POST' && Boolean(r.headers()['next-action']));
    await button.click(); const request = await requestPromise;
    await desktop.dialog.getByText('Already saved', { exact: true }).waitFor();
    const rows = await canonical(); assert.equal(rows.length, 1, 'one_canonical_report_required'); const reportId = rows[0].id;
    assert.deepEqual(rows[0].source_data_json.artifact, artifact); assert.deepEqual(rows[0].source_data_json.citations, artifact.citations);
    const savedLink = desktop.dialog.getByRole('link', { name: 'View saved analysis', exact: true }); assert.equal(await savedLink.getAttribute('href'), '/app/reports/' + reportId);
    assert.equal(await desktop.dialog.getByText(/Checking\.\.\.|Saving\.\.\./).count(), 0, 'save_pending_did_not_clear');
    result.checks.push({ name: 'save_existing_validated_artifact', width: 1440, automaticFeedback: 'Already saved', pendingCleared: true, newReports: 1, artifactAndCitationsCopiedExactly: true }); save();
    const headers = Object.fromEntries(Object.entries(request.headers()).filter(([k]) => ['next-action', 'next-router-state-tree', 'content-type', 'accept'].includes(k)));
    const replay = { url: request.url(), headers, body: request.postData() }; assert.equal(new URL(replay.url).origin, runtime.appOrigin); assert.equal(typeof replay.body, 'string');
    const repeated = await desktop.page.evaluate(async input => Promise.all([1, 2].map(async () => { const response = await fetch(input.url, { method: 'POST', headers: input.headers, body: input.body, redirect: 'error' }); return { status: response.status, text: await response.text() }; })), replay);
    for (const r of repeated) { assert.equal(r.status, 200); assert(r.text.includes('already_saved') && r.text.includes(reportId), 'repeated_save_did_not_acknowledge_existing_report'); }
    assert.equal((await canonical()).length, 1); result.checks.push({ name: 'two_repeated_authenticated_save_requests', acknowledgedAlreadySaved: 2, canonicalReports: 1, requestBodySha256: hash(replay.body) });
    await desktop.page.screenshot({ path: path.join(output, 'saved-desktop.png'), fullPage: true }); await desktop.context.close();
    const mobile = await open(390); await mobile.dialog.getByText('Already saved', { exact: true }).waitFor(); assert.equal(await mobile.dialog.getByRole('button', { name: 'Save Analysis', exact: true }).count(), 0); assert.equal(await mobile.dialog.getByText(/Checking\.\.\.|Saving\.\.\./).count(), 0);
    await mobile.page.screenshot({ path: path.join(output, 'saved-mobile.png'), fullPage: true });
    const navigation = mobile.page.waitForURL(u => u.pathname === '/app/reports/' + reportId); await mobile.dialog.getByRole('link', { name: 'View saved analysis', exact: true }).click(); await navigation;
    const summary = mobile.page.locator('[data-saved-analysis-renderer] summary').filter({ hasText: /^Supporting evidence/ }); await summary.focus(); await mobile.page.keyboard.press('Enter'); await mobile.page.getByText('[1] ' + w.label + ' preserved citation', { exact: true }).waitFor(); assert.equal(await mobile.page.locator('[aria-busy="true"]').count(), 0);
    result.checks.push({ name: 'persisted_already_saved_mobile_and_detail', width: 390, automaticTransition: true, citationVisible: true, pendingCleared: true }); await mobile.context.close();
    const after = await inventory(db, ids); for (const key of Object.keys(before).filter(k => k !== 'reports')) assert.deepEqual(after[key], before[key], 'historical_' + key + '_changed'); assert.equal(Number(after.reports.count), Number(before.reports.count) + 1); assert.deepEqual(await originals(), originalReports); assert.deepEqual(await inventory(db, ids, true), previous);
    assert.equal((await canonical()).length, 1); assert.equal(fs.readFileSync(runtime.providerEvents, 'utf8').trim(), ''); assert.equal(result.errors.length, 0);
    result.preservation = { originalSavedReports: originalReports.length, originalReportRowsUnchanged: true, healthHistoryAndArtifactsUnchanged: true, priorWorkspacesUnchanged: true, canonicalReportAdded: 1, canonicalReportId: reportId, providerRequests: 0 };
    const current = read(path.join(runtime.out, 'processes.json')); assert.equal(current.sourceCommit, manifest.sourceCommit); assert.equal(current.buildId, manifest.buildId); assert.equal(current.app.pid, manifest.app.pid);
    result.passed = true; result.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ passed: true, evidence: path.join(output, 'result.json'), newCanonicalReports: 1, priorReportsUnchanged: true, providerRequests: 0 }));
  } catch (e) { result.failure = { reason: /^[a-z_]+$/.test(e.message) ? e.message : 'save_qualification_failed', type: e.name }; write(path.join(output, 'failure.private.json'), { message: e.message, stack: e.stack }); save(); console.error(JSON.stringify({ failed: true, evidence: path.join(output, 'result.json'), ...result.failure })); process.exitCode = 1; } finally { await browser?.close(); await db?.end(); }
})();
