/* eslint-disable @typescript-eslint/no-require-imports -- Actual server admission and routes with synthetic tenant/provider boundaries. */
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { installLoader, ids } = require('./qbo-customer-test-support.cjs');
let currentWorkspace = ids.workspace, role = 'owner', rpcCalls = 0, syncCalls = [], dueRows = [];
const access = () => ({ workspaceId: currentWorkspace, user: { id: ids.actor }, membership: { role, status: 'active', workspace_id: currentWorkspace, user_id: ids.actor }, supabase: { auth: { getClaims: async () => ({ data: { claims: { sub: ids.actor, session_id: ids.session } }, error: null }) } } });
const admin = { rpc: (name, args) => ({ abortSignal: async () => { rpcCalls++; assert.equal(name, 'due_google_sheets_syncs_v1'); return { data: dueRows.filter(row => !args.p_excluded_ids.includes(row.id)).slice(0, args.p_limit), error: null }; } }), from: table => {
  assert.equal(table, 'google_sheets_connections'); let allowed = [], excluded = [], limit = 0; const predicates = [];
  const query = { select(fields) { assert.equal(fields, 'id,workspace_id'); return this; }, in(field, values) { assert.equal(field, 'workspace_id'); allowed = values; return this; },
    eq(field, value) { predicates.push([field, value]); return this; }, not(field, operator, value) { if (field === 'id') { assert.equal(operator, 'in'); excluded = value.slice(1, -1).split(','); } else { assert.deepEqual([field, operator, value], ['active_approval_id', 'is', null]); predicates.push(['approved', true]); } return this; },
    lte(field) { assert.equal(field, 'next_sync_at'); predicates.push(['due', true]); return this; }, or(filter) { assert.match(filter, /^sync_lease_expires_at\.is\.null,sync_lease_expires_at\.lte\./); predicates.push(['lease', true]); return this; },
    order() { return this; }, limit(value) { assert(value <= 10); limit = value; return this; }, abortSignal: async () => {
      assert.deepEqual(predicates, [['status', 'connected'], ['automatic_refresh_enabled', true], ['approved', true], ['due', true], ['lease', true]]);
      return { data: dueRows.filter(row => allowed.includes(row.workspace_id) && !excluded.includes(row.id)).slice(0, limit), error: null };
    } }; return query;
}  };
installLoader({
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
  '@/lib/security/require-workspace-access': { requireWorkspaceAccess: async workspaceId => { if (workspaceId) assert.equal(workspaceId, currentWorkspace); return access(); } },
  '@/lib/security/require-auth': { requireAuth: async () => access() },
  '@/lib/security/get-current-workspace': { getCurrentWorkspace: async () => access() },
  '@/lib/integrations/google-sheets/sync': { runSheetsSync: async input => { syncCalls.push(input); return {}; } }
});
Object.assign(process.env, { GOOGLE_SHEETS_ENABLED: 'true', VERCEL_ENV: 'production', GOOGLE_SHEETS_CLIENT_ID: 'synthetic-client', GOOGLE_SHEETS_CLIENT_SECRET: 'synthetic-secret', GOOGLE_SHEETS_REDIRECT_URI: 'https://www.vaeroex.com/api/integrations/google-sheets/callback', GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CRON_SECRET: 'synthetic-scheduler-secret-at-least-32-characters' });
const server = require('../lib/integrations/google-sheets/server.ts');
const { requireSheetsManager } = require('../lib/integrations/google-sheets/route-helpers.ts');
const { runSheetsSync } = require('../lib/integrations/google-sheets/sync.ts');
const connect = require('../app/api/integrations/google-sheets/connect/route.ts');
const mapping = require('../app/api/integrations/google-sheets/mapping/route.ts');
const scheduler = require('../app/api/integrations/google-sheets/scheduled-sync/route.ts');
const post = (path, fields) => new Request('https://www.vaeroex.com/api/integrations/google-sheets/' + path, { method: 'POST', headers: { accept: 'application/json', origin: 'https://www.vaeroex.com', host: 'www.vaeroex.com', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
(async () => {
  delete process.env.GOOGLE_SHEETS_ALLOWED_WORKSPACE_IDS;
  assert.equal(server.sheetsWorkspaceAllowed(ids.workspace), true);
  for (const invalid of ['', ' ', '*', ids.workspace + ',invalid', ids.workspace + ',', Array(101).fill(ids.workspace).join(',')]) { process.env.GOOGLE_SHEETS_ALLOWED_WORKSPACE_IDS = invalid; assert.equal(server.sheetsWorkspaceAllowed(ids.workspace), false); }
  process.env.GOOGLE_SHEETS_ALLOWED_WORKSPACE_IDS = ' ' + ids.workspace.toUpperCase() + ' , ' + ids.entity;
  assert.equal(server.sheetsWorkspaceAllowed(ids.workspace), true); assert.equal(server.sheetsWorkspaceAllowed(ids.entity), true); assert.equal(server.sheetsWorkspaceAllowed(ids.connection), false);
  assert.equal((await requireSheetsManager()).workspaceId, ids.workspace);
  currentWorkspace = ids.connection;
  await assert.rejects(requireSheetsManager(), /google_sheets_pilot_limited/);
  assert.equal((await requireSheetsManager(undefined, false)).workspaceId, currentWorkspace, 'cleanup remains available');
  for (const trigger of ['manual', 'scheduled']) await assert.rejects(runSheetsSync({ workspaceId: currentWorkspace, connectionId: ids.mapping, actorId: ids.actor, sessionId: ids.session, trigger }), /google_sheets_pilot_limited/);
  const deniedConnect = await connect.POST(post('connect', { businessEntityId: ids.entity, displayName: 'Synthetic pilot source' }));
  assert.equal(deniedConnect.status, 409); assert.match((await deniedConnect.json()).error, /selected pilot workspaces/);
  const deniedMapping = await mapping.POST(post('mapping', { connectionId: ids.mapping, fieldMapping: '{}', confirmation: 'approve', retentionConsent: 'true', automaticRefresh: 'true' }));
  assert.equal(new URL(deniedMapping.headers.get('location')).searchParams.get('error'), 'pilot_limited');
  assert.equal(rpcCalls, 0, 'denied tenant never reaches OAuth, mapping or sync storage');
  role = 'viewer'; currentWorkspace = ids.workspace; await assert.rejects(requireSheetsManager(), /management_denied/); role = 'owner';
  // Excluded tenants can exceed the entire normal scan budget. Scope before
  // applying the limit without syncing
  // them or writing failure/backoff fields to their existing records.
  dueRows = [...Array.from({ length: 125 }, () => ({ id: randomUUID(), workspace_id: ids.connection })), { id: ids.mapping, workspace_id: ids.workspace }];
  const result = await scheduler.GET(new Request('https://www.vaeroex.com/api/integrations/google-sheets/scheduled-sync', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  assert.equal(result.status, 200); assert.equal((await result.json()).attempted, 1); assert.equal(syncCalls.length, 1); assert.equal(syncCalls[0].workspaceId, ids.workspace);
  delete process.env.GOOGLE_SHEETS_ALLOWED_WORKSPACE_IDS; dueRows = [{ id: ids.mapping, workspace_id: ids.workspace }]; syncCalls = [];
  const unrestricted = await scheduler.GET(new Request('https://www.vaeroex.com/api/integrations/google-sheets/scheduled-sync', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  assert.equal(unrestricted.status, 200); assert(rpcCalls > 0, 'unset pilot continues using the fair canonical RPC'); assert.equal(syncCalls.length, 1);
  process.env.GOOGLE_SHEETS_ALLOWED_WORKSPACE_IDS = 'invalid'; syncCalls = [];
  const closed = await scheduler.GET(new Request('https://www.vaeroex.com/api/integrations/google-sheets/scheduled-sync', { headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }));
  assert.equal(closed.status, 200); assert.equal((await closed.json()).attempted, 0); assert.equal(syncCalls.length, 0);
  console.log(JSON.stringify({ suite: 'Google Sheets optional pilot workspace admission', checks: 30, liveWrites: 0, providerCalls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
