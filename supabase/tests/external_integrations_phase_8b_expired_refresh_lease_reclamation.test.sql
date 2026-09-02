create extension if not exists dblink with schema extensions;

begin;

grant usage on schema extensions
  to integration_credential_broker_authority,
    integration_oauth_ingress_authority;

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

create or replace function pg_temp.caught_sqlstate(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return '00000';
exception when others then
  return sqlstate;
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

create or replace function pg_temp.reclamation_command(
  p_workspace_id uuid default 'b8d10000-0000-4000-8000-000000000001',
  p_business_entity_id uuid default 'd8d10000-0000-4000-8000-000000000001',
  p_connection_id uuid default 'e8d10000-0000-4000-8000-000000000001',
  p_connection_generation bigint default 1,
  p_credential_id uuid default '78d10000-0000-4000-8000-000000000001',
  p_credential_version bigint default 1,
  p_credential_row_version bigint default 2,
  p_provider_key text default 'quickbooks_online',
  p_provider_environment text default 'sandbox'
)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_expired_refresh_lease_reclamation_v1',
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', p_connection_generation,
    'credentialId', p_credential_id,
    'expectedCredentialVersion', p_credential_version,
    'expectedCredentialRowVersion', p_credential_row_version,
    'providerKey', p_provider_key,
    'providerEnvironment', p_provider_environment,
    'reasonCode', 'refresh_lease_expired_reclaimed'
  );
$function$;

create or replace function pg_temp.reclamation_null_is_rejected(p_key text)
returns boolean
language plpgsql
as $function$
begin
  perform public.reclaim_integration_expired_refresh_lease_v1(
    pg_catalog.jsonb_set(
      pg_temp.reclamation_command(),
      array[p_key],
      'null'::jsonb
    ),
    'phase8b_null_' || pg_catalog.lower(p_key)
  );
  return false;
exception when others then
  return sqlstate = '22023';
end;
$function$;

