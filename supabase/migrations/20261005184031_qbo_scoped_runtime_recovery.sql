begin;

-- Reconcile only attributed production QBO work. The generic runtime sweeper
-- spans providers and must not be called by this provider-specific dispatcher.
create or replace function public.recover_qbo_runtime_tasks_v1(
  p_queue_class text,
  p_limit integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_task private.integration_sync_tasks;
  v_original_state text;
  v_target_state text;
  v_fingerprint bytea;
  v_recovered integer := 0;
  v_ready integer := 0;
  v_dead integer := 0;
  v_cancelled integer := 0;
begin
  perform private.assert_phase_6_authority_v1('integration_task_dispatch_authority');
  if p_queue_class is null or p_queue_class not in ('provider_interactive', 'provider_bulk')
    or p_limit is null or p_limit not between 1 and 100
    or not coalesce(private.is_bounded_identifier_v1(p_request_id), false) then
    raise exception using errcode = '22023', message = 'qbo_runtime_recovery_invalid';
  end if;
  v_fingerprint := private.phase_6_request_fingerprint_v1(p_request_id,
    pg_catalog.jsonb_build_object('queueClass', p_queue_class, 'limit', p_limit));

  for v_task in
    with eligible as (
      select task.id, task.workspace_id, task.connection_id,
        pg_catalog.row_number() over (
          partition by task.workspace_id, task.connection_id
          order by task.available_at, task.created_at, task.id
        ) as connection_ordinal
      from private.integration_sync_tasks as task
      join private.integration_connections as connection
        on connection.workspace_id = task.workspace_id
        and connection.business_entity_id = task.business_entity_id
        and connection.id = task.connection_id
        and connection.connection_generation = task.connection_generation
        and connection.provider_key = task.provider_key
        and connection.provider_environment = task.provider_environment
      join private.integration_sync_runs as run
        on run.workspace_id = task.workspace_id
        and run.business_entity_id = task.business_entity_id
        and run.connection_id = task.connection_id
        and run.id = task.sync_run_id
        and run.connection_generation = task.connection_generation
      where task.provider_key = 'quickbooks_online'
        and task.provider_environment = 'production'
        and task.queue_class = p_queue_class
        and exists (select 1 from private.integration_qbo_runtime_configurations as configuration
          where configuration.provider_environment = 'production'
            and configuration.deployment_tier = 'production' and configuration.enabled)
        and exists (select 1 from private.integration_workspace_policies as policy
          where policy.workspace_id = task.workspace_id and policy.provider_key = task.provider_key
            and policy.provider_environment = task.provider_environment
            and policy.state = 'enabled' and policy.sync_enabled)
        and connection.status in ('initializing', 'active', 'degraded')
        and connection.disconnected_at is null and connection.deleted_at is null
        and run.state in ('created', 'running')
        and task.delivery_attribution_state <> 'legacy_unattributed'
        and task.state in ('pending', 'dispatched', 'leased', 'retry_wait')
        and (
          task.retention_expires_at <= v_now
          or (task.state = 'leased' and task.lease_expires_at <= v_now)
          or (task.state = 'retry_wait' and task.available_at <= v_now)
        )
    )
    select task.* from eligible
    join private.integration_sync_tasks as task on task.id = eligible.id
    order by eligible.connection_ordinal, task.available_at,
      eligible.workspace_id, eligible.connection_id, task.id
    for update of task skip locked
    limit p_limit
  loop
    -- Recheck after row locking. A concurrent completion/renewal or recovery
    -- must not be overwritten using the earlier discovery snapshot.
    if v_task.state not in ('pending', 'dispatched', 'leased', 'retry_wait')
      or not (
        v_task.retention_expires_at <= v_now
        or (v_task.state = 'leased' and v_task.lease_expires_at <= v_now)
        or (v_task.state = 'retry_wait' and v_task.available_at <= v_now)
      ) then continue; end if;
    v_original_state := v_task.state;
    if v_task.retention_expires_at <= v_now then
      v_target_state := 'cancelled';
    elsif v_task.attempt_count >= v_task.maximum_attempts then
      v_target_state := 'dead_letter';
    elsif v_task.state = 'leased' then
      v_target_state := 'retry_wait';
    else
      v_target_state := 'pending';
    end if;

    update private.integration_sync_tasks as task set
      state = v_target_state,
      dispatcher_task_name = null,
      lease_id = null, lease_owner_fingerprint = null,
      lease_expires_at = null, heartbeat_at = null,
      cancel_requested_at = case when v_target_state = 'cancelled' then v_now else task.cancel_requested_at end,
      failure_category = case when v_target_state = 'cancelled' then 'cancelled'
        when v_original_state = 'leased' then 'timeout'
        when v_target_state = 'dead_letter' then coalesce(task.failure_category, 'unknown') else null end,
      failure_code = case when v_target_state = 'cancelled' then 'runtime_retention_expired'
        when v_original_state = 'leased' then 'runtime_lease_expired'
        when v_target_state = 'dead_letter' then coalesce(task.failure_code, 'runtime_attempts_exhausted') else null end,
      completed_at = case when v_target_state in ('cancelled', 'dead_letter') then v_now else null end,
      last_request_id = p_request_id, last_request_fingerprint = v_fingerprint,
      row_version = task.row_version + 1, updated_at = v_now
    where task.id = v_task.id returning task.* into v_task;
    perform private.phase_6_insert_audit_v1(
      v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
      'qbo_task_dispatcher', 'integration_sync_task.recover',
      case when v_target_state = 'dead_letter' then 'failed' else 'succeeded' end,
      'integration_sync_task', v_task.id::text, p_request_id,
      pg_catalog.jsonb_build_object('task_state', v_task.state, 'task_kind', v_task.task_kind,
        'queue_class', v_task.queue_class, 'attempt_count', v_task.attempt_count,
        'dispatch_generation', v_task.dispatch_generation, 'row_version', v_task.row_version, 'idempotent', false));

    -- Preserve the existing leased -> retry_wait -> pending state machine and
    -- both audit events, but do not require another scheduler tick to be ready.
    if v_target_state = 'retry_wait' then
      update private.integration_sync_tasks as task set
        state = 'pending', failure_category = null, failure_code = null,
        row_version = task.row_version + 1, updated_at = v_now
      where task.id = v_task.id returning task.* into v_task;
      perform private.phase_6_insert_audit_v1(
        v_task.workspace_id, v_task.business_entity_id, v_task.connection_id,
        'qbo_task_dispatcher', 'integration_sync_task.recover', 'succeeded',
        'integration_sync_task', v_task.id::text, p_request_id,
        pg_catalog.jsonb_build_object('task_state', v_task.state, 'task_kind', v_task.task_kind,
          'queue_class', v_task.queue_class, 'attempt_count', v_task.attempt_count,
          'dispatch_generation', v_task.dispatch_generation, 'row_version', v_task.row_version, 'idempotent', false));
    end if;
    -- available_at/created_at, source identities, checkpoints and attempts are
    -- unchanged: neither the original queue age nor failed attempts disappear.
    v_recovered := v_recovered + 1;
    if v_task.state = 'pending' then v_ready := v_ready + 1;
    elsif v_task.state = 'dead_letter' then v_dead := v_dead + 1;
    elsif v_task.state = 'cancelled' then v_cancelled := v_cancelled + 1; end if;
  end loop;
  return pg_catalog.jsonb_build_object('recoveredCount', v_recovered, 'readyCount', v_ready,
    'deadLetterCount', v_dead, 'cancelledCount', v_cancelled);
end;
$function$;

revoke all on function public.recover_qbo_runtime_tasks_v1(text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.recover_qbo_runtime_tasks_v1(text, integer, text)
  to integration_task_dispatch_authority;

commit;
