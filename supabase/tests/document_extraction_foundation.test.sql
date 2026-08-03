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
  ('a1000000-0000-4000-8000-000000000001', 'document-owner@example.test', 'Document Owner'),
  ('a1000000-0000-4000-8000-000000000002', 'document-member@example.test', 'Document Member'),
  ('a1000000-0000-4000-8000-000000000003', 'document-outsider@example.test', 'Document Outsider');

insert into public.workspaces (id, name, created_by) values
  ('b1000000-0000-4000-8000-000000000001', 'Document extraction test', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002', 'Other workspace', 'a1000000-0000-4000-8000-000000000003');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'staff', 'active'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'owner', 'active');

insert into public.file_uploads (
  id, workspace_id, original_name, display_name, file_extension, mime_type,
  file_size_bytes, storage_bucket, storage_path, metadata_json, created_by
) values
  (
    'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
    'review.pdf', 'Review PDF', 'pdf', 'application/pdf', 4096, 'workspace-files',
    'b1000000-0000-4000-8000-000000000001/review.pdf',
    '{"document_extraction_job_id":"e1000000-0000-4000-8000-000000000001","user_note":"preserve"}'::jsonb,
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
    'enqueue.pdf', 'Enqueue PDF', 'pdf', 'application/pdf', 8192, 'workspace-files',
    'b1000000-0000-4000-8000-000000000001/enqueue.pdf', '{}'::jsonb,
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001',
    'legacy.pdf', 'Legacy PDF', 'pdf', 'application/pdf', 2048, 'workspace-files',
    'b1000000-0000-4000-8000-000000000001/legacy.pdf', '{}'::jsonb,
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002',
    'other.pdf', 'Other PDF', 'pdf', 'application/pdf', 2048, 'workspace-files',
    'b1000000-0000-4000-8000-000000000002/other.pdf', '{}'::jsonb,
    'a1000000-0000-4000-8000-000000000003'
  );

insert into public.document_extraction_workspace_settings (
  workspace_id, is_entitled, is_enabled, monthly_page_limit,
  current_period_start, current_period_end, allowed_document_classes
) values (
  'b1000000-0000-4000-8000-000000000001', true, true, 100,
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  array['digital_pdf', 'scanned_pdf', 'image_only_pdf']::text[]
);

update public.document_extraction_system_state
set globally_enabled = true, worker_enabled = true, provider_calls_enabled = true
where singleton_key = 'document_intelligence';

insert into public.document_extraction_intake_requests (
  id, workspace_id, file_id, requested_by, request_id, status, source_kind,
  mime_type, file_extension, file_size_bytes, storage_bucket, storage_path,
  enqueued_at
) values (
  'd1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'enqueued', 'pdf', 'application/pdf', 'pdf', 4096, 'workspace-files',
  'b1000000-0000-4000-8000-000000000001/review.pdf', now()
);

insert into public.document_extraction_jobs (
  id, intake_request_id, workspace_id, file_id, requested_by, request_id,
  route, document_class, stage, status, parser_provider, parser_model,
  parser_revision, client_revision, content_hmac, cache_key,
  routing_policy_version, extraction_contract_version, normalization_version,
  assessment_fingerprint, page_count, pages_qualified, reserved_page_count,
  review_required, approval_status, artifact_fingerprint,
  classification_fingerprint, critical_field_manifest_json,
  critical_field_manifest_fingerprint
) select
  'e1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'nvidia_primary', 'scanned_pdf', 'awaiting_review', 'needs_review',
  'nvidia', 'multimodal-extraction', 'revision-1', 'client-1',
  repeat('1', 64), repeat('2', 64),
  'document_extraction_routing_v1', 'document_extraction_artifact_v1',
  'document_extraction_normalization_v1', repeat('3', 64), 2, 2, 0,
  true, 'pending', repeat('a', 64), repeat('b', 64), manifest,
  public.validate_document_extraction_critical_field_manifest_v1(
    manifest, repeat('a', 64), 'document_extraction_artifact_v1'
  )
from (
  select jsonb_build_object(
    'manifest_version', 'document_extraction_critical_fields_v1',
    'artifact_fingerprint', repeat('a', 64),
    'extraction_contract_version', 'document_extraction_artifact_v1',
    'fields', jsonb_build_array(
      jsonb_build_object('id', 'kpi.current', 'kind', 'current_value', 'value_type', 'number'),
      jsonb_build_object('id', 'kpi.target', 'kind', 'target', 'value_type', 'number')
    )
  ) as manifest
) fixture;

insert into public.document_extraction_file_bindings (
  workspace_id, file_id, job_id, cache_key, created_by
) values (
  'b1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001', repeat('2', 64),
  'a1000000-0000-4000-8000-000000000001'
);

insert into public.document_extraction_cache (
  workspace_id, source_job_id, cache_key, content_hmac, provider, model,
  model_revision, client_revision, routing_policy_version,
  extraction_contract_version, normalization_version, payload_ciphertext,
  encryption_algorithm, encryption_key_version, encryption_nonce,
  authentication_tag, aad_digest, artifact_fingerprint, page_count
) values (
  'b1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001', repeat('2', 64), repeat('1', 64),
  'nvidia', 'multimodal-extraction', 'revision-1', 'client-1',
  'document_extraction_routing_v1', 'document_extraction_artifact_v1',
  'document_extraction_normalization_v1', decode('01', 'hex'), 'aes-256-gcm',
  'managed-key-v1', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'),
  repeat('4', 64), repeat('a', 64), 2
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.validate_document_extraction_critical_field_manifest_v1(
      jsonb_build_object(
        'manifest_version', 'document_extraction_critical_fields_v1',
        'artifact_fingerprint', repeat('a', 64),
        'extraction_contract_version', 'document_extraction_artifact_v1'
      ),
      repeat('a', 64),
      'document_extraction_artifact_v1'
    )$$,
    '22023'
  ),
  'a manifest without an authoritative fields array is rejected'
);

