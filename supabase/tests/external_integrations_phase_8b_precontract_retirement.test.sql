begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

grant usage on schema extensions to
  integration_qbo_precontract_retirement_authority;

create or replace function pg_temp.raises_sqlstate(
  p_sql text,
  p_expected text
)
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
returns bytea
language sql
immutable
strict
as $function$
  select extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256');
$function$;

create or replace function pg_temp.control_metadata(
  p_stream_key text,
  p_mapping_id uuid
)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'checkpointId', null,
    'mappingId', p_mapping_id,
    'eventId', null,
    'pageOrdinal', 0,
    'cursorVersion', 0,
    'windowStartAt', null,
    'windowEndAt', null,
    'reasonCode', 'precontract_' || p_stream_key,
    'recordHintCount', 0,
    'coalescedEventCount', 1
  );
$function$;

create or replace function pg_temp.retirement_command(
  p_task_id uuid,
  p_row_version bigint,
  p_dispatch_generation bigint,
  p_dispatcher_task_name text,
  p_pause_evidence_id uuid,
  p_workspace_id uuid default 'b9000000-0000-4000-8000-000000000001',
  p_business_entity_id uuid default 'd9000000-0000-4000-8000-000000000001',
  p_connection_id uuid default 'e9000000-0000-4000-8000-000000000001',
  p_sync_run_id uuid default 'a291839a-99c7-495e-8a53-57aa8aa6c99e'
)
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_precontract_dispatched_task_retirement_v1',
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'syncRunId', p_sync_run_id,
    'taskId', p_task_id,
    'expectedRowVersion', p_row_version,
    'expectedDispatchGeneration', p_dispatch_generation,
    'expectedDispatcherTaskName', p_dispatcher_task_name,
    'queuePauseEvidenceId', p_pause_evidence_id
  );
$function$;

create or replace function pg_temp.reconciliation_command(
  p_retirement_event_id uuid,
  p_task_id uuid,
  p_dispatcher_task_name text,
  p_deletion_outcome text
)
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion',
      'qbo_precontract_envelope_retirement_reconciliation_v1',
    'retirementEventId', p_retirement_event_id,
    'workspaceId', 'b9000000-0000-4000-8000-000000000001',
    'businessEntityId', 'd9000000-0000-4000-8000-000000000001',
    'connectionId', 'e9000000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
    'taskId', p_task_id,
    'queueResource',
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo',
    'dispatcherTaskName', p_dispatcher_task_name,
    'deletionOutcome', p_deletion_outcome,
    'providerOperationFingerprint',
      'sha256:' || pg_catalog.repeat('d', 64)
  );
$function$;

create or replace function pg_temp.replacement_manifest()
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'taskId', pg_catalog.format(
        '91000000-0000-4000-8001-%s',
        pg_catalog.lpad(stream.ordinality::text, 12, '0')
      ),
      'checkpointId', pg_catalog.format(
        '92000000-0000-4000-8002-%s',
        pg_catalog.lpad(stream.ordinality::text, 12, '0')
      ),
      'streamKey', stream.stream_key
    ) order by stream.stream_key
  )
  from pg_catalog.unnest(array[
    'accounts', 'customers_minimized', 'items_minimized', 'preferences',
    'qbo_apagingsummary', 'qbo_aragingsummary', 'qbo_balancesheet',
    'qbo_bill', 'qbo_billpayment', 'qbo_cashflow', 'qbo_creditmemo',
    'qbo_deposit', 'qbo_invoice', 'qbo_journalentry', 'qbo_payment',
    'qbo_profitandloss', 'qbo_purchase', 'qbo_refundreceipt',
    'qbo_salesreceipt', 'qbo_transfer', 'qbo_trialbalance',
    'qbo_vendorcredit', 'vendors_minimized'
  ]::text[]) with ordinality as stream(stream_key, ordinality);
$function$;

