begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

grant usage on schema extensions to
  integration_credential_broker_authority,
  integration_qbo_canary_dispatch_authority,
  integration_provider_runtime_authority;

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

create or replace function pg_temp.canary_recovery_command(
  p_task_id uuid,
  p_task_row_version bigint,
  p_failure_audit_id uuid,
  p_credential_read_audit_id uuid,
  p_workspace_id uuid default 'b8c00000-0000-4000-8000-000000000001',
  p_business_entity_id uuid default 'd8c00000-0000-4000-8000-000000000001',
  p_connection_id uuid default 'e8c00000-0000-4000-8000-000000000001',
  p_connection_generation bigint default 1,
  p_mapping_id uuid default 'f8c00000-0000-4000-8000-000000000001',
  p_credential_id uuid default '78c00000-0000-4000-8000-000000000001'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion',
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v1',
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', p_connection_generation,
    'mappingId', p_mapping_id,
    'expectedMappingRowVersion', 1,
    'credentialId', p_credential_id,
    'expectedCredentialVersion', 5,
    'expectedCredentialRowVersion', 3,
    'taskId', p_task_id,
    'expectedTaskRowVersion', p_task_row_version,
    'expectedDispatchGeneration', 2,
    'failureAuditEventId', p_failure_audit_id,
    'credentialReadAuditEventId', p_credential_read_audit_id,
    'diagnosticClass', 'expires_at_binding',
    'externalEvidenceFingerprint',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'retryAfterSeconds', 1
  );
$function$;

insert into public.profiles (id, email, full_name) values (
  'a8c00000-0000-4000-8000-000000000001',
  'phase8b-credential-binding-canary@example.test',
  'Phase 8B Credential Binding Canary'
);
insert into public.workspaces (id, name, created_by) values (
  'b8c00000-0000-4000-8000-000000000001',
  'Phase 8B Credential Binding Canary',
  'a8c00000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c8c00000-0000-4000-8000-000000000001',
  'b8c00000-0000-4000-8000-000000000001',
  'a8c00000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8c00000-0000-4000-8000-000000000001',
  'b8c00000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_credential_binding_canary',
  'operating_company',
  'Phase 8B Credential Binding Canary',
  'USD',
  'UTC',
  1,
  'active',
  'a8c00000-0000-4000-8000-000000000001',
  'a8c00000-0000-4000-8000-000000000001',
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
)
select
  fixture.id,
  'integration_connection_v1',
  'integration_connection_control_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.id,
  1,
  'quickbooks_online',
  'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1(fixture.realm_key),
  'initializing',
  'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  fixture.display_name,
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
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  3,
  'a8c00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
from (values
  (
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b-canary-realm-main',
    'Phase 8B Canary Main'
  ),
  (
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b-canary-realm-race',
    'Phase 8B Canary Race'
  )
) as fixture(id, realm_key, display_name);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, provider_key, provider_environment,
  provider_entity_type, provider_entity_reference_fingerprint,
  safe_display_name, mapping_role, status, verification_mode,
  verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
  created_at, updated_at
)
select
  fixture.mapping_id,
  'provider_entity_mapping_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.connection_id,
  fixture.mapping_id,
  1,
  'quickbooks_online',
  'sandbox',
  'company',
  private.qbo_phase_8b_realm_fingerprint_v1(fixture.realm_key),
  fixture.display_name,
  'primary',
  'active',
  'qbo_realm_mapping_v1',
  extensions.digest(
    pg_catalog.convert_to(fixture.realm_key || '-verified', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  'a8c00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  1,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
from (values
  (
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b-canary-realm-main',
    'Phase 8B Canary Main'
  ),
  (
    'f8c00000-0000-4000-8000-000000000002'::uuid,
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b-canary-realm-race',
    'Phase 8B Canary Race'
  )
) as fixture(mapping_id, connection_id, realm_key, display_name);

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status,
  creation_request_id, creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
)
select
  fixture.oauth_id,
  'integration_oauth_state_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.connection_id,
  1,
  'quickbooks_online',
  'sandbox',
  'a8c00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  '/phase8b/sandbox/authorized',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-state', 'UTF8'),
    'sha256'
  ),
  'consumed',
  fixture.seed || '_create',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-create', 'UTF8'),
    'sha256'
  ),
  fixture.seed || '_consume',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-consume', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '110 minutes',
  pg_catalog.transaction_timestamp() - interval '115 minutes',
  2
