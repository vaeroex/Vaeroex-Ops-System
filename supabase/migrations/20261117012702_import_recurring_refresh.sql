begin;

-- No existing connection is opted in. These columns describe operational
-- refresh state; original protected facts/coverage remain the evidence store.
do $$ declare t text; begin
  foreach t in array array['loyverse_connections','zoho_books_connections','wix_order_connections'] loop
    execute format('alter table public.%I
      add column recurring_enabled boolean not null default false,
      add column recurring_authorized_by uuid references public.profiles(id),
      add column recurring_authorized_at timestamptz,
      add column recurring_next_refresh_at timestamptz,
      add column recurring_last_attempt_at timestamptz,
      add column recurring_failure_count integer not null default 0 check(recurring_failure_count between 0 and 30),
      add column recurring_last_failure_at timestamptz,
      add column refresh_not_before timestamptz not null default clock_timestamp(),
      add column sync_lease_kind text check(sync_lease_kind in (''manual'',''scheduled'')),
      add column sync_lease_authorized_by uuid references public.profiles(id),
      add constraint %I check(not recurring_enabled or (recurring_authorized_by is not null
        and recurring_authorized_at is not null and recurring_next_refresh_at is not null))',t,t||'_recurring_consent');
    execute format('create index %I on public.%I(recurring_next_refresh_at,workspace_id,id) where recurring_enabled and status=''connected''',t||'_recurring_due',t);
    execute format('create index %I on public.%I(sync_lease_expires_at,workspace_id) where sync_lease_id is not null',t||'_active_lease',t);
  end loop;
end $$;

-- Only these fixed identifiers are admitted to dynamic SQL. No table, SQL,
-- column, provider hostname, or credentials are supplied by a caller.
create function private.import_refresh_table(p_provider text,p_credentials boolean default false)
returns text language plpgsql immutable set search_path='' as $$
begin
  return case p_provider
    when 'loyverse' then case when p_credentials then 'loyverse_credentials' else 'loyverse_connections' end
    when 'zoho-books' then case when p_credentials then 'zoho_books_credentials' else 'zoho_books_connections' end
    when 'wix-orders' then case when p_credentials then 'wix_order_credentials' else 'wix_order_connections' end
    else null end;
end $$;
revoke all on function private.import_refresh_table(text,boolean) from public,anon,authenticated,service_role;

create function private.read_import_refresh_connection(p_workspace uuid,p_provider text,p_connection uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t text:=private.import_refresh_table(p_provider); c jsonb;
begin
  if t is null then raise exception 'invalid_import_provider'; end if;
  execute format('select to_jsonb(c) from public.%I c where workspace_id=$1 and id=$2%s',t,
    case when p_lock then ' for update' else '' end) into c using p_workspace,p_connection;
  return c;
end $$;
revoke all on function private.read_import_refresh_connection(uuid,text,uuid,boolean) from public,anon,authenticated,service_role;

create function private.import_refresh_owner(p_workspace uuid,p_actor uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.status='active' and m.role='owner'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
  return found;
end $$;
revoke all on function private.import_refresh_owner(uuid,uuid) from public,anon,authenticated,service_role;

create function private.import_refresh_authority(p_connection jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  if p_connection is null or p_connection->>'status'<>'connected' then return false; end if;
  if p_connection->>'sync_lease_kind'='scheduled' then
    if not (p_connection->>'recurring_enabled')::boolean then return false; end if;
    actor:=(p_connection->>'recurring_authorized_by')::uuid;
    if actor is distinct from (p_connection->>'sync_lease_authorized_by')::uuid then return false; end if;
  else actor:=(p_connection->>'sync_lease_authorized_by')::uuid;
  end if;
  if not private.import_refresh_owner((p_connection->>'workspace_id')::uuid,actor) then return false; end if;
  begin
    -- Reuse the existing locked Stripe/manual/demo/trial decision. Its name is
    -- historical; the helper contains no Sheets-specific feature entitlement.
    perform private.require_google_sheets_eligible_v1((p_connection->>'workspace_id')::uuid);
  exception when insufficient_privilege then return false;
  end;
  return true;
end $$;
revoke all on function private.import_refresh_authority(jsonb) from public,anon,authenticated,service_role;

create function private.import_recurring_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_json jsonb:=to_jsonb(old); new_json jsonb:=to_jsonb(new);
begin
  if new.status<>'connected' or new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id
    or (old_json->'merchant_id') is distinct from (new_json->'merchant_id')
    or (old_json->'organization_id') is distinct from (new_json->'organization_id')
    or (old_json->'instance_hash') is distinct from (new_json->'instance_hash')
    or (old_json->'site_id') is distinct from (new_json->'site_id')
    or (old_json->'currency_code') is distinct from (new_json->'currency_code') then
    new.recurring_enabled:=false; new.recurring_next_refresh_at:=null;
    new.sync_lease_id:=null; new.sync_lease_expires_at:=null;
    new.sync_lease_kind:=null; new.sync_lease_authorized_by:=null;
  end if;
  return new;
end $$;
revoke all on function private.import_recurring_lifecycle() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['loyverse_connections','zoho_books_connections','wix_order_connections'] loop
    execute format('create trigger import_recurring_lifecycle before update on public.%I for each row execute function private.import_recurring_lifecycle()',t);
  end loop;
end $$;

create function public.set_import_recurring(p_workspace uuid,p_provider text,p_connection uuid,p_actor uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare c jsonb; present boolean; t text:=private.import_refresh_table(p_provider);
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'invalid_import_recurring_settings'; end if;
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection,true);
  if c is null or (p_enabled and c->>'status'<>'connected') then return false; end if;
  if not private.import_refresh_owner(p_workspace,p_actor) then raise exception 'owner_required' using errcode='42501'; end if;
  if p_enabled then
    perform private.require_google_sheets_eligible_v1(p_workspace);
    execute format('select exists(select 1 from public.%I where workspace_id=$1 and connection_id=$2)',private.import_refresh_table(p_provider,true)) into present using p_workspace,p_connection;
    if not present then return false; end if;
  end if;
  if (c->>'recurring_enabled')::boolean=p_enabled and (not p_enabled or (c->>'recurring_authorized_by')::uuid=p_actor) then return true; end if;
  execute format('update public.%I set recurring_enabled=$3,
    recurring_authorized_by=case when $3 then $4 else recurring_authorized_by end,
    recurring_authorized_at=case when $3 then clock_timestamp() else recurring_authorized_at end,
    recurring_next_refresh_at=case when $3 then greatest(clock_timestamp(),refresh_not_before) else null end,
    sync_lease_id=case when sync_lease_kind=''scheduled'' then null else sync_lease_id end,
    sync_lease_expires_at=case when sync_lease_kind=''scheduled'' then null else sync_lease_expires_at end,
    sync_lease_authorized_by=case when sync_lease_kind=''scheduled'' then null else sync_lease_authorized_by end,
    sync_lease_kind=case when sync_lease_kind=''scheduled'' then null else sync_lease_kind end,updated_at=clock_timestamp()
    where workspace_id=$1 and id=$2',t) using p_workspace,p_connection,p_enabled,p_actor;
  return true;
end $$;

create function public.import_recurring_status(p_workspace uuid,p_provider text,p_connection uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; reason text:='active';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection);
  if c is null then return null; end if;
  if c->>'status'<>'connected' then reason:='connection_unavailable';
  elsif not (c->>'recurring_enabled')::boolean then reason:='disabled';
  elsif not exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=(c->>'recurring_authorized_by')::uuid and m.status='active' and m.role='owner'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then reason:='owner_unavailable';
  elsif not private.workspace_billing_entitled_v1(p_workspace) then reason:='entitlement_unavailable'; end if;
  return jsonb_build_object('authorized',reason='active','reason',reason);
end $$;

create view private.import_refresh_connections as
  select 'loyverse'::text as provider,id,workspace_id,status,recurring_enabled,recurring_authorized_by,
    recurring_next_refresh_at,refresh_not_before,sync_lease_id,sync_lease_expires_at,sync_lease_kind from public.loyverse_connections
  union all select 'zoho-books',id,workspace_id,status,recurring_enabled,recurring_authorized_by,
    recurring_next_refresh_at,refresh_not_before,sync_lease_id,sync_lease_expires_at,sync_lease_kind from public.zoho_books_connections
  union all select 'wix-orders',id,workspace_id,status,recurring_enabled,recurring_authorized_by,
    recurring_next_refresh_at,refresh_not_before,sync_lease_id,sync_lease_expires_at,sync_lease_kind from public.wix_order_connections;
revoke all on private.import_refresh_connections from public,anon,authenticated,service_role;

-- Reporting and standalone imports share the same nine-connector capacity
-- boundary. Both families acquire the same workspace and aggregate locks.
create view private.integration_refresh_active_leases as
  select id,workspace_id,lease_expires_at from public.reporting_connections where lease_id is not null
  union all select id,workspace_id,sync_lease_expires_at from private.import_refresh_connections where sync_lease_id is not null;
revoke all on private.integration_refresh_active_leases from public,anon,authenticated,service_role;

create function private.validate_import_dispatch_scope(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_allowed_workspaces is null
    or cardinality(p_allowed_workspaces) not between 1 and 100 or array_position(p_allowed_workspaces,null) is not null
    or p_allowed_providers is null or cardinality(p_allowed_providers) not between 1 and 3
    or array_position(p_allowed_providers,null) is not null
    or not(p_allowed_providers <@ array['loyverse','zoho-books','wix-orders']) then raise exception 'invalid_import_dispatch_scope'; end if;
end $$;
revoke all on function private.validate_import_dispatch_scope(integer,uuid[],text[]) from public,anon,authenticated,service_role;

create function public.list_due_import_refreshes(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns table(id uuid,workspace_id uuid,provider text) language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform private.validate_import_dispatch_scope(p_limit,p_allowed_workspaces,p_allowed_providers);
  if p_limit>20 then raise exception 'invalid_import_dispatch_scope'; end if;
  return query select q.id,q.workspace_id,q.provider from (
    select c.id,c.workspace_id,c.provider,c.recurring_next_refresh_at,
      row_number() over(partition by c.workspace_id order by c.recurring_next_refresh_at,c.provider,c.id) tenant_ordinal
    from private.import_refresh_connections c where c.recurring_enabled and c.status='connected'
      and c.workspace_id=any(p_allowed_workspaces) and c.provider=any(p_allowed_providers)
      and c.recurring_next_refresh_at<=clock_timestamp() and c.refresh_not_before<=clock_timestamp() and c.sync_lease_id is null
      and private.workspace_billing_entitled_v1(c.workspace_id)
      and exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id
        where m.workspace_id=c.workspace_id and m.user_id=c.recurring_authorized_by and m.status='active' and m.role='owner'
          and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()))
  ) q order by q.tenant_ordinal,q.recurring_next_refresh_at,q.provider,q.id limit p_limit;
end $$;

create function public.claim_import_refresh(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_trigger text,p_actor uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare c jsonb; actor uuid; present boolean; v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_lease is null or p_trigger is null or p_trigger not in ('manual','scheduled') or
    (p_trigger='scheduled' and p_actor is not null) or (p_trigger='manual' and p_actor is null) then raise exception 'invalid_import_claim'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:'||p_workspace::text,0));
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection,true);
  if c is null or c->>'status'<>'connected' or (c->>'refresh_not_before')::timestamptz>clock_timestamp()
    or (c->>'sync_lease_expires_at')::timestamptz>clock_timestamp()
    or (c->>'sync_lease_kind'='scheduled' and c->>'sync_lease_id' is not null) then return false; end if;
  if p_trigger='scheduled' then
    if not (c->>'recurring_enabled')::boolean or (c->>'recurring_next_refresh_at')::timestamptz>clock_timestamp() then return false; end if;
    actor:=(c->>'recurring_authorized_by')::uuid;
  else actor:=p_actor; end if;
  if not private.import_refresh_owner(p_workspace,actor) then return false; end if;
  begin perform private.require_google_sheets_eligible_v1(p_workspace);
  exception when insufficient_privilege then return false; end;
  execute format('select exists(select 1 from public.%I where workspace_id=$1 and connection_id=$2)',private.import_refresh_table(p_provider,true)) into present using p_workspace,p_connection;
  if not present then return false; end if;
  if exists(select 1 from private.integration_refresh_active_leases where workspace_id=p_workspace and lease_expires_at>clock_timestamp()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from private.integration_refresh_active_leases where lease_expires_at>v_now)>=4 then return false; end if;
  execute format('update public.%I set sync_lease_id=$3,sync_lease_expires_at=$4+interval ''65 seconds'',sync_lease_kind=$5,
    sync_lease_authorized_by=$6,recurring_last_attempt_at=case when $5=''scheduled'' then $4 else recurring_last_attempt_at end,
    refresh_not_before=case when $5=''scheduled'' then $4+interval ''1 hour'' else refresh_not_before end,updated_at=$4
    where workspace_id=$1 and id=$2',private.import_refresh_table(p_provider)) using p_workspace,p_connection,p_lease,v_now,p_trigger,actor;
  return true;
end $$;

-- The reporting-family claim behavior is unchanged except that its existing
-- locks and capacity check now include the three standalone connectors too.
create or replace function public.claim_reporting_recurring(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid)
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
  if exists(select 1 from private.integration_refresh_active_leases where workspace_id=p_workspace and lease_expires_at>clock_timestamp()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from private.integration_refresh_active_leases where lease_expires_at>v_now)>=4 then return false; end if;
  update public.reporting_connections set lease_id=p_lease,lease_expires_at=v_now+interval '65 seconds',lease_kind='scheduled',
    recurring_last_attempt_at=v_now,next_sync_at=v_now+interval '1 hour'
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

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
  if exists(select 1 from private.integration_refresh_active_leases where workspace_id=p_workspace and lease_expires_at>clock_timestamp()) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
  v_now:=clock_timestamp();
  if (select count(*) from private.integration_refresh_active_leases where lease_expires_at>v_now)>=4 then return false; end if;
  update public.reporting_connections set lease_id=p_lease,lease_expires_at=v_now+interval '65 seconds',lease_kind='manual',next_sync_at=v_now+interval '1 hour'
    where workspace_id=p_workspace and provider=p_provider and id=p_connection;
  return true;
end $$;

create function public.fail_import_refresh(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_error text,p_retry_seconds integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare c jsonb; failures integer; retry_seconds integer; v_now timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_error is null or p_error not in ('sync_failed','authorization_required','quota_exceeded','snapshot_too_large')
    or p_retry_seconds is null or p_retry_seconds not between 0 and 86400 then raise exception 'invalid_import_failure'; end if;
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection,true);
  if c is null or c->>'status'<>'connected' or (c->>'sync_lease_id')::uuid is distinct from p_lease or p_lease is null then return false; end if;
  failures:=least((c->>'recurring_failure_count')::integer+case when c->>'sync_lease_kind'='scheduled' then 1 else 0 end,30);
  retry_seconds:=greatest(p_retry_seconds,case when c->>'sync_lease_kind'='scheduled' then least(86400,(3600*power(2,least(greatest(failures-1,0),5)))::integer) else 3600 end);
  execute format('update public.%I set last_error_code=$3,
    recurring_last_failure_at=case when sync_lease_kind=''scheduled'' then $4 else recurring_last_failure_at end,
    recurring_failure_count=$5,recurring_next_refresh_at=case when recurring_enabled then $4+make_interval(secs=>$6) else null end,
    refresh_not_before=greatest(refresh_not_before,$4+make_interval(secs=>$6)),
    status=case when $3=''authorization_required'' then ''reauthorization_required'' else status end,
    sync_lease_id=null,sync_lease_expires_at=null,sync_lease_kind=null,sync_lease_authorized_by=null,updated_at=$4
    where workspace_id=$1 and id=$2',private.import_refresh_table(p_provider)) using p_workspace,p_connection,p_error,v_now,failures,retry_seconds;
  return true;
end $$;

create function public.recover_import_refreshes(p_limit integer,p_allowed_workspaces uuid[],p_allowed_providers text[])
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; c jsonb; recovered integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  perform private.validate_import_dispatch_scope(p_limit,p_allowed_workspaces,p_allowed_providers);
  for candidate in select * from private.import_refresh_connections
    where (sync_lease_kind='scheduled' or recurring_enabled) and sync_lease_expires_at<=clock_timestamp()
      and workspace_id=any(p_allowed_workspaces) and provider=any(p_allowed_providers)
    order by sync_lease_expires_at,provider,id limit p_limit loop
    -- Never queue behind an active commit. Each connection is one transaction
    -- boundary, and stale/replaced lease IDs are independently checked below.
    execute format('select to_jsonb(c) from public.%I c where workspace_id=$1 and id=$2 for update skip locked',private.import_refresh_table(candidate.provider)) into c using candidate.workspace_id,candidate.id;
    if c is null or (c->>'sync_lease_expires_at')::timestamptz>clock_timestamp()
      or (c->>'sync_lease_id')::uuid is distinct from candidate.sync_lease_id then continue; end if;
    if public.fail_import_refresh(candidate.workspace_id,candidate.provider,candidate.id,candidate.sync_lease_id,'sync_failed',0) then recovered:=recovered+1; end if;
  end loop;
  return recovered;
end $$;

create function public.save_import_refresh_token(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_ciphertext text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare c jsonb; applied integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_provider not in ('loyverse','zoho-books') or p_provider is null or p_ciphertext is null
    or char_length(p_ciphertext) not between 32 and 32768 or p_expires_at is null or not isfinite(p_expires_at)
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days' then raise exception 'invalid_import_token'; end if;
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection,true);
  if c is null or c->>'status'<>'connected' or p_lease is null or (c->>'sync_lease_id')::uuid is distinct from p_lease
    or (c->>'sync_lease_expires_at')::timestamptz<=clock_timestamp() or not private.import_refresh_authority(c) then return false; end if;
  execute format('update public.%I set token_ciphertext=$3,access_expires_at=$4,updated_at=clock_timestamp()
    where workspace_id=$1 and connection_id=$2',private.import_refresh_table(p_provider,true)) using p_workspace,p_connection,p_ciphertext,p_expires_at;
  get diagnostics applied=row_count;
  return applied=1;
end $$;

-- Existing complete-window validators and atomic replacement stay intact.
alter function public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) rename to apply_loyverse_receipts_before_recurring;
alter function public.apply_loyverse_receipts_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) set schema private;
alter function public.apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb) rename to apply_zoho_books_history_before_recurring;
alter function public.apply_zoho_books_history_before_recurring(uuid,uuid,uuid,date,date,timestamptz,jsonb) set schema private;
alter function public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) rename to apply_wix_order_snapshot_before_recurring;
alter function public.apply_wix_order_snapshot_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) set schema private;
revoke all on function private.apply_loyverse_receipts_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb),
  private.apply_zoho_books_history_before_recurring(uuid,uuid,uuid,date,date,timestamptz,jsonb),
  private.apply_wix_order_snapshot_before_recurring(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role;

create function private.check_import_refresh_commit(p_workspace uuid,p_provider text,p_connection uuid,p_lease uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; cutoff timestamptz;
begin
  c:=private.read_import_refresh_connection(p_workspace,p_provider,p_connection,true);
  if c is null or c->>'status'<>'connected' or p_lease is null or (c->>'sync_lease_id')::uuid is distinct from p_lease
    or (c->>'sync_lease_expires_at')::timestamptz<=clock_timestamp() then raise exception 'import_sync_lease_invalid' using errcode='42501'; end if;
  -- Old application versions create manual leases without kind/actor. Preserve
  -- their existing authenticated-route validation during migration-first rollout;
  -- this compatibility path is not a time-limited admission rule. New application
  -- manual and scheduled claims always store and independently recheck their actor.
  if c->>'sync_lease_kind' is not null and not private.import_refresh_authority(c) then raise exception 'import_authority_expired' using errcode='42501'; end if;
  if c->>'sync_lease_kind'='scheduled' then
    cutoff:=date_trunc('day',(c->>'recurring_last_attempt_at')::timestamptz at time zone 'UTC') at time zone 'UTC';
    if p_start is distinct from cutoff-interval '7 days' or p_end is distinct from cutoff then raise exception 'invalid_scheduled_import_period'; end if;
  end if;
  return c;
end $$;
revoke all on function private.check_import_refresh_commit(uuid,text,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.finish_import_refresh_success(p_workspace uuid,p_provider text,p_connection uuid,p_scheduled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  execute format('update public.%I set sync_lease_kind=null,sync_lease_authorized_by=null,
    recurring_next_refresh_at=case when $3 and recurring_enabled then clock_timestamp()+interval ''24 hours'' else recurring_next_refresh_at end,
    recurring_failure_count=case when $3 then 0 else recurring_failure_count end,
    recurring_last_failure_at=case when $3 then null else recurring_last_failure_at end
    where workspace_id=$1 and id=$2',private.import_refresh_table(p_provider)) using p_workspace,p_connection,p_scheduled;
end $$;
revoke all on function private.finish_import_refresh_success(uuid,text,uuid,boolean) from public,anon,authenticated,service_role;

create function public.apply_loyverse_receipts(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_window_start timestamptz,p_window_end timestamptz,p_receipts jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare c jsonb; applied integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'loyverse_service_role_required' using errcode='42501'; end if;
  c:=private.check_import_refresh_commit(p_workspace_id,'loyverse',p_connection_id,p_lease_id,p_window_start,p_window_end);
  applied:=private.apply_loyverse_receipts_before_recurring(p_workspace_id,p_connection_id,p_lease_id,p_window_start,p_window_end,p_receipts);
  perform private.finish_import_refresh_success(p_workspace_id,'loyverse',p_connection_id,c->>'sync_lease_kind'='scheduled');
  return applied;
end $$;

create function public.apply_zoho_books_history(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_start_date date,p_end_date date,p_observed_through timestamptz,p_facts jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare c jsonb; applied integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'zoho_books_service_role_required' using errcode='42501'; end if;
  c:=private.check_import_refresh_commit(p_workspace_id,'zoho-books',p_connection_id,p_lease_id,
    p_start_date::timestamp at time zone 'UTC',p_observed_through);
  if c->>'sync_lease_kind'='scheduled' and p_end_date is distinct from ((p_observed_through at time zone 'UTC')::date-1)
    then raise exception 'invalid_scheduled_import_period'; end if;
  applied:=private.apply_zoho_books_history_before_recurring(p_workspace_id,p_connection_id,p_lease_id,p_start_date,p_end_date,p_observed_through,p_facts);
  perform private.finish_import_refresh_success(p_workspace_id,'zoho-books',p_connection_id,c->>'sync_lease_kind'='scheduled');
  return applied;
end $$;

create function public.apply_wix_order_snapshot(p_workspace_id uuid,p_connection_id uuid,p_lease_id uuid,
  p_window_start timestamptz,p_window_end timestamptz,p_orders jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare c jsonb; applied integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'wix_service_role_required' using errcode='42501'; end if;
  c:=private.check_import_refresh_commit(p_workspace_id,'wix-orders',p_connection_id,p_lease_id,p_window_start,p_window_end);
  applied:=private.apply_wix_order_snapshot_before_recurring(p_workspace_id,p_connection_id,p_lease_id,p_window_start,p_window_end,p_orders);
  perform private.finish_import_refresh_success(p_workspace_id,'wix-orders',p_connection_id,c->>'sync_lease_kind'='scheduled');
  return applied;
end $$;

revoke all on function public.set_import_recurring(uuid,text,uuid,uuid,boolean),public.import_recurring_status(uuid,text,uuid),
  public.claim_reporting_recurring(uuid,text,uuid,uuid),public.claim_reporting_sync(uuid,text,uuid,uuid),
  public.list_due_import_refreshes(integer,uuid[],text[]),public.claim_import_refresh(uuid,text,uuid,uuid,text,uuid),
  public.fail_import_refresh(uuid,text,uuid,uuid,text,integer),public.recover_import_refreshes(integer,uuid[],text[]),
  public.save_import_refresh_token(uuid,text,uuid,uuid,text,timestamptz),
  public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb),
  public.apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb),
  public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.set_import_recurring(uuid,text,uuid,uuid,boolean),public.import_recurring_status(uuid,text,uuid),
  public.claim_reporting_recurring(uuid,text,uuid,uuid),public.claim_reporting_sync(uuid,text,uuid,uuid),
  public.list_due_import_refreshes(integer,uuid[],text[]),public.claim_import_refresh(uuid,text,uuid,uuid,text,uuid),
  public.fail_import_refresh(uuid,text,uuid,uuid,text,integer),public.recover_import_refreshes(integer,uuid[],text[]),
  public.save_import_refresh_token(uuid,text,uuid,uuid,text,timestamptz),
  public.apply_loyverse_receipts(uuid,uuid,uuid,timestamptz,timestamptz,jsonb),
  public.apply_zoho_books_history(uuid,uuid,uuid,date,date,timestamptz,jsonb),
  public.apply_wix_order_snapshot(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;
commit;
