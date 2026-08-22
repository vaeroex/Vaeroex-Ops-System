-- External Integrations Phase 5: Credential and Authorization Security
--
-- This migration adds hashed single-use OAuth state and ciphertext-only provider
-- credential authority. It introduces no provider endpoint, provider payload,
-- durable queue, webhook, AI, customer UI, or KPI promotion behavior.

begin;

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_oauth_ingress_authority'
  ) then
    create role integration_oauth_ingress_authority nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_credential_broker_authority'
  ) then
    create role integration_credential_broker_authority nologin noinherit;
  end if;
end;
$roles$;

revoke integration_oauth_ingress_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_credential_broker_authority;
revoke integration_credential_broker_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority;
revoke external_integrations_authority
  from integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke deterministic_calculation_authority
  from integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke integration_control_plane_authority
  from integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on schema private
  from integration_oauth_ingress_authority,
    integration_credential_broker_authority;

create or replace function private.assert_integration_oauth_ingress_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_oauth_ingress_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_oauth_ingress_authority_required';
  end if;
end;
$function$;

create or replace function private.assert_integration_credential_broker_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_credential_broker_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_broker_authority_required';
  end if;
end;
$function$;

create or replace function private.is_integration_audit_metadata_v5(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and (p_value - array[
      'contract_version',
      'immutable_version',
      'source_kind',
      'fact_kind',
      'reconciliation_state',
      'validation_state',
      'row_version',
      'prior_version_id',
      'source_count',
      'domain_key',
      'policy_key',
      'conflict_behavior',
      'family_key',
      'registry_version',
      'contribution_mode',
      'classification',
      'match_tier',
      'case_state',
      'policy_version_id',
      'member_count',
      'reconciliation_case_id',
      'family_version_id',
      'inserted_events',
      'change_set_id',
      'execution_mode',
      'dirty_node_count',
      'completed_node_count',
      'equivalence_status',
      'result_state_fingerprint',
      'connection_generation',
      'connection_status',
      'mapping_status',
      'sync_run_state',
      'freshness_status',
      'blocking_level',
      'policy_state',
      'idempotent',
      'oauth_state_status',
      'credential_status',
      'credential_version',
      'lease_state',
      'revocation_state'
    ]::text[]) = '{}'::jsonb
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v5(metadata));

create or replace function private.phase_5_fingerprint_text_v1(p_value bytea)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(p_value, 'hex');
$function$;

create or replace function private.phase_5_request_fingerprint_v1(
  p_request_id text,
  p_command jsonb
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'integration_credential_request',
      'fingerprintVersion', 'integration_credential_request_fingerprint_v1',
      'payload', pg_catalog.jsonb_build_object(
        'requestId', p_request_id,
        'command', p_command
      )
    )
  );
$function$;

create or replace function private.phase_5_text_array_v1(p_value jsonb)
returns text[]
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_values text[];
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_value) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_scope_set_invalid';
  end if;
  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into v_values
  from pg_catalog.jsonb_array_elements_text(p_value)
    with ordinality as item(value, ordinality);
  return v_values;
end;
$function$;

