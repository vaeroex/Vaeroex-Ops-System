begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  pg_catalog.has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.consume_integration_oauth_state_v2(jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.consume_integration_oauth_state_v2(jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_integration_oauth_state_v2(jsonb,text)',
    'EXECUTE'
  ),
  'database-authoritative OAuth consumption time remains ingress-only'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.consume_integration_oauth_state_v2(jsonb,text)'::regprocedure
  ) like '%jsonb_build_object(%consumedAt%v_consumed_at%',
  'OAuth consume V2 returns the exact stored database timestamp'
);

-- Test-only pgTAP visibility; the surrounding transaction rolls this back.
grant usage on schema extensions to integration_provider_validation_authority;

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

create or replace function pg_temp.pending_version(
  p_id uuid,
  p_fingerprint text
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'external_source_record_version_v1',
    'id', p_id,
    'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
    'connectionId', 'e8b00000-0000-4000-8000-000000000001',
    'immutableVersion', 1,
    'priorVersionId', null,
    'recordKind', 'qbo_invoice',
    'source', pg_catalog.jsonb_build_object(
      'kind', 'provider',
      'providerKey', 'quickbooks_online',
      'providerRecordType', 'Invoice',
      'providerRecordId', 'phase8b-sandbox-invoice-1',
      'providerVersionReference', '1'
    ),
    'temporal', pg_catalog.jsonb_build_object(
      'basis', 'event',
      'providerCreatedAt', '2026-08-22T20:00:00.000Z',
      'providerUpdatedAt', '2026-08-22T20:00:00.000Z',
      'observedAt', '2026-08-22T20:00:01.000Z',
      'synchronizedAt', '2026-08-22T20:00:02.000Z',
      'ingestedAt', '2026-08-22T20:00:03.000Z',
      'effectiveAt', '2026-08-22T00:00:00.000Z',
      'postingDate', '2026-08-22',
      'periodStart', null,
      'periodEnd', null,
      'sourceTimeZone', null
    ),
    'accounting', pg_catalog.jsonb_build_object(
      'basis', 'accrual',
      'currency', 'USD'
    ),
    'normalizedSchemaVersion', 'qbo_minimizer_v1',
    'changeKind', 'created',
    'normalizedProjection', pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_source_record_minimized_v1',
      'provider', pg_catalog.jsonb_build_object(
        'providerKey', 'quickbooks_online',
        'realmId', 'phase8b-sandbox-realm',
        'sourceEnvironment', 'sandbox'
      ),
      'recordType', 'Invoice',
      'id', 'phase8b-sandbox-invoice-1',
      'displayName', null,
      'active', null,
      'status', 'active',
      'metadata', pg_catalog.jsonb_build_object(
        'providerCreatedAt', '2026-08-22T20:00:00.000Z',
        'providerUpdatedAt', '2026-08-22T20:00:00.000Z',
        'syncToken', '1'
      ),
      'temporal', pg_catalog.jsonb_build_object(
        'postingDate', '2026-08-22',
        'providerCreatedAt', '2026-08-22T20:00:00.000Z',
        'providerUpdatedAt', '2026-08-22T20:00:00.000Z'
      ),
      'accounting', pg_catalog.jsonb_build_object(
        'basis', 'unknown',
        'sourceCurrency', 'USD',
        'homeCurrency', null,
        'exchangeRate', '1'
      ),
      'relationships', '{}'::jsonb,
      'amounts', pg_catalog.jsonb_build_object(
        'total', pg_catalog.jsonb_build_object('amount', '1250', 'currency', 'USD')
      ),
      'lines', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'lineId', '1',
          'detailType', 'SalesItemLineDetail',
          'amount', pg_catalog.jsonb_build_object('amount', '1250', 'currency', 'USD'),
          'postingType', null,
          'itemRef', pg_catalog.jsonb_build_object('value', '301', 'name', 'Service'),
          'accountRef', pg_catalog.jsonb_build_object('value', '401', 'name', 'Revenue'),
          'entityRef', null
        )
      ),
      'providerVersionReference', '1',
      'minimizationVersion', 'qbo_minimizer_v1'
    ),
    'trust', 'untrusted_external_input',
    'validation', pg_catalog.jsonb_build_object(
      'state', 'pending',
      'validatorVersion', 'qbo_phase_7_contract_validator_v1',
      'issues', pg_catalog.jsonb_build_array()
    ),
    'receivedAt', '2026-08-22T20:00:04.000Z',
    'sourceFingerprint', p_fingerprint
  );
$function$;

create or replace function pg_temp.validated_version(
  p_pending jsonb,
  p_id uuid,
  p_fingerprint text,
  p_workspace_id uuid default 'b8b00000-0000-4000-8000-000000000001'
)
returns jsonb
language sql
as $function$
  select p_pending || pg_catalog.jsonb_build_object(
    'id', p_id,
    'workspaceId', p_workspace_id,
    'immutableVersion', 2,
    'priorVersionId', p_pending ->> 'id',
    'changeKind', 'unchanged',
    'validation', pg_catalog.jsonb_build_object(
      'state', 'valid',
      'validatorVersion', 'qbo_phase_8b_deterministic_validator_v1',
      'issues', pg_catalog.jsonb_build_array()
    ),
    'receivedAt', '2026-08-22T20:00:05.000Z',
    'sourceFingerprint', p_fingerprint
  );
$function$;

create or replace function pg_temp.deleted_pending_version(
  p_id uuid,
  p_prior_id uuid,
  p_fingerprint text
)
returns jsonb
language sql
as $function$
  select pg_temp.pending_version(p_id, p_fingerprint) ||
    pg_catalog.jsonb_build_object(
      'immutableVersion', 3,
      'priorVersionId', p_prior_id,
      'changeKind', 'deleted',
      'normalizedProjection', null,
      'receivedAt', '2026-08-22T20:00:06.000Z'
    );
$function$;

create or replace function pg_temp.validated_deleted_version(
  p_pending jsonb,
  p_id uuid,
  p_fingerprint text
)
returns jsonb
language sql
as $function$
  select p_pending || pg_catalog.jsonb_build_object(
    'id', p_id,
    'immutableVersion', 4,
    'priorVersionId', p_pending ->> 'id',
    'changeKind', 'deleted',
    'normalizedProjection', null,
    'validation', pg_catalog.jsonb_build_object(
      'state', 'quarantined',
      'validatorVersion', 'qbo_phase_8b_deterministic_validator_v1',
      'issues', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'qbo_deleted_source_requires_review',
          'severity', 'error',
          'field', null,
          'detail',
            'Deleted QBO sources require exact prior fact lineage review.'
        )
      )
    ),
    'receivedAt', '2026-08-22T20:00:07.000Z',
    'sourceFingerprint', p_fingerprint
  );
$function$;

create or replace function pg_temp.source_state_command(
  p_task_id uuid default '38000000-0000-4000-8000-000000008b01',
  p_lease_id uuid default '48000000-0000-4000-8000-000000008b01',
  p_mapping_id uuid default 'f8b00000-0000-4000-8000-000000000001',
  p_record_id text default 'phase8b-sandbox-invoice-1'
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_source_state_read_v1',
    'taskId', p_task_id,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-runtime-owner'),
    'mappingId', p_mapping_id,
    'providerRecordType', 'Invoice',
    'providerRecordId', p_record_id
  );
$function$;

