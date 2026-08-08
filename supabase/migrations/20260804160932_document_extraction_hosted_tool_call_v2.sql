-- Document Extraction hosted tool-call compatibility contract v2
--
-- This forward-only migration advances the exact worker identities admitted by
-- claim and dispatch. It creates no data, enables no switch, and changes no
-- review, evidence, Business Memory, KPI, or deterministic authority behavior.

create or replace function public.claim_document_extraction_job_v2(
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
  if p_worker_id !~ '^[A-Za-z0-9._:-]{1,128}$' or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid private-worker lease request.' using errcode = '22023';
  end if;

  with ambiguous as (
    update public.document_extraction_jobs job
    set status = 'dispatch_unknown', stage = 'terminal', lease_owner = null,
        lease_expires_at = null, heartbeat_at = null,
        failure_code = 'lease_expired_after_dispatch', failure_class = 'ambiguous_dispatch',
        provider_result_class = coalesce(provider_result_class, 'ambiguous_dispatch'),
        provider_outcome_recorded_at = coalesce(provider_outcome_recorded_at, now()),
        failed_at = now(), updated_at = now()
    where job.status = 'processing'
      and job.lease_expires_at <= now()
      and job.provider_dispatched_at is not null
    returning job.*
  )
  insert into public.document_extraction_events (
    workspace_id, job_id, event_type, actor_type, stage, status,
    reason_code, metadata_json, request_id
  )
  select workspace_id, id, 'dispatch_became_ambiguous', 'system', stage, status,
    failure_code, '{}'::jsonb, gen_random_uuid()
  from ambiguous;

  select job.* into v_job
  from public.document_extraction_jobs job
  join public.document_extraction_intake_requests intake on intake.id = job.intake_request_id
  where (
      job.status = 'queued'
      or (
        job.status = 'processing'
        and job.lease_expires_at <= now()
        and job.provider_dispatched_at is null
      )
    )
    and job.route in ('nvidia_primary', 'nvidia_fallback')
    and job.review_required
    and job.attempts < job.max_attempts
    and job.page_count between 1 and 16
    and intake.file_size_bytes between 1 and 25000000
    and job.parser_provider = 'nvidia'
    and job.parser_model = 'nvidia/nemotron-parse'
    and job.parser_revision = 'nemotron_parse_hosted_tool_call_rest_v2'
    and job.client_revision = 'vaeroex_nemotron_parse_rest_v2'
    and job.extraction_contract_version = 'document_extraction_artifact_v1'
    and job.normalization_version = 'document_extraction_normalization_v1'
    and public.document_extraction_runtime_reason_v1(job.workspace_id, job.document_class, 0) = 'eligible'
  order by job.created_at
  for update of job skip locked
  limit 1;

  if v_job.id is null then return; end if;
  update public.document_extraction_jobs
  set status = 'processing', stage = 'leased', attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(), started_at = coalesce(started_at, now()),
      broker_protocol_version = 'document_extraction_broker_v2',
      worker_runtime_version = 'document_extraction_worker_v2',
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id
  returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'job_claimed', 'worker', null, v_job.stage,
    v_job.status, null, null,
    jsonb_build_object('attempt', v_job.attempts, 'broker_protocol', v_job.broker_protocol_version),
    gen_random_uuid()
  );
  return next v_job;
end;
$$;

revoke execute on function public.claim_document_extraction_job_v2(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_document_extraction_job_v2(text, integer)
  to service_role;

comment on function public.claim_document_extraction_job_v2(text, integer) is
  'Claims one gated job matching the versioned hosted tool-call v2 compatibility contract.';

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
    or v_job.parser_revision <> 'nemotron_parse_hosted_tool_call_rest_v2'
    or v_job.client_revision <> 'vaeroex_nemotron_parse_rest_v2'
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
  'Single-use dispatch claim for the versioned hosted tool-call v2 compatibility contract.';
