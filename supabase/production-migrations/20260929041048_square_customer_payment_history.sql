-- Add bounded, customer-requested historical Payments reads to the existing connection.
-- Credentials, the selected seller/location, and ongoing update checkpoints are preserved.
begin;
do $baseline$
begin
  if current_user <> 'postgres' or session_user <> 'postgres'
    or current_setting('server_version_num')::integer not between 170000 and 179999
    or (select count(*) from supabase_migrations.schema_migrations) <> 106
    or (select max(version) from supabase_migrations.schema_migrations) <> '20260929004917'
    or (select 'sha256:'||encode(extensions.digest(convert_to(string_agg(length(version)::text||':'||version,'' order by version),'UTF8'),'sha256'),'hex')
      from supabase_migrations.schema_migrations) <> 'sha256:b9f62e2285edfd78268826120047c95fc45569041965c1abd24c199c511ff95b'
    or to_regclass('square_customer_private.connections') is null
    then raise exception 'square_customer_history_requires_106_baseline' using errcode='55000'; end if;
end $baseline$;

alter table square_customer_private.connections
  add column read_kind text not null default 'updated' check(read_kind in ('updated','created')),
  add column last_read_start timestamptz check(isfinite(last_read_start)),
  add column last_read_end timestamptz check(isfinite(last_read_end)),
  add column last_read_kind text check(last_read_kind in ('updated','created')),
  add column last_read_completed_at timestamptz check(isfinite(last_read_completed_at)),
  add constraint square_customer_last_read_complete check(
    (last_read_start is null and last_read_end is null and last_read_kind is null and last_read_completed_at is null)
    or (last_read_start is not null and last_read_end is not null and last_read_kind is not null
      and last_read_completed_at is not null and last_read_end>last_read_start));
-- Existing rows have no recorded range: do not fabricate historical coverage.

create or replace function square_customer_private.context_v1(c square_customer_private.connections)
returns jsonb language sql stable security invoker set search_path=''
as $function$
  select jsonb_build_object('connectionId',c.connection_id,'workspaceId',c.workspace_id,
    'businessEntityId',c.business_entity_id,'generation',c.generation,'credentialVersion',c.credential_version,
    'ciphertext',c.ciphertext,'merchantId',c.merchant_id,'accessExpiresAt',c.access_expires_at,
    'locationId',c.location_id,'windowStart',c.window_start,'windowEnd',c.window_end,'readKind',c.read_kind,
    'cursor',c.cursor,'cursorBindingFingerprint',c.cursor_binding_fingerprint,'cursorFingerprint',c.cursor_fingerprint,
    'leaseId',c.lease_id,'state',c.state)
$function$;
revoke all on function square_customer_private.context_v1(square_customer_private.connections) from public,anon,authenticated,service_role;