create or replace function pg_temp.runtime_completion_command(
  p_workspace_id uuid default 'b8b00000-0000-4000-8000-000000000001',
  p_child_task_id uuid default '98000000-0000-4000-8000-000000008b01',
  p_effect text default 'phase8b-page-effect'
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'completion', pg_catalog.jsonb_build_object(
      'workspaceId', p_workspace_id,
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', '38000000-0000-4000-8000-000000008b01',
      'expectedRowVersion', 3,
      'leaseId', '48000000-0000-4000-8000-000000008b01',
      'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-runtime-owner'),
      'durableEffectFingerprint', pg_temp.fingerprint(p_effect),
      'checkpoint', pg_catalog.jsonb_build_object(
        'checkpointId', '88000000-0000-4000-8000-000000008b01',
        'expectedCheckpointVersion', 0,
        'streamKey', 'qbo_invoice',
        'checkpointKind', 'cursor',
        'cursorVersion', 1,
        'cursor', pg_catalog.jsonb_build_object(
          'protocolVersion', 'integration_sync_checkpoint_v1',
          'cursorKind', 'cursor',
          'cursorValue', 'start_501',
          'windowStartAt', null,
          'windowEndAt', null
        ),
        'cursorFingerprint', pg_temp.fingerprint('phase8b-page-cursor'),
        'providerWatermarkAt', '2026-08-22T20:05:00.000Z',
        'overlapSeconds', 300,
        'fullReconciliation', false,
        'downstreamCommitFingerprint', pg_temp.fingerprint(p_effect)
      )
    ),
    'continuation', pg_catalog.jsonb_build_object(
      'kind', 'next_page',
      'childTaskId', p_child_task_id
    )
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a8b00000-0000-4000-8000-000000000001', 'phase8b-owner@example.test', 'Phase 8B Owner');
insert into public.workspaces (id, name, created_by) values
  ('b8b00000-0000-4000-8000-000000000001', 'Phase 8B Workspace', 'a8b00000-0000-4000-8000-000000000001');
insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c8b00000-0000-4000-8000-000000000001', 'b8b00000-0000-4000-8000-000000000001', 'a8b00000-0000-4000-8000-000000000001', 'owner', 'active');
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8b00000-0000-4000-8000-000000000001',
  'b8b00000-0000-4000-8000-000000000001', 'business_entity_v1',
  'phase8b_sandbox_company', 'operating_company', 'Phase 8B Sandbox Company',
  'USD', 'UTC', 1, 'active', 'a8b00000-0000-4000-8000-000000000001',
  'a8b00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
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
  'e8b00000-0000-4000-8000-000000000001',
  'integration_connection_v1', 'integration_connection_control_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001', 1,
  'quickbooks_online', 'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-sandbox-realm'),
  'initializing', 'initial_sync_pending', array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[], 'Phase 8B QBO Sandbox',
  'vaeroex_provider_descriptors_v1',
  pg_catalog.decode('6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758', 'hex'),
  pg_catalog.decode('e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac', 'hex'),
  'qbo_provider_adapter_v1',
  pg_catalog.jsonb_build_object(
    'operations', pg_catalog.jsonb_build_array('get_capabilities', 'get_source_record', 'list_entities', 'list_source_records'),
    'domains', pg_catalog.jsonb_build_array('change_hints', 'company_configuration', 'financial_transactions', 'master_records', 'report_control_observations'),
    'requiredStreamKeys', pg_catalog.jsonb_build_array('accounts', 'company_info', 'preferences', 'qbo_apagingsummary', 'qbo_aragingsummary', 'qbo_balancesheet', 'qbo_bill', 'qbo_billpayment', 'qbo_cashflow', 'qbo_creditmemo', 'qbo_deposit', 'qbo_invoice', 'qbo_journalentry', 'qbo_payment', 'qbo_profitandloss', 'qbo_purchase', 'qbo_refundreceipt', 'qbo_salesreceipt', 'qbo_transfer', 'qbo_trialbalance', 'qbo_vendorcredit'),
    'supportsBackfill', true, 'webhookMode', 'change_hints', 'incrementalMode', 'cursor'
  ),
  1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
  1, 'a8b00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, provider_key, provider_environment,
  provider_entity_type, provider_entity_reference_fingerprint,
  safe_display_name, mapping_role, status, verification_mode,
  verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
  created_at, updated_at
) values (
  'f8b00000-0000-4000-8000-000000000001', 'provider_entity_mapping_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001',
  'f8b00000-0000-4000-8000-000000000001', 1,
  'quickbooks_online', 'sandbox', 'company',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-sandbox-realm'),
  'Phase 8B Sandbox Company', 'primary', 'active', 'qbo_realm_mapping_v1',
  extensions.digest(pg_catalog.convert_to('phase8b-company-verified', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp(), 'a8b00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp(), 1,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
);

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status,
  creation_request_id, creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at,
  row_version
) values (
  '18000000-0000-4000-8000-000000008b01',
  'integration_oauth_state_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001', 1,
  'quickbooks_online', 'sandbox',
  'a8b00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  '/phase8b/sandbox/authorized',
  extensions.digest(pg_catalog.convert_to('phase8b-oauth-state', 'UTF8'), 'sha256'),
  'consumed', 'phase8b_oauth_create',
  extensions.digest(pg_catalog.convert_to('phase8b-oauth-create', 'UTF8'), 'sha256'),
  'phase8b_oauth_consume',
  extensions.digest(pg_catalog.convert_to('phase8b-oauth-consume', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() - interval '2 minutes',
  pg_catalog.transaction_timestamp() + interval '8 minutes',
  pg_catalog.transaction_timestamp() - interval '1 minute', 2
);

insert into private.integration_credentials (
  id, contract_version, oauth_state_id, workspace_id, business_entity_id,
  connection_id, connection_generation, provider_key,
  provider_environment, initiated_by, credential_version,
  envelope_schema_version, aad_schema_version, aad_digest,
  kms_key_resource, credential_ciphertext, access_expires_at,
  refresh_expires_at, granted_scopes,
  external_entity_reference_fingerprint, status, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at
) values (
  '78000000-0000-4000-8000-000000008b01',
  'integration_credential_authority_v1',
  '18000000-0000-4000-8000-000000008b01',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001', 1,
  'quickbooks_online', 'sandbox',
  'a8b00000-0000-4000-8000-000000000001', 1,
  'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b8b00000-0000-4000-8000-000000000001',
    'e8b00000-0000-4000-8000-000000000001',
    1, 'quickbooks_online',
    '78000000-0000-4000-8000-000000008b01'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('c', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() + interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-sandbox-realm'),
  'active', 'phase8b_credential_store',
  extensions.digest(pg_catalog.convert_to('phase8b-credential-store', 'UTF8'), 'sha256'),
  1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
);

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, provider_contract_version, adapter_version,
  policy_version, records_observed, records_accepted, records_rejected,
  facts_accepted, contributions_changed, created_at, started_at, row_version,
  updated_at
) values (
  '28000000-0000-4000-8000-000000008b01', 'integration_sync_run_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001',
  'f8b00000-0000-4000-8000-000000000001', 1,
  'provider_initialization', 'initialization', 'running',
  extensions.digest(pg_catalog.convert_to('phase8b-run', 'UTF8'), 'sha256'),
  'provider_adapter_v1', 'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(), 2,
  pg_catalog.transaction_timestamp()
);

insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatcher_task_name,
  dispatch_generation, delivery_attribution_state,
  last_delivery_dispatch_generation,
  last_delivery_execution_count,
  last_delivery_attempt_fingerprint, attempt_count, maximum_attempts,
  last_request_id, last_request_fingerprint, available_at,
  lease_id, lease_owner_fingerprint, lease_expires_at,
  heartbeat_at, row_version, created_at, updated_at, retention_expires_at
) values (
  '38000000-0000-4000-8000-000000008b01', 'integration_sync_task_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001', 1,
  '28000000-0000-4000-8000-000000008b01',
  'quickbooks_online', 'sandbox', 'provider_interactive', 'incremental',
  'qbo_invoice', 'leased', 50,
  pg_catalog.jsonb_build_object(
    'checkpointId', '88000000-0000-4000-8000-000000008b01',
    'mappingId', 'f8b00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_database_test',
    'recordHintCount', 1,
    'coalescedEventCount', 1
  ),
  extensions.digest(pg_catalog.convert_to('phase8b-task', 'UTF8'), 'sha256'),
  extensions.digest(pg_catalog.convert_to('phase8b-task-coalesce', 'UTF8'), 'sha256'),
  pg_catalog.repeat('a', 64), 1, 'attributed', 1, 0,
  extensions.digest(pg_catalog.convert_to('phase8b-delivery', 'UTF8'), 'sha256'),
  1, 3, 'phase8b_task_fixture',
  extensions.digest(pg_catalog.convert_to('phase8b-task-fixture', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp(),
  '48000000-0000-4000-8000-000000008b01',
  extensions.digest(pg_catalog.convert_to('phase8b-runtime-owner', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() + interval '10 minutes',
  pg_catalog.transaction_timestamp(), 3,
  pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp() + interval '7 days'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_provider_validation_authority'
      and not rolcanlogin and not rolinherit
  ),
  'provider validation authority is NOLOGIN and NOINHERIT'
);
select ok(
  not pg_catalog.pg_has_role('service_role', 'integration_provider_validation_authority', 'MEMBER'),
  'service_role has no provider validation membership'
);
select ok(
  not has_schema_privilege('integration_provider_validation_authority', 'private', 'USAGE'),
  'provider validation authority has no private schema usage'
);
select ok(
  not has_table_privilege('integration_provider_validation_authority', 'private.external_source_record_versions', 'SELECT,INSERT,UPDATE,DELETE'),
  'provider validation authority has no direct source-version DML'
);
select ok(
  has_function_privilege('integration_provider_validation_authority', 'public.validate_provider_external_source_record_version_v1(jsonb,text)', 'EXECUTE')
  and has_function_privilege('integration_provider_validation_authority', 'public.read_qbo_sandbox_pending_source_versions_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('integration_provider_validation_authority', 'public.read_qbo_sandbox_current_valid_source_versions_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.validate_provider_external_source_record_version_v1(jsonb,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_pending_source_versions_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_current_valid_source_versions_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.validate_provider_external_source_record_version_v1(jsonb,text)', 'EXECUTE'),
  'validation read and append RPC execution is narrowly granted'
);
select ok(
  has_function_privilege('integration_provider_source_authority', 'public.read_provider_external_source_record_state_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_provider_external_source_record_state_v1(jsonb)', 'EXECUTE'),
  'provider state read execution remains source-authority only'
);
select ok(
  has_function_privilege('integration_provider_runtime_authority', 'public.read_qbo_sandbox_runtime_task_delivery_v1(uuid,text)', 'EXECUTE')
  and has_function_privilege('integration_provider_runtime_authority', 'public.complete_qbo_sandbox_runtime_task_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.complete_qbo_sandbox_runtime_task_v1(jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('integration_task_dispatch_authority', 'public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)', 'EXECUTE')
  and has_function_privilege('integration_task_dispatch_authority', 'public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('integration_task_dispatch_authority', 'public.reserve_qbo_sandbox_scoped_dispatch_task_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('integration_task_dispatch_authority', 'public.read_qbo_sandbox_dispatch_candidates_v1(integer)', 'EXECUTE')
  and not has_function_privilege('integration_task_dispatch_authority', 'public.discover_integration_sync_dispatch_v1(text,integer)', 'EXECUTE')
  and not has_function_privilege('integration_task_dispatch_authority', 'public.discover_integration_sync_due_work_v1(timestamptz,integer)', 'EXECUTE')
  and not has_function_privilege('integration_task_dispatch_authority', 'public.sweep_integration_sync_tasks_v1(integer,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.reserve_qbo_sandbox_scoped_dispatch_task_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_dispatch_candidates_v1(integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_runtime_task_delivery_v1(uuid,text)', 'EXECUTE')
  and not has_function_privilege('integration_provider_source_authority', 'public.read_qbo_sandbox_runtime_task_delivery_v1(uuid,text)', 'EXECUTE'),
  'QBO delivery, continuation, and dispatch discovery remain narrowly separated'
);
select ok(
  not has_function_privilege('integration_provider_validation_authority', 'public.commit_canonical_business_fact_version_v2(text,jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('integration_provider_validation_authority', 'public.commit_reconciliation_case_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('integration_provider_validation_authority', 'public.commit_fact_contribution_batch_v1(jsonb,text,text)', 'EXECUTE'),
  'validation authority cannot create facts, reconciliation, or contributions'
);
select ok(
  has_function_privilege('integration_credential_broker_authority', 'public.read_qbo_sandbox_authorization_recovery_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.read_qbo_sandbox_authorization_recovery_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('integration_provider_runtime_authority', 'public.read_qbo_sandbox_authorization_recovery_v1(jsonb)', 'EXECUTE'),
  'authorization recovery remains broker-only with no service_role or runtime shortcut'
);

set local role integration_credential_broker_authority;
select is(
  public.read_qbo_sandbox_authorization_recovery_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_authorization_recovery_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'mappingId', 'f8b00000-0000-4000-8000-000000000001'
    )
  ) ->> 'connectionStatus',
  'initializing',
  'broker recovery reads only the resumable QBO sandbox connection state'
);
select is(
  public.read_qbo_sandbox_authorization_recovery_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_authorization_recovery_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'mappingId', 'f8b00000-0000-4000-8000-000000000001'
    )
  ) #>> '{mapping,status}',
  'active',
  'recovery observes the exact trusted mapping without exposing realm plaintext'
);
select ok(
  pg_catalog.length(
    public.read_qbo_sandbox_authorization_recovery_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_authorization_recovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'mappingId', 'f8b00000-0000-4000-8000-000000000001'
      )
    ) #>> '{credential,ciphertextBase64}'
  ) > 76
  and pg_catalog.strpos(
    public.read_qbo_sandbox_authorization_recovery_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_authorization_recovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'mappingId', 'f8b00000-0000-4000-8000-000000000001'
      )
    ) #>> '{credential,ciphertextBase64}',
    E'\n'
  ) = 0,
  'long recovery ciphertext remains canonical unbroken base64'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_authorization_recovery_v1(
      jsonb_build_object(
        'contractVersion', 'qbo_sandbox_authorization_recovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000099',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'mappingId', 'f8b00000-0000-4000-8000-000000000001'
      )
    )$$,
    '42501'
  ),
  'authorization recovery rejects cross-workspace substitution without disclosure'
);
reset role;

set local role integration_provider_runtime_authority;
select is(
  public.read_qbo_sandbox_runtime_task_delivery_v1(
    '38000000-0000-4000-8000-000000008b01',
    pg_catalog.repeat('a', 64)
  ) ->> 'rowVersion',
  '3',
  'opaque task delivery resolves the current CAS row version'
);
select is(
  public.read_qbo_sandbox_runtime_task_delivery_v1(
    '38000000-0000-4000-8000-000000008b01',
    pg_catalog.repeat('a', 64)
  ) ->> 'credentialVersion',
  '1',
  'opaque task delivery resolves only the current safe credential identity/version'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_runtime_task_delivery_v1(
      '38000000-0000-4000-8000-000000008b01',
      pg_catalog.repeat('b', 64)
    )$$,
    '42501'
  ),
  'dispatcher task substitution is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_runtime_task_delivery_v1(
      '38000000-0000-4000-8000-000000008b01',
      'malformed-task-name'
    )$$,
    '22023'
  ),
  'malformed Cloud Tasks short names are rejected before lookup'
);
reset role;

