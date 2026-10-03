-- Apply the mapped host/session fence at inherited native entry points too.
-- No approvals, roles, grants, credentials, mappings or activations are seeded.
-- Unrelated Vercel and synthetic connections retain their existing behavior.
begin;

create function private.assert_square_gcp_mapped_connection_v1(
  p_connection_id uuid,p_generation bigint,p_capability text,p_context jsonb default null)
returns void language plpgsql security invoker set search_path='' as $fn$
declare b jsonb;
begin
  -- Routing is independent of validity. Disabled/expired/stale mapped authority
  -- must deny rather than fall back to an inherited legacy capability.
  if not exists(select 1 from private.square_gcp_mapped_runtime_binding where connection_id=p_connection_id) then return; end if;
  b:=private.square_gcp_mapped_runtime_binding_v1();
  if b->>'connectionId' is distinct from p_connection_id::text
    or (b->>'connectionGeneration')::bigint is distinct from p_generation
    or p_capability is not null and b->>'capability' is distinct from p_capability
    or p_context is null and not (b->>'mappedProviderCallsEnabled')::boolean then
    raise exception using errcode='42501',message='square_gcp_mapped_runtime_denied'; end if;
  if p_context is not null then
    perform private.square_gcp_mapped_context_v1(p_context,p_capability);
  end if;
end;
$fn$;
revoke all on function private.assert_square_gcp_mapped_connection_v1(uuid,bigint,text,jsonb)
  from public,anon,authenticated,service_role,square_account_broker_authority,square_verified_enrollment_authority,
    square_ingestion_runtime_authority,square_ingestion_qualification_admin;

create or replace function public.enroll_square_verified_connection_v1(p_context jsonb,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_config private.square_account_configuration;v_account private.square_account_connections;
  v_connection private.square_connections;v_now timestamptz;v_expiry timestamptz;v_location text;v_default text;
begin
  v_config:=private.square_account_configuration_v1(p_context,true,true);
  if p_command is null or pg_catalog.pg_column_size(p_command)>1024 or not private.jsonb_has_exact_keys_v1(p_command,array['connectionId','generation']) then
    raise exception using errcode='42501',message='square_verified_enrollment_denied';end if;
  v_account:=private.lock_square_account_v1(p_context,(p_command->>'connectionId')::uuid);
  perform private.assert_square_gcp_mapped_connection_v1(v_account.connection_id,(p_command->>'generation')::bigint,'enroller',p_context);
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
  perform private.assert_square_gcp_mapped_connection_v1(v_account.connection_id,v_account.generation,'enroller',p_context);
  return pg_catalog.jsonb_build_object('enrolled',true,'generation',v_account.generation,'idempotent',false);
end;
$fn$;

create or replace function private.assert_square_verified_account_v1(p_connection_id uuid,p_generation bigint,p_enroller boolean default false)
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
  -- Called by original runtime resolve/acquire/commit/release, including their
  -- post-scan-lock and pre-commit checks, and by original task enrollment.
  perform private.assert_square_gcp_mapped_connection_v1(p_connection_id,p_generation,
    case when p_enroller then 'enroller' else null end);
end;
$fn$;

commit;
