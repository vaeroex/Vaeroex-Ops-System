begin;

-- VXA-026: a UI preflight is advisory, not an atomic reservation. Serialize
-- persisted file/run slots at a private per-workspace row. This retains billing:
-- all run statuses count in the UTC month; archived files still count; hidden
-- files do not. It is not a provider-token/spend reservation (DEC-015 remains).
create function private.workspace_persisted_limit_v1(p_workspace_id uuid,p_category text)
returns integer language plpgsql stable security definer set search_path='' as $$
declare w public.workspaces; s public.customer_subscriptions; plan public.subscription_plans; plan_name text;
begin
  select * into w from public.workspaces where id=p_workspace_id;
  if not found then raise exception 'workspace_missing' using errcode='23503'; end if;
  -- Match the established no-plan/unlimited platform-admin bypass only when
  -- explicitly configured by a trusted operator and still an active member.
  if private.platform_admin_subscription_exempt_v1(p_workspace_id) then return null; end if;
  select * into s from public.customer_subscriptions where workspace_id=p_workspace_id
    and billing_provider='stripe' order by created_at desc,id desc limit 1;
  if not found then
    -- getSubscriptionStatus returns no plan for these workspace fallbacks.
    if not w.subscription_required then return null; end if;
    if w.manually_unlocked then
      select * into s from public.customer_subscriptions where workspace_id=p_workspace_id
        and billing_provider='manual' and manually_activated and status in ('active','trialing')
        order by created_at desc,id desc limit 1;
    end if;
  end if;
  select * into plan from public.subscription_plans where slug=s.plan_slug;
  if not found then return null; end if;
  plan_name:=lower(btrim(plan.slug));
  if plan_name in ('vaeroex','starter','growth','pro') then
    return case p_category when 'files' then 500 when 'ai_runs_this_month' then 1000 else null end;
  end if;
  return case p_category when 'ai_runs_this_month' then plan.max_ai_runs_per_month else null end;
end;
$$;
revoke all on function private.workspace_persisted_limit_v1(uuid,text) from public,anon,authenticated,service_role;

create table private.workspace_usage_locks (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision bigint not null default 0
);
revoke all on private.workspace_usage_locks from public,anon,authenticated,service_role;

-- A service-only RPC can bind a server-authenticated actor to one new run.
-- Neither authenticated nor service clients can write these authorizations
-- directly. Their lifetime is one RPC transaction, not a session-wide bypass.
create table private.ai_run_actor_authorizations (
  run_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  transaction_id bigint not null
);
alter table private.ai_run_actor_authorizations enable row level security;
revoke all on private.ai_run_actor_authorizations from public,anon,authenticated,service_role;

create function private.enforce_workspace_persisted_limit_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare limit_value integer; used_slots bigint; month_start timestamptz;
begin
  if tg_op='UPDATE' then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'workspace_identity_immutable' using errcode='23514';
    end if;
    if tg_table_name='ai_agent_runs' then
      if new.created_at is distinct from old.created_at then
        raise exception 'usage_timestamp_immutable' using errcode='23514';
      end if;
      return new;
    end if;
    -- Only restoring a hidden file consumes an additional live slot.
    if old.deleted_at is null or new.deleted_at is not null then return new; end if;
  end if;
  if tg_table_name='file_uploads' then
    if new.deleted_at is not null then return new; end if;
  end if;
  if tg_table_name='ai_agent_runs' and (select auth.role())='authenticated' then
    new.created_at:=clock_timestamp();
  end if;

  -- A real row update, retained until commit, serializes independent sessions.
  -- VOLATILE SPI queries see the preceding lock holder's committed inserts at
  -- READ COMMITTED; repeatable-read races fail with a serialization error.
  insert into private.workspace_usage_locks(workspace_id) values(new.workspace_id)
    on conflict(workspace_id) do update set revision=private.workspace_usage_locks.revision+1;
  if tg_table_name='file_uploads' then
    limit_value:=private.workspace_persisted_limit_v1(new.workspace_id,'files');
    select count(*) into used_slots from public.file_uploads where workspace_id=new.workspace_id and deleted_at is null and id<>new.id;
  else
    limit_value:=private.workspace_persisted_limit_v1(new.workspace_id,'ai_runs_this_month');
    if (select auth.role())='service_role' and exists (
      select 1 from private.ai_run_actor_authorizations a
      join private.platform_admin_subscription_exemptions e on e.user_id=a.actor_id
      join public.workspace_members m on m.user_id=a.actor_id and m.workspace_id=a.workspace_id
      where a.run_id=new.id and a.workspace_id=new.workspace_id and a.actor_id=new.created_by
        and a.transaction_id=txid_current() and m.status='active'
        and m.role in ('owner','admin','manager','staff','viewer')
    ) then limit_value:=null; end if;
    month_start:=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
    -- Trusted service backfills outside the billed month retain their timestamp.
    if new.created_at<month_start then return new; end if;
    select count(*) into used_slots from public.ai_agent_runs where workspace_id=new.workspace_id and created_at>=month_start and id<>new.id;
  end if;
  if limit_value is not null and used_slots>=limit_value then
    raise exception 'workspace_usage_limit_reached' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_workspace_persisted_limit_v1() from public,anon,authenticated,service_role;
