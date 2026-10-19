begin;

-- Stable provider IDs allow corrected or moved records to replace their earlier value.
-- Customer/vendor names, descriptions, line items and foreign-currency amounts are never retained.
create table public.zoho_books_history_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  kind text not null check (kind in ('invoice','expense')),
  source_id text not null check (source_id ~ '^[0-9]{1,30}$'),
  day date not null,
  counted boolean not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total numeric(16,2) not null check (total >= 0 and total <= 1000000000),
  outstanding numeric(16,2) not null check (outstanding >= 0 and outstanding <= 1000000000),
  primary key (workspace_id,connection_id,kind,source_id),
  foreign key (workspace_id,connection_id) references public.zoho_books_connections(workspace_id,id) on delete cascade,
  check ((counted and currency = 'USD') or (total = 0 and outstanding = 0)),
  check (kind = 'invoice' or (counted and outstanding = 0))
);
create index zoho_books_history_by_day on public.zoho_books_history_facts(workspace_id,connection_id,day);
create table public.zoho_books_history_coverage (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  imported_at timestamptz not null default clock_timestamp(),
  covered_through timestamptz not null,
  primary key (workspace_id,connection_id,day),
  foreign key (workspace_id,connection_id) references public.zoho_books_connections(workspace_id,id) on delete cascade,
  check (covered_through >= (day::timestamp at time zone 'UTC') and covered_through <= ((day+1)::timestamp at time zone 'UTC'))
);
alter table public.zoho_books_history_facts enable row level security;
alter table public.zoho_books_history_coverage enable row level security;
create policy zoho_books_history_facts_read on public.zoho_books_history_facts for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = zoho_books_history_facts.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy zoho_books_history_coverage_read on public.zoho_books_history_coverage for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = zoho_books_history_coverage.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
revoke all on public.zoho_books_history_facts,public.zoho_books_history_coverage from public,anon,authenticated;
grant select on public.zoho_books_history_facts,public.zoho_books_history_coverage to authenticated;
grant all on public.zoho_books_history_facts,public.zoho_books_history_coverage to service_role;

create function public.apply_zoho_books_history(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_start_date date,p_end_date date,p_observed_through timestamptz,p_facts jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'zoho_books_service_role_required' using errcode='42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or
    p_end_date-p_start_date > 365 or p_end_date > (clock_timestamp() at time zone 'UTC')::date or
    p_observed_through is null or p_observed_through < (p_end_date::timestamp at time zone 'UTC') or
    p_observed_through > ((p_end_date+1)::timestamp at time zone 'UTC') or p_observed_through > clock_timestamp()+interval '1 minute' or
    p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 4000 then
    raise exception 'zoho_books_history_invalid';
  end if;
  perform 1 from public.zoho_books_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id
    and c.status='connected' and c.sync_lease_id=p_lease_id and c.sync_lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'zoho_books_sync_lease_invalid'; end if;
  if exists (select 1 from jsonb_array_elements(p_facts) x where
    jsonb_typeof(x) <> 'object' or not x ?& array['kind','source_id','day','counted','currency','total','outstanding'] or
    (x - array['kind','source_id','day','counted','currency','total','outstanding']) <> '{}'::jsonb or
    jsonb_typeof(x->'kind') <> 'string' or jsonb_typeof(x->'source_id') <> 'string' or
    jsonb_typeof(x->'day') <> 'string' or jsonb_typeof(x->'counted') <> 'boolean' or
    jsonb_typeof(x->'currency') <> 'string' or jsonb_typeof(x->'total') <> 'number' or
    jsonb_typeof(x->'outstanding') <> 'number') then raise exception 'zoho_books_fact_invalid'; end if;
  if exists (select 1 from jsonb_to_recordset(p_facts) as r(day date) where r.day < p_start_date or r.day > p_end_date) or
    exists (select 1 from jsonb_to_recordset(p_facts) as r(kind text,source_id text) group by kind,source_id having count(*) > 1) then
    raise exception 'zoho_books_fact_invalid';
  end if;
  -- Atomic replacement only for the completed period, followed by identity-wide correction.
  delete from public.zoho_books_history_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
    and day between p_start_date and p_end_date;
  insert into public.zoho_books_history_facts(workspace_id,connection_id,kind,source_id,day,counted,currency,total,outstanding)
  select p_workspace_id,p_connection_id,r.kind,r.source_id,r.day,r.counted,r.currency,r.total,r.outstanding
  from jsonb_to_recordset(p_facts) as r(kind text,source_id text,day date,counted boolean,currency text,total numeric,outstanding numeric)
  on conflict (workspace_id,connection_id,kind,source_id) do update set
    day=excluded.day,counted=excluded.counted,currency=excluded.currency,total=excluded.total,outstanding=excluded.outstanding;
  get diagnostics applied = row_count;
  insert into public.zoho_books_history_coverage(workspace_id,connection_id,day,covered_through)
    select p_workspace_id,p_connection_id,p_start_date+i,
      least(p_observed_through,((p_start_date+i+1)::timestamp at time zone 'UTC'))
      from generate_series(0,p_end_date-p_start_date) i
    on conflict (workspace_id,connection_id,day) do update set
      imported_at=clock_timestamp(),covered_through=excluded.covered_through;
  -- Old daily snapshots have no source IDs. Preserve unimported dates separately; never add them to new history totals.
  delete from public.zoho_books_daily_summaries where workspace_id=p_workspace_id and connection_id=p_connection_id
    and day between p_start_date and p_end_date;
  update public.zoho_books_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb) to service_role;
