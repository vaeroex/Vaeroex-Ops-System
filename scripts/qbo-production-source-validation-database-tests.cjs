/* eslint-disable @typescript-eslint/no-require-imports -- Isolated embedded PostgreSQL qualification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture, changed } = require('./qbo-production-source-validation-tests.cjs');
const { validateProductionQboSourceClaim } = require('../lib/integrations/provider-runtime/qbo/production-validation.ts');
const { contractSha256 } = require('../lib/integrations/contracts/canonical.ts');
const root = path.resolve(__dirname, '..');
const migration = 'supabase/production-migrations/20260930004000_qbo_production_source_validation.sql';
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const foundation = read('20260820233007_external_integrations_phase_1_canonical_foundation.sql');
const phase3 = read('20260821172015_external_integrations_phase_3_deterministic_dependencies.sql');
const convergence = read('20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql');
const validation = read('20260823042718_external_integrations_phase_8b_qbo_sandbox_validation.sql');
function fn(text, name) {
  const start = text.indexOf(`create or replace function ${name}(`);
  assert(start >= 0, name); const end = text.indexOf('$function$;', start);
  assert(end > start); return text.slice(start, end + '$function$;'.length);
}
function table(name) {
  const start = foundation.indexOf(`create table private.${name} (`);
  assert(start >= 0); const end = foundation.indexOf('\n);', start);
  return foundation.slice(start, end + 3);
}
let assertions = 0;
let stage = 'fixture';
async function qualify(db) {
  await db.exec(`create schema private; create schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create role integration_provider_source_authority nologin noinherit;
    create role integration_provider_runtime_authority nologin noinherit;
    create role integration_provider_validation_authority nologin noinherit;
    create role qbo_source_test login noinherit;
    grant integration_provider_source_authority to qbo_source_test;
    grant usage on schema public to qbo_source_test, integration_provider_source_authority, anon, authenticated, service_role;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then sha256($1) end$$;
    create table public.workspaces(id uuid primary key);
    create table public.profiles(id uuid primary key);
    create table public.business_entities(id uuid primary key, workspace_id uuid, unique(workspace_id,id));
    create table private.integration_connections(id uuid primary key, workspace_id uuid, business_entity_id uuid,
      connection_generation bigint, provider_key text, provider_environment text, status text);
    create table private.integration_freshness_states(id uuid primary key, workspace_id uuid, business_entity_id uuid,
      connection_id uuid, provider_key text, status text);
    create table private.provider_entity_mappings(id uuid primary key, workspace_id uuid, business_entity_id uuid,
      connection_id uuid, provider_key text, provider_environment text, status text, provider_entity_reference_fingerprint bytea);
    create table private.integration_sync_tasks(id uuid primary key, workspace_id uuid, business_entity_id uuid,
      connection_id uuid, connection_generation bigint, sync_run_id uuid, stream_key text, provider_key text, provider_environment text,
      state text, queue_class text, control_metadata jsonb, dispatch_generation bigint, lease_id uuid, lease_owner_fingerprint bytea,
      lease_expires_at timestamptz, dispatcher_task_name text, last_delivery_attempt_fingerprint bytea);
    create table private.business_fact_sources(workspace_id uuid,business_entity_id uuid,source_record_version_id uuid,fact_version_id uuid);
    create table private.reconciliation_case_members(workspace_id uuid,business_entity_id uuid,source_record_version_id uuid);
    create table private.fact_contribution_events(workspace_id uuid,business_entity_id uuid,fact_version_id uuid,event_kind text);`);
  for (const name of ['is_bounded_identifier_v1','is_bounded_text_v1','is_currency_code_v1','is_time_zone_v1',
    'is_sha256_fingerprint_v1','sha256_fingerprint_bytes_v1','jsonb_has_exact_keys_v1','is_source_validation_issues_v1',
    'is_integration_audit_metadata_v1','reject_external_integration_immutable_mutation_v1','validate_source_version_payload_v1']) {
    await db.exec(fn(foundation, `private.${name}`));
  }
  for (const name of ['external_source_records','external_source_record_versions','integration_audit_events']) {
    await db.exec(table(name));
    await db.exec(`alter table private.${name} enable row level security; alter table private.${name} force row level security;`);
  }
  await db.exec(`create trigger reject_external_source_record_version_mutation_v1 before update or delete on private.external_source_record_versions
    for each row execute function private.reject_external_integration_immutable_mutation_v1();`);
  for (const name of ['phase_3_canonical_json_v1','phase_3_contract_fingerprint_v1']) await db.exec(fn(phase3, `private.${name}`));
  for (const name of ['phase_8b_source_version_json_v1','qbo_phase_8b_realm_fingerprint_v1','enforce_qbo_phase_8b_source_realm_binding_v1']) await db.exec(fn(validation, `private.${name}`));
  await db.exec(`create trigger enforce_qbo_phase_8b_source_realm_binding_v1 before insert on private.external_source_record_versions
    for each row execute function private.enforce_qbo_phase_8b_source_realm_binding_v1();`);
  await db.exec(fn(convergence, 'private.assert_integration_provider_source_authority_v1'));
  await db.exec(fn(convergence, 'public.commit_provider_external_source_record_version_v1'));
  await db.exec(fs.readFileSync(path.join(root, migration), 'utf8'));
  const owner = contractSha256('synthetic-owner'), worker = contractSha256('synthetic-worker');
  const hash = value => Buffer.from(value.slice(7), 'hex');
  const call = async (name, args, role = 'qbo_source_test') => {
    stage = `${name}:${role}`;
    await db.exec(`set session authorization ${role}; set role ${role === 'qbo_source_test' ? 'integration_provider_source_authority' : role};`);
    try { return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result; }
    finally { await db.exec('set session authorization postgres; reset role;'); }
  };
  const denied = async (fn, code = '42501') => { await assert.rejects(fn, error => error.code === code); assertions++; };
  function currentFixture(recordType = 'Invoice') {
    const now = new Date(Date.now() - 120_000).toISOString();
    return changed(fixture(null, recordType), claim => {
      for (const field of ['providerCreatedAt','providerUpdatedAt','observedAt','synchronizedAt','ingestedAt']) claim.pendingVersion.temporal[field] = now;
      claim.pendingVersion.receivedAt = now;
      for (const part of ['metadata','temporal']) {
        claim.pendingVersion.normalizedProjection[part].providerCreatedAt = now;
        claim.pendingVersion.normalizedProjection[part].providerUpdatedAt = now;
      }
    });
  }
  async function seed(claim) {
    await db.query('insert into public.workspaces values($1)', [claim.workspaceId]);
    await db.query('insert into public.business_entities values($1,$2)', [claim.businessEntityId, claim.workspaceId]);
    await db.query(`insert into private.integration_connections values($1,$2,$3,1,'quickbooks_online','production','initializing')`,
      [claim.connectionId,claim.workspaceId,claim.businessEntityId]);
    await db.query(`insert into private.provider_entity_mappings values($1,$2,$3,$4,'quickbooks_online','production','active',$5)`,
      [claim.mappingId,claim.workspaceId,claim.businessEntityId,claim.connectionId,hash(claim.realmFingerprint)]);
    await db.query(`insert into private.integration_sync_tasks values($1,$2,$3,$4,1,$5,$6,'quickbooks_online','production',
      'leased','provider_bulk',$7,1,$8,$9,now()+interval '1 hour',$10,$11)`,
      [claim.taskId,claim.workspaceId,claim.businessEntityId,claim.connectionId,claim.syncRunId,claim.streamKey,
        { mappingId: claim.mappingId },claim.claimId,hash(owner),'a'.repeat(64),hash(contractSha256('synthetic-delivery'))]);
  }
  function command(claim) { return { contractVersion: 'integration_provider_source_commit_v1', taskId: claim.taskId,
    leaseId: claim.claimId, leaseOwnerFingerprint: owner, mappingId: claim.mappingId,
    sourceIdentityFingerprint: claim.sourceIdentityFingerprint, version: claim.pendingVersion }; }
  const initial = currentFixture(); await seed(initial);
  const readState = claim => ({ contractVersion: 'integration_provider_source_state_read_v1', taskId: claim.taskId,
    leaseId: claim.claimId, leaseOwnerFingerprint: owner, mappingId: claim.mappingId,
    providerRecordType: claim.pendingVersion.source.providerRecordType, providerRecordId: claim.pendingVersion.source.providerRecordId });
  assert.equal((await call('read_provider_external_source_record_state_v1', [readState(initial)])).state, 'missing'); assertions++;
  await db.query("update private.integration_connections set provider_environment='sandbox' where id=$1", [initial.connectionId]);
  await denied(() => call('read_provider_external_source_record_state_v1', [readState(initial)]));
  await db.query("update private.integration_connections set provider_environment='production',connection_generation=2 where id=$1", [initial.connectionId]);
  await denied(() => call('read_provider_external_source_record_state_v1', [readState(initial)]));
  await db.query('update private.integration_connections set connection_generation=1 where id=$1', [initial.connectionId]);
  stage = 'first_commit';
  const commit = await call('commit_provider_external_source_record_version_v1', [command(initial), 'synthetic-commit']);
  assert.equal(commit.validationState, 'pending'); assertions++;
  assert.equal((await call('read_provider_external_source_record_state_v1', [readState(initial)])).state, 'available'); assertions++;
  await denied(() => db.query("update private.integration_sync_tasks set state='succeeded' where id=$1", [initial.taskId]));
  await denied(() => db.query("update private.integration_connections set status='active' where id=$1", [initial.connectionId]));
  await denied(() => db.query("insert into private.integration_freshness_states values($1,$2,$3,$4,'quickbooks_online','current')",
    [randomUUID(),initial.workspaceId,initial.businessEntityId,initial.connectionId]));
  assert.equal((await db.query('select count(*)::int as n from private.qbo_production_source_validation_work')).rows[0].n, 1); assertions++;
  await call('commit_provider_external_source_record_version_v1', [command(initial), 'synthetic-commit-replay']);
  assert.equal((await db.query('select count(*)::int as n from private.qbo_production_source_validation_work')).rows[0].n, 1); assertions++;
  for (const role of ['service_role','authenticated','anon','integration_provider_runtime_authority']) {
    await denied(() => call('discover_qbo_production_source_validation_tasks_v1', [25], role));
    await denied(() => call('claim_qbo_production_source_validation_v1', [initial.taskId,worker,25], role));
  }
  await db.exec('set session authorization qbo_source_test; set role integration_provider_source_authority;');
  stage = 'direct_bypass_denials';
  await denied(() => db.exec('select * from private.qbo_production_source_validation_work'));
  await denied(() => db.query('select private.commit_provider_external_source_before_validation_v1($1,$2)', [command(initial),'bypass']));
  await db.exec('set session authorization postgres; reset role;');
  assert.deepEqual(await call('discover_qbo_production_source_validation_tasks_v1', [25]), []); assertions++;
  await db.query("update private.integration_sync_tasks set lease_expires_at=now()-interval '1 second' where id=$1", [initial.taskId]);
  assert.deepEqual(await call('discover_qbo_production_source_validation_tasks_v1', [25]), [initial.taskId]); assertions++;
  await db.query("update private.integration_sync_tasks set lease_expires_at=now()+interval '1 hour' where id=$1", [initial.taskId]);
  await denied(() => call('claim_qbo_production_source_validation_v1', [initial.taskId,worker,101]), '22023');
  assert.deepEqual(await call('claim_qbo_production_source_validation_v1', [randomUUID(),worker,25]), []); assertions++;
  const claims = await call('claim_qbo_production_source_validation_v1', [initial.taskId,worker,1]);
  assert.equal(claims.length, 1); assertions++;
  assert.deepEqual(await call('claim_qbo_production_source_validation_v1', [initial.taskId,contractSha256('second-worker'),1]), []); assertions++;
  const claimed = claims[0], valid = validateProductionQboSourceClaim(claimed).validatedVersion;
  const finish = (version = valid, claimId = claimed.claimId, fingerprint = worker) => call('complete_qbo_production_source_validation_v1',
    [claimed.sourceVersionId,claimId,fingerprint,version,'synthetic-validation']);
  await denied(() => finish(valid, randomUUID()));
  await denied(() => finish(valid, claimed.claimId, contractSha256('wrong-worker')));
  await denied(() => finish({ ...valid, workspaceId: randomUUID() }));
  await denied(() => finish({ ...valid, sourceFingerprint: contractSha256('forged') }));
  await denied(() => finish({ ...valid, normalizedProjection: { ...valid.normalizedProjection, id: 'different' } }));
  const result = await finish(); assert.equal(result.state, 'valid'); assert.equal(result.idempotent, false); assertions++;
  assert.equal((await finish()).idempotent, true); assertions++;
  await db.query("update private.integration_sync_tasks set state='succeeded' where id=$1", [initial.taskId]); assertions++;
  await db.query("update private.integration_connections set status='active' where id=$1", [initial.connectionId]); assertions++;
  await db.query("insert into private.integration_freshness_states values($1,$2,$3,$4,'quickbooks_online','current')",
    [randomUUID(),initial.workspaceId,initial.businessEntityId,initial.connectionId]); assertions++;
  assert.equal((await db.query('select count(*)::int as n from private.external_source_record_versions')).rows[0].n, 2); assertions++;
  assert.equal((await db.query("select count(*)::int as n from private.integration_audit_events where action='external_source_record_version.validate'")).rows[0].n, 1); assertions++;
  await denied(() => db.query("update private.qbo_production_source_validation_work set state='pending' where source_version_id=$1", [claimed.sourceVersionId]));
  await denied(() => db.query('delete from private.qbo_production_source_validation_work where source_version_id=$1', [claimed.sourceVersionId]));
  await denied(() => db.query("update private.external_source_record_versions set validation_state='valid' where id=$1", [claimed.sourceVersionId]), '55000');
  const superseded = currentFixture(); await seed(superseded);
  const first = await call('commit_provider_external_source_record_version_v1', [command(superseded), 'synthetic-other']);
  const stale = (await call('claim_qbo_production_source_validation_v1', [superseded.taskId,worker,1]))[0];
  const next = changed(superseded, value => {
    value.pendingVersion.id = randomUUID(); value.pendingVersion.immutableVersion = 2;
    value.pendingVersion.priorVersionId = first.sourceVersionId; value.pendingVersion.changeKind = 'updated';
    value.pendingVersion.source.providerVersionReference = '2'; value.pendingVersion.normalizedProjection.providerVersionReference = '2';
  });
  await call('commit_provider_external_source_record_version_v1', [command(next), 'synthetic-newer']);
  const staleResult = await call('complete_qbo_production_source_validation_v1', [stale.sourceVersionId,stale.claimId,worker,
    validateProductionQboSourceClaim(stale).validatedVersion,'synthetic-superseded']);
  assert.equal(staleResult.state, 'superseded'); assert.equal(staleResult.validatedVersionId, null); assertions++;
  const pendingNext = (await call('claim_qbo_production_source_validation_v1', [superseded.taskId,worker,1]))[0];
  await db.query("update private.qbo_production_source_validation_work set claim_expires_at=now()-interval '1 second' where source_version_id=$1", [pendingNext.sourceVersionId]);
  const newClaim = (await call('claim_qbo_production_source_validation_v1', [superseded.taskId,worker,1]))[0];
  assert.notEqual(newClaim.claimId, pendingNext.claimId); assertions++;
  await denied(() => call('complete_qbo_production_source_validation_v1', [pendingNext.sourceVersionId,pendingNext.claimId,worker,
    validateProductionQboSourceClaim(pendingNext).validatedVersion,'stale-worker']));
  await db.query('update private.integration_connections set connection_generation=2 where id=$1', [superseded.connectionId]);
  await denied(() => call('complete_qbo_production_source_validation_v1', [newClaim.sourceVersionId,newClaim.claimId,worker,
    validateProductionQboSourceClaim(newClaim).validatedVersion,'wrong-generation']));
  await db.query('update private.integration_connections set connection_generation=1 where id=$1', [superseded.connectionId]);
  await db.query('update private.provider_entity_mappings set workspace_id=$1 where id=$2', [randomUUID(),superseded.mappingId]);
  await denied(() => call('complete_qbo_production_source_validation_v1', [newClaim.sourceVersionId,newClaim.claimId,worker,
    validateProductionQboSourceClaim(newClaim).validatedVersion,'wrong-tenant']));
  const deletion = changed(currentFixture(), value => { value.pendingVersion.changeKind = 'deleted'; value.pendingVersion.normalizedProjection = null; });
  await seed(deletion); await call('commit_provider_external_source_record_version_v1', [command(deletion),'synthetic-deletion']);
  const deleteClaim = (await call('claim_qbo_production_source_validation_v1', [deletion.taskId,worker,1]))[0];
  const deleted = await call('complete_qbo_production_source_validation_v1', [deleteClaim.sourceVersionId,deleteClaim.claimId,worker,
    validateProductionQboSourceClaim(deleteClaim).validatedVersion,'synthetic-deletion-completion']);
  assert.equal(deleted.state, 'valid'); assert.equal(deleted.validatedVersionId, null); assertions++;
  await db.query("update private.integration_sync_tasks set state='succeeded' where id=$1", [deletion.taskId]); assertions++;
  await db.query("update private.integration_connections set status='active' where id=$1", [deletion.connectionId]); assertions++;
  const rls = (await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.qbo_production_source_validation_work'::regclass")).rows[0];
  assert.deepEqual(rls,{ relrowsecurity: true, relforcerowsecurity: true }); assertions++;
  const failedEnqueue = currentFixture(); await seed(failedEnqueue);
  await db.query('update private.integration_sync_tasks set last_delivery_attempt_fingerprint=null where id=$1', [failedEnqueue.taskId]);
  const countsBefore = (await db.query('select (select count(*)::int from private.external_source_records) as sources, (select count(*)::int from private.external_source_record_versions) as versions, (select count(*)::int from private.integration_audit_events) as audits')).rows[0];
  await denied(() => call('commit_provider_external_source_record_version_v1', [command(failedEnqueue),'synthetic-atomic-rollback']), '23502');
  const countsAfter = (await db.query('select (select count(*)::int from private.external_source_records) as sources, (select count(*)::int from private.external_source_record_versions) as versions, (select count(*)::int from private.integration_audit_events) as audits')).rows[0];
  assert.deepEqual(countsAfter, countsBefore); assertions++;
  const wrongEnvironment = changed(currentFixture(), value => { value.pendingVersion.normalizedProjection.provider.sourceEnvironment = 'sandbox'; });
  await seed(wrongEnvironment);
  await denied(() => call('commit_provider_external_source_record_version_v1', [command(wrongEnvironment),'wrong-environment']));
  const sandbox = changed(currentFixture(), value => { value.pendingVersion.normalizedProjection.provider.sourceEnvironment = 'sandbox'; });
  await seed(sandbox);
  await db.query("update private.integration_connections set provider_environment='sandbox' where id=$1", [sandbox.connectionId]);
  await db.query("update private.provider_entity_mappings set provider_environment='sandbox' where id=$1", [sandbox.mappingId]);
  await db.query("update private.integration_sync_tasks set provider_environment='sandbox' where id=$1", [sandbox.taskId]);
  await call('commit_provider_external_source_record_version_v1', [command(sandbox),'unchanged-sandbox']);
  assert.equal((await db.query('select count(*)::int as n from private.qbo_production_source_validation_work where task_id=$1', [sandbox.taskId])).rows[0].n, 0); assertions++;
  await db.query('insert into private.business_fact_sources values($1,$2,$3,$4)',
    [sandbox.workspaceId,sandbox.businessEntityId,sandbox.sourceVersionId,randomUUID()]); assertions++;

  for (const recordType of ['Account','Customer','Vendor','Item','CompanyInfo','Preferences','Invoice']) {
    const inactive = changed(currentFixture(recordType), value => {
      value.pendingVersion.normalizedProjection.active=false;
      value.pendingVersion.normalizedProjection.status='inactive';
    });
    await seed(inactive);
    await call('commit_provider_external_source_record_version_v1', [command(inactive),'inactive-reference']);
    const claim=(await call('claim_qbo_production_source_validation_v1', [inactive.taskId,worker,1]))[0];
    const version=validateProductionQboSourceClaim(claim).validatedVersion;
    const allowed=['Account','Customer','Vendor','Item'].includes(recordType);
    if (!allowed) {
      // Even a privileged validator cannot mark an unsupported inactive shape valid.
      await denied(()=>call('complete_qbo_production_source_validation_v1', [claim.sourceVersionId,claim.claimId,worker,
        {...version,validation:{...version.validation,state:'valid',issues:[]}},'invalid-inactive-override']));
    }
    const complete=await call('complete_qbo_production_source_validation_v1', [claim.sourceVersionId,claim.claimId,worker,
      version,'inactive-reference-completion']);
    assert.equal(complete.state,allowed?'valid':'quarantined'); assertions++;
    await denied(()=>db.query('insert into private.business_fact_sources values($1,$2,$3,$4)',
      [inactive.workspaceId,inactive.businessEntityId,complete.validatedVersionId,randomUUID()]));
  }

  // Exact canonical source tables with thin non-QBO prerequisites: this verifies
  // the new Production-only trigger does not impose QBO authority on other input.
  for (const kind of ['square','manual']) {
    const sourceId=randomUUID(),versionId=randomUUID(),actor=randomUUID();
    if (kind==='manual') await db.query('insert into public.profiles values($1)',[actor]);
    const overrides=kind==='manual'?{source_kind:'manual',provider_key:null,provider_record_type:null,
      provider_record_id:null,connection_id:null,mapping_id:null,manual_actor_id:actor,entry_reference:'manual-fixture'}:
      {provider_key:'square'};
    await db.query(`insert into private.external_source_records select (jsonb_populate_record(null::private.external_source_records,
      to_jsonb(s)||$2::jsonb)).* from private.external_source_records s where s.current_version_id=$1`,
      [sandbox.sourceVersionId,{...overrides,id:sourceId,current_version_id:null,
        source_identity_fingerprint:'\\x'+hash(contractSha256(sourceId)).toString('hex')}]);
    const {mapping_id: omittedMapping, ...versionOverrides}=overrides;
    void omittedMapping;
    await db.query(`insert into private.external_source_record_versions select (jsonb_populate_record(null::private.external_source_record_versions,
      to_jsonb(v)||$2::jsonb)).* from private.external_source_record_versions v where v.id=$1`,
      [sandbox.sourceVersionId,{...versionOverrides,id:versionId,source_record_id:sourceId,
        ...(kind==='manual'?{provider_version_reference:null}:{}),normalized_projection:{fixture:kind}}]);
    await db.query('update private.external_source_records set current_version_id=$1 where id=$2',[versionId,sourceId]);
    await db.query('insert into private.business_fact_sources values($1,$2,$3,$4)',
      [sandbox.workspaceId,sandbox.businessEntityId,versionId,randomUUID()]); assertions++;
  }
  return { assertions, providerCalls: 0, modelCalls: 0, economicPromotionAllowed: false };
}
async function main() {
  const modulePath = process.env.QBO_VALIDATION_PGLITE_PATH || require.resolve('@electric-sql/pglite');
  if (!modulePath || !path.isAbsolute(modulePath)) throw Error('explicit_local_embedded_postgres_module_required');
  // This runner never accepts a connection URL or accesses a live database.
  const { PGlite } = require(modulePath); const db = new PGlite();
  try { console.log(JSON.stringify({ suite: 'qbo_production_validation_embedded_postgres',
    fixture: 'exact_canonical_source_tables_helpers_and_new_migration; minimal_connection_task_prerequisites',
    fullCanonicalBootstrap: false, realConcurrentSessions: false, ...await qualify(db) })); }
  finally { await db.close(); }
}
module.exports = { qualify };
if (require.main === module) main().catch(error => { console.error({ stage, assertions, code: error.code, message: error.message,
  position: error.position, where: error.where, stack: error.code ? undefined : error.stack }); process.exitCode = 1; });
