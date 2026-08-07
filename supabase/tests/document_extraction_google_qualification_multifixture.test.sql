begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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

create or replace function pg_temp.clear_google_guard()
returns void
language plpgsql
as $$
begin
  perform set_config('vaeroex.google_qualification_guard', '', true);
  perform set_config('vaeroex.google_qualification_guard_context', '', true);
end;
$$;

create or replace function pg_temp.attempt_stale_workspace_mutation()
returns void
language plpgsql
as $$
begin
  perform public.begin_google_frozen_qualification_mutation_v1(
    'd2660000-0000-4000-8000-000000000001', 'cleanup'
  );
  update public.document_extraction_workspace_settings
  set pages_reserved = pages_reserved
  where workspace_id = 'b2660000-0000-4000-8000-000000000001';
end;
$$;

create or replace function pg_temp.attempt_wrong_job_mutation()
returns void
language plpgsql
as $$
begin
  perform public.begin_google_frozen_qualification_mutation_v1(
    'd2660000-0000-4000-8000-000000000002', 'cleanup'
  );
  update public.document_extraction_jobs
  set updated_at = now()
  where id = 'e2660000-0000-4000-8000-000000000001';
end;
$$;

create or replace function pg_temp.attempt_wrong_file_mutation()
returns void
language plpgsql
as $$
begin
  perform public.begin_google_frozen_qualification_mutation_v1(
    'd2660000-0000-4000-8000-000000000002', 'cleanup'
  );
  update public.file_uploads
  set updated_at = now()
  where id = 'c2660000-0000-4000-8000-000000000001';
end;
$$;

insert into public.profiles (id, email, full_name) values
  ('a2660000-0000-4000-8000-000000000001', 'pr265-multifixture@example.test', 'PR 265 Multi Fixture');
insert into public.workspaces (id, name, created_by) values
  ('b2660000-0000-4000-8000-000000000001', 'PR 265 multi-fixture qualification', 'a2660000-0000-4000-8000-000000000001'),
  ('b2660000-0000-4000-8000-000000000002', 'PR 265 ordinary control', 'a2660000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('b2660000-0000-4000-8000-000000000001', 'a2660000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('b2660000-0000-4000-8000-000000000002', 'a2660000-0000-4000-8000-000000000001', 'owner', 'active');

insert into public.file_uploads (
  id, workspace_id, original_name, display_name, file_extension, mime_type,
  file_size_bytes, storage_bucket, storage_path, metadata_json, created_by
) values
  ('c2660000-0000-4000-8000-000000000001', 'b2660000-0000-4000-8000-000000000001',
   'fixture-01.pdf', 'Fixture 01', 'pdf', 'application/pdf', 1024,
   'workspace-files', 'b2660000-0000-4000-8000-000000000001/fixture-01.pdf',
   '{}'::jsonb, 'a2660000-0000-4000-8000-000000000001'),
  ('c2660000-0000-4000-8000-000000000002', 'b2660000-0000-4000-8000-000000000001',
   'fixture-02.pdf', 'Fixture 02', 'pdf', 'application/pdf', 2048,
   'workspace-files', 'b2660000-0000-4000-8000-000000000001/fixture-02.pdf',
   '{}'::jsonb, 'a2660000-0000-4000-8000-000000000001');

insert into public.file_processing_jobs (
  id, workspace_id, file_upload_id, job_type, status, attempts, max_attempts,
  metadata_json, created_by
) values
  ('c2660000-0000-4000-8000-000000000011', 'b2660000-0000-4000-8000-000000000001',
   'c2660000-0000-4000-8000-000000000001', 'extract', 'queued', 0, 3,
   '{"source":"upload"}'::jsonb, 'a2660000-0000-4000-8000-000000000001'),
  ('c2660000-0000-4000-8000-000000000012', 'b2660000-0000-4000-8000-000000000001',
   'c2660000-0000-4000-8000-000000000002', 'extract', 'queued', 0, 3,
   '{"source":"upload"}'::jsonb, 'a2660000-0000-4000-8000-000000000001');

insert into public.document_extraction_workspace_settings (
  workspace_id, is_entitled, is_enabled, monthly_page_limit,
  current_period_start, current_period_end, allowed_document_classes,
  pages_reserved, pages_consumed
) values (
  'b2660000-0000-4000-8000-000000000001', true, true, 20,
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  array['digital_pdf', 'image_only_pdf']::text[], 1, 0
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
) values
  ('d2660000-0000-4000-8000-000000000001', 'b2660000-0000-4000-8000-000000000001',
   'c2660000-0000-4000-8000-000000000001', 'a2660000-0000-4000-8000-000000000001',
   'd2660000-0000-4000-8000-000000000011', 'requested', 'pdf', 'application/pdf',
   'pdf', 1024, 'workspace-files',
   'b2660000-0000-4000-8000-000000000001/fixture-01.pdf'),
  ('d2660000-0000-4000-8000-000000000002', 'b2660000-0000-4000-8000-000000000001',
   'c2660000-0000-4000-8000-000000000002', 'a2660000-0000-4000-8000-000000000001',
   'd2660000-0000-4000-8000-000000000012', 'requested', 'pdf', 'application/pdf',
   'pdf', 2048, 'workspace-files',
   'b2660000-0000-4000-8000-000000000001/fixture-02.pdf');

-- Fixture 1's queued provider-neutral job exists before qualification ownership
-- is installed, matching the database-only qualification setup contract.
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
  'e2660000-0000-4000-8000-000000000001',
  'd2660000-0000-4000-8000-000000000001',
  'b2660000-0000-4000-8000-000000000001',
  'c2660000-0000-4000-8000-000000000001',
  'a2660000-0000-4000-8000-000000000001',
  'd2660000-0000-4000-8000-000000000011',
  'google_primary', 'digital_pdf', 'queued', 'queued',
  'google_document_ai', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_enterprise_ocr_v1', 'vaeroex_google_document_ai_rest_v1',
  repeat('1', 64), repeat('2', 64), 'document_extraction_routing_v1',
  'document_extraction_artifact_v2', 'document_extraction_normalization_v2',
  repeat('3', 64), 1, 1, 1, 1, true, 'pending',
  'google_document_ai_enterprise_ocr_v1', 'OCR_PROCESSOR', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'us', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_processor_version_process_v1',
  'google_document_ai_process_request_v1', 'google_document_ai_process_response_v2',
  'google_document_ai_layout_normalization_v2',
  'google_document_ai_enterprise_ocr_strict_v1', 'tables_if_present_strict_v1',
  'preserve_for_review_never_authority_v1', 'disabled_v1',
  'document_extraction_review_provenance_v2'
);