select ok(
  has_function_privilege('authenticated', 'public.request_document_extraction_intake_v1(uuid,uuid)', 'EXECUTE'),
  'authenticated users receive only the narrow intake RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_document_extraction_job_v1(uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users cannot execute the privileged enqueue RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_document_extraction_job_v1(uuid,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role receives the narrow privileged enqueue RPC'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.assert_document_extraction_authority_v1(uuid,uuid,uuid,uuid,text,text,integer)',
    'EXECUTE'
  ),
  'service role does not retain the obsolete user-facing assertion RPC'
);
select ok(not has_table_privilege('authenticated', 'public.document_extraction_jobs', 'INSERT'), 'clients cannot insert jobs directly');
select ok(not has_table_privilege('authenticated', 'public.document_extraction_cache', 'SELECT'), 'clients cannot read encrypted cache payloads');
select ok(not has_table_privilege('service_role', 'public.document_extraction_jobs', 'INSERT'), 'service role must use the narrow broker RPC');
select ok(not has_table_privilege('service_role', 'public.document_extraction_cache', 'SELECT'), 'service role cannot read encrypted cache payloads directly');
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) arg_name
    where n.nspname = 'public'
      and p.proname = 'mutate_document_extraction_review_v1'
      and arg_name in (
        'p_status', 'p_critical_field_count', 'p_confirmed_field_count',
        'p_corrected_field_count', 'p_rejected_field_count', 'p_unresolved_field_count'
      )
  ),
  0,
  'the review RPC exposes no caller-controlled status or count arguments'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000009'
    )$$,
    '42501'
  ),
  'staff cannot approve extracted critical fields'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select is(
  (public.resolve_document_extraction_file_authority_v1(
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) ->> 'eligible')::boolean,
  false,
  'a bound but unapproved review-gated file fails closed'
);
select is(
  (public.resolve_document_extraction_file_authority_v1(
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000003'
  ) ->> 'mode'),
  'existing_native_file_analysis',
  'a true legacy native file remains compatible'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.resolve_document_extraction_file_authority_v1(
      'b1000000-0000-4000-8000-000000000002',
      'c1000000-0000-4000-8000-000000000004'
    )$$,
    '42501'
  ),
  'cross-workspace authority lookup is denied'
);
select lives_ok(
  $$update public.file_uploads
    set metadata_json = metadata_json || '{"display_preference":"compact"}'::jsonb
    where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'unrelated file metadata remains editable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.file_uploads
      set metadata_json = metadata_json - 'document_extraction_job_id'
      where id = 'c1000000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'stripping extraction-control metadata is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.business_memory_chunks (
      workspace_id, source_type, source_id, source_file_id, source_title,
      source_excerpt, content_hash, source_metadata
    ) values (
      'b1000000-0000-4000-8000-000000000001', 'file_analysis',
      'c1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'Unapproved extraction',
      'Must not cross the authority boundary.', repeat('5', 64), '{}'::jsonb
    )$$,
    '42501'
  ),
  'an unapproved bound file cannot create Business Memory chunks'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1, '{}'::jsonb,
      'f1000000-0000-4000-8000-000000000001'
    )$$,
    '22023'
  ),
  'an empty decision object cannot approve a nonempty artifact'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', null, repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000010'
    )$$,
    '22023'
  ),
  'a null review action is rejected rather than treated as a saved review'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":null},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000011'
    )$$,
    '22023'
  ),
  'a null field decision is rejected rather than reclassified'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000002'
    )$$,
    '22023'
  ),
  'omitting one critical field blocks approval'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"kpi.current","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000003'
    )$$,
    '22023'
  ),
  'duplicate field decisions block approval'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"unknown.field","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000004'
    )$$,
    '22023'
  ),
  'unknown critical-field IDs block approval'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"corrected","corrected_value":"not-a-number"},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000005'
    )$$,
    '22023'
  ),
  'malformed corrected values block approval'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"unresolved"},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000006'
    )$$,
    '22023'
  ),
  'unresolved critical fields block approval'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.mutate_document_extraction_review_v1(
      'b1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', 'approve', repeat('c',64),
      repeat('b',64), 'document_extraction_artifact_v1', 1,
      '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"kpi.target","decision":"confirmed"}]}'::jsonb,
      'f1000000-0000-4000-8000-000000000007'
    )$$,
    '22023'
  ),
  'stale artifact fingerprints block approval'
);

