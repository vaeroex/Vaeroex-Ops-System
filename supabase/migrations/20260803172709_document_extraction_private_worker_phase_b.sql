-- Document Extraction Private Worker - Phase B
--
-- This migration is additive and inert. It gives the private broker narrowly
-- scoped worker identity, lease, file-access, state-transition, circuit, and
-- telemetry primitives. It does not enable the system, entitle a workspace,
-- enqueue a job, backfill customer data, or grant clients direct write access.

alter table public.document_extraction_jobs
  drop constraint if exists document_extraction_jobs_stage_check;
alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_stage_check check (stage in (
    'queued', 'leased', 'preparing', 'dispatching', 'provider_dispatched',
    'extracting', 'normalizing', 'validating', 'encrypting',
    'awaiting_review', 'classifying', 'promoting', 'terminal'
  ));

alter table public.document_extraction_jobs
  drop constraint if exists document_extraction_jobs_failure_class_check;
alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_failure_class_check check (
    failure_class is null or failure_class in (
      'pre_provider', 'transport', 'timeout', 'rate_limit', 'provider',
      'validation', 'encryption', 'authorization', 'quota',
      'unsupported_input', 'ambiguous_dispatch', 'internal'
    )
  );

alter table public.document_extraction_jobs
  add column if not exists broker_protocol_version text,
  add column if not exists worker_runtime_version text,
  add column if not exists dispatch_request_id uuid,
  add column if not exists provider_call_count integer not null default 0,
  add column if not exists retry_count integer not null default 0,
  add column if not exists provider_result_class text,
  add column if not exists provider_latency_ms integer,
  add column if not exists provider_outcome_recorded_at timestamptz,
  add column if not exists validation_result text,
  add column if not exists encryption_result text,
  add column if not exists cache_result text,
  add column if not exists cost_rate_version text,
  add column if not exists cost_amount_usd numeric(14, 6),
  add column if not exists last_stage_transition_at timestamptz;

alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_phase_b_versions_check check (
    (broker_protocol_version is null or broker_protocol_version = 'document_extraction_broker_v1')
    and (worker_runtime_version is null or worker_runtime_version = 'document_extraction_worker_v1')
  ),
  add constraint document_extraction_jobs_provider_counts_check check (
    provider_call_count between 0 and 2
    and retry_count between 0 and 1
    and retry_count <= provider_call_count
  ),
  add constraint document_extraction_jobs_provider_result_check check (
    provider_result_class is null or provider_result_class in (
      'success', 'transport', 'timeout', 'rate_limit', 'provider',
      'malformed_output', 'validation', 'ambiguous_dispatch'
    )
  ),
  add constraint document_extraction_jobs_provider_latency_check check (
    provider_latency_ms is null or provider_latency_ms between 0 and 180000
  ),
  add constraint document_extraction_jobs_outcome_check check (
    (provider_outcome_recorded_at is null and provider_result_class is null)
    or (provider_outcome_recorded_at is not null and provider_result_class is not null)
  ),
  add constraint document_extraction_jobs_cost_check check (
    cost_amount_usd is null or cost_amount_usd >= 0
  );

alter table public.document_extraction_system_state
  add column if not exists circuit_policy_version text not null default 'document_extraction_circuit_v1',
  add column if not exists failure_window_started_at timestamptz,
  add column if not exists last_provider_result_at timestamptz,
  add column if not exists half_open_authorized_at timestamptz,
  add column if not exists provider_success_count integer not null default 0,
  add column if not exists circuit_reason_code text;

alter table public.document_extraction_system_state
  add constraint document_extraction_system_phase_b_policy_check check (
    circuit_policy_version = 'document_extraction_circuit_v1'
  ),
  add constraint document_extraction_system_success_count_check check (provider_success_count >= 0),
  add constraint document_extraction_system_circuit_reason_check check (
    circuit_reason_code is null or circuit_reason_code ~ '^[a-z0-9._:-]{1,100}$'
  );

create table if not exists public.document_extraction_worker_assertions (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  key_version text not null check (key_version ~ '^[A-Za-z0-9._:-]{1,120}$'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  asserted_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint document_extraction_worker_assertions_unique unique (worker_id, key_version, nonce_hash),
  constraint document_extraction_worker_assertions_window_check check (
    expires_at > asserted_at and expires_at <= asserted_at + interval '5 minutes'
  )
);

create table if not exists public.document_extraction_file_access_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  file_id uuid not null references public.file_uploads(id) on delete cascade,
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_extraction_file_grant_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '2 minutes'
  )
);

