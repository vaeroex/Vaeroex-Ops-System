-- Capture the intact qualification ownership graph into the existing
-- transaction-signed guard before removing the restrictive processing binding.
create or replace function public.begin_google_frozen_qualification_processing_cleanup_v1(
  p_processing_binding_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processing_binding
    public.document_extraction_google_qualification_processing_job_bindings%rowtype;
  v_job_binding public.document_extraction_google_qualification_job_bindings%rowtype;
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_processing_job public.file_processing_jobs%rowtype;
  v_context jsonb;
  v_guard text;
begin
  if p_processing_binding_id is null then
    raise exception 'Google qualification processing cleanup proof is invalid.'
      using errcode = '42501';
  end if;

  select binding.* into v_processing_binding
  from public.document_extraction_google_qualification_processing_job_bindings binding
  where binding.id = p_processing_binding_id
  for update;
  select item.* into v_item
  from public.document_extraction_google_qualification_items item
  where item.id = v_processing_binding.item_id
  for update;
  select source.* into v_source
  from public.document_extraction_google_qualification_sources source
  where source.id = v_processing_binding.source_binding_id;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  where run.id = v_processing_binding.run_id
  for update;
  select environment.* into v_environment
  from public.document_extraction_google_qualification_environment environment
  where environment.id = v_run.environment_id
  for update;
  select job.* into v_job
  from public.document_extraction_jobs job
  where job.id = v_item.job_id
  for update;
  select binding.* into v_job_binding
  from public.document_extraction_google_qualification_job_bindings binding
  where binding.run_id = v_run.id
    and binding.item_id = v_item.id
    and binding.source_binding_id = v_source.id
    and binding.job_id = v_job.id
  for update;
  select processing_job.* into v_processing_job
  from public.file_processing_jobs processing_job
  where processing_job.id = v_processing_binding.file_processing_job_id
  for update;

  if v_processing_binding.id is null
    or v_item.id is null or v_source.id is null or v_run.id is null
    or v_environment.id is null or v_job.id is null
    or v_job_binding.id is null or v_processing_job.id is null
    or v_run.status <> 'cleaning'
    or not v_item.provider_eligible
    or v_item.job_id is null
    or v_item.run_id <> v_run.id
    or v_item.source_binding_id <> v_source.id
    or v_item.intake_request_id <> v_source.intake_request_id
    or v_item.file_id <> v_source.file_id
    or v_item.fixture_index <> v_source.fixture_index
    or v_item.page_identity_fingerprints is null
    or cardinality(v_item.page_identity_fingerprints) <> v_item.page_count
    or v_source.environment_id <> v_environment.id
    or v_source.workspace_id <> v_run.workspace_id
    or v_source.workspace_id <> v_environment.synthetic_workspace_id
    or v_source.file_id <> v_processing_binding.file_id
    or v_source.fixture_index <> v_processing_binding.fixture_index
    or v_run.environment_id <> v_environment.id
    or v_run.workspace_id <> v_environment.synthetic_workspace_id
    or v_environment.environment <> 'preview'
    or v_environment.supabase_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or v_environment.production_project_ref_exclusion <> 'mdiianhfrojmxqpwrflh'
    or v_processing_binding.run_id <> v_run.id
    or v_processing_binding.item_id <> v_item.id
    or v_processing_binding.source_binding_id <> v_source.id
    or v_processing_binding.workspace_id <> v_run.workspace_id
    or v_processing_binding.file_id <> v_item.file_id
    or v_processing_binding.fixture_index <> v_item.fixture_index
    or v_job_binding.intake_request_id <> v_item.intake_request_id
    or v_job_binding.file_id <> v_item.file_id
    or v_job_binding.workspace_id <> v_run.workspace_id
    or v_job_binding.fixture_index <> v_item.fixture_index
    or v_processing_job.workspace_id <> v_run.workspace_id
    or v_processing_job.file_upload_id <> v_item.file_id
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or not exists (
      select 1
      from public.document_extraction_google_qualification_state state
      where state.singleton_key = 'google_frozen_corpus_v1'
        and not state.enabled
    ) then
    raise exception 'Google qualification processing cleanup proof is invalid.'
      using errcode = '42501';
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
    'page_identity_fingerprints', to_jsonb(v_item.page_identity_fingerprints),
    'reservation_id', null,
    'page_index', null,
    'processing_binding_id', v_processing_binding.id,
    'file_processing_job_id', v_processing_binding.file_processing_job_id,
    'cleanup_proof_version', 'google_qualification_processing_cleanup_proof_v1',
    'operation', 'cleanup'
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
  v_context_processing_binding_id uuid;
  v_context_processing_job_id uuid;
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
  v_context_processing_binding_id :=
    nullif(v_context ->> 'processing_binding_id', '')::uuid;
  v_context_processing_job_id :=
    nullif(v_context ->> 'file_processing_job_id', '')::uuid;

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
      (
        v_context_processing_binding_id is not null
        or v_context_processing_job_id is not null
        or v_context ->> 'cleanup_proof_version' is not null
      )
      and not coalesce((
        tg_table_name = 'file_processing_jobs'
        and tg_op = 'DELETE'
        and v_processing_job_id is not null
        and v_operation = 'cleanup'
        and v_context ->> 'cleanup_proof_version'
          = 'google_qualification_processing_cleanup_proof_v1'
        and v_context_processing_binding_id is not null
        and v_context_processing_job_id = v_processing_job_id
        and (v_context -> 'page_identity_fingerprints')
          = to_jsonb(v_item.page_identity_fingerprints)
      ), false)
    )
    or (
      v_processing_job_id is not null
      and not (
        exists (
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
        or coalesce((
          tg_table_name = 'file_processing_jobs'
          and tg_op = 'DELETE'
          and v_operation = 'cleanup'
          and v_context ->> 'cleanup_proof_version'
            = 'google_qualification_processing_cleanup_proof_v1'
          and v_context_processing_binding_id is not null
          and v_context_processing_job_id = v_processing_job_id
          and (v_context -> 'page_identity_fingerprints')
            = to_jsonb(v_item.page_identity_fingerprints)
        ), false)
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

  for v_processing_binding in
    select *
    from public.document_extraction_google_qualification_processing_job_bindings
    where run_id = p_run_id
    order by fixture_index
  loop
    perform public.begin_google_frozen_qualification_processing_cleanup_v1(
      v_processing_binding.id
    );
    delete from public.document_extraction_google_qualification_processing_job_bindings binding
    where binding.id = v_processing_binding.id
      and binding.run_id = v_processing_binding.run_id
      and binding.item_id = v_processing_binding.item_id
      and binding.source_binding_id = v_processing_binding.source_binding_id
      and binding.file_processing_job_id = v_processing_binding.file_processing_job_id
      and binding.workspace_id = v_processing_binding.workspace_id
      and binding.file_id = v_processing_binding.file_id
      and binding.fixture_index = v_processing_binding.fixture_index;
    if not found then
      raise exception 'Qualification-owned upload-processing binding cleanup was incomplete.'
        using errcode = '42501';
    end if;
    delete from public.file_processing_jobs processing_job
    where processing_job.id = v_processing_binding.file_processing_job_id
      and processing_job.workspace_id = v_processing_binding.workspace_id
      and processing_job.file_upload_id = v_processing_binding.file_id;
    if not found then
      raise exception 'Qualification-owned upload-processing cleanup was incomplete.'
        using errcode = '42501';
    end if;
    if exists (
      select 1
      from public.document_extraction_google_qualification_processing_job_bindings binding
      where binding.id = v_processing_binding.id
        or binding.file_processing_job_id = v_processing_binding.file_processing_job_id
    ) or exists (
      select 1 from public.file_processing_jobs processing_job
      where processing_job.id = v_processing_binding.file_processing_job_id
    ) then
      raise exception 'Qualification-owned upload-processing cleanup was incomplete.'
        using errcode = '42501';
    end if;
    v_processing_job_count := v_processing_job_count + 1;
  end loop;

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

revoke execute on function
  public.begin_google_frozen_qualification_processing_cleanup_v1(uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.enforce_google_frozen_qualification_mutation_v1()
from public, anon, authenticated, service_role;
revoke execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
from public, anon, authenticated;
grant execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
to service_role;

comment on function public.begin_google_frozen_qualification_processing_cleanup_v1(uuid) is
  'Owner-only transaction-signed proof of exact qualification processing-row ownership. Grants no document authority.';
