-- The qualification runner expands only this checked-in native fixture include.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/qbo-production-native.sql

create function pg_temp.validation_hash(v jsonb) returns text language sql immutable as $$
  select 'sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'fingerprintPurpose','external_source_record','fingerprintVersion','external_integration_fingerprint_v1',
    'payload',jsonb_build_object('contractVersion',v->'contractVersion','workspaceId',v->'workspaceId',
      'businessEntityId',v->'businessEntityId','connectionId',v->'connectionId','recordKind',v->'recordKind',
      'source',v->'source','temporal',(v->'temporal')-array['synchronizedAt','ingestedAt'],
      'accounting',v->'accounting','normalizedSchemaVersion',v->'normalizedSchemaVersion',
      'changeKind',v->'changeKind','normalizedProjection',v->'normalizedProjection','trust',v->'trust'))),'hex');
$$;
create function pg_temp.validation_version(t private.integration_sync_tasks,record_id text) returns jsonb language plpgsql as $$
declare v jsonb; stamp text:=to_char((transaction_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  v:=jsonb_build_object('contractVersion','external_source_record_version_v1','id',gen_random_uuid(),
    'workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,'connectionId',t.connection_id,
    'immutableVersion',1,'priorVersionId',null,'recordKind','qbo_invoice',
    'source',jsonb_build_object('kind','provider','providerKey','quickbooks_online','providerRecordType','Invoice',
      'providerRecordId',record_id,'providerVersionReference','1'),
    'temporal',jsonb_build_object('basis','event','providerCreatedAt',stamp,'providerUpdatedAt',stamp,
      'observedAt',stamp,'synchronizedAt',stamp,'ingestedAt',stamp,'effectiveAt','2026-09-01T00:00:00.000Z',
      'postingDate','2026-09-01','periodStart',null,'periodEnd',null,'sourceTimeZone',null),
    'accounting',jsonb_build_object('basis','unknown','currency','USD'),
    'normalizedSchemaVersion','qbo_minimizer_v1','changeKind','created',
    'normalizedProjection',jsonb_build_object('contractVersion','qbo_source_record_minimized_v1',
      'provider',jsonb_build_object('providerKey','quickbooks_online','sourceEnvironment','production',
        'realmId',case when t.connection_generation=1 then 'synthetic-production-realm-a' else 'synthetic-production-realm-b' end),
      'recordType','Invoice','id',record_id,'displayName',null,'active',null,'status','active',
      'metadata',jsonb_build_object('providerCreatedAt',stamp,'providerUpdatedAt',stamp,'syncToken','1'),
      'temporal',jsonb_build_object('postingDate','2026-09-01','providerCreatedAt',stamp,'providerUpdatedAt',stamp),
      'accounting',jsonb_build_object('basis','unknown','sourceCurrency','USD','homeCurrency',null,'exchangeRate',null),
      'relationships','{}'::jsonb,'amounts','{}'::jsonb,'lines','[]'::jsonb,
      'providerVersionReference','1','minimizationVersion','qbo_minimizer_v1'),
    'trust','untrusted_external_input','validation',jsonb_build_object('state','pending',
      'validatorVersion','qbo_phase_7_contract_validator_v1','issues','[]'::jsonb),'receivedAt',stamp);
  return v||jsonb_build_object('sourceFingerprint',pg_temp.validation_hash(v));
end;
$$;
create function pg_temp.validation_result(claim jsonb,quarantine boolean default false) returns jsonb language plpgsql as $$
declare v jsonb:=claim->'pendingVersion';
begin
  v:=v||jsonb_build_object('id',claim->'validatedVersionId','priorVersionId',v->'id',
    'immutableVersion',(v->>'immutableVersion')::int+1,'changeKind',case when v->>'changeKind'='deleted' then 'deleted' else 'unchanged' end,
    'receivedAt',claim->'validatedAt','validation',jsonb_build_object('state',case when quarantine then 'quarantined' else 'valid' end,
      'validatorVersion','qbo_production_source_validator_v1','issues',case when quarantine then jsonb_build_array(
        jsonb_build_object('code','qbo_deleted_source_requires_review','severity','error','field',null,'detail','Synthetic bounded issue.')) else '[]'::jsonb end));
  return v||jsonb_build_object('sourceFingerprint',pg_temp.validation_hash(v));
end;
$$;
create function pg_temp.validation_denied(sql text,expected text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlerrm=expected; end;
$$;
create function pg_temp.validation_fact_payload(p_source uuid) returns jsonb language sql as $$
  select jsonb_build_object('contractVersion','canonical_business_fact_version_v2','id',gen_random_uuid(),
    'workspaceId',v.workspace_id,'businessEntityId',v.business_entity_id,'immutableVersion',1,
    'factKind','recognized_revenue','factKey','synthetic-validation:'||gen_random_uuid(),'dimensions','[]'::jsonb,
    'temporal',jsonb_build_object('effectiveAt','2026-09-01T00:00:00.000Z','postingDate','2026-09-01',
      'periodStart',null,'periodEnd',null,'fiscalYear',2026,'fiscalPeriod',9,'sourceTimeZone','UTC','closedPeriod',false),
    'accounting',jsonb_build_object('basis','accrual','sourceCurrency','USD','reportingCurrency','USD',
      'exchangeRate',null,'exchangeRateSource',null),'value',jsonb_build_object('kind','money','amount','0','currency','USD'),
    'reconciliationState','accepted','validationState','valid','sources',jsonb_build_array(jsonb_build_object(
      'sourceRecordVersionId',v.id,'sourceFingerprint','sha256:'||encode(v.source_fingerprint,'hex'),
      'sourceRole','primary','contributionWeight','1')),
    'decision',jsonb_build_object('authority','deterministic_policy','policyVersion','synthetic_test_v1',
      'actorId',null,'decidedAt','2026-09-30T00:00:00.000Z','reasonCodes',jsonb_build_array('synthetic_test')),
    'normalizationVersion','synthetic_test_v1','transformationVersion','synthetic_test_v1',
    'sourceObservedAt','2026-09-30T00:00:00.000Z','createdAt','2026-09-30T00:00:00.000Z',
    'factFingerprint','sha256:'||encode(sha256(gen_random_uuid()::text::bytea),'hex'))
  from private.external_source_record_versions v where v.id=p_source;
$$;
create function pg_temp.validation_freshness() returns void language sql as $$
  insert into private.integration_freshness_states(id,contract_version,workspace_id,business_entity_id,connection_id,
    mapping_id,provider_key,domain,scope_key,last_successful_sync_at,status,blocking_level,policy_version,
    current_max_age_seconds,stale_after_seconds,age_seconds,calculated_at,state_fingerprint,last_request_id,last_request_fingerprint)
  select gen_random_uuid(),'integration_freshness_v1',c.workspace_id,c.business_entity_id,c.id,m.id,
    'quickbooks_online','financial_transactions','qbo_invoice',transaction_timestamp(),'current','none',
    'qbo_control_plane_freshness_policy_v1',3600,86400,0,transaction_timestamp(),decode(repeat('e',64),'hex'),
    'validation_freshness',decode(repeat('e',64),'hex')
  from private.integration_connections c join private.provider_entity_mappings m on m.connection_id=c.id and m.status='active'
  where c.id='e9f00000-0000-4000-8000-000000000101'
  on conflict on constraint integration_freshness_states_scope_key do update set status=excluded.status,
    row_version=private.integration_freshness_states.row_version+1,updated_at=clock_timestamp();
$$;

select ok(not has_function_privilege('service_role','public.claim_qbo_production_source_validation_v1(uuid,text,integer)','execute'),
  'service_role cannot claim validation');
select ok(not has_function_privilege('authenticated','public.complete_qbo_production_source_validation_v1(uuid,uuid,text,jsonb,text)','execute'),
  'customer cannot complete validation');
select ok(not has_function_privilege('integration_provider_source_authority','private.commit_provider_external_source_before_validation_v1(jsonb,text)','execute'),
  'old commit cannot bypass atomic validation work');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.qbo_production_source_validation_work'::regclass),
  'work has forced RLS');
select ok(not has_table_privilege('integration_provider_source_authority','private.qbo_production_source_validation_work','update'),
  'native source role cannot forge work');

select public.schedule_qbo_initialization_v2(2,'validation_fixture_schedule');
update private.integration_sync_tasks set state='dispatched',dispatcher_task_name=repeat('a',64),
  dispatch_generation=1,row_version=row_version+1,updated_at=transaction_timestamp() where stream_key='qbo_invoice';
update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),lease_owner_fingerprint=decode(repeat('a',64),'hex'),
  lease_expires_at=clock_timestamp()+interval '1 hour',heartbeat_at=clock_timestamp(),
  delivery_attribution_state='attributed',last_delivery_dispatch_generation=1,last_delivery_retry_count=0,
  last_delivery_execution_count=0,last_delivery_attempt_fingerprint=decode(repeat('b',64),'hex'),
  row_version=row_version+1,updated_at=transaction_timestamp() where stream_key='qbo_invoice';
create temporary table validation_commands as
select t.id task_id,t.connection_id,t.connection_generation,t.lease_id, v.value version,
  jsonb_build_object('contractVersion','integration_provider_source_commit_v1','taskId',t.id,'leaseId',t.lease_id,
    'leaseOwnerFingerprint','sha256:'||repeat('a',64),'mappingId',t.control_metadata->>'mappingId',
    'sourceIdentityFingerprint','sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
      'identityVersion','external_source_identity_v1','workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
      'connectionId',t.connection_id,'source',(v.value->'source')-'providerVersionReference')),'hex'),'version',v.value) command,
  jsonb_build_object('contractVersion','integration_provider_source_state_read_v1','taskId',t.id,'leaseId',t.lease_id,
    'leaseOwnerFingerprint','sha256:'||repeat('a',64),'mappingId',t.control_metadata->>'mappingId',
    'providerRecordType','Invoice','providerRecordId',v.value#>>'{source,providerRecordId}') read_command
from private.integration_sync_tasks t cross join lateral (select pg_temp.validation_version(t,'validation-'||t.id) value) v
where t.stream_key='qbo_invoice';
select is((select count(*)::int from validation_commands),2,'distinct task authority for two tenants');
grant select on validation_commands to integration_provider_source_authority;
grant usage on schema extensions to integration_provider_source_authority;
set local role integration_provider_source_authority;
select is(public.read_provider_external_source_record_state_v1(read_command)->>'state','missing','Production leased source read is allowed') from validation_commands;
select throws_ok(format('select public.read_provider_external_source_record_state_v1(%L::jsonb)',
  read_command||jsonb_build_object('leaseId',gen_random_uuid())),'42501','provider_source_state_read_denied','wrong lease denied') from validation_commands limit 1;
select public.commit_provider_external_source_record_version_v1(command,'validation_commit_'||task_id) from validation_commands;
select public.commit_provider_external_source_record_version_v1(command,'validation_replay_'||task_id) from validation_commands;
reset role;
select is((select count(*)::int from private.qbo_production_source_validation_work),2,'commit replay enqueues exactly once');
select is((select count(*)::int from private.external_source_record_versions),2,'two immutable pending versions only');
select ok(pg_temp.validation_denied($q$update private.integration_sync_tasks set state='succeeded' where stream_key='qbo_invoice'$q$,
  'qbo_production_task_validation_incomplete'),'pending validation prevents successful task transition');
select ok(pg_temp.validation_denied($q$update private.integration_connections set status='active',state_reason_code='healthy',
  row_version=row_version+1,updated_at=clock_timestamp(),status_changed_at=clock_timestamp()
  where id='e9f00000-0000-4000-8000-000000000101'$q$,'qbo_production_connection_validation_incomplete'),
  'pending validation prevents activation');
select ok(pg_temp.validation_denied('select pg_temp.validation_freshness()',
  'qbo_production_connection_validation_incomplete'),'pending validation prevents current freshness');

create temporary table validation_claims(task_id uuid,value jsonb);
grant select,insert on validation_claims to integration_provider_source_authority;
set local role integration_provider_source_authority;
insert into validation_claims select task_id,jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('c',64),100)) from validation_commands;
select is(jsonb_array_length(public.claim_qbo_production_source_validation_v1(task_id,'sha256:'||repeat('d',64),100)),0,
  'another worker cannot reclaim unexpired ownership') from validation_commands;
