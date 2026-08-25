-- Phase 8B Cloud Tasks zero-based delivery correction.
--
-- Cloud Tasks starts X-CloudTasks-TaskExecutionCount at zero for every newly
-- created Cloud Task. Durable delivery evidence therefore has to distinguish
-- no accepted delivery from an accepted zero and has to be scoped to the
-- dispatch generation that owned the Cloud Task identity.

begin;

-- The scheduler keeps membership only for legacy authority assertions. It may
-- neither inherit nor assume the dispatcher role that owns incident recovery.
grant integration_task_dispatch_authority
  to integration_task_scheduler_authority
  with inherit false, set false;

alter table private.integration_sync_tasks
  add column last_delivery_dispatch_generation bigint,
  add column delivery_attribution_state text;

alter table private.integration_sync_tasks
  drop constraint integration_sync_tasks_delivery_check;
alter table private.integration_sync_tasks
  alter column last_delivery_execution_count drop not null;
alter table private.integration_sync_tasks
  alter column last_delivery_execution_count drop default;

-- The existing mutation trigger requires a row-version advance for runtime
-- state transitions. This one-time representation backfill is schema history,
-- not a runtime transition, and remains atomic with the replacement trigger.
alter table private.integration_sync_tasks
  disable trigger validate_integration_sync_task_mutation_v1;

update private.integration_sync_tasks
set
  last_delivery_execution_count = null,
  delivery_attribution_state = 'none'
where last_delivery_execution_count = -1;

with resolved_delivery_generation as (
  select
    task.id as task_id,
    (
      select pg_catalog.max(
        (audit.metadata ->> 'dispatch_generation')::numeric
      )::bigint
      from private.integration_audit_events as audit
      where audit.workspace_id = task.workspace_id
        and audit.business_entity_id = task.business_entity_id
        and audit.connection_id = task.connection_id
        and audit.action = 'integration_sync_task.lease'
        and audit.outcome = 'succeeded'
        and audit.target_type = 'integration_sync_task'
        and audit.target_id = task.id::text
        and audit.metadata ->> 'dispatch_generation' ~ '^[1-9][0-9]{0,18}$'
        and (audit.metadata ->> 'dispatch_generation')::numeric <=
          task.dispatch_generation::numeric
    ) as delivery_dispatch_generation
  from private.integration_sync_tasks as task
  where task.last_delivery_execution_count is not null
)
update private.integration_sync_tasks as task
set
  last_delivery_dispatch_generation = resolved.delivery_dispatch_generation,
  delivery_attribution_state = 'attributed'
from resolved_delivery_generation as resolved
where task.id = resolved.task_id
  and resolved.delivery_dispatch_generation is not null;

-- Preserve ambiguous historical bytes without inventing a generation. These
-- rows are quarantined by both the task trigger and lease RPC below.
update private.integration_sync_tasks
set delivery_attribution_state = 'legacy_unattributed'
where last_delivery_execution_count is not null
  and last_delivery_dispatch_generation is null;

alter table private.integration_sync_tasks
  alter column delivery_attribution_state set not null,
  alter column delivery_attribution_state set default 'none';

alter table private.integration_sync_tasks
  add constraint integration_sync_tasks_delivery_check check (
    (
      delivery_attribution_state = 'none'
      and last_delivery_execution_count is null
      and last_delivery_attempt_fingerprint is null
      and last_delivery_dispatch_generation is null
    )
    or (
      delivery_attribution_state = 'attributed'
      and last_delivery_execution_count is not null
      and last_delivery_execution_count between 0 and 100
      and last_delivery_attempt_fingerprint is not null
      and pg_catalog.octet_length(last_delivery_attempt_fingerprint) = 32
      and last_delivery_dispatch_generation is not null
      and last_delivery_dispatch_generation between 1 and dispatch_generation
    )
    or (
      delivery_attribution_state = 'legacy_unattributed'
      and last_delivery_execution_count is not null
      and last_delivery_execution_count between 0 and 100
      and last_delivery_attempt_fingerprint is not null
      and pg_catalog.octet_length(last_delivery_attempt_fingerprint) = 32
      and last_delivery_dispatch_generation is null
    )
  );

alter table private.integration_sync_tasks
  add constraint integration_sync_tasks_delivery_attribution_state_check check (
    delivery_attribution_state in (
      'none', 'attributed', 'legacy_unattributed'
    )
  );

comment on column private.integration_sync_tasks.delivery_attribution_state is
  'Explicit delivery evidence state: none, generation-attributed, or quarantined legacy-unattributed.';
comment on column private.integration_sync_tasks.last_delivery_execution_count is
  'Nullable zero-based Cloud Tasks execution count; NULL is valid only for delivery attribution state none.';
comment on column private.integration_sync_tasks.last_delivery_dispatch_generation is
  'Proven dispatch generation for attributed delivery evidence; NULL for none and legacy-unattributed evidence.';

create table private.integration_sync_task_delivery_attribution_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'integration_sync_task_delivery_attribution_migration_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  provider_key text not null,
  provider_environment text not null,
  task_state text not null,
  task_dispatch_generation bigint not null check (task_dispatch_generation >= 0),
  delivery_attribution_state text not null check (
    delivery_attribution_state = 'legacy_unattributed'
  ),
  delivery_dispatch_generation bigint check (
    delivery_dispatch_generation is null
  ),
  delivery_execution_count integer not null check (
    delivery_execution_count between 0 and 100
  ),
  delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(delivery_attempt_fingerprint) = 32
  ),
  task_row_version bigint not null check (task_row_version > 0),
  attempt_count integer not null check (attempt_count between 0 and 20),
  lease_id_fingerprint bytea check (
    lease_id_fingerprint is null
    or pg_catalog.octet_length(lease_id_fingerprint) = 32
  ),
  durable_effect_present boolean not null,
  completed_at timestamptz,
  reason_code text not null check (
    reason_code = 'successful_lease_audit_missing'
  ),
  recorded_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint integration_sync_task_delivery_attribution_events_task_key unique (
    task_id
  ),
  constraint integration_sync_task_delivery_attribution_events_task_fkey
    foreign key (
      workspace_id, business_entity_id, connection_id, task_id
    ) references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_delivery_attribution_events_time_check check (
    created_at = recorded_at
  )
);

