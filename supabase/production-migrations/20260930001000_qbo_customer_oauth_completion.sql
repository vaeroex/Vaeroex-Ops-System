-- Production customer OAuth completion only. No configuration, credentials or schedules
-- are provisioned by this migration. Native QBO authority roles remain required.
begin;

create function private.qbo_customer_require_owner_v1(
  p_actor uuid, p_session uuid, p_workspace uuid, p_entity uuid,
  p_require_entitlement boolean default true
) returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_expires timestamptz;
  v_subscription public.customer_subscriptions;
begin
  if p_actor is null or p_session is null or p_workspace is null or p_entity is null then
    raise exception 'qbo_customer_owner_denied' using errcode = '42501';
  end if;
  perform 1 from public.workspaces where id = p_workspace for share;
  if not found then raise exception 'qbo_customer_owner_denied' using errcode = '42501'; end if;
  select s.not_after into v_expires from auth.sessions s
    join auth.users u on u.id = s.user_id
    where s.id = p_session and s.user_id = p_actor and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    for share of s, u;
  if not found or (v_expires is not null and v_expires <= clock_timestamp()) then
    raise exception 'qbo_customer_session_denied' using errcode = '42501';
  end if;
  perform 1 from public.workspace_members m where m.workspace_id = p_workspace
    and m.user_id = p_actor and m.role = 'owner' and m.status = 'active' for share;
  if not found then raise exception 'qbo_customer_owner_denied' using errcode = '42501'; end if;
  perform 1 from public.business_entities e where e.workspace_id = p_workspace
    and e.id = p_entity and e.status = 'active' for share;
  if not found then raise exception 'qbo_customer_entity_denied' using errcode = '42501'; end if;
  if not p_require_entitlement then return; end if;
  select s.* into v_subscription from public.customer_subscriptions s
    where s.workspace_id = p_workspace and s.billing_provider = 'stripe'
    order by s.created_at desc, s.id desc limit 1 for share;
  if found then
    if v_subscription.manually_activated or v_subscription.status not in ('active','trialing')
      or v_subscription.current_period_end is null or v_subscription.current_period_end <= clock_timestamp()
      or v_subscription.stripe_customer_id is null or v_subscription.stripe_subscription_id is null then
      raise exception 'qbo_customer_entitlement_denied' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.workspaces w
      join public.customer_subscriptions s on s.workspace_id = w.id
      where w.id = p_workspace and w.manually_unlocked and s.billing_provider = 'manual'
        and s.manually_activated and s.status in ('active','trialing')) then
    raise exception 'qbo_customer_entitlement_denied' using errcode = '42501';
  end if;
end;
$function$;