insert into public.document_extraction_google_qualification_environment (
  id, singleton_key, environment, supabase_project_ref,
  production_project_ref_exclusion, synthetic_workspace_id,
  processor_id, processor_resource, processor_location, processor_version,
  provider_profile, controller_version, execution_guard_secret
) values (
  'f2660000-0000-4000-8000-000000000001', 'google_frozen_corpus_v1',
  'preview', 'zfpnhvcmuuvtswttmnjd', 'mdiianhfrojmxqpwrflh',
  'b2660000-0000-4000-8000-000000000001', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'us', 'pretrained-ocr-v2.1-2024-08-07',
  'google_document_ai_enterprise_ocr_v1',
  'google_frozen_corpus_qualification_controller_v2', repeat('4', 64)
);
insert into public.document_extraction_google_qualification_sources (
  id, environment_id, fixture_index, workspace_id, intake_request_id, file_id,
  source_sha256, fixture_identity_fingerprint, page_identity_fingerprints,
  page_count, document_class, assessment_fingerprint, content_hmac, cache_key,
  storage_bucket, storage_path, file_size_bytes, verification_version
) values
  ('f2660000-0000-4000-8000-000000000011', 'f2660000-0000-4000-8000-000000000001', 1,
   'b2660000-0000-4000-8000-000000000001', 'd2660000-0000-4000-8000-000000000001',
   'c2660000-0000-4000-8000-000000000001',
   'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec',
   '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1',
   array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[],
   1, 'digital_pdf', repeat('3', 64), repeat('1', 64), repeat('2', 64),
   'workspace-files', 'b2660000-0000-4000-8000-000000000001/fixture-01.pdf', 1024,
   'trusted_storage_sha256_v1'),
  ('f2660000-0000-4000-8000-000000000012', 'f2660000-0000-4000-8000-000000000001', 2,
   'b2660000-0000-4000-8000-000000000001', 'd2660000-0000-4000-8000-000000000002',
   'c2660000-0000-4000-8000-000000000002',
   'd8bcb7a1d1e5c77d66591f621beaf33227e9f8c7779744423f4f498a338b9bad',
   '6dd82f859b9e0a9542614e472ef7acfe9474370cf2d62268aad3a2dbb318e0a8',
   array['742f58e6e58296f46a1e83543ba4bc1c1287772bc228559f92d639513398df3d']::text[],
   1, 'image_only_pdf', repeat('7', 64), repeat('8', 64), repeat('9', 64),
   'workspace-files', 'b2660000-0000-4000-8000-000000000001/fixture-02.pdf', 2048,
   'trusted_storage_sha256_v1');

