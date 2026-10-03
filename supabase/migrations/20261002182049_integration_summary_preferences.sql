begin;

alter table public.workspaces
  add column reporting_timezone text default null
  constraint workspaces_reporting_timezone_check
    check (reporting_timezone is null or (
      char_length(reporting_timezone) between 1 and 64
      and reporting_timezone ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)*$'
    ));

comment on column public.workspaces.reporting_timezone is
  'Workspace reporting display timezone. Null means unconfigured; entity and financial source timezones are unchanged. The constraint validates syntax and the trigger requires a recognized database timezone name.';

-- Existing workspace UPDATE RLS also permits admins. Restrict this new column
-- without changing the policies or access to any existing workspace columns.
create function public.guard_workspace_reporting_timezone_owner()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Separate statements keep restricted helpers out of service-role expression plans.
  if tg_op = 'UPDATE' and current_user = 'authenticated' then
    if not public.has_workspace_role(old.id, array['owner']) then
      raise exception 'Only an active workspace owner can change the reporting timezone.' using errcode = '42501';
    end if;
  end if;
  if new.reporting_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.reporting_timezone
  ) then
    raise exception 'Reporting timezone must be a recognized database timezone name.'
      using errcode = '23514', constraint = 'workspaces_reporting_timezone_check';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_workspace_reporting_timezone_owner() from public, anon, authenticated, service_role;
create trigger guard_workspace_reporting_timezone_owner
  before insert or update of reporting_timezone on public.workspaces
  for each row execute function public.guard_workspace_reporting_timezone_owner();
grant update (reporting_timezone) on public.workspaces to authenticated;

create table public.integration_summary_preferences (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_key text not null check (
    octet_length(summary_key) <= 82
    and summary_key ~ '^(square|quickbooks_online|google_sheets):[a-f0-9]{64}$'
  ),
  hidden_when_disconnected boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, summary_key)
);

comment on table public.integration_summary_preferences is
  'Personal display choices only. The dashboard applies hiding only to disconnected logical entries; connection and data lifecycle are unaffected.';

create trigger set_integration_summary_preferences_updated_at
  before update on public.integration_summary_preferences
  for each row execute function public.set_updated_at();

alter table public.integration_summary_preferences enable row level security;
revoke all on table public.integration_summary_preferences from public, anon, authenticated;
grant select, insert, update on table public.integration_summary_preferences to authenticated;

create policy "users read own integration summary preferences"
  on public.integration_summary_preferences for select to authenticated
  using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

create policy "users insert own integration summary preferences"
  on public.integration_summary_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

create policy "users update own integration summary preferences"
  on public.integration_summary_preferences for update to authenticated
  using (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
  with check (user_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

commit;
