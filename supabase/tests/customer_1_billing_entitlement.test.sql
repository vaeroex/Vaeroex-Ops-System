create extension if not exists dblink with schema extensions;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

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

select ok(
  not has_table_privilege('anon', 'public.stripe_checkout_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.stripe_checkout_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.stripe_checkout_intents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.stripe_checkout_intents', 'UPDATE'),
  'purchase intents are not exposed to customer-facing roles'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_stripe_checkout_intent_v1(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_stripe_checkout_intent_v1(uuid,text,text)', 'EXECUTE'),
  'only the trusted server can claim Checkout intents'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.sync_stripe_subscription_entitlement_v1(text,timestamptz,text,uuid,uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,jsonb)',
    'EXECUTE'
  ),
  'customers cannot invoke Stripe entitlement synchronization'
);

insert into public.profiles (id, email, full_name) values
  ('aa200000-0000-4000-8000-000000000001', 'billing-owner@example.test', 'Billing Owner'),
  ('aa200000-0000-4000-8000-000000000002', 'billing-attacker@example.test', 'Billing Attacker');

-- Production predates Supabase's opt-in Data API grant default. Mirror only the
-- trusted server operations exercised by this suite so SECURITY INVOKER billing
-- functions reach their real authority checks on a fresh local stack. These
-- test-only grants are transaction-scoped and disappear at rollback.
grant select, update on table public.profiles to service_role;
grant select on table public.subscription_plans to service_role;
grant select, insert, update on table public.stripe_checkout_intents to service_role;
grant select, insert, update on table public.customer_subscriptions to service_role;
grant select, insert, update on table public.workspaces to service_role;
grant select, insert on table public.workspace_members to service_role;
grant insert on table public.audit_logs to service_role;
grant insert on table public.security_audit_events to service_role;

set local role service_role;

select is(
  public.claim_stripe_checkout_intent_v1(
    'aa200000-0000-4000-8000-000000000001',
    'billing-owner@example.test',
    'vaeroex'
  ) ->> 'state',
  'checkout_intent',
  'a verified account receives a durable purchase intent'
);

select is(
  (
    public.claim_stripe_checkout_intent_v1(
      'aa200000-0000-4000-8000-000000000001',
      'billing-owner@example.test',
      'vaeroex'
    ) ->> 'intent_id'
  )::uuid,
  (
    select intent.id
    from public.stripe_checkout_intents as intent
    where intent.user_id = 'aa200000-0000-4000-8000-000000000001'
      and intent.status = 'pending'
  ),
  'a repeated claim reuses the same open purchase intent'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.claim_stripe_checkout_intent_v1(
      'aa200000-0000-4000-8000-000000000002',
      'billing-owner@example.test',
      'vaeroex'
    )$$,
    '42501'
  ),
  'another user cannot claim the purchase intent'
);

