-- Google Document AI Enterprise OCR v1 - inert provider contract foundation
--
-- This additive migration introduces an exact, versioned Google extraction
-- profile beside the historical NVIDIA profiles. It enables no system or
-- workspace gate, creates no customer data, performs no backfill, makes no
-- provider call, and grants no provider output direct business authority.
-- Google output must be encrypted and stop at mandatory human review.

alter table public.document_extraction_workspace_settings
  drop constraint if exists document_extraction_settings_document_classes_check;
alter table public.document_extraction_workspace_settings
  add constraint document_extraction_settings_document_classes_check check (
    allowed_document_classes <@ array[
      'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
      'png', 'jpeg', 'screenshot', 'phone_photo',
      'printed_document_photo', 'typed_form', 'invoice_like', 'receipt_like',
      'printed_table_document'
    ]::text[]
  );

alter table public.document_extraction_jobs
  drop constraint if exists document_extraction_jobs_route_check;
alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_route_check check (route in (
    'native', 'nvidia_primary', 'nvidia_fallback', 'google_primary', 'google_fallback'
  ));

alter table public.document_extraction_jobs
  drop constraint if exists document_extraction_jobs_document_class_check;
alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_document_class_check check (document_class in (
    'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
    'png', 'jpeg', 'screenshot', 'phone_photo',
    'printed_document_photo', 'typed_form', 'invoice_like', 'receipt_like',
    'printed_table_document'
  ));

alter table public.document_extraction_operational_telemetry
  drop constraint if exists document_extraction_operational_telemetry_parser_route_check;
alter table public.document_extraction_operational_telemetry
  add constraint document_extraction_operational_telemetry_parser_route_check check (
    parser_route in ('nvidia_primary', 'nvidia_fallback', 'google_primary', 'google_fallback')
  );

alter table public.document_extraction_operational_telemetry
  drop constraint if exists document_extraction_operational_telemetry_document_class_check;
alter table public.document_extraction_operational_telemetry
  add constraint document_extraction_operational_telemetry_document_class_check check (
    document_class in (
      'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
      'png', 'jpeg', 'screenshot', 'phone_photo',
      'printed_document_photo', 'typed_form', 'invoice_like', 'receipt_like',
      'printed_table_document'
    )
  );

alter table public.document_extraction_jobs
  add column if not exists provider_profile text,
  add column if not exists processor_type text,
  add column if not exists processor_id text,
  add column if not exists processor_resource text,
  add column if not exists processor_location text,
  add column if not exists processor_version text,
  add column if not exists endpoint_contract_version text,
  add column if not exists request_serializer_version text,
  add column if not exists response_validator_version text,
  add column if not exists provider_normalization_version text,
  add column if not exists compatibility_policy_version text,
  add column if not exists table_policy_version text,
  add column if not exists confidence_policy_version text,
  add column if not exists selection_mark_policy_version text,
  add column if not exists review_provenance_version text,
  add column if not exists completion_worker_id text check (
    completion_worker_id is null or completion_worker_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  );

alter table public.document_extraction_cache
  add column if not exists provider_profile text,
  add column if not exists processor_type text,
  add column if not exists processor_id text,
  add column if not exists processor_resource text,
  add column if not exists processor_location text,
  add column if not exists processor_version text,
  add column if not exists endpoint_contract_version text,
  add column if not exists request_serializer_version text,
  add column if not exists response_validator_version text,
  add column if not exists provider_normalization_version text,
  add column if not exists compatibility_policy_version text,
  add column if not exists table_policy_version text,
  add column if not exists confidence_policy_version text,
  add column if not exists selection_mark_policy_version text,
  add column if not exists review_provenance_version text;

alter table public.document_extraction_operational_telemetry
  add column if not exists parser_provider text,
  add column if not exists provider_profile text,
  add column if not exists processor_type text,
  add column if not exists processor_id text,
  add column if not exists processor_resource text,
  add column if not exists processor_location text,
  add column if not exists processor_version text,
  add column if not exists endpoint_contract_version text,
  add column if not exists request_serializer_version text,
  add column if not exists response_validator_version text,
  add column if not exists provider_normalization_version text,
  add column if not exists routing_policy_version text,
  add column if not exists review_provenance_version text,
  add column if not exists compatibility_policy_version text;

alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_google_contract_v1_check check (
    route not in ('google_primary', 'google_fallback')
    or (
      parser_provider = 'google_document_ai'
      and parser_model = 'pretrained-ocr-v2.1-2024-08-07'
      and parser_revision = 'google_document_ai_enterprise_ocr_v1'
      and client_revision = 'vaeroex_google_document_ai_rest_v1'
      and provider_profile = 'google_document_ai_enterprise_ocr_v1'
      and processor_type = 'OCR_PROCESSOR'
      and processor_id ~ '^[a-f0-9]{8,64}$'
      and processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
      and processor_resource like '%/processors/' || processor_id || '/processorVersions/%'
      and processor_location = 'us'
      and processor_version = 'pretrained-ocr-v2.1-2024-08-07'
      and endpoint_contract_version = 'google_document_ai_processor_version_process_v1'
      and request_serializer_version = 'google_document_ai_process_request_v1'
      and response_validator_version = 'google_document_ai_process_response_v2'
      and provider_normalization_version = 'google_document_ai_layout_normalization_v2'
      and compatibility_policy_version = 'google_document_ai_enterprise_ocr_strict_v1'
      and table_policy_version = 'tables_if_present_strict_v1'
      and confidence_policy_version = 'preserve_for_review_never_authority_v1'
      and selection_mark_policy_version = 'disabled_v1'
      and review_provenance_version = 'document_extraction_review_provenance_v2'
      and extraction_contract_version = 'document_extraction_artifact_v2'
      and normalization_version = 'document_extraction_normalization_v2'
      and page_count between 1 and 15
      and max_attempts = 1
      and review_required
    )
  ) not valid;

alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_google_single_call_v1_check check (
    route not in ('google_primary', 'google_fallback')
    or (
      max_attempts = 1
      and retry_count = 0
      and provider_call_count between 0 and 1
    )
  ) not valid;

alter table public.document_extraction_cache
  add constraint document_extraction_cache_google_contract_v1_check check (
    provider <> 'google_document_ai'
    or (
      model = 'pretrained-ocr-v2.1-2024-08-07'
      and model_revision = 'google_document_ai_enterprise_ocr_v1'
      and client_revision = 'vaeroex_google_document_ai_rest_v1'
      and provider_profile = 'google_document_ai_enterprise_ocr_v1'
      and processor_type = 'OCR_PROCESSOR'
      and processor_id ~ '^[a-f0-9]{8,64}$'
      and processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
      and processor_resource like '%/processors/' || processor_id || '/processorVersions/%'
      and processor_location = 'us'
      and processor_version = 'pretrained-ocr-v2.1-2024-08-07'
      and endpoint_contract_version = 'google_document_ai_processor_version_process_v1'
      and request_serializer_version = 'google_document_ai_process_request_v1'
      and response_validator_version = 'google_document_ai_process_response_v2'
      and provider_normalization_version = 'google_document_ai_layout_normalization_v2'
      and compatibility_policy_version = 'google_document_ai_enterprise_ocr_strict_v1'
      and table_policy_version = 'tables_if_present_strict_v1'
      and confidence_policy_version = 'preserve_for_review_never_authority_v1'
      and selection_mark_policy_version = 'disabled_v1'
      and review_provenance_version = 'document_extraction_review_provenance_v2'
      and extraction_contract_version = 'document_extraction_artifact_v2'
      and normalization_version = 'document_extraction_normalization_v2'
      and page_count between 1 and 15
    )
  ) not valid;

alter table public.document_extraction_operational_telemetry
  add constraint document_extraction_telemetry_google_contract_v1_check check (
    parser_provider is distinct from 'google_document_ai'
    or (
      parser_route in ('google_primary', 'google_fallback')
      and model_revision = 'google_document_ai_enterprise_ocr_v1'
      and client_revision = 'vaeroex_google_document_ai_rest_v1'
      and provider_profile = 'google_document_ai_enterprise_ocr_v1'
      and processor_type = 'OCR_PROCESSOR'
      and processor_id ~ '^[a-f0-9]{8,64}$'
      and processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
      and processor_resource like '%/processors/' || processor_id || '/processorVersions/%'
      and processor_location = 'us'
      and processor_version = 'pretrained-ocr-v2.1-2024-08-07'
      and endpoint_contract_version = 'google_document_ai_processor_version_process_v1'
      and request_serializer_version = 'google_document_ai_process_request_v1'
      and response_validator_version = 'google_document_ai_process_response_v2'
      and provider_normalization_version = 'google_document_ai_layout_normalization_v2'
      and routing_policy_version = 'document_extraction_routing_v1'
      and review_provenance_version = 'document_extraction_review_provenance_v2'
      and compatibility_policy_version = 'google_document_ai_enterprise_ocr_strict_v1'
      and provider_calls between 0 and 1
      and retry_count = 0
    )
  ) not valid;

create unique index if not exists document_extraction_jobs_one_active_provider_per_workspace_idx
  on public.document_extraction_jobs(workspace_id)
  where route in (
    'nvidia_primary', 'nvidia_fallback', 'google_primary', 'google_fallback'
  ) and status in ('queued', 'processing', 'dispatch_unknown');

