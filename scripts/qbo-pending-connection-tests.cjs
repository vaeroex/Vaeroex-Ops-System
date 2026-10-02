/* Actual repository and cancel route, with only session/database I/O replaced. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { installLoader } = require('./qbo-customer-test-support.cjs');
const workspace = randomUUID(), entity = randomUUID(), connectionId = randomUUID();
let role = 'owner', calls = [], filters = [], fail = false, result;
const client = {
  from(table) {
    assert.equal(table, 'integration_connection_summaries');
    return { select(columns) {
      assert.equal(columns, 'id,row_version');
      const query = { eq(column, value) { filters.push([column, value]); return query; },
        async maybeSingle() { return { data: { id: connectionId, row_version: 7 }, error: null }; } };
      return query;
    } };
  },
  async rpc(name, args) {
    calls.push({ name, args });
    return fail ? { data: null, error: { code: '42501', message: 'private-provider-diagnostic' } } : { data: result, error: null };
  }
};
installLoader({ '@/lib/security/require-workspace-access': { requireWorkspaceAccess: async () => ({
  workspaceId: workspace, membership: { role }, supabase: client
}) } });
global.fetch = () => { throw Error('Provider/network calls are forbidden'); };
const { integrationConnectionIntentCommand, createIntegrationConnectionIntent } = require('../lib/integrations/persistence/control-plane-repository.ts');
const { beginQboCustomerConnection, cancelQboCustomerPendingConnection } = require('../lib/integrations/persistence/qbo-pending-connection-repository.ts');
const { POST } = require('../app/api/integrations/qbo/cancel/route.ts');
const input = { connection: { id: connectionId, workspaceId: workspace, businessEntityId: entity,
  providerKey: 'quickbooks_online', providerEnvironment: 'production', safeDisplayName: 'Main company',
  requestedScopes: ['com.intuit.quickbooks.accounting'], requestedAt: new Date().toISOString() },
  oauthState: { stateId: randomUUID(), stateHash: 'sha256:' + 'a'.repeat(64), redirectUri: 'https://integrations.vaeroex.com/oauth/callback',
    returnIntent: '/app/settings', requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }, requestId: 'atomic_start' };
const command = integrationConnectionIntentCommand(input.connection);
const summary = { contractVersion: 'integration_connection_summary_v1', id: connectionId, workspaceId: workspace,
  businessEntityId: entity, providerKey: 'quickbooks_online', providerEnvironment: 'production',
  safeDisplayName: 'Main company', status: 'pending_authorization', stateReasonCode: 'authorization_pending',
  requestedScopes: input.connection.requestedScopes, grantedScopes: [], capabilitySnapshot: command.capabilitySnapshot,
  adapterVersion: command.adapterVersion, configurationVersion: 1, connectionGeneration: 1,
  statusChangedAt: new Date().toISOString(), disconnectedAt: null, rowVersion: 1 };
const started = { connection: summary, oauthState: { stateId: input.oauthState.stateId, connectionId,
  connectionGeneration: 1, expiresAt: input.oauthState.expiresAt, idempotent: false }, disposition: 'started', idempotent: false };
const cancelled = { connection: { ...summary, status: 'disconnected', stateReasonCode: 'disconnected',
  disconnectedAt: new Date().toISOString(), rowVersion: 8 }, idempotent: false };
function reset() { calls = []; filters = []; fail = false; role = 'owner'; result = cancelled;
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = 'true'; process.env.QBO_APPLICATION_ORIGIN = 'https://app.vaeroex.com'; }
function request(values = {}, { json = false, origin = 'https://app.vaeroex.com', raw } = {}) {
  const body = { connectionId, confirmation: 'cancel', ...values };
  return new Request('https://app.vaeroex.com/api/integrations/qbo/cancel', { method: 'POST', headers: {
    origin, 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded',
    accept: json ? 'application/json' : 'text/html' }, body: raw ?? (json ? JSON.stringify(body) : new URLSearchParams(body)) });
}
test('atomic helper builds existing canonical commands and performs exactly one checked RPC', async () => {
  reset(); result = started; assert.deepEqual(await beginQboCustomerConnection(input, client), started);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'begin_qbo_customer_connection_v1');
  assert.deepEqual(calls[0].args.p_connection, command);
  assert.deepEqual(calls[0].args.p_oauth_state, { ...input.oauthState, contractVersion: 'qbo_customer_oauth_state_v2',
    connectionId, expectedConnectionGeneration: 1, expectedConnectionRowVersion: 1, requestedScopes: input.connection.requestedScopes });
});
test('legacy intent helper preserves its original RPC and command', async () => {
  reset(); result = { connection: summary, idempotent: false };
  await createIntegrationConnectionIntent(input.connection, client);
  assert.deepEqual(calls, [{ name: 'create_integration_connection_intent_v1', args: { p_command: command } }]);
});
test('duplicate disposition returns the existing identity and no OAuth state', async () => {
  reset(); result = { connection: { ...summary, id: randomUUID() }, oauthState: null, disposition: 'pending', idempotent: true };
  assert.deepEqual(await beginQboCustomerConnection(input, client), result); assert.equal(calls.length, 1);
});
test('malformed input never reaches RPC and inconsistent scope/state results fail closed', async () => {
  reset(); await assert.rejects(beginQboCustomerConnection({ ...input, oauthState: { ...input.oauthState, stateHash: 'bad' } }, client));
  assert.equal(calls.length, 0);
  for (const wrong of [ { ...started, connection: { ...summary, workspaceId: randomUUID() } },
    { ...started, oauthState: { ...started.oauthState, stateId: randomUUID() } },
    { ...started, connection: { ...summary, businessEntityId: randomUUID() } },
    { ...started, oauthState: { ...started.oauthState, connectionGeneration: 2 } } ]) {
    result = wrong; await assert.rejects(beginQboCustomerConnection(input, client), /binding_invalid/);
  }
});
test('native cancel uses session workspace and queried CAS then same-origin 303', async () => {
  reset(); const response = await POST(request()); assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://app.vaeroex.com/app/settings/integrations/quickbooks?result=cancelled');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(filters, [['workspace_id', workspace], ['id', connectionId], ['provider_key', 'quickbooks_online'], ['provider_environment', 'production']]);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'cancel_qbo_customer_pending_connection_v1');
  assert.equal(calls[0].args.p_workspace_id, workspace); assert.equal(calls[0].args.p_expected_row_version, 7);
});
test('cancel requires confirmation and owner; caller tenant/CAS, wrong origin and oversized payload are rejected', async () => {
  for (const [values, options, member] of [[{ confirmation: 'disconnect' }, {}, 'owner'], [{ workspaceId: randomUUID() }, {}, 'owner'],
    [{ expectedRowVersion: 1 }, {}, 'owner'], [{}, { origin: 'https://attacker.example' }, 'owner'],
    [{}, { raw: 'x'.repeat(1025) }, 'owner'], [{}, {}, 'manager']]) {
    reset(); role = member; const response = await POST(request(values, options));
    assert.equal(response.status, 303); assert.match(response.headers.get('location'), /\?error=cancel_failed$/);
    assert.equal(calls.length, 0);
  }
});
test('database denial is bounded for native/JSON clients and no diagnostics escape', async () => {
  for (const json of [false, true]) {
    reset(); fail = true; const response = await POST(request({}, { json }));
    assert.equal(response.status, json ? 400 : 303); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private-provider-diagnostic|42501/);
  }
});
test('cancel result must match session workspace, exact connection and terminal status', async () => {
  const cancelInput = { workspaceId: workspace, connectionId, expectedRowVersion: 7, requestId: 'cancel_test' };
  for (const change of [{ workspaceId: randomUUID() }, { id: randomUUID() }, { status: 'pending_authorization' }]) {
    reset(); result = { ...cancelled, connection: { ...cancelled.connection, ...change } };
    await assert.rejects(cancelQboCustomerPendingConnection(cancelInput, client), /binding_invalid/);
  }
});
test('disabled feature gate stops all lookup and persistence work', async () => {
  reset(); process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = 'false';
  assert.equal((await POST(request())).status, 404); assert.deepEqual(filters, []); assert.deepEqual(calls, []);
});
