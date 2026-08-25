begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

grant usage on schema extensions to
  integration_oauth_ingress_authority,
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

create or replace function pg_temp.timestamp_text(p_value timestamptz)
returns text
language sql
stable
as $function$
  select pg_catalog.to_char(
    p_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
$function$;

insert into public.profiles (id, email, full_name) values (
  'a8f00000-0000-4000-8000-000000000001',
  'phase8b-reauthorization@example.test',
  'Phase 8B Reauthorization'
);
insert into public.workspaces (id, name, created_by) values (
  'b8f00000-0000-4000-8000-000000000001',
  'Phase 8B Reauthorization Workspace',
  'a8f00000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c8f00000-0000-4000-8000-000000000001',
  'b8f00000-0000-4000-8000-000000000001',
  'a8f00000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8f00000-0000-4000-8000-000000000001',
  'b8f00000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_reauthorization',
  'operating_company',
  'Phase 8B Reauthorization',
  'USD',
  'UTC',
  1,
  'active',
  'a8f00000-0000-4000-8000-000000000001',
  'a8f00000-0000-4000-8000-000000000001',
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
  'e8f00000-0000-4000-8000-000000000001',
  'integration_connection_v1',
  'integration_connection_control_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-reauthorization-realm'
  ),
  'initializing',
  'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Phase 8B Reauthorization Sandbox',
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
  'a8f00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '1 hour'
);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, provider_key, provider_environment,
  provider_entity_type, provider_entity_reference_fingerprint,
  safe_display_name, mapping_role, status, verification_mode,
  verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
  created_at, updated_at
) values (
  'f8f00000-0000-4000-8000-000000000001',
  'provider_entity_mapping_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  'f8f00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'company',
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-reauthorization-realm'
  ),
  'Phase 8B Reauthorization Sandbox',
  'primary',
  'active',
  'qbo_realm_mapping_v1',
  extensions.digest(
    pg_catalog.convert_to('phase8b-reauthorization-company-v1', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  'a8f00000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  1,
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
  '18f00000-0000-4000-8000-000000000001',
  'integration_oauth_state_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8f00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  '/phase8b/sandbox/authorized',
  extensions.digest(
    pg_catalog.convert_to('phase8b-initial-oauth-state', 'UTF8'),
    'sha256'
  ),
  'consumed',
  'phase8b_reauthorization_initial_create',
  extensions.digest(
    pg_catalog.convert_to('phase8b-initial-create', 'UTF8'),
    'sha256'
  ),
  'phase8b_reauthorization_initial_consume',
  extensions.digest(
    pg_catalog.convert_to('phase8b-initial-consume', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '110 minutes',
  pg_catalog.transaction_timestamp() - interval '115 minutes',
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
  '78f00000-0000-4000-8000-000000000001',
  'integration_credential_authority_v1',
  '18f00000-0000-4000-8000-000000000001',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8f00000-0000-4000-8000-000000000001',
  1,
  'oauth_credential_envelope_v1',
  'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b8f00000-0000-4000-8000-000000000001',
    'e8f00000-0000-4000-8000-000000000001',
    1,
    'quickbooks_online',
    '78f00000-0000-4000-8000-000000000001'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('h', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() - interval '1 minute',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-reauthorization-realm'
  ),
  'active',
  'phase8b_reauthorization_initial_store',
  extensions.digest(
    pg_catalog.convert_to('phase8b-initial-store', 'UTF8'),
    'sha256'
  ),
  1,
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
) values (
  '28f00000-0000-4000-8000-000000000001',
  'integration_sync_run_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  'f8f00000-0000-4000-8000-000000000001',
  1,
  'provider_initialization',
  'initialization',
  'running',
  extensions.digest(
    pg_catalog.convert_to('phase8b-reauthorization-run', 'UTF8'),
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
);

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
  ('38f00000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'integration_sync_task_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  1,
  '28f00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_bulk',
  'initial_historical',
  'qbo_invoice',
  'retry_wait',
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8f00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_expired_credential_recovery',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-reauth-task-' || series.value, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-reauth-task-coalescing-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  null,
  1,
  3,
  pg_catalog.transaction_timestamp() + interval '5 minutes',
  'phase8b_reauthorization_recovery',
  extensions.digest(
    pg_catalog.convert_to('phase8b-reauthorization-recovery', 'UTF8'),
    'sha256'
  ),
  5,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  pg_catalog.transaction_timestamp() + interval '7 days'
from pg_catalog.generate_series(1, 24) as series(value);

insert into private.integration_sync_task_recovery_events (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, credential_id, credential_version, task_id,
  recovery_generation, prior_state, prior_failure_category,
  prior_failure_code, prior_row_version, prior_completed_at,
  retry_after_seconds, request_id, request_fingerprint, actor_id,
  recovered_at, created_at
)
select
  ('48f00000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'qbo_sandbox_expired_credential_recovery_v1',
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  1,
  '78f00000-0000-4000-8000-000000000001',
  1,
  ('38f00000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  1,
  'failed',
  'contract',
  'phase8b_provider_task_failed',
  4,
  pg_catalog.transaction_timestamp() - interval '30 minutes'
    + series.value * interval '1 millisecond',
  30,
  'phase8b_reauthorization_recovery',
  extensions.digest(
    pg_catalog.convert_to('phase8b-reauthorization-recovery', 'UTF8'),
    'sha256'
  ),
  'phase8b_credential_recovery',
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  pg_catalog.transaction_timestamp() - interval '20 minutes'
from pg_catalog.generate_series(1, 24) as series(value);

create temporary table phase8b_reauthorization_task_snapshot on commit drop as
select
  id, state, row_version, attempt_count, dispatch_generation,
  last_request_id, last_request_fingerprint, dispatcher_task_name,
  control_metadata, sync_run_id
from private.integration_sync_tasks
where connection_id = 'e8f00000-0000-4000-8000-000000000001';

create temporary table phase8b_reauthorization_mapping_snapshot on commit drop as
select *
from private.provider_entity_mappings
where id = 'f8f00000-0000-4000-8000-000000000001';

create temporary table phase8b_reauthorization_credential_snapshot on commit drop as
select
  id, credential_ciphertext, granted_scopes, created_at, updated_at,
  aad_digest, kms_key_resource, oauth_state_id, last_request_id,
  last_request_fingerprint
from private.integration_credentials
where id = '78f00000-0000-4000-8000-000000000001';

create or replace function pg_temp.reauthorization_create_command(
  p_id uuid,
  p_state text,
  p_ttl interval default interval '10 minutes'
)
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_reauthorization_state_v1',
    'id', p_id,
    'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
    'connectionId', 'e8f00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'mappingId', 'f8f00000-0000-4000-8000-000000000001',
    'providerKey', 'quickbooks_online',
    'providerEnvironment', 'sandbox',
    'initiatedBy', 'a8f00000-0000-4000-8000-000000000001',
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'redirectUri',
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback',
    'returnIntent', '/phase8b/sandbox/reauthorized',
    'authorizationPurpose', 'reauthorization',
    'reasonCode', 'expired_credential_recovery',
    'stateHash', pg_temp.fingerprint(p_state),
    'createdAt', pg_temp.timestamp_text(pg_catalog.transaction_timestamp()),
    'expiresAt', pg_temp.timestamp_text(
      pg_catalog.transaction_timestamp() + p_ttl
    )
  );
$function$;

create or replace function pg_temp.reauthorization_consume_command(
  p_state text,
  p_realm_fingerprint text default
    'sha256:2f612e5956063a3439d0f08359dbc263a098680bd90722142c62ae88190ed379'
)
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
    'connectionId', 'e8f00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'mappingId', 'f8f00000-0000-4000-8000-000000000001',
    'providerKey', 'quickbooks_online',
    'providerEnvironment', 'sandbox',
    'initiatedBy', 'a8f00000-0000-4000-8000-000000000001',
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'redirectUri',
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback',
    'returnIntent', '/phase8b/sandbox/reauthorized',
    'authorizationPurpose', 'reauthorization',
    'reasonCode', 'expired_credential_recovery',
    'stateHash', pg_temp.fingerprint(p_state),
    'providerEntityReferenceFingerprint', p_realm_fingerprint,
    'consumedAt', pg_temp.timestamp_text(pg_catalog.transaction_timestamp())
  );
$function$;

create or replace function pg_temp.reauthorization_store_command(
  p_state_id uuid,
  p_credential_id uuid,
  p_reauthorized_at text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_credential_reauthorization_v1',
    'id', p_credential_id,
    'reauthorizationStateId', p_state_id,
    'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
    'connectionId', 'e8f00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'mappingId', 'f8f00000-0000-4000-8000-000000000001',
    'providerKey', 'quickbooks_online',
    'providerEnvironment', 'sandbox',
    'initiatedBy', 'a8f00000-0000-4000-8000-000000000001',
    'envelopeSchemaVersion', 'oauth_credential_envelope_v1',
    'aadSchemaVersion', 'oauth_credential_aad_v1',
    'aadDigest', private.phase_5_fingerprint_text_v1(
      private.phase_5_credential_aad_digest_v1(
        'sandbox',
        'b8f00000-0000-4000-8000-000000000001',
        'e8f00000-0000-4000-8000-000000000001',
        1,
        'quickbooks_online',
        p_credential_id
      )
    ),
    'kmsKeyResource',
      'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
    'ciphertextBase64', pg_catalog.translate(
      pg_catalog.encode(
        pg_catalog.convert_to(pg_catalog.repeat('n', 256), 'UTF8'),
        'base64'
      ),
      E'\n\r',
      ''
    ),
    'accessExpiresAt', pg_temp.timestamp_text(
      p_reauthorized_at::timestamptz + interval '1 hour'
    ),
    'refreshExpiresAt', pg_temp.timestamp_text(
      p_reauthorized_at::timestamptz + interval '30 days'
    ),
    'grantedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'externalEntityReferenceFingerprint',
      'sha256:2f612e5956063a3439d0f08359dbc263a098680bd90722142c62ae88190ed379',
    'mappingRevalidationFingerprint',
      pg_temp.fingerprint('phase8b-reauthorization-company-v2'),
    'reauthorizedAt', p_reauthorized_at
  );
$function$;

select ok(
  has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.create_integration_reauthorization_state_v1(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.consume_integration_reauthorization_state_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.store_reauthorized_integration_credential_v1(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.store_reauthorized_integration_credential_v1(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v3(jsonb,text)',
    'EXECUTE'
  ),
  'reauthorization creation/consumption and credential replacement use distinct narrow authorities'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.create_integration_reauthorization_state_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.consume_integration_reauthorization_state_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.store_reauthorized_integration_credential_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_oauth_ingress_authority',
    'private.integration_reauthorization_states',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_reauthorization_states',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service_role and direct private-table DML receive no reauthorization shortcut'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.integration_reauthorization_states'::regclass
  ),
  'reauthorization state persistence has enabled and forced RLS'
);

set local role integration_oauth_ingress_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_oauth_state_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'integration_oauth_state_v1',
        'id', '58f00000-0000-4000-8000-000000000001',
        'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
        'connectionId', 'e8f00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'providerKey', 'quickbooks_online',
        'providerEnvironment', 'sandbox',
        'initiatedBy', 'a8f00000-0000-4000-8000-000000000001',
        'requestedScopes', pg_catalog.jsonb_build_array(
          'com.intuit.quickbooks.accounting'
        ),
        'returnIntent', '/phase8b/sandbox/authorized',
        'stateHash', pg_temp.fingerprint('phase8b-initial-denied'),
        'createdAt', pg_temp.timestamp_text(pg_catalog.transaction_timestamp()),
        'expiresAt', pg_temp.timestamp_text(
          pg_catalog.transaction_timestamp() + interval '10 minutes'
        )
      ),
      'phase8b_initial_authorization_still_denied'
    )$$,
    '42501'
  ),
  'first authorization remains pending_authorization-only'
);

select is(
  public.consume_integration_reauthorization_state_v1(
    pg_temp.reauthorization_consume_command('phase8b-initial-oauth-state'),
    'phase8b_initial_state_reauthorization_denied'
  ) ->> 'reasonCode',
  'state_missing',
  'an initial OAuth state cannot be consumed as reauthorization'
);

create temporary table phase8b_reauthorization_current on commit drop as
select public.create_integration_reauthorization_state_v1(
  pg_temp.reauthorization_create_command(
    '58f00000-0000-4000-8000-000000000010',
    'r1_phase8b-current'
  ),
  'phase8b_reauthorization_current_create'
) as result;
select is(
  (select result ->> 'connectionRowVersion' from phase8b_reauthorization_current),
  '3',
  'current authoritative connection row version three is database-derived'
);
select is(
  (select result ->> 'recoveryEvidenceCount' from phase8b_reauthorization_current),
  '24',
  'the bounded state captures all 24 existing recovery evidence rows'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_reauthorization_state_v1(
      pg_catalog.jsonb_set(
        pg_temp.reauthorization_create_command(
          '58f00000-0000-4000-8000-000000000011',
          'r1_phase8b-forged-version'
        ),
        '{expectedConnectionRowVersion}',
        '4'::jsonb
      ),
      'phase8b_reauthorization_forged_version'
    )$$,
    '22023'
  ),
  'a caller cannot choose or widen the trusted connection row version'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_reauthorization_state_v1(
      pg_catalog.jsonb_set(
        pg_temp.reauthorization_create_command(
          '58f00000-0000-4000-8000-000000000012',
          'r1_phase8b-wrong-environment'
        ),
        '{providerEnvironment}',
        pg_catalog.to_jsonb('production'::text)
      ),
      'phase8b_reauthorization_wrong_environment'
    )$$,
    '22023'
  ),
  'wrong provider environment fails before authority discovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_reauthorization_state_v1(
      pg_catalog.jsonb_set(
        pg_temp.reauthorization_create_command(
          '58f00000-0000-4000-8000-000000000013',
          'r1_phase8b-wrong-workspace'
        ),
        '{workspaceId}',
        pg_catalog.to_jsonb(
          'b8f00000-0000-4000-8000-000000000099'::text
        )
      ),
      'phase8b_reauthorization_wrong_workspace'
    )$$,
    '42501'
  ),
  'wrong workspace or Business Entity cannot discover reauthorization authority'
);

