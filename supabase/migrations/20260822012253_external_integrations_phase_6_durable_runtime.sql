-- External Integrations Phase 6: Durable Synchronization Runtime Foundation
--
-- This migration adds provider-neutral durable task, checkpoint, minimized
-- webhook, circuit, and rate-limit authority. It creates no cloud resource,
-- provider connection, provider credential, route, UI, AI path, or KPI promotion.

begin;

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_webhook_ingress_authority'
  ) then
    create role integration_webhook_ingress_authority nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_task_dispatch_authority'
  ) then
    create role integration_task_dispatch_authority nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_provider_runtime_authority'
  ) then
    create role integration_provider_runtime_authority nologin noinherit;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_deterministic_runtime_authority'
  ) then
    create role integration_deterministic_runtime_authority nologin noinherit;
  end if;
end;
$roles$;

revoke integration_webhook_ingress_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority, integration_credential_broker_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke integration_task_dispatch_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority, integration_credential_broker_authority,
    integration_webhook_ingress_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke integration_provider_runtime_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority, integration_credential_broker_authority,
    integration_webhook_ingress_authority, integration_task_dispatch_authority,
    integration_deterministic_runtime_authority;
revoke integration_deterministic_runtime_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority, integration_credential_broker_authority,
    integration_webhook_ingress_authority, integration_task_dispatch_authority,
    integration_provider_runtime_authority;
revoke all on schema private
  from integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

create or replace function private.assert_phase_6_authority_v1(p_role text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_role not in (
    'integration_webhook_ingress_authority',
    'integration_task_dispatch_authority',
    'integration_provider_runtime_authority',
    'integration_deterministic_runtime_authority'
  ) or not pg_catalog.pg_has_role(session_user, p_role, 'MEMBER') then
    raise exception using
      errcode = '42501',
      message = 'integration_phase_6_authority_required';
  end if;
end;
$function$;

create or replace function private.is_integration_audit_metadata_v6(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_integration_audit_metadata_v5(
      p_value - array[
        'task_state',
        'task_kind',
        'queue_class',
        'attempt_count',
        'dispatch_generation',
        'checkpoint_lifecycle',
        'checkpoint_version',
        'webhook_processing_state',
        'circuit_state',
        'circuit_scope',
        'rate_limit_allowed',
        'recovered_task_count'
      ]::text[]
    )
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v6(metadata));

create or replace function private.phase_6_request_fingerprint_v1(
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
      'fingerprintPurpose', 'integration_runtime_request',
      'fingerprintVersion', 'integration_runtime_request_fingerprint_v1',
      'payload', pg_catalog.jsonb_build_object(
        'requestId', p_request_id,
        'command', p_command
      )
    )
  );
$function$;

create or replace function private.is_phase_6_control_metadata_v1(p_value jsonb)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'checkpointId',
        'mappingId',
        'eventId',
        'pageOrdinal',
        'cursorVersion',
        'windowStartAt',
        'windowEndAt',
        'reasonCode',
        'recordHintCount',
        'coalescedEventCount'
      ]
    )
    and pg_catalog.jsonb_typeof(p_value -> 'pageOrdinal') = 'number'
    and pg_catalog.jsonb_typeof(p_value -> 'cursorVersion') = 'number'
    and pg_catalog.jsonb_typeof(p_value -> 'recordHintCount') = 'number'
    and pg_catalog.jsonb_typeof(p_value -> 'coalescedEventCount') = 'number'
    and pg_catalog.jsonb_typeof(p_value -> 'reasonCode') = 'string'
    and private.is_bounded_identifier_v1(p_value ->> 'reasonCode')
    and (p_value -> 'checkpointId' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'checkpointId') = 'string')
    and (p_value -> 'mappingId' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'mappingId') = 'string')
    and (p_value -> 'eventId' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'eventId') = 'string')
    and (p_value -> 'windowStartAt' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'windowStartAt') = 'string')
    and (p_value -> 'windowEndAt' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'windowEndAt') = 'string')
    and (p_value -> 'windowStartAt' = 'null'::jsonb)
      = (p_value -> 'windowEndAt' = 'null'::jsonb)
    and (
      p_value -> 'windowStartAt' = 'null'::jsonb
      or (p_value ->> 'windowStartAt')::timestamptz <=
        (p_value ->> 'windowEndAt')::timestamptz
    )
    and (p_value ->> 'pageOrdinal')::bigint between 0 and 1000000
    and (p_value ->> 'cursorVersion')::bigint between 0 and 1000000000
    and (p_value ->> 'recordHintCount')::bigint between 0 and 100000000
    and (p_value ->> 'coalescedEventCount')::bigint between 1 and 100000000
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

create or replace function private.is_phase_6_cursor_v1(p_value jsonb)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'protocolVersion',
        'cursorKind',
        'cursorValue',
        'windowStartAt',
        'windowEndAt'
      ]
    )
    and p_value ->> 'protocolVersion' = 'integration_sync_checkpoint_v1'
    and p_value ->> 'cursorKind' in (
      'cursor', 'watermark_time', 'window', 'full_reconciliation'
    )
    and pg_catalog.jsonb_typeof(p_value -> 'cursorValue') = 'string'
    and pg_catalog.octet_length(p_value ->> 'cursorValue') <= 1024
    and (p_value -> 'windowStartAt' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'windowStartAt') = 'string')
    and (p_value -> 'windowEndAt' = 'null'::jsonb
      or pg_catalog.jsonb_typeof(p_value -> 'windowEndAt') = 'string')
    and (p_value -> 'windowStartAt' = 'null'::jsonb)
      = (p_value -> 'windowEndAt' = 'null'::jsonb)
    and (
      p_value -> 'windowStartAt' = 'null'::jsonb
      or (p_value ->> 'windowStartAt')::timestamptz <=
        (p_value ->> 'windowEndAt')::timestamptz
    )
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

create or replace function private.is_phase_6_task_transition_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select p_from = p_to
    or (p_from = 'pending' and p_to in ('dispatched', 'cancelled'))
    or (p_from = 'dispatched' and p_to in ('pending', 'leased', 'cancelled'))
    or (p_from = 'leased' and p_to in (
      'retry_wait', 'succeeded', 'failed', 'dead_letter', 'cancelled'
    ))
    or (p_from = 'retry_wait' and p_to in ('pending', 'cancelled', 'dead_letter'));
$function$;

create table private.integration_sync_tasks (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_sync_task_v1'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  parent_task_id uuid,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  queue_class text not null check (queue_class in (
    'integration_control',
    'provider_interactive',
    'provider_bulk',
    'deterministic_intelligence'
  )),
  task_kind text not null check (task_kind in (
    'initial_historical',
    'incremental',
    'webhook_targeted_read',
    'scheduled_recovery',
    'manual_sync',
    'retry_recovery',
    'full_reconciliation',
    'deterministic_shadow'
  )),
  stream_key text not null check (private.is_bounded_identifier_v1(stream_key)),
  state text not null default 'pending' check (state in (
    'pending', 'dispatched', 'leased', 'retry_wait',
    'succeeded', 'failed', 'dead_letter', 'cancelled'
  )),
  priority integer not null check (priority between 0 and 100),
  control_metadata jsonb not null check (
    private.is_phase_6_control_metadata_v1(control_metadata)
  ),
  idempotency_fingerprint bytea not null
    check (pg_catalog.octet_length(idempotency_fingerprint) = 32),
  coalescing_fingerprint bytea not null
    check (pg_catalog.octet_length(coalescing_fingerprint) = 32),
  dispatcher_task_name text check (
    dispatcher_task_name is null
    or pg_catalog.octet_length(dispatcher_task_name) between 1 and 1024
  ),
  dispatch_generation bigint not null default 0 check (dispatch_generation >= 0),
  last_delivery_execution_count integer not null default -1
    check (last_delivery_execution_count between -1 and 100),
  last_delivery_attempt_fingerprint bytea check (
    last_delivery_attempt_fingerprint is null
    or pg_catalog.octet_length(last_delivery_attempt_fingerprint) = 32
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  maximum_attempts integer not null check (maximum_attempts between 1 and 20),
  available_at timestamptz not null,
  lease_id uuid,
  lease_owner_fingerprint bytea check (
    lease_owner_fingerprint is null
    or pg_catalog.octet_length(lease_owner_fingerprint) = 32
  ),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  failure_category text check (failure_category in (
    'authorization', 'rate_limit', 'availability', 'timeout',
    'contract', 'data_anomaly', 'integrity', 'cancelled', 'unknown'
  )),
  failure_code text check (
    failure_code is null or private.is_bounded_identifier_v1(failure_code)
  ),
  durable_effect_fingerprint bytea check (
    durable_effect_fingerprint is null
    or pg_catalog.octet_length(durable_effect_fingerprint) = 32
  ),
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  retention_expires_at timestamptz not null,
  constraint integration_sync_tasks_scope_id_key unique (
    workspace_id, business_entity_id, connection_id, id
  ),
  constraint integration_sync_tasks_idempotency_key unique (
    workspace_id, business_entity_id, connection_id,
    connection_generation, idempotency_fingerprint
  ),
  constraint integration_sync_tasks_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment
  ) references private.integration_connections(
    workspace_id, business_entity_id, id,
    connection_generation, provider_key, provider_environment
  ) on delete restrict,
  constraint integration_sync_tasks_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_tasks_parent_fkey foreign key (
    workspace_id, business_entity_id, connection_id, parent_task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_tasks_lease_check check (
    (
      state = 'leased'
      and lease_id is not null
      and lease_owner_fingerprint is not null
      and lease_expires_at is not null
      and heartbeat_at is not null
    ) or (
      state <> 'leased'
      and lease_id is null
      and lease_owner_fingerprint is null
      and lease_expires_at is null
      and heartbeat_at is null
    )
  ),
  constraint integration_sync_tasks_dispatch_check check (
    (state in ('dispatched', 'leased') and dispatcher_task_name is not null)
    or (state not in ('dispatched', 'leased'))
  ),
  constraint integration_sync_tasks_delivery_check check (
    (last_delivery_execution_count = -1)
      = (last_delivery_attempt_fingerprint is null)
  ),
  constraint integration_sync_tasks_terminal_check check (
    (
      state = 'succeeded'
      and durable_effect_fingerprint is not null
      and completed_at is not null
      and failure_category is null
      and failure_code is null
    )
    or (
      state in ('failed', 'dead_letter')
      and completed_at is not null
      and failure_category is not null
      and failure_code is not null
      and durable_effect_fingerprint is null
    )
    or (
      state = 'cancelled'
      and completed_at is not null
      and durable_effect_fingerprint is null
    )
    or state in ('pending', 'dispatched', 'leased', 'retry_wait')
  ),
  constraint integration_sync_tasks_attempt_check check (
    attempt_count <= maximum_attempts
  ),
  constraint integration_sync_tasks_time_check check (
    updated_at >= created_at
    and available_at >= created_at
    and retention_expires_at > created_at
    and retention_expires_at <= created_at + interval '180 days'
    and (completed_at is null or completed_at >= created_at)
    and (cancel_requested_at is null or cancel_requested_at >= created_at)
  )
);

create index integration_sync_tasks_dispatch_due_idx
  on private.integration_sync_tasks(
    queue_class, state, available_at, priority desc, created_at, workspace_id
  ) where state in ('pending', 'retry_wait');
create index integration_sync_tasks_workspace_active_idx
  on private.integration_sync_tasks(
    workspace_id, provider_key, queue_class, state, updated_at
  ) where state in ('dispatched', 'leased');
create index integration_sync_tasks_connection_active_idx
  on private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, state, updated_at
  ) where state in ('dispatched', 'leased', 'retry_wait');
