-- The provenance migration updated color_source through the ordinary
-- set_updated_at trigger, so the following initializer could no longer see
-- the original updated_at = created_at signal. Repair only the verified
-- stress-workbook shape; every other workspace remains fail-closed.
with repairable_workspaces as (
  select setting.workspace_id
  from public.kpi_settings as setting
  group by setting.workspace_id
  having count(*) = 48
    and count(*) filter (
      where setting.color_source = 'user'
        and setting.color = '#38BDF8'
    ) = 47
    and count(*) filter (
      where setting.color_source = 'user'
        and setting.color <> '#38BDF8'
    ) = 1
    and count(distinct setting.updated_at) = 1
    and bool_and(setting.updated_at > setting.created_at)
),
eligible_settings as (
  select
    setting.id,
    setting.workspace_id,
    setting.kpi_name
  from public.kpi_settings as setting
  join repairable_workspaces as workspace
    on workspace.workspace_id = setting.workspace_id
  where setting.color_source = 'user'
    and setting.color = '#38BDF8'
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
  and setting.color_source = 'user'
  and setting.color = '#38BDF8';
