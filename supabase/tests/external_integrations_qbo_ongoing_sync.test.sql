begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/qbo-production-native.sql

create function pg_temp.bytes(p_value text) returns bytea language sql immutable
as $$ select extensions.digest(convert_to(p_value,'UTF8'),'sha256') $$;

create function pg_temp.finish_task(p_id uuid,p_state text,p_code text default 'synthetic_failure')
returns void language plpgsql as $$
declare t private.integration_sync_tasks; credential private.integration_credentials; evidence jsonb; provider jsonb; binding jsonb;
declare read_id uuid:=gen_random_uuid(); request_id text:='synthetic_'||gen_random_uuid();
begin
  update private.integration_sync_tasks set state='dispatched',dispatcher_task_name='synthetic/'||id,
    dispatch_generation=dispatch_generation+1,updated_at=clock_timestamp(),row_version=row_version+1 where id=p_id;
  update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),
    delivery_attribution_state='attributed',last_delivery_dispatch_generation=dispatch_generation,
    last_delivery_retry_count=0,last_delivery_execution_count=0,last_delivery_attempt_fingerprint=pg_temp.bytes(request_id),
    lease_owner_fingerprint=pg_temp.bytes('synthetic-owner'),lease_expires_at=clock_timestamp()+interval '1 hour',
    heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1 where id=p_id;
  if p_state='succeeded' then
    select * into t from private.integration_sync_tasks where id=p_id;
    select * into credential from private.integration_credentials where connection_id=t.connection_id and status='active';
    evidence:=to_jsonb(t)||jsonb_build_object('id',read_id,'contract_version','integration_provider_credential_task_read_evidence_v1',
      'connection_row_version',(select row_version from private.integration_connections where id=t.connection_id),
      'mapping_id',t.control_metadata->>'mappingId','mapping_row_version',1,
      'task_id',t.id,'task_row_version',t.row_version,'task_dispatch_generation',t.dispatch_generation,
      'delivery_dispatch_generation',t.last_delivery_dispatch_generation,'delivery_retry_count',0,'delivery_execution_count',0,
      'delivery_attempt_fingerprint',t.last_delivery_attempt_fingerprint,'credential_id',credential.id,
      'credential_version',credential.credential_version,'credential_row_version',credential.row_version,
      'granted_scopes',credential.granted_scopes,'granted_scope_fingerprint',pg_temp.bytes('scopes'),
      'credential_read_audit_event_id',private.phase_6_insert_audit_v1(t.workspace_id,t.business_entity_id,t.connection_id,
        'synthetic_test','integration_credential.read','succeeded','integration_credential',credential.id::text,request_id,'{}'),
      'request_id',request_id,'request_fingerprint',pg_temp.bytes(request_id),'evidence_fingerprint',pg_temp.bytes(request_id),
      'authority_role','integration_credential_broker_authority','authorized_at',transaction_timestamp(),'created_at',transaction_timestamp());
    insert into private.integration_provider_credential_task_read_evidence
      select (jsonb_populate_record(null::private.integration_provider_credential_task_read_evidence,evidence)).*;
    binding:=private.qbo_provider_endpoint_binding_v1(t.stream_key);
    provider:=public.record_qbo_provider_result_v2(jsonb_build_object('contractVersion','qbo_provider_result_evidence_v2',
      'credentialReadEvidenceId',read_id,'requestOrdinal',1,'endpointDomain',binding->>'endpointDomain',
      'endpointClass',binding->>'endpointClass','providerRequestFingerprint',pg_temp.fingerprint(request_id),
      'providerOutcome','provider_success'),request_id||'_provider');
    if binding->>'endpointDomain'='report' then
      perform public.record_qbo_report_parser_result_v2(jsonb_build_object('contractVersion','qbo_report_parser_result_evidence_v2',
        'providerResultEvidenceId',provider->>'providerResultEvidenceId','parserOutcome','parser_success'),request_id||'_parser');
    end if;
  end if;
  update private.integration_sync_tasks set state=p_state,lease_id=null,lease_owner_fingerprint=null,
    lease_expires_at=null,heartbeat_at=null,updated_at=clock_timestamp(),completed_at=clock_timestamp(),row_version=row_version+1,
    failure_category=case when p_state in ('failed','dead_letter') then 'data_anomaly' else null end,
    failure_code=case when p_state in ('failed','dead_letter') then p_code else null end,
    durable_effect_fingerprint=case when p_state='succeeded' then pg_temp.bytes('synthetic-effect') else null end
    where id=p_id;