insert into public.profiles (id, email, full_name) values (
  'a9000000-0000-4000-8000-000000000001',
  'phase8b-precontract-retirement@example.test',
  'Phase 8B Precontract Retirement'
);
insert into public.workspaces (id, name, created_by) values (
  'b9000000-0000-4000-8000-000000000001',
  'Phase 8B Precontract Retirement',
  'a9000000-0000-4000-8000-000000000001'
);
insert into public.workspace_members (
  id, workspace_id, user_id, role, status
) values (
  'c9000000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  'owner',
  'active'
);
insert into public.business_entities (
  id, workspace_id, contract_version, entity_key, entity_type, display_name,
  base_currency, timezone, fiscal_year_start_month, status, created_by,
  updated_by, created_at, updated_at
) values (
  'd9000000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001',
  'business_entity_v1',
  'phase8b_precontract_retirement',
  'operating_company',
  'Phase 8B Precontract Retirement',
  'USD',
  'UTC',
  1,
  'active',
  'a9000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '4 hours',
  pg_catalog.transaction_timestamp() - interval '4 hours'
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
  'e9000000-0000-4000-8000-000000000001',
  'integration_connection_v1',
  'integration_connection_control_v1',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-retirement-realm'),
  'initializing',
  'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Phase 8B Retirement Sandbox',
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
  pg_catalog.transaction_timestamp() - interval '4 hours',
  pg_catalog.transaction_timestamp() - interval '4 hours',
  3,
  'a9000000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '4 hours',
  pg_catalog.transaction_timestamp() - interval '4 hours'
);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, provider_key, provider_environment,
  provider_entity_type, provider_entity_reference_fingerprint,
  safe_display_name, mapping_role, status, verification_mode,
  verification_fingerprint, verified_at, mapped_by, mapped_at, row_version,
  created_at, updated_at
) values (
  'f9000000-0000-4000-8000-000000000001',
  'provider_entity_mapping_v1',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  1,
  'quickbooks_online',
  'sandbox',
  'company',
  private.qbo_phase_8b_realm_fingerprint_v1('phase8b-retirement-realm'),
  'Phase 8B Retirement Sandbox',
  'primary',
  'active',
  'qbo_realm_mapping_v1',
  pg_temp.fingerprint('phase8b-retirement-realm-verified'),
  pg_catalog.transaction_timestamp() - interval '4 hours',
  'a9000000-0000-4000-8000-000000000001',
  pg_catalog.transaction_timestamp() - interval '4 hours',
  1,
  pg_catalog.transaction_timestamp() - interval '4 hours',
  pg_catalog.transaction_timestamp() - interval '4 hours'
);

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, provider_contract_version, adapter_version,
  policy_version, records_observed, records_accepted, records_rejected,
  facts_accepted, contributions_changed, created_at, started_at,
  row_version, updated_at
) values (
  'a291839a-99c7-495e-8a53-57aa8aa6c99e',
  'integration_sync_run_v1',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  1,
  'provider_initialization',
  'initialization',
  'running',
  pg_temp.fingerprint('phase8b-precontract-old-run'),
  'provider_adapter_v1',
  'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1',
  1, 0, 1, 0, 0,
  pg_catalog.transaction_timestamp() - interval '4 hours',
  pg_catalog.transaction_timestamp() - interval '4 hours',
  2,
  pg_catalog.transaction_timestamp() - interval '4 hours'
);

create or replace function pg_temp.insert_task(
  p_task_id uuid,
  p_stream_key text,
  p_state text,
  p_row_version bigint,
  p_dispatch_generation bigint,
  p_dispatcher_task_name text,
  p_durable_effect boolean default false
)
returns void
language plpgsql
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
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
    last_request_fingerprint, row_version, created_at, updated_at,
    completed_at, retention_expires_at
  ) values (
    p_task_id,
    'integration_sync_task_v1',
    'b9000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000001',
    'e9000000-0000-4000-8000-000000000001',
    1,
    'a291839a-99c7-495e-8a53-57aa8aa6c99e',
    'quickbooks_online',
    'sandbox',
    'provider_interactive',
    'initial_historical',
    p_stream_key,
    p_state,
    80,
    pg_temp.control_metadata(
      p_stream_key,
      'f9000000-0000-4000-8000-000000000001'
    ),
    pg_temp.fingerprint('task-idempotency:' || p_task_id::text),
    pg_temp.fingerprint('task-coalescing:' || p_task_id::text),
    p_dispatcher_task_name,
    p_dispatch_generation,
    'attributed',
    p_dispatch_generation,
    0,
    0,
    pg_temp.fingerprint('task-delivery:' || p_task_id::text),
    1,
    5,
    v_now - interval '3 hours',
    case when p_state = 'failed' then 'contract' end,
    case when p_state = 'failed' then 'phase8b_provider_task_failed' end,
    case when p_durable_effect then
      pg_temp.fingerprint('task-effect:' || p_task_id::text)
    end,
    'fixture_' || pg_catalog.replace(p_task_id::text, '-', ''),
    pg_temp.fingerprint('task-request:' || p_task_id::text),
    p_row_version,
    v_now - interval '4 hours',
    v_now - interval '2 hours',
    case when p_state in ('failed', 'succeeded') then
      v_now - interval '2 hours'
    end,
    v_now + interval '7 days'
  );
