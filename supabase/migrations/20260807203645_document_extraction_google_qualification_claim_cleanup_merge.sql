-- Restore the complete claim-aware qualification mutation guard while retaining
-- the transaction-signed processing cleanup proof. Ledger 31 accidentally
-- replaced the ledger-29 claim-phase definition with an older queued-only body.
-- This forward fix changes no data, grants no execution capability, and enables
-- no provider path.

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
  v_claim_job public.document_extraction_jobs%rowtype;
  v_claim_binding public.document_extraction_google_qualification_job_bindings%rowtype;
  v_expected_guard text;
  v_operation text;
  v_context_job_id uuid;
  v_context_processing_binding_id uuid;
  v_context_processing_job_id uuid;
  v_claim_worker_id text;
  v_claim_lease_seconds integer;
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

  if v_operation = 'claim' then
    v_claim_worker_id := v_context ->> 'claim_worker_id';
    begin
      v_claim_lease_seconds := (v_context ->> 'claim_lease_seconds')::integer;
    exception when others then
      raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
        using errcode = '42501';
    end;
    if v_claim_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
      or v_claim_lease_seconds not between 30 and 300
      or v_run.status <> 'active'
      or v_run.active_fixture_index <> v_item.fixture_index
      or v_item.job_id is null
      or v_context_job_id is distinct from v_item.job_id then
      raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
        using errcode = '42501';
    end if;

    select binding.* into v_claim_binding
    from public.document_extraction_google_qualification_job_bindings binding
    where binding.job_id = v_item.job_id;

    if tg_table_name = 'document_extraction_jobs' and tg_op = 'UPDATE' then
      v_claim_job := new;
      if v_item.status <> 'queued'
        or old.id <> v_item.job_id
        or old.intake_request_id <> v_item.intake_request_id
        or old.file_id <> v_item.file_id
        or old.workspace_id <> v_run.workspace_id
        or old.status <> 'queued'
        or old.stage <> 'queued'
        or old.attempts <> 0
        or old.max_attempts <> 1
        or old.retry_count <> 0
        or old.lease_owner is not null
        or old.lease_expires_at is not null
        or old.provider_dispatched_at is not null
        or new.id <> old.id
        or new.intake_request_id <> old.intake_request_id
        or new.file_id <> old.file_id
        or new.workspace_id <> old.workspace_id
        or new.status <> 'processing'
        or new.stage <> 'leased'
        or new.attempts <> 1
        or new.max_attempts <> 1
        or new.retry_count <> 0
        or new.lease_owner <> v_claim_worker_id
        or new.lease_expires_at is distinct from
          now() + make_interval(secs => v_claim_lease_seconds)
        or new.heartbeat_at is distinct from now()
        or new.started_at is distinct from coalesce(old.started_at, now())
        or new.last_stage_transition_at is distinct from now()
        or new.broker_protocol_version <> 'document_extraction_broker_v2'
        or new.worker_runtime_version <> 'document_extraction_worker_v2'
        or new.provider_dispatched_at is not null
        or not public.document_extraction_google_job_identity_is_exact_v1(v_claim_job)
        or v_claim_binding.id is null
        or v_claim_binding.run_id <> v_run.id
        or v_claim_binding.item_id <> v_item.id
        or v_claim_binding.source_binding_id <> v_source.id
        or v_claim_binding.intake_request_id <> v_item.intake_request_id
        or v_claim_binding.file_id <> v_item.file_id
        or v_claim_binding.workspace_id <> v_run.workspace_id
        or v_claim_binding.fixture_identity_fingerprint <>
          v_item.fixture_identity_fingerprint
        or v_claim_binding.source_sha256 <> v_item.source_sha256
        or v_claim_binding.page_identity_fingerprints <>
          v_item.page_identity_fingerprints
        or v_claim_binding.corpus_sha256 <> v_run.corpus_sha256
        or v_claim_binding.provider_profile <> v_run.provider_profile
        or v_claim_binding.processor_resource <> v_run.processor_resource
        or v_claim_binding.preview_project_ref <> v_environment.supabase_project_ref
        or v_claim_binding.controller_version <> v_run.controller_version then
        raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
          using errcode = '42501';
      end if;
    elsif tg_table_name = 'document_extraction_events' and tg_op = 'INSERT' then
      select job.* into v_claim_job
      from public.document_extraction_jobs job
      where job.id = v_item.job_id;
      perform public.assert_google_frozen_qualification_job_v1(
        v_item.job_id, v_claim_worker_id, 'heartbeat'
      );
      if v_item.status <> 'processing'
        or v_claim_job.id is null
        or v_claim_job.status <> 'processing'
        or v_claim_job.stage <> 'leased'
        or v_claim_job.attempts <> 1
        or v_claim_job.max_attempts <> 1
        or v_claim_job.retry_count <> 0
        or v_claim_job.lease_owner <> v_claim_worker_id
        or v_claim_job.lease_expires_at is distinct from
          now() + make_interval(secs => v_claim_lease_seconds)
        or v_claim_job.heartbeat_at is distinct from now()
        or v_claim_job.provider_dispatched_at is not null
        or new.workspace_id <> v_run.workspace_id
        or new.job_id <> v_item.job_id
        or new.event_type <> 'google_qualification_job_claimed'
        or new.actor_type <> 'worker'
        or new.actor_id is not null
        or new.stage <> 'leased'
        or new.status <> 'processing'
        or new.reason_code is not null
        or new.artifact_fingerprint is not null
        or new.metadata_json is distinct from jsonb_build_object(
          'provider_profile', v_claim_job.provider_profile
        )
        or new.request_id is null
        or exists (
          select 1 from public.document_extraction_events event
          where event.job_id = v_item.job_id
            and event.event_type = 'google_qualification_job_claimed'
        ) then
        raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
          using errcode = '42501';
      end if;
    else
      raise exception 'Qualification-bound extraction state rejects ordinary mutation.'
        using errcode = '42501';
    end if;
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

alter function public.enforce_google_frozen_qualification_mutation_v1()
  owner to postgres;
revoke execute on function public.enforce_google_frozen_qualification_mutation_v1()
  from public, anon, authenticated, service_role;
