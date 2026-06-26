alter table public.kpi_settings
  add column if not exists unit_type text,
  add column if not exists display_unit text,
  add column if not exists value_format text,
  add column if not exists x_axis_label text,
  add column if not exists y_axis_label text,
  add column if not exists preferred_chart_type text not null default 'line';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'kpi_settings_preferred_chart_type_check'
  ) then
    alter table public.kpi_settings
      add constraint kpi_settings_preferred_chart_type_check
      check (preferred_chart_type in ('line', 'bar', 'mixed'));
  end if;
end $$;
