-- Additive, dormant native-GCP mapping and read-only ingestion authority.
-- No LOGIN, credential, approval, mapping, enrollment, task or activation is
-- installed. The existing callback-only surface and Vercel binding stay separate.
begin;

create table private.square_gcp_mapped_runtime_binding (
  deployment_key text primary key references private.square_gcp_callback_binding(deployment_key) on delete restrict,
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  connection_generation bigint not null check(connection_generation>0),
  operator_session_id uuid not null references auth.sessions(id) on delete restrict,
  default_location_id text not null check(length(default_location_id) between 1 and 32 and default_location_id ~ '^[A-Za-z0-9._:-]+$'),
  discovery_fingerprint text not null check(discovery_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  enroller_login name not null check(enroller_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  runtime_login name not null check(runtime_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  enroller_database_secret_version_resource text not null check(enroller_database_secret_version_resource ~ '^projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db/versions/[1-9][0-9]*$' and length(enroller_database_secret_version_resource)<=256),
  runtime_database_secret_version_resource text not null check(runtime_database_secret_version_resource ~ '^projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db/versions/[1-9][0-9]*$' and length(runtime_database_secret_version_resource)<=256),
  enabled boolean not null default false,
  provider_calls_enabled boolean not null default false,
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  check(enroller_login<>runtime_login)
);
alter table private.square_gcp_mapped_runtime_binding enable row level security;
alter table private.square_gcp_mapped_runtime_binding force row level security;
revoke all on private.square_gcp_mapped_runtime_binding from public,anon,authenticated,service_role,
  square_account_broker_authority,square_verified_enrollment_authority,square_ingestion_runtime_authority,square_ingestion_qualification_admin;

create function private.square_gcp_mapped_runtime_binding_v1() returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare b private.square_gcp_callback_binding; m private.square_gcp_mapped_runtime_binding;
  c private.square_account_configuration; a private.square_account_connections;
  actor_role text; session_expiry timestamptz; capability text; now_at timestamptz;
begin
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  select * into b from private.square_gcp_callback_binding where deployment_key='square-gcp-sandbox-callback' for share;
  if not found or not b.enabled or b.provider_calls_enabled then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  select * into m from private.square_gcp_mapped_runtime_binding where deployment_key=b.deployment_key for share;
  if not found or not m.enabled then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  capability:=case session_user::name when b.broker_login then 'broker' when m.enroller_login then 'enroller' when m.runtime_login then 'runtime' end;
  select * into c from private.square_account_configuration where environment=b.environment and application_id=b.application_id for share;
  if not found or capability is null or not c.surface_enabled or c.blocked
    or c.broker_login is distinct from b.broker_login or c.enrollment_login is distinct from m.enroller_login
    or b.broker_login in (m.enroller_login,m.runtime_login,c.webhook_login)
    or c.webhook_login in (m.enroller_login,m.runtime_login)
    or c.redirect_uri is distinct from b.application_origin||'/api/integrations/square/callback'
    or c.kms_key_resource is distinct from b.kms_key_resource
    or c.retention_policy_version is distinct from b.policy_version or c.retention_approval_fingerprint is distinct from b.policy_fingerprint
    or c.source_retention_seconds is null or c.source_retention_seconds<=0
    or c.cursor_retention_seconds is null or c.cursor_retention_seconds not between 1 and 3600
    or c.revocation_access_policy is distinct from 'deny_source_access'
    or exists(select 1 from private.square_account_capacity_blocks where environment=b.environment and application_id=b.application_id) then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  select role into actor_role from public.workspace_members where workspace_id=b.workspace_id and user_id=b.operator_id
    and status='active' and role in ('owner','admin','manager') for share;
  if not found then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  select not_after into session_expiry from auth.sessions where id=m.operator_session_id and user_id=b.operator_id for share;
  if not found or session_expiry is null then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  perform 1 from public.business_entities where workspace_id=b.workspace_id and id=b.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  select * into a from private.square_account_connections where connection_id=m.connection_id for share;
  if not found or a.workspace_id<>b.workspace_id or a.business_entity_id<>b.business_entity_id
    or a.environment<>b.environment or a.application_id<>b.application_id or a.generation<>m.connection_generation
    or a.state not in ('mapping_required','authorized') or a.revocation_pending
    or a.discovery->>'fingerprint' is distinct from m.discovery_fingerprint
    or a.discovery->>'defaultLocationId' is distinct from m.default_location_id
    or not exists(select 1 from pg_catalog.jsonb_array_elements(a.discovery->'locations') l
      where l->>'id'=m.default_location_id and l->>'status'='ACTIVE') then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  -- Catalog membership must be fresh after every possible lock wait. No SET
  -- ROLE, owner, combined-capability LOGIN or JWT claim substitutes session_user.
  if not exists(with recursive memberships(roleid) as (
    select oid from pg_catalog.pg_roles where rolname=session_user union
    select r.roleid from pg_catalog.pg_auth_members r join memberships p on r.member=p.roleid
  ) select 1 from pg_catalog.pg_roles r where r.rolname=session_user and r.rolcanlogin
    and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
    and exists(select 1 from memberships x join pg_catalog.pg_roles y on y.oid=x.roleid
      where y.rolname=case capability when 'broker' then 'square_account_broker_authority' when 'enroller' then 'square_verified_enrollment_authority' else 'square_ingestion_runtime_authority' end)
    and not exists(select 1 from memberships x join pg_catalog.pg_roles y on y.oid=x.roleid
      where y.rolname in ('square_account_broker_authority','square_verified_enrollment_authority','square_ingestion_runtime_authority','square_ingestion_qualification_admin')
      and y.rolname<>case capability when 'broker' then 'square_account_broker_authority' when 'enroller' then 'square_verified_enrollment_authority' else 'square_ingestion_runtime_authority' end)) then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  now_at:=pg_catalog.clock_timestamp();
  if least(b.approval_expires_at,m.approval_expires_at,c.approval_expires_at,session_expiry)<=now_at then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return pg_catalog.jsonb_build_object(
    'contractVersion','square_gcp_mapped_runtime_binding_v1','projectRef',b.project_ref,'applicationOrigin',b.application_origin,
    'environment',b.environment,'applicationId',b.application_id,'apiVersion',b.api_version,
    'gcpProjectId',b.gcp_project_id,'gcpProjectNumber',b.gcp_project_number,'gcpZone',b.gcp_zone,'gcpInstanceId',b.gcp_instance_id,
    'gcpInstanceName',b.gcp_instance_name,'serviceAccountEmail',b.service_account_email,'serviceAccountSubject',b.service_account_subject,'identityAudience',b.identity_audience,
    'operatorId',b.operator_id,'operatorRole',actor_role,'workspaceId',b.workspace_id,'businessEntityId',b.business_entity_id,
    'brokerLogin',b.broker_login,'enabled',m.enabled,'providerCallsEnabled',b.provider_calls_enabled,
    'approvalExpiresAt',least(b.approval_expires_at,c.approval_expires_at),
    'mappedApprovalExpiresAt',least(b.approval_expires_at,m.approval_expires_at,c.approval_expires_at,session_expiry),
    'policyVersion',b.policy_version,'policyFingerprint',b.policy_fingerprint,'kmsKeyResource',b.kms_key_resource,
    'appSecretVersionResource',b.app_secret_version_resource,'databaseSecretVersionResource',b.database_secret_version_resource,
    'capability',capability,'enrollerLogin',m.enroller_login,'runtimeLogin',m.runtime_login,'connectionId',m.connection_id,
    'connectionGeneration',m.connection_generation,'operatorSessionId',m.operator_session_id,'defaultLocationId',m.default_location_id,
    'discoveryFingerprint',m.discovery_fingerprint,'mappedProviderCallsEnabled',m.provider_calls_enabled,
    'enrollerDatabaseSecretVersionResource',m.enroller_database_secret_version_resource,'runtimeDatabaseSecretVersionResource',m.runtime_database_secret_version_resource);
end;
$fn$;

create function private.square_gcp_mapped_context_v1(p_context jsonb,p_capability text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare b jsonb;
begin
  b:=private.square_gcp_mapped_runtime_binding_v1();
  if b->>'capability' is distinct from p_capability or p_capability not in ('broker','enroller') then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  perform private.square_account_configuration_v1(p_context,true,p_capability='enroller');
  if b->>'operatorId' is distinct from p_context#>>'{actor,actorId}' or b->>'operatorRole' is distinct from p_context#>>'{actor,role}'
    or b->>'workspaceId' is distinct from p_context#>>'{actor,workspaceId}' or b->>'operatorSessionId' is distinct from p_context#>>'{actor,sessionId}'
    or b->>'environment' is distinct from p_context->>'environment' or b->>'applicationId' is distinct from p_context->>'applicationId'
    or (b->>'applicationOrigin')||'/api/integrations/square/callback' is distinct from p_context->>'redirectUri' then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return private.square_gcp_mapped_runtime_binding_v1();
end;
$fn$;

create function public.get_square_gcp_mapped_runtime_binding_v1() returns jsonb
language sql security definer set search_path='' as $fn$ select private.square_gcp_mapped_runtime_binding_v1(); $fn$;

create function public.square_gcp_mapped_account_v1(p_context jsonb,p_operation text,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb; evidence private.square_account_credential_reads;
begin
  b:=private.square_gcp_mapped_context_v1(p_context,'broker');
  if p_operation is null or p_operation not in ('confirm_mapping','credential_metadata','read_credential','read_failure','audit')
    or p_command is null or pg_catalog.pg_column_size(p_command)>2097152 then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  if p_operation in ('confirm_mapping','credential_metadata','audit') and p_command->>'connectionId' is distinct from b->>'connectionId' then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  if p_operation='confirm_mapping' and (p_command->>'businessEntityId' is distinct from b->>'businessEntityId'
    or p_command->'locationIds' is distinct from pg_catalog.jsonb_build_array(b->>'defaultLocationId')) then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  if p_operation in ('read_credential','read_failure') and not (b->>'mappedProviderCallsEnabled')::boolean then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  if p_operation='read_failure' then
    select * into evidence from private.square_account_credential_reads where evidence_id=(p_command->>'credentialReadEvidenceId')::uuid;
    if not found or evidence.connection_id::text is distinct from b->>'connectionId' or evidence.reader_login is distinct from session_user::name then
      raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
    perform private.square_gcp_mapped_task_v1(evidence.task_id,'broker');
  end if;
  result:=public.square_account_connection_v1(p_context,p_operation,p_command);
  if private.square_gcp_mapped_context_v1(p_context,'broker') is distinct from b then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;

create function public.enroll_square_gcp_verified_connection_v1(p_context jsonb,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_context_v1(p_context,'enroller');
  if p_command->>'connectionId' is distinct from b->>'connectionId' or p_command->'generation' is distinct from b->'connectionGeneration' then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  result:=public.enroll_square_verified_connection_v1(p_context,p_command);
  if private.square_gcp_mapped_context_v1(p_context,'enroller') is distinct from b then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;

-- Task/lease/payload validation stays in the existing checked routines. The
-- extra host boundary confines every invocation to one approved generation.
create function private.square_gcp_mapped_task_v1(p_task_id uuid,p_capability text) returns jsonb
language plpgsql security invoker set search_path='' as $fn$
declare b jsonb; t private.square_ingestion_tasks;
begin
  b:=private.square_gcp_mapped_runtime_binding_v1();
  if b->>'capability' is distinct from p_capability or not (b->>'mappedProviderCallsEnabled')::boolean then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  select * into t from private.square_ingestion_tasks where task_id=p_task_id;
  if not found or t.connection_id::text is distinct from b->>'connectionId'
    or t.connection_generation is distinct from (b->>'connectionGeneration')::bigint
    or t.workspace_id::text is distinct from b->>'workspaceId' or t.business_entity_id::text is distinct from b->>'businessEntityId'
    or t.runtime_login::text is distinct from b->>'runtimeLogin' then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  return b;
end;
$fn$;

create function public.enroll_square_gcp_verified_task_v1(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_runtime_binding_v1();
  if b->>'capability'<>'enroller' or not (b->>'mappedProviderCallsEnabled')::boolean
    or p_command->>'connectionId' is distinct from b->>'connectionId'
    or p_command->'generation' is distinct from b->'connectionGeneration'
    or p_command->>'runtimeLogin' is distinct from b->>'runtimeLogin' then
    raise exception using errcode='42501',message='square_gcp_mapped_operation_denied'; end if;
  result:=public.enroll_square_verified_task_v1(p_command);
  if private.square_gcp_mapped_runtime_binding_v1() is distinct from b then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;

create function public.resolve_square_gcp_ingestion_authority_v1(p_task_id uuid,p_lease_owner_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_task_v1(p_task_id,'runtime');
  result:=public.resolve_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  if private.square_gcp_mapped_task_v1(p_task_id,'runtime') is distinct from b then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;
create function public.acquire_square_gcp_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_binding jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_task_v1(p_task_id,'runtime');
  result:=public.acquire_square_ingestion_page_v1(p_task_id,p_lease_owner_fingerprint,p_binding);
  if private.square_gcp_mapped_task_v1(p_task_id,'runtime') is distinct from b then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;
create function public.commit_square_gcp_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_task_v1(p_task_id,'runtime');
  result:=public.commit_square_ingestion_page_v1(p_task_id,p_lease_owner_fingerprint,p_command);
  if private.square_gcp_mapped_task_v1(p_task_id,'runtime') is distinct from b then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;
create function public.release_square_gcp_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_lease jsonb,p_release jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare b jsonb; result jsonb;
begin
  b:=private.square_gcp_mapped_task_v1(p_task_id,'runtime');
  result:=public.release_square_ingestion_page_v1(p_task_id,p_lease_owner_fingerprint,p_lease,p_release);
  if private.square_gcp_mapped_task_v1(p_task_id,'runtime') is distinct from b then raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  return result;
end;
$fn$;

revoke all on function private.square_gcp_mapped_runtime_binding_v1(),private.square_gcp_mapped_context_v1(jsonb,text),private.square_gcp_mapped_task_v1(uuid,text),
  public.get_square_gcp_mapped_runtime_binding_v1(),public.square_gcp_mapped_account_v1(jsonb,text,jsonb),public.enroll_square_gcp_verified_connection_v1(jsonb,jsonb),
  public.enroll_square_gcp_verified_task_v1(jsonb),public.resolve_square_gcp_ingestion_authority_v1(uuid,text),public.acquire_square_gcp_ingestion_page_v1(uuid,text,jsonb),
  public.commit_square_gcp_ingestion_page_v1(uuid,text,jsonb),public.release_square_gcp_ingestion_page_v1(uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role,square_account_broker_authority,square_verified_enrollment_authority,square_ingestion_runtime_authority,square_ingestion_qualification_admin;
grant execute on function public.get_square_gcp_mapped_runtime_binding_v1() to square_account_broker_authority,square_verified_enrollment_authority,square_ingestion_runtime_authority;
grant execute on function public.square_gcp_mapped_account_v1(jsonb,text,jsonb) to square_account_broker_authority;
grant execute on function public.enroll_square_gcp_verified_connection_v1(jsonb,jsonb),public.enroll_square_gcp_verified_task_v1(jsonb) to square_verified_enrollment_authority;
grant execute on function public.resolve_square_gcp_ingestion_authority_v1(uuid,text),public.acquire_square_gcp_ingestion_page_v1(uuid,text,jsonb),
  public.commit_square_gcp_ingestion_page_v1(uuid,text,jsonb),public.release_square_gcp_ingestion_page_v1(uuid,text,jsonb,jsonb) to square_ingestion_runtime_authority;

create or replace function private.lock_square_broker_credential_authority_v1(
  p_context jsonb,p_task_id uuid,p_lease_owner_fingerprint text)
returns private.square_ingestion_tasks
language plpgsql security invoker set search_path='' as $function$
declare
  v_task private.square_ingestion_tasks;
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_binding jsonb;
  v_now timestamptz;
  v_locations jsonb;
begin
  -- Preserve the existing combined-login local account qualification exactly.
  -- This does not grant runtime authority to the separate Sandbox broker.
  if pg_catalog.pg_has_role(session_user,'square_ingestion_runtime_authority','MEMBER') then
    return private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  end if;
  -- Delegated runtime authorization must observe committed catalog changes after
  -- lock waits. REPEATABLE READ/SERIALIZABLE retain stale pg_roles attributes even
  -- in this volatile function; this new branch supports READ COMMITTED only.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  if exists(select 1 from private.square_gcp_callback_binding b join private.square_gcp_mapped_runtime_binding m using(deployment_key)
      where b.broker_login=session_user::name) then
    v_binding:=private.square_gcp_mapped_context_v1(p_context,'broker');
    perform private.square_gcp_mapped_task_v1(p_task_id,'broker');
  else
    v_binding:=public.get_square_remote_sandbox_binding_v1();
  end if;
  if v_binding->>'brokerLogin' is distinct from session_user::text
    or v_binding->>'operatorId' is distinct from p_context#>>'{actor,actorId}'
    or v_binding->>'operatorRole' is distinct from p_context#>>'{actor,role}'
    or v_binding->>'workspaceId' is distinct from p_context#>>'{actor,workspaceId}'
    or v_binding->>'environment' is distinct from p_context->>'environment'
    or v_binding->>'applicationId' is distinct from p_context->>'applicationId'
    or (v_binding->>'applicationOrigin')||'/api/integrations/square/callback' is distinct from p_context->>'redirectUri'
    or not exists(select 1 from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
      and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
      and pg_catalog.pg_has_role(r.oid,'square_ingestion_runtime_authority','MEMBER')
      and not pg_catalog.pg_has_role(r.oid,'square_ingestion_qualification_admin','MEMBER')) then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  -- Keep the original connection -> immutable task -> entity lock order.
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  select * into v_connection from private.square_connections where connection_id=v_task.connection_id for share;
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id for share;
  perform 1 from public.business_entities where workspace_id=v_task.workspace_id and id=v_task.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  perform private.assert_square_task_mode_v1(v_task);
  -- Credential release subsequently takes this same scan lock. Acquire it now
  -- so a scan wait cannot carry the host/task approval past its deadline.
  perform 1 from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for share;
  -- A live actor session must still be valid after a page-lock wait, not merely
  -- at entry into the account RPC. This reuses the complete checked boundary.
  perform private.square_account_configuration_v1(p_context);
  -- Row locks do not stabilize role membership or LOGIN attributes. Recheck after
  -- every blocking authority lock. pg_has_role can retain a membership cache for
  -- the blocked statement, so read the complete MEMBER graph from fresh catalogs
  -- (including non-inherited/non-settable grants). Missing/renamed roles deny.
  if not exists(with recursive runtime_roles(roleid) as (
    select r.oid from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
    union
    select m.roleid from pg_catalog.pg_auth_members m join runtime_roles r on m.member=r.roleid
  ) select 1 from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
    and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
    and exists(select 1 from runtime_roles m join pg_catalog.pg_roles c on c.oid=m.roleid where c.rolname='square_ingestion_runtime_authority')
    and not exists(select 1 from runtime_roles m join pg_catalog.pg_roles c on c.oid=m.roleid where c.rolname='square_ingestion_qualification_admin')) then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  -- Account/configuration checks above can wait too; read wall time afterwards.
  v_now:=pg_catalog.clock_timestamp();
  if v_connection.state<>'active' or v_connection.current_generation<>v_task.connection_generation
    or v_connection.workspace_id<>v_task.workspace_id or v_connection.business_entity_id<>v_task.business_entity_id
    or v_task.runtime_login::text is distinct from v_binding->>'runtimeLogin'
    or v_task.workspace_id::text is distinct from v_binding->>'workspaceId'
    or v_task.business_entity_id::text is distinct from v_binding->>'businessEntityId'
    or v_task.lease_owner_fingerprint is distinct from p_lease_owner_fingerprint
    or v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now
    or (v_binding->>'approvalExpiresAt')::timestamptz<=v_now then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations from private.square_location_mappings
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  if v_generation.identity_mode<>'oauth_verified'
    or v_generation.retention_expires_at<=v_now
    or v_task.retention_policy_version<>v_generation.retention_policy_version
    or v_task.retention_expires_at<>v_generation.retention_expires_at
    or v_task.grant#>'{scope,authorizedLocationIds}' is distinct from v_locations
    or v_task.grant#>>'{scope,sellerId}' is distinct from v_connection.seller_id
    or v_task.grant#>>'{scope,environment}' is distinct from v_connection.environment then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  if v_binding->>'contractVersion'='square_gcp_mapped_runtime_binding_v1' then
    if private.square_gcp_mapped_context_v1(p_context,'broker') is distinct from v_binding then
      raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied';
    end if;
    perform private.square_gcp_mapped_task_v1(p_task_id,'broker');
  end if;
  return v_task;
end;
$function$;

commit;