end;
$$;

create function pg_temp.hint(p_connection uuid) returns uuid language plpgsql as $$
declare event_id uuid:=gen_random_uuid();
begin
  insert into private.integration_webhook_events(id,contract_version,provider_key,provider_environment,specification_version,
    event_type,provider_event_fingerprint,delivery_hash,provider_account_reference_fingerprint,provider_entity_type,
    provider_entity_reference_fingerprint,workspace_id,business_entity_id,connection_id,connection_generation,mapping_id,
    verification_state,processing_state,verified_at,received_at,last_request_id,last_request_fingerprint,created_at,updated_at)
  select event_id,'integration_webhook_event_v1',c.provider_key,c.provider_environment,'qbo_webhook_v1','invoice_update',
    pg_temp.bytes(event_id::text),pg_temp.bytes(event_id::text),c.provider_tenant_reference_fingerprint,
    'company',c.provider_tenant_reference_fingerprint,c.workspace_id,c.business_entity_id,c.id,c.connection_generation,m.id,
    'verified','pending',transaction_timestamp(),transaction_timestamp(),'synthetic-event',pg_temp.bytes('synthetic-event'),
    transaction_timestamp(),transaction_timestamp()
  from private.integration_connections c join private.provider_entity_mappings m on m.connection_id=c.id and m.status='active'
  where c.id=p_connection;
  return event_id;
end;
$$;

select ok(not has_function_privilege('service_role','public.schedule_qbo_ongoing_v1(integer,text)','execute'),
  'service_role gets no new scheduler authority');
select ok(not has_function_privilege('authenticated','public.schedule_qbo_ongoing_v1(integer,text)','execute'),
  'customers cannot invoke scheduler');
select ok(has_function_privilege('integration_task_scheduler_authority','public.schedule_qbo_ongoing_v1(integer,text)','execute'),
  'existing scheduler role owns the public contract');
update private.integration_workspace_policies set state='paused',sync_enabled=false,row_version=row_version+1,updated_at=clock_timestamp();
select is((public.schedule_qbo_initialization_v2(25,'paused-policy')->>'scheduledTaskCount')::int,0,'paused policy cannot initialize');
update private.integration_workspace_policies set state='enabled',sync_enabled=true,row_version=row_version+1,updated_at=clock_timestamp();
select is((public.schedule_qbo_initialization_v2(1,'initial-a')->>'scheduledTaskCount')::int,24,'initialization remains 24 streams');
select is((select count(*)::int from private.integration_sync_tasks),24,'initial batch is bounded');
select is((public.schedule_qbo_ongoing_v1(25,'initial-not-done')->>'scheduledTaskCount')::int,0,'ongoing waits for actual initialization completion');