create index integration_sync_tasks_lease_expiry_idx
  on private.integration_sync_tasks(lease_expires_at)
  where state = 'leased';
create index integration_sync_tasks_parent_idx
  on private.integration_sync_tasks(parent_task_id)
  where parent_task_id is not null;

create table private.integration_sync_checkpoints (
  id uuid primary key,
  contract_version text not null
    check (contract_version = 'integration_sync_checkpoint_v1'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  mapping_id uuid,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  stream_key text not null check (private.is_bounded_identifier_v1(stream_key)),
  checkpoint_kind text not null check (checkpoint_kind in (
    'cursor', 'watermark_time', 'window', 'full_reconciliation'
  )),
  lifecycle text not null default 'active'
    constraint integration_sync_checkpoints_lifecycle_value_check check (lifecycle in (
    'active', 'invalidated', 'rebuilding', 'closed'
  )),
  cursor_version bigint not null check (cursor_version > 0),
  cursor_metadata jsonb not null check (private.is_phase_6_cursor_v1(cursor_metadata)),
  cursor_fingerprint bytea not null
    check (pg_catalog.octet_length(cursor_fingerprint) = 32),
  provider_watermark_at timestamptz,
  overlap_seconds integer not null check (overlap_seconds between 0 and 2592000),
  checkpoint_version bigint not null check (checkpoint_version > 0),
  last_sync_run_id uuid not null,
  last_task_id uuid not null,
  downstream_commit_fingerprint bytea not null
    check (pg_catalog.octet_length(downstream_commit_fingerprint) = 32),
  last_full_reconciliation_at timestamptz,
  invalidated_at timestamptz,
  rebuilt_at timestamptz,
  closed_at timestamptz,
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_sync_checkpoints_scope_key unique nulls not distinct (
    workspace_id, business_entity_id, connection_id, connection_generation,
    mapping_id, stream_key, checkpoint_kind
  ),
  constraint integration_sync_checkpoints_scope_id_key unique (
    workspace_id, business_entity_id, connection_id, id
  ),
  constraint integration_sync_checkpoints_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment
  ) references private.integration_connections(
    workspace_id, business_entity_id, id,
    connection_generation, provider_key, provider_environment
  ) on delete restrict,
  constraint integration_sync_checkpoints_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_checkpoints_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, last_sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_checkpoints_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, last_task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_checkpoints_lifecycle_check check (
    (lifecycle <> 'invalidated' or invalidated_at is not null)
    and (lifecycle <> 'rebuilding' or invalidated_at is not null)
    and (lifecycle <> 'closed' or closed_at is not null)
  ),
  constraint integration_sync_checkpoints_time_check check (
    updated_at >= created_at
    and (provider_watermark_at is null or provider_watermark_at <= updated_at)
    and (last_full_reconciliation_at is null or last_full_reconciliation_at <= updated_at)
    and (invalidated_at is null or invalidated_at >= created_at)
    and (rebuilt_at is null or rebuilt_at >= created_at)
    and (closed_at is null or closed_at >= created_at)
  )
);

create index integration_sync_checkpoints_due_idx
  on private.integration_sync_checkpoints(
    lifecycle, provider_watermark_at, updated_at, workspace_id
  ) where lifecycle in ('active', 'invalidated', 'rebuilding');
create index integration_sync_checkpoints_connection_idx
  on private.integration_sync_checkpoints(
    workspace_id, business_entity_id, connection_id, stream_key
  );

create table private.integration_webhook_events (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_webhook_event_v1'),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  specification_version text not null check (private.is_bounded_identifier_v1(specification_version)),
  event_type text not null check (private.is_bounded_identifier_v1(event_type)),
  provider_event_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_event_fingerprint) = 32),
  delivery_hash bytea not null check (pg_catalog.octet_length(delivery_hash) = 32),
  provider_account_reference_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_account_reference_fingerprint) = 32),
  provider_entity_type text not null check (private.is_bounded_identifier_v1(provider_entity_type)),
  provider_entity_reference_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_entity_reference_fingerprint) = 32),
  workspace_id uuid,
  business_entity_id uuid,
  connection_id uuid,
  connection_generation bigint,
  mapping_id uuid,
  verification_state text not null check (verification_state in ('verified', 'rejected')),
  processing_state text not null check (processing_state in (
    'pending', 'coalesced', 'processed', 'rejected', 'dead_letter'
  )),
  replay_of_event_id uuid references private.integration_webhook_events(id) on delete restrict,
  resulting_task_id uuid,
  resulting_sync_run_id uuid,
  failure_category text check (failure_category in (
    'authorization', 'contract', 'data_anomaly', 'unknown'
  )),
  failure_code text check (
    failure_code is null or private.is_bounded_identifier_v1(failure_code)
  ),
  verified_at timestamptz not null,
  received_at timestamptz not null,
  processed_at timestamptz,
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_webhook_events_delivery_key unique (
    provider_key, provider_environment, delivery_hash
  ),
  constraint integration_webhook_events_trusted_scope_check check (
    (
      verification_state = 'verified'
      and workspace_id is not null
      and business_entity_id is not null
      and connection_id is not null
      and connection_generation is not null
      and mapping_id is not null
      and processing_state in ('pending', 'coalesced', 'processed', 'dead_letter')
    ) or (
      verification_state = 'rejected'
      and workspace_id is null
      and business_entity_id is null
      and connection_id is null
      and connection_generation is null
      and mapping_id is null
      and processing_state = 'rejected'
    )
  ),
  constraint integration_webhook_events_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment
  ) references private.integration_connections(
    workspace_id, business_entity_id, id,
    connection_generation, provider_key, provider_environment
  ) on delete restrict,
  constraint integration_webhook_events_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_webhook_events_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, resulting_task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_webhook_events_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, resulting_sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_webhook_events_result_check check (
    (processing_state in ('coalesced', 'processed')
      and resulting_task_id is not null and resulting_sync_run_id is not null)
    or (processing_state not in ('coalesced', 'processed'))
  ),
  constraint integration_webhook_events_failure_check check (
    (processing_state in ('rejected', 'dead_letter'))
      = (failure_category is not null and failure_code is not null)
  ),
  constraint integration_webhook_events_time_check check (
    verified_at <= received_at
    and created_at = received_at
    and updated_at >= created_at
    and (processed_at is null or processed_at >= received_at)
  )
);

create index integration_webhook_events_pending_idx
  on private.integration_webhook_events(
    processing_state, received_at, provider_key, workspace_id
  ) where processing_state = 'pending';
create index integration_webhook_events_replay_idx
  on private.integration_webhook_events(
    provider_key, provider_environment, provider_event_fingerprint,
    connection_id, received_at
  );
create index integration_webhook_events_retention_idx
  on private.integration_webhook_events(received_at);

create table private.integration_runtime_circuits (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_runtime_circuit_v1'),
  circuit_scope text not null check (circuit_scope in (
    'provider_api', 'credentials', 'queue_runtime',
    'data_anomaly', 'deterministic_integrity'
  )),
  circuit_level text not null check (circuit_level in (
    'global', 'provider', 'workspace', 'connection'
  )),
  provider_key text check (
    provider_key is null or provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'
  ),
  provider_environment text check (
    provider_environment is null or private.is_bounded_identifier_v1(provider_environment)
  ),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  business_entity_id uuid,
  connection_id uuid,
  state text not null
    constraint integration_runtime_circuits_state_value_check
    check (state in ('closed', 'open', 'half_open')),
  reason_code text not null check (private.is_bounded_identifier_v1(reason_code)),
  failure_count bigint not null default 0 check (failure_count between 0 and 1000000000),
  success_count bigint not null default 0 check (success_count between 0 and 1000000000),
  open_until timestamptz,
  half_open_lease_id uuid,
  half_open_lease_expires_at timestamptz,
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_runtime_circuits_scope_key unique nulls not distinct (
    circuit_scope, circuit_level, provider_key, provider_environment,
    workspace_id, business_entity_id, connection_id
  ),
  constraint integration_runtime_circuits_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(
    workspace_id, business_entity_id, id
  ) on delete restrict,
  constraint integration_runtime_circuits_level_check check (
    (circuit_level = 'global'
      and provider_key is null and provider_environment is null
      and workspace_id is null and business_entity_id is null and connection_id is null)
    or (circuit_level = 'provider'
      and provider_key is not null and provider_environment is not null
      and workspace_id is null and business_entity_id is null and connection_id is null)
    or (circuit_level = 'workspace'
      and provider_key is not null and provider_environment is not null
      and workspace_id is not null and business_entity_id is null and connection_id is null)
    or (circuit_level = 'connection'
      and provider_key is not null and provider_environment is not null
      and workspace_id is not null and business_entity_id is not null and connection_id is not null)
  ),
  constraint integration_runtime_circuits_state_check check (
    (state = 'open' and open_until is not null
      and half_open_lease_id is null and half_open_lease_expires_at is null)
    or (state = 'half_open' and open_until is null
      and half_open_lease_id is not null and half_open_lease_expires_at is not null)
    or (state = 'closed' and open_until is null
      and half_open_lease_id is null and half_open_lease_expires_at is null)
  ),
  constraint integration_runtime_circuits_time_check check (
    updated_at >= created_at
    and (open_until is null or open_until > updated_at)
    and (half_open_lease_expires_at is null or half_open_lease_expires_at > updated_at)
  )
);

create index integration_runtime_circuits_open_idx
  on private.integration_runtime_circuits(
    state, open_until, provider_key, workspace_id, connection_id
  ) where state <> 'closed';

create table private.integration_rate_limit_states (
  id uuid primary key,
  contract_version text not null
    check (contract_version = 'integration_rate_limit_state_v1'),
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  connection_id uuid references private.integration_connections(id) on delete restrict,
  capacity_milli bigint not null check (capacity_milli between 1000 and 1000000),
  available_milli bigint not null check (available_milli between 0 and 1000000),
  refill_milli_per_second bigint not null check (refill_milli_per_second between 1 and 1000000),
  maximum_concurrency integer not null check (maximum_concurrency between 1 and 1000),
  adaptive_concurrency integer not null check (adaptive_concurrency between 1 and 1000),
  consecutive_limited integer not null default 0 check (consecutive_limited between 0 and 1000000),
  blocked_until timestamptz,
  last_refill_at timestamptz not null,
  last_observed_at timestamptz not null,
  policy_version text not null check (private.is_bounded_identifier_v1(policy_version)),
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  last_permit_allowed boolean not null,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_rate_limit_states_scope_key unique nulls not distinct (
    provider_key, provider_environment, workspace_id, connection_id
  ),
  constraint integration_rate_limit_states_capacity_check check (
    available_milli <= capacity_milli
    and adaptive_concurrency <= maximum_concurrency
  ),
  constraint integration_rate_limit_states_scope_check check (
    connection_id is null or workspace_id is not null
  ),
  constraint integration_rate_limit_states_time_check check (
    updated_at >= created_at
    and last_refill_at between created_at and updated_at
    and last_observed_at between created_at and updated_at
    and (blocked_until is null or blocked_until >= last_observed_at)
  )
);

create index integration_rate_limit_states_blocked_idx
  on private.integration_rate_limit_states(
    provider_key, provider_environment, blocked_until, workspace_id
  ) where blocked_until is not null;

alter table private.integration_sync_tasks enable row level security;
alter table private.integration_sync_tasks force row level security;
alter table private.integration_sync_checkpoints enable row level security;
alter table private.integration_sync_checkpoints force row level security;
alter table private.integration_webhook_events enable row level security;
alter table private.integration_webhook_events force row level security;
alter table private.integration_runtime_circuits enable row level security;
alter table private.integration_runtime_circuits force row level security;
alter table private.integration_rate_limit_states enable row level security;
alter table private.integration_rate_limit_states force row level security;

