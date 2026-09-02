create extension if not exists dblink with schema extensions;

begin;

grant usage on schema extensions
  to integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$function$;

create or replace function pg_temp.error_message(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$function$;

create or replace function pg_temp.fingerprint(p_value text)
returns text
language sql
immutable
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  );
$function$;

create or replace function pg_temp.task_command(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_sync_run_id uuid,
  p_mapping_id uuid,
  p_checkpoint_id uuid,
  p_idempotency text,
  p_task_kind text default 'incremental',
  p_queue_class text default 'provider_interactive',
  p_parent_task_id uuid default null,
  p_event_id uuid default null,
  p_maximum_attempts integer default 2
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_sync_task_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'syncRunId', p_sync_run_id,
    'parentTaskId', p_parent_task_id,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'queueClass', p_queue_class,
    'taskKind', p_task_kind,
    'streamKey', 'general_ledger',
    'priority', 50,
    'controlMetadata', pg_catalog.jsonb_build_object(
      'checkpointId', p_checkpoint_id,
      'mappingId', p_mapping_id,
      'eventId', p_event_id,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase_6_database_test',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    'idempotencyFingerprint', pg_temp.fingerprint(p_idempotency),
    'coalescingFingerprint', pg_temp.fingerprint(p_idempotency || ':coalesce'),
    'maximumAttempts', p_maximum_attempts,
    'availableAt', pg_catalog.transaction_timestamp(),
    'retentionExpiresAt', pg_catalog.transaction_timestamp() + interval '7 days',
    'createdAt', pg_catalog.transaction_timestamp()
  );
$function$;

create or replace function pg_temp.dispatch_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_task_id uuid,
  p_row_version bigint,
  p_task_name text
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'taskId', p_task_id,
    'expectedRowVersion', p_row_version,
    'dispatcherTaskName', p_task_name
  );
$function$;

create or replace function pg_temp.lease_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_task_id uuid,
  p_row_version bigint,
  p_task_name text,
  p_lease_id uuid,
  p_owner text,
  p_execution_count integer,
  p_worker_kind text default 'provider_runtime',
  p_retry_count integer default null,
  p_dispatch_generation bigint default 1
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'taskId', p_task_id,
    'expectedRowVersion', p_row_version,
    'workerKind', p_worker_kind,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'leaseSeconds', 120,
    'dispatcherTaskName', p_task_name,
    'deliveryDispatchGeneration', p_dispatch_generation,
    'deliveryRetryCount', coalesce(p_retry_count, p_execution_count),
    'deliveryExecutionCount', p_execution_count,
    'deliveryAttemptFingerprint',
      pg_temp.fingerprint(
        p_task_id::text || ':' || p_task_name || ':' ||
        p_dispatch_generation::text || ':' ||
        coalesce(p_retry_count, p_execution_count)::text || ':' ||
        p_execution_count::text
      )
  );
$function$;

create or replace function pg_temp.complete_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_task_id uuid,
  p_row_version bigint,
  p_lease_id uuid,
  p_owner text,
  p_effect text,
  p_checkpoint_id uuid,
  p_checkpoint_version bigint,
  p_cursor_version bigint
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'taskId', p_task_id,
    'expectedRowVersion', p_row_version,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'durableEffectFingerprint', pg_temp.fingerprint(p_effect),
    'checkpoint', case when p_checkpoint_id is null then 'null'::jsonb else
      pg_catalog.jsonb_build_object(
        'checkpointId', p_checkpoint_id,
        'expectedCheckpointVersion', p_checkpoint_version,
        'streamKey', 'general_ledger',
        'checkpointKind', 'cursor',
        'cursorVersion', p_cursor_version,
        'cursor', pg_catalog.jsonb_build_object(
          'protocolVersion', 'integration_sync_checkpoint_v1',
          'cursorKind', 'cursor',
          'cursorValue', 'phase6_cursor_' || p_cursor_version::text,
          'windowStartAt', null,
          'windowEndAt', null
        ),
        'cursorFingerprint',
          pg_temp.fingerprint('cursor:' || p_cursor_version::text),
        'providerWatermarkAt', pg_catalog.transaction_timestamp(),
        'overlapSeconds', 300,
        'fullReconciliation', false,
        'downstreamCommitFingerprint', pg_temp.fingerprint(p_effect)
      ) end
  );
$function$;

create or replace function pg_temp.fail_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_task_id uuid,
  p_row_version bigint,
  p_lease_id uuid,
  p_owner text,
  p_retryable boolean
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'taskId', p_task_id,
    'expectedRowVersion', p_row_version,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'failureCategory', case when p_retryable then 'rate_limit' else 'contract' end,
    'failureCode', case when p_retryable then 'synthetic_rate_limit' else 'synthetic_contract_failure' end,
    'retryable', p_retryable,
    'retryAfterSeconds', case when p_retryable then 1 else null end
  );
$function$;

