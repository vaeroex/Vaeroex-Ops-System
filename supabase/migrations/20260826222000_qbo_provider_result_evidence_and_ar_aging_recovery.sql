-- Phase 8B prospective provider/parser evidence and A/R identifier recovery.
--
-- Provider and parser outcomes are immutable, task-bound control evidence. They
-- intentionally contain no provider payload, business values, realm reference,
-- token material, authorization header, or client secret. The historical A/P
-- task remains nonrecoverable; only the exact reviewed A/R 5020 task may use
-- the reason-specific recovery contract below.

begin;

create table private.integration_qbo_provider_task_result_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_provider_result_evidence_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  task_row_version bigint not null check (task_row_version > 0),
  task_dispatch_generation bigint not null check (task_dispatch_generation > 0),
  dispatcher_task_name text not null check (
    pg_catalog.octet_length(dispatcher_task_name) between 1 and 1024
  ),
  delivery_attribution_state text not null check (
    delivery_attribution_state = 'attributed'
  ),
  delivery_dispatch_generation bigint not null check (
    delivery_dispatch_generation = task_dispatch_generation
  ),
  delivery_retry_count integer not null check (
    delivery_retry_count between 0 and 100
  ),
  delivery_execution_count integer not null check (
    delivery_execution_count between 0 and delivery_retry_count
  ),
  delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(delivery_attempt_fingerprint) = 32
  ),
  lease_id uuid not null,
  lease_owner_fingerprint bytea not null check (
    pg_catalog.octet_length(lease_owner_fingerprint) = 32
  ),
  lease_expires_at timestamptz not null,
  credential_read_evidence_id uuid not null references
    private.integration_provider_credential_task_read_evidence(id)
    on delete restrict,
  credential_id uuid not null references private.integration_credentials(id)
    on delete restrict,
  credential_version bigint not null check (credential_version > 0),
  provider_key text not null check (provider_key = 'quickbooks_online'),
  provider_environment text not null check (provider_environment = 'sandbox'),
  endpoint_domain text not null check (
    endpoint_domain in ('company_info', 'entity_query', 'report', 'cdc')
  ),
  endpoint_class text not null check (endpoint_class in (
    'qbo_company_info', 'qbo_entity_query', 'qbo_cdc',
    'qbo_report_aged_payables', 'qbo_report_aged_receivables',
    'qbo_report_balance_sheet', 'qbo_report_cash_flow',
    'qbo_report_profit_and_loss', 'qbo_report_trial_balance'
  )),
  request_ordinal integer not null check (request_ordinal between 1 and 128),
  provider_request_fingerprint bytea not null check (
    pg_catalog.octet_length(provider_request_fingerprint) = 32
  ),
  provider_outcome text not null check (provider_outcome in (
    'provider_success', 'provider_fault', 'provider_transport_failure',
    'provider_schema_failure'
  )),
  request_id text not null unique check (
    private.is_bounded_identifier_v1(request_id)
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  evidence_fingerprint bytea not null unique check (
    pg_catalog.octet_length(evidence_fingerprint) = 32
  ),
  authority_role text not null check (
    authority_role = 'integration_provider_runtime_authority'
  ),
  observed_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_qbo_provider_result_read_ordinal_key unique (
    credential_read_evidence_id, request_ordinal
  ),
  constraint integration_qbo_provider_result_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_qbo_provider_result_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_qbo_provider_result_time_check check (
    observed_at = created_at and observed_at < lease_expires_at
  )
);

create index integration_qbo_provider_result_task_idx
  on private.integration_qbo_provider_task_result_evidence(
    workspace_id, business_entity_id, connection_id,
    connection_generation, task_id, observed_at
  );

alter table private.integration_qbo_provider_task_result_evidence
  enable row level security;
alter table private.integration_qbo_provider_task_result_evidence
  force row level security;
create trigger reject_integration_qbo_provider_result_mutation_v1
before update or delete
on private.integration_qbo_provider_task_result_evidence
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table private.integration_qbo_report_parser_result_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_report_parser_result_evidence_v1'
  ),
  provider_result_evidence_id uuid not null unique references
    private.integration_qbo_provider_task_result_evidence(id)
    on delete restrict,
  credential_read_evidence_id uuid not null references
    private.integration_provider_credential_task_read_evidence(id)
    on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  task_row_version bigint not null check (task_row_version > 0),
  task_dispatch_generation bigint not null check (task_dispatch_generation > 0),
  dispatcher_task_name text not null check (
    pg_catalog.octet_length(dispatcher_task_name) between 1 and 1024
  ),
  delivery_dispatch_generation bigint not null,
  delivery_retry_count integer not null check (
    delivery_retry_count between 0 and 100
  ),
  delivery_execution_count integer not null check (
    delivery_execution_count between 0 and delivery_retry_count
  ),
  delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(delivery_attempt_fingerprint) = 32
  ),
  lease_id uuid not null,
  lease_owner_fingerprint bytea not null check (
    pg_catalog.octet_length(lease_owner_fingerprint) = 32
  ),
  credential_id uuid not null references private.integration_credentials(id)
    on delete restrict,
  credential_version bigint not null check (credential_version > 0),
  provider_key text not null check (provider_key = 'quickbooks_online'),
  provider_environment text not null check (provider_environment = 'sandbox'),
  endpoint_class text not null check (endpoint_class like 'qbo_report_%'),
  provider_request_fingerprint bytea not null check (
    pg_catalog.octet_length(provider_request_fingerprint) = 32
  ),
  parser_outcome text not null check (parser_outcome in (
    'parser_success', 'report_header_shape', 'report_columns_shape',
    'report_rows_shape', 'report_cell_shape', 'report_summary_shape',
    'report_metadata_shape', 'minimization_failure'
  )),
  request_id text not null unique check (
    private.is_bounded_identifier_v1(request_id)
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  evidence_fingerprint bytea not null unique check (
    pg_catalog.octet_length(evidence_fingerprint) = 32
  ),
  authority_role text not null check (
    authority_role = 'integration_provider_runtime_authority'
  ),
  observed_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_qbo_report_parser_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_qbo_report_parser_time_check check (
    observed_at = created_at
  )
);

create index integration_qbo_report_parser_task_idx
  on private.integration_qbo_report_parser_result_evidence(
    workspace_id, business_entity_id, connection_id,
    connection_generation, task_id, observed_at
  );

