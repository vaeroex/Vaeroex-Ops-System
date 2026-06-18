alter table public.file_uploads
  add column if not exists processing_status text not null default 'uploaded',
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

alter table public.file_uploads drop constraint if exists file_uploads_processing_status_check;

alter table public.file_uploads
  add constraint file_uploads_processing_status_check check (
    processing_status in ('uploaded', 'processing', 'ready', 'failed')
  );

create index if not exists file_uploads_workspace_processing_status_idx
  on public.file_uploads(workspace_id, processing_status, created_at desc);