end;
$function$;

select pg_temp.insert_task(
  'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea',
  'qbo_balancesheet', 'dispatched', 7, 2,
  '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e'
);
select pg_temp.insert_task(
  '49dd3c22-a3d4-4f85-83c0-ed91fdb16131',
  'qbo_creditmemo', 'dispatched', 7, 2,
  'bba96a27c7203629e812bd4cbbcaf715b85957a693e919ddf55ce8c570ee283e'
);
select pg_temp.insert_task(
  '872142c0-ddae-41eb-9e60-1babc6629d68',
  'qbo_purchase', 'dispatched', 12, 3,
  '59f93aaccfa64c46596354a448f1df348b7823a5b4cd47111ca1453d9096401d'
);

select pg_temp.insert_task(
  pg_catalog.format(
    '93000000-0000-4000-8003-%s',
    pg_catalog.lpad(series::text, 12, '0')
  )::uuid,
  'historical_failed_' || series::text,
  'failed', 9, 2, null
)
from pg_catalog.generate_series(1, 20) as series;

select pg_temp.insert_task(
  'edb562b4-11fa-4bc4-93ea-2bb50e4d7f15',
  'company_info', 'succeeded', 12, 3, null, true
);

insert into private.external_source_records (
  id, workspace_id, business_entity_id, mapping_id, connection_id,
  source_kind, provider_key, provider_record_type, provider_record_id,
  source_identity_fingerprint, current_version_id, lifecycle_state,
  first_seen_at, last_seen_at, created_at, updated_at
) values (
  '59000000-0000-4000-8005-000000000001',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  'provider',
  'quickbooks_online',
  'CompanyInfo',
  'company_info_1',
  pg_temp.fingerprint('company-info-source-identity'),
  '69000000-0000-4000-8006-000000000001',
  'active',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.external_source_record_versions (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  source_record_id, sync_run_id, immutable_version, prior_version_id,
  record_kind, source_kind, provider_key, provider_record_type,
  provider_record_id, provider_version_reference, temporal_basis,
  observed_at, synchronized_at, ingested_at, effective_at,
  accounting_basis, accounting_currency, normalized_schema_version,
  change_kind, normalized_projection, trust, validation_state,
  validator_version, validation_issues, received_at, source_fingerprint,
  created_at
) values (
  '69000000-0000-4000-8006-000000000001',
  'external_source_record_version_v1',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  '59000000-0000-4000-8005-000000000001',
  'a291839a-99c7-495e-8a53-57aa8aa6c99e',
  1,
  null,
  'company_configuration',
  'provider',
  'quickbooks_online',
  'CompanyInfo',
  'company_info_1',
  'provider_version_1',
  'point_in_time',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours',
  'not_applicable',
  'USD',
  'qbo_company_info_minimized_v1',
  'created',
  pg_catalog.jsonb_build_object('recordType', 'CompanyInfo'),
  'untrusted_external_input',
  'pending',
  'pending_provider_validation_v1',
  '[]'::jsonb,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_temp.fingerprint('company-info-source-version'),
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

insert into private.integration_sync_checkpoints (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, mapping_id, provider_key, provider_environment,
  stream_key, checkpoint_kind, lifecycle, cursor_version, cursor_metadata,
  cursor_fingerprint, provider_watermark_at, overlap_seconds,
  checkpoint_version, last_sync_run_id, last_task_id,
  downstream_commit_fingerprint, last_request_id, last_request_fingerprint,
  row_version, created_at, updated_at
) values (
  '79000000-0000-4000-8007-000000000001',
  'integration_sync_checkpoint_v1',
  'b9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  1,
  'f9000000-0000-4000-8000-000000000001',
  'quickbooks_online',
  'sandbox',
  'company_info',
  'cursor',
  'active',
  1,
  pg_catalog.jsonb_build_object(
    'protocolVersion', 'integration_sync_checkpoint_v1',
    'cursorKind', 'cursor',
    'cursorValue', 'company_info_complete_1',
    'windowStartAt', null,
    'windowEndAt', null
  ),
  pg_temp.fingerprint('company-info-checkpoint'),
  pg_catalog.transaction_timestamp() - interval '2 hours',
  300,
  1,
  'a291839a-99c7-495e-8a53-57aa8aa6c99e',
  'edb562b4-11fa-4bc4-93ea-2bb50e4d7f15',
  pg_temp.fingerprint(
    'task-effect:edb562b4-11fa-4bc4-93ea-2bb50e4d7f15'
  ),
  'company_info_checkpoint_1',
  pg_temp.fingerprint('company-info-checkpoint-request'),
  1,
  pg_catalog.transaction_timestamp() - interval '2 hours',
  pg_catalog.transaction_timestamp() - interval '2 hours'
);

select ok(
  not pg_catalog.pg_has_role(
    'service_role',
    'integration_qbo_precontract_retirement_authority',
    'MEMBER'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.retire_qbo_sandbox_precontract_dispatched_task_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'service_role has no retirement shortcut'
);

set local role integration_qbo_precontract_retirement_authority;
create temporary table phase8b_precontract_pause as
select public.attest_qbo_sandbox_precontract_queue_pause_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_precontract_queue_pause_attestation_v1',
    'workspaceId', 'b9000000-0000-4000-8000-000000000001',
    'businessEntityId', 'd9000000-0000-4000-8000-000000000001',
    'connectionId', 'e9000000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
    'queueResource',
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo',
    'queueState', 'PAUSED',
    'observedEnvelopeCount', 3,
    'queueSnapshotFingerprint', 'sha256:' || pg_catalog.repeat('a', 64),
    'observedAt', pg_catalog.transaction_timestamp()
  ),
  'precontract_pause_attestation',
  'phase8b_precontract_operator'
) as result;

select is(
  (select result ->> 'queueState' from phase8b_precontract_pause),
  'PAUSED',
  'retirement authority records a fresh exact paused-queue snapshot'
);

select ok(
  pg_temp.raises_sqlstate(
    pg_catalog.format(
      $sql$select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
        pg_temp.retirement_command(
          '94000000-0000-4000-8004-000000000001', 7, 2,
          %L, %L
        ), 'wrong_task', 'phase8b_precontract_operator'
      )$sql$,
      pg_catalog.repeat('f', 64),
      (select result ->> 'pauseEvidenceId' from phase8b_precontract_pause)
    ),
    '42501'
  ),
  'a non-allowlisted task cannot use the retirement authority'
);

