-- Document Extraction Production Foundation - Phase A
--
-- This migration is deliberately additive and inert. It creates durable workflow,
-- encrypted-cache, review, quota, and authorization primitives, but it does not
-- install a provider worker, enable a workspace, or permit provider execution.
-- NVIDIA may extract only. Classification, deterministic validation, and an
-- authorized human review remain separate authority boundaries.

create table if not exists public.document_extraction_workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  is_entitled boolean not null default false,
  is_enabled boolean not null default false,
  monthly_page_limit integer not null default 0 check (monthly_page_limit >= 0),
  current_period_start date,
  current_period_end date,
  pages_reserved integer not null default 0 check (pages_reserved >= 0),
  pages_consumed integer not null default 0 check (pages_consumed >= 0),
  concurrent_job_limit integer not null default 1 check (concurrent_job_limit = 1),
  allowed_document_classes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extraction_settings_period_check check (
    (current_period_start is null and current_period_end is null)
    or (current_period_start is not null and current_period_end is not null and current_period_end >= current_period_start)
  ),
  constraint document_extraction_settings_activation_check check (
    (not is_entitled and not is_enabled)
    or (
      is_entitled
      and monthly_page_limit > 0
      and current_period_start is not null
      and current_period_end is not null
      and cardinality(allowed_document_classes) > 0
    )
  ),
  constraint document_extraction_settings_document_classes_check check (
    allowed_document_classes <@ array[
      'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
      'png', 'jpeg', 'screenshot', 'phone_photo'
    ]::text[]
  )
);

create table if not exists public.document_extraction_system_state (
  singleton_key text primary key check (singleton_key = 'document_intelligence'),
  globally_enabled boolean not null default false,
  worker_enabled boolean not null default false,
  provider_calls_enabled boolean not null default false,
  circuit_state text not null default 'closed' check (circuit_state in ('closed', 'open', 'half_open')),
  circuit_opened_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  rolling_failure_count integer not null default 0 check (rolling_failure_count >= 0),
  policy_version text not null default 'document_extraction_phase_a_inert',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint document_extraction_system_state_circuit_check check (
    (circuit_state = 'open' and circuit_opened_at is not null)
    or (circuit_state <> 'open')
  )
);

insert into public.document_extraction_system_state (
  singleton_key,
  globally_enabled,
  worker_enabled,
  provider_calls_enabled,
  policy_version
) values (
  'document_intelligence',
  false,
  false,
  false,
  'document_extraction_phase_a_inert'
) on conflict (singleton_key) do nothing;

create table if not exists public.document_extraction_intake_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null references public.file_uploads(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null unique,
  status text not null default 'requested' check (status in ('requested', 'enqueued', 'cancelled')),
  source_kind text not null check (source_kind in ('pdf', 'docx', 'png', 'jpeg')),
  mime_type text not null check (char_length(mime_type) between 1 and 200),
  file_extension text not null check (char_length(file_extension) between 1 and 20),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  storage_bucket text not null check (char_length(storage_bucket) between 1 and 100),
  storage_path text not null check (char_length(storage_path) between 1 and 1000),
  created_at timestamptz not null default now(),
  enqueued_at timestamptz,
  cancelled_at timestamptz,
  constraint document_extraction_intake_status_timestamps_check check (
    (status = 'requested' and enqueued_at is null and cancelled_at is null)
    or (status = 'enqueued' and enqueued_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);

create table if not exists public.document_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  intake_request_id uuid not null unique references public.document_extraction_intake_requests(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null references public.file_uploads(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  request_id uuid not null unique,
  route text not null check (route in ('native', 'nvidia_primary', 'nvidia_fallback')),
  document_class text not null check (document_class in (
    'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
    'png', 'jpeg', 'screenshot', 'phone_photo'
  )),
  stage text not null default 'queued' check (stage in (
    'queued', 'leased', 'extracting', 'normalizing', 'validating',
    'awaiting_review', 'classifying', 'promoting', 'terminal'
  )),
  status text not null default 'queued' check (status in (
    'queued', 'processing', 'needs_review', 'completed', 'failed',
    'cancelled', 'dispatch_unknown'
  )),
  parser_provider text not null check (char_length(parser_provider) between 1 and 120),
  parser_model text not null check (char_length(parser_model) between 1 and 200),
  parser_revision text not null check (char_length(parser_revision) between 1 and 200),
  client_revision text not null check (char_length(client_revision) between 1 and 200),
  content_hmac text not null check (content_hmac ~ '^[0-9a-f]{64}$'),
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  routing_policy_version text not null check (char_length(routing_policy_version) between 1 and 120),
  extraction_contract_version text not null check (char_length(extraction_contract_version) between 1 and 120),
  normalization_version text not null check (char_length(normalization_version) between 1 and 120),
  assessment_fingerprint text not null check (assessment_fingerprint ~ '^[0-9a-f]{64}$'),
  page_count integer not null check (page_count between 1 and 10000),
  pages_qualified integer not null check (pages_qualified between 1 and 10000),
  reserved_page_count integer not null default 0 check (reserved_page_count >= 0),
  billed_page_count integer not null default 0 check (billed_page_count >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 128),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  provider_dispatched_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) <= 100),
  failure_class text check (failure_class is null or failure_class in (
    'pre_provider', 'transport', 'timeout', 'rate_limit', 'provider',
    'validation', 'authorization', 'quota', 'ambiguous_dispatch', 'internal'
  )),
  review_required boolean not null default true,
  required_review_version integer not null default 1 check (required_review_version > 0),
  approval_status text not null default 'pending' check (approval_status in (
    'not_required', 'pending', 'in_review', 'approved',
    'approved_with_corrections', 'rejected', 'unresolved', 'stale', 'invalidated'
  )),
  artifact_fingerprint text check (artifact_fingerprint is null or artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  classification_fingerprint text check (classification_fingerprint is null or classification_fingerprint ~ '^[0-9a-f]{64}$'),
  critical_field_manifest_json jsonb,
  critical_field_manifest_fingerprint text check (
    critical_field_manifest_fingerprint is null or critical_field_manifest_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extraction_jobs_workspace_cache_unique unique (workspace_id, cache_key),
  constraint document_extraction_jobs_attempt_limit_check check (attempts <= max_attempts),
  constraint document_extraction_jobs_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null)
  ),
  constraint document_extraction_jobs_nvidia_review_check check (
    route = 'native' or review_required
  ),
  constraint document_extraction_jobs_approval_check check (
    review_required or approval_status = 'not_required'
  ),
  constraint document_extraction_jobs_manifest_check check (
    (critical_field_manifest_json is null and critical_field_manifest_fingerprint is null)
    or (
      jsonb_typeof(critical_field_manifest_json) = 'object'
      and octet_length(critical_field_manifest_json::text) <= 65536
      and critical_field_manifest_fingerprint is not null
    )
  )
);

create table if not exists public.document_extraction_file_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  file_id uuid not null references public.file_uploads(id) on delete cascade,
  job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  is_current boolean not null default true,
  superseded_at timestamptz,
  constraint document_extraction_file_bindings_current_check check (
    (is_current and superseded_at is null) or (not is_current and superseded_at is not null)
  ),
  constraint document_extraction_file_bindings_unique unique (workspace_id, file_id, job_id)
);

create table if not exists public.document_extraction_cache (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  content_hmac text not null check (content_hmac ~ '^[0-9a-f]{64}$'),
  provider text not null check (char_length(provider) between 1 and 120),
  model text not null check (char_length(model) between 1 and 200),
  model_revision text not null check (char_length(model_revision) between 1 and 200),
  client_revision text not null check (char_length(client_revision) between 1 and 200),
  routing_policy_version text not null check (char_length(routing_policy_version) between 1 and 120),
  extraction_contract_version text not null check (char_length(extraction_contract_version) between 1 and 120),
  normalization_version text not null check (char_length(normalization_version) between 1 and 120),
  payload_ciphertext bytea not null check (octet_length(payload_ciphertext) > 0),
  encryption_algorithm text not null check (encryption_algorithm = 'aes-256-gcm'),
  encryption_key_version text not null check (char_length(encryption_key_version) between 1 and 120),
  encryption_nonce bytea not null check (octet_length(encryption_nonce) = 12),
  authentication_tag bytea not null check (octet_length(authentication_tag) = 16),
  aad_digest text not null check (aad_digest ~ '^[0-9a-f]{64}$'),
  artifact_fingerprint text not null check (artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  page_count integer not null check (page_count between 1 and 10000),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason is null or char_length(invalidation_reason) <= 240),
  constraint document_extraction_cache_workspace_key_unique unique (workspace_id, cache_key),
  constraint document_extraction_cache_invalidation_check check (
    (invalidated_at is null and invalidation_reason is null)
    or (invalidated_at is not null and invalidation_reason is not null)
  )
);

