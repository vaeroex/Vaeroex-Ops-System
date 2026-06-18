alter table public.workspaces
  add column if not exists subscription_status text not null default 'manual_review',
  add column if not exists plan_slug text,
  add column if not exists subscription_required boolean not null default true,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists manually_unlocked boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspaces_subscription_status_check'
  ) then
    alter table public.workspaces
      add constraint workspaces_subscription_status_check
      check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'manual_review', 'demo'));
  end if;
end $$;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  monthly_price_cents integer,
  annual_price_cents integer,
  max_workspaces integer,
  max_users integer,
  max_forms integer,
  max_checklists integer,
  max_ai_runs_per_month integer,
  features_json jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  customer_email text not null,
  customer_name text,
  source text not null default 'manual',
  plan_slug text references public.subscription_plans(slug) on update cascade,
  status text not null default 'manual_review',
  squarespace_order_id text,
  squarespace_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  last_payment_at timestamptz,
  raw_payload_json jsonb not null default '{}'::jsonb,
  manually_activated boolean not null default false,
  manually_activated_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_subscriptions_status_check check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired', 'manual_review', 'demo'))
);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'squarespace',
  event_type text,
  customer_email text,
  squarespace_order_id text,
  payload_json jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  processing_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  agent_type text,
  tokens_used integer not null default 0,
  estimated_cost_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.manual_activation_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  plan_purchased text,
  order_number text,
  message text,
  status text not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint manual_activation_requests_status_check check (status in ('pending', 'approved', 'denied', 'needs_more_info'))
);

create index if not exists customer_subscriptions_user_idx on public.customer_subscriptions(user_id);
create index if not exists customer_subscriptions_email_idx on public.customer_subscriptions(lower(customer_email));
create index if not exists customer_subscriptions_workspace_idx on public.customer_subscriptions(workspace_id);
create index if not exists customer_subscriptions_status_idx on public.customer_subscriptions(status);
create index if not exists subscription_events_order_idx on public.subscription_events(squarespace_order_id);
create index if not exists subscription_events_created_idx on public.subscription_events(created_at desc);
create index if not exists ai_usage_workspace_month_idx on public.ai_usage(workspace_id, created_at desc);
create index if not exists manual_activation_requests_email_idx on public.manual_activation_requests(lower(email));

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
values
  (
    'Starter Operations System',
    'starter',
    'Best for solo owners or small teams that need basic forms, checklists, SOPs, and reports.',
    null,
    null,
    1,
    3,
    10,
    10,
    50,
    '["Dashboard","Forms","Checklists","Tasks","Issues","SOPs","Ask Vaeroex","Weekly report"]'::jsonb,
    true
  ),
  (
    'Growth Operations System',
    'growth',
    'Best for growing businesses that need team accountability, workflows, asset tracking, and more Vaeroex reports.',
    null,
    null,
    3,
    10,
    50,
    50,
    250,
    '["Everything in Starter","Asset tracking","People directory","Advanced reports","More Vaeroex runs","Industry templates"]'::jsonb,
    true
  ),
  (
    'Pro Operations System',
    'pro',
    'Best for businesses with multiple locations, more users, more workflows, and heavier reporting needs.',
    null,
    null,
    10,
    25,
    null,
    null,
    1000,
    '["Everything in Growth","Multi-location support","More reports","Priority setup support placeholder","Custom workflow support placeholder"]'::jsonb,
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'subscription_plans',
    'customer_subscriptions',
    'subscription_events',
    'ai_usage',
    'manual_activation_requests'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy "anyone can read active subscription plans"
  on public.subscription_plans for select
  to anon, authenticated
  using (is_active = true);

create policy "users can read own subscriptions"
  on public.customer_subscriptions for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

create policy "workspace managers can manage subscriptions"
  on public.customer_subscriptions for all
  to authenticated
  using (workspace_id is not null and public.can_manage_workspace(workspace_id))
  with check (workspace_id is not null and public.can_manage_workspace(workspace_id));

create policy "workspace members can read ai usage"
  on public.ai_usage for select
  to authenticated
  using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy "workspace members can insert ai usage"
  on public.ai_usage for insert
  to authenticated
  with check (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy "users can read own activation requests"
  on public.manual_activation_requests for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "users can create activation requests"
  on public.manual_activation_requests for insert
  to anon, authenticated
  with check (true);

create policy "workspace managers can read subscription events"
  on public.subscription_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.customer_subscriptions cs
      where cs.squarespace_order_id = subscription_events.squarespace_order_id
        and cs.workspace_id is not null
        and public.can_manage_workspace(cs.workspace_id)
    )
  );

drop trigger if exists set_subscription_plans_updated_at on public.subscription_plans;
create trigger set_subscription_plans_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

drop trigger if exists set_customer_subscriptions_updated_at on public.customer_subscriptions;
create trigger set_customer_subscriptions_updated_at
  before update on public.customer_subscriptions
  for each row execute function public.set_updated_at();
