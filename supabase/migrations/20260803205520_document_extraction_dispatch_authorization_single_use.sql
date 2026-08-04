-- Document Extraction Phase B dispatch authorization replay guard
--
-- Provider dispatch authorization is a single-use generation boundary. If the
-- committing response is lost, replay fails closed and the existing lease
-- eventually follows the documented ambiguous-dispatch recovery path. Returning
-- authorized=true on replay could allow two callers to invoke the provider.

create or replace function public.authorize_document_extraction_dispatch_v2(
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
    or v_job.lease_expires_at <= now() then
    raise exception 'The job is not dispatchable by this lease.' using errcode = '42501';
  end if;

  v_reason := public.document_extraction_runtime_reason_v1(
    v_job.workspace_id,
    v_job.document_class,
    0
  );
  if v_reason <> 'eligible' then
    return jsonb_build_object(
      'authorized', false,
      'reason', v_reason,
      'idempotent', false
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
    or v_job.route not in ('nvidia_primary', 'nvidia_fallback')
    or v_job.parser_provider <> 'nvidia'
    or v_job.parser_model <> 'nvidia/nemotron-parse'
    or v_job.parser_revision <> 'nemo_retriever_multimodal_extraction_v1'
    or v_job.client_revision <> '52886112cafab4c4bca1cda0d4f588785adfe4d3'
    or v_job.page_count > 16 then
    raise exception 'The job does not match the approved provider contract.' using errcode = '42501';
  end if;

  update public.document_extraction_workspace_settings
  set pages_reserved = greatest(0, pages_reserved - v_job.reserved_page_count),
      pages_consumed = pages_consumed + v_job.reserved_page_count,
      updated_at = now()
  where workspace_id = v_job.workspace_id;

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
    v_job.workspace_id,
    v_job.id,
    'provider_dispatch_authorized',
    'worker',
    null,
    v_job.stage,
    v_job.status,
    null,
    null,
    jsonb_build_object(
      'billed_pages', v_job.billed_page_count,
      'provider_call', 1
    ),
    p_dispatch_request_id
  );

  return jsonb_build_object(
    'authorized', true,
    'reason', 'eligible',
    'idempotent', false
  );
end;
$$;

revoke execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid)
  to service_role;

comment on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid) is
  'Single-use provider dispatch claim. Replays fail closed without authorizing another provider call.';
