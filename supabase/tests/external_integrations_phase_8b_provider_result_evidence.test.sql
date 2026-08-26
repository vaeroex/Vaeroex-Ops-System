begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

grant usage on schema extensions to
  integration_provider_runtime_authority,
  integration_credential_broker_authority;

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

create or replace function pg_temp.provider_command(
  p_read_id uuid,
  p_ordinal integer,
  p_domain text,
  p_class text,
  p_outcome text,
  p_seed text
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_provider_result_evidence_v1',
    'credentialReadEvidenceId', p_read_id,
    'requestOrdinal', p_ordinal,
    'endpointDomain', p_domain,
    'endpointClass', p_class,
    'providerRequestFingerprint', 'sha256:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_seed, 'UTF8'), 'sha256'),
      'hex'
    ),
    'providerOutcome', p_outcome
  );
$function$;

create or replace function pg_temp.ar_recovery_command(
  p_task_id uuid default '1eb257e9-5275-51a7-992c-d08186c58c98'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_ar_aging_identifier_recovery_v1',
    'workspaceId', '4ae00000-0000-4000-8000-000000000002',
    'businessEntityId', '4ae00000-0000-4000-8000-000000000003',
    'connectionId', '4ae00000-0000-4000-8000-000000000004',
    'connectionGeneration', 1,
    'syncRunId', '4ae00000-0000-4000-8000-000000000009',
    'mappingId', '4ae00000-0000-4000-8000-000000000005',
    'expectedMappingRowVersion', 1,
    'historicalCredentialId', '4ae00000-0000-4000-8000-000000000007',
    'expectedHistoricalCredentialVersion', 5,
    'currentCredentialId', '4ae00000-0000-4000-8000-000000000007',
    'expectedCurrentCredentialVersion', 6,
    'expectedCurrentCredentialRowVersion', 7,
    'taskId', p_task_id,
    'expectedTaskRowVersion', 9,
    'expectedDispatchGeneration', 1,
    'failureAuditEventId', '4ae00000-0000-4000-8000-000000000021',
    'credentialReadEvidenceId', '4ae00000-0000-4000-8000-000000000022',
    'retryAfterSeconds', 1
  );
$function$;

