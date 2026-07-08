-- SMB launch hardening.
-- This migration is intentionally non-destructive:
-- - tightens function execution grants where safe
-- - replaces an overly broad anonymous insert policy with a constrained one
-- - adds a small server-side rate-limit counter table
-- - sets a stable search_path for the shared updated_at trigger function

create extension if not exists pgcrypto;

alter function public.set_updated_at()
  set search_path = public, pg_temp;

-- Trigger-only function. It should not be callable through the public Data API.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- Workspace helper functions are used by RLS policies for signed-in users.
-- Revoke anonymous/public execution while preserving authenticated RLS behavior.
revoke execute on function public.is_workspace_member(uuid) from public;
revoke execute on function public.is_workspace_member(uuid) from anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

revoke execute on function public.workspace_member_role(uuid) from public;
revoke execute on function public.workspace_member_role(uuid) from anon;
grant execute on function public.workspace_member_role(uuid) to authenticated;

revoke execute on function public.has_workspace_role(uuid, text[]) from public;
revoke execute on function public.has_workspace_role(uuid, text[]) from anon;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;

revoke execute on function public.can_manage_workspace(uuid) from public;
revoke execute on function public.can_manage_workspace(uuid) from anon;
grant execute on function public.can_manage_workspace(uuid) to authenticated;

revoke execute on function public.can_edit_operations(uuid) from public;
revoke execute on function public.can_edit_operations(uuid) from anon;
grant execute on function public.can_edit_operations(uuid) to authenticated;

-- Invite acceptance is intentionally callable after login only.
revoke execute on function public.accept_workspace_invites_for_current_user() from public;
revoke execute on function public.accept_workspace_invites_for_current_user() from anon;
grant execute on function public.accept_workspace_invites_for_current_user() to authenticated;

drop policy if exists "users can create activation requests" on public.manual_activation_requests;

create policy "users can create activation requests"
  on public.manual_activation_requests
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and length(trim(name)) between 1 and 160
    and length(trim(email)) between 3 and 320
    and email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
    and coalesce(length(trim(company)), 0) <= 200
    and coalesce(length(trim(plan_purchased)), 0) <= 120
    and coalesce(length(trim(order_number)), 0) <= 120
    and coalesce(length(trim(message)), 0) <= 2000
  );

create table if not exists public.request_rate_limits (
  id uuid primary key default gen_random_uuid(),
  action_key text not null,
  identifier_hash text not null,
  window_start timestamptz not null,
  count integer not null default 1 check (count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  constraint request_rate_limits_unique_window unique (action_key, identifier_hash, window_start)
);

create index if not exists request_rate_limits_action_window_idx
  on public.request_rate_limits(action_key, window_start desc);

create index if not exists request_rate_limits_last_seen_idx
  on public.request_rate_limits(last_seen_at desc);

alter table public.request_rate_limits enable row level security;

-- No anon/authenticated policies are created for request_rate_limits.
-- The application updates this table with the server-side Supabase service role.
