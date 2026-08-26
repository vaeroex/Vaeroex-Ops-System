-- Phase 8B pre-V5 dispatched-task retirement and incomplete-run closure.
--
-- Three explicitly reviewed Cloud Task envelopes predate task-bound credential
-- read evidence. This forward-only contract retires only those exact tasks,
-- records database authority before external deletion, requires explicit
-- deletion reconciliation, closes the old run as failed historical evidence,
-- and plans (but does not create) a clean replacement initialization wave.

begin;

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'integration_qbo_precontract_retirement_authority'
  ) then
    create role integration_qbo_precontract_retirement_authority
      nologin noinherit;
  end if;
end;
$role$;

alter role integration_qbo_precontract_retirement_authority
  nologin noinherit;

revoke integration_qbo_precontract_retirement_authority
  from anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

revoke all on schema private
  from integration_qbo_precontract_retirement_authority;

create or replace function
  private.assert_qbo_precontract_retirement_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_qbo_precontract_retirement_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_retirement_authority_required';
  end if;
end;
$function$;

create or replace function private.qbo_precontract_retirement_target_v1(
  p_task_id uuid
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $function$
  select case p_task_id
    when 'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea'::uuid then
      pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
        'streamKey', 'qbo_balancesheet',
        'providerRecordType', 'BalanceSheet',
        'expectedRowVersion', 7,
        'expectedDispatchGeneration', 2,
        'dispatcherTaskName',
          '012c5826e086198fec11a9f8a717a6a3d0bee86e50f57a2fa37346379814464e'
      )
    when '49dd3c22-a3d4-4f85-83c0-ed91fdb16131'::uuid then
      pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
        'streamKey', 'qbo_creditmemo',
        'providerRecordType', 'CreditMemo',
        'expectedRowVersion', 7,
        'expectedDispatchGeneration', 2,
        'dispatcherTaskName',
          'bba96a27c7203629e812bd4cbbcaf715b85957a693e919ddf55ce8c570ee283e'
      )
    when '872142c0-ddae-41eb-9e60-1babc6629d68'::uuid then
      pg_catalog.jsonb_build_object(
        'taskId', p_task_id,
        'syncRunId', 'a291839a-99c7-495e-8a53-57aa8aa6c99e',
        'streamKey', 'qbo_purchase',
        'providerRecordType', 'Purchase',
        'expectedRowVersion', 12,
        'expectedDispatchGeneration', 3,
        'dispatcherTaskName',
          '59f93aaccfa64c46596354a448f1df348b7823a5b4cd47111ca1453d9096401d'
      )
    else null
  end;
$function$;

create table private.integration_qbo_precontract_queue_pause_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_precontract_queue_pause_evidence_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  sync_run_id uuid not null,
  queue_resource text not null check (
    queue_resource =
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo'
  ),
  queue_state text not null check (queue_state = 'PAUSED'),
  observed_envelope_count integer not null check (observed_envelope_count = 3),
  queue_snapshot_fingerprint bytea not null check (
    pg_catalog.octet_length(queue_snapshot_fingerprint) = 32
  ),
  request_id text not null unique check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (
    pg_catalog.char_length(actor_id) between 1 and 200
  ),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_qbo_precontract_pause_scope_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_qbo_precontract_pause_time_check check (
    created_at = observed_at
      and expires_at = observed_at + interval '5 minutes'
  )
);

create index integration_qbo_precontract_pause_scope_idx
  on private.integration_qbo_precontract_queue_pause_evidence(
    workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, expires_at
  );

alter table private.integration_qbo_precontract_queue_pause_evidence
  enable row level security;
alter table private.integration_qbo_precontract_queue_pause_evidence
  force row level security;

create trigger reject_integration_qbo_precontract_pause_mutation_v1
before update or delete
on private.integration_qbo_precontract_queue_pause_evidence
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table private.integration_sync_task_precontract_retirement_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_precontract_dispatched_task_retirement_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  sync_run_id uuid not null,
  task_id uuid not null unique,
  stream_key text not null,
  prior_state text not null check (prior_state = 'dispatched'),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_dispatch_generation bigint not null check (
    prior_dispatch_generation > 0
  ),
  prior_dispatcher_task_name text not null check (
    prior_dispatcher_task_name ~ '^[a-f0-9]{64}$'
  ),
  prior_delivery_attribution_state text not null,
  prior_delivery_dispatch_generation bigint,
  prior_delivery_retry_count integer,
  prior_delivery_execution_count integer,
  prior_delivery_attempt_fingerprint bytea,
  prior_attempt_count integer not null check (prior_attempt_count >= 0),
  queue_pause_evidence_id uuid not null references
    private.integration_qbo_precontract_queue_pause_evidence(id)
    on delete restrict,
  reason_code text not null check (
    reason_code = 'pre_v5_task_bound_credential_evidence_contract'
  ),
  prior_task_snapshot_fingerprint bytea not null check (
    pg_catalog.octet_length(prior_task_snapshot_fingerprint) = 32
  ),
  request_id text not null unique check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (
    pg_catalog.char_length(actor_id) between 1 and 200
  ),
  retired_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_precontract_retirement_task_fkey
    foreign key (workspace_id, business_entity_id, connection_id, task_id)
    references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_precontract_retirement_run_fkey
    foreign key (workspace_id, business_entity_id, connection_id, sync_run_id)
    references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_precontract_retirement_time_check
    check (retired_at = created_at)
);

create index integration_sync_task_precontract_retirement_scope_idx
  on private.integration_sync_task_precontract_retirement_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, retired_at
  );

alter table private.integration_sync_task_precontract_retirement_events
  enable row level security;
alter table private.integration_sync_task_precontract_retirement_events
  force row level security;

create trigger reject_integration_sync_task_precontract_retirement_mutation_v1
before update or delete
on private.integration_sync_task_precontract_retirement_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table
  private.integration_sync_task_envelope_retirement_reconciliations (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_precontract_envelope_retirement_reconciliation_v1'
  ),
  retirement_event_id uuid not null unique references
    private.integration_sync_task_precontract_retirement_events(id)
    on delete restrict,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  sync_run_id uuid not null,
  task_id uuid not null unique,
  queue_resource text not null check (
    queue_resource =
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo'
  ),
  dispatcher_task_name text not null check (
    dispatcher_task_name ~ '^[a-f0-9]{64}$'
  ),
  deletion_outcome text not null check (
    deletion_outcome in ('deleted', 'already_absent')
  ),
  provider_operation_fingerprint bytea not null check (
    pg_catalog.octet_length(provider_operation_fingerprint) = 32
  ),
  request_id text not null unique check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (
    pg_catalog.char_length(actor_id) between 1 and 200
  ),
  reconciled_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_envelope_retirement_task_fkey
    foreign key (workspace_id, business_entity_id, connection_id, task_id)
    references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_envelope_retirement_time_check
    check (reconciled_at = created_at)
);

