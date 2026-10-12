-- Uploaded-file expansion is purchased for one workspace, never an account-wide pool.
create schema if not exists private;

create table private.workspace_capacity_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  packs integer not null check (packs between 1 and 10),
  current_packs integer not null check (current_packs between 0 and 10),
  stripe_price_id text not null,
  livemode boolean not null,
  terms_version text not null,
  pricing_mode text not null default 'full_month' check(pricing_mode in ('full_month','fixed_anchor')),
  renewal_at timestamptz,
  quoted_cents integer check(quoted_cents > 0 and quoted_cents <= packs*500),
  terms_accepted_at timestamptz,
  state text not null default 'quoted' check(state in ('quoted','checkout','complete','expired')),
  stripe_session_id text unique,
  stripe_customer_id text,
  expires_at timestamptz not null default now() + interval '35 minutes',
  created_at timestamptz not null default now()
);
create index workspace_capacity_intents_workspace on private.workspace_capacity_intents(workspace_id, state);

create table private.workspace_capacity_subscriptions (
  stripe_subscription_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  intent_id uuid not null unique references private.workspace_capacity_intents(id) on delete restrict,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  packs integer not null check(packs between 1 and 10),
  status text not null,
  cancel_at_period_end boolean not null default false,
  ended_at timestamptz,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index workspace_capacity_subscriptions_workspace on private.workspace_capacity_subscriptions(workspace_id);

create table private.workspace_capacity_invoices (
  stripe_invoice_id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  stripe_subscription_id text not null references private.workspace_capacity_subscriptions(stripe_subscription_id) on delete restrict,
  packs integer not null check(packs between 1 and 10),
  period_start timestamptz not null,
  period_end timestamptz not null,
  paid_cents integer not null check(paid_cents > 0),
  refunded_cents integer not null default 0 check(refunded_cents >= 0),
  disputed boolean not null default false,
  checked_at timestamptz not null default now(),
  check(period_end > period_start)
);
create index workspace_capacity_invoices_workspace on private.workspace_capacity_invoices(workspace_id, period_end);

create table private.workspace_capacity_events (
  event_key text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  stripe_subscription_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table private.workspace_capacity_intents enable row level security;
alter table private.workspace_capacity_subscriptions enable row level security;
alter table private.workspace_capacity_invoices enable row level security;
alter table private.workspace_capacity_events enable row level security;
revoke all on private.workspace_capacity_intents, private.workspace_capacity_subscriptions,
  private.workspace_capacity_invoices, private.workspace_capacity_events from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.workspace_capacity_intents, private.workspace_capacity_subscriptions,
  private.workspace_capacity_invoices, private.workspace_capacity_events to service_role;

create or replace function private.workspace_storage_paid_packs_v1(p_workspace_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(eligible.packs), 0)::integer
  from (
    select s.stripe_subscription_id, max(i.packs) as packs
    from private.workspace_capacity_subscriptions s
    join private.workspace_capacity_invoices i
      on i.stripe_subscription_id = s.stripe_subscription_id and i.workspace_id = s.workspace_id
    where s.workspace_id = p_workspace_id
      and (s.ended_at is null or s.ended_at > now())
      and i.period_start <= now() and i.period_end > now()
      and i.refunded_cents < i.paid_cents and not i.disputed
    group by s.stripe_subscription_id
  ) eligible;
$$;
revoke all on function private.workspace_storage_paid_packs_v1(uuid) from public, anon, authenticated;
grant execute on function private.workspace_storage_paid_packs_v1(uuid) to service_role;

create or replace function private.require_capacity_owner_v1(p_workspace_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.workspace_members m where m.workspace_id = p_workspace_id
    and m.user_id = p_actor_id and m.role = 'owner' and m.status = 'active') then
    raise exception using errcode = '42501', message = 'Only the active workspace owner can manage capacity.';
  end if;
end;
$$;
revoke all on function private.require_capacity_owner_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function private.require_capacity_owner_v1(uuid,uuid) to service_role;

create or replace function public.workspace_capacity_quote_v1(
  p_workspace_id uuid, p_actor_id uuid, p_packs integer, p_price_id text, p_livemode boolean, p_terms_version text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_intent private.workspace_capacity_intents; v_committed integer; v_current integer; v_customer text;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  if p_packs is null or p_packs < 1 or p_packs > 10 or coalesce(p_price_id,'') = '' or p_terms_version <> 'storage-capacity-v1' then
    raise exception using errcode = '22023', message = 'Invalid capacity purchase.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  update private.workspace_capacity_intents set state = 'expired'
    where workspace_id=p_workspace_id and state='quoted' and expires_at<=now();
  -- A Stripe Checkout must be authoritatively expired before its reservation can be released.
  select * into v_intent from private.workspace_capacity_intents where workspace_id=p_workspace_id and state in ('quoted','checkout') and expires_at>now() limit 1;
  if found then
    if v_intent.actor_id=p_actor_id and v_intent.packs=p_packs and v_intent.stripe_price_id=p_price_id and v_intent.expires_at>now() then
      return to_jsonb(v_intent);
    end if;
    raise exception using errcode = '55000', message = 'Finish the existing capacity checkout or wait for its expiration before choosing a different quantity.';
  end if;
  select coalesce(sum(packs),0)::integer into v_committed from private.workspace_capacity_subscriptions
    where workspace_id=p_workspace_id and (ended_at is null or ended_at>now())
      and status not in ('canceled','incomplete_expired');
  v_current := private.workspace_storage_paid_packs_v1(p_workspace_id);
  if greatest(v_committed,v_current)+p_packs>10 then
    raise exception using errcode = '54000', message = 'This workspace requires a separately qualified enterprise plan for more capacity.';
  end if;
  update private.workspace_capacity_intents set state='expired' where workspace_id=p_workspace_id and state='quoted';
  select stripe_customer_id into v_customer from private.workspace_capacity_subscriptions
    where workspace_id=p_workspace_id order by created_at desc limit 1;
  -- Capacity owns a dedicated customer per workspace. Base-plan credits,
  -- discounts and other businesses' balances cannot change the reviewed price.
  insert into private.workspace_capacity_intents(workspace_id,actor_id,packs,current_packs,stripe_price_id,livemode,terms_version,stripe_customer_id,pricing_mode,renewal_at)
    values(p_workspace_id,p_actor_id,p_packs,v_current,p_price_id,p_livemode,p_terms_version,v_customer,'fixed_anchor',date_trunc('second',now()+interval '1 month')) returning * into v_intent;
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.workspace_capacity_intent_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_intent private.workspace_capacity_intents;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  select * into v_intent from private.workspace_capacity_intents where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id;
  if not found then raise exception using errcode='42501',message='Capacity quote not found for this owner and workspace.'; end if;
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.workspace_capacity_confirm_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_intent private.workspace_capacity_intents;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  select * into v_intent from private.workspace_capacity_intents where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id for update;
  if not found or v_intent.state not in ('quoted','checkout') or v_intent.expires_at<=now() then
    raise exception using errcode='55000',message='The capacity quote expired. Review a new quote.';
  end if;
  if private.workspace_storage_paid_packs_v1(p_workspace_id) <> v_intent.current_packs then
    raise exception using errcode='55000',message='Capacity changed. Review the updated allowance before paying.';
  end if;
  update private.workspace_capacity_intents set state='checkout',terms_accepted_at=coalesce(terms_accepted_at,now())
    where id=v_intent.id returning * into v_intent;
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.workspace_capacity_record_checkout_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid,p_session_id text,p_customer_id text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  update private.workspace_capacity_intents set stripe_session_id=p_session_id,stripe_customer_id=coalesce(stripe_customer_id,nullif(p_customer_id,'')),expires_at=p_expires_at
    where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id and state in ('quoted','checkout')
      and (stripe_session_id is null or stripe_session_id=p_session_id)
      and (stripe_customer_id is null or p_customer_id='' or stripe_customer_id=p_customer_id);
  if not found then raise exception using errcode='42501',message='Capacity checkout attribution failed.'; end if;
  return true;
end;
$$;

create or replace function public.workspace_capacity_record_quote_price_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid,p_quoted_cents integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  update private.workspace_capacity_intents set quoted_cents=p_quoted_cents
    where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id and state in ('quoted','checkout')
      and stripe_session_id is not null and p_quoted_cents between 1 and packs*500;
  if not found then raise exception using errcode='42501',message='Provider capacity price could not be recorded.'; end if;
  return true;
end;
$$;

-- Privileged provider resolver. No email/customer OR lookup can attach a purchase to a workspace.
create or replace function public.workspace_capacity_provider_intent_v1(p_intent_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(i) from private.workspace_capacity_intents i where id=p_intent_id;
$$;

create or replace function public.workspace_capacity_expire_v1(p_intent_id uuid,p_session_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from private.workspace_capacity_intents where id=p_intent_id and stripe_session_id=p_session_id;
  if v_workspace is null then raise exception using errcode='42501',message='Capacity checkout attribution failed.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || v_workspace::text,0));
  update private.workspace_capacity_intents set state='expired' where id=p_intent_id and stripe_session_id=p_session_id and state in ('quoted','checkout');
  return true;
end;
$$;

create or replace function public.workspace_capacity_state_v1(p_workspace_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  select jsonb_build_object('committedPacks',greatest(private.workspace_storage_paid_packs_v1(p_workspace_id),
    coalesce(sum(s.packs) filter(where (s.ended_at is null or s.ended_at>now()) and s.status not in ('canceled','incomplete_expired')),0)),
    'subscriptions',coalesce(jsonb_agg(jsonb_build_object(
    'id',s.stripe_subscription_id,'packs',s.packs,'status',s.status,'cancelAtPeriodEnd',s.cancel_at_period_end,
    'monthlyCents',s.packs*500,'paidThrough',(select max(i.period_end) from private.workspace_capacity_invoices i
      where i.stripe_subscription_id=s.stripe_subscription_id and i.workspace_id=p_workspace_id and i.refunded_cents<i.paid_cents and not i.disputed)
  ) order by s.created_at),'[]'::jsonb),'pendingIntents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sessionId',stripe_session_id,'packs',packs,'state',state)),'[]'::jsonb)
    from private.workspace_capacity_intents where workspace_id=p_workspace_id and state in ('quoted','checkout'))) into v_result
  from private.workspace_capacity_subscriptions s where s.workspace_id=p_workspace_id;
  return v_result;
end;
$$;

create or replace function public.workspace_capacity_sync_v1(
  p_event_key text,p_event_type text,p_intent_id uuid,p_session_id text,p_subscription_id text,p_customer_id text,
  p_price_id text,p_livemode boolean,p_packs integer,p_status text,p_cancel_at_period_end boolean,p_ended_at timestamptz,
  p_checked_at timestamptz,p_invoices jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_intent private.workspace_capacity_intents; v_invoice jsonb; v_existing private.workspace_capacity_subscriptions;
begin
  select * into v_intent from private.workspace_capacity_intents where id=p_intent_id;
  if not found or v_intent.stripe_session_id is distinct from p_session_id or v_intent.terms_accepted_at is null
    or v_intent.state not in ('checkout','complete') or v_intent.packs<>p_packs or v_intent.stripe_price_id<>p_price_id
    or v_intent.livemode<>p_livemode or (v_intent.stripe_customer_id is not null and v_intent.stripe_customer_id<>p_customer_id)
    or coalesce(p_subscription_id,'')='' or coalesce(p_customer_id,'')='' then
    raise exception using errcode='42501',message='Paid capacity attribution does not match the confirmed purchase.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || v_intent.workspace_id::text,0));
  if exists(select 1 from private.workspace_capacity_events where event_key=p_event_key) then
    return jsonb_build_object('duplicate',true,'workspace_id',v_intent.workspace_id);
  end if;
  select * into v_existing from private.workspace_capacity_subscriptions where stripe_subscription_id=p_subscription_id;
  if found and (v_existing.workspace_id<>v_intent.workspace_id or v_existing.intent_id<>p_intent_id) then
    raise exception using errcode='42501',message='Subscription workspace cannot change.';
  end if;
  insert into private.workspace_capacity_subscriptions(stripe_subscription_id,workspace_id,intent_id,stripe_customer_id,stripe_price_id,packs,status,cancel_at_period_end,ended_at,checked_at)
    values(p_subscription_id,v_intent.workspace_id,p_intent_id,p_customer_id,p_price_id,p_packs,p_status,p_cancel_at_period_end,p_ended_at,p_checked_at)
    on conflict(stripe_subscription_id) do update set status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,
      ended_at=excluded.ended_at,checked_at=excluded.checked_at
    where private.workspace_capacity_subscriptions.checked_at<=excluded.checked_at;
  for v_invoice in select value from jsonb_array_elements(p_invoices) loop
    if (v_invoice->>'packs')::integer<>p_packs or (v_invoice->>'paid_cents')::integer>p_packs*500
      or (v_invoice->>'paid_cents')::integer<=0 or ((v_invoice->>'paid_cents')::integer<p_packs*500
        and not (coalesce((v_invoice->>'initial_period')::boolean,false) and v_intent.pricing_mode='fixed_anchor'
          and (v_invoice->>'period_end')::timestamptz=v_intent.renewal_at
          and (v_invoice->>'paid_cents')::integer<=v_intent.quoted_cents)) then
      raise exception using errcode='22023',message='Paid invoice does not match the approved capacity price.';
    end if;
    if exists(select 1 from private.workspace_capacity_invoices where stripe_invoice_id=v_invoice->>'id'
      and (workspace_id<>v_intent.workspace_id or stripe_subscription_id<>p_subscription_id)) then
      raise exception using errcode='42501',message='Invoice workspace cannot change.';
    end if;
    insert into private.workspace_capacity_invoices(stripe_invoice_id,workspace_id,stripe_subscription_id,packs,period_start,period_end,paid_cents,refunded_cents,disputed,checked_at)
      values(v_invoice->>'id',v_intent.workspace_id,p_subscription_id,p_packs,(v_invoice->>'period_start')::timestamptz,
      (v_invoice->>'period_end')::timestamptz,(v_invoice->>'paid_cents')::integer,(v_invoice->>'refunded_cents')::integer,(v_invoice->>'disputed')::boolean,p_checked_at)
      on conflict(stripe_invoice_id) do update set
        refunded_cents=greatest(private.workspace_capacity_invoices.refunded_cents,excluded.refunded_cents),
        disputed=case when private.workspace_capacity_invoices.checked_at<=excluded.checked_at then excluded.disputed else private.workspace_capacity_invoices.disputed end,
        checked_at=greatest(private.workspace_capacity_invoices.checked_at,excluded.checked_at);
  end loop;
  update private.workspace_capacity_intents set state='complete',stripe_customer_id=p_customer_id where id=p_intent_id;
  insert into private.workspace_capacity_events(event_key,workspace_id,stripe_subscription_id,event_type)
    values(p_event_key,v_intent.workspace_id,p_subscription_id,p_event_type);
  return jsonb_build_object('workspace_id',v_intent.workspace_id,'paid_packs',private.workspace_storage_paid_packs_v1(v_intent.workspace_id));
end;
$$;

revoke all on function public.workspace_capacity_quote_v1(uuid,uuid,integer,text,boolean,text),
  public.workspace_capacity_intent_v1(uuid,uuid,uuid),public.workspace_capacity_confirm_v1(uuid,uuid,uuid),
  public.workspace_capacity_record_checkout_v1(uuid,uuid,uuid,text,text,timestamptz),public.workspace_capacity_provider_intent_v1(uuid),
  public.workspace_capacity_record_quote_price_v1(uuid,uuid,uuid,integer),
  public.workspace_capacity_expire_v1(uuid,text),public.workspace_capacity_state_v1(uuid,uuid),
  public.workspace_capacity_sync_v1(text,text,uuid,text,text,text,text,boolean,integer,text,boolean,timestamptz,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.workspace_capacity_quote_v1(uuid,uuid,integer,text,boolean,text),
  public.workspace_capacity_intent_v1(uuid,uuid,uuid),public.workspace_capacity_confirm_v1(uuid,uuid,uuid),
  public.workspace_capacity_record_checkout_v1(uuid,uuid,uuid,text,text,timestamptz),public.workspace_capacity_provider_intent_v1(uuid),
  public.workspace_capacity_record_quote_price_v1(uuid,uuid,uuid,integer),
  public.workspace_capacity_expire_v1(uuid,text),public.workspace_capacity_state_v1(uuid,uuid),
  public.workspace_capacity_sync_v1(text,text,uuid,text,text,text,text,boolean,integer,text,boolean,timestamptz,timestamptz,jsonb)
  to service_role;
