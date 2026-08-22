create extension if not exists dblink with schema extensions;

begin;

grant usage on schema extensions
  to integration_oauth_ingress_authority,
    integration_credential_broker_authority;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$function$;

create or replace function pg_temp.fingerprint(p_value text)
returns text
language sql
immutable
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  );
$function$;

create or replace function pg_temp.credential_aad_digest(
  p_workspace_id uuid,
  p_connection_id uuid,
  p_credential_id uuid
)
returns text
language sql
security definer
set search_path = ''
as $function$
  select private.phase_5_fingerprint_text_v1(
    private.phase_5_credential_aad_digest_v1(
      'test', p_workspace_id, p_connection_id, 1, 'synthetic', p_credential_id
    )
  );
$function$;

create or replace function pg_temp.seed_connection(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_created_by uuid,
  p_status text default 'pending_authorization',
  p_created_at timestamptz default '2026-08-21T22:00:00Z'::timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.integration_connections (
    id,
    contract_version,
    control_contract_version,
    workspace_id,
    business_entity_id,
    connection_series_id,
    connection_generation,
    replaces_connection_id,
    provider_key,
    provider_environment,
    provider_tenant_reference_fingerprint,
    status,
    state_reason_code,
    requested_scopes,
    granted_scopes,
    safe_display_name,
    provider_descriptor_registry_version,
    provider_descriptor_registry_fingerprint,
    provider_descriptor_fingerprint,
    adapter_version,
    capability_snapshot,
    configuration_version,
    authorized_at,
    status_changed_at,
    disconnected_at,
    deleted_at,
    last_transition_request_id,
    last_transition_request_fingerprint,
    row_version,
    created_by,
    created_at,
    updated_at
  ) values (
    p_id,
    'integration_connection_v1',
    'integration_connection_control_v1',
    p_workspace_id,
    p_business_entity_id,
    p_id,
    1,
    null,
    'synthetic',
    'test',
    case
      when p_status = 'pending_authorization' then null
      else extensions.digest(pg_catalog.convert_to('synthetic-tenant', 'UTF8'), 'sha256')
    end,
    p_status,
    case p_status
      when 'pending_authorization' then 'authorization_pending'
      when 'authorized_unmapped' then 'mapping_required'
      else 'authorization_required'
    end,
    array['read_synthetic_business_data']::text[],
    case
      when p_status = 'pending_authorization' then '{}'::text[]
      else array['read_synthetic_business_data']::text[]
    end,
    'Synthetic Phase 5',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      'f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80',
      'hex'
    ),
    pg_catalog.decode(
      'd5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1',
      'hex'
    ),
    'synthetic_control_plane_adapter_v1',
    pg_catalog.jsonb_build_object(
      'operations', pg_catalog.jsonb_build_array(
        'get_capabilities',
        'get_source_record',
        'list_entities',
        'list_source_records'
      ),
      'domains', pg_catalog.jsonb_build_array('general_ledger'),
      'requiredStreamKeys', pg_catalog.jsonb_build_array('general_ledger'),
      'supportsBackfill', true,
      'webhookMode', 'none',
      'incrementalMode', 'cursor'
    ),
    1,
    case when p_status = 'pending_authorization' then null else p_created_at end,
    p_created_at,
    null,
    null,
    null,
    null,
    1,
    p_created_by,
    p_created_at,
    p_created_at
  );
end;
$function$;

create or replace function pg_temp.oauth_state_command(
  p_state_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_state_value text,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_return_intent text default '/app/integrations'
)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_oauth_state_v1',
    'id', p_state_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'initiatedBy', p_user_id,
    'requestedScopes', pg_catalog.jsonb_build_array('read_synthetic_business_data'),
    'returnIntent', p_return_intent,
    'stateHash', pg_temp.fingerprint(p_state_value),
    'createdAt', pg_catalog.to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', pg_catalog.to_char(p_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$function$;

