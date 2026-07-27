alter table public.kpi_settings
  add column if not exists canonical_name text,
  add column if not exists display_name text,
  add column if not exists original_source_label text,
  add column if not exists aliases jsonb not null default '[]'::jsonb,
  add column if not exists semantic_unit text,
  add column if not exists semantic_scale numeric not null default 1,
  add column if not exists aggregation_basis text,
  add column if not exists period_basis text,
  add column if not exists desired_direction text not null default 'unknown',
  add column if not exists target_behavior text not null default 'unknown',
  add column if not exists ideal_value numeric,
  add column if not exists ideal_range_min numeric,
  add column if not exists ideal_range_max numeric,
  add column if not exists metric_role text not null default 'actual',
  add column if not exists classification_source text not null default 'unknown',
  add column if not exists classification_confidence numeric,
  add column if not exists classification_version text,
  add column if not exists classification_rationale text,
  add column if not exists classification_confirmed boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_aliases_array_check') then
    alter table public.kpi_settings add constraint kpi_settings_aliases_array_check
      check (jsonb_typeof(aliases) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_semantic_scale_check') then
    alter table public.kpi_settings add constraint kpi_settings_semantic_scale_check
      check (semantic_scale > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_desired_direction_check') then
    alter table public.kpi_settings add constraint kpi_settings_desired_direction_check
      check (desired_direction in ('maximize', 'minimize', 'target_range', 'exact_target', 'maintain', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_target_behavior_check') then
    alter table public.kpi_settings add constraint kpi_settings_target_behavior_check
      check (target_behavior in ('minimum_goal', 'maximum_limit', 'acceptable_range', 'exact_threshold', 'stability_goal', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_metric_role_check') then
    alter table public.kpi_settings add constraint kpi_settings_metric_role_check
      check (metric_role in ('actual', 'target', 'benchmark', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_classification_source_check') then
    alter table public.kpi_settings add constraint kpi_settings_classification_source_check
      check (classification_source in ('user', 'deterministic', 'luna', 'migration', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_classification_confidence_check') then
    alter table public.kpi_settings add constraint kpi_settings_classification_confidence_check
      check (classification_confidence is null or classification_confidence between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'kpi_settings_ideal_range_check') then
    alter table public.kpi_settings add constraint kpi_settings_ideal_range_check
      check (ideal_range_min is null or ideal_range_max is null or ideal_range_min <= ideal_range_max);
  end if;
end $$;

create index if not exists kpi_settings_workspace_canonical_review_idx
  on public.kpi_settings (workspace_id, canonical_name, semantic_unit, semantic_scale, metric_role)
  where canonical_name is not null;

comment on column public.kpi_settings.canonical_name is
  'Reviewable canonical identity. This column does not merge KPI history.';
comment on column public.kpi_settings.classification_confirmed is
  'True only when a workspace administrator explicitly confirms or overrides KPI semantics.';
