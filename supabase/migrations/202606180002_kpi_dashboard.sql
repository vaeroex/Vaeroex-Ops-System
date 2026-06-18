create table if not exists public.kpis (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  category text,
  target numeric,
  actual_value numeric,
  metric_date date not null default current_date,
  owner text,
  notes text,
  source text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kpis_workspace_date_idx
  on public.kpis(workspace_id, metric_date desc);

create index if not exists kpis_workspace_category_idx
  on public.kpis(workspace_id, category);

drop trigger if exists set_kpis_updated_at on public.kpis;

create trigger set_kpis_updated_at
  before update on public.kpis
  for each row execute function public.set_updated_at();

alter table public.kpis enable row level security;

drop policy if exists "kpis members read" on public.kpis;
drop policy if exists "kpis managers write" on public.kpis;
drop policy if exists "kpis members create" on public.kpis;
drop policy if exists "kpis managers update" on public.kpis;
drop policy if exists "kpis managers delete" on public.kpis;

create policy "kpis members read"
  on public.kpis for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "kpis members create"
  on public.kpis for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "kpis managers update"
  on public.kpis for update
  to authenticated
  using (public.can_edit_operations(workspace_id))
  with check (public.can_edit_operations(workspace_id));

create policy "kpis managers delete"
  on public.kpis for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

grant select, insert, update, delete on public.kpis to authenticated;
