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

create function pg_temp.timezone_invalid(statement text)
returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when check_violation then return true;
end;
$$;

-- Reproduce the restricted helper ACL used by billing, even on legacy-grant fixtures.
revoke execute on function public.has_workspace_role(uuid, text[]) from public, service_role;

insert into auth.users(id) values ('a9920000-0000-4000-8000-000000000001');
insert into public.profiles(id) values ('a9920000-0000-4000-8000-000000000001') on conflict do nothing;
-- Keep the role/column tests entitled so subscription enforcement cannot
-- mask their intended allow/deny results. Service bootstrap rows below remain unchanged.
insert into public.workspaces(id, name, created_by, subscription_status, trial_ends_at) values
  ('b9920000-0000-4000-8000-000000000001', 'Timezone fixture', 'a9920000-0000-4000-8000-000000000001', 'trialing', now() + interval '1 day'),
  ('b9920000-0000-4000-8000-000000000002', 'Other timezone fixture', 'a9920000-0000-4000-8000-000000000001', 'trialing', now() + interval '1 day');
insert into public.workspace_members(workspace_id, user_id, role, status) values
  ('b9920000-0000-4000-8000-000000000001', 'a9920000-0000-4000-8000-000000000001', 'owner', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9920000-0000-4000-8000-000000000001', true);
update public.workspaces set reporting_timezone = 'America/Los_Angeles' where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'America/Los_Angeles' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'active owner saves reporting timezone through authenticated update');
update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'UTC' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'active owner can save UTC directly');
update public.workspaces set reporting_timezone = 'US/Pacific' where id = 'b9920000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'US/Pacific' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'active owner can save a recognized IANA alias directly');
select pg_temp.preference_assert(pg_temp.timezone_invalid($sql$
  update public.workspaces set reporting_timezone = 'Not/ARealZone' where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'direct owner update rejects syntactically valid unknown timezone');
select pg_temp.preference_assert(pg_temp.timezone_invalid($sql$
  update public.workspaces set reporting_timezone = 'Not/ARealZone', name = 'Invalid owner change' where id = 'b9920000-0000-4000-8000-000000000001'
$sql$), 'owner combined invalid timezone and safe-column update is denied');
select pg_temp.preference_assert((select reporting_timezone = 'US/Pacific' and name = 'Timezone fixture' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000001'), 'invalid owner update atomically preserves timezone and workspace name');
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

-- Workspace creation remains privileged; exercise its existing insert authority.
select pg_temp.preference_assert(not has_function_privilege('service_role', 'public.has_workspace_role(uuid,text[])', 'EXECUTE'),
  'service role has no workspace role helper execution privilege');
set local role service_role;
discard plans;
insert into public.workspaces(id, name, created_by, reporting_timezone) values
  ('b9920000-0000-4000-8000-000000000010', 'UTC insert', 'a9920000-0000-4000-8000-000000000001', 'UTC'),
  ('b9920000-0000-4000-8000-000000000011', 'IANA insert', 'a9920000-0000-4000-8000-000000000001', 'America/Los_Angeles'),
  ('b9920000-0000-4000-8000-000000000012', 'Alias insert', 'a9920000-0000-4000-8000-000000000001', 'US/Pacific'),
  ('b9920000-0000-4000-8000-000000000013', 'Null insert', 'a9920000-0000-4000-8000-000000000001', null);
select pg_temp.preference_assert((select reporting_timezone = 'UTC' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000010'), 'workspace insert accepts UTC');
select pg_temp.preference_assert((select reporting_timezone = 'America/Los_Angeles' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000011'), 'workspace insert accepts a recognized IANA timezone');
select pg_temp.preference_assert((select reporting_timezone = 'US/Pacific' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000012'), 'workspace insert accepts a recognized IANA alias');
select pg_temp.preference_assert((select reporting_timezone is null from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000013'), 'workspace insert accepts unconfigured null timezone');
update public.workspaces set name = 'Service safe update' where id = 'b9920000-0000-4000-8000-000000000013';
select pg_temp.preference_assert((select name = 'Service safe update' and reporting_timezone is null from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000013'), 'service role ordinary workspace update succeeds without owner helper');
update public.workspaces set reporting_timezone = 'UTC' where id = 'b9920000-0000-4000-8000-000000000012';
select pg_temp.preference_assert((select reporting_timezone = 'UTC' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000012'), 'service role timezone update succeeds without owner helper');
select pg_temp.preference_assert(pg_temp.timezone_invalid($sql$
  update public.workspaces set reporting_timezone = 'Not/ARealZone', name = 'Invalid service change'
    where id = 'b9920000-0000-4000-8000-000000000012'
$sql$), 'service role update rejects unknown timezone without owner helper');
select pg_temp.preference_assert((select reporting_timezone = 'UTC' and name = 'Alias insert' from public.workspaces
  where id = 'b9920000-0000-4000-8000-000000000012'), 'invalid service role update preserves saved fields');
select pg_temp.preference_assert(pg_temp.timezone_invalid($sql$
  insert into public.workspaces(id, name, created_by, reporting_timezone) values
    ('b9920000-0000-4000-8000-000000000014', 'Invalid insert', 'a9920000-0000-4000-8000-000000000001', 'Not/ARealZone')
$sql$), 'workspace insert rejects syntactically valid unknown timezone');
select pg_temp.preference_assert(pg_temp.timezone_invalid($sql$
  insert into public.workspaces(id, name, created_by, reporting_timezone) values
    ('b9920000-0000-4000-8000-000000000015', 'Valid batch row', 'a9920000-0000-4000-8000-000000000001', 'UTC'),
    ('b9920000-0000-4000-8000-000000000016', 'Invalid batch row', 'a9920000-0000-4000-8000-000000000001', 'Not/ARealZone')
$sql$), 'multi-row workspace insert rejects an unknown timezone');
select pg_temp.preference_assert((select count(*) = 0 from public.workspaces where id in
  ('b9920000-0000-4000-8000-000000000014', 'b9920000-0000-4000-8000-000000000015', 'b9920000-0000-4000-8000-000000000016')),
  'invalid workspace inserts atomically leave no rows');
select pg_temp.preference_assert(not has_function_privilege('service_role', 'public.has_workspace_role(uuid,text[])', 'EXECUTE'),
  'service role still has no workspace role helper execution privilege');
reset role;

rollback;