create or replace function pg_temp.event_command(
  p_id uuid,
  p_event_fingerprint text,
  p_delivery_hash text,
  p_account_fingerprint text,
  p_entity_fingerprint text
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_id,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'specificationVersion', 'synthetic_webhook_v1',
    'eventType', 'source_record_changed',
    'providerEventFingerprint', p_event_fingerprint,
    'deliveryHash', p_delivery_hash,
    'providerAccountReferenceFingerprint', p_account_fingerprint,
    'providerEntityType', 'company',
    'providerEntityReferenceFingerprint', p_entity_fingerprint,
    'verifiedAt', pg_catalog.transaction_timestamp()
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a6000000-0000-4000-8000-000000000001', 'phase6-a@example.test', 'Phase 6 A'),
  ('a6000000-0000-4000-8000-000000000002', 'phase6-b@example.test', 'Phase 6 B');

insert into public.workspaces (id, name, created_by) values
  ('b6000000-0000-4000-8000-000000000001', 'Phase 6 Workspace A', 'a6000000-0000-4000-8000-000000000001'),
  ('b6000000-0000-4000-8000-000000000002', 'Phase 6 Workspace B', 'a6000000-0000-4000-8000-000000000002');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('ba000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('ba000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000002', 'owner', 'active');

insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values
  (
    'c6000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'business_entity_v1', 'phase6_company_a', 'operating_company',
    'Phase 6 Company A', 'USD', 'UTC', 1, 'active',
    'a6000000-0000-4000-8000-000000000001',
    'a6000000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'c6000000-0000-4000-8000-000000000002',
    'b6000000-0000-4000-8000-000000000002',
    'business_entity_v1', 'phase6_company_b', 'operating_company',
    'Phase 6 Company B', 'USD', 'UTC', 1, 'active',
    'a6000000-0000-4000-8000-000000000002',
    'a6000000-0000-4000-8000-000000000002',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

insert into private.integration_connections (
  id, contract_version, control_contract_version, workspace_id,
  business_entity_id, connection_series_id, connection_generation,
  replaces_connection_id, provider_key, provider_environment,
  provider_tenant_reference_fingerprint, status, state_reason_code,
  requested_scopes, granted_scopes, safe_display_name,
  provider_descriptor_registry_version, provider_descriptor_registry_fingerprint,
  provider_descriptor_fingerprint, adapter_version, capability_snapshot,
  configuration_version, authorized_at, status_changed_at, disconnected_at,
  deleted_at, last_transition_request_id, last_transition_request_fingerprint,
  row_version, created_by, created_at, updated_at
) values
  (
    'd6000000-0000-4000-8000-000000000001',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b6000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001', 1, null,
    'synthetic', 'test',
    extensions.digest(pg_catalog.convert_to('phase6-tenant-a', 'UTF8'), 'sha256'),
    'active', 'healthy', array['read_synthetic_business_data']::text[],
    array['read_synthetic_business_data']::text[], 'Phase 6 Synthetic A',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode('f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80', 'hex'),
    pg_catalog.decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
    'synthetic_control_plane_adapter_v1',
    pg_catalog.jsonb_build_object(
      'operations', pg_catalog.jsonb_build_array('get_capabilities', 'get_source_record', 'list_entities', 'list_source_records'),
      'domains', pg_catalog.jsonb_build_array('general_ledger'),
      'requiredStreamKeys', pg_catalog.jsonb_build_array('general_ledger'),
      'supportsBackfill', true, 'webhookMode', 'none', 'incrementalMode', 'cursor'
    ),
    1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, null, null, null, 1,
    'a6000000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'd6000000-0000-4000-8000-000000000002',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b6000000-0000-4000-8000-000000000002',
    'c6000000-0000-4000-8000-000000000002',
    'd6000000-0000-4000-8000-000000000002', 1, null,
    'synthetic', 'test',
    extensions.digest(pg_catalog.convert_to('phase6-tenant-b', 'UTF8'), 'sha256'),
    'active', 'healthy', array['read_synthetic_business_data']::text[],
    array['read_synthetic_business_data']::text[], 'Phase 6 Synthetic B',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode('f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80', 'hex'),
    pg_catalog.decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
    'synthetic_control_plane_adapter_v1',
    pg_catalog.jsonb_build_object(
      'operations', pg_catalog.jsonb_build_array('get_capabilities', 'get_source_record', 'list_entities', 'list_source_records'),
      'domains', pg_catalog.jsonb_build_array('general_ledger'),
      'requiredStreamKeys', pg_catalog.jsonb_build_array('general_ledger'),
      'supportsBackfill', true, 'webhookMode', 'none', 'incrementalMode', 'cursor'
    ),
    1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, null, null, null, 1,
    'a6000000-0000-4000-8000-000000000002',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, replaces_mapping_id, provider_key,
  provider_environment, provider_entity_type,
  provider_entity_reference_fingerprint, safe_display_name, mapping_role,
  status, verification_mode, verification_fingerprint, verified_at, mapped_by,
  mapped_at, last_transition_request_id, last_transition_request_fingerprint,
  row_version, created_at, updated_at
) values
  (
    'e6000000-0000-4000-8000-000000000001', 'provider_entity_mapping_v1',
    'b6000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    'e6000000-0000-4000-8000-000000000001', 1, null,
    'synthetic', 'test', 'company',
    extensions.digest(pg_catalog.convert_to('phase6-entity-a', 'UTF8'), 'sha256'),
    'Phase 6 Entity A', 'primary', 'active', 'synthetic_phase_4',
    extensions.digest(pg_catalog.convert_to('phase6-verified-a', 'UTF8'), 'sha256'),
    pg_catalog.transaction_timestamp(), 'a6000000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), null, null, 1,
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'e6000000-0000-4000-8000-000000000002', 'provider_entity_mapping_v1',
    'b6000000-0000-4000-8000-000000000002',
    'c6000000-0000-4000-8000-000000000002',
    'd6000000-0000-4000-8000-000000000002',
    'e6000000-0000-4000-8000-000000000002', 1, null,
    'synthetic', 'test', 'company',
    extensions.digest(pg_catalog.convert_to('phase6-entity-b', 'UTF8'), 'sha256'),
    'Phase 6 Entity B', 'primary', 'active', 'synthetic_phase_4',
    extensions.digest(pg_catalog.convert_to('phase6-verified-b', 'UTF8'), 'sha256'),
    pg_catalog.transaction_timestamp(), 'a6000000-0000-4000-8000-000000000002',
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
    '06000000-0000-4000-8000-000000000001', 'integration_workspace_policy_v1',
    'b6000000-0000-4000-8000-000000000001', 'synthetic', 'test',
    'enabled', true, 365, 2, 'synthetic_freshness_policy_v1',
    'synthetic_metadata_retention_v1', 1, 'phase6-policy-a',
    extensions.digest(pg_catalog.convert_to('phase6-policy-a', 'UTF8'), 'sha256'),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    '06000000-0000-4000-8000-000000000002', 'integration_workspace_policy_v1',
    'b6000000-0000-4000-8000-000000000002', 'synthetic', 'test',
    'enabled', true, 365, 2, 'synthetic_freshness_policy_v1',
    'synthetic_metadata_retention_v1', 1, 'phase6-policy-b',
    extensions.digest(pg_catalog.convert_to('phase6-policy-b', 'UTF8'), 'sha256'),
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
    'f6000000-0000-4000-8000-000000000001', 'integration_sync_run_v1',
    'b6000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000001',
    'd6000000-0000-4000-8000-000000000001',
    'e6000000-0000-4000-8000-000000000001', 1,
    'synthetic_verification', 'verification', 'running',
    extensions.digest(pg_catalog.convert_to('phase6-run-a', 'UTF8'), 'sha256'),
    null, null, 'provider_adapter_v1', 'synthetic_control_plane_adapter_v1',
    'synthetic_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase6-run-a',
    extensions.digest(pg_catalog.convert_to('phase6-run-a-request', 'UTF8'), 'sha256'),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, 2, pg_catalog.transaction_timestamp()
  ),
  (
    'f6000000-0000-4000-8000-000000000002', 'integration_sync_run_v1',
    'b6000000-0000-4000-8000-000000000002',
    'c6000000-0000-4000-8000-000000000002',
    'd6000000-0000-4000-8000-000000000002',
    'e6000000-0000-4000-8000-000000000002', 1,
    'synthetic_verification', 'verification', 'running',
    extensions.digest(pg_catalog.convert_to('phase6-run-b', 'UTF8'), 'sha256'),
    null, null, 'provider_adapter_v1', 'synthetic_control_plane_adapter_v1',
    'synthetic_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase6-run-b',
    extensions.digest(pg_catalog.convert_to('phase6-run-b-request', 'UTF8'), 'sha256'),
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    null, 2, pg_catalog.transaction_timestamp()
  );

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_roles
    where rolname in (
      'integration_webhook_ingress_authority',
      'integration_task_dispatch_authority',
      'integration_task_scheduler_authority',
      'integration_provider_runtime_authority',
      'integration_deterministic_runtime_authority'
    )
      and not rolcanlogin
      and not rolinherit
  ),
  5,
  'all five Phase 6 authority roles are NOLOGIN and NOINHERIT'
);

select ok(
  has_function_privilege(
    'integration_task_scheduler_authority',
    'public.discover_integration_sync_dispatch_v1(text,integer)',
    'EXECUTE'
  )
    and has_function_privilege(
      'integration_task_scheduler_authority',
      'public.discover_integration_sync_due_work_v1(timestamptz,integer)',
      'EXECUTE'
    )
    and has_function_privilege(
      'integration_task_scheduler_authority',
      'public.sweep_integration_sync_tasks_v1(integer,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'integration_task_dispatch_authority',
      'public.discover_integration_sync_dispatch_v1(text,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'integration_task_dispatch_authority',
      'public.discover_integration_sync_due_work_v1(timestamptz,integer)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'integration_task_dispatch_authority',
      'public.sweep_integration_sync_tasks_v1(integer,text,text)',
      'EXECUTE'
    ),
  'global scheduling is separated from connection-scoped dispatch authority'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in (
        'integration_sync_tasks',
        'integration_sync_checkpoints',
        'integration_webhook_events',
        'integration_runtime_circuits',
        'integration_rate_limit_states'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  5,
  'all five Phase 6 tables enable and force RLS'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'private'
      and tablename in (
        'integration_sync_tasks',
        'integration_sync_checkpoints',
        'integration_webhook_events',
        'integration_runtime_circuits',
        'integration_rate_limit_states'
      )
  ),
  0,
  'Phase 6 private tables expose no client RLS policy'
);

select ok(
  not has_table_privilege('anon', 'private.integration_sync_tasks', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'private.integration_sync_tasks', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('service_role', 'private.integration_sync_tasks', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon, authenticated, and service_role receive no task-ledger DML'
);

select ok(
  not has_table_privilege('integration_provider_runtime_authority', 'private.integration_sync_tasks', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('integration_task_dispatch_authority', 'private.integration_sync_tasks', 'SELECT,INSERT,UPDATE,DELETE'),
  'runtime roles mutate state only through checked RPCs'
);

select ok(
  has_function_privilege(
    'integration_task_dispatch_authority',
    'public.create_integration_sync_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'service_role',
      'public.create_integration_sync_task_v1(jsonb,text,text)',
      'EXECUTE'
    ),
  'task creation is granted only to dispatch authority'
);

select ok(
  has_function_privilege(
    'integration_provider_runtime_authority',
    'public.lease_integration_sync_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
    and has_function_privilege(
      'integration_deterministic_runtime_authority',
      'public.lease_integration_sync_task_v1(jsonb,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'integration_control_plane_authority',
      'public.lease_integration_sync_task_v1(jsonb,text,text)',
      'EXECUTE'
    ),
  'lease RPC preserves provider/deterministic worker separation'
);

select ok(
  has_function_privilege(
    'integration_webhook_ingress_authority',
    'public.record_integration_webhook_event_v1(jsonb,text)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'integration_webhook_ingress_authority',
      'public.create_integration_sync_task_v1(jsonb,text,text)',
      'EXECUTE'
    ),
  'webhook ingress can record minimized events but cannot create tasks'
);

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1('{}'::jsonb, 'forged', 'service-role')$$,
    '42501'
  ),
  'service_role has no broad runtime shortcut'
);
reset role;

-- Hosted/local dblink concurrency exercise. The fixture contains synthetic metadata
-- only and persists solely in the disposable database running this suite.
select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (values ('phase6_lease_concurrency_1'), ('phase6_lease_concurrency_2'))
  as connections(connection_name);

select extensions.dblink_exec(
  'phase6_lease_concurrency_1',
  $setup$
    insert into public.profiles (id, email, full_name)
    values (
      'a6c00000-0000-4000-8000-000000000001',
      'phase6-concurrency@example.test',
      'Phase 6 Concurrency'
    );
    insert into public.workspaces (id, name, created_by)
    values (
      'b6c00000-0000-4000-8000-000000000001',
      'Phase 6 Concurrency',
      'a6c00000-0000-4000-8000-000000000001'
    );
    insert into public.business_entities (
      id, workspace_id, contract_version, entity_key, entity_type,
      display_name, base_currency, timezone, fiscal_year_start_month, status,
      created_by, updated_by, created_at, updated_at
    ) values (
      'c6c00000-0000-4000-8000-000000000001',
      'b6c00000-0000-4000-8000-000000000001',
      'business_entity_v1', 'phase6_concurrency', 'operating_company',
      'Phase 6 Concurrency', 'USD', 'UTC', 1, 'active',
      'a6c00000-0000-4000-8000-000000000001',
      'a6c00000-0000-4000-8000-000000000001',
      transaction_timestamp(), transaction_timestamp()
    );
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
    ) values (
      'd6c00000-0000-4000-8000-000000000001',
      'integration_connection_v1', 'integration_connection_control_v1',
      'b6c00000-0000-4000-8000-000000000001',
      'c6c00000-0000-4000-8000-000000000001',
      'd6c00000-0000-4000-8000-000000000001', 1, null,
      'synthetic', 'test',
      extensions.digest(convert_to('phase6-concurrency-tenant', 'UTF8'), 'sha256'),
      'active', 'healthy', array['read_synthetic_business_data']::text[],
      array['read_synthetic_business_data']::text[], 'Synthetic Concurrency',
      'vaeroex_provider_descriptors_v1',
      decode('f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80', 'hex'),
      decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
      'synthetic_control_plane_adapter_v1',
      jsonb_build_object(
        'operations', jsonb_build_array(
          'get_capabilities', 'get_source_record',
          'list_entities', 'list_source_records'
        ),
        'domains', jsonb_build_array('general_ledger'),
        'requiredStreamKeys', jsonb_build_array('general_ledger'),
        'supportsBackfill', true,
        'webhookMode', 'none',
        'incrementalMode', 'cursor'
      ),
      1, transaction_timestamp(), transaction_timestamp(), null, null,
      null, null, 1, 'a6c00000-0000-4000-8000-000000000001',
      transaction_timestamp(), transaction_timestamp()
    );
    insert into private.integration_workspace_policies (
      id, contract_version, workspace_id, provider_key, provider_environment,
      state, sync_enabled, history_horizon_days, maximum_concurrency,
      freshness_policy_version, retention_policy_version, row_version,
      last_request_id, last_request_fingerprint, created_at, updated_at
    ) values (
      '06c00000-0000-4000-8000-000000000001',
      'integration_workspace_policy_v1',
      'b6c00000-0000-4000-8000-000000000001', 'synthetic', 'test',
      'enabled', true, 365, 2, 'synthetic_freshness_policy_v1',
      'synthetic_metadata_retention_v1', 1, 'phase6-concurrency-policy',
      extensions.digest(convert_to('phase6-concurrency-policy', 'UTF8'), 'sha256'),
      transaction_timestamp(), transaction_timestamp()
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
    ) values (
      'f6c00000-0000-4000-8000-000000000001',
      'integration_sync_run_v1',
      'b6c00000-0000-4000-8000-000000000001',
      'c6c00000-0000-4000-8000-000000000001',
      'd6c00000-0000-4000-8000-000000000001', null, 1,
      'synthetic_verification', 'verification', 'running',
      extensions.digest(convert_to('phase6-concurrency-run', 'UTF8'), 'sha256'),
      null, null, 'provider_adapter_v1',
      'synthetic_control_plane_adapter_v1', 'synthetic_sync_policy_v1',
      0, 0, 0, 0, 0, null, null,
      'phase6-concurrency-run',
      extensions.digest(convert_to('phase6-concurrency-run-request', 'UTF8'), 'sha256'),
      transaction_timestamp(), transaction_timestamp(), null, 2,
      transaction_timestamp()
    );
    set role integration_task_dispatch_authority;
    do $create_task$
    begin
      perform public.create_integration_sync_task_v1(
        jsonb_build_object(
          'contractVersion', 'integration_sync_task_v1',
          'id', '16c00000-0000-4000-8000-000000000001',
          'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
          'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
          'connectionId', 'd6c00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'syncRunId', 'f6c00000-0000-4000-8000-000000000001',
          'parentTaskId', null,
          'providerKey', 'synthetic',
          'providerEnvironment', 'test',
          'queueClass', 'provider_interactive',
          'taskKind', 'incremental',
          'streamKey', 'general_ledger',
          'priority', 50,
          'controlMetadata', jsonb_build_object(
            'checkpointId', null,
            'mappingId', null,
            'eventId', null,
            'pageOrdinal', 0,
            'cursorVersion', 0,
            'windowStartAt', null,
            'windowEndAt', null,
            'reasonCode', 'phase6_concurrency',
            'recordHintCount', 1,
            'coalescedEventCount', 1
          ),
          'idempotencyFingerprint',
            'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          'coalescingFingerprint',
            'sha256:2222222222222222222222222222222222222222222222222222222222222222',
          'maximumAttempts', 2,
          'availableAt', transaction_timestamp(),
          'retentionExpiresAt', transaction_timestamp() + interval '7 days',
          'createdAt', transaction_timestamp()
        ),
        'phase6-concurrency-create',
        'phase6-concurrency-dispatcher'
      );
      perform public.mark_integration_sync_task_dispatched_v1(
        jsonb_build_object(
          'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
          'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
          'connectionId', 'd6c00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'taskId', '16c00000-0000-4000-8000-000000000001',
          'expectedRowVersion', 1,
          'dispatcherTaskName',
            'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        ),
        'phase6-concurrency-dispatch',
        'phase6-concurrency-dispatcher'
      );
      perform public.create_integration_sync_task_v1(
        jsonb_build_object(
          'contractVersion', 'integration_sync_task_v1',
          'id', '16c00000-0000-4000-8000-000000000002',
          'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
          'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
          'connectionId', 'd6c00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'syncRunId', 'f6c00000-0000-4000-8000-000000000001',
          'parentTaskId', null,
          'providerKey', 'synthetic',
          'providerEnvironment', 'test',
          'queueClass', 'provider_interactive',
          'taskKind', 'incremental',
          'streamKey', 'general_ledger',
          'priority', 50,
          'controlMetadata', jsonb_build_object(
            'checkpointId', null,
            'mappingId', null,
            'eventId', null,
            'pageOrdinal', 0,
            'cursorVersion', 0,
            'windowStartAt', null,
            'windowEndAt', null,
            'reasonCode', 'phase6_zero_concurrency',
            'recordHintCount', 1,
            'coalescedEventCount', 1
          ),
          'idempotencyFingerprint',
            'sha256:7777777777777777777777777777777777777777777777777777777777777777',
          'coalescingFingerprint',
            'sha256:8888888888888888888888888888888888888888888888888888888888888888',
          'maximumAttempts', 2,
          'availableAt', transaction_timestamp(),
          'retentionExpiresAt', transaction_timestamp() + interval '7 days',
          'createdAt', transaction_timestamp()
        ),
        'phase6-zero-concurrency-create',
        'phase6-concurrency-dispatcher'
      );
      perform public.mark_integration_sync_task_dispatched_v1(
        jsonb_build_object(
          'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
          'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
          'connectionId', 'd6c00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'taskId', '16c00000-0000-4000-8000-000000000002',
          'expectedRowVersion', 1,
          'dispatcherTaskName',
            'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        ),
        'phase6-zero-concurrency-dispatch',
        'phase6-concurrency-dispatcher'
      );
    end;
    $create_task$;
    reset role
  $setup$
);

select extensions.dblink_exec(
  connection_name,
  'set role integration_provider_runtime_authority'
)
from (values ('phase6_lease_concurrency_1'), ('phase6_lease_concurrency_2'))
  as connections(connection_name);

select extensions.dblink_send_query(
  'phase6_lease_concurrency_1',
  $query$
    select public.lease_integration_sync_task_v1(
      jsonb_build_object(
        'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
        'connectionId', 'd6c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '16c00000-0000-4000-8000-000000000001',
        'expectedRowVersion', 2,
        'workerKind', 'provider_runtime',
        'leaseId', '66c00000-0000-4000-8000-000000000001',
        'leaseOwnerFingerprint',
          'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        'leaseSeconds', 120,
        'dispatcherTaskName',
          'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'deliveryDispatchGeneration', 1,
        'deliveryRetryCount', 0,
        'deliveryExecutionCount', 0,
        'deliveryAttemptFingerprint',
          'sha256:4444444444444444444444444444444444444444444444444444444444444444'
      ),
      'phase6-concurrency-lease-1',
      'phase6-provider-worker-1'
    )
  $query$
);

select extensions.dblink_send_query(
  'phase6_lease_concurrency_2',
  $query$
    select public.lease_integration_sync_task_v1(
      jsonb_build_object(
        'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
        'connectionId', 'd6c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '16c00000-0000-4000-8000-000000000001',
        'expectedRowVersion', 2,
        'workerKind', 'provider_runtime',
        'leaseId', '66c00000-0000-4000-8000-000000000002',
        'leaseOwnerFingerprint',
          'sha256:5555555555555555555555555555555555555555555555555555555555555555',
        'leaseSeconds', 120,
        'dispatcherTaskName',
          'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'deliveryDispatchGeneration', 1,
        'deliveryRetryCount', 0,
        'deliveryExecutionCount', 0,
        'deliveryAttemptFingerprint',
          'sha256:6666666666666666666666666666666666666666666666666666666666666666'
      ),
      'phase6-concurrency-lease-2',
      'phase6-provider-worker-2'
    )
  $query$
);

create temporary table phase6_concurrent_lease_results (
  result jsonb not null,
  execution_count integer not null
) on commit drop;

insert into phase6_concurrent_lease_results(result, execution_count)
select result, 0
from extensions.dblink_get_result('phase6_lease_concurrency_1')
  as response(result jsonb);
insert into phase6_concurrent_lease_results(result, execution_count)
select result, 0
from extensions.dblink_get_result('phase6_lease_concurrency_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase6_lease_concurrency_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase6_lease_concurrency_2')
  as response(result jsonb);

select is(
  (select pg_catalog.count(*)::integer from phase6_concurrent_lease_results),
  2,
  'both concurrent workers receive an authoritative result'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_lease_results
    where (result ->> 'acquired')::boolean
  ),
  1,
  'exactly one concurrent worker acquires the durable lease'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_lease_results
    where not (result ->> 'acquired')::boolean
  ),
  1,
  'exactly one concurrent worker receives no execution authority'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_lease_results
    where (result ->> 'acquired')::boolean
      and not (result ->> 'idempotent')::boolean
      and not (result ->> 'terminalReplay')::boolean
      and result ->> 'reasonCode' = 'leased'
      and result ->> 'state' = 'leased'
      and (result ->> 'attemptCount')::integer = 1
  ),
  1,
  'concurrent winner returns the bounded leased-owner result'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_lease_results
    where not (result ->> 'acquired')::boolean
      and (result ->> 'idempotent')::boolean
      and not (result ->> 'terminalReplay')::boolean
      and result ->> 'reasonCode' = 'delivery_replayed'
      and result ->> 'state' = 'leased'
      and (result ->> 'attemptCount')::integer = 1
  ),
  1,
  'same-tuple concurrent loser returns the bounded delivery-replayed result'
);

