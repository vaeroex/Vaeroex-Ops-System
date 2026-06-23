create table if not exists public.kpi_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kpi_name text not null,
  category text,
  target numeric,
  weight numeric not null default 1 check (weight >= 0 and weight <= 10),
  definition text,
  color text not null default '#1E6BFF',
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_settings_name_not_blank check (length(btrim(kpi_name)) > 0),
  constraint kpi_settings_color_palette_check check (
    color in (
      '#1E6BFF',
      '#38BDF8',
      '#0B1F4D',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#F97316',
      '#14B8A6',
      '#D1D5DB'
    )
  ),
  constraint kpi_settings_workspace_name_unique unique (workspace_id, kpi_name)
);

create index if not exists kpi_settings_workspace_visible_idx
  on public.kpi_settings(workspace_id, is_visible, sort_order, weight desc);

drop trigger if exists set_kpi_settings_updated_at on public.kpi_settings;

create trigger set_kpi_settings_updated_at
  before update on public.kpi_settings
  for each row execute function public.set_updated_at();

alter table public.kpi_settings enable row level security;

drop policy if exists "kpi settings members read" on public.kpi_settings;
drop policy if exists "kpi settings admins create" on public.kpi_settings;
drop policy if exists "kpi settings admins update" on public.kpi_settings;
drop policy if exists "kpi settings admins delete" on public.kpi_settings;

create policy "kpi settings members read"
  on public.kpi_settings for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "kpi settings admins create"
  on public.kpi_settings for insert
  to authenticated
  with check (public.can_manage_workspace(workspace_id));

create policy "kpi settings admins update"
  on public.kpi_settings for update
  to authenticated
  using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create policy "kpi settings admins delete"
  on public.kpi_settings for delete
  to authenticated
  using (public.can_manage_workspace(workspace_id));

grant select, insert, update, delete on public.kpi_settings to authenticated;
