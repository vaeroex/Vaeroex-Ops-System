begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- pgTAP and pgcrypto live in the extensions schema. These test-only grants
-- are transaction-scoped and roll back with the synthetic fixture.
grant usage on schema extensions to
  integration_credential_broker_authority,
  integration_task_dispatch_authority,
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

create or replace function pg_temp.fingerprint(p_value text)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  );
$function$;

insert into public.profiles (id, email, full_name) values (
  'a8e00000-0000-4000-8000-000000000001',
  'phase8b-credential-recovery@example.test',
  'Phase 8B Credential Recovery'
);
insert into public.workspaces (id, name, created_by) values (
  'b8e00000-0000-4000-8000-000000000001',
  'Phase 8B Credential Recovery Workspace',
  'a8e00000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c8e00000-0000-4000-8000-000000000001',
  'b8e00000-0000-4000-8000-000000000001',
  'a8e00000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8e00000-0000-4000-8000-000000000001',
  'b8e00000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_credential_recovery',
  'operating_company',
  'Phase 8B Credential Recovery',
  'USD',
  'UTC',
  1,
  'active',
  'a8e00000-0000-4000-8000-000000000001',
  'a8e00000-0000-4000-8000-000000000001',
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
  'e8e00000-0000-4000-8000-000000000001',
  'integration_connection_v1',
  'integration_connection_control_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-recovery-realm'),
  'initializing',
  'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Phase 8B Recovery Sandbox',
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
  1,
  'a8e00000-0000-4000-8000-000000000001',
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
  'f8e00000-0000-4000-8000-000000000001',
  'provider_entity_mapping_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  'f8e00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'company',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-recovery-realm'),
  'Phase 8B Recovery Sandbox',
  'primary',
  'active',
  'qbo_realm_mapping_v1',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-company-verified', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  'a8e00000-0000-4000-8000-000000000001',
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
  '18e00000-0000-4000-8000-000000000001',
  'integration_oauth_state_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8e00000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  '/phase8b/sandbox/authorized',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-oauth-state', 'UTF8'),
    'sha256'
  ),
  'consumed',
  'phase8b_recovery_oauth_create',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-oauth-create', 'UTF8'),
    'sha256'
  ),
  'phase8b_recovery_oauth_consume',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-oauth-consume', 'UTF8'),
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
  '78e00000-0000-4000-8000-000000000001',
  'integration_credential_authority_v1',
  '18e00000-0000-4000-8000-000000000001',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8e00000-0000-4000-8000-000000000001',
  1,
  'oauth_credential_envelope_v1',
  'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b8e00000-0000-4000-8000-000000000001',
    'e8e00000-0000-4000-8000-000000000001',
    1,
    'quickbooks_online',
    '78e00000-0000-4000-8000-000000000001'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('r', 256), 'UTF8'),
  pg_catalog.transaction_timestamp() + interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-recovery-realm'),
  'active',
  'phase8b_recovery_credential_store',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-credential-store', 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.integration_workspace_policies (
  id, contract_version, workspace_id, provider_key, provider_environment,
  state, sync_enabled, history_horizon_days, maximum_concurrency,
  freshness_policy_version, retention_policy_version, row_version,
  last_request_id, last_request_fingerprint, created_at, updated_at
) values (
  '08e00000-0000-4000-8000-000000000001',
  'integration_workspace_policy_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'enabled',
  true,
  400,
  2,
  'qbo_control_plane_freshness_policy_v1',
  'qbo_metadata_retention_v1',
  1,
  'phase8b_recovery_workspace_policy',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-workspace-policy', 'UTF8'),
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
) values (
  '28e00000-0000-4000-8000-000000000001',
  'integration_sync_run_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  'f8e00000-0000-4000-8000-000000000001',
  1,
  'provider_initialization',
  'initialization',
  'running',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-run', 'UTF8'),
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

-- One leased task proves both V2 credential reads and long ciphertext
-- canonicalization before the access token expires.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatcher_task_name,
  dispatch_generation, delivery_attribution_state,
  last_delivery_dispatch_generation, last_delivery_retry_count,
  last_delivery_execution_count,
  last_delivery_attempt_fingerprint, attempt_count, maximum_attempts,
  available_at, lease_id, lease_owner_fingerprint, lease_expires_at,
  heartbeat_at, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at, retention_expires_at
) values (
  '38e00000-0000-4000-8000-000000000100',
  'integration_sync_task_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  '28e00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_interactive',
  'incremental',
  'qbo_invoice',
  'leased',
  50,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8e00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_recovery_read_fixture',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-read-task', 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-read-task-coalescing', 'UTF8'),
    'sha256'
  ),
  pg_catalog.repeat('e', 64),
  1,
  'attributed',
  1,
  0,
  0,
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-read-delivery', 'UTF8'),
    'sha256'
  ),
  1,
  3,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  '48e00000-0000-4000-8000-000000000100',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-read-owner', 'UTF8'),
    'sha256'
  ),
  pg_catalog.transaction_timestamp() + interval '10 minutes',
  pg_catalog.transaction_timestamp(),
  'phase8b_recovery_read_task',
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-read-request', 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '7 days'
);

