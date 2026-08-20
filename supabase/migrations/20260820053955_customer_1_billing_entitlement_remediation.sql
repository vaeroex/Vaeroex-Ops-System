-- Customer #1 billing remediation.
--
-- This migration adds durable, service-only Stripe purchase intents and exact
-- subscription/workspace linkage. It performs no customer-row backfill. The
-- unique indexes apply to trusted purchase-intent rows created by this
-- contract. Legacy provider rows remain untouched and cannot become linked
-- entitlement without passing the new purchase-intent authority boundary.

begin;

create table public.stripe_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  workspace_id uuid references public.workspaces(id) on delete restrict,
  plan_slug text not null references public.subscription_plans(slug) on update cascade,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  status text not null default 'pending'
    check (status in ('pending', 'session_created', 'completed', 'expired', 'failed')),
  session_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

comment on table public.stripe_checkout_intents is
  'Service-only purchase-intent ledger. It binds one authenticated Vaeroex identity to one idempotent Stripe Checkout attempt.';

alter table public.stripe_checkout_intents enable row level security;
revoke all on table public.stripe_checkout_intents from public, anon, authenticated;

create unique index stripe_checkout_intents_open_user_plan_uidx
  on public.stripe_checkout_intents(user_id, plan_slug)
  where status in ('pending', 'session_created');