create trigger workspace_persisted_usage_limit before insert or update on public.file_uploads
  for each row execute function private.enforce_workspace_persisted_limit_v1();
create trigger workspace_persisted_usage_limit before insert or update on public.ai_agent_runs
  for each row execute function private.enforce_workspace_persisted_limit_v1();
create index file_uploads_live_usage_idx on public.file_uploads(workspace_id) where deleted_at is null;
create index ai_agent_runs_monthly_usage_idx on public.ai_agent_runs(workspace_id,created_at);

-- Only the three existing service-persisted, read-derived analysis workflows
-- may use this path. Callers authenticate the actor with auth.getUser() first;
-- the RPC independently verifies live membership, entitlement and quota. Their
-- existing all-active-role access is retained; this does not authorize generic
-- record writes, accept caller timestamps/status/output, or alter JWT claims.
create function public.create_trusted_analysis_run_v1(
  p_workspace_id uuid,p_actor_id uuid,p_agent_type text,p_input_json jsonb
) returns table(id uuid) language plpgsql security definer set search_path='' as $$
declare v_run_id uuid:=gen_random_uuid();
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'trusted_analysis_caller_denied' using errcode='42501'; end if;
  if p_agent_type not in ('business_health_explanation_v1','intelligence_briefing_v1','finding_explanation_v1')
    or p_agent_type is null or jsonb_typeof(p_input_json) is distinct from 'object'
    or pg_column_size(p_input_json)>262144 then
    raise exception 'trusted_analysis_payload_invalid' using errcode='22023'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id=p_workspace_id
    and m.user_id=p_actor_id and m.status='active' and m.role in ('owner','admin','manager','staff','viewer')) then
    raise exception 'trusted_analysis_actor_denied' using errcode='42501'; end if;
  if not exists (select 1 from private.platform_admin_subscription_exemptions e where e.user_id=p_actor_id)
    and not private.workspace_billing_entitled_v1(p_workspace_id) then
    raise exception 'workspace_subscription_required' using errcode='42501'; end if;
  insert into private.workspace_usage_locks(workspace_id) values(p_workspace_id)
    on conflict(workspace_id) do update set revision=private.workspace_usage_locks.revision+1;
  -- Preserve the existing generation-claim 23505 contract even when the quota
  -- is full. Check the exact existing partial unique-index predicates after
  -- taking the same admission mutex, so concurrent retries see the winner.
  if p_agent_type='business_health_explanation_v1'
    and nullif(p_input_json->>'generation_policy_version','') is not null
    and nullif(p_input_json->>'fingerprint','') is not null
    and exists(select 1 from public.ai_agent_runs r where r.workspace_id=p_workspace_id
      and r.agent_type=p_agent_type and r.status in ('processing','completed')
      and nullif(r.input_json->>'generation_policy_version','') is not null
      and r.input_json->>'fingerprint'=p_input_json->>'fingerprint') then
    raise exception 'analysis_generation_already_claimed' using errcode='23505'; end if;
  if p_agent_type='intelligence_briefing_v1'
    and nullif(p_input_json->>'briefing_type','') is not null
    and nullif(p_input_json->>'generation_key','') is not null
    and exists(select 1 from public.ai_agent_runs r where r.workspace_id=p_workspace_id
      and r.agent_type=p_agent_type and r.status in ('processing','completed')
      and r.input_json->>'briefing_type'=p_input_json->>'briefing_type'
      and r.input_json->>'generation_key'=p_input_json->>'generation_key') then
    raise exception 'analysis_generation_already_claimed' using errcode='23505'; end if;
  insert into private.ai_run_actor_authorizations(run_id,workspace_id,actor_id,transaction_id)
    values(v_run_id,p_workspace_id,p_actor_id,txid_current());
  insert into public.ai_agent_runs(id,workspace_id,agent_type,input_json,output_json,status,created_by,created_at)
    values(v_run_id,p_workspace_id,p_agent_type,p_input_json,'{}'::jsonb,'processing',p_actor_id,clock_timestamp());
  delete from private.ai_run_actor_authorizations a where a.run_id=v_run_id;
  return query select v_run_id;
end;
$$;
revoke all on function public.create_trusted_analysis_run_v1(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_trusted_analysis_run_v1(uuid,uuid,text,jsonb) to service_role;

commit;
