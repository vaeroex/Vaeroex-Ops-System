-- Focused native pgTAP suite after the QBO production candidates and dashboard
-- migration. Register in run-qbo-production-candidate-database-tests.cjs.
-- Disposable database only; every fixture change rolls back, guards remain on.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/qbo-production-native.sql

create function pg_temp.owner_claims() returns jsonb language sql immutable as $$
  select '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000001","session_id":"79f00000-0000-4000-8000-000000000101"}'::jsonb;
$$;
create function pg_temp.dashboard_as(claims jsonb default pg_temp.owner_claims(),
  workspace uuid default 'b9f00000-0000-4000-8000-000000000001',test_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims',claims::text,true);
  execute format('set local role %I',test_role);
  result:=public.read_qbo_dashboard_metadata_v1(workspace);
  reset role;
  return result;
exception when others then
  reset role;
  return jsonb_build_object('testErrorState',sqlstate,'testErrorMessage',sqlerrm);
end;
$$;
create function pg_temp.metadata() returns jsonb language sql as $$
  select entry from jsonb_array_elements(pg_temp.dashboard_as()) entry
  where entry->>'connectionId'='e9f00000-0000-4000-8000-000000000101';
$$;

select ok(p.prosecdef and p.provolatile='s' and 'search_path=""'=any(p.proconfig)
  and p.proowner=(select oid from pg_roles where rolname='postgres'),
  'saved read uses stable definer, postgres ownership and empty search_path')
from pg_proc p where oid='public.read_qbo_dashboard_metadata_v1(uuid)'::regprocedure;
select ok(has_function_privilege('authenticated','public.read_qbo_dashboard_metadata_v1(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.read_qbo_dashboard_metadata_v1(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.read_qbo_dashboard_metadata_v1(uuid)','EXECUTE')
  and not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid='public.read_qbo_dashboard_metadata_v1(uuid)'::regprocedure and a.grantee=0),
  'only authenticated has customer execute, with no PUBLIC/service_role shortcut');
select ok(not has_table_privilege('authenticated','private.integration_connections','SELECT')
  and not has_table_privilege('authenticated','private.integration_freshness_states','SELECT'),
  'private source tables remain inaccessible');
select is(jsonb_typeof(pg_temp.dashboard_as()),'array','RPC returns the contracted JSON array directly');
select is(jsonb_array_length(pg_temp.dashboard_as()),1,'only exact owner workspace connections returned');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.metadata()) k),
  array['connectionId','currentUntil','freshness','lastSuccessfulRefreshAt','logicalIdentityKey']::text[],'strict bounded metadata fields');
select is(pg_temp.metadata()->>'freshness','unknown','no freshness is unknown');
select is(pg_temp.metadata()->>'lastSuccessfulRefreshAt',null,'missing required coverage has no successful refresh');
select is(pg_temp.metadata()->>'currentUntil',null,'missing required coverage has no current deadline');
select ok(not (pg_temp.metadata() ? 'noChanges'),'zero source count never produces a no-change claim');
select is(pg_temp.metadata()->>'logicalIdentityKey',
  (select encode(extensions.digest(convert_to(jsonb_build_array(workspace_id,business_entity_id,
    provider_key,provider_environment,'realm:'||encode(provider_tenant_reference_fingerprint,'hex'))::text,'UTF8'),'sha256'),'hex')
    from private.integration_connections where id='e9f00000-0000-4000-8000-000000000101'),
  'opaque identity hashes the exact workspace/entity/provider/environment/realm fingerprint scope');
select ok(pg_temp.dashboard_as()::text not like '%synthetic-production-realm%','raw realm never returned');
select ok(pg_temp.dashboard_as()::text not like '%credential%','credential metadata never returned');

select is(pg_temp.dashboard_as(pg_temp.owner_claims()-'sub')->>'testErrorState','42501','missing auth.uid denied');
select is(pg_temp.dashboard_as(pg_temp.owner_claims()||'{"sub":"invalid"}')->>'testErrorState','42501','malformed auth.uid denied');
select is(pg_temp.dashboard_as(pg_temp.owner_claims()-'session_id')->>'testErrorState','42501','missing session denied');
select is(pg_temp.dashboard_as(pg_temp.owner_claims()||'{"session_id":"invalid"}')->>'testErrorState','42501','malformed session denied');
select is(pg_temp.dashboard_as(pg_temp.owner_claims()||'{"session_id":"79f00000-0000-4000-8000-000000000103"}')->>'testErrorState',
  '42501','another user session denied');