select is(
  public.mutate_document_extraction_review_v1(
    'b1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001', 'approve', repeat('a',64),
    repeat('b',64), 'document_extraction_artifact_v1', 1,
    '{"fields":[{"field_id":"kpi.current","decision":"confirmed"},{"field_id":"kpi.target","decision":"corrected","corrected_value":23}]}'::jsonb,
    'f1000000-0000-4000-8000-000000000008'
  ) ->> 'status',
  'approved_with_corrections',
  'a complete valid review derives its approval status server-side'
);
select results_eq(
  $$select critical_field_count, confirmed_field_count, corrected_field_count, rejected_field_count, unresolved_field_count
    from public.document_extraction_reviews
    where workspace_id = 'b1000000-0000-4000-8000-000000000001'
      and job_id = 'e1000000-0000-4000-8000-000000000001'$$,
  $$values (2, 1, 1, 0, 0)$$,
  'review counts are derived from the authoritative manifest and validated decisions'
);
select is(
  (public.resolve_document_extraction_file_authority_v1(
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) ->> 'eligible')::boolean,
  true,
  'an approved matching artifact can cross the relational authority boundary'
);
select lives_ok(
  $$insert into public.business_memory_chunks (
    workspace_id, source_type, source_id, source_file_id, source_title,
    source_excerpt, content_hash, source_metadata
  ) select
    'b1000000-0000-4000-8000-000000000001', 'file_analysis',
    'c1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001', 'Approved extraction',
    'Approved content may cross the authority boundary.', repeat('6', 64),
    jsonb_build_object(
      'document_extraction_authority', jsonb_build_object(
        'job_id', 'e1000000-0000-4000-8000-000000000001',
        'review_id', review.id,
        'artifact_fingerprint', repeat('a', 64),
        'classification_fingerprint', repeat('b', 64),
        'review_version', 1
      )
    )
  from public.document_extraction_reviews review
  where review.workspace_id = 'b1000000-0000-4000-8000-000000000001'
    and review.job_id = 'e1000000-0000-4000-8000-000000000001'$$,
  'an approved matching artifact can create a Business Memory chunk'
);

