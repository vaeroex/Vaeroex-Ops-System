-- The original presentation-color migration intentionally left historical rows
-- unchanged. Initialize only rows that still match a known system creation
-- default and have never been updated since creation.
with eligible_settings as (
  select
    setting.id,
    setting.workspace_id,
    setting.kpi_name
  from public.kpi_settings as setting
  where setting.updated_at = setting.created_at
    and (
      (
        setting.color_source = 'legacy_unclassified'
        and setting.color in ('#1E6BFF', '#10B981')
      )
      or (
        setting.color_source = 'user'
        and setting.color = '#38BDF8'
      )
    )
),
ranked_settings as (
  select
    eligible.id,
    (
      (
        row_number() over (
          partition by eligible.workspace_id
          order by
            md5(lower(eligible.workspace_id::text || '::' || btrim(eligible.kpi_name))),
            lower(btrim(eligible.kpi_name)),
            eligible.id::text
        ) - 1
      ) % 8 + 1
    )::integer as palette_index
  from eligible_settings as eligible
),
assigned_settings as (
  select
    ranked.id,
    (array[
      '#38BDF8',
      '#10B981',
      '#F59E0B',
      '#EF4444',
      '#8B5CF6',
      '#F97316',
      '#14B8A6',
      '#D1D5DB'
    ]::text[])[ranked.palette_index] as color
  from ranked_settings as ranked
)
update public.kpi_settings as setting
set
  color = assigned.color,
  color_source = 'automatic'
from assigned_settings as assigned
where setting.id = assigned.id
  and setting.updated_at = setting.created_at
  and (
    (
      setting.color_source = 'legacy_unclassified'
      and setting.color in ('#1E6BFF', '#10B981')
    )
    or (
      setting.color_source = 'user'
      and setting.color = '#38BDF8'
    )
  );

comment on column public.kpi_settings.color_source is
  'Presentation-only color provenance. Automatic assignments may be initialized by Vaeroex; user colors are authoritative; legacy rows are initialized only when their stored color and timestamps still prove an untouched system default.';
