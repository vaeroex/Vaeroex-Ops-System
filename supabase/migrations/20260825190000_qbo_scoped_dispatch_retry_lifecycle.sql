-- Separate due-retry scheduling from lifecycle recovery. A dispatched task is
-- never requeued solely because its database timestamp is old.

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
        or (task.state = 'leased' and task.lease_expires_at <= v_now)
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
    elsif v_task.attempt_count >= v_task.maximum_attempts then
      v_target_state := 'dead_letter';
    else
      v_target_state := 'retry_wait';
    end if;

    update private.integration_sync_tasks as task
    set
      state = v_target_state,
      dispatcher_task_name = null,
      lease_id = null,
      lease_owner_fingerprint = null,
      lease_expires_at = null,
      heartbeat_at = null,
      available_at = case when v_target_state = 'retry_wait'
        then v_now else task.available_at end,
      cancel_requested_at = case when v_target_state = 'cancelled'
        then v_now else task.cancel_requested_at end,
      failure_category = case
        when v_target_state = 'cancelled' then 'cancelled'
        else 'timeout'
      end,
      failure_code = case
        when v_target_state = 'cancelled' then 'runtime_retention_expired'
        else 'runtime_lease_expired'
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

create or replace function public.promote_qbo_sandbox_due_retry_tasks_v1(
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
  v_task private.integration_sync_tasks;
  v_limit integer;
  v_request_fingerprint bytea;
  v_promoted integer := 0;
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
      'qbo_sandbox_due_retry_promotion_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'maximumTasks') <> 'number' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_due_retry_promotion_invalid';
  end if;

  v_limit := (p_command ->> 'maximumTasks')::integer;
  if (p_command ->> 'connectionGeneration')::bigint <= 0
    or v_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_due_retry_promotion_invalid';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

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
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_due_retry_promotion_denied';
  end if;

  perform run.id
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.connection_generation = v_connection.connection_generation
    and run.state in ('created', 'running')
  order by run.id
  for share;

  for v_task in
    select task.*
    from private.integration_sync_tasks as task
    inner join private.integration_sync_runs as run
      on run.workspace_id = task.workspace_id
      and run.business_entity_id = task.business_entity_id
      and run.connection_id = task.connection_id
      and run.connection_generation = task.connection_generation
      and run.id = task.sync_run_id
      and run.state in ('created', 'running')
    where task.workspace_id = v_connection.workspace_id
      and task.business_entity_id = v_connection.business_entity_id
      and task.connection_id = v_connection.id
      and task.connection_generation = v_connection.connection_generation
      and task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
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
      and task.state = 'retry_wait'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.available_at <= v_now
      and task.retention_expires_at > v_now
    order by task.priority desc, task.available_at, task.created_at, task.id
    for update of task skip locked
    limit v_limit
  loop
    update private.integration_sync_tasks as task
    set
      state = 'pending',
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = task.row_version + 1,
      updated_at = v_now
    where task.id = v_task.id
    returning task.* into v_task;
    v_promoted := v_promoted + 1;

    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id,
      v_task.business_entity_id,
      v_task.connection_id,
      p_actor_id,
      'integration_sync_task.retry_ready',
      'succeeded',
      'integration_sync_task',
      v_task.id::text,
      p_request_id,
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
  end loop;

  return pg_catalog.jsonb_build_object(
    'promotedTaskCount', v_promoted,
    'promotedAt', v_now
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_due_retry_promotion_invalid';
end;
$function$;

revoke all on function public.promote_qbo_sandbox_due_retry_tasks_v1(
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
grant execute on function public.promote_qbo_sandbox_due_retry_tasks_v1(
  jsonb, text, text
)
  to integration_task_dispatch_authority;

comment on function public.promote_qbo_sandbox_due_retry_tasks_v1(
  jsonb, text, text
) is
  'Promotes only due QBO sandbox retry_wait tasks inside one trusted runtime scope; never recovers dispatched work.';