create or replace function private.is_phase_5_scope_set_v1(p_values text[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.is_bounded_identifier_array_v1(p_values, 64)
    and pg_catalog.cardinality(p_values) between 1 and 64
    and not exists (
      select 1
      from pg_catalog.unnest(p_values) with ordinality as item(value, position)
      join pg_catalog.unnest(p_values) with ordinality as prior(value, position)
        on prior.position = item.position - 1
      where prior.value >= item.value
    );
$function$;

create or replace function private.is_phase_5_return_intent_v1(p_value text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.char_length(p_value) between 1 and 256
    and p_value ~ '^/[A-Za-z0-9/_-]*$'
    and p_value !~ '^//';
$function$;

create or replace function private.is_phase_5_kms_key_resource_v1(p_value text)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.char_length(p_value) between 32 and 512
    and p_value ~ '^projects/[a-z][a-z0-9-]{4,62}/locations/[a-z0-9-]+/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$';
$function$;

create or replace function private.phase_5_credential_aad_digest_v1(
  p_environment text,
  p_workspace_id uuid,
  p_connection_id uuid,
  p_connection_generation bigint,
  p_provider_key text,
  p_credential_id uuid
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'schemaVersion', 'oauth_credential_aad_v1',
      'purpose', 'provider_oauth_credential',
      'environment', p_environment,
      'workspaceId', p_workspace_id::text,
      'connectionId', p_connection_id::text,
      'connectionGeneration', p_connection_generation,
      'providerKey', p_provider_key,
      'credentialId', p_credential_id::text
    )
  );
$function$;

create or replace function private.phase_5_insert_audit_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_outcome text,
  p_target_type text,
  p_target_id text,
  p_request_id text,
  p_reason_code text,
  p_metadata jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    connection_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    request_id,
    reason_code,
    metadata,
    occurred_at,
    retention_class,
    expires_at,
    created_at
  ) values (
    p_workspace_id,
    p_business_entity_id,
    p_connection_id,
    p_actor_type,
    p_actor_id,
    p_action,
    p_outcome,
    p_target_type,
    p_target_id,
    p_request_id,
    p_reason_code,
    p_metadata,
    p_occurred_at,
    'authorization',
    null,
    p_occurred_at
  ) returning id into v_id;
  return v_id;
end;
$function$;

alter table private.integration_connections
  add constraint integration_connections_phase_5_binding_key unique (
    workspace_id,
    business_entity_id,
    id,
    connection_generation,
    provider_key,
    provider_environment
  );

create table private.integration_oauth_states (
  id uuid primary key,
  contract_version text not null
    check (contract_version = 'integration_oauth_state_v1'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  provider_key text not null
    check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null
    check (provider_environment in ('development', 'test', 'preview', 'production')),
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  requested_scopes text[] not null
    check (private.is_phase_5_scope_set_v1(requested_scopes)),
  return_intent text not null
    check (private.is_phase_5_return_intent_v1(return_intent)),
  state_hash bytea not null unique
    check (pg_catalog.octet_length(state_hash) = 32),
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired')),
  creation_request_id text not null
    check (private.is_bounded_identifier_v1(creation_request_id)),
  creation_request_fingerprint bytea not null
    check (pg_catalog.octet_length(creation_request_fingerprint) = 32),
  consume_request_id text
    check (consume_request_id is null or private.is_bounded_identifier_v1(consume_request_id)),
  consume_request_fingerprint bytea
    check (
      consume_request_fingerprint is null
      or pg_catalog.octet_length(consume_request_fingerprint) = 32
    ),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  constraint integration_oauth_states_connection_fkey foreign key (
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment
  ) references private.integration_connections(
    workspace_id,
    business_entity_id,
    id,
    connection_generation,
    provider_key,
    provider_environment
  ) on delete restrict,
  constraint integration_oauth_states_creation_request_key unique (
    creation_request_id
  ),
  constraint integration_oauth_states_consume_pair_check check (
    (consume_request_id is null) = (consume_request_fingerprint is null)
  ),
  constraint integration_oauth_states_lifecycle_check check (
    (status = 'pending' and consumed_at is null and consume_request_id is null)
    or (status = 'expired' and consumed_at is null)
    or (status = 'consumed' and consumed_at is not null and consume_request_id is not null)
  ),
  constraint integration_oauth_states_time_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
    and (consumed_at is null or consumed_at >= created_at)
  )
);

create index integration_oauth_states_connection_status_idx
  on private.integration_oauth_states(
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    status
  );
create index integration_oauth_states_expiry_idx
  on private.integration_oauth_states(expires_at)
  where status = 'pending';
create index integration_oauth_states_initiated_by_idx
  on private.integration_oauth_states(initiated_by, created_at desc);

create table private.integration_credentials (
  id uuid primary key,
  contract_version text not null
    check (contract_version = 'integration_credential_authority_v1'),
  oauth_state_id uuid not null unique
    references private.integration_oauth_states(id) on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  provider_key text not null
    check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null
    check (provider_environment in ('development', 'test', 'preview', 'production')),
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  credential_version bigint not null default 1 check (credential_version > 0),
  envelope_schema_version text not null
    check (envelope_schema_version = 'oauth_credential_envelope_v1'),
  aad_schema_version text not null
    check (aad_schema_version = 'oauth_credential_aad_v1'),
  aad_digest bytea not null check (pg_catalog.octet_length(aad_digest) = 32),
  kms_key_resource text not null
    check (private.is_phase_5_kms_key_resource_v1(kms_key_resource)),
  credential_ciphertext bytea,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  granted_scopes text[] not null
    check (private.is_phase_5_scope_set_v1(granted_scopes)),
  external_entity_reference_fingerprint bytea check (
    external_entity_reference_fingerprint is null
    or pg_catalog.octet_length(external_entity_reference_fingerprint) = 32
  ),
  status text not null default 'active'
    check (status in ('active', 'reauthorization_required', 'revoked', 'destroyed')),
  refresh_lease_id uuid,
  refresh_lease_owner_fingerprint bytea check (
    refresh_lease_owner_fingerprint is null
    or pg_catalog.octet_length(refresh_lease_owner_fingerprint) = 32
  ),
  refresh_lease_acquired_at timestamptz,
  refresh_lease_expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason_code text check (
    revocation_reason_code is null
    or revocation_reason_code in (
      'provider_revoked', 'customer_disconnect', 'authorization_failure'
    )
  ),
  provider_revocation_status text check (
    provider_revocation_status is null
    or provider_revocation_status in ('pending', 'succeeded', 'failed', 'deferred')
  ),
  provider_revocation_completed_at timestamptz,
  destroyed_at timestamptz,
  last_request_id text
    check (last_request_id is null or private.is_bounded_identifier_v1(last_request_id)),
  last_request_fingerprint bytea check (
    last_request_fingerprint is null
    or pg_catalog.octet_length(last_request_fingerprint) = 32
  ),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_credentials_connection_generation_key unique (
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation
  ),
  constraint integration_credentials_connection_fkey foreign key (
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment
  ) references private.integration_connections(
    workspace_id,
    business_entity_id,
    id,
    connection_generation,
    provider_key,
    provider_environment
  ) on delete restrict,
  constraint integration_credentials_ciphertext_check check (
    credential_ciphertext is null
    or pg_catalog.octet_length(credential_ciphertext) between 16 and 98304
  ),
  constraint integration_credentials_aad_check check (
    aad_digest = private.phase_5_credential_aad_digest_v1(
      provider_environment,
      workspace_id,
      connection_id,
      connection_generation,
      provider_key,
      id
    )
  ),
  constraint integration_credentials_lease_check check (
    (refresh_lease_id is null
      and refresh_lease_owner_fingerprint is null
      and refresh_lease_acquired_at is null
      and refresh_lease_expires_at is null)
    or (refresh_lease_id is not null
      and refresh_lease_owner_fingerprint is not null
      and refresh_lease_acquired_at is not null
      and refresh_lease_expires_at > refresh_lease_acquired_at
      and refresh_lease_expires_at <= refresh_lease_acquired_at + interval '2 minutes')
  ),
  constraint integration_credentials_lifecycle_check check (
    (status = 'active' and credential_ciphertext is not null
      and revoked_at is null and destroyed_at is null)
    or (status = 'reauthorization_required' and credential_ciphertext is not null
      and revoked_at is null and destroyed_at is null)
    or (status = 'revoked' and credential_ciphertext is not null
      and revoked_at is not null and destroyed_at is null)
    or (status = 'destroyed' and credential_ciphertext is null
      and revoked_at is not null and destroyed_at is not null)
  ),
  constraint integration_credentials_revocation_check check (
    (revoked_at is null
      and revocation_reason_code is null
      and provider_revocation_status is null
      and provider_revocation_completed_at is null)
    or (revoked_at is not null
      and revocation_reason_code is not null
      and provider_revocation_status is not null
      and (
        (provider_revocation_status = 'pending'
          and provider_revocation_completed_at is null)
        or (provider_revocation_status <> 'pending'
          and provider_revocation_completed_at is not null)
      ))
  ),
  constraint integration_credentials_request_pair_check check (
    (last_request_id is null) = (last_request_fingerprint is null)
  ),
  constraint integration_credentials_time_check check (
    access_expires_at > created_at
    and (refresh_expires_at is null or refresh_expires_at > created_at)
    and updated_at >= created_at
    and (revoked_at is null or revoked_at >= created_at)
    and (destroyed_at is null or destroyed_at >= revoked_at)
  )
);

create index integration_credentials_connection_status_idx
  on private.integration_credentials(
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    status
  );
create index integration_credentials_refresh_due_idx
  on private.integration_credentials(access_expires_at)
  where status = 'active';
create index integration_credentials_refresh_lease_idx
  on private.integration_credentials(refresh_lease_expires_at)
  where refresh_lease_id is not null;

alter table private.integration_oauth_states enable row level security;
alter table private.integration_oauth_states force row level security;
alter table private.integration_credentials enable row level security;
alter table private.integration_credentials force row level security;

revoke all on table private.integration_oauth_states
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on table private.integration_credentials
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;

create or replace function private.validate_integration_oauth_state_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status <> 'pending'
    or new.status not in ('consumed', 'expired')
    or new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_id <> old.connection_id
    or new.connection_generation <> old.connection_generation
    or new.provider_key <> old.provider_key
    or new.provider_environment <> old.provider_environment
    or new.initiated_by <> old.initiated_by
    or new.requested_scopes <> old.requested_scopes
    or new.return_intent <> old.return_intent
    or new.state_hash <> old.state_hash
    or new.creation_request_id <> old.creation_request_id
    or new.creation_request_fingerprint <> old.creation_request_fingerprint
    or new.created_at <> old.created_at
    or new.expires_at <> old.expires_at
    or new.row_version <> old.row_version + 1 then
    raise exception using
      errcode = '55000',
      message = 'integration_oauth_state_immutable';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_oauth_state_mutation_v1
before update on private.integration_oauth_states
for each row execute function private.validate_integration_oauth_state_mutation_v1();

create trigger reject_integration_oauth_state_delete_v1
before delete on private.integration_oauth_states
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_integration_credential_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'destroyed'
    or new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.oauth_state_id <> old.oauth_state_id
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_id <> old.connection_id
    or new.connection_generation <> old.connection_generation
    or new.provider_key <> old.provider_key
    or new.provider_environment <> old.provider_environment
    or new.initiated_by <> old.initiated_by
    or new.envelope_schema_version <> old.envelope_schema_version
    or new.aad_schema_version <> old.aad_schema_version
    or new.aad_digest <> old.aad_digest
    or new.kms_key_resource <> old.kms_key_resource
    or new.created_at <> old.created_at
    or new.updated_at < old.updated_at
    or new.row_version <> old.row_version + 1
    or new.credential_version < old.credential_version
    or new.credential_version > old.credential_version + 1 then
    raise exception using
      errcode = '55000',
      message = 'integration_credential_immutable';
  end if;
  if new.credential_version = old.credential_version + 1
    and (
      new.credential_ciphertext is not distinct from old.credential_ciphertext
      or new.status <> 'active'
    ) then
    raise exception using
      errcode = '55000',
      message = 'integration_credential_rotation_invalid';
  end if;
  if old.status <> new.status
    and not (
      (old.status = 'active' and new.status in ('reauthorization_required', 'revoked'))
      or (old.status = 'reauthorization_required' and new.status = 'revoked')
      or (old.status = 'revoked' and new.status = 'destroyed')
    ) then
    raise exception using
      errcode = '55000',
      message = 'integration_credential_transition_invalid';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_credential_mutation_v1
before update on private.integration_credentials
for each row execute function private.validate_integration_credential_mutation_v1();

create trigger reject_integration_credential_delete_v1
before delete on private.integration_credentials
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function public.create_integration_oauth_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_connection private.integration_connections;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_created_at timestamptz;
  v_expires_at timestamptz;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();

  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'returnIntent',
        'stateHash',
        'createdAt',
        'expiresAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_oauth_state_v1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'providerKey') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or p_command ->> 'providerEnvironment' not in (
      'development', 'test', 'preview', 'production'
    )
    or not private.is_phase_5_return_intent_v1(p_command ->> 'returnIntent') then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(p_command ->> 'stateHash');
  v_created_at := (p_command ->> 'createdAt')::timestamptz;
  v_expires_at := (p_command ->> 'expiresAt')::timestamptz;
  if v_expires_at <= v_created_at
    or v_expires_at > v_created_at + interval '10 minutes' then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_expiry_invalid';
  end if;
  v_expires_at := pg_catalog.transaction_timestamp() + (v_expires_at - v_created_at);
  v_created_at := pg_catalog.transaction_timestamp();

  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select * into v_state
  from private.integration_oauth_states
  where creation_request_id = p_request_id;
  if found then
    if v_state.creation_request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'integration_oauth_state_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stateId', v_state.id,
      'idempotent', true
    );
  end if;

  select * into v_connection
  from private.integration_connections
  where workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and provider_key = p_command ->> 'providerKey'
    and provider_environment = p_command ->> 'providerEnvironment'
  for share;
  if not found or v_connection.status <> 'pending_authorization' then
    raise exception using
      errcode = '42501',
      message = 'integration_oauth_state_connection_denied';
  end if;
  if v_connection.requested_scopes <> v_scopes
    or not exists (
      select 1
      from public.workspace_members as member
      where member.workspace_id = v_connection.workspace_id
        and member.user_id = (p_command ->> 'initiatedBy')::uuid
        and member.status = 'active'
        and member.role in ('owner', 'admin', 'manager')
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_oauth_state_initiator_denied';
  end if;

  insert into private.integration_oauth_states (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment,
    initiated_by,
    requested_scopes,
    return_intent,
    state_hash,
    status,
    creation_request_id,
    creation_request_fingerprint,
    created_at,
    expires_at,
    row_version
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_oauth_state_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_connection.connection_generation,
    v_connection.provider_key,
    v_connection.provider_environment,
    (p_command ->> 'initiatedBy')::uuid,
    v_scopes,
    p_command ->> 'returnIntent',
    v_state_hash,
    'pending',
    p_request_id,
    v_request_fingerprint,
    v_created_at,
    v_expires_at,
    1
  ) returning * into v_state;

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    'user',
    v_state.initiated_by::text,
    'oauth_state_created',
    'succeeded',
    'oauth_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status,
      'idempotent', false
    ),
    v_state.created_at
  );

  return pg_catalog.jsonb_build_object(
    'stateId', v_state.id,
    'idempotent', false
  );
