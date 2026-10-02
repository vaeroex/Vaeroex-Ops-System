begin;

-- Server-only, transactional connection lifecycle. Owner/session validation
-- independently verifies the live session and tenant in every mutation.
alter table public.google_sheets_connections
  add column generation bigint not null default 1 check (generation between 1 and 9007199254740991),
  add column credential_version bigint not null default 0 check (credential_version between 0 and 9007199254740991),
  add column authorization_uncertain boolean not null default false,
  add column revocation_pending boolean not null default false,
  add column oauth_lease_id uuid,
  add column oauth_lease_expires_at timestamptz,
  add column refresh_lease_id uuid,
  add column refresh_lease_expires_at timestamptz;
alter table public.google_sheets_oauth_states
  add column session_id uuid not null,
  add column generation bigint not null check (generation > 0),
  add column recovery_confirmed_by uuid references public.profiles(id),
  add column recovery_confirmed_at timestamptz;
alter table public.google_sheets_credentials
  add column generation bigint not null check (generation > 0),
  add column credential_version bigint not null check (credential_version > 0);

create function private.require_google_sheets_eligible_v1(p_workspace_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare workspace_row public.workspaces; subscription_row public.customer_subscriptions;
  manual_allowed boolean:=false; checked_at timestamptz;
begin
  select w.* into workspace_row from public.workspaces w where w.id=p_workspace_id for share;
  if not found then raise exception 'google_sheets_entitlement_denied' using errcode='42501'; end if;
  select sub.* into subscription_row from public.customer_subscriptions sub
    where sub.workspace_id=p_workspace_id and sub.billing_provider='stripe'
    order by sub.created_at desc,sub.id desc limit 1 for share;
  checked_at:=clock_timestamp();
  if found then
    if subscription_row.manually_activated or subscription_row.status not in ('active','trialing')
      or subscription_row.current_period_end is null or subscription_row.current_period_end<=checked_at
      or subscription_row.stripe_customer_id is null or subscription_row.stripe_subscription_id is null then
      raise exception 'google_sheets_entitlement_denied' using errcode='42501';
    end if;
    return;
  end if;
  -- Match getSubscriptionStatus's workspace fallbacks only after excluding a
  -- linked Stripe row. A Stripe denial cannot be bypassed by these flags.
  if workspace_row.subscription_required is false then return; end if;
  select exists(select 1 from public.customer_subscriptions sub where sub.workspace_id=p_workspace_id
    and sub.billing_provider='manual' and sub.manually_activated and sub.status in ('active','trialing')) into manual_allowed;
  if workspace_row.manually_unlocked and manual_allowed then return; end if;
  if workspace_row.subscription_status='demo' then return; end if;
  if workspace_row.subscription_status='trialing' and workspace_row.trial_ends_at>checked_at then return; end if;
  raise exception 'google_sheets_entitlement_denied' using errcode='42501';
end;
$function$;
revoke all on function private.require_google_sheets_eligible_v1(uuid) from public,anon,authenticated,service_role;

create function public.google_sheets_lifecycle_v1(
  p_operation text, p_workspace_id uuid, p_connection_id uuid,
  p_actor_id uuid default null, p_session_id uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.google_sheets_connections; s public.google_sheets_oauth_states;
declare t timestamptz:=clock_timestamp(); cid uuid:=p_connection_id; cred public.google_sheets_credentials;
declare field text; keys text[]; expected text[]; expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_workspace_id is null or p_payload is null
    or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>131072 then
    raise exception 'google_sheets_lifecycle_denied' using errcode='42501'; end if;
  expected:=case p_operation
    when 'begin' then array['businessEntityId','displayName','stateHash','redirectUri']
    when 'reconnect' then array['stateHash','redirectUri']
    when 'consume' then array['stateHash','leaseId','redirectUri']
    when 'decline' then array['leaseId']
    when 'recover_oauth' then array['confirmation']
    when 'complete_oauth' then array['leaseId','ciphertext','accessExpiresAt']
    when 'config' then array['expectedUpdatedAt','configuration']
    when 'credential' then array[]::text[]
    when 'mark_reauthorization' then array['credentialVersion','generation']
    when 'claim_refresh' then array['leaseId','credentialVersion','generation']
    when 'commit_refresh' then array['leaseId','credentialVersion','ciphertext','accessExpiresAt']
    when 'fail_refresh' then array['leaseId','reauthorize']
    when 'disconnect' then array[]::text[]
    when 'complete_disconnect' then array['credentialVersion','generation']
    else null end;
  if expected is null then raise exception 'google_sheets_lifecycle_operation_invalid' using errcode='22023'; end if;
  select coalesce(array_agg(key order by key),array[]::text[]) into keys from jsonb_object_keys(p_payload) key;
  if keys is distinct from (select coalesce(array_agg(key order by key),array[]::text[]) from unnest(expected) key) then
    raise exception 'google_sheets_lifecycle_payload_invalid' using errcode='22023'; end if;
  foreach field in array expected loop
    if field in ('credentialVersion','generation') then
      if jsonb_typeof(p_payload->field) is distinct from 'number' or (p_payload->>field) !~ '^[0-9]{1,16}$'
        or (p_payload->>field)::numeric > 9007199254740991 then
        raise exception 'google_sheets_lifecycle_payload_invalid' using errcode='22023'; end if;
    elsif field='reauthorize' then
      if jsonb_typeof(p_payload->field) is distinct from 'boolean' then
        raise exception 'google_sheets_lifecycle_payload_invalid' using errcode='22023'; end if;
    elsif field='configuration' then
      if jsonb_typeof(p_payload->field) is distinct from 'object' then
        raise exception 'google_sheets_lifecycle_payload_invalid' using errcode='22023'; end if;
    elsif jsonb_typeof(p_payload->field) is distinct from 'string' then
      raise exception 'google_sheets_lifecycle_payload_invalid' using errcode='22023';
    end if;
  end loop;
  if p_operation not in ('credential','claim_refresh','commit_refresh','fail_refresh','mark_reauthorization') then
    perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id);
  end if;
  if p_operation in ('begin','reconnect','consume','config','credential','claim_refresh') then
    perform private.require_google_sheets_eligible_v1(p_workspace_id);
  end if;
  -- Match sync/overlap retirement lock order: workspace authority, then connection.
  perform pg_advisory_xact_lock(hashtextextended('google_sheets:'||p_workspace_id::text,0));
  if p_operation='begin' then
    perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id,(p_payload->>'businessEntityId')::uuid);
    if cid is null or char_length(p_payload->>'displayName') not between 1 and 120 then
      raise exception 'google_sheets_connection_invalid' using errcode='22023'; end if;
    insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,display_name)
      values(cid,p_workspace_id,(p_payload->>'businessEntityId')::uuid,p_actor_id,p_payload->>'displayName') returning * into c;
  else
    if p_operation='consume' then
      select * into s from public.google_sheets_oauth_states where workspace_id=p_workspace_id
        and state_hash=p_payload->>'stateHash' and initiated_by=p_actor_id and session_id=p_session_id;
      if not found then raise exception 'google_sheets_state_invalid' using errcode='42501'; end if;
      cid:=s.connection_id;
    end if;
    select * into c from public.google_sheets_connections where workspace_id=p_workspace_id and id=cid for update;
    if not found then raise exception 'google_sheets_connection_unavailable' using errcode='42501'; end if;
  end if;
  t:=clock_timestamp();
  select * into cred from public.google_sheets_credentials where workspace_id=p_workspace_id and connection_id=cid;
  if p_operation in ('begin','reconnect') then
    if p_payload->>'stateHash' !~ '^sha256:[a-f0-9]{64}$' or
      p_payload->>'redirectUri' !~ '^https://[^/?#]+/api/integrations/google-sheets/callback$' then
      raise exception 'google_sheets_state_invalid' using errcode='22023'; end if;
    if p_operation='reconnect' then
      if c.authorization_uncertain or c.revocation_pending or c.refresh_lease_expires_at>t or c.oauth_lease_expires_at>t
        or c.sync_lease_expires_at>t or c.status not in ('reauthorization_required','disconnected','pending_authorization') then
        raise exception 'google_sheets_reconnect_unavailable' using errcode='55000'; end if;
      perform private.require_google_sheets_owner_v1(p_actor_id,p_session_id,p_workspace_id,c.business_entity_id);
      update public.google_sheets_oauth_states set consumed_at=coalesce(consumed_at,t) where workspace_id=p_workspace_id and connection_id=cid;
      delete from public.google_sheets_credentials where workspace_id=p_workspace_id and connection_id=cid;
      update public.google_sheets_connections set generation=generation+1,credential_version=0,status='pending_authorization',
        disconnected_at=null,oauth_lease_id=null,oauth_lease_expires_at=null,updated_at=t where id=cid returning * into c;
    end if;
    insert into public.google_sheets_oauth_states(workspace_id,connection_id,initiated_by,session_id,generation,state_hash,redirect_uri,created_at,expires_at)
      values(p_workspace_id,cid,p_actor_id,p_session_id,c.generation,p_payload->>'stateHash',p_payload->>'redirectUri',t,t+interval '10 minutes');
    return jsonb_build_object('connectionId',cid,'generation',c.generation);
  elsif p_operation='consume' then
    select * into s from public.google_sheets_oauth_states where id=s.id for update;
    if s.consumed_at is not null or s.expires_at<=t or s.generation<>c.generation or s.redirect_uri<>p_payload->>'redirectUri'
      or c.status<>'pending_authorization' or c.authorization_uncertain then
      raise exception 'google_sheets_state_invalid' using errcode='42501'; end if;
    update public.google_sheets_oauth_states set consumed_at=t where id=s.id;
    update public.google_sheets_connections set authorization_uncertain=true,oauth_lease_id=(p_payload->>'leaseId')::uuid,
      oauth_lease_expires_at=t+interval '2 minutes',updated_at=t where id=cid returning * into c;
  elsif p_operation in ('decline','complete_oauth') then
    if c.oauth_lease_id is distinct from (p_payload->>'leaseId')::uuid or c.oauth_lease_expires_at<=t
      or c.status<>'pending_authorization' or not exists(select 1 from public.google_sheets_oauth_states os where os.workspace_id=p_workspace_id and os.connection_id=cid and os.generation=c.generation and os.initiated_by=p_actor_id and os.session_id=p_session_id and os.consumed_at is not null) then raise exception 'google_sheets_oauth_lease_expired' using errcode='42501'; end if;
    if p_operation='decline' then
      update public.google_sheets_connections set status='reauthorization_required',authorization_uncertain=false,
        oauth_lease_id=null,oauth_lease_expires_at=null,updated_at=t where id=cid returning * into c;
    else
      expiry:=(p_payload->>'accessExpiresAt')::timestamptz;
      if not isfinite(expiry) or expiry<=t or expiry>t+interval '1 day' or char_length(p_payload->>'ciphertext') not between 32 and 32768 then
        raise exception 'google_sheets_credential_invalid' using errcode='22023'; end if;
      insert into public.google_sheets_credentials(workspace_id,connection_id,generation,credential_version,token_ciphertext,access_expires_at,granted_scope)
        values(p_workspace_id,cid,c.generation,1,p_payload->>'ciphertext',expiry,'https://www.googleapis.com/auth/spreadsheets.readonly');
      update public.google_sheets_connections set status='connected',credential_version=1,authorization_uncertain=false,
        oauth_lease_id=null,oauth_lease_expires_at=null,updated_at=t where id=cid returning * into c;
    end if;
  elsif p_operation='recover_oauth' then
    -- This is the initiating owner's explicit attestation after removing the
    -- grant in Google Account controls. It is never provider-verified revocation.
    if p_payload->>'confirmation'<>'access_removed' or not c.authorization_uncertain
      or c.oauth_lease_expires_at is null or c.oauth_lease_expires_at>t or cred.connection_id is not null
      or c.status<>'pending_authorization' then
      raise exception 'google_sheets_recovery_unavailable' using errcode='42501'; end if;
    update public.google_sheets_oauth_states set recovery_confirmed_by=p_actor_id,recovery_confirmed_at=t
      where workspace_id=p_workspace_id and connection_id=cid and generation=c.generation and initiated_by=p_actor_id
        and consumed_at is not null and recovery_confirmed_at is null;
    if not found then raise exception 'google_sheets_recovery_actor_denied' using errcode='42501'; end if;
    update public.google_sheets_connections set status='disconnected',authorization_uncertain=false,
      oauth_lease_id=null,oauth_lease_expires_at=null,disconnected_at=t,updated_at=t where id=cid returning * into c;
  elsif p_operation='config' then
    if c.status<>'connected' or c.sync_lease_expires_at>t or c.refresh_lease_expires_at>t
      or c.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then
      raise exception 'google_sheets_configuration_busy' using errcode='55000'; end if;
    expected:=array['spreadsheetId','spreadsheetTitle','tabs','sheetId','sheetTitle','headerRow','headers'];
    select coalesce(array_agg(key order by key),array[]::text[]) into keys from jsonb_object_keys(p_payload->'configuration') key;
    if keys is distinct from (select array_agg(key order by key) from unnest(expected) key) then
      raise exception 'google_sheets_configuration_invalid' using errcode='22023'; end if;
    update public.google_sheets_connections set spreadsheet_id=p_payload#>>'{configuration,spreadsheetId}',
      spreadsheet_title=p_payload#>>'{configuration,spreadsheetTitle}',tabs=p_payload#>'{configuration,tabs}',
      sheet_id=(p_payload#>>'{configuration,sheetId}')::bigint,sheet_title=p_payload#>>'{configuration,sheetTitle}',
      header_row=(p_payload#>>'{configuration,headerRow}')::integer,headers=p_payload#>'{configuration,headers}',
      field_mapping='{}',updated_at=t where id=cid returning * into c;
  elsif p_operation='credential' then
    if c.status<>'connected' or c.revocation_pending or cred.connection_id is null then
      raise exception 'google_sheets_credential_unavailable' using errcode='42501'; end if;
  elsif p_operation='mark_reauthorization' then
    if c.status<>'connected' or (c.credential_version<>(p_payload->>'credentialVersion')::bigint or c.generation<>(p_payload->>'generation')::bigint) or c.refresh_lease_expires_at>t then
      raise exception 'google_sheets_credential_stale' using errcode='42501'; end if;
    update public.google_sheets_connections set status='reauthorization_required',updated_at=t where id=cid returning * into c;
  elsif p_operation='claim_refresh' then
    if c.status<>'connected' or c.revocation_pending or cred.connection_id is null or c.refresh_lease_expires_at>t
      or (c.credential_version<>(p_payload->>'credentialVersion')::bigint or c.generation<>(p_payload->>'generation')::bigint) then
      raise exception 'google_sheets_refresh_busy' using errcode='55000'; end if;
    update public.google_sheets_connections set refresh_lease_id=(p_payload->>'leaseId')::uuid,
      refresh_lease_expires_at=t+interval '30 seconds' where id=cid returning * into c;
  elsif p_operation in ('commit_refresh','fail_refresh') then
    if c.status<>'connected' or c.refresh_lease_id is distinct from (p_payload->>'leaseId')::uuid or c.refresh_lease_expires_at<=t then
      raise exception 'google_sheets_refresh_stale' using errcode='42501'; end if;
    if p_operation='commit_refresh' then
      if (p_payload->>'credentialVersion')::bigint<>c.credential_version+1 or cred.generation<>c.generation then
        raise exception 'google_sheets_refresh_stale' using errcode='42501'; end if;
      expiry:=(p_payload->>'accessExpiresAt')::timestamptz;
      if not isfinite(expiry) or expiry<=t or expiry>t+interval '1 day' or char_length(p_payload->>'ciphertext') not between 32 and 32768 then
        raise exception 'google_sheets_credential_invalid' using errcode='22023'; end if;
      update public.google_sheets_credentials set credential_version=c.credential_version+1,token_ciphertext=p_payload->>'ciphertext',
        access_expires_at=expiry,updated_at=t where workspace_id=p_workspace_id and connection_id=cid;
      update public.google_sheets_connections set credential_version=credential_version+1,refresh_lease_id=null,refresh_lease_expires_at=null where id=cid returning * into c;
    else
      update public.google_sheets_connections set refresh_lease_id=null,refresh_lease_expires_at=null,
        status=case when (p_payload->>'reauthorize')::boolean then 'reauthorization_required' else status end,updated_at=t where id=cid returning * into c;
    end if;
  elsif p_operation='disconnect' then
    if c.authorization_uncertain or c.refresh_lease_expires_at>t then
      raise exception 'google_sheets_recovery_required' using errcode='55000'; end if;
    update public.google_sheets_oauth_states set consumed_at=coalesce(consumed_at,t) where workspace_id=p_workspace_id and connection_id=cid;
    update public.google_sheets_connections set status='disconnected',revocation_pending=(cred.connection_id is not null),
      disconnected_at=t,sync_lease_run_id=null,sync_lease_expires_at=null,updated_at=t where id=cid returning * into c;
  elsif p_operation='complete_disconnect' then
    if c.status<>'disconnected' or (c.credential_version<>(p_payload->>'credentialVersion')::bigint or c.generation<>(p_payload->>'generation')::bigint) then
      raise exception 'google_sheets_disconnect_stale' using errcode='42501'; end if;
    delete from public.google_sheets_credentials where workspace_id=p_workspace_id and connection_id=cid;
    update public.google_sheets_connections set revocation_pending=false,updated_at=t where id=cid returning * into c;
  end if;
  select * into cred from public.google_sheets_credentials where workspace_id=p_workspace_id and connection_id=cid;
  return jsonb_build_object('connectionId',cid,'workspaceId',p_workspace_id,'generation',c.generation,'credentialVersion',c.credential_version,
    'ciphertext',cred.token_ciphertext,'accessExpiresAt',cred.access_expires_at,'state',c.status,
    'leaseId',c.oauth_lease_id,'refreshLeaseId',c.refresh_lease_id,'revocationPending',c.revocation_pending);
end;
$function$;
revoke all on function public.google_sheets_lifecycle_v1(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.google_sheets_lifecycle_v1(text,uuid,uuid,uuid,uuid,jsonb) to service_role;
-- Callers can read safe connection metadata; all lifecycle mutations use the RPC.
revoke insert,update,delete on public.google_sheets_oauth_states from service_role;
revoke all on public.google_sheets_credentials from service_role;

commit;
