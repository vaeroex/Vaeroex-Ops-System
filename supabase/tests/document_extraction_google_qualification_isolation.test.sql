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
  'f2650000-0000-4000-8000-000000000003',
  'f2650000-0000-4000-8000-000000000001',
  'b2650000-0000-4000-8000-000000000001',
  'f2650000-0000-4000-8000-000000000013', repeat('5', 64),
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
  'f2650000-0000-4000-8000-000000000003', 1,
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
  'f2650000-0000-4000-8000-000000000003',
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
select throws_ok(
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
  '42501',
  'ordinary enqueue rejects a qualification-owned source even idempotently'
);
select is(
  (select count(*)::integer from public.claim_google_frozen_qualification_job_v1('qualification-worker', 120)),
  1,
  'the exact qualification claim receives the bound job once'
);
select throws_ok(
  $$select public.resolve_google_document_extraction_job_lease_v1(
    'e2650000-0000-4000-8000-000000000001', 'qualification-worker')$$,
  '42501',
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
select is(
  public.advance_google_frozen_qualification_job_v1(
    'e2650000-0000-4000-8000-000000000001', 'qualification-worker',
    'preparing', 'dispatching', 'f2650000-0000-4000-8000-000000000022'
  ) ->> 'stage',
  'dispatching',
  'qualification job reaches dispatching without ordinary dispatch authorization'
);
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
where id = 'f2650000-0000-4000-8000-000000000003';
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
    'f2650000-0000-4000-8000-000000000003',
    'cleanup-google-frozen-corpus-controller-v1'
  ) ->> 'cleanup_version',
  'google_frozen_corpus_cleanup_v2',
  'cleanup latches the graph and emits bounded storage obligations'
);
select ok(
  public.verify_google_frozen_qualification_storage_cleanup_v1(
    'f2650000-0000-4000-8000-000000000003',
    'f2650000-0000-4000-8000-000000000002',
    'workspace-files',
    'b2650000-0000-4000-8000-000000000001/fixture-01.pdf',
    'storage-object-absent-google-frozen-corpus-v2'
  ),
  'the exact storage obligation can be marked absent'
);
select is(
  public.finalize_google_frozen_qualification_cleanup_v1(
    'f2650000-0000-4000-8000-000000000003',
    'finalize-google-frozen-corpus-cleanup-v2'
  ) ->> 'cleaned',
  'true',
  'verified cleanup removes the complete synthetic graph'
);
select is(
  public.finalize_google_frozen_qualification_cleanup_v1(
    'f2650000-0000-4000-8000-000000000003',
    'finalize-google-frozen-corpus-cleanup-v2'
  ) ->> 'idempotent',
  'true',
  'cleanup finalization is idempotent'
);
reset role;

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