set local role integration_provider_source_authority;
select is(
  public.read_provider_external_source_record_state_v1(pg_temp.source_state_command()) ->> 'state',
  'missing',
  'provider runtime sees no fabricated source before commit'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_commit_v1',
        'taskId', '38000000-0000-4000-8000-000000008b01',
        'leaseId', '48000000-0000-4000-8000-000000008b01',
        'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-runtime-owner'),
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'sourceIdentityFingerprint',
          pg_temp.fingerprint('phase8b-substituted-realm-identity'),
        'version', jsonb_set(
          pg_temp.pending_version(
            '58000000-0000-4000-8000-000000008b99',
            pg_temp.fingerprint('phase8b-substituted-realm-source')
          ),
          '{normalizedProjection,provider,realmId}',
          '"substituted-realm"'::jsonb
        )
      ),
      'phase8b_substituted_realm_commit'
    )$$,
    '42501'
  ),
  'provider source commit rejects a realm substituted beneath trusted task and mapping authority'
);
select is(
  public.commit_provider_external_source_record_version_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_source_commit_v1',
      'taskId', '38000000-0000-4000-8000-000000008b01',
      'leaseId', '48000000-0000-4000-8000-000000008b01',
      'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-runtime-owner'),
      'mappingId', 'f8b00000-0000-4000-8000-000000000001',
      'sourceIdentityFingerprint', pg_temp.fingerprint('phase8b-invoice-identity'),
      'version', pg_temp.pending_version(
        '58000000-0000-4000-8000-000000008b01',
        pg_temp.fingerprint('phase8b-pending-source')
      )
    ),
    'phase8b_source_commit'
  ) ->> 'validationState',
  'pending',
  'provider source authority can commit only a pending source version'
);
select is(
  public.read_provider_external_source_record_state_v1(pg_temp.source_state_command()) ->> 'validationState',
  'pending',
  'scoped state read returns the current pending version'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_provider_external_source_record_state_v1(
      pg_temp.source_state_command(
        p_mapping_id => 'f8b00000-0000-4000-8000-000000000099'
      )
    )$$,
    '42501'
  ),
  'mapping substitution is denied without existence disclosure'
);
reset role;

set local role integration_provider_validation_authority;
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_pending_source_versions_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'integration_provider_pending_source_read_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'maximumResults', 10
      )
    )
  )::text,
  '1',
  'validation authority reads only current pending minimized QBO sources'
);
select is(
  public.read_qbo_sandbox_pending_source_versions_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_pending_source_read_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'mappingId', 'f8b00000-0000-4000-8000-000000000001',
      'maximumResults', 10
    )
  ) -> 0 -> 'pendingVersion' -> 'validation' ->> 'state',
  'pending',
  'pending-source reader reconstructs the checked external-source contract'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_pending_source_versions_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_pending_source_read_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000099',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'maximumResults', 10
      )
    )$$,
    '42501'
  ),
  'pending-source reader rejects workspace substitution without disclosure'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
        'validatedVersion', jsonb_set(
          pg_temp.validated_version(
            pg_temp.pending_version(
              '58000000-0000-4000-8000-000000008b01',
              pg_temp.fingerprint('phase8b-pending-source')
            ),
            '68000000-0000-4000-8000-000000008b10',
            pg_temp.fingerprint('phase8b-malformed-projection')
          ),
          '{normalizedProjection,lines}',
          '"not-an-array"'::jsonb
        )
      ),
      'phase8b_malformed_projection'
    )$$,
    '22023'
  ),
  'malformed minimized provider projections are rejected before validation authority'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
        'validatedVersion', jsonb_set(
          pg_temp.validated_version(
            pg_temp.pending_version(
              '58000000-0000-4000-8000-000000008b01',
              pg_temp.fingerprint('phase8b-pending-source')
            ),
            '68000000-0000-4000-8000-000000008b12',
            pg_temp.fingerprint('phase8b-null-status')
          ),
          '{normalizedProjection,status}',
          'null'::jsonb
        )
      ),
      'phase8b_null_status'
    )$$,
    '22023'
  ),
  'nullable projection predicates fail closed instead of bypassing validation'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
        'validatedVersion', jsonb_set(
          pg_temp.validated_version(
            pg_temp.pending_version(
              '58000000-0000-4000-8000-000000008b01',
              pg_temp.fingerprint('phase8b-pending-source')
            ),
            '68000000-0000-4000-8000-000000008b11',
            pg_temp.fingerprint('phase8b-timestamp-substitution')
          ),
          '{temporal,synchronizedAt}',
          '"2026-08-22T20:00:09.000Z"'::jsonb
        )
      ),
      'phase8b_timestamp_substitution'
    )$$,
    '42501'
  ),
  'validator cannot substitute trusted synchronization or ingestion timestamps'
);
select is(
  public.validate_provider_external_source_record_version_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_source_validation_v1',
      'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
      'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
      'validatedVersion', pg_temp.validated_version(
        pg_temp.pending_version(
          '58000000-0000-4000-8000-000000008b01',
          pg_temp.fingerprint('phase8b-pending-source')
        ),
        '68000000-0000-4000-8000-000000008b01',
        pg_temp.fingerprint('phase8b-valid-source')
      )
    ),
    'phase8b_validate_source'
  ) ->> 'validationState',
  'valid',
  'deterministic validation appends a valid immutable version'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_current_valid_source_versions_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'integration_provider_current_valid_source_read_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'maximumResults', 10
      )
    )
  )::text,
  '1',
  'current-valid feed preserves mapping authority across later incremental batches'
);
select is(
  public.read_qbo_sandbox_current_valid_source_versions_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_current_valid_source_read_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'mappingId', 'f8b00000-0000-4000-8000-000000000001',
      'maximumResults', 10
    )
  ) -> 0 -> 'sourceVersion' -> 'validation' ->> 'state',
  'valid',
  'current-valid reader reconstructs only checked immutable source versions'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_pending_source_versions_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'integration_provider_pending_source_read_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'maximumResults', 10
      )
    )
  )::text,
  '0',
  'validated current sources no longer appear in the pending work feed'
);
select is(
  public.validate_provider_external_source_record_version_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_source_validation_v1',
      'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
      'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
      'validatedVersion', pg_temp.validated_version(
        pg_temp.pending_version(
          '58000000-0000-4000-8000-000000008b01',
          pg_temp.fingerprint('phase8b-pending-source')
        ),
        '68000000-0000-4000-8000-000000008b01',
        pg_temp.fingerprint('phase8b-valid-source')
      )
    ),
    'phase8b_validate_source'
  ) ->> 'idempotent',
  'true',
  'the same validation append is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', 'not-a-fingerprint',
        'validatedVersion', '{}'::jsonb
      ),
      'phase8b_bad_hash'
    )$$,
    '22023'
  ),
  'malformed source fingerprints are rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
        'validatedVersion', pg_temp.validated_version(
          pg_temp.pending_version(
            '58000000-0000-4000-8000-000000008b01',
            pg_temp.fingerprint('phase8b-pending-source')
          ),
          '68000000-0000-4000-8000-000000008b01',
          pg_temp.fingerprint('phase8b-valid-source'),
          'b8b00000-0000-4000-8000-000000000099'
        )
      ),
      'phase8b_cross_workspace'
    )$$,
    '42501'
  ),
  'workspace substitution is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_provider_external_source_record_version_v1(
      jsonb_build_object(
        'contractVersion', 'integration_provider_source_validation_v1',
        'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b01',
        'expectedPendingSourceFingerprint', pg_temp.fingerprint('phase8b-pending-source'),
        'validatedVersion', pg_temp.validated_version(
          pg_temp.pending_version(
            '58000000-0000-4000-8000-000000008b01',
            pg_temp.fingerprint('phase8b-pending-source')
          ),
          '68000000-0000-4000-8000-000000008b03',
          pg_temp.fingerprint('phase8b-stale-worker')
        )
      ),
      'phase8b_stale_worker'
    )$$,
    '40001'
  ),
  'a stale validator cannot replace the current immutable version'
);
reset role;