insert into public.profiles (id, email, full_name) values (
  'a8d10000-0000-4000-8000-000000000001',
  'phase8b-lease-reclamation@example.test',
  'Phase 8B Lease Reclamation'
);
insert into public.workspaces (id, name, created_by) values (
  'b8d10000-0000-4000-8000-000000000001',
  'Phase 8B Lease Reclamation Workspace',
  'a8d10000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c8d10000-0000-4000-8000-000000000001',
  'b8d10000-0000-4000-8000-000000000001',
  'a8d10000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd8d10000-0000-4000-8000-000000000001',
  'b8d10000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_lease_reclamation',
  'operating_company',
  'Phase 8B Lease Reclamation',
  'USD',
  'UTC',
  1,
  'active',
  'a8d10000-0000-4000-8000-000000000001',
  'a8d10000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp() - interval '2 hours',
  pg_catalog.clock_timestamp() - interval '2 hours'
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
  'e8d10000-0000-4000-8000-000000000001',
  'integration_connection_v1',
  'integration_connection_control_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-lease-reclamation-realm'
  ),
  'initializing',
  'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Phase 8B Lease Reclamation Sandbox',
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
  'a8d10000-0000-4000-8000-000000000001',
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
  'f8d10000-0000-4000-8000-000000000001',
  'provider_entity_mapping_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  'f8d10000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'company',
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-lease-reclamation-realm'
  ),
  'Phase 8B Lease Reclamation Sandbox',
  'primary',
  'active',
  'qbo_realm_mapping_v1',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-mapping', 'UTF8'),
    'sha256'
  ),
  pg_catalog.clock_timestamp() - interval '2 hours',
  'a8d10000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp() - interval '2 hours',
  1,
  pg_catalog.clock_timestamp() - interval '2 hours',
  pg_catalog.clock_timestamp() - interval '2 hours'
);

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status,
  creation_request_id, creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
) values (
  '18d10000-0000-4000-8000-000000000001',
  'integration_oauth_state_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8d10000-0000-4000-8000-000000000001',
  array['com.intuit.quickbooks.accounting']::text[],
  '/phase8b/sandbox/authorized',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-oauth-state', 'UTF8'),
    'sha256'
  ),
  'consumed',
  'phase8b_lease_reclamation_initial_create',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-create', 'UTF8'),
    'sha256'
  ),
  'phase8b_lease_reclamation_initial_consume',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-consume', 'UTF8'),
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
  external_entity_reference_fingerprint, status, refresh_lease_id,
  refresh_lease_owner_fingerprint, refresh_lease_acquired_at,
  refresh_lease_expires_at, last_request_id, last_request_fingerprint,
  row_version, created_at, updated_at
) values (
  '78d10000-0000-4000-8000-000000000001',
  'integration_credential_authority_v1',
  '18d10000-0000-4000-8000-000000000001',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'a8d10000-0000-4000-8000-000000000001',
  1,
  'oauth_credential_envelope_v1',
  'oauth_credential_aad_v1',
  private.phase_5_credential_aad_digest_v1(
    'sandbox',
    'b8d10000-0000-4000-8000-000000000001',
    'e8d10000-0000-4000-8000-000000000001',
    1,
    'quickbooks_online',
    '78d10000-0000-4000-8000-000000000001'
  ),
  'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
  pg_catalog.convert_to(pg_catalog.repeat('l', 256), 'UTF8'),
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp() + interval '30 days',
  array['com.intuit.quickbooks.accounting']::text[],
  private.qbo_phase_8b_realm_fingerprint_v1(
    'phase8b-lease-reclamation-realm'
  ),
  'active',
  '58d10000-0000-4000-8000-000000000001',
  extensions.digest(
    pg_catalog.convert_to('phase8b-active-lease-owner', 'UTF8'),
    'sha256'
  ),
  pg_catalog.clock_timestamp() - interval '30 seconds',
  pg_catalog.clock_timestamp() + interval '30 seconds',
  'phase8b_active_refresh_lease',
  extensions.digest(
    pg_catalog.convert_to('phase8b-active-refresh-lease', 'UTF8'),
    'sha256'
  ),
  1,
  pg_catalog.clock_timestamp() - interval '2 hours',
  pg_catalog.clock_timestamp() - interval '30 seconds'
);

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, provider_contract_version, adapter_version,
  policy_version, records_observed, records_accepted, records_rejected,
  facts_accepted, contributions_changed, created_at, started_at,
  row_version, updated_at
) values (
  '28d10000-0000-4000-8000-000000000001',
  'integration_sync_run_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  'f8d10000-0000-4000-8000-000000000001',
  1,
  'provider_initialization',
  'initialization',
  'running',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-run', 'UTF8'),
    'sha256'
  ),
  'provider_adapter_v1',
  'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1',
  0, 0, 0, 0, 0,
  pg_catalog.clock_timestamp() - interval '2 hours',
  pg_catalog.clock_timestamp() - interval '2 hours',
  2,
  pg_catalog.clock_timestamp() - interval '2 hours'
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
  ('38d10000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'integration_sync_task_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  1,
  '28d10000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'provider_bulk',
  'initial_historical',
  'qbo_invoice',
  'retry_wait',
  40,
  pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', 'f8d10000-0000-4000-8000-000000000001',
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
    pg_catalog.convert_to('phase8b-lease-reclamation-task-' || series.value, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-lease-reclamation-task-coalescing-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  null,
  1,
  3,
  pg_catalog.clock_timestamp() + interval '5 minutes',
  'phase8b_lease_reclamation_recovery',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-recovery', 'UTF8'),
    'sha256'
  ),
  5,
  pg_catalog.clock_timestamp() - interval '1 hour',
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp() + interval '7 days'
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
  ('48d10000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  'qbo_sandbox_expired_credential_recovery_v1',
  'b8d10000-0000-4000-8000-000000000001',
  'd8d10000-0000-4000-8000-000000000001',
  'e8d10000-0000-4000-8000-000000000001',
  1,
  '78d10000-0000-4000-8000-000000000001',
  1,
  ('38d10000-0000-4000-8000-' || pg_catalog.lpad(series.value::text, 12, '0'))::uuid,
  1,
  'failed',
  'contract',
  'phase8b_provider_task_failed',
  4,
  pg_catalog.clock_timestamp() - interval '30 minutes'
    + series.value * interval '1 millisecond',
  30,
  'phase8b_lease_reclamation_recovery',
  extensions.digest(
    pg_catalog.convert_to('phase8b-lease-reclamation-recovery', 'UTF8'),
    'sha256'
  ),
  'phase8b_credential_recovery',
  pg_catalog.transaction_timestamp() - interval '20 minutes',
  pg_catalog.transaction_timestamp() - interval '20 minutes'
from pg_catalog.generate_series(1, 24) as series(value);

select is(
  (select not rolcanlogin and not rolinherit
   from pg_catalog.pg_roles
   where rolname = 'integration_credential_broker_authority'),
  true,
  'credential broker authority remains NOLOGIN and NOINHERIT'
);
select is(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.reclaim_integration_expired_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  ),
  true,
  'credential broker authority can execute the checked reclamation RPC'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reclaim_integration_expired_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  ),
  false,
  'service_role has no expired-lease reclamation shortcut'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reclaim_integration_expired_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  ),
  false,
  'authenticated clients cannot invoke expired-lease reclamation'
);
select is(
  has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_credentials',
    'UPDATE'
  ),
  false,
  'credential broker retains no direct credential-table update privilege'
);
select is(
  has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_audit_events',
    'INSERT'
  ),
  false,
  'credential broker retains no direct audit-table insert privilege'
);

set local role integration_credential_broker_authority;
select ok(
  pg_temp.reclamation_null_is_rejected(field_name),
  'JSON null is rejected for reclamation field ' || field_name
)
from (values
  ('workspaceId'),
  ('businessEntityId'),
  ('connectionId'),
  ('connectionGeneration'),
  ('credentialId'),
  ('expectedCredentialVersion'),
  ('expectedCredentialRowVersion'),
  ('providerKey'),
  ('providerEnvironment')
) as null_fields(field_name);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(p_credential_row_version => 1),
      null
    )$$,
    '22023'
  ),
  'a null reclamation request identifier is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(p_credential_row_version => 1),
      'phase8b_active_lease_reclamation_denied'
    )$$,
    '55000'
  ),
  'a still-active refresh lease cannot be reclaimed'
);
reset role;

select is(
  (select count(*)::integer
   from private.integration_audit_events
   where action = 'refresh_lease_expired_reclaimed'
     and connection_id = 'e8d10000-0000-4000-8000-000000000001'),
  0,
  'an active-lease denial appends no success evidence'
);
select is(
  (select refresh_lease_id
   from private.integration_credentials
   where id = '78d10000-0000-4000-8000-000000000001'),
  '58d10000-0000-4000-8000-000000000001'::uuid,
  'an active-lease denial leaves the lease owner intact'
);