reset role;
select is((select count(distinct value->>'claimId')::int from validation_claims),2,'concurrent tenant task reads have distinct claim IDs');
select ok((select bool_and(task_id=(value->>'taskId')::uuid) from validation_claims),'task identities never cross-bind');
select throws_ok(format('select public.complete_qbo_production_source_validation_v1(%L,%L,%L,%L::jsonb,%L)',
  value->>'sourceVersionId',gen_random_uuid(),'sha256:'||repeat('c',64),pg_temp.validation_result(value),'wrong_claim'),
  '42501','qbo_source_validation_completion_denied','wrong claim denied') from validation_claims limit 1;
select throws_ok(format('select public.complete_qbo_production_source_validation_v1(%L,%L,%L,%L::jsonb,%L)',
  value->>'sourceVersionId',value->>'claimId','sha256:'||repeat('d',64),pg_temp.validation_result(value),'wrong_worker'),
  '42501','qbo_source_validation_completion_denied','wrong worker denied') from validation_claims limit 1;
select throws_ok(format('select public.complete_qbo_production_source_validation_v1(%L,%L,%L,%L::jsonb,%L)',
  value->>'sourceVersionId',value->>'claimId','sha256:'||repeat('c',64),
  pg_temp.validation_result(value)||jsonb_build_object('workspaceId',gen_random_uuid()),'wrong_tenant'),
  '42501','qbo_source_validation_version_denied','cross-tenant completion denied') from validation_claims limit 1;

