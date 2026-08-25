-- Scope QBO sandbox dispatch discovery to the dispatcher service's trusted
-- workspace, Business Entity, connection, and connection generation.

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

revoke all on function public.read_qbo_sandbox_dispatch_candidates_v1(integer)
  from integration_task_dispatch_authority;

revoke all on function public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)
  to integration_task_dispatch_authority;
