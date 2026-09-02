-- Phase 8B Cloud Tasks retry/execution identity and QBO credential recovery.
--
-- This forward-only correction preserves every prior delivery, credential, and
-- task artifact. It adds the missing Cloud Tasks retry dimension, redacted
-- refresh diagnostics, and checked evidence paths for legacy delivery identity
-- and a failed qbo_purchase task after a genuine same-generation reauthorization.

begin;

alter table private.integration_sync_tasks
  add column last_delivery_retry_count integer;

create table private.integration_sync_task_delivery_retry_compatibility_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_delivery_retry_compatibility_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  dispatch_generation bigint not null check (dispatch_generation > 0),
  delivery_recovery_event_id uuid not null references
    private.integration_sync_task_delivery_recovery_events(id) on delete restrict,
  observed_delivery_retry_count integer not null check (
    observed_delivery_retry_count between 0 and 100
  ),
  observed_delivery_execution_count integer not null check (
    observed_delivery_execution_count between 0 and observed_delivery_retry_count
  ),
  dispatcher_task_name_fingerprint bytea not null check (
    pg_catalog.octet_length(dispatcher_task_name_fingerprint) = 32
  ),
  external_evidence_fingerprint bytea not null check (
    pg_catalog.octet_length(external_evidence_fingerprint) = 32
  ),
  reason_code text not null check (reason_code = 'retry_identity_attributed'),
  request_id text not null check (private.is_bounded_identifier_v1(request_id)),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  attributed_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_delivery_retry_compatibility_task_key unique (
    task_id, dispatch_generation
  ),
  constraint integration_sync_task_delivery_retry_compatibility_request_key unique (
    request_id, task_id
  ),
  constraint integration_sync_task_delivery_retry_compatibility_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_delivery_retry_compatibility_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_delivery_retry_compatibility_time_check check (
    created_at = attributed_at
  )
);

create table private.integration_sync_task_reauthorization_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_reauthorized_purchase_recovery_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  mapping_id uuid not null,
  superseded_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  replacement_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  replacement_credential_version bigint not null check (
    replacement_credential_version > 1
  ),
  replacement_credential_row_version bigint not null check (
    replacement_credential_row_version > 0
  ),
  prior_state text not null check (prior_state = 'failed'),
  prior_failure_category text not null check (
    prior_failure_category = 'authorization'
  ),
  prior_failure_code text not null check (
    prior_failure_code = 'credential_reauthorization_required'
  ),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_completed_at timestamptz not null,
  prior_dispatch_generation bigint not null check (prior_dispatch_generation > 0),
  prior_dispatcher_task_name_fingerprint bytea check (
    prior_dispatcher_task_name_fingerprint is null
  ),
  prior_delivery_retry_count integer check (
    prior_delivery_retry_count is null
    or prior_delivery_retry_count between 0 and 100
  ),
  prior_delivery_execution_count integer check (
    prior_delivery_execution_count is null
    or prior_delivery_execution_count between 0 and 100
  ),
  prior_delivery_attempt_fingerprint bytea check (
    prior_delivery_attempt_fingerprint is null
    or pg_catalog.octet_length(prior_delivery_attempt_fingerprint) = 32
  ),
  prior_attempt_count integer not null check (prior_attempt_count > 0),
  retry_after_seconds integer not null check (retry_after_seconds between 1 and 3600),
  reason_code text not null check (reason_code = 'credential_reauthorization_completed'),
  request_id text not null check (private.is_bounded_identifier_v1(request_id)),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_reauthorization_recovery_task_key unique (task_id),
  constraint integration_sync_task_reauthorization_recovery_request_key unique (
    request_id, task_id
  ),
  constraint integration_sync_task_reauthorization_recovery_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_reauthorization_recovery_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_reauthorization_recovery_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_reauthorization_recovery_time_check check (
    recovered_at >= prior_completed_at and created_at = recovered_at
  )
);

