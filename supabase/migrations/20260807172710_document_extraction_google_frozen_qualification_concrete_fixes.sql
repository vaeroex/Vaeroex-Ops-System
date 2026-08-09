-- Concrete frozen-corpus qualification fixes discovered by the bounded Google run.
--
-- This migration remains Preview-bound and inert. It does not enable a gate,
-- grant provider access, create a worker, or give extracted output authority.

create table public.document_extraction_google_qualification_processing_job_bindings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.document_extraction_google_qualification_runs(id) on delete cascade,
  item_id uuid not null unique
    references public.document_extraction_google_qualification_items(id) on delete cascade,
  source_binding_id uuid not null unique
    references public.document_extraction_google_qualification_sources(id) on delete restrict,
  file_processing_job_id uuid not null unique
    references public.file_processing_jobs(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  file_id uuid not null references public.file_uploads(id) on delete restrict,
  fixture_index integer not null check (fixture_index between 1 and 12),
  created_at timestamptz not null default now()
);

alter table public.document_extraction_google_qualification_processing_job_bindings
  enable row level security;

revoke all on table
  public.document_extraction_google_qualification_processing_job_bindings
from public, anon, authenticated, service_role;

alter table public.document_extraction_google_qualification_cleanup_audits
  add column deleted_file_processing_job_count integer not null default 0
    check (deleted_file_processing_job_count between 0 and 8);

create or replace function public.bind_google_frozen_qualification_processing_job_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_processing_job public.file_processing_jobs%rowtype;
  v_match_count integer;
begin
  if not new.provider_eligible then
    return new;
  end if;

  select source.* into v_source
  from public.document_extraction_google_qualification_sources source
  where source.id = new.source_binding_id;
  select environment.* into v_environment
  from public.document_extraction_google_qualification_environment environment
  where environment.id = v_source.environment_id;

  if v_source.id is null
    or v_environment.id is null
    or new.run_id is null
    or new.intake_request_id <> v_source.intake_request_id
    or new.file_id <> v_source.file_id
    or new.fixture_index <> v_source.fixture_index
    or v_source.workspace_id <> v_environment.synthetic_workspace_id then
    raise exception 'Qualification upload-processing ownership is invalid.'
      using errcode = '42501';
  end if;

  select count(*) into v_match_count
  from public.file_processing_jobs processing_job
  where processing_job.workspace_id = v_environment.synthetic_workspace_id
    and processing_job.file_upload_id = v_source.file_id;

  if v_match_count <> 1 then
    raise exception 'Qualification upload-processing ownership is ambiguous.'
      using errcode = '42501';
  end if;

  select * into v_processing_job
  from public.file_processing_jobs
  where workspace_id = v_environment.synthetic_workspace_id
    and file_upload_id = v_source.file_id
    and job_type = 'extract'
    and status = 'queued'
    and attempts = 0
    and max_attempts = 3
    and started_at is null
    and completed_at is null
    and error_message is null
    and metadata_json ->> 'source' = 'upload'
  for update;
  if v_processing_job.id is null then
    raise exception 'Qualification upload-processing ownership is ambiguous.'
      using errcode = '42501';
  end if;

  insert into public.document_extraction_google_qualification_processing_job_bindings (
    run_id, item_id, source_binding_id, file_processing_job_id,
    workspace_id, file_id, fixture_index
  ) values (
    new.run_id, new.id, new.source_binding_id, v_processing_job.id,
    v_environment.synthetic_workspace_id, v_source.file_id, new.fixture_index
  );
  return new;
end;
$$;

drop trigger if exists bind_google_frozen_qualification_processing_job
  on public.document_extraction_google_qualification_items;
create trigger bind_google_frozen_qualification_processing_job
  after insert on public.document_extraction_google_qualification_items
  for each row execute function
    public.bind_google_frozen_qualification_processing_job_v1();