insert into public.profiles (id, email, full_name) values (
  '4ae00000-0000-4000-8000-000000000001',
  'phase8b-provider-result@example.test',
  'Phase 8B Provider Result'
);
insert into public.workspaces (id, name, created_by) values (
  '4ae00000-0000-4000-8000-000000000002',
  'Phase 8B Provider Result',
  '4ae00000-0000-4000-8000-000000000001'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000002',
  'business_entity_v1', 'phase8b_provider_result', 'operating_company',
  'Phase 8B Provider Result', 'USD', 'UTC', 1, 'active',
  '4ae00000-0000-4000-8000-000000000001',
  '4ae00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

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
  '4ae00000-0000-4000-8000-000000000004',
  'integration_connection_v1', 'integration_connection_control_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004', 1,
  'quickbooks_online', 'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1('provider-result-realm'),
  'initializing', 'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Provider Result Sandbox', 'vaeroex_provider_descriptors_v1',
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
    'supportsBackfill', true, 'webhookMode', 'change_hints',
    'incrementalMode', 'cursor'
  ),
  1, pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours', 3,
  '4ae00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, provider_key, provider_environment,
  provider_entity_type, provider_entity_reference_fingerprint,
  safe_display_name, mapping_role, status, verification_mode,
  verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
  created_at, updated_at
) values (
  '4ae00000-0000-4000-8000-000000000005',
  'provider_entity_mapping_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004',
  '4ae00000-0000-4000-8000-000000000005', 1,
  'quickbooks_online', 'sandbox', 'company',
  private.qbo_phase_8b_realm_fingerprint_v1('provider-result-realm'),
  'Provider Result Sandbox', 'primary', 'active', 'qbo_realm_mapping_v1',
  extensions.digest(
    pg_catalog.convert_to('provider-result-mapping', 'UTF8'), 'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  '4ae00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours', 1,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status,
  creation_request_id, creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
) values (
  '4ae00000-0000-4000-8000-000000000006',
  'integration_oauth_state_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004', 1,
  'quickbooks_online', 'sandbox',
  '4ae00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[], '/phase8b/test',
  extensions.digest(pg_catalog.convert_to('provider-state', 'UTF8'), 'sha256'),
  'consumed', 'provider_state_create',
  extensions.digest(pg_catalog.convert_to('provider-create', 'UTF8'), 'sha256'),
  'provider_state_consume',
  extensions.digest(pg_catalog.convert_to('provider-consume', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '110 minutes',
  pg_catalog.transaction_timestamp() - interval '115 minutes', 2
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
  '4ae00000-0000-4000-8000-000000000007',
  'integration_credential_authority_v1',
  '4ae00000-0000-4000-8000-000000000006',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004', 1,
  'quickbooks_online', 'sandbox',
  '4ae00000-0000-4000-8000-000000000001', 6,
  'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox', '4ae00000-0000-4000-8000-000000000002',
    '4ae00000-0000-4000-8000-000000000004', 1, 'quickbooks_online',
    '4ae00000-0000-4000-8000-000000000007'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('e', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() + interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1('provider-result-realm'),
  'active', 'provider_credential_store',
  extensions.digest(pg_catalog.convert_to('provider-credential', 'UTF8'), 'sha256'),
  7, pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 minutes'
);

insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
)
select
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004',
  'service', 'integration_credential_broker', 'credential_rotated',
  'succeeded', 'integration_credential',
  '4ae00000-0000-4000-8000-000000000007',
  'provider_rotation_' || version::text, 'refresh_succeeded',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1, 'connection_status', 'initializing',
    'credential_status', 'active', 'credential_version', version,
    'lease_state', 'released', 'idempotent', false
  ),
  case when version = 6
    then pg_catalog.transaction_timestamp() - interval '5 minutes'
    else pg_catalog.transaction_timestamp() - interval '90 minutes'
      + pg_catalog.make_interval(mins => version)
  end,
  'security'
from pg_catalog.generate_series(2, 6) as version;

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, provider_contract_version, adapter_version,
  policy_version, records_observed, records_accepted, records_rejected,
  facts_accepted, contributions_changed, created_at, started_at,
  row_version, updated_at
) values (
  '4ae00000-0000-4000-8000-000000000009',
  'integration_sync_run_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004',
  '4ae00000-0000-4000-8000-000000000005', 1,
  'provider_initialization', 'initialization', 'running',
  extensions.digest(pg_catalog.convert_to('provider-run', 'UTF8'), 'sha256'),
  'provider_adapter_v1', 'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours', 2,
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

create or replace function pg_temp.create_leased_report_fixture(
  p_task_id uuid,
  p_read_id uuid,
  p_stream_key text,
  p_seed text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_lease_id uuid := p_read_id;
begin
  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, provider_key, provider_environment,
    queue_class, task_kind, stream_key, state, priority, control_metadata,
    idempotency_fingerprint, coalescing_fingerprint, dispatcher_task_name,
    dispatch_generation, delivery_attribution_state,
    last_delivery_dispatch_generation, last_delivery_retry_count,
    last_delivery_execution_count, last_delivery_attempt_fingerprint,
    attempt_count, maximum_attempts, available_at, lease_id,
    lease_owner_fingerprint, lease_expires_at, heartbeat_at,
    last_request_id, last_request_fingerprint, row_version, created_at,
    updated_at, retention_expires_at
  ) values (
    p_task_id, 'integration_sync_task_v1',
    '4ae00000-0000-4000-8000-000000000002',
    '4ae00000-0000-4000-8000-000000000003',
    '4ae00000-0000-4000-8000-000000000004', 1,
    '4ae00000-0000-4000-8000-000000000009',
    'quickbooks_online', 'sandbox', 'provider_interactive',
    'initial_historical', p_stream_key, 'leased', 80,
    pg_catalog.jsonb_build_object(
      'checkpointId', null, 'mappingId',
        '4ae00000-0000-4000-8000-000000000005',
      'eventId', null, 'pageOrdinal', 0, 'cursorVersion', 0,
      'windowStartAt', '2026-01-01T00:00:00.000Z',
      'windowEndAt', '2026-01-31T23:59:59.000Z',
      'reasonCode', p_seed, 'recordHintCount', 0,
      'coalescedEventCount', 1
    ),
    extensions.digest(pg_catalog.convert_to(p_seed || '-idempotency', 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(p_seed || '-coalescing', 'UTF8'), 'sha256'),
    p_seed || '_cloud_task', 1, 'attributed', 1, 0, 0,
    extensions.digest(pg_catalog.convert_to(p_seed || '-delivery', 'UTF8'), 'sha256'),
    1, 3, v_now - interval '1 minute', v_lease_id,
    extensions.digest(pg_catalog.convert_to(p_seed || '-owner', 'UTF8'), 'sha256'),
    v_now + interval '5 minutes', v_now,
    p_seed || '_lease',
    extensions.digest(pg_catalog.convert_to(p_seed || '-lease-request', 'UTF8'), 'sha256'),
    8, v_now - interval '1 hour', v_now, v_now + interval '7 days'
  );

  insert into private.integration_audit_events (
    id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
    action, outcome, target_type, target_id, request_id, reason_code, metadata,
    occurred_at, retention_class
  ) values (
    p_read_id,
    '4ae00000-0000-4000-8000-000000000002',
    '4ae00000-0000-4000-8000-000000000003',
    '4ae00000-0000-4000-8000-000000000004',
    'service', 'integration_credential_broker', 'credential_provider_read',
    'allowed', 'integration_credential',
    '4ae00000-0000-4000-8000-000000000007',
    p_seed || '_read', 'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', 1, 'credential_status', 'active',
      'credential_version', 6, 'task_state', 'leased'
    ),
    v_now, 'security'
  );

  insert into private.integration_provider_credential_task_read_evidence (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, connection_row_version, sync_run_id, mapping_id,
    mapping_row_version, task_id, task_row_version, task_dispatch_generation,
    dispatcher_task_name, delivery_attribution_state,
    delivery_dispatch_generation, delivery_retry_count,
    delivery_execution_count, delivery_attempt_fingerprint, lease_id,
    lease_owner_fingerprint, lease_expires_at, credential_id,
    credential_version, credential_row_version, provider_key,
    provider_environment, granted_scopes, granted_scope_fingerprint,
    credential_read_audit_event_id, request_id, request_fingerprint,
    evidence_fingerprint, authority_role, authorized_at, created_at
  ) values (
    p_read_id, 'integration_provider_credential_task_read_evidence_v1',
    '4ae00000-0000-4000-8000-000000000002',
    '4ae00000-0000-4000-8000-000000000003',
    '4ae00000-0000-4000-8000-000000000004', 1, 3,
    '4ae00000-0000-4000-8000-000000000009',
    '4ae00000-0000-4000-8000-000000000005', 1,
    p_task_id, 8, 1, p_seed || '_cloud_task', 'attributed', 1, 0, 0,
    extensions.digest(pg_catalog.convert_to(p_seed || '-delivery', 'UTF8'), 'sha256'),
    v_lease_id,
    extensions.digest(pg_catalog.convert_to(p_seed || '-owner', 'UTF8'), 'sha256'),
    v_now + interval '5 minutes',
    '4ae00000-0000-4000-8000-000000000007', 6, 7,
    'quickbooks_online', 'sandbox',
    array['com.intuit.quickbooks.accounting']::text[],
    private.phase_3_contract_fingerprint_v1(pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_credential_scope_binding_v1',
      'providerKey', 'quickbooks_online', 'providerEnvironment', 'sandbox',
      'grantedScopes', pg_catalog.jsonb_build_array(
        'com.intuit.quickbooks.accounting'
      )
    )),
    p_read_id, p_seed || '_read',
    extensions.digest(pg_catalog.convert_to(p_seed || '-read-request', 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(p_seed || '-read-evidence', 'UTF8'), 'sha256'),
    'integration_credential_broker_authority', v_now, v_now
  );
end;
$function$;

select pg_temp.create_leased_report_fixture(
  '4ae00000-0000-4000-8000-000000000011',
  '4ae00000-0000-4000-8000-000000000012',
  'qbo_apagingsummary', 'provider_success'
);
select pg_temp.create_leased_report_fixture(
  '4ae00000-0000-4000-8000-000000000013',
  '4ae00000-0000-4000-8000-000000000014',
  'qbo_aragingsummary', 'parser_failure'
);
select pg_temp.create_leased_report_fixture(
  '4ae00000-0000-4000-8000-000000000015',
  '4ae00000-0000-4000-8000-000000000016',
  'qbo_apagingsummary', 'provider_fault'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.integration_qbo_provider_task_result_evidence'::regclass)
  and
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.integration_qbo_report_parser_result_evidence'::regclass),
  'provider and parser evidence use forced RLS'
);
select ok(
  has_function_privilege(
    'integration_provider_runtime_authority',
    'public.record_qbo_sandbox_provider_result_v1(jsonb,text)', 'EXECUTE'
  )
  and has_function_privilege(
    'integration_provider_runtime_authority',
    'public.record_qbo_sandbox_report_parser_result_v1(jsonb,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_qbo_sandbox_provider_result_v1(jsonb,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'only narrow runtime and broker authorities can execute evidence/recovery RPCs'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'integration_qbo_provider_task_result_evidence',
        'integration_qbo_report_parser_result_evidence'
      )
      and column_name ~ '(payload|token|authorization|realm|business_data)'
  ),
  0,
  'evidence schemas contain no payload, token, authorization, realm, or business-data columns'
);

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_tasks
      set state = 'succeeded', dispatcher_task_name = null,
          lease_id = null, lease_owner_fingerprint = null,
          lease_expires_at = null, heartbeat_at = null,
          durable_effect_fingerprint = extensions.digest('missing', 'sha256'),
          completed_at = pg_catalog.transaction_timestamp(),
          row_version = row_version + 1,
          updated_at = pg_catalog.transaction_timestamp()
      where id = '4ae00000-0000-4000-8000-000000000011'$$,
    '55000'
  ),
  'no provider result evidence means no successful task authority'
);