select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.acquire_integration_credential_refresh_lease_v2(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v2(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v4(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.record_integration_provider_credential_task_read_failure_v1(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.record_integration_credential_refresh_boundary_v1(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.record_integration_credential_refresh_boundary_v2(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.recover_qbo_sandbox_expired_credential_tasks_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'credential broker receives the checked refresh, converged read, and recovery RPCs'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.record_integration_credential_refresh_boundary_v2(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.record_integration_credential_refresh_boundary_v2(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_expired_credential_tasks_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.recover_qbo_sandbox_expired_credential_tasks_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_sync_task_recovery_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service_role, provider runtime, and direct table DML receive no recovery shortcut'
);

set local role integration_credential_broker_authority;
create temporary table phase8b_recovery_provider_read_v5_first on commit drop as
select public.read_integration_provider_credential_v5(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_read_v1',
    'taskId', '38e00000-0000-4000-8000-000000000100',
    'leaseId', '48e00000-0000-4000-8000-000000000100',
    'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-recovery-read-owner'),
    'expectedCredentialVersion', 1,
    'requiredScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'minimumValiditySeconds', 300,
    'requestedAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp(),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  'phase8b_recovery_provider_read_v5_first'
) as result;
select is(
  pg_catalog.octet_length(
    pg_catalog.decode(
      (
        select result ->> 'ciphertextBase64'
        from phase8b_recovery_provider_read_v5_first
      ),
      'base64'
    )
  ),
  256,
  'task-bound provider read V5 retains canonical unbroken base64 behavior'
);

create temporary table phase8b_recovery_provider_read on commit drop as
select public.read_integration_provider_credential_v5(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_read_v1',
    'taskId', '38e00000-0000-4000-8000-000000000100',
    'leaseId', '48e00000-0000-4000-8000-000000000100',
    'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-recovery-read-owner'),
    'expectedCredentialVersion', 1,
    'requiredScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'minimumValiditySeconds', 300,
    'requestedAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  'phase8b_recovery_provider_read_v5'
) as result;
reset role;
select ok(
  (select result ->> 'state' from phase8b_recovery_provider_read) = 'available'
  and pg_catalog.length(
    (select result ->> 'ciphertextBase64' from phase8b_recovery_provider_read)
  ) > 76
  and pg_catalog.strpos(
    (select result ->> 'ciphertextBase64' from phase8b_recovery_provider_read),
    E'\n'
  ) = 0
  and pg_catalog.octet_length(
    pg_catalog.decode(
      (select result ->> 'ciphertextBase64' from phase8b_recovery_provider_read),
      'base64'
    )
  ) = 256
  and (
    select result ->> 'ciphertextPersistedAt'
    from phase8b_recovery_provider_read
  ) = (
    select pg_catalog.to_char(
      credential.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    from private.integration_credentials as credential
    where credential.id = '78e00000-0000-4000-8000-000000000001'
  )
  and (
    select result ->> 'refreshExpiresAt'
    from phase8b_recovery_provider_read
  ) = (
    select pg_catalog.to_char(
      credential.refresh_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    from private.integration_credentials as credential
    where credential.id = '78e00000-0000-4000-8000-000000000001'
  )
  and (
    select result ->> 'externalEntityReferenceFingerprint'
    from phase8b_recovery_provider_read
  ) = private.phase_5_fingerprint_text_v1(
    private.qbo_phase_8b_realm_fingerprint_v1('phase8b-recovery-realm')
  ),
  'provider read V5 returns canonical ciphertext and exact trusted binding metadata'
);
select is(
  (
    select result ->> 'credentialId'
    from phase8b_recovery_provider_read
  ),
  '78e00000-0000-4000-8000-000000000001',
  'provider read V5 deterministically returns the sole authoritative active credential'
);

set local role integration_credential_broker_authority;
savepoint phase8b_v4_post_rotation_read;
select ok(
  (
    public.acquire_integration_credential_refresh_lease_v1(
      pg_catalog.jsonb_build_object(
        'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
        'connectionId', 'e8e00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', '78e00000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', '98e00000-0000-4000-8000-000000000099',
        'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-v4-rotation-owner'),
        'acquiredAt', pg_catalog.transaction_timestamp(),
        'leaseExpiresAt',
          pg_catalog.transaction_timestamp() + interval '2 minutes'
      ),
      'phase8b_v4_rotation_lease'
    ) ->> 'acquired'
  )::boolean,
  'post-rotation V4 fixture acquires the checked refresh lease'
);
select is(
  public.rotate_integration_credential_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
      'connectionId', 'e8e00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'credentialId', '78e00000-0000-4000-8000-000000000001',
      'expectedCredentialVersion', 1,
      'leaseId', '98e00000-0000-4000-8000-000000000099',
      'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-v4-rotation-owner'),
      'aadDigest', (
        select result ->> 'aadDigest'
        from phase8b_recovery_provider_read
      ),
      'kmsKeyResource', (
        select result ->> 'kmsKeyResource'
        from phase8b_recovery_provider_read
      ),
      'ciphertextBase64', pg_catalog.translate(
        pg_catalog.encode(
          pg_catalog.decode(pg_catalog.repeat('ef', 256), 'hex'),
          'base64'
        ),
        E'\n\r',
        ''
      ),
      'accessExpiresAt', pg_catalog.clock_timestamp() + interval '1 hour',
      'refreshExpiresAt', pg_catalog.clock_timestamp() + interval '30 days',
      'grantedScopes', pg_catalog.jsonb_build_array(
        'com.intuit.quickbooks.accounting'
      ),
      'externalEntityReferenceFingerprint', (
        select result ->> 'externalEntityReferenceFingerprint'
        from phase8b_recovery_provider_read
      ),
      'rotatedAt', pg_catalog.clock_timestamp()
    ),
    'phase8b_v4_rotation_store'
  ) ->> 'credentialVersion',
  '2',
  'post-rotation V5 fixture persists a new authoritative ciphertext version'
);
create temporary table phase8b_recovery_provider_read_rotated on commit drop as
select public.read_integration_provider_credential_v5(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_read_v1',
    'taskId', '38e00000-0000-4000-8000-000000000100',
    'leaseId', '48e00000-0000-4000-8000-000000000100',
    'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-recovery-read-owner'),
    'expectedCredentialVersion', 2,
    'requiredScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'minimumValiditySeconds', 300,
    'requestedAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp(),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  'phase8b_recovery_provider_read_v5_rotated'
) as result;
reset role;
select ok(
  (
    select result ->> 'state' = 'available'
      and result ->> 'credentialVersion' = '2'
      and result ->> 'ciphertextPersistedAt' = (
        select pg_catalog.to_char(
          audit.occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
        from private.integration_audit_events as audit
        where audit.request_id = 'phase8b_v4_rotation_store'
          and audit.action = 'credential_rotated'
          and audit.outcome = 'succeeded'
      )
    from phase8b_recovery_provider_read_rotated
  ),
  'provider read V5 binds refreshed ciphertext to its one immutable rotation event'
);
rollback to savepoint phase8b_v4_post_rotation_read;
release savepoint phase8b_v4_post_rotation_read;
reset role;

create or replace function pg_temp.recovery_read_evidence_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select (result ->> 'credentialReadEvidenceId')::uuid
  from pg_temp.phase8b_recovery_provider_read;
$function$;

set local role integration_provider_runtime_authority;
select public.record_qbo_sandbox_provider_result_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_provider_result_evidence_v1',
    'credentialReadEvidenceId', pg_temp.recovery_read_evidence_id(),
    'requestOrdinal', 1,
    'endpointDomain', 'entity_query',
    'endpointClass', 'qbo_entity_query',
    'providerRequestFingerprint',
      'sha256:' || pg_catalog.repeat('a', 64),
    'providerOutcome', 'provider_success'
  ),
  'phase8b_recovery_provider_result'
);
reset role;

update private.integration_sync_tasks
set state = 'succeeded',
    lease_id = null,
    lease_owner_fingerprint = null,
    lease_expires_at = null,
    heartbeat_at = null,
    durable_effect_fingerprint = extensions.digest(
      pg_catalog.convert_to('phase8b-recovery-read-complete', 'UTF8'),
      'sha256'
    ),
    completed_at = pg_catalog.transaction_timestamp(),
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id = '38e00000-0000-4000-8000-000000000100';

update private.integration_credentials
set access_expires_at = pg_catalog.transaction_timestamp() - interval '1 minute',
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id = '78e00000-0000-4000-8000-000000000001';

-- The exact 24 recoverable tasks retain their original identities and terminal
-- evidence. One permanent failure and one pending fixture remain ineligible.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatch_generation,
  delivery_attribution_state,
  last_delivery_dispatch_generation, last_delivery_execution_count,
  last_delivery_attempt_fingerprint, attempt_count, maximum_attempts,
  available_at, failure_category, failure_code, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at, completed_at,
  retention_expires_at
)
select
  ('38e00000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'integration_sync_task_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  '28e00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_bulk',
  'initial_historical',
  'qbo_invoice',
  'failed',
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8e00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_expired_credential_incident',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-recovery-task-' || series.value, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-recovery-task-coalescing-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  'attributed',
  1,
  0,
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-recovery-original-delivery-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  3,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  'contract',
  'phase8b_provider_task_failed',
  'phase8b_recovery_original_failure_' || series.value,
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-recovery-original-failure-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  4,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '30 minutes'
    + series.value * interval '1 millisecond',
  pg_catalog.transaction_timestamp() - interval '30 minutes'
    + series.value * interval '1 millisecond',
  pg_catalog.transaction_timestamp() + interval '7 days'
from pg_catalog.generate_series(1, 24) as series(value);

insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatch_generation,
  last_delivery_execution_count, attempt_count, maximum_attempts,
  available_at, failure_category, failure_code, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at, completed_at,
  retention_expires_at
) values (
  '38e00000-0000-4000-8000-000000000200',
  'integration_sync_task_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  '28e00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_bulk',
  'initial_historical',
  'qbo_invoice',
  'failed',
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8e00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_permanent_failure',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-permanent-task', 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-permanent-task-coalescing', 'UTF8'),
    'sha256'
  ),
  1, null, 1, 3,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  'integrity',
  'phase8b_permanent_integrity_failure',
  'phase8b_permanent_failure',
  extensions.digest(
    pg_catalog.convert_to('phase8b-permanent-failure', 'UTF8'),
    'sha256'
  ),
  4,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  pg_catalog.transaction_timestamp() + interval '7 days'
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
  '38e00000-0000-4000-8000-000000000201',
  'integration_sync_task_v1',
  'b8e00000-0000-4000-8000-000000000001',
  'd8e00000-0000-4000-8000-000000000001',
  'e8e00000-0000-4000-8000-000000000001',
  1,
  '28e00000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_bulk',
  'initial_historical',
  'qbo_invoice',
  'pending',
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8e00000-0000-4000-8000-000000000001',
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'phase8b_unrelated_pending_fixture',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  ),
  extensions.digest(
    pg_catalog.convert_to('phase8b-unrelated-pending-task', 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-unrelated-pending-task-coalescing',
      'UTF8'
    ),
    'sha256'
  ),
  0, null, 0, 3,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  'phase8b_unrelated_pending_task',
  extensions.digest(
    pg_catalog.convert_to('phase8b-unrelated-pending-request', 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() - interval '1 hour',
  pg_catalog.transaction_timestamp() + interval '7 days'
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
  'integration_sync_task.fail',
  'failed',
  'integration_sync_task',
  task.id::text,
  task.last_request_id,
  null,
  '{}'::jsonb,
  task.completed_at,
  'operational'
from private.integration_sync_tasks as task
where task.id in (
  select (
    '38e00000-0000-4000-8000-' || pg_catalog.lpad(value::text, 12, '0')
  )::uuid
  from pg_catalog.generate_series(1, 24) as series(value)
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
  'integration_credential_broker',
  'credential_provider_read',
  'denied',
  'integration_credential',
  '78e00000-0000-4000-8000-000000000001',
  'phase8b_recovery_expired_read_' || task.id::text,
  'credential_expired',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_status', 'active',
    'credential_version', 1,
    'task_state', 'leased'
  ),
  task.completed_at - interval '1 second',
  'security'
from private.integration_sync_tasks as task
where task.id in (
  select (
    '38e00000-0000-4000-8000-' || pg_catalog.lpad(value::text, 12, '0')
  )::uuid
  from pg_catalog.generate_series(1, 24) as series(value)
);

create or replace function pg_temp.recovery_command(
  p_task_ids jsonb default null
)
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_expired_credential_recovery_v1',
    'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
    'connectionId', 'e8e00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'credentialId', '78e00000-0000-4000-8000-000000000001',
    'expectedCredentialVersion', 1,
    'taskIds', coalesce(
      p_task_ids,
      (
        select pg_catalog.jsonb_agg(
          (
            '38e00000-0000-4000-8000-'
            || pg_catalog.lpad(value::text, 12, '0')
          )::uuid
          order by value
        )
        from pg_catalog.generate_series(1, 24) as series(value)
      )
    ),
    'retryAfterSeconds', 30
  );
$function$;

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_tasks
      set state = 'retry_wait',
          failure_category = null,
          failure_code = null,
          completed_at = null,
          available_at = pg_catalog.transaction_timestamp() + interval '30 seconds',
          row_version = row_version + 1,
          updated_at = pg_catalog.transaction_timestamp()
      where id = '38e00000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'terminal tasks cannot bypass append-only recovery evidence'
);

