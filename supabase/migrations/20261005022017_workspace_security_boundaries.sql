begin;

-- Explicit platform authority, never inferred from email or JWT metadata.
-- RELEASE PREREQUISITE: an authorized operator must reconcile the configured
-- VAEROEX_ADMIN_EMAILS against verified auth.users identities, seed only those
-- approved IDs as the database owner, and keep this table synchronized on admin
-- revocation. Service clients cannot configure exemptions or traverse private.
-- There is deliberately no seed or exposed mutation RPC in this migration.
create table private.platform_admin_subscription_exemptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.platform_admin_subscription_exemptions enable row level security;
revoke all on private.platform_admin_subscription_exemptions from public,anon,authenticated,service_role;

create function private.platform_admin_subscription_exempt_v1(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select auth.role())='authenticated',false) and exists (
    select 1 from private.platform_admin_subscription_exemptions e
    join public.workspace_members m on m.user_id=e.user_id
    where e.user_id=(select auth.uid()) and m.workspace_id=p_workspace_id and m.status='active'
  );
$$;
revoke all on function private.platform_admin_subscription_exempt_v1(uuid) from public,anon,authenticated,service_role;

-- VXA-003: existing membership/role policies still apply. These restrictions
-- only govern authenticated mutations; reads and server billing recovery remain
-- available after expiry. A linked Stripe record takes precedence over manual,
-- demo and trial fallbacks, matching getSubscriptionStatus.
create function private.workspace_billing_entitled_v1(p_workspace_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare w public.workspaces; s public.customer_subscriptions;
begin
  select * into w from public.workspaces where id=p_workspace_id;
  if not found then return false; end if;
  select * into s from public.customer_subscriptions where workspace_id=p_workspace_id
    and billing_provider='stripe' order by created_at desc,id desc limit 1;
  if found then
    return not s.manually_activated and s.status in ('active','trialing')
      and coalesce(s.current_period_end>statement_timestamp(),false)
      and coalesce(s.stripe_customer_id,'')<>'' and coalesce(s.stripe_subscription_id,'')<>'';
  end if;
  if not w.subscription_required then return true; end if;
  if w.manually_unlocked and exists (select 1 from public.customer_subscriptions sub
    where sub.workspace_id=p_workspace_id and sub.billing_provider='manual'
      and sub.manually_activated and sub.status in ('active','trialing')) then return true; end if;
  return w.subscription_status='demo' or
    (w.subscription_status='trialing' and coalesce(w.trial_ends_at>statement_timestamp(),false));
end;
$$;
revoke all on function private.workspace_billing_entitled_v1(uuid) from public,anon,authenticated,service_role;
create function private.workspace_entitlement_active_v1(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.platform_admin_subscription_exempt_v1(p_workspace_id)
    or private.workspace_billing_entitled_v1(p_workspace_id);
$$;
revoke all on function private.workspace_entitlement_active_v1(uuid) from public,anon,authenticated,service_role;
create function private.workspace_mutation_entitled_v1(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id
    and m.user_id=(select auth.uid()) and m.status='active')
    and private.workspace_entitlement_active_v1(p_workspace_id);
$$;
revoke all on function private.workspace_mutation_entitled_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function private.workspace_mutation_entitled_v1(uuid) to authenticated;

-- RLS cannot constrain SECURITY DEFINER RPCs. The request role comes from the
-- PostgREST-verified JWT, not current_user (which changes inside a definer).
-- No exposed RPC permits callers to set that claim. Existing RPC role/member
-- checks remain responsible for authorization; this trigger adds entitlement.
-- Invite acceptance may create the actor's first active membership, so the
-- trigger checks workspace entitlement rather than requiring membership first.
create function private.guard_workspace_mutation_entitlement_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare old_workspace uuid; new_workspace uuid;
begin
  if (select auth.role())='authenticated' then
    if tg_op<>'INSERT' then old_workspace:=(to_jsonb(old)->>tg_argv[0])::uuid; end if;
    if tg_op<>'DELETE' then new_workspace:=(to_jsonb(new)->>tg_argv[0])::uuid; end if;
    -- The workspace's own guarded DELETE has already authorized a cascade.
    -- Its child FK actions run after the parent disappears; do not mistake
    -- that disappearance for an expired entitlement and block the cascade.
    if tg_op<>'INSERT' and pg_trigger_depth()>1 and old_workspace is not null
      and not exists(select 1 from public.workspaces w where w.id=old_workspace) then
      if tg_op='DELETE' then return old; end if;
      return new;
    end if;
    if (select auth.uid()) is null
      or (tg_op<>'INSERT' and not private.workspace_entitlement_active_v1(old_workspace))
      or (tg_op<>'DELETE' and not private.workspace_entitlement_active_v1(new_workspace)) then
      raise exception 'workspace_subscription_required' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_workspace_mutation_entitlement_v1() from public,anon,authenticated,service_role;

-- Apply only to existing tenant tables with RLS. No permissive policies or
-- grants are added. Support/entitlement records are recovery surfaces, not
-- operational data. New tables must receive the same restrictions explicitly.
-- The two integration summaries are SELECT-only customer projections. Their
-- existing private AFTER triggers must publish disconnect/freshness withdrawal
-- after expiry; private connection/OAuth INSERT guards still enforce admission.
do $$
declare item record;
begin
  for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and a.atttypid='uuid'::regtype and c.relname not in
        ('support_requests','customer_subscriptions','subscription_events','security_audit_events',
         'manual_activation_requests','stripe_checkout_intents','workspace_agreements',
         'integration_connection_summaries','integration_freshness_summaries')
  loop
    execute format('create policy audit_entitled_insert on public.%I as restrictive for insert to authenticated with check (private.workspace_mutation_entitled_v1(workspace_id))',item.relname);
    execute format('create policy audit_entitled_update on public.%I as restrictive for update to authenticated using (private.workspace_mutation_entitled_v1(workspace_id)) with check (private.workspace_mutation_entitled_v1(workspace_id))',item.relname);
    execute format('create policy audit_entitled_delete on public.%I as restrictive for delete to authenticated using (private.workspace_mutation_entitled_v1(workspace_id))',item.relname);
    execute format('create trigger audit_workspace_entitlement before insert or update or delete on public.%I for each row execute function private.guard_workspace_mutation_entitlement_v1(''workspace_id'')',item.relname);
  end loop;
end;
$$;
create policy audit_entitled_update on public.workspaces as restrictive for update to authenticated
  using (private.workspace_mutation_entitled_v1(id)) with check (private.workspace_mutation_entitled_v1(id));
create policy audit_entitled_delete on public.workspaces as restrictive for delete to authenticated
  using (private.workspace_mutation_entitled_v1(id));
create trigger audit_workspace_entitlement before update or delete on public.workspaces
  for each row execute function private.guard_workspace_mutation_entitlement_v1('id');

-- Authenticated SECURITY DEFINER connection/OAuth RPCs write private tables.
-- Guard new connection/authorization records as well. Existing disconnect and
-- revocation updates, freshness withdrawal and their audit trail remain
-- available for recovery; none of those paths creates a new authorization.
create trigger audit_workspace_entitlement before insert on private.integration_connections
  for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');
create trigger audit_workspace_entitlement before insert on private.integration_oauth_states
  for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');
create trigger audit_workspace_entitlement before insert on private.integration_qbo_oauth_state_bindings_v2
  for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');
create trigger audit_workspace_entitlement before insert on private.integration_reauthorization_states
  for each row execute function private.guard_workspace_mutation_entitlement_v1('workspace_id');

create function private.workspace_storage_mutation_entitled_v1(p_bucket text,p_name text)
-- Resolve the nested private predicate as the owner without granting private
-- schema access to callers. That predicate still checks the original auth.uid.
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_bucket<>'workspace-files' then true
    when split_part(p_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then private.workspace_mutation_entitled_v1(split_part(p_name,'/',1)::uuid) else false end;
$$;
revoke all on function private.workspace_storage_mutation_entitled_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function private.workspace_storage_mutation_entitled_v1(text,text) to authenticated;
create policy audit_entitled_insert on storage.objects as restrictive for insert to authenticated
  with check (private.workspace_storage_mutation_entitled_v1(bucket_id,name));
create policy audit_entitled_update on storage.objects as restrictive for update to authenticated
  using (private.workspace_storage_mutation_entitled_v1(bucket_id,name))
  with check (private.workspace_storage_mutation_entitled_v1(bucket_id,name));
create policy audit_entitled_delete on storage.objects as restrictive for delete to authenticated
  using (private.workspace_storage_mutation_entitled_v1(bucket_id,name));
create function private.guard_workspace_storage_entitlement_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role())='authenticated' then
    if (tg_op<>'INSERT' and not private.workspace_storage_mutation_entitled_v1(old.bucket_id,old.name))
      or (tg_op<>'DELETE' and not private.workspace_storage_mutation_entitled_v1(new.bucket_id,new.name)) then
      raise exception 'workspace_subscription_required' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_workspace_storage_entitlement_v1() from public,anon,authenticated,service_role;
create trigger audit_workspace_entitlement before insert or update or delete on storage.objects
  for each row execute function private.guard_workspace_storage_entitlement_v1();

-- VXA-004: retain old audit history without treating client-writable legacy
-- events as trusted lockout evidence. Only the server credential may append.
alter table public.security_audit_events add column server_recorded boolean not null default false;
revoke insert,update,delete,truncate,references,trigger on public.security_audit_events from public,anon,authenticated;
drop policy if exists "security audit events members create" on public.security_audit_events;
drop policy if exists "security audit events contributors create" on public.security_audit_events;
grant select,insert on public.security_audit_events to service_role;
create function private.stamp_security_audit_event_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A definer's owner is not proof of a trusted request. Preserve the original
  -- verified role check even when a future RPC inserts on a client's behalf.
  if (select auth.role()) in ('anon','authenticated')
    or current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'security_audit_writer_denied' using errcode='42501';
  end if;
  new.server_recorded:=true;
  new.created_at:=clock_timestamp();
  return new;
end;
$$;
revoke all on function private.stamp_security_audit_event_v1() from public,anon,authenticated,service_role;
create trigger stamp_security_audit_event before insert on public.security_audit_events
  for each row execute function private.stamp_security_audit_event_v1();
create index security_audit_events_trusted_blocked_idx on public.security_audit_events(workspace_id,user_id,created_at desc)
  where server_recorded and not allowed;

-- VXA-005: historical mismatches are retained for explicit repair. NOT VALID
-- protects every new/changed relationship without scanning away old evidence.
-- Removing the single-column FK also removes its cross-tenant delete cascade.
do $$
declare invalid_count bigint;
begin
  select count(*) into invalid_count from public.asset_checks c left join public.assets a
    on (a.workspace_id,a.id)=(c.workspace_id,c.asset_id) where a.id is null;
  if invalid_count>0 then raise notice 'Asset check tenant FK: % historical rows require review before VALIDATE CONSTRAINT',invalid_count; end if;
end;
$$;
alter table public.assets add constraint assets_workspace_id_id_key unique(workspace_id,id);
alter table public.asset_checks drop constraint asset_checks_asset_id_fkey;
alter table public.asset_checks add constraint asset_checks_workspace_asset_fkey
  foreign key(workspace_id,asset_id) references public.assets(workspace_id,id) on delete cascade not valid;

-- The same verified parent-scope defect exists for internal form submissions.
do $$
declare invalid_count bigint;
begin
  select count(*) into invalid_count from public.form_submissions s left join public.forms f
    on (f.workspace_id,f.id)=(s.workspace_id,s.form_id) where f.id is null;
  if invalid_count>0 then raise notice 'Form submission tenant FK: % historical rows require review before VALIDATE CONSTRAINT',invalid_count; end if;
end;
$$;
alter table public.forms add constraint forms_workspace_id_id_key unique(workspace_id,id);
alter table public.form_submissions drop constraint form_submissions_form_id_fkey;
alter table public.form_submissions add constraint form_submissions_workspace_form_fkey
  foreign key(workspace_id,form_id) references public.forms(workspace_id,id) on delete cascade not valid;

-- VXA-007: serialize checks of one asset before they become visible; readiness
-- then commits or rolls back with the check, including staff-created checks.
-- An older imported check cannot overwrite a later check. Lifecycle changes
-- choose the latest active check and retain all archived/hidden history.
create function private.lock_asset_check_parent_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_workspace uuid; target_asset uuid;
begin
  if tg_op='UPDATE' and (new.workspace_id,new.asset_id) is distinct from (old.workspace_id,old.asset_id) then
    raise exception 'asset_check_parent_immutable' using errcode='23514';
  end if;
  if tg_op='DELETE' then target_workspace:=old.workspace_id; target_asset:=old.asset_id;
  else target_workspace:=new.workspace_id; target_asset:=new.asset_id; end if;
  perform 1 from public.assets a where (a.workspace_id,a.id)=(target_workspace,target_asset) for update;
  -- A parent deletion can cascade through old checks after its row is gone.
  if not found and tg_op='INSERT' then raise exception 'asset_check_parent_invalid' using errcode='23503'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create function private.refresh_asset_check_readiness_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_workspace uuid; target_asset uuid; latest_status text; latest_at timestamptz;
begin
  if tg_op='DELETE' then target_workspace:=old.workspace_id; target_asset:=old.asset_id;
  else target_workspace:=new.workspace_id; target_asset:=new.asset_id; end if;
  select c.status,c.created_at into latest_status,latest_at from public.asset_checks c
    where (c.workspace_id,c.asset_id)=(target_workspace,target_asset)
      and c.archived_at is null and c.deleted_at is null order by c.created_at desc,c.id desc limit 1;
  update public.assets set status=coalesce(latest_status,'Needs attention'),last_checked_at=latest_at
    where (workspace_id,id)=(target_workspace,target_asset);
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.lock_asset_check_parent_v1() from public,anon,authenticated,service_role;
revoke all on function private.refresh_asset_check_readiness_v1() from public,anon,authenticated,service_role;
create trigger lock_asset_check_parent before insert or update or delete on public.asset_checks
  for each row execute function private.lock_asset_check_parent_v1();
create trigger refresh_asset_check_readiness after insert or update or delete on public.asset_checks
  for each row execute function private.refresh_asset_check_readiness_v1();
create index asset_checks_latest_active_idx on public.asset_checks(workspace_id,asset_id,created_at desc,id desc)
  where archived_at is null and deleted_at is null;
create index asset_checks_workspace_history_idx on public.asset_checks(workspace_id,created_at desc,id desc);
create index asset_checks_asset_history_idx on public.asset_checks(workspace_id,asset_id,created_at desc,id desc);

commit;
