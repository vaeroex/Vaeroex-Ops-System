create table if not exists public.workspace_admin_lifecycle (
  workspace_id uuid primary key references public.workspaces(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  restored_at timestamptz,
  restored_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_admin_lifecycle_restore_state_check check (
    archived_at is null
    or (restored_at is null and restored_by is null)
  )
);

create index if not exists workspace_admin_lifecycle_archived_idx
  on public.workspace_admin_lifecycle(archived_at, workspace_id);

create index if not exists workspaces_admin_company_name_idx
  on public.workspaces(lower(name), id);

create index if not exists workspaces_admin_contact_email_idx
  on public.workspaces(lower(primary_contact_email), id)
  where primary_contact_email is not null;

create index if not exists customer_subscriptions_admin_workspace_status_idx
  on public.customer_subscriptions(workspace_id, status, updated_at desc)
  where workspace_id is not null;

drop trigger if exists set_workspace_admin_lifecycle_updated_at on public.workspace_admin_lifecycle;
create trigger set_workspace_admin_lifecycle_updated_at
  before update on public.workspace_admin_lifecycle
  for each row execute function public.set_updated_at();

alter table public.workspace_admin_lifecycle enable row level security;

revoke all privileges on table public.workspace_admin_lifecycle
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.workspace_admin_lifecycle
  to service_role;

create or replace function public.transition_workspace_admin_lifecycle(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  workspace_row public.workspaces%rowtype;
  lifecycle_row public.workspace_admin_lifecycle%rowtype;
  normalized_action text;
  linked_subscription_allows_access boolean;
  workspace_allows_access boolean;
begin
  normalized_action := lower(btrim(coalesce(p_action, '')));

  if p_workspace_id is null
    or p_actor_id is null
    or normalized_action not in ('archive', 'restore') then
    raise exception using
      errcode = '22023',
      message = 'Workspace lifecycle transition is invalid.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Workspace lifecycle actor was not found.';
  end if;

  select workspace.*
  into workspace_row
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace was not found.';
  end if;

  select lifecycle.*
  into lifecycle_row
  from public.workspace_admin_lifecycle as lifecycle
  where lifecycle.workspace_id = p_workspace_id
  for update;

  if normalized_action = 'restore' then
    if lifecycle_row.workspace_id is null or lifecycle_row.archived_at is null then
      return jsonb_build_object(
        'workspace_id', p_workspace_id,
        'status', 'restored',
        'changed', false
      );
    end if;

    update public.workspace_admin_lifecycle as lifecycle
    set archived_at = null,
        archived_by = null,
        restored_at = statement_timestamp(),
        restored_by = p_actor_id
    where lifecycle.workspace_id = p_workspace_id;

    return jsonb_build_object(
      'workspace_id', p_workspace_id,
      'status', 'restored',
      'changed', true
    );
  end if;

  if lifecycle_row.workspace_id is not null and lifecycle_row.archived_at is not null then
    return jsonb_build_object(
      'workspace_id', p_workspace_id,
      'status', 'archived',
      'changed', false
    );
  end if;

  select exists (
    select 1
    from public.customer_subscriptions as subscription
    where subscription.workspace_id = p_workspace_id
      and (
        subscription.status = 'demo'
        or (
          subscription.status in ('active', 'trialing')
          and (
            coalesce(subscription.current_period_end, subscription.stripe_current_period_end) is null
            or coalesce(subscription.current_period_end, subscription.stripe_current_period_end) > statement_timestamp()
          )
        )
        or (
          subscription.manually_activated = true
          and subscription.status in ('active', 'trialing')
        )
      )
  ) into linked_subscription_allows_access;

  workspace_allows_access :=
    workspace_row.subscription_required = false
    or workspace_row.manually_unlocked = true
    or workspace_row.subscription_status in ('active', 'demo')
    or (
      workspace_row.subscription_status = 'trialing'
      and workspace_row.trial_ends_at is not null
      and workspace_row.trial_ends_at > statement_timestamp()
    )
    or linked_subscription_allows_access;

  if workspace_allows_access then
    raise exception using
      errcode = '22023',
      message = 'Workspace must be inactive before it can be archived.';
  end if;

  if workspace_row.subscription_status = 'manual_review'
    or exists (
      select 1
      from public.customer_subscriptions as subscription
      where subscription.workspace_id = p_workspace_id
        and subscription.status = 'manual_review'
    ) then
    raise exception using
      errcode = '22023',
      message = 'Pending activation workspaces cannot be archived.';
  end if;

  insert into public.workspace_admin_lifecycle (
    workspace_id,
    archived_at,
    archived_by,
    restored_at,
    restored_by
  )
  values (
    p_workspace_id,
    statement_timestamp(),
    p_actor_id,
    null,
    null
  )
  on conflict (workspace_id) do update
  set archived_at = statement_timestamp(),
      archived_by = excluded.archived_by,
      restored_at = null,
      restored_by = null;

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'status', 'archived',
    'changed', true
  );
end;
$$;

revoke all on function public.transition_workspace_admin_lifecycle(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_workspace_admin_lifecycle(uuid, uuid, text)
  to service_role;

create or replace view public.admin_company_directory_v1
with (security_invoker = true)
as
with company_directory as (
select
  workspace.id as workspace_id,
  workspace.name as company_name,
  lower(workspace.name) as company_name_sort,
  workspace.primary_contact_name,
  workspace.primary_contact_email,
  workspace.industry,
  workspace.size,
  workspace.created_by,
  workspace.subscription_status as workspace_subscription_status,
  workspace.plan_slug as workspace_plan_slug,
  workspace.subscription_required,
  workspace.trial_ends_at,
  workspace.manually_unlocked,
  workspace.created_at as workspace_created_at,
  workspace.updated_at as workspace_updated_at,
  lifecycle.archived_at,
  lifecycle.archived_by,
  lifecycle.restored_at,
  lifecycle.restored_by,
  agreement.id as agreement_id,
  agreement.signed_at as agreement_signed_at,
  case when agreement.id is null then 'missing' else 'signed' end as agreement_status,
  current_subscription.id as subscription_id,
  coalesce(current_subscription.status, workspace.subscription_status) as subscription_status,
  coalesce(current_subscription.plan_slug, workspace.plan_slug) as subscription_plan_slug,
  current_subscription.billing_provider,
  current_subscription.updated_at as subscription_updated_at,
  case
    when lifecycle.archived_at is not null then 'archived'
    when (
      workspace.subscription_required = false
      or workspace.manually_unlocked = true
      or workspace.subscription_status in ('active', 'demo')
      or (
        workspace.subscription_status = 'trialing'
        and workspace.trial_ends_at is not null
        and workspace.trial_ends_at > statement_timestamp()
      )
      or exists (
        select 1
        from public.customer_subscriptions as access_subscription
        where access_subscription.workspace_id = workspace.id
          and (
            access_subscription.status = 'demo'
            or (
              access_subscription.status in ('active', 'trialing')
              and (
                coalesce(access_subscription.current_period_end, access_subscription.stripe_current_period_end) is null
                or coalesce(access_subscription.current_period_end, access_subscription.stripe_current_period_end) > statement_timestamp()
              )
            )
            or (
              access_subscription.manually_activated = true
              and access_subscription.status in ('active', 'trialing')
            )
          )
      )
    ) then 'active'
    when workspace.subscription_status = 'manual_review'
      or exists (
        select 1
        from public.customer_subscriptions as pending_subscription
        where pending_subscription.workspace_id = workspace.id
          and pending_subscription.status = 'manual_review'
      ) then 'pending_activation'
    else 'inactive'
  end as lifecycle_status,
  case
    when workspace.subscription_status = 'demo' or current_subscription.status = 'demo' then 'demo'
    when workspace.subscription_status = 'trialing' or current_subscription.status = 'trialing' then 'trial'
    else null
  end as legacy_access_kind
from public.workspaces as workspace
left join public.workspace_admin_lifecycle as lifecycle
  on lifecycle.workspace_id = workspace.id
left join public.workspace_agreements as agreement
  on agreement.workspace_id = workspace.id
left join lateral (
  select
    subscription.id,
    subscription.status,
    subscription.plan_slug,
    subscription.billing_provider,
    subscription.updated_at
  from public.customer_subscriptions as subscription
  where subscription.workspace_id = workspace.id
  order by subscription.updated_at desc, subscription.created_at desc, subscription.id
  limit 1
) as current_subscription on true
)
select
  company_directory.*,
  case
    when company_directory.lifecycle_status = 'archived' then false
    else (
      company_directory.lifecycle_status in ('pending_activation', 'inactive')
      or company_directory.agreement_status = 'missing'
      or nullif(btrim(company_directory.primary_contact_email), '') is null
      or company_directory.manually_unlocked = true
      or (
        company_directory.subscription_id is not null
        and company_directory.workspace_subscription_status is distinct from company_directory.subscription_status
      )
    )
  end as attention_required
from company_directory;

revoke all privileges on table public.admin_company_directory_v1
  from public, anon, authenticated, service_role;
grant select on table public.admin_company_directory_v1
  to service_role;

create or replace view public.admin_unlinked_customer_records_v1
with (security_invoker = true)
as
select
  'profile'::text as record_type,
  profile.id as record_id,
  coalesce(nullif(btrim(profile.full_name), ''), 'Unlinked profile') as display_name,
  profile.email as contact_email,
  'unlinked'::text as status,
  profile.created_at
from public.profiles as profile
where not exists (
    select 1
    from public.workspace_members as membership
    where membership.user_id = profile.id
      and membership.status = 'active'
  )
  and not exists (
    select 1
    from public.workspaces as workspace
    where workspace.created_by = profile.id
  )
union all
select
  'subscription'::text,
  subscription.id,
  coalesce(nullif(btrim(subscription.customer_name), ''), 'Unlinked subscription'),
  subscription.customer_email,
  subscription.status,
  subscription.created_at
from public.customer_subscriptions as subscription
where subscription.workspace_id is null
union all
select
  'activation_request'::text,
  request.id,
  coalesce(nullif(btrim(request.company), ''), nullif(btrim(request.name), ''), 'Activation request'),
  request.email,
  request.status,
  request.created_at
from public.manual_activation_requests as request
where not exists (
  select 1
  from public.workspaces as workspace
  where lower(workspace.primary_contact_email) = lower(request.email)
)
and not exists (
  select 1
  from public.customer_subscriptions as subscription
  where subscription.workspace_id is not null
    and lower(subscription.customer_email) = lower(request.email)
);

revoke all privileges on table public.admin_unlinked_customer_records_v1
  from public, anon, authenticated, service_role;
grant select on table public.admin_unlinked_customer_records_v1
  to service_role;