end;
$function$;

create or replace function public.consume_integration_oauth_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_consumed_at timestamptz;
  v_reason text;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'returnIntent',
        'stateHash',
        'consumedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'providerKey') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or p_command ->> 'providerEnvironment' not in (
      'development', 'test', 'preview', 'production'
    )
    or not private.is_phase_5_return_intent_v1(p_command ->> 'returnIntent') then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_consume_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(p_command ->> 'stateHash');
  v_consumed_at := (p_command ->> 'consumedAt')::timestamptz;
  v_consumed_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_state
  from private.integration_oauth_states
  where state_hash = v_state_hash
  for update;
  if not found then
    perform private.phase_5_insert_audit_v1(
      null,
      null,
      null,
      'user',
      p_command ->> 'initiatedBy',
      'oauth_state_rejected',
      'denied',
      'oauth_state',
      null,
      p_request_id,
      'state_missing',
      pg_catalog.jsonb_build_object('oauth_state_status', 'missing'),
      v_consumed_at
    );
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', 'state_missing'
    );
  end if;

  if v_state.status = 'consumed' then
    v_reason := 'state_replayed';
  elsif v_state.status = 'expired' or v_consumed_at >= v_state.expires_at then
    v_reason := 'state_expired';
  elsif v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <> (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <> (p_command ->> 'connectionGeneration')::bigint
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes
    or v_state.return_intent <> p_command ->> 'returnIntent'
    or not exists (
      select 1
      from private.integration_connections as connection
      where connection.workspace_id = v_state.workspace_id
        and connection.business_entity_id = v_state.business_entity_id
        and connection.id = v_state.connection_id
        and connection.connection_generation = v_state.connection_generation
        and connection.provider_key = v_state.provider_key
        and connection.provider_environment = v_state.provider_environment
        and connection.status = 'pending_authorization'
    ) then
    v_reason := 'state_invalid';
  end if;

  if v_reason is not null then
    if v_reason = 'state_expired' and v_state.status = 'pending' then
      update private.integration_oauth_states
      set status = 'expired',
          row_version = row_version + 1
      where id = v_state.id
      returning * into v_state;
    end if;
    perform private.phase_5_insert_audit_v1(
      v_state.workspace_id,
      v_state.business_entity_id,
      v_state.connection_id,
      'user',
      v_state.initiated_by::text,
      'oauth_state_rejected',
      'denied',
      'oauth_state',
      v_state.id::text,
      p_request_id,
      v_reason,
      pg_catalog.jsonb_build_object(
        'connection_generation', v_state.connection_generation,
        'oauth_state_status', v_state.status
      ),
      v_consumed_at
    );
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', v_reason
    );
  end if;

  update private.integration_oauth_states
  set status = 'consumed',
      consume_request_id = p_request_id,
      consume_request_fingerprint = v_request_fingerprint,
      consumed_at = v_consumed_at,
      row_version = row_version + 1
  where id = v_state.id
  returning * into v_state;

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    'user',
    v_state.initiated_by::text,
    'oauth_state_consumed',
    'succeeded',
    'oauth_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status
    ),
    v_consumed_at
  );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'stateId', v_state.id,
    'workspaceId', v_state.workspace_id,
    'businessEntityId', v_state.business_entity_id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'providerKey', v_state.provider_key,
    'providerEnvironment', v_state.provider_environment,
    'requestedScopes', pg_catalog.to_jsonb(v_state.requested_scopes),
    'returnIntent', v_state.return_intent
  );