alter table private.integration_sync_task_delivery_attribution_events
  enable row level security;
alter table private.integration_sync_task_delivery_attribution_events
  force row level security;
revoke all on table private.integration_sync_task_delivery_attribution_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

insert into private.integration_sync_task_delivery_attribution_events (
  contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, task_id, provider_key,
  provider_environment, task_state, task_dispatch_generation,
  delivery_attribution_state, delivery_dispatch_generation,
  delivery_execution_count, delivery_attempt_fingerprint,
  task_row_version, attempt_count, lease_id_fingerprint,
  durable_effect_present, completed_at, reason_code, recorded_at, created_at
)
select
  'integration_sync_task_delivery_attribution_migration_v1',
  task.workspace_id,
  task.business_entity_id,
  task.connection_id,
  task.connection_generation,
  task.sync_run_id,
  task.id,
  task.provider_key,
  task.provider_environment,
  task.state,
  task.dispatch_generation,
  task.delivery_attribution_state,
  task.last_delivery_dispatch_generation,
  task.last_delivery_execution_count,
  task.last_delivery_attempt_fingerprint,
  task.row_version,
  task.attempt_count,
  case
    when task.lease_id is null then null
    else extensions.digest(
      pg_catalog.convert_to(task.lease_id::text, 'UTF8'),
      'sha256'
    )
  end,
  task.durable_effect_fingerprint is not null,
  task.completed_at,
  'successful_lease_audit_missing',
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp()
from private.integration_sync_tasks as task
where task.delivery_attribution_state = 'legacy_unattributed'
order by task.id;

create trigger reject_integration_sync_task_delivery_attribution_event_mutation_v1
before update or delete
on private.integration_sync_task_delivery_attribution_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create table private.integration_sync_task_delivery_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version = 'qbo_sandbox_zero_based_delivery_recovery_v1'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  dispatch_generation bigint not null check (dispatch_generation > 0),
  prior_delivery_attribution_state text not null check (
    prior_delivery_attribution_state in ('none', 'attributed')
  ),
  prior_delivery_dispatch_generation bigint,
  prior_delivery_execution_count integer,
  prior_delivery_attempt_fingerprint bytea,
  task_row_version bigint not null check (task_row_version > 0),
  dispatcher_task_name_fingerprint bytea not null check (
    pg_catalog.octet_length(dispatcher_task_name_fingerprint) = 32
  ),
  observed_delivery_execution_count integer not null check (
    observed_delivery_execution_count = 0
  ),
  observed_delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(observed_delivery_attempt_fingerprint) = 32
  ),
  external_evidence_fingerprint bytea not null check (
    pg_catalog.octet_length(external_evidence_fingerprint) = 32
  ),
  reason_code text not null check (
    reason_code = 'rejected_before_lease'
  ),
  request_id text not null check (
    pg_catalog.char_length(request_id) between 1 and 200
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint integration_sync_task_delivery_recovery_task_generation_key
    unique (task_id, dispatch_generation),
  constraint integration_sync_task_delivery_recovery_request_task_key
    unique (request_id, task_id),
  constraint integration_sync_task_delivery_recovery_task_fkey foreign key (
    workspace_id, business_entity_id, connection_id, task_id
  ) references private.integration_sync_tasks(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_delivery_recovery_run_fkey foreign key (
    workspace_id, business_entity_id, connection_id, sync_run_id
  ) references private.integration_sync_runs(
    workspace_id, business_entity_id, connection_id, id
  ) on delete restrict,
  constraint integration_sync_task_delivery_recovery_prior_check check (
    (
      prior_delivery_attribution_state = 'none'
      and prior_delivery_execution_count is null
      and prior_delivery_attempt_fingerprint is null
      and prior_delivery_dispatch_generation is null
    )
    or (
      prior_delivery_attribution_state = 'attributed'
      and prior_delivery_execution_count is not null
      and prior_delivery_execution_count between 0 and 100
      and prior_delivery_attempt_fingerprint is not null
      and pg_catalog.octet_length(prior_delivery_attempt_fingerprint) = 32
      and prior_delivery_dispatch_generation is not null
      and prior_delivery_dispatch_generation
        between 1 and dispatch_generation - 1
    )
  ),
  constraint integration_sync_task_delivery_recovery_generation_check check (
    prior_delivery_dispatch_generation is null
    or prior_delivery_dispatch_generation < dispatch_generation
  ),
  constraint integration_sync_task_delivery_recovery_time_check check (
    created_at = recovered_at
  )
);

create index integration_sync_task_delivery_recovery_scope_idx
  on private.integration_sync_task_delivery_recovery_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, dispatch_generation
  );

alter table private.integration_sync_task_delivery_recovery_events
  enable row level security;
alter table private.integration_sync_task_delivery_recovery_events
  force row level security;

revoke all on table private.integration_sync_task_delivery_recovery_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

