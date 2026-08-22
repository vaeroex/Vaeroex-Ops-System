begin;

grant integration_control_plane_authority to current_user;
grant usage on schema extensions to integration_control_plane_authority;

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

create or replace function pg_temp.error_message(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$function$;

create or replace function pg_temp.fingerprint(p_value text)
returns text
language sql
immutable
as $function$
  select 'sha256:' || encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex');
$function$;

create or replace function pg_temp.connection_intent(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_display_name text,
  p_requested_at text default '2026-08-21T20:00:00.000Z'
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'integration_connection_control_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'safeDisplayName', p_display_name,
    'requestedScopes', jsonb_build_array('read_synthetic_business_data'),
    'providerDescriptorRegistryVersion', 'vaeroex_provider_descriptors_v1',
    'providerDescriptorRegistryFingerprint',
      'sha256:f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80',
    'providerDescriptorFingerprint',
      'sha256:d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1',
    'adapterVersion', 'synthetic_control_plane_adapter_v1',
    'capabilitySnapshot', jsonb_build_object(
      'operations', jsonb_build_array(
        'get_capabilities',
        'get_source_record',
        'list_entities',
        'list_source_records'
      ),
      'domains', jsonb_build_array('general_ledger'),
      'requiredStreamKeys', jsonb_build_array('general_ledger'),
      'supportsBackfill', true,
      'webhookMode', 'none',
      'incrementalMode', 'cursor'
    ),
    'configurationVersion', 1,
    'requestedAt', p_requested_at
  );
$function$;

create or replace function pg_temp.connection_transition(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_row_version bigint,
  p_generation bigint,
  p_target_status text,
  p_reason text,
  p_tenant_fingerprint text,
  p_granted_scopes jsonb,
  p_transitioned_at text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'expectedRowVersion', p_row_version,
    'expectedGeneration', p_generation,
    'targetStatus', p_target_status,
    'stateReasonCode', p_reason,
    'providerTenantReferenceFingerprint', p_tenant_fingerprint,
    'grantedScopes', p_granted_scopes,
    'transitionedAt', p_transitioned_at
  );
$function$;

create or replace function pg_temp.workspace_policy(
  p_id uuid,
  p_workspace_id uuid,
  p_state text,
  p_row_version bigint
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'integration_workspace_policy_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'providerKey', 'synthetic',
    'providerEnvironment', 'test',
    'state', p_state,
    'syncEnabled', p_state = 'enabled',
    'historyHorizonDays', 365,
    'maximumConcurrency', 2,
    'freshnessPolicyVersion', 'synthetic_freshness_policy_v1',
    'retentionPolicyVersion', 'synthetic_metadata_retention_v1',
    'rowVersion', p_row_version
  );
$function$;

create or replace function pg_temp.mapping_create(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_reference_fingerprint text,
  p_name text,
  p_replaces_mapping_id uuid default null
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'provider_entity_mapping_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'providerEntityType', 'company',
    'providerEntityReferenceFingerprint', p_reference_fingerprint,
    'safeDisplayName', p_name,
    'mappingRole', 'primary',
    'mappedAt', '2026-08-21T20:05:00.000Z',
    'replacesMappingId', p_replaces_mapping_id
  );
$function$;

create or replace function pg_temp.mapping_transition(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_mapping_id uuid,
  p_row_version bigint,
  p_target_status text,
  p_verification_fingerprint text,
  p_transitioned_at text default '2026-08-21T20:06:00.000Z'
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'mappingId', p_mapping_id,
    'expectedRowVersion', p_row_version,
    'targetStatus', p_target_status,
    'verificationFingerprint', p_verification_fingerprint,
    'transitionedAt', p_transitioned_at
  );
$function$;

create or replace function pg_temp.sync_run_create(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_mapping_id uuid,
  p_idempotency_fingerprint text,
  p_trigger text,
  p_mode text,
  p_created_at text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'integration_sync_run_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'mappingId', p_mapping_id,
    'trigger', p_trigger,
    'mode', p_mode,
    'idempotencyFingerprint', p_idempotency_fingerprint,
    'windowStartAt', null,
    'windowEndAt', null,
    'providerContractVersion', 'provider_adapter_v1',
    'adapterVersion', 'synthetic_control_plane_adapter_v1',
    'policyVersion', 'synthetic_sync_policy_v1',
    'createdAt', p_created_at
  );
$function$;

create or replace function pg_temp.sync_run_transition(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_sync_run_id uuid,
  p_row_version bigint,
  p_target_state text,
  p_records_observed bigint,
  p_records_accepted bigint,
  p_records_rejected bigint,
  p_error_category text,
  p_error_code text,
  p_transitioned_at text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'syncRunId', p_sync_run_id,
    'expectedRowVersion', p_row_version,
    'targetState', p_target_state,
    'counts', jsonb_build_object(
      'recordsObserved', p_records_observed,
      'recordsAccepted', p_records_accepted,
      'recordsRejected', p_records_rejected,
      'factsAccepted', 0,
      'contributionsChanged', 0
    ),
    'errorCategory', p_error_category,
    'errorCode', p_error_code,
    'transitionedAt', p_transitioned_at
  );
$function$;

create or replace function pg_temp.freshness_command(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_mapping_id uuid,
  p_scope_key text,
  p_last_attempt_at text,
  p_last_successful_sync_at text,
  p_calculated_at text,
  p_expected_row_version bigint
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'mappingId', p_mapping_id,
    'domain', 'general_ledger',
    'scopeKey', p_scope_key,
    'providerWatermarkAt', null,
    'lastAttemptAt', p_last_attempt_at,
    'lastSuccessfulSyncAt', p_last_successful_sync_at,
    'lastReconciledAt', p_last_successful_sync_at,
    'observedLagSeconds', 120,
    'policyVersion', 'synthetic_freshness_policy_v1',
    'currentMaxAgeSeconds', 3600,
    'staleAfterSeconds', 7200,
    'staleBlockingLevel', 'current_intelligence',
    'calculatedAt', p_calculated_at,
    'expectedRowVersion', p_expected_row_version
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a7400000-0000-4000-8000-000000000001', 'phase4-owner@example.test', 'Phase 4 Owner'),
  ('a7400000-0000-4000-8000-000000000002', 'phase4-admin@example.test', 'Phase 4 Admin'),
  ('a7400000-0000-4000-8000-000000000003', 'phase4-manager@example.test', 'Phase 4 Manager'),
  ('a7400000-0000-4000-8000-000000000004', 'phase4-staff@example.test', 'Phase 4 Staff'),
  ('a7400000-0000-4000-8000-000000000005', 'phase4-viewer@example.test', 'Phase 4 Viewer'),
  ('a7400000-0000-4000-8000-000000000006', 'phase4-nonmember@example.test', 'Phase 4 Nonmember'),
  ('a7400000-0000-4000-8000-000000000007', 'phase4-other-owner@example.test', 'Phase 4 Other Owner');

insert into public.workspaces (id, name, created_by) values
  ('b7400000-0000-4000-8000-000000000001', 'Phase 4 Workspace A', 'a7400000-0000-4000-8000-000000000001'),
  ('b7400000-0000-4000-8000-000000000002', 'Phase 4 Workspace B', 'a7400000-0000-4000-8000-000000000007');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c7400000-0000-4000-8000-000000000001', 'b7400000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c7400000-0000-4000-8000-000000000002', 'b7400000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('c7400000-0000-4000-8000-000000000003', 'b7400000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000003', 'manager', 'active'),
  ('c7400000-0000-4000-8000-000000000004', 'b7400000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000004', 'staff', 'active'),
  ('c7400000-0000-4000-8000-000000000005', 'b7400000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000005', 'viewer', 'active'),
  ('c7400000-0000-4000-8000-000000000007', 'b7400000-0000-4000-8000-000000000002', 'a7400000-0000-4000-8000-000000000007', 'owner', 'active');

insert into public.business_entities (
  id,
  workspace_id,
  contract_version,
  entity_key,
  entity_type,
  display_name,
  base_currency,
  timezone,
  fiscal_year_start_month,
  status,
  created_by,
  updated_by,
  created_at,
  updated_at
) values
  (
    'd7400000-0000-4000-8000-000000000001',
    'b7400000-0000-4000-8000-000000000001',
    'business_entity_v1',
    'phase4_company_a',
    'operating_company',
    'Phase 4 Company A',
    'USD',
    'UTC',
    1,
    'active',
    'a7400000-0000-4000-8000-000000000001',
    'a7400000-0000-4000-8000-000000000001',
    '2026-08-21T19:00:00Z',
    '2026-08-21T19:00:00Z'
  ),
  (
    'd7400000-0000-4000-8000-000000000002',
    'b7400000-0000-4000-8000-000000000002',
    'business_entity_v1',
    'phase4_company_b',
    'operating_company',
    'Phase 4 Company B',
    'USD',
    'UTC',
    1,
    'active',
    'a7400000-0000-4000-8000-000000000007',
    'a7400000-0000-4000-8000-000000000007',
    '2026-08-21T19:00:00Z',
    '2026-08-21T19:00:00Z'
  );

select ok(
  exists (
    select 1
    from pg_roles
    where rolname = 'integration_control_plane_authority'
      and not rolcanlogin
      and not rolinherit
  ),
  'the control-plane authority is non-login and non-inheriting'
);

select is(
  (
    select count(*)::integer
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'private'
      and pg_class.relname in (
        'integration_connections',
        'provider_entity_mappings',
        'integration_sync_runs',
        'integration_freshness_states',
        'integration_workspace_policies'
      )
      and pg_class.relrowsecurity
      and pg_class.relforcerowsecurity
  ),
  5,
  'all five authoritative Phase 4 tables have forced RLS'
);

select is(
  (
    select count(*)::integer
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relname in (
        'integration_connection_summaries',
        'integration_freshness_summaries'
      )
      and pg_class.relrowsecurity
      and pg_class.relforcerowsecurity
  ),
  2,
  'both customer-safe summary tables have forced RLS'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'integration_connection_summaries',
        'integration_freshness_summaries'
      )
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
  ),
  2,
  'customer summaries expose only authenticated member-read policies'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('service_role', 'private', 'USAGE')
  and not has_schema_privilege('external_integrations_authority', 'private', 'USAGE')
  and not has_schema_privilege('deterministic_calculation_authority', 'private', 'USAGE')
  and not has_schema_privilege('integration_control_plane_authority', 'private', 'USAGE'),
  'no browser, service, or authority role has private-schema usage'
);

