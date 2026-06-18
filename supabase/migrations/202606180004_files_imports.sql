alter table public.record_folders drop constraint if exists record_folders_collection_type_check;

alter table public.record_folders
  add constraint record_folders_collection_type_check check (
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
      'support_requests',
      'files'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-files',
  'workspace-files',
  false,
  26214400,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.file_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  folder_id uuid references public.record_folders(id) on delete set null,
  original_name text not null,
  display_name text not null,
  file_extension text not null,
  mime_type text not null,
  file_size_bytes bigint not null default 0,
  storage_bucket text not null default 'workspace-files',
  storage_path text not null,
  import_type text not null default 'none' check (import_type in ('none', 'kpi', 'crm', 'metrics')),
  import_status text not null default 'not_imported' check (import_status in ('not_imported', 'ready', 'imported', 'failed')),
  imported_rows integer not null default 0,
  analysis_prompt text,
  analysis_summary text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.file_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_upload_id uuid not null references public.file_uploads(id) on delete cascade,
  import_type text not null check (import_type in ('kpi', 'crm', 'metrics')),
  status text not null default 'completed' check (status in ('completed', 'failed')),
  rows_total integer not null default 0,
  rows_imported integer not null default 0,
  errors_json jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.file_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_upload_id uuid not null references public.file_uploads(id) on delete cascade,
  import_id uuid not null references public.file_imports(id) on delete cascade,
  import_type text not null check (import_type in ('kpi', 'crm', 'metrics')),
  row_number integer not null,
  data_json jsonb not null default '{}'::jsonb,
  status text not null default 'staged',
  created_at timestamptz not null default now()
);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_file_id uuid references public.file_uploads(id) on delete set null,
  lead_name text not null,
  company text,
  email text,
  phone text,
  status text not null default 'New',
  estimated_value numeric,
  owner text,
  notes text,
  raw_data_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.operational_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_file_id uuid references public.file_uploads(id) on delete set null,
  metric_name text not null,
  category text,
  value numeric,
  metric_date date not null default current_date,
  owner text,
  notes text,
  raw_data_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create index if not exists file_uploads_workspace_created_idx
  on public.file_uploads(workspace_id, created_at desc);

create index if not exists file_uploads_workspace_folder_idx
  on public.file_uploads(workspace_id, folder_id);

create index if not exists file_uploads_workspace_status_idx
  on public.file_uploads(workspace_id, import_status);

create index if not exists file_imports_workspace_file_idx
  on public.file_imports(workspace_id, file_upload_id);

create index if not exists file_import_rows_workspace_file_idx
  on public.file_import_rows(workspace_id, file_upload_id);

create index if not exists crm_leads_workspace_created_idx
  on public.crm_leads(workspace_id, created_at desc);

create index if not exists operational_metrics_workspace_date_idx
  on public.operational_metrics(workspace_id, metric_date desc);

drop trigger if exists set_file_uploads_updated_at on public.file_uploads;
create trigger set_file_uploads_updated_at
  before update on public.file_uploads
  for each row execute function public.set_updated_at();

drop trigger if exists set_crm_leads_updated_at on public.crm_leads;
create trigger set_crm_leads_updated_at
  before update on public.crm_leads
  for each row execute function public.set_updated_at();

drop trigger if exists set_operational_metrics_updated_at on public.operational_metrics;
create trigger set_operational_metrics_updated_at
  before update on public.operational_metrics
  for each row execute function public.set_updated_at();

alter table public.file_uploads enable row level security;
alter table public.file_imports enable row level security;
alter table public.file_import_rows enable row level security;
alter table public.crm_leads enable row level security;
alter table public.operational_metrics enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'file_uploads',
    'file_imports',
    'file_import_rows',
    'crm_leads',
    'operational_metrics'
  ]
  loop
    execute format('drop policy if exists "%s members read" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s members create" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s members update" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s managers delete" on public.%I', table_name, table_name);

    execute format('create policy "%s members read" on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name, table_name);
    execute format('create policy "%s members create" on public.%I for insert to authenticated with check (public.is_workspace_member(workspace_id))', table_name, table_name);
    execute format('create policy "%s members update" on public.%I for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', table_name, table_name);
    execute format('create policy "%s managers delete" on public.%I for delete to authenticated using (public.can_edit_operations(workspace_id))', table_name, table_name);
  end loop;
end $$;

grant select, insert, update, delete on public.file_uploads to authenticated;
grant select, insert, update, delete on public.file_imports to authenticated;
grant select, insert, update, delete on public.file_import_rows to authenticated;
grant select, insert, update, delete on public.crm_leads to authenticated;
grant select, insert, update, delete on public.operational_metrics to authenticated;

drop policy if exists "workspace files members read" on storage.objects;
create policy "workspace files members read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_workspace_member(split_part(name, '/', 1)::uuid)
  );

drop policy if exists "workspace files members insert" on storage.objects;
create policy "workspace files members insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_workspace_member(split_part(name, '/', 1)::uuid)
  );

drop policy if exists "workspace files members update" on storage.objects;
create policy "workspace files members update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_workspace_member(split_part(name, '/', 1)::uuid)
  )
  with check (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_workspace_member(split_part(name, '/', 1)::uuid)
  );

drop policy if exists "workspace files managers delete" on storage.objects;
create policy "workspace files managers delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_edit_operations(split_part(name, '/', 1)::uuid)
  );
