/* eslint-disable @typescript-eslint/no-require-imports -- Isolated loopback Next/SDK regression; synthetic sessions only. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-session-next-'));
const user = { id: '00000000-0000-4000-8000-000000000005', aud: 'authenticated', role: 'authenticated',
  email: 'fixture@example.invalid', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
const now = Math.floor(Date.now() / 1000);
function session(expiry) {
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp: expiry, role: 'authenticated', aud: 'authenticated' })).toString('base64url'),
    Buffer.from('invented-test-signature').toString('base64url')].join('.');
  return { access_token: token, refresh_token: 'invented-loopback-refresh', expires_at: expiry, expires_in: 3600, token_type: 'bearer', user };
}
const fresh = session(now + 3600), expired = session(now - 600);
const encode = value => `base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
let startupCategory = 'unknown', handlerFailed = false, stopping = false;
let refreshes = 0, userReads = 0, pageEntries = 0, denied = false, child, childExited, phase = 'setup';
const refreshPlan = [];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function plannedRefresh(options = {}) {
  const plan = { ...options, entered: deferred(), release: deferred() };
  if (!plan.held) plan.release.resolve();
  refreshPlan.push(plan); return plan;
}
const auth = http.createServer(async (request, response) => {
  try {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/fixture-page-entry') { pageEntries++; response.end('{}'); return; }
  if (request.url === '/auth/v1/token?grant_type=refresh_token') {
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).refresh_token, expired.refresh_token);
    refreshes++; const plan = refreshPlan.shift();
    if (plan) { plan.entered.resolve(); await plan.release.promise; }
    response.setHeader('x-supabase-api-version', '2024-01-01');
    response.statusCode = plan?.status || 200;
    response.end(plan?.raw ?? JSON.stringify(plan?.status ? { code: plan.code, error_code: plan.code, message: 'Synthetic rejection' } : fresh)); return;
  }
  assert.equal(request.url, '/auth/v1/user'); userReads++;
  assert.equal(request.headers.authorization, `Bearer ${fresh.access_token}`);
  response.statusCode = denied ? 401 : 200;
  response.end(JSON.stringify(denied ? { code: 'bad_jwt', message: 'Synthetic revoked user' } : user));
  } catch { handlerFailed = true; response.statusCode = 500; response.end('{}'); }
});
function write(name, contents) { const file = path.join(temporary, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
async function freePort() { const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
function request(origin, route, cookie, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin + route, { method, headers: { ...(cookie ? { cookie } : {}), ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('loopback_deadline'))); req.on('error', reject);
    req.end();
  });
}
function jarFrom(cookie) { return new Map(cookie.split('; ').map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; })); }
function cookieFrom(jar) { return [...jar].map(([name, value]) => `${name}=${value}`).join('; '); }
function persist(jar, result) {
  for (const value of result.headers['set-cookie'] || []) {
    const pair = value.split(';')[0], at = pair.indexOf('='), name = pair.slice(0, at);
    if (/Max-Age=0(?:;|$)/i.test(value)) jar.delete(name); else jar.set(name, pair.slice(at + 1));
  }
}
function conflictResponse(result, { head = false } = {}) {
  assert.equal(result.status, 503); assert.equal(result.headers.location, undefined);
  assert.equal(result.headers['set-cookie'], undefined, 'conflict must not delete or replace browser cookies');
  assert.match(result.headers['cache-control'], /private/); assert.match(result.headers['cache-control'], /no-store/);
  assert(!result.body.includes(`Verified fixture ${user.id}`));
  if (head) assert.equal(result.body, '');
}
function browserCookie(result) {
  const values = result.headers['set-cookie'] || [];
  assert(values.length > 0, 'Next must deliver the middleware cookies on its final HTTP response');
  return values.filter(value => !/Max-Age=0(?:;|$)/i.test(value)).map(value => value.split(';')[0]).join('; ');
}
async function main() {
  auth.listen(0, '127.0.0.1'); await once(auth, 'listening');
  const authOrigin = `http://127.0.0.1:${auth.address().port}`, port = await freePort(), origin = `http://127.0.0.1:${port}`;
  for (const file of ['middleware.ts', 'lib/supabase/middleware.ts', 'lib/supabase/server.ts', 'lib/supabase/config.ts', 'lib/security/require-auth.ts']) {
    write(file, fs.readFileSync(path.join(root, file), 'utf8'));
  }
  write('package.json', JSON.stringify({ private: true }));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'esnext'], strict: true,
    skipLibCheck: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler',
    resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', paths: { '@/*': ['./*'] } } }));
  write('next.config.mjs', 'export default { devIndicators: false };');
  write('app/layout.tsx', 'export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}');
  write('app/login/page.tsx', 'export default function Login(){return <p>Fixture login</p>}');
  write('app/app/check/page.tsx', 'import {requireAuth} from "@/lib/security/require-auth"; export default async function Page(){await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+"/fixture-page-entry",{cache:"no-store"});const {user}=await requireAuth(); return <p>Verified fixture {user.id}</p>}');
  write('app/app/bounce/page.tsx', 'import {requireAuth} from "@/lib/security/require-auth"; import {redirect} from "next/navigation"; export default async function Page(){await requireAuth();redirect("/app/check")}');
  // The child gets a minimal environment with synthetic loopback configuration.
  // Block outbound sockets and fetch; no real browser, credentials or services.
  write('offline.cjs', `const net=require('node:net');const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let v=args;while(Array.isArray(v[0]))v=v[0];const o=typeof v[0]==='object'?v[0]:{host:typeof v[1]==='string'?v[1]:'localhost'};if(o.path||['localhost','127.0.0.1','::1'].includes(o.host||o.hostname||'localhost'))return connect.apply(this,args);throw new Error('external_network_forbidden');};const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('external_fetch_forbidden');return original(input,init);};`);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
  child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', temporary, '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temporary, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: authOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'invented-public-key',
      NODE_OPTIONS: '--require=' + path.join(temporary, 'offline.cjs') }, detached: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  childExited = once(child, 'exit');
  // Drain without echoing runtime logs or synthetic session values.
  child.stdout.resume(); child.stderr.on('data', chunk => { if (String(chunk).includes('Failed to load SWC binary')) startupCategory = 'installed_native_compiler_unavailable'; });
  let ready = false;
  phase = 'next_startup';
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping || child.exitCode !== null || child.signalCode !== null) throw new Error('next_exited_before_ready');
    try { if ((await request(origin, '/login')).status === 200) { ready = true; break; } } catch { /* startup only */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'isolated Next server must start');
  const stale = `sb-127-auth-token=${encode(expired)}`;
  phase = 'first_expired_request';
  const first = await request(origin, '/app/check', stale);
  assert.equal(first.status, 200); assert(first.body.includes(`Verified fixture`)); assert(first.body.includes(user.id));
  assert.equal(refreshes, 1, 'downstream Server Component must receive the renewed cookie without refreshing again');
  assert.match(first.headers['cache-control'], /no-store/);
  for (const name of Object.keys(first.headers)) assert(!/^x-middleware-request-/i.test(name), 'internal request headers must not reach browser');
  assert.equal(first.headers.authorization, undefined);
  assert.match(first.headers.vary, /RSC/i);
  const persisted = browserCookie(first);
  phase = 'second_browser_request';
  const second = await request(origin, '/app/check', persisted);
  assert.equal(second.status, 200); assert.equal(refreshes, 1, 'browser must retain refreshed session on its next request');
  assert.match(second.headers['cache-control'], /no-store/);
  phase = 'server_component_redirect';
  const bounce = await request(origin, '/app/bounce', stale);
  assert.equal(bounce.status, 307); assert.equal(bounce.headers.location, '/app/check');
  assert.match(bounce.headers['cache-control'], /no-store/); const redirectedCookie = browserCookie(bounce);
  assert.equal((await request(origin, '/app/check', redirectedCookie)).status, 200); assert.equal(refreshes, 2);
  denied = true;
  phase = 'revoked_user';
  const rejected = await request(origin, '/app/check', persisted);
  assert.equal(rejected.status, 307); assert.equal(rejected.headers.location, '/login');
  assert.match(rejected.headers['cache-control'], /no-store/);
  assert(!rejected.body.includes(`Verified fixture ${user.id}`));
  denied = false;
  phase = 'missing_session';
  const missing = await request(origin, '/app/check');
  assert.equal(missing.status, 307); assert.equal(missing.headers.location, '/login');
  assert.match(missing.headers['cache-control'], /no-store/);
  let cases = 5;
  const originalCookie = stale + '; unrelated-fixture=retained';
  phase = 'refresh_conflict';
  const jar = jarFrom(originalCookie), beforeConflict = { refreshes, userReads, pageEntries };
  plannedRefresh({ status: 409, code: 'conflict' });
  const conflict = await request(origin, '/app/check', cookieFrom(jar));
  conflictResponse(conflict); persist(jar, conflict);
  assert.equal(cookieFrom(jar), originalCookie);
  assert.equal(refreshes, beforeConflict.refreshes + 1, 'conflict must not automatically retry refresh');
  assert.equal(userReads, beforeConflict.userReads); assert.equal(pageEntries, beforeConflict.pageEntries, '503 must stop downstream page execution'); cases++;

  phase = 'independent_request_recovers';
  const recovered = await request(origin, '/app/check', cookieFrom(jar));
  assert.equal(recovered.status, 200); persist(jar, recovered);
  assert.notEqual(jar.get('sb-127-auth-token'), encode(expired)); assert.equal(jar.get('unrelated-fixture'), 'retained');
  const afterRecovery = refreshes;
  assert.equal(afterRecovery, beforeConflict.refreshes + 2);
  assert.equal((await request(origin, '/app/check', cookieFrom(jar))).status, 200);
  assert.equal(refreshes, afterRecovery, 'following request uses the recovered browser session'); cases++;

  for (const [label, options] of [['HEAD', { method: 'HEAD' }], ['prefetch', { headers: { RSC: '1', 'next-router-prefetch': '1' } }]]) {
    phase = 'conflict_' + label; const before = { refreshes, userReads, pageEntries };
    plannedRefresh({ status: 409, code: 'conflict' });
    conflictResponse(await request(origin, '/app/check', originalCookie, options), { head: label === 'HEAD' });
    assert.equal(refreshes, before.refreshes + 1); assert.equal(userReads, before.userReads); assert.equal(pageEntries, before.pageEntries); cases++;
  }

  for (const control of [{ status: 409, code: 'refresh_token_not_found' }, { status: 400, code: 'conflict' }, { status: 409, raw: '{' }]) {
    phase = 'nonmatching_refresh_control'; const before = refreshes;
    plannedRefresh(control);
    const rejectedControl = await request(origin, '/app/check', originalCookie);
    assert.equal(rejectedControl.status, 307); assert.equal(rejectedControl.headers.location, '/login');
    assert.equal(refreshes, before + 1); assert.match(rejectedControl.headers['cache-control'], /no-store/);
    assert((rejectedControl.headers['set-cookie'] || []).some(value => /Max-Age=0(?:;|$)/i.test(value)), 'existing invalid-session deletion must remain'); cases++;
  }

  for (const conflictFirst of [true, false]) {
    phase = conflictFirst ? 'same_browser_conflict_first' : 'same_browser_success_first';
    const sharedJar = jarFrom(originalCookie), before = { refreshes, pageEntries };
    const successPlan = plannedRefresh({ held: true });
    const pendingSuccess = request(origin, '/app/check', originalCookie);
    await successPlan.entered.promise;
    const conflictPlan = plannedRefresh({ held: true, status: 409, code: 'conflict' });
    const pendingConflict = request(origin, '/app/check', originalCookie);
    await conflictPlan.entered.promise; // Both refresh requests are outstanding before either response is released.
    if (conflictFirst) {
      conflictPlan.release.resolve(); const failed = await pendingConflict; conflictResponse(failed); persist(sharedJar, failed);
      assert.equal(cookieFrom(sharedJar), originalCookie); assert.equal(pageEntries, before.pageEntries);
      successPlan.release.resolve(); const won = await pendingSuccess; assert.equal(won.status, 200); persist(sharedJar, won);
    } else {
      successPlan.release.resolve(); const won = await pendingSuccess; assert.equal(won.status, 200); persist(sharedJar, won);
      const renewedCookie = cookieFrom(sharedJar);
      conflictPlan.release.resolve(); const failed = await pendingConflict; conflictResponse(failed); persist(sharedJar, failed);
      assert.equal(cookieFrom(sharedJar), renewedCookie, 'late conflict response must not erase a concurrent successful refresh');
    }
    assert.equal(refreshes, before.refreshes + 2); assert.equal(pageEntries, before.pageEntries + 1);
    assert.equal(sharedJar.get('unrelated-fixture'), 'retained');
    assert.equal((await request(origin, '/app/check', cookieFrom(sharedJar))).status, 200);
    assert.equal(refreshes, before.refreshes + 2); cases++;
  }
  assert.equal(refreshPlan.length, 0, 'all synthetic response plans must be consumed');
  assert.equal(handlerFailed, false, 'synthetic Auth transport expectations must hold');
  console.log(JSON.stringify({ passed: true, framework: 'installed Next.js real HTTP middleware + Server Component',
    cases, refreshes, userReads, externalCalls: 0, productionData: false, claims: [
      'same-request cookie propagation', 'next-request persistence', 'cookies preserved through Server Component redirect',
      'revoked user rejected by original guard', 'missing session rejected', 'private no-store responses',
      '409 conflict denies without downstream rendering, cookie mutation or retry', 'independent request recovers',
      'HEAD and prefetch conflict handling', 'nonmatching and malformed errors retain existing denial',
      'one browser cookie jar preserves concurrent success in both response orders' ],
    limitation: 'Loopback HTTP and a modeled browser cookie jar; not a real browser or hosted concurrency policy.' }));
}
function signalGroup(signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
let watchdog;
const deadline = new Promise((_, reject) => { watchdog = setTimeout(() => {
  stopping = true; reject(new Error('isolated_test_deadline'));
}, 180000); });
Promise.race([main(), deadline]).catch(error => { console.error(JSON.stringify({ failed: true, phase,
  category: phase === 'next_startup' ? startupCategory : error.code === 'ERR_ASSERTION' ? 'assertion' : 'harness',
  location: error.stack?.split('\n').find(line => line.includes('supabase-session-refresh-next-tests.cjs:'))?.trim() })); process.exitCode = 1;
}).finally(async () => {
  stopping = true; clearTimeout(watchdog);
  if (child) {
    signalGroup('SIGTERM'); const kill = setTimeout(() => signalGroup('SIGKILL'), 5000);
    if (child.exitCode === null && child.signalCode === null) await childExited;
    clearTimeout(kill); signalGroup('SIGKILL');
  }
  auth.closeAllConnections(); await new Promise(resolve => auth.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
});