select is(
  public.record_stripe_checkout_session_v1(
    (select id from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000001'),
    'aa200000-0000-4000-8000-000000000001',
    'cs_test_customer_1',
    'cus_test_customer_1',
    '2099-01-01T00:00:00Z'
  ) ->> 'status',
  'session_created',
  'the exact Checkout Session is recorded once'
);

select is(
  public.record_stripe_checkout_session_v1(
    (select id from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000001'),
    'aa200000-0000-4000-8000-000000000001',
    'cs_test_customer_1',
    'cus_test_customer_1',
    '2099-01-01T00:00:00Z'
  ) ->> 'status',
  'session_created',
  'recording the same Checkout Session is idempotent'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_active',
    '2026-08-20T01:00:00Z',
    'checkout.session.completed',
    (select id from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000001'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'active',
    'vaeroex',
    'price_test_vaeroex',
    '2026-08-20T00:00:00Z',
    '2099-09-20T00:00:00Z',
    false,
    null,
    '2026-08-20T01:00:00Z',
    '{}'::jsonb
  ) ->> 'applied',
  'true',
  'a completed Checkout creates one authoritative Stripe entitlement'
);

select is(
  (select count(*)::integer from public.customer_subscriptions where stripe_subscription_id = 'sub_test_customer_1'),
  1,
  'webhook reconciliation creates exactly one subscription record'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_active',
    '2026-08-20T01:00:00Z',
    'checkout.session.completed',
    (select id from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000001'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'active',
    'vaeroex',
    'price_test_vaeroex',
    '2026-08-20T00:00:00Z',
    '2099-09-20T00:00:00Z',
    false,
    null,
    '2026-08-20T01:00:00Z',
    '{}'::jsonb
  ) ->> 'reason',
  'duplicate_event',
  'webhook replay is accepted without a duplicate mutation'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_stale',
    '2026-08-19T23:00:00Z',
    'customer.subscription.deleted',
    (select id from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000001'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'canceled',
    'vaeroex',
    'price_test_vaeroex',
    '2026-08-01T00:00:00Z',
    '2026-08-20T00:00:00Z',
    false,
    '2026-08-19T23:00:00Z',
    null,
    '{}'::jsonb
  ) ->> 'reason',
  'stale_event',
  'a stale provider event cannot resurrect access'
);

select is(
  (select status from public.customer_subscriptions where stripe_subscription_id = 'sub_test_customer_1'),
  'active',
  'stale webhook delivery leaves the current authoritative status unchanged'
);

insert into public.stripe_checkout_intents (id, user_id, plan_slug, status) values
  ('dd200000-0000-4000-8000-000000000001', 'aa200000-0000-4000-8000-000000000001', 'vaeroex', 'completed'),
  ('dd200000-0000-4000-8000-000000000002', 'aa200000-0000-4000-8000-000000000002', 'vaeroex', 'completed');

select ok(
  pg_temp.raises_sqlstate(
    $$select public.sync_stripe_subscription_entitlement_v1(
      'evt_unattributed', '2026-08-20T01:30:00Z', 'customer.subscription.created',
      null, 'aa200000-0000-4000-8000-000000000001', 'sub_unattributed',
      'cus_unattributed', 'billing-owner@example.test', 'Billing Owner', 'active',
      'vaeroex', 'price_test_vaeroex', '2026-08-20T00:00:00Z', '2099-09-20T00:00:00Z',
      false, null, null, '{}'::jsonb
    )$$,
    '42501'
  ),
  'a new provider subscription cannot create entitlement without a trusted purchase intent'
);

select ok(
  pg_temp.raises_sqlstate(
    format(
      $sql$select public.sync_stripe_subscription_entitlement_v1(
        'evt_customer_1_attack', '2026-08-20T02:00:00Z', 'customer.subscription.updated',
        %L, 'aa200000-0000-4000-8000-000000000002', 'sub_test_customer_1',
        'cus_test_customer_1', 'billing-owner@example.test', 'Billing Owner', 'active',
        'vaeroex', 'price_test_vaeroex', '2026-08-20T00:00:00Z', '2099-09-20T00:00:00Z',
        false, null, null, '{}'::jsonb
      )$sql$,
      (select id from public.stripe_checkout_intents where stripe_checkout_session_id = 'cs_test_customer_1')
    ),
    '42501'
  ),
  'a tenant cannot attach another identity to the subscription'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.customer_subscriptions (
      user_id, customer_email, source, billing_provider, plan_slug, status, stripe_checkout_intent_id,
      stripe_customer_id, stripe_subscription_id, current_period_end
    ) values (
      'aa200000-0000-4000-8000-000000000001', 'billing-owner@example.test', 'stripe',
      'stripe', 'vaeroex', 'active', 'dd200000-0000-4000-8000-000000000001',
      'cus_duplicate', 'sub_duplicate', '2099-09-20T00:00:00Z'
    )$$,
    '23505'
  ),
  'database uniqueness rejects a second trusted current Stripe entitlement for one account'
);

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.customer_subscriptions (
      user_id, customer_email, source, billing_provider, plan_slug, status, stripe_checkout_intent_id,
      stripe_customer_id, stripe_subscription_id, current_period_end
    ) values (
      'aa200000-0000-4000-8000-000000000002', 'billing-attacker@example.test', 'stripe',
      'stripe', 'vaeroex', 'active', 'dd200000-0000-4000-8000-000000000002',
      'cus_other', 'sub_test_customer_1', '2099-09-20T00:00:00Z'
    )$$,
    '23505'
  ),
  'one Stripe Subscription ID cannot bind to two trusted purchase intents'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_cancel_scheduled',
    '2026-08-20T03:00:00Z',
    'customer.subscription.updated',
    (select id from public.stripe_checkout_intents where stripe_checkout_session_id = 'cs_test_customer_1'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'active',
    'vaeroex',
    'price_test_vaeroex',
    '2026-08-20T00:00:00Z',
    '2099-09-20T00:00:00Z',
    true,
    null,
    null,
    '{}'::jsonb
  ) ->> 'status',
  'active',
  'cancel-at-period-end remains active through the paid period'
);

