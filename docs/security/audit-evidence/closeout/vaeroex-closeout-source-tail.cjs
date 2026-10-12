/* Prepared targeted driver: no execution/build was performed during preparation. */
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
const prefix = `CLOSEOUT ${config.runId.slice(0, 8)} ${executionId.slice(0,8)}`;
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
    const published=check(await own.client.from('business_memory_chunks').select('id').eq('workspace_id',a).eq('source_type','file_analysis').is('archived_at',null).is('deleted_at',null).order('indexed_at',{ascending:false}).limit(1),'existing_confirmed_memory_control');
    assert.equal(published.length,1,'existing_confirmed_memory_required');
    result('targeted_source_tail_setup',{reusedSyntheticWorkspace:a,priorFormsAndStorageTestsRepeated:false,buildPerformed:false,expectedBuildId:process.env.VXT_EXPECTED_BUILD_ID,expectedAppOrigin:appOrigin});
    stage='browser_upload';const upload=await context(owner,390);await upload.page.goto(appOrigin+'/app/sources');await upload.page.locator('#workspace-file-upload > summary').click();const input=upload.page.locator('input[type="file"]');
    await input.setInputFiles({name:`closeout-${config.runId.slice(0,8)}-${executionId.slice(0,8)}.csv`,mimeType:'text/csv',buffer:Buffer.from('date,revenue\n2026-01-01,42\n2026-02-01,43\n')});await upload.page.locator('[name="display_name"]').fill(`${prefix} uploaded source`);await submitAndObserve(upload.page, upload.page.getByRole('button',{name:'Upload and prepare review',exact:true}), 'source_upload_prepare', u=>/^\/app\/sources\/[0-9a-f-]{36}$/.test(u.pathname)&&u.searchParams.get('section')==='imported');
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
    stage='held_import_beyond_history_window';
    const historyFile=randomUUID(), oldImport=randomUUID(), oldRow=randomUUID();
    const historyBytes=Buffer.from('date,revenue\n2026-04-01,11\n'),historyPath=`${a}/${historyFile}/held-history.csv`;
    check(await own.client.storage.from('workspace-files').upload(historyPath,historyBytes,{contentType:'text/csv'}),'history_storage');
    check(await own.client.from('file_uploads').insert({id:historyFile,workspace_id:a,created_by:owner.id,original_name:'held-history.csv',display_name:`${prefix} held history boundary`,file_extension:'csv',mime_type:'text/csv',file_size_bytes:historyBytes.length,storage_bucket:'workspace-files',storage_path:historyPath,processing_status:'ready',import_status:'extracted'}),'history_source');
    const oldMapping={...heldMapping,preparation_id:randomUUID()};
    check(await own.client.from('file_imports').insert({id:oldImport,workspace_id:a,file_upload_id:historyFile,created_by:owner.id,import_type:'metrics',status:'needs_review',rows_total:1,rows_imported:0,mapping_json:oldMapping,created_at:'2023-01-01T00:00:00.000Z'}),'history_old_import');
    check(await own.client.from('file_import_rows').insert({id:oldRow,workspace_id:a,file_upload_id:historyFile,import_id:oldImport,import_type:'metrics',row_number:1,data_json:{date:'2026-04-01',revenue:11},mapped_data_json:{__source:{worksheet:'CSV',worksheet_index:1,row_number:2}},validation_errors_json:[],status:'staged'}),'history_old_row');
    // Prepare every historical header before admission: the real freeze trigger
    // must prevent preparation after a receipt has accepted work.
    const historicalHeaders=Array.from({length:301},(_,index)=>({id:randomUUID(),workspace_id:a,file_upload_id:historyFile,created_by:owner.id,import_type:'metrics',status:'failed',rows_total:index+1,rows_imported:0,mapping_json:{mode:'workbook',preparation_id:randomUUID(),worksheets:[]},extraction_summary:`Synthetic historical header ${index+1}; no successful worker execution claimed.`,created_at:new Date(Date.UTC(2024,0,1,0,0,index+1)).toISOString()}));
    for(let offset=0;offset<historicalHeaders.length;offset+=100)check(await own.client.from('file_imports').insert(historicalHeaders.slice(offset,offset+100)),'history_headers_before_claim');
    const historyBefore=check(await own.client.from('file_imports').select('id,status,rows_total,rows_imported,extraction_summary').eq('file_upload_id',historyFile).order('created_at',{ascending:false}).limit(300),'history_window_before');
    assert.equal(historyBefore.length,300);assert(!historyBefore.some(row=>row.id===oldImport));assert.equal(historyBefore[0].id,historicalHeaders[300].id);
    const oldReceipt=check(await own.client.rpc('begin_file_import_attempt_v1',{p_workspace_id:a,p_file_id:historyFile,p_import_id:oldImport,p_approved_mapping:oldMapping,p_row_ids:[oldRow]}),'history_claim_old_import');assert.equal(oldReceipt.admitted,true);
    const historyAfter=check(await own.client.from('file_imports').select('id,status,rows_total,rows_imported,extraction_summary').eq('file_upload_id',historyFile).order('created_at',{ascending:false}).limit(300),'history_window_after');assert.deepEqual(historyAfter,historyBefore);
    const oldHeld=check(await own.client.from('file_imports').select('id,recovery_status').eq('id',oldImport).single(),'history_old_held');assert.equal(oldHeld.recovery_status,'running');
    const edge=await context(owner,390);await edge.page.goto(`${appOrigin}/app/sources/${historyFile}`);
    await edge.page.getByText('Import held',{exact:true}).first().waitFor({state:'visible'});
    await edge.page.getByText('This import is not yet published. Any previously completed worksheet evidence remains available while its saved results are reconciled.',{exact:true}).waitFor({state:'visible'});
    await edge.page.goto(`${appOrigin}/app/sources/${historyFile}?section=imported`);
    const recoverForm=edge.page.locator('form').filter({has:edge.page.getByRole('button',{name:'Check saved results',exact:true})});
    assert.equal(await recoverForm.locator('[name="import_id"]').inputValue(),oldImport);
    assert.equal(await edge.page.getByRole('button',{name:/^(Prepare workbook import|Re-prepare workbook|Import \d+ approved worksheet)/}).count(),0);
    await edge.page.screenshot({path:path.join(output,'held-history-recovery-390.png'),fullPage:false});
    await edge.page.goto(`${appOrigin}/app/sources/${historyFile}?section=history`);
    await edge.page.locator('summary').filter({hasText:'View details, analysis, imports, KPIs, and intelligence links'}).click();
    const historySection=edge.page.locator('section').filter({has:edge.page.getByText('Imports created',{exact:true})});
    const historyLines=await historySection.locator('p.text-sm').allTextContents();
    assert.deepEqual(historyLines.map(text=>text.trim()),[301,300,299,298].map(rows=>`METRICS · failed · 0/${rows} rows`));
    await edge.page.screenshot({path:path.join(output,'held-history-preserved-390.png'),fullPage:false});await edge.c.close();
    assert.deepEqual(check(await own.client.from('file_imports').select('id,status,rows_total,rows_imported,extraction_summary').eq('file_upload_id',historyFile).order('created_at',{ascending:false}).limit(300),'history_final_inventory'),historyBefore);
    result('mobile_held_import_beyond_300_history_headers',{width:390,fixture:'Old staged import plus301newer synthetic historical headers seeded before authenticated admission; no successful historical workers claimed',historicalHeaders:301,visibleHistoryRows:300,heldReceiptVisibleInHistoryWindow:false,recoveryTargetsActualOldImport:true,historicalOrderAndValuesUnchanged:true});
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