set local role integration_credential_broker_authority;
create temporary table phase8b_recovery_lease on commit drop as
select public.acquire_integration_credential_refresh_lease_v2(
  pg_catalog.jsonb_build_object(
    'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
    'connectionId', 'e8e00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'credentialId', '78e00000-0000-4000-8000-000000000001',
    'expectedCredentialVersion', 1,
    'leaseId', '48e00000-0000-4000-8000-000000000001',
    'leaseOwnerFingerprint', pg_temp.fingerprint('phase8b-recovery-winner'),
    'acquiredAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'leaseExpiresAt', pg_catalog.to_char(
      (pg_catalog.transaction_timestamp() + interval '2 minutes')
        at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  'phase8b_recovery_refresh_lease_v2'
) as result;
select ok(
  (select (result ->> 'acquired')::boolean from phase8b_recovery_lease)
  and pg_catalog.strpos(
    (select result ->> 'ciphertextBase64' from phase8b_recovery_lease),
    E'\n'
  ) = 0
  and pg_catalog.octet_length(
    pg_catalog.decode(
      (select result ->> 'ciphertextBase64' from phase8b_recovery_lease),
      'base64'
    )
  ) = 256,
  'refresh lease V2 has one winner and returns canonical ciphertext bytes'
);

select is(
  public.record_integration_credential_refresh_boundary_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_credential_refresh_boundary_v1',
      'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
      'connectionId', 'e8e00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'credentialId', '78e00000-0000-4000-8000-000000000001',
      'credentialVersion', 1,
      'refreshOperationId', '48e00000-0000-4000-8000-000000000001',
      'actorId', 'phase8b_qbo_sandbox_refresh',
      'stage', 'broker_decrypt',
      'outcome', 'started',
      'reasonCode', 'started',
      'occurredAt', pg_catalog.to_char(
        pg_catalog.transaction_timestamp() at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    'phase8b_recovery_boundary_started'
  ) ->> 'idempotent',
  'false',
  'refresh boundary start is recorded without credential material'
);
select is(
  public.record_integration_credential_refresh_boundary_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_credential_refresh_boundary_v1',
      'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
      'connectionId', 'e8e00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'credentialId', '78e00000-0000-4000-8000-000000000001',
      'credentialVersion', 1,
      'refreshOperationId', '48e00000-0000-4000-8000-000000000001',
      'actorId', 'phase8b_qbo_sandbox_refresh',
      'stage', 'broker_decrypt',
      'outcome', 'started',
      'reasonCode', 'started',
      'occurredAt', pg_catalog.to_char(
        pg_catalog.transaction_timestamp() at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    'phase8b_recovery_boundary_started'
  ) ->> 'idempotent',
  'true',
  'refresh boundary replay is idempotent'
);
reset role;

create or replace function pg_temp.simulate_recovery_crash()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    perform public.recover_qbo_sandbox_expired_credential_tasks_v1(
      pg_temp.recovery_command(),
      'phase8b_recovery_crash_request',
      'phase8b_credential_recovery'
    );
    raise exception using
      errcode = 'P0001',
      message = 'phase8b_simulated_recovery_crash';
  exception when raise_exception then
    null;
  end;
  return not exists (
      select 1
      from private.integration_sync_task_recovery_events
      where request_id = 'phase8b_recovery_crash_request'
    )
    and (
      select pg_catalog.count(*)
      from private.integration_sync_tasks
      where id in (
        select (
          '38e00000-0000-4000-8000-'
          || pg_catalog.lpad(value::text, 12, '0')
        )::uuid
        from pg_catalog.generate_series(1, 24) as series(value)
      )
        and state = 'failed'
    ) = 24;
end;
$function$;

set local role integration_credential_broker_authority;
select ok(
  pg_temp.simulate_recovery_crash(),
  'crash around recovery rolls back task and append-only evidence atomically'
);
create temporary table phase8b_recovery_result on commit drop as
select public.recover_qbo_sandbox_expired_credential_tasks_v1(
  pg_temp.recovery_command(),
  'phase8b_recovery_request',
  'phase8b_credential_recovery'
) as result;
select is(
  (select result ->> 'recoveredTaskCount' from phase8b_recovery_result),
  '24',
  'one scoped recovery returns exactly the 24 incident tasks'
);
select is(
  (select result ->> 'recoveryGeneration' from phase8b_recovery_result),
  '1',
  'first append-only recovery uses generation one'
);
select is(
  public.recover_qbo_sandbox_expired_credential_tasks_v1(
    pg_temp.recovery_command(),
    'phase8b_recovery_request',
    'phase8b_credential_recovery'
  ) ->> 'idempotent',
  'true',
  'identical recovery replay is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_expired_credential_tasks_v1(
      pg_temp.recovery_command(
        pg_catalog.jsonb_build_array(
          '38e00000-0000-4000-8000-000000000200'
        )
      ),
      'phase8b_permanent_recovery_denied',
      'phase8b_credential_recovery'
    )$$,
    '42501'
  ),
  'genuinely permanent failure cannot use credential-expiry recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_expired_credential_tasks_v1(
      pg_temp.recovery_command(
        pg_catalog.jsonb_build_array(
          '38e00000-0000-4000-8000-000000000201'
        )
      ),
      'phase8b_pending_recovery_denied',
      'phase8b_credential_recovery'
    )$$,
    '42501'
  ),
  'unrelated pending fixture cannot be pulled into recovery'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where id in (
      select (
        '38e00000-0000-4000-8000-'
        || pg_catalog.lpad(value::text, 12, '0')
      )::uuid
      from pg_catalog.generate_series(1, 24) as series(value)
    )
      and state = 'retry_wait'
      and failure_category is null
      and failure_code is null
      and completed_at is null
      and attempt_count = 1
      and dispatch_generation = 1
      and durable_effect_fingerprint is null
  ),
  '24',
  'recovery preserves identity, attempt, dispatch, and no-effect state'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_recovery_events
    where request_id = 'phase8b_recovery_request'
      and recovery_generation = 1
      and prior_state = 'failed'
      and prior_failure_category = 'contract'
      and prior_failure_code = 'phase8b_provider_task_failed'
  ),
  '24',
  'every recovered task has immutable prior-failure evidence'
);
select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '38e00000-0000-4000-8000-000000000201'
  ),
  'pending',
  'unrelated fixture remains present and unchanged'
);
select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '38e00000-0000-4000-8000-000000000200'
  ),
  'failed',
  'permanent failure remains terminal and unchanged'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_recovery_events
      set actor_id = 'forged_recovery_actor'
      where request_id = 'phase8b_recovery_request'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_recovery_events
      where request_id = 'phase8b_recovery_request'$$,
    '55000'
  ),
  'recovery evidence is update/delete immutable'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_audit_events
    where action = 'credential_refresh_boundary'
      and target_id = '78e00000-0000-4000-8000-000000000001'
      and metadata ? 'refresh_boundary_stage'
      and not metadata::text ~* '(access.?token|refresh.?token|client.?secret|authorization)'
  ),
  '1',
  'refresh boundary audit persists only redacted category metadata'
);