select ok(
  pg_temp.raises_sqlstate(
    pg_catalog.format(
      $sql$select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
        pg_temp.retirement_command(
          'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea', 8, 2,
          '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e',
          %L
        ), 'wrong_row', 'phase8b_precontract_operator'
      )$sql$,
      (select result ->> 'pauseEvidenceId' from phase8b_precontract_pause)
    ),
    '42501'
  )
  and pg_temp.raises_sqlstate(
    pg_catalog.format(
      $sql$select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
        pg_temp.retirement_command(
          'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea', 7, 3,
          '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e',
          %L
        ), 'wrong_generation', 'phase8b_precontract_operator'
      )$sql$,
      (select result ->> 'pauseEvidenceId' from phase8b_precontract_pause)
    ),
    '42501'
  )
  and pg_temp.raises_sqlstate(
    pg_catalog.format(
      $sql$select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
        pg_temp.retirement_command(
          'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea', 7, 2,
          %L, %L
        ), 'wrong_envelope', 'phase8b_precontract_operator'
      )$sql$,
      pg_catalog.repeat('e', 64),
      (select result ->> 'pauseEvidenceId' from phase8b_precontract_pause)
    ),
    '42501'
  ),
  'wrong task CAS, dispatch generation, or Cloud Task identity fails closed'
);

