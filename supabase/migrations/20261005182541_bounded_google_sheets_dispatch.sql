begin;

-- VXA-034/037: authoritative aggregate admission, fair due selection and an
-- independent expired-run reconciliation path. Existing lease timestamps,
-- outcomes, source versions and facts are preserved. No history is backfilled
-- with guessed eligibility. Apply before the dispatcher code; old claims also
-- use the replaced admission RPC.
alter table public.google_sheets_sync_runs add column eligible_at timestamptz;
comment on column public.google_sheets_sync_runs.eligible_at is
  'Original scheduled eligibility, or manual admission time. Null for historical runs whose eligibility was not recorded.';
create index google_sheets_connections_due_dispatch_idx
  on public.google_sheets_connections(next_sync_at,workspace_id,id)
  where status='connected' and automatic_refresh_enabled and active_approval_id is not null;
create index google_sheets_connections_lease_expiry_idx
  on public.google_sheets_connections(sync_lease_expires_at)
  where sync_lease_expires_at is not null;

create or replace function public.claim_google_sheets_sync_v1(p_workspace_id uuid,p_connection_id uuid,p_actor_id uuid,p_session_id uuid,p_trigger text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.google_sheets_connections; r uuid; v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  perform private.require_google_sheets_eligible_v1(p_workspace_id);
  select * into c from public.google_sheets_connections where workspace_id=p_workspace_id and id=p_connection_id for update;
  if not found then raise exception 'google_sheets_connection_unavailable'; end if;
  if p_trigger='manual' then perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
  elsif p_trigger<>'scheduled' or p_actor_id is not null or p_session_id is not null or not c.automatic_refresh_enabled or c.next_sync_at is null or c.next_sync_at>now() then raise exception 'google_sheets_schedule_denied'; end if;
  if c.status<>'connected' or c.active_approval_id is null then raise exception 'google_sheets_mapping_required'; end if;
  if c.sync_lease_expires_at>clock_timestamp() then raise exception 'google_sheets_sync_busy'; end if;
  if not exists(select 1 from public.workspace_members member join auth.users account on account.id=member.user_id where account.deleted_at is null and (account.banned_until is null or account.banned_until<=clock_timestamp()) and member.workspace_id=c.workspace_id and member.user_id=(select approved_by from public.google_sheets_mapping_approvals where id=c.active_approval_id) and member.status='active' and member.role='owner')
    or not exists(select 1 from public.business_entities where workspace_id=c.workspace_id and id=c.business_entity_id and status='active') then raise exception 'google_sheets_authority_expired'; end if;
  -- Per-workspace locking precedes the aggregate lock: a long commit in one
  -- workspace must not hold global admission while another claimant waits.
  if exists(select 1 from public.google_sheets_connections where workspace_id=p_workspace_id and id<>p_connection_id and sync_lease_expires_at>clock_timestamp()) then
    raise exception 'google_sheets_workspace_busy';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from public.google_sheets_connections where sync_lease_expires_at>v_now)>=4 then
    raise exception 'google_sheets_capacity_busy';
  end if;
  update public.google_sheets_sync_runs set status='failed',error_code='lease_expired',completed_at=now() where workspace_id=p_workspace_id and connection_id=p_connection_id and status='running';
  insert into public.google_sheets_sync_runs(workspace_id,connection_id,initiated_by,trigger_kind,approval_id,eligible_at,started_at)
    values(p_workspace_id,p_connection_id,p_actor_id,p_trigger,c.active_approval_id,case when p_trigger='scheduled' then c.next_sync_at else v_now end,v_now) returning id into r;
  update public.google_sheets_connections set sync_lease_run_id=r,sync_lease_expires_at=v_now+interval '270 seconds',updated_at=v_now where id=c.id;
  return jsonb_build_object('runId',r);
end;
$function$;