update private.integration_credentials
set refresh_lease_acquired_at =
      pg_catalog.transaction_timestamp() - interval '7 minutes',
    refresh_lease_expires_at =
      pg_catalog.transaction_timestamp() - interval '5 minutes',
    last_request_id = 'phase8b_fixture_expire_refresh_lease',
    last_request_fingerprint = extensions.digest(
      pg_catalog.convert_to('phase8b-fixture-expire-refresh-lease', 'UTF8'),
      'sha256'
    ),
    row_version = row_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where id = '78d10000-0000-4000-8000-000000000001';

create temporary table phase8b_lease_reclamation_credential_snapshot on commit drop as
select
  id, contract_version, oauth_state_id, reauthorization_state_id,
  supersedes_credential_id, credential_version, credential_ciphertext,
  granted_scopes, provider_key, provider_environment, access_expires_at,
  refresh_expires_at, aad_digest, kms_key_resource, created_at
from private.integration_credentials
where id = '78d10000-0000-4000-8000-000000000001';

create temporary table phase8b_lease_reclamation_mapping_snapshot on commit drop as
select *
from private.provider_entity_mappings
where id = 'f8d10000-0000-4000-8000-000000000001';

create temporary table phase8b_lease_reclamation_task_snapshot on commit drop as
select
  id, state, row_version, attempt_count, dispatch_generation,
  last_request_id, last_request_fingerprint, dispatcher_task_name,
  control_metadata, sync_run_id
from private.integration_sync_tasks
where connection_id = 'e8d10000-0000-4000-8000-000000000001';

set local role integration_credential_broker_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(
        p_credential_row_version => 1
      ),
      'phase8b_stale_lease_reclamation'
    )$$,
    '40001'
  ),
  'stale credential row version fails reclamation CAS'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(
        p_workspace_id => 'b8d10000-0000-4000-8000-000000000099'
      ),
      'phase8b_wrong_workspace_lease_reclamation'
    )$$,
    '42501'
  ),
  'wrong workspace cannot reclaim the credential lease'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(
        p_business_entity_id => 'd8d10000-0000-4000-8000-000000000099'
      ),
      'phase8b_wrong_entity_lease_reclamation'
    )$$,
    '42501'
  ),
  'wrong Business Entity cannot reclaim the credential lease'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(
        p_connection_id => 'e8d10000-0000-4000-8000-000000000099'
      ),
      'phase8b_wrong_connection_lease_reclamation'
    )$$,
    '42501'
  ),
  'wrong connection cannot reclaim the credential lease'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(p_connection_generation => 2),
      'phase8b_wrong_generation_lease_reclamation'
    )$$,
    '22023'
  ),
  'wrong connection generation is outside the reclamation contract'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(p_provider_key => 'synthetic'),
      'phase8b_wrong_provider_lease_reclamation'
    )$$,
    '22023'
  ),
  'wrong provider is outside the reclamation contract'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.reclaim_integration_expired_refresh_lease_v1(
      pg_temp.reclamation_command(p_provider_environment => 'production'),
      'phase8b_wrong_environment_lease_reclamation'
    )$$,
    '22023'
  ),
  'wrong provider environment is outside the reclamation contract'
);

create temporary table phase8b_lease_reclamation_result on commit drop as
select public.reclaim_integration_expired_refresh_lease_v1(
  pg_temp.reclamation_command(),
  'phase8b_expired_lease_reclamation_success'
) as result;

create temporary table phase8b_lease_reclamation_repeat on commit drop as
select public.reclaim_integration_expired_refresh_lease_v1(
  pg_temp.reclamation_command(),
  'phase8b_expired_lease_reclamation_success'
) as result;
reset role;

select is(
  (select result ->> 'leaseState' from phase8b_lease_reclamation_result),
  'expired_reclaimed',
  'an expired refresh lease is reclaimed through its explicit action'
);
select is(
  (select result ->> 'credentialVersion' from phase8b_lease_reclamation_result),
  '1',
  'reclamation does not create credential version two'
);
select is(
  (select result ->> 'credentialRowVersion' from phase8b_lease_reclamation_result),
  '3',
  'reclamation advances the credential row CAS version exactly once'
);
select is(
  (select result ->> 'accessExpired' from phase8b_lease_reclamation_result),
  'true',
  'reclamation reports the credential access token remains expired'
);
select is(
  (select result ->> 'idempotent' from phase8b_lease_reclamation_result),
  'false',
  'first reclamation is a new authority action'
);
select is(
  (select result ->> 'idempotent' from phase8b_lease_reclamation_repeat),
  'true',
  'repeated identical reclamation is idempotent'
);

