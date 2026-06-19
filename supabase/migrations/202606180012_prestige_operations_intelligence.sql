create table if not exists public.business_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  reason text,
  expected_outcome text,
  related_kpi text,
  related_report_id uuid references public.reports(id) on delete set null,
  related_issue_id uuid references public.issues(id) on delete set null,
  related_sop_id uuid references public.sops(id) on delete set null,
  owner text,
  review_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'reviewed', 'completed', 'dismissed')),
  outcome_summary text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.vaeroex_recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  source_type text not null default 'vaeroex_recommendation',
  source_id uuid,
  source_title text,
  evidence text,
  related_module text,
  related_kpi text,
  related_report_id uuid references public.reports(id) on delete set null,
  related_file_id uuid references public.file_uploads(id) on delete set null,
  related_issue_id uuid references public.issues(id) on delete set null,
  related_task_id uuid references public.tasks(id) on delete set null,
  expected_outcome text,
  created_action_type text,
  created_action_id uuid,
  owner text,
  priority text not null default 'Medium',
  review_date date,
  status text not null default 'suggested' check (
    status in ('suggested', 'accepted', 'assigned', 'in_progress', 'completed', 'dismissed', 'reviewed', 'outcome_measured')
  ),
  outcome_summary text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create index if not exists business_decisions_workspace_status_idx
  on public.business_decisions(workspace_id, status, review_date, created_at desc);

create index if not exists vaeroex_recommendation_outcomes_workspace_status_idx
  on public.vaeroex_recommendation_outcomes(workspace_id, status, review_date, created_at desc);

drop trigger if exists set_business_decisions_updated_at on public.business_decisions;
create trigger set_business_decisions_updated_at
  before update on public.business_decisions
  for each row execute function public.set_updated_at();

drop trigger if exists set_vaeroex_recommendation_outcomes_updated_at on public.vaeroex_recommendation_outcomes;
create trigger set_vaeroex_recommendation_outcomes_updated_at
  before update on public.vaeroex_recommendation_outcomes
  for each row execute function public.set_updated_at();

alter table public.business_decisions enable row level security;
alter table public.vaeroex_recommendation_outcomes enable row level security;

drop policy if exists "business decisions members read" on public.business_decisions;
create policy "business decisions members read"
  on public.business_decisions for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "business decisions managers create" on public.business_decisions;
create policy "business decisions managers create"
  on public.business_decisions for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "business decisions managers update" on public.business_decisions;
create policy "business decisions managers update"
  on public.business_decisions for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "business decisions managers delete" on public.business_decisions;
create policy "business decisions managers delete"
  on public.business_decisions for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

drop policy if exists "recommendation outcomes members read" on public.vaeroex_recommendation_outcomes;
create policy "recommendation outcomes members read"
  on public.vaeroex_recommendation_outcomes for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "recommendation outcomes managers create" on public.vaeroex_recommendation_outcomes;
create policy "recommendation outcomes managers create"
  on public.vaeroex_recommendation_outcomes for insert
  to authenticated
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "recommendation outcomes managers update" on public.vaeroex_recommendation_outcomes;
create policy "recommendation outcomes managers update"
  on public.vaeroex_recommendation_outcomes for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

drop policy if exists "recommendation outcomes managers delete" on public.vaeroex_recommendation_outcomes;
create policy "recommendation outcomes managers delete"
  on public.vaeroex_recommendation_outcomes for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

grant select, insert, update, delete on public.business_decisions to authenticated;
grant select, insert, update, delete on public.vaeroex_recommendation_outcomes to authenticated;