create temporary table validation_outputs as select c.task_id,public.complete_qbo_production_source_validation_v1(
  (value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,'sha256:'||repeat('c',64),pg_temp.validation_result(value),
  'validation_complete_'||c.task_id) result from validation_claims c;
select is(result->>'state','valid','canonical validation appends valid version') from validation_outputs;
select is(public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('c',64),pg_temp.validation_result(value),'validation_complete_replay_'||task_id)->>'idempotent','true',
  'completion replay is idempotent') from validation_claims;
select is((select count(*)::int from private.external_source_record_versions),4,'only one validation version appended per source');
select is((select count(*)::int from private.integration_audit_events where action='external_source_record_version.validate'),2,
  'one bounded audit per validation');
select is((select count(*)::int from private.canonical_business_facts),0,'validation cannot manufacture facts');
select ok(pg_temp.validation_denied($q$update private.qbo_production_source_validation_work set state='pending'$q$,
  'qbo_source_validation_work_immutable'),'completed work cannot be rewritten');
select ok(pg_temp.validation_denied($q$delete from private.qbo_production_source_validation_work$q$,
  'qbo_source_validation_work_immutable'),'work history cannot be deleted');
select ok(pg_temp.validation_denied($q$update private.integration_sync_tasks set state='succeeded',lease_id=null,
  lease_owner_fingerprint=null,lease_expires_at=null,heartbeat_at=null,completed_at=clock_timestamp(),
  durable_effect_fingerprint=decode(repeat('e',64),'hex'),row_version=row_version+1,updated_at=clock_timestamp()
  where stream_key='qbo_invoice'$q$,
  'qbo_task_provider_result_evidence_required'),'validation success does not bypass native provider evidence');
select lives_ok('select pg_temp.validation_freshness()','valid current versions satisfy the source freshness guard');

-- An effect-free deletion settles ingestion, never reactivates its predecessor,
-- and never appends a colliding source fingerprint. Work carries effective validity.
create temporary table validation_tombstone as select command||jsonb_build_object('version',v||jsonb_build_object(
  'sourceFingerprint',pg_temp.validation_hash(v))) command,task_id from (
  select c.command,c.task_id,c.version||jsonb_build_object('id',gen_random_uuid(),'immutableVersion',3,
    'priorVersionId',o.result->>'validatedVersionId','changeKind','deleted','normalizedProjection',null) v
  from validation_commands c join validation_outputs o using(task_id) where c.connection_generation=1
) tombstone;
select public.commit_provider_external_source_record_version_v1(command,'validation_deleted') from validation_tombstone;
create temporary table validation_deleted_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('c',64),100)) value from validation_tombstone;
select is(public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('c',64),pg_temp.validation_result(value),'validation_deleted_complete')->>'state','valid',
  'effect-free bound tombstone settles ingestion') from validation_deleted_claim;
select is((select count(*)::int from private.external_source_record_versions),5,'tombstone adds no duplicate validation/source version');
select ok((select completed_version_id is null from private.qbo_production_source_validation_work
  where source_version_id=(select (value->>'sourceVersionId')::uuid from validation_deleted_claim)),
  'valid tombstone has no fabricated validated version');
select lives_ok('select pg_temp.validation_freshness()','valid zero-effect tombstone permits ingestion freshness');
select is((select count(*)::int from private.integration_sync_checkpoints),0,'validation never advances source checkpoints itself');
select is((select count(*)::int from private.canonical_business_facts),0,'tombstone never restores or creates economic authority');

select ok(pg_temp.validation_denied(format('select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  'sha256:'||repeat('7',64),pg_temp.validation_fact_payload((result->>'validatedVersionId')::uuid),
  'stale_source_promotion','synthetic-validator'),'qbo_production_source_promotion_denied'),
  'an older valid version cannot promote after its current pointer becomes a tombstone')
  from validation_outputs o join validation_commands c using(task_id) where c.connection_generation=1;
select ok(pg_temp.validation_denied(format('select private.assert_qbo_production_source_promotable_v1(%L,%L,%L)',
  gen_random_uuid(),c.version->>'businessEntityId',o.result->>'validatedVersionId'),'qbo_production_source_promotion_denied'),
  'cross-tenant promotion fails closed') from validation_outputs o join validation_commands c using(task_id)
  where c.connection_generation=2;

-- A zero-amount valid Invoice is still an ordinary source, not deletion evidence.
create temporary table validation_effect_fact as select public.commit_canonical_business_fact_version_v2(
  'sha256:'||repeat('8',64),pg_temp.validation_fact_payload((o.result->>'validatedVersionId')::uuid),
  'fixture_effect','synthetic-validator') result
  from validation_outputs o join validation_commands c using(task_id) where c.connection_generation=2;
