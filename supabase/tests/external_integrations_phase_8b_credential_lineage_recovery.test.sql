begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

grant usage on schema extensions to integration_credential_broker_authority;

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

create or replace function pg_temp.lineage_recovery_command(
  p_task_id uuid,
  p_task_row_version bigint,
  p_failure_audit_id uuid,
  p_credential_read_audit_id uuid,
  p_historical_credential_id uuid,
  p_historical_credential_version bigint,
  p_current_credential_id uuid,
  p_current_credential_version bigint,
  p_current_credential_row_version bigint,
  p_connection_id uuid,
  p_mapping_id uuid,
  p_workspace_id uuid default 'b9d00000-0000-4000-8000-000000000001',
  p_business_entity_id uuid default 'd9d00000-0000-4000-8000-000000000001',
  p_connection_generation bigint default 1
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion',
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v2',
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', p_connection_generation,
    'mappingId', p_mapping_id,
    'expectedMappingRowVersion', 1,
    'historicalCredentialId', p_historical_credential_id,
    'expectedHistoricalCredentialVersion', p_historical_credential_version,
    'currentCredentialId', p_current_credential_id,
    'expectedCurrentCredentialVersion', p_current_credential_version,
    'expectedCurrentCredentialRowVersion', p_current_credential_row_version,
    'taskId', p_task_id,
    'expectedTaskRowVersion', p_task_row_version,
    'expectedDispatchGeneration', 2,
    'failureAuditEventId', p_failure_audit_id,
    'credentialReadAuditEventId', p_credential_read_audit_id,
    'diagnosticClass', 'expires_at_binding',
    'externalEvidenceFingerprint',
      'sha256:abababababababababababababababababababababababababababababababab',
    'retryAfterSeconds', 1
  );
$function$;

