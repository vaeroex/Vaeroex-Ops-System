begin;

create table if not exists public.checkout_legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_email text,
  acceptance_set_id text not null,
  acceptance_set_version text not null,
  required_policy_hash text not null check (required_policy_hash ~ '^[0-9a-f]{64}$'),
  accepted_policies_json jsonb not null,
  acceptance_snapshot_json jsonb not null,
  acceptance_source text not null check (acceptance_source in ('pre_checkout')),
  acceptance_action text not null check (acceptance_action in ('accept_and_continue_to_stripe_checkout')),
  record_class text not null default 'pre_checkout_legal_acceptance'
    check (record_class = 'pre_checkout_legal_acceptance'),
  user_agent text,
  ip_address text,
  accepted_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint checkout_legal_acceptances_policies_shape check (
    jsonb_typeof(accepted_policies_json) = 'array'
    and jsonb_array_length(accepted_policies_json) > 0
  ),
  constraint checkout_legal_acceptances_snapshot_matches check (
    jsonb_typeof(acceptance_snapshot_json) = 'object'
    and acceptance_snapshot_json ?& array[
      'acceptanceSetId',
      'acceptanceSetVersion',
      'requiredPolicyHash',
      'recordClass',
      'requiredPolicies'
    ]
    and jsonb_typeof(acceptance_snapshot_json->'requiredPolicies') = 'array'
    and jsonb_array_length(acceptance_snapshot_json->'requiredPolicies') > 0
    and acceptance_snapshot_json->>'acceptanceSetId' = acceptance_set_id
    and acceptance_snapshot_json->>'acceptanceSetVersion' = acceptance_set_version
    and acceptance_snapshot_json->>'requiredPolicyHash' = required_policy_hash
    and acceptance_snapshot_json->>'recordClass' = record_class
  )
);

comment on table public.checkout_legal_acceptances is
  'Immutable pre-checkout legal acceptance ledger. Proves an authenticated Vaeroex account accepted the configured policy set before Stripe Checkout.';

create unique index if not exists checkout_legal_acceptances_current_uidx
  on public.checkout_legal_acceptances(user_id, acceptance_set_id, acceptance_set_version, required_policy_hash);

create index if not exists checkout_legal_acceptances_user_idx
  on public.checkout_legal_acceptances(user_id, accepted_at desc);

create index if not exists checkout_legal_acceptances_workspace_idx
  on public.checkout_legal_acceptances(workspace_id, accepted_at desc)
  where workspace_id is not null;

alter table public.checkout_legal_acceptances enable row level security;

drop policy if exists "users can read own checkout legal acceptances" on public.checkout_legal_acceptances;
create policy "users can read own checkout legal acceptances"
  on public.checkout_legal_acceptances for select
  to authenticated
  using (
    user_id = auth.uid()
    or (workspace_id is not null and public.can_manage_workspace(workspace_id))
  );

drop policy if exists "users can create own checkout legal acceptances" on public.checkout_legal_acceptances;
create policy "users can create own checkout legal acceptances"
  on public.checkout_legal_acceptances for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

create or replace function public.reject_checkout_legal_acceptance_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Checkout legal acceptances are immutable legal records.';
end;
$$;

drop trigger if exists checkout_legal_acceptances_immutable on public.checkout_legal_acceptances;
create trigger checkout_legal_acceptances_immutable
  before update or delete on public.checkout_legal_acceptances
  for each row execute function public.reject_checkout_legal_acceptance_mutation();

revoke all on public.checkout_legal_acceptances from anon, authenticated;
grant select, insert on public.checkout_legal_acceptances to authenticated;
grant select, insert on public.checkout_legal_acceptances to service_role;

revoke all on function public.reject_checkout_legal_acceptance_mutation() from public, anon, authenticated;

commit;
