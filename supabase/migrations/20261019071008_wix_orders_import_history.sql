begin;

-- Coverage records a successfully completed provider read, including empty dates.
-- Existing facts are retained without inventing coverage for their former rolling window.
create table public.wix_order_import_days (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  imported_through timestamptz not null,
  imported_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, connection_id, day),
  foreign key (workspace_id, connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade,
  check (imported_through > day::timestamp at time zone 'UTC'
    and imported_through <= (day + 1)::timestamp at time zone 'UTC')
);
alter table public.wix_order_import_days enable row level security;
create policy wix_order_import_days_read on public.wix_order_import_days for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = wix_order_import_days.workspace_id
    and m.user_id = (select auth.uid()) and m.status = 'active'));
revoke all on public.wix_order_import_days from public,anon,authenticated;
grant select on public.wix_order_import_days to authenticated;
grant all on public.wix_order_import_days to service_role;

create or replace function public.apply_wix_order_snapshot(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_window_start timestamptz,p_window_end timestamptz,p_orders jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'wix_service_role_required' using errcode='42501';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) > 5000 or
    p_window_start is null or p_window_end is null or not isfinite(p_window_start) or not isfinite(p_window_end) or
    p_window_start >= p_window_end or p_window_end - p_window_start > interval '366 days' or
    p_window_start < '0001-01-01 UTC'::timestamptz or p_window_end > clock_timestamp() + interval '1 minute' then
    raise exception 'wix_snapshot_invalid';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_orders) as r(order_id uuid,created_at timestamptz,total_amount numeric,
      currency_code text,payment_status text)
    where r.order_id is null or r.created_at is null or not isfinite(r.created_at) or
      r.created_at < p_window_start or r.created_at >= p_window_end or r.total_amount is null or
      r.total_amount < 0 or r.total_amount > 1000000000 or r.total_amount <> round(r.total_amount,2) or
      r.currency_code is null or r.currency_code !~ '^[A-Z]{3}$' or
      r.payment_status is null or char_length(r.payment_status) not between 1 and 40) or
    (select count(*) <> count(distinct r.order_id) from jsonb_to_recordset(p_orders) as r(order_id uuid)) then
    raise exception 'wix_snapshot_invalid';
  end if;
  perform 1 from public.wix_order_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id
    and c.status='connected' and c.sync_lease_id=p_lease_id and c.sync_lease_expires_at > clock_timestamp() for update;
  if not found then raise exception 'wix_sync_lease_invalid'; end if;

  -- Refresh only the successfully fetched period. Upsert by provider ID also corrects
  -- records whose provider date moved into this period, without double-counting them.
  delete from public.wix_order_facts f where f.workspace_id=p_workspace_id and f.connection_id=p_connection_id
    and f.created_at >= p_window_start and f.created_at < p_window_end;
  insert into public.wix_order_facts(workspace_id,connection_id,order_id,created_at,total_amount,currency_code,payment_status)
  select p_workspace_id,p_connection_id,r.order_id,r.created_at,r.total_amount,r.currency_code,r.payment_status
    from jsonb_to_recordset(p_orders) as r(order_id uuid,created_at timestamptz,total_amount numeric,
      currency_code text,payment_status text)
  on conflict (workspace_id,connection_id,order_id) do update set created_at=excluded.created_at,
    total_amount=excluded.total_amount,currency_code=excluded.currency_code,payment_status=excluded.payment_status;
  get diagnostics applied=row_count;

  -- A partial first day from an older client cannot certify the whole date.
  insert into public.wix_order_import_days(workspace_id,connection_id,day,imported_through,imported_at)
  select p_workspace_id,p_connection_id,d::date,least((d + interval '1 day') at time zone 'UTC',p_window_end),clock_timestamp()
    from generate_series(date_trunc('day',p_window_start at time zone 'UTC'),
      date_trunc('day',(p_window_end - interval '1 microsecond') at time zone 'UTC'),interval '1 day') d
    where d at time zone 'UTC' >= p_window_start
  on conflict (workspace_id,connection_id,day) do update set
    imported_through=greatest(public.wix_order_import_days.imported_through,excluded.imported_through),
    imported_at=excluded.imported_at;
  update public.wix_order_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;

-- Aggregate inside PostgreSQL, before the API's row limit. Invoker privileges keep
-- membership RLS in effect for authenticated callers; service callers still scope both IDs.
create function public.wix_order_history_report(p_workspace_id uuid,p_connection_id uuid,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare result jsonb;
begin
  if (p_from is null) <> (p_to is null) or p_from > p_to or
    p_from < '0001-01-01'::date or not isfinite(p_from) or not isfinite(p_to) then
    raise exception 'wix_report_range_invalid';
  end if;
  with totals as (
    select f.currency_code,count(*) as order_count,coalesce(sum(f.total_amount),0) as total_amount,
      count(*) filter (where f.payment_status='PAID') as paid_count
    from public.wix_order_facts f where f.workspace_id=p_workspace_id and f.connection_id=p_connection_id
      and (p_from is null or f.created_at >= p_from::timestamp at time zone 'UTC')
      and (p_to is null or f.created_at < (p_to+1)::timestamp at time zone 'UTC')
    group by f.currency_code
  ), coverage as (
    select d.*,d.imported_through=(d.day+1)::timestamp at time zone 'UTC' as complete,
      d.day - row_number() over (partition by d.imported_through=(d.day+1)::timestamp at time zone 'UTC' order by d.day)::int as group_day
    from public.wix_order_import_days d where d.workspace_id=p_workspace_id and d.connection_id=p_connection_id
      and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
  ), ranges as (
    select min(day) as start_date,max(day) as end_date,max(imported_through) as imported_through,complete
    from coverage group by group_day,complete
  ) select jsonb_build_object(
    'totals',coalesce((select jsonb_agg(to_jsonb(t) order by t.currency_code) from totals t),'[]'::jsonb),
    'coverage',coalesce((select jsonb_agg(to_jsonb(r) order by r.start_date) from ranges r),'[]'::jsonb),
    'covered_days',(select count(*) from coverage),
    'complete_days',(select count(*) from coverage where imported_through=(day+1)::timestamp at time zone 'UTC'),
    'requested_days',case when p_from is not null then p_to-p_from+1 else null end
  ) into result;
  return result;
end $function$;
revoke all on function public.wix_order_history_report(uuid,uuid,date,date) from public,anon;
grant execute on function public.wix_order_history_report(uuid,uuid,date,date) to authenticated,service_role;

create or replace function public.disconnect_wix_order_connection(p_workspace_id uuid,p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'wix_service_role_required' using errcode='42501';
  end if;
  update public.wix_order_connections set status='disconnected',instance_hash=null,site_id=null,
    sync_lease_id=null,sync_lease_expires_at=null,last_sync_at=null,last_error_code=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.wix_order_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.wix_order_facts where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.wix_order_import_days where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.wix_order_install_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_wix_order_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_wix_order_connection(uuid,uuid) to service_role;

commit;