create or replace function pg_temp.create_root_scope_fixture(
  p_connection_id uuid,
  p_mapping_id uuid,
  p_oauth_state_id uuid,
  p_credential_id uuid,
  p_sync_run_id uuid,
  p_credential_version bigint,
  p_historical_credential_version bigint,
  p_credential_row_version bigint,
  p_realm_key text,
  p_seed text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_created_at timestamptz := pg_catalog.transaction_timestamp() - interval '2 hours';
  v_updated_at timestamptz := case
    when p_credential_version > p_historical_credential_version
      then pg_catalog.transaction_timestamp() - interval '1 minute'
    else pg_catalog.transaction_timestamp() - interval '40 minutes'
  end;
  v_version bigint;
begin
  insert into private.integration_connections (
    id, contract_version, control_contract_version, workspace_id,
    business_entity_id, connection_series_id, connection_generation,
    provider_key, provider_environment, provider_tenant_reference_fingerprint,
    status, state_reason_code, requested_scopes, granted_scopes,
    safe_display_name, provider_descriptor_registry_version,
    provider_descriptor_registry_fingerprint, provider_descriptor_fingerprint,
    adapter_version, capability_snapshot, configuration_version, authorized_at,
    status_changed_at, row_version, created_by, created_at, updated_at
  ) values (
    p_connection_id,
    'integration_connection_v1',
    'integration_connection_control_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    1,
    'quickbooks_online',
    'sandbox',
    private.qbo_phase_8b_realm_fingerprint_v1(p_realm_key),
    'initializing',
    'initial_sync_pending',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    p_seed,
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
    pg_catalog.jsonb_build_object(
      'operations', pg_catalog.jsonb_build_array(
        'get_capabilities', 'get_source_record', 'list_entities',
        'list_source_records'
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
    ),
    1,
    v_created_at,
    v_created_at,
    3,
    'a9d00000-0000-4000-8000-000000000001',
    v_created_at,
    v_created_at
  );

  insert into private.provider_entity_mappings (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    mapping_series_id, mapping_version, provider_key, provider_environment,
    provider_entity_type, provider_entity_reference_fingerprint,
    safe_display_name, mapping_role, status, verification_mode,
    verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
    created_at, updated_at
  ) values (
    p_mapping_id,
    'provider_entity_mapping_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    p_mapping_id,
    1,
    'quickbooks_online',
    'sandbox',
    'company',
    private.qbo_phase_8b_realm_fingerprint_v1(p_realm_key),
    p_seed,
    'primary',
    'active',
    'qbo_realm_mapping_v1',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-mapping', 'UTF8'),
      'sha256'
    ),
    v_created_at,
    'a9d00000-0000-4000-8000-000000000001',
    v_created_at,
    1,
    v_created_at,
    v_created_at
  );

  insert into private.integration_oauth_states (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment, initiated_by,
    requested_scopes, return_intent, state_hash, status,
    creation_request_id, creation_request_fingerprint, consume_request_id,
    consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
  ) values (
    p_oauth_state_id,
    'integration_oauth_state_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    1,
    'quickbooks_online',
    'sandbox',
    'a9d00000-0000-4000-8000-000000000001',
    array['com.intuit.quickbooks.accounting']::text[],
    '/phase8b/sandbox/authorized',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-state', 'UTF8'),
      'sha256'
    ),
    'consumed',
    p_seed || '_oauth_create',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-oauth-create', 'UTF8'),
      'sha256'
    ),
    p_seed || '_oauth_consume',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-oauth-consume', 'UTF8'),
      'sha256'
    ),
    v_created_at,
    v_created_at + interval '10 minutes',
    v_created_at + interval '5 minutes',
    2
  );

  insert into private.integration_credentials (
    id, contract_version, oauth_state_id, workspace_id, business_entity_id,
    connection_id, connection_generation, provider_key, provider_environment,
    initiated_by, credential_version, envelope_schema_version,
    aad_schema_version, aad_digest, kms_key_resource, credential_ciphertext,
    access_expires_at, refresh_expires_at, granted_scopes,
    external_entity_reference_fingerprint, status, last_request_id,
    last_request_fingerprint, row_version, created_at, updated_at
  ) values (
    p_credential_id,
    'integration_credential_authority_v1',
    p_oauth_state_id,
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    1,
    'quickbooks_online',
    'sandbox',
    'a9d00000-0000-4000-8000-000000000001',
    p_credential_version,
    'oauth_credential_envelope_v1',
    'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'sandbox',
      'b9d00000-0000-4000-8000-000000000001',
      p_connection_id,
      1,
      'quickbooks_online',
      p_credential_id
    ),
    'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
    pg_catalog.convert_to(pg_catalog.repeat('l', 256), 'UTF8'),
    pg_catalog.transaction_timestamp() + interval '1 hour',
    pg_catalog.transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    private.qbo_phase_8b_realm_fingerprint_v1(p_realm_key),
    'active',
    p_seed || '_credential_store',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-credential-store', 'UTF8'),
      'sha256'
    ),
    p_credential_row_version,
    v_created_at,
    v_updated_at
  );

  for v_version in 2..p_credential_version loop
    insert into private.integration_audit_events (
      workspace_id, business_entity_id, connection_id, actor_type, actor_id,
      action, outcome, target_type, target_id, request_id, reason_code, metadata,
      occurred_at, retention_class
    ) values (
      'b9d00000-0000-4000-8000-000000000001',
      'd9d00000-0000-4000-8000-000000000001',
      p_connection_id,
      'service',
      'integration_credential_broker',
      'credential_rotated',
      'succeeded',
      'integration_credential',
      p_credential_id::text,
      p_seed || '_rotation_' || v_version::text,
      'refresh_succeeded',
      pg_catalog.jsonb_build_object(
        'connection_generation', 1,
        'connection_status', 'initializing',
        'credential_status', 'active',
        'credential_version', v_version,
        'lease_state', 'released',
        'idempotent', false
      ),
      case
        when v_version > p_historical_credential_version then
          pg_catalog.transaction_timestamp() - interval '5 minutes'
            + pg_catalog.make_interval(
              secs => (v_version - p_historical_credential_version)::integer
            )
        else
          v_created_at
            + pg_catalog.make_interval(mins => v_version::integer * 10)
      end,
      'security'
    );
  end loop;

  insert into private.integration_sync_runs (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    mapping_id, connection_generation, trigger_kind, mode, state,
    idempotency_fingerprint, provider_contract_version, adapter_version,
    policy_version, records_observed, records_accepted, records_rejected,
    facts_accepted, contributions_changed, created_at, started_at,
    row_version, updated_at
  ) values (
    p_sync_run_id,
    'integration_sync_run_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    p_mapping_id,
    1,
    'provider_initialization',
    'initialization',
    'running',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-run', 'UTF8'),
      'sha256'
    ),
    'provider_adapter_v1',
    'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1',
    0, 0, 0, 0, 0,
    v_created_at,
    v_created_at,
    2,
    v_created_at
  );
end;
$function$;