-- Recreate the reviewed Cloud Tasks incident without replacing any logical
-- task. The credential recovery kept generation-one count-zero evidence; a
-- new reservation created generation two before 12 first deliveries were
-- rejected by the historical lease comparison.
update private.integration_sync_tasks
set available_at = pg_catalog.transaction_timestamp(),
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id in (
  select (
    '38e00000-0000-4000-8000-'
    || pg_catalog.lpad(value::text, 12, '0')
  )::uuid
  from pg_catalog.generate_series(1, 24) as series(value)
);

set local role integration_task_dispatch_authority;
select is(
  public.promote_qbo_sandbox_due_retry_tasks_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_due_retry_promotion_v1',
      'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
      'connectionId', 'e8e00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'maximumTasks', 24
    ),
    'phase8b_zero_retry_promotion',
    'phase8b_dispatcher'
  ) ->> 'promotedTaskCount',
  '24',
  'scoped retry scheduling returns exactly 24 due tasks to pending'
);

do $reserve_incident$
declare
  v_ordinal integer;
begin
  for v_ordinal in 1..24 loop
    perform public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_reservation_v1',
        'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
        'connectionId', 'e8e00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', (
          '38e00000-0000-4000-8000-'
          || pg_catalog.lpad(v_ordinal::text, 12, '0')
        )::uuid,
        'expectedRowVersion', 7,
        'dispatcherTaskName',
          pg_catalog.md5('phase8b-zero-cloud-task-' || v_ordinal::text)
          || pg_catalog.md5('phase8b-zero-cloud-task-' || v_ordinal::text)
      ),
      'phase8b_zero_reserve_' || v_ordinal::text,
      'phase8b_dispatcher'
    );
  end loop;
