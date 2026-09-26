-- Run only in a disposable PostgreSQL 17 database after exactly the 104
-- canonical Production migrations and the unapplied customer migration.
begin;
set search_path=public,extensions;

do $catalog$
declare relation_name text;
begin
  foreach relation_name in array array[
    'square_production_customer_connections','square_production_customer_oauth_states',
    'square_production_customer_credentials'
  ] loop
    if not exists(select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=relation_name and c.relkind='r'
        and c.relrowsecurity and c.relforcerowsecurity and c.relowner='postgres'::regrole) then
      raise exception 'customer_rls_contract_failed:%',relation_name;
    end if;
  end loop;
  if pg_catalog.has_table_privilege('authenticated','private.square_production_customer_connections','SELECT')
    or pg_catalog.has_table_privilege('square_production_oauth_authority','private.square_production_customer_credentials','SELECT')
    or pg_catalog.has_table_privilege('square_production_broker_authority','private.square_production_customer_credentials','SELECT')
    or not pg_catalog.has_function_privilege('authenticated','public.square_production_customer_v1(text,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('square_production_oauth_authority','public.square_production_customer_v1(text,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('square_production_broker_authority','public.square_production_customer_v1(text,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','public.square_production_customer_v1(text,jsonb)','EXECUTE') then
    raise exception 'customer_acl_contract_failed';
  end if;
end
$catalog$;

-- The foundation fixture is deliberately closed; this test does not emulate
-- future activation by dropping any Production protection constraint.
insert into private.integration_production_platform_bindings(
  binding_key,environment,project_id,project_number,region,network_name,subnet_name,router_name,nat_name,
  egress_address_name,ingress_address_name,task_queue_name,artifact_repository_name,database_authority_target,
  runtime_policy_version,retention_policy_version,observability_policy_version,backup_policy_version,source_commit
) values (
  'vaeroex-production-integrations-v1','production','vaeroex-integrations-prod','123456789012','us-west1',
  'vaeroex-integrations-production','vaeroex-integrations-us-west1','vaeroex-integrations-router',
  'vaeroex-integrations-nat','vaeroex-integrations-egress','vaeroex-integrations-ingress',
  'vaeroex-integrations-tasks','vaeroex-integrations-images','existing_production_postgres',
  'production_runtime_v1','production_retention_v1','production_observability_v1','production_backup_v1',repeat('a',40)
);
insert into private.integration_production_provider_bindings(
  provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,
  callback_uri,kms_key_resource,source_commit
) values (
  'square','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
  'sq0idp-production-fixture','/api/integrations/square',
  'https://square.vaeroex.com/api/integrations/square/callback',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  repeat('a',40)
);
insert into private.integration_production_provider_secrets(
  provider_key,environment,project_id,secret_purpose,secret_version_resource
) select 'square','production','vaeroex-integrations-prod',purpose,
  'projects/vaeroex-integrations-prod/secrets/square-production-'||replace(purpose,'_','-')||'/versions/1'
  from unnest(array[
    'application','database_broker','database_evidence','database_oauth','database_runtime',
    'database_scheduler','database_webhook','webhook_signature'
  ]::text[]) purpose;
insert into private.integration_production_provider_capabilities(
  provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose
) select 'square','production','vaeroex-integrations-prod',capability,
  'sq-prod-'||replace(capability,'_','-')||'@vaeroex-integrations-prod.iam.gserviceaccount.com',
  case when capability='task_invoker' then null else ('square_production_'||capability)::name end,
  case when capability='task_invoker' then null else 'database_'||capability end
  from unnest(array['broker','evidence','oauth','runtime','scheduler','task_invoker','webhook']::text[]) capability;
insert into private.square_production_configuration_generations(
  generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
) values (
  1,'sq0idp-production-fixture',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  'square_production_customer_v1',repeat('a',40),statement_timestamp()
);
insert into private.square_production_runtime_bindings(
  provider_key,environment,project_id,region,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
) select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
  statement_timestamp()
  from private.square_production_configuration_generations configuration
  cross join private.integration_production_platform_bindings platform
  where configuration.generation=1;

insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
  values
  ('11111111-1111-4111-8111-111111111111','owner-a@example.invalid','{}','{}',now(),now()),
  ('22222222-2222-4222-8222-222222222222','owner-b@example.invalid','{}','{}',now(),now());
insert into public.profiles(id,email,full_name) values
  ('11111111-1111-4111-8111-111111111111','owner-a@example.invalid','Owner A'),
  ('22222222-2222-4222-8222-222222222222','owner-b@example.invalid','Owner B')
  on conflict(id) do nothing;
insert into public.workspaces(id,name,created_by) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Customer A','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Customer B','22222222-2222-4222-8222-222222222222');
insert into public.workspace_members(workspace_id,user_id,role,status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner','active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner','active');
insert into public.business_entities(
  id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by
) values
  ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','entity-a','Entity A','USD','UTC',
    '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','entity-b','Entity B','USD','UTC',
    '22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222');
insert into auth.sessions(id,user_id,not_after) values
  ('aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',now()+interval '1 day'),
  ('bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',now()+interval '1 day');
do $unpaid$
declare denied boolean:=false;
begin
  begin
    perform private.square_production_customer_require_eligible_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_unpaid_workspace_allowed'; end if;
end
$unpaid$;
insert into public.customer_subscriptions(
  user_id,workspace_id,customer_email,status,billing_provider,current_period_end,
  stripe_customer_id,stripe_subscription_id,manually_activated
) values (
  '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'owner-a@example.invalid','active','stripe',now()+interval '1 month',
  'cus_customer_fixture','sub_customer_fixture',false
);
select private.square_production_customer_require_eligible_v1('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into private.square_production_customer_connections(
  connection_id,workspace_id,business_entity_id,actor_id,session_id,generation,configuration_fingerprint,
  state,created_at,updated_at
) select 'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',1,b.configuration_fingerprint,
  'authorization_required',now(),now()
  from private.square_production_runtime_bindings b where b.generation=1;
insert into private.square_production_customer_connections(
  connection_id,workspace_id,business_entity_id,actor_id,session_id,generation,configuration_fingerprint,
  state,created_at,updated_at
) select 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb',1,b.configuration_fingerprint,
  'authorization_required',now(),now()
  from private.square_production_runtime_bindings b where b.generation=1;

set local role authenticated;
do $owner$
declare view jsonb; blocked boolean:=false; closed boolean:=false;
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub','11111111-1111-4111-8111-111111111111',
    'session_id','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')::text,true);
  view:=public.square_production_customer_v1('status',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  if jsonb_array_length(view->'connections')<>1
    or view#>>'{connections,0,connectionId}'<>'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
    or view#>>'{businessEntities,0,id}'<>'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' then
    raise exception 'customer_owner_status_isolation_failed';
  end if;
  begin
    perform public.square_production_customer_v1('status',jsonb_build_object(
      'workspaceId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'customer_cross_workspace_status_allowed'; end if;
  begin
    perform public.square_production_customer_v1('prepare',jsonb_build_object(
      'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      'connectionId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa'));
  exception when insufficient_privilege then closed:=true; end;
  if not closed then raise exception 'customer_closed_gate_allowed_prepare'; end if;
  view:=public.square_production_customer_v1('disconnect',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','confirmation','disconnect'));
  if view->>'fenced'<>'true' then raise exception 'customer_disconnect_failed'; end if;
  if public.square_production_customer_v1('disconnect',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'connectionId','aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa','confirmation','disconnect'))
    ->>'fenced'<>'true' then raise exception 'customer_disconnect_replay_failed'; end if;
end
$owner$;

reset role;
do $cross_workspace$
begin
  if (select state from private.square_production_customer_connections
      where connection_id='bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb')<>'authorization_required' then
    raise exception 'customer_disconnect_cross_workspace_mutation';
  end if;
end
$cross_workspace$;
update public.workspace_members set status='disabled'
  where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
do $revocation$
declare denied boolean:=false;
begin
  begin
    perform public.square_production_customer_v1('status',jsonb_build_object(
      'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_revoked_owner_allowed'; end if;
end
$revocation$;

reset role;
rollback;
