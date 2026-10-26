/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual SSR client/page regression with synthetic cookies and intercepted HTTP only. */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { mock } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');

const workspace = id(1), actor = id(2), sessionId = id(3), artifact = id(4), revision = 'a'.repeat(64);
const origin = 'https://citation-fixture.invalid', anonKey = 'synthetic-public-anon-key';
const fixtureExpiresAt = Math.floor(Date.now() / 1000) + 3600;
const user = { id: actor, email: 'owner@fixture.invalid', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-10-01T00:00:00Z' };
function session(expired = false) {
  const expiresAt = fixtureExpiresAt - (expired ? 7200 : 0);
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: actor, session_id: sessionId, role: 'authenticated', aud: 'authenticated', exp: expiresAt })).toString('base64url'),
    Buffer.from('synthetic-signature-not-a-live-credential').toString('base64url')].join('.');
  return { access_token: token, refresh_token: 'synthetic-refresh-token', expires_at: expiresAt, expires_in: 3600, token_type: 'bearer', user };
}
const state = { mode: 'success', enabled: true, cookies: [], expectedToken: '', rpcCalls: 0, authCalls: 0,
  refreshCalls: 0, cookieWrites: 0, aborts: 0, networkAttempts: 0, requests: [], signals: [], contractReads: [], warnings: [], transportErrors: [] };
const resetCookies = ({ chunked = false, expired = false, absent = false } = {}) => {
  const stored = session(expired), key = 'sb-citation-fixture-auth-token';
  state.expectedToken = stored.access_token;
  const value = `base64-${Buffer.from(JSON.stringify(stored)).toString('base64url')}`;
  state.cookies = [{ name: 'vaeroex_workspace_id', value: workspace }, ...(absent ? [] : chunked
    ? [{ name: `${key}.0`, value: value.slice(0, 320) }, { name: `${key}.1`, value: value.slice(320) }]
    : [{ name: key, value }])];
};
// Match the retained bundle's structure, without copying production data: one
// legacy Xero original plus five Sheets originals; only three appear as citations.
const sheets = Array.from({ length: 5 }, (_, index) => ({
  identity: { kind: 'sheets_ticket_source', source_id: id(20 + index), version_id: id(30 + index), authority_hash: String(index + 1).repeat(64) },
  hash: String(index + 1).repeat(64),
  data: { provider: 'google_sheets', workspace_id: workspace, entity_id: id(40), connection_id: id(41),
    date: `2026-10-${String(14 + index).padStart(2, '0')}`, time_zone: 'UTC',
    metrics: [{ metric: 'Synthetic dispatches', value: '6', unit: 'count' }, { metric: 'Synthetic backlog', value: '4', unit: 'count' }],
    eligibility: { private: 'PRIVATE_SHEETS_AUTHORITY' }, read_sources: [{ table: 'synthetic_roots', id: id(50 + index) }] }
}));
const xero = { identity: { kind: 'legacy_reference', reference_id: id(60) }, hash: '6'.repeat(64),
  data: { provider: 'xero', workspace_id: workspace, business_entity_id: id(40), connection_id: id(61),
    period_start: '2026-09-26', period_end: '2026-10-25', scope: 'connected_account',
    records: [{ key: ['xero', id(61), 'synthetic-bill'], day: '2026-10-13', metrics: [
      { key: 'invoices', value: 0, currency: 'USD' }, { key: 'billed', value: 0, currency: 'USD' },
      { key: 'outstanding', value: 0, currency: 'USD' }, { key: 'bills', value: 1, currency: 'USD' }, { key: 'purchases', value: 10, currency: 'USD' }] }],
    read_sources: [], eligibility: { private: 'PRIVATE_XERO_AUTHORITY' } } };
const packet = { stage: 'revalidated_saved_evidence', artifact_kind: 'vsi_exchange', artifact_id: artifact,
  artifact_revision: revision, manifest_ids: [id(70)], projections: [sheets[0], xero, ...sheets.slice(1)] };
