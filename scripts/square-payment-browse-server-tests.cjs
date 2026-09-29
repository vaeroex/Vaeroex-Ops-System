/* eslint-disable @typescript-eslint/no-require-imports -- Test actual server/page code with non-network identity and database capabilities. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const test = require('node:test'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const ids = { actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', session: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspace: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', connection: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
let membershipRole = 'owner', membershipUser = ids.actor, claimsSub = ids.actor, claimsError = null;
let databaseError = null, databaseData = null, calls = [];
let pageBrowseError = false, pageHost = 'www.vaeroex.com', pageQuery;
const view = { available: true, historyAvailable: true, businessEntities: [], connections: [] };
const result = { connectionId: null, currentConnection: null, timeZone: 'UTC', page: 1, pageSize: 25, totalCount: 0, totalPages: 1,
  filters: { startDate: null, endDate: null, status: 'all' }, payments: [], connections: [] };
const mocks = {
  '@/lib/security/require-auth': { requireAuth: async () => ({ user: { id: ids.actor }, supabase: { auth: {
    getClaims: async () => ({ error: claimsError, data: { claims: { sub: claimsSub, session_id: ids.session } } })
  } } }) },
  '@/lib/security/get-current-workspace': { getCurrentWorkspace: async (...args) => {
    assert.equal(args.length, 0, 'selected workspace comes from verified server context, never query parameters');
    return { workspaceId: ids.workspace, membership: { role: membershipRole, user_id: membershipUser } };
  } },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ rpc: async (name, payload) => {
    calls.push({ name, payload }); return { data: databaseData ?? result, error: databaseError };
  } }) },
};
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (Object.hasOwn(mocks, request)) return mocks[request];
  return load.call(this, request, parent, isMain);
};
const { squareDirectPayments } = require('../lib/integrations/square-direct/server.ts');
process.env.NODE_ENV = 'production'; process.env.VERCEL_ENV = 'production'; process.env.SQUARE_CUSTOMER_BACKEND_ENABLED = 'true';
// No application secret, encryption key, seller credential or network request is necessary to browse.
delete process.env.SQUARE_CUSTOMER_APPLICATION_SECRET; delete process.env.SQUARE_CUSTOMER_ENCRYPTION_KEY;
global.fetch = async () => { throw Error('unexpected_provider_or_network_request'); };

test('saved browsing sends only the verified current owner/session/workspace and validated filters to the read-only RPC', async () => {
  calls = [];
  assert.deepEqual(await squareDirectPayments({ connectionId: ids.connection, page: '7', startDate: '2026-05-04', endDate: '2026-05-06', status: 'COMPLETED',
    workspaceId: 'attacker', actorId: 'attacker', sessionId: 'attacker', timeZone: 'attacker', pageSize: '1000' }), result);
  assert.deepEqual(calls, [{ name: 'square_customer_payments_v1', payload: {
    p_actor_id: ids.actor, p_session_id: ids.session, p_workspace_id: ids.workspace,
    p_connection_id: ids.connection, p_page: 7, p_start_date: '2026-05-04', p_end_date: '2026-05-06', p_status: 'COMPLETED'
  } }]);
});
test('invalid filters and unverified owner context make no database or provider call', async () => {
  for (const query of [{ page: '0' }, { page: ['1', '2'] }, { startDate: '2026-02-30' }, { status: 'anything' }, { connectionId: 'invalid' }]) {
    calls = []; await assert.rejects(() => squareDirectPayments(query)); assert.equal(calls.length, 0);
  }
  for (const kind of ['member', 'foreign-member', 'foreign-claims', 'claims-error']) {
    membershipRole = kind === 'member' ? 'member' : 'owner'; membershipUser = kind === 'foreign-member' ? 'foreign' : ids.actor;
    claimsSub = kind === 'foreign-claims' ? 'foreign' : ids.actor; claimsError = kind === 'claims-error' ? {} : null;
    calls = []; await assert.rejects(() => squareDirectPayments({})); assert.equal(calls.length, 0);
  }
  membershipRole = 'owner'; membershipUser = ids.actor; claimsSub = ids.actor; claimsError = null;
});
test('disabled capability and missing/invalid browse RPC fail without a mutation fallback', async () => {
  process.env.SQUARE_CUSTOMER_BACKEND_ENABLED = 'false'; calls = [];
  assert.equal(await squareDirectPayments({}), null); assert.equal(calls.length, 0);
  process.env.SQUARE_CUSTOMER_BACKEND_ENABLED = 'true'; databaseError = { code: 'PGRST202' };
  await assert.rejects(() => squareDirectPayments({}), /square_customer_payment_browse_unavailable/);
  databaseError = null; databaseData = { ...result, ciphertext: 'must-not-render' };
  await assert.rejects(() => squareDirectPayments({})); databaseData = null;
});

mocks['next/headers'] = { headers: async () => new Headers({ host: pageHost, 'x-forwarded-proto': 'https' }) };
mocks['next/navigation'] = { notFound: () => { throw Error('not_found'); } };
mocks['@/components/integrations/SquareDirectCustomerPanel'] = { SquareDirectCustomerPanel: function Panel() {} };
mocks['@/components/integrations/SquareConnectionPanel'] = {};
mocks['@/components/integrations/SquareProductionCustomerPanel'] = {};
mocks['@/lib/integrations/control-plane/square-production-customer'] = {};
mocks['@/lib/integrations/control-plane/square-customer-availability'] = {};
mocks['@/lib/integrations/square-direct/server'] = {
  squareDirectEnabled: () => true, squareDirectView: async () => view,
  squareDirectPayments: async params => { pageQuery = params; if (pageBrowseError) throw Error('private_database_error'); return result; }
};
const Page = require('../app/(square-connection)/app/settings/integrations/square/page.tsx').default;
test('page awaits GET filters and retains connection controls when browsing fails, without exposing diagnostics', async () => {
  const element = await Page({ searchParams: Promise.resolve({ page: '4', status: 'FAILED' }) });
  assert.deepEqual(pageQuery, { page: '4', status: 'FAILED' }); assert.equal(element.props.browser, result); assert.equal(element.props.view, view);
  pageBrowseError = true;
  const fallback = await Page({ searchParams: Promise.resolve({ page: 'bad' }) });
  assert.equal(fallback.props.view, view); assert.equal(fallback.props.browser, null);
  assert.match(fallback.props.browseError, /connection and saved records are unchanged/);
  assert.doesNotMatch(fallback.props.browseError, /private_database_error/); pageBrowseError = false;
  pageHost = 'untrusted.invalid'; await assert.rejects(() => Page({ searchParams: Promise.resolve({}) }), /not_found/);
});

test('the existing Settings workspace resolver preserves the selected workspace cookie on direct navigation', async () => {
  const other = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const memberships = [other, ids.workspace].map(workspaceId => ({ workspace_id: workspaceId, user_id: ids.actor,
    status: 'active', role: 'owner', workspaces: { id: workspaceId, name: workspaceId === ids.workspace ? 'Selected workspace' : 'Other workspace' } }));
  mocks['next/headers'].cookies = async () => ({ get: name => name === 'vaeroex_workspace_id' ? { value: ids.workspace } : undefined });
  mocks['@/lib/admin/admin-emails'] = { isVaeroexAdminUser: () => false };
  mocks['@/lib/workspaces/demo-compatibility'] = { isDemoWorkspaceRecord: () => false };
  mocks['@/lib/supabase/server'] = { createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ids.actor } } }) },
    from: name => { const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: null }), order: async () => ({ data: name === 'workspace_members' ? memberships : null }) }; return query; }
  }) };
  const { getWorkspaceContext } = require('../lib/workspaces/current.ts');
  const context = await getWorkspaceContext();
  assert.equal(context.activeWorkspace.id, ids.workspace); assert.equal(context.membership.role, 'owner');
  assert.notEqual(context.activeWorkspace.id, other, 'same-origin Settings link must not reset to first membership');
});
