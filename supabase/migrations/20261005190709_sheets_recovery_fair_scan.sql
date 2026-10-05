begin;

-- Recovery work must not be pinned behind preserved historical mismatches or
-- a tenant whose transaction currently owns its workspace lock. This is only a
-- bounded scan cursor, not authorization or customer/history state.
create table private.google_sheets_recovery_scan_state (
  singleton boolean primary key default true check (singleton),
  last_expiry timestamptz,
  last_connection_id uuid,
  check ((last_expiry is null) = (last_connection_id is null))
);
insert into private.google_sheets_recovery_scan_state(singleton) values (true);
alter table private.google_sheets_recovery_scan_state enable row level security;
revoke all on private.google_sheets_recovery_scan_state from public,anon,authenticated,service_role;

create or replace function public.recover_google_sheets_syncs_v1(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  scan private.google_sheets_recovery_scan_state; candidate record; c public.google_sheets_connections;
  pass integer; examined integer:=0; recovered integer:=0; skipped integer:=0;
  remaining_expired bigint; historical_mismatches bigint; oldest_seconds numeric;
  v_last_expiry timestamptz; last_id uuid; scan_owned boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'google_sheets_recovery_invalid'; end if;
  -- Concurrent recovery invocations never queue or inspect the same page.
  select * into scan from private.google_sheets_recovery_scan_state where singleton for update skip locked;
  scan_owned:=found;
  if scan_owned then
    -- Visit at most p_limit candidates total, optionally wrapping once. A page
    -- advances even when a workspace lock is busy; there is no fixed-prefix
    -- starvation. Row locks are skipped before LIMIT, with no waiting behind
    -- a connection mutation. No more than p_limit row locks are retained.
    for pass in 1..2 loop
      for candidate in
        select connection.id,connection.workspace_id,connection.sync_lease_expires_at
        from public.google_sheets_connections connection
        where connection.sync_lease_expires_at<=clock_timestamp()
          and exists(select 1 from public.google_sheets_sync_runs run
            where run.workspace_id=connection.workspace_id and run.connection_id=connection.id
              and run.id=connection.sync_lease_run_id and run.status='running')
          and case when pass=1 then scan.last_expiry is null
            or (connection.sync_lease_expires_at,connection.id)>(scan.last_expiry,scan.last_connection_id)
            else scan.last_expiry is not null
            and (connection.sync_lease_expires_at,connection.id)<=(scan.last_expiry,scan.last_connection_id) end
        order by connection.sync_lease_expires_at,connection.id
        limit (p_limit-examined) for update of connection skip locked
      loop
        examined:=examined+1; v_last_expiry:=candidate.sync_lease_expires_at; last_id:=candidate.id;
        if not pg_try_advisory_xact_lock(hashtextextended('google_sheets:'||candidate.workspace_id::text,0)) then
          skipped:=skipped+1; continue;
        end if;
        select * into c from public.google_sheets_connections
          where id=candidate.id and workspace_id=candidate.workspace_id;
        if c.sync_lease_expires_at is null or c.sync_lease_expires_at>clock_timestamp() then continue; end if;
        update public.google_sheets_sync_runs set status='failed',error_code='lease_expired',completed_at=clock_timestamp()
          where workspace_id=c.workspace_id and connection_id=c.id and id=c.sync_lease_run_id and status='running';
        if not found then skipped:=skipped+1; continue; end if;
        update public.google_sheets_connections set sync_lease_run_id=null,sync_lease_expires_at=null,last_error_code='lease_expired',
          next_sync_at=case when automatic_refresh_enabled then clock_timestamp()+interval '1 hour' else null end,updated_at=clock_timestamp()
          where workspace_id=c.workspace_id and id=c.id and sync_lease_run_id=c.sync_lease_run_id;
        recovered:=recovered+1;
      end loop;
      exit when examined>=p_limit or scan.last_expiry is null;
    end loop;
    update private.google_sheets_recovery_scan_state set last_expiry=v_last_expiry,last_connection_id=last_id where singleton;
  end if;
  -- Historical contradictions remain untouched and remain operator-visible.
  -- They do not consume the work page. Existing API fields are retained; SQL
  -- callers also receive the precise mismatch/scan counts for reconciliation.
  select count(*),count(*) filter(where run.id is null),
    coalesce(extract(epoch from(clock_timestamp()-min(connection.sync_lease_expires_at))),0)
    into remaining_expired,historical_mismatches,oldest_seconds
    from public.google_sheets_connections connection
    left join public.google_sheets_sync_runs run on run.workspace_id=connection.workspace_id
      and run.connection_id=connection.id and run.id=connection.sync_lease_run_id and run.status='running'
    where connection.sync_lease_expires_at<=clock_timestamp();
  return jsonb_build_object('recovered',recovered,'skipped',skipped+historical_mismatches,
    'remainingExpired',remaining_expired,'oldestExpiredSeconds',oldest_seconds,
    'historicalMismatches',historical_mismatches,'examined',examined,'scanBusy',not scan_owned);
end;
$function$;
revoke all on function public.recover_google_sheets_syncs_v1(integer) from public,anon,authenticated;
grant execute on function public.recover_google_sheets_syncs_v1(integer) to service_role;
commit;