select is(
  public.consume_integration_oauth_state_v2(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
      'connectionId', 'e8f00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'providerKey', 'quickbooks_online',
      'providerEnvironment', 'sandbox',
      'initiatedBy', 'a8f00000-0000-4000-8000-000000000001',
      'requestedScopes', pg_catalog.jsonb_build_array(
        'com.intuit.quickbooks.accounting'
      ),
      'returnIntent', '/phase8b/sandbox/authorized',
      'stateHash', pg_temp.fingerprint('r1_phase8b-current'),
      'consumedAt', pg_temp.timestamp_text(pg_catalog.transaction_timestamp())
    ),
    'phase8b_reauthorization_state_initial_denied'
  ) ->> 'reasonCode',
  'state_missing',
  'a reauthorization state cannot be consumed as initial authorization'
);

create temporary table phase8b_reauthorization_wrong_realm on commit drop as
select public.create_integration_reauthorization_state_v1(
  pg_temp.reauthorization_create_command(
    '58f00000-0000-4000-8000-000000000020',
    'r1_phase8b-wrong-realm'
  ),
  'phase8b_reauthorization_wrong_realm_create'
) as result;
select is(
  public.consume_integration_reauthorization_state_v1(
    pg_temp.reauthorization_consume_command(
      'r1_phase8b-wrong-realm',
      'sha256:3a22428b7977d0a3a80f2bb06454cfbf98f6fddfa47c95f3b9e97750d58cb496'
    ),
    'phase8b_reauthorization_wrong_realm_consume'
  ) ->> 'reasonCode',
  'state_invalid',
  'a different QBO realm fails closed before credential replacement'
);