set local role integration_provider_source_authority;
select is(
  public.commit_provider_external_source_record_version_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_source_commit_v1',
      'taskId', '38000000-0000-4000-8000-000000008b01',
      'leaseId', '48000000-0000-4000-8000-000000008b01',
      'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-runtime-owner'),
      'mappingId', 'f8b00000-0000-4000-8000-000000000001',
      'sourceIdentityFingerprint', pg_temp.fingerprint('phase8b-invoice-identity'),
      'version', pg_temp.deleted_pending_version(
        '58000000-0000-4000-8000-000000008b02',
        '68000000-0000-4000-8000-000000008b01',
        pg_temp.fingerprint('phase8b-deleted-pending-source')
      )
    ),
    'phase8b_deleted_source_commit'
  ) ->> 'validationState',
  'pending',
  'provider deletion first persists as an immutable pending source version'
);
reset role;

set local role integration_provider_validation_authority;
select is(
  public.validate_provider_external_source_record_version_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_source_validation_v1',
      'pendingSourceVersionId', '58000000-0000-4000-8000-000000008b02',
      'expectedPendingSourceFingerprint',
        pg_temp.fingerprint('phase8b-deleted-pending-source'),
      'validatedVersion', pg_temp.validated_deleted_version(
        pg_temp.deleted_pending_version(
          '58000000-0000-4000-8000-000000008b02',
          '68000000-0000-4000-8000-000000008b01',
          pg_temp.fingerprint('phase8b-deleted-pending-source')
        ),
        '68000000-0000-4000-8000-000000008b02',
        pg_temp.fingerprint('phase8b-deleted-quarantined-source')
      )
    ),
    'phase8b_validate_deleted_source'
  ) ->> 'validationState',
  'quarantined',
  'deletion validation appends an immutable quarantined decision'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_pending_source_versions_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'integration_provider_pending_source_read_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'mappingId', 'f8b00000-0000-4000-8000-000000000001',
        'maximumResults', 10
      )
    )
  )::text,
  '0',
  'validated deletions cannot starve the pending validation feed'
);
reset role;

set local role integration_provider_runtime_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.complete_qbo_sandbox_runtime_task_v1(
      pg_temp.runtime_completion_command(
        p_workspace_id => 'b8b00000-0000-4000-8000-000000000099'
      ),
      'phase8b_cross_workspace_completion',
      'phase8b_provider_runtime'
    )$$,
    '42501'
  ),
  'provider runtime cannot substitute workspace scope while creating continuation work'
);
select is(
  public.complete_qbo_sandbox_runtime_task_v1(
    pg_temp.runtime_completion_command(),
    'phase8b_complete_page',
    'phase8b_provider_runtime'
  ) ->> 'continuationCreated',
  'true',
  'page completion and its derived continuation commit atomically'
);
select is(
  public.complete_qbo_sandbox_runtime_task_v1(
    pg_temp.runtime_completion_command(),
    'phase8b_complete_page',
    'phase8b_provider_runtime'
  ) ->> 'continuationCreated',
  'false',
  'completion replay reuses exactly one continuation task'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.complete_qbo_sandbox_runtime_task_v1(
      pg_temp.runtime_completion_command(
        p_child_task_id => '98000000-0000-4000-8000-000000008b99'
      ),
      'phase8b_complete_page',
      'phase8b_provider_runtime'
    )$$,
    '23505'
  ),
  'a replay cannot substitute a different continuation task identity'
);
reset role;

select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '38000000-0000-4000-8000-000000008b01'
  ),
  'succeeded',
  'the parent page is durably complete'
);
select is(
  (
    select pg_catalog.concat_ws(
      ':',
      state,
      parent_task_id::text,
      control_metadata ->> 'pageOrdinal',
      control_metadata ->> 'cursorVersion',
      control_metadata ->> 'reasonCode'
    )
    from private.integration_sync_tasks
    where id = '98000000-0000-4000-8000-000000008b01'
  ),
  'pending:38000000-0000-4000-8000-000000008b01:1:1:qbo_page_continuation',
  'continuation scope and cursor are derived from the completed parent'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where parent_task_id = '38000000-0000-4000-8000-000000008b01'
  ),
  '1',
  'completion replay cannot duplicate durable page work'
);

set local role integration_task_dispatch_authority;
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'maximumTasks', 10
      )
    )
  )::text,
  '1',
  'dispatcher discovers the derived pending page without private table access'
);
select is(
  public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'maximumTasks', 10
    )
  )
    -> 0 ->> 'taskId',
  '98000000-0000-4000-8000-000000008b01',
  'dispatcher discovery returns only the expected QBO sandbox continuation'
);
reset role;