select ok(
  pg_temp.raises_sqlstate(
    pg_catalog.format(
      $sql$select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
        pg_temp.retirement_command(
          'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea', 7, 2,
          '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e',
          %L,
          'b9000000-0000-4000-8000-000000000002'
        ), 'wrong_workspace', 'phase8b_precontract_operator'
      )$sql$,
      (select result ->> 'pauseEvidenceId' from phase8b_precontract_pause)
    ),
    '42501'
  ),
  'cross-workspace retirement fails closed'
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
  ('phase8b_precontract_retire_race_1'),
  ('phase8b_precontract_retire_race_2')
) as connections(connection_name);

select extensions.dblink_send_query(
  connection_name,
  $query$
    select public.retire_qbo_sandbox_precontract_dispatched_task_v1(
      jsonb_build_object(
        'contractVersion', 'qbo_precontract_dispatched_task_retirement_v1',
        'workspaceId', 'b9000000-0000-4000-8000-000000000001',
        'businessEntityId', 'd9000000-0000-4000-8000-000000000001',
        'connectionId', 'e9000000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
        'taskId', 'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea',
        'expectedRowVersion', 7,
        'expectedDispatchGeneration', 2,
        'expectedDispatcherTaskName',
          '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e',
        'queuePauseEvidenceId', (
          select id
          from private.integration_qbo_precontract_queue_pause_evidence
          where request_id = 'precontract_pause_attestation'
        )
      ),
      'precontract_balance_sheet_retirement',
      'phase8b_precontract_operator'
    )
  $query$
)
from (values
  ('phase8b_precontract_retire_race_1'),
  ('phase8b_precontract_retire_race_2')
) as connections(connection_name);

create temporary table phase8b_precontract_concurrent_results (
  result jsonb not null
);
insert into phase8b_precontract_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_precontract_retire_race_1')
  as response(result jsonb);
insert into phase8b_precontract_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_precontract_retire_race_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_precontract_retire_race_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_precontract_retire_race_2')
  as response(result jsonb);

select ok(
  (select pg_catalog.count(*) = 2
    from phase8b_precontract_concurrent_results)
  and (select pg_catalog.count(*) = 1
    from phase8b_precontract_concurrent_results
    where not (result ->> 'idempotent')::boolean)
  and (select pg_catalog.count(*) = 1
    from phase8b_precontract_concurrent_results
    where (result ->> 'idempotent')::boolean),
  'concurrent retirement permits one mutation and one idempotent replay'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_precontract_retire_race_1'),
  ('phase8b_precontract_retire_race_2')
) as connections(connection_name);

begin;
set local search_path = public, extensions;
set local role integration_qbo_precontract_retirement_authority;

create temporary table phase8b_precontract_retirements as
select
  target.task_id,
  target.task_name,
  public.retire_qbo_sandbox_precontract_dispatched_task_v1(
    pg_temp.retirement_command(
      target.task_id,
      target.row_version,
      target.dispatch_generation,
      target.task_name,
      (
        select id
        from private.integration_qbo_precontract_queue_pause_evidence
        where request_id = 'precontract_pause_attestation'
      )
    ),
    target.request_id,
    'phase8b_precontract_operator'
  ) as result
from (values
  (
    '49dd3c22-a3d4-4f85-83c0-ed91fdb16131'::uuid,
    7::bigint,
    2::bigint,
    'bba96a27c7203629e812bd4cbbcaf715b85957a693e919ddf55ce8c570ee283e',
    'precontract_credit_memo_retirement'
  ),
  (
    '872142c0-ddae-41eb-9e60-1babc6629d68'::uuid,
    12::bigint,
    3::bigint,
    '59f93aaccfa64c46596354a448f1df348b7823a5b4cd47111ca1453d9096401d',
    'precontract_purchase_retirement'
  )
) as target(
  task_id, row_version, dispatch_generation, task_name, request_id
);
reset role;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_precontract_retirement_events
  ),
  '3',
  'exactly one immutable retirement event exists per reviewed task'
);
select ok(
  (
    select pg_catalog.bool_and(
      task.state = 'cancelled'
        and task.dispatcher_task_name is null
        and task.durable_effect_fingerprint is null
        and task.row_version = event.prior_row_version + 1
        and task.dispatch_generation = event.prior_dispatch_generation
        and task.last_delivery_attempt_fingerprint =
          event.prior_delivery_attempt_fingerprint
        and task.attempt_count = event.prior_attempt_count
    )
    from private.integration_sync_task_precontract_retirement_events as event
    inner join private.integration_sync_tasks as task on task.id = event.task_id
  ),
  'retirement preserves logical identity and all prior delivery evidence'
);

