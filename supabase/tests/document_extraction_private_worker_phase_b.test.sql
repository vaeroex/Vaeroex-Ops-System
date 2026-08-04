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

insert into public.profiles (id, email, full_name) values
  ('a2640000-0000-4000-8000-000000000001', 'phase-b-owner@example.test', 'Phase B Owner');
insert into public.workspaces (id, name, created_by) values
  ('b2640000-0000-4000-8000-000000000001', 'Phase B security tests', 'a2640000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('b2640000-0000-4000-8000-000000000001', 'a2640000-0000-4000-8000-000000000001', 'owner', 'active');
insert into public.file_uploads (
  id, workspace_id, original_name, display_name, file_extension, mime_type,
  file_size_bytes, storage_bucket, storage_path, metadata_json, created_by
) values (
  'c2640000-0000-4000-8000-000000000001',
  'b2640000-0000-4000-8000-000000000001',
  'phase-b.pdf', 'Phase B PDF', 'pdf', 'application/pdf', 1024,
  'workspace-files',
  'b2640000-0000-4000-8000-000000000001/phase-b.pdf',
  '{}'::jsonb,
  'a2640000-0000-4000-8000-000000000001'
);
insert into public.document_extraction_workspace_settings (
  workspace_id, is_entitled, is_enabled, monthly_page_limit,
  current_period_start, current_period_end, allowed_document_classes,
  pages_reserved
) values (
  'b2640000-0000-4000-8000-000000000001', true, true, 100,
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  array['scanned_pdf']::text[], 1
);
update public.document_extraction_system_state
set globally_enabled = true,
    worker_enabled = true,
    provider_calls_enabled = true,
    circuit_state = 'closed',
    circuit_opened_at = null,
    circuit_reason_code = null,
    consecutive_failures = 0,
    rolling_failure_count = 0,
    failure_window_started_at = null,
    failure_window_reset_at = now()
where singleton_key = 'document_intelligence';

insert into public.document_extraction_intake_requests (
  id, workspace_id, file_id, requested_by, request_id, status, source_kind,
  mime_type, file_extension, file_size_bytes, storage_bucket, storage_path,
  enqueued_at
) values (
  'd2640000-0000-4000-8000-000000000001',
  'b2640000-0000-4000-8000-000000000001',
  'c2640000-0000-4000-8000-000000000001',
  'a2640000-0000-4000-8000-000000000001',
  'd2640000-0000-4000-8000-000000000011',
  'enqueued', 'pdf', 'application/pdf', 'pdf', 1024,
  'workspace-files',
  'b2640000-0000-4000-8000-000000000001/phase-b.pdf',
  now()
);
insert into public.document_extraction_jobs (
  id, intake_request_id, workspace_id, file_id, requested_by, request_id,
  route, document_class, stage, status, parser_provider, parser_model,
  parser_revision, client_revision, content_hmac, cache_key,
  routing_policy_version, extraction_contract_version, normalization_version,
  assessment_fingerprint, page_count, pages_qualified, reserved_page_count,
  review_required, approval_status, lease_owner, lease_expires_at,
  broker_protocol_version, worker_runtime_version, last_stage_transition_at
) values (
  'e2640000-0000-4000-8000-000000000001',
  'd2640000-0000-4000-8000-000000000001',
  'b2640000-0000-4000-8000-000000000001',
  'c2640000-0000-4000-8000-000000000001',
  'a2640000-0000-4000-8000-000000000001',
  'd2640000-0000-4000-8000-000000000011',
  'nvidia_primary', 'scanned_pdf', 'leased', 'processing',
  'nvidia', 'nvidia/nemotron-parse', 'nemotron_parse_hosted_tool_call_rest_v1',
  'vaeroex_nemotron_parse_rest_v1',
  repeat('1', 64), repeat('2', 64),
  'document_extraction_routing_v1', 'document_extraction_artifact_v1',
  'document_extraction_normalization_v1', repeat('3', 64),
  1, 1, 1, true, 'pending', 'phase-b-worker', now() + interval '5 minutes',
  'document_extraction_broker_v1', 'document_extraction_worker_v1', now()
);

set local role service_role;
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'leased', 'preparing', 'f2640000-0000-4000-8000-000000000001'
  ) ->> 'stage',
  'preparing',
  'leased to preparing records a valid Phase B event'
);
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'preparing', 'dispatching', 'f2640000-0000-4000-8000-000000000002'
  ) ->> 'stage',
  'dispatching',
  'preparing to dispatching records a valid Phase B event'
);
select is(
  public.authorize_document_extraction_dispatch_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'f2640000-0000-4000-8000-000000000003'
  ) ->> 'authorized',
  'true',
  'dispatching to provider_dispatched succeeds'
);
select results_eq(
  $$select
      result ->> 'authorized',
      result ->> 'reason',
      result ->> 'idempotent'
    from (
      select public.authorize_document_extraction_dispatch_v2(
        'e2640000-0000-4000-8000-000000000001',
        'phase-b-worker',
        'f2640000-0000-4000-8000-000000000003'
      ) result
    ) replay$$,
  $$values ('false'::text, 'dispatch_already_authorized'::text, 'true'::text)$$,
  'a committed dispatch claim cannot authorize a second provider call'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.advance_document_extraction_job_v2(
      'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
      'provider_dispatched', 'normalizing', 'f2640000-0000-4000-8000-000000000004'
    )$$,
    '22023'
  ),
  'skipping extracting fails closed'
);
select is(
  public.record_document_extraction_provider_outcome_v1(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'f2640000-0000-4000-8000-000000000003', 'success', 10
  ) ->> 'recorded',
  'true',
  'the provider outcome is recorded once'
);
select is(
  public.record_document_extraction_provider_outcome_v1(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'f2640000-0000-4000-8000-000000000003', 'success', 10
  ) ->> 'idempotent',
  'true',
  'duplicate provider outcome replay is idempotent'
);
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'provider_dispatched', 'extracting', 'f2640000-0000-4000-8000-000000000005'
  ) ->> 'stage',
  'extracting',
  'provider_dispatched to extracting succeeds after success'
);
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'extracting', 'normalizing', 'f2640000-0000-4000-8000-000000000006'
  ) ->> 'stage',
  'normalizing',
  'the canonical path reaches normalizing'
);
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'normalizing', 'validating', 'f2640000-0000-4000-8000-000000000007'
  ) ->> 'stage',
  'validating',
  'normalizing to validating succeeds'
);
select is(
  public.advance_document_extraction_job_v2(
    'e2640000-0000-4000-8000-000000000001', 'phase-b-worker',
    'validating', 'encrypting', 'f2640000-0000-4000-8000-000000000008'
  ) ->> 'stage',
  'encrypting',
  'validating to encrypting succeeds'
);
select results_eq(
  $$select
      result ->> 'completed',
      result ->> 'status',
      result ->> 'approval_status'
    from (
      select public.complete_document_extraction_job_v2(
        'e2640000-0000-4000-8000-000000000001',
        'phase-b-worker',
        repeat('d', 64),
        jsonb_build_object(
          'manifest_version', 'document_extraction_critical_fields_v1',
          'artifact_fingerprint', repeat('d', 64),
          'extraction_contract_version', 'document_extraction_artifact_v1',
          'fields', '[]'::jsonb
        ),
        decode('10', 'hex'),
        'managed-key-v1',
        decode(repeat('07', 12), 'hex'),
        decode(repeat('08', 16), 'hex'),
        repeat('e', 64)
      ) result
    ) completed$$,
  $$values ('true'::text, 'needs_review'::text, 'pending'::text)$$,
  'encrypting completes atomically into awaiting review'
);
reset role;

