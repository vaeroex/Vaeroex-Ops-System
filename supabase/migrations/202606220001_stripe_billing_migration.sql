alter table public.workspaces
  drop constraint if exists workspaces_subscription_status_check;

alter table public.workspaces
  add constraint workspaces_subscription_status_check
  check (subscription_status in ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'expired', 'manual_review', 'demo'));

alter table public.customer_subscriptions
  drop constraint if exists customer_subscriptions_status_check;

alter table public.customer_subscriptions
  add column if not exists billing_provider text not null default 'manual',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_current_period_end timestamptz,
  add column if not exists stripe_cancel_at_period_end boolean not null default false;

update public.customer_subscriptions
set billing_provider = case
  when source in ('stripe', 'squarespace', 'manual', 'demo') then source
  else coalesce(nullif(source, ''), 'manual')
end
where billing_provider = 'manual';

alter table public.customer_subscriptions
  add constraint customer_subscriptions_status_check
  check (status in ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'expired', 'manual_review', 'demo'));

alter table public.subscription_events
  add column if not exists billing_provider text,
  add column if not exists stripe_event_id text,
  add column if not exists stripe_subscription_id text;

create unique index if not exists customer_subscriptions_stripe_subscription_uidx
  on public.customer_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists customer_subscriptions_stripe_customer_idx
  on public.customer_subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists customer_subscriptions_billing_provider_idx
  on public.customer_subscriptions(billing_provider);

create unique index if not exists subscription_events_stripe_event_uidx
  on public.subscription_events(stripe_event_id)
  where stripe_event_id is not null;

create index if not exists subscription_events_stripe_subscription_idx
  on public.subscription_events(stripe_subscription_id)
  where stripe_subscription_id is not null;
