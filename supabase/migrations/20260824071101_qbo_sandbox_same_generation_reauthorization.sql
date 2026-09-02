-- Phase 8B same-generation QBO sandbox reauthorization.
--
-- Initial authorization remains pending_authorization-only. This migration
-- adds a purpose-bound, single-use recovery path for the existing initializing
-- connection and appends a replacement credential without rewriting history.

begin;

create table private.integration_reauthorization_states (
  id uuid primary key,
  contract_version text not null check (
    contract_version = 'integration_reauthorization_state_v1'
  ),
  authorization_purpose text not null check (
    authorization_purpose = 'reauthorization'
  ),
  reason_code text not null check (
    reason_code = 'expired_credential_recovery'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  provider_key text not null check (provider_key = 'quickbooks_online'),
  provider_environment text not null check (provider_environment = 'sandbox'),
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  requested_scopes text[] not null check (
    requested_scopes = array['com.intuit.quickbooks.accounting']::text[]
  ),
  redirect_uri text not null check (
    redirect_uri =
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback'
  ),
  return_intent text not null check (
    return_intent = '/phase8b/sandbox/reauthorized'
  ),
  state_hash bytea not null unique check (pg_catalog.octet_length(state_hash) = 32),
  expected_connection_row_version bigint not null check (
    expected_connection_row_version > 0
  ),
  superseded_credential_id uuid not null
    references private.integration_credentials(id) on delete restrict,
  superseded_credential_version bigint not null check (
    superseded_credential_version > 0
  ),
  expected_credential_row_version bigint not null check (
    expected_credential_row_version > 0
  ),
  mapping_id uuid not null,
  expected_mapping_row_version bigint not null check (
    expected_mapping_row_version > 0
  ),
  provider_entity_reference_fingerprint bytea not null check (
    pg_catalog.octet_length(provider_entity_reference_fingerprint) = 32
  ),
  prior_mapping_verification_fingerprint bytea not null check (
    pg_catalog.octet_length(prior_mapping_verification_fingerprint) = 32
  ),
  recovery_evidence_count integer not null check (recovery_evidence_count > 0),
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'completed', 'expired')
  ),
  creation_request_id text not null unique check (
    private.is_bounded_identifier_v1(creation_request_id)
  ),
  creation_request_fingerprint bytea not null check (
    pg_catalog.octet_length(creation_request_fingerprint) = 32
  ),
  consume_request_id text unique check (
    consume_request_id is null
    or private.is_bounded_identifier_v1(consume_request_id)
  ),
  consume_request_fingerprint bytea check (
    consume_request_fingerprint is null
    or pg_catalog.octet_length(consume_request_fingerprint) = 32
  ),
  completion_request_id text unique check (
    completion_request_id is null
    or private.is_bounded_identifier_v1(completion_request_id)
  ),
  completion_request_fingerprint bytea check (
    completion_request_fingerprint is null
    or pg_catalog.octet_length(completion_request_fingerprint) = 32
  ),
  replacement_credential_id uuid,
  mapping_revalidation_fingerprint bytea check (
    mapping_revalidation_fingerprint is null
    or pg_catalog.octet_length(mapping_revalidation_fingerprint) = 32
  ),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  completed_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  constraint integration_reauthorization_states_connection_fkey foreign key (
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
  constraint integration_reauthorization_states_mapping_fkey foreign key (
    workspace_id,
    business_entity_id,
    connection_id,
    mapping_id
  ) references private.provider_entity_mappings(
    workspace_id,
    business_entity_id,
    connection_id,
    id
  ) on delete restrict,
  constraint integration_reauthorization_states_request_pairs_check check (
    (consume_request_id is null) = (consume_request_fingerprint is null)
    and (completion_request_id is null) =
      (completion_request_fingerprint is null)
  ),
  constraint integration_reauthorization_states_lifecycle_check check (
    (
      status = 'pending'
      and consume_request_id is null
      and consumed_at is null
      and completion_request_id is null
      and replacement_credential_id is null
      and mapping_revalidation_fingerprint is null
      and completed_at is null
    )
    or (
      status = 'consumed'
      and consume_request_id is not null
      and consumed_at is not null
      and completion_request_id is null
      and replacement_credential_id is null
      and mapping_revalidation_fingerprint is null
      and completed_at is null
    )
    or (
      status = 'completed'
      and consume_request_id is not null
      and consumed_at is not null
      and completion_request_id is not null
      and replacement_credential_id is not null
      and mapping_revalidation_fingerprint is not null
      and completed_at is not null
    )
    or (
      status = 'expired'
      and consume_request_id is null
      and consumed_at is null
      and completion_request_id is null
      and replacement_credential_id is null
      and mapping_revalidation_fingerprint is null
      and completed_at is null
    )
  ),
  constraint integration_reauthorization_states_time_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
    and (consumed_at is null or consumed_at between created_at and expires_at)
    and (completed_at is null or completed_at >= consumed_at)
  )
);

create index integration_reauthorization_states_scope_status_idx
  on private.integration_reauthorization_states(
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    status
  );
create index integration_reauthorization_states_expiry_idx
  on private.integration_reauthorization_states(expires_at)
  where status = 'pending';

