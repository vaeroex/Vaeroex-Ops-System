/* Prepared final recovery-control driver: reuses original source-tail1 fixture; no execution/build during preparation. */
/* eslint-disable @typescript-eslint/no-require-imports -- Disposable real Supabase workflow qualification, no hosted endpoints. */
const taskRequire = require('node:module').createRequire('/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex/package.json');
if(process.env.VXT_EXECUTE !== 'yes') { console.log('Prepared only. Explicit VXT_EXECUTE=yes and expected commit/build/source hashes are required; this driver never builds.');process.exit(0); }
const fs = taskRequire('node:fs'), path = taskRequire('node:path'), os = taskRequire('node:os');
const assert = taskRequire('node:assert/strict');
const { randomUUID, randomBytes, createHash } = taskRequire('node:crypto');
const { spawn, spawnSync } = taskRequire('node:child_process');
const { createClient } = taskRequire('@supabase/supabase-js');
const { createServerClient } = taskRequire('@supabase/ssr');
const { chromium } = taskRequire('playwright');
const { Client } = taskRequire('pg');
const root = '/Users/isaacvizcarra/.codex/worktrees/workspace-audit-fixes/Vaeroex';
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
let app, browser, stage = 'seed', buildLog = '', appLog = '';
let appOrigin;
let sourceStart, sourceBuilt, sourceEnd;
const sourceManifest = () => { const files = spawnSync('git',['ls-files','-co','--exclude-standard'],{cwd:root,encoding:'utf8'}).stdout.trim().split('\n').filter(p=>!['docs/','scripts/','supabase/','.github/','services/','tools/'].some(prefix=>p.startsWith(prefix))&&fs.existsSync(path.join(root,p))); return {head:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),files:[...new Set(files)].sort().map(p=>({path:p,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')}))}; };
const assertOwnedApp = () => { assert(app && app.exitCode===null && !app.signalCode, 'owned_app_exited'); };

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
(async () => {
  try {
    await db.connect();
    const dbIdentity = (await db.query("select current_database() db, current_setting('server_version') version, current_setting('max_connections') max_connections,current_setting('data_directory') data_directory")).rows[0];
    const ownedHome=fs.realpathSync(config.ownedSupabaseHome || '/tmp/vaeroex-closeout-supabase-home');
    assert(/^\/(?:private\/)?tmp\/vaeroex-closeout-(?:supabase-home|assembly-[a-zA-Z0-9-]+\/home)$/.test(ownedHome),'owned_home_shape_required');
    assert(fs.realpathSync(dbIdentity.data_directory).startsWith(ownedHome+'/stacks/'),'owned_native_data_directory_required');
    assert.match(process.env.VXT_EXPECTED_APP_ORIGIN||'',/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/,'explicit_build_app_origin_required');
    const expectedOrigin=new URL(process.env.VXT_EXPECTED_APP_ORIGIN);
    assert(Number(expectedOrigin.port)>0&&Number(expectedOrigin.port)<=65535,'valid_nonzero_loopback_port_required');
    assert.equal(expectedOrigin.origin,process.env.VXT_EXPECTED_APP_ORIGIN,'canonical_loopback_origin_required');
    appOrigin=expectedOrigin.origin;
    assert.equal(dbIdentity.db, 'postgres');
    assert.match(process.env.VXT_EXPECTED_COMMIT||'',/^[a-f0-9]{40}$/);
    assert.match(process.env.VXT_EXPECTED_SOURCE_SHA256||'',/^[a-f0-9]{64}$/);
    assert(process.env.VXT_EXPECTED_BUILD_ID,'expected_build_id_required');
    assert.equal(spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),process.env.VXT_EXPECTED_COMMIT);
    assert.equal(fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(),process.env.VXT_EXPECTED_BUILD_ID);
    const sourceFile=path.join(root,'app/app/sources/SourcesPage.tsx');
    assert.equal(createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'),process.env.VXT_EXPECTED_SOURCE_SHA256);
    const fixtureManifest=JSON.parse(fs.readFileSync(configFile+'.fixtures.json','utf8'));
    assert.equal(fixtureManifest.runId,config.runId);assert(fixtureManifest.executions.length>0);
    assert.equal(fixtureManifest.executions.at(-1).executionId,process.env.VXT_EXPECTED_FIXTURE_EXECUTION,'explicit_fixture_execution_required');
    const a=fixtureManifest.executions.at(-1).workspaces[0];
    const workspace=check(await admin.from('workspaces').select('id,name').eq('id',a).single(),'owned_existing_workspace');
    assert(workspace.name.startsWith(`CLOSEOUT ${config.runId.slice(0,8)} `),'synthetic_workspace_required');
    const member=check(await admin.from('workspace_members').select('user_id,role').eq('workspace_id',a).eq('role','owner').eq('status','active').single(),'owned_existing_owner');
    const existingUser=check(await admin.auth.admin.getUserById(member.user_id),'synthetic_owner_lookup').user;
    assert(/^closeout-[a-f0-9-]+@example\.test$/.test(existingUser.email),'synthetic_owner_required');
    const password=randomBytes(24).toString('base64url');secrets.push(password);
    check(await admin.auth.admin.updateUserById(member.user_id,{password}),'synthetic_owner_password_for_tail');
    const owner={id:member.user_id,email:existingUser.email,password,role:'owner',workspaceId:a};
    sourceStart=sourceManifest();sourceBuilt=sourceStart;
    const env = { PATH: process.env.PATH, HOME: os.homedir(), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NODE_OPTIONS: `--max-old-space-size=2048 --require=${path.join(root, 'scripts/workspace-closeout-egress.cjs')}`, NEXT_PUBLIC_SUPABASE_URL: config.apiUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey, NEXT_PUBLIC_APP_URL: appOrigin, TZ: 'UTC' };
    app = spawn(process.execPath, [taskRequire.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(appOrigin).port], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    app.on('error',()=>{appLog+='owned_app_spawn_error';});
    for (const stream of [app.stdout, app.stderr]) stream.on('data', b => { appLog = (appLog + sanitize(b.toString())).slice(-100000); });
    await waitFor(async () => { try { return (await fetch(appOrigin+'/login',{signal:AbortSignal.timeout(4000)})).status===200; } catch { return false; } }, 'app_ready');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    const own=await session(owner);
    stage='held_recovery_preflight';
    const prior=JSON.parse(fs.readFileSync('/tmp/vaeroex-closeout-source-tail-1/result.json','utf8'));
    assert.equal(prior.runId,config.runId);assert.equal(prior.sourceCommit,process.env.VXT_EXPECTED_COMMIT);
    assert(prior.results.some(row=>row.name==='seeded_partial_import_remains_unpublished'&&row.passed),'prior_pending_fixture_required');
    const priorPrefix=`CLOSEOUT ${config.runId.slice(0,8)} ${prior.executionId.slice(0,8)}`;
    const heldFile=check(await own.client.from('file_uploads').select('id,workspace_id,display_name').eq('workspace_id',a).eq('display_name',`${priorPrefix} partial attempt`).single(),'exact_prior_held_source');
    const heldImport=check(await own.client.from('file_imports').select('id,recovery_status').eq('workspace_id',a).eq('file_upload_id',heldFile.id).single(),'exact_prior_held_import');
    assert.equal(heldImport.recovery_status,'running');
    const heldChunks=check(await own.client.from('business_memory_chunks').select('id,source_metadata').eq('workspace_id',a).eq('source_file_id',heldFile.id),'prior_held_chunks');
    assert.equal(heldChunks.length,1);assert.equal(heldChunks[0].source_metadata.import_id,heldImport.id);
    async function inventory() {
      const params=[a,heldFile.id,heldImport.id];
      const receipt=(await db.query('select id,workspace_id,file_id,import_id,status,preparation_key,actor_id,prior_imported_at,approved_mapping,approved_row_ids,accepted_at,completed_at from private.file_import_attempts where workspace_id=$1 and file_id=$2 and import_id=$3 order by id',params)).rows;
      const chunks=(await db.query("select id,content_hash,source_type,source_id,source_file_id,source_metadata,md5(to_jsonb(c)::text) as entire_row_hash from public.business_memory_chunks c where workspace_id=$1 and source_file_id=$2 order by id",params.slice(0,2))).rows;
      const rows=(await db.query('select id,status,data_json,mapped_data_json,validation_errors_json from public.file_import_rows where workspace_id=$1 and file_upload_id=$2 and import_id=$3 order by id',params)).rows;
      const imports=(await db.query('select id,status,recovery_status,rows_total,rows_imported,mapping_json,imported_at from public.file_imports where workspace_id=$1 and file_upload_id=$2 order by id',params.slice(0,2))).rows;
      const counts=(await db.query(`select
        (select count(*) from public.file_imports where workspace_id=$1) imports,
        (select count(*) from public.file_import_rows where workspace_id=$1) import_rows,
        (select count(*) from public.kpis where workspace_id=$1) kpis,
        (select count(*) from public.operational_metrics where workspace_id=$1) metrics,
        (select count(*) from public.business_memory_chunks where workspace_id=$1) chunks`,[a])).rows[0];
      return {receipt,chunks,rows,imports,counts};
    }
    const before=await inventory();assert.equal(before.receipt.length,1);assert.equal(before.receipt[0].status,'running');assert.equal(before.receipt[0].completed_at,null);assert.equal(before.chunks.length,1);assert.equal(before.rows.length,1);assert.equal(before.rows[0].status,'staged');
    const held=await context(owner,390);await held.page.goto(`${appOrigin}/app/sources/${heldFile.id}?section=imported`);
    const recovery=held.page.locator('form').filter({has:held.page.getByRole('button',{name:'Check saved results',exact:true})});
    assert.equal(await recovery.locator('[name="import_id"]').inputValue(),heldImport.id);assert.equal(await recovery.locator('[name="file_id"]').inputValue(),heldFile.id);
    let actionPosts=0;held.page.on('request',request=>{if(request.method()==='POST'&&request.headers()['next-action']&&new URL(request.url()).origin===appOrigin)actionPosts+=1;});
    const expectedError='0 KPI records, 0 metric records and 1 stored evidence chunks are currently saved; only a completed publication is used as current worksheet evidence. Accepted work remains held for operator reconciliation. A still-running or partial attempt cannot be retried automatically.';
    stage='browser_check_saved_results';
    await submitAndObserve(held.page,recovery.getByRole('button',{name:'Check saved results',exact:true}),'check_saved_results_existing_held_import',url=>url.pathname===`/app/sources/${heldFile.id}`&&url.searchParams.get('section')==='imported'&&url.searchParams.get('error')===expectedError);
    assert.equal(actionPosts,1,'recovery_must_issue_one_action_without_resubmission');
    assert.equal(actionResponses.at(-1).status,303);
    assert.equal(checkedActionRedirect(actionResponses.at(-1).xActionRedirect,appOrigin,url=>url.pathname===`/app/sources/${heldFile.id}`&&url.searchParams.get('section')==='imported').searchParams.get('error'),expectedError);
    assert.equal(new URL(held.page.url()).searchParams.get('error'),expectedError);
    await held.page.getByText('Import results need reconciliation',{exact:true}).waitFor({state:'visible'});
    assert(await held.page.getByRole('button',{name:'Check saved results',exact:true}).isVisible());
    assert.equal(await held.page.getByRole('button',{name:/^(Prepare workbook import|Re-prepare workbook|Import \d+ approved worksheet)/}).count(),0);
    await held.page.screenshot({path:path.join(output,'check-saved-results-held-390.png'),fullPage:false});
    const after=await inventory();fs.writeFileSync(path.join(output,'held-inventory.json'),JSON.stringify({before,after},null,2)+'\n');assert.deepEqual(after,before,'recovery_check_must_preserve_pending_and_workspace_inventory');
    const heads=check(await own.client.rpc('get_worksheet_publication_heads_v1',{p_workspace_id:a,p_file_ids:[heldFile.id]}),'held_after_check_head');assert.equal(heads.length,1);assert.equal(heads[0].completed_attempt_id,null);
    await held.c.close();
    result('browser_check_saved_results_preserves_hold',{width:390,actionPosts,pendingChunkPersisted:true,pendingChunkUnchanged:true,receiptStatus:after.receipt[0].status,receiptCompletedAt:after.receipt[0].completed_at,inventoryUnchanged:true,workspaceCounts:after.counts,publicationHead:null,expectedErrorRedirect:true,fixture:'Existing tail1 synthetic pending source; no new imports, records, uploads, or admission calls'});
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
