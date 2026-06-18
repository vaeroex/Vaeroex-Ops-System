alter table public.people
  add column if not exists folder_id uuid references public.record_folders(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists people_folder_idx on public.people(workspace_id, folder_id);
create index if not exists people_archived_idx on public.people(workspace_id, archived_at);
create index if not exists people_deleted_idx on public.people(workspace_id, deleted_at);
