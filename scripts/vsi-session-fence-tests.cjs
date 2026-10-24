/* eslint-disable @typescript-eslint/no-require-imports -- Isolated storage contract tests; no network, database or credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { z } = require('zod');

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/vsi/storage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true
});
assert.deepEqual(source.diagnostics || [], []);

function fixture() {
  const state = {
    user: { id: userId, email: 'synthetic@example.test' },
    claims: { data: { claims: { sub: userId, session_id: sessionId } }, error: null },
    context: { activeWorkspace: { id: workspaceId }, membership: { status: 'active', role: 'owner' } },
    allowedOrigin: true, entitled: true, adminAvailable: true,
    rpcError: null, rpcCalls: [], claimsCalls: 0
  };
  const supabase = { auth: {
    getUser: async () => ({ data: { user: state.user } }),
    getClaims: async () => { state.claimsCalls++; return state.claims; }
  } };
  const mocks = {
    'server-only': {}, crypto: require('node:crypto'), zod: { z },
    '@/lib/integrations/google-sheets/read-authority': {},
    './summary': {},
    './failure-accounting-gate': { vsiFailureAccountingEnabled: () => false },
    '@/lib/ai/evidence-engine/hash': { evidenceEngineHash: value => JSON.stringify(value) },
    '@/lib/billing/get-subscription-status': { getSubscriptionStatus: async () => ({ allowed: state.entitled }) },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => supabase },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => state.adminAvailable ? {
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        return { data: { accepted: true }, error: state.rpcError };
      }
    } : null },
    '@/lib/workspaces/current': { getWorkspaceContext: async () => state.context },
    '@/lib/ai/business-notes/release-channel': {},
    '@/lib/ai/business-notes/validation': {},
    '@/lib/vsi/request-boundary': { isVsiRequestOriginAllowed: () => state.allowedOrigin },
    '@/lib/vsi/sensitive-input': {}
  };
  const loaded = { exports: {} };
  new Function('exports', 'require', 'module', source.outputText)(loaded.exports, name => {
    assert(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  }, loaded);
  const access = () => loaded.exports.requireVsiAccess(
    new Request('https://example.test/api/vsi/conversations', { method: 'POST' }), workspaceId
  );
  return { state, access, ...loaded.exports };
}

test('verified actor claims supply a server-only session for all existing workspace roles', async () => {
  for (const role of ['owner', 'admin', 'manager', 'staff', 'viewer']) {
    const f = fixture();
    f.state.context.membership.role = role;
    const access = await f.access();
    assert.equal(access.sessionId, sessionId);
    assert.equal(access.userId, userId);
    assert.equal(access.workspaceId, workspaceId);
    assert.equal(access.canEditBusinessNotes, role !== 'viewer');
    assert.equal(f.state.claimsCalls, 1);
    assert.deepEqual(f.state.rpcCalls, []);
  }
});

test('unverified, missing, malformed, or mismatched claims fail closed before mutations', async () => {
  const variants = [
    { data: null, error: null },
    { data: { claims: { sub: userId } }, error: null },
    { data: { claims: { sub: userId, session_id: 'not-a-uuid' } }, error: null },
    { data: { claims: { sub: userId, session_id: 123 } }, error: null },
    { data: { claims: { sub: otherId, session_id: sessionId } }, error: null },
    { data: { claims: { sub: userId, session_id: sessionId } }, error: { message: 'verification failed' } }
  ];
  for (const claims of variants) {
    const f = fixture(); f.state.claims = claims;
    await assert.rejects(f.access(), error => error.status === 401 && error.code === 'authentication_required');
    assert.deepEqual(f.state.rpcCalls, []);
  }
  const f = fixture(); f.state.user = null;
  await assert.rejects(f.access(), error => error.status === 401);
  assert.equal(f.state.claimsCalls, 0);
});

test('origin, active workspace, membership and subscription gates remain enforced', async () => {
  for (const [change, code] of [
    [s => { s.allowedOrigin = false; }, 'origin_denied'],
    [s => { s.context.activeWorkspace.id = otherId; }, 'workspace_changed'],
    [s => { s.context.membership.status = 'removed'; }, 'workspace_changed'],
    [s => { s.entitled = false; }, 'subscription_required']
  ]) {
    const f = fixture(); change(f.state);
    await assert.rejects(f.access(), error => error.code === code);
    assert.deepEqual(f.state.rpcCalls, []);
  }
});

test('every mutation uses v2 with the verified session in its separate required argument', async () => {
  const f = fixture(); const access = await f.access();
  for (const action of ['create', 'reserve', 'settle', 'usage', 'rename', 'delete', 'continue', 'remember']) {
    const input = { conversationId: otherId, p_session_id: otherId };
    assert.deepEqual(await f.mutateVsi(access, action, input), { accepted: true });
    assert.deepEqual(f.state.rpcCalls.at(-1), {
      name: 'vsi_mutate_v2', args: {
        p_workspace_id: workspaceId, p_actor_user_id: userId,
        p_action: action, p_input: input, p_session_id: sessionId
      }
    });
  }
});

test('a database session rejection after reservation does not retry or fall back to v1', async () => {
  const f = fixture(); const access = await f.access();
  await f.mutateVsi(access, 'reserve', { conversationId: otherId });
  f.state.rpcError = { code: '42501', message: 'live session rejected' };
  await assert.rejects(f.mutateVsi(access, 'settle', { conversationId: otherId }),
    error => error.status === 403 && error.code === 'access_denied');
  assert.deepEqual(f.state.rpcCalls.map(call => [call.name, call.args.p_action]),
    [['vsi_mutate_v2', 'reserve'], ['vsi_mutate_v2', 'settle']]);
});

test('missing v2 fails closed without exposing database details or using v1', async () => {
  const f = fixture(); const access = await f.access();
  f.state.rpcError = { code: 'PGRST202', message: 'PRIVATE_DETAIL', details: 'PRIVATE_DETAIL' };
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    await assert.rejects(f.mutateVsi(access, 'create'), error =>
      error.status === 503 && error.code === 'storage_unavailable' && !error.message.includes('PRIVATE_DETAIL'));
  } finally { console.error = original; }
  assert.equal(f.state.rpcCalls.length, 1);
  assert.equal(f.state.rpcCalls[0].name, 'vsi_mutate_v2');
  assert.deepEqual(logs, [['[vsi-storage]', { action: 'create', code: 'PGRST202' }]]);
});
