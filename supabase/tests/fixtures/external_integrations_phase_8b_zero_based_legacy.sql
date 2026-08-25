-- Synthetic pre-20260824193332 fixture for the zero-based delivery upgrade.
-- The six ambiguous rows intentionally have delivery count/fingerprint bytes
-- without a successful lease audit that could prove their dispatch generation.

begin;

create extension if not exists pgcrypto with schema extensions;

insert into public.profiles (id, email, full_name) values (
  'a8d00000-0000-4000-8000-000000000001',
  'phase8b-zero-based-fixture@example.test',
  'Phase 8B Zero-Based Fixture'
);

insert into public.workspaces (id, name, created_by) values (
  'b8d00000-0000-4000-8000-000000000001',
  'Phase 8B Zero-Based Fixture',
  'a8d00000-0000-4000-8000-000000000001'
);

insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c8d00000-0000-4000-8000-000000000001',
  'b8d00000-0000-4000-8000-000000000001',
  'a8d00000-0000-4000-8000-000000000001',
  'owner',
  'active'
);

insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8d00000-0000-4000-8000-000000000001',
  'b8d00000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_zero_based_fixture',
  'operating_company',
  'Phase 8B Zero-Based Fixture',
  'USD',
  'UTC',
  1,
  'active',
  'a8d00000-0000-4000-8000-000000000001',
  'a8d00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp()
);

create or replace function private.phase8b_zero_based_fixture_qbo_capability()
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'operations', pg_catalog.jsonb_build_array(
      'get_capabilities', 'get_source_record',
      'list_entities', 'list_source_records'
    ),
    'domains', pg_catalog.jsonb_build_array(
      'change_hints', 'company_configuration', 'financial_transactions',
      'master_records', 'report_control_observations'
    ),
    'requiredStreamKeys', pg_catalog.jsonb_build_array(
      'accounts', 'company_info', 'preferences', 'qbo_apagingsummary',
      'qbo_aragingsummary', 'qbo_balancesheet', 'qbo_bill',
      'qbo_billpayment', 'qbo_cashflow', 'qbo_creditmemo', 'qbo_deposit',
      'qbo_invoice', 'qbo_journalentry', 'qbo_payment',
      'qbo_profitandloss', 'qbo_purchase', 'qbo_refundreceipt',
      'qbo_salesreceipt', 'qbo_transfer', 'qbo_trialbalance',
      'qbo_vendorcredit'
    ),
    'supportsBackfill', true,
    'webhookMode', 'change_hints',
    'incrementalMode', 'cursor'
  );
$function$;

insert into private.integration_connections (
  id, contract_version, control_contract_version, workspace_id,
  business_entity_id, connection_series_id, connection_generation,
  replaces_connection_id, provider_key, provider_environment,
  provider_tenant_reference_fingerprint, status, state_reason_code,
  requested_scopes, granted_scopes, safe_display_name,
  provider_descriptor_registry_version,
  provider_descriptor_registry_fingerprint,
  provider_descriptor_fingerprint, adapter_version, capability_snapshot,
  configuration_version, authorized_at, status_changed_at,
  disconnected_at, deleted_at, last_transition_request_id,
  last_transition_request_fingerprint, row_version, created_by,
  created_at, updated_at
) values
  (
    'e8d00000-0000-4000-8000-000000000001',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000001', 1, null,
    'quickbooks_online', 'sandbox',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-realm', 'UTF8'),
      'sha256'
    ),
    'initializing', 'initial_sync_pending',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Synthetic QBO Sandbox Fixture',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
      'hex'
    ),
    pg_catalog.decode(
      'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
      'hex'
    ),
    'qbo_provider_adapter_v1',
    private.phase8b_zero_based_fixture_qbo_capability(),
    1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, null, null, null, 1,
    'a8d00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'e8d00000-0000-4000-8000-000000000002',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000002', 1, null,
    'quickbooks_online', 'production',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-fixture', 'UTF8'),
      'sha256'
    ),
    'initializing', 'initial_sync_pending',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Synthetic QBO Production-Labelled Fixture',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
      'hex'
    ),
    pg_catalog.decode(
      'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
      'hex'
    ),
    'qbo_provider_adapter_v1',
    private.phase8b_zero_based_fixture_qbo_capability(),
    1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, null, null, null, 1,
    'a8d00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, replaces_mapping_id, provider_key,
  provider_environment, provider_entity_type,
  provider_entity_reference_fingerprint, safe_display_name, mapping_role,
  status, verification_mode, verification_fingerprint, verified_at,
  mapped_by, mapped_at, last_transition_request_id,
  last_transition_request_fingerprint, row_version, created_at, updated_at
) values
  (
    'f8d00000-0000-4000-8000-000000000001',
    'provider_entity_mapping_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000001',
    'f8d00000-0000-4000-8000-000000000001', 1, null,
    'quickbooks_online', 'sandbox', 'company',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-entity', 'UTF8'),
      'sha256'
    ),
    'Synthetic QBO Sandbox Company', 'primary', 'active',
    'qbo_realm_mapping_v1',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-verified', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(),
    'a8d00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), null, null, 1,
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'f8d00000-0000-4000-8000-000000000002',
    'provider_entity_mapping_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000002',
    'f8d00000-0000-4000-8000-000000000002', 1, null,
    'quickbooks_online', 'production', 'company',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-entity', 'UTF8'),
      'sha256'
    ),
    'Synthetic QBO Production-Labelled Company', 'primary', 'active',
    'qbo_realm_mapping_v1',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-verified', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(),
    'a8d00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), null, null, 1,
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