set local role integration_provider_runtime_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_qbo_sandbox_provider_result_v1(
      pg_temp.provider_command(
        '4ae00000-0000-4000-8000-000000000012', 1,
        'report', 'qbo_report_aged_receivables', 'provider_success', 'wrong'
      ), 'provider_wrong_endpoint'
    )$$,
    '42501'
  ),
  'wrong task endpoint binding is denied'
);
create temporary table provider_success_result as
select public.record_qbo_sandbox_provider_result_v1(
  pg_temp.provider_command(
    '4ae00000-0000-4000-8000-000000000012', 1,
    'report', 'qbo_report_aged_payables', 'provider_success', 'ap-success'
  ),
  'provider_success_result'
) as result;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_qbo_sandbox_report_parser_result_v1(
      jsonb_build_object(
        'contractVersion', 'qbo_sandbox_report_parser_result_evidence_v1',
        'providerResultEvidenceId', '4ae00000-0000-4000-8000-000000000099',
        'parserOutcome', 'parser_success'
      ), 'parser_cross_bound'
    )$$,
    '42501'
  ),
  'parser evidence from another provider result cannot cross-bind'
);
create temporary table parser_success_result as
select public.record_qbo_sandbox_report_parser_result_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_report_parser_result_evidence_v1',
    'providerResultEvidenceId',
      (select result ->> 'providerResultEvidenceId' from provider_success_result),
    'parserOutcome', 'parser_success'
  ),
  'parser_success_result'
) as result;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_qbo_sandbox_provider_result_v1(
      pg_temp.provider_command(
        '4ae00000-0000-4000-8000-000000000012', 1,
        'report', 'qbo_report_aged_payables', 'provider_fault', 'conflict'
      ), 'provider_result_cross_bind_conflict'
    )$$,
    '23505'
  ),
  'an existing read ordinal cannot be cross-bound to another outcome or request'
);
reset role;

