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
