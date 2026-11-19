/* eslint-disable @typescript-eslint/no-require-imports -- Actual handlers with synthetic workspace and database authority. */
const { test } = require('node:test'), assert = require('node:assert/strict');
const { loadSource } = require('./integrations-ui-test-support');
const workspace = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const connection = '33333333-3333-4333-8333-333333333333';
const providers = ['loyverse', 'zoho-books', 'wix-orders'];
function harness(provider) {
  const calls = [], state = { role: 'owner', available: true, scope: true, result: { data: true, error: null }, authCalls: 0 };
  const mocks = {
    '@/lib/security/require-workspace-access': { requireWorkspaceAccess: async () => {
      state.authCalls++; return { workspaceId: workspace, user: { id: actor }, membership: { role: state.role } };
    } },
    '@/lib/integrations/reporting/security': { ...loadSource('lib/integrations/reporting/security.ts'),
      admin: () => ({ async rpc(name, args) { calls.push({ name, args }); return state.result; } }) },
    './scope': { importRecurringAllowed: (scopeWorkspace, scopeProvider) => {
      assert.equal(scopeWorkspace, workspace); assert.equal(scopeProvider, provider); return state.scope;
    } },
    ...Object.fromEntries(providers.map(name => [`@/lib/integrations/${name}/server`, { enabled: () => state.available }]))
  };
  const { POST } = loadSource(`app/api/integrations/${provider}/recurring-settings/route.ts`, mocks);
  const data = { connectionId: connection, enabled: 'true', confirmation: 'enable-recurring' };
  function request(body = data, headers = {}) {
    return new Request(`https://www.vaeroex.com/api/integrations/${provider}/recurring-settings`, { method: 'POST',
      headers: { host: 'www.vaeroex.com', origin: 'https://www.vaeroex.com', 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: typeof body === 'string' ? body : new URLSearchParams(body) });
  }
  return { POST, calls, state, data, request };
}
for (const provider of providers) {
  test(`${provider}: explicit confirmed owner setting uses server actor/workspace and fixed provider only`, async () => {
    const h = harness(provider);
    assert.match((await h.POST(h.request())).headers.get('location'), /recurring_enabled$/);
    assert.deepEqual(h.calls, [{ name: 'set_import_recurring', args: { p_workspace: workspace, p_provider: provider,
      p_connection: connection, p_actor: actor, p_enabled: true } }]);
    h.state.available = false; h.state.scope = false;
    assert.match((await h.POST(h.request({ ...h.data, enabled: 'false', confirmation: 'disable-recurring' }))).headers.get('location'), /recurring_disabled$/);
    assert.equal(h.calls.at(-1).args.p_enabled, false, 'saved consent can be turned off without provider configuration');
  });
  test(`${provider}: origin, role, form and rollout failures never mutate`, async () => {
    const h = harness(provider);
    await h.POST(h.request(undefined, { origin: 'https://untrusted.invalid' }));
    assert.equal(h.state.authCalls, 0); assert.deepEqual(h.calls, []);
    for (const role of ['viewer', 'admin']) { h.state.role = role; await h.POST(h.request()); }
    assert.deepEqual(h.calls, []); h.state.role = 'owner';
    for (const body of [{ ...h.data, confirmation: '' }, { ...h.data, enabled: 'sometimes' }, { ...h.data, workspaceId: 'another-workspace' },
      { ...h.data, connectionId: 'invalid' }, new URLSearchParams(h.data).toString() + '&enabled=false']) await h.POST(h.request(body));
    assert.deepEqual(h.calls, []);
    h.state.scope = false;
    assert.match((await h.POST(h.request())).headers.get('location'), /recurring_configuration_required$/);
    assert.deepEqual(h.calls, []);
    h.state.scope = true; h.state.available = false;
    await h.POST(h.request()); assert.deepEqual(h.calls, []);
  });
  test(`${provider}: missing or failed database authority returns a recoverable generic result`, async () => {
    const h = harness(provider);
    for (const result of [{ data: false, error: null }, { data: null, error: { message: 'private backend diagnostic', code: 'TEST' } }]) {
      h.state.result = result;
      const response = await h.POST(h.request());
      assert.match(response.headers.get('location'), /recurring_error$/);
      assert(!response.headers.get('location').includes('private'));
    }
  });
}