set local role integration_qbo_precontract_retirement_authority;
create temporary table phase8b_precontract_reconciliations as
select
  event.task_id,
  public.reconcile_qbo_sandbox_precontract_envelope_retirement_v1(
    pg_temp.reconciliation_command(
      event.id,
      event.task_id,
      event.prior_dispatcher_task_name,
      case when event.task_id =
        '872142c0-ddae-41eb-9e60-1babc6629d68'::uuid
        then 'already_absent' else 'deleted' end
    ),
    'precontract_reconcile_' || pg_catalog.replace(event.task_id::text, '-', ''),
    'phase8b_precontract_operator'
  ) as result
from private.integration_sync_task_precontract_retirement_events as event;

select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_task_envelope_retirement_reconciliations
  ),
  '3',
  'all exact external deletion outcomes are reconciled once'
);
select is(
  public.reconcile_qbo_sandbox_precontract_envelope_retirement_v1(
    pg_temp.reconciliation_command(
      event.id,
      event.task_id,
      event.prior_dispatcher_task_name,
      'already_absent'
    ),
    'precontract_reconcile_' || pg_catalog.replace(event.task_id::text, '-', ''),
    'phase8b_precontract_operator'
  ) ->> 'idempotent',
  'true',
  'already-absent deletion reconciliation is idempotent'
)
from private.integration_sync_task_precontract_retirement_events as event
where event.task_id = '872142c0-ddae-41eb-9e60-1babc6629d68';
reset role;

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_sync_task_precontract_retirement_events
      set actor_id = 'forged'
      where task_id = 'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_sync_task_precontract_retirement_events
      where task_id = 'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea'$$,
    '55000'
  ),
  'retirement evidence is update/delete immutable'
);

select ok(
  (
    select pg_catalog.count(*) = 3
      and pg_catalog.bool_and(
        state = 'cancelled'
          and dispatcher_task_name is null
          and completed_at is not null
      )
    from private.integration_sync_tasks
    where id in (
      'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea'::uuid,
      '49dd3c22-a3d4-4f85-83c0-ed91fdb16131'::uuid,
      '872142c0-ddae-41eb-9e60-1babc6629d68'::uuid
    )
  ),
  'cancelled tasks remain undiscoverable, unpromotable, and unreservable'
);

set local role integration_qbo_precontract_retirement_authority;
create temporary table phase8b_precontract_finalization as
select public.finalize_qbo_sandbox_precontract_initialization_run_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_incomplete_initialization_run_retirement_v1',
    'workspaceId', 'b9000000-0000-4000-8000-000000000001',
    'businessEntityId', 'd9000000-0000-4000-8000-000000000001',
    'connectionId', 'e9000000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
    'expectedRunRowVersion', 2
  ),
  'precontract_finalize_old_run',
  'phase8b_precontract_operator'
) as result;
reset role;

select ok(
  (
    select result ->> 'state' = 'failed'
      and result ->> 'failedTaskCount' = '20'
      and result ->> 'cancelledTaskCount' = '3'
      and result ->> 'succeededTaskCount' = '1'
    from phase8b_precontract_finalization
  )
  and (
    select state = 'failed'
      and error_category = 'contract'
      and error_code = 'pre_v5_task_bound_evidence_incomplete'
      and finished_at is not null
    from private.integration_sync_runs
    where id = 'a291839a-99c7-495e-8a53-57aa8aa6c99e'
  ),
  'old run closes only as incomplete historical evidence at 20/3/1'
);