create or replace function pg_temp.oauth_consume_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_state_value text,
  p_consumed_at timestamptz,
  p_return_intent text default '/app/integrations'
)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'initiatedBy', p_user_id,
    'requestedScopes', pg_catalog.jsonb_build_array('read_synthetic_business_data'),
    'returnIntent', p_return_intent,
    'stateHash', pg_temp.fingerprint(p_state_value),
    'consumedAt', pg_catalog.to_char(p_consumed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$function$;

create or replace function pg_temp.credential_command(
  p_credential_id uuid,
  p_state_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_authorized_at timestamptz,
  p_aad_override text default null,
  p_ciphertext_override text default null
)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_credential_authority_v1',
    'id', p_credential_id,
    'oauthStateId', p_state_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'initiatedBy', p_user_id,
    'expectedConnectionRowVersion', 1,
    'credentialVersion', 1,
    'envelopeSchemaVersion', 'oauth_credential_envelope_v1',
    'aadSchemaVersion', 'oauth_credential_aad_v1',
    'aadDigest', coalesce(
      p_aad_override,
      pg_temp.credential_aad_digest(
        p_workspace_id, p_connection_id, p_credential_id
      )
    ),
    'kmsKeyResource',
      'projects/vaeroex-phase5-test/locations/us-central1/keyRings/phase5-test/cryptoKeys/oauth-credentials',
    'ciphertextBase64', coalesce(
      p_ciphertext_override,
      pg_catalog.encode(pg_catalog.convert_to(pg_catalog.repeat('c', 32), 'UTF8'), 'base64')
    ),
    'accessExpiresAt', '2026-08-21T23:10:00.000Z',
    'refreshExpiresAt', '2026-09-21T22:10:00.000Z',
    'grantedScopes', pg_catalog.jsonb_build_array('read_synthetic_business_data'),
    'externalEntityReferenceFingerprint', pg_temp.fingerprint('synthetic-entity'),
    'authorizedAt', pg_catalog.to_char(p_authorized_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$function$;

create or replace function pg_temp.acquire_command(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_credential_id uuid,
  p_version bigint,
  p_lease_id uuid,
  p_owner text,
  p_acquired_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'credentialId', p_credential_id,
    'expectedCredentialVersion', p_version,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'acquiredAt', pg_catalog.to_char(p_acquired_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'leaseExpiresAt', pg_catalog.to_char(p_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('f5000000-0000-4000-8000-000000000001', 'phase5-owner@example.test', 'Phase 5 Owner'),
  ('f5000000-0000-4000-8000-000000000002', 'phase5-other@example.test', 'Phase 5 Other');

insert into public.workspaces (id, name, created_by) values
  ('f5100000-0000-4000-8000-000000000001', 'Phase 5 Workspace', 'f5000000-0000-4000-8000-000000000001'),
  ('f5100000-0000-4000-8000-000000000002', 'Phase 5 Other', 'f5000000-0000-4000-8000-000000000002');

insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('f5100000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('f5100000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000002', 'owner', 'active');

insert into public.business_entities (
  id, workspace_id, entity_key, entity_type, display_name, base_currency,
  timezone, fiscal_year_start_month, created_by, updated_by
) values
  (
    'f5200000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000001',
    'phase5_primary',
    'operating_company',
    'Phase 5 Primary',
    'USD',
    'UTC',
    1,
    'f5000000-0000-4000-8000-000000000001',
    'f5000000-0000-4000-8000-000000000001'
  ),
  (
    'f5200000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000002',
    'phase5_other',
    'operating_company',
    'Phase 5 Other',
    'USD',
    'UTC',
    1,
    'f5000000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000002'
  );

select pg_temp.seed_connection(
  'f5300000-0000-4000-8000-000000000001',
  'f5100000-0000-4000-8000-000000000001',
  'f5200000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001'
);
select pg_temp.seed_connection(
  'f5300000-0000-4000-8000-000000000002',
  'f5100000-0000-4000-8000-000000000001',
  'f5200000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001'
);

select has_table('private', 'integration_oauth_states', 'OAuth state authority exists');
select has_table('private', 'integration_credentials', 'credential authority exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.integration_oauth_states'::regclass),
  'OAuth state authority has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'private.integration_credentials'::regclass),
  'credential authority has forced RLS'
);
select ok(
  (select not rolcanlogin and not rolinherit
   from pg_catalog.pg_roles
   where rolname = 'integration_oauth_ingress_authority'),
  'OAuth ingress role is NOLOGIN and NOINHERIT'
);
select ok(
  (select not rolcanlogin and not rolinherit
   from pg_catalog.pg_roles
   where rolname = 'integration_credential_broker_authority'),
  'credential broker role is NOLOGIN and NOINHERIT'
);
select ok(
  not has_table_privilege('anon', 'private.integration_credentials', 'SELECT')
  and not has_table_privilege('authenticated', 'private.integration_credentials', 'SELECT')
  and not has_table_privilege('service_role', 'private.integration_credentials', 'SELECT'),
  'browser, member, and service_role cannot read credential ciphertext'
);
select ok(
  not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_credentials',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'broker has no arbitrary credential-table DML'
);
select ok(
  not has_table_privilege(
    'integration_credential_broker_authority',
    'private.canonical_business_fact_versions',
    'INSERT,UPDATE,DELETE'
  ),
  'broker cannot mutate Phase 1-3 numerical truth'
);
select ok(
  has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.create_integration_oauth_state_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_oauth_ingress_authority',
    'public.store_integration_credential_v1(jsonb,text)',
    'EXECUTE'
  ),
  'ingress receives only OAuth state RPC authority'
);
select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.acquire_integration_credential_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.acquire_integration_credential_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  ),
  'only the broker receives credential lease RPC authority'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.acquire_integration_credential_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'deterministic_calculation_authority',
    'public.acquire_integration_credential_refresh_lease_v1(jsonb,text)',
    'EXECUTE'
  ),
  'ordinary application and deterministic roles receive no decrypt path'
);

set local role integration_oauth_ingress_authority;
select is(
  (public.create_integration_oauth_state_v1(
    pg_temp.oauth_state_command(
      'f5400000-0000-4000-8000-000000000001',
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:01:00Z',
      '2026-08-21T22:11:00Z'
    ),
    'phase5_state_create_1'
  ) ->> 'stateId')::uuid,
  'f5400000-0000-4000-8000-000000000001'::uuid,
  'ingress creates a hashed OAuth state bound to the current connection generation'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select * from private.integration_oauth_states$$,
    '42501'
  ),
  'ingress cannot directly read OAuth state rows'
);
reset role;