alter table private.integration_reauthorization_states enable row level security;
alter table private.integration_reauthorization_states force row level security;

revoke all on table private.integration_reauthorization_states
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

alter table private.integration_credentials
  alter column oauth_state_id drop not null;
alter table private.integration_credentials
  add column reauthorization_state_id uuid,
  add column supersedes_credential_id uuid,
  add column superseded_at timestamptz;

alter table private.integration_credentials
  drop constraint integration_credentials_connection_generation_key;
alter table private.integration_credentials
  drop constraint integration_credentials_status_check;
alter table private.integration_credentials
  add constraint integration_credentials_status_check check (
    status in (
      'active', 'reauthorization_required', 'superseded', 'revoked', 'destroyed'
    )
  );
alter table private.integration_credentials
  drop constraint integration_credentials_lifecycle_check;
alter table private.integration_credentials
  add constraint integration_credentials_lifecycle_check check (
    (
      status = 'active'
      and credential_ciphertext is not null
      and revoked_at is null
      and destroyed_at is null
      and superseded_at is null
    )
    or (
      status = 'reauthorization_required'
      and credential_ciphertext is not null
      and revoked_at is null
      and destroyed_at is null
      and superseded_at is null
    )
    or (
      status = 'superseded'
      and credential_ciphertext is not null
      and revoked_at is null
      and destroyed_at is null
      and superseded_at is not null
    )
    or (
      status = 'revoked'
      and credential_ciphertext is not null
      and revoked_at is not null
      and destroyed_at is null
      and superseded_at is null
    )
    or (
      status = 'destroyed'
      and credential_ciphertext is null
      and revoked_at is not null
      and destroyed_at is not null
      and superseded_at is null
    )
  );
alter table private.integration_credentials
  drop constraint integration_credentials_time_check;
alter table private.integration_credentials
  add constraint integration_credentials_time_check check (
    access_expires_at > created_at
    and (refresh_expires_at is null or refresh_expires_at > created_at)
    and updated_at >= created_at
    and (superseded_at is null or superseded_at >= created_at)
    and (revoked_at is null or revoked_at >= created_at)
    and (destroyed_at is null or destroyed_at >= revoked_at)
  );
alter table private.integration_credentials
  add constraint integration_credentials_authorization_source_check check (
    (
      oauth_state_id is not null
      and reauthorization_state_id is null
      and supersedes_credential_id is null
    )
    or (
      oauth_state_id is null
      and reauthorization_state_id is not null
      and supersedes_credential_id is not null
      and credential_version > 1
    )
  );
alter table private.integration_credentials
  add constraint integration_credentials_reauthorization_state_fkey
    foreign key (reauthorization_state_id)
    references private.integration_reauthorization_states(id)
    on delete restrict;
alter table private.integration_credentials
  add constraint integration_credentials_supersedes_fkey
    foreign key (supersedes_credential_id)
    references private.integration_credentials(id)
    on delete restrict;

create unique index integration_credentials_scope_version_key
  on private.integration_credentials(
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    credential_version
  );
create unique index integration_credentials_current_scope_key
  on private.integration_credentials(
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation
  )
  where status in ('active', 'reauthorization_required');
create unique index integration_credentials_reauthorization_state_key
  on private.integration_credentials(reauthorization_state_id)
  where reauthorization_state_id is not null;

alter table private.integration_reauthorization_states
  add constraint integration_reauthorization_states_replacement_fkey
    foreign key (replacement_credential_id)
    references private.integration_credentials(id)
    on delete restrict;