create or replace function public.document_extraction_runtime_reason_v2(
  p_workspace_id uuid,
  p_document_class text,
  p_required_pages integer
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_system public.document_extraction_system_state%rowtype;
  v_settings public.document_extraction_workspace_settings%rowtype;
begin
  if p_required_pages < 0 then return 'quota_exhausted'; end if;
  if p_document_class not in (
    'digital_pdf', 'digital_docx', 'scanned_pdf', 'image_only_pdf',
    'png', 'jpeg', 'screenshot', 'phone_photo',
    'printed_document_photo', 'typed_form', 'invoice_like', 'receipt_like',
    'printed_table_document'
  ) then return 'document_class_not_allowed'; end if;
  select * into v_system
  from public.document_extraction_system_state
  where singleton_key = 'document_intelligence';
  if v_system.singleton_key is null or not v_system.globally_enabled then return 'globally_disabled'; end if;
  if not v_system.worker_enabled then return 'worker_disabled'; end if;
  if not v_system.provider_calls_enabled then return 'provider_calls_disabled'; end if;
  select * into v_settings
  from public.document_extraction_workspace_settings
  where workspace_id = p_workspace_id;
  if v_settings.workspace_id is null or not v_settings.is_entitled then return 'workspace_not_entitled'; end if;
  if not v_settings.is_enabled then return 'workspace_disabled'; end if;
  if p_document_class <> all(v_settings.allowed_document_classes) then return 'document_class_not_allowed'; end if;
  if v_system.circuit_state <> 'closed' then return 'circuit_open'; end if;
  if p_required_pages > 0 and (
    v_settings.current_period_start is null
    or current_date not between v_settings.current_period_start and v_settings.current_period_end
    or v_settings.pages_reserved + v_settings.pages_consumed + p_required_pages > v_settings.monthly_page_limit
  ) then return 'quota_exhausted'; end if;
  return 'eligible';
end;
$$;

revoke execute on function public.document_extraction_runtime_reason_v2(uuid, text, integer)
  from public, anon, authenticated, service_role;

comment on function public.document_extraction_runtime_reason_v2(uuid, text, integer) is
  'Internal fail-closed runtime gate for the versioned printed-document classes; it cannot enable any gate.';

create or replace function public.document_extraction_google_job_identity_is_exact_v1(
  p_job public.document_extraction_jobs
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_job.route in ('google_primary', 'google_fallback')
    and p_job.parser_provider = 'google_document_ai'
    and p_job.parser_model = 'pretrained-ocr-v2.1-2024-08-07'
    and p_job.parser_revision = 'google_document_ai_enterprise_ocr_v1'
    and p_job.client_revision = 'vaeroex_google_document_ai_rest_v1'
    and p_job.provider_profile = 'google_document_ai_enterprise_ocr_v1'
    and p_job.processor_type = 'OCR_PROCESSOR'
    and p_job.processor_id ~ '^[a-f0-9]{8,64}$'
    and p_job.processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
    and p_job.processor_resource like '%/processors/' || p_job.processor_id || '/processorVersions/%'
    and p_job.processor_location = 'us'
    and p_job.processor_version = 'pretrained-ocr-v2.1-2024-08-07'
    and p_job.endpoint_contract_version = 'google_document_ai_processor_version_process_v1'
    and p_job.request_serializer_version = 'google_document_ai_process_request_v1'
    and p_job.response_validator_version = 'google_document_ai_process_response_v2'
    and p_job.provider_normalization_version = 'google_document_ai_layout_normalization_v2'
    and p_job.compatibility_policy_version = 'google_document_ai_enterprise_ocr_strict_v1'
    and p_job.table_policy_version = 'tables_if_present_strict_v1'
    and p_job.confidence_policy_version = 'preserve_for_review_never_authority_v1'
    and p_job.selection_mark_policy_version = 'disabled_v1'
    and p_job.routing_policy_version = 'document_extraction_routing_v1'
    and p_job.extraction_contract_version = 'document_extraction_artifact_v2'
    and p_job.normalization_version = 'document_extraction_normalization_v2'
    and p_job.review_provenance_version = 'document_extraction_review_provenance_v2'
    and p_job.page_count between 1 and 15
    and p_job.pages_qualified = p_job.page_count
    and p_job.max_attempts = 1
    and p_job.review_required;
$$;

revoke execute on function public.document_extraction_google_job_identity_is_exact_v1(
  public.document_extraction_jobs
) from public, anon, authenticated, service_role;

create or replace function public.enqueue_google_document_extraction_job_v1(
  p_intake_request_id uuid,
  p_route text,
  p_document_class text,
  p_assessment_fingerprint text,
  p_page_count integer,
  p_parser_provider text,
  p_parser_model text,
  p_parser_revision text,
  p_client_revision text,
  p_content_hmac text,
  p_cache_key text,
  p_routing_policy_version text,
  p_extraction_contract_version text,
  p_normalization_version text,
  p_provider_profile text,
  p_processor_type text,
  p_processor_id text,
  p_processor_resource text,
  p_processor_location text,
  p_processor_version text,
  p_endpoint_contract_version text,
  p_request_serializer_version text,
  p_response_validator_version text,
  p_provider_normalization_version text,
  p_compatibility_policy_version text,
  p_table_policy_version text,
  p_confidence_policy_version text,
  p_selection_mark_policy_version text,
  p_review_provenance_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake public.document_extraction_intake_requests%rowtype;
  v_file public.file_uploads%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_settings public.document_extraction_workspace_settings%rowtype;
  v_reason text;
begin
  select * into v_intake
  from public.document_extraction_intake_requests
  where id = p_intake_request_id
  for update;
  if v_intake.id is null or v_intake.status = 'cancelled' then
    raise exception 'Active document extraction intake not found.' using errcode = 'P0002';
  end if;
  select * into v_file
  from public.file_uploads
  where id = v_intake.file_id
    and workspace_id = v_intake.workspace_id
    and deleted_at is null
    and archived_at is null
  for update;
  if v_file.id is null
    or lower(v_file.mime_type) <> v_intake.mime_type
    or lower(v_file.file_extension) <> v_intake.file_extension
    or v_file.file_size_bytes <> v_intake.file_size_bytes
    or v_file.storage_bucket <> v_intake.storage_bucket
    or v_file.storage_path <> v_intake.storage_path
    or v_intake.file_size_bytes not between 1 and 25000000
    or v_intake.storage_path not like v_intake.workspace_id::text || '/%' then
    raise exception 'Stored source identity changed after intake.' using errcode = '22023';
  end if;
  if not (
    (
      v_intake.source_kind = 'pdf'
      and p_document_class in (
        'digital_pdf', 'scanned_pdf', 'image_only_pdf', 'typed_form',
        'invoice_like', 'receipt_like', 'printed_table_document'
      )
      and p_route in ('google_primary', 'google_fallback')
    )
    or (
      v_intake.source_kind in ('png', 'jpeg')
      and p_document_class in (
        'printed_document_photo', 'typed_form', 'invoice_like',
        'receipt_like', 'printed_table_document'
      )
      and p_route = 'google_primary'
      and p_page_count = 1
    )
  ) then
    raise exception 'Trusted Google route does not match the stored source assessment.' using errcode = '22023';
  end if;
  if p_assessment_fingerprint !~ '^[0-9a-f]{64}$'
    or p_content_hmac !~ '^[0-9a-f]{64}$'
    or p_cache_key !~ '^[0-9a-f]{64}$'
    or p_page_count not between 1 and 15
    or p_parser_provider <> 'google_document_ai'
    or p_parser_model <> 'pretrained-ocr-v2.1-2024-08-07'
    or p_parser_revision <> 'google_document_ai_enterprise_ocr_v1'
    or p_client_revision <> 'vaeroex_google_document_ai_rest_v1'
    or p_provider_profile <> 'google_document_ai_enterprise_ocr_v1'
    or p_processor_type <> 'OCR_PROCESSOR'
    or p_processor_id !~ '^[a-f0-9]{8,64}$'
    or p_processor_resource !~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
    or p_processor_resource not like '%/processors/' || p_processor_id || '/processorVersions/%'
    or p_processor_location <> 'us'
    or p_processor_version <> 'pretrained-ocr-v2.1-2024-08-07'
    or p_endpoint_contract_version <> 'google_document_ai_processor_version_process_v1'
    or p_request_serializer_version <> 'google_document_ai_process_request_v1'
    or p_response_validator_version <> 'google_document_ai_process_response_v2'
    or p_provider_normalization_version <> 'google_document_ai_layout_normalization_v2'
    or p_compatibility_policy_version <> 'google_document_ai_enterprise_ocr_strict_v1'
    or p_table_policy_version <> 'tables_if_present_strict_v1'
    or p_confidence_policy_version <> 'preserve_for_review_never_authority_v1'
    or p_selection_mark_policy_version <> 'disabled_v1'
    or p_routing_policy_version <> 'document_extraction_routing_v1'
    or p_extraction_contract_version <> 'document_extraction_artifact_v2'
    or p_normalization_version <> 'document_extraction_normalization_v2'
    or p_review_provenance_version <> 'document_extraction_review_provenance_v2' then
    raise exception 'Google extraction identity is not approved.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_intake.workspace_id::text || ':' || p_cache_key, 0)
  );
  select * into v_job
  from public.document_extraction_jobs
  where intake_request_id = v_intake.id
  for update;
  if v_job.id is not null then
    if v_job.cache_key <> p_cache_key
      or v_job.assessment_fingerprint <> p_assessment_fingerprint
      or v_job.page_count <> p_page_count
      or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
      or v_job.processor_resource <> p_processor_resource then
      raise exception 'Google enqueue replay does not match the original identity.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'job_id', v_job.id, 'status', v_job.status, 'idempotent', true,
      'cache_hit', v_job.status = 'completed'
    );
  end if;

  select * into v_job
  from public.document_extraction_jobs
  where workspace_id = v_intake.workspace_id and cache_key = p_cache_key
  for update;
  if v_job.id is not null then
    if not public.document_extraction_google_job_identity_is_exact_v1(v_job)
      or v_job.processor_resource <> p_processor_resource then
      raise exception 'Cross-profile Google cache identity collision.' using errcode = '23505';
    end if;
    update public.document_extraction_file_bindings
    set is_current = false, superseded_at = now()
    where workspace_id = v_intake.workspace_id
      and file_id = v_intake.file_id
      and is_current
      and job_id <> v_job.id;
    insert into public.document_extraction_file_bindings (
      workspace_id, file_id, job_id, cache_key, created_by, is_current, superseded_at
    ) values (
      v_intake.workspace_id, v_intake.file_id, v_job.id, p_cache_key,
      v_intake.requested_by, true, null
    )
    on conflict (workspace_id, file_id, job_id) do update
      set is_current = true, superseded_at = null;
    update public.document_extraction_intake_requests
    set status = 'enqueued', enqueued_at = coalesce(enqueued_at, now()), cancelled_at = null
    where id = v_intake.id;
    if v_job.status = 'completed' then
      update public.document_extraction_cache
      set last_used_at = now()
      where workspace_id = v_intake.workspace_id
        and cache_key = p_cache_key
        and provider = 'google_document_ai'
        and provider_profile = 'google_document_ai_enterprise_ocr_v1'
        and processor_resource = p_processor_resource
        and invalidated_at is null;
    end if;
    return jsonb_build_object(
      'job_id', v_job.id, 'status', v_job.status, 'idempotent', true,
      'cache_hit', exists (
        select 1 from public.document_extraction_cache cache
        where cache.workspace_id = v_intake.workspace_id
          and cache.cache_key = p_cache_key
          and cache.provider = 'google_document_ai'
          and cache.provider_profile = 'google_document_ai_enterprise_ocr_v1'
          and cache.processor_resource = p_processor_resource
          and cache.invalidated_at is null
      )
    );
  end if;

  select * into v_settings
  from public.document_extraction_workspace_settings
  where workspace_id = v_intake.workspace_id
  for update;
  if v_settings.workspace_id is not null and (
    v_settings.current_period_start is null
    or current_date not between v_settings.current_period_start and v_settings.current_period_end
  ) then
    update public.document_extraction_workspace_settings
    set current_period_start = date_trunc('month', current_date)::date,
        current_period_end = (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
        pages_reserved = 0, pages_consumed = 0, updated_at = now()
    where workspace_id = v_intake.workspace_id
    returning * into v_settings;
  end if;
  v_reason := public.document_extraction_runtime_reason_v2(
    v_intake.workspace_id, p_document_class, p_page_count
  );
  if v_reason <> 'eligible' then
    return jsonb_build_object(
      'job_id', null, 'status', 'blocked', 'reason', v_reason,
      'idempotent', false, 'cache_hit', false
    );
  end if;
  if exists (
    select 1 from public.document_extraction_jobs job
    where job.workspace_id = v_intake.workspace_id
      and job.route in (
        'nvidia_primary', 'nvidia_fallback', 'google_primary', 'google_fallback'
      )
      and job.status in ('queued', 'processing', 'dispatch_unknown')
  ) then
    return jsonb_build_object(
      'job_id', null, 'status', 'blocked', 'reason', 'concurrency_limit_reached',
      'idempotent', false, 'cache_hit', false
    );
  end if;

  update public.document_extraction_workspace_settings
  set pages_reserved = pages_reserved + p_page_count, updated_at = now()
  where workspace_id = v_intake.workspace_id;
  insert into public.document_extraction_jobs (
    intake_request_id, workspace_id, file_id, requested_by, request_id,
    route, document_class, parser_provider, parser_model, parser_revision,
    client_revision, content_hmac, cache_key, routing_policy_version,
    extraction_contract_version, normalization_version, assessment_fingerprint,
    page_count, pages_qualified, reserved_page_count, max_attempts,
    review_required, approval_status, provider_profile, processor_type,
    processor_id, processor_resource, processor_location, processor_version,
    endpoint_contract_version, request_serializer_version,
    response_validator_version, provider_normalization_version,
    compatibility_policy_version, table_policy_version,
    confidence_policy_version, selection_mark_policy_version,
    review_provenance_version
  ) values (
    v_intake.id, v_intake.workspace_id, v_intake.file_id, v_intake.requested_by,
    v_intake.request_id, p_route, p_document_class, p_parser_provider,
    p_parser_model, p_parser_revision, p_client_revision, p_content_hmac,
    p_cache_key, p_routing_policy_version, p_extraction_contract_version,
    p_normalization_version, p_assessment_fingerprint, p_page_count,
    p_page_count, p_page_count, 1, true, 'pending', p_provider_profile,
    p_processor_type, p_processor_id, p_processor_resource,
    p_processor_location, p_processor_version, p_endpoint_contract_version,
    p_request_serializer_version, p_response_validator_version,
    p_provider_normalization_version, p_compatibility_policy_version,
    p_table_policy_version, p_confidence_policy_version,
    p_selection_mark_policy_version, p_review_provenance_version
  ) returning * into v_job;
  update public.document_extraction_file_bindings
  set is_current = false, superseded_at = now()
  where workspace_id = v_intake.workspace_id and file_id = v_intake.file_id and is_current;
  insert into public.document_extraction_file_bindings (
    workspace_id, file_id, job_id, cache_key, created_by, is_current, superseded_at
  ) values (
    v_intake.workspace_id, v_intake.file_id, v_job.id, p_cache_key,
    v_intake.requested_by, true, null
  );
  update public.document_extraction_intake_requests
  set status = 'enqueued', enqueued_at = now(), cancelled_at = null
  where id = v_intake.id;
  perform public.record_document_extraction_event_v1(
    v_intake.workspace_id, v_job.id, 'google_job_enqueued', 'system',
    v_intake.requested_by, v_job.stage, v_job.status, null, null,
    jsonb_build_object(
      'route', p_route, 'document_class', p_document_class,
      'pages_reserved', p_page_count, 'provider_profile', p_provider_profile
    ),
    gen_random_uuid()
  );
  return jsonb_build_object(
    'job_id', v_job.id, 'status', v_job.status,
    'idempotent', false, 'cache_hit', false
  );
end;
$$;

revoke execute on function public.enqueue_google_document_extraction_job_v1(
  uuid, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_google_document_extraction_job_v1(
  uuid, text, text, text, integer, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text
) to service_role;

create or replace function public.claim_google_document_extraction_job_v1(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns setof public.document_extraction_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid Google worker lease request.' using errcode = '22023';
  end if;

  with ambiguous as (
    update public.document_extraction_jobs job
    set status = 'dispatch_unknown', stage = 'terminal', lease_owner = null,
        lease_expires_at = null, heartbeat_at = null,
        failure_code = 'lease_expired_after_google_dispatch',
        failure_class = 'ambiguous_dispatch',
        provider_result_class = coalesce(provider_result_class, 'ambiguous_dispatch'),
        provider_outcome_recorded_at = coalesce(provider_outcome_recorded_at, now()),
        failed_at = now(), updated_at = now()
    where job.status = 'processing'
      and job.lease_expires_at <= now()
      and job.provider_dispatched_at is not null
      and public.document_extraction_google_job_identity_is_exact_v1(job)
    returning job.*
  )
  insert into public.document_extraction_events (
    workspace_id, job_id, event_type, actor_type, stage, status,
    reason_code, metadata_json, request_id
  )
  select workspace_id, id, 'dispatch_became_ambiguous', 'system', stage, status,
    failure_code, jsonb_build_object('provider_profile', provider_profile), gen_random_uuid()
  from ambiguous;

  select job.* into v_job
  from public.document_extraction_jobs job
  join public.document_extraction_intake_requests intake
    on intake.id = job.intake_request_id
  where job.status = 'queued'
    and job.attempts = 0
    and job.max_attempts = 1
    and intake.file_size_bytes between 1 and 25000000
    and public.document_extraction_google_job_identity_is_exact_v1(job)
    and public.document_extraction_runtime_reason_v2(
      job.workspace_id, job.document_class, 0
    ) = 'eligible'
  order by job.created_at
  for update of job skip locked
  limit 1;
  if v_job.id is null then return; end if;

  update public.document_extraction_jobs
  set status = 'processing', stage = 'leased', attempts = 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()),
      broker_protocol_version = 'document_extraction_broker_v2',
      worker_runtime_version = 'document_extraction_worker_v2',
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'google_job_claimed', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object(
      'attempt', v_job.attempts, 'provider_profile', v_job.provider_profile
    ),
    gen_random_uuid()
  );
  return next v_job;
end;
$$;

revoke execute on function public.claim_google_document_extraction_job_v1(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_google_document_extraction_job_v1(text, integer)
  to service_role;

create or replace function public.resolve_google_document_extraction_job_lease_v1(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'Active Google job lease not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id,
    'workspace_id', v_job.workspace_id,
    'route', v_job.route,
    'document_class', v_job.document_class,
    'page_count', v_job.page_count,
    'cache_key', v_job.cache_key,
    'parser_provider', v_job.parser_provider,
    'parser_model', v_job.parser_model,
    'parser_revision', v_job.parser_revision,
    'client_revision', v_job.client_revision,
    'provider_profile', v_job.provider_profile,
    'processor_type', v_job.processor_type,
    'processor_id', v_job.processor_id,
    'processor_resource', v_job.processor_resource,
    'processor_location', v_job.processor_location,
    'processor_version', v_job.processor_version,
    'endpoint_contract_version', v_job.endpoint_contract_version,
    'request_serializer_version', v_job.request_serializer_version,
    'response_validator_version', v_job.response_validator_version,
    'provider_normalization_version', v_job.provider_normalization_version,
    'compatibility_policy_version', v_job.compatibility_policy_version,
    'table_policy_version', v_job.table_policy_version,
    'confidence_policy_version', v_job.confidence_policy_version,
    'selection_mark_policy_version', v_job.selection_mark_policy_version,
    'routing_policy_version', v_job.routing_policy_version,
    'review_provenance_version', v_job.review_provenance_version,
    'extraction_contract_version', v_job.extraction_contract_version,
    'normalization_version', v_job.normalization_version,
    'stage', v_job.stage,
    'status', v_job.status,
    'lease_expires_at', v_job.lease_expires_at
  );
end;
$$;

revoke execute on function public.resolve_google_document_extraction_job_lease_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_google_document_extraction_job_lease_v1(uuid, text)
  to service_role;

create or replace function public.advance_google_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_expected_stage text,
  p_next_stage text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_reason text;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.stage <> p_expected_stage
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'The Google worker cannot advance this job.' using errcode = '42501';
  end if;
  if not (
    (p_expected_stage = 'leased' and p_next_stage = 'preparing')
    or (p_expected_stage = 'preparing' and p_next_stage = 'dispatching')
    or (
      p_expected_stage = 'provider_dispatched'
      and p_next_stage = 'extracting'
      and v_job.provider_result_class = 'success'
    )
    or (p_expected_stage = 'extracting' and p_next_stage = 'normalizing')
    or (p_expected_stage = 'normalizing' and p_next_stage = 'validating')
    or (p_expected_stage = 'validating' and p_next_stage = 'encrypting')
  ) then
    raise exception 'Invalid Google extraction stage transition.' using errcode = '22023';
  end if;
  v_reason := public.document_extraction_runtime_reason_v2(
    v_job.workspace_id, v_job.document_class, 0
  );
  if v_reason <> 'eligible' then
    return jsonb_build_object('advanced', false, 'reason', v_reason);
  end if;
  update public.document_extraction_jobs
  set stage = p_next_stage, last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'google_job_stage_advanced', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object(
      'from_stage', p_expected_stage, 'provider_profile', v_job.provider_profile
    ),
    p_request_id
  );
  return jsonb_build_object(
    'advanced', true, 'stage', v_job.stage, 'status', v_job.status
  );
end;
$$;

revoke execute on function public.advance_google_document_extraction_job_v1(
  uuid, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.advance_google_document_extraction_job_v1(
  uuid, text, text, text, uuid
) to service_role;

create or replace function public.issue_google_document_extraction_file_grant_v1(
  p_job_id uuid,
  p_worker_id text,
  p_token_hash text,
  p_ttl_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_grant public.document_extraction_file_access_grants%rowtype;
  v_reason text;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.stage not in ('leased', 'preparing')
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_ttl_seconds not between 15 and 120
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'Google file access is not authorized for this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v2(
    v_job.workspace_id, v_job.document_class, 0
  );
  if v_reason <> 'eligible' then
    return jsonb_build_object('issued', false, 'reason', v_reason);
  end if;
  insert into public.document_extraction_file_access_grants (
    workspace_id, job_id, file_id, worker_id, token_hash, expires_at
  ) values (
    v_job.workspace_id, v_job.id, v_job.file_id, p_worker_id, p_token_hash,
    now() + make_interval(secs => p_ttl_seconds)
  ) returning * into v_grant;
  return jsonb_build_object(
    'issued', true, 'grant_id', v_grant.id,
    'expires_at', v_grant.expires_at, 'page_count', v_job.page_count
  );
end;
$$;

revoke execute on function public.issue_google_document_extraction_file_grant_v1(
  uuid, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.issue_google_document_extraction_file_grant_v1(
  uuid, text, text, integer
) to service_role;

create or replace function public.consume_google_document_extraction_file_grant_v1(
  p_grant_id uuid,
  p_worker_id text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.document_extraction_file_access_grants%rowtype;
  v_job public.document_extraction_jobs%rowtype;
  v_intake public.document_extraction_intake_requests%rowtype;
begin
  select * into v_grant
  from public.document_extraction_file_access_grants
  where id = p_grant_id
  for update;
  if v_grant.id is null
    or v_grant.worker_id <> p_worker_id
    or v_grant.token_hash <> p_token_hash
    or v_grant.expires_at <= now()
    or v_grant.consumed_at is not null then
    raise exception 'Google file grant is expired, consumed, or invalid.' using errcode = '42501';
  end if;
  select * into v_job
  from public.document_extraction_jobs
  where id = v_grant.job_id
  for update;
  if v_job.id is null
    or v_job.file_id <> v_grant.file_id
    or v_job.workspace_id <> v_grant.workspace_id
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.stage not in ('leased', 'preparing')
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or public.document_extraction_runtime_reason_v2(
      v_job.workspace_id, v_job.document_class, 0
    ) <> 'eligible' then
    raise exception 'Google file grant no longer matches an active lease.' using errcode = '42501';
  end if;
  select * into v_intake
  from public.document_extraction_intake_requests
  where id = v_job.intake_request_id
    and workspace_id = v_job.workspace_id
    and file_id = v_job.file_id;
  if v_intake.id is null
    or v_intake.storage_path not like v_job.workspace_id::text || '/%'
    or v_intake.file_size_bytes not between 1 and 25000000 then
    raise exception 'Stored Google source identity is invalid.' using errcode = '42501';
  end if;
  update public.document_extraction_file_access_grants
  set consumed_at = now()
  where id = v_grant.id;
  return jsonb_build_object(
    'storage_bucket', v_intake.storage_bucket,
    'storage_path', v_intake.storage_path,
    'mime_type', v_intake.mime_type,
    'file_extension', v_intake.file_extension,
    'file_size_bytes', v_intake.file_size_bytes,
    'job_id', v_job.id
  );
end;
$$;

revoke execute on function public.consume_google_document_extraction_file_grant_v1(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.consume_google_document_extraction_file_grant_v1(
  uuid, text, text
) to service_role;

create or replace function public.authorize_google_document_extraction_dispatch_v1(
  p_job_id uuid,
  p_worker_id text,
  p_dispatch_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_reason text;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'The Google job is not dispatchable by this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v2(
    v_job.workspace_id, v_job.document_class, 0
  );
  if v_reason <> 'eligible' then
    return jsonb_build_object(
      'authorized', false, 'reason', v_reason, 'idempotent', false
    );
  end if;
  if v_job.stage = 'provider_dispatched'
    and v_job.dispatch_request_id = p_dispatch_request_id then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'dispatch_already_authorized',
      'idempotent', true
    );
  end if;
  if v_job.stage <> 'dispatching'
    or v_job.provider_dispatched_at is not null
    or v_job.dispatch_request_id is not null
    or v_job.provider_call_count <> 0
    or v_job.retry_count <> 0
    or v_job.reserved_page_count <> v_job.page_count
    or p_dispatch_request_id is null then
    raise exception 'Google provider reservation is not available.' using errcode = '42501';
  end if;
  update public.document_extraction_workspace_settings
  set pages_reserved = greatest(0, pages_reserved - v_job.reserved_page_count),
      pages_consumed = pages_consumed + v_job.reserved_page_count,
      updated_at = now()
  where workspace_id = v_job.workspace_id;
  if not found then
    raise exception 'Google workspace quota state is missing.' using errcode = '42501';
  end if;
  update public.document_extraction_jobs
  set stage = 'provider_dispatched',
      provider_dispatched_at = now(),
      dispatch_request_id = p_dispatch_request_id,
      provider_call_count = 1,
      billed_page_count = reserved_page_count,
      reserved_page_count = 0,
      last_stage_transition_at = now(),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'google_provider_dispatch_authorized',
    'worker', null, v_job.stage, v_job.status, null, null,
    jsonb_build_object(
      'billed_pages', v_job.billed_page_count,
      'provider_call', 1,
      'provider_profile', v_job.provider_profile
    ),
    p_dispatch_request_id
  );
  return jsonb_build_object(
    'authorized', true, 'reason', 'eligible', 'idempotent', false
  );
end;
$$;

revoke execute on function public.authorize_google_document_extraction_dispatch_v1(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.authorize_google_document_extraction_dispatch_v1(
  uuid, text, uuid
) to service_role;

create or replace function public.check_google_document_extraction_provider_boundary_v1(
  p_job_id uuid,
  p_worker_id text,
  p_boundary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_reason text;
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or p_boundary <> 'inference' then
    raise exception 'Invalid Google provider-boundary request.' using errcode = '22023';
  end if;
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.stage <> 'provider_dispatched'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.provider_dispatched_at is null
    or v_job.provider_call_count <> 1
    or v_job.retry_count <> 0
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'Google provider boundary is not available to this lease.' using errcode = '42501';
  end if;
  v_reason := public.document_extraction_runtime_reason_v2(
    v_job.workspace_id, v_job.document_class, 0
  );
  if v_reason = 'eligible' then
    update public.document_extraction_jobs
    set heartbeat_at = now(),
        lease_expires_at = now() + interval '5 minutes',
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
  end if;
  return jsonb_build_object(
    'allowed', v_reason = 'eligible',
    'reason', v_reason,
    'boundary', p_boundary,
    'lease_expires_at', case
      when v_reason = 'eligible' then v_job.lease_expires_at else null
    end
  );
end;
$$;

revoke execute on function public.check_google_document_extraction_provider_boundary_v1(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.check_google_document_extraction_provider_boundary_v1(
  uuid, text, text
) to service_role;

create or replace function public.record_google_document_extraction_provider_outcome_v1(
  p_job_id uuid,
  p_worker_id text,
  p_dispatch_request_id uuid,
  p_result_class text,
  p_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_result jsonb;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or v_job.provider_call_count <> 1
    or v_job.retry_count <> 0 then
    raise exception 'Google provider outcome identity is invalid.' using errcode = '42501';
  end if;
  select public.record_document_extraction_provider_outcome_v1(
    p_job_id, p_worker_id, p_dispatch_request_id, p_result_class, p_latency_ms
  ) into v_result;
  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('retry_permitted', false);
end;
$$;

revoke execute on function public.record_google_document_extraction_provider_outcome_v1(
  uuid, text, uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_google_document_extraction_provider_outcome_v1(
  uuid, text, uuid, text, integer
) to service_role;

create or replace function public.fail_google_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_failure_code text,
  p_failure_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_result jsonb;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'Google failure identity is invalid.' using errcode = '42501';
  end if;
  select public.fail_document_extraction_job_v2(
    p_job_id, p_worker_id, p_failure_code, p_failure_class
  ) into v_result;
  update public.document_extraction_jobs
  set completion_worker_id = p_worker_id, updated_at = now()
  where id = p_job_id;
  return v_result;
end;
$$;

revoke execute on function public.fail_google_document_extraction_job_v1(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_google_document_extraction_job_v1(
  uuid, text, text, text
) to service_role;

create or replace function public.validate_google_document_extraction_manifest_v3(
  p_manifest jsonb,
  p_artifact_fingerprint text,
  p_job public.document_extraction_jobs
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_provenance jsonb;
  v_workspace_binding text;
  v_job_binding text;
  v_page_identity text;
  v_provenance_fingerprint text;
begin
  if not public.document_extraction_google_job_identity_is_exact_v1(p_job)
    or p_artifact_fingerprint !~ '^[0-9a-f]{64}$'
    or p_manifest is null
    or jsonb_typeof(p_manifest) <> 'object'
    or octet_length(p_manifest::text) > 65536
    or (select count(*) from jsonb_object_keys(p_manifest)) <> 6
    or exists (
      select 1 from jsonb_object_keys(p_manifest) key
      where key not in (
        'manifest_version', 'artifact_fingerprint', 'extraction_contract_version',
        'review_provenance_fingerprint', 'review_provenance', 'fields'
      )
    )
    or p_manifest ->> 'manifest_version'
      is distinct from 'document_extraction_critical_fields_v3'
    or p_manifest ->> 'artifact_fingerprint' is distinct from p_artifact_fingerprint
    or p_manifest ->> 'extraction_contract_version'
      is distinct from 'document_extraction_artifact_v2'
    or p_manifest ->> 'review_provenance_fingerprint' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_manifest -> 'review_provenance') <> 'object'
    or coalesce(jsonb_typeof(p_manifest -> 'fields') <> 'array', true)
    or jsonb_array_length(p_manifest -> 'fields') > 500 then
    raise exception 'Invalid Google critical-field manifest v3 envelope.' using errcode = '22023';
  end if;

  perform public.validate_document_extraction_critical_field_manifest_v1(
    jsonb_build_object(
      'manifest_version', 'document_extraction_critical_fields_v1',
      'artifact_fingerprint', p_artifact_fingerprint,
      'extraction_contract_version', 'document_extraction_artifact_v2',
      'fields', p_manifest -> 'fields'
    ),
    p_artifact_fingerprint,
    'document_extraction_artifact_v2'
  );

  v_workspace_binding := public.document_extraction_workspace_binding_fingerprint_v1(
    p_job.workspace_id
  );
  v_job_binding := public.document_extraction_job_binding_fingerprint_v1(
    p_job.workspace_id, p_job.id, p_job.cache_key
  );
  v_page_identity := public.document_extraction_page_identity_fingerprint_v1(
    p_job.workspace_id, p_job.id, p_job.cache_key, p_job.page_count
  );
  v_provenance := p_manifest -> 'review_provenance';
  if octet_length(v_provenance::text) > 8192
    or (select count(*) from jsonb_object_keys(v_provenance)) <> 26
    or exists (
      select 1 from jsonb_object_keys(v_provenance) key
      where key not in (
        'review_provenance_version', 'content_fingerprint', 'parser_provider',
        'parser_revision', 'client_revision', 'provider_profile',
        'processor_type', 'processor_id', 'processor_resource',
        'processor_location', 'processor_version', 'endpoint_contract_version',
        'request_serializer_version', 'response_validator_version',
        'provider_normalization_version', 'artifact_normalization_version',
        'compatibility_policy_version', 'table_policy_version',
        'confidence_policy_version', 'selection_mark_policy_version',
        'routing_policy_version', 'model_alias', 'page_identity_fingerprint',
        'workspace_binding_fingerprint', 'job_binding_fingerprint', 'review_version'
      )
    )
    or v_provenance ->> 'review_provenance_version'
      is distinct from p_job.review_provenance_version
    or v_provenance ->> 'content_fingerprint' is distinct from p_artifact_fingerprint
    or v_provenance ->> 'parser_provider' is distinct from p_job.parser_provider
    or v_provenance ->> 'parser_revision' is distinct from p_job.parser_revision
    or v_provenance ->> 'client_revision' is distinct from p_job.client_revision
    or v_provenance ->> 'provider_profile' is distinct from p_job.provider_profile
    or v_provenance ->> 'processor_type' is distinct from p_job.processor_type
    or v_provenance ->> 'processor_id' is distinct from p_job.processor_id
    or v_provenance ->> 'processor_resource' is distinct from p_job.processor_resource
    or v_provenance ->> 'processor_location' is distinct from p_job.processor_location
    or v_provenance ->> 'processor_version' is distinct from p_job.processor_version
    or v_provenance ->> 'endpoint_contract_version'
      is distinct from p_job.endpoint_contract_version
    or v_provenance ->> 'request_serializer_version'
      is distinct from p_job.request_serializer_version
    or v_provenance ->> 'response_validator_version'
      is distinct from p_job.response_validator_version
    or v_provenance ->> 'provider_normalization_version'
      is distinct from p_job.provider_normalization_version
    or v_provenance ->> 'artifact_normalization_version'
      is distinct from p_job.normalization_version
    or v_provenance ->> 'compatibility_policy_version'
      is distinct from p_job.compatibility_policy_version
    or v_provenance ->> 'table_policy_version' is distinct from p_job.table_policy_version
    or v_provenance ->> 'confidence_policy_version'
      is distinct from p_job.confidence_policy_version
    or v_provenance ->> 'selection_mark_policy_version'
      is distinct from p_job.selection_mark_policy_version
    or v_provenance ->> 'routing_policy_version'
      is distinct from p_job.routing_policy_version
    or v_provenance ->> 'model_alias' is distinct from p_job.parser_model
    or v_provenance ->> 'page_identity_fingerprint' is distinct from v_page_identity
    or v_provenance ->> 'workspace_binding_fingerprint' is distinct from v_workspace_binding
    or v_provenance ->> 'job_binding_fingerprint' is distinct from v_job_binding
    or v_provenance ->> 'review_version'
      is distinct from p_job.required_review_version::text then
    raise exception 'Invalid Google review provenance.' using errcode = '22023';
  end if;

  v_provenance_fingerprint := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\n',
          v_provenance ->> 'review_provenance_version',
          v_provenance ->> 'content_fingerprint',
          v_provenance ->> 'parser_provider',
          v_provenance ->> 'parser_revision',
          v_provenance ->> 'client_revision',
          v_provenance ->> 'provider_profile',
          v_provenance ->> 'processor_type',
          v_provenance ->> 'processor_id',
          v_provenance ->> 'processor_resource',
          v_provenance ->> 'processor_location',
          v_provenance ->> 'processor_version',
          v_provenance ->> 'endpoint_contract_version',
          v_provenance ->> 'request_serializer_version',
          v_provenance ->> 'response_validator_version',
          v_provenance ->> 'provider_normalization_version',
          v_provenance ->> 'artifact_normalization_version',
          v_provenance ->> 'compatibility_policy_version',
          v_provenance ->> 'table_policy_version',
          v_provenance ->> 'confidence_policy_version',
          v_provenance ->> 'selection_mark_policy_version',
          v_provenance ->> 'routing_policy_version',
          v_provenance ->> 'model_alias',
          v_provenance ->> 'page_identity_fingerprint',
          v_provenance ->> 'workspace_binding_fingerprint',
          v_provenance ->> 'job_binding_fingerprint',
          v_provenance ->> 'review_version'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if p_manifest ->> 'review_provenance_fingerprint'
    is distinct from v_provenance_fingerprint then
    raise exception 'Google review provenance fingerprint mismatch.' using errcode = '22023';
  end if;
  return encode(
    extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
end;
$$;

revoke execute on function public.validate_google_document_extraction_manifest_v3(
  jsonb, text, public.document_extraction_jobs
) from public, anon, authenticated, service_role;

alter table public.document_extraction_jobs
  drop constraint if exists document_extraction_jobs_review_provenance_v2_check;
alter table public.document_extraction_jobs
  add constraint document_extraction_jobs_review_provenance_v3_check check (
    (
      critical_field_manifest_json is null
      and review_provenance_fingerprint is null
    )
    or (
      critical_field_manifest_json ->> 'manifest_version'
        = 'document_extraction_critical_fields_v1'
      and review_provenance_fingerprint is null
    )
    or (
      critical_field_manifest_json ->> 'manifest_version'
        in ('document_extraction_critical_fields_v2', 'document_extraction_critical_fields_v3')
      and review_provenance_fingerprint is not null
      and critical_field_manifest_json ->> 'review_provenance_fingerprint'
        = review_provenance_fingerprint
    )
  ) not valid;

create or replace function public.enforce_document_extraction_job_review_provenance_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_manifest_fingerprint text;
begin
  if new.critical_field_manifest_json is null then
    if new.critical_field_manifest_fingerprint is not null
      or new.review_provenance_fingerprint is not null then
      raise exception 'Incomplete document-extraction manifest identity.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.critical_field_manifest_json ->> 'manifest_version'
    = 'document_extraction_critical_fields_v1' then
    if new.parser_revision = 'nemotron_parse_hosted_tool_call_rest_v2'
      or new.client_revision = 'vaeroex_nemotron_parse_rest_v2'
      or new.route in ('google_primary', 'google_fallback') then
      raise exception 'This provider requires a provenance-bound manifest.' using errcode = '23514';
    end if;
    if new.review_provenance_fingerprint is not null then
      raise exception 'Historical v1 manifests cannot be reclassified.' using errcode = '23514';
    end if;
    v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v1(
      new.critical_field_manifest_json,
      new.artifact_fingerprint,
      new.extraction_contract_version
    );
  elsif new.critical_field_manifest_json ->> 'manifest_version'
    = 'document_extraction_critical_fields_v2' then
    v_manifest_fingerprint := public.validate_document_extraction_critical_field_manifest_v2(
      new.critical_field_manifest_json,
      new.artifact_fingerprint,
      new.extraction_contract_version,
      new.workspace_id,
      new.id,
      new.cache_key,
      new.page_count,
      new.parser_model,
      new.parser_revision,
      new.client_revision,
      new.normalization_version,
      new.required_review_version
    );
    if new.review_provenance_fingerprint is distinct from
      new.critical_field_manifest_json ->> 'review_provenance_fingerprint' then
      raise exception 'Stored review provenance does not match the v2 manifest.' using errcode = '23514';
    end if;
  elsif new.critical_field_manifest_json ->> 'manifest_version'
    = 'document_extraction_critical_fields_v3' then
    v_manifest_fingerprint := public.validate_google_document_extraction_manifest_v3(
      new.critical_field_manifest_json,
      new.artifact_fingerprint,
      new
    );
    if new.review_provenance_fingerprint is distinct from
      new.critical_field_manifest_json ->> 'review_provenance_fingerprint' then
      raise exception 'Stored review provenance does not match the v3 manifest.' using errcode = '23514';
    end if;
  else
    raise exception 'Unsupported document-extraction manifest identity.' using errcode = '23514';
  end if;

  if new.critical_field_manifest_fingerprint is distinct from v_manifest_fingerprint then
    raise exception 'Stored critical-field manifest fingerprint is invalid.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_document_extraction_job_review_provenance_v2
  on public.document_extraction_jobs;
create trigger enforce_document_extraction_job_review_provenance_v2
  before insert or update of
    workspace_id, id, cache_key, page_count, parser_provider, parser_model,
    parser_revision, client_revision, provider_profile, processor_type,
    processor_id, processor_resource, processor_location, processor_version,
    endpoint_contract_version, request_serializer_version,
    response_validator_version, provider_normalization_version,
    compatibility_policy_version, table_policy_version,
    confidence_policy_version, selection_mark_policy_version,
    routing_policy_version, review_provenance_version, normalization_version,
    required_review_version, artifact_fingerprint,
    critical_field_manifest_json, critical_field_manifest_fingerprint,
    review_provenance_fingerprint
  on public.document_extraction_jobs
  for each row execute function public.enforce_document_extraction_job_review_provenance_v2();

create or replace function public.enforce_document_extraction_review_provenance_binding_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_request_provenance text;
  v_decision_mutation boolean;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = new.job_id and workspace_id = new.workspace_id;
  if v_job.id is null then
    raise exception 'Review job binding not found.' using errcode = '23503';
  end if;
  if v_job.review_provenance_fingerprint is null then
    if new.review_provenance_fingerprint is not null then
      raise exception 'Historical review provenance cannot be reclassified.' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_job.critical_field_manifest_json ->> 'manifest_version'
      not in ('document_extraction_critical_fields_v2', 'document_extraction_critical_fields_v3')
    or (
      new.review_provenance_fingerprint is not null
      and new.review_provenance_fingerprint is distinct from v_job.review_provenance_fingerprint
    ) then
    raise exception 'Review provenance does not match the extraction job.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    v_decision_mutation := true;
  else
    v_decision_mutation :=
      new.decision_summary_json is distinct from old.decision_summary_json
      or new.reviewer_id is distinct from old.reviewer_id
      or new.reviewed_at is distinct from old.reviewed_at;
  end if;
  if v_decision_mutation then
    v_request_provenance := nullif(
      current_setting('vaeroex.document_extraction_review_provenance', true),
      ''
    );
    if v_request_provenance is distinct from v_job.review_provenance_fingerprint then
      raise exception 'The review request is not bound to current extraction provenance.' using errcode = '22023';
    end if;
  end if;
  new.review_provenance_fingerprint := v_job.review_provenance_fingerprint;
  return new;
end;
$$;

drop trigger if exists enforce_document_extraction_review_provenance_binding_v2
  on public.document_extraction_reviews;
create trigger enforce_document_extraction_review_provenance_binding_v2
  before insert or update on public.document_extraction_reviews
  for each row execute function public.enforce_document_extraction_review_provenance_binding_v2();

revoke execute on function public.enforce_document_extraction_job_review_provenance_v2()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_document_extraction_review_provenance_binding_v2()
  from public, anon, authenticated, service_role;

create or replace function public.complete_google_document_extraction_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_artifact_fingerprint text,
  p_critical_field_manifest_json jsonb,
  p_payload_ciphertext bytea,
  p_encryption_key_version text,
  p_encryption_nonce bytea,
  p_authentication_tag bytea,
  p_aad_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_existing public.document_extraction_cache%rowtype;
  v_manifest_fingerprint text;
  v_provenance_fingerprint text;
  v_constraint text;
  v_field_count integer;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id
  for update;
  if v_job.id is null
    or v_job.status <> 'processing'
    or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now()
    or v_job.stage <> 'encrypting'
    or v_job.provider_result_class <> 'success'
    or v_job.provider_outcome_recorded_at is null
    or v_job.provider_call_count <> 1
    or v_job.retry_count <> 0
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job) then
    raise exception 'Google job is not ready for encrypted completion.' using errcode = '42501';
  end if;
  if public.document_extraction_runtime_reason_v2(
    v_job.workspace_id, v_job.document_class, 0
  ) <> 'eligible' then
    raise exception 'Google completion gate is disabled.' using errcode = '42501';
  end if;
  if p_artifact_fingerprint !~ '^[0-9a-f]{64}$'
    or p_payload_ciphertext is null
    or octet_length(p_payload_ciphertext) = 0
    or char_length(p_encryption_key_version) not between 1 and 120
    or octet_length(p_encryption_nonce) <> 12
    or octet_length(p_authentication_tag) <> 16
    or p_aad_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid encrypted Google completion.' using errcode = '22023';
  end if;
  v_manifest_fingerprint := public.validate_google_document_extraction_manifest_v3(
    p_critical_field_manifest_json,
    p_artifact_fingerprint,
    v_job
  );
  v_provenance_fingerprint :=
    p_critical_field_manifest_json ->> 'review_provenance_fingerprint';
  v_field_count := jsonb_array_length(p_critical_field_manifest_json -> 'fields');

  select * into v_existing
  from public.document_extraction_cache
  where workspace_id = v_job.workspace_id and cache_key = v_job.cache_key
  for update;
  if v_existing.id is not null and (
    v_existing.artifact_fingerprint <> p_artifact_fingerprint
    or v_existing.provider <> v_job.parser_provider
    or v_existing.model <> v_job.parser_model
    or v_existing.model_revision <> v_job.parser_revision
    or v_existing.client_revision <> v_job.client_revision
    or v_existing.provider_profile <> v_job.provider_profile
    or v_existing.processor_type <> v_job.processor_type
    or v_existing.processor_id <> v_job.processor_id
    or v_existing.processor_resource <> v_job.processor_resource
    or v_existing.processor_location <> v_job.processor_location
    or v_existing.processor_version <> v_job.processor_version
    or v_existing.endpoint_contract_version <> v_job.endpoint_contract_version
    or v_existing.request_serializer_version <> v_job.request_serializer_version
    or v_existing.response_validator_version <> v_job.response_validator_version
    or v_existing.provider_normalization_version <> v_job.provider_normalization_version
    or v_existing.compatibility_policy_version <> v_job.compatibility_policy_version
    or v_existing.table_policy_version <> v_job.table_policy_version
    or v_existing.confidence_policy_version <> v_job.confidence_policy_version
    or v_existing.selection_mark_policy_version <> v_job.selection_mark_policy_version
    or v_existing.routing_policy_version <> v_job.routing_policy_version
    or v_existing.review_provenance_version <> v_job.review_provenance_version
    or v_existing.extraction_contract_version <> v_job.extraction_contract_version
    or v_existing.normalization_version <> v_job.normalization_version
  ) then
    raise exception 'Google cache identity collision detected.' using errcode = '23505';
  end if;
  if v_existing.id is null then
    begin
      insert into public.document_extraction_cache (
        workspace_id, source_job_id, cache_key, content_hmac, provider, model,
        model_revision, client_revision, routing_policy_version,
        extraction_contract_version, normalization_version, payload_ciphertext,
        encryption_algorithm, encryption_key_version, encryption_nonce,
        authentication_tag, aad_digest, artifact_fingerprint, page_count,
        provider_profile, processor_type, processor_id, processor_resource,
        processor_location, processor_version, endpoint_contract_version,
        request_serializer_version, response_validator_version,
        provider_normalization_version, compatibility_policy_version,
        table_policy_version, confidence_policy_version,
        selection_mark_policy_version, review_provenance_version
      ) values (
        v_job.workspace_id, v_job.id, v_job.cache_key, v_job.content_hmac,
        v_job.parser_provider, v_job.parser_model, v_job.parser_revision,
        v_job.client_revision, v_job.routing_policy_version,
        v_job.extraction_contract_version, v_job.normalization_version,
        p_payload_ciphertext, 'aes-256-gcm', p_encryption_key_version,
        p_encryption_nonce, p_authentication_tag, p_aad_digest,
        p_artifact_fingerprint, v_job.page_count, v_job.provider_profile,
        v_job.processor_type, v_job.processor_id, v_job.processor_resource,
        v_job.processor_location, v_job.processor_version,
        v_job.endpoint_contract_version, v_job.request_serializer_version,
        v_job.response_validator_version, v_job.provider_normalization_version,
        v_job.compatibility_policy_version, v_job.table_policy_version,
        v_job.confidence_policy_version, v_job.selection_mark_policy_version,
        v_job.review_provenance_version
      );
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = CONSTRAINT_NAME;
        if v_constraint = 'document_extraction_cache_key_version_nonce_unique_idx' then
          return jsonb_build_object('completed', false, 'reason', 'nonce_collision');
        end if;
        raise;
    end;
  end if;

  update public.document_extraction_jobs
  set stage = 'awaiting_review', status = 'needs_review', approval_status = 'pending',
      artifact_fingerprint = p_artifact_fingerprint,
      classification_fingerprint = null,
      critical_field_manifest_json = p_critical_field_manifest_json,
      critical_field_manifest_fingerprint = v_manifest_fingerprint,
      review_provenance_fingerprint = v_provenance_fingerprint,
      validation_result = 'passed', encryption_result = 'encrypted',
      cache_result = 'stored', completed_at = now(),
      completion_worker_id = p_worker_id,
      lease_owner = null, lease_expires_at = null, heartbeat_at = null,
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;

  perform set_config(
    'vaeroex.document_extraction_review_provenance',
    v_provenance_fingerprint,
    true
  );
  insert into public.document_extraction_reviews (
    workspace_id, job_id, file_id, status, reviewer_id, reviewed_at,
    artifact_fingerprint, classification_fingerprint,
    extraction_contract_version, critical_field_manifest_fingerprint,
    review_version, critical_field_count, confirmed_field_count,
    corrected_field_count, rejected_field_count, unresolved_field_count,
    decision_summary_json, review_provenance_fingerprint
  ) values (
    v_job.workspace_id, v_job.id, v_job.file_id, 'pending', null, null,
    v_job.artifact_fingerprint, null, v_job.extraction_contract_version,
    v_job.critical_field_manifest_fingerprint, v_job.required_review_version,
    v_field_count, 0, 0, 0, v_field_count,
    jsonb_build_object('fields', '[]'::jsonb), v_provenance_fingerprint
  )
  on conflict (workspace_id, job_id, review_version) do nothing;
  perform set_config('vaeroex.document_extraction_review_provenance', '', true);

  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'google_extraction_completed', 'worker', null,
    v_job.stage, v_job.status, 'review_required', v_job.artifact_fingerprint,
    jsonb_build_object(
      'page_count', v_job.page_count,
      'critical_field_count', v_field_count,
      'manifest_fingerprint', v_manifest_fingerprint,
      'review_provenance_fingerprint', v_provenance_fingerprint,
      'provider_profile', v_job.provider_profile
    ),
    gen_random_uuid()
  );
  return jsonb_build_object(
    'completed', true, 'job_id', v_job.id, 'status', v_job.status,
    'approval_status', v_job.approval_status
  );
end;
$$;

revoke execute on function public.complete_google_document_extraction_job_v1(
  uuid, text, text, jsonb, bytea, text, bytea, bytea, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_google_document_extraction_job_v1(
  uuid, text, text, jsonb, bytea, text, bytea, bytea, text
) to service_role;

create or replace function public.mutate_document_extraction_review_v3(
  p_workspace_id uuid,
  p_job_id uuid,
  p_file_id uuid,
  p_action text,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_extraction_contract_version text,
  p_review_provenance_fingerprint text,
  p_review_version integer,
  p_decision_summary_json jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_job public.document_extraction_jobs%rowtype;
  v_review public.document_extraction_reviews%rowtype;
  v_manifest_field jsonb;
  v_decision jsonb;
  v_decision_fields jsonb;
  v_field_id text;
  v_decision_kind text;
  v_value_type text;
  v_corrected_value jsonb;
  v_seen_field_ids text[] := '{}'::text[];
  v_status text;
  v_critical_field_count integer;
  v_confirmed_field_count integer := 0;
  v_corrected_field_count integer := 0;
  v_rejected_field_count integer := 0;
  v_unresolved_field_count integer := 0;
begin
  if v_actor is null
    or not public.has_workspace_role(
      p_workspace_id, array['owner', 'admin', 'manager']
    ) then
    raise exception 'Only workspace leadership may review extracted fields.' using errcode = '42501';
  end if;
  if p_action is null
    or p_action not in ('save', 'approve', 'reject')
    or p_request_id is null then
    raise exception 'Unsupported review action.' using errcode = '22023';
  end if;
  if p_decision_summary_json is null
    or jsonb_typeof(p_decision_summary_json) <> 'object'
    or octet_length(p_decision_summary_json::text) > 32768
    or coalesce(jsonb_typeof(p_decision_summary_json -> 'fields') <> 'array', true)
    or exists (
      select 1 from jsonb_object_keys(p_decision_summary_json) key
      where key <> 'fields'
    ) then
    raise exception 'Invalid bounded review decision.' using errcode = '22023';
  end if;

  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;
  if v_job.id is null
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or not exists (
      select 1 from public.document_extraction_file_bindings binding
      where binding.workspace_id = p_workspace_id
        and binding.file_id = p_file_id
        and binding.job_id = p_job_id
    ) then
    raise exception 'Google extraction job and file binding not found.' using errcode = 'P0002';
  end if;
  if v_job.file_id <> p_file_id then
    raise exception 'Only the originating file can create the shared extraction review.' using errcode = '22023';
  end if;
  if v_job.status <> 'needs_review'
    or v_job.artifact_fingerprint is distinct from p_artifact_fingerprint
    or v_job.classification_fingerprint is distinct from p_classification_fingerprint
    or p_review_version is distinct from v_job.required_review_version
    or p_extraction_contract_version is distinct from v_job.extraction_contract_version
    or p_review_provenance_fingerprint !~ '^[0-9a-f]{64}$'
    or p_review_provenance_fingerprint is distinct from v_job.review_provenance_fingerprint
    or v_job.critical_field_manifest_json ->> 'manifest_version'
      is distinct from 'document_extraction_critical_fields_v3'
    or public.validate_google_document_extraction_manifest_v3(
      v_job.critical_field_manifest_json,
      p_artifact_fingerprint,
      v_job
    ) is distinct from v_job.critical_field_manifest_fingerprint then
    raise exception 'Google review identity is stale or invalid.' using errcode = '22023';
  end if;

  v_decision_fields := p_decision_summary_json -> 'fields';
  v_critical_field_count := jsonb_array_length(
    v_job.critical_field_manifest_json -> 'fields'
  );
  if jsonb_array_length(v_decision_fields) <> v_critical_field_count then
    raise exception 'Exactly one decision is required for every critical field.' using errcode = '22023';
  end if;
  for v_decision in select value from jsonb_array_elements(v_decision_fields) loop
    if jsonb_typeof(v_decision) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_decision) key
        where key not in ('field_id', 'decision', 'corrected_value', 'reason_code')
      )
      or not (v_decision ? 'field_id')
      or not (v_decision ? 'decision') then
      raise exception 'Malformed critical-field decision.' using errcode = '22023';
    end if;
    v_field_id := v_decision ->> 'field_id';
    v_decision_kind := v_decision ->> 'decision';
    if v_field_id is null
      or v_field_id = any(v_seen_field_ids)
      or v_decision_kind is null
      or v_decision_kind not in ('confirmed', 'corrected', 'rejected', 'unresolved') then
      raise exception 'Duplicate or invalid critical-field decision.' using errcode = '22023';
    end if;
    select value into v_manifest_field
    from jsonb_array_elements(v_job.critical_field_manifest_json -> 'fields')
    where value ->> 'id' = v_field_id;
    if v_manifest_field is null then
      raise exception 'Review decision references an unknown critical field.' using errcode = '22023';
    end if;
    if v_decision ? 'reason_code' and (
      jsonb_typeof(v_decision -> 'reason_code') <> 'string'
      or v_decision ->> 'reason_code' !~ '^[a-z0-9_:-]{1,100}$'
    ) then
      raise exception 'Invalid bounded review reason.' using errcode = '22023';
    end if;
    if v_decision_kind = 'corrected' then
      if not (v_decision ? 'corrected_value') then
        raise exception 'Corrected decisions require a corrected value.' using errcode = '22023';
      end if;
      v_corrected_value := v_decision -> 'corrected_value';
      v_value_type := v_manifest_field ->> 'value_type';
      if v_value_type = 'string' then
        if jsonb_typeof(v_corrected_value) <> 'string'
          or char_length(v_corrected_value #>> '{}') not between 1 and 1000
          or v_corrected_value #>> '{}' ~ '[[:cntrl:]]' then
          raise exception 'Malformed corrected string value.' using errcode = '22023';
        end if;
      elsif v_value_type = 'number' then
        if jsonb_typeof(v_corrected_value) <> 'number'
          or abs((v_corrected_value #>> '{}')::numeric) > 1000000000000000 then
          raise exception 'Malformed corrected numeric value.' using errcode = '22023';
        end if;
        if v_manifest_field ->> 'kind' = 'page' and (
          (v_corrected_value #>> '{}')::numeric
            <> trunc((v_corrected_value #>> '{}')::numeric)
          or (v_corrected_value #>> '{}')::numeric not between 1 and v_job.page_count
        ) then
          raise exception 'Corrected page is outside the authoritative document.' using errcode = '22023';
        end if;
      elsif v_value_type = 'boolean' then
        if jsonb_typeof(v_corrected_value) <> 'boolean' then
          raise exception 'Malformed corrected boolean value.' using errcode = '22023';
        end if;
      elsif v_value_type = 'coordinates' then
        if jsonb_typeof(v_corrected_value) <> 'object'
          or (select count(*) from jsonb_object_keys(v_corrected_value)) <> 5
          or exists (
            select 1 from jsonb_object_keys(v_corrected_value) key
            where key not in ('page', 'x', 'y', 'width', 'height')
          )
          or exists (
            select 1 from jsonb_each(v_corrected_value) item
            where jsonb_typeof(item.value) <> 'number'
          )
          or (v_corrected_value ->> 'page')::numeric
            <> trunc((v_corrected_value ->> 'page')::numeric)
          or (v_corrected_value ->> 'page')::numeric not between 1 and v_job.page_count
          or (v_corrected_value ->> 'x')::numeric < 0
          or (v_corrected_value ->> 'y')::numeric < 0
          or (v_corrected_value ->> 'width')::numeric <= 0
          or (v_corrected_value ->> 'height')::numeric <= 0
          or greatest(
            (v_corrected_value ->> 'x')::numeric,
            (v_corrected_value ->> 'y')::numeric,
            (v_corrected_value ->> 'width')::numeric,
            (v_corrected_value ->> 'height')::numeric
          ) > 100000 then
          raise exception 'Malformed corrected source coordinates.' using errcode = '22023';
        end if;
      else
        raise exception 'Unsupported corrected value type.' using errcode = '22023';
      end if;
      v_corrected_field_count := v_corrected_field_count + 1;
    else
      if v_decision ? 'corrected_value' then
        raise exception 'Only corrected decisions may include a corrected value.' using errcode = '22023';
      end if;
      if v_decision_kind = 'confirmed' then
        v_confirmed_field_count := v_confirmed_field_count + 1;
      elsif v_decision_kind = 'rejected' then
        v_rejected_field_count := v_rejected_field_count + 1;
      else
        v_unresolved_field_count := v_unresolved_field_count + 1;
      end if;
    end if;
    v_seen_field_ids := array_append(v_seen_field_ids, v_field_id);
  end loop;

  if p_action = 'approve' then
    if v_rejected_field_count > 0
      or v_unresolved_field_count > 0
      or p_classification_fingerprint is null
      or not exists (
        select 1 from public.document_extraction_cache cache
        where cache.workspace_id = p_workspace_id
          and cache.source_job_id = p_job_id
          and cache.artifact_fingerprint = p_artifact_fingerprint
          and cache.provider = 'google_document_ai'
          and cache.provider_profile = 'google_document_ai_enterprise_ocr_v1'
          and cache.processor_resource = v_job.processor_resource
          and cache.invalidated_at is null
      ) then
      raise exception 'All critical fields and fingerprints must be resolved before approval.' using errcode = '22023';
    end if;
    v_status := case
      when v_corrected_field_count > 0 then 'approved_with_corrections'
      else 'approved'
    end;
  elsif p_action = 'reject' then
    if v_rejected_field_count = 0 then
      raise exception 'A rejected review requires at least one rejected field.' using errcode = '22023';
    end if;
    v_status := 'rejected';
  else
    v_status := case
      when v_unresolved_field_count > 0 then 'unresolved'
      else 'in_review'
    end;
  end if;

  perform set_config(
    'vaeroex.document_extraction_review_provenance',
    p_review_provenance_fingerprint,
    true
  );
  insert into public.document_extraction_reviews (
    workspace_id, job_id, file_id, status, reviewer_id, reviewed_at,
    artifact_fingerprint, classification_fingerprint,
    extraction_contract_version, critical_field_manifest_fingerprint,
    review_version, critical_field_count, confirmed_field_count,
    corrected_field_count, rejected_field_count, unresolved_field_count,
    decision_summary_json, review_provenance_fingerprint
  ) values (
    p_workspace_id, p_job_id, p_file_id, v_status, v_actor,
    case when v_status in (
      'approved', 'approved_with_corrections', 'rejected'
    ) then now() else null end,
    p_artifact_fingerprint, p_classification_fingerprint,
    p_extraction_contract_version, v_job.critical_field_manifest_fingerprint,
    p_review_version, v_critical_field_count, v_confirmed_field_count,
    v_corrected_field_count, v_rejected_field_count,
    v_unresolved_field_count, p_decision_summary_json,
    p_review_provenance_fingerprint
  )
  on conflict (workspace_id, job_id, review_version) do update
  set file_id = excluded.file_id,
      status = excluded.status,
      reviewer_id = excluded.reviewer_id,
      reviewed_at = excluded.reviewed_at,
      artifact_fingerprint = excluded.artifact_fingerprint,
      classification_fingerprint = excluded.classification_fingerprint,
      extraction_contract_version = excluded.extraction_contract_version,
      critical_field_manifest_fingerprint = excluded.critical_field_manifest_fingerprint,
      critical_field_count = excluded.critical_field_count,
      confirmed_field_count = excluded.confirmed_field_count,
      corrected_field_count = excluded.corrected_field_count,
      rejected_field_count = excluded.rejected_field_count,
      unresolved_field_count = excluded.unresolved_field_count,
      decision_summary_json = excluded.decision_summary_json,
      review_provenance_fingerprint = excluded.review_provenance_fingerprint,
      updated_at = now()
  returning * into v_review;
  perform set_config('vaeroex.document_extraction_review_provenance', '', true);

  update public.document_extraction_jobs
  set approval_status = v_status,
      status = case
        when v_status in ('approved', 'approved_with_corrections') then 'completed'
        else status
      end,
      stage = case
        when v_status in ('approved', 'approved_with_corrections') then 'terminal'
        else 'awaiting_review'
      end,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    p_workspace_id, p_job_id,
    case
      when v_status in ('approved', 'approved_with_corrections') then 'review_approved'
      else 'review_updated'
    end,
    'user', v_actor, v_job.stage, v_job.status, v_status,
    p_artifact_fingerprint,
    jsonb_build_object(
      'review_id', v_review.id,
      'review_version', p_review_version,
      'critical_fields', v_critical_field_count,
      'confirmed_fields', v_confirmed_field_count,
      'corrected_fields', v_corrected_field_count,
      'rejected_fields', v_rejected_field_count,
      'unresolved_fields', v_unresolved_field_count,
      'manifest_fingerprint', v_job.critical_field_manifest_fingerprint,
      'provider_profile', v_job.provider_profile
    ),
    p_request_id
  );
  return jsonb_build_object(
    'review_id', v_review.id,
    'job_id', p_job_id,
    'status', v_status,
    'critical_field_count', v_critical_field_count,
    'confirmed_field_count', v_confirmed_field_count,
    'corrected_field_count', v_corrected_field_count,
    'rejected_field_count', v_rejected_field_count,
    'unresolved_field_count', v_unresolved_field_count
  );
end;
$$;

revoke execute on function public.mutate_document_extraction_review_v3(
  uuid, uuid, uuid, text, text, text, text, text, integer, jsonb, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.mutate_document_extraction_review_v3(
  uuid, uuid, uuid, text, text, text, text, text, integer, jsonb, uuid
) to authenticated;

create or replace function public.document_extraction_authority_is_approved_v1(
  p_workspace_id uuid,
  p_file_id uuid,
  p_job_id uuid,
  p_review_id uuid,
  p_artifact_fingerprint text,
  p_classification_fingerprint text,
  p_review_version integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_extraction_jobs job
    join public.document_extraction_file_bindings binding
      on binding.workspace_id = job.workspace_id
      and binding.job_id = job.id
      and binding.file_id = p_file_id
      and binding.is_current
    join public.document_extraction_reviews review
      on review.workspace_id = job.workspace_id
      and review.job_id = job.id
      and review.id = p_review_id
    join public.document_extraction_cache cache
      on cache.workspace_id = job.workspace_id
      and cache.source_job_id = job.id
      and cache.cache_key = job.cache_key
    join public.document_extraction_workspace_settings settings
      on settings.workspace_id = job.workspace_id
    where job.workspace_id = p_workspace_id
      and job.id = p_job_id
      and job.status = 'completed'
      and job.approval_status in ('approved', 'approved_with_corrections')
      and job.artifact_fingerprint = p_artifact_fingerprint
      and job.classification_fingerprint = p_classification_fingerprint
      and review.file_id = job.file_id
      and review.status in ('approved', 'approved_with_corrections')
      and review.review_version = p_review_version
      and review.review_version = job.required_review_version
      and review.extraction_contract_version = job.extraction_contract_version
      and review.critical_field_manifest_fingerprint
        = job.critical_field_manifest_fingerprint
      and (
        (
          job.review_provenance_fingerprint is null
          and review.review_provenance_fingerprint is null
          and job.critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v1'
        )
        or (
          job.review_provenance_fingerprint is not null
          and review.review_provenance_fingerprint
            = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'review_provenance_fingerprint'
            = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v2'
        )
        or (
          job.review_provenance_fingerprint is not null
          and review.review_provenance_fingerprint
            = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'review_provenance_fingerprint'
            = job.review_provenance_fingerprint
          and job.critical_field_manifest_json ->> 'manifest_version'
            = 'document_extraction_critical_fields_v3'
          and public.document_extraction_google_job_identity_is_exact_v1(job)
          and cache.provider = 'google_document_ai'
          and cache.provider_profile = job.provider_profile
          and cache.processor_id = job.processor_id
          and cache.processor_resource = job.processor_resource
          and cache.review_provenance_version = job.review_provenance_version
        )
      )
      and review.artifact_fingerprint = p_artifact_fingerprint
      and review.classification_fingerprint = p_classification_fingerprint
      and review.unresolved_field_count = 0
      and review.rejected_field_count = 0
      and review.critical_field_count
        = jsonb_array_length(job.critical_field_manifest_json -> 'fields')
      and cache.invalidated_at is null
      and cache.artifact_fingerprint = p_artifact_fingerprint
      and job.document_class = any(settings.allowed_document_classes)
  );
$$;

comment on function public.document_extraction_authority_is_approved_v1(
  uuid, uuid, uuid, uuid, text, text, integer
) is
  'Preserves historical V1/V2 approval semantics and admits Google V3 only after exact provenance, cache, classification, and leadership review binding.';

create or replace function public.record_google_document_extraction_telemetry_v1(
  p_job_id uuid,
  p_worker_id text,
  p_request_id uuid,
  p_job_id_hash text,
  p_workspace_hash text,
  p_latency_ms integer,
  p_validation_result text,
  p_encryption_result text,
  p_cache_result text,
  p_cost_rate_version text,
  p_cost_amount_usd numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.document_extraction_jobs%rowtype;
  v_state public.document_extraction_system_state%rowtype;
  v_id uuid;
begin
  select * into v_job
  from public.document_extraction_jobs
  where id = p_job_id;
  if v_job.id is null
    or not public.document_extraction_google_job_identity_is_exact_v1(v_job)
    or p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$'
    or (
      (
        v_job.status = 'processing'
        and v_job.lease_owner is distinct from p_worker_id
      )
      or (
        v_job.status in ('needs_review', 'failed', 'dispatch_unknown')
        and v_job.completion_worker_id is distinct from p_worker_id
      )
      or v_job.status not in (
        'processing', 'needs_review', 'failed', 'dispatch_unknown'
      )
    )
    or p_job_id_hash !~ '^[0-9a-f]{64}$'
    or p_workspace_hash !~ '^[0-9a-f]{64}$'
    or (p_cost_rate_version is null) <> (p_cost_amount_usd is null)
    or v_job.provider_call_count not between 0 and 1
    or v_job.retry_count <> 0 then
    raise exception 'Google telemetry does not match the bounded job context.' using errcode = '42501';
  end if;
  select * into v_state
  from public.document_extraction_system_state
  where singleton_key = 'document_intelligence';
  insert into public.document_extraction_operational_telemetry (
    request_id, telemetry_version, job_id_hash, workspace_hash, parser_route,
    document_class, pages_qualified, pages_dispatched, provider_calls,
    retry_count, latency_ms, provider_result_class, validation_result,
    encryption_result, cache_result, circuit_state, quota_pages_reserved,
    quota_pages_consumed, model_revision, client_revision,
    cost_rate_version, cost_amount_usd, parser_provider, provider_profile,
    processor_type, processor_id, processor_resource, processor_location,
    processor_version, endpoint_contract_version, request_serializer_version,
    response_validator_version, provider_normalization_version,
    routing_policy_version, review_provenance_version,
    compatibility_policy_version
  ) values (
    p_request_id, 'document_extraction_telemetry_v1', p_job_id_hash,
    p_workspace_hash, v_job.route, v_job.document_class,
    v_job.pages_qualified,
    case when v_job.provider_dispatched_at is null then 0 else v_job.billed_page_count end,
    v_job.provider_call_count, 0, p_latency_ms, v_job.provider_result_class,
    p_validation_result, p_encryption_result, p_cache_result,
    v_state.circuit_state, v_job.reserved_page_count, v_job.billed_page_count,
    v_job.parser_revision, v_job.client_revision, p_cost_rate_version,
    p_cost_amount_usd, v_job.parser_provider, v_job.provider_profile,
    v_job.processor_type, v_job.processor_id, v_job.processor_resource,
    v_job.processor_location, v_job.processor_version,
    v_job.endpoint_contract_version, v_job.request_serializer_version,
    v_job.response_validator_version, v_job.provider_normalization_version,
    v_job.routing_policy_version, v_job.review_provenance_version,
    v_job.compatibility_policy_version
  )
  on conflict (request_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id
    from public.document_extraction_operational_telemetry
    where request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.record_google_document_extraction_telemetry_v1(
  uuid, text, uuid, text, text, integer, text, text, text, text, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.record_google_document_extraction_telemetry_v1(
  uuid, text, uuid, text, text, integer, text, text, text, text, numeric
) to service_role;

comment on function public.record_google_document_extraction_telemetry_v1(
  uuid, text, uuid, text, text, integer, text, text, text, text, numeric
) is
  'Records only content-free telemetry bound to the exact Google OCR profile; it grants no document authority.';
