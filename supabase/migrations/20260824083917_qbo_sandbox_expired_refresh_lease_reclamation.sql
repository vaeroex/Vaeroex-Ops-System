-- Phase 8B expired refresh lease reclamation.
--
-- This forward-only migration adds one credential-broker action that can
-- reclaim an expired refresh lease without representing a refresh outcome.
-- It creates no OAuth state, credential version, provider, queue, or promotion
-- authority.

begin;

create or replace function private.is_integration_expired_refresh_lease_reclamation_metadata_v1(
  p_value jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'connection_generation',
        'credential_version',
        'credential_status',
        'lease_state',
        'refresh_lease_fingerprint',
        'refresh_lease_expired_at',
        'reclaimed_at',
        'reclamation_request_fingerprint',
        'prior_credential_row_version',
        'credential_row_version'
      ]
    )
    and p_value ->> 'connection_generation' ~ '^[1-9][0-9]*$'
    and p_value ->> 'credential_version' ~ '^[1-9][0-9]*$'
    and p_value ->> 'prior_credential_row_version' ~ '^[1-9][0-9]*$'
    and p_value ->> 'credential_row_version' ~ '^[1-9][0-9]*$'
    and (p_value ->> 'credential_row_version')::numeric =
      (p_value ->> 'prior_credential_row_version')::numeric + 1
    and p_value ->> 'credential_status' = 'active'
    and p_value ->> 'lease_state' = 'expired_reclaimed'
    and p_value ->> 'refresh_lease_fingerprint' ~ '^sha256:[0-9a-f]{64}$'
    and p_value ->> 'reclamation_request_fingerprint' ~ '^sha256:[0-9a-f]{64}$'
    and p_value ->> 'refresh_lease_expired_at' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and p_value ->> 'reclaimed_at' ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and p_value ->> 'refresh_lease_expired_at' < p_value ->> 'reclaimed_at'
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (
    (
      action = 'refresh_lease_expired_reclaimed'
      and private.is_integration_expired_refresh_lease_reclamation_metadata_v1(
        metadata
      )
    )
    or (
      action <> 'refresh_lease_expired_reclaimed'
      and private.is_integration_audit_metadata_v8b_recovery_v1(metadata)
      and not metadata ?| array[
        'refresh_lease_fingerprint',
        'refresh_lease_expired_at',
        'reclaimed_at',
        'reclamation_request_fingerprint',
        'prior_credential_row_version',
        'credential_row_version'
      ]
    )
  );

create or replace function private.reject_unleased_integration_credential_refresh_outcome_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'active'
    and old.refresh_lease_id is null
    and new.refresh_lease_id is null
    and new.row_version = old.row_version + 1
    and new.last_request_id is distinct from old.last_request_id
    and (
      old.refresh_expires_at is null
      or old.refresh_expires_at > pg_catalog.clock_timestamp()
    )
    and (
      new.credential_version is distinct from old.credential_version
      or new.status in ('active', 'reauthorization_required')
    )
  then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_refresh_lease_reclaimed';
  end if;
  return new;
end;
$function$;

drop trigger if exists reject_unleased_integration_credential_refresh_outcome_v1
  on private.integration_credentials;
create trigger reject_unleased_integration_credential_refresh_outcome_v1
before update on private.integration_credentials
for each row
execute function private.reject_unleased_integration_credential_refresh_outcome_v1();

create unique index integration_expired_refresh_lease_reclamation_request_key_v1
  on private.integration_audit_events(action, request_id)
  where action = 'refresh_lease_expired_reclaimed'
    and request_id is not null;