end;
$function$;

create or replace function public.store_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_connection private.integration_connections;
  v_credential private.integration_credentials;
  v_scopes text[];
  v_ciphertext bytea;
  v_aad_digest bytea;
  v_external_fingerprint bytea;
  v_request_fingerprint bytea;
  v_authorized_at timestamptz;
  v_access_expires_at timestamptz;
  v_refresh_expires_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'oauthStateId',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'expectedConnectionRowVersion',
        'credentialVersion',
        'envelopeSchemaVersion',
        'aadSchemaVersion',
        'aadDigest',
        'kmsKeyResource',
        'ciphertextBase64',
        'accessExpiresAt',
        'refreshExpiresAt',
        'grantedScopes',
        'externalEntityReferenceFingerprint',
        'authorizedAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_credential_authority_v1'
    or p_command ->> 'envelopeSchemaVersion' <> 'oauth_credential_envelope_v1'
    or p_command ->> 'aadSchemaVersion' <> 'oauth_credential_aad_v1'
    or p_command ->> 'credentialVersion' <> '1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedConnectionRowVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'providerEnvironment' not in (
      'development', 'test', 'preview', 'production'
    )
    or not private.is_phase_5_kms_key_resource_v1(
      p_command ->> 'kmsKeyResource'
    )
    or (p_command ->> 'ciphertextBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.char_length(p_command ->> 'ciphertextBase64') > 131072 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'grantedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_scope_invalid';
  end if;
  begin
    v_ciphertext := pg_catalog.decode(p_command ->> 'ciphertextBase64', 'base64');
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end;
  if pg_catalog.octet_length(v_ciphertext) not between 16 and 98304 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end if;
  v_aad_digest := private.sha256_fingerprint_bytes_v1(p_command ->> 'aadDigest');
  v_external_fingerprint := case
    when p_command -> 'externalEntityReferenceFingerprint' = 'null'::jsonb then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'externalEntityReferenceFingerprint'
    )
  end;
  v_authorized_at := (p_command ->> 'authorizedAt')::timestamptz;
  v_access_expires_at := (p_command ->> 'accessExpiresAt')::timestamptz;
  v_refresh_expires_at := case
    when p_command -> 'refreshExpiresAt' = 'null'::jsonb then null
    else (p_command ->> 'refreshExpiresAt')::timestamptz
  end;
  if v_access_expires_at <= v_authorized_at
    or (v_refresh_expires_at is not null and v_refresh_expires_at <= v_authorized_at) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_expiry_invalid';
  end if;
  v_access_expires_at := pg_catalog.transaction_timestamp()
    + (v_access_expires_at - v_authorized_at);
  v_refresh_expires_at := case
    when v_refresh_expires_at is null then null
    else pg_catalog.transaction_timestamp() + (v_refresh_expires_at - v_authorized_at)
  end;
  v_authorized_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'id')::uuid
     or oauth_state_id = (p_command ->> 'oauthStateId')::uuid
  for update;
  if found then
    if v_credential.last_request_id = p_request_id
      and v_credential.last_request_fingerprint = v_request_fingerprint then
      select * into v_connection
      from private.integration_connections
      where id = v_credential.connection_id;
      return pg_catalog.jsonb_build_object(
        'credentialId', v_credential.id,
        'credentialVersion', v_credential.credential_version,
        'credentialStatus', v_credential.status,
        'connectionStatus', v_connection.status,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_credential_request_conflict';
  end if;

  select * into v_state
  from private.integration_oauth_states
  where id = (p_command ->> 'oauthStateId')::uuid
  for update;
  if not found
    or v_state.status <> 'consumed'
    or v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <> (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <> (p_command ->> 'connectionGeneration')::bigint
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_oauth_state_denied';
  end if;

  select * into v_connection
  from private.integration_connections
  where workspace_id = v_state.workspace_id
    and business_entity_id = v_state.business_entity_id
    and id = v_state.connection_id
    and connection_generation = v_state.connection_generation
    and provider_key = v_state.provider_key
    and provider_environment = v_state.provider_environment
  for update;
  if not found
    or v_connection.status <> 'pending_authorization'
    or v_connection.row_version <>
      (p_command ->> 'expectedConnectionRowVersion')::bigint
    or v_connection.requested_scopes <> v_scopes
    or v_authorized_at < v_state.consumed_at then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_connection_stale';
  end if;
  if v_aad_digest <> private.phase_5_credential_aad_digest_v1(
    v_state.provider_environment,
    v_state.workspace_id,
    v_state.connection_id,
    v_state.connection_generation,
    v_state.provider_key,
    (p_command ->> 'id')::uuid
  ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_aad_invalid';
  end if;

  insert into private.integration_credentials (
    id,
    contract_version,
    oauth_state_id,
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment,
    initiated_by,
    credential_version,
    envelope_schema_version,
    aad_schema_version,
    aad_digest,
    kms_key_resource,
    credential_ciphertext,
    access_expires_at,
    refresh_expires_at,
    granted_scopes,
    external_entity_reference_fingerprint,
    status,
    last_request_id,
    last_request_fingerprint,
    row_version,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_credential_authority_v1',
    v_state.id,
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    v_state.connection_generation,
    v_state.provider_key,
    v_state.provider_environment,
    v_state.initiated_by,
    1,
    'oauth_credential_envelope_v1',
    'oauth_credential_aad_v1',
    v_aad_digest,
    p_command ->> 'kmsKeyResource',
    v_ciphertext,
    v_access_expires_at,
    v_refresh_expires_at,
    v_scopes,
    v_external_fingerprint,
    'active',
    p_request_id,
    v_request_fingerprint,
    1,
    v_authorized_at,
    v_authorized_at
  ) returning * into v_credential;

  update private.integration_connections
  set provider_tenant_reference_fingerprint = v_external_fingerprint,
      status = 'authorized_unmapped',
      state_reason_code = 'mapping_required',
      granted_scopes = v_scopes,
      authorized_at = v_authorized_at,
      status_changed_at = v_authorized_at,
      last_transition_request_id = p_request_id,
      last_transition_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_authorized_at
  where id = v_connection.id
  returning * into v_connection;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_encrypted',
    'succeeded',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'idempotent', false
    ),
    v_authorized_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.acquire_integration_credential_refresh_lease_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_acquired_at timestamptz;
  v_lease_expires_at timestamptz;
  v_owner_fingerprint bytea;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'leaseId',
        'leaseOwnerFingerprint',
        'acquiredAt',
        'leaseExpiresAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'integration_refresh_lease_payload_invalid';
  end if;
  v_acquired_at := (p_command ->> 'acquiredAt')::timestamptz;
  v_lease_expires_at := (p_command ->> 'leaseExpiresAt')::timestamptz;
  if v_lease_expires_at <= v_acquired_at
    or v_lease_expires_at > v_acquired_at + interval '2 minutes' then
    raise exception using
      errcode = '22023',
      message = 'integration_refresh_lease_expiry_invalid';
  end if;
  v_lease_expires_at := pg_catalog.transaction_timestamp()
    + (v_lease_expires_at - v_acquired_at);
  v_acquired_at := pg_catalog.transaction_timestamp();
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'reasonCode', 'credential_missing'
    );
  end if;
  if v_credential.last_request_id = p_request_id
    and v_credential.last_request_fingerprint = v_request_fingerprint
    and v_credential.refresh_lease_id = (p_command ->> 'leaseId')::uuid
    and v_credential.refresh_lease_owner_fingerprint = v_owner_fingerprint
    and v_credential.refresh_lease_expires_at > v_acquired_at then
    return pg_catalog.jsonb_build_object(
      'acquired', true,
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'ciphertextBase64', pg_catalog.encode(v_credential.credential_ciphertext, 'base64'),
      'aadDigest', private.phase_5_fingerprint_text_v1(v_credential.aad_digest),
      'kmsKeyResource', v_credential.kms_key_resource,
      'aadContext', pg_catalog.jsonb_build_object(
        'schemaVersion', 'oauth_credential_aad_v1',
        'purpose', 'provider_oauth_credential',
        'environment', v_credential.provider_environment,
        'workspaceId', v_credential.workspace_id,
        'connectionId', v_credential.connection_id,
        'connectionGeneration', v_credential.connection_generation,
        'providerKey', v_credential.provider_key,
        'credentialId', v_credential.id
      ),
      'providerEnvironment', v_credential.provider_environment,
      'grantedScopes', pg_catalog.to_jsonb(v_credential.granted_scopes),
      'leaseId', v_credential.refresh_lease_id,
      'leaseOwnerFingerprint', private.phase_5_fingerprint_text_v1(
        v_credential.refresh_lease_owner_fingerprint
      ),
      'leaseExpiresAt', v_credential.refresh_lease_expires_at
    );
  end if;
  if v_credential.status <> 'active' then
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'reasonCode', 'credential_inactive'
    );
  end if;
  if v_credential.credential_version <>
    (p_command ->> 'expectedCredentialVersion')::bigint then
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'reasonCode', 'credential_version_stale'
    );
  end if;
  if v_credential.refresh_expires_at is not null
    and v_credential.refresh_expires_at <= v_acquired_at then
    update private.integration_credentials
    set status = 'reauthorization_required',
        last_request_id = p_request_id,
        last_request_fingerprint = v_request_fingerprint,
        row_version = row_version + 1,
        updated_at = v_acquired_at
    where id = v_credential.id
    returning * into v_credential;
    select * into v_connection
    from private.integration_connections
    where id = v_credential.connection_id
    for update;
    if v_connection.status in (
      'authorized_unmapped', 'initializing', 'active', 'degraded'
    ) then
      update private.integration_connections
      set status = 'reauthorization_required',
          state_reason_code = 'authorization_required',
          status_changed_at = v_acquired_at,
          last_transition_request_id = p_request_id,
          last_transition_request_fingerprint = v_request_fingerprint,
          row_version = row_version + 1,
          updated_at = v_acquired_at
      where id = v_connection.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'reasonCode', 'credential_inactive'
    );
  end if;
  if v_credential.refresh_lease_id is not null
    and v_credential.refresh_lease_expires_at > v_acquired_at then
    return pg_catalog.jsonb_build_object(
      'acquired', false,
      'reasonCode', 'refresh_lease_held'
    );
  end if;

  update private.integration_credentials
  set refresh_lease_id = (p_command ->> 'leaseId')::uuid,
      refresh_lease_owner_fingerprint = v_owner_fingerprint,
      refresh_lease_acquired_at = v_acquired_at,
      refresh_lease_expires_at = v_lease_expires_at,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_acquired_at
  where id = v_credential.id
  returning * into v_credential;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_refresh',
    'allowed',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'lease_state', 'acquired'
    ),
    v_acquired_at
  );

  return pg_catalog.jsonb_build_object(
    'acquired', true,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'ciphertextBase64', pg_catalog.encode(v_credential.credential_ciphertext, 'base64'),
    'aadDigest', private.phase_5_fingerprint_text_v1(v_credential.aad_digest),
    'kmsKeyResource', v_credential.kms_key_resource,
    'aadContext', pg_catalog.jsonb_build_object(
      'schemaVersion', 'oauth_credential_aad_v1',
      'purpose', 'provider_oauth_credential',
      'environment', v_credential.provider_environment,
      'workspaceId', v_credential.workspace_id,
      'connectionId', v_credential.connection_id,
      'connectionGeneration', v_credential.connection_generation,
      'providerKey', v_credential.provider_key,
      'credentialId', v_credential.id
    ),
    'providerEnvironment', v_credential.provider_environment,
    'grantedScopes', pg_catalog.to_jsonb(v_credential.granted_scopes),
    'leaseId', v_credential.refresh_lease_id,
    'leaseOwnerFingerprint', private.phase_5_fingerprint_text_v1(
      v_credential.refresh_lease_owner_fingerprint
    ),
    'leaseExpiresAt', v_credential.refresh_lease_expires_at
  );