select is(
  public.create_workspace_with_signed_agreement_v2(
    'bb200000-0000-4000-8000-000000000001',
    'cc200000-0000-4000-8000-000000000001',
    'aa200000-0000-4000-8000-000000000001',
    'billing-owner@example.test',
    (select id from public.customer_subscriptions where stripe_subscription_id = 'sub_test_customer_1'),
    'Customer One Company',
    'Billing Owner',
    'Owner',
    'billing-owner@example.test',
    'Software',
    null,
    null,
    'active',
    'vaeroex',
    true,
    false,
    'agreement-test-v1',
    'terms-test-v1',
    'privacy-test-v1',
    'Test agreement',
    jsonb_build_object(
      'agreementId', 'cc200000-0000-4000-8000-000000000001',
      'workspaceId', 'bb200000-0000-4000-8000-000000000001',
      'agreementVersion', 'agreement-test-v1',
      'termsVersion', 'terms-test-v1',
      'privacyVersion', 'privacy-test-v1',
      'organizationName', 'Customer One Company',
      'owner', jsonb_build_object('legalName', 'Billing Owner', 'jobTitle', 'Owner', 'businessEmail', 'billing-owner@example.test'),
      'businessType', 'Software',
      'teamSize', null,
      'numberOfLocations', null,
      'agreementText', 'Test agreement',
      'typedSignature', 'Billing Owner',
      'signedAt', '2026-08-20T04:00:00Z',
      'authenticatedUserId', 'aa200000-0000-4000-8000-000000000001',
      'applicationVersion', 'test-build',
      'recordClass', 'legal_agreement',
      'sections', jsonb_build_array(1, 2, 3, 4, 5),
      'eligibility', jsonb_build_object(
        'business_memory_eligible', false,
        'evidence_eligible', false,
        'embedding_eligible', false,
        'executive_intelligence_eligible', false,
        'retrieval_eligible', false
      )
    ),
    'Billing Owner',
    '2026-08-20T04:00:00Z',
    'test-build',
    repeat('a', 64),
    repeat('b', 64),
    1024,
    'workspace-agreements',
    'bb200000-0000-4000-8000-000000000001/cc200000-0000-4000-8000-000000000001.pdf'
  ),
  'bb200000-0000-4000-8000-000000000001'::uuid,
  'the signed workspace transaction completes for the exact entitlement'
);

select is(
  (
    select subscription.workspace_id
    from public.customer_subscriptions as subscription
    where subscription.stripe_subscription_id = 'sub_test_customer_1'
  ),
  'bb200000-0000-4000-8000-000000000001'::uuid,
  'the exact Stripe entitlement links atomically to the new workspace'
);

select is(
  (
    select intent.workspace_id
    from public.stripe_checkout_intents as intent
    where intent.stripe_checkout_session_id = 'cs_test_customer_1'
  ),
  'bb200000-0000-4000-8000-000000000001'::uuid,
  'the trusted purchase intent records the same workspace binding'
);

select ok(
  pg_temp.raises_sqlstate(
    format(
      $sql$select public.create_workspace_with_signed_agreement_v2(
        'bb200000-0000-4000-8000-000000000002', 'cc200000-0000-4000-8000-000000000002',
        'aa200000-0000-4000-8000-000000000001', 'billing-owner@example.test', %L,
        'Second Company', 'Billing Owner', 'Owner', 'billing-owner@example.test', 'Software',
        null, null, 'active', 'vaeroex', true, false, 'v1', 'v1', 'v1', 'text', '{}'::jsonb,
        'Billing Owner', '2026-08-20T05:00:00Z', 'test', %L, %L, 1,
        'workspace-agreements', 'bb200000-0000-4000-8000-000000000002/cc200000-0000-4000-8000-000000000002.pdf'
      )$sql$,
      (select id from public.customer_subscriptions where stripe_subscription_id = 'sub_test_customer_1'),
      repeat('a', 64),
      repeat('b', 64)
    ),
    '42501'
  ),
  'one subscription cannot be attached to a second workspace'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_period_end',
    '2099-09-20T00:00:01Z',
    'customer.subscription.deleted',
    (select id from public.stripe_checkout_intents where stripe_checkout_session_id = 'cs_test_customer_1'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'canceled',
    'vaeroex',
    'price_test_vaeroex',
    '2099-08-20T00:00:00Z',
    '2099-09-20T00:00:00Z',
    false,
    '2099-09-20T00:00:00Z',
    null,
    '{}'::jsonb
  ) ->> 'status',
  'canceled',
  'the terminal provider state ends entitlement after the paid period'
);

select is(
  (select subscription_status from public.workspaces where id = 'bb200000-0000-4000-8000-000000000001'),
  'canceled',
  'the workspace cache follows the terminal provider state without becoming authority'
);

