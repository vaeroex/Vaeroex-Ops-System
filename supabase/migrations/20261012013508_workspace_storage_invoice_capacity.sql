begin;

-- Exact monthly invoices retain provider-bound reservations until Stripe has
-- definitively closed the payable invoice. No clock-only capacity release.
alter table private.workspace_capacity_intents
  drop constraint workspace_capacity_intents_pricing_mode_check,
  add constraint workspace_capacity_intents_pricing_mode_check check(pricing_mode in ('full_month','fixed_anchor','invoice_monthly')),
  add column stripe_initial_invoice_id text unique,
  add column stripe_subscription_id text unique,
  add column billing_address_hash text,
  add constraint workspace_capacity_invoice_address_hash check(
    pricing_mode<>'invoice_monthly' or (billing_address_hash is not null and billing_address_hash ~ '^[a-f0-9]{64}$'));

-- Reserve every subscription once while it can renew or has an unexpired,
-- unrefunded paid period. The union includes future and disputed periods:
-- entitlement may recover, so those packs cannot be sold a second time.
create or replace function private.workspace_storage_committed_packs_v1(p_workspace_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select coalesce(sum(s.packs),0)::integer
  from private.workspace_capacity_subscriptions s
  where s.workspace_id=p_workspace_id and (
    (s.status not in ('canceled','incomplete_expired') and not s.cancel_at_period_end
      and (s.ended_at is null or s.ended_at>now()))
    or exists(select 1 from private.workspace_capacity_invoices i
      where i.workspace_id=s.workspace_id and i.stripe_subscription_id=s.stripe_subscription_id
        and i.period_end>now() and i.paid_cents>i.refunded_cents)
  );
$$;
revoke all on function private.workspace_storage_committed_packs_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.workspace_capacity_quote_v1(
  p_workspace_id uuid, p_actor_id uuid, p_packs integer, p_price_id text, p_livemode boolean, p_terms_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_intent private.workspace_capacity_intents; v_committed integer; v_current integer; v_customer text;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  if p_packs is null or p_packs < 1 or p_packs > 10 or coalesce(p_price_id,'') = '' or p_terms_version <> 'storage-capacity-v1' then
    raise exception using errcode = '22023', message = 'Invalid capacity purchase.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  update private.workspace_capacity_intents set state = 'expired'
    where workspace_id=p_workspace_id and state='quoted' and expires_at<=now()
      and stripe_session_id is null and stripe_initial_invoice_id is null;
  -- A Stripe Checkout must be authoritatively expired before its reservation can be released.
  select * into v_intent from private.workspace_capacity_intents where workspace_id=p_workspace_id and state in ('quoted','checkout') order by created_at limit 1;
  if found then
    if v_intent.pricing_mode='fixed_anchor' and v_intent.livemode=p_livemode and v_intent.terms_version=p_terms_version
      and v_intent.actor_id=p_actor_id and v_intent.packs=p_packs and v_intent.stripe_price_id=p_price_id and v_intent.expires_at>now() then
      return to_jsonb(v_intent);
    end if;
    raise exception using errcode = '55000', message = 'Finish the existing capacity checkout or wait for its expiration before choosing a different quantity.';
  end if;
  v_committed:=private.workspace_storage_committed_packs_v1(p_workspace_id);
  v_current := private.workspace_storage_paid_packs_v1(p_workspace_id);
  if v_committed+p_packs>10 then
    raise exception using errcode = '54000', message = 'This workspace requires a separately qualified enterprise plan for more capacity.';
  end if;
  select stripe_customer_id into v_customer from private.workspace_capacity_subscriptions
    where workspace_id=p_workspace_id order by created_at desc limit 1;
  -- Capacity owns a dedicated customer per workspace. Base-plan credits,
  -- discounts and other businesses' balances cannot change the reviewed price.
  insert into private.workspace_capacity_intents(workspace_id,actor_id,packs,current_packs,stripe_price_id,livemode,terms_version,stripe_customer_id,pricing_mode,renewal_at)
    values(p_workspace_id,p_actor_id,p_packs,v_current,p_price_id,p_livemode,p_terms_version,v_customer,'fixed_anchor',date_trunc('second',now()+interval '1 month')) returning * into v_intent;
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.workspace_capacity_invoice_quote_v1(
  p_workspace_id uuid,p_actor_id uuid,p_packs integer,p_price_id text,p_livemode boolean,p_terms_version text,p_address_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_intent private.workspace_capacity_intents; v_committed integer; v_current integer;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  if p_packs is null or p_packs not between 1 and 10 or coalesce(p_price_id,'')='' or p_livemode is null
    or p_terms_version is distinct from 'storage-capacity-v1' or p_address_hash is null or p_address_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='Invalid monthly capacity purchase.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:'||p_workspace_id::text,0));
  -- An unbound quote has never exposed a payment URL. A bound invoice requires
  -- server-verified provider cancellation/voiding, even after local expiry.
  update private.workspace_capacity_intents set state='expired'
    where workspace_id=p_workspace_id and state='quoted' and expires_at<=now()
      and stripe_session_id is null and stripe_initial_invoice_id is null;
  select * into v_intent from private.workspace_capacity_intents
    where workspace_id=p_workspace_id and state in ('quoted','checkout') order by created_at limit 1;
  if found then
    if v_intent.pricing_mode='invoice_monthly' and v_intent.actor_id=p_actor_id and v_intent.packs=p_packs
      and v_intent.stripe_price_id=p_price_id and v_intent.livemode=p_livemode and v_intent.terms_version=p_terms_version
      and v_intent.billing_address_hash=p_address_hash and v_intent.expires_at>now() then return to_jsonb(v_intent); end if;
    raise exception using errcode='55000',message='Finish or cancel the existing capacity purchase before reviewing a different purchase.';
  end if;
  v_committed:=private.workspace_storage_committed_packs_v1(p_workspace_id);
  v_current:=private.workspace_storage_paid_packs_v1(p_workspace_id);
  if v_committed+p_packs>10 then
    raise exception using errcode='54000',message='This workspace requires a separately qualified enterprise plan for more capacity.';
  end if;
  insert into private.workspace_capacity_intents(workspace_id,actor_id,packs,current_packs,stripe_price_id,livemode,terms_version,pricing_mode,billing_address_hash)
    values(p_workspace_id,p_actor_id,p_packs,v_current,p_price_id,p_livemode,p_terms_version,'invoice_monthly',p_address_hash) returning * into v_intent;
  return to_jsonb(v_intent);
end;
$$;

create or replace function public.workspace_capacity_record_invoice_v1(
  p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid,p_customer_id text,p_subscription_id text,p_invoice_id text,
  p_renewal_at timestamptz,p_expires_at timestamptz,p_quoted_cents integer
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_intent private.workspace_capacity_intents;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:'||p_workspace_id::text,0));
  select * into v_intent from private.workspace_capacity_intents
    where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id for update;
  if not found or v_intent.pricing_mode<>'invoice_monthly' or v_intent.state not in ('quoted','checkout')
    or v_intent.expires_at<=now() or coalesce(p_customer_id,'')='' or coalesce(p_subscription_id,'')='' or coalesce(p_invoice_id,'')=''
    or p_quoted_cents is distinct from v_intent.packs*500 or p_renewal_at is null or p_renewal_at<=now()
    or p_expires_at is null or p_expires_at<=now() or p_expires_at>v_intent.created_at+interval '24 hours'
    or p_renewal_at<=p_expires_at then
    raise exception using errcode='42501',message='Monthly capacity invoice attribution failed.';
  end if;
  if v_intent.stripe_initial_invoice_id is not null and
    (v_intent.stripe_initial_invoice_id,v_intent.stripe_subscription_id,v_intent.stripe_customer_id,v_intent.renewal_at,v_intent.expires_at,v_intent.quoted_cents)
      is distinct from (p_invoice_id,p_subscription_id,p_customer_id,p_renewal_at,p_expires_at,p_quoted_cents) then
    raise exception using errcode='42501',message='A bound monthly capacity invoice cannot change.';
  end if;
  update private.workspace_capacity_intents set stripe_initial_invoice_id=p_invoice_id,stripe_subscription_id=p_subscription_id,
    stripe_customer_id=p_customer_id,renewal_at=p_renewal_at,expires_at=p_expires_at,quoted_cents=p_quoted_cents where id=v_intent.id;
  return true;
end;
$$;

-- Caller has verified the exact provider invoice is void/canceled, or its
-- subscription is incomplete_expired. This RPC never trusts a customer clock.
create or replace function public.workspace_capacity_expire_invoice_v1(p_intent_id uuid,p_invoice_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace uuid;
begin
  perform private.require_capacity_service_v1();
  select workspace_id into v_workspace from private.workspace_capacity_intents
    where id=p_intent_id and pricing_mode='invoice_monthly' and stripe_initial_invoice_id=p_invoice_id;
  if v_workspace is null then raise exception using errcode='42501',message='Monthly capacity invoice attribution failed.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:'||v_workspace::text,0));
  update private.workspace_capacity_intents set state='expired'
    where id=p_intent_id and stripe_initial_invoice_id=p_invoice_id and state in ('quoted','checkout');
  return true;
end;
$$;


create or replace function public.workspace_capacity_confirm_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_intent private.workspace_capacity_intents;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  select * into v_intent from private.workspace_capacity_intents where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id for update;
  if not found or v_intent.state not in ('quoted','checkout') or v_intent.expires_at<=now() then
    raise exception using errcode='55000',message='The capacity quote expired. Review a new quote.';
  end if;
  if v_intent.pricing_mode='invoice_monthly' and (v_intent.stripe_initial_invoice_id is null or v_intent.stripe_subscription_id is null
    or v_intent.stripe_customer_id is null or v_intent.renewal_at is null or v_intent.quoted_cents is distinct from v_intent.packs*500) then
    raise exception using errcode='55000',message='Review the confirmed monthly invoice amount and renewal date before paying.';
  end if;
  if private.workspace_storage_committed_packs_v1(p_workspace_id)+v_intent.packs>10 then
    raise exception using errcode='54000',message='This workspace requires a separately qualified enterprise plan for more capacity.';
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
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:' || p_workspace_id::text,0));
  update private.workspace_capacity_intents set stripe_session_id=p_session_id,stripe_customer_id=coalesce(stripe_customer_id,nullif(p_customer_id,'')),expires_at=p_expires_at
    where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id and state in ('quoted','checkout') and pricing_mode<>'invoice_monthly' and expires_at>now()
      and (stripe_session_id is null or stripe_session_id=p_session_id)
      and (stripe_customer_id is null or p_customer_id='' or stripe_customer_id=p_customer_id);
  if not found then raise exception using errcode='42501',message='Capacity checkout attribution failed.'; end if;
  return true;
end;
$$;

create or replace function public.workspace_capacity_record_quote_price_v1(p_workspace_id uuid,p_actor_id uuid,p_intent_id uuid,p_quoted_cents integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  update private.workspace_capacity_intents set quoted_cents=p_quoted_cents
    where id=p_intent_id and workspace_id=p_workspace_id and actor_id=p_actor_id and state in ('quoted','checkout') and pricing_mode<>'invoice_monthly' and expires_at>now()
      and stripe_session_id is not null and p_quoted_cents between 1 and packs*500;
  if not found then raise exception using errcode='42501',message='Provider capacity price could not be recorded.'; end if;
  return true;
end;
$$;

create or replace function public.workspace_capacity_state_v1(p_workspace_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_capacity_owner_v1(p_workspace_id,p_actor_id);
  select jsonb_build_object('committedPacks',private.workspace_storage_committed_packs_v1(p_workspace_id),
    'subscriptions',coalesce(jsonb_agg(jsonb_build_object(
    'id',s.stripe_subscription_id,'packs',s.packs,'status',s.status,'cancelAtPeriodEnd',s.cancel_at_period_end,
    'monthlyCents',s.packs*500,'paidThrough',(select max(i.period_end) from private.workspace_capacity_invoices i
      where i.stripe_subscription_id=s.stripe_subscription_id and i.workspace_id=p_workspace_id and i.refunded_cents<i.paid_cents and not i.disputed)
  ) order by s.created_at),'[]'::jsonb),'pendingIntents',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'sessionId',stripe_session_id,'packs',packs,'state',state,'pricingMode',pricing_mode,'subscriptionId',stripe_subscription_id,
      'invoiceId',stripe_initial_invoice_id,'expiresAt',expires_at,'addressHash',billing_address_hash)),'[]'::jsonb)
    from private.workspace_capacity_intents where workspace_id=p_workspace_id and state in ('quoted','checkout'))) into v_result
  from private.workspace_capacity_subscriptions s where s.workspace_id=p_workspace_id;
  return v_result;