select ok(
  not has_table_privilege('anon', 'private.integration_connections', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'private.provider_entity_mappings', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'private.integration_sync_runs', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('external_integrations_authority', 'private.integration_freshness_states', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('deterministic_calculation_authority', 'private.integration_workspace_policies', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('integration_control_plane_authority', 'private.integration_connections', 'SELECT,INSERT,UPDATE,DELETE'),
  'all Phase 4 private tables deny direct access to every runtime role'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_integration_connection_intent_v1(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.request_integration_disconnect_v1(uuid,bigint,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.transition_integration_connection_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'authenticated users receive only narrow intent and disconnect commands'
);

select ok(
  has_function_privilege(
    'integration_control_plane_authority',
    'public.transition_integration_connection_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_control_plane_authority',
    'public.create_provider_entity_mapping_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_control_plane_authority',
    'public.create_integration_sync_run_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_control_plane_authority',
    'public.upsert_integration_freshness_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'the new authority receives only checked control-plane RPC execution'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.transition_integration_connection_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'external_integrations_authority',
    'public.create_provider_entity_mapping_v1(jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'deterministic_calculation_authority',
    'public.upsert_integration_freshness_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'service and prior authority roles receive no Phase 4 shortcut'
);

select ok(
  not has_function_privilege(
    'integration_control_plane_authority',
    'public.commit_external_source_record_version_v1(text,jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_control_plane_authority',
    'public.finalize_deterministic_change_set_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'the control-plane authority cannot mutate source/fact or deterministic state'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema in ('private', 'public')
      and table_name in (
        'integration_connections',
        'provider_entity_mappings',
        'integration_sync_runs',
        'integration_freshness_states',
        'integration_workspace_policies',
        'integration_connection_summaries',
        'integration_freshness_summaries'
      )
      and column_name ~* '(access|refresh).*token|client.*secret|authorization.*code|credential|raw.*payload|provider.*payload'
  ),
  0,
  'Phase 4 tables contain no credential-shaped or provider-payload columns'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'integration_connection_summaries',
        'integration_freshness_summaries'
      )
      and column_name in (
        'provider_tenant_reference_fingerprint',
        'provider_entity_reference_fingerprint',
        'provider_descriptor_fingerprint',
        'provider_watermark_at',
        'mapping_id',
        'error_code',
        'error_category',
        'last_transition_request_id'
      )
  ),
  0,
  'customer summaries omit private provider and operational identifiers'
);

select ok(
  private.is_phase_4_provider_descriptor_v1(
    'synthetic',
    'test',
    'vaeroex_provider_descriptors_v1',
    decode('f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80', 'hex'),
    decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
    'synthetic_control_plane_adapter_v1'
  )
  and not private.is_phase_4_provider_descriptor_v1(
    'synthetic',
    'test',
    'vaeroex_provider_descriptors_v1',
    decode(repeat('0', 64), 'hex'),
    decode('d5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1', 'hex'),
    'synthetic_control_plane_adapter_v1'
  ),
  'the exact code-defined registry is pinned and forged descriptors fail closed'
);

set local role anon;
select ok(
  not has_function_privilege(
    'anon',
    'public.create_integration_connection_intent_v1(jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot create connection intent'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000004"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000099',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Staff Forgery'
      )
    )$$,
    '42501'
  ),
  'a Staff contributor cannot create connector intent'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000006"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000098',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Nonmember Forgery'
      )
    )$$,
    '42501'
  ),
  'an authenticated nonmember cannot forge workspace connection intent'
);
select is(
  (select count(*)::integer from public.integration_connection_summaries),
  0,
  'an authenticated nonmember reads no connection summaries'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000003"}',
  true
);
set local role authenticated;
select is(
  (
    public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Synthetic Company A'
      )
    ) -> 'connection' ->> 'status'
  ),
  'pending_authorization'::text,
  'a Manager creates a scoped connection intent in the canonical initial state'::text
);
select is(
  (
    public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Synthetic Company A'
      )
    ) ->> 'idempotent'
  ),
  'true'::text,
  'connection-intent replay is idempotent'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000097',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Forged Registry'
      ) || jsonb_build_object(
        'providerDescriptorRegistryFingerprint', 'sha256:' || repeat('0', 64)
      )
    )$$,
    '22023'
  ),
  'a forged provider descriptor fingerprint is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.integration_connection_summaries
      set status = 'active'
      where id = 'e7400000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'a Manager cannot directly set a customer summary active'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000002"}',
  true
);
set local role authenticated;
select is(
  (
    public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000003',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'Synthetic Error Recovery'
      )
    ) -> 'connection' ->> 'status'
  ),
  'pending_authorization'::text,
  'an Admin may create connector intent'::text
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000007"}',
  true
);
set local role authenticated;
select is(
  (
    public.create_integration_connection_intent_v1(
      pg_temp.connection_intent(
        'e7400000-0000-4000-8000-000000000002',
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'Synthetic Company B'
      )
    ) -> 'connection' ->> 'status'
  ),
  'pending_authorization'::text,
  'a Workspace B Owner creates only Workspace B connection intent'::text
);
select is(
  (select count(*)::integer from public.integration_connection_summaries),
  1,
  'Workspace B reads only its own connection summary'
);
reset role;

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      '{}'::jsonb,
      'service_role_forgery',
      'service_role'
    )$$,
    '42501'
  ),
  'service_role cannot execute control-plane authority transitions'
);
reset role;