select is(
  (select pg_catalog.octet_length(state_hash)
   from private.integration_oauth_states
   where id = 'f5400000-0000-4000-8000-000000000001'),
  32,
  'OAuth state persistence contains only a SHA-256 digest'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_oauth_state_v1(
      pg_temp.oauth_state_command(
        'f5400000-0000-4000-8000-000000000009',
        'f5100000-0000-4000-8000-000000000001',
        'f5200000-0000-4000-8000-000000000001',
        'f5300000-0000-4000-8000-000000000001',
        'f5000000-0000-4000-8000-000000000002',
        'substituted-user-state',
        '2026-08-21T22:01:00Z',
        '2026-08-21T22:11:00Z'
      ),
      'phase5_state_cross_user'
    )$$,
    '42501'
  ),
  'cross-user OAuth state creation is denied'
);

set local role integration_oauth_ingress_authority;
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000002',
      'f5200000-0000-4000-8000-000000000002',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ),
    'phase5_state_cross_workspace'
  ) ->> 'reasonCode',
  'state_invalid',
  'cross-workspace OAuth state substitution fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000002',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ),
    'phase5_state_cross_connection'
  ) ->> 'reasonCode',
  'state_invalid',
  'cross-connection OAuth state substitution fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ) || pg_catalog.jsonb_build_object('connectionGeneration', 2),
    'phase5_state_stale_generation'
  ) ->> 'reasonCode',
  'state_invalid',
  'stale connection-generation substitution fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ) || pg_catalog.jsonb_build_object('providerKey', 'synthetic_substitute'),
    'phase5_state_provider_substitution'
  ) ->> 'reasonCode',
  'state_invalid',
  'provider substitution fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000002',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ),
    'phase5_state_cross_user_consume'
  ) ->> 'reasonCode',
  'state_invalid',
  'cross-user OAuth callback substitution fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z',
      '/app/substituted'
    ),
    'phase5_state_redirect_substitution'
  ) ->> 'reasonCode',
  'state_invalid',
  'redirect substitution fails closed'
);
select ok(
  (public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:00Z'
    ),
    'phase5_state_consume_1'
  ) ->> 'accepted')::boolean,
  'a current fully bound OAuth state consumes atomically'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-state-one',
      '2026-08-21T22:02:01Z'
    ),
    'phase5_state_replay_1'
  ) ->> 'reasonCode',
  'state_replayed',
  'OAuth state replay fails closed'
);
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'unknown-state',
      '2026-08-21T22:02:01Z'
    ),
    'phase5_state_missing_1'
  ) ->> 'reasonCode',
  'state_missing',
  'unknown OAuth state fails closed without disclosure'
);
reset role;
insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status, creation_request_id,
  creation_request_fingerprint, created_at, expires_at, row_version
) values (
  'f5400000-0000-4000-8000-000000000003',
  'integration_oauth_state_v1',
  'f5100000-0000-4000-8000-000000000001',
  'f5200000-0000-4000-8000-000000000001',
  'f5300000-0000-4000-8000-000000000002',
  1,
  'synthetic',
  'test',
  'f5000000-0000-4000-8000-000000000001',
  array['read_synthetic_business_data']::text[],
  '/app/integrations',
  extensions.digest(pg_catalog.convert_to('phase5-expired-state', 'UTF8'), 'sha256'),
  'pending',
  'phase5_expired_state_fixture',
  extensions.digest(pg_catalog.convert_to('phase5-expired-state-fixture', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() - interval '2 minutes',
  pg_catalog.transaction_timestamp() - interval '1 minute',
  1
);
set local role integration_oauth_ingress_authority;
select is(
  public.consume_integration_oauth_state_v1(
    pg_temp.oauth_consume_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000002',
      'f5000000-0000-4000-8000-000000000001',
      'phase5-expired-state',
      '2026-08-21T22:12:00Z'
    ),
    'phase5_expired_state_consume'
  ) ->> 'reasonCode',
  'state_expired',
  'database-expired OAuth state fails closed despite a caller-supplied timestamp'
);
reset role;

set local role integration_credential_broker_authority;
select ok(
  (public.record_integration_authorization_event_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_authorization_audit_v1',
      'workspaceId', 'f5100000-0000-4000-8000-000000000001',
      'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
      'connectionId', 'f5300000-0000-4000-8000-000000000001',
      'credentialId', null,
      'actorId', 'integration_credential_broker',
      'action', 'authorization_failure',
      'outcome', 'failed',
      'reasonCode', 'invalid_grant',
      'credentialVersion', null,
      'occurredAt', '2026-08-21T22:02:30.000Z'
    ),
    'phase5_authorization_failure_audit'
  ) ->> 'eventId')::uuid is not null,
  'pre-credential authorization failure is audited without credential material'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.store_integration_credential_v1(
      pg_temp.credential_command(
        'f5500000-0000-4000-8000-000000000009',
        'f5400000-0000-4000-8000-000000000001',
        'f5100000-0000-4000-8000-000000000001',
        'f5200000-0000-4000-8000-000000000001',
        'f5300000-0000-4000-8000-000000000001',
        'f5000000-0000-4000-8000-000000000001',
        '2026-08-21T22:03:00Z',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      'phase5_credential_wrong_aad'
    )$$,
    '22023'
  ),
  'credential storage rejects AAD not reconstructed from trusted authority state'
);
select is(
  public.store_integration_credential_v1(
    pg_temp.credential_command(
      'f5500000-0000-4000-8000-000000000001',
      'f5400000-0000-4000-8000-000000000001',
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      '2026-08-21T22:03:00Z'
    ),
    'phase5_credential_store_1'
  ) ->> 'connectionStatus',
  'authorized_unmapped',
  'valid encrypted authorization advances only to authorized_unmapped'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select * from private.integration_credentials$$,
    '42501'
  ),
  'broker cannot directly read credential ciphertext'
);
reset role;