from (values
  (
    '18c00000-0000-4000-8000-000000000001'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_oauth_main'
  ),
  (
    '18c00000-0000-4000-8000-000000000002'::uuid,
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b_canary_oauth_race'
  )
) as fixture(oauth_id, connection_id, seed);

insert into private.integration_credentials (
  id, contract_version, oauth_state_id, workspace_id, business_entity_id,
  connection_id, connection_generation, provider_key, provider_environment,
  initiated_by, credential_version, envelope_schema_version,
  aad_schema_version, aad_digest, kms_key_resource, credential_ciphertext,
  access_expires_at, refresh_expires_at, granted_scopes,
  external_entity_reference_fingerprint, status, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at
)
select
  fixture.credential_id,
  'integration_credential_authority_v1',
  fixture.oauth_id,
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.connection_id,
  1,
  'quickbooks_online',
  'sandbox',
  'a8c00000-0000-4000-8000-000000000001',
  5,
  'oauth_credential_envelope_v1',
  'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b8c00000-0000-4000-8000-000000000001',
    fixture.connection_id,
    1,
    'quickbooks_online',
    fixture.credential_id
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('c', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() + interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1(fixture.realm_key),
  'active',
  fixture.seed || '_store',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-store', 'UTF8'),
    'sha256'
  ),
  3,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
from (values
  (
    '78c00000-0000-4000-8000-000000000001'::uuid,
    '18c00000-0000-4000-8000-000000000001'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b-canary-realm-main',
    'phase8b_canary_credential_main'
  ),
  (
    '78c00000-0000-4000-8000-000000000002'::uuid,
    '18c00000-0000-4000-8000-000000000002'::uuid,
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b-canary-realm-race',
    'phase8b_canary_credential_race'
  )
) as fixture(credential_id, oauth_id, connection_id, realm_key, seed);

insert into private.integration_workspace_policies (
  id, contract_version, workspace_id, provider_key, provider_environment,
  state, sync_enabled, history_horizon_days, maximum_concurrency,
  freshness_policy_version, retention_policy_version, row_version,
  last_request_id, last_request_fingerprint, created_at, updated_at
) values (
  '08c00000-0000-4000-8000-000000000001',
  'integration_workspace_policy_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'enabled',
  true,
  400,
  2,
  'qbo_control_plane_freshness_policy_v1',
  'qbo_metadata_retention_v1',
  1,
  'phase8b_canary_workspace_policy',
  extensions.digest(
    pg_catalog.convert_to('phase8b-canary-workspace-policy', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, provider_contract_version, adapter_version,
  policy_version, records_observed, records_accepted, records_rejected,
  facts_accepted, contributions_changed, created_at, started_at,
  row_version, updated_at
)
select
  fixture.run_id,
  'integration_sync_run_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.connection_id,
  fixture.mapping_id,
  1,
  'provider_initialization',
  'initialization',
  'running',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-run', 'UTF8'),
    'sha256'
  ),
  'provider_adapter_v1',
  'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1',
  0, 0, 0, 0, 0,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  2,
  pg_catalog.transaction_timestamp() - interval '2 hours'
from (values
  (
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b-canary-main'
  ),
  (
    '28c00000-0000-4000-8000-000000000002'::uuid,
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    'f8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b-canary-race'
  )
) as fixture(run_id, connection_id, mapping_id, seed);

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
)
select
  fixture.task_id,
  'integration_sync_task_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  fixture.connection_id,
  1,
  fixture.run_id,
  'quickbooks_online',
  'sandbox',
  'provider_interactive',
  'initial_historical',
  'company_info',
  'failed',
  90,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', fixture.mapping_id,
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', fixture.seed,
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-idempotency', 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-coalescing', 'UTF8'),
    'sha256'
  ),
  null,
  2,
  fixture.delivery_attribution_state,
  case when fixture.delivery_attribution_state = 'attributed' then 2 end,
  case when fixture.delivery_attribution_state = 'attributed' then 0 end,
  0,
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-delivery', 'UTF8'),
    'sha256'
  ),
  2,
  3,
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  fixture.failure_category,
  fixture.failure_code,
  null,
  fixture.seed || '_failure',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-failure', 'UTF8'),
    'sha256'
  ),
  9,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '10 minutes',
  pg_catalog.transaction_timestamp() - interval '10 minutes',
  pg_catalog.transaction_timestamp() + interval '7 days'
