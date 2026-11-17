-- Additive delivery tracking only. Existing rows remain null and are never mailed.
alter table public.support_requests
  add column notification_status text check (notification_status in ('pending','attempting','accepted','failed','unknown')),
  add column notification_attempted_at timestamptz,
  add column notification_detail text,
  add column notification_provider_id text;
comment on column public.support_requests.notification_status is
  'Server-only notification claim/status. accepted means provider acceptance, not inbox receipt. attempting/unknown require manual reconciliation before retry.';
