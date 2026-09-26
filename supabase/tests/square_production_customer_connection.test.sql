-- Run only in a disposable PostgreSQL 17 database after exactly the 104
-- canonical Production migrations and the unapplied customer migration.
begin;
set search_path=public,extensions;

do $catalog$
declare relation_name text;
begin
  foreach relation_name in array array[
    'square_production_customer_bindings',
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
-- customer activation never drops any foundation protection constraint.
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
  'projects/vaeroex-integrations-prod/secrets/'||case purpose
    when 'database_oauth' then 'square-production-oauth-db'
    when 'database_broker' then 'square-production-broker-db'
    else 'square-production-'||replace(purpose,'_','-') end||'/versions/1'
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
insert into private.square_production_customer_bindings(
  provider_key,environment,project_id,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit
) select configuration.provider_key,configuration.environment,configuration.project_id,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit
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
  from private.square_production_customer_bindings b where b.generation=1;
insert into private.square_production_customer_connections(
  connection_id,workspace_id,business_entity_id,actor_id,session_id,generation,configuration_fingerprint,
  state,created_at,updated_at
) select 'bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-4444-4444-8444-bbbbbbbbbbbb',1,b.configuration_fingerprint,
  'authorization_required',now(),now()
  from private.square_production_customer_bindings b where b.generation=1;

-- More history than the bounded projection must never hide the live row.
insert into private.square_production_customer_connections(
  connection_id,workspace_id,business_entity_id,actor_id,session_id,generation,configuration_fingerprint,
  state,created_at,updated_at,disconnected_at
) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  c.workspace_id,c.business_entity_id,c.actor_id,c.session_id,c.generation,c.configuration_fingerprint,
  'disconnected',now(),now(),now()
  from private.square_production_customer_connections c cross join generate_series(1,40) n
  where c.connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';

-- A consumed attempt can be fenced without inventing a broker acquisition.
insert into private.square_production_customer_oauth_states(
  state_id,connection_id,state_hash,generation,connection_row_version,actor_id,session_id,
  request_fingerprint,consume_fingerprint,status,created_at,expires_at,consumed_at
) select 'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa',connection_id,'sha256:'||repeat('a',64),
  generation,row_version,actor_id,session_id,'sha256:'||repeat('b',64),'sha256:'||repeat('c',64),
  'consumed',now(),now()+interval '10 minutes',now()
  from private.square_production_customer_connections where connection_id='aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa';
update private.square_production_customer_oauth_states set status='uncertain'
  where state_id='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
do $pre_acquire_recovery$
declare rejected boolean:=false;
begin
  if not exists(select 1 from private.square_production_customer_oauth_states
    where state_id='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa' and status='uncertain'
      and exchange_fingerprint is null and consume_fingerprint is not null) then
    raise exception 'customer_pre_acquire_recovery_contract_failed';
  end if;
  begin
    update private.square_production_customer_oauth_states set status='exchanging'
      where state_id='aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa';
  exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'customer_exchange_without_acquisition_allowed'; end if;
end $pre_acquire_recovery$;

set local role authenticated;
do $owner$
declare view jsonb; blocked boolean:=false; closed boolean:=false;
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub','11111111-1111-4111-8111-111111111111',
    'session_id','aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')::text,true);
  view:=public.square_production_customer_v1('status',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  if jsonb_array_length(view->'connections')<>32
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
-- Synthetic, transactional admission using the exact native grant attributes.
-- No actual Production identity or secret is created by this disposable test.
update public.workspace_members set status='active'
  where workspace_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
create role square_production_oauth login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role square_production_broker login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant square_production_oauth_authority to square_production_oauth with admin false, inherit true, set false;
grant square_production_broker_authority to square_production_broker with admin false, inherit true, set false;
update private.square_production_customer_bindings set consent_enabled=true where generation=1;
do $binding$
declare denied boolean:=false;
begin
  -- Missing verified secret metadata still blocks the customer path.
  delete from private.integration_production_provider_secrets where secret_purpose='application';
  begin
    perform private.square_production_customer_require_gate_v1(1,
      (select configuration_fingerprint from private.square_production_customer_bindings where generation=1),'owner');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_missing_application_version_allowed'; end if;
  insert into private.integration_production_provider_secrets values(
    'square','production','vaeroex-integrations-prod','application',
    'projects/vaeroex-integrations-prod/secrets/square-production-application/versions/1');
  if exists(select 1 from private.integration_production_provider_bindings where enabled or provider_calls_enabled
    or customer_onboarding_enabled or webhook_intake_enabled or economic_contributions_enabled or ai_dispatch_enabled)
    or exists(select 1 from private.square_production_configuration_generations where runtime_enabled
      or provider_calls_enabled or customer_onboarding_enabled or evidence_enabled or webhook_intake_enabled
      or economic_contributions_enabled or ai_dispatch_enabled) then
    raise exception 'customer_consent_opened_legacy_gates';
  end if;
end $binding$;
set local role authenticated;
do $customer_prepare$
declare prepared jsonb; created jsonb; state_id uuid:='aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa';
declare connection_id uuid:='aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'; state_hash text:='sha256:'||repeat('d',64);
begin
  prepared:=public.square_production_customer_v1('prepare',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'businessEntityId','aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','connectionId',connection_id));
  if prepared->>'applicationId'<>'sq0idp-production-fixture' then
    raise exception 'customer_active_prepare_failed'; end if;
  -- SQL/JS fingerprint vectors are separately verified by the runner.
  created:=public.square_production_customer_v1('create_state',jsonb_build_object(
    'workspaceId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','connectionId',connection_id,
    'stateId',state_id,'stateHash',state_hash,'expiresAt',clock_timestamp()+interval '5 minutes',
    'requestFingerprint','sha256:fc7794840aa66d571dbe00a3a1c16a258421556aa7d80e1066be6c336914ec20'));
  if created->>'stateId'<>state_id::text then raise exception 'customer_active_create_state_failed'; end if;