select ok(
  (select
      status = 'active'
      and credential_version = 1
      and row_version = 3
      and refresh_lease_id is null
      and refresh_lease_owner_fingerprint is null
      and refresh_lease_acquired_at is null
      and refresh_lease_expires_at is null
      and access_expires_at < pg_catalog.clock_timestamp()
   from private.integration_credentials
   where id = '78d10000-0000-4000-8000-000000000001'),
  'reclamation clears only expired lease state and leaves V1 expired and active'
);
select ok(
  (select
      credential.contract_version = snapshot.contract_version
      and credential.oauth_state_id = snapshot.oauth_state_id
      and credential.reauthorization_state_id is not distinct from
        snapshot.reauthorization_state_id
      and credential.supersedes_credential_id is not distinct from
        snapshot.supersedes_credential_id
      and credential.credential_version = snapshot.credential_version
      and credential.credential_ciphertext = snapshot.credential_ciphertext
      and credential.granted_scopes = snapshot.granted_scopes
      and credential.provider_key = snapshot.provider_key
      and credential.provider_environment = snapshot.provider_environment
      and credential.access_expires_at = snapshot.access_expires_at
      and credential.refresh_expires_at = snapshot.refresh_expires_at
      and credential.aad_digest = snapshot.aad_digest
      and credential.kms_key_resource = snapshot.kms_key_resource
      and credential.created_at = snapshot.created_at
   from private.integration_credentials as credential
   join phase8b_lease_reclamation_credential_snapshot as snapshot
     on snapshot.id = credential.id
   where credential.id = '78d10000-0000-4000-8000-000000000001'),
  'ciphertext, scopes, provider binding, token expiries, and issuance history are unchanged'
);
select is(
  (select count(*)::integer
   from private.integration_credentials
   where connection_id = 'e8d10000-0000-4000-8000-000000000001'),
  1,
  'credential V1 remains the only credential during lease reclamation'
);

set local role integration_credential_broker_authority;
select is(
  pg_temp.caught_sqlstate(
    $$select public.rotate_integration_credential_v1(
      pg_catalog.jsonb_build_object(
        'workspaceId', 'b8d10000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8d10000-0000-4000-8000-000000000001',
        'connectionId', 'e8d10000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', '78d10000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', '58d10000-0000-4000-8000-000000000001',
        'leaseOwnerFingerprint',
          'sha256:aab5f03abdb48f5719e385b1231f267f9d0ce6e6dde805276572e3bbf0d2e042',
        'aadDigest',
          'sha256:855554aaa3d39d329dc18a7c299714e21798a5a8c61911075ace17fbc045b18d',
        'kmsKeyResource',
          'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
        'ciphertextBase64', pg_catalog.encode(
          pg_catalog.convert_to(pg_catalog.repeat('z', 32), 'UTF8'),
          'base64'
        ),
        'accessExpiresAt', pg_temp.timestamp_text(
          pg_catalog.clock_timestamp() + interval '1 hour'
        ),
        'refreshExpiresAt', pg_temp.timestamp_text(
          pg_catalog.clock_timestamp() + interval '30 days'
        ),
        'grantedScopes', pg_catalog.jsonb_build_array(
          'com.intuit.quickbooks.accounting'
        ),
        'externalEntityReferenceFingerprint',
          'sha256:d1bc1dc018edd9631ada432d1c64794d2c0abcd3316d54efa67e9d9321f26a67',
        'rotatedAt', pg_temp.timestamp_text(pg_catalog.clock_timestamp())
      ),
      'phase8b_stale_worker_after_lease_reclamation'
    )$$
  ),
  '40001',
  'a stale refresh worker cannot rotate after its expired lease is reclaimed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.complete_integration_credential_refresh_failure_v1(
      pg_catalog.jsonb_build_object(
        'workspaceId', 'b8d10000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8d10000-0000-4000-8000-000000000001',
        'connectionId', 'e8d10000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', '78d10000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', '58d10000-0000-4000-8000-000000000001',
        'leaseOwnerFingerprint',
          'sha256:aab5f03abdb48f5719e385b1231f267f9d0ce6e6dde805276572e3bbf0d2e042',
        'reasonCode', 'provider_transient',
        'failedAt', pg_temp.timestamp_text(pg_catalog.clock_timestamp())
      ),
      'phase8b_stale_failure_after_lease_reclamation'
    )$$,
    '40001'
  ),
  'a stale worker cannot record refresh failure after its lease is reclaimed'
);
reset role;

select ok(
  (select
      status = 'active'
      and credential_version = 1
      and row_version = 3
      and refresh_lease_id is null
      and access_expires_at < pg_catalog.clock_timestamp()
   from private.integration_credentials
   where id = '78d10000-0000-4000-8000-000000000001'),
  'stale refresh outcomes leave the reclaimed expired credential unchanged'
);

select is(
  (select count(*)::integer
   from private.integration_audit_events
   where action = 'refresh_lease_expired_reclaimed'
     and request_id = 'phase8b_expired_lease_reclamation_success'),
  1,
  'one immutable reclamation audit event is appended'
);
select is(
  private.is_integration_expired_refresh_lease_reclamation_metadata_v1(
    (select metadata
     from private.integration_audit_events
     where action = 'refresh_lease_expired_reclaimed'
       and request_id = 'phase8b_expired_lease_reclamation_success')
  ),
  true,
  'reclamation audit metadata satisfies its action-specific strict contract'
);
select is(
  private.is_integration_expired_refresh_lease_reclamation_metadata_v1(
    pg_catalog.jsonb_set(
      (select metadata
       from private.integration_audit_events
       where action = 'refresh_lease_expired_reclaimed'
         and request_id = 'phase8b_expired_lease_reclamation_success'),
      '{refresh_lease_fingerprint}',
      '"sha256:malformed"'::jsonb
    )
  ),
  false,
  'malformed reclamation audit metadata is rejected'
);
select ok(
  (select
      actor_type = 'service'
      and actor_id = 'integration_credential_broker_authority'
      and outcome = 'succeeded'
      and reason_code = 'refresh_lease_expired_reclaimed'
      and retention_class = 'security'
      and metadata ->> 'lease_state' = 'expired_reclaimed'
      and metadata ->> 'credential_version' = '1'
      and metadata ->> 'prior_credential_row_version' = '2'
      and metadata ->> 'credential_row_version' = '3'
      and metadata ->> 'refresh_lease_fingerprint' =
        pg_temp.fingerprint('58d10000-0000-4000-8000-000000000001')
      and occurred_at = (metadata ->> 'reclaimed_at')::timestamptz
   from private.integration_audit_events
   where action = 'refresh_lease_expired_reclaimed'
     and request_id = 'phase8b_expired_lease_reclamation_success'),
  'audit evidence records authority, prior lease fingerprint/expiry, CAS, and database time'
);
select ok(
  not exists (
    select 1
    from private.integration_audit_events
    where action = 'refresh_lease_expired_reclaimed'
      and metadata::text ~* '(access.?token|refresh.?token|client.?secret|ciphertext|authorization)'
  ),
  'reclamation audit evidence contains no credential or authorization material'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_audit_events
      set reason_code = 'changed'
      where action = 'refresh_lease_expired_reclaimed'$$,
    '55000'
  ),
  'reclamation audit evidence is immutable'
);