from (values
  (
    '38c00000-0000-4000-8000-000000000001'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_eligible',
    'attributed',
    'contract',
    'phase8b_provider_task_failed'
  ),
  (
    '38c00000-0000-4000-8000-000000000002'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_wrong_failure',
    'attributed',
    'integrity',
    'phase8b_integrity_failure'
  ),
  (
    '38c00000-0000-4000-8000-000000000003'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_expired_only',
    'attributed',
    'contract',
    'phase8b_provider_task_failed'
  ),
  (
    '38c00000-0000-4000-8000-000000000004'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_effect_evidence',
    'attributed',
    'contract',
    'phase8b_provider_task_failed'
  ),
  (
    '38c00000-0000-4000-8000-000000000005'::uuid,
    'e8c00000-0000-4000-8000-000000000001'::uuid,
    '28c00000-0000-4000-8000-000000000001'::uuid,
    'f8c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_legacy_quarantine',
    'legacy_unattributed',
    'contract',
    'phase8b_provider_task_failed'
  ),
  (
    '38c00000-0000-4000-8000-000000000006'::uuid,
    'e8c00000-0000-4000-8000-000000000002'::uuid,
    '28c00000-0000-4000-8000-000000000002'::uuid,
    'f8c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b_canary_concurrent',
    'attributed',
    'contract',
    'phase8b_provider_task_failed'
  )
) as fixture(
  task_id, connection_id, run_id, mapping_id, seed,
  delivery_attribution_state, failure_category, failure_code
);

insert into private.integration_sync_task_recovery_events (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, credential_id, credential_version, task_id,
  recovery_generation, prior_state, prior_failure_category,
  prior_failure_code, prior_row_version, prior_completed_at,
  retry_after_seconds, request_id, request_fingerprint, actor_id,
  recovered_at, created_at
)
select
  fixture.recovery_id,
  'qbo_sandbox_expired_credential_recovery_v1',
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  task.connection_id,
  1,
  fixture.credential_id,
  5,
  task.id,
  1,
  'failed',
  'contract',
  'phase8b_provider_task_failed',
  4,
  pg_catalog.transaction_timestamp() - interval '30 minutes',
  30,
  fixture.seed || '_expired_recovery',
  extensions.digest(
    pg_catalog.convert_to(fixture.seed || '-expired-recovery', 'UTF8'),
    'sha256'
  ),
  'phase8b_credential_recovery',
  pg_catalog.transaction_timestamp() - interval '25 minutes',
  pg_catalog.transaction_timestamp() - interval '25 minutes'
from (values
  (
    '48c00000-0000-4000-8000-000000000001'::uuid,
    '38c00000-0000-4000-8000-000000000001'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_eligible'
  ),
  (
    '48c00000-0000-4000-8000-000000000002'::uuid,
    '38c00000-0000-4000-8000-000000000002'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_wrong_failure'
  ),
  (
    '48c00000-0000-4000-8000-000000000003'::uuid,
    '38c00000-0000-4000-8000-000000000003'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_expired_only'
  ),
  (
    '48c00000-0000-4000-8000-000000000004'::uuid,
    '38c00000-0000-4000-8000-000000000004'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_effect_evidence'
  ),
  (
    '48c00000-0000-4000-8000-000000000006'::uuid,
    '38c00000-0000-4000-8000-000000000006'::uuid,
    '78c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b_canary_concurrent'
  )
) as fixture(recovery_id, task_id, credential_id, seed)
inner join private.integration_sync_tasks as task on task.id = fixture.task_id;

insert into private.integration_audit_events (
  id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
)
select
  fixture.failure_audit_id,
  task.workspace_id,
  task.business_entity_id,
  task.connection_id,
  'service',
  'phase8b_provider_runtime',
  'integration_sync_task.fail',
  'failed',
  'integration_sync_task',
  task.id::text,
  task.last_request_id,
  null,
  '{}'::jsonb,
  task.completed_at,
  'operational'
