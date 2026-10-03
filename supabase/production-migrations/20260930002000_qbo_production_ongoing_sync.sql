-- Draft: native QBO scheduling only. No credentials, roles, configuration or
-- dispatch gates are provisioned or enabled by this migration.
begin;

-- Fair, bounded candidate selection, including tenants that cannot currently
-- produce work. This is control metadata only, never a provider checkpoint.
create table private.qbo_production_scheduler_visits (
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation>0),
  checked_at timestamptz not null,
  primary key (workspace_id,business_entity_id,connection_id,connection_generation),
  foreign key (workspace_id,business_entity_id,connection_id)
    references private.integration_connections(workspace_id,business_entity_id,id) on delete cascade
);
alter table private.qbo_production_scheduler_visits enable row level security;
alter table private.qbo_production_scheduler_visits force row level security;
revoke all on private.qbo_production_scheduler_visits from public,anon,authenticated,service_role;

-- Continuations replace a completed parent in the same transaction. The index
-- also fences concurrent initialization/manual/scheduled work for one stream.
create unique index qbo_production_one_active_stream
  on private.integration_sync_tasks(workspace_id,business_entity_id,connection_id,connection_generation,stream_key)
  where provider_key='quickbooks_online' and provider_environment='production'
    and queue_class in ('provider_interactive','provider_bulk')
    and state in ('pending','dispatched','leased','retry_wait');

create function private.settle_qbo_production_runs_v1(p_request_id text)
returns integer language plpgsql volatile security definer set search_path=''
as $function$
declare r private.integration_sync_runs; outcome text; total bigint; succeeded bigint; cancelled bigint; settled integer:=0;
begin
  -- A later scheduler tick sees parent completion and continuation insertion
  -- atomically. Never finalize a run in an AFTER UPDATE trigger on its parent.
  for r in
    select run.* from private.integration_sync_runs run
    join private.integration_connections c on c.id=run.connection_id
      and c.workspace_id=run.workspace_id and c.business_entity_id=run.business_entity_id
    where c.provider_key='quickbooks_online' and c.provider_environment='production'
      and run.state='running'
      and run.policy_version in ('qbo_historical_sync_policy_v1','qbo_ongoing_sync_policy_v1')
      and exists(select from private.integration_sync_tasks t where t.sync_run_id=run.id)
      and not exists(select from private.integration_sync_tasks t where t.sync_run_id=run.id
        and t.state in ('pending','dispatched','leased','retry_wait'))
    order by run.created_at,run.id limit 100 for update of run skip locked
  loop
    select count(*),count(*) filter(where state='succeeded'),count(*) filter(where state='cancelled')
      into total,succeeded,cancelled from private.integration_sync_tasks
      where sync_run_id=r.id and workspace_id=r.workspace_id and business_entity_id=r.business_entity_id
        and connection_id=r.connection_id and connection_generation=r.connection_generation;
    if total=0 or exists(select from private.integration_sync_tasks where sync_run_id=r.id
      and state in ('pending','dispatched','leased','retry_wait')) then continue; end if;
    outcome:=case when succeeded=total then 'succeeded' when cancelled=total then 'cancelled'
      when succeeded>0 then 'partially_succeeded' else 'failed' end;
    update private.integration_sync_runs set state=outcome,finished_at=clock_timestamp(),
      error_category=case when outcome='failed' then 'data' else null end,
      error_code=case when outcome='failed' then 'qbo_run_tasks_failed' else null end,
      row_version=row_version+1,updated_at=clock_timestamp(),last_transition_request_id=p_request_id,
      last_transition_request_fingerprint=private.phase_4_request_fingerprint_v1(p_request_id,
        jsonb_build_object('syncRunId',r.id,'state',outcome)) where id=r.id;
    perform private.phase_6_insert_audit_v1(r.workspace_id,r.business_entity_id,r.connection_id,
      'qbo_ongoing_scheduler','integration_sync_run.transition',
      case when outcome='failed' then 'failed' else 'succeeded' end,'integration_sync_run',r.id::text,p_request_id,
      jsonb_build_object('sync_run_state',outcome,'connection_generation',r.connection_generation,
        'row_version',r.row_version+1,'idempotent',false));
    settled:=settled+1;
  end loop;
  -- Hints are acknowledged as covered only by a successful CDC task. Failed
  -- hints retain their lineage as dead letters; fallback uses the old checkpoint.
  update private.integration_webhook_events e set
    processing_state=case when t.state='succeeded' then 'processed' else 'dead_letter' end,
    failure_category=case when t.state='succeeded' then null else 'data_anomaly' end,
    failure_code=case when t.state='succeeded' then null else 'qbo_webhook_task_failed' end,
    processed_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=e.row_version+1,
    last_request_id=p_request_id,last_request_fingerprint=private.phase_6_request_fingerprint_v1(p_request_id,
      jsonb_build_object('eventId',e.id,'taskId',t.id,'taskState',t.state))
  from private.integration_sync_tasks t
  where e.id in (select event.id from private.integration_webhook_events event
    join private.integration_sync_tasks task on task.id=event.resulting_task_id
    where event.provider_key='quickbooks_online' and event.provider_environment='production'
      and event.processing_state='coalesced' and task.state in ('succeeded','failed','dead_letter','cancelled')
    order by event.received_at,event.id limit 2000 for update of event skip locked)
    and e.resulting_task_id=t.id and e.workspace_id=t.workspace_id and e.business_entity_id=t.business_entity_id
    and e.connection_id=t.connection_id and e.connection_generation=t.connection_generation;
  return settled;
