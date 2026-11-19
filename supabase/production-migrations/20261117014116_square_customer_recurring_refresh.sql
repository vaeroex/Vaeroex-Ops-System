-- Incremental direct-backend candidate, never a replay of the historical
-- 105/106 ledger bootstrap. No configuration switch or existing consent is set.
begin;
do $preflight$
declare expected record; actual text; session_constraint text;
begin
  if current_user<>'postgres' or session_user<>'postgres' or current_setting('server_version_num')::integer not between 170000 and 179999
    or to_regclass('square_customer_private.connections') is null
    or to_regclass('private.integration_refresh_active_leases') is null
    or to_regprocedure('public.claim_import_refresh(uuid,text,uuid,uuid,text,uuid)') is null then
    raise exception 'square_recurring_prerequisite_missing' using errcode='55000'; end if;
  for expected in select * from (values
    ('public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','9351187f0ccbda25958291916f8454f050bf1331812322596729dcde45453c89'),
    ('private.square_production_customer_require_owner_v1(uuid,uuid,uuid,uuid)','2ba80ae928f53b4fd3bcae0a5c18742b25cab54d4c4e477c3b35a9a0f0fd22e9'),
    ('private.square_production_customer_require_eligible_v1(uuid)','40abcf74f3389e035c308a5bc9af54d686b9dd62a01d3ab9605d7c3bd934c00d')
  ) e(signature,digest) loop
    select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(expected.signature)),'UTF8')),'hex') into actual;
    if actual is distinct from expected.digest then raise exception 'square_recurring_contract_drift' using errcode='55000'; end if;
    if has_function_privilege('anon',expected.signature,'execute') or has_function_privilege('authenticated',expected.signature,'execute')
      or (expected.signature like 'private.%' and has_function_privilege('service_role',expected.signature,'execute')) then
      raise exception 'square_recurring_acl_drift' using errcode='55000'; end if;
  end loop;
  if not has_function_privilege('service_role','public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)','execute')
    or has_schema_privilege('service_role','square_customer_private','usage')
    or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='square_customer_private' and c.relname in ('configuration','connections','oauth_states','payments')
        and (not c.relrowsecurity or not c.relforcerowsecurity or c.relowner<>'postgres'::regrole)) then
    raise exception 'square_recurring_acl_drift' using errcode='55000'; end if;
  select conname into session_constraint from pg_constraint where conrelid='square_customer_private.connections'::regclass
    and pg_get_constraintdef(oid)='CHECK (((lease_id IS NULL) = (lease_session_id IS NULL)))';
  if session_constraint is null then raise exception 'square_recurring_lease_shape_drift' using errcode='55000'; end if;
  execute format('alter table square_customer_private.connections drop constraint %I',session_constraint);
end $preflight$;

alter table square_customer_private.connections
  add column recurring_enabled boolean not null default false,
  add column recurring_authorized_by uuid references public.profiles(id),
  add column recurring_authorized_at timestamptz,
  add column recurring_next_refresh_at timestamptz,
  add column recurring_last_attempt_at timestamptz,
  add column recurring_failure_count integer not null default 0 check(recurring_failure_count between 0 and 30),
  add column recurring_last_failure_at timestamptz,
  add column recurring_last_error_code text check(recurring_last_error_code in ('retry_required','reauthorization_required')),
  add column refresh_not_before timestamptz not null default clock_timestamp(),
  add column lease_kind text not null default 'manual' check(lease_kind in ('manual','scheduled')),
  add constraint square_recurring_consent check(not recurring_enabled or (recurring_authorized_by is not null and recurring_authorized_at is not null and recurring_next_refresh_at is not null)),
  add constraint square_recurring_lease_session check(
    (lease_id is null and lease_session_id is null) or
    (lease_id is not null and ((lease_kind='manual' and lease_session_id is not null) or (lease_kind='scheduled' and lease_session_id is null))));
