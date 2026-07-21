create unique index if not exists reports_saved_analysis_active_key_idx
  on public.reports (
    workspace_id,
    (source_data_json ->> 'saved_analysis_key')
  )
  where deleted_at is null
    and source_data_json ->> 'record_kind' = 'saved_analysis';

create index if not exists reports_saved_analysis_workspace_type_saved_idx
  on public.reports (
    workspace_id,
    (source_data_json ->> 'analysis_type'),
    (source_data_json ->> 'saved_at') desc
  )
  where deleted_at is null
    and source_data_json ->> 'record_kind' = 'saved_analysis';

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
        'finding_explanation'
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
      'finding_explanation'
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
