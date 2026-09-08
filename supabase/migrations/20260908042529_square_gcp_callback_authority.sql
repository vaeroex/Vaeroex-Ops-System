-- Dormant, additive native-GCP callback authority. Installs no host approval,
-- LOGIN, membership, credential, enrollment, task, provider call or activation.
-- Existing Vercel and Square lifecycle routines are intentionally unchanged.
begin;

create table private.square_gcp_callback_binding (
  deployment_key text primary key check(deployment_key='square-gcp-sandbox-callback'),
  project_ref text not null check(project_ref='oysjpoondtcrqpghhrbd'),
  application_origin text not null check(application_origin='https://square-sandbox.vaeroex.com'),
  environment text not null check(environment='sandbox'),
  application_id text not null check(application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw'),
  api_version text not null check(api_version='2026-08-19'),
  gcp_project_id text not null check(gcp_project_id='vaeroex-square-sandbox'),
  gcp_project_number text not null check(gcp_project_number ~ '^[1-9][0-9]{0,20}$'),
  gcp_zone text not null check(gcp_zone='us-west1-a'),
  gcp_instance_id text not null check(gcp_instance_id ~ '^[1-9][0-9]{0,20}$'),
  gcp_instance_name text not null check(gcp_instance_name='square-sandbox-callback'),
  service_account_email text not null,
  service_account_subject text not null check(service_account_subject ~ '^[1-9][0-9]{0,20}$'),
  identity_audience text not null check(identity_audience='https://square-sandbox.vaeroex.com/_identity/square-callback'),
  operator_id uuid not null references auth.users(id) on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  broker_login name not null check(broker_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  enabled boolean not null default false,
  provider_calls_enabled boolean not null default false,
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  policy_version text not null check(policy_version ~ '^[A-Za-z0-9._:-]{1,128}$'),
  policy_fingerprint text not null check(policy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  kms_key_resource text not null,
  app_secret_version_resource text not null,
  database_secret_version_resource text not null,
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete restrict,
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict,
  check(service_account_email ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$'
    and split_part(service_account_email,'@',2)=gcp_project_id||'.iam.gserviceaccount.com'),
  check(length(kms_key_resource)<=2048 and kms_key_resource ~ '^projects/[^/]+/locations/us-west1/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+$'
    and split_part(kms_key_resource,'/',2)=gcp_project_id),
  check(length(app_secret_version_resource)<=2048 and app_secret_version_resource ~ '^projects/[^/]+/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(app_secret_version_resource,'/',2)=gcp_project_id),
  check(length(database_secret_version_resource)<=2048 and database_secret_version_resource ~ '^projects/[^/]+/secrets/square-sandbox-callback-db/versions/[1-9][0-9]*$'
    and split_part(database_secret_version_resource,'/',2)=gcp_project_id
    and database_secret_version_resource<>app_secret_version_resource)
);
alter table private.square_gcp_callback_binding enable row level security;
alter table private.square_gcp_callback_binding force row level security;
revoke all on table private.square_gcp_callback_binding from public,anon,authenticated,service_role,
  square_account_broker_authority,square_verified_enrollment_authority,
  square_ingestion_runtime_authority,square_ingestion_qualification_admin;

create function private.square_gcp_callback_binding_v1() returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare
  b private.square_gcp_callback_binding;
  c private.square_account_configuration;
  operator_role text;
  now_at timestamptz;
begin
  -- Fresh catalog attributes/memberships after lock waits are required. This new
  -- branch does not change the isolation behavior of any existing routine.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  select * into b from private.square_gcp_callback_binding
    where deployment_key='square-gcp-sandbox-callback' for share;
  if not found or not b.enabled or b.broker_login is distinct from session_user::name then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  select * into c from private.square_account_configuration
    where environment=b.environment and application_id=b.application_id for share;
  if not found or not c.surface_enabled or c.blocked
    or c.broker_login is distinct from b.broker_login
    or c.broker_login=c.enrollment_login or c.broker_login=c.webhook_login
    or c.redirect_uri is distinct from b.application_origin||'/api/integrations/square/callback'
    or c.kms_key_resource is distinct from b.kms_key_resource
    or c.retention_policy_version is distinct from b.policy_version
    or c.retention_approval_fingerprint is distinct from b.policy_fingerprint
    -- Callback consent requires an approved retention policy, not enrollment
    -- activation. Mapping/enrollment remains a separate absent capability.
    or c.source_retention_seconds is null or c.source_retention_seconds<=0
    or c.cursor_retention_seconds is null or c.cursor_retention_seconds not between 1 and 3600
    or c.revocation_access_policy is distinct from 'deny_source_access'
    or exists(select 1 from private.square_account_capacity_blocks where environment=b.environment and application_id=b.application_id) then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  select role into operator_role from public.workspace_members
    where workspace_id=b.workspace_id and user_id=b.operator_id and status='active'
      and role in ('owner','admin','manager') for share;
  if not found then raise exception using errcode='42501',message='square_gcp_callback_denied'; end if;
  perform 1 from public.business_entities where workspace_id=b.workspace_id
    and id=b.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_gcp_callback_denied'; end if;
  -- pg_has_role may retain a membership cache during a blocked statement. Read
  -- all MEMBER edges from fresh catalogs after the final blocking lock instead.
  if not exists(with recursive memberships(roleid) as (
    select r.oid from pg_catalog.pg_roles r where r.rolname=session_user
    union
    select m.roleid from pg_catalog.pg_auth_members m join memberships p on m.member=p.roleid
  ) select 1 from pg_catalog.pg_roles r where r.rolname=session_user
    and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
    and exists(select 1 from memberships m join pg_catalog.pg_roles p on p.oid=m.roleid where p.rolname='square_account_broker_authority')
    and not exists(select 1 from memberships m join pg_catalog.pg_roles p on p.oid=m.roleid
      where p.rolname in ('square_verified_enrollment_authority','square_ingestion_runtime_authority','square_ingestion_qualification_admin'))) then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  now_at:=pg_catalog.clock_timestamp();
  if b.approval_expires_at<=now_at or c.approval_expires_at<=now_at then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  return pg_catalog.jsonb_build_object(
    'contractVersion','square_gcp_callback_binding_v1','projectRef',b.project_ref,
    'applicationOrigin',b.application_origin,'environment',b.environment,'applicationId',b.application_id,'apiVersion',b.api_version,
    'gcpProjectId',b.gcp_project_id,'gcpProjectNumber',b.gcp_project_number,'gcpZone',b.gcp_zone,
    'gcpInstanceId',b.gcp_instance_id,'gcpInstanceName',b.gcp_instance_name,
    'serviceAccountEmail',b.service_account_email,'serviceAccountSubject',b.service_account_subject,'identityAudience',b.identity_audience,
    'operatorId',b.operator_id,'operatorRole',operator_role,'workspaceId',b.workspace_id,'businessEntityId',b.business_entity_id,
    'brokerLogin',b.broker_login,'enabled',b.enabled,'providerCallsEnabled',b.provider_calls_enabled,
    'approvalExpiresAt',least(b.approval_expires_at,c.approval_expires_at),'policyVersion',b.policy_version,'policyFingerprint',b.policy_fingerprint,
    'kmsKeyResource',b.kms_key_resource,'appSecretVersionResource',b.app_secret_version_resource,'databaseSecretVersionResource',b.database_secret_version_resource);
end;
$fn$;

create function private.square_gcp_callback_context_v1(p_context jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare b jsonb; session_expiry timestamptz;
begin
  b:=private.square_gcp_callback_binding_v1();
  perform private.square_account_configuration_v1(p_context);
  if b->>'operatorId' is distinct from p_context#>>'{actor,actorId}'
    or b->>'operatorRole' is distinct from p_context#>>'{actor,role}'
    or b->>'workspaceId' is distinct from p_context#>>'{actor,workspaceId}'
    or b->>'environment' is distinct from p_context->>'environment'
    or b->>'applicationId' is distinct from p_context->>'applicationId'
    or (b->>'applicationOrigin')||'/api/integrations/square/callback' is distinct from p_context->>'redirectUri' then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  -- Session expiry must use wall time after session/member locks too.
  select not_after into session_expiry from auth.sessions
    where id=(p_context#>>'{actor,sessionId}')::uuid and user_id=(p_context#>>'{actor,actorId}')::uuid for share;
  if not found or session_expiry<=pg_catalog.clock_timestamp() then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  -- Repeat the fresh LOGIN/catalog check after any session lock wait.
  return private.square_gcp_callback_binding_v1();
end;
$fn$;

create function public.get_square_gcp_callback_binding_v1() returns jsonb
language sql security definer set search_path='' as $fn$
  select private.square_gcp_callback_binding_v1();
$fn$;

create function public.check_square_gcp_callback_consent_v1(p_context jsonb,p_consent jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; a private.square_account_connections; s private.square_account_oauth_states; now_at timestamptz;
begin
  b:=private.square_gcp_callback_context_v1(p_context);
  if p_consent is null or pg_catalog.pg_column_size(p_consent)>4096
    or not private.jsonb_has_exact_keys_v1(p_consent,array['stateId','connectionId','connectionGeneration','expectedConnectionRowVersion','consumedAt']) then
    raise exception using errcode='42501',message='square_gcp_callback_consent_denied';
  end if;
  a:=private.lock_square_account_v1(p_context,(p_consent->>'connectionId')::uuid);
  select * into s from private.square_account_oauth_states where state_id=(p_consent->>'stateId')::uuid for share;
  if not found then raise exception using errcode='42501',message='square_gcp_callback_consent_denied'; end if;
  b:=private.square_gcp_callback_context_v1(p_context);
  now_at:=pg_catalog.clock_timestamp();
  if not (b->>'providerCallsEnabled')::boolean
    or a.business_entity_id::text is distinct from b->>'businessEntityId'
    or a.state<>'authorization_required' or a.revocation_pending
    or a.initiating_actor<>(p_context#>>'{actor,actorId}')::uuid or a.initiating_session<>(p_context#>>'{actor,sessionId}')::uuid
    or a.generation is distinct from (p_consent->>'connectionGeneration')::bigint
    or a.row_version is distinct from (p_consent->>'expectedConnectionRowVersion')::bigint
    or s.connection_id<>a.connection_id or s.generation<>a.generation or s.connection_row_version<>a.row_version
    or s.actor_id<>a.initiating_actor or s.session_id<>a.initiating_session
    or s.redirect_uri is distinct from p_context->>'redirectUri' or s.operation<>a.authorization_operation
    or s.status<>'exchanging' or s.expires_at<=now_at or s.consumed_at is null
    or s.consumed_at is distinct from (p_consent->>'consumedAt')::timestamptz
    or a.revoked_before>=s.created_at
    or exists(select 1 from private.square_account_revocation_events where environment=a.environment and application_id=a.application_id
      and merchant_id=a.merchant_id and revoked_at>=s.created_at)
    or exists(select 1 from private.square_account_enrollments where connection_id=a.connection_id and generation=a.generation) then
    raise exception using errcode='42501',message='square_gcp_callback_consent_denied';
  end if;
  return b;
end;
$fn$;

-- This wrapper is the only RPC exposed by the new request-owned adapter. It
-- retains the existing lifecycle's exact checks and then validates new host and
-- current actor authority after its last lock, before its transaction can commit.
create function public.square_gcp_callback_account_v1(p_context jsonb,p_operation text,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb; target_connection_id uuid; account_entity uuid; state_record private.square_account_oauth_states;
begin
  b:=private.square_gcp_callback_context_v1(p_context);
  if p_operation is null or p_operation not in ('status','prepare','create_state','lookup_state','consume_state','deny_state',
      'store_credential','authorization_failed','disconnect','audit')
    or p_command is null or pg_catalog.pg_column_size(p_command)>2097152 then
    raise exception using errcode='42501',message='square_gcp_callback_operation_denied';
  end if;
  if p_operation in ('prepare','create_state') then
    if p_command->>'businessEntityId' is distinct from b->>'businessEntityId' then
      raise exception using errcode='42501',message='square_gcp_callback_operation_denied';
    end if;
  end if;
  if p_operation in ('lookup_state','consume_state','deny_state') then
    select s.connection_id into target_connection_id from private.square_account_oauth_states s where state_hash=p_command->>'stateHash';
  elsif p_operation='store_credential' then target_connection_id:=(p_command#>>'{command,connectionId}')::uuid;
  elsif p_operation<>'status' then target_connection_id:=(p_command->>'connectionId')::uuid;
  end if;
  if target_connection_id is not null then
    select a.business_entity_id into account_entity from private.square_account_connections a where a.connection_id=target_connection_id;
    if found and account_entity::text is distinct from b->>'businessEntityId' then
      raise exception using errcode='42501',message='square_gcp_callback_operation_denied';
    end if;
  end if;
  result:=public.square_account_connection_v1(p_context,p_operation,p_command);
  if private.square_gcp_callback_context_v1(p_context) is distinct from b then
    raise exception using errcode='42501',message='square_gcp_callback_denied';
  end if;
  if target_connection_id is not null then
    select a.business_entity_id into account_entity from private.square_account_connections a where a.connection_id=target_connection_id;
    if found and account_entity::text is distinct from b->>'businessEntityId' then
      raise exception using errcode='42501',message='square_gcp_callback_operation_denied';
    end if;
  end if;
  if p_operation='consume_state' and result->>'accepted'='true' then
    select * into strict state_record from private.square_account_oauth_states where state_id=(result->>'stateId')::uuid;
    perform public.check_square_gcp_callback_consent_v1(p_context,pg_catalog.jsonb_build_object(
      'stateId',state_record.state_id,'connectionId',state_record.connection_id,'connectionGeneration',state_record.generation,
      'expectedConnectionRowVersion',state_record.connection_row_version,'consumedAt',state_record.consumed_at));
  end if;
  if p_operation='store_credential' and result->>'idempotent'='false' then
    -- The historical function reads its clock before acquiring the state row.
    -- Preserve its existing idempotent-receipt recovery, but a NEW stored result
    -- cannot commit if that final lock wait outlived this callback intent.
    select * into strict state_record from private.square_account_oauth_states
      where state_id=(p_command#>>'{command,oauthStateId}')::uuid;
    if state_record.expires_at<=pg_catalog.clock_timestamp() then
      raise exception using errcode='42501',message='square_gcp_callback_consent_denied';
    end if;
  end if;
  if p_operation='status' then
    result:=pg_catalog.jsonb_set(result,'{businessEntities}',coalesce((select pg_catalog.jsonb_agg(value) from pg_catalog.jsonb_array_elements(result->'businessEntities') where value->>'id'=b->>'businessEntityId'),'[]'::jsonb));
    result:=pg_catalog.jsonb_set(result,'{connections}',coalesce((select pg_catalog.jsonb_agg(value) from pg_catalog.jsonb_array_elements(result->'connections') where value->>'businessEntityId'=b->>'businessEntityId'),'[]'::jsonb));
  end if;
  return result;
end;
$fn$;

revoke all on function private.square_gcp_callback_binding_v1(),private.square_gcp_callback_context_v1(jsonb)
  from public,anon,authenticated,service_role,square_account_broker_authority,square_verified_enrollment_authority,
    square_ingestion_runtime_authority,square_ingestion_qualification_admin;
revoke all on function public.get_square_gcp_callback_binding_v1(),public.check_square_gcp_callback_consent_v1(jsonb,jsonb),public.square_gcp_callback_account_v1(jsonb,text,jsonb)
  from public,anon,authenticated,service_role,square_verified_enrollment_authority,square_ingestion_runtime_authority,square_ingestion_qualification_admin;
grant execute on function public.get_square_gcp_callback_binding_v1(),public.check_square_gcp_callback_consent_v1(jsonb,jsonb),public.square_gcp_callback_account_v1(jsonb,text,jsonb)
  to square_account_broker_authority;
commit;
