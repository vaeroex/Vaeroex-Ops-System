-- Restore the canonical manual-activation review contract in environments where
-- the original entitlement migration was skipped. This forward fix intentionally
-- contains no historical backfill or customer-row mutation.
create or replace function public.review_manual_activation_request(
  p_request_id uuid,
  p_status text,
  p_reviewed_by uuid,
  p_plan_slug text default 'vaeroex'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  activation_request public.manual_activation_requests%rowtype;
  existing_subscription public.customer_subscriptions%rowtype;
  normalized_email text;
  normalized_status text;
  normalized_plan_slug text;
  profile_id uuid;
  entitlement_id uuid;
  entitlement_workspace_id uuid;
begin
  normalized_status := lower(btrim(coalesce(p_status, '')));
  normalized_plan_slug := lower(btrim(coalesce(p_plan_slug, '')));

  if p_request_id is null
    or p_reviewed_by is null
    or normalized_status not in ('pending', 'approved', 'denied', 'needs_more_info')
    or normalized_plan_slug = '' then
    raise exception using
      errcode = '22023',
      message = 'Activation request review is invalid.';
  end if;

  select request.*
  into activation_request
  from public.manual_activation_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Activation request was not found.';
  end if;

  if activation_request.status = 'approved' and normalized_status <> 'approved' then
    raise exception using
      errcode = '22023',
      message = 'An approved activation request cannot be changed to another status.';
  end if;

  if normalized_status <> 'approved' then
    update public.manual_activation_requests as request
    set status = normalized_status,
        reviewed_by = p_reviewed_by,
        reviewed_at = statement_timestamp()
    where request.id = p_request_id;

    return jsonb_build_object(
      'request_id', p_request_id,
      'request_status', normalized_status,
      'subscription_id', null,
      'workspace_id', null,
      'access_granted', false
    );
  end if;

  normalized_email := lower(btrim(coalesce(activation_request.email, '')));

  if normalized_email = '' then
    raise exception using
      errcode = '22023',
      message = 'Activation request email is invalid.';
  end if;

  if not exists (
    select 1
    from public.subscription_plans as plan
    where plan.slug = normalized_plan_slug
      and plan.is_active = true
  ) then
    raise exception using
      errcode = '23503',
      message = 'Activation plan is unavailable.';
  end if;

  -- Serialize entitlement creation for the normalized account identity.
  perform pg_advisory_xact_lock(hashtextextended(normalized_email, 0));

  select profile.id
  into profile_id
  from public.profiles as profile
  where lower(profile.email) = normalized_email
  order by profile.created_at, profile.id
  limit 1;

  select subscription.*
  into existing_subscription
  from public.customer_subscriptions as subscription
  where (
      lower(subscription.customer_email) = normalized_email
      or (profile_id is not null and subscription.user_id = profile_id)
    )
    and subscription.manually_activated = true
    and (subscription.billing_provider = 'manual' or subscription.source = 'manual')
  order by subscription.created_at desc, subscription.id
  limit 1
  for update;

  entitlement_workspace_id := existing_subscription.workspace_id;

  if entitlement_workspace_id is null and profile_id is not null then
    select workspace.id
    into entitlement_workspace_id
    from public.workspace_members as membership
    join public.workspaces as workspace on workspace.id = membership.workspace_id
    where membership.user_id = profile_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by
      case membership.role when 'owner' then 0 else 1 end,
      membership.created_at,
      workspace.id
    limit 1
    for update of workspace;
  end if;

  if entitlement_workspace_id is null then
    select workspace.id
    into entitlement_workspace_id
    from public.workspaces as workspace
    where (profile_id is not null and workspace.created_by = profile_id)
      or lower(coalesce(workspace.primary_contact_email, '')) = normalized_email
    order by workspace.created_at, workspace.id
    limit 1
    for update;
  end if;

  if existing_subscription.id is null then
    insert into public.customer_subscriptions (
      user_id,
      workspace_id,
      customer_email,
      customer_name,
      source,
      billing_provider,
      plan_slug,
      status,
      raw_payload_json,
      manually_activated,
      manually_activated_by,
      notes
    )
    values (
      profile_id,
      entitlement_workspace_id,
      normalized_email,
      nullif(btrim(activation_request.name), ''),
      'manual',
      'manual',
      normalized_plan_slug,
      'active',
      jsonb_build_object(
        'manual_activation', true,
        'manual_activation_request_id', activation_request.id
      ),
      true,
      p_reviewed_by,
      'Approved from a manual activation request.'
    )
    returning id into entitlement_id;
  else
    entitlement_id := existing_subscription.id;

    update public.customer_subscriptions as subscription
    set user_id = coalesce(profile_id, subscription.user_id),
        workspace_id = coalesce(entitlement_workspace_id, subscription.workspace_id),
        customer_email = normalized_email,
        customer_name = coalesce(nullif(btrim(activation_request.name), ''), subscription.customer_name),
        source = 'manual',
        billing_provider = 'manual',
        plan_slug = normalized_plan_slug,
        status = 'active',
        manually_activated = true,
        manually_activated_by = p_reviewed_by,
        raw_payload_json = coalesce(subscription.raw_payload_json, '{}'::jsonb) || jsonb_build_object(
          'manual_activation', true,
          'manual_activation_request_id', activation_request.id
        )
    where subscription.id = entitlement_id;
  end if;

  if entitlement_workspace_id is not null then
    update public.workspaces as workspace
    set subscription_status = 'active',
        plan_slug = normalized_plan_slug,
        subscription_required = true,
        manually_unlocked = true
    where workspace.id = entitlement_workspace_id;
  end if;

  update public.manual_activation_requests as request
  set status = 'approved',
      reviewed_by = p_reviewed_by,
      reviewed_at = coalesce(request.reviewed_at, statement_timestamp())
  where request.id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'request_status', 'approved',
    'subscription_id', entitlement_id,
    'workspace_id', entitlement_workspace_id,
    'access_granted', true
  );
end;
$$;

revoke all on function public.review_manual_activation_request(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.review_manual_activation_request(uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';
