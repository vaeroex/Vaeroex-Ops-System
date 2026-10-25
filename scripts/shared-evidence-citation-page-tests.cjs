/* eslint-disable @typescript-eslint/no-require-imports -- Authenticated synthetic page harness; real guards, PostgREST builder and SSR, no external service. */
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { renderToStaticMarkup } = require('react-dom/server');
const { createClient } = require('@supabase/supabase-js');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');

const workspace = id(1), actor = id(2), artifact = id(3), revision = 'a'.repeat(64);
const state = { enabled: true, user: actor, workspace, role: 'owner', memberStatus: 'active', subscribed: true,
  mode: 'success', rpcCalls: 0, authCalls: 0, aborted: 0, networkCalls: 0 };
global.fetch = () => { state.networkCalls++; throw new Error('unmocked_network_forbidden'); };
require('node:net').Socket.prototype.connect = global.fetch;
const projections = ['xero', 'google_sheets', 'google_sheets'].map((provider, index) => ({
  identity: provider === 'xero' ? { kind: 'legacy_reference', reference_id: id(20) }
    : { kind: 'sheets_ticket_source', source_id: id(20 + index), version_id: id(30 + index) },
  hash: String(index + 1).repeat(64),
  data: { provider, workspace_id: workspace, observations: `Synthetic original ${index}: <script>not executable</script>`,
    eligibility: { private: 'DO_NOT_DISPLAY' }, read_sources: [{ table: 'synthetic_roots', id: id(40 + index) }] }
}));
const packet = { stage: 'revalidated_saved_evidence', artifact_kind: 'vsi_exchange', artifact_id: artifact,
  artifact_revision: revision, projections };
const transport = async (url, options) => {
  state.rpcCalls++;
  assert.equal(new URL(url).origin, 'https://citation-fixture.invalid');
  assert.equal(options.method, 'POST');
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-authenticated-owner-session');
  const args = JSON.parse(options.body);
  const exact = new URL(url).pathname.endsWith('/reopen_shared_evidence_artifact_v1');
  assert.equal(new URL(url).pathname, `/rest/v1/rpc/reopen_shared_evidence_${exact ? 'artifact' : 'target'}_v1`);
  assert.deepEqual(args, { p_workspace_id: workspace, p_artifact_kind: 'vsi_exchange', p_artifact_id: artifact,
    ...(exact ? { p_expected_revision: revision } : {}) });
  if (state.mode === 'stall' || state.mode === 'ignore_abort') {
    const ignoreAbort = state.mode === 'ignore_abort';
    return new Promise((_, reject) => options.signal?.addEventListener('abort', () => {
      state.aborted++;
      if (!ignoreAbort) reject(new DOMException('Synthetic interrupted read', 'AbortError'));
    }, { once: true }));
  }
  if (['revoked', 'other_owner', 'expired_session'].includes(state.mode)) return new Response(JSON.stringify({ code: '42501', message: 'PRIVATE_AUTHORITY_DETAIL' }), { status: 403 });
  if (state.mode === 'changed_source') return new Response(JSON.stringify({ code: '40001', message: 'PRIVATE_HASH_DETAIL' }), { status: 409 });
  const result = structuredClone(packet);
  if (state.mode === 'foreign_projection') result.projections[0].data.workspace_id = id(99);
  if (state.mode === 'wrong_revision') result.artifact_revision = 'f'.repeat(64);
  if (state.mode === 'malformed') result.stage = 'unadmitted';
  return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
};
const rpcClient = createClient('https://citation-fixture.invalid', 'synthetic-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: transport, headers: { Authorization: 'Bearer synthetic-authenticated-owner-session' } }
});
const client = {
  auth: { getUser: async () => { state.authCalls++; return { data: { user: state.user ? { id: state.user, email: 'owner@fixture.invalid' } : null }, error: null }; } },
  rpc: rpcClient.rpc.bind(rpcClient),
  from(table) {
    const filters = [];
    const query = { then(resolve) {
      let data;
      if (table === 'profiles') {
        assert(filters.some(([key, value]) => key === 'id' && value === state.user));
        data = { id: state.user, email: 'owner@fixture.invalid' };
      } else if (table === 'workspace_members') {
        assert(filters.some(([key, value]) => key === 'user_id' && value === state.user));
        assert(filters.some(([key, value]) => key === 'status' && value === 'active'));
        data = state.memberStatus === 'active' ? [{ workspace_id: state.workspace, user_id: state.user, role: state.role, status: state.memberStatus,
          workspaces: { id: state.workspace, name: 'Synthetic workspace', subscription_status: 'active', subscription_required: false } }] : [];
      } else if (table === 'workspaces') {
        assert(filters.some(([key, value]) => key === 'id' && value === state.workspace));
        data = { id: state.workspace, subscription_status: 'active', subscription_required: !state.subscribed };
      } else if (table === 'customer_subscriptions') data = [];
      else throw new Error(`unexpected_auth_table:${table}`);
      return resolve({ data, error: null });
    } };
    for (const method of ['select', 'order', 'or', 'maybeSingle']) query[method] = () => query;
    query.eq = (key, value) => { filters.push([key, value]); return query; };
    return query;
  }
};
installLoader({
  'server-only': {},
  'next/navigation': { notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: url => { throw new Error(`NEXT_REDIRECT:${url}`); } },
  'next/headers': { cookies: async () => ({ get: key => key === 'vaeroex_workspace_id' ? { value: state.workspace } : undefined }) },
  '@/lib/supabase/server': { createSupabaseServerClient: async () => client },
  '@/lib/admin/admin-emails': { isVaeroexAdminUser: () => false, isVaeroexAdminEmail: () => false },
  '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => state.enabled }
});
const Page = require('../app/app/sources/evidence/[kind]/[id]/page.tsx').default;
const { sharedCitationHref } = require('../lib/ai/shared-evidence/citation-reopen.ts');
const page = (query = {}) => Page({ params: Promise.resolve({ kind: 'vsi_exchange', id: artifact }), searchParams: Promise.resolve({ workspace, ...query }) });
const html = async query => renderToStaticMarkup(await page(query));
async function blocked(change, pattern) {
  const before = state.rpcCalls, previous = { ...state }; Object.assign(state, change);
  try { await assert.rejects(page(), pattern); assert.equal(state.rpcCalls, before); }
  finally { Object.assign(state, previous, { authCalls: state.authCalls }); }
}

