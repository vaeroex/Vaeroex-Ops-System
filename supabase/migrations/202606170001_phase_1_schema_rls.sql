create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();

  return new;
end;
$$;

create table public.profiles (
  id uuid primary key,
  full_name text,
  email text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  size text,
  logo_url text,
  primary_contact_name text,
  primary_contact_email text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'staff', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  invited_email text,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint workspace_members_user_or_invite check (user_id is not null or invited_email is not null)
);

create unique index workspace_members_unique_user
  on public.workspace_members(workspace_id, user_id)
  where user_id is not null;

create unique index workspace_members_unique_invite
  on public.workspace_members(workspace_id, lower(invited_email))
  where invited_email is not null;

create table public.business_intakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_name text,
  industry text,
  team_size text,
  locations text,
  current_tools text,
  biggest_operational_problems text,
  repeated_missed_tasks text,
  customer_followup_process text,
  employee_accountability_process text,
  reporting_process text,
  equipment_or_asset_process text,
  onboarding_process text,
  ideal_outcome text,
  monthly_budget_range text,
  urgency_level text,
  raw_answers_json jsonb not null default '{}'::jsonb,
  ai_summary text,
  ai_recommendations text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  department text,
  trigger_event text,
  steps_json jsonb not null default '[]'::jsonb,
  owner_role text,
  status text not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  form_type text,
  schema_json jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,
  public_slug text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index forms_public_slug_unique
  on public.forms(public_slug)
  where public_slug is not null;

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitter_name text,
  submitter_email text,
  data_json jsonb not null default '{}'::jsonb,
  ai_summary text,
  ai_detected_priority text,
  ai_detected_followups_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  category text,
  frequency text,
  items_json jsonb not null default '[]'::jsonb,
  assigned_role text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'open',
  responses_json jsonb not null default '{}'::jsonb,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'To Do',
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  category text,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date date,
  related_type text,
  related_id uuid,
  ai_generated boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text,
  issue_type text,
  severity text not null default 'Medium',
  status text not null default 'Open',
  root_cause text,
  recommended_fix text,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_name text not null,
  asset_type text,
  identifier text,
  location text,
  status text not null default 'Ready',
  assigned_to uuid references public.profiles(id) on delete set null,
  last_checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.asset_checks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  checked_by uuid references public.profiles(id) on delete set null,
  status text not null,
  notes text,
  photos_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  role_title text,
  department text,
  status text not null default 'active',
  start_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  department text,
  category text,
  body_markdown text,
  status text not null default 'Draft',
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  report_type text not null,
  title text not null,
  date_range_start date,
  date_range_end date,
  body_markdown text,
  source_data_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_type text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index on public.workspace_members(workspace_id);
create index on public.workspace_members(user_id);
create index on public.business_intakes(workspace_id);
create index on public.workflow_maps(workspace_id);
create index on public.forms(workspace_id);
create index on public.form_submissions(workspace_id, form_id);
create index on public.checklists(workspace_id);
create index on public.checklist_runs(workspace_id, checklist_id);
create index on public.tasks(workspace_id, status, priority);
create index on public.issues(workspace_id, status, severity);
create index on public.assets(workspace_id, status);
create index on public.asset_checks(workspace_id, asset_id);
create index on public.people(workspace_id);
create index on public.sops(workspace_id, status);
create index on public.reports(workspace_id, created_at desc);
create index on public.ai_agent_runs(workspace_id, created_at desc);
create index on public.notifications(workspace_id, user_id, read_at);
create index on public.audit_logs(workspace_id, created_at desc);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function public.workspace_member_role(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active'
  limit 1;
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_member_role(target_workspace_id) = any(allowed_roles), false);
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(target_workspace_id, array['owner', 'admin']);
$$;

create or replace function public.can_edit_operations(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(target_workspace_id, array['owner', 'admin', 'manager']);
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'workspaces',
    'workspace_members',
    'business_intakes',
    'workflow_maps',
    'forms',
    'form_submissions',
    'checklists',
    'checklist_runs',
    'tasks',
    'issues',
    'assets',
    'asset_checks',
    'people',
    'sops',
    'reports',
    'ai_agent_runs',
    'notifications',
    'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy "profiles can read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "workspace members can read member profiles"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members viewer
      join public.workspace_members target
        on target.workspace_id = viewer.workspace_id
      where viewer.user_id = auth.uid()
        and viewer.status = 'active'
        and target.user_id = profiles.id
        and target.status = 'active'
    )
  );