create or replace function public.begin_google_frozen_qualification_mutation_v1(
  p_intake_request_id uuid,
  p_operation text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_reservation public.document_extraction_google_qualification_page_reservations%rowtype;
  v_context jsonb;
  v_guard text;
begin
  if p_operation not in (
    'enqueue', 'claim', 'heartbeat', 'lease', 'advance', 'file_access',
    'dispatch', 'provider_boundary', 'provider_outcome', 'complete', 'fail',
    'cleanup'
  ) then
    raise exception 'Unknown Google qualification mutation.' using errcode = '22023';
  end if;

  select source.* into v_source
  from public.document_extraction_google_qualification_sources source
  where source.intake_request_id = p_intake_request_id;
  select environment.* into v_environment
  from public.document_extraction_google_qualification_environment environment
  where environment.id = v_source.environment_id;
  select item.* into v_item
  from public.document_extraction_google_qualification_items item
  where item.source_binding_id = v_source.id;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  where run.id = v_item.run_id;
  if v_item.job_id is not null then
    select reservation.* into v_reservation
    from public.document_extraction_google_qualification_page_reservations reservation
    where reservation.run_id = v_run.id
      and reservation.item_id = v_item.id
      and reservation.job_id = v_item.job_id
      and reservation.status = 'reserved';
  end if;

  if v_environment.id is null or v_run.id is null
    or v_item.id is null or v_source.id is null
    or v_source.environment_id <> v_environment.id
    or v_source.workspace_id <> v_environment.synthetic_workspace_id
    or v_source.intake_request_id <> p_intake_request_id
    or v_item.run_id <> v_run.id
    or v_item.source_binding_id <> v_source.id
    or v_item.intake_request_id <> v_source.intake_request_id
    or v_item.file_id <> v_source.file_id
    or v_item.fixture_index <> v_source.fixture_index
    or v_run.environment_id <> v_environment.id
    or v_run.workspace_id <> v_environment.synthetic_workspace_id
    or (
      p_operation = 'enqueue'
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index is not null
        or v_item.status <> 'planned'
        or v_item.job_id is not null
        or v_reservation.id is not null
      )
    )
    or (
      p_operation = 'claim'
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status not in ('queued', 'processing')
        or v_item.job_id is null
      )
    )
    or (
      p_operation not in ('enqueue', 'claim', 'fail', 'cleanup')
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status <> 'processing'
        or v_item.job_id is null
      )
    )
    or (
      p_operation = 'fail'
      and (
        v_run.status not in ('active', 'stopped')
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status <> 'processing'
        or v_item.job_id is null
      )
    )
    or (
      p_operation = 'cleanup'
      and v_run.status not in ('active', 'stopped', 'completed', 'cleaning')
    )
    or (p_operation = 'dispatch' and v_reservation.id is null)
    or (p_operation <> 'dispatch' and v_reservation.id is not null) then
    raise exception 'Google qualification mutation is not authorized.' using errcode = '42501';
  end if;

  v_context := jsonb_build_object(
    'environment_id', v_environment.id,
    'run_id', v_run.id,
    'workspace_id', v_run.workspace_id,
    'item_id', v_item.id,
    'source_binding_id', v_source.id,
    'job_id', v_item.job_id,
    'intake_request_id', v_item.intake_request_id,
    'file_id', v_item.file_id,
    'fixture_index', v_item.fixture_index,
    'reservation_id', v_reservation.id,
    'page_index', v_reservation.page_index,
    'operation', p_operation
  );
  v_guard := encode(extensions.digest(convert_to(
    v_environment.execution_guard_secret || ':' || v_context::text
      || ':' || txid_current()::text,
    'UTF8'
  ), 'sha256'), 'hex');
  perform set_config('vaeroex.google_qualification_guard_context', v_context::text, true);
  perform set_config('vaeroex.google_qualification_guard', v_guard, true);
  return true;
end;
$$;

create or replace function public.enforce_google_frozen_qualification_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_intake_id uuid;
  v_file_id uuid;
  v_workspace_id uuid;
  v_processing_job_id uuid;
  v_is_qualification_target boolean := false;
  v_context jsonb;
  v_context_text text;
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_reservation public.document_extraction_google_qualification_page_reservations%rowtype;
  v_expected_guard text;
  v_operation text;
  v_context_job_id uuid;