(async () => {
  const beforePacket = JSON.stringify(packet);
  for (const query of [{}, { revision }]) {
    const rendered = await html(query);
    assert.match(rendered, /Saved evidence/);
    for (const source of projections) {
      assert(rendered.includes(`id="source-${source.hash}"`));
      assert(rendered.includes(`<h2 class="font-semibold">${source.data.provider}</h2>`));
    }
    assert.match(rendered, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assert.doesNotMatch(rendered, /<script>|DO_NOT_DISPLAY|read_sources|Loading Vaeroex module/);
  }
  const target = { workspaceId: workspace, kind: 'vsi_exchange', id: artifact };
  for (const source of [projections[0], projections[1]]) {
    const link = new URL(`${sharedCitationHref(target)}#source-${source.hash}`, 'https://fixture.invalid');
    assert.equal(link.pathname, `/app/sources/evidence/vsi_exchange/${artifact}`);
    assert.equal(link.searchParams.get('workspace'), workspace);
    assert.equal(link.hash, `#source-${source.hash}`);
  }
  assert.equal(JSON.stringify(packet), beforePacket);
  const beforeInvalid = state.rpcCalls;
  await assert.rejects(html({ workspace: '../foreign' }), /NEXT_NOT_FOUND/);
  await assert.rejects(html({ revision: 'not-a-hash' }), /NEXT_NOT_FOUND/);
  assert.equal(state.rpcCalls, beforeInvalid);
  await blocked({ user: null }, /NEXT_REDIRECT:\/login/);
  await blocked({ workspace: id(99) }, /NEXT_NOT_FOUND/);
  await blocked({ role: 'admin' }, /NEXT_NOT_FOUND/);
  await blocked({ memberStatus: 'inactive' }, /NEXT_REDIRECT:\/app\/setup/);
  await blocked({ subscribed: false }, /NEXT_REDIRECT:\/billing-required/);
  const beforeDisabledAuth = state.authCalls;
  await blocked({ enabled: false }, /NEXT_NOT_FOUND/);
  assert.equal(state.authCalls, beforeDisabledAuth);
  for (const mode of ['revoked', 'other_owner', 'expired_session', 'changed_source', 'foreign_projection', 'wrong_revision', 'malformed']) {
    state.mode = mode; const before = state.rpcCalls;
    const rendered = await html({ revision });
    assert.match(rendered, /Source unavailable/);
    assert.match(rendered, /could not be checked right now/);
    assert.doesNotMatch(rendered, /Saved evidence|Synthetic original|PRIVATE_|source-[123]/);
    assert.equal(state.rpcCalls, before + 1, 'one checked read; no retries');
  }
  for (const mode of ['stall', 'ignore_abort']) {
    state.mode = mode; const before = state.rpcCalls, beforeAbort = state.aborted;
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let settled = false;
      const pending = html().then(value => { settled = true; return value; });
      for (let turn = 0; state.rpcCalls === before && turn < 50; turn++) await nextTurn();
      assert.equal(state.rpcCalls, before + 1, 'real PostgREST builder reached the synthetic transport');
      assert.equal(settled, false);
      mock.timers.tick(10_000);
      await nextTurn();
      assert.equal(settled, true, 'the page must settle by the deadline when its citation read stalls');
      const rendered = await pending;
      assert.match(rendered, /Source unavailable/);
    assert.match(rendered, /could not be checked right now/);
      assert.doesNotMatch(rendered, /Saved evidence|Synthetic original|Loading Vaeroex module/);
      assert.equal(state.aborted, beforeAbort + 1, 'timeout aborts the real PostgREST request');
      assert.equal(state.rpcCalls, before + 1, 'timeout cannot retry or substitute another original');
    } finally { mock.timers.reset(); }
  }
  state.mode = 'success';
  assert.match(await html(), /Saved evidence/, 'a subsequent page invocation performs a fresh authorized read');
  assert.equal(state.networkCalls, 0);
  console.log(JSON.stringify({ passed: true, actualPageAndSSR: true, actualAuthWorkspaceSubscriptionGuards: true,
    actualPostgrestAbort: true, authorizedProviderSections: ['xero', 'google_sheets'], unavailableCases: 7, stalledCases: 2,
    authorizationAndGateNegatives: 8, rpcCalls: state.rpcCalls, rpcDeadlineMs: 10000, retries: 0, externalCalls: 0,
    liveDatabaseOrHostedRootCauseProved: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
