-- Phase 8B credential-envelope-binding incident recovery and exact-task canary.
--
-- This forward-only migration creates one reason-specific, externally attested
-- recovery path for the corrected expires_at_binding incident. It also creates
-- a separate NOLOGIN/NOINHERIT authority whose only dispatch surface is the
-- recovered company_info canary. It creates no provider, OAuth, customer,
-- Production, KPI, fact, reconciliation, or promotion authority.

begin;

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'integration_qbo_canary_dispatch_authority'
  ) then
    create role integration_qbo_canary_dispatch_authority nologin noinherit;
  end if;
end;
$role$;

alter role integration_qbo_canary_dispatch_authority nologin noinherit;

revoke integration_qbo_canary_dispatch_authority
  from anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

revoke all on schema private
  from integration_qbo_canary_dispatch_authority;

create or replace function private.assert_qbo_canary_dispatch_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_qbo_canary_dispatch_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_dispatch_authority_required';
  end if;
end;
$function$;

create table private.integration_sync_task_credential_binding_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version =
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  mapping_id uuid not null,
  active_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  active_credential_version bigint not null check (
    active_credential_version > 0
  ),
  active_credential_row_version bigint not null check (
    active_credential_row_version > 0
  ),
  prior_expired_recovery_event_id uuid not null references
    private.integration_sync_task_recovery_events(id) on delete restrict,
  failure_audit_event_id uuid not null references
    private.integration_audit_events(id) on delete restrict,
  credential_read_audit_event_id uuid not null references
    private.integration_audit_events(id) on delete restrict,
  diagnostic_class text not null check (
    diagnostic_class = 'expires_at_binding'
  ),
  external_evidence_fingerprint bytea not null check (
    pg_catalog.octet_length(external_evidence_fingerprint) = 32
  ),
  prior_state text not null check (prior_state = 'failed'),
  prior_failure_category text not null check (
    prior_failure_category = 'contract'
  ),
  prior_failure_code text not null check (
    prior_failure_code = 'phase8b_provider_task_failed'
  ),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_completed_at timestamptz not null,
  prior_dispatch_generation bigint not null check (
    prior_dispatch_generation > 0
  ),
  prior_delivery_attribution_state text not null check (
    prior_delivery_attribution_state = 'attributed'
  ),
  prior_delivery_dispatch_generation bigint not null check (
    prior_delivery_dispatch_generation > 0
  ),
  prior_delivery_retry_count integer not null check (
    prior_delivery_retry_count between 0 and 100
  ),
  prior_delivery_execution_count integer not null check (
    prior_delivery_execution_count between 0 and prior_delivery_retry_count
  ),
  prior_delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(prior_delivery_attempt_fingerprint) = 32
  ),
  prior_attempt_count integer not null check (prior_attempt_count > 0),
  retry_after_seconds integer not null check (
    retry_after_seconds between 1 and 3600
  ),
  reason_code text not null check (
    reason_code = 'credential_envelope_binding_convergence'
  ),
  request_id text not null check (
    private.is_bounded_identifier_v1(request_id)
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_credential_binding_recovery_task_key
    unique (task_id),
  constraint integration_sync_task_credential_binding_recovery_request_key
    unique (request_id),
  constraint integration_sync_task_credential_binding_recovery_task_fkey
    foreign key (workspace_id, business_entity_id, connection_id, task_id)
    references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_binding_recovery_run_fkey
    foreign key (workspace_id, business_entity_id, connection_id, sync_run_id)
    references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_binding_recovery_mapping_fkey
    foreign key (workspace_id, business_entity_id, connection_id, mapping_id)
    references private.provider_entity_mappings(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_binding_recovery_time_check
    check (recovered_at >= prior_completed_at and created_at = recovered_at)
);

create index integration_sync_task_credential_binding_recovery_scope_idx
  on private.integration_sync_task_credential_binding_recovery_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, recovered_at
  );

alter table private.integration_sync_task_credential_binding_recovery_events
  enable row level security;
alter table private.integration_sync_task_credential_binding_recovery_events
  force row level security;

revoke all on table
  private.integration_sync_task_credential_binding_recovery_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