create table if not exists public.document_extraction_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  file_id uuid not null references public.file_uploads(id) on delete restrict,
  status text not null default 'pending' check (status in (
    'pending', 'in_review', 'approved', 'approved_with_corrections',
    'rejected', 'unresolved', 'stale', 'invalidated'
  )),
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  artifact_fingerprint text not null check (artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  classification_fingerprint text check (classification_fingerprint is null or classification_fingerprint ~ '^[0-9a-f]{64}$'),
  extraction_contract_version text not null check (char_length(extraction_contract_version) between 1 and 120),
  critical_field_manifest_fingerprint text not null check (critical_field_manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  review_version integer not null default 1 check (review_version > 0),
  critical_field_count integer not null default 0 check (critical_field_count >= 0),
  confirmed_field_count integer not null default 0 check (confirmed_field_count >= 0),
  corrected_field_count integer not null default 0 check (corrected_field_count >= 0),
  rejected_field_count integer not null default 0 check (rejected_field_count >= 0),
  unresolved_field_count integer not null default 0 check (unresolved_field_count >= 0),
  decision_summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extraction_reviews_job_version_unique unique (workspace_id, job_id, review_version),
  constraint document_extraction_reviews_decision_summary_check check (
    jsonb_typeof(decision_summary_json) = 'object'
    and octet_length(decision_summary_json::text) <= 32768
  ),
  constraint document_extraction_reviews_counts_check check (
    confirmed_field_count + corrected_field_count + rejected_field_count + unresolved_field_count = critical_field_count
  ),
  constraint document_extraction_reviews_approval_counts_check check (
    status not in ('approved', 'approved_with_corrections')
    or (critical_field_count > 0 and rejected_field_count = 0 and unresolved_field_count = 0)
  )
);

create table if not exists public.document_extraction_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid references public.document_extraction_jobs(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 1 and 100),
  actor_type text not null check (actor_type in ('user', 'worker', 'system', 'admin')),
  actor_id uuid references public.profiles(id) on delete set null,
  stage text check (stage is null or stage in (
    'queued', 'leased', 'extracting', 'normalizing', 'validating',
    'awaiting_review', 'classifying', 'promoting', 'terminal'
  )),
  status text check (status is null or status in (
    'queued', 'processing', 'needs_review', 'completed', 'failed',
    'cancelled', 'dispatch_unknown'
  )),
  reason_code text check (reason_code is null or char_length(reason_code) <= 100),
  artifact_fingerprint text check (artifact_fingerprint is null or artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  metadata_json jsonb not null default '{}'::jsonb,
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  constraint document_extraction_events_metadata_check check (
    jsonb_typeof(metadata_json) = 'object'
    and octet_length(metadata_json::text) <= 4096
  )
);

create index if not exists document_extraction_jobs_workspace_status_idx
  on public.document_extraction_jobs(workspace_id, status, created_at desc);
create index if not exists document_extraction_jobs_file_idx
  on public.document_extraction_jobs(file_id);
create index if not exists document_extraction_jobs_requested_by_idx
  on public.document_extraction_jobs(requested_by)
  where requested_by is not null;
create index if not exists document_extraction_intake_workspace_created_idx
  on public.document_extraction_intake_requests(workspace_id, created_at desc);
create index if not exists document_extraction_intake_file_idx
  on public.document_extraction_intake_requests(file_id, created_at desc);
create index if not exists document_extraction_intake_requested_by_idx
  on public.document_extraction_intake_requests(requested_by, created_at desc);
create index if not exists document_extraction_jobs_claim_idx
  on public.document_extraction_jobs(status, lease_expires_at, created_at)
  where status in ('queued', 'processing');
create unique index if not exists document_extraction_jobs_one_active_nvidia_per_workspace_idx
  on public.document_extraction_jobs(workspace_id)
  where route in ('nvidia_primary', 'nvidia_fallback')
    and status in ('queued', 'processing', 'dispatch_unknown');
create index if not exists document_extraction_file_bindings_file_idx
  on public.document_extraction_file_bindings(workspace_id, file_id, created_at desc);
create unique index if not exists document_extraction_file_bindings_one_current_idx
  on public.document_extraction_file_bindings(workspace_id, file_id)
  where is_current;
create index if not exists document_extraction_file_bindings_file_id_idx
  on public.document_extraction_file_bindings(file_id);
create index if not exists document_extraction_file_bindings_job_idx
  on public.document_extraction_file_bindings(job_id);
create index if not exists document_extraction_file_bindings_created_by_idx
  on public.document_extraction_file_bindings(created_by)
  where created_by is not null;
create index if not exists document_extraction_cache_artifact_idx
  on public.document_extraction_cache(workspace_id, artifact_fingerprint)
  where invalidated_at is null;
create index if not exists document_extraction_cache_source_job_idx
  on public.document_extraction_cache(source_job_id);
create index if not exists document_extraction_reviews_job_status_idx
  on public.document_extraction_reviews(workspace_id, job_id, status, updated_at desc);
create index if not exists document_extraction_reviews_job_idx
  on public.document_extraction_reviews(job_id);
create index if not exists document_extraction_reviews_file_idx
  on public.document_extraction_reviews(file_id);
create index if not exists document_extraction_reviews_reviewer_idx
  on public.document_extraction_reviews(reviewer_id)
  where reviewer_id is not null;
create index if not exists document_extraction_events_job_created_idx
  on public.document_extraction_events(workspace_id, job_id, created_at desc);
create index if not exists document_extraction_events_job_idx
  on public.document_extraction_events(job_id)
  where job_id is not null;
create index if not exists document_extraction_events_actor_idx
  on public.document_extraction_events(actor_id)
  where actor_id is not null;
create index if not exists document_extraction_system_state_updated_by_idx
  on public.document_extraction_system_state(updated_by)
  where updated_by is not null;

drop trigger if exists set_document_extraction_jobs_updated_at on public.document_extraction_jobs;
create trigger set_document_extraction_jobs_updated_at
  before update on public.document_extraction_jobs
  for each row execute function public.set_updated_at();
drop trigger if exists set_document_extraction_reviews_updated_at on public.document_extraction_reviews;
create trigger set_document_extraction_reviews_updated_at
  before update on public.document_extraction_reviews
  for each row execute function public.set_updated_at();
drop trigger if exists set_document_extraction_workspace_settings_updated_at on public.document_extraction_workspace_settings;
create trigger set_document_extraction_workspace_settings_updated_at
  before update on public.document_extraction_workspace_settings
  for each row execute function public.set_updated_at();

create or replace function public.prevent_document_extraction_event_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then return old; end if;
  raise exception 'Document extraction events are append-only.' using errcode = '42501';
end;
$$;

drop trigger if exists prevent_document_extraction_event_update on public.document_extraction_events;
create trigger prevent_document_extraction_event_update
  before update or delete on public.document_extraction_events
  for each row execute function public.prevent_document_extraction_event_mutation_v1();

create or replace function public.record_document_extraction_event_v1(
  p_workspace_id uuid,
  p_job_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_id uuid,
  p_stage text,
  p_status text,
  p_reason_code text,
  p_artifact_fingerprint text,
  p_metadata_json jsonb,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.document_extraction_events (
    workspace_id, job_id, event_type, actor_type, actor_id, stage, status,
    reason_code, artifact_fingerprint, metadata_json, request_id
  ) values (
    p_workspace_id, p_job_id, p_event_type, p_actor_type, p_actor_id, p_stage, p_status,
    p_reason_code, p_artifact_fingerprint, coalesce(p_metadata_json, '{}'::jsonb), p_request_id
  )
  on conflict (request_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.document_extraction_events where request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.document_extraction_runtime_reason_v1(
  p_workspace_id uuid,
  p_document_class text,
  p_required_pages integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_system public.document_extraction_system_state%rowtype;
  v_settings public.document_extraction_workspace_settings%rowtype;
begin
  if p_document_class not in (
    'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
    'png', 'jpeg', 'screenshot', 'phone_photo'
  ) then return 'document_class_not_allowed'; end if;
  select * into v_system
  from public.document_extraction_system_state
  where singleton_key = 'document_intelligence';
  if v_system.singleton_key is null or not v_system.globally_enabled then return 'globally_disabled'; end if;
  if not v_system.worker_enabled then return 'worker_disabled'; end if;
  if not v_system.provider_calls_enabled then return 'provider_calls_disabled'; end if;

  select * into v_settings
  from public.document_extraction_workspace_settings
  where workspace_id = p_workspace_id;
  if v_settings.workspace_id is null or not v_settings.is_entitled then return 'workspace_not_entitled'; end if;
  if not v_settings.is_enabled then return 'workspace_disabled'; end if;
  if p_document_class <> all(v_settings.allowed_document_classes) then return 'document_class_not_allowed'; end if;
  if v_system.circuit_state <> 'closed' then return 'circuit_open'; end if;
  if p_required_pages > 0 and (
    v_settings.current_period_start is null
    or current_date not between v_settings.current_period_start and v_settings.current_period_end
    or v_settings.pages_reserved + v_settings.pages_consumed + p_required_pages > v_settings.monthly_page_limit
  ) then return 'quota_exhausted'; end if;
  return 'eligible';
end;
$$;

create or replace function public.evaluate_document_extraction_eligibility_v1(
  p_workspace_id uuid,
  p_document_class text,
  p_required_pages integer default 0
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied.' using errcode = '42501';
  end if;
  if p_required_pages < 0 then
    raise exception 'Required pages must not be negative.' using errcode = '22023';
  end if;
  return public.document_extraction_runtime_reason_v1(p_workspace_id, p_document_class, p_required_pages);
end;
$$;

create or replace function public.request_document_extraction_intake_v1(
  p_file_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_file public.file_uploads%rowtype;
  v_intake public.document_extraction_intake_requests%rowtype;
  v_source_kind text;
  v_system public.document_extraction_system_state%rowtype;
  v_settings public.document_extraction_workspace_settings%rowtype;
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into v_file
  from public.file_uploads
  where id = p_file_id and deleted_at is null and archived_at is null;
  if v_file.id is null or not public.is_workspace_member(v_file.workspace_id) then
    raise exception 'Active source file not found.' using errcode = 'P0002';
  end if;
  if v_file.storage_path not like v_file.workspace_id::text || '/%' then
    raise exception 'Source storage path is not workspace scoped.' using errcode = '22023';
  end if;
  v_source_kind := case
    when lower(v_file.mime_type) = 'application/pdf' and lower(v_file.file_extension) = 'pdf' then 'pdf'
    when lower(v_file.mime_type) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      and lower(v_file.file_extension) = 'docx' then 'docx'
    when lower(v_file.mime_type) = 'image/png' and lower(v_file.file_extension) = 'png' then 'png'
    when lower(v_file.mime_type) in ('image/jpeg', 'image/jpg') and lower(v_file.file_extension) in ('jpg', 'jpeg') then 'jpeg'
    else null
  end;
  if v_source_kind is null or v_file.file_size_bytes <= 0 then
    raise exception 'This stored file is not eligible for document extraction intake.' using errcode = '22023';
  end if;

  select * into v_system from public.document_extraction_system_state
  where singleton_key = 'document_intelligence';
  select * into v_settings from public.document_extraction_workspace_settings
  where workspace_id = v_file.workspace_id;
  if v_system.singleton_key is null or not v_system.globally_enabled then
    return jsonb_build_object('intake_id', null, 'status', 'blocked', 'reason', 'globally_disabled');
  end if;
  if not v_system.worker_enabled then
    return jsonb_build_object('intake_id', null, 'status', 'blocked', 'reason', 'worker_disabled');
  end if;
  if not v_system.provider_calls_enabled then
    return jsonb_build_object('intake_id', null, 'status', 'blocked', 'reason', 'provider_calls_disabled');
  end if;
  if v_settings.workspace_id is null or not v_settings.is_entitled then
    return jsonb_build_object('intake_id', null, 'status', 'blocked', 'reason', 'workspace_not_entitled');
  end if;
  if not v_settings.is_enabled then
    return jsonb_build_object('intake_id', null, 'status', 'blocked', 'reason', 'workspace_disabled');
  end if;

  insert into public.document_extraction_intake_requests (
    workspace_id, file_id, requested_by, request_id, source_kind,
    mime_type, file_extension, file_size_bytes, storage_bucket, storage_path
  ) values (
    v_file.workspace_id, v_file.id, v_actor, p_request_id, v_source_kind,
    lower(v_file.mime_type), lower(v_file.file_extension), v_file.file_size_bytes,
    v_file.storage_bucket, v_file.storage_path
  )
  on conflict (request_id) do nothing
  returning * into v_intake;
  v_created := v_intake.id is not null;
  if v_intake.id is null then
    select * into v_intake from public.document_extraction_intake_requests where request_id = p_request_id;
    if v_intake.file_id <> v_file.id or v_intake.workspace_id <> v_file.workspace_id or v_intake.requested_by <> v_actor then
      raise exception 'Intake idempotency replay does not match the original request.' using errcode = '23505';
    end if;
  end if;
  return jsonb_build_object('intake_id', v_intake.id, 'status', v_intake.status, 'idempotent', not v_created);
end;
$$;

create or replace function public.enqueue_document_extraction_job_v1(
  p_intake_request_id uuid,
  p_route text,
  p_document_class text,
  p_assessment_fingerprint text,
  p_page_count integer,
  p_parser_provider text,
  p_parser_model text,
  p_parser_revision text,
  p_client_revision text,
  p_content_hmac text,
  p_cache_key text,
  p_routing_policy_version text,
  p_extraction_contract_version text,
  p_normalization_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake public.document_extraction_intake_requests%rowtype;
  v_file public.file_uploads%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_reason text;
  v_settings public.document_extraction_workspace_settings%rowtype;
begin
  select * into v_intake from public.document_extraction_intake_requests
  where id = p_intake_request_id for update;
  if v_intake.id is null or v_intake.status = 'cancelled' then
    raise exception 'Active document extraction intake not found.' using errcode = 'P0002';
  end if;
  select * into v_file from public.file_uploads
  where id = v_intake.file_id and workspace_id = v_intake.workspace_id
    and deleted_at is null and archived_at is null for update;
  if v_file.id is null
    or lower(v_file.mime_type) <> v_intake.mime_type
    or lower(v_file.file_extension) <> v_intake.file_extension
    or v_file.file_size_bytes <> v_intake.file_size_bytes
    or v_file.storage_bucket <> v_intake.storage_bucket
    or v_file.storage_path <> v_intake.storage_path then
    raise exception 'Stored source identity changed after intake.' using errcode = '22023';
  end if;
  if not (
    (v_intake.source_kind = 'pdf' and p_document_class in ('digital_pdf', 'scanned_pdf', 'image_only_pdf'))
    or (v_intake.source_kind = 'docx' and p_document_class = 'digital_docx')
    or (v_intake.source_kind = 'png' and p_document_class in ('png', 'screenshot', 'phone_photo'))
    or (v_intake.source_kind = 'jpeg' and p_document_class in ('jpeg', 'screenshot', 'phone_photo'))
  ) then
    raise exception 'Trusted document assessment does not match the stored source type.' using errcode = '22023';
  end if;
  if not (
    (v_intake.source_kind in ('png', 'jpeg') and p_route = 'nvidia_primary')
    or (v_intake.source_kind = 'pdf' and p_route in ('native', 'nvidia_primary', 'nvidia_fallback'))
    or (v_intake.source_kind = 'docx' and p_route in ('native', 'nvidia_fallback'))
  ) then
    raise exception 'Trusted extraction route is not permitted for this stored source.' using errcode = '22023';
  end if;
  if p_assessment_fingerprint !~ '^[0-9a-f]{64}$'
    or p_content_hmac !~ '^[0-9a-f]{64}$' or p_cache_key !~ '^[0-9a-f]{64}$'
    or p_page_count not between 1 and 10000
    or p_routing_policy_version <> 'document_extraction_routing_v1'
    or p_extraction_contract_version <> 'document_extraction_artifact_v1'
    or p_normalization_version <> 'document_extraction_normalization_v1'
    or char_length(trim(p_parser_provider)) not between 1 and 120
    or char_length(trim(p_parser_model)) not between 1 and 200
    or char_length(trim(p_parser_revision)) not between 1 and 200
    or char_length(trim(p_client_revision)) not between 1 and 200 then
    raise exception 'Invalid trusted extraction assessment.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_intake.workspace_id::text || ':' || p_cache_key, 0));
  select * into v_job from public.document_extraction_jobs
  where intake_request_id = v_intake.id for update;
  if v_job.id is not null then
    if v_job.cache_key <> p_cache_key or v_job.assessment_fingerprint <> p_assessment_fingerprint
      or v_job.page_count <> p_page_count then
      raise exception 'Privileged enqueue replay does not match the trusted assessment.' using errcode = '23505';
    end if;
    return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'idempotent', true, 'cache_hit', v_job.status = 'completed');
  end if;

  select * into v_job from public.document_extraction_jobs
  where workspace_id = v_intake.workspace_id and cache_key = p_cache_key for update;
  if v_job.id is not null then
    update public.document_extraction_file_bindings
    set is_current = false, superseded_at = now()
    where workspace_id = v_intake.workspace_id and file_id = v_intake.file_id and is_current and job_id <> v_job.id;
    insert into public.document_extraction_file_bindings (
      workspace_id, file_id, job_id, cache_key, created_by, is_current, superseded_at
    ) values (
      v_intake.workspace_id, v_intake.file_id, v_job.id, p_cache_key, v_intake.requested_by, true, null
    )
    on conflict (workspace_id, file_id, job_id) do update
    set is_current = true, superseded_at = null;
    update public.document_extraction_intake_requests
    set status = 'enqueued', enqueued_at = coalesce(enqueued_at, now()), cancelled_at = null
    where id = v_intake.id;
    if v_job.status = 'completed' then
      update public.document_extraction_cache set last_used_at = now()
      where workspace_id = v_intake.workspace_id and cache_key = p_cache_key and invalidated_at is null;
    end if;
    return jsonb_build_object(
      'job_id', v_job.id, 'status', v_job.status, 'idempotent', true,
      'cache_hit', exists (
        select 1 from public.document_extraction_cache cache
        where cache.workspace_id = v_intake.workspace_id and cache.cache_key = p_cache_key and cache.invalidated_at is null
      )
    );
  end if;

  select * into v_settings from public.document_extraction_workspace_settings
  where workspace_id = v_intake.workspace_id for update;
  if v_settings.workspace_id is not null and (
    v_settings.current_period_start is null
    or current_date not between v_settings.current_period_start and v_settings.current_period_end
  ) then
    update public.document_extraction_workspace_settings
    set current_period_start = date_trunc('month', current_date)::date,
        current_period_end = (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
        pages_reserved = 0, pages_consumed = 0, updated_at = now()
    where workspace_id = v_intake.workspace_id returning * into v_settings;
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_intake.workspace_id, p_document_class, p_page_count);
  if v_reason <> 'eligible' then
    return jsonb_build_object('job_id', null, 'status', 'blocked', 'reason', v_reason, 'idempotent', false, 'cache_hit', false);
  end if;
  if exists (
    select 1 from public.document_extraction_jobs job
    where job.workspace_id = v_intake.workspace_id
      and job.route in ('nvidia_primary', 'nvidia_fallback')
      and job.status in ('queued', 'processing', 'dispatch_unknown')
  ) then
    return jsonb_build_object('job_id', null, 'status', 'blocked', 'reason', 'concurrency_limit_reached', 'idempotent', false, 'cache_hit', false);
  end if;

  update public.document_extraction_workspace_settings
  set pages_reserved = pages_reserved + p_page_count, updated_at = now()
  where workspace_id = v_intake.workspace_id;
  insert into public.document_extraction_jobs (
    intake_request_id, workspace_id, file_id, requested_by, request_id, route, document_class,
    parser_provider, parser_model, parser_revision, client_revision, content_hmac,
    cache_key, routing_policy_version, extraction_contract_version, normalization_version,
    assessment_fingerprint, page_count, pages_qualified, reserved_page_count, max_attempts,
    review_required, approval_status
  ) values (
    v_intake.id, v_intake.workspace_id, v_intake.file_id, v_intake.requested_by, v_intake.request_id,
    p_route, p_document_class, trim(p_parser_provider), trim(p_parser_model), trim(p_parser_revision),
    trim(p_client_revision), p_content_hmac, p_cache_key, p_routing_policy_version,
    p_extraction_contract_version, p_normalization_version, p_assessment_fingerprint,
    p_page_count, p_page_count, p_page_count, 2,
    p_route <> 'native', case when p_route = 'native' then 'not_required' else 'pending' end
  ) returning * into v_job;
  update public.document_extraction_file_bindings
  set is_current = false, superseded_at = now()
  where workspace_id = v_intake.workspace_id and file_id = v_intake.file_id and is_current;
  insert into public.document_extraction_file_bindings (
    workspace_id, file_id, job_id, cache_key, created_by, is_current, superseded_at
  ) values (
    v_intake.workspace_id, v_intake.file_id, v_job.id, p_cache_key, v_intake.requested_by, true, null
  );
  update public.document_extraction_intake_requests
  set status = 'enqueued', enqueued_at = now(), cancelled_at = null where id = v_intake.id;
  perform public.record_document_extraction_event_v1(
    v_intake.workspace_id, v_job.id, 'job_enqueued', 'system', v_intake.requested_by,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('route', p_route, 'document_class', p_document_class, 'pages_reserved', p_page_count),
    v_intake.request_id
  );
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'idempotent', false, 'cache_hit', false);
end;
$$;

create or replace function public.claim_document_extraction_job_v1(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.document_extraction_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 1 and 128 or p_lease_seconds not between 30 and 600 then
    raise exception 'Invalid worker lease request.' using errcode = '22023';
  end if;

  with ambiguous as (
    update public.document_extraction_jobs job
    set status = 'dispatch_unknown', stage = 'terminal', lease_owner = null,
        lease_expires_at = null, heartbeat_at = null,
        failure_code = 'lease_expired_after_dispatch', failure_class = 'ambiguous_dispatch',
        failed_at = now(), updated_at = now()
    where job.status = 'processing'
      and job.lease_expires_at <= now()
      and job.provider_dispatched_at is not null
    returning job.*
  )
  insert into public.document_extraction_events (
    workspace_id, job_id, event_type, actor_type, stage, status, reason_code, metadata_json, request_id
  )
  select workspace_id, id, 'dispatch_became_ambiguous', 'system', stage, status,
    failure_code, '{}'::jsonb, gen_random_uuid()
  from ambiguous;

  select job.* into v_job
  from public.document_extraction_jobs job
  where (
      job.status = 'queued'
      or (
        job.status = 'processing'
        and job.lease_expires_at <= now()
        and job.provider_dispatched_at is null
      )
    )
    and job.attempts < job.max_attempts
    and public.document_extraction_runtime_reason_v1(job.workspace_id, job.document_class, 0) = 'eligible'
  order by job.created_at
  for update skip locked
  limit 1;

  if v_job.id is null then return; end if;
  update public.document_extraction_jobs
  set status = 'processing', stage = 'leased', attempts = attempts + 1,
      lease_owner = p_worker_id, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_claimed', 'worker', null, v_job.stage,
    v_job.status, null, null, jsonb_build_object('attempt', v_job.attempts), gen_random_uuid()
  );
  return next v_job;
end;
$$;

create or replace function public.heartbeat_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds not between 30 and 600 then raise exception 'Invalid lease duration.' using errcode = '22023'; end if;
  update public.document_extraction_jobs
  set heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = p_job_id and status = 'processing' and lease_owner = p_worker_id and lease_expires_at > now();
  return found;
end;
$$;

create or replace function public.authorize_document_extraction_dispatch_v1(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_reason text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.provider_dispatched_at is not null then
    raise exception 'The job is not dispatchable by this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('authorized', false, 'reason', v_reason);
  end if;
  update public.document_extraction_workspace_settings
  set pages_reserved = greatest(0, pages_reserved - v_job.reserved_page_count),
      pages_consumed = pages_consumed + v_job.reserved_page_count,
      updated_at = now()
  where workspace_id = v_job.workspace_id;
  update public.document_extraction_jobs
  set stage = 'extracting', provider_dispatched_at = now(),
      billed_page_count = reserved_page_count, reserved_page_count = 0, updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'provider_dispatch_authorized', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('billed_pages', v_job.billed_page_count), gen_random_uuid()
  );
  return jsonb_build_object('authorized', true, 'reason', 'eligible', 'job_id', v_job.id);
end;
$$;

create or replace function public.validate_document_extraction_critical_field_manifest_v1(
  p_manifest jsonb,
  p_artifact_fingerprint text,
  p_extraction_contract_version text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_field jsonb;
  v_field_ids text[] := '{}'::text[];
  v_field_id text;
  v_kind text;
  v_value_type text;
begin
  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
    or octet_length(p_manifest::text) > 65536
    or p_manifest ->> 'manifest_version' is distinct from 'document_extraction_critical_fields_v1'
    or p_manifest ->> 'artifact_fingerprint' is distinct from p_artifact_fingerprint
    or p_manifest ->> 'extraction_contract_version' is distinct from p_extraction_contract_version
    or coalesce(jsonb_typeof(p_manifest -> 'fields') <> 'array', true)
    or jsonb_array_length(p_manifest -> 'fields') > 500
    or exists (
      select 1 from jsonb_object_keys(p_manifest) key
      where key not in ('manifest_version', 'artifact_fingerprint', 'extraction_contract_version', 'fields')
    ) then
    raise exception 'Invalid critical-field manifest envelope.' using errcode = '22023';
  end if;
  for v_field in select value from jsonb_array_elements(p_manifest -> 'fields') loop
    if jsonb_typeof(v_field) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_field) key
        where key not in ('id', 'kind', 'value_type')
      )
      or (select count(*) from jsonb_object_keys(v_field)) <> 3 then
      raise exception 'Invalid critical-field manifest entry.' using errcode = '22023';
    end if;
    v_field_id := v_field ->> 'id';
    v_kind := v_field ->> 'kind';
    v_value_type := v_field ->> 'value_type';
    if v_field_id is null or v_field_id !~ '^[A-Za-z0-9._:-]{1,128}$'
      or v_field_id = any(v_field_ids)
      or v_kind not in (
        'kpi_name', 'current_value', 'target', 'sign', 'decimal', 'currency',
        'percentage', 'unit', 'reporting_period', 'page', 'source_coordinates'
      )
      or v_value_type not in ('string', 'number', 'boolean', 'coordinates')
      or (v_kind = 'source_coordinates' and v_value_type <> 'coordinates')
      or (v_kind = 'page' and v_value_type <> 'number')
      or (v_kind in ('sign', 'currency', 'unit', 'reporting_period', 'kpi_name') and v_value_type <> 'string') then
      raise exception 'Invalid or duplicate critical-field manifest identity.' using errcode = '22023';
    end if;
    v_field_ids := array_append(v_field_ids, v_field_id);
  end loop;
  return encode(extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'), 'hex');
end;
$$;

create or replace function public.complete_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_critical_field_manifest_json jsonb,
  p_payload_ciphertext bytea,
  p_encryption_key_version text,
  p_encryption_nonce bytea,
  p_authentication_tag bytea,
  p_aad_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_existing public.document_extraction_cache%rowtype;
  v_reason text;
  v_manifest_fingerprint text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.provider_dispatched_at is null then
    raise exception 'The job cannot be completed by this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    raise exception 'Pre-promotion gate denied: %', v_reason using errcode = '42501';
  end if;
  if p_artifact_fingerprint !~ '^[0-9a-f]{64}$'
    or (p_classification_fingerprint is not null and p_classification_fingerprint !~ '^[0-9a-f]{64}$')
    or p_payload_ciphertext is null or octet_length(p_payload_ciphertext) = 0
    or octet_length(p_encryption_nonce) <> 12 or octet_length(p_authentication_tag) <> 16
    or p_aad_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid encrypted extraction completion.' using errcode = '22023';
  end if;
  v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v1(
    p_critical_field_manifest_json,
    p_artifact_fingerprint,
    v_job.extraction_contract_version
  );

  select * into v_existing
  from public.document_extraction_cache
  where workspace_id = v_job.workspace_id and cache_key = v_job.cache_key
  for update;
  if v_existing.id is not null and v_existing.artifact_fingerprint <> p_artifact_fingerprint then
    raise exception 'Cache identity collision detected.' using errcode = '23505';
  end if;
  if v_existing.id is null then
    insert into public.document_extraction_cache (
      workspace_id, source_job_id, cache_key, content_hmac, provider, model, model_revision,
      client_revision, routing_policy_version, extraction_contract_version,
      normalization_version, payload_ciphertext, encryption_algorithm,
      encryption_key_version, encryption_nonce, authentication_tag, aad_digest,
      artifact_fingerprint, page_count
    ) values (
      v_job.workspace_id, v_job.id, v_job.cache_key, v_job.content_hmac,
      v_job.parser_provider, v_job.parser_model, v_job.parser_revision, v_job.client_revision,
      v_job.routing_policy_version, v_job.extraction_contract_version,
      v_job.normalization_version, p_payload_ciphertext, 'aes-256-gcm',
      p_encryption_key_version, p_encryption_nonce, p_authentication_tag,
      p_aad_digest, p_artifact_fingerprint, v_job.page_count
    );
  end if;

  update public.document_extraction_jobs
  set stage = case when review_required then 'awaiting_review' else 'terminal' end,
      status = case when review_required then 'needs_review' else 'completed' end,
      approval_status = case when review_required then 'pending' else 'not_required' end,
      artifact_fingerprint = p_artifact_fingerprint,
      classification_fingerprint = p_classification_fingerprint,
      critical_field_manifest_json = p_critical_field_manifest_json,
      critical_field_manifest_fingerprint = v_manifest_fingerprint,
      completed_at = now(), lease_owner = null, lease_expires_at = null,
      heartbeat_at = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'extraction_completed', 'worker', null,
    v_job.stage, v_job.status, case when v_job.review_required then 'review_required' else null end,
    v_job.artifact_fingerprint,
    jsonb_build_object(
      'page_count', v_job.page_count,
      'critical_field_count', jsonb_array_length(p_critical_field_manifest_json -> 'fields'),
      'manifest_fingerprint', v_manifest_fingerprint
    ),
    gen_random_uuid()
  );
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'approval_status', v_job.approval_status);
end;
$$;

create or replace function public.fail_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_failure_code text,
  p_failure_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status not in ('queued', 'processing')
    or (v_job.status = 'processing' and v_job.lease_owner <> p_worker_id) then
    raise exception 'The job cannot be failed by this caller.' using errcode = '42501';
  end if;
  if v_job.provider_dispatched_at is null and v_job.reserved_page_count > 0 then
    update public.document_extraction_workspace_settings
    set pages_reserved = greatest(0, pages_reserved - v_job.reserved_page_count), updated_at = now()
    where workspace_id = v_job.workspace_id;
  end if;
  update public.document_extraction_jobs
  set status = 'failed', stage = 'terminal', failed_at = now(),
      failure_code = left(p_failure_code, 100), failure_class = p_failure_class,
      reserved_page_count = 0, lease_owner = null, lease_expires_at = null,
      heartbeat_at = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_failed', 'worker', null, v_job.stage,
    v_job.status, v_job.failure_code, v_job.artifact_fingerprint,
    jsonb_build_object('failure_class', v_job.failure_class, 'provider_dispatched', v_job.provider_dispatched_at is not null),
    gen_random_uuid()
  );
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'retryable', v_job.provider_dispatched_at is null and v_job.attempts < v_job.max_attempts);
end;
$$;

create or replace function public.retry_document_extraction_job_v1(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_settings public.document_extraction_workspace_settings%rowtype;
  v_reason text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'failed' or v_job.provider_dispatched_at is not null
    or v_job.attempts >= v_job.max_attempts then
    raise exception 'The failed job is not eligible for a safe retry.' using errcode = '22023';
  end if;
  select * into v_settings from public.document_extraction_workspace_settings
  where workspace_id = v_job.workspace_id for update;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, v_job.pages_qualified);
  if v_reason <> 'eligible' then return jsonb_build_object('retried', false, 'reason', v_reason); end if;
  update public.document_extraction_workspace_settings
  set pages_reserved = pages_reserved + v_job.pages_qualified, updated_at = now()
  where workspace_id = v_job.workspace_id;
  update public.document_extraction_jobs
  set status = 'queued', stage = 'queued', reserved_page_count = pages_qualified,
      failed_at = null, failure_code = null, failure_class = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_retry_queued', 'admin', null, v_job.stage,
    v_job.status, null, null, jsonb_build_object('attempts_remaining', v_job.max_attempts - v_job.attempts), gen_random_uuid()
  );
  return jsonb_build_object('retried', true, 'job_id', v_job.id, 'status', v_job.status);
