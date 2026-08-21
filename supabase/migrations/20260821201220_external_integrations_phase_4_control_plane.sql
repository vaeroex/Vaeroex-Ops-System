-- External Integrations Phase 4: Provider-Neutral Connector Control Plane
--
-- This migration persists deterministic lifecycle metadata only. It introduces
-- no provider authentication, secret material, provider calls, durable queue,
-- webhook, AI, Business State Delta, customer UI, or KPI promotion behavior.

begin;

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'integration_control_plane_authority'
  ) then
    create role integration_control_plane_authority nologin noinherit;
  end if;
end;
$role$;

revoke integration_control_plane_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority;
revoke external_integrations_authority from integration_control_plane_authority;
revoke deterministic_calculation_authority from integration_control_plane_authority;
revoke all on schema private from integration_control_plane_authority;

create or replace function private.assert_integration_control_plane_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_control_plane_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_control_plane_authority_required';
  end if;
end;
$function$;

create or replace function private.is_integration_audit_metadata_v4(p_value jsonb)
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
      'idempotent'
    ]::text[]) = '{}'::jsonb
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v4(metadata));

create or replace function private.phase_4_fingerprint_text_v1(p_value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(p_value, 'hex');
$function$;

create or replace function private.phase_4_request_fingerprint_v1(
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
      'fingerprintPurpose', 'integration_control_plane_request',
      'fingerprintVersion', 'integration_control_plane_request_fingerprint_v1',
      'payload', pg_catalog.jsonb_build_object(
        'requestId', p_request_id,
        'command', p_command
      )
    )
  );
$function$;

create or replace function private.is_phase_4_provider_descriptor_v1(
  p_provider_key text,
  p_provider_environment text,
  p_registry_version text,
  p_registry_fingerprint bytea,
  p_descriptor_fingerprint bytea,
  p_adapter_version text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_provider_key = 'synthetic'
    and p_provider_environment = 'test'
    and p_registry_version = 'vaeroex_provider_descriptors_v1'
    and p_registry_fingerprint = pg_catalog.decode(
      'f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80',
      'hex'
    )
    and p_descriptor_fingerprint = pg_catalog.decode(
      'd5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1',
      'hex'
    )
    and p_adapter_version = 'synthetic_control_plane_adapter_v1';
$function$;

create or replace function private.is_phase_4_capability_snapshot_v1(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'operations',
        'domains',
        'requiredStreamKeys',
        'supportsBackfill',
        'webhookMode',
        'incrementalMode'
      ]
    )
    and p_value = pg_catalog.jsonb_build_object(
      'operations', pg_catalog.jsonb_build_array(
        'get_capabilities',
        'get_source_record',
        'list_entities',
        'list_source_records'
      ),
      'domains', pg_catalog.jsonb_build_array('general_ledger'),
      'requiredStreamKeys', pg_catalog.jsonb_build_array('general_ledger'),
      'supportsBackfill', true,
      'webhookMode', 'none',
      'incrementalMode', 'cursor'
    );
$function$;

