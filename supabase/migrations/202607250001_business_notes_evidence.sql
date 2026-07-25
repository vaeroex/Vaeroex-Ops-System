create table if not exists public.business_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_user_id uuid references public.profiles(id) on delete set null,
  original_note_text text not null,
  original_file_id uuid references public.file_uploads(id) on delete set null,
  source_text_hash text not null,
  source_version integer not null default 1 check (source_version > 0),
  release_channel text not null check (release_channel in ('production', 'preview', 'development')),
  status text not null default 'draft' check (
    status in ('draft', 'extracting', 'review_required', 'approved', 'rejected', 'extraction_failed', 'archived')
  ),
  evidence_lifecycle_status text not null default 'inactive' check (
    evidence_lifecycle_status in ('active', 'inactive', 'archived')
  ),
  user_observation_date date,
  user_reporting_period_start date,
  user_reporting_period_end date,
  inferred_reporting_period_start date,
  inferred_reporting_period_end date,
  extraction_json jsonb not null default '{}'::jsonb,
  reviewed_extraction_json jsonb not null default '{}'::jsonb,
  source_spans_json jsonb not null default '[]'::jsonb,
  user_corrections_json jsonb not null default '{}'::jsonb,
  extraction_version text not null default 'business_note_extraction_v1',
  validator_version text not null default 'business_note_extraction_validator_v1',
  policy_version text not null default 'business_note_gpt56_luna_terra_v1',
  provider_name text,
  model_used text,
  fallback_used boolean not null default false,
  provider_attempts_json jsonb not null default '[]'::jsonb,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated_provider_cost_cents numeric(12,4) not null default 0 check (estimated_provider_cost_cents >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  provider_request_id text,
  failure_reason text,
  retry_count integer not null default 0 check (retry_count between 0 and 1),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  extracted_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_notes_text_length_check check (
    char_length(btrim(original_note_text)) between 1 and 20000
  ),
  constraint business_notes_source_hash_check check (source_text_hash ~ '^[0-9a-f]{64}$'),
  constraint business_notes_reporting_period_check check (
    user_reporting_period_start is null
    or user_reporting_period_end is null
    or user_reporting_period_start <= user_reporting_period_end
  ),
  constraint business_notes_inferred_period_check check (
    inferred_reporting_period_start is null
    or inferred_reporting_period_end is null
    or inferred_reporting_period_start <= inferred_reporting_period_end
  ),
  constraint business_notes_approval_state_check check (
    status <> 'approved'
    or (
      approved_by is not null
      and approved_at is not null
      and evidence_lifecycle_status = 'active'
      and jsonb_typeof(reviewed_extraction_json) = 'object'
    )
  )
);

create unique index if not exists business_notes_unchanged_source_idx
  on public.business_notes(workspace_id, release_channel, source_text_hash, source_version)
  where deleted_at is null;

create index if not exists business_notes_workspace_status_idx
  on public.business_notes(workspace_id, status, created_at desc)
  where deleted_at is null;

create index if not exists business_notes_workspace_approved_idx
  on public.business_notes(workspace_id, approved_at desc)
  where status = 'approved' and evidence_lifecycle_status = 'active' and deleted_at is null;

create index if not exists business_notes_original_file_idx
  on public.business_notes(workspace_id, original_file_id)
  where original_file_id is not null and deleted_at is null;

drop trigger if exists set_business_notes_updated_at on public.business_notes;
create trigger set_business_notes_updated_at
  before update on public.business_notes
  for each row execute function public.set_updated_at();

create or replace function public.protect_business_note_evidence_boundaries()
returns trigger
language plpgsql
security invoker
set search_path = public, auth
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
    or new.author_user_id is distinct from old.author_user_id
    or new.original_note_text is distinct from old.original_note_text
    or new.original_file_id is distinct from old.original_file_id
    or new.source_text_hash is distinct from old.source_text_hash
    or new.source_version is distinct from old.source_version
    or new.release_channel is distinct from old.release_channel
    or new.created_at is distinct from old.created_at then
    raise exception 'Business Note source identity is immutable.' using errcode = '42501';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and (
    (old.status <> 'approved' and new.status = 'approved')
    or old.status = 'approved'
  ) then
    raise exception 'Business Note approval changes require the trusted server path.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_business_note_evidence_boundaries on public.business_notes;
create trigger protect_business_note_evidence_boundaries
  before update on public.business_notes
  for each row execute function public.protect_business_note_evidence_boundaries();

alter table public.business_notes enable row level security;

drop policy if exists "business notes members read" on public.business_notes;
drop policy if exists "business notes members create" on public.business_notes;
drop policy if exists "business notes authors update" on public.business_notes;
drop policy if exists "business notes managers delete" on public.business_notes;

create policy "business notes members read"
  on public.business_notes for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "business notes members create"
  on public.business_notes for insert
  to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and author_user_id = auth.uid()
  );

create policy "business notes authors update"
  on public.business_notes for update
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (author_user_id = auth.uid() or public.can_edit_operations(workspace_id))
  )
  with check (
    public.is_workspace_member(workspace_id)
    and (author_user_id = auth.uid() or public.can_edit_operations(workspace_id))
  );

revoke delete on public.business_notes from authenticated;
grant select, insert, update on public.business_notes to authenticated;
revoke all on function public.protect_business_note_evidence_boundaries() from public;

alter table public.business_memory_chunks
  drop constraint if exists business_memory_chunks_source_type_check;

alter table public.business_memory_chunks
  add constraint business_memory_chunks_source_type_check check (
    source_type in (
      'file',
      'file_analysis',
      'report',
      'kpi',
      'crm',
      'business_signal',
      'business_note',
      'manual',
      'generated_output'
    )
  );

-- Business Note chunks are written only by the trusted approval path and remain
-- unreadable until their parent note is approved and active.
drop policy if exists "business memory chunks members read" on public.business_memory_chunks;
drop policy if exists "business memory chunks members create" on public.business_memory_chunks;
drop policy if exists "business memory chunks members update" on public.business_memory_chunks;

create policy "business memory chunks members read"
  on public.business_memory_chunks for select
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (
      source_type <> 'business_note'
      or exists (
        select 1
        from public.business_notes note
        where note.id = business_memory_chunks.source_id
          and note.workspace_id = business_memory_chunks.workspace_id
          and note.status = 'approved'
          and note.evidence_lifecycle_status = 'active'
          and note.archived_at is null
          and note.deleted_at is null
      )
    )
  );

create policy "business memory chunks members create"
  on public.business_memory_chunks for insert
  to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and source_type <> 'business_note'
  );

create policy "business memory chunks members update"
  on public.business_memory_chunks for update
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and source_type <> 'business_note'
  )
  with check (
    public.is_workspace_member(workspace_id)
    and source_type <> 'business_note'
  );