select is(
  (select status from private.integration_connections
   where id = 'f5300000-0000-4000-8000-000000000001'),
  'authorized_unmapped',
  'credential existence cannot activate the Phase 4 connection'
);
select is(
  (select pg_catalog.octet_length(credential_ciphertext)
   from private.integration_credentials
   where id = 'f5500000-0000-4000-8000-000000000001'),
  32,
  'Supabase persists ciphertext only'
);
select ok(
  pg_temp.raises_sqlstate(
    $$set local role service_role;
      select public.acquire_integration_credential_refresh_lease_v1('{}'::jsonb, 'service_role_attempt')$$,
    '42501'
  ),
  'service_role cannot invoke credential authority'
);
reset role;

set local role integration_credential_broker_authority;
select ok(
  (public.acquire_integration_credential_refresh_lease_v1(
    pg_temp.acquire_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5500000-0000-4000-8000-000000000001',
      1,
      'f5600000-0000-4000-8000-000000000001',
      'lease-owner-one',
      '2026-08-21T22:04:00Z',
      '2026-08-21T22:06:00Z'
    ),
    'phase5_lease_acquire_1'
  ) ->> 'acquired')::boolean,
  'the first refresh worker acquires the bounded lease'
);
select is(
  public.acquire_integration_credential_refresh_lease_v1(
    pg_temp.acquire_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5500000-0000-4000-8000-000000000001',
      1,
      'f5600000-0000-4000-8000-000000000002',
      'lease-owner-two',
      '2026-08-21T22:05:00Z',
      '2026-08-21T22:07:00Z'
    ),
    'phase5_lease_acquire_2'
  ) ->> 'reasonCode',
  'refresh_lease_held',
  'a concurrent losing refresh worker receives no credential'
);
reset role;
update private.integration_credentials
set refresh_lease_acquired_at = pg_catalog.transaction_timestamp() - interval '2 minutes',
    refresh_lease_expires_at = pg_catalog.transaction_timestamp() - interval '1 second',
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id = 'f5500000-0000-4000-8000-000000000001';
set local role integration_credential_broker_authority;
select ok(
  (public.acquire_integration_credential_refresh_lease_v1(
    pg_temp.acquire_command(
      'f5100000-0000-4000-8000-000000000001',
      'f5200000-0000-4000-8000-000000000001',
      'f5300000-0000-4000-8000-000000000001',
      'f5500000-0000-4000-8000-000000000001',
      1,
      'f5600000-0000-4000-8000-000000000003',
      'lease-owner-three',
      '2026-08-21T22:07:00Z',
      '2026-08-21T22:09:00Z'
    ),
    'phase5_lease_takeover_3'
  ) ->> 'acquired')::boolean,
  'a database-expired refresh lease can be taken over deterministically'
);

