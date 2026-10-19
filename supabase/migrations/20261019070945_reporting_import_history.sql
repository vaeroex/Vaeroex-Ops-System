begin;

-- Stable provider IDs let an imported record move dates without being counted twice.
-- Only numeric reporting contributions are retained; no descriptions or personal fields.
create table public.reporting_history_facts (
  workspace_id uuid not null,
  provider text not null check (provider in ('xero','harvest','clockify')),
  connection_id uuid not null,
  record_id text not null check (record_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  day date not null check (isfinite(day)),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'array'),
  primary key (workspace_id,provider,connection_id,record_id),
  foreign key (workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
create index reporting_history_facts_period on public.reporting_history_facts(workspace_id,provider,connection_id,day);

-- Empty dates are recorded too: a successfully imported zero differs from missing history.
create table public.reporting_history_days (
  workspace_id uuid not null,
  provider text not null check (provider in ('xero','harvest','clockify')),
  connection_id uuid not null,
  day date not null check (isfinite(day)),
  currencies text[] not null,
  covered_through timestamptz not null,
  imported_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id,provider,connection_id,day),
  foreign key (workspace_id,provider,connection_id) references public.reporting_connections(workspace_id,provider,id) on delete cascade
);
alter table public.reporting_history_facts enable row level security;
alter table public.reporting_history_days enable row level security;
create policy reporting_history_facts_member_read on public.reporting_history_facts for select to authenticated
  using (exists(select 1 from public.workspace_members m where m.workspace_id=reporting_history_facts.workspace_id
    and m.user_id=(select auth.uid()) and m.status='active'));
create policy reporting_history_days_member_read on public.reporting_history_days for select to authenticated
  using (exists(select 1 from public.workspace_members m where m.workspace_id=reporting_history_days.workspace_id
    and m.user_id=(select auth.uid()) and m.status='active'));
revoke all on public.reporting_history_facts,public.reporting_history_days from public,anon,authenticated;
grant select on public.reporting_history_facts,public.reporting_history_days to authenticated;
grant all on public.reporting_history_facts,public.reporting_history_days to service_role;

create function public.apply_reporting_history(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,
  p_start_date date,p_end_date date,p_records jsonb,p_currencies text[],p_observed_through timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare allowed_keys text[]; fact jsonb; metric jsonb; fact_day date;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform 1 from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection
    and status='connected' and lease_id=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  allowed_keys := case p_provider when 'xero' then array['invoices','billed','outstanding','bills','purchases']
    when 'harvest' then array['entries','hours','billable_hours','running']
    when 'clockify' then array['entries','hours','billable_hours','running'] end;
  if allowed_keys is null or p_start_date is null or p_end_date is null or not isfinite(p_start_date) or not isfinite(p_end_date)
    or p_start_date>p_end_date or p_end_date-p_start_date>365
    or p_end_date>(clock_timestamp() at time zone 'UTC')::date then raise exception 'invalid_date_range'; end if;
  if p_observed_through is null or not isfinite(p_observed_through) or p_observed_through>clock_timestamp()+interval '1 minute' or
    p_observed_through<(p_end_date::timestamp at time zone 'UTC') or
    p_observed_through>((p_end_date+1)::timestamp at time zone 'UTC') then raise exception 'invalid_observation_cutoff'; end if;
  if p_records is null or jsonb_typeof(p_records) is distinct from 'array' then raise exception 'invalid_history'; end if;
  if jsonb_array_length(p_records)>2000 or octet_length(p_records::text)>2000000 then raise exception 'snapshot_too_large'; end if;
  if p_currencies is null or cardinality(p_currencies)>20 or
    (p_provider='xero' and cardinality(p_currencies)<1) or (p_provider<>'xero' and cardinality(p_currencies)<>0) or
    exists(select 1 from unnest(p_currencies) currency where currency is null or currency !~ '^[A-Z]{3}$') or
    (select count(*) from unnest(p_currencies))<>(select count(distinct currency) from unnest(p_currencies) currency)
    then raise exception 'invalid_currency'; end if;
  for fact in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(fact) is distinct from 'object' or not(fact ?& array['recordId','day','metrics']) or
      (fact-array['recordId','day','metrics'])<>'{}'::jsonb or
      jsonb_typeof(fact->'recordId') is distinct from 'string' or (fact->>'recordId') !~ '^[A-Za-z0-9_-]{1,80}$' or
      jsonb_typeof(fact->'day') is distinct from 'string' or (fact->>'day') !~ '^\d{4}-\d{2}-\d{2}$' or
      jsonb_typeof(fact->'metrics') is distinct from 'array' then raise exception 'invalid_history_record'; end if;
    fact_day := (fact->>'day')::date;
    if fact_day<p_start_date or fact_day>p_end_date or jsonb_array_length(fact->'metrics')<>cardinality(allowed_keys)
      then raise exception 'invalid_history_record'; end if;
    for metric in select value from jsonb_array_elements(fact->'metrics') loop
      if jsonb_typeof(metric) is distinct from 'object' or not(metric ?& array['key','value']) or
        (metric-array['key','value','currency'])<>'{}'::jsonb or jsonb_typeof(metric->'key') is distinct from 'string' or
        not((metric->>'key')=any(allowed_keys)) or jsonb_typeof(metric->'value') is distinct from 'number' or
        (metric->>'value')::numeric not between 0 and 1e12 or
        ((p_provider='xero')<>(metric ? 'currency')) or
        (metric ? 'currency' and (jsonb_typeof(metric->'currency') is distinct from 'string' or not((metric->>'currency')=any(p_currencies))))
        then raise exception 'invalid_metric'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(fact->'metrics') m group by m->>'key' having count(*)>1) or
      (p_provider='xero' and (select count(distinct m->>'currency') from jsonb_array_elements(fact->'metrics') m)<>1)
      then raise exception 'duplicate_metric'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_records) r group by r->>'recordId' having count(*)>1)
    then raise exception 'duplicate_record'; end if;

  -- Both deletion and upsert occur only after every provider page and record validated.
  -- Remove records no longer returned in the selected period (including void/deleted entries).
  delete from public.reporting_history_facts where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection
    and day between p_start_date and p_end_date;
  insert into public.reporting_history_facts(workspace_id,provider,connection_id,record_id,day,metrics)
    select p_workspace,p_provider,p_connection,r->>'recordId',(r->>'day')::date,r->'metrics' from jsonb_array_elements(p_records) r
    on conflict (workspace_id,provider,connection_id,record_id) do update set day=excluded.day,metrics=excluded.metrics;
  insert into public.reporting_history_days(workspace_id,provider,connection_id,day,currencies,covered_through,imported_at)
    select p_workspace,p_provider,p_connection,p_start_date+n,p_currencies,
      least(p_observed_through,((p_start_date+n+1)::timestamp at time zone 'UTC')),clock_timestamp()
    from generate_series(0,p_end_date-p_start_date) n
    on conflict (workspace_id,provider,connection_id,day) do update set currencies=excluded.currencies,
      covered_through=excluded.covered_through,imported_at=excluded.imported_at;
  -- Preserve the legacy aggregate until the UI can display imported facts; never fabricate daily history from it.
  update public.reporting_connections set last_sync_at=clock_timestamp(),last_error_code=null,lease_id=null,lease_expires_at=null
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;
revoke all on function public.apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz) to service_role;