end;
$reserve_incident$;
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where id in (
      select (
        '38e00000-0000-4000-8000-'
        || pg_catalog.lpad(value::text, 12, '0')
      )::uuid
      from pg_catalog.generate_series(1, 24) as series(value)
    )
      and state = 'dispatched'
      and dispatch_generation = 2
      and last_delivery_dispatch_generation = 1
      and last_delivery_execution_count = 0
      and row_version = 8
  ),
  '24',
  'all 24 identities retain historical delivery evidence under generation two'
);

create temporary table phase8b_zero_incident_snapshot on commit drop as
select task.id, pg_catalog.to_jsonb(task) as snapshot
from private.integration_sync_tasks as task
where task.id in (
  select (
    '38e00000-0000-4000-8000-'
    || pg_catalog.lpad(value::text, 12, '0')
  )::uuid
  from pg_catalog.generate_series(1, 24) as series(value)
);

create or replace function pg_temp.zero_delivery_recovery_command(
  p_execution_count integer default 0,
  p_task_count integer default 12,
  p_expected_row_version bigint default 8,
  p_workspace_id uuid default 'b8e00000-0000-4000-8000-000000000001'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_zero_based_delivery_recovery_v1',
    'workspaceId', p_workspace_id,
    'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
    'connectionId', 'e8e00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'observations', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'taskId', (
            '38e00000-0000-4000-8000-'
            || pg_catalog.lpad(series.value::text, 12, '0')
          )::uuid,
          'expectedRowVersion', p_expected_row_version,
          'dispatcherTaskName',
            pg_catalog.md5(
              'phase8b-zero-cloud-task-' || series.value::text
            ) || pg_catalog.md5(
              'phase8b-zero-cloud-task-' || series.value::text
            ),
          'deliveryExecutionCount', p_execution_count,
          'deliveryAttemptFingerprint', 'sha256:'
            || pg_catalog.md5(
              'phase8b-zero-observed-delivery-' || series.value::text
            ) || pg_catalog.md5(
              'phase8b-zero-observed-delivery-' || series.value::text
            ),
          'externalEvidenceFingerprint', 'sha256:'
            || pg_catalog.md5(
              'phase8b-zero-external-evidence-' || series.value::text
            ) || pg_catalog.md5(
              'phase8b-zero-external-evidence-' || series.value::text
            )
        )
        order by series.value
      )
      from pg_catalog.generate_series(1, p_task_count) as series(value)
    )
  );
$function$;

select ok(
  has_function_privilege(
    'integration_task_dispatch_authority',
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_task_dispatch_authority',
    'private.integration_sync_task_delivery_recovery_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'only the dispatcher receives the checked recovery RPC and no table DML'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'private.integration_sync_task_delivery_recovery_events'::regclass
  ),
  'zero-based recovery evidence retains enabled and forced RLS'
);

set local role integration_task_dispatch_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_zero_based_deliveries_v1(
      pg_temp.zero_delivery_recovery_command(-1),
      'phase8b_zero_negative',
      'phase8b_dispatcher'
    )$$,
    '22023'
  ),
  'negative execution-count recovery is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_zero_based_deliveries_v1(
      pg_temp.zero_delivery_recovery_command()
        #- '{observations,0,deliveryExecutionCount}',
      'phase8b_zero_missing',
      'phase8b_dispatcher'
    )$$,
    '22023'
  ),
  'missing execution-count recovery is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_zero_based_deliveries_v1(
      pg_catalog.jsonb_set(
        pg_temp.zero_delivery_recovery_command(),
        '{observations,0,deliveryExecutionCount}',
        '"zero"'::jsonb
      ),
      'phase8b_zero_malformed',
      'phase8b_dispatcher'
    )$$,
    '22023'
  ),
  'malformed execution-count recovery is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_zero_based_deliveries_v1(
      pg_temp.zero_delivery_recovery_command(0, 12, 9),
      'phase8b_zero_stale_cas',
      'phase8b_dispatcher'
    )$$,
    '40001'
  ),
  'stale task row versions cannot create recovery evidence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.recover_qbo_sandbox_zero_based_deliveries_v1(
      pg_temp.zero_delivery_recovery_command(
        0,
        12,
        8,
        'b8e00000-0000-4000-8000-000000000099'
      ),
      'phase8b_zero_wrong_scope',
      'phase8b_dispatcher'
    )$$,
    '42501'
  ),
  'cross-workspace recovery fails closed before task evidence is written'
);