alter table private.integration_sync_task_envelope_retirement_reconciliations
  enable row level security;
alter table private.integration_sync_task_envelope_retirement_reconciliations
  force row level security;

create trigger reject_integration_sync_task_envelope_retirement_mutation_v1
before update or delete
on private.integration_sync_task_envelope_retirement_reconciliations
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table
  private.integration_sync_run_company_info_carry_forward_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_company_info_carry_forward_evidence_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  old_sync_run_id uuid not null unique,
  company_info_task_id uuid not null unique,
  source_record_id uuid not null,
  source_record_version_id uuid not null unique,
  source_identity_fingerprint bytea not null check (
    pg_catalog.octet_length(source_identity_fingerprint) = 32
  ),
  source_fingerprint bytea not null check (
    pg_catalog.octet_length(source_fingerprint) = 32
  ),
  checkpoint_id uuid not null unique,
  checkpoint_version bigint not null check (checkpoint_version > 0),
  checkpoint_row_version bigint not null check (checkpoint_row_version > 0),
  trust text not null check (trust = 'untrusted_external_input'),
  validation_state text not null check (validation_state = 'pending'),
  downstream_fact_source_count integer not null check (
    downstream_fact_source_count = 0
  ),
  downstream_reconciliation_member_count integer not null check (
    downstream_reconciliation_member_count = 0
  ),
  carry_mode text not null check (
    carry_mode = 'reference_existing_until_checkpoint_freshness_requires_read'
  ),
  evidence_fingerprint bytea not null unique check (
    pg_catalog.octet_length(evidence_fingerprint) = 32
  ),
  created_at timestamptz not null,
  constraint integration_sync_run_company_info_carry_run_fkey
    foreign key (
      workspace_id, business_entity_id, connection_id, old_sync_run_id
    ) references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_run_company_info_carry_task_fkey
    foreign key (
      workspace_id, business_entity_id, connection_id, company_info_task_id
    ) references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_run_company_info_carry_source_fkey
    foreign key (
      workspace_id, business_entity_id, source_record_id
    ) references private.external_source_records(
      workspace_id, business_entity_id, id
    ) on delete restrict,
  constraint integration_sync_run_company_info_carry_version_fkey
    foreign key (
      workspace_id, business_entity_id, source_record_version_id,
      source_fingerprint
    ) references private.external_source_record_versions(
      workspace_id, business_entity_id, id, source_fingerprint
    ) on delete restrict,
  constraint integration_sync_run_company_info_carry_checkpoint_fkey
    foreign key (
      workspace_id, business_entity_id, connection_id, checkpoint_id
    ) references private.integration_sync_checkpoints(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict
);

alter table private.integration_sync_run_company_info_carry_forward_evidence
  enable row level security;
alter table private.integration_sync_run_company_info_carry_forward_evidence
  force row level security;

create trigger reject_integration_sync_run_company_info_carry_mutation_v1
before update or delete
on private.integration_sync_run_company_info_carry_forward_evidence
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table private.integration_sync_run_incomplete_retirement_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_incomplete_initialization_run_retirement_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  sync_run_id uuid not null unique,
  prior_state text not null check (prior_state = 'running'),
  final_state text not null check (final_state = 'failed'),
  prior_row_version bigint not null check (prior_row_version > 0),
  failed_task_count integer not null check (failed_task_count = 20),
  cancelled_task_count integer not null check (cancelled_task_count = 3),
  succeeded_task_count integer not null check (succeeded_task_count = 1),
  company_info_carry_forward_evidence_id uuid not null unique references
    private.integration_sync_run_company_info_carry_forward_evidence(id)
    on delete restrict,
  reason_code text not null check (
    reason_code = 'pre_v5_task_bound_evidence_incomplete'
  ),
  request_id text not null unique check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (
    pg_catalog.char_length(actor_id) between 1 and 200
  ),
  finalized_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_run_incomplete_retirement_run_fkey
    foreign key (workspace_id, business_entity_id, connection_id, sync_run_id)
    references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_run_incomplete_retirement_time_check
    check (finalized_at = created_at)
);

alter table private.integration_sync_run_incomplete_retirement_events
  enable row level security;
alter table private.integration_sync_run_incomplete_retirement_events
  force row level security;

create trigger reject_integration_sync_run_incomplete_retirement_mutation_v1
before update or delete
on private.integration_sync_run_incomplete_retirement_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table private.integration_qbo_clean_replacement_wave_plans (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_clean_replacement_initialization_plan_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation = 1),
  old_sync_run_id uuid not null unique,
  replacement_sync_run_id uuid not null unique,
  company_info_carry_forward_evidence_id uuid not null unique references
    private.integration_sync_run_company_info_carry_forward_evidence(id)
    on delete restrict,
  company_info_mode text not null check (
    company_info_mode = 'carry_forward_existing_source_and_checkpoint'
  ),
  checkpoint_mode text not null check (
    checkpoint_mode = 'fresh_per_stream_boundaries'
  ),
  planned_task_count integer not null check (planned_task_count = 23),
  task_manifest jsonb not null,
  plan_fingerprint bytea not null unique check (
    pg_catalog.octet_length(plan_fingerprint) = 32
  ),
  request_id text not null unique check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (
    pg_catalog.char_length(actor_id) between 1 and 200
  ),
  planned_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_qbo_clean_replacement_old_run_fkey
    foreign key (
      workspace_id, business_entity_id, connection_id, old_sync_run_id
    ) references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_qbo_clean_replacement_time_check
    check (planned_at = created_at)
);

alter table private.integration_qbo_clean_replacement_wave_plans
  enable row level security;
alter table private.integration_qbo_clean_replacement_wave_plans
  force row level security;

create trigger reject_integration_qbo_clean_replacement_wave_plan_mutation_v1
before update or delete
on private.integration_qbo_clean_replacement_wave_plans
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

revoke all on table
  private.integration_qbo_precontract_queue_pause_evidence,
  private.integration_sync_task_precontract_retirement_events,
  private.integration_sync_task_envelope_retirement_reconciliations,
  private.integration_sync_run_company_info_carry_forward_evidence,
  private.integration_sync_run_incomplete_retirement_events,
  private.integration_qbo_clean_replacement_wave_plans
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

