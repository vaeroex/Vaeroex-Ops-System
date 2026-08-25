-- Preserve a live sync-run decision for the complete scoped reservation.
-- Lock order is connection, run, then task to match the durable runtime.

create or replace function public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
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
  v_request_fingerprint bytea;
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
        'connectionId', 'connectionGeneration', 'taskId',
        'expectedRowVersion', 'dispatcherTaskName'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_scoped_dispatch_reservation_v1'
    or pg_catalog.jsonb_typeof(p_command -> 'connectionGeneration') <> 'number'
    or pg_catalog.jsonb_typeof(p_command -> 'expectedRowVersion') <> 'number'
    or p_command ->> 'dispatcherTaskName' !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_reservation_invalid';
  end if;

  if (p_command ->> 'connectionGeneration')::bigint <= 0
    or (p_command ->> 'expectedRowVersion')::bigint <= 0 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_reservation_invalid';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
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
      message = 'qbo_sandbox_scoped_dispatch_reservation_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_tasks as candidate
  inner join private.integration_sync_runs as run
    on run.workspace_id = candidate.workspace_id
    and run.business_entity_id = candidate.business_entity_id
    and run.connection_id = candidate.connection_id
    and run.connection_generation = candidate.connection_generation
    and run.id = candidate.sync_run_id
  where candidate.workspace_id = v_connection.workspace_id
    and candidate.business_entity_id = v_connection.business_entity_id
    and candidate.connection_id = v_connection.id
    and candidate.connection_generation = v_connection.connection_generation
    and candidate.id = (p_command ->> 'taskId')::uuid
    and candidate.provider_key = 'quickbooks_online'
    and candidate.provider_environment = 'sandbox'
    and candidate.queue_class in ('provider_interactive', 'provider_bulk')
    and candidate.stream_key in (
      'accounts', 'company_info', 'preferences',
      'customers_minimized', 'vendors_minimized', 'items_minimized',
      'qbo_invoice', 'qbo_salesreceipt', 'qbo_payment', 'qbo_creditmemo',
      'qbo_refundreceipt', 'qbo_bill', 'qbo_billpayment', 'qbo_purchase',
      'qbo_vendorcredit', 'qbo_deposit', 'qbo_journalentry',
      'qbo_transfer', 'qbo_profitandloss', 'qbo_balancesheet',
      'qbo_cashflow', 'qbo_aragingsummary', 'qbo_apagingsummary',
      'qbo_trialbalance', 'qbo_cdc'
    )
    and run.state in ('created', 'running')
  for share of run;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_scoped_dispatch_reservation_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.id = (p_command ->> 'taskId')::uuid
    and task.sync_run_id = v_run.id
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
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_scoped_dispatch_reservation_denied';
  end if;

  if v_task.state = 'dispatched'
    and v_task.dispatcher_task_name = p_command ->> 'dispatcherTaskName'
    and v_task.last_request_id = p_request_id
    and v_task.last_request_fingerprint = v_request_fingerprint then
    return private.phase_6_task_result_v1(v_task, true);
  end if;
  if v_task.state <> 'pending'
    or v_task.row_version <>
      (p_command ->> 'expectedRowVersion')::bigint
    or v_task.available_at > v_now then
    raise exception using
      errcode = '40001',
      message = 'qbo_sandbox_scoped_dispatch_reservation_stale';
  end if;

  update private.integration_sync_tasks as task
  set
    state = 'dispatched',
    dispatcher_task_name = p_command ->> 'dispatcherTaskName',
    dispatch_generation = task.dispatch_generation + 1,
    failure_category = null,
    failure_code = null,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.dispatch',
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
  return private.phase_6_task_result_v1(v_task, false);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_scoped_dispatch_reservation_invalid';
end;
$function$;

revoke all on function public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
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
grant execute on function public.reserve_qbo_sandbox_scoped_dispatch_task_v1(
  jsonb, text, text
)
  to integration_task_dispatch_authority;