create temporary table phase8b_zero_recovery_result on commit drop as
select public.recover_qbo_sandbox_zero_based_deliveries_v1(
  pg_temp.zero_delivery_recovery_command(),
  'phase8b_zero_recovery',
  'phase8b_dispatcher'
) as result;
select is(
  (select result ->> 'recoveredTaskCount' from phase8b_zero_recovery_result),
  '12',
  'authoritative incident evidence records exactly the 12 observed deliveries'
);
select is(
  public.recover_qbo_sandbox_zero_based_deliveries_v1(
    pg_temp.zero_delivery_recovery_command(),
    'phase8b_zero_recovery',
    'phase8b_dispatcher'
  ) ->> 'idempotent',
  'true',
  'identical delivery recovery is idempotent'
);
reset role;

create or replace function pg_temp.retry_compatibility_command()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_delivery_retry_compatibility_v1',
    'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
    'connectionId', 'e8e00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'observations', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'taskId', (
            '38e00000-0000-4000-8000-'
            || pg_catalog.lpad(series.value::text, 12, '0')
          )::uuid,
          'expectedRowVersion', 8,
          'dispatcherTaskName',
            pg_catalog.md5(
              'phase8b-zero-cloud-task-' || series.value::text
            ) || pg_catalog.md5(
              'phase8b-zero-cloud-task-' || series.value::text
            ),
          'deliveryDispatchGeneration', 2,
          'observedDeliveryRetryCount', 0,
          'observedDeliveryExecutionCount', 0,
          'externalEvidenceFingerprint', 'sha256:'
            || pg_catalog.md5(
              'phase8b-retry-compatible-' || series.value::text
            ) || pg_catalog.md5(
              'phase8b-retry-compatible-' || series.value::text
            )
        )
        order by series.value
      )
      from pg_catalog.generate_series(1, 12) as series(value)
    )
  );
$function$;

select ok(
  has_function_privilege(
    'integration_task_dispatch_authority',
    'public.recover_qbo_sandbox_delivery_retry_compatibility_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.recover_qbo_sandbox_delivery_retry_compatibility_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_provider_runtime_authority',
    'public.recover_qbo_sandbox_delivery_retry_compatibility_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_table_privilege(
    'integration_task_dispatch_authority',
    'private.integration_sync_task_delivery_retry_compatibility_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'retry compatibility is dispatcher-RPC-only with no service/runtime shortcut or direct DML'
);

set local role integration_task_dispatch_authority;
select is(
  public.recover_qbo_sandbox_delivery_retry_compatibility_v1(
    pg_temp.retry_compatibility_command(),
    'phase8b_retry_compatibility',
    'phase8b_dispatcher'
  ) ->> 'recoveredTaskCount',
  '12',
  'retry identity is attributed only for the 12 externally evidenced deliveries'
);
select is(
  public.recover_qbo_sandbox_delivery_retry_compatibility_v1(
    pg_temp.retry_compatibility_command(),
    'phase8b_retry_compatibility',
    'phase8b_dispatcher'
  ) ->> 'idempotent',
  'true',
  'retry identity compatibility recovery is idempotent'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_delivery_retry_compatibility_events
    where request_id = 'phase8b_retry_compatibility'
      and observed_delivery_retry_count = 0
      and observed_delivery_execution_count = 0
      and dispatch_generation = 2
  ),
  '12',
  'compatibility treatment appends twelve immutable retry/execution tuples'
);

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_delivery_recovery_events
    where request_id = 'phase8b_zero_recovery'
      and observed_delivery_execution_count = 0
      and reason_code = 'rejected_before_lease'
  ),
  '12',
  'each observed rejection has one immutable redacted recovery record'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks as task
    inner join phase8b_zero_incident_snapshot as prior on prior.id = task.id
    where pg_catalog.to_jsonb(task) = prior.snapshot
  ),
  '24',
  'recovery changes no task identity, row version, state, or delivery evidence'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_recovery_events
    where request_id = 'phase8b_recovery_request'
  ),
  '24',
  'all original credential-recovery lineage remains present'
);
select is(
  (
    select state
    from private.integration_sync_tasks
    where id = '38e00000-0000-4000-8000-000000000201'
  ),
  'pending',
  'the unrelated fixture remains present after delivery recovery'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_delivery_recovery_events
      set actor_id = 'forged_actor'
      where request_id = 'phase8b_zero_recovery'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_delivery_recovery_events
      where request_id = 'phase8b_zero_recovery'$$,
    '55000'
  ),
  'delivery recovery evidence is update/delete immutable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_delivery_retry_compatibility_events
      set actor_id = 'forged_actor'
      where request_id = 'phase8b_retry_compatibility'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_delivery_retry_compatibility_events
      where request_id = 'phase8b_retry_compatibility'$$,
    '55000'
  ),
  'retry compatibility evidence is update/delete immutable'
);

create or replace function pg_temp.zero_delivery_lease_command(
  p_ordinal integer,
  p_retry_count integer,
  p_execution_count integer,
  p_expected_row_version bigint,
  p_lease_id uuid,
  p_owner text,
  p_attempt text,
  p_dispatch_generation bigint default 2
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
    'connectionId', 'e8e00000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'taskId', (
      '38e00000-0000-4000-8000-'
      || pg_catalog.lpad(p_ordinal::text, 12, '0')
    )::uuid,
    'expectedRowVersion', p_expected_row_version,
    'workerKind', 'provider_runtime',
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', 'sha256:'
      || pg_catalog.md5(p_owner) || pg_catalog.md5(p_owner),
    'leaseSeconds', 120,
    'dispatcherTaskName',
      pg_catalog.md5('phase8b-zero-cloud-task-' || p_ordinal::text)
      || pg_catalog.md5('phase8b-zero-cloud-task-' || p_ordinal::text),
    'deliveryDispatchGeneration', p_dispatch_generation,
    'deliveryRetryCount', p_retry_count,
    'deliveryExecutionCount', p_execution_count,
    'deliveryAttemptFingerprint', 'sha256:'
      || pg_catalog.md5(p_attempt) || pg_catalog.md5(p_attempt)
  );
$function$;

