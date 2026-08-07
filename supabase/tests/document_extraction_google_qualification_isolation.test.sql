begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(
  position(
    'v_claim_worker_id text' in pg_get_functiondef(
      'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
    )
  ) > 0,
  'final migration chain retains claim-aware worker identity validation'
);
select ok(
  position(
    'v_item.status <> ''processing''' in pg_get_functiondef(
      'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
    )
  ) > 0
  and position(
    'google_qualification_job_claimed' in pg_get_functiondef(
      'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
    )
  ) > 0,
  'final migration chain retains the post-transition claimed-event phase'
);
select ok(
  position(
    'google_qualification_processing_cleanup_proof_v1' in pg_get_functiondef(
      'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
    )
  ) > 0
  and position(
    'v_context_processing_binding_id' in pg_get_functiondef(
      'public.enforce_google_frozen_qualification_mutation_v1()'::regprocedure
    )
  ) > 0,
  'final migration chain retains transaction-signed processing cleanup proof'
);

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$$;

-- PostgREST executes each RPC in its own transaction. This test intentionally
-- keeps all synthetic state in one rollback transaction, so it must explicitly
-- end the transaction-local mutation capability after each simulated RPC.
create or replace function pg_temp.finish_google_qualification_rpc()
returns void
language plpgsql
as $$
begin
  perform set_config('vaeroex.google_qualification_guard', '', true);
  perform set_config('vaeroex.google_qualification_guard_context', '', true);
end;
$$;