select results_eq(
  $$select stage, status, approval_status
    from public.document_extraction_jobs
    where id = 'e2640000-0000-4000-8000-000000000001'$$,
  $$values ('awaiting_review'::text, 'needs_review'::text, 'pending'::text)$$,
  'the authoritative job state records awaiting review'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.document_extraction_events (
      workspace_id, event_type, actor_type, stage, metadata_json, request_id
    ) values (
      'b2640000-0000-4000-8000-000000000001',
      'test_invalid_stage', 'system', 'invented_stage', '{}'::jsonb,
      'f2640000-0000-4000-8000-000000000010'
    )$$,
    '23514'
  ),
  'unknown event stages fail closed'
);
set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$update public.document_extraction_events
      set reason_code = 'tampered'
      where request_id = 'f2640000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'event history remains append-only to the service role'
);
reset role;

insert into public.document_extraction_cache (
  workspace_id, source_job_id, cache_key, content_hmac, provider, model,
  model_revision, client_revision, routing_policy_version,
  extraction_contract_version, normalization_version, payload_ciphertext,
  encryption_algorithm, encryption_key_version, encryption_nonce,
  authentication_tag, aad_digest, artifact_fingerprint, page_count
) values (
  'b2640000-0000-4000-8000-000000000001',
  'e2640000-0000-4000-8000-000000000001', repeat('4', 64), repeat('1', 64),
  'nvidia', 'nvidia/nemotron-parse', 'nemotron_parse_hosted_tool_call_rest_v1',
  'vaeroex_nemotron_parse_rest_v1',
  'document_extraction_routing_v1', 'document_extraction_artifact_v1',
  'document_extraction_normalization_v1', decode('01', 'hex'), 'aes-256-gcm',
  'managed-key-v1', decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'),
  repeat('5', 64), repeat('6', 64), 1
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.document_extraction_cache (
      workspace_id, source_job_id, cache_key, content_hmac, provider, model,
      model_revision, client_revision, routing_policy_version,
      extraction_contract_version, normalization_version, payload_ciphertext,
      encryption_algorithm, encryption_key_version, encryption_nonce,
      authentication_tag, aad_digest, artifact_fingerprint, page_count
    ) values (
      'b2640000-0000-4000-8000-000000000001',
      'e2640000-0000-4000-8000-000000000001', repeat('7', 64), repeat('1', 64),
      'nvidia', 'nvidia/nemotron-parse', 'nemotron_parse_hosted_tool_call_rest_v1',
      'vaeroex_nemotron_parse_rest_v1',
      'document_extraction_routing_v1', 'document_extraction_artifact_v1',
      'document_extraction_normalization_v1', decode('03', 'hex'), 'aes-256-gcm',
      'managed-key-v1', decode(repeat('01', 12), 'hex'), decode(repeat('04', 16), 'hex'),
      repeat('8', 64), repeat('9', 64), 1
    )$$,
    '23505'
  ),
  'a forced nonce collision in one key namespace is rejected'
);
select lives_ok(
  $$insert into public.document_extraction_cache (
    workspace_id, source_job_id, cache_key, content_hmac, provider, model,
    model_revision, client_revision, routing_policy_version,
    extraction_contract_version, normalization_version, payload_ciphertext,
    encryption_algorithm, encryption_key_version, encryption_nonce,
    authentication_tag, aad_digest, artifact_fingerprint, page_count
  ) values (
    'b2640000-0000-4000-8000-000000000001',
    'e2640000-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
    'nvidia', 'nvidia/nemotron-parse', 'nemotron_parse_hosted_tool_call_rest_v1',
    'vaeroex_nemotron_parse_rest_v1',
    'document_extraction_routing_v1', 'document_extraction_artifact_v1',
    'document_extraction_normalization_v1', decode('05', 'hex'), 'aes-256-gcm',
    'managed-key-v2', decode(repeat('01', 12), 'hex'), decode(repeat('06', 16), 'hex'),
    repeat('b', 64), repeat('c', 64), 1
  )$$,
  'a rotated key version has an independent nonce namespace'
);
select is(
  (select count(*)::integer from public.document_extraction_cache
    where encryption_key_version = 'managed-key-v1'
      and encryption_nonce = decode(repeat('01', 12), 'hex')),
  1,
  'a rejected cache collision leaves one canonical encrypted row'
);

