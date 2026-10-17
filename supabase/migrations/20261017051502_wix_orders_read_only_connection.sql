begin;

create table public.wix_order_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  status text not null check (status in ('pending','connected','reauthorization_required','disconnected')),
  instance_hash text unique check (instance_hash ~ '^[a-f0-9]{64}$'),
  site_id uuid,
  last_sync_at timestamptz,
  last_error_code text,
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null)),
  check (status <> 'connected' or instance_hash is not null)
);
create unique index wix_one_active_connection_per_workspace on public.wix_order_connections(workspace_id)
  where status in ('pending','connected','reauthorization_required');

create table public.wix_order_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null,
  instance_ciphertext text not null check (char_length(instance_ciphertext) between 32 and 4096),
  foreign key (workspace_id,connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade
);

create table public.wix_order_install_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiated_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '20 minutes')
);

create table public.wix_order_facts (
  workspace_id uuid not null,
  connection_id uuid not null,
  order_id uuid not null,
  created_at timestamptz not null,
  total_amount numeric(16,2) not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  payment_status text not null check (char_length(payment_status) between 1 and 40),
  primary key (workspace_id, connection_id, order_id),
  foreign key (workspace_id, connection_id) references public.wix_order_connections(workspace_id,id) on delete cascade
);
create index wix_order_facts_recent on public.wix_order_facts(workspace_id,connection_id,created_at desc);

alter table public.wix_order_connections enable row level security;
alter table public.wix_order_credentials enable row level security;
alter table public.wix_order_install_states enable row level security;
alter table public.wix_order_facts enable row level security;
create policy wix_order_connections_read on public.wix_order_connections for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = wix_order_connections.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
create policy wix_order_facts_read on public.wix_order_facts for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = wix_order_facts.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active'));
revoke all on public.wix_order_connections, public.wix_order_credentials, public.wix_order_install_states, public.wix_order_facts from anon,authenticated;
grant select on public.wix_order_connections, public.wix_order_facts to authenticated;
grant all on public.wix_order_connections, public.wix_order_credentials, public.wix_order_install_states, public.wix_order_facts to service_role;

create function public.apply_wix_order_snapshot(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_window_start timestamptz,p_window_end timestamptz,p_orders jsonb)
returns integer language plpgsql security definer set search_path = '' as $function$
declare applied integer;
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception 'wix_service_role_required' using errcode='42501';
  end if;
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) > 5000 or
    p_window_start >= p_window_end or p_window_start < clock_timestamp() - interval '8 days' or
    p_window_end > clock_timestamp() + interval '1 minute' then
    raise exception 'wix_snapshot_invalid';
  end if;
  perform 1 from public.wix_order_connections c where c.workspace_id=p_workspace_id and c.id=p_connection_id
    and c.status='connected' and c.sync_lease_id=p_lease_id and c.sync_lease_expires_at > clock_timestamp() for update;
  if not found then raise exception 'wix_sync_lease_invalid'; end if;
  delete from public.wix_order_facts f where f.workspace_id=p_workspace_id and f.connection_id=p_connection_id;
  insert into public.wix_order_facts(workspace_id,connection_id,order_id,created_at,total_amount,currency_code,payment_status)
  select p_workspace_id,p_connection_id,r.order_id,r.created_at,r.total_amount,r.currency_code,r.payment_status
    from jsonb_to_recordset(p_orders) as r(order_id uuid,created_at timestamptz,total_amount numeric,
      currency_code text,payment_status text)
    where r.created_at >= p_window_start and r.created_at < p_window_end;
  get diagnostics applied=row_count;
  update public.wix_order_connections set last_sync_at=clock_timestamp(),last_error_code=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id;
  return applied;
end $function$;
revoke all on function public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;

create function public.disconnect_wix_order_connection(p_workspace_id uuid,p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('request.jwt.claim.role',true) <> 'service_role' then
    raise exception 'wix_service_role_required' using errcode='42501';
  end if;
  update public.wix_order_connections set status='disconnected',instance_hash=null,site_id=null,
    sync_lease_id=null,sync_lease_expires_at=null,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.wix_order_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.wix_order_facts where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.wix_order_install_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_wix_order_connection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_wix_order_connection(uuid,uuid) to service_role;

commit;