end;
$function$;

create or replace function public.rotate_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_owner_fingerprint bytea;
  v_aad_digest bytea;
  v_ciphertext bytea;
  v_scopes text[];
  v_external_fingerprint bytea;
  v_rotated_at timestamptz;
  v_access_expires_at timestamptz;
  v_refresh_expires_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'leaseId',
        'leaseOwnerFingerprint',
        'aadDigest',
        'kmsKeyResource',
        'ciphertextBase64',
        'accessExpiresAt',
        'refreshExpiresAt',
        'grantedScopes',
        'externalEntityReferenceFingerprint',
        'rotatedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or not private.is_phase_5_kms_key_resource_v1(
      p_command ->> 'kmsKeyResource'
    )
    or (p_command ->> 'ciphertextBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.char_length(p_command ->> 'ciphertextBase64') > 131072 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_rotation_payload_invalid';
  end if;
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_aad_digest := private.sha256_fingerprint_bytes_v1(p_command ->> 'aadDigest');
  v_scopes := private.phase_5_text_array_v1(p_command -> 'grantedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_scope_invalid';
  end if;
  begin
    v_ciphertext := pg_catalog.decode(p_command ->> 'ciphertextBase64', 'base64');
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end;
  if pg_catalog.octet_length(v_ciphertext) not between 16 and 98304 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end if;
  v_external_fingerprint := case
    when p_command -> 'externalEntityReferenceFingerprint' = 'null'::jsonb then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'externalEntityReferenceFingerprint'
    )
  end;
  v_rotated_at := (p_command ->> 'rotatedAt')::timestamptz;
  v_access_expires_at := (p_command ->> 'accessExpiresAt')::timestamptz;
  v_refresh_expires_at := case
    when p_command -> 'refreshExpiresAt' = 'null'::jsonb then null
    else (p_command ->> 'refreshExpiresAt')::timestamptz
  end;
  if v_access_expires_at <= v_rotated_at
    or (v_refresh_expires_at is not null and v_refresh_expires_at <= v_rotated_at) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_expiry_invalid';
  end if;
  v_access_expires_at := pg_catalog.transaction_timestamp()
    + (v_access_expires_at - v_rotated_at);
  v_refresh_expires_at := case
    when v_refresh_expires_at is null then null
    else pg_catalog.transaction_timestamp() + (v_refresh_expires_at - v_rotated_at)
  end;
  v_rotated_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_rotation_denied';
  end if;
  select * into v_connection
  from private.integration_connections
  where id = v_credential.connection_id
  for share;

  if v_credential.last_request_id = p_request_id
    and v_credential.last_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.status <> 'active'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.refresh_lease_id <> (p_command ->> 'leaseId')::uuid
    or v_credential.refresh_lease_owner_fingerprint <> v_owner_fingerprint
    or v_credential.refresh_lease_expires_at <= v_rotated_at
    or v_credential.kms_key_resource <> p_command ->> 'kmsKeyResource'
    or v_credential.aad_digest <> v_aad_digest
    or v_aad_digest <> private.phase_5_credential_aad_digest_v1(
      v_credential.provider_environment,
      v_credential.workspace_id,
      v_credential.connection_id,
      v_credential.connection_generation,
      v_credential.provider_key,
      v_credential.id
    )
    or v_scopes <> v_credential.granted_scopes then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_rotation_stale';
  end if;

  update private.integration_credentials
  set credential_version = credential_version + 1,
      credential_ciphertext = v_ciphertext,
      access_expires_at = v_access_expires_at,
      refresh_expires_at = v_refresh_expires_at,
      granted_scopes = v_scopes,
      external_entity_reference_fingerprint = coalesce(
        v_external_fingerprint,
        external_entity_reference_fingerprint
      ),
      refresh_lease_id = null,
      refresh_lease_owner_fingerprint = null,
      refresh_lease_acquired_at = null,
      refresh_lease_expires_at = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_rotated_at
  where id = v_credential.id
  returning * into v_credential;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_rotated',
    'succeeded',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'refresh_succeeded',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'lease_state', 'released',
      'idempotent', false
    ),
    v_rotated_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.complete_integration_credential_refresh_failure_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_owner_fingerprint bytea;
  v_failed_at timestamptz;
  v_terminal boolean;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'leaseId',
        'leaseOwnerFingerprint',
        'reasonCode',
        'failedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'reasonCode' not in (
      'invalid_grant',
      'provider_revoked',
      'scope_loss',
      'provider_transient',
      'credential_expired',
      'kms_failure',
      'integrity_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_refresh_failure_payload_invalid';
  end if;
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_failed_at := (p_command ->> 'failedAt')::timestamptz;
  v_failed_at := pg_catalog.transaction_timestamp();
  v_terminal := p_command ->> 'reasonCode' <> 'provider_transient';
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_refresh_failure_denied';
  end if;
  select * into v_connection
  from private.integration_connections
  where id = v_credential.connection_id
  for update;
  if v_credential.last_request_id = p_request_id
    and v_credential.last_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.status <> 'active'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.refresh_lease_id <> (p_command ->> 'leaseId')::uuid
    or v_credential.refresh_lease_owner_fingerprint <> v_owner_fingerprint
    or v_credential.refresh_lease_expires_at <= v_failed_at then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_refresh_failure_stale';
  end if;

  update private.integration_credentials
  set status = case
        when v_terminal then 'reauthorization_required'
        else status
      end,
      refresh_lease_id = null,
      refresh_lease_owner_fingerprint = null,
      refresh_lease_acquired_at = null,
      refresh_lease_expires_at = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_failed_at
  where id = v_credential.id
  returning * into v_credential;

  if v_terminal and v_connection.status in (
    'authorized_unmapped', 'initializing', 'active', 'degraded'
  ) then
    update private.integration_connections
    set status = 'reauthorization_required',
        state_reason_code = 'authorization_required',
        status_changed_at = v_failed_at,
        last_transition_request_id = p_request_id,
        last_transition_request_fingerprint = v_request_fingerprint,
        row_version = row_version + 1,
        updated_at = v_failed_at
    where id = v_connection.id
    returning * into v_connection;
  end if;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    case when v_terminal then 'reauthorization_required' else 'authorization_failure' end,
    'failed',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    p_command ->> 'reasonCode',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'lease_state', 'released'
    ),
    v_failed_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.revoke_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_revoked_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'reasonCode',
        'revokedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'reasonCode' not in (
      'provider_revoked', 'customer_disconnect', 'authorization_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_revocation_payload_invalid';
  end if;
  v_revoked_at := (p_command ->> 'revokedAt')::timestamptz;
  v_revoked_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_revocation_denied';
  end if;
  select * into v_connection
  from private.integration_connections
  where id = v_credential.connection_id
  for update;

  if v_credential.status = 'destroyed' then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.last_request_id = p_request_id
    and v_credential.last_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.status not in ('active', 'reauthorization_required')
    or (
      p_command ->> 'reasonCode' = 'customer_disconnect'
      and v_connection.status <> 'disconnecting'
    ) then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_revocation_stale';
  end if;

  update private.integration_credentials
  set status = 'revoked',
      refresh_lease_id = null,
      refresh_lease_owner_fingerprint = null,
      refresh_lease_acquired_at = null,
      refresh_lease_expires_at = null,
      revoked_at = v_revoked_at,
      revocation_reason_code = p_command ->> 'reasonCode',
      provider_revocation_status = 'pending',
      provider_revocation_completed_at = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_revoked_at
  where id = v_credential.id
  returning * into v_credential;

  if p_command ->> 'reasonCode' <> 'customer_disconnect'
    and v_connection.status in (
      'authorized_unmapped', 'initializing', 'active', 'degraded'
    ) then
    update private.integration_connections
    set status = 'reauthorization_required',
        state_reason_code = 'authorization_required',
        status_changed_at = v_revoked_at,
        last_transition_request_id = p_request_id,
        last_transition_request_fingerprint = v_request_fingerprint,
        row_version = row_version + 1,
        updated_at = v_revoked_at
    where id = v_connection.id
    returning * into v_connection;
  end if;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_revocation',
    'allowed',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    p_command ->> 'reasonCode',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'revocation_state', v_credential.provider_revocation_status
    ),
    v_revoked_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.complete_integration_credential_revocation_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_completed_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'outcome',
        'completedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'outcome' not in ('succeeded', 'failed', 'deferred') then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_revocation_result_payload_invalid';
  end if;
  v_completed_at := (p_command ->> 'completedAt')::timestamptz;
  v_completed_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_revocation_result_denied';
  end if;
  select * into v_connection
  from private.integration_connections
  where id = v_credential.connection_id;
  if v_credential.last_request_id = p_request_id
    and v_credential.last_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.status <> 'revoked'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.provider_revocation_status <> 'pending'
    or v_completed_at < v_credential.revoked_at then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_revocation_result_stale';
  end if;

  update private.integration_credentials
  set provider_revocation_status = p_command ->> 'outcome',
      provider_revocation_completed_at = v_completed_at,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_completed_at
  where id = v_credential.id
  returning * into v_credential;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_revocation',
    case
      when v_credential.provider_revocation_status = 'succeeded' then 'succeeded'
      else 'failed'
    end,
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    case
      when v_credential.provider_revocation_status = 'succeeded' then 'provider_revoked'
      else 'provider_transient'
    end,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'revocation_state', v_credential.provider_revocation_status
    ),
    v_completed_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.destroy_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_destroyed_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'reasonCode',
        'destroyedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'reasonCode' <> 'local_destruction' then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_destruction_payload_invalid';
  end if;
  v_destroyed_at := (p_command ->> 'destroyedAt')::timestamptz;
  v_destroyed_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select * into v_credential
  from private.integration_credentials
  where id = (p_command ->> 'credentialId')::uuid
    and workspace_id = (p_command ->> 'workspaceId')::uuid
    and business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection_id = (p_command ->> 'connectionId')::uuid
    and connection_generation = (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_destruction_denied';
  end if;
  select * into v_connection
  from private.integration_connections
  where id = v_credential.connection_id
  for update;
  if v_credential.status = 'destroyed' then
    return pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'credentialStatus', v_credential.status,
      'connectionStatus', v_connection.status,
      'idempotent', true
    );
  end if;
  if v_credential.status <> 'revoked'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_destroyed_at < v_credential.revoked_at then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_destruction_stale';
  end if;

  update private.integration_credentials
  set status = 'destroyed',
      credential_ciphertext = null,
      refresh_lease_id = null,
      refresh_lease_owner_fingerprint = null,
      refresh_lease_acquired_at = null,
      refresh_lease_expires_at = null,
      provider_revocation_status = case
        when provider_revocation_status = 'pending' then 'deferred'
        else provider_revocation_status
      end,
      provider_revocation_completed_at = case
        when provider_revocation_status = 'pending' then v_destroyed_at
        else provider_revocation_completed_at
      end,
      destroyed_at = v_destroyed_at,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_destroyed_at
  where id = v_credential.id
  returning * into v_credential;

  if v_connection.status = 'disconnecting' then
    update private.integration_connections
    set status = 'disconnected',
        state_reason_code = 'disconnected',
        status_changed_at = v_destroyed_at,
        disconnected_at = v_destroyed_at,
        last_transition_request_id = p_request_id,
        last_transition_request_fingerprint = v_request_fingerprint,
        row_version = row_version + 1,
        updated_at = v_destroyed_at
    where id = v_connection.id
    returning * into v_connection;
  end if;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_destroyed',
    'succeeded',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'local_destruction',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'revocation_state', v_credential.provider_revocation_status
    ),
    v_destroyed_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