set local role integration_control_plane_authority;

select is(
  (
    public.upsert_integration_workspace_policy_v1(
      pg_temp.workspace_policy(
        '07400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'enabled',
        1
      ),
      'policy_a_create',
      'phase4_test_service'
    ) ->> 'rowVersion'
  ),
  '1'::text,
  'the authority creates Workspace A synthetic integration policy'::text
);
select is(
  (
    public.upsert_integration_workspace_policy_v1(
      pg_temp.workspace_policy(
        '07400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'enabled',
        1
      ),
      'policy_a_create',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'workspace policy replay is idempotent'::text
);
select is(
  (
    public.upsert_integration_workspace_policy_v1(
      pg_temp.workspace_policy(
        '07400000-0000-4000-8000-000000000002',
        'b7400000-0000-4000-8000-000000000002',
        'enabled',
        1
      ),
      'policy_b_create',
      'phase4_test_service'
    ) ->> 'rowVersion'
  ),
  '1'::text,
  'the authority creates Workspace B policy without cross-tenant reuse'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.upsert_integration_workspace_policy_v1(
      pg_temp.workspace_policy(
        '07400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'paused',
        99
      ),
      'policy_a_stale',
      'phase4_test_service'
    )$$,
    '40001'
  ),
  'workspace policy CAS rejects stale row versions'
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        1,
        1,
        'authorized_unmapped',
        'mapping_required',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:02:00.000Z'
      ),
      'connection_a_authorized',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'authorized_unmapped'::text,
  'synthetic authorization metadata advances only to authorized_unmapped'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        1,
        1,
        'authorized_unmapped',
        'mapping_required',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:02:00.000Z'
      ),
      'connection_a_authorized',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'the exact connection transition request replays idempotently'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        1,
        1,
        'authorized_unmapped',
        'authorization_completed',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:02:00.000Z'
      ),
      'connection_a_authorized',
      'phase4_test_service'
    )$$,
    '40001'
  ),
  'an altered request cannot borrow an idempotency key'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000001',
        2,
        1,
        'initializing',
        'initial_sync_pending',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:03:00.000Z'
      ),
      'connection_cross_workspace',
      'phase4_test_service'
    )$$,
    '42501'
  ),
  'a valid connection ID cannot be substituted across workspace and entity scope'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        2,
        1,
        'active',
        'healthy',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:03:00.000Z'
      ),
      'connection_active_without_initializing',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'a caller cannot skip the canonical mapping and initialization lifecycle'
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        1,
        1,
        'authorized_unmapped',
        'mapping_required',
        pg_temp.fingerprint('tenant-b'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:02:00.000Z'
      ),
      'connection_b_authorized',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'authorized_unmapped'::text,
  'Workspace B authorization remains independently scoped'::text
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000003',
        1,
        1,
        'error',
        'control_plane_error',
        null,
        '[]'::jsonb,
        '2026-08-21T20:02:00.000Z'
      ),
      'connection_c_error',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'error'::text,
  'pending authorization can fail into the canonical error state'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000003',
        2,
        1,
        'pending_authorization',
        'authorization_pending',
        null,
        '[]'::jsonb,
        '2026-08-21T20:03:00.000Z'
      ),
      'connection_c_error_recovery',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'pending_authorization'::text,
  'error recovery returns deterministically to pending authorization'::text
);