-- Add twenty-three more valid tasks for the configured connection. Together
-- with the derived continuation above, the trusted scope contains exactly 24.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatch_generation,
  last_delivery_execution_count, attempt_count, maximum_attempts,
  available_at, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at, retention_expires_at
)
select
  ('a8c00000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'integration_sync_task_v1',
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8b00000-0000-4000-8000-000000000001', 1,
  '28000000-0000-4000-8000-000000008b01',
  'quickbooks_online', 'sandbox', 'provider_bulk', 'initial_historical',
  'qbo_invoice',
  case when series.value = 2 then 'retry_wait' else 'pending' end,
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8b00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', '2026-01-01T00:00:00.000Z',
    'windowEndAt', '2026-01-31T23:59:59.999Z',
    'reasonCode', 'phase8b_scoped_dispatch_test',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-scoped-task-' || series.value::text, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-scoped-coalescing-' || series.value::text, 'UTF8'),
    'sha256'
  ),
  0, null, 0, 3,
  pg_catalog.transaction_timestamp(),
  'phase8b_scoped_task_' || series.value::text,
  extensions.digest(
    pg_catalog.convert_to('phase8b-scoped-request-' || series.value::text, 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp() + interval '7 days'
from pg_catalog.generate_series(2, 24) as series(value);

insert into public.workspaces (id, name, created_by) values (
  'b8c00000-0000-4000-8000-000000000001',
  'Phase 8B Unrelated Fixture Workspace',
  'a8b00000-0000-4000-8000-000000000001'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values
  (
    'd8c00000-0000-4000-8000-000000000001',
    'b8c00000-0000-4000-8000-000000000001', 'business_entity_v1',
    'phase8b_unrelated_fixture', 'operating_company',
    'Phase 8B Unrelated Fixture', 'USD', 'UTC', 1, 'active',
    'a8b00000-0000-4000-8000-000000000001',
    'a8b00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  ),
  (
    'd8c00000-0000-4000-8000-000000000002',
    'b8b00000-0000-4000-8000-000000000001', 'business_entity_v1',
    'phase8b_wrong_entity_fixture', 'operating_company',
    'Phase 8B Wrong Entity Fixture', 'USD', 'UTC', 1, 'active',
    'a8b00000-0000-4000-8000-000000000001',
    'a8b00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  );

create or replace function pg_temp.seed_dispatch_fixture(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_run_id uuid,
  p_task_id uuid,
  p_suffix text,
  p_state text
)
returns void
language plpgsql
as $function$
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
  )
  select
    p_connection_id, connection.contract_version,
    connection.control_contract_version, p_workspace_id,
    p_business_entity_id, p_connection_id, 1,
    connection.provider_key, connection.provider_environment,
    connection.provider_tenant_reference_fingerprint,
    'initializing', 'initial_sync_pending', connection.requested_scopes,
    connection.granted_scopes, 'Phase 8B Scoped Fixture ' || p_suffix,
    connection.provider_descriptor_registry_version,
    connection.provider_descriptor_registry_fingerprint,
    connection.provider_descriptor_fingerprint, connection.adapter_version,
    connection.capability_snapshot, 1, pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp(), 1,
    'a8b00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
  from private.integration_connections as connection
  where connection.id = 'e8b00000-0000-4000-8000-000000000001';

  insert into private.integration_sync_runs (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    mapping_id, connection_generation, trigger_kind, mode, state,
    idempotency_fingerprint, provider_contract_version, adapter_version,
    policy_version, records_observed, records_accepted, records_rejected,
    facts_accepted, contributions_changed, created_at, started_at,
    row_version, updated_at
  ) values (
    p_run_id, 'integration_sync_run_v1', p_workspace_id,
    p_business_entity_id, p_connection_id, null, 1,
    'recovery', 'incremental', 'running',
    extensions.digest(
      pg_catalog.convert_to('phase8b-fixture-run-' || p_suffix, 'UTF8'),
      'sha256'
    ),
    'provider_adapter_v1', 'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0,
    pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    2, pg_catalog.transaction_timestamp()
  );

  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, provider_key, provider_environment,
    queue_class, task_kind, stream_key, state, priority, control_metadata,
    idempotency_fingerprint, coalescing_fingerprint, dispatch_generation,
    last_delivery_execution_count, attempt_count, maximum_attempts,
    available_at, last_request_id, last_request_fingerprint, row_version,
    created_at, updated_at, retention_expires_at
  ) values (
    p_task_id, 'integration_sync_task_v1', p_workspace_id,
    p_business_entity_id, p_connection_id, 1, p_run_id,
    'quickbooks_online', 'sandbox', 'provider_bulk', 'incremental',
    'qbo_invoice', p_state, 100,
    pg_catalog.jsonb_build_object(
      'checkpointId', null, 'mappingId', null, 'eventId', null,
      'pageOrdinal', 0, 'cursorVersion', 0,
      'windowStartAt', null, 'windowEndAt', null,
      'reasonCode', 'phase8b_unrelated_fixture',
      'recordHintCount', 0, 'coalescedEventCount', 1
    ),
    extensions.digest(
      pg_catalog.convert_to('phase8b-fixture-task-' || p_suffix, 'UTF8'),
      'sha256'
    ),
    extensions.digest(
      pg_catalog.convert_to('phase8b-fixture-coalescing-' || p_suffix, 'UTF8'),
      'sha256'
    ),
    0, null, 0, 3, pg_catalog.transaction_timestamp(),
    'phase8b_fixture_task_' || p_suffix,
    extensions.digest(
      pg_catalog.convert_to('phase8b-fixture-request-' || p_suffix, 'UTF8'),
      'sha256'
    ),
    1, pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp() + interval '7 days'
  );
end;
$function$;

select pg_temp.seed_dispatch_fixture(
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  'e8c00000-0000-4000-8000-000000000001',
  '28c00000-0000-4000-8000-000000000001',
  '38c00000-0000-4000-8000-000000000001',
  'cross_workspace',
  'retry_wait'
);
select pg_temp.seed_dispatch_fixture(
  'b8b00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000002',
  'e8c00000-0000-4000-8000-000000000002',
  '28c00000-0000-4000-8000-000000000002',
  '38c00000-0000-4000-8000-000000000002',
  'wrong_entity',
  'pending'
);
select pg_temp.seed_dispatch_fixture(
  'b8b00000-0000-4000-8000-000000000001',
  'd8b00000-0000-4000-8000-000000000001',
  'e8c00000-0000-4000-8000-000000000003',
  '28c00000-0000-4000-8000-000000000003',
  '38c00000-0000-4000-8000-000000000003',
  'wrong_connection',
  'pending'
);

set local role integration_task_dispatch_authority;
select is(
  public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_recovery_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'maximumTasks', 100
    ),
    'phase8b_scoped_recovery',
    'phase8b_qbo_dispatcher'
  ) ->> 'recoveredTaskCount',
  '1',
  'scoped recovery returns only configured retry work to pending'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'maximumTasks', 100
      )
    )
  )::text,
  '24',
  'configured connection discovers exactly its 24 valid pending tasks'
);
select is(
  (
    select pg_catalog.count(*)::text
    from pg_catalog.jsonb_array_elements(
      public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
        pg_catalog.jsonb_build_object(
          'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
          'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
          'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
          'connectionId', 'e8b00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'maximumTasks', 100
        )
      )
    ) as candidate(value)
    where candidate.value ->> 'workspaceId' =
        'b8b00000-0000-4000-8000-000000000001'
      and candidate.value ->> 'businessEntityId' =
        'd8b00000-0000-4000-8000-000000000001'
      and candidate.value ->> 'connectionId' =
        'e8b00000-0000-4000-8000-000000000001'
      and candidate.value ->> 'connectionGeneration' = '1'
  ),
  '24',
  'every discovered candidate equals the complete trusted scope'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'maximumTasks', 100
      )
    )
  )::text,
  '0',
  'copied cross-workspace scope cannot discover the configured connection'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8c00000-0000-4000-8000-000000000002',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'maximumTasks', 100
      )
    )
  )::text,
  '0',
  'same-workspace wrong Business Entity cannot discover configured tasks'
);
select is(
  (
    select pg_catalog.count(*)::text
    from pg_catalog.jsonb_array_elements(
      public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
        pg_catalog.jsonb_build_object(
          'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
          'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
          'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
          'connectionId', 'e8b00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'maximumTasks', 100
        )
      )
    ) as candidate(value)
    where candidate.value ->> 'taskId' =
      '38c00000-0000-4000-8000-000000000003'
  ),
  '0',
  'same-entity wrong connection fixture is excluded from configured discovery'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 2,
        'maximumTasks', 100
      )
    )
  )::text,
  '0',
  'stale or substituted connection generation discovers no task'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_dispatch_candidates_v1(100)$$,
    '42501'
  ),
  'global unscoped discovery is unavailable to dispatcher authority'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.discover_integration_sync_dispatch_v1('provider_bulk', 100)$$,
    '42501'
  )
    and pg_temp.raises_sqlstate(
      $$select public.discover_integration_sync_due_work_v1(
        pg_catalog.transaction_timestamp(), 100
      )$$,
      '42501'
    )
    and pg_temp.raises_sqlstate(
      $$select public.sweep_integration_sync_tasks_v1(
        100, 'forged_global_sweep', 'phase8b_qbo_dispatcher'
      )$$,
      '42501'
    ),
  'dispatcher authority cannot use any Phase 6 global discovery or recovery RPC'
);
select is(
  public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_reservation_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', 'a8c00000-0000-4000-8000-000000000002',
      'expectedRowVersion', 2,
      'dispatcherTaskName', pg_catalog.repeat('c', 64)
    ),
    'phase8b_reserve_' || pg_catalog.repeat('c', 64),
    'phase8b_qbo_dispatcher'
  ) ->> 'state',
  'dispatched',
  'current scoped task is reserved before external enqueue'
);
select is(
  public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_reservation_v1',
      'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
      'connectionId', 'e8b00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', 'a8c00000-0000-4000-8000-000000000002',
      'expectedRowVersion', 2,
      'dispatcherTaskName', pg_catalog.repeat('c', 64)
    ),
    'phase8b_reserve_' || pg_catalog.repeat('c', 64),
    'phase8b_qbo_dispatcher'
  ) ->> 'idempotent',
  'true',
  'reservation replay preserves idempotency and the exact short task identity'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_reservation_v1',
        'workspaceId', 'b8b00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8b00000-0000-4000-8000-000000000001',
        'connectionId', 'e8b00000-0000-4000-8000-000000000001',
        'connectionGeneration', 2,
        'taskId', 'a8c00000-0000-4000-8000-000000000003',
        'expectedRowVersion', 1,
        'dispatcherTaskName', pg_catalog.repeat('d', 64)
      ),
      'phase8b_reserve_' || pg_catalog.repeat('d', 64),
      'phase8b_qbo_dispatcher'
    )$$,
    '42501'
  ),
  'stale connection generation cannot reserve or enqueue a task'
);
reset role;