from (values
  ('58c00000-0000-4000-8000-000000000001'::uuid, '38c00000-0000-4000-8000-000000000001'::uuid),
  ('58c00000-0000-4000-8000-000000000002'::uuid, '38c00000-0000-4000-8000-000000000002'::uuid),
  ('58c00000-0000-4000-8000-000000000003'::uuid, '38c00000-0000-4000-8000-000000000003'::uuid),
  ('58c00000-0000-4000-8000-000000000004'::uuid, '38c00000-0000-4000-8000-000000000004'::uuid),
  ('58c00000-0000-4000-8000-000000000006'::uuid, '38c00000-0000-4000-8000-000000000006'::uuid)
) as fixture(failure_audit_id, task_id)
inner join private.integration_sync_tasks as task on task.id = fixture.task_id;

insert into private.integration_audit_events (
  id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
)
select
  fixture.read_audit_id,
  task.workspace_id,
  task.business_entity_id,
  task.connection_id,
  'service',
  'integration_credential_broker',
  'credential_provider_read',
  'allowed',
  'integration_credential',
  fixture.credential_id::text,
  fixture.seed || '_credential_read',
  'authorized',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_status', 'active',
    'credential_version', 5,
    'task_state', 'leased'
  ),
  task.completed_at - interval '1 second',
  'security'
from (values
  (
    '68c00000-0000-4000-8000-000000000001'::uuid,
    '38c00000-0000-4000-8000-000000000001'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_eligible'
  ),
  (
    '68c00000-0000-4000-8000-000000000002'::uuid,
    '38c00000-0000-4000-8000-000000000002'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_wrong_failure'
  ),
  (
    '68c00000-0000-4000-8000-000000000004'::uuid,
    '38c00000-0000-4000-8000-000000000004'::uuid,
    '78c00000-0000-4000-8000-000000000001'::uuid,
    'phase8b_canary_effect_evidence'
  ),
  (
    '68c00000-0000-4000-8000-000000000006'::uuid,
    '38c00000-0000-4000-8000-000000000006'::uuid,
    '78c00000-0000-4000-8000-000000000002'::uuid,
    'phase8b_canary_concurrent'
  )
) as fixture(read_audit_id, task_id, credential_id, seed)
inner join private.integration_sync_tasks as task on task.id = fixture.task_id;

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
  'phase8b_canary_effect_completion',
  null,
  pg_catalog.jsonb_build_object(
    'task_state', 'succeeded',
    'task_kind', task.task_kind,
    'queue_class', task.queue_class,
    'attempt_count', task.attempt_count,
    'dispatch_generation', task.dispatch_generation,
    'checkpoint_lifecycle', null,
    'checkpoint_version', 0,
    'row_version', task.row_version,
    'idempotent', false
  ),
  task.completed_at - interval '500 milliseconds',
  'operational'
from private.integration_sync_tasks as task
where task.id = '38c00000-0000-4000-8000-000000000004';

create temporary table phase8b_canary_other_task_snapshot as
select task.id, pg_catalog.to_jsonb(task) as snapshot
from private.integration_sync_tasks as task
where task.connection_id = 'e8c00000-0000-4000-8000-000000000001'
  and task.id <> '38c00000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.recover_qbo_sandbox_credential_binding_incident_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_credential_binding_incident_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_task_dispatch_authority',
    'public.recover_qbo_sandbox_credential_binding_incident_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_sync_task_credential_binding_recovery_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'credential-binding incident recovery is broker-RPC-only with no service or table shortcut'
);
select ok(
  has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.promote_qbo_sandbox_canary_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.read_qbo_sandbox_canary_dispatch_candidate_v1(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.reserve_qbo_sandbox_canary_dispatch_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_qbo_canary_dispatch_authority',
    'public.promote_qbo_sandbox_due_retry_tasks_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'canary authority has only exact-task promotion, discovery and reservation'
);
select ok(
  (
    select role.rolcanlogin is false and role.rolinherit is false
    from pg_catalog.pg_roles as role
    where role.rolname = 'integration_qbo_canary_dispatch_authority'
  )
  and (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid =
      'private.integration_sync_task_credential_binding_recovery_events'::regclass
  ),
  'canary authority is NOLOGIN/NOINHERIT and recovery evidence has forced RLS'
);

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001'
      ),
      'phase8b_canary_service_role_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'service_role cannot invoke incident recovery'
);
reset role;

