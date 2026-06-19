alter table public.report_subscription_preferences
  add column if not exists schedule_day_of_week integer check (schedule_day_of_week between 0 and 6),
  add column if not exists schedule_day_kind text not null default 'custom_day' check (schedule_day_kind in ('custom_day', 'first_business_day', 'last_business_day')),
  add column if not exists schedule_day_of_month integer check (schedule_day_of_month between 1 and 31),
  add column if not exists schedule_month_in_quarter integer check (schedule_month_in_quarter between 1 and 3),
  add column if not exists schedule_time time without time zone;

create index if not exists report_subscription_preferences_schedule_idx
  on public.report_subscription_preferences(workspace_id, category, email_status, schedule_day_of_week, schedule_day_kind, schedule_day_of_month, schedule_month_in_quarter);