const cited = [xero, sheets[0], sheets[1]];
const saved = { id: artifact, userMessage: 'Synthetic retained question; no new question submitted.',
  answer: 'Stored observations [B1] [B2] [B3].', createdAt: '2026-10-25T22:00:21Z',
  citations: cited.map((source, index) => ({ id: `B${index + 1}`, title: source.data.provider,
    url: `/app/sources/evidence/vsi_exchange/${artifact}?workspace=${workspace}#source-${source.hash}`,
    sourceType: `shared_${source.data.provider}`, sourceId: source.hash, evidenceDate: null,
    retrievedAt: '2026-10-25T21:59:41Z', snapshotHash: String(index + 7).repeat(64) })) };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const nativeFetch = async (input, options = {}) => {
  const url = new URL(input), headers = new Headers(options.headers);
  assert.equal(url.origin, origin, 'no provider, production, or external URL is allowed');
  assert.equal(headers.get('apikey'), anonKey);
  if (url.pathname === '/auth/v1/token') {
    state.refreshCalls++; assert.equal(url.searchParams.get('grant_type'), 'refresh_token');
    assert.equal(JSON.parse(options.body).refresh_token, 'synthetic-refresh-token');
    const refreshed = session(); state.expectedToken = refreshed.access_token; return json(refreshed);
  }
  assert.equal(headers.get('authorization'), `Bearer ${state.expectedToken}`, 'the actual SSR client must derive the token from its cookie session');
  if (url.pathname === '/auth/v1/user') { state.authCalls++; return json(user); }
  if (url.pathname === '/rest/v1/profiles') { assert.equal(url.searchParams.get('id'), `eq.${actor}`); return json([user]); }
  if (url.pathname === '/rest/v1/workspace_members') {
    assert.equal(url.searchParams.get('user_id'), `eq.${actor}`); assert.equal(url.searchParams.get('status'), 'eq.active');
    return json([{ workspace_id: workspace, user_id: actor, role: 'owner', status: 'active',
      workspaces: { id: workspace, name: 'Synthetic workspace', subscription_status: 'active', subscription_required: false } }]);
  }
  if (url.pathname === '/rest/v1/workspaces') { assert.equal(url.searchParams.get('id'), `eq.${workspace}`); return json([{ id: workspace, subscription_status: 'active', subscription_required: false }]); }
  if (url.pathname === '/rest/v1/customer_subscriptions') { assert(url.searchParams.get('or').includes(`workspace_id.eq.${workspace}`)); return json([]); }
  assert.equal(url.pathname, '/rest/v1/rpc/reopen_shared_evidence_target_v1');
  assert.equal(options.method, 'POST');
  const args = JSON.parse(options.body);
  assert.deepEqual(args, { p_workspace_id: workspace, p_artifact_kind: 'vsi_exchange', p_artifact_id: artifact });
  assert(!url.hash, 'fragment selection never narrows the protected saved-artifact read');
  state.rpcCalls++; state.requests.push(args); state.signals.push(options.signal);
  assert(options.signal instanceof AbortSignal);
  options.signal.addEventListener('abort', () => { state.aborts++; }, { once: true });
  // Synthetic protected-response contract only. This is not execution or proof
  // of SQL revalidation: every manifest original participates in this fixture.
  state.contractReads.push(packet.projections.map(source => source.hash));
  const unavailable = new Set(state.mode === 'uncited_changed' ? [sheets.at(-1).hash] : []);
  if (packet.projections.some(source => unavailable.has(source.hash))) {
    assert(!cited.some(source => unavailable.has(source.hash)), 'the rejected original is outside the displayed citation subset');
    return json({ code: '40001', message: 'shared_evidence_source_changed', details: 'PRIVATE_UNCITED_SHEET' }, 409);
  }
  if (state.mode === 'rpc_denied') return json({ code: '42501', message: 'evidence_live_session_required', details: 'PRIVATE_SESSION_DETAIL' }, 403);
  if (state.mode === 'unknown_error') return json({ code: 'PRIVATE_UNAPPROVED_CODE', message: 'PRIVATE_SQL_DETAIL', hint: 'PRIVATE_HINT' }, 500);
  if (state.mode === 'transport_failure') throw new Error('PRIVATE_TRANSPORT_DETAIL');
  if (state.mode === 'invalid_json') return new Response('{PRIVATE_INVALID_JSON', { status: 200 });
  if (state.mode === 'empty_success') return new Response(null, { status: 204 });
  if (state.mode === 'stall' || state.mode === 'ignore_abort') {
    const ignore = state.mode === 'ignore_abort';
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
      if (!ignore) reject(new DOMException('PRIVATE_ABORT_DETAIL', 'AbortError'));
    }, { once: true }));
  }
  const response = structuredClone(packet);
  if (state.mode === 'malformed_stage') response.stage = 'unadmitted';
  if (state.mode === 'wrong_artifact') response.artifact_id = id(99);
  if (state.mode === 'invalid_hash') response.projections[0].hash = 'PRIVATE_INVALID_HASH';
  if (state.mode === 'foreign_projection') response.projections.at(-1).data.workspace_id = id(99);
  return json(state.mode === 'wrong_envelope' ? { data: response, error: null } : response);
};
global.fetch = (...args) => nativeFetch(...args).catch(error => {
  if (error instanceof assert.AssertionError) state.transportErrors.push(error.message);
  throw error;
});
require('node:net').Socket.prototype.connect = () => { state.networkAttempts++; throw new Error('unmocked_network_forbidden'); };
const originalWarn = console.warn;
console.warn = (...args) => { state.warnings.push(args); };
installLoader({
  'server-only': {},
  'next/navigation': { notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: url => { throw new Error(`NEXT_REDIRECT:${url}`); } },
  'next/headers': { cookies: async () => ({ get: key => state.cookies.find(cookie => cookie.name === key),
    getAll: () => state.cookies.map(cookie => ({ ...cookie })), set: () => { state.cookieWrites++; throw new Error('Server Component cookies are read-only'); } }) },
  '@/lib/supabase/config': { getSupabaseConfig: () => ({ url: origin, anonKey }) },
  '@/lib/admin/admin-emails': { isVaeroexAdminUser: () => false, isVaeroexAdminEmail: () => false },
  '@/lib/ai/shared-evidence/runtime-gate': { sharedEvidenceRuntimeEnabled: () => state.enabled },
  '@/components/vsi/SaveVsiAnalysis': { SaveVsiAnalysis: () => { throw new Error('save_action_forbidden'); } }
});
// Do not mock createSupabaseServerClient, auth.getUser, table builders or RPC.
const Page = require('../app/app/sources/evidence/[kind]/[id]/page.tsx').default;
const { Exchange } = require('../components/vsi/Exchange.tsx');
const invoke = async href => {
  const url = new URL(href, 'https://app-fixture.invalid');
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ kind: 'vsi_exchange', id: url.pathname.split('/').at(-1) }),
    searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) }));
};
function diagnostics(start) {
  const warnings = state.warnings.slice(start).filter(args => args[0] === '[shared-citation]');
  assert.equal(warnings.length, 1);
  const value = warnings[0][1];
  assert.deepEqual(Object.keys(value).sort(), ['category', 'elapsedMs', 'httpStatus', 'reason', 'sqlCode', 'stage']);
  assert(Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 60000);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|00000000-|synthetic|Bearer|eyJ|https?:|[a-f0-9]{64}/);
  return value;
}
(async () => {
  resetCookies();
  const beforeSaved = JSON.stringify(saved), beforePacket = JSON.stringify(packet);
  const markup = renderToStaticMarkup(React.createElement(Exchange, { exchange: saved, canEditNotes: false,
    saving: false, disabled: false, workspaceName: 'Synthetic', onRemember() { throw new Error('write_forbidden'); } }));
  const links = [...markup.matchAll(/href="([^"]*\/sources\/evidence\/[^"]*)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
  assert.deepEqual(links, saved.citations.map(citation => citation.url));
  for (const href of links) {
    const rendered = await invoke(href); assert.deepEqual(state.transportErrors, []);
    assert.match(rendered, /Saved evidence/); assert.equal((rendered.match(/<section /g) || []).length, 6);
    for (const source of packet.projections) assert(rendered.includes(`id="source-${source.hash}"`));
    assert.doesNotMatch(rendered, /PRIVATE_|read_sources|Source unavailable/);
  }
  assert.equal(new Set(state.requests.map(args => JSON.stringify(args))).size, 1);
  assert(state.contractReads.every(read => read.length === 6));
  resetCookies({ chunked: true }); assert.match(await invoke(links[0]), /Saved evidence/);
  resetCookies({ expired: true }); assert.match(await invoke(links[0]), /Saved evidence/);
  assert(state.refreshCalls > 0); assert(state.cookieWrites > 0, 'actual SSR refresh tolerates read-only Server Component cookies');
  resetCookies();
  const expected = {
    uncited_changed: ['rpc_read', 'stale_binding', '40001', 409], rpc_denied: ['rpc_read', 'authorization', '42501', 403],
    unknown_error: ['rpc_read', 'rpc_failure', null, 500], transport_failure: ['rpc_read', 'transport', null, 0],
    invalid_json: ['rpc_read', 'transport', null, 0], empty_success: ['envelope', 'response_validation', null, null],
    malformed_stage: ['envelope', 'response_validation', null, null], wrong_artifact: ['envelope', 'response_validation', null, null],
    invalid_hash: ['envelope', 'response_validation', null, null], foreign_projection: ['projection', 'projection_validation', null, null],
    wrong_envelope: ['envelope', 'response_validation', null, null]
  };
  const categories = {};
  for (const mode of Object.keys(expected)) {
    state.mode = mode;
    for (const href of [links[0], links[1]]) {
      const beforeCalls = state.rpcCalls, beforeWarnings = state.warnings.length;
      const rendered = await invoke(href); assert.match(rendered, /Source unavailable/);
      assert.doesNotMatch(rendered, /<section |PRIVATE_|Synthetic dispatches/);
      assert.equal(state.rpcCalls, beforeCalls + 1, 'single protected read; no retry or fragment-only fallback');
      const diagnostic = diagnostics(beforeWarnings);
      assert.deepEqual([diagnostic.stage, diagnostic.category, diagnostic.sqlCode, diagnostic.httpStatus], expected[mode]);
      categories[mode] = diagnostic.category;
    }
  }
  for (const mode of ['stall', 'ignore_abort']) {
    state.mode = mode; const beforeCalls = state.rpcCalls, beforeAborts = state.aborts, beforeWarnings = state.warnings.length;
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let settled = false; const pending = invoke(links[0]).then(value => { settled = true; return value; });
      for (let turn = 0; state.rpcCalls === beforeCalls && turn < 100; turn++) await nextTurn();
      assert.equal(state.rpcCalls, beforeCalls + 1);
      mock.timers.tick(9999); await nextTurn(); assert.equal(settled, false); assert.equal(state.aborts, beforeAborts);
      mock.timers.tick(1); await nextTurn(); assert.equal(settled, true); assert.match(await pending, /Source unavailable/);
      assert.equal(state.aborts, beforeAborts + 1); assert.equal(diagnostics(beforeWarnings).category, 'timeout');
    } finally { mock.timers.reset(); }
  }
  state.mode = 'success';
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const beforeAborts = state.aborts, beforeWarnings = state.warnings.length;
    assert.match(await invoke(links[0]), /Saved evidence/);
    const successfulSignal = state.signals.at(-1);
    mock.timers.tick(10000); await nextTurn();
    assert.equal(successfulSignal.aborted, false);
    assert.equal(state.aborts, beforeAborts, 'a successful read clears its deadline instead of aborting later');
    assert.equal(state.warnings.length, beforeWarnings);
  } finally { mock.timers.reset(); }
  state.mode = 'success'; resetCookies({ absent: true }); const beforeUnauthenticated = state.rpcCalls;
  await assert.rejects(invoke(links[0]), /NEXT_REDIRECT:\/login/); assert.equal(state.rpcCalls, beforeUnauthenticated);
  resetCookies(); state.enabled = false; const beforeGate = state.authCalls;
  await assert.rejects(invoke(links[0]), /NEXT_NOT_FOUND/); assert.equal(state.authCalls, beforeGate);
  assert.equal(JSON.stringify(saved), beforeSaved); assert.equal(JSON.stringify(packet), beforePacket);
  assert.deepEqual(state.transportErrors, []); assert.equal(state.networkAttempts, 0);
  console.log(JSON.stringify({ passed: true, actualExchangeLinks: 3, actualPageAndSSRClient: true,
    cookieDerivedAuthorization: true, chunkedCookieAndReadOnlyRefresh: true, savedManifestSources: 6, citedSubset: 3,
    rejectedRouteInvocations: 22, stalledInvocations: 2, categories, rawSavedBundleUnchanged: true,
    sqlExecuted: false, browserLaunched: false, hostedRootCauseProved: false, externalCalls: 0, modelCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { console.warn = originalWarn; });
