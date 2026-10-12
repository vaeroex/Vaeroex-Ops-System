-- Fence concurrent current-provider reads before base-plan reconciliation.
-- No customer entitlement backfill or pricing/storage-pack changes.
-- Deploy this additive migration before the application switches to v2.
-- v1 remains unchanged for signed deletion events and legacy callers.
begin;

create table public.stripe_subscription_observations (
  stripe_subscription_id text primary key,
  generation bigint not null check (generation > 0),
  claimed_at timestamptz not null default statement_timestamp()
);
comment on table public.stripe_subscription_observations is
  'Service-only current-provider observation generations. Claim before reading Stripe; only the latest issued generation may reconcile.';
alter table public.stripe_subscription_observations enable row level security;
revoke all on table public.stripe_subscription_observations from public, anon, authenticated, service_role;
grant select, insert, update on table public.stripe_subscription_observations to service_role;

create or replace function public.claim_stripe_subscription_observation_v1(
  p_stripe_subscription_id text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subscription_id text := btrim(coalesce(p_stripe_subscription_id, ''));
  v_generation bigint;
begin
  if v_subscription_id !~ '^sub_[A-Za-z0-9_]+$' or length(v_subscription_id) > 255 then
    raise exception using errcode = '22023', message = 'Stripe subscription observation identity is invalid.';
  end if;
  -- Same lock domain as both reconciliation RPCs; never held across HTTP.
  perform pg_advisory_xact_lock(hashtextextended(v_subscription_id, 0));
  insert into public.stripe_subscription_observations as observation (
    stripe_subscription_id, generation
  ) values (v_subscription_id, 1)
  on conflict (stripe_subscription_id) do update
    set generation = observation.generation + 1,
        claimed_at = statement_timestamp()
  returning generation into v_generation;
  return v_generation;
end;
$$;

create or replace function public.sync_stripe_subscription_entitlement_v2(
  p_event_id text,
  p_event_created_at timestamptz,
  p_event_type text,
  p_checkout_intent_id uuid,
  p_user_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_customer_email text,
  p_customer_name text,
  p_status text,
  p_plan_slug text,
  p_stripe_price_id text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_last_payment_at timestamptz,
  p_raw_payload jsonb,
  p_observation_generation bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_customer_email, '')));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_plan_slug text := lower(btrim(coalesce(p_plan_slug, '')));
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_subscription_id text := btrim(coalesce(p_stripe_subscription_id, ''));
  v_customer_id text := btrim(coalesce(p_stripe_customer_id, ''));
  v_intent public.stripe_checkout_intents%rowtype;
  v_existing public.customer_subscriptions%rowtype;
  v_user_id uuid;
  v_workspace_id uuid;
  v_record_id uuid;
