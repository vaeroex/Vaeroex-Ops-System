/* eslint-disable @typescript-eslint/no-require-imports -- Actual mapping route with synthetic authenticated context and RPC. */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { installLoader, ids } = require('./qbo-customer-test-support.cjs');
const headers = ['Record', 'Date', 'Revenue'];
const mapping = { rowKeyColumn: 0, dateColumn: 1, dateFormat: 'iso', locationColumn: null, metrics: [{ column: 2, name: 'Revenue', unit: 'currency', category: 'Financial', target: null }] };
let calls = [], permitted = true, connected = true;
Object.assign(process.env, { GOOGLE_SHEETS_ENABLED: 'true', VERCEL_ENV: 'production', GOOGLE_SHEETS_CLIENT_ID: 'synthetic-client', GOOGLE_SHEETS_CLIENT_SECRET: 'synthetic-secret', GOOGLE_SHEETS_REDIRECT_URI: 'https://www.vaeroex.com/api/integrations/google-sheets/callback', GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CRON_SECRET: 'synthetic-scheduler-secret-at-least-32-characters' });
installLoader({
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: ids.mapping, error: null }; } }) },
  '@/lib/integrations/google-sheets/route-helpers': {
    requireSheetsManager: async () => { if (!permitted) throw Error('google_sheets_management_denied'); return { workspaceId: ids.workspace, user: { id: ids.actor }, sessionId: ids.session }; },
    sheetsConnection: async (workspaceId, connectionId) => { assert.equal(workspaceId, ids.workspace); assert.equal(connectionId, ids.connection); return { status: connected ? 'connected' : 'disconnected', sheet_id: 0, headers }; },
    sheetsFailure: status => new Response(null, { status }),
    sheetsRedirect: (kind, code) => Response.redirect(`https://www.vaeroex.com/app/settings/integrations/google-sheets?${kind}=${code}`, 303)
  }
});
const { POST } = require('../app/api/integrations/google-sheets/mapping/route.ts');
const fields = { connectionId: ids.connection, fieldMapping: JSON.stringify(mapping), confirmation: 'approve', retentionConsent: 'true', automaticRefresh: 'true' };
function request(changes = {}, origin = 'https://www.vaeroex.com') {
  const data = { ...fields, ...changes }; for (const [key, value] of Object.entries(data)) if (value === undefined) delete data[key];
  return new Request('https://www.vaeroex.com/api/integrations/google-sheets/mapping', { method: 'POST', headers: { origin, host: 'www.vaeroex.com', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
}
(async () => {
  const saved = await POST(request()); assert.equal(saved.status, 303); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'approve_google_sheets_mapping_v1');
  assert.deepEqual(calls[0].args, { p_workspace_id: ids.workspace, p_connection_id: ids.connection, p_actor_id: ids.actor, p_session_id: ids.session, p_mapping: mapping, p_automatic_enabled: true, p_retention_consent: true });
  for (const changes of [{ retentionConsent: undefined }, { retentionConsent: 'false' }, { confirmation: undefined }, { workspaceId: ids.entity }, { p_retention_consent: 'true' }]) {
    const before = calls.length; assert.equal((await POST(request(changes))).status, 400); assert.equal(calls.length, before, 'invalid approval never reaches storage');
  }
  const before = calls.length; assert.equal((await POST(request({}, 'https://hostile.invalid'))).status, 400); assert.equal(calls.length, before);
  permitted = false; assert.equal((await POST(request())).status, 400); assert.equal(calls.length, before); permitted = true;
  connected = false; assert.equal((await POST(request())).status, 403); assert.equal(calls.length, before);
  console.log(JSON.stringify({ suite: 'Google Sheets mapping route explicit retention consent and trusted workspace', checks: 10, liveWrites: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