-- A pending continuation must prevent successful run finalization.
select pg_temp.finish_task(id,'succeeded') from private.integration_sync_tasks where stream_key<>'accounts';
select is((public.schedule_qbo_ongoing_v1(0,'one-still-pending')->>'settledRunCount')::int,0,'one unfinished stream prevents finalization');
select pg_temp.finish_task(id,'succeeded') from private.integration_sync_tasks where stream_key='accounts';
create temporary table parent_task as select * from private.integration_sync_tasks where stream_key='accounts';
insert into private.integration_sync_tasks
select (jsonb_populate_record(null::private.integration_sync_tasks,to_jsonb(t)||jsonb_build_object(
  'id',gen_random_uuid(),'parent_task_id',t.id,'state','pending','row_version',1,'dispatch_generation',0,
  'delivery_attribution_state','none','last_delivery_dispatch_generation',null,'last_delivery_retry_count',null,
  'last_delivery_execution_count',null,'last_delivery_attempt_fingerprint',null,
  'dispatcher_task_name',null,'completed_at',null,'durable_effect_fingerprint',null,
  'idempotency_fingerprint', '\x'||encode(pg_temp.bytes('continuation'),'hex'),
  'control_metadata',t.control_metadata||jsonb_build_object('pageOrdinal',1,'cursorVersion',1)))).* from parent_task t;
select is((public.schedule_qbo_ongoing_v1(0,'continuation-pending')->>'settledRunCount')::int,0,'terminal parent plus pending child stays running');
select pg_temp.finish_task(id,'succeeded') from private.integration_sync_tasks where state='pending';
select is((public.schedule_qbo_ongoing_v1(0,'all-done')->>'settledRunCount')::int,1,'all terminal successful tasks settle the run');
select is((select state from private.integration_sync_runs where mode='initialization'),'succeeded','successful initialization is derived from tasks');
select is((public.schedule_qbo_ongoing_v1(25,'not-due')->>'scheduledTaskCount')::int,0,'fresh streams do not produce duplicate polling work');

select pg_temp.hint('e9f00000-0000-4000-8000-000000000101') from generate_series(1,3);
select is((public.schedule_qbo_ongoing_v1(25,'hints')->>'scheduledTaskCount')::int,1,'three verified hints produce one CDC task');
select is((select count(*)::int from private.integration_webhook_events where processing_state='coalesced'),3,'all hints coalesce atomically');
select is((select count(distinct resulting_task_id)::int from private.integration_webhook_events),1,'hints have one scoped task lineage');
select pg_temp.hint('e9f00000-0000-4000-8000-000000000101');
select is((public.schedule_qbo_ongoing_v1(25,'active-cdc')->>'scheduledTaskCount')::int,0,'an active CDC stream is not duplicated');
select is((select count(*)::int from private.integration_webhook_events where processing_state='pending'),1,'hints arriving during a read wait for the next window');
select ok(pg_temp.raises_sqlstate($insert$
  insert into private.integration_sync_tasks select (jsonb_populate_record(null::private.integration_sync_tasks,
    to_jsonb(t)||jsonb_build_object('id',gen_random_uuid(),
      'idempotency_fingerprint','\x'||encode(pg_temp.bytes('duplicate'),'hex')))).*
  from private.integration_sync_tasks t where stream_key='qbo_cdc' and state='pending'
$insert$,'23505'),'unique index fences a second active stream even outside the scheduler');
select pg_temp.finish_task(id,'failed','qbo_cdc_single_entity_cap') from private.integration_sync_tasks where state='pending';
select is((public.schedule_qbo_ongoing_v1(25,'capped')->>'blockedCdcCount')::int,1,'capped CDC blocks repeated impossible work');
select is((select state from private.integration_sync_runs where mode='incremental'),'failed','failed CDC never forces successful run state');
select is((select count(*)::int from private.integration_webhook_events where processing_state='dead_letter'),3,'failed CDC does not mark hints successfully processed');
select is((select count(*)::int from private.integration_sync_checkpoints),0,'scheduler never advances checkpoints on failures');