revoke all on table private.integration_sync_tasks
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on table private.integration_sync_checkpoints
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on table private.integration_webhook_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on table private.integration_runtime_circuits
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on table private.integration_rate_limit_states
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

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

create or replace function private.validate_integration_sync_checkpoint_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.workspace_id, new.business_entity_id,
    new.connection_id, new.connection_generation, new.mapping_id,
    new.provider_key, new.provider_environment, new.stream_key,
    new.checkpoint_kind, new.created_at
  ) is distinct from (
    old.id, old.contract_version, old.workspace_id, old.business_entity_id,
    old.connection_id, old.connection_generation, old.mapping_id,
    old.provider_key, old.provider_environment, old.stream_key,
    old.checkpoint_kind, old.created_at
  ) or new.row_version <> old.row_version + 1
    or new.checkpoint_version <> old.checkpoint_version + 1
    or new.cursor_version <= old.cursor_version
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_checkpoint_mutation_invalid';
  end if;
  if not (
    old.lifecycle = new.lifecycle
    or (old.lifecycle = 'active' and new.lifecycle in ('invalidated', 'closed'))
    or (old.lifecycle = 'invalidated' and new.lifecycle in ('rebuilding', 'closed'))
    or (old.lifecycle = 'rebuilding' and new.lifecycle in ('active', 'invalidated', 'closed'))
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_checkpoint_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_integration_webhook_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.provider_key, new.provider_environment,
    new.specification_version, new.event_type, new.provider_event_fingerprint,
    new.delivery_hash, new.provider_account_reference_fingerprint,
    new.provider_entity_type, new.provider_entity_reference_fingerprint,
    new.workspace_id, new.business_entity_id, new.connection_id,
    new.connection_generation, new.mapping_id, new.verification_state,
    new.replay_of_event_id, new.verified_at, new.received_at, new.created_at
  ) is distinct from (
    old.id, old.contract_version, old.provider_key, old.provider_environment,
    old.specification_version, old.event_type, old.provider_event_fingerprint,
    old.delivery_hash, old.provider_account_reference_fingerprint,
    old.provider_entity_type, old.provider_entity_reference_fingerprint,
    old.workspace_id, old.business_entity_id, old.connection_id,
    old.connection_generation, old.mapping_id, old.verification_state,
    old.replay_of_event_id, old.verified_at, old.received_at, old.created_at
  ) or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_webhook_event_mutation_invalid';
  end if;
  if not (
    old.processing_state = new.processing_state
    or (old.processing_state = 'pending'
      and new.processing_state in ('coalesced', 'processed', 'dead_letter'))
    or (old.processing_state = 'coalesced'
      and new.processing_state in ('processed', 'dead_letter'))
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_webhook_event_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_integration_runtime_circuit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.circuit_scope, new.circuit_level,
    new.provider_key, new.provider_environment, new.workspace_id,
    new.business_entity_id, new.connection_id, new.created_at
  ) is distinct from (
    old.id, old.contract_version, old.circuit_scope, old.circuit_level,
    old.provider_key, old.provider_environment, old.workspace_id,
    old.business_entity_id, old.connection_id, old.created_at
  ) or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_runtime_circuit_mutation_invalid';
  end if;
  if not (
    old.state = new.state
    or (old.state = 'closed' and new.state = 'open')
    or (old.state = 'open' and new.state = 'half_open')
    or (old.state = 'half_open' and new.state in ('closed', 'open'))
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_runtime_circuit_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_integration_rate_limit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.provider_key, new.provider_environment,
    new.workspace_id, new.connection_id, new.capacity_milli,
    new.refill_milli_per_second, new.maximum_concurrency,
    new.policy_version, new.created_at
  ) is distinct from (
    old.id, old.contract_version, old.provider_key, old.provider_environment,
    old.workspace_id, old.connection_id, old.capacity_milli,
    old.refill_milli_per_second, old.maximum_concurrency,
    old.policy_version, old.created_at
  ) or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_rate_limit_mutation_invalid';
  end if;
  return new;
end;
$function$;

