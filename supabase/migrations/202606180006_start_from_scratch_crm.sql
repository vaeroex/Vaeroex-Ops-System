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
      'crm_leads',
      'forms',
      'form_submissions',
      'ai_agent_runs',
      'assets',
      'asset_checks',
      'support_requests',
      'files'
    )
  );

alter table public.crm_leads
  add column if not exists folder_id uuid references public.record_folders(id) on delete set null;

create index if not exists crm_leads_workspace_folder_idx
  on public.crm_leads(workspace_id, folder_id);