alter table private.integration_qbo_report_parser_result_evidence
  enable row level security;
alter table private.integration_qbo_report_parser_result_evidence
  force row level security;
create trigger reject_integration_qbo_report_parser_result_mutation_v1
before update or delete
on private.integration_qbo_report_parser_result_evidence
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

revoke all on table
  private.integration_qbo_provider_task_result_evidence,
  private.integration_qbo_report_parser_result_evidence
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_qbo_canary_dispatch_authority,
  integration_qbo_precontract_retirement_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

create or replace function private.qbo_provider_endpoint_binding_v1(
  p_stream_key text
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $function$
  select case p_stream_key
    when 'company_info' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'company_info', 'endpointClass', 'qbo_company_info'
    )
    when 'qbo_cdc' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'cdc', 'endpointClass', 'qbo_cdc'
    )
    when 'qbo_apagingsummary' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report',
      'endpointClass', 'qbo_report_aged_payables'
    )
    when 'qbo_aragingsummary' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report',
      'endpointClass', 'qbo_report_aged_receivables'
    )
    when 'qbo_balancesheet' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report',
      'endpointClass', 'qbo_report_balance_sheet'
    )
    when 'qbo_cashflow' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report', 'endpointClass', 'qbo_report_cash_flow'
    )
    when 'qbo_profitandloss' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report',
      'endpointClass', 'qbo_report_profit_and_loss'
    )
    when 'qbo_trialbalance' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'report',
      'endpointClass', 'qbo_report_trial_balance'
    )
    when 'accounts' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'customers_minimized' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'items_minimized' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'preferences' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'vendors_minimized' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_bill' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_billpayment' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_creditmemo' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_deposit' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_invoice' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_journalentry' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_payment' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_purchase' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_refundreceipt' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_salesreceipt' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_transfer' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    when 'qbo_vendorcredit' then pg_catalog.jsonb_build_object(
      'endpointDomain', 'entity_query', 'endpointClass', 'qbo_entity_query'
    )
    else null
  end;
$function$;

create or replace function public.record_qbo_sandbox_provider_result_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_read private.integration_provider_credential_task_read_evidence;
  v_task private.integration_sync_tasks;
  v_expected_endpoint jsonb;
  v_existing private.integration_qbo_provider_task_result_evidence;
  v_request_fingerprint bytea;
  v_provider_request_fingerprint bytea;
  v_evidence_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'credentialReadEvidenceId', 'requestOrdinal',
        'endpointDomain', 'endpointClass', 'providerRequestFingerprint',
        'providerOutcome'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_provider_result_evidence_v1'
    or (p_command ->> 'requestOrdinal') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'requestOrdinal')::integer not between 1 and 128
    or p_command ->> 'endpointDomain' not in (
      'company_info', 'entity_query', 'report', 'cdc'
    )
    or p_command ->> 'providerOutcome' not in (
      'provider_success', 'provider_fault', 'provider_transport_failure',
      'provider_schema_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_provider_result_evidence_invalid';
  end if;

  perform (p_command ->> 'credentialReadEvidenceId')::uuid;
  v_provider_request_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerRequestFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select evidence.* into v_read
  from private.integration_provider_credential_task_read_evidence as evidence
  where evidence.id = (p_command ->> 'credentialReadEvidenceId')::uuid
    and evidence.provider_key = 'quickbooks_online'
    and evidence.provider_environment = 'sandbox'
    and evidence.authority_role = 'integration_credential_broker_authority'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_evidence_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_read.workspace_id
    and task.business_entity_id = v_read.business_entity_id
    and task.connection_id = v_read.connection_id
    and task.connection_generation = v_read.connection_generation
    and task.sync_run_id = v_read.sync_run_id
    and task.id = v_read.task_id
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.row_version <> v_read.task_row_version
    or v_task.dispatch_generation <> v_read.task_dispatch_generation
    or v_task.dispatcher_task_name <> v_read.dispatcher_task_name
    or v_task.delivery_attribution_state <> 'attributed'
    or v_task.last_delivery_dispatch_generation <>
      v_read.delivery_dispatch_generation
    or v_task.last_delivery_retry_count <> v_read.delivery_retry_count
    or v_task.last_delivery_execution_count <> v_read.delivery_execution_count
    or v_task.last_delivery_attempt_fingerprint <>
      v_read.delivery_attempt_fingerprint
    or v_task.lease_id <> v_read.lease_id
    or v_task.lease_owner_fingerprint <> v_read.lease_owner_fingerprint
    or v_task.lease_expires_at <> v_read.lease_expires_at
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_evidence_denied';
  end if;

  v_expected_endpoint := private.qbo_provider_endpoint_binding_v1(
    v_task.stream_key
  );
  if v_expected_endpoint is null
    or p_command ->> 'endpointDomain' <>
      v_expected_endpoint ->> 'endpointDomain'
    or p_command ->> 'endpointClass' <>
      v_expected_endpoint ->> 'endpointClass' then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_endpoint_denied';
  end if;

  select evidence.* into v_existing
  from private.integration_qbo_provider_task_result_evidence as evidence
  where (
      evidence.credential_read_evidence_id = v_read.id
      and evidence.request_ordinal =
        (p_command ->> 'requestOrdinal')::integer
    ) or evidence.request_id = p_request_id
  order by evidence.id
  limit 1;
  if found then
    if v_existing.credential_read_evidence_id = v_read.id
      and v_existing.request_ordinal =
        (p_command ->> 'requestOrdinal')::integer
      and v_existing.endpoint_domain = p_command ->> 'endpointDomain'
      and v_existing.endpoint_class = p_command ->> 'endpointClass'
      and v_existing.provider_request_fingerprint =
        v_provider_request_fingerprint
      and v_existing.provider_outcome = p_command ->> 'providerOutcome'
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'providerResultEvidenceId', v_existing.id,
        'credentialReadEvidenceId', v_existing.credential_read_evidence_id,
        'requestOrdinal', v_existing.request_ordinal,
        'endpointDomain', v_existing.endpoint_domain,
        'endpointClass', v_existing.endpoint_class,
        'providerOutcome', v_existing.provider_outcome,
        'observedAt', v_existing.observed_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_provider_result_evidence_conflict';
  end if;

  v_evidence_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_provider_result_evidence_v1',
      'credentialReadEvidenceId', v_read.id,
      'requestOrdinal', (p_command ->> 'requestOrdinal')::integer,
      'endpointDomain', p_command ->> 'endpointDomain',
      'endpointClass', p_command ->> 'endpointClass',
      'providerRequestFingerprint',
        pg_catalog.encode(v_provider_request_fingerprint, 'hex'),
      'providerOutcome', p_command ->> 'providerOutcome',
      'observedAt', v_now
    )
  );

  insert into private.integration_qbo_provider_task_result_evidence (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, task_id, task_row_version,
    task_dispatch_generation, dispatcher_task_name,
    delivery_attribution_state, delivery_dispatch_generation,
    delivery_retry_count, delivery_execution_count,
    delivery_attempt_fingerprint, lease_id, lease_owner_fingerprint,
    lease_expires_at, credential_read_evidence_id, credential_id,
    credential_version, provider_key, provider_environment,
    endpoint_domain, endpoint_class, request_ordinal,
    provider_request_fingerprint, provider_outcome, request_id,
    request_fingerprint, evidence_fingerprint, authority_role,
    observed_at, created_at
  ) values (
    'qbo_sandbox_provider_result_evidence_v1',
    v_read.workspace_id, v_read.business_entity_id, v_read.connection_id,
    v_read.connection_generation, v_read.sync_run_id, v_read.task_id,
    v_read.task_row_version, v_read.task_dispatch_generation,
    v_read.dispatcher_task_name, v_read.delivery_attribution_state,
    v_read.delivery_dispatch_generation, v_read.delivery_retry_count,
    v_read.delivery_execution_count, v_read.delivery_attempt_fingerprint,
    v_read.lease_id, v_read.lease_owner_fingerprint, v_read.lease_expires_at,
    v_read.id, v_read.credential_id, v_read.credential_version,
    v_read.provider_key, v_read.provider_environment,
    p_command ->> 'endpointDomain', p_command ->> 'endpointClass',
    (p_command ->> 'requestOrdinal')::integer,
    v_provider_request_fingerprint, p_command ->> 'providerOutcome',
    p_request_id, v_request_fingerprint, v_evidence_fingerprint,
    'integration_provider_runtime_authority', v_now, v_now
  ) returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'providerResultEvidenceId', v_existing.id,
    'credentialReadEvidenceId', v_existing.credential_read_evidence_id,
    'requestOrdinal', v_existing.request_ordinal,
    'endpointDomain', v_existing.endpoint_domain,
    'endpointClass', v_existing.endpoint_class,
    'providerOutcome', v_existing.provider_outcome,
    'observedAt', v_existing.observed_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_provider_result_evidence_invalid';