select is(
  (
    public.create_provider_entity_mapping_v1(
      pg_temp.mapping_create(
        'f7400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('shared-provider-company'),
        'Synthetic Entity A'
      ),
      'mapping_a_create',
      'phase4_test_service'
    ) ->> 'status'
  ),
  'pending_verification'::text,
  'a same-scope provider entity mapping starts pending verification'::text
);
select is(
  (
    public.create_provider_entity_mapping_v1(
      pg_temp.mapping_create(
        'f7400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('shared-provider-company'),
        'Synthetic Entity A'
      ),
      'mapping_a_create',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'mapping creation replays idempotently with the same request fingerprint'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_provider_entity_mapping_v1(
      pg_temp.mapping_create(
        'f7400000-0000-4000-8000-000000000099',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000002',
        pg_temp.fingerprint('cross-workspace-forgery'),
        'Cross Workspace Forgery'
      ),
      'mapping_cross_workspace',
      'phase4_test_service'
    )$$,
    '42501'
  ),
  'a Workspace B connection cannot be substituted into a Workspace A mapping'
);
select is(
  (
    public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        1,
        'active',
        pg_temp.fingerprint('mapping-a-verification')
      ),
      'mapping_a_activate',
      'phase4_test_service'
    ) ->> 'status'
  ),
  'active'::text,
  'synthetic verification activates the mapping through the checked gate'::text
);
select is(
  (
    public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        1,
        'active',
        pg_temp.fingerprint('mapping-a-verification')
      ),
      'mapping_a_activate',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'mapping transition replay is idempotent'::text
);

