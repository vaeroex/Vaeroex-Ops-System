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
  add column if not exists selection_mark_policy_version text;

alter table public.document_extraction_cache
  add column if not exists provider_profile text,
  add column if not exists processor_type text,
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
  add column if not exists selection_mark_policy_version text;

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
      and processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
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
      and extraction_contract_version = 'document_extraction_artifact_v2'
      and normalization_version = 'document_extraction_normalization_v2'
      and page_count between 1 and 15
      and max_attempts = 1
      and review_required
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
      and processor_resource ~ '^projects/[1-9][0-9]{5,20}/locations/us/processors/[a-f0-9]{8,64}/processorVersions/pretrained-ocr-v2[.]1-2024-08-07$'
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
      and extraction_contract_version = 'document_extraction_artifact_v2'
      and normalization_version = 'document_extraction_normalization_v2'
      and page_count between 1 and 15
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
