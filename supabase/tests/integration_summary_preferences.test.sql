-- Run in an isolated database only. The fixture and helper functions roll back.
begin;

create function pg_temp.preference_assert(condition boolean, label text)
returns text language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Preference assertion failed: %', label; end if;
  return label;
end;
$$;

create function pg_temp.preference_denied(statement text, expected_state text default '42501')
returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then
  return sqlstate = expected_state;
end;
$$;

insert into auth.users(id) values
  ('a9910000-0000-4000-8000-000000000001'), ('a9910000-0000-4000-8000-000000000002');
insert into public.profiles(id) values
  ('a9910000-0000-4000-8000-000000000001'), ('a9910000-0000-4000-8000-000000000002') on conflict do nothing;
-- Exercise preference identity/role rules in an entitled, bounded trial.
-- Subscription denial is verified separately; no policy is bypassed here.
insert into public.workspaces(id, name, created_by, subscription_status, trial_ends_at) values
  ('b9910000-0000-4000-8000-000000000001', 'Preference A', 'a9910000-0000-4000-8000-000000000001', 'trialing', now() + interval '1 day'),
  ('b9910000-0000-4000-8000-000000000002', 'Preference B', 'a9910000-0000-4000-8000-000000000001', 'trialing', now() + interval '1 day'),
  ('b9910000-0000-4000-8000-000000000003', 'Preference inaccessible', 'a9910000-0000-4000-8000-000000000002', 'trialing', now() + interval '1 day');
insert into public.workspace_members(workspace_id, user_id, role, status) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'viewer', 'active'),
  ('b9910000-0000-4000-8000-000000000002', 'a9910000-0000-4000-8000-000000000001', 'staff', 'active'),
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002', 'owner', 'active');

select pg_temp.preference_assert((select bool_and(reporting_timezone is null) from public.workspaces
  where id in ('b9910000-0000-4000-8000-000000000001', 'b9910000-0000-4000-8000-000000000002')), 'new workspace timezone defaults null');
update public.workspaces set reporting_timezone = 'America/Los_Angeles' where id = 'b9910000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'America/Los_Angeles' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'IANA-form timezone accepted');
update public.workspaces set reporting_timezone = 'UTC' where id = 'b9910000-0000-4000-8000-000000000002';
select pg_temp.preference_assert((select reporting_timezone = 'UTC' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000002'), 'UTC accepted');
update public.workspaces set reporting_timezone = null where id = 'b9910000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone is null from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'explicit null restores unconfigured state');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.workspaces set reporting_timezone = '' where id = 'b9910000-0000-4000-8000-000000000001'
$sql$, '23514'), 'empty timezone rejected');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.workspaces set reporting_timezone = 'America//Los_Angeles' where id = 'b9910000-0000-4000-8000-000000000001'
$sql$, '23514'), 'malformed timezone path rejected');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.workspaces set reporting_timezone = ' UTC ' where id = 'b9910000-0000-4000-8000-000000000001'
$sql$, '23514'), 'timezone whitespace rejected');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.workspaces set reporting_timezone = repeat('A', 65) where id = 'b9910000-0000-4000-8000-000000000001'
$sql$, '23514'), 'oversized timezone rejected');
select pg_temp.preference_assert((select reporting_timezone is null from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'invalid timezone updates leave stored value unchanged');

set local role service_role;
update public.workspaces set name = 'Preference A renamed' where id = 'b9910000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select name = 'Preference A renamed' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'existing service workspace update works with null timezone');
update public.workspaces set name = 'Preference B renamed' where id = 'b9910000-0000-4000-8000-000000000002';
select pg_temp.preference_assert((select name = 'Preference B renamed' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000002'), 'existing service workspace update works with configured timezone');
reset role;

select pg_temp.preference_assert((select relrowsecurity from pg_class where oid = 'public.integration_summary_preferences'::regclass), 'RLS enabled');
select pg_temp.preference_assert(not has_table_privilege('anon', 'public.integration_summary_preferences', 'SELECT'), 'anonymous read not granted');
select pg_temp.preference_assert(not has_table_privilege('authenticated', 'public.integration_summary_preferences', 'DELETE'), 'restore does not require delete privilege');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000001', true);
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences), 'missing preference leaves entry visible');

insert into public.integration_summary_preferences(workspace_id, user_id, summary_key, hidden_when_disconnected) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('a', 64), true),
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('b', 64), true),
  ('b9910000-0000-4000-8000-000000000002', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('a', 64), false);
select pg_temp.preference_assert((select count(*) = 3 from public.integration_summary_preferences), 'viewer can save own preferences; workspace and logical entries are independent');

insert into public.integration_summary_preferences(workspace_id, user_id, summary_key, hidden_when_disconnected) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('a', 64), true)
on conflict (workspace_id, user_id, summary_key) do update set hidden_when_disconnected = excluded.hidden_when_disconnected;
select pg_temp.preference_assert((select count(*) = 3 from public.integration_summary_preferences), 'repeated hide is idempotent');
update public.integration_summary_preferences set hidden_when_disconnected = false
where workspace_id = 'b9910000-0000-4000-8000-000000000001' and summary_key = 'square:' || repeat('a', 64);
select pg_temp.preference_assert((select not hidden_when_disconnected from public.integration_summary_preferences
  where workspace_id = 'b9910000-0000-4000-8000-000000000001' and summary_key = 'square:' || repeat('a', 64)), 'restore saved');