create or replace function pg_temp.create_failed_task_fixture(
  p_task_id uuid,
  p_connection_id uuid,
  p_mapping_id uuid,
  p_sync_run_id uuid,
  p_credential_id uuid,
  p_historical_credential_version bigint,
  p_recovery_event_id uuid,
  p_lease_audit_event_id uuid,
  p_failure_audit_event_id uuid,
  p_read_audit_event_id uuid,
  p_seed text,
  p_read_task_id uuid default null,
  p_completed_minutes_ago integer default 10
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed_at timestamptz := pg_catalog.transaction_timestamp()
    - pg_catalog.make_interval(mins => p_completed_minutes_ago);
begin
  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, provider_key, provider_environment,
    queue_class, task_kind, stream_key, state, priority, control_metadata,
    idempotency_fingerprint, coalescing_fingerprint, dispatcher_task_name,
    dispatch_generation, delivery_attribution_state,
    last_delivery_dispatch_generation, last_delivery_retry_count,
    last_delivery_execution_count, last_delivery_attempt_fingerprint,
    attempt_count, maximum_attempts, available_at, failure_category,
    failure_code, durable_effect_fingerprint, last_request_id,
    last_request_fingerprint, row_version, created_at, updated_at, completed_at,
    retention_expires_at
  ) values (
    p_task_id,
    'integration_sync_task_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    1,
    p_sync_run_id,
    'quickbooks_online',
    'sandbox',
    'provider_interactive',
    'initial_historical',
    'company_info',
    'failed',
    90,
    pg_catalog.jsonb_build_object(
      'checkpointId', null,
      'mappingId', p_mapping_id,
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', p_seed,
      'recordHintCount', 0,
      'coalescedEventCount', 1
    ),
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-idempotency', 'UTF8'),
      'sha256'
    ),
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-coalescing', 'UTF8'),
      'sha256'
    ),
    null,
    2,
    'attributed',
    2,
    0,
    0,
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-delivery', 'UTF8'),
      'sha256'
    ),
    2,
    3,
    v_completed_at - interval '10 minutes',
    'contract',
    'phase8b_provider_task_failed',
    null,
    p_seed || '_failure',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-failure', 'UTF8'),
      'sha256'
    ),
    9,
    pg_catalog.transaction_timestamp() - interval '2 hours',
    v_completed_at,
    v_completed_at,
    pg_catalog.transaction_timestamp() + interval '7 days'
  );

  insert into private.integration_sync_task_recovery_events (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, credential_id, credential_version, task_id,
    recovery_generation, prior_state, prior_failure_category,
    prior_failure_code, prior_row_version, prior_completed_at,
    retry_after_seconds, request_id, request_fingerprint, actor_id,
    recovered_at, created_at
  ) values (
    p_recovery_event_id,
    'qbo_sandbox_expired_credential_recovery_v1',
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    1,
    p_credential_id,
    p_historical_credential_version,
    p_task_id,
    1,
    'failed',
    'contract',
    'phase8b_provider_task_failed',
    4,
    v_completed_at - interval '25 minutes',
    30,
    p_seed || '_expired_recovery',
    extensions.digest(
      pg_catalog.convert_to(p_seed || '-expired-recovery', 'UTF8'),
      'sha256'
    ),
    'phase8b_credential_recovery',
    v_completed_at - interval '20 minutes',
    v_completed_at - interval '20 minutes'
  );

  insert into private.integration_audit_events (
    id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
    action, outcome, target_type, target_id, request_id, reason_code, metadata,
    occurred_at, retention_class
  ) values
  (
    p_lease_audit_event_id,
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    'service',
    'phase8b_provider_runtime',
    'integration_sync_task.lease',
    'succeeded',
    'integration_sync_task',
    p_task_id::text,
    p_seed || '_lease',
    null,
    pg_catalog.jsonb_build_object(
      'task_state', 'leased',
      'task_kind', 'initial_historical',
      'queue_class', 'provider_interactive',
      'attempt_count', 2,
      'dispatch_generation', 2,
      'row_version', 8,
      'idempotent', false
    ),
    v_completed_at - interval '2 seconds',
    'operational'
  ),
  (
    p_failure_audit_event_id,
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    'service',
    'phase8b_provider_runtime',
    'integration_sync_task.fail',
    'failed',
    'integration_sync_task',
    p_task_id::text,
    p_seed || '_failure',
    null,
    pg_catalog.jsonb_build_object(
      'task_state', 'failed',
      'task_kind', 'initial_historical',
      'queue_class', 'provider_interactive',
      'attempt_count', 2,
      'dispatch_generation', 2,
      'row_version', 9,
      'idempotent', false
    ),
    v_completed_at,
    'operational'
  ),
  (
    p_read_audit_event_id,
    'b9d00000-0000-4000-8000-000000000001',
    'd9d00000-0000-4000-8000-000000000001',
    p_connection_id,
    'service',
    'integration_credential_broker',
    'credential_provider_read',
    'allowed',
    'integration_credential',
    p_credential_id::text,
    p_seed || '_credential_read',
    'authorized',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'connection_generation', 1,
      'credential_status', 'active',
      'credential_version', p_historical_credential_version,
      'task_state', 'leased',
      'task_id', p_read_task_id
    )),
    v_completed_at - interval '1 second',
    'security'
  );
end;
$function$;