set local role integration_provider_runtime_authority;
select is(
  public.read_qbo_sandbox_runtime_task_delivery_v1(
    'a8c00000-0000-4000-8000-000000000002',
    pg_catalog.repeat('c', 64)
  ) ->> 'connectionGeneration',
  '1',
  'reserved short Cloud Task identity remains compatible with runtime delivery checks'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where id in (
      '38c00000-0000-4000-8000-000000000001',
      '38c00000-0000-4000-8000-000000000002',
      '38c00000-0000-4000-8000-000000000003'
    )
  ),
  '3',
  'all unrelated disposable fixtures remain intact and unchanged'
);
select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '38c00000-0000-4000-8000-000000000001'
  ),
  'retry_wait',
  'scoped recovery leaves the unrelated retry fixture untouched'
);

-- A terminal run transition must win before a reservation can mutate its task.
-- The committed fixture exists only in the isolated database running this suite.
create or replace function pg_temp.wait_for_phase8b_ungranted_lock(
  p_pid integer,
  p_locktype text default null
)
returns boolean
language plpgsql
as $function$
begin
  for v_attempt in 1..500 loop
    if exists (
      select 1
      from pg_catalog.pg_locks as lock
      where lock.pid = p_pid
        and not lock.granted
        and (p_locktype is null or lock.locktype = p_locktype)
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end;
$function$;

select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(
      pg_catalog.current_setting('vaeroex.test_database_url_b64'),
      'base64'
    ),
    'UTF8'
  )
)
from (values
  ('phase8b_dispatch_terminalizer'),
  ('phase8b_dispatch_reservation')
) as connections(connection_name);

select extensions.dblink_exec(
  'phase8b_dispatch_terminalizer',
  $setup$
    insert into public.profiles (id, email, full_name) values (
      'a8d00000-0000-4000-8000-000000000001',
      'phase8b-dispatch-concurrency@example.test',
      'Phase 8B Dispatch Concurrency'
    );
    insert into public.workspaces (id, name, created_by) values (
      'b8d00000-0000-4000-8000-000000000001',
      'Phase 8B Dispatch Concurrency',
      'a8d00000-0000-4000-8000-000000000001'
    );
    insert into public.business_entities (
      id, workspace_id, contract_version, entity_key, entity_type,
      display_name, base_currency, timezone, fiscal_year_start_month, status,
      created_by, updated_by, created_at, updated_at
    ) values (
      'd8d00000-0000-4000-8000-000000000001',
      'b8d00000-0000-4000-8000-000000000001',
      'business_entity_v1', 'phase8b_dispatch_concurrency',
      'operating_company', 'Phase 8B Dispatch Concurrency',
      'USD', 'UTC', 1, 'active',
      'a8d00000-0000-4000-8000-000000000001',
      'a8d00000-0000-4000-8000-000000000001',
      pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
    );
    insert into private.integration_connections (
      id, contract_version, control_contract_version, workspace_id,
      business_entity_id, connection_series_id, connection_generation,
      provider_key, provider_environment,
      provider_tenant_reference_fingerprint, status, state_reason_code,
      requested_scopes, granted_scopes, safe_display_name,
      provider_descriptor_registry_version,
      provider_descriptor_registry_fingerprint,
      provider_descriptor_fingerprint, adapter_version, capability_snapshot,
      configuration_version, authorized_at, status_changed_at, row_version,
      created_by, created_at, updated_at
    ) values (
      'e8d00000-0000-4000-8000-000000000001',
      'integration_connection_v1', 'integration_connection_control_v1',
      'b8d00000-0000-4000-8000-000000000001',
      'd8d00000-0000-4000-8000-000000000001',
      'e8d00000-0000-4000-8000-000000000001', 1,
      'quickbooks_online', 'sandbox',
      private.qbo_phase_8b_realm_fingerprint_v1(
        'phase8b-dispatch-concurrency-realm'
      ),
      'initializing', 'initial_sync_pending',
      array['com.intuit.quickbooks.accounting']::text[],
      array['com.intuit.quickbooks.accounting']::text[],
      'Phase 8B Dispatch Concurrency',
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
          'get_capabilities', 'get_source_record',
          'list_entities', 'list_source_records'
        ),
        'domains', pg_catalog.jsonb_build_array(
          'change_hints', 'company_configuration',
          'financial_transactions', 'master_records',
          'report_control_observations'
        ),
        'requiredStreamKeys', pg_catalog.jsonb_build_array(
          'accounts', 'company_info', 'preferences',
          'qbo_apagingsummary', 'qbo_aragingsummary', 'qbo_balancesheet',
          'qbo_bill', 'qbo_billpayment', 'qbo_cashflow', 'qbo_creditmemo',
          'qbo_deposit', 'qbo_invoice', 'qbo_journalentry', 'qbo_payment',
          'qbo_profitandloss', 'qbo_purchase', 'qbo_refundreceipt',
          'qbo_salesreceipt', 'qbo_transfer', 'qbo_trialbalance',
          'qbo_vendorcredit'
        ),
        'supportsBackfill', true,
        'webhookMode', 'change_hints',
        'incrementalMode', 'cursor'
      ),
      1, pg_catalog.transaction_timestamp(),
      pg_catalog.transaction_timestamp(), 1,
      'a8d00000-0000-4000-8000-000000000001',
      pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp()
    );
    insert into private.integration_sync_runs (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      mapping_id, connection_generation, trigger_kind, mode, state,
      idempotency_fingerprint, provider_contract_version, adapter_version,
      policy_version, records_observed, records_accepted, records_rejected,
      facts_accepted, contributions_changed, created_at, started_at,
      row_version, updated_at
    ) values (
      '28d00000-0000-4000-8000-000000000001',
      'integration_sync_run_v1',
      'b8d00000-0000-4000-8000-000000000001',
      'd8d00000-0000-4000-8000-000000000001',
      'e8d00000-0000-4000-8000-000000000001', null, 1,
      'provider_initialization', 'initialization', 'running',
      extensions.digest(
        pg_catalog.convert_to('phase8b-dispatch-concurrency-run', 'UTF8'),
        'sha256'
      ),
      'provider_adapter_v1', 'qbo_provider_adapter_v1',
      'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0,
      pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
      2, pg_catalog.transaction_timestamp()
    );
    insert into private.integration_sync_tasks (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, sync_run_id, provider_key,
      provider_environment, queue_class, task_kind, stream_key, state,
      priority, control_metadata, idempotency_fingerprint,
      coalescing_fingerprint, dispatcher_task_name, dispatch_generation,
      last_delivery_execution_count, last_delivery_attempt_fingerprint,
      attempt_count, maximum_attempts, last_request_id,
      last_request_fingerprint, available_at, row_version, created_at,
      updated_at, retention_expires_at
    ) values (
      '38d00000-0000-4000-8000-000000000001',
      'integration_sync_task_v1',
      'b8d00000-0000-4000-8000-000000000001',
      'd8d00000-0000-4000-8000-000000000001',
      'e8d00000-0000-4000-8000-000000000001', 1,
      '28d00000-0000-4000-8000-000000000001',
      'quickbooks_online', 'sandbox', 'provider_interactive',
      'initial_historical', 'qbo_invoice', 'pending', 50,
      pg_catalog.jsonb_build_object(
        'checkpointId', null,
        'mappingId', null,
        'eventId', null,
        'pageOrdinal', 0,
        'cursorVersion', 0,
        'windowStartAt', null,
        'windowEndAt', null,
        'reasonCode', 'phase8b_dispatch_concurrency',
        'recordHintCount', 0,
        'coalescedEventCount', 1
      ),
      extensions.digest(
        pg_catalog.convert_to('phase8b-dispatch-concurrency-task', 'UTF8'),
        'sha256'
      ),
      extensions.digest(
        pg_catalog.convert_to(
          'phase8b-dispatch-concurrency-task-coalesce',
          'UTF8'
        ),
        'sha256'
      ),
      null, 0, null, null, 0, 3,
      'phase8b_dispatch_concurrency_fixture',
      extensions.digest(
        pg_catalog.convert_to(
          'phase8b-dispatch-concurrency-fixture',
          'UTF8'
        ),
        'sha256'
      ),
      pg_catalog.transaction_timestamp(), 1,
      pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp(),
      pg_catalog.transaction_timestamp() + interval '7 days'
    )
  $setup$
);