select is(
  (select count(*)::integer
   from private.integration_sync_tasks as task
   join phase8b_lease_reclamation_task_snapshot as snapshot
     on snapshot.id = task.id
   where task.state = snapshot.state
     and task.row_version = snapshot.row_version
     and task.attempt_count = snapshot.attempt_count
     and task.dispatch_generation = snapshot.dispatch_generation
     and task.last_request_id = snapshot.last_request_id
     and task.last_request_fingerprint = snapshot.last_request_fingerprint
     and task.dispatcher_task_name is not distinct from
       snapshot.dispatcher_task_name
     and task.control_metadata = snapshot.control_metadata
     and task.sync_run_id = snapshot.sync_run_id),
  24,
  'all 24 recovered task identities and histories remain unchanged'
);
select ok(
  (select pg_catalog.to_jsonb(mapping) = pg_catalog.to_jsonb(snapshot)
   from private.provider_entity_mappings as mapping
   join phase8b_lease_reclamation_mapping_snapshot as snapshot
     on snapshot.id = mapping.id
   where mapping.id = 'f8d10000-0000-4000-8000-000000000001'),
  'the active provider mapping remains byte-for-byte unchanged'
);
select ok(
  (select
      status = 'initializing'
      and state_reason_code = 'initial_sync_pending'
      and connection_generation = 1
      and row_version = 3
   from private.integration_connections
   where id = 'e8d10000-0000-4000-8000-000000000001'),
  'connection lifecycle and generation remain unchanged'
);

create temporary table phase8b_reauthorization_after_reclamation (
  result jsonb not null
) on commit drop;
grant insert on table phase8b_reauthorization_after_reclamation
  to integration_oauth_ingress_authority;
set local role integration_oauth_ingress_authority;
insert into phase8b_reauthorization_after_reclamation(result)
select public.create_integration_reauthorization_state_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_reauthorization_state_v1',
    'id', '68d10000-0000-4000-8000-000000000001',
    'workspaceId', 'b8d10000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8d10000-0000-4000-8000-000000000001',
    'connectionId', 'e8d10000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'mappingId', 'f8d10000-0000-4000-8000-000000000001',
    'providerKey', 'quickbooks_online',
    'providerEnvironment', 'sandbox',
    'initiatedBy', 'a8d10000-0000-4000-8000-000000000001',
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'redirectUri',
      'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback',
    'returnIntent', '/phase8b/sandbox/reauthorized',
    'authorizationPurpose', 'reauthorization',
    'reasonCode', 'expired_credential_recovery',
    'stateHash', pg_temp.fingerprint('phase8b-reclamation-reauth-state'),
    'createdAt', pg_temp.timestamp_text(pg_catalog.clock_timestamp()),
    'expiresAt', pg_temp.timestamp_text(
      pg_catalog.clock_timestamp() + interval '9 minutes'
    )
  ),
  'phase8b_reauthorization_after_lease_reclamation'
);
reset role;

select is(
  (select result ->> 'credentialId'
   from phase8b_reauthorization_after_reclamation),
  '78d10000-0000-4000-8000-000000000001',
  'reviewed reauthorization RPC becomes eligible after reclamation'
);
select is(
  (select result ->> 'credentialRowVersion'
   from phase8b_reauthorization_after_reclamation),
  '3',
  'reauthorization binds the post-reclamation credential CAS version'
);
select is(
  (select result ->> 'recoveryEvidenceCount'
   from phase8b_reauthorization_after_reclamation),
  '24',
  'reauthorization retains all existing recovery evidence'
);

-- Hosted dblink tail: an expired lease reclamation races the stale refresh
-- worker that still holds the reclaimed lease. Exactly one may commit.
select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (values ('phase8b_lease_reclaim_race_1'), ('phase8b_lease_reclaim_race_2'))
  as connections(connection_name);