insert into public.profiles (id, email, full_name) values (
  'a9d00000-0000-4000-8000-000000000001',
  'phase8b-credential-lineage@example.test',
  'Phase 8B Credential Lineage'
);
insert into public.workspaces (id, name, created_by) values (
  'b9d00000-0000-4000-8000-000000000001',
  'Phase 8B Credential Lineage',
  'a9d00000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c9d00000-0000-4000-8000-000000000001',
  'b9d00000-0000-4000-8000-000000000001',
  'a9d00000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd9d00000-0000-4000-8000-000000000001',
  'b9d00000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_credential_lineage',
  'operating_company',
  'Phase 8B Credential Lineage',
  'USD',
  'UTC',
  1,
  'active',
  'a9d00000-0000-4000-8000-000000000001',
  'a9d00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

select pg_temp.create_root_scope_fixture(
  'e9d00000-0000-4000-8000-000000000001',
  'f9d00000-0000-4000-8000-000000000001',
  '19d00000-0000-4000-8000-000000000001',
  '79d00000-0000-4000-8000-000000000001',
  '29d00000-0000-4000-8000-000000000001',
  6, 5, 7, 'phase8b-lineage-main', 'phase8b_lineage_main'
);
select pg_temp.create_root_scope_fixture(
  'e9d00000-0000-4000-8000-000000000002',
  'f9d00000-0000-4000-8000-000000000002',
  '19d00000-0000-4000-8000-000000000002',
  '79d00000-0000-4000-8000-000000000002',
  '29d00000-0000-4000-8000-000000000002',
  5, 5, 6, 'phase8b-lineage-same', 'phase8b_lineage_same'
);
select pg_temp.create_root_scope_fixture(
  'e9d00000-0000-4000-8000-000000000003',
  'f9d00000-0000-4000-8000-000000000003',
  '19d00000-0000-4000-8000-000000000003',
  '79d00000-0000-4000-8000-000000000003',
  '29d00000-0000-4000-8000-000000000003',
  5, 5, 6, 'phase8b-lineage-reauth', 'phase8b_lineage_reauth'
);
select pg_temp.create_root_scope_fixture(
  'e9d00000-0000-4000-8000-000000000004',
  'f9d00000-0000-4000-8000-000000000004',
  '19d00000-0000-4000-8000-000000000004',
  '79d00000-0000-4000-8000-000000000004',
  '29d00000-0000-4000-8000-000000000004',
  6, 5, 7, 'phase8b-lineage-race', 'phase8b_lineage_race'
);

insert into private.integration_workspace_policies (
  id, contract_version, workspace_id, provider_key, provider_environment,
  state, sync_enabled, history_horizon_days, maximum_concurrency,
  freshness_policy_version, retention_policy_version, row_version,
  last_request_id, last_request_fingerprint, created_at, updated_at
) values (
  '09d00000-0000-4000-8000-000000000001',
  'integration_workspace_policy_v1',
  'b9d00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'enabled',
  true,
  400,
  2,
  'qbo_control_plane_freshness_policy_v1',
  'qbo_metadata_retention_v1',
  1,
  'phase8b_lineage_workspace_policy',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-workspace-policy', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

-- Convert scope three into a completed reauthorization replacement. The old
-- row remains the historical incident credential, while the child is active.
insert into private.integration_reauthorization_states (
  id, contract_version, authorization_purpose, reason_code,
  reauthorization_path, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, redirect_uri, return_intent, state_hash,
  expected_connection_row_version, superseded_credential_id,
  superseded_credential_version, expected_credential_row_version, mapping_id,
  expected_mapping_row_version, provider_entity_reference_fingerprint,
  prior_mapping_verification_fingerprint, recovery_evidence_count, status,
  creation_request_id, creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
) values (
  '89d00000-0000-4000-8000-000000000003',
  'integration_reauthorization_state_v1',
  'reauthorization',
  'expired_credential_recovery',
  'initializing_same_generation',
  'b9d00000-0000-4000-8000-000000000001',
  'd9d00000-0000-4000-8000-000000000001',
  'e9d00000-0000-4000-8000-000000000003',
  1,
  'quickbooks_online',
  'sandbox',
  'a9d00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback',
  '/phase8b/sandbox/reauthorized',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-state', 'UTF8'),
    'sha256'
  ),
  3,
  '79d00000-0000-4000-8000-000000000003',
  5,
  6,
  'f9d00000-0000-4000-8000-000000000003',
  1,
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-lineage-reauth'),
  extensions.digest(
    pg_catalog.convert_to('phase8b_lineage_reauth-mapping', 'UTF8'),
    'sha256'
  ),
  1,
  'consumed',
  'phase8b_lineage_reauth_create',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-create', 'UTF8'),
    'sha256'
  ),
  'phase8b_lineage_reauth_consume',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-consume', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '8 minutes',
  pg_catalog.transaction_timestamp() + interval '2 minutes',
  pg_catalog.transaction_timestamp() - interval '7 minutes',
  2
);