select is((select count(*)::int from private.business_fact_sources),1,'valid ordinary source can establish fixture provenance');
create temporary table validation_effect_delete as select command||jsonb_build_object('version',v||jsonb_build_object(
  'sourceFingerprint',pg_temp.validation_hash(v))) command,task_id from (
  select c.command,c.task_id,c.version||jsonb_build_object('id',gen_random_uuid(),'immutableVersion',3,
    'priorVersionId',o.result->>'validatedVersionId','changeKind','deleted','normalizedProjection',null) v
  from validation_commands c join validation_outputs o using(task_id) where c.connection_generation=2
) tombstone;
select public.commit_provider_external_source_record_version_v1(command,'validation_effect_deleted') from validation_effect_delete;
create temporary table validation_effect_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('c',64),100)) value from validation_effect_delete;
select ok(pg_temp.validation_denied(format('select public.complete_qbo_production_source_validation_v1(%L,%L,%L,%L::jsonb,%L)',
  value->>'sourceVersionId',value->>'claimId','sha256:'||repeat('c',64),pg_temp.validation_result(value),'effect_delete_complete'),
  'qbo_source_validation_retraction_required'),'prior-version fact edge blocks deletion settlement until retraction') from validation_effect_claim;
select is((select state from private.qbo_production_source_validation_work where source_version_id=
  (select (value->>'sourceVersionId')::uuid from validation_effect_claim)),'claimed','effectful lifecycle stays unresolved');
select ok(pg_temp.validation_denied(format('insert into private.fact_contribution_events(workspace_id,business_entity_id,fact_version_id,event_kind) values(%L,%L,%L,%L)',
  c.version->>'workspaceId',c.version->>'businessEntityId',f.result->>'factVersionId','establish'),
  'qbo_production_source_promotion_denied'),'previously created fact cannot establish a late contribution after deletion')
  from validation_effect_fact f cross join validation_commands c where c.connection_generation=2;
select ok(pg_temp.validation_denied(format('insert into private.reconciliation_case_members(workspace_id,business_entity_id,source_record_version_id) values(%L,%L,%L)',
  c.version->>'workspaceId',c.version->>'businessEntityId',o.result->>'validatedVersionId'),
  'qbo_production_source_promotion_denied'),'late reconciliation cannot use a stale valid predecessor')
  from validation_commands c join validation_outputs o using(task_id) where c.connection_generation=2;

create temporary table validation_void_command as select c.task_id,c.command||jsonb_build_object(
  'sourceIdentityFingerprint','sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'identityVersion','external_source_identity_v1','workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
    'connectionId',t.connection_id,'source',(v.value->'source')-'providerVersionReference')),'hex'),
  'version',v.value||jsonb_build_object('sourceFingerprint',pg_temp.validation_hash(v.value))) command
from validation_commands c join private.integration_sync_tasks t on t.id=c.task_id
cross join lateral(select jsonb_set(pg_temp.validation_version(t,'void-clean'),'{normalizedProjection,status}'::text[],
  '"voided"'::jsonb)||jsonb_build_object('changeKind','voided') value) v where c.connection_generation=1;
select public.commit_provider_external_source_record_version_v1(command,'validation_void_clean') from validation_void_command;
create temporary table validation_void_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('c',64),100)) value from validation_void_command;
select is(public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('c',64),pg_temp.validation_result(value),'validation_void_complete')->>'state','valid',
  'explicit effect-free void settles ingestion') from validation_void_claim;
select ok(pg_temp.validation_denied(format('select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  'sha256:'||repeat('9',64),pg_temp.validation_fact_payload((value->>'validatedVersionId')::uuid),
  'void_source_promotion','synthetic-validator'),'qbo_production_source_promotion_denied'),
  'valid void ingestion cannot become a financial fact') from validation_void_claim;
select lives_ok('select pg_temp.validation_freshness()','valid void with no effects permits ingestion freshness');

-- The owned-container runner arrives over loopback-published TCP, but dblink
-- must still use that cluster's Unix socket, never a supplied remote endpoint.
create function pg_temp.validation_concurrency_connection(p_connection text default
  convert_from(decode(current_setting('vaeroex.test_database_url_b64',true),'base64'),'UTF8'))
returns text language plpgsql as $$
declare socket_path text:=current_setting('unix_socket_directories');
  data_path text:=current_setting('data_directory');
  cluster_name text:=current_setting('cluster_name');
begin
  if current_database() !~ '^qbo_candidate_case_[a-f0-9]{20}$'
    or current_setting('port')<>'5432' or current_user<>'postgres'
    or p_connection is distinct from format('host=%s port=%s dbname=%s user=postgres',
      socket_path,current_setting('port'),current_database()) then
    raise exception 'owned_disposable_socket_required_for_validation_concurrency';
  end if;
  if inet_server_addr() is null then
    if socket_path !~ '^(/private)?/tmp/square-qualification-[A-Za-z0-9]+/socket$'
      or data_path is distinct from regexp_replace(socket_path,'/socket$','/data')
      or cluster_name !~ '^square_qualification_[a-f0-9]{24}$'
      or current_setting('listen_addresses')<>'' then
      raise exception 'owned_disposable_socket_required_for_validation_concurrency';
    end if;
  elsif socket_path<>'/tmp' or data_path<>'/tmp/qbo-candidate-data'
    or cluster_name !~ '^qbo_candidate_[a-f0-9]{24}$' then
    raise exception 'owned_disposable_socket_required_for_validation_concurrency';
  end if;
  return p_connection;
end;
$$;
select pg_temp.validation_concurrency_connection();
select throws_ok(format('select pg_temp.validation_concurrency_connection(%L)',
  format('host=127.0.0.1 port=5432 dbname=%s user=postgres',current_database())),
  'P0001','owned_disposable_socket_required_for_validation_concurrency','TCP dblink endpoints are rejected');
select throws_ok(format('select pg_temp.validation_concurrency_connection(%L)',
  format('host=%s port=5432 dbname=postgres user=postgres',current_setting('unix_socket_directories'))),
  'P0001','owned_disposable_socket_required_for_validation_concurrency','a different database is rejected');
