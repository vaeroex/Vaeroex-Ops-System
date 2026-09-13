begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create or replace function pg_temp.error_state(p_sql text)
returns text language plpgsql as $function$
begin execute p_sql; return null; exception when others then return sqlstate; end
$function$;

select is((select count(*)::integer from pg_catalog.pg_roles where rolname in (
  'square_production_oauth_authority','square_production_broker_authority',
  'square_production_scheduler_authority','square_production_webhook_authority',
  'square_production_runtime_authority','square_production_evidence_authority')
  and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and
  not rolcreaterole and not rolreplication and not rolbypassrls),6,
  'Square provider roles are fixed NOLOGIN least-privilege capabilities');
select is((select count(*)::integer from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r
  on r.oid in (m.roleid,m.member) where r.rolname like 'square_production_%_authority'),0,
  'Square provider roles start with no memberships');

select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.integration_production_platform_bindings'::regclass),'Platform binding uses FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.integration_production_provider_bindings'::regclass),'Provider binding uses FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.integration_production_provider_secrets'::regclass),'Provider secrets use FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.integration_production_provider_capabilities'::regclass),'Provider capabilities use FORCE RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class
  where oid='private.square_production_runtime_binding'::regclass),'Square overlay uses FORCE RLS');

insert into private.integration_production_platform_bindings(
  binding_key,environment,project_id,project_number,region,network_name,subnet_name,router_name,nat_name,
  egress_address_name,ingress_address_name,task_queue_name,artifact_repository_name,database_authority_target,
  runtime_policy_version,retention_policy_version,observability_policy_version,backup_policy_version,source_commit)
values ('vaeroex-production-integrations-v1','production','vaeroex-integrations-prod','123456789012','us-west1',
  'vaeroex-integrations-production','vaeroex-integrations-us-west1','vaeroex-integrations-router','vaeroex-integrations-nat',
  'vaeroex-integrations-egress','vaeroex-integrations-ingress','vaeroex-integrations-tasks','vaeroex-integrations-images',
  'existing_production_postgres','production_runtime_v1','production_retention_v1','production_observability_v1',
  'production_backup_v1',repeat('a',40));

select is((select infrastructure_provisioned::text||':'||runtime_enabled::text||':'||economic_contributions_enabled::text||':'||ai_dispatch_enabled::text
  from private.integration_production_platform_bindings),'false:false:false:false','Shared platform starts completely dormant');
select is(pg_temp.error_state($sql$
  update private.integration_production_platform_bindings set project_id='p'||repeat('x',30)
$sql$),'23514','Project IDs longer than the checked 30-character platform bound are rejected');

select is(pg_temp.error_state($sql$
  insert into private.integration_production_provider_bindings(
    provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,callback_uri,kms_key_resource,source_commit)
  values ('badhost','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
    'badhost-production-test','/api/integrations/badhost','https://internal/api/integrations/badhost/callback',
    'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/badhost-production/cryptoKeys/provider-credentials',repeat('a',40))
$sql$),'23514','Single-label provider callback hosts are rejected');
select is(pg_temp.error_state($sql$
  insert into private.integration_production_provider_bindings(
    provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,callback_uri,kms_key_resource,source_commit)
  values ('badkms','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
    'badkms-production-test','/api/integrations/badkms','https://badkms.vaeroex.com/api/integrations/badkms/callback',
    'garbage/vaeroex-integrations-prod/garbage/us-west1/keyRings/bad/cryptoKeys/bad',repeat('a',40))
$sql$),'23514','Malformed provider KMS resource paths are rejected');
select is(pg_temp.error_state($sql$
  insert into private.integration_production_provider_bindings(
    provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,callback_uri,kms_key_resource,source_commit)
  values ('longkms','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
    'longkms-production-test','/api/integrations/longkms','https://longkms.vaeroex.com/api/integrations/longkms/callback',
    'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/longkms-production/cryptoKeys/'||repeat('x',64),repeat('a',40))
$sql$),'23514','KMS names longer than the checked 63-character bound are rejected');

insert into private.integration_production_provider_bindings(
  provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,callback_uri,kms_key_resource,source_commit)
values ('square','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
  'sq0idp-production-test',
  '/api/integrations/square','https://square.vaeroex.com/api/integrations/square/callback',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  repeat('a',40));

insert into private.integration_production_provider_secrets(provider_key,environment,project_id,secret_purpose,secret_version_resource)
values
  ('square','production','vaeroex-integrations-prod','application','projects/vaeroex-integrations-prod/secrets/square-application/versions/1'),
  ('square','production','vaeroex-integrations-prod','webhook_signature','projects/vaeroex-integrations-prod/secrets/square-webhook/versions/1');
insert into private.integration_production_provider_secrets(provider_key,environment,project_id,secret_purpose,secret_version_resource)
select 'square','production','vaeroex-integrations-prod','database_'||capability,
  'projects/vaeroex-integrations-prod/secrets/square-'||replace(capability,'_','-')||'-db/versions/1'
from unnest(array['oauth','broker','scheduler','webhook','runtime','evidence']::text[]) capability;

insert into private.integration_production_provider_capabilities(
  provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose)
select 'square','production','vaeroex-integrations-prod',capability,'square-'||replace(capability,'_','-')||'@vaeroex-integrations-prod.iam.gserviceaccount.com',
  case when capability='task_invoker' then null else ('square_production_'||capability)::name end,
  case when capability='task_invoker' then null else 'database_'||capability end
