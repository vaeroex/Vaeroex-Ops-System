/* eslint-disable @typescript-eslint/no-require-imports -- Disposable real Supabase workflow qualification, no hosted endpoints. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const { chromium } = require('playwright');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const [configFile, output, ...options] = process.argv.slice(2);
assert(options.length <= 1 && options.every(option => option === '--continue-after-navigation-failure'), 'unknown_closeout_option');
const continueAfterNavigationFailure = options.includes('--continue-after-navigation-failure');
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
async function seedActor(role, workspaceId) {
  const id = randomUUID(), email = `closeout-${id}@example.test`, password = randomBytes(24).toString('base64url'); secrets.push(password);
  check(await admin.auth.admin.createUser({ id, email, password, email_confirm: true, user_metadata: { full_name: `${prefix} ${role}` } }), 'auth_create');
  return { id, email, password, role, workspaceId };
}
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
  const page = await c.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', e => browserErrors.push({path:new URL(page.url()).pathname,message:sanitize(e.message),stack:sanitize(e.stack||'')}));
  page.on('response', r => { const u = new URL(r.url()); if (u.origin === appOrigin && !u.pathname.startsWith('/_next')) requests.push({ path: u.pathname, method: r.request().method(), status: r.status() }); });
  return { c, page, client: s.client };
}
function checkedActionRedirect(header, origin, expected) {
  assert(typeof header === 'string' && header.length > 0 && header.length <= 4096, 'action_redirect_required_for_manual_recovery');
  const target = new URL(header.split(';')[0], origin);
  assert(target.origin === origin && !target.username && !target.password && target.pathname.startsWith('/app/'), 'manual_recovery_requires_same_origin_workspace_redirect');
  assert(expected(target), 'action_redirect_did_not_match_expected_outcome');
  return target;
}
async function submitAndObserve(page, button, actionLabel, expected) {
  // Watch before clicking. This records the actual action response and never
  // treats a manually recovered destination as successful client navigation.
  const actionResponse = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'POST' && Boolean(request.headers()['next-action']) && new URL(response.url()).origin === appOrigin;
  }, { timeout: 20000 }).then(async response => {
    const headers = await response.allHeaders();
    return { path: new URL(response.url()).pathname, method: 'POST', status: response.status(),
      xActionRedirect: sanitize(headers['x-action-redirect'] || ''), contentType: headers['content-type'] || null };
  }).catch(error => ({ captureError: sanitize(error.message) }));
  const navigation = page.waitForURL(expected, { timeout: 20000 }).then(() => ({ passed: true })).catch(error => ({ passed: false, error: sanitize(error.message) }));
  await button.click();
  const outcome = await navigation;
  const response = await actionResponse;
  actionResponses.push({ actionLabel, ...response });
  if (outcome.passed) {
    assert(!response.captureError, 'actual_next_action_response_not_captured');
    result('browser_action_navigation', { actionLabel, response, manualRecovery: false });
    return;
  }
  const number = navigationFailures.length + 1;
  const screenshot = `navigation-failure-${number}.png`;
  const pending = await page.locator('button[aria-busy="true"], button:disabled').evaluateAll(buttons => buttons.map(button => ({
    text: button.textContent?.trim().slice(0,120), disabled: button.disabled, ariaBusy: button.getAttribute('aria-busy')
  })));
  const record = { name: 'browser_action_navigation', passed: false, actionLabel, response, pending,
    path: new URL(page.url()).pathname, error: outcome.error, screenshot, manualRecoveryRequested: continueAfterNavigationFailure };
  navigationFailures.push(record);results.push(record);process.exitCode = 1;
  console.error(JSON.stringify({ check: record.name, passed: false, actionLabel }));
  await page.screenshot({ path: path.join(output, screenshot), fullPage: false });
  fs.writeFileSync(path.join(output, `navigation-failure-${number}.txt`), sanitize(await page.locator('body').innerText()));
  if (!continueAfterNavigationFailure) throw new Error(`client_action_navigation_failed:${actionLabel}`);
  assert(!response.captureError, 'actual_next_action_response_not_captured');
  assert(response.status === 303, 'manual_recovery_requires_action_redirect_response');
  const target = checkedActionRedirect(response.xActionRedirect, appOrigin, expected);
  // Explicit test-driver recovery only; no second mutation or automatic retry.
  await page.goto(target.href);
  await page.waitForURL(expected, { timeout: 20000 });
  result('manual_navigation_recovery', { actionLabel, destination: target.pathname + target.search,
    automaticNavigationPassed: false, purpose: 'Continue independent persisted/UI checks; client behavior remains failed.' });
}
async function fillSubmission(page, formId, label) {
  await page.goto(`${appOrigin}/app/forms/${formId}`);
  await page.locator('summary').filter({hasText:'New Submission'}).click();
  const dialog = page.locator('form').filter({has:page.locator('[name="submission_request_id"]')});
  await dialog.locator('[name="field:equipment"]').fill(`${label} equipment`);
  await dialog.locator('[name="submitter_name"]').fill(label);
  await dialog.locator('[name="summary"]').fill(`${label} observed synthetic state`);
  return dialog;
}
(async () => {
  try {
    await db.connect();
    const dbIdentity = (await db.query("select current_database() db, current_setting('server_version') version, current_setting('max_connections') max_connections,current_setting('data_directory') data_directory")).rows[0];
    const ownedHome=fs.realpathSync(config.ownedSupabaseHome || '/tmp/vaeroex-closeout-supabase-home');
    assert(/^\/(?:private\/)?tmp\/vaeroex-closeout-(?:supabase-home|assembly-[a-zA-Z0-9-]+\/home)$/.test(ownedHome),'owned_home_shape_required');
    assert(fs.realpathSync(dbIdentity.data_directory).startsWith(ownedHome+'/stacks/'),'owned_native_data_directory_required');
    appOrigin = `http://127.0.0.1:${await reservePort()}`;
    assert.equal(dbIdentity.db, 'postgres');
    // Retries create new bounded fixtures and preserve prior failed-run evidence.
    // This private ownership manifest never permits writes into unknown workspaces.
    const fixtureFile = configFile + '.fixtures.json';
    const fixture = fs.existsSync(fixtureFile) ? JSON.parse(fs.readFileSync(fixtureFile,'utf8')) : {runId:config.runId, executions:[]};
    assert.equal(fixture.runId,config.runId);assert(fixture.executions.length<5,'maximum_five_isolated_attempts');
    const allowed = new Set(fixture.executions.flatMap(x=>x.workspaces));
    const existing = check(await admin.from('workspaces').select('id,name').limit(100), 'owned_db_check');
    assert(existing.every(x=>allowed.has(x.id)&&x.name.startsWith(`CLOSEOUT ${config.runId.slice(0,8)} `)),'unknown_workspace_in_fixture_database');
    const a = randomUUID(), b = randomUUID(), expired = randomUUID();
    fixture.executions.push({executionId,workspaces:[a,b,expired]});
    fs.writeFileSync(fixtureFile,JSON.stringify(fixture,null,2),{mode:0o600});
    const owner = await seedActor('owner', a), staff = await seedActor('staff', a), viewer = await seedActor('viewer', a), foreign = await seedActor('owner', b), unpaid = await seedActor('owner', expired);
    const manager = await seedActor('manager',a), administrator = await seedActor('admin',a);
    const actors = [owner, staff, viewer, foreign, unpaid, manager, administrator];
    for (const actor of [owner, foreign, unpaid]) {
      check(await admin.from('workspaces').insert({ id: actor.workspaceId, name: `${prefix} ${actor===unpaid?'expired':actor===foreign?'B':'A'}`, created_by: actor.id, primary_contact_email: actor.email, industry: 'Synthetic audit', subscription_status: actor===unpaid?'expired':'trialing', trial_ends_at: new Date(Date.now() + (actor===unpaid?-1:1)*86400000).toISOString(), plan_slug: 'vaeroex', reporting_timezone: 'UTC' }), 'workspace_seed');
    }
    check(await admin.from('workspace_members').insert(actors.map(x => ({ workspace_id: x.workspaceId, user_id: x.id, role: x.role, status: 'active' }))), 'membership_seed');
    const legal = /terms: "([\d-]+)"/.exec(fs.readFileSync(path.join(root, 'lib/legal/content.ts'), 'utf8'))[1];
    check(await admin.from('legal_acceptances').insert(actors.map(x => ({ user_id: x.id, workspace_id: x.workspaceId, terms_version: legal, privacy_version: legal, ai_disclaimer_version: legal, sensitive_data_policy_version: legal, user_email: x.email, user_agent: 'Synthetic closeout fixture' }))), 'legal_seed');
    const formId = randomUUID();
    check(await admin.from('forms').insert({ id: formId, workspace_id: a, name: `${prefix} inspection`, schema_json: [{ key: 'equipment', label: 'Equipment', type: 'text', required: true }], created_by: owner.id }), 'form_seed');
    const assetId = randomUUID(); check(await admin.from('assets').insert({ id: assetId, workspace_id: a, asset_name: `${prefix} asset`, status: 'Ready' }), 'asset_seed');
    check(await admin.from('asset_checks').insert(Array.from({ length: 22 }, (_, i) => ({ workspace_id: a, asset_id: assetId, checked_by: owner.id, status: 'Ready', notes: `${prefix} historical ${i}`, created_at: new Date(Date.UTC(2024, 0, i+1)).toISOString() }))), 'history_seed');
    const memoryFile=randomUUID(), memoryRun=randomUUID();
    const evidenceText='Revenue amount October 100. This financial worksheet records the actual October revenue amount for the business. The owner reviews the revenue worksheet before making operational decisions.';
    const analysis={evidence_classification:'business_evidence',extraction_outcome:'facts_extracted',findings:['Revenue amount October 100'],summary:'Revenue amount October 100'};
    const memoryPath=`${a}/${memoryFile}/synthetic-memory.csv`;
    check(await admin.storage.from('workspace-files').upload(memoryPath,Buffer.from(evidenceText),{contentType:'text/csv'}),'memory_storage_seed');
    check(await admin.from('file_uploads').insert({id:memoryFile,workspace_id:a,original_name:'synthetic-memory.csv',display_name:`${prefix} reviewed source`,file_extension:'csv',mime_type:'text/csv',file_size_bytes:Buffer.byteLength(evidenceText),storage_bucket:'workspace-files',storage_path:memoryPath,created_by:owner.id,processing_status:'ready',analysis_summary:analysis.summary,metadata_json:{latest_analysis_run_id:memoryRun,latest_analysis_status:'needs_review',analysis_review_status:'needs_review',latest_analysis_output:analysis,latest_text_extraction:{extracted_text:evidenceText}}}),'memory_file_seed');
    await db.query("insert into public.ai_agent_runs(id,workspace_id,agent_type,status,input_json,output_json,created_by) values($1,$2,'file_analysis','completed',$3::jsonb,$4::jsonb,$5)",[memoryRun,a,JSON.stringify({evidence_lineage:{source_file_id:memoryFile},extra_inputs:{file:{id:memoryFile}}}),JSON.stringify(analysis),owner.id]);
    result('real_auth_and_synthetic_seed', { registeredUsers: actors.length, workspaces: 3, db: dbIdentity, legalAcceptance: 'seeded synthetic latest-policy acceptance' });
    stage = 'build';
    sourceStart=sourceManifest();
    const env = { PATH: process.env.PATH, HOME: os.homedir(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--max-old-space-size=2048 --require=${path.join(root, 'scripts/workspace-closeout-egress.cjs')}`, NEXT_PUBLIC_SUPABASE_URL: config.apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey, NEXT_PUBLIC_APP_URL: appOrigin, TZ: 'UTC' };
    const built = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], { cwd: root, env, encoding: 'utf8', timeout: 600000, maxBuffer: 16*1024*1024 }); buildLog = sanitize((built.stdout||'') + (built.stderr||'')); assert.equal(built.status, 0, 'production_build_failed');
    sourceBuilt=sourceManifest();assert.deepEqual(sourceBuilt,sourceStart,'source_changed_during_build');
    app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(appOrigin).port], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.on('error',()=>{appLog+='owned_app_spawn_error';});
    for (const stream of [app.stdout, app.stderr]) stream.on('data', b => { appLog = (appLog + sanitize(b.toString())).slice(-100000); });
    await waitFor(async () => { try { return (await fetch(appOrigin+'/login',{signal:AbortSignal.timeout(4000)})).status===200; } catch { return false; } }, 'app_ready');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    stage = 'authenticated_browser';
    for (const width of [1440,390]) {
      const { c, page, client } = await context(owner,width); const label = `${prefix} form ${width}`;
      const dialog = await fillSubmission(page,formId,label);
      const requestId=await dialog.locator('[name="submission_request_id"]').inputValue();assert.match(requestId,/^[0-9a-f-]{36}$/);
      await submitAndObserve(page, dialog.getByRole('button',{name:'Save submission',exact:true}), `internal_form_owner_${width}`, u=>u.searchParams.has('message'));
      await waitFor(async()=>{const r=check(await client.from('form_submissions').select('id,data_json').eq('workspace_id',a).eq('submitter_name',label),'submission_read');return r.length===1?r[0]:null;},'persisted_form');
      const rows = check(await client.from('form_submissions').select('id,data_json').eq('submitter_name',label),'form_verify'); assert.equal(rows.length,1); assert.equal(rows[0].data_json.fields.equipment,`${label} equipment`);assert.equal(rows[0].data_json.schema_snapshot[0].key,'equipment');
      const receipt=(await db.query('select submission_id from private.internal_form_submission_receipts where workspace_id=$1 and form_id=$2 and actor_id=$3 and request_id=$4',[a,formId,owner.id,requestId])).rows;assert.equal(receipt.length,1);assert.equal(receipt[0].submission_id,rows[0].id);
      const replayArgs={p_workspace_id:a,p_form_id:formId,p_request_id:requestId,p_submitter_name:label,p_submitter_email:'',p_data_json:rows[0].data_json};
      const replay=check(await client.rpc('submit_internal_form_v1',replayArgs),'form_rpc_replay');assert.equal(replay.replayed,true);assert.equal(replay.submissionId,rows[0].id);
      const conflict=await client.rpc('submit_internal_form_v1',{...replayArgs,p_data_json:{...rows[0].data_json,summary:'Changed replay'}});assert.equal(conflict.error?.code,'22023');
      assert.equal(check(await client.from('form_submissions').select('id').eq('submitter_name',label),'replay_count').length,1);
      result('real_postgrest_form_replay_and_payload_conflict',{width});
      await page.reload();assert((await page.locator('body').innerText()).includes(label));
      result('browser_form_persists_after_reload',{width});
      await page.goto(`${appOrigin}/app/assets/checks?asset_id=${assetId}&size=10`);assert((await page.getByRole('navigation',{name:'Asset check history pages'}).innerText()).includes('of 22 checks'));
      await page.getByRole('link',{name:'Next',exact:true}).click();await waitFor(async()=>(await page.getByRole('navigation',{name:'Asset check history pages'}).innerText()).includes('Page 2'),'history_page2');
      await page.locator('[name="q"]').fill('historical 21');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await waitFor(async()=>(await page.getByRole('navigation',{name:'Asset check history pages'}).innerText()).includes('1 checks'),'history_filter');
      result('browser_complete_history_filter_pagination',{width});
      await page.screenshot({path:path.join(output,`history-${width}.png`),fullPage:false});await c.close();
    }
    for(const actor of [manager,administrator]) {
      const {c,page,client}=await context(actor,390), label=`${prefix} ${actor.role} submission`;
      const dialog=await fillSubmission(page,formId,label);await submitAndObserve(page, dialog.getByRole('button',{name:'Save submission',exact:true}), `internal_form_${actor.role}_390`, u=>u.searchParams.has('message'));
      await waitFor(async()=>check(await client.from('form_submissions').select('id').eq('submitter_name',label),'operator_form').length===1,'operator_form_persist');result('browser_operator_form_persistence',{role:actor.role});await c.close();
    }
    stage='browser_memory_confirmation';
    const memory=await context(owner,390);await memory.page.goto(`${appOrigin}/app/sources/${memoryFile}`);
    assert.equal(check(await memory.client.from('business_memory_chunks').select('id').eq('source_file_id',memoryFile),'memory_before').length,0);
    await submitAndObserve(memory.page, memory.page.getByRole('button',{name:'Approve learning',exact:true}), 'memory_confirmation', u=>u.searchParams.has('message'));
    const published=await waitFor(async()=>{const rows=check(await memory.client.from('business_memory_chunks').select('id,source_excerpt,source_metadata').eq('source_file_id',memoryFile).is('archived_at',null),'memory_after');return rows.length?rows:null;},'confirmed_memory_persist');
    assert(published.every(x=>x.source_excerpt.includes('Revenue amount October 100')&&x.source_metadata.source_run_id===memoryRun));
    const approved=check(await memory.client.from('file_uploads').select('metadata_json,index_status,indexed_chunk_count').eq('id',memoryFile).single(),'memory_receipt');assert.equal(approved.index_status,'ready');assert.equal(approved.indexed_chunk_count,published.length);assert.equal(approved.metadata_json.analysis_review_status,'approved');
    await memory.page.reload();await waitFor(async()=>(await memory.page.locator('body').innerText()).includes('Available to Intelligence and Learned Knowledge.'),'memory_ui_learned');
    result('browser_confirmed_memory_atomic_publication',{width:390,chunks:published.length,model:'synthetic completed-run fixture, no model call',embeddings:'actual no-key text-only fallback with real pgvector column'});await memory.c.close();
    stage='denied_permissions';
    const view = await context(viewer,390); const deniedLabel=`${prefix} viewer denied`;const deniedForm=await fillSubmission(view.page,formId,deniedLabel);await submitAndObserve(view.page, deniedForm.getByRole('button',{name:'Save submission',exact:true}), 'viewer_form_denial', u=>u.searchParams.has('error'));assert.equal(check(await admin.from('form_submissions').select('id').eq('submitter_name',deniedLabel),'denied_read').length,0);result('browser_viewer_action_denied');await view.c.close();
    const s = await context(staff,390);await s.page.goto(appOrigin+'/app/assets');await s.page.locator('summary').filter({hasText:'New Check'}).click();const d=s.page.locator('form').filter({has:s.page.locator('[name="asset_id"]')});await d.locator('[name="asset_id"]').selectOption(assetId);await d.locator('[name="status"]').selectOption('Out of service');await d.locator('[name="notes"]').fill(`${prefix} current check`);await submitAndObserve(s.page, d.getByRole('button',{name:'Save check',exact:true}), 'staff_asset_check', u=>u.searchParams.has('message'));
    await waitFor(async()=>check(await s.client.from('assets').select('status').eq('id',assetId).single(),'readiness').status==='Out of service','atomic_readiness');result('browser_asset_check_atomic_readiness');await s.c.close();
    const f=await session(foreign), u=await session(unpaid), own=await session(owner);
    assert.equal(check(await f.client.from('form_submissions').select('id').eq('workspace_id',a),'foreign_read').length,0);
    assert.equal(check(await f.client.from('business_memory_chunks').select('id').eq('source_file_id',memoryFile),'foreign_memory_read').length,0);
    const foreignPublication=await f.client.rpc('publish_confirmed_file_memory_v1',{p_workspace_id:a,p_file_id:memoryFile,p_run_id:memoryRun,p_confirmed_by:foreign.id,p_chunks:[{source_excerpt:evidenceText}],p_summary:analysis.summary,p_embedding_error:null});assert.equal(foreignPublication.error?.code,'42501');result('real_postgrest_foreign_memory_read_and_publication_denied');
    const deniedInsert=await f.client.from('form_submissions').insert({workspace_id:b,form_id:formId,submitted_by:foreign.id});assert(deniedInsert.error);result('postgrest_cross_workspace_parent_and_read_denied');
    assert((await u.client.from('forms').insert({workspace_id:expired,name:'expired denied',created_by:unpaid.id})).error);result('postgrest_expired_mutation_denied');
    const bytes=Buffer.from(`${prefix} synthetic storage only`), key=`${a}/${randomUUID()}/fixture.csv`;
    check(await own.client.storage.from('workspace-files').upload(key,bytes,{contentType:'text/csv'}),'storage_own_upload');const downloaded=check(await own.client.storage.from('workspace-files').download(key),'storage_own_download');assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
    assert((await f.client.storage.from('workspace-files').download(key)).error);assert((await f.client.storage.from('workspace-files').upload(`${a}/${randomUUID()}/foreign.csv`,bytes)).error);assert((await u.client.storage.from('workspace-files').upload(`${expired}/${randomUUID()}/expired.csv`,bytes)).error);result('real_storage_owned_digest_foreign_and_expired_denials');
    stage='browser_upload';const upload=await context(owner,390);await upload.page.goto(appOrigin+'/app/sources');await upload.page.locator('#workspace-file-upload > summary').click();const input=upload.page.locator('input[type="file"]');
    await input.setInputFiles({name:`closeout-${config.runId.slice(0,8)}.csv`,mimeType:'text/csv',buffer:Buffer.from('date,revenue\n2026-01-01,42\n2026-02-01,43\n')});await upload.page.locator('[name="display_name"]').fill(`${prefix} uploaded source`);await submitAndObserve(upload.page, upload.page.getByRole('button',{name:'Upload and prepare review',exact:true}), 'source_upload_prepare', u=>/^\/app\/sources\/[0-9a-f-]{36}$/.test(u.pathname)&&u.searchParams.get('section')==='imported');
    const saved=await waitFor(async()=>{const rows=check(await admin.from('file_uploads').select('id,storage_bucket,storage_path').eq('workspace_id',a).eq('display_name',`${prefix} uploaded source`),'upload_read');return rows.length===1?rows[0]:null;},'browser_upload_persist',60000);
    check(await own.client.storage.from(saved.storage_bucket).download(saved.storage_path),'browser_upload_object');result('browser_upload_real_storage_and_source_record',{width:390});
    stage='browser_import_approval';assert.equal(new URL(upload.page.url()).pathname,`/app/sources/${saved.id}`);
    await waitFor(async()=>check(await own.client.from('file_import_rows').select('id').eq('file_upload_id',saved.id),'staged_upload_rows').length===2,'upload_prepared_rows');await upload.page.goto(`${appOrigin}/app/sources/${saved.id}?section=imported`);
    const importForm=upload.page.locator('form').filter({has:upload.page.locator('[name="workbook_mode"]')});
    await importForm.locator('[name="worksheet_1_enabled"]').check();await importForm.locator('[name="worksheet_1_type"]').selectOption('wide_time_series');await importForm.locator('[name="worksheet_1_map_period"]').selectOption('date');
    const importId=await importForm.locator('[name="import_id"]').inputValue();
    assert.equal(check(await own.client.from('kpis').select('id').eq('source_file_id',saved.id),'unapproved_no_kpis').length,0);
    await submitAndObserve(upload.page, importForm.getByRole('button',{name:'Import 1 approved worksheet',exact:true}), 'worksheet_import_approval', u=>u.pathname===`/app/sources/${saved.id}`&&u.searchParams.get('section')==='imported'&&u.searchParams.has('message'));
    const completed=await waitFor(async()=>{const r=check(await own.client.from('file_imports').select('status,recovery_status,rows_imported').eq('id',importId).single(),'import_persist');if(r.status==='failed')throw Error('import_reported_failure');return r.recovery_status==='completed'?r:null;},'import_completed',60000);assert.equal(completed.status,'completed');assert.equal(completed.rows_imported,2);
    const kpis=check(await own.client.from('kpis').select('id,actual_value,metric_date,source_file_id,import_id,raw_data_json').eq('import_id',importId),'import_kpis');assert.equal(kpis.length,2);assert.deepEqual(kpis.map(x=>Number(x.actual_value)).sort(),[42,43]);assert(kpis.every(x=>x.source_file_id===saved.id&&x.import_id===importId));
    assert.deepEqual(kpis.map(x=>({date:x.metric_date,value:Number(x.actual_value)})).sort((x,y)=>x.date.localeCompare(y.date)),[{date:'2026-01-01',value:42},{date:'2026-02-01',value:43}]);
    for(const kpi of kpis){const raw=kpi.raw_data_json;assert.equal(raw['Vaeroex source file ID'],saved.id);assert.equal(raw['Vaeroex worksheet'],'CSV');assert.equal(Number(raw['Vaeroex worksheet index']),1);assert.equal(raw['Vaeroex dataset type'],'wide_time_series');assert.equal(raw['Vaeroex period column'],'date');assert.equal(raw['Vaeroex metric column'],'revenue');assert.equal(raw['Vaeroex original period'],kpi.metric_date);assert.equal(Number(raw['Vaeroex source row']),kpi.metric_date==='2026-01-01'?2:3);}
    const reconciled=check(await own.client.rpc('reconcile_file_import_attempt_v1',{p_workspace_id:a,p_file_id:saved.id,p_import_id:importId,p_failed:false}),'real_import_reconciliation');assert.equal(reconciled.status,'completed');assert.equal(reconciled.kpi_records,2);assert.equal(reconciled.requires_operator_review,false);
    const receipt=(await db.query('select approved_mapping,approved_row_ids from private.file_import_attempts where workspace_id=$1 and import_id=$2',[a,importId])).rows;assert.equal(receipt.length,1);
    const replay=check(await own.client.rpc('begin_file_import_attempt_v1',{p_workspace_id:a,p_file_id:saved.id,p_import_id:importId,p_approved_mapping:receipt[0].approved_mapping,p_row_ids:receipt[0].approved_row_ids}),'real_import_replay');assert.equal(replay.admitted,false);assert.equal(replay.status,'completed');assert.equal(check(await own.client.from('kpis').select('id').eq('import_id',importId),'import_replay_count').length,2);
    await upload.page.reload();await waitFor(async()=>(await upload.page.locator('body').innerText()).includes('2 of 2 rows were saved from this source.'),'completed_import_ui');result('browser_import_confirmed_once_with_real_reconciliation',{width:390,kpiRecords:2,approvedRows:2,replayAdmitted:false});await upload.c.close();
    stage='seeded_partial_import_hold';
    // This is a synthetic partial-attempt fixture via the real authenticated API,
    // not a second upload workflow or a model/embedding-provider qualification.
    const completedChunkIds=check(await own.client.from('business_memory_chunks').select('id').eq('source_file_id',saved.id).eq('source_type','file').is('archived_at',null).is('deleted_at',null),'completed_worksheet_inventory').map(row=>row.id).sort();
    assert(completedChunkIds.length>0,'completed_worksheet_positive_control_required');
    const heldFileId=randomUUID(), heldImportId=randomUUID(), heldRowId=randomUUID(), heldChunkId=randomUUID();
    const heldCsv=Buffer.from('date,revenue\n2026-03-01,99\n');const heldPath=`${a}/${heldFileId}/synthetic-partial.csv`;
    check(await own.client.storage.from('workspace-files').upload(heldPath,heldCsv,{contentType:'text/csv'}),'held_storage_fixture');
    check(await own.client.from('file_uploads').insert({id:heldFileId,workspace_id:a,created_by:owner.id,original_name:'synthetic-partial.csv',display_name:`${prefix} partial attempt`,file_extension:'csv',mime_type:'text/csv',file_size_bytes:heldCsv.length,storage_bucket:'workspace-files',storage_path:heldPath,processing_status:'ready',import_status:'extracted',metadata_json:{fixture:'synthetic partial-attempt qualification'}}),'held_source_fixture');
    const heldMapping={...receipt[0].approved_mapping,preparation_id:randomUUID(),worksheets:receipt[0].approved_mapping.worksheets.map(plan=>({...plan,row_count:1}))};
    check(await own.client.from('file_imports').insert({id:heldImportId,workspace_id:a,file_upload_id:heldFileId,created_by:owner.id,import_type:'metrics',status:'needs_review',rows_total:1,rows_imported:0,mapping_json:heldMapping}),'held_import_fixture');
    check(await own.client.from('file_import_rows').insert({id:heldRowId,workspace_id:a,file_upload_id:heldFileId,import_id:heldImportId,import_type:'metrics',row_number:1,data_json:{date:'2026-03-01',revenue:99},mapped_data_json:{__source:{worksheet:'CSV',worksheet_index:1,row_number:2}},validation_errors_json:[],status:'staged'}),'held_row_fixture');
    const heldAttempt=check(await own.client.rpc('begin_file_import_attempt_v1',{p_workspace_id:a,p_file_id:heldFileId,p_import_id:heldImportId,p_approved_mapping:heldMapping,p_row_ids:[heldRowId]}),'held_actual_admission');assert.equal(heldAttempt.admitted,true);
    const publicationHeads=check(await own.client.rpc('get_worksheet_publication_heads_v1',{p_workspace_id:a,p_file_ids:[heldFileId,saved.id]}),'held_publication_heads');assert.equal(publicationHeads.length,2);assert.equal(publicationHeads.find(row=>row.file_id===heldFileId)?.completed_attempt_id,null);assert.equal(publicationHeads.find(row=>row.file_id===saved.id)?.completed_attempt_id,replay.attempt_id);
    const basis=[1,...Array(1535).fill(0)];
    check(await own.client.from('business_memory_chunks').insert({id:heldChunkId,workspace_id:a,source_type:'file',source_id:heldFileId,source_file_id:heldFileId,source_title:'Synthetic uncompleted worksheet',source_excerpt:'Synthetic March revenue is 99 units. This reviewed worksheet row is intentionally held in an unfinished import for isolation verification.',content_hash:createHash('sha256').update(heldChunkId).digest('hex'),chunk_index:0,embedding:JSON.stringify(basis),source_metadata:{indexing_method:'worksheet_import',import_id:heldImportId,import_attempt_id:heldAttempt.attempt_id,evidence_classification:'business_evidence',extraction_outcome:'completed',review_status:'approved'}}),'held_partial_chunk');
    assert.equal(check(await own.client.from('business_memory_chunks').select('id').eq('id',heldChunkId),'held_chunk_persisted').length,1);
    const positiveId=published[0].id;
    const updatedPositive=check(await own.client.from('business_memory_chunks').update({embedding:JSON.stringify(basis)}).eq('id',positiveId).eq('workspace_id',a).select('id'),'synthetic_vector_positive_control');assert.equal(updatedPositive.length,1);
    const matches=check(await own.client.rpc('match_business_memory_chunks',{target_workspace_id:a,query_embedding:basis,match_count:40,min_similarity:0.9}),'held_vector_retrieval');assert(matches.some(row=>row.id===positiveId),'confirmed_vector_positive_control_missing');assert(!matches.some(row=>row.id===heldChunkId),'unfinished_worksheet_became_retrievable');
    assert.deepEqual(check(await own.client.from('business_memory_chunks').select('id').eq('source_file_id',saved.id).eq('source_type','file').is('archived_at',null).is('deleted_at',null),'completed_worksheet_preserved').map(row=>row.id).sort(),completedChunkIds);
    assert.equal(check(await own.client.from('kpis').select('id').eq('import_id',importId),'completed_kpis_preserved').length,2);
    const held=await context(owner,390);await held.page.goto(`${appOrigin}/app/sources/${heldFileId}`);
    await held.page.getByText('Import held',{exact:true}).first().waitFor({state:'visible'});
    await held.page.getByText('This import is not yet published. Any previously completed worksheet evidence remains available while its saved results are reconciled.',{exact:true}).waitFor({state:'visible'});
    await held.page.goto(`${appOrigin}/app/sources/${heldFileId}?section=imported`);
    await held.page.getByText('Import results need reconciliation',{exact:true}).waitFor({state:'visible'});
    assert(await held.page.getByRole('button',{name:'Check saved results',exact:true}).isVisible());
    assert.equal(await held.page.getByRole('button',{name:/^(Prepare workbook import|Re-prepare workbook|Import \d+ approved worksheet)/}).count(),0);
    await held.page.screenshot({path:path.join(output,'held-import-390.png'),fullPage:false});await held.c.close();
    result('seeded_partial_import_remains_unpublished',{width:390,fixture:'Real authenticated admission plus a deliberately incomplete synthetic worksheet chunk; no worker or provider call',pendingChunkPersisted:true,pendingChunkRetrieved:false,confirmedVectorPositiveControl:true,embedding:'Synthetic fixed basis vector; no semantic-ranking claim',priorCompletedChunkCount:completedChunkIds.length,priorKpiCount:2});
    assert.equal(browserErrors.length,0,'unexpected_browser_error');
    const passed = !results.some(record=>record.passed===false);if(!passed)process.exitCode=1;
    result('closeout_complete',{passed,capacityTargetsExecuted:false,providerCalls:0,automaticNavigationPassed:navigationFailures.length===0,manualRecoveryMode:continueAfterNavigationFailure});
  } catch(error) { if(browser)for(const c of browser.contexts())for(const page of c.pages()){fs.writeFileSync(path.join(output,'failure-ui.txt'),sanitize(await page.locator('body').innerText().catch(()=>'')));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});} results.push({name:stage,passed:false,error:sanitize(error.message)});console.error(JSON.stringify({stage,error:sanitize(error.message)}));process.exitCode=1; }
  finally {
    if(browser)await browser.close();if(app){app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),sleep(5000)]);if(app.exitCode===null)app.kill('SIGKILL');}await db.end().catch(()=>{});
    sourceEnd=sourceManifest();if(sourceBuilt&&JSON.stringify(sourceEnd)!==JSON.stringify(sourceBuilt)){results.push({name:'source_stability',passed:false});process.exitCode=1;}
    const overallPassed = process.exitCode !== 1 && !results.some(record=>record.passed===false) && browserErrors.length===0;
    const completion = results.find(record=>record.name==='closeout_complete');
    if(completion)completion.passed=overallPassed;
    else results.push({name:'closeout_complete',passed:false,reason:'Qualification stopped before independent checks finished.'});
    if(!overallPassed || !completion)process.exitCode=1;
    fs.writeFileSync(path.join(output,'source-manifest.json'),JSON.stringify({start:sourceStart,built:sourceBuilt,end:sourceEnd},null,2)+'\n');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({runId:config.runId,executionId,passed:overallPassed&&Boolean(completion),sourceCommit:sourceBuilt?.head||sourceEnd.head,results,requests,browserErrors,actionResponses,navigationFailures,manualRecoveryMode:continueAfterNavigationFailure,limitations:['Supabase native service versions differ from deployed PostgreSQL17.6','Synthetic legal acceptance seeded','No paid provider or customer connections','No full-system capacity target or worker soak performed',...(navigationFailures.length?['Known client navigation failures remain failed; explicit same-origin manual navigation was used only when the continuation flag was supplied.']:[])]},null,2)+'\n');
    fs.writeFileSync(path.join(output,'build.log'),buildLog);fs.writeFileSync(path.join(output,'app.log'),sanitize(appLog));
  }
})();