select throws_ok(format('select pg_temp.validation_concurrency_connection(%L)',
  replace(pg_temp.validation_concurrency_connection(),'port=5432','port=5433')),
  'P0001','owned_disposable_socket_required_for_validation_concurrency','a different socket port is rejected');
select throws_ok(format('select pg_temp.validation_concurrency_connection(%L)',
  replace(pg_temp.validation_concurrency_connection(),'user=postgres','user=service_role')),
  'P0001','owned_disposable_socket_required_for_validation_concurrency','a different database principal is rejected');
select throws_ok(format('select pg_temp.validation_concurrency_connection(%L)',
  pg_temp.validation_concurrency_connection()||' hostaddr=127.0.0.1'),
  'P0001','owned_disposable_socket_required_for_validation_concurrency','extra libpq endpoint overrides are rejected');
create extension if not exists dblink with schema extensions;
create function pg_temp.validation_connect(p_name text) returns text language plpgsql as $$
declare remote record;
begin
  perform dblink_connect(p_name,pg_temp.validation_concurrency_connection());
  select * into strict remote from dblink(p_name,$proof$
    select inet_server_addr() is null, current_database(), current_user::text,
      current_setting('data_directory'), current_setting('cluster_name'),
      system_identifier::text from pg_control_system()
  $proof$) as r(unix_socket boolean,database_name text,principal text,data_path text,cluster_name text,system_id text);
  if remote.unix_socket is distinct from true or remote.database_name is distinct from current_database()
    or remote.principal is distinct from 'postgres' or remote.data_path is distinct from current_setting('data_directory')
    or remote.cluster_name is distinct from current_setting('cluster_name')
    or remote.system_id is distinct from (select system_identifier::text from pg_control_system()) then
    perform dblink_disconnect(p_name);
    raise exception 'owned_disposable_socket_identity_mismatch';
  end if;
  return 'OK';
end;
$$;
create temporary table validation_concurrent_commands as
select t.id task_id,c.connection_generation,c.command||jsonb_build_object('version',v.value,
  'sourceIdentityFingerprint','sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'identityVersion','external_source_identity_v1','workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
    'connectionId',t.connection_id,'source',(v.value->'source')-'providerVersionReference')),'hex')) command
from private.integration_sync_tasks t join validation_commands c on c.task_id=t.id
cross join lateral (select pg_temp.validation_version(t,'concurrent-'||t.id) value) v;
select public.commit_provider_external_source_record_version_v1(command,'concurrency_seed_'||task_id) from validation_concurrent_commands;
commit;
begin;
set local search_path=public,extensions;
select is(pg_temp.validation_connect('validation_owner'),'OK','owner socket proves the same disposable database and cluster');
select is(pg_temp.validation_connect('validation_contender'),'OK','contender socket proves the same disposable database and cluster');
select dblink_exec('validation_owner','begin; set local role integration_provider_source_authority');
select dblink_exec('validation_contender','begin; set local role integration_provider_source_authority');
create temporary table validation_concurrent_results(label text,value jsonb);
insert into validation_concurrent_results select 'owner',r.value from dblink('validation_owner',format(
  'select public.claim_qbo_production_source_validation_v1(%L,%L,100)',
  (select task_id from validation_concurrent_commands where connection_generation=1),'sha256:'||repeat('1',64))) r(value jsonb);
insert into validation_concurrent_results select 'contender',r.value from dblink('validation_contender',format(
  'select public.claim_qbo_production_source_validation_v1(%L,%L,100)',
  (select task_id from validation_concurrent_commands where connection_generation=1),'sha256:'||repeat('2',64))) r(value jsonb);
insert into validation_concurrent_results select 'other_tenant',r.value from dblink('validation_contender',format(
  'select public.claim_qbo_production_source_validation_v1(%L,%L,100)',
  (select task_id from validation_concurrent_commands where connection_generation=2),'sha256:'||repeat('2',64))) r(value jsonb);
select is((select jsonb_array_length(value) from validation_concurrent_results where label='owner'),1,
  'one real concurrent worker acquires ownership');
select is((select jsonb_array_length(value) from validation_concurrent_results where label='contender'),0,
  'second real worker skips the locked source without duplicate ownership');
select is((select jsonb_array_length(value) from validation_concurrent_results where label='other_tenant'),1,
  'unrelated tenant work can proceed concurrently');
select ok((select (value->0->>'taskId')::uuid=(select task_id from validation_concurrent_commands where connection_generation=2)
  from validation_concurrent_results where label='other_tenant'),'concurrent tenant work retains exact task binding');
select dblink_exec('validation_owner','commit');
select dblink_exec('validation_contender','rollback');
select is(jsonb_array_length(public.claim_qbo_production_source_validation_v1(
  (select task_id from validation_concurrent_commands where connection_generation=1),'sha256:'||repeat('2',64),100)),0,
  'committed claim remains fenced after row lock release');

-- Exercise both sides of promotion-versus-lifecycle serialization with real RPCs.
select public.complete_qbo_production_source_validation_v1((value->0->>'sourceVersionId')::uuid,
  (value->0->>'claimId')::uuid,'sha256:'||repeat('1',64),pg_temp.validation_result(value->0),'race_seed_owner')
  from validation_concurrent_results where label='owner';
create temporary table validation_race_other_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('3',64),100)) value from validation_concurrent_commands where connection_generation=2;
select public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('3',64),pg_temp.validation_result(value),'race_seed_other') from validation_race_other_claim;
create temporary table validation_race_inputs as select c.task_id,c.connection_generation,s.id source_id,
  pg_temp.validation_fact_payload(s.current_version_id) fact_payload,
  c.command||jsonb_build_object('version',v.value||jsonb_build_object('sourceFingerprint',pg_temp.validation_hash(v.value))) delete_command