reset role;
update public.document_extraction_cache
set invalidated_at = now(), invalidation_reason = 'test_invalidation'
where workspace_id = 'b1000000-0000-4000-8000-000000000001'
  and source_job_id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(
  (public.resolve_document_extraction_file_authority_v1(
    'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) ->> 'eligible')::boolean,
  false,
  'an invalidated artifact fails closed even after prior approval'
);

select is(
  public.request_document_extraction_intake_v1(
    'c1000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002'
  ) ->> 'status',
  'requested',
  'authenticated intake derives the stored file identity without browser routing inputs'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.request_document_extraction_intake_v1(
      'c1000000-0000-4000-8000-000000000004',
      'd2000000-0000-4000-8000-000000000003'
    )$$,
    'P0002'
  ),
  'a member cannot request intake for another workspace file'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.enqueue_document_extraction_job_v1(
      'd1000000-0000-4000-8000-000000000002', 'nvidia_primary', 'scanned_pdf',
      repeat('7',64), 1, 'attacker-provider', 'attacker-model', 'attacker-revision',
      'attacker-client', repeat('8',64), repeat('9',64),
      'document_extraction_routing_v1', 'document_extraction_artifact_v1',
      'document_extraction_normalization_v1'
    )$$,
    '42501'
  ),
  'an authenticated member cannot choose quota, provider, model, cache, or version inputs'
);

reset role;
select set_config(
  'vaeroex.test_document_extraction_intake_id',
  (
    select id::text
    from public.document_extraction_intake_requests
    where request_id = 'd2000000-0000-4000-8000-000000000002'
  ),
  true
);
set local role service_role;
select is(
  public.enqueue_document_extraction_job_v1(
    current_setting('vaeroex.test_document_extraction_intake_id')::uuid,
    'nvidia_primary', 'scanned_pdf', repeat('7',64), 7,
    'nvidia', 'multimodal-extraction', 'revision-1', 'client-1',
    repeat('8',64), repeat('9',64), 'document_extraction_routing_v1',
    'document_extraction_artifact_v1', 'document_extraction_normalization_v1'
  ) ->> 'status',
  'queued',
  'the privileged broker creates one trusted queued job'
);
reset role;
select is(
  (
    select pages_reserved
    from public.document_extraction_workspace_settings
    where workspace_id = 'b1000000-0000-4000-8000-000000000001'
  ),
  7,
  'quota reservation uses the trusted authoritative page count'
);
set local role service_role;
select is(
  public.enqueue_document_extraction_job_v1(
    current_setting('vaeroex.test_document_extraction_intake_id')::uuid,
    'nvidia_primary', 'scanned_pdf', repeat('7',64), 7,
    'nvidia', 'multimodal-extraction', 'revision-1', 'client-1',
    repeat('8',64), repeat('9',64), 'document_extraction_routing_v1',
    'document_extraction_artifact_v1', 'document_extraction_normalization_v1'
  ) ->> 'idempotent',
  'true',
  'duplicate privileged enqueue returns the canonical job'
);
reset role;
select is(
  (
    select pages_reserved
    from public.document_extraction_workspace_settings
    where workspace_id = 'b1000000-0000-4000-8000-000000000001'
  ),
  7,
  'idempotent enqueue does not double-reserve quota'
);
set local role service_role;
select is(
  (select count(*)::integer from public.claim_document_extraction_job_v1('worker-one', 120)),
  1,
  'the first worker claims the queued job'
);
select is(
  (select count(*)::integer from public.claim_document_extraction_job_v1('worker-two', 120)),
  0,
  'an active lease cannot be stolen'
);
reset role;
update public.document_extraction_jobs
set lease_expires_at = now() - interval '1 second'
where cache_key = repeat('9', 64);
set local role service_role;
select is(
  (select count(*)::integer from public.claim_document_extraction_job_v1('worker-two', 120)),
  1,
  'an expired undispatched lease can be reclaimed once'
);
select is(
  (select count(*)::integer from public.claim_document_extraction_job_v1('worker-three', 120)),
  0,
  'the reclaimed lease cannot be claimed twice'
);
reset role;
update public.document_extraction_jobs
set lease_expires_at = now() - interval '1 second', provider_dispatched_at = now()
where cache_key = repeat('9', 64);
set local role service_role;
select is(
  (select count(*)::integer from public.claim_document_extraction_job_v1('worker-three', 120)),
  0,
  'an expired dispatched job is never provider-eligible again'
);
reset role;
select is(
  (
    select status
    from public.document_extraction_jobs
    where cache_key = repeat('9', 64)
  ),
  'dispatch_unknown',
  'ambiguous dispatch is terminal and fail-closed'
);

select * from finish();
rollback;