create table if not exists public.document_extraction_operational_telemetry (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  telemetry_version text not null check (telemetry_version = 'document_extraction_telemetry_v1'),
  job_id_hash text not null check (job_id_hash ~ '^[0-9a-f]{64}$'),
  workspace_hash text not null check (workspace_hash ~ '^[0-9a-f]{64}$'),
  parser_route text not null check (parser_route in ('nvidia_primary', 'nvidia_fallback')),
  document_class text not null check (document_class in (
    'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
    'png', 'jpeg', 'screenshot', 'phone_photo'
  )),
  pages_qualified integer not null check (pages_qualified between 1 and 16),
  pages_dispatched integer not null check (pages_dispatched between 0 and 16),
  provider_calls integer not null check (provider_calls between 0 and 2),
  retry_count integer not null check (retry_count between 0 and 1),
  latency_ms integer check (latency_ms is null or latency_ms between 0 and 300000),
  provider_result_class text check (
    provider_result_class is null or provider_result_class in (
      'success', 'transport', 'timeout', 'rate_limit', 'provider',
      'malformed_output', 'validation', 'ambiguous_dispatch'
    )
  ),
  validation_result text check (validation_result is null or validation_result ~ '^[a-z0-9._:-]{1,100}$'),
  encryption_result text check (encryption_result is null or encryption_result ~ '^[a-z0-9._:-]{1,100}$'),
  cache_result text check (cache_result is null or cache_result ~ '^[a-z0-9._:-]{1,100}$'),
  circuit_state text not null check (circuit_state in ('closed', 'open', 'half_open')),
  quota_pages_reserved integer not null check (quota_pages_reserved >= 0),
  quota_pages_consumed integer not null check (quota_pages_consumed >= 0),
  model_revision text not null check (char_length(model_revision) between 1 and 200),
  client_revision text not null check (char_length(client_revision) between 1 and 200),
  cost_rate_version text,
  cost_amount_usd numeric(14, 6),
  created_at timestamptz not null default now(),
  constraint document_extraction_telemetry_cost_check check (
    cost_amount_usd is null or cost_amount_usd >= 0
  )
);

create index if not exists document_extraction_worker_assertions_expiry_idx
  on public.document_extraction_worker_assertions(expires_at);
create index if not exists document_extraction_file_grants_job_idx
  on public.document_extraction_file_access_grants(job_id, created_at desc);
create index if not exists document_extraction_file_grants_expiry_idx
  on public.document_extraction_file_access_grants(expires_at)
  where consumed_at is null;
create index if not exists document_extraction_telemetry_created_idx
  on public.document_extraction_operational_telemetry(created_at desc);

create or replace function public.prevent_document_extraction_telemetry_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Document extraction telemetry is append-only.' using errcode = '42501';
end;
$$;

drop trigger if exists prevent_document_extraction_telemetry_mutation
  on public.document_extraction_operational_telemetry;
create trigger prevent_document_extraction_telemetry_mutation
  before update or delete on public.document_extraction_operational_telemetry
  for each row execute function public.prevent_document_extraction_telemetry_mutation_v1();