create or replace function pg_temp.premature_processing_cleanup_fails(
  p_item_id uuid,
  p_intake_request_id uuid,
  p_processing_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.document_extraction_google_qualification_items
    set job_id = null
    where id = p_item_id;
    perform public.begin_google_frozen_qualification_mutation_v1(
      p_intake_request_id,
      'cleanup'
    );
    delete from public.file_processing_jobs
    where id = p_processing_job_id;
    raise exception 'Premature processing cleanup unexpectedly succeeded.'
      using errcode = 'P0001';
  exception when others then
    return sqlstate = '42501';
  end;
end;
$$;

create or replace function pg_temp.processing_cleanup_proof_matches(
  p_processing_binding_id uuid,
  p_run_id uuid,
  p_item_id uuid,
  p_job_id uuid,
  p_processing_job_id uuid,
  p_file_id uuid,
  p_intake_request_id uuid,
  p_workspace_id uuid,
  p_fixture_index integer,
  p_page_identity_fingerprints text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  perform public.begin_google_frozen_qualification_processing_cleanup_v1(
    p_processing_binding_id
  );
  v_context := current_setting('vaeroex.google_qualification_guard_context', true)::jsonb;
  return exists (
    select 1
    from public.document_extraction_google_qualification_processing_job_bindings binding
    where binding.id = p_processing_binding_id
      and binding.run_id = p_run_id
      and binding.item_id = p_item_id
      and binding.file_processing_job_id = p_processing_job_id
  )
    and (v_context ->> 'run_id')::uuid = p_run_id
    and (v_context ->> 'item_id')::uuid = p_item_id
    and (v_context ->> 'job_id')::uuid = p_job_id
    and (v_context ->> 'file_processing_job_id')::uuid = p_processing_job_id
    and (v_context ->> 'file_id')::uuid = p_file_id
    and (v_context ->> 'intake_request_id')::uuid = p_intake_request_id
    and (v_context ->> 'workspace_id')::uuid = p_workspace_id
    and (v_context ->> 'fixture_index')::integer = p_fixture_index
    and v_context -> 'page_identity_fingerprints'
      = to_jsonb(p_page_identity_fingerprints)
    and v_context ->> 'cleanup_proof_version'
      = 'google_qualification_processing_cleanup_proof_v1';
end;
$$;

create or replace function pg_temp.processing_cleanup_proof_capture_fails(
  p_processing_binding_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.begin_google_frozen_qualification_processing_cleanup_v1(
      p_processing_binding_id
    );
    raise exception 'Invalid processing cleanup proof unexpectedly succeeded.'
      using errcode = 'P0001';
  exception when others then
    return sqlstate = '42501';
  end;
end;
$$;

create or replace function pg_temp.processing_cleanup_without_proof_fails(
  p_processing_binding_id uuid,
  p_intake_request_id uuid,
  p_processing_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.begin_google_frozen_qualification_mutation_v1(
      p_intake_request_id,
      'cleanup'
    );
    delete from public.document_extraction_google_qualification_processing_job_bindings
    where id = p_processing_binding_id;
    delete from public.file_processing_jobs
    where id = p_processing_job_id;
    raise exception 'Proofless processing cleanup unexpectedly succeeded.'
      using errcode = 'P0001';
  exception when others then
    return sqlstate = '42501';
  end;
end;
$$;

create or replace function pg_temp.processing_cleanup_proof_substitution_fails(
  p_processing_binding_id uuid,
  p_processing_job_id uuid,
  p_field text,
  p_value jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  if p_field not in (
    'run_id', 'item_id', 'job_id', 'file_processing_job_id', 'file_id',
    'intake_request_id', 'workspace_id', 'fixture_index',
    'page_identity_fingerprints'
  ) then
    return false;
  end if;
  begin
    perform public.begin_google_frozen_qualification_processing_cleanup_v1(
      p_processing_binding_id
    );
    v_context := current_setting('vaeroex.google_qualification_guard_context', true)::jsonb;
    v_context := jsonb_set(v_context, array[p_field], p_value, false);
    perform set_config(
      'vaeroex.google_qualification_guard_context',
      v_context::text,
      true
    );
    delete from public.document_extraction_google_qualification_processing_job_bindings
    where id = p_processing_binding_id;
    delete from public.file_processing_jobs
    where id = p_processing_job_id;
    raise exception 'Substituted processing cleanup proof unexpectedly succeeded.'
      using errcode = 'P0001';
  exception when others then
    return sqlstate = '42501';
  end;
end;
$$;

-- Persistent qualification executions must never reuse an execution UUID.
-- Corpus, fixture, and page identities remain deterministic and separate.
create or replace function pg_temp.assert_google_qualification_run_id_unused(
  p_run_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_run_id is null or exists (
    select 1
    from public.document_extraction_google_qualification_cleanup_audits
    where run_id_hash = encode(
      extensions.digest(convert_to(p_run_id::text, 'UTF8'), 'sha256'),
      'hex'
    )
  ) then
    raise exception 'Qualification run identity was already used.'
      using errcode = '23505';
  end if;
end;
$$;

create or replace function pg_temp.new_google_qualification_run_id()
returns uuid
language plpgsql
as $$
declare
  v_run_id uuid;
begin
  for v_attempt in 1..16 loop
    v_run_id := gen_random_uuid();
    if not exists (
      select 1
      from public.document_extraction_google_qualification_cleanup_audits
      where run_id_hash = encode(
        extensions.digest(convert_to(v_run_id::text, 'UTF8'), 'sha256'),
        'hex'
      )
    ) then
      return v_run_id;
    end if;
  end loop;
  raise exception 'Unable to allocate a fresh qualification run identity.'
    using errcode = '55000';
end;
$$;

create temporary table google_qualification_test_execution_ids (
  run_id uuid primary key,
  replay_run_id uuid not null unique,
  third_run_id uuid not null unique,
  request_id uuid not null unique,
  check (run_id <> replay_run_id),
  check (run_id <> third_run_id),
  check (replay_run_id <> third_run_id)
) on commit drop;
grant select on pg_temp.google_qualification_test_execution_ids to service_role;

insert into pg_temp.google_qualification_test_execution_ids (
  run_id, replay_run_id, third_run_id, request_id
) values (
  pg_temp.new_google_qualification_run_id(),
  pg_temp.new_google_qualification_run_id(),
  pg_temp.new_google_qualification_run_id(),
  gen_random_uuid()
);

-- Content-free test-only classifier for the otherwise intentionally generic
-- 42501 assertion contract. It reports only bounded invariant classes.
create or replace function pg_temp.google_qualification_assertion_reason(
  p_job_id uuid,
  p_worker_id text,
  p_operation text
)
returns text
language plpgsql
stable
as $$
declare
  v_run public.document_extraction_google_qualification_runs%rowtype;
  v_item public.document_extraction_google_qualification_items%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_binding public.document_extraction_google_qualification_job_bindings%rowtype;
  v_environment public.document_extraction_google_qualification_environment%rowtype;
begin
  select run.* into v_run
  from public.document_extraction_google_qualification_runs run
  join public.document_extraction_google_qualification_items item
    on item.run_id = run.id and item.job_id = p_job_id
  where run.active_fixture_index = item.fixture_index;
  select * into v_item
  from public.document_extraction_google_qualification_items
  where run_id = v_run.id and job_id = p_job_id;
  if v_run.id is null or v_item.id is null then
    return 'qualification_run_mismatch';
  end if;

  select * into v_environment
  from public.document_extraction_google_qualification_environment
  where id = v_run.environment_id;
  if v_environment.id is null
    or v_environment.environment <> 'preview'
    or v_environment.supabase_project_ref <> 'zfpnhvcmuuvtswttmnjd'
    or v_environment.production_project_ref_exclusion <> 'mdiianhfrojmxqpwrflh'
    or v_run.status <> 'active'
    or (
      p_operation not in ('provider_outcome', 'fail')
      and not exists (
        select 1 from public.document_extraction_google_qualification_state
        where singleton_key = 'google_frozen_corpus_v1' and enabled
      )
    ) then
    return 'environment_binding_mismatch';
  end if;

  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  select * into v_binding
  from public.document_extraction_google_qualification_job_bindings
  where job_id = p_job_id;
  if v_job.id is null or v_binding.id is null then
    return 'job_identity_mismatch';
  end if;
  if v_run.workspace_id <> v_environment.synthetic_workspace_id
    or v_binding.workspace_id <> v_job.workspace_id then
    return 'workspace_binding_mismatch';
  end if;
  if v_binding.run_id <> v_run.id
    or v_binding.item_id <> v_item.id
    or v_binding.source_binding_id <> v_item.source_binding_id
    or v_binding.intake_request_id <> v_job.intake_request_id
    or v_binding.file_id <> v_job.file_id
    or v_binding.fixture_identity_fingerprint <> v_item.fixture_identity_fingerprint
    or v_binding.source_sha256 <> v_item.source_sha256
    or v_binding.page_identity_fingerprints <> v_item.page_identity_fingerprints
    or v_binding.corpus_sha256 <> v_run.corpus_sha256
    or v_binding.preview_project_ref <> v_environment.supabase_project_ref
    or v_binding.controller_version <> v_run.controller_version then
    return 'fixture_binding_mismatch';
  end if;
  if v_run.provider_profile <> v_job.provider_profile
    or v_run.processor_id <> v_job.processor_id
    or v_run.processor_resource <> v_job.processor_resource
    or v_environment.processor_id <> v_job.processor_id
    or v_environment.processor_resource <> v_job.processor_resource
    or v_environment.processor_version <> v_job.processor_version
    or v_binding.provider_profile <> v_run.provider_profile
    or v_binding.processor_resource <> v_run.processor_resource then
    return 'processor_identity_mismatch';
  end if;
  if not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    return 'job_identity_mismatch';
  end if;
  if not v_item.provider_eligible or v_item.status <> 'processing'
    or v_job.status <> 'processing' then
    return 'job_state_mismatch';
  end if;
  if v_job.lease_owner <> p_worker_id or v_job.lease_expires_at <= now() then
    return 'lease_state_mismatch';
  end if;
  return 'authorized';
end;
$$;

-- This graph is intentionally synthetic and transaction-scoped. The job is
-- inserted before the owner-only source binding so the test can exercise the
-- qualification class without bypassing its runtime mutation guard.
insert into public.profiles (id, email, full_name) values
  ('a2650000-0000-4000-8000-000000000001', 'pr265-qualification@example.test', 'PR 265 Qualification');
insert into public.workspaces (id, name, created_by) values
  ('b2650000-0000-4000-8000-000000000001', 'PR 265 synthetic qualification', 'a2650000-0000-4000-8000-000000000001'),
  ('b2650000-0000-4000-8000-000000000002', 'PR 265 unrelated control', 'a2650000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('b2650000-0000-4000-8000-000000000001', 'a2650000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('b2650000-0000-4000-8000-000000000002', 'a2650000-0000-4000-8000-000000000001', 'owner', 'active');
insert into public.file_uploads (
  id, workspace_id, original_name, display_name, file_extension, mime_type,
  file_size_bytes, storage_bucket, storage_path, metadata_json, created_by
) values (
  'c2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001',
  'fixture-01.pdf', 'Fixture 01', 'pdf', 'application/pdf', 1024,
  'workspace-files',
  'b2650000-0000-4000-8000-000000000001/fixture-01.pdf',
  '{}'::jsonb, 'a2650000-0000-4000-8000-000000000001'
), (
  'c2650000-0000-4000-8000-000000000002',
  'b2650000-0000-4000-8000-000000000002',
  'unrelated.pdf', 'Unrelated', 'pdf', 'application/pdf', 512,
  'workspace-files',
  'b2650000-0000-4000-8000-000000000002/unrelated.pdf',
  '{}'::jsonb, 'a2650000-0000-4000-8000-000000000001'
);
insert into public.file_processing_jobs (
  id, workspace_id, file_upload_id, job_type, status, attempts, max_attempts,
  metadata_json, created_by
) values (
  'c2650000-0000-4000-8000-000000000011',
  'b2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001',
  'extract', 'queued', 0, 3, '{"source":"upload"}'::jsonb,
  'a2650000-0000-4000-8000-000000000001'
), (
  'c2650000-0000-4000-8000-000000000012',
  'b2650000-0000-4000-8000-000000000002',
  'c2650000-0000-4000-8000-000000000002',
  'extract', 'queued', 0, 3, '{"source":"upload"}'::jsonb,
  'a2650000-0000-4000-8000-000000000001'
);
insert into public.document_extraction_workspace_settings (
  workspace_id, is_entitled, is_enabled, monthly_page_limit,
  current_period_start, current_period_end, allowed_document_classes,
  pages_reserved, pages_consumed
) values (
  'b2650000-0000-4000-8000-000000000001', true, true, 20,
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  array['digital_pdf']::text[], 1, 0
);
update public.document_extraction_system_state
set globally_enabled = true, worker_enabled = true, provider_calls_enabled = true,
    circuit_state = 'closed', circuit_opened_at = null, circuit_reason_code = null,
    consecutive_failures = 0, rolling_failure_count = 0,
    failure_window_started_at = null, failure_window_reset_at = now()
where singleton_key = 'document_intelligence';
insert into public.document_extraction_intake_requests (
  id, workspace_id, file_id, requested_by, request_id, status, source_kind,
  mime_type, file_extension, file_size_bytes, storage_bucket, storage_path
) values (
  'd2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001',
  'a2650000-0000-4000-8000-000000000001',
  'd2650000-0000-4000-8000-000000000011',
  'requested', 'pdf', 'application/pdf', 'pdf', 1024,
  'workspace-files',
  'b2650000-0000-4000-8000-000000000001/fixture-01.pdf'
);
insert into public.document_extraction_jobs (
  id, intake_request_id, workspace_id, file_id, requested_by, request_id,
  route, document_class, stage, status, parser_provider, parser_model,
  parser_revision, client_revision, content_hmac, cache_key,
  routing_policy_version, extraction_contract_version, normalization_version,
  assessment_fingerprint, page_count, pages_qualified, reserved_page_count,
  max_attempts, review_required, approval_status, provider_profile,
  processor_type, processor_id, processor_resource, processor_location,
  processor_version, endpoint_contract_version, request_serializer_version,
  response_validator_version, provider_normalization_version,
  compatibility_policy_version, table_policy_version,
  confidence_policy_version, selection_mark_policy_version,
  review_provenance_version
) values (
  'e2650000-0000-4000-8000-000000000001',
  'd2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001',
  'a2650000-0000-4000-8000-000000000001',
  'd2650000-0000-4000-8000-000000000011',
  'google_primary', 'digital_pdf', 'queued', 'queued',
  'google_document_ai', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_enterprise_ocr_v1', 'vaeroex_google_document_ai_rest_v1',
  repeat('1', 64), repeat('2', 64), 'document_extraction_routing_v1',
  'document_extraction_artifact_v2', 'document_extraction_normalization_v2',
  repeat('3', 64), 1, 1, 1, 1, true, 'pending',
  'google_document_ai_enterprise_ocr_v1', 'OCR_PROCESSOR',
  '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'us', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_processor_version_process_v1',
  'google_document_ai_process_request_v1',
  'google_document_ai_process_response_v2',
  'google_document_ai_layout_normalization_v2',
  'google_document_ai_enterprise_ocr_strict_v1',
  'tables_if_present_strict_v1', 'preserve_for_review_never_authority_v1',
  'disabled_v1', 'document_extraction_review_provenance_v2'
);

insert into public.document_extraction_google_qualification_environment (
  id, singleton_key, environment, supabase_project_ref,
  production_project_ref_exclusion, synthetic_workspace_id,
  processor_id, processor_resource, processor_location, processor_version,
  provider_profile, controller_version, execution_guard_secret
) values (
  'f2650000-0000-4000-8000-000000000001', 'google_frozen_corpus_v1',
  'preview', 'zfpnhvcmuuvtswttmnjd', 'mdiianhfrojmxqpwrflh',
  'b2650000-0000-4000-8000-000000000001', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'us', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_enterprise_ocr_v1',
  'google_frozen_corpus_qualification_controller_v2', repeat('4', 64)
);
select ok(
  public.set_google_frozen_qualification_enabled_v1(
    false,
    'zfpnhvcmuuvtswttmnjd',
    'disable-google-frozen-corpus-controller-v1'
  ),
  'the qualification controller disable path compiles and accepts the exact Preview binding'
);
select ok(
  public.set_google_frozen_qualification_enabled_v1(
    true,
    'zfpnhvcmuuvtswttmnjd',
    'enable-google-frozen-corpus-controller-v1'
  ),
  'the qualification controller enable path compiles and accepts the exact Preview binding'
);
insert into public.document_extraction_google_qualification_sources (
  id, environment_id, fixture_index, workspace_id, intake_request_id, file_id,
  source_sha256, fixture_identity_fingerprint, page_identity_fingerprints,
  page_count, document_class, assessment_fingerprint, content_hmac, cache_key,
  storage_bucket, storage_path, file_size_bytes, verification_version
) values (
  'f2650000-0000-4000-8000-000000000002',
  'f2650000-0000-4000-8000-000000000001', 1,
  'b2650000-0000-4000-8000-000000000001',
  'd2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001',
  'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec',
  '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1',
  array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[],
  1, 'digital_pdf', repeat('3', 64), repeat('1', 64), repeat('2', 64),
  'workspace-files',
  'b2650000-0000-4000-8000-000000000001/fixture-01.pdf', 1024,
  'trusted_storage_sha256_v1'
);
insert into public.document_extraction_google_qualification_runs (
  id, environment_id, workspace_id, request_id, workspace_binding_fingerprint,
  controller_version, benchmark_contract_version, benchmark_profile_fingerprint,
  fixture_source_commit, corpus_sha256, provider_profile, processor_id,
  processor_resource, processor_version, active_fixture_index
) values (
  (select run_id from pg_temp.google_qualification_test_execution_ids),
  'f2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001',
  (select request_id from pg_temp.google_qualification_test_execution_ids),
  repeat('5', 64),
  'google_frozen_corpus_qualification_controller_v2',
  'document_extraction_phase_c1_google_enterprise_ocr_v1', repeat('6', 64),
  'cc3c125b01ac41513b3b92213b6daa39fa5ba91f',
  'c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec',
  'google_document_ai_enterprise_ocr_v1', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'pretrained-ocr-v2.1-2024-08-07', 1
);
insert into public.document_extraction_google_qualification_items (
  id, run_id, fixture_index, fixture_identity_fingerprint, source_sha256,
  page_identity_fingerprints, page_count, provider_eligible, source_binding_id,
  intake_request_id, file_id, route, document_class, assessment_fingerprint,
  content_hmac, cache_key, job_id, status
) values (
  'f2650000-0000-4000-8000-000000000004',
  (select run_id from pg_temp.google_qualification_test_execution_ids), 1,
  '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1',
  'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec',
  array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[],
  1, true, 'f2650000-0000-4000-8000-000000000002',
  'd2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001', 'google_primary', 'digital_pdf',
  repeat('3', 64), repeat('1', 64), repeat('2', 64),
  'e2650000-0000-4000-8000-000000000001', 'queued'
);
insert into public.document_extraction_google_qualification_job_bindings (
  run_id, item_id, source_binding_id, job_id, intake_request_id, file_id,
  workspace_id, fixture_index, corpus_contract_version, corpus_sha256,
  fixture_identity_fingerprint, source_sha256, page_identity_fingerprints,
  page_count, provider_profile, processor_id, processor_resource,
  processor_version, preview_project_ref, controller_version
) values (
  (select run_id from pg_temp.google_qualification_test_execution_ids),
  'f2650000-0000-4000-8000-000000000004',
  'f2650000-0000-4000-8000-000000000002',
  'e2650000-0000-4000-8000-000000000001',
  'd2650000-0000-4000-8000-000000000001',
  'c2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001', 1,
  'document_extraction_phase_c1_google_enterprise_ocr_v1',
  'c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec',
  '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1',
  'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec',
  array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[],
  1, 'google_document_ai_enterprise_ocr_v1', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'pretrained-ocr-v2.1-2024-08-07', 'zfpnhvcmuuvtswttmnjd',
  'google_frozen_corpus_qualification_controller_v2'
);
update public.document_extraction_google_qualification_state
set enabled = true where singleton_key = 'google_frozen_corpus_v1';

set local role service_role;
select is(
  (select count(*)::integer from public.claim_google_document_extraction_job_v1('ordinary-worker', 120)),
  0,
  'ordinary Google claim cannot receive a qualification-bound job'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.enqueue_google_document_extraction_job_v1(
      'd2650000-0000-4000-8000-000000000001', 'google_primary', 'digital_pdf',
      repeat('3', 64), 1, 'google_document_ai', 'pretrained-ocr-v2.1-2024-08-07',
      'google_document_ai_enterprise_ocr_v1', 'vaeroex_google_document_ai_rest_v1',
      repeat('1', 64), repeat('2', 64), 'document_extraction_routing_v1',
      'document_extraction_artifact_v2', 'document_extraction_normalization_v2',
      'google_document_ai_enterprise_ocr_v1', 'OCR_PROCESSOR', '948f589143795629',
      'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
      'us', 'pretrained-ocr-v2.1-2024-08-07',
      'google_document_ai_processor_version_process_v1',
      'google_document_ai_process_request_v1', 'google_document_ai_process_response_v2',
      'google_document_ai_layout_normalization_v2',
      'google_document_ai_enterprise_ocr_strict_v1', 'tables_if_present_strict_v1',
      'preserve_for_review_never_authority_v1', 'disabled_v1',
      'document_extraction_review_provenance_v2')$$,
    '42501'
  ),
  'ordinary enqueue rejects a qualification-owned source even idempotently'
);
select is(
  (select count(*)::integer from public.claim_google_frozen_qualification_job_v1('qualification-worker', 120)),
  1,
  'the exact qualification claim receives the bound job once'
);
select pg_temp.finish_google_qualification_rpc();
reset role;
select is(
  pg_temp.google_qualification_assertion_reason(
    'e2650000-0000-4000-8000-000000000001',
    'qualification-worker',
    'advance'
  ),
  'authorized',
  'the legitimate first qualification advance satisfies every assertion predicate'
);
select is(
  pg_temp.google_qualification_assertion_reason(
    'e2650000-0000-4000-8000-000000000001',
    'wrong-worker',
    'advance'
  ),
  'lease_state_mismatch',
  'the content-free classifier identifies a wrong worker lease'
);
select is(
  pg_temp.google_qualification_assertion_reason(
    'e2650000-0000-4000-8000-000000000099',
    'qualification-worker',
    'advance'
  ),
  'qualification_run_mismatch',
  'an unrelated job cannot enter the qualification assertion'
);

update public.document_extraction_google_qualification_job_bindings
set workspace_id = 'b2650000-0000-4000-8000-000000000002'
where job_id = 'e2650000-0000-4000-8000-000000000001';
select is(
  pg_temp.google_qualification_assertion_reason(
    'e2650000-0000-4000-8000-000000000001',
    'qualification-worker',
    'advance'
  ),
  'workspace_binding_mismatch',
  'a substituted workspace binding fails closed'
);
update public.document_extraction_google_qualification_job_bindings
set workspace_id = 'b2650000-0000-4000-8000-000000000001'
where job_id = 'e2650000-0000-4000-8000-000000000001';

update public.document_extraction_google_qualification_job_bindings
set fixture_identity_fingerprint = repeat('0', 64)
where job_id = 'e2650000-0000-4000-8000-000000000001';
select is(
  pg_temp.google_qualification_assertion_reason(
    'e2650000-0000-4000-8000-000000000001',
    'qualification-worker',
    'advance'
  ),
  'fixture_binding_mismatch',
  'a substituted fixture binding fails closed'
);
update public.document_extraction_google_qualification_job_bindings
set fixture_identity_fingerprint =
  '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1'
where job_id = 'e2650000-0000-4000-8000-000000000001';

select ok(
  pg_temp.raises_sqlstate(
    $$update public.document_extraction_google_qualification_environment
      set supabase_project_ref = 'mdiianhfrojmxqpwrflh'
      where id = 'f2650000-0000-4000-8000-000000000001'$$,
    '23514'
  ),
  'the Preview environment constraint rejects Production substitution'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.document_extraction_google_qualification_job_bindings
      set processor_version = 'wrong-processor-version'
      where job_id = 'e2650000-0000-4000-8000-000000000001'$$,
    '23514'
  ),
  'the processor-version constraint rejects substitution'
);

select public.begin_google_frozen_qualification_mutation_v1(
  'd2650000-0000-4000-8000-000000000001',
  'advance'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.document_extraction_jobs
      set parser_model = 'synthetic-wrong-model'
      where id = 'e2650000-0000-4000-8000-000000000001'$$,
    '23514'
  ),
  'the canonical Google job constraint rejects model substitution'
);
select pg_temp.finish_google_qualification_rpc();

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.resolve_google_document_extraction_job_lease_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker')$$,
    '42501'
  ),
  'ordinary lease resolution rejects the qualification job'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.heartbeat_document_extraction_job_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker', 120)$$,
    '42501'
  ),
  'ordinary heartbeat cannot bypass the qualification mutation guard'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.issue_google_document_extraction_file_grant_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker', repeat('7', 64), 60)$$,
    '42501'
  ),
  'ordinary file grant cannot bypass the qualification mutation guard'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.fail_google_document_extraction_job_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      'ordinary_failure', 'internal')$$,
    '42501'
  ),
  'ordinary failure cannot mutate the qualification job'
);
reset role;