create or replace function private.is_phase_4_scope_set_v1(p_values text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_bounded_identifier_array_v1(p_values, 64)
    and 'read_synthetic_business_data' = any(p_values)
    and p_values <@ array[
      'read_synthetic_business_data',
      'read_synthetic_reference_data'
    ]::text[];
$function$;

create or replace function private.is_phase_4_freshness_policy_v1(
  p_provider_key text,
  p_provider_environment text,
  p_policy_version text,
  p_current_max_age_seconds bigint,
  p_stale_after_seconds bigint,
  p_stale_blocking_level text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_provider_key = 'synthetic'
    and p_provider_environment = 'test'
    and p_policy_version = 'synthetic_freshness_policy_v1'
    and p_current_max_age_seconds = 3600
    and p_stale_after_seconds = 7200
    and p_stale_blocking_level = 'current_intelligence';
$function$;

create or replace function private.is_integration_connection_transition_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_from = p_to
    or (p_from = 'pending_authorization' and p_to = any(array[
      'authorized_unmapped', 'error', 'deleting'
    ]::text[]))
    or (p_from = 'authorized_unmapped' and p_to = any(array[
      'initializing', 'reauthorization_required', 'disconnecting', 'deleting'
    ]::text[]))
    or (p_from = 'initializing' and p_to = any(array[
      'active', 'degraded', 'error', 'reauthorization_required',
      'disconnecting', 'deleting'
    ]::text[]))
    or (p_from = 'active' and p_to = any(array[
      'degraded', 'reauthorization_required', 'disconnecting', 'deleting'
    ]::text[]))
    or (p_from = 'degraded' and p_to = any(array[
      'active', 'error', 'reauthorization_required', 'disconnecting', 'deleting'
    ]::text[]))
    or (p_from = 'error' and p_to = any(array[
      'pending_authorization', 'initializing', 'disconnected', 'deleting'
    ]::text[]))
    or (p_from = 'reauthorization_required' and p_to = any(array[
      'pending_authorization', 'disconnecting', 'deleting'
    ]::text[]))
    or (p_from = 'disconnecting' and p_to = any(array[
      'disconnected', 'deleting'
    ]::text[]))
    or (p_from = 'disconnected' and p_to = any(array[
      'pending_authorization', 'deleting'
    ]::text[]))
    or (p_from = 'deleting' and p_to = 'deleted');
$function$;

create or replace function private.is_integration_connection_reason_v1(
  p_status text,
  p_reason text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select (p_status = 'pending_authorization' and p_reason = any(array[
      'authorization_pending', 'authorization_required'
    ]::text[]))
    or (p_status = 'authorized_unmapped' and p_reason = any(array[
      'authorization_completed', 'mapping_required'
    ]::text[]))
    or (p_status = 'initializing' and p_reason = 'initial_sync_pending')
    or (p_status = 'active' and p_reason = 'healthy')
    or (p_status = 'degraded' and p_reason = any(array[
      'freshness_warning', 'control_plane_error'
    ]::text[]))
    or (p_status = 'error' and p_reason = 'control_plane_error')
    or (p_status = 'reauthorization_required' and p_reason = 'authorization_required')
    or (p_status = 'disconnecting' and p_reason = 'customer_disconnect_requested')
    or (p_status = 'disconnected' and p_reason = 'disconnected')
    or (p_status = 'deleting' and p_reason = 'deletion_requested')
    or (p_status = 'deleted' and p_reason = 'deleted');
$function$;

create or replace function private.is_provider_entity_mapping_transition_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_from = p_to
    or (p_from = 'pending_verification' and p_to = any(array['active', 'inactive']::text[]))
    or (p_from = 'active' and p_to = any(array['inactive', 'replaced']::text[]))
    or (p_from = 'inactive' and p_to = any(array['pending_verification', 'replaced']::text[]));
$function$;

create or replace function private.is_integration_sync_run_transition_v1(
  p_from text,
  p_to text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_from = p_to
    or (p_from = 'created' and p_to = any(array['running', 'cancelled']::text[]))
    or (p_from = 'running' and p_to = any(array[
      'succeeded', 'partially_succeeded', 'failed', 'cancelled'
    ]::text[]));
$function$;

create table private.integration_connections (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_connection_v1'),
  control_contract_version text not null
    check (control_contract_version = 'integration_connection_control_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  connection_series_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  replaces_connection_id uuid,
  provider_key text not null
    check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null
    check (private.is_bounded_identifier_v1(provider_environment)),
  provider_tenant_reference_fingerprint bytea check (
    provider_tenant_reference_fingerprint is null
    or pg_catalog.octet_length(provider_tenant_reference_fingerprint) = 32
  ),
  status text not null check (status in (
    'pending_authorization',
    'authorized_unmapped',
    'initializing',
    'active',
    'degraded',
    'error',
    'reauthorization_required',
    'disconnecting',
    'disconnected',
    'deleting',
    'deleted'
  )),
  state_reason_code text not null
    check (private.is_integration_connection_reason_v1(status, state_reason_code)),
  requested_scopes text[] not null,
  granted_scopes text[] not null default '{}'::text[],
  safe_display_name text not null check (private.is_bounded_label_v1(safe_display_name)),
  provider_descriptor_registry_version text not null,
  provider_descriptor_registry_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_descriptor_registry_fingerprint) = 32),
  provider_descriptor_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_descriptor_fingerprint) = 32),
  adapter_version text not null check (private.is_bounded_identifier_v1(adapter_version)),
  capability_snapshot jsonb not null
    check (private.is_phase_4_capability_snapshot_v1(capability_snapshot)),
  configuration_version bigint not null check (configuration_version > 0),
  authorized_at timestamptz,
  status_changed_at timestamptz not null,
  disconnected_at timestamptz,
  deleted_at timestamptz,
  last_transition_request_id text
    check (last_transition_request_id is null or char_length(last_transition_request_id) between 1 and 200),
  last_transition_request_fingerprint bytea check (
    last_transition_request_fingerprint is null
    or pg_catalog.octet_length(last_transition_request_fingerprint) = 32
  ),
  row_version bigint not null default 1 check (row_version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint integration_connections_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint integration_connections_series_generation_key unique (
    workspace_id, business_entity_id, connection_series_id, connection_generation
  ),
  constraint integration_connections_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint integration_connections_replaces_fkey foreign key (
    workspace_id, business_entity_id, replaces_connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint integration_connections_generation_check check (
    (
      connection_generation = 1
      and connection_series_id = id
      and replaces_connection_id is null
    )
    or (
      connection_generation > 1
      and connection_series_id <> id
      and replaces_connection_id is not null
    )
  ),
  constraint integration_connections_scope_check check (
    private.is_phase_4_scope_set_v1(requested_scopes)
    and private.is_bounded_identifier_array_v1(granted_scopes, 64)
    and granted_scopes <@ requested_scopes
  ),
  constraint integration_connections_descriptor_check check (
    private.is_phase_4_provider_descriptor_v1(
      provider_key,
      provider_environment,
      provider_descriptor_registry_version,
      provider_descriptor_registry_fingerprint,
      provider_descriptor_fingerprint,
      adapter_version
    )
  ),
  constraint integration_connections_status_evidence_check check (
    (
      status = 'pending_authorization'
      and provider_tenant_reference_fingerprint is null
      and pg_catalog.cardinality(granted_scopes) = 0
      and authorized_at is null
    )
    or status <> 'pending_authorization'
  ),
  constraint integration_connections_authorized_lifecycle_check check (
    status not in (
      'authorized_unmapped',
      'initializing',
      'active',
      'degraded',
      'reauthorization_required'
    )
    or (
      provider_tenant_reference_fingerprint is not null
      and authorized_at is not null
    )
  ),
  constraint integration_connections_terminal_timestamps_check check (
    (status <> 'disconnected' or disconnected_at is not null)
    and (status <> 'deleted' or deleted_at is not null)
  ),
  constraint integration_connections_request_pair_check check (
    (last_transition_request_id is null)
      = (last_transition_request_fingerprint is null)
  ),
  constraint integration_connections_time_order_check check (
    status_changed_at >= created_at
    and updated_at >= created_at
    and (authorized_at is null or authorized_at >= created_at)
    and (disconnected_at is null or disconnected_at >= created_at)
    and (deleted_at is null or deleted_at >= created_at)
  )
);

create index integration_connections_workspace_entity_status_idx
  on private.integration_connections(workspace_id, business_entity_id, status);
create index integration_connections_series_idx
  on private.integration_connections(
    workspace_id, business_entity_id, connection_series_id, connection_generation desc
  );
create index integration_connections_created_by_idx
  on private.integration_connections(created_by)
  where created_by is not null;
create index integration_connections_replaces_idx
  on private.integration_connections(
    workspace_id, business_entity_id, replaces_connection_id
  )
  where replaces_connection_id is not null;

create table private.provider_entity_mappings (
  id uuid primary key,
  contract_version text not null check (contract_version = 'provider_entity_mapping_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  connection_id uuid not null,
  mapping_series_id uuid not null,
  mapping_version bigint not null check (mapping_version > 0),
  replaces_mapping_id uuid,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  provider_entity_type text not null check (private.is_bounded_identifier_v1(provider_entity_type)),
  provider_entity_reference_fingerprint bytea not null
    check (pg_catalog.octet_length(provider_entity_reference_fingerprint) = 32),
  safe_display_name text not null check (private.is_bounded_label_v1(safe_display_name)),
  mapping_role text not null check (mapping_role in (
    'primary', 'subsidiary', 'location', 'operating_unit'
  )),
  status text not null default 'pending_verification' check (status in (
    'pending_verification', 'active', 'inactive', 'replaced'
  )),
  verification_mode text not null default 'synthetic_phase_4'
    check (verification_mode = 'synthetic_phase_4'),
  verification_fingerprint bytea check (
    verification_fingerprint is null
    or pg_catalog.octet_length(verification_fingerprint) = 32
  ),
  verified_at timestamptz,
  mapped_by uuid references public.profiles(id) on delete restrict,
  mapped_at timestamptz not null,
  last_transition_request_id text
    check (last_transition_request_id is null or char_length(last_transition_request_id) between 1 and 200),
  last_transition_request_fingerprint bytea check (
    last_transition_request_fingerprint is null
    or pg_catalog.octet_length(last_transition_request_fingerprint) = 32
  ),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint provider_entity_mappings_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint provider_entity_mappings_connection_id_key unique (
    workspace_id, business_entity_id, connection_id, id
  ),
  constraint provider_entity_mappings_series_version_key unique (
    workspace_id, business_entity_id, mapping_series_id, mapping_version
  ),
  constraint provider_entity_mappings_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint provider_entity_mappings_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint provider_entity_mappings_replaces_fkey foreign key (
    workspace_id, business_entity_id, replaces_mapping_id
  ) references private.provider_entity_mappings(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint provider_entity_mappings_version_check check (
    (
      mapping_version = 1
      and mapping_series_id = id
      and replaces_mapping_id is null
    )
    or (
      mapping_version > 1
      and mapping_series_id <> id
      and replaces_mapping_id is not null
    )
  ),
  constraint provider_entity_mappings_verification_check check (
    (
      status = 'active'
      and verification_fingerprint is not null
      and verified_at is not null
    )
    or status <> 'active'
  ),
  constraint provider_entity_mappings_request_pair_check check (
    (last_transition_request_id is null)
      = (last_transition_request_fingerprint is null)
  )
);

create unique index provider_entity_mappings_active_external_entity_key
  on private.provider_entity_mappings(
    provider_key,
    provider_environment,
    provider_entity_type,
    provider_entity_reference_fingerprint
  )
  where status = 'active';
create index provider_entity_mappings_connection_status_idx
  on private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, status
  );
create index provider_entity_mappings_mapped_by_idx
  on private.provider_entity_mappings(mapped_by)
  where mapped_by is not null;
create index provider_entity_mappings_replaces_idx
  on private.provider_entity_mappings(
    workspace_id, business_entity_id, replaces_mapping_id
  )
  where replaces_mapping_id is not null;

create table private.integration_workspace_policies (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_workspace_policy_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  state text not null check (state in ('enabled', 'paused', 'disabled')),
  sync_enabled boolean not null,
  history_horizon_days integer not null check (history_horizon_days between 1 and 3650),
  maximum_concurrency integer not null check (maximum_concurrency between 1 and 32),
  freshness_policy_version text not null check (private.is_bounded_identifier_v1(freshness_policy_version)),
  retention_policy_version text not null check (private.is_bounded_identifier_v1(retention_policy_version)),
  row_version bigint not null default 1 check (row_version > 0),
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint integration_workspace_policies_scope_key unique (
    workspace_id, provider_key, provider_environment
  ),
  constraint integration_workspace_policies_enabled_check check (
    (state = 'enabled') = sync_enabled
  ),
  constraint integration_workspace_policies_synthetic_check check (
    provider_key = 'synthetic'
    and provider_environment = 'test'
    and maximum_concurrency <= 2
    and freshness_policy_version = 'synthetic_freshness_policy_v1'
    and retention_policy_version = 'synthetic_metadata_retention_v1'
  )
);

create table private.integration_sync_runs (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_sync_run_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  connection_id uuid not null,
  mapping_id uuid,
  connection_generation bigint not null check (connection_generation > 0),
  trigger_kind text not null check (trigger_kind in (
    'synthetic_verification', 'manual', 'recovery'
  )),
  mode text not null check (mode in (
    'initialization', 'incremental', 'backfill', 'verification'
  )),
  state text not null default 'created' check (state in (
    'created', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'
  )),
  idempotency_fingerprint bytea not null
    check (pg_catalog.octet_length(idempotency_fingerprint) = 32),
  window_start_at timestamptz,
  window_end_at timestamptz,
  provider_contract_version text not null
    check (private.is_bounded_identifier_v1(provider_contract_version)),
  adapter_version text not null check (private.is_bounded_identifier_v1(adapter_version)),
  policy_version text not null check (private.is_bounded_identifier_v1(policy_version)),
  records_observed bigint not null default 0 check (records_observed between 0 and 1000000000),
  records_accepted bigint not null default 0 check (records_accepted between 0 and 1000000000),
  records_rejected bigint not null default 0 check (records_rejected between 0 and 1000000000),
  facts_accepted bigint not null default 0 check (facts_accepted between 0 and 1000000000),
  contributions_changed bigint not null default 0 check (contributions_changed between 0 and 1000000000),
  error_category text check (error_category in (
    'authorization', 'rate_limit', 'availability', 'contract', 'data', 'unknown'
  )),
  error_code text check (error_code is null or private.is_bounded_identifier_v1(error_code)),
  last_transition_request_id text
    check (last_transition_request_id is null or char_length(last_transition_request_id) between 1 and 200),
  last_transition_request_fingerprint bytea check (
    last_transition_request_fingerprint is null
    or pg_catalog.octet_length(last_transition_request_fingerprint) = 32
  ),
  created_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  updated_at timestamptz not null,
  constraint integration_sync_runs_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint integration_sync_runs_connection_id_key unique (
    workspace_id, business_entity_id, connection_id, id
  ),
  constraint integration_sync_runs_idempotency_key unique (
    workspace_id, business_entity_id, connection_id, idempotency_fingerprint
  ),
  constraint integration_sync_runs_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint integration_sync_runs_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint integration_sync_runs_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_runs_window_check check (
    (window_start_at is null and window_end_at is null)
    or (
      window_start_at is not null
      and window_end_at is not null
      and window_end_at >= window_start_at
    )
  ),
  constraint integration_sync_runs_counts_check check (
    records_accepted + records_rejected <= records_observed
  ),
  constraint integration_sync_runs_terminal_check check (
    (
      state = 'created'
      and started_at is null
      and finished_at is null
      and error_category is null
      and error_code is null
    )
    or (
      state = 'running'
      and started_at is not null
      and finished_at is null
      and error_category is null
      and error_code is null
    )
    or (
      state in ('succeeded', 'partially_succeeded', 'cancelled')
      and started_at is not null
      and finished_at is not null
      and error_category is null
      and error_code is null
    )
    or (
      state = 'failed'
      and started_at is not null
      and finished_at is not null
      and error_category is not null
      and error_code is not null
    )
  ),
  constraint integration_sync_runs_request_pair_check check (
    (last_transition_request_id is null)
      = (last_transition_request_fingerprint is null)
  ),
  constraint integration_sync_runs_time_order_check check (
    updated_at >= created_at
    and (started_at is null or started_at >= created_at)
    and (finished_at is null or finished_at >= started_at)
  )
);

create index integration_sync_runs_connection_state_idx
  on private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, state, created_at desc
  );
create index integration_sync_runs_mapping_idx
  on private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, mapping_id, created_at desc
  ) where mapping_id is not null;

create table private.integration_freshness_states (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_freshness_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  connection_id uuid not null,
  mapping_id uuid,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  domain text not null check (private.is_bounded_identifier_v1(domain)),
  scope_key text not null check (private.is_bounded_identifier_v1(scope_key)),
  provider_watermark_at timestamptz,
  last_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_reconciled_at timestamptz,
  observed_lag_seconds bigint check (observed_lag_seconds is null or observed_lag_seconds >= 0),
  status text not null check (status in (
    'current',
    'aging',
    'stale',
    'sync_error',
    'reauthorization_required',
    'disconnected',
    'unknown'
  )),
  blocking_level text not null check (blocking_level in (
    'none', 'warning', 'current_intelligence', 'all_derived'
  )),
  reason_code text check (reason_code is null or private.is_bounded_identifier_v1(reason_code)),
  policy_version text not null check (private.is_bounded_identifier_v1(policy_version)),
  current_max_age_seconds bigint not null check (current_max_age_seconds > 0),
  stale_after_seconds bigint not null check (stale_after_seconds > current_max_age_seconds),
  age_seconds bigint check (age_seconds is null or age_seconds >= 0),
  calculated_at timestamptz not null,
  state_fingerprint bytea not null check (pg_catalog.octet_length(state_fingerprint) = 32),
  last_request_id text not null check (char_length(last_request_id) between 1 and 200),
  last_request_fingerprint bytea not null
    check (pg_catalog.octet_length(last_request_fingerprint) = 32),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint integration_freshness_states_scope_key unique nulls not distinct (
    workspace_id, business_entity_id, connection_id, mapping_id, domain, scope_key
  ),
  constraint integration_freshness_states_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint integration_freshness_states_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint integration_freshness_states_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint integration_freshness_states_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_freshness_states_semantic_check check (
    (
      status = 'current'
      and last_successful_sync_at is not null
      and age_seconds is not null
      and age_seconds <= current_max_age_seconds
      and blocking_level = 'none'
    )
    or (
      status = 'aging'
      and last_successful_sync_at is not null
      and age_seconds is not null
      and age_seconds > current_max_age_seconds
      and age_seconds <= stale_after_seconds
      and blocking_level = 'warning'
    )
    or (
      status = 'stale'
      and last_successful_sync_at is not null
      and age_seconds is not null
      and age_seconds > stale_after_seconds
      and blocking_level in ('current_intelligence', 'all_derived')
    )
    or (
      status in (
        'sync_error', 'reauthorization_required', 'disconnected', 'unknown'
      )
      and blocking_level in ('current_intelligence', 'all_derived')
    )
  )
);

create index integration_freshness_states_connection_status_idx
  on private.integration_freshness_states(
    workspace_id, business_entity_id, connection_id, status, domain
  );

create table public.integration_connection_summaries (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_connection_summary_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  provider_environment text not null check (private.is_bounded_identifier_v1(provider_environment)),
  safe_display_name text not null check (private.is_bounded_label_v1(safe_display_name)),
  status text not null check (status in (
    'pending_authorization', 'authorized_unmapped', 'initializing', 'active',
    'degraded', 'error', 'reauthorization_required', 'disconnecting',
    'disconnected', 'deleting', 'deleted'
  )),
  state_reason_code text not null
    check (private.is_integration_connection_reason_v1(status, state_reason_code)),
  requested_scopes text[] not null
    check (private.is_phase_4_scope_set_v1(requested_scopes)),
  granted_scopes text[] not null
    check (private.is_bounded_identifier_array_v1(granted_scopes, 64)),
  capability_snapshot jsonb not null
    check (private.is_phase_4_capability_snapshot_v1(capability_snapshot)),
  adapter_version text not null check (private.is_bounded_identifier_v1(adapter_version)),
  configuration_version bigint not null check (configuration_version > 0),
  connection_generation bigint not null check (connection_generation > 0),
  status_changed_at timestamptz not null,
  disconnected_at timestamptz,
  row_version bigint not null check (row_version > 0),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint integration_connection_summaries_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint integration_connection_summaries_scope_check check (
    granted_scopes <@ requested_scopes
  )
);

create index integration_connection_summaries_member_idx
  on public.integration_connection_summaries(
    workspace_id, business_entity_id, status, provider_key
  );

create table public.integration_freshness_summaries (
  id uuid primary key,
  contract_version text not null check (contract_version = 'integration_freshness_summary_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  connection_id uuid not null,
  provider_key text not null check (provider_key ~ '^[a-z][a-z0-9_-]{0,63}$'),
  domain text not null check (private.is_bounded_identifier_v1(domain)),
  scope_key text not null check (private.is_bounded_identifier_v1(scope_key)),
  last_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_reconciled_at timestamptz,
  observed_lag_seconds bigint check (observed_lag_seconds is null or observed_lag_seconds >= 0),
  status text not null check (status in (
    'current', 'aging', 'stale', 'sync_error',
    'reauthorization_required', 'disconnected', 'unknown'
  )),
  blocking_level text not null check (blocking_level in (
    'none', 'warning', 'current_intelligence', 'all_derived'
  )),
  reason_code text check (reason_code is null or private.is_bounded_identifier_v1(reason_code)),
  policy_version text not null check (private.is_bounded_identifier_v1(policy_version)),
  calculated_at timestamptz not null,
  row_version bigint not null check (row_version > 0),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint integration_freshness_summaries_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade
);

create index integration_freshness_summaries_member_idx
  on public.integration_freshness_summaries(
    workspace_id, business_entity_id, connection_id, status, domain
  );

alter table public.integration_connection_summaries enable row level security;
alter table public.integration_connection_summaries force row level security;
alter table public.integration_freshness_summaries enable row level security;
alter table public.integration_freshness_summaries force row level security;

create policy "workspace members read integration connection summaries"
  on public.integration_connection_summaries for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace members read integration freshness summaries"
  on public.integration_freshness_summaries for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on table public.integration_connection_summaries
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on table public.integration_freshness_summaries
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant select on table public.integration_connection_summaries to authenticated;
grant select on table public.integration_freshness_summaries to authenticated;

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'integration_connections',
    'provider_entity_mappings',
    'integration_sync_runs',
    'integration_freshness_states',
    'integration_workspace_policies'
  ]
  loop
    execute pg_catalog.format('alter table private.%I enable row level security', v_table);
    execute pg_catalog.format('alter table private.%I force row level security', v_table);
    execute pg_catalog.format(
      'revoke all on table private.%I from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority, integration_control_plane_authority',
      v_table
    );
  end loop;
end;
$rls$;

alter table private.external_source_records
  add constraint external_source_records_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict;
alter table private.external_source_records
  add constraint external_source_records_mapping_fkey foreign key (
    workspace_id, business_entity_id, connection_id, mapping_id
  ) references private.provider_entity_mappings(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict;
alter table private.external_source_record_versions
  add constraint external_source_record_versions_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id
  ) references private.integration_connections(workspace_id, business_entity_id, id)
    on delete restrict;
alter table private.external_source_record_versions
  add constraint external_source_record_versions_sync_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict;

create or replace function private.integration_connection_summary_json_v1(
  p_connection private.integration_connections
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_connection_summary_v1',
    'id', p_connection.id,
    'workspaceId', p_connection.workspace_id,
    'businessEntityId', p_connection.business_entity_id,
    'providerKey', p_connection.provider_key,
    'providerEnvironment', p_connection.provider_environment,
    'safeDisplayName', p_connection.safe_display_name,
    'status', p_connection.status,
    'stateReasonCode', p_connection.state_reason_code,
    'requestedScopes', pg_catalog.to_jsonb(p_connection.requested_scopes),
    'grantedScopes', pg_catalog.to_jsonb(p_connection.granted_scopes),
    'capabilitySnapshot', p_connection.capability_snapshot,
    'adapterVersion', p_connection.adapter_version,
    'configurationVersion', p_connection.configuration_version,
    'connectionGeneration', p_connection.connection_generation,
    'statusChangedAt', pg_catalog.to_char(
      p_connection.status_changed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'disconnectedAt', case
      when p_connection.disconnected_at is null then null
      else pg_catalog.to_char(
        p_connection.disconnected_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end,
    'rowVersion', p_connection.row_version
  );
$function$;

create or replace function private.integration_freshness_summary_json_v1(
  p_freshness private.integration_freshness_states
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_freshness_summary_v1',
    'id', p_freshness.id,
    'workspaceId', p_freshness.workspace_id,
    'businessEntityId', p_freshness.business_entity_id,
    'connectionId', p_freshness.connection_id,
    'providerKey', p_freshness.provider_key,
    'domain', p_freshness.domain,
    'scopeKey', p_freshness.scope_key,
    'lastAttemptAt', case
      when p_freshness.last_attempt_at is null then null
      else pg_catalog.to_char(
        p_freshness.last_attempt_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end,
    'lastSuccessfulSyncAt', case
      when p_freshness.last_successful_sync_at is null then null
      else pg_catalog.to_char(
        p_freshness.last_successful_sync_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end,
    'lastReconciledAt', case
      when p_freshness.last_reconciled_at is null then null
      else pg_catalog.to_char(
        p_freshness.last_reconciled_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end,
    'observedLagSeconds', p_freshness.observed_lag_seconds,
    'status', p_freshness.status,
    'blockingLevel', p_freshness.blocking_level,
    'reasonCode', p_freshness.reason_code,
    'policyVersion', p_freshness.policy_version,
    'calculatedAt', pg_catalog.to_char(
      p_freshness.calculated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'rowVersion', p_freshness.row_version
  );
$function$;

create or replace function private.sync_integration_connection_summary_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.integration_connection_summaries (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    provider_key,
    provider_environment,
    safe_display_name,
    status,
    state_reason_code,
    requested_scopes,
    granted_scopes,
    capability_snapshot,
    adapter_version,
    configuration_version,
    connection_generation,
    status_changed_at,
    disconnected_at,
    row_version,
    updated_at
  ) values (
    new.id,
    'integration_connection_summary_v1',
    new.workspace_id,
    new.business_entity_id,
    new.provider_key,
    new.provider_environment,
    new.safe_display_name,
    new.status,
    new.state_reason_code,
    new.requested_scopes,
    new.granted_scopes,
    new.capability_snapshot,
    new.adapter_version,
    new.configuration_version,
    new.connection_generation,
    new.status_changed_at,
    new.disconnected_at,
    new.row_version,
    new.updated_at
  )
  on conflict (id) do update set
    safe_display_name = excluded.safe_display_name,
    status = excluded.status,
    state_reason_code = excluded.state_reason_code,
    requested_scopes = excluded.requested_scopes,
    granted_scopes = excluded.granted_scopes,
    capability_snapshot = excluded.capability_snapshot,
    adapter_version = excluded.adapter_version,
    configuration_version = excluded.configuration_version,
    connection_generation = excluded.connection_generation,
    status_changed_at = excluded.status_changed_at,
    disconnected_at = excluded.disconnected_at,
    row_version = excluded.row_version,
    updated_at = excluded.updated_at;
  return new;
end;
$function$;

create trigger sync_integration_connection_summary_v1
after insert or update on private.integration_connections
for each row execute function private.sync_integration_connection_summary_v1();

create or replace function private.sync_integration_freshness_summary_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.integration_freshness_summaries (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    provider_key,
    domain,
    scope_key,
    last_attempt_at,
    last_successful_sync_at,
    last_reconciled_at,
    observed_lag_seconds,
    status,
    blocking_level,
    reason_code,
    policy_version,
    calculated_at,
    row_version,
    updated_at
  ) values (
    new.id,
    'integration_freshness_summary_v1',
    new.workspace_id,
    new.business_entity_id,
    new.connection_id,
    new.provider_key,
    new.domain,
    new.scope_key,
    new.last_attempt_at,
    new.last_successful_sync_at,
    new.last_reconciled_at,
    new.observed_lag_seconds,
    new.status,
    new.blocking_level,
    new.reason_code,
    new.policy_version,
    new.calculated_at,
    new.row_version,
    new.updated_at
  )
  on conflict (id) do update set
    last_attempt_at = excluded.last_attempt_at,
    last_successful_sync_at = excluded.last_successful_sync_at,
    last_reconciled_at = excluded.last_reconciled_at,
    observed_lag_seconds = excluded.observed_lag_seconds,
    status = excluded.status,
    blocking_level = excluded.blocking_level,
    reason_code = excluded.reason_code,
    policy_version = excluded.policy_version,
    calculated_at = excluded.calculated_at,
    row_version = excluded.row_version,
    updated_at = excluded.updated_at;
  return new;
end;
$function$;

create trigger sync_integration_freshness_summary_v1
after insert or update on private.integration_freshness_states
for each row execute function private.sync_integration_freshness_summary_v1();

create or replace function private.validate_integration_connection_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'deleted' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_deleted_terminal';
  end if;
  if old.status = new.status
    or not private.is_integration_connection_transition_v1(old.status, new.status) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_transition_invalid';
  end if;
  if old.status = 'disconnected' and new.status = 'pending_authorization' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_replacement_generation_required';
  end if;
  if new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.control_contract_version <> old.control_contract_version
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_series_id <> old.connection_series_id
    or new.connection_generation <> old.connection_generation
    or new.replaces_connection_id is distinct from old.replaces_connection_id
    or new.provider_key <> old.provider_key
    or new.provider_environment <> old.provider_environment
    or new.requested_scopes <> old.requested_scopes
    or new.safe_display_name <> old.safe_display_name
    or new.provider_descriptor_registry_version <> old.provider_descriptor_registry_version
    or new.provider_descriptor_registry_fingerprint <> old.provider_descriptor_registry_fingerprint
    or new.provider_descriptor_fingerprint <> old.provider_descriptor_fingerprint
    or new.adapter_version <> old.adapter_version
    or new.capability_snapshot <> old.capability_snapshot
    or new.configuration_version <> old.configuration_version
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_immutable_fields';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_connection_mutation_v1
before update on private.integration_connections
for each row execute function private.validate_integration_connection_mutation_v1();

create trigger reject_integration_connection_delete_v1
before delete on private.integration_connections
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_provider_entity_mapping_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'replaced' then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_replaced_terminal';
  end if;
  if old.status = new.status
    or not private.is_provider_entity_mapping_transition_v1(old.status, new.status) then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_transition_invalid';
  end if;
  if new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_id <> old.connection_id
    or new.mapping_series_id <> old.mapping_series_id
    or new.mapping_version <> old.mapping_version
    or new.replaces_mapping_id is distinct from old.replaces_mapping_id
    or new.provider_key <> old.provider_key
    or new.provider_environment <> old.provider_environment
    or new.provider_entity_type <> old.provider_entity_type
    or new.provider_entity_reference_fingerprint <> old.provider_entity_reference_fingerprint
    or new.safe_display_name <> old.safe_display_name
    or new.mapping_role <> old.mapping_role
    or new.verification_mode <> old.verification_mode
    or new.mapped_by is distinct from old.mapped_by
    or new.mapped_at <> old.mapped_at
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_immutable_fields';
  end if;
  return new;
end;
$function$;

create trigger validate_provider_entity_mapping_mutation_v1
before update on private.provider_entity_mappings
for each row execute function private.validate_provider_entity_mapping_mutation_v1();

create trigger reject_provider_entity_mapping_delete_v1
before delete on private.provider_entity_mappings
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_integration_sync_run_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.state in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_run_terminal';
  end if;
  if old.state = new.state
    or not private.is_integration_sync_run_transition_v1(old.state, new.state) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_run_transition_invalid';
  end if;
  if new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_id <> old.connection_id
    or new.mapping_id is distinct from old.mapping_id
    or new.connection_generation <> old.connection_generation
    or new.trigger_kind <> old.trigger_kind
    or new.mode <> old.mode
    or new.idempotency_fingerprint <> old.idempotency_fingerprint
    or new.window_start_at is distinct from old.window_start_at
    or new.window_end_at is distinct from old.window_end_at
    or new.provider_contract_version <> old.provider_contract_version
    or new.adapter_version <> old.adapter_version
    or new.policy_version <> old.policy_version
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_run_immutable_fields';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_sync_run_mutation_v1
before update on private.integration_sync_runs
for each row execute function private.validate_integration_sync_run_mutation_v1();

create trigger reject_integration_sync_run_delete_v1
before delete on private.integration_sync_runs
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_integration_freshness_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.connection_id <> old.connection_id
    or new.mapping_id is distinct from old.mapping_id
    or new.provider_key <> old.provider_key
    or new.domain <> old.domain
    or new.scope_key <> old.scope_key
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_freshness_identity_immutable';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_freshness_mutation_v1
before update on private.integration_freshness_states
for each row execute function private.validate_integration_freshness_mutation_v1();

create trigger reject_integration_freshness_delete_v1
before delete on private.integration_freshness_states
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_integration_workspace_policy_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id <> old.id
    or new.contract_version <> old.contract_version
    or new.workspace_id <> old.workspace_id
    or new.provider_key <> old.provider_key
    or new.provider_environment <> old.provider_environment
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_workspace_policy_identity_immutable';
  end if;
  return new;
end;
$function$;

create trigger validate_integration_workspace_policy_mutation_v1
before update on private.integration_workspace_policies
for each row execute function private.validate_integration_workspace_policy_mutation_v1();

create trigger reject_integration_workspace_policy_delete_v1
before delete on private.integration_workspace_policies
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function public.create_integration_connection_intent_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_connection private.integration_connections;
  v_requested_scopes text[];
  v_registry_fingerprint bytea;
  v_descriptor_fingerprint bytea;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_command,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'providerKey',
      'providerEnvironment',
      'safeDisplayName',
      'requestedScopes',
      'providerDescriptorRegistryVersion',
      'providerDescriptorRegistryFingerprint',
      'providerDescriptorFingerprint',
      'adapterVersion',
      'capabilitySnapshot',
      'configurationVersion',
      'requestedAt'
    ]
  ) then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_intent_payload_invalid';
  end if;

  if v_actor_id is null
    or not public.can_edit_operations((p_command ->> 'workspaceId')::uuid) then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_intent_denied';
  end if;

  if p_command ->> 'contractVersion' <> 'integration_connection_control_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'requestedScopes') <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'requestedScopes') as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
    )
    or pg_catalog.jsonb_typeof(p_command -> 'capabilitySnapshot') <> 'object'
    or not private.is_bounded_label_v1(p_command ->> 'safeDisplayName')
    or (p_command ->> 'configurationVersion') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_intent_payload_invalid';
  end if;

  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into v_requested_scopes
  from pg_catalog.jsonb_array_elements_text(p_command -> 'requestedScopes')
    with ordinality as item(value, ordinality);

  v_registry_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerDescriptorRegistryFingerprint'
  );
  v_descriptor_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerDescriptorFingerprint'
  );

  if not private.is_phase_4_scope_set_v1(v_requested_scopes)
    or not private.is_phase_4_capability_snapshot_v1(
      p_command -> 'capabilitySnapshot'
    )
    or not private.is_phase_4_provider_descriptor_v1(
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment',
      p_command ->> 'providerDescriptorRegistryVersion',
      v_registry_fingerprint,
      v_descriptor_fingerprint,
      p_command ->> 'adapterVersion'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_descriptor_invalid';
  end if;

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = (p_command ->> 'workspaceId')::uuid
      and entity.id = (p_command ->> 'businessEntityId')::uuid
      and entity.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_intent_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.id = (p_command ->> 'id')::uuid
    and connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
  for update;

  if found then
    if v_connection.provider_key <> p_command ->> 'providerKey'
      or v_connection.provider_environment <> p_command ->> 'providerEnvironment'
      or v_connection.safe_display_name <> p_command ->> 'safeDisplayName'
      or v_connection.requested_scopes <> v_requested_scopes
      or v_connection.configuration_version <> (p_command ->> 'configurationVersion')::bigint
      or v_connection.provider_descriptor_registry_fingerprint <> v_registry_fingerprint
      or v_connection.provider_descriptor_fingerprint <> v_descriptor_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'integration_connection_create_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'connection', private.integration_connection_summary_json_v1(v_connection),
      'idempotent', true
    );
  end if;

  insert into private.integration_connections (
    id,
    contract_version,
    control_contract_version,
    workspace_id,
    business_entity_id,
    connection_series_id,
    connection_generation,
    provider_key,
    provider_environment,
    status,
    state_reason_code,
    requested_scopes,
    granted_scopes,
    safe_display_name,
    provider_descriptor_registry_version,
    provider_descriptor_registry_fingerprint,
    provider_descriptor_fingerprint,
    adapter_version,
    capability_snapshot,
    configuration_version,
    status_changed_at,
    created_by,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_connection_v1',
    'integration_connection_control_v1',
    (p_command ->> 'workspaceId')::uuid,
    (p_command ->> 'businessEntityId')::uuid,
    (p_command ->> 'id')::uuid,
    1,
    p_command ->> 'providerKey',
    p_command ->> 'providerEnvironment',
    'pending_authorization',
    'authorization_pending',
    v_requested_scopes,
    '{}'::text[],
    p_command ->> 'safeDisplayName',
    p_command ->> 'providerDescriptorRegistryVersion',
    v_registry_fingerprint,
    v_descriptor_fingerprint,
    p_command ->> 'adapterVersion',
    p_command -> 'capabilitySnapshot',
    (p_command ->> 'configurationVersion')::bigint,
    (p_command ->> 'requestedAt')::timestamptz,
    v_actor_id,
    (p_command ->> 'requestedAt')::timestamptz,
    (p_command ->> 'requestedAt')::timestamptz
  )
  returning * into v_connection;

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
    metadata,
    retention_class
  ) values (
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    'user',
    v_actor_id::text,
    'integration_connection.intent_create',
    'succeeded',
    'integration_connection',
    v_connection.id::text,
    pg_catalog.jsonb_build_object(
      'contract_version', v_connection.contract_version,
      'connection_generation', v_connection.connection_generation,
      'connection_status', v_connection.status,
      'row_version', v_connection.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'connection', private.integration_connection_summary_json_v1(v_connection),
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_connection_create_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_intent_payload_invalid';
end;
$function$;

create or replace function public.request_integration_disconnect_v1(
  p_connection_id uuid,
  p_expected_row_version bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_connection private.integration_connections;
  v_command jsonb;
  v_request_fingerprint bytea;
  v_effective_at timestamptz;
begin
  if v_actor_id is null
    or p_request_id is null
    or char_length(p_request_id) not between 1 and 200 then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_disconnect_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.id = p_connection_id
  for update;

  if not found or not public.can_edit_operations(v_connection.workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_disconnect_denied';
  end if;

  v_command := pg_catalog.jsonb_build_object(
    'connectionId', p_connection_id,
    'expectedRowVersion', p_expected_row_version,
    'targetStatus', 'disconnecting',
    'stateReasonCode', 'customer_disconnect_requested'
  );
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    v_command
  );

  if v_connection.status = 'disconnecting'
    and v_connection.last_transition_request_id = p_request_id
    and v_connection.last_transition_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'connection', private.integration_connection_summary_json_v1(v_connection),
      'idempotent', true
    );
  end if;

  if v_connection.row_version <> p_expected_row_version then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_row_version_stale';
  end if;
  if not private.is_integration_connection_transition_v1(
    v_connection.status,
    'disconnecting'
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_disconnect_transition_invalid';
  end if;

  v_effective_at := greatest(
    transaction_timestamp(),
    v_connection.updated_at + interval '1 microsecond'
  );

  update private.integration_connections as connection
  set
    status = 'disconnecting',
    state_reason_code = 'customer_disconnect_requested',
    status_changed_at = v_effective_at,
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    row_version = connection.row_version + 1,
    updated_at = v_effective_at
  where connection.id = v_connection.id
  returning connection.* into v_connection;

  update private.integration_freshness_states as freshness
  set
    status = 'disconnected',
    blocking_level = 'all_derived',
    reason_code = 'connection_disconnected',
    calculated_at = greatest(
      v_effective_at,
      freshness.updated_at + interval '1 microsecond'
    ),
    state_fingerprint = private.phase_3_contract_fingerprint_v1(
      pg_catalog.jsonb_build_object(
        'freshnessId', freshness.id,
        'status', 'disconnected',
        'blockingLevel', 'all_derived',
        'requestFingerprint', private.phase_4_fingerprint_text_v1(v_request_fingerprint)
      )
    ),
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = freshness.row_version + 1,
    updated_at = greatest(
      v_effective_at,
      freshness.updated_at + interval '1 microsecond'
    )
  where freshness.workspace_id = v_connection.workspace_id
    and freshness.business_entity_id = v_connection.business_entity_id
    and freshness.connection_id = v_connection.id;

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
    retention_class
  ) values (
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    'user',
    v_actor_id::text,
    'integration_connection.disconnect_request',
    'succeeded',
    'integration_connection',
    v_connection.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_connection.connection_generation,
      'connection_status', v_connection.status,
      'row_version', v_connection.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'connection', private.integration_connection_summary_json_v1(v_connection),
    'idempotent', false
  );
end;
$function$;

create or replace function public.transition_integration_connection_v1(
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
  v_connection private.integration_connections;
  v_target_status text;
  v_reason text;
  v_granted_scopes text[];
  v_tenant_fingerprint bytea;
  v_request_fingerprint bytea;
  v_transitioned_at timestamptz;
  v_missing_activation_gate boolean;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'expectedRowVersion',
        'expectedGeneration',
        'targetStatus',
        'stateReasonCode',
        'providerTenantReferenceFingerprint',
        'grantedScopes',
        'transitionedAt'
      ]
    )
    or pg_catalog.jsonb_typeof(p_command -> 'grantedScopes') <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'grantedScopes') as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_transition_payload_invalid';
  end if;

  v_target_status := p_command ->> 'targetStatus';
  v_reason := p_command ->> 'stateReasonCode';
  v_transitioned_at := (p_command ->> 'transitionedAt')::timestamptz;
  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into v_granted_scopes
  from pg_catalog.jsonb_array_elements_text(p_command -> 'grantedScopes')
    with ordinality as item(value, ordinality);
  v_tenant_fingerprint := case
    when p_command -> 'providerTenantReferenceFingerprint' = 'null'::jsonb then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'providerTenantReferenceFingerprint'
    )
  end;
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
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

  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_transition_denied';
  end if;
  if v_connection.status = v_target_status
    and v_connection.last_transition_request_id = p_request_id
    and v_connection.last_transition_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'connection', private.integration_connection_summary_json_v1(v_connection),
      'idempotent', true
    );
  end if;
  if v_connection.row_version <> (p_command ->> 'expectedRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_row_version_stale';
  end if;
  if v_connection.connection_generation <> (p_command ->> 'expectedGeneration')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_generation_stale';
  end if;
  if v_connection.status = 'deleted' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_deleted_terminal';
  end if;
  if v_connection.status = 'disconnected'
    and v_target_status = 'pending_authorization' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_replacement_generation_required';
  end if;
  if not private.is_integration_connection_transition_v1(
      v_connection.status,
      v_target_status
    )
    or not private.is_integration_connection_reason_v1(
      v_target_status,
      v_reason
    ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_transition_invalid';
  end if;

  if v_target_status = 'pending_authorization' then
    if v_tenant_fingerprint is not null
      or pg_catalog.cardinality(v_granted_scopes) <> 0 then
      raise exception using
        errcode = '22023',
        message = 'integration_connection_authorization_evidence_invalid';
    end if;
  elsif v_target_status = 'authorized_unmapped' then
    if v_tenant_fingerprint is null
      or pg_catalog.cardinality(v_granted_scopes) = 0
      or not private.is_bounded_identifier_array_v1(v_granted_scopes, 64)
      or not v_granted_scopes <@ v_connection.requested_scopes then
      raise exception using
        errcode = '22023',
        message = 'integration_connection_authorization_evidence_invalid';
    end if;
  elsif v_tenant_fingerprint is distinct from v_connection.provider_tenant_reference_fingerprint
    or v_granted_scopes <> v_connection.granted_scopes then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_authorization_evidence_invalid';
  end if;

  if v_target_status = 'initializing' then
    if v_connection.provider_tenant_reference_fingerprint is null
      or v_connection.authorized_at is null then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_authorization_gate_unsatisfied';
    end if;
    if not exists (
      select 1
      from private.provider_entity_mappings as mapping
      where mapping.workspace_id = v_connection.workspace_id
        and mapping.business_entity_id = v_connection.business_entity_id
        and mapping.connection_id = v_connection.id
        and mapping.status = 'active'
    ) then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_mapping_gate_unsatisfied';
    end if;
  end if;

  if v_target_status = 'active' then
    select not (
      exists (
        select 1
        from private.provider_entity_mappings as mapping
        where mapping.workspace_id = v_connection.workspace_id
          and mapping.business_entity_id = v_connection.business_entity_id
          and mapping.connection_id = v_connection.id
          and mapping.status = 'active'
      )
      and exists (
        select 1
        from private.integration_sync_runs as run
        join private.provider_entity_mappings as mapping
          on mapping.workspace_id = run.workspace_id
          and mapping.business_entity_id = run.business_entity_id
          and mapping.connection_id = run.connection_id
          and mapping.id = run.mapping_id
        where run.workspace_id = v_connection.workspace_id
          and run.business_entity_id = v_connection.business_entity_id
          and run.connection_id = v_connection.id
          and run.connection_generation = v_connection.connection_generation
          and run.trigger_kind = 'synthetic_verification'
          and run.mode = 'initialization'
          and run.state = 'succeeded'
          and mapping.status = 'active'
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          v_connection.capability_snapshot -> 'requiredStreamKeys'
        ) as required(stream_key)
        where not exists (
          select 1
          from private.integration_freshness_states as freshness
          join private.provider_entity_mappings as mapping
            on mapping.workspace_id = freshness.workspace_id
            and mapping.business_entity_id = freshness.business_entity_id
            and mapping.connection_id = freshness.connection_id
            and mapping.id = freshness.mapping_id
          where freshness.workspace_id = v_connection.workspace_id
            and freshness.business_entity_id = v_connection.business_entity_id
            and freshness.connection_id = v_connection.id
            and freshness.domain = required.stream_key
            and freshness.status in ('current', 'aging')
            and freshness.blocking_level in ('none', 'warning')
            and mapping.status = 'active'
        )
      )
    )
    into v_missing_activation_gate;
    if v_missing_activation_gate then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_activation_gate_unsatisfied';
    end if;
  end if;

  if v_target_status = 'deleted' and (
    exists (
      select 1
      from private.provider_entity_mappings as mapping
      where mapping.workspace_id = v_connection.workspace_id
        and mapping.business_entity_id = v_connection.business_entity_id
        and mapping.connection_id = v_connection.id
        and mapping.status in ('pending_verification', 'active')
    )
    or exists (
      select 1
      from private.integration_sync_runs as run
      where run.workspace_id = v_connection.workspace_id
        and run.business_entity_id = v_connection.business_entity_id
        and run.connection_id = v_connection.id
        and run.state in ('created', 'running')
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_deletion_gate_unsatisfied';
  end if;

  update private.integration_connections as connection
  set
    status = v_target_status,
    state_reason_code = v_reason,
    provider_tenant_reference_fingerprint = case
      when v_target_status = 'pending_authorization' then null
      else v_tenant_fingerprint
    end,
    granted_scopes = v_granted_scopes,
    authorized_at = case
      when v_target_status = 'pending_authorization' then null
      when v_target_status = 'authorized_unmapped' then v_transitioned_at
      else connection.authorized_at
    end,
    status_changed_at = v_transitioned_at,
    disconnected_at = case
      when v_target_status = 'disconnected' then v_transitioned_at
      else connection.disconnected_at
    end,
    deleted_at = case
      when v_target_status = 'deleted' then v_transitioned_at
      else null
    end,
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    row_version = connection.row_version + 1,
    updated_at = v_transitioned_at
  where connection.id = v_connection.id
  returning connection.* into v_connection;

  if v_target_status in (
    'error',
    'reauthorization_required',
    'disconnecting',
    'disconnected',
    'deleting',
    'deleted'
  ) then
    update private.integration_freshness_states as freshness
    set
      status = case
        when v_target_status = 'error' then 'sync_error'
        when v_target_status = 'reauthorization_required' then 'reauthorization_required'
        else 'disconnected'
      end,
      blocking_level = case
        when v_target_status = 'error' then 'current_intelligence'
        else 'all_derived'
      end,
      reason_code = case
        when v_target_status = 'error' then 'latest_sync_failed'
        when v_target_status = 'reauthorization_required' then 'connection_reauthorization_required'
        else 'connection_disconnected'
      end,
      calculated_at = v_transitioned_at,
      state_fingerprint = private.phase_3_contract_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'freshnessId', freshness.id,
          'connectionStatus', v_target_status,
          'requestFingerprint', private.phase_4_fingerprint_text_v1(v_request_fingerprint)
        )
      ),
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = freshness.row_version + 1,
      updated_at = v_transitioned_at
    where freshness.workspace_id = v_connection.workspace_id
      and freshness.business_entity_id = v_connection.business_entity_id
      and freshness.connection_id = v_connection.id;
  end if;

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
    retention_class
  ) values (
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    'service',
    p_actor_id,
    'integration_connection.transition',
    'succeeded',
    'integration_connection',
    v_connection.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_connection.connection_generation,
      'connection_status', v_connection.status,
      'row_version', v_connection.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'connection', private.integration_connection_summary_json_v1(v_connection),
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_transition_payload_invalid';
end;
$function$;

create or replace function public.replace_integration_connection_generation_v1(
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
  v_prior private.integration_connections;
  v_replacement private.integration_connections;
  v_requested_scopes text[];
  v_request_fingerprint bytea;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'priorConnectionId',
        'expectedPriorRowVersion',
        'replacementConnectionId',
        'safeDisplayName',
        'requestedScopes',
        'configurationVersion',
        'requestedAt'
      ]
    )
    or pg_catalog.jsonb_typeof(p_command -> 'requestedScopes') <> 'array'
    or not private.is_bounded_label_v1(p_command ->> 'safeDisplayName') then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_replacement_payload_invalid';
  end if;

  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into v_requested_scopes
  from pg_catalog.jsonb_array_elements_text(p_command -> 'requestedScopes')
    with ordinality as item(value, ordinality);
  if not private.is_phase_4_scope_set_v1(v_requested_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_replacement_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.*
  into v_replacement
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'replacementConnectionId')::uuid
  for update;
  if found then
    if v_replacement.replaces_connection_id = (p_command ->> 'priorConnectionId')::uuid
      and v_replacement.last_transition_request_id = p_request_id
      and v_replacement.last_transition_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'connection', private.integration_connection_summary_json_v1(v_replacement),
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_connection_replacement_conflict';
  end if;

  select connection.*
  into v_prior
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'priorConnectionId')::uuid
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_replacement_denied';
  end if;
  if v_prior.row_version <> (p_command ->> 'expectedPriorRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_row_version_stale';
  end if;
  if v_prior.status <> 'disconnected' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_replacement_requires_disconnected';
  end if;

  insert into private.integration_connections (
    id,
    contract_version,
    control_contract_version,
    workspace_id,
    business_entity_id,
    connection_series_id,
    connection_generation,
    replaces_connection_id,
    provider_key,
    provider_environment,
    status,
    state_reason_code,
    requested_scopes,
    granted_scopes,
    safe_display_name,
    provider_descriptor_registry_version,
    provider_descriptor_registry_fingerprint,
    provider_descriptor_fingerprint,
    adapter_version,
    capability_snapshot,
    configuration_version,
    status_changed_at,
    last_transition_request_id,
    last_transition_request_fingerprint,
    created_by,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'replacementConnectionId')::uuid,
    v_prior.contract_version,
    v_prior.control_contract_version,
    v_prior.workspace_id,
    v_prior.business_entity_id,
    v_prior.connection_series_id,
    v_prior.connection_generation + 1,
    v_prior.id,
    v_prior.provider_key,
    v_prior.provider_environment,
    'pending_authorization',
    'authorization_pending',
    v_requested_scopes,
    '{}'::text[],
    p_command ->> 'safeDisplayName',
    v_prior.provider_descriptor_registry_version,
    v_prior.provider_descriptor_registry_fingerprint,
    v_prior.provider_descriptor_fingerprint,
    v_prior.adapter_version,
    v_prior.capability_snapshot,
    (p_command ->> 'configurationVersion')::bigint,
    (p_command ->> 'requestedAt')::timestamptz,
    p_request_id,
    v_request_fingerprint,
    v_prior.created_by,
    (p_command ->> 'requestedAt')::timestamptz,
    (p_command ->> 'requestedAt')::timestamptz
  )
  returning * into v_replacement;

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
    retention_class
  ) values (
    v_replacement.workspace_id,
    v_replacement.business_entity_id,
    v_replacement.id,
    'service',
    p_actor_id,
    'integration_connection.generation_replace',
    'succeeded',
    'integration_connection',
    v_replacement.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_replacement.connection_generation,
      'connection_status', v_replacement.status,
      'row_version', v_replacement.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'connection', private.integration_connection_summary_json_v1(v_replacement),
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_connection_replacement_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_replacement_payload_invalid';
end;
$function$;

create or replace function public.create_provider_entity_mapping_v1(
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
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_prior private.provider_entity_mappings;
  v_reference_fingerprint bytea;
  v_request_fingerprint bytea;
  v_mapping_series_id uuid;
  v_mapping_version bigint;
  v_mapped_by uuid;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'providerEntityType',
        'providerEntityReferenceFingerprint',
        'safeDisplayName',
        'mappingRole',
        'mappedAt',
        'replacesMappingId'
      ]
    )
    or p_command ->> 'contractVersion' <> 'provider_entity_mapping_v1'
    or not private.is_bounded_identifier_v1(p_command ->> 'providerEntityType')
    or not private.is_bounded_label_v1(p_command ->> 'safeDisplayName')
    or p_command ->> 'mappingRole' not in (
      'primary', 'subsidiary', 'location', 'operating_unit'
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_entity_mapping_payload_invalid';
  end if;

  v_reference_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerEntityReferenceFingerprint'
  );
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.id = (p_command ->> 'id')::uuid
  for update;
  if found then
    if v_mapping.workspace_id = (p_command ->> 'workspaceId')::uuid
      and v_mapping.business_entity_id = (p_command ->> 'businessEntityId')::uuid
      and v_mapping.connection_id = (p_command ->> 'connectionId')::uuid
      and v_mapping.provider_entity_reference_fingerprint = v_reference_fingerprint
      and v_mapping.last_transition_request_id = p_request_id
      and v_mapping.last_transition_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'mappingId', v_mapping.id,
        'status', v_mapping.status,
        'rowVersion', v_mapping.row_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'provider_entity_mapping_conflict';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;

  if not found
    or v_connection.status not in (
      'authorized_unmapped', 'initializing', 'active', 'degraded'
    ) then
    raise exception using
      errcode = '42501',
      message = 'provider_entity_mapping_denied';
  end if;

  if p_command -> 'replacesMappingId' = 'null'::jsonb then
    v_mapping_series_id := (p_command ->> 'id')::uuid;
    v_mapping_version := 1;
  else
    select mapping.*
    into v_prior
    from private.provider_entity_mappings as mapping
    where mapping.workspace_id = v_connection.workspace_id
      and mapping.business_entity_id = v_connection.business_entity_id
      and mapping.connection_id = v_connection.id
      and mapping.id = (p_command ->> 'replacesMappingId')::uuid
    for update;
    if not found or v_prior.status <> 'inactive' then
      raise exception using
        errcode = '42501',
        message = 'provider_entity_mapping_denied';
    end if;
    v_mapping_series_id := v_prior.mapping_series_id;
    v_mapping_version := v_prior.mapping_version + 1;
  end if;

  v_mapped_by := null;

  insert into private.provider_entity_mappings (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    mapping_series_id,
    mapping_version,
    replaces_mapping_id,
    provider_key,
    provider_environment,
    provider_entity_type,
    provider_entity_reference_fingerprint,
    safe_display_name,
    mapping_role,
    status,
    verification_mode,
    mapped_by,
    mapped_at,
    last_transition_request_id,
    last_transition_request_fingerprint,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'provider_entity_mapping_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_mapping_series_id,
    v_mapping_version,
    case
      when p_command -> 'replacesMappingId' = 'null'::jsonb then null
      else (p_command ->> 'replacesMappingId')::uuid
    end,
    v_connection.provider_key,
    v_connection.provider_environment,
    p_command ->> 'providerEntityType',
    v_reference_fingerprint,
    p_command ->> 'safeDisplayName',
    p_command ->> 'mappingRole',
    'pending_verification',
    'synthetic_phase_4',
    v_mapped_by,
    (p_command ->> 'mappedAt')::timestamptz,
    p_request_id,
    v_request_fingerprint,
    (p_command ->> 'mappedAt')::timestamptz,
    (p_command ->> 'mappedAt')::timestamptz
  )
  returning * into v_mapping;

  if v_prior.id is not null then
    update private.provider_entity_mappings as mapping
    set
      status = 'replaced',
      last_transition_request_id = p_request_id,
      last_transition_request_fingerprint = v_request_fingerprint,
      row_version = mapping.row_version + 1,
      updated_at = (p_command ->> 'mappedAt')::timestamptz
    where mapping.id = v_prior.id;
  end if;

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
    retention_class
  ) values (
    v_mapping.workspace_id,
    v_mapping.business_entity_id,
    v_mapping.connection_id,
    'service',
    p_actor_id,
    'provider_entity_mapping.create',
    'succeeded',
    'provider_entity_mapping',
    v_mapping.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_connection.connection_generation,
      'mapping_status', v_mapping.status,
      'row_version', v_mapping.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'mappingId', v_mapping.id,
    'status', v_mapping.status,
    'rowVersion', v_mapping.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'provider_entity_mapping_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_entity_mapping_payload_invalid';
end;
$function$;

create or replace function public.transition_provider_entity_mapping_v1(
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
  v_mapping private.provider_entity_mappings;
  v_target_status text;
  v_verification_fingerprint bytea;
  v_request_fingerprint bytea;
  v_transitioned_at timestamptz;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'expectedRowVersion',
        'targetStatus',
        'verificationFingerprint',
        'transitionedAt'
      ]
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_entity_mapping_transition_payload_invalid';
  end if;

  v_target_status := p_command ->> 'targetStatus';
  v_transitioned_at := (p_command ->> 'transitionedAt')::timestamptz;
  v_verification_fingerprint := case
    when p_command -> 'verificationFingerprint' = 'null'::jsonb then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'verificationFingerprint'
    )
  end;
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = (p_command ->> 'workspaceId')::uuid
    and mapping.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and mapping.connection_id = (p_command ->> 'connectionId')::uuid
    and mapping.id = (p_command ->> 'mappingId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_entity_mapping_transition_denied';
  end if;
  if v_mapping.status = v_target_status
    and v_mapping.last_transition_request_id = p_request_id
    and v_mapping.last_transition_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'mappingId', v_mapping.id,
      'status', v_mapping.status,
      'rowVersion', v_mapping.row_version,
      'idempotent', true
    );
  end if;
  if v_mapping.row_version <> (p_command ->> 'expectedRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'provider_entity_mapping_row_version_stale';
  end if;
  if not private.is_provider_entity_mapping_transition_v1(
    v_mapping.status,
    v_target_status
  ) then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_transition_invalid';
  end if;
  if v_target_status = 'active' and v_verification_fingerprint is null then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_verification_required';
  end if;
  if v_target_status <> 'active'
    and v_target_status <> 'pending_verification'
    and v_verification_fingerprint is not null
    and v_verification_fingerprint is distinct from v_mapping.verification_fingerprint then
    raise exception using
      errcode = '22023',
      message = 'provider_entity_mapping_verification_invalid';
  end if;

  update private.provider_entity_mappings as mapping
  set
    status = v_target_status,
    verification_fingerprint = case
      when v_target_status = 'pending_verification' then null
      when v_target_status = 'active' then v_verification_fingerprint
      else mapping.verification_fingerprint
    end,
    verified_at = case
      when v_target_status = 'pending_verification' then null
      when v_target_status = 'active' then v_transitioned_at
      else mapping.verified_at
    end,
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    row_version = mapping.row_version + 1,
    updated_at = v_transitioned_at
  where mapping.id = v_mapping.id
  returning mapping.* into v_mapping;

  if v_target_status in ('inactive', 'replaced') and exists (
    select 1
    from private.integration_connections as connection
    where connection.workspace_id = v_mapping.workspace_id
      and connection.business_entity_id = v_mapping.business_entity_id
      and connection.id = v_mapping.connection_id
      and connection.status = 'active'
  ) and not exists (
    select 1
    from private.provider_entity_mappings as alternative
    where alternative.workspace_id = v_mapping.workspace_id
      and alternative.business_entity_id = v_mapping.business_entity_id
      and alternative.connection_id = v_mapping.connection_id
      and alternative.id <> v_mapping.id
      and alternative.status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'provider_entity_mapping_active_connection_gate';
  end if;

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
    retention_class
  ) values (
    v_mapping.workspace_id,
    v_mapping.business_entity_id,
    v_mapping.connection_id,
    'service',
    p_actor_id,
    'provider_entity_mapping.transition',
    'succeeded',
    'provider_entity_mapping',
    v_mapping.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'mapping_status', v_mapping.status,
      'row_version', v_mapping.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'mappingId', v_mapping.id,
    'status', v_mapping.status,
    'rowVersion', v_mapping.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'provider_entity_already_connected';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_entity_mapping_transition_payload_invalid';
end;
$function$;

create or replace function public.create_integration_sync_run_v1(
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
  v_connection private.integration_connections;
  v_run private.integration_sync_runs;
  v_idempotency_fingerprint bytea;
  v_request_fingerprint bytea;
  v_mapping_id uuid;
  v_window_start_at timestamptz;
  v_window_end_at timestamptz;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'trigger',
        'mode',
        'idempotencyFingerprint',
        'windowStartAt',
        'windowEndAt',
        'providerContractVersion',
        'adapterVersion',
        'policyVersion',
        'createdAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_sync_run_v1'
    or p_command ->> 'trigger' not in (
      'synthetic_verification', 'manual', 'recovery'
    )
    or p_command ->> 'mode' not in (
      'initialization', 'incremental', 'backfill', 'verification'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_payload_invalid';
  end if;

  v_mapping_id := case
    when p_command -> 'mappingId' = 'null'::jsonb then null
    else (p_command ->> 'mappingId')::uuid
  end;
  v_window_start_at := case
    when p_command -> 'windowStartAt' = 'null'::jsonb then null
    else (p_command ->> 'windowStartAt')::timestamptz
  end;
  v_window_end_at := case
    when p_command -> 'windowEndAt' = 'null'::jsonb then null
    else (p_command ->> 'windowEndAt')::timestamptz
  end;
  if (v_window_start_at is null) <> (v_window_end_at is null)
    or (v_window_start_at is not null and v_window_end_at < v_window_start_at) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_window_invalid';
  end if;
  v_idempotency_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'idempotencyFingerprint'
  );
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
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
    or v_connection.status not in ('initializing', 'active', 'degraded') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  if p_command ->> 'providerContractVersion' <> 'provider_adapter_v1'
    or p_command ->> 'adapterVersion' <> v_connection.adapter_version
    or p_command ->> 'policyVersion' <> 'synthetic_sync_policy_v1'
    or not exists (
      select 1
      from private.integration_workspace_policies as policy
      where policy.workspace_id = v_connection.workspace_id
        and policy.provider_key = v_connection.provider_key
        and policy.provider_environment = v_connection.provider_environment
        and policy.state = 'enabled'
        and policy.sync_enabled
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  if v_mapping_id is not null and not exists (
    select 1
    from private.provider_entity_mappings as mapping
    where mapping.workspace_id = v_connection.workspace_id
      and mapping.business_entity_id = v_connection.business_entity_id
      and mapping.connection_id = v_connection.id
      and mapping.id = v_mapping_id
      and mapping.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  if p_command ->> 'mode' = 'initialization'
    and (
      p_command ->> 'trigger' <> 'synthetic_verification'
      or v_mapping_id is null
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_initialization_invalid';
  end if;

  select run.*
  into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.idempotency_fingerprint = v_idempotency_fingerprint
  for update;
  if found then
    if v_run.id = (p_command ->> 'id')::uuid
      and v_run.mapping_id is not distinct from v_mapping_id
      and v_run.trigger_kind = p_command ->> 'trigger'
      and v_run.mode = p_command ->> 'mode' then
      return pg_catalog.jsonb_build_object(
        'syncRunId', v_run.id,
        'state', v_run.state,
        'rowVersion', v_run.row_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_sync_run_idempotency_conflict';
  end if;

  insert into private.integration_sync_runs (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    mapping_id,
    connection_generation,
    trigger_kind,
    mode,
    state,
    idempotency_fingerprint,
    window_start_at,
    window_end_at,
    provider_contract_version,
    adapter_version,
    policy_version,
    last_transition_request_id,
    last_transition_request_fingerprint,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_sync_run_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_mapping_id,
    v_connection.connection_generation,
    p_command ->> 'trigger',
    p_command ->> 'mode',
    'created',
    v_idempotency_fingerprint,
    v_window_start_at,
    v_window_end_at,
    p_command ->> 'providerContractVersion',
    p_command ->> 'adapterVersion',
    p_command ->> 'policyVersion',
    p_request_id,
    v_request_fingerprint,
    (p_command ->> 'createdAt')::timestamptz,
    (p_command ->> 'createdAt')::timestamptz
  )
  returning * into v_run;

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
    retention_class
  ) values (
    v_run.workspace_id,
    v_run.business_entity_id,
    v_run.connection_id,
    'service',
    p_actor_id,
    'integration_sync_run.create',
    'succeeded',
    'integration_sync_run',
    v_run.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_run.connection_generation,
      'sync_run_state', v_run.state,
      'row_version', v_run.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'syncRunId', v_run.id,
    'state', v_run.state,
    'rowVersion', v_run.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_sync_run_idempotency_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_payload_invalid';
end;
$function$;

create or replace function public.transition_integration_sync_run_v1(
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
  v_run private.integration_sync_runs;
  v_target_state text;
  v_error_category text;
  v_error_code text;
  v_request_fingerprint bytea;
  v_transitioned_at timestamptz;
  v_records_observed bigint;
  v_records_accepted bigint;
  v_records_rejected bigint;
  v_facts_accepted bigint;
  v_contributions_changed bigint;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'syncRunId',
        'expectedRowVersion',
        'targetState',
        'counts',
        'errorCategory',
        'errorCode',
        'transitionedAt'
      ]
    )
    or not private.jsonb_has_exact_keys_v1(
      p_command -> 'counts',
      array[
        'recordsObserved',
        'recordsAccepted',
        'recordsRejected',
        'factsAccepted',
        'contributionsChanged'
      ]
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_transition_payload_invalid';
  end if;

  v_target_state := p_command ->> 'targetState';
  v_error_category := case
    when p_command -> 'errorCategory' = 'null'::jsonb then null
    else p_command ->> 'errorCategory'
  end;
  v_error_code := case
    when p_command -> 'errorCode' = 'null'::jsonb then null
    else p_command ->> 'errorCode'
  end;
  v_transitioned_at := (p_command ->> 'transitionedAt')::timestamptz;
  v_records_observed := (p_command -> 'counts' ->> 'recordsObserved')::bigint;
  v_records_accepted := (p_command -> 'counts' ->> 'recordsAccepted')::bigint;
  v_records_rejected := (p_command -> 'counts' ->> 'recordsRejected')::bigint;
  v_facts_accepted := (p_command -> 'counts' ->> 'factsAccepted')::bigint;
  v_contributions_changed := (p_command -> 'counts' ->> 'contributionsChanged')::bigint;
  if v_records_observed not between 0 and 1000000000
    or v_records_accepted not between 0 and 1000000000
    or v_records_rejected not between 0 and 1000000000
    or v_facts_accepted not between 0 and 1000000000
    or v_contributions_changed not between 0 and 1000000000
    or v_records_accepted + v_records_rejected > v_records_observed then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_counts_invalid';
  end if;
  if (v_target_state = 'failed') <> (
    v_error_category is not null and v_error_code is not null
  )
    or (v_error_category is not null and v_error_category not in (
      'authorization', 'rate_limit', 'availability', 'contract', 'data', 'unknown'
    ))
    or (v_error_code is not null and not private.is_bounded_identifier_v1(v_error_code)) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_error_metadata_invalid';
  end if;
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select run.*
  into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = (p_command ->> 'workspaceId')::uuid
    and run.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and run.connection_id = (p_command ->> 'connectionId')::uuid
    and run.id = (p_command ->> 'syncRunId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_transition_denied';
  end if;
  if v_run.state = v_target_state
    and v_run.last_transition_request_id = p_request_id
    and v_run.last_transition_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'syncRunId', v_run.id,
      'state', v_run.state,
      'rowVersion', v_run.row_version,
      'idempotent', true
    );
  end if;
  if v_run.row_version <> (p_command ->> 'expectedRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_run_row_version_stale';
  end if;
  if not private.is_integration_sync_run_transition_v1(
    v_run.state,
    v_target_state
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_run_transition_invalid';
  end if;
  if v_target_state = 'running' and (
    v_records_observed <> 0
    or v_records_accepted <> 0
    or v_records_rejected <> 0
    or v_facts_accepted <> 0
    or v_contributions_changed <> 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_running_counts_invalid';
  end if;

  update private.integration_sync_runs as run
  set
    state = v_target_state,
    records_observed = v_records_observed,
    records_accepted = v_records_accepted,
    records_rejected = v_records_rejected,
    facts_accepted = v_facts_accepted,
    contributions_changed = v_contributions_changed,
    error_category = v_error_category,
    error_code = v_error_code,
    started_at = case
      when v_target_state = 'running' then v_transitioned_at
      when v_target_state in (
        'succeeded', 'partially_succeeded', 'failed', 'cancelled'
      ) then coalesce(run.started_at, v_transitioned_at)
      else run.started_at
    end,
    finished_at = case
      when v_target_state in (
        'succeeded', 'partially_succeeded', 'failed', 'cancelled'
      ) then v_transitioned_at
      else null
    end,
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    row_version = run.row_version + 1,
    updated_at = v_transitioned_at
  where run.id = v_run.id
  returning run.* into v_run;

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
    retention_class
  ) values (
    v_run.workspace_id,
    v_run.business_entity_id,
    v_run.connection_id,
    'service',
    p_actor_id,
    'integration_sync_run.transition',
    case when v_run.state = 'failed' then 'failed' else 'succeeded' end,
    'integration_sync_run',
    v_run.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_run.connection_generation,
      'sync_run_state', v_run.state,
      'row_version', v_run.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'syncRunId', v_run.id,
    'state', v_run.state,
    'rowVersion', v_run.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_transition_payload_invalid';
end;
$function$;

create or replace function public.upsert_integration_workspace_policy_v1(
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
  v_policy private.integration_workspace_policies;
  v_request_fingerprint bytea;
  v_now timestamptz := transaction_timestamp();
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'providerKey',
        'providerEnvironment',
        'state',
        'syncEnabled',
        'historyHorizonDays',
        'maximumConcurrency',
        'freshnessPolicyVersion',
        'retentionPolicyVersion',
        'rowVersion'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_workspace_policy_v1'
    or p_command ->> 'providerKey' <> 'synthetic'
    or p_command ->> 'providerEnvironment' <> 'test'
    or p_command ->> 'state' not in ('enabled', 'paused', 'disabled')
    or pg_catalog.jsonb_typeof(p_command -> 'syncEnabled') <> 'boolean'
    or ((p_command ->> 'state') = 'enabled') <> ((p_command ->> 'syncEnabled')::boolean)
    or (p_command ->> 'historyHorizonDays')::integer not between 1 and 3650
    or (p_command ->> 'maximumConcurrency')::integer not between 1 and 2
    or p_command ->> 'freshnessPolicyVersion' <> 'synthetic_freshness_policy_v1'
    or p_command ->> 'retentionPolicyVersion' <> 'synthetic_metadata_retention_v1'
    or (p_command ->> 'rowVersion')::bigint <= 0 then
    raise exception using
      errcode = '22023',
      message = 'integration_workspace_policy_payload_invalid';
  end if;
  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = (p_command ->> 'workspaceId')::uuid
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_workspace_policy_denied';
  end if;

  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select policy.*
  into v_policy
  from private.integration_workspace_policies as policy
  where policy.workspace_id = (p_command ->> 'workspaceId')::uuid
    and policy.provider_key = p_command ->> 'providerKey'
    and policy.provider_environment = p_command ->> 'providerEnvironment'
  for update;

  if found then
    if v_policy.last_request_id = p_request_id
      and v_policy.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'policyId', v_policy.id,
        'rowVersion', v_policy.row_version,
        'idempotent', true,
        'updatedAt', pg_catalog.to_char(
          v_policy.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      );
    end if;
    if v_policy.id <> (p_command ->> 'id')::uuid then
      raise exception using
        errcode = '23505',
        message = 'integration_workspace_policy_conflict';
    end if;
    if v_policy.row_version <> (p_command ->> 'rowVersion')::bigint then
      raise exception using
        errcode = '40001',
        message = 'integration_workspace_policy_row_version_stale';
    end if;
    update private.integration_workspace_policies as policy
    set
      state = p_command ->> 'state',
      sync_enabled = (p_command ->> 'syncEnabled')::boolean,
      history_horizon_days = (p_command ->> 'historyHorizonDays')::integer,
      maximum_concurrency = (p_command ->> 'maximumConcurrency')::integer,
      freshness_policy_version = p_command ->> 'freshnessPolicyVersion',
      retention_policy_version = p_command ->> 'retentionPolicyVersion',
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = policy.row_version + 1,
      updated_at = v_now
    where policy.id = v_policy.id
    returning policy.* into v_policy;
  else
    if (p_command ->> 'rowVersion')::bigint <> 1 then
      raise exception using
        errcode = '40001',
        message = 'integration_workspace_policy_row_version_stale';
    end if;
    insert into private.integration_workspace_policies (
      id,
      contract_version,
      workspace_id,
      provider_key,
      provider_environment,
      state,
      sync_enabled,
      history_horizon_days,
      maximum_concurrency,
      freshness_policy_version,
      retention_policy_version,
      row_version,
      last_request_id,
      last_request_fingerprint,
      created_at,
      updated_at
    ) values (
      (p_command ->> 'id')::uuid,
      'integration_workspace_policy_v1',
      (p_command ->> 'workspaceId')::uuid,
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment',
      p_command ->> 'state',
      (p_command ->> 'syncEnabled')::boolean,
      (p_command ->> 'historyHorizonDays')::integer,
      (p_command ->> 'maximumConcurrency')::integer,
      p_command ->> 'freshnessPolicyVersion',
      p_command ->> 'retentionPolicyVersion',
      1,
      p_request_id,
      v_request_fingerprint,
      v_now,
      v_now
    )
    returning * into v_policy;
  end if;

  insert into private.integration_audit_events (
    workspace_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    request_id,
    metadata,
    retention_class
  ) values (
    v_policy.workspace_id,
    'service',
    p_actor_id,
    'integration_workspace_policy.upsert',
    'succeeded',
    'integration_workspace_policy',
    v_policy.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'policy_state', v_policy.state,
      'row_version', v_policy.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'policyId', v_policy.id,
    'rowVersion', v_policy.row_version,
    'idempotent', false,
    'updatedAt', pg_catalog.to_char(
      v_policy.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_workspace_policy_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_workspace_policy_payload_invalid';
end;
$function$;

create or replace function public.upsert_integration_freshness_v1(
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
  v_connection private.integration_connections;
  v_freshness private.integration_freshness_states;
  v_mapping_id uuid;
  v_provider_watermark_at timestamptz;
  v_last_attempt_at timestamptz;
  v_last_successful_sync_at timestamptz;
  v_last_reconciled_at timestamptz;
  v_observed_lag_seconds bigint;
  v_calculated_at timestamptz;
  v_age_seconds bigint;
  v_status text;
  v_blocking_level text;
  v_reason_code text;
  v_latest_sync_failed boolean;
  v_derived_last_attempt_at timestamptz;
  v_derived_last_successful_sync_at timestamptz;
  v_state_fingerprint bytea;
  v_request_fingerprint bytea;
  v_existing_expected bigint;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'domain',
        'scopeKey',
        'providerWatermarkAt',
        'lastAttemptAt',
        'lastSuccessfulSyncAt',
        'lastReconciledAt',
        'observedLagSeconds',
        'policyVersion',
        'currentMaxAgeSeconds',
        'staleAfterSeconds',
        'staleBlockingLevel',
        'calculatedAt',
        'expectedRowVersion'
      ]
    )
    or not private.is_bounded_identifier_v1(p_command ->> 'domain')
    or not private.is_bounded_identifier_v1(p_command ->> 'scopeKey') then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_payload_invalid';
  end if;

  v_mapping_id := case
    when p_command -> 'mappingId' = 'null'::jsonb then null
    else (p_command ->> 'mappingId')::uuid
  end;
  v_provider_watermark_at := case
    when p_command -> 'providerWatermarkAt' = 'null'::jsonb then null
    else (p_command ->> 'providerWatermarkAt')::timestamptz
  end;
  v_last_attempt_at := case
    when p_command -> 'lastAttemptAt' = 'null'::jsonb then null
    else (p_command ->> 'lastAttemptAt')::timestamptz
  end;
  v_last_successful_sync_at := case
    when p_command -> 'lastSuccessfulSyncAt' = 'null'::jsonb then null
    else (p_command ->> 'lastSuccessfulSyncAt')::timestamptz
  end;
  v_last_reconciled_at := case
    when p_command -> 'lastReconciledAt' = 'null'::jsonb then null
    else (p_command ->> 'lastReconciledAt')::timestamptz
  end;
  v_observed_lag_seconds := case
    when p_command -> 'observedLagSeconds' = 'null'::jsonb then null
    else (p_command ->> 'observedLagSeconds')::bigint
  end;
  v_calculated_at := (p_command ->> 'calculatedAt')::timestamptz;
  v_existing_expected := case
    when p_command -> 'expectedRowVersion' = 'null'::jsonb then null
    else (p_command ->> 'expectedRowVersion')::bigint
  end;
  if v_observed_lag_seconds is not null and v_observed_lag_seconds < 0 then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_lag_invalid';
  end if;
  if v_last_successful_sync_at is not null
    and v_last_successful_sync_at > v_calculated_at then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_timestamp_invalid';
  end if;
  v_age_seconds := case
    when v_last_successful_sync_at is null then null
    else pg_catalog.floor(
      extract(epoch from (v_calculated_at - v_last_successful_sync_at))
    )::bigint
  end;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_freshness_denied';
  end if;
  if p_command ->> 'domain' <> 'general_ledger'
    or not private.is_phase_4_freshness_policy_v1(
      v_connection.provider_key,
      v_connection.provider_environment,
      p_command ->> 'policyVersion',
      (p_command ->> 'currentMaxAgeSeconds')::bigint,
      (p_command ->> 'staleAfterSeconds')::bigint,
      p_command ->> 'staleBlockingLevel'
    )
    or not exists (
      select 1
      from private.integration_workspace_policies as policy
      where policy.workspace_id = v_connection.workspace_id
        and policy.provider_key = v_connection.provider_key
        and policy.provider_environment = v_connection.provider_environment
        and policy.freshness_policy_version = p_command ->> 'policyVersion'
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_freshness_denied';
  end if;
  if v_mapping_id is not null and not exists (
    select 1
    from private.provider_entity_mappings as mapping
    where mapping.workspace_id = v_connection.workspace_id
      and mapping.business_entity_id = v_connection.business_entity_id
      and mapping.connection_id = v_connection.id
      and mapping.id = v_mapping_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_freshness_denied';
  end if;

  select
    pg_catalog.max(coalesce(run.finished_at, run.started_at, run.created_at)),
    pg_catalog.max(run.finished_at) filter (
      where run.state in ('succeeded', 'partially_succeeded')
    )
  into v_derived_last_attempt_at, v_derived_last_successful_sync_at
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and (v_mapping_id is null or run.mapping_id = v_mapping_id);

  if v_last_attempt_at is distinct from v_derived_last_attempt_at
    or v_last_successful_sync_at is distinct from v_derived_last_successful_sync_at then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_sync_evidence_invalid';
  end if;

  select coalesce((
    select run.state = 'failed'
    from private.integration_sync_runs as run
    where run.workspace_id = v_connection.workspace_id
      and run.business_entity_id = v_connection.business_entity_id
      and run.connection_id = v_connection.id
      and (v_mapping_id is null or run.mapping_id = v_mapping_id)
      and run.state in (
        'succeeded', 'partially_succeeded', 'failed', 'cancelled'
      )
    order by run.finished_at desc, run.id desc
    limit 1
  ), false)
  into v_latest_sync_failed;

  if v_connection.status = 'reauthorization_required' then
    v_status := 'reauthorization_required';
    v_blocking_level := 'all_derived';
    v_reason_code := 'connection_reauthorization_required';
  elsif v_connection.status in (
    'disconnecting', 'disconnected', 'deleting', 'deleted'
  ) then
    v_status := 'disconnected';
    v_blocking_level := 'all_derived';
    v_reason_code := 'connection_disconnected';
  elsif v_latest_sync_failed or v_connection.status = 'error' then
    v_status := 'sync_error';
    v_blocking_level := 'current_intelligence';
    v_reason_code := 'latest_sync_failed';
  elsif v_age_seconds is null then
    v_status := 'unknown';
    v_blocking_level := 'current_intelligence';
    v_reason_code := 'no_successful_sync';
  elsif v_age_seconds <= (p_command ->> 'currentMaxAgeSeconds')::bigint then
    v_status := 'current';
    v_blocking_level := 'none';
    v_reason_code := 'within_current_threshold';
  elsif v_age_seconds <= (p_command ->> 'staleAfterSeconds')::bigint then
    v_status := 'aging';
    v_blocking_level := 'warning';
    v_reason_code := 'exceeds_current_threshold';
  else
    v_status := 'stale';
    v_blocking_level := p_command ->> 'staleBlockingLevel';
    v_reason_code := 'exceeds_stale_threshold';
  end if;

  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_state_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_freshness_v1',
      'workspaceId', v_connection.workspace_id,
      'businessEntityId', v_connection.business_entity_id,
      'connectionId', v_connection.id,
      'mappingId', v_mapping_id,
      'domain', p_command ->> 'domain',
      'scopeKey', p_command ->> 'scopeKey',
      'providerWatermarkAt', v_provider_watermark_at,
      'lastAttemptAt', v_last_attempt_at,
      'lastSuccessfulSyncAt', v_last_successful_sync_at,
      'lastReconciledAt', v_last_reconciled_at,
      'observedLagSeconds', v_observed_lag_seconds,
      'status', v_status,
      'blockingLevel', v_blocking_level,
      'reasonCode', v_reason_code,
      'policyVersion', p_command ->> 'policyVersion',
      'currentMaxAgeSeconds', (p_command ->> 'currentMaxAgeSeconds')::bigint,
      'staleAfterSeconds', (p_command ->> 'staleAfterSeconds')::bigint,
      'ageSeconds', v_age_seconds,
      'calculatedAt', v_calculated_at
    )
  );

  select freshness.*
  into v_freshness
  from private.integration_freshness_states as freshness
  where freshness.workspace_id = v_connection.workspace_id
    and freshness.business_entity_id = v_connection.business_entity_id
    and freshness.connection_id = v_connection.id
    and freshness.mapping_id is not distinct from v_mapping_id
    and freshness.domain = p_command ->> 'domain'
    and freshness.scope_key = p_command ->> 'scopeKey'
  for update;

  if found then
    if v_freshness.last_request_id = p_request_id
      and v_freshness.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'freshness', private.integration_freshness_summary_json_v1(v_freshness),
        'idempotent', true
      );
    end if;
    if v_freshness.id <> (p_command ->> 'id')::uuid then
      raise exception using
        errcode = '23505',
        message = 'integration_freshness_scope_conflict';
    end if;
    if v_existing_expected is null
      or v_freshness.row_version <> v_existing_expected then
      raise exception using
        errcode = '40001',
        message = 'integration_freshness_row_version_stale';
    end if;
    update private.integration_freshness_states as freshness
    set
      provider_watermark_at = v_provider_watermark_at,
      last_attempt_at = v_last_attempt_at,
      last_successful_sync_at = v_last_successful_sync_at,
      last_reconciled_at = v_last_reconciled_at,
      observed_lag_seconds = v_observed_lag_seconds,
      status = v_status,
      blocking_level = v_blocking_level,
      reason_code = v_reason_code,
      policy_version = p_command ->> 'policyVersion',
      current_max_age_seconds = (p_command ->> 'currentMaxAgeSeconds')::bigint,
      stale_after_seconds = (p_command ->> 'staleAfterSeconds')::bigint,
      age_seconds = v_age_seconds,
      calculated_at = v_calculated_at,
      state_fingerprint = v_state_fingerprint,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = freshness.row_version + 1,
      updated_at = v_calculated_at
    where freshness.id = v_freshness.id
    returning freshness.* into v_freshness;
  else
    if v_existing_expected is not null then
      raise exception using
        errcode = '40001',
        message = 'integration_freshness_row_version_stale';
    end if;
    insert into private.integration_freshness_states (
      id,
      contract_version,
      workspace_id,
      business_entity_id,
      connection_id,
      mapping_id,
      provider_key,
      domain,
      scope_key,
      provider_watermark_at,
      last_attempt_at,
      last_successful_sync_at,
      last_reconciled_at,
      observed_lag_seconds,
      status,
      blocking_level,
      reason_code,
      policy_version,
      current_max_age_seconds,
      stale_after_seconds,
      age_seconds,
      calculated_at,
      state_fingerprint,
      last_request_id,
      last_request_fingerprint,
      row_version,
      created_at,
      updated_at
    ) values (
      (p_command ->> 'id')::uuid,
      'integration_freshness_v1',
      v_connection.workspace_id,
      v_connection.business_entity_id,
      v_connection.id,
      v_mapping_id,
      v_connection.provider_key,
      p_command ->> 'domain',
      p_command ->> 'scopeKey',
      v_provider_watermark_at,
      v_last_attempt_at,
      v_last_successful_sync_at,
      v_last_reconciled_at,
      v_observed_lag_seconds,
      v_status,
      v_blocking_level,
      v_reason_code,
      p_command ->> 'policyVersion',
      (p_command ->> 'currentMaxAgeSeconds')::bigint,
      (p_command ->> 'staleAfterSeconds')::bigint,
      v_age_seconds,
      v_calculated_at,
      v_state_fingerprint,
      p_request_id,
      v_request_fingerprint,
      1,
      v_calculated_at,
      v_calculated_at
    )
    returning * into v_freshness;
  end if;

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
    retention_class
  ) values (
    v_freshness.workspace_id,
    v_freshness.business_entity_id,
    v_freshness.connection_id,
    'service',
    p_actor_id,
    'integration_freshness.upsert',
    'succeeded',
    'integration_freshness',
    v_freshness.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'freshness_status', v_freshness.status,
      'blocking_level', v_freshness.blocking_level,
      'row_version', v_freshness.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'freshness', private.integration_freshness_summary_json_v1(v_freshness),
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_freshness_scope_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_payload_invalid';
end;
$function$;

revoke all on function public.create_integration_connection_intent_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.create_integration_connection_intent_v1(jsonb)
  to authenticated;

revoke all on function public.request_integration_disconnect_v1(uuid, bigint, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.request_integration_disconnect_v1(uuid, bigint, text)
  to authenticated;

revoke all on function public.transition_integration_connection_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.transition_integration_connection_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.replace_integration_connection_generation_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.replace_integration_connection_generation_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.create_provider_entity_mapping_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.create_provider_entity_mapping_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.transition_provider_entity_mapping_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.transition_provider_entity_mapping_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.create_integration_sync_run_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.create_integration_sync_run_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.transition_integration_sync_run_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.transition_integration_sync_run_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.upsert_integration_workspace_policy_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.upsert_integration_workspace_policy_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.upsert_integration_freshness_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
grant execute on function public.upsert_integration_freshness_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function private.assert_integration_control_plane_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_integration_audit_metadata_v4(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.phase_4_fingerprint_text_v1(bytea)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.phase_4_request_fingerprint_v1(text, jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_phase_4_provider_descriptor_v1(
  text, text, text, bytea, bytea, text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_phase_4_capability_snapshot_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_phase_4_scope_set_v1(text[])
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_phase_4_freshness_policy_v1(
  text, text, text, bigint, bigint, text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_integration_connection_transition_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_integration_connection_reason_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_provider_entity_mapping_transition_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.is_integration_sync_run_transition_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.integration_connection_summary_json_v1(
  private.integration_connections
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.integration_freshness_summary_json_v1(
  private.integration_freshness_states
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.sync_integration_connection_summary_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.sync_integration_freshness_summary_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.validate_integration_connection_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.validate_provider_entity_mapping_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.validate_integration_sync_run_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.validate_integration_freshness_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;
revoke all on function private.validate_integration_workspace_policy_mutation_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority;

commit;