select is(
  (
    public.create_provider_entity_mapping_v1(
      pg_temp.mapping_create(
        'f7400000-0000-4000-8000-000000000002',
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        pg_temp.fingerprint('shared-provider-company'),
        'Synthetic Entity B Duplicate'
      ),
      'mapping_b_create',
      'phase4_test_service'
    ) ->> 'status'
  ),
  'pending_verification'::text,
  'a duplicate external identity can be staged without leaking its owner'::text
);
select is(
  pg_temp.error_message(
    $$select public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        'f7400000-0000-4000-8000-000000000002',
        1,
        'active',
        pg_temp.fingerprint('mapping-b-verification')
      ),
      'mapping_b_activate_duplicate',
      'phase4_test_service'
    )$$
  ),
  'provider_entity_already_connected'::text,
  'global active-entity conflict returns a generic no-existence-leak message'::text
);
select is(
  (
    public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        'f7400000-0000-4000-8000-000000000002',
        1,
        'inactive',
        null
      ),
      'mapping_b_inactive',
      'phase4_test_service'
    ) ->> 'status'
  ),
  'inactive'::text,
  'a rejected duplicate mapping can enter the inactive lifecycle state'::text
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        2,
        1,
        'initializing',
        'initial_sync_pending',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:07:00.000Z'
      ),
      'connection_a_initializing',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'initializing'::text,
  'an active verified mapping satisfies the initialization gate'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        3,
        1,
        'active',
        'healthy',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T20:08:00.000Z'
      ),
      'connection_a_active_too_early',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'active is rejected before successful initial sync and safe freshness'
);

select is(
  (
    public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('initial-sync-a'),
        'synthetic_verification',
        'initialization',
        '2026-08-21T20:10:00.000Z'
      ),
      'sync_a_initial_create',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'created'::text,
  'a logical synthetic sync run is metadata-only and starts created'::text
);
select is(
  (
    public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('initial-sync-a'),
        'synthetic_verification',
        'initialization',
        '2026-08-21T20:10:00.000Z'
      ),
      'sync_a_initial_retry',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'logical sync-run creation is idempotent by scoped fingerprint'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000099',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000002',
        pg_temp.fingerprint('cross-mapping-run'),
        'synthetic_verification',
        'initialization',
        '2026-08-21T20:10:00.000Z'
      ),
      'sync_cross_mapping',
      'phase4_test_service'
    )$$,
    '42501'
  ),
  'a valid cross-workspace mapping ID cannot be substituted into a sync run'
);

select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000001',
        1,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T20:11:00.000Z'
      ),
      'sync_a_initial_running',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'running'::text,
  'a created sync run transitions to running'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000001',
        1,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T20:11:00.000Z'
      ),
      'sync_a_initial_running',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'sync-run transition replay is idempotent'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000001',
        2,
        'succeeded',
        3,
        2,
        2,
        null,
        null,
        '2026-08-21T20:12:00.000Z'
      ),
      'sync_a_bad_counts',
      'phase4_test_service'
    )$$,
    '22023'
  ),
  'bounded sync counters reject accepted-plus-rejected overflow'
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000001',
        2,
        'succeeded',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T20:12:00.000Z'
      ),
      'sync_a_initial_succeeded',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'succeeded'::text,
  'the synthetic initialization run reaches a terminal success state'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000001',
        3,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T20:13:00.000Z'
      ),
      'sync_a_terminal_restart',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'a terminal sync run cannot restart'
);

select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:30:00.000Z',
        null
      ),
      'freshness_a_current',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'current'::text,
  'freshness is current within the registered synthetic threshold'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:30:00.000Z',
        null
      ),
      'freshness_a_current',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'freshness upsert replay is idempotent'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:11:00.000Z',
        '2026-08-21T20:31:00.000Z',
        1
      ),
      'freshness_a_forged_success',
      'phase4_test_service'
    )$$,
    '22023'
  ),
  'freshness rejects a success timestamp not backed by persisted sync state'
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T21:30:00.000Z',
        1
      ),
      'freshness_a_aging',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'aging'::text,
  'freshness deterministically enters aging'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T20:12:00.000Z',
        '2026-08-21T22:30:01.000Z',
        2
      ),
      'freshness_a_stale',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'stale'::text,
  'freshness deterministically enters stale and fails closed'::text
);

select is(
  (
    public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000002',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('recovery-sync-a-1'),
        'recovery',
        'incremental',
        '2026-08-21T22:31:00.000Z'
      ),
      'sync_a_recovery_1_create',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'created'::text,
  'a recovery run uses the same provider-neutral metadata model'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000002',
        1,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T22:32:00.000Z'
      ),
      'sync_a_recovery_1_running',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'running'::text,
  'the recovery run starts deterministically'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000002',
        2,
        'succeeded',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T22:33:00.000Z'
      ),
      'sync_a_recovery_1_succeeded',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'succeeded'::text,
  'a later successful run supplies new persisted freshness evidence'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T22:33:00.000Z',
        '2026-08-21T22:33:00.000Z',
        '2026-08-21T22:40:00.000Z',
        3
      ),
      'freshness_a_recovered_current',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'current'::text,
  'a fresh successful run deterministically recovers current status'::text
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        3,
        1,
        'active',
        'healthy',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:41:00.000Z'
      ),
      'connection_a_active',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'active'::text,
  'verified mapping, successful initialization, and current freshness satisfy activation'::text
);