create function public.due_google_sheets_syncs_v1(p_tick_at timestamptz,p_limit integer,p_excluded_ids uuid[] default '{}')
returns table(id uuid,workspace_id uuid,next_sync_at timestamptz)
language plpgsql security definer set search_path='' as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  if p_tick_at is null or not isfinite(p_tick_at) or p_tick_at>clock_timestamp()+interval '5 seconds'
    or p_limit is null or p_limit not between 1 and 10 or p_excluded_ids is null or cardinality(p_excluded_ids)>50 then
    raise exception 'google_sheets_dispatch_invalid';
  end if;
  return query
    select candidate.id,candidate.workspace_id,candidate.next_sync_at from (
      select c.id,c.workspace_id,c.next_sync_at,
        row_number() over(partition by c.workspace_id order by c.next_sync_at,c.id) tenant_ordinal
      from public.google_sheets_connections c
      where c.status='connected' and c.automatic_refresh_enabled and c.active_approval_id is not null
        and c.next_sync_at<=p_tick_at and not(c.id=any(p_excluded_ids))
        and (c.sync_lease_expires_at is null or c.sync_lease_expires_at<=clock_timestamp())
    ) candidate order by candidate.tenant_ordinal,candidate.next_sync_at,candidate.id limit p_limit;
end;
$function$;

-- This is terminal failure reconciliation, not a new provider attempt. A failed
-- accepted run remains visible and keeps the existing one-hour retry policy.
-- Run independently at <=15s cadence to leave room for dispatch/DB jitter inside
-- the 300s recovery objective for NEW 270s leases. Existing 480s leases must drain
-- under the rollout hold; this migration never shortens an in-flight lease.
create function public.recover_google_sheets_syncs_v1(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare candidate record; c public.google_sheets_connections; recovered integer:=0; skipped integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'google_sheets_recovery_invalid'; end if;
  for candidate in select id,workspace_id from public.google_sheets_connections
    where sync_lease_expires_at<=clock_timestamp() order by sync_lease_expires_at,id limit p_limit loop
    -- Never queue behind a live commit or hold several tenant locks waiting on
    -- one busy tenant. The next recovery tick can safely reconsider it.
    if not pg_try_advisory_xact_lock(hashtextextended('google_sheets:'||candidate.workspace_id::text,0)) then
      skipped:=skipped+1; continue;
    end if;
    select * into c from public.google_sheets_connections where id=candidate.id and workspace_id=candidate.workspace_id for update skip locked;
    if c.id is null or c.sync_lease_expires_at is null or c.sync_lease_expires_at>clock_timestamp() then continue; end if;
    update public.google_sheets_sync_runs set status='failed',error_code='lease_expired',completed_at=clock_timestamp()
      where workspace_id=c.workspace_id and connection_id=c.id and id=c.sync_lease_run_id and status='running';
    -- Preserve inconsistent historical headers for operator reconciliation.
    if not found then skipped:=skipped+1; continue; end if;
    update public.google_sheets_connections set sync_lease_run_id=null,sync_lease_expires_at=null,last_error_code='lease_expired',
      next_sync_at=case when automatic_refresh_enabled then clock_timestamp()+interval '1 hour' else null end,updated_at=clock_timestamp()
      where workspace_id=c.workspace_id and id=c.id and sync_lease_run_id=c.sync_lease_run_id;
    recovered:=recovered+1;
  end loop;
  return jsonb_build_object('recovered',recovered,'skipped',skipped,
    'remainingExpired',(select count(*) from public.google_sheets_connections where sync_lease_expires_at<=clock_timestamp()),
    'oldestExpiredSeconds',(select coalesce(extract(epoch from(clock_timestamp()-min(sync_lease_expires_at))),0) from public.google_sheets_connections where sync_lease_expires_at<=clock_timestamp()));
end;
$function$;

revoke all on function public.due_google_sheets_syncs_v1(timestamptz,integer,uuid[]),public.recover_google_sheets_syncs_v1(integer) from public,anon,authenticated;
grant execute on function public.due_google_sheets_syncs_v1(timestamptz,integer,uuid[]),public.recover_google_sheets_syncs_v1(integer) to service_role;
commit;