set local role service_role;
select is(
  public.set_document_extraction_circuit_state_v1(
    'closed', 'consecutive_threshold_setup', null
  ) ->> 'circuit_state',
  'closed',
  'the operator can establish a fresh consecutive-failure window'
);
reset role;
delete from public.document_extraction_provider_outcomes;
delete from public.document_extraction_circuit_events;
insert into public.document_extraction_provider_outcomes (
  workspace_id, job_id, dispatch_request_id, result_class, latency_ms
) select
  'b2640000-0000-4000-8000-000000000001',
  'e2640000-0000-4000-8000-000000000001',
  ('f2640000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'transport',
  10
from generate_series(20, 22) value;
select public.recompute_document_extraction_circuit_v2('transport');
select results_eq(
  $$select circuit_state, consecutive_failures, rolling_failure_count
    from public.document_extraction_system_state
    where singleton_key = 'document_intelligence'$$,
  $$values ('open'::text, 3, 3)$$,
  'three consecutive failures independently open the circuit'
);

set local role service_role;
select public.set_document_extraction_circuit_state_v1(
  'closed', 'success_reset_setup', null
);
reset role;
delete from public.document_extraction_provider_outcomes;
delete from public.document_extraction_circuit_events;
insert into public.document_extraction_provider_outcomes (
  workspace_id, job_id, dispatch_request_id, result_class, latency_ms
) values
  (
    'b2640000-0000-4000-8000-000000000001',
    'e2640000-0000-4000-8000-000000000001',
    'f2640000-0000-4000-8000-000000000023', 'transport', 10
  ),
  (
    'b2640000-0000-4000-8000-000000000001',
    'e2640000-0000-4000-8000-000000000001',
    'f2640000-0000-4000-8000-000000000024', 'success', 10
  );
select public.recompute_document_extraction_circuit_v2('success');
select results_eq(
  $$select circuit_state, consecutive_failures, rolling_failure_count
    from public.document_extraction_system_state
    where singleton_key = 'document_intelligence'$$,
  $$values ('closed'::text, 0, 1)$$,
  'success resets consecutive failures without erasing the rolling failure'
);

set local role service_role;
select public.set_document_extraction_circuit_state_v1(
  'closed', 'expired_window_setup', null
);
reset role;
delete from public.document_extraction_provider_outcomes;
delete from public.document_extraction_circuit_events;
insert into public.document_extraction_provider_outcomes (
  workspace_id, job_id, dispatch_request_id, result_class, latency_ms, recorded_at
) values (
  'b2640000-0000-4000-8000-000000000001',
  'e2640000-0000-4000-8000-000000000001',
  'f2640000-0000-4000-8000-000000000025', 'transport', 10,
  now() - interval '11 minutes'
);
select public.recompute_document_extraction_circuit_v2('transport');
select results_eq(
  $$select circuit_state, consecutive_failures, rolling_failure_count
    from public.document_extraction_system_state
    where singleton_key = 'document_intelligence'$$,
  $$values ('closed'::text, 0, 0)$$,
  'failures outside the active rolling window stop counting'
);

delete from public.document_extraction_provider_outcomes;
delete from public.document_extraction_circuit_events;
update public.document_extraction_system_state
set circuit_state = 'closed', circuit_opened_at = null, circuit_reason_code = null,
    consecutive_failures = 0, rolling_failure_count = 0,
    failure_window_started_at = null,
    failure_window_reset_at = now() - interval '1 minute'
where singleton_key = 'document_intelligence';
insert into public.document_extraction_provider_outcomes (
  workspace_id, job_id, dispatch_request_id, result_class, latency_ms, recorded_at
)
select
  'b2640000-0000-4000-8000-000000000001',
  'e2640000-0000-4000-8000-000000000001',
  ('f2640000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  case when value % 2 = 0 then 'success' else 'transport' end,
  10,
  now() - make_interval(secs => 10 - value)
from generate_series(11, 19) value;
select public.recompute_document_extraction_circuit_v2('transport');
select results_eq(
  $$select circuit_state, consecutive_failures, rolling_failure_count
    from public.document_extraction_system_state
    where singleton_key = 'document_intelligence'$$,
  $$values ('open'::text, 1, 5)$$,
  'five rolling failures open the circuit despite intervening successes'
);
select is(
  (select count(*)::integer from public.document_extraction_circuit_events
    where next_state = 'open' and trigger_kind = 'provider_threshold'),
  1,
  'automatic circuit opening creates one privacy-safe append-only audit row'
);

set local role service_role;
select is(
  public.set_document_extraction_circuit_state_v1(
    'closed', 'qualified_operator_reset', null
  ) ->> 'circuit_state',
  'closed',
  'authorized operator reset closes and clears the rolling window'
);
reset role;
select results_eq(
  $$select consecutive_failures, rolling_failure_count
    from public.document_extraction_system_state
    where singleton_key = 'document_intelligence'$$,
  $$values (0, 0)$$,
  'operator reset clears both bounded circuit signals'
);

select * from finish();
rollback;