create unique index stripe_checkout_intents_session_uidx
  on public.stripe_checkout_intents(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index stripe_checkout_intents_subscription_uidx
  on public.stripe_checkout_intents(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index stripe_checkout_intents_workspace_idx
  on public.stripe_checkout_intents(workspace_id)
  where workspace_id is not null;

create trigger set_stripe_checkout_intents_updated_at
  before update on public.stripe_checkout_intents
  for each row execute function public.set_updated_at();

alter table public.customer_subscriptions
  add column stripe_checkout_intent_id uuid references public.stripe_checkout_intents(id) on delete restrict,
  add column stripe_last_event_created_at timestamptz,
  add column stripe_last_event_id text;

create unique index customer_subscriptions_stripe_intent_uidx
  on public.customer_subscriptions(stripe_checkout_intent_id)
  where stripe_checkout_intent_id is not null;

create unique index customer_subscriptions_stripe_current_user_uidx
  on public.customer_subscriptions(user_id, plan_slug)
  where billing_provider = 'stripe'
    and stripe_checkout_intent_id is not null
    and user_id is not null
    and status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete');

create unique index customer_subscriptions_stripe_current_email_uidx
  on public.customer_subscriptions(lower(customer_email), plan_slug)
  where billing_provider = 'stripe'
    and stripe_checkout_intent_id is not null
    and status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete');

create unique index customer_subscriptions_stripe_current_workspace_uidx
  on public.customer_subscriptions(workspace_id, plan_slug)
  where billing_provider = 'stripe'
    and stripe_checkout_intent_id is not null
    and workspace_id is not null
    and status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete');

create unique index customer_subscriptions_stripe_trusted_subscription_uidx
  on public.customer_subscriptions(stripe_subscription_id)
  where billing_provider = 'stripe'
    and stripe_checkout_intent_id is not null
    and stripe_subscription_id is not null;

create or replace function public.claim_stripe_checkout_intent_v1(
  p_user_id uuid,
  p_email text,
  p_plan_slug text default 'vaeroex'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_plan_slug text := lower(btrim(coalesce(p_plan_slug, '')));
  v_profile public.profiles%rowtype;
  v_existing public.customer_subscriptions%rowtype;
  v_intent public.stripe_checkout_intents%rowtype;
  v_workspace_id uuid;
  v_workspace_count integer;
  v_customer_id text;
begin
  if p_user_id is null or v_email = '' or v_plan_slug = '' then
    raise exception using errcode = '22023', message = 'Checkout identity is invalid.';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found or lower(coalesce(v_profile.email, '')) <> v_email then
    raise exception using errcode = '42501', message = 'Checkout identity could not be verified.';
  end if;

  if not exists (
    select 1
    from public.subscription_plans as plan
    where plan.slug = v_plan_slug
      and plan.is_active = true
  ) then
    raise exception using errcode = '23503', message = 'Checkout plan is unavailable.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_plan_slug, 0));

  select (array_agg(membership.workspace_id order by membership.created_at, membership.workspace_id))[1], count(*)
  into v_workspace_id, v_workspace_count
  from public.workspace_members as membership
  where membership.user_id = p_user_id
    and membership.status = 'active'
    and membership.role = 'owner';

  if v_workspace_count > 1 then
    raise exception using errcode = '21000', message = 'Checkout workspace ownership is ambiguous.';
  end if;

  select subscription.*
  into v_existing
  from public.customer_subscriptions as subscription
  where subscription.billing_provider = 'stripe'
    and subscription.plan_slug = v_plan_slug
    and (
      subscription.user_id = p_user_id
      or (subscription.user_id is null and lower(subscription.customer_email) = v_email)
    )
    and subscription.status in ('active', 'trialing', 'past_due', 'unpaid', 'incomplete')
  order by subscription.created_at desc, subscription.id
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'state', 'existing_subscription',
      'subscription_id', v_existing.id,
      'workspace_id', v_existing.workspace_id,
      'status', v_existing.status,
      'stripe_customer_id', v_existing.stripe_customer_id,
      'stripe_subscription_id', v_existing.stripe_subscription_id
    );
  end if;

  select subscription.stripe_customer_id
  into v_customer_id
  from public.customer_subscriptions as subscription
  where subscription.billing_provider = 'stripe'
    and subscription.stripe_customer_id is not null
    and (
      subscription.user_id = p_user_id
      or (subscription.user_id is null and lower(subscription.customer_email) = v_email)
    )
  order by subscription.created_at desc, subscription.id
  limit 1;

  select intent.*
  into v_intent
  from public.stripe_checkout_intents as intent
  where intent.user_id = p_user_id
    and intent.plan_slug = v_plan_slug
    and intent.status in ('pending', 'session_created')
  order by intent.created_at desc, intent.id
  limit 1
  for update;

  if found and v_intent.status = 'session_created'
    and v_intent.session_expires_at is not null
    and v_intent.session_expires_at <= statement_timestamp() then
    update public.stripe_checkout_intents as intent
    set status = 'expired'
    where intent.id = v_intent.id;
    v_intent.id := null;
  end if;

  if v_intent.id is null then
    insert into public.stripe_checkout_intents (
      user_id,
      workspace_id,
      plan_slug,
      stripe_customer_id,
      status
    ) values (
      p_user_id,
      v_workspace_id,
      v_plan_slug,
      v_customer_id,
      'pending'
    )
    returning * into v_intent;
  end if;

  return jsonb_build_object(
    'state', 'checkout_intent',
    'intent_id', v_intent.id,
    'workspace_id', v_intent.workspace_id,
    'status', v_intent.status,
    'stripe_customer_id', coalesce(v_intent.stripe_customer_id, v_customer_id),
    'stripe_checkout_session_id', v_intent.stripe_checkout_session_id,
    'session_expires_at', v_intent.session_expires_at
  );
end;
$$;

create or replace function public.record_stripe_checkout_session_v1(
  p_intent_id uuid,
  p_user_id uuid,
  p_session_id text,
  p_customer_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_intent public.stripe_checkout_intents%rowtype;
begin
  if p_intent_id is null or p_user_id is null
    or nullif(btrim(p_session_id), '') is null
    or p_expires_at is null
    or p_expires_at <= statement_timestamp() then
    raise exception using errcode = '22023', message = 'Checkout Session attribution is invalid.';
  end if;

  select intent.*
  into v_intent
  from public.stripe_checkout_intents as intent
  where intent.id = p_intent_id
  for update;

  if not found or v_intent.user_id <> p_user_id then
    raise exception using errcode = '42501', message = 'Checkout intent ownership is invalid.';
  end if;

  if v_intent.status = 'completed'
    and v_intent.stripe_checkout_session_id = btrim(p_session_id) then
    return jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status);
  end if;

  if v_intent.status not in ('pending', 'session_created')
    or (v_intent.stripe_checkout_session_id is not null
      and v_intent.stripe_checkout_session_id <> btrim(p_session_id))
    or (v_intent.stripe_customer_id is not null
      and p_customer_id is not null
      and v_intent.stripe_customer_id <> btrim(p_customer_id)) then
    raise exception using errcode = '23514', message = 'Checkout intent cannot accept this Session.';
  end if;

  update public.stripe_checkout_intents as intent
  set status = 'session_created',
      stripe_checkout_session_id = btrim(p_session_id),
      stripe_customer_id = coalesce(nullif(btrim(p_customer_id), ''), intent.stripe_customer_id),
      session_expires_at = p_expires_at
  where intent.id = p_intent_id;

  return jsonb_build_object('intent_id', p_intent_id, 'status', 'session_created');
end;
$$;

create or replace function public.expire_stripe_checkout_intent_v1(
  p_intent_id uuid,
  p_user_id uuid,
  p_session_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.stripe_checkout_intents as intent
  set status = 'expired'
  where intent.id = p_intent_id
    and intent.user_id = p_user_id
    and intent.status in ('session_created', 'expired')
    and intent.stripe_checkout_session_id = nullif(btrim(p_session_id), '');

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.sync_stripe_subscription_entitlement_v1(
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
  p_raw_payload jsonb
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

    if v_existing.stripe_last_event_created_at = p_event_created_at
      and (case v_existing.status
        when 'canceled' then 6
        when 'expired' then 6
        when 'unpaid' then 5
        when 'past_due' then 4
        when 'incomplete' then 3
        when 'trialing' then 2
        when 'active' then 2
        else 1
      end) >= (case v_status
        when 'canceled' then 6
        when 'expired' then 6
        when 'unpaid' then 5
        when 'past_due' then 4
        when 'incomplete' then 3
        when 'trialing' then 2
        when 'active' then 2
        else 1
      end) then
      return jsonb_build_object(
        'applied', false,
        'reason', 'stale_event',
        'subscription_record_id', v_existing.id,
        'workspace_id', v_existing.workspace_id,
        'status', v_existing.status
      );
    end if;

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

create or replace function public.create_workspace_with_signed_agreement_v2(
  p_workspace_id uuid,
  p_agreement_id uuid,
  p_user_id uuid,
  p_authenticated_email text,
  p_entitlement_id uuid,
  p_organization_name text,
  p_owner_legal_name text,
  p_owner_job_title text,
  p_owner_business_email text,
  p_business_type text,
  p_team_size text,
  p_number_of_locations text,
  p_subscription_status text,
  p_plan_slug text,
  p_subscription_required boolean,
  p_manually_unlocked boolean,
  p_agreement_version text,
  p_terms_version text,
  p_privacy_version text,
  p_agreement_text text,
  p_agreement_snapshot_json jsonb,
  p_typed_signature text,
  p_signed_at timestamptz,
  p_application_version text,
  p_immutable_hash text,
  p_pdf_sha256 text,
  p_pdf_size_bytes bigint,
  p_storage_bucket text,
  p_storage_path text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement public.customer_subscriptions%rowtype;
  v_email text := lower(btrim(coalesce(p_authenticated_email, '')));
  v_is_stripe boolean := false;
begin
  if p_user_id is null or v_email = '' then
    raise exception using errcode = '42501', message = 'Authenticated workspace identity is invalid.';
  end if;

  if p_entitlement_id is not null then
    select subscription.*
    into v_entitlement
    from public.customer_subscriptions as subscription
    where subscription.id = p_entitlement_id
    for update;

    if not found
      or lower(v_entitlement.customer_email) <> v_email
      or (v_entitlement.user_id is not null and v_entitlement.user_id <> p_user_id)
      or v_entitlement.workspace_id is not null
      or v_entitlement.plan_slug is distinct from p_plan_slug then
      raise exception using errcode = '42501', message = 'Workspace entitlement ownership is invalid.';
    end if;

    v_is_stripe := v_entitlement.billing_provider = 'stripe';

    if v_is_stripe then
      if v_entitlement.manually_activated
        or v_entitlement.status not in ('active', 'trialing')
        or v_entitlement.current_period_end is null
        or v_entitlement.current_period_end <= statement_timestamp()
        or v_entitlement.stripe_customer_id is null
        or v_entitlement.stripe_subscription_id is null
        or p_manually_unlocked then
        raise exception using errcode = '42501', message = 'Stripe workspace entitlement is not active.';
      end if;
    elsif not (
      v_entitlement.billing_provider = 'manual'
      and v_entitlement.manually_activated
      and v_entitlement.status in ('active', 'trialing')
      and p_manually_unlocked
    ) then
      raise exception using errcode = '42501', message = 'Manual workspace entitlement is not active.';
    end if;

    if p_subscription_status is distinct from v_entitlement.status then
      raise exception using errcode = '23514', message = 'Workspace subscription status is stale.';
    end if;
  elsif p_subscription_status not in ('manual_review', 'demo') or p_manually_unlocked then
    raise exception using errcode = '42501', message = 'A paid workspace requires an exact entitlement.';
  end if;

  perform public.create_workspace_with_signed_agreement(
    p_workspace_id,
    p_agreement_id,
    p_user_id,
    p_organization_name,
    p_owner_legal_name,
    p_owner_job_title,
    p_owner_business_email,
    p_business_type,
    p_team_size,
    p_number_of_locations,
    p_subscription_status,
    p_plan_slug,
    p_subscription_required,
    p_manually_unlocked,
    p_agreement_version,
    p_terms_version,
    p_privacy_version,
    p_agreement_text,
    p_agreement_snapshot_json,
    p_typed_signature,
    p_signed_at,
    p_application_version,
    p_immutable_hash,
    p_pdf_sha256,
    p_pdf_size_bytes,
    p_storage_bucket,
    p_storage_path
  );

  if p_entitlement_id is not null then
    update public.customer_subscriptions as subscription
    set user_id = p_user_id,
        workspace_id = p_workspace_id
    where subscription.id = p_entitlement_id;

    if v_is_stripe and v_entitlement.stripe_checkout_intent_id is not null then
      update public.stripe_checkout_intents as intent
      set workspace_id = p_workspace_id
      where intent.id = v_entitlement.stripe_checkout_intent_id
        and intent.user_id = p_user_id;
    end if;

    insert into public.security_audit_events (
      workspace_id,
      user_id,
      action_name,
      operation_type,
      target_table,
      target_record_id,
      initiated_by,
      required_confirmation,
      confirmation_received,
      allowed,
      request_id,
      metadata_json,
      created_at
    ) values (
      p_workspace_id,
      p_user_id,
      'workspace_entitlement_linked',
      'BILLING',
      'customer_subscriptions',
      p_entitlement_id::text,
      'system',
      false,
      false,
      true,
      p_agreement_id::text,
      jsonb_build_object(
        'billing_provider', v_entitlement.billing_provider,
        'plan_slug', v_entitlement.plan_slug
      ),
      p_signed_at
    );
  end if;

  return p_workspace_id;
end;
$$;

revoke all on function public.claim_stripe_checkout_intent_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_checkout_intent_v1(uuid, text, text) to service_role;

revoke all on function public.record_stripe_checkout_session_v1(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_stripe_checkout_session_v1(uuid, uuid, text, text, timestamptz) to service_role;

revoke all on function public.expire_stripe_checkout_intent_v1(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.expire_stripe_checkout_intent_v1(uuid, uuid, text) to service_role;

revoke all on function public.sync_stripe_subscription_entitlement_v1(
  text, timestamptz, text, uuid, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription_entitlement_v1(
  text, timestamptz, text, uuid, uuid, text, text, text, text, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz, timestamptz, jsonb
) to service_role;

revoke all on function public.create_workspace_with_signed_agreement_v2(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  boolean, boolean, text, text, text, text, jsonb, text, timestamptz, text, text, text,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.create_workspace_with_signed_agreement_v2(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, text, text, text, text,
  boolean, boolean, text, text, text, text, jsonb, text, timestamptz, text, text, text,
  bigint, text, text
) to service_role;

notify pgrst, 'reload schema';

commit;