select extensions.dblink_exec(
  'phase8b_lease_reclaim_race_1',
  $setup$
    insert into public.profiles (id, email, full_name)
    values ('a8f00000-0000-4000-8000-000000000001', 'phase8b-lease-race-v3@example.test', 'Phase 8B Lease Race');
    insert into public.workspaces (id, name, created_by)
    values ('b8f00000-0000-4000-8000-000000000001', 'Phase 8B Lease Race', 'a8f00000-0000-4000-8000-000000000001');
    insert into public.workspace_members (workspace_id, user_id, role, status)
    values ('b8f00000-0000-4000-8000-000000000001', 'a8f00000-0000-4000-8000-000000000001', 'owner', 'active');
    insert into public.business_entities (
      id, workspace_id, entity_key, entity_type, display_name, base_currency,
      timezone, fiscal_year_start_month, created_by, updated_by
    ) values (
      'd8f00000-0000-4000-8000-000000000001',
      'b8f00000-0000-4000-8000-000000000001',
      'phase8b_lease_race', 'operating_company', 'Phase 8B Lease Race',
      'USD', 'UTC', 1,
      'a8f00000-0000-4000-8000-000000000001',
      'a8f00000-0000-4000-8000-000000000001'
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
      'integration_connection_v1', 'integration_connection_control_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001', 1,
      'quickbooks_online', 'sandbox',
      private.qbo_phase_8b_realm_fingerprint_v1('phase8b-lease-race-realm-v3'),
      'initializing', 'initial_sync_pending',
      array['com.intuit.quickbooks.accounting']::text[],
      array['com.intuit.quickbooks.accounting']::text[],
      'Phase 8B Lease Race Sandbox', 'vaeroex_provider_descriptors_v1',
      decode('6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758', 'hex'),
      decode('e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac', 'hex'),
      'qbo_provider_adapter_v1',
      jsonb_build_object(
        'operations', jsonb_build_array('get_capabilities','get_source_record','list_entities','list_source_records'),
        'domains', jsonb_build_array('change_hints','company_configuration','financial_transactions','master_records','report_control_observations'),
        'requiredStreamKeys', jsonb_build_array('accounts','company_info','preferences','qbo_apagingsummary','qbo_aragingsummary','qbo_balancesheet','qbo_bill','qbo_billpayment','qbo_cashflow','qbo_creditmemo','qbo_deposit','qbo_invoice','qbo_journalentry','qbo_payment','qbo_profitandloss','qbo_purchase','qbo_refundreceipt','qbo_salesreceipt','qbo_transfer','qbo_trialbalance','qbo_vendorcredit'),
        'supportsBackfill', true, 'webhookMode', 'change_hints', 'incrementalMode', 'cursor'
      ),
      1, current_timestamp - interval '2 hours',
      current_timestamp - interval '2 hours', 3,
      'a8f00000-0000-4000-8000-000000000001',
      current_timestamp - interval '2 hours', current_timestamp - interval '1 hour'
    );
    insert into private.provider_entity_mappings (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      mapping_series_id, mapping_version, provider_key, provider_environment,
      provider_entity_type, provider_entity_reference_fingerprint,
      safe_display_name, mapping_role, status, verification_mode,
      verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
      created_at, updated_at
    ) values (
      'f8f00000-0000-4000-8000-000000000001', 'provider_entity_mapping_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001',
      'f8f00000-0000-4000-8000-000000000001', 1,
      'quickbooks_online', 'sandbox', 'company',
      private.qbo_phase_8b_realm_fingerprint_v1('phase8b-lease-race-realm-v3'),
      'Phase 8B Lease Race Sandbox', 'primary', 'active',
      'qbo_realm_mapping_v1',
      extensions.digest(convert_to('phase8b-lease-race-mapping', 'UTF8'), 'sha256'),
      clock_timestamp() - interval '2 hours',
      'a8f00000-0000-4000-8000-000000000001',
      clock_timestamp() - interval '2 hours', 1,
      clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours'
    );
    insert into private.integration_oauth_states (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, provider_key, provider_environment, initiated_by,
      requested_scopes, return_intent, state_hash, status,
      creation_request_id, creation_request_fingerprint, consume_request_id,
      consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
    ) values (
      '18f00000-0000-4000-8000-000000000001', 'integration_oauth_state_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001', 1,
      'quickbooks_online', 'sandbox',
      'a8f00000-0000-4000-8000-000000000001',
      array['com.intuit.quickbooks.accounting']::text[],
      '/phase8b/sandbox/authorized',
      extensions.digest(convert_to('phase8b-lease-race-oauth-v3', 'UTF8'), 'sha256'),
      'consumed', 'phase8b_lease_race_create_v3',
      extensions.digest(convert_to('phase8b-lease-race-create', 'UTF8'), 'sha256'),
      'phase8b_lease_race_consume_v3',
      extensions.digest(convert_to('phase8b-lease-race-consume', 'UTF8'), 'sha256'),
      current_timestamp - interval '2 hours',
      current_timestamp - interval '110 minutes',
      current_timestamp - interval '115 minutes', 2
    );
    insert into private.integration_credentials (
      id, contract_version, oauth_state_id, workspace_id, business_entity_id,
      connection_id, connection_generation, provider_key, provider_environment,
      initiated_by, credential_version, envelope_schema_version,
      aad_schema_version, aad_digest, kms_key_resource, credential_ciphertext,
      access_expires_at, refresh_expires_at, granted_scopes,
      external_entity_reference_fingerprint, status, refresh_lease_id,
      refresh_lease_owner_fingerprint, refresh_lease_acquired_at,
      refresh_lease_expires_at, last_request_id, last_request_fingerprint,
      row_version, created_at, updated_at
    ) values (
      '78f00000-0000-4000-8000-000000000001',
      'integration_credential_authority_v1',
      '18f00000-0000-4000-8000-000000000001',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001', 1,
      'quickbooks_online', 'sandbox',
      'a8f00000-0000-4000-8000-000000000001', 1,
      'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
      private.phase_5_credential_aad_digest_v1(
        'sandbox', 'b8f00000-0000-4000-8000-000000000001',
        'e8f00000-0000-4000-8000-000000000001', 1,
        'quickbooks_online', '78f00000-0000-4000-8000-000000000001'
      ),
      'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
      convert_to(repeat('r', 256), 'UTF8'),
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '30 days',
      array['com.intuit.quickbooks.accounting']::text[],
      private.qbo_phase_8b_realm_fingerprint_v1('phase8b-lease-race-realm-v3'),
      'active', '58f00000-0000-4000-8000-000000000001',
      extensions.digest(convert_to('phase8b-lease-race-owner', 'UTF8'), 'sha256'),
      transaction_timestamp() - interval '7 minutes',
      transaction_timestamp() - interval '5 minutes',
      'phase8b_lease_race_acquire',
      extensions.digest(convert_to('phase8b-lease-race-acquire', 'UTF8'), 'sha256'),
      2, clock_timestamp() - interval '2 hours',
      clock_timestamp() - interval '5 minutes'
    );
    insert into private.integration_sync_runs (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      mapping_id, connection_generation, trigger_kind, mode, state,
      idempotency_fingerprint, provider_contract_version, adapter_version,
      policy_version, records_observed, records_accepted, records_rejected,
      facts_accepted, contributions_changed, created_at, started_at,
      row_version, updated_at
    ) values (
      '28f00000-0000-4000-8000-000000000001', 'integration_sync_run_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001',
      'f8f00000-0000-4000-8000-000000000001', 1,
      'provider_initialization', 'initialization', 'running',
      extensions.digest(convert_to('phase8b-lease-race-run', 'UTF8'), 'sha256'),
      'provider_adapter_v1', 'qbo_provider_adapter_v1',
      'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0,
      clock_timestamp() - interval '2 hours',
      clock_timestamp() - interval '2 hours', 2,
      clock_timestamp() - interval '2 hours'
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
      '38f00000-0000-4000-8000-000000000001', 'integration_sync_task_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001', 1,
      '28f00000-0000-4000-8000-000000000001',
      'quickbooks_online', 'sandbox', 'provider_bulk', 'initial_historical',
      'qbo_invoice', 'retry_wait', 40,
      jsonb_build_object(
        'checkpointId', null, 'mappingId', 'f8f00000-0000-4000-8000-000000000001',
        'eventId', null, 'pageOrdinal', 0, 'cursorVersion', 0,
        'windowStartAt', null, 'windowEndAt', null,
        'reasonCode', 'phase8b_expired_credential_recovery',
        'recordHintCount', 0, 'coalescedEventCount', 1
      ),
      extensions.digest(convert_to('phase8b-lease-race-task', 'UTF8'), 'sha256'),
      extensions.digest(convert_to('phase8b-lease-race-coalesce', 'UTF8'), 'sha256'),
      1, null, 1, 3, clock_timestamp() + interval '5 minutes',
      'phase8b_lease_race_recovery_v3',
      extensions.digest(convert_to('phase8b-lease-race-recovery', 'UTF8'), 'sha256'),
      5, clock_timestamp() - interval '1 hour',
      clock_timestamp() - interval '20 minutes',
      clock_timestamp() + interval '7 days'
    );
    insert into private.integration_sync_task_recovery_events (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, credential_id, credential_version, task_id,
      recovery_generation, prior_state, prior_failure_category,
      prior_failure_code, prior_row_version, prior_completed_at,
      retry_after_seconds, request_id, request_fingerprint, actor_id,
      recovered_at, created_at
    ) values (
      '48f00000-0000-4000-8000-000000000001',
      'qbo_sandbox_expired_credential_recovery_v1',
      'b8f00000-0000-4000-8000-000000000001',
      'd8f00000-0000-4000-8000-000000000001',
      'e8f00000-0000-4000-8000-000000000001', 1,
      '78f00000-0000-4000-8000-000000000001', 1,
      '38f00000-0000-4000-8000-000000000001', 1, 'failed', 'contract',
      'phase8b_provider_task_failed', 4,
      clock_timestamp() - interval '30 minutes', 30,
      'phase8b_lease_race_recovery_v3',
      extensions.digest(convert_to('phase8b-lease-race-recovery', 'UTF8'), 'sha256'),
      'phase8b_credential_recovery',
      current_timestamp - interval '20 minutes',
      current_timestamp - interval '20 minutes'
    )
  $setup$
);