update private.integration_sync_tasks
set state = 'succeeded', dispatcher_task_name = null,
  lease_id = null, lease_owner_fingerprint = null,
  lease_expires_at = null, heartbeat_at = null,
  durable_effect_fingerprint = extensions.digest('provider-success', 'sha256'),
  completed_at = pg_catalog.transaction_timestamp(),
  row_version = row_version + 1,
  updated_at = pg_catalog.transaction_timestamp()
where id = '4ae00000-0000-4000-8000-000000000011';
select ok(
  (select state = 'succeeded' and row_version = 9
   from private.integration_sync_tasks
   where id = '4ae00000-0000-4000-8000-000000000011'),
  'provider success plus exact parser success permits terminal completion'
);

set local role integration_provider_runtime_authority;
create temporary table parser_failure_provider as
select public.record_qbo_sandbox_provider_result_v1(
  pg_temp.provider_command(
    '4ae00000-0000-4000-8000-000000000014', 1,
    'report', 'qbo_report_aged_receivables', 'provider_success',
    'ar-parser-failure'
  ),
  'parser_failure_provider'
) as result;
select public.record_qbo_sandbox_report_parser_result_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_report_parser_result_evidence_v1',
    'providerResultEvidenceId',
      (select result ->> 'providerResultEvidenceId' from parser_failure_provider),
    'parserOutcome', 'report_rows_shape'
  ),
  'parser_failure_result'
);
reset role;
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_tasks
      set state = 'succeeded', dispatcher_task_name = null,
          lease_id = null, lease_owner_fingerprint = null,
          lease_expires_at = null, heartbeat_at = null,
          durable_effect_fingerprint = extensions.digest('wrong-parser', 'sha256'),
          completed_at = pg_catalog.transaction_timestamp(),
          row_version = row_version + 1,
          updated_at = pg_catalog.transaction_timestamp()
      where id = '4ae00000-0000-4000-8000-000000000013'$$,
    '55000'
  ),
  'a structural parser failure cannot authorize successful task completion'
);