from unnest(array['oauth','broker','scheduler','webhook','runtime','evidence','task_invoker']::text[]) capability;

select is((select count(*)::integer from private.integration_production_provider_capabilities where provider_key='square'),7,
  'Square capabilities are provider-scoped and individually identified');
insert into private.integration_production_provider_bindings(
  provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,callback_uri,kms_key_resource,source_commit)
values ('quickbooks_online','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
  'qbo-production-test',
  '/api/integrations/quickbooks-online','https://integrations.vaeroex.com/api/integrations/quickbooks-online/callback',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/qbo-production/cryptoKeys/provider-credentials',repeat('a',40));
select is(pg_temp.error_state($sql$
  insert into private.integration_production_provider_secrets(provider_key,environment,project_id,secret_purpose,secret_version_resource)
  values ('quickbooks_online','production','vaeroex-integrations-prod','application',
    'projects/vaeroex-integrations-prod/secrets/square-application/versions/1')
$sql$),'23505','A future provider cannot reuse a Square application secret');
insert into private.integration_production_provider_secrets(provider_key,environment,project_id,secret_purpose,secret_version_resource)
values ('quickbooks_online','production','vaeroex-integrations-prod','database_runtime',
  'projects/vaeroex-integrations-prod/secrets/qbo-runtime-db/versions/1');
select is(pg_temp.error_state($sql$
  insert into private.integration_production_provider_capabilities(
    provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose)
  values ('quickbooks_online','production','vaeroex-integrations-prod','runtime',
    'square-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com',
    'quickbooks_online_production_runtime','database_runtime')
$sql$),'23505','A capability cannot replace an existing Square capability');

insert into public.profiles(id,email,full_name) values
  ('a9120000-0000-4000-8000-000000000001','square-production-foundation@example.test','Square Production Foundation');
insert into public.workspaces(id,name,created_by) values
  ('b9120000-0000-4000-8000-000000000001','Square Production Foundation','a9120000-0000-4000-8000-000000000001');
insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by)
values ('d9120000-0000-4000-8000-000000000001','b9120000-0000-4000-8000-000000000001',
  'square_production_foundation','Square Production Foundation','USD','UTC','active',
  'a9120000-0000-4000-8000-000000000001','a9120000-0000-4000-8000-000000000001');
insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,
  webhook_login,kms_key_resource,approval_expires_at)
values ('production','sq0idp-production-test','https://square.vaeroex.com/api/integrations/square/callback',
  'square_production_broker','square_production_oauth','square_production_webhook',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/mismatched-provider-credentials',
  '2099-01-01T00:00:00Z');

select is(pg_temp.error_state($sql$
  insert into private.square_production_runtime_binding(provider_key,environment,application_id,callback_uri,api_version,
    authorization_endpoint,provider_origin,requested_scopes,kms_key_resource,square_configuration_fingerprint,
    provider_policy_version,provider_policy_fingerprint)
  select 'square','production','sq0idp-production-test','https://square.vaeroex.com/api/integrations/square/callback',
    '2026-08-19','https://connect.squareup.com/oauth2/authorize','https://connect.squareup.com',
    array['INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ']::text[],
    'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
    square_production_binding_fingerprint,'square_production_policy_v1','sha256:'||repeat('b',64)
  from private.square_account_configuration where environment='production' and application_id='sq0idp-production-test'
$sql$),'23503','Square overlay cannot split provider and account KMS authority');

update private.square_account_configuration
set kms_key_resource='projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials'
where environment='production' and application_id='sq0idp-production-test';

insert into private.square_production_runtime_binding(provider_key,environment,application_id,callback_uri,api_version,
  authorization_endpoint,provider_origin,requested_scopes,kms_key_resource,square_configuration_fingerprint,
  provider_policy_version,provider_policy_fingerprint)
select 'square','production','sq0idp-production-test','https://square.vaeroex.com/api/integrations/square/callback',
  '2026-08-19','https://connect.squareup.com/oauth2/authorize',
  'https://connect.squareup.com',array['INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ']::text[],
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  square_production_binding_fingerprint,'square_production_policy_v1','sha256:'||repeat('b',64)
from private.square_account_configuration where environment='production' and application_id='sq0idp-production-test';
select is((select count(*)::integer from private.square_production_runtime_binding),1,
  'Exact Square overlay binds to the provider-neutral platform');
select is((select (provider_authority_fingerprint=(select provider_authority_fingerprint
    from private.integration_production_provider_bindings where provider_key='square'))::text||':'||
    (square_configuration_authority_fingerprint=(select square_production_authority_fingerprint
      from private.square_account_configuration where environment='production' and application_id='sq0idp-production-test'))::text
  from private.square_production_runtime_binding),'true:true',
  'Compact fingerprints preserve exact provider and Square callback/KMS authority');

select is((select count(*)::integer from information_schema.role_table_grants where table_schema='private'
  and table_name in ('integration_production_platform_bindings','integration_production_provider_bindings',
    'integration_production_provider_secrets','integration_production_provider_capabilities','square_production_runtime_binding')
  and grantee in ('anon','authenticated','service_role','square_production_runtime_authority')),0,
  'No public, service-role or dormant provider capability receives table access');

select * from finish();
rollback;