create or replace function private.guard_phase_6_connection_deletion_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'deleted' and old.status <> 'deleted' and (
    exists (
      select 1 from private.integration_sync_tasks as task
      where task.workspace_id = old.workspace_id
        and task.business_entity_id = old.business_entity_id
        and task.connection_id = old.id
        and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
    )
    or exists (
      select 1 from private.integration_sync_checkpoints as checkpoint
      where checkpoint.workspace_id = old.workspace_id
        and checkpoint.business_entity_id = old.business_entity_id
        and checkpoint.connection_id = old.id
        and checkpoint.lifecycle <> 'closed'
    )
    or exists (
      select 1 from private.integration_webhook_events as event
      where event.workspace_id = old.workspace_id
        and event.business_entity_id = old.business_entity_id
        and event.connection_id = old.id
        and event.processing_state in ('pending', 'coalesced')
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_runtime_work_active';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_sync_task_mutation_v1
before update on private.integration_sync_tasks
for each row execute function private.validate_integration_sync_task_mutation_v1();
create trigger reject_integration_sync_task_delete_v1
before delete on private.integration_sync_tasks
for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger validate_integration_sync_checkpoint_mutation_v1
before update on private.integration_sync_checkpoints
for each row execute function private.validate_integration_sync_checkpoint_mutation_v1();
create trigger reject_integration_sync_checkpoint_delete_v1
before delete on private.integration_sync_checkpoints
for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger validate_integration_webhook_event_mutation_v1
before update on private.integration_webhook_events
for each row execute function private.validate_integration_webhook_event_mutation_v1();
create trigger reject_integration_webhook_event_delete_v1
before delete on private.integration_webhook_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger validate_integration_runtime_circuit_mutation_v1
before update on private.integration_runtime_circuits
for each row execute function private.validate_integration_runtime_circuit_mutation_v1();
create trigger reject_integration_runtime_circuit_delete_v1
before delete on private.integration_runtime_circuits
for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger validate_integration_rate_limit_mutation_v1
before update on private.integration_rate_limit_states
for each row execute function private.validate_integration_rate_limit_mutation_v1();
create trigger reject_integration_rate_limit_delete_v1
before delete on private.integration_rate_limit_states
for each row execute function private.reject_external_integration_immutable_mutation_v1();
create trigger guard_phase_6_connection_deletion_v1
before update on private.integration_connections
for each row execute function private.guard_phase_6_connection_deletion_v1();

create or replace function private.phase_6_task_result_v1(
  p_task private.integration_sync_tasks,
  p_idempotent boolean
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'taskId', p_task.id,
    'workspaceId', p_task.workspace_id,
    'businessEntityId', p_task.business_entity_id,
    'connectionId', p_task.connection_id,
    'connectionGeneration', p_task.connection_generation,
    'syncRunId', p_task.sync_run_id,
    'queueClass', p_task.queue_class,
    'taskKind', p_task.task_kind,
    'streamKey', p_task.stream_key,
    'state', p_task.state,
    'attemptCount', p_task.attempt_count,
    'maximumAttempts', p_task.maximum_attempts,
    'availableAt', p_task.available_at,
    'leaseExpiresAt', p_task.lease_expires_at,
    'controlMetadata', p_task.control_metadata,
    'rowVersion', p_task.row_version,
    'idempotent', p_idempotent
  );
$function$;

create or replace function private.phase_6_insert_audit_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_actor_id text,
  p_action text,
  p_outcome text,
  p_target_type text,
  p_target_id text,
  p_request_id text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
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
    metadata,
    retention_class,
    occurred_at
  ) values (
    p_workspace_id,
    p_business_entity_id,
    p_connection_id,
    'service',
    p_actor_id,
    p_action,
    p_outcome,
    p_target_type,
    p_target_id,
    p_request_id,
    p_metadata,
    'operational',
    pg_catalog.transaction_timestamp()
  ) returning id into v_id;
  return v_id;
end;
$function$;

create or replace function private.assert_phase_6_worker_for_queue_v1(
  p_queue_class text
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_queue_class = 'deterministic_intelligence' then
    perform private.assert_phase_6_authority_v1(
      'integration_deterministic_runtime_authority'
    );
  else
    perform private.assert_phase_6_authority_v1(
      'integration_provider_runtime_authority'
    );
  end if;
end;
$function$;

create or replace function public.create_integration_sync_task_v1(
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
  v_parent private.integration_sync_tasks;
  v_request_fingerprint bytea;
  v_idempotency_fingerprint bytea;
  v_coalescing_fingerprint bytea;
  v_parent_task_id uuid;
  v_requested_created_at timestamptz;
  v_requested_available_at timestamptz;
  v_requested_retention_at timestamptz;
  v_available_delay interval;
  v_retention_duration interval;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'id', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'syncRunId', 'parentTaskId',
        'providerKey', 'providerEnvironment', 'queueClass', 'taskKind',
        'streamKey', 'priority', 'controlMetadata',
        'idempotencyFingerprint', 'coalescingFingerprint', 'maximumAttempts',
        'availableAt', 'retentionExpiresAt', 'createdAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_sync_task_v1'
    or p_command ->> 'queueClass' not in (
      'integration_control', 'provider_interactive',
      'provider_bulk', 'deterministic_intelligence'
    )
    or p_command ->> 'taskKind' not in (
      'initial_historical', 'incremental', 'webhook_targeted_read',
      'scheduled_recovery', 'manual_sync', 'retry_recovery',
      'full_reconciliation', 'deterministic_shadow'
    )
    or not private.is_bounded_identifier_v1(p_command ->> 'streamKey')
    or not private.is_phase_6_control_metadata_v1(p_command -> 'controlMetadata')
    or (p_command ->> 'priority')::integer not between 0 and 100
    or (p_command ->> 'maximumAttempts')::integer not between 1 and 20
    or (
      (p_command ->> 'queueClass') = 'deterministic_intelligence'
    ) <> (
      (p_command ->> 'taskKind') = 'deterministic_shadow'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_payload_invalid';
  end if;

  v_parent_task_id := case
    when p_command -> 'parentTaskId' = 'null'::jsonb then null
    else (p_command ->> 'parentTaskId')::uuid
  end;
  perform case when p_command -> 'controlMetadata' -> 'checkpointId' = 'null'::jsonb
    then null else (p_command -> 'controlMetadata' ->> 'checkpointId')::uuid end;
  perform case when p_command -> 'controlMetadata' -> 'mappingId' = 'null'::jsonb
    then null else (p_command -> 'controlMetadata' ->> 'mappingId')::uuid end;
  perform case when p_command -> 'controlMetadata' -> 'eventId' = 'null'::jsonb
    then null else (p_command -> 'controlMetadata' ->> 'eventId')::uuid end;
  v_requested_created_at := (p_command ->> 'createdAt')::timestamptz;
  v_requested_available_at := (p_command ->> 'availableAt')::timestamptz;
  v_requested_retention_at := (p_command ->> 'retentionExpiresAt')::timestamptz;
  v_available_delay := v_requested_available_at - v_requested_created_at;
  v_retention_duration := v_requested_retention_at - v_requested_created_at;
  if v_available_delay < interval '0 seconds'
    or v_available_delay > interval '30 days'
    or v_retention_duration <= interval '0 seconds'
    or v_retention_duration > interval '180 days' then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_time_window_invalid';
  end if;

  v_idempotency_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'idempotencyFingerprint'
  );
  v_coalescing_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'coalescingFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or v_connection.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_connection.provider_key <> p_command ->> 'providerKey'
    or v_connection.provider_environment <> p_command ->> 'providerEnvironment'
    or v_connection.status not in ('initializing', 'active', 'degraded') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_scope_denied';
  end if;

  select run.*
  into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.id = (p_command ->> 'syncRunId')::uuid
  for update;
  if not found
    or v_run.connection_generation <> v_connection.connection_generation
    or v_run.state not in ('created', 'running') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_run_denied';
  end if;

  if v_parent_task_id is not null then
    select task.* into v_parent
    from private.integration_sync_tasks as task
    where task.workspace_id = v_connection.workspace_id
      and task.business_entity_id = v_connection.business_entity_id
      and task.connection_id = v_connection.id
      and task.id = v_parent_task_id
    for update;
    if not found
      or v_parent.sync_run_id <> v_run.id
      or v_parent.connection_generation <> v_connection.connection_generation
      or v_parent.id = (p_command ->> 'id')::uuid then
      raise exception using
        errcode = '42501',
        message = 'integration_sync_task_parent_denied';
    end if;
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.idempotency_fingerprint = v_idempotency_fingerprint
  for update;
  if found then
    if v_task.id = (p_command ->> 'id')::uuid
      and v_task.sync_run_id = v_run.id
      and v_task.task_kind = p_command ->> 'taskKind'
      and v_task.stream_key = p_command ->> 'streamKey'
      and v_task.coalescing_fingerprint = v_coalescing_fingerprint then
      return private.phase_6_task_result_v1(v_task, true);
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_sync_task_idempotency_conflict';
  end if;

  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, parent_task_id, provider_key,
    provider_environment, queue_class, task_kind, stream_key, state, priority,
    control_metadata, idempotency_fingerprint, coalescing_fingerprint,
    maximum_attempts, available_at, last_request_id,
    last_request_fingerprint, created_at, updated_at, retention_expires_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_sync_task_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_connection.connection_generation,
    v_run.id,
    v_parent_task_id,
    v_connection.provider_key,
    v_connection.provider_environment,
    p_command ->> 'queueClass',
    p_command ->> 'taskKind',
    p_command ->> 'streamKey',
    'pending',
    (p_command ->> 'priority')::integer,
    p_command -> 'controlMetadata',
    v_idempotency_fingerprint,
    v_coalescing_fingerprint,
    (p_command ->> 'maximumAttempts')::integer,
    v_now + v_available_delay,
    p_request_id,
    v_request_fingerprint,
    v_now,
    v_now,
    v_now + v_retention_duration
  ) returning * into v_task;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.create',
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
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_sync_task_idempotency_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_payload_invalid';
end;
$function$;

create or replace function public.discover_integration_sync_dispatch_v1(
  p_queue_class text,
  p_limit integer
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
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_queue_class not in (
    'integration_control', 'provider_interactive',
    'provider_bulk', 'deterministic_intelligence'
  ) or p_limit not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_dispatch_query_invalid';
  end if;
  with last_served as (
    select
      served.workspace_id,
      pg_catalog.max(served.updated_at) as last_served_at
    from private.integration_sync_tasks as served
    where served.queue_class = p_queue_class
      and served.dispatch_generation > 0
    group by served.workspace_id
  ), ranked as (
    select
      task.id,
      task.workspace_id,
      task.priority,
      task.created_at,
      last_served.last_served_at,
      pg_catalog.row_number() over (
        partition by task.workspace_id
        order by task.priority desc, task.created_at, task.id
      ) as workspace_ordinal
    from private.integration_sync_tasks as task
    left join last_served on last_served.workspace_id = task.workspace_id
    where task.queue_class = p_queue_class
      and task.state = 'pending'
      and task.available_at <= v_now
  ), fair as (
    select * from ranked
    order by workspace_ordinal, last_served_at nulls first,
      workspace_id, priority desc, created_at, id
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', fair.id,
        'workspaceId', fair.workspace_id
      ) order by fair.workspace_ordinal, fair.last_served_at nulls first,
        fair.workspace_id, fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;
  return v_result;
end;
$function$;

create or replace function public.mark_integration_sync_task_dispatched_v1(
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
  v_task private.integration_sync_tasks;
  v_request_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'dispatcherTaskName'
      ]
    )
    or pg_catalog.octet_length(p_command ->> 'dispatcherTaskName') not between 1 and 1024
    or p_command ->> 'dispatcherTaskName' !~
      '^projects/[a-z][a-z0-9-]{0,62}/locations/[a-z][a-z0-9-]{0,62}/queues/[a-z][a-z0-9-]{0,62}/tasks/[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_dispatch_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_dispatch_denied';
  end if;
  if v_task.state = 'dispatched'
    and v_task.dispatcher_task_name = p_command ->> 'dispatcherTaskName'
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state <> 'pending'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.available_at > v_now then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_dispatch_stale';
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
  returning task.* into v_task;
  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.dispatch', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
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
      message = 'integration_sync_task_dispatch_payload_invalid';
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
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'workerKind', 'leaseId', 'leaseOwnerFingerprint', 'leaseSeconds',
        'dispatcherTaskName', 'deliveryExecutionCount',
        'deliveryAttemptFingerprint'
      ]
    )
    or p_command ->> 'workerKind' not in (
      'provider_runtime', 'deterministic_runtime'
    )
    or (p_command ->> 'leaseSeconds')::integer not between 30 and 900
    or (p_command ->> 'deliveryExecutionCount')::integer not between 0 and 100
    or pg_catalog.octet_length(p_command ->> 'dispatcherTaskName')
      not between 1 and 1024 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
  end if;

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

  -- Serialize workspace admission before the connection/run/task lock chain.
  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  -- The lock order is stable across runtime commands: workspace, connection,
  -- provider admission, run, task.
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

  if v_task.state = 'succeeded' then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object('acquired', false, 'terminalReplay', true);
  end if;
  if v_task.state = 'leased'
    and v_task.last_delivery_execution_count =
      (p_command ->> 'deliveryExecutionCount')::integer
    and v_task.last_delivery_attempt_fingerprint = v_delivery_fingerprint then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object('acquired', false, 'terminalReplay', false);
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
    or (p_command ->> 'deliveryExecutionCount')::integer <=
      v_task.last_delivery_execution_count then
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
        or (circuit.circuit_level = 'provider'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment)
        or (circuit.circuit_level = 'workspace'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id)
        or (circuit.circuit_level = 'connection'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id
          and circuit.business_entity_id = v_task.business_entity_id
          and circuit.connection_id = v_task.connection_id)
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_circuit_open';
  end if;

  select pg_catalog.count(*) into v_workspace_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.state = 'leased';
  select pg_catalog.count(*) into v_connection_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.connection_id = v_task.connection_id
    and task.state = 'leased';
  select pg_catalog.count(*) into v_provider_active
  from private.integration_sync_tasks as task
  where task.provider_key = v_task.provider_key
    and task.provider_environment = v_task.provider_environment
    and task.state = 'leased';
  if v_workspace_active >= v_policy.maximum_concurrency
    or v_connection_active >= least(v_policy.maximum_concurrency, 2)
    or v_provider_active >= 64 then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_backpressure';
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'leased',
    attempt_count = task.attempt_count + 1,
    lease_id = (p_command ->> 'leaseId')::uuid,
    lease_owner_fingerprint = v_lease_owner_fingerprint,
    lease_expires_at = v_now +
      pg_catalog.make_interval(secs => (p_command ->> 'leaseSeconds')::integer),
    heartbeat_at = v_now,
    last_delivery_execution_count =
      (p_command ->> 'deliveryExecutionCount')::integer,
    last_delivery_attempt_fingerprint = v_delivery_fingerprint,
    failure_category = null,
    failure_code = null,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;
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
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );
  return private.phase_6_task_result_v1(v_task, false) ||
    pg_catalog.jsonb_build_object('acquired', true, 'terminalReplay', false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
end;
$function$;

create or replace function public.heartbeat_integration_sync_task_v1(
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
  v_task private.integration_sync_tasks;
  v_owner_fingerprint bytea;
  v_request_fingerprint bytea;
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'leaseId', 'leaseOwnerFingerprint', 'extendSeconds'
      ]
    )
    or (p_command ->> 'extendSeconds')::integer not between 30 and 900 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_heartbeat_payload_invalid';
  end if;
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_heartbeat_denied';
  end if;
  perform private.assert_phase_6_worker_for_queue_v1(v_task.queue_class);
  if v_task.state = 'leased'
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state <> 'leased'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <> v_owner_fingerprint
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_heartbeat_stale';
  end if;
  update private.integration_sync_tasks as task
  set
    heartbeat_at = v_now,
    lease_expires_at = v_now +
      pg_catalog.make_interval(secs => (p_command ->> 'extendSeconds')::integer),
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;
  return private.phase_6_task_result_v1(v_task, false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_heartbeat_payload_invalid';
end;
$function$;

create or replace function public.complete_integration_sync_task_v1(
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
  v_task private.integration_sync_tasks;
  v_checkpoint private.integration_sync_checkpoints;
  v_owner_fingerprint bytea;
  v_effect_fingerprint bytea;
  v_request_fingerprint bytea;
  v_checkpoint_id uuid;
  v_mapping_id uuid;
  v_event_id uuid;
  v_cursor jsonb;
  v_cursor_fingerprint bytea;
  v_downstream_fingerprint bytea;
  v_provider_watermark_at timestamptz;
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'leaseId', 'leaseOwnerFingerprint', 'durableEffectFingerprint',
        'checkpoint'
      ]
    )
    or (
      p_command -> 'checkpoint' <> 'null'::jsonb
      and not private.jsonb_has_exact_keys_v1(
        p_command -> 'checkpoint',
        array[
          'checkpointId', 'expectedCheckpointVersion', 'streamKey',
          'checkpointKind', 'cursorVersion', 'cursor', 'cursorFingerprint',
          'providerWatermarkAt', 'overlapSeconds', 'fullReconciliation',
          'downstreamCommitFingerprint'
        ]
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_completion_payload_invalid';
  end if;
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_effect_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'durableEffectFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_completion_denied';
  end if;
  perform private.assert_phase_6_worker_for_queue_v1(v_task.queue_class);
  if v_task.state = 'succeeded'
    and v_task.durable_effect_fingerprint = v_effect_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state <> 'leased'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <> v_owner_fingerprint
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_completion_stale';
  end if;

  if p_command -> 'checkpoint' <> 'null'::jsonb then
    v_checkpoint_id := (p_command -> 'checkpoint' ->> 'checkpointId')::uuid;
    v_mapping_id := case
      when v_task.control_metadata -> 'mappingId' = 'null'::jsonb then null
      else (v_task.control_metadata ->> 'mappingId')::uuid
    end;
    v_cursor := p_command -> 'checkpoint' -> 'cursor';
    v_cursor_fingerprint := private.sha256_fingerprint_bytes_v1(
      p_command -> 'checkpoint' ->> 'cursorFingerprint'
    );
    v_downstream_fingerprint := private.sha256_fingerprint_bytes_v1(
      p_command -> 'checkpoint' ->> 'downstreamCommitFingerprint'
    );
    v_provider_watermark_at := case
      when p_command -> 'checkpoint' -> 'providerWatermarkAt' = 'null'::jsonb
        then null
      else (p_command -> 'checkpoint' ->> 'providerWatermarkAt')::timestamptz
    end;
    if not private.is_phase_6_cursor_v1(v_cursor)
      or p_command -> 'checkpoint' ->> 'streamKey' <> v_task.stream_key
      or p_command -> 'checkpoint' ->> 'checkpointKind' not in (
        'cursor', 'watermark_time', 'window', 'full_reconciliation'
      )
      or p_command -> 'checkpoint' ->> 'checkpointKind' <>
        v_cursor ->> 'cursorKind'
      or (p_command -> 'checkpoint' ->> 'cursorVersion')::bigint <= 0
      or (p_command -> 'checkpoint' ->> 'expectedCheckpointVersion')::bigint < 0
      or (p_command -> 'checkpoint' ->> 'overlapSeconds')::integer
        not between 0 and 2592000
      or (
        v_task.control_metadata -> 'checkpointId' <> 'null'::jsonb
        and (v_task.control_metadata ->> 'checkpointId')::uuid <> v_checkpoint_id
      ) then
      raise exception using
        errcode = '22023',
        message = 'integration_sync_checkpoint_payload_invalid';
    end if;

    select checkpoint.* into v_checkpoint
    from private.integration_sync_checkpoints as checkpoint
    where checkpoint.workspace_id = v_task.workspace_id
      and checkpoint.business_entity_id = v_task.business_entity_id
      and checkpoint.connection_id = v_task.connection_id
      and checkpoint.id = v_checkpoint_id
    for update;
    if not found then
      if (p_command -> 'checkpoint' ->> 'expectedCheckpointVersion')::bigint <> 0
        or (p_command -> 'checkpoint' ->> 'cursorVersion')::bigint <> 1 then
        raise exception using
          errcode = '40001',
          message = 'integration_sync_checkpoint_cas_stale';
      end if;
      insert into private.integration_sync_checkpoints (
        id, contract_version, workspace_id, business_entity_id, connection_id,
        connection_generation, mapping_id, provider_key, provider_environment,
        stream_key, checkpoint_kind, lifecycle, cursor_version,
        cursor_metadata, cursor_fingerprint, provider_watermark_at,
        overlap_seconds, checkpoint_version, last_sync_run_id, last_task_id,
        downstream_commit_fingerprint, last_full_reconciliation_at,
        last_request_id, last_request_fingerprint, created_at, updated_at
      ) values (
        v_checkpoint_id, 'integration_sync_checkpoint_v1',
        v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
        v_task.connection_generation, v_mapping_id, v_task.provider_key,
        v_task.provider_environment, v_task.stream_key,
        p_command -> 'checkpoint' ->> 'checkpointKind', 'active',
        (p_command -> 'checkpoint' ->> 'cursorVersion')::bigint,
        v_cursor, v_cursor_fingerprint, v_provider_watermark_at,
        (p_command -> 'checkpoint' ->> 'overlapSeconds')::integer,
        1, v_task.sync_run_id, v_task.id, v_downstream_fingerprint,
        case when (p_command -> 'checkpoint' ->> 'fullReconciliation')::boolean
          then v_now else null end,
        p_request_id, v_request_fingerprint, v_now, v_now
      ) returning * into v_checkpoint;
    else
      if v_checkpoint.connection_generation <> v_task.connection_generation
        or v_checkpoint.stream_key <> v_task.stream_key
        or v_checkpoint.checkpoint_kind <>
          p_command -> 'checkpoint' ->> 'checkpointKind'
        or v_checkpoint.mapping_id is distinct from v_mapping_id
        or v_checkpoint.checkpoint_version <>
          (p_command -> 'checkpoint' ->> 'expectedCheckpointVersion')::bigint
        or v_checkpoint.lifecycle not in ('active', 'rebuilding') then
        raise exception using
          errcode = '40001',
          message = 'integration_sync_checkpoint_cas_stale';
      end if;
      update private.integration_sync_checkpoints as checkpoint
      set
        checkpoint_kind = checkpoint.checkpoint_kind,
        lifecycle = case when checkpoint.lifecycle = 'rebuilding'
          then 'active' else checkpoint.lifecycle end,
        cursor_version =
          (p_command -> 'checkpoint' ->> 'cursorVersion')::bigint,
        cursor_metadata = v_cursor,
        cursor_fingerprint = v_cursor_fingerprint,
        provider_watermark_at = v_provider_watermark_at,
        overlap_seconds =
          (p_command -> 'checkpoint' ->> 'overlapSeconds')::integer,
        checkpoint_version = checkpoint.checkpoint_version + 1,
        last_sync_run_id = v_task.sync_run_id,
        last_task_id = v_task.id,
        downstream_commit_fingerprint = v_downstream_fingerprint,
        last_full_reconciliation_at = case
          when (p_command -> 'checkpoint' ->> 'fullReconciliation')::boolean
            then v_now
          else checkpoint.last_full_reconciliation_at
        end,
        rebuilt_at = case when checkpoint.lifecycle = 'rebuilding'
          then v_now else checkpoint.rebuilt_at end,
        last_request_id = p_request_id,
        last_request_fingerprint = v_request_fingerprint,
        row_version = checkpoint.row_version + 1,
        updated_at = v_now
      where checkpoint.id = v_checkpoint.id
      returning checkpoint.* into v_checkpoint;
    end if;
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'succeeded',
    lease_id = null,
    lease_owner_fingerprint = null,
    lease_expires_at = null,
    heartbeat_at = null,
    failure_category = null,
    failure_code = null,
    durable_effect_fingerprint = v_effect_fingerprint,
    completed_at = v_now,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;

  v_event_id := case
    when v_task.control_metadata -> 'eventId' = 'null'::jsonb then null
    else (v_task.control_metadata ->> 'eventId')::uuid
  end;
  if v_event_id is not null then
    update private.integration_webhook_events as event
    set
      processing_state = 'processed',
      resulting_task_id = v_task.id,
      resulting_sync_run_id = v_task.sync_run_id,
      processed_at = v_now,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = event.row_version + 1,
      updated_at = v_now
    where event.id = v_event_id
      and event.workspace_id = v_task.workspace_id
      and event.business_entity_id = v_task.business_entity_id
      and event.connection_id = v_task.connection_id
      and event.processing_state in ('pending', 'coalesced')
      and (event.resulting_task_id is null or event.resulting_task_id = v_task.id);
    if not found then
      raise exception using
        errcode = '40001',
        message = 'integration_webhook_event_completion_stale';
    end if;
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.complete', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'checkpoint_lifecycle', case when v_checkpoint.id is null
        then null else v_checkpoint.lifecycle end,
      'checkpoint_version', case when v_checkpoint.id is null
        then 0 else v_checkpoint.checkpoint_version end,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );
  return private.phase_6_task_result_v1(v_task, false) ||
    pg_catalog.jsonb_build_object(
      'checkpointVersion', case when v_checkpoint.id is null
        then null else v_checkpoint.checkpoint_version end
    );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_completion_payload_invalid';
end;
$function$;

create or replace function public.fail_integration_sync_task_v1(
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
  v_task private.integration_sync_tasks;
  v_owner_fingerprint bytea;
  v_request_fingerprint bytea;
  v_retryable boolean;
  v_retry_after integer;
  v_backoff_seconds integer;
  v_target_state text;
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'leaseId', 'leaseOwnerFingerprint', 'failureCategory',
        'failureCode', 'retryable', 'retryAfterSeconds'
      ]
    )
    or p_command ->> 'failureCategory' not in (
      'authorization', 'rate_limit', 'availability', 'timeout', 'contract',
      'data_anomaly', 'integrity', 'cancelled', 'unknown'
    )
    or not private.is_bounded_identifier_v1(p_command ->> 'failureCode') then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_failure_payload_invalid';
  end if;
  v_retryable := (p_command ->> 'retryable')::boolean;
  v_retry_after := case
    when p_command -> 'retryAfterSeconds' = 'null'::jsonb then 0
    else (p_command ->> 'retryAfterSeconds')::integer
  end;
  if v_retry_after not between 0 and 86400
    or (v_retryable and p_command ->> 'failureCategory' not in (
      'rate_limit', 'availability', 'timeout', 'unknown'
    )) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_failure_payload_invalid';
  end if;
  v_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_failure_denied';
  end if;
  perform private.assert_phase_6_worker_for_queue_v1(v_task.queue_class);
  if v_task.state in ('retry_wait', 'failed', 'dead_letter')
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state <> 'leased'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <> v_owner_fingerprint then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_failure_stale';
  end if;

  if v_retryable and v_task.attempt_count < v_task.maximum_attempts then
    v_target_state := 'retry_wait';
    v_backoff_seconds := greatest(
      v_retry_after,
      least(
        3600,
        pg_catalog.power(2::numeric, v_task.attempt_count)::integer
          + (pg_catalog.get_byte(v_task.idempotency_fingerprint, 0) % 11)
      )
    );
  elsif v_retryable then
    v_target_state := 'dead_letter';
    v_backoff_seconds := 0;
  else
    v_target_state := 'failed';
    v_backoff_seconds := 0;
  end if;

  update private.integration_sync_tasks as task
  set
    state = v_target_state,
    dispatcher_task_name = null,
    lease_id = null,
    lease_owner_fingerprint = null,
    lease_expires_at = null,
    heartbeat_at = null,
    available_at = case when v_target_state = 'retry_wait'
      then v_now + pg_catalog.make_interval(secs => v_backoff_seconds)
      else task.available_at end,
    failure_category = p_command ->> 'failureCategory',
    failure_code = p_command ->> 'failureCode',
    completed_at = case when v_target_state in ('failed', 'dead_letter')
      then v_now else null end,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;
  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.fail', 'failed',
    'integration_sync_task', v_task.id::text, p_request_id,
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
  return private.phase_6_task_result_v1(v_task, false) ||
    pg_catalog.jsonb_build_object('retryAfterSeconds', v_backoff_seconds);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_failure_payload_invalid';
