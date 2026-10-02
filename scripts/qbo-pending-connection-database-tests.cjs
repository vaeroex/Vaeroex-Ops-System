/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS native fixture uses the existing TypeScript test loader. */
/* Focused native PostgreSQL tests. Only a newly owned local cluster is accepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const { runAdditionalQualification } = require('./run-square-durable-page-qualification.js');
require('./qbo-customer-test-support.cjs').installLoader();
const { integrationConnectionIntentCommand } = require('../lib/integrations/persistence/control-plane-repository.ts');
const root = path.resolve(__dirname, '..');
const migration = '20261002012700_qbo_customer_pending_attempt_control.sql';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const owner = '09930000-0000-4000-8000-000000000001';
const session = '0c930000-0000-4000-8000-000000000001';
const workspace = '0a930000-0000-4000-8000-000000000001';
const entity = '0b930000-0000-4000-8000-000000000001';
const fp = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
let assertions = 0;
async function test(name, run) { await run(); assertions++; console.log(`ok ${assertions} - ${name}`); }
async function actor(client, role = 'authenticated', claims = {}) {
  await client.query('reset session authorization');
  await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: owner, session_id: session, ...claims })]);
  await client.query(`set session authorization ${role}`);
}
async function admin(client) { await client.query('reset session authorization'); }
async function start(client, command, state, requestId = `pending_${state.stateId.replaceAll('-', '')}`) {
  return (await client.query('select public.begin_qbo_customer_connection_v1($1,$2,$3) as result', [command, state, requestId])).rows[0].result;
}
async function cancel(client, id, version = 1, scope = workspace, request = 'cancel_' + randomUUID().replaceAll('-', '')) {
  return (await client.query('select public.cancel_qbo_customer_pending_connection_v1($1,$2,$3,$4) as result', [scope, id, version, request])).rows[0].result;
}
async function qualify(db) {
  const before = assertions;
  const client = db.client;
  const suite = read('supabase/tests/qbo_customer_oauth_completion.test.sql');
  // Reuse the exact canonical intent and customer/session fixture, without its suite.
  await client.query(suite.slice(suite.indexOf('create function pg_temp.fp'), suite.indexOf('\nselect ok(')));
  const template = (await client.query('select pg_temp.intent($1) as command', [randomUUID()])).rows[0].command;
  function attempt(name = randomUUID(), overrides = {}) {
    const connection = { ...template, id: randomUUID(), safeDisplayName: name, requestedAt: new Date().toISOString(), ...overrides };
    const state = { contractVersion: 'qbo_customer_oauth_state_v2', stateId: randomUUID(), connectionId: connection.id,
      expectedConnectionGeneration: 1, expectedConnectionRowVersion: 1, requestedScopes: connection.requestedScopes,
      redirectUri: 'https://integrations.vaeroex.com/oauth/callback', returnIntent: '/app/settings',
      stateHash: fp(randomUUID()), requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    return { connection, state };
  }
  const begin = async a => { await actor(client); return start(client, a.connection, a.state); };
  const count = async (table, id) => { await admin(client); return Number((await client.query(`select count(*) as n from private.${table} where connection_id=$1`, [id])).rows[0].n); };
  const base = attempt('Main   COMPANY');
  await test('atomic start writes one connection, one state, one session binding and canonical audits', async () => {
    const result = await begin(base);
    assert.equal(result.disposition, 'started'); assert.equal(result.connection.id, base.connection.id);
    assert.equal(result.oauthState.stateId, base.state.stateId);
    assert.equal(await count('integration_oauth_states', base.connection.id), 1);
    assert.equal(await count('integration_qbo_customer_authorizations', base.connection.id), 1);
    assert.equal(await count('integration_audit_events', base.connection.id), 2);
  });
  await test('normalized duplicate and exact replay return pending without rotating or inserting', async () => {
    const duplicate = attempt('main company');
    for (const a of [duplicate, base]) {
      const result = await begin(a); assert.equal(result.disposition, 'pending');
      assert.equal(result.oauthState, null); assert.equal(result.connection.id, base.connection.id);
    }
    assert.equal(await count('integration_oauth_states', base.connection.id), 1);
    assert.equal(await count('integration_audit_events', base.connection.id), 2);
  });
  await test('original intent RPC cannot bypass same-name duplicate guard', async () => {
    await actor(client);
    await assert.rejects(client.query('select public.create_integration_connection_intent_v1($1)', [attempt('MAIN COMPANY').connection]), { code: '23505' });
  });
  await test('distinct names and entities remain independent', async () => {
    const named = await begin(attempt('Main company 2')); assert.equal(named.disposition, 'started');
    await admin(client); const other = randomUUID();
    await client.query(`insert into public.business_entities(id,workspace_id,contract_version,entity_key,entity_type,display_name,base_currency,timezone,
      fiscal_year_start_month,status,created_by,updated_by) values($1,$2,'business_entity_v1','pending_other','operating_company','Other','USD','UTC',1,'active',$3,$3)`, [other, workspace, owner]);
    assert.equal((await begin(attempt('main company', { businessEntityId: other }))).disposition, 'started');
  });
  await test('state/configuration errors roll back connection, summary and intent audit', async () => {
    for (const changes of [{ redirectUri: 'https://wrong.example.test/oauth/callback' }, { stateHash: 'invalid' }, { expiresAt: '2000-01-01T00:00:00Z' }]) {
      const a = attempt(); await actor(client);
      await assert.rejects(start(client, a.connection, { ...a.state, ...changes }));
      await admin(client);
      assert.equal((await client.query('select count(*)::int as n from private.integration_connections where id=$1', [a.connection.id])).rows[0].n, 0);
      assert.equal((await client.query('select count(*)::int as n from public.integration_connection_summaries where id=$1', [a.connection.id])).rows[0].n, 0);
      assert.equal(await count('integration_audit_events', a.connection.id), 0);
    }
  });
  await test('owner cancellation expires outstanding state, preserves audit/history and is idempotent', async () => {
    await actor(client); const first = await cancel(client, base.connection.id);
    assert.equal(first.connection.status, 'disconnected'); assert.equal(first.connection.rowVersion, 2);
    assert.equal((await cancel(client, base.connection.id)).idempotent, true);
    await admin(client);
    assert.equal((await client.query('select status from private.integration_oauth_states where id=$1', [base.state.stateId])).rows[0].status, 'expired');
    assert.equal((await client.query('select outcome from private.integration_qbo_customer_authorizations where state_id=$1', [base.state.stateId])).rows[0].outcome, 'denied');
    assert.equal(await count('integration_audit_events', base.connection.id), 3);
    await assert.rejects(client.query("update private.integration_audit_events set outcome='failed' where connection_id=$1", [base.connection.id]));
    assert.equal((await begin(attempt('main COMPANY'))).disposition, 'started');
  });
  await test('cancelled state cannot be consumed by native ingress', async () => {
    await actor(client, 'integration_oauth_ingress_authority');
    const r = (await client.query('select public.consume_qbo_customer_oauth_state_v2($1,$2) as r', [{
      contractVersion: 'qbo_customer_oauth_state_consume_v2', stateHash: base.state.stateHash,
      redirectUri: base.state.redirectUri }, 'cancelled_consume'])).rows[0].r;
    assert.equal(r.accepted, false);
  });
  const secured = attempt(); await begin(secured);
  await test('non-owner, expired/missing session, foreign tenant, stale CAS and service role fail closed', async () => {
    await actor(client, 'authenticated', { sub: '09930000-0000-4000-8000-000000000002', session_id: '0c930000-0000-4000-8000-000000000002' });
    await assert.rejects(cancel(client, secured.connection.id), { code: '42501' });
    await assert.rejects(start(client, attempt().connection, attempt().state));
    await actor(client, 'authenticated', { session_id: randomUUID() });
    await assert.rejects(cancel(client, secured.connection.id), { code: '42501' });
    await actor(client); await assert.rejects(cancel(client, secured.connection.id, 1, randomUUID()), { code: '42501' });
    await assert.rejects(cancel(client, secured.connection.id, 2), { code: '40001' });
    await actor(client, 'service_role'); await assert.rejects(cancel(client, secured.connection.id), { code: '42501' });
    await actor(client, 'anon'); await assert.rejects(cancel(client, secured.connection.id), { code: '42501' });
    assert.equal(await count('integration_audit_events', secured.connection.id), 2);
  });
  await test('consumed successful OAuth and exchange claims prohibit cancellation', async () => {
    const a = attempt(); await begin(a); await actor(client, 'integration_oauth_ingress_authority');
    const consumed = (await client.query('select public.consume_qbo_customer_oauth_state_v2($1,$2) as r', [{
      contractVersion: 'qbo_customer_oauth_state_consume_v2', stateHash: a.state.stateHash,
      redirectUri: a.state.redirectUri }, 'consume_' + a.state.stateId])).rows[0].r;
    assert.equal(consumed.accepted, true); await actor(client);
    await assert.rejects(cancel(client, a.connection.id), { code: '42501' });
    const claimed = attempt(); await begin(claimed); await admin(client);
    await client.query("update private.integration_qbo_customer_authorizations set outcome='exchanging' where state_id=$1", [claimed.state.stateId]);
    await actor(client); await assert.rejects(cancel(client, claimed.connection.id), { code: '42501' });
  });
  await test('all existing private RLS/ACL boundaries remain closed', async () => {
    await admin(client);
    const flags = (await client.query(`select bool_and(relrowsecurity and relforcerowsecurity) as protected from pg_class
      where oid=any(array['private.integration_connections'::regclass,'private.integration_oauth_states'::regclass,
      'private.integration_credentials'::regclass,'private.integration_qbo_customer_authorizations'::regclass])`)).rows[0];
    assert.equal(flags.protected, true);
    await actor(client); await assert.rejects(client.query('select * from private.integration_oauth_states'), { code: '42501' });
    await assert.rejects(client.query("select public.transition_integration_connection_v1('{}','forbidden','actor')"), { code: '42501' });
  });
  await test('native generic transition cannot use the new edge for QBO or any other provider', async () => {
    const a = attempt(); await begin(a); await admin(client);
    const other = randomUUID();
    await actor(client);
    await client.query('select public.create_integration_connection_intent_v1($1)', [integrationConnectionIntentCommand({
      id: other, workspaceId: workspace, businessEntityId: entity,
      providerKey: 'synthetic', providerEnvironment: 'test', safeDisplayName: 'Synthetic pending',
      requestedScopes: ['read_synthetic_business_data'], requestedAt: new Date().toISOString() })]);
    for (const id of [a.connection.id, other]) {
      await actor(client, 'integration_control_plane_authority');
      await assert.rejects(client.query('select public.transition_integration_connection_v1($1,$2,$3)', [{
        workspaceId: workspace, businessEntityId: entity, connectionId: id, expectedRowVersion: 1, expectedGeneration: 1,
        targetStatus: 'disconnected', stateReasonCode: 'disconnected', providerTenantReferenceFingerprint: null,
        grantedScopes: [], transitionedAt: new Date().toISOString()
      }, 'generic_terminal_' + id, 'native_control_plane']), { code: '42501' });
      await admin(client);
      assert.equal((await client.query('select status from private.integration_connections where id=$1', [id])).rows[0].status, 'pending_authorization');
    }
    await actor(client); assert.equal((await cancel(client, a.connection.id)).connection.status, 'disconnected');
  });
  await test('native concurrent starts serialize to exactly one connection and state', async () => {
    const peer = new Client({ ...db.connection, statement_timeout: 10000 }); await peer.connect();
    try {
      const first = attempt(), second = attempt(first.connection.safeDisplayName);
      await actor(client); await actor(peer); await client.query('begin');
      const initial = await start(client, first.connection, first.state);
      let settled = false;
      const pending = start(peer, second.connection, second.state).finally(() => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(settled, false);
      await client.query('commit'); const duplicate = await pending;
      assert.equal(initial.disposition, 'started'); assert.equal(duplicate.disposition, 'pending');
      assert.equal(duplicate.connection.id, initial.connection.id);
      assert.equal(await count('integration_oauth_states', first.connection.id), 1);
      await admin(client); assert.equal((await client.query('select count(*)::int as n from private.integration_connections where id=$1', [second.connection.id])).rows[0].n, 0);
    } finally { await client.query('rollback'); await peer.end(); }
  });
  await test('active ingress row claim fails cancel closed without deadlock or state loss', async () => {
    const a = attempt(); await begin(a);
    const peer = new Client({ ...db.connection, statement_timeout: 5000 }); await peer.connect();
    try {
      await peer.query('begin'); await peer.query('select id from private.integration_oauth_states where id=$1 for update', [a.state.stateId]);
      await actor(client); await assert.rejects(cancel(client, a.connection.id), { code: '55P03' });
      await peer.query('rollback'); assert.equal((await cancel(client, a.connection.id)).connection.status, 'disconnected');
    } finally { await peer.query('rollback'); await peer.end(); }
  });
  await test('concurrent owner cancellations append a single terminal audit', async () => {
    const a = attempt(); await begin(a);
    const peer = new Client({ ...db.connection, statement_timeout: 5000 }); await peer.connect();
    try {
      await actor(client); await actor(peer); await client.query('begin');
      assert.equal((await cancel(client, a.connection.id)).idempotent, false);
      const repeat = cancel(peer, a.connection.id);
      await client.query('commit'); assert.equal((await repeat).idempotent, true);
      assert.equal(await count('integration_audit_events', a.connection.id), 3);
    } finally { await client.query('rollback'); await peer.end(); }
  });
  await admin(client);
  return assertions - before;
}

async function main() {
  assert.equal(process.argv.length, 2, 'No URLs or external target options accepted');
  process.env.SQUARE_QUALIFICATION_PG_BIN = process.env.QBO_TEST_POSTGRES_BIN;
  const canonical = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  const production = ['20260925032300_square_production_customer_connection.sql', '20260929004917_square_customer_service_backend.sql',
    '20260929041048_square_customer_payment_history.sql', '20260929052211_square_customer_payment_browse.sql'];
  const qbo = ['20260930001000_qbo_customer_oauth_completion.sql', '20260930002000_qbo_production_ongoing_sync.sql',
    '20260930003000_qbo_customer_source_browse.sql', '20260930004000_qbo_production_source_validation.sql',
    '20260930193412_qbo_production_accounting_intake.sql', migration];
  for (const shape of ['canonical', 'production']) {
    await runAdditionalQualification(async runtime => {
      assert.equal(runtime.targetKind, 'native-postgres'); const db = await runtime.createDatabase('qbo_pending');
      await db.client.query(`create extension if not exists pg_stat_statements with schema extensions;
        create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)`);
      const files = shape === 'canonical' ? canonical.map(f => 'supabase/migrations/' + f) : [
        ...canonical.filter(f => f.split('_')[0] <= '20260902191325').map(f => 'supabase/migrations/' + f),
        ...production.map(f => 'supabase/production-migrations/' + f)];
      for (const file of [...files, ...qbo.map(f => 'supabase/production-migrations/' + f)]) {
        try { await db.client.query(read(file)); }
        catch (error) { error.message = `${file}: ${error.message}`; throw error; }
        await db.client.query('insert into supabase_migrations.schema_migrations values($1)', [path.basename(file).split('_')[0]]);
      }
      console.log(`${shape}: exact local migration layout loaded`);
      await qualify(db);
    });
  }
  console.log(`${assertions} focused native scenarios passed; migration SHA-256 ${fp(read('supabase/production-migrations/' + migration)).slice(7)}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { qualify };
