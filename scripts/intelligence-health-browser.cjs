/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated, isolated Health presentation qualification. */
'use strict';
// Usage: sandbox-exec -f <runtime.network.sb> env NODE_EXTRA_CA_CERTS=<runtime.cert>
// node scripts/intelligence-health-browser.cjs <runtime.private.json> <full application commit>
// No workload generator, scheduler, collector, production endpoint or paid provider.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { validate, inspectStatus, openOwnedDatabase } = require('./workspace-capacity-confine-stack.cjs');
const { read, write, hash, session, inventory, verifyLedger, denyNetwork, client, check } = require('./intelligence-health-fixtures.cjs');
const [runtimeFile, expectedCommit] = process.argv.slice(2);
assert(runtimeFile && /^[a-f0-9]{40}$/.test(expectedCommit), 'runtime_and_exact_commit_required');
const runtime = read(runtimeFile), ctx = validate(runtime.configFile, runtimeFile), plan = read(runtime.planFile);
const ready = read(path.join(runtime.out, 'fixtures-ready.json')), initial = read(path.join(runtime.out, 'processes.json'));
assert.equal(ready.runId, plan.runId); assert.equal(initial.runId, plan.runId); assert.equal(initial.instanceNonce, runtime.instanceNonce);
assert.equal(initial.sourceCommit, expectedCommit); assert.equal(initial.buildMode, 'production'); assert.equal(initial.diagnosticPreload, false);
assert.equal(process.env.NODE_EXTRA_CA_CERTS, runtime.cert); assert.equal(plan.kind, 'isolated_health_functional_v1');
const output = path.join(runtime.out, 'health-browser-' + randomUUID()); fs.mkdirSync(output, { mode: 0o700 });
const result = { kind: 'authenticated_health_consolidation_v1', runId: plan.runId, sourceCommit: expectedCommit, buildId: initial.buildId, harnessSha256: hash(fs.readFileSync(__filename)), instanceNonce: initial.instanceNonce, startedAt: new Date().toISOString(), widths: [1440, 390], repetitions: 2, providerMode: 'Preserved synthetic saved artifact; no generation submitted', loadedRuntimeSourceFiles: initial.loadedRuntimeSourceFiles, nextConfigOverride: initial.nextConfigOverride, checks: [], errors: [], foreignRequests: [], failedResponses: [], providerRequests: [], passed: false, capacityClaim: false };
result.testOnlyFaultRuntime = read(path.join(runtime.out, 'health-fault-runtime-manifest.json'));
result.fixtureHarnessSha256 = hash(fs.readFileSync(path.join(__dirname, 'intelligence-health-fixtures.cjs')));
result.browserTimezone = 'America/Los_Angeles';
result.viewportHeights = { desktop: 1000, mobile: 900 };
assert.equal(result.testOnlyFaultRuntime.sourceCommit, expectedCommit);
let db, browser, stage = 'setup';
const save = () => write(path.join(output, 'result.json'), result);
const record = (name, data = {}) => { result.checks.push({ name, ...data, passed: true }); save(); };
const workspace = kind => plan.workspaces.find(w => w.kind === kind);
const actor = kind => plan.actors.find(a => a.kind === kind);
async function guard() {
  const current = read(path.join(runtime.out, 'processes.json'));
  for (const key of ['sourceCommit', 'buildId', 'instanceNonce']) assert.equal(current[key], initial[key], 'runtime_artifact_changed');
  for (const key of ['app', 'worker', 'provider']) { assert.equal(current[key].pid, initial[key].pid); process.kill(current[key].pid, 0); }
}
async function open(a, width, overrideWorkspace) {
  await guard(); const authenticated = await session(ctx.config, a, runtime);
  if (overrideWorkspace) authenticated.cookies.find(c => c.name === 'vaeroex_workspace_id').value = overrideWorkspace;
  const context = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: result.browserTimezone, viewport: { width, height: width === 1440 ? result.viewportHeights.desktop : result.viewportHeights.mobile }, serviceWorkers: 'block' });
  await context.addCookies(authenticated.cookies);
  await context.route('**/*', route => { const u = new URL(route.request().url()); if ([runtime.appOrigin, new URL(ctx.config.apiUrl).origin].includes(u.origin)) return route.continue(); result.foreignRequests.push({ stage, origin: u.origin, method: route.request().method() }); return route.abort('blockedbyclient'); });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => { result.errors.push({ stage, kind: 'pageerror', hash: hash(error.message) }); fs.appendFileSync(path.join(output, 'browser-errors.private.jsonl'), JSON.stringify({ stage, kind: 'pageerror', message: error.message, stack: error.stack }) + '\n', { mode: 0o600 }); save(); });
  page.on('console', message => { if (message.type() === 'error' && message.text() !== "The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.") { result.errors.push({ stage, kind: 'console', hash: hash(message.text()) }); save(); } });
  page.on('response', response => { if (new URL(response.url()).origin === runtime.appOrigin && response.status() >= 400) result.failedResponses.push({ stage, path: new URL(response.url()).pathname, status: response.status() }); });
  return { context, page, accessToken: authenticated.accessToken };
}
async function noPending(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 20000 });
  assert.equal(await page.locator('[aria-busy="true"]').count(), 0, 'pending_state_not_cleared');
  assert.equal(await page.getByText(/Application error|Business Health history is temporarily unavailable|Unable to load workspace data/i).count(), 0, 'render_or_history_failure');
}
async function inViewport(locator, width) {
  const box = await locator.boundingBox(); assert(box && box.width > 0 && box.x >= -1 && box.x + box.width <= width + 1, 'control_overflows_viewport');
}
async function qualifyHealth(a, width, iteration) {
  const w = plan.workspaces.find(w => w.id === a.workspaceId), { context, page } = await open(a, width);
  stage = `${a.kind}_${width}_${iteration}`;
  try {
    await page.goto(runtime.appOrigin + '/app', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Executive Overview', exact: true }).waitFor();
    assert.equal(await page.locator('[data-business-health-trend]').count(), 0, 'overview_still_contains_full_health_history');
    const overviewLink = page.locator('a[href="/app/intelligence#business-health"]').first(); await overviewLink.waitFor();
    const transition = page.waitForURL(u => u.pathname === '/app/intelligence' && u.hash === '#business-health');
    await overviewLink.click(); await transition;
    const health = page.locator('#business-health'); await health.getByRole('heading', { name: 'Business Health', exact: true }).waitFor(); await noPending(page);
    await inViewport(health, width);
    assert.equal(await page.getByText(workspace('foreign').label, { exact: false }).count(), 0, 'foreign_label_visible');
    if (w.kind === 'empty') { await health.getByText('Not yet evaluable', { exact: true }).waitFor(); await health.getByText('Freshness cannot be established', { exact: false }).waitFor(); }
    else { assert.equal(await health.locator('[aria-label^="Business Health score "]:not([aria-label$="unavailable"])').count(), 1, 'expected_evaluable_score'); if (w.kind === 'stale') await health.getByText('Supporting evidence is over 45 days old.', { exact: false }).waitFor(); else assert.equal(await health.getByText('Supporting evidence is over 45 days old.', { exact: false }).count(), 0); }
    record('overview_to_intelligence_health', { actor: a.kind, width, iteration, automaticTransition: true, pendingCleared: true, expectedEvidenceState: w.kind });
    if (a.kind === 'current' && iteration === 0) {
      assert.equal(await health.locator('details[open]').count(), 0, 'health_default_details_not_collapsed');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `current-${width}-default.png`), fullPage: true });
      if (width === 1440) await page.screenshot({ path: path.join(output, 'current-1440-default-viewport.png'), fullPage: false });
    }
    const factors = health.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Contributing factors and evidence$/ }) });
    await factors.locator('summary').focus(); await page.keyboard.press('Enter'); assert.equal(await factors.getAttribute('open'), '', 'factor_keyboard_open_failed');
    if (w.kind === 'empty') await factors.getByText('No eligible supporting citations are available yet.', { exact: true }).waitFor();
    else {
      assert((await factors.locator('[id^="health-evidence-"]').count()) > 0, 'supporting_evidence_required');
      const evidenceLink = factors.locator('a[href^="#health-evidence-"]').first(); await evidenceLink.waitFor();
      const href = await evidenceLink.getAttribute('href'); await evidenceLink.focus(); await page.keyboard.press('Enter');
      assert.equal(new URL(page.url()).hash, href); await page.locator(href).waitFor();
      assert.equal(await factors.getByText('Performance baseline', { exact: false }).count(), 1);
    }
    record('factor_and_evidence_keyboard', { actor: a.kind, width, iteration });
    const history = health.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Health history$/ }) });
    await history.locator('summary').focus(); await page.keyboard.press('Enter'); assert.equal(await history.getAttribute('open'), '');
    for (const range of ['7 Days', '1 Month', '3 Months', '6 Months', 'YTD']) {
      const button = history.getByRole('button', { name: range, exact: true }); await button.focus(); await page.keyboard.press('Enter'); assert.equal(await button.getAttribute('aria-pressed'), 'true'); await inViewport(button, width);
      const labels = await history.locator('circle[role="button"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
      if (w.kind !== 'empty' && range === '1 Month') { assert(labels.some(s => s.includes('Formula V1')), 'v1_history_missing'); assert(labels.some(s => s.includes('Formula V2')), 'v2_history_missing'); await history.getByText('Scoring method updated', { exact: false }).first().waitFor(); }
      if (w.kind === 'empty') assert.equal(labels.length, 0, 'empty_history_fabricates_points');
      if (labels.length) { await history.locator('circle[role="button"]').first().focus(); assert.equal(await history.locator('circle[role="button"]:focus').count(), 1); }
    }
    record('history_all_ranges_and_version_boundary', { actor: a.kind, width, iteration, ranges: 5, missingDaysNotInvented: true });
    const view = health.getByRole('button', { name: 'View analysis', exact: true }); await view.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Executive analysis', exact: true }).waitFor(); await noPending(page);
    if (w.kind === 'empty') await dialog.getByText('Evidence limited', { exact: true }).waitFor();
    else { await dialog.getByText(w.label + ' preserved historical analysis [1].', { exact: true }).waitFor(); const supporting = dialog.locator('summary').filter({ hasText: /^Supporting evidence/ }); await supporting.focus(); await page.keyboard.press('Enter'); await dialog.getByText(w.label + ' preserved citation', { exact: true }).waitFor(); }
    for (let i = 0; i < 5; i++) { await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab'); assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'dialog_focus_escaped'); }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.equal(await view.evaluate(el => document.activeElement === el), true, 'dialog_focus_not_restored');
    record('existing_analysis_dialog_and_focus', { actor: a.kind, width, iteration, noGenerationRequested: true });
    if (iteration === 0) await page.screenshot({ path: path.join(output, `${a.kind}-${width}.png`), fullPage: true });
    const saved = health.getByRole('link', { name: 'Saved analyses', exact: true }); const nav = page.waitForURL(u => u.pathname === '/app/reports'); await saved.click(); await nav;
    await page.getByRole('heading', { name: 'Saved Analyses', exact: true }).waitFor();
    if (w.reportId) { const link = page.locator(`a[href="/app/reports/${w.reportId}"]`).first(); const detail = page.waitForURL(u => u.pathname === '/app/reports/' + w.reportId); await link.click(); await detail; const supporting = page.locator('[data-saved-analysis-renderer] summary').filter({ hasText: /^Supporting evidence/ }); await supporting.focus(); await page.keyboard.press('Enter'); await page.getByText('[1] ' + w.label + ' preserved citation', { exact: true }).waitFor(); await noPending(page); }
    record('saved_analysis_link_and_preserved_citation', { actor: a.kind, width, iteration, savedArtifactAvailable: Boolean(w.reportId) });
  } catch (error) {
    result.failureView = { stage, path: new URL(page.url()).pathname, headings: await page.locator('h1,h2').allTextContents(), pending: await page.locator('[aria-busy="true"]').count() };
    await page.screenshot({ path: path.join(output, `failure-${stage}.png`), fullPage: true }); save(); throw error;
  } finally { await context.close(); }
}
async function qualifyDenials(width) {
  stage = 'cross_workspace_' + width;
  const own = await open(actor('current'), width), foreign = workspace('foreign');
  try {
    await own.page.goto(runtime.appOrigin + '/app/reports/' + foreign.reportId, { waitUntil: 'domcontentloaded' });
    await own.page.waitForURL(u => u.pathname === '/app/reports'); assert.equal(await own.page.getByText(foreign.label, { exact: false }).count(), 0);
    for (const table of ['business_health_snapshots', 'ai_agent_runs', 'reports']) {
      const url = new URL('/rest/v1/' + table, ctx.config.apiUrl); url.searchParams.set('select', 'id'); url.searchParams.set('workspace_id', 'eq.' + foreign.id);
      const response = await fetch(url, { headers: { apikey: ctx.config.anonKey, authorization: 'Bearer ' + own.accessToken }, redirect: 'error', signal: AbortSignal.timeout(10000) }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), []);
    }
    record('foreign_saved_analysis_and_rls_denied', { width, tables: ['business_health_snapshots', 'ai_agent_runs', 'reports'] });
  } finally { await own.context.close(); }
  const forged = await open(actor('current'), width, foreign.id);
  try { await forged.page.goto(runtime.appOrigin + '/app/intelligence#business-health', { waitUntil: 'domcontentloaded' }); await forged.page.getByRole('heading', { name: 'Intelligence', exact: true }).waitFor(); assert.equal(await forged.page.getByText(foreign.label, { exact: false }).count(), 0); record('foreign_workspace_cookie_does_not_grant_membership', { width }); } finally { await forged.context.close(); }
  const denied = await open(actor('unentitled'), width);
  try { await denied.page.goto(runtime.appOrigin + '/app/intelligence#business-health', { waitUntil: 'domcontentloaded' }); await denied.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')); assert.equal(await denied.page.locator('#business-health').count(), 0); assert((await denied.page.locator('body').innerText()).match(/subscription|billing|access|activation|plan/i), 'entitlement_denial_feedback_missing'); record('unentitled_health_access_blocked', { width }); } finally { await denied.context.close(); }
}
async function qualifyHealthRecovery(width) {
  stage = 'scoped_health_read_recovery_' + width;
  const { context, page } = await open(actor('current'), width), control = path.join(runtime.out, 'health-fault-control.private.json'), faultId = randomUUID();
  try {
    write(control, {});
    await page.goto(runtime.appOrigin + '/app/intelligence#business-health', { waitUntil: 'domcontentloaded' });
    await page.locator('#business-health [aria-label^="Business Health score "]').waitFor();
    const findings = page.locator('[data-finding-list]'); await findings.waitFor(); const findingsBefore = await findings.innerText();
    assert(findingsBefore.includes('What needs attention') && findingsBefore.includes('What could improve the business further'), 'independent_findings_not_rendered');
    write(control, { enabled: true, id: faultId, workspaceId: workspace('current').id });
    // A distinct document URL is required to exercise a new authenticated read;
    // navigating to the identical fragment URL can be a same-document jump.
    await page.goto(runtime.appOrigin + '/app/intelligence?health_qualification_fault=' + faultId + '#business-health', { waitUntil: 'domcontentloaded' });
    const health = page.locator('#business-health'); await health.getByText('Health is temporarily unavailable. Other Intelligence findings remain available below.', { exact: true }).waitFor();
    assert.equal(await health.locator('[aria-label^="Business Health score "]').count(), 0, 'failed_health_presents_score');
    assert.equal(await findings.innerText(), findingsBefore, 'health_failure_hides_or_changes_independent_findings');
    const events = fs.readFileSync(path.join(runtime.out, 'health-fault-events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(e => e.faultId === faultId);
    assert.equal(events.length, 1, 'exactly_one_scoped_health_failure_required'); assert.equal(events[0].pid, initial.app.pid); assert.equal(events[0].role, 'authenticated'); assert.equal(events[0].actualInjection, true);
    await page.screenshot({ path: path.join(output, `health-unavailable-${width}.png`), fullPage: true });
    write(control, {}); const retry = health.getByRole('button', { name: 'Retry Health', exact: true }), beforeUrl = page.url(); await retry.focus(); await page.keyboard.press('Enter');
    await health.locator('[aria-label^="Business Health score "]:not([aria-label$="unavailable"])').waitFor(); await noPending(page);
    assert.equal(await health.getByRole('button', { name: /Retry Health|Retrying Health/ }).count(), 0); assert.equal(page.url(), beforeUrl, 'retry_changed_route'); assert.equal(await findings.innerText(), findingsBefore);
    await page.screenshot({ path: path.join(output, `health-recovered-${width}.png`), fullPage: true });
    record('scoped_health_failure_and_automatic_retry', { width, actualInjectedFailures: 1, faultId, affectedRequest: 'authenticated scoped GET /rest/v1/assets', independentFindingsPreserved: true, keyboardRetry: true, automaticRecovery: true, pendingCleared: true, manualNavigationAfterRetry: false });
  } finally { write(control, {}); await context.close(); }
}
(async () => {
  try {
    result.osNetworkDenial = await denyNetwork(); await inspectStatus(ctx); db = (await openOwnedDatabase(ctx)).db; await guard();
    result.databaseIdentity = await verifyLedger(db);
    const ids = plan.workspaces.map(w => w.id); result.before = await inventory(db, ids); const previous = await inventory(db, ids, true);
    browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking'] });
    for (const width of result.widths) { for (let iteration = 0; iteration < 2; iteration++) for (const kind of ['current', 'viewer', 'stale', 'empty']) await qualifyHealth(actor(kind), width, iteration); await qualifyDenials(width); await qualifyHealthRecovery(width); }
    result.after = await inventory(db, ids); assert.deepEqual(result.after, result.before, 'health_history_citations_or_source_data_changed'); assert.deepEqual(await inventory(db, ids, true), previous, 'prior_qualification_data_changed');
    const { admin } = client(ctx.config);
    for (const w of plan.workspaces.filter(w => w.source)) { const data = check(await admin.storage.from('workspace-files').download(w.source.path), 'original_storage_read'); assert.equal(hash(Buffer.from(await data.arrayBuffer())), w.source.sha256, 'source_object_changed'); }
    const providerLines = fs.readFileSync(runtime.providerEvents, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); result.providerRequests = providerLines; assert.equal(providerLines.length, 0, 'unexpected_provider_request');
    assert.equal(result.errors.length, 0, 'browser_error'); assert.equal(result.foreignRequests.length, 0, 'foreign_network_request'); assert.equal(result.failedResponses.length, 0, 'unexpected_http_error');
    await guard(); result.passed = true; result.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ passed: true, evidence: path.join(output, 'result.json'), checks: result.checks.length, widths: result.widths, historyAndCitationsUnchanged: true, capacityClaim: false }));
  } catch (error) { result.failure = { stage, reason: /^[a-z0-9_]+$/.test(error.message) ? error.message : 'health_browser_assertion_failed', errorCode: error.code || error.name }; write(path.join(output, 'failure-diagnostic.private.json'), { stage, message: error.message, stack: error.stack }); save(); console.error(JSON.stringify({ failed: true, evidence: path.join(output, 'result.json'), ...result.failure })); process.exitCode = 1; } finally { await browser?.close(); await db?.end(); }
})();