-- Operational completion state, not a second credential/evidence store. The
-- session and scope are derived only by the state-table trigger, never a caller.
create table private.integration_qbo_customer_authorizations (
  state_id uuid primary key,
  state_kind text not null check (state_kind in ('initial','reauthorization')),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null references private.integration_connections(id),
  connection_generation bigint not null check (connection_generation > 0),
  actor_id uuid not null,
  session_id uuid not null,
  credential_id uuid not null default gen_random_uuid(),
  realm_fingerprint bytea check (octet_length(realm_fingerprint) = 32),
  outcome text not null default 'pending' check (outcome in
    ('pending','exchanging','stored','completed','denied','recovery_required')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.integration_qbo_customer_authorizations enable row level security;
alter table private.integration_qbo_customer_authorizations force row level security;
revoke all on private.integration_qbo_customer_authorizations from public, anon, authenticated, service_role;

create function private.qbo_customer_bind_session_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare v_binding private.integration_qbo_customer_authorizations; v_session uuid;
begin
  if new.provider_key <> 'quickbooks_online' or new.provider_environment <> 'production' then return new; end if;
  if tg_op = 'INSERT' then
    v_session := (auth.jwt() ->> 'session_id')::uuid;
    if auth.uid() is distinct from new.initiated_by then
      raise exception 'qbo_customer_session_denied' using errcode = '42501';
    end if;
    perform private.qbo_customer_require_owner_v1(new.initiated_by, v_session,
      new.workspace_id, new.business_entity_id);
    insert into private.integration_qbo_customer_authorizations
      (state_id,state_kind,workspace_id,business_entity_id,connection_id,connection_generation,actor_id,session_id)
    values (new.id,case when tg_table_name = 'integration_oauth_states' then 'initial' else 'reauthorization' end,
      new.workspace_id,new.business_entity_id,new.connection_id,new.connection_generation,new.initiated_by,v_session);
  elsif old.status = 'pending' and new.status = 'consumed' then
    select * into v_binding from private.integration_qbo_customer_authorizations where state_id = new.id for update;
    if not found or v_binding.actor_id <> new.initiated_by
      or v_binding.workspace_id <> new.workspace_id or v_binding.business_entity_id <> new.business_entity_id
      or v_binding.connection_id <> new.connection_id or v_binding.connection_generation <> new.connection_generation then
      raise exception 'qbo_customer_session_denied' using errcode = '42501';
    end if;
    perform private.qbo_customer_require_owner_v1(v_binding.actor_id,v_binding.session_id,
      v_binding.workspace_id,v_binding.business_entity_id);
  end if;
  return new;
end;
$function$;
create trigger qbo_customer_bind_session_v1 before insert or update on private.integration_oauth_states
  for each row execute function private.qbo_customer_bind_session_v1();
create trigger qbo_customer_bind_session_v1 before insert or update on private.integration_reauthorization_states
  for each row execute function private.qbo_customer_bind_session_v1();

create function private.qbo_customer_connection_owner_guard_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.provider_key = 'quickbooks_online' and new.provider_environment = 'production'
    and (tg_op = 'INSERT' or (new.status = 'disconnecting' and old.status <> 'disconnecting')) then
    -- Authenticated intent/disconnect RPCs cannot use management membership or
    -- an expired bearer token as a substitute for the live workspace owner.
    perform private.qbo_customer_require_owner_v1(auth.uid(),(auth.jwt()->>'session_id')::uuid,
      new.workspace_id,new.business_entity_id,new.status <> 'disconnecting');
  end if;
  return new;
end;
$function$;
create trigger qbo_customer_connection_owner_guard_v1 before insert or update on private.integration_connections
  for each row execute function private.qbo_customer_connection_owner_guard_v1();

create function public.begin_qbo_customer_authorization_v1(p_state_id uuid, p_realm_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare a private.integration_qbo_customer_authorizations; f bytea; v_mapping bytea;
  n private.integration_connections; v_row bigint;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  f := private.sha256_fingerprint_bytes_v1(p_realm_fingerprint);
  -- Serialize the realm claim before any exchange. Never revoke a grant merely
  -- because its realm is already owned by another workspace/connection.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qbo_realm:' || p_realm_fingerprint,0));
  select * into a from private.integration_qbo_customer_authorizations where state_id = p_state_id for update;
  if not found or a.outcome <> 'pending' then raise exception 'qbo_customer_exchange_replayed' using errcode = '42501'; end if;
  perform private.qbo_customer_require_owner_v1(a.actor_id,a.session_id,a.workspace_id,a.business_entity_id);
  select * into n from private.integration_connections where id=a.connection_id for update;
  if not found or n.workspace_id<>a.workspace_id or n.business_entity_id<>a.business_entity_id
    or n.connection_generation<>a.connection_generation then
    raise exception 'qbo_customer_connection_stale' using errcode='40001';
  end if;
  if a.state_kind = 'initial' then
    if not exists (select 1 from private.integration_oauth_states s where s.id=a.state_id and s.status='consumed') then
      raise exception 'qbo_customer_state_not_consumed' using errcode='42501';
    end if;
    select expected_connection_row_version into v_row from private.integration_qbo_oauth_state_bindings_v2
      where oauth_state_id=a.state_id;
    if v_row is null or n.row_version<>v_row or n.status<>'pending_authorization' then
      raise exception 'qbo_customer_connection_stale' using errcode='40001';
    end if;
  else
    select s.prior_mapping_verification_fingerprint,s.expected_connection_row_version into v_mapping,v_row
      from private.integration_reauthorization_states s where s.id=a.state_id and s.status='consumed'
        and s.provider_entity_reference_fingerprint=f;
    if not found then raise exception 'qbo_customer_reauthorization_realm_denied' using errcode='42501'; end if;
    if n.row_version<>v_row or n.status<>'reauthorization_required' then
      raise exception 'qbo_customer_connection_stale' using errcode='40001';
    end if;
  end if;
  if exists (select 1 from private.integration_credentials c
      where c.provider_key='quickbooks_online' and c.provider_environment='production'
        and c.external_entity_reference_fingerprint=f and c.connection_id<>a.connection_id
        and not exists(select 1 from private.integration_credentials released
          join private.integration_connections former on former.id=released.connection_id
          where released.connection_id=c.connection_id and released.connection_generation=c.connection_generation
            and released.external_entity_reference_fingerprint=f
            and released.credential_version>=c.credential_version and former.status='disconnected'
            and released.status='destroyed' and released.provider_revocation_status='succeeded'))
    or exists (select 1 from private.integration_qbo_customer_authorizations b
      where b.realm_fingerprint=f and b.connection_id<>a.connection_id
        and b.outcome in ('exchanging','stored','recovery_required')
        and not exists(select 1 from private.integration_credentials historical
          join private.integration_credentials released on released.connection_id=historical.connection_id
            and released.connection_generation=historical.connection_generation
            and released.credential_version>=historical.credential_version
          join private.integration_connections former on former.id=released.connection_id
          where historical.id=b.credential_id and released.external_entity_reference_fingerprint=f
            and former.status='disconnected' and released.status='destroyed'
            and released.provider_revocation_status='succeeded')) then
    raise exception 'qbo_customer_company_already_bound' using errcode='42501';
  end if;
  update private.integration_qbo_customer_authorizations set realm_fingerprint=f,
    outcome='exchanging',updated_at=clock_timestamp() where state_id=a.state_id;
  return jsonb_build_object('credentialId',a.credential_id,'priorMappingVerificationFingerprint',
    case when v_mapping is null then null else private.phase_5_fingerprint_text_v1(v_mapping) end);
end;
$function$;

create function public.deny_qbo_customer_authorization_v1(p_state_hash text,p_state_kind text,p_redirect_uri text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a private.integration_qbo_customer_authorizations; v_id uuid; v_return text; v_hash bytea;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();
  v_hash:=private.sha256_fingerprint_bytes_v1(p_state_hash);
  if p_state_kind='initial' then
    select s.id,s.return_intent into v_id,v_return from private.integration_oauth_states s
      join private.integration_qbo_oauth_state_bindings_v2 b on b.oauth_state_id=s.id
      join private.integration_qbo_runtime_configurations cfg on cfg.configuration_version=b.configuration_version
        and cfg.provider_environment='production' and cfg.enabled and cfg.authorization_redirect_uri=p_redirect_uri
      where s.state_hash=v_hash and s.status='pending' and s.expires_at>clock_timestamp()
        and b.redirect_uri=p_redirect_uri for update of s;
  elsif p_state_kind='reauthorization' then
    select s.id,s.return_intent into v_id,v_return from private.integration_reauthorization_states s
      join private.integration_qbo_runtime_configurations cfg on cfg.provider_environment='production'
        and cfg.enabled and cfg.authorization_redirect_uri=p_redirect_uri
      where s.state_hash=v_hash and s.status='pending' and s.expires_at>clock_timestamp()
        and s.redirect_uri=p_redirect_uri and s.provider_environment='production' for update of s;
  else raise exception 'qbo_customer_denial_invalid' using errcode='22023'; end if;
  if v_id is null then raise exception 'qbo_customer_denial_state_denied' using errcode='42501'; end if;
  select * into a from private.integration_qbo_customer_authorizations where state_id=v_id for update;
  if not found or a.outcome<>'pending' or a.state_kind<>p_state_kind then
    raise exception 'qbo_customer_denial_state_denied' using errcode='42501'; end if;
  perform private.qbo_customer_require_owner_v1(a.actor_id,a.session_id,a.workspace_id,a.business_entity_id,false);
  if p_state_kind='initial' then
    update private.integration_oauth_states set status='expired',row_version=row_version+1 where id=v_id;
    update private.integration_connections set status='error',state_reason_code='control_plane_error',
      status_changed_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1
      where id=a.connection_id and connection_generation=a.connection_generation and status='pending_authorization';
  else
    update private.integration_reauthorization_states set status='expired',row_version=row_version+1 where id=v_id;
  end if;
  update private.integration_qbo_customer_authorizations set outcome='denied',updated_at=clock_timestamp() where state_id=v_id;
  return jsonb_build_object('returnIntent',v_return,'outcome','denied');
end;
$function$;

create function private.qbo_customer_credential_store_guard_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare a private.integration_qbo_customer_authorizations;
begin
  if new.provider_key <> 'quickbooks_online' or new.provider_environment <> 'production' then return new; end if;
  select * into a from private.integration_qbo_customer_authorizations
    where state_id=coalesce(new.oauth_state_id,new.reauthorization_state_id) for update;
  if not found or a.outcome <> 'exchanging' or new.id<>a.credential_id
    or new.workspace_id<>a.workspace_id or new.business_entity_id<>a.business_entity_id
    or new.connection_id<>a.connection_id or new.connection_generation<>a.connection_generation
    or new.initiated_by<>a.actor_id or a.realm_fingerprint is distinct from new.external_entity_reference_fingerprint then
    raise exception 'qbo_customer_credential_binding_denied' using errcode='42501';
  end if;
  perform private.qbo_customer_require_owner_v1(a.actor_id,a.session_id,a.workspace_id,a.business_entity_id);
  update private.integration_qbo_customer_authorizations set outcome='stored',updated_at=clock_timestamp() where state_id=a.state_id;
  return new;
end;
$function$;
create trigger qbo_customer_credential_store_guard_v1 before insert on private.integration_credentials
  for each row execute function private.qbo_customer_credential_store_guard_v1();

create function public.read_qbo_customer_authorization_completion_v1(p_state_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare a private.integration_qbo_customer_authorizations; c private.integration_credentials; n private.integration_connections;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  select * into a from private.integration_qbo_customer_authorizations where state_id=p_state_id;
  if not found then raise exception 'qbo_customer_completion_missing' using errcode='42501'; end if;
  select * into c from private.integration_credentials where id=a.credential_id
    and connection_id=a.connection_id and connection_generation=a.connection_generation
    and coalesce(oauth_state_id,reauthorization_state_id)=a.state_id;
  select * into n from private.integration_connections where id=a.connection_id;
  return jsonb_build_object('credentialId',a.credential_id,'stored',c.id is not null,
    'credentialVersion',c.credential_version,'credentialStatus',c.status,
    'connectionStatus',n.status,'connectionRowVersion',n.row_version,'outcome',a.outcome);
end;
$function$;

create function public.finish_qbo_customer_authorization_v1(p_state_id uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare a private.integration_qbo_customer_authorizations; n private.integration_connections;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if p_outcome not in ('completed','denied','recovery_required') then
    raise exception 'qbo_customer_completion_invalid' using errcode='22023'; end if;
  select * into a from private.integration_qbo_customer_authorizations where state_id=p_state_id for update;
  if not found then raise exception 'qbo_customer_completion_missing' using errcode='42501'; end if;
  if a.outcome in ('completed','denied','recovery_required') then
    if a.outcome<>p_outcome then raise exception 'qbo_customer_completion_conflict' using errcode='40001'; end if;
    return jsonb_build_object('outcome',a.outcome,'idempotent',true);
  end if;
  select * into n from private.integration_connections where id=a.connection_id for update;
  if p_outcome='completed' then
    perform private.qbo_customer_require_owner_v1(a.actor_id,a.session_id,a.workspace_id,a.business_entity_id);
    if a.outcome<>'stored' or n.status<>'initializing' or not exists (
      select 1 from private.integration_credentials c where c.id=a.credential_id and c.status='active'
    ) then raise exception 'qbo_customer_completion_not_stored' using errcode='42501'; end if;
  else
    -- No code retry after a timeout or an uncertain exchange/store. The retained
    -- state explicitly requires recovery, including after process interruption.
    if n.status in ('pending_authorization','initializing') then
      update private.integration_connections set status='error',state_reason_code='control_plane_error',
        status_changed_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1 where id=n.id;
    elsif n.status='authorized_unmapped' then
      update private.integration_connections set status='reauthorization_required',state_reason_code='authorization_required',
        status_changed_at=clock_timestamp(),updated_at=clock_timestamp(),row_version=row_version+1 where id=n.id;
    end if;
  end if;
  update private.integration_qbo_customer_authorizations set outcome=p_outcome,updated_at=clock_timestamp() where state_id=a.state_id;
  return jsonb_build_object('outcome',p_outcome,'idempotent',false);
end;
$function$;

-- A reauthorization store may enter initializing before the bounded CompanyInfo
-- check finishes. Neither scheduling nor task-bound credential reads may race it.
create function private.qbo_customer_authorization_work_guard_v1() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if (select a.outcome from private.integration_qbo_customer_authorizations a
    where a.connection_id=new.connection_id and a.connection_generation=new.connection_generation
    order by a.created_at desc,a.state_id desc limit 1) in ('exchanging','stored','recovery_required') then
    raise exception 'qbo_customer_authorization_incomplete' using errcode='42501';
  end if;
  return new;
end;
$function$;
create trigger qbo_customer_authorization_work_guard_v1 before insert on private.integration_sync_tasks
  for each row execute function private.qbo_customer_authorization_work_guard_v1();
create trigger qbo_customer_authorization_work_guard_v1 before insert on private.integration_provider_credential_task_read_evidence
  for each row execute function private.qbo_customer_authorization_work_guard_v1();

-- Revocation work is discovered only after the authenticated canonical request
-- fenced the connection. Provider outcome and local destruction retain the
-- existing credential audit/history; no saved source or task is deleted.
create table private.integration_qbo_customer_disconnect_work (
  connection_id uuid primary key references private.integration_connections(id),
  credential_id uuid not null references private.integration_credentials(id),
  credential_version bigint not null check (credential_version>0),
  claim_id uuid not null,
  lease_until timestamptz not null,
  outcome text not null check (outcome in ('pending','succeeded','failed','deferred')),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.integration_qbo_customer_disconnect_work enable row level security;
alter table private.integration_qbo_customer_disconnect_work force row level security;
revoke all on private.integration_qbo_customer_disconnect_work from public,anon,authenticated,service_role;

create function public.claim_qbo_customer_disconnect_v1(p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare n private.integration_connections; c private.integration_credentials; v_claim uuid:=gen_random_uuid();
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id) then raise exception 'qbo_customer_disconnect_invalid' using errcode='22023'; end if;
  select conn.* into n from private.integration_connections conn
    where conn.provider_key='quickbooks_online' and conn.provider_environment='production' and conn.status='disconnecting'
      and not exists(select 1 from private.integration_qbo_customer_disconnect_work w where w.connection_id=conn.id
        and (w.outcome='succeeded' or w.lease_until>clock_timestamp()))
      and exists(select 1 from private.integration_credentials cr where cr.connection_id=conn.id
        and cr.connection_generation=conn.connection_generation and cr.status in ('active','reauthorization_required','revoked')
        and (cr.refresh_lease_id is null or cr.refresh_lease_expires_at<=clock_timestamp()))
    order by conn.updated_at,conn.id limit 1 for update skip locked;
  if not found then return jsonb_build_object('acquired',false); end if;
  select * into c from private.integration_credentials where connection_id=n.id
    and connection_generation=n.connection_generation and status in ('active','reauthorization_required','revoked')
    order by credential_version desc limit 1 for update;
  if c.refresh_lease_id is not null and c.refresh_lease_expires_at>clock_timestamp() then
    return jsonb_build_object('acquired',false);
  end if;
  if exists(select 1 from private.integration_credentials other where other.provider_key='quickbooks_online'
    and other.provider_environment='production' and other.connection_id<>n.id
    and other.external_entity_reference_fingerprint=c.external_entity_reference_fingerprint
    and not exists(select 1 from private.integration_credentials released
      join private.integration_connections former on former.id=released.connection_id
      where released.connection_id=other.connection_id and released.connection_generation=other.connection_generation
        and released.external_entity_reference_fingerprint=other.external_entity_reference_fingerprint
        and released.credential_version>=other.credential_version and former.status='disconnected'
        and released.status='destroyed' and released.provider_revocation_status='succeeded')) then
    raise exception 'qbo_customer_revocation_company_conflict' using errcode='42501';
  end if;
  if c.status<>'revoked' then
    perform public.revoke_integration_credential_v1(jsonb_build_object(
      'workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,'connectionId',c.connection_id,
      'connectionGeneration',c.connection_generation,'credentialId',c.id,'expectedCredentialVersion',c.credential_version,
      'reasonCode','customer_disconnect','revokedAt',clock_timestamp()),p_request_id);
  elsif c.revocation_reason_code<>'customer_disconnect' or c.provider_revocation_status<>'pending' then
    raise exception 'qbo_customer_revocation_not_pending' using errcode='42501';
  end if;
  insert into private.integration_qbo_customer_disconnect_work
    (connection_id,credential_id,credential_version,claim_id,lease_until,outcome)
    values(n.id,c.id,c.credential_version,v_claim,clock_timestamp()+interval '3 minutes','pending')
    on conflict(connection_id) do update set claim_id=excluded.claim_id,lease_until=excluded.lease_until,outcome='pending',
      updated_at=clock_timestamp();
  return jsonb_build_object('acquired',true,'claimId',v_claim,'connectionId',n.id,
    'credentialId',c.id,'credentialVersion',c.credential_version,
    'ciphertextBase64',replace(encode(c.credential_ciphertext,'base64'),E'\n',''),'kmsKeyResource',c.kms_key_resource,
    'aadDigest',private.phase_5_fingerprint_text_v1(c.aad_digest),
    'realmFingerprint',private.phase_5_fingerprint_text_v1(c.external_entity_reference_fingerprint),
    'aadContext',jsonb_build_object('schemaVersion','oauth_credential_aad_v1','purpose','provider_oauth_credential',
      'environment','production','workspaceId',c.workspace_id,'connectionId',c.connection_id,
      'connectionGeneration',c.connection_generation,'providerKey','quickbooks_online','credentialId',c.id));
end;
$function$;

create function public.authorize_qbo_customer_revocation_v1(p_claim_id uuid,p_connection_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
  perform private.assert_integration_credential_broker_authority_v1();
  return exists(select 1 from private.integration_qbo_customer_disconnect_work w
    join private.integration_connections n on n.id=w.connection_id
    join private.integration_credentials c on c.id=w.credential_id and c.connection_id=n.id
    where w.connection_id=p_connection_id and w.claim_id=p_claim_id
      and w.outcome='pending' and w.lease_until>clock_timestamp()+interval '60 seconds'
      and n.status='disconnecting' and c.status='revoked' and c.provider_revocation_status='pending'
      and c.credential_version=w.credential_version);
end;
$function$;

create function public.complete_qbo_customer_disconnect_v1(p_claim_id uuid,p_connection_id uuid,p_outcome text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare w private.integration_qbo_customer_disconnect_work; c private.integration_credentials; v_command jsonb;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if p_outcome not in ('succeeded','failed','deferred') then raise exception 'qbo_customer_disconnect_invalid' using errcode='22023'; end if;
  select * into w from private.integration_qbo_customer_disconnect_work where connection_id=p_connection_id for update;
  if not found or w.claim_id<>p_claim_id then raise exception 'qbo_customer_disconnect_stale' using errcode='40001'; end if;
  if w.outcome<>'pending' then
    return jsonb_build_object('disconnected',w.outcome='succeeded','providerOutcome',w.outcome,'idempotent',true);
  end if;
  if w.lease_until<=clock_timestamp() then raise exception 'qbo_customer_disconnect_stale' using errcode='40001'; end if;
  select * into c from private.integration_credentials where id=w.credential_id for update;
  if c.connection_id<>w.connection_id or c.credential_version<>w.credential_version or c.status<>'revoked' then
    raise exception 'qbo_customer_disconnect_stale' using errcode='40001';
  end if;
  v_command:=jsonb_build_object('workspaceId',c.workspace_id,'businessEntityId',c.business_entity_id,
    'connectionId',c.connection_id,'connectionGeneration',c.connection_generation,
    'credentialId',c.id,'expectedCredentialVersion',c.credential_version);
  if p_outcome='succeeded' then
    perform public.complete_integration_credential_revocation_v1(v_command||jsonb_build_object(
      'outcome',p_outcome,'completedAt',clock_timestamp()),'qbo_revoke_complete_'||p_claim_id::text);
    perform public.destroy_integration_credential_v1(v_command||jsonb_build_object(
      'reasonCode','local_destruction','destroyedAt',clock_timestamp()),'qbo_revoke_destroy_'||p_claim_id::text);
  else
    -- Local revocation remains authoritative. Retain ciphertext exclusively for
    -- this fenced provider-revocation claim; never restore task/read authority.
    perform private.phase_5_insert_audit_v1(c.workspace_id,c.business_entity_id,c.connection_id,
      'service','integration_credential_broker','credential_revocation','failed','integration_credential',c.id::text,
      'qbo_revoke_attempt_'||p_claim_id::text,'provider_transient',
      jsonb_build_object('connection_generation',c.connection_generation,'connection_status','disconnecting',
        'credential_status','revoked','credential_version',c.credential_version,'revocation_state','pending'),clock_timestamp());
  end if;
  update private.integration_qbo_customer_disconnect_work set outcome=p_outcome,
    lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() where connection_id=w.connection_id;
  return jsonb_build_object('disconnected',p_outcome='succeeded','providerOutcome',p_outcome,'idempotent',false);
end;
$function$;

revoke all on function private.qbo_customer_require_owner_v1(uuid,uuid,uuid,uuid,boolean),
  private.qbo_customer_bind_session_v1(),private.qbo_customer_connection_owner_guard_v1(),
  private.qbo_customer_credential_store_guard_v1(),private.qbo_customer_authorization_work_guard_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.begin_qbo_customer_authorization_v1(uuid,text),
  public.read_qbo_customer_authorization_completion_v1(uuid),
  public.finish_qbo_customer_authorization_v1(uuid,text),
  public.claim_qbo_customer_disconnect_v1(text),public.authorize_qbo_customer_revocation_v1(uuid,uuid),
  public.complete_qbo_customer_disconnect_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.deny_qbo_customer_authorization_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.deny_qbo_customer_authorization_v1(text,text,text) to integration_oauth_ingress_authority;
grant execute on function public.begin_qbo_customer_authorization_v1(uuid,text),
  public.read_qbo_customer_authorization_completion_v1(uuid),
  public.finish_qbo_customer_authorization_v1(uuid,text),
  public.claim_qbo_customer_disconnect_v1(text),public.authorize_qbo_customer_revocation_v1(uuid,uuid),
  public.complete_qbo_customer_disconnect_v1(uuid,uuid,text)
  to integration_credential_broker_authority;

commit;
