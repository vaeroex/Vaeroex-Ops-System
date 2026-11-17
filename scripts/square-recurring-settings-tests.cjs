/* eslint-disable @typescript-eslint/no-require-imports -- Real server handlers with isolated owner/session and database fixtures. */
const assert = require('node:assert/strict'), test = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const ids = { actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspace: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', connection: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
const status = { recurring_enabled: false, recurring_next_refresh_at: null, recurring_last_attempt_at: null,
  recurring_failure_count: 0, recurring_last_failure_at: null, recurring_last_error_code: null,
  authorized: false, reason: 'disabled', last_successful_refresh_at: null, has_more: false, manual_read_in_progress: false };
let calls, role, member, claims, databaseError, databaseData, authCalls;
const mocks = {
  '@/lib/security/require-auth': { requireAuth: async () => { authCalls++; return { user: { id: ids.actor }, supabase: { auth: {
    getClaims: async () => ({ data: { claims }, error: null }) } } }; } },
  '@/lib/security/get-current-workspace': { getCurrentWorkspace: async (...args) => {
    assert.equal(args.length, 0); return { workspaceId: ids.workspace, membership: { role, user_id: member } };
  } },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ async rpc(name, args) {
    calls.push({ name, args }); return { error: databaseError, data: databaseData ?? { ...status,
      ...(name === 'square_customer_set_recurring_v1' ? { recurring_enabled: args.p_enabled } : {}) } };
  } }) }
};
const load = Module._load;
Module._load = function(request, parent, isMain) { return Object.hasOwn(mocks, request) ? mocks[request] : load.call(this, request, parent, isMain); };
const { squareDirectRecurringView, squareDirectRecurringRoute, directForm } = require('../lib/integrations/square-direct/server.ts');
global.fetch = async () => { throw Error('provider_network_forbidden'); };
function reset() {
  calls = []; role = 'owner'; member = ids.actor; claims = { sub: ids.actor, session_id: ids.session };
  databaseError = null; databaseData = null; authCalls = 0;
  process.env.NODE_ENV = 'production'; process.env.VERCEL_ENV = 'production'; process.env.SQUARE_CUSTOMER_BACKEND_ENABLED = 'true';
  process.env.SQUARE_CUSTOMER_APPLICATION_ID = 'sq0idp-synthetic-application';
  process.env.SQUARE_AUTOMATIC_REFRESH_ENABLED = 'true'; process.env.SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS = ids.workspace;
  delete process.env.SQUARE_CUSTOMER_APPLICATION_SECRET; delete process.env.SQUARE_CUSTOMER_ENCRYPTION_KEY;
}
const form = enabled => ({ connectionId: ids.connection, enabled: String(enabled), confirmation: enabled ? 'enable-recurring' : 'disable-recurring' });
function request(body = form(true), extraHeaders = {}) { return new Request('https://www.vaeroex.com/api/integrations/square/recurring-settings', {
  method: 'POST', headers: { host: 'www.vaeroex.com', origin: 'https://www.vaeroex.com', 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
  body: typeof body === 'string' ? body : new URLSearchParams(body)
}); }
const authority = () => ({ p_actor_id: ids.actor, p_session_id: ids.session, p_workspace_id: ids.workspace,
  p_application_id: 'sq0idp-synthetic-application', p_connection_id: ids.connection });

test('Square optional settings read uses live owner/session/workspace and no secret or provider request', async () => {
  reset();
  assert.deepEqual(await squareDirectRecurringView(ids.connection), { connectionId: ids.connection, rolloutAllowed: true, status });
  assert.deepEqual(calls, [{ name: 'square_customer_recurring_status_v1', args: authority() }]);
  for (const data of [null, { ...status, credential: 'private-not-for-ui' }, { ...status, reason: 'unexpected' }]) {
    databaseError = data === null ? { code: 'PGRST202' } : null; databaseData = data;
    const result = await squareDirectRecurringView(ids.connection); assert.equal(result.status, null);
  }
});
test('Square settings reject an invalid actor/session and preserve the production-only gate', async () => {
  for (const kind of ['viewer', 'foreign-member', 'foreign-claims', 'missing-session']) {
    reset(); if (kind === 'viewer') role = 'viewer'; else if (kind === 'foreign-member') member = ids.connection;
    else if (kind === 'foreign-claims') claims.sub = ids.connection; else delete claims.session_id;
    const result = await squareDirectRecurringView(ids.connection); assert.equal(result.status, null); assert.equal(calls.length, 0);
    await squareDirectRecurringRoute(request()); assert.equal(calls.length, 0);
  }
  reset(); process.env.VERCEL_ENV = 'preview';
  assert.equal(await squareDirectRecurringView(ids.connection), null); assert.equal((await squareDirectRecurringRoute(request())).status, 404);
  assert.equal(authCalls, 0); assert.equal(calls.length, 0);
});
test('Square confirmed settings bind fixed authority and allow turning off saved consent when rollout is off', async () => {
  reset(); const response = await squareDirectRecurringRoute(request()); assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /recurring=enabled$/);
  assert.deepEqual(calls, [{ name: 'square_customer_set_recurring_v1', args: { ...authority(), p_enabled: true } }]);
  process.env.SQUARE_AUTOMATIC_REFRESH_ENABLED = 'false'; calls = [];
  assert.match((await squareDirectRecurringRoute(request(form(false)))).headers.get('location'), /recurring=disabled$/);
  assert.equal(calls[0].args.p_enabled, false);
  calls = []; assert.match((await squareDirectRecurringRoute(request())).headers.get('location'), /recurring=unavailable$/); assert.equal(calls.length, 0);
});
test('Square bad origins, spoofed authority, missing confirmation, duplicates and oversized forms cannot change consent', async () => {
  reset(); assert.equal((await squareDirectRecurringRoute(request(undefined, { origin: 'https://untrusted.invalid' }))).status, 403);
  assert.equal(authCalls, 0);
  for (const body of [{ ...form(true), confirmation: '' }, { ...form(true), workspaceId: ids.workspace }, { ...form(true), connectionId: 'bad' },
    new URLSearchParams(form(true)).toString() + '&enabled=false', 'x='.padEnd(2048, 'x')]) {
    await assert.rejects(directForm('recurring-settings', request(body)));
    await squareDirectRecurringRoute(request(body));
  }
  assert.equal(calls.length, 0);
});
test('Square failed saves remain recoverable and never display database diagnostics or false success', async () => {
  reset();
  for (const result of [{ data: { ...status, recurring_enabled: false }, error: null }, { data: null, error: { message: 'private backend failure' } }]) {
    databaseData = result.data; databaseError = result.error;
    const response = await squareDirectRecurringRoute(request()); assert.match(response.headers.get('location'), /recurring=unavailable$/);
    assert(!response.headers.get('location').includes('private'));
  }
});
