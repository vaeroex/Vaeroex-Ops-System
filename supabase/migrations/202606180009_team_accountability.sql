alter table public.people
  add column if not exists role_title text,
  add column if not exists department text;

alter table public.tasks
  add column if not exists assigned_person_id uuid references public.people(id) on delete set null,
  add column if not exists assigned_role text,
  add column if not exists assigned_department text;

alter table public.issues
  add column if not exists assigned_person_id uuid references public.people(id) on delete set null,
  add column if not exists assigned_role text,
  add column if not exists assigned_department text;

alter table public.checklist_runs
  add column if not exists assigned_person_id uuid references public.people(id) on delete set null,
  add column if not exists assigned_role text,
  add column if not exists assigned_department text,
  add column if not exists due_date date,
  add column if not exists priority text not null default 'Medium';

alter table public.notifications
  add column if not exists priority text not null default 'Medium',
  add column if not exists related_module text,
  add column if not exists related_record_type text,
  add column if not exists related_record_id uuid,
  add column if not exists action_label text,
  add column if not exists action_href text,
  add column if not exists recipient_scope text not null default 'workspace',
  add column if not exists recipient_person_id uuid references public.people(id) on delete set null,
  add column if not exists recipient_role text,
  add column if not exists recipient_department text,
  add column if not exists metadata_json jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.record_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  source_title text not null,
  share_scope text not null default 'workspace' check (share_scope in ('person', 'role', 'department', 'workspace')),
  person_id uuid references public.people(id) on delete set null,
  role text,
  department text,
  message text,
  distribution_schedule text not null default 'one_time' check (distribution_schedule in ('one_time', 'daily', 'weekly', 'monthly', 'quarterly')),
  last_shared_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.operational_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null,
  source_id uuid,
  source_title text,
  title text not null,
  description text,
  assigned_person_id uuid references public.people(id) on delete set null,
  assigned_role text,
  assigned_department text,
  due_date date,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Waiting', 'Done', 'Dismissed')),
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.kpi_alert_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kpi_name text not null,
  condition_type text not null check (condition_type in ('below_target', 'above_target', 'change_percent', 'declined_2_periods', 'no_update_this_month')),
  threshold_value numeric,
  recipient_scope text not null default 'workspace' check (recipient_scope in ('person', 'role', 'department', 'workspace')),
  person_id uuid references public.people(id) on delete set null,
  role text,
  department text,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.kpi_alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_id uuid references public.kpi_alert_rules(id) on delete cascade,
  kpi_id uuid references public.kpis(id) on delete set null,
  title text not null,
  message text not null,
  priority text not null default 'Medium',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists people_workspace_role_department_idx
  on public.people(workspace_id, role_title, department);

create index if not exists tasks_workspace_operational_assignment_idx
  on public.tasks(workspace_id, assigned_person_id, assigned_role, assigned_department);

create index if not exists issues_workspace_operational_assignment_idx
  on public.issues(workspace_id, assigned_person_id, assigned_role, assigned_department);

create index if not exists notifications_workspace_read_priority_idx
  on public.notifications(workspace_id, read_at, priority, created_at desc);

create index if not exists record_shares_workspace_source_idx
  on public.record_shares(workspace_id, source_type, source_id, created_at desc);

create index if not exists operational_assignments_workspace_due_idx
  on public.operational_assignments(workspace_id, status, due_date);

create index if not exists kpi_alert_rules_workspace_kpi_idx
  on public.kpi_alert_rules(workspace_id, kpi_name, is_active);

create index if not exists kpi_alert_events_workspace_rule_idx
  on public.kpi_alert_events(workspace_id, rule_id, created_at desc);

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

drop trigger if exists set_record_shares_updated_at on public.record_shares;
create trigger set_record_shares_updated_at
  before update on public.record_shares
  for each row execute function public.set_updated_at();

drop trigger if exists set_operational_assignments_updated_at on public.operational_assignments;
create trigger set_operational_assignments_updated_at
  before update on public.operational_assignments
  for each row execute function public.set_updated_at();

drop trigger if exists set_kpi_alert_rules_updated_at on public.kpi_alert_rules;
create trigger set_kpi_alert_rules_updated_at
  before update on public.kpi_alert_rules
  for each row execute function public.set_updated_at();

alter table public.record_shares enable row level security;
alter table public.operational_assignments enable row level security;
alter table public.kpi_alert_rules enable row level security;
alter table public.kpi_alert_events enable row level security;

drop policy if exists "members can read notifications" on public.notifications;
create policy "members can read notifications"
  on public.notifications for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "users can mark own notifications read" on public.notifications;
create policy "members can update notifications"
  on public.notifications for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "managers can create notifications" on public.notifications;
create policy "managers can create notifications"
  on public.notifications for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "managers can delete notifications" on public.notifications;
create policy "managers can delete notifications"
  on public.notifications for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'record_shares',
    'operational_assignments',
    'kpi_alert_rules',
    'kpi_alert_events'
  ]
  loop
    execute format('drop policy if exists "%s members read" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s managers create" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s managers update" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s managers delete" on public.%I', table_name, table_name);

    execute format('create policy "%s members read" on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers create" on public.%I for insert to authenticated with check (public.can_edit_operations(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers update" on public.%I for update to authenticated using (public.can_edit_operations(workspace_id)) with check (public.can_edit_operations(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers delete" on public.%I for delete to authenticated using (public.can_edit_operations(workspace_id))', table_name, table_name);
  end loop;
end $$;

grant select, insert, update, delete on public.record_shares to authenticated;
grant select, insert, update, delete on public.operational_assignments to authenticated;
grant select, insert, update, delete on public.kpi_alert_rules to authenticated;
grant select, insert, update, delete on public.kpi_alert_events to authenticated;