set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.canary_recovery_command(
          '38c00000-0000-4000-8000-000000000001', 9,
          '58c00000-0000-4000-8000-000000000001',
          '68c00000-0000-4000-8000-000000000001'
        ),
        '{diagnosticClass}',
        '"credential_expired"'::jsonb
      ),
      'phase8b_canary_wrong_diagnostic',
      'phase8b_canary_operator'
    )$$,
    '22023'
  ),
  'only the corrected expires_at_binding incident class is syntactically admissible'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.canary_recovery_command(
          '38c00000-0000-4000-8000-000000000001', 9,
          '58c00000-0000-4000-8000-000000000001',
          '68c00000-0000-4000-8000-000000000001'
        ),
        '{contractVersion}',
        'null'::jsonb
      ),
      'phase8b_canary_null_contract',
      'phase8b_canary_operator'
    )$$,
    '22023'
  ),
  'JSON null cannot bypass the incident recovery contract discriminator'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000003', 9,
        '58c00000-0000-4000-8000-000000000003',
        '68c00000-0000-4000-8000-000000000003'
      ),
      'phase8b_canary_expired_only_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'prior expired-credential recovery alone cannot authorize the incident recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000002', 9,
        '58c00000-0000-4000-8000-000000000002',
        '68c00000-0000-4000-8000-000000000002'
      ),
      'phase8b_canary_wrong_failure_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'a different terminal failure classification cannot use incident recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000004', 9,
        '58c00000-0000-4000-8000-000000000004',
        '68c00000-0000-4000-8000-000000000004'
      ),
      'phase8b_canary_effect_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'authoritative provider-completion evidence blocks incident recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 8,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001'
      ),
      'phase8b_canary_stale_task',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'stale task row-version CAS fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001',
        'b8c00000-0000-4000-8000-000000000099'
      ),
      'phase8b_canary_wrong_workspace',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'cross-workspace recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001',
        'b8c00000-0000-4000-8000-000000000001',
        'd8c00000-0000-4000-8000-000000000099'
      ),
      'phase8b_canary_wrong_entity',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'cross-Business-Entity recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001',
        'b8c00000-0000-4000-8000-000000000001',
        'd8c00000-0000-4000-8000-000000000001',
        'e8c00000-0000-4000-8000-000000000099'
      ),
      'phase8b_canary_wrong_connection',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'cross-connection recovery fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001',
        'b8c00000-0000-4000-8000-000000000001',
        'd8c00000-0000-4000-8000-000000000001',
        'e8c00000-0000-4000-8000-000000000001',
        2
      ),
      'phase8b_canary_wrong_generation',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'stale connection generation recovery fails closed'
);
reset role;

savepoint phase8b_canary_invalid_grant;
insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values (
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  'e8c00000-0000-4000-8000-000000000001',
  'service', 'integration_credential_broker',
  'credential_refresh_boundary', 'failed', 'integration_credential',
  '78c00000-0000-4000-8000-000000000001',
  'phase8b_canary_invalid_grant', 'invalid_grant',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_version', 5,
    'refresh_boundary_stage', 'provider_response_parse',
    'refresh_operation_fingerprint',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'refresh_diagnostics', null
  ),
  pg_catalog.transaction_timestamp() - interval '5 minutes',
  'security'
);
set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001'
      ),
      'phase8b_canary_invalid_grant_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'applicable invalid_grant evidence blocks recovery'
);
reset role;
rollback to savepoint phase8b_canary_invalid_grant;
release savepoint phase8b_canary_invalid_grant;

savepoint phase8b_canary_provider_revoked;
insert into private.integration_audit_events (
  workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values (
  'b8c00000-0000-4000-8000-000000000001',
  'd8c00000-0000-4000-8000-000000000001',
  'e8c00000-0000-4000-8000-000000000001',
  'service', 'integration_credential_broker',
  'credential_refresh_boundary', 'failed', 'integration_credential',
  '78c00000-0000-4000-8000-000000000001',
  'phase8b_canary_provider_revoked', 'provider_revoked',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_version', 5,
    'refresh_boundary_stage', 'provider_response_parse',
    'refresh_operation_fingerprint',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'refresh_diagnostics', null
  ),
  pg_catalog.transaction_timestamp() - interval '5 minutes',
  'security'
);
set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      pg_temp.canary_recovery_command(
        '38c00000-0000-4000-8000-000000000001', 9,
        '58c00000-0000-4000-8000-000000000001',
        '68c00000-0000-4000-8000-000000000001'
      ),
      'phase8b_canary_provider_revoked_denied',
      'phase8b_canary_operator'
    )$$,
    '42501'
  ),
  'applicable provider_revoked evidence blocks recovery'
);
reset role;
rollback to savepoint phase8b_canary_provider_revoked;
release savepoint phase8b_canary_provider_revoked;

