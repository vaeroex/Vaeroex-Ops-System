begin;

create table public.zoho_books_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','choose_organization','connected','reauthorization_required','disconnected')),
  organization_id text check (organization_id ~ '^[0-9]{5,30}$'),
  organization_name text check (char_length(organization_name) <= 200),
  currency_code text check (currency_code = 'USD'),
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null))
);
create unique index zoho_books_workspace_active_unique on public.zoho_books_connections(workspace_id)
  where status in ('pending','choose_organization','connected','reauthorization_required');

create table public.zoho_books_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiated_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.zoho_books_connections(workspace_id, id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create table public.zoho_books_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null,
  token_ciphertext text not null check (char_length(token_ciphertext) between 32 and 32768),
  access_expires_at timestamptz not null,
  scope text not null check (scope = 'ZohoBooks.settings.READ,ZohoBooks.invoices.READ,ZohoBooks.expenses.READ'),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.zoho_books_connections(workspace_id, id) on delete cascade
);

create table public.zoho_books_daily_summaries (
  workspace_id uuid not null,
  connection_id uuid not null,
  day date not null,
  invoice_count integer not null check (invoice_count >= 0),
  invoice_total numeric(16,2) not null check (invoice_total >= 0),
  outstanding_total numeric(16,2) not null check (outstanding_total >= 0),
  expense_count integer not null check (expense_count >= 0),
  expense_total numeric(16,2) not null check (expense_total >= 0),
  excluded_foreign_count integer not null check (excluded_foreign_count >= 0),
  primary key (workspace_id, connection_id, day),
  foreign key (workspace_id, connection_id) references public.zoho_books_connections(workspace_id, id) on delete cascade
);

alter table public.zoho_books_connections enable row level security;
alter table public.zoho_books_oauth_states enable row level security;
alter table public.zoho_books_credentials enable row level security;
alter table public.zoho_books_daily_summaries enable row level security;

create policy zoho_books_connections_read on public.zoho_books_connections for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = zoho_books_connections.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy zoho_books_daily_summaries_read on public.zoho_books_daily_summaries for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = zoho_books_daily_summaries.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));

revoke all on public.zoho_books_connections, public.zoho_books_oauth_states, public.zoho_books_credentials, public.zoho_books_daily_summaries from anon, authenticated;
grant select on public.zoho_books_connections, public.zoho_books_daily_summaries to authenticated;
grant all on public.zoho_books_connections, public.zoho_books_oauth_states, public.zoho_books_credentials, public.zoho_books_daily_summaries to service_role;

-- A complete seven-calendar-day summary replaces the previous snapshot atomically.
-- Only counts and USD totals are accepted; invoice/customer/vendor details are discarded.
create function public.apply_zoho_books_summary(p_workspace_id uuid, p_connection_id uuid, p_lease_id uuid,
  p_start_date date, p_end_date date, p_daily jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'zoho_books_service_role_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_daily) <> 'array' or p_end_date - p_start_date <> 6 or
    p_start_date < (clock_timestamp() at time zone 'UTC')::date - 7 or
    p_end_date > (clock_timestamp() at time zone 'UTC')::date or
    jsonb_array_length(p_daily) <> 7 then
    raise exception 'zoho_books_snapshot_invalid';
  end if;
  perform 1 from public.zoho_books_connections c where c.workspace_id = p_workspace_id and c.id = p_connection_id
    and c.status = 'connected' and c.sync_lease_id = p_lease_id and c.sync_lease_expires_at > clock_timestamp() for update;
  if not found then raise exception 'zoho_books_sync_lease_invalid'; end if;
  if exists (select 1 from jsonb_to_recordset(p_daily) as r(day date) where r.day < p_start_date or r.day > p_end_date) then
    raise exception 'zoho_books_day_invalid';
  end if;
  delete from public.zoho_books_daily_summaries where workspace_id=p_workspace_id and connection_id=p_connection_id;
  insert into public.zoho_books_daily_summaries(workspace_id,connection_id,day,invoice_count,invoice_total,
    outstanding_total,expense_count,expense_total,excluded_foreign_count)
  select p_workspace_id,p_connection_id,r.day,r.invoice_count,r.invoice_total,r.outstanding_total,
    r.expense_count,r.expense_total,r.excluded_foreign_count
  from jsonb_to_recordset(p_daily) as r(day date,invoice_count integer,invoice_total numeric,
    outstanding_total numeric,expense_count integer,expense_total numeric,excluded_foreign_count integer);
  get diagnostics applied = row_count;
  if applied <> 7 then raise exception 'zoho_books_snapshot_incomplete'; end if;
  update public.zoho_books_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_zoho_books_summary(uuid,uuid,uuid,date,date,jsonb) from public, anon, authenticated;
grant execute on function public.apply_zoho_books_summary(uuid,uuid,uuid,date,date,jsonb) to service_role;

create function public.disconnect_zoho_books_connection(p_workspace_id uuid, p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'zoho_books_service_role_required' using errcode = '42501';
  end if;
  update public.zoho_books_connections set status='disconnected',sync_lease_id=null,
    sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.zoho_books_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_daily_summaries where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.zoho_books_oauth_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_zoho_books_connection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.disconnect_zoho_books_connection(uuid,uuid) to service_role;

commit;
