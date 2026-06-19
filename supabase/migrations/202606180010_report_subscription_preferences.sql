create table if not exists public.report_subscription_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null check (
    category in (
      'weekly_review',
      'weekly_planning',
      'monthly_executive_summary',
      'quarterly_business_review',
      'critical_kpi_alerts',
      'shared_reports',
      'assigned_tasks'
    )
  ),
  preference_scope text not null default 'workspace' check (preference_scope in ('workspace', 'role', 'person')),
  person_id uuid references public.people(id) on delete cascade,
  role text,
  email_status text not null default 'disabled' check (email_status in ('enabled', 'disabled', 'paused')),
  pause_until date,
  last_generated_at timestamptz,
  last_notified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint report_subscription_scope_target_check check (
    (preference_scope = 'workspace' and person_id is null and role is null)
    or (preference_scope = 'role' and person_id is null and role is not null)
    or (preference_scope = 'person' and person_id is not null)
  )
);

create unique index if not exists report_subscription_preferences_unique_idx
  on public.report_subscription_preferences (
    workspace_id,
    category,
    preference_scope,
    coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(role, '')
  )
  where deleted_at is null;

create index if not exists report_subscription_preferences_workspace_idx
  on public.report_subscription_preferences(workspace_id, category, preference_scope, email_status);

create table if not exists public.scheduled_report_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null,
  report_id uuid references public.reports(id) on delete set null,
  run_date date not null,
  status text not null default 'pending' check (status in ('pending', 'generated', 'skipped', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists scheduled_report_runs_workspace_category_date_idx
  on public.scheduled_report_runs(workspace_id, category, run_date);

create index if not exists scheduled_report_runs_workspace_status_idx
  on public.scheduled_report_runs(workspace_id, status, run_date desc);

drop trigger if exists set_report_subscription_preferences_updated_at on public.report_subscription_preferences;
create trigger set_report_subscription_preferences_updated_at
  before update on public.report_subscription_preferences
  for each row execute function public.set_updated_at();

alter table public.report_subscription_preferences enable row level security;
alter table public.scheduled_report_runs enable row level security;

drop policy if exists "report subscription preferences members read" on public.report_subscription_preferences;
create policy "report subscription preferences members read"
  on public.report_subscription_preferences for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "report subscription preferences managers create" on public.report_subscription_preferences;
create policy "report subscription preferences managers create"
  on public.report_subscription_preferences for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "report subscription preferences managers update" on public.report_subscription_preferences;
create policy "report subscription preferences managers update"
  on public.report_subscription_preferences for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "report subscription preferences managers delete" on public.report_subscription_preferences;
create policy "report subscription preferences managers delete"
  on public.report_subscription_preferences for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

drop policy if exists "scheduled report runs members read" on public.scheduled_report_runs;
create policy "scheduled report runs members read"
  on public.scheduled_report_runs for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "scheduled report runs managers create" on public.scheduled_report_runs;
create policy "scheduled report runs managers create"
  on public.scheduled_report_runs for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "scheduled report runs managers update" on public.scheduled_report_runs;
create policy "scheduled report runs managers update"
  on public.scheduled_report_runs for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

grant select, insert, update, delete on public.report_subscription_preferences to authenticated;
grant select, insert, update on public.scheduled_report_runs to authenticated;
