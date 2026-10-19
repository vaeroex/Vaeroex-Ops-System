begin;

-- Old imports did not retain the server creation timestamp. Preserve these
-- facts, but do not invent creation-date coverage from receipt_date.
alter table public.loyverse_receipt_facts add column created_at timestamptz;
create index loyverse_receipt_facts_created_period_idx
  on public.loyverse_receipt_facts(workspace_id, connection_id, created_at);

create table public.loyverse_import_days (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  covered_through timestamptz not null,
  imported_at timestamptz not null default now(),
  primary key (workspace_id, connection_id, day),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade,
  check (covered_through > day::timestamp at time zone 'UTC'
    and covered_through <= (day + 1)::timestamp at time zone 'UTC')
);
alter table public.loyverse_import_days enable row level security;
create policy loyverse_import_days_read on public.loyverse_import_days for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = loyverse_import_days.workspace_id
    and m.user_id = (select auth.uid()) and m.status = 'active'));
revoke all on public.loyverse_import_days from public, anon, authenticated;
grant select on public.loyverse_import_days to authenticated;
grant all on public.loyverse_import_days to service_role;

create or replace function public.apply_loyverse_receipts(p_workspace_id uuid, p_connection_id uuid, p_lease_id uuid,
  p_window_start timestamptz, p_window_end timestamptz, p_receipts jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) > 5000 or
    p_window_start is null or p_window_end is null or not isfinite(p_window_start) or not isfinite(p_window_end) or
    p_window_start >= p_window_end or p_window_start < '0001-01-01T00:00:00Z'::timestamptz or
    p_window_start <> date_trunc('day', p_window_start at time zone 'UTC') at time zone 'UTC' or
    p_window_end - p_window_start > interval '366 days' or p_window_end > clock_timestamp() + interval '1 minute' or
    (p_window_end <> date_trunc('day', p_window_end at time zone 'UTC') at time zone 'UTC'
      and (p_window_end at time zone 'UTC')::date <> (clock_timestamp() at time zone 'UTC')::date) then
    raise exception 'loyverse_snapshot_invalid';
  end if;
  perform 1 from public.loyverse_connections c where c.workspace_id = p_workspace_id and c.id = p_connection_id
    and c.status = 'connected' and c.sync_lease_id = p_lease_id and c.sync_lease_expires_at > clock_timestamp() for update;
  if not found then raise exception 'loyverse_sync_lease_invalid'; end if;
  if exists (select 1 from jsonb_to_recordset(p_receipts) as r(receipt_number text, created_at timestamptz)
    where r.receipt_number is null or r.created_at is null or not isfinite(r.created_at)
      or r.created_at < p_window_start or r.created_at >= p_window_end) or
    exists (select 1 from jsonb_to_recordset(p_receipts) as r(receipt_number text)
      group by r.receipt_number having count(*) > 1) then
    raise exception 'loyverse_snapshot_invalid';
  end if;

  -- Only replace the completely fetched creation-time interval. Unknown legacy
  -- timestamps survive until the same provider receipt is re-imported.
  delete from public.loyverse_receipt_facts f where f.workspace_id = p_workspace_id and f.connection_id = p_connection_id
    and f.created_at >= p_window_start and f.created_at < p_window_end;
  insert into public.loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled)
  select p_workspace_id,p_connection_id,r.receipt_number,r.store_id,r.receipt_date,r.created_at,r.updated_at,r.receipt_type,
    r.total_money,r.total_tax,r.total_discount,r.cancelled
  from jsonb_to_recordset(p_receipts) as r(receipt_number text,store_id text,receipt_date timestamptz,created_at timestamptz,
    updated_at timestamptz,receipt_type text,total_money numeric,total_tax numeric,total_discount numeric,cancelled boolean)
  on conflict (workspace_id,connection_id,receipt_number) do update set store_id=excluded.store_id,
    receipt_date=excluded.receipt_date,created_at=excluded.created_at,updated_at=excluded.updated_at,receipt_type=excluded.receipt_type,
    total_money=excluded.total_money,total_tax=excluded.total_tax,total_discount=excluded.total_discount,cancelled=excluded.cancelled;
  get diagnostics applied = row_count;
  insert into public.loyverse_import_days(workspace_id,connection_id,day,covered_through,imported_at)
  select p_workspace_id,p_connection_id,d::date,
    least((d::date + 1)::timestamp at time zone 'UTC',p_window_end),clock_timestamp()
  from generate_series((p_window_start at time zone 'UTC')::date,
    ((p_window_end - interval '1 microsecond') at time zone 'UTC')::date,interval '1 day') d
  on conflict (workspace_id,connection_id,day) do update set
    covered_through=greatest(loyverse_import_days.covered_through,excluded.covered_through),imported_at=excluded.imported_at;
  update public.loyverse_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;

-- Aggregate inside Postgres: REST row limits must not truncate a long history.
create function public.loyverse_saved_report(p_workspace_id uuid,p_connection_id uuid,p_start_date date default null,p_end_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  if (p_start_date is null) <> (p_end_date is null) or p_start_date > p_end_date or
    (p_start_date is not null and (not isfinite(p_start_date) or not isfinite(p_end_date))) then
    raise exception 'invalid_date_range';
  end if;
  if not exists (select 1 from public.loyverse_connections where workspace_id=p_workspace_id and id=p_connection_id
    and status <> 'disconnected') then return null; end if;
  with selected as (
    select * from public.loyverse_receipt_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
      and (p_start_date is null or (created_at >= p_start_date::timestamp at time zone 'UTC'
        and created_at < (p_end_date + 1)::timestamp at time zone 'UTC'))
  ), coverage as (
    select min(day) as first_day,max(day) as last_day,count(*) as covered_days,
      count(*) filter (where covered_through = (day + 1)::timestamp at time zone 'UTC') as complete_days,
      max(covered_through) as covered_through
    from public.loyverse_import_days where workspace_id=p_workspace_id and connection_id=p_connection_id
      and (p_start_date is null or day between p_start_date and p_end_date)
  )
  select jsonb_build_object(
    'sales',coalesce(sum(total_money) filter (where not cancelled and receipt_type='SALE'),0),
    'refunds',coalesce(sum(total_money) filter (where not cancelled and receipt_type='REFUND'),0),
    'receipts',count(*) filter (where not cancelled),
    'unknown_date_receipts',(select count(*) from public.loyverse_receipt_facts where workspace_id=p_workspace_id
      and connection_id=p_connection_id and created_at is null),
    'first_day',(select first_day from coverage),'last_day',(select last_day from coverage),
    'covered_days',(select covered_days from coverage),'complete_days',(select complete_days from coverage),
    'covered_through',(select covered_through from coverage),
    'requested_days',case when p_start_date is not null then p_end_date-p_start_date+1
      else (select coalesce(last_day-first_day+1,0) from coverage) end
  ) into result from selected;
  return result;
end $function$;
revoke all on function public.loyverse_saved_report(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.loyverse_saved_report(uuid,uuid,date,date) to service_role;

create or replace function public.disconnect_loyverse_connection(p_workspace_id uuid, p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  update public.loyverse_connections set status='disconnected',sync_lease_id=null,
    sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.loyverse_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.loyverse_receipt_facts where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.loyverse_import_days where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.loyverse_oauth_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_loyverse_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_loyverse_connection(uuid,uuid) to service_role;

commit;