end;
$$;

create or replace function public.set_document_extraction_classification_v1(
  p_job_id uuid,
  p_artifact_fingerprint text,
  p_classification_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_artifact_fingerprint !~ '^[0-9a-f]{64}$' or p_classification_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid classification fingerprints.' using errcode = '22023';
  end if;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'needs_review'
    or v_job.artifact_fingerprint is distinct from p_artifact_fingerprint
    or not exists (
      select 1 from public.document_extraction_cache cache
      where cache.workspace_id = v_job.workspace_id and cache.source_job_id = v_job.id
        and cache.artifact_fingerprint = p_artifact_fingerprint and cache.invalidated_at is null
    ) then
    raise exception 'Classification cannot be bound to this extraction artifact.' using errcode = '22023';
  end if;
  update public.document_extraction_jobs
  set stage = 'classifying', classification_fingerprint = p_classification_fingerprint,
      approval_status = 'pending', updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'classification_bound', 'system', null,
    v_job.stage, v_job.status, null, v_job.artifact_fingerprint,
    jsonb_build_object('classification_fingerprint_present', true), gen_random_uuid()
  );
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'classification_bound', true);
end;
$$;

create or replace function public.invalidate_document_extraction_cache_v1(
  p_workspace_id uuid,
  p_cache_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cache public.document_extraction_cache%rowtype;
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 240 then
    raise exception 'A bounded invalidation reason is required.' using errcode = '22023';
  end if;
  select * into v_cache from public.document_extraction_cache
  where workspace_id = p_workspace_id and cache_key = p_cache_key for update;
  if v_cache.id is null then return jsonb_build_object('invalidated', false, 'reason', 'cache_not_found'); end if;
  if v_cache.invalidated_at is null then
    update public.document_extraction_cache
    set invalidated_at = now(), invalidation_reason = trim(p_reason)
    where id = v_cache.id returning * into v_cache;
    update public.document_extraction_reviews
    set status = 'invalidated', updated_at = now()
    where workspace_id = p_workspace_id and job_id = v_cache.source_job_id
      and status not in ('invalidated', 'stale');
    update public.document_extraction_jobs
    set approval_status = 'invalidated', status = 'failed', stage = 'terminal',
        failed_at = now(), failure_code = 'cache_invalidated', failure_class = 'validation', updated_at = now()
    where id = v_cache.source_job_id returning * into v_job;
    perform public.record_document_extraction_event_v1(
      p_workspace_id, v_cache.source_job_id, 'cache_invalidated', 'admin', null,
      v_job.stage, v_job.status, 'cache_invalidated', v_cache.artifact_fingerprint,
      jsonb_build_object('reason_code', left(trim(p_reason), 100)), gen_random_uuid()
    );
  end if;
  return jsonb_build_object('invalidated', true, 'cache_id', v_cache.id, 'job_id', v_cache.source_job_id);
end;
$$;

create or replace function public.mutate_document_extraction_review_v1(
  p_workspace_id uuid,
  p_job_id uuid,
  p_file_id uuid,
  p_action text,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_extraction_contract_version text,
  p_review_version integer,
  p_decision_summary_json jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.document_extraction_jobs%rowtype;
  v_review public.document_extraction_reviews%rowtype;
  v_manifest_field jsonb;
  v_decision jsonb;
  v_decision_fields jsonb;
  v_field_id text;
  v_decision_kind text;
  v_value_type text;
  v_corrected_value jsonb;
  v_seen_field_ids text[] := '{}'::text[];
  v_status text;
  v_critical_field_count integer;
  v_confirmed_field_count integer := 0;
  v_corrected_field_count integer := 0;
  v_rejected_field_count integer := 0;
  v_unresolved_field_count integer := 0;
begin
  if v_actor is null or not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager']) then
    raise exception 'Only workspace leadership may review extracted fields.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('save', 'approve', 'reject') or p_request_id is null then
    raise exception 'Unsupported review action.' using errcode = '22023';
  end if;
  if p_decision_summary_json is null or jsonb_typeof(p_decision_summary_json) <> 'object'
    or octet_length(p_decision_summary_json::text) > 32768
    or coalesce(jsonb_typeof(p_decision_summary_json -> 'fields') <> 'array', true)
    or exists (
      select 1 from jsonb_object_keys(p_decision_summary_json) key where key <> 'fields'
    ) then
    raise exception 'Invalid bounded review decision.' using errcode = '22023';
  end if;

  select * into v_job from public.document_extraction_jobs
  where id = p_job_id and workspace_id = p_workspace_id for update;
  if v_job.id is null or not exists (
    select 1 from public.document_extraction_file_bindings binding
    where binding.workspace_id = p_workspace_id and binding.file_id = p_file_id and binding.job_id = p_job_id
  ) then
    raise exception 'Extraction job and file binding not found.' using errcode = 'P0002';
  end if;
  if v_job.file_id <> p_file_id then
    raise exception 'Only the originating file can create the shared extraction review.' using errcode = '22023';
  end if;
  if v_job.status <> 'needs_review' or v_job.artifact_fingerprint is distinct from p_artifact_fingerprint
    or v_job.classification_fingerprint is distinct from p_classification_fingerprint then
    raise exception 'Review fingerprints are stale or the job is not reviewable.' using errcode = '22023';
  end if;
  if p_review_version is distinct from v_job.required_review_version then
    raise exception 'Review contract version is stale.' using errcode = '22023';
  end if;
  if p_extraction_contract_version is distinct from v_job.extraction_contract_version
    or v_job.critical_field_manifest_json is null
    or v_job.critical_field_manifest_fingerprint is null
    or public.validate_document_extraction_critical_field_manifest_v1(
      v_job.critical_field_manifest_json,
      p_artifact_fingerprint,
      p_extraction_contract_version
    ) is distinct from v_job.critical_field_manifest_fingerprint then
    raise exception 'Review manifest or extraction contract is stale.' using errcode = '22023';
  end if;

  v_decision_fields := p_decision_summary_json -> 'fields';
  v_critical_field_count := jsonb_array_length(v_job.critical_field_manifest_json -> 'fields');
  if jsonb_array_length(v_decision_fields) <> v_critical_field_count then
    raise exception 'Exactly one decision is required for every critical field.' using errcode = '22023';
  end if;
  for v_decision in select value from jsonb_array_elements(v_decision_fields) loop
    if jsonb_typeof(v_decision) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_decision) key
        where key not in ('field_id', 'decision', 'corrected_value', 'reason_code')
      )
      or not (v_decision ? 'field_id') or not (v_decision ? 'decision') then
      raise exception 'Malformed critical-field decision.' using errcode = '22023';
    end if;
    v_field_id := v_decision ->> 'field_id';
    v_decision_kind := v_decision ->> 'decision';
    if v_field_id is null or v_field_id = any(v_seen_field_ids)
      or v_decision_kind is null
      or v_decision_kind not in ('confirmed', 'corrected', 'rejected', 'unresolved') then
      raise exception 'Duplicate or invalid critical-field decision.' using errcode = '22023';
    end if;
    select value into v_manifest_field
    from jsonb_array_elements(v_job.critical_field_manifest_json -> 'fields')
    where value ->> 'id' = v_field_id;
    if v_manifest_field is null then
      raise exception 'Review decision references an unknown critical field.' using errcode = '22023';
    end if;
    if v_decision ? 'reason_code' and (
      jsonb_typeof(v_decision -> 'reason_code') <> 'string'
      or v_decision ->> 'reason_code' !~ '^[a-z0-9_:-]{1,100}$'
    ) then
      raise exception 'Invalid bounded review reason.' using errcode = '22023';
    end if;
    if v_decision_kind = 'corrected' then
      if not (v_decision ? 'corrected_value') then
        raise exception 'Corrected decisions require a corrected value.' using errcode = '22023';
      end if;
      v_corrected_value := v_decision -> 'corrected_value';
      v_value_type := v_manifest_field ->> 'value_type';
      if v_value_type = 'string' then
        if jsonb_typeof(v_corrected_value) <> 'string'
          or char_length(v_corrected_value #>> '{}') not between 1 and 1000
          or v_corrected_value #>> '{}' ~ '[[:cntrl:]]' then
          raise exception 'Malformed corrected string value.' using errcode = '22023';
        end if;
      elsif v_value_type = 'number' then
        if jsonb_typeof(v_corrected_value) <> 'number'
          or abs((v_corrected_value #>> '{}')::numeric) > 1000000000000000 then
          raise exception 'Malformed corrected numeric value.' using errcode = '22023';
        end if;
        if v_manifest_field ->> 'kind' = 'page' and (
          (v_corrected_value #>> '{}')::numeric <> trunc((v_corrected_value #>> '{}')::numeric)
          or (v_corrected_value #>> '{}')::numeric not between 1 and v_job.page_count
        ) then
          raise exception 'Corrected page is outside the authoritative document.' using errcode = '22023';
        end if;
      elsif v_value_type = 'boolean' then
        if jsonb_typeof(v_corrected_value) <> 'boolean' then
          raise exception 'Malformed corrected boolean value.' using errcode = '22023';
        end if;
      elsif v_value_type = 'coordinates' then
        if jsonb_typeof(v_corrected_value) <> 'object'
          or (select count(*) from jsonb_object_keys(v_corrected_value)) <> 5
          or exists (
            select 1 from jsonb_object_keys(v_corrected_value) key
            where key not in ('page', 'x', 'y', 'width', 'height')
          )
          or exists (
            select 1 from jsonb_each(v_corrected_value) item where jsonb_typeof(item.value) <> 'number'
          ) then
          raise exception 'Malformed corrected source coordinates.' using errcode = '22023';
        end if;
        if (v_corrected_value ->> 'page')::numeric <> trunc((v_corrected_value ->> 'page')::numeric)
          or (v_corrected_value ->> 'page')::numeric not between 1 and v_job.page_count
          or (v_corrected_value ->> 'x')::numeric < 0
          or (v_corrected_value ->> 'y')::numeric < 0
          or (v_corrected_value ->> 'width')::numeric <= 0
          or (v_corrected_value ->> 'height')::numeric <= 0
          or greatest(
            (v_corrected_value ->> 'x')::numeric,
            (v_corrected_value ->> 'y')::numeric,
            (v_corrected_value ->> 'width')::numeric,
            (v_corrected_value ->> 'height')::numeric
          ) > 100000 then
          raise exception 'Corrected source coordinates are out of bounds.' using errcode = '22023';
        end if;
      else
        raise exception 'Unsupported corrected value type.' using errcode = '22023';
      end if;
      v_corrected_field_count := v_corrected_field_count + 1;
    else
      if v_decision ? 'corrected_value' then
        raise exception 'Only corrected decisions may include a corrected value.' using errcode = '22023';
      end if;
      if v_decision_kind = 'confirmed' then
        v_confirmed_field_count := v_confirmed_field_count + 1;
      elsif v_decision_kind = 'rejected' then
        v_rejected_field_count := v_rejected_field_count + 1;
      else
        v_unresolved_field_count := v_unresolved_field_count + 1;
      end if;
    end if;
    v_seen_field_ids := array_append(v_seen_field_ids, v_field_id);
  end loop;
  if p_action = 'approve' then
    if v_rejected_field_count > 0 or v_unresolved_field_count > 0
      or p_classification_fingerprint is null
      or not exists (
        select 1 from public.document_extraction_cache cache
        where cache.workspace_id = p_workspace_id and cache.source_job_id = p_job_id
          and cache.artifact_fingerprint = p_artifact_fingerprint and cache.invalidated_at is null
      ) then
      raise exception 'All critical fields and fingerprints must be resolved before approval.' using errcode = '22023';
    end if;
    v_status := case when v_corrected_field_count > 0 then 'approved_with_corrections' else 'approved' end;
  elsif p_action = 'reject' then
    if v_rejected_field_count = 0 then
      raise exception 'A rejected review requires at least one rejected field.' using errcode = '22023';
    end if;
    v_status := 'rejected';
  else
    v_status := case when v_unresolved_field_count > 0 then 'unresolved' else 'in_review' end;
  end if;

  insert into public.document_extraction_reviews (
    workspace_id, job_id, file_id, status, reviewer_id, reviewed_at,
    artifact_fingerprint, classification_fingerprint, extraction_contract_version,
    critical_field_manifest_fingerprint, review_version,
    critical_field_count, confirmed_field_count, corrected_field_count,
    rejected_field_count, unresolved_field_count, decision_summary_json
  ) values (
    p_workspace_id, p_job_id, p_file_id, v_status, v_actor,
    case when v_status in ('approved', 'approved_with_corrections', 'rejected') then now() else null end,
    p_artifact_fingerprint, p_classification_fingerprint, p_extraction_contract_version,
    v_job.critical_field_manifest_fingerprint, p_review_version,
    v_critical_field_count, v_confirmed_field_count, v_corrected_field_count,
    v_rejected_field_count, v_unresolved_field_count, p_decision_summary_json
  )
  on conflict (workspace_id, job_id, review_version) do update
  set file_id = excluded.file_id, status = excluded.status, reviewer_id = excluded.reviewer_id,
      reviewed_at = excluded.reviewed_at, artifact_fingerprint = excluded.artifact_fingerprint,
      classification_fingerprint = excluded.classification_fingerprint,
      extraction_contract_version = excluded.extraction_contract_version,
      critical_field_manifest_fingerprint = excluded.critical_field_manifest_fingerprint,
      critical_field_count = excluded.critical_field_count,
      confirmed_field_count = excluded.confirmed_field_count,
      corrected_field_count = excluded.corrected_field_count,
      rejected_field_count = excluded.rejected_field_count,
      unresolved_field_count = excluded.unresolved_field_count,
      decision_summary_json = excluded.decision_summary_json,
      updated_at = now()
  returning * into v_review;

  update public.document_extraction_jobs
  set approval_status = v_status,
      status = case when v_status in ('approved', 'approved_with_corrections') then 'completed' else status end,
      stage = case when v_status in ('approved', 'approved_with_corrections') then 'terminal' else 'awaiting_review' end,
      updated_at = now()
  where id = p_job_id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    p_workspace_id, p_job_id,
    case when v_status in ('approved', 'approved_with_corrections') then 'review_approved' else 'review_updated' end,
    'user', v_actor, v_job.stage, v_job.status, v_status, p_artifact_fingerprint,
    jsonb_build_object(
      'review_id', v_review.id, 'review_version', p_review_version,
      'critical_fields', v_critical_field_count, 'confirmed_fields', v_confirmed_field_count,
      'corrected_fields', v_corrected_field_count, 'rejected_fields', v_rejected_field_count,
      'unresolved_fields', v_unresolved_field_count,
      'manifest_fingerprint', v_job.critical_field_manifest_fingerprint
    ), p_request_id
  );
  return jsonb_build_object(
    'review_id', v_review.id,
    'job_id', p_job_id,
    'status', v_status,
    'critical_field_count', v_critical_field_count,
    'confirmed_field_count', v_confirmed_field_count,
    'corrected_field_count', v_corrected_field_count,
    'rejected_field_count', v_rejected_field_count,
    'unresolved_field_count', v_unresolved_field_count
  );
end;
$$;

create or replace function public.document_extraction_authority_is_approved_v1(
  p_workspace_id uuid,
  p_file_id uuid,
  p_job_id uuid,
  p_review_id uuid,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_review_version integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_extraction_jobs job
    join public.document_extraction_file_bindings binding
      on binding.workspace_id = job.workspace_id and binding.job_id = job.id
      and binding.file_id = p_file_id and binding.is_current
    join public.document_extraction_reviews review
      on review.workspace_id = job.workspace_id and review.job_id = job.id and review.id = p_review_id
    join public.document_extraction_cache cache
      on cache.workspace_id = job.workspace_id and cache.source_job_id = job.id and cache.cache_key = job.cache_key
    join public.document_extraction_workspace_settings settings
      on settings.workspace_id = job.workspace_id
    where job.workspace_id = p_workspace_id
      and job.id = p_job_id
      and job.status = 'completed'
      and job.approval_status in ('approved', 'approved_with_corrections')
      and job.artifact_fingerprint = p_artifact_fingerprint
      and job.classification_fingerprint = p_classification_fingerprint
      and review.file_id = job.file_id
      and review.status in ('approved', 'approved_with_corrections')
      and review.review_version = p_review_version
      and review.review_version = job.required_review_version
      and review.extraction_contract_version = job.extraction_contract_version
      and review.critical_field_manifest_fingerprint = job.critical_field_manifest_fingerprint
      and review.artifact_fingerprint = p_artifact_fingerprint
      and review.classification_fingerprint = p_classification_fingerprint
      and review.unresolved_field_count = 0
      and review.rejected_field_count = 0
      and review.critical_field_count = jsonb_array_length(job.critical_field_manifest_json -> 'fields')
      and cache.invalidated_at is null
      and cache.artifact_fingerprint = p_artifact_fingerprint
      and job.document_class = any(settings.allowed_document_classes)
  );
$$;

create or replace function public.assert_document_extraction_authority_v1(
  p_workspace_id uuid,
  p_file_id uuid,
  p_job_id uuid,
  p_review_id uuid,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_review_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_approved boolean;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied.' using errcode = '42501';
  end if;
  v_approved := public.document_extraction_authority_is_approved_v1(
    p_workspace_id, p_file_id, p_job_id, p_review_id,
    p_artifact_fingerprint, p_classification_fingerprint, p_review_version
  );
  return jsonb_build_object(
    'eligible', v_approved,
    'reason', case when v_approved then 'eligible' else 'approval_missing_or_stale' end
  );
end;
$$;

create or replace function public.resolve_document_extraction_file_authority_v1(
  p_workspace_id uuid,
  p_file_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_binding public.document_extraction_file_bindings%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_review public.document_extraction_reviews%rowtype;
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if not v_is_service and not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.file_uploads file
    where file.id = p_file_id and file.workspace_id = p_workspace_id
      and file.deleted_at is null and file.archived_at is null
  ) then
    raise exception 'Active source file not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.document_extraction_file_bindings binding
    join public.document_extraction_jobs job
      on job.workspace_id = binding.workspace_id and job.id = binding.job_id
    where binding.workspace_id = p_workspace_id
      and binding.file_id = p_file_id
      and job.review_required
  ) then
    return jsonb_build_object('eligible', true, 'mode', 'existing_native_file_analysis', 'reason', 'existing_native_compatibility');
  end if;
  select * into v_binding
  from public.document_extraction_file_bindings
  where workspace_id = p_workspace_id and file_id = p_file_id and is_current
  order by created_at desc, id desc
  limit 1;
  if v_binding.id is null then
    return jsonb_build_object('eligible', false, 'mode', 'unapproved_document_extraction', 'reason', 'approval_missing_or_stale');
  end if;
  select * into v_job from public.document_extraction_jobs
  where id = v_binding.job_id and workspace_id = p_workspace_id;
  select * into v_review from public.document_extraction_reviews
  where workspace_id = p_workspace_id and job_id = v_job.id
    and review_version = v_job.required_review_version
  limit 1;
  if v_job.id is null or v_review.id is null or not public.document_extraction_authority_is_approved_v1(
    p_workspace_id,
    p_file_id,
    v_job.id,
    v_review.id,
    v_job.artifact_fingerprint,
    v_job.classification_fingerprint,
    v_job.required_review_version
  ) then
    return jsonb_build_object('eligible', false, 'mode', 'unapproved_document_extraction', 'reason', 'approval_missing_or_stale');
  end if;
  return jsonb_build_object(
    'eligible', true,
    'mode', 'reviewed_document_extraction',
    'reason', 'eligible',
    'job_id', v_job.id,
    'review_id', v_review.id,
    'artifact_fingerprint', v_job.artifact_fingerprint,
    'classification_fingerprint', v_job.classification_fingerprint,
    'review_version', v_job.required_review_version
  );
end;
$$;

create or replace function public.protect_document_extraction_file_state_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_key text;
begin
  if current_user = 'postgres' then return new; end if;
  foreach v_key in array array[
    'document_extraction_job_id',
    'document_extraction_review_id',
    'document_extraction_artifact_fingerprint',
    'document_extraction_classification_fingerprint',
    'document_extraction_review_version',
    'document_extraction_authority'
  ] loop
    if coalesce(old.metadata_json, '{}'::jsonb) -> v_key
        is distinct from coalesce(new.metadata_json, '{}'::jsonb) -> v_key then
      raise exception 'Document extraction authority metadata is server controlled.' using errcode = '42501';
    end if;
  end loop;
  if exists (
    select 1 from public.document_extraction_intake_requests intake
    where intake.workspace_id = old.workspace_id and intake.file_id = old.id
  ) and (
    new.workspace_id is distinct from old.workspace_id
    or new.mime_type is distinct from old.mime_type
    or new.file_extension is distinct from old.file_extension
    or new.file_size_bytes is distinct from old.file_size_bytes
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
  ) then
    raise exception 'Stored source identity is immutable after extraction intake.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_document_extraction_file_state on public.file_uploads;
create trigger protect_document_extraction_file_state
  before update on public.file_uploads
  for each row execute function public.protect_document_extraction_file_state_v1();

create or replace function public.enforce_document_extraction_authority_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file_id uuid;
  v_metadata jsonb;
  v_job_text text;
  v_review_text text;
  v_artifact text;
  v_classification text;
  v_review_version integer;
begin
  if tg_table_name = 'business_memory_chunks' then
    v_file_id := new.source_file_id;
    v_metadata := coalesce(new.source_metadata, '{}'::jsonb);
  else
    v_file_id := new.source_file_id;
    v_metadata := coalesce(new.raw_data_json, '{}'::jsonb);
  end if;
  if v_file_id is null or not exists (
    select 1
    from public.document_extraction_file_bindings binding
    join public.document_extraction_jobs job
      on job.workspace_id = binding.workspace_id and job.id = binding.job_id
    where binding.workspace_id = new.workspace_id
      and binding.file_id = v_file_id
      and job.review_required
  ) then
    return new;
  end if;

  v_job_text := coalesce(v_metadata ->> 'document_extraction_job_id', v_metadata #>> '{document_extraction_authority,job_id}');
  v_review_text := coalesce(v_metadata ->> 'document_extraction_review_id', v_metadata #>> '{document_extraction_authority,review_id}');
  v_artifact := coalesce(v_metadata ->> 'document_extraction_artifact_fingerprint', v_metadata #>> '{document_extraction_authority,artifact_fingerprint}');
  v_classification := coalesce(v_metadata ->> 'document_extraction_classification_fingerprint', v_metadata #>> '{document_extraction_authority,classification_fingerprint}');
  v_review_version := coalesce(
    nullif(v_metadata ->> 'document_extraction_review_version', '')::integer,
    nullif(v_metadata #>> '{document_extraction_authority,review_version}', '')::integer
  );
  if v_job_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_review_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_artifact !~ '^[0-9a-f]{64}$' or v_classification !~ '^[0-9a-f]{64}$'
    or v_review_version is null then
    raise exception 'Extraction-derived authoritative writes require a complete approval envelope.' using errcode = '42501';
  end if;
  if not public.document_extraction_authority_is_approved_v1(
    new.workspace_id, v_file_id, v_job_text::uuid, v_review_text::uuid,
    v_artifact, v_classification, v_review_version
  ) then
    raise exception 'Extraction-derived authoritative write is not approved.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_document_extraction_business_memory_authority on public.business_memory_chunks;
create trigger enforce_document_extraction_business_memory_authority
  before insert or update on public.business_memory_chunks
  for each row execute function public.enforce_document_extraction_authority_v1();
drop trigger if exists enforce_document_extraction_kpi_authority on public.kpis;
create trigger enforce_document_extraction_kpi_authority
  before insert or update on public.kpis
  for each row execute function public.enforce_document_extraction_authority_v1();
drop trigger if exists enforce_document_extraction_operational_metric_authority on public.operational_metrics;
create trigger enforce_document_extraction_operational_metric_authority
  before insert or update on public.operational_metrics
  for each row execute function public.enforce_document_extraction_authority_v1();

alter table public.document_extraction_workspace_settings enable row level security;
alter table public.document_extraction_system_state enable row level security;
alter table public.document_extraction_intake_requests enable row level security;
alter table public.document_extraction_jobs enable row level security;
alter table public.document_extraction_file_bindings enable row level security;
alter table public.document_extraction_cache enable row level security;
alter table public.document_extraction_reviews enable row level security;
alter table public.document_extraction_events enable row level security;

drop policy if exists "workspace members read document extraction settings" on public.document_extraction_workspace_settings;
drop policy if exists "clients cannot access document extraction system state" on public.document_extraction_system_state;
drop policy if exists "workspace members read document extraction intake" on public.document_extraction_intake_requests;
drop policy if exists "workspace members read document extraction jobs" on public.document_extraction_jobs;
drop policy if exists "workspace members read document extraction bindings" on public.document_extraction_file_bindings;
drop policy if exists "clients cannot access document extraction cache" on public.document_extraction_cache;
drop policy if exists "workspace members read document extraction reviews" on public.document_extraction_reviews;
drop policy if exists "workspace members read document extraction events" on public.document_extraction_events;

create policy "workspace members read document extraction settings"
  on public.document_extraction_workspace_settings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "clients cannot access document extraction system state"
  on public.document_extraction_system_state for all to authenticated
  using (false) with check (false);
create policy "workspace members read document extraction intake"
  on public.document_extraction_intake_requests for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "workspace members read document extraction jobs"
  on public.document_extraction_jobs for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "workspace members read document extraction bindings"
  on public.document_extraction_file_bindings for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "clients cannot access document extraction cache"
  on public.document_extraction_cache for all to authenticated
  using (false) with check (false);
create policy "workspace members read document extraction reviews"
  on public.document_extraction_reviews for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "workspace members read document extraction events"
  on public.document_extraction_events for select to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all privileges on table public.document_extraction_workspace_settings from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_system_state from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_intake_requests from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_jobs from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_file_bindings from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_cache from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_reviews from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_events from public, anon, authenticated, service_role;

grant select on table public.document_extraction_workspace_settings to authenticated;
grant select on table public.document_extraction_intake_requests to authenticated;
grant select on table public.document_extraction_jobs to authenticated;
grant select on table public.document_extraction_file_bindings to authenticated;
grant select on table public.document_extraction_reviews to authenticated;
grant select on table public.document_extraction_events to authenticated;

revoke execute on function public.prevent_document_extraction_event_mutation_v1() from public, anon, authenticated, service_role;
revoke execute on function public.record_document_extraction_event_v1(uuid, uuid, text, text, uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.document_extraction_runtime_reason_v1(uuid, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.document_extraction_authority_is_approved_v1(uuid, uuid, uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.validate_document_extraction_critical_field_manifest_v1(jsonb, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.protect_document_extraction_file_state_v1() from public, anon, authenticated, service_role;
revoke execute on function public.enforce_document_extraction_authority_v1() from public, anon, authenticated, service_role;

revoke execute on function public.evaluate_document_extraction_eligibility_v1(uuid, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.request_document_extraction_intake_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_document_extraction_job_v1(uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.claim_document_extraction_job_v1(text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.heartbeat_document_extraction_job_v1(uuid, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.authorize_document_extraction_dispatch_v1(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.complete_document_extraction_job_v1(uuid, text, text, text, jsonb, bytea, text, bytea, bytea, text) from public, anon, authenticated, service_role;
revoke execute on function public.fail_document_extraction_job_v1(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.retry_document_extraction_job_v1(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.set_document_extraction_classification_v1(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.invalidate_document_extraction_cache_v1(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.mutate_document_extraction_review_v1(uuid, uuid, uuid, text, text, text, text, integer, jsonb, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.assert_document_extraction_authority_v1(uuid, uuid, uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_document_extraction_file_authority_v1(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.evaluate_document_extraction_eligibility_v1(uuid, text, integer) to authenticated;
grant execute on function public.request_document_extraction_intake_v1(uuid, uuid) to authenticated;
grant execute on function public.mutate_document_extraction_review_v1(uuid, uuid, uuid, text, text, text, text, integer, jsonb, uuid) to authenticated;
grant execute on function public.assert_document_extraction_authority_v1(uuid, uuid, uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.resolve_document_extraction_file_authority_v1(uuid, uuid) to authenticated, service_role;

grant execute on function public.enqueue_document_extraction_job_v1(uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.claim_document_extraction_job_v1(text, integer) to service_role;
grant execute on function public.heartbeat_document_extraction_job_v1(uuid, text, integer) to service_role;
grant execute on function public.authorize_document_extraction_dispatch_v1(uuid, text) to service_role;
grant execute on function public.complete_document_extraction_job_v1(uuid, text, text, text, jsonb, bytea, text, bytea, bytea, text) to service_role;
grant execute on function public.fail_document_extraction_job_v1(uuid, text, text, text) to service_role;
grant execute on function public.retry_document_extraction_job_v1(uuid) to service_role;
grant execute on function public.set_document_extraction_classification_v1(uuid, text, text) to service_role;
grant execute on function public.invalidate_document_extraction_cache_v1(uuid, text, text) to service_role;

comment on table public.document_extraction_cache is
  'Encrypted provider-neutral normalized extraction only. Raw provider requests/responses and plaintext payloads are prohibited.';
comment on table public.document_extraction_reviews is
  'Human review authority for extracted critical fields. These records never become Evidence or Business Memory directly.';
comment on table public.document_extraction_events is
  'Privacy-safe append-only operational history excluded from Evidence, Business Memory, retrieval, embeddings, AI context, and Saved Analyses.';
comment on function public.assert_document_extraction_authority_v1(uuid, uuid, uuid, uuid, text, text, integer) is
  'Fail-closed authority guard for future extraction-derived writes. It does not authorize current native, Business Notes, or spreadsheet paths.';
