begin;

create or replace function public.read_integration_provider_credential_v4(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_credential private.integration_credentials;
  v_predecessor private.integration_credentials;
  v_created_credential_version bigint := 1;
  v_ciphertext_persisted_at timestamptz;
  v_rotation_evidence_count bigint;
begin
  perform private.assert_integration_credential_broker_authority_v1();

  v_result := public.read_integration_provider_credential_v3(
    p_command,
    p_request_id
  );
  if v_result ->> 'state' <> 'available' then
    return v_result;
  end if;

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.id = (v_result ->> 'credentialId')::uuid
    and credential.credential_version =
      (v_result ->> 'credentialVersion')::bigint
    and credential.provider_key = v_result ->> 'providerKey'
    and credential.provider_environment =
      v_result ->> 'providerEnvironment'
    and credential.status = 'active'
    and credential.credential_ciphertext is not null
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  if v_credential.supersedes_credential_id is not null then
    select predecessor.*
    into v_predecessor
    from private.integration_credentials as predecessor
    where predecessor.id = v_credential.supersedes_credential_id
      and predecessor.workspace_id = v_credential.workspace_id
      and predecessor.business_entity_id = v_credential.business_entity_id
      and predecessor.connection_id = v_credential.connection_id
      and predecessor.connection_generation =
        v_credential.connection_generation
      and predecessor.provider_key = v_credential.provider_key
      and predecessor.provider_environment =
        v_credential.provider_environment
    for share;
    if not found then
      raise exception using
        errcode = '42501',
        message = 'integration_provider_credential_read_denied';
    end if;
    v_created_credential_version := v_predecessor.credential_version + 1;
  end if;

  select pg_catalog.count(*), pg_catalog.max(audit.occurred_at)
  into v_rotation_evidence_count, v_ciphertext_persisted_at
  from private.integration_audit_events as audit
  where audit.workspace_id = v_credential.workspace_id
    and audit.business_entity_id = v_credential.business_entity_id
    and audit.connection_id = v_credential.connection_id
    and audit.action = 'credential_rotated'
    and audit.outcome = 'succeeded'
    and audit.target_type = 'integration_credential'
    and audit.target_id = v_credential.id::text
    and audit.reason_code = 'refresh_succeeded'
    and audit.metadata ->> 'credential_version' =
      v_credential.credential_version::text;

  if v_credential.credential_version = v_created_credential_version then
    if v_rotation_evidence_count <> 0 then
      raise exception using
        errcode = '42501',
        message = 'integration_provider_credential_read_denied';
    end if;
    v_ciphertext_persisted_at := v_credential.created_at;
  elsif v_credential.credential_version > v_created_credential_version then
    if v_rotation_evidence_count <> 1 then
      raise exception using
        errcode = '42501',
        message = 'integration_provider_credential_read_denied';
    end if;
  else
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  if v_ciphertext_persisted_at < v_credential.created_at
    or v_ciphertext_persisted_at > v_credential.updated_at
    or v_credential.access_expires_at <= v_ciphertext_persisted_at
    or (
      v_credential.refresh_expires_at is not null
      and v_credential.refresh_expires_at <= v_ciphertext_persisted_at
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'ciphertextPersistedAt', pg_catalog.to_char(
      v_ciphertext_persisted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'refreshExpiresAt', case
      when v_credential.refresh_expires_at is null then null
      else pg_catalog.to_char(
        v_credential.refresh_expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end,
    'externalEntityReferenceFingerprint', case
      when v_credential.external_entity_reference_fingerprint is null then null
      else private.phase_5_fingerprint_text_v1(
        v_credential.external_entity_reference_fingerprint
      )
    end
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_payload_invalid';
end;
$function$;

revoke all on function public.read_integration_provider_credential_v4(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

grant execute on function public.read_integration_provider_credential_v4(jsonb, text)
  to integration_credential_broker_authority;

commit;
