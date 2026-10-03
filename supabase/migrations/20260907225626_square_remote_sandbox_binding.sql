-- Remote Sandbox host attestation. This installs no approval, LOGIN, membership,
-- credential, seller mapping, enrollment, task, scheduler or activation.
-- An owner must provision the exact isolated deployment and approve its policy
-- separately. Ordinary API roles cannot read or change this private record.
begin;

create table private.square_remote_sandbox_binding (
  deployment_key text primary key check(deployment_key='vaeroex-square-sandbox'),
  project_ref text not null check(project_ref='oysjpoondtcrqpghhrbd'),
  vercel_team_id text not null check(vercel_team_id='team_uORtrMvad77Qz6HikOgD4cnp'),
  vercel_team_slug text not null check(vercel_team_slug='vaeroex-2167s-projects'),
  vercel_project_id text not null check(vercel_project_id ~ '^prj_[A-Za-z0-9]{16,64}$'
    and vercel_project_id <> 'prj_J810bZ9ECoN4CyLKujUoEEH8N6ja'),
  application_origin text not null check(application_origin='https://square-sandbox.vaeroex.com'),
  environment text not null check(environment='sandbox'),
  application_id text not null check(application_id='sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw'),
  api_version text not null check(api_version='2026-08-19'),
  operator_id uuid not null references auth.users(id) on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  broker_login name not null check(broker_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  enroller_login name not null check(enroller_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  webhook_login name not null check(webhook_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  runtime_login name not null check(runtime_login::text ~ '^square_sandbox_[a-z_]{1,40}$'),
  enabled boolean not null default false,
  provider_calls_enabled boolean not null default false,
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  policy_version text not null check(length(policy_version) between 1 and 128),
  policy_fingerprint text not null check(policy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  kms_key_resource text,
  app_secret_version_resource text,
  webhook_secret_version_resource text,
  credential_service_account text,
  workload_identity_audience text,
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete restrict,
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict,
  check(broker_login<>enroller_login and broker_login<>webhook_login and broker_login<>runtime_login
    and enroller_login<>webhook_login and enroller_login<>runtime_login and webhook_login<>runtime_login),
  check(kms_key_resource is null or (length(kms_key_resource)<=2048 and kms_key_resource ~ '^projects/[^/]+/locations/[^/]+/keyRings/[^/]+/cryptoKeys/[^/]+$')),
  check(app_secret_version_resource is null or (length(app_secret_version_resource)<=2048 and app_secret_version_resource ~ '^projects/[^/]+/secrets/[^/]+/versions/[0-9]+$')),
  check(webhook_secret_version_resource is null or (length(webhook_secret_version_resource)<=2048 and webhook_secret_version_resource ~ '^projects/[^/]+/secrets/[^/]+/versions/[0-9]+$')),
  check(credential_service_account is null or (length(credential_service_account)<=254 and credential_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$')),
  check(workload_identity_audience is null or (length(workload_identity_audience)<=512 and workload_identity_audience ~ '^//iam\.googleapis\.com/projects/[0-9]+/locations/global/workloadIdentityPools/[a-z0-9-]+/providers/[a-z0-9-]+$')),
  check(not provider_calls_enabled or (kms_key_resource is not null and app_secret_version_resource is not null
    and webhook_secret_version_resource is not null and credential_service_account is not null and workload_identity_audience is not null))
);
alter table private.square_remote_sandbox_binding enable row level security;
alter table private.square_remote_sandbox_binding force row level security;
revoke all on table private.square_remote_sandbox_binding from public,anon,authenticated,service_role,
  square_account_broker_authority,square_verified_enrollment_authority,
  square_ingestion_runtime_authority,square_ingestion_qualification_admin;

-- The deployment receives only one owner-approved binding, never a caller-
-- selected workspace. The actual LOGIN (not SET ROLE/JWT/GUC claims) is checked.
-- Locks are held in the caller's transaction together with its checked RPC.
create function public.get_square_remote_sandbox_binding_v1() returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_binding private.square_remote_sandbox_binding;
  v_config private.square_account_configuration;
  v_now timestamptz;
  v_capability text;
  v_operator_role text;
begin
  select * into v_binding from private.square_remote_sandbox_binding
    where deployment_key='vaeroex-square-sandbox' for share;
  if not found or not v_binding.enabled then
    raise exception using errcode='42501',message='square_remote_sandbox_denied';
  end if;
  v_capability:=case session_user::name
    when v_binding.broker_login then 'square_account_broker_authority'
    when v_binding.enroller_login then 'square_verified_enrollment_authority'
    when v_binding.webhook_login then 'square_account_broker_authority'
    when v_binding.runtime_login then 'square_ingestion_runtime_authority' end;
  if v_capability is null or not pg_catalog.pg_has_role(session_user,v_capability,'MEMBER')
    or not exists(select 1 from pg_catalog.pg_roles where rolname=session_user
      and rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication) then
    raise exception using errcode='42501',message='square_remote_sandbox_denied';
  end if;
  select * into v_config from private.square_account_configuration
    where environment=v_binding.environment and application_id=v_binding.application_id for share;
  if not found or not v_config.surface_enabled or v_config.blocked
    or v_config.redirect_uri is distinct from v_binding.application_origin||'/api/integrations/square/callback'
    or v_config.broker_login is distinct from v_binding.broker_login
    or v_config.enrollment_login is distinct from v_binding.enroller_login
    or v_config.webhook_login is distinct from v_binding.webhook_login
    or v_config.retention_policy_version is distinct from v_binding.policy_version
    or v_config.retention_approval_fingerprint is distinct from v_binding.policy_fingerprint
    or v_config.source_retention_seconds is null or v_config.source_retention_seconds<=0
    or v_config.cursor_retention_seconds is null or v_config.cursor_retention_seconds not between 1 and 3600
    or v_config.revocation_access_policy is distinct from 'deny_source_access'
    or (v_binding.provider_calls_enabled and v_config.kms_key_resource is distinct from v_binding.kms_key_resource)
    or exists(select 1 from private.square_account_capacity_blocks
      where environment=v_binding.environment and application_id=v_binding.application_id) then
    raise exception using errcode='42501',message='square_remote_sandbox_denied';
  end if;
  select role into v_operator_role from public.workspace_members
    where workspace_id=v_binding.workspace_id and user_id=v_binding.operator_id
      and status='active' and role in ('owner','admin','manager') for share;
  if not found then raise exception using errcode='42501',message='square_remote_sandbox_denied'; end if;
  perform 1 from public.business_entities
    where workspace_id=v_binding.workspace_id and id=v_binding.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_remote_sandbox_denied'; end if;
  -- Re-evaluate wall time after every possible row-lock wait. A transaction-start
  -- timestamp must not extend approval while waiting for another operator.
  v_now:=pg_catalog.clock_timestamp();
  if v_binding.approval_expires_at<=v_now or v_config.approval_expires_at<=v_now then
    raise exception using errcode='42501',message='square_remote_sandbox_denied';
  end if;
  return pg_catalog.jsonb_build_object(
    'contractVersion','square_remote_sandbox_binding_v1',
    'projectRef',v_binding.project_ref,
    'vercelTeamId',v_binding.vercel_team_id,'vercelTeamSlug',v_binding.vercel_team_slug,
    'vercelProjectId',v_binding.vercel_project_id,'vercelProjectName',v_binding.deployment_key,
    'applicationOrigin',v_binding.application_origin,'environment',v_binding.environment,
    'applicationId',v_binding.application_id,'apiVersion',v_binding.api_version,
    'operatorId',v_binding.operator_id,'operatorRole',v_operator_role,
    'workspaceId',v_binding.workspace_id,'businessEntityId',v_binding.business_entity_id,
    'brokerLogin',v_binding.broker_login,'enrollerLogin',v_binding.enroller_login,
    'webhookLogin',v_binding.webhook_login,'runtimeLogin',v_binding.runtime_login,
    'enabled',v_binding.enabled,'providerCallsEnabled',v_binding.provider_calls_enabled,
    'approvalExpiresAt',least(v_binding.approval_expires_at,v_config.approval_expires_at),
    'policyVersion',v_binding.policy_version,'policyFingerprint',v_binding.policy_fingerprint,
    'kmsKeyResource',v_binding.kms_key_resource,
    'appSecretVersionResource',v_binding.app_secret_version_resource,
    'webhookSecretVersionResource',v_binding.webhook_secret_version_resource,
    'credentialServiceAccount',v_binding.credential_service_account,
    'workloadIdentityAudience',v_binding.workload_identity_audience);
end;
$fn$;
revoke all on function public.get_square_remote_sandbox_binding_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_square_remote_sandbox_binding_v1()
  to square_account_broker_authority,square_verified_enrollment_authority,square_ingestion_runtime_authority;

commit;
