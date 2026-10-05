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
const admin = { rpc: (...args) => ({ abortSignal: signal => rpcHandler(...args, signal) }) };
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
const { withSheetsRequest } = require('../lib/integrations/google-sheets/execution.ts');
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
  // The shared deadline aborts a slow response body, not merely fetch headers.
  row = context();
  rpcHandler = async (_name, args) => {
    assert.equal(args.p_operation, 'credential'); return { data: row, error: null };
  };
  let bodyCancelled = false, readSignal;
  networkHandler = async (_url, init) => {
    readSignal = init.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
      cancel() { bodyCancelled = true; }
    }));
  };
  await assert.rejects(api.sheetsMetadata(ws, conn, spreadsheetId,
    { deadlineAt: Date.now() + 150, cleanupDeadlineAt: Date.now() + 5000 }), /google_sheets_deadline_exceeded/);
  assert.equal(readSignal.aborted, true); assert.equal(bodyCancelled, true); checks+=3;
  // A token refresh receives the remaining deadline and cleans up with a fresh budget.
  row = context(credential(true)); let refreshCancelled = false, refreshCleanup = false;
  rpcHandler = async (_name, args, signal) => {
    if (args.p_operation === 'claim_refresh') return { data: { ...row, refreshLeaseId: args.p_payload.leaseId }, error: null };
    if (args.p_operation === 'fail_refresh') { assert.equal(signal.aborted, false); refreshCleanup = true; return { data: {}, error: null }; }
    assert.equal(args.p_operation, 'credential'); return { data: row, error: null };
  };
  networkHandler = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { refreshCancelled = true; reject(init.signal.reason); }, { once: true });
  });
  await assert.rejects(api.sheetsMetadata(ws, conn, spreadsheetId,
    { deadlineAt: Date.now() + 150, cleanupDeadlineAt: Date.now() + 5000 }), /google_sheets_deadline_exceeded/);
  assert.equal(refreshCancelled, true); assert.equal(refreshCleanup, true); checks+=3;
  // Per-request timeouts also abort the actual transport, even with a larger run budget.
  let requestAborted = false;
  await assert.rejects(withSheetsRequest(Date.now() + 1000, 10, signal => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { requestAborted = true; reject(signal.reason); }, { once: true });
  })), /google_sheets_request_timeout/);
  assert.equal(requestAborted, true); checks+=2;
  const schedulerSecret = randomBytes(32).toString('base64url');
  assert.equal(validSheetsSchedulerSecret(`Bearer ${schedulerSecret}`, schedulerSecret), true);
  assert.equal(validSheetsSchedulerSecret('Bearer wrong', schedulerSecret), false);
  assert.equal(validSheetsSchedulerSecret(null, schedulerSecret), false);
  assert.equal(validSheetsSchedulerSecret('Bearer short', 'short'), false); checks+=4;
  // One tick drains fresh pages, never exceeds 100 attempts, and stops at its deadline.
  let clock = Date.parse('2026-10-02T12:00:00.000Z'), dueCalls = 0;
  const remaining = Array.from({ length: 111 }, () => ({ id: randomUUID(), workspace_id: ws }));
  const original = [...remaining], attempted = [];
  const batchResult = await runDueSheetsRefreshes({ now: () => clock,
    due: async (tickAt, limit, _deadline, excluded) => { dueCalls++; assert.equal(limit, 10); assert.equal(tickAt, '2026-10-02T12:00:00.000Z'); return remaining.filter(c => !excluded.includes(c.id)).slice(0, limit); },
    sync: async (connection, execution) => {
      assert.equal(execution.deadlineAt, Date.parse('2026-10-02T12:04:00.000Z'));
      assert.equal(execution.cleanupDeadlineAt, Date.parse('2026-10-02T12:04:45.000Z'));
      attempted.push(connection.id); remaining.splice(remaining.findIndex(item => item.id === connection.id), 1); clock += 1000; },
    backoff: async () => { throw Error('Unexpected backoff'); }
  });
  assert.deepEqual(batchResult, { attempted: 100, succeeded: 100, failed: 0, deferred: 0, backoffFailed: 0, peakActive: 1, admissionRpcAttempts: 0, admissionRetries: 0, admissionWaitMs: 0 });
  assert.equal(dueCalls, 10); assert.equal(new Set(attempted).size, 100); assert.equal(remaining.length, 11); checks+=4;
  // A persistence outage can leave the same rows due; do not loop on them.
  let retries = 0, backoffs = 0, repeatedQueries = 0;
  const repeated = original.slice(0, 10);
  const failedBatch = await runDueSheetsRefreshes({ now: () => clock,
    due: async () => { repeatedQueries++; return repeated; },
    sync: async () => { retries++; throw Error('Synthetic claim failure'); },
    backoff: async () => { backoffs++; throw Error('Synthetic lost acknowledgement'); }
  });
  assert.deepEqual(failedBatch, { attempted: 10, succeeded: 0, failed: 10, deferred: 0, backoffFailed: 10, peakActive: 1, admissionRpcAttempts: 0, admissionRetries: 0, admissionWaitMs: 0 });
  assert.equal(retries, 10); assert.equal(backoffs, 10); assert.equal(repeatedQueries, 2); checks+=4;
  clock = 0; let timedAttempts = 0;
  const timed = await runDueSheetsRefreshes({ now: () => clock, due: async () => original.slice(0, 10),
    sync: async () => { timedAttempts++; clock += 60_000; }, backoff: async () => {} });
  assert.deepEqual(timed, { attempted: 4, succeeded: 4, failed: 0, deferred: 0, backoffFailed: 0, peakActive: 1, admissionRpcAttempts: 0, admissionRetries: 0, admissionWaitMs: 0 }); assert.equal(timedAttempts, 4); checks+=2;
  // A slow due lookup exhausting the budget must not start any provider work.
  clock = 0;
  const slowLookup = await runDueSheetsRefreshes({ now: () => clock,
    due: async () => { clock = 240_000; return original.slice(0, 10); },
    sync: async () => { throw Error('Unexpected provider work'); }, backoff: async () => {} });
  assert.equal(slowLookup.attempted, 0); checks++;
  clock = 0; let receivedBudget, cleanupAt;
  const nearlyExpired = await runDueSheetsRefreshes({ now: () => clock,
    due: async () => { clock = 239_999; return original.slice(0, 10); },
    sync: async (_connection, execution) => { receivedBudget = execution; clock = 240_000; throw Error('google_sheets_deadline_exceeded'); },
    backoff: async (_connection, _tickAt, deadlineAt) => { cleanupAt = deadlineAt; }
  });
  assert.deepEqual(nearlyExpired, { attempted: 1, succeeded: 0, failed: 1, deferred: 0, backoffFailed: 0, peakActive: 1, admissionRpcAttempts: 0, admissionRetries: 0, admissionWaitMs: 0 });
  assert.deepEqual(receivedBudget, { deadlineAt: 240_000, cleanupDeadlineAt: 285_000 });
  assert.equal(cleanupAt, 285_000); checks+=3;
  // A held workspace cannot prevent healthy tenants from using the other
  // slots. This uses real overlapping promises, not a serial virtual clock.
  const fairQueue = Array.from({ length: 20 }, (_, i) => ({ id: `fair-${i}`, workspace_id: `tenant-${i < 5 ? 0 : i}` }));
  let releaseSlow; const slow = new Promise(resolve => { releaseSlow = resolve; });
  let healthyFinished = 0, live = 0, maximumLive = 0; const liveTenants = new Set();
  const fair = await runDueSheetsRefreshes({
    due: async (_tick, limit, _deadline, excluded) => fairQueue.filter(c => !excluded.includes(c.id)).slice(0, limit),
    sync: async c => {
      assert(!liveTenants.has(c.workspace_id)); liveTenants.add(c.workspace_id);
      maximumLive = Math.max(maximumLive, ++live);
      if (c.id === 'fair-0') await slow;
      else { await new Promise(resolve => setTimeout(resolve, 2)); if (c.workspace_id !== 'tenant-0' && ++healthyFinished === 15) releaseSlow(); }
      live--; liveTenants.delete(c.workspace_id);
    }, backoff: async () => { throw Error('Unexpected backoff'); }
  });
  assert.equal(healthyFinished,15);assert.equal(fair.succeeded,20);assert.equal(maximumLive,4);assert.equal(fair.peakActive,4);checks+=4;
  let admissionBackoffs=0;
  const deferred = await runDueSheetsRefreshes({ due: async (_tick,limit,_deadline,excluded) => fairQueue.filter(c=>!excluded.includes(c.id)).slice(0,limit),
    sync: async () => { throw Error('google_sheets_capacity_busy'); }, backoff: async () => { admissionBackoffs++; } });
  assert.equal(deferred.deferred,20);assert.equal(deferred.failed,0);assert.equal(admissionBackoffs,0);checks+=3;
  // If a later due query fails, return only after already-started work settles.
  let queries=0,finished=false,releaseOutstanding;
  const outstanding=new Promise(resolve=>{releaseOutstanding=resolve;});
  const queryFailure=runDueSheetsRefreshes({ due: async () => { if (++queries===1) return [fairQueue[0]]; setTimeout(releaseOutstanding,5); throw Error('due_unavailable'); },
    sync: async () => { await outstanding;finished=true; },backoff:async()=>{} });
  await assert.rejects(queryFailure,/due_unavailable/);assert.equal(finished,true);checks+=2;
  // Four external/manual leases occupy every slot for five seconds. Queued
  // scheduled work must wait inside this tick rather than next quarter-hour.
  clock=0;const admissionAttempts=[],admitted=[];
  const overlap=await runDueSheetsRefreshes({now:()=>clock,wait:async milliseconds=>{clock+=milliseconds;},
    due:async(_tick,limit,_deadline,excluded)=>fairQueue.filter(c=>!excluded.includes(c.id)).slice(0,limit),
    sync:async(c,_execution,admission)=>{await admission.run(async()=>{admissionAttempts.push(clock);if(clock<5000)throw Error('google_sheets_capacity_busy');});admitted.push(clock);},
    backoff:async()=>{throw Error('Busy admission is not an accepted failure');}});
  assert.equal(overlap.succeeded,20);assert.equal(overlap.deferred,0);assert.equal(overlap.admissionRpcAttempts,25);
  assert.equal(overlap.admissionRetries,5);assert.deepEqual(admissionAttempts.slice(0,6),[0,1000,2000,3000,4000,5000]);
  assert(admitted.every(at=>at>=5000&&at<=30000));checks+=6;
  clock=0;const workspaceAdmission=[];
  const {createSheetsScheduledAdmission}=require('../lib/integrations/google-sheets/scheduler.ts');
  const shared=createSheetsScheduledAdmission(10000,()=>clock,async ms=>{clock+=ms;});
  await Promise.all([shared.run(async()=>{if(clock<5000)throw Error('google_sheets_workspace_busy');workspaceAdmission.push(['busy',clock]);}),
    shared.run(async()=>{workspaceAdmission.push(['healthy',clock]);})]);
  assert.equal(workspaceAdmission[0][0],'healthy');assert(workspaceAdmission[0][1]<5000);checks+=2;
  clock=0;const bounded=createSheetsScheduledAdmission(2500,()=>clock,async ms=>{clock+=ms;});
  await assert.rejects(bounded.run(async()=>{throw Error('google_sheets_capacity_busy');}),/capacity_busy/);
  assert.equal(clock,2500);assert.equal(bounded.metrics().admissionRpcAttempts,3);checks+=3;
  const recoveryRoute = require('../app/api/integrations/google-sheets/recover-syncs/route.ts');
  let recoveryCalls=0;
  rpcHandler=async(name,args)=>{recoveryCalls++;assert.equal(name,'recover_google_sheets_syncs_v1');assert.equal(args.p_limit,100);
    return {data:{recovered:1,skipped:0,remainingExpired:0,oldestExpiredSeconds:0},error:null};};
  assert.equal((await recoveryRoute.GET(new Request('http://localhost/api/integrations/google-sheets/recover-syncs'))).status,401);
  assert.equal(recoveryCalls,0);checks+=2;
  const recoveryRequest=()=>new Request('http://localhost/api/integrations/google-sheets/recover-syncs',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});
  process.env.GOOGLE_SHEETS_ENABLED='false';
  assert.equal((await recoveryRoute.GET(recoveryRequest())).status,200);assert.equal(recoveryCalls,1);checks+=2;
  rpcHandler=async()=>({data:{recovered:0,skipped:1,remainingExpired:1,oldestExpiredSeconds:5},error:null});
  assert.equal((await recoveryRoute.GET(recoveryRequest())).status,503);checks++;
  rpcHandler=async()=>({data:null,error:{message:'synthetic private database detail'}});
  const unavailable=await recoveryRoute.GET(recoveryRequest());assert.equal(unavailable.status,503);
  assert.equal((await unavailable.text()).includes('private'),false);checks+=2;
  console.log(`Google Sheets runtime: ${checks} focused checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