select ok(
  (
    select task.state = 'leased'
      and task.attempt_count = 1
      and task.lease_id is not null
      and task.durable_effect_fingerprint is null
    from private.integration_sync_tasks as task
    where task.id = '16c00000-0000-4000-8000-000000000001'
  ),
  'the concurrent race creates one lease and no provider effect'
);

select is(
  (
    select task.last_delivery_retry_count
    from private.integration_sync_tasks as task
    where task.id = '16c00000-0000-4000-8000-000000000001'
  ),
  0,
  'concurrent first delivery persists the required retry count zero'
);

select is(
  (
    select task.last_delivery_execution_count
    from private.integration_sync_tasks as task
    where task.id = '16c00000-0000-4000-8000-000000000001'
  ),
  0,
  'concurrent first delivery persists the required execution count zero'
);

-- Close the first synthetic proof lease before the independent zero/zero race
-- so admission control cannot become the result under test.
select extensions.dblink_exec(
  'phase6_lease_concurrency_1',
  'reset role'
);
select extensions.dblink_exec(
  'phase6_lease_concurrency_1',
  $complete_first_race$
    update private.integration_sync_tasks
    set state = 'succeeded',
        lease_id = null,
        lease_owner_fingerprint = null,
        lease_expires_at = null,
        heartbeat_at = null,
        durable_effect_fingerprint =
          decode(repeat('c', 64), 'hex'),
        completed_at = transaction_timestamp(),
        row_version = row_version + 1,
        updated_at = transaction_timestamp()
    where id = '16c00000-0000-4000-8000-000000000001'
  $complete_first_race$
);
select extensions.dblink_exec(
  'phase6_lease_concurrency_1',
  'set role integration_provider_runtime_authority'
);