-- One aggregate object avoids the REST row cap. Invoker privileges retain RLS; membership is explicit as well.
create function public.read_reporting_history(p_workspace uuid,p_provider text,p_connection uuid,
  p_start_date date default null,p_end_date date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid() and status='active')
    then raise exception 'membership_required' using errcode='42501'; end if;
  if p_provider not in ('xero','harvest','clockify') or not exists(select 1 from public.reporting_connections
    where workspace_id=p_workspace and provider=p_provider and id=p_connection and status<>'disconnected')
    then raise exception 'connection_missing'; end if;
  if (p_start_date is null)<>(p_end_date is null) or
    (p_start_date is not null and (not isfinite(p_start_date) or not isfinite(p_end_date) or p_start_date>p_end_date or
      p_end_date>(current_timestamp at time zone 'UTC')::date)) then raise exception 'invalid_date_range'; end if;
  with selected_facts as (
    select * from public.reporting_history_facts where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection
      and (p_start_date is null or day between p_start_date and p_end_date)
  ), selected_days as (
    select * from public.reporting_history_days where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection
      and (p_start_date is null or day between p_start_date and p_end_date)
  ), currencies as (
    select distinct unnest(currencies) as currency from selected_days where p_provider='xero'
    union all select null::text where p_provider<>'xero' and exists(select 1 from selected_days)
  ), keys as (
    select unnest(case p_provider when 'xero' then array['invoices','billed','outstanding','bills','purchases']
      else array['entries','hours','billable_hours','running'] end) as key
  ), totals as (
    select m->>'key' as key,m->>'currency' as currency,sum((m->>'value')::numeric) as value
      from selected_facts cross join lateral jsonb_array_elements(metrics) m group by m->>'key',m->>'currency'
  ), metrics as (
    select k.key,c.currency,coalesce(t.value,0) as value from keys k cross join currencies c
      left join totals t on t.key=k.key and t.currency is not distinct from c.currency
  )
  select jsonb_build_object(
    'hasHistory',exists(select 1 from public.reporting_history_days where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection),
    'records',(select count(*) from selected_facts),
    'metrics',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',key,'value',value,'currency',currency)) order by currency,key) from metrics),'[]'::jsonb),
    'coverage',(select jsonb_build_object('days',count(*),'startDate',min(day),'endDate',max(day),'lastImportedAt',max(imported_at),
      'completeDays',count(*) filter(where covered_through>=((day+1)::timestamp at time zone 'UTC')),
      'incompleteDays',count(*) filter(where covered_through<((day+1)::timestamp at time zone 'UTC')),
      'coveredThrough',max(covered_through)) from selected_days)
  ) into result;
  return result;
end $$;
revoke all on function public.read_reporting_history(uuid,text,uuid,date,date) from public,anon;
grant execute on function public.read_reporting_history(uuid,text,uuid,date,date) to authenticated;

create or replace function public.disconnect_reporting_connection(p_workspace uuid,p_provider text,p_connection uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.reporting_connections set status='disconnected',account=null,snapshot=null,last_sync_at=null,last_error_code=null,lease_id=null,lease_expires_at=null
    where workspace_id=p_workspace and provider=p_provider and id=p_connection and status<>'disconnected';
  if not found then return false; end if;
  delete from public.reporting_credentials where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
  delete from public.reporting_oauth_states where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
  delete from public.reporting_history_facts where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
  delete from public.reporting_history_days where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection;
  return true;
end $$;
revoke all on function public.disconnect_reporting_connection(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_reporting_connection(uuid,text,uuid) to service_role;
commit;