select is(pg_temp.dashboard_as(pg_temp.owner_claims()||'{"role":"service_role"}')->>'testErrorState','42501','service_role JWT denied');
select is(pg_temp.dashboard_as(test_role=>'service_role')->>'testErrorState','42501','service_role execution denied even with owner JWT');
select is(pg_temp.dashboard_as(test_role=>'anon')->>'testErrorState','42501','anon execution denied');
select is(pg_temp.dashboard_as(workspace=>null)->>'testErrorState','42501','null workspace denied');
select is(pg_temp.dashboard_as(workspace=>'b9f00000-0000-4000-8000-000000000002')->>'testErrorState','42501','foreign workspace denied');
select is(pg_temp.dashboard_as(workspace=>'b9f00000-0000-4000-8000-000000000099')->>'testErrorState','42501','nonexistent workspace denied');
do $test$
declare member_role text;
begin
  foreach member_role in array array['admin','manager','staff','viewer'] loop
    update public.workspace_members set role=member_role where user_id='a9f00000-0000-4000-8000-000000000001';
    if pg_temp.dashboard_as()->>'testErrorState' is distinct from '42501' then
      raise exception 'non-owner role was permitted: %',member_role;
    end if;
  end loop;
  update public.workspace_members set role='owner' where user_id='a9f00000-0000-4000-8000-000000000001';
end;
$test$;
select ok(true,'admin, manager, staff and viewer denied');
update public.workspace_members set status='disabled' where user_id='a9f00000-0000-4000-8000-000000000001';
select is(pg_temp.dashboard_as()->>'testErrorState','42501','inactive owner membership denied');
update public.workspace_members set status='active' where user_id='a9f00000-0000-4000-8000-000000000001';
update auth.sessions set not_after=statement_timestamp()-interval '1 minute' where id='79f00000-0000-4000-8000-000000000101';
select is(pg_temp.dashboard_as()->>'testErrorState','42501','expired session denied');
update auth.sessions set not_after=null where id='79f00000-0000-4000-8000-000000000101';
update auth.users set banned_until=statement_timestamp()+interval '1 hour' where id='a9f00000-0000-4000-8000-000000000001';
select is(pg_temp.dashboard_as()->>'testErrorState','42501','banned owner denied');
update auth.users set banned_until=null,deleted_at=statement_timestamp() where id='a9f00000-0000-4000-8000-000000000001';
select is(pg_temp.dashboard_as()->>'testErrorState','42501','deleted owner denied');
update auth.users set deleted_at=null where id='a9f00000-0000-4000-8000-000000000001';

-- Real canonical saved states; fixture mutations obey every existing guard.
create function pg_temp.seed_freshness(connection uuid,mapping uuid,omit text default null) returns void language sql as $$
  insert into private.integration_freshness_states(id,contract_version,workspace_id,business_entity_id,connection_id,
    mapping_id,provider_key,domain,scope_key,last_successful_sync_at,status,blocking_level,policy_version,
    current_max_age_seconds,stale_after_seconds,age_seconds,calculated_at,state_fingerprint,last_request_id,last_request_fingerprint)
  select gen_random_uuid(),'integration_freshness_v1',c.workspace_id,c.business_entity_id,c.id,mapping,c.provider_key,
    private.integration_stream_freshness_domain_v1(c.provider_key,s.stream),s.stream,
    statement_timestamp()-case when s.stream='accounts' then interval '10 minutes' else interval '5 minutes' end,
    'current','none','qbo_control_plane_freshness_policy_v1',
    case when s.stream='qbo_invoice' then 900 else 3600 end,7200,
    case when s.stream='accounts' then 600 else 300 end,statement_timestamp(),decode(repeat('a',64),'hex'),
    'dashboard-fixture',decode(repeat('b',64),'hex')
  from private.integration_connections c,jsonb_array_elements_text(c.capability_snapshot->'requiredStreamKeys') s(stream)
  where c.id=connection and s.stream is distinct from omit;
$$;
update private.integration_connections set status='active',state_reason_code='healthy',row_version=row_version+1,
  updated_at=statement_timestamp() where id='e9f00000-0000-4000-8000-000000000101';