update private.integration_credentials
set
  status = 'superseded',
  superseded_at = pg_catalog.transaction_timestamp() - interval '6 minutes',
  last_request_id = 'phase8b_lineage_reauth_supersede',
  last_request_fingerprint = extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-supersede', 'UTF8'),
    'sha256'
  ),
  row_version = row_version + 1,
  updated_at = pg_catalog.transaction_timestamp() - interval '6 minutes'
where id = '79d00000-0000-4000-8000-000000000003';

insert into private.integration_credentials (
  id, contract_version, oauth_state_id, reauthorization_state_id,
  supersedes_credential_id, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  credential_version, envelope_schema_version, aad_schema_version, aad_digest,
  kms_key_resource, credential_ciphertext, access_expires_at,
  refresh_expires_at, granted_scopes, external_entity_reference_fingerprint,
  status, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at
) values (
  '79d00000-0000-4000-8000-000000000033',
  'integration_credential_authority_v1',
  null,
  '89d00000-0000-4000-8000-000000000003',
  '79d00000-0000-4000-8000-000000000003',
  'b9d00000-0000-4000-8000-000000000001',
  'd9d00000-0000-4000-8000-000000000001',
  'e9d00000-0000-4000-8000-000000000003',
  1,
  'quickbooks_online',
  'sandbox',
  'a9d00000-0000-4000-8000-000000000001',
  6,
  'oauth_credential_envelope_v1',
  'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b9d00000-0000-4000-8000-000000000001',
    'e9d00000-0000-4000-8000-000000000003',
    1,
    'quickbooks_online',
    '79d00000-0000-4000-8000-000000000033'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('r', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() + interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-lineage-reauth'),
  'active',
  'phase8b_lineage_reauth_store',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-store', 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp() - interval '6 minutes',
  pg_catalog.transaction_timestamp() - interval '6 minutes'
);

update private.integration_reauthorization_states
set
  status = 'completed',
  completion_request_id = 'phase8b_lineage_reauth_complete',
  completion_request_fingerprint = extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-complete', 'UTF8'),
    'sha256'
  ),
  replacement_credential_id = '79d00000-0000-4000-8000-000000000033',
  mapping_revalidation_fingerprint = extensions.digest(
    pg_catalog.convert_to('phase8b-lineage-reauth-mapping-revalidated', 'UTF8'),
    'sha256'
  ),
  completed_at = pg_catalog.transaction_timestamp() - interval '6 minutes',
  row_version = row_version + 1
where id = '89d00000-0000-4000-8000-000000000003';

select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000001',
  'e9d00000-0000-4000-8000-000000000001',
  'f9d00000-0000-4000-8000-000000000001',
  '29d00000-0000-4000-8000-000000000001',
  '79d00000-0000-4000-8000-000000000001',
  5,
  '49d00000-0000-4000-8000-000000000001',
  '59d00000-0000-4000-8000-000000000001',
  '69d00000-0000-4000-8000-000000000001',
  '79e00000-0000-4000-8000-000000000001',
  'phase8b_lineage_advance',
  '39d00000-0000-4000-8000-000000000001'
);
select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000002',
  'e9d00000-0000-4000-8000-000000000001',
  'f9d00000-0000-4000-8000-000000000001',
  '29d00000-0000-4000-8000-000000000001',
  '79d00000-0000-4000-8000-000000000001',
  5,
  '49d00000-0000-4000-8000-000000000002',
  '59d00000-0000-4000-8000-000000000002',
  '69d00000-0000-4000-8000-000000000002',
  '79e00000-0000-4000-8000-000000000002',
  'phase8b_lineage_effect',
  '39d00000-0000-4000-8000-000000000002'
);
select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000003',
  'e9d00000-0000-4000-8000-000000000001',
  'f9d00000-0000-4000-8000-000000000001',
  '29d00000-0000-4000-8000-000000000001',
  '79d00000-0000-4000-8000-000000000001',
  5,
  '49d00000-0000-4000-8000-000000000003',
  '59d00000-0000-4000-8000-000000000003',
  '69d00000-0000-4000-8000-000000000003',
  '79e00000-0000-4000-8000-000000000003',
  'phase8b_lineage_wrong_task',
  '39d00000-0000-4000-8000-000000000003'
);
select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000004',
  'e9d00000-0000-4000-8000-000000000002',
  'f9d00000-0000-4000-8000-000000000002',
  '29d00000-0000-4000-8000-000000000002',
  '79d00000-0000-4000-8000-000000000002',
  5,
  '49d00000-0000-4000-8000-000000000004',
  '59d00000-0000-4000-8000-000000000004',
  '69d00000-0000-4000-8000-000000000004',
  '79e00000-0000-4000-8000-000000000004',
  'phase8b_lineage_same',
  '39d00000-0000-4000-8000-000000000004'
);
select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000005',
  'e9d00000-0000-4000-8000-000000000003',
  'f9d00000-0000-4000-8000-000000000003',
  '29d00000-0000-4000-8000-000000000003',
  '79d00000-0000-4000-8000-000000000003',
  5,
  '49d00000-0000-4000-8000-000000000005',
  '59d00000-0000-4000-8000-000000000005',
  '69d00000-0000-4000-8000-000000000005',
  '79e00000-0000-4000-8000-000000000005',
  'phase8b_lineage_reauth',
  '39d00000-0000-4000-8000-000000000005',
  20
);
select pg_temp.create_failed_task_fixture(
  '39d00000-0000-4000-8000-000000000006',
  'e9d00000-0000-4000-8000-000000000004',
  'f9d00000-0000-4000-8000-000000000004',
  '29d00000-0000-4000-8000-000000000004',
  '79d00000-0000-4000-8000-000000000004',
  5,
  '49d00000-0000-4000-8000-000000000006',
  '59d00000-0000-4000-8000-000000000006',
  '69d00000-0000-4000-8000-000000000006',
  '79e00000-0000-4000-8000-000000000006',
  'phase8b_lineage_race',
  '39d00000-0000-4000-8000-000000000006'
);

insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
)
select
  task.workspace_id,
  task.business_entity_id,
  task.connection_id,
  'service',
  'phase8b_provider_runtime',
  'integration_sync_task.complete',
  'succeeded',
  'integration_sync_task',
  task.id::text,
  'phase8b_lineage_effect_completion',
  null,
  pg_catalog.jsonb_build_object(
    'task_state', 'succeeded',
    'task_kind', task.task_kind,
    'queue_class', task.queue_class,
    'attempt_count', task.attempt_count,
    'dispatch_generation', task.dispatch_generation,
    'row_version', task.row_version,
    'idempotent', false
  ),
  task.completed_at - interval '500 milliseconds',
  'operational'
from private.integration_sync_tasks as task
where task.id = '39d00000-0000-4000-8000-000000000002';

select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.recover_qbo_sandbox_credential_binding_incident_task_v2(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_credential_binding_incident_task_v2(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_sync_task_credential_lineage_recovery_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'lineage recovery is broker-RPC-only with no service_role or table shortcut'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid =
      'private.integration_sync_task_credential_lineage_recovery_events'::regclass
  ),
  'lineage recovery evidence remains private with forced RLS'
);

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_service_role_denied',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'service_role cannot invoke lineage recovery'
);
reset role;

set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000003',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_wrong_task_audit',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'credential-read evidence explicitly bound to another task is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000004',
        '79d00000-0000-4000-8000-000000000002', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_different_credential',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'a different credential row cannot substitute for the historical lineage anchor'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000005', 9,
        '69d00000-0000-4000-8000-000000000005',
        '79e00000-0000-4000-8000-000000000005',
        '79d00000-0000-4000-8000-000000000003', 5,
        '79d00000-0000-4000-8000-000000000033', 6, 1,
        'e9d00000-0000-4000-8000-000000000003',
        'f9d00000-0000-4000-8000-000000000003'
      ),
      'phase8b_lineage_reauthorization_substitution',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'even a valid reauthorization successor cannot substitute for a historical refresh lineage'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000002', 9,
        '69d00000-0000-4000-8000-000000000002',
        '79e00000-0000-4000-8000-000000000002',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_effect_denied',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'provider completion evidence still blocks lineage recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 6,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_stale_current_cas',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'stale current active credential row-version CAS fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001',
        'b9d00000-0000-4000-8000-000000000099'
      ),
      'phase8b_lineage_cross_workspace',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'cross-workspace lineage recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001',
        'b9d00000-0000-4000-8000-000000000001',
        'd9d00000-0000-4000-8000-000000000099'
      ),
      'phase8b_lineage_cross_entity',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'cross-business-entity lineage recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000002',
        'f9d00000-0000-4000-8000-000000000002'
      ),
      'phase8b_lineage_cross_connection',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'cross-connection lineage recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001',
        'b9d00000-0000-4000-8000-000000000001',
        'd9d00000-0000-4000-8000-000000000001',
        2
      ),
      'phase8b_lineage_stale_generation',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'stale connection-generation lineage recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 5, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_stale_current_version',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'stale current active credential-version CAS fails closed'
);
reset role;

