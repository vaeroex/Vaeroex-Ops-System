/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-SDK/Next regression harness. */
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { mock } = require('node:test');
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
      assert.equal(init.method, 'POST');
      assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
      assert.equal(JSON.parse(init.body).refresh_token, state.old.refresh_token);
      state.entered?.resolve();
      if (state.release) await state.release.promise;
      if (state.refreshResponse) return state.refreshResponse();
      return state.refreshDenied
        ? json({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Synthetic rejection' }, 400)
        : json(state.fresh);
    }
    assert.equal(url.pathname, '/auth/v1/user');
    state.userCalls++;
    const authorization = new Headers(init.headers).get('authorization');
    assert([state.old.access_token, state.fresh.access_token].some(token => authorization === `Bearer ${token}`));
    if (state.userResponse) return state.userResponse();
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
const conflictResponse = () => json({ code: 'conflict', error_code: 'conflict', msg: 'Synthetic refresh conflict' }, 409);
async function terminalConflict(state, result) {
  const { response } = result, before = [...state.jar];
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Session verification unavailable.');
  assert.equal(response.headers.get('set-cookie'), null, 'conflict must neither delete nor reissue browser cookies');
  assert.equal(response.cookies.getAll().length, 0);
  for (const [name] of response.headers) {
    assert(!name.startsWith('x-middleware-'), 'terminal conflict must not forward request headers or render downstream');
    assert(!['cookie', 'authorization', 'x-user-id', 'x-workspace-id'].includes(name));
  }
  persistBrowser(state, response);
  assert.deepEqual([...state.jar], before, 'a conflict response must leave the single browser jar byte-for-byte unchanged');
  assert.equal(state.rscWriteAttempts, 0);
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

async function sharedBrowserRace(n, outcomes, order) {
  const initial = fixture(n, outcomes.includes('revoked') ? {} : { oldSize: 10000, freshSize: 0 });
  const original = [...initial.jar], unrelated = initial.jar.get('unrelated-fixture'), workspace = initial.jar.get('workspace-fixture');
  const requests = outcomes.map(outcome => ({
    ...initial, outcome, entered: deferred(), release: deferred(),
    ...(outcome === 'conflict' ? { refreshResponse: conflictResponse } : {}),
    ...(outcome === 'revoked' ? { refreshDenied: true } : {})
  }));
  assert.equal(requests[0].jar, requests[1].jar, 'both requests must update the same browser cookie jar');
  const pending = requests.map(state => run(state));
  await enteredTogether(...requests);
  for (const index of order) {
    const state = requests[index];
    state.release.resolve();
    const result = await pending[index];
    if (state.outcome === 'conflict') {
      await terminalConflict(state, result);
      assert.equal(state.userCalls, 0);
    } else if (state.outcome === 'success') {
      await guard(state, result);
      persistBrowser(state, result.response);
      assert.equal(sessionFrom(state.jar).refresh_token, state.fresh.refresh_token);
      assert.equal(state.userCalls, 2);
    } else {
      assert.equal(result.response.status, 200, 'genuine rejection still reaches the original denying guard');
      assert(result.response.cookies.getAll().length > 0);
      assert(result.response.cookies.getAll().every(cookie => cookie.maxAge === 0));
      await guard(state, result, false);
      persistBrowser(state, result.response);
      assert.equal(state.userCalls, 0);
    }
    assert.equal(state.refreshCalls, 1, 'each independently initiated request makes at most one fixture refresh');
    assert.equal(state.rscWriteAttempts, 0);
    assert.equal(state.jar.get('unrelated-fixture'), unrelated);
    assert.equal(state.jar.get('workspace-fixture'), workspace);
  }
  const winner = requests.find(state => state.outcome === 'success');
  if (!winner) {
    assert.deepEqual([...initial.jar], original, 'all-conflict completion must retain the original browser jar');
    return;
  }
  if (outcomes.includes('conflict')) {
    assert.equal(sessionFrom(initial.jar).refresh_token, winner.fresh.refresh_token, 'either response order must retain the successful refresh');
    const next = { ...winner, entered: undefined, release: undefined, refreshCalls: 0, userCalls: 0, configCalls: 0 };
    const result = await run(next);
    await guard(next, result);
    assert.equal(next.refreshCalls, 0, 'the browser must use the winner on a later independent request');
    assert.equal(next.userCalls, 2);
  } else {
    // These fixture responses are intentionally contradictory: the application must
    // preserve ordinary provider rejection, not invent global rotation guarantees.
    const last = requests[order.at(-1)].outcome;
    assert.equal(Boolean(sessionFrom(initial.jar)), last === 'success', 'ordinary cookie response order remains visible');
    const next = { ...winner, entered: undefined, release: undefined, userDenied: true, refreshCalls: 0, userCalls: 0, configCalls: 0 };
    const result = await run(next);
    await guard(next, result, false);
    persistBrowser(next, result.response);
    assert.equal(sessionFrom(initial.jar), null, 'a subsequent authoritative user revocation must deny even a late successful cookie');
    assert.equal(next.refreshCalls, 0);
    assert.equal(next.userCalls, last === 'success' ? 1 : 0);
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

  const originalCases = caseCount;
  assert.equal(originalCases, 29, 'retain every original session-persistence regression');
  phase = 'valid_access_then_conflict_then_independent_recovery';
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T00:00:00Z') });
  try {
    const boundary = fixture(100, { expired: false, refreshResponse: conflictResponse }), originalJar = [...fixture(100, { expired: false }).jar];
    const baseline = await run(boundary);
    await guard(boundary, baseline);
    assert.equal(boundary.refreshCalls, 0); assert.equal(boundary.userCalls, 2);
    assert.equal(baseline.response.cookies.getAll().length, 0, 'valid access does not establish refresh usability');
    mock.timers.setTime((boundary.old.expires_at - 89) * 1000);
    const conflict = await run(boundary);
    await terminalConflict(boundary, conflict);
    assert.equal(boundary.refreshCalls, 1); assert.equal(boundary.userCalls, 2);
    assert.deepEqual([...boundary.jar], originalJar, 'crossing the synthetic expiry margin must not commit conflict deletions');
    // A later request is explicitly initiated by the test; the middleware must
    // not retry or claim that this synthetic Auth recovery is guaranteed.
    boundary.refreshResponse = undefined;
    boundary.fresh = fixture(100).fresh;
    const recovered = await run(boundary);
    await guard(boundary, recovered); persistBrowser(boundary, recovered.response);
    assert.equal(boundary.refreshCalls, 2); assert.equal(boundary.userCalls, 4);
    assert.equal(sessionFrom(boundary.jar).refresh_token, boundary.fresh.refresh_token);
    assert(sessionFrom(boundary.jar).expires_at > boundary.old.expires_at);
    const afterRecovery = await run(boundary);
    await guard(boundary, afterRecovery);
    assert.equal(boundary.refreshCalls, 2); assert.equal(boundary.userCalls, 6);
    assert.equal(boundary.rscWriteAttempts, 0);
    caseCount++;
  } finally { mock.timers.reset(); }

  phase = 'repeated_conflicts_are_one_call_per_independent_request';
  const repeating = fixture(101, { oldSize: 10000, refreshResponse: conflictResponse }), repeatingJar = [...repeating.jar];
  for (let request = 1; request <= 3; request++) {
    const result = await run(repeating);
    await terminalConflict(repeating, result);
    assert.equal(repeating.refreshCalls, request); assert.equal(repeating.userCalls, 0);
    assert.deepEqual([...repeating.jar], repeatingJar);
  }
  caseCount++;

  phase = 'conflict_navigation_variants';
  for (const options of [
    { pathname: '/app/settings' },
    { pathname: '/app/settings', method: 'HEAD' },
    { pathname: '/app/settings?_rsc=synthetic', headers: { RSC: '1', 'next-router-state-tree': '["",{}]' } },
    { pathname: '/app/settings?_rsc=synthetic', headers: { RSC: '1', 'next-router-prefetch': '1', purpose: 'prefetch' } }
  ]) {
    const state = fixture(102, { refreshResponse: conflictResponse });
    await terminalConflict(state, await run(state, options));
    assert.equal(state.refreshCalls, 1); assert.equal(state.userCalls, 0); caseCount++;
  }

  phase = 'spoofed_conflict_claims_cannot_create_exception';
  const claims = fixture(103);
  claims.user.user_metadata = { code: 'conflict', status: 409, refreshConflictResponse: true };
  claims.fresh.user.user_metadata = { ...claims.user.user_metadata };
  const ordinary = await run(claims, { headers: {
    'x-refresh-conflict': 'true', 'x-auth-error-code': 'conflict', 'x-auth-status': '409', 'x-user-id': id(999)
  } });
  assert.equal(ordinary.response.status, 200);
  assert(ordinary.response.cookies.getAll().length > 0);
  await guard(claims, ordinary);
  assert.equal(claims.refreshCalls, 1); assert.equal(claims.userCalls, 2); caseCount++;

  const nonConflicts = [
    ['wrong_status', () => json({ code: 'conflict', error_code: 'conflict', msg: 'Synthetic conflict' }, 400)],
    ['wrong_code', () => json({ code: 'refresh_token_not_found', msg: 'Synthetic conflict text' }, 409)],
    ['message_only', () => json({ msg: 'conflict', status: 409 }, 409)],
    ['nested_code', () => json({ data: { code: 'conflict' }, msg: 'Synthetic conflict' }, 409)],
    ['malformed_body', () => new Response('not-json', { status: 409, headers: { 'content-type': 'application/json' } })],
    ['case_variant', () => json({ code: 'Conflict', msg: 'Synthetic conflict' }, 409)],
    ['unrecognized_sdk_code', () => new Response(JSON.stringify({ code: 'conflict', msg: 'Synthetic conflict' }), {
      status: 409, headers: { 'content-type': 'application/json' }
    })]
  ];
  for (const [name, refreshResponse] of nonConflicts) {
    phase = 'refresh_conflict_near_miss_' + name;
    const denied = fixture(104, { refreshResponse }), result = await run(denied);
    assert.equal(result.response.status, 200, 'a nonmatching Auth error must preserve the original denying path');
    assert(result.response.cookies.getAll().length > 0);
    assert(result.response.cookies.getAll().every(cookie => cookie.maxAge === 0));
    await guard(denied, result, false); persistBrowser(denied, result.response);
    assert.equal(sessionFrom(denied.jar), null);
    assert.equal(denied.refreshCalls, 1); assert.equal(denied.userCalls, 0); caseCount++;
  }

  for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_expired']) {
    phase = 'authoritative_refresh_rejection_' + code;
    const denied = fixture(105, { refreshResponse: () => json({ code, error_code: code, msg: 'Synthetic authoritative rejection' }, 400) });
    const result = await run(denied);
    assert.equal(result.response.status, 200);
    assert(result.response.cookies.getAll().length > 0);
    assert(result.response.cookies.getAll().every(cookie => cookie.maxAge === 0));
    await guard(denied, result, false); persistBrowser(denied, result.response);
    assert.equal(sessionFrom(denied.jar), null);
    assert.equal(denied.refreshCalls, 1); assert.equal(denied.userCalls, 0); caseCount++;
  }

  for (const expired of [false, true]) {
    phase = expired ? 'user_409_after_successful_refresh' : 'user_409_without_refresh';
    const denied = fixture(106, { expired, userResponse: () => {
      const response = conflictResponse();
      // A response URL or browser-supplied claim cannot turn this actual GET
      // /user error into an observed POST refresh conflict.
      Object.defineProperty(response, 'url', { value: origin + '/auth/v1/token?grant_type=refresh_token' });
      return response;
    } });
    const result = await run(denied, { headers: { 'x-refresh-conflict': 'true' } });
    assert.equal(result.response.status, 200, 'GET /user 409 is not the refresh exception');
    await guard(denied, result, false);
    assert.equal(denied.refreshCalls, expired ? 1 : 0); assert.equal(denied.userCalls, 2);
    if (expired) assert(result.response.cookies.getAll().some(cookie => cookie.maxAge > 0), 'unrelated successful refresh cookies remain intact');
    else assert.equal(result.response.cookies.getAll().length, 0);
    assert.equal(denied.rscWriteAttempts, 0); caseCount++;
  }

  phase = 'shared_browser_success_then_conflict';
  await sharedBrowserRace(110, ['success', 'conflict'], [0, 1]); caseCount++;
  phase = 'shared_browser_conflict_then_success';
  await sharedBrowserRace(111, ['success', 'conflict'], [1, 0]); caseCount++;
  phase = 'shared_browser_all_conflicts';
  await sharedBrowserRace(112, ['conflict', 'conflict'], [1, 0]); caseCount++;
  phase = 'shared_browser_success_then_genuine_revocation';
  await sharedBrowserRace(113, ['success', 'revoked'], [0, 1]); caseCount++;
  phase = 'shared_browser_genuine_revocation_then_success';
  await sharedBrowserRace(114, ['success', 'revoked'], [1, 0]); caseCount++;

  phase = 'transport_boundary';
  assert.deepEqual(transportErrors, []); assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, cases: caseCount, originalCases, addedConflictCases: caseCount - originalCases, actualInstalledSDK: true, actualNextRequestResponse: true,
    sameRequestAndConsecutiveRequestPersistence: true, chunkGrowthShrinkAndDeletion: true, originalSDKCookieOptions: true,
    separateAndSameUserConcurrency: true, isolatedMixedRefreshOutcomes: true, transientUserFailurePreservesCookies: true,
    guardsRemainAuthoritative: true, unexpected503RetainsCookies: true,
    validAccessConflictAndIndependentRecovery: true, repeatedConflictRequests: 3, refreshConflictNoRetryOrCookieWrites: true,
    preciseConflictNearMisses: nonConflicts.length, sharedBrowserResponseOrderCases: 5,
    preAuthRoutesAndActionsPreserved: true, externalCalls: 0, sdkErrorEvents,
    limitation: 'Synthetic Auth responses and cookie-jar application verify mechanics; not browser/deployment behavior or hosted session expiry/reuse.' }));
})().catch(error => {
  const location = /supabase-session-refresh-tests\.cjs:(\d+):(\d+)/.exec(String(error?.stack || ''));
  originalError(JSON.stringify({ phase, category: error?.code === 'ERR_ASSERTION' ? 'assertion_failure' : 'unexpected_failure',
    location: location ? { file: 'supabase-session-refresh-tests.cjs', line: Number(location[1]), column: Number(location[2]) } : null }));
  process.exitCode = 1;
});
