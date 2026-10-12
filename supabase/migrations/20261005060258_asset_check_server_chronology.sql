begin;

-- VXA-007 follow-up: a contributor may report readiness, but must not pin that
-- readiness indefinitely by choosing a future creation time or retiming an old
-- check. Keep historical rows unchanged; trusted imports may retain past dates.
create function private.guard_asset_check_chronology_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Keep the original request role through SECURITY DEFINER callers.
  if (select auth.role()) = 'authenticated' then
    if tg_op = 'INSERT' then
      new.created_at := clock_timestamp();
    elsif new.created_at is distinct from old.created_at then
      raise exception 'asset_check_timestamp_immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_asset_check_chronology_v1()
  from public, anon, authenticated, service_role;
create trigger audit_asset_check_chronology before insert or update on public.asset_checks
  for each row execute function private.guard_asset_check_chronology_v1();

-- Old future-dated rows remain reviewable history, but cannot outrank a real
-- current check. This migration does not rewrite prior checks or asset status;
-- each subsequent check/lifecycle mutation recomputes its parent atomically.
create or replace function private.refresh_asset_check_readiness_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_workspace uuid;
  target_asset uuid;
  latest_status text;
  latest_at timestamptz;
  readiness_as_of timestamptz := clock_timestamp();
begin
  if tg_op = 'DELETE' then target_workspace := old.workspace_id; target_asset := old.asset_id;
  else target_workspace := new.workspace_id; target_asset := new.asset_id; end if;
  select c.status, c.created_at into latest_status, latest_at from public.asset_checks c
    where (c.workspace_id, c.asset_id) = (target_workspace, target_asset)
      and c.archived_at is null and c.deleted_at is null
      and c.created_at <= readiness_as_of
    order by c.created_at desc, c.id desc limit 1;
  update public.assets set status = coalesce(latest_status, 'Needs attention'), last_checked_at = latest_at
    where (workspace_id, id) = (target_workspace, target_asset);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.refresh_asset_check_readiness_v1()
  from public, anon, authenticated, service_role;

commit;