end;
$function$;

create or replace function private.validate_integration_sync_task_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (
    new.id, new.contract_version, new.workspace_id, new.business_entity_id,
    new.connection_id, new.connection_generation, new.sync_run_id,
    new.parent_task_id, new.provider_key, new.provider_environment,
    new.queue_class, new.task_kind, new.stream_key, new.priority,
    new.control_metadata, new.idempotency_fingerprint,
    new.coalescing_fingerprint, new.maximum_attempts, new.created_at,
    new.retention_expires_at
  ) is distinct from (
    old.id, old.contract_version, old.workspace_id, old.business_entity_id,
    old.connection_id, old.connection_generation, old.sync_run_id,
    old.parent_task_id, old.provider_key, old.provider_environment,
    old.queue_class, old.task_kind, old.stream_key, old.priority,
    old.control_metadata, old.idempotency_fingerprint,
    old.coalescing_fingerprint, old.maximum_attempts, old.created_at,
    old.retention_expires_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_identity_immutable';
  end if;

  if old.delivery_attribution_state = 'legacy_unattributed' then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_attribution_unresolved';
  end if;

  if old.state in ('succeeded', 'failed', 'dead_letter', 'cancelled') then
    if old.state = 'failed'
      and old.durable_effect_fingerprint is null
      and new.state = 'retry_wait'
      and new.failure_category is null
      and new.failure_code is null
      and new.completed_at is null
      and new.row_version = old.row_version + 1
      and new.updated_at >= old.updated_at
      and new.available_at >= new.updated_at
      and (
        new.dispatcher_task_name,
        new.dispatch_generation,
        new.delivery_attribution_state,
        new.last_delivery_dispatch_generation,
        new.last_delivery_retry_count,
        new.last_delivery_execution_count,
        new.last_delivery_attempt_fingerprint,
        new.attempt_count,
        new.lease_id,
        new.lease_owner_fingerprint,
        new.lease_expires_at,
        new.heartbeat_at,
        new.cancel_requested_at,
        new.durable_effect_fingerprint
      ) is not distinct from (
        old.dispatcher_task_name,
        old.dispatch_generation,
        old.delivery_attribution_state,
        old.last_delivery_dispatch_generation,
        old.last_delivery_retry_count,
        old.last_delivery_execution_count,
        old.last_delivery_attempt_fingerprint,
        old.attempt_count,
        old.lease_id,
        old.lease_owner_fingerprint,
        old.lease_expires_at,
        old.heartbeat_at,
        old.cancel_requested_at,
        old.durable_effect_fingerprint
      )
      and (
        (
          old.failure_category = 'contract'
          and old.failure_code = 'phase8b_provider_task_failed'
          and exists (
            select 1
            from private.integration_sync_task_recovery_events as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
        or (
          old.failure_category = 'authorization'
          and old.failure_code = 'credential_reauthorization_required'
          and old.stream_key = 'qbo_purchase'
          and exists (
            select 1
            from private.integration_sync_task_reauthorization_recovery_events
              as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
        or (
          old.failure_category = 'contract'
          and old.failure_code = 'phase8b_provider_task_failed'
          and exists (
            select 1
            from
              private.integration_sync_task_credential_binding_recovery_events
                as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.prior_dispatch_generation = old.dispatch_generation
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
        or (
          old.failure_category = 'contract'
          and old.failure_code = 'phase8b_provider_task_failed'
          and exists (
            select 1
            from
              private.integration_sync_task_credential_lineage_recovery_events
                as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.prior_dispatch_generation = old.dispatch_generation
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
        or (
          old.id = '1eb257e9-5275-51a7-992c-d08186c58c98'::uuid
          and old.stream_key = 'qbo_aragingsummary'
          and old.failure_category = 'contract'
          and old.failure_code = '5020'
          and exists (
            select 1
            from private.integration_sync_task_ar_aging_recovery_events
              as recovery
            where recovery.workspace_id = old.workspace_id
              and recovery.business_entity_id = old.business_entity_id
              and recovery.connection_id = old.connection_id
              and recovery.connection_generation = old.connection_generation
              and recovery.sync_run_id = old.sync_run_id
              and recovery.task_id = old.id
              and recovery.prior_state = old.state
              and recovery.prior_failure_category = old.failure_category
              and recovery.prior_failure_code = old.failure_code
              and recovery.prior_row_version = old.row_version
              and recovery.prior_completed_at = old.completed_at
              and recovery.prior_dispatch_generation = old.dispatch_generation
              and recovery.request_id = new.last_request_id
              and recovery.request_fingerprint = new.last_request_fingerprint
              and recovery.recovered_at = new.updated_at
              and recovery.recovered_at + pg_catalog.make_interval(
                secs => recovery.retry_after_seconds
              ) = new.available_at
          )
        )
      ) then
      return new;
    end if;
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_terminal_immutable';
  end if;

  if not private.is_phase_6_task_transition_v1(old.state, new.state)
    or new.row_version <> old.row_version + 1
    or new.attempt_count < old.attempt_count
    or new.dispatch_generation < old.dispatch_generation
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_mutation_invalid';
  end if;

  if (
    new.delivery_attribution_state,
    new.last_delivery_dispatch_generation,
    new.last_delivery_retry_count,
    new.last_delivery_execution_count,
    new.last_delivery_attempt_fingerprint
  ) is distinct from (
    old.delivery_attribution_state,
    old.last_delivery_dispatch_generation,
    old.last_delivery_retry_count,
    old.last_delivery_execution_count,
    old.last_delivery_attempt_fingerprint
  ) and (
    new.delivery_attribution_state <> 'attributed'
    or new.last_delivery_dispatch_generation is null
    or new.last_delivery_dispatch_generation <> new.dispatch_generation
    or new.last_delivery_retry_count is null
    or new.last_delivery_execution_count is null
    or new.last_delivery_execution_count > new.last_delivery_retry_count
    or new.last_delivery_attempt_fingerprint is null
    or (
      old.delivery_attribution_state = 'attributed'
      and old.last_delivery_dispatch_generation =
        new.last_delivery_dispatch_generation
      and (
        new.last_delivery_attempt_fingerprint =
          old.last_delivery_attempt_fingerprint
        or (
          old.last_delivery_retry_count is not null
          and (
            new.last_delivery_retry_count <= old.last_delivery_retry_count
            or new.last_delivery_execution_count <
              old.last_delivery_execution_count
          )
        )
        or (
          old.last_delivery_retry_count is null
          and not exists (
            select 1
            from
              private.integration_sync_task_delivery_retry_compatibility_events
                as compatibility
            where compatibility.workspace_id = old.workspace_id
              and compatibility.business_entity_id = old.business_entity_id
              and compatibility.connection_id = old.connection_id
              and compatibility.connection_generation = old.connection_generation
              and compatibility.task_id = old.id
              and compatibility.dispatch_generation =
                new.last_delivery_dispatch_generation
              and compatibility.observed_delivery_retry_count <
                new.last_delivery_retry_count
              and compatibility.observed_delivery_execution_count <=
                new.last_delivery_execution_count
          )
        )
      )
    )
    or (
      (
        old.delivery_attribution_state = 'none'
        or old.last_delivery_dispatch_generation <
          new.last_delivery_dispatch_generation
      )
      and (
        new.last_delivery_retry_count <> 0
        or new.last_delivery_execution_count <> 0
      )
      and not exists (
        select 1
        from private.integration_sync_task_delivery_retry_compatibility_events
          as compatibility
        where compatibility.workspace_id = old.workspace_id
          and compatibility.business_entity_id = old.business_entity_id
          and compatibility.connection_id = old.connection_id
          and compatibility.connection_generation = old.connection_generation
          and compatibility.task_id = old.id
          and compatibility.dispatch_generation =
            new.last_delivery_dispatch_generation
          and compatibility.observed_delivery_retry_count <
            new.last_delivery_retry_count
          and compatibility.observed_delivery_execution_count <=
            new.last_delivery_execution_count
      )
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_evidence_invalid';
  end if;
  return new;
end;
$function$;

create or replace function private.validate_qbo_task_result_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_count bigint;
  v_provider_success_count bigint;
  v_parser_success_count bigint;
  v_parser_failure_count bigint;
begin
  if old.provider_key <> 'quickbooks_online'
    or old.provider_environment <> 'sandbox'
    or old.state <> 'leased' then
    return new;
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where evidence.provider_outcome = 'provider_success'
    )
  into v_provider_count, v_provider_success_count
  from private.integration_qbo_provider_task_result_evidence as evidence
  where evidence.workspace_id = old.workspace_id
    and evidence.business_entity_id = old.business_entity_id
    and evidence.connection_id = old.connection_id
    and evidence.connection_generation = old.connection_generation
    and evidence.sync_run_id = old.sync_run_id
    and evidence.task_id = old.id
    and evidence.task_row_version = old.row_version
    and evidence.task_dispatch_generation = old.dispatch_generation
    and evidence.dispatcher_task_name = old.dispatcher_task_name
    and evidence.delivery_dispatch_generation =
      old.last_delivery_dispatch_generation
    and evidence.delivery_retry_count = old.last_delivery_retry_count
    and evidence.delivery_execution_count = old.last_delivery_execution_count
    and evidence.delivery_attempt_fingerprint =
      old.last_delivery_attempt_fingerprint
    and evidence.lease_id = old.lease_id
    and evidence.lease_owner_fingerprint = old.lease_owner_fingerprint;

  if new.state = 'succeeded' then
    if v_provider_count < 1
      or v_provider_success_count <> v_provider_count then
      raise exception using
        errcode = '55000',
        message = 'qbo_task_provider_result_evidence_required';
    end if;
    if private.qbo_provider_endpoint_binding_v1(old.stream_key)
        ->> 'endpointDomain' = 'report' then
      select
        pg_catalog.count(*) filter (
          where parser.parser_outcome = 'parser_success'
        ),
        pg_catalog.count(*) filter (
          where parser.parser_outcome <> 'parser_success'
        )
      into v_parser_success_count, v_parser_failure_count
      from private.integration_qbo_report_parser_result_evidence as parser
      inner join private.integration_qbo_provider_task_result_evidence as provider
        on provider.id = parser.provider_result_evidence_id
      where provider.task_id = old.id
        and provider.task_row_version = old.row_version
        and provider.lease_id = old.lease_id
        and provider.delivery_attempt_fingerprint =
          old.last_delivery_attempt_fingerprint;
      if v_provider_count <> 1
        or v_parser_success_count <> 1
        or v_parser_failure_count <> 0 then
        raise exception using
          errcode = '55000',
          message = 'qbo_task_report_parser_evidence_required';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

create trigger validate_qbo_task_result_evidence_v1
before update on private.integration_sync_tasks
for each row execute function private.validate_qbo_task_result_evidence_v1();


create table private.integration_sync_task_ar_aging_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_ar_aging_identifier_recovery_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  mapping_id uuid not null,
  task_id uuid not null unique check (
    task_id = '1eb257e9-5275-51a7-992c-d08186c58c98'::uuid
  ),
  historical_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  historical_credential_version bigint not null check (
    historical_credential_version > 0
  ),
  current_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  current_credential_version bigint not null check (
    current_credential_version >= historical_credential_version
  ),
  current_credential_row_version bigint not null check (
    current_credential_row_version > 0
  ),
  failure_audit_event_id uuid not null unique references
    private.integration_audit_events(id) on delete restrict,
  credential_read_evidence_id uuid not null unique references
    private.integration_provider_credential_task_read_evidence(id)
    on delete restrict,
  prior_state text not null check (prior_state = 'failed'),
  prior_failure_category text not null check (
    prior_failure_category = 'contract'
  ),
  prior_failure_code text not null check (prior_failure_code = '5020'),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_completed_at timestamptz not null,
  prior_dispatch_generation bigint not null check (
    prior_dispatch_generation > 0
  ),
  prior_delivery_dispatch_generation bigint not null,
  prior_delivery_retry_count integer not null,
  prior_delivery_execution_count integer not null,
  prior_delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(prior_delivery_attempt_fingerprint) = 32
  ),
  prior_attempt_count integer not null check (prior_attempt_count > 0),
  retry_after_seconds integer not null check (
    retry_after_seconds between 1 and 3600
  ),
  reason_code text not null check (
    reason_code = 'qbo_ar_aging_provider_identifier_5020_corrected'
  ),
  request_id text not null unique check (
    private.is_bounded_identifier_v1(request_id)
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_ar_aging_recovery_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_ar_aging_recovery_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_ar_aging_recovery_time_check check (
    recovered_at = created_at and recovered_at >= prior_completed_at
  )
);

create index integration_sync_task_ar_aging_recovery_scope_idx
  on private.integration_sync_task_ar_aging_recovery_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, recovered_at
  );
alter table private.integration_sync_task_ar_aging_recovery_events
  enable row level security;
alter table private.integration_sync_task_ar_aging_recovery_events
  force row level security;
create trigger reject_integration_sync_task_ar_aging_recovery_mutation_v1
before update or delete
on private.integration_sync_task_ar_aging_recovery_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();
revoke all on table private.integration_sync_task_ar_aging_recovery_events
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_qbo_canary_dispatch_authority,
  integration_qbo_precontract_retirement_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

create or replace function public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_current_credential private.integration_credentials;
  v_read private.integration_provider_credential_task_read_evidence;
  v_failure_audit private.integration_audit_events;
  v_existing private.integration_sync_task_ar_aging_recovery_events;
  v_request_fingerprint bytea;
  v_checkpoint_id uuid;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'syncRunId', 'mappingId',
        'expectedMappingRowVersion', 'historicalCredentialId',
        'expectedHistoricalCredentialVersion', 'currentCredentialId',
        'expectedCurrentCredentialVersion',
        'expectedCurrentCredentialRowVersion', 'taskId',
        'expectedTaskRowVersion', 'expectedDispatchGeneration',
        'failureAuditEventId', 'credentialReadEvidenceId',
        'retryAfterSeconds'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_ar_aging_identifier_recovery_v1'
    or p_command ->> 'taskId' <>
      '1eb257e9-5275-51a7-992c-d08186c58c98'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedMappingRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedHistoricalCredentialVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCurrentCredentialVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCurrentCredentialRowVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedTaskRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedDispatchGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds')::integer not between 1 and 3600
    then
    raise exception using
      errcode = '22023',
      message = 'qbo_ar_aging_identifier_recovery_invalid';
  end if;

  perform (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'syncRunId')::uuid;
  perform (p_command ->> 'mappingId')::uuid;
  perform (p_command ->> 'historicalCredentialId')::uuid;
  perform (p_command ->> 'currentCredentialId')::uuid;
  perform (p_command ->> 'failureAuditEventId')::uuid;
  perform (p_command ->> 'credentialReadEvidenceId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_ar_aging_identifier_recovery:' || (p_command ->> 'taskId'),
      0
    )
  );

  select event.* into v_existing
  from private.integration_sync_task_ar_aging_recovery_events as event
  where event.task_id = (p_command ->> 'taskId')::uuid
    or event.request_id = p_request_id
  order by event.id
  limit 1;
  if found then
    if v_existing.workspace_id = (p_command ->> 'workspaceId')::uuid
      and v_existing.business_entity_id =
        (p_command ->> 'businessEntityId')::uuid
      and v_existing.connection_id = (p_command ->> 'connectionId')::uuid
      and v_existing.connection_generation =
        (p_command ->> 'connectionGeneration')::bigint
      and v_existing.sync_run_id = (p_command ->> 'syncRunId')::uuid
      and v_existing.mapping_id = (p_command ->> 'mappingId')::uuid
      and v_existing.task_id = (p_command ->> 'taskId')::uuid
      and v_existing.historical_credential_id =
        (p_command ->> 'historicalCredentialId')::uuid
      and v_existing.historical_credential_version =
        (p_command ->> 'expectedHistoricalCredentialVersion')::bigint
      and v_existing.current_credential_id =
        (p_command ->> 'currentCredentialId')::uuid
      and v_existing.current_credential_version =
        (p_command ->> 'expectedCurrentCredentialVersion')::bigint
      and v_existing.current_credential_row_version =
        (p_command ->> 'expectedCurrentCredentialRowVersion')::bigint
      and v_existing.prior_row_version =
        (p_command ->> 'expectedTaskRowVersion')::bigint
      and v_existing.prior_dispatch_generation =
        (p_command ->> 'expectedDispatchGeneration')::bigint
      and v_existing.failure_audit_event_id =
        (p_command ->> 'failureAuditEventId')::uuid
      and v_existing.credential_read_evidence_id =
        (p_command ->> 'credentialReadEvidenceId')::uuid
      and v_existing.retry_after_seconds =
        (p_command ->> 'retryAfterSeconds')::integer
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint
      and v_existing.actor_id = p_actor_id then
      return pg_catalog.jsonb_build_object(
        'recoveryEventId', v_existing.id,
        'taskId', v_existing.task_id,
        'recoveredAt', v_existing.recovered_at,
        'state', 'retry_wait',
        'rowVersion', v_existing.prior_row_version + 1,
        'dispatchGeneration', v_existing.prior_dispatch_generation,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_ar_aging_identifier_recovery_conflict';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_recovery_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
    and connection.disconnected_at is null
    and connection.deleted_at is null
  for update;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_recovery_denied';
  end if;

  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = v_connection.provider_key
    and mapping.provider_environment = v_connection.provider_environment
    and mapping.status = 'active'
    and mapping.row_version =
      (p_command ->> 'expectedMappingRowVersion')::bigint
  for share;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_recovery_denied';
  end if;

  select credential.* into v_current_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.id = (p_command ->> 'currentCredentialId')::uuid
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
  for share;
  if not found
    or v_current_credential.status <> 'active'
    or v_current_credential.credential_version <>
      (p_command ->> 'expectedCurrentCredentialVersion')::bigint
    or v_current_credential.row_version <>
      (p_command ->> 'expectedCurrentCredentialRowVersion')::bigint
    or v_current_credential.credential_ciphertext is null
    or v_current_credential.granted_scopes <>
      array['com.intuit.quickbooks.accounting']::text[]
    or v_current_credential.external_entity_reference_fingerprint <>
      v_mapping.provider_entity_reference_fingerprint
    or v_current_credential.refresh_lease_id is not null
    or v_current_credential.refresh_lease_owner_fingerprint is not null
    or v_current_credential.refresh_lease_acquired_at is not null
    or v_current_credential.refresh_lease_expires_at is not null
    or v_current_credential.id <>
      (p_command ->> 'historicalCredentialId')::uuid
    or v_current_credential.credential_version <
      (p_command ->> 'expectedHistoricalCredentialVersion')::bigint then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_lineage_denied';
  end if;

  if exists (
    select 1
    from pg_catalog.generate_series(
      (p_command ->> 'expectedHistoricalCredentialVersion')::bigint + 1,
      v_current_credential.credential_version
    ) as expected(version)
    where (
      select pg_catalog.count(*)
      from private.integration_audit_events as audit
      where audit.workspace_id = v_current_credential.workspace_id
        and audit.business_entity_id = v_current_credential.business_entity_id
        and audit.connection_id = v_current_credential.connection_id
        and audit.action = 'credential_rotated'
        and audit.outcome = 'succeeded'
        and audit.target_type = 'integration_credential'
        and audit.target_id = v_current_credential.id::text
        and audit.reason_code = 'refresh_succeeded'
        and audit.metadata ->> 'connection_generation' =
          v_current_credential.connection_generation::text
        and audit.metadata ->> 'credential_status' = 'active'
        and audit.metadata ->> 'credential_version' = expected.version::text
        and audit.occurred_at between v_current_credential.created_at
          and v_current_credential.updated_at
    ) <> 1
  ) or exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_current_credential.workspace_id
      and audit.business_entity_id = v_current_credential.business_entity_id
      and audit.connection_id = v_current_credential.connection_id
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_current_credential.id::text
      and audit.reason_code in ('invalid_grant', 'provider_revoked')
      and audit.occurred_at >= v_current_credential.created_at
  ) then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_lineage_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.connection_generation = v_connection.connection_generation
    and run.id = (p_command ->> 'syncRunId')::uuid
    and run.mapping_id = v_mapping.id
    and run.state = 'running'
    and run.mode = 'initialization'
  for share;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_recovery_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.sync_run_id = v_run.id
    and task.id = '1eb257e9-5275-51a7-992c-d08186c58c98'::uuid
    and task.stream_key = 'qbo_aragingsummary'
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
  for update;
  if not found
    or v_task.state <> 'failed'
    or v_task.row_version <>
      (p_command ->> 'expectedTaskRowVersion')::bigint
    or v_task.dispatch_generation <>
      (p_command ->> 'expectedDispatchGeneration')::bigint
    or v_task.delivery_attribution_state <> 'attributed'
    or v_task.last_delivery_dispatch_generation <> v_task.dispatch_generation
    or v_task.last_delivery_retry_count is null
    or v_task.last_delivery_execution_count is null
    or v_task.last_delivery_attempt_fingerprint is null
    or v_task.failure_category <> 'contract'
    or v_task.failure_code <> '5020'
    or v_task.completed_at is null
    or v_task.durable_effect_fingerprint is not null
    or v_task.lease_id is not null
    or v_task.lease_owner_fingerprint is not null
    or v_task.lease_expires_at is not null
    or v_task.heartbeat_at is not null
    or v_task.dispatcher_task_name is not null then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_recovery_denied';
  end if;

  select evidence.* into v_read
  from private.integration_provider_credential_task_read_evidence as evidence
  where evidence.id = (p_command ->> 'credentialReadEvidenceId')::uuid
    and evidence.workspace_id = v_task.workspace_id
    and evidence.business_entity_id = v_task.business_entity_id
    and evidence.connection_id = v_task.connection_id
    and evidence.connection_generation = v_task.connection_generation
    and evidence.sync_run_id = v_task.sync_run_id
    and evidence.mapping_id = v_mapping.id
    and evidence.task_id = v_task.id
    and evidence.task_row_version = v_task.row_version - 1
    and evidence.task_dispatch_generation = v_task.dispatch_generation
    and evidence.delivery_dispatch_generation =
      v_task.last_delivery_dispatch_generation
    and evidence.delivery_retry_count = v_task.last_delivery_retry_count
    and evidence.delivery_execution_count = v_task.last_delivery_execution_count
    and evidence.delivery_attempt_fingerprint =
      v_task.last_delivery_attempt_fingerprint
    and evidence.credential_id = v_current_credential.id
    and evidence.credential_version =
      (p_command ->> 'expectedHistoricalCredentialVersion')::bigint
    and evidence.provider_key = v_task.provider_key
    and evidence.provider_environment = v_task.provider_environment
    and evidence.authorized_at <= v_task.completed_at
  for share;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_read_denied';
  end if;
  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_current_credential.workspace_id
      and audit.business_entity_id = v_current_credential.business_entity_id
      and audit.connection_id = v_current_credential.connection_id
      and audit.action = 'credential_rotated'
      and audit.outcome = 'succeeded'
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_current_credential.id::text
      and audit.reason_code = 'refresh_succeeded'
      and (audit.metadata ->> 'credential_version')::bigint >
        v_read.credential_version
      and audit.occurred_at <= v_read.authorized_at
  ) then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_lineage_denied';
  end if;

  select audit.* into v_failure_audit
  from private.integration_audit_events as audit
  where audit.id = (p_command ->> 'failureAuditEventId')::uuid
    and audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'integration_sync_task.fail'
    and audit.outcome = 'failed'
    and audit.target_type = 'integration_sync_task'
    and audit.target_id = v_task.id::text
    and audit.metadata ->> 'task_state' = 'failed'
    and audit.metadata ->> 'dispatch_generation' =
      v_task.dispatch_generation::text
    and audit.metadata ->> 'attempt_count' = v_task.attempt_count::text
    and audit.metadata ->> 'row_version' = v_task.row_version::text
    and audit.occurred_at = v_task.completed_at;
  if not found then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_failure_denied';
  end if;

  v_checkpoint_id := case
    when v_task.control_metadata -> 'checkpointId' = 'null'::jsonb then null
    else (v_task.control_metadata ->> 'checkpointId')::uuid
  end;
  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_task.workspace_id
      and audit.business_entity_id = v_task.business_entity_id
      and audit.connection_id = v_task.connection_id
      and audit.action = 'integration_sync_task.complete'
      and audit.outcome = 'succeeded'
      and audit.target_type = 'integration_sync_task'
      and audit.target_id = v_task.id::text
  ) or exists (
    select 1
    from private.external_source_records as source_record
    where source_record.workspace_id = v_task.workspace_id
      and source_record.business_entity_id = v_task.business_entity_id
      and source_record.connection_id = v_task.connection_id
      and source_record.mapping_id = v_mapping.id
      and source_record.provider_key = 'quickbooks_online'
      and source_record.provider_record_type = 'ARAgingSummary'
  ) or exists (
    select 1
    from private.external_source_record_versions as version
    where version.workspace_id = v_task.workspace_id
      and version.business_entity_id = v_task.business_entity_id
      and version.connection_id = v_task.connection_id
      and version.sync_run_id = v_task.sync_run_id
      and version.provider_record_type = 'ARAgingSummary'
  ) or (
    v_checkpoint_id is not null and exists (
      select 1
      from private.integration_sync_checkpoints as checkpoint
      where checkpoint.workspace_id = v_task.workspace_id
        and checkpoint.business_entity_id = v_task.business_entity_id
        and checkpoint.connection_id = v_task.connection_id
        and checkpoint.id = v_checkpoint_id
        and checkpoint.last_task_id = v_task.id
    )
  ) then
    raise exception using
      errcode = '42501', message = 'qbo_ar_aging_identifier_effect_denied';
  end if;

  insert into private.integration_sync_task_ar_aging_recovery_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, mapping_id, task_id,
    historical_credential_id, historical_credential_version,
    current_credential_id, current_credential_version,
    current_credential_row_version, failure_audit_event_id,
    credential_read_evidence_id, prior_state, prior_failure_category,
    prior_failure_code, prior_row_version, prior_completed_at,
    prior_dispatch_generation, prior_delivery_dispatch_generation,
    prior_delivery_retry_count, prior_delivery_execution_count,
    prior_delivery_attempt_fingerprint, prior_attempt_count,
    retry_after_seconds, reason_code, request_id, request_fingerprint,
    actor_id, recovered_at, created_at
  ) values (
    'qbo_sandbox_ar_aging_identifier_recovery_v1',
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    v_task.connection_generation, v_task.sync_run_id, v_mapping.id, v_task.id,
    v_read.credential_id, v_read.credential_version,
    v_current_credential.id, v_current_credential.credential_version,
    v_current_credential.row_version, v_failure_audit.id, v_read.id,
    v_task.state, v_task.failure_category, v_task.failure_code,
    v_task.row_version, v_task.completed_at, v_task.dispatch_generation,
    v_task.last_delivery_dispatch_generation,
    v_task.last_delivery_retry_count, v_task.last_delivery_execution_count,
    v_task.last_delivery_attempt_fingerprint, v_task.attempt_count,
    (p_command ->> 'retryAfterSeconds')::integer,
    'qbo_ar_aging_provider_identifier_5020_corrected',
    p_request_id, v_request_fingerprint, p_actor_id, v_now, v_now
  ) returning * into v_existing;

  update private.integration_sync_tasks as task
  set
    state = 'retry_wait',
    available_at = v_now + pg_catalog.make_interval(
      secs => (p_command ->> 'retryAfterSeconds')::integer
    ),
    failure_category = null,
    failure_code = null,
    completed_at = null,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id and task.row_version = v_task.row_version
  returning task.* into v_task;
  if not found then
    raise exception using
      errcode = '40001', message = 'qbo_ar_aging_identifier_recovery_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.ar_aging_identifier_recover',
    'succeeded', 'integration_sync_task', v_task.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'prior_failure_category', 'contract',
      'prior_failure_code', '5020',
      'idempotent', false
    )
  );

  return pg_catalog.jsonb_build_object(
    'recoveryEventId', v_existing.id,
    'taskId', v_task.id,
    'recoveredAt', v_now,
    'state', v_task.state,
    'rowVersion', v_task.row_version,
    'dispatchGeneration', v_task.dispatch_generation,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023', message = 'qbo_ar_aging_identifier_recovery_invalid';
end;
$function$;


create or replace function public.record_qbo_sandbox_report_parser_result_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_provider private.integration_qbo_provider_task_result_evidence;
  v_task private.integration_sync_tasks;
  v_existing private.integration_qbo_report_parser_result_evidence;
  v_request_fingerprint bytea;
  v_evidence_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['contractVersion', 'providerResultEvidenceId', 'parserOutcome']
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_report_parser_result_evidence_v1'
    or p_command ->> 'parserOutcome' not in (
      'parser_success', 'report_header_shape', 'report_columns_shape',
      'report_rows_shape', 'report_cell_shape', 'report_summary_shape',
      'report_metadata_shape', 'minimization_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_report_parser_result_evidence_invalid';
  end if;

  perform (p_command ->> 'providerResultEvidenceId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select evidence.* into v_provider
  from private.integration_qbo_provider_task_result_evidence as evidence
  where evidence.id = (p_command ->> 'providerResultEvidenceId')::uuid
    and evidence.endpoint_domain = 'report'
    and evidence.endpoint_class like 'qbo_report_%'
    and evidence.provider_outcome = 'provider_success'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_report_parser_result_evidence_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_provider.workspace_id
    and task.business_entity_id = v_provider.business_entity_id
    and task.connection_id = v_provider.connection_id
    and task.connection_generation = v_provider.connection_generation
    and task.sync_run_id = v_provider.sync_run_id
    and task.id = v_provider.task_id
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.row_version <> v_provider.task_row_version
    or v_task.dispatch_generation <> v_provider.task_dispatch_generation
    or v_task.dispatcher_task_name <> v_provider.dispatcher_task_name
    or v_task.last_delivery_dispatch_generation <>
      v_provider.delivery_dispatch_generation
    or v_task.last_delivery_retry_count <> v_provider.delivery_retry_count
    or v_task.last_delivery_execution_count <>
      v_provider.delivery_execution_count
    or v_task.last_delivery_attempt_fingerprint <>
      v_provider.delivery_attempt_fingerprint
    or v_task.lease_id <> v_provider.lease_id
    or v_task.lease_owner_fingerprint <> v_provider.lease_owner_fingerprint
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '42501',
      message = 'qbo_report_parser_result_evidence_denied';
  end if;

  select evidence.* into v_existing
  from private.integration_qbo_report_parser_result_evidence as evidence
  where evidence.provider_result_evidence_id = v_provider.id
    or evidence.request_id = p_request_id
  order by evidence.id
  limit 1;
  if found then
    if v_existing.provider_result_evidence_id = v_provider.id
      and v_existing.parser_outcome = p_command ->> 'parserOutcome'
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'parserResultEvidenceId', v_existing.id,
        'providerResultEvidenceId', v_existing.provider_result_evidence_id,
        'parserOutcome', v_existing.parser_outcome,
        'observedAt', v_existing.observed_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_report_parser_result_evidence_conflict';
  end if;

  v_evidence_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_report_parser_result_evidence_v1',
      'providerResultEvidenceId', v_provider.id,
      'parserOutcome', p_command ->> 'parserOutcome',
      'observedAt', v_now
    )
  );
  insert into private.integration_qbo_report_parser_result_evidence (
    contract_version, provider_result_evidence_id,
    credential_read_evidence_id, workspace_id, business_entity_id,
    connection_id, connection_generation, sync_run_id, task_id,
    task_row_version, task_dispatch_generation, dispatcher_task_name,
    delivery_dispatch_generation, delivery_retry_count,
    delivery_execution_count, delivery_attempt_fingerprint, lease_id,
    lease_owner_fingerprint, credential_id, credential_version,
    provider_key, provider_environment, endpoint_class,
    provider_request_fingerprint, parser_outcome, request_id,
    request_fingerprint, evidence_fingerprint, authority_role,
    observed_at, created_at
  ) values (
    'qbo_sandbox_report_parser_result_evidence_v1', v_provider.id,
    v_provider.credential_read_evidence_id, v_provider.workspace_id,
    v_provider.business_entity_id, v_provider.connection_id,
    v_provider.connection_generation, v_provider.sync_run_id,
    v_provider.task_id, v_provider.task_row_version,
    v_provider.task_dispatch_generation, v_provider.dispatcher_task_name,
    v_provider.delivery_dispatch_generation, v_provider.delivery_retry_count,
    v_provider.delivery_execution_count,
    v_provider.delivery_attempt_fingerprint, v_provider.lease_id,
    v_provider.lease_owner_fingerprint, v_provider.credential_id,
    v_provider.credential_version, v_provider.provider_key,
    v_provider.provider_environment, v_provider.endpoint_class,
    v_provider.provider_request_fingerprint, p_command ->> 'parserOutcome',
    p_request_id, v_request_fingerprint, v_evidence_fingerprint,
    'integration_provider_runtime_authority', v_now, v_now
  ) returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'parserResultEvidenceId', v_existing.id,
    'providerResultEvidenceId', v_existing.provider_result_evidence_id,
    'parserOutcome', v_existing.parser_outcome,
    'observedAt', v_existing.observed_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_report_parser_result_evidence_invalid';
end;
$function$;

revoke all on function
  public.record_qbo_sandbox_provider_result_v1(jsonb, text),
  public.record_qbo_sandbox_report_parser_result_v1(jsonb, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_qbo_canary_dispatch_authority,
  integration_qbo_precontract_retirement_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

grant execute on function
  public.record_qbo_sandbox_provider_result_v1(jsonb, text),
  public.record_qbo_sandbox_report_parser_result_v1(jsonb, text)
to integration_provider_runtime_authority;

revoke all on function
  public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
    jsonb, text, text
  )
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_qbo_canary_dispatch_authority,
  integration_qbo_precontract_retirement_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

grant execute on function
  public.recover_qbo_sandbox_ar_aging_identifier_failure_v1(
    jsonb, text, text
  )
to integration_credential_broker_authority;

commit;