begin
  if tg_table_name = 'document_extraction_jobs' then
    v_job_id := coalesce(new.id, old.id);
    v_intake_id := coalesce(new.intake_request_id, old.intake_request_id);
    v_file_id := coalesce(new.file_id, old.file_id);
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  elsif tg_table_name = 'document_extraction_intake_requests' then
    v_intake_id := coalesce(new.id, old.id);
    v_file_id := coalesce(new.file_id, old.file_id);
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  elsif tg_table_name = 'file_uploads' then
    v_file_id := coalesce(new.id, old.id);
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  elsif tg_table_name = 'file_processing_jobs' then
    v_processing_job_id := coalesce(new.id, old.id);
    v_file_id := coalesce(new.file_upload_id, old.file_upload_id);
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  elsif tg_table_name = 'workspaces' then
    v_workspace_id := coalesce(new.id, old.id);
  elsif tg_table_name in (
    'workspace_members', 'document_extraction_workspace_settings'
  ) then
    v_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  elsif tg_table_name = 'document_extraction_cache' then
    v_job_id := coalesce(new.source_job_id, old.source_job_id);
  elsif tg_table_name in (
    'document_extraction_file_bindings', 'document_extraction_reviews',
    'document_extraction_events', 'document_extraction_file_access_grants',
    'document_extraction_provider_outcomes'
  ) then
    v_job_id := coalesce(new.job_id, old.job_id);
  end if;

  if v_job_id is not null and v_intake_id is null then
    select job.intake_request_id, job.file_id, job.workspace_id
      into v_intake_id, v_file_id, v_workspace_id
    from public.document_extraction_jobs job
    where job.id = v_job_id;
  end if;
  if v_intake_id is not null then
    select exists (
      select 1 from public.document_extraction_google_qualification_sources source
      where source.intake_request_id = v_intake_id
    ) into v_is_qualification_target;
  elsif v_file_id is not null then
    select exists (
      select 1 from public.document_extraction_google_qualification_sources source
      where source.file_id = v_file_id
    ) into v_is_qualification_target;
  elsif v_workspace_id is not null then
    select exists (
      select 1 from public.document_extraction_google_qualification_sources source
      where source.workspace_id = v_workspace_id
    ) into v_is_qualification_target;
  end if;

  if not v_is_qualification_target then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_context_text := current_setting('vaeroex.google_qualification_guard_context', true);
  begin
    v_context := v_context_text::jsonb;
    select environment.* into v_environment
    from public.document_extraction_google_qualification_environment environment
    where environment.id = (v_context ->> 'environment_id')::uuid;
    select run.* into v_run
    from public.document_extraction_google_qualification_runs run
    where run.id = (v_context ->> 'run_id')::uuid;
    select item.* into v_item
    from public.document_extraction_google_qualification_items item
    where item.id = (v_context ->> 'item_id')::uuid;
    select source.* into v_source
    from public.document_extraction_google_qualification_sources source
    where source.id = (v_context ->> 'source_binding_id')::uuid;
    if nullif(v_context ->> 'reservation_id', '') is not null then
      select reservation.* into v_reservation
      from public.document_extraction_google_qualification_page_reservations reservation
      where reservation.id = (v_context ->> 'reservation_id')::uuid;
    end if;
  exception when others then
    raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
      using errcode = '42501';
  end;

  v_expected_guard := encode(extensions.digest(convert_to(
    v_environment.execution_guard_secret || ':' || v_context::text
      || ':' || txid_current()::text,
    'UTF8'
  ), 'sha256'), 'hex');
  v_operation := v_context ->> 'operation';
  v_context_job_id := nullif(v_context ->> 'job_id', '')::uuid;

  if v_environment.id is null or v_run.id is null
    or v_item.id is null or v_source.id is null
    or current_setting('vaeroex.google_qualification_guard', true)
      is distinct from v_expected_guard
    or v_operation not in (
      'enqueue', 'claim', 'heartbeat', 'lease', 'advance', 'file_access',
      'dispatch', 'provider_boundary', 'provider_outcome', 'complete', 'fail',
      'cleanup'
    )
    or (v_context ->> 'workspace_id')::uuid <> v_run.workspace_id
    or (v_context ->> 'intake_request_id')::uuid <> v_item.intake_request_id
    or (v_context ->> 'file_id')::uuid <> v_item.file_id
    or (v_context ->> 'fixture_index')::integer <> v_item.fixture_index
    or v_environment.id <> v_run.environment_id
    or v_environment.synthetic_workspace_id <> v_run.workspace_id
    or v_source.environment_id <> v_environment.id
    or v_source.workspace_id <> v_run.workspace_id
    or v_source.intake_request_id <> v_item.intake_request_id
    or v_source.file_id <> v_item.file_id
    or v_source.fixture_index <> v_item.fixture_index
    or v_item.run_id <> v_run.id
    or v_item.source_binding_id <> v_source.id
    or (v_workspace_id is not null and v_workspace_id <> v_run.workspace_id)
    or (v_intake_id is not null and v_intake_id <> v_item.intake_request_id)
    or (v_file_id is not null and v_file_id <> v_item.file_id)
    or (
      tg_table_name in (
        'workspaces', 'workspace_members',
        'document_extraction_workspace_settings'
      )
      and v_operation <> 'enqueue'
    )
    or (
      v_operation = 'enqueue'
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index is not null
        or v_item.status <> 'planned'
        or v_item.job_id is not null
      )
    )
    or (
      v_operation = 'claim'
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status <> 'queued'
        or v_item.job_id is null
      )
    )
    or (
      v_operation not in ('enqueue', 'claim', 'cleanup', 'fail')
      and (
        v_run.status <> 'active'
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status <> 'processing'
        or v_item.job_id is null
      )
    )
    or (
      v_operation = 'fail'
      and (
        v_run.status not in ('active', 'stopped')
        or v_run.active_fixture_index <> v_item.fixture_index
        or v_item.status <> 'processing'
        or v_item.job_id is null
      )
    )
    or (
      v_operation = 'cleanup'
      and v_run.status not in ('active', 'stopped', 'completed', 'cleaning')
    )
    or (
      v_operation = 'dispatch'
      and (
        v_reservation.id is null
        or v_reservation.run_id <> v_run.id
        or v_reservation.item_id <> v_item.id
        or v_reservation.job_id <> v_item.job_id
        or v_reservation.fixture_index <> v_item.fixture_index
        or v_reservation.page_index <> (v_context ->> 'page_index')::integer
        or v_reservation.status <> 'reserved'
      )
    )
    or (
      v_operation <> 'dispatch'
      and nullif(v_context ->> 'reservation_id', '') is not null
    )
    or (
      v_processing_job_id is not null
      and not exists (
        select 1
        from public.document_extraction_google_qualification_processing_job_bindings binding
        where binding.file_processing_job_id = v_processing_job_id
          and binding.run_id = v_run.id
          and binding.item_id = v_item.id
          and binding.source_binding_id = v_source.id
          and binding.workspace_id = v_run.workspace_id
          and binding.file_id = v_item.file_id
          and binding.fixture_index = v_item.fixture_index
      )
    ) then
    raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
      using errcode = '42501';
  end if;

  if v_job_id is not null then
    if v_operation = 'enqueue' and v_context_job_id is null then
      if tg_table_name <> 'document_extraction_jobs' or tg_op <> 'INSERT'
        or v_intake_id <> v_item.intake_request_id
        or v_file_id <> v_item.file_id
        or v_workspace_id <> v_run.workspace_id then
        raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
          using errcode = '42501';
      end if;
      v_context := jsonb_set(v_context, '{job_id}', to_jsonb(v_job_id), false);
      v_context_job_id := v_job_id;
      v_expected_guard := encode(extensions.digest(convert_to(
        v_environment.execution_guard_secret || ':' || v_context::text
          || ':' || txid_current()::text,
        'UTF8'
      ), 'sha256'), 'hex');
      perform set_config(
        'vaeroex.google_qualification_guard_context', v_context::text, true
      );
      perform set_config('vaeroex.google_qualification_guard', v_expected_guard, true);
    elsif v_context_job_id is null or v_job_id <> v_context_job_id then
      raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
        using errcode = '42501';
    end if;
  end if;

  if v_operation <> 'enqueue'
    and (v_context_job_id is null or v_context_job_id <> v_item.job_id) then
    raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_google_frozen_qualification_processing_job_mutation
  on public.file_processing_jobs;