select public.create_integration_reauthorization_state_v1(
  pg_temp.reauthorization_create_command(
    '58f00000-0000-4000-8000-000000000030',
    'r1_phase8b-expired',
    interval '100 milliseconds'
  ),
  'phase8b_reauthorization_expired_create'
);
select pg_catalog.pg_sleep(0.2);
select is(
  public.consume_integration_reauthorization_state_v1(
    pg_temp.reauthorization_consume_command('r1_phase8b-expired'),
    'phase8b_reauthorization_expired_consume'
  ) ->> 'reasonCode',
  'state_expired',
  'expired reauthorization state fails closed and becomes terminal'
);

create temporary table phase8b_reauthorization_stale_consume on commit drop as
select public.consume_integration_reauthorization_state_v1(
  pg_temp.reauthorization_consume_command('r1_phase8b-current'),
  'phase8b_reauthorization_current_consume'
) as result;
select is(
  (select result ->> 'accepted' from phase8b_reauthorization_stale_consume),
  'true',
  'the current version succeeds through bounded state consumption'
);
select is(
  public.consume_integration_reauthorization_state_v1(
    pg_temp.reauthorization_consume_command('r1_phase8b-current'),
    'phase8b_reauthorization_current_replay'
  ) ->> 'reasonCode',
  'state_replayed',
  'OAuth state replay is rejected before provider or credential work'
);
reset role;