select is(
  (public.rotate_integration_credential_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'f5100000-0000-4000-8000-000000000001',
      'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
      'connectionId', 'f5300000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'credentialId', 'f5500000-0000-4000-8000-000000000001',
      'expectedCredentialVersion', 1,
      'leaseId', 'f5600000-0000-4000-8000-000000000003',
      'leaseOwnerFingerprint', pg_temp.fingerprint('lease-owner-three'),
      'aadDigest', pg_temp.credential_aad_digest(
        'f5100000-0000-4000-8000-000000000001',
        'f5300000-0000-4000-8000-000000000001',
        'f5500000-0000-4000-8000-000000000001'
      ),
      'kmsKeyResource',
        'projects/vaeroex-phase5-test/locations/us-central1/keyRings/phase5-test/cryptoKeys/oauth-credentials',
      'ciphertextBase64', pg_catalog.encode(
        pg_catalog.convert_to(pg_catalog.repeat('d', 32), 'UTF8'), 'base64'
      ),
      'accessExpiresAt', '2026-08-22T00:00:00.000Z',
      'refreshExpiresAt', '2026-09-22T00:00:00.000Z',
      'grantedScopes', pg_catalog.jsonb_build_array('read_synthetic_business_data'),
      'externalEntityReferenceFingerprint', pg_temp.fingerprint('synthetic-entity'),
      'rotatedAt', '2026-08-21T22:08:00.000Z'
    ),
    'phase5_rotate_1'
  ) ->> 'credentialVersion')::bigint,
  2::bigint,
  'the lease winner rotates ciphertext with credential-version CAS'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.rotate_integration_credential_v1(
      jsonb_build_object(
        'workspaceId', 'f5100000-0000-4000-8000-000000000001',
        'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
        'connectionId', 'f5300000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', 'f5500000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', 'f5600000-0000-4000-8000-000000000003',
        'leaseOwnerFingerprint', pg_temp.fingerprint('lease-owner-three'),
        'aadDigest', 'sha256:' || repeat('a', 64),
        'kmsKeyResource', 'projects/vaeroex-phase5-test/locations/us-central1/keyRings/phase5-test/cryptoKeys/oauth-credentials',
        'ciphertextBase64', encode(convert_to(repeat('e', 32), 'UTF8'), 'base64'),
        'accessExpiresAt', '2026-08-22T00:00:00.000Z',
        'refreshExpiresAt', '2026-09-22T00:00:00.000Z',
        'grantedScopes', jsonb_build_array('read_synthetic_business_data'),
        'externalEntityReferenceFingerprint', pg_temp.fingerprint('synthetic-entity'),
        'rotatedAt', '2026-08-21T22:08:01.000Z'
      ),
      'phase5_rotate_stale'
    )$$,
    '40001'
  ),
  'a stale refresh worker cannot persist credentials'
);
reset role;

select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_credentials
      set workspace_id = 'f5100000-0000-4000-8000-000000000002',
          row_version = row_version + 1$$,
    '55000'
  ),
  'credential workspace binding is immutable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_credentials
      where id = 'f5500000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'credential history cannot be deleted'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_oauth_states
      where id = 'f5400000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'OAuth state history cannot be deleted'
);

-- Build a second credential to prove revocation and local destruction without
-- depending on provider availability.
set local role integration_oauth_ingress_authority;
select public.create_integration_oauth_state_v1(
  pg_temp.oauth_state_command(
    'f5400000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'f5300000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'phase5-state-two',
    '2026-08-21T22:10:00Z',
    '2026-08-21T22:20:00Z'
  ),
  'phase5_state_create_2'
);
select public.consume_integration_oauth_state_v1(
  pg_temp.oauth_consume_command(
    'f5100000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'f5300000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    'phase5-state-two',
    '2026-08-21T22:11:00Z'
  ),
  'phase5_state_consume_2'
);
reset role;

