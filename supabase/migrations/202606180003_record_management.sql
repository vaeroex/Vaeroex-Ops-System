create table if not exists public.record_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_type text not null,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_folders_collection_type_check check (
    collection_type in (
      'sops',
      'tasks',
      'checklists',
      'checklist_runs',
      'issues',
      'reports',
      'kpis',
      'forms',
      'form_submissions',
      'ai_agent_runs',
      'assets',
      'asset_checks',
      'support_requests'
    )
  )
);

create index if not exists record_folders_workspace_collection_idx
  on public.record_folders(workspace_id, collection_type, archived_at);

alter table public.record_folders enable row level security;

drop policy if exists "record folder members read" on public.record_folders;
create policy "record folder members read"
  on public.record_folders for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "record folder members insert" on public.record_folders;
drop policy if exists "record folder managers insert" on public.record_folders;
create policy "record folder members insert"
  on public.record_folders for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "record folder members update" on public.record_folders;
drop policy if exists "record folder managers update" on public.record_folders;
create policy "record folder members update"
  on public.record_folders for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "record folder admins delete" on public.record_folders;
create policy "record folder admins delete"
  on public.record_folders for delete
  to authenticated
  using (public.can_manage_workspace(workspace_id));

drop trigger if exists set_record_folders_updated_at on public.record_folders;
create trigger set_record_folders_updated_at
  before update on public.record_folders
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.record_folders to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'forms',
    'form_submissions',
    'checklists',
    'checklist_runs',
    'tasks',
    'issues',
    'assets',
    'asset_checks',
    'sops',
    'reports',
    'ai_agent_runs',
    'kpis',
    'support_requests'
  ]
  loop
    execute format('alter table public.%I add column if not exists folder_id uuid references public.record_folders(id) on delete set null', table_name);
    execute format('alter table public.%I add column if not exists archived_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', table_name);
    execute format('create index if not exists %I on public.%I(workspace_id, folder_id)', table_name || '_folder_idx', table_name);
    execute format('create index if not exists %I on public.%I(workspace_id, archived_at)', table_name || '_archived_idx', table_name);
    execute format('create index if not exists %I on public.%I(workspace_id, deleted_at)', table_name || '_deleted_idx', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'form_submissions',
    'checklist_runs',
    'asset_checks',
    'reports',
    'ai_agent_runs'
  ]
  loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', table_name);
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'set_' || table_name || '_updated_at', table_name);
  end loop;
end $$;
