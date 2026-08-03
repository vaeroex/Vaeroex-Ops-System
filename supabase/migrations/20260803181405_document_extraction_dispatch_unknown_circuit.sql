-- Keep post-dispatch uncertainty and the durable provider circuit aligned.
--
-- This is additive and inert until an already-processing extraction transitions
-- to dispatch_unknown. It enables no workspace, provider, or application gate.

create or replace function public.open_document_extraction_circuit_on_dispatch_unknown_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened boolean := false;
begin
  if new.status = 'dispatch_unknown' and old.status is distinct from 'dispatch_unknown' then
    update public.document_extraction_system_state
    set circuit_state = 'open',
        circuit_opened_at = now(),
        circuit_reason_code = 'ambiguous_dispatch',
        consecutive_failures = consecutive_failures + 1,
        rolling_failure_count = rolling_failure_count + 1,
        failure_window_started_at = coalesce(failure_window_started_at, now()),
        last_provider_result_at = coalesce(last_provider_result_at, now()),
        updated_at = now()
    where singleton_key = 'document_intelligence'
      and circuit_state <> 'open'
    returning true into v_opened;

    if v_opened then
      perform public.record_document_extraction_event_v1(
        new.workspace_id,
        new.id,
        'provider_circuit_opened',
        'system',
        null,
        new.stage,
        new.status,
        'ambiguous_dispatch',
        new.artifact_fingerprint,
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

revoke execute on function public.open_document_extraction_circuit_on_dispatch_unknown_v1()
  from public, anon, authenticated, service_role;

comment on function public.open_document_extraction_circuit_on_dispatch_unknown_v1() is
  'Fail-closed circuit synchronization for any post-dispatch lease ambiguity. No client execution grant exists.';