create index square_recurring_due on square_customer_private.connections(recurring_next_refresh_at,workspace_id,connection_id) where recurring_enabled;
create index square_recurring_leases on square_customer_private.connections(lease_expires_at,workspace_id) where lease_id is not null;

create or replace view private.integration_refresh_active_leases as
  select id,workspace_id,lease_expires_at from public.reporting_connections where lease_id is not null
  union all select id,workspace_id,sync_lease_expires_at from private.import_refresh_connections where sync_lease_id is not null
  union all select connection_id,workspace_id,lease_expires_at from square_customer_private.connections where lease_id is not null;
revoke all on private.integration_refresh_active_leases from public,anon,authenticated,service_role;

create function square_customer_private.recurring_lifecycle_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Existing interactive operations continue to write their real session.
  if new.lease_session_id is not null then new.lease_kind:='manual'; end if;
  if new.state in ('disconnected','reauthorization_required','consent_pending','exchanging','mapping_required')
    or new.workspace_id is distinct from old.workspace_id or new.connection_id is distinct from old.connection_id
    or new.generation is distinct from old.generation or new.business_entity_id is distinct from old.business_entity_id
    or new.application_id is distinct from old.application_id or new.merchant_id is distinct from old.merchant_id
    or new.location_id is distinct from old.location_id then
    new.recurring_enabled:=false; new.recurring_next_refresh_at:=null;
    if new.lease_kind='scheduled' then
      new.lease_id:=null;new.lease_expires_at:=null;new.lease_actor_id:=null;new.lease_session_id:=null;new.lease_authorized:=false;
    end if;
  end if;
  return new;
end $$;
revoke all on function square_customer_private.recurring_lifecycle_v1() from public,anon,authenticated,service_role;
create trigger square_recurring_lifecycle before update on square_customer_private.connections for each row execute function square_customer_private.recurring_lifecycle_v1();