end;
$function$;

create or replace function public.record_integration_authorization_event_v1(
  p_event jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_event_id uuid;
  v_occurred_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_event,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'credentialId',
        'actorId',
        'action',
        'outcome',
        'reasonCode',
        'credentialVersion',
        'occurredAt'
      ]
    )
    or p_event ->> 'contractVersion' <> 'integration_authorization_audit_v1'
    or p_event ->> 'action' not in (
      'credential_decrypt_attempt', 'authorization_failure'
    )
    or p_event ->> 'outcome' not in ('allowed', 'denied', 'succeeded', 'failed')
    or p_event ->> 'reasonCode' not in (
      'decrypt_succeeded', 'decrypt_failed', 'invalid_grant',
      'provider_revoked', 'scope_loss', 'provider_transient',
      'credential_expired', 'kms_failure', 'integrity_failure'
    )
    or not private.is_bounded_identifier_v1(p_event ->> 'actorId')
    or not (
      (
        p_event ->> 'action' = 'credential_decrypt_attempt'
        and p_event ->> 'credentialId' is not null
        and (p_event ->> 'credentialVersion') ~ '^[1-9][0-9]*$'
        and p_event ->> 'reasonCode' in (
          'decrypt_succeeded', 'decrypt_failed', 'kms_failure', 'integrity_failure'
        )
      )
      or (
        p_event ->> 'action' = 'authorization_failure'
        and p_event -> 'credentialId' = 'null'::jsonb
        and p_event -> 'credentialVersion' = 'null'::jsonb
        and p_event ->> 'reasonCode' in (
          'invalid_grant', 'provider_revoked', 'scope_loss',
          'provider_transient', 'credential_expired', 'kms_failure',
          'integrity_failure'
        )
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_authorization_event_payload_invalid';
  end if;

  v_occurred_at := (p_event ->> 'occurredAt')::timestamptz;
  v_occurred_at := pg_catalog.transaction_timestamp();
  if p_event ->> 'action' = 'authorization_failure' then
    select * into v_connection
    from private.integration_connections
    where workspace_id = (p_event ->> 'workspaceId')::uuid
      and business_entity_id = (p_event ->> 'businessEntityId')::uuid
      and id = (p_event ->> 'connectionId')::uuid;
    if not found then
      raise exception using
        errcode = '42501',
        message = 'integration_authorization_event_denied';
    end if;
    v_event_id := private.phase_5_insert_audit_v1(
      v_connection.workspace_id,
      v_connection.business_entity_id,
      v_connection.id,
      'service',
      p_event ->> 'actorId',
      p_event ->> 'action',
      p_event ->> 'outcome',
      'integration_connection',
      v_connection.id::text,
      p_request_id,
      p_event ->> 'reasonCode',
      pg_catalog.jsonb_build_object(
        'connection_generation', v_connection.connection_generation,
        'connection_status', v_connection.status
      ),
      v_occurred_at
    );
  else
    select * into v_credential
    from private.integration_credentials
    where id = (p_event ->> 'credentialId')::uuid
      and workspace_id = (p_event ->> 'workspaceId')::uuid
      and business_entity_id = (p_event ->> 'businessEntityId')::uuid
      and connection_id = (p_event ->> 'connectionId')::uuid;
    if not found
      or v_credential.credential_version <>
        (p_event ->> 'credentialVersion')::bigint then
      raise exception using
        errcode = '42501',
        message = 'integration_authorization_event_denied';
    end if;
    v_event_id := private.phase_5_insert_audit_v1(
      v_credential.workspace_id,
      v_credential.business_entity_id,
      v_credential.connection_id,
      'service',
      p_event ->> 'actorId',
      p_event ->> 'action',
      p_event ->> 'outcome',
      'integration_credential',
      v_credential.id::text,
      p_request_id,
      p_event ->> 'reasonCode',
      pg_catalog.jsonb_build_object(
        'connection_generation', v_credential.connection_generation,
        'credential_status', v_credential.status,
        'credential_version', v_credential.credential_version
      ),
      v_occurred_at
    );
  end if;
  return pg_catalog.jsonb_build_object('eventId', v_event_id);
end;
$function$;

revoke all on function public.create_integration_oauth_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.create_integration_oauth_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;

revoke all on function public.consume_integration_oauth_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.consume_integration_oauth_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;

revoke all on function public.store_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.store_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.acquire_integration_credential_refresh_lease_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.acquire_integration_credential_refresh_lease_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.rotate_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.rotate_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.complete_integration_credential_refresh_failure_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.complete_integration_credential_refresh_failure_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.revoke_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.revoke_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.complete_integration_credential_revocation_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.complete_integration_credential_revocation_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.destroy_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.destroy_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.record_integration_authorization_event_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
grant execute on function public.record_integration_authorization_event_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function private.assert_integration_oauth_ingress_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.assert_integration_credential_broker_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.is_integration_audit_metadata_v5(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.phase_5_fingerprint_text_v1(bytea)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.phase_5_request_fingerprint_v1(text, jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.phase_5_text_array_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.is_phase_5_scope_set_v1(text[])
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.is_phase_5_return_intent_v1(text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.is_phase_5_kms_key_resource_v1(text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.phase_5_credential_aad_digest_v1(
  text, uuid, uuid, bigint, text, uuid
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.phase_5_insert_audit_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, jsonb,
  timestamptz
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.validate_integration_oauth_state_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;
revoke all on function private.validate_integration_credential_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority;

commit;
