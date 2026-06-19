create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  terms_version text not null,
  privacy_version text not null,
  ai_disclaimer_version text not null,
  sensitive_data_policy_version text not null,
  accepted_at timestamptz not null default now(),
  user_email text,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_versions_idx
  on public.legal_acceptances(user_id, terms_version, privacy_version, ai_disclaimer_version, sensitive_data_policy_version, accepted_at desc);

create index if not exists legal_acceptances_workspace_idx
  on public.legal_acceptances(workspace_id, accepted_at desc);

alter table public.legal_acceptances enable row level security;

drop policy if exists "users can read own legal acceptances" on public.legal_acceptances;
create policy "users can read own legal acceptances"
  on public.legal_acceptances for select
  to authenticated
  using (
    user_id = auth.uid()
    or (workspace_id is not null and public.can_manage_workspace(workspace_id))
  );

drop policy if exists "users can create own legal acceptances" on public.legal_acceptances;
create policy "users can create own legal acceptances"
  on public.legal_acceptances for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

grant select, insert on public.legal_acceptances to authenticated;