create or replace function public.square_customer_backend_v1(
  p_operation text,p_actor_id uuid,p_session_id uuid,p_workspace_id uuid,p_application_id text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare c square_customer_private.connections; s square_customer_private.oauth_states;
declare cfg square_customer_private.configuration; cid uuid; lid uuid; t timestamptz;
declare keys text[]; item jsonb; incoming jsonb; observed_count integer;
declare access_expiry timestamptz; created_time timestamptz; updated_time timestamptz; incoming_cursor text;
declare entitled boolean:=false; history_start timestamptz; history_end timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null or p_session_id is null or p_workspace_id is null
    or p_operation is null or p_operation not in ('status','begin','consume','decline','authorize','authorize_disconnect','reconcile','stage_credential','complete_connect','map','claim','claim_history','commit_refresh','commit_page','fail','disconnect','complete_disconnect')
    or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>524288 then
    raise exception 'square_customer_backend_denied' using errcode='42501';
  end if;
  -- Same lock order throughout: owner/session/workspace, entitlement, config,
  -- connection, OAuth state/payment rows. No lock spans a provider request.
  perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id);
  if p_operation not in ('status','decline','disconnect','authorize_disconnect','complete_disconnect','fail') then
    perform private.square_production_customer_require_eligible_v1(p_workspace_id);
  end if;
  select * into cfg from square_customer_private.configuration where singleton for share;
  if not found then raise exception 'square_customer_backend_closed' using errcode='42501'; end if;
  if p_operation not in ('status','decline','disconnect','authorize_disconnect','complete_disconnect','fail') and
    (not cfg.enabled or cfg.application_id is distinct from p_application_id) then
    raise exception 'square_customer_backend_closed' using errcode='42501';
  end if;
  keys:=case p_operation
    when 'status' then array[]::text[]
    when 'begin' then array['connectionId','businessEntityId','stateHash']
    when 'consume' then array['stateHash','leaseId']
    when 'stage_credential' then array['connectionId','leaseId','ciphertext','merchantId','accessExpiresAt']
    when 'complete_connect' then array['connectionId','leaseId','ciphertext','merchantId','sellerLabel','locations','accessExpiresAt']
    when 'map' then array['connectionId','locationId']
    when 'claim_history' then array['connectionId','leaseId','windowStart','windowEnd']
    when 'commit_refresh' then array['connectionId','leaseId','credentialVersion','ciphertext','accessExpiresAt']
    when 'commit_page' then array['connectionId','leaseId','payments','cursor','cursorBindingFingerprint','cursorFingerprint']
    when 'fail' then array['connectionId','leaseId','reason']
    else array['connectionId','leaseId'] end;
  perform private.square_production_customer_require_keys_v1(p_payload,keys);
  if p_operation='status' then
    -- Status and disconnect remain readable for an expired customer, but the
    -- displayed ability to connect/read must use the same paid-workspace rule.
    begin
      perform private.square_production_customer_require_eligible_v1(p_workspace_id);
      entitled:=true;
    exception when insufficient_privilege then entitled:=false;
    end;
    return jsonb_build_object('historyAvailable',true,'available',entitled and cfg.enabled and cfg.application_id is not distinct from p_application_id,
      'businessEntities',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'label',e.display_name) order by e.id),'[]'::jsonb)
        from (select id,display_name from public.business_entities where workspace_id=p_workspace_id and status='active' order by id limit 1000) e),
      'connections',(select coalesce(jsonb_agg(jsonb_build_object(
        'connectionId',r.connection_id,'businessEntityId',r.business_entity_id,
        'state',case when r.state='syncing' and r.lease_expires_at<=clock_timestamp() then 'retry_required'
          when r.state='exchanging' and r.lease_expires_at<=clock_timestamp() then 'reauthorization_required' else r.state end,'sellerLabel',r.seller_label,
        'locations',r.locations,'locationId',r.location_id,'lastSyncedAt',r.last_synced_at,'lastError',r.last_error,
        'hasMore',r.cursor is not null,'revocationPending',r.revocation_pending,
        'recoveryRequired',r.authorization_uncertain and r.ciphertext is null,
        'checkpointAt',r.checkpoint_at,
        'activeRead',case when r.window_start is null then null else jsonb_build_object(
          'start',r.window_start,'end',r.window_end,'kind',r.read_kind) end,
        'lastCompletedRead',case when r.last_read_completed_at is null then null else jsonb_build_object(
          'start',r.last_read_start,'end',r.last_read_end,'kind',r.last_read_kind,'completedAt',r.last_read_completed_at) end,
        'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.payment_id,'locationId',p.location_id,
          'status',p.status,'createdAt',p.created_at,'updatedAt',p.updated_at,'amountMinor',p.amount_minor::text,'currency',p.currency)
          order by p.updated_at desc,p.payment_id),'[]'::jsonb) from
          (select * from square_customer_private.payments where connection_id=r.connection_id and workspace_id=p_workspace_id
           order by updated_at desc,payment_id limit 100) p)
      ) order by r.created_at desc,r.connection_id),'[]'::jsonb) from
        (select * from square_customer_private.connections where workspace_id=p_workspace_id order by created_at desc,connection_id limit 32) r));
  end if;
  if p_operation='begin' then
    if jsonb_typeof(p_payload->'connectionId') is distinct from 'string' or jsonb_typeof(p_payload->'businessEntityId') is distinct from 'string'
      or coalesce(p_payload->>'stateHash','') !~ '^sha256:[a-f0-9]{64}$' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    cid:=(p_payload->>'connectionId')::uuid;
    perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id,(p_payload->>'businessEntityId')::uuid);
    insert into square_customer_private.connections(connection_id,workspace_id,business_entity_id,application_id,state)
      values(cid,p_workspace_id,(p_payload->>'businessEntityId')::uuid,p_application_id,'consent_pending') returning * into c;
    insert into square_customer_private.oauth_states(state_hash,connection_id,workspace_id,actor_id,session_id,expires_at)
      values(p_payload->>'stateHash',cid,p_workspace_id,p_actor_id,p_session_id,clock_timestamp()+interval '10 minutes');
    return square_customer_private.context_v1(c);
  end if;
  if p_operation='consume' then
    if coalesce(p_payload->>'stateHash','') !~ '^sha256:[a-f0-9]{64}$' then
      raise exception 'square_customer_backend_state_denied' using errcode='42501'; end if;
    select * into s from square_customer_private.oauth_states where state_hash=p_payload->>'stateHash'
      and workspace_id=p_workspace_id and actor_id=p_actor_id and session_id=p_session_id;
    if not found then raise exception 'square_customer_backend_state_denied' using errcode='42501'; end if;
    cid:=s.connection_id;
  else
    if jsonb_typeof(p_payload->'connectionId') is distinct from 'string' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    cid:=(p_payload->>'connectionId')::uuid;
  end if;
  select * into c from square_customer_private.connections where connection_id=cid and workspace_id=p_workspace_id for update;
  if not found or c.application_id is distinct from p_application_id then
    raise exception 'square_customer_backend_connection_denied' using errcode='42501'; end if;
  if p_operation not in ('decline','disconnect','authorize_disconnect','complete_disconnect') then
    perform private.square_production_customer_require_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
  end if;
  if p_operation<>'map' then
    if jsonb_typeof(p_payload->'leaseId') is distinct from 'string' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    lid:=(p_payload->>'leaseId')::uuid;
  end if;
  t:=clock_timestamp();
  if p_operation='consume' then
    select * into s from square_customer_private.oauth_states where state_hash=p_payload->>'stateHash' for update;
    if s.consumed_at is not null or s.expires_at<=t or c.state<>'consent_pending' then
      raise exception 'square_customer_backend_state_denied' using errcode='42501'; end if;
    update square_customer_private.oauth_states set consumed_at=t where state_hash=s.state_hash;
    update square_customer_private.connections set state='exchanging',authorization_uncertain=true,lease_id=lid,lease_expires_at=t+interval '120 seconds',
      lease_actor_id=p_actor_id,lease_session_id=p_session_id,lease_authorized=false,updated_at=t where connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  elsif p_operation='map' then
    if c.state<>'mapping_required' or c.location_id is not null or
      jsonb_typeof(p_payload->'locationId') is distinct from 'string' or
      not exists(select from jsonb_array_elements(c.locations) l where l->>'id'=p_payload->>'locationId') then
      raise exception 'square_customer_backend_mapping_denied' using errcode='42501'; end if;
    update square_customer_private.connections set state='connected',location_id=p_payload->>'locationId',updated_at=t where connection_id=cid;
    return jsonb_build_object('mapped',true);
  elsif p_operation='disconnect' then
    if c.authorization_uncertain and c.ciphertext is null then
      raise exception 'square_customer_backend_exchange_recovery_required' using errcode='55000'; end if;
    if c.state='disconnected' and c.revocation_pending and c.lease_id is not null and c.lease_expires_at>t then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    update square_customer_private.oauth_states set consumed_at=coalesce(consumed_at,t) where connection_id=cid;
    update square_customer_private.connections set state='disconnected',revocation_pending=(ciphertext is not null),
      lease_id=lid,lease_expires_at=t+interval '120 seconds',lease_actor_id=p_actor_id,lease_session_id=p_session_id,
      lease_authorized=false,cursor=null,cursor_binding_fingerprint=null,cursor_fingerprint=null,
      window_start=null,window_end=null,updated_at=t where connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  elsif p_operation in ('claim','claim_history') then
    if c.state not in ('connected','retry_required','syncing') or c.ciphertext is null or c.location_id is null
      or c.revocation_pending then raise exception 'square_customer_backend_read_denied' using errcode='42501'; end if;
    if c.lease_id is not null and c.lease_expires_at>t then
      raise exception 'square_customer_backend_lease_busy' using errcode='55000'; end if;
    if p_operation='claim_history' then
      -- A historical read never discards an unfinished update or another import.
      if c.window_start is not null or c.cursor is not null then
        raise exception 'square_customer_backend_read_in_progress' using errcode='55000'; end if;
      if jsonb_typeof(p_payload->'windowStart') is distinct from 'string'
        or jsonb_typeof(p_payload->'windowEnd') is distinct from 'string' then
        raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
      history_start:=(p_payload->>'windowStart')::timestamptz;
      history_end:=(p_payload->>'windowEnd')::timestamptz;
      if not isfinite(history_start) or not isfinite(history_end) or history_start<'1970-01-01T00:00:00Z'::timestamptz
        or history_end<=history_start or history_end-history_start>interval '31 days' or history_end>t then
        raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
      update square_customer_private.connections set state='syncing',lease_id=lid,lease_expires_at=t+interval '120 seconds',
        lease_actor_id=p_actor_id,lease_session_id=p_session_id,lease_authorized=false,last_error=null,
        window_start=history_start,window_end=history_end,read_kind='created',updated_at=t
        where connection_id=cid returning * into c;
      return square_customer_private.context_v1(c);
    end if;
    update square_customer_private.connections set state='syncing',lease_id=lid,lease_expires_at=t+interval '120 seconds',
      lease_actor_id=p_actor_id,lease_session_id=p_session_id,lease_authorized=false,last_error=null,
      read_kind=case when window_start is null then 'updated' else read_kind end,
      window_start=coalesce(window_start,checkpoint_at-interval '5 minutes',t-interval '30 days'),
      window_end=coalesce(window_end,least(t,coalesce(checkpoint_at-interval '5 minutes',t-interval '30 days')+interval '31 days')),
      updated_at=t where connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  end if;
  if c.lease_id is distinct from lid or c.lease_expires_at<=t or c.lease_expires_at is null
    or c.lease_actor_id is distinct from p_actor_id or c.lease_session_id is distinct from p_session_id then
    raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
  if p_operation='decline' then
    if c.state<>'exchanging' or c.ciphertext is not null or c.credential_version<>0 or c.lease_authorized then
      raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    update square_customer_private.connections set state='disconnected',authorization_uncertain=false,
      lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,updated_at=t
      where connection_id=cid;
    return jsonb_build_object('disconnected',true);
  elsif p_operation='reconcile' then
    if c.state not in ('exchanging','syncing') then raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    return square_customer_private.context_v1(c);
  elsif p_operation='authorize_disconnect' then
    if c.state<>'disconnected' or not c.revocation_pending or c.ciphertext is null then
      raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    return jsonb_build_object('authorized',true);
  elsif p_operation='complete_disconnect' then
    if c.authorization_uncertain and c.ciphertext is null then
      raise exception 'square_customer_backend_exchange_recovery_required' using errcode='55000'; end if;
    if c.state<>'disconnected' then raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    update square_customer_private.connections set ciphertext=null,access_expires_at=null,revocation_pending=false,
      lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,
      updated_at=t where connection_id=cid;
    return jsonb_build_object('disconnected',true);
  elsif p_operation='fail' then
    if c.state not in ('exchanging','syncing') or coalesce(p_payload->>'reason','') not in ('retry_required','reauthorization_required') then
      raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    update square_customer_private.connections set state=p_payload->>'reason',last_error=p_payload->>'reason',
      lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,
      updated_at=t where connection_id=cid;
    return jsonb_build_object('recorded',true);
  elsif p_operation='authorize' then
    if c.state not in ('exchanging','syncing') then raise exception 'square_customer_backend_stale_lease' using errcode='42501'; end if;
    update square_customer_private.connections set lease_authorized=true where connection_id=cid;
    return jsonb_build_object('authorized',true);
  end if;
  if not c.lease_authorized then raise exception 'square_customer_backend_dispatch_denied' using errcode='42501'; end if;
  if p_operation in ('stage_credential','complete_connect','commit_refresh') then
    if jsonb_typeof(p_payload->'ciphertext') is distinct from 'string'
      or length(p_payload->>'ciphertext') not between 32 and 131072
      or jsonb_typeof(p_payload->'accessExpiresAt') is distinct from 'string' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    access_expiry:=(p_payload->>'accessExpiresAt')::timestamptz;
    if not isfinite(access_expiry) or access_expiry<=t or access_expiry>t+interval '2 days' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
  end if;
  if p_operation='stage_credential' then
    if c.state<>'exchanging' or c.credential_version<>0 or c.ciphertext is not null
      or coalesce(p_payload->>'merchantId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    update square_customer_private.connections set credential_version=1,ciphertext=p_payload->>'ciphertext',
      merchant_id=p_payload->>'merchantId',access_expires_at=access_expiry,authorization_uncertain=false,updated_at=t
      where connection_id=cid returning * into c;
    return square_customer_private.context_v1(c);
  elsif p_operation='complete_connect' then
    if c.state<>'exchanging' or c.credential_version<>1 or c.ciphertext is distinct from p_payload->>'ciphertext'
      or c.merchant_id is distinct from p_payload->>'merchantId' or c.access_expires_at is distinct from access_expiry
      or coalesce(p_payload->>'merchantId','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'
      or jsonb_typeof(p_payload->'sellerLabel') is distinct from 'string'
      or length(p_payload->>'sellerLabel') not between 1 and 255
      or jsonb_typeof(p_payload->'locations') is distinct from 'array' then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'locations') not between 1 and 500 then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'locations') loop
      perform private.square_production_customer_require_keys_v1(item,array['id','label']);
      if coalesce(item->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
        or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label') not between 1 and 255 then
        raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    end loop;
    if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'locations'))<>jsonb_array_length(p_payload->'locations') then
      raise exception 'square_customer_backend_payload_denied' using errcode='22023'; end if;
    update square_customer_private.connections set state='mapping_required',seller_label=p_payload->>'sellerLabel',locations=p_payload->'locations',
      lease_id=null,lease_expires_at=null,lease_actor_id=null,lease_session_id=null,lease_authorized=false,last_error=null,updated_at=t
      where connection_id=cid;
    return jsonb_build_object('stored',true);
  elsif p_operation='commit_refresh' then
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

alter function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb) owner to postgres;
revoke all on function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,
    square_production_runtime_authority,square_production_evidence_authority,square_production_scheduler_authority,square_production_webhook_authority;
grant execute on function public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
