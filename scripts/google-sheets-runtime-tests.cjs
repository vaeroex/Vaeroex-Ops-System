/* eslint-disable @typescript-eslint/no-require-imports -- Focused synthetic test loads the actual TypeScript runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomBytes, randomUUID } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
let rpcHandler = async () => { throw Error('Unexpected RPC'); };
const admin = { rpc: (...args) => rpcHandler(...args) };
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin };
  return load.call(this, request, parent, isMain);
};
Object.assign(process.env, { GOOGLE_SHEETS_ENABLED: 'true', VERCEL_ENV: 'production',
  GOOGLE_SHEETS_CLIENT_ID: 'synthetic-client.apps.googleusercontent.com', GOOGLE_SHEETS_CLIENT_SECRET: 'synthetic-google-client-secret',
  GOOGLE_SHEETS_REDIRECT_URI: 'https://www.vaeroex.com/api/integrations/google-sheets/callback',
  GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CRON_SECRET: 'synthetic-scheduler-secret-at-least-32-characters', NEXT_PUBLIC_APP_URL: 'https://vaeroex.com' });
const api = require('../lib/integrations/google-sheets/server.ts');
const { validSheetsSchedulerSecret } = api;
const { runDueSheetsRefreshes } = require('../lib/integrations/google-sheets/scheduler.ts');
const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const ws = randomUUID(), conn = randomUUID();
const credential = (expired = false) => ({ accessToken: 'synthetic_access_token', refreshToken: 'synthetic_refresh_token',
  expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString() });
function context(token = credential()) {
  return { workspaceId: ws, connectionId: conn, generation: 3, credentialVersion: 7,
    ciphertext: api.encryptSheetsTokens(ws, conn, token, 3, 7), accessExpiresAt: token.expiresAt,
    state: 'connected', leaseId: null, refreshLeaseId: null, revocationPending: false };
}
let networkCalls = [];
let networkHandler = async () => { throw Error('Unexpected network'); };
global.fetch = async (url, init) => {
  const parsed = new URL(url); networkCalls.push({ url: parsed, init });
  assert(['https://accounts.google.com', 'https://oauth2.googleapis.com', 'https://sheets.googleapis.com'].includes(parsed.origin));
  assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
  return networkHandler(parsed, init);
};
async function main() {
  let checks = 0;
  const token = credential(), ciphertext = api.encryptSheetsTokens(ws, conn, token, 3, 7);
  assert.deepEqual(api.decryptSheetsTokens(ws, conn, ciphertext, 3, 7), token); checks++;
  assert.notEqual(api.encryptSheetsTokens(ws, conn, token, 3, 7), ciphertext); checks++;
  for (const values of [[randomUUID(), conn, 3, 7], [ws, randomUUID(), 3, 7], [ws, conn, 4, 7], [ws, conn, 3, 8]]) {
    assert.throws(() => api.decryptSheetsTokens(values[0], values[1], ciphertext, values[2], values[3]), /ciphertext_invalid/); checks++;
  }
  const packed = Buffer.from(ciphertext.slice(4), 'base64url'); packed[30] ^= 1;
  assert.throws(() => api.decryptSheetsTokens(ws, conn, `gs2.${packed.toString('base64url')}`, 3, 7), /ciphertext_invalid/); checks++;
  const state = randomBytes(32).toString('base64url'), auth = api.sheetsAuthorizationUrl(state);
  assert.equal(auth.origin, 'https://accounts.google.com'); assert.equal(auth.searchParams.get('scope'), scope);
  assert.equal(auth.searchParams.get('access_type'), 'offline'); assert.equal(auth.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(auth.searchParams.get('redirect_uri'), process.env.GOOGLE_SHEETS_REDIRECT_URI); checks+=5;
  assert.throws(() => api.sheetsStateHash('short')); checks++;
  process.env.GOOGLE_SHEETS_ENABLED = 'false'; assert.equal(api.sheetsEnabled(), false); checks++;
  process.env.GOOGLE_SHEETS_ENABLED = 'true'; assert.equal(api.sheetsConfiguration().appOrigin, 'https://www.vaeroex.com'); checks++;
  const configuredCron = process.env.CRON_SECRET; delete process.env.CRON_SECRET; assert.equal(api.sheetsEnabled(), false); checks++;
  process.env.CRON_SECRET = configuredCron;
  const request = body => new Request('https://www.vaeroex.com/api/integrations/google-sheets/mapping', {
    method: 'POST', headers: { host: 'www.vaeroex.com', origin: 'https://www.vaeroex.com', 'content-type': 'application/x-www-form-urlencoded' }, body });
  api.assertSheetsOrigin(request('connectionId=synthetic')); checks++;
  const foreign = new Request('https://www.vaeroex.com/api/integrations/google-sheets/mapping', {
    method: 'POST', headers: { host: 'www.vaeroex.com', origin: 'https://attacker.test' }, body: 'x=y' });
  assert.throws(() => api.assertSheetsOrigin(foreign), /origin_denied/); checks++;
  await assert.rejects(api.readSheetsForm(request('a=1&a=2')), /duplicate/); checks++;
  await assert.rejects(api.readSheetsForm(request('a=%zz')), URIError); checks++;
  await assert.rejects(api.readSheetsForm(request('a=12345'), 3), /too_large/); checks++;
  networkHandler = async (_url, init) => {
    assert.equal(init.body.get('grant_type'), 'authorization_code');
    return Response.json({ access_token: token.accessToken, refresh_token: token.refreshToken, expires_in: 3600, token_type: 'Bearer', scope });
  };
  assert.equal((await api.exchangeSheetsCode('synthetic-code')).refreshToken, token.refreshToken); checks++;
  for (const badScope of ['https://www.googleapis.com/auth/drive.readonly', `${scope} https://www.googleapis.com/auth/drive`, undefined]) {
    networkHandler = async () => Response.json({ access_token: token.accessToken, refresh_token: token.refreshToken, expires_in: 3600, token_type: 'Bearer', scope: badScope });
    await assert.rejects(api.exchangeSheetsCode('synthetic-code'), /scope_mismatch/); checks++;
  }
  // Refresh is serialized by the SQL lease; no refresh occurs before claim.
  let row = context(credential(true)), claimed = false;
  rpcHandler = async (name, args) => {
    assert.equal(name, 'google_sheets_lifecycle_v1'); assert.equal(args.p_workspace_id, ws); assert.equal(args.p_connection_id, conn);
    if (args.p_operation === 'credential') return { data: row, error: null };
    if (args.p_operation === 'claim_refresh') { assert.equal(args.p_payload.credentialVersion, 7); claimed = true; row = { ...row, refreshLeaseId: args.p_payload.leaseId }; return { data: row, error: null }; }
    if (args.p_operation === 'commit_refresh') {
      assert.equal(args.p_payload.credentialVersion, 8); assert.equal(args.p_payload.leaseId, row.refreshLeaseId);
      row = { ...row, credentialVersion: 8, ciphertext: args.p_payload.ciphertext, accessExpiresAt: args.p_payload.accessExpiresAt, refreshLeaseId: null };
      return { data: row, error: null };
    }
    throw Error('Unexpected operation');
  };
  networkHandler = async (_url, init) => {
    assert(claimed); assert.equal(init.body.get('grant_type'), 'refresh_token');
    return Response.json({ access_token: 'synthetic_renewed_access', expires_in: 3600, token_type: 'Bearer', scope });
  };
  assert.equal(await api.sheetsAccessToken(ws, conn), 'synthetic_renewed_access');
  assert.equal(api.decryptSheetsTokens(ws, conn, row.ciphertext, 3, 8).refreshToken, token.refreshToken); checks+=2;
  const before = networkCalls.length; await api.sheetsAccessToken(ws, conn); assert.equal(networkCalls.length, before); checks++;
  // A refresh whose persistence response is lost is reconciled, not exchanged again.
  row = context(credential(true)); let commits = 0;
  const successfulRpc = rpcHandler;
  rpcHandler = async (name, args) => {
    const result = await successfulRpc(name, args);
    if (args.p_operation === 'commit_refresh') { commits++; throw Error('lost acknowledgement'); }
    return result;
  };
  assert.equal(await api.sheetsAccessToken(ws, conn), 'synthetic_renewed_access'); assert.equal(commits, 1); checks+=2;
  // Wrong-workspace DB context fails before decrypt or network.
  rpcHandler = async () => ({ data: { ...row, workspaceId: randomUUID() }, error: null });
  await assert.rejects(api.sheetsAccessToken(ws, conn), /context_denied/); checks++;
  // Busy refresh never dispatches another provider refresh.
  row = context(credential(true));
  rpcHandler = async (_name, args) => ({ data: args.p_operation === 'credential' ? row : null, error: args.p_operation === 'credential' ? null : {} });
  const blockedAt = networkCalls.length; await assert.rejects(api.sheetsAccessToken(ws, conn)); assert.equal(networkCalls.length, blockedAt); checks++;
  // Invalid grant requests reauthorization but never leaks provider response text.
  let reauthorize = null;
  row = context(credential(true));
  rpcHandler = async (_name, args) => {
    if (args.p_operation === 'claim_refresh') row = { ...row, refreshLeaseId: args.p_payload.leaseId };
    if (args.p_operation === 'fail_refresh') reauthorize = args.p_payload.reauthorize;
    return { data: row, error: null };
  };
  networkHandler = async () => Response.json({ error: 'invalid_grant', error_description: 'sensitive provider message' }, { status: 400 });
  await assert.rejects(api.sheetsAccessToken(ws, conn), /^Error: google_sheets_authorization_required$/); assert.equal(reauthorize, true); checks+=2;
  networkHandler = async () => Response.json({}, { status: 503 });
  await assert.rejects(api.revokeSheetsToken(token.refreshToken), /revocation_pending/); checks++;
  networkHandler = async () => Response.json({ error: 'invalid_token' }, { status: 400 });
  await api.revokeSheetsToken(token.refreshToken); checks++;
  networkHandler = async () => new Response(null, { status: 200 }); await api.revokeSheetsToken(token.refreshToken); checks++;
  // Discovery and reads can only address a validated ID at the fixed Sheets API.
  row = context(); let markedReauthorization = false;
  rpcHandler = async (_name, args) => {
    if (args.p_operation === 'mark_reauthorization') {
      assert.equal(args.p_payload.generation, row.generation);
      assert.equal(args.p_payload.credentialVersion, row.credentialVersion);
      markedReauthorization = true;
    }
    return { data: row, error: null };
  };
  const spreadsheetId = 'syntheticSpreadsheetId0123456789';
  networkHandler = async url => {
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(url.pathname, `/v4/spreadsheets/${spreadsheetId}`);
    return Response.json({ spreadsheetId, properties: { title: 'Operations' }, sheets: [
      { properties: { sheetId: 0, title: 'Metrics', sheetType: 'GRID', gridProperties: { rowCount: 1200 } } },
      { properties: { sheetId: 1, title: 'Other', sheetType: 'OBJECT' } }
    ] });
  };
  assert.deepEqual(await api.sheetsMetadata(ws, conn, spreadsheetId), { title: 'Operations', tabs: [{ id: 0, title: 'Metrics', rowCount: 1200 }] }); checks++;
  const invalidAt = networkCalls.length;
  await assert.rejects(api.sheetsMetadata(ws, conn, '../attacker'));
  assert.equal(networkCalls.length, invalidAt); checks++;
  networkHandler = async url => {
    assert.equal(url.pathname, `/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
    assert.deepEqual(url.searchParams.getAll('ranges'), ["'Metrics'!A2:A10", "'Metrics'!B2:B10"]);
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    return Response.json({ valueRanges: [{ values: [['row1']] }, { values: [[12.5]] }] });
  };
  assert.deepEqual(await api.sheetsMappedColumns(ws, conn, spreadsheetId, ["'Metrics'!A2:A10", "'Metrics'!B2:B10"], 'UNFORMATTED_VALUE'), [[['row1']], [[12.5]]]); checks++;
  networkHandler = async () => Response.json({ error: { message: 'private provider message' } }, { status: 401 });
  await assert.rejects(api.sheetsMetadata(ws, conn, spreadsheetId), /^Error: google_sheets_authorization_required$/);
  assert.equal(markedReauthorization, true); checks+=2;
  const schedulerSecret = randomBytes(32).toString('base64url');
  assert.equal(validSheetsSchedulerSecret(`Bearer ${schedulerSecret}`, schedulerSecret), true);
  assert.equal(validSheetsSchedulerSecret('Bearer wrong', schedulerSecret), false);
  assert.equal(validSheetsSchedulerSecret(null, schedulerSecret), false);
  assert.equal(validSheetsSchedulerSecret('Bearer short', 'short'), false); checks+=4;
  // One tick drains fresh pages, never exceeds 50 attempts, and stops at its deadline.
  let clock = Date.parse('2026-10-02T12:00:00.000Z'), dueCalls = 0;
  const remaining = Array.from({ length: 61 }, () => ({ id: randomUUID(), workspace_id: ws }));
  const original = [...remaining], attempted = [];
  const batchResult = await runDueSheetsRefreshes({ now: () => clock,
    due: async (tickAt, limit) => { dueCalls++; assert.equal(limit, 10); assert.equal(tickAt, '2026-10-02T12:00:00.000Z'); return remaining.slice(0, limit); },
    sync: async connection => { attempted.push(connection.id); remaining.splice(remaining.findIndex(item => item.id === connection.id), 1); clock += 1000; },
    backoff: async () => { throw Error('Unexpected backoff'); }
  });
  assert.deepEqual(batchResult, { attempted: 50, succeeded: 50, failed: 0 });
  assert.equal(dueCalls, 5); assert.equal(new Set(attempted).size, 50); assert.equal(remaining.length, 11); checks+=4;
  // A persistence outage can leave the same rows due; do not loop on them.
  let retries = 0, backoffs = 0, repeatedQueries = 0;
  const repeated = original.slice(0, 10);
  const failedBatch = await runDueSheetsRefreshes({ now: () => clock,
    due: async () => { repeatedQueries++; return repeated; },
    sync: async () => { retries++; throw Error('Synthetic claim failure'); },
    backoff: async () => { backoffs++; throw Error('Synthetic lost acknowledgement'); }
  });
  assert.deepEqual(failedBatch, { attempted: 10, succeeded: 0, failed: 10 });
  assert.equal(retries, 10); assert.equal(backoffs, 10); assert.equal(repeatedQueries, 2); checks+=4;
  clock = 0; let timedAttempts = 0;
  const timed = await runDueSheetsRefreshes({ now: () => clock, due: async () => original.slice(0, 10),
    sync: async () => { timedAttempts++; clock += 60_000; }, backoff: async () => {} });
  assert.deepEqual(timed, { attempted: 4, succeeded: 4, failed: 0 }); assert.equal(timedAttempts, 4); checks+=2;
  // A slow due lookup exhausting the budget must not start any provider work.
  clock = 0;
  const slowLookup = await runDueSheetsRefreshes({ now: () => clock,
    due: async () => { clock = 240_000; return original.slice(0, 10); },
    sync: async () => { throw Error('Unexpected provider work'); }, backoff: async () => {} });
  assert.equal(slowLookup.attempted, 0); checks++;
  console.log(`Google Sheets runtime: ${checks} focused checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