select extensions.dblink_send_query(
  'phase6_lease_concurrency_1',
  $query$
    select public.lease_integration_sync_task_v1(
      jsonb_build_object(
        'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
        'connectionId', 'd6c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '16c00000-0000-4000-8000-000000000002',
        'expectedRowVersion', 2,
        'workerKind', 'provider_runtime',
        'leaseId', '66c00000-0000-4000-8000-000000000003',
        'leaseOwnerFingerprint',
          'sha256:9999999999999999999999999999999999999999999999999999999999999999',
        'leaseSeconds', 120,
        'dispatcherTaskName',
          'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'deliveryDispatchGeneration', 1,
        'deliveryRetryCount', 0,
        'deliveryExecutionCount', 0,
        'deliveryAttemptFingerprint',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      'phase6-zero-concurrency-lease-1',
      'phase6-provider-worker-1'
    )
  $query$
);

select extensions.dblink_send_query(
  'phase6_lease_concurrency_2',
  $query$
    select public.lease_integration_sync_task_v1(
      jsonb_build_object(
        'workspaceId', 'b6c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'c6c00000-0000-4000-8000-000000000001',
        'connectionId', 'd6c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '16c00000-0000-4000-8000-000000000002',
        'expectedRowVersion', 2,
        'workerKind', 'provider_runtime',
        'leaseId', '66c00000-0000-4000-8000-000000000004',
        'leaseOwnerFingerprint',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'leaseSeconds', 120,
        'dispatcherTaskName',
          'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'deliveryDispatchGeneration', 1,
        'deliveryRetryCount', 0,
        'deliveryExecutionCount', 0,
        'deliveryAttemptFingerprint',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      'phase6-zero-concurrency-lease-2',
      'phase6-provider-worker-2'
    )
  $query$
);

create temporary table phase6_concurrent_zero_results (
  result jsonb not null
) on commit drop;

insert into phase6_concurrent_zero_results(result)
select result
from extensions.dblink_get_result('phase6_lease_concurrency_1')
  as response(result jsonb);
insert into phase6_concurrent_zero_results(result)
select result
from extensions.dblink_get_result('phase6_lease_concurrency_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase6_lease_concurrency_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase6_lease_concurrency_2')
  as response(result jsonb);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_zero_results
    where (result ->> 'acquired')::boolean
  ),
  1,
  'exactly one concurrent execution-count-zero delivery acquires the lease'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase6_concurrent_zero_results
    where not (result ->> 'acquired')::boolean
      and (result ->> 'idempotent')::boolean
      and not (result ->> 'terminalReplay')::boolean
      and result ->> 'reasonCode' = 'delivery_replayed'
  ),
  1,
  'the identical execution-count-zero loser converges as a bounded idempotent replay'
);

select ok(
  (
    select task.state = 'leased'
      and task.attempt_count = 1
      and task.delivery_attribution_state = 'attributed'
      and task.last_delivery_dispatch_generation = task.dispatch_generation
      and task.last_delivery_retry_count = 0
      and task.last_delivery_execution_count = 0
      and task.lease_id is not null
      and task.durable_effect_fingerprint is null
    from private.integration_sync_tasks as task
    where task.id = '16c00000-0000-4000-8000-000000000002'
  ),
  'concurrent first delivery creates one lease and one zero-based evidence tuple'
);

select extensions.dblink_disconnect(connection_name)
from (values ('phase6_lease_concurrency_1'), ('phase6_lease_concurrency_2'))
  as connections(connection_name);

create or replace function pg_temp.exercise_phase6_fairness()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_first jsonb;
  v_second jsonb;
  v_task private.integration_sync_tasks;
