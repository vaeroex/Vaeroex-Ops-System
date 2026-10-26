/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-SDK/Next regression harness. */
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const net = require('node:net');
const { installLoader } = require('./qbo-customer-test-support.cjs');

// Invented sessions only. Neither application configuration nor live transport is used.
const origin = 'https://session-refresh.invalid';
const cookieName = 'sb-session-refresh-auth-token';
const scope = new AsyncLocalStorage();
const transportErrors = [];
let networkAttempts = 0, sdkErrorEvents = 0, caseCount = 0, phase = 'setup';
const originalError = console.error;
console.error = () => { sdkErrorEvents++; };
net.Socket.prototype.connect = () => { networkAttempts++; throw new Error('network_forbidden'); };
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' }
});
global.fetch = async (input, init = {}) => {
  try {
    const state = scope.getStore();
    assert(state, 'transport must belong to one synthetic request');
    const url = new URL(typeof input === 'string' ? input : input.url || input.href);
    assert.equal(url.origin, origin, 'only intercepted .invalid transport is permitted');
    if (url.pathname === '/auth/v1/token') {
      state.refreshCalls++;
      assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
      assert.equal(JSON.parse(init.body).refresh_token, state.old.refresh_token);
      state.entered?.resolve();
      if (state.release) await state.release.promise;
      return state.refreshDenied
        ? json({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Synthetic rejection' }, 400)
        : json(state.fresh);
    }
    assert.equal(url.pathname, '/auth/v1/user');
    state.userCalls++;
    const authorization = new Headers(init.headers).get('authorization');
    assert([state.old.access_token, state.fresh.access_token].some(token => authorization === `Bearer ${token}`));
    if (state.nullUser) return json(null);
    if (state.userUnavailable) return json({ code: 'unexpected_failure', msg: 'Synthetic temporary failure' }, 503);
    return state.userDenied
      ? json({ code: 'session_not_found', error_code: 'session_not_found', msg: 'Synthetic revocation' }, 401)
      : json(state.user);
  } catch (error) {
    // The SDK can convert fetch exceptions to AuthErrors, so retain assertion failures independently.
    transportErrors.push(error.message);
    throw error;
  }
};
installLoader({
  'server-only': {},
  '@/lib/supabase/config': { getSupabaseConfig: () => {
    const state = scope.getStore();
    assert(state, 'configuration belongs to the synthetic request');
    state.configCalls++;
    return state.configMissing ? null : { url: origin, anonKey: 'synthetic-public-anon-key' };
  } },
  'next/headers': { cookies: async () => {
    const state = scope.getStore();
    assert(state?.rscCookies, 'RSC receives the forwarded request cookie header');
    return {
      getAll: () => state.rscCookies.getAll(),
      set: () => { state.rscWriteAttempts++; throw new Error('Server Component cookies are read-only'); }
    };
  } }
});
const { NextRequest, NextResponse } = require('next/server');
const { createServerClient, createChunks } = require('@supabase/ssr');
const { middleware, config } = require('../middleware.ts');
const { requireAuth } = require('../lib/security/require-auth.ts');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const encoded = value => `base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
function fixture(n, { expired = true, oldSize = 0, freshSize = 0, ...options } = {}) {
  const user = { id: id(n), aud: 'authenticated', role: 'authenticated', email: `user-${n}@fixture.invalid`,
    app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-10-01T00:00:00Z' };
  const now = Math.floor(Date.now() / 1000);
  function session(generation, expiry, size) {
    const jwt = [encoded({ alg: 'HS256', typ: 'JWT' }).slice(7),
      encoded({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: expiry, jti: `${n}-${generation}` }).slice(7),
      Buffer.from('synthetic-not-a-live-signature').toString('base64url')].join('.');
    return { access_token: jwt, refresh_token: `invented-refresh-${n}-${generation}`, expires_at: expiry,
      expires_in: 3600, token_type: 'bearer', user: { ...user, user_metadata: { padding: 'x'.repeat(size) } } };
  }
  const old = session(0, expired ? now - 600 : now + 3600, oldSize);
  const fresh = session(1, now + 3600, freshSize);
  return { user, old, fresh, jar: new Map([...createChunks(cookieName, encoded(old)).map(c => [c.name, c.value]),
    ['workspace-fixture', `workspace-${n}`], ['unrelated-fixture', `unrelated-${n}`]]),
    refreshCalls: 0, userCalls: 0, configCalls: 0, rscWriteAttempts: 0, ...options };
}
function requestFor(state, { method = 'GET', pathname = '/app/sources/evidence/vsi_exchange/fixture', headers = {} } = {}) {
  const cookie = [...state.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  return new NextRequest(`https://app.fixture.invalid${pathname}`, { method, headers: { cookie, ...headers } });
}
async function run(state, options) {
  const request = requestFor(state, options);
  const response = await scope.run(state, () => middleware(request));
  assert(response instanceof NextResponse);
  noCache(response);
  assert.equal(response.headers.get('location'), null, 'refresh middleware must not choose a redirect');
  assert.equal(response.headers.get('x-middleware-rewrite'), null);
  return { request, response };
}
function noCache(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
}
function forwardedRequest({ request, response }) {
  assert.equal(response.headers.get('x-middleware-next'), '1');
  const headers = new Headers(request.headers);
  const overrides = response.headers.get('x-middleware-override-headers').split(',').map(value => value.trim());
  assert(overrides.includes('cookie'));
  for (const name of overrides) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value === null) headers.delete(name); else headers.set(name, value);
  }
  return new NextRequest(request.url, { headers });
}
async function guard(state, result, allowed = true) {
  const request = forwardedRequest(result);
  state.rscCookies = request.cookies;
  if (allowed) assert.equal((await scope.run(state, () => requireAuth())).user.id, state.user.id);
  else await assert.rejects(scope.run(state, () => requireAuth()), error => error.digest?.includes(';/login;'));
}
function persistBrowser(state, response) {
  for (const cookie of response.cookies.getAll()) {
    if (cookie.maxAge === 0 || (cookie.expires && cookie.expires.getTime() <= Date.now())) state.jar.delete(cookie.name);
    else state.jar.set(cookie.name, cookie.value);
  }
}
function reconstructed(jar) {
  if (jar.has(cookieName)) return jar.get(cookieName);
  let value = '';
  for (let i = 0; jar.has(`${cookieName}.${i}`); i++) value += jar.get(`${cookieName}.${i}`);
  return value;
}
function sessionFrom(jar) {
  const value = reconstructed(jar);
  return value ? JSON.parse(Buffer.from(value.slice(7), 'base64url').toString()) : null;
}
// A separate real SDK control supplies the exact cookie options; the client is never stubbed.
async function expectedCookieWrites(state) {
  const control = { ...state, jar: new Map(state.jar), refreshCalls: 0, userCalls: 0, configCalls: 0 };
  const writes = [];
  await scope.run(control, async () => {
    const client = createServerClient(origin, 'synthetic-public-anon-key', { cookies: {
      getAll: () => [...control.jar].map(([name, value]) => ({ name, value })),
      setAll: batch => { writes.push(...batch); for (const { name, value, options } of batch) {
        if (options.maxAge === 0) control.jar.delete(name); else control.jar.set(name, value);
      } }
    } });
    await client.auth.getUser();
  });
  return writes;
}
function sameCookieOptions(response, writes) {
  const expected = NextResponse.next();
  for (const { name, value, options } of writes) expected.cookies.set(name, value, options);
  const actual = response.cookies.getAll(), wanted = expected.cookies.getAll();
  assert.equal(actual.length, wanted.length);
  for (const cookie of wanted) {
    const observed = actual.find(c => c.name === cookie.name);
    assert(observed);
    // Next materializes Max-Age as an Expires time at serialization; tolerate only elapsed wall time.
    if (cookie.expires) assert(Math.abs(observed.expires.getTime() - cookie.expires.getTime()) <= 2000);
    const strip = c => Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'expires'));
    assert.deepEqual(strip(observed), strip(cookie));
  }
  assert(response.headers.get('set-cookie'), 'browser persistence requires actual serialized Set-Cookie');
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function enteredTogether(first, second) {
  let timer;
  try {
    await Promise.race([Promise.all([first.entered.promise, second.entered.promise]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('synthetic_concurrency_barrier_timeout')), 2000); })]);
  } finally { clearTimeout(timer); }
}
async function concurrent(first, second) {
  first.entered = deferred(); first.release = deferred();
  second.entered = deferred(); second.release = deferred();
  const a = run(first), b = run(second);
  await enteredTogether(first, second);
  second.release.resolve();
  const rb = await b;
  await guard(second, rb);
  first.release.resolve();
  const ra = await a;
  await guard(first, ra);
  for (const [state, result] of [[first, ra], [second, rb]]) {
    assert.equal(state.refreshCalls, 1);
    assert.equal(state.userCalls, 2);
    assert.equal(state.rscWriteAttempts, 0);
    persistBrowser(state, result.response);
    assert.equal(sessionFrom(state.jar).user.id, state.user.id);
    assert.equal(state.jar.get('unrelated-fixture'), `unrelated-${Number(state.user.id.slice(-12))}`);
  }
}