savepoint phase8b_lineage_invalid_grant;
insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values (
  'b9d00000-0000-4000-8000-000000000001',
  'd9d00000-0000-4000-8000-000000000001',
  'e9d00000-0000-4000-8000-000000000001',
  'service', 'integration_credential_broker',
  'credential_refresh_boundary', 'failed', 'integration_credential',
  '79d00000-0000-4000-8000-000000000001',
  'phase8b_lineage_invalid_grant', 'invalid_grant',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_version', 6,
    'refresh_boundary_stage', 'provider_response_parse',
    'refresh_operation_fingerprint',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'refresh_diagnostics', null
  ),
  pg_catalog.transaction_timestamp() - interval '1 minute',
  'security'
);
set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_invalid_grant_denied',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'invalid_grant evidence on the current lineage blocks recovery'
);
reset role;
rollback to savepoint phase8b_lineage_invalid_grant;
release savepoint phase8b_lineage_invalid_grant;

savepoint phase8b_lineage_provider_revoked;
insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values (
  'b9d00000-0000-4000-8000-000000000001',
  'd9d00000-0000-4000-8000-000000000001',
  'e9d00000-0000-4000-8000-000000000001',
  'service', 'integration_credential_broker',
  'credential_refresh_boundary', 'failed', 'integration_credential',
  '79d00000-0000-4000-8000-000000000001',
  'phase8b_lineage_provider_revoked', 'provider_revoked',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_version', 6,
    'refresh_boundary_stage', 'provider_response_parse',
    'refresh_operation_fingerprint',
      'sha256:bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc',
    'refresh_diagnostics', null
  ),
  pg_catalog.transaction_timestamp() - interval '1 minute',
  'security'
);
set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      pg_temp.lineage_recovery_command(
        '39d00000-0000-4000-8000-000000000001', 9,
        '69d00000-0000-4000-8000-000000000001',
        '79e00000-0000-4000-8000-000000000001',
        '79d00000-0000-4000-8000-000000000001', 5,
        '79d00000-0000-4000-8000-000000000001', 6, 7,
        'e9d00000-0000-4000-8000-000000000001',
        'f9d00000-0000-4000-8000-000000000001'
      ),
      'phase8b_lineage_provider_revoked_denied',
      'phase8b_lineage_operator'
    )$$,
    '42501'
  ),
  'provider_revoked evidence on the current lineage blocks recovery'
);
reset role;
rollback to savepoint phase8b_lineage_provider_revoked;
release savepoint phase8b_lineage_provider_revoked;

set local role integration_credential_broker_authority;
create temporary table phase8b_lineage_advance_result as
select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
  pg_temp.lineage_recovery_command(
    '39d00000-0000-4000-8000-000000000001', 9,
    '69d00000-0000-4000-8000-000000000001',
    '79e00000-0000-4000-8000-000000000001',
    '79d00000-0000-4000-8000-000000000001', 5,
    '79d00000-0000-4000-8000-000000000001', 6, 7,
    'e9d00000-0000-4000-8000-000000000001',
    'f9d00000-0000-4000-8000-000000000001'
  ),
  'phase8b_lineage_v5_to_v6_recovery',
  'phase8b_lineage_operator'
) as result;
select ok(
  (
    select result ->> 'state' = 'retry_wait'
      and result ->> 'historicalCredentialVersion' = '5'
      and result ->> 'currentCredentialVersion' = '6'
      and not (result ->> 'idempotent')::boolean
    from phase8b_lineage_advance_result
  ),
  'historical V5 incident plus current V6 on the same refresh lineage is recoverable'
);
select is(
  public.recover_qbo_sandbox_credential_binding_incident_task_v2(
    pg_temp.lineage_recovery_command(
      '39d00000-0000-4000-8000-000000000001', 9,
      '69d00000-0000-4000-8000-000000000001',
      '79e00000-0000-4000-8000-000000000001',
      '79d00000-0000-4000-8000-000000000001', 5,
      '79d00000-0000-4000-8000-000000000001', 6, 7,
      'e9d00000-0000-4000-8000-000000000001',
      'f9d00000-0000-4000-8000-000000000001'
    ),
    'phase8b_lineage_v5_to_v6_recovery',
    'phase8b_lineage_operator'
  ) ->> 'idempotent',
  'true',
  'identical V5-to-V6 recovery replay is idempotent'
);