create trigger reject_integration_sync_task_delivery_recovery_mutation_v1
before update or delete
on private.integration_sync_task_delivery_recovery_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

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

  -- Ambiguous historical delivery bytes are preserved as evidence, never
  -- interpreted by ordinary runtime state transitions. A future resolution,
  -- if ever needed, requires a separate checked and audited authority.
  if old.delivery_attribution_state = 'legacy_unattributed' then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_attribution_unresolved';
  end if;

  if old.state in ('succeeded', 'failed', 'dead_letter', 'cancelled') then
    if old.state = 'failed'
      and old.failure_category = 'contract'
      and old.failure_code = 'phase8b_provider_task_failed'
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
          and recovery.recovered_at
            + pg_catalog.make_interval(secs => recovery.retry_after_seconds)
            = new.available_at
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
    new.last_delivery_execution_count,
    new.last_delivery_attempt_fingerprint
  ) is distinct from (
    old.delivery_attribution_state,
    old.last_delivery_dispatch_generation,
    old.last_delivery_execution_count,
    old.last_delivery_attempt_fingerprint
  ) and (
    new.delivery_attribution_state <> 'attributed'
    or new.last_delivery_dispatch_generation is null
    or new.last_delivery_dispatch_generation <> new.dispatch_generation
    or new.last_delivery_execution_count is null
    or new.last_delivery_attempt_fingerprint is null
    or (
      old.delivery_attribution_state = 'attributed'
      and (
        new.last_delivery_attempt_fingerprint =
          old.last_delivery_attempt_fingerprint
        or
        new.last_delivery_dispatch_generation <
          old.last_delivery_dispatch_generation
        or (
          new.last_delivery_dispatch_generation =
            old.last_delivery_dispatch_generation
          and new.last_delivery_execution_count <=
            old.last_delivery_execution_count
        )
      )
    )
    or (
      (
        old.delivery_attribution_state = 'none'
        or (
          old.delivery_attribution_state = 'attributed'
          and old.last_delivery_dispatch_generation <
            new.last_delivery_dispatch_generation
        )
      )
      and new.last_delivery_execution_count <> 0
      and not exists (
        select 1
        from private.integration_sync_task_delivery_recovery_events as recovery
        where recovery.workspace_id = old.workspace_id
          and recovery.business_entity_id = old.business_entity_id
          and recovery.connection_id = old.connection_id
          and recovery.connection_generation = old.connection_generation
          and recovery.task_id = old.id
          and recovery.dispatch_generation =
            new.last_delivery_dispatch_generation
          and recovery.observed_delivery_execution_count <
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

alter table private.integration_sync_tasks
  enable trigger validate_integration_sync_task_mutation_v1;

-- Quarantined tasks are excluded at discovery, rather than selected and left
-- for a later mutation or lease boundary to reject.
create or replace function public.discover_integration_sync_dispatch_v1(
  p_queue_class text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_result jsonb;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_queue_class not in (
    'integration_control', 'provider_interactive',
    'provider_bulk', 'deterministic_intelligence'
  ) or p_limit not between 1 and 1000 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_dispatch_query_invalid';
  end if;

  with last_served as (
    select
      served.workspace_id,
      pg_catalog.max(served.updated_at) as last_served_at
    from private.integration_sync_tasks as served
    where served.queue_class = p_queue_class
      and served.dispatch_generation > 0
      and served.delivery_attribution_state <> 'legacy_unattributed'
    group by served.workspace_id
  ), ranked as (
    select
      task.id,
      task.workspace_id,
      task.priority,
      task.created_at,
      last_served.last_served_at,
      pg_catalog.row_number() over (
        partition by task.workspace_id
        order by task.priority desc, task.created_at, task.id
      ) as workspace_ordinal
    from private.integration_sync_tasks as task
    left join last_served on last_served.workspace_id = task.workspace_id
    where task.queue_class = p_queue_class
      and task.state = 'pending'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.available_at <= v_now
  ), fair as (
    select * from ranked
    order by workspace_ordinal, last_served_at nulls first,
      workspace_id, priority desc, created_at, id
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', fair.id,
        'workspaceId', fair.workspace_id
      ) order by fair.workspace_ordinal, fair.last_served_at nulls first,
        fair.workspace_id, fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;

  return v_result;
end;
$function$;

create or replace function public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_connection_id uuid;
  v_connection_generation bigint;
  v_limit integer;
  v_result jsonb;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'maximumTasks'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_scoped_dispatch_discovery_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'maximumTasks') <> 'number' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_query_invalid';
  end if;

  v_workspace_id := (p_command ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_command ->> 'businessEntityId')::uuid;
  v_connection_id := (p_command ->> 'connectionId')::uuid;
  v_connection_generation :=
    (p_command ->> 'connectionGeneration')::bigint;
  v_limit := (p_command ->> 'maximumTasks')::integer;
  if v_connection_generation <= 0 or v_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_query_invalid';
  end if;

  with trusted_connection as (
    select connection.id
    from private.integration_connections as connection
    where connection.workspace_id = v_workspace_id
      and connection.business_entity_id = v_business_entity_id
      and connection.id = v_connection_id
      and connection.connection_generation = v_connection_generation
      and connection.provider_key = 'quickbooks_online'
      and connection.provider_environment = 'sandbox'
      and connection.status in ('initializing', 'active', 'degraded')
  ), eligible as (
    select task.*
    from private.integration_sync_tasks as task
    inner join trusted_connection
      on trusted_connection.id = task.connection_id
    inner join private.integration_sync_runs as run
      on run.workspace_id = task.workspace_id
      and run.business_entity_id = task.business_entity_id
      and run.connection_id = task.connection_id
      and run.id = task.sync_run_id
      and run.connection_generation = task.connection_generation
      and run.state in ('created', 'running')
    where task.workspace_id = v_workspace_id
      and task.business_entity_id = v_business_entity_id
      and task.connection_id = v_connection_id
      and task.connection_generation = v_connection_generation
      and task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
      and task.queue_class in ('provider_interactive', 'provider_bulk')
      and task.state = 'pending'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.available_at <= v_now
      and task.stream_key in (
        'accounts', 'company_info', 'preferences',
        'customers_minimized', 'vendors_minimized', 'items_minimized',
        'qbo_invoice', 'qbo_salesreceipt', 'qbo_payment', 'qbo_creditmemo',
        'qbo_refundreceipt', 'qbo_bill', 'qbo_billpayment', 'qbo_purchase',
        'qbo_vendorcredit', 'qbo_deposit', 'qbo_journalentry',
        'qbo_transfer', 'qbo_profitandloss', 'qbo_balancesheet',
        'qbo_cashflow', 'qbo_aragingsummary', 'qbo_apagingsummary',
        'qbo_trialbalance', 'qbo_cdc'
      )
    order by task.priority desc, task.created_at, task.id
    limit v_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', eligible.id,
        'workspaceId', eligible.workspace_id,
        'businessEntityId', eligible.business_entity_id,
        'connectionId', eligible.connection_id,
        'connectionGeneration', eligible.connection_generation,
        'queueClass', eligible.queue_class,
        'streamKey', eligible.stream_key,
        'rowVersion', eligible.row_version,
        'dispatchGeneration', eligible.dispatch_generation
      ) order by eligible.priority desc, eligible.created_at, eligible.id
    ),
    '[]'::jsonb
  ) into v_result
  from eligible;

  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_query_invalid';
end;
$function$;

create or replace function public.sweep_integration_sync_tasks_v1(
  p_limit integer,
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
  v_task private.integration_sync_tasks;
  v_request_fingerprint bytea;
  v_recovered integer := 0;
  v_target_state text;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_limit not between 1 and 1000
    or p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_sweep_payload_invalid';
  end if;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    pg_catalog.jsonb_build_object('limit', p_limit)
  );

  for v_task in
    select task.*
    from private.integration_sync_tasks as task
    where task.delivery_attribution_state <> 'legacy_unattributed'
      and (
        task.retention_expires_at <= v_now
        or (
          task.state = 'dispatched'
          and task.updated_at <= v_now - interval '15 minutes'
        )
        or (task.state = 'leased' and task.lease_expires_at <= v_now)
        or (task.state = 'retry_wait' and task.available_at <= v_now)
      )
      and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
    order by
      case when task.retention_expires_at <= v_now then 0 else 1 end,
      task.updated_at,
      task.id
    for update skip locked
    limit p_limit
  loop
    if v_task.retention_expires_at <= v_now then
      v_target_state := 'cancelled';
    elsif v_task.state = 'leased'
      and v_task.attempt_count >= v_task.maximum_attempts then
      v_target_state := 'dead_letter';
    elsif v_task.state = 'leased' then
      v_target_state := 'retry_wait';
    else
      v_target_state := 'pending';
    end if;

    update private.integration_sync_tasks as task
    set
      state = v_target_state,
      dispatcher_task_name = null,
      lease_id = null,
      lease_owner_fingerprint = null,
      lease_expires_at = null,
      heartbeat_at = null,
      available_at = case when v_target_state in ('pending', 'retry_wait')
        then v_now else task.available_at end,
      cancel_requested_at = case when v_target_state = 'cancelled'
        then v_now else task.cancel_requested_at end,
      failure_category = case
        when v_target_state = 'cancelled' then 'cancelled'
        when v_task.state = 'leased' then 'timeout'
        else null
      end,
      failure_code = case
        when v_target_state = 'cancelled' then 'runtime_retention_expired'
        when v_task.state = 'leased' then 'runtime_lease_expired'
        else null
      end,
      completed_at = case when v_target_state in ('cancelled', 'dead_letter')
        then v_now else null end,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    v_recovered := v_recovered + 1;
    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id,
      v_task.business_entity_id,
      v_task.connection_id,
      p_actor_id,
      'integration_sync_task.recover',
      case when v_target_state = 'dead_letter' then 'failed' else 'succeeded' end,
      'integration_sync_task',
      v_task.id::text,
      p_request_id,
      pg_catalog.jsonb_build_object(
        'task_state', v_task.state,
        'task_kind', v_task.task_kind,
        'queue_class', v_task.queue_class,
        'attempt_count', v_task.attempt_count,
        'dispatch_generation', v_task.dispatch_generation,
        'recovered_task_count', 1,
        'row_version', v_task.row_version,
        'idempotent', false
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_recovered,
    'sweptAt', v_now
  );
end;
$function$;

create or replace function public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(
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
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_connection_id uuid;
  v_connection_generation bigint;
  v_limit integer;
  v_task private.integration_sync_tasks;
  v_request_fingerprint bytea;
  v_recovered integer := 0;
  v_target_state text;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'maximumTasks'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_scoped_dispatch_recovery_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'maximumTasks') <> 'number' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_recovery_invalid';
  end if;

  v_workspace_id := (p_command ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_command ->> 'businessEntityId')::uuid;
  v_connection_id := (p_command ->> 'connectionId')::uuid;
  v_connection_generation :=
    (p_command ->> 'connectionGeneration')::bigint;
  v_limit := (p_command ->> 'maximumTasks')::integer;
  if v_connection_generation <= 0 or v_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_recovery_invalid';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  for v_task in
    select task.*
    from private.integration_sync_tasks as task
    inner join private.integration_connections as connection
      on connection.workspace_id = task.workspace_id
      and connection.business_entity_id = task.business_entity_id
      and connection.id = task.connection_id
      and connection.connection_generation = task.connection_generation
      and connection.provider_key = task.provider_key
      and connection.provider_environment = task.provider_environment
    where task.workspace_id = v_workspace_id
      and task.business_entity_id = v_business_entity_id
      and task.connection_id = v_connection_id
      and task.connection_generation = v_connection_generation
      and task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.queue_class in ('provider_interactive', 'provider_bulk')
      and task.stream_key in (
        'accounts', 'company_info', 'preferences',
        'customers_minimized', 'vendors_minimized', 'items_minimized',
        'qbo_invoice', 'qbo_salesreceipt', 'qbo_payment', 'qbo_creditmemo',
        'qbo_refundreceipt', 'qbo_bill', 'qbo_billpayment', 'qbo_purchase',
        'qbo_vendorcredit', 'qbo_deposit', 'qbo_journalentry',
        'qbo_transfer', 'qbo_profitandloss', 'qbo_balancesheet',
        'qbo_cashflow', 'qbo_aragingsummary', 'qbo_apagingsummary',
        'qbo_trialbalance', 'qbo_cdc'
      )
      and connection.status in ('initializing', 'active', 'degraded')
      and (
        task.retention_expires_at <= v_now
        or (
          task.state = 'dispatched'
          and task.updated_at <= v_now - interval '15 minutes'
        )
        or (task.state = 'leased' and task.lease_expires_at <= v_now)
        or (task.state = 'retry_wait' and task.available_at <= v_now)
      )
      and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
    order by
      case when task.retention_expires_at <= v_now then 0 else 1 end,
      task.updated_at,
      task.id
    for update of task skip locked
    limit v_limit
  loop
    if v_task.retention_expires_at <= v_now then
      v_target_state := 'cancelled';
    elsif v_task.state = 'leased'
      and v_task.attempt_count >= v_task.maximum_attempts then
      v_target_state := 'dead_letter';
    elsif v_task.state = 'leased' then
      v_target_state := 'retry_wait';
    else
      v_target_state := 'pending';
    end if;

    update private.integration_sync_tasks as task
    set
      state = v_target_state,
      dispatcher_task_name = null,
      lease_id = null,
      lease_owner_fingerprint = null,
      lease_expires_at = null,
      heartbeat_at = null,
      available_at = case when v_target_state in ('pending', 'retry_wait')
        then v_now else task.available_at end,
      cancel_requested_at = case when v_target_state = 'cancelled'
        then v_now else task.cancel_requested_at end,
      failure_category = case
        when v_target_state = 'cancelled' then 'cancelled'
        when v_task.state = 'leased' then 'timeout'
        else null
      end,
      failure_code = case
        when v_target_state = 'cancelled' then 'runtime_retention_expired'
        when v_task.state = 'leased' then 'runtime_lease_expired'
        else null
      end,
      completed_at = case when v_target_state in ('cancelled', 'dead_letter')
        then v_now else null end,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    v_recovered := v_recovered + 1;
    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id,
      v_task.business_entity_id,
      v_task.connection_id,
      p_actor_id,
      'integration_sync_task.recover',
      case when v_target_state = 'dead_letter' then 'failed' else 'succeeded' end,
      'integration_sync_task',
      v_task.id::text,
      p_request_id,
      pg_catalog.jsonb_build_object(
        'task_state', v_task.state,
        'task_kind', v_task.task_kind,
        'queue_class', v_task.queue_class,
        'attempt_count', v_task.attempt_count,
        'dispatch_generation', v_task.dispatch_generation,
        'recovered_task_count', 1,
        'row_version', v_task.row_version,
        'idempotent', false
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_recovered,
    'sweptAt', v_now
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_recovery_invalid';
end;
$function$;

create or replace function public.recover_qbo_sandbox_zero_based_deliveries_v1(
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
  v_run private.integration_sync_runs;
  v_run_ids uuid[];
  v_normalized_observations jsonb;
  v_normalized_command jsonb;
  v_request_fingerprint bytea;
  v_requested_count integer;
  v_scoped_count integer;
  v_eligible_count integer;
  v_existing_count integer;
  v_matching_existing_count integer;
  v_recovered_at timestamptz;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );

  if p_command is null
    or p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'observations'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_zero_based_delivery_recovery_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'observations') <> 'array'
    or pg_catalog.jsonb_array_length(p_command -> 'observations')
      not between 1 and 100
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        p_command -> 'observations'
      ) as observation(value)
      where not private.jsonb_has_exact_keys_v1(
        observation.value,
        array[
          'taskId', 'expectedRowVersion', 'dispatcherTaskName',
          'deliveryExecutionCount', 'deliveryAttemptFingerprint',
          'externalEvidenceFingerprint'
        ]
      )
        or pg_catalog.jsonb_typeof(
          observation.value -> 'expectedRowVersion'
        ) <> 'number'
        or pg_catalog.jsonb_typeof(
          observation.value -> 'deliveryExecutionCount'
        ) <> 'number'
        or observation.value ->> 'dispatcherTaskName' !~ '^[a-f0-9]{64}$'
        or observation.value ->> 'deliveryAttemptFingerprint'
          !~ '^sha256:[0-9a-f]{64}$'
        or observation.value ->> 'externalEvidenceFingerprint'
          !~ '^sha256:[0-9a-f]{64}$'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_zero_based_delivery_recovery_invalid';
  end if;

  if (p_command ->> 'connectionGeneration')::bigint <= 0
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        p_command -> 'observations'
      ) as observation(value)
      where (observation.value ->> 'expectedRowVersion')::bigint <= 0
        or (observation.value ->> 'deliveryExecutionCount')::integer <> 0
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_zero_based_delivery_recovery_invalid';
  end if;

  select pg_catalog.jsonb_agg(observation.value order by observation.value ->> 'taskId')
  into v_normalized_observations
  from pg_catalog.jsonb_array_elements(
    p_command -> 'observations'
  ) as observation(value);
  v_requested_count := pg_catalog.jsonb_array_length(v_normalized_observations);

  if (
    select pg_catalog.count(distinct observation.value ->> 'taskId')
    from pg_catalog.jsonb_array_elements(
      v_normalized_observations
    ) as observation(value)
  ) <> v_requested_count then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_zero_based_delivery_recovery_invalid';
  end if;

  v_normalized_command := pg_catalog.jsonb_set(
    p_command,
    '{observations}',
    v_normalized_observations,
    false
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    v_normalized_command
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_sandbox_zero_based_delivery_recovery:' || p_request_id,
      0
    )
  );

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where event.contract_version =
          'qbo_sandbox_zero_based_delivery_recovery_v1'
        and event.workspace_id = (p_command ->> 'workspaceId')::uuid
        and event.business_entity_id =
          (p_command ->> 'businessEntityId')::uuid
        and event.connection_id = (p_command ->> 'connectionId')::uuid
        and event.connection_generation =
          (p_command ->> 'connectionGeneration')::bigint
        and event.request_fingerprint = v_request_fingerprint
        and event.actor_id = p_actor_id
    )::integer,
    pg_catalog.max(event.recovered_at)
  into v_existing_count, v_matching_existing_count, v_recovered_at
  from private.integration_sync_task_delivery_recovery_events as event
  where event.request_id = p_request_id;

  if v_existing_count > 0 then
    if v_existing_count = v_requested_count
      and v_matching_existing_count = v_existing_count then
      return pg_catalog.jsonb_build_object(
        'recoveredTaskCount', v_existing_count,
        'recoveredAt', v_recovered_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_zero_based_delivery_recovery_request_conflict';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status = 'initializing'
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_zero_based_delivery_recovery_denied';
  end if;

  select pg_catalog.array_agg(distinct task.sync_run_id order by task.sync_run_id)
  into v_run_ids
  from private.integration_sync_tasks as task
  inner join pg_catalog.jsonb_array_elements(
    v_normalized_observations
  ) as observation(value)
    on task.id = (observation.value ->> 'taskId')::uuid
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation;
  if pg_catalog.cardinality(v_run_ids) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_zero_based_delivery_recovery_denied';
  end if;

  select run.*
  into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.id = v_run_ids[1]
    and run.connection_generation = v_connection.connection_generation
    and run.mode = 'initialization'
    and run.state = 'running'
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_zero_based_delivery_recovery_denied';
  end if;

  perform task.id
  from private.integration_sync_tasks as task
  inner join pg_catalog.jsonb_array_elements(
    v_normalized_observations
  ) as observation(value)
    on task.id = (observation.value ->> 'taskId')::uuid
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
  order by task.id
  for update of task;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where task.sync_run_id = v_run.id
        and task.provider_key = 'quickbooks_online'
        and task.provider_environment = 'sandbox'
        and task.queue_class in ('provider_interactive', 'provider_bulk')
        and task.state = 'dispatched'
        and task.delivery_attribution_state in ('none', 'attributed')
        and task.row_version =
          (observation.value ->> 'expectedRowVersion')::bigint
        and task.dispatcher_task_name =
          observation.value ->> 'dispatcherTaskName'
        and task.dispatch_generation > 0
        and (
          task.last_delivery_dispatch_generation is null
          or task.last_delivery_dispatch_generation < task.dispatch_generation
        )
        and task.lease_id is null
        and task.lease_owner_fingerprint is null
        and task.lease_expires_at is null
        and task.heartbeat_at is null
        and task.cancel_requested_at is null
        and task.failure_category is null
        and task.failure_code is null
        and task.durable_effect_fingerprint is null
        and task.completed_at is null
        and exists (
          select 1
          from private.integration_sync_task_recovery_events as recovery
          where recovery.workspace_id = task.workspace_id
            and recovery.business_entity_id = task.business_entity_id
            and recovery.connection_id = task.connection_id
            and recovery.connection_generation = task.connection_generation
            and recovery.task_id = task.id
        )
        and exists (
          select 1
          from private.integration_audit_events as audit
          where audit.workspace_id = task.workspace_id
            and audit.business_entity_id = task.business_entity_id
            and audit.connection_id = task.connection_id
            and audit.action = 'integration_sync_task.dispatch'
            and audit.outcome = 'succeeded'
            and audit.target_type = 'integration_sync_task'
            and audit.target_id = task.id::text
            and audit.metadata ->> 'dispatch_generation' =
              task.dispatch_generation::text
        )
        and not exists (
          select 1
          from private.integration_audit_events as audit
          where audit.workspace_id = task.workspace_id
            and audit.business_entity_id = task.business_entity_id
            and audit.connection_id = task.connection_id
            and audit.action = 'integration_sync_task.lease'
            and audit.outcome = 'succeeded'
            and audit.target_type = 'integration_sync_task'
            and audit.target_id = task.id::text
            and audit.metadata ->> 'dispatch_generation' =
              task.dispatch_generation::text
        )
        and not exists (
          select 1
          from private.integration_sync_task_delivery_recovery_events as event
          where event.task_id = task.id
            and event.dispatch_generation = task.dispatch_generation
        )
    )::integer
  into v_scoped_count, v_eligible_count
  from private.integration_sync_tasks as task
  inner join pg_catalog.jsonb_array_elements(
    v_normalized_observations
  ) as observation(value)
    on task.id = (observation.value ->> 'taskId')::uuid
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation;

  if v_scoped_count <> v_requested_count
    or v_eligible_count <> v_requested_count then
    raise exception using
      errcode = '40001',
      message = 'qbo_sandbox_zero_based_delivery_recovery_stale';
  end if;

  insert into private.integration_sync_task_delivery_recovery_events (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, task_id, dispatch_generation,
    prior_delivery_attribution_state, prior_delivery_dispatch_generation,
    prior_delivery_execution_count,
    prior_delivery_attempt_fingerprint, task_row_version,
    dispatcher_task_name_fingerprint, observed_delivery_execution_count,
    observed_delivery_attempt_fingerprint, external_evidence_fingerprint,
    reason_code, request_id, request_fingerprint, actor_id,
    recovered_at, created_at
  )
  select
    'qbo_sandbox_zero_based_delivery_recovery_v1',
    task.workspace_id,
    task.business_entity_id,
    task.connection_id,
    task.connection_generation,
    task.sync_run_id,
    task.id,
    task.dispatch_generation,
    task.delivery_attribution_state,
    task.last_delivery_dispatch_generation,
    task.last_delivery_execution_count,
    task.last_delivery_attempt_fingerprint,
    task.row_version,
    extensions.digest(
      pg_catalog.convert_to(task.dispatcher_task_name, 'UTF8'),
      'sha256'
    ),
    0,
    pg_catalog.decode(
      pg_catalog.substr(
        observation.value ->> 'deliveryAttemptFingerprint',
        8
      ),
      'hex'
    ),
    pg_catalog.decode(
      pg_catalog.substr(
        observation.value ->> 'externalEvidenceFingerprint',
        8
      ),
      'hex'
    ),
    'rejected_before_lease',
    p_request_id,
    v_request_fingerprint,
    p_actor_id,
    v_now,
    v_now
  from private.integration_sync_tasks as task
  inner join pg_catalog.jsonb_array_elements(
    v_normalized_observations
  ) as observation(value)
    on task.id = (observation.value ->> 'taskId')::uuid
  order by task.id;

  insert into private.integration_audit_events (
    workspace_id, business_entity_id, connection_id,
    actor_type, actor_id, action, outcome, target_type, target_id,
    request_id, reason_code, metadata, occurred_at, retention_class
  )
  select
    task.workspace_id,
    task.business_entity_id,
    task.connection_id,
    'service',
    p_actor_id,
    'integration_sync_task.delivery_contract_recover',
    'succeeded',
    'integration_sync_task',
    task.id::text,
    p_request_id,
    'rejected_before_lease',
    pg_catalog.jsonb_build_object(
      'task_state', task.state,
      'task_kind', task.task_kind,
      'queue_class', task.queue_class,
      'attempt_count', task.attempt_count,
      'dispatch_generation', task.dispatch_generation,
      'row_version', task.row_version,
      'idempotent', false
    ),
    v_now,
    'security'
  from private.integration_sync_tasks as task
  inner join pg_catalog.jsonb_array_elements(
    v_normalized_observations
  ) as observation(value)
    on task.id = (observation.value ->> 'taskId')::uuid
  order by task.id;

  return pg_catalog.jsonb_build_object(
    'recoveredTaskCount', v_requested_count,
    'recoveredAt', v_now,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_zero_based_delivery_recovery_conflict';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_zero_based_delivery_recovery_invalid';
end;
$function$;

revoke all on function public.recover_qbo_sandbox_zero_based_deliveries_v1(
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
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.recover_qbo_sandbox_zero_based_deliveries_v1(
  jsonb, text, text
)
  to integration_task_dispatch_authority;
create or replace function public.lease_integration_sync_task_v1(
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
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_policy private.integration_workspace_policies;
  v_request_fingerprint bytea;
  v_delivery_fingerprint bytea;
  v_lease_owner_fingerprint bytea;
  v_sync_run_id uuid;
  v_workspace_active integer;
  v_connection_active integer;
  v_provider_active integer;
  v_recovered_delivery_execution_count integer;
begin
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId', 'businessEntityId', 'connectionId',
        'connectionGeneration', 'taskId', 'expectedRowVersion',
        'workerKind', 'leaseId', 'leaseOwnerFingerprint', 'leaseSeconds',
        'dispatcherTaskName', 'deliveryExecutionCount',
        'deliveryAttemptFingerprint'
      ]
    )
    or p_command ->> 'workerKind' not in (
      'provider_runtime', 'deterministic_runtime'
    )
    or (p_command ->> 'leaseSeconds')::integer not between 30 and 900
    or (p_command ->> 'deliveryExecutionCount')::integer not between 0 and 100
    or pg_catalog.octet_length(p_command ->> 'dispatcherTaskName')
      not between 1 and 1024 then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_delivery_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'deliveryAttemptFingerprint'
  );
  v_lease_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );

  select task.sync_run_id into v_sync_run_id
  from private.integration_sync_tasks as task
  where task.workspace_id = (p_command ->> 'workspaceId')::uuid
    and task.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and task.connection_id = (p_command ->> 'connectionId')::uuid
    and task.id = (p_command ->> 'taskId')::uuid;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  -- Serialize workspace admission before the connection/run/task lock chain.
  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  -- The lock order is stable across runtime commands: workspace, connection,
  -- provider admission, run, task.
  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or v_connection.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_connection.status not in ('initializing', 'active', 'degraded') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_connection.provider_key || ':' || v_connection.provider_environment,
      0
    )
  );

  select run.* into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.id = v_sync_run_id
  for update;
  if not found
    or v_run.connection_generation <> v_connection.connection_generation
    or v_run.state <> 'running' then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_lease_denied';
  end if;
  perform private.assert_phase_6_worker_for_queue_v1(v_task.queue_class);
  if ((v_task.queue_class = 'deterministic_intelligence') <>
      (p_command ->> 'workerKind' = 'deterministic_runtime')) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_worker_boundary_denied';
  end if;

  if v_task.delivery_attribution_state = 'legacy_unattributed' then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_delivery_attribution_unresolved';
  end if;

  select pg_catalog.max(event.observed_delivery_execution_count)
  into v_recovered_delivery_execution_count
  from private.integration_sync_task_delivery_recovery_events as event
  where event.workspace_id = v_task.workspace_id
    and event.business_entity_id = v_task.business_entity_id
    and event.connection_id = v_task.connection_id
    and event.connection_generation = v_task.connection_generation
    and event.task_id = v_task.id
    and event.dispatch_generation = v_task.dispatch_generation;

  if v_task.state = 'succeeded' then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object('acquired', false, 'terminalReplay', true);
  end if;
  if v_task.state = 'leased'
    and v_task.delivery_attribution_state = 'attributed'
    and v_task.last_delivery_dispatch_generation = v_task.dispatch_generation
    and v_task.last_delivery_execution_count =
      (p_command ->> 'deliveryExecutionCount')::integer
    and v_task.last_delivery_attempt_fingerprint = v_delivery_fingerprint then
    return private.phase_6_task_result_v1(v_task, true) ||
      pg_catalog.jsonb_build_object('acquired', false, 'terminalReplay', false);
  end if;
  if v_task.state = 'leased' then
    return private.phase_6_task_result_v1(v_task, false) ||
      pg_catalog.jsonb_build_object(
        'acquired', false,
        'terminalReplay', false,
        'reasonCode', 'lease_held'
      );
  end if;
  if v_task.state <> 'dispatched'
    or v_task.row_version <> (p_command ->> 'expectedRowVersion')::bigint
    or v_task.dispatcher_task_name <> p_command ->> 'dispatcherTaskName'
    or (
      (
        v_task.delivery_attribution_state = 'none'
        or (
          v_task.delivery_attribution_state = 'attributed'
          and v_task.last_delivery_dispatch_generation <
            v_task.dispatch_generation
        )
      )
      and v_recovered_delivery_execution_count is null
      and (p_command ->> 'deliveryExecutionCount')::integer <> 0
    )
    or (
      v_task.delivery_attribution_state = 'attributed'
      and v_task.last_delivery_dispatch_generation = v_task.dispatch_generation
      and (
        (p_command ->> 'deliveryExecutionCount')::integer <=
          v_task.last_delivery_execution_count
        or v_delivery_fingerprint = v_task.last_delivery_attempt_fingerprint
      )
    )
    or (
      v_recovered_delivery_execution_count is not null
      and (p_command ->> 'deliveryExecutionCount')::integer <=
        v_recovered_delivery_execution_count
    ) then
    raise exception using
      errcode = '40001',
      message = 'integration_sync_task_lease_stale';
  end if;

  select policy.* into v_policy
  from private.integration_workspace_policies as policy
  where policy.workspace_id = v_task.workspace_id
    and policy.provider_key = v_task.provider_key
    and policy.provider_environment = v_task.provider_environment
  for share;
  if not found or v_policy.state <> 'enabled' or not v_policy.sync_enabled then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_task_policy_denied';
  end if;

  if exists (
    select 1
    from private.integration_runtime_circuits as circuit
    where circuit.state = 'open'
      and circuit.open_until > v_now
      and circuit.circuit_scope in (
        case when v_task.queue_class = 'deterministic_intelligence'
          then 'deterministic_integrity' else 'provider_api' end,
        'queue_runtime'
      )
      and (
        circuit.circuit_level = 'global'
        or (circuit.circuit_level = 'provider'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment)
        or (circuit.circuit_level = 'workspace'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id)
        or (circuit.circuit_level = 'connection'
          and circuit.provider_key = v_task.provider_key
          and circuit.provider_environment = v_task.provider_environment
          and circuit.workspace_id = v_task.workspace_id
          and circuit.business_entity_id = v_task.business_entity_id
          and circuit.connection_id = v_task.connection_id)
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_circuit_open';
  end if;

  select pg_catalog.count(*) into v_workspace_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  select pg_catalog.count(*) into v_connection_active
  from private.integration_sync_tasks as task
  where task.workspace_id = v_task.workspace_id
    and task.connection_id = v_task.connection_id
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  select pg_catalog.count(*) into v_provider_active
  from private.integration_sync_tasks as task
  where task.provider_key = v_task.provider_key
    and task.provider_environment = v_task.provider_environment
    and task.state = 'leased'
    and task.delivery_attribution_state = 'attributed';
  if v_workspace_active >= v_policy.maximum_concurrency
    or v_connection_active >= least(v_policy.maximum_concurrency, 2)
    or v_provider_active >= 64 then
    raise exception using
      errcode = '55000',
      message = 'integration_sync_task_backpressure';
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'leased',
    attempt_count = task.attempt_count + 1,
    lease_id = (p_command ->> 'leaseId')::uuid,
    lease_owner_fingerprint = v_lease_owner_fingerprint,
    lease_expires_at = v_now +
      pg_catalog.make_interval(secs => (p_command ->> 'leaseSeconds')::integer),
    heartbeat_at = v_now,
    delivery_attribution_state = 'attributed',
    last_delivery_dispatch_generation = task.dispatch_generation,
    last_delivery_execution_count =
      (p_command ->> 'deliveryExecutionCount')::integer,
    last_delivery_attempt_fingerprint = v_delivery_fingerprint,
    failure_category = null,
    failure_code = null,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;
  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
    p_actor_id, 'integration_sync_task.lease', 'succeeded',
    'integration_sync_task', v_task.id::text, p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'task_kind', v_task.task_kind,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );
  return private.phase_6_task_result_v1(v_task, false) ||
    pg_catalog.jsonb_build_object('acquired', true, 'terminalReplay', false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_task_lease_payload_invalid';
end;
$function$;

revoke all on function public.lease_integration_sync_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.lease_integration_sync_task_v1(
  jsonb, text, text
)
  to integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;

commit;