set local role integration_credential_broker_authority;
create temporary table phase8b_canary_recovery_result as
select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
  pg_temp.canary_recovery_command(
    '38c00000-0000-4000-8000-000000000001', 9,
    '58c00000-0000-4000-8000-000000000001',
    '68c00000-0000-4000-8000-000000000001'
  ),
  'phase8b_canary_incident_recovery',
  'phase8b_canary_operator'
) as result;
select is(
  (select result ->> 'state' from phase8b_canary_recovery_result),
  'retry_wait',
  'exact incident recovery transitions only failed to retry_wait'
);
select is(
  (select result ->> 'rowVersion' from phase8b_canary_recovery_result),
  '10',
  'incident recovery advances the exact task CAS once'
);
select is(
  public.recover_qbo_sandbox_credential_binding_incident_task_v1(
    pg_temp.canary_recovery_command(
      '38c00000-0000-4000-8000-000000000001', 9,
      '58c00000-0000-4000-8000-000000000001',
      '68c00000-0000-4000-8000-000000000001'
    ),
    'phase8b_canary_incident_recovery',
    'phase8b_canary_operator'
  ) ->> 'idempotent',
  'true',
  'identical recovery replay creates no second mutation'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_credential_binding_recovery_events
    where task_id = '38c00000-0000-4000-8000-000000000001'
      and diagnostic_class = 'expires_at_binding'
      and reason_code = 'credential_envelope_binding_convergence'
  ),
  '1',
  'one immutable reason-specific recovery event is appended'
);
select ok(
  (
    select state = 'retry_wait'
      and row_version = 10
      and dispatch_generation = 2
      and attempt_count = 2
      and durable_effect_fingerprint is null
      and failure_category is null
      and failure_code is null
      and completed_at is null
    from private.integration_sync_tasks
    where id = '38c00000-0000-4000-8000-000000000001'
  ),
  'recovery preserves identity, delivery history and no-effect evidence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_credential_binding_recovery_events
      set actor_id = 'forged_actor'
      where task_id = '38c00000-0000-4000-8000-000000000001'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_credential_binding_recovery_events
      where task_id = '38c00000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'reason-specific recovery evidence is update/delete immutable'
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
  ('phase8b_canary_recovery_race_1'),
  ('phase8b_canary_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (values
  ('phase8b_canary_recovery_race_1'),
  ('phase8b_canary_recovery_race_2')
) as connections(connection_name);

select extensions.dblink_send_query(
  'phase8b_canary_recovery_race_1',
  $query$
    select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      jsonb_build_object(
        'contractVersion',
          'qbo_sandbox_credential_envelope_binding_incident_recovery_v1',
        'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
        'connectionId', 'e8c00000-0000-4000-8000-000000000002',
        'connectionGeneration', 1,
        'mappingId', 'f8c00000-0000-4000-8000-000000000002',
        'expectedMappingRowVersion', 1,
        'credentialId', '78c00000-0000-4000-8000-000000000002',
        'expectedCredentialVersion', 5,
        'expectedCredentialRowVersion', 3,
        'taskId', '38c00000-0000-4000-8000-000000000006',
        'expectedTaskRowVersion', 9,
        'expectedDispatchGeneration', 2,
        'failureAuditEventId', '58c00000-0000-4000-8000-000000000006',
        'credentialReadAuditEventId',
          '68c00000-0000-4000-8000-000000000006',
        'diagnosticClass', 'expires_at_binding',
        'externalEvidenceFingerprint',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'retryAfterSeconds', 1
      ),
      'phase8b_canary_concurrent_recovery',
      'phase8b_canary_operator'
    )
  $query$
);
select extensions.dblink_send_query(
  'phase8b_canary_recovery_race_2',
  $query$
    select public.recover_qbo_sandbox_credential_binding_incident_task_v1(
      jsonb_build_object(
        'contractVersion',
          'qbo_sandbox_credential_envelope_binding_incident_recovery_v1',
        'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
        'connectionId', 'e8c00000-0000-4000-8000-000000000002',
        'connectionGeneration', 1,
        'mappingId', 'f8c00000-0000-4000-8000-000000000002',
        'expectedMappingRowVersion', 1,
        'credentialId', '78c00000-0000-4000-8000-000000000002',
        'expectedCredentialVersion', 5,
        'expectedCredentialRowVersion', 3,
        'taskId', '38c00000-0000-4000-8000-000000000006',
        'expectedTaskRowVersion', 9,
        'expectedDispatchGeneration', 2,
        'failureAuditEventId', '58c00000-0000-4000-8000-000000000006',
        'credentialReadAuditEventId',
          '68c00000-0000-4000-8000-000000000006',
        'diagnosticClass', 'expires_at_binding',
        'externalEvidenceFingerprint',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        'retryAfterSeconds', 1
      ),
      'phase8b_canary_concurrent_recovery',
      'phase8b_canary_operator'
    )
  $query$
);

