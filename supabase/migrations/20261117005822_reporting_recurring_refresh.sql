begin;

-- Rollout is separately scoped by the server dispatcher. Existing connections
-- receive no recurring permission and no due date from this migration.
alter table public.reporting_connections
  add column recurring_enabled boolean not null default false,
  add column recurring_authorized_by uuid references public.profiles(id),
  add column recurring_authorized_at timestamptz,
  add column recurring_next_refresh_at timestamptz,
  add column recurring_last_attempt_at timestamptz,
  add column recurring_failure_count integer not null default 0 check (recurring_failure_count between 0 and 30),
  add column recurring_last_failure_at timestamptz,
  add column lease_kind text check (lease_kind in ('manual','scheduled')),
  add constraint reporting_recurring_authorization check (not recurring_enabled or
    (recurring_authorized_by is not null and recurring_authorized_at is not null and recurring_next_refresh_at is not null));
create index reporting_recurring_due on public.reporting_connections(recurring_next_refresh_at,workspace_id,id)
  where recurring_enabled and status='connected';
create index reporting_active_lease on public.reporting_connections(lease_expires_at,workspace_id)
  where lease_id is not null;

-- The existing generic billing helper has no Google-specific policy. Reuse its
-- locked Stripe/manual/demo/trial entitlement check; do not infer entitlement
-- from a stale session, a connection, or provider availability.
create function private.reporting_recurring_authority(p_connection public.reporting_connections)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not p_connection.recurring_enabled or p_connection.status<>'connected' then return false; end if;
  perform 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_connection.workspace_id and m.user_id=p_connection.recurring_authorized_by
      and m.status='active' and m.role='owner' and u.deleted_at is null
      and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
  if not found then return false; end if;
  begin
    perform private.require_google_sheets_eligible_v1(p_connection.workspace_id);
  exception when insufficient_privilege then return false;
  end;
  return true;
end $$;
revoke all on function private.reporting_recurring_authority(public.reporting_connections) from public,anon,authenticated,service_role;

create function private.reporting_recurring_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Revocation/account replacement cannot leave a worker able to save a token
  -- or report under the old consent. No copied/retargeted consent is accepted.
  if new.status<>'connected' or new.workspace_id is distinct from old.workspace_id
    or new.provider is distinct from old.provider or new.id is distinct from old.id
    or new.account is distinct from old.account then
    new.recurring_enabled:=false; new.recurring_next_refresh_at:=null;
    if old.lease_kind='scheduled' then new.lease_id:=null; new.lease_expires_at:=null; new.lease_kind:=null; end if;
  end if;
  return new;
end $$;
revoke all on function private.reporting_recurring_lifecycle() from public,anon,authenticated,service_role;
create trigger reporting_recurring_lifecycle before update on public.reporting_connections
  for each row execute function private.reporting_recurring_lifecycle();