create or replace function public.reclaim_integration_expired_refresh_lease_v1(
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
  v_existing private.integration_audit_events;
  v_request_fingerprint bytea;
  v_request_fingerprint_text text;
  v_prior_lease_id uuid;
  v_prior_lease_owner_fingerprint bytea;
  v_prior_lease_acquired_at timestamptz;
  v_prior_lease_expires_at timestamptz;
  v_prior_credential_row_version bigint;
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_connection_id uuid;
  v_connection_generation bigint;
  v_credential_id uuid;
  v_expected_credential_version bigint;
  v_expected_credential_row_version bigint;
  v_reclaimed_at timestamptz := pg_catalog.date_trunc(
    'milliseconds',
    pg_catalog.clock_timestamp()
  );
  v_event_id uuid;
  v_metadata jsonb;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if p_command is null
    or pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or private.is_bounded_identifier_v1(p_request_id) is not true
    or private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'credentialId',
        'expectedCredentialVersion',
        'expectedCredentialRowVersion',
        'providerKey',
        'providerEnvironment',
        'reasonCode'
      ]
    ) is not true
    or pg_catalog.jsonb_typeof(p_command -> 'workspaceId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'businessEntityId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'credentialId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedCredentialVersion') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedCredentialRowVersion') is distinct from 'number'
    or p_command ->> 'contractVersion' is distinct from
      'integration_expired_refresh_lease_reclamation_v1'
    or p_command ->> 'connectionGeneration' is distinct from '1'
    or p_command ->> 'providerKey' is distinct from 'quickbooks_online'
    or p_command ->> 'providerEnvironment' is distinct from 'sandbox'
    or p_command ->> 'reasonCode' is distinct from
      'refresh_lease_expired_reclaimed'
    or p_command ->> 'expectedCredentialVersion' is null
    or p_command ->> 'expectedCredentialVersion' !~ '^[1-9][0-9]*$'
    or p_command ->> 'expectedCredentialRowVersion' is null
    or p_command ->> 'expectedCredentialRowVersion' !~ '^[1-9][0-9]*$'
  then
    raise exception using
      errcode = '22023',
      message = 'integration_expired_refresh_lease_reclamation_payload_invalid';
  end if;

  v_workspace_id := (p_command ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_command ->> 'businessEntityId')::uuid;
  v_connection_id := (p_command ->> 'connectionId')::uuid;
  v_connection_generation :=
    (p_command ->> 'connectionGeneration')::bigint;
  v_credential_id := (p_command ->> 'credentialId')::uuid;
  v_expected_credential_version :=
    (p_command ->> 'expectedCredentialVersion')::bigint;
  v_expected_credential_row_version :=
    (p_command ->> 'expectedCredentialRowVersion')::bigint;
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_request_fingerprint_text := private.phase_5_fingerprint_text_v1(
    v_request_fingerprint
  );

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.id = v_credential_id
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_expired_refresh_lease_reclamation_denied';
  end if;

  -- Recheck after the credential lock so concurrent identical retries replay
  -- the winner instead of failing against its advanced row version.
  select event.*
  into v_existing
  from private.integration_audit_events as event
  where event.action = 'refresh_lease_expired_reclaimed'
    and event.request_id = p_request_id;
  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id = v_business_entity_id
      and v_existing.connection_id = v_connection_id
      and v_existing.target_id = v_credential_id::text
      and v_existing.actor_type = 'service'
      and v_existing.actor_id = 'integration_credential_broker_authority'
      and v_existing.outcome = 'succeeded'
      and v_existing.reason_code = 'refresh_lease_expired_reclaimed'
      and v_existing.metadata ->> 'reclamation_request_fingerprint' =
        v_request_fingerprint_text
      and (v_existing.metadata ->> 'credential_version')::bigint =
        v_expected_credential_version
      and (v_existing.metadata ->> 'prior_credential_row_version')::bigint =
        v_expected_credential_row_version
    then
      return pg_catalog.jsonb_build_object(
        'auditEventId', v_existing.id,
        'credentialId', v_credential_id,
        'credentialVersion',
          (v_existing.metadata ->> 'credential_version')::bigint,
        'credentialStatus', 'active',
        'credentialRowVersion',
          (v_existing.metadata ->> 'credential_row_version')::bigint,
        'leaseState', 'expired_reclaimed',
        'accessExpired', true,
        'reclaimedAt', v_existing.metadata ->> 'reclaimed_at',
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_expired_refresh_lease_reclamation_request_conflict';
  end if;

  if v_credential.workspace_id is distinct from v_workspace_id
    or v_credential.business_entity_id is distinct from v_business_entity_id
    or v_credential.connection_id is distinct from v_connection_id
    or v_credential.connection_generation is distinct from
      v_connection_generation
    or v_credential.provider_key is distinct from 'quickbooks_online'
    or v_credential.provider_environment is distinct from 'sandbox'
  then
    raise exception using
      errcode = '42501',
      message = 'integration_expired_refresh_lease_reclamation_denied';
  end if;
  if v_credential.credential_version is distinct from
      v_expected_credential_version
    or v_credential.row_version is distinct from
      v_expected_credential_row_version
  then
    raise exception using
      errcode = '40001',
      message = 'integration_expired_refresh_lease_reclamation_stale';
  end if;
  if v_credential.status is distinct from 'active'
    or v_credential.granted_scopes is distinct from
      array['com.intuit.quickbooks.accounting']::text[]
    or v_credential.access_expires_at > v_reclaimed_at
    or exists (
      select 1
      from private.integration_credentials as current_credential
      where current_credential.workspace_id = v_credential.workspace_id
        and current_credential.business_entity_id =
          v_credential.business_entity_id
        and current_credential.connection_id = v_credential.connection_id
        and current_credential.connection_generation =
          v_credential.connection_generation
        and current_credential.id <> v_credential.id
        and current_credential.status in (
          'active', 'reauthorization_required'
        )
    )
  then
    raise exception using
      errcode = '55000',
      message = 'integration_expired_refresh_lease_reclamation_ineligible';
  end if;

  begin
    select connection.*
    into v_connection
    from private.integration_connections as connection
    where connection.id = v_credential.connection_id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'integration_expired_refresh_lease_reclamation_connection_busy';
  end;
  if not found
    or v_connection.workspace_id is distinct from v_credential.workspace_id
    or v_connection.business_entity_id is distinct from
      v_credential.business_entity_id
    or v_connection.connection_generation is distinct from
      v_credential.connection_generation
    or v_connection.provider_key is distinct from v_credential.provider_key
    or v_connection.provider_environment is distinct from
      v_credential.provider_environment
    or v_connection.status is distinct from 'initializing'
    or v_connection.state_reason_code is distinct from 'initial_sync_pending'
    or v_connection.disconnected_at is not null
    or v_connection.deleted_at is not null
  then
    raise exception using
      errcode = '55000',
      message = 'integration_expired_refresh_lease_reclamation_connection_ineligible';
  end if;
  if not exists (
      select 1
      from private.provider_entity_mappings as mapping
      where mapping.workspace_id = v_credential.workspace_id
        and mapping.business_entity_id = v_credential.business_entity_id
        and mapping.connection_id = v_credential.connection_id
        and mapping.provider_key = v_credential.provider_key
        and mapping.provider_environment = v_credential.provider_environment
        and mapping.provider_entity_type = 'company'
        and mapping.mapping_role = 'primary'
        and mapping.status = 'active'
        and mapping.provider_entity_reference_fingerprint =
          v_credential.external_entity_reference_fingerprint
    )
    or not exists (
      select 1
      from private.integration_sync_task_recovery_events as recovery
      where recovery.workspace_id = v_credential.workspace_id
        and recovery.business_entity_id = v_credential.business_entity_id
        and recovery.connection_id = v_credential.connection_id
        and recovery.connection_generation = v_credential.connection_generation
        and recovery.credential_id = v_credential.id
        and recovery.credential_version = v_credential.credential_version
    )
  then
    raise exception using
      errcode = '55000',
      message = 'integration_expired_refresh_lease_reclamation_evidence_ineligible';
  end if;
  if v_credential.refresh_lease_id is null then
    raise exception using
      errcode = '55000',
      message = 'integration_expired_refresh_lease_reclamation_lease_missing';
  end if;
  if v_credential.refresh_lease_expires_at >= v_reclaimed_at then
    raise exception using
      errcode = '55000',
      message = 'integration_expired_refresh_lease_reclamation_lease_active';
  end if;

  v_prior_lease_id := v_credential.refresh_lease_id;
  v_prior_lease_owner_fingerprint :=
    v_credential.refresh_lease_owner_fingerprint;
  v_prior_lease_acquired_at := v_credential.refresh_lease_acquired_at;
  v_prior_lease_expires_at := v_credential.refresh_lease_expires_at;
  v_prior_credential_row_version := v_credential.row_version;

  update private.integration_credentials as credential
  set refresh_lease_id = null,
      refresh_lease_owner_fingerprint = null,
      refresh_lease_acquired_at = null,
      refresh_lease_expires_at = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = credential.row_version + 1,
      updated_at = v_reclaimed_at
  where credential.id = v_credential.id
    and credential.status = 'active'
    and credential.row_version = v_prior_credential_row_version
    and credential.refresh_lease_id is not distinct from v_prior_lease_id
    and credential.refresh_lease_owner_fingerprint is not distinct from
      v_prior_lease_owner_fingerprint
    and credential.refresh_lease_acquired_at is not distinct from
      v_prior_lease_acquired_at
    and credential.refresh_lease_expires_at is not distinct from
      v_prior_lease_expires_at
  returning credential.* into v_credential;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'integration_expired_refresh_lease_reclamation_stale';
  end if;

  v_metadata := pg_catalog.jsonb_build_object(
    'connection_generation', v_credential.connection_generation,
    'credential_version', v_credential.credential_version,
    'credential_status', v_credential.status,
    'lease_state', 'expired_reclaimed',
    'refresh_lease_fingerprint', private.phase_5_fingerprint_text_v1(
      extensions.digest(
        pg_catalog.convert_to(v_prior_lease_id::text, 'UTF8'),
        'sha256'
      )
    ),
    'refresh_lease_expired_at', pg_catalog.to_char(
      v_prior_lease_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'reclaimed_at', pg_catalog.to_char(
      v_reclaimed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'reclamation_request_fingerprint', v_request_fingerprint_text,
    'prior_credential_row_version', v_prior_credential_row_version,
    'credential_row_version', v_credential.row_version
  );
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
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker_authority',
    'refresh_lease_expired_reclaimed',
    'succeeded',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'refresh_lease_expired_reclaimed',
    v_metadata,
    v_reclaimed_at,
    'security',
    null,
    v_reclaimed_at
  ) returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'auditEventId', v_event_id,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'credentialRowVersion', v_credential.row_version,
    'leaseState', 'expired_reclaimed',
    'accessExpired', v_credential.access_expires_at <= v_reclaimed_at,
    'reclaimedAt', v_metadata ->> 'reclaimed_at',
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range
  then
    raise exception using
      errcode = '22023',
      message = 'integration_expired_refresh_lease_reclamation_payload_invalid';
end;
$function$;

revoke all on function public.reclaim_integration_expired_refresh_lease_v1(
  jsonb,
  text
) from public, anon, authenticated, service_role,
  external_integrations_authority,
  deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function public.reclaim_integration_expired_refresh_lease_v1(
  jsonb,
  text
) to integration_credential_broker_authority;

revoke all on function private.is_integration_expired_refresh_lease_reclamation_metadata_v1(
  jsonb
) from public, anon, authenticated, service_role,
  external_integrations_authority,
  deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

revoke all on function private.reject_unleased_integration_credential_refresh_outcome_v1()
from public, anon, authenticated, service_role,
  external_integrations_authority,
  deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

commit;