create trigger enforce_google_frozen_qualification_processing_job_mutation
  before update or delete on public.file_processing_jobs
  for each row execute function public.enforce_google_frozen_qualification_mutation_v1();

-- Keep the original preparation implementation as an owner-only primitive and
-- wrap it with a persistent run latch. A restarted one-shot worker sees the
-- existing active/stopped/completed run and cannot create another execution.
alter function public.prepare_google_frozen_qualification_v1(uuid, text, text, jsonb)
  rename to prepare_google_frozen_qualification_base_v1;

revoke execute on function
  public.prepare_google_frozen_qualification_base_v1(uuid, text, text, jsonb)
from public, anon, authenticated, service_role;

create function public.prepare_google_frozen_qualification_v1(
  p_request_id uuid,
  p_confirmation text,
  p_benchmark_profile_fingerprint text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_existing public.document_extraction_google_qualification_runs%rowtype;
begin
  if p_confirmation <> 'prepare-google-frozen-corpus-controller-v1'
    or p_request_id is null
    or p_benchmark_profile_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) <> 12 then
    raise exception 'Google qualification plan envelope is invalid.' using errcode = '22023';
  end if;
  select * into v_environment
  from public.document_extraction_google_qualification_environment
  where singleton_key = 'google_frozen_corpus_v1';
  if v_environment.id is null
    or v_environment.environment <> 'preview'
    or v_environment.supabase_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or v_environment.production_project_ref_exclusion <> 'mdiianhfrojmxqpwrflh' then
    raise exception 'Google qualification environment binding is unavailable.'
      using errcode = '42501';
  end if;
  select * into v_existing
  from public.document_extraction_google_qualification_runs
  where environment_id = v_environment.id
  order by created_at desc
  limit 1;
  if v_existing.id is not null then
    if v_existing.benchmark_profile_fingerprint <> p_benchmark_profile_fingerprint
      or v_existing.workspace_id <> v_environment.synthetic_workspace_id then
      raise exception 'Google qualification restart identity is invalid.'
        using errcode = '42501';
    end if;
    return jsonb_build_object(
      'run_id', v_existing.id,
      'status', v_existing.status,
      'idempotent', true,
      'restart_latched', true,
      'eligible_documents', v_existing.eligible_document_limit,
      'eligible_pages', v_existing.eligible_page_limit
    );
  end if;
  return public.prepare_google_frozen_qualification_base_v1(
    p_request_id, p_confirmation, p_benchmark_profile_fingerprint, p_items
  ) || jsonb_build_object('restart_latched', false);