set local role integration_credential_broker_authority;
select public.store_integration_credential_v1(
  pg_temp.credential_command(
    'f5500000-0000-4000-8000-000000000002',
    'f5400000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'f5300000-0000-4000-8000-000000000002',
    'f5000000-0000-4000-8000-000000000001',
    '2026-08-21T22:12:00Z'
  ),
  'phase5_credential_store_2'
);
reset role;

update private.integration_connections
set status = 'disconnecting',
    state_reason_code = 'customer_disconnect_requested',
    status_changed_at = pg_catalog.transaction_timestamp(),
    last_transition_request_id = 'phase5_disconnect_request',
    last_transition_request_fingerprint = extensions.digest(
      pg_catalog.convert_to('phase5_disconnect_request', 'UTF8'), 'sha256'
    ),
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
where id = 'f5300000-0000-4000-8000-000000000002';

set local role integration_credential_broker_authority;
select is(
  public.revoke_integration_credential_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'f5100000-0000-4000-8000-000000000001',
      'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
      'connectionId', 'f5300000-0000-4000-8000-000000000002',
      'connectionGeneration', 1,
      'credentialId', 'f5500000-0000-4000-8000-000000000002',
      'expectedCredentialVersion', 1,
      'reasonCode', 'customer_disconnect',
      'revokedAt', '2026-08-21T22:14:00.000Z'
    ),
    'phase5_revoke_2'
  ) ->> 'credentialStatus',
  'revoked',
  'local revocation prevents future credential access before provider result'
);
select public.complete_integration_credential_revocation_v1(
  pg_catalog.jsonb_build_object(
    'workspaceId', 'f5100000-0000-4000-8000-000000000001',
    'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
    'connectionId', 'f5300000-0000-4000-8000-000000000002',
    'connectionGeneration', 1,
    'credentialId', 'f5500000-0000-4000-8000-000000000002',
    'expectedCredentialVersion', 1,
    'outcome', 'failed',
    'completedAt', '2026-08-21T22:14:01.000Z'
  ),
  'phase5_revoke_result_2'
);
select is(
  public.destroy_integration_credential_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', 'f5100000-0000-4000-8000-000000000001',
      'businessEntityId', 'f5200000-0000-4000-8000-000000000001',
      'connectionId', 'f5300000-0000-4000-8000-000000000002',
      'connectionGeneration', 1,
      'credentialId', 'f5500000-0000-4000-8000-000000000002',
      'expectedCredentialVersion', 1,
      'reasonCode', 'local_destruction',
      'destroyedAt', '2026-08-21T22:14:02.000Z'
    ),
    'phase5_destroy_2'
  ) ->> 'connectionStatus',
  'disconnected',
  'local destruction completes even when provider revocation fails'
);
reset role;

select ok(
  (select credential_ciphertext is null and status = 'destroyed'
   from private.integration_credentials
   where id = 'f5500000-0000-4000-8000-000000000002'),
  'destroyed credential retains only a non-sensitive tombstone'
);
select ok(
  not exists (
    select 1
    from private.integration_audit_events
    where action in (
      'oauth_state_created',
      'oauth_state_consumed',
      'oauth_state_rejected',
      'credential_encrypted',
      'credential_refresh',
      'credential_rotated',
      'credential_revocation',
      'credential_destroyed'
    )
      and metadata::text ~* '(token|secret|authorization.?code|ciphertext|state.?hash)'
  ),
  'authorization audit metadata contains identifiers and reason codes only'
);

-- Hosted/local dblink concurrency tail. The fixture is synthetic and is left
-- only in the disposable database that runs this suite.
select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(current_setting('vaeroex.test_database_url_b64'), 'base64'),
    'UTF8'
  )
)
from (values ('phase5_refresh_concurrency_1'), ('phase5_refresh_concurrency_2'))
  as connections(connection_name);

