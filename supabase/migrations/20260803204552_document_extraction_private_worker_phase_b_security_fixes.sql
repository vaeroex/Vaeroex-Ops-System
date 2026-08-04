-- Document Extraction Private Worker - Phase B security corrections
--
-- Canonical migrations execute once through the Supabase migration ledger. This
-- corrective migration is also safe to replay manually: every schema object is
-- replaced or created idempotently, and it never enables execution, entitles a
-- workspace, enqueues work, or rewrites customer data.

alter table public.document_extraction_events
  drop constraint if exists document_extraction_events_stage_check;
alter table public.document_extraction_events
  add constraint document_extraction_events_stage_check check (stage is null or stage in (
    'queued', 'leased', 'preparing', 'dispatching', 'provider_dispatched',
    'extracting', 'normalizing', 'validating', 'encrypting',
    'awaiting_review', 'classifying', 'promoting', 'terminal'
  ));

alter table public.document_extraction_system_state
  add column if not exists failure_window_reset_at timestamptz not null default now();

create table if not exists public.document_extraction_provider_outcomes (
  outcome_sequence bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.document_extraction_jobs(id) on delete restrict,
  dispatch_request_id uuid not null unique,
  result_class text not null check (result_class in (
    'success', 'transport', 'timeout', 'rate_limit', 'provider',
    'malformed_output', 'validation', 'ambiguous_dispatch'
  )),
  latency_ms integer not null check (latency_ms between 0 and 180000),
  recorded_at timestamptz not null default now()
);

create index if not exists document_extraction_provider_outcomes_window_idx
  on public.document_extraction_provider_outcomes(recorded_at desc, outcome_sequence desc)
  where result_class <> 'success';
create index if not exists document_extraction_provider_outcomes_job_idx
  on public.document_extraction_provider_outcomes(job_id, outcome_sequence desc);

create table if not exists public.document_extraction_circuit_events (
  id uuid primary key default gen_random_uuid(),
  previous_state text not null check (previous_state in ('closed', 'open', 'half_open')),
  next_state text not null check (next_state in ('closed', 'open', 'half_open')),
  trigger_kind text not null check (trigger_kind in (
    'provider_threshold', 'ambiguous_dispatch', 'operator'
  )),
  reason_code text not null check (reason_code ~ '^[a-z0-9._:-]{1,100}$'),
  actor_id uuid references public.profiles(id) on delete set null,
  consecutive_failures integer not null check (consecutive_failures >= 0),
  rolling_failure_count integer not null check (rolling_failure_count >= 0),
  created_at timestamptz not null default now()
);

create or replace function public.prevent_document_extraction_private_ledger_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then return old; end if;
  raise exception 'Document extraction security ledgers are append-only.' using errcode = '42501';
end;
$$;

drop trigger if exists prevent_document_extraction_provider_outcome_mutation
  on public.document_extraction_provider_outcomes;
create trigger prevent_document_extraction_provider_outcome_mutation
  before update or delete on public.document_extraction_provider_outcomes
  for each row execute function public.prevent_document_extraction_private_ledger_mutation_v1();

drop trigger if exists prevent_document_extraction_circuit_event_mutation
  on public.document_extraction_circuit_events;
create trigger prevent_document_extraction_circuit_event_mutation
  before update or delete on public.document_extraction_circuit_events
  for each row execute function public.prevent_document_extraction_private_ledger_mutation_v1();

create unique index if not exists document_extraction_cache_key_version_nonce_unique_idx
  on public.document_extraction_cache(encryption_key_version, encryption_nonce);

