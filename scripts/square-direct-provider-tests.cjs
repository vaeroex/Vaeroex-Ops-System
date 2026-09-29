/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test boundary transpiles the production TypeScript. */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { sealCredential, openCredential } = require('../lib/integrations/square-direct/crypto.ts');
const { createDirectSquareProvider, directCallbackUri } = require('../lib/integrations/square-direct/provider.ts');
const { SQUARE_OAUTH_SCOPES } = require('../lib/integrations/providers/square/account-connection-oauth.ts');
const applicationId = 'sq0idp-SYNTHETIC_DIRECT', applicationSecret = 'synthetic_private_application_secret';
let clock = new Date('2026-09-29T12:00:00.000Z');
function credential(overrides = {}) {
  return { schemaVersion: 'oauth_credential_envelope_v1', providerKey: 'square', environment: 'production',
    externalAuthorizedEntityReference: 'MERCHANT_1', accessToken: 'synthetic_private_access_token', refreshToken: 'synthetic_private_refresh_token',
    refreshExpiresAt: null, issuedAt: clock.toISOString(), updatedAt: clock.toISOString(),
    accessExpiresAt: new Date(clock.getTime() + 86400000).toISOString(), grantedScopes: [...SQUARE_OAUTH_SCOPES], ...overrides };
}
const loc = { id: 'LOCATION_1', merchant_id: 'MERCHANT_1', name: 'Shop', status: 'ACTIVE', country: 'US', currency: 'USD', timezone: 'UTC' };
function fixture(options = {}) {
  const calls = [];
  const provider = createDirectSquareProvider({ applicationId, applicationSecret, now: () => clock, authorize: options.authorize, network: async (url, init) => {
    const parsed = new URL(url); calls.push({ url: parsed, init });
    assert.equal(parsed.origin, 'https://connect.squareup.com'); assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
    if (options.network) return options.network(parsed, init);
    if (parsed.pathname === '/oauth2/token') {
      const body = JSON.parse(init.body);
      assert.equal(body.client_id, applicationId); assert.equal(body.client_secret, applicationSecret); assert.equal(body.short_lived, true);
      if (body.grant_type === 'authorization_code') assert.equal(body.redirect_uri, directCallbackUri);
      else { assert.equal(body.grant_type, 'refresh_token'); assert.deepEqual(body.scopes, [...SQUARE_OAUTH_SCOPES]); }
      return Response.json({ access_token: 'synthetic_private_renewed_token', refresh_token: 'synthetic_private_refresh_token',
        token_type: 'bearer', expires_at: new Date(clock.getTime() + 86400000).toISOString(), merchant_id: 'MERCHANT_1', short_lived: true });
    }
    if (parsed.pathname === '/oauth2/token/status') return Response.json({ client_id: applicationId, merchant_id: 'MERCHANT_1',
      scopes: [...SQUARE_OAUTH_SCOPES], expires_at: new Date(clock.getTime() + 86400000).toISOString() });
    if (parsed.pathname === '/v2/merchants/me') return Response.json({ merchant: { id: 'MERCHANT_1', business_name: 'Seller', status: 'ACTIVE', country: 'US', main_location_id: 'LOCATION_1' } });
    if (parsed.pathname === '/v2/locations') return Response.json({ locations: [loc, { ...loc, id: 'LOCATION_2', status: 'INACTIVE' }] });
    if (parsed.pathname === '/v2/locations/main') return Response.json({ location: loc });
    if (parsed.pathname === '/oauth2/revoke') {
      assert.equal(init.headers.Authorization, `Client ${applicationSecret}`);
      assert.deepEqual(JSON.parse(init.body), { client_id: applicationId, merchant_id: 'MERCHANT_1', revoke_only_access_token: false });
      assert(!Object.hasOwn(JSON.parse(init.body), 'access_token')); assert(!init.body.includes('synthetic_private_access_token'));
      return Response.json({ success: true });
    }
    if (parsed.pathname === '/v2/payments') {
      assert.equal(parsed.searchParams.get('location_id'), 'LOCATION_1');
      assert.equal(parsed.searchParams.get('sort_field'), 'UPDATED_AT');
      assert.equal(parsed.searchParams.get('begin_time'), '1970-01-01T00:00:00.000Z');
      return Response.json({ payments: [{ id: 'PAYMENT_1', location_id: 'LOCATION_1', status: 'COMPLETED',
        created_at: '2024-01-01T00:00:00Z', updated_at: '2026-09-29T11:00:00Z', total_money: { amount: 12345, currency: 'USD' },
        card_details: { card: { last_4: '9999', fingerprint: 'private_card' } }, buyer_email_address: 'private@example.test',
        customer_id: 'private_customer', note: 'private note', receipt_url: 'https://example.test/private' }],
        ...(parsed.searchParams.has('cursor') ? {} : { cursor: 'synthetic_cursor_1' }) });
    }
    throw Error('unexpected request');
  } });
  return { provider, calls };
}
async function main() {
  const key = randomBytes(32).toString('base64'), context = { workspaceId: randomUUID(), connectionId: randomUUID(), generation: 1, credentialVersion: 1 };
  const original = credential(), sealed = sealCredential(original, key, context);
  assert.deepEqual(openCredential(sealed, key, context), original);
  assert.notEqual(sealCredential(original, key, context), sealed, 'fresh GCM IV per seal');
  assert(!sealed.includes(original.accessToken));
  for (const changed of [{ workspaceId: randomUUID() }, { connectionId: randomUUID() }, { generation: 2 }, { credentialVersion: 2 }]) {
    assert.throws(() => openCredential(sealed, key, { ...context, ...changed }), /^Error: square_direct_credential_invalid$/);
  }
  const tamper = Buffer.from(sealed.slice(4), 'base64url'); tamper[tamper.length - 1] ^= 1;
  assert.throws(() => openCredential(`sd1.${tamper.toString('base64url')}`, key, context), /^Error: square_direct_credential_invalid$/);
  assert.throws(() => openCredential(sealed, randomBytes(32).toString('base64'), context), /^Error: square_direct_credential_invalid$/);
  for (const bad of ['', 'synthetic-not-key', randomBytes(16).toString('base64')]) assert.throws(() => sealCredential(original, bad, context), /^Error: square_direct_credential_invalid$/);
  assert.throws(() => sealCredential({ ...original, environment: 'sandbox' }, key, context), /^Error: square_direct_credential_invalid$/);
  const exchange = fixture(), state = randomBytes(32).toString('base64url');
  const authorization = new URL(exchange.provider.authorizationUrl(state));
  assert.equal(authorization.origin, 'https://connect.squareup.com'); assert.equal(authorization.searchParams.get('redirect_uri'), directCallbackUri);
  assert.equal(authorization.searchParams.get('state'), state); assert.equal(authorization.searchParams.get('session'), 'false');
  const connected = await exchange.provider.exchange('synthetic-code');
  assert.equal(connected.merchantId, 'MERCHANT_1'); assert.deepEqual(connected.locations, [{ id: 'LOCATION_1', label: 'Shop' }]);
  assert.equal(exchange.calls.length, 5);
  const stagedExchange = fixture(); let stagedCredential;
  await stagedExchange.provider.exchange('synthetic-code', async value => {
    assert.deepEqual(stagedExchange.calls.map(call => call.url.pathname), ['/oauth2/token', '/oauth2/token/status']);
    stagedCredential = value;
  });
  assert.equal(stagedCredential.externalAuthorizedEntityReference, 'MERCHANT_1');
  assert.equal(stagedExchange.calls[2].url.pathname, '/v2/merchants/me', 'credential staging precedes discovery');
  const unstagedExchange = fixture();
  await assert.rejects(() => unstagedExchange.provider.exchange('synthetic-code', async () => { throw Error('synthetic staging lost acknowledgement'); }),
    /^Error: square_direct_provider_failed$/);
  assert.deepEqual(unstagedExchange.calls.map(call => call.url.pathname), ['/oauth2/token', '/oauth2/token/status'],
    'failed credential staging never starts discovery or repeats exchange');
  let authorizations = 0;
  const guarded = fixture({ authorize: async () => { authorizations++; } });
  await guarded.provider.exchange('synthetic-code'); assert.equal(authorizations, 5, 'each OAuth/discovery dispatch rechecks authority');
  let current = connected.credential;
  for (let version = 2; version <= 5; version++) {
    clock = new Date(clock.getTime() + 86400000);
    current = await exchange.provider.refresh(current);
    const nextContext = { ...context, credentialVersion: version };
    assert.deepEqual(openCredential(sealCredential(current, key, nextContext), key, nextContext), current);
  }
  assert.equal(current.issuedAt, connected.credential.issuedAt);
  assert.equal(current.updatedAt, clock.toISOString());
  clock = new Date('2026-09-29T12:00:00.000Z');
  const payment = fixture(), request = { credential: original, workspaceId: context.workspaceId, connectionId: context.connectionId,
    merchantId: 'MERCHANT_1', locationId: 'LOCATION_1', windowStart: '2026-09-29T00:00:00.000Z', windowEnd: clock.toISOString(),
    cursor: null, cursorBindingFingerprint: null, cursorFingerprint: null };
  const page = await payment.provider.payments(request);
  assert.deepEqual(page.payments, [{ id: 'PAYMENT_1', locationId: 'LOCATION_1', status: 'COMPLETED', createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2026-09-29T11:00:00Z', amountMinor: '12345', currency: 'USD' }]);
  assert(!JSON.stringify(page).includes('private')); assert(!JSON.stringify(page).includes('9999'));
  const continuation = { ...request, cursor: page.cursor, cursorBindingFingerprint: page.cursorBindingFingerprint, cursorFingerprint: page.cursorFingerprint };
  const second = await payment.provider.payments(continuation); assert.equal(second.cursor, null);
  const history = fixture({ network: async (url) => {
    assert.equal(url.searchParams.get('sort_field'), 'CREATED_AT');
    assert.equal(url.searchParams.get('begin_time'), '2026-05-04T00:00:00.000Z');
    assert.equal(url.searchParams.get('end_time'), '2026-05-05T23:59:59.999Z');
    assert.equal(url.searchParams.get('location_id'), 'LOCATION_1');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.has('updated_at_begin_time'), false);
    assert.equal(url.searchParams.has('updated_at_end_time'), false);
    return Response.json({ payments: [{ id: 'HISTORICAL_1', location_id: 'LOCATION_1', status: 'COMPLETED',
      created_at: '2026-05-05T04:43:00Z', updated_at: '2026-06-01T00:00:00Z', total_money: { amount: 400000, currency: 'USD' } }],
      ...(url.searchParams.has('cursor') ? {} : { cursor: 'history_cursor_1' }) });
  } });
  const historicalRequest = { ...request, readKind: 'created', windowStart: '2026-05-04T00:00:00.000Z', windowEnd: '2026-05-05T23:59:59.999Z' };
  const historicalPage = await history.provider.payments(historicalRequest);
  assert.equal(historicalPage.payments[0].amountMinor, '400000', 'historical payment updated later is still imported');
  const historyNext = { ...historicalRequest, cursor: historicalPage.cursor,
    cursorBindingFingerprint: historicalPage.cursorBindingFingerprint, cursorFingerprint: historicalPage.cursorFingerprint };
  for (const changed of [{ readKind: 'updated' }, { windowStart: '2026-05-03T00:00:00.000Z' },
    { workspaceId: randomUUID() }, { connectionId: randomUUID() }, { locationId: 'FOREIGN' }]) {
    const count = history.calls.length;
    await assert.rejects(() => history.provider.payments({ ...historyNext, ...changed }));
    assert.equal(history.calls.length, count, 'historical cursor cannot be used for another mode, range, or tenant');
  }
  assert.equal((await history.provider.payments(historyNext)).cursor, null);
  for (const changed of [{ windowStart: '2026-01-01T00:00:00Z' }, { windowEnd: '2026-05-03T00:00:00Z' },
    { windowStart: '2026-09-28T00:00:00Z', windowEnd: '2026-09-30T00:00:00Z' }]) {
    const count = history.calls.length;
    await assert.rejects(() => history.provider.payments({ ...historicalRequest, ...changed }));
    assert.equal(history.calls.length, count, 'invalid history bounds never dispatch');
  }
  const outsideHistory = fixture({ network: async () => Response.json({ payments: [{ id: 'OUTSIDE', location_id: 'LOCATION_1',
    created_at: '2026-05-03T23:59:59Z', updated_at: '2026-05-04T12:00:00Z', status: 'COMPLETED' }] }) });
  await assert.rejects(() => outsideHistory.provider.payments(historicalRequest));
  for (const changed of [{ workspaceId: randomUUID() }, { connectionId: randomUUID() }, { locationId: 'FOREIGN' },
    { merchantId: 'FOREIGN' }, { windowStart: '2026-09-28T00:00:00.000Z' }, { cursor: 'foreign_cursor' }]) {
    const count = payment.calls.length;
    await assert.rejects(() => payment.provider.payments({ ...continuation, ...changed }), /^Error: square_direct_provider_failed$/);
    assert.equal(payment.calls.length, count, 'bad continuation rejected before network');
  }
  await assert.rejects(() => payment.provider.payments({ ...request, credential: { ...original, environment: 'sandbox' } }), /^Error: square_direct_provider_failed$/);
  await fixture().provider.revoke(original);
  await fixture().provider.revoke({ ...original, issuedAt: '2026-09-28T11:00:00.000Z', updatedAt: '2026-09-28T11:00:00.000Z',
    accessExpiresAt: '2026-09-29T11:00:00.000Z' });
  await guarded.provider.refresh(original); assert.equal(authorizations, 7);
  await guarded.provider.payments(request); assert.equal(authorizations, 8);
  await guarded.provider.revoke(original); assert.equal(authorizations, 9);
  const fenced = fixture({ authorize: async () => { throw Error('synthetic lease lost'); } });
  for (const run of [() => fenced.provider.exchange('synthetic-code'), () => fenced.provider.refresh(original),
    () => fenced.provider.payments(request), () => fenced.provider.revoke(original)]) {
    await assert.rejects(run, /^Error: square_direct_provider_failed$/);
  }
  assert.equal(fenced.calls.length, 0, 'lost SQL authority never reaches Square');
  const redirects = fixture({ network: async () => new Response('', { status: 302, headers: { location: 'https://attacker.example/' } }) });
  await assert.rejects(() => redirects.provider.exchange('synthetic-code'), /^Error: square_direct_provider_failed$/);
  const denied = fixture({ network: async () => Response.json({ errors: [{ code: 'UNAUTHORIZED', detail: 'private provider data' }] }, { status: 401 }) });
  await assert.rejects(() => denied.provider.payments(request), /^Error: square_direct_reauthorization_required$/);
  const foreignPayment = fixture({ network: async () => Response.json({ payments: [{ id: 'PAYMENT_2', location_id: 'FOREIGN', status: 'COMPLETED' }] }) });
  await assert.rejects(() => foreignPayment.provider.payments(request), /^Error: square_direct_provider_failed$/);
  const oversize = fixture({ network: async () => new Response('x'.repeat(2_097_153)) });
  await assert.rejects(() => oversize.provider.payments(request), /^Error: square_direct_provider_failed$/);
  console.log('square_direct_provider_and_crypto_checks_passed');
}
main().catch(() => { console.error('square_direct_provider_and_crypto_checks_failed'); process.exitCode = 1; });