begin
  v_first := public.discover_integration_sync_dispatch_v1(
    'provider_bulk',
    1
  ) -> 0;
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.id = (v_first ->> 'taskId')::uuid;
  perform public.mark_integration_sync_task_dispatched_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', v_task.workspace_id,
      'businessEntityId', v_task.business_entity_id,
      'connectionId', v_task.connection_id,
      'connectionGeneration', v_task.connection_generation,
      'taskId', v_task.id,
      'expectedRowVersion', v_task.row_version,
      'dispatcherTaskName',
        'projects/phase6-test/locations/us-central1/queues/provider-bulk/tasks/' ||
        pg_catalog.encode(v_task.idempotency_fingerprint, 'hex')
    ),
    'phase6-fairness-first',
    'phase6-dispatcher'
  );
  v_second := public.discover_integration_sync_dispatch_v1(
    'provider_bulk',
    1
  ) -> 0;
  return pg_catalog.jsonb_build_object(
    'firstWorkspaceId', v_first ->> 'workspaceId',
    'secondWorkspaceId', v_second ->> 'workspaceId',
    'differentWorkspaces',
      (v_first ->> 'workspaceId') <> (v_second ->> 'workspaceId')
  );
end;
$function$;

set local role integration_task_dispatch_authority;

select is(
  public.create_integration_sync_task_v1(
    pg_catalog.jsonb_set(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000011',
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000011',
        'phase6-fairness-noisy', 'initial_historical', 'provider_bulk'
      ),
      '{controlMetadata,recordHintCount}',
      '100000'::jsonb
    ),
    'phase6-fairness-noisy-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'noisy workspace represents 100,000 pending synthetic records in bounded work'
);

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000012',
      'b6000000-0000-4000-8000-000000000002',
      'c6000000-0000-4000-8000-000000000002',
      'd6000000-0000-4000-8000-000000000002',
      'f6000000-0000-4000-8000-000000000002',
      'e6000000-0000-4000-8000-000000000002',
      '26000000-0000-4000-8000-000000000012',
      'phase6-fairness-quiet', 'initial_historical', 'provider_bulk'
    ),
    'phase6-fairness-quiet-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'small workspace has independent pending work'
);

select is(
  pg_temp.exercise_phase6_fairness() ->> 'differentWorkspaces',
  'true',
  'round-robin dispatch gives the small workspace forward progress within two selections'
);

reset role;

update private.integration_connections
set
  status = 'deleting',
  state_reason_code = 'deletion_requested',
  status_changed_at = pg_catalog.transaction_timestamp(),
  row_version = row_version + 1,
  updated_at = pg_catalog.transaction_timestamp()
where id = 'd6000000-0000-4000-8000-000000000002';

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_connections
      set
        status = 'deleted',
        state_reason_code = 'deleted',
        deleted_at = transaction_timestamp(),
        status_changed_at = transaction_timestamp(),
        row_version = row_version + 1,
        updated_at = transaction_timestamp()
      where id = 'd6000000-0000-4000-8000-000000000002'$$,
    '55000'
  ),
  'connection deletion fails closed while runtime work remains active'
);

set local role integration_task_dispatch_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000013',
        'b6000000-0000-4000-8000-000000000002',
        'c6000000-0000-4000-8000-000000000002',
        'd6000000-0000-4000-8000-000000000002',
        'f6000000-0000-4000-8000-000000000002',
        'e6000000-0000-4000-8000-000000000002',
        '26000000-0000-4000-8000-000000000013',
        'phase6-task-after-delete-request'
      ),
      'phase6-task-after-delete-request',
      'phase6-dispatcher'
    )$$,
    '42501'
  ),
  'new work is denied after connection deletion begins'
);
reset role;

select ok(
  not exists (
    select 1
    from private.integration_audit_events
    where action like 'integration_%'
      and metadata::text ~* '(access.?token|refresh.?token|client.?secret|authorization.?code|ciphertext|raw.?body)'
  ),
  'Phase 6 audit metadata contains no credential or raw provider payload'
);

set local role integration_webhook_ingress_authority;

select is(
  public.record_integration_webhook_event_v1(
    pg_temp.event_command(
      '36000000-0000-4000-8000-000000000001',
      pg_temp.fingerprint('phase6-provider-event-1'),
      pg_temp.fingerprint('phase6-delivery-1'),
      pg_temp.fingerprint('phase6-tenant-a'),
      pg_temp.fingerprint('phase6-entity-a')
    ),
    'phase6-webhook-1'
  ) ->> 'verificationState',
  'verified',
  'verified minimized event resolves scope from persisted mapping authority'
);

select is(
  public.record_integration_webhook_event_v1(
    pg_temp.event_command(
      '36000000-0000-4000-8000-000000000001',
      pg_temp.fingerprint('phase6-provider-event-1'),
      pg_temp.fingerprint('phase6-delivery-1'),
      pg_temp.fingerprint('phase6-tenant-a'),
      pg_temp.fingerprint('phase6-entity-a')
    ),
    'phase6-webhook-1-replay'
  ) ->> 'idempotent',
  'true',
  'duplicate webhook delivery hash inserts no second inbox row'
);

reset role;
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_webhook_events
    where delivery_hash = private.sha256_fingerprint_bytes_v1(
      pg_temp.fingerprint('phase6-delivery-1')
    )
  ),
  '1',
  'duplicate delivery is represented by one durable replay guard'
);

set local role integration_webhook_ingress_authority;
select is(
  public.record_integration_webhook_event_v1(
    pg_temp.event_command(
      '36000000-0000-4000-8000-000000000002',
      pg_temp.fingerprint('phase6-provider-event-unmapped'),
      pg_temp.fingerprint('phase6-delivery-unmapped'),
      pg_temp.fingerprint('phase6-tenant-a'),
      pg_temp.fingerprint('phase6-unknown-entity')
    ),
    'phase6-webhook-unmapped'
  ) ->> 'verificationState',
  'rejected',
  'webhook cannot claim a workspace when trusted mapping is absent'
);

reset role;
select ok(
  (
    select workspace_id is null
      and business_entity_id is null
      and connection_id is null
    from private.integration_webhook_events
    where id = '36000000-0000-4000-8000-000000000002'
  ),
  'rejected event persists no tenant scope from untrusted input'
);

set local role integration_webhook_ingress_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_integration_webhook_event_v1(
      pg_temp.event_command(
        '36000000-0000-4000-8000-000000000099',
        pg_temp.fingerprint('phase6-raw-event'),
        pg_temp.fingerprint('phase6-raw-delivery'),
        pg_temp.fingerprint('phase6-tenant-a'),
        pg_temp.fingerprint('phase6-entity-a')
      ) || jsonb_build_object(
        'rawBody', jsonb_build_object('amount', '100000.00')
      ),
      'phase6-webhook-raw'
    )$$,
    '22023'
  ),
  'raw provider webhook bodies are rejected by the minimized inbox contract'
);

reset role;
set local role integration_task_dispatch_authority;

select is(
  public.bind_integration_webhook_event_task_v1(
    pg_catalog.jsonb_build_object(
      'eventId', '36000000-0000-4000-8000-000000000001',
      'task', pg_temp.task_command(
        '16000000-0000-4000-8000-000000000008',
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000008',
        'phase6-webhook-task-1', 'webhook_targeted_read',
        'provider_interactive', null,
        '36000000-0000-4000-8000-000000000001'
      )
    ),
    'phase6-webhook-bind-1',
    'phase6-dispatcher'
  ) ->> 'processingState',
  'coalesced',
  'verified event creates one trusted-scope targeted-read task'
);

reset role;
set local role integration_webhook_ingress_authority;

select is(
  public.record_integration_webhook_event_v1(
    pg_temp.event_command(
      '36000000-0000-4000-8000-000000000003',
      pg_temp.fingerprint('phase6-provider-event-1'),
      pg_temp.fingerprint('phase6-delivery-2'),
      pg_temp.fingerprint('phase6-tenant-a'),
      pg_temp.fingerprint('phase6-entity-a')
    ),
    'phase6-webhook-replay-new-delivery'
  ) ->> 'processingState',
  'pending',
  'new delivery of the same provider event is retained as replay metadata'
);

reset role;
set local role integration_task_dispatch_authority;

select is(
  public.bind_integration_webhook_event_task_v1(
    pg_catalog.jsonb_build_object(
      'eventId', '36000000-0000-4000-8000-000000000003',
      'task', pg_temp.task_command(
        '16000000-0000-4000-8000-000000000009',
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000009',
        'phase6-webhook-task-replay', 'webhook_targeted_read',
        'provider_interactive', null,
        '36000000-0000-4000-8000-000000000003'
      )
    ),
    'phase6-webhook-bind-replay',
    'phase6-dispatcher'
  ) ->> 'taskId',
  '16000000-0000-4000-8000-000000000008',
  'provider event replay coalesces onto the original durable task'
);