create function public.set_reporting_recurring(p_workspace uuid,p_provider text,p_connection uuid,p_actor uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'invalid_recurring_settings'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection for update;
  if not found or (p_enabled and c.status<>'connected') then return false; end if;
  perform 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.status='active' and m.role='owner'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
  if not found then raise exception 'owner_required' using errcode='42501'; end if;
  if p_enabled then
    perform private.require_google_sheets_eligible_v1(p_workspace);
    if not exists(select 1 from public.reporting_credentials where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection) then return false; end if;
  end if;
  -- A repeated submission does not move the due date or grant another attempt.
  if c.recurring_enabled=p_enabled and (not p_enabled or c.recurring_authorized_by=p_actor) then return true; end if;
  update public.reporting_connections set recurring_enabled=p_enabled,
    recurring_authorized_by=case when p_enabled then p_actor else recurring_authorized_by end,
    recurring_authorized_at=case when p_enabled then clock_timestamp() else recurring_authorized_at end,
    recurring_next_refresh_at=case when p_enabled then greatest(clock_timestamp(),next_sync_at) else null end,
    lease_id=case when lease_kind='scheduled' then null else lease_id end,
    lease_expires_at=case when lease_kind='scheduled' then null else lease_expires_at end,
    lease_kind=case when lease_kind='scheduled' then null else lease_kind end
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

-- Settings read after the page's workspace authorization. This service-only
-- response contains no credential, identity, account or billing record details.
-- Admission/commit still perform their locked checks independently.
create function public.reporting_recurring_status(p_workspace uuid,p_provider text,p_connection uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; reason text:='active';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  if not found then return null; end if;
  if c.status<>'connected' then reason:='connection_unavailable';
  elsif not c.recurring_enabled then reason:='disabled';
  elsif not exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=c.workspace_id and m.user_id=c.recurring_authorized_by and m.status='active' and m.role='owner'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then reason:='owner_unavailable';
  elsif not private.workspace_billing_entitled_v1(p_workspace) then reason:='entitlement_unavailable';
  end if;
  return jsonb_build_object('authorized',reason='active','reason',reason);
end $$;

create function private.validate_reporting_dispatch_scope(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_allowed_workspaces is null
    or cardinality(p_allowed_workspaces) not between 1 and 100 or array_position(p_allowed_workspaces,null) is not null
    or p_allowed_providers is null or cardinality(p_allowed_providers) not between 1 and 6
    or array_position(p_allowed_providers,null) is not null
    or not(p_allowed_providers <@ array['xero','harvest','clockify','zoho-inventory','toggl','katana']) then
    raise exception 'invalid_reporting_dispatch_scope';
  end if;
end $$;
revoke all on function private.validate_reporting_dispatch_scope(integer,uuid[],text[]) from public,anon,authenticated,service_role;

create function public.list_due_reporting_refreshes(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns table(id uuid,workspace_id uuid,provider text) language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform private.validate_reporting_dispatch_scope(p_limit,p_allowed_workspaces,p_allowed_providers);
  if p_limit>20 then raise exception 'invalid_reporting_dispatch_scope'; end if;
  return query select q.id,q.workspace_id,q.provider from (
    select c.id,c.workspace_id,c.provider,c.recurring_next_refresh_at,
      row_number() over(partition by c.workspace_id order by c.recurring_next_refresh_at,c.id) as tenant_ordinal
    from public.reporting_connections c where c.recurring_enabled and c.status='connected'
      and c.workspace_id=any(p_allowed_workspaces) and c.provider=any(p_allowed_providers)
      and c.recurring_next_refresh_at<=clock_timestamp() and c.next_sync_at<=clock_timestamp()
      and c.lease_id is null
      and private.workspace_billing_entitled_v1(c.workspace_id)
      and exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
        where m.workspace_id=c.workspace_id and m.user_id=c.recurring_authorized_by and m.status='active' and m.role='owner'
          and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
      and exists(select 1 from public.reporting_credentials k where k.workspace_id=c.workspace_id and k.provider=c.provider and k.connection_id=c.id)
  ) q order by q.tenant_ordinal,q.recurring_next_refresh_at,q.id limit p_limit;
end $$;

create function public.claim_reporting_recurring(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_lease is null then raise exception 'invalid_reporting_lease'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:'||p_workspace::text,0));
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection for update;
  if not found or c.lease_id is not null or c.recurring_next_refresh_at>clock_timestamp()
    or c.next_sync_at>clock_timestamp() or not private.reporting_recurring_authority(c) then return false; end if;
  if not exists(select 1 from public.reporting_credentials where workspace_id=p_workspace and provider=p_provider and connection_id=p_connection) then return false; end if;
  if exists(select 1 from public.reporting_connections where workspace_id=p_workspace and lease_expires_at>clock_timestamp()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from public.reporting_connections where lease_expires_at>v_now)>=4 then return false; end if;
  update public.reporting_connections set lease_id=p_lease,lease_expires_at=v_now+interval '65 seconds',lease_kind='scheduled',
    recurring_last_attempt_at=v_now,next_sync_at=v_now+interval '1 hour'
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

-- Keep the manual hourly cooldown and return contract, but share admission
-- locks/capacity with scheduled readers. Expired scheduled work is reconciled
-- by recovery before another claim; it cannot silently become a manual lease.
create or replace function public.claim_reporting_sync(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_lease is null then raise exception 'invalid_reporting_lease'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:'||p_workspace::text,0));
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection for update;
  if not found or c.status<>'connected' or c.next_sync_at>clock_timestamp() or c.lease_expires_at>clock_timestamp()
    or (c.lease_kind='scheduled' and c.lease_id is not null) then return false; end if;
  if exists(select 1 from public.reporting_connections where workspace_id=p_workspace and id<>p_connection and lease_expires_at>clock_timestamp()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from public.reporting_connections where lease_expires_at>v_now)>=4 then return false; end if;
  update public.reporting_connections set lease_id=p_lease,lease_expires_at=v_now+interval '65 seconds',lease_kind='manual',next_sync_at=v_now+interval '1 hour'
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

create function public.fail_reporting_recurring(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_error text,p_retry_seconds integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; retry_seconds integer; failures integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_error is null or p_error not in ('sync_failed','authorization_required','quota_exceeded','snapshot_too_large')
    or p_retry_seconds is null or p_retry_seconds not between 0 and 86400 then raise exception 'invalid_reporting_failure'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection
    and lease_id=p_lease and lease_kind='scheduled' and status='connected' for update;
  if not found then return false; end if;
  failures:=least(c.recurring_failure_count+1,30);
  retry_seconds:=greatest(p_retry_seconds,least(86400,(3600*power(2,least(failures-1,5)))::integer));
  update public.reporting_connections set last_error_code=p_error,recurring_last_failure_at=clock_timestamp(),
    recurring_failure_count=failures,recurring_next_refresh_at=clock_timestamp()+make_interval(secs=>retry_seconds),
    next_sync_at=greatest(next_sync_at,clock_timestamp()+make_interval(secs=>retry_seconds)),
    status=case when p_error='authorization_required' then 'reauthorization_required' else status end,
    lease_id=null,lease_expires_at=null,lease_kind=null
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

create function public.recover_reporting_recurring(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns integer language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; recovered integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform private.validate_reporting_dispatch_scope(p_limit,p_allowed_workspaces,p_allowed_providers);
  for c in select * from public.reporting_connections where (lease_kind='scheduled' or recurring_enabled) and lease_expires_at<=clock_timestamp()
    and workspace_id=any(p_allowed_workspaces) and provider=any(p_allowed_providers)
    order by lease_expires_at,id limit p_limit for update skip locked loop
    if c.lease_kind='scheduled' then
      if public.fail_reporting_recurring(c.workspace_id,c.provider,c.id,c.lease_id,'sync_failed',0) then recovered:=recovered+1; end if;
    else
      -- A crashed manual reader must not strand an opted-in connection. Keep
      -- the failed manual attempt distinct from scheduled failure accounting.
      update public.reporting_connections set lease_id=null,lease_expires_at=null,lease_kind=null,last_error_code='sync_failed',
        next_sync_at=greatest(next_sync_at,clock_timestamp()+interval '1 hour'),
        recurring_next_refresh_at=greatest(recurring_next_refresh_at,clock_timestamp()+interval '1 hour')
        where workspace_id=c.workspace_id and provider=c.provider and id=c.id and lease_id=c.lease_id;
      if found then recovered:=recovered+1; end if;
    end if;
  end loop;
  return recovered;
end $$;

-- Keep validation, pagination commit semantics, and deletion/upsert behavior in
-- the original atomic functions. Public wrappers add current authority fences
-- only to scheduled leases; no new evidence store or duplicate normalization.
alter function public.apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb) rename to apply_reporting_snapshot_before_recurring;
alter function public.apply_reporting_snapshot_before_recurring(uuid,text,uuid,uuid,jsonb) set schema private;
alter function public.apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz) rename to apply_reporting_history_before_recurring;
alter function public.apply_reporting_history_before_recurring(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz) set schema private;
alter function public.save_reporting_refresh(uuid,text,uuid,uuid,text) rename to save_reporting_refresh_before_recurring;
alter function public.save_reporting_refresh_before_recurring(uuid,text,uuid,uuid,text) set schema private;
revoke all on function private.apply_reporting_snapshot_before_recurring(uuid,text,uuid,uuid,jsonb),
  private.apply_reporting_history_before_recurring(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz),
  private.save_reporting_refresh_before_recurring(uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.finish_reporting_recurring_success(p_workspace uuid,p_provider text,p_connection uuid,p_scheduled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.reporting_connections set lease_kind=null,
    recurring_next_refresh_at=case when p_scheduled and recurring_enabled then clock_timestamp()+
      case when provider in ('xero','harvest','clockify') then interval '24 hours' else interval '6 hours' end else recurring_next_refresh_at end,
    recurring_failure_count=case when p_scheduled then 0 else recurring_failure_count end,
    recurring_last_failure_at=case when p_scheduled then null else recurring_last_failure_at end
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
end $$;
revoke all on function private.finish_reporting_recurring_success(uuid,text,uuid,boolean) from public,anon,authenticated,service_role;

create function public.apply_reporting_snapshot(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; applied boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection
    and status='connected' and lease_id=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if c.lease_kind='scheduled' and not private.reporting_recurring_authority(c) then return false; end if;
  if c.lease_kind='scheduled' and p_provider in ('xero','harvest','clockify') then raise exception 'invalid_scheduled_report_kind'; end if;
  applied:=private.apply_reporting_snapshot_before_recurring(p_workspace,p_provider,p_connection,p_lease,p_snapshot);
  if applied then perform private.finish_reporting_recurring_success(p_workspace,p_provider,p_connection,c.lease_kind='scheduled'); end if;
  return applied;
end $$;

create function public.apply_reporting_history(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,
  p_start_date date,p_end_date date,p_records jsonb,p_currencies text[],p_observed_through timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections; applied boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection
    and status='connected' and lease_id=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if c.lease_kind='scheduled' and not private.reporting_recurring_authority(c) then return false; end if;
  if c.lease_kind='scheduled' and (p_start_date is distinct from (c.recurring_last_attempt_at at time zone 'UTC')::date-7
    or p_end_date is distinct from (c.recurring_last_attempt_at at time zone 'UTC')::date-1
    or p_observed_through is distinct from (((c.recurring_last_attempt_at at time zone 'UTC')::date)::timestamp at time zone 'UTC'))
    then raise exception 'invalid_scheduled_reporting_period'; end if;
  applied:=private.apply_reporting_history_before_recurring(p_workspace,p_provider,p_connection,p_lease,p_start_date,p_end_date,p_records,p_currencies,p_observed_through);
  if applied then perform private.finish_reporting_recurring_success(p_workspace,p_provider,p_connection,c.lease_kind='scheduled'); end if;
  return applied;
end $$;

create function public.save_reporting_refresh(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_ciphertext text)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.reporting_connections;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into c from public.reporting_connections where workspace_id=p_workspace and provider=p_provider and id=p_connection
    and status='connected' and lease_id=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if c.lease_kind='scheduled' and not private.reporting_recurring_authority(c) then return false; end if;
  return private.save_reporting_refresh_before_recurring(p_workspace,p_provider,p_connection,p_lease,p_ciphertext);
end $$;

revoke all on function public.set_reporting_recurring(uuid,text,uuid,uuid,boolean),
  public.reporting_recurring_status(uuid,text,uuid),
  public.list_due_reporting_refreshes(integer,uuid[],text[]),public.claim_reporting_recurring(uuid,text,uuid,uuid),
  public.fail_reporting_recurring(uuid,text,uuid,uuid,text,integer),public.recover_reporting_recurring(integer,uuid[],text[]),
  public.apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb),
  public.apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz),
  public.save_reporting_refresh(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_reporting_recurring(uuid,text,uuid,uuid,boolean),
  public.reporting_recurring_status(uuid,text,uuid),
  public.list_due_reporting_refreshes(integer,uuid[],text[]),public.claim_reporting_recurring(uuid,text,uuid,uuid),
  public.fail_reporting_recurring(uuid,text,uuid,uuid,text,integer),public.recover_reporting_recurring(integer,uuid[],text[]),
  public.apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb),
  public.apply_reporting_history(uuid,text,uuid,uuid,date,date,jsonb,text[],timestamptz),
  public.save_reporting_refresh(uuid,text,uuid,uuid,text) to service_role;
commit;