create temporary table phase8b_lineage_same_result as
select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
  pg_temp.lineage_recovery_command(
    '39d00000-0000-4000-8000-000000000004', 9,
    '69d00000-0000-4000-8000-000000000004',
    '79e00000-0000-4000-8000-000000000004',
    '79d00000-0000-4000-8000-000000000002', 5,
    '79d00000-0000-4000-8000-000000000002', 5, 6,
    'e9d00000-0000-4000-8000-000000000002',
    'f9d00000-0000-4000-8000-000000000002'
  ),
  'phase8b_lineage_same_version_recovery',
  'phase8b_lineage_operator'
) as result;
select ok(
  (
    select result ->> 'state' = 'retry_wait'
      and result ->> 'historicalCredentialVersion' = '5'
      and result ->> 'currentCredentialVersion' = '5'
    from phase8b_lineage_same_result
  ),
  'historical and current exact same refresh-lineage version remains recoverable'
);
reset role;

select ok(
  (
    select credential_lineage_id = historical_credential_id
      and credential_lineage_id = current_credential_id
      and historical_credential_version = 5
      and current_credential_version = 6
      and credential_created_version = 1
      and refresh_advancement_count = 1
    from private.integration_sync_task_credential_lineage_recovery_events
    where task_id = '39d00000-0000-4000-8000-000000000001'
  ),
  'immutable recovery evidence separates historical V5 from current V6 under one anchor'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_credential_lineage_recovery_events
    where task_id in (
      '39d00000-0000-4000-8000-000000000001',
      '39d00000-0000-4000-8000-000000000004'
    )
  ),
  '2',
  'successful recoveries append exactly one immutable event per task'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_credential_lineage_recovery_events
      set actor_id = 'forged_actor'
      where task_id = '39d00000-0000-4000-8000-000000000001'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_credential_lineage_recovery_events
      where task_id = '39d00000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'lineage recovery evidence is update/delete immutable'
);

commit;

select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (values
  ('phase8b_lineage_recovery_race_1'),
  ('phase8b_lineage_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (values
  ('phase8b_lineage_recovery_race_1'),
  ('phase8b_lineage_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_send_query(
  connection_name,
  $query$
    select public.recover_qbo_sandbox_credential_binding_incident_task_v2(
      jsonb_build_object(
        'contractVersion',
          'qbo_sandbox_credential_envelope_binding_incident_recovery_v2',
        'workspaceId', 'b9d00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd9d00000-0000-4000-8000-000000000001',
        'connectionId', 'e9d00000-0000-4000-8000-000000000004',
        'connectionGeneration', 1,
        'mappingId', 'f9d00000-0000-4000-8000-000000000004',
        'expectedMappingRowVersion', 1,
        'historicalCredentialId', '79d00000-0000-4000-8000-000000000004',
        'expectedHistoricalCredentialVersion', 5,
        'currentCredentialId', '79d00000-0000-4000-8000-000000000004',
        'expectedCurrentCredentialVersion', 6,
        'expectedCurrentCredentialRowVersion', 7,
        'taskId', '39d00000-0000-4000-8000-000000000006',
        'expectedTaskRowVersion', 9,
        'expectedDispatchGeneration', 2,
        'failureAuditEventId', '69d00000-0000-4000-8000-000000000006',
        'credentialReadAuditEventId', '79e00000-0000-4000-8000-000000000006',
        'diagnosticClass', 'expires_at_binding',
        'externalEvidenceFingerprint',
          'sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        'retryAfterSeconds', 1
      ),
      'phase8b_lineage_concurrent_recovery',
      'phase8b_lineage_operator'
    )
  $query$
)
from (values
  ('phase8b_lineage_recovery_race_1'),
  ('phase8b_lineage_recovery_race_2')
) as connections(connection_name);

create temporary table phase8b_lineage_concurrent_results (
  result jsonb not null
);
insert into phase8b_lineage_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_lineage_recovery_race_1')
  as response(result jsonb);
insert into phase8b_lineage_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_lineage_recovery_race_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_lineage_recovery_race_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_lineage_recovery_race_2')
  as response(result jsonb);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_lineage_concurrent_results
    where not (result ->> 'idempotent')::boolean
  ),
  1,
  'concurrent lineage recovery permits exactly one authoritative mutation'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_lineage_concurrent_results
    where (result ->> 'idempotent')::boolean
  ),
  1,
  'concurrent lineage recovery loser converges through idempotent evidence'
);
select ok(
  (
    select state = 'retry_wait'
      and row_version = 10
      and dispatch_generation = 2
      and durable_effect_fingerprint is null
    from private.integration_sync_tasks
    where id = '39d00000-0000-4000-8000-000000000006'
  )
  and (
    select pg_catalog.count(*) = 1
    from private.integration_sync_task_credential_lineage_recovery_events
    where task_id = '39d00000-0000-4000-8000-000000000006'
  ),
  'concurrent recovery leaves one task mutation and one immutable event'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_lineage_recovery_race_1'),
  ('phase8b_lineage_recovery_race_2')
) as connections(connection_name);

begin;
set local search_path = public, extensions;
select * from finish();
rollback;