set local role integration_provider_runtime_authority;
select is(
  public.lease_integration_sync_task_v1(
    pg_temp.zero_delivery_lease_command(
      1, 0, 0, 8,
      '48e00000-0000-4000-8000-000000000201',
      'phase8b-zero-owner-1',
      'phase8b-zero-repeat-1'
    ),
    'phase8b_zero_repeat_rejected',
    'phase8b_provider_runtime'
  ) ->> 'acquired',
  'false',
  'a recovered retry/execution zero tuple cannot acquire another lease'
);
create temporary table phase8b_zero_retry_one on commit drop as
select public.lease_integration_sync_task_v1(
  pg_temp.zero_delivery_lease_command(
    1, 1, 0, 8,
    '48e00000-0000-4000-8000-000000000202',
    'phase8b-zero-owner-2',
    'phase8b-zero-retry-1'
  ),
  'phase8b_zero_retry_one',
  'phase8b_provider_runtime'
) as result;
select is(
  (select result ->> 'acquired' from phase8b_zero_retry_one),
  'true',
  'retry one with execution zero may lease after recovered zero tuple'
);
select ok(
  (
    select result
    from (
      select public.lease_integration_sync_task_v1(
        pg_temp.zero_delivery_lease_command(
          1, 1, 0, 8,
          '48e00000-0000-4000-8000-000000000203',
          'phase8b-zero-owner-3',
          'phase8b-zero-retry-1'
        ),
        'phase8b_zero_retry_one_replay',
        'phase8b_provider_runtime'
      ) as result
    ) as replay
  ) ->> 'acquired' = 'false',
  'a repeated retry/execution tuple converges without a second lease'
);
select is(
  public.lease_integration_sync_task_v1(
    pg_temp.zero_delivery_lease_command(
      13, 0, 0, 8,
      '48e00000-0000-4000-8000-000000000213',
      'phase8b-zero-owner-13',
      'phase8b-zero-fresh-13'
    ),
    'phase8b_zero_fresh_thirteen',
    'phase8b_provider_runtime'
  ) ->> 'acquired',
  'true',
  'an unobserved task accepts its first retry/execution zero tuple exactly once'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, 0, -1, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-negative-14'
      ),
      'phase8b_zero_negative_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a negative execution count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, -1, 0, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-negative-retry-14'
      ),
      'phase8b_zero_negative_retry_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a negative retry count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, 0, 0, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-missing-retry-14'
      ) - 'deliveryRetryCount',
      'phase8b_zero_missing_retry_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a missing retry count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, 0, 0, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-missing-14'
      ) - 'deliveryExecutionCount',
      'phase8b_zero_missing_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a missing execution count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.zero_delivery_lease_command(
          14, 0, 0, 8,
          '48e00000-0000-4000-8000-000000000214',
          'phase8b-zero-owner-14',
          'phase8b-zero-malformed-14'
        ),
        '{deliveryExecutionCount}',
        '"zero"'::jsonb
      ),
      'phase8b_zero_malformed_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a malformed execution count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.zero_delivery_lease_command(
          14, 0, 0, 8,
          '48e00000-0000-4000-8000-000000000214',
          'phase8b-zero-owner-14',
          'phase8b-zero-malformed-retry-14'
        ),
        '{deliveryRetryCount}',
        '"zero"'::jsonb
      ),
      'phase8b_zero_malformed_retry_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects a malformed retry count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, 100, 101, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-out-of-bounds-14'
      ),
      'phase8b_zero_out_of_bounds_lease',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'lease RPC rejects out-of-bounds delivery counters'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        14, 1, 2, 8,
        '48e00000-0000-4000-8000-000000000214',
        'phase8b-zero-owner-14',
        'phase8b-zero-invalid-order-14'
      ),
      'phase8b_zero_invalid_counter_order',
      'phase8b_provider_runtime'
    )$$,
    '22023'
  ),
  'execution count cannot exceed retry count'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_temp.zero_delivery_lease_command(
        15, 0, 0, 9,
        '48e00000-0000-4000-8000-000000000215',
        'phase8b-zero-owner-15',
        'phase8b-zero-stale-15'
      ),
      'phase8b_zero_stale_lease',
      'phase8b_provider_runtime'
    )$$,
    '40001'
  ),
  'execution count cannot bypass task row-version CAS'
);
reset role;

update private.integration_credentials
set access_expires_at = pg_catalog.transaction_timestamp() + interval '1 hour',
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id = '78e00000-0000-4000-8000-000000000001';

set local role integration_credential_broker_authority;
create temporary table phase8b_zero_provider_reads on commit drop as
select fixture.task_id, public.read_integration_provider_credential_v5(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_read_v1',
    'taskId', fixture.task_id,
    'leaseId', fixture.lease_id,
    'leaseOwnerFingerprint', 'sha256:'
      || pg_catalog.md5(fixture.owner_seed)
      || pg_catalog.md5(fixture.owner_seed),
    'expectedCredentialVersion', 1,
    'requiredScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'minimumValiditySeconds', 300,
    'requestedAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ),
  fixture.request_id
) as result
from (
  values
    (
      '38e00000-0000-4000-8000-000000000001'::uuid,
      '48e00000-0000-4000-8000-000000000202'::uuid,
      'phase8b-zero-owner-2'::text,
      'phase8b_zero_provider_read_1'::text
    ),
    (
      '38e00000-0000-4000-8000-000000000013'::uuid,
      '48e00000-0000-4000-8000-000000000213'::uuid,
      'phase8b-zero-owner-13'::text,
      'phase8b_zero_provider_read_13'::text
    )
) as fixture(task_id, lease_id, owner_seed, request_id);
reset role;

create or replace function pg_temp.zero_provider_read_evidence_id(
  p_task_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select (provider_read.result ->> 'credentialReadEvidenceId')::uuid
  from pg_temp.phase8b_zero_provider_reads as provider_read
  where provider_read.task_id = p_task_id;
$function$;

set local role integration_provider_runtime_authority;
select public.record_qbo_sandbox_provider_result_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_sandbox_provider_result_evidence_v1',
    'credentialReadEvidenceId', pg_temp.zero_provider_read_evidence_id(
      fixture.task_id
    ),
    'requestOrdinal', 1,
    'endpointDomain', 'entity_query',
    'endpointClass', 'qbo_entity_query',
    'providerRequestFingerprint', fixture.request_fingerprint,
    'providerOutcome', 'provider_success'
  ),
  fixture.request_id
)
from (
  values
    (
      '38e00000-0000-4000-8000-000000000001'::uuid,
      'sha256:' || pg_catalog.repeat('b', 64),
      'phase8b_zero_provider_result_1'::text
    ),
    (
      '38e00000-0000-4000-8000-000000000013'::uuid,
      'sha256:' || pg_catalog.repeat('c', 64),
      'phase8b_zero_provider_result_13'::text
    )
) as fixture(task_id, request_fingerprint, request_id);
reset role;

