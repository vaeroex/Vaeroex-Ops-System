begin;

-- CL-07: preserve round-robin tenant order across a bounded dispatch tick.
-- Already selected connections retain their place even after a completed sync
-- advances next_sync_at. No existing connection, lease or history is rewritten.
-- Apply before the 100-attempt dispatcher. Concurrency remains 4 globally and
-- 1 per workspace; claim authority, fencing and work deadlines are unchanged.
create or replace function public.due_google_sheets_syncs_v1(p_tick_at timestamptz,p_limit integer,p_excluded_ids uuid[] default '{}')
returns table(id uuid,workspace_id uuid,next_sync_at timestamptz)
language plpgsql security definer set search_path='' as $function$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'google_sheets_service_denied' using errcode='42501'; end if;
  if p_tick_at is null or not isfinite(p_tick_at) or p_tick_at>clock_timestamp()+interval '5 seconds'
    or p_limit is null or p_limit not between 1 and 10 or p_excluded_ids is null or cardinality(p_excluded_ids)>100 then
    raise exception 'google_sheets_dispatch_invalid';
  end if;
  return query
    with selected as (
      select c.workspace_id,count(*) tenant_selected
      from public.google_sheets_connections c where c.id=any(p_excluded_ids)
      group by c.workspace_id
    )
    select candidate.id,candidate.workspace_id,candidate.next_sync_at from (
      select c.id,c.workspace_id,c.next_sync_at,
        row_number() over(partition by c.workspace_id order by c.next_sync_at,c.id)
          + coalesce(selected.tenant_selected,0) tenant_ordinal
      from public.google_sheets_connections c
      left join selected on selected.workspace_id=c.workspace_id
      where c.status='connected' and c.automatic_refresh_enabled and c.active_approval_id is not null
        and c.next_sync_at<=p_tick_at and not(c.id=any(p_excluded_ids))
        and (c.sync_lease_expires_at is null or c.sync_lease_expires_at<=clock_timestamp())
    ) candidate order by candidate.tenant_ordinal,candidate.next_sync_at,candidate.id limit p_limit;
end;
$function$;
revoke all on function public.due_google_sheets_syncs_v1(timestamptz,integer,uuid[]) from public,anon,authenticated;
grant execute on function public.due_google_sheets_syncs_v1(timestamptz,integer,uuid[]) to service_role;
commit;
