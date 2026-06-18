alter table public.file_uploads drop constraint if exists file_uploads_import_status_check;

alter table public.file_uploads
  add constraint file_uploads_import_status_check check (
    import_status in ('not_imported', 'ready', 'extracted', 'imported', 'failed')
  );

alter table public.file_imports drop constraint if exists file_imports_status_check;

alter table public.file_imports
  add constraint file_imports_status_check check (
    status in ('extracted', 'needs_review', 'completed', 'failed')
  );

alter table public.file_imports
  add column if not exists mapping_json jsonb not null default '{}'::jsonb,
  add column if not exists extraction_summary text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists imported_at timestamptz;

alter table public.file_import_rows
  add column if not exists mapped_data_json jsonb not null default '{}'::jsonb,
  add column if not exists validation_errors_json jsonb not null default '[]'::jsonb,
  add column if not exists imported_record_type text,
  add column if not exists imported_record_id uuid;

alter table public.kpis
  add column if not exists source_file_id uuid references public.file_uploads(id) on delete set null,
  add column if not exists import_id uuid references public.file_imports(id) on delete set null,
  add column if not exists import_row_id uuid references public.file_import_rows(id) on delete set null,
  add column if not exists raw_data_json jsonb not null default '{}'::jsonb;

alter table public.crm_leads
  add column if not exists import_id uuid references public.file_imports(id) on delete set null,
  add column if not exists import_row_id uuid references public.file_import_rows(id) on delete set null,
  add column if not exists last_activity_at timestamptz;

alter table public.operational_metrics
  add column if not exists import_id uuid references public.file_imports(id) on delete set null,
  add column if not exists import_row_id uuid references public.file_import_rows(id) on delete set null;

create table if not exists public.crm_lead_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  source_file_id uuid references public.file_uploads(id) on delete set null,
  import_id uuid references public.file_imports(id) on delete set null,
  import_row_id uuid references public.file_import_rows(id) on delete set null,
  event_type text not null default 'import' check (event_type in ('created', 'updated', 'import', 'note')),
  status text,
  estimated_value numeric,
  owner text,
  notes text,
  raw_data_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists file_imports_workspace_status_idx
  on public.file_imports(workspace_id, status, created_at desc);

create index if not exists file_import_rows_workspace_status_idx
  on public.file_import_rows(workspace_id, import_id, status);

create index if not exists kpis_workspace_source_file_idx
  on public.kpis(workspace_id, source_file_id, metric_date desc);

create index if not exists kpis_workspace_import_idx
  on public.kpis(workspace_id, import_id);

create index if not exists crm_leads_workspace_email_idx
  on public.crm_leads(workspace_id, email);

create index if not exists crm_leads_workspace_import_idx
  on public.crm_leads(workspace_id, import_id);

create index if not exists crm_lead_history_workspace_lead_idx
  on public.crm_lead_history(workspace_id, lead_id, created_at desc);

create index if not exists crm_lead_history_workspace_import_idx
  on public.crm_lead_history(workspace_id, import_id);

create index if not exists operational_metrics_workspace_import_idx
  on public.operational_metrics(workspace_id, import_id);

alter table public.crm_lead_history enable row level security;

drop policy if exists "crm lead history members read" on public.crm_lead_history;
create policy "crm lead history members read"
  on public.crm_lead_history for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "crm lead history members create" on public.crm_lead_history;
create policy "crm lead history members create"
  on public.crm_lead_history for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm lead history members update" on public.crm_lead_history;
create policy "crm lead history members update"
  on public.crm_lead_history for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm lead history managers delete" on public.crm_lead_history;
create policy "crm lead history managers delete"
  on public.crm_lead_history for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

grant select, insert, update, delete on public.crm_lead_history to authenticated;