from validation_concurrent_commands c join private.qbo_production_source_validation_work w
  on w.source_version_id=(c.command#>>'{version,id}')::uuid
join private.external_source_records s on s.id=w.source_record_id
cross join lateral(select (c.command->'version')||jsonb_build_object('id',gen_random_uuid(),'immutableVersion',3,
  'priorVersionId',s.current_version_id,'changeKind','deleted','normalizedProjection',null) value) v;
commit;
begin;
set local search_path=public,extensions;
select dblink_exec('validation_contender','set application_name=''qbo_validation_promotion_contender''');
create function pg_temp.validation_wait_for_lock() returns boolean language plpgsql as $$
begin
  for attempt in 1..200 loop
    if exists(select 1 from pg_stat_activity where application_name='qbo_validation_promotion_contender'
      and wait_event_type='Lock') then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;
select dblink_exec('validation_owner','begin');
select r.result from validation_race_inputs i cross join lateral dblink('validation_owner',format(
  'select public.commit_provider_external_source_record_version_v1(%L::jsonb,%L)',
  i.delete_command,'race_lifecycle_first')) r(result jsonb) where i.connection_generation=1;
select dblink_send_query('validation_contender',format('select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  'sha256:'||repeat('1',64),fact_payload,'race_promotion_loser','synthetic-validator'))
  from validation_race_inputs where connection_generation=1;
select ok(pg_temp.validation_wait_for_lock(),'promotion waits for the same source lock held by lifecycle ingestion');
select dblink_exec('validation_owner','commit');
select is((select count(*)::int from dblink_get_result('validation_contender',false) r(result jsonb)),0,
  'concurrent stale promotion creates no result');
select ok(dblink_error_message('validation_contender') like '%qbo_production_source_promotion_denied%',
  'promotion rechecks current pointer after lifecycle commits and is denied');
select * from dblink_get_result('validation_contender',false) r(result jsonb);
create temporary table validation_race_deleted_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('4',64),100)) value from validation_race_inputs where connection_generation=1;
select is(public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,(value->>'claimId')::uuid,
  'sha256:'||repeat('4',64),pg_temp.validation_result(value),'race_lifecycle_settle')->>'state','valid',
  'lifecycle-first settles with zero raced fact effects') from validation_race_deleted_claim;

select dblink_exec('validation_owner','begin');
select r.result from validation_race_inputs i cross join lateral dblink('validation_owner',format(
  'select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  'sha256:'||repeat('2',64),i.fact_payload,'race_promotion_first','synthetic-validator')) r(result jsonb)
  where i.connection_generation=2;
select dblink_send_query('validation_contender',format('select public.commit_provider_external_source_record_version_v1(%L::jsonb,%L)',
  delete_command,'race_lifecycle_second')) from validation_race_inputs where connection_generation=2;
select ok(pg_temp.validation_wait_for_lock(),'lifecycle ingestion waits for the source lock held by promotion');
select dblink_exec('validation_owner','commit');
select is((select count(*)::int from dblink_get_result('validation_contender') r(result jsonb)),1,
  'provider tombstone ingestion persists after concurrent provenance commits');
select * from dblink_get_result('validation_contender') r(result jsonb);
create temporary table validation_race_effect_claim as select jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  task_id,'sha256:'||repeat('5',64),100)) value from validation_race_inputs where connection_generation=2;
select ok(pg_temp.validation_denied(format('select public.complete_qbo_production_source_validation_v1(%L,%L,%L,%L::jsonb,%L)',
  value->>'sourceVersionId',value->>'claimId','sha256:'||repeat('5',64),pg_temp.validation_result(value),'race_effect_settle'),
  'qbo_source_validation_retraction_required'),'promotion-first forbids lifecycle settlement without retraction') from validation_race_effect_claim;
select dblink_disconnect('validation_owner');
select dblink_disconnect('validation_contender');

-- Clean sources for authority-vs-promotion tests after run/activation proof.
create temporary table validation_authority_commands as
select c.connection_generation,t.id task_id,c.command||jsonb_build_object('version',v.value,
  'sourceIdentityFingerprint','sha256:'||encode(private.phase_3_contract_fingerprint_v1(jsonb_build_object(
    'identityVersion','external_source_identity_v1','workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
    'connectionId',t.connection_id,'source',(v.value->'source')-'providerVersionReference')),'hex')) command
from validation_commands c join private.integration_sync_tasks t on t.id=c.task_id
cross join lateral(select pg_temp.validation_version(t,'authority-race-'||t.id) value) v;
select public.commit_provider_external_source_record_version_v1(command,'authority_seed_'||task_id) from validation_authority_commands;
create temporary table validation_authority_claims as
select c.connection_generation,jsonb_array_elements(public.claim_qbo_production_source_validation_v1(
  c.task_id,'sha256:'||repeat('6',64),100)) value from validation_authority_commands c;
create temporary table validation_authority_results as
select connection_generation,public.complete_qbo_production_source_validation_v1((value->>'sourceVersionId')::uuid,
  (value->>'claimId')::uuid,'sha256:'||repeat('6',64),pg_temp.validation_result(value),'authority_validation') result
from validation_authority_claims;

-- Synthetic provider evidence supplies the normal runtime completion contract;
-- no guard is disabled and no raw task-success/run-success update is used.
create function pg_temp.validation_finish_runtime(p_task uuid) returns void language plpgsql as $$
declare t private.integration_sync_tasks; credential private.integration_credentials; evidence jsonb; binding jsonb; provider jsonb;
  read_id uuid:=gen_random_uuid(); req text:='activation_fixture_'||gen_random_uuid(); effect text:=pg_temp.fingerprint('synthetic-effect');