reset role;
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where task_kind = 'webhook_targeted_read'
  ),
  '1',
  'replayed provider event creates no duplicate targeted-read task'
);

set local role integration_task_dispatch_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.bind_integration_webhook_event_task_v1(
      jsonb_build_object(
        'eventId', '36000000-0000-4000-8000-000000000001',
        'task', pg_temp.task_command(
          '16000000-0000-4000-8000-000000000010',
          'b6000000-0000-4000-8000-000000000002',
          'c6000000-0000-4000-8000-000000000002',
          'd6000000-0000-4000-8000-000000000002',
          'f6000000-0000-4000-8000-000000000002',
          'e6000000-0000-4000-8000-000000000002',
          '26000000-0000-4000-8000-000000000010',
          'phase6-webhook-cross-workspace', 'webhook_targeted_read',
          'provider_interactive', null,
          '36000000-0000-4000-8000-000000000001'
        )
      ),
      'phase6-webhook-cross-workspace',
      'phase6-dispatcher'
    )$$,
    '42501'
  ),
  'valid event ID cannot be copied into another workspace task'
);

reset role;

select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_webhook_events
      where id = '36000000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'webhook replay history cannot be deleted'
);

select ok(
  (
    select pg_catalog.octet_length(row_to_json(event)::text) < 8192
      and not row_to_json(event)::text ~* '(rawBody|access.?token|refresh.?token|customer.?financial)'
    from private.integration_webhook_events as event
    where event.id = '36000000-0000-4000-8000-000000000001'
  ),
  'webhook inbox retains only bounded hashes and minimized metadata'
);

set local role integration_provider_runtime_authority;

select is(
  public.transition_integration_runtime_circuit_v1(
    pg_catalog.jsonb_build_object(
      'id', '46000000-0000-4000-8000-000000000001',
      'circuitScope', 'provider_api',
      'circuitLevel', 'connection',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000002',
      'businessEntityId', 'c6000000-0000-4000-8000-000000000002',
      'connectionId', 'd6000000-0000-4000-8000-000000000002',
      'expectedRowVersion', 0,
      'targetState', 'closed',
      'reasonCode', 'phase6_initialized',
      'openSeconds', null
    ),
    'phase6-circuit-create',
    'phase6-provider-worker'
  ) ->> 'state',
  'closed',
  'connection circuit begins in deterministic closed state'
);

select is(
  public.transition_integration_runtime_circuit_v1(
    pg_catalog.jsonb_build_object(
      'id', '46000000-0000-4000-8000-000000000001',
      'circuitScope', 'provider_api',
      'circuitLevel', 'connection',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000002',
      'businessEntityId', 'c6000000-0000-4000-8000-000000000002',
      'connectionId', 'd6000000-0000-4000-8000-000000000002',
      'expectedRowVersion', 1,
      'targetState', 'open',
      'reasonCode', 'synthetic_failure_threshold',
      'openSeconds', 60
    ),
    'phase6-circuit-open',
    'phase6-provider-worker'
  ) ->> 'state',
  'open',
  'connection circuit opens with a bounded interval'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_runtime_circuit_v1(
      jsonb_build_object(
        'id', '46000000-0000-4000-8000-000000000001',
        'circuitScope', 'provider_api',
        'circuitLevel', 'connection',
        'providerKey', 'synthetic',
        'providerEnvironment', 'test',
        'workspaceId', 'b6000000-0000-4000-8000-000000000002',
        'businessEntityId', 'c6000000-0000-4000-8000-000000000002',
        'connectionId', 'd6000000-0000-4000-8000-000000000002',
        'expectedRowVersion', 1,
        'targetState', 'open',
        'reasonCode', 'stale_transition',
        'openSeconds', 60
      ),
      'phase6-circuit-stale',
      'phase6-provider-worker'
    )$$,
    '40001'
  ),
  'circuit transitions are CAS protected'
);

select is(
  public.acquire_integration_runtime_rate_permit_v1(
    pg_catalog.jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000001',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 0,
      'capacityMilli', 2000,
      'refillMilliPerSecond', 100,
      'costMilli', 1000,
      'maximumConcurrency', 4,
      'observedRetryAfterSeconds', null,
      'observationCategory', 'none',
      'policyVersion', 'synthetic_rate_policy_v1'
    ),
    'phase6-rate-1',
    'phase6-provider-worker'
  ) ->> 'allowed',
  'true',
  'first provider-neutral rate permit succeeds'
);

select is(
  public.acquire_integration_runtime_rate_permit_v1(
    pg_catalog.jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000001',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 0,
      'capacityMilli', 2000,
      'refillMilliPerSecond', 100,
      'costMilli', 1000,
      'maximumConcurrency', 4,
      'observedRetryAfterSeconds', null,
      'observationCategory', 'none',
      'policyVersion', 'synthetic_rate_policy_v1'
    ),
    'phase6-rate-1',
    'phase6-provider-worker'
  ) ->> 'idempotent',
  'true',
  'same rate-permit request cannot consume tokens twice'
);

select is(
  public.acquire_integration_runtime_rate_permit_v1(
    pg_catalog.jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000001',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 1,
      'capacityMilli', 2000,
      'refillMilliPerSecond', 100,
      'costMilli', 1000,
      'maximumConcurrency', 4,
      'observedRetryAfterSeconds', null,
      'observationCategory', 'none',
      'policyVersion', 'synthetic_rate_policy_v1'
    ),
    'phase6-rate-2',
    'phase6-provider-worker'
  ) ->> 'allowed',
  'true',
  'second token consumes remaining configured capacity'
);

select is(
  public.acquire_integration_runtime_rate_permit_v1(
    pg_catalog.jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000001',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 2,
      'capacityMilli', 2000,
      'refillMilliPerSecond', 100,
      'costMilli', 1000,
      'maximumConcurrency', 4,
      'observedRetryAfterSeconds', null,
      'observationCategory', 'none',
      'policyVersion', 'synthetic_rate_policy_v1'
    ),
    'phase6-rate-3',
    'phase6-provider-worker'
  ) ->> 'allowed',
  'false',
  'empty provider bucket applies backpressure without sleeping in DB'
);

select is(
  public.acquire_integration_runtime_rate_permit_v1(
    pg_catalog.jsonb_build_object(
      'id', '56000000-0000-4000-8000-000000000001',
      'providerKey', 'synthetic',
      'providerEnvironment', 'test',
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 3,
      'capacityMilli', 2000,
      'refillMilliPerSecond', 100,
      'costMilli', 1000,
      'maximumConcurrency', 4,
      'observedRetryAfterSeconds', 30,
      'observationCategory', 'rate_limit',
      'policyVersion', 'synthetic_rate_policy_v1'
    ),
    'phase6-rate-limited',
    'phase6-provider-worker'
  ) ->> 'adaptiveConcurrency',
  '2',
  'Retry-After observation adaptively reduces provider concurrency'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.acquire_integration_runtime_rate_permit_v1(
      jsonb_build_object(
        'id', '56000000-0000-4000-8000-000000000001',
        'providerKey', 'synthetic',
        'providerEnvironment', 'test',
        'workspaceId', 'b6000000-0000-4000-8000-000000000002',
        'connectionId', 'd6000000-0000-4000-8000-000000000001',
        'expectedRowVersion', 4,
        'capacityMilli', 2000,
        'refillMilliPerSecond', 100,
        'costMilli', 1000,
        'maximumConcurrency', 4,
        'observedRetryAfterSeconds', null,
        'observationCategory', 'none',
        'policyVersion', 'synthetic_rate_policy_v1'
      ),
      'phase6-rate-cross-workspace',
      'phase6-provider-worker'
    )$$,
    '42501'
  ),
  'rate-limit state cannot be rebound across workspaces'
);

reset role;

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.acquire_integration_runtime_rate_permit_v1('{}'::jsonb, 'forged', 'service-role')$$,
    '42501'
  ),
  'service_role cannot acquire provider rate authority'
);
reset role;

set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1('{}'::jsonb, 'forged', 'browser')$$,
    '42501'
  ),
  'authenticated browser clients cannot create runtime tasks'
);
reset role;