select extensions.dblink_exec(
  'phase5_refresh_concurrency_1',
  $setup$
    insert into public.profiles (id, email, full_name)
    values ('f5900000-0000-4000-8000-000000000001', 'phase5-concurrency@example.test', 'Phase 5 Concurrency');
    insert into public.workspaces (id, name, created_by)
    values ('f5910000-0000-4000-8000-000000000001', 'Phase 5 Concurrency', 'f5900000-0000-4000-8000-000000000001');
    insert into public.workspace_members (workspace_id, user_id, role, status)
    values ('f5910000-0000-4000-8000-000000000001', 'f5900000-0000-4000-8000-000000000001', 'owner', 'active');
    insert into public.business_entities (
      id, workspace_id, entity_key, entity_type, display_name, base_currency,
      timezone, fiscal_year_start_month, created_by, updated_by
    ) values (
      'f5920000-0000-4000-8000-000000000001',
      'f5910000-0000-4000-8000-000000000001',
      'phase5_concurrency',
      'operating_company',
      'Phase 5 Concurrency',
      'USD',
      'UTC',
      1,
      'f5900000-0000-4000-8000-000000000001',
      'f5900000-0000-4000-8000-000000000001'
    );
    insert into private.integration_connections (
      id, contract_version, control_contract_version, workspace_id,
      business_entity_id, connection_series_id, connection_generation,
      replaces_connection_id, provider_key, provider_environment,
      provider_tenant_reference_fingerprint, status, state_reason_code,
      requested_scopes, granted_scopes, safe_display_name,
      provider_descriptor_registry_version,
      provider_descriptor_registry_fingerprint,
      provider_descriptor_fingerprint, adapter_version, capability_snapshot,
      configuration_version, authorized_at, status_changed_at, disconnected_at,
      deleted_at, last_transition_request_id,
      last_transition_request_fingerprint, row_version, created_by, created_at,
      updated_at
    ) values (
      'f5930000-0000-4000-8000-000000000001',
      'integration_connection_v1',
      'integration_connection_control_v1',
      'f5910000-0000-4000-8000-000000000001',
      'f5920000-0000-4000-8000-000000000001',
      'f5930000-0000-4000-8000-000000000001',
      1,
      null,
      'synthetic',
      'test',
      extensions.digest(convert_to('phase5-concurrency-tenant', 'UTF8'), 'sha256'),
      'authorized_unmapped',
      'mapping_required',
      array['read_synthetic_business_data']::text[],
      array['read_synthetic_business_data']::text[],
      'Synthetic Concurrency',
      'vaeroex_provider_descriptors_v1',
      decode('f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80', 'hex'),
      decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
      'synthetic_control_plane_adapter_v1',
      jsonb_build_object(
        'operations', jsonb_build_array('get_capabilities','get_source_record','list_entities','list_source_records'),
        'domains', jsonb_build_array('general_ledger'),
        'requiredStreamKeys', jsonb_build_array('general_ledger'),
        'supportsBackfill', true,
        'webhookMode', 'none',
        'incrementalMode', 'cursor'
      ),
      1,
      '2026-08-21T22:30:00Z',
      '2026-08-21T22:30:00Z',
      null,
      null,
      null,
      null,
      1,
      'f5900000-0000-4000-8000-000000000001',
      '2026-08-21T22:30:00Z',
      '2026-08-21T22:30:00Z'
    );
    insert into private.integration_oauth_states (
      id, contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, provider_key, provider_environment, initiated_by,
      requested_scopes, return_intent, state_hash, status,
      creation_request_id, creation_request_fingerprint, consume_request_id,
      consume_request_fingerprint, created_at, expires_at, consumed_at,
      row_version
    ) values (
      'f5940000-0000-4000-8000-000000000001',
      'integration_oauth_state_v1',
      'f5910000-0000-4000-8000-000000000001',
      'f5920000-0000-4000-8000-000000000001',
      'f5930000-0000-4000-8000-000000000001',
      1,
      'synthetic',
      'test',
      'f5900000-0000-4000-8000-000000000001',
      array['read_synthetic_business_data']::text[],
      '/app/integrations',
      extensions.digest(convert_to('phase5-concurrency-state', 'UTF8'), 'sha256'),
      'consumed',
      'phase5_concurrency_create',
      extensions.digest(convert_to('phase5-concurrency-create', 'UTF8'), 'sha256'),
      'phase5_concurrency_consume',
      extensions.digest(convert_to('phase5-concurrency-consume', 'UTF8'), 'sha256'),
      '2026-08-21T22:29:00Z',
      '2026-08-21T22:39:00Z',
      '2026-08-21T22:30:00Z',
      2
    );
    insert into private.integration_credentials (
      id, contract_version, oauth_state_id, workspace_id, business_entity_id,
      connection_id, connection_generation, provider_key,
      provider_environment, initiated_by, credential_version,
      envelope_schema_version, aad_schema_version, aad_digest,
      kms_key_resource, credential_ciphertext, access_expires_at,
      refresh_expires_at, granted_scopes,
      external_entity_reference_fingerprint, status, last_request_id,
      last_request_fingerprint, row_version, created_at, updated_at
    ) values (
      'f5950000-0000-4000-8000-000000000001',
      'integration_credential_authority_v1',
      'f5940000-0000-4000-8000-000000000001',
      'f5910000-0000-4000-8000-000000000001',
      'f5920000-0000-4000-8000-000000000001',
      'f5930000-0000-4000-8000-000000000001',
      1,
      'synthetic',
      'test',
      'f5900000-0000-4000-8000-000000000001',
      1,
      'oauth_credential_envelope_v1',
      'oauth_credential_aad_v1',
      private.phase_5_credential_aad_digest_v1(
        'test',
        'f5910000-0000-4000-8000-000000000001',
        'f5930000-0000-4000-8000-000000000001',
        1,
        'synthetic',
        'f5950000-0000-4000-8000-000000000001'
      ),
      'projects/vaeroex-phase5-test/locations/us-central1/keyRings/phase5-test/cryptoKeys/oauth-credentials',
      convert_to(repeat('z', 32), 'UTF8'),
      '2026-08-21T23:30:00Z',
      '2026-09-21T22:30:00Z',
      array['read_synthetic_business_data']::text[],
      extensions.digest(convert_to('phase5-concurrency-entity', 'UTF8'), 'sha256'),
      'active',
      'phase5_concurrency_store',
      extensions.digest(convert_to('phase5-concurrency-store', 'UTF8'), 'sha256'),
      1,
      '2026-08-21T22:30:00Z',
      '2026-08-21T22:30:00Z'
    )
  $setup$
);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (values ('phase5_refresh_concurrency_1'), ('phase5_refresh_concurrency_2'))
  as connections(connection_name);