select is(
  (select attempts from public.document_extraction_jobs where id = 'e2650000-0000-4000-8000-000000000001'),
  1,
  'exactly one claim transition occurred'
);
select is(
  (select lease_owner from public.document_extraction_jobs where id = 'e2650000-0000-4000-8000-000000000001'),
  'qualification-worker',
  'only the qualification claimant owns the lease'
);

set local role service_role;
select is(
  public.advance_google_frozen_qualification_job_v1(
    'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
    'leased', 'preparing', 'f2650000-0000-4000-8000-000000000021'
  ) ->> 'stage',
  'preparing',
  'qualification stage wrapper preserves the canonical lease transition'
);
select pg_temp.finish_google_qualification_rpc();
select is(
  public.advance_google_frozen_qualification_job_v1(
    'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
    'preparing', 'dispatching', 'f2650000-0000-4000-8000-000000000022'
  ) ->> 'stage',
  'dispatching',
  'qualification job reaches dispatching without ordinary dispatch authorization'
);
select pg_temp.finish_google_qualification_rpc();
select ok(
  pg_temp.raises_sqlstate(
    $$select public.authorize_google_document_extraction_dispatch_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      'f2650000-0000-4000-8000-000000000025')$$,
    '42501'
  ),
  'ordinary dispatch cannot consume quota or dispatch a qualification job'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.check_google_document_extraction_provider_boundary_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      'inference')$$,
    '42501'
  ),
  'ordinary provider boundary rejects the qualification job explicitly'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_google_document_extraction_provider_outcome_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      'f2650000-0000-4000-8000-000000000025', 'success', 1)$$,
    '42501'
  ),
  'ordinary provider outcome cannot mutate qualification accounting'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.authorize_document_extraction_retry_dispatch_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      'f2650000-0000-4000-8000-000000000025',
      'f2650000-0000-4000-8000-000000000026')$$,
    '42501'
  ),
  'ordinary retry authorization cannot create a qualification retry'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.complete_google_document_extraction_job_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
      repeat('8', 64), '{}'::jsonb, decode('01', 'hex'), 'test-key-v1',
      decode(repeat('01', 12), 'hex'), decode(repeat('01', 16), 'hex'),
      repeat('9', 64))$$,
    '42501'
  ),
  'ordinary completion cannot progress a qualification job'
);
reset role;

