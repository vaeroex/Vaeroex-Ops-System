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
let refreshes = 0, userReads = 0, denied = false, child, childExited, phase = 'setup';
const auth = http.createServer(async (request, response) => {
  try {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/auth/v1/token?grant_type=refresh_token') {
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(JSON.parse(body).refresh_token, expired.refresh_token);
    refreshes++; response.end(JSON.stringify(fresh)); return;
  }
  assert.equal(request.url, '/auth/v1/user'); userReads++;
  assert.equal(request.headers.authorization, `Bearer ${fresh.access_token}`);
  response.statusCode = denied ? 401 : 200;
  response.end(JSON.stringify(denied ? { code: 'bad_jwt', message: 'Synthetic revoked user' } : user));
  } catch { handlerFailed = true; response.statusCode = 500; response.end('{}'); }
});
function write(name, contents) { const file = path.join(temporary, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
async function freePort() { const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
function request(origin, route, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin + route, { headers: cookie ? { cookie } : {} }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('loopback_deadline'))); req.on('error', reject);
  });
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
  write('app/app/check/page.tsx', 'import {requireAuth} from "@/lib/security/require-auth"; export default async function Page(){const {user}=await requireAuth(); return <p>Verified fixture {user.id}</p>}');
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
  assert.equal(handlerFailed, false, 'synthetic Auth transport expectations must hold');
  console.log(JSON.stringify({ passed: true, framework: 'installed Next.js real HTTP middleware + Server Component',
    cases: 5, refreshes, userReads, externalCalls: 0, productionData: false, claims: [
      'same-request cookie propagation', 'next-request persistence', 'cookies preserved through Server Component redirect',
      'revoked user rejected by original guard', 'missing session rejected', 'private no-store responses' ] }));
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