create or replace function pg_temp.simulate_stale_connection_completion()
returns boolean
language plpgsql
as $function$
declare
  v_state_id uuid := (
    select (result ->> 'stateId')::uuid
    from phase8b_reauthorization_current
  );
  v_consumed_at text := (
    select result ->> 'consumedAt'
    from phase8b_reauthorization_stale_consume
  );
begin
  begin
    update private.integration_connections
    set status = 'degraded',
        state_reason_code = 'freshness_warning',
        status_changed_at = pg_catalog.transaction_timestamp(),
        row_version = row_version + 1,
        updated_at = pg_catalog.transaction_timestamp()
    where id = 'e8f00000-0000-4000-8000-000000000001';
    perform public.store_reauthorized_integration_credential_v1(
      pg_temp.reauthorization_store_command(
        v_state_id,
        '68f00000-0000-4000-8000-000000000010',
        v_consumed_at
      ),
      'phase8b_reauthorization_stale_store'
    );
    return false;
  exception when sqlstate '40001' then
    return true;
  end;
end;
$function$;

select ok(
  pg_temp.simulate_stale_connection_completion(),
  'a concurrent lifecycle mutation invalidates completion by connection CAS'
);
select ok(
  (
    select status = 'initializing' and row_version = 3
    from private.integration_connections
    where id = 'e8f00000-0000-4000-8000-000000000001'
  )
  and (
    select status = 'active' and credential_version = 1
    from private.integration_credentials
    where id = '78f00000-0000-4000-8000-000000000001'
  ),
  'failed stale completion leaves the expired credential and initializing connection reconstructable'
);