select pg_temp.seed_freshness('e9f00000-0000-4000-8000-000000000101','f9f00000-0000-4000-8000-000000000101','qbo_invoice');
select is(pg_temp.metadata()->>'freshness','unknown','incomplete domain/stream coverage cannot be current');
select is(pg_temp.metadata()->>'lastSuccessfulRefreshAt',null,'MIN cannot ignore a missing required stream');
insert into private.integration_freshness_states
  select (jsonb_populate_record(null::private.integration_freshness_states,to_jsonb(f)||jsonb_build_object(
    'id',gen_random_uuid(),'scope_key','qbo_invoice','current_max_age_seconds',900))).*
  from private.integration_freshness_states f where scope_key='qbo_payment';
select is(pg_temp.metadata()->>'freshness','current','all current canonical streams establish currentness');
select is((pg_temp.metadata()->>'lastSuccessfulRefreshAt')::timestamptz,
  date_trunc('milliseconds',statement_timestamp()-interval '10 minutes'),'refresh time is MIN across required streams');
select is((pg_temp.metadata()->>'currentUntil')::timestamptz,
  date_trunc('milliseconds',statement_timestamp()+interval '10 minutes'),'deadline is MIN of each successful sync plus its own threshold');
select ok(not (pg_temp.metadata() ? 'noChanges'),'successful coverage still does not prove no changes');

savepoint current_freshness;
update private.integration_freshness_states set last_successful_sync_at=statement_timestamp()-interval '2 hours',
  row_version=row_version+1,updated_at=statement_timestamp() where scope_key='qbo_invoice';
select is(pg_temp.metadata()->>'freshness','stale','expired saved current status is evaluated against current time');
rollback to current_freshness;
update private.integration_freshness_states set last_successful_sync_at=statement_timestamp()+interval '1 hour',
  row_version=row_version+1,updated_at=statement_timestamp() where scope_key='qbo_invoice';
select is(pg_temp.metadata()->>'freshness','unknown','future successful timestamp cannot be current');
select is(pg_temp.metadata()->>'currentUntil',null,'invalid timestamps suppress the deadline');
rollback to current_freshness;
update private.integration_freshness_states set last_successful_sync_at='infinity',
  row_version=row_version+1,updated_at=statement_timestamp() where scope_key='qbo_invoice';
select is(pg_temp.metadata()->>'lastSuccessfulRefreshAt',null,'nonfinite timestamp cannot serialize as a refresh');
rollback to current_freshness;
update private.integration_freshness_states set calculated_at=statement_timestamp()+interval '1 hour',
  row_version=row_version+1,updated_at=statement_timestamp() where scope_key='qbo_invoice';
select is(pg_temp.metadata()->>'freshness','unknown','future calculation timestamp cannot be current');
rollback to current_freshness;
update private.integration_freshness_states set status='sync_error',blocking_level='current_intelligence',
  row_version=row_version+1,updated_at=statement_timestamp() where scope_key='qbo_invoice';
select is(pg_temp.metadata()->>'freshness','unknown','blocking or noncurrent stream cannot be current');
select isnt(pg_temp.metadata()->>'lastSuccessfulRefreshAt',null,'last successful refresh remains visible after an error');
rollback to current_freshness;

update private.provider_entity_mappings set status='replaced',row_version=row_version+1,updated_at=statement_timestamp()
  where id='f9f00000-0000-4000-8000-000000000101';
insert into private.provider_entity_mappings
  select (jsonb_populate_record(null::private.provider_entity_mappings,to_jsonb(m)||jsonb_build_object(
    'id','f9f00000-0000-4000-8000-000000000104','mapping_version',2,'replaces_mapping_id',m.id,'status','active','row_version',1))).*
  from private.provider_entity_mappings m where id='f9f00000-0000-4000-8000-000000000101';
select is(pg_temp.metadata()->>'freshness','unknown','replacement mapping cannot borrow prior mapping freshness');
select is(pg_temp.metadata()->>'lastSuccessfulRefreshAt',null,'old mapping never supplies successful refresh');
rollback to current_freshness;
update public.business_entities set status='inactive' where id='d9f00000-0000-4000-8000-000000000001';
select is(pg_temp.metadata()->>'freshness','unknown','inactive entity cannot be current');
rollback to current_freshness;

-- Historical consent, missing consent, pending attempts, and identity fallback.
create function pg_temp.clone_connection(patch jsonb) returns uuid language plpgsql as $$
declare c private.integration_connections;
begin
  perform set_config('request.jwt.claims',pg_temp.owner_claims()::text,true);
  select * into c from private.integration_connections where id='e9f00000-0000-4000-8000-000000000101';
  c.id:=gen_random_uuid(); c.connection_series_id:=c.id;
  c:=jsonb_populate_record(c,patch);
  insert into private.integration_connections select c.*;
  return c.id;
