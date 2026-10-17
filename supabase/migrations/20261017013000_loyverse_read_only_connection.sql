begin;

create table public.loyverse_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','connected','reauthorization_required','disconnected')),
  merchant_id uuid,
  business_name text check (char_length(business_name) <= 200),
  currency_code text check (currency_code ~ '^[A-Z]{3}$'),
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null))
);
create unique index loyverse_active_merchant_unique on public.loyverse_connections(workspace_id, merchant_id)
  where status = 'connected' and merchant_id is not null;
create unique index loyverse_workspace_active_unique on public.loyverse_connections(workspace_id)
  where status in ('pending', 'connected', 'reauthorization_required');

create table public.loyverse_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiated_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create table public.loyverse_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null,
  token_ciphertext text not null check (char_length(token_ciphertext) between 32 and 32768),
  access_expires_at timestamptz not null,
  scope text not null check (scope = 'MERCHANT_READ RECEIPTS_READ'),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade
);

create table public.loyverse_receipt_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  receipt_number text not null check (char_length(receipt_number) between 1 and 120),
  store_id text not null check (char_length(store_id) between 1 and 120),
  receipt_date timestamptz not null,
  updated_at timestamptz not null,
  receipt_type text not null check (receipt_type in ('SALE','REFUND')),
  total_money numeric(16, 2) not null,
  total_tax numeric(16, 2) not null,
  total_discount numeric(16, 2) not null,
  cancelled boolean not null,
  primary key (workspace_id, connection_id, receipt_number),
  foreign key (workspace_id, connection_id) references public.loyverse_connections(workspace_id, id) on delete cascade
);
create index loyverse_receipt_facts_period_idx on public.loyverse_receipt_facts(workspace_id, connection_id, receipt_date desc);

alter table public.loyverse_connections enable row level security;
alter table public.loyverse_oauth_states enable row level security;
alter table public.loyverse_credentials enable row level security;
alter table public.loyverse_receipt_facts enable row level security;

create policy loyverse_connections_read on public.loyverse_connections for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = loyverse_connections.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy loyverse_receipt_facts_read on public.loyverse_receipt_facts for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = loyverse_receipt_facts.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));

revoke all on public.loyverse_connections, public.loyverse_oauth_states, public.loyverse_credentials, public.loyverse_receipt_facts from anon, authenticated;
grant select on public.loyverse_connections, public.loyverse_receipt_facts to authenticated;
grant all on public.loyverse_connections, public.loyverse_oauth_states, public.loyverse_credentials, public.loyverse_receipt_facts to service_role;

-- Apply a complete bounded seven-day snapshot in one transaction. No customer,
-- employee, payment, note, or line-item fields are accepted or stored.
create function public.apply_loyverse_receipts(p_workspace_id uuid, p_connection_id uuid, p_lease_id uuid,
  p_window_start timestamptz, p_window_end timestamptz, p_receipts jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) > 5000 or
    p_window_start >= p_window_end or p_window_start < clock_timestamp() - interval '8 days' or
    p_window_end > clock_timestamp() + interval '1 minute' then
    raise exception 'loyverse_snapshot_invalid';
  end if;
  perform 1 from public.loyverse_connections c where c.workspace_id = p_workspace_id and c.id = p_connection_id
    and c.status = 'connected' and c.sync_lease_id = p_lease_id and c.sync_lease_expires_at > clock_timestamp() for update;
  if not found then raise exception 'loyverse_sync_lease_invalid'; end if;
  delete from public.loyverse_receipt_facts f where f.workspace_id = p_workspace_id and f.connection_id = p_connection_id
    and (f.receipt_date < p_window_start or (f.receipt_date >= p_window_start and f.receipt_date < p_window_end));
  insert into public.loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled)
  select p_workspace_id,p_connection_id,r.receipt_number,r.store_id,r.receipt_date,r.updated_at,r.receipt_type,
    r.total_money,r.total_tax,r.total_discount,r.cancelled
  from jsonb_to_recordset(p_receipts) as r(receipt_number text,store_id text,receipt_date timestamptz,
    updated_at timestamptz,receipt_type text,total_money numeric,total_tax numeric,total_discount numeric,cancelled boolean)
  on conflict (workspace_id,connection_id,receipt_number) do update set store_id=excluded.store_id,
    receipt_date=excluded.receipt_date,updated_at=excluded.updated_at,receipt_type=excluded.receipt_type,
    total_money=excluded.total_money,total_tax=excluded.total_tax,total_discount=excluded.total_discount,cancelled=excluded.cancelled;
  get diagnostics applied = row_count;
  update public.loyverse_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;

create function public.disconnect_loyverse_connection(p_workspace_id uuid, p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'loyverse_service_role_required' using errcode = '42501';
  end if;
  update public.loyverse_connections set status='disconnected',sync_lease_id=null,
    sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.loyverse_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.loyverse_receipt_facts where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.loyverse_oauth_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_loyverse_connection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.disconnect_loyverse_connection(uuid,uuid) to service_role;

commit;