end $customer_prepare$;
reset role;
set session authorization square_production_oauth;
do $oauth_native$
declare looked jsonb; consumed jsonb; hash text:='sha256:'||repeat('d',64); denied boolean:=false;
begin
  if pg_has_role(session_user,'square_production_oauth_authority','SET') then
    raise exception 'customer_native_set_role_unexpected'; end if;
  looked:=public.square_production_customer_v1('lookup_state',jsonb_build_object('stateHash',hash));
  if looked->>'accepted'<>'true' or looked->>'workspaceId'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception 'customer_native_oauth_lookup_failed'; end if;
  consumed:=public.square_production_customer_v1('consume_state',jsonb_build_object(
    'stateHash',hash,'requestFingerprint','sha256:9deb94158fa1ddbce3d00a0da73b92524c60def57b2fb97751ff4223d5d1d48f'));
  if consumed->>'status'<>'acquired' then raise exception 'customer_native_oauth_consume_failed'; end if;
  begin
    perform public.square_production_customer_v1('acquire_exchange',jsonb_build_object(
      'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','requestFingerprint','sha256:'||repeat('a',64)));
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_oauth_broker_boundary_failed'; end if;
end $oauth_native$;
reset session authorization;
set session authorization square_production_broker;
do $broker_native$
declare acquired jsonb; replayed jsonb; hash text;
begin
  hash:='sha256:e37e414510d5af07acffbbc96abc3e7e9cb9240514b9cf456a4ba6bc5b80ec1b';
  acquired:=public.square_production_customer_v1('acquire_exchange',jsonb_build_object(
    'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','requestFingerprint',hash));
  replayed:=public.square_production_customer_v1('acquire_exchange',jsonb_build_object(
    'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','requestFingerprint',hash));
  if acquired->>'status'<>'acquired' or replayed->>'status'<>'replayed' then
    raise exception 'customer_native_broker_replay_failed'; end if;
  if public.square_production_customer_v1('authorize_exchange',jsonb_build_object(
    'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','connectionId','aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa',
    'generation',1,'requestFingerprint',hash))->>'authorized'<>'true' then
    raise exception 'customer_native_provider_authorization_failed'; end if;
end $broker_native$;
reset session authorization;
update private.square_production_customer_bindings set consent_enabled=false where generation=1;
set session authorization square_production_broker;
do $closed_again$
declare denied boolean:=false;
begin
  begin
    perform public.square_production_customer_v1('acquire_exchange',jsonb_build_object(
      'stateId','aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa','requestFingerprint','sha256:'||repeat('a',64)));
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'customer_consent_binding_revocation_failed'; end if;
end $closed_again$;
reset session authorization;
rollback;
