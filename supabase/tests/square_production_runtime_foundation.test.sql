begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create or replace function pg_temp.error_state(p_sql text)
returns text language plpgsql as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end
$function$;

select is((select count(*)::integer from pg_catalog.pg_roles
  where rolname in ('square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority')
    and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and
    not rolcreaterole and not rolreplication and not rolbypassrls),6,
  'All six Production authority roles remain fixed NOLOGIN least-privilege capabilities');
select is((select count(*)::integer from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles r on r.oid in (m.roleid,m.member)
  where r.rolname like 'square_production_%_authority'),0,
  'Production authority roles start with no memberships');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.square_production_runtime_binding'::regclass),
  'Production binding uses FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.square_production_sync_schedule'::regclass),
  'Production schedule uses FORCE RLS');

insert into public.profiles(id,email,full_name) values
  ('a9120000-0000-4000-8000-000000000001','square-production-foundation@example.test','Square Production Foundation');
insert into public.workspaces(id,name,created_by) values
  ('b9120000-0000-4000-8000-000000000001','Square Production Foundation','a9120000-0000-4000-8000-000000000001');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by)
values('d9120000-0000-4000-8000-000000000001','b9120000-0000-4000-8000-000000000001',
  'square_production_foundation','Square Production Foundation','USD','UTC','active',
  'a9120000-0000-4000-8000-000000000001','a9120000-0000-4000-8000-000000000001');

insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,
  webhook_login,kms_key_resource,approval_expires_at)
values
  ('production','sq0idp-production-test','https://square.vaeroex.com/api/integrations/square/callback',
    'square_production_broker','square_production_oauth','square_production_webhook',
    'projects/vaeroex-square-production/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
    '2099-01-01T00:00:00Z'),
  ('sandbox','sandbox-sq0idb-test','https://square-sandbox.vaeroex.com/api/integrations/square/callback',
    'square_sandbox_broker','square_sandbox_oauth','square_sandbox_webhook','sandbox-kms','2099-01-01T00:00:00Z');

create or replace function pg_temp.insert_binding(p_application_origin text,p_kms text)
returns void language plpgsql as $function$
begin
  insert into private.square_production_runtime_binding(binding_key,environment,api_version,application_id,application_origin,
    callback_origin,callback_uri,project_id,project_number,region,kms_key_resource,application_secret_version_resource,
    webhook_signature_version_resource,oauth_database_secret_version_resource,broker_database_secret_version_resource,
    scheduler_database_secret_version_resource,webhook_database_secret_version_resource,runtime_database_secret_version_resource,
    evidence_database_secret_version_resource,oauth_service_account,broker_service_account,scheduler_service_account,
    webhook_service_account,runtime_service_account,evidence_service_account,task_invoker_service_account,queue_resource,
    oauth_login,broker_login,scheduler_login,webhook_login,runtime_login,evidence_login,approval_expires_at,source_commit,
    policy_version,policy_fingerprint)
  values('square-production-v1','production','2026-08-19','sq0idp-production-test',p_application_origin,
    'https://square.vaeroex.com','https://square.vaeroex.com/api/integrations/square/callback','vaeroex-square-production',
    '123456789012','us-west1',p_kms,
    'projects/vaeroex-square-production/secrets/app/versions/1','projects/vaeroex-square-production/secrets/webhook/versions/1',
    'projects/vaeroex-square-production/secrets/oauth/versions/1','projects/vaeroex-square-production/secrets/broker/versions/1',
    'projects/vaeroex-square-production/secrets/scheduler/versions/1','projects/vaeroex-square-production/secrets/webhook-db/versions/1',
    'projects/vaeroex-square-production/secrets/runtime/versions/1','projects/vaeroex-square-production/secrets/evidence/versions/1',
    'oauth@vaeroex-square-production.iam.gserviceaccount.com','broker@vaeroex-square-production.iam.gserviceaccount.com',
    'scheduler@vaeroex-square-production.iam.gserviceaccount.com','webhook@vaeroex-square-production.iam.gserviceaccount.com',
    'runtime@vaeroex-square-production.iam.gserviceaccount.com','evidence@vaeroex-square-production.iam.gserviceaccount.com',
    'task-invoker@vaeroex-square-production.iam.gserviceaccount.com',
    'projects/vaeroex-square-production/locations/us-west1/queues/square-production-sync','square_production_oauth',
    'square_production_broker','square_production_scheduler','square_production_webhook','square_production_runtime',
    'square_production_evidence','2099-01-01T00:00:00Z',repeat('a',40),'test-v1','sha256:'||repeat('a',64));