insert into private.integration_workspace_policies (
  id, contract_version, workspace_id, provider_key, provider_environment,
  state, sync_enabled, history_horizon_days, maximum_concurrency,
  freshness_policy_version, retention_policy_version, row_version,
  last_request_id, last_request_fingerprint, created_at, updated_at
) values
  (
    '08d00000-0000-4000-8000-000000000001',
    'integration_workspace_policy_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'quickbooks_online', 'sandbox', 'enabled', true, 365, 2,
    'qbo_control_plane_freshness_policy_v1',
    'qbo_metadata_retention_v1', 1, 'phase8b-zero-based-sandbox-policy',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-policy', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    '08d00000-0000-4000-8000-000000000002',
    'integration_workspace_policy_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'quickbooks_online', 'production', 'enabled', true, 365, 2,
    'qbo_control_plane_freshness_policy_v1',
    'qbo_metadata_retention_v1', 1, 'phase8b-zero-based-production-policy',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-policy', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, window_start_at, window_end_at,
  provider_contract_version, adapter_version, policy_version,
  records_observed, records_accepted, records_rejected, facts_accepted,
  contributions_changed, error_category, error_code,
  last_transition_request_id, last_transition_request_fingerprint,
  created_at, started_at, finished_at, row_version, updated_at
) values
  (
    '18d00000-0000-4000-8000-000000000001',
    'integration_sync_run_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000001',
    'f8d00000-0000-4000-8000-000000000001', 1,
    'provider_initialization', 'initialization', 'running',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-run', 'UTF8'),
      'sha256'
    ),
    null, null, 'provider_adapter_v1', 'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase8b-zero-based-sandbox-run',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-sandbox-run-request', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, 2, pg_catalog.transaction_timestamp()
  ),
  (
    '18d00000-0000-4000-8000-000000000002',
    'integration_sync_run_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    'e8d00000-0000-4000-8000-000000000002',
    'f8d00000-0000-4000-8000-000000000002', 1,
    'provider_initialization', 'initialization', 'running',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-run', 'UTF8'),
      'sha256'
    ),
    null, null, 'provider_adapter_v1', 'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase8b-zero-based-production-run',
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-based-production-run-request', 'UTF8'),
      'sha256'
    ),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, 2, pg_catalog.transaction_timestamp()
  );

create table private.phase8b_zero_based_legacy_fixture_snapshot (
  task_id uuid primary key,
  contract_version text not null,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null,
  sync_run_id uuid not null,
  parent_task_id uuid,
  provider_key text not null,
  provider_environment text not null,
  queue_class text not null,
  task_kind text not null,
  stream_key text not null,
  state text not null,
  priority integer not null,
  control_metadata jsonb not null,
  idempotency_fingerprint bytea not null,
  coalescing_fingerprint bytea not null,
  dispatcher_task_name text,
  dispatch_generation bigint not null,
  last_delivery_execution_count integer not null,
  last_delivery_attempt_fingerprint bytea not null,
  attempt_count integer not null,
  maximum_attempts integer not null,
  available_at timestamptz not null,
  lease_id uuid,
  lease_owner_fingerprint bytea,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  failure_category text,
  failure_code text,
  durable_effect_fingerprint bytea,
  last_request_id text not null,
  last_request_fingerprint bytea not null,
  row_version bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  retention_expires_at timestamptz not null
);

alter table private.phase8b_zero_based_legacy_fixture_snapshot
  enable row level security;
alter table private.phase8b_zero_based_legacy_fixture_snapshot
  force row level security;
revoke all on table private.phase8b_zero_based_legacy_fixture_snapshot
  from public, anon, authenticated, service_role;