update private.integration_sync_tasks
set state = 'succeeded',
    lease_id = null,
    lease_owner_fingerprint = null,
    lease_expires_at = null,
    heartbeat_at = null,
    durable_effect_fingerprint = extensions.digest(
      pg_catalog.convert_to(
        'phase8b-zero-complete-' || id::text,
        'UTF8'
      ),
      'sha256'
    ),
    completed_at = pg_catalog.transaction_timestamp(),
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id in (
  '38e00000-0000-4000-8000-000000000001',
  '38e00000-0000-4000-8000-000000000013'
);

-- Dispatched reconstruction fixtures isolate retry and execution ordering.
-- They have no lease/effect and differ only where each comparator requires it.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, provider_key, provider_environment,
  queue_class, task_kind, stream_key, state, priority, control_metadata,
  idempotency_fingerprint, coalescing_fingerprint, dispatcher_task_name,
  dispatch_generation, delivery_attribution_state,
  last_delivery_dispatch_generation,
  last_delivery_retry_count, last_delivery_execution_count,
  last_delivery_attempt_fingerprint,
  attempt_count, maximum_attempts, available_at, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at,
  retention_expires_at
) select
  fixture.id,
  task.contract_version,
  task.workspace_id,
  task.business_entity_id,
  task.connection_id,
  task.connection_generation,
  task.sync_run_id,
  task.provider_key,
  task.provider_environment,
  task.queue_class,
  task.task_kind,
  task.stream_key,
  'dispatched',
  task.priority,
  task.control_metadata,
  extensions.digest(
    pg_catalog.convert_to(fixture.identity_seed, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(fixture.identity_seed || '-coalesce', 'UTF8'),
    'sha256'
  ),
  pg_catalog.repeat(fixture.dispatcher_character, 64),
  2,
  'attributed',
  2,
  1,
  fixture.execution_count,
  extensions.digest(
    pg_catalog.convert_to(
      fixture.identity_seed || '-count-' || fixture.execution_count::text,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  3,
  pg_catalog.transaction_timestamp(),
  fixture.request_id,
  extensions.digest(
    pg_catalog.convert_to(fixture.request_id, 'UTF8'),
    'sha256'
  ),
  8,
  task.created_at,
  pg_catalog.transaction_timestamp(),
  task.retention_expires_at
from private.integration_sync_tasks as task
cross join (
  values
    (
      '38e00000-0000-4000-8000-000000000301'::uuid,
      'phase8b-zero-retry-ordering'::text,
      'a'::text,
      0::integer,
      'phase8b_zero_retry_ordering_fixture'::text
    ),
    (
      '38e00000-0000-4000-8000-000000000302'::uuid,
      'phase8b-zero-execution-ordering'::text,
      'b'::text,
      1::integer,
      'phase8b_zero_execution_ordering_fixture'::text
    )
) as fixture(
  id, identity_seed, dispatcher_character, execution_count, request_id
)
where task.id = '38e00000-0000-4000-8000-000000000024';

set local role integration_provider_runtime_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.zero_delivery_lease_command(
          1, 0, 0, 8,
          '48e00000-0000-4000-8000-000000000301',
          'phase8b-zero-ordering-owner',
          'phase8b-zero-ordering-zero'
        ),
        '{taskId}',
        '"38e00000-0000-4000-8000-000000000301"'::jsonb
      ) || pg_catalog.jsonb_build_object(
        'dispatcherTaskName', pg_catalog.repeat('a', 64)
      ),
      'phase8b_zero_ordering_zero',
      'phase8b_provider_runtime'
    )$$,
    '40001'
  ),
  'retry-count regression is stale after retry one'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.lease_integration_sync_task_v1(
      pg_catalog.jsonb_set(
        pg_temp.zero_delivery_lease_command(
          1, 2, 0, 8,
          '48e00000-0000-4000-8000-000000000302',
          'phase8b-zero-execution-ordering-owner',
          'phase8b-zero-execution-ordering-one'
        ),
        '{taskId}',
        '"38e00000-0000-4000-8000-000000000302"'::jsonb
      ) || pg_catalog.jsonb_build_object(
        'dispatcherTaskName', pg_catalog.repeat('b', 64)
      ),
      'phase8b_zero_ordering_one',
      'phase8b_provider_runtime'
    )$$,
    '40001'
  ),
  'execution-count regression is stale even when retry count advances'
);
select is(
  public.lease_integration_sync_task_v1(
    pg_catalog.jsonb_set(
      pg_temp.zero_delivery_lease_command(
        1, 4, 3, 8,
        '48e00000-0000-4000-8000-000000000301',
        'phase8b-zero-ordering-owner',
        'phase8b-zero-ordering-two'
      ),
      '{taskId}',
      '"38e00000-0000-4000-8000-000000000301"'::jsonb
    ) || pg_catalog.jsonb_build_object(
      'dispatcherTaskName', pg_catalog.repeat('a', 64)
    ),
    'phase8b_zero_ordering_two',
    'phase8b_provider_runtime'
  ) ->> 'acquired',
  'true',
  'non-contiguous execution count is eligible when retry and lifecycle invariants permit'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.complete_integration_sync_task_v1(
      pg_catalog.jsonb_build_object(
        'workspaceId', 'b8e00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8e00000-0000-4000-8000-000000000001',
        'connectionId', 'e8e00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'taskId', '38e00000-0000-4000-8000-000000000301',
        'expectedRowVersion', 9,
        'leaseId', '48e00000-0000-4000-8000-000000000299',
        'leaseOwnerFingerprint', 'sha256:' || pg_catalog.repeat('b', 64),
        'durableEffectFingerprint', 'sha256:' || pg_catalog.repeat('c', 64),
        'checkpoint', null
      ),
      'phase8b_zero_stale_worker_complete',
      'phase8b_provider_runtime'
    )$$,
    '40001'
  ),
  'a stale worker cannot commit after the newer delivery owns the task'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks
    where id in (
      select (
        '38e00000-0000-4000-8000-'
        || pg_catalog.lpad(value::text, 12, '0')
      )::uuid
      from pg_catalog.generate_series(1, 24) as series(value)
    )
  ),
  '24',
  'all 24 original logical task identities remain present'
);

select * from finish();
rollback;