create temporary table phase8b_dispatch_backend_ids (
  connection_name text primary key,
  backend_pid integer not null
) on commit drop;

insert into phase8b_dispatch_backend_ids(connection_name, backend_pid)
select connection_name, backend_pid
from (values
  ('phase8b_dispatch_terminalizer'),
  ('phase8b_dispatch_reservation')
) as connections(connection_name)
cross join lateral extensions.dblink(
  connections.connection_name,
  'select pg_catalog.pg_backend_pid()'
) as backend(backend_pid integer);

select extensions.dblink_exec(
  'phase8b_dispatch_terminalizer',
  'set role integration_control_plane_authority'
);
select extensions.dblink_exec(
  'phase8b_dispatch_reservation',
  $configure$
    create temporary table phase8b_dispatch_session_marker(id integer);
    create or replace function pg_temp.capture_phase8b_dispatch_reservation()
    returns text
    language plpgsql
    as $capture$
    begin
      perform public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
        pg_catalog.jsonb_build_object(
          'contractVersion', 'qbo_sandbox_scoped_dispatch_reservation_v1',
          'workspaceId', 'b8d00000-0000-4000-8000-000000000001',
          'businessEntityId', 'd8d00000-0000-4000-8000-000000000001',
          'connectionId', 'e8d00000-0000-4000-8000-000000000001',
          'connectionGeneration', 1,
          'taskId', '38d00000-0000-4000-8000-000000000001',
          'expectedRowVersion', 1,
          'dispatcherTaskName', pg_catalog.repeat('e', 64)
        ),
        'phase8b_dispatch_concurrency_reservation',
        'phase8b_qbo_dispatcher'
      );
      return 'unexpected_success';
    exception when others then
      return sqlstate || ':' || sqlerrm;
    end;
    $capture$;
    set role integration_task_dispatch_authority
  $configure$
);

select pg_catalog.pg_advisory_lock(816000000000000001);
select extensions.dblink_send_query(
  'phase8b_dispatch_terminalizer',
  $terminalize$
    with terminalized as materialized (
      select public.transition_integration_sync_run_v1(
        pg_catalog.jsonb_build_object(
          'workspaceId', 'b8d00000-0000-4000-8000-000000000001',
          'businessEntityId', 'd8d00000-0000-4000-8000-000000000001',
          'connectionId', 'e8d00000-0000-4000-8000-000000000001',
          'syncRunId', '28d00000-0000-4000-8000-000000000001',
          'expectedRowVersion', 2,
          'targetState', 'cancelled',
          'counts', pg_catalog.jsonb_build_object(
            'recordsObserved', 0,
            'recordsAccepted', 0,
            'recordsRejected', 0,
            'factsAccepted', 0,
            'contributionsChanged', 0
          ),
          'errorCategory', null,
          'errorCode', null,
          'transitionedAt', pg_catalog.transaction_timestamp()
        ),
        'phase8b_dispatch_concurrency_terminalize',
        'phase8b_control_plane'
      ) as result
    )
    select terminalized.result ->> 'state' as state
    from terminalized
    cross join lateral (
      select pg_catalog.pg_advisory_xact_lock(
        816000000000000001 +
        pg_catalog.char_length(terminalized.result::text)::bigint * 0
      )
    ) as barrier
  $terminalize$
);

select ok(
  pg_temp.wait_for_phase8b_ungranted_lock(
    (
      select backend_pid
      from phase8b_dispatch_backend_ids
      where connection_name = 'phase8b_dispatch_terminalizer'
    ),
    'advisory'
  ),
  'terminal transition holds the live run row before reservation starts'
);

select extensions.dblink_send_query(
  'phase8b_dispatch_reservation',
  'select pg_temp.capture_phase8b_dispatch_reservation()'
);
select ok(
  pg_temp.wait_for_phase8b_ungranted_lock(
    (
      select backend_pid
      from phase8b_dispatch_backend_ids
      where connection_name = 'phase8b_dispatch_reservation'
    )
  ),
  'reservation waits on the terminal run transition before touching the task'
);

select pg_catalog.pg_advisory_unlock(816000000000000001);

create temporary table phase8b_dispatch_concurrency_results (
  result_kind text primary key,
  result text not null
) on commit drop;

insert into phase8b_dispatch_concurrency_results(result_kind, result)
select 'terminal_transition', state
from extensions.dblink_get_result('phase8b_dispatch_terminalizer')
  as response(state text);
insert into phase8b_dispatch_concurrency_results(result_kind, result)
select 'reservation', reservation_result
from extensions.dblink_get_result('phase8b_dispatch_reservation')
  as response(reservation_result text);

select is(
  (
    select result
    from phase8b_dispatch_concurrency_results
    where result_kind = 'terminal_transition'
  ),
  'cancelled',
  'terminal transition commits before the blocked reservation is reevaluated'
);
select is(
  (
    select result
    from phase8b_dispatch_concurrency_results
    where result_kind = 'reservation'
  ),
  '42501:qbo_sandbox_scoped_dispatch_reservation_denied',
  'reservation fails closed after the sync run becomes terminal'
);
select ok(
  exists (
    select 1
    from private.integration_sync_tasks as task
    where task.id = '38d00000-0000-4000-8000-000000000001'
      and task.state = 'pending'
      and task.dispatcher_task_name is null
      and task.dispatch_generation = 0
      and task.row_version = 1
  ),
  'failed terminal-run reservation leaves task state and idempotency intact'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_dispatch_terminalizer'),
  ('phase8b_dispatch_reservation')
) as connections(connection_name);

select is(
  (select immutable_version::text from private.external_source_record_versions where id = '68000000-0000-4000-8000-000000008b01'),
  '2',
  'validated source history advances to immutable version two'
);
select is(
  (select validation_state from private.external_source_record_versions where id = '68000000-0000-4000-8000-000000008b01'),
  'valid',
  'validated source state is persisted exactly'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.external_source_record_versions
      set validation_state = 'quarantined'
      where id = '68000000-0000-4000-8000-000000008b01'$$,
    '55000'
  ),
  'validated source versions are update-immutable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.external_source_record_versions
      where id = '68000000-0000-4000-8000-000000008b01'$$,
    '55000'
  ),
  'validated source versions are delete-immutable'
);
select is(
  (select count(*)::text from private.canonical_business_fact_versions where workspace_id = 'b8b00000-0000-4000-8000-000000000001'),
  '0',
  'source validation creates no accepted canonical fact'
);
select is(
  (select count(*)::text from private.fact_contribution_events where workspace_id = 'b8b00000-0000-4000-8000-000000000001'),
  '0',
  'source validation creates no numerical contribution'
);
select is(
  (select count(*)::text from private.deterministic_aggregate_states where workspace_id = 'b8b00000-0000-4000-8000-000000000001'),
  '0',
  'source validation creates no deterministic KPI state'
);

select * from finish();
rollback;