create or replace function private.phase8b_zero_based_fixture_task(
  p_task_id uuid,
  p_connection_id uuid,
  p_run_id uuid,
  p_mapping_id uuid,
  p_environment text,
  p_state text,
  p_ordinal integer,
  p_delivery_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_is_leased boolean := p_state = 'leased';
  v_created_at timestamptz := case
    when p_state = 'pending' and p_delivery_count <> -1 then
      pg_catalog.transaction_timestamp() - interval '8 days'
    else pg_catalog.transaction_timestamp()
  end;
  v_retention_expires_at timestamptz := case
    when p_state = 'pending' and p_delivery_count <> -1 then
      pg_catalog.transaction_timestamp() - interval '1 day'
    else pg_catalog.transaction_timestamp() + interval '7 days'
  end;
begin
  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, parent_task_id, provider_key,
    provider_environment, queue_class, task_kind, stream_key, state, priority,
    control_metadata, idempotency_fingerprint, coalescing_fingerprint,
    dispatcher_task_name, dispatch_generation,
    last_delivery_execution_count, last_delivery_attempt_fingerprint,
    attempt_count, maximum_attempts, available_at, lease_id,
    lease_owner_fingerprint, lease_expires_at, heartbeat_at,
    durable_effect_fingerprint, last_request_id, last_request_fingerprint,
    row_version, created_at, updated_at, completed_at, retention_expires_at
  ) values (
    p_task_id, 'integration_sync_task_v1',
    'b8d00000-0000-4000-8000-000000000001',
    'd8d00000-0000-4000-8000-000000000001',
    p_connection_id, 1, p_run_id, null, 'quickbooks_online', p_environment,
    'provider_interactive', 'incremental', 'qbo_invoice', p_state, 50,
    pg_catalog.jsonb_build_object(
      'checkpointId', null,
      'mappingId', p_mapping_id,
      'eventId', null,
      'pageOrdinal', p_ordinal,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase8b_zero_based_legacy_fixture',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-idempotency-' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-coalescing-' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    case when v_is_leased then pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'phase8b-zero-dispatch-' || p_task_id::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) else null end,
    1,
    p_delivery_count,
    case when p_delivery_count = -1 then null else extensions.digest(
      pg_catalog.convert_to('phase8b-zero-delivery-' || p_task_id::text, 'UTF8'),
      'sha256'
    ) end,
    case when p_delivery_count = -1 then 0 else 1 end,
    3,
    v_now,
    case when v_is_leased then (
      '48d00000-0000-4000-8000-' ||
      pg_catalog.lpad(p_ordinal::text, 12, '0')
    )::uuid else null end,
    case when v_is_leased then extensions.digest(
      pg_catalog.convert_to('phase8b-zero-owner-' || p_task_id::text, 'UTF8'),
      'sha256'
    ) else null end,
    case when v_is_leased then v_now + interval '10 minutes' else null end,
    case when v_is_leased then v_now else null end,
    null,
    'phase8b-zero-fixture-' || p_ordinal::text,
    extensions.digest(
      pg_catalog.convert_to('phase8b-zero-request-' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    case when p_delivery_count = -1 then 1 else 3 end,
    v_created_at,
    v_now,
    null,
    v_retention_expires_at
  );
end;
$function$;

select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000001',
  'e8d00000-0000-4000-8000-000000000001',
  '18d00000-0000-4000-8000-000000000001',
  'f8d00000-0000-4000-8000-000000000001',
  'sandbox', 'leased', 1, 0
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000002',
  'e8d00000-0000-4000-8000-000000000001',
  '18d00000-0000-4000-8000-000000000001',
  'f8d00000-0000-4000-8000-000000000001',
  'sandbox', 'leased', 2, 0
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000003',
  'e8d00000-0000-4000-8000-000000000001',
  '18d00000-0000-4000-8000-000000000001',
  'f8d00000-0000-4000-8000-000000000001',
  'sandbox', 'pending', 3, 0
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000004',
  'e8d00000-0000-4000-8000-000000000002',
  '18d00000-0000-4000-8000-000000000002',
  'f8d00000-0000-4000-8000-000000000002',
  'production', 'leased', 4, 0
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000005',
  'e8d00000-0000-4000-8000-000000000002',
  '18d00000-0000-4000-8000-000000000002',
  'f8d00000-0000-4000-8000-000000000002',
  'production', 'leased', 5, 0
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000006',
  'e8d00000-0000-4000-8000-000000000002',
  '18d00000-0000-4000-8000-000000000002',
  'f8d00000-0000-4000-8000-000000000002',
  'production', 'pending', 6, 0
);

-- Positive control: unlike the six ambiguous rows, this separate row has a
-- successful lease audit that proves dispatch generation 1.
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000007',
  'e8d00000-0000-4000-8000-000000000001',
  '18d00000-0000-4000-8000-000000000001',
  'f8d00000-0000-4000-8000-000000000001',
  'sandbox', 'leased', 7, 1
);

-- Never-delivered controls remain distinct from the six ambiguous rows and
-- are intentionally not due, so they cannot affect later regression suites.
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000008',
  'e8d00000-0000-4000-8000-000000000001',
  '18d00000-0000-4000-8000-000000000001',
  'f8d00000-0000-4000-8000-000000000001',
  'sandbox', 'pending', 8, -1
);
select private.phase8b_zero_based_fixture_task(
  '38d00000-0000-4000-8000-000000000009',
  'e8d00000-0000-4000-8000-000000000002',
  '18d00000-0000-4000-8000-000000000002',
  'f8d00000-0000-4000-8000-000000000002',
  'production', 'pending', 9, -1
);

