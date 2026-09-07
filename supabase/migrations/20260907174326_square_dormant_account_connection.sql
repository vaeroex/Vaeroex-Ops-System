-- Dormant account lifecycle. No configuration, memberships, remote application,
-- provider request, registration or purge is installed by this migration.
begin;

do $roles$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='square_account_broker_authority') then
    create role square_account_broker_authority nologin noinherit;
  end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='square_verified_enrollment_authority') then
    create role square_verified_enrollment_authority nologin noinherit;
  end if;
end;
$roles$;
revoke square_account_broker_authority,square_verified_enrollment_authority
  from anon,authenticated,service_role,external_integrations_authority,
    integration_control_plane_authority,integration_provider_runtime_authority,
    integration_provider_source_authority,integration_credential_broker_authority,
    square_ingestion_runtime_authority,square_ingestion_qualification_admin;
grant usage on schema public to square_account_broker_authority,square_verified_enrollment_authority;
revoke all on schema private from square_account_broker_authority,square_verified_enrollment_authority;

create table private.square_account_configuration (
  environment text not null check(environment in ('sandbox','production')),
  application_id text not null check(length(application_id) between 8 and 512),
  redirect_uri text not null check(length(redirect_uri) between 12 and 2048 and redirect_uri ~ '^https://[^?#]+$'),
  broker_login name not null,
  enrollment_login name not null,
  webhook_login name not null,
  kms_key_resource text not null,
  surface_enabled boolean not null default false,
  enrollment_enabled boolean not null default false,
  blocked boolean not null default false,
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  retention_policy_version text,
  retention_approval_fingerprint text check(retention_approval_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  source_retention_seconds integer check(source_retention_seconds>0),
  cursor_retention_seconds integer check(cursor_retention_seconds between 1 and 3600),
  revocation_access_policy text check(revocation_access_policy='deny_source_access'),
  primary key(environment,application_id)
);

create table private.square_account_connections (
  connection_id uuid primary key,
  workspace_id uuid not null,
  business_entity_id uuid not null,
  environment text not null,
  application_id text not null,
  merchant_id text,
  generation bigint not null check(generation between 1 and 9007199254740991),
  row_version bigint not null check(row_version between 1 and 9007199254740991),
  state text not null check(state in ('authorization_required','mapping_required','authorized','reauthorization_required','disconnecting','disconnected','revoked','recovery_required')),
  authorization_operation text not null check(authorization_operation in ('connect','reauthorize')),
  initiating_actor uuid not null,
  initiating_session uuid not null,
  credential_id uuid,
  credential_version bigint,
  discovery jsonb,
  mapped_locations jsonb not null default '[]',
  mapping_actor uuid,
  mapping_session uuid,
  authorization_issued_at timestamptz,
  revoked_before timestamptz,
  refresh_lease jsonb,
  refresh_attempts integer not null default 0 check(refresh_attempts between 0 and 3),
  refresh_not_before timestamptz,
  revocation_pending boolean not null default false,
  revocation_attempts integer not null default 0 check(revocation_attempts between 0 and 3),
  revocation_not_before timestamptz,
  revocation_lease_id uuid,
  revocation_lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key(workspace_id,business_entity_id) references public.business_entities(workspace_id,id) on delete restrict,
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict,
  unique(workspace_id,business_entity_id,connection_id)
);
create index square_account_connections_workspace_idx on private.square_account_connections(workspace_id,connection_id);
create index square_account_connections_merchant_idx on private.square_account_connections(environment,application_id,merchant_id,connection_id);

create table private.square_account_oauth_states (
  state_id uuid primary key,
  state_hash text not null unique check(state_hash ~ '^sha256:[a-f0-9]{64}$'),
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  generation bigint not null,
  connection_row_version bigint not null,
  actor_id uuid not null,
  session_id uuid not null,
  operation text not null check(operation in ('connect','reauthorize')),
  redirect_uri text not null,
  command jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  status text not null check(status in ('pending','exchanging','stored','denied','uncertain','cancelled')),
  created_at timestamptz not null
);
create index square_account_states_connection_idx on private.square_account_oauth_states(connection_id,state_id);

create table private.square_account_credentials (
  credential_id uuid not null,
  credential_version bigint not null check(credential_version between 1 and 9007199254740991),
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  generation bigint not null,
  oauth_state_id uuid not null references private.square_account_oauth_states(state_id) on delete restrict,
  ciphertext_base64 text not null check(length(ciphertext_base64) between 16 and 131072 and ciphertext_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  aad_context jsonb not null,
  aad_digest text not null check(aad_digest ~ '^sha256:[a-f0-9]{64}$'),
  kms_key_resource text not null,
  access_expires_at timestamptz not null,
  provider_issued_at timestamptz not null,
  granted_scopes jsonb not null,
  external_entity_fingerprint text not null check(external_entity_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  command_fingerprint text not null,
  created_at timestamptz not null,
  primary key(credential_id,credential_version),
  check(access_expires_at=provider_issued_at+interval '24 hours')
);
create index square_account_credentials_connection_idx on private.square_account_credentials(connection_id,generation,credential_id,credential_version);
create trigger square_account_credential_history_immutable before update or delete
  on private.square_account_credentials for each row execute function private.protect_square_authority_history_v1();

create table private.square_account_credential_reads (
  evidence_id uuid primary key,
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  task_id uuid not null references private.square_ingestion_tasks(task_id) on delete restrict,
  credential_id uuid not null,
  credential_version bigint not null,
  reader_login name not null,
  diagnostic_class text,
  failed_at timestamptz,
  created_at timestamptz not null
);
create index square_account_credential_reads_connection_idx on private.square_account_credential_reads(connection_id,evidence_id);

create table private.square_account_audit_events (
  event_id uuid primary key,
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  actor_id uuid not null,
  event_kind text not null check(event_kind in ('audit','refresh_boundary')),
  action text not null,
  outcome text not null,
  reason_code text not null,
  event_fingerprint text not null,
  recorded_at timestamptz not null,
  unique(connection_id,event_fingerprint)
);
create trigger square_account_audit_history_immutable before update or delete
  on private.square_account_audit_events for each row execute function private.protect_square_authority_history_v1();

create table private.square_account_enrollments (
  connection_id uuid not null references private.square_account_connections(connection_id) on delete restrict,
  generation bigint not null,
  credential_id uuid not null,
  discovery_fingerprint text not null,
  retention_policy_version text not null,
  retention_approval_fingerprint text not null,
  source_retention_seconds integer not null,
  cursor_retention_seconds integer not null,
  revocation_access_policy text not null,
  confirmed_by uuid not null,
  confirmed_session uuid not null,
  enrolled_by name not null,
  enrolled_at timestamptz not null,
  primary key(connection_id,generation)
);
create trigger square_account_enrollment_history_immutable before update or delete
  on private.square_account_enrollments for each row execute function private.protect_square_authority_history_v1();

create table private.square_account_revocation_events (
  environment text not null,
  application_id text not null,
  event_id text not null check(length(event_id) between 1 and 128),
  event_fingerprint text not null check(event_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  merchant_id text not null,
  revoked_at timestamptz not null,
  received_at timestamptz not null,
  primary key(environment,application_id,event_id),
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict
);
create trigger square_account_revocation_history_immutable before update or delete
  on private.square_account_revocation_events for each row execute function private.protect_square_authority_history_v1();

-- An append-only capacity latch avoids upgrading the shared configuration lock
-- after taking connection locks. Overflow fails all authority closed; no receipt
-- eviction, history deletion or configuration-policy mutation is implied.
create table private.square_account_capacity_blocks (
  environment text not null,
  application_id text not null,
  blocked_at timestamptz not null,
  primary key(environment,application_id),
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict
);
create trigger square_account_capacity_block_immutable before update or delete
  on private.square_account_capacity_blocks for each row execute function private.protect_square_authority_history_v1();

create function private.square_account_scopes_v1() returns jsonb
language sql immutable set search_path='' as $fn$
  select '["INVENTORY_READ","ITEMS_READ","MERCHANT_PROFILE_READ","ORDERS_READ","PAYMENTS_READ"]'::jsonb;
$fn$;

create function private.square_account_configuration_v1(p_context jsonb,p_manage boolean default true,p_enrollment boolean default false)
returns private.square_account_configuration language plpgsql security invoker set search_path='' as $fn$
declare v_config private.square_account_configuration;v_role text;v_now timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,case when p_enrollment then 'square_verified_enrollment_authority' else 'square_account_broker_authority' end,'MEMBER')
    or p_context is null or pg_catalog.pg_column_size(p_context)>8192
    or not private.jsonb_has_exact_keys_v1(p_context,array['actor','environment','applicationId','redirectUri'])
    or not private.jsonb_has_exact_keys_v1(p_context->'actor',array['actorId','workspaceId','sessionId','role']) then
    raise exception using errcode='42501',message='square_account_denied';
  end if;
  select * into v_config from private.square_account_configuration
    where environment=p_context->>'environment' and application_id=p_context->>'applicationId' for share;
  v_now:=pg_catalog.clock_timestamp();
  if not found or not v_config.surface_enabled or v_config.blocked or v_config.approval_expires_at<=v_now
    or exists(select 1 from private.square_account_capacity_blocks where environment=v_config.environment and application_id=v_config.application_id)
    or (case when p_enrollment then v_config.enrollment_login else v_config.broker_login end) is distinct from session_user::name
    or v_config.redirect_uri is distinct from p_context->>'redirectUri' then
    raise exception using errcode='42501',message='square_account_gate_closed';
  end if;
  select m.role into v_role from public.workspace_members m
    join auth.sessions s on s.user_id=m.user_id and s.id=(p_context#>>'{actor,sessionId}')::uuid
    join auth.users u on u.id=m.user_id
    where m.workspace_id=(p_context#>>'{actor,workspaceId}')::uuid
      and m.user_id=(p_context#>>'{actor,actorId}')::uuid and m.status='active'
      and (s.not_after is null or s.not_after>v_now) for share of m,s;
  if not found or v_role is distinct from p_context#>>'{actor,role}'
    or p_manage and v_role not in ('owner','admin','manager') then
    raise exception using errcode='42501',message='square_account_actor_denied';
  end if;
  return v_config;
end;
$fn$;

create function public.square_account_connection_v1(p_context jsonb,p_operation text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_config private.square_account_configuration;v_account private.square_account_connections;
  v_state private.square_account_oauth_states;v_credential private.square_account_credentials;
  v_now timestamptz;v_command jsonb;v_discovery jsonb;v_aad jsonb;v_hash text;v_locations jsonb;v_count bigint;
  v_connection_id uuid;v_expiry timestamptz;v_scope jsonb;v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;
  v_merchant text;v_id uuid;v_read private.square_account_credential_reads;
begin
  v_config:=private.square_account_configuration_v1(p_context,p_operation<>'status');
  if p_command is null or pg_catalog.pg_column_size(p_command)>2097152 then
    raise exception using errcode='22023',message='square_account_command_invalid';
  end if;
  -- Workspace management has no capability to initiate or complete a provider-
  -- wide revocation. Those mutations are not part of customer disconnect.
  if p_operation in ('acquire_revocation','complete_revocation') then
    raise exception using errcode='42501',message='square_account_operation_denied';
  end if;
  v_now:=pg_catalog.clock_timestamp();
  if p_operation='status' then
    if p_command<>'{}'::jsonb then raise exception using errcode='22023',message='square_account_command_invalid';end if;
    return pg_catalog.jsonb_build_object(
      'canManage',p_context#>>'{actor,role}' in ('owner','admin','manager'),
      'businessEntities',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'label',display_name) order by id),'[]'::jsonb)
        from (select id,display_name from public.business_entities where workspace_id=(p_context#>>'{actor,workspaceId}')::uuid and status='active' order by id limit 1000) as e),
      'connections',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'connectionId',connection_id,'businessEntityId',business_entity_id,'state',state,'sellerLabel',discovery->'merchantLabel',
        'locations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',value->>'id','label',value->>'label') order by value->>'id') from pg_catalog.jsonb_array_elements(discovery->'locations') where value->>'status'='ACTIVE'),'[]'::jsonb),
        'mappedLocationIds',mapped_locations,'retentionApproved',private.square_account_retention_v1(v_config),'revocationPending',revocation_pending) order by connection_id),'[]'::jsonb)
        from private.square_account_connections where workspace_id=(p_context#>>'{actor,workspaceId}')::uuid and environment=v_config.environment and application_id=v_config.application_id));
  end if;

  if p_operation='prepare' then
    if not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','businessEntityId','operation'])
      or p_command->>'operation' not in ('connect','reauthorize') then raise exception using errcode='22023',message='square_account_command_invalid';end if;
    v_connection_id:=(p_command->>'connectionId')::uuid;
    perform 1 from public.workspaces where id=(p_context#>>'{actor,workspaceId}')::uuid for update;
    perform 1 from public.business_entities where workspace_id=(p_context#>>'{actor,workspaceId}')::uuid and id=(p_command->>'businessEntityId')::uuid and status='active' for share;
    if not found then raise exception using errcode='42501',message='square_account_entity_denied';end if;
    if p_command->>'operation'='connect' then
      if (select count(*) from private.square_account_connections where workspace_id=(p_context#>>'{actor,workspaceId}')::uuid)>=32 then
        raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
      insert into private.square_account_connections(connection_id,workspace_id,business_entity_id,environment,application_id,generation,row_version,state,authorization_operation,initiating_actor,initiating_session,created_at,updated_at)
        values(v_connection_id,(p_context#>>'{actor,workspaceId}')::uuid,(p_command->>'businessEntityId')::uuid,v_config.environment,v_config.application_id,1,1,'authorization_required','connect',(p_context#>>'{actor,actorId}')::uuid,(p_context#>>'{actor,sessionId}')::uuid,v_now,v_now)
        returning * into v_account;
    else
      v_account:=private.lock_square_account_v1(p_context,v_connection_id);
      if v_account.business_entity_id<>(p_command->>'businessEntityId')::uuid or v_account.revocation_pending or v_account.generation>=128 then
        raise exception using errcode='42501',message='square_account_reauthorization_denied';end if;
      update private.square_connections set state='revoked',revoked_at=v_now,revocation_reason='generation_replaced',updated_at=v_now where connection_id=v_connection_id;
      update private.square_account_oauth_states set status='cancelled' where connection_id=v_connection_id and status in ('pending','exchanging');
      update private.square_account_connections set generation=generation+1,row_version=row_version+1,state='authorization_required',authorization_operation='reauthorize',
        initiating_actor=(p_context#>>'{actor,actorId}')::uuid,initiating_session=(p_context#>>'{actor,sessionId}')::uuid,
        refresh_lease=null,refresh_attempts=0,refresh_not_before=null,mapped_locations='[]',mapping_actor=null,mapping_session=null,updated_at=v_now
        where connection_id=v_connection_id returning * into v_account;
    end if;
    return pg_catalog.jsonb_build_object('connectionId',v_account.connection_id,'businessEntityId',v_account.business_entity_id,'generation',v_account.generation,'rowVersion',v_account.row_version);
  end if;

  if p_operation in ('lookup_state','consume_state','deny_state') then
    select * into v_state from private.square_account_oauth_states where state_hash=p_command->>'stateHash';
    if not found then return pg_catalog.jsonb_build_object('accepted',false,'reasonCode','state_missing');end if;
    v_connection_id:=v_state.connection_id;
  elsif p_operation in ('store_credential','create_state') then
    v_command:=case when p_operation='store_credential' then p_command->'command' else p_command end;
    v_connection_id:=(v_command->>'connectionId')::uuid;
  elsif p_operation='read_failure' then
    select * into v_read from private.square_account_credential_reads where evidence_id=(p_command->>'credentialReadEvidenceId')::uuid;
    if not found or v_read.reader_login is distinct from session_user::name then raise exception using errcode='42501',message='square_account_credential_denied';end if;
    v_connection_id:=v_read.connection_id;
  elsif p_operation='read_credential' then
    select * into v_task from private.square_ingestion_tasks where task_id=(p_command->>'taskId')::uuid;
    if not found then raise exception using errcode='42501',message='square_account_credential_denied';end if;
    v_connection_id:=v_task.connection_id;
  else v_connection_id:=(p_command->>'connectionId')::uuid;
  end if;
  -- Only verified credential storage shares the authenticated provider-event
  -- merchant lock. Customer disconnect and refresh failures never traverse peers.
  if p_operation='store_credential' then
    v_merchant:=p_command#>>'{discovery,merchantId}';
    if v_merchant is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_config.environment||':'||v_config.application_id||':'||v_merchant,0));end if;
  end if;
  v_account:=private.lock_square_account_v1(p_context,v_connection_id);
  v_now:=pg_catalog.clock_timestamp();
  if v_config.approval_expires_at<=v_now then raise exception using errcode='42501',message='square_account_gate_closed';end if;

  if p_operation='create_state' then
    if not private.jsonb_has_exact_keys_v1(p_command,array['contractVersion','id','workspaceId','businessEntityId','connectionId','connectionGeneration','providerKey','providerEnvironment','initiatedBy','requestedScopes','returnIntent','stateHash','createdAt','expiresAt'])
      or p_command->>'contractVersion'<>'integration_oauth_state_v1'
      or p_command->>'providerKey'<>'square' or p_command->>'providerEnvironment'<>v_account.environment
      or (p_command->>'workspaceId')::uuid<>v_account.workspace_id or (p_command->>'businessEntityId')::uuid<>v_account.business_entity_id
      or (p_command->>'connectionGeneration')::bigint<>v_account.generation
      or (p_command->>'initiatedBy')::uuid<>v_account.initiating_actor
      or v_account.initiating_actor<>(p_context#>>'{actor,actorId}')::uuid or v_account.initiating_session<>(p_context#>>'{actor,sessionId}')::uuid
      or v_account.state<>'authorization_required' or p_command->'requestedScopes'<>private.square_account_scopes_v1()
      or p_command->>'returnIntent'<>'/app/settings/integrations/square' or p_command->>'stateHash' !~ '^sha256:[a-f0-9]{64}$'
      or (p_command->>'expiresAt')::timestamptz<=v_now or (p_command->>'expiresAt')::timestamptz>v_now+interval '10 minutes'
      then raise exception using errcode='42501',message='square_account_state_denied';end if;
    if (select count(*) from private.square_account_oauth_states where connection_id=v_connection_id)>=128 then raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
    if exists(select 1 from private.square_account_oauth_states where connection_id=v_connection_id and generation=v_account.generation) then raise exception using errcode='23505',message='square_account_state_exists';end if;
    insert into private.square_account_oauth_states(state_id,state_hash,connection_id,generation,connection_row_version,actor_id,session_id,operation,redirect_uri,command,expires_at,status,created_at)
      values((p_command->>'id')::uuid,p_command->>'stateHash',v_account.connection_id,v_account.generation,v_account.row_version,v_account.initiating_actor,v_account.initiating_session,v_account.authorization_operation,v_config.redirect_uri,p_command,least((p_command->>'expiresAt')::timestamptz,v_config.approval_expires_at),'pending',v_now);
    return pg_catalog.jsonb_build_object('stateId',p_command->>'id','idempotent',false);
  end if;

  if p_operation in ('lookup_state','consume_state','deny_state') then
    select * into strict v_state from private.square_account_oauth_states where state_hash=p_command->>'stateHash' for update;
    if v_state.actor_id<>(p_context#>>'{actor,actorId}')::uuid or v_state.session_id<>(p_context#>>'{actor,sessionId}')::uuid
      or v_state.redirect_uri<>v_config.redirect_uri or v_state.generation<>v_account.generation or v_state.connection_row_version<>v_account.row_version then
      return pg_catalog.jsonb_build_object('accepted',false,'reasonCode','state_invalid');end if;
    if v_state.expires_at<=v_now then return pg_catalog.jsonb_build_object('accepted',false,'reasonCode','state_expired');end if;
    if v_state.status<>'pending' then return pg_catalog.jsonb_build_object('accepted',false,'reasonCode','state_replayed');end if;
    if p_operation='lookup_state' then return pg_catalog.jsonb_build_object('accepted',true,'command',v_state.command,'rowVersion',v_state.connection_row_version);end if;
    if p_operation='deny_state' then
      update private.square_account_oauth_states set status='denied',consumed_at=v_now where state_id=v_state.state_id;
      update private.square_account_connections set state='reauthorization_required',updated_at=v_now where connection_id=v_connection_id;
      return pg_catalog.jsonb_build_object('accepted',true);
    end if;
    if p_command-array['consumedAt'] is distinct from v_state.command-array['contractVersion','id','createdAt','expiresAt'] then
      return pg_catalog.jsonb_build_object('accepted',false,'reasonCode','state_invalid');end if;
    update private.square_account_oauth_states set status='exchanging',consumed_at=v_now where state_id=v_state.state_id;
    return (v_state.command-array['contractVersion','id','createdAt','expiresAt','initiatedBy','stateHash'])
      ||pg_catalog.jsonb_build_object('accepted',true,'stateId',v_state.state_id,'consumedAt',v_now);
  end if;

  if p_operation='store_credential' then
    v_discovery:=p_command->'discovery';v_command:=p_command->'command';
    select * into v_state from private.square_account_oauth_states where state_id=(v_command->>'oauthStateId')::uuid for update;
    if not found or v_state.connection_id<>v_account.connection_id or v_state.generation<>v_account.generation
      or v_state.actor_id<>(p_context#>>'{actor,actorId}')::uuid or v_state.session_id<>(p_context#>>'{actor,sessionId}')::uuid
      or v_state.connection_row_version<>v_account.row_version or v_state.status not in ('exchanging','stored') then raise exception using errcode='42501',message='square_account_callback_fenced';end if;
    v_hash:=private.square_page_hash_v1(p_command);
    select * into v_credential from private.square_account_credentials where oauth_state_id=v_state.state_id and credential_version=1;
    if found then
      if v_credential.command_fingerprint<>v_hash then raise exception using errcode='23505',message='square_account_receipt_conflict';end if;
      return private.square_account_credential_result_v1(v_credential,v_account.state,true);
    end if;
    -- A signed revocation spanning an unverified callback is inconclusive even
    -- if its held code later yields a newly issued token. Require fresh state;
    -- do not assume Square invalidates every outstanding authorization code.
    if v_state.expires_at<=v_now or v_account.state<>'authorization_required'
      or v_account.revocation_pending or v_account.revoked_before>=v_state.created_at
      or exists(select 1 from private.square_account_revocation_events where environment=v_config.environment and application_id=v_config.application_id
        and merchant_id=v_discovery->>'merchantId' and (revoked_at>=v_state.created_at
          or revoked_at>=(v_command->>'accessExpiresAt')::timestamptz-interval '24 hours'))
      or (v_command->>'workspaceId')::uuid<>v_account.workspace_id or (v_command->>'businessEntityId')::uuid<>v_account.business_entity_id
      or (v_command->>'connectionGeneration')::bigint<>v_account.generation or (v_command->>'expectedConnectionRowVersion')::bigint<>v_account.row_version
      or v_command->>'providerKey'<>'square' or v_command->>'providerEnvironment'<>v_config.environment
      or v_command->'grantedScopes'<>private.square_account_scopes_v1() or v_command->'refreshExpiresAt'<>'null'::jsonb
      or v_command->>'kmsKeyResource'<>v_config.kms_key_resource or (v_command->>'accessExpiresAt')::timestamptz<=v_now
      or abs(extract(epoch from ((v_command->>'accessExpiresAt')::timestamptz-interval '24 hours'-v_now)))>120
      or not private.jsonb_has_exact_keys_v1(v_discovery,array['contractVersion','environment','applicationId','merchantId','merchantLabel','defaultLocationId','locations','verifiedAt','fingerprint'])
      or v_discovery->>'contractVersion'<>'square_verified_discovery_v1' or v_discovery->>'environment'<>v_config.environment or v_discovery->>'applicationId'<>v_config.application_id
      or v_discovery->>'merchantId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
      or v_account.merchant_id is not null and v_account.merchant_id<>v_discovery->>'merchantId'
      or pg_catalog.jsonb_typeof(v_discovery->'locations')<>'array' or pg_catalog.jsonb_array_length(v_discovery->'locations') not between 1 and 500
      or v_discovery->>'fingerprint' !~ '^sha256:[a-f0-9]{64}$'
      or v_command->>'externalEntityReferenceFingerprint'<>private.square_page_hash_v1(pg_catalog.jsonb_build_object('fingerprintPurpose','provider_authorized_entity_reference','fingerprintVersion','provider_authorized_entity_reference_fingerprint_v1','value',v_discovery->>'merchantId'))
      then raise exception using errcode='42501',message='square_account_verification_denied';end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(v_discovery->'locations') where not private.jsonb_has_exact_keys_v1(value,array['id','label','status'])
      or value->>'id' !~ '^[A-Za-z0-9._:-]{1,100}$' or length(value->>'label') not between 1 and 255 or value->>'status' not in ('ACTIVE','INACTIVE'))
      or (select count(distinct value->>'id') from pg_catalog.jsonb_array_elements(v_discovery->'locations'))<>pg_catalog.jsonb_array_length(v_discovery->'locations')
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_discovery->'locations') where value->>'id'=v_discovery->>'defaultLocationId') then raise exception using errcode='42501',message='square_account_discovery_denied';end if;
    v_aad:=pg_catalog.jsonb_build_object('schemaVersion','oauth_credential_aad_v1','purpose','provider_oauth_credential','environment',v_config.environment,
      'workspaceId',v_account.workspace_id,'connectionId',v_account.connection_id,'connectionGeneration',v_account.generation,'providerKey','square','credentialId',v_command->>'id');
    if v_command->>'aadDigest'<>private.square_page_hash_v1(v_aad) then raise exception using errcode='42501',message='square_account_aad_denied';end if;
    if (select count(*) from private.square_account_credentials where connection_id=v_connection_id)>=512 then raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
    insert into private.square_account_credentials(credential_id,credential_version,connection_id,generation,oauth_state_id,ciphertext_base64,aad_context,aad_digest,kms_key_resource,access_expires_at,provider_issued_at,granted_scopes,external_entity_fingerprint,command_fingerprint,created_at)
      values((v_command->>'id')::uuid,1,v_connection_id,v_account.generation,v_state.state_id,v_command->>'ciphertextBase64',v_aad,v_command->>'aadDigest',v_config.kms_key_resource,
        (v_command->>'accessExpiresAt')::timestamptz,(v_command->>'accessExpiresAt')::timestamptz-interval '24 hours',v_command->'grantedScopes',v_command->>'externalEntityReferenceFingerprint',v_hash,v_now)
      returning * into v_credential;
    update private.square_account_connections set merchant_id=v_discovery->>'merchantId',discovery=v_discovery,state='mapping_required',credential_id=v_credential.credential_id,credential_version=1,
      mapped_locations='[]',mapping_actor=null,mapping_session=null,authorization_issued_at=v_credential.provider_issued_at,updated_at=v_now where connection_id=v_connection_id;
    update private.square_account_oauth_states set status='stored' where state_id=v_state.state_id;
    return private.square_account_credential_result_v1(v_credential,'mapping_required',false);
  end if;

  if p_operation='authorization_failed' then
    if not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','connectionGeneration','oauthStateId'])
      or (p_command->>'connectionGeneration')::bigint is distinct from v_account.generation
      or not exists(select 1 from private.square_account_oauth_states where state_id=(p_command->>'oauthStateId')::uuid
        and connection_id=v_connection_id and generation=v_account.generation and status='exchanging'
        and actor_id=(p_context#>>'{actor,actorId}')::uuid and session_id=(p_context#>>'{actor,sessionId}')::uuid) then
      raise exception using errcode='42501',message='square_account_callback_fenced';end if;
    update private.square_account_oauth_states set status='uncertain' where state_id=(p_command->>'oauthStateId')::uuid;
    if v_account.state='authorization_required' then update private.square_account_connections set state='recovery_required',updated_at=v_now where connection_id=v_connection_id;end if;
    return '{}'::jsonb;
  end if;

  if p_operation='confirm_mapping' then
    if not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','businessEntityId','locationIds','confirmation'])
      or p_command->>'confirmation'<>'map' or (p_command->>'businessEntityId')::uuid<>v_account.business_entity_id
      or v_account.state<>'mapping_required' or v_account.discovery is null or not private.square_account_retention_v1(v_config)
      or pg_catalog.jsonb_typeof(p_command->'locationIds')<>'array' or pg_catalog.jsonb_array_length(p_command->'locationIds') not between 1 and 500
      or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_command->'locationIds') as selected(id)
        where not exists(select 1 from pg_catalog.jsonb_array_elements(v_account.discovery->'locations') where value->>'id'=selected.id and value->>'status'='ACTIVE'))
      or (select count(distinct value) from pg_catalog.jsonb_array_elements_text(p_command->'locationIds'))<>pg_catalog.jsonb_array_length(p_command->'locationIds') then
      raise exception using errcode='42501',message='square_account_mapping_denied';end if;
    select pg_catalog.jsonb_agg(value order by value collate "C") into v_locations from pg_catalog.jsonb_array_elements_text(p_command->'locationIds');
    update private.square_account_connections set mapped_locations=v_locations,mapping_actor=(p_context#>>'{actor,actorId}')::uuid,
      mapping_session=(p_context#>>'{actor,sessionId}')::uuid,updated_at=v_now where connection_id=v_connection_id;
    return pg_catalog.jsonb_build_object('confirmed',true,'generation',v_account.generation);
  end if;

  if p_operation='disconnect' then
    if not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','confirmation']) or p_command->>'confirmation'<>'disconnect' then
      raise exception using errcode='42501',message='square_account_disconnect_denied';end if;
    -- lock_square_account_v1 has already locked this workspace's stable durable
    -- connection before its account row. Fence only that connection's in-flight
    -- work; do not revoke a provider token or alter any shared-seller connection.
    update private.square_connections set state='revoked',revoked_at=v_now,revocation_reason='qualification_revoked',updated_at=v_now where connection_id=v_connection_id;
    update private.square_account_oauth_states set status='cancelled' where connection_id=v_connection_id and status in ('pending','exchanging');
    update private.square_account_connections set state='disconnected',row_version=row_version+1,
      refresh_lease=null,revoked_before=v_now,revocation_pending=false,revocation_attempts=0,revocation_not_before=null,
      revocation_lease_id=null,revocation_lease_expires_at=null,updated_at=v_now where connection_id=v_connection_id;
    return pg_catalog.jsonb_build_object('fenced',true);
  end if;

  if p_operation in ('audit','refresh_boundary') then
    -- Store only fixed broker enums and the authenticated host actor. Omit all
    -- provider payload, free-text actor IDs, diagnostics and credential fields.
    if not coalesce(p_command->>'workspaceId'=v_account.workspace_id::text and p_command->>'businessEntityId'=v_account.business_entity_id::text
      and (case when p_operation='audit' then p_command->>'action' in ('oauth_state_created','oauth_state_consumed','oauth_state_rejected','credential_encrypted','credential_decrypt_attempt','credential_refresh','credential_rotated','credential_revocation','credential_destroyed','reauthorization_required','authorization_failure')
        else p_command->>'stage' in ('broker_decrypt','secret_manager_access','provider_token_request','provider_response_parse','credential_cas') end)
      and p_command->>'outcome' in ('allowed','denied','started','succeeded','failed')
      and p_command->>'reasonCode' in ('authorized','state_missing','state_invalid','state_expired','state_replayed','decrypt_succeeded','decrypt_failed','refresh_succeeded','refresh_lease_held','credential_version_stale','invalid_grant','provider_revoked','scope_loss','provider_transient','credential_expired','kms_failure','integrity_failure','customer_disconnect','local_destruction','started','succeeded'),false) then
      raise exception using errcode='42501',message='square_account_audit_denied';end if;
    v_hash:=private.square_page_hash_v1(p_command);
    select event_id into v_id from private.square_account_audit_events where connection_id=v_connection_id and event_fingerprint=v_hash;
    if found then return pg_catalog.jsonb_build_object('eventId',v_id,'idempotent',true);end if;
    if (select count(*) from private.square_account_audit_events where connection_id=v_connection_id)>=10000 then raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
    v_id:=pg_catalog.gen_random_uuid();
    insert into private.square_account_audit_events values(v_id,v_connection_id,(p_context#>>'{actor,actorId}')::uuid,p_operation,
      coalesce(p_command->>'action',p_command->>'stage'),p_command->>'outcome',p_command->>'reasonCode',v_hash,v_now);
    return pg_catalog.jsonb_build_object('eventId',v_id,'idempotent',false);
  end if;

  if p_operation in ('credential_metadata','acquire_refresh','rotate_credential','fail_refresh','read_credential','read_failure') then
    select * into v_credential from private.square_account_credentials where credential_id=v_account.credential_id and credential_version=v_account.credential_version;
    if not found then raise exception using errcode='42501',message='square_account_credential_denied';end if;
    if p_operation='credential_metadata' then return pg_catalog.jsonb_build_object('connectionId',v_connection_id,'businessEntityId',v_account.business_entity_id,
      'generation',v_account.generation,'credentialId',v_credential.credential_id,'credentialVersion',v_credential.credential_version);end if;
    if p_operation='read_failure' then
      if not private.jsonb_has_exact_keys_v1(p_command,array['contractVersion','credentialReadEvidenceId','diagnosticClass'])
        or p_command->>'diagnosticClass' !~ '^[a-z_]{1,64}$' then raise exception using errcode='42501',message='square_account_diagnostic_denied';end if;
      update private.square_account_credential_reads set diagnostic_class=coalesce(diagnostic_class,p_command->>'diagnosticClass'),failed_at=coalesce(failed_at,v_now)
        where evidence_id=v_read.evidence_id returning * into v_read;
      return pg_catalog.jsonb_build_object('credentialReadFailureEvidenceId',v_read.evidence_id,'credentialReadEvidenceId',v_read.evidence_id,
        'diagnosticClass',v_read.diagnostic_class,'failedAt',v_read.failed_at,'idempotent',false);
    end if;
    if p_operation='read_credential' then
      v_task:=private.lock_square_ingestion_authority_v1((p_command->>'taskId')::uuid,p_command->>'leaseOwnerFingerprint');
      select * into v_scan from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for share;
      v_now:=pg_catalog.clock_timestamp();
      -- The generic broker's lease field is a UUID, whereas Square's immutable
      -- page lease is a SHA-256 fingerprint. Compare a purpose-separated UUID
      -- representation computed from the CURRENT trusted full lease; never treat
      -- a supplied UUID as lease evidence. Runtime LOGIN/task/owner/generation
      -- and the complete stored page lease remain the authority.
      v_hash:=substring(private.square_page_hash_v1(pg_catalog.jsonb_build_object(
        'fingerprintPurpose','square_credential_read_lease_reference',
        'fingerprintVersion','square_credential_read_lease_reference_v1',
        'durableLeaseFingerprint',v_scan.lease->>'leaseId')) from 8);
      if not found or v_scan.status is distinct from 'leased' or v_scan.lease is null
        or v_scan.lease_task_id is distinct from v_task.task_id
        or (substring(v_hash from 1 for 8)||'-'||substring(v_hash from 9 for 4)||'-8'||substring(v_hash from 14 for 3)||'-8'||substring(v_hash from 18 for 3)||'-'||substring(v_hash from 21 for 12)) is distinct from p_command->>'leaseId'
        or not coalesce((v_scan.lease->>'expiresAt')::bigint>private.square_page_ms_v1(v_now),false) or v_account.state<>'authorized'
        or v_account.generation<>v_task.connection_generation or p_command->'requiredScopes' is distinct from private.square_account_scopes_v1() then
        raise exception using errcode='42501',message='square_account_credential_denied';end if;
      if (select count(*) from private.square_account_credential_reads where connection_id=v_connection_id)>=10000 then raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
      v_id:=pg_catalog.gen_random_uuid();
      insert into private.square_account_credential_reads(evidence_id,connection_id,task_id,credential_id,credential_version,reader_login,created_at)
        values(v_id,v_connection_id,v_task.task_id,v_credential.credential_id,v_credential.credential_version,session_user,v_now);
      return pg_catalog.jsonb_build_object('state',case when (p_command->>'expectedCredentialVersion')::bigint<>v_credential.credential_version then 'credential_version_stale'
        when v_credential.access_expires_at<=v_now+interval '1 second'*(p_command->>'minimumValiditySeconds')::integer then 'refresh_required' else 'available' end,
        'credentialId',v_credential.credential_id,'credentialVersion',v_credential.credential_version,'providerKey','square','providerEnvironment',v_account.environment,'accessExpiresAt',v_credential.access_expires_at)
        ||case when (p_command->>'expectedCredentialVersion')::bigint=v_credential.credential_version and v_credential.access_expires_at>v_now+interval '1 second'*(p_command->>'minimumValiditySeconds')::integer then
          pg_catalog.jsonb_build_object('credentialReadEvidenceId',v_id,'ciphertextBase64',v_credential.ciphertext_base64,'ciphertextPersistedAt',v_credential.provider_issued_at,
            'aadDigest',v_credential.aad_digest,'kmsKeyResource',v_credential.kms_key_resource,'aadContext',v_credential.aad_context,'grantedScopes',v_credential.granted_scopes,
            'refreshExpiresAt',null,'externalEntityReferenceFingerprint',v_credential.external_entity_fingerprint) else '{}'::jsonb end;
    end if;
    if v_account.state not in ('mapping_required','authorized') or v_credential.generation<>v_account.generation then
      if p_operation='acquire_refresh' then return pg_catalog.jsonb_build_object('acquired',false,'reasonCode','credential_inactive');end if;
      raise exception using errcode='42501',message='square_account_refresh_fenced';end if;
    if (p_command->>'workspaceId')::uuid<>v_account.workspace_id or (p_command->>'businessEntityId')::uuid<>v_account.business_entity_id
      or (p_command->>'connectionGeneration')::bigint<>v_account.generation or (p_command->>'credentialId')::uuid<>v_credential.credential_id then
      raise exception using errcode='42501',message='square_account_credential_scope_denied';end if;
    if (p_command->>'expectedCredentialVersion')::bigint<>v_credential.credential_version then
      if p_operation='acquire_refresh' then return pg_catalog.jsonb_build_object('acquired',false,'reasonCode','credential_version_stale');end if;
      raise exception using errcode='42501',message='square_account_refresh_fenced';end if;
    if p_operation='acquire_refresh' then
      if v_account.refresh_lease is not null and (v_account.refresh_lease->>'leaseExpiresAt')::timestamptz>v_now
        or v_account.refresh_not_before>v_now then return pg_catalog.jsonb_build_object('acquired',false,'reasonCode','refresh_lease_held');end if;
      if v_account.refresh_attempts>=3 then
        update private.square_account_connections set state='reauthorization_required',refresh_lease=null,updated_at=v_now where connection_id=v_connection_id;
        return pg_catalog.jsonb_build_object('acquired',false,'reasonCode','credential_inactive');end if;
      if (p_command->>'leaseExpiresAt')::timestamptz<=v_now or (p_command->>'leaseExpiresAt')::timestamptz>v_now+interval '120 seconds'
        or p_command->>'leaseOwnerFingerprint' !~ '^sha256:[a-f0-9]{64}$' then raise exception using errcode='42501',message='square_account_refresh_fenced';end if;
      update private.square_account_connections set refresh_lease=p_command,refresh_attempts=refresh_attempts+1,updated_at=v_now where connection_id=v_connection_id;
      return pg_catalog.jsonb_build_object('acquired',true,'credentialId',v_credential.credential_id,'credentialVersion',v_credential.credential_version,
        'ciphertextBase64',v_credential.ciphertext_base64,'aadDigest',v_credential.aad_digest,'kmsKeyResource',v_credential.kms_key_resource,'aadContext',v_credential.aad_context,
        'providerEnvironment',v_account.environment,'grantedScopes',v_credential.granted_scopes,'leaseId',p_command->>'leaseId',
        'leaseOwnerFingerprint',p_command->>'leaseOwnerFingerprint','leaseExpiresAt',p_command->>'leaseExpiresAt');
    end if;
    if v_account.refresh_lease is null or v_account.refresh_lease->>'leaseId'<>p_command->>'leaseId'
      or v_account.refresh_lease->>'leaseOwnerFingerprint'<>p_command->>'leaseOwnerFingerprint'
      or (v_account.refresh_lease->>'leaseExpiresAt')::timestamptz<=v_now then raise exception using errcode='42501',message='square_account_refresh_fenced';end if;
    if p_operation='fail_refresh' then
      if v_account.refresh_attempts>=3 or p_command->>'reasonCode' in ('invalid_grant','scope_loss','credential_binding_invalid','provider_revoked') then
        -- A current leased token failure is evidence only for this connection.
        -- The validated task/credential/generation/lease checks above precede the
        -- local fence; only authenticated provider notifications can fence peers.
        update private.square_connections set state='revoked',revoked_at=v_now,revocation_reason='qualification_revoked',updated_at=v_now where connection_id=v_connection_id;
        update private.square_account_oauth_states set status='cancelled' where connection_id=v_connection_id and status in ('pending','exchanging');
        update private.square_account_connections set state='reauthorization_required',row_version=row_version+1,
          refresh_lease=null,refresh_not_before=null,revoked_before=v_now,updated_at=v_now where connection_id=v_connection_id returning * into v_account;
        return private.square_account_credential_result_v1(v_credential,v_account.state,false);
      end if;
      update private.square_account_connections set refresh_lease=null,refresh_not_before=v_now+interval '5 seconds',updated_at=v_now
        where connection_id=v_connection_id returning * into v_account;
      return private.square_account_credential_result_v1(v_credential,v_account.state,false);
    end if;
    if p_command->'grantedScopes'<>v_credential.granted_scopes or p_command->'refreshExpiresAt'<>'null'::jsonb
      or p_command->>'externalEntityReferenceFingerprint'<>v_credential.external_entity_fingerprint
      or p_command->>'aadDigest'<>v_credential.aad_digest or p_command->>'kmsKeyResource'<>v_credential.kms_key_resource
      or (p_command->>'accessExpiresAt')::timestamptz<=v_now or abs(extract(epoch from ((p_command->>'accessExpiresAt')::timestamptz-interval '24 hours'-v_now)))>120 then
      raise exception using errcode='42501',message='square_account_rotation_denied';end if;
    if (select count(*) from private.square_account_credentials where connection_id=v_connection_id)>=512 then raise exception using errcode='54000',message='square_account_capacity_exhausted';end if;
    insert into private.square_account_credentials(credential_id,credential_version,connection_id,generation,oauth_state_id,ciphertext_base64,aad_context,aad_digest,kms_key_resource,access_expires_at,provider_issued_at,granted_scopes,external_entity_fingerprint,command_fingerprint,created_at)
      values(v_credential.credential_id,v_credential.credential_version+1,v_connection_id,v_account.generation,v_credential.oauth_state_id,p_command->>'ciphertextBase64',v_credential.aad_context,v_credential.aad_digest,v_credential.kms_key_resource,
        (p_command->>'accessExpiresAt')::timestamptz,(p_command->>'accessExpiresAt')::timestamptz-interval '24 hours',v_credential.granted_scopes,v_credential.external_entity_fingerprint,private.square_page_hash_v1(p_command),v_now)
      returning * into v_credential;
    update private.square_account_connections set credential_version=v_credential.credential_version,refresh_lease=null,refresh_attempts=0,refresh_not_before=null,updated_at=v_now where connection_id=v_connection_id;
    return private.square_account_credential_result_v1(v_credential,v_account.state,false);
  end if;

  raise exception using errcode='42501',message='square_account_operation_denied';
end;
$fn$;

create function private.square_account_retention_v1(p_config private.square_account_configuration)
returns boolean language sql stable set search_path='' as $fn$
  select coalesce(p_config.enrollment_enabled and not p_config.blocked
    and not exists(select 1 from private.square_account_capacity_blocks where environment=p_config.environment and application_id=p_config.application_id)
    and p_config.approval_expires_at>pg_catalog.clock_timestamp()
    and p_config.retention_policy_version ~ '^[A-Za-z0-9._:-]{1,200}$'
    and p_config.retention_approval_fingerprint ~ '^sha256:[a-f0-9]{64}$'
    and p_config.source_retention_seconds>0 and p_config.cursor_retention_seconds>0
    and p_config.revocation_access_policy='deny_source_access',false);
$fn$;

create function private.square_account_credential_result_v1(p_credential private.square_account_credentials,p_state text,p_idempotent boolean)
returns jsonb language sql stable set search_path='' as $fn$
  select pg_catalog.jsonb_build_object('credentialId',p_credential.credential_id,'credentialVersion',p_credential.credential_version,
    'credentialStatus',case when p_state in ('revoked','disconnecting','disconnected') then 'revoked' when p_state in ('recovery_required','reauthorization_required') then 'reauthorization_required' else 'active' end,
    'connectionStatus',case when p_state='mapping_required' then 'authorized_unmapped' when p_state='authorized' then 'active' when p_state in ('revoked','disconnected') then 'disconnected' when p_state='disconnecting' then 'disconnecting' else 'reauthorization_required' end,
    'idempotent',p_idempotent);
$fn$;

-- Locking shared with durable ingestion: configuration, stable durable connection,
-- account, state/credential. No provider/secret operation is inside a transaction.
create function private.lock_square_account_v1(p_context jsonb,p_connection_id uuid)
returns private.square_account_connections language plpgsql security invoker set search_path='' as $fn$
declare v_account private.square_account_connections;
begin
  perform 1 from private.square_connections where connection_id=p_connection_id for update;
  select * into v_account from private.square_account_connections where connection_id=p_connection_id for update;
  if not found or v_account.workspace_id is distinct from (p_context#>>'{actor,workspaceId}')::uuid
    or v_account.environment is distinct from p_context->>'environment'
    or v_account.application_id is distinct from p_context->>'applicationId' then
    raise exception using errcode='42501',message='square_account_scope_denied';
  end if;
  perform 1 from public.business_entities where workspace_id=v_account.workspace_id and id=v_account.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_account_entity_denied';end if;
  return v_account;
end;
$fn$;

alter table private.square_connection_generations drop constraint square_connection_generations_identity_mode_check;
alter table private.square_connection_generations add constraint square_connection_generations_identity_mode_check
  check(identity_mode in ('synthetic_local_qualification','oauth_verified'));

create function public.enroll_square_verified_connection_v1(p_context jsonb,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_config private.square_account_configuration;v_account private.square_account_connections;
  v_connection private.square_connections;v_now timestamptz;v_expiry timestamptz;v_location text;v_default text;
begin
  v_config:=private.square_account_configuration_v1(p_context,true,true);
  if p_command is null or pg_catalog.pg_column_size(p_command)>1024 or not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','generation']) then
    raise exception using errcode='42501',message='square_verified_enrollment_denied';end if;
  v_account:=private.lock_square_account_v1(p_context,(p_command->>'connectionId')::uuid);
  v_now:=pg_catalog.clock_timestamp();
  if not private.square_account_retention_v1(v_config) or v_account.state not in ('mapping_required','authorized')
    or (p_command->>'generation')::bigint is distinct from v_account.generation
    or v_account.discovery is null or v_account.merchant_id is null or pg_catalog.jsonb_array_length(v_account.mapped_locations)=0
    or v_account.mapping_actor is distinct from (p_context#>>'{actor,actorId}')::uuid or v_account.mapping_session is distinct from (p_context#>>'{actor,sessionId}')::uuid
    or not exists(select 1 from private.square_account_credentials where credential_id=v_account.credential_id and credential_version=v_account.credential_version
      and generation=v_account.generation and access_expires_at>v_now) then raise exception using errcode='42501',message='square_verified_enrollment_denied';end if;
  if exists(select 1 from private.square_account_enrollments where connection_id=v_account.connection_id and generation=v_account.generation) then
    return pg_catalog.jsonb_build_object('enrolled',true,'generation',v_account.generation,'idempotent',true);end if;
  select * into v_connection from private.square_connections where connection_id=v_account.connection_id for update;
  if found then
    if v_connection.workspace_id<>v_account.workspace_id or v_connection.business_entity_id<>v_account.business_entity_id
      or v_connection.seller_id<>v_account.merchant_id or v_connection.environment<>v_account.environment
      or v_connection.current_generation>=v_account.generation then raise exception using errcode='42501',message='square_verified_identity_denied';end if;
    -- Failed intermediate authorizations need not have durable generations. Each
    -- increment preserves the historical connection trigger's monotonic fence.
    while v_connection.current_generation<v_account.generation loop
      update private.square_connections set current_generation=current_generation+1,
        state=case when current_generation+1=v_account.generation then 'active' else 'revoked' end,
        revoked_at=case when current_generation+1=v_account.generation then null else revoked_at end,
        revocation_reason=case when current_generation+1=v_account.generation then null else revocation_reason end,
        updated_at=v_now where connection_id=v_account.connection_id returning * into v_connection;
    end loop;
  else
    insert into private.square_connections(connection_id,workspace_id,business_entity_id,seller_id,environment,current_generation,state,created_at,updated_at)
      values(v_account.connection_id,v_account.workspace_id,v_account.business_entity_id,v_account.merchant_id,v_account.environment,v_account.generation,'active',v_now,v_now);
  end if;
  v_expiry:=least(v_config.approval_expires_at,v_now+interval '1 second'*v_config.source_retention_seconds);
  v_default:=case when v_account.mapped_locations ? (v_account.discovery->>'defaultLocationId') then v_account.discovery->>'defaultLocationId' else null end;
  insert into private.square_connection_generations(connection_id,connection_generation,workspace_id,business_entity_id,identity_mode,identity_evidence_fingerprint,
    default_location_id,default_discovery_fingerprint,retention_policy_version,retention_approval_fingerprint,retention_expires_at,enrolled_by,enrolled_at)
    values(v_account.connection_id,v_account.generation,v_account.workspace_id,v_account.business_entity_id,'oauth_verified',v_account.discovery->>'fingerprint',
      v_default,case when v_default is null then null else v_account.discovery->>'fingerprint' end,v_config.retention_policy_version,v_config.retention_approval_fingerprint,v_expiry,session_user,v_now);
  for v_location in select value from pg_catalog.jsonb_array_elements_text(v_account.mapped_locations) loop
    insert into private.square_location_mappings(connection_id,connection_generation,workspace_id,business_entity_id,location_id,verification_fingerprint,mapped_by,mapped_at)
      values(v_account.connection_id,v_account.generation,v_account.workspace_id,v_account.business_entity_id,v_location,v_account.discovery->>'fingerprint',session_user,v_now);
  end loop;
  insert into private.square_account_enrollments(connection_id,generation,credential_id,discovery_fingerprint,
    retention_policy_version,retention_approval_fingerprint,source_retention_seconds,cursor_retention_seconds,revocation_access_policy,
    confirmed_by,confirmed_session,enrolled_by,enrolled_at)
    values(v_account.connection_id,v_account.generation,v_account.credential_id,v_account.discovery->>'fingerprint',
      v_config.retention_policy_version,v_config.retention_approval_fingerprint,v_config.source_retention_seconds,v_config.cursor_retention_seconds,v_config.revocation_access_policy,
      v_account.mapping_actor,v_account.mapping_session,session_user,v_now);
  update private.square_account_connections set state='authorized',updated_at=v_now where connection_id=v_account.connection_id;
  return pg_catalog.jsonb_build_object('enrolled',true,'generation',v_account.generation,'idempotent',false);
end;
$fn$;

create function private.assert_square_verified_account_v1(p_connection_id uuid,p_generation bigint,p_enroller boolean default false)
returns void language plpgsql security invoker set search_path='' as $fn$
declare v_account private.square_account_connections;v_config private.square_account_configuration;
begin
  select * into v_account from private.square_account_connections where connection_id=p_connection_id for share;
  if not found or v_account.generation<>p_generation or v_account.state<>'authorized' or v_account.revocation_pending then
    raise exception using errcode='42501',message='square_verified_authority_denied';end if;
  select * into v_config from private.square_account_configuration where environment=v_account.environment and application_id=v_account.application_id for share;
  if not found or not private.square_account_retention_v1(v_config)
    or not exists(select 1 from private.square_account_enrollments where connection_id=p_connection_id and generation=p_generation
      and discovery_fingerprint=v_account.discovery->>'fingerprint' and retention_policy_version=v_config.retention_policy_version
      and retention_approval_fingerprint=v_config.retention_approval_fingerprint and source_retention_seconds=v_config.source_retention_seconds
      and cursor_retention_seconds=v_config.cursor_retention_seconds and revocation_access_policy=v_config.revocation_access_policy)
    or p_enroller and (v_config.enrollment_login is distinct from session_user::name
      or not pg_catalog.pg_has_role(session_user,'square_verified_enrollment_authority','MEMBER')) then
    raise exception using errcode='42501',message='square_verified_authority_denied';end if;
end;
$fn$;

create function private.assert_square_task_mode_v1(p_task private.square_ingestion_tasks)
returns void language plpgsql security invoker set search_path='' as $fn$
declare v_mode text;
begin
  select identity_mode into v_mode from private.square_connection_generations where connection_id=p_task.connection_id and connection_generation=p_task.connection_generation;
  if v_mode='synthetic_local_qualification' then perform private.assert_square_qualification_gate_v1();
  elsif v_mode='oauth_verified' then perform private.assert_square_verified_account_v1(p_task.connection_id,p_task.connection_generation);
  else raise exception using errcode='42501',message='square_task_authority_mode_denied';end if;
end;
$fn$;

create function private.assert_square_verified_task_enroller_v1(p_command jsonb)
returns void language plpgsql security invoker set search_path='' as $fn$
begin
  if not pg_catalog.pg_has_role(session_user,'square_verified_enrollment_authority','MEMBER') or p_command is null or pg_catalog.pg_column_size(p_command)>2097152 then
    raise exception using errcode='42501',message='square_verified_enroller_denied';end if;
  perform private.assert_square_verified_account_v1((p_command->>'connectionId')::uuid,(p_command->>'generation')::bigint,true);
end;
$fn$;

create function private.square_account_cursor_deadline_v1(p_task private.square_ingestion_tasks,p_now timestamptz)
returns bigint language plpgsql security invoker set search_path='' as $fn$
declare v_mode text;v_seconds integer;
begin
  select identity_mode into strict v_mode from private.square_connection_generations
    where connection_id=p_task.connection_id and connection_generation=p_task.connection_generation;
  if v_mode='synthetic_local_qualification' then return private.square_page_ms_v1(p_now)+3600000;end if;
  select cursor_retention_seconds into strict v_seconds from private.square_account_enrollments
    where connection_id=p_task.connection_id and generation=p_task.connection_generation;
  return private.square_page_ms_v1(p_now)+1000::bigint*v_seconds;
end;
$fn$;

create function public.record_square_account_revocation_v1(p_environment text,p_application_id text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_config private.square_account_configuration;v_account private.square_account_connections;v_prior private.square_account_revocation_events;v_now timestamptz;v_id uuid;
begin
  if not pg_catalog.pg_has_role(session_user,'square_account_broker_authority','MEMBER') or p_event is null or pg_catalog.pg_column_size(p_event)>8192 then
    raise exception using errcode='42501',message='square_revocation_event_denied';end if;
  select * into v_config from private.square_account_configuration where environment=p_environment and application_id=p_application_id for share;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_config.webhook_login is distinct from session_user::name or not v_config.surface_enabled
    or p_event->>'environment'<>p_environment or p_event->>'applicationId'<>p_application_id
    or p_event->>'eventId' is null or length(p_event->>'eventId') not between 1 and 128
    or p_event->>'merchantId' !~ '^[A-Za-z0-9._:-]{1,191}$' or p_event->>'eventFingerprint' !~ '^sha256:[a-f0-9]{64}$'
    or (p_event->>'revokedAt')::timestamptz>v_now+interval '60 seconds' then raise exception using errcode='42501',message='square_revocation_event_denied';end if;
  -- The per-app receipt quota must also serialize different merchants; separate
  -- merchant locks alone would let concurrent final-slot inserts exceed it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('square-revocation-receipts:'||p_environment||':'||p_application_id,0));
  -- Event replay and all matching stable connection fences serialize together.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_environment||':'||p_application_id||':'||(p_event->>'merchantId'),0));
  select * into v_prior from private.square_account_revocation_events where environment=p_environment and application_id=p_application_id and event_id=p_event->>'eventId';
  if found then
    if v_prior.event_fingerprint<>p_event->>'eventFingerprint' then raise exception using errcode='23505',message='square_revocation_event_conflict';end if;
    return pg_catalog.jsonb_build_object('accepted',true,'replayed',true);
  end if;
  for v_id in select connection_id from private.square_account_connections where environment=p_environment and application_id=p_application_id and merchant_id=p_event->>'merchantId' order by connection_id loop
    perform 1 from private.square_connections where connection_id=v_id for update;
    select * into strict v_account from private.square_account_connections where connection_id=v_id for update;
    -- Token exchange/refresh after revocation is not evidence of fresh consent.
    -- Use the current credential's original DB-created consent state as well as
    -- original issuance, just as callback storage checks receipts in the reverse
    -- delivery order. Stable connection/account locks serialize state writers;
    -- missing or mismatched evidence cannot exempt the connection from fencing.
    if v_account.authorization_issued_at is null or (p_event->>'revokedAt')::timestamptz>=v_account.authorization_issued_at
      or not exists(select 1 from private.square_account_credentials c
        join private.square_account_oauth_states s on s.state_id=c.oauth_state_id
        where c.credential_id=v_account.credential_id and c.credential_version=v_account.credential_version
          and c.connection_id=v_id and c.generation=v_account.generation
          and s.connection_id=v_id and s.generation=v_account.generation and s.status='stored'
          and s.created_at>(p_event->>'revokedAt')::timestamptz) then
      update private.square_connections set state='revoked',revoked_at=v_now,revocation_reason='qualification_revoked',updated_at=v_now where connection_id=v_id;
      update private.square_account_connections set state='revoked',row_version=row_version+1,revocation_pending=false,refresh_lease=null,updated_at=v_now where connection_id=v_id;
      update private.square_account_oauth_states set status='cancelled' where connection_id=v_id and status in ('pending','exchanging');
    end if;
  end loop;
  if (select count(*) from private.square_account_revocation_events where environment=p_environment and application_id=p_application_id)>=4096 then
    -- Never lose revocation because receipt storage is full. Close every new
    -- enrollment/read gate for the app; no eviction or purge is authorized.
    insert into private.square_account_capacity_blocks values(p_environment,p_application_id,v_now) on conflict do nothing;
    return pg_catalog.jsonb_build_object('accepted',true,'replayed',false);
  end if;
  insert into private.square_account_revocation_events values(p_environment,p_application_id,p_event->>'eventId',p_event->>'eventFingerprint',p_event->>'merchantId',(p_event->>'revokedAt')::timestamptz,v_now);
  return pg_catalog.jsonb_build_object('accepted',true,'replayed',false);
end;
$fn$;

-- Existing validators/atomic SQL preserved; only the explicit authority-mode gates change.
create function public.enroll_square_verified_task_v1(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_grant jsonb := p_command->'grant';
  v_binding jsonb := p_command->'binding';
  v_scope jsonb := p_command#>'{grant,scope}';
  v_now timestamptz;
  v_expiry timestamptz;
  v_locations jsonb;
  v_operation text;
begin
  -- Do not take account locks before the stable durable connection lock below.
  -- Exact configured LOGIN and current verified evidence are checked after it.
  if not pg_catalog.pg_has_role(session_user,'square_verified_enrollment_authority','MEMBER') then
    raise exception using errcode='42501',message='square_verified_enroller_denied';end if;
  if p_command is null or pg_catalog.pg_column_size(p_command)>2097152
    or not private.jsonb_has_exact_keys_v1(p_command,array['taskId','connectionId','generation','runtimeLogin','leaseOwnerFingerprint','grant','binding'])
    or not coalesce((p_command->>'leaseOwnerFingerprint') ~ '^sha256:[a-f0-9]{64}$',false)
    or not coalesce((p_command->>'generation') ~ '^[0-9]{1,16}$',false)
    or pg_catalog.jsonb_typeof(p_command->'generation') is distinct from 'number'
    or not coalesce((p_command->>'runtimeLogin') ~ '^[a-zA-Z0-9_]{1,63}$',false)
    or not (private.jsonb_has_exact_keys_v1(v_grant,array['scope','stream','operation','scanId','request','expiresAt'])
      or private.jsonb_has_exact_keys_v1(v_grant,array['scope','stream','operation','scanId','request','expiresAt','resolvedDefaultLocationId']))
    or not private.jsonb_has_exact_keys_v1(v_scope,array['workspaceId','businessEntityId','connectionId','sellerId','environment','authorizedLocationIds','generation'])
    or not private.jsonb_has_exact_keys_v1(v_grant->'request',array['method','url','body'])
    or not coalesce(v_grant#>>'{request,method}' in ('GET','POST'),false)
    or pg_catalog.jsonb_typeof(v_grant#>'{request,url}') is distinct from 'string'
    or length(v_grant#>>'{request,url}')>16384
    or pg_catalog.jsonb_typeof(v_grant#>'{request,body}') not in ('null','string')
    or coalesce(length(v_grant#>>'{request,body}'),0)>1048576
    or not coalesce((v_grant->>'expiresAt') ~ '^[0-9]{1,16}$',false)
    or pg_catalog.jsonb_typeof(v_grant->'expiresAt') is distinct from 'number'
    or pg_catalog.jsonb_typeof(v_grant->'scanId') is distinct from 'string'
    or not private.jsonb_has_exact_keys_v1(v_binding,array['scanKey','scopeFingerprint','queryFingerprint','cursorBindingFingerprint','generation'])
    or exists (select 1 from pg_catalog.jsonb_each(v_binding) where key<>'generation'
      and (pg_catalog.jsonb_typeof(value)<>'string' or not coalesce((value#>>'{}') ~ '^sha256:[a-f0-9]{64}$',false)))
    or v_binding->'generation' is distinct from p_command->'generation'
    or v_scope->'generation' is distinct from p_command->'generation'
    or pg_catalog.jsonb_typeof(v_scope->'authorizedLocationIds') is distinct from 'array' then
    raise exception using errcode='22023',message='square_qualification_task_invalid';
  end if;
  perform (v_grant->>'scanId')::uuid;
  v_operation := v_grant->>'operation';
  if not coalesce(case v_grant->>'stream'
    when 'order_core' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_line_items' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_adjustments' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'order_tenders' then v_operation in ('retrieve_order','orders_batch_retrieve','orders_search')
    when 'payments' then v_operation in ('list_payments','retrieve_payment')
    when 'refunds' then v_operation in ('list_payment_refunds','retrieve_payment_refund')
    when 'catalog' then v_operation in ('list_catalog','retrieve_catalog_object','catalog_search','catalog_batch_retrieve')
    when 'inventory' then v_operation in ('retrieve_inventory_count','retrieve_inventory_adjustment','retrieve_inventory_physical_count','inventory_counts_batch_retrieve','inventory_changes_batch_retrieve')
    else false end,false) then
    raise exception using errcode='22023',message='square_qualification_task_invalid';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname=p_command->>'runtimeLogin'
    and rolcanlogin and not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb and not rolreplication)
    or not pg_catalog.pg_has_role(p_command->>'runtimeLogin','square_ingestion_runtime_authority','MEMBER')
    or pg_catalog.pg_has_role(p_command->>'runtimeLogin','square_ingestion_qualification_admin','MEMBER') then
    raise exception using errcode='42501',message='square_qualification_runtime_login_denied';
  end if;
  select * into v_connection from private.square_connections
    where connection_id=(p_command->>'connectionId')::uuid for update;
  if not found or v_connection.state<>'active'
    or v_connection.current_generation<>(p_command->>'generation')::bigint
    or v_scope->>'connectionId' is distinct from v_connection.connection_id::text
    or v_scope->>'workspaceId' is distinct from v_connection.workspace_id::text
    or v_scope->>'businessEntityId' is distinct from v_connection.business_entity_id::text
    or v_scope->>'sellerId' is distinct from v_connection.seller_id
    or v_scope->>'environment' is distinct from v_connection.environment then
    raise exception using errcode='42501',message='square_qualification_task_scope_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_connection.connection_id and connection_generation=v_connection.current_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations
    from private.square_location_mappings where connection_id=v_connection.connection_id and connection_generation=v_connection.current_generation;
  if v_scope->'authorizedLocationIds' is distinct from v_locations
    or (v_grant ? 'resolvedDefaultLocationId' and v_grant->>'resolvedDefaultLocationId' is distinct from v_generation.default_location_id) then
    raise exception using errcode='42501',message='square_qualification_task_mapping_denied';
  end if;
  if v_binding->>'scopeFingerprint' is distinct from private.phase_4_fingerprint_text_v1(
      private.phase_3_contract_fingerprint_v1((v_scope-'generation') || pg_catalog.jsonb_build_object('purpose','square_ingestion_scope_v1')))
    or v_binding->>'scanKey' is distinct from private.phase_4_fingerprint_text_v1(
      private.phase_3_contract_fingerprint_v1(pg_catalog.jsonb_build_object(
        'purpose','square_ingestion_scan_v1','workspaceId',v_connection.workspace_id,
        'businessEntityId',v_connection.business_entity_id,'connectionId',v_connection.connection_id,
        'stream',v_grant->>'stream','scanId',v_grant->>'scanId'))) then
    raise exception using errcode='42501',message='square_qualification_task_binding_denied';
  end if;
  -- queryFingerprint/cursorBindingFingerprint are the immutable read-plan outputs
  -- of the unchanged Square request validators, supplied only by trusted fixture
  -- enrollment. SQL does not duplicate all 25 pinned request normalizers. Runtime
  -- must match this exact binding; the adapter independently validates the grant's
  -- exact request and recomputes both before acquiring a page or reading transport.
  perform 1 from public.business_entities where workspace_id=v_connection.workspace_id and id=v_connection.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_qualification_entity_denied'; end if;
  perform private.assert_square_verified_task_enroller_v1(p_command);
  v_now:=pg_catalog.clock_timestamp();
  v_expiry:=pg_catalog.to_timestamp((v_grant->>'expiresAt')::numeric/1000);
  if v_expiry<=v_now or v_expiry>v_now+interval '1 hour' or v_expiry>v_generation.retention_expires_at then
    raise exception using errcode='42501',message='square_qualification_task_expiry_denied';
  end if;
  insert into private.square_ingestion_tasks(task_id,connection_id,workspace_id,business_entity_id,connection_generation,runtime_login,
    lease_owner_fingerprint,"grant",binding,expires_at,retention_policy_version,retention_expires_at,created_at)
    values ((p_command->>'taskId')::uuid,v_connection.connection_id,v_connection.workspace_id,v_connection.business_entity_id,
      v_connection.current_generation,(p_command->>'runtimeLogin')::name,p_command->>'leaseOwnerFingerprint',v_grant,v_binding,v_expiry,
      v_generation.retention_policy_version,v_generation.retention_expires_at,v_now);
  return pg_catalog.jsonb_build_object('taskId',p_command->>'taskId','grant',v_grant,'binding',v_binding);
end;
$function$;


create or replace function private.lock_square_ingestion_authority_v1(p_task_id uuid,p_lease_owner_fingerprint text)
returns private.square_ingestion_tasks language plpgsql security invoker set search_path = '' as $function$
declare
  v_task private.square_ingestion_tasks;
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_now timestamptz;
  v_locations jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'square_ingestion_runtime_authority','MEMBER') then
    raise exception using errcode='42501',message='square_ingestion_runtime_authority_required';
  end if;
  -- This first read locates the fence only. Tasks are immutable; no authority is
  -- established until connection and task locks are held and DB time reread.
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  select * into v_connection from private.square_connections where connection_id=v_task.connection_id for share;
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id for share;
  perform 1 from public.business_entities where workspace_id=v_task.workspace_id and id=v_task.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_task_mode_v1(v_task);
  if v_connection.state<>'active' or v_connection.current_generation<>v_task.connection_generation
    or v_connection.workspace_id<>v_task.workspace_id or v_connection.business_entity_id<>v_task.business_entity_id
    or v_task.runtime_login is distinct from session_user::name
    or v_task.lease_owner_fingerprint is distinct from p_lease_owner_fingerprint
    or v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations from private.square_location_mappings
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  if v_generation.identity_mode not in ('synthetic_local_qualification','oauth_verified')
    or v_generation.retention_expires_at<=v_now
    or v_task.retention_policy_version<>v_generation.retention_policy_version
    or v_task.retention_expires_at<>v_generation.retention_expires_at
    or v_task.grant#>'{scope,authorizedLocationIds}' is distinct from v_locations
    or v_task.grant#>>'{scope,sellerId}' is distinct from v_connection.seller_id
    or v_task.grant#>>'{scope,environment}' is distinct from v_connection.environment then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  return v_task;
end;
$function$;

create or replace function private.lock_square_page_capacity_v1(p_task private.square_ingestion_tasks)
returns void language plpgsql security invoker set search_path = '' as $function$
declare v_capacity private.square_ingestion_capacity;v_now timestamptz;
begin
  insert into private.square_ingestion_capacity(connection_id,workspace_id,business_entity_id)
    values(p_task.connection_id,p_task.workspace_id,p_task.business_entity_id) on conflict(connection_id) do nothing;
  select * into strict v_capacity from private.square_ingestion_capacity where connection_id=p_task.connection_id for update;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_task_mode_v1(p_task);
  if v_capacity.workspace_id<>p_task.workspace_id or v_capacity.business_entity_id<>p_task.business_entity_id
    or p_task.expires_at<=v_now or p_task.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
end;
$function$;

create or replace function public.acquire_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_binding jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_now timestamptz;v_lease jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  v_now:=pg_catalog.clock_timestamp();
  perform private.square_assert_page_json_v1(p_binding);
  if p_binding is distinct from v_task.binding then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  perform private.lock_square_page_capacity_v1(v_task);
  insert into private.square_ingestion_scans(scan_key,workspace_id,business_entity_id,connection_id,connection_generation,initial_task_id,binding,stream,status,not_before,retention_policy_version,retention_expires_at,created_at,updated_at)
    values(p_binding->>'scanKey',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_task.connection_generation,v_task.task_id,p_binding,v_task.grant->>'stream','ready',v_now,v_task.retention_policy_version,v_task.retention_expires_at,v_now,v_now)
    on conflict(scan_key) do nothing;
  select * into strict v_scan from private.square_ingestion_scans where scan_key=p_binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_task_mode_v1(v_task);
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.binding<>p_binding or v_scan.workspace_id<>v_task.workspace_id or v_scan.business_entity_id<>v_task.business_entity_id or v_scan.connection_id<>v_task.connection_id or v_scan.stream<>v_task.grant->>'stream' then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  if v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_retention_expired';end if;
  if v_scan.status in ('finished','blocked','expired') then return private.square_page_result_v1(v_scan.status,v_scan,v_now);end if;
  if v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then
    update private.square_ingestion_scans set status='expired',lease=null,lease_task_id=null,updated_at=v_now,completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('expired',v_scan,v_now);
  end if;
  if v_scan.lease is not null and (v_scan.lease->>'expiresAt')::bigint>private.square_page_ms_v1(v_now) then return private.square_page_result_v1('conflict',v_scan,v_now);end if;
  if v_scan.not_before>v_now then return private.square_page_result_v1('deferred',v_scan,v_now);end if;
  if v_scan.attempt>=3 or v_scan.checkpoint_version>=100 then
    update private.square_ingestion_scans set status='blocked',lease=null,lease_task_id=null,updated_at=v_now,completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('blocked',v_scan,v_now);
  end if;
  v_lease:=pg_catalog.jsonb_build_object('binding',p_binding,'leaseId',private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_durable_page_lease_v1','taskId',p_task_id,'owner',p_lease_owner_fingerprint,'binding',p_binding,'checkpoint',v_scan.checkpoint_version,'serial',v_scan.lease_serial+1)),
    'expiresAt',least(private.square_page_ms_v1(v_now)+30000,private.square_page_ms_v1(v_task.expires_at),private.square_page_ms_v1(v_task.retention_expires_at)),
    'checkpointVersion',v_scan.checkpoint_version,'cursor',v_scan.cursor,'attempt',v_scan.attempt+1,'pageNumber',v_scan.checkpoint_version+1);
  update private.square_ingestion_scans set status='leased',lease=v_lease,lease_task_id=p_task_id,lease_serial=lease_serial+1,attempt=attempt+1,updated_at=v_now where scan_key=v_scan.scan_key;
  return pg_catalog.jsonb_build_object('outcome','leased','lease',v_lease);
exception when sqlstate '54000' then
  return pg_catalog.jsonb_build_object('outcome','blocked','completeness',null,'retryAfterMs',null);
end;
$function$;

create or replace function public.commit_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_resource private.square_ingestion_resources;
  v_prior private.square_ingestion_versions;v_existing private.square_ingestion_versions;v_receipt private.square_ingestion_page_receipts;
  v_now timestamptz;v_command_hash text;v_pending jsonb;v_version jsonb;v_ordering text;v_unordered boolean:=false;v_limited boolean;v_next jsonb;v_sources jsonb;v_completion jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  v_now:=pg_catalog.clock_timestamp();
  perform private.square_assert_page_json_v1(p_command);
  if not coalesce(private.jsonb_has_exact_keys_v1(p_command,array['lease','pageId','sources','completeness','nextCursor','now'])
    and private.is_sha256_fingerprint_v1(p_command->>'pageId') and pg_catalog.jsonb_typeof(p_command->'sources')='array'
    and p_command#>'{lease,binding}'=v_task.binding and private.square_page_completeness_v1(p_command->'completeness') and private.square_page_cursor_v1(p_command->'nextCursor'),false) then
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end if;
  v_sources:=p_command->'sources';v_next:=nullif(p_command->'nextCursor','null'::jsonb);v_completion:=p_command->'completeness';
  if pg_catalog.jsonb_array_length(v_sources)>(case when v_task.grant->>'stream' in ('payments','refunds') then 100 when v_task.grant->>'stream'='catalog' then 3000 else 1000 end) then
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end if;
  perform private.lock_square_page_capacity_v1(v_task);
  select * into v_scan from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  perform private.assert_square_task_mode_v1(v_task);
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.binding<>v_task.binding or v_scan.stream<>v_task.grant->>'stream' then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  for v_pending in select value from pg_catalog.jsonb_array_elements(v_sources) loop
    perform private.square_pending_source_v1(v_pending,v_task.grant->'scope',v_scan.stream);
  end loop;
  v_command_hash:=private.square_page_hash_v1(pg_catalog.jsonb_build_object('purpose','square_durable_atomic_page_v1','lease',p_command->'lease','pageId',p_command->'pageId',
    'versionKeys',(select coalesce(pg_catalog.jsonb_agg(key order by key),'[]'::jsonb) from (select distinct value->>'versionKey' as key from pg_catalog.jsonb_array_elements(v_sources)) as keys),
    'completeness',v_completion,'nextCursor',v_next));
  -- Validation/hash work is bounded but still consumes time. Receipt recovery
  -- remains permitted after an old lease expires, never after task/retention
  -- authority expires; it observes the current durable checkpoint only.
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_task_mode_v1(v_task);
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  select * into v_receipt from private.square_ingestion_page_receipts where scan_key=v_scan.scan_key and page_id=p_command->>'pageId';
  if found then return private.square_page_result_v1(case when v_receipt.command_fingerprint=v_command_hash then 'replayed' else 'conflict_commit' end,v_scan,v_now);end if;
  if v_scan.status<>'leased' or v_scan.lease is distinct from p_command->'lease' or v_scan.lease_task_id is distinct from p_task_id
    or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now))
    or v_scan.checkpoint_version>=100 or v_completion->>'pageSequence'='blocked'
    or ((v_next is null)<>(v_completion->>'pageSequence'='finished')) then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;
  if v_next is not null and ((v_next->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_next->>'expiresAt')::bigint>least(private.square_account_cursor_deadline_v1(v_task,v_now),private.square_page_ms_v1(v_task.expires_at),private.square_page_ms_v1(v_task.retention_expires_at))
    or v_next->>'value'=v_scan.cursor->>'value') then return private.square_page_result_v1('conflict_commit',v_scan,v_now);end if;

  -- Stable lock order: connection, task, capacity, scan, sorted resources.
  -- The database assigns ordinals and final fingerprints; caller observations
  -- cannot choose a prior version or overwrite a current provider candidate.
  begin
  for v_pending in select value from pg_catalog.jsonb_array_elements(v_sources) order by value->>'resourceKey',value->>'versionKey' loop
    insert into private.square_ingestion_resources(resource_key,workspace_id,business_entity_id,connection_id,stream,provider_record_type,provider_record_id)
      values(v_pending->>'resourceKey',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_scan.stream,v_pending->>'providerRecordType',v_pending->>'providerRecordId') on conflict(resource_key) do nothing;
    select * into strict v_resource from private.square_ingestion_resources where resource_key=v_pending->>'resourceKey' for update;
    if v_resource.workspace_id<>v_task.workspace_id or v_resource.business_entity_id<>v_task.business_entity_id or v_resource.connection_id<>v_task.connection_id or v_resource.stream<>v_scan.stream
      or v_resource.provider_record_type<>v_pending->>'providerRecordType' or v_resource.provider_record_id<>v_pending->>'providerRecordId' then raise exception using errcode='42501',message='square_page_scope_denied';end if;
    select * into v_existing from private.square_ingestion_versions where version_key=v_pending->>'versionKey';
    if found then
      if v_existing.resource_key<>v_resource.resource_key then raise exception using errcode='23505',message='square_page_identity_conflict';end if;
      continue;
    end if;
    select * into v_prior from private.square_ingestion_versions where version_key=v_resource.current_version_key;
    v_ordering:=case when v_resource.current_version_key is null then 'newer' else private.square_revision_order_v1(v_prior.pending->'providerRevision',v_pending->'providerRevision') end;
    v_unordered:=v_unordered or v_ordering in ('conflict','unordered');
    select * into v_prior from private.square_ingestion_versions where version_key=v_resource.observed_version_key;
    v_version:=private.square_materialize_source_v1(v_pending,v_resource.version_count+1,v_prior.version_id);
    insert into private.square_ingestion_versions(version_key,resource_key,workspace_id,business_entity_id,connection_id,ordinal,version_id,prior_version_id,pending,version,ordering,retention_policy_version,retention_expires_at,created_at)
      values(v_pending->>'versionKey',v_resource.resource_key,v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,v_resource.version_count+1,(v_version->>'id')::uuid,v_prior.version_id,v_pending,v_version,v_ordering,v_task.retention_policy_version,v_task.retention_expires_at,v_now);
    update private.square_ingestion_resources set observed_version_key=v_pending->>'versionKey',current_version_key=case when v_ordering='newer' then v_pending->>'versionKey' else current_version_key end,version_count=version_count+1 where resource_key=v_resource.resource_key;
  end loop;
  -- A task/lease expiring while waiting on another resource cannot publish.
  -- Any earlier per-source INSERT is rolled back by this exception as well.
  v_now:=pg_catalog.clock_timestamp();
  perform private.assert_square_task_mode_v1(v_task);
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
    or (v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now))
    or (v_next is not null and (v_next->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)) then raise exception using errcode='40001',message='square_page_lease_expired';end if;
  v_limited:=v_next is not null and v_scan.checkpoint_version+1>=100;
  insert into private.square_ingestion_page_receipts(scan_key,page_id,workspace_id,business_entity_id,connection_id,task_id,command_fingerprint,checkpoint_version,retention_policy_version,retention_expires_at,created_at)
    values(v_scan.scan_key,p_command->>'pageId',v_task.workspace_id,v_task.business_entity_id,v_task.connection_id,p_task_id,v_command_hash,v_scan.checkpoint_version+1,v_task.retention_policy_version,v_task.retention_expires_at,v_now);
  update private.square_ingestion_scans set checkpoint_version=checkpoint_version+1,cursor=v_next,lease=null,lease_task_id=null,attempt=0,not_before=v_now,updated_at=v_now,
    completeness=private.square_page_limitations_v1(completeness,v_completion,v_limited,v_unordered),status=case when v_next is null then 'finished' when v_limited then 'blocked' else 'ready' end
    where scan_key=v_scan.scan_key returning * into v_scan;
  return private.square_page_result_v1('committed',v_scan,v_now);
  exception when sqlstate '54000' then
    -- The subtransaction rolls back ALL staged source/resource/receipt/counter
    -- changes. Only an incomplete blocked scan is published, never a checkpoint.
    -- Clearing the lease removes >=2 containers and more bytes than the bounded
    -- two-container limitation object can add, so this transition still fits.
    v_now:=pg_catalog.clock_timestamp();
    perform private.assert_square_task_mode_v1(v_task);
    if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now)
      or v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then raise exception using errcode='40001',message='square_page_lease_expired';end if;
    update private.square_ingestion_scans set status='blocked',lease=null,lease_task_id=null,updated_at=v_now,
      completeness=private.square_page_limitations_v1(completeness,null,true) where scan_key=v_scan.scan_key returning * into v_scan;
    return private.square_page_result_v1('conflict_commit',v_scan,v_now);
  end;
end;
$function$;

create or replace function public.release_square_ingestion_page_v1(p_task_id uuid,p_lease_owner_fingerprint text,p_lease jsonb,p_release jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_task private.square_ingestion_tasks;v_scan private.square_ingestion_scans;v_now timestamptz;v_blocked boolean;v_delay bigint;v_completion jsonb;
begin
  v_task:=private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  perform private.square_assert_page_json_v1(p_lease);perform private.square_assert_page_json_v1(p_release);
  if not coalesce(private.jsonb_has_exact_keys_v1(p_release-array['completeness'],array['now','retryAfterMs','blocked'])
    and pg_catalog.jsonb_typeof(p_release->'blocked')='boolean'
    and (p_release->'retryAfterMs'='null'::jsonb or p_release->>'retryAfterMs' ~ '^[0-9]{1,16}$')
    and (not p_release?'completeness' or private.square_page_completeness_v1(p_release->'completeness')) and p_lease->'binding'=v_task.binding,false) then return 'null'::jsonb;end if;
  perform private.lock_square_page_capacity_v1(v_task);
  select * into v_scan from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found then return 'null'::jsonb;end if;
  perform private.assert_square_task_mode_v1(v_task);
  if v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now or v_scan.retention_expires_at<=v_now then raise exception using errcode='42501',message='square_page_authority_expired';end if;
  if v_scan.status<>'leased' or v_scan.binding<>v_task.binding or v_scan.lease is distinct from p_lease or v_scan.lease_task_id is distinct from p_task_id
    or (v_scan.lease->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) or v_scan.cursor is not null and (v_scan.cursor->>'expiresAt')::bigint<=private.square_page_ms_v1(v_now) then return 'null'::jsonb;end if;
  v_blocked:=(p_release->>'blocked')::boolean or v_scan.attempt>=3;
  v_delay:=least(60000,coalesce((p_release->>'retryAfterMs')::bigint,1000*(2^(v_scan.attempt-1))::bigint));
  v_completion:=private.square_page_limitations_v1(v_scan.completeness,p_release->'completeness',v_blocked);
  v_completion:=private.square_page_limitations_v1(v_completion,null,v_blocked);
  update private.square_ingestion_scans set status=case when v_blocked then 'blocked' else 'ready' end,lease=null,lease_task_id=null,not_before=v_now+v_delay*interval '1 millisecond',updated_at=v_now,completeness=v_completion where scan_key=v_scan.scan_key;
  return 'null'::jsonb;
end;
$function$;

alter table private.square_account_configuration enable row level security;
alter table private.square_account_configuration force row level security;
alter table private.square_account_connections enable row level security;
alter table private.square_account_connections force row level security;
alter table private.square_account_oauth_states enable row level security;
alter table private.square_account_oauth_states force row level security;
alter table private.square_account_credentials enable row level security;
alter table private.square_account_credentials force row level security;
alter table private.square_account_credential_reads enable row level security;
alter table private.square_account_credential_reads force row level security;
alter table private.square_account_audit_events enable row level security;
alter table private.square_account_audit_events force row level security;
alter table private.square_account_enrollments enable row level security;
alter table private.square_account_enrollments force row level security;
alter table private.square_account_revocation_events enable row level security;
alter table private.square_account_revocation_events force row level security;
alter table private.square_account_capacity_blocks enable row level security;
alter table private.square_account_capacity_blocks force row level security;
revoke all on table private.square_account_configuration,private.square_account_connections,
  private.square_account_oauth_states,private.square_account_credentials,private.square_account_credential_reads,
  private.square_account_audit_events,
  private.square_account_enrollments,private.square_account_revocation_events,private.square_account_capacity_blocks
  from public,anon,authenticated,service_role,external_integrations_authority,integration_control_plane_authority,
    integration_provider_runtime_authority,integration_provider_source_authority,integration_credential_broker_authority,
    square_ingestion_runtime_authority,square_ingestion_qualification_admin,square_account_broker_authority,square_verified_enrollment_authority;
revoke all on function private.square_account_scopes_v1(),private.square_account_configuration_v1(jsonb,boolean,boolean),
  private.square_account_retention_v1(private.square_account_configuration),
  private.square_account_credential_result_v1(private.square_account_credentials,text,boolean),
  private.lock_square_account_v1(jsonb,uuid),private.assert_square_verified_account_v1(uuid,bigint,boolean),
  private.assert_square_task_mode_v1(private.square_ingestion_tasks),private.assert_square_verified_task_enroller_v1(jsonb),
  private.square_account_cursor_deadline_v1(private.square_ingestion_tasks,timestamptz),
  public.square_account_connection_v1(jsonb,text,jsonb),public.enroll_square_verified_connection_v1(jsonb,jsonb),
  public.enroll_square_verified_task_v1(jsonb),public.record_square_account_revocation_v1(text,text,jsonb)
  from public,anon,authenticated,service_role,external_integrations_authority,integration_control_plane_authority,
    integration_provider_runtime_authority,integration_provider_source_authority,integration_credential_broker_authority,
    square_ingestion_runtime_authority,square_ingestion_qualification_admin,square_account_broker_authority,square_verified_enrollment_authority;
grant execute on function public.square_account_connection_v1(jsonb,text,jsonb),public.record_square_account_revocation_v1(text,text,jsonb)
  to square_account_broker_authority;
grant execute on function public.enroll_square_verified_connection_v1(jsonb,jsonb),public.enroll_square_verified_task_v1(jsonb)
  to square_verified_enrollment_authority;

commit;