create or replace function public.recompute_document_extraction_circuit_v2(
  p_trigger_result_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.document_extraction_system_state%rowtype;
  v_previous_state text;
  v_latest_success_sequence bigint;
  v_consecutive integer := 0;
  v_rolling integer := 0;
  v_window_started_at timestamptz;
  v_open boolean := false;
  v_reason text;
begin
  select * into v_state
  from public.document_extraction_system_state
  where singleton_key = 'document_intelligence'
  for update;
  if v_state.singleton_key is null then
    raise exception 'Document extraction system state is unavailable.' using errcode = '55000';
  end if;

  select max(outcome_sequence) into v_latest_success_sequence
  from public.document_extraction_provider_outcomes
  where result_class = 'success'
    and recorded_at >= v_state.failure_window_reset_at;

  select count(*)::integer into v_consecutive
  from public.document_extraction_provider_outcomes
  where result_class <> 'success'
    and recorded_at >= v_state.failure_window_reset_at
    and outcome_sequence > coalesce(v_latest_success_sequence, 0);

  select count(*)::integer, min(recorded_at)
  into v_rolling, v_window_started_at
  from public.document_extraction_provider_outcomes
  where result_class <> 'success'
    and recorded_at >= greatest(v_state.failure_window_reset_at, now() - interval '10 minutes');

  v_open := p_trigger_result_class = 'ambiguous_dispatch'
    or v_consecutive >= 3
    or v_rolling >= 5;
  v_reason := case
    when p_trigger_result_class = 'ambiguous_dispatch' then 'ambiguous_dispatch'
    else 'provider_failure_threshold'
  end;
  v_previous_state := v_state.circuit_state;

  update public.document_extraction_system_state
  set consecutive_failures = v_consecutive,
      rolling_failure_count = v_rolling,
      failure_window_started_at = v_window_started_at,
      last_provider_result_at = now(),
      circuit_state = case when v_open then 'open' else circuit_state end,
      circuit_opened_at = case
        when v_open then coalesce(circuit_opened_at, now())
        else circuit_opened_at
      end,
      circuit_reason_code = case when v_open then v_reason else circuit_reason_code end,
      updated_at = now()
  where singleton_key = 'document_intelligence'
  returning * into v_state;

  if v_open and v_previous_state <> 'open' then
    insert into public.document_extraction_circuit_events (
      previous_state, next_state, trigger_kind, reason_code,
      consecutive_failures, rolling_failure_count
    ) values (
      v_previous_state,
      'open',
      case when p_trigger_result_class = 'ambiguous_dispatch'
        then 'ambiguous_dispatch'
        else 'provider_threshold'
      end,
      v_reason,
      v_consecutive,
      v_rolling
    );
  end if;

  return jsonb_build_object(
    'circuit_state', v_state.circuit_state,
    'consecutive_failures', v_consecutive,
    'rolling_failure_count', v_rolling,
    'opened', v_open and v_previous_state <> 'open'
  );
end;
$$;

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
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() then
    raise exception 'The job is not dispatchable by this lease.' using errcode = '42501';
  end if;

  -- Re-evaluate the database kill switches before both first-use and idempotent
  -- authorization. A prior authorization is not permission to call a provider
  -- after the circuit or any runtime gate has been disabled.
  v_reason := public.document_extraction_runtime_reason_v1(v_job.workspace_id, v_job.document_class, 0);
  if v_reason <> 'eligible' then
    return jsonb_build_object('authorized', false, 'reason', v_reason, 'idempotent', false);
  end if;

  if v_job.stage = 'provider_dispatched' and v_job.dispatch_request_id = p_dispatch_request_id then
    return jsonb_build_object('authorized', true, 'reason', 'eligible', 'idempotent', true);
  end if;
  if v_job.stage <> 'dispatching' or v_job.provider_dispatched_at is not null
    or v_job.dispatch_request_id is not null or v_job.provider_call_count <> 0
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
  set stage = 'provider_dispatched', provider_dispatched_at = now(),
      dispatch_request_id = p_dispatch_request_id, provider_call_count = 1,
      billed_page_count = reserved_page_count, reserved_page_count = 0,
      last_stage_transition_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;
  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'provider_dispatch_authorized', 'worker', null,
    v_job.stage, v_job.status, null, null,
    jsonb_build_object('billed_pages', v_job.billed_page_count, 'provider_call', 1),
    p_dispatch_request_id
  );
  return jsonb_build_object('authorized', true, 'reason', 'eligible', 'idempotent', false);
end;
$$;