create or replace function pg_temp.simulate_ineligible_lifecycle_create()
returns boolean
language plpgsql
as $function$
begin
  begin
    update private.integration_connections
    set status = 'degraded',
        state_reason_code = 'freshness_warning',
        status_changed_at = pg_catalog.transaction_timestamp(),
        row_version = row_version + 1,
        updated_at = pg_catalog.transaction_timestamp()
    where id = 'e8f00000-0000-4000-8000-000000000001';
    perform public.create_integration_reauthorization_state_v1(
      pg_temp.reauthorization_create_command(
        '58f00000-0000-4000-8000-000000000040',
        'r1_phase8b-ineligible'
      ),
      'phase8b_reauthorization_ineligible_create'
    );
    return false;
  exception when sqlstate '42501' then
    return true;
  end;
end;
$function$;
select ok(
  pg_temp.simulate_ineligible_lifecycle_create(),
  'only initializing with initial_sync_pending is eligible for this recovery path'
);

set local role integration_oauth_ingress_authority;
create temporary table phase8b_reauthorization_success_state on commit drop as
select public.create_integration_reauthorization_state_v1(
  pg_temp.reauthorization_create_command(
    '58f00000-0000-4000-8000-000000000050',
    'r1_phase8b-success'
  ),
  'phase8b_reauthorization_success_create'
) as result;
create temporary table phase8b_reauthorization_success_consume on commit drop as
select public.consume_integration_reauthorization_state_v1(
  pg_temp.reauthorization_consume_command('r1_phase8b-success'),
  'phase8b_reauthorization_success_consume'
) as result;
reset role;

select pg_catalog.set_config(
  'vaeroex.test_reauthorization_state_id',
  (select result ->> 'stateId' from phase8b_reauthorization_success_state),
  true
);
select pg_catalog.set_config(
  'vaeroex.test_reauthorization_consumed_at',
  (select result ->> 'consumedAt' from phase8b_reauthorization_success_consume),
  true
);