create or replace function private.validate_integration_reauthorization_state_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id,
    new.contract_version,
    new.authorization_purpose,
    new.reason_code,
    new.workspace_id,
    new.business_entity_id,
    new.connection_id,
    new.connection_generation,
    new.provider_key,
    new.provider_environment,
    new.initiated_by,
    new.requested_scopes,
    new.redirect_uri,
    new.return_intent,
    new.state_hash,
    new.expected_connection_row_version,
    new.superseded_credential_id,
    new.superseded_credential_version,
    new.expected_credential_row_version,
    new.mapping_id,
    new.expected_mapping_row_version,
    new.provider_entity_reference_fingerprint,
    new.prior_mapping_verification_fingerprint,
    new.recovery_evidence_count,
    new.creation_request_id,
    new.creation_request_fingerprint,
    new.created_at,
    new.expires_at
  ) is distinct from (
    old.id,
    old.contract_version,
    old.authorization_purpose,
    old.reason_code,
    old.workspace_id,
    old.business_entity_id,
    old.connection_id,
    old.connection_generation,
    old.provider_key,
    old.provider_environment,
    old.initiated_by,
    old.requested_scopes,
    old.redirect_uri,
    old.return_intent,
    old.state_hash,
    old.expected_connection_row_version,
    old.superseded_credential_id,
    old.superseded_credential_version,
    old.expected_credential_row_version,
    old.mapping_id,
    old.expected_mapping_row_version,
    old.provider_entity_reference_fingerprint,
    old.prior_mapping_verification_fingerprint,
    old.recovery_evidence_count,
    old.creation_request_id,
    old.creation_request_fingerprint,
    old.created_at,
    old.expires_at
  ) or new.row_version <> old.row_version + 1 then
    raise exception using
      errcode = '55000',
      message = 'integration_reauthorization_state_immutable';
  end if;

  if not (
    (
      old.status = 'pending'
      and new.status = 'consumed'
      and new.consume_request_id is not null
      and new.consume_request_fingerprint is not null
      and new.consumed_at is not null
      and new.completion_request_id is null
      and new.replacement_credential_id is null
      and new.mapping_revalidation_fingerprint is null
      and new.completed_at is null
    )
    or (
      old.status = 'pending'
      and new.status = 'expired'
      and new.consume_request_id is null
      and new.consume_request_fingerprint is null
      and new.consumed_at is null
      and new.completion_request_id is null
      and new.replacement_credential_id is null
      and new.mapping_revalidation_fingerprint is null
      and new.completed_at is null
    )
    or (
      old.status = 'consumed'
      and new.status = 'completed'
      and new.consume_request_id = old.consume_request_id
      and new.consume_request_fingerprint = old.consume_request_fingerprint
      and new.consumed_at = old.consumed_at
      and new.completion_request_id is not null
      and new.completion_request_fingerprint is not null
      and new.replacement_credential_id is not null
      and new.mapping_revalidation_fingerprint is not null
      and new.completed_at is not null
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_reauthorization_state_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.store_reauthorized_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_reauthorization_states;
  v_connection private.integration_connections;
  v_old_credential private.integration_credentials;
  v_new_credential private.integration_credentials;
  v_mapping private.provider_entity_mappings;
  v_scopes text[];
  v_ciphertext bytea;
  v_aad_digest bytea;
  v_external_fingerprint bytea;
  v_mapping_revalidation_fingerprint bytea;
  v_request_fingerprint bytea;
  v_reauthorized_at timestamptz;
  v_completed_at timestamptz := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
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
        'reauthorizationStateId',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'mappingId',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'envelopeSchemaVersion',
        'aadSchemaVersion',
        'aadDigest',
        'kmsKeyResource',
        'ciphertextBase64',
        'accessExpiresAt',
        'refreshExpiresAt',
        'grantedScopes',
        'externalEntityReferenceFingerprint',
        'mappingRevalidationFingerprint',
        'reauthorizedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_credential_reauthorization_v1'
    or p_command ->> 'connectionGeneration' <> '1'
    or p_command ->> 'providerKey' <> 'quickbooks_online'
    or p_command ->> 'providerEnvironment' <> 'sandbox'
    or p_command ->> 'envelopeSchemaVersion' <>
      'oauth_credential_envelope_v1'
    or p_command ->> 'aadSchemaVersion' <> 'oauth_credential_aad_v1'
    or not private.is_phase_5_kms_key_resource_v1(
      p_command ->> 'kmsKeyResource'
    )
    or (p_command ->> 'ciphertextBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.char_length(p_command ->> 'ciphertextBase64') > 131072 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'grantedScopes');
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[] then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_scope_invalid';
  end if;
  begin
    v_ciphertext := pg_catalog.decode(
      p_command ->> 'ciphertextBase64',
      'base64'
    );
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_ciphertext_invalid';
  end;
  if pg_catalog.octet_length(v_ciphertext) not between 16 and 98304 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_ciphertext_invalid';
  end if;
  v_aad_digest := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'aadDigest'
  );
  v_external_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'externalEntityReferenceFingerprint'
  );
  v_mapping_revalidation_fingerprint :=
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'mappingRevalidationFingerprint'
    );
  v_reauthorized_at := (p_command ->> 'reauthorizedAt')::timestamptz;
  v_access_expires_at := (p_command ->> 'accessExpiresAt')::timestamptz;
  v_refresh_expires_at := case
    when p_command -> 'refreshExpiresAt' = 'null'::jsonb then null
    else (p_command ->> 'refreshExpiresAt')::timestamptz
  end;
  if v_access_expires_at <= v_reauthorized_at
    or (
      v_refresh_expires_at is not null
      and v_refresh_expires_at <= v_reauthorized_at
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_expiry_invalid';
  end if;
  v_access_expires_at := v_completed_at
    + (v_access_expires_at - v_reauthorized_at);
  v_refresh_expires_at := case
    when v_refresh_expires_at is null then null
    else v_completed_at + (v_refresh_expires_at - v_reauthorized_at)
  end;
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select credential.*
  into v_new_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'id')::uuid
    or credential.reauthorization_state_id =
      (p_command ->> 'reauthorizationStateId')::uuid
  for update;
  if found then
    if v_new_credential.last_request_id = p_request_id
      and v_new_credential.last_request_fingerprint = v_request_fingerprint
      and v_new_credential.status = 'active' then
      select connection.*
      into v_connection
      from private.integration_connections as connection
      where connection.id = v_new_credential.connection_id;
      select mapping.*
      into v_mapping
      from private.provider_entity_mappings as mapping
      where mapping.id = (p_command ->> 'mappingId')::uuid;
      return pg_catalog.jsonb_build_object(
        'credentialId', v_new_credential.id,
        'credentialVersion', v_new_credential.credential_version,
        'credentialStatus', v_new_credential.status,
        'supersededCredentialId', v_new_credential.supersedes_credential_id,
        'supersededCredentialVersion', v_new_credential.credential_version - 1,
        'connectionStatus', v_connection.status,
        'connectionRowVersion', v_connection.row_version,
        'mappingId', v_mapping.id,
        'mappingStatus', v_mapping.status,
        'mappingRowVersion', v_mapping.row_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_credential_reauthorization_request_conflict';
  end if;

  select state.*
  into v_state
  from private.integration_reauthorization_states as state
  where state.id = (p_command ->> 'reauthorizationStateId')::uuid
  for update;
  if not found
    or v_state.status <> 'consumed'
    or v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <>
      (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_state.mapping_id <> (p_command ->> 'mappingId')::uuid
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes
    or v_state.authorization_purpose <> 'reauthorization'
    or v_state.reason_code <> 'expired_credential_recovery'
    or v_state.redirect_uri <>
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback'
    or v_reauthorized_at <> v_state.consumed_at then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_reauthorization_state_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
    and connection.id = v_state.connection_id
    and connection.connection_generation = v_state.connection_generation
    and connection.provider_key = v_state.provider_key
    and connection.provider_environment = v_state.provider_environment
  for update;
  if not found
    or v_connection.status <> 'initializing'
    or v_connection.state_reason_code <> 'initial_sync_pending'
    or v_connection.row_version <> v_state.expected_connection_row_version
    or v_connection.provider_tenant_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_connection.requested_scopes <> v_scopes
    or v_connection.granted_scopes <> v_scopes then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_reauthorization_connection_stale';
  end if;

  select credential.*
  into v_old_credential
  from private.integration_credentials as credential
  where credential.id = v_state.superseded_credential_id
    and credential.workspace_id = v_state.workspace_id
    and credential.business_entity_id = v_state.business_entity_id
    and credential.connection_id = v_state.connection_id
    and credential.connection_generation = v_state.connection_generation
    and credential.provider_key = v_state.provider_key
    and credential.provider_environment = v_state.provider_environment
  for update;
  if not found
    or v_old_credential.status <> 'active'
    or v_old_credential.credential_version <>
      v_state.superseded_credential_version
    or v_old_credential.row_version <> v_state.expected_credential_row_version
    or v_old_credential.credential_ciphertext is null
    or v_old_credential.granted_scopes <> v_scopes
    or v_old_credential.external_entity_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_old_credential.access_expires_at > pg_catalog.transaction_timestamp()
    or v_old_credential.refresh_lease_id is not null then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_reauthorization_credential_stale';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_state.workspace_id
    and mapping.business_entity_id = v_state.business_entity_id
    and mapping.connection_id = v_state.connection_id
    and mapping.id = v_state.mapping_id
    and mapping.provider_key = v_state.provider_key
    and mapping.provider_environment = v_state.provider_environment
  for update;
  if not found
    or v_mapping.provider_entity_type <> 'company'
    or v_mapping.mapping_role <> 'primary'
    or v_mapping.status <> 'active'
    or v_mapping.row_version <> v_state.expected_mapping_row_version
    or v_mapping.provider_entity_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_mapping.verification_fingerprint <>
      v_state.prior_mapping_verification_fingerprint
    or v_external_fingerprint <>
      v_state.provider_entity_reference_fingerprint then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_reauthorization_mapping_stale';
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
      message = 'integration_credential_reauthorization_aad_invalid';
  end if;

  update private.integration_credentials
  set status = 'superseded',
      superseded_at = v_completed_at,
      row_version = row_version + 1
  where id = v_old_credential.id
    and row_version = v_state.expected_credential_row_version
  returning * into v_old_credential;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_reauthorization_credential_stale';
  end if;

  insert into private.integration_credentials (
    id,
    contract_version,
    oauth_state_id,
    reauthorization_state_id,
    supersedes_credential_id,
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
    null,
    v_state.id,
    v_old_credential.id,
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    v_state.connection_generation,
    v_state.provider_key,
    v_state.provider_environment,
    v_state.initiated_by,
    v_state.superseded_credential_version + 1,
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
    v_completed_at,
    v_completed_at
  ) returning * into v_new_credential;

  update private.integration_reauthorization_states
  set status = 'completed',
      completion_request_id = p_request_id,
      completion_request_fingerprint = v_request_fingerprint,
      replacement_credential_id = v_new_credential.id,
      mapping_revalidation_fingerprint =
        v_mapping_revalidation_fingerprint,
      completed_at = v_completed_at,
      row_version = row_version + 1
  where id = v_state.id
    and status = 'consumed'
    and row_version = v_state.row_version
  returning * into v_state;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_reauthorization_state_stale';
  end if;

  perform private.phase_5_insert_audit_v1(
    v_new_credential.workspace_id,
    v_new_credential.business_entity_id,
    v_new_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_encrypted',
    'succeeded',
    'integration_credential',
    v_new_credential.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_new_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_new_credential.status,
      'credential_version', v_new_credential.credential_version,
      'mapping_status', v_mapping.status,
      'oauth_state_status', v_state.status,
      'idempotent', false
    ),
    v_completed_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_new_credential.id,
    'credentialVersion', v_new_credential.credential_version,
    'credentialStatus', v_new_credential.status,
    'supersededCredentialId', v_old_credential.id,
    'supersededCredentialVersion', v_old_credential.credential_version,
    'connectionStatus', v_connection.status,
    'connectionRowVersion', v_connection.row_version,
    'mappingId', v_mapping.id,
    'mappingStatus', v_mapping.status,
    'mappingRowVersion', v_mapping.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_reauthorization_payload_invalid';
end;
$function$;


create or replace function public.consume_integration_reauthorization_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_reauthorization_states;
  v_scopes text[];
  v_state_hash bytea;
  v_provider_entity_reference_fingerprint bytea;
  v_request_fingerprint bytea;
  v_consumed_at timestamptz := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
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
        'mappingId',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'redirectUri',
        'returnIntent',
        'authorizationPurpose',
        'reasonCode',
        'stateHash',
        'providerEntityReferenceFingerprint',
        'consumedAt'
      ]
    )
    or p_command ->> 'connectionGeneration' <> '1'
    or p_command ->> 'providerKey' <> 'quickbooks_online'
    or p_command ->> 'providerEnvironment' <> 'sandbox'
    or p_command ->> 'redirectUri' <>
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback'
    or p_command ->> 'returnIntent' <> '/phase8b/sandbox/reauthorized'
    or p_command ->> 'authorizationPurpose' <> 'reauthorization'
    or p_command ->> 'reasonCode' <> 'expired_credential_recovery' then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_consume_payload_invalid';
  end if;

  perform (p_command ->> 'consumedAt')::timestamptz;
  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[] then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_provider_entity_reference_fingerprint :=
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'providerEntityReferenceFingerprint'
    );
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select state.*
  into v_state
  from private.integration_reauthorization_states as state
  where state.state_hash = v_state_hash
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
      'reauthorization_state',
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

  if v_state.status in ('consumed', 'completed') then
    v_reason := 'state_replayed';
  elsif v_state.status = 'expired' or v_consumed_at >= v_state.expires_at then
    v_reason := 'state_expired';
  elsif v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <>
      (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_state.mapping_id <> (p_command ->> 'mappingId')::uuid
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes
    or v_state.redirect_uri <> p_command ->> 'redirectUri'
    or v_state.return_intent <> p_command ->> 'returnIntent'
    or v_state.authorization_purpose <> p_command ->> 'authorizationPurpose'
    or v_state.reason_code <> p_command ->> 'reasonCode'
    or v_state.provider_entity_reference_fingerprint <>
      v_provider_entity_reference_fingerprint then
    v_reason := 'state_invalid';
  elsif not exists (
    select 1
    from private.integration_connections as connection
    join private.integration_credentials as credential
      on credential.workspace_id = connection.workspace_id
      and credential.business_entity_id = connection.business_entity_id
      and credential.connection_id = connection.id
      and credential.connection_generation = connection.connection_generation
      and credential.id = v_state.superseded_credential_id
    join private.provider_entity_mappings as mapping
      on mapping.workspace_id = connection.workspace_id
      and mapping.business_entity_id = connection.business_entity_id
      and mapping.connection_id = connection.id
      and mapping.id = v_state.mapping_id
    where connection.workspace_id = v_state.workspace_id
      and connection.business_entity_id = v_state.business_entity_id
      and connection.id = v_state.connection_id
      and connection.connection_generation = v_state.connection_generation
      and connection.provider_key = v_state.provider_key
      and connection.provider_environment = v_state.provider_environment
      and connection.status = 'initializing'
      and connection.state_reason_code = 'initial_sync_pending'
      and connection.row_version = v_state.expected_connection_row_version
      and connection.provider_tenant_reference_fingerprint =
        v_state.provider_entity_reference_fingerprint
      and credential.provider_key = v_state.provider_key
      and credential.provider_environment = v_state.provider_environment
      and credential.status = 'active'
      and credential.credential_version =
        v_state.superseded_credential_version
      and credential.row_version = v_state.expected_credential_row_version
      and credential.credential_ciphertext is not null
      and credential.granted_scopes = v_state.requested_scopes
      and credential.external_entity_reference_fingerprint =
        v_state.provider_entity_reference_fingerprint
      and credential.access_expires_at <= pg_catalog.transaction_timestamp()
      and credential.refresh_lease_id is null
      and mapping.provider_key = v_state.provider_key
      and mapping.provider_environment = v_state.provider_environment
      and mapping.provider_entity_type = 'company'
      and mapping.mapping_role = 'primary'
      and mapping.status = 'active'
      and mapping.row_version = v_state.expected_mapping_row_version
      and mapping.provider_entity_reference_fingerprint =
        v_state.provider_entity_reference_fingerprint
      and mapping.verification_fingerprint =
        v_state.prior_mapping_verification_fingerprint
  ) then
    v_reason := 'authority_stale';
  end if;

  if v_reason is not null then
    if v_reason = 'state_expired' and v_state.status = 'pending' then
      update private.integration_reauthorization_states
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
      'reauthorization_state',
      v_state.id::text,
      p_request_id,
      v_reason,
      pg_catalog.jsonb_build_object(
        'connection_generation', v_state.connection_generation,
        'credential_version', v_state.superseded_credential_version,
        'oauth_state_status', v_state.status
      ),
      v_consumed_at
    );
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', v_reason
    );
  end if;

  update private.integration_reauthorization_states
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
    'reauthorization_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'credential_version', v_state.superseded_credential_version,
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
    'mappingId', v_state.mapping_id,
    'providerKey', v_state.provider_key,
    'providerEnvironment', v_state.provider_environment,
    'requestedScopes', pg_catalog.to_jsonb(v_state.requested_scopes),
    'redirectUri', v_state.redirect_uri,
    'returnIntent', v_state.return_intent,
    'authorizationPurpose', v_state.authorization_purpose,
    'reasonCode', v_state.reason_code,
    'expectedConnectionRowVersion', v_state.expected_connection_row_version,
    'supersededCredentialId', v_state.superseded_credential_id,
    'supersededCredentialVersion', v_state.superseded_credential_version,
    'expectedCredentialRowVersion', v_state.expected_credential_row_version,
    'expectedMappingRowVersion', v_state.expected_mapping_row_version,
    'providerEntityReferenceFingerprint',
      private.phase_5_fingerprint_text_v1(
        v_state.provider_entity_reference_fingerprint
      ),
    'consumedAt', pg_catalog.to_char(
      v_state.consumed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_consume_payload_invalid';
end;
$function$;


create trigger validate_integration_reauthorization_state_mutation_v1
before update on private.integration_reauthorization_states
for each row execute function
  private.validate_integration_reauthorization_state_mutation_v1();

create trigger reject_integration_reauthorization_state_delete_v1
before delete on private.integration_reauthorization_states
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_integration_credential_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status in ('destroyed', 'superseded')
    or (
      new.id,
      new.contract_version,
      new.oauth_state_id,
      new.reauthorization_state_id,
      new.supersedes_credential_id,
      new.workspace_id,
      new.business_entity_id,
      new.connection_id,
      new.connection_generation,
      new.provider_key,
      new.provider_environment,
      new.initiated_by,
      new.envelope_schema_version,
      new.aad_schema_version,
      new.aad_digest,
      new.kms_key_resource,
      new.created_at
    ) is distinct from (
      old.id,
      old.contract_version,
      old.oauth_state_id,
      old.reauthorization_state_id,
      old.supersedes_credential_id,
      old.workspace_id,
      old.business_entity_id,
      old.connection_id,
      old.connection_generation,
      old.provider_key,
      old.provider_environment,
      old.initiated_by,
      old.envelope_schema_version,
      old.aad_schema_version,
      old.aad_digest,
      old.kms_key_resource,
      old.created_at
    )
    or new.updated_at < old.updated_at
    or new.row_version <> old.row_version + 1
    or new.credential_version < old.credential_version
    or new.credential_version > old.credential_version + 1 then
    raise exception using
      errcode = '55000',
      message = 'integration_credential_immutable';
  end if;

  if new.status = 'superseded' then
    if old.status not in ('active', 'reauthorization_required')
      or new.credential_version <> old.credential_version
      or new.credential_ciphertext is distinct from old.credential_ciphertext
      or new.access_expires_at <> old.access_expires_at
      or new.refresh_expires_at is distinct from old.refresh_expires_at
      or new.granted_scopes <> old.granted_scopes
      or new.external_entity_reference_fingerprint is distinct from
        old.external_entity_reference_fingerprint
      or new.refresh_lease_id is not null
      or new.refresh_lease_owner_fingerprint is not null
      or new.refresh_lease_acquired_at is not null
      or new.refresh_lease_expires_at is not null
      or new.revoked_at is not null
      or new.destroyed_at is not null
      or new.superseded_at is null then
      raise exception using
        errcode = '55000',
        message = 'integration_credential_supersession_invalid';
    end if;
    return new;
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
  if new.superseded_at is distinct from old.superseded_at then
    raise exception using
      errcode = '55000',
      message = 'integration_credential_supersession_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.create_integration_reauthorization_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_reauthorization_states;
  v_connection private.integration_connections;
  v_credential private.integration_credentials;
  v_mapping private.provider_entity_mappings;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_created_at timestamptz;
  v_expires_at timestamptz;
  v_requested_ttl interval;
  v_recovery_evidence_count integer;
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
        'mappingId',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'redirectUri',
        'returnIntent',
        'authorizationPurpose',
        'reasonCode',
        'stateHash',
        'createdAt',
        'expiresAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_reauthorization_state_v1'
    or p_command ->> 'authorizationPurpose' <> 'reauthorization'
    or p_command ->> 'reasonCode' <> 'expired_credential_recovery'
    or p_command ->> 'connectionGeneration' <> '1'
    or p_command ->> 'providerKey' <> 'quickbooks_online'
    or p_command ->> 'providerEnvironment' <> 'sandbox'
    or p_command ->> 'redirectUri' <>
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback'
    or p_command ->> 'returnIntent' <> '/phase8b/sandbox/reauthorized' then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[] then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_created_at := (p_command ->> 'createdAt')::timestamptz;
  v_expires_at := (p_command ->> 'expiresAt')::timestamptz;
  if v_expires_at <= v_created_at
    or v_expires_at > v_created_at + interval '10 minutes' then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_expiry_invalid';
  end if;
  v_requested_ttl := v_expires_at - v_created_at;
  v_created_at := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  v_expires_at := v_created_at + v_requested_ttl;
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select state.*
  into v_state
  from private.integration_reauthorization_states as state
  where state.creation_request_id = p_request_id;
  if found then
    if v_state.creation_request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'integration_reauthorization_state_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stateId', v_state.id,
      'connectionRowVersion', v_state.expected_connection_row_version,
      'credentialId', v_state.superseded_credential_id,
      'credentialVersion', v_state.superseded_credential_version,
      'credentialRowVersion', v_state.expected_credential_row_version,
      'mappingId', v_state.mapping_id,
      'mappingRowVersion', v_state.expected_mapping_row_version,
      'recoveryEvidenceCount', v_state.recovery_evidence_count,
      'idempotent', true
    );
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation = 1
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
  for share;
  if not found
    or v_connection.status <> 'initializing'
    or v_connection.state_reason_code <> 'initial_sync_pending'
    or v_connection.requested_scopes <> v_scopes
    or v_connection.granted_scopes <> v_scopes
    or v_connection.provider_tenant_reference_fingerprint is null then
    raise exception using
      errcode = '42501',
      message = 'integration_reauthorization_state_connection_denied';
  end if;

  if not exists (
    select 1
    from public.workspace_members as member
    where member.workspace_id = v_connection.workspace_id
      and member.user_id = (p_command ->> 'initiatedBy')::uuid
      and member.status = 'active'
      and member.role in ('owner', 'admin', 'manager')
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_reauthorization_state_initiator_denied';
  end if;

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
    and credential.status = 'active'
    and credential.credential_ciphertext is not null
    and credential.granted_scopes = v_scopes
    and credential.external_entity_reference_fingerprint =
      v_connection.provider_tenant_reference_fingerprint
    and credential.access_expires_at <= pg_catalog.transaction_timestamp()
    and credential.refresh_lease_id is null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_reauthorization_state_credential_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = v_connection.provider_key
    and mapping.provider_environment = v_connection.provider_environment
    and mapping.provider_entity_type = 'company'
    and mapping.mapping_role = 'primary'
    and mapping.status = 'active'
    and mapping.provider_entity_reference_fingerprint =
      v_connection.provider_tenant_reference_fingerprint
    and mapping.provider_entity_reference_fingerprint =
      v_credential.external_entity_reference_fingerprint
    and mapping.verification_fingerprint is not null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_reauthorization_state_mapping_denied';
  end if;

  select pg_catalog.count(*)::integer
  into v_recovery_evidence_count
  from private.integration_sync_task_recovery_events as recovery
  where recovery.workspace_id = v_connection.workspace_id
    and recovery.business_entity_id = v_connection.business_entity_id
    and recovery.connection_id = v_connection.id
    and recovery.connection_generation = v_connection.connection_generation
    and recovery.credential_id = v_credential.id
    and recovery.credential_version = v_credential.credential_version;
  if v_recovery_evidence_count < 1 then
    raise exception using
      errcode = '42501',
      message = 'integration_reauthorization_state_recovery_evidence_denied';
  end if;

  insert into private.integration_reauthorization_states (
    id,
    contract_version,
    authorization_purpose,
    reason_code,
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment,
    initiated_by,
    requested_scopes,
    redirect_uri,
    return_intent,
    state_hash,
    expected_connection_row_version,
    superseded_credential_id,
    superseded_credential_version,
    expected_credential_row_version,
    mapping_id,
    expected_mapping_row_version,
    provider_entity_reference_fingerprint,
    prior_mapping_verification_fingerprint,
    recovery_evidence_count,
    status,
    creation_request_id,
    creation_request_fingerprint,
    created_at,
    expires_at,
    row_version
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_reauthorization_state_v1',
    'reauthorization',
    'expired_credential_recovery',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_connection.connection_generation,
    v_connection.provider_key,
    v_connection.provider_environment,
    (p_command ->> 'initiatedBy')::uuid,
    v_scopes,
    p_command ->> 'redirectUri',
    p_command ->> 'returnIntent',
    v_state_hash,
    v_connection.row_version,
    v_credential.id,
    v_credential.credential_version,
    v_credential.row_version,
    v_mapping.id,
    v_mapping.row_version,
    v_mapping.provider_entity_reference_fingerprint,
    v_mapping.verification_fingerprint,
    v_recovery_evidence_count,
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
    'reauthorization_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'mapping_status', v_mapping.status,
      'oauth_state_status', v_state.status,
      'recovered_task_count', v_state.recovery_evidence_count,
      'idempotent', false
    ),
    v_state.created_at
  );

  return pg_catalog.jsonb_build_object(
    'stateId', v_state.id,
    'connectionRowVersion', v_state.expected_connection_row_version,
    'credentialId', v_state.superseded_credential_id,
    'credentialVersion', v_state.superseded_credential_version,
    'credentialRowVersion', v_state.expected_credential_row_version,
    'mappingId', v_state.mapping_id,
    'mappingRowVersion', v_state.expected_mapping_row_version,
    'recoveryEvidenceCount', v_state.recovery_evidence_count,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_reauthorization_state_payload_invalid';
end;
$function$;

create or replace function public.read_integration_provider_credential_v3(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_credential private.integration_credentials;
  v_required_scopes text[];
  v_lease_owner_fingerprint bytea;
  v_mapping_id uuid;
  v_minimum_validity_seconds integer;
  v_state text;
  v_now timestamptz := pg_catalog.transaction_timestamp();
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'taskId',
        'leaseId',
        'leaseOwnerFingerprint',
        'expectedCredentialVersion',
        'requiredScopes',
        'minimumValiditySeconds',
        'requestedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_credential_read_v1'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'minimumValiditySeconds') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_payload_invalid';
  end if;

  perform (p_command ->> 'requestedAt')::timestamptz;
  v_minimum_validity_seconds :=
    (p_command ->> 'minimumValiditySeconds')::integer;
  if v_minimum_validity_seconds not between 30 and 900 then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_safety_window_invalid';
  end if;
  v_required_scopes := private.phase_5_text_array_v1(
    p_command -> 'requiredScopes'
  );
  v_lease_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );

  select task.*
  into v_task
  from private.integration_sync_tasks as task
  where task.id = (p_command ->> 'taskId')::uuid
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.queue_class not in ('provider_interactive', 'provider_bulk')
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <> v_lease_owner_fingerprint
    or v_task.lease_expires_at <= v_now
    or v_task.control_metadata -> 'mappingId' = 'null'::jsonb then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;
  v_mapping_id := (v_task.control_metadata ->> 'mappingId')::uuid;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_task.workspace_id
    and connection.business_entity_id = v_task.business_entity_id
    and connection.id = v_task.connection_id
    and connection.connection_generation = v_task.connection_generation
    and connection.provider_key = v_task.provider_key
    and connection.provider_environment = v_task.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_task.workspace_id
    and mapping.business_entity_id = v_task.business_entity_id
    and mapping.connection_id = v_task.connection_id
    and mapping.id = v_mapping_id
    and mapping.provider_key = v_task.provider_key
    and mapping.provider_environment = v_task.provider_environment
    and mapping.status = 'active'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  if not private.is_phase_5_scope_set_v1(v_required_scopes)
    or not private.is_phase_8a0_scope_set_v1(
      v_task.provider_key,
      v_required_scopes
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_task.workspace_id
    and credential.business_entity_id = v_task.business_entity_id
    and credential.connection_id = v_task.connection_id
    and credential.connection_generation = v_task.connection_generation
    and credential.provider_key = v_task.provider_key
    and credential.provider_environment = v_task.provider_environment
    and credential.status = 'active'
  for share;
  if not found
    or v_credential.credential_ciphertext is null
    or not v_required_scopes <@ v_credential.granted_scopes then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  v_state := case
    when v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
      then 'credential_version_stale'
    when v_credential.access_expires_at <= v_now
      + pg_catalog.make_interval(secs => v_minimum_validity_seconds)
      then 'refresh_required'
    else 'available'
  end;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_provider_read',
    case when v_state = 'available' then 'allowed' else 'denied' end,
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    case
      when v_state = 'available' then 'authorized'
      when v_state = 'refresh_required' then 'credential_expired'
      else 'credential_version_stale'
    end,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'task_state', v_task.state
    ),
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'state', v_state,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'providerKey', v_credential.provider_key,
    'providerEnvironment', v_credential.provider_environment,
    'accessExpiresAt', pg_catalog.to_char(
      v_credential.access_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) || case when v_state <> 'available' then '{}'::jsonb else
    pg_catalog.jsonb_build_object(
      'ciphertextBase64', pg_catalog.translate(
        pg_catalog.encode(v_credential.credential_ciphertext, 'base64'),
        E'\n\r',
        ''
      ),
      'aadDigest', private.phase_5_fingerprint_text_v1(
        v_credential.aad_digest
      ),
      'kmsKeyResource', v_credential.kms_key_resource,
      'aadContext', pg_catalog.jsonb_build_object(
        'schemaVersion', v_credential.aad_schema_version,
        'purpose', 'provider_oauth_credential',
        'environment', v_credential.provider_environment,
        'workspaceId', v_credential.workspace_id,
        'connectionId', v_credential.connection_id,
        'connectionGeneration', v_credential.connection_generation,
        'providerKey', v_credential.provider_key,
        'credentialId', v_credential.id
      ),
      'grantedScopes', pg_catalog.to_jsonb(v_credential.granted_scopes)
    ) end;
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_payload_invalid';
end;
$function$;

revoke all on function public.create_integration_reauthorization_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
revoke all on function public.consume_integration_reauthorization_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
revoke all on function public.store_reauthorized_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
revoke all on function public.read_integration_provider_credential_v3(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

grant execute on function public.create_integration_reauthorization_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;
grant execute on function public.consume_integration_reauthorization_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;
grant execute on function public.store_reauthorized_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;
grant execute on function public.read_integration_provider_credential_v3(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function
  private.validate_integration_reauthorization_state_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

commit;
