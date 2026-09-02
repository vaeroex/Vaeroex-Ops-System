-- Phase 8B credential refresh fan-out and scoped terminal-task recovery.
--
-- This migration repairs credential ciphertext transport, records redacted
-- refresh-boundary evidence, and permits one narrowly evidenced recovery of
-- tasks terminalized by the Phase 8B expired-credential incident. It creates
-- no provider, queue, OAuth, cloud, UI, KPI, or promotion authority.

begin;

create or replace function private.is_integration_audit_metadata_v8b_recovery_v1(
  p_value jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_integration_audit_metadata_v6(
      p_value - array[
        'refresh_boundary_stage',
        'refresh_operation_fingerprint',
        'recovery_generation',
        'prior_failure_category',
        'prior_failure_code'
      ]::text[]
    )
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v8b_recovery_v1(metadata));

create or replace function public.acquire_integration_credential_refresh_lease_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  v_result := public.acquire_integration_credential_refresh_lease_v1(
    p_command,
    p_request_id
  );
  if v_result ? 'ciphertextBase64' then
    v_result := pg_catalog.jsonb_set(
      v_result,
      '{ciphertextBase64}',
      pg_catalog.to_jsonb(
        pg_catalog.translate(v_result ->> 'ciphertextBase64', E'\n\r', '')
      ),
      false
    );
  end if;
  return v_result;
end;
$function$;

create or replace function public.read_integration_provider_credential_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  v_result := public.read_integration_provider_credential_v1(
    p_command,
    p_request_id
  );
  if v_result ? 'ciphertextBase64' then
    v_result := pg_catalog.jsonb_set(
      v_result,
      '{ciphertextBase64}',
      pg_catalog.to_jsonb(
        pg_catalog.translate(v_result ->> 'ciphertextBase64', E'\n\r', '')
      ),
      false
    );
  end if;
  return v_result;
end;
$function$;

create unique index integration_refresh_boundary_request_key_v1
  on private.integration_audit_events(action, request_id)
  where action = 'credential_refresh_boundary' and request_id is not null;

create or replace function public.record_integration_credential_refresh_boundary_v1(
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
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_event,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'credentialId', 'credentialVersion',
        'refreshOperationId', 'actorId', 'stage', 'outcome', 'reasonCode',
        'occurredAt'
      ]
    )
    or p_event ->> 'contractVersion' <>
      'integration_credential_refresh_boundary_v1'
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
    'refresh_operation_fingerprint', v_operation_fingerprint
  );

  select event.*
  into v_existing
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

  select credential.*
  into v_credential
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

create table private.integration_sync_task_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_expired_credential_recovery_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  credential_id uuid not null references private.integration_credentials(id)
    on delete restrict,
  credential_version bigint not null check (credential_version > 0),
  task_id uuid not null,
  recovery_generation bigint not null check (recovery_generation > 0),
  prior_state text not null check (prior_state = 'failed'),
  prior_failure_category text not null check (
    prior_failure_category = 'contract'
  ),
  prior_failure_code text not null check (
    prior_failure_code = 'phase8b_provider_task_failed'
  ),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_completed_at timestamptz not null,
  retry_after_seconds integer not null check (retry_after_seconds between 1 and 3600),
  request_id text not null check (private.is_bounded_identifier_v1(request_id)),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint integration_sync_task_recovery_task_key unique (task_id),
  constraint integration_sync_task_recovery_request_task_key unique (
    request_id, task_id
  ),
  constraint integration_sync_task_recovery_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_recovery_time_check check (
    recovered_at >= prior_completed_at and created_at = recovered_at
  )
);

create index integration_sync_task_recovery_scope_idx
  on private.integration_sync_task_recovery_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, recovery_generation
  );

alter table private.integration_sync_task_recovery_events enable row level security;
alter table private.integration_sync_task_recovery_events force row level security;

revoke all on table private.integration_sync_task_recovery_events
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