create or replace function private.is_integration_audit_metadata_v8b_delivery_v2(
  p_value jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_integration_audit_metadata_v8b_recovery_v1(
      p_value - array[
        'delivery_retry_count',
        'delivery_execution_count',
        'refresh_diagnostics',
        'prior_credential_version',
        'replacement_credential_version',
        'prior_dispatch_generation',
        'recovery_reason_code'
      ]::text[]
    )
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

create or replace function public.record_integration_credential_refresh_boundary_v2(
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
  v_existing private.integration_audit_events;
  v_event_id uuid;
  v_occurred_at timestamptz;
  v_outcome text;
  v_operation_fingerprint text;
  v_metadata jsonb;
  v_diagnostics jsonb;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_event,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'credentialId', 'credentialVersion',
        'refreshOperationId', 'actorId', 'stage', 'outcome', 'reasonCode',
        'diagnostics', 'occurredAt'
      ]
    )
    or p_event ->> 'contractVersion' <>
      'integration_credential_refresh_boundary_v2'
    or (p_event ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_event ->> 'credentialVersion') !~ '^[1-9][0-9]*$'
    or not private.is_bounded_identifier_v1(p_event ->> 'actorId')
    or p_event ->> 'stage' not in (
      'broker_decrypt', 'secret_manager_access', 'provider_token_request',
      'provider_response_parse', 'credential_cas'
    )
    or p_event ->> 'outcome' not in ('started', 'succeeded', 'failed')
    or p_event ->> 'reasonCode' not in (
      'started', 'succeeded', 'invalid_grant', 'provider_revoked',
      'provider_transient', 'scope_loss', 'kms_failure',
      'integrity_failure', 'credential_version_stale'
    )
    or ((p_event ->> 'outcome') = 'started') <>
      ((p_event ->> 'reasonCode') = 'started')
    or ((p_event ->> 'outcome') = 'succeeded') <>
      ((p_event ->> 'reasonCode') = 'succeeded')
    or (
      p_event ->> 'outcome' = 'failed'
      and p_event ->> 'reasonCode' in ('started', 'succeeded')
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_refresh_boundary_payload_invalid';
  end if;

  v_diagnostics := p_event -> 'diagnostics';
  if (
      p_event ->> 'stage' <> 'credential_cas'
      and v_diagnostics <> 'null'::jsonb
    ) or (
      p_event ->> 'stage' = 'credential_cas'
      and p_event ->> 'outcome' in ('started', 'succeeded')
      and v_diagnostics = 'null'::jsonb
    ) or (
      v_diagnostics <> 'null'::jsonb
      and (
        pg_catalog.jsonb_typeof(v_diagnostics) <> 'object'
        or not private.jsonb_has_exact_keys_v1(
          v_diagnostics,
          array[
            'returnedRefreshTokenPresent', 'refreshTokenEqualToPrior',
            'accessTokenEqualToPrior', 'envelopeByteLength', 'tokenType',
            'scopeEquivalent', 'accessExpiresInSeconds',
            'refreshExpiresInSeconds'
          ]
        )
        or pg_catalog.jsonb_typeof(
          v_diagnostics -> 'returnedRefreshTokenPresent'
        ) <> 'boolean'
        or pg_catalog.jsonb_typeof(
          v_diagnostics -> 'refreshTokenEqualToPrior'
        ) <> 'boolean'
        or pg_catalog.jsonb_typeof(
          v_diagnostics -> 'accessTokenEqualToPrior'
        ) <> 'boolean'
        or pg_catalog.jsonb_typeof(v_diagnostics -> 'scopeEquivalent') <>
          'boolean'
        or v_diagnostics ->> 'returnedRefreshTokenPresent' <> 'true'
        or v_diagnostics ->> 'tokenType' <> 'bearer'
        or pg_catalog.jsonb_typeof(v_diagnostics -> 'envelopeByteLength') <>
          'number'
        or (v_diagnostics ->> 'envelopeByteLength') !~ '^[1-9][0-9]*$'
        or (v_diagnostics ->> 'envelopeByteLength')::integer not between 1 and 1048576
        or pg_catalog.jsonb_typeof(v_diagnostics -> 'accessExpiresInSeconds') <>
          'number'
        or (v_diagnostics ->> 'accessExpiresInSeconds') !~ '^[1-9][0-9]*$'
        or (v_diagnostics ->> 'accessExpiresInSeconds')::integer not between 1 and 86400
        or (
          v_diagnostics -> 'refreshExpiresInSeconds' <> 'null'::jsonb
          and (
            pg_catalog.jsonb_typeof(
              v_diagnostics -> 'refreshExpiresInSeconds'
            ) <> 'number'
            or (v_diagnostics ->> 'refreshExpiresInSeconds') !~ '^[1-9][0-9]*$'
            or (v_diagnostics ->> 'refreshExpiresInSeconds')::integer
              not between 1 and 31536000
          )
        )
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_refresh_boundary_diagnostics_invalid';
  end if;

  perform (p_event ->> 'workspaceId')::uuid;
  perform (p_event ->> 'businessEntityId')::uuid;
  perform (p_event ->> 'connectionId')::uuid;
  perform (p_event ->> 'credentialId')::uuid;
  perform (p_event ->> 'refreshOperationId')::uuid;
  v_occurred_at := (p_event ->> 'occurredAt')::timestamptz;
  if v_occurred_at < pg_catalog.transaction_timestamp() - interval '5 minutes'
    or v_occurred_at > pg_catalog.transaction_timestamp() + interval '1 minute' then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_refresh_boundary_time_invalid';
  end if;
  v_occurred_at := pg_catalog.transaction_timestamp();
  v_outcome := case p_event ->> 'outcome'
    when 'started' then 'allowed'
    when 'succeeded' then 'succeeded'
    else 'failed'
  end;
  v_operation_fingerprint := private.phase_5_fingerprint_text_v1(
    extensions.digest(
      pg_catalog.convert_to(p_event ->> 'refreshOperationId', 'UTF8'),
      'sha256'
    )
  );
  v_metadata := pg_catalog.jsonb_build_object(
    'connection_generation', (p_event ->> 'connectionGeneration')::bigint,
    'credential_version', (p_event ->> 'credentialVersion')::bigint,
    'refresh_boundary_stage', p_event ->> 'stage',
    'refresh_operation_fingerprint', v_operation_fingerprint,
    'refresh_diagnostics', v_diagnostics
  );

  select event.* into v_existing
  from private.integration_audit_events as event
  where event.action = 'credential_refresh_boundary'
    and event.request_id = p_request_id;
  if found then
    if v_existing.workspace_id = (p_event ->> 'workspaceId')::uuid
      and v_existing.business_entity_id = (p_event ->> 'businessEntityId')::uuid
      and v_existing.connection_id = (p_event ->> 'connectionId')::uuid
      and v_existing.target_id = p_event ->> 'credentialId'
      and v_existing.actor_id = p_event ->> 'actorId'
      and v_existing.outcome = v_outcome
      and v_existing.reason_code = p_event ->> 'reasonCode'
      and v_existing.metadata = v_metadata then
      return pg_catalog.jsonb_build_object(
        'eventId', v_existing.id,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_credential_refresh_boundary_request_conflict';
  end if;

  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.id = (p_event ->> 'credentialId')::uuid
    and credential.workspace_id = (p_event ->> 'workspaceId')::uuid
    and credential.business_entity_id = (p_event ->> 'businessEntityId')::uuid
    and credential.connection_id = (p_event ->> 'connectionId')::uuid
    and credential.connection_generation =
      (p_event ->> 'connectionGeneration')::bigint
  for share;
  if not found or not (
    (
      p_event ->> 'stage' = 'credential_cas'
      and p_event ->> 'outcome' = 'succeeded'
      and v_credential.credential_version =
        (p_event ->> 'credentialVersion')::bigint + 1
      and v_credential.refresh_lease_id is null
    )
    or (
      v_credential.credential_version =
        (p_event ->> 'credentialVersion')::bigint
      and v_credential.refresh_lease_id =
        (p_event ->> 'refreshOperationId')::uuid
      and v_credential.refresh_lease_expires_at > v_occurred_at
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_refresh_boundary_denied';
  end if;

  insert into private.integration_audit_events (
    workspace_id, business_entity_id, connection_id,
    actor_type, actor_id, action, outcome, target_type, target_id,
    request_id, reason_code, metadata, occurred_at, retention_class
  ) values (
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    p_event ->> 'actorId',
    'credential_refresh_boundary',
    v_outcome,
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    p_event ->> 'reasonCode',
    v_metadata,
    v_occurred_at,
    'security'
  ) returning id into v_event_id;
  return pg_catalog.jsonb_build_object(
    'eventId', v_event_id,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_refresh_boundary_payload_invalid';
end;
$function$;

create or replace function public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_workspace_id uuid;
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_replacement private.integration_credentials;
  v_superseded private.integration_credentials;
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_sync_run_id uuid;
  v_request_fingerprint bytea;
  v_existing record;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'credentialId', 'expectedCredentialVersion',
        'expectedCredentialRowVersion', 'mappingId',
        'expectedMappingRowVersion', 'taskId', 'expectedTaskRowVersion',
        'retryAfterSeconds'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_reauthorized_purchase_recovery_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedCredentialVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedCredentialRowVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedMappingRowVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedTaskRowVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'retryAfterSeconds') <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedMappingRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedTaskRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds')::integer not between 1 and 3600 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_invalid';
  end if;

  v_workspace_id := (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'credentialId')::uuid;
  perform (p_command ->> 'mappingId')::uuid;
  perform (p_command ->> 'taskId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_sandbox_reauthorized_purchase_recovery:' || p_request_id,
      0
    )
  );

  select event.* into v_existing
  from private.integration_sync_task_reauthorization_recovery_events as event
  where event.request_id = p_request_id;
  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id =
        (p_command ->> 'businessEntityId')::uuid
      and v_existing.connection_id = (p_command ->> 'connectionId')::uuid
      and v_existing.connection_generation =
        (p_command ->> 'connectionGeneration')::bigint
      and v_existing.replacement_credential_id =
        (p_command ->> 'credentialId')::uuid
      and v_existing.replacement_credential_version =
        (p_command ->> 'expectedCredentialVersion')::bigint
      and v_existing.replacement_credential_row_version =
        (p_command ->> 'expectedCredentialRowVersion')::bigint
      and v_existing.mapping_id = (p_command ->> 'mappingId')::uuid
      and v_existing.task_id = (p_command ->> 'taskId')::uuid
      and v_existing.prior_row_version =
        (p_command ->> 'expectedTaskRowVersion')::bigint
      and v_existing.retry_after_seconds =
        (p_command ->> 'retryAfterSeconds')::integer
      and v_existing.request_fingerprint = v_request_fingerprint
      and v_existing.actor_id = p_actor_id then
      return pg_catalog.jsonb_build_object(
        'taskId', v_existing.task_id,
        'recoveredAt', v_existing.recovered_at,
        'state', 'retry_wait',
        'rowVersion', v_existing.prior_row_version + 1,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_conflict';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_workspace_id
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_denied';
  end if;

  select credential.* into v_replacement
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'credentialId')::uuid
    and credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
  for update;
  if not found
    or v_replacement.status <> 'active'
    or v_replacement.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_replacement.row_version <>
      (p_command ->> 'expectedCredentialRowVersion')::bigint
    or v_replacement.reauthorization_state_id is null
    or v_replacement.supersedes_credential_id is null
    or v_replacement.credential_version <= 1
    or v_replacement.credential_ciphertext is null
    or v_replacement.granted_scopes <>
      array['com.intuit.quickbooks.accounting']::text[]
    or v_replacement.external_entity_reference_fingerprint is null
    or v_replacement.access_expires_at <= v_now + interval '30 seconds'
    or (
      v_replacement.refresh_expires_at is not null
      and v_replacement.refresh_expires_at <= v_now
    )
    or v_replacement.refresh_lease_id is not null
    or v_replacement.refresh_lease_owner_fingerprint is not null
    or v_replacement.refresh_lease_acquired_at is not null
    or v_replacement.refresh_lease_expires_at is not null then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_credential_denied';
  end if;

  select credential.* into v_superseded
  from private.integration_credentials as credential
  where credential.id = v_replacement.supersedes_credential_id
    and credential.workspace_id = v_replacement.workspace_id
    and credential.business_entity_id = v_replacement.business_entity_id
    and credential.connection_id = v_replacement.connection_id
    and credential.connection_generation = v_replacement.connection_generation
    and credential.provider_key = v_replacement.provider_key
    and credential.provider_environment = v_replacement.provider_environment
  for share;
  if not found
    or v_superseded.status <> 'superseded'
    or v_superseded.superseded_at is null
    or v_superseded.credential_version >= v_replacement.credential_version then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_chain_denied';
  end if;

  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_replacement.workspace_id
      and audit.business_entity_id = v_replacement.business_entity_id
      and audit.connection_id = v_replacement.connection_id
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_replacement.id::text
      and audit.reason_code in ('invalid_grant', 'provider_revoked')
      and audit.occurred_at >= v_replacement.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_revoked';
  end if;

  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = v_connection.provider_key
    and mapping.provider_environment = v_connection.provider_environment
  for share;
  if not found
    or v_mapping.status <> 'active'
    or v_mapping.row_version <>
      (p_command ->> 'expectedMappingRowVersion')::bigint
    or v_mapping.provider_entity_reference_fingerprint <>
      v_replacement.external_entity_reference_fingerprint then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_mapping_denied';
  end if;

  select task.sync_run_id into v_sync_run_id
  from private.integration_sync_tasks as task
  where task.id = (p_command ->> 'taskId')::uuid
    and task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.id = v_sync_run_id
    and run.connection_generation = v_connection.connection_generation
  for update;
  if not found
    or v_run.state <> 'running'
    or v_run.mode <> 'initialization'
    or v_run.mapping_id <> v_mapping.id then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_run_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.id = (p_command ->> 'taskId')::uuid
    and task.sync_run_id = v_run.id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.stream_key = 'qbo_purchase'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
  for update;
  if not found
    or v_task.row_version <> (p_command ->> 'expectedTaskRowVersion')::bigint
    or v_task.state <> 'failed'
    or v_task.failure_category <> 'authorization'
    or v_task.failure_code <> 'credential_reauthorization_required'
    or v_task.completed_at is null
    or v_task.durable_effect_fingerprint is not null
    or v_task.attempt_count >= v_task.maximum_attempts
    or v_task.lease_id is not null
    or v_task.lease_owner_fingerprint is not null
    or v_task.lease_expires_at is not null
    or v_task.heartbeat_at is not null
    or v_task.dispatcher_task_name is not null
    or v_task.dispatch_generation < 1
    or not exists (
      select 1
      from private.integration_audit_events as audit
      where audit.workspace_id = v_task.workspace_id
        and audit.business_entity_id = v_task.business_entity_id
        and audit.connection_id = v_task.connection_id
        and audit.action = 'integration_sync_task.fail'
        and audit.outcome = 'failed'
        and audit.target_type = 'integration_sync_task'
        and audit.target_id = v_task.id::text
        and audit.occurred_at = v_task.completed_at
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_task_denied';
  end if;

  insert into private.integration_sync_task_reauthorization_recovery_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, task_id, mapping_id,
    superseded_credential_id, replacement_credential_id,
    replacement_credential_version, replacement_credential_row_version,
    prior_state, prior_failure_category, prior_failure_code,
    prior_row_version, prior_completed_at, prior_dispatch_generation,
    prior_dispatcher_task_name_fingerprint, prior_delivery_retry_count,
    prior_delivery_execution_count, prior_delivery_attempt_fingerprint,
    prior_attempt_count, retry_after_seconds, reason_code, request_id,
    request_fingerprint, actor_id, recovered_at, created_at
  ) values (
    'qbo_sandbox_reauthorized_purchase_recovery_v1',
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    v_task.connection_generation, v_task.sync_run_id, v_task.id, v_mapping.id,
    v_superseded.id, v_replacement.id, v_replacement.credential_version,
    v_replacement.row_version, v_task.state, v_task.failure_category,
    v_task.failure_code, v_task.row_version, v_task.completed_at,
    v_task.dispatch_generation,
    null,
    v_task.last_delivery_retry_count,
    v_task.last_delivery_execution_count,
    v_task.last_delivery_attempt_fingerprint,
    v_task.attempt_count,
    (p_command ->> 'retryAfterSeconds')::integer,
    'credential_reauthorization_completed', p_request_id,
    v_request_fingerprint, p_actor_id, v_now, v_now
  );

  update private.integration_sync_tasks as task
  set state = 'retry_wait',
      available_at = v_now + pg_catalog.make_interval(
        secs => (p_command ->> 'retryAfterSeconds')::integer
      ),
      failure_category = null,
      failure_code = null,
      completed_at = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
  where task.id = v_task.id
    and task.row_version = v_task.row_version
  returning task.* into v_task;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.reauthorization_recover', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'prior_dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'prior_credential_version', v_superseded.credential_version,
      'replacement_credential_version', v_replacement.credential_version,
      'recovery_reason_code', 'credential_reauthorization_completed',
      'idempotent', false
    )
  );
  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'recoveredAt', v_now,
    'state', v_task.state,
    'rowVersion', v_task.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_reauthorized_purchase_recovery_invalid';
end;
$function$;

create or replace function public.recover_qbo_sandbox_delivery_retry_compatibility_v1(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_connection private.integration_connections;
  v_task private.integration_sync_tasks;
  v_delivery_recovery private.integration_sync_task_delivery_recovery_events;
  v_observation jsonb;
  v_observations jsonb;
  v_request_fingerprint bytea;
  v_requested_count integer;
  v_existing_count integer;
  v_existing_at timestamptz;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'observations'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_delivery_retry_compatibility_v1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or pg_catalog.jsonb_typeof(p_command -> 'observations') <> 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'observations') not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_delivery_retry_compatibility_invalid';
  end if;

  select pg_catalog.jsonb_agg(item.value order by item.value ->> 'taskId')
  into v_observations
  from pg_catalog.jsonb_array_elements(p_command -> 'observations') as item(value);
  v_requested_count := pg_catalog.jsonb_array_length(v_observations);
  if (
    select pg_catalog.count(distinct item.value ->> 'taskId')
    from pg_catalog.jsonb_array_elements(v_observations) as item(value)
  ) <> v_requested_count then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_delivery_retry_compatibility_invalid';
  end if;
  for v_observation in
    select item.value
    from pg_catalog.jsonb_array_elements(v_observations) as item(value)
  loop
    if not private.jsonb_has_exact_keys_v1(
        v_observation,
        array[
          'taskId', 'expectedRowVersion', 'dispatcherTaskName',
          'deliveryDispatchGeneration', 'observedDeliveryRetryCount',
          'observedDeliveryExecutionCount', 'externalEvidenceFingerprint'
        ]
      )
      or pg_catalog.jsonb_typeof(v_observation -> 'expectedRowVersion') <> 'number'
      or pg_catalog.jsonb_typeof(v_observation -> 'deliveryDispatchGeneration') <> 'number'
      or pg_catalog.jsonb_typeof(v_observation -> 'observedDeliveryRetryCount') <> 'number'
      or pg_catalog.jsonb_typeof(v_observation -> 'observedDeliveryExecutionCount') <> 'number'
      or (v_observation ->> 'expectedRowVersion') !~ '^[1-9][0-9]*$'
      or (v_observation ->> 'deliveryDispatchGeneration') !~ '^[1-9][0-9]*$'
      or (v_observation ->> 'observedDeliveryRetryCount') !~ '^(0|[1-9][0-9]*)$'
      or (v_observation ->> 'observedDeliveryExecutionCount') !~ '^(0|[1-9][0-9]*)$'
      or (v_observation ->> 'observedDeliveryRetryCount')::integer not between 0 and 100
      or (v_observation ->> 'observedDeliveryExecutionCount')::integer not between 0 and 100
      or (v_observation ->> 'observedDeliveryExecutionCount')::integer >
        (v_observation ->> 'observedDeliveryRetryCount')::integer
      or v_observation ->> 'dispatcherTaskName' !~ '^[a-f0-9]{64}$'
      or v_observation ->> 'externalEvidenceFingerprint' !~ '^sha256:[a-f0-9]{64}$' then
      raise exception using
        errcode = '22023',
        message = 'qbo_sandbox_delivery_retry_compatibility_invalid';
    end if;
  end loop;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    pg_catalog.jsonb_set(p_command, '{observations}', v_observations, false)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_sandbox_delivery_retry_compatibility:' || p_request_id,
      0
    )
  );
  select
    pg_catalog.count(*)::integer,
    pg_catalog.max(event.attributed_at)
  into v_existing_count, v_existing_at
  from private.integration_sync_task_delivery_retry_compatibility_events as event
  where event.request_id = p_request_id
    and event.request_fingerprint = v_request_fingerprint
    and event.actor_id = p_actor_id;
  if v_existing_count > 0 then
    if v_existing_count = v_requested_count then
      return pg_catalog.jsonb_build_object(
        'recoveredTaskCount', v_existing_count,
        'recoveredAt', v_existing_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_delivery_retry_compatibility_conflict';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in (
      'initializing', 'active', 'degraded', 'reauthorization_required'
    )
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_delivery_retry_compatibility_denied';
  end if;

  for v_observation in
    select item.value
    from pg_catalog.jsonb_array_elements(v_observations) as item(value)
  loop
    select task.* into v_task
    from private.integration_sync_tasks as task
    where task.workspace_id = v_connection.workspace_id
      and task.business_entity_id = v_connection.business_entity_id
      and task.connection_id = v_connection.id
      and task.connection_generation = v_connection.connection_generation
      and task.id = (v_observation ->> 'taskId')::uuid
      and task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
      and task.delivery_attribution_state <> 'legacy_unattributed'
    for update;
    if not found
      or v_task.row_version <> (v_observation ->> 'expectedRowVersion')::bigint
      or v_task.dispatch_generation <>
        (v_observation ->> 'deliveryDispatchGeneration')::bigint
      or v_task.dispatcher_task_name <> v_observation ->> 'dispatcherTaskName'
      or v_task.state <> 'dispatched'
      or v_task.lease_id is not null
      or v_task.durable_effect_fingerprint is not null then
      raise exception using
        errcode = '40001',
        message = 'qbo_sandbox_delivery_retry_compatibility_stale';
    end if;

    select recovery.* into v_delivery_recovery
    from private.integration_sync_task_delivery_recovery_events as recovery
    where recovery.workspace_id = v_task.workspace_id
      and recovery.business_entity_id = v_task.business_entity_id
      and recovery.connection_id = v_task.connection_id
      and recovery.connection_generation = v_task.connection_generation
      and recovery.task_id = v_task.id
      and recovery.dispatch_generation = v_task.dispatch_generation
      and recovery.observed_delivery_execution_count =
        (v_observation ->> 'observedDeliveryExecutionCount')::integer
      and recovery.dispatcher_task_name_fingerprint = extensions.digest(
        pg_catalog.convert_to(v_task.dispatcher_task_name, 'UTF8'),
        'sha256'
      )
      and recovery.reason_code = 'rejected_before_lease';
    if not found then
      raise exception using
        errcode = '42501',
        message = 'qbo_sandbox_delivery_retry_compatibility_evidence_denied';
    end if;

    insert into private.integration_sync_task_delivery_retry_compatibility_events (
      contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, sync_run_id, task_id, dispatch_generation,
      delivery_recovery_event_id, observed_delivery_retry_count,
      observed_delivery_execution_count, dispatcher_task_name_fingerprint,
      external_evidence_fingerprint, reason_code, request_id,
      request_fingerprint, actor_id, attributed_at, created_at
    ) values (
      'qbo_sandbox_delivery_retry_compatibility_v1',
      v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
      v_task.connection_generation, v_task.sync_run_id, v_task.id,
      v_task.dispatch_generation, v_delivery_recovery.id,
      (v_observation ->> 'observedDeliveryRetryCount')::integer,
      (v_observation ->> 'observedDeliveryExecutionCount')::integer,
      v_delivery_recovery.dispatcher_task_name_fingerprint,
      pg_catalog.decode(
        pg_catalog.substr(v_observation ->> 'externalEvidenceFingerprint', 8),
        'hex'
      ),
      'retry_identity_attributed', p_request_id, v_request_fingerprint,
      p_actor_id, v_now, v_now
    );
    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
      p_actor_id, 'integration_sync_task.delivery_retry_attribute', 'succeeded',
      'integration_sync_task', v_task.id::text, p_request_id,
      pg_catalog.jsonb_build_object(
        'task_state', v_task.state,
        'task_kind', v_task.task_kind,
        'queue_class', v_task.queue_class,
        'attempt_count', v_task.attempt_count,
        'dispatch_generation', v_task.dispatch_generation,
        'delivery_retry_count',
          (v_observation ->> 'observedDeliveryRetryCount')::integer,
        'delivery_execution_count',
          (v_observation ->> 'observedDeliveryExecutionCount')::integer,
        'row_version', v_task.row_version,
        'idempotent', false
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_requested_count,
    'recoveredAt', v_now,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_delivery_retry_compatibility_invalid';
end;
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
      and private.is_integration_audit_metadata_v8b_delivery_v2(metadata)
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

alter table private.integration_sync_tasks
  drop constraint integration_sync_tasks_delivery_check;
alter table private.integration_sync_tasks
  add constraint integration_sync_tasks_delivery_check check (
    (
      delivery_attribution_state = 'none'
      and last_delivery_retry_count is null
      and last_delivery_execution_count is null
      and last_delivery_attempt_fingerprint is null
      and last_delivery_dispatch_generation is null
    )
    or (
      delivery_attribution_state = 'attributed'
      and (
        last_delivery_retry_count is null
        or last_delivery_retry_count between 0 and 100
      )
      and last_delivery_execution_count is not null
      and last_delivery_execution_count between 0 and 100
      and (
        last_delivery_retry_count is null
        or last_delivery_execution_count <= last_delivery_retry_count
      )
      and last_delivery_attempt_fingerprint is not null
      and pg_catalog.octet_length(last_delivery_attempt_fingerprint) = 32
      and last_delivery_dispatch_generation is not null
      and last_delivery_dispatch_generation between 1 and dispatch_generation
    )
    or (
      delivery_attribution_state = 'legacy_unattributed'
      and last_delivery_retry_count is null
      and last_delivery_execution_count is not null
      and last_delivery_execution_count between 0 and 100
      and last_delivery_attempt_fingerprint is not null
      and pg_catalog.octet_length(last_delivery_attempt_fingerprint) = 32
      and last_delivery_dispatch_generation is null
    )
  );

comment on column private.integration_sync_tasks.last_delivery_retry_count is
  'Zero-based Cloud Tasks retry count. NULL preserves pre-correction evidence only; every newly accepted delivery persists retry and execution together.';

alter table private.integration_sync_task_delivery_retry_compatibility_events
  enable row level security;
alter table private.integration_sync_task_delivery_retry_compatibility_events
  force row level security;
revoke all on table private.integration_sync_task_delivery_retry_compatibility_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
create trigger reject_integration_sync_task_delivery_retry_compatibility_mutation_v1
before update or delete
on private.integration_sync_task_delivery_retry_compatibility_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();

alter table private.integration_sync_task_reauthorization_recovery_events
  enable row level security;
alter table private.integration_sync_task_reauthorization_recovery_events
  force row level security;
revoke all on table private.integration_sync_task_reauthorization_recovery_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
create trigger reject_integration_sync_task_reauthorization_recovery_mutation_v1
before update or delete
on private.integration_sync_task_reauthorization_recovery_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function public.read_qbo_sandbox_runtime_task_delivery_v1(
  p_task_id uuid,
  p_dispatcher_task_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
  v_credential private.integration_credentials;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if p_dispatcher_task_name is null
    or p_dispatcher_task_name !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_runtime_delivery_payload_invalid';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.id = p_task_id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
    and task.dispatch_generation > 0
    and task.delivery_attribution_state <> 'legacy_unattributed'
    and task.dispatcher_task_name = p_dispatcher_task_name;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_runtime_delivery_denied';
  end if;

  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_task.workspace_id
    and credential.business_entity_id = v_task.business_entity_id
    and credential.connection_id = v_task.connection_id
    and credential.connection_generation = v_task.connection_generation
    and credential.provider_key = v_task.provider_key
    and credential.provider_environment = v_task.provider_environment
    and credential.status = 'active';
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_runtime_delivery_credential_denied';
  end if;

  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'workspaceId', v_task.workspace_id,
    'businessEntityId', v_task.business_entity_id,
    'connectionId', v_task.connection_id,
    'connectionGeneration', v_task.connection_generation,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'dispatchGeneration', v_task.dispatch_generation,
    'state', v_task.state,
    'rowVersion', v_task.row_version
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_runtime_delivery_payload_invalid';
end;
$function$;

create or replace function private.validate_integration_sync_task_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.workspace_id, new.business_entity_id,
    new.connection_id, new.connection_generation, new.sync_run_id,
    new.parent_task_id, new.provider_key, new.provider_environment,
    new.queue_class, new.task_kind, new.stream_key, new.priority,
    new.control_metadata, new.idempotency_fingerprint,
    new.coalescing_fingerprint, new.maximum_attempts, new.created_at,
    new.retention_expires_at
  ) is distinct from (
    old.id, old.contract_version, old.workspace_id, old.business_entity_id,
    old.connection_id, old.connection_generation, old.sync_run_id,
    old.parent_task_id, old.provider_key, old.provider_environment,
    old.queue_class, old.task_kind, old.stream_key, old.priority,
    old.control_metadata, old.idempotency_fingerprint,
    old.coalescing_fingerprint, old.maximum_attempts, old.created_at,
    old.retention_expires_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_identity_immutable';
  end if;

  if old.delivery_attribution_state = 'legacy_unattributed' then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_attribution_unresolved';
  end if;

  if old.state in ('succeeded', 'failed', 'dead_letter', 'cancelled') then
    if old.state = 'failed'
      and old.durable_effect_fingerprint is null
      and new.state = 'retry_wait'
      and new.failure_category is null
      and new.failure_code is null
      and new.completed_at is null
      and new.row_version = old.row_version + 1
      and new.updated_at >= old.updated_at
      and new.available_at >= new.updated_at
      and (
        new.dispatcher_task_name,
        new.dispatch_generation,
        new.delivery_attribution_state,
        new.last_delivery_dispatch_generation,
        new.last_delivery_retry_count,
        new.last_delivery_execution_count,
        new.last_delivery_attempt_fingerprint,
        new.attempt_count,
        new.lease_id,
        new.lease_owner_fingerprint,
        new.lease_expires_at,
        new.heartbeat_at,
        new.cancel_requested_at,
        new.durable_effect_fingerprint
      ) is not distinct from (
        old.dispatcher_task_name,
        old.dispatch_generation,
        old.delivery_attribution_state,
        old.last_delivery_dispatch_generation,
        old.last_delivery_retry_count,
        old.last_delivery_execution_count,
        old.last_delivery_attempt_fingerprint,
        old.attempt_count,
        old.lease_id,
        old.lease_owner_fingerprint,
        old.lease_expires_at,
        old.heartbeat_at,
        old.cancel_requested_at,
        old.durable_effect_fingerprint
      )
      and (
        (
          old.failure_category = 'contract'
          and old.failure_code = 'phase8b_provider_task_failed'
          and exists (
            select 1
            from private.integration_sync_task_recovery_events as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
        or (
          old.failure_category = 'authorization'
          and old.failure_code = 'credential_reauthorization_required'
          and old.stream_key = 'qbo_purchase'
          and exists (
            select 1
            from private.integration_sync_task_reauthorization_recovery_events
              as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
      ) then
      return new;
    end if;
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_terminal_immutable';
  end if;

  if not private.is_phase_6_task_transition_v1(old.state, new.state)
    or new.row_version <> old.row_version + 1
    or new.attempt_count < old.attempt_count
    or new.dispatch_generation < old.dispatch_generation
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_mutation_invalid';
  end if;

  if (
    new.delivery_attribution_state,
    new.last_delivery_dispatch_generation,
    new.last_delivery_retry_count,
    new.last_delivery_execution_count,
    new.last_delivery_attempt_fingerprint
  ) is distinct from (
    old.delivery_attribution_state,
    old.last_delivery_dispatch_generation,
    old.last_delivery_retry_count,
    old.last_delivery_execution_count,
    old.last_delivery_attempt_fingerprint
  ) and (
    new.delivery_attribution_state <> 'attributed'
    or new.last_delivery_dispatch_generation is null
    or new.last_delivery_dispatch_generation <> new.dispatch_generation
    or new.last_delivery_retry_count is null
    or new.last_delivery_execution_count is null
    or new.last_delivery_execution_count > new.last_delivery_retry_count
    or new.last_delivery_attempt_fingerprint is null
    or (
      old.delivery_attribution_state = 'attributed'
      and old.last_delivery_dispatch_generation = new.last_delivery_dispatch_generation
      and (
        new.last_delivery_attempt_fingerprint = old.last_delivery_attempt_fingerprint
        or (
          old.last_delivery_retry_count is not null
          and (
            new.last_delivery_retry_count <= old.last_delivery_retry_count
            or new.last_delivery_execution_count < old.last_delivery_execution_count
          )
        )
        or (
          old.last_delivery_retry_count is null
          and not exists (
            select 1
            from private.integration_sync_task_delivery_retry_compatibility_events
              as compatibility
            where compatibility.workspace_id = old.workspace_id
              and compatibility.business_entity_id = old.business_entity_id
              and compatibility.connection_id = old.connection_id
              and compatibility.connection_generation = old.connection_generation
              and compatibility.task_id = old.id
              and compatibility.dispatch_generation =
                new.last_delivery_dispatch_generation
              and compatibility.observed_delivery_retry_count <
                new.last_delivery_retry_count
              and compatibility.observed_delivery_execution_count <=
                new.last_delivery_execution_count
          )
        )
      )
    )
    or (
      (
        old.delivery_attribution_state = 'none'
        or old.last_delivery_dispatch_generation <
          new.last_delivery_dispatch_generation
      )
      and (
        new.last_delivery_retry_count <> 0
        or new.last_delivery_execution_count <> 0
      )
      and not exists (
        select 1
        from private.integration_sync_task_delivery_retry_compatibility_events
          as compatibility
        where compatibility.workspace_id = old.workspace_id
          and compatibility.business_entity_id = old.business_entity_id
          and compatibility.connection_id = old.connection_id
          and compatibility.connection_generation = old.connection_generation
          and compatibility.task_id = old.id
          and compatibility.dispatch_generation =
            new.last_delivery_dispatch_generation
          and compatibility.observed_delivery_retry_count <
            new.last_delivery_retry_count
          and compatibility.observed_delivery_execution_count <=
            new.last_delivery_execution_count
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_evidence_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.lease_integration_sync_task_v1(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_connection private.integration_connections;
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_policy private.integration_workspace_policies;
  v_request_fingerprint bytea;
  v_delivery_fingerprint bytea;
  v_lease_owner_fingerprint bytea;
  v_sync_run_id uuid;
  v_workspace_active integer;
  v_connection_active integer;
  v_provider_active integer;
  v_delivery_dispatch_generation bigint;
  v_delivery_retry_count integer;
  v_delivery_execution_count integer;
  v_baseline_retry_count integer;
  v_baseline_execution_count integer;
begin
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'workerKind', 'leaseId', 'leaseOwnerFingerprint', 'leaseSeconds',
        'dispatcherTaskName', 'deliveryDispatchGeneration',
        'deliveryRetryCount', 'deliveryExecutionCount',
        'deliveryAttemptFingerprint'
      ]
    )
    or p_command ->> 'workerKind' not in (
      'provider_runtime', 'deterministic_runtime'
    )
    or pg_catalog.jsonb_typeof(p_command -> 'leaseSeconds') <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'deliveryDispatchGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'deliveryRetryCount') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'deliveryExecutionCount') <> 'number'
    or (p_command ->> 'leaseSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'deliveryDispatchGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'deliveryRetryCount') !~ '^(0|[1-9][0-9]*)$'
    or (p_command ->> 'deliveryExecutionCount') !~ '^(0|[1-9][0-9]*)$'
    or (p_command ->> 'leaseSeconds')::integer not between 30 and 900
    or (p_command ->> 'deliveryRetryCount')::integer not between 0 and 100
    or (p_command ->> 'deliveryExecutionCount')::integer not between 0 and 100
    or (p_command ->> 'deliveryExecutionCount')::integer >
      (p_command ->> 'deliveryRetryCount')::integer
    or pg_catalog.octet_length(p_command ->> 'dispatcherTaskName')
      not between 1 and 1024
    or p_command ->> 'deliveryAttemptFingerprint' !~ '^sha256:[a-f0-9]{64}$'
    or p_command ->> 'leaseOwnerFingerprint' !~ '^sha256:[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
  end if;

  v_delivery_dispatch_generation :=
    (p_command ->> 'deliveryDispatchGeneration')::bigint;
  v_delivery_retry_count := (p_command ->> 'deliveryRetryCount')::integer;
  v_delivery_execution_count :=
    (p_command ->> 'deliveryExecutionCount')::integer;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_delivery_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'deliveryAttemptFingerprint'
  );
  v_lease_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );

  select task.sync_run_id into v_sync_run_id
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.id = (p_command ->> 'taskId')::uuid;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or v_connection.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_connection.status not in ('initializing', 'active', 'degraded') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_connection.provider_key || ':' || v_connection.provider_environment,
      0
    )
  );

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.id = v_sync_run_id
  for update;
  if not found
    or v_run.connection_generation <> v_connection.connection_generation
    or v_run.state <> 'running' then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;
  perform private.assert_phase_6_worker_for_queue_v1(v_task.queue_class);
  if ((v_task.queue_class = 'deterministic_intelligence') <>
      (p_command ->> 'workerKind' = 'deterministic_runtime')) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_worker_boundary_denied';
  end if;
  if v_task.delivery_attribution_state = 'legacy_unattributed' then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_attribution_unresolved';
  end if;
  if v_delivery_dispatch_generation <> v_task.dispatch_generation then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_lease_stale';
  end if;

  if v_task.delivery_attribution_state = 'attributed'
    and v_task.last_delivery_dispatch_generation = v_task.dispatch_generation
    and v_task.last_delivery_retry_count is not null then
    v_baseline_retry_count := v_task.last_delivery_retry_count;
    v_baseline_execution_count := v_task.last_delivery_execution_count;
  else
    select
      compatibility.observed_delivery_retry_count,
      compatibility.observed_delivery_execution_count
    into v_baseline_retry_count, v_baseline_execution_count
    from private.integration_sync_task_delivery_retry_compatibility_events
      as compatibility
    where compatibility.workspace_id = v_task.workspace_id
      and compatibility.business_entity_id = v_task.business_entity_id
      and compatibility.connection_id = v_task.connection_id
      and compatibility.connection_generation = v_task.connection_generation
      and compatibility.task_id = v_task.id
      and compatibility.dispatch_generation = v_task.dispatch_generation;
  end if;

  if v_task.state = 'succeeded' then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object(
        'acquired', false,
        'terminalReplay', true,
        'reasonCode', 'terminal_replay'
      );
  end if;
  if v_baseline_retry_count is not null
    and v_delivery_retry_count = v_baseline_retry_count
    and v_delivery_execution_count = v_baseline_execution_count then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object(
        'acquired', false,
        'terminalReplay', false,
        'reasonCode', 'delivery_replayed'
      );
  end if;
  if v_task.state = 'leased' then
    return private.phase_6_task_result_v1(v_task, false) ||
      pg_catalog.jsonb_build_object(
        'acquired', false,
        'terminalReplay', false,
        'reasonCode', 'lease_held'
      );
  end if;
  if v_task.state <> 'dispatched'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.dispatcher_task_name <> p_command ->> 'dispatcherTaskName'
    or (
      v_baseline_retry_count is null
      and (v_delivery_retry_count <> 0 or v_delivery_execution_count <> 0)
    )
    or (
      v_baseline_retry_count is not null
      and (
        v_delivery_retry_count <= v_baseline_retry_count
        or v_delivery_execution_count < v_baseline_execution_count
      )
    )
    or (
      v_task.delivery_attribution_state = 'attributed'
      and v_task.last_delivery_dispatch_generation = v_task.dispatch_generation
      and v_task.last_delivery_retry_count is null
      and v_baseline_retry_count is null
    )
    or v_delivery_fingerprint = v_task.last_delivery_attempt_fingerprint then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_lease_stale';
  end if;

  select policy.* into v_policy
  from private.integration_workspace_policies as policy
  where policy.workspace_id = v_task.workspace_id
    and policy.provider_key = v_task.provider_key
    and policy.provider_environment = v_task.provider_environment
  for share;
  if not found or v_policy.state <> 'enabled' or not v_policy.sync_enabled then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_policy_denied';
  end if;

  if exists (
    select 1
    from private.integration_runtime_circuits as circuit
    where circuit.state = 'open'
      and circuit.open_until > v_now
      and circuit.circuit_scope in (
        case when v_task.queue_class = 'deterministic_intelligence'
          then 'deterministic_integrity' else 'provider_api' end,
        'queue_runtime'
      )
      and (
        circuit.circuit_level = 'global'
        or (
          circuit.circuit_level = 'provider'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
        )
        or (
          circuit.circuit_level = 'workspace'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id
        )
        or (
          circuit.circuit_level = 'connection'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id
          and circuit.business_entity_id = v_task.business_entity_id
          and circuit.connection_id = v_task.connection_id
        )
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_circuit_open';
  end if;

  select pg_catalog.count(*) into v_workspace_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  select pg_catalog.count(*) into v_connection_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.connection_id = v_task.connection_id
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  select pg_catalog.count(*) into v_provider_active
  from private.integration_sync_tasks as task
  where task.provider_key = v_task.provider_key
    and task.provider_environment = v_task.provider_environment
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  if v_workspace_active >= v_policy.maximum_concurrency
    or v_connection_active >= least(v_policy.maximum_concurrency, 2)
    or v_provider_active >= 64 then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_backpressure';
  end if;

  update private.integration_sync_tasks as task
  set state = 'leased',
      attempt_count = task.attempt_count + 1,
      lease_id = (p_command ->> 'leaseId')::uuid,
      lease_owner_fingerprint = v_lease_owner_fingerprint,
      lease_expires_at = v_now + pg_catalog.make_interval(
        secs => (p_command ->> 'leaseSeconds')::integer
      ),
      heartbeat_at = v_now,
      delivery_attribution_state = 'attributed',
      last_delivery_dispatch_generation = v_delivery_dispatch_generation,
      last_delivery_retry_count = v_delivery_retry_count,
      last_delivery_execution_count = v_delivery_execution_count,
      last_delivery_attempt_fingerprint = v_delivery_fingerprint,
      failure_category = null,
      failure_code = null,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
  where task.id = v_task.id
    and task.row_version = v_task.row_version
  returning task.* into v_task;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_lease_stale';
  end if;
  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.lease', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'delivery_retry_count', v_delivery_retry_count,
      'delivery_execution_count', v_delivery_execution_count,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );
  return private.phase_6_task_result_v1(v_task, false) ||
    pg_catalog.jsonb_build_object(
      'acquired', true,
      'terminalReplay', false,
      'reasonCode', 'leased'
    );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
end;
$function$;

revoke all on function public.record_integration_credential_refresh_boundary_v2(
  jsonb, text
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.record_integration_credential_refresh_boundary_v2(
  jsonb, text
) to integration_credential_broker_authority;

revoke all on function public.recover_qbo_sandbox_delivery_retry_compatibility_v1(
  jsonb, text, text
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.recover_qbo_sandbox_delivery_retry_compatibility_v1(
  jsonb, text, text
) to integration_task_dispatch_authority;

revoke all on function public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
  jsonb, text, text
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
  jsonb, text, text
) to integration_credential_broker_authority;

revoke all on function public.lease_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.lease_integration_sync_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function private.is_integration_audit_metadata_v8b_delivery_v2(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

commit;