end;
$$;

create or replace function public.workspace_capacity_sync_v1(
  p_event_key text,p_event_type text,p_intent_id uuid,p_session_id text,p_subscription_id text,p_customer_id text,
  p_price_id text,p_livemode boolean,p_packs integer,p_status text,p_cancel_at_period_end boolean,p_ended_at timestamptz,
  p_checked_at timestamptz,p_invoices jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_intent private.workspace_capacity_intents; v_invoice jsonb; v_existing private.workspace_capacity_subscriptions; v_workspace uuid;
begin
  perform private.require_capacity_service_v1();
  select workspace_id into v_workspace from private.workspace_capacity_intents where id=p_intent_id;
  if v_workspace is null then raise exception using errcode='42501',message='Paid capacity intent was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('workspace-storage:'||v_workspace::text,0));
  select * into v_intent from private.workspace_capacity_intents where id=p_intent_id for update;
  if not found or (case when v_intent.pricing_mode='invoice_monthly' then
      v_intent.stripe_initial_invoice_id is distinct from p_session_id or v_intent.stripe_subscription_id is distinct from p_subscription_id
    else v_intent.stripe_session_id is distinct from p_session_id end) or v_intent.terms_accepted_at is null
    or v_intent.state not in ('checkout','complete') or v_intent.packs<>p_packs or v_intent.stripe_price_id<>p_price_id
    or v_intent.livemode<>p_livemode or (v_intent.stripe_customer_id is not null and v_intent.stripe_customer_id<>p_customer_id)
    or coalesce(p_subscription_id,'')='' or coalesce(p_customer_id,'')='' then
    raise exception using errcode='42501',message='Paid capacity attribution does not match the confirmed purchase.';
  end if;
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
    if (v_intent.pricing_mode='invoice_monthly' and (v_invoice->>'paid_cents')::integer is distinct from p_packs*500)
      or (v_invoice->>'packs')::integer<>p_packs or (v_invoice->>'paid_cents')::integer>p_packs*500
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

revoke all on function public.workspace_capacity_invoice_quote_v1(uuid,uuid,integer,text,boolean,text,text),
  public.workspace_capacity_record_invoice_v1(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer),
  public.workspace_capacity_expire_invoice_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.workspace_capacity_invoice_quote_v1(uuid,uuid,integer,text,boolean,text,text),
  public.workspace_capacity_record_invoice_v1(uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,integer),
  public.workspace_capacity_expire_invoice_v1(uuid,text) to service_role;

commit;
