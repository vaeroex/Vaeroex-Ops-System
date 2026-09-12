-- Restricted host contract: labels select; current database authority decides.
-- No table/schema privileges, RLS changes, or provider/runtime grants.
begin;
create function private.square_workspace_card_v1(p_workspace_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public
set statement_timeout='5s' set lock_timeout='2s' as $$
declare actor uuid; sid uuid; session_expiry timestamptz; w public.workspaces;
  sub public.customer_subscriptions; stripe public.customer_subscriptions;
  manual_allowed boolean:=false; allowed boolean:=false; result jsonb; n timestamptz;
begin
  actor:=auth.uid(); sid:=(auth.jwt()->>'session_id')::uuid;
  if actor is null or sid is null or auth.jwt()->>'role' is distinct from 'authenticated'
    or auth.jwt()->>'iss' is distinct from 'https://oysjpoondtcrqpghhrbd.supabase.co/auth/v1'
    or auth.jwt()->>'is_anonymous'='true' or p_workspace_name is null
    or length(p_workspace_name) not between 1 and 200 then return null; end if;
  select s.not_after into session_expiry from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=sid and s.user_id=actor and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of s,u;
  if not found or session_expiry<=clock_timestamp() then return null; end if;
  -- STRICT rejects both missing and ambiguous names; no default/first membership.
  select ws.* into strict w from public.workspaces ws join public.workspace_members m on m.workspace_id=ws.id
    where ws.name=p_workspace_name and m.user_id=actor and m.status='active'
    for share of ws,m;
  -- Match getSubscriptionStatus's workspace-only policy without exposing billing
  -- rows, customer IDs, plans, email lookup or the admin-email bypass.
  for sub in select * from public.customer_subscriptions where workspace_id=w.id
    order by created_at desc,id for share loop
    if sub.billing_provider='stripe' then
      if stripe.id is null then stripe:=sub;
      elsif sub.created_at=stripe.created_at then return null; end if;
    end if;
    if sub.billing_provider='manual' and sub.manually_activated and sub.status in ('active','trialing') then
      manual_allowed:=true;
    end if;
  end loop;
  n:=clock_timestamp();
  if stripe.id is not null then
    allowed:=not stripe.manually_activated and stripe.status in ('active','trialing')
      and stripe.current_period_end>n and coalesce(stripe.stripe_customer_id,'')<>''
      and coalesce(stripe.stripe_subscription_id,'')<>'';
  else
    allowed:=w.subscription_required=false or (w.manually_unlocked and manual_allowed)
      or w.subscription_status='demo' or (w.subscription_status='trialing' and w.trial_ends_at>n);
  end if;
  if allowed is distinct from true then return null; end if;
  -- Reuse the full checked entity/generation/mapping/source-version projection.
  -- No raw identifier leaves this transaction, including on denial.
  result:=private.square_workspace_evidence_v1(w.id);
  n:=clock_timestamp();
  if session_expiry<=n or (stripe.id is not null and stripe.current_period_end<=n)
    or (stripe.id is null and w.subscription_required is distinct from false
      and not coalesce(w.manually_unlocked and manual_allowed,false)
      and w.subscription_status='trialing' and w.trial_ends_at<=n) then return null; end if;
  return result;
exception when others then return null;
end $$;
revoke all on function private.square_workspace_card_v1(text) from public,anon,authenticated,service_role;
grant execute on function private.square_workspace_card_v1(text) to authenticated;
create function public.read_square_workspace_card_v1(p_workspace_name text)
returns jsonb language sql security invoker set search_path=''
begin atomic;
  select private.square_workspace_card_v1(p_workspace_name);
end;
revoke all on function public.read_square_workspace_card_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.read_square_workspace_card_v1(text) to authenticated;
commit;