create trigger reject_integration_sync_task_credential_binding_recovery_mutation_v1
before update or delete
on private.integration_sync_task_credential_binding_recovery_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create or replace function public.promote_qbo_sandbox_canary_task_v1(
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
  v_event
    private.integration_sync_task_credential_binding_recovery_events;
  v_request_fingerprint bytea;
begin
  perform private.assert_qbo_canary_dispatch_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'taskId', 'maximumTasks'
      ]
    )
    or p_command ->> 'contractVersion' is null
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_canary_due_retry_promotion_v1'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'maximumTasks') <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or p_command ->> 'maximumTasks' <> '1' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_due_retry_promotion_invalid';
  end if;

  perform (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'taskId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
    and connection.disconnected_at is null
    and connection.deleted_at is null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_due_retry_promotion_denied';
  end if;

  select event.* into v_event
  from private.integration_sync_task_credential_binding_recovery_events
    as event
  where event.workspace_id = v_connection.workspace_id
    and event.business_entity_id = v_connection.business_entity_id
    and event.connection_id = v_connection.id
    and event.connection_generation = v_connection.connection_generation
    and event.task_id = (p_command ->> 'taskId')::uuid;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_due_retry_promotion_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_event.workspace_id
    and run.business_entity_id = v_event.business_entity_id
    and run.connection_id = v_event.connection_id
    and run.connection_generation = v_event.connection_generation
    and run.id = v_event.sync_run_id
    and run.state in ('created', 'running')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_due_retry_promotion_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_event.workspace_id
    and task.business_entity_id = v_event.business_entity_id
    and task.connection_id = v_event.connection_id
    and task.connection_generation = v_event.connection_generation
    and task.id = v_event.task_id
    and task.sync_run_id = v_run.id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.stream_key = 'company_info'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
    and task.delivery_attribution_state <> 'legacy_unattributed'
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_due_retry_promotion_denied';
  end if;

  if v_task.state = 'pending'
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'promotedTaskCount', 1,
      'promotedAt', v_task.updated_at,
      'idempotent', true
    );
  end if;

  if v_task.state <> 'retry_wait'
    or v_task.row_version <> v_event.prior_row_version + 1
    or v_task.available_at > v_now
    or v_task.retention_expires_at <= v_now then
    return pg_catalog.jsonb_build_object(
      'promotedTaskCount', 0,
      'promotedAt', v_now,
      'idempotent', false
    );
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'pending',
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
      message = 'qbo_sandbox_canary_due_retry_promotion_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.canary_retry_ready',
    'succeeded',
    'integration_sync_task',
    v_task.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );

  return pg_catalog.jsonb_build_object(
    'promotedTaskCount', 1,
    'promotedAt', v_now,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_due_retry_promotion_invalid';
end;
$function$;

create or replace function public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_result jsonb;
begin
  perform private.assert_qbo_canary_dispatch_authority_v1();
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'taskId', 'maximumTasks'
      ]
    )
    or p_command ->> 'contractVersion' is null
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_canary_dispatch_discovery_v1'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'maximumTasks') <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or p_command ->> 'maximumTasks' <> '1' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_dispatch_discovery_invalid';
  end if;

  with eligible as (
    select
      task.*,
      case
        when task.state = 'dispatched' then event.prior_row_version + 2
        else task.row_version
      end as candidate_row_version,
      case
        when task.state = 'dispatched' then event.prior_dispatch_generation
        else task.dispatch_generation
      end as candidate_dispatch_generation
    from
      private.integration_sync_task_credential_binding_recovery_events
        as event
    inner join private.integration_connections as connection
      on connection.workspace_id = event.workspace_id
      and connection.business_entity_id = event.business_entity_id
      and connection.id = event.connection_id
      and connection.connection_generation = event.connection_generation
      and connection.provider_key = 'quickbooks_online'
      and connection.provider_environment = 'sandbox'
      and connection.status in ('initializing', 'active', 'degraded')
      and connection.disconnected_at is null
      and connection.deleted_at is null
    inner join private.integration_sync_runs as run
      on run.workspace_id = event.workspace_id
      and run.business_entity_id = event.business_entity_id
      and run.connection_id = event.connection_id
      and run.connection_generation = event.connection_generation
      and run.id = event.sync_run_id
      and run.state in ('created', 'running')
    inner join private.integration_sync_tasks as task
      on task.workspace_id = event.workspace_id
      and task.business_entity_id = event.business_entity_id
      and task.connection_id = event.connection_id
      and task.connection_generation = event.connection_generation
      and task.id = event.task_id
      and task.sync_run_id = event.sync_run_id
    cross join lateral (
      select pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            'phase8b_qbo_canary_cloud_task_v1:'
              || task.id::text
              || ':' || (event.prior_row_version + 2)::text
              || ':' || (event.prior_dispatch_generation + 1)::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ) as dispatcher_task_name
    ) as expected
    where event.workspace_id = (p_command ->> 'workspaceId')::uuid
      and event.business_entity_id =
        (p_command ->> 'businessEntityId')::uuid
      and event.connection_id = (p_command ->> 'connectionId')::uuid
      and event.connection_generation =
        (p_command ->> 'connectionGeneration')::bigint
      and event.task_id = (p_command ->> 'taskId')::uuid
      and task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
      and task.stream_key = 'company_info'
      and task.queue_class in ('provider_interactive', 'provider_bulk')
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.available_at <= v_now
      and task.retention_expires_at > v_now
      and (
        (
          task.state = 'pending'
          and task.row_version = event.prior_row_version + 2
          and task.dispatch_generation = event.prior_dispatch_generation
          and task.dispatcher_task_name is null
        )
        or (
          task.state = 'dispatched'
          and task.row_version = event.prior_row_version + 3
          and task.dispatch_generation = event.prior_dispatch_generation + 1
          and task.dispatcher_task_name = expected.dispatcher_task_name
          and task.last_request_id =
            'phase8b_canary_reserve_' || expected.dispatcher_task_name
          and task.last_request_fingerprint =
            private.phase_6_request_fingerprint_v1(
              'phase8b_canary_reserve_' || expected.dispatcher_task_name,
              pg_catalog.jsonb_build_object(
                'contractVersion',
                  'qbo_sandbox_canary_dispatch_reservation_v1',
                'workspaceId', event.workspace_id,
                'businessEntityId', event.business_entity_id,
                'connectionId', event.connection_id,
                'connectionGeneration', event.connection_generation,
                'taskId', event.task_id,
                'expectedRowVersion', event.prior_row_version + 2,
                'dispatcherTaskName', expected.dispatcher_task_name
              )
            )
        )
      )
    limit 1
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', eligible.id,
        'workspaceId', eligible.workspace_id,
        'businessEntityId', eligible.business_entity_id,
        'connectionId', eligible.connection_id,
        'connectionGeneration', eligible.connection_generation,
        'queueClass', eligible.queue_class,
        'streamKey', eligible.stream_key,
        'rowVersion', eligible.candidate_row_version,
        'dispatchGeneration', eligible.candidate_dispatch_generation
      )
    ),
    '[]'::jsonb
  ) into v_result
  from eligible;

  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_dispatch_discovery_invalid';