insert into public.document_extraction_google_qualification_runs (
  id, environment_id, workspace_id, request_id, workspace_binding_fingerprint,
  controller_version, benchmark_contract_version, benchmark_profile_fingerprint,
  fixture_source_commit, corpus_sha256, provider_profile, processor_id,
  processor_resource, processor_version, active_fixture_index
) values (
  'f2660000-0000-4000-8000-000000000021', 'f2660000-0000-4000-8000-000000000001',
  'b2660000-0000-4000-8000-000000000001', 'f2660000-0000-4000-8000-000000000022',
  repeat('5', 64), 'google_frozen_corpus_qualification_controller_v2',
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
) values
  ('f2660000-0000-4000-8000-000000000031', 'f2660000-0000-4000-8000-000000000021', 1,
   '7122901f3e5576868e1dc47205a8d033419699ecb9cb88d220d00f0560d2c6f1',
   'e99132d7be25bc71b3fdc43faf765072b6c5c837d6d693728fc614905d9e66ec',
   array['d11271f3e2088235d16db17305b074f88944b493692887fc8302887326b03ec1']::text[],
   1, true, 'f2660000-0000-4000-8000-000000000011',
   'd2660000-0000-4000-8000-000000000001', 'c2660000-0000-4000-8000-000000000001',
   'google_primary', 'digital_pdf', repeat('3', 64), repeat('1', 64), repeat('2', 64),
   'e2660000-0000-4000-8000-000000000001', 'queued'),
  ('f2660000-0000-4000-8000-000000000032', 'f2660000-0000-4000-8000-000000000021', 2,
   '6dd82f859b9e0a9542614e472ef7acfe9474370cf2d62268aad3a2dbb318e0a8',
   'd8bcb7a1d1e5c77d66591f621beaf33227e9f8c7779744423f4f498a338b9bad',
   array['742f58e6e58296f46a1e83543ba4bc1c1287772bc228559f92d639513398df3d']::text[],
   1, true, 'f2660000-0000-4000-8000-000000000012',
   'd2660000-0000-4000-8000-000000000002', 'c2660000-0000-4000-8000-000000000002',
   'google_primary', 'image_only_pdf', repeat('7', 64), repeat('8', 64), repeat('9', 64),
   null, 'planned');
insert into public.document_extraction_google_qualification_job_bindings (
  run_id, item_id, source_binding_id, job_id, intake_request_id, file_id,
  workspace_id, fixture_index, corpus_contract_version, corpus_sha256,
  fixture_identity_fingerprint, source_sha256, page_identity_fingerprints,
  page_count, provider_profile, processor_id, processor_resource,
  processor_version, preview_project_ref, controller_version
) values (
  'f2660000-0000-4000-8000-000000000021', 'f2660000-0000-4000-8000-000000000031',
  'f2660000-0000-4000-8000-000000000011', 'e2660000-0000-4000-8000-000000000001',
  'd2660000-0000-4000-8000-000000000001', 'c2660000-0000-4000-8000-000000000001',
  'b2660000-0000-4000-8000-000000000001', 1,
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
  (select count(*)::integer
   from public.claim_google_frozen_qualification_job_v1('qualification-worker', 120)),
  1,
  'fixture 1 is claimed through the qualification-only path'
);
select pg_temp.clear_google_guard();
reset role;

