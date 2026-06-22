alter table public.customer_subscriptions
  add column if not exists onboarding_email_status text not null default 'not_sent',
  add column if not exists onboarding_email_sent_at timestamptz,
  add column if not exists onboarding_email_message_id text,
  add column if not exists onboarding_email_error text;

alter table public.customer_subscriptions
  drop constraint if exists customer_subscriptions_onboarding_email_status_check;

alter table public.customer_subscriptions
  add constraint customer_subscriptions_onboarding_email_status_check
  check (onboarding_email_status in ('not_sent', 'sending', 'sent', 'failed', 'skipped'));

create index if not exists customer_subscriptions_onboarding_email_status_idx
  on public.customer_subscriptions(onboarding_email_status, onboarding_email_sent_at);