update public.document_extraction_google_qualification_runs
set provider_reservation_count = 9
where id = (select run_id from pg_temp.google_qualification_test_execution_ids);
set local role service_role;
select is(
  public.reserve_google_frozen_qualification_page_v1(
    'e2650000-0000-4000-8000-000000000001', 'qualification-worker', 1,
    'f2650000-0000-4000-8000-000000000023',
    'f2650000-0000-4000-8000-000000000024'
  ) ->> 'reason',
  'qualification_call_budget_exceeded',
  'the tenth reservation fails before dispatch'
);
reset role;
select results_eq(
  $$select provider_call_count, provider_dispatched_at is null, dispatch_request_id is null
    from public.document_extraction_jobs
    where id = 'e2650000-0000-4000-8000-000000000001'$$,
  $$values (0, true, true)$$,
  'budget failure leaves provider-call and dispatch state untouched'
);
select is(
  (select count(*)::integer from public.document_extraction_google_qualification_page_reservations),
  0,
  'budget failure creates no page reservation'
);

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.heartbeat_google_frozen_qualification_job_v1(
      'e2650000-0000-4000-8000-000000000001', 'qualification-worker', 120)$$,
    '42501'
  ),
  'fatal stop prevents further qualification heartbeat/progression'
);
reset role;

