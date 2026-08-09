-- Permit cleanup of an exact qualification-owned upload-processing row only
-- when its eligible item was planned but never enqueued. The signed proof is
-- separate from the existing job-bound cleanup proof and grants no execution
-- or document authority.

create or replace function public.authorize_google_frozen_qualification_planned_cleanup_v1(
  p_file_processing_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_processing_binding
    public.document_extraction_google_qualification_processing_job_bindings%rowtype;
  v_processing_job public.file_processing_jobs%rowtype;
  v_expected_guard text;
begin
  begin
    v_context := nullif(
      current_setting('vaeroex.google_qualification_guard_context', true), ''
    )::jsonb;
  exception when others then
    raise exception 'Google qualification planned cleanup proof is invalid.'
      using errcode = '42501';
  end;

  select environment.* into v_environment
  from public.document_extraction_google_qualification_environment environment
  where environment.id = nullif(v_context ->> 'environment_id', '')::uuid
  for update;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  where run.id = nullif(v_context ->> 'run_id', '')::uuid
  for update;
  select item.* into v_item
  from public.document_extraction_google_qualification_items item
  where item.id = nullif(v_context ->> 'item_id', '')::uuid
  for update;
  select source.* into v_source
  from public.document_extraction_google_qualification_sources source
  where source.id = nullif(v_context ->> 'source_binding_id', '')::uuid
  for update;
  select binding.* into v_processing_binding
  from public.document_extraction_google_qualification_processing_job_bindings binding
  where binding.id = nullif(v_context ->> 'processing_binding_id', '')::uuid
  for update;
  select processing_job.* into v_processing_job
  from public.file_processing_jobs processing_job
  where processing_job.id = p_file_processing_job_id
  for update;

  v_expected_guard := encode(extensions.digest(convert_to(
    v_environment.execution_guard_secret || ':' || v_context::text
      || ':' || txid_current()::text,
    'UTF8'
  ), 'sha256'), 'hex');

  if p_file_processing_job_id is null
    or v_environment.id is null or v_run.id is null
    or v_item.id is null or v_source.id is null
    or v_processing_binding.id is null or v_processing_job.id is null
    or current_setting('vaeroex.google_qualification_guard', true)
      is distinct from v_expected_guard
    or v_context ->> 'cleanup_proof_version'
      <> 'google_qualification_planned_never_enqueued_cleanup_proof_v1'
    or v_context ->> 'classification' <> 'planned_never_enqueued'
    or v_context ->> 'operation' <> 'cleanup'
    or nullif(v_context ->> 'job_id', '') is not null
    or nullif(v_context ->> 'reservation_id', '') is not null
    or nullif(v_context ->> 'page_index', '') is not null
    or (v_context ->> 'workspace_id')::uuid <> v_run.workspace_id
    or (v_context ->> 'intake_request_id')::uuid <> v_item.intake_request_id
    or (v_context ->> 'file_id')::uuid <> v_item.file_id
    or (v_context ->> 'fixture_index')::integer <> v_item.fixture_index
    or (v_context ->> 'file_processing_job_id')::uuid <> v_processing_job.id
    or (v_context -> 'page_identity_fingerprints')
      <> to_jsonb(v_item.page_identity_fingerprints)
    or v_environment.environment <> 'preview'
    or v_environment.supabase_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or v_environment.production_project_ref_exclusion <> 'mdiianhfrojmxqpwrflh'
    or v_environment.synthetic_workspace_id <> v_run.workspace_id
    or v_environment.id <> v_run.environment_id
    or v_environment.provider_profile <> v_run.provider_profile
    or v_environment.processor_id <> v_run.processor_id
    or v_environment.processor_resource <> v_run.processor_resource
    or v_environment.processor_version <> v_run.processor_version
    or v_environment.controller_version <> v_run.controller_version
    or v_run.status <> 'cleaning'
    or v_run.active_fixture_index is not null
    or v_run.workspace_id <> v_source.workspace_id
    or v_run.retry_count <> 0
    or v_item.run_id <> v_run.id
    or not v_item.provider_eligible
    or v_item.status <> 'planned'
    or v_item.job_id is not null
    or v_item.provider_reservation_count <> 0
    or v_item.provider_call_count <> 0
    or v_item.source_binding_id <> v_source.id
    or v_item.intake_request_id <> v_source.intake_request_id
    or v_item.file_id <> v_source.file_id
    or v_item.fixture_index <> v_source.fixture_index
    or v_item.fixture_identity_fingerprint <> v_source.fixture_identity_fingerprint
    or v_item.source_sha256 <> v_source.source_sha256
    or v_item.page_identity_fingerprints <> v_source.page_identity_fingerprints
    or v_item.page_count <> v_source.page_count
    or v_item.assessment_fingerprint <> v_source.assessment_fingerprint
    or v_item.content_hmac <> v_source.content_hmac
    or v_item.cache_key <> v_source.cache_key
    or v_source.environment_id <> v_environment.id
    or v_source.workspace_id <> v_environment.synthetic_workspace_id
    or v_source.storage_cleanup_verified_at is null
    or v_processing_binding.run_id <> v_run.id
    or v_processing_binding.item_id <> v_item.id
    or v_processing_binding.source_binding_id <> v_source.id
    or v_processing_binding.workspace_id <> v_run.workspace_id
    or v_processing_binding.file_id <> v_item.file_id
    or v_processing_binding.fixture_index <> v_item.fixture_index
    or v_processing_binding.file_processing_job_id <> v_processing_job.id
    or v_processing_job.workspace_id <> v_run.workspace_id
    or v_processing_job.file_upload_id <> v_item.file_id
    or v_processing_job.job_type <> 'extract'
    or v_processing_job.status <> 'queued'
    or v_processing_job.attempts <> 0
    or v_processing_job.max_attempts <> 3
    or v_processing_job.started_at is not null
    or v_processing_job.completed_at is not null
    or v_processing_job.error_message is not null
    or v_processing_job.metadata_json ->> 'source' <> 'upload'
    or exists (
      select 1
      from public.document_extraction_google_qualification_job_bindings binding
      where binding.run_id = v_run.id
        or binding.item_id = v_item.id
        or binding.source_binding_id = v_source.id
        or binding.intake_request_id = v_item.intake_request_id
        or binding.file_id = v_item.file_id
    )
    or exists (
      select 1
      from public.document_extraction_jobs job
      where job.workspace_id = v_run.workspace_id
        and (
          job.intake_request_id = v_item.intake_request_id
          or job.file_id = v_item.file_id
        )
    )
    or exists (
      select 1
      from public.document_extraction_google_qualification_page_reservations reservation
      where reservation.run_id = v_run.id
        and (
          reservation.item_id = v_item.id
          or reservation.fixture_index = v_item.fixture_index
        )
    )
    or not exists (
      select 1
      from public.document_extraction_google_qualification_state state
      where state.singleton_key = 'google_frozen_corpus_v1'
        and not state.enabled
    ) then
    raise exception 'Google qualification planned cleanup proof is invalid.'
      using errcode = '42501';
  end if;

  return true;
end;
$$;

create or replace function public.begin_google_frozen_qualification_planned_cleanup_v1(
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
  v_environment public.document_extraction_google_qualification_environment%rowtype;
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_source public.document_extraction_google_qualification_sources%rowtype;
  v_context jsonb;
  v_guard text;
begin
  if p_processing_binding_id is null then
    raise exception 'Google qualification planned cleanup proof is invalid.'
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
  where source.id = v_processing_binding.source_binding_id
  for update;
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  where run.id = v_processing_binding.run_id
  for update;
  select environment.* into v_environment
  from public.document_extraction_google_qualification_environment environment
  where environment.id = v_run.environment_id
  for update;

  if v_processing_binding.id is null or v_item.id is null
    or v_source.id is null or v_run.id is null or v_environment.id is null then
    raise exception 'Google qualification planned cleanup proof is invalid.'
      using errcode = '42501';
  end if;

  v_context := jsonb_build_object(
    'environment_id', v_environment.id,
    'run_id', v_run.id,
    'workspace_id', v_run.workspace_id,
    'item_id', v_item.id,
    'source_binding_id', v_source.id,
    'job_id', null,
    'intake_request_id', v_item.intake_request_id,
    'file_id', v_item.file_id,
    'fixture_index', v_item.fixture_index,
    'page_identity_fingerprints', to_jsonb(v_item.page_identity_fingerprints),
    'reservation_id', null,
    'page_index', null,
    'processing_binding_id', v_processing_binding.id,
    'file_processing_job_id', v_processing_binding.file_processing_job_id,
    'cleanup_proof_version',
      'google_qualification_planned_never_enqueued_cleanup_proof_v1',
    'classification', 'planned_never_enqueued',
    'operation', 'cleanup'
  );
  v_guard := encode(extensions.digest(convert_to(
    v_environment.execution_guard_secret || ':' || v_context::text
      || ':' || txid_current()::text,
    'UTF8'
  ), 'sha256'), 'hex');
  perform set_config('vaeroex.google_qualification_guard_context', v_context::text, true);
  perform set_config('vaeroex.google_qualification_guard', v_guard, true);
  perform public.authorize_google_frozen_qualification_planned_cleanup_v1(
    v_processing_binding.file_processing_job_id
  );
  return true;
end;
$$;

-- Preserve the exact ledger-33 guard and inject only the separately signed
-- planned-never-enqueued DELETE path. The migration fails if the expected
-- canonical predecessor is not present, preventing silent function drift.
do $migration$
declare
  v_definition text;
  v_anchor text := E'begin\n  if tg_table_name = ''document_extraction_jobs'' then';
  v_replacement text := E'begin\n  if tg_table_name = ''file_processing_jobs'' and tg_op = ''DELETE'' then\n    begin\n      v_context := nullif(\n        current_setting(''vaeroex.google_qualification_guard_context'', true), ''''\n      )::jsonb;\n    exception when others then\n      v_context := null;\n    end;\n    if v_context ->> ''cleanup_proof_version''\n        = ''google_qualification_planned_never_enqueued_cleanup_proof_v1'' then\n      perform public.authorize_google_frozen_qualification_planned_cleanup_v1(old.id);\n      return old;\n    end if;\n  end if;\n\n  if tg_table_name = ''document_extraction_jobs'' then';
begin
  select pg_get_functiondef(
    'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
  ) into v_definition;
  if v_definition is null
    or position(v_anchor in v_definition) = 0
    or position(
      'google_qualification_planned_never_enqueued_cleanup_proof_v1'
      in v_definition
    ) > 0 then
    raise exception 'Canonical qualification mutation guard predecessor is invalid.';
  end if;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  if position(v_anchor in v_definition) > 0
    or position(
      'authorize_google_frozen_qualification_planned_cleanup_v1(old.id)'
      in v_definition
    ) = 0 then
    raise exception 'Qualification mutation guard forward replacement failed.';
  end if;
  execute v_definition;
end;
$migration$;

-- Preserve the existing cleanup graph and accounting. Select only between the
-- job-bound proof and the exact planned-never-enqueued proof before deleting
-- the processing row; every subsequent cleanup step remains unchanged.
do $migration$
declare
  v_definition text;
  v_anchor text := E'    perform public.begin_google_frozen_qualification_processing_cleanup_v1(\n      v_processing_binding.id\n    );';
  v_replacement text := E'    if exists (\n      select 1\n      from public.document_extraction_google_qualification_items item\n      where item.id = v_processing_binding.item_id\n        and item.run_id = v_processing_binding.run_id\n        and item.source_binding_id = v_processing_binding.source_binding_id\n        and item.status = ''planned''\n        and item.job_id is null\n        and item.provider_reservation_count = 0\n        and item.provider_call_count = 0\n    ) then\n      perform public.begin_google_frozen_qualification_planned_cleanup_v1(\n        v_processing_binding.id\n      );\n    else\n      perform public.begin_google_frozen_qualification_processing_cleanup_v1(\n        v_processing_binding.id\n      );\n    end if;';
begin
  select pg_get_functiondef(
    'public.finalize_google_frozen_qualification_cleanup_v1(uuid,text)'::regprocedure
  ) into v_definition;
  if v_definition is null
    or position(v_anchor in v_definition) = 0
    or position(
      'begin_google_frozen_qualification_planned_cleanup_v1'
      in v_definition
    ) > 0 then
    raise exception 'Canonical qualification cleanup predecessor is invalid.';
  end if;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  if position(v_anchor in v_definition) > 0
    or position(
      'begin_google_frozen_qualification_planned_cleanup_v1'
      in v_definition
    ) = 0 then
    raise exception 'Qualification cleanup forward replacement failed.';
  end if;
  execute v_definition;
end;
$migration$;

alter function public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)
  owner to postgres;
alter function public.begin_google_frozen_qualification_planned_cleanup_v1(uuid)
  owner to postgres;
alter function public.enforce_google_frozen_qualification_mutation_v1()
  owner to postgres;
alter function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
  owner to postgres;

revoke execute on function
  public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid)
from public, anon, authenticated, service_role;
revoke execute on function
  public.begin_google_frozen_qualification_planned_cleanup_v1(uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.enforce_google_frozen_qualification_mutation_v1()
from public, anon, authenticated, service_role;
revoke execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
from public, anon, authenticated;
grant execute on function public.finalize_google_frozen_qualification_cleanup_v1(uuid, text)
to service_role;

comment on function public.authorize_google_frozen_qualification_planned_cleanup_v1(uuid) is
  'Owner-only verification of exact planned-never-enqueued qualification processing cleanup. Grants no document authority.';
comment on function public.begin_google_frozen_qualification_planned_cleanup_v1(uuid) is
  'Owner-only transaction-signed planned-never-enqueued cleanup proof. Grants no document authority.';
