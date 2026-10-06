/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated browser qualification; credentials never enter evidence. */
// Run beneath the capacity runtime's OS network sandbox. This harness owns only
// new synthetic issues and the passwords of existing inactive synthetic test users.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const { chromium } = require('playwright');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
const [runtimeFile, expectedCommit] = process.argv.slice(2);
assert(runtimeFile && /^[a-f0-9]{40}$/.test(expectedCommit), 'runtime_and_full_application_commit_required');
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const privateJson = f => { assert.equal(fs.statSync(f).mode & 0o077, 0, 'private_configuration_required'); return json(f); };
const cfg = privateJson(runtimeFile), config = privateJson(cfg.configFile), plan = privateJson(cfg.planFile);
const sessions = privateJson(path.join(cfg.out, 'sessions.private.json'));
const initialProcesses = privateJson(path.join(cfg.out, 'processes.json'));
assert.equal(initialProcesses.sourceCommit, expectedCommit, 'wrong_application_commit');
assert.equal(initialProcesses.buildMode, 'production');
assert.equal(initialProcesses.runId, cfg.runId); assert.equal(initialProcesses.instanceNonce, cfg.instanceNonce);
assert.equal(plan.runId, cfg.runId); assert.equal(sessions.runId, cfg.runId);
assert.equal(config.mode, 'disposable-native-local'); assert.equal(cfg.syntheticOnly, true);
assert.equal(cfg.paidCredentialsPresent, false);
function local(url) { const u = new URL(url); assert(['127.0.0.1','[::1]'].includes(u.hostname), 'literal_loopback_required'); return u; }
const apiOrigin = local(config.apiUrl).origin; local(config.dbUrl); local(cfg.appOrigin);
assert.equal(process.env.NODE_EXTRA_CA_CERTS, cfg.cert, 'local_tls_certificate_required');
assert(!fs.existsSync(path.join(root, 'supabase/.temp/project-ref')), 'linked_checkout_forbidden');
// sandbox-exec replaces itself, so require a kernel-enforced negative network
// control instead of treating a command-line marker as proof of confinement.
const executionId = randomUUID();
const output = path.join(cfg.out, 'issue-browser', executionId);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const sha = value => createHash('sha256').update(value).digest('hex');
const secrets = [config.anonKey, config.serviceKey, config.dbUrl];
const redact = value => { let text = String(value); for (const v of secrets) if (v) text = text.split(v).join('[local-secret]'); return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local-token]'); };
const safeFetch = (input, init = {}) => { const u = local(typeof input === 'string' || input instanceof URL ? input : input.url); assert.equal(u.origin, apiOrigin); return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) }); };
const admin = createClient(config.apiUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } });
const check = (v, label) => { assert(!v.error, label + ':' + (v.error?.code || v.error?.status || 'request_failed')); return v.data; };
const db = new Client({ connectionString: config.dbUrl, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 30000, query_timeout: 30000 });
const results = [], captures = [], errors = [], requests = [], foreignRequests = [];
let browser, stage = 'setup', baseline, memberships, activePasswords, priorNegative, priorRows;
const startedAt = new Date().toISOString();
const fieldValues = title => ({ title, issue_type: 'Synthetic capacity qualification', description: 'Synthetic browser-to-PostgREST issue. No customer information.', severity: 'High', status: 'Investigating', root_cause: 'Synthetic repeated submission', recommended_fix: 'Verify one durable issue and an automatic completion transition.' });
async function guardRuntime() {
  const now = privateJson(path.join(cfg.out, 'processes.json'));
  assert.equal(now.sourceCommit, expectedCommit); assert.equal(now.buildId, initialProcesses.buildId); assert.equal(now.instanceNonce, initialProcesses.instanceNonce);
  for (const name of ['app','worker','provider']) { assert.equal(now[name].pid, initialProcesses[name].pid, 'runtime_restarted_during_check'); process.kill(now[name].pid, 0); }
}
async function preserved() {
  const rows = (await db.query('select id,md5(to_jsonb(i)::text) hash from public.issues i where workspace_id=any($1::uuid[]) order by id', [plan.workspaces.map(w => w.id)])).rows;
  const byId = new Map(rows.map(r => [r.id, r.hash]));
  for (const row of baseline) assert.equal(byId.get(row.id), row.hash, 'existing_issue_mutated');
  assert.deepEqual((await db.query('select workspace_id,user_id,role,status from public.workspace_members where user_id=any($1::uuid[]) order by workspace_id,user_id', [plan.actors.map(a => a.id)])).rows, memberships, 'memberships_changed');
  assert.deepEqual((await db.query('select id,encrypted_password from auth.users where id=any($1::uuid[]) order by id', [plan.actors.filter(a => a.active).map(a => a.id)])).rows, activePasswords, 'active_passwords_changed');
  const ids = priorNegative.rows.map(r => r.id);
  assert.deepEqual((await db.query('select id,md5(to_jsonb(i)::text) hash from public.issues i where id=any($1::uuid[]) order by id', [ids])).rows, priorRows, 'prior_negative_rows_changed');
}
async function denyNetwork() {
  const net = require('node:net');
  const result = await new Promise(resolve => { const s = net.connect({ host: '192.0.2.1', port: 9 }); s.on('connect', () => { s.destroy(); resolve('connected'); }); s.on('error', e => resolve(e.code)); s.setTimeout(2000, () => { s.destroy(); resolve('timeout'); }); });
  assert.equal(result, 'EPERM', 'os_egress_denial_not_proven');
  return result;
}
async function inactiveSession(actor) {
  assert.equal(actor.active, false); assert(['staff','viewer'].includes(actor.role));
  const user = check(await admin.auth.admin.getUserById(actor.id), 'read_inactive_synthetic_user').user;
  assert.equal(user.email, actor.email); assert(user.email.endsWith('@example.invalid'));
  assert.equal(user.app_metadata.audit_run_id, plan.runId); assert.equal(user.app_metadata.synthetic, true);
  const password = randomBytes(32).toString('base64url'); secrets.push(password);
  check(await admin.auth.admin.updateUserById(actor.id, { password }), 'inactive_synthetic_password_only');
  const jar = new Map();
  const client = createServerClient(config.apiUrl, config.anonKey, { global: { fetch: safeFetch }, auth: { autoRefreshToken: false }, cookies: { getAll: () => [...jar].map(([name,value]) => ({name,value})), setAll: values => values.forEach(v => jar.set(v.name,v.value)) } });
  const login = check(await client.auth.signInWithPassword({ email: actor.email, password }), 'inactive_actual_auth_login');
  assert.equal(login.user.id, actor.id); secrets.push(login.session.access_token, login.session.refresh_token);
  jar.set('vaeroex_workspace_id', actor.workspaceId);
  const own = { cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), accessToken: login.session.access_token, refreshToken: login.session.refresh_token, expiresAt: new Date(login.session.expires_at*1000).toISOString() };
  sessions.actors[actor.id] = own;
  write('inactive-sessions.private.json', { runId: cfg.runId, actors: Object.fromEntries(plan.actors.filter(a => !a.active && sessions.actors[a.id]).map(a => [a.id, sessions.actors[a.id]])) });
}
async function open(actor, width) {
  await guardRuntime(); assert(sessions.actors[actor.id], 'actor_session_required');
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: {width,height:900}, serviceWorkers: 'block' });
  await context.addCookies(sessions.actors[actor.id].cookie.split(';').map(s => { const i=s.indexOf('='); return { name:s.slice(0,i).trim(), value:s.slice(i+1).trim(), url:cfg.appOrigin, sameSite:'Lax' }; }));
  await context.route('**/*', route => { const u = new URL(route.request().url()); if ([cfg.appOrigin,apiOrigin].includes(u.origin)) return route.continue(); foreignRequests.push({origin:u.origin, method:route.request().method()}); return route.abort('blockedbyclient'); });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push({stage,message:redact(error.message)}));
  page.on('response', r => { if (new URL(r.url()).origin===cfg.appOrigin && r.request().method()==='POST') requests.push({stage,path:new URL(r.url()).pathname,status:r.status()}); });
  await page.goto(cfg.appOrigin+'/app/issues', {waitUntil:'domcontentloaded'});
  assert.equal(new URL(page.url()).pathname,'/app/issues','authenticated_workspace_required');
  return {context,page};
}
async function form(page, values, requestId) {
  if (new URL(page.url()).search) await page.goto(cfg.appOrigin+'/app/issues', {waitUntil:'domcontentloaded'});
  await page.getByText('New Issue',{exact:true}).click();
  const f=page.locator('form').filter({has:page.locator('[name=issue_request_id]')});
  for (const [name,value] of Object.entries(values)) { const input=f.locator(`[name=${name}]`); if (['severity','status'].includes(name)) await input.selectOption(value); else await input.fill(value); }
  if (requestId) await f.locator('[name=issue_request_id]').evaluate((e,value)=>{e.value=value;},requestId);
  const id=await f.locator('[name=issue_request_id]').inputValue(); assert(/^[a-f0-9-]{36}$/.test(id));
  return {f,id};
}
async function submit(page, f, expected, label) {
  const initial=page.url(), before=requests.length, start=Date.now();
  const post=page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).origin===cfg.appOrigin&&!!r.headers()['next-action'],{timeout:20000});
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&!!r.request().headers()['next-action']&&new URL(r.url()).origin===cfg.appOrigin,{timeout:20000});
  const navigation=page.waitForURL(u=>u.href!==initial&&u.pathname==='/app/issues'&&(u.searchParams.get('message')||u.searchParams.get('error'))===expected,{timeout:20000});
  await f.getByRole('button',{name:'Log issue',exact:true}).dblclick({delay:20});
  const req=await post; await navigation; const r=await response; assert.equal(r.status(),303);
  if (/do not have permission/.test(expected)) {
    await page.getByRole('alert').filter({hasText:'Action Blocked'}).last().waitFor();
    await page.getByRole('alert').filter({hasText:'No changes were made.'}).last().waitFor();
    await page.getByRole('button',{name:'Return to workspace',exact:true}).waitFor();
  } else {
    await page.getByRole('status').filter({hasText:expected}).waitFor();
    // Feedback may stream before the destination page. Completion requires the
    // actual Issues page and its creation control to render automatically.
    await page.getByRole('heading',{name:'Risks & Issues',exact:true}).waitFor();
    await page.getByText('New Issue',{exact:true}).waitFor();
  }
  await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'),undefined,{timeout:20000});
  assert.equal(requests.length-before,1,'rapid_click_duplicated_post');
  const body=req.postDataBuffer(); assert(body && body.length<262144,'bounded_native_action_body');
  const headers=Object.fromEntries(Object.entries(req.headers()).filter(([name])=>['next-action','next-router-state-tree','accept','content-type'].includes(name)));
  const capture={label,headers,bodyBase64:body.toString('base64'),sha256:sha(body)};
  captures.push(capture); write('captured-requests.private.json',captures);
  const record={label,automatic:true,pendingCleared:true,feedbackVisible:true,destinationRendered:true,rapidClickPosts:requests.length-before,status:r.status(),elapsedMs:Date.now()-start,feedback:expected,destination:new URL(page.url()).pathname+new URL(page.url()).search,requestBodySha256:capture.sha256};
  results.push(record); console.log(JSON.stringify({passed:true,label,elapsedMs:record.elapsedMs}));
  return capture;
}
async function rows(actor,title) { return (await db.query('select id,workspace_id,title,description,issue_type,severity,status,root_cause,recommended_fix,assigned_person_id,assigned_role,assigned_department,due_date,created_by from public.issues where workspace_id=$1 and title=$2 order by id',[actor.workspaceId,title])).rows; }
async function receipt(actor,id) { return (await db.query('select workspace_id,actor_id,request_id,issue_id,encode(payload_hash,\'hex\') payload_hash from private.issue_submission_receipts where workspace_id=$1 and actor_id=$2 and request_id=$3',[actor.workspaceId,actor.id,id])).rows; }
async function exactReplay(context,capture,label) {
  const cookies=(await context.cookies(cfg.appOrigin)).map(c=>`${c.name}=${c.value}`).join('; ');
  const body=Buffer.from(capture.bodyBase64,'base64');
  const response=await fetch(cfg.appOrigin+'/app/issues',{method:'POST',redirect:'manual',headers:{...capture.headers,cookie:cookies,origin:cfg.appOrigin},body,signal:AbortSignal.timeout(20000)});
  await response.arrayBuffer(); assert.equal(response.status,303);
  const location=response.headers.get('x-action-redirect')||response.headers.get('location'); assert(location,'replay_redirect_required');
  const u=new URL(location.split(';')[0],cfg.appOrigin); assert.equal(u.origin,cfg.appOrigin);
  assert.equal(u.searchParams.get('message'),'Issue already logged. No duplicate was created.');
  results.push({label,identicalCapturedRequest:true,requestBodySha256:sha(body),status:response.status,feedback:u.searchParams.get('message')});
}
(async()=>{
  try {
    assert.equal(await denyNetwork(),'EPERM');
    await db.connect();
    const identity=(await db.query("select current_database() db,current_setting('data_directory') directory")).rows[0];
    assert.equal(identity.db,'postgres'); assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+'/stacks/'));
    await guardRuntime();
    baseline=(await db.query('select id,md5(to_jsonb(i)::text) hash from public.issues i where workspace_id=any($1::uuid[]) order by id',[plan.workspaces.map(w=>w.id)])).rows;
    memberships=(await db.query('select workspace_id,user_id,role,status from public.workspace_members where user_id=any($1::uuid[]) order by workspace_id,user_id',[plan.actors.map(a=>a.id)])).rows;
    activePasswords=(await db.query('select id,encrypted_password from auth.users where id=any($1::uuid[]) order by id',[plan.actors.filter(a=>a.active).map(a=>a.id)])).rows;
    priorNegative=privateJson(path.join(cfg.out,'issue-before.json')); assert.equal(priorNegative.duplicateCount,2);
    priorRows=(await db.query('select id,md5(to_jsonb(i)::text) hash from public.issues i where id=any($1::uuid[]) order by id',[priorNegative.rows.map(r=>r.id)])).rows; assert.equal(priorRows.length,2);
    const deniedActors=['staff','viewer'].map(role=>plan.actors.find(a=>!a.active&&a.role===role));
    for (const a of deniedActors) await inactiveSession(a);
    browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
    const allowed=plan.actors.filter(a=>a.active&&['owner','manager'].includes(a.role));
    for (const width of [1440,390]) for (let iteration=0;iteration<3;iteration++) {
      const actor=allowed[[0,1,5][iteration]],label=`issue_${width}_${iteration}`,title=`SYNTHETIC ${executionId} ${width} ${iteration}`;
      stage=label;
      const {context,page}=await open(actor,width);
      try {
        const values=fieldValues(title); let {f,id}=await form(page,values);
        const capture=await submit(page,f,'Issue logged.',label+'_create');
        const saved=await rows(actor,title); assert.equal(saved.length,1); assert.equal(saved[0].created_by,actor.id); assert.equal(saved[0].workspace_id,actor.workspaceId);
        for (const [key,value] of Object.entries(values)) assert.equal(saved[0][key],value,'saved_payload_mismatch');
        for (const key of ['assigned_person_id','assigned_role','assigned_department','due_date']) assert.equal(saved[0][key],null);
        const receipts=await receipt(actor,id); assert.equal(receipts.length,1); assert.equal(receipts[0].issue_id,saved[0].id);
        await page.getByText(title,{exact:true}).first().waitFor();
        await exactReplay(context,capture,label+'_identical_http_replay');
        assert.deepEqual(await rows(actor,title),saved); assert.deepEqual(await receipt(actor,id),receipts);
        ({f}=await form(page,values,id)); await submit(page,f,'Issue already logged. No duplicate was created.',label+'_browser_replay');
        assert.deepEqual(await rows(actor,title),saved); assert.deepEqual(await receipt(actor,id),receipts);
        ({f}=await form(page,{...values,description:'Synthetic changed request must be denied.'},id));
        await submit(page,f,'This request was already used for different issue details. Start a new issue.',label+'_conflict');
        assert.deepEqual(await rows(actor,title),saved); assert.deepEqual(await receipt(actor,id),receipts);
        if (iteration===0) await page.screenshot({path:path.join(output,`issue-conflict-${width}.png`),fullPage:true});
        results.push({label:label+'_persisted',issueId:saved[0].id,workspaceId:actor.workspaceId,actorRole:actor.role,requestId:id,issueRows:1,receipts:1,unchangedAfterReplaysAndConflict:true});
      } finally { await context.close(); }
      for (const denied of deniedActors) {
        stage=`${label}_${denied.role}_denied`;
        const {context,page}=await open(denied,width);
        try {
          const deniedTitle=title+' '+denied.role, {f,id}=await form(page,fieldValues(deniedTitle));
          await submit(page,f,'You do not have permission to log an issue.',stage);
          assert.equal((await rows(denied,deniedTitle)).length,0); assert.equal((await receipt(denied,id)).length,0);
          results.push({label:stage+'_persisted',issueRows:0,receipts:0,role:denied.role});
          if (iteration===0) await page.screenshot({path:path.join(output,`issue-${denied.role}-denied-${width}.png`),fullPage:true});
        } finally { await context.close(); }
      }
      await preserved();
    }
    assert.equal(errors.length,0,'browser_runtime_errors'); assert.equal(foreignRequests.length,0,'unexpected_external_browser_requests');
    await preserved(); await guardRuntime();
    results.push({label:'focused_complete',widths:[1440,390],repetitionsPerWidth:3,createdIssues:6,exactHttpReplays:6,browserReplays:6,conflicts:6,roleDenials:12,priorNegativeRowsPreserved:2,existingIssuesUnchanged:baseline.length,activePasswordsUnchanged:true,membershipsUnchanged:true,osNetworkDenial:'EPERM',noManualCompletionNavigation:true});
  } catch(error) {
    process.exitCode=1; results.push({label:stage,passed:false,error:redact(error.message)});
    console.error(JSON.stringify({failed:true,stage,error:redact(error.message)}));
    if(browser)for(const c of browser.contexts())for(const p of c.pages()){await p.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-ui.private.txt'),redact(await p.locator('body').innerText().catch(()=>'')),{mode:0o600});}
  } finally {
    if(browser)await browser.close(); await db.end().catch(()=>{});
    write('result.json',{passed:process.exitCode!==1&&results.some(r=>r.label==='focused_complete'),runId:cfg.runId,executionId,applicationCommit:expectedCommit,buildId:initialProcesses.buildId,startedAt,finishedAt:new Date().toISOString(),harnessSha256:sha(fs.readFileSync(__filename)),results,requests,browserErrors:errors,foreignRequests,limitations:['Real isolated Supabase Auth/PostgREST and production Next build; existing synthetic seeded consent and entitlements.','Only the changed New Issue workflow is qualified; no capacity result or production equivalence is claimed.','Existing active actor sessions reused; inactive synthetic staff/viewer passwords changed only to perform actual Auth login.']});
    console.log(JSON.stringify({evidence:output,passed:process.exitCode!==1}));
  }
})();
