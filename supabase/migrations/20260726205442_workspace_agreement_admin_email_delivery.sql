create table if not exists public.workspace_agreement_admin_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null unique references public.workspace_agreements(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  recipient_email text not null default 'admin@vaeroex.com'
    check (lower(btrim(recipient_email)) = 'admin@vaeroex.com'),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider text not null default 'resend' check (provider = 'resend'),
  release_channel text not null
    check (release_channel in ('production', 'preview', 'development')),
  provider_message_id text,
  failure_reason text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_source text not null
    check (last_attempt_source in ('workspace_finalization', 'admin_resend')),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_agreement_admin_email_delivery_result_check check (
    (
      status = 'sent'
      and sent_at is not null
      and failure_reason is null
    )
    or (
      status in ('pending', 'failed', 'skipped')
      and sent_at is null
    )
  ),
  constraint workspace_agreement_admin_email_delivery_failure_check check (
    (status in ('failed', 'skipped') and nullif(btrim(failure_reason), '') is not null)
    or (status in ('pending', 'sent') and failure_reason is null)
  )
);

create index if not exists workspace_agreement_admin_email_delivery_status_idx
  on public.workspace_agreement_admin_email_deliveries(status, updated_at desc);

create index if not exists workspace_agreement_admin_email_delivery_workspace_idx
  on public.workspace_agreement_admin_email_deliveries(workspace_id, created_at desc);

alter table public.workspace_agreement_admin_email_deliveries enable row level security;

revoke all on public.workspace_agreement_admin_email_deliveries from public, anon, authenticated;
grant select, insert, update on public.workspace_agreement_admin_email_deliveries to service_role;
