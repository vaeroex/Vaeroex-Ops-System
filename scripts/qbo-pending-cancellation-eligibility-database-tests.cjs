/* eslint-disable @typescript-eslint/no-require-imports -- Focused CommonJS native PostgreSQL qualification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { runAdditionalQualification } = require('./run-square-durable-page-qualification.js');
const { candidates } = require('./run-qbo-production-candidate-database-tests.cjs');
require('./qbo-customer-test-support.cjs').installLoader();
const { integrationConnectionIntentCommand } = require('../lib/integrations/persistence/control-plane-repository.ts');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = '20261002025212_qbo_customer_pending_cancellation_eligibility.sql';
const rpc = 'public.read_qbo_customer_pending_cancellations_v1';
const owner = '09930000-0000-4000-8000-000000000001';
const manager = '09930000-0000-4000-8000-000000000002';
const session = '0c930000-0000-4000-8000-000000000001';
const managerSession = '0c930000-0000-4000-8000-000000000002';
const workspace = '0a930000-0000-4000-8000-000000000001';
const entity = '0b930000-0000-4000-8000-000000000001';
const protectedTables = ['private.integration_connections', 'public.integration_connection_summaries',
  'private.integration_oauth_states', 'private.integration_qbo_oauth_state_bindings_v2',
  'private.integration_qbo_customer_authorizations', 'private.integration_credentials',
  'private.provider_entity_mappings', 'private.integration_reauthorization_states',
  'private.integration_qbo_customer_disconnect_work', 'private.integration_sync_runs',
  'private.integration_sync_tasks', 'private.external_source_records', 'private.integration_audit_events'];
async function actor(client, role = 'authenticated', claims = {}) {
  await client.query('reset session authorization');
  await client.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({ role, sub: owner, session_id: session, ...claims })]);
  await client.query(`set session authorization ${role}`);
}
async function admin(client) { await client.query('reset session authorization'); }

async function qualify({ client }) {
  let scenarios = 0;
  async function test(name, run) { await run(); console.log(`ok ${++scenarios} - ${name}`); }
  const suite = read('supabase/tests/qbo_customer_oauth_completion.test.sql');
  await client.query(suite.slice(suite.indexOf('create function pg_temp.fp'), suite.indexOf('\nselect ok(')));
  const project = async (scope = workspace) => (await client.query(`select * from ${rpc}($1)`, [scope])).rows;
  async function attempt(scope = workspace, businessEntity = entity, user = owner, liveSession = session) {
    await admin(client);
    const connectionId = randomUUID(), stateId = randomUUID();
    const connection = (await client.query('select pg_temp.intent($1,$2) as value', [connectionId, businessEntity])).rows[0].value;
    connection.workspaceId = scope;
    const state = (await client.query('select pg_temp.state($1,$2,$3) as value', [stateId, connectionId, stateId])).rows[0].value;
    await actor(client, 'authenticated', { sub: user, session_id: liveSession });
    await client.query('select public.begin_qbo_customer_connection_v1($1,$2,$3)', [connection, state, 'eligibility_' + stateId]);
    return { connectionId, stateId, state };
  }
  async function consume(a) {
    await actor(client, 'integration_oauth_ingress_authority');
    const result = (await client.query('select public.consume_qbo_customer_oauth_state_v2($1,$2) as value', [{
      contractVersion: 'qbo_customer_oauth_state_consume_v2', stateHash: a.state.stateHash,
      redirectUri: a.state.redirectUri,
    }, 'eligibility_consume_' + a.stateId])).rows[0].value;
    assert.equal(result.accepted, true);
  }
  async function exchange(a) {
    await consume(a);
    await actor(client, 'integration_credential_broker_authority');
    await client.query('select public.begin_qbo_customer_authorization_v1($1,$2)',
      [a.stateId, 'sha256:' + createHash('sha256').update(a.stateId).digest('hex')]);
  }
  async function newWorkspace(user, withEntity) {
    await admin(client);
    const id = randomUUID(), eid = randomUUID();
    await client.query('insert into public.workspaces(id,name,created_by,manually_unlocked) values($1,$2,$3,true)', [id, 'Eligibility fixture', user]);
    await client.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')", [id, user]);
    if (withEntity) await client.query(`insert into public.customer_subscriptions(workspace_id,customer_email,billing_provider,manually_activated,status)
      values($1,'eligibility-owner@example.test','manual',true,'active')`, [id]);
    if (withEntity) await client.query(`insert into public.business_entities(id,workspace_id,contract_version,entity_key,entity_type,
      display_name,base_currency,timezone,fiscal_year_start_month,status,created_by,updated_by)
      values($1,$2,'business_entity_v1','eligibility','operating_company','Eligibility entity','USD','UTC',1,'active',$3,$3)`, [eid, id, user]);
    return { id, entity: eid };
  }
  const pending = await attempt(), denied = await attempt(), consumed = await attempt();
  const exchanging = await attempt(), recovery = await attempt(), terminal = await attempt();
  await actor(client, 'integration_oauth_ingress_authority');
  await client.query("select public.deny_qbo_customer_authorization_v1($1,'initial',$2)", [denied.state.stateHash, denied.state.redirectUri]);
  await consume(consumed);
  await exchange(exchanging);
  await exchange(recovery);
  await client.query("select public.finish_qbo_customer_authorization_v1($1,'recovery_required')", [recovery.stateId]);
  await actor(client);
  await client.query('select public.cancel_qbo_customer_pending_connection_v1($1,$2,1,$3)', [workspace, terminal.connectionId, 'eligibility_terminal']);
  for (const [providerKey, providerEnvironment, requestedScopes] of [
    ['synthetic', 'test', ['read_synthetic_business_data']],
    ['quickbooks_online', 'sandbox', ['com.intuit.quickbooks.accounting']],
  ]) await client.query('select public.create_integration_connection_intent_v1($1)', [integrationConnectionIntentCommand({
    id: randomUUID(), workspaceId: workspace, businessEntityId: entity, providerKey, providerEnvironment,
    requestedScopes, safeDisplayName: 'Excluded ' + providerKey, requestedAt: new Date().toISOString(),
  })]);
  const foreign = await newWorkspace(manager, true);
  await attempt(foreign.id, foreign.entity, manager, managerSession);
  const empty = await newWorkspace(owner, false);
  // A distinct inactive entity leaves the connection in the returned rowset but
  // cannot satisfy the existing cancellation RPC's entity authorization check.
  await client.query(`insert into public.business_entities(id,workspace_id,contract_version,entity_key,entity_type,
    display_name,base_currency,timezone,fiscal_year_start_month,status,created_by,updated_by)
    select $1,workspace_id,contract_version,'inactive_eligibility',entity_type,'Inactive entity',base_currency,timezone,
      fiscal_year_start_month,'active',created_by,updated_by from public.business_entities where id=$2`, [randomUUID(), entity]);
  const inactiveEntity = (await client.query("select id from public.business_entities where entity_key='inactive_eligibility'")).rows[0].id;
  const inactiveAttempt = await attempt(workspace, inactiveEntity);
  await admin(client);
  await client.query("update public.business_entities set status='inactive' where id=$1", [inactiveEntity]);
  async function snapshot() {
    await admin(client);
    const result = {};
    for (const table of protectedTables) result[table] = (await client.query(`select count(*)::int as count,
      md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as fingerprint from ${table} t`)).rows[0];
    return result;
  }
  const before = await snapshot();
  await actor(client);
  const rows = await project();
  const eligibility = new Map(rows.map(row => [row.connection_id, row.can_cancel]));
  const expectedIds = [pending, denied, consumed, exchanging, recovery, inactiveAttempt].map(a => a.connectionId).sort();
  await test('exact workspace/provider/environment/status rowset exposes only UUID and boolean', async () => {
    assert.deepEqual(rows.map(row => row.connection_id).sort(), expectedIds);
    assert.ok(rows.every(row => Object.keys(row).join(',') === 'connection_id,can_cancel' && typeof row.can_cancel === 'boolean'));
    assert.equal(rows.filter(row => row.can_cancel).length, 2);
  });
  await test('unclaimed pending authorization binding is eligible', async () => { assert.equal(eligibility.get(pending.connectionId), true); });
  await test('denied unconsented error is eligible', async () => { assert.equal(eligibility.get(denied.connectionId), true); });
  await test('consumed state still marked pending is ineligible', async () => { assert.equal(eligibility.get(consumed.connectionId), false); });
  await test('exchanging pending attempt is ineligible', async () => { assert.equal(eligibility.get(exchanging.connectionId), false); });
  await test('recovery-required error without credentials or scopes is ineligible', async () => { assert.equal(eligibility.get(recovery.connectionId), false); });
  await test('inactive entity cannot offer cancellation', async () => { assert.equal(eligibility.get(inactiveAttempt.connectionId), false); });
  await test('projection succeeds unchanged in a read-only transaction', async () => {
    await client.query('begin read only');
    try { assert.deepEqual(await project(), rows); assert.deepEqual(await project(), rows); }
    finally { await client.query('rollback'); }
  });
  await test('authorized empty workspace returns an empty rowset', async () => { assert.deepEqual(await project(empty.id), []); });
  await test('cross-owner, nonexistent and null workspaces deny independently of rows', async () => {
    for (const scope of [foreign.id, randomUUID(), null]) await assert.rejects(project(scope), { code: '42501' });
  });
  await test('manager and nonmember cannot read populated or empty workspaces', async () => {
    await actor(client, 'authenticated', { sub: manager, session_id: managerSession });
    for (const scope of [workspace, empty.id]) await assert.rejects(project(scope), { code: '42501' });
  });
  await test('anon and service role cannot execute even with forged owner claims', async () => {
    for (const role of ['anon', 'service_role']) {
      await actor(client, role, { role: 'authenticated' });
      await assert.rejects(project(), { code: '42501' });
    }
  });
  await test('absent, malformed, unknown or other-user sessions fail closed', async () => {
    for (const claims of [{ session_id: null }, { session_id: 'invalid' }, { session_id: randomUUID() },
      { session_id: managerSession }, { sub: null }, { sub: 'invalid' }, { role: 'service_role' }]) {
      await actor(client, 'authenticated', claims);
      await assert.rejects(project(), { code: '42501' });
    }
  });
  async function changed(sql, values, check) {
    await admin(client); await client.query('begin');
    try { await client.query(sql, values); await actor(client); await check(); }
    finally { await client.query('rollback'); await admin(client); }
  }
  await test('expired and revoked live sessions deny', async () => {
    for (const sql of ["update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id=$1",
      'delete from auth.sessions where id=$1']) await changed(sql, [session], () => assert.rejects(project(), { code: '42501' }));
  });
  await test('disabled and downgraded owners deny', async () => {
    for (const assignment of ["status='disabled'", "role='manager'"]) await changed(
      `update public.workspace_members set ${assignment} where workspace_id=$1 and user_id=$2`, [workspace, owner],
      () => assert.rejects(project(), { code: '42501' }));
  });
  await test('deleted and banned users deny', async () => {
    for (const assignment of ['deleted_at=statement_timestamp()', "banned_until=statement_timestamp()+interval '1 hour'"]) await changed(
      `update auth.users set ${assignment} where id=$1`, [owner], () => assert.rejects(project(), { code: '42501' }));
  });
  await test('eligibility does not require a paid entitlement', async () => {
    await changed('delete from public.customer_subscriptions where workspace_id=$1', [workspace], async () => {
      await admin(client); await client.query('update public.workspaces set manually_unlocked=false where id=$1', [workspace]);
      await actor(client); assert.deepEqual(await project(), rows);
    });
  });
  await test('stable definer has empty search path and no new private-table access', async () => {
    await admin(client);
    const fn = (await client.query(`select p.provolatile,p.prosecdef,p.proconfig,r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner
      where p.oid=$1::regprocedure`, [rpc + '(uuid)'])).rows[0];
    assert.deepEqual(fn, { provolatile: 's', prosecdef: true, proconfig: ['search_path=""'], rolname: 'postgres' });
    for (const role of ['anon', 'service_role', 'authenticated']) {
      assert.equal((await client.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, rpc + '(uuid)'])).rows[0].allowed,
        role === 'authenticated');
      for (const table of protectedTables.filter(table => table.startsWith('private.'))) {
        assert.equal((await client.query('select has_table_privilege($1,$2,\'SELECT\') as allowed', [role, table])).rows[0].allowed, false);
      }
    }
    assert.equal((await client.query('select bool_and(relrowsecurity and relforcerowsecurity) as protected from pg_class where oid=any($1::regclass[])',
      [protectedTables.filter(table => table.startsWith('private.'))])).rows[0].protected, true);
    await actor(client); await assert.rejects(client.query('select * from private.integration_qbo_customer_authorizations'), { code: '42501' });
  });
  await test('all projection calls leave protected row counts and contents unchanged', async () => {
    assert.deepEqual(await snapshot(), before);
    console.log(JSON.stringify({ projected: rows.length, eligible: 2, ineligible: 4,
      unchangedCounts: Object.fromEntries(Object.entries(before).map(([table, value]) => [table, value.count])) }));
  });
  return scenarios;
}

async function main() {
  assert.equal(process.argv.length, 2, 'No URLs or external target options accepted');
  process.env.SQUARE_QUALIFICATION_PG_BIN = process.env.QBO_TEST_POSTGRES_BIN;
  assert.equal(candidates.at(-1), migration, 'focused test must qualify the current candidate tail');
  const canonical = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  const production = ['20260925032300_square_production_customer_connection.sql', '20260929004917_square_customer_service_backend.sql',
    '20260929041048_square_customer_payment_history.sql', '20260929052211_square_customer_payment_browse.sql'];
  let scenarios = 0;
  for (const shape of ['canonical', 'production']) await runAdditionalQualification(async runtime => {
    assert.equal(runtime.targetKind, 'native-postgres');
    const db = await runtime.createDatabase('qbo_eligibility');
    await db.client.query(`create extension if not exists pg_stat_statements with schema extensions;
      create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)`);
    const files = shape === 'canonical' ? canonical.map(f => 'supabase/migrations/' + f) : [
      ...canonical.filter(f => f.split('_')[0] <= '20260902191325').map(f => 'supabase/migrations/' + f),
      ...production.map(f => 'supabase/production-migrations/' + f)];
    for (const file of [...files, ...candidates.map(f => 'supabase/production-migrations/' + f)]) {
      try { await db.client.query(read(file)); }
      catch (error) { error.message = `${file}: ${error.message}`; throw error; }
      await db.client.query('insert into supabase_migrations.schema_migrations values($1)', [path.basename(file).split('_')[0]]);
    }
    console.log(`${shape}: ${files.length}+${candidates.length} local migrations applied; focused eligibility scenarios only`);
    scenarios += await qualify(db);
  });
  console.log(`${scenarios} focused native scenarios passed; migration SHA-256 ${createHash('sha256').update(read('supabase/production-migrations/' + migration)).digest('hex')}`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { qualify };