select ok(
  (
    select trust = 'untrusted_external_input'
      and validation_state = 'pending'
      and downstream_fact_source_count = 0
      and downstream_reconciliation_member_count = 0
      and carry_mode =
        'reference_existing_until_checkpoint_freshness_requires_read'
    from private.integration_sync_run_company_info_carry_forward_evidence
    where old_sync_run_id = 'a291839a-99c7-495e-8a53-57aa8aa6c99e'
  )
  and (
    select pg_catalog.count(*) = 1
    from private.external_source_records
    where provider_record_type = 'CompanyInfo'
  )
  and (
    select pg_catalog.count(*) = 1
    from private.external_source_record_versions
    where provider_record_type = 'CompanyInfo'
  ),
  'CompanyInfo carry-forward preserves one pending untrusted source/version'
);

create temporary table phase8b_precontract_plan_baseline as
select
  (select pg_catalog.count(*) from private.integration_sync_runs) as run_count,
  (select pg_catalog.count(*) from private.integration_sync_tasks) as task_count,
  (select pg_catalog.count(*) from private.external_source_records) as source_count,
  (select pg_catalog.count(*) from private.external_source_record_versions)
    as version_count,
  (select pg_catalog.count(*) from private.business_fact_sources) as fact_count,
  (select pg_catalog.count(*) from private.reconciliation_case_members)
    as reconciliation_count;

set local role integration_qbo_precontract_retirement_authority;
create temporary table phase8b_precontract_plan_result as
select public.plan_qbo_sandbox_clean_replacement_initialization_v1(
  pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_clean_replacement_initialization_plan_v1',
    'workspaceId', 'b9000000-0000-4000-8000-000000000001',
    'businessEntityId', 'd9000000-0000-4000-8000-000000000001',
    'connectionId', 'e9000000-0000-4000-8000-000000000001',
    'connectionGeneration', 1,
    'oldSyncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
    'expectedOldRunRowVersion', 3,
    'replacementSyncRunId', '99000000-0000-4000-8009-000000000001',
    'companyInfoCarryForwardEvidenceId', (
      select id
      from private.integration_sync_run_company_info_carry_forward_evidence
      where old_sync_run_id = 'a291839a-99c7-495e-8a53-57aa8aa6c99e'
    ),
    'tasks', pg_temp.replacement_manifest()
  ),
  'precontract_plan_replacement_wave',
  'phase8b_precontract_operator'
) as result;
reset role;

select ok(
  (
    select result ->> 'plannedTaskCount' = '23'
      and result ->> 'companyInfoMode' =
        'carry_forward_existing_source_and_checkpoint'
    from phase8b_precontract_plan_result
  )
  and (
    select pg_catalog.jsonb_array_length(task_manifest) = 23
      and pg_catalog.jsonb_array_length(task_manifest) =
        (
          select pg_catalog.count(
            distinct item.value ->> 'dispatcherTaskName'
          )
          from pg_catalog.jsonb_array_elements(task_manifest) as item(value)
        )
      and not task_manifest @> '[{"streamKey":"company_info"}]'::jsonb
    from private.integration_qbo_clean_replacement_wave_plans
  ),
  'replacement plan has 23 fresh tasks, checkpoints, and deterministic names'
);

select ok(
  (
    select baseline.run_count =
        (select pg_catalog.count(*) from private.integration_sync_runs)
      and baseline.task_count =
        (select pg_catalog.count(*) from private.integration_sync_tasks)
      and baseline.source_count =
        (select pg_catalog.count(*) from private.external_source_records)
      and baseline.version_count =
        (select pg_catalog.count(*) from private.external_source_record_versions)
      and baseline.fact_count =
        (select pg_catalog.count(*) from private.business_fact_sources)
      and baseline.reconciliation_count =
        (select pg_catalog.count(*) from private.reconciliation_case_members)
    from phase8b_precontract_plan_baseline as baseline
  ),
  'replacement plan creates no run, task, source, fact, reconciliation, or KPI mutation'
);

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_qbo_clean_replacement_wave_plans
      set actor_id = 'forged'$$,
    '55000'
  )
  and not exists (
    select 1
    from private.integration_sync_tasks as task
    inner join private.integration_sync_runs as run
      on run.id = task.sync_run_id
    where task.sync_run_id = 'a291839a-99c7-495e-8a53-57aa8aa6c99e'
      and run.state in ('created', 'running')
      and task.state in ('pending', 'retry_wait')
  ),
  'finalized old run cannot schedule work and replacement evidence is immutable'
);

select * from finish();
rollback;