(async () => {
  assert.deepEqual(config.matcher, ['/app/:path*']);
  phase = 'consecutive_requests';
  const state = fixture(1), writes = await expectedCookieWrites(state);
  const original = reconstructed(state.jar);
  const first = await run(state, { pathname: '/app?next=https://untrusted.invalid', headers: { 'x-user-id': id(999), 'x-workspace-id': id(998) } });
  assert.equal(state.refreshCalls, 1);
  assert.equal(reconstructed(state.jar), original, 'request mutation alone does not persist browser cookies');
  sameCookieOptions(first.response, writes);
  assert.equal(first.response.headers.get('x-user-id'), null);
  assert.equal(first.response.headers.get('x-workspace-id'), null);
  await guard(state, first);
  assert.equal(state.refreshCalls, 1, 'same-request guard must consume the forwarded refreshed cookie');
  persistBrowser(state, first.response);
  assert.equal(sessionFrom(state.jar).refresh_token, state.fresh.refresh_token);
  const second = await run(state);
  await guard(state, second);
  assert.equal(state.refreshCalls, 1, 'next browser request must not refresh the old token again');
  assert.equal(state.userCalls, 4, 'middleware and both real server guards verify with Auth');
  assert.equal(state.rscWriteAttempts, 0);
  assert.equal(second.response.cookies.getAll().length, 0);
  caseCount++;

  phase = 'chunk_and_option_fidelity';
  for (const sizes of [{ oldSize: 10000, freshSize: 0 }, { oldSize: 0, freshSize: 10000 }]) {
    const chunked = fixture(++caseCount + 10, sizes), before = new Set(chunked.jar.keys());
    const expected = await expectedCookieWrites(chunked), result = await run(chunked);
    sameCookieOptions(result.response, expected);
    await guard(chunked, result);
    persistBrowser(chunked, result.response);
    assert.equal(sessionFrom(chunked.jar).refresh_token, chunked.fresh.refresh_token);
    const after = new Set(chunked.jar.keys());
    for (const name of before) if (name.startsWith(cookieName) && !after.has(name)) {
      assert.equal(result.response.cookies.get(name).maxAge, 0, 'obsolete chunks/base must be deleted in the browser');
    }
    assert.equal(chunked.jar.get('workspace-fixture'), `workspace-${Number(chunked.user.id.slice(-12))}`);
    assert.equal(chunked.rscWriteAttempts, 0);
    assert.equal(chunked.refreshCalls, 1);
  }

  phase = 'untrusted_identity';
  const spoofed = fixture(20, { expired: false });
  spoofed.jar.set(cookieName, encoded({ ...spoofed.old, user: { ...spoofed.user, id: id(999) } }));
  const verified = await run(spoofed, { headers: { 'x-user-id': id(999) } });
  await guard(spoofed, verified);
  assert.equal(spoofed.refreshCalls, 0);
  assert.equal(spoofed.userCalls, 2, 'embedded user/header are not proof of identity');
  caseCount++;

  phase = 'auth_denials';
  for (const mode of ['missing', 'malformed', 'invalid-shape', 'refresh-revoked', 'user-revoked', 'refresh-then-revoked']) {
    const denied = fixture(30 + caseCount, { oldSize: 10000, expired: mode !== 'user-revoked',
      refreshDenied: mode === 'refresh-revoked', userDenied: mode === 'user-revoked' || mode === 'refresh-then-revoked' });
    if (['missing', 'malformed', 'invalid-shape'].includes(mode)) {
      for (const name of [...denied.jar.keys()]) if (name.startsWith(cookieName)) denied.jar.delete(name);
      if (mode === 'malformed') denied.jar.set(cookieName, `base64-${Buffer.from('not-json').toString('base64url')}`);
      if (mode === 'invalid-shape') denied.jar.set(cookieName, encoded({ user: denied.user }));
    }
    const result = await run(denied);
    assert.equal(result.response.status, 200, 'Auth denials defer to the unchanged page guard');
    await guard(denied, result, false);
    persistBrowser(denied, result.response);
    if (mode.includes('revoked')) {
      assert.equal([...denied.jar.keys()].filter(name => name.startsWith(cookieName)).length, 0);
      assert(result.response.cookies.getAll().length > 0);
      assert(result.response.cookies.getAll().every(cookie => cookie.maxAge === 0));
    } else assert.equal(denied.refreshCalls + denied.userCalls, 0);
    assert.equal(denied.refreshCalls, mode.startsWith('refresh') ? 1 : 0);
    assert.equal(denied.jar.get('workspace-fixture'), `workspace-${Number(denied.user.id.slice(-12))}`);
    caseCount++;
  }

  phase = 'transient_user_failure';
  const transient = fixture(59, { expired: false, userUnavailable: true });
  const beforeTransient = [...transient.jar];
  const transientResult = await run(transient);
  await guard(transient, transientResult, false);
  assert.equal(transient.refreshCalls, 0); assert.equal(transient.userCalls, 2);
  assert.equal(transient.rscWriteAttempts, 0);
  assert.equal(transientResult.response.cookies.getAll().length, 0, 'transient Auth failure must not delete a valid-shaped browser session');
  persistBrowser(transient, transientResult.response);
  assert.deepEqual([...transient.jar], beforeTransient);
  caseCount++;

  phase = 'unexpected_user_failure';
  const unexpected = fixture(60, { oldSize: 10000, nullUser: true });
  const failed = await run(unexpected);
  assert.equal(failed.response.status, 503);
  assert.equal(await failed.response.text(), 'Session verification unavailable.');
  assert.equal(unexpected.refreshCalls, 1); assert.equal(unexpected.userCalls, 1);
  assert(failed.response.cookies.getAll().length > 0, 'pending SDK cookie writes survive an unexpected user-response exception');
  for (const [name] of failed.response.headers) assert(!name.startsWith('x-middleware-request-') && name !== 'x-middleware-override-headers' && name !== 'x-middleware-next');
  persistBrowser(unexpected, failed.response);
  assert.equal(sessionFrom(unexpected.jar).refresh_token, unexpected.fresh.refresh_token);
  caseCount++;

  phase = 'concurrent_requests';
  await concurrent(fixture(70), fixture(71)); caseCount++;
  // Parent-token reuse is explicitly allowed by this synthetic Auth transport; no global dedup/revocation claim.
  await concurrent(fixture(72), fixture(72)); caseCount++;
  phase = 'concurrent_mixed_refresh_outcomes';
  const accepted = fixture(73), rejected = fixture(73, { refreshDenied: true });
  for (const state of [accepted, rejected]) { state.entered = deferred(); state.release = deferred(); }
  const pendingAccepted = run(accepted), pendingRejected = run(rejected);
  await enteredTogether(accepted, rejected);
  rejected.release.resolve();
  const rejectedResult = await pendingRejected;
  await guard(rejected, rejectedResult, false);
  accepted.release.resolve();
  const acceptedResult = await pendingAccepted;
  await guard(accepted, acceptedResult);
  assert.equal(rejected.refreshCalls, 1); assert.equal(rejected.userCalls, 0);
  assert.equal(accepted.refreshCalls, 1); assert.equal(accepted.userCalls, 2);
  assert.equal(rejected.rscWriteAttempts, 0); assert.equal(accepted.rscWriteAttempts, 0);
  persistBrowser(rejected, rejectedResult.response); persistBrowser(accepted, acceptedResult.response);
  assert.equal(sessionFrom(rejected.jar), null);
  assert.equal(sessionFrom(accepted.jar).refresh_token, accepted.fresh.refresh_token);
  assert.equal(accepted.jar.get('unrelated-fixture'), rejected.jar.get('unrelated-fixture'));
  caseCount++;

  phase = 'method_boundaries';
  const head = fixture(80), headResult = await run(head, { method: 'HEAD' });
  await guard(head, headResult); assert.equal(head.refreshCalls, 1); caseCount++;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const skipped = fixture(90);
    const result = await run(skipped, { method, headers: { 'next-action': 'synthetic-action' } });
    assert.equal(skipped.configCalls + skipped.refreshCalls + skipped.userCalls, 0);
    assert.equal(result.response.cookies.getAll().length, 0); caseCount++;
  }
  phase = 'pre_auth_route_boundaries';
  for (const pathname of ['/app/settings/storage/payment-return', '/app/settings/storage/payment-return/',
    '/APP/SETTINGS/STORAGE/PAYMENT-RETURN', '/app/settings/integrations/square', '/app/settings/integrations/square/return',
    '/APP/SETTINGS/INTEGRATIONS/SQUARE/return/']) {
    const skipped = fixture(91), result = await run(skipped, { pathname });
    assert.equal(skipped.configCalls + skipped.refreshCalls + skipped.userCalls, 0);
    assert.equal(result.response.cookies.getAll().length, 0); caseCount++;
  }
  for (const pathname of ['/app/settings/storage/payment-return/extra', '/app/settings/integrations/square-other']) {
    const protectedRoute = fixture(92); await run(protectedRoute, { pathname });
    assert.equal(protectedRoute.refreshCalls, 1, 'pre-auth route exemptions must not expand to nearby paths'); caseCount++;
  }
  phase = 'missing_configuration';
  const missingConfig = fixture(93, { configMissing: true }), unavailable = await run(missingConfig);
  assert.equal(missingConfig.configCalls, 1); assert.equal(missingConfig.refreshCalls + missingConfig.userCalls, 0);
  assert.equal(unavailable.response.cookies.getAll().length, 0); caseCount++;
  phase = 'transport_boundary';
  assert.deepEqual(transportErrors, []); assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, cases: caseCount, actualInstalledSDK: true, actualNextRequestResponse: true,
    sameRequestAndConsecutiveRequestPersistence: true, chunkGrowthShrinkAndDeletion: true, originalSDKCookieOptions: true,
    separateAndSameUserConcurrency: true, isolatedMixedRefreshOutcomes: true, transientUserFailurePreservesCookies: true,
    guardsRemainAuthoritative: true, unexpected503RetainsCookies: true,
    preAuthRoutesAndActionsPreserved: true, externalCalls: 0, sdkErrorEvents,
    limitation: 'Synthetic Auth responses and cookie-jar application verify mechanics; not browser/deployment behavior or hosted session expiry/reuse.' }));
})().catch(error => {
  const location = /supabase-session-refresh-tests\.cjs:(\d+):(\d+)/.exec(String(error?.stack || ''));
  originalError(JSON.stringify({ phase, category: error?.code === 'ERR_ASSERTION' ? 'assertion_failure' : 'unexpected_failure',
    location: location ? { file: 'supabase-session-refresh-tests.cjs', line: Number(location[1]), column: Number(location[2]) } : null }));
  process.exitCode = 1;
});