create or replace function private.is_qbo_clean_replacement_task_manifest_v1(
  p_manifest jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_manifest) = 'array'
    and pg_catalog.jsonb_array_length(p_manifest) = 23
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_manifest) as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'object'
        or not private.jsonb_has_exact_keys_v1(
          item.value,
          array['taskId', 'checkpointId', 'streamKey']
        )
        or pg_catalog.jsonb_typeof(item.value -> 'taskId') <> 'string'
        or pg_catalog.jsonb_typeof(item.value -> 'checkpointId') <> 'string'
        or pg_catalog.jsonb_typeof(item.value -> 'streamKey') <> 'string'
        or item.value ->> 'taskId' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item.value ->> 'checkpointId' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    and (
      select pg_catalog.count(distinct item.value ->> 'taskId') = 23
        and pg_catalog.count(distinct item.value ->> 'checkpointId') = 23
        and pg_catalog.count(distinct item.value ->> 'streamKey') = 23
      from pg_catalog.jsonb_array_elements(p_manifest) as item(value)
    )
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_manifest) as task_item(value)
      inner join pg_catalog.jsonb_array_elements(p_manifest)
        as checkpoint_item(value)
        on task_item.value ->> 'taskId' =
          checkpoint_item.value ->> 'checkpointId'
    )
    and (
      select pg_catalog.array_agg(item.value ->> 'streamKey'
        order by item.value ->> 'streamKey')
      from pg_catalog.jsonb_array_elements(p_manifest) as item(value)
    ) = array[
      'accounts', 'customers_minimized', 'items_minimized', 'preferences',
      'qbo_apagingsummary', 'qbo_aragingsummary', 'qbo_balancesheet',
      'qbo_bill', 'qbo_billpayment', 'qbo_cashflow', 'qbo_creditmemo',
      'qbo_deposit', 'qbo_invoice', 'qbo_journalentry', 'qbo_payment',
      'qbo_profitandloss', 'qbo_purchase', 'qbo_refundreceipt',
      'qbo_salesreceipt', 'qbo_transfer', 'qbo_trialbalance',
      'qbo_vendorcredit', 'vendors_minimized'
    ]::text[];
$function$;