begin
  if v_event_id = '' or p_event_created_at is null or nullif(btrim(p_event_type), '') is null
    or v_subscription_id = '' or v_customer_id = '' or v_email = '' or v_plan_slug = ''
    or v_status not in ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'expired') then
    raise exception using errcode = '22023', message = 'Stripe subscription synchronization input is invalid.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_subscription_id, 0));

  -- The trusted server claims BEFORE retrieving the current Stripe object.
  -- A later claim fences this reader even if that later read has not committed.
  -- A superseded request must remain unprocessed so provider delivery can retry.
  if p_observation_generation is null or p_observation_generation < 1 then
    raise exception using errcode = '22023', message = 'Stripe subscription observation is required.';
  end if;
  if not exists (
    select 1 from public.stripe_subscription_observations as observation
    where observation.stripe_subscription_id = v_subscription_id
      and observation.generation = p_observation_generation
  ) then
    raise exception using errcode = '40001', message = 'Stripe subscription observation was superseded; retry reconciliation.';
  end if;

  if p_checkout_intent_id is not null then
    select intent.*
    into v_intent
    from public.stripe_checkout_intents as intent
    where intent.id = p_checkout_intent_id
    for update;

    if not found
      or (p_user_id is not null and v_intent.user_id <> p_user_id)
      or (v_intent.stripe_customer_id is not null and v_intent.stripe_customer_id <> v_customer_id) then
      raise exception using errcode = '42501', message = 'Stripe purchase intent attribution is invalid.';
    end if;

    v_user_id := v_intent.user_id;
    v_workspace_id := v_intent.workspace_id;

    if v_workspace_id is not null and not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = v_workspace_id
        and membership.user_id = v_user_id
        and membership.status = 'active'
        and membership.role = 'owner'
    ) then
      raise exception using errcode = '42501', message = 'Stripe purchase intent workspace ownership is invalid.';
    end if;
  else
    v_user_id := p_user_id;
  end if;

  select subscription.*
  into v_existing
  from public.customer_subscriptions as subscription
  where subscription.stripe_subscription_id = v_subscription_id
  for update;

  if not found and p_checkout_intent_id is not null then
    select subscription.*
    into v_existing
    from public.customer_subscriptions as subscription
    where subscription.stripe_checkout_intent_id = p_checkout_intent_id
    for update;
  end if;

  if v_existing.id is not null then
    if v_existing.stripe_subscription_id is not null
      and v_existing.stripe_subscription_id <> v_subscription_id then
      raise exception using errcode = '23514', message = 'Stripe purchase intent is already bound to another subscription.';
    end if;

    if v_existing.stripe_customer_id is not null
      and v_existing.stripe_customer_id <> v_customer_id then
      raise exception using errcode = '23514', message = 'Stripe Customer attribution changed unexpectedly.';
    end if;

    if v_existing.workspace_id is not null
      and v_workspace_id is not null
      and v_existing.workspace_id <> v_workspace_id then
      raise exception using errcode = '42501', message = 'Stripe subscription cannot move between workspaces.';
    end if;

    if v_existing.stripe_last_event_created_at is not null
      and v_existing.stripe_last_event_created_at > p_event_created_at then
      return jsonb_build_object(
        'applied', false,
        'reason', 'stale_event',
        'subscription_record_id', v_existing.id,
        'workspace_id', v_existing.workspace_id,
        'status', v_existing.status
      );
    end if;

    if v_existing.stripe_last_event_created_at = p_event_created_at
      and v_existing.stripe_last_event_id = v_event_id then
      return jsonb_build_object(
        'applied', false,
        'reason', 'duplicate_event',
        'subscription_record_id', v_existing.id,
        'workspace_id', v_existing.workspace_id,
        'status', v_existing.status
      );
    end if;

    -- Stripe canceled and incomplete_expired (mapped to expired) subscriptions
    -- cannot resume. A historical signed deletion may have committed while the
    -- current-provider read was in flight, so terminal state wins at any time.
    if v_existing.status in ('canceled', 'expired')
      and v_status not in ('canceled', 'expired') then
      return jsonb_build_object(
        'applied', false,
        'reason', 'terminal_subscription',
        'subscription_record_id', v_existing.id,
        'workspace_id', v_existing.workspace_id,
        'status', v_existing.status
      );
    end if;

    -- Distinct same-second events may recover nonterminal access only through
    -- the latest issued observation. Legacy v1 callers remain conservative.
    v_user_id := coalesce(v_existing.user_id, v_user_id);
    v_workspace_id := coalesce(v_existing.workspace_id, v_workspace_id);

    update public.customer_subscriptions as subscription
    set user_id = v_user_id,
        workspace_id = v_workspace_id,
        customer_email = v_email,
        customer_name = coalesce(nullif(btrim(p_customer_name), ''), subscription.customer_name),
        source = 'stripe',
        billing_provider = 'stripe',
        plan_slug = v_plan_slug,
        status = v_status,
        stripe_customer_id = v_customer_id,
        stripe_subscription_id = v_subscription_id,
        stripe_price_id = nullif(btrim(p_stripe_price_id), ''),
        stripe_checkout_intent_id = coalesce(p_checkout_intent_id, subscription.stripe_checkout_intent_id),
        current_period_start = p_current_period_start,
        current_period_end = p_current_period_end,
        stripe_current_period_end = p_current_period_end,
        stripe_cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
        canceled_at = p_canceled_at,
        last_payment_at = coalesce(p_last_payment_at, subscription.last_payment_at),
        raw_payload_json = coalesce(p_raw_payload, '{}'::jsonb),
        manually_activated = false,
        manually_activated_by = null,
        stripe_last_event_created_at = p_event_created_at,
        stripe_last_event_id = v_event_id,
        notes = 'Stripe billing event: ' || btrim(p_event_type)
    where subscription.id = v_existing.id
    returning subscription.id into v_record_id;
  else
    if p_checkout_intent_id is null then
      raise exception using errcode = '42501', message = 'A new Stripe entitlement requires a trusted purchase intent.';
    end if;

    if v_user_id is null then
      select profile.id
      into v_user_id
      from public.profiles as profile
      where lower(profile.email) = v_email
      order by profile.created_at, profile.id
      limit 1;
    end if;

    insert into public.customer_subscriptions (
      user_id,
      workspace_id,
      customer_email,
      customer_name,
      source,
      billing_provider,
      plan_slug,
      status,
      stripe_customer_id,
      stripe_subscription_id,
      stripe_price_id,
      stripe_checkout_intent_id,
      current_period_start,
      current_period_end,
      stripe_current_period_end,
      stripe_cancel_at_period_end,
      canceled_at,
      last_payment_at,
      raw_payload_json,
      manually_activated,
      stripe_last_event_created_at,
      stripe_last_event_id,
      notes
    ) values (
      v_user_id,
      v_workspace_id,
      v_email,
      nullif(btrim(p_customer_name), ''),
      'stripe',
      'stripe',
      v_plan_slug,
      v_status,
      v_customer_id,
      v_subscription_id,
      nullif(btrim(p_stripe_price_id), ''),
      p_checkout_intent_id,
      p_current_period_start,
      p_current_period_end,
      p_current_period_end,
      coalesce(p_cancel_at_period_end, false),
      p_canceled_at,
      p_last_payment_at,
      coalesce(p_raw_payload, '{}'::jsonb),
      false,
      p_event_created_at,
      v_event_id,
      'Stripe billing event: ' || btrim(p_event_type)
    )
    returning id into v_record_id;
  end if;

  if p_checkout_intent_id is not null then
    update public.stripe_checkout_intents as intent
    set stripe_customer_id = v_customer_id,
        stripe_subscription_id = v_subscription_id,
        status = case when v_status in ('active', 'trialing') then 'completed' else intent.status end,
        completed_at = case
          when v_status in ('active', 'trialing') then coalesce(intent.completed_at, statement_timestamp())
          else intent.completed_at
        end
    where intent.id = p_checkout_intent_id;
  end if;

  if v_workspace_id is not null then
    update public.workspaces as workspace
    set subscription_status = v_status,
        plan_slug = v_plan_slug
    where workspace.id = v_workspace_id;
  end if;

  return jsonb_build_object(
    'applied', true,
    'subscription_record_id', v_record_id,
    'workspace_id', v_workspace_id,
    'status', v_status,
    'user_id', v_user_id
  );
end;
$$;

revoke all on function public.claim_stripe_subscription_observation_v1(text) from public, anon, authenticated;
grant execute on function public.claim_stripe_subscription_observation_v1(text) to service_role;
revoke all on function public.sync_stripe_subscription_entitlement_v2(
  text, timestamptz, text, uuid, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription_entitlement_v2(
  text, timestamptz, text, uuid, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz, jsonb, bigint
) to service_role;

notify pgrst, 'reload schema';
commit;