set local role integration_provider_runtime_authority;
create temporary table provider_fault_result as
select public.record_qbo_sandbox_provider_result_v1(
  pg_temp.provider_command(
    '4ae00000-0000-4000-8000-000000000016', 1,
    'report', 'qbo_report_aged_payables', 'provider_fault',
    'provider-fault'
  ),
  'provider_fault_result'
) as result;
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.record_qbo_sandbox_report_parser_result_v1(
        jsonb_build_object(
          'contractVersion', 'qbo_sandbox_report_parser_result_evidence_v1',
          'providerResultEvidenceId', %L,
          'parserOutcome', 'report_rows_shape'
        ), 'provider_fault_not_parser'
      )$$,
      (select result ->> 'providerResultEvidenceId' from provider_fault_result)
    ),
    '42501'
  ),
  'a provider fault cannot be reclassified as a post-fetch parser failure'
);
reset role;
update private.integration_sync_tasks
set state = 'failed', dispatcher_task_name = null,
  lease_id = null, lease_owner_fingerprint = null,
  lease_expires_at = null, heartbeat_at = null,
  failure_category = 'contract', failure_code = 'phase8b_provider_task_failed',
  completed_at = pg_catalog.transaction_timestamp(),
  row_version = row_version + 1,
  updated_at = pg_catalog.transaction_timestamp()
where id = '4ae00000-0000-4000-8000-000000000013';
select ok(
  (select state = 'failed' and durable_effect_fingerprint is null
   from private.integration_sync_tasks
   where id = '4ae00000-0000-4000-8000-000000000013'),
  'provider success and exact parser failure preserve a durable effect-free failure'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_qbo_provider_task_result_evidence
      set provider_outcome = 'provider_fault'$$,
    '55000'
  ) and pg_temp.raises_sqlstate(
    $$delete from private.integration_qbo_report_parser_result_evidence$$,
    '55000'
  ),
  'provider and parser evidence are update/delete immutable'
);

