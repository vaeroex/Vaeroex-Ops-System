alter table public.kpi_settings
  add column if not exists color_source text;

update public.kpi_settings
set color_source = case
  when color in ('#1E6BFF', '#10B981') and updated_at = created_at then 'legacy_unclassified'
  else 'user'
end
where color_source is null;

alter table public.kpi_settings
  alter column color_source set default 'automatic',
  alter column color_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.kpi_settings'::regclass
      and conname = 'kpi_settings_color_source_check'
  ) then
    alter table public.kpi_settings
      add constraint kpi_settings_color_source_check
      check (color_source in ('automatic', 'user', 'legacy_unclassified'));
  end if;
end $$;

comment on column public.kpi_settings.color_source is
  'Presentation-only color provenance. Automatic assignments may be initialized by Vaeroex; user colors are authoritative; ambiguous legacy defaults remain unclassified until an administrator explicitly selects them for allocation.';