-- Seed the second tenant with a prior successful historical run, without
-- changing clocks, disabling triggers, or modifying immutable task identity.
create temporary table old_run_id as select gen_random_uuid() id;
insert into private.integration_sync_runs
select (jsonb_populate_record(null::private.integration_sync_runs,to_jsonb(r)||jsonb_build_object(
  'id',(select id from old_run_id),'workspace_id',c.workspace_id,'business_entity_id',c.business_entity_id,
  'connection_id',c.id,'connection_generation',c.connection_generation,'mapping_id',m.id,
  'created_at',clock_timestamp()-interval '8 hours','started_at',clock_timestamp()-interval '8 hours',
  'updated_at',clock_timestamp()-interval '7 hours','finished_at',clock_timestamp()-interval '7 hours',
  'window_end_at',clock_timestamp()-interval '8 hours'))).* from private.integration_sync_runs r
cross join private.integration_connections c join private.provider_entity_mappings m on m.connection_id=c.id
where r.mode='initialization' and c.id='e9f00000-0000-4000-8000-000000000103';
select is((public.schedule_qbo_ongoing_v1(25,'fallback-and-periodic')->>'scheduledTaskCount')::int,13,
  'fallback without webhooks schedules CDC plus six reports and six masters');
select is((select count(*)::int from private.integration_sync_tasks where connection_generation=2 and stream_key='qbo_cdc'),1,
  'fallback is scoped to the active generation');
select is((public.schedule_qbo_ongoing_v1(25,'repeat-tick')->>'scheduledTaskCount')::int,0,'repeated tick cannot duplicate active periodic streams');
select pg_temp.finish_task(id,case when stream_key='accounts' then 'failed' else 'succeeded' end)
  from private.integration_sync_tasks where state='pending';
select is((public.schedule_qbo_ongoing_v1(0,'partial')->>'settledRunCount')::int,1,'mixed terminal run settles once');
select is((select state from private.integration_sync_runs where connection_generation=2 and mode='incremental'),
  'partially_succeeded','one failed stream prevents successful overall run');
select is((public.schedule_qbo_ongoing_v1(0,'settled-replay')->>'settledRunCount')::int,0,'terminal run settlement is idempotent');

select pg_temp.hint('e9f00000-0000-4000-8000-000000000103');
update private.integration_workspace_policies set state='paused',sync_enabled=false,row_version=row_version+1,updated_at=clock_timestamp()
  where workspace_id='b9f00000-0000-4000-8000-000000000002';
select is((public.schedule_qbo_ongoing_v1(25,'paused-ongoing')->>'scheduledTaskCount')::int,0,'paused policy blocks ongoing hints as well as initial work');
update private.integration_workspace_policies set state='enabled',sync_enabled=true,row_version=row_version+1,updated_at=clock_timestamp()
  where workspace_id='b9f00000-0000-4000-8000-000000000002';
select is((public.schedule_qbo_ongoing_v1(25,'unpaused')->>'scheduledTaskCount')::int,1,'verified hints resume under enabled policy');
select pg_temp.finish_task(id,'cancelled') from private.integration_sync_tasks where state='pending';
select is((public.schedule_qbo_ongoing_v1(0,'cancelled')->>'settledRunCount')::int,1,'cancelled tasks settle without fabricated success');
select is((select state from private.integration_sync_runs where connection_generation=2 and mode='incremental'
  and id=(select sync_run_id from private.integration_sync_tasks where state='cancelled')),'cancelled','all-cancelled run is cancelled');
select pg_temp.hint('e9f00000-0000-4000-8000-000000000103');
update private.integration_credentials set status='reauthorization_required',row_version=row_version+1,updated_at=clock_timestamp()
  where connection_id='e9f00000-0000-4000-8000-000000000103' and status='active';
select is((public.schedule_qbo_ongoing_v1(25,'no-active-credential')->>'scheduledTaskCount')::int,0,'inactive credential cannot authorize background work');
select is((select count(*)::int from private.integration_webhook_events where processing_state='pending'
  and connection_generation=2),1,'ineligible tenant hints are not consumed by another tenant');
select ok(not has_table_privilege('integration_task_scheduler_authority','private.qbo_production_scheduler_visits','select'),
  'native scheduler still has function-only access to private control metadata');

select * from finish();
rollback;