select is(
  public.sync_stripe_subscription_entitlement_v1(
    'evt_customer_1_equal_time_active',
    '2099-09-20T00:00:01Z',
    'customer.subscription.updated',
    (select id from public.stripe_checkout_intents where stripe_checkout_session_id = 'cs_test_customer_1'),
    'aa200000-0000-4000-8000-000000000001',
    'sub_test_customer_1',
    'cus_test_customer_1',
    'billing-owner@example.test',
    'Billing Owner',
    'active',
    'vaeroex',
    'price_test_vaeroex',
    '2099-08-20T00:00:00Z',
    '2099-10-20T00:00:00Z',
    false,
    null,
    null,
    '{}'::jsonb
  ) ->> 'reason',
  'stale_event',
  'an equal-timestamp active event cannot resurrect a terminal subscription'
);

select is(
  (select status from public.customer_subscriptions where stripe_subscription_id = 'sub_test_customer_1'),
  'canceled',
  'equal-timestamp ordering preserves the terminal provider state'
);

reset role;

-- Exercise the purchase-intent advisory lock from eight real database sessions.
select extensions.dblink_connect(
  connection_name,
  convert_from(
    decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (
  values
    ('checkout_concurrency_1'), ('checkout_concurrency_2'), ('checkout_concurrency_3'), ('checkout_concurrency_4'),
    ('checkout_concurrency_5'), ('checkout_concurrency_6'), ('checkout_concurrency_7'), ('checkout_concurrency_8')
) as connections(connection_name);

select extensions.dblink_exec(
  'checkout_concurrency_1',
  $fixture$
    insert into public.profiles (id, email, full_name)
    values ('aa200000-0000-4000-8000-000000000008', 'billing-concurrent@example.test', 'Concurrent Billing')
  $fixture$
);

select extensions.dblink_exec(connection_name, 'set role service_role')
from (
  values
    ('checkout_concurrency_1'), ('checkout_concurrency_2'), ('checkout_concurrency_3'), ('checkout_concurrency_4'),
    ('checkout_concurrency_5'), ('checkout_concurrency_6'), ('checkout_concurrency_7'), ('checkout_concurrency_8')
) as connections(connection_name);

select extensions.dblink_send_query(
  connection_name,
  $query$
    select public.claim_stripe_checkout_intent_v1(
      'aa200000-0000-4000-8000-000000000008',
      'billing-concurrent@example.test',
      'vaeroex'
    ) ->> 'intent_id'
  $query$
)
from (
  values
    ('checkout_concurrency_1'), ('checkout_concurrency_2'), ('checkout_concurrency_3'), ('checkout_concurrency_4'),
    ('checkout_concurrency_5'), ('checkout_concurrency_6'), ('checkout_concurrency_7'), ('checkout_concurrency_8')
) as connections(connection_name);

create temporary table concurrent_checkout_results (intent_id uuid not null) on commit drop;

insert into concurrent_checkout_results (intent_id)
select result.intent_id
from (
  values
    ('checkout_concurrency_1'), ('checkout_concurrency_2'), ('checkout_concurrency_3'), ('checkout_concurrency_4'),
    ('checkout_concurrency_5'), ('checkout_concurrency_6'), ('checkout_concurrency_7'), ('checkout_concurrency_8')
) as connections(connection_name)
cross join lateral extensions.dblink_get_result(connections.connection_name) as result(intent_id uuid);

do $drain$
declare
  connection_name text;
begin
  foreach connection_name in array array[
    'checkout_concurrency_1', 'checkout_concurrency_2', 'checkout_concurrency_3', 'checkout_concurrency_4',
    'checkout_concurrency_5', 'checkout_concurrency_6', 'checkout_concurrency_7', 'checkout_concurrency_8'
  ] loop
    perform * from extensions.dblink_get_result(connection_name) as result(intent_id uuid);
  end loop;
end;
$drain$;

select is(
  (select count(*)::integer from concurrent_checkout_results),
  8,
  'all eight concurrent Checkout claims complete'
);

select is(
  (select count(distinct intent_id)::integer from concurrent_checkout_results),
  1,
  'eight concurrent Checkout claims resolve to one purchase intent'
);

select extensions.dblink_exec(
  'checkout_concurrency_1',
  $cleanup$
    reset role;
    delete from public.stripe_checkout_intents where user_id = 'aa200000-0000-4000-8000-000000000008';
    delete from public.profiles where id = 'aa200000-0000-4000-8000-000000000008'
  $cleanup$
);

select extensions.dblink_disconnect(connection_name)
from (
  values
    ('checkout_concurrency_1'), ('checkout_concurrency_2'), ('checkout_concurrency_3'), ('checkout_concurrency_4'),
    ('checkout_concurrency_5'), ('checkout_concurrency_6'), ('checkout_concurrency_7'), ('checkout_concurrency_8')
) as connections(connection_name);

select * from finish();
rollback;