create temporary table phase8b_canary_concurrent_results (
  result jsonb not null
);
insert into phase8b_canary_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_canary_recovery_race_1')
  as response(result jsonb);
insert into phase8b_canary_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_canary_recovery_race_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_canary_recovery_race_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_canary_recovery_race_2')
  as response(result jsonb);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_canary_concurrent_results
  ),
  2,
  'both concurrent recovery callers receive a bounded authoritative result'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_canary_concurrent_results
    where not (result ->> 'idempotent')::boolean
  ),
  1,
  'concurrent recovery permits exactly one authoritative mutation'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_canary_concurrent_results
    where (result ->> 'idempotent')::boolean
  ),
  1,
  'concurrent recovery loser converges through idempotent evidence'
);
select ok(
  (
    select task.state = 'retry_wait'
      and task.row_version = 10
      and task.dispatch_generation = 2
      and task.durable_effect_fingerprint is null
    from private.integration_sync_tasks as task
    where task.id = '38c00000-0000-4000-8000-000000000006'
  )
  and (
    select pg_catalog.count(*) = 1
    from private.integration_sync_task_credential_binding_recovery_events
    where task_id = '38c00000-0000-4000-8000-000000000006'
  ),
  'concurrent recovery leaves one task mutation and one immutable event'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_canary_recovery_race_1'),
  ('phase8b_canary_recovery_race_2')
) as connections(connection_name);

select pg_catalog.pg_sleep(1.1);
commit;
begin;
set local search_path = public, extensions;

set local role integration_qbo_canary_dispatch_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_sandbox_canary_dispatch_candidate_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', null,
        'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
        'connectionId', 'e8c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '38c00000-0000-4000-8000-000000000001',
        'maximumTasks', 1
      )
    )$$,
    '22023'
  ),
  'JSON null cannot bypass canary discovery contract selection'
);
create temporary table phase8b_canary_promotion_result as
select public.promote_qbo_sandbox_canary_task_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_canary_due_retry_promotion_v1',
    'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
    'connectionId', 'e8c00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'taskId', '38c00000-0000-4000-8000-000000000001',
    'maximumTasks', 1
  ),
  'phase8b_canary_retry_ready_38c00000',
  'phase8b_qbo_canary_dispatcher'
) as result;
select is(
  (select result ->> 'promotedTaskCount' from phase8b_canary_promotion_result),
  '1',
  'exact canary due retry is promoted once'
);
select is(
  public.promote_qbo_sandbox_canary_task_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_canary_due_retry_promotion_v1',
      'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
      'connectionId', 'e8c00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', '38c00000-0000-4000-8000-000000000001',
      'maximumTasks', 1
    ),
    'phase8b_canary_retry_ready_38c00000',
    'phase8b_qbo_canary_dispatcher'
  ) ->> 'idempotent',
  'true',
  'canary due-retry promotion is idempotent'
);

create temporary table phase8b_canary_discovery_result as
select public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_canary_dispatch_discovery_v1',
    'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
    'connectionId', 'e8c00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'taskId', '38c00000-0000-4000-8000-000000000001',
    'maximumTasks', 1
  )
) as result;
select is(
  (select pg_catalog.jsonb_array_length(result)
   from phase8b_canary_discovery_result),
  1,
  'canary discovery returns exactly one candidate'
);
select is(
  (select result -> 0 ->> 'taskId' from phase8b_canary_discovery_result),
  '38c00000-0000-4000-8000-000000000001',
  'canary discovery returns only the configured company_info identity'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_canary_dispatch_candidate_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_canary_dispatch_discovery_v1',
        'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
        'connectionId', 'e8c00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '38c00000-0000-4000-8000-000000000002',
        'maximumTasks', 1
      )
    )
  ),
  0,
  'wrong failed task identity cannot widen canary discovery'
);