end;
$function$;
revoke all on function private.settle_qbo_production_runs_v1(text) from public,anon,authenticated,service_role;

create function private.schedule_qbo_production_streams_v1(p_limit integer,p_request_id text,p_initial boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare c private.integration_connections; scope record; cp private.integration_sync_checkpoints;
declare stream text; streams text[]; run_id uuid; task_id uuid; checkpoint_id uuid; last_task private.integration_sync_tasks;
declare t timestamptz:=transaction_timestamp(); start_at timestamptz; history_start timestamptz; initial_watermark timestamptz;
declare due_after interval; credential_count integer; count_tasks integer; count_connections integer:=0;
declare total_tasks integer:=0; blocked_cdc integer:=0; settled integer:=0; hints uuid[]; hint_count integer;
declare runs jsonb:='[]'::jsonb; metadata jsonb; initial_completed_at timestamptz;
begin
  if not pg_has_role(session_user,'integration_task_scheduler_authority','MEMBER') then
    raise exception 'qbo_production_scheduler_denied' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 0 and 25 or p_initial is null
    or p_request_id is null or not private.is_bounded_identifier_v1(p_request_id) then
    raise exception 'qbo_production_scheduler_invalid' using errcode='22023'; end if;
  if not p_initial then settled:=private.settle_qbo_production_runs_v1(p_request_id); end if;
  streams:=case when p_initial then array[
    'company_info','preferences','accounts','customers_minimized','vendors_minimized','items_minimized',
    'qbo_bill','qbo_billpayment','qbo_creditmemo','qbo_deposit','qbo_invoice','qbo_journalentry',
    'qbo_payment','qbo_purchase','qbo_refundreceipt','qbo_salesreceipt','qbo_transfer','qbo_vendorcredit',
    'qbo_apagingsummary','qbo_aragingsummary','qbo_balancesheet','qbo_cashflow','qbo_profitandloss','qbo_trialbalance'
  ] else array[
    'qbo_cdc','company_info','preferences','accounts','customers_minimized','vendors_minimized','items_minimized',
    'qbo_apagingsummary','qbo_aragingsummary','qbo_balancesheet','qbo_cashflow','qbo_profitandloss','qbo_trialbalance'
  ] end;
  -- Serialize schedulers on the connection and rotate even blocked candidates.
  for c in select connection.* from private.integration_connections connection
    where connection.provider_key='quickbooks_online' and connection.provider_environment='production'
      and connection.disconnected_at is null and connection.deleted_at is null
      and ((p_initial and connection.status='initializing' and connection.state_reason_code='initial_sync_pending'
        and not exists(select from private.integration_sync_runs r where r.connection_id=connection.id
          and r.connection_generation=connection.connection_generation and r.mode='initialization')
        and not exists(select from private.integration_sync_tasks task where task.connection_id=connection.id
          and task.connection_generation=connection.connection_generation
          and task.state in ('pending','dispatched','leased','retry_wait')))
        or (not p_initial and connection.status in ('initializing','active','degraded')
          and exists(select from private.integration_sync_runs r where r.connection_id=connection.id
            and r.connection_generation=connection.connection_generation and r.mode='initialization' and r.state='succeeded')))
    order by (select visit.checked_at from private.qbo_production_scheduler_visits visit
      where visit.workspace_id=connection.workspace_id and visit.business_entity_id=connection.business_entity_id
        and visit.connection_id=connection.id and visit.connection_generation=connection.connection_generation) nulls first,
      connection.id
    limit p_limit for update of connection skip locked
  loop
    insert into private.qbo_production_scheduler_visits values(c.workspace_id,c.business_entity_id,c.id,c.connection_generation,clock_timestamp())
      on conflict(workspace_id,business_entity_id,connection_id,connection_generation)
      do update set checked_at=excluded.checked_at;
    -- Lock and recheck mutable authority after taking the connection lock.
    select mapping.id as mapping_id,policy.history_horizon_days into scope
      from private.provider_entity_mappings mapping
      join private.integration_workspace_policies policy on policy.workspace_id=mapping.workspace_id
        and policy.provider_key=mapping.provider_key and policy.provider_environment=mapping.provider_environment
      join private.integration_qbo_runtime_configurations cfg on cfg.provider_environment=mapping.provider_environment
      where mapping.connection_id=c.id and mapping.workspace_id=c.workspace_id and mapping.business_entity_id=c.business_entity_id
        and mapping.provider_key=c.provider_key and mapping.provider_environment=c.provider_environment
        and mapping.provider_entity_reference_fingerprint=c.provider_tenant_reference_fingerprint and mapping.status='active'
        and policy.state='enabled' and policy.sync_enabled
        and policy.freshness_policy_version='qbo_control_plane_freshness_policy_v1'
        and policy.retention_policy_version='qbo_metadata_retention_v1'
        and cfg.deployment_tier='production' and cfg.configuration_version=c.configuration_version and cfg.enabled
      for share of mapping,policy,cfg;
    if not found then continue; end if;
    select count(*) into credential_count from (
      select credential.id from private.integration_credentials credential
      where credential.workspace_id=c.workspace_id and credential.business_entity_id=c.business_entity_id
        and credential.connection_id=c.id and credential.connection_generation=c.connection_generation
        and credential.provider_key=c.provider_key and credential.provider_environment=c.provider_environment
        and credential.status='active' and credential.credential_ciphertext is not null
        and credential.external_entity_reference_fingerprint=c.provider_tenant_reference_fingerprint
        and credential.granted_scopes=array['com.intuit.quickbooks.accounting']::text[]
        and (credential.refresh_expires_at is null or credential.refresh_expires_at>t)
      for share
    ) credentials;
    if credential_count<>1 then continue; end if;
    select r.window_end_at,r.finished_at into initial_watermark,initial_completed_at
      from private.integration_sync_runs r where r.connection_id=c.id and r.workspace_id=c.workspace_id
        and r.business_entity_id=c.business_entity_id and r.connection_generation=c.connection_generation
        and r.mapping_id=scope.mapping_id and r.mode='initialization' and r.state='succeeded'
      order by r.finished_at desc,r.id limit 1;
    if not p_initial and initial_watermark is null then continue; end if;
    history_start:=t-scope.history_horizon_days*interval '1 day';
    run_id:=null; count_tasks:=0;
    foreach stream in array streams loop
      if exists(select from private.integration_sync_tasks task where task.workspace_id=c.workspace_id
        and task.business_entity_id=c.business_entity_id and task.connection_id=c.id
        and task.connection_generation=c.connection_generation and task.stream_key=stream
        and task.state in ('pending','dispatched','leased','retry_wait')) then continue; end if;
      select * into cp from private.integration_sync_checkpoints checkpoint
        where checkpoint.workspace_id=c.workspace_id and checkpoint.business_entity_id=c.business_entity_id
          and checkpoint.connection_id=c.id and checkpoint.connection_generation=c.connection_generation
          and checkpoint.mapping_id=scope.mapping_id and checkpoint.stream_key=stream and checkpoint.checkpoint_kind='cursor';
      if cp.id is not null and cp.lifecycle<>'active' then continue; end if;
      select task.* into last_task from private.integration_sync_tasks task
        where task.workspace_id=c.workspace_id and task.business_entity_id=c.business_entity_id
          and task.connection_id=c.id and task.connection_generation=c.connection_generation and task.stream_key=stream
        order by task.created_at desc,task.id desc limit 1;
      hints:=array[]::uuid[]; hint_count:=0;
      if not p_initial and stream='qbo_cdc' then
        start_at:=coalesce(cp.provider_watermark_at,initial_watermark);
        -- A failed capped/gapped read needs explicit reconciliation. Do not
        -- repeatedly create the same impossible read or advance its watermark.
        if last_task.failure_code in ('qbo_cdc_lookback_gap','qbo_cdc_single_entity_cap')
          and last_task.updated_at>=coalesce(cp.updated_at,initial_completed_at) then
          blocked_cdc:=blocked_cdc+1; continue;
        end if;
        select coalesce(array_agg(event.id),array[]::uuid[]) into hints from (
          select e.id from private.integration_webhook_events e
          where e.workspace_id=c.workspace_id and e.business_entity_id=c.business_entity_id
            and e.connection_id=c.id and e.connection_generation=c.connection_generation and e.mapping_id=scope.mapping_id
            and e.provider_key=c.provider_key and e.provider_environment=c.provider_environment
            and e.verification_state='verified' and e.processing_state='pending' and e.received_at<=t
          order by e.received_at,e.id limit 1000 for update skip locked
        ) event;
        hint_count:=cardinality(hints);
      else start_at:=history_start;
      end if;
      due_after:=case when stream='qbo_cdc' then interval '15 minutes'
        when stream in ('company_info','preferences','accounts','customers_minimized','vendors_minimized','items_minimized')
          then interval '6 hours' else interval '1 hour' end;
      if not p_initial and hint_count=0 and
        coalesce(last_task.completed_at,last_task.created_at,initial_completed_at)+due_after>t then continue; end if;
      if private.qbo_provider_endpoint_binding_v1(stream) is null then
        raise exception 'qbo_scheduler_stream_contract_missing' using errcode='55000'; end if;
      if run_id is null then
        run_id:=gen_random_uuid();
        insert into private.integration_sync_runs(id,contract_version,workspace_id,business_entity_id,connection_id,mapping_id,
          connection_generation,trigger_kind,mode,state,idempotency_fingerprint,window_start_at,window_end_at,
          provider_contract_version,adapter_version,policy_version,last_transition_request_id,last_transition_request_fingerprint,
          created_at,started_at,updated_at)
        values(run_id,'integration_sync_run_v1',c.workspace_id,c.business_entity_id,c.id,scope.mapping_id,c.connection_generation,
          case when p_initial then 'provider_initialization' else 'recovery' end,
          case when p_initial then 'initialization' else 'incremental' end,'running',
          extensions.digest(convert_to('qbo_scheduled_run_v1:'||run_id::text,'UTF8'),'sha256'),least(history_start,start_at),t,
          'provider_adapter_v1',c.adapter_version,
          case when p_initial then 'qbo_historical_sync_policy_v1' else 'qbo_ongoing_sync_policy_v1' end,p_request_id,
          private.phase_4_request_fingerprint_v1(p_request_id,jsonb_build_object('syncRunId',run_id)),t,t,t);
        perform private.phase_6_insert_audit_v1(c.workspace_id,c.business_entity_id,c.id,'qbo_ongoing_scheduler',
          'integration_sync_run.create','succeeded','integration_sync_run',run_id::text,p_request_id,
          jsonb_build_object('sync_run_state','running','connection_generation',c.connection_generation,'row_version',1,'idempotent',false));
      end if;
      task_id:=gen_random_uuid(); checkpoint_id:=coalesce(cp.id,gen_random_uuid());
      metadata:=jsonb_build_object('checkpointId',checkpoint_id,'mappingId',scope.mapping_id,'eventId',null,
        'pageOrdinal',0,'cursorVersion',coalesce(cp.checkpoint_version,0),'windowStartAt',start_at,'windowEndAt',t,
        'reasonCode',case when p_initial then 'qbo_production_initialization' when hint_count>0 then 'qbo_ongoing_webhook' else 'qbo_ongoing_fallback' end,
        'recordHintCount',hint_count,'coalescedEventCount',greatest(1,hint_count));
      insert into private.integration_sync_tasks(id,contract_version,workspace_id,business_entity_id,connection_id,connection_generation,
        sync_run_id,parent_task_id,provider_key,provider_environment,queue_class,task_kind,stream_key,state,priority,control_metadata,
        idempotency_fingerprint,coalescing_fingerprint,maximum_attempts,available_at,last_request_id,last_request_fingerprint,
        created_at,updated_at,retention_expires_at)
      values(task_id,'integration_sync_task_v1',c.workspace_id,c.business_entity_id,c.id,c.connection_generation,run_id,null,
        c.provider_key,c.provider_environment,case when stream='qbo_cdc' then 'provider_interactive' else 'provider_bulk' end,
        case when p_initial then 'initial_historical' else 'incremental' end,stream,'pending',50,metadata,
        extensions.digest(convert_to('qbo_scheduled_task_v1:'||run_id::text||':'||stream,'UTF8'),'sha256'),
        extensions.digest(convert_to('qbo_production_stream_v1:'||c.id::text||':'||c.connection_generation::text||':'||stream,'UTF8'),'sha256'),
        8,t,p_request_id,private.phase_6_request_fingerprint_v1(p_request_id,jsonb_build_object('taskId',task_id,'controlMetadata',metadata)),
        t,t,t+interval '90 days');
      perform private.phase_6_insert_audit_v1(c.workspace_id,c.business_entity_id,c.id,'qbo_ongoing_scheduler',
        'integration_sync_task.create','succeeded','integration_sync_task',task_id::text,p_request_id,
        jsonb_build_object('task_state','pending','task_kind',case when p_initial then 'initial_historical' else 'incremental' end,
          'queue_class',case when stream='qbo_cdc' then 'provider_interactive' else 'provider_bulk' end,
          'attempt_count',0,'dispatch_generation',0,'row_version',1,'idempotent',false));
      if hint_count>0 then
        update private.integration_webhook_events set processing_state='coalesced',resulting_task_id=task_id,resulting_sync_run_id=run_id,
          updated_at=t,row_version=row_version+1,last_request_id=p_request_id,
          last_request_fingerprint=private.phase_6_request_fingerprint_v1(p_request_id,jsonb_build_object('taskId',task_id))
          where id=any(hints);
      end if;
      count_tasks:=count_tasks+1;
    end loop;
    if p_initial and count_tasks<>24 then raise exception 'qbo_initialization_task_set_incomplete' using errcode='55000'; end if;
    if count_tasks>0 then
      count_connections:=count_connections+1; total_tasks:=total_tasks+count_tasks;
      runs:=runs||jsonb_build_array(jsonb_build_object('workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,
        'connectionId',c.id,'connectionGeneration',c.connection_generation,'syncRunId',run_id,'taskCount',count_tasks));
    end if;
  end loop;
  return jsonb_build_object('scheduledConnectionCount',count_connections,'scheduledTaskCount',total_tasks,
    'runs',runs,'settledRunCount',settled,'blockedCdcCount',blocked_cdc);
end;
$function$;
revoke all on function private.schedule_qbo_production_streams_v1(integer,text,boolean) from public,anon,authenticated,service_role;

create or replace function public.schedule_qbo_initialization_v2(p_limit integer,p_request_id text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'qbo_initialization_scheduler_invalid' using errcode='22023'; end if;
  return private.schedule_qbo_production_streams_v1(p_limit,p_request_id,true)-'settledRunCount'-'blockedCdcCount';
end;
$function$;

create function public.schedule_qbo_ongoing_v1(p_limit integer,p_request_id text)
returns jsonb language sql volatile security definer set search_path=''
as $function$
  select private.schedule_qbo_production_streams_v1(p_limit,p_request_id,false);
$function$;
revoke all on function public.schedule_qbo_initialization_v2(integer,text),public.schedule_qbo_ongoing_v1(integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.schedule_qbo_initialization_v2(integer,text),public.schedule_qbo_ongoing_v1(integer,text)
  to integration_task_scheduler_authority;
commit;