set local role integration_task_dispatch_authority;

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000001',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001',
      'phase6-task-1'
    ),
    'phase6-task-1-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'dispatch authority creates the durable DB record before Cloud Tasks'
);

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000001',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000001',
      'phase6-task-1'
    ),
    'phase6-task-1-create',
    'phase6-dispatcher'
  ) ->> 'idempotent',
  'true',
  'same logical task creation replays idempotently'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000099',
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000099',
        'phase6-task-1'
      ),
      'phase6-task-conflict',
      'phase6-dispatcher'
    )$$,
    '23505'
  ),
  'same idempotency fingerprint cannot name different work'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000098',
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000098',
        'phase6-malformed'
      ) || jsonb_build_object('providerPayload', jsonb_build_object('amount', 100)),
      'phase6-malformed',
      'phase6-dispatcher'
    )$$,
    '22023'
  ),
  'raw provider financial payload cannot enter the task ledger'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      jsonb_set(
        pg_temp.task_command(
          '16000000-0000-4000-8000-000000000097',
          'b6000000-0000-4000-8000-000000000001',
          'c6000000-0000-4000-8000-000000000001',
          'd6000000-0000-4000-8000-000000000001',
          'f6000000-0000-4000-8000-000000000001',
          'e6000000-0000-4000-8000-000000000001',
          '26000000-0000-4000-8000-000000000097',
          'phase6-malformed-window'
        ),
        '{controlMetadata,windowStartAt}',
        '"not-a-timestamp"'::jsonb
      ),
      'phase6-malformed-window',
      'phase6-dispatcher'
    )$$,
    '22023'
  ),
  'malformed bounded control metadata fails before persistence'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      jsonb_set(
        pg_temp.task_command(
          '16000000-0000-4000-8000-000000000096',
          'b6000000-0000-4000-8000-000000000001',
          'c6000000-0000-4000-8000-000000000001',
          'd6000000-0000-4000-8000-000000000001',
          'f6000000-0000-4000-8000-000000000001',
          'e6000000-0000-4000-8000-000000000001',
          '26000000-0000-4000-8000-000000000096',
          'phase6-stale-generation'
        ),
        '{connectionGeneration}',
        '2'::jsonb
      ),
      'phase6-stale-generation',
      'phase6-dispatcher'
    )$$,
    '42501'
  ),
  'stale connection generation cannot create work'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000095',
        'b6000000-0000-4000-8000-000000000002',
        'c6000000-0000-4000-8000-000000000002',
        'd6000000-0000-4000-8000-000000000001',
        'f6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000001',
        '26000000-0000-4000-8000-000000000095',
        'phase6-cross-workspace'
      ),
      'phase6-cross-workspace',
      'phase6-dispatcher'
    )$$,
    '42501'
  ),
  'a copied connection ID cannot cross workspace or Business Entity scope'
);

select is(
  public.mark_integration_sync_task_dispatched_v1(
    pg_temp.dispatch_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 1,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ),
    'phase6-task-1-dispatch',
    'phase6-dispatcher'
  ) ->> 'state',
  'dispatched',
  'dispatcher persists the exact Cloud Task reference'
);

select is(
  public.mark_integration_sync_task_dispatched_v1(
    pg_temp.dispatch_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 1,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ),
    'phase6-task-1-dispatch',
    'phase6-dispatcher'
  ) ->> 'idempotent',
  'true',
  'duplicate dispatcher acknowledgement is idempotent'
);

reset role;

set local role integration_deterministic_runtime_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.lease_command(
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        '16000000-0000-4000-8000-000000000001', 2,
        'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '66000000-0000-4000-8000-000000000001', 'wrong-worker', 0,
        'deterministic_runtime'
      ),
      'phase6-wrong-worker',
      'phase6-deterministic-worker'
    )$$,
    '42501'
  ),
  'deterministic runtime cannot lease provider work'
);
reset role;

set local role integration_provider_runtime_authority;
select is(
  public.lease_integration_sync_task_v1(
    pg_temp.lease_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 2,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '66000000-0000-4000-8000-000000000001', 'provider-worker-a', 0
    ),
    'phase6-task-1-lease',
    'phase6-provider-worker'
  ) ->> 'acquired',
  'true',
  'provider runtime atomically leases provider work'
);

select is(
  public.lease_integration_sync_task_v1(
    pg_temp.lease_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 2,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '66000000-0000-4000-8000-000000000099', 'replayed-worker', 0
    ),
    'phase6-task-1-replayed-delivery',
    'phase6-provider-worker'
  ) ->> 'acquired',
  'false',
  'duplicate Cloud Task delivery cannot acquire a second lease'
);

select ok(
  (
    select not (contention.result ->> 'acquired')::boolean
      and not (contention.result ->> 'idempotent')::boolean
      and not (contention.result ->> 'terminalReplay')::boolean
      and contention.result ->> 'reasonCode' = 'lease_held'
      and contention.result ->> 'state' = 'leased'
      and (contention.result ->> 'attemptCount')::integer = 1
    from (
      select public.lease_integration_sync_task_v1(
        pg_temp.lease_command(
          'b6000000-0000-4000-8000-000000000001',
          'c6000000-0000-4000-8000-000000000001',
          'd6000000-0000-4000-8000-000000000001',
          '16000000-0000-4000-8000-000000000001', 3,
          'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '66000000-0000-4000-8000-000000000098',
          'later-delivery-worker', 0, 'provider_runtime', 1, 1
        ),
        'phase6-task-1-active-lease-contention',
        'phase6-provider-worker'
      ) as result
    ) as contention
  ),
  'a genuinely later tuple remains bounded by distinguishable active-lease contention'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.heartbeat_integration_sync_task_v1(
      jsonb_build_object(
        'workspaceId', 'b6000000-0000-4000-8000-000000000001',
        'businessEntityId', 'c6000000-0000-4000-8000-000000000001',
        'connectionId', 'd6000000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '16000000-0000-4000-8000-000000000001',
        'expectedRowVersion', 3,
        'leaseId', '66000000-0000-4000-8000-000000000001',
        'leaseOwnerFingerprint', pg_temp.fingerprint('copied-owner'),
        'extendSeconds', 120
      ),
      'phase6-bad-heartbeat',
      'phase6-provider-worker'
    )$$,
    '40001'
  ),
  'copied task and lease IDs cannot impersonate the worker'
);

select is(
  public.heartbeat_integration_sync_task_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'businessEntityId', 'c6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', '16000000-0000-4000-8000-000000000001',
      'expectedRowVersion', 3,
      'leaseId', '66000000-0000-4000-8000-000000000001',
      'leaseOwnerFingerprint', pg_temp.fingerprint('provider-worker-a'),
      'extendSeconds', 120
    ),
    'phase6-task-1-heartbeat',
    'phase6-provider-worker'
  ) ->> 'state',
  'leased',
  'lease owner can heartbeat using database time'
);

select is(
  public.complete_integration_sync_task_v1(
    pg_temp.complete_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 4,
      '66000000-0000-4000-8000-000000000001', 'provider-worker-a',
      'phase6-durable-effect-1',
      '26000000-0000-4000-8000-000000000001', 0, 1
    ),
    'phase6-task-1-complete',
    'phase6-provider-worker'
  ) ->> 'state',
  'succeeded',
  'source commit, checkpoint, and task completion commit atomically'
);

select is(
  public.complete_integration_sync_task_v1(
    pg_temp.complete_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000001', 4,
      '66000000-0000-4000-8000-000000000001', 'provider-worker-a',
      'phase6-durable-effect-1',
      '26000000-0000-4000-8000-000000000001', 0, 1
    ),
    'phase6-task-1-timeout-replay',
    'phase6-provider-worker'
  ) ->> 'idempotent',
  'true',
  'handler timeout after commit replays without duplicate effect'
);

reset role;

select is(
  (
    select checkpoint_version::text
    from private.integration_sync_checkpoints
    where id = '26000000-0000-4000-8000-000000000001'
  ),
  '1',
  'provider checkpoint advances exactly once'
);

select ok(
  (
    select checkpoint.downstream_commit_fingerprint = task.durable_effect_fingerprint
    from private.integration_sync_checkpoints as checkpoint
    join private.integration_sync_tasks as task on task.id = checkpoint.last_task_id
    where checkpoint.id = '26000000-0000-4000-8000-000000000001'
  ),
  'checkpoint is cryptographically bound to accepted downstream state'
);

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_tasks
      set state = 'pending', row_version = row_version + 1
      where id = '16000000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'succeeded task history is immutable'
);

select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_tasks
      where id = '16000000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'task rows cannot be deleted'
);

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_checkpoints
      set cursor_version = cursor_version + 1
      where id = '26000000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'checkpoint CAS cannot be bypassed by direct mutation'
);

select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_checkpoints
      where id = '26000000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'checkpoint history cannot be deleted'
);

set local role integration_task_dispatch_authority;

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000002',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000002',
      'phase6-retry-task', 'retry_recovery', 'provider_interactive',
      null, null, 2
    ),
    'phase6-retry-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'retry fixture starts pending'
);

select is(
  public.mark_integration_sync_task_dispatched_v1(
    pg_temp.dispatch_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 1,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    ),
    'phase6-retry-dispatch-1',
    'phase6-dispatcher'
  ) ->> 'state',
  'dispatched',
  'retry fixture is dispatched'
);