select is(
  (
    public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000003',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('failed-sync-a'),
        'recovery',
        'incremental',
        '2026-08-21T22:42:00.000Z'
      ),
      'sync_a_failure_create',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'created'::text,
  'a later failure remains logical sync metadata only'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000003',
        1,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T22:43:00.000Z'
      ),
      'sync_a_failure_running',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'running'::text,
  'the failure fixture first enters running'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000003',
        2,
        'failed',
        0,
        0,
        0,
        'availability',
        'synthetic_unavailable',
        '2026-08-21T22:44:00.000Z'
      ),
      'sync_a_failure_terminal',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'failed'::text,
  'failed runs persist only redacted category and code'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T22:44:00.000Z',
        '2026-08-21T22:33:00.000Z',
        '2026-08-21T22:45:00.000Z',
        4
      ),
      'freshness_a_sync_error',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'sync_error'::text,
  'the latest persisted run failure overrides timer freshness'::text
);

select is(
  (
    public.create_integration_sync_run_v1(
      pg_temp.sync_run_create(
        '17400000-0000-4000-8000-000000000004',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        pg_temp.fingerprint('recovery-sync-a-2'),
        'recovery',
        'incremental',
        '2026-08-21T22:46:00.000Z'
      ),
      'sync_a_recovery_2_create',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'created'::text,
  'a second recovery attempt remains isolated by idempotency fingerprint'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000004',
        1,
        'running',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T22:47:00.000Z'
      ),
      'sync_a_recovery_2_running',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'running'::text,
  'the second recovery attempt starts'::text
);
select is(
  (
    public.transition_integration_sync_run_v1(
      pg_temp.sync_run_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        '17400000-0000-4000-8000-000000000004',
        2,
        'succeeded',
        0,
        0,
        0,
        null,
        null,
        '2026-08-21T22:48:00.000Z'
      ),
      'sync_a_recovery_2_succeeded',
      'phase4_test_service'
    ) ->> 'state'
  ),
  'succeeded'::text,
  'the second recovery attempt succeeds'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T22:48:00.000Z',
        '2026-08-21T22:48:00.000Z',
        '2026-08-21T22:50:00.000Z',
        5
      ),
      'freshness_a_current_again',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'current'::text,
  'freshness recovers from sync_error only after a persisted success'::text
);

select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000002',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000003',
        null,
        'synthetic_unknown',
        null,
        null,
        '2026-08-21T22:50:00.000Z',
        null
      ),
      'freshness_c_unknown',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'unknown'::text,
  'a connection with no successful run remains canonically unknown'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000099',
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000001',
        null,
        'forged_scope',
        null,
        null,
        '2026-08-21T22:50:00.000Z',
        null
      ),
      'freshness_cross_workspace',
      'phase4_test_service'
    )$$,
    '42501'
  ),
  'freshness rejects cross-workspace connection substitution'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_connections
      set status = 'active'
      where id = 'e7400000-0000-4000-8000-000000000003'$$,
    '42501'
  ),
  'the authority cannot bypass checked RPCs with direct active mutation'
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        4,
        1,
        'degraded',
        'freshness_warning',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:51:00.000Z'
      ),
      'connection_a_degraded',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'degraded'::text,
  'active can enter the canonical degraded state'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        5,
        1,
        'active',
        'healthy',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:52:00.000Z'
      ),
      'connection_a_degraded_recovery',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'active'::text,
  'degraded recovery reuses the same activation gates'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        6,
        1,
        'error',
        'control_plane_error',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:53:00.000Z'
      ),
      'connection_a_invalid_active_error',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'the exact canonical matrix rejects active directly to error'
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        6,
        1,
        'reauthorization_required',
        'authorization_required',
        pg_temp.fingerprint('tenant-a'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:54:00.000Z'
      ),
      'connection_a_reauthorization_required',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'reauthorization_required'::text,
  'active can enter the canonical reauthorization-required state'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        7,
        1,
        'pending_authorization',
        'authorization_required',
        null,
        '[]'::jsonb,
        '2026-08-21T22:55:00.000Z'
      ),
      'connection_a_reauthorization_pending',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'pending_authorization'::text,
  'reauthorization recovery clears prior authorization evidence'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        8,
        1,
        'authorized_unmapped',
        'mapping_required',
        pg_temp.fingerprint('tenant-a-reauthorized'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:56:00.000Z'
      ),
      'connection_a_reauthorized',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'authorized_unmapped'::text,
  'reauthorization records a fresh synthetic authorization fingerprint'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        9,
        1,
        'initializing',
        'initial_sync_pending',
        pg_temp.fingerprint('tenant-a-reauthorized'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:57:00.000Z'
      ),
      'connection_a_reauthorization_initializing',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'initializing'::text,
  'reauthorization recovery returns through initialization'::text
);
select is(
  (
    public.upsert_integration_freshness_v1(
      pg_temp.freshness_command(
        '27400000-0000-4000-8000-000000000001',
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        'f7400000-0000-4000-8000-000000000001',
        'synthetic_company_a',
        '2026-08-21T22:48:00.000Z',
        '2026-08-21T22:48:00.000Z',
        '2026-08-21T22:58:00.000Z',
        7
      ),
      'freshness_a_after_reauthorization',
      'phase4_test_service'
    ) -> 'freshness' ->> 'status'
  ),
  'current'::text,
  'freshness must be explicitly recalculated after reauthorization'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        10,
        1,
        'active',
        'healthy',
        pg_temp.fingerprint('tenant-a-reauthorized'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T22:59:00.000Z'
      ),
      'connection_a_active_after_reauthorization',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'active'::text,
  'reauthorization recovery can return to active only through all gates'::text
);