create trigger reject_integration_sync_task_recovery_event_mutation_v1
before update or delete on private.integration_sync_task_recovery_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();

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

  if old.state in ('succeeded', 'failed', 'dead_letter', 'cancelled') then
    if old.state = 'failed'
      and old.failure_category = 'contract'
      and old.failure_code = 'phase8b_provider_task_failed'
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
          and recovery.recovered_at
            + pg_catalog.make_interval(secs => recovery.retry_after_seconds)
            = new.available_at
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
    or new.last_delivery_execution_count < old.last_delivery_execution_count
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_mutation_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.recover_qbo_sandbox_expired_credential_tasks_v1(
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
  v_credential private.integration_credentials;
  v_connection private.integration_connections;
  v_task_ids uuid[];
  v_locked_task_ids uuid[];
  v_normalized_command jsonb;
  v_request_fingerprint bytea;
  v_existing_count integer;
  v_matching_existing_count integer;
  v_recovery_generation bigint;
  v_first_failure_at timestamptz;
  v_last_failure_at timestamptz;
  v_failure_audit_count integer;
  v_expired_read_count integer;
  v_recovered_count integer;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'credentialId', 'expectedCredentialVersion',
        'taskIds', 'retryAfterSeconds'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_expired_credential_recovery_v1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds')::integer not between 1 and 3600
    or pg_catalog.jsonb_typeof(p_command -> 'taskIds') <> 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'taskIds') not between 1 and 100
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'taskIds') as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_expired_credential_recovery_payload_invalid';
  end if;

  select pg_catalog.array_agg(task_id order by task_id)
  into v_task_ids
  from (
    select (item.value #>> '{}')::uuid as task_id
    from pg_catalog.jsonb_array_elements(p_command -> 'taskIds') as item(value)
  ) as requested;
  if pg_catalog.cardinality(v_task_ids) <>
      pg_catalog.jsonb_array_length(p_command -> 'taskIds')
    or (
      select pg_catalog.count(distinct task_id)
      from pg_catalog.unnest(v_task_ids) as task_id
    ) <> pg_catalog.cardinality(v_task_ids) then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_expired_credential_recovery_payload_invalid';
  end if;

  v_normalized_command := pg_catalog.jsonb_set(
    p_command,
    '{taskIds}',
    pg_catalog.to_jsonb(v_task_ids),
    false
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    v_normalized_command
  );

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where recovery.workspace_id = (p_command ->> 'workspaceId')::uuid
        and recovery.business_entity_id = (p_command ->> 'businessEntityId')::uuid
        and recovery.connection_id = (p_command ->> 'connectionId')::uuid
        and recovery.connection_generation =
          (p_command ->> 'connectionGeneration')::bigint
        and recovery.credential_id = (p_command ->> 'credentialId')::uuid
        and recovery.credential_version =
          (p_command ->> 'expectedCredentialVersion')::bigint
        and recovery.task_id = any(v_task_ids)
        and recovery.request_fingerprint = v_request_fingerprint
    )::integer,
    pg_catalog.max(recovery.recovery_generation),
    pg_catalog.max(recovery.recovered_at)
  into
    v_existing_count,
    v_matching_existing_count,
    v_recovery_generation,
    v_now
  from private.integration_sync_task_recovery_events as recovery
  where recovery.request_id = p_request_id;
  if v_existing_count > 0 then
    if v_existing_count = pg_catalog.cardinality(v_task_ids)
      and v_matching_existing_count = v_existing_count then
      return pg_catalog.jsonb_build_object(
        'recoveredTaskCount', v_existing_count,
        'recoveryGeneration', v_recovery_generation,
        'recoveredAt', pg_catalog.to_char(
          v_now at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_expired_credential_recovery_request_conflict';
  end if;
  v_now := pg_catalog.transaction_timestamp();

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'credentialId')::uuid
    and credential.workspace_id = (p_command ->> 'workspaceId')::uuid
    and credential.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and credential.connection_id = (p_command ->> 'connectionId')::uuid
    and credential.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
  for update;
  if not found
    or v_credential.provider_key <> 'quickbooks_online'
    or v_credential.provider_environment <> 'sandbox'
    or v_credential.status <> 'active'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.access_expires_at > v_now
    or (
      v_credential.refresh_expires_at is not null
      and v_credential.refresh_expires_at <= v_now
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_expired_credential_recovery_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_credential.workspace_id
    and connection.business_entity_id = v_credential.business_entity_id
    and connection.id = v_credential.connection_id
    and connection.connection_generation = v_credential.connection_generation
    and connection.provider_key = v_credential.provider_key
    and connection.provider_environment = v_credential.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_expired_credential_recovery_denied';
  end if;

  select
    pg_catalog.array_agg(task.id order by task.id),
    pg_catalog.min(task.completed_at),
    pg_catalog.max(task.completed_at)
  into v_locked_task_ids, v_first_failure_at, v_last_failure_at
  from (
    select candidate.*
    from private.integration_sync_tasks as candidate
    where candidate.id = any(v_task_ids)
      and candidate.workspace_id = v_credential.workspace_id
      and candidate.business_entity_id = v_credential.business_entity_id
      and candidate.connection_id = v_credential.connection_id
      and candidate.connection_generation = v_credential.connection_generation
      and candidate.provider_key = v_credential.provider_key
      and candidate.provider_environment = v_credential.provider_environment
      and candidate.state = 'failed'
      and candidate.failure_category = 'contract'
      and candidate.failure_code = 'phase8b_provider_task_failed'
      and candidate.durable_effect_fingerprint is null
      and candidate.completed_at is not null
      and exists (
        select 1
        from private.integration_sync_runs as run
        where run.workspace_id = candidate.workspace_id
          and run.business_entity_id = candidate.business_entity_id
          and run.connection_id = candidate.connection_id
          and run.id = candidate.sync_run_id
          and run.connection_generation = candidate.connection_generation
          and run.state = 'running'
          and run.mode = 'initialization'
      )
    order by candidate.id
    for update
  ) as task;
  if v_locked_task_ids is distinct from v_task_ids
    or exists (
      select 1
      from private.integration_sync_task_recovery_events as recovery
      where recovery.task_id = any(v_task_ids)
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_expired_credential_recovery_denied';
  end if;

  select pg_catalog.count(*)::integer
  into v_failure_audit_count
  from private.integration_sync_tasks as task
  join private.integration_audit_events as audit
    on audit.workspace_id = task.workspace_id
    and audit.business_entity_id = task.business_entity_id
    and audit.connection_id = task.connection_id
    and audit.action = 'integration_sync_task.fail'
    and audit.outcome = 'failed'
    and audit.target_type = 'integration_sync_task'
    and audit.target_id = task.id::text
    and audit.occurred_at = task.completed_at
  where task.id = any(v_task_ids);

  select pg_catalog.count(*)::integer
  into v_expired_read_count
  from private.integration_audit_events as audit
  where audit.workspace_id = v_credential.workspace_id
    and audit.business_entity_id = v_credential.business_entity_id
    and audit.connection_id = v_credential.connection_id
    and audit.action = 'credential_provider_read'
    and audit.outcome = 'denied'
    and audit.target_type = 'integration_credential'
    and audit.target_id = v_credential.id::text
    and audit.reason_code = 'credential_expired'
    and audit.metadata ->> 'connection_generation' =
      v_credential.connection_generation::text
    and audit.metadata ->> 'credential_version' =
      v_credential.credential_version::text
    and audit.occurred_at between
      v_first_failure_at - interval '5 minutes'
      and v_last_failure_at;

  if v_failure_audit_count <> pg_catalog.cardinality(v_task_ids)
    or v_expired_read_count < pg_catalog.cardinality(v_task_ids) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_expired_credential_recovery_evidence_denied';
  end if;

  select coalesce(pg_catalog.max(recovery.recovery_generation), 0) + 1
  into v_recovery_generation
  from private.integration_sync_task_recovery_events as recovery
  where recovery.workspace_id = v_credential.workspace_id
    and recovery.business_entity_id = v_credential.business_entity_id
    and recovery.connection_id = v_credential.connection_id
    and recovery.connection_generation = v_credential.connection_generation;

  insert into private.integration_sync_task_recovery_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, credential_id, credential_version, task_id,
    recovery_generation, prior_state, prior_failure_category,
    prior_failure_code, prior_row_version, prior_completed_at,
    retry_after_seconds, request_id, request_fingerprint, actor_id,
    recovered_at, created_at
  )
  select
    'qbo_sandbox_expired_credential_recovery_v1',
    task.workspace_id,
    task.business_entity_id,
    task.connection_id,
    task.connection_generation,
    v_credential.id,
    v_credential.credential_version,
    task.id,
    v_recovery_generation,
    task.state,
    task.failure_category,
    task.failure_code,
    task.row_version,
    task.completed_at,
    (p_command ->> 'retryAfterSeconds')::integer,
    p_request_id,
    v_request_fingerprint,
    p_actor_id,
    v_now,
    v_now
  from private.integration_sync_tasks as task
  where task.id = any(v_task_ids);

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
  where task.id = any(v_task_ids);
  get diagnostics v_recovered_count = row_count;
  if v_recovered_count <> pg_catalog.cardinality(v_task_ids) then
    raise exception using
      errcode = '40001',
      message = 'qbo_sandbox_expired_credential_recovery_stale';
  end if;

  insert into private.integration_audit_events (
    workspace_id, business_entity_id, connection_id,
    actor_type, actor_id, action, outcome, target_type, target_id,
    request_id, reason_code, metadata, occurred_at, retention_class
  )
  select
    task.workspace_id,
    task.business_entity_id,
    task.connection_id,
    'service',
    p_actor_id,
    'integration_sync_task.credential_recover',
    'succeeded',
    'integration_sync_task',
    task.id::text,
    p_request_id,
    'credential_expired',
    pg_catalog.jsonb_build_object(
      'task_state', task.state,
      'queue_class', task.queue_class,
      'attempt_count', task.attempt_count,
      'dispatch_generation', task.dispatch_generation,
      'row_version', task.row_version,
      'credential_version', v_credential.credential_version,
      'recovery_generation', v_recovery_generation,
      'prior_failure_category', 'contract',
      'prior_failure_code', 'phase8b_provider_task_failed',
      'idempotent', false
    ),
    v_now,
    'security'
  from private.integration_sync_tasks as task
  where task.id = any(v_task_ids);

  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_recovered_count,
    'recoveryGeneration', v_recovery_generation,
    'recoveredAt', pg_catalog.to_char(
      v_now at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_expired_credential_recovery_payload_invalid';
end;
$function$;

revoke all on function public.acquire_integration_credential_refresh_lease_v2(jsonb, text)
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
revoke all on function public.read_integration_provider_credential_v2(jsonb, text)
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
revoke all on function public.record_integration_credential_refresh_boundary_v1(jsonb, text)
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
revoke all on function public.recover_qbo_sandbox_expired_credential_tasks_v1(jsonb, text, text)
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

grant execute on function public.acquire_integration_credential_refresh_lease_v2(jsonb, text)
  to integration_credential_broker_authority;
grant execute on function public.read_integration_provider_credential_v2(jsonb, text)
  to integration_credential_broker_authority;
grant execute on function public.record_integration_credential_refresh_boundary_v1(jsonb, text)
  to integration_credential_broker_authority;
grant execute on function public.recover_qbo_sandbox_expired_credential_tasks_v1(jsonb, text, text)
  to integration_credential_broker_authority;

revoke all on function private.is_integration_audit_metadata_v8b_recovery_v1(jsonb)
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
