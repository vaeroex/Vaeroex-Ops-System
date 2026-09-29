begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- The disposable SQL-created tables do not carry the hosted server client's
-- table grants. Model only the invoker RPC's required service-role authority
-- inside this rolled-back fixture, as the billing entitlement suite does.
-- This qualifies RPC behavior, not the current Production catalog grants.
grant select, update on table public.manual_activation_requests to service_role;
grant select on table public.profiles, public.subscription_plans, public.workspace_members to service_role;
grant select, insert, update on table public.customer_subscriptions to service_role;
grant select, update on table public.workspaces to service_role;

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$$;

select is(
  (
    select pg_get_function_arguments(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'review_manual_activation_request'
      and p.proargtypes = '2950 25 2950 25'::oidvector
  ),
  'p_request_id uuid, p_status text, p_reviewed_by uuid, p_plan_slug text DEFAULT ''vaeroex''::text',
  'the Data API contract retains the exact named four-argument signature'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.review_manual_activation_request(uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot review activation requests'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.review_manual_activation_request(uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated non-admin callers cannot review activation requests directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.review_manual_activation_request(uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'only the server-side service role receives the review RPC'
);

insert into public.profiles (id, email, full_name) values
  ('a6100000-0000-4000-8000-000000000001', 'manual-reviewer@example.test', 'Manual Reviewer'),
  ('a6100000-0000-4000-8000-000000000002', 'manual-customer@example.test', 'Manual Customer');

insert into public.workspaces (
  id,
  name,
  primary_contact_email,
  created_by,
  subscription_status,
  plan_slug,
  manually_unlocked
) values (
  'b6100000-0000-4000-8000-000000000001',
  'Manual activation entitlement test',
  'manual-customer@example.test',
  'a6100000-0000-4000-8000-000000000002',
  'manual_review',
  null,
  false
);

insert into public.workspace_members (workspace_id, user_id, role, status) values (
  'b6100000-0000-4000-8000-000000000001',
  'a6100000-0000-4000-8000-000000000002',
  'owner',
  'active'
);

insert into public.manual_activation_requests (id, name, email, company, status) values (
  'c6100000-0000-4000-8000-000000000001',
  'Manual Customer',
  'manual-customer@example.test',
  'Manual Test Company',
  'pending'
);

set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      'c6100000-0000-4000-8000-000000000001',
      'approved',
      'a6100000-0000-4000-8000-000000000001',
      'vaeroex'
    )$$,
    '42501'
  ),
  'an authenticated client cannot bypass the server-side admin review path'
);

reset role;
set local role service_role;

select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      null,
      'approved',
      'a6100000-0000-4000-8000-000000000001',
      'vaeroex'
    )$$,
    '22023'
  ),
  'a missing request id is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      'c6100000-0000-4000-8000-000000000099',
      'approved',
      'a6100000-0000-4000-8000-000000000001',
      'vaeroex'
    )$$,
    'P0002'
  ),
  'an unknown request id is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      'c6100000-0000-4000-8000-000000000001',
      'unsupported',
      'a6100000-0000-4000-8000-000000000001',
      'vaeroex'
    )$$,
    '22023'
  ),
  'an unsupported review status is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      'c6100000-0000-4000-8000-000000000001',
      'approved',
      'a6100000-0000-4000-8000-000000000001',
      'missing-plan'
    )$$,
    '23503'
  ),
  'an unavailable plan slug is rejected'
);

