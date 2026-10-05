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
const [configFile, output] = process.argv.slice(2);
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
const results = [], requests = [], browserErrors = [];
const result = (name, data = {}) => { results.push({ name, passed: true, ...data }); console.log(JSON.stringify({ check: name, passed: true })); };
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
      await dialog.getByRole('button',{name:'Save submission',exact:true}).click();
      await page.waitForURL(u=>u.searchParams.has('message'));
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
      const dialog=await fillSubmission(page,formId,label);await dialog.getByRole('button',{name:'Save submission',exact:true}).click();
      await page.waitForURL(u=>u.searchParams.has('message'));
      await waitFor(async()=>check(await client.from('form_submissions').select('id').eq('submitter_name',label),'operator_form').length===1,'operator_form_persist');result('browser_operator_form_persistence',{role:actor.role});await c.close();
    }
    stage='browser_memory_confirmation';
    const memory=await context(owner,390);await memory.page.goto(`${appOrigin}/app/sources/${memoryFile}`);
    assert.equal(check(await memory.client.from('business_memory_chunks').select('id').eq('source_file_id',memoryFile),'memory_before').length,0);
    await memory.page.getByRole('button',{name:'Approve learning',exact:true}).click();
    await memory.page.waitForURL(u=>u.searchParams.has('message'));
    const published=await waitFor(async()=>{const rows=check(await memory.client.from('business_memory_chunks').select('id,source_excerpt,source_metadata').eq('source_file_id',memoryFile).is('archived_at',null),'memory_after');return rows.length?rows:null;},'confirmed_memory_persist');
    assert(published.every(x=>x.source_excerpt.includes('Revenue amount October 100')&&x.source_metadata.source_run_id===memoryRun));
    const approved=check(await memory.client.from('file_uploads').select('metadata_json,index_status,indexed_chunk_count').eq('id',memoryFile).single(),'memory_receipt');assert.equal(approved.index_status,'ready');assert.equal(approved.indexed_chunk_count,published.length);assert.equal(approved.metadata_json.analysis_review_status,'approved');
    await memory.page.reload();await waitFor(async()=>(await memory.page.locator('body').innerText()).includes('Available to Intelligence and Learned Knowledge.'),'memory_ui_learned');
    result('browser_confirmed_memory_atomic_publication',{width:390,chunks:published.length,model:'synthetic completed-run fixture, no model call',embeddings:'actual no-key text-only fallback with real pgvector column'});await memory.c.close();
    stage='denied_permissions';
    const view = await context(viewer,390); const deniedLabel=`${prefix} viewer denied`;const deniedForm=await fillSubmission(view.page,formId,deniedLabel);await deniedForm.getByRole('button',{name:'Save submission',exact:true}).click();
    await view.page.waitForURL(u=>u.searchParams.has('error'));assert.equal(check(await admin.from('form_submissions').select('id').eq('submitter_name',deniedLabel),'denied_read').length,0);result('browser_viewer_action_denied');await view.c.close();
    const s = await context(staff,390);await s.page.goto(appOrigin+'/app/assets');await s.page.locator('summary').filter({hasText:'New Check'}).click();const d=s.page.locator('form').filter({has:s.page.locator('[name="asset_id"]')});await d.locator('[name="asset_id"]').selectOption(assetId);await d.locator('[name="status"]').selectOption('Out of service');await d.locator('[name="notes"]').fill(`${prefix} current check`);await d.getByRole('button',{name:'Save check',exact:true}).click();
    await s.page.waitForURL(u=>u.searchParams.has('message'));
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
    stage='browser_upload';const upload=await context(owner,390);await upload.page.goto(appOrigin+'/app/sources');await upload.page.getByRole('button',{name:'Upload file',exact:true}).click();const input=upload.page.locator('input[type="file"]');
    await input.setInputFiles({name:`closeout-${config.runId.slice(0,8)}.csv`,mimeType:'text/csv',buffer:Buffer.from('date,revenue\n2026-01-01,42\n2026-02-01,43\n')});await upload.page.locator('[name="display_name"]').fill(`${prefix} uploaded source`);await upload.page.getByRole('button',{name:'Upload and prepare review',exact:true}).click();
    const saved=await waitFor(async()=>{const rows=check(await admin.from('file_uploads').select('id,storage_bucket,storage_path').eq('workspace_id',a).eq('display_name',`${prefix} uploaded source`),'upload_read');return rows.length===1?rows[0]:null;},'browser_upload_persist',60000);
    check(await own.client.storage.from(saved.storage_bucket).download(saved.storage_path),'browser_upload_object');result('browser_upload_real_storage_and_source_record',{width:390});
    stage='browser_import_approval';await upload.page.waitForURL(u=>u.pathname===`/app/sources/${saved.id}`&&u.searchParams.get('section')==='imported',{timeout:60000});
    await waitFor(async()=>check(await own.client.from('file_import_rows').select('id').eq('file_upload_id',saved.id),'staged_upload_rows').length===2,'upload_prepared_rows');await upload.page.goto(`${appOrigin}/app/sources/${saved.id}?section=imported`);
    const importForm=upload.page.locator('form').filter({has:upload.page.locator('[name="workbook_mode"]')});
    await importForm.locator('[name="worksheet_1_enabled"]').check();await importForm.locator('[name="worksheet_1_type"]').selectOption('wide_time_series');await importForm.locator('[name="worksheet_1_map_period"]').selectOption('date');
    const importId=await importForm.locator('[name="import_id"]').inputValue();
    assert.equal(check(await own.client.from('kpis').select('id').eq('source_file_id',saved.id),'unapproved_no_kpis').length,0);
    await importForm.getByRole('button',{name:'Import 1 approved worksheet',exact:true}).click();
    const completed=await waitFor(async()=>{const r=check(await own.client.from('file_imports').select('status,recovery_status,rows_imported').eq('id',importId).single(),'import_persist');if(r.status==='failed')throw Error('import_reported_failure');return r.recovery_status==='completed'?r:null;},'import_completed',60000);assert.equal(completed.status,'completed');assert.equal(completed.rows_imported,2);
    const kpis=check(await own.client.from('kpis').select('id,actual_value,metric_date,source_file_id,import_id,raw_data_json').eq('import_id',importId),'import_kpis');assert.equal(kpis.length,2);assert.deepEqual(kpis.map(x=>Number(x.actual_value)).sort(),[42,43]);assert(kpis.every(x=>x.source_file_id===saved.id&&x.import_id===importId));
    const reconciled=check(await own.client.rpc('reconcile_file_import_attempt_v1',{p_workspace_id:a,p_file_id:saved.id,p_import_id:importId,p_failed:false}),'real_import_reconciliation');assert.equal(reconciled.status,'completed');assert.equal(reconciled.kpi_records,2);assert.equal(reconciled.requires_operator_review,false);
    const receipt=(await db.query('select approved_mapping,approved_row_ids from private.file_import_attempts where workspace_id=$1 and import_id=$2',[a,importId])).rows;assert.equal(receipt.length,1);
    const replay=check(await own.client.rpc('begin_file_import_attempt_v1',{p_workspace_id:a,p_file_id:saved.id,p_import_id:importId,p_approved_mapping:receipt[0].approved_mapping,p_row_ids:receipt[0].approved_row_ids}),'real_import_replay');assert.equal(replay.admitted,false);assert.equal(replay.status,'completed');assert.equal(check(await own.client.from('kpis').select('id').eq('import_id',importId),'import_replay_count').length,2);
    await upload.page.reload();assert((await upload.page.locator('body').innerText()).includes('2'));result('browser_import_confirmed_once_with_real_reconciliation',{width:390,kpiRecords:2,approvedRows:2,replayAdmitted:false});await upload.c.close();
    assert.equal(browserErrors.length,0,'unexpected_browser_error');
    result('closeout_complete',{capacityTargetsExecuted:false,providerCalls:0});
  } catch(error) { if(browser)for(const c of browser.contexts())for(const page of c.pages()){fs.writeFileSync(path.join(output,'failure-ui.txt'),sanitize(await page.locator('body').innerText().catch(()=>'')));await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});} results.push({name:stage,passed:false,error:sanitize(error.message)});console.error(JSON.stringify({stage,error:sanitize(error.message)}));process.exitCode=1; }
  finally {
    if(browser)await browser.close();if(app){app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),sleep(5000)]);if(app.exitCode===null)app.kill('SIGKILL');}await db.end().catch(()=>{});
    sourceEnd=sourceManifest();if(sourceBuilt&&JSON.stringify(sourceEnd)!==JSON.stringify(sourceBuilt)){results.push({name:'source_stability',passed:false});process.exitCode=1;}
    fs.writeFileSync(path.join(output,'source-manifest.json'),JSON.stringify({start:sourceStart,built:sourceBuilt,end:sourceEnd},null,2)+'\n');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({runId:config.runId,executionId,sourceCommit:sourceBuilt?.head||sourceEnd.head,results,requests,browserErrors,limitations:['Supabase native service versions differ from deployed PostgreSQL17.6','Synthetic legal acceptance seeded','No paid provider or customer connections','No full-system capacity target or worker soak performed']},null,2)+'\n');
    fs.writeFileSync(path.join(output,'build.log'),buildLog);fs.writeFileSync(path.join(output,'app.log'),sanitize(appLog));
  }
})();