select is(
  (
    public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        'f7400000-0000-4000-8000-000000000002',
        2,
        'replaced',
        null,
        '2026-08-21T23:00:00.000Z'
      ),
      'mapping_b_replaced',
      'phase4_test_service'
    ) ->> 'status'
  ),
  'replaced'::text,
  'inactive mapping history can be closed as replaced without rewriting identity'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_provider_entity_mapping_v1(
      pg_temp.mapping_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        'f7400000-0000-4000-8000-000000000002',
        3,
        'active',
        pg_temp.fingerprint('replaced-mapping-forgery'),
        '2026-08-21T23:01:00.000Z'
      ),
      'mapping_b_replaced_mutation',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'a replaced mapping is terminal'
);

select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        2,
        1,
        'deleting',
        'deletion_requested',
        pg_temp.fingerprint('tenant-b'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T23:02:00.000Z'
      ),
      'connection_b_deleting',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'deleting'::text,
  'a connection with no active mapping or run can enter deleting'::text
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        3,
        1,
        'deleted',
        'deleted',
        pg_temp.fingerprint('tenant-b'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T23:03:00.000Z'
      ),
      'connection_b_deleted',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'deleted'::text,
  'the deletion lifecycle reaches the canonical terminal state'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000002',
        'd7400000-0000-4000-8000-000000000002',
        'e7400000-0000-4000-8000-000000000002',
        4,
        1,
        'deleting',
        'deletion_requested',
        pg_temp.fingerprint('tenant-b'),
        jsonb_build_array('read_synthetic_business_data'),
        '2026-08-21T23:04:00.000Z'
      ),
      'connection_b_deleted_mutation',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'deleted connection state is immutable'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000004"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.request_integration_disconnect_v1(
      'e7400000-0000-4000-8000-000000000001',
      11,
      'staff_disconnect_forgery'
    )$$,
    '42501'
  ),
  'a Staff contributor cannot request disconnect'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000003"}',
  true
);
set local role authenticated;
select is(
  (
    public.request_integration_disconnect_v1(
      'e7400000-0000-4000-8000-000000000001',
      11,
      'manager_disconnect_a'
    ) -> 'connection' ->> 'status'
  ),
  'disconnecting'::text,
  'a Manager can request disconnect through the narrow customer command'::text
);
select is(
  (
    public.request_integration_disconnect_v1(
      'e7400000-0000-4000-8000-000000000001',
      11,
      'manager_disconnect_a'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'disconnect request replay is idempotent despite the consumed row version'::text
);
select is(
  (
    select status
    from public.integration_freshness_summaries
    where id = '27400000-0000-4000-8000-000000000001'
  ),
  'disconnected'::text,
  'disconnect intent immediately fails customer freshness closed'::text
);
reset role;

set local role integration_control_plane_authority;
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        12,
        1,
        'disconnected',
        'disconnected',
        pg_temp.fingerprint('tenant-a-reauthorized'),
        jsonb_build_array('read_synthetic_business_data'),
        (transaction_timestamp() + interval '1 minute')::text
      ),
      'connection_a_disconnected',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'disconnected'::text,
  'the checked authority completes the disconnect lifecycle'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000001',
        13,
        1,
        'pending_authorization',
        'authorization_pending',
        null,
        '[]'::jsonb,
        '2026-08-21T23:02:00.000Z'
      ),
      'connection_a_in_place_reconnect',
      'phase4_test_service'
    )$$,
    '55000'
  ),
  'a disconnected authorization identity cannot be reconnected in place'
);