set local role integration_credential_broker_authority;
create temporary table phase8b_reauthorization_success_store on commit drop as
select public.store_reauthorized_integration_credential_v1(
  pg_temp.reauthorization_store_command(
    (
      select pg_catalog.current_setting(
        'vaeroex.test_reauthorization_state_id'
      )::uuid
    ),
    '68f00000-0000-4000-8000-000000000050',
    (
      select pg_catalog.current_setting(
        'vaeroex.test_reauthorization_consumed_at'
      )
    )
  ),
  'phase8b_reauthorization_success_store'
) as result;
select is(
  (select result ->> 'credentialVersion' from phase8b_reauthorization_success_store),
  '2',
  'successful reauthorization appends credential version two'
);
select is(
  (select result ->> 'connectionStatus' from phase8b_reauthorization_success_store),
  'initializing',
  'credential replacement does not activate the connection'
);
select is(
  public.store_reauthorized_integration_credential_v1(
    pg_temp.reauthorization_store_command(
      (
        select pg_catalog.current_setting(
          'vaeroex.test_reauthorization_state_id'
        )::uuid
      ),
      '68f00000-0000-4000-8000-000000000050',
      (
        select pg_catalog.current_setting(
          'vaeroex.test_reauthorization_consumed_at'
        )
      )
    ),
    'phase8b_reauthorization_success_store'
  ) ->> 'idempotent',
  'true',
  'an identical completion retry is idempotent without another credential'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.store_reauthorized_integration_credential_v1(
      pg_temp.reauthorization_store_command(
        (
          select pg_catalog.current_setting(
            'vaeroex.test_reauthorization_state_id'
          )::uuid
        ),
        '68f00000-0000-4000-8000-000000000051',
        (
          select pg_catalog.current_setting(
            'vaeroex.test_reauthorization_consumed_at'
          )
        )
      ),
      'phase8b_reauthorization_second_completion'
    )$$,
    '23505'
  ),
  'a second completion cannot create a competing current credential'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_credentials
    where workspace_id = 'b8f00000-0000-4000-8000-000000000001'
      and business_entity_id = 'd8f00000-0000-4000-8000-000000000001'
      and connection_id = 'e8f00000-0000-4000-8000-000000000001'
      and connection_generation = 1
  ),
  '2',
  'same connection generation retains exactly one historical and one replacement credential'
);
select ok(
  (
    select status = 'superseded'
      and credential_version = 1
      and superseded_at is not null
    from private.integration_credentials
    where id = '78f00000-0000-4000-8000-000000000001'
  )
  and (
    select status = 'active'
      and credential_version = 2
      and supersedes_credential_id =
        '78f00000-0000-4000-8000-000000000001'
      and oauth_state_id is null
      and reauthorization_state_id is not null
    from private.integration_credentials
    where id = '68f00000-0000-4000-8000-000000000050'
  ),
  'new authoritative credential atomically supersedes version one with explicit lineage'
);
select ok(
  not exists (
    select 1
    from phase8b_reauthorization_credential_snapshot as before
    join private.integration_credentials as after using (id)
    where after.credential_ciphertext is distinct from before.credential_ciphertext
      or after.granted_scopes is distinct from before.granted_scopes
      or after.created_at is distinct from before.created_at
      or after.updated_at is distinct from before.updated_at
      or after.aad_digest is distinct from before.aad_digest
      or after.kms_key_resource is distinct from before.kms_key_resource
      or after.oauth_state_id is distinct from before.oauth_state_id
      or after.last_request_id is distinct from before.last_request_id
      or after.last_request_fingerprint is distinct from before.last_request_fingerprint
  ),
  'superseded credential ciphertext, scopes, issuance, AAD and initial authorization request provenance remain immutable'
);
select ok(
  (
    select status = 'completed'
      and replacement_credential_id =
        '68f00000-0000-4000-8000-000000000050'
      and mapping_revalidation_fingerprint is not null
    from private.integration_reauthorization_states
    where id = '58f00000-0000-4000-8000-000000000050'
  ),
  'completed state retains replacement and mapping-revalidation evidence'
);
select ok(
  not exists (
    (select * from phase8b_reauthorization_mapping_snapshot)
    except
    (select * from private.provider_entity_mappings
      where id = 'f8f00000-0000-4000-8000-000000000001')
  )
  and (
    select pg_catalog.count(*) = 1
    from private.provider_entity_mappings
    where connection_id = 'e8f00000-0000-4000-8000-000000000001'
  ),
  'existing verified realm mapping is revalidated without mutation or duplication'
);
select ok(
  not exists (
    (select * from phase8b_reauthorization_task_snapshot)
    except
    (select
      id, state, row_version, attempt_count, dispatch_generation,
      last_request_id, last_request_fingerprint, dispatcher_task_name,
      control_metadata, sync_run_id
     from private.integration_sync_tasks
     where connection_id = 'e8f00000-0000-4000-8000-000000000001')
  )
  and (
    select pg_catalog.count(*) = 24
    from private.integration_sync_tasks
    where connection_id = 'e8f00000-0000-4000-8000-000000000001'
      and state = 'retry_wait'
      and dispatcher_task_name is null
  ),
  'all 24 recovered tasks remain paused, undispatched and lineage-identical'
);