reset role;
set local role integration_provider_runtime_authority;

select is(
  public.lease_integration_sync_task_v1(
    pg_temp.lease_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 2,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '66000000-0000-4000-8000-000000000002', 'retry-worker-1', 0
    ),
    'phase6-retry-lease-1',
    'phase6-provider-worker'
  ) ->> 'acquired',
  'true',
  'first retry attempt acquires one lease'
);

select is(
  public.fail_integration_sync_task_v1(
    pg_temp.fail_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 3,
      '66000000-0000-4000-8000-000000000002', 'retry-worker-1', true
    ),
    'phase6-retry-fail-1',
    'phase6-provider-worker'
  ) ->> 'state',
  'retry_wait',
  'retryable failure enters bounded retry_wait'
);

select is(
  public.fail_integration_sync_task_v1(
    pg_temp.fail_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 3,
      '66000000-0000-4000-8000-000000000002', 'retry-worker-1', true
    ),
    'phase6-retry-fail-1',
    'phase6-provider-worker'
  ) ->> 'idempotent',
  'true',
  'failure acknowledgement replay does not amplify retries'
);

reset role;

update private.integration_sync_tasks
set
  available_at = pg_catalog.transaction_timestamp(),
  row_version = row_version + 1,
  updated_at = pg_catalog.transaction_timestamp()
where id = '16000000-0000-4000-8000-000000000002';

set local role integration_task_scheduler_authority;
select is(
  public.sweep_integration_sync_tasks_v1(
    100,
    'phase6-retry-sweep',
    'phase6-sweeper'
  ) ->> 'recoveredTaskCount',
  '1',
  'sweeper recovers due retry work idempotently'
);

reset role;
select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '16000000-0000-4000-8000-000000000002'
  ),
  'pending',
  'sweeper returns due retry to pending'
);

set local role integration_task_dispatch_authority;
select is(
  public.mark_integration_sync_task_dispatched_v1(
    pg_temp.dispatch_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 6,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    ),
    'phase6-retry-dispatch-2',
    'phase6-dispatcher'
  ) ->> 'state',
  'dispatched',
  'recovered work can be redispatched'
);

reset role;
set local role integration_provider_runtime_authority;

select is(
  public.lease_integration_sync_task_v1(
    pg_temp.lease_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 7,
      'projects/phase6-test/locations/us-central1/queues/provider-interactive/tasks/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '66000000-0000-4000-8000-000000000003', 'retry-worker-2', 0,
      'provider_runtime', 0, 2
    ),
    'phase6-retry-lease-2',
    'phase6-provider-worker'
  ) ->> 'acquired',
  'true',
  'second bounded retry acquires one lease'
);

select is(
  public.fail_integration_sync_task_v1(
    pg_temp.fail_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000002', 8,
      '66000000-0000-4000-8000-000000000003', 'retry-worker-2', true
    ),
    'phase6-retry-fail-2',
    'phase6-provider-worker'
  ) ->> 'state',
  'dead_letter',
  'maximum attempts end in dead letter'
);

reset role;

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_tasks
      set state = 'pending', row_version = row_version + 1
      where id = '16000000-0000-4000-8000-000000000002'$$,
    '55000'
  ),
  'dead-letter task is immutable'
);

set local role integration_task_dispatch_authority;

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000003',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000003',
      'phase6-cancel-task', 'manual_sync'
    ),
    'phase6-cancel-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'cancellation fixture is created'
);

select is(
  public.cancel_integration_sync_task_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'b6000000-0000-4000-8000-000000000001',
      'businessEntityId', 'c6000000-0000-4000-8000-000000000001',
      'connectionId', 'd6000000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', '16000000-0000-4000-8000-000000000003',
      'expectedRowVersion', 1
    ),
    'phase6-cancel',
    'phase6-dispatcher'
  ) ->> 'state',
  'cancelled',
  'pending work can be cancelled without worker execution'
);

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000004',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000004',
      'phase6-parent-task'
    ),
    'phase6-parent-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'parent task is durable'
);

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000005',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000005',
      'phase6-child-task', 'incremental', 'provider_bulk',
      '16000000-0000-4000-8000-000000000004'
    ),
    'phase6-child-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'continuation child is bound to its parent and sync run'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_task_v1(
      pg_temp.task_command(
        '16000000-0000-4000-8000-000000000006',
        'b6000000-0000-4000-8000-000000000002',
        'c6000000-0000-4000-8000-000000000002',
        'd6000000-0000-4000-8000-000000000002',
        'f6000000-0000-4000-8000-000000000002',
        'e6000000-0000-4000-8000-000000000002',
        '26000000-0000-4000-8000-000000000006',
        'phase6-cross-parent', 'incremental', 'provider_bulk',
        '16000000-0000-4000-8000-000000000004'
      ),
      'phase6-cross-parent',
      'phase6-dispatcher'
    )$$,
    '42501'
  ),
  'parent task identity cannot cross workspace scope'
);

select is(
  public.create_integration_sync_task_v1(
    pg_temp.task_command(
      '16000000-0000-4000-8000-000000000007',
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      'f6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000001',
      null,
      'phase6-deterministic-task', 'deterministic_shadow',
      'deterministic_intelligence'
    ),
    'phase6-deterministic-create',
    'phase6-dispatcher'
  ) ->> 'state',
  'pending',
  'deterministic shadow work uses its separate queue class'
);

select is(
  public.mark_integration_sync_task_dispatched_v1(
    pg_temp.dispatch_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000007', 1,
      'projects/phase6-test/locations/us-central1/queues/deterministic-intelligence/tasks/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    ),
    'phase6-deterministic-dispatch',
    'phase6-dispatcher'
  ) ->> 'state',
  'dispatched',
  'deterministic work is dispatched through the common opaque protocol'
);

reset role;
set local role integration_provider_runtime_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.lease_command(
        'b6000000-0000-4000-8000-000000000001',
        'c6000000-0000-4000-8000-000000000001',
        'd6000000-0000-4000-8000-000000000001',
        '16000000-0000-4000-8000-000000000007', 2,
        'projects/phase6-test/locations/us-central1/queues/deterministic-intelligence/tasks/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '66000000-0000-4000-8000-000000000007', 'provider-cannot-det', 0,
        'provider_runtime'
      ),
      'phase6-provider-cannot-det',
      'phase6-provider-worker'
    )$$,
    '42501'
  ),
  'provider runtime cannot lease deterministic work'
);

reset role;
set local role integration_deterministic_runtime_authority;
select is(
  public.lease_integration_sync_task_v1(
    pg_temp.lease_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000007', 2,
      'projects/phase6-test/locations/us-central1/queues/deterministic-intelligence/tasks/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '66000000-0000-4000-8000-000000000007', 'deterministic-worker', 0,
      'deterministic_runtime'
    ),
    'phase6-deterministic-lease',
    'phase6-deterministic-worker'
  ) ->> 'acquired',
  'true',
  'deterministic authority leases only deterministic work'
);

select is(
  public.complete_integration_sync_task_v1(
    pg_temp.complete_command(
      'b6000000-0000-4000-8000-000000000001',
      'c6000000-0000-4000-8000-000000000001',
      'd6000000-0000-4000-8000-000000000001',
      '16000000-0000-4000-8000-000000000007', 3,
      '66000000-0000-4000-8000-000000000007', 'deterministic-worker',
      'phase6-deterministic-effect', null, 0, 1
    ),
    'phase6-deterministic-complete',
    'phase6-deterministic-worker'
  ) ->> 'state',
  'succeeded',
  'deterministic task completes without provider checkpoint authority'
);

reset role;

set local role integration_task_scheduler_authority;
select ok(
  pg_catalog.jsonb_array_length(
    public.discover_integration_sync_due_work_v1(
      pg_catalog.transaction_timestamp(),
      100
    )
  ) >= 1,
  'Scheduler-facing due-work discovery finds provider checkpoints without doing sync work'
);
reset role;

select ok(
  exists (
    select 1
    from private.integration_audit_events
    where action = 'integration_sync_task.complete'
      and target_id = '16000000-0000-4000-8000-000000000001'
  )
    and exists (
      select 1
      from private.integration_audit_events
      where action = 'integration_sync_task.recover'
    )
    and exists (
      select 1
      from private.integration_audit_events
      where action = 'integration_runtime_circuit.transition'
    ),
  'task completion, recovery, and circuit transitions are auditable'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks
    where durable_effect_fingerprint = private.sha256_fingerprint_bytes_v1(
      pg_temp.fingerprint('phase6-durable-effect-1')
    )
  ),
  1,
  'one logical source-page effect exists after completion replay'
);

select * from finish();
rollback;