-- Prevent an older deployed caller from writing a destructive seven-day snapshot.
revoke execute on function public.apply_zoho_books_summary(uuid,uuid,uuid,date,date,jsonb) from service_role;

-- Aggregate in SQL so neither API row limits nor a long history truncate the report.
create function public.read_zoho_books_history(p_workspace_id uuid,p_connection_id uuid,
  p_start_date date default null,p_end_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb; first_day date; last_day date; covered integer; complete integer; latest_cutoff timestamptz; legacy jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'zoho_books_service_role_required' using errcode='42501';
  end if;
  if (p_start_date is null) <> (p_end_date is null) or p_start_date > p_end_date then
    raise exception 'zoho_books_history_invalid';
  end if;
  if not exists (select 1 from public.zoho_books_connections where workspace_id=p_workspace_id and id=p_connection_id and status='connected') then
    raise exception 'zoho_books_connection_invalid';
  end if;
  select min(day),max(day),count(*)::integer,
    count(*) filter(where covered_through >= ((day+1)::timestamp at time zone 'UTC'))::integer,max(covered_through)
    into first_day,last_day,covered,complete,latest_cutoff from public.zoho_books_history_coverage
    where workspace_id=p_workspace_id and connection_id=p_connection_id
      and (p_start_date is null or day between p_start_date and p_end_date);
  select jsonb_build_object(
    'invoice_count',count(*) filter(where kind='invoice' and counted and currency='USD'),
    'invoice_total',coalesce(sum(total) filter(where kind='invoice'),0),
    'outstanding_total',coalesce(sum(outstanding),0),
    'expense_count',count(*) filter(where kind='expense' and currency='USD'),
    'expense_total',coalesce(sum(total) filter(where kind='expense'),0),
    'excluded_foreign_count',count(*) filter(where counted and currency<>'USD')) into result
    from public.zoho_books_history_facts where workspace_id=p_workspace_id and connection_id=p_connection_id
      and (p_start_date is null or day between p_start_date and p_end_date);
  select jsonb_build_object('days',count(*),'start',min(day),'end',max(day),
    'invoice_total',coalesce(sum(invoice_total),0),'expense_total',coalesce(sum(expense_total),0),
    'outstanding_total',coalesce(sum(outstanding_total),0)) into legacy
    from public.zoho_books_daily_summaries where workspace_id=p_workspace_id and connection_id=p_connection_id
      and (p_start_date is null or day between p_start_date and p_end_date);
  return result || jsonb_build_object('covered_days',covered,'complete_days',complete,'incomplete_days',covered-complete,
    'latest_covered_through',latest_cutoff,'start',first_day,'end',last_day,
    'missing_days',greatest(0,coalesce(p_end_date,last_day)-coalesce(p_start_date,first_day)+1-covered),'legacy',legacy);
end $function$;
revoke all on function public.read_zoho_books_history(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.read_zoho_books_history(uuid,uuid,date,date) to service_role;

create or replace function public.disconnect_zoho_books_connection(p_workspace_id uuid,p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'zoho_books_service_role_required' using errcode='42501';
  end if;
  update public.zoho_books_connections set status='disconnected',sync_lease_id=null,
    sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status<>'disconnected';
  if not found then return false; end if;
  delete from public.zoho_books_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_daily_summaries where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_history_facts where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_history_coverage where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_oauth_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_zoho_books_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_zoho_books_connection(uuid,uuid) to service_role;

commit;