end;
$function$;

create or replace function public.cancel_integration_sync_task_v1(
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
  v_task private.integration_sync_tasks;
  v_request_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion'
      ]
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_cancel_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = (p_command ->> 'connectionGeneration')::bigint
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_cancel_denied';
  end if;
  if v_task.state = 'cancelled' then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state in ('succeeded', 'failed', 'dead_letter')
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_cancel_stale';
  end if;
  update private.integration_sync_tasks as task
  set
    state = 'cancelled',
    dispatcher_task_name = null,
    lease_id = null,
    lease_owner_fingerprint = null,
    lease_expires_at = null,
    heartbeat_at = null,
    cancel_requested_at = v_now,
    failure_category = 'cancelled',
    failure_code = 'runtime_cancelled',
    completed_at = v_now,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;
  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.cancel', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
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
      message = 'integration_sync_task_cancel_payload_invalid';
end;
$function$;

create or replace function public.sweep_integration_sync_tasks_v1(
  p_limit integer,
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
  v_task private.integration_sync_tasks;
  v_request_fingerprint bytea;
  v_recovered integer := 0;
  v_target_state text;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_limit not between 1 and 1000
    or p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_sweep_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    pg_catalog.jsonb_build_object('limit', p_limit)
  );

  for v_task in
    select task.*
    from private.integration_sync_tasks as task
    where (
      task.retention_expires_at <= v_now
      or (task.state = 'dispatched'
        and task.updated_at <= v_now - interval '15 minutes')
      or (task.state = 'leased' and task.lease_expires_at <= v_now)
      or (task.state = 'retry_wait' and task.available_at <= v_now)
    )
      and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
    order by
      case when task.retention_expires_at <= v_now then 0 else 1 end,
      task.updated_at,
      task.id
    for update skip locked
    limit p_limit
  loop
    if v_task.retention_expires_at <= v_now then
      v_target_state := 'cancelled';
    elsif v_task.state = 'leased' and v_task.attempt_count >= v_task.maximum_attempts then
      v_target_state := 'dead_letter';
    elsif v_task.state = 'leased' then
      v_target_state := 'retry_wait';
    else
      v_target_state := 'pending';
    end if;

    update private.integration_sync_tasks as task
    set
      state = v_target_state,
      dispatcher_task_name = null,
      lease_id = null,
      lease_owner_fingerprint = null,
      lease_expires_at = null,
      heartbeat_at = null,
      available_at = case when v_target_state in ('pending', 'retry_wait')
        then v_now else task.available_at end,
      cancel_requested_at = case when v_target_state = 'cancelled'
        then v_now else task.cancel_requested_at end,
      failure_category = case
        when v_target_state = 'cancelled' then 'cancelled'
        when v_task.state = 'leased' then 'timeout'
        else null
      end,
      failure_code = case
        when v_target_state = 'cancelled' then 'runtime_retention_expired'
        when v_task.state = 'leased' then 'runtime_lease_expired'
        else null
      end,
      completed_at = case when v_target_state in ('cancelled', 'dead_letter')
        then v_now else null end,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    v_recovered := v_recovered + 1;
    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
      p_actor_id, 'integration_sync_task.recover',
      case when v_target_state = 'dead_letter' then 'failed' else 'succeeded' end,
      'integration_sync_task', v_task.id::text, p_request_id,
      pg_catalog.jsonb_build_object(
        'task_state', v_task.state,
        'task_kind', v_task.task_kind,
        'queue_class', v_task.queue_class,
        'attempt_count', v_task.attempt_count,
        'dispatch_generation', v_task.dispatch_generation,
        'recovered_task_count', 1,
        'row_version', v_task.row_version,
        'idempotent', false
      )
    );
  end loop;
  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_recovered,
    'sweptAt', v_now
  );
