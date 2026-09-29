/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the actual TypeScript with synthetic persistence/provider capabilities. */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const load = Module._load;
Module._load = function(request, parent, isMain) {
  // Boundary tests cannot authenticate or reach a database.
  if (['@/lib/supabase/admin', '@/lib/security/require-auth', '@/lib/security/get-current-workspace'].includes(request))
    return new Proxy({}, { get() { return () => { throw Error('unexpected_live_capability'); }; } });
  return load.call(this, request, parent, isMain);
};
const { createDirectSquareService } = require('../lib/integrations/square-direct/service.ts');
const { sealCredential, openCredential } = require('../lib/integrations/square-direct/crypto.ts');
const { directCallbackUri } = require('../lib/integrations/square-direct/provider.ts');
const { DirectViewSchema } = require('../lib/integrations/square-direct/contracts.ts');
const { directRequestAllowed, directForm, squareDirectRoute } = require('../lib/integrations/square-direct/server.ts');
const { SQUARE_OAUTH_SCOPES } = require('../lib/integrations/providers/square/account-connection-oauth.ts');
const clock = new Date('2026-09-29T12:00:00.000Z');
const origin = 'https://www.vaeroex.com';
function fixture(options = {}) {
  const actor = { workspaceId: randomUUID(), actorId: randomUUID(), sessionId: randomUUID() };
  const entity = randomUUID(), key = randomBytes(32).toString('base64'), calls = [];
  const credential = { schemaVersion: 'oauth_credential_envelope_v1', providerKey: 'square', environment: 'production',
    externalAuthorizedEntityReference: 'MERCHANT_1', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
    refreshExpiresAt: null, issuedAt: clock.toISOString(), updatedAt: clock.toISOString(),
    accessExpiresAt: '2026-09-29T12:01:00.000Z', grantedScopes: [...SQUARE_OAUTH_SCOPES] };
  let row = { connectionId: randomUUID(), workspaceId: actor.workspaceId, businessEntityId: entity,
    generation: 1, credentialVersion: 1, ciphertext: null, merchantId: 'MERCHANT_1',
    accessExpiresAt: credential.accessExpiresAt, locationId: 'LOCATION_1',
    windowStart: '2026-09-29T00:00:00+00:00', windowEnd: '2026-09-29T12:00:00+00:00',
    cursor: null, cursorBindingFingerprint: null, cursorFingerprint: null, leaseId: null, state: 'connected' };
  const aad = () => ({ workspaceId: row.workspaceId, connectionId: row.connectionId, generation: row.generation, credentialVersion: row.credentialVersion });
  row.ciphertext = sealCredential(credential, key, aad());
  let consumed = false, stateHash, pages = 0, refreshed = 0;
  const pgTime = value => value ? value.replace('.000Z', '+00:00') : value;
  const snapshot = () => ({ ...row, accessExpiresAt: pgTime(row.accessExpiresAt) });
  const rpc = async (operation, payload) => {
    calls.push({ operation, payload });
    if (options.beforeRpc) await options.beforeRpc(operation, payload, row);
    if (operation === 'begin') {
      row = { ...row, connectionId: payload.connectionId, businessEntityId: payload.businessEntityId,
        credentialVersion: 0, ciphertext: null, state: 'consent_pending' };
      stateHash = payload.stateHash; return snapshot();
    }
    if (operation === 'consume') {
      assert(!consumed && payload.stateHash === stateHash, 'one actor-bound single-use callback state');
      consumed = true; row.leaseId = payload.leaseId; row.state = 'exchanging'; return snapshot();
    }
    if (operation === 'claim') { row.leaseId = payload.leaseId; row.state = 'syncing'; return options.foreignContext ? { ...snapshot(), workspaceId: randomUUID() } : snapshot(); }
    if (operation === 'authorize' || operation === 'authorize_disconnect') {
      assert.equal(payload.leaseId, row.leaseId); assert.equal(payload.connectionId, row.connectionId);
      if (options.denyDispatch) throw Error('fenced');
      return { authorized: true };
    }
    if (operation === 'complete_connect') {
      assert.equal(payload.leaseId, row.leaseId);
      row = { ...row, ciphertext: payload.ciphertext, merchantId: payload.merchantId, accessExpiresAt: payload.accessExpiresAt,
        credentialVersion: 1, state: 'mapping_required', leaseId: null }; return { stored: true };
    }
    if (operation === 'map') { assert.equal(payload.locationId, 'LOCATION_1'); row.locationId = payload.locationId; row.state = 'connected'; return { mapped: true }; }
    if (operation === 'commit_refresh') {
      assert.equal(payload.credentialVersion, row.credentialVersion + 1);
      if (!options.refreshNotCommitted) row = { ...row, credentialVersion: payload.credentialVersion,
        ciphertext: payload.ciphertext, accessExpiresAt: payload.accessExpiresAt };
      if (options.refreshLostAck || options.refreshNotCommitted) throw Error('synthetic_lost_ack');
      return snapshot();
    }
    if (operation === 'reconcile') return snapshot();
    if (operation === 'commit_page') {
      assert.equal(payload.leaseId, row.leaseId); assert.equal(typeof payload.payments[0].amountMinor, 'string');
      if (payload.cursor === null) { assert.equal(payload.cursorBindingFingerprint, null); assert.equal(payload.cursorFingerprint, null); }
      row = { ...row, cursor: payload.cursor, cursorBindingFingerprint: payload.cursorBindingFingerprint,
        cursorFingerprint: payload.cursorFingerprint, state: 'connected', leaseId: null };
      if (options.pageLostAck) throw Error('synthetic_lost_ack');
      return { stored: true, hasMore: payload.cursor !== null };
    }
    if (operation === 'fail') {
      assert.equal(payload.leaseId, row.leaseId, 'failed/stale completion cannot overwrite committed page');
      row.state = payload.reason; row.leaseId = null; return { failed: true };
    }
    if (operation === 'disconnect') { row.state = 'disconnected'; row.leaseId = payload.leaseId; return snapshot(); }
    if (operation === 'complete_disconnect') { row.ciphertext = null; row.leaseId = null; return { disconnected: true }; }
    throw Error('unexpected_operation');
  };
  const service = createDirectSquareService({ actor, encryptionKey: key, rpc, now: () => clock, provider: authorize => ({
    authorizationUrl: state => `${directCallbackUri}?state=${state}`,
    exchange: async () => { await authorize(); calls.push({ operation: 'provider_exchange' });
      return { credential, merchantId: 'MERCHANT_1', sellerLabel: 'Shop', locations: [{ id: 'LOCATION_1', label: 'Main' }] }; },
    refresh: async old => { await authorize(); refreshed++; calls.push({ operation: 'provider_refresh' });
      return { ...old, accessToken: 'synthetic-renewed', updatedAt: clock.toISOString(), accessExpiresAt: '2026-09-30T12:00:00.000Z' }; },
    payments: async request => {
      await authorize(); pages++; calls.push({ operation: 'provider_payments', request });
      assert.equal(request.windowStart, '2026-09-29T00:00:00.000Z');
      assert.equal(request.credential.accessToken, 'synthetic-renewed');
      if (options.provider401) throw Error('square_direct_reauthorization_required');
      return { payments: [{ id: 'P1', locationId: 'LOCATION_1', status: 'COMPLETED', createdAt: clock.toISOString(), updatedAt: clock.toISOString(), amountMinor: '12345', currency: 'USD' }],
        cursor: pages === 1 ? 'synthetic-cursor' : null,
        cursorBindingFingerprint: `sha256:${'a'.repeat(64)}`, cursorFingerprint: pages === 1 ? `sha256:${'b'.repeat(64)}` : null };
    },
    revoke: async () => { assert.equal(row.state, 'disconnected'); await authorize(); calls.push({ operation: 'provider_revoke' }); if (options.revokeLostAck) throw Error('uncertain'); }
  }) });
  return { service, calls, actor, entity, credential, key, row: () => row, aad, counts: () => ({ pages, refreshed }) };
}
async function main() {
  const f = fixture(), conn = f.row().connectionId;
  await f.service.read(conn); // Actual PG +00:00 transport spelling must match encrypted Z time.
  assert.deepEqual(f.counts(), { pages: 1, refreshed: 1 });
  assert.equal(f.row().credentialVersion, 2);
  assert.equal(openCredential(f.row().ciphertext, f.key, f.aad()).accessToken, 'synthetic-renewed');
  await f.service.read(conn);
  assert.deepEqual(f.counts(), { pages: 2, refreshed: 1 }); assert.equal(f.row().cursor, null);
  await f.service.disconnect(conn); assert.equal(f.row().ciphertext, null);
  const order = f.calls.map(x => x.operation);
  assert(order.indexOf('disconnect') < order.indexOf('provider_revoke'));
  assert(order.indexOf('provider_revoke') < order.indexOf('complete_disconnect'));
  const callback = fixture(), callbackUrl = new URL(await callback.service.connect(callback.entity));
  callbackUrl.searchParams.set('code', 'never-issued-synthetic-code');
  await callback.service.callback(callbackUrl.href);
  assert.equal(callback.row().state, 'mapping_required');
  await callback.service.map(callback.row().connectionId, 'LOCATION_1');
  await assert.rejects(() => callback.service.callback(callbackUrl.href));
  assert.equal(callback.calls.filter(x => x.operation === 'provider_exchange').length, 1);
  const denied = fixture(), deniedUrl = new URL(await denied.service.connect(denied.entity));
  deniedUrl.searchParams.set('error', 'access_denied'); await denied.service.callback(deniedUrl.href);
  assert.equal(denied.row().state, 'reauthorization_required');
  assert.equal(denied.calls.filter(x => x.operation.startsWith('provider_')).length, 0);
  for (const query of ['state=s&code=c&code=d', 'state=s&code=c&error=denied', 'state=s&code=c&unexpected=x', 'state=%zz&code=c']) {
    const malformed = fixture(); await assert.rejects(() => malformed.service.callback(`${directCallbackUri}?${query}`));
    assert.equal(malformed.calls.length, 0);
  }
  const ack = fixture({ refreshLostAck: true }); await ack.service.read(ack.row().connectionId);
  assert.deepEqual(ack.counts(), { pages: 1, refreshed: 1 });
  assert.equal(ack.calls.filter(x => x.operation === 'commit_refresh').length, 1);
  assert.equal(ack.calls.filter(x => x.operation === 'reconcile').length, 1);
  for (const options of [{ refreshNotCommitted: true }, { foreignContext: true }, { denyDispatch: true }]) {
    const failed = fixture(options); await assert.rejects(() => failed.service.read(failed.row().connectionId));
    assert.equal(failed.counts().pages, 0);
  }
  const pageAck = fixture({ pageLostAck: true }); await assert.rejects(() => pageAck.service.read(pageAck.row().connectionId));
  assert.equal(pageAck.counts().pages, 1); assert.equal(pageAck.row().state, 'connected');
  const expired = fixture({ provider401: true }); await assert.rejects(() => expired.service.read(expired.row().connectionId));
  assert.equal(expired.row().state, 'reauthorization_required');
  const revoke = fixture({ revokeLostAck: true }); await assert.rejects(() => revoke.service.disconnect(revoke.row().connectionId));
  assert.equal(revoke.row().state, 'disconnected'); assert(revoke.row().ciphertext);
  assert.equal(revoke.calls.some(x => x.operation === 'complete_disconnect'), false);
  assert.throws(() => DirectViewSchema.parse({ available: true, businessEntities: [], connections: [], ciphertext: 'private' }));
  function request(action, body, headers = {}) { return new Request(`${origin}/api/integrations/square/${action}`, {
    method: 'POST', headers: { host: 'www.vaeroex.com', origin, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body }); }
  const connectionId = randomUUID(), businessEntityId = randomUUID();
  for (const [action, body] of [['connect', `businessEntityId=${businessEntityId}`], ['read', `connectionId=${connectionId}`],
    ['mapping', `connectionId=${connectionId}&locationId=LOCATION_1`], ['disconnect', `connectionId=${connectionId}&confirmation=disconnect`]]) {
    const valid = request(action, body); assert(directRequestAllowed(action, valid)); await directForm(action, valid);
  }
  for (const body of [`connectionId=${connectionId}&connectionId=${connectionId}`, `connectionId=${connectionId}&workspaceId=${randomUUID()}`,
    'connectionId=%zz', 'connectionId=%C0%AF', `connectionId=${'x'.repeat(1025)}`]) await assert.rejects(() => directForm('read', request('read', body)));
  for (const headers of [{ origin: 'https://attacker.test' }, { host: 'attacker.test' },
    { 'x-forwarded-host': 'attacker.test' }, { 'x-forwarded-proto': 'http' }, { 'sec-fetch-site': 'cross-site' }])
    assert.equal(directRequestAllowed('read', request('read', `connectionId=${connectionId}`, headers)), false);
  assert.equal(directRequestAllowed('read', new Request(`${origin}/api/integrations/square/read?extra=true`, { method: 'POST', headers: { host: 'www.vaeroex.com', origin } })), false);
  delete process.env.SQUARE_CUSTOMER_BACKEND_ENABLED;
  assert.equal((await squareDirectRoute('read', request('read', `connectionId=${connectionId}`))).status, 404);
  console.log('square_direct_service_and_http_boundaries_passed');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