-- Historical A/R fixture: provider identifier 5020, exact task-bound V5 read,
-- no source/effect/checkpoint. Current authority is the same credential row V6.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatch_generation,
  delivery_attribution_state, last_delivery_dispatch_generation,
  last_delivery_retry_count, last_delivery_execution_count,
  last_delivery_attempt_fingerprint, attempt_count, maximum_attempts,
  available_at, failure_category, failure_code, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at,
  completed_at, retention_expires_at
) values (
  '1eb257e9-5275-51a7-992c-d08186c58c98',
  'integration_sync_task_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004', 1,
  '4ae00000-0000-4000-8000-000000000009',
  'quickbooks_online', 'sandbox', 'provider_interactive',
  'initial_historical', 'qbo_aragingsummary', 'failed', 80,
  pg_catalog.jsonb_build_object(
    'checkpointId', null, 'mappingId',
      '4ae00000-0000-4000-8000-000000000005',
    'eventId', null, 'pageOrdinal', 0, 'cursorVersion', 0,
    'windowStartAt', '2026-01-01T00:00:00.000Z',
    'windowEndAt', '2026-01-31T23:59:59.000Z',
    'reasonCode', 'historical_ar_5020', 'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(pg_catalog.convert_to('ar-idempotency', 'UTF8'), 'sha256'),
  extensions.digest(pg_catalog.convert_to('ar-coalescing', 'UTF8'), 'sha256'),
  1, 'attributed', 1, 0, 0,
  extensions.digest(pg_catalog.convert_to('ar-delivery', 'UTF8'), 'sha256'),
  1, 3, pg_catalog.transaction_timestamp() - interval '1 hour',
  'contract', '5020', 'ar_failure_request',
  extensions.digest(pg_catalog.convert_to('ar-failure-request', 'UTF8'), 'sha256'),
  9, pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '10 minutes',
  pg_catalog.transaction_timestamp() - interval '10 minutes',
  pg_catalog.transaction_timestamp() + interval '7 days'
);

insert into private.integration_audit_events (
  id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values
(
  '4ae00000-0000-4000-8000-000000000021',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004',
  'service', 'phase8b_provider_runtime', 'integration_sync_task.fail',
  'failed', 'integration_sync_task',
  '1eb257e9-5275-51a7-992c-d08186c58c98', 'ar_failure_request', null,
  pg_catalog.jsonb_build_object(
    'task_state', 'failed', 'task_kind', 'initial_historical',
    'queue_class', 'provider_interactive', 'attempt_count', 1,
    'dispatch_generation', 1, 'row_version', 9, 'idempotent', false
  ),
  pg_catalog.transaction_timestamp() - interval '10 minutes', 'operational'
),
(
  '4ae00000-0000-4000-8000-000000000022',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004',
  'service', 'integration_credential_broker', 'credential_provider_read',
  'allowed', 'integration_credential',
  '4ae00000-0000-4000-8000-000000000007', 'ar_credential_read', 'authorized',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1, 'credential_status', 'active',
    'credential_version', 5, 'task_state', 'leased'
  ),
  pg_catalog.transaction_timestamp() - interval '11 minutes', 'security'
);

insert into private.integration_provider_credential_task_read_evidence (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, connection_row_version, sync_run_id, mapping_id,
  mapping_row_version, task_id, task_row_version, task_dispatch_generation,
  dispatcher_task_name, delivery_attribution_state,
  delivery_dispatch_generation, delivery_retry_count,
  delivery_execution_count, delivery_attempt_fingerprint, lease_id,
  lease_owner_fingerprint, lease_expires_at, credential_id,
  credential_version, credential_row_version, provider_key,
  provider_environment, granted_scopes, granted_scope_fingerprint,
  credential_read_audit_event_id, request_id, request_fingerprint,
  evidence_fingerprint, authority_role, authorized_at, created_at
) values (
  '4ae00000-0000-4000-8000-000000000022',
  'integration_provider_credential_task_read_evidence_v1',
  '4ae00000-0000-4000-8000-000000000002',
  '4ae00000-0000-4000-8000-000000000003',
  '4ae00000-0000-4000-8000-000000000004', 1, 3,
  '4ae00000-0000-4000-8000-000000000009',
  '4ae00000-0000-4000-8000-000000000005', 1,
  '1eb257e9-5275-51a7-992c-d08186c58c98', 8, 1,
  'historical_ar_cloud_task', 'attributed', 1, 0, 0,
  extensions.digest(pg_catalog.convert_to('ar-delivery', 'UTF8'), 'sha256'),
  '4ae00000-0000-4000-8000-000000000023',
  extensions.digest(pg_catalog.convert_to('ar-owner', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() - interval '6 minutes',
  '4ae00000-0000-4000-8000-000000000007', 5, 6,
  'quickbooks_online', 'sandbox',
  array['com.intuit.quickbooks.accounting']::text[],
  private.phase_3_contract_fingerprint_v1(pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_scope_binding_v1',
    'providerKey', 'quickbooks_online', 'providerEnvironment', 'sandbox',
    'grantedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    )
  )),
  '4ae00000-0000-4000-8000-000000000022', 'ar_credential_read',
  extensions.digest(pg_catalog.convert_to('ar-read-request', 'UTF8'), 'sha256'),
  extensions.digest(pg_catalog.convert_to('ar-read-evidence', 'UTF8'), 'sha256'),
  'integration_credential_broker_authority',
  pg_catalog.transaction_timestamp() - interval '11 minutes',
  pg_catalog.transaction_timestamp() - interval '11 minutes'
);

set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
      pg_temp.ar_recovery_command(
        '99ae1ff1-2049-59a4-9c4b-a26e7adecba8'
      ), 'historical_ap_denied', 'phase8b_operator'
    )$$,
    '22023'
  ),
  'historical A/P task is permanently outside the A/R recovery allowlist'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
      jsonb_set(
        pg_temp.ar_recovery_command(),
        '{expectedCurrentCredentialVersion}', '7'::jsonb
      ), 'stale_ar_credential', 'phase8b_operator'
    )$$,
    '42501'
  ),
  'stale current credential CAS is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
      jsonb_set(
        pg_temp.ar_recovery_command(),
        '{workspaceId}', '"4ae00000-0000-4000-8000-000000000099"'::jsonb
      ), 'cross_workspace_ar_recovery', 'phase8b_operator'
    )$$,
    '42501'
  ),
  'cross-workspace A/R recovery authority fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
      jsonb_set(
        pg_temp.ar_recovery_command(),
        '{credentialReadEvidenceId}',
        '"4ae00000-0000-4000-8000-000000000099"'::jsonb
      ), 'wrong_read_ar_recovery', 'phase8b_operator'
    )$$,
    '42501'
  ),
  'credential-read evidence from another identity cannot authorize A/R recovery'
);
reset role;

