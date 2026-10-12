/* eslint-disable @typescript-eslint/no-require-imports -- Real local Sheets fixture, synthetic provider credentials only. */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const ts = require('typescript');
const { openState, writePrivate, loopback, sha } = require('./workspace-capacity-state.cjs');
const root = path.resolve(__dirname, '..');
const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const mapping = { rowKeyColumn: 0, dateColumn: 1, dateFormat: 'iso', locationColumn: null,
  metrics: [{ column: 2, name: 'Synthetic orders', unit: 'count', category: 'Operations', target: null }] };
function readRuntime(file) {
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'private_runtime_required');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(cfg.syntheticOnly === true && cfg.paidCredentialsPresent === false && cfg.runId && cfg.providerManifest && cfg.sheetsEncryptionKey, 'synthetic_runtime_required');
  loopback(cfg.appOrigin, ['https:']); loopback(cfg.stubOrigin, ['http:']); return cfg;
}
function loadEncryption() {
  const originalResolve = Module._resolveFilename, originalTs = require.extensions['.ts'];
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'server-only') return path.join(root, 'scripts/test-stubs/server-only.js');
    return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, isMain, options);
  };
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename }).outputText, filename);
  try { return require('../lib/integrations/google-sheets/server.ts'); }
  finally { Module._resolveFilename = originalResolve; if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts']; }
}
function withEncryptionConfiguration(cfg, fn) {
  const values = { GOOGLE_SHEETS_ENABLED: 'true', GOOGLE_SHEETS_CLIENT_ID: 'synthetic-capacity-client', GOOGLE_SHEETS_CLIENT_SECRET: 'synthetic-capacity-secret',
    GOOGLE_SHEETS_REDIRECT_URI: cfg.appOrigin + '/api/integrations/google-sheets/callback', GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY: cfg.sheetsEncryptionKey,
    CRON_SECRET: cfg.cronSecret, NEXT_PUBLIC_APP_URL: cfg.appOrigin, VERCEL_ENV: undefined };
  const original = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  try { for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } return fn(loadEncryption()); }
  finally { for (const [k, v] of Object.entries(original)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const checked = (r, code) => { assert(!r.error, code + (r.error?.code ? ':' + r.error.code : '')); return r.data; };
async function seedFixtures({ state, runtimeFile, resumeUnapprovedFixture = false }) {
  const cfg = readRuntime(runtimeFile); assert.equal(state.plan.runId, cfg.runId); assert.equal(state.progress.completed, true, 'full_corpus_first');
  const existing = (await state.db.query('select count(*)::int n from public.google_sheets_connections where workspace_id=any($1::uuid[])', [state.ids])).rows[0].n;
  assert(existing === 0 || resumeUnapprovedFixture, 'new_provider_cohort_only');
  if (fs.existsSync(cfg.providerManifest)) {
    assert.equal(fs.statSync(cfg.providerManifest).mode & 0o077, 0, 'private_manifest_required');
    const old = JSON.parse(fs.readFileSync(cfg.providerManifest, 'utf8')); assert(!old.connections?.length, 'provider_manifest_nonempty');
  }
  const manifest = { runId: cfg.runId, syntheticOnly: true, mode: 'seeded_synthetic_oauth_result_actual_mapping_approval', connections: [] };
  writePrivate(cfg.providerManifest, manifest);
  for (const workspace of state.plan.workspaces) {
    const owner = state.plan.actors.find(a => a.workspaceId === workspace.id && a.role === 'owner');
    const session = state.sessions.actors[owner.id]; assert(session?.accessToken, 'real_owner_session_required');
    const verified = checked(await state.admin.auth.getUser(session.accessToken), 'owner_token_verify'); assert.equal(verified.user.id, owner.id);
    const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString('utf8')); assert(/^[a-f0-9-]{36}$/.test(claims.session_id), 'real_session_id_required');
    const live = (await state.db.query('select count(*)::int n from auth.sessions where id=$1 and user_id=$2 and (not_after is null or not_after>clock_timestamp())', [claims.session_id, owner.id])).rows[0].n; assert.equal(live, 1, 'session_must_exist');
    const prior = (await state.db.query('select c.id,c.business_entity_id,c.spreadsheet_id,c.created_by,c.display_name,c.status,c.active_approval_id,(select count(*)::int from public.google_sheets_credentials k where k.connection_id=c.id) credentials from public.google_sheets_connections c where c.workspace_id=$1', [workspace.id])).rows;
    assert(prior.length <= 1, 'ambiguous_fixture_resume');
    if (prior.length) assert(resumeUnapprovedFixture && prior[0].created_by === owner.id && prior[0].display_name === 'Synthetic capacity provider' && prior[0].status === 'connected' && prior[0].active_approval_id === null && prior[0].credentials === 0, 'only_exact_unapproved_empty_fixture_resume');
    const entityId = prior[0]?.business_entity_id || randomUUID(), connectionId = prior[0]?.id || randomUUID(), spreadsheetId = prior[0]?.spreadsheet_id || 'synthetic_capacity_' + randomBytes(18).toString('hex');
    const tokens = { accessToken: 'synthetic_access_' + randomBytes(24).toString('hex'), refreshToken: 'synthetic_refresh_' + randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() };
    const ciphertext = withEncryptionConfiguration(cfg, api => {
      const encrypted = api.encryptSheetsTokens(workspace.id, connectionId, tokens, 1, 1);
      assert.deepEqual(api.decryptSheetsTokens(workspace.id, connectionId, encrypted, 1, 1), tokens, 'actual_encryption_round_trip'); return encrypted;
    });
    // OAuth authorization/exchange is a declared synthetic seed, not a claim of
    // real Google consent. Approval below goes through the actual service RPC,
    // live Auth session, entitlement, owner role, tenant and entity checks.
    if (!prior.length) await state.db.query("insert into public.business_entities(id,workspace_id,entity_key,entity_type,display_name,base_currency,reporting_currency,timezone,status,created_by,updated_by) values($1,$2,$3,'operating_company','Synthetic capacity company','USD','USD','UTC','active',$4,$4)", [entityId, workspace.id, `capacity_${cfg.runId.replaceAll('-', '')}`, owner.id]);
    if (!prior.length) checked(await state.admin.from('google_sheets_connections').insert({ id: connectionId, workspace_id: workspace.id, business_entity_id: entityId, created_by: owner.id, status: 'connected', display_name: 'Synthetic capacity provider', spreadsheet_id: spreadsheetId, spreadsheet_title: 'Synthetic operations', tabs: [{ id: 0, title: 'Daily', rowCount: 101 }], sheet_id: 0, sheet_title: 'Daily', header_row: 1, headers: ['Key', 'Date', 'Orders'], generation: 1, credential_version: 1 }), 'seed_connection');
    await state.db.query('insert into public.google_sheets_credentials(connection_id,workspace_id,token_ciphertext,access_expires_at,granted_scope,generation,credential_version) values($1,$2,$3,$4,$5,1,1)', [connectionId, workspace.id, ciphertext, tokens.expiresAt, scope]);
    manifest.connections.push({ workspaceId: workspace.id, connectionId, spreadsheetId, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }); writePrivate(cfg.providerManifest, manifest);
    const approvalId = checked(await state.admin.rpc('approve_google_sheets_mapping_v1', { p_workspace_id: workspace.id, p_connection_id: connectionId, p_actor_id: owner.id, p_session_id: claims.session_id, p_mapping: mapping, p_automatic_enabled: true }), 'actual_mapping_approval');
    assert(/^[a-f0-9-]{36}$/.test(approvalId), 'durable_approval_required');
    workspace.sheetsConnectionId = connectionId; workspace.sheetsApprovalId = approvalId; workspace.businessEntityId = entityId;
    writePrivate(cfg.planFile, state.plan);
  }
  const verified = await verifyFixtures({ db: state.db, plan: state.plan, runtimeFile }); assert.equal(verified.ready, true, 'provider_fixture_readback_failed');
  state.progress.providerFixturesReady = true; state.progress.phase = 'provider_seeded_independent_inventory_pending'; state.saveProgress();
  writePrivate(path.join(state.outputDir, 'provider-seed-result.json'), verified); return verified;
}
async function verifyFixtures({ db, plan, runtimeFile, requireConnected = true }) {
  const cfg = readRuntime(runtimeFile); assert.equal(cfg.runId, plan.runId);
  assert.equal(fs.statSync(cfg.providerManifest).mode & 0o077, 0, 'private_provider_manifest_required');
  const manifest = JSON.parse(fs.readFileSync(cfg.providerManifest, 'utf8')); assert.equal(manifest.runId, plan.runId);
  const rows = (await db.query(`select c.id,c.workspace_id,c.status,c.spreadsheet_id,c.sheet_id,c.sheet_title,c.headers,c.field_mapping,c.active_approval_id,c.automatic_refresh_enabled,c.next_sync_at,c.generation,c.credential_version,
    a.id as approval_id,a.approved_by,a.field_mapping as approved_mapping,a.headers as approved_headers,
    e.status as entity_status,k.token_ciphertext,k.generation as token_generation,k.credential_version as token_version,k.granted_scope,
    m.role as approver_role,m.status as approver_status
    from public.google_sheets_connections c
    left join public.google_sheets_mapping_approvals a on a.workspace_id=c.workspace_id and a.connection_id=c.id and a.id=c.active_approval_id
    left join public.google_sheets_credentials k on k.workspace_id=c.workspace_id and k.connection_id=c.id
    left join public.business_entities e on e.workspace_id=c.workspace_id and e.id=c.business_entity_id
    left join public.workspace_members m on m.workspace_id=c.workspace_id and m.user_id=a.approved_by
    where c.workspace_id=any($1::uuid[]) order by c.workspace_id,c.id`, [plan.workspaces.map(w => w.id)])).rows;
  const observations = rows.map(row => {
    const fixture = manifest.connections.find(c => c.workspaceId === row.workspace_id && c.connectionId === row.id);
    let encryptedTokenBindingValid = false;
    if (fixture && row.token_ciphertext) {
      try { const token = withEncryptionConfiguration(cfg, api => api.decryptSheetsTokens(row.workspace_id, row.id, row.token_ciphertext, Number(row.token_generation), Number(row.token_version)));
        encryptedTokenBindingValid = token.accessToken === fixture.accessToken && token.refreshToken === fixture.refreshToken;
      } catch { /* Private ciphertext failure is reported without contents. */ }
    }
    const expectedOwner = plan.actors.find(a => a.workspaceId === row.workspace_id && a.role === 'owner');
    const ready = Boolean(fixture && row.spreadsheet_id === fixture.spreadsheetId && (!requireConnected || row.status === 'connected') && row.entity_status === 'active'
      && row.approval_id && row.approved_by === expectedOwner.id && row.approver_role === 'owner' && row.approver_status === 'active'
      && JSON.stringify(row.field_mapping) === JSON.stringify(row.approved_mapping) && row.field_mapping.rowKeyColumn === 0 && row.field_mapping.dateColumn === 1
      && row.field_mapping.metrics?.[0]?.column === 2 && row.headers.join('|') === 'Key|Date|Orders' && row.approved_headers.join('|') === 'Key|Date|Orders'
      && Number(row.sheet_id) === 0 && row.sheet_title === 'Daily' && (!requireConnected || row.automatic_refresh_enabled && row.next_sync_at) && encryptedTokenBindingValid && row.granted_scope === scope);
    return { workspaceId: row.workspace_id, connectionId: row.id, approvalId: row.approval_id, ready, status: row.status, encryptedTokenBindingValid, actualOwnerApproval: row.approved_by === expectedOwner.id, approvedMappingHash: sha(JSON.stringify(row.approved_mapping)), automaticRefreshEnabled: row.automatic_refresh_enabled, nextSyncAt: row.next_sync_at };
  });
  return { runId: plan.runId, ready: observations.length === plan.workspaces.length && observations.every(o => o.ready) && plan.workspaces.every(w => observations.filter(o => o.workspaceId === w.id).length === 1), observations,
    provenance: 'Real local service-role approval RPC with verified owner Auth session; synthetic connected OAuth outcome and encrypted test-only credentials. No external provider request or Google consent.', providerMode: 'local_stubs_only', customerConnectionsTouched: false };
}
module.exports = { seedFixtures, verifyFixtures, mapping, withEncryptionConfiguration };
if (require.main === module) (async () => {
  const runtimeFile = process.argv[2], cfg = readRuntime(runtimeFile);
  const state = await openState({ configFile: cfg.configFile, planFile: cfg.planFile, outputDir: cfg.out });
  try { console.log(JSON.stringify(await seedFixtures({ state, runtimeFile }))); } finally { await state.close(); }
})().catch(error => { console.error(JSON.stringify({ kind: 'capacity_sheets_fixture_blocked', reason: /^[a-z_]+(?::[A-Z0-9_]+)?$/.test(error.message) ? error.message : 'provider_fixture_failed', code: error.code || null, preservedFixtures: true })); process.exitCode = 1; });