end;
$$;

revoke execute on function
  public.prepare_google_frozen_qualification_v1(uuid, text, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.prepare_google_frozen_qualification_v1(uuid, text, text, jsonb)
to service_role;

create or replace function public.finalize_google_frozen_qualification_cleanup_v1(
  p_run_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_binding public.document_extraction_google_qualification_job_bindings%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_processing_binding
    public.document_extraction_google_qualification_processing_job_bindings%rowtype;
  v_run_hash text;
  v_job_count integer := 0;
  v_file_count integer := 0;
  v_processing_job_count integer := 0;
  v_storage_count integer := 0;
begin
  if p_confirmation <> 'finalize-google-frozen-corpus-cleanup-v2' then
    raise exception 'Google qualification cleanup finalization is invalid.' using errcode = '42501';
  end if;
  v_run_hash := encode(extensions.digest(convert_to(p_run_id::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_run from public.document_extraction_google_qualification_runs
  where id = p_run_id for update;
  if v_run.id is null then
    if exists (
      select 1 from public.document_extraction_google_qualification_cleanup_audits
      where run_id_hash = v_run_hash
    ) then
      return jsonb_build_object('cleaned', true, 'idempotent', true);
    end if;
    raise exception 'Google qualification cleanup run was not found.' using errcode = 'P0002';
  end if;
  select * into v_environment
  from public.document_extraction_google_qualification_environment
  where id = v_run.environment_id for update;
  if v_run.status <> 'cleaning' or v_environment.id is null
    or v_environment.synthetic_workspace_id <> v_run.workspace_id
    or exists (
      select 1 from public.document_extraction_google_qualification_state
      where singleton_key = 'google_frozen_corpus_v1' and enabled
    )
    or exists (
      select 1 from public.document_extraction_google_qualification_sources
      where environment_id = v_environment.id
        and storage_cleanup_verified_at is null
    )
    or exists (
      select 1 from public.document_extraction_google_qualification_page_reservations
      where run_id = p_run_id and status = 'reserved'
    )
    or (
      select count(*)
      from public.document_extraction_google_qualification_processing_job_bindings
      where run_id = p_run_id
    ) <> (
      select count(*)
      from public.document_extraction_google_qualification_items
      where run_id = p_run_id and provider_eligible
    ) then
    raise exception 'Google qualification cleanup proof is incomplete.' using errcode = '42501';
  end if;

  select count(*) into v_storage_count
  from public.document_extraction_google_qualification_sources
  where environment_id = v_environment.id;

  for v_binding in
    select * from public.document_extraction_google_qualification_job_bindings
    where run_id = p_run_id order by fixture_index
  loop
    perform public.begin_google_frozen_qualification_mutation_v1(
      v_binding.intake_request_id, 'cleanup'
    );
    delete from public.document_extraction_file_access_grants where job_id = v_binding.job_id;
    delete from public.document_extraction_provider_outcomes where job_id = v_binding.job_id;
    delete from public.document_extraction_reviews where job_id = v_binding.job_id;
    delete from public.document_extraction_file_bindings where job_id = v_binding.job_id;
    delete from public.document_extraction_cache where source_job_id = v_binding.job_id;
    delete from public.document_extraction_events where job_id = v_binding.job_id;
    delete from public.document_extraction_google_qualification_page_reservations
      where job_id = v_binding.job_id;
    delete from public.document_extraction_google_qualification_job_bindings
      where id = v_binding.id;
    update public.document_extraction_google_qualification_items
    set job_id = null, status = 'failed', updated_at = now()
    where id = v_binding.item_id;
    delete from public.document_extraction_jobs where id = v_binding.job_id;
    v_job_count := v_job_count + 1;
  end loop;

  for v_processing_binding in
    select *
    from public.document_extraction_google_qualification_processing_job_bindings
    where run_id = p_run_id
    order by fixture_index
  loop
    perform public.begin_google_frozen_qualification_mutation_v1(
      (
        select source.intake_request_id
        from public.document_extraction_google_qualification_sources source
        where source.id = v_processing_binding.source_binding_id
      ),
      'cleanup'
    );
    delete from public.file_processing_jobs processing_job
    where processing_job.id = v_processing_binding.file_processing_job_id
      and processing_job.workspace_id = v_processing_binding.workspace_id
      and processing_job.file_upload_id = v_processing_binding.file_id;
    if not found then
      raise exception 'Qualification-owned upload-processing cleanup was incomplete.'
        using errcode = '42501';
    end if;
    delete from public.document_extraction_google_qualification_processing_job_bindings
    where id = v_processing_binding.id;
    v_processing_job_count := v_processing_job_count + 1;
  end loop;

  delete from public.document_extraction_google_qualification_runs where id = p_run_id;
  for v_source in
    select * from public.document_extraction_google_qualification_sources
    where environment_id = v_environment.id
    order by fixture_index
  loop
    delete from public.document_extraction_google_qualification_sources
      where id = v_source.id;
    delete from public.document_extraction_intake_requests
      where id = v_source.intake_request_id;
    perform public.assert_google_frozen_qualification_no_fk_references_v1(
      'public.file_uploads'::regclass, v_source.file_id
    );
    delete from public.file_uploads where id = v_source.file_id
      and workspace_id = v_environment.synthetic_workspace_id;
    if not found then
      raise exception 'Qualification-owned file cleanup was incomplete.' using errcode = '42501';
    end if;
    v_file_count := v_file_count + 1;
  end loop;
  delete from public.document_extraction_google_qualification_environment
    where id = v_environment.id;

  delete from public.document_extraction_workspace_settings
    where workspace_id = v_environment.synthetic_workspace_id;
  delete from public.workspace_members
    where workspace_id = v_environment.synthetic_workspace_id;
  perform public.assert_google_frozen_qualification_no_fk_references_v1(
    'public.workspaces'::regclass, v_environment.synthetic_workspace_id
  );
  delete from public.workspaces where id = v_environment.synthetic_workspace_id;
  if not found then
    raise exception 'Qualification-owned workspace cleanup was incomplete.' using errcode = '42501';
  end if;

  insert into public.document_extraction_google_qualification_cleanup_audits (
    run_id_hash, cleanup_version, deleted_job_count,
    deleted_file_count, deleted_file_processing_job_count, storage_object_count
  ) values (
    v_run_hash, 'google_frozen_corpus_cleanup_v2',
    v_job_count, v_file_count, v_processing_job_count, v_storage_count
  );
  return jsonb_build_object(
    'cleaned', true, 'idempotent', false,
    'deleted_jobs', v_job_count,
    'deleted_files', v_file_count,
    'deleted_file_processing_jobs', v_processing_job_count,
    'storage_objects', v_storage_count
  );
end;
$$;

revoke execute on function public.bind_google_frozen_qualification_processing_job_v1()
from public, anon, authenticated, service_role;
revoke execute on function public.enforce_google_frozen_qualification_mutation_v1()
from public, anon, authenticated, service_role;
revoke execute on function public.begin_google_frozen_qualification_mutation_v1(uuid, text)
from public, anon, authenticated, service_role;

comment on table public.document_extraction_google_qualification_processing_job_bindings is
  'Exact qualification ownership for upload-created processing rows. It grants no document authority.';