end;
$function$;

create or replace function public.reserve_qbo_sandbox_canary_dispatch_task_v1(
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
  v_event
    private.integration_sync_task_credential_binding_recovery_events;
  v_request_fingerprint bytea;
begin
  perform private.assert_qbo_canary_dispatch_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'taskId',
        'expectedRowVersion', 'dispatcherTaskName'
      ]
    )
    or p_command ->> 'contractVersion' is null
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_canary_dispatch_reservation_v1'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedRowVersion'
    ) <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedRowVersion') !~ '^[1-9][0-9]*$'
    or p_command ->> 'dispatcherTaskName' is null
    or p_command ->> 'dispatcherTaskName' !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_dispatch_reservation_invalid';
  end if;

  perform (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'taskId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
    and connection.disconnected_at is null
    and connection.deleted_at is null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_dispatch_reservation_denied';
  end if;

  select event.* into v_event
  from private.integration_sync_task_credential_binding_recovery_events
    as event
  where event.workspace_id = v_connection.workspace_id
    and event.business_entity_id = v_connection.business_entity_id
    and event.connection_id = v_connection.id
    and event.connection_generation = v_connection.connection_generation
    and event.task_id = (p_command ->> 'taskId')::uuid;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_dispatch_reservation_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_event.workspace_id
    and run.business_entity_id = v_event.business_entity_id
    and run.connection_id = v_event.connection_id
    and run.connection_generation = v_event.connection_generation
    and run.id = v_event.sync_run_id
    and run.state in ('created', 'running')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_dispatch_reservation_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_event.workspace_id
    and task.business_entity_id = v_event.business_entity_id
    and task.connection_id = v_event.connection_id
    and task.connection_generation = v_event.connection_generation
    and task.id = v_event.task_id
    and task.sync_run_id = v_run.id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.stream_key = 'company_info'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
    and task.delivery_attribution_state <> 'legacy_unattributed'
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_canary_dispatch_reservation_denied';
  end if;

  if v_task.state = 'dispatched'
    and v_task.dispatcher_task_name = p_command ->> 'dispatcherTaskName'
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;

  if v_task.state <> 'pending'
    or v_task.row_version <>
      (p_command ->> 'expectedRowVersion')::bigint
    or v_task.row_version <> v_event.prior_row_version + 2
    or v_task.available_at > v_now
    or v_task.retention_expires_at <= v_now then
    raise exception using
      errcode = '40001',
      message = 'qbo_sandbox_canary_dispatch_reservation_stale';
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'dispatched',
    dispatcher_task_name = p_command ->> 'dispatcherTaskName',
    dispatch_generation = task.dispatch_generation + 1,
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
      message = 'qbo_sandbox_canary_dispatch_reservation_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.canary_dispatch',
    'succeeded',
    'integration_sync_task',
    v_task.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );

  return private.phase_6_task_result_v1(v_task, false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_canary_dispatch_reservation_invalid';
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
        or (
          old.failure_category = 'contract'
          and old.failure_code = 'phase8b_provider_task_failed'
          and exists (
            select 1
            from
              private.integration_sync_task_credential_binding_recovery_events
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
              and recovery.prior_dispatch_generation =
                old.dispatch_generation
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
      and old.last_delivery_dispatch_generation =
        new.last_delivery_dispatch_generation
      and (
        new.last_delivery_attempt_fingerprint =
          old.last_delivery_attempt_fingerprint
        or (
          old.last_delivery_retry_count is not null
          and (
            new.last_delivery_retry_count <= old.last_delivery_retry_count
            or new.last_delivery_execution_count <
              old.last_delivery_execution_count
          )
        )
        or (
          old.last_delivery_retry_count is null
          and not exists (
            select 1
            from
              private.integration_sync_task_delivery_retry_compatibility_events
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
        from
          private.integration_sync_task_delivery_retry_compatibility_events
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

revoke all on function private.assert_qbo_canary_dispatch_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

create or replace function
  public.recover_qbo_sandbox_credential_binding_incident_task_v1(
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
  v_mapping private.provider_entity_mappings;
  v_credential private.integration_credentials;
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_previous_recovery private.integration_sync_task_recovery_events;
  v_failure_audit private.integration_audit_events;
  v_credential_read_audit private.integration_audit_events;
  v_existing
    private.integration_sync_task_credential_binding_recovery_events;
  v_request_fingerprint bytea;
  v_external_evidence_fingerprint bytea;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'mappingId',
        'expectedMappingRowVersion', 'credentialId',
        'expectedCredentialVersion', 'expectedCredentialRowVersion',
        'taskId', 'expectedTaskRowVersion', 'expectedDispatchGeneration',
        'failureAuditEventId', 'credentialReadAuditEventId',
        'diagnosticClass', 'externalEvidenceFingerprint',
        'retryAfterSeconds'
      ]
    )
    or p_command ->> 'contractVersion' is null
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v1'
    or p_command ->> 'diagnosticClass' is null
    or p_command ->> 'diagnosticClass' <> 'expires_at_binding'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedMappingRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedCredentialVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedCredentialRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedTaskRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedDispatchGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'retryAfterSeconds'
    ) <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedMappingRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCredentialRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedTaskRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedDispatchGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds')::integer not between 1 and 3600
    or p_command ->> 'externalEvidenceFingerprint' is null
    or p_command ->> 'externalEvidenceFingerprint'
      !~ '^sha256:[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_credential_binding_incident_recovery_invalid';
  end if;

  perform (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'mappingId')::uuid;
  perform (p_command ->> 'credentialId')::uuid;
  perform (p_command ->> 'taskId')::uuid;
  perform (p_command ->> 'failureAuditEventId')::uuid;
  perform (p_command ->> 'credentialReadAuditEventId')::uuid;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_external_evidence_fingerprint :=
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'externalEvidenceFingerprint'
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_sandbox_credential_binding_incident_recovery:'
        || (p_command ->> 'taskId'),
      0
    )
  );

  select event.* into v_existing
  from private.integration_sync_task_credential_binding_recovery_events
    as event
  where event.task_id = (p_command ->> 'taskId')::uuid
    or event.request_id = p_request_id
  order by event.task_id
  limit 1;
  if found then
    if v_existing.workspace_id = (p_command ->> 'workspaceId')::uuid
      and v_existing.business_entity_id =
        (p_command ->> 'businessEntityId')::uuid
      and v_existing.connection_id = (p_command ->> 'connectionId')::uuid
      and v_existing.connection_generation =
        (p_command ->> 'connectionGeneration')::bigint
      and v_existing.mapping_id = (p_command ->> 'mappingId')::uuid
      and v_existing.active_credential_id =
        (p_command ->> 'credentialId')::uuid
      and v_existing.active_credential_version =
        (p_command ->> 'expectedCredentialVersion')::bigint
      and v_existing.active_credential_row_version =
        (p_command ->> 'expectedCredentialRowVersion')::bigint
      and v_existing.task_id = (p_command ->> 'taskId')::uuid
      and v_existing.prior_row_version =
        (p_command ->> 'expectedTaskRowVersion')::bigint
      and v_existing.prior_dispatch_generation =
        (p_command ->> 'expectedDispatchGeneration')::bigint
      and v_existing.failure_audit_event_id =
        (p_command ->> 'failureAuditEventId')::uuid
      and v_existing.credential_read_audit_event_id =
        (p_command ->> 'credentialReadAuditEventId')::uuid
      and v_existing.diagnostic_class = p_command ->> 'diagnosticClass'
      and v_existing.external_evidence_fingerprint =
        v_external_evidence_fingerprint
      and v_existing.retry_after_seconds =
        (p_command ->> 'retryAfterSeconds')::integer
      and v_existing.request_id = p_request_id
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
      message = 'qbo_sandbox_credential_binding_incident_recovery_conflict';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_credential_binding_incident_recovery_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
    and connection.disconnected_at is null
    and connection.deleted_at is null
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_credential_binding_incident_recovery_denied';
  end if;

  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'credentialId')::uuid
    and credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
  for share;
  if not found
    or v_credential.status <> 'active'
    or v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
    or v_credential.row_version <>
      (p_command ->> 'expectedCredentialRowVersion')::bigint
    or v_credential.credential_ciphertext is null
    or v_credential.granted_scopes <>
      array['com.intuit.quickbooks.accounting']::text[]
    or v_credential.external_entity_reference_fingerprint is null
    or (
      v_credential.access_expires_at <= v_now + interval '30 seconds'
      and v_credential.refresh_expires_at is not null
      and v_credential.refresh_expires_at <= v_now
    )
    or v_credential.refresh_lease_id is not null
    or v_credential.refresh_lease_owner_fingerprint is not null
    or v_credential.refresh_lease_acquired_at is not null
    or v_credential.refresh_lease_expires_at is not null then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_credential_denied';
  end if;

  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_credential.workspace_id
      and audit.business_entity_id = v_credential.business_entity_id
      and audit.connection_id = v_credential.connection_id
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_credential.id::text
      and audit.reason_code in ('invalid_grant', 'provider_revoked')
      and audit.occurred_at >= v_credential.created_at
  ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_revoked';
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
      v_credential.external_entity_reference_fingerprint then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_credential_binding_incident_recovery_mapping_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_tasks as candidate
  inner join private.integration_sync_runs as run
    on run.workspace_id = candidate.workspace_id
    and run.business_entity_id = candidate.business_entity_id
    and run.connection_id = candidate.connection_id
    and run.connection_generation = candidate.connection_generation
    and run.id = candidate.sync_run_id
  where candidate.workspace_id = v_connection.workspace_id
    and candidate.business_entity_id = v_connection.business_entity_id
    and candidate.connection_id = v_connection.id
    and candidate.connection_generation = v_connection.connection_generation
    and candidate.id = (p_command ->> 'taskId')::uuid
  for share of run;
  if not found
    or v_run.state <> 'running'
    or v_run.mode <> 'initialization'
    or v_run.mapping_id <> v_mapping.id then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_credential_binding_incident_recovery_run_denied';
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
    and task.queue_class in ('provider_interactive', 'provider_bulk')
  for update;
  if not found
    or v_task.state <> 'failed'
    or v_task.row_version <>
      (p_command ->> 'expectedTaskRowVersion')::bigint
    or v_task.dispatch_generation <>
      (p_command ->> 'expectedDispatchGeneration')::bigint
    or v_task.delivery_attribution_state <> 'attributed'
    or v_task.last_delivery_dispatch_generation is null
    or v_task.last_delivery_dispatch_generation <> v_task.dispatch_generation
    or v_task.last_delivery_retry_count is null
    or v_task.last_delivery_execution_count is null
    or v_task.last_delivery_attempt_fingerprint is null
    or v_task.failure_category <> 'contract'
    or v_task.failure_code <> 'phase8b_provider_task_failed'
    or v_task.completed_at is null
    or v_task.durable_effect_fingerprint is not null
    or v_task.attempt_count >= v_task.maximum_attempts
    or v_task.lease_id is not null
    or v_task.lease_owner_fingerprint is not null
    or v_task.lease_expires_at is not null
    or v_task.heartbeat_at is not null
    or v_task.dispatcher_task_name is not null then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_credential_binding_incident_recovery_task_denied';
  end if;

  select recovery.* into v_previous_recovery
  from private.integration_sync_task_recovery_events as recovery
  where recovery.workspace_id = v_task.workspace_id
    and recovery.business_entity_id = v_task.business_entity_id
    and recovery.connection_id = v_task.connection_id
    and recovery.connection_generation = v_task.connection_generation
    and recovery.task_id = v_task.id
    and recovery.contract_version =
      'qbo_sandbox_expired_credential_recovery_v1'
    and recovery.recovered_at < v_task.completed_at
  order by recovery.recovery_generation desc
  limit 1;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
  end if;

  select audit.* into v_failure_audit
  from private.integration_audit_events as audit
  where audit.id = (p_command ->> 'failureAuditEventId')::uuid
    and audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'integration_sync_task.fail'
    and audit.outcome = 'failed'
    and audit.target_type = 'integration_sync_task'
    and audit.target_id = v_task.id::text
    and audit.occurred_at = v_task.completed_at;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_failure_denied';
  end if;

  select audit.* into v_credential_read_audit
  from private.integration_audit_events as audit
  where audit.id = (p_command ->> 'credentialReadAuditEventId')::uuid
    and audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'credential_provider_read'
    and audit.outcome = 'allowed'
    and audit.target_type = 'integration_credential'
    and audit.target_id = v_credential.id::text
    and audit.reason_code = 'authorized'
    and audit.metadata ->> 'connection_generation' =
      v_task.connection_generation::text
    and audit.metadata ->> 'credential_status' = 'active'
    and audit.metadata ->> 'credential_version' =
      v_credential.credential_version::text
    and audit.metadata ->> 'task_state' = 'leased'
    and audit.occurred_at >= v_previous_recovery.recovered_at
    and audit.occurred_at <= v_task.completed_at;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_read_denied';
  end if;

  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_task.workspace_id
      and audit.business_entity_id = v_task.business_entity_id
      and audit.connection_id = v_task.connection_id
      and audit.action = 'integration_sync_task.complete'
      and audit.outcome = 'succeeded'
      and audit.target_type = 'integration_sync_task'
      and audit.target_id = v_task.id::text
      and audit.occurred_at >= v_previous_recovery.recovered_at
  ) or exists (
    select 1
    from private.external_source_record_versions as version
    where version.workspace_id = v_task.workspace_id
      and version.business_entity_id = v_task.business_entity_id
      and version.connection_id = v_task.connection_id
      and version.sync_run_id = v_task.sync_run_id
      and version.created_at >= v_previous_recovery.recovered_at
      and version.created_at <= v_task.completed_at
  ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_effect_denied';
  end if;

  insert into
    private.integration_sync_task_credential_binding_recovery_events (
      contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, sync_run_id, task_id, mapping_id,
      active_credential_id, active_credential_version,
      active_credential_row_version, prior_expired_recovery_event_id,
      failure_audit_event_id, credential_read_audit_event_id,
      diagnostic_class, external_evidence_fingerprint,
      prior_state, prior_failure_category, prior_failure_code,
      prior_row_version, prior_completed_at, prior_dispatch_generation,
      prior_delivery_attribution_state,
      prior_delivery_dispatch_generation, prior_delivery_retry_count,
      prior_delivery_execution_count, prior_delivery_attempt_fingerprint,
      prior_attempt_count, retry_after_seconds, reason_code,
      request_id, request_fingerprint, actor_id, recovered_at, created_at
    )
  values (
    'qbo_sandbox_credential_envelope_binding_incident_recovery_v1',
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    v_task.connection_generation,
    v_task.sync_run_id,
    v_task.id,
    v_mapping.id,
    v_credential.id,
    v_credential.credential_version,
    v_credential.row_version,
    v_previous_recovery.id,
    v_failure_audit.id,
    v_credential_read_audit.id,
    'expires_at_binding',
    v_external_evidence_fingerprint,
    v_task.state,
    v_task.failure_category,
    v_task.failure_code,
    v_task.row_version,
    v_task.completed_at,
    v_task.dispatch_generation,
    v_task.delivery_attribution_state,
    v_task.last_delivery_dispatch_generation,
    v_task.last_delivery_retry_count,
    v_task.last_delivery_execution_count,
    v_task.last_delivery_attempt_fingerprint,
    v_task.attempt_count,
    (p_command ->> 'retryAfterSeconds')::integer,
    'credential_envelope_binding_convergence',
    p_request_id,
    v_request_fingerprint,
    p_actor_id,
    v_now,
    v_now
  );

  update private.integration_sync_tasks as task
  set
    state = 'retry_wait',
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
      message = 'qbo_sandbox_credential_binding_incident_recovery_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.credential_binding_recover',
    'succeeded',
    'integration_sync_task',
    v_task.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'credential_version', v_credential.credential_version,
      'recovery_generation', v_previous_recovery.recovery_generation,
      'prior_failure_category', 'contract',
      'prior_failure_code', 'phase8b_provider_task_failed',
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
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_credential_binding_incident_recovery_invalid';
end;
$function$;

revoke all on function
  public.recover_qbo_sandbox_credential_binding_incident_task_v1(
    jsonb, text, text
  )
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function
  public.recover_qbo_sandbox_credential_binding_incident_task_v1(
    jsonb, text, text
  )
  to integration_credential_broker_authority;

revoke all on function public.promote_qbo_sandbox_canary_task_v1(
  jsonb, text, text
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.promote_qbo_sandbox_canary_task_v1(
  jsonb, text, text
)
  to integration_qbo_canary_dispatch_authority;

revoke all on function public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  jsonb
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  jsonb
)
  to integration_qbo_canary_dispatch_authority;

revoke all on function public.reserve_qbo_sandbox_canary_dispatch_task_v1(
  jsonb, text, text
)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.reserve_qbo_sandbox_canary_dispatch_task_v1(
  jsonb, text, text
)
  to integration_qbo_canary_dispatch_authority;

revoke execute on function public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
  jsonb
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(
  jsonb, text, text
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.promote_qbo_sandbox_due_retry_tasks_v1(
  jsonb, text, text
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
  jsonb, text, text
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.discover_integration_sync_dispatch_v1(
  text, integer
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.discover_integration_sync_due_work_v1(
  timestamptz, integer
)
  from integration_qbo_canary_dispatch_authority;
revoke execute on function public.sweep_integration_sync_tasks_v1(
  integer, text, text
)
  from integration_qbo_canary_dispatch_authority;

comment on table
  private.integration_sync_task_credential_binding_recovery_events is
  'Immutable redacted evidence for exact tasks recovered from the Phase 8B expires_at_binding incident.';
comment on function
  public.recover_qbo_sandbox_credential_binding_incident_task_v1(
    jsonb, text, text
  ) is
  'Recovers an exact effect-free task only from the externally attested credential-envelope-binding incident.';
comment on function public.promote_qbo_sandbox_canary_task_v1(
  jsonb, text, text
) is
  'Promotes only the uniquely recovered Phase 8B company_info canary and requires maximumTasks one.';
comment on function public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  jsonb
) is
  'Returns zero or one database-pinned Phase 8B company_info canary candidate.';
comment on function public.reserve_qbo_sandbox_canary_dispatch_task_v1(
  jsonb, text, text
) is
  'Reserves only the immutable incident-recovery canary target under exact task CAS.';

commit;
