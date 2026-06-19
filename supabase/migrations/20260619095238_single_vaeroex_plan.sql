insert into public.subscription_plans (
  name,
  slug,
  description,
  monthly_price_cents,
  annual_price_cents,
  max_workspaces,
  max_users,
  max_forms,
  max_checklists,
  max_ai_runs_per_month,
  features_json,
  is_active
)
values (
  'Vaeroex',
  'vaeroex',
  'Everything included. One premium operations platform for executive dashboards, CRM, KPIs, reports, SOPs, tasks, issues, checklists, files, team accountability, and Vaeroex intelligence.',
  39900,
  null,
  1,
  10,
  null,
  null,
  1000,
  '[
    "Executive Dashboard",
    "CRM",
    "KPIs",
    "Reports",
    "SOPs",
    "Tasks",
    "Issues",
    "Checklists",
    "Files",
    "People",
    "Notifications",
    "Team Roles",
    "Assignments",
    "Report Scheduling",
    "Report Sharing",
    "KPI Alerts",
    "Vaeroex AI",
    "Business Health Score",
    "Business Memory",
    "Profit Leak Detector",
    "Executive Briefings",
    "Role-Based Briefings",
    "Weekly Reviews",
    "Demo Workspace",
    "Security Features",
    "Help Center",
    "Future Prestige Features"
  ]'::jsonb,
  true
)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      monthly_price_cents = excluded.monthly_price_cents,
      annual_price_cents = excluded.annual_price_cents,
      max_workspaces = excluded.max_workspaces,
      max_users = excluded.max_users,
      max_forms = excluded.max_forms,
      max_checklists = excluded.max_checklists,
      max_ai_runs_per_month = excluded.max_ai_runs_per_month,
      features_json = excluded.features_json,
      is_active = excluded.is_active,
      updated_at = now();

update public.customer_subscriptions
set plan_slug = 'vaeroex',
    updated_at = now()
where plan_slug in ('starter', 'growth', 'pro');

update public.workspaces
set plan_slug = 'vaeroex',
    updated_at = now()
where plan_slug in ('starter', 'growth', 'pro');

update public.subscription_plans
set is_active = false,
    updated_at = now()
where slug in ('starter', 'growth', 'pro');
