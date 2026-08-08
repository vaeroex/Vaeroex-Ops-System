-- Preserve the exact qualification job identity until the upload-processing
-- row that depends on it has passed the existing cleanup mutation guard.
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

revoke execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
from public, anon, authenticated;
grant execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
to service_role;