create temporary table phase8b_canary_reservation_result as
select public.reserve_qbo_sandbox_canary_dispatch_task_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_canary_dispatch_reservation_v1',
    'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
    'connectionId', 'e8c00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'taskId', '38c00000-0000-4000-8000-000000000001',
    'expectedRowVersion', 11,
    'dispatcherTaskName',
      '24eb1112219d59b7c6cbf162e8d3ef39d48b712dc1529dd1db58545613cd7b82'
  ),
  'phase8b_canary_reserve_24eb1112219d59b7c6cbf162e8d3ef39d48b712dc1529dd1db58545613cd7b82',
  'phase8b_qbo_canary_dispatcher'
) as result;
select is(
  (select result ->> 'state' from phase8b_canary_reservation_result),
  'dispatched',
  'canary reservation follows the normal durable dispatched lifecycle'
);
select is(
  (select result ->> 'dispatchGeneration'
   from phase8b_canary_reservation_result),
  '3',
  'only canary dispatch generation advances'
);
create temporary table phase8b_canary_reserved_reconciliation_result as
select public.read_qbo_sandbox_canary_dispatch_candidate_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_canary_dispatch_discovery_v1',
    'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
    'connectionId', 'e8c00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'taskId', '38c00000-0000-4000-8000-000000000001',
    'maximumTasks', 1
  )
) as result;
select ok(
  (
    select pg_catalog.jsonb_array_length(result) = 1
      and result -> 0 ->> 'rowVersion' = '11'
      and result -> 0 ->> 'dispatchGeneration' = '2'
    from phase8b_canary_reserved_reconciliation_result
  ),
  'reserved canary reconciliation returns the same virtual pre-reservation identity'
);
select is(
  public.reserve_qbo_sandbox_canary_dispatch_task_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_canary_dispatch_reservation_v1',
      'workspaceId', 'b8c00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8c00000-0000-4000-8000-000000000001',
      'connectionId', 'e8c00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'taskId', '38c00000-0000-4000-8000-000000000001',
      'expectedRowVersion', 11,
      'dispatcherTaskName',
        '24eb1112219d59b7c6cbf162e8d3ef39d48b712dc1529dd1db58545613cd7b82'
    ),
    'phase8b_canary_reserve_24eb1112219d59b7c6cbf162e8d3ef39d48b712dc1529dd1db58545613cd7b82',
    'phase8b_qbo_canary_dispatcher'
  ) ->> 'idempotent',
  'true',
  'deterministic canary reservation replay cannot create another dispatch'
);
reset role;

select ok(
  (
    select state = 'dispatched'
      and row_version = 12
      and dispatch_generation = 3
      and dispatcher_task_name =
        '24eb1112219d59b7c6cbf162e8d3ef39d48b712dc1529dd1db58545613cd7b82'
      and durable_effect_fingerprint is null
    from private.integration_sync_tasks
    where id = '38c00000-0000-4000-8000-000000000001'
  ),
  'canary reservation preserves one exact effect-free delivery identity'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks as task
    inner join phase8b_canary_other_task_snapshot as prior
      on prior.id = task.id
    where pg_catalog.to_jsonb(task) = prior.snapshot
  ),
  '4',
  'all other main-scope failed and quarantined tasks remain byte-equivalent'
);
select ok(
  (
    select state = 'failed'
      and delivery_attribution_state = 'legacy_unattributed'
      and row_version = 9
      and durable_effect_fingerprint is null
    from private.integration_sync_tasks
    where id = '38c00000-0000-4000-8000-000000000005'
  ),
  'legacy_unattributed fixture remains quarantined and unchanged'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_credential_binding_recovery_events
  ),
  '2',
  'only the direct canary and independent concurrency canary have recovery authority'
);
select ok(
  (
    select status = 'active'
      and credential_version = 5
      and row_version = 3
      and refresh_lease_id is null
    from private.integration_credentials
    where id = '78c00000-0000-4000-8000-000000000001'
  ),
  'credential authority remains active and unchanged throughout recovery and dispatch'
);

select * from finish();
rollback;
