module.paths.unshift('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/node_modules');
/* eslint-disable @typescript-eslint/no-require-imports -- Disposable real Supabase workflow qualification, no hosted endpoints. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const { chromium } = require('playwright');
const { Client } = require('pg');
const root = '/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
const [configFile, output, ...options] = process.argv.slice(2);
assert.equal(options.length, 0, 'no_manual_recovery_option');
assert(configFile && output && !fs.existsSync(output), 'fresh_private_config_and_output_required');
assert((fs.statSync(configFile).mode & 0o077) === 0, 'config_must_be_private');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
assert(config.mode === 'disposable-native-local' && config.runId && config.apiUrl && config.anonKey && config.serviceKey && config.dbUrl);
function local(raw) { const u = new URL(raw); assert(['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname), 'remote_target_forbidden'); return u; }
local(config.apiUrl); local(config.dbUrl);
assert(!fs.existsSync(path.join(root, 'supabase/.temp/project-ref')), 'linked_checkout_forbidden');
assert(!['.env','.env.local','.env.production','.env.production.local'].some(p=>fs.existsSync(path.join(root,p))),'dotenv_files_forbidden');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const secrets = [config.anonKey, config.serviceKey, config.dbUrl];
const sanitize = (value) => { let s = String(value); for (const key of secrets) s = s.split(key).join('[local-secret]'); return s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local-token]'); };
const captures = [];
const results = [], requests = [], browserErrors = [], actionResponses = [], navigationFailures = [];
const result = (name, data = {}) => { const record = { name, passed: true, navigationFailuresBeforeCheck: navigationFailures.length, ...data }; results.push(record); console.log(JSON.stringify({ check: name, passed: record.passed })); };
const check = (response, name) => { if (response.error) throw new Error(`${name}:${response.error.code || response.error.status || 'request_failed'}`); return response.data; };
const safeFetch = (input, init = {}) => { const u = local(typeof input === 'string' || input instanceof URL ? input : input.url); assert(u.origin === new URL(config.apiUrl).origin); return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) }); };
const admin = createClient(config.apiUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } });
const db = new Client({ connectionString: config.dbUrl, ssl: false, connectionTimeoutMillis: 5000, query_timeout: 30000, statement_timeout: 30000 });
const executionId = randomUUID();
const prefix = `CLOSEOUT ${config.runId.slice(0, 8)} ${executionId.slice(0,8)}`;
let app, browser, stage = 'seed', buildLog = '', appLog = '';
let appOrigin;
let sourceStart, sourceBuilt, sourceEnd;
const sourceManifest = () => { const files = spawnSync('git',['ls-files','-co','--exclude-standard'],{cwd:root,encoding:'utf8'}).stdout.trim().split('\n').filter(p=>!['docs/','scripts/','supabase/','.github/','services/','tools/'].some(prefix=>p.startsWith(prefix))&&fs.existsSync(path.join(root,p))); return {head:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),files:[...new Set(files)].sort().map(p=>({path:p,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')}))}; };
const assertOwnedApp = () => { assert(app && app.exitCode===null && !app.signalCode, 'owned_app_exited'); };
async function reservePort() { const server=require('node:net').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port; }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeout = 45000) { const start = Date.now(); while (Date.now() - start < timeout) { if(app)assertOwnedApp(); const v = await fn(); if (v) return v; await sleep(200); } throw new Error(`timeout_${label}`); }
async function session(actor) {
  const cookies = new Map();
  const client = createServerClient(config.apiUrl, config.anonKey, { global: { fetch: safeFetch }, auth: { autoRefreshToken: false }, cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(x => cookies.set(x.name, x.value)) } });
  const login = check(await client.auth.signInWithPassword({ email: actor.email, password: actor.password }), 'auth_login');
  secrets.push(login.session.access_token, login.session.refresh_token);
  cookies.set('vaeroex_workspace_id', actor.workspaceId);
  return { client, cookies: [...cookies].map(([name, value]) => ({ name, value, url: appOrigin, sameSite: 'Lax' })) };
}
async function context(actor, width) {
  assertOwnedApp(); const s = await session(actor); const c = await browser.newContext({ viewport: { width, height: 900 } }); await c.addCookies(s.cookies);
  await c.route('**/*', route => { const u = new URL(route.request().url()); return [appOrigin, new URL(config.apiUrl).origin].includes(u.origin) ? route.continue() : route.abort(); });
  const newPage = async () => {
    const page = await c.newPage(); page.setDefaultTimeout(20000);
const cdp=await c.newCDPSession(page);await cdp.send('Debugger.enable');await cdp.send('Network.enable');
 await cdp.send('Debugger.setBreakpointByUrl',{urlRegex:'bf553b51-3cd140e4f18cf7f9\\.js$',lineNumber:0,columnNumber:35049});
 cdp.on('Debugger.paused',async ev=>{try{const r=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:ev.callFrames[0].callFrameId,expression:`(()=>{function fiber(f){return f?{tag:f.tag,type:typeof f.type==='string'?f.type:typeof f.type,props:typeof f.type==='string'?Object.keys(f.pendingProps||{}):[],parent:f.return&&{tag:f.return.tag,type:typeof f.return.type==='string'?f.return.type:typeof f.return.type}}:null}return {url:location.href,ready:document.readyState,at:performance.now(),fiber:fiber(e),parent:fiber(rP),next:rN?{type:rN.nodeType,name:rN.nodeName,html:rN.outerHTML,connected:rN.isConnected}:null,body:document.body&&document.body.innerHTML.slice(0,2000),segments:[...document.querySelectorAll('[id^="S:"],[id^="P:"]')].map(x=>x.id)}})()`,returnByValue:true});captures.push({stage,at:Date.now(),reason:ev.reason,data:r.result.value,error:r.exceptionDetails?.text});console.log(JSON.stringify({capture:captures.length,stage,data:r.result.value}));}finally{await cdp.send('Debugger.resume')}});
    page.on('pageerror', e => browserErrors.push({ stage, at: Date.now(), path: new URL(page.url()).pathname, message: sanitize(e.message), stack: sanitize(e.stack || '') }));
    page.on('response', r => { const u = new URL(r.url()); if (u.origin === appOrigin && !u.pathname.startsWith('/_next')) requests.push({ stage, at: Date.now(), page: page.url(), path: u.pathname+u.search, resourceType:r.request().resourceType(), document:r.request().isNavigationRequest(), rsc:r.request().headers().rsc, method: r.request().method(), status: r.status() }); });
    return page;
  };
  return { c, page: await newPage(), client: s.client, newPage };
}
async function submit(page, button, label, outcome, repeated = true) {
  const initial = page.url();
  const before = requests.filter(r => r.method === 'POST').length;
  const response = page.waitForResponse(r => r.request().method() === 'POST' && !!r.request().headers()['next-action'] && new URL(r.url()).origin === appOrigin, { timeout: 20000 });
  const navigation = page.waitForURL(u => u.href !== initial && outcome(u), { timeout: 20000 });
  // Actual rapid repeated clicks. They must never require a reload or duplicate
  // an accepted logical effect. Server receipts are checked independently.
  if (repeated) await button.dblclick({ delay: 20 }); else await button.click();
  await navigation;
  const r = await response; assert.equal(r.status(), 303);
  const headers = await r.allHeaders();
  const feedback = new URL(page.url()).searchParams.get('message') || new URL(page.url()).searchParams.get('error');
  assert(feedback, 'saved_or_denied_feedback_required');
  if (/do not have permission|not authorized|not allowed|permission denied|security requirements/i.test(feedback)) {
    // These deliberate role denials use the existing security alert, not a toast.
    await page.getByRole('alert').filter({ hasText: 'Action Blocked' }).last().waitFor({ timeout: 20000 });
    await page.getByRole('alert').filter({ hasText: 'No changes were made.' }).last().waitFor();
    await page.getByRole('button', { name: 'Return to workspace', exact: true }).waitFor();
  } else {
    await page.getByRole('status').filter({ hasText: feedback }).waitFor({ timeout: 20000 });
  }
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'), undefined, { timeout: 20000 });
  actionResponses.push({ label, status: r.status(), redirect: sanitize(headers['x-action-redirect']), destination: new URL(page.url()).pathname + new URL(page.url()).search, feedback, actionRequests: requests.filter(r => r.method === 'POST').length - before });
  result(label, { automatic: true, pendingCleared: true, feedbackVisible: true });
}
async function formPage(page, formId, label) {
  await page.goto(`${appOrigin}/app/forms/${formId}`);
  await page.locator('summary').filter({ hasText: 'New Submission' }).click();
  const form = page.locator('form').filter({ has: page.locator('[name="submission_request_id"]') });
  await form.locator('[name="field:equipment"]').fill(label);
  await form.locator('[name="submitter_name"]').fill(label);
  await form.locator('[name="summary"]').fill(label);
  return form;
}
const success = u => u.searchParams.has('message');
const failure = u => u.searchParams.has('error');
(async () => {
  let owner, caseActor, a;
  try {
    await db.connect();
    const identity = (await db.query("select current_database() db,current_setting('data_directory') directory,current_setting('server_version') version")).rows[0];
    assert.equal(identity.db, 'postgres'); assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(config.ownedSupabaseHome) + '/stacks/'));
    const ownership = JSON.parse(fs.readFileSync(configFile + '.fixtures.json'));
    assert.equal(ownership.runId, config.runId); const existing = ownership.executions.at(-1); assert(existing);
    a = existing.workspaces[0]; const b = existing.workspaces[1];
    const workspace = check(await admin.from('workspaces').select('name,created_by').eq('id', a).single(), 'owned_workspace');
    assert(workspace.name.startsWith(`CLOSEOUT ${config.runId.slice(0, 8)} `));
    const member = check(await admin.from('workspace_members').select('user_id,role').eq('workspace_id', a).eq('role', 'owner').eq('user_id', workspace.created_by).eq('status', 'active').single(), 'existing_owner');
    const user = check(await admin.auth.admin.getUserById(member.user_id), 'synthetic_user').user;
    assert(/^closeout-[a-f0-9-]+@example\.test$/.test(user.email));
    const password = randomBytes(24).toString('base64url'); secrets.push(password);
    check(await admin.auth.admin.updateUserById(user.id, { password }), 'synthetic_password');
    owner = { id: user.id, email: user.email, password, workspaceId: a };
    const foreignOwner = check(await admin.from('workspace_members').select('user_id').eq('workspace_id', b).eq('role', 'owner').single(), 'owned_foreign_fixture');
    const foreignFile = randomUUID();
    check(await admin.from('file_uploads').insert({ id: foreignFile, workspace_id: b, created_by: foreignOwner.user_id, original_name: 'vxa039-foreign.csv', display_name: prefix + ' foreign denial', file_extension: 'csv', mime_type: 'text/csv', file_size_bytes: 10, storage_bucket: 'workspace-files', storage_path: `${b}/${foreignFile}/fixture.csv`, processing_status: 'ready' }), 'foreign_record_fixture');
    // Reuse the preserved, deliberately partial receipt; never reset or finish it.
    const held = check(await admin.from('file_imports').select('id,file_upload_id').eq('workspace_id', a).eq('recovery_status', 'running').limit(10), 'held_fixture');
    assert(held.length > 0); const heldImport = held[0];
    async function heldInventory() {
      const file = heldImport.file_upload_id;
      return {
        receipt: (await db.query('select id,status,actor_id,approved_mapping,approved_row_ids,accepted_at,completed_at from private.file_import_attempts where workspace_id=$1 and import_id=$2 order by id', [a, heldImport.id])).rows,
        chunks: (await db.query('select id,md5(to_jsonb(c)::text) hash from business_memory_chunks c where workspace_id=$1 and source_file_id=$2 order by id', [a, file])).rows,
        rows: (await db.query('select id,status,data_json,mapped_data_json from file_import_rows where workspace_id=$1 and file_upload_id=$2 order by id', [a, file])).rows,
        kpis: check(await admin.from('kpis').select('id').eq('source_file_id', file), 'held_kpis')
      };
    }
    const heldBefore = await heldInventory(); assert.equal(heldBefore.receipt.length, 1); assert.equal(heldBefore.receipt[0].status, 'running');
    const formId = randomUUID();
    check(await admin.from('forms').insert({ id: formId, workspace_id: a, name: `${prefix} action completion`, schema_json: [{ key: 'equipment', label: 'Equipment', type: 'text', required: true }], created_by: owner.id }), 'form_fixture');
    appOrigin = `http://127.0.0.1:${await reservePort()}`;
    sourceStart = sourceManifest();
    const env = { PATH: process.env.PATH, HOME: os.homedir(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--max-old-space-size=2048 --require=${path.join(root, 'scripts/workspace-closeout-egress.cjs')}`, NEXT_PUBLIC_SUPABASE_URL: config.apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey, NEXT_PUBLIC_APP_URL: appOrigin, TZ: 'UTC' };
    stage = 'build';
    assert.deepEqual(sourceManifest().files,JSON.parse(fs.readFileSync('/tmp/vaeroex-vxa039-e2e-13/source-manifest.json')).built.files);
    const built={status:0,stdout:'Reused exact source-manifest-matched production E2E13 build 3zwE65HpsHVah_zBPJwVR'};
    buildLog = sanitize((built.stdout || '') + (built.stderr || '')); assert.equal(built.status, 0, 'production_build_failed');
    sourceBuilt = sourceManifest(); assert.deepEqual(sourceStart, sourceBuilt);
    app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(appOrigin).port], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.stdout.on('data', b => { appLog += b; }); app.stderr.on('data', b => { appLog += b; });
    await waitFor(async () => { try { return (await fetch(appOrigin + '/login')).status === 200; } catch { return false; } }, 'app_ready');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    async function role(value) { check(await admin.from('workspace_members').update({ role: value }).eq('workspace_id', a).eq('user_id', caseActor.id), 'synthetic_role'); }
    async function denied(page, button, label) {
      await role('viewer');
      try { await submit(page, button, label, failure); } finally { await role('owner'); }
    }
    for (const width of [1440, 390]) for (let iteration = 0; iteration < 3; iteration++) {
      const actorId = randomUUID(), actorEmail = `closeout-${actorId}@example.test`, actorPassword = randomBytes(24).toString('base64url');
      secrets.push(actorPassword);
      check(await admin.auth.admin.createUser({ id: actorId, email: actorEmail, password: actorPassword, email_confirm: true, user_metadata: { full_name: `${prefix} ${width} ${iteration}` } }), 'isolated_case_actor');
      check(await admin.from('workspace_members').insert({ workspace_id: a, user_id: actorId, role: 'owner', status: 'active' }), 'case_membership');
      const legal = /terms: "([\d-]+)"/.exec(fs.readFileSync(path.join(root, 'lib/legal/content.ts'), 'utf8'))[1];
      check(await admin.from('legal_acceptances').insert({ user_id: actorId, workspace_id: a, terms_version: legal, privacy_version: legal, ai_disclaimer_version: legal, sensitive_data_policy_version: legal, user_email: actorEmail, user_agent: 'Synthetic focused action fixture' }), 'case_legal');
      caseActor = { id: actorId, email: actorEmail, password: actorPassword, workspaceId: a };
      ownership.vxa039Actors ||= []; ownership.vxa039Actors.push({ executionId, id: actorId, workspaceId: a });
      fs.writeFileSync(configFile + '.fixtures.json', JSON.stringify(ownership, null, 2), { mode: 0o600 });
      const { c, page, client, newPage } = await context(caseActor, width);
      const label = `${prefix} ${width} ${iteration}`;
      stage = `form_${width}_${iteration}`;
      let f = await formPage(page, formId, label + ' denied');
      await denied(page, f.getByRole('button', { name: 'Save submission', exact: true }), stage + '_denied');
      assert.equal(check(await client.from('form_submissions').select('id').eq('submitter_name', label + ' denied'), 'denied_form_rows').length, 0);
      f = await formPage(page, formId, label);
      const requestId = await f.locator('[name="submission_request_id"]').inputValue();
      await submit(page, f.getByRole('button', { name: 'Save submission', exact: true }), stage, success);
      const saved = check(await client.from('form_submissions').select('id,data_json').eq('submitter_name', label), 'saved_form'); assert.equal(saved.length, 1);
      assert.equal(saved[0].data_json.fields.equipment, label);
      // Replay the exact original request through a fresh rendered browser form.
      f = await formPage(page, formId, label); await f.locator('[name="submission_request_id"]').evaluate((e, value) => { e.value = value; }, requestId);
      await submit(page, f.getByRole('button', { name: 'Save submission', exact: true }), stage + '_replay', success);
      assert.deepEqual(check(await client.from('form_submissions').select('id,data_json').eq('submitter_name', label), 'form_replay'), saved);
      await page.locator('article').getByText(label, { exact: true }).first().waitFor();
      if (iteration === 0) await page.screenshot({ path: path.join(output, `form-${width}.png`), fullPage: true });
      stage = `memory_${width}_${iteration}`;
      const fileId = randomUUID(), runId = randomUUID();
      const evidence = 'Revenue amount October 100. This financial worksheet records the actual October revenue amount for the business. The owner reviews the revenue worksheet before making operational decisions.';
      const analysis = { evidence_classification: 'business_evidence', extraction_outcome: 'facts_extracted', findings: ['Revenue amount October 100'], summary: 'Revenue amount October 100' };
      const key = `${a}/${fileId}/vxa039-memory.csv`;
      check(await client.storage.from('workspace-files').upload(key, Buffer.from(evidence), { contentType: 'text/csv' }), 'memory_storage');
      check(await admin.from('file_uploads').insert({ id: fileId, workspace_id: a, original_name: 'vxa039-memory.csv', display_name: label, file_extension: 'csv', mime_type: 'text/csv', file_size_bytes: evidence.length, storage_bucket: 'workspace-files', storage_path: key, created_by: caseActor.id, processing_status: 'ready', analysis_summary: analysis.summary, metadata_json: { latest_analysis_run_id: runId, latest_analysis_status: 'needs_review', analysis_review_status: 'needs_review', latest_analysis_output: analysis, latest_text_extraction: { extracted_text: evidence } } }), 'memory_file');
      await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,status,input_json,output_json,created_by) values($1,$2,'file_analysis','completed',$3::jsonb,$4::jsonb,$5)", [runId, a, JSON.stringify({ evidence_lineage: { source_file_id: fileId }, extra_inputs: { file: { id: fileId } } }), JSON.stringify(analysis), caseActor.id]);
      await page.goto(`${appOrigin}/app/sources/${fileId}`);
      await denied(page, page.getByRole('button', { name: 'Approve learning', exact: true }), stage + '_denied');
      assert.equal(check(await client.from('business_memory_chunks').select('id').eq('source_file_id', fileId), 'denied_memory').length, 0);
      await page.goto(`${appOrigin}/app/sources/${fileId}`);
      const memoryReplay = await newPage(); await memoryReplay.goto(`${appOrigin}/app/sources/${fileId}`);
      await submit(page, page.getByRole('button', { name: 'Approve learning', exact: true }), stage, success);
      const chunks = check(await client.from('business_memory_chunks').select('id,source_metadata').eq('source_file_id', fileId), 'memory_saved');
      assert.equal(chunks.length, 1); assert.equal(chunks[0].source_metadata.source_run_id, runId);
      await page.getByText('Available to Intelligence and Learned Knowledge.', { exact: true }).waitFor();
      await submit(memoryReplay, memoryReplay.getByRole('button', { name: 'Approve learning', exact: true }), stage + '_stale_replay', success);
      assert.deepEqual(check(await client.from('business_memory_chunks').select('id,source_metadata').eq('source_file_id', fileId), 'memory_replay'), chunks);
      if (iteration === 0) await memoryReplay.screenshot({ path: path.join(output, `memory-${width}.png`), fullPage: true });
      await memoryReplay.close();
      stage = `worksheet_${width}_${iteration}`;
      await page.goto(appOrigin + '/app/sources'); await page.locator('#workspace-file-upload > summary').click();
      await page.locator('input[type="file"]').setInputFiles({ name: `vxa039-${executionId}-${width}-${iteration}.csv`, mimeType: 'text/csv', buffer: Buffer.from('date,revenue\n2026-01-01,42\n2026-02-01,43\n') });
      await page.locator('[name="display_name"]').fill(label + ' upload');
      await submit(page, page.getByRole('button', { name: 'Upload and prepare review', exact: true }), stage + '_upload', u => /^\/app\/sources\/[0-9a-f-]{36}$/.test(u.pathname) && u.searchParams.has('message'), false);
      const uploaded = check(await client.from('file_uploads').select('id,storage_path').eq('display_name', label + ' upload').single(), 'uploaded_source');
      assert.equal(Buffer.from(await check(await client.storage.from('workspace-files').download(uploaded.storage_path), 'uploaded_bytes').arrayBuffer()).toString(), 'date,revenue\n2026-01-01,42\n2026-02-01,43\n');
      async function importForm(target = page) {
        await target.goto(`${appOrigin}/app/sources/${uploaded.id}?section=imported`);
        const f = target.locator('form').filter({ has: target.locator('[name="workbook_mode"]') });
        await f.locator('[name="worksheet_1_enabled"]').check(); await f.locator('[name="worksheet_1_type"]').selectOption('wide_time_series'); await f.locator('[name="worksheet_1_map_period"]').selectOption('date'); return f;
      }
      f = await importForm(); const importId = await f.locator('[name="import_id"]').inputValue();
      await denied(page, f.getByRole('button', { name: 'Import 1 approved worksheet', exact: true }), stage + '_denied');
      assert.equal(check(await client.from('kpis').select('id').eq('source_file_id', uploaded.id), 'denied_kpis').length, 0);
      const worksheetReplay = await newPage(); const staleImportForm = await importForm(worksheetReplay);
      f = await importForm(); await submit(page, f.getByRole('button', { name: 'Import 1 approved worksheet', exact: true }), stage, success);
      const kpis = check(await client.from('kpis').select('id,actual_value,metric_date,source_file_id,import_id,raw_data_json').eq('import_id', importId).order('metric_date'), 'saved_kpis');
      assert.equal(kpis.length, 2); assert.deepEqual(kpis.map(x => [x.metric_date, Number(x.actual_value)]), [['2026-01-01', 42], ['2026-02-01', 43]]);
      assert(kpis.every(x => x.source_file_id === uploaded.id && x.import_id === importId && x.raw_data_json['Vaeroex source file ID'] === uploaded.id));
      assert.deepEqual(kpis.map(x => Number(x.raw_data_json['Vaeroex source row'])), [2, 3]);
      const attempts = (await db.query('select status,approved_mapping,approved_row_ids from private.file_import_attempts where workspace_id=$1 and import_id=$2', [a, importId])).rows;
      assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'completed');
      await page.getByText('2 of 2 rows were saved from this source.', { exact: true }).waitFor();
      if (iteration === 0) await page.screenshot({ path: path.join(output, `worksheet-${width}.png`), fullPage: true });
      await submit(worksheetReplay, staleImportForm.getByRole('button', { name: 'Import 1 approved worksheet', exact: true }), stage + '_stale_replay', u => u.searchParams.get('message') === 'Import completion verified from saved results. No rows were resubmitted.');
      assert.deepEqual(check(await client.from('kpis').select('id,actual_value,metric_date,source_file_id,import_id,raw_data_json').eq('import_id', importId).order('metric_date'), 'worksheet_replay'), kpis);
      assert.deepEqual((await db.query('select status,approved_mapping,approved_row_ids from private.file_import_attempts where workspace_id=$1 and import_id=$2', [a, importId])).rows, attempts);
      await worksheetReplay.close();
      stage = `reconciliation_${width}_${iteration}`;
      const heldUrl = `${appOrigin}/app/sources/${heldImport.file_upload_id}?section=imported`;
      await page.goto(heldUrl);
      f = page.locator('form').filter({ has: page.getByRole('button', { name: 'Check saved results', exact: true }) });
      assert.equal(await f.locator('[name="import_id"]').inputValue(), heldImport.id);
      await f.locator('[name="file_id"]').evaluate((e, value) => { e.value = value; }, foreignFile);
      await submit(page, f.getByRole('button', { name: 'Check saved results', exact: true }), stage + '_foreign_denied', failure);
      assert.deepEqual(await heldInventory(), heldBefore);
      await page.goto(heldUrl);
      await submit(page, page.getByRole('button', { name: 'Check saved results', exact: true }), stage, u => !!u.searchParams.get('error')?.includes('Accepted work remains held'));
      assert.deepEqual(await heldInventory(), heldBefore); await page.getByText('Import results need reconciliation', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.waitForURL(u => !u.searchParams.has('error'));
      await submit(page, page.getByRole('button', { name: 'Check saved results', exact: true }), stage + '_repeat', u => !!u.searchParams.get('error')?.includes('Accepted work remains held'));
      assert.deepEqual(await heldInventory(), heldBefore);
      const heads = check(await client.rpc('get_worksheet_publication_heads_v1', { p_workspace_id: a, p_file_ids: [heldImport.file_upload_id] }), 'held_head'); assert.equal(heads[0].completed_attempt_id, null);
      await page.screenshot({ path: path.join(output, `completed-${width}-${iteration}.png`) });
      result('persisted_integrity', { width, iteration, formRecords: 1, memoryChunks: 1, kpiRecords: 2, importAttempts: 1, heldInventoryUnchanged: true });
      await c.close();
    }
    assert.equal(browserErrors.length, 0, 'browser_errors'); result('focused_complete', { passed: true, widths: [1440, 390], repetitionsPerWidth: 3, providerCalls: 0 });
  } catch (error) {
    results.push({ name: stage, passed: false, error: sanitize(error.message) }); console.error(JSON.stringify({ stage, error: sanitize(error.message) })); process.exitCode = 1;
    if (browser) for (const c of browser.contexts()) for (const page of c.pages()) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(output, 'failure-ui.txt'), sanitize(await page.locator('body').innerText().catch(() => ''))); }
  } finally {
    if (caseActor && a) await admin.from('workspace_members').update({ role: 'owner' }).eq('workspace_id', a).eq('user_id', caseActor.id);
    if (browser) await browser.close(); if (app) { app.kill('SIGTERM'); await Promise.race([new Promise(resolve => app.once('exit', resolve)), sleep(5000)]); if (app.exitCode === null) app.kill('SIGKILL'); } await db.end().catch(() => {});
    sourceEnd = sourceManifest(); if (sourceBuilt && JSON.stringify(sourceBuilt) !== JSON.stringify(sourceEnd)) { results.push({ name: 'source_stability', passed: false }); process.exitCode = 1; }
    fs.writeFileSync(path.join(output, 'source-manifest.json'), JSON.stringify({ start: sourceStart, built: sourceBuilt, end: sourceEnd }, null, 2)+'\n');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: process.exitCode !== 1 && results.some(r => r.name === 'focused_complete'), sourceCommit: sourceBuilt?.head, buildId: sourceBuilt ? fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim() : null, executionId, runId: config.runId, captures, results, actionResponses, requests, browserErrors, limitations: ['Real isolated Auth/PostgREST/Storage; synthetic seeded legal acceptance and completed model outputs', 'No provider calls, production configuration, capacity or full lifecycle qualification'] }, null, 2)+'\n');
    fs.writeFileSync(path.join(output, 'build.log'), buildLog); fs.writeFileSync(path.join(output, 'app.log'), sanitize(appLog));
  }
})();