end;
$function$;

create or replace function public.discover_integration_sync_due_work_v1(
  p_stale_before timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_stale_before is null
    or p_stale_before > pg_catalog.transaction_timestamp()
    or p_limit not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_due_work_query_invalid';
  end if;
  with ranked as (
    select
      checkpoint.id,
      checkpoint.workspace_id,
      checkpoint.business_entity_id,
      checkpoint.connection_id,
      checkpoint.connection_generation,
      checkpoint.mapping_id,
      checkpoint.stream_key,
      checkpoint.lifecycle,
      pg_catalog.row_number() over (
        partition by checkpoint.workspace_id
        order by checkpoint.updated_at, checkpoint.id
      ) as workspace_ordinal
    from private.integration_sync_checkpoints as checkpoint
    join private.integration_connections as connection
      on connection.workspace_id = checkpoint.workspace_id
      and connection.business_entity_id = checkpoint.business_entity_id
      and connection.id = checkpoint.connection_id
      and connection.connection_generation = checkpoint.connection_generation
    where checkpoint.lifecycle in ('active', 'invalidated', 'rebuilding')
      and checkpoint.updated_at <= p_stale_before
      and connection.status in ('initializing', 'active', 'degraded')
  ), fair as (
    select * from ranked
    order by workspace_ordinal, workspace_id, id
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'checkpointId', fair.id,
        'workspaceId', fair.workspace_id,
        'businessEntityId', fair.business_entity_id,
        'connectionId', fair.connection_id,
        'connectionGeneration', fair.connection_generation,
        'mappingId', fair.mapping_id,
        'streamKey', fair.stream_key,
        'lifecycle', fair.lifecycle
      ) order by fair.workspace_ordinal, fair.workspace_id, fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;
  return v_result;
end;
$function$;

create or replace function public.record_integration_webhook_event_v1(
  p_event jsonb,
  p_request_id text
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
  v_event private.integration_webhook_events;
  v_prior_event private.integration_webhook_events;
  v_request_fingerprint bytea;
  v_provider_event_fingerprint bytea;
  v_delivery_hash bytea;
  v_account_fingerprint bytea;
  v_entity_fingerprint bytea;
  v_verified_at timestamptz;
  v_connection_id uuid;
  v_mapping_id uuid;
  v_trusted_mapping_found boolean := false;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_webhook_ingress_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_event,
      array[
        'id', 'providerKey', 'providerEnvironment', 'specificationVersion',
        'eventType', 'providerEventFingerprint', 'deliveryHash',
        'providerAccountReferenceFingerprint', 'providerEntityType',
        'providerEntityReferenceFingerprint', 'verifiedAt'
      ]
    )
    or p_event ->> 'providerKey' !~ '^[a-z][a-z0-9_-]{0,63}$'
    or not private.is_bounded_identifier_v1(p_event ->> 'providerEnvironment')
    or not private.is_bounded_identifier_v1(p_event ->> 'specificationVersion')
    or not private.is_bounded_identifier_v1(p_event ->> 'eventType')
    or not private.is_bounded_identifier_v1(p_event ->> 'providerEntityType') then
    raise exception using
      errcode = '22023',
      message = 'integration_webhook_event_payload_invalid';
  end if;
  v_provider_event_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_event ->> 'providerEventFingerprint'
  );
  v_delivery_hash := private.sha256_fingerprint_bytes_v1(
    p_event ->> 'deliveryHash'
  );
  v_account_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_event ->> 'providerAccountReferenceFingerprint'
  );
  v_entity_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_event ->> 'providerEntityReferenceFingerprint'
  );
  v_verified_at := (p_event ->> 'verifiedAt')::timestamptz;
  if v_verified_at > v_now + interval '60 seconds'
    or v_verified_at < v_now - interval '7 days' then
    raise exception using
      errcode = '22023',
      message = 'integration_webhook_event_time_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_event
  );

  select event.* into v_event
  from private.integration_webhook_events as event
  where event.provider_key = p_event ->> 'providerKey'
    and event.provider_environment = p_event ->> 'providerEnvironment'
    and event.delivery_hash = v_delivery_hash
  for update;
  if found then
    if v_event.provider_event_fingerprint = v_provider_event_fingerprint
      and v_event.provider_account_reference_fingerprint = v_account_fingerprint
      and v_event.provider_entity_reference_fingerprint = v_entity_fingerprint then
      return pg_catalog.jsonb_build_object(
        'eventId', v_event.id,
        'verificationState', v_event.verification_state,
        'processingState', v_event.processing_state,
        'mapped', v_event.workspace_id is not null,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_webhook_delivery_conflict';
  end if;

  select connection.id, mapping.id
  into v_connection_id, v_mapping_id
  from private.provider_entity_mappings as mapping
  join private.integration_connections as connection
    on connection.workspace_id = mapping.workspace_id
    and connection.business_entity_id = mapping.business_entity_id
    and connection.id = mapping.connection_id
  where mapping.provider_key = p_event ->> 'providerKey'
    and mapping.provider_environment = p_event ->> 'providerEnvironment'
    and mapping.provider_entity_type = p_event ->> 'providerEntityType'
    and mapping.provider_entity_reference_fingerprint = v_entity_fingerprint
    and mapping.status = 'active'
    and connection.provider_tenant_reference_fingerprint = v_account_fingerprint
    and connection.status in ('initializing', 'active', 'degraded');

  if found then
    select connection.* into v_connection
    from private.integration_connections as connection
    where connection.id = v_connection_id
      and connection.provider_key = p_event ->> 'providerKey'
      and connection.provider_environment = p_event ->> 'providerEnvironment'
      and connection.provider_tenant_reference_fingerprint = v_account_fingerprint
      and connection.status in ('initializing', 'active', 'degraded')
    for update;

    if found then
      select mapping.* into v_mapping
      from private.provider_entity_mappings as mapping
      where mapping.id = v_mapping_id
        and mapping.workspace_id = v_connection.workspace_id
        and mapping.business_entity_id = v_connection.business_entity_id
        and mapping.connection_id = v_connection.id
        and mapping.provider_key = p_event ->> 'providerKey'
        and mapping.provider_environment = p_event ->> 'providerEnvironment'
        and mapping.provider_entity_type = p_event ->> 'providerEntityType'
        and mapping.provider_entity_reference_fingerprint = v_entity_fingerprint
        and mapping.status = 'active'
      for update;
      v_trusted_mapping_found := found;
    end if;
  end if;

  if v_trusted_mapping_found then
    select event.* into v_prior_event
    from private.integration_webhook_events as event
    where event.provider_key = p_event ->> 'providerKey'
      and event.provider_environment = p_event ->> 'providerEnvironment'
      and event.provider_event_fingerprint = v_provider_event_fingerprint
      and event.workspace_id = v_connection.workspace_id
      and event.connection_id = v_connection.id
    order by event.received_at, event.id
    limit 1;
    insert into private.integration_webhook_events (
      id, contract_version, provider_key, provider_environment,
      specification_version, event_type, provider_event_fingerprint,
      delivery_hash, provider_account_reference_fingerprint,
      provider_entity_type, provider_entity_reference_fingerprint,
      workspace_id, business_entity_id, connection_id,
      connection_generation, mapping_id, verification_state,
      processing_state, replay_of_event_id, verified_at, received_at,
      last_request_id, last_request_fingerprint, created_at, updated_at
    ) values (
      (p_event ->> 'id')::uuid, 'integration_webhook_event_v1',
      p_event ->> 'providerKey', p_event ->> 'providerEnvironment',
      p_event ->> 'specificationVersion', p_event ->> 'eventType',
      v_provider_event_fingerprint, v_delivery_hash, v_account_fingerprint,
      p_event ->> 'providerEntityType', v_entity_fingerprint,
      v_connection.workspace_id, v_connection.business_entity_id,
      v_connection.id, v_connection.connection_generation, v_mapping.id,
      'verified', 'pending', v_prior_event.id, v_verified_at, v_now,
      p_request_id, v_request_fingerprint, v_now, v_now
    ) returning * into v_event;
  else
    insert into private.integration_webhook_events (
      id, contract_version, provider_key, provider_environment,
      specification_version, event_type, provider_event_fingerprint,
      delivery_hash, provider_account_reference_fingerprint,
      provider_entity_type, provider_entity_reference_fingerprint,
      verification_state, processing_state, failure_category, failure_code,
      verified_at, received_at, processed_at, last_request_id,
      last_request_fingerprint, created_at, updated_at
    ) values (
      (p_event ->> 'id')::uuid, 'integration_webhook_event_v1',
      p_event ->> 'providerKey', p_event ->> 'providerEnvironment',
      p_event ->> 'specificationVersion', p_event ->> 'eventType',
      v_provider_event_fingerprint, v_delivery_hash, v_account_fingerprint,
      p_event ->> 'providerEntityType', v_entity_fingerprint,
      'rejected', 'rejected', 'authorization', 'trusted_mapping_unresolved',
      v_verified_at, v_now, v_now, p_request_id, v_request_fingerprint,
      v_now, v_now
    ) returning * into v_event;
  end if;

  perform private.phase_6_insert_audit_v1(
    v_event.workspace_id, v_event.business_entity_id, v_event.connection_id,
    'verified-webhook-ingress', 'integration_webhook_event.record',
    case when v_event.verification_state = 'verified'
      then 'succeeded' else 'denied' end,
    'integration_webhook_event', v_event.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'webhook_processing_state', v_event.processing_state,
      'row_version', v_event.row_version,
      'idempotent', false
    )
  );
  return pg_catalog.jsonb_build_object(
    'eventId', v_event.id,
    'verificationState', v_event.verification_state,
    'processingState', v_event.processing_state,
    'mapped', v_event.workspace_id is not null,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_webhook_delivery_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow then
    raise exception using
      errcode = '22023',
      message = 'integration_webhook_event_payload_invalid';
end;
$function$;

create or replace function public.bind_integration_webhook_event_task_v1(
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
  v_event private.integration_webhook_events;
  v_prior_event private.integration_webhook_events;
  v_task_result jsonb;
  v_request_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['eventId', 'task']
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_webhook_task_binding_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select event.* into v_event
  from private.integration_webhook_events as event
  where event.id = (p_command ->> 'eventId')::uuid
  for update;
  if not found or v_event.verification_state <> 'verified' then
    raise exception using
      errcode = '42501',
      message = 'integration_webhook_task_binding_denied';
  end if;
  if p_command -> 'task' ->> 'workspaceId' <> v_event.workspace_id::text
    or p_command -> 'task' ->> 'businessEntityId' <> v_event.business_entity_id::text
    or p_command -> 'task' ->> 'connectionId' <> v_event.connection_id::text
    or (p_command -> 'task' ->> 'connectionGeneration')::bigint <>
      v_event.connection_generation
    or p_command -> 'task' ->> 'providerKey' <> v_event.provider_key
    or p_command -> 'task' ->> 'providerEnvironment' <> v_event.provider_environment
    or p_command -> 'task' ->> 'taskKind' <> 'webhook_targeted_read'
    or p_command -> 'task' ->> 'queueClass' <> 'provider_interactive'
    or p_command -> 'task' -> 'controlMetadata' ->> 'eventId' <> v_event.id::text
    or p_command -> 'task' -> 'controlMetadata' ->> 'mappingId' <> v_event.mapping_id::text then
    raise exception using
      errcode = '42501',
      message = 'integration_webhook_task_scope_denied';
  end if;
  if v_event.processing_state in ('coalesced', 'processed')
    and v_event.resulting_task_id = (p_command -> 'task' ->> 'id')::uuid then
    return pg_catalog.jsonb_build_object(
      'eventId', v_event.id,
      'taskId', v_event.resulting_task_id,
      'syncRunId', v_event.resulting_sync_run_id,
      'processingState', v_event.processing_state,
      'idempotent', true
    );
  end if;
  if v_event.processing_state <> 'pending' then
    raise exception using
      errcode = '40001',
      message = 'integration_webhook_task_binding_stale';
  end if;

  if v_event.replay_of_event_id is not null then
    select event.* into v_prior_event
    from private.integration_webhook_events as event
    where event.id = v_event.replay_of_event_id
    for update;
  end if;
  if v_prior_event.resulting_task_id is not null then
    update private.integration_webhook_events as event
    set
      processing_state = 'coalesced',
      resulting_task_id = v_prior_event.resulting_task_id,
      resulting_sync_run_id = v_prior_event.resulting_sync_run_id,
      processed_at = v_now,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = event.row_version + 1,
      updated_at = v_now
    where event.id = v_event.id
    returning event.* into v_event;
    return pg_catalog.jsonb_build_object(
      'eventId', v_event.id,
      'taskId', v_event.resulting_task_id,
      'syncRunId', v_event.resulting_sync_run_id,
      'processingState', v_event.processing_state,
      'idempotent', true
    );
  end if;

  v_task_result := public.create_integration_sync_task_v1(
    p_command -> 'task',
    p_request_id || ':task',
    p_actor_id
  );
  update private.integration_webhook_events as event
  set
    processing_state = 'coalesced',
    resulting_task_id = (v_task_result ->> 'taskId')::uuid,
    resulting_sync_run_id = (v_task_result ->> 'syncRunId')::uuid,
    processed_at = v_now,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = event.row_version + 1,
    updated_at = v_now
  where event.id = v_event.id
  returning event.* into v_event;
  perform private.phase_6_insert_audit_v1(
    v_event.workspace_id, v_event.business_entity_id, v_event.connection_id,
    p_actor_id, 'integration_webhook_event.bind_task', 'succeeded',
    'integration_webhook_event', v_event.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'webhook_processing_state', v_event.processing_state,
      'task_state', v_task_result ->> 'state',
      'row_version', v_event.row_version,
      'idempotent', (v_task_result ->> 'idempotent')::boolean
    )
  );
  return pg_catalog.jsonb_build_object(
    'eventId', v_event.id,
    'taskId', v_event.resulting_task_id,
    'syncRunId', v_event.resulting_sync_run_id,
    'processingState', v_event.processing_state,
    'idempotent', (v_task_result ->> 'idempotent')::boolean
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_webhook_task_binding_payload_invalid';
end;
$function$;

create or replace function public.transition_integration_runtime_circuit_v1(
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
  v_circuit private.integration_runtime_circuits;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_provider_key text;
  v_provider_environment text;
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_connection_id uuid;
  v_open_seconds integer;
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'id', 'circuitScope', 'circuitLevel', 'providerKey',
        'providerEnvironment', 'workspaceId', 'businessEntityId',
        'connectionId', 'expectedRowVersion', 'targetState',
        'reasonCode', 'openSeconds'
      ]
    )
    or p_command ->> 'circuitScope' not in (
      'provider_api', 'credentials', 'queue_runtime',
      'data_anomaly', 'deterministic_integrity'
    )
    or p_command ->> 'circuitLevel' not in (
      'global', 'provider', 'workspace', 'connection'
    )
    or p_command ->> 'targetState' not in ('closed', 'open', 'half_open')
    or not private.is_bounded_identifier_v1(p_command ->> 'reasonCode') then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_circuit_payload_invalid';
  end if;

  if p_command ->> 'circuitScope' = 'deterministic_integrity' then
    perform private.assert_phase_6_authority_v1(
      'integration_deterministic_runtime_authority'
    );
  elsif p_command ->> 'circuitScope' = 'queue_runtime' then
    perform private.assert_phase_6_authority_v1(
      'integration_task_dispatch_authority'
    );
  elsif p_command ->> 'circuitScope' = 'credentials' then
    if not pg_catalog.pg_has_role(
      session_user,
      'integration_credential_broker_authority',
      'MEMBER'
    ) then
      raise exception using
        errcode = '42501',
        message = 'integration_runtime_circuit_authority_required';
    end if;
  else
    perform private.assert_phase_6_authority_v1(
      'integration_provider_runtime_authority'
    );
  end if;

  v_provider_key := case when p_command -> 'providerKey' = 'null'::jsonb
    then null else p_command ->> 'providerKey' end;
  v_provider_environment := case
    when p_command -> 'providerEnvironment' = 'null'::jsonb then null
    else p_command ->> 'providerEnvironment' end;
  v_workspace_id := case when p_command -> 'workspaceId' = 'null'::jsonb
    then null else (p_command ->> 'workspaceId')::uuid end;
  v_business_entity_id := case
    when p_command -> 'businessEntityId' = 'null'::jsonb then null
    else (p_command ->> 'businessEntityId')::uuid end;
  v_connection_id := case when p_command -> 'connectionId' = 'null'::jsonb
    then null else (p_command ->> 'connectionId')::uuid end;
  v_open_seconds := case when p_command -> 'openSeconds' = 'null'::jsonb
    then null else (p_command ->> 'openSeconds')::integer end;
  if (p_command ->> 'targetState' = 'open') <> (v_open_seconds is not null)
    or (v_open_seconds is not null and v_open_seconds not between 1 and 86400)
    or not (
      (p_command ->> 'circuitLevel' = 'global'
        and v_provider_key is null and v_provider_environment is null
        and v_workspace_id is null and v_business_entity_id is null
        and v_connection_id is null)
      or (p_command ->> 'circuitLevel' = 'provider'
        and v_provider_key is not null and v_provider_environment is not null
        and v_workspace_id is null and v_business_entity_id is null
        and v_connection_id is null)
      or (p_command ->> 'circuitLevel' = 'workspace'
        and v_provider_key is not null and v_provider_environment is not null
        and v_workspace_id is not null and v_business_entity_id is null
        and v_connection_id is null)
      or (p_command ->> 'circuitLevel' = 'connection'
        and v_provider_key is not null and v_provider_environment is not null
        and v_workspace_id is not null and v_business_entity_id is not null
        and v_connection_id is not null)
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_circuit_scope_invalid';
  end if;
  if v_connection_id is not null then
    select connection.* into v_connection
    from private.integration_connections as connection
    where connection.workspace_id = v_workspace_id
      and connection.business_entity_id = v_business_entity_id
      and connection.id = v_connection_id
      and connection.provider_key = v_provider_key
      and connection.provider_environment = v_provider_environment
    for share;
    if not found then
      raise exception using
        errcode = '42501',
        message = 'integration_runtime_circuit_scope_denied';
    end if;
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select circuit.* into v_circuit
  from private.integration_runtime_circuits as circuit
  where circuit.circuit_scope = p_command ->> 'circuitScope'
    and circuit.circuit_level = p_command ->> 'circuitLevel'
    and circuit.provider_key is not distinct from v_provider_key
    and circuit.provider_environment is not distinct from v_provider_environment
    and circuit.workspace_id is not distinct from v_workspace_id
    and circuit.business_entity_id is not distinct from v_business_entity_id
    and circuit.connection_id is not distinct from v_connection_id
  for update;
  if not found then
    if (p_command ->> 'expectedRowVersion')::bigint <> 0
      or p_command ->> 'targetState' <> 'closed' then
      raise exception using
        errcode = '40001',
        message = 'integration_runtime_circuit_cas_stale';
    end if;
    insert into private.integration_runtime_circuits (
      id, contract_version, circuit_scope, circuit_level, provider_key,
      provider_environment, workspace_id, business_entity_id, connection_id,
      state, reason_code, failure_count, success_count, open_until,
      last_request_id, last_request_fingerprint, created_at, updated_at
    ) values (
      (p_command ->> 'id')::uuid, 'integration_runtime_circuit_v1',
      p_command ->> 'circuitScope', p_command ->> 'circuitLevel',
      v_provider_key, v_provider_environment, v_workspace_id,
      v_business_entity_id, v_connection_id, p_command ->> 'targetState',
      p_command ->> 'reasonCode',
      case when p_command ->> 'targetState' = 'open' then 1 else 0 end,
      case when p_command ->> 'targetState' = 'closed' then 1 else 0 end,
      case when p_command ->> 'targetState' = 'open'
        then v_now + pg_catalog.make_interval(secs => v_open_seconds)
        else null end,
      p_request_id, v_request_fingerprint, v_now, v_now
    ) returning * into v_circuit;
  else
    if v_circuit.state = p_command ->> 'targetState'
      and v_circuit.last_request_id = p_request_id
      and v_circuit.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'circuitId', v_circuit.id,
        'state', v_circuit.state,
        'rowVersion', v_circuit.row_version,
        'idempotent', true
      );
    end if;
    if v_circuit.row_version <>
      (p_command ->> 'expectedRowVersion')::bigint
      or not (
        (v_circuit.state = 'closed' and p_command ->> 'targetState' = 'open')
        or (v_circuit.state = 'open'
          and p_command ->> 'targetState' = 'half_open'
          and v_circuit.open_until <= v_now)
        or (v_circuit.state = 'half_open'
          and p_command ->> 'targetState' in ('closed', 'open'))
      ) then
      raise exception using
        errcode = '40001',
        message = 'integration_runtime_circuit_cas_stale';
    end if;
    update private.integration_runtime_circuits as circuit
    set
      state = p_command ->> 'targetState',
      reason_code = p_command ->> 'reasonCode',
      failure_count = circuit.failure_count +
        case when p_command ->> 'targetState' = 'open' then 1 else 0 end,
      success_count = circuit.success_count +
        case when p_command ->> 'targetState' = 'closed' then 1 else 0 end,
      open_until = case when p_command ->> 'targetState' = 'open'
        then v_now + pg_catalog.make_interval(secs => v_open_seconds)
        else null end,
      half_open_lease_id = case when p_command ->> 'targetState' = 'half_open'
        then pg_catalog.gen_random_uuid() else null end,
      half_open_lease_expires_at = case
        when p_command ->> 'targetState' = 'half_open'
          then v_now + interval '5 minutes'
        else null end,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = circuit.row_version + 1,
      updated_at = v_now
    where circuit.id = v_circuit.id
    returning circuit.* into v_circuit;
  end if;
  perform private.phase_6_insert_audit_v1(
    v_circuit.workspace_id, v_circuit.business_entity_id,
    v_circuit.connection_id, p_actor_id,
    'integration_runtime_circuit.transition', 'succeeded',
    'integration_runtime_circuit', v_circuit.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'circuit_state', v_circuit.state,
      'circuit_scope', v_circuit.circuit_scope,
      'row_version', v_circuit.row_version,
      'idempotent', false
    )
  );
  return pg_catalog.jsonb_build_object(
    'circuitId', v_circuit.id,
    'state', v_circuit.state,
    'rowVersion', v_circuit.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_runtime_circuit_scope_conflict';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_circuit_payload_invalid';
end;
$function$;

create or replace function public.acquire_integration_runtime_rate_permit_v1(
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
  v_state private.integration_rate_limit_states;
  v_connection private.integration_connections;
  v_request_fingerprint bytea;
  v_workspace_id uuid;
  v_connection_id uuid;
  v_capacity bigint;
  v_refill bigint;
  v_cost bigint;
  v_maximum_concurrency integer;
  v_retry_after integer;
  v_refilled_available bigint;
  v_allowed boolean := false;
  v_blocked_until timestamptz;
  v_adaptive_concurrency integer;
  v_consecutive_limited integer;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'id', 'providerKey', 'providerEnvironment', 'workspaceId',
        'connectionId', 'expectedRowVersion', 'capacityMilli',
        'refillMilliPerSecond', 'costMilli', 'maximumConcurrency',
        'observedRetryAfterSeconds', 'observationCategory', 'policyVersion'
      ]
    )
    or p_command ->> 'providerKey' !~ '^[a-z][a-z0-9_-]{0,63}$'
    or not private.is_bounded_identifier_v1(p_command ->> 'providerEnvironment')
    or not private.is_bounded_identifier_v1(p_command ->> 'policyVersion')
    or p_command ->> 'observationCategory' not in (
      'none', 'rate_limit', 'availability', 'authorization'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_rate_limit_payload_invalid';
  end if;
  v_workspace_id := case when p_command -> 'workspaceId' = 'null'::jsonb
    then null else (p_command ->> 'workspaceId')::uuid end;
  v_connection_id := case when p_command -> 'connectionId' = 'null'::jsonb
    then null else (p_command ->> 'connectionId')::uuid end;
  v_capacity := (p_command ->> 'capacityMilli')::bigint;
  v_refill := (p_command ->> 'refillMilliPerSecond')::bigint;
  v_cost := (p_command ->> 'costMilli')::bigint;
  v_maximum_concurrency := (p_command ->> 'maximumConcurrency')::integer;
  v_retry_after := case
    when p_command -> 'observedRetryAfterSeconds' = 'null'::jsonb then 0
    else (p_command ->> 'observedRetryAfterSeconds')::integer end;
  if v_capacity not between 1000 and 1000000
    or v_refill not between 1 and 1000000
    or v_cost not between 1 and v_capacity
    or v_maximum_concurrency not between 1 and 1000
    or v_retry_after not between 0 and 86400
    or (v_connection_id is not null and v_workspace_id is null) then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_rate_limit_payload_invalid';
  end if;
  if v_connection_id is not null then
    select connection.* into v_connection
    from private.integration_connections as connection
    where connection.id = v_connection_id
      and connection.workspace_id = v_workspace_id
      and connection.provider_key = p_command ->> 'providerKey'
      and connection.provider_environment = p_command ->> 'providerEnvironment'
    for share;
    if not found then
      raise exception using
        errcode = '42501',
        message = 'integration_runtime_rate_limit_scope_denied';
    end if;
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select state.* into v_state
  from private.integration_rate_limit_states as state
  where state.provider_key = p_command ->> 'providerKey'
    and state.provider_environment = p_command ->> 'providerEnvironment'
    and state.workspace_id is not distinct from v_workspace_id
    and state.connection_id is not distinct from v_connection_id
  for update;
  if found then
    if v_state.last_request_id = p_request_id
      and v_state.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'rateLimitStateId', v_state.id,
        'allowed', v_state.last_permit_allowed,
        'availableMilli', v_state.available_milli,
        'adaptiveConcurrency', v_state.adaptive_concurrency,
        'blockedUntil', v_state.blocked_until,
        'rowVersion', v_state.row_version,
        'idempotent', true
      );
    end if;
    if v_state.row_version <> (p_command ->> 'expectedRowVersion')::bigint
      or v_state.capacity_milli <> v_capacity
      or v_state.refill_milli_per_second <> v_refill
      or v_state.maximum_concurrency <> v_maximum_concurrency
      or v_state.policy_version <> p_command ->> 'policyVersion' then
      raise exception using
        errcode = '40001',
        message = 'integration_runtime_rate_limit_cas_stale';
    end if;
    v_refilled_available := least(
      v_capacity,
      v_state.available_milli + pg_catalog.floor(
        greatest(
          0::numeric,
          extract(epoch from (v_now - v_state.last_refill_at))
        ) * v_refill
      )::bigint
    );
    v_adaptive_concurrency := v_state.adaptive_concurrency;
    v_consecutive_limited := v_state.consecutive_limited;
    v_blocked_until := v_state.blocked_until;
  else
    if (p_command ->> 'expectedRowVersion')::bigint <> 0 then
      raise exception using
        errcode = '40001',
        message = 'integration_runtime_rate_limit_cas_stale';
    end if;
    v_refilled_available := v_capacity;
    v_adaptive_concurrency := v_maximum_concurrency;
    v_consecutive_limited := 0;
    v_blocked_until := null;
  end if;

  if p_command ->> 'observationCategory' = 'rate_limit' then
    v_allowed := false;
    v_consecutive_limited := v_consecutive_limited + 1;
    v_adaptive_concurrency := greatest(
      1,
      pg_catalog.floor(v_adaptive_concurrency / 2.0)::integer
    );
    v_blocked_until := v_now + pg_catalog.make_interval(
      secs => greatest(1, v_retry_after)
    );
  elsif p_command ->> 'observationCategory' = 'authorization' then
    v_allowed := false;
    v_consecutive_limited := v_consecutive_limited + 1;
    v_adaptive_concurrency := 1;
    v_blocked_until := v_now + pg_catalog.make_interval(
      secs => greatest(3600, v_retry_after)
    );
  elsif p_command ->> 'observationCategory' = 'availability' then
    v_allowed := false;
    v_consecutive_limited := v_consecutive_limited + 1;
    v_adaptive_concurrency := greatest(1, v_adaptive_concurrency - 1);
    v_blocked_until := v_now + pg_catalog.make_interval(
      secs => greatest(1, v_retry_after)
    );
  elsif v_blocked_until is not null and v_blocked_until > v_now then
    v_allowed := false;
  elsif v_refilled_available >= v_cost then
    v_allowed := true;
    v_refilled_available := v_refilled_available - v_cost;
    v_consecutive_limited := 0;
    v_adaptive_concurrency := least(
      v_maximum_concurrency,
      v_adaptive_concurrency + 1
    );
    v_blocked_until := null;
  else
    v_allowed := false;
  end if;

  if v_state.id is null then
    insert into private.integration_rate_limit_states (
      id, contract_version, provider_key, provider_environment, workspace_id,
      connection_id, capacity_milli, available_milli,
      refill_milli_per_second, maximum_concurrency, adaptive_concurrency,
      consecutive_limited, blocked_until, last_refill_at, last_observed_at,
      policy_version, last_request_id, last_request_fingerprint,
      last_permit_allowed, created_at, updated_at
    ) values (
      (p_command ->> 'id')::uuid, 'integration_rate_limit_state_v1',
      p_command ->> 'providerKey', p_command ->> 'providerEnvironment',
      v_workspace_id, v_connection_id, v_capacity, v_refilled_available,
      v_refill, v_maximum_concurrency, v_adaptive_concurrency,
      v_consecutive_limited, v_blocked_until, v_now, v_now,
      p_command ->> 'policyVersion', p_request_id, v_request_fingerprint,
      v_allowed, v_now, v_now
    ) returning * into v_state;
  else
    update private.integration_rate_limit_states as state
    set
      available_milli = v_refilled_available,
      adaptive_concurrency = v_adaptive_concurrency,
      consecutive_limited = v_consecutive_limited,
      blocked_until = v_blocked_until,
      last_refill_at = v_now,
      last_observed_at = v_now,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      last_permit_allowed = v_allowed,
      row_version = state.row_version + 1,
      updated_at = v_now
    where state.id = v_state.id
    returning state.* into v_state;
  end if;
  perform private.phase_6_insert_audit_v1(
    v_state.workspace_id, null, v_state.connection_id, p_actor_id,
    'integration_runtime_rate_limit.acquire',
    case when v_allowed then 'allowed' else 'denied' end,
    'integration_rate_limit_state', v_state.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'rate_limit_allowed', v_allowed,
      'row_version', v_state.row_version,
      'idempotent', false
    )
  );
  return pg_catalog.jsonb_build_object(
    'rateLimitStateId', v_state.id,
    'allowed', v_allowed,
    'availableMilli', v_state.available_milli,
    'adaptiveConcurrency', v_state.adaptive_concurrency,
    'blockedUntil', v_state.blocked_until,
    'rowVersion', v_state.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_runtime_rate_limit_scope_conflict';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_runtime_rate_limit_payload_invalid';
end;
$function$;

revoke all on function public.create_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.create_integration_sync_task_v1(jsonb, text, text)
  to integration_task_dispatch_authority;

revoke all on function public.discover_integration_sync_dispatch_v1(text, integer)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.discover_integration_sync_dispatch_v1(text, integer)
  to integration_task_dispatch_authority;

revoke all on function public.mark_integration_sync_task_dispatched_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.mark_integration_sync_task_dispatched_v1(jsonb, text, text)
  to integration_task_dispatch_authority;

revoke all on function public.lease_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.lease_integration_sync_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function public.heartbeat_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.heartbeat_integration_sync_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function public.complete_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.complete_integration_sync_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function public.fail_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.fail_integration_sync_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function public.cancel_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.cancel_integration_sync_task_v1(jsonb, text, text)
  to integration_task_dispatch_authority;

revoke all on function public.sweep_integration_sync_tasks_v1(integer, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.sweep_integration_sync_tasks_v1(integer, text, text)
  to integration_task_dispatch_authority;

revoke all on function public.discover_integration_sync_due_work_v1(timestamptz, integer)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.discover_integration_sync_due_work_v1(timestamptz, integer)
  to integration_task_dispatch_authority;

revoke all on function public.record_integration_webhook_event_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.record_integration_webhook_event_v1(jsonb, text)
  to integration_webhook_ingress_authority;

revoke all on function public.bind_integration_webhook_event_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.bind_integration_webhook_event_task_v1(jsonb, text, text)
  to integration_task_dispatch_authority;

revoke all on function public.transition_integration_runtime_circuit_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.transition_integration_runtime_circuit_v1(jsonb, text, text)
  to integration_credential_broker_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

revoke all on function public.acquire_integration_runtime_rate_permit_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.acquire_integration_runtime_rate_permit_v1(jsonb, text, text)
  to integration_provider_runtime_authority;

revoke all on function private.assert_phase_6_authority_v1(text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority, integration_webhook_ingress_authority,
    integration_task_dispatch_authority, integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on function private.is_integration_audit_metadata_v6(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.phase_6_request_fingerprint_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.is_phase_6_control_metadata_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.is_phase_6_cursor_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.is_phase_6_task_transition_v1(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_integration_sync_task_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_integration_sync_checkpoint_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_integration_webhook_event_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_integration_runtime_circuit_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_integration_rate_limit_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_phase_6_connection_deletion_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.phase_6_task_result_v1(private.integration_sync_tasks, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.phase_6_insert_audit_v1(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.assert_phase_6_worker_for_queue_v1(text)
  from public, anon, authenticated, service_role;

commit;