begin
  select * into strict t from private.integration_sync_tasks where id=p_task;
  if t.state='pending' then
    update private.integration_sync_tasks set state='dispatched',dispatcher_task_name='synthetic/'||id,
      dispatch_generation=dispatch_generation+1,row_version=row_version+1,updated_at=transaction_timestamp() where id=t.id;
    update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),
      delivery_attribution_state='attributed',last_delivery_dispatch_generation=dispatch_generation,
      last_delivery_retry_count=0,last_delivery_execution_count=0,last_delivery_attempt_fingerprint=decode(repeat('a',64),'hex'),
      lease_owner_fingerprint=decode(repeat('a',64),'hex'),lease_expires_at=clock_timestamp()+interval '1 hour',
      heartbeat_at=clock_timestamp(),row_version=row_version+1,updated_at=transaction_timestamp() where id=t.id;
    select * into strict t from private.integration_sync_tasks where id=p_task;
  end if;
  select * into strict credential from private.integration_credentials where connection_id=t.connection_id and status='active';
  evidence:=to_jsonb(t)||jsonb_build_object('id',read_id,'contract_version','integration_provider_credential_task_read_evidence_v1',
    'connection_row_version',(select row_version from private.integration_connections where id=t.connection_id),
    'mapping_id',t.control_metadata->>'mappingId','mapping_row_version',1,'task_id',t.id,'task_row_version',t.row_version,
    'task_dispatch_generation',t.dispatch_generation,'delivery_dispatch_generation',t.last_delivery_dispatch_generation,
    'delivery_retry_count',t.last_delivery_retry_count,'delivery_execution_count',t.last_delivery_execution_count,
    'delivery_attempt_fingerprint',t.last_delivery_attempt_fingerprint,'credential_id',credential.id,
    'credential_version',credential.credential_version,'credential_row_version',credential.row_version,
    'granted_scopes',credential.granted_scopes,'granted_scope_fingerprint',decode(repeat('b',64),'hex'),
    'credential_read_audit_event_id',private.phase_6_insert_audit_v1(t.workspace_id,t.business_entity_id,t.connection_id,
      'synthetic_test','integration_credential.read','succeeded','integration_credential',credential.id::text,req,'{}'),
    'request_id',req,'request_fingerprint',decode(repeat('c',64),'hex'),'evidence_fingerprint',sha256(req::bytea),
    'authority_role','integration_credential_broker_authority','authorized_at',transaction_timestamp(),'created_at',transaction_timestamp());
  insert into private.integration_provider_credential_task_read_evidence
    select (jsonb_populate_record(null::private.integration_provider_credential_task_read_evidence,evidence)).*;
  binding:=private.qbo_provider_endpoint_binding_v1(t.stream_key);
  provider:=public.record_qbo_provider_result_v2(jsonb_build_object('contractVersion','qbo_provider_result_evidence_v2',
    'credentialReadEvidenceId',read_id,'requestOrdinal',1,'endpointDomain',binding->>'endpointDomain',
    'endpointClass',binding->>'endpointClass','providerRequestFingerprint',pg_temp.fingerprint(req),
    'providerOutcome','provider_success'),req||'_provider');
  if binding->>'endpointDomain'='report' then
    perform public.record_qbo_report_parser_result_v2(jsonb_build_object('contractVersion','qbo_report_parser_result_evidence_v2',
      'providerResultEvidenceId',provider->>'providerResultEvidenceId','parserOutcome','parser_success'),req||'_parser');
  end if;
  perform public.complete_qbo_runtime_task_v2(jsonb_build_object('contractVersion','qbo_runtime_task_completion_v2',
    'continuation',null,'completion',jsonb_build_object('workspaceId',t.workspace_id,'businessEntityId',t.business_entity_id,
      'connectionId',t.connection_id,'connectionGeneration',t.connection_generation,'taskId',t.id,
      'expectedRowVersion',t.row_version,'leaseId',t.lease_id,'leaseOwnerFingerprint','sha256:'||encode(t.lease_owner_fingerprint,'hex'),
      'durableEffectFingerprint',effect,'checkpoint',jsonb_build_object('checkpointId',t.control_metadata->>'checkpointId',
        'expectedCheckpointVersion',0,'streamKey',t.stream_key,'checkpointKind','cursor','cursorVersion',1,
        'cursor',jsonb_build_object('protocolVersion','integration_sync_checkpoint_v1','cursorKind','cursor',
          'cursorValue','complete','windowStartAt',t.control_metadata->'windowStartAt','windowEndAt',t.control_metadata->'windowEndAt'),
        'cursorFingerprint',pg_temp.fingerprint(req),'providerWatermarkAt',t.control_metadata->'windowEndAt',
        'overlapSeconds',300,'fullReconciliation',false,'downstreamCommitFingerprint',effect))),req,'synthetic-validator');
end;
$$;
select lives_ok($q$select pg_temp.validation_finish_runtime(id) from private.integration_sync_tasks
  where connection_id='e9f00000-0000-4000-8000-000000000101'$q$,
  'all native task/checkpoint completions accept effect-free lifecycle work, including pending immutable tombstones');
select is((select count(*)::int from private.integration_sync_checkpoints
  where connection_id='e9f00000-0000-4000-8000-000000000101' and lifecycle='active'),24,
  'normal runtime completion committed all 24 stream checkpoints');
select is((public.schedule_qbo_ongoing_v1(0,'validation_lifecycle_settlement')->>'settledRunCount')::int,1,
  'actual scheduler settles successful initialization containing effect-free tombstones');
select is((select state from private.integration_sync_runs where connection_id='e9f00000-0000-4000-8000-000000000101'),
  'succeeded','run success derives from native task outcomes');
insert into private.integration_freshness_states(id,contract_version,workspace_id,business_entity_id,connection_id,
  mapping_id,provider_key,domain,scope_key,last_successful_sync_at,status,blocking_level,policy_version,
  current_max_age_seconds,stale_after_seconds,age_seconds,calculated_at,state_fingerprint,last_request_id,last_request_fingerprint)
select gen_random_uuid(),'integration_freshness_v1',t.workspace_id,t.business_entity_id,t.connection_id,
  (t.control_metadata->>'mappingId')::uuid,'quickbooks_online',private.integration_stream_freshness_domain_v1('quickbooks_online',t.stream_key),
  t.stream_key,transaction_timestamp(),'current','none','qbo_control_plane_freshness_policy_v1',3600,86400,0,
  transaction_timestamp(),decode(repeat('e',64),'hex'),'activation_freshness',decode(repeat('e',64),'hex')
from private.integration_sync_tasks t where t.connection_id='e9f00000-0000-4000-8000-000000000101'
on conflict on constraint integration_freshness_states_scope_key do update set status=excluded.status,
  row_version=private.integration_freshness_states.row_version+1,updated_at=clock_timestamp();