create or replace function pg_temp.insert_failed_purchase_task(
  p_task_id uuid,
  p_failure_request_id text
)
returns void
language plpgsql
set search_path = ''
as $function$
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
    failure_code, last_request_id, last_request_fingerprint, row_version,
    created_at, updated_at, completed_at, retention_expires_at
  ) values (
    p_task_id,
    'integration_sync_task_v1',
    'b8f00000-0000-4000-8000-000000000001',
    'd8f00000-0000-4000-8000-000000000001',
    'e8f00000-0000-4000-8000-000000000001',
    1,
    '28f00000-0000-4000-8000-000000000001',
    'quickbooks_online',
    'sandbox',
    'provider_bulk',
    'initial_historical',
    'qbo_purchase',
    'failed',
    40,
    pg_catalog.jsonb_build_object(
      'checkpointId', null,
      'mappingId', 'f8f00000-0000-4000-8000-000000000001',
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'credential_reauthorization_required',
      'recordHintCount', 0,
      'coalescedEventCount', 1
    ),
    extensions.digest(
      pg_catalog.convert_to('purchase-idempotency:' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    extensions.digest(
      pg_catalog.convert_to('purchase-coalescing:' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    null,
    1,
    'attributed',
    1,
    0,
    0,
    extensions.digest(
      pg_catalog.convert_to('purchase-delivery:' || p_task_id::text, 'UTF8'),
      'sha256'
    ),
    1,
    3,
    pg_catalog.transaction_timestamp() - interval '1 minute',
    'authorization',
    'credential_reauthorization_required',
    p_failure_request_id,
    extensions.digest(
      pg_catalog.convert_to(p_failure_request_id, 'UTF8'),
      'sha256'
    ),
    4,
    pg_catalog.transaction_timestamp() - interval '1 hour',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp() + interval '7 days'
  );
  perform private.phase_6_insert_audit_v1(
    'b8f00000-0000-4000-8000-000000000001',
    'd8f00000-0000-4000-8000-000000000001',
    'e8f00000-0000-4000-8000-000000000001',
    'phase8b_provider_runtime',
    'integration_sync_task.fail',
    'failed',
    'integration_sync_task',
    p_task_id::text,
    p_failure_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', 'failed',
      'task_kind', 'initial_historical',
      'queue_class', 'provider_bulk',
      'attempt_count', 1,
      'dispatch_generation', 1,
      'delivery_retry_count', 0,
      'delivery_execution_count', 0,
      'row_version', 4,
      'idempotent', false
    )
  );
end;
$function$;

select pg_temp.insert_failed_purchase_task(
  '38f00000-0000-4000-8000-000000000099',
  'phase8b_purchase_original_failure'
);

select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.recover_qbo_sandbox_reauthorized_purchase_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_reauthorized_purchase_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.recover_qbo_sandbox_reauthorized_purchase_task_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_sync_task_reauthorization_recovery_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'purchase recovery is broker-RPC-only with no service/runtime shortcut or direct DML'
);

set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_reauthorized_purchase_recovery_v1',
        'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
        'connectionId', 'e8f00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', '68f00000-0000-4000-8000-000000000050',
        'expectedCredentialVersion', 2,
        'expectedCredentialRowVersion', 1,
        'mappingId', 'f8f00000-0000-4000-8000-000000000001',
        'expectedMappingRowVersion', 1,
        'taskId', '38f00000-0000-4000-8000-000000000099',
        'expectedTaskRowVersion', 5,
        'retryAfterSeconds', 30
      ),
      'phase8b_purchase_recovery_stale',
      'phase8b_credential_broker'
    )$$,
    '42501'
  ),
  'purchase recovery rejects a stale task CAS snapshot'
);
create temporary table phase8b_purchase_recovery_result on commit drop as
select public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_reauthorized_purchase_recovery_v1',
    'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
    'connectionId', 'e8f00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'credentialId', '68f00000-0000-4000-8000-000000000050',
    'expectedCredentialVersion', 2,
    'expectedCredentialRowVersion', 1,
    'mappingId', 'f8f00000-0000-4000-8000-000000000001',
    'expectedMappingRowVersion', 1,
    'taskId', '38f00000-0000-4000-8000-000000000099',
    'expectedTaskRowVersion', 4,
    'retryAfterSeconds', 30
  ),
  'phase8b_purchase_recovery',
  'phase8b_credential_broker'
) as result;
select is(
  (select result ->> 'state' from phase8b_purchase_recovery_result),
  'retry_wait',
  'valid replacement credential returns the same failed purchase task to retry_wait'
);
select is(
  public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_reauthorized_purchase_recovery_v1',
      'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
      'connectionId', 'e8f00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'credentialId', '68f00000-0000-4000-8000-000000000050',
      'expectedCredentialVersion', 2,
      'expectedCredentialRowVersion', 1,
      'mappingId', 'f8f00000-0000-4000-8000-000000000001',
      'expectedMappingRowVersion', 1,
      'taskId', '38f00000-0000-4000-8000-000000000099',
      'expectedTaskRowVersion', 4,
      'retryAfterSeconds', 30
    ),
    'phase8b_purchase_recovery',
    'phase8b_credential_broker'
  ) ->> 'idempotent',
  'true',
  'repeated purchase recovery is idempotent'
);
reset role;

