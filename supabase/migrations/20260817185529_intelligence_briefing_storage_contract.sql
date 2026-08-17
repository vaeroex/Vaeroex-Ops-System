begin;

-- The generation key binds briefing type, deterministic material state, schema,
-- validator, prompt, and provider policy. Hidden completed rows retain the claim
-- so lifecycle changes cannot force duplicate provider-backed generations.
create unique index if not exists ai_agent_runs_intelligence_briefing_generation_claim_uidx
  on public.ai_agent_runs (
    workspace_id,
    (input_json ->> 'briefing_type'),
    (input_json ->> 'generation_key')
  )
  where agent_type = 'intelligence_briefing_v1'
    and status in ('processing', 'completed')
    and nullif(input_json ->> 'briefing_type', '') is not null
    and nullif(input_json ->> 'generation_key', '') is not null;

comment on index public.ai_agent_runs_intelligence_briefing_generation_claim_uidx is
  'Allows at most one processing or completed weekly/monthly briefing per workspace and deterministic generation key.';

create index if not exists ai_agent_runs_intelligence_briefing_current_idx
  on public.ai_agent_runs (
    workspace_id,
    (input_json ->> 'briefing_type'),
    created_at desc
  )
  where agent_type = 'intelligence_briefing_v1'
    and status = 'completed'
    and archived_at is null
    and deleted_at is null;

comment on index public.ai_agent_runs_intelligence_briefing_current_idx is
  'Supports workspace-scoped retrieval of the latest validated weekly or monthly Intelligence Briefing.';

create index if not exists ai_agent_runs_intelligence_briefing_evidence_period_idx
  on public.ai_agent_runs (
    workspace_id,
    (input_json ->> 'briefing_type'),
    (input_json ->> 'effective_evidence_fingerprint'),
    (input_json ->> 'period_start'),
    (input_json ->> 'period_end'),
    created_at desc
  )
  where agent_type = 'intelligence_briefing_v1'
    and status in ('processing', 'completed')
    and nullif(input_json ->> 'briefing_type', '') is not null
    and nullif(input_json ->> 'effective_evidence_fingerprint', '') is not null;

comment on index public.ai_agent_runs_intelligence_briefing_evidence_period_idx is
  'Supports workspace-scoped briefing type, effective evidence fingerprint, and exact evidence-period lookup.';

alter table public.ai_agent_runs enable row level security;
alter table public.reports enable row level security;

create or replace function public.soft_delete_saved_analyses(
  p_workspace_id uuid,
  p_report_ids uuid[],
  p_release_channel text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_ids uuid[];
  deleted_count integer;
begin
  if auth.uid() is null
    or not coalesce(public.can_manage_workspace(p_workspace_id), false) then
    raise exception using
      errcode = '42501',
      message = 'Saved analyses are unavailable.';
  end if;

  if p_workspace_id is null
    or p_report_ids is null
    or cardinality(p_report_ids) < 1
    or cardinality(p_report_ids) > 300
    or array_position(p_report_ids, null) is not null
    or cardinality(p_report_ids) <> (
      select count(distinct requested_id)
      from unnest(p_report_ids) as requested(requested_id)
    )
    or p_release_channel not in ('production', 'preview', 'development') then
    raise exception using
      errcode = '22023',
      message = 'Saved analyses are unavailable.';
  end if;

  select coalesce(array_agg(candidate.id order by candidate.id), array[]::uuid[])
  into locked_ids
  from (
    select report.id
    from public.reports as report
    where report.workspace_id = p_workspace_id
      and report.id = any(p_report_ids)
      and report.archived_at is null
      and report.deleted_at is null
      and jsonb_typeof(report.source_data_json) = 'object'
      and report.source_data_json ->> 'record_kind' = 'saved_analysis'
      and report.source_data_json ->> 'envelope_version' = '1'
      and report.source_data_json ->> 'analysis_type' in (
        'executive_brief',
        'business_health',
        'finding_explanation',
        'weekly_briefing',
        'monthly_briefing'
      )
      and nullif(report.source_data_json ->> 'saved_analysis_key', '') is not null
      and report.source_data_json ->> 'workspace_id' = p_workspace_id::text
      and report.source_data_json ->> 'release_channel' = p_release_channel
    order by report.id
    for update
  ) as candidate;

  if cardinality(locked_ids) <> cardinality(p_report_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'Saved analyses are unavailable.';
  end if;

  update public.reports as report
  set deleted_at = statement_timestamp()
  where report.workspace_id = p_workspace_id
    and report.id = any(locked_ids)
    and report.archived_at is null
    and report.deleted_at is null
    and jsonb_typeof(report.source_data_json) = 'object'
    and report.source_data_json ->> 'record_kind' = 'saved_analysis'
    and report.source_data_json ->> 'envelope_version' = '1'
    and report.source_data_json ->> 'analysis_type' in (
      'executive_brief',
      'business_health',
      'finding_explanation',
      'weekly_briefing',
      'monthly_briefing'
    )
    and nullif(report.source_data_json ->> 'saved_analysis_key', '') is not null
    and report.source_data_json ->> 'workspace_id' = p_workspace_id::text
    and report.source_data_json ->> 'release_channel' = p_release_channel;

  get diagnostics deleted_count = row_count;

  if deleted_count <> cardinality(p_report_ids) then
    raise exception using
      errcode = 'P0001',
      message = 'Saved analyses are unavailable.';
  end if;

  return deleted_count;
end;
$$;

revoke all on function public.soft_delete_saved_analyses(uuid, uuid[], text) from public, anon;
grant execute on function public.soft_delete_saved_analyses(uuid, uuid[], text) to authenticated;

commit;