create or replace function public.record_document_extraction_provider_outcome_v1(
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
  v_existing public.document_extraction_provider_outcomes%rowtype;
  v_circuit jsonb;
begin
  if p_result_class not in (
    'success', 'transport', 'timeout', 'rate_limit', 'provider',
    'malformed_output', 'validation', 'ambiguous_dispatch'
  ) or p_latency_ms not between 0 and 180000 then
    raise exception 'Invalid provider outcome.' using errcode = '22023';
  end if;

  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage <> 'provider_dispatched'
    or v_job.dispatch_request_id <> p_dispatch_request_id then
    raise exception 'Provider outcome does not match the active dispatch.' using errcode = '42501';
  end if;

  select * into v_existing
  from public.document_extraction_provider_outcomes
  where dispatch_request_id = p_dispatch_request_id;
  if v_existing.outcome_sequence is not null then
    if v_existing.job_id = p_job_id
      and v_existing.result_class = p_result_class
      and v_existing.latency_ms = p_latency_ms then
      select jsonb_build_object(
        'circuit_state', circuit_state,
        'consecutive_failures', consecutive_failures,
        'rolling_failure_count', rolling_failure_count
      ) into v_circuit
      from public.document_extraction_system_state
      where singleton_key = 'document_intelligence';
      return jsonb_build_object(
        'recorded', true,
        'idempotent', true,
        'circuit_state', v_circuit ->> 'circuit_state',
        'retry_permitted', p_result_class in ('transport', 'timeout', 'rate_limit')
          and v_job.retry_count < 1
          and v_circuit ->> 'circuit_state' <> 'open'
      );
    end if;
    raise exception 'Provider outcome was already recorded differently.' using errcode = '23505';
  end if;

  insert into public.document_extraction_provider_outcomes (
    workspace_id, job_id, dispatch_request_id, result_class, latency_ms
  ) values (
    v_job.workspace_id, v_job.id, p_dispatch_request_id, p_result_class, p_latency_ms
  );
  update public.document_extraction_jobs
  set provider_result_class = p_result_class,
      provider_latency_ms = p_latency_ms,
      provider_outcome_recorded_at = now(),
      updated_at = now()
  where id = v_job.id returning * into v_job;

  if p_result_class = 'success' then
    update public.document_extraction_system_state
    set provider_success_count = provider_success_count + 1
    where singleton_key = 'document_intelligence';
  end if;
  v_circuit := public.recompute_document_extraction_circuit_v2(p_result_class);

  perform public.record_document_extraction_event_v1(
    v_job.workspace_id, v_job.id, 'provider_outcome_recorded', 'worker', null,
    v_job.stage, v_job.status,
    case when p_result_class = 'success' then null else p_result_class end,
    null,
    jsonb_build_object(
      'result_class', p_result_class,
      'circuit_state', v_circuit ->> 'circuit_state'
    ),
    gen_random_uuid()
  );

  if coalesce((v_circuit ->> 'opened')::boolean, false) then
    perform public.record_document_extraction_event_v1(
      v_job.workspace_id, v_job.id, 'provider_circuit_opened', 'system', null,
      v_job.stage, v_job.status,
      case when p_result_class = 'ambiguous_dispatch'
        then 'ambiguous_dispatch'
        else 'provider_failure_threshold'
      end,
      null,
      jsonb_build_object('circuit_policy_version', 'document_extraction_circuit_v1'),
      gen_random_uuid()
    );
  end if;

  return jsonb_build_object(
    'recorded', true,
    'idempotent', false,
    'circuit_state', v_circuit ->> 'circuit_state',
    'retry_permitted', p_result_class in ('transport', 'timeout', 'rate_limit')
      and v_job.retry_count < 1
      and v_circuit ->> 'circuit_state' <> 'open'
  );
end;
$$;

create or replace function public.open_document_extraction_circuit_on_dispatch_unknown_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean := false;
  v_circuit jsonb;
begin
  if new.status = 'dispatch_unknown' and old.status is distinct from 'dispatch_unknown' then
    if new.dispatch_request_id is null then
      raise exception 'Ambiguous dispatch is missing its dispatch identity.' using errcode = '23514';
    end if;
    insert into public.document_extraction_provider_outcomes (
      workspace_id, job_id, dispatch_request_id, result_class, latency_ms,
      recorded_at
    ) values (
      new.workspace_id,
      new.id,
      new.dispatch_request_id,
      'ambiguous_dispatch',
      coalesce(new.provider_latency_ms, 0),
      coalesce(new.provider_outcome_recorded_at, now())
    )
    on conflict (dispatch_request_id) do nothing
    returning true into v_inserted;

    v_circuit := public.recompute_document_extraction_circuit_v2('ambiguous_dispatch');
    if coalesce((v_circuit ->> 'opened')::boolean, false) then
      perform public.record_document_extraction_event_v1(
        new.workspace_id, new.id, 'provider_circuit_opened', 'system', null,
        new.stage, new.status, 'ambiguous_dispatch', new.artifact_fingerprint,
        jsonb_build_object('circuit_policy_version', 'document_extraction_circuit_v1'),
        gen_random_uuid()
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists open_document_extraction_circuit_on_dispatch_unknown
  on public.document_extraction_jobs;
create trigger open_document_extraction_circuit_on_dispatch_unknown
  after update of status on public.document_extraction_jobs
  for each row execute function public.open_document_extraction_circuit_on_dispatch_unknown_v1();

create or replace function public.complete_document_extraction_job_v2(
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
  v_result jsonb;
  v_constraint text;
begin
  select * into v_job from public.document_extraction_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at <= now() or v_job.stage <> 'encrypting'
    or v_job.provider_result_class <> 'success' or v_job.provider_outcome_recorded_at is null then
    raise exception 'The job is not ready for encrypted completion.' using errcode = '42501';
  end if;

  begin
    select public.complete_document_extraction_job_v1(
      p_job_id, p_worker_id, p_artifact_fingerprint, null,
      p_critical_field_manifest_json, p_payload_ciphertext, p_encryption_key_version,
      p_encryption_nonce, p_authentication_tag, p_aad_digest
    ) into v_result;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = CONSTRAINT_NAME;
      if v_constraint = 'document_extraction_cache_key_version_nonce_unique_idx' then
        return jsonb_build_object('completed', false, 'reason', 'nonce_collision');
      end if;
      raise;
  end;

  update public.document_extraction_jobs
  set validation_result = 'passed', encryption_result = 'encrypted',
      cache_result = 'stored', updated_at = now()
  where id = p_job_id;
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('completed', true);
end;
$$;

create or replace function public.set_document_extraction_circuit_state_v1(
  p_state text,
  p_reason_code text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.document_extraction_system_state%rowtype;
  v_state public.document_extraction_system_state%rowtype;
begin
  if p_state not in ('closed', 'open', 'half_open')
    or p_reason_code !~ '^[a-z0-9._:-]{1,100}$' then
    raise exception 'Invalid controlled circuit transition.' using errcode = '22023';
  end if;
  select * into v_previous
  from public.document_extraction_system_state
  where singleton_key = 'document_intelligence'
  for update;

  update public.document_extraction_system_state
  set circuit_state = p_state,
      circuit_opened_at = case when p_state = 'open' then now() else null end,
      half_open_authorized_at = case when p_state = 'half_open' then now() else null end,
      circuit_reason_code = p_reason_code,
      consecutive_failures = case when p_state = 'closed' then 0 else consecutive_failures end,
      rolling_failure_count = case when p_state = 'closed' then 0 else rolling_failure_count end,
      failure_window_started_at = case when p_state = 'closed' then null else failure_window_started_at end,
      failure_window_reset_at = case when p_state = 'closed' then now() else failure_window_reset_at end,
      updated_by = p_actor_id,
      updated_at = now()
  where singleton_key = 'document_intelligence'
  returning * into v_state;

  if v_previous.circuit_state is distinct from v_state.circuit_state then
    insert into public.document_extraction_circuit_events (
      previous_state, next_state, trigger_kind, reason_code, actor_id,
      consecutive_failures, rolling_failure_count
    ) values (
      v_previous.circuit_state,
      v_state.circuit_state,
      'operator',
      p_reason_code,
      p_actor_id,
      v_state.consecutive_failures,
      v_state.rolling_failure_count
    );
  end if;
  return jsonb_build_object(
    'circuit_state', v_state.circuit_state,
    'reason_code', v_state.circuit_reason_code
  );
end;
$$;

alter table public.document_extraction_provider_outcomes enable row level security;
alter table public.document_extraction_circuit_events enable row level security;

revoke all privileges on table public.document_extraction_provider_outcomes
  from public, anon, authenticated, service_role;
revoke all privileges on sequence public.document_extraction_provider_outcomes_outcome_sequence_seq
  from public, anon, authenticated, service_role;
revoke all privileges on table public.document_extraction_circuit_events
  from public, anon, authenticated, service_role;

revoke execute on function public.prevent_document_extraction_private_ledger_mutation_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.recompute_document_extraction_circuit_v2(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.open_document_extraction_circuit_on_dispatch_unknown_v1()
  from public, anon, authenticated, service_role;

revoke execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.record_document_extraction_provider_outcome_v1(uuid, text, uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_document_extraction_job_v2(uuid, text, text, jsonb, bytea, text, bytea, bytea, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_document_extraction_circuit_state_v1(text, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.authorize_document_extraction_dispatch_v2(uuid, text, uuid)
  to service_role;
grant execute on function public.record_document_extraction_provider_outcome_v1(uuid, text, uuid, text, integer)
  to service_role;
grant execute on function public.complete_document_extraction_job_v2(uuid, text, text, jsonb, bytea, text, bytea, bytea, text)
  to service_role;
grant execute on function public.set_document_extraction_circuit_state_v1(text, text, uuid)
  to service_role;

comment on table public.document_extraction_provider_outcomes is
  'Private append-only provider outcome ledger for concurrency-safe circuit thresholds; contains no document content.';
comment on table public.document_extraction_circuit_events is
  'Private append-only circuit transition audit; contains bounded operational metadata only.';
comment on index public.document_extraction_cache_key_version_nonce_unique_idx is
  'Distributed AES-GCM nonce uniqueness boundary within each managed key version.';
