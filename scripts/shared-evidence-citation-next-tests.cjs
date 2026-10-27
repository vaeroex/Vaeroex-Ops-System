/* eslint-disable @typescript-eslint/no-require-imports -- Isolated production Next/installed SDK regression; synthetic loopback transport only. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const selfCheck = process.argv.includes('--self-check');
assert(process.argv.slice(2).every(value => value === '--self-check'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-citation-next-'));
const pageFile = 'app/app/sources/evidence/[kind]/[id]/page.tsx';
const gateFile = 'lib/ai/shared-evidence/runtime-gate.ts';
const gateOff = 'export function sharedEvidenceRuntimeEnabled(): boolean { return false; }';
const gateOn = 'export function sharedEvidenceRuntimeEnabled(): boolean { return true; }';
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const workspace = id(1), actor = id(2), artifact = id(4), revision = 'a'.repeat(64);
const publicKey = 'invented-loopback-public-key';
const plans = new Map(), refreshPlans = new Map(), children = new Set();
let phase = 'setup', handlerFailed = false, stopping = false, startupCategory = 'process_failure', nextPlan = 0, cases = 0;
let parentHooks;
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => `base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function write(directory, file, value) {
  const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
}
function bundle(scope = workspace) {
  const sheets = Array.from({ length: 5 }, (_, index) => ({
    identity: { kind: 'sheets_ticket_source', source_id: id(20 + index), version_id: id(30 + index), authority_hash: String(index + 1).repeat(64) },
    hash: String(index + 1).repeat(64), data: { provider: 'google_sheets', workspace_id: scope, entity_id: id(40), connection_id: id(41),
      date: `2026-10-${14 + index}`, time_zone: 'UTC', metrics: [{ metric: 'Synthetic dispatches', value: '6', unit: 'count' },
        { metric: 'Synthetic backlog', value: '4', unit: 'count' }], eligibility: { private: 'PRIVATE_SHEETS_AUTHORITY' },
      read_sources: [{ table: 'synthetic_roots', id: id(50 + index) }] }
  }));
  const xero = { identity: { kind: 'legacy_reference', reference_id: id(60) }, hash: '6'.repeat(64),
    data: { provider: 'xero', workspace_id: scope, business_entity_id: id(40), connection_id: id(61),
      period_start: '2026-09-26', period_end: '2026-10-25', scope: 'connected_account', records: [{
        key: ['xero', id(61), 'synthetic-bill'], day: '2026-10-13', metrics: [
          { key: 'invoices', value: 0, currency: 'USD' }, { key: 'billed', value: 0, currency: 'USD' },
          { key: 'outstanding', value: 0, currency: 'USD' }, { key: 'bills', value: 1, currency: 'USD' },
          { key: 'purchases', value: 10, currency: 'USD' }] }], read_sources: [], eligibility: { private: 'PRIVATE_XERO_AUTHORITY' } } };
  return { stage: 'revalidated_saved_evidence', artifact_kind: 'vsi_exchange', artifact_id: artifact, artifact_revision: revision,
    manifest_ids: [id(70)], projections: [sheets[0], xero, ...sheets.slice(1)] };
}
const citedHashes = ['1', '2', '6'].map(value => value.repeat(64));
function plan(mode = 'ok', options = {}) {
  const serial = ++nextPlan;
  const scope = options.workspace || workspace, actorId = options.actor || actor;
  const user = { id: actorId, aud: 'authenticated', role: 'authenticated', email: `owner-${serial}@fixture.invalid`,
    app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-10-01T00:00:00Z' };
  function session(expiry, suffix) {
    const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: actorId, session_id: id(100 + serial), exp: expiry, role: 'authenticated', aud: 'authenticated', jti: `${serial}-${suffix}` })).toString('base64url'),
      Buffer.from('invented-test-signature').toString('base64url')].join('.');
    return { access_token: token, refresh_token: `invented-refresh-${serial}`, expires_at: expiry, expires_in: 3600, token_type: 'bearer', user };
  }
  const now = Math.floor(Date.now() / 1000);
  const p = { mode, workspace: scope, user, fresh: session(now + 3600, 'fresh'), stale: session(now - 600, 'stale'),
    counts: { auth: 0, refresh: 0, db: 0, rpc: 0, rpcClosed: 0, headersSent: 0 }, checkedHashes: [], pending: new Set() };
  plans.set(p.fresh.access_token, p); plans.set(p.stale.access_token, p); refreshPlans.set(p.stale.refresh_token, p); return p;
}
function cookie(p, expired = false) {
  return `sb-127-auth-token=${encode(expired ? p.stale : p.fresh)}; vaeroex_workspace_id=${p.workspace}`;
}
function target(scope = workspace, hash = citedHashes[0]) {
  return `/app/sources/evidence/vsi_exchange/${artifact}?workspace=${scope}#source-${hash}`;
}
async function readBody(request) { let body = ''; for await (const chunk of request) { body += chunk; assert(body.length < 16384); } return JSON.parse(body); }
function json(response, status, data) { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); }
const backend = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    assert.equal(request.headers.apikey, publicKey);
    if (url.pathname === '/auth/v1/token') {
      assert.equal(request.method, 'POST'); assert.equal(url.search, '?grant_type=refresh_token');
      const body = await readBody(request), p = refreshPlans.get(body.refresh_token); assert(p); p.counts.refresh++;
      response.setHeader('x-supabase-api-version', '2024-01-01');
      json(response, p.mode === 'refresh_conflict' ? 409 : 200, p.mode === 'refresh_conflict' ?
        { code: 'conflict', error_code: 'conflict', message: 'PRIVATE_REFRESH_ERROR' } : p.fresh); return;
    }
    const p = plans.get(String(request.headers.authorization || '').replace(/^Bearer /, '')); assert(p);
    assert.equal(request.headers.authorization, `Bearer ${p.fresh.access_token}`, 'only current verified sessions can reach data');
    if (url.pathname === '/auth/v1/user') {
      assert.equal(request.method, 'GET'); p.counts.auth++;
      json(response, p.mode === 'revoked' ? 401 : 200, p.mode === 'revoked' ? { code: 'bad_jwt', message: 'PRIVATE_REVOKED' } : p.user); return;
    }
    const ws = { id: p.workspace, name: 'Synthetic paid workspace', subscription_status: 'active', subscription_required: true, manually_unlocked: false };
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(request.method, 'GET'); assert.equal(url.searchParams.get('id'), `eq.${p.user.id}`); p.counts.db++;
      json(response, 200, [{ id: p.user.id, email: p.user.email }]); return;
    }
    if (url.pathname === '/rest/v1/workspace_members') {
      assert.equal(request.method, 'GET'); assert.equal(url.searchParams.get('user_id'), `eq.${p.user.id}`);
      assert.equal(url.searchParams.get('status'), 'eq.active'); p.counts.db++;
      json(response, 200, p.mode === 'inactive' ? [] : [{ id: id(80), workspace_id: p.workspace, user_id: p.user.id,
        role: p.mode === 'nonowner' ? 'member' : 'owner', status: 'active', workspaces: ws }]); return;
    }
    if (url.pathname === '/rest/v1/workspaces') {
      assert.equal(request.method, 'GET'); assert.equal(url.searchParams.get('id'), `eq.${p.workspace}`); p.counts.db++;
      json(response, 200, [ws]); return;
    }
    if (url.pathname === '/rest/v1/customer_subscriptions') {
      assert.equal(request.method, 'GET'); const filter = url.searchParams.get('or');
      assert.equal(filter, `(user_id.eq.${p.user.id},customer_email.ilike.${p.user.email},workspace_id.eq.${p.workspace})`); p.counts.db++;
      json(response, 200, [{ id: id(81), workspace_id: p.workspace, user_id: p.user.id, customer_email: p.user.email,
        billing_provider: 'stripe', manually_activated: false, status: p.mode === 'billing_denied' ? 'past_due' : 'active',
        current_period_end: new Date(Date.now() + 86400000).toISOString(), stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture',
        subscription_plans: null }]); return;
    }
    assert.equal(url.pathname, '/rest/v1/rpc/reopen_shared_evidence_target_v1'); assert.equal(request.method, 'POST');
    const args = await readBody(request);
    assert.deepEqual(args, { p_workspace_id: p.workspace, p_artifact_kind: 'vsi_exchange', p_artifact_id: artifact });
    p.counts.rpc++;
    const packet = bundle(p.workspace);
    // Modeled protected-RPC decisions, not SQL/RLS execution. All six manifest originals are considered;
    // the last Sheets original is intentionally absent from the three cited hashes.
    p.checkedHashes = packet.projections.map(source => source.hash);
    if (p.mode === 'rpc_denied' || p.mode === 'other_actor') {
      json(response, 403, { code: '42501', message: 'evidence_live_session_required', details: 'PRIVATE_RPC_DENIAL' }); return;
    }
    if (p.mode === 'source_changed') {
      assert(!citedHashes.includes(p.checkedHashes.at(-1)));
      json(response, 409, { code: '40001', message: 'shared_evidence_source_changed', details: 'PRIVATE_CHANGED_UNCITED_SOURCE' }); return;
    }
    if (p.mode === 'stall_headers' || p.mode === 'stall_body') {
      p.pending.add(response);
      response.once('close', () => { p.pending.delete(response); if (!response.writableEnded) p.counts.rpcClosed++; });
      if (p.mode === 'stall_body') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"stage":'); p.counts.headersSent++; }
      return;
    }
    if (p.mode === 'malformed') { json(response, 200, { stage: 'wrong', private: 'PRIVATE_INVALID_ENVELOPE' }); return; }
    if (p.mode === 'foreign_projection') packet.projections[0].data.workspace_id = id(999);
    json(response, 200, packet);
  } catch { handlerFailed = true; if (!response.headersSent) json(response, 500, {}); else response.destroy(); }
});
function request(origin, route, cookieValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, origin); url.hash = '';
    const req = http.request(url, { method: options.method || 'GET', headers: { ...(cookieValue ? { cookie: cookieValue } : {}), ...options.headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; if (body.length > 2000000) req.destroy(new Error('response_budget')); });
      res.on('error', reject); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('loopback_deadline'))); req.on('error', reject); req.end(options.body);
  });
}
async function freePort() { const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
function sourceClosure() {
  const sources = new Map();
  function visit(file) {
    if (sources.has(file)) return;
    assert(!file.startsWith('..') && !path.isAbsolute(file));
    const source = fs.readFileSync(path.join(root, file), 'utf8'); sources.set(file, source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function dependency(specifier) {
      if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return;
      const base = specifier.startsWith('@/') ? specifier.slice(2) : path.join(path.dirname(file), specifier);
      const found = [base, ...['.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx'].map(extension => base + extension)]
        .find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert(found, 'all local static source dependencies must resolve'); visit(found);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require') &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  visit(pageFile); visit('middleware.ts'); return sources;
}
function offlinePreload(ports, audit, diagnostics, directory) {
  // A blocked attempt is durably counted even if application/SDK code catches the error.
  return `const fs=require('node:fs'),net=require('node:net');const ports=new Set(${JSON.stringify(ports)}),hosts=new Set(['127.0.0.1','localhost','::1','[::1]']);
function deny(kind){fs.appendFileSync(${JSON.stringify(audit)},kind+'\\n');throw new Error('fixture_network_forbidden');}
const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){let v=args;while(Array.isArray(v[0]))v=v[0];const o=typeof v[0]==='object'?v[0]:typeof v[0]==='string'&&!/^\\d+$/.test(v[0])?{path:v[0]}:{port:v[0],host:typeof v[1]==='string'?v[1]:'localhost'};if(o.path){if(!String(o.path).startsWith(${JSON.stringify(directory + path.sep)}))deny('socket');}else if(!hosts.has(o.host||o.hostname||'localhost')||!ports.has(Number(o.port)))deny('socket');return connect.apply(this,args);};
const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!hosts.has(url.hostname)||!ports.has(Number(url.port||({ 'http:':80,'https:':443 }[url.protocol]))))deny('fetch');return original(input,init);};
for(const level of ['info','warn']){const original=console[level];console[level]=(...args)=>{if(args[0]==='[shared-citation-transport]'||args[0]==='[shared-citation]')fs.appendFileSync(${JSON.stringify(diagnostics)},JSON.stringify({tag:args[0],data:args[1]})+'\\n');return original.apply(console,args);};}
`;
}
function stageFixture(sources, enabled, port, backendPort) {
  const directory = path.join(temporary, enabled ? 'enabled' : 'off'); fs.mkdirSync(directory);
  assert.equal(sources.get(gateFile).split(gateOff).length, 2, 'exactly the reviewed OFF helper can be replaced');
  for (const [file, source] of sources) write(directory, file, enabled && file === gateFile ? source.replace(gateOff, gateOn) : source);
  write(directory, 'package.json', JSON.stringify({ private: true }));
  write(directory, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], strict: true,
    skipLibCheck: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler',
    resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', paths: { '@/*': ['./*'] } } }));
  write(directory, 'next.config.mjs', 'export default { devIndicators:false, experimental:{cpus:1} };');
  write(directory, 'app/layout.tsx', 'export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}');
  write(directory, 'app/login/page.tsx', 'export default function Login(){return <h1>Fixture login</h1>}');
  write(directory, 'app/not-found.tsx', 'export default function NotFound(){return <h1>Fixture not found</h1>}');
  const audit = path.join(directory, 'blocked-network.log'), diagnostics = path.join(directory, 'diagnostics.log');
  write(directory, 'blocked-network.log', ''); write(directory, 'diagnostics.log', '');
  write(directory, 'offline.cjs', offlinePreload([port, backendPort], audit, diagnostics, directory));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const fixture = { directory, enabled, port, origin: `http://127.0.0.1:${port}`, audit, diagnostics,
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${backendPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
      NODE_OPTIONS: '--require=' + path.join(directory, 'offline.cjs') } };
  verifyCopies(sources, fixture); return fixture;
}
function verifyCopies(sources, fixture) {
  for (const [file, source] of sources) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), source, 'repository runtime must remain unchanged');
    const staged = fs.readFileSync(path.join(fixture.directory, file), 'utf8');
    assert.equal(staged, fixture.enabled && file === gateFile ? source.replace(gateOff, gateOn) : source);
  }
  assert(!Object.keys(fixture.env).some(key => /SECRET|SERVICE_ROLE|ADMIN|TOKEN|PASSWORD/.test(key)));
  assert.equal(fs.readFileSync(fixture.audit, 'utf8'), '', 'every unexpected outbound attempt fails qualification');
}
function runChild(fixture, args) {
  assert(!stopping);
  const child = spawn(process.execPath, args, { cwd: fixture.directory, env: fixture.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  child.stdout.resume(); child.stderr.on('data', chunk => { if (/Failed to load SWC binary/.test(String(chunk))) startupCategory = 'installed_native_compiler_unavailable'; });
  return child;
}
function signal(child, kind) { if (!child.pid) return; try { process.kill(-child.pid, kind); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
async function stopChild(child) {
  signal(child, 'SIGTERM'); const kill = setTimeout(() => signal(child, 'SIGKILL'), 3000);
  try { await child.done; } finally { clearTimeout(kill); signal(child, 'SIGKILL'); children.delete(child); }
}
async function startNext(fixture) {
  phase = fixture.enabled ? 'enabled_production_build' : 'off_production_build';
  const build = runChild(fixture, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', fixture.directory]);
  assert.equal((await build.done).code, 0, 'isolated production build must succeed'); await stopChild(build);
  phase = fixture.enabled ? 'enabled_production_start' : 'off_production_start';
  const child = runChild(fixture, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', fixture.directory, '--hostname', '127.0.0.1', '--port', String(fixture.port)]);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (stopping || child.exitCode !== null || child.signalCode !== null) throw new Error('next_exited_before_ready');
    try { if ((await request(fixture.origin, '/login')).status === 200) return child; } catch { /* Startup polling only; no build/request retries. */ }
    await pause(100);
  }
  throw new Error('next_not_ready');
}
function html(result) { return result.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''); }
function privateResponse(result) {
  assert.match(result.headers['cache-control'], /no-store/); assert.match(result.headers['cache-control'], /private/);
  assert.equal(result.headers.authorization, undefined);
  assert(!Object.keys(result.headers).some(name => /^x-middleware-request-/i.test(name)));
  assert(!/PRIVATE_|read_sources|eligibility/.test(result.body));
}
function rendered(result, scope = workspace) {
  assert.equal(result.status, 200); privateResponse(result); const body = html(result);
  assert.match(body, /<h1\b[^>]*>Saved evidence<\/h1>/);
  const sections = [...body.matchAll(/<section\b[^>]*\bid="(source-[a-f0-9]{64})"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length, 6);
  for (const source of bundle(scope).projections) {
    const section = sections.find(value => value[1] === `source-${source.hash}`); assert(section);
    assert(section[2].includes(`<h2 class="font-semibold">${source.data.provider}</h2>`));
    const pre = section[2].match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/); assert(pre);
    const decoded = pre[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const facts = Object.fromEntries(Object.entries(source.data).filter(([key]) => key !== 'eligibility' && key !== 'read_sources'));
    assert.deepEqual(JSON.parse(decoded), facts, 'visible pre content must equal the saved projection, including money/count fields');
  }
  for (const hash of citedHashes) assert(sections.some(value => value[1] === `source-${hash}`));
}
function denied(result, { status, redirect, unavailable = false } = {}) {
  privateResponse(result); const body = html(result);
  assert(!/<section\b[^>]*id="source-/.test(body)); assert(!/<h1\b[^>]*>Saved evidence<\/h1>/.test(body));
  // A negative must not hide evidence in serialized Flight data either. Route IDs may legitimately
  // appear there, so use projection-only anchors/content rather than workspace/artifact parameters.
  assert(!bundle().projections.some(source => result.body.includes(`source-${source.hash}`)));
  assert(!/Synthetic dispatches|Synthetic backlog|synthetic-bill/.test(result.body));
  if (status) assert.equal(result.status, status);
  if (redirect) assert(result.headers.location?.startsWith(redirect));
  if (unavailable) { assert.equal(result.status, 200); assert.match(body, /<h1\b[^>]*>Source unavailable<\/h1>/); }
}
function persisted(p, result) {
  const jar = new Map(cookie(p, true).split('; ').map(value => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
  assert((result.headers['set-cookie'] || []).length > 0);
  for (const value of result.headers['set-cookie']) { const pair = value.split(';')[0], at = pair.indexOf('='), name = pair.slice(0, at);
    if (/Max-Age=0(?:;|$)/i.test(value)) jar.delete(name); else jar.set(name, pair.slice(at + 1)); }
  const base = 'sb-127-auth-token', chunks = [...jar].filter(([name]) => name.startsWith(base + '.'))
    .sort(([left], [right]) => Number(left.slice(base.length + 1)) - Number(right.slice(base.length + 1)));
  if (!jar.has(base)) chunks.forEach(([name], index) => assert.equal(name, `${base}.${index}`));
  const encoded = decodeURIComponent(jar.get(base) || chunks.map(([, value]) => value).join(''));
  assert(encoded.startsWith('base64-'));
  assert.deepEqual(JSON.parse(Buffer.from(encoded.slice(7), 'base64url').toString('utf8')), p.fresh);
  assert.equal(jar.get('vaeroex_workspace_id'), p.workspace);
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}
function diagnostics(fixture) {
  const entries = fs.readFileSync(fixture.diagnostics, 'utf8').split('\n').filter(Boolean).map(value => JSON.parse(value));
  for (const entry of entries) {
    assert(!/PRIVATE_|00000000-|invented-|access_token|refresh_token/.test(JSON.stringify(entry)));
    assert.deepEqual(Object.keys(entry.data).sort(), (entry.tag === '[shared-citation-transport]' ?
      ['outcome', 'phase', 'elapsedMs', 'milestones', 'rpcStatus', 'refreshStatus'] : ['stage', 'category', 'reason', 'elapsedMs', 'sqlCode', 'httpStatus']).sort());
  }
  return entries;
}
async function compilerIndependentChecks(sources, fixtures, backendOrigin) {
  phase = 'self_check_sources';
  for (const [file, source] of sources) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts')) continue;
    const parsed = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } });
    assert.equal((parsed.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0);
  }
  for (const fixture of fixtures) verifyCopies(sources, fixture);
  // Exercise both future Next listener ports through the parent allowlist without invoking Next.
  for (const fixture of fixtures) {
    const listener = http.createServer((_request, response) => response.end('fixture-port'));
    try {
      listener.listen(fixture.port, '127.0.0.1'); await once(listener, 'listening');
      assert.equal((await request(fixture.origin, '/health')).body, 'fixture-port');
    } finally { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
  }
  phase = 'self_check_synthetic_sdk_transport';
  const { createClient } = require('@supabase/supabase-js');
  for (const mode of ['ok', 'rpc_denied', 'source_changed', 'malformed', 'foreign_projection']) {
    const p = plan(mode);
    const client = createClient(backendOrigin, publicKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${p.fresh.access_token}` } } });
    assert.equal((await client.auth.getUser(p.fresh.access_token)).data.user.id, p.user.id);
    const reads = await Promise.all([client.from('profiles').select('*').eq('id', p.user.id).maybeSingle(),
      client.from('workspace_members').select('*, workspaces(*)').eq('user_id', p.user.id).eq('status', 'active'),
      client.from('workspaces').select('*').eq('id', p.workspace).maybeSingle(),
      client.from('customer_subscriptions').select('*').or(`user_id.eq.${p.user.id},customer_email.ilike.${p.user.email},workspace_id.eq.${p.workspace}`)]);
    for (const result of reads) assert.equal(result.error, null);
    const result = await client.rpc('reopen_shared_evidence_target_v1', { p_workspace_id: p.workspace, p_artifact_kind: 'vsi_exchange', p_artifact_id: artifact });
    assert.equal(p.counts.rpc, 1); assert.equal(p.checkedHashes.length, 6);
    if (mode === 'rpc_denied' || mode === 'source_changed') assert(result.error); else assert.equal(result.error, null);
    if (mode === 'ok') assert.deepEqual(result.data, bundle());
  }
  // Test only the local server's cancellation mechanism here, not the page's unchanged 10s deadline.
  for (const mode of ['stall_headers', 'stall_body']) {
    const p = plan(mode);
    await new Promise((resolve, reject) => {
      const req = http.request(backendOrigin + '/rest/v1/rpc/reopen_shared_evidence_target_v1', { method: 'POST', headers: {
        apikey: publicKey, authorization: `Bearer ${p.fresh.access_token}`, 'Content-Type': 'application/json' } }, res => res.resume());
      req.on('error', error => error.message === 'fixture_cancel' ? resolve() : reject(error));
      req.end(JSON.stringify({ p_workspace_id: p.workspace, p_artifact_kind: 'vsi_exchange', p_artifact_id: artifact }));
      const timer = setInterval(() => { if (p.counts.rpc === 1) { clearInterval(timer); req.destroy(new Error('fixture_cancel')); } }, 10);
      timer.unref();
    });
    for (let i = 0; i < 30 && p.counts.rpcClosed !== 1; i++) await pause(10);
    assert.equal(p.counts.rpcClosed, 1); assert.equal(p.counts.headersSent, mode === 'stall_body' ? 1 : 0);
  }
  phase = 'self_check_network_guard';
  const fixture = fixtures[0];
  const probe = runChild(fixture, ['-e', `const net=require('node:net');let blocked=0;for(const run of [()=>net.Socket.prototype.connect.call(new net.Socket(),[[{host:'blocked.invalid',port:443}]]),()=>fetch('https://blocked.invalid')]){try{run()}catch{blocked++}}if(blocked!==2)process.exitCode=1;`]);
  assert.equal((await probe.done).code, 0); children.delete(probe);
  assert.deepEqual(fs.readFileSync(fixture.audit, 'utf8').trim().split('\n'), ['socket', 'fetch']);
  // This intentionally blocked guard probe is separate from the default full HTTP run.
  assert.equal(handlerFailed, false);
  return { sourceFiles: sources.size, sourceFingerprint: sha([...sources].map(([file, source]) => `${file}:${sha(source)}`).sort().join('\n')),
    syntheticSdkCases: 5, syntheticCancellationCases: 2, intentionallyBlockedProbeAttempts: 2 };
}
async function fullHttpChecks(sources, fixtures) {
  const [off, on] = fixtures;
  let child = await startNext(off);
  phase = 'off_gate'; const pOff = plan();
  denied(await request(off.origin, target(), cookie(pOff)), { status: 404 });
  assert.equal(pOff.counts.auth, 1, 'the original middleware still verifies a supplied session before the OFF page');
  assert.equal(pOff.counts.db, 0); assert.equal(pOff.counts.rpc, 0);
  const beforeMissing = [...plans.values()].reduce((sum, p) => sum + p.counts.auth + p.counts.db + p.counts.rpc, 0);
  denied(await request(off.origin, target()), { status: 404 });
  assert.equal([...plans.values()].reduce((sum, p) => sum + p.counts.auth + p.counts.db + p.counts.rpc, 0), beforeMissing);
  assert.equal(diagnostics(off).length, 0); cases += 2;
  await stopChild(child); verifyCopies(sources, off);
  child = await startNext(on);
  phase = 'saved_links_and_same_request_refresh'; const p = plan();
  const first = await request(on.origin, target(workspace, citedHashes[0]), cookie(p, true)); rendered(first);
  assert.equal(p.counts.refresh, 1); assert.equal(p.counts.rpc, 1); assert.equal(p.checkedHashes.length, 6);
  const savedCookie = persisted(p, first);
  rendered(await request(on.origin, target(workspace, citedHashes[2]), savedCookie));
  assert.equal(p.counts.refresh, 1, 'next browser request must use persisted refresh'); assert.equal(p.counts.rpc, 2); cases += 2;
  phase = 'fresh_session'; const fresh = plan(); rendered(await request(on.origin, target(), cookie(fresh)));
  assert.equal(fresh.counts.refresh, 0); assert.equal(fresh.counts.rpc, 1); cases++;
  for (const [mode, expected] of [['revoked', { status: 307, redirect: '/login' }], ['inactive', { status: 307, redirect: '/app/setup' }],
    ['nonowner', { status: 404 }], ['billing_denied', { status: 307, redirect: '/billing-required?' }]]) {
    phase = mode; const p = plan(mode); denied(await request(on.origin, target(), cookie(p)), expected); assert.equal(p.counts.rpc, 0); cases++;
  }
  phase = 'missing_session'; denied(await request(on.origin, target()), { status: 307, redirect: '/login' }); cases++;
  phase = 'cross_workspace'; const foreign = plan('ok', { workspace: id(201), actor: id(202) });
  denied(await request(on.origin, target(), cookie(foreign)), { status: 404 }); assert.equal(foreign.counts.rpc, 0); cases++;
  phase = 'refresh_conflict'; const conflict = plan('refresh_conflict');
  const conflictResult = await request(on.origin, target(), cookie(conflict, true)); denied(conflictResult, { status: 503 });
  assert.equal(conflictResult.headers['set-cookie'], undefined); assert.equal(conflict.counts.refresh, 1); assert.equal(conflict.counts.db, 0); assert.equal(conflict.counts.rpc, 0); cases++;
  for (const mode of ['rpc_denied', 'other_actor', 'source_changed', 'malformed', 'foreign_projection']) {
    phase = mode; const p = plan(mode, mode === 'other_actor' ? { actor: id(301) } : {});
    denied(await request(on.origin, target(), cookie(p)), { unavailable: true }); assert.equal(p.counts.rpc, 1); assert.equal(p.checkedHashes.length, 6); cases++;
  }
  phase = 'concurrent_actor_workspace_isolation';
  const concurrent = [plan(), plan('ok', { actor: id(401), workspace: id(402) })];
  const results = await Promise.all(concurrent.map(p => request(on.origin, target(p.workspace), cookie(p, true))));
  results.forEach((result, index) => { const p = concurrent[index]; rendered(result, p.workspace); assert.equal(p.counts.refresh, 1); assert.equal(p.counts.rpc, 1);
    assert(!html(result).includes(concurrent[1 - index].workspace)); }); cases++;
  for (const mode of ['stall_headers', 'stall_body']) {
    phase = mode; const p = plan(mode), before = diagnostics(on).length, started = performance.now();
    denied(await request(on.origin, target(), cookie(p)), { unavailable: true });
    const elapsed = performance.now() - started; assert(elapsed >= 9500 && elapsed < 25000);
    for (let i = 0; i < 50 && p.counts.rpcClosed !== 1; i++) await pause(20);
    assert.equal(p.counts.rpc, 1); assert.equal(p.counts.rpcClosed, 1); assert.equal(p.pending.size, 0);
    assert.equal(p.counts.headersSent, mode === 'stall_body' ? 1 : 0);
    const emitted = diagnostics(on).slice(before), transport = emitted.find(entry => entry.tag === '[shared-citation-transport]');
    assert(transport); assert.equal(transport.data.outcome, 'deadline');
    assert.equal(transport.data.phase, mode === 'stall_body' ? 'rpc_body_read' : 'rpc_fetch_invoked');
    assert.equal(transport.data.rpcStatus, mode === 'stall_body' ? '2xx' : 'not_observed');
    assert(transport.data.elapsedMs >= 9500 && transport.data.elapsedMs <= 25000);
    assert(emitted.some(entry => entry.tag === '[shared-citation]' && entry.data.reason === 'read_deadline_exceeded'));
    const frozen = JSON.stringify(emitted); await pause(100); assert.equal(JSON.stringify(diagnostics(on).slice(before)), frozen);
    const recovery = plan(); rendered(await request(on.origin, target(), cookie(recovery)));
    assert.equal(p.counts.rpcClosed, 1); assert.equal(recovery.counts.rpc, 1); cases++;
  }
  await stopChild(child); for (const fixture of fixtures) verifyCopies(sources, fixture);
  assert.equal(handlerFailed, false); diagnostics(on);
}
async function main() {
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  const backendPort = backend.address().port, sources = sourceClosure();
  const fixtures = [stageFixture(sources, false, await freePort(), backendPort), stageFixture(sources, true, await freePort(), backendPort)];
  // Guard the parent SDK/HTTP probes as well as every child, without inheriting credentials.
  parentHooks = { connect: require('node:net').Socket.prototype.connect, fetch: globalThis.fetch, info: console.info, warn: console.warn };
  const parentAudit = path.join(temporary, 'parent-blocked-network.log');
  write(temporary, 'parent-blocked-network.log', '');
  write(temporary, 'parent-offline.cjs', offlinePreload([backendPort, ...fixtures.map(fixture => fixture.port)], parentAudit,
    path.join(temporary, 'parent-diagnostics.log'), temporary));
  require(path.join(temporary, 'parent-offline.cjs'));
  if (selfCheck) {
    const checks = await compilerIndependentChecks(sources, fixtures, `http://127.0.0.1:${backendPort}`);
    assert.equal(fs.readFileSync(parentAudit, 'utf8'), '');
    console.log(JSON.stringify({ passed: true, mode: 'compiler-independent-self-check', ...checks, externalCalls: 0,
      fullHttpExecuted: false, limitation: 'No Next compiler or protected-route HTTP execution; this validates fixture construction and synthetic transport only.' }));
  } else {
    await fullHttpChecks(sources, fixtures);
    assert.equal(fs.readFileSync(parentAudit, 'utf8'), '');
    console.log(JSON.stringify({ passed: true, mode: 'installed-production-Next-build-start-real-HTTP', cases, sourceFiles: sources.size,
      externalAttempts: 0, externalCalls: 0, productionData: false, enabledGate: 'temporary copied sharedEvidenceRuntimeEnabled only',
      limitation: 'Synthetic Auth/PostgREST decisions and browser cookie jar; minimal layout. Does not execute production layout, browser, SQL/RLS, providers, or establish a hosted root cause.' }));
  }
}
let watchdog;
const deadline = new Promise((_, reject) => { watchdog = setTimeout(() => { stopping = true; reject(new Error('harness_deadline')); }, selfCheck ? 30000 : 270000); });
Promise.race([main(), deadline]).catch(error => {
  const location = /shared-evidence-citation-next-tests\.cjs:(\d+):\d+/.exec(String(error.stack))?.[1];
  console.error(JSON.stringify({ failed: true, phase, category: phase.includes('production_build') ? startupCategory : error.code === 'ERR_ASSERTION' ? 'assertion' : 'harness',
    location: location ? `shared-evidence-citation-next-tests.cjs:${location}` : null })); process.exitCode = 1;
}).finally(async () => {
  stopping = true; clearTimeout(watchdog);
  for (const child of [...children]) await stopChild(child).catch(() => { process.exitCode = 1; });
  backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
  if (parentHooks) { require('node:net').Socket.prototype.connect = parentHooks.connect; globalThis.fetch = parentHooks.fetch;
    console.info = parentHooks.info; console.warn = parentHooks.warn; }
  fs.rmSync(temporary, { recursive: true, force: true });
});