create or replace function
  public.attest_qbo_sandbox_precontract_queue_pause_v1(
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
  v_observed_at timestamptz;
  v_request_fingerprint bytea;
  v_evidence private.integration_qbo_precontract_queue_pause_evidence;
begin
  perform private.assert_qbo_precontract_retirement_authority_v1();
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'syncRunId',
        'queueResource', 'queueState', 'observedEnvelopeCount',
        'queueSnapshotFingerprint', 'observedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_precontract_queue_pause_attestation_v1'
    or p_command ->> 'syncRunId' <>
      'a291839a-99c7-495e-8a53-57aa8aa6c99e'
    or p_command ->> 'queueResource' <>
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo'
    or p_command ->> 'queueState' <> 'PAUSED'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'observedEnvelopeCount'
    ) <> 'number'
    or (p_command ->> 'connectionGeneration')::bigint <> 1
    or (p_command ->> 'observedEnvelopeCount')::integer <> 3 then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_queue_pause_attestation_invalid';
  end if;

  v_observed_at := (p_command ->> 'observedAt')::timestamptz;
  if v_observed_at > v_now + interval '5 seconds'
    or v_observed_at < v_now - interval '2 minutes' then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_queue_pause_attestation_stale';
  end if;
  perform 1
  from private.integration_sync_runs as run
  where run.workspace_id = (p_command ->> 'workspaceId')::uuid
    and run.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and run.connection_id = (p_command ->> 'connectionId')::uuid
    and run.connection_generation = 1
    and run.id = (p_command ->> 'syncRunId')::uuid
    and run.mode = 'initialization'
    and run.state = 'running'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_queue_pause_attestation_denied';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select evidence.* into v_evidence
  from private.integration_qbo_precontract_queue_pause_evidence as evidence
  where evidence.request_id = p_request_id;
  if found then
    if v_evidence.request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'qbo_precontract_queue_pause_attestation_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'pauseEvidenceId', v_evidence.id,
      'queueState', v_evidence.queue_state,
      'expiresAt', v_evidence.expires_at,
      'idempotent', true
    );
  end if;

  insert into private.integration_qbo_precontract_queue_pause_evidence (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, queue_resource, queue_state,
    observed_envelope_count, queue_snapshot_fingerprint, request_id,
    request_fingerprint, actor_id, observed_at, expires_at, created_at
  ) values (
    'qbo_precontract_queue_pause_evidence_v1',
    (p_command ->> 'workspaceId')::uuid,
    (p_command ->> 'businessEntityId')::uuid,
    (p_command ->> 'connectionId')::uuid,
    1,
    (p_command ->> 'syncRunId')::uuid,
    p_command ->> 'queueResource',
    'PAUSED',
    3,
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'queueSnapshotFingerprint'
    ),
    p_request_id,
    v_request_fingerprint,
    p_actor_id,
    v_observed_at,
    v_observed_at + interval '5 minutes',
    v_observed_at
  ) returning * into v_evidence;

  return pg_catalog.jsonb_build_object(
    'pauseEvidenceId', v_evidence.id,
    'queueState', v_evidence.queue_state,
    'expiresAt', v_evidence.expires_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_queue_pause_attestation_invalid';
end;
$function$;

create or replace function
  public.retire_qbo_sandbox_precontract_dispatched_task_v1(
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
  v_target jsonb;
  v_task private.integration_sync_tasks;
  v_pause private.integration_qbo_precontract_queue_pause_evidence;
  v_event private.integration_sync_task_precontract_retirement_events;
  v_request_fingerprint bytea;
  v_task_snapshot_fingerprint bytea;
begin
  perform private.assert_qbo_precontract_retirement_authority_v1();
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'syncRunId', 'taskId',
        'expectedRowVersion', 'expectedDispatchGeneration',
        'expectedDispatcherTaskName', 'queuePauseEvidenceId'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_precontract_dispatched_task_retirement_v1' then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_dispatched_task_retirement_invalid';
  end if;

  v_target := private.qbo_precontract_retirement_target_v1(
    (p_command ->> 'taskId')::uuid
  );
  if v_target is null
    or p_command ->> 'syncRunId' <> v_target ->> 'syncRunId'
    or (p_command ->> 'connectionGeneration')::bigint <> 1
    or (p_command ->> 'expectedRowVersion')::bigint <>
      (v_target ->> 'expectedRowVersion')::bigint
    or (p_command ->> 'expectedDispatchGeneration')::bigint <>
      (v_target ->> 'expectedDispatchGeneration')::bigint
    or p_command ->> 'expectedDispatcherTaskName' <>
      v_target ->> 'dispatcherTaskName' then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_dispatched_task_retirement_denied';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended((p_command ->> 'taskId'), 0)
  );

  select event.* into v_event
  from private.integration_sync_task_precontract_retirement_events as event
  where event.task_id = (p_command ->> 'taskId')::uuid;
  if found then
    if v_event.request_id <> p_request_id
      or v_event.request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '42501',
        message = 'qbo_precontract_dispatched_task_retirement_replay_denied';
    end if;
    return pg_catalog.jsonb_build_object(
      'retirementEventId', v_event.id,
      'taskId', v_event.task_id,
      'state', 'cancelled',
      'priorRowVersion', v_event.prior_row_version,
      'rowVersion', v_event.prior_row_version + 1,
      'dispatchGeneration', v_event.prior_dispatch_generation,
      'dispatcherTaskName', v_event.prior_dispatcher_task_name,
      'queueState', 'PAUSED',
      'externalDeletionAuthorized', true,
      'idempotent', true
    );
  end if;

  select evidence.* into v_pause
  from private.integration_qbo_precontract_queue_pause_evidence as evidence
  where evidence.id = (p_command ->> 'queuePauseEvidenceId')::uuid
    and evidence.workspace_id = (p_command ->> 'workspaceId')::uuid
    and evidence.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and evidence.connection_id = (p_command ->> 'connectionId')::uuid
    and evidence.connection_generation = 1
    and evidence.sync_run_id = (p_command ->> 'syncRunId')::uuid
    and evidence.queue_state = 'PAUSED'
    and evidence.observed_envelope_count = 3
    and evidence.expires_at > v_now
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_dispatched_task_retirement_queue_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  inner join private.integration_sync_runs as run
    on run.workspace_id = task.workspace_id
    and run.business_entity_id = task.business_entity_id
    and run.connection_id = task.connection_id
    and run.connection_generation = task.connection_generation
    and run.id = task.sync_run_id
    and run.mode = 'initialization'
    and run.state = 'running'
  inner join private.integration_connections as connection
    on connection.workspace_id = task.workspace_id
    and connection.business_entity_id = task.business_entity_id
    and connection.id = task.connection_id
    and connection.connection_generation = task.connection_generation
    and connection.provider_key = task.provider_key
    and connection.provider_environment = task.provider_environment
    and connection.status = 'initializing'
    and connection.disconnected_at is null
    and connection.deleted_at is null
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.connection_generation = 1
    and task.sync_run_id = (p_command ->> 'syncRunId')::uuid
    and task.id = (p_command ->> 'taskId')::uuid
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.stream_key = v_target ->> 'streamKey'
    and task.state = 'dispatched'
    and task.row_version = (p_command ->> 'expectedRowVersion')::bigint
    and task.dispatch_generation =
      (p_command ->> 'expectedDispatchGeneration')::bigint
    and task.dispatcher_task_name =
      p_command ->> 'expectedDispatcherTaskName'
  for update of task;
  if not found
    or v_task.lease_id is not null
    or v_task.lease_owner_fingerprint is not null
    or v_task.lease_expires_at is not null
    or v_task.heartbeat_at is not null
    or v_task.durable_effect_fingerprint is not null
    or v_task.completed_at is not null
    or v_task.cancel_requested_at is not null
    or exists (
      select 1
      from private.integration_provider_credential_task_read_evidence as read
      where read.task_id = v_task.id
    )
    or exists (
      select 1
      from private.integration_sync_checkpoints as checkpoint
      where checkpoint.workspace_id = v_task.workspace_id
        and checkpoint.business_entity_id = v_task.business_entity_id
        and checkpoint.connection_id = v_task.connection_id
        and checkpoint.last_task_id = v_task.id
    )
    or exists (
      select 1
      from private.integration_audit_events as audit
      where audit.workspace_id = v_task.workspace_id
        and audit.business_entity_id = v_task.business_entity_id
        and audit.connection_id = v_task.connection_id
        and audit.action = 'integration_sync_task.complete'
        and audit.target_type = 'integration_sync_task'
        and audit.target_id = v_task.id::text
        and audit.outcome = 'succeeded'
    )
    or exists (
      select 1
      from private.external_source_record_versions as version
      inner join private.external_source_records as source_record
        on source_record.workspace_id = version.workspace_id
        and source_record.business_entity_id = version.business_entity_id
        and source_record.id = version.source_record_id
      where version.workspace_id = v_task.workspace_id
        and version.business_entity_id = v_task.business_entity_id
        and version.connection_id = v_task.connection_id
        and version.sync_run_id = v_task.sync_run_id
        and source_record.provider_key = 'quickbooks_online'
        and source_record.provider_record_type =
          v_target ->> 'providerRecordType'
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_dispatched_task_retirement_effect_denied';
  end if;

  v_task_snapshot_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_precontract_task_snapshot_v1',
      'taskId', v_task.id,
      'syncRunId', v_task.sync_run_id,
      'state', v_task.state,
      'rowVersion', v_task.row_version,
      'dispatchGeneration', v_task.dispatch_generation,
      'dispatcherTaskName', v_task.dispatcher_task_name,
      'deliveryAttributionState', v_task.delivery_attribution_state,
      'deliveryDispatchGeneration', v_task.last_delivery_dispatch_generation,
      'deliveryRetryCount', v_task.last_delivery_retry_count,
      'deliveryExecutionCount', v_task.last_delivery_execution_count,
      'deliveryAttemptFingerprint', case
        when v_task.last_delivery_attempt_fingerprint is null then null
        else private.phase_5_fingerprint_text_v1(
          v_task.last_delivery_attempt_fingerprint
        )
      end,
      'attemptCount', v_task.attempt_count
    )
  );

  insert into private.integration_sync_task_precontract_retirement_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, task_id, stream_key, prior_state,
    prior_row_version, prior_dispatch_generation,
    prior_dispatcher_task_name, prior_delivery_attribution_state,
    prior_delivery_dispatch_generation, prior_delivery_retry_count,
    prior_delivery_execution_count, prior_delivery_attempt_fingerprint,
    prior_attempt_count, queue_pause_evidence_id, reason_code,
    prior_task_snapshot_fingerprint, request_id, request_fingerprint,
    actor_id, retired_at, created_at
  ) values (
    'qbo_precontract_dispatched_task_retirement_v1',
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    v_task.connection_generation, v_task.sync_run_id, v_task.id,
    v_task.stream_key, v_task.state, v_task.row_version,
    v_task.dispatch_generation, v_task.dispatcher_task_name,
    v_task.delivery_attribution_state,
    v_task.last_delivery_dispatch_generation,
    v_task.last_delivery_retry_count,
    v_task.last_delivery_execution_count,
    v_task.last_delivery_attempt_fingerprint,
    v_task.attempt_count, v_pause.id,
    'pre_v5_task_bound_credential_evidence_contract',
    v_task_snapshot_fingerprint, p_request_id, v_request_fingerprint,
    p_actor_id, v_now, v_now
  ) returning * into v_event;

  update private.integration_sync_tasks as task
  set
    state = 'cancelled',
    dispatcher_task_name = null,
    cancel_requested_at = v_now,
    failure_category = 'cancelled',
    failure_code = 'pre_v5_evidence_contract_retired',
    completed_at = v_now,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning * into v_task;

  return pg_catalog.jsonb_build_object(
    'retirementEventId', v_event.id,
    'taskId', v_task.id,
    'state', v_task.state,
    'priorRowVersion', v_event.prior_row_version,
    'rowVersion', v_task.row_version,
    'dispatchGeneration', v_task.dispatch_generation,
    'dispatcherTaskName', v_event.prior_dispatcher_task_name,
    'queueState', v_pause.queue_state,
    'externalDeletionAuthorized', true,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_dispatched_task_retirement_invalid';
end;
$function$;

create or replace function
  public.reconcile_qbo_sandbox_precontract_envelope_retirement_v1(
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
  v_event private.integration_sync_task_precontract_retirement_events;
  v_reconciliation
    private.integration_sync_task_envelope_retirement_reconciliations;
  v_request_fingerprint bytea;
begin
  perform private.assert_qbo_precontract_retirement_authority_v1();
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'retirementEventId', 'workspaceId',
        'businessEntityId', 'connectionId', 'connectionGeneration',
        'syncRunId', 'taskId', 'queueResource', 'dispatcherTaskName',
        'deletionOutcome', 'providerOperationFingerprint'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_precontract_envelope_retirement_reconciliation_v1'
    or p_command ->> 'queueResource' <>
      'projects/vaeroex-p8b-20260823-84b2f0/locations/us-west1/queues/p8b-qbo'
    or p_command ->> 'deletionOutcome' not in ('deleted', 'already_absent') then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_envelope_retirement_reconciliation_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended((p_command ->> 'taskId'), 1)
  );

  select reconciliation.* into v_reconciliation
  from private.integration_sync_task_envelope_retirement_reconciliations
    as reconciliation
  where reconciliation.task_id = (p_command ->> 'taskId')::uuid;
  if found then
    if v_reconciliation.request_id <> p_request_id
      or v_reconciliation.request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '42501',
        message = 'qbo_precontract_envelope_retirement_replay_denied';
    end if;
    return pg_catalog.jsonb_build_object(
      'reconciliationId', v_reconciliation.id,
      'taskId', v_reconciliation.task_id,
      'deletionOutcome', v_reconciliation.deletion_outcome,
      'idempotent', true
    );
  end if;

  select event.* into v_event
  from private.integration_sync_task_precontract_retirement_events as event
  inner join private.integration_sync_tasks as task
    on task.workspace_id = event.workspace_id
    and task.business_entity_id = event.business_entity_id
    and task.connection_id = event.connection_id
    and task.id = event.task_id
    and task.sync_run_id = event.sync_run_id
    and task.state = 'cancelled'
    and task.row_version = event.prior_row_version + 1
    and task.dispatch_generation = event.prior_dispatch_generation
    and task.dispatcher_task_name is null
    and task.durable_effect_fingerprint is null
  where event.id = (p_command ->> 'retirementEventId')::uuid
    and event.workspace_id = (p_command ->> 'workspaceId')::uuid
    and event.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and event.connection_id = (p_command ->> 'connectionId')::uuid
    and event.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and event.sync_run_id = (p_command ->> 'syncRunId')::uuid
    and event.task_id = (p_command ->> 'taskId')::uuid
    and event.prior_dispatcher_task_name =
      p_command ->> 'dispatcherTaskName'
  for share of task;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_precontract_envelope_retirement_reconciliation_denied';
  end if;

  insert into private.integration_sync_task_envelope_retirement_reconciliations (
    contract_version, retirement_event_id, workspace_id,
    business_entity_id, connection_id, connection_generation, sync_run_id,
    task_id, queue_resource, dispatcher_task_name, deletion_outcome,
    provider_operation_fingerprint, request_id, request_fingerprint,
    actor_id, reconciled_at, created_at
  ) values (
    'qbo_precontract_envelope_retirement_reconciliation_v1',
    v_event.id, v_event.workspace_id, v_event.business_entity_id,
    v_event.connection_id, v_event.connection_generation,
    v_event.sync_run_id, v_event.task_id,
    p_command ->> 'queueResource',
    v_event.prior_dispatcher_task_name,
    p_command ->> 'deletionOutcome',
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'providerOperationFingerprint'
    ),
    p_request_id, v_request_fingerprint, p_actor_id, v_now, v_now
  ) returning * into v_reconciliation;

  return pg_catalog.jsonb_build_object(
    'reconciliationId', v_reconciliation.id,
    'taskId', v_reconciliation.task_id,
    'deletionOutcome', v_reconciliation.deletion_outcome,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_precontract_envelope_retirement_reconciliation_invalid';
end;
$function$;

create or replace function
  public.finalize_qbo_sandbox_precontract_initialization_run_v1(
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
  v_run private.integration_sync_runs;
  v_company_task private.integration_sync_tasks;
  v_source_record private.external_source_records;
  v_source_version private.external_source_record_versions;
  v_checkpoint private.integration_sync_checkpoints;
  v_carry private.integration_sync_run_company_info_carry_forward_evidence;
  v_event private.integration_sync_run_incomplete_retirement_events;
  v_request_fingerprint bytea;
  v_carry_fingerprint bytea;
  v_failed_count integer;
  v_cancelled_count integer;
  v_succeeded_count integer;
begin
  perform private.assert_qbo_precontract_retirement_authority_v1();
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'syncRunId',
        'expectedRunRowVersion'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_incomplete_initialization_run_retirement_v1'
    or p_command ->> 'syncRunId' <>
      'a291839a-99c7-495e-8a53-57aa8aa6c99e'
    or (p_command ->> 'connectionGeneration')::bigint <> 1 then
    raise exception using
      errcode = '22023',
      message = 'qbo_incomplete_initialization_run_retirement_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended((p_command ->> 'syncRunId'), 2)
  );

  select event.* into v_event
  from private.integration_sync_run_incomplete_retirement_events as event
  where event.sync_run_id = (p_command ->> 'syncRunId')::uuid;
  if found then
    if v_event.request_id <> p_request_id
      or v_event.request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '42501',
        message = 'qbo_incomplete_initialization_run_retirement_replay_denied';
    end if;
    return pg_catalog.jsonb_build_object(
      'runRetirementEventId', v_event.id,
      'companyInfoCarryForwardEvidenceId',
        v_event.company_info_carry_forward_evidence_id,
      'syncRunId', v_event.sync_run_id,
      'state', v_event.final_state,
      'rowVersion', v_event.prior_row_version + 1,
      'failedTaskCount', v_event.failed_task_count,
      'cancelledTaskCount', v_event.cancelled_task_count,
      'succeededTaskCount', v_event.succeeded_task_count,
      'idempotent', true
    );
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = (p_command ->> 'workspaceId')::uuid
    and run.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and run.connection_id = (p_command ->> 'connectionId')::uuid
    and run.connection_generation = 1
    and run.id = (p_command ->> 'syncRunId')::uuid
    and run.trigger_kind = 'provider_initialization'
    and run.mode = 'initialization'
    and run.state = 'running'
    and run.row_version = (p_command ->> 'expectedRunRowVersion')::bigint
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_retirement_denied';
  end if;

  select
    pg_catalog.count(*) filter (where task.state = 'failed')::integer,
    pg_catalog.count(*) filter (where task.state = 'cancelled')::integer,
    pg_catalog.count(*) filter (where task.state = 'succeeded')::integer
  into v_failed_count, v_cancelled_count, v_succeeded_count
  from private.integration_sync_tasks as task
  where task.workspace_id = v_run.workspace_id
    and task.business_entity_id = v_run.business_entity_id
    and task.connection_id = v_run.connection_id
    and task.connection_generation = v_run.connection_generation
    and task.sync_run_id = v_run.id;
  if v_failed_count <> 20
    or v_cancelled_count <> 3
    or v_succeeded_count <> 1
    or (
      select pg_catalog.count(*)
      from private.integration_sync_tasks as task
      where task.workspace_id = v_run.workspace_id
        and task.business_entity_id = v_run.business_entity_id
        and task.connection_id = v_run.connection_id
        and task.connection_generation = v_run.connection_generation
        and task.sync_run_id = v_run.id
    ) <> 24
    or (
      select pg_catalog.count(*)
      from private.integration_sync_task_precontract_retirement_events as event
      inner join
        private.integration_sync_task_envelope_retirement_reconciliations
          as reconciliation
        on reconciliation.retirement_event_id = event.id
      where event.sync_run_id = v_run.id
        and event.task_id in (
          'bc6c3cb1-7a9f-4d1b-98b6-fa82fb348bea'::uuid,
          '49dd3c22-a3d4-4f85-83c0-ed91fdb16131'::uuid,
          '872142c0-ddae-41eb-9e60-1babc6629d68'::uuid
        )
    ) <> 3
    or exists (
      select 1
      from private.integration_sync_tasks as task
      where task.sync_run_id = v_run.id
        and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_task_counts_denied';
  end if;

  select task.* into v_company_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_run.workspace_id
    and task.business_entity_id = v_run.business_entity_id
    and task.connection_id = v_run.connection_id
    and task.sync_run_id = v_run.id
    and task.stream_key = 'company_info'
    and task.state = 'succeeded'
    and task.durable_effect_fingerprint is not null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_company_info_denied';
  end if;

  select source_record.* into v_source_record
  from private.external_source_records as source_record
  where source_record.workspace_id = v_run.workspace_id
    and source_record.business_entity_id = v_run.business_entity_id
    and source_record.connection_id = v_run.connection_id
    and source_record.mapping_id = v_run.mapping_id
    and source_record.source_kind = 'provider'
    and source_record.provider_key = 'quickbooks_online'
    and source_record.provider_record_type = 'CompanyInfo'
    and source_record.lifecycle_state = 'active';
  if not found
    or (
      select pg_catalog.count(*)
      from private.external_source_records as source_record
      where source_record.workspace_id = v_run.workspace_id
        and source_record.business_entity_id = v_run.business_entity_id
        and source_record.connection_id = v_run.connection_id
        and source_record.mapping_id = v_run.mapping_id
        and source_record.source_kind = 'provider'
        and source_record.provider_key = 'quickbooks_online'
        and source_record.provider_record_type = 'CompanyInfo'
        and source_record.lifecycle_state = 'active'
    ) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_company_info_denied';
  end if;

  select version.* into v_source_version
  from private.external_source_record_versions as version
  where version.workspace_id = v_run.workspace_id
    and version.business_entity_id = v_run.business_entity_id
    and version.connection_id = v_run.connection_id
    and version.source_record_id = v_source_record.id
    and version.sync_run_id = v_run.id
    and version.id = v_source_record.current_version_id
    and version.immutable_version = 1
    and version.trust = 'untrusted_external_input'
    and version.validation_state = 'pending';
  if not found
    or (
      select pg_catalog.count(*)
      from private.external_source_record_versions as version
      where version.workspace_id = v_run.workspace_id
        and version.business_entity_id = v_run.business_entity_id
        and version.connection_id = v_run.connection_id
        and version.sync_run_id = v_run.id
    ) <> 1
    or exists (
      select 1
      from private.business_fact_sources as fact_source
      where fact_source.source_record_version_id = v_source_version.id
    )
    or exists (
      select 1
      from private.reconciliation_case_members as member
      where member.source_record_version_id = v_source_version.id
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_company_info_denied';
  end if;

  select checkpoint.* into v_checkpoint
  from private.integration_sync_checkpoints as checkpoint
  where checkpoint.workspace_id = v_run.workspace_id
    and checkpoint.business_entity_id = v_run.business_entity_id
    and checkpoint.connection_id = v_run.connection_id
    and checkpoint.connection_generation = v_run.connection_generation
    and checkpoint.mapping_id = v_run.mapping_id
    and checkpoint.stream_key = 'company_info'
    and checkpoint.lifecycle = 'active'
    and checkpoint.last_sync_run_id = v_run.id
    and checkpoint.last_task_id = v_company_task.id;
  if not found
    or (
      select pg_catalog.count(*)
      from private.integration_sync_checkpoints as checkpoint
      where checkpoint.workspace_id = v_run.workspace_id
        and checkpoint.business_entity_id = v_run.business_entity_id
        and checkpoint.connection_id = v_run.connection_id
        and checkpoint.connection_generation = v_run.connection_generation
        and checkpoint.mapping_id = v_run.mapping_id
        and checkpoint.stream_key = 'company_info'
        and checkpoint.lifecycle = 'active'
        and checkpoint.last_sync_run_id = v_run.id
        and checkpoint.last_task_id = v_company_task.id
    ) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'qbo_incomplete_initialization_run_company_info_denied';
  end if;

  v_carry_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_company_info_carry_forward_evidence_v1',
      'oldSyncRunId', v_run.id,
      'companyInfoTaskId', v_company_task.id,
      'sourceRecordId', v_source_record.id,
      'sourceRecordVersionId', v_source_version.id,
      'sourceIdentityFingerprint', private.phase_5_fingerprint_text_v1(
        v_source_record.source_identity_fingerprint
      ),
      'sourceFingerprint', private.phase_5_fingerprint_text_v1(
        v_source_version.source_fingerprint
      ),
      'checkpointId', v_checkpoint.id,
      'checkpointVersion', v_checkpoint.checkpoint_version,
      'checkpointRowVersion', v_checkpoint.row_version,
      'carryMode',
        'reference_existing_until_checkpoint_freshness_requires_read'
    )
  );
  insert into private.integration_sync_run_company_info_carry_forward_evidence (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, old_sync_run_id, company_info_task_id,
    source_record_id, source_record_version_id,
    source_identity_fingerprint, source_fingerprint, checkpoint_id,
    checkpoint_version, checkpoint_row_version, trust, validation_state,
    downstream_fact_source_count,
    downstream_reconciliation_member_count, carry_mode,
    evidence_fingerprint, created_at
  ) values (
    'qbo_company_info_carry_forward_evidence_v1',
    v_run.workspace_id, v_run.business_entity_id, v_run.connection_id,
    v_run.connection_generation, v_run.id, v_company_task.id,
    v_source_record.id, v_source_version.id,
    v_source_record.source_identity_fingerprint,
    v_source_version.source_fingerprint, v_checkpoint.id,
    v_checkpoint.checkpoint_version, v_checkpoint.row_version,
    v_source_version.trust, v_source_version.validation_state,
    0, 0,
    'reference_existing_until_checkpoint_freshness_requires_read',
    v_carry_fingerprint, v_now
  ) returning * into v_carry;

  insert into private.integration_sync_run_incomplete_retirement_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, prior_state, final_state,
    prior_row_version, failed_task_count, cancelled_task_count,
    succeeded_task_count, company_info_carry_forward_evidence_id,
    reason_code, request_id, request_fingerprint, actor_id,
    finalized_at, created_at
  ) values (
    'qbo_incomplete_initialization_run_retirement_v1',
    v_run.workspace_id, v_run.business_entity_id, v_run.connection_id,
    v_run.connection_generation, v_run.id, v_run.state, 'failed',
    v_run.row_version, v_failed_count, v_cancelled_count,
    v_succeeded_count, v_carry.id,
    'pre_v5_task_bound_evidence_incomplete',
    p_request_id, v_request_fingerprint, p_actor_id, v_now, v_now
  ) returning * into v_event;

  update private.integration_sync_runs as run
  set
    state = 'failed',
    error_category = 'contract',
    error_code = 'pre_v5_task_bound_evidence_incomplete',
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    finished_at = v_now,
    row_version = run.row_version + 1,
    updated_at = v_now
  where run.id = v_run.id
  returning * into v_run;

  return pg_catalog.jsonb_build_object(
    'runRetirementEventId', v_event.id,
    'companyInfoCarryForwardEvidenceId', v_carry.id,
    'syncRunId', v_run.id,
    'state', v_run.state,
    'rowVersion', v_run.row_version,
    'failedTaskCount', v_failed_count,
    'cancelledTaskCount', v_cancelled_count,
    'succeededTaskCount', v_succeeded_count,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_incomplete_initialization_run_retirement_invalid';
end;
$function$;

create or replace function
  public.plan_qbo_sandbox_clean_replacement_initialization_v1(
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
  v_run private.integration_sync_runs;
  v_carry private.integration_sync_run_company_info_carry_forward_evidence;
  v_plan private.integration_qbo_clean_replacement_wave_plans;
  v_request_fingerprint bytea;
  v_plan_fingerprint bytea;
  v_manifest jsonb;
begin
  perform private.assert_qbo_precontract_retirement_authority_v1();
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'oldSyncRunId',
        'expectedOldRunRowVersion', 'replacementSyncRunId',
        'companyInfoCarryForwardEvidenceId', 'tasks'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_clean_replacement_initialization_plan_v1'
    or p_command ->> 'oldSyncRunId' <>
      'a291839a-99c7-495e-8a53-57aa8aa6c99e'
    or (p_command ->> 'connectionGeneration')::bigint <> 1
    or not private.is_qbo_clean_replacement_task_manifest_v1(
      p_command -> 'tasks'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_clean_replacement_initialization_plan_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended((p_command ->> 'oldSyncRunId'), 3)
  );

  select plan.* into v_plan
  from private.integration_qbo_clean_replacement_wave_plans as plan
  where plan.old_sync_run_id = (p_command ->> 'oldSyncRunId')::uuid;
  if found then
    if v_plan.request_id <> p_request_id
      or v_plan.request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '42501',
        message = 'qbo_clean_replacement_initialization_plan_replay_denied';
    end if;
    return pg_catalog.jsonb_build_object(
      'replacementPlanId', v_plan.id,
      'oldSyncRunId', v_plan.old_sync_run_id,
      'replacementSyncRunId', v_plan.replacement_sync_run_id,
      'plannedTaskCount', v_plan.planned_task_count,
      'companyInfoMode', v_plan.company_info_mode,
      'idempotent', true
    );
  end if;

  select run.* into v_run
  from private.integration_sync_runs as run
  inner join private.integration_sync_run_incomplete_retirement_events as event
    on event.workspace_id = run.workspace_id
    and event.business_entity_id = run.business_entity_id
    and event.connection_id = run.connection_id
    and event.sync_run_id = run.id
  where run.workspace_id = (p_command ->> 'workspaceId')::uuid
    and run.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and run.connection_id = (p_command ->> 'connectionId')::uuid
    and run.connection_generation = 1
    and run.id = (p_command ->> 'oldSyncRunId')::uuid
    and run.state = 'failed'
    and run.error_category = 'contract'
    and run.error_code = 'pre_v5_task_bound_evidence_incomplete'
    and run.row_version = (p_command ->> 'expectedOldRunRowVersion')::bigint
  for share of run;
  if not found
    or exists (
      select 1
      from private.integration_sync_runs as replacement
      where replacement.id = (p_command ->> 'replacementSyncRunId')::uuid
    )
    or (p_command ->> 'replacementSyncRunId')::uuid = v_run.id
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'tasks') as item(value)
      inner join private.integration_sync_tasks as historical
        on historical.id = (item.value ->> 'taskId')::uuid
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'tasks') as item(value)
      inner join private.integration_sync_checkpoints as checkpoint
        on checkpoint.id = (item.value ->> 'checkpointId')::uuid
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_clean_replacement_initialization_plan_denied';
  end if;

  select carry.* into v_carry
  from private.integration_sync_run_company_info_carry_forward_evidence as carry
  inner join private.external_source_records as source_record
    on source_record.workspace_id = carry.workspace_id
    and source_record.business_entity_id = carry.business_entity_id
    and source_record.id = carry.source_record_id
    and source_record.current_version_id = carry.source_record_version_id
    and source_record.source_identity_fingerprint =
      carry.source_identity_fingerprint
  inner join private.external_source_record_versions as version
    on version.workspace_id = carry.workspace_id
    and version.business_entity_id = carry.business_entity_id
    and version.id = carry.source_record_version_id
    and version.source_fingerprint = carry.source_fingerprint
    and version.trust = 'untrusted_external_input'
    and version.validation_state = 'pending'
  inner join private.integration_sync_checkpoints as checkpoint
    on checkpoint.workspace_id = carry.workspace_id
    and checkpoint.business_entity_id = carry.business_entity_id
    and checkpoint.connection_id = carry.connection_id
    and checkpoint.id = carry.checkpoint_id
    and checkpoint.checkpoint_version = carry.checkpoint_version
    and checkpoint.row_version = carry.checkpoint_row_version
    and checkpoint.lifecycle = 'active'
  where carry.id =
      (p_command ->> 'companyInfoCarryForwardEvidenceId')::uuid
    and carry.workspace_id = v_run.workspace_id
    and carry.business_entity_id = v_run.business_entity_id
    and carry.connection_id = v_run.connection_id
    and carry.connection_generation = v_run.connection_generation
    and carry.old_sync_run_id = v_run.id;
  if not found
    or exists (
      select 1 from private.business_fact_sources as fact_source
      where fact_source.source_record_version_id = v_carry.source_record_version_id
    )
    or exists (
      select 1 from private.reconciliation_case_members as member
      where member.source_record_version_id = v_carry.source_record_version_id
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_clean_replacement_company_info_carry_denied';
  end if;

  select pg_catalog.jsonb_agg(
    item.value || pg_catalog.jsonb_build_object(
      'dispatcherTaskName', pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            'phase8b_qbo_cloud_task_v1:'
              || (item.value ->> 'taskId') || ':1:1',
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    ) order by item.value ->> 'streamKey'
  ) into v_manifest
  from pg_catalog.jsonb_array_elements(p_command -> 'tasks') as item(value);
  v_plan_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_clean_replacement_initialization_plan_v1',
      'oldSyncRunId', v_run.id,
      'replacementSyncRunId', (p_command ->> 'replacementSyncRunId')::uuid,
      'companyInfoCarryForwardEvidenceId', v_carry.id,
      'companyInfoMode', 'carry_forward_existing_source_and_checkpoint',
      'checkpointMode', 'fresh_per_stream_boundaries',
      'tasks', v_manifest
    )
  );

  insert into private.integration_qbo_clean_replacement_wave_plans (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, old_sync_run_id, replacement_sync_run_id,
    company_info_carry_forward_evidence_id, company_info_mode,
    checkpoint_mode, planned_task_count, task_manifest, plan_fingerprint,
    request_id, request_fingerprint, actor_id, planned_at, created_at
  ) values (
    'qbo_clean_replacement_initialization_plan_v1',
    v_run.workspace_id, v_run.business_entity_id, v_run.connection_id,
    v_run.connection_generation, v_run.id,
    (p_command ->> 'replacementSyncRunId')::uuid, v_carry.id,
    'carry_forward_existing_source_and_checkpoint',
    'fresh_per_stream_boundaries', 23, v_manifest, v_plan_fingerprint,
    p_request_id, v_request_fingerprint, p_actor_id, v_now, v_now
  ) returning * into v_plan;

  return pg_catalog.jsonb_build_object(
    'replacementPlanId', v_plan.id,
    'oldSyncRunId', v_plan.old_sync_run_id,
    'replacementSyncRunId', v_plan.replacement_sync_run_id,
    'plannedTaskCount', v_plan.planned_task_count,
    'companyInfoMode', v_plan.company_info_mode,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_clean_replacement_initialization_plan_invalid';
end;
$function$;

revoke all on function
  public.attest_qbo_sandbox_precontract_queue_pause_v1(jsonb, text, text),
  public.retire_qbo_sandbox_precontract_dispatched_task_v1(jsonb, text, text),
  public.reconcile_qbo_sandbox_precontract_envelope_retirement_v1(
    jsonb, text, text
  ),
  public.finalize_qbo_sandbox_precontract_initialization_run_v1(
    jsonb, text, text
  ),
  public.plan_qbo_sandbox_clean_replacement_initialization_v1(
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
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

grant execute on function
  public.attest_qbo_sandbox_precontract_queue_pause_v1(jsonb, text, text),
  public.retire_qbo_sandbox_precontract_dispatched_task_v1(jsonb, text, text),
  public.reconcile_qbo_sandbox_precontract_envelope_retirement_v1(
    jsonb, text, text
  ),
  public.finalize_qbo_sandbox_precontract_initialization_run_v1(
    jsonb, text, text
  ),
  public.plan_qbo_sandbox_clean_replacement_initialization_v1(
    jsonb, text, text
  )
to integration_qbo_precontract_retirement_authority;

revoke all on function
  private.assert_qbo_precontract_retirement_authority_v1(),
  private.qbo_precontract_retirement_target_v1(uuid),
  private.is_qbo_clean_replacement_task_manifest_v1(jsonb)
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

comment on function
  public.retire_qbo_sandbox_precontract_dispatched_task_v1(jsonb, text, text)
is
  'Retires only the three reviewed pre-V5 Phase 8B dispatched tasks after exact CAS, effect-free, task-evidence-free, and fresh queue-pause proof.';
comment on function
  public.finalize_qbo_sandbox_precontract_initialization_run_v1(
    jsonb, text, text
  )
is
  'Closes the exact old Phase 8B initialization run as failed historical evidence with task counts 20 failed, 3 cancelled, 1 succeeded.';
comment on function
  public.plan_qbo_sandbox_clean_replacement_initialization_v1(
    jsonb, text, text
  )
is
  'Records but does not create a 23-task clean replacement wave with new identities, fresh checkpoint boundaries, and CompanyInfo carried by reference.';

commit;