update public.document_extraction_google_qualification_state
set enabled = false where singleton_key = 'google_frozen_corpus_v1';
set local role service_role;
select is(
  public.cleanup_google_frozen_qualification_v1(
    (select run_id from pg_temp.google_qualification_test_execution_ids),
    'cleanup-google-frozen-corpus-controller-v1'
  ) ->> 'cleanup_version',
  'google_frozen_corpus_cleanup_v2',
  'cleanup latches the graph and emits bounded storage obligations'
);
reset role;
select ok(
  pg_temp.processing_cleanup_proof_matches(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    (select run_id from pg_temp.google_qualification_test_execution_ids),
    'f2650000-0000-4000-8000-000000000004',
    'e2650000-0000-4000-8000-000000000001',
    'c2650000-0000-4000-8000-000000000011',
    'c2650000-0000-4000-8000-000000000001',
    'd2650000-0000-4000-8000-000000000001',
    'b2650000-0000-4000-8000-000000000001',
    1,
    array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[]
  ),
  'intact binding graph produces the exact transaction-signed cleanup proof'
);
select ok(
  pg_temp.processing_cleanup_proof_capture_fails(
    'f2650000-0000-4000-8000-000000000099'
  ),
  'missing processing ownership binding fails closed'
);
select ok(
  pg_temp.processing_cleanup_without_proof_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'd2650000-0000-4000-8000-000000000001',
    'c2650000-0000-4000-8000-000000000011'
  ),
  'missing processing cleanup proof fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'run_id',
    to_jsonb((select replay_run_id::text from pg_temp.google_qualification_test_execution_ids))
  ),
  'substituted cleanup proof run identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'item_id',
    to_jsonb('f2650000-0000-4000-8000-000000000099'::text)
  ),
  'substituted cleanup proof item identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'job_id',
    to_jsonb('e2650000-0000-4000-8000-000000000099'::text)
  ),
  'substituted cleanup proof extraction-job identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'file_processing_job_id',
    to_jsonb('c2650000-0000-4000-8000-000000000012'::text)
  ),
  'substituted cleanup proof processing identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'file_id',
    to_jsonb('c2650000-0000-4000-8000-000000000002'::text)
  ),
  'substituted cleanup proof file identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'intake_request_id',
    to_jsonb('d2650000-0000-4000-8000-000000000099'::text)
  ),
  'substituted cleanup proof intake identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'workspace_id',
    to_jsonb('b2650000-0000-4000-8000-000000000002'::text)
  ),
  'substituted cleanup proof workspace identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'fixture_index',
    '2'::jsonb
  ),
  'substituted cleanup proof fixture identity fails closed'
);
select ok(
  pg_temp.processing_cleanup_proof_substitution_fails(
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    ),
    'c2650000-0000-4000-8000-000000000011',
    'page_identity_fingerprints',
    jsonb_build_array(repeat('0', 64))
  ),
  'substituted cleanup proof page identity fails closed'
);
select set_config(
  'vaeroex.test_owner_only_cleanup_sql',
  format(
    'select public.begin_google_frozen_qualification_processing_cleanup_v1(%L::uuid)',
    (
      select id
      from public.document_extraction_google_qualification_processing_job_bindings
      where file_processing_job_id = 'c2650000-0000-4000-8000-000000000011'
    )::text
  ),
  true
);
set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    current_setting('vaeroex.test_owner_only_cleanup_sql', true),
    '42501'
  ),
  'service role cannot invoke the owner-only processing cleanup proof helper'
);
reset role;
select ok(
  pg_temp.premature_processing_cleanup_fails(
    'f2650000-0000-4000-8000-000000000004',
    'd2650000-0000-4000-8000-000000000001',
    'c2650000-0000-4000-8000-000000000011'
  ),
  'clearing item job identity before processing-row deletion fails closed'
);
reset role;
select is(
  (
    select job_id
    from public.document_extraction_google_qualification_items
    where id = 'f2650000-0000-4000-8000-000000000004'
  ),
  'e2650000-0000-4000-8000-000000000001'::uuid,
  'failed premature cleanup preserves the authoritative item job binding'
);
set local role service_role;
select ok(
  public.verify_google_frozen_qualification_storage_cleanup_v1(
    (select run_id from pg_temp.google_qualification_test_execution_ids),
    'f2650000-0000-4000-8000-000000000002',
    'workspace-files',
    'b2650000-0000-4000-8000-000000000001/fixture-01.pdf',
    'storage-object-absent-google-frozen-corpus-v2'
  ),
  'the exact storage obligation can be marked absent'
);
select is(
  public.finalize_google_frozen_qualification_cleanup_v1(
    (select run_id from pg_temp.google_qualification_test_execution_ids),
    'finalize-google-frozen-corpus-cleanup-v2'
  ) ->> 'cleaned',
  'true',
  'verified cleanup removes the complete synthetic graph'
);
select is(
  public.finalize_google_frozen_qualification_cleanup_v1(
    (select run_id from pg_temp.google_qualification_test_execution_ids),
    'finalize-google-frozen-corpus-cleanup-v2'
  ) ->> 'idempotent',
  'true',
  'cleanup finalization is idempotent'
);
reset role;