end
$function$;
select is(pg_temp.error_state($sql$select pg_temp.insert_binding('https://127.0.0.1',
  'projects/vaeroex-square-production/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials')$sql$),
  '23514','Private/numeric Production origins reject in the database');
select is(pg_temp.error_state($sql$select pg_temp.insert_binding('https://internal',
  'projects/vaeroex-square-production/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials')$sql$),
  '23514','Single-label Production origins reject in the database');
select is(pg_temp.error_state($sql$select pg_temp.insert_binding('https://www.vaeroex.com',
  'projects/other-production/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials')$sql$),
  '23514','Cross-project KMS resources reject in the database');
select lives_ok($sql$select pg_temp.insert_binding('https://www.vaeroex.com',
  'projects/vaeroex-square-production/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials')$sql$,
  'An exact durable Production binding is accepted');
select is(pg_temp.error_state($sql$update private.square_account_configuration
  set redirect_uri='https://changed.vaeroex.com/api/integrations/square/callback'
  where environment='production' and application_id='sq0idp-production-test'$sql$),
  '23503','Configuration cannot drift after an exact binding is installed');

insert into private.square_connections(connection_id,workspace_id,business_entity_id,seller_id,environment,current_generation,state,created_at,updated_at)
values
  ('e9120000-0000-4000-8000-000000000001','b9120000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
    'production-seller','production',1,'active',now(),now()),
  ('e9120000-0000-4000-8000-000000000002','b9120000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
    'sandbox-seller','sandbox',1,'active',now(),now());
insert into private.square_connection_generations(connection_id,connection_generation,workspace_id,business_entity_id,identity_mode,
  identity_evidence_fingerprint,retention_policy_version,retention_approval_fingerprint,retention_expires_at,enrolled_by,enrolled_at)
select connection_id,1,workspace_id,business_entity_id,'oauth_verified','sha256:'||repeat('b',64),'test-v1',
  'sha256:'||repeat('c',64),'2099-01-01T00:00:00Z',current_user,now() from private.square_connections;
insert into private.square_account_connections(connection_id,workspace_id,business_entity_id,environment,application_id,generation,row_version,
  state,authorization_operation,initiating_actor,initiating_session,created_at,updated_at)
values
  ('e9120000-0000-4000-8000-000000000001','b9120000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
    'production','sq0idp-production-test',1,1,'authorized','connect','a9120000-0000-4000-8000-000000000001',
    'f9120000-0000-4000-8000-000000000001',now(),now()),
  ('e9120000-0000-4000-8000-000000000002','b9120000-0000-4000-8000-000000000001','d9120000-0000-4000-8000-000000000001',
    'sandbox','sandbox-sq0idb-test',1,1,'authorized','connect','a9120000-0000-4000-8000-000000000001',
    'f9120000-0000-4000-8000-000000000002',now(),now());

insert into private.square_production_sync_schedule(connection_id,connection_generation,workspace_id,business_entity_id,
  environment,application_id,next_refresh_at,next_sync_at,state)
values('e9120000-0000-4000-8000-000000000001',1,'b9120000-0000-4000-8000-000000000001',
  'd9120000-0000-4000-8000-000000000001','production','sq0idp-production-test',now()+interval '1 day',now(),'ready');
select is((select count(*)::integer from private.square_production_sync_schedule),1,
  'Exact Production application connection and generation may be scheduled');
update private.square_account_connections set environment='production',application_id='sq0idp-production-test'
  where connection_id='e9120000-0000-4000-8000-000000000002';
select is(pg_temp.error_state($sql$
  insert into private.square_production_sync_schedule(connection_id,connection_generation,workspace_id,business_entity_id,
    environment,application_id,next_refresh_at,next_sync_at,state)
  values('e9120000-0000-4000-8000-000000000002',1,'b9120000-0000-4000-8000-000000000001',
    'd9120000-0000-4000-8000-000000000001','production','sq0idp-production-test',now()+interval '1 day',now(),'ready')
$sql$),'23503','A cross-wired Sandbox generation cannot enter the Production schedule');

select * from finish();
rollback;