create policy "profiles can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "members can read workspaces"
  on public.workspaces for select
  to authenticated
  using (public.is_workspace_member(id));

create policy "authenticated users can create workspaces"
  on public.workspaces for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "owners and admins can update workspaces"
  on public.workspaces for update
  to authenticated
  using (public.can_manage_workspace(id))
  with check (public.can_manage_workspace(id));

create policy "owners can delete workspaces"
  on public.workspaces for delete
  to authenticated
  using (public.has_workspace_role(id, array['owner']));

create policy "members can read workspace members"
  on public.workspace_members for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "workspace creator can add owner membership"
  on public.workspace_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from public.workspaces w
      where w.id = workspace_id
        and w.created_by = auth.uid()
    )
  );

create policy "owners and admins can invite members"
  on public.workspace_members for insert
  to authenticated
  with check (public.can_manage_workspace(workspace_id));

create policy "owners and admins can update members"
  on public.workspace_members for update
  to authenticated
  using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy "owners and admins can delete members"
  on public.workspace_members for delete
  to authenticated
  using (public.can_manage_workspace(workspace_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'business_intakes',
    'workflow_maps',
    'forms',
    'checklists',
    'issues',
    'assets',
    'people',
    'sops',
    'reports',
    'ai_agent_runs',
    'audit_logs'
  ]
  loop
    execute format('create policy "%s members read" on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers write" on public.%I for insert to authenticated with check (public.can_edit_operations(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers update" on public.%I for update to authenticated using (public.can_edit_operations(workspace_id)) with check (public.can_edit_operations(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers delete" on public.%I for delete to authenticated using (public.can_edit_operations(workspace_id))', table_name, table_name);
  end loop;
end $$;

create policy "public can read public forms"
  on public.forms for select
  to anon, authenticated
  using (is_public = true and public_slug is not null);

create policy "members can read form submissions"
  on public.form_submissions for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "members can create form submissions"
  on public.form_submissions for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "managers can update form submissions"
  on public.form_submissions for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

create policy "public can submit public forms"
  on public.form_submissions for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.forms f
      where f.id = form_submissions.form_id
        and f.workspace_id = form_submissions.workspace_id
        and f.is_public = true
        and f.public_slug is not null
    )
  );

create policy "members can read checklist runs"
  on public.checklist_runs for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "managers can create checklist runs"
  on public.checklist_runs for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

create policy "managers can update checklist runs"
  on public.checklist_runs for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

create policy "assigned users can complete checklist runs"
  on public.checklist_runs for update
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and assigned_to = auth.uid()
  )
  with check (
    public.is_workspace_member(workspace_id)
    and assigned_to = auth.uid()
  );

create policy "managers can delete checklist runs"
  on public.checklist_runs for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

create policy "members can read tasks"
  on public.tasks for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "managers can create tasks"
  on public.tasks for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

create policy "managers can update tasks"
  on public.tasks for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

create policy "assigned users can update assigned tasks"
  on public.tasks for update
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and assigned_to = auth.uid()
  )
  with check (
    public.is_workspace_member(workspace_id)
    and assigned_to = auth.uid()
  );

create policy "managers can delete tasks"
  on public.tasks for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

create policy "members can read asset checks"
  on public.asset_checks for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "members can create asset checks"
  on public.asset_checks for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "managers can update asset checks"
  on public.asset_checks for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

create policy "managers can delete asset checks"
  on public.asset_checks for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

create policy "members can read notifications"
  on public.notifications for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_workspace(workspace_id)
  );

create policy "users can mark own notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "managers can create notifications"
  on public.notifications for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'workspaces',
    'business_intakes',
    'workflow_maps',
    'forms',
    'checklists',
    'tasks',
    'issues',
    'assets',
    'people',
    'sops'
  ]
  loop
    execute format('create trigger set_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

comment on table public.form_submissions is 'Public submissions must be created through a slug lookup in the app. RLS also verifies the target form is public.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