create or replace function public.consume_document_extraction_worker_assertion_v1(
  p_worker_id text,
  p_key_version text,
  p_nonce_hash text,
  p_request_hash text,
  p_asserted_at timestamptz,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or p_key_version !~ '^[A-Za-z0-9._:-]{1,120}$'
    or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_asserted_at < now() - interval '90 seconds'
    or p_asserted_at > now() + interval '15 seconds'
    or p_expires_at <= now()
    or p_expires_at > p_asserted_at + interval '90 seconds' then
    raise exception 'Worker assertion is expired or malformed.' using errcode = '42501';
  end if;
  insert into public.document_extraction_worker_assertions (
    worker_id, key_version, nonce_hash, request_hash, asserted_at, expires_at
  ) values (
    p_worker_id, p_key_version, p_nonce_hash, p_request_hash, p_asserted_at, p_expires_at
  );
  return true;
exception
  when unique_violation then
    raise exception 'Worker assertion replay detected.' using errcode = '42501';
end;
$$;

create or replace function public.claim_document_extraction_job_v2(
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
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$' or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid private-worker lease request.' using errcode = '22023';
  end if;

  with ambiguous as (
    update public.document_extraction_jobs job
    set status = 'dispatch_unknown', stage = 'terminal', lease_owner = null,
        lease_expires_at = null, heartbeat_at = null,
        failure_code = 'lease_expired_after_dispatch', failure_class = 'ambiguous_dispatch',
        provider_result_class = coalesce(provider_result_class, 'ambiguous_dispatch'),
        provider_outcome_recorded_at = coalesce(provider_outcome_recorded_at, now()),
        failed_at = now(), updated_at = now()
    where job.status = 'processing'
      and job.lease_expires_at <= now()
      and job.provider_dispatched_at is not null
    returning job.*
  )
  insert into public.document_extraction_events (
    workspace_id, job_id, event_type, actor_type, stage, status,
    reason_code, metadata_json, request_id
  )
  select workspace_id, id, 'dispatch_became_ambiguous', 'system', stage, status,
    failure_code, '{}'::jsonb, gen_random_uuid()
  from ambiguous;

  select job.* into v_job
  from public.document_extraction_jobs job
  join public.document_extraction_intake_requests intake on intake.id = job.intake_request_id
  where (
      job.status = 'queued'
      or (
        job.status = 'processing'
        and job.lease_expires_at <= now()
        and job.provider_dispatched_at is null
      )
    )
    and job.route in ('nvidia_primary', 'nvidia_fallback')
    and job.review_required
    and job.attempts < job.max_attempts
    and job.page_count between 1 and 16
    and intake.file_size_bytes between 1 and 25000000
    and job.parser_provider = 'nvidia'
    and job.parser_model = 'nvidia/nemotron-parse'
    and job.parser_revision = 'nemo_retriever_multimodal_extraction_v1'
    and job.client_revision = '52886112cafab4c4bca1cda0d4f588785adfe4d3'
    and job.extraction_contract_version = 'document_extraction_artifact_v1'
    and job.normalization_version = 'document_extraction_normalization_v1'
    and public.document_extraction_runtime_reason_v1(job.workspace_id, job.document_class, 0) = 'eligible'
  order by job.created_at
  for update of job skip locked
  limit 1;

  if v_job.id is null then return; end if;
  update public.document_extraction_jobs
  set status = 'processing', stage = 'leased', attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()),
      broker_protocol_version = 'document_extraction_broker_v1',
      worker_runtime_version = 'document_extraction_worker_v1',
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_claimed', 'worker', null, v_job.stage,
    v_job.status, null, null,
    jsonb_build_object('attempt', v_job.attempts, 'broker_protocol', v_job.broker_protocol_version),
    gen_random_uuid()
  );
  return next v_job;
end;
$$;

create or replace function public.advance_document_extraction_job_v2(
  p_job_id uuid,
  p_worker_id text,
  p_expected_stage text,
  p_next_stage text,
  p_request_id uuid
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
    or v_job.lease_expires_at <= now() or v_job.stage <> p_expected_stage then
    raise exception 'The worker cannot advance this job.' using errcode = '42501';
  end if;
  if not (
    (p_expected_stage = 'leased' and p_next_stage = 'preparing')
    or (p_expected_stage = 'preparing' and p_next_stage = 'dispatching')
    or (p_expected_stage = 'provider_dispatched' and p_next_stage = 'extracting'
      and v_job.provider_result_class = 'success')
    or (p_expected_stage = 'extracting' and p_next_stage = 'normalizing')
    or (p_expected_stage = 'normalizing' and p_next_stage = 'validating')
    or (p_expected_stage = 'validating' and p_next_stage = 'encrypting')
  ) then
    raise exception 'Invalid document-extraction stage transition.' using errcode = '22023';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('advanced', false, 'reason', v_reason);
  end if;
  update public.document_extraction_jobs
  set stage = p_next_stage, last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_stage_advanced', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('from_stage', p_expected_stage), p_request_id
  );
  return jsonb_build_object('advanced', true, 'stage', v_job.stage, 'status', v_job.status);
end;
$$;

create or replace function public.resolve_document_extraction_job_lease_v1(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() then
    raise exception 'Active job lease not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id,
    'workspace_id', v_job.workspace_id,
    'route', v_job.route,
    'document_class', v_job.document_class,
    'page_count', v_job.page_count,
    'cache_key', v_job.cache_key,
    'extraction_contract_version', v_job.extraction_contract_version,
    'normalization_version', v_job.normalization_version,
    'stage', v_job.stage,
    'status', v_job.status,
    'lease_expires_at', v_job.lease_expires_at
  );