select is(
  (
    public.replace_integration_connection_generation_v1(
      jsonb_build_object(
        'workspaceId', 'b7400000-0000-4000-8000-000000000001',
        'businessEntityId', 'd7400000-0000-4000-8000-000000000001',
        'priorConnectionId', 'e7400000-0000-4000-8000-000000000001',
        'expectedPriorRowVersion', 13,
        'replacementConnectionId', 'e7400000-0000-4000-8000-000000000004',
        'safeDisplayName', 'Synthetic Company A Reconnected',
        'requestedScopes', jsonb_build_array('read_synthetic_business_data'),
        'configurationVersion', 2,
        'requestedAt', '2026-08-21T23:03:00.000Z'
      ),
      'connection_a_generation_2',
      'phase4_test_service'
    ) -> 'connection' ->> 'connectionGeneration'
  ),
  '2'::text,
  'reconnect creates a new immutable authorization generation'::text
);
select is(
  (
    public.replace_integration_connection_generation_v1(
      jsonb_build_object(
        'workspaceId', 'b7400000-0000-4000-8000-000000000001',
        'businessEntityId', 'd7400000-0000-4000-8000-000000000001',
        'priorConnectionId', 'e7400000-0000-4000-8000-000000000001',
        'expectedPriorRowVersion', 13,
        'replacementConnectionId', 'e7400000-0000-4000-8000-000000000004',
        'safeDisplayName', 'Synthetic Company A Reconnected',
        'requestedScopes', jsonb_build_array('read_synthetic_business_data'),
        'configurationVersion', 2,
        'requestedAt', '2026-08-21T23:03:00.000Z'
      ),
      'connection_a_generation_2',
      'phase4_test_service'
    ) ->> 'idempotent'
  ),
  'true'::text,
  'replacement generation semantics are idempotent'::text
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000004',
        1,
        1,
        'error',
        'control_plane_error',
        null,
        '[]'::jsonb,
        '2026-08-21T23:04:00.000Z'
      ),
      'connection_a_generation_stale',
      'phase4_test_service'
    )$$,
    '40001'
  ),
  'a stale generation cannot transition the replacement connection'
);
select is(
  (
    public.transition_integration_connection_v1(
      pg_temp.connection_transition(
        'b7400000-0000-4000-8000-000000000001',
        'd7400000-0000-4000-8000-000000000001',
        'e7400000-0000-4000-8000-000000000004',
        1,
        2,
        'error',
        'control_plane_error',
        null,
        '[]'::jsonb,
        '2026-08-21T23:04:00.000Z'
      ),
      'connection_a_generation_2_error',
      'phase4_test_service'
    ) -> 'connection' ->> 'status'
  ),
  'error'::text,
  'the current replacement generation may transition independently'::text
);

select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_connections
      where id = 'e7400000-0000-4000-8000-000000000002'$$,
    '42501'
  ),
  'the authority cannot physically delete historical connection proof'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000005"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.integration_connection_summaries),
  3,
  'a Workspace A Viewer reads all and only Workspace A connection generations'
);
select is(
  (select count(*)::integer from public.integration_freshness_summaries),
  2,
  'a Workspace A Viewer reads all and only Workspace A safe freshness summaries'
);
select is(
  (
    select status
    from public.integration_connection_summaries
    where id = 'e7400000-0000-4000-8000-000000000001'
  ),
  'disconnected'::text,
  'the historical generation remains customer-visible as disconnected'::text
);
select is(
  (
    select connection_generation
    from public.integration_connection_summaries
    where id = 'e7400000-0000-4000-8000-000000000004'
  ),
  2::bigint,
  'the safe summary exposes the replacement generation without private fingerprints'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.integration_freshness_summaries
      set blocking_level = 'none'
      where id = '27400000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'a Viewer cannot directly weaken freshness blocking metadata'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000007"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.integration_connection_summaries),
  1,
  'Workspace B reads no Workspace A connection metadata'
);
select is(
  (
    select status
    from public.integration_connection_summaries
    where id = 'e7400000-0000-4000-8000-000000000002'
  ),
  'deleted'::text,
  'Workspace B sees its own safe terminal status'::text
);
select is(
  (select count(*)::integer from public.integration_freshness_summaries),
  0,
  'Workspace B cannot infer Workspace A freshness or provider identity'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7400000-0000-4000-8000-000000000006"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.integration_connection_summaries),
  0,
  'a nonmember cannot inspect any safe connection metadata'
);
select is(
  (select count(*)::integer from public.integration_freshness_summaries),
  0,
  'a nonmember cannot inspect any safe freshness metadata'
);
reset role;

select is(
  (
    select count(*)::integer
    from private.integration_connections
    where id in (
      'e7400000-0000-4000-8000-000000000001',
      'e7400000-0000-4000-8000-000000000004'
    )
      and connection_series_id = 'e7400000-0000-4000-8000-000000000001'
  ),
  2,
  'both immutable connection generations retain one series identity'
);
select is(
  (
    select count(*)::integer
    from private.external_source_records
    where connection_id is not null
  ),
  0,
  'synthetic control-plane verification creates no provider source records'
);
select is(
  (
    select count(*)::integer
    from private.canonical_business_fact_versions
    where workspace_id in (
      'b7400000-0000-4000-8000-000000000001',
      'b7400000-0000-4000-8000-000000000002'
    )
  ),
  0,
  'Phase 4 lifecycle metadata creates no canonical facts'
);
select is(
  (
    select count(*)::integer
    from private.deterministic_change_sets
    where workspace_id in (
      'b7400000-0000-4000-8000-000000000001',
      'b7400000-0000-4000-8000-000000000002'
    )
  ),
  0,
  'connection lifecycle changes do not trigger deterministic recalculation'
);
select ok(
  exists (
    select 1
    from private.integration_audit_events
    where connection_id = 'e7400000-0000-4000-8000-000000000001'
      and action = 'integration_connection.transition'
      and retention_class = 'authorization'
  )
  and exists (
    select 1
    from private.integration_audit_events
    where connection_id = 'e7400000-0000-4000-8000-000000000001'
      and action = 'integration_sync_run.transition'
      and retention_class = 'operational'
  ),
  'connection and run transitions preserve auditable provenance'
);

select * from finish();
rollback;