select extensions.dblink_send_query(
  'phase5_refresh_concurrency_1',
  $query$
    select public.acquire_integration_credential_refresh_lease_v1(
      jsonb_build_object(
        'workspaceId', 'f5910000-0000-4000-8000-000000000001',
        'businessEntityId', 'f5920000-0000-4000-8000-000000000001',
        'connectionId', 'f5930000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', 'f5950000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', 'f5960000-0000-4000-8000-000000000001',
        'leaseOwnerFingerprint', 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        'acquiredAt', '2026-08-21T22:31:00.000Z',
        'leaseExpiresAt', '2026-08-21T22:33:00.000Z'
      ),
      'phase5_concurrent_lease_1'
    )
  $query$
);
select extensions.dblink_send_query(
  'phase5_refresh_concurrency_2',
  $query$
    select public.acquire_integration_credential_refresh_lease_v1(
      jsonb_build_object(
        'workspaceId', 'f5910000-0000-4000-8000-000000000001',
        'businessEntityId', 'f5920000-0000-4000-8000-000000000001',
        'connectionId', 'f5930000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'credentialId', 'f5950000-0000-4000-8000-000000000001',
        'expectedCredentialVersion', 1,
        'leaseId', 'f5960000-0000-4000-8000-000000000002',
        'leaseOwnerFingerprint', 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        'acquiredAt', '2026-08-21T22:31:00.000Z',
        'leaseExpiresAt', '2026-08-21T22:33:00.000Z'
      ),
      'phase5_concurrent_lease_2'
    )
  $query$
);

create temporary table phase5_concurrent_refresh_results (
  result jsonb not null
) on commit drop;

insert into phase5_concurrent_refresh_results(result)
select result
from extensions.dblink_get_result('phase5_refresh_concurrency_1')
  as response(result jsonb);
insert into phase5_concurrent_refresh_results(result)
select result
from extensions.dblink_get_result('phase5_refresh_concurrency_2')
  as response(result jsonb);

do $drain$
declare
  v_connection text;
begin
  foreach v_connection in array array[
    'phase5_refresh_concurrency_1',
    'phase5_refresh_concurrency_2'
  ] loop
    perform *
    from extensions.dblink_get_result(v_connection) as response(result jsonb);
  end loop;
end;
$drain$;

select is(
  (select count(*)::integer from phase5_concurrent_refresh_results),
  2,
  'both concurrent refresh workers receive one authoritative result'
);
select is(
  (select count(*)::integer
   from phase5_concurrent_refresh_results
   where (result ->> 'acquired')::boolean),
  1,
  'exactly one concurrent refresh worker acquires the credential lease'
);
select is(
  (select count(*)::integer
   from phase5_concurrent_refresh_results
   where result ->> 'reasonCode' = 'refresh_lease_held'),
  1,
  'the concurrent loser receives no credential ciphertext'
);

select extensions.dblink_disconnect(connection_name)
from (values ('phase5_refresh_concurrency_1'), ('phase5_refresh_concurrency_2'))
  as connections(connection_name);

select * from finish();
rollback;