commit;

select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (values
  ('phase8b_ar_recovery_race_1'),
  ('phase8b_ar_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (values
  ('phase8b_ar_recovery_race_1'),
  ('phase8b_ar_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_send_query(
  connection_name,
  $query$
    select public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
      jsonb_build_object(
        'contractVersion', 'qbo_sandbox_ar_aging_identifier_recovery_v1',
        'workspaceId', '4ae00000-0000-4000-8000-000000000002',
        'businessEntityId', '4ae00000-0000-4000-8000-000000000003',
        'connectionId', '4ae00000-0000-4000-8000-000000000004',
        'connectionGeneration', 1,
        'syncRunId', '4ae00000-0000-4000-8000-000000000009',
        'mappingId', '4ae00000-0000-4000-8000-000000000005',
        'expectedMappingRowVersion', 1,
        'historicalCredentialId', '4ae00000-0000-4000-8000-000000000007',
        'expectedHistoricalCredentialVersion', 5,
        'currentCredentialId', '4ae00000-0000-4000-8000-000000000007',
        'expectedCurrentCredentialVersion', 6,
        'expectedCurrentCredentialRowVersion', 7,
        'taskId', '1eb257e9-5275-51a7-992c-d08186c58c98',
        'expectedTaskRowVersion', 9,
        'expectedDispatchGeneration', 1,
        'failureAuditEventId', '4ae00000-0000-4000-8000-000000000021',
        'credentialReadEvidenceId', '4ae00000-0000-4000-8000-000000000022',
        'retryAfterSeconds', 1
      ),
      'concurrent_ar_recovery',
      'phase8b_operator'
    )
  $query$
)
from (values
  ('phase8b_ar_recovery_race_1'),
  ('phase8b_ar_recovery_race_2')
) as connections(connection_name);

create temporary table phase8b_ar_concurrent_results(result jsonb not null);
insert into phase8b_ar_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_ar_recovery_race_1')
  as response(result jsonb);
insert into phase8b_ar_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_ar_recovery_race_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_ar_recovery_race_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_ar_recovery_race_2')
  as response(result jsonb);

select is(
  (select pg_catalog.count(*)::integer
   from phase8b_ar_concurrent_results
   where not (result ->> 'idempotent')::boolean),
  1,
  'concurrent A/R recovery produces one authoritative mutation'
);
select is(
  (select pg_catalog.count(*)::integer
   from phase8b_ar_concurrent_results
   where (result ->> 'idempotent')::boolean),
  1,
  'concurrent A/R recovery loser converges idempotently'
);
select ok(
  (select state = 'retry_wait' and row_version = 10
   from private.integration_sync_tasks
   where id = '1eb257e9-5275-51a7-992c-d08186c58c98')
  and
  (select pg_catalog.count(*) = 1
   from private.integration_sync_task_ar_aging_recovery_events
   where task_id = '1eb257e9-5275-51a7-992c-d08186c58c98'),
  'A/R recovery preserves identity and appends one immutable reason event'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_ar_recovery_race_1'),
  ('phase8b_ar_recovery_race_2')
) as connections(connection_name);

begin;
set local search_path = public, extensions;
select * from finish();
rollback;
