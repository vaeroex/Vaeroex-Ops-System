begin;

create index if not exists ai_usage_agent_type_created_at_idx
  on public.ai_usage(agent_type, created_at desc);

create index if not exists ai_agent_runs_agent_type_created_at_idx
  on public.ai_agent_runs(agent_type, created_at desc);

create index if not exists business_notes_created_at_idx
  on public.business_notes(created_at desc);

create index if not exists reports_saved_analysis_type_created_at_idx
  on public.reports((source_data_json ->> 'analysis_type'), created_at desc)
  where source_data_json ->> 'record_kind' = 'saved_analysis';

drop policy if exists "workspace members can insert ai usage" on public.ai_usage;

create policy "workspace members can insert non-trust ai usage"
  on public.ai_usage for insert
  to authenticated
  with check (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
    and not (coalesce(metadata_json, '{}'::jsonb) ? 'trust_shadow')
  );

comment on policy "workspace members can insert non-trust ai usage" on public.ai_usage is
  'Trust shadow telemetry is emitted only through the service-role Business Health path. Existing authenticated non-Trust usage recording remains available.';

commit;
