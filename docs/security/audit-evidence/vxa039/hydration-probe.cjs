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
    page.on('pageerror', e => browserErrors.push({ path: new URL(page.url()).pathname, message: sanitize(e.message), stack: sanitize(e.stack || '') }));
    page.on('response', r => { const u = new URL(r.url()); if (u.origin === appOrigin && !u.pathname.startsWith('/_next')) requests.push({ path: u.pathname, method: r.request().method(), status: r.status() }); });
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

const captures=[];
(async()=>{try{
 await db.connect(); const identity=(await db.query("select current_setting('data_directory') directory")).rows[0];assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+'/stacks/'));
 const own=JSON.parse(fs.readFileSync(configFile+'.fixtures.json'));assert.equal(own.runId,config.runId);const a=own.executions.at(-1).workspaces[0];
 const ws=check(await admin.from('workspaces').select('name,created_by').eq('id',a).single(),'workspace');assert(ws.name.startsWith(`CLOSEOUT ${config.runId.slice(0,8)}`));
 const user=check(await admin.auth.admin.getUserById(ws.created_by),'user').user;assert(/^closeout-[a-f0-9-]+@example\.test$/.test(user.email));
 const password=randomBytes(24).toString('base64url');secrets.push(password);check(await admin.auth.admin.updateUserById(user.id,{password}),'password');
 appOrigin=`http://127.0.0.1:${await reservePort()}`;
 const manifest=JSON.parse(fs.readFileSync('/tmp/vaeroex-vxa039-e2e-13/source-manifest.json'));assert.deepEqual(sourceManifest().files,manifest.built.files);assert.equal(fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(),'3zwE65HpsHVah_zBPJwVR');
 const env={PATH:process.env.PATH,HOME:os.homedir(),NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--max-old-space-size=2048 --require=${path.join(root,'scripts/workspace-closeout-egress.cjs')}`,NEXT_PUBLIC_SUPABASE_URL:config.apiUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anonKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,NEXT_PUBLIC_APP_URL:appOrigin,TZ:'UTC'};
 app=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',new URL(appOrigin).port],{cwd:root,env,stdio:['ignore','pipe','pipe']});app.stdout.on('data',b=>appLog+=b);app.stderr.on('data',b=>appLog+=b);
 await waitFor(async()=>{try{return(await fetch(appOrigin+'/login')).status===200}catch{return false}},'ready');browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const {c,page}=await context({email:user.email,password,workspaceId:a},1440);const cdp=await c.newCDPSession(page);await cdp.send('Debugger.enable');await cdp.send('Network.enable');
 await cdp.send('Debugger.setBreakpointByUrl',{urlRegex:'bf553b51-3cd140e4f18cf7f9\\.js$',lineNumber:0,columnNumber:35049});
 cdp.on('Debugger.paused',async ev=>{try{const r=await cdp.send('Debugger.evaluateOnCallFrame',{callFrameId:ev.callFrames[0].callFrameId,expression:`(()=>{function fiber(f){return f?{tag:f.tag,type:typeof f.type==='string'?f.type:typeof f.type,props:typeof f.type==='string'?Object.keys(f.pendingProps||{}):[],parent:f.return&&{tag:f.return.tag,type:typeof f.return.type==='string'?f.return.type:typeof f.return.type}}:null}return {url:location.href,ready:document.readyState,at:performance.now(),fiber:fiber(e),parent:fiber(rP),next:rN?{type:rN.nodeType,name:rN.nodeName,html:rN.outerHTML,connected:rN.isConnected}:null,body:document.body&&document.body.innerHTML.slice(0,2000),segments:[...document.querySelectorAll('[id^="S:"],[id^="P:"]')].map(x=>x.id)}})()`,returnByValue:true});captures.push({stage,at:Date.now(),reason:ev.reason,data:r.result.value,error:r.exceptionDetails?.text});console.log(JSON.stringify({capture:captures.length,stage,data:r.result.value}));}finally{await cdp.send('Debugger.resume')}});
 for(const throttle of [false,true]){await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:throttle?20:0,downloadThroughput:throttle?187500:-1,uploadThroughput:throttle?187500:-1});for(let i=0;i<20;i++){stage=`${throttle?'throttled':'ordinary'}_${i}`;const id=i%2?'448a4109-f529-4bdd-a8fe-78d810d76c71':'21a9d89c-244f-43d5-9e7a-ddfbf396778a';await page.goto(appOrigin+'/app/sources/'+id);await page.waitForTimeout(400);if(i%5===0)console.log(JSON.stringify({stage,errors:browserErrors.length,captures:captures.length}));}}
 }catch(e){console.error(sanitize(e.stack));process.exitCode=1}finally{fs.writeFileSync(path.join(output,'result.json'),sanitize(JSON.stringify({captures,browserErrors,requests},null,2)));if(browser)await browser.close();if(app){app.kill('SIGTERM');await sleep(1000)}await db.end();fs.writeFileSync(path.join(output,'app.log'),sanitize(appLog));}})();