select is(
  (
    select count(*)::integer
    from public.document_extraction_google_qualification_cleanup_audits
    where run_id_hash = encode(
      extensions.digest(convert_to(
        (select run_id from pg_temp.google_qualification_test_execution_ids)::text,
        'UTF8'
      ), 'sha256'),
      'hex'
    )
  ),
  1,
  'cleanup retains one append-only audit for the fresh execution identity'
);
select is(
  (
    select count(distinct run_identity)::integer
    from pg_temp.google_qualification_test_execution_ids ids,
    lateral unnest(array[ids.run_id, ids.replay_run_id, ids.third_run_id]) run_identity
  ),
  3,
  'three qualification executions receive distinct random run identities'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      'select pg_temp.assert_google_qualification_run_id_unused(%L::uuid)',
      (select run_id from pg_temp.google_qualification_test_execution_ids)::text
    ),
    '23505'
  ),
  'deliberate reuse of a cleaned run identity fails closed without deleting evidence'
);

select is(
  (select count(*)::integer from public.document_extraction_google_qualification_runs),
  0,
  'no qualification run remains'
);
select is(
  (select count(*)::integer from public.document_extraction_google_qualification_job_bindings),
  0,
  'no qualification job binding remains'
);
select is(
  (select count(*)::integer
    from public.document_extraction_google_qualification_processing_job_bindings),
  0,
  'no qualification upload-processing binding remains'
);
select is(
  (select count(*)::integer from public.file_processing_jobs
    where id = 'c2650000-0000-4000-8000-000000000011'),
  0,
  'qualification-owned upload-processing state is removed'
);
select is(
  (select count(*)::integer from public.file_processing_jobs
    where id = 'c2650000-0000-4000-8000-000000000012'),
  1,
  'unrelated upload-processing state survives cleanup unchanged'
);
select is(
  (
    select deleted_file_processing_job_count
    from public.document_extraction_google_qualification_cleanup_audits
    where run_id_hash = encode(
      extensions.digest(convert_to(
        (select run_id from pg_temp.google_qualification_test_execution_ids)::text,
        'UTF8'
      ), 'sha256'),
      'hex'
    )
  ),
  1,
  'cleanup audit proves the qualification-owned upload-processing row was removed'
);
select is(
  (select count(*)::integer from public.document_extraction_jobs
    where id = 'e2650000-0000-4000-8000-000000000001'),
  0,
  'no synthetic job remains'
);
select is(
  (select count(*)::integer from public.workspaces
    where id = 'b2650000-0000-4000-8000-000000000001'),
  0,
  'the qualification-owned workspace is removed'
);
select is(
  (select count(*)::integer from public.workspaces
    where id = 'b2650000-0000-4000-8000-000000000002'),
  1,
  'unrelated workspace state is unchanged'
);
select is(
  (select count(*)::integer from public.document_extraction_provider_outcomes
    where job_id = 'e2650000-0000-4000-8000-000000000001'),
  0,
  'no provider outcome or provider call record was created'
);

select * from finish();
rollback;
