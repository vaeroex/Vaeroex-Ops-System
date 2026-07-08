create table if not exists public.business_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  snapshot_date date not null default current_date,
  score integer not null check (score between 0 and 100),
  status text not null check (status in ('Strong', 'Watch', 'At Risk', 'Insufficient Data')),
  trend text not null,
  data_confidence text not null,
  data_quality_score integer not null default 0 check (data_quality_score between 0 and 100),
  memory_signal_count integer not null default 0 check (memory_signal_count >= 0),
  source_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, snapshot_date)
);

create index if not exists business_health_snapshots_workspace_date_idx
  on public.business_health_snapshots(workspace_id, snapshot_date desc);

drop trigger if exists set_business_health_snapshots_updated_at on public.business_health_snapshots;
create trigger set_business_health_snapshots_updated_at
  before update on public.business_health_snapshots
  for each row execute function public.set_updated_at();

alter table public.business_health_snapshots enable row level security;

drop policy if exists "business health snapshots members read" on public.business_health_snapshots;
drop policy if exists "business health snapshots members create" on public.business_health_snapshots;
drop policy if exists "business health snapshots members update" on public.business_health_snapshots;
drop policy if exists "business health snapshots managers delete" on public.business_health_snapshots;

create policy "business health snapshots members read"
  on public.business_health_snapshots for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "business health snapshots members create"
  on public.business_health_snapshots for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "business health snapshots members update"
  on public.business_health_snapshots for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "business health snapshots managers delete"
  on public.business_health_snapshots for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

grant select, insert, update, delete on public.business_health_snapshots to authenticated;