select ok(
  (
    select state = 'retry_wait'
      and id = '38f00000-0000-4000-8000-000000000099'
      and sync_run_id = '28f00000-0000-4000-8000-000000000001'
      and stream_key = 'qbo_purchase'
      and dispatch_generation = 1
      and dispatcher_task_name is null
      and attempt_count = 1
      and durable_effect_fingerprint is null
      and row_version = 5
    from private.integration_sync_tasks
    where id = '38f00000-0000-4000-8000-000000000099'
  ),
  'purchase recovery preserves identity, lineage, prior generation, no-effect evidence and retry architecture'
);
select ok(
  (
    select prior_state = 'failed'
      and prior_failure_category = 'authorization'
      and prior_failure_code = 'credential_reauthorization_required'
      and prior_dispatch_generation = 1
      and prior_dispatcher_task_name_fingerprint is null
      and replacement_credential_version = 2
    from private.integration_sync_task_reauthorization_recovery_events
    where task_id = '38f00000-0000-4000-8000-000000000099'
  )
  and exists (
    select 1
    from private.integration_audit_events
    where action = 'integration_sync_task.fail'
      and outcome = 'failed'
      and target_id = '38f00000-0000-4000-8000-000000000099'
  ),
  'immutable recovery evidence supplements rather than replaces the terminal failure audit'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_reauthorization_recovery_events
      set actor_id = 'forged'
      where task_id = '38f00000-0000-4000-8000-000000000099'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_reauthorization_recovery_events
      where task_id = '38f00000-0000-4000-8000-000000000099'$$,
    '55000'
  ),
  'purchase recovery evidence is update/delete immutable'
);

select pg_temp.insert_failed_purchase_task(
  '38f00000-0000-4000-8000-000000000098',
  'phase8b_revoked_purchase_original_failure'
);
select private.phase_5_insert_audit_v1(
  'b8f00000-0000-4000-8000-000000000001',
  'd8f00000-0000-4000-8000-000000000001',
  'e8f00000-0000-4000-8000-000000000001',
  'service',
  'phase8b_credential_broker',
  'credential_refresh_boundary',
  'failed',
  'integration_credential',
  '68f00000-0000-4000-8000-000000000050',
  'phase8b_replacement_invalid_grant',
  'invalid_grant',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_version', 2,
    'refresh_boundary_stage', 'provider_response_parse',
    'refresh_operation_fingerprint',
      pg_temp.fingerprint('phase8b-replacement-invalid-grant-refresh'),
    'refresh_diagnostics', null
  ),
  pg_catalog.clock_timestamp()
);
set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_reauthorized_purchase_task_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_reauthorized_purchase_recovery_v1',
        'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
        'connectionId', 'e8f00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', '68f00000-0000-4000-8000-000000000050',
        'expectedCredentialVersion', 2,
        'expectedCredentialRowVersion', 1,
        'mappingId', 'f8f00000-0000-4000-8000-000000000001',
        'expectedMappingRowVersion', 1,
        'taskId', '38f00000-0000-4000-8000-000000000098',
        'expectedTaskRowVersion', 4,
        'retryAfterSeconds', 30
      ),
      'phase8b_revoked_purchase_recovery',
      'phase8b_credential_broker'
    )$$,
    '42501'
  ),
  'replacement credential invalid_grant evidence is not recoverable'
);
reset role;
select ok(
  (
    select status = 'initializing'
      and state_reason_code = 'initial_sync_pending'
      and connection_generation = 1
      and row_version = 3
    from private.integration_connections
    where id = 'e8f00000-0000-4000-8000-000000000001'
  ),
  'workspace, Business Entity, connection, generation and initialization lifecycle remain unchanged'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.external_source_record_versions
    where workspace_id = 'b8f00000-0000-4000-8000-000000000001'
      and business_entity_id = 'd8f00000-0000-4000-8000-000000000001'
      and connection_id = 'e8f00000-0000-4000-8000-000000000001'
  ),
  '0',
  'reauthorization performs no provider data read or source ingestion'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_credentials
      set credential_ciphertext = pg_catalog.convert_to('forged', 'UTF8'),
          row_version = row_version + 1,
          updated_at = pg_catalog.transaction_timestamp()
      where id = '78f00000-0000-4000-8000-000000000001'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$update private.integration_reauthorization_states
      set reason_code = 'forged', row_version = row_version + 1
      where id = '58f00000-0000-4000-8000-000000000050'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_reauthorization_states
      where id = '58f00000-0000-4000-8000-000000000050'$$,
    '55000'
  ),
  'credential history and reauthorization evidence are update/delete immutable'
);
select ok(
  not exists (
    select 1
    from private.integration_audit_events
    where connection_id = 'e8f00000-0000-4000-8000-000000000001'
      and metadata::text ~*
        '(access.?token|refresh.?token|client.?secret|authorization.?code|ciphertext|state.?hash|realm.?id)'
  ),
  'reauthorization audit metadata retains no credential or OAuth leakage canary'
);

select * from finish();
rollback;