select private.phase_6_insert_audit_v1(
  'b8d00000-0000-4000-8000-000000000001',
  'd8d00000-0000-4000-8000-000000000001',
  'e8d00000-0000-4000-8000-000000000001',
  'phase8b-zero-based-fixture-worker',
  'integration_sync_task.lease',
  'succeeded',
  'integration_sync_task',
  '38d00000-0000-4000-8000-000000000007',
  'phase8b-zero-based-proven-lease',
  pg_catalog.jsonb_build_object(
    'task_state', 'leased',
    'task_kind', 'incremental',
    'queue_class', 'provider_interactive',
    'attempt_count', 1,
    'dispatch_generation', 1,
    'row_version', 3,
    'idempotent', false
  )
);

insert into private.phase8b_zero_based_legacy_fixture_snapshot
select
  task.id, task.contract_version, task.workspace_id,
  task.business_entity_id, task.connection_id, task.connection_generation,
  task.sync_run_id, task.parent_task_id, task.provider_key,
  task.provider_environment, task.queue_class, task.task_kind,
  task.stream_key, task.state, task.priority, task.control_metadata,
  task.idempotency_fingerprint, task.coalescing_fingerprint,
  task.dispatcher_task_name, task.dispatch_generation,
  task.last_delivery_execution_count, task.last_delivery_attempt_fingerprint,
  task.attempt_count, task.maximum_attempts, task.available_at, task.lease_id,
  task.lease_owner_fingerprint, task.lease_expires_at, task.heartbeat_at,
  task.cancel_requested_at, task.failure_category, task.failure_code,
  task.durable_effect_fingerprint, task.last_request_id,
  task.last_request_fingerprint, task.row_version, task.created_at,
  task.updated_at, task.completed_at, task.retention_expires_at
from private.integration_sync_tasks as task
where task.id between
  '38d00000-0000-4000-8000-000000000001'::uuid and
  '38d00000-0000-4000-8000-000000000006'::uuid
order by task.id;

drop function private.phase8b_zero_based_fixture_task(
  uuid, uuid, uuid, uuid, text, text, integer, integer
);
drop function private.phase8b_zero_based_fixture_qbo_capability();

create or replace function private.phase8b_zero_based_fixture_lease_result(
  p_task_id uuid,
  p_lease_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
begin
  select task.* into strict v_task
  from private.integration_sync_tasks as task
  where task.id = p_task_id;

  perform public.lease_integration_sync_task_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', v_task.workspace_id,
      'businessEntityId', v_task.business_entity_id,
      'connectionId', v_task.connection_id,
      'connectionGeneration', v_task.connection_generation,
      'taskId', v_task.id,
      'expectedRowVersion', v_task.row_version,
      'workerKind', 'provider_runtime',
      'leaseId', p_lease_id,
      'leaseOwnerFingerprint',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'leaseSeconds', 120,
      'dispatcherTaskName', coalesce(
        v_task.dispatcher_task_name,
        'projects/fixture/locations/test/queues/p8b/tasks/' ||
          pg_catalog.replace(v_task.id::text, '-', '')
      ),
      'deliveryDispatchGeneration', v_task.dispatch_generation,
      'deliveryRetryCount', 1,
      'deliveryExecutionCount', 1,
      'deliveryAttemptFingerprint',
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ),
    p_request_id,
    'phase8b-zero-based-fixture-worker'
  );
  return pg_catalog.jsonb_build_object('accepted', true);
exception when others then
  return pg_catalog.jsonb_build_object(
    'accepted', false,
    'sqlstate', sqlstate,
    'message', sqlerrm
  );
end;
$function$;

revoke all on function private.phase8b_zero_based_fixture_lease_result(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

commit;