select is(
  public.review_manual_activation_request(
    'c6100000-0000-4000-8000-000000000001',
    'approved',
    'a6100000-0000-4000-8000-000000000001',
    'vaeroex'
  ) ->> 'access_granted',
  'true',
  'an authorized approval creates an active entitlement atomically'
);
select is(
  (
    select subscription.workspace_id
    from public.customer_subscriptions subscription
    where lower(subscription.customer_email) = 'manual-customer@example.test'
  ),
  'b6100000-0000-4000-8000-000000000001'::uuid,
  'the entitlement links to the customer owner workspace'
);
select results_eq(
  $$select status, plan_slug, manually_activated, manually_activated_by
    from public.customer_subscriptions
    where lower(customer_email) = 'manual-customer@example.test'$$,
  $$values (
    'active'::text,
    'vaeroex'::text,
    true,
    'a6100000-0000-4000-8000-000000000001'::uuid
  )$$,
  'the entitlement records the intended plan and authenticated server reviewer'
);
select results_eq(
  $$select subscription_status, plan_slug, manually_unlocked
    from public.workspaces
    where id = 'b6100000-0000-4000-8000-000000000001'$$,
  $$values ('active'::text, 'vaeroex'::text, true)$$,
  'approval unlocks only the linked customer workspace'
);
select results_eq(
  $$select status, reviewed_by, reviewed_at is not null
    from public.manual_activation_requests
    where id = 'c6100000-0000-4000-8000-000000000001'$$,
  $$values (
    'approved'::text,
    'a6100000-0000-4000-8000-000000000001'::uuid,
    true
  )$$,
  'the request retains its approval audit history'
);

select is(
  public.review_manual_activation_request(
    'c6100000-0000-4000-8000-000000000001',
    'approved',
    'a6100000-0000-4000-8000-000000000001',
    'vaeroex'
  ) ->> 'subscription_id',
  (
    select subscription.id::text
    from public.customer_subscriptions subscription
    where lower(subscription.customer_email) = 'manual-customer@example.test'
  ),
  'replaying approval returns the existing manual entitlement'
);
select is(
  (
    select count(*)::integer
    from public.customer_subscriptions subscription
    where lower(subscription.customer_email) = 'manual-customer@example.test'
  ),
  1,
  'replayed approval does not create a duplicate subscription'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.review_manual_activation_request(
      'c6100000-0000-4000-8000-000000000001',
      'denied',
      'a6100000-0000-4000-8000-000000000001',
      'vaeroex'
    )$$,
    '22023'
  ),
  'an approved request cannot be rewritten to another review state'
);

reset role;
-- A new, ordinary pilot account has no workspace before the required setup
-- agreement. Approval must retain an unlinked manual entitlement, not attach
-- it to another customer's workspace or create a fabricated paid subscription.
insert into public.profiles (id, email, full_name) values
  ('a6100000-0000-4000-8000-000000000003', 'new-pilot@example.test', 'New Pilot');
insert into public.manual_activation_requests (id, name, email, company, status) values
  ('c6100000-0000-4000-8000-000000000003', 'New Pilot', 'new-pilot@example.test', 'New Pilot Business', 'pending');
set local role service_role;
select is(public.review_manual_activation_request(
  'c6100000-0000-4000-8000-000000000003', 'approved',
  'a6100000-0000-4000-8000-000000000001', 'vaeroex'
) ->> 'access_granted', 'true', 'new pilot approval grants eligibility for first workspace setup');
select results_eq(
  $$select user_id, workspace_id, billing_provider, manually_activated, status, stripe_subscription_id
    from public.customer_subscriptions where customer_email = 'new-pilot@example.test'$$,
  $$values ('a6100000-0000-4000-8000-000000000003'::uuid, null::uuid, 'manual'::text, true, 'active'::text, null::text)$$,
  'new pilot retains its own unlinked manual entitlement with no fabricated Stripe subscription'
);
select is((select count(*)::integer from public.workspace_members where user_id = 'a6100000-0000-4000-8000-000000000003'), 0,
  'approval does not add the new pilot to somebody else’s workspace');
select is((select workspace_id from public.customer_subscriptions where customer_email = 'manual-customer@example.test'),
  'b6100000-0000-4000-8000-000000000001'::uuid, 'existing customer workspace mapping remains intact');
reset role;
select * from finish();
rollback;
