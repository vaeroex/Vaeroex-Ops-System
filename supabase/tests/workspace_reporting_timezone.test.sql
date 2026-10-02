-- Isolated fixtures only; preserve the application's existing workspace policies.
begin;

create function pg_temp.preference_assert(condition boolean, label text)
returns text language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Timezone assertion failed: %', label; end if;
  return label;
end;
$$;

create function pg_temp.timezone_denied(statement text)
returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when insufficient_privilege then return true;
end;
$$;

insert into auth.users(id) values ('a9920000-0000-4000-8000-000000000001');
insert into public.profiles(id) values ('a9920000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.workspaces(id, name, created_by) values
  ('b9920000-0000-4000-8000-000000000001', 'Timezone fixture', 'a9920000-0000-4000-8000-000000000001'),
  ('b9920000-0000-4000-8000-000000000002', 'Other timezone fixture', 'a9920000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id, user_id, role, status) values
  ('b9920000-0000-4000-8000-000000000001', 'a9920000-0000-4000-8000-000000000001', 'owner', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9920000-0000-4000-8000-000000000001', true);
update public.workspaces set reporting_timezone = 'America/Los_Angeles' where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'America/Los_Angeles' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'active owner saves reporting timezone through authenticated update');
update public.workspaces set reporting_timezone = null where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone is null from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'active owner can restore unconfigured timezone');
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000002' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'owner cannot update an unrelated workspace timezone');
select pg_temp.preference_assert(pg_temp.timezone_denied($sql$
  update public.workspaces set created_by = null where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'timezone grant does not grant auth-bearing column updates');

reset role;
update public.workspace_members set role = 'admin' where workspace_id = 'b9920000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.preference_assert(pg_temp.timezone_denied($sql$
  update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'admin cannot bypass owner-only timezone setter through direct update');
select pg_temp.preference_assert(pg_temp.timezone_denied($sql$
  update public.workspaces set reporting_timezone = reporting_timezone where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'admin no-op timezone update is also denied');
select pg_temp.preference_assert(pg_temp.timezone_denied($sql$
  update public.workspaces set reporting_timezone = 'UTC', name = 'Denied combined update' where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'admin combined timezone and safe-column update is atomic and denied');
select pg_temp.preference_assert((select reporting_timezone is null and name = 'Timezone fixture' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'denied timezone update leaves all workspace fields unchanged');
update public.workspaces set name = 'Admin safe update' where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select name = 'Admin safe update' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'existing admin safe-column update remains allowed');

reset role;
update public.workspace_members set role = 'viewer' where workspace_id = 'b9920000-0000-4000-8000-000000000001';
set local role authenticated;
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'viewer cannot update reporting timezone');
reset role;
update public.workspace_members set role = 'staff' where workspace_id = 'b9920000-0000-4000-8000-000000000001';
set local role authenticated;
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'staff cannot update reporting timezone');
reset role;
update public.workspace_members set role = 'owner', status = 'disabled' where workspace_id = 'b9920000-0000-4000-8000-000000000001';
set local role authenticated;
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'disabled owner cannot update reporting timezone');
reset role;
update public.workspace_members set status = 'active' where workspace_id = 'b9920000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'missing authenticated subject cannot update reporting timezone');
reset role;
set local role anon;
with changed as (update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001' returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'anonymous RLS cannot update reporting timezone');
reset role;
select pg_temp.preference_assert(not has_function_privilege('authenticated', 'private.is_time_zone_v1(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.is_time_zone_v1(text)', 'EXECUTE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE'), 'timezone constraint does not widen private helper access');

rollback;