end;
$$;

create or replace function public.issue_document_extraction_file_grant_v1(
  p_job_id uuid,
  p_worker_id text,
  p_token_hash text,
  p_ttl_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_grant public.document_extraction_file_access_grants%rowtype;
  v_reason text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage not in ('leased', 'preparing')
    or p_token_hash !~ '^[0-9a-f]{64}$' or p_ttl_seconds not between 15 and 120 then
    raise exception 'File access is not authorized for this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('issued', false, 'reason', v_reason);
  end if;
  insert into public.document_extraction_file_access_grants (
    workspace_id, job_id, file_id, worker_id, token_hash, expires_at
  ) values (
    v_job.workspace_id, v_job.id, v_job.file_id, p_worker_id, p_token_hash,
    now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_grant;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'file_access_grant_issued', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('grant_id_hash', encode(extensions.digest(v_grant.id::text, 'sha256'), 'hex')),
    gen_random_uuid()
  );
  return jsonb_build_object(
    'issued', true, 'grant_id', v_grant.id, 'expires_at', v_grant.expires_at,
    'page_count', v_job.page_count
  );
end;
$$;

create or replace function public.consume_document_extraction_file_grant_v1(
  p_grant_id uuid,
  p_worker_id text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.document_extraction_file_access_grants%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_intake public.document_extraction_intake_requests%rowtype;
begin
  select * into v_grant from public.document_extraction_file_access_grants
  where id = p_grant_id for update;
  if v_grant.id is null or v_grant.worker_id <> p_worker_id
    or v_grant.token_hash <> p_token_hash or v_grant.expires_at <= now()
    or v_grant.consumed_at is not null then
    raise exception 'File access grant is expired, consumed, or invalid.' using errcode = '42501';
  end if;
  select * into v_job from public.document_extraction_jobs where id = v_grant.job_id for update;
  if v_job.id is null or v_job.file_id <> v_grant.file_id or v_job.workspace_id <> v_grant.workspace_id
    or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage not in ('leased', 'preparing') then
    raise exception 'The file grant no longer matches an active lease.' using errcode = '42501';
  end if;
  if public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0) <> 'eligible' then
    raise exception 'File access is disabled by the runtime policy.' using errcode = '42501';
  end if;
  select * into v_intake from public.document_extraction_intake_requests
  where id = v_job.intake_request_id and workspace_id = v_job.workspace_id and file_id = v_job.file_id;
  if v_intake.id is null or v_intake.storage_path not like v_job.workspace_id::text || '/%'
    or v_intake.file_size_bytes > 25000000 then
    raise exception 'Stored file identity is invalid.' using errcode = '42501';
  end if;
  update public.document_extraction_file_access_grants set consumed_at = now() where id = v_grant.id;
  return jsonb_build_object(
    'storage_bucket', v_intake.storage_bucket,
    'storage_path', v_intake.storage_path,
    'mime_type', v_intake.mime_type,
    'file_extension', v_intake.file_extension,
    'file_size_bytes', v_intake.file_size_bytes,
    'job_id', v_job.id
  );
end;
$$;

create or replace function public.authorize_document_extraction_dispatch_v2(
  p_job_id uuid,
  p_worker_id text,
  p_dispatch_request_id uuid
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
    or v_job.lease_expires_at <= now() then
    raise exception 'The job is not dispatchable by this lease.' using errcode = '42501';
  end if;
  if v_job.stage = 'provider_dispatched' and v_job.dispatch_request_id = p_dispatch_request_id then
    return jsonb_build_object('authorized', true, 'reason', 'eligible', 'idempotent', true);
  end if;
  if v_job.stage <> 'dispatching' or v_job.provider_dispatched_at is not null
    or v_job.dispatch_request_id is not null or v_job.provider_call_count <> 0
    or v_job.route not in ('nvidia_primary', 'nvidia_fallback')
    or v_job.parser_provider <> 'nvidia'
    or v_job.parser_model <> 'nvidia/nemotron-parse'
    or v_job.parser_revision <> 'nemo_retriever_multimodal_extraction_v1'
    or v_job.client_revision <> '52886112cafab4c4bca1cda0d4f588785adfe4d3'
    or v_job.page_count > 16 then
    raise exception 'The job does not match the approved provider contract.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('authorized', false, 'reason', v_reason, 'idempotent', false);
  end if;
  update public.document_extraction_workspace_settings
  set pages_reserved = greatest(0, pages_reserved - v_job.reserved_page_count),
      pages_consumed = pages_consumed + v_job.reserved_page_count,
      updated_at = now()
  where workspace_id = v_job.workspace_id;
  update public.document_extraction_jobs
  set stage = 'provider_dispatched', provider_dispatched_at = now(),
      dispatch_request_id = p_dispatch_request_id, provider_call_count = 1,
      billed_page_count = reserved_page_count, reserved_page_count = 0,
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'provider_dispatch_authorized', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('billed_pages', v_job.billed_page_count, 'provider_call', 1),
    p_dispatch_request_id
  );
  return jsonb_build_object('authorized', true, 'reason', 'eligible', 'idempotent', false);
end;
$$;

create or replace function public.record_document_extraction_provider_outcome_v1(
  p_job_id uuid,
  p_worker_id text,
  p_dispatch_request_id uuid,
  p_result_class text,
  p_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_system public.document_extraction_system_state%rowtype;
  v_opened boolean := false;
begin
  if p_result_class not in (
    'success', 'transport', 'timeout', 'rate_limit', 'provider',
    'malformed_output', 'validation', 'ambiguous_dispatch'
  ) or p_latency_ms not between 0 and 180000 then
    raise exception 'Invalid provider outcome.' using errcode = '22023';
  end if;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage <> 'provider_dispatched'
    or v_job.dispatch_request_id <> p_dispatch_request_id then
    raise exception 'Provider outcome does not match the active dispatch.' using errcode = '42501';
  end if;
  if v_job.provider_outcome_recorded_at is not null then
    if v_job.provider_result_class = p_result_class and v_job.provider_latency_ms = p_latency_ms then
      return jsonb_build_object('recorded', true, 'idempotent', true, 'circuit_state', null);
    end if;
    raise exception 'Provider outcome was already recorded differently.' using errcode = '23505';
  end if;
  update public.document_extraction_jobs
  set provider_result_class = p_result_class, provider_latency_ms = p_latency_ms,
      provider_outcome_recorded_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;

  select * into v_system from public.document_extraction_system_state
  where singleton_key = 'document_intelligence' for update;
  if p_result_class = 'success' then
    update public.document_extraction_system_state
    set consecutive_failures = 0, rolling_failure_count = 0,
        failure_window_started_at = null, last_provider_result_at = now(),
        provider_success_count = provider_success_count + 1, updated_at = now()
    where singleton_key = 'document_intelligence' returning * into v_system;
  else
    if v_system.failure_window_started_at is null
      or v_system.failure_window_started_at < now() - interval '10 minutes' then
      v_system.failure_window_started_at := now();
      v_system.rolling_failure_count := 0;
    end if;
    v_system.consecutive_failures := v_system.consecutive_failures + 1;
    v_system.rolling_failure_count := v_system.rolling_failure_count + 1;
    v_opened := p_result_class = 'ambiguous_dispatch'
      or v_system.consecutive_failures >= 3
      or v_system.rolling_failure_count >= 5;
    update public.document_extraction_system_state
    set consecutive_failures = v_system.consecutive_failures,
        rolling_failure_count = v_system.rolling_failure_count,
        failure_window_started_at = v_system.failure_window_started_at,
        last_provider_result_at = now(),
        circuit_state = case when v_opened then 'open' else circuit_state end,
        circuit_opened_at = case when v_opened then coalesce(circuit_opened_at, now()) else circuit_opened_at end,
        circuit_reason_code = case when v_opened then 'provider_failure_threshold' else circuit_reason_code end,
        updated_at = now()
    where singleton_key = 'document_intelligence' returning * into v_system;
  end if;
  if v_opened then
    perform public.record_document_extraction_event_v1(
      v_job.workspace_id, v_job.id, 'provider_circuit_opened', 'system', null,
      v_job.stage, v_job.status, 'provider_failure_threshold', null,
      jsonb_build_object('circuit_policy_version', v_system.circuit_policy_version),
      gen_random_uuid()
    );
  end if;
  return jsonb_build_object(
    'recorded', true, 'idempotent', false, 'circuit_state', v_system.circuit_state,
    'retry_permitted', p_result_class in ('transport', 'timeout', 'rate_limit')
      and v_job.retry_count < 1 and not v_opened
  );
end;
$$;

create or replace function public.authorize_document_extraction_retry_dispatch_v1(
  p_job_id uuid,
  p_worker_id text,
  p_prior_dispatch_request_id uuid,
  p_next_dispatch_request_id uuid
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
    or v_job.lease_expires_at <= now() or v_job.stage <> 'provider_dispatched'
    or v_job.dispatch_request_id <> p_prior_dispatch_request_id
    or v_job.provider_result_class not in ('transport', 'timeout', 'rate_limit')
    or v_job.provider_outcome_recorded_at is null or v_job.retry_count >= 1
    or v_job.provider_call_count <> 1 or p_next_dispatch_request_id = p_prior_dispatch_request_id then
    raise exception 'The provider call is not eligible for a safe retry.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('authorized', false, 'reason', v_reason);
  end if;
  update public.document_extraction_jobs
  set dispatch_request_id = p_next_dispatch_request_id,
      provider_call_count = 2, retry_count = 1,
      provider_result_class = null, provider_latency_ms = null,
      provider_outcome_recorded_at = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'provider_retry_authorized', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('provider_call', 2, 'retry_count', 1), p_next_dispatch_request_id
  );
  return jsonb_build_object('authorized', true, 'reason', 'eligible');
end;
$$;

create or replace function public.complete_document_extraction_job_v2(
  p_job_id uuid,
  p_worker_id text,
  p_artifact_fingerprint text,
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
  v_result jsonb;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage <> 'encrypting'
    or v_job.provider_result_class <> 'success' or v_job.provider_outcome_recorded_at is null then
    raise exception 'The job is not ready for encrypted completion.' using errcode = '42501';
  end if;
  select public.complete_document_extraction_job_v1(
    p_job_id, p_worker_id, p_artifact_fingerprint, null,
    p_critical_field_manifest_json, p_payload_ciphertext, p_encryption_key_version,
    p_encryption_nonce, p_authentication_tag, p_aad_digest
  ) into v_result;
  update public.document_extraction_jobs
  set validation_result = 'passed', encryption_result = 'encrypted',
      cache_result = 'stored', updated_at = now()
  where id = p_job_id;
  return v_result;
end;
$$;

create or replace function public.fail_document_extraction_job_v2(
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
  v_result jsonb;
begin
  if p_failure_code !~ '^[a-z0-9._:-]{1,100}$'
    or p_failure_class not in (
      'pre_provider', 'transport', 'timeout', 'rate_limit', 'provider',
      'validation', 'encryption', 'authorization', 'quota',
      'unsupported_input', 'ambiguous_dispatch', 'internal'
    ) then
    raise exception 'Invalid bounded failure reason.' using errcode = '22023';
  end if;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() then
    raise exception 'The job cannot be failed by this lease.' using errcode = '42501';
  end if;
  if p_failure_class = 'ambiguous_dispatch' then
    update public.document_extraction_jobs
    set status = 'dispatch_unknown', stage = 'terminal', failed_at = now(),
        failure_code = p_failure_code, failure_class = p_failure_class,
        provider_result_class = coalesce(provider_result_class, 'ambiguous_dispatch'),
        provider_outcome_recorded_at = coalesce(provider_outcome_recorded_at, now()),
        lease_owner = null, lease_expires_at = null, heartbeat_at = null,
        updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('job_id', v_job.id, 'status', 'dispatch_unknown', 'retryable', false);
  end if;
  select public.fail_document_extraction_job_v1(
    p_job_id, p_worker_id, p_failure_code, p_failure_class
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.record_document_extraction_telemetry_v1(
  p_job_id uuid,
  p_worker_id text,
  p_request_id uuid,
  p_job_id_hash text,
  p_workspace_hash text,
  p_latency_ms integer,
  p_validation_result text,
  p_encryption_result text,
  p_cache_result text,
  p_cost_rate_version text,
  p_cost_amount_usd numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_state public.document_extraction_system_state%rowtype;
  v_id uuid;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  if v_job.id is null or v_job.lease_owner is distinct from p_worker_id
    or v_job.status not in ('processing', 'needs_review', 'failed', 'dispatch_unknown')
    or p_job_id_hash !~ '^[0-9a-f]{64}$' or p_workspace_hash !~ '^[0-9a-f]{64}$'
    or (p_cost_rate_version is null) <> (p_cost_amount_usd is null) then
    raise exception 'Telemetry does not match the bounded job context.' using errcode = '42501';
  end if;
  select * into v_state from public.document_extraction_system_state
  where singleton_key = 'document_intelligence';
  insert into public.document_extraction_operational_telemetry (
    request_id, telemetry_version, job_id_hash, workspace_hash, parser_route, document_class,
    pages_qualified, pages_dispatched, provider_calls, retry_count, latency_ms,
    provider_result_class, validation_result, encryption_result, cache_result,
    circuit_state, quota_pages_reserved, quota_pages_consumed,
    model_revision, client_revision, cost_rate_version, cost_amount_usd
  ) values (
    p_request_id, 'document_extraction_telemetry_v1', p_job_id_hash, p_workspace_hash,
    v_job.route, v_job.document_class, v_job.pages_qualified,
    case when v_job.provider_dispatched_at is null then 0 else v_job.billed_page_count end,
    v_job.provider_call_count, v_job.retry_count, p_latency_ms,
    v_job.provider_result_class, p_validation_result, p_encryption_result, p_cache_result,
    v_state.circuit_state, v_job.reserved_page_count, v_job.billed_page_count,
    v_job.parser_revision, v_job.client_revision, p_cost_rate_version, p_cost_amount_usd
  ) on conflict (request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.document_extraction_operational_telemetry
    where request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.rotate_document_extraction_cache_envelope_v1(
  p_cache_id uuid,
  p_expected_artifact_fingerprint text,
  p_expected_key_version text,
  p_payload_ciphertext bytea,
  p_new_key_version text,
  p_encryption_nonce bytea,
  p_authentication_tag bytea,
  p_aad_digest text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cache public.document_extraction_cache%rowtype;
begin
  select * into v_cache from public.document_extraction_cache where id = p_cache_id for update;
  if v_cache.id is null or v_cache.invalidated_at is not null
    or v_cache.artifact_fingerprint <> p_expected_artifact_fingerprint
    or v_cache.encryption_key_version <> p_expected_key_version
    or p_payload_ciphertext is null or octet_length(p_payload_ciphertext) = 0
    or p_new_key_version !~ '^[A-Za-z0-9._:-]{1,120}$'
    or octet_length(p_encryption_nonce) <> 12 or octet_length(p_authentication_tag) <> 16
    or p_aad_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Cache rotation precondition failed.' using errcode = '42501';
  end if;
  update public.document_extraction_cache
  set payload_ciphertext = p_payload_ciphertext,
      encryption_key_version = p_new_key_version,
      encryption_nonce = p_encryption_nonce,
      authentication_tag = p_authentication_tag,
      aad_digest = p_aad_digest
  where id = v_cache.id;
  perform public.record_document_extraction_event_v1(
    v_cache.workspace_id, v_cache.source_job_id, 'cache_key_rotated', 'system', null,
    null, null, null, v_cache.artifact_fingerprint,
    jsonb_build_object('new_key_version', p_new_key_version), gen_random_uuid()
  );
  return true;
end;
$$;

create or replace function public.invalidate_document_extraction_cache_for_job_v1(
  p_job_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_reason_code !~ '^[a-z0-9._:-]{1,100}$' then
    raise exception 'A bounded cache invalidation reason is required.' using errcode = '22023';
  end if;
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'Document extraction job not found.' using errcode = 'P0002';
  end if;
  return public.invalidate_document_extraction_cache_v1(
    v_job.workspace_id, v_job.cache_key, p_reason_code
  );
end;
$$;

create or replace function public.set_document_extraction_circuit_state_v1(
  p_state text,
  p_reason_code text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.document_extraction_system_state%rowtype;
begin
  if p_state not in ('closed', 'open', 'half_open')
    or p_reason_code !~ '^[a-z0-9._:-]{1,100}$' then
    raise exception 'Invalid controlled circuit transition.' using errcode = '22023';
  end if;
  update public.document_extraction_system_state
  set circuit_state = p_state,
      circuit_opened_at = case when p_state = 'open' then now() else null end,
      half_open_authorized_at = case when p_state = 'half_open' then now() else null end,
      circuit_reason_code = p_reason_code,
      consecutive_failures = case when p_state = 'closed' then 0 else consecutive_failures end,
      rolling_failure_count = case when p_state = 'closed' then 0 else rolling_failure_count end,
      failure_window_started_at = case when p_state = 'closed' then null else failure_window_started_at end,
      updated_by = p_actor_id, updated_at = now()
  where singleton_key = 'document_intelligence'
  returning * into v_state;
  return jsonb_build_object('circuit_state', v_state.circuit_state, 'reason_code', v_state.circuit_reason_code);
end;
$$;

alter table public.document_extraction_worker_assertions enable row level security;
alter table public.document_extraction_file_access_grants enable row level security;
alter table public.document_extraction_operational_telemetry enable row level security;

revoke all privileges on table public.document_extraction_worker_assertions from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_file_access_grants from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_operational_telemetry from public, anon, authenticated, service_role;

revoke execute on function public.prevent_document_extraction_telemetry_mutation_v1() from public, anon, authenticated, service_role;
revoke execute on function public.consume_document_extraction_worker_assertion_v1(text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.claim_document_extraction_job_v2(text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.advance_document_extraction_job_v2(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_document_extraction_job_lease_v1(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.issue_document_extraction_file_grant_v1(uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.consume_document_extraction_file_grant_v1(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.record_document_extraction_provider_outcome_v1(uuid, text, uuid, text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.authorize_document_extraction_retry_dispatch_v1(uuid, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.complete_document_extraction_job_v2(uuid, text, text, jsonb, bytea, text, bytea, bytea, text) from public, anon, authenticated, service_role;
revoke execute on function public.fail_document_extraction_job_v2(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.record_document_extraction_telemetry_v1(uuid, text, uuid, text, text, integer, text, text, text, text, numeric) from public, anon, authenticated, service_role;
revoke execute on function public.rotate_document_extraction_cache_envelope_v1(uuid, text, text, bytea, text, bytea, bytea, text) from public, anon, authenticated, service_role;
revoke execute on function public.invalidate_document_extraction_cache_for_job_v1(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.set_document_extraction_circuit_state_v1(text, text, uuid) from public, anon, authenticated, service_role;

grant execute on function public.consume_document_extraction_worker_assertion_v1(text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.claim_document_extraction_job_v2(text, integer) to service_role;
grant execute on function public.advance_document_extraction_job_v2(uuid, text, text, text, uuid) to service_role;
grant execute on function public.resolve_document_extraction_job_lease_v1(uuid, text) to service_role;
grant execute on function public.issue_document_extraction_file_grant_v1(uuid, text, text, integer) to service_role;
grant execute on function public.consume_document_extraction_file_grant_v1(uuid, text, text) to service_role;
grant execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid) to service_role;
grant execute on function public.record_document_extraction_provider_outcome_v1(uuid, text, uuid, text, integer) to service_role;
grant execute on function public.authorize_document_extraction_retry_dispatch_v1(uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_document_extraction_job_v2(uuid, text, text, jsonb, bytea, text, bytea, bytea, text) to service_role;
grant execute on function public.fail_document_extraction_job_v2(uuid, text, text, text) to service_role;
grant execute on function public.record_document_extraction_telemetry_v1(uuid, text, uuid, text, text, integer, text, text, text, text, numeric) to service_role;
grant execute on function public.rotate_document_extraction_cache_envelope_v1(uuid, text, text, bytea, text, bytea, bytea, text) to service_role;
grant execute on function public.invalidate_document_extraction_cache_for_job_v1(uuid, text) to service_role;
grant execute on function public.set_document_extraction_circuit_state_v1(text, text, uuid) to service_role;

comment on table public.document_extraction_worker_assertions is
  'Single-use private-worker assertion replay ledger. Contains no document content.';
comment on table public.document_extraction_file_access_grants is
  'Short-lived, single-use broker file grants bound to one active job lease.';
comment on table public.document_extraction_operational_telemetry is
  'Append-only privacy-safe extraction operations telemetry; never stores content or customer identifiers.';
comment on function public.claim_document_extraction_job_v2(text, integer) is
  'NVIDIA-only Phase B lease claim. Exact provider revisions and inert runtime gates are enforced server-side.';
comment on function public.set_document_extraction_circuit_state_v1(text, text, uuid) is
  'Controlled service-role circuit recovery primitive. No client execution grant exists.';