end;
$$;
select pg_temp.clone_connection('{"status":"pending_authorization","state_reason_code":"authorization_pending",
  "authorized_at":null,"granted_scopes":[],"provider_tenant_reference_fingerprint":null}');
select pg_temp.clone_connection('{"status":"error","state_reason_code":"control_plane_error","authorized_at":null}');
select pg_temp.clone_connection('{"status":"error","state_reason_code":"control_plane_error","granted_scopes":[]}');
select pg_temp.clone_connection('{"provider_environment":"sandbox"}');
select is(jsonb_array_length(pg_temp.dashboard_as()),1,'pending, missing authorized_at, missing accounting grant and sandbox excluded');
savepoint consented_rows;
select pg_temp.clone_connection(jsonb_build_object('status','disconnected','state_reason_code','disconnected',
  'disconnected_at',statement_timestamp(),'id','e9f00000-0000-4000-8000-000000000105',
  'connection_series_id','e9f00000-0000-4000-8000-000000000105'));
select is(jsonb_array_length(pg_temp.dashboard_as()),2,'historical disconnected consented metadata retained');
select is((select count(distinct entry->>'logicalIdentityKey')::integer
  from jsonb_array_elements(pg_temp.dashboard_as()) entry),1,'same logical realm reconnect retains opaque identity');
select is((select entry->>'freshness' from jsonb_array_elements(pg_temp.dashboard_as()) entry
  where entry->>'connectionId'='e9f00000-0000-4000-8000-000000000105'),'unknown','historical connection cannot borrow current connection freshness');
rollback to consented_rows;
select pg_temp.clone_connection(jsonb_build_object('status','disconnected','state_reason_code','disconnected',
  'disconnected_at',statement_timestamp(),'provider_tenant_reference_fingerprint',null));
select is((select count(distinct entry->>'logicalIdentityKey')::integer
  from jsonb_array_elements(pg_temp.dashboard_as()) entry),2,'missing trusted realm uses distinct opaque connection identity');
rollback to consented_rows;

-- The fixture already contains a disconnected generation followed by generation 2.
insert into private.provider_entity_mappings
  select (jsonb_populate_record(null::private.provider_entity_mappings,to_jsonb(m)||jsonb_build_object(
    'id','f9f00000-0000-4000-8000-000000000102','mapping_series_id','f9f00000-0000-4000-8000-000000000102',
    'connection_id','e9f00000-0000-4000-8000-000000000102','status','inactive'))).*
  from private.provider_entity_mappings m where id='f9f00000-0000-4000-8000-000000000103';
select pg_temp.seed_freshness('e9f00000-0000-4000-8000-000000000102','f9f00000-0000-4000-8000-000000000102');
select is((select entry->>'lastSuccessfulRefreshAt' from jsonb_array_elements(pg_temp.dashboard_as(
  '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000002","session_id":"79f00000-0000-4000-8000-000000000103"}',
  'b9f00000-0000-4000-8000-000000000002')) entry where entry->>'connectionId'='e9f00000-0000-4000-8000-000000000103'),
  null,'new generation never borrows old generation freshness');

create temporary table before_read as select
  (select jsonb_agg(to_jsonb(c) order by id) from private.integration_connections c) connections,
  (select jsonb_agg(to_jsonb(f) order by id) from private.integration_freshness_states f) freshness,
  (select count(*) from private.integration_sync_tasks) tasks,
  (select count(*) from private.integration_sync_runs) runs;
select is(pg_temp.metadata()->>'freshness','current','owner can read repeatedly');
select ok(b.connections=(select jsonb_agg(to_jsonb(c) order by id) from private.integration_connections c)
  and b.freshness=(select jsonb_agg(to_jsonb(f) order by id) from private.integration_freshness_states f)
  and b.tasks=(select count(*) from private.integration_sync_tasks)
  and b.runs=(select count(*) from private.integration_sync_runs),
  'metadata reads leave saved state unchanged and create no work') from before_read b;

select pg_temp.clone_connection(jsonb_build_object('status','disconnected','state_reason_code','disconnected',
  'disconnected_at',statement_timestamp())) from generate_series(1,99);
select is(jsonb_array_length(pg_temp.dashboard_as()),100,'100 established rows allowed');
select pg_temp.clone_connection(jsonb_build_object('status','disconnected','state_reason_code','disconnected',
  'disconnected_at',statement_timestamp()));
select is(pg_temp.dashboard_as()->>'testErrorState','54000','more than 100 established rows fails closed');

select * from finish();
rollback;