select extensions.dblink_exec(
  'phase8b_lease_reclaim_race_1',
  $function$
    create or replace function pg_temp.try_expired_lease_reclamation()
    returns jsonb language plpgsql as $body$
    begin
      return jsonb_build_object(
        'outcome', 'reclaimed',
        'result', public.reclaim_integration_expired_refresh_lease_v1(
          jsonb_build_object(
            'contractVersion', 'integration_expired_refresh_lease_reclamation_v1',
            'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
            'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
            'connectionId', 'e8f00000-0000-4000-8000-000000000001',
            'connectionGeneration', 1,
            'credentialId', '78f00000-0000-4000-8000-000000000001',
            'expectedCredentialVersion', 1,
            'expectedCredentialRowVersion', 2,
            'providerKey', 'quickbooks_online',
            'providerEnvironment', 'sandbox',
            'reasonCode', 'refresh_lease_expired_reclaimed'
          ),
          'phase8b_concurrent_expired_lease_reclamation_v3'
        )
      );
    exception when others then
      return jsonb_build_object('outcome', 'failed', 'sqlstate', sqlstate);
    end;
    $body$
  $function$
);
select extensions.dblink_exec(
  'phase8b_lease_reclaim_race_2',
  $function$
    create or replace function pg_temp.try_timestamp(p_value timestamptz)
    returns text language sql stable as $body$
      select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    $body$
  $function$
);

