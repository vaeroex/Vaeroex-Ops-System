begin;

create table public.bamboohr_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  company_domain text not null check (company_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  status text not null default 'pending' check (status in ('pending','connected','reauthorization_required','disconnected')),
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error_code text,
  active_headcount integer check (active_headcount between 0 and 5000),
  roster_readable integer check (roster_readable between 0 and 5000),
  roster_total integer check (roster_total between 0 and 5000),
  approved_time_off_requests integer check (approved_time_off_requests between 0 and 10000),
  sync_lease_id uuid,
  sync_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check ((sync_lease_id is null) = (sync_lease_expires_at is null)),
  check (roster_readable is null or roster_total is not null),
  check (roster_total is null or roster_readable <= roster_total),
  check (active_headcount is null or (roster_readable = roster_total and active_headcount <= roster_total))
);
create unique index bamboohr_workspace_active_unique on public.bamboohr_connections(workspace_id)
  where status in ('pending', 'connected', 'reauthorization_required');

create table public.bamboohr_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid not null,
  connection_id uuid not null,
  initiated_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.bamboohr_connections(workspace_id, id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create table public.bamboohr_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null,
  token_ciphertext text not null check (char_length(token_ciphertext) between 32 and 32768),
  access_expires_at timestamptz not null,
  scope text not null check (scope = 'employee employee:job time_off offline_access'),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, connection_id) references public.bamboohr_connections(workspace_id, id) on delete cascade
);

alter table public.bamboohr_connections enable row level security;
alter table public.bamboohr_oauth_states enable row level security;
alter table public.bamboohr_credentials enable row level security;

create policy bamboohr_connections_owner_read on public.bamboohr_connections for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = bamboohr_connections.workspace_id
    and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'owner'));

revoke all on public.bamboohr_connections, public.bamboohr_oauth_states, public.bamboohr_credentials from anon, authenticated;
grant select on public.bamboohr_connections to authenticated;
grant all on public.bamboohr_connections, public.bamboohr_oauth_states, public.bamboohr_credentials to service_role;

-- Only aggregate counts are admitted. No employee record, name, note, or time-off type is persisted.
create function public.apply_bamboohr_snapshot(p_workspace_id uuid, p_connection_id uuid, p_lease_id uuid,
  p_active_headcount integer, p_roster_readable integer, p_roster_total integer,
  p_approved_time_off_requests integer)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'bamboohr_service_role_required' using errcode = '42501';
  end if;
  if p_roster_total is null or p_roster_total < 0 or p_roster_total > 5000 or
    p_roster_readable is null or p_roster_readable < 0 or p_roster_readable > p_roster_total or
    p_approved_time_off_requests is null or p_approved_time_off_requests < 0 or
    p_approved_time_off_requests > 10000 or
    (p_active_headcount is not null and (p_roster_readable <> p_roster_total or
      p_active_headcount < 0 or p_active_headcount > p_roster_total)) then
    raise exception 'bamboohr_snapshot_invalid';
  end if;
  update public.bamboohr_connections set active_headcount=p_active_headcount,
    roster_readable=p_roster_readable, roster_total=p_roster_total,
    approved_time_off_requests=p_approved_time_off_requests,
    last_sync_at=clock_timestamp(), last_error_code=null,
    sync_lease_id=null, sync_lease_expires_at=null, updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status='connected'
      and sync_lease_id=p_lease_id and sync_lease_expires_at > clock_timestamp();
  return found;
end $function$;
revoke all on function public.apply_bamboohr_snapshot(uuid,uuid,uuid,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.apply_bamboohr_snapshot(uuid,uuid,uuid,integer,integer,integer,integer) to service_role;

create function public.disconnect_bamboohr_connection(p_workspace_id uuid, p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'bamboohr_service_role_required' using errcode = '42501';
  end if;
  update public.bamboohr_connections set status='disconnected', sync_lease_id=null,
    sync_lease_expires_at=null, active_headcount=null, roster_readable=null, roster_total=null,
    approved_time_off_requests=null, last_sync_at=null, updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and id=p_connection_id and status <> 'disconnected';
  if not found then return false; end if;
  delete from public.bamboohr_credentials where workspace_id=p_workspace_id and connection_id=p_connection_id;
  delete from public.bamboohr_oauth_states where workspace_id=p_workspace_id and connection_id=p_connection_id;
  return true;
end $function$;
revoke all on function public.disconnect_bamboohr_connection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.disconnect_bamboohr_connection(uuid,uuid) to service_role;

commit;