insert into public.document_extraction_google_qualification_page_reservations (
  id, run_id, item_id, job_id, fixture_index, page_index, reservation_number,
  reservation_request_id, dispatch_request_id, worker_id, lease_expires_at,
  provider, provider_profile, processor_id, processor_resource,
  processor_version, controller_version, qualification_state_updated_at,
  status, result_class, provider_request_started, finished_at
) values (
  'f2660000-0000-4000-8000-000000000041', 'f2660000-0000-4000-8000-000000000021',
  'f2660000-0000-4000-8000-000000000031', 'e2660000-0000-4000-8000-000000000001',
  1, 1, 1, 'f2660000-0000-4000-8000-000000000042',
  'f2660000-0000-4000-8000-000000000043', 'qualification-worker', now() + interval '5 minutes',
  'google_document_ai', 'google_document_ai_enterprise_ocr_v1', '948f589143795629',
  'projects/626856681952/locations/us/processors/948f589143795629/processorVersions/pretrained-ocr-v2.1-2024-08-07',
  'pretrained-ocr-v2.1-2024-08-07', 'google_frozen_corpus_qualification_controller_v2',
  (select updated_at from public.document_extraction_google_qualification_state
   where singleton_key = 'google_frozen_corpus_v1'),
  'succeeded', 'success', true, now()
);
update public.document_extraction_google_qualification_runs
set provider_reservation_count = 1, provider_call_count = 1
where id = 'f2660000-0000-4000-8000-000000000021';
update public.document_extraction_google_qualification_items
set provider_reservation_count = 1, provider_call_count = 1
where id = 'f2660000-0000-4000-8000-000000000031';
select public.begin_google_frozen_qualification_mutation_v1(
  'd2660000-0000-4000-8000-000000000001', 'complete'
);
update public.document_extraction_jobs
set stage = 'awaiting_review', status = 'needs_review', approval_status = 'pending',
    validation_result = 'passed', encryption_result = 'encrypted',
    provider_call_count = 1, retry_count = 0,
    lease_owner = null, lease_expires_at = null, heartbeat_at = null,
    updated_at = now()
where id = 'e2660000-0000-4000-8000-000000000001';
select pg_temp.clear_google_guard();

set local role service_role;
select is(
  public.finish_google_frozen_qualification_item_v1(
    'f2660000-0000-4000-8000-000000000021',
    'e2660000-0000-4000-8000-000000000001'
  ) ->> 'finished',
  'true',
  'fixture 1 reaches the existing successful review boundary'
);
select is(
  public.enqueue_next_google_frozen_qualification_item_v1(
    'f2660000-0000-4000-8000-000000000021',
    'f2660000-0000-4000-8000-000000000051'
  ) ->> 'fixture_index',
  '2',
  'fixture 2 enqueues after fixture 1 without inheriting fixture 1 context'
);
reset role;

select results_eq(
  $$select active_fixture_index from public.document_extraction_google_qualification_runs
    where id = 'f2660000-0000-4000-8000-000000000021'$$,
  $$values (2)$$,
  'the run advances to fixture 2 only'
);
select results_eq(
  $$select status, job_id is not null
    from public.document_extraction_google_qualification_items
    where id = 'f2660000-0000-4000-8000-000000000032'$$,
  $$values ('queued'::text, true)$$,
  'fixture 2 owns its newly created job'
);
select is(
  (current_setting('vaeroex.google_qualification_guard_context', true)::jsonb
    ->> 'fixture_index')::integer,
  2,
  'the transaction guard resolves fixture 2 rather than fixture 1'
);
select is(
  (select pages_reserved from public.document_extraction_workspace_settings
   where workspace_id = 'b2660000-0000-4000-8000-000000000001'),
  2,
  'the shared workspace reservation mutation succeeds under fixture 2 context'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.begin_google_frozen_qualification_mutation_v1(
      'd2660000-0000-4000-8000-000000000001', 'enqueue')$$,
    '42501'
  ),
  'fixture 1 cannot re-enter enqueue after fixture 2 becomes active'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.begin_google_frozen_qualification_mutation_v1(
      'd2660000-0000-4000-8000-000000000099', 'enqueue')$$,
    '42501'
  ),
  'a wrong intake cannot manufacture qualification context'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select pg_temp.attempt_stale_workspace_mutation()$$,
    '42501'
  ),
  'stale fixture 1 context cannot mutate fixture 2 shared workspace state'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select pg_temp.attempt_wrong_job_mutation()$$,
    '42501'
  ),
  'fixture 2 context cannot mutate fixture 1 job state'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select pg_temp.attempt_wrong_file_mutation()$$,
    '42501'
  ),
  'fixture 2 context cannot mutate fixture 1 file state'
);
select ok(
  pg_temp.clear_google_guard() is null,
  'the signed transaction context can be explicitly cleared between RPCs'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.document_extraction_workspace_settings
      set pages_reserved = pages_reserved
      where workspace_id = 'b2660000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'ordinary state cannot use stale qualification guard context'
);

select * from finish();
rollback;
