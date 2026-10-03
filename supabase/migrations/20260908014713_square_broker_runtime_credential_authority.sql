-- Preserve the runtime/page authority boundary. A separately configured broker
-- may read only the current credential for the approved runtime's verified task.
-- No role, membership, configuration, enrollment or provider call is installed.
begin;

create function private.lock_square_broker_credential_authority_v1(
  p_context jsonb,p_task_id uuid,p_lease_owner_fingerprint text)
returns private.square_ingestion_tasks
language plpgsql security invoker set search_path='' as $function$
declare
  v_task private.square_ingestion_tasks;
  v_connection private.square_connections;
  v_generation private.square_connection_generations;
  v_binding jsonb;
  v_now timestamptz;
  v_locations jsonb;
begin
  -- Preserve the existing combined-login local account qualification exactly.
  -- This does not grant runtime authority to the separate Sandbox broker.
  if pg_catalog.pg_has_role(session_user,'square_ingestion_runtime_authority','MEMBER') then
    return private.lock_square_ingestion_authority_v1(p_task_id,p_lease_owner_fingerprint);
  end if;
  -- Delegated runtime authorization must observe committed catalog changes after
  -- lock waits. REPEATABLE READ/SERIALIZABLE retain stale pg_roles attributes even
  -- in this volatile function; this new branch supports READ COMMITTED only.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  v_binding:=public.get_square_remote_sandbox_binding_v1();
  if v_binding->>'brokerLogin' is distinct from session_user::text
    or v_binding->>'operatorId' is distinct from p_context#>>'{actor,actorId}'
    or v_binding->>'operatorRole' is distinct from p_context#>>'{actor,role}'
    or v_binding->>'workspaceId' is distinct from p_context#>>'{actor,workspaceId}'
    or v_binding->>'environment' is distinct from p_context->>'environment'
    or v_binding->>'applicationId' is distinct from p_context->>'applicationId'
    or (v_binding->>'applicationOrigin')||'/api/integrations/square/callback' is distinct from p_context->>'redirectUri'
    or not exists(select 1 from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
      and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
      and pg_catalog.pg_has_role(r.oid,'square_ingestion_runtime_authority','MEMBER')
      and not pg_catalog.pg_has_role(r.oid,'square_ingestion_qualification_admin','MEMBER')) then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  -- Keep the original connection -> immutable task -> entity lock order.
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  select * into v_connection from private.square_connections where connection_id=v_task.connection_id for share;
  select * into v_task from private.square_ingestion_tasks where task_id=p_task_id for share;
  perform 1 from public.business_entities where workspace_id=v_task.workspace_id and id=v_task.business_entity_id and status='active' for share;
  if not found then raise exception using errcode='42501',message='square_ingestion_authority_denied'; end if;
  perform private.assert_square_task_mode_v1(v_task);
  -- Credential release subsequently takes this same scan lock. Acquire it now
  -- so a scan wait cannot carry the host/task approval past its deadline.
  perform 1 from private.square_ingestion_scans where scan_key=v_task.binding->>'scanKey' for share;
  -- A live actor session must still be valid after a page-lock wait, not merely
  -- at entry into the account RPC. This reuses the complete checked boundary.
  perform private.square_account_configuration_v1(p_context);
  -- Row locks do not stabilize role membership or LOGIN attributes. Recheck after
  -- every blocking authority lock. pg_has_role can retain a membership cache for
  -- the blocked statement, so read the complete MEMBER graph from fresh catalogs
  -- (including non-inherited/non-settable grants). Missing/renamed roles deny.
  if not exists(with recursive runtime_roles(roleid) as (
    select r.oid from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
    union
    select m.roleid from pg_catalog.pg_auth_members m join runtime_roles r on m.member=r.roleid
  ) select 1 from pg_catalog.pg_roles r where r.rolname=v_binding->>'runtimeLogin'
    and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb and not r.rolreplication
    and exists(select 1 from runtime_roles m join pg_catalog.pg_roles c on c.oid=m.roleid where c.rolname='square_ingestion_runtime_authority')
    and not exists(select 1 from runtime_roles m join pg_catalog.pg_roles c on c.oid=m.roleid where c.rolname='square_ingestion_qualification_admin')) then
    raise exception using errcode='42501',message='square_broker_credential_authority_denied';
  end if;
  -- Account/configuration checks above can wait too; read wall time afterwards.
  v_now:=pg_catalog.clock_timestamp();
  if v_connection.state<>'active' or v_connection.current_generation<>v_task.connection_generation
    or v_connection.workspace_id<>v_task.workspace_id or v_connection.business_entity_id<>v_task.business_entity_id
    or v_task.runtime_login::text is distinct from v_binding->>'runtimeLogin'
    or v_task.workspace_id::text is distinct from v_binding->>'workspaceId'
    or v_task.business_entity_id::text is distinct from v_binding->>'businessEntityId'
    or v_task.lease_owner_fingerprint is distinct from p_lease_owner_fingerprint
    or v_task.expires_at<=v_now or v_task.retention_expires_at<=v_now
    or (v_binding->>'approvalExpiresAt')::timestamptz<=v_now then
    raise exception using errcode='42501',message='square_ingestion_authority_denied';
  end if;
  select * into strict v_generation from private.square_connection_generations
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  select pg_catalog.jsonb_agg(location_id order by location_id collate "C") into v_locations from private.square_location_mappings
    where connection_id=v_task.connection_id and connection_generation=v_task.connection_generation;
  if v_generation.identity_mode<>'oauth_verified'
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
revoke all on function private.lock_square_broker_credential_authority_v1(jsonb,uuid,text)
  from public,anon,authenticated,service_role,square_account_broker_authority,
    square_verified_enrollment_authority,square_ingestion_runtime_authority,square_ingestion_qualification_admin;

-- The sole existing-function change is the read_credential authority call.
-- Current full lease, generation, credential version, scopes and evidence remain
-- checked by the unchanged branch below. All other operations retain their bytes.
create or replace function public.square_account_connection_v1(p_context jsonb,p_operation text,p_command jsonb)
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
      v_task:=private.lock_square_broker_credential_authority_v1(p_context,(p_command->>'taskId')::uuid,p_command->>'leaseOwnerFingerprint');
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

commit;
