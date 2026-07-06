create schema if not exists extensions;
create extension if not exists vector with schema extensions;

alter table public.file_uploads
  add column if not exists index_status text not null default 'not_indexed',
  add column if not exists indexed_at timestamptz,
  add column if not exists indexed_chunk_count integer not null default 0,
  add column if not exists index_error text;

alter table public.file_uploads drop constraint if exists file_uploads_index_status_check;
alter table public.file_uploads
  add constraint file_uploads_index_status_check check (
    index_status in ('not_indexed', 'queued', 'processing', 'ready', 'failed')
  );

alter table public.ai_usage
  add column if not exists model text,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists request_id text,
  add column if not exists latency_ms integer,
  add column if not exists status text not null default 'completed',
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

create table if not exists public.file_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_upload_id uuid not null references public.file_uploads(id) on delete cascade,
  job_type text not null default 'index' check (job_type in ('extract', 'index', 'analyze', 'import')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'retry')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_memory_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (
    source_type in (
      'file',
      'file_analysis',
      'report',
      'kpi',
      'crm',
      'business_signal',
      'manual',
      'generated_output'
    )
  ),
  source_id uuid,
  source_file_id uuid references public.file_uploads(id) on delete set null,
  source_title text not null,
  source_excerpt text not null,
  summary text,
  chunk_index integer not null default 0,
  content_hash text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  source_metadata jsonb not null default '{}'::jsonb,
  source_quality text not null default 'medium' check (source_quality in ('low', 'medium', 'high')),
  confidence_score integer not null default 25 check (confidence_score between 0 and 100),
  token_estimate integer not null default 0,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create unique index if not exists business_memory_chunks_source_hash_idx
  on public.business_memory_chunks(workspace_id, source_type, source_id, content_hash, chunk_index);

create index if not exists business_memory_chunks_workspace_idx
  on public.business_memory_chunks(workspace_id, source_type, indexed_at desc)
  where deleted_at is null;

create index if not exists business_memory_chunks_file_idx
  on public.business_memory_chunks(workspace_id, source_file_id, indexed_at desc)
  where source_file_id is not null and deleted_at is null;

create index if not exists business_memory_chunks_embedding_idx
  on public.business_memory_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null and deleted_at is null;

create index if not exists file_processing_jobs_workspace_status_idx
  on public.file_processing_jobs(workspace_id, status, queued_at desc);

create index if not exists ai_usage_workspace_status_idx
  on public.ai_usage(workspace_id, status, created_at desc);

drop trigger if exists set_file_processing_jobs_updated_at on public.file_processing_jobs;
create trigger set_file_processing_jobs_updated_at
  before update on public.file_processing_jobs
  for each row execute function public.set_updated_at();

drop trigger if exists set_business_memory_chunks_updated_at on public.business_memory_chunks;
create trigger set_business_memory_chunks_updated_at
  before update on public.business_memory_chunks
  for each row execute function public.set_updated_at();

alter table public.file_processing_jobs enable row level security;
alter table public.business_memory_chunks enable row level security;

drop policy if exists "file processing jobs members read" on public.file_processing_jobs;
drop policy if exists "file processing jobs members create" on public.file_processing_jobs;
drop policy if exists "file processing jobs members update" on public.file_processing_jobs;
drop policy if exists "file processing jobs managers delete" on public.file_processing_jobs;

create policy "file processing jobs members read"
  on public.file_processing_jobs for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "file processing jobs members create"
  on public.file_processing_jobs for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "file processing jobs members update"
  on public.file_processing_jobs for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "file processing jobs managers delete"
  on public.file_processing_jobs for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

drop policy if exists "business memory chunks members read" on public.business_memory_chunks;
drop policy if exists "business memory chunks members create" on public.business_memory_chunks;
drop policy if exists "business memory chunks members update" on public.business_memory_chunks;
drop policy if exists "business memory chunks managers delete" on public.business_memory_chunks;

create policy "business memory chunks members read"
  on public.business_memory_chunks for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "business memory chunks members create"
  on public.business_memory_chunks for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "business memory chunks members update"
  on public.business_memory_chunks for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "business memory chunks managers delete"
  on public.business_memory_chunks for delete
  to authenticated
  using (public.can_edit_operations(workspace_id));

create or replace function public.match_business_memory_chunks(
  target_workspace_id uuid,
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  min_similarity double precision default 0.1
)
returns table (
  id uuid,
  workspace_id uuid,
  source_type text,
  source_id uuid,
  source_file_id uuid,
  source_title text,
  source_excerpt text,
  summary text,
  chunk_index integer,
  source_metadata jsonb,
  source_quality text,
  confidence_score integer,
  indexed_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    bmc.id,
    bmc.workspace_id,
    bmc.source_type,
    bmc.source_id,
    bmc.source_file_id,
    bmc.source_title,
    bmc.source_excerpt,
    bmc.summary,
    bmc.chunk_index,
    bmc.source_metadata,
    bmc.source_quality,
    bmc.confidence_score,
    bmc.indexed_at,
    1 - (bmc.embedding <=> query_embedding) as similarity
  from public.business_memory_chunks bmc
  where bmc.workspace_id = target_workspace_id
    and bmc.embedding is not null
    and bmc.deleted_at is null
    and bmc.archived_at is null
    and public.is_workspace_member(bmc.workspace_id)
    and 1 - (bmc.embedding <=> query_embedding) >= min_similarity
  order by bmc.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

grant select, insert, update, delete on public.file_processing_jobs to authenticated;
grant select, insert, update, delete on public.business_memory_chunks to authenticated;
grant execute on function public.match_business_memory_chunks(uuid, extensions.vector(1536), integer, double precision) to authenticated;