select lives_ok($q$select public.transition_integration_connection_v1(jsonb_build_object(
  'workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,'connectionId',c.id,
  'expectedRowVersion',c.row_version,'expectedGeneration',c.connection_generation,'targetStatus','active','stateReasonCode','healthy',
  'providerTenantReferenceFingerprint','sha256:'||encode(c.provider_tenant_reference_fingerprint,'hex'),
  'grantedScopes',to_jsonb(c.granted_scopes),'transitionedAt',clock_timestamp()),'validation_actual_activation','synthetic-validator')
  from private.integration_connections c where c.id='e9f00000-0000-4000-8000-000000000101'$q$,
  'canonical activation accepts completed no-effect lifecycle ingestion, without rewriting a pending tombstone');
select is((select status from private.integration_connections where id='e9f00000-0000-4000-8000-000000000101'),'active',
  'connection actually activates through the existing contract');

create temporary table validation_authority_inputs as
select c.connection_generation,pg_temp.validation_fact_payload((r.result->>'validatedVersionId')::uuid) fact_payload,
  jsonb_build_object('workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,'connectionId',c.id,
    'expectedRowVersion',c.row_version,'expectedGeneration',c.connection_generation,'targetStatus','disconnecting',
    'stateReasonCode','customer_disconnect_requested','providerTenantReferenceFingerprint',
    'sha256:'||encode(c.provider_tenant_reference_fingerprint,'hex'),'grantedScopes',to_jsonb(c.granted_scopes),
    'transitionedAt',clock_timestamp()) disconnect_command
from validation_authority_results r
join private.external_source_record_versions v on v.id=(r.result->>'validatedVersionId')::uuid
join private.integration_connections c on c.id=v.connection_id and c.workspace_id=v.workspace_id
  and c.business_entity_id=v.business_entity_id;
select is((select count(*)::int from validation_authority_inputs),2,'authority race fixtures bind the exact two source connections');
commit;
begin;
set local search_path=public,extensions;
select is(pg_temp.validation_connect('validation_owner'),'OK','reconnected owner retains owned socket identity');
select is(pg_temp.validation_connect('validation_contender'),'OK','reconnected contender retains owned socket identity');
select dblink_exec('validation_contender','set application_name=''qbo_validation_promotion_contender''');

-- Mapping updates and promotion cannot pass one another, even before source locking.
select dblink_exec('validation_owner','begin');
select is((select count(*)::int from dblink('validation_owner',format(
  'select id from private.provider_entity_mappings where connection_id=%L for update',
  (select disconnect_command->>'connectionId' from validation_authority_inputs where connection_generation=2))) r(id uuid)),
  1,'authority contender locks the exact current mapping');
select dblink_send_query('validation_contender',format('select private.assert_qbo_production_source_promotable_v1(%L,%L,%L)',
  fact_payload->>'workspaceId',fact_payload->>'businessEntityId',fact_payload#>>'{sources,0,sourceRecordVersionId}'))
from validation_authority_inputs where connection_generation=2;
select ok(pg_temp.validation_wait_for_lock(),'promotion waits for the exact native mapping authority lock');
select dblink_exec('validation_owner','rollback');
select is((select count(*)::int from dblink_get_result('validation_contender') r(result text)),1,
  'unchanged mapping permits promotion after its authority lock releases');
select * from dblink_get_result('validation_contender') r(result text);

-- Promotion first keeps connection authority valid until the provenance commits.
select dblink_exec('validation_owner','begin');
select r.result from validation_authority_inputs i cross join lateral dblink('validation_owner',format(
  'select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  pg_temp.fingerprint('validator_authority_promotion_first'),i.fact_payload,'authority_promotion_first','synthetic-validator')) r(result jsonb)
where i.connection_generation=1;
select dblink_exec('validation_contender',format('set request.jwt.claims=%L',jsonb_build_object(
  'role','authenticated','sub',c.created_by,'session_id',s.id)::text))
from validation_authority_inputs i join private.integration_connections c on c.id=(i.disconnect_command->>'connectionId')::uuid
join auth.sessions s on s.user_id=c.created_by where i.connection_generation=1;
select dblink_send_query('validation_contender',format('select public.transition_integration_connection_v1(%L::jsonb,%L,%L)',
  disconnect_command,'authority_disconnect_second','synthetic-validator'))
from validation_authority_inputs where connection_generation=1;
select ok(pg_temp.validation_wait_for_lock(),'canonical disconnect waits for promotion connection authority lock');
select dblink_exec('validation_owner','commit');
select is((select count(*)::int from dblink_get_result('validation_contender') r(result jsonb)),1,
  'canonical disconnect runs only after the authorized promotion committed');
select * from dblink_get_result('validation_contender') r(result jsonb);

-- Disconnect first invalidates authority before the waiting provenance can write.
select dblink_exec('validation_owner','begin');
select dblink_exec('validation_owner',format('set local request.jwt.claims=%L',jsonb_build_object(
  'role','authenticated','sub',c.created_by,'session_id',s.id)::text))
from validation_authority_inputs i join private.integration_connections c on c.id=(i.disconnect_command->>'connectionId')::uuid
join auth.sessions s on s.user_id=c.created_by where i.connection_generation=2;
select r.result from validation_authority_inputs i cross join lateral dblink('validation_owner',format(
  'select public.transition_integration_connection_v1(%L::jsonb,%L,%L)',
  i.disconnect_command,'authority_disconnect_first','synthetic-validator')) r(result jsonb)
where i.connection_generation=2;
select dblink_send_query('validation_contender',format('select public.commit_canonical_business_fact_version_v2(%L,%L::jsonb,%L,%L)',
  pg_temp.fingerprint('validator_authority_promotion_loser'),fact_payload,'authority_promotion_loser','synthetic-validator'))
from validation_authority_inputs where connection_generation=2;
select ok(pg_temp.validation_wait_for_lock(),'promotion waits for canonical disconnect authority update');
select dblink_exec('validation_owner','commit');
select is((select count(*)::int from dblink_get_result('validation_contender',false) r(result jsonb)),0,
  'no stale-authority provenance result after disconnect commits');
select ok(dblink_error_message('validation_contender') like '%qbo_production_source_promotion_denied%',
  'promotion rechecks the exact connection after its authority lock releases');
select * from dblink_get_result('validation_contender',false) r(result jsonb);
select dblink_disconnect('validation_owner');
select dblink_disconnect('validation_contender');
select * from finish();
rollback;