select extensions.dblink_exec(
  'phase8b_lease_reclaim_race_2',
  $function$
    create or replace function pg_temp.try_stale_refresh_commit()
    returns jsonb language plpgsql as $body$
    begin
      return jsonb_build_object(
        'outcome', 'rotated',
        'result', public.rotate_integration_credential_v1(
          jsonb_build_object(
            'workspaceId', 'b8f00000-0000-4000-8000-000000000001',
            'businessEntityId', 'd8f00000-0000-4000-8000-000000000001',
            'connectionId', 'e8f00000-0000-4000-8000-000000000001',
            'connectionGeneration', 1,
            'credentialId', '78f00000-0000-4000-8000-000000000001',
            'expectedCredentialVersion', 1,
            'leaseId', '58f00000-0000-4000-8000-000000000001',
            'leaseOwnerFingerprint',
              'sha256:dd12f011171ee392fd9b0a7155fc9d745f295ba444a70467888d437f1449c729',
            'aadDigest',
              'sha256:da3f5af262b0cee89b5db524906b2e9f6d323f82699abc57ef773a548da17f8e',
            'kmsKeyResource', 'projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth',
            'ciphertextBase64', encode(convert_to(repeat('s', 32), 'UTF8'), 'base64'),
            'accessExpiresAt', pg_temp.try_timestamp(clock_timestamp() + interval '1 hour'),
            'refreshExpiresAt', pg_temp.try_timestamp(clock_timestamp() + interval '30 days'),
            'grantedScopes', jsonb_build_array('com.intuit.quickbooks.accounting'),
            'externalEntityReferenceFingerprint',
              'sha256:6743d06e5aaa2b8fc3012dc84f3bde69005f983dd561a16764b27b47a72b5978',
            'rotatedAt', pg_temp.try_timestamp(clock_timestamp())
          ),
          'phase8b_concurrent_stale_refresh_commit_v3'
        )
      );
    exception when others then
      return jsonb_build_object('outcome', 'failed', 'sqlstate', sqlstate);
    end;
    $body$
  $function$
);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (values ('phase8b_lease_reclaim_race_1'), ('phase8b_lease_reclaim_race_2'))
  as connections(connection_name);

select extensions.dblink_send_query(
  'phase8b_lease_reclaim_race_1',
  'select pg_temp.try_expired_lease_reclamation()'
);
select extensions.dblink_send_query(
  'phase8b_lease_reclaim_race_2',
  'select pg_temp.try_stale_refresh_commit()'
);

create temporary table phase8b_lease_reclamation_race_results (
  result jsonb not null
) on commit drop;
insert into phase8b_lease_reclamation_race_results(result)
select result
from extensions.dblink_get_result('phase8b_lease_reclaim_race_1')
  as response(result jsonb);
insert into phase8b_lease_reclamation_race_results(result)
select result
from extensions.dblink_get_result('phase8b_lease_reclaim_race_2')
  as response(result jsonb);

do $drain$
declare
  v_connection text;
begin
  foreach v_connection in array array[
    'phase8b_lease_reclaim_race_1',
    'phase8b_lease_reclaim_race_2'
  ] loop
    perform *
    from extensions.dblink_get_result(v_connection) as response(result jsonb);
  end loop;
end;
$drain$;

select is(
  (select count(*)::integer
   from phase8b_lease_reclamation_race_results
   where result ->> 'outcome' in ('reclaimed', 'rotated')),
  1,
  'expired lease reclamation versus stale refresh commit has exactly one valid outcome'
);
select is(
  (select count(*)::integer
   from phase8b_lease_reclamation_race_results
   where result ->> 'outcome' = 'reclaimed'),
  1,
  'database wall-clock permits the expired lease reclamation winner'
);
select is(
  (select count(*)::integer
   from phase8b_lease_reclamation_race_results
   where result ->> 'outcome' = 'failed'),
  1,
  'stale refresh worker cannot commit against the reclaimed lease'
);
select ok(
  (select
      credential_version = 1
      and row_version = 3
      and refresh_lease_id is null
      and access_expires_at < pg_catalog.clock_timestamp()
   from private.integration_credentials
   where id = '78f00000-0000-4000-8000-000000000001'),
  'concurrent reclamation preserves expired credential V1 and clears only its lease'
);
select is(
  (select count(*)::integer
   from private.integration_audit_events
   where action = 'refresh_lease_expired_reclaimed'
     and request_id = 'phase8b_concurrent_expired_lease_reclamation_v3'),
  1,
  'concurrent winner appends exactly one reclamation audit event'
);

select extensions.dblink_disconnect(connection_name)
from (values ('phase8b_lease_reclaim_race_1'), ('phase8b_lease_reclaim_race_2'))
  as connections(connection_name);

select * from finish();
rollback;