create function square_customer_private.require_recurring_owner_v1(p_actor uuid,p_workspace uuid,p_entity uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.workspaces where id=p_workspace for share;
  if not found then raise exception 'square_recurring_owner_denied' using errcode='42501'; end if;
  perform 1 from public.workspace_members m join auth.users u on u.id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=p_actor and m.role='owner' and m.status='active'
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
  if not found then raise exception 'square_recurring_owner_denied' using errcode='42501'; end if;
  perform 1 from public.business_entities where workspace_id=p_workspace and id=p_entity and status='active' for share;
  if not found then raise exception 'square_recurring_entity_denied' using errcode='42501'; end if;
end $$;
revoke all on function square_customer_private.require_recurring_owner_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function square_customer_private.recurring_status_v1(c square_customer_private.connections,p_application_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reason text:='active';
begin
  if c.state not in ('connected','retry_required','syncing') or c.revocation_pending or c.authorization_uncertain or c.ciphertext is null or c.location_id is null
    or not exists(select 1 from public.business_entities where workspace_id=c.workspace_id and id=c.business_entity_id and status='active') then reason:='connection_unavailable';
  elsif not c.recurring_enabled then reason:='disabled';
  elsif not exists(select 1 from square_customer_private.configuration where singleton and enabled and application_id=p_application_id)
    or c.application_id is distinct from p_application_id then reason:='configuration_unavailable';
  elsif c.window_start is not null and c.read_kind='created' then reason:='manual_read_in_progress';
  else
    begin perform square_customer_private.require_recurring_owner_v1(c.recurring_authorized_by,c.workspace_id,c.business_entity_id);
    exception when insufficient_privilege then reason:='owner_unavailable'; end;
    if reason='active' then
      begin perform private.square_production_customer_require_eligible_v1(c.workspace_id);
      exception when insufficient_privilege then reason:='entitlement_unavailable'; end;
    end if;
  end if;
  return jsonb_build_object('recurring_enabled',c.recurring_enabled,'recurring_next_refresh_at',c.recurring_next_refresh_at,
    'recurring_last_attempt_at',c.recurring_last_attempt_at,'recurring_failure_count',c.recurring_failure_count,
    'recurring_last_failure_at',c.recurring_last_failure_at,'recurring_last_error_code',c.recurring_last_error_code,
    'authorized',reason='active','reason',reason,'last_successful_refresh_at',c.last_synced_at,
    'has_more',c.cursor is not null,'manual_read_in_progress',c.window_start is not null and c.read_kind='created');
end $$;
revoke all on function square_customer_private.recurring_status_v1(square_customer_private.connections,text) from public,anon,authenticated,service_role;

create function public.square_customer_recurring_status_v1(p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_application_id text,p_connection_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id);
  select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=p_connection_id;
  if not found or c.application_id is distinct from p_application_id then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  return square_customer_private.recurring_status_v1(c,p_application_id);
end $$;

create function public.square_customer_set_recurring_v1(p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_application_id text,p_connection_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections;
begin
  if auth.role() is distinct from 'service_role' or p_enabled is null then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id);
  select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=p_connection_id for update;
  if not found or c.application_id is distinct from p_application_id then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  if p_enabled then
    perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
    perform private.square_production_customer_require_eligible_v1(p_workspace_id);
    if c.state not in ('connected','retry_required','syncing') or c.ciphertext is null or c.location_id is null or c.revocation_pending or c.authorization_uncertain
      or not exists(select 1 from square_customer_private.configuration where singleton and enabled and application_id=p_application_id) then
      raise exception 'square_recurring_connection_denied' using errcode='42501'; end if;
  end if;
  if c.recurring_enabled=p_enabled and (not p_enabled or c.recurring_authorized_by=p_actor_id) then return square_customer_private.recurring_status_v1(c,p_application_id); end if;
  update square_customer_private.connections set recurring_enabled=p_enabled,
    recurring_authorized_by=case when p_enabled then p_actor_id else recurring_authorized_by end,
    recurring_authorized_at=case when p_enabled then clock_timestamp() else recurring_authorized_at end,
    recurring_next_refresh_at=case when p_enabled then greatest(clock_timestamp(),refresh_not_before) else null end,
    state=case when lease_kind='scheduled' and state='syncing' then 'retry_required' else state end,
    lease_id=case when lease_kind='scheduled' then null else lease_id end,
    lease_expires_at=case when lease_kind='scheduled' then null else lease_expires_at end,
    lease_actor_id=case when lease_kind='scheduled' then null else lease_actor_id end,
    lease_session_id=case when lease_kind='scheduled' then null else lease_session_id end,
    lease_authorized=case when lease_kind='scheduled' then false else lease_authorized end,updated_at=clock_timestamp()
    where workspace_id=p_workspace_id and connection_id=p_connection_id returning * into c;
  return square_customer_private.recurring_status_v1(c,p_application_id);
end $$;

-- Shared atomic read core: the refresh CAS and page validation/upsert/checkpoint
-- body below is copied byte-for-byte from the qualified history backend, apart
-- from the leading IF. Both manual and scheduled entry points call this core
-- only after independently validating their own current authority and lease.
create function square_customer_private.commit_read_v1(p_operation text,p_workspace_id uuid,p_payload jsonb,c square_customer_private.connections)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare cid uuid:=c.connection_id; t timestamptz:=clock_timestamp(); item jsonb; access_expiry timestamptz;
declare created_time timestamptz; updated_time timestamptz; incoming_cursor text;
begin
  if not c.lease_authorized or c.lease_id is null or c.lease_expires_at<=t then raise exception 'square_customer_backend_dispatch_denied' using errcode='42501'; end if;
  if p_operation='commit_refresh' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['connectionId','leaseId','credentialVersion','ciphertext','accessExpiresAt']);
    if jsonb_typeof(p_payload->'ciphertext') is distinct from 'string'
      or length(p_payload->>'ciphertext') not between 32 and 131072
      or jsonb_typeof(p_payload->'accessExpiresAt') is distinct from 'string' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    access_expiry:=(p_payload->>'accessExpiresAt')::timestamptz;
    if not isfinite(access_expiry) or access_expiry<=t or access_expiry>t+interval '2 days' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
  elsif p_operation='commit_page' then
    perform private.square_production_customer_require_keys_v1(p_payload,array['connectionId','leaseId','payments','cursor','cursorBindingFingerprint','cursorFingerprint']);
  else raise exception 'square_customer_backend_denied' using errcode='42501'; end if;
  if p_operation='commit_refresh' then
    if c.state<>'syncing' or c.ciphertext is null or jsonb_typeof(p_payload->'credentialVersion') is distinct from 'number'
      or (p_payload->>'credentialVersion')::bigint<>c.credential_version+1 then
      raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    update square_customer_private.connections set credential_version=credential_version+1,ciphertext=p_payload->>'ciphertext',
      access_expires_at=access_expiry,updated_at=t where connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  elsif p_operation='commit_page' then
    if c.state<>'syncing' or c.ciphertext is null or c.location_id is null or
      jsonb_typeof(p_payload->'payments') is distinct from 'array' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'payments')>100 then raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    incoming_cursor:=p_payload->>'cursor';
    if incoming_cursor is not null then
      if jsonb_typeof(p_payload->'cursor')<>'string' or length(incoming_cursor) not between 1 and 8192
        or coalesce(p_payload->>'cursorBindingFingerprint','') !~ '^sha256:[a-f0-9]{64}$'
        or coalesce(p_payload->>'cursorFingerprint','') !~ '^sha256:[a-f0-9]{64}$'
        or (c.cursor_binding_fingerprint is not null and c.cursor_binding_fingerprint<>p_payload->>'cursorBindingFingerprint')
        or c.cursor is not distinct from incoming_cursor then
        raise exception 'square_customer_backend_cursor_denied' using errcode='22023'; end if;
    elsif p_payload->'cursor' is distinct from 'null'::jsonb or p_payload->'cursorBindingFingerprint' is distinct from 'null'::jsonb
      or p_payload->'cursorFingerprint' is distinct from 'null'::jsonb then
      raise exception 'square_customer_backend_cursor_denied' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'payments') loop
      perform private.square_production_customer_require_keys_v1(item,array['id','locationId','status','createdAt','updatedAt','amountMinor','currency']);
      if coalesce(item->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$' or item->>'locationId' is distinct from c.location_id
        or coalesce(item->>'status','') not in ('APPROVED','PENDING','COMPLETED','CANCELED','FAILED','UNKNOWN')
        or jsonb_typeof(item->'createdAt') is distinct from 'string' or jsonb_typeof(item->'updatedAt') is distinct from 'string'
        or not ((item->'amountMinor'='null'::jsonb and item->'currency'='null'::jsonb)
          or (jsonb_typeof(item->'amountMinor')='string' and coalesce(item->>'amountMinor','') ~ '^-?(0|[1-9][0-9]{0,15})$'
            and coalesce(item->>'currency','') ~ '^[A-Z]{3}$')) then
        raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
      created_time:=(item->>'createdAt')::timestamptz; updated_time:=(item->>'updatedAt')::timestamptz;
      if not isfinite(created_time) or not isfinite(updated_time) or updated_time<created_time
        or c.window_start is null or c.window_end is null
        or (c.read_kind='updated' and (updated_time<c.window_start or updated_time>c.window_end+interval '1 minute'))
        or (c.read_kind='created' and (created_time<c.window_start or created_time>=c.window_end)) then
        raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
      insert into square_customer_private.payments(workspace_id,connection_id,payment_id,location_id,status,created_at,updated_at,amount_minor,currency)
        values(p_workspace_id,cid,item->>'id',c.location_id,item->>'status',created_time,updated_time,(item->>'amountMinor')::bigint,item->>'currency')
        on conflict(connection_id,payment_id) do update set status=excluded.status,updated_at=excluded.updated_at,
          amount_minor=excluded.amount_minor,currency=excluded.currency
          where excluded.updated_at>=square_customer_private.payments.updated_at;
    end loop;
    update square_customer_private.connections set state='connected',cursor=incoming_cursor,
      cursor_binding_fingerprint=p_payload->>'cursorBindingFingerprint',cursor_fingerprint=p_payload->>'cursorFingerprint',
      -- Historical coverage is recorded separately from the ongoing update checkpoint.
      checkpoint_at=case when incoming_cursor is null and read_kind='updated' then window_end else checkpoint_at end,
      last_synced_at=case when incoming_cursor is null and read_kind='updated' then t else last_synced_at end,
      last_read_start=case when incoming_cursor is null then window_start else last_read_start end,
      last_read_end=case when incoming_cursor is null then window_end else last_read_end end,
      last_read_kind=case when incoming_cursor is null then read_kind else last_read_kind end,
      last_read_completed_at=case when incoming_cursor is null then t else last_read_completed_at end,
      window_start=case when incoming_cursor is null then null else window_start end,
      window_end=case when incoming_cursor is null then null else window_end end,
      lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,last_error=null,updated_at=t
      where connection_id=cid;
    return jsonb_build_object('stored',true,'hasMore',incoming_cursor is not null);
  end if;
  raise exception 'square_customer_backend_denied' using errcode='42501';
end $function$;
revoke all on function square_customer_private.commit_read_v1(text,uuid,jsonb,square_customer_private.connections) from public,anon,authenticated,service_role;

alter function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb) rename to backend_before_recurring_v1;
alter function public.backend_before_recurring_v1(text,uuid,uuid,uuid,text,jsonb) set schema square_customer_private;
revoke all on function square_customer_private.backend_before_recurring_v1(text,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,
    square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority;

create function public.square_customer_backend_v1(p_operation text,p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_application_id text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c square_customer_private.connections; result jsonb; payload jsonb:=p_payload; retry_seconds integer:=0;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null or p_session_id is null or p_workspace_id is null
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>524288 then
    raise exception 'square_customer_backend_denied' using errcode='42501'; end if;
  if p_operation in ('commit_refresh','commit_page') then
    -- Original owner/session, billing, config, entity, lease and expiry checks
    -- remain authoritative. No sessionless call can reach the manual core.
    perform square_customer_private.backend_before_recurring_v1('reconcile',p_actor_id,p_session_id,p_workspace_id,p_application_id,
      jsonb_build_object('connectionId',p_payload->'connectionId','leaseId',p_payload->'leaseId'));
    select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=(p_payload->>'connectionId')::uuid for update;
    return square_customer_private.commit_read_v1(p_operation,p_workspace_id,p_payload,c);
  elsif p_operation in ('claim','claim_history') then
    perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id);
    perform pg_advisory_xact_lock(hashtextextended('reporting:'||p_workspace_id::text,0));
    select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=(p_payload->>'connectionId')::uuid for update;
    if found and (c.refresh_not_before>clock_timestamp() or exists(select 1 from private.integration_refresh_active_leases
      where workspace_id=p_workspace_id and lease_expires_at>clock_timestamp())) then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
    if (select count(*) from private.integration_refresh_active_leases where lease_expires_at>clock_timestamp())>=4 then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
  elsif p_operation='fail' and p_payload ? 'retryAfterSeconds' then
    if jsonb_typeof(p_payload->'retryAfterSeconds') is distinct from 'number'
      or (p_payload->>'retryAfterSeconds')::numeric<>trunc((p_payload->>'retryAfterSeconds')::numeric)
      or (p_payload->>'retryAfterSeconds')::numeric not between 0 and 86400 then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    retry_seconds:=(p_payload->>'retryAfterSeconds')::integer;
    payload:=p_payload-'retryAfterSeconds';
  end if;
  result:=square_customer_private.backend_before_recurring_v1(p_operation,p_actor_id,p_session_id,p_workspace_id,p_application_id,payload);
  if p_operation='fail' and retry_seconds>0 then
    update square_customer_private.connections set refresh_not_before=greatest(refresh_not_before,clock_timestamp()+make_interval(secs=>retry_seconds))
      where workspace_id=p_workspace_id and connection_id=(p_payload->>'connectionId')::uuid;
  end if;
  return result;
end $$;

create function square_customer_private.record_recurring_failure_v1(p_workspace uuid,p_connection uuid,p_lease uuid,p_reason text,p_retry_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections; failures integer; seconds integer; t timestamptz:=clock_timestamp();
begin
  if p_reason is null or p_reason not in ('retry_required','reauthorization_required') or p_retry_seconds is null or p_retry_seconds not between 0 and 86400 then
    raise exception 'square_recurring_payload_denied' using errcode='22023'; end if;
  select * into c from square_customer_private.connections where workspace_id=p_workspace and connection_id=p_connection
    and lease_id=p_lease and lease_kind='scheduled' and state='syncing' for update;
  if not found then return false; end if;
  failures:=least(c.recurring_failure_count+1,30);
  seconds:=greatest(p_retry_seconds,least(86400,(3600*power(2,least(failures-1,5)))::integer));
  update square_customer_private.connections set state=p_reason,last_error=p_reason,recurring_last_error_code=p_reason,
    recurring_failure_count=failures,recurring_last_failure_at=t,recurring_next_refresh_at=case when recurring_enabled then t+make_interval(secs=>seconds) else null end,
    refresh_not_before=greatest(refresh_not_before,t+make_interval(secs=>seconds)),
    lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,updated_at=t
    where workspace_id=p_workspace and connection_id=p_connection;
  return true;
end $$;
revoke all on function square_customer_private.record_recurring_failure_v1(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;

create function public.square_customer_recurring_v1(p_operation text,p_workspace_id uuid,p_application_id text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections; cid uuid; lid uuid; t timestamptz; result jsonb; keys text[]; retry_seconds integer;
begin
  if auth.role() is distinct from 'service_role' or p_workspace_id is null or p_application_id is null
    or p_operation is null or p_operation not in ('claim','authorize','reconcile','commit_refresh','commit_page','fail')
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>524288 then
    raise exception 'square_recurring_denied' using errcode='42501'; end if;
  keys:=case p_operation
    when 'commit_refresh' then array['connectionId','leaseId','credentialVersion','ciphertext','accessExpiresAt']
    when 'commit_page' then array['connectionId','leaseId','payments','cursor','cursorBindingFingerprint','cursorFingerprint']
    when 'fail' then array['connectionId','leaseId','reason','retryAfterSeconds']
    else array['connectionId','leaseId'] end;
  perform private.square_production_customer_require_keys_v1(p_payload,keys);
  if jsonb_typeof(p_payload->'connectionId') is distinct from 'string' or jsonb_typeof(p_payload->'leaseId') is distinct from 'string' then
    raise exception 'square_recurring_payload_denied' using errcode='22023'; end if;
  cid:=(p_payload->>'connectionId')::uuid;lid:=(p_payload->>'leaseId')::uuid;
  -- Match the existing lock order: current owner/entity/workspace and billing
  -- before config and connection. Recheck the locked consent identity below.
  select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=cid;
  if not found or c.application_id is distinct from p_application_id then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  if p_operation='fail' then
    -- Terminal cleanup performs no provider access and must also work after
    -- authority expires. The exact stored scheduled lease fences its effects.
    if jsonb_typeof(p_payload->'retryAfterSeconds') is distinct from 'number'
      or (p_payload->>'retryAfterSeconds')::numeric<>trunc((p_payload->>'retryAfterSeconds')::numeric)
      or (p_payload->>'retryAfterSeconds')::numeric not between 0 and 86400 then
      raise exception 'square_recurring_payload_denied' using errcode='22023'; end if;
    retry_seconds:=(p_payload->>'retryAfterSeconds')::integer;
    return jsonb_build_object('recorded',square_customer_private.record_recurring_failure_v1(p_workspace_id,cid,lid,p_payload->>'reason',retry_seconds));
  end if;
  if not c.recurring_enabled then raise exception 'square_recurring_consent_required' using errcode='42501'; end if;
  perform square_customer_private.require_recurring_owner_v1(c.recurring_authorized_by,p_workspace_id,c.business_entity_id);
  perform private.square_production_customer_require_eligible_v1(p_workspace_id);
  perform 1 from square_customer_private.configuration where singleton and enabled and application_id=p_application_id for share;
  if not found then raise exception 'square_customer_backend_closed' using errcode='42501'; end if;
  if p_operation='claim' then perform pg_advisory_xact_lock(hashtextextended('reporting:'||p_workspace_id::text,0)); end if;
  -- A concurrent consent replacement/revocation must restart admission, not
  -- authorize a page under an identity checked before that change.
  perform 1 from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=cid
    and recurring_enabled and recurring_authorized_by=c.recurring_authorized_by and business_entity_id=c.business_entity_id
    and application_id=p_application_id for update;
  if not found then raise exception 'square_recurring_consent_required' using errcode='42501'; end if;
  select * into c from square_customer_private.connections where workspace_id=p_workspace_id and connection_id=cid;
  t:=clock_timestamp();
  if c.state not in ('connected','retry_required','syncing') or c.ciphertext is null or c.location_id is null or c.revocation_pending or c.authorization_uncertain
    or (c.window_start is not null and c.read_kind='created') then raise exception 'square_recurring_read_denied' using errcode='42501'; end if;
  if p_operation='claim' then
    if c.recurring_next_refresh_at>t or c.refresh_not_before>t or c.lease_id is not null then raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    if exists(select 1 from private.integration_refresh_active_leases where workspace_id=p_workspace_id and lease_expires_at>t) then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    perform pg_advisory_xact_lock(hashtextextended('reporting:aggregate_admission',0));
    if (select count(*) from private.integration_refresh_active_leases where lease_expires_at>clock_timestamp())>=4 then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    update square_customer_private.connections set state='syncing',lease_id=lid,lease_expires_at=t+interval '120 seconds',
      lease_actor_id=recurring_authorized_by,lease_session_id=null,lease_kind='scheduled',lease_authorized=false,
      recurring_last_attempt_at=t,read_kind='updated',
      window_start=coalesce(window_start,checkpoint_at-interval '5 minutes',t-interval '30 days'),
      window_end=coalesce(window_end,least(t,coalesce(checkpoint_at-interval '5 minutes',t-interval '30 days')+interval '31 days')),
      updated_at=t where workspace_id=p_workspace_id and connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  end if;
  if c.lease_id is distinct from lid or c.lease_expires_at is null or c.lease_expires_at<=t or c.lease_kind<>'scheduled'
    or c.lease_actor_id is distinct from c.recurring_authorized_by or c.lease_session_id is not null or c.state<>'syncing' then
    raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
  if p_operation='reconcile' then return square_customer_private.context_v1(c);
  elsif p_operation='authorize' then
    update square_customer_private.connections set lease_authorized=true where workspace_id=p_workspace_id and connection_id=cid;
    return jsonb_build_object('authorized',true);
  end if;
  result:=square_customer_private.commit_read_v1(p_operation,p_workspace_id,p_payload,c);
  if p_operation='commit_page' then
    update square_customer_private.connections set recurring_next_refresh_at=case when (result->>'hasMore')::boolean then t else t+interval '1 hour' end,
      recurring_failure_count=case when (result->>'hasMore')::boolean then recurring_failure_count else 0 end,
      recurring_last_failure_at=case when (result->>'hasMore')::boolean then recurring_last_failure_at else null end,
      recurring_last_error_code=case when (result->>'hasMore')::boolean then recurring_last_error_code else null end
      where workspace_id=p_workspace_id and connection_id=cid;
  end if;
  return result;
end $$;

create function square_customer_private.validate_recurring_scope_v1(p_limit integer,p_allowed_workspaces uuid[],p_application_id text)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_allowed_workspaces is null or cardinality(p_allowed_workspaces) not between 1 and 100
    or array_position(p_allowed_workspaces,null) is not null or p_application_id is null or p_application_id!~'^sq0idp-[A-Za-z0-9_-]{1,184}$' then
    raise exception 'square_recurring_scope_denied' using errcode='22023'; end if;
end $$;
revoke all on function square_customer_private.validate_recurring_scope_v1(integer,uuid[],text) from public,anon,authenticated,service_role;

create function public.square_customer_due_recurring_v1(p_limit integer,p_allowed_workspaces uuid[],p_application_id text)
returns table(connection_id uuid,workspace_id uuid) language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections; result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  perform square_customer_private.validate_recurring_scope_v1(p_limit,p_allowed_workspaces,p_application_id);
  if p_limit>20 then raise exception 'square_recurring_scope_denied' using errcode='22023'; end if;
  for c in select * from square_customer_private.connections x where x.workspace_id=any(p_allowed_workspaces) and x.application_id=p_application_id
    and x.recurring_enabled and x.state in ('connected','retry_required') and x.recurring_next_refresh_at<=clock_timestamp()
    and x.refresh_not_before<=clock_timestamp() and x.lease_id is null and not(x.window_start is not null and x.read_kind='created')
    and (square_customer_private.recurring_status_v1(x,p_application_id)->>'authorized')::boolean
    order by x.recurring_next_refresh_at,x.workspace_id,x.connection_id limit p_limit loop
    result:=square_customer_private.recurring_status_v1(c,p_application_id);
    if (result->>'authorized')::boolean then connection_id:=c.connection_id;workspace_id:=c.workspace_id;return next; end if;
  end loop;
end $$;

create function public.square_customer_recover_recurring_v1(p_limit integer,p_allowed_workspaces uuid[],p_application_id text)
returns integer language plpgsql security definer set search_path='' as $$
declare c square_customer_private.connections; recovered integer:=0; t timestamptz:=clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'square_recurring_denied' using errcode='42501'; end if;
  perform square_customer_private.validate_recurring_scope_v1(p_limit,p_allowed_workspaces,p_application_id);
  for c in select * from square_customer_private.connections where workspace_id=any(p_allowed_workspaces) and application_id=p_application_id
    and state='syncing' and lease_expires_at<=t and (lease_kind='scheduled' or recurring_enabled)
    order by lease_expires_at,connection_id limit p_limit for update skip locked loop
    if c.lease_kind='scheduled' then
      if square_customer_private.record_recurring_failure_v1(c.workspace_id,c.connection_id,c.lease_id,'retry_required',0) then recovered:=recovered+1; end if;
    else
      update square_customer_private.connections set state='retry_required',last_error='retry_required',refresh_not_before=greatest(refresh_not_before,t+interval '1 hour'),
        recurring_next_refresh_at=case when recurring_enabled then greatest(recurring_next_refresh_at,t+interval '1 hour') else null end,
        lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,updated_at=t
        where workspace_id=c.workspace_id and connection_id=c.connection_id;
      recovered:=recovered+1;
    end if;
  end loop;
  return recovered;
end $$;

revoke all on function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb),
  public.square_customer_recurring_status_v1(uuid,uuid,uuid,text,uuid),public.square_customer_set_recurring_v1(uuid,uuid,uuid,text,uuid,boolean),
  public.square_customer_recurring_v1(text,uuid,text,jsonb),public.square_customer_due_recurring_v1(integer,uuid[],text),public.square_customer_recover_recurring_v1(integer,uuid[],text)
  from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,
    square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority;
grant execute on function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb),
  public.square_customer_recurring_status_v1(uuid,uuid,uuid,text,uuid),public.square_customer_set_recurring_v1(uuid,uuid,uuid,text,uuid,boolean),
  public.square_customer_recurring_v1(text,uuid,text,jsonb),public.square_customer_due_recurring_v1(integer,uuid[],text),public.square_customer_recover_recurring_v1(integer,uuid[],text) to service_role;
commit;