select pg_temp.preference_assert((select hidden_when_disconnected from public.integration_summary_preferences
  where workspace_id = 'b9910000-0000-4000-8000-000000000001' and summary_key = 'square:' || repeat('b', 64)), 'restoring company A does not restore company B');
select pg_temp.preference_assert((select not hidden_when_disconnected from public.integration_summary_preferences
  where workspace_id = 'b9910000-0000-4000-8000-000000000002'), 'other workspace untouched');

select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002', 'square:' || repeat('c', 64))
$sql$), 'cannot insert for another account');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000003', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('c', 64))
$sql$), 'cannot insert in an inaccessible workspace');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.integration_summary_preferences set user_id = 'a9910000-0000-4000-8000-000000000002'
  where workspace_id = 'b9910000-0000-4000-8000-000000000001' and summary_key = 'square:' || repeat('a', 64)
$sql$), 'WITH CHECK prevents account reassignment');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  update public.integration_summary_preferences set workspace_id = 'b9910000-0000-4000-8000-000000000003'
  where workspace_id = 'b9910000-0000-4000-8000-000000000001' and summary_key = 'square:' || repeat('a', 64)
$sql$), 'WITH CHECK prevents unauthorized workspace reassignment');

select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000002', true);
update public.workspaces set name = 'Preference owner rename' where id = 'b9910000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select name = 'Preference owner rename' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'existing owner safe-column update remains usable');
update public.workspaces set reporting_timezone = 'UTC' where id = 'b9910000-0000-4000-8000-000000000001';
select pg_temp.preference_assert((select reporting_timezone = 'UTC' from public.workspaces
  where id = 'b9910000-0000-4000-8000-000000000001'), 'owner can update reporting timezone');
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences), 'workspace owner cannot read peer preferences');
with changed as (update public.integration_summary_preferences set hidden_when_disconnected = false returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'workspace owner cannot change peer preferences');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key, hidden_when_disconnected) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('b', 64), false)
  on conflict (workspace_id, user_id, summary_key) do update set hidden_when_disconnected = excluded.hidden_when_disconnected
$sql$), 'upsert cannot overwrite a peer preference');
insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000002', 'square:' || repeat('b', 64));
select pg_temp.preference_assert((select count(*) = 1 from public.integration_summary_preferences), 'same entry has separate account preferences');
select pg_temp.preference_assert((select not hidden_when_disconnected from public.integration_summary_preferences), 'new row defaults visible');

select set_config('request.jwt.claim.sub', 'a9910000-0000-4000-8000-000000000001', true);
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:raw-provider-id')
$sql$, '23514'), 'raw provider IDs cannot be stored');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('A', 64))
$sql$, '23514'), 'uppercase hashes cannot be stored');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('c', 64) || chr(10))
$sql$, '23514'), 'trailing newline cannot bypass key constraint');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', repeat('a', 1000))
$sql$, '23514'), 'oversized key cannot be stored');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  delete from public.integration_summary_preferences
$sql$), 'authenticated deletion is not granted');

reset role;
update public.workspace_members set status = 'disabled' where user_id = 'a9910000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences), 'disabled membership cannot read existing preferences');
with changed as (update public.integration_summary_preferences set hidden_when_disconnected = false returning *)
select pg_temp.preference_assert((select count(*) = 0 from changed), 'disabled membership cannot update existing preferences');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'google_sheets:' || repeat('d', 64))
$sql$), 'disabled membership cannot insert preferences');
reset role;
update public.workspace_members set status = 'invited' where user_id = 'a9910000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences), 'invited membership cannot read preferences');

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.preference_assert(pg_temp.preference_denied('select * from public.integration_summary_preferences'), 'anonymous read denied');
select pg_temp.preference_assert(pg_temp.preference_denied($sql$
  insert into public.integration_summary_preferences(workspace_id, user_id, summary_key) values
  ('b9910000-0000-4000-8000-000000000001', 'a9910000-0000-4000-8000-000000000001', 'square:' || repeat('c', 64))
$sql$), 'anonymous insert denied');
select pg_temp.preference_assert(pg_temp.preference_denied('update public.integration_summary_preferences set hidden_when_disconnected = false'), 'anonymous update denied');

reset role;
delete from auth.users where id = 'a9910000-0000-4000-8000-000000000002';
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences where user_id = 'a9910000-0000-4000-8000-000000000002'), 'account deletion removes preferences');
delete from public.workspaces where id = 'b9910000-0000-4000-8000-000000000002';
select pg_temp.preference_assert((select count(*) = 0 from public.integration_summary_preferences where workspace_id = 'b9910000-0000-4000-8000-000000000002'), 'workspace deletion removes preferences');

rollback;
