create extension if not exists dblink with schema extensions;

begin;

grant usage on schema extensions
  to integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_provider_source_authority;

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

create or replace function pg_temp.provider_read_evidence_id(
  p_request_id text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select evidence.id
  from private.integration_provider_credential_task_read_evidence as evidence
  where evidence.request_id = p_request_id;
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

create or replace function pg_temp.qbo_capability()
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'operations', pg_catalog.jsonb_build_array(
      'get_capabilities',
      'get_source_record',
      'list_entities',
      'list_source_records'
    ),
    'domains', pg_catalog.jsonb_build_array(
      'change_hints',
      'company_configuration',
      'financial_transactions',
      'master_records',
      'report_control_observations'
    ),
    'requiredStreamKeys', pg_catalog.jsonb_build_array(
      'accounts',
      'company_info',
      'preferences',
      'qbo_apagingsummary',
      'qbo_aragingsummary',
      'qbo_balancesheet',
      'qbo_bill',
      'qbo_billpayment',
      'qbo_cashflow',
      'qbo_creditmemo',
      'qbo_deposit',
      'qbo_invoice',
      'qbo_journalentry',
      'qbo_payment',
      'qbo_profitandloss',
      'qbo_purchase',
      'qbo_refundreceipt',
      'qbo_salesreceipt',
      'qbo_transfer',
      'qbo_trialbalance',
      'qbo_vendorcredit'
    ),
    'supportsBackfill', true,
    'webhookMode', 'change_hints',
    'incrementalMode', 'cursor'
  );
$function$;

create or replace function pg_temp.qbo_connection_intent(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_environment text,
  p_scopes jsonb default '["com.intuit.quickbooks.accounting"]'::jsonb
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_connection_control_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'providerKey', 'quickbooks_online',
    'providerEnvironment', p_environment,
    'safeDisplayName', 'Synthetic QBO ' || p_environment,
    'requestedScopes', p_scopes,
    'providerDescriptorRegistryVersion', 'vaeroex_provider_descriptors_v1',
    'providerDescriptorRegistryFingerprint',
      'sha256:6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
    'providerDescriptorFingerprint',
      'sha256:e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
    'adapterVersion', 'qbo_provider_adapter_v1',
    'capabilitySnapshot', pg_temp.qbo_capability(),
    'configurationVersion', 1,
    'requestedAt', '2026-08-22T03:30:00.000Z'
  );
$function$;

create or replace function pg_temp.qbo_oauth_state(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_environment text,
  p_state text
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_oauth_state_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'connectionGeneration', 1,
    'providerKey', 'quickbooks_online',
    'providerEnvironment', p_environment,
    'initiatedBy', p_user_id,
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'returnIntent', '/app/integrations',
    'stateHash', pg_temp.fingerprint(p_state),
    'createdAt', '2026-08-22T03:31:00.000Z',
    'expiresAt', '2026-08-22T03:41:00.000Z'
  );
$function$;

create or replace function pg_temp.provider_read_command(
  p_task_id uuid,
  p_lease_id uuid,
  p_owner text,
  p_expected_version bigint default 1,
  p_minimum_validity integer default 300
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_credential_read_v1',
    'taskId', p_task_id,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'expectedCredentialVersion', p_expected_version,
    'requiredScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'minimumValiditySeconds', p_minimum_validity,
    'requestedAt', pg_catalog.to_char(
      pg_catalog.transaction_timestamp(),
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
$function$;

create or replace function pg_temp.provider_source_version(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_connection_id uuid,
  p_environment text,
  p_record_id text,
  p_source_fingerprint text,
  p_immutable_version bigint default 1,
  p_prior_version_id uuid default null
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'external_source_record_version_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', p_connection_id,
    'immutableVersion', p_immutable_version,
    'priorVersionId', p_prior_version_id,
    'recordKind', 'qbo_invoice',
    'source', pg_catalog.jsonb_build_object(
      'kind', 'provider',
      'providerKey', 'quickbooks_online',
      'providerRecordType', 'Invoice',
      'providerRecordId', p_record_id,
      'providerVersionReference', '1'
    ),
    'temporal', pg_catalog.jsonb_build_object(
      'basis', 'event',
      'providerCreatedAt', '2026-08-22T03:30:00.000Z',
      'providerUpdatedAt', '2026-08-22T03:30:00.000Z',
      'observedAt', '2026-08-22T03:30:00.000Z',
      'synchronizedAt', '2026-08-22T03:30:01.000Z',
      'ingestedAt', '2026-08-22T03:30:02.000Z',
      'effectiveAt', '2026-08-22T00:00:00.000Z',
      'postingDate', '2026-08-22',
      'periodStart', null,
      'periodEnd', null,
      'sourceTimeZone', null
    ),
    'accounting', pg_catalog.jsonb_build_object(
      'basis', 'accrual',
      'currency', 'USD'
    ),
    'normalizedSchemaVersion', 'qbo_minimizer_v1',
    'changeKind', 'created',
    'normalizedProjection', pg_catalog.jsonb_build_object(
      'provider', pg_catalog.jsonb_build_object(
        'providerKey', 'quickbooks_online',
        'sourceEnvironment', p_environment
      ),
      'recordType', 'Invoice',
      'id', p_record_id
    ),
    'trust', 'untrusted_external_input',
    'validation', pg_catalog.jsonb_build_object(
      'state', 'pending',
      'validatorVersion', 'qbo_phase_7_contract_validator_v1',
      'issues', pg_catalog.jsonb_build_array()
    ),
    'receivedAt', '2026-08-22T03:30:03.000Z',
    'sourceFingerprint', p_source_fingerprint
  );
$function$;

create or replace function pg_temp.provider_source_command(
  p_task_id uuid,
  p_lease_id uuid,
  p_owner text,
  p_mapping_id uuid,
  p_identity_fingerprint text,
  p_version jsonb
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'integration_provider_source_commit_v1',
    'taskId', p_task_id,
    'leaseId', p_lease_id,
    'leaseOwnerFingerprint', pg_temp.fingerprint(p_owner),
    'mappingId', p_mapping_id,
    'sourceIdentityFingerprint', p_identity_fingerprint,
    'version', p_version
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a8000000-0000-4000-8000-000000000001', 'phase8a0-owner-a@example.test', 'Phase 8A.0 Owner A'),
  ('a8000000-0000-4000-8000-000000000002', 'phase8a0-owner-b@example.test', 'Phase 8A.0 Owner B');

insert into public.workspaces (id, name, created_by) values
  ('b8000000-0000-4000-8000-000000000001', 'Phase 8A.0 Workspace A', 'a8000000-0000-4000-8000-000000000001'),
  ('b8000000-0000-4000-8000-000000000002', 'Phase 8A.0 Workspace B', 'a8000000-0000-4000-8000-000000000002');

insert into public.workspace_members (
  id,
  workspace_id,
  user_id,
  role,
  status
) values
  ('c8000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c8000000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000002', 'owner', 'active');

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
    'd8000000-0000-4000-8000-000000000001',
    'b8000000-0000-4000-8000-000000000001',
    'business_entity_v1',
    'phase8a0_company_a',
    'operating_company',
    'Phase 8A.0 Company A',
    'USD',
    'UTC',
    1,
    'active',
    'a8000000-0000-4000-8000-000000000001',
    'a8000000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  ),
  (
    'd8000000-0000-4000-8000-000000000002',
    'b8000000-0000-4000-8000-000000000002',
    'business_entity_v1',
    'phase8a0_company_b',
    'operating_company',
    'Phase 8A.0 Company B',
    'USD',
    'UTC',
    1,
    'active',
    'a8000000-0000-4000-8000-000000000002',
    'a8000000-0000-4000-8000-000000000002',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  );

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'integration_provider_source_authority'
      and not rolcanlogin
      and not rolinherit
  ),
  'provider-source authority is NOLOGIN and NOINHERIT'
);
select ok(
  not pg_catalog.pg_has_role(
    'service_role',
    'integration_provider_source_authority',
    'MEMBER'
  ),
  'service_role is not a member of provider-source authority'
);
select ok(
  not has_schema_privilege(
    'integration_provider_source_authority',
    'private',
    'USAGE'
  ),
  'provider-source authority has no private-schema usage'
);
select ok(
  not has_table_privilege(
    'integration_provider_source_authority',
    'private.external_source_records',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_provider_source_authority',
    'private.integration_credentials',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_provider_source_authority',
    'private.canonical_business_fact_versions',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_provider_source_authority',
    'private.fact_contribution_events',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_provider_source_authority',
    'private.deterministic_aggregate_states',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'provider-source authority has no direct source, credential, fact, contribution, or KPI DML'
);
select ok(
  has_function_privilege(
    'integration_provider_source_authority',
    'public.commit_provider_external_source_record_version_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.commit_provider_external_source_record_version_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.commit_provider_external_source_record_version_v1(jsonb,text)',
    'EXECUTE'
  ),
  'provider-source commit execution belongs only to its narrow authority'
);
select ok(
  has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'integration_credential_broker_authority',
    'public.record_integration_provider_credential_task_read_failure_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_credential_broker_authority',
    'public.read_integration_provider_credential_v4(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_integration_provider_credential_task_read_failure_v1(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'deterministic_calculation_authority',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'integration_deterministic_runtime_authority',
    'public.read_integration_provider_credential_v5(jsonb,text)',
    'EXECUTE'
  ),
  'task-bound provider credential read execution belongs only to the broker'
);
select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid =
      'private.integration_provider_credential_task_read_evidence'::regclass
  )
  and (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid =
      'private.integration_provider_credential_task_read_failure_evidence'::regclass
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_provider_credential_task_read_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'integration_credential_broker_authority',
    'private.integration_provider_credential_task_read_failure_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'service_role',
    'private.integration_provider_credential_task_read_evidence',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'task-bound read evidence is private, forced-RLS, and RPC-only'
);

select ok(
  private.is_phase_8a0_provider_environment_v1('synthetic', 'test'),
  'synthetic/test remains accepted'
);
select ok(
  private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'sandbox'
  ),
  'QBO sandbox is accepted'
);
select ok(
  private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'production'
  ),
  'QBO production is accepted'
);
select ok(
  not private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'test'
  )
  and not private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'development'
  )
  and not private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'preview'
  )
  and not private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'unknown'
  ),
  'QBO deployment and parsing-only environments are rejected'
);
select ok(
  not private.is_phase_8a0_provider_environment_v1(
    'quickbooks_online',
    'not an environment'
  )
  and not private.is_phase_8a0_provider_environment_v1(
    'unregistered_provider',
    'sandbox'
  ),
  'malformed and unregistered provider environments are rejected'
);
select ok(
  private.is_phase_8a0_provider_descriptor_v1(
    'synthetic',
    'test',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      'f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80',
      'hex'
    ),
    pg_catalog.decode(
      'd5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1',
      'hex'
    ),
    'synthetic_control_plane_adapter_v1'
  )
  and private.is_phase_8a0_scope_set_v1(
    'synthetic',
    array['read_synthetic_business_data']::text[]
  ),
  'the legacy synthetic/test descriptor and minimum scope remain valid'
);
select ok(
  private.is_phase_8a0_provider_descriptor_v1(
    'quickbooks_online',
    'sandbox',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
      'hex'
    ),
    pg_catalog.decode(
      'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
      'hex'
    ),
    'qbo_provider_adapter_v1'
  ),
  'canonical Phase 7 QBO descriptor is accepted'
);
select ok(
  not private.is_phase_8a0_provider_descriptor_v1(
    'quickbooks_online',
    'sandbox',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(pg_catalog.repeat('0', 64), 'hex'),
    pg_catalog.decode(
      'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
      'hex'
    ),
    'qbo_provider_adapter_v1'
  ),
  'wrong registry fingerprint is rejected'
);
select ok(
  not private.is_phase_8a0_provider_descriptor_v1(
    'quickbooks_online',
    'sandbox',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
      'hex'
    ),
    pg_catalog.decode(pg_catalog.repeat('0', 64), 'hex'),
    'qbo_provider_adapter_v1'
  ),
  'wrong descriptor fingerprint is rejected'
);
select ok(
  not private.is_phase_8a0_provider_descriptor_v1(
    'quickbooks_online',
    'sandbox',
    'vaeroex_provider_descriptors_v1',
    pg_catalog.decode(
      '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
      'hex'
    ),
    pg_catalog.decode(
      'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
      'hex'
    ),
    'forged_adapter_v1'
  ),
  'wrong QBO adapter version is rejected'
);
select ok(
  private.is_phase_8a0_scope_set_v1(
    'quickbooks_online',
    array['com.intuit.quickbooks.accounting']::text[]
  )
  and not private.is_phase_8a0_scope_set_v1(
    'quickbooks_online',
    array['com.intuit.quickbooks.accounting', 'openid']::text[]
  ),
  'QBO accepts only the reviewed accounting scope'
);
select ok(
  private.is_phase_8a0_capability_snapshot_v1(
    'quickbooks_online',
    pg_temp.qbo_capability()
  )
  and not private.is_phase_8a0_capability_snapshot_v1(
    'quickbooks_online',
    pg_temp.qbo_capability() || pg_catalog.jsonb_build_object(
      'supportsBackfill', false
    )
  ),
  'only the exact safe QBO capability snapshot is accepted'
);
select ok(
  private.is_phase_8a0_freshness_policy_v1(
    'quickbooks_online',
    'sandbox',
    'financial_transactions',
    'qbo_control_plane_freshness_policy_v1',
    3600,
    7200,
    'current_intelligence'
  )
  and not private.is_phase_8a0_freshness_policy_v1(
    'quickbooks_online',
    'sandbox',
    'unregistered_domain',
    'qbo_control_plane_freshness_policy_v1',
    3600,
    7200,
    'current_intelligence'
  ),
  'QBO freshness policy is versioned, bounded, and domain-specific'
);
select ok(
  private.is_phase_8a0_activation_trigger_v1(
    'synthetic',
    'synthetic_verification'
  )
  and private.is_phase_8a0_activation_trigger_v1(
    'quickbooks_online',
    'provider_initialization'
  )
  and not private.is_phase_8a0_activation_trigger_v1(
    'quickbooks_online',
    'synthetic_verification'
  ),
  'activation evidence is exact for synthetic and QBO providers'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a8000000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;
select is(
  public.create_integration_connection_intent_v1(
    pg_temp.qbo_connection_intent(
      'e8000000-0000-4000-8000-000000000001',
      'b8000000-0000-4000-8000-000000000001',
      'd8000000-0000-4000-8000-000000000001',
      'sandbox'
    )
  ) -> 'connection' ->> 'providerEnvironment',
  'sandbox',
  'QBO sandbox connection intent persists through the checked control plane'
);
select is(
  public.create_integration_connection_intent_v1(
    pg_temp.qbo_connection_intent(
      'e8000000-0000-4000-8000-000000000002',
      'b8000000-0000-4000-8000-000000000001',
      'd8000000-0000-4000-8000-000000000001',
      'production'
    )
  ) -> 'connection' ->> 'providerEnvironment',
  'production',
  'QBO production connection intent persists separately'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.qbo_connection_intent(
        'e8000000-0000-4000-8000-000000000010',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'unknown'
      )
    )$$,
    '22023'
  ),
  'QBO unknown cannot become a connection authority environment'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.qbo_connection_intent(
        'e8000000-0000-4000-8000-000000000011',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'sandbox',
        '["com.intuit.quickbooks.accounting","openid"]'::jsonb
      )
    )$$,
    '22023'
  ),
  'QBO excess connection scope is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.qbo_connection_intent(
        'e8000000-0000-4000-8000-000000000012',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'sandbox'
      ) || jsonb_build_object(
        'providerDescriptorRegistryFingerprint',
        'sha256:' || repeat('0', 64)
      )
    )$$,
    '22023'
  ),
  'forged registry persistence is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.qbo_connection_intent(
        'e8000000-0000-4000-8000-000000000013',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'sandbox'
      ) || jsonb_build_object('adapterVersion', 'forged_adapter_v1')
    )$$,
    '22023'
  ),
  'forged adapter persistence is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_connection_intent_v1(
      pg_temp.qbo_connection_intent(
        'e8000000-0000-4000-8000-000000000014',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'sandbox'
      ) || jsonb_build_object(
        'capabilitySnapshot',
        pg_temp.qbo_capability() || jsonb_build_object(
          'webhookMode',
          'arbitrary'
        )
      )
    )$$,
    '22023'
  ),
  'mutated QBO capability persistence is rejected'
);
reset role;

set local role integration_oauth_ingress_authority;
select is(
  public.create_integration_oauth_state_v1(
    pg_temp.qbo_oauth_state(
      '08000000-0000-4000-8000-000000000001',
      'b8000000-0000-4000-8000-000000000001',
      'd8000000-0000-4000-8000-000000000001',
      'e8000000-0000-4000-8000-000000000001',
      'a8000000-0000-4000-8000-000000000001',
      'sandbox',
      'qbo-sandbox-state'
    ),
    'phase8a0_qbo_oauth_sandbox'
  ) ->> 'stateId',
  '08000000-0000-4000-8000-000000000001',
  'QBO sandbox OAuth state is representable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_oauth_state_v1(
      pg_temp.qbo_oauth_state(
        '08000000-0000-4000-8000-000000000002',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'e8000000-0000-4000-8000-000000000001',
        'a8000000-0000-4000-8000-000000000001',
        'production',
        'qbo-environment-substitution'
      ),
      'phase8a0_qbo_oauth_mismatch'
    )$$,
    '42501'
  ),
  'OAuth environment must exactly match the trusted connection'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_integration_oauth_state_v1(
      pg_temp.qbo_oauth_state(
        '08000000-0000-4000-8000-000000000003',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'e8000000-0000-4000-8000-000000000001',
        'a8000000-0000-4000-8000-000000000001',
        'unknown',
        'qbo-unknown-state'
      ),
      'phase8a0_qbo_oauth_unknown'
    )$$,
    '22023'
  ),
  'QBO unknown cannot become OAuth authority'
);
reset role;

-- Runtime-only synthetic QBO fixture. It contains no copied customer or Intuit data.
insert into private.integration_connections (
  id, contract_version, control_contract_version, workspace_id,
  business_entity_id, connection_series_id, connection_generation,
  replaces_connection_id, provider_key, provider_environment,
  provider_tenant_reference_fingerprint, status, state_reason_code,
  requested_scopes, granted_scopes, safe_display_name,
  provider_descriptor_registry_version,
  provider_descriptor_registry_fingerprint,
  provider_descriptor_fingerprint, adapter_version, capability_snapshot,
  configuration_version, authorized_at, status_changed_at,
  disconnected_at, deleted_at, last_transition_request_id,
  last_transition_request_fingerprint, row_version, created_by,
  created_at, updated_at
) values
  (
    'e8000000-0000-4000-8000-000000000101',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1, null,
    'quickbooks_online', 'sandbox',
    extensions.digest(convert_to('synthetic-qbo-realm-a', 'UTF8'), 'sha256'),
    'active', 'healthy',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Synthetic QBO Runtime A', 'vaeroex_provider_descriptors_v1',
    decode('6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758', 'hex'),
    decode('e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(), null, null,
    null, null, 1, 'a8000000-0000-4000-8000-000000000001',
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'e8000000-0000-4000-8000-000000000102',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102', 1, null,
    'quickbooks_online', 'production',
    extensions.digest(convert_to('synthetic-qbo-realm-b', 'UTF8'), 'sha256'),
    'disconnected', 'disconnected',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Synthetic QBO Runtime B', 'vaeroex_provider_descriptors_v1',
    decode('6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758', 'hex'),
    decode('e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp(), null, null, null, 1,
    'a8000000-0000-4000-8000-000000000002',
    transaction_timestamp(), transaction_timestamp()
  );

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, replaces_mapping_id, provider_key,
  provider_environment, provider_entity_type,
  provider_entity_reference_fingerprint, safe_display_name, mapping_role,
  status, verification_mode, verification_fingerprint, verified_at, mapped_by,
  mapped_at, last_transition_request_id, last_transition_request_fingerprint,
  row_version, created_at, updated_at
) values
  (
    'f8000000-0000-4000-8000-000000000101', 'provider_entity_mapping_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101',
    'f8000000-0000-4000-8000-000000000101', 1, null,
    'quickbooks_online', 'sandbox', 'company',
    extensions.digest(convert_to('synthetic-qbo-entity-a', 'UTF8'), 'sha256'),
    'Synthetic QBO Entity A', 'primary', 'active', 'qbo_realm_mapping_v1',
    extensions.digest(convert_to('synthetic-qbo-verified-a', 'UTF8'), 'sha256'),
    transaction_timestamp(), 'a8000000-0000-4000-8000-000000000001',
    transaction_timestamp(), null, null, 1,
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'f8000000-0000-4000-8000-000000000102', 'provider_entity_mapping_v1',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102',
    'f8000000-0000-4000-8000-000000000102', 1, null,
    'quickbooks_online', 'production', 'company',
    extensions.digest(convert_to('synthetic-qbo-entity-b', 'UTF8'), 'sha256'),
    'Synthetic QBO Entity B', 'primary', 'active', 'qbo_realm_mapping_v1',
    extensions.digest(convert_to('synthetic-qbo-verified-b', 'UTF8'), 'sha256'),
    transaction_timestamp(), 'a8000000-0000-4000-8000-000000000002',
    transaction_timestamp(), null, null, 1,
    transaction_timestamp(), transaction_timestamp()
  );

insert into private.integration_workspace_policies (
  id, contract_version, workspace_id, provider_key, provider_environment,
  state, sync_enabled, history_horizon_days, maximum_concurrency,
  freshness_policy_version, retention_policy_version, row_version,
  last_request_id, last_request_fingerprint, created_at, updated_at
) values
  (
    '18000000-0000-4000-8000-000000000101',
    'integration_workspace_policy_v1',
    'b8000000-0000-4000-8000-000000000001',
    'quickbooks_online', 'sandbox', 'enabled', true, 365, 2,
    'qbo_control_plane_freshness_policy_v1',
    'qbo_metadata_retention_v1', 1, 'phase8a0-policy-a',
    extensions.digest(convert_to('phase8a0-policy-a', 'UTF8'), 'sha256'),
    transaction_timestamp(), transaction_timestamp()
  );

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, window_start_at, window_end_at,
  provider_contract_version, adapter_version, policy_version,
  records_observed, records_accepted, records_rejected, facts_accepted,
  contributions_changed, error_category, error_code,
  last_transition_request_id, last_transition_request_fingerprint,
  created_at, started_at, finished_at, row_version, updated_at
) values
  (
    '28000000-0000-4000-8000-000000000101', 'integration_sync_run_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101',
    'f8000000-0000-4000-8000-000000000101', 1,
    'provider_initialization', 'initialization', 'running',
    extensions.digest(convert_to('phase8a0-run-a', 'UTF8'), 'sha256'),
    null, null, 'provider_adapter_v1', 'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase8a0-run-a',
    extensions.digest(convert_to('phase8a0-run-a-request', 'UTF8'), 'sha256'),
    transaction_timestamp(), transaction_timestamp(), null, 2,
    transaction_timestamp()
  ),
  (
    '28000000-0000-4000-8000-000000000102', 'integration_sync_run_v1',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102',
    'f8000000-0000-4000-8000-000000000102', 1,
    'provider_initialization', 'initialization', 'running',
    extensions.digest(convert_to('phase8a0-run-b', 'UTF8'), 'sha256'),
    null, null, 'provider_adapter_v1', 'qbo_provider_adapter_v1',
    'qbo_historical_sync_policy_v1', 0, 0, 0, 0, 0, null, null,
    'phase8a0-run-b',
    extensions.digest(convert_to('phase8a0-run-b-request', 'UTF8'), 'sha256'),
    transaction_timestamp(), transaction_timestamp(), null, 2,
    transaction_timestamp()
  );

insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, parent_task_id, provider_key,
  provider_environment, queue_class, task_kind, stream_key, state, priority,
  control_metadata, idempotency_fingerprint, coalescing_fingerprint,
  dispatcher_task_name, dispatch_generation, delivery_attribution_state,
  last_delivery_dispatch_generation, last_delivery_retry_count,
  last_delivery_execution_count, last_delivery_attempt_fingerprint,
  attempt_count, maximum_attempts,
  available_at, lease_id, lease_owner_fingerprint, lease_expires_at,
  heartbeat_at, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at, retention_expires_at
) values
  (
    '38000000-0000-4000-8000-000000000101', 'integration_sync_task_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1,
    '28000000-0000-4000-8000-000000000101', null,
    'quickbooks_online', 'sandbox', 'provider_interactive', 'incremental',
    'qbo_invoice', 'leased', 50,
    jsonb_build_object(
      'checkpointId', null,
      'mappingId', 'f8000000-0000-4000-8000-000000000101',
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase8a0_provider_read',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    extensions.digest(convert_to('phase8a0-task-a', 'UTF8'), 'sha256'),
    extensions.digest(convert_to('phase8a0-task-a-coalesce', 'UTF8'), 'sha256'),
    'projects/phase8a0/locations/us/tasks/runtime-a', 1, 'attributed', 1, 0, 0,
    extensions.digest(convert_to('phase8a0-delivery-a', 'UTF8'), 'sha256'),
    1, 3,
    transaction_timestamp(),
    '48000000-0000-4000-8000-000000000101',
    extensions.digest(convert_to('phase8a0-owner-a', 'UTF8'), 'sha256'),
    transaction_timestamp() + interval '10 minutes', transaction_timestamp(),
    'phase8a0-task-a',
    extensions.digest(convert_to('phase8a0-task-a-request', 'UTF8'), 'sha256'),
    3, transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp() + interval '7 days'
  ),
  (
    '38000000-0000-4000-8000-000000000102', 'integration_sync_task_v1',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102', 1,
    '28000000-0000-4000-8000-000000000102', null,
    'quickbooks_online', 'production', 'provider_bulk', 'initial_historical',
    'qbo_invoice', 'leased', 50,
    jsonb_build_object(
      'checkpointId', null,
      'mappingId', 'f8000000-0000-4000-8000-000000000102',
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase8a0_disconnected',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    extensions.digest(convert_to('phase8a0-task-b', 'UTF8'), 'sha256'),
    extensions.digest(convert_to('phase8a0-task-b-coalesce', 'UTF8'), 'sha256'),
    'projects/phase8a0/locations/us/tasks/runtime-b', 1, 'attributed', 1, 0, 0,
    extensions.digest(convert_to('phase8a0-delivery-b', 'UTF8'), 'sha256'),
    1, 3,
    transaction_timestamp(),
    '48000000-0000-4000-8000-000000000102',
    extensions.digest(convert_to('phase8a0-owner-b', 'UTF8'), 'sha256'),
    transaction_timestamp() + interval '10 minutes', transaction_timestamp(),
    'phase8a0-task-b',
    extensions.digest(convert_to('phase8a0-task-b-request', 'UTF8'), 'sha256'),
    3, transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp() + interval '7 days'
  ),
  (
    '38000000-0000-4000-8000-000000000103', 'integration_sync_task_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1,
    '28000000-0000-4000-8000-000000000101', null,
    'quickbooks_online', 'sandbox', 'provider_interactive', 'incremental',
    'qbo_bill', 'leased', 50,
    jsonb_build_object(
      'checkpointId', null,
      'mappingId', 'f8000000-0000-4000-8000-000000000101',
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase8a0_provider_read_concurrent',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    extensions.digest(convert_to('phase8a0-task-c', 'UTF8'), 'sha256'),
    extensions.digest(convert_to('phase8a0-task-c-coalesce', 'UTF8'), 'sha256'),
    'projects/phase8a0/locations/us/tasks/runtime-c', 1, 'attributed', 1, 0, 0,
    extensions.digest(convert_to('phase8a0-delivery-c', 'UTF8'), 'sha256'),
    1, 3,
    transaction_timestamp(),
    '48000000-0000-4000-8000-000000000103',
    extensions.digest(convert_to('phase8a0-owner-c', 'UTF8'), 'sha256'),
    transaction_timestamp() + interval '10 minutes', transaction_timestamp(),
    'phase8a0-task-c',
    extensions.digest(convert_to('phase8a0-task-c-request', 'UTF8'), 'sha256'),
    3, transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp() + interval '7 days'
  ),
  (
    '38000000-0000-4000-8000-000000000104', 'integration_sync_task_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1,
    '28000000-0000-4000-8000-000000000101', null,
    'quickbooks_online', 'sandbox', 'provider_interactive', 'incremental',
    'qbo_payment', 'leased', 50,
    jsonb_build_object(
      'checkpointId', null,
      'mappingId', 'f8000000-0000-4000-8000-000000000101',
      'eventId', null,
      'pageOrdinal', 0,
      'cursorVersion', 0,
      'windowStartAt', null,
      'windowEndAt', null,
      'reasonCode', 'phase8a0_stale_delivery_generation',
      'recordHintCount', 1,
      'coalescedEventCount', 1
    ),
    extensions.digest(convert_to('phase8a0-task-d', 'UTF8'), 'sha256'),
    extensions.digest(convert_to('phase8a0-task-d-coalesce', 'UTF8'), 'sha256'),
    'projects/phase8a0/locations/us/tasks/runtime-d', 2, 'attributed', 1, 0, 0,
    extensions.digest(convert_to('phase8a0-delivery-d', 'UTF8'), 'sha256'),
    1, 3,
    transaction_timestamp(),
    '48000000-0000-4000-8000-000000000104',
    extensions.digest(convert_to('phase8a0-owner-d', 'UTF8'), 'sha256'),
    transaction_timestamp() + interval '10 minutes', transaction_timestamp(),
    'phase8a0-task-d',
    extensions.digest(convert_to('phase8a0-task-d-request', 'UTF8'), 'sha256'),
    3, transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp() + interval '7 days'
  );

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status, creation_request_id,
  creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at, row_version
) values
  (
    '58000000-0000-4000-8000-000000000101', 'integration_oauth_state_v1',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1,
    'quickbooks_online', 'sandbox',
    'a8000000-0000-4000-8000-000000000001',
    array['com.intuit.quickbooks.accounting']::text[], '/app/integrations',
    extensions.digest(convert_to('phase8a0-runtime-state-a', 'UTF8'), 'sha256'),
    'consumed', 'phase8a0-runtime-state-create-a',
    extensions.digest(convert_to('phase8a0-runtime-state-create-a', 'UTF8'), 'sha256'),
    'phase8a0-runtime-state-consume-a',
    extensions.digest(convert_to('phase8a0-runtime-state-consume-a', 'UTF8'), 'sha256'),
    transaction_timestamp() - interval '1 minute',
    transaction_timestamp() + interval '9 minutes',
    transaction_timestamp(), 2
  ),
  (
    '58000000-0000-4000-8000-000000000102', 'integration_oauth_state_v1',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102', 1,
    'quickbooks_online', 'production',
    'a8000000-0000-4000-8000-000000000002',
    array['com.intuit.quickbooks.accounting']::text[], '/app/integrations',
    extensions.digest(convert_to('phase8a0-runtime-state-b', 'UTF8'), 'sha256'),
    'consumed', 'phase8a0-runtime-state-create-b',
    extensions.digest(convert_to('phase8a0-runtime-state-create-b', 'UTF8'), 'sha256'),
    'phase8a0-runtime-state-consume-b',
    extensions.digest(convert_to('phase8a0-runtime-state-consume-b', 'UTF8'), 'sha256'),
    transaction_timestamp() - interval '1 minute',
    transaction_timestamp() + interval '9 minutes',
    transaction_timestamp(), 2
  );

insert into private.integration_credentials (
  id, contract_version, oauth_state_id, workspace_id, business_entity_id,
  connection_id, connection_generation, provider_key, provider_environment,
  initiated_by, credential_version, envelope_schema_version,
  aad_schema_version, aad_digest, kms_key_resource, credential_ciphertext,
  access_expires_at, refresh_expires_at, granted_scopes,
  external_entity_reference_fingerprint, status, last_request_id,
  last_request_fingerprint, row_version, created_at, updated_at
) values
  (
    '68000000-0000-4000-8000-000000000101',
    'integration_credential_authority_v1',
    '58000000-0000-4000-8000-000000000101',
    'b8000000-0000-4000-8000-000000000001',
    'd8000000-0000-4000-8000-000000000001',
    'e8000000-0000-4000-8000-000000000101', 1,
    'quickbooks_online', 'sandbox',
    'a8000000-0000-4000-8000-000000000001', 1,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'sandbox',
      'b8000000-0000-4000-8000-000000000001',
      'e8000000-0000-4000-8000-000000000101',
      1,
      'quickbooks_online',
      '68000000-0000-4000-8000-000000000101'
    ),
    'projects/vaeroex-test/locations/us-central1/keyRings/integrations/cryptoKeys/credentials',
    decode(repeat('ab', 32), 'hex'),
    transaction_timestamp() + interval '10 minutes',
    transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    extensions.digest(convert_to('synthetic-qbo-realm-a', 'UTF8'), 'sha256'),
    'active', 'phase8a0-credential-seed-a',
    extensions.digest(convert_to('phase8a0-credential-seed-a', 'UTF8'), 'sha256'),
    1, transaction_timestamp(), transaction_timestamp()
  ),
  (
    '68000000-0000-4000-8000-000000000102',
    'integration_credential_authority_v1',
    '58000000-0000-4000-8000-000000000102',
    'b8000000-0000-4000-8000-000000000002',
    'd8000000-0000-4000-8000-000000000002',
    'e8000000-0000-4000-8000-000000000102', 1,
    'quickbooks_online', 'production',
    'a8000000-0000-4000-8000-000000000002', 1,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'production',
      'b8000000-0000-4000-8000-000000000002',
      'e8000000-0000-4000-8000-000000000102',
      1,
      'quickbooks_online',
      '68000000-0000-4000-8000-000000000102'
    ),
    'projects/vaeroex-test/locations/us-central1/keyRings/integrations/cryptoKeys/credentials',
    decode(repeat('cd', 32), 'hex'),
    transaction_timestamp() + interval '10 minutes',
    transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    extensions.digest(convert_to('synthetic-qbo-realm-b', 'UTF8'), 'sha256'),
    'active', 'phase8a0-credential-seed-b',
    extensions.digest(convert_to('phase8a0-credential-seed-b', 'UTF8'), 'sha256'),
    1, transaction_timestamp(), transaction_timestamp()
  );

select ok(
  (
    select pg_catalog.array_agg(credential.provider_environment order by credential.provider_environment)
    from private.integration_credentials as credential
    where credential.id in (
      '68000000-0000-4000-8000-000000000101',
      '68000000-0000-4000-8000-000000000102'
    )
  ) = array['production', 'sandbox']::text[]
  and not exists (
    select 1
    from private.integration_credentials as credential
    join private.integration_connections as connection
      on connection.workspace_id = credential.workspace_id
      and connection.business_entity_id = credential.business_entity_id
      and connection.id = credential.connection_id
      and connection.connection_generation = credential.connection_generation
    where credential.id in (
      '68000000-0000-4000-8000-000000000101',
      '68000000-0000-4000-8000-000000000102'
    )
      and (
        credential.provider_key <> connection.provider_key
        or credential.provider_environment <> connection.provider_environment
      )
  ),
  'QBO sandbox and production credentials persist only against matching trusted connections'
);

-- Seed a test-only request-key collision so V5's evidence append fails after
-- its internal V4 authority selection. The caught statement is a subtransaction:
-- no ciphertext result or generic read audit can survive that failed append.
insert into private.integration_audit_events (
  id, workspace_id, business_entity_id, connection_id, actor_type, actor_id,
  action, outcome, target_type, target_id, request_id, reason_code, metadata,
  occurred_at, retention_class
) values (
  '88000000-0000-4000-8000-000000000101',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000101',
  'service', 'integration_credential_broker',
  'credential_provider_read', 'allowed', 'integration_credential',
  '68000000-0000-4000-8000-000000000101',
  'phase8a0-provider-read-evidence-collision-seed', 'authorized',
  pg_catalog.jsonb_build_object(
    'connection_generation', 1,
    'credential_status', 'active',
    'credential_version', 1,
    'task_state', 'leased'
  ),
  pg_catalog.transaction_timestamp(),
  'security'
);
insert into private.integration_provider_credential_task_read_evidence (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, connection_row_version, sync_run_id, mapping_id,
  mapping_row_version, task_id, task_row_version, task_dispatch_generation,
  dispatcher_task_name, delivery_attribution_state,
  delivery_dispatch_generation, delivery_retry_count,
  delivery_execution_count, delivery_attempt_fingerprint, lease_id,
  lease_owner_fingerprint, lease_expires_at, credential_id,
  credential_version, credential_row_version, provider_key,
  provider_environment, granted_scopes, granted_scope_fingerprint,
  credential_read_audit_event_id, request_id, request_fingerprint,
  evidence_fingerprint, authority_role, authorized_at, created_at
) values (
  '89000000-0000-4000-8000-000000000101',
  'integration_provider_credential_task_read_evidence_v1',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000101', 1, 1,
  '28000000-0000-4000-8000-000000000101',
  'f8000000-0000-4000-8000-000000000101', 1,
  '38000000-0000-4000-8000-000000000101', 3, 1,
  'projects/phase8a0/locations/us/tasks/runtime-a', 'attributed',
  1, 0, 0,
  extensions.digest(convert_to('phase8a0-delivery-a', 'UTF8'), 'sha256'),
  '48000000-0000-4000-8000-000000000101',
  extensions.digest(convert_to('phase8a0-owner-a', 'UTF8'), 'sha256'),
  pg_catalog.transaction_timestamp() + interval '10 minutes',
  '68000000-0000-4000-8000-000000000101', 1, 1,
  'quickbooks_online', 'sandbox',
  array['com.intuit.quickbooks.accounting']::text[],
  private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_provider_credential_scope_binding_v1',
      'providerKey', 'quickbooks_online',
      'providerEnvironment', 'sandbox',
      'grantedScopes', pg_catalog.jsonb_build_array(
        'com.intuit.quickbooks.accounting'
      )
    )
  ),
  '88000000-0000-4000-8000-000000000101',
  'phase8a0-provider-read-evidence-collision',
  extensions.digest(
    convert_to('phase8a0-provider-read-evidence-collision-request', 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    convert_to('phase8a0-provider-read-evidence-collision-row', 'UTF8'),
    'sha256'
  ),
  'integration_credential_broker_authority',
  pg_catalog.transaction_timestamp(),
  pg_catalog.transaction_timestamp()
);

set local role integration_credential_broker_authority;
create temporary table phase8a0_provider_read_result as
select public.read_integration_provider_credential_v5(
    pg_temp.provider_read_command(
      '38000000-0000-4000-8000-000000000101',
      '48000000-0000-4000-8000-000000000101',
      'phase8a0-owner-a'
    ),
    'phase8a0-provider-read-valid'
  ) as result;
select is(
  (select result ->> 'state' from phase8a0_provider_read_result),
  'available',
  'valid current QBO credential is available to the broker'
);
select ok(
  (
    select result ? 'credentialReadEvidenceId'
      and (result ->> 'credentialReadEvidenceId')::uuid =
        pg_temp.provider_read_evidence_id('phase8a0-provider-read-valid')
    from phase8a0_provider_read_result
  ),
  'credential authority is returned only with its exact immutable evidence ID'
);
select is(
  public.record_integration_provider_credential_task_read_failure_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion',
        'integration_provider_credential_task_read_failure_evidence_v1',
      'credentialReadEvidenceId',
        pg_temp.provider_read_evidence_id('phase8a0-provider-read-valid'),
      'diagnosticClass', 'expires_at_binding'
    ),
    'phase8a0-provider-read-valid'
  ) ->> 'diagnosticClass',
  'expires_at_binding',
  'post-decrypt failure evidence derives identity only from the read evidence'
);
select is(
  public.record_integration_provider_credential_task_read_failure_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion',
        'integration_provider_credential_task_read_failure_evidence_v1',
      'credentialReadEvidenceId',
        pg_temp.provider_read_evidence_id('phase8a0-provider-read-valid'),
      'diagnosticClass', 'expires_at_binding'
    ),
    'phase8a0-provider-read-valid'
  ) ->> 'idempotent',
  'true',
  'identical post-decrypt failure evidence replay is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.record_integration_provider_credential_task_read_failure_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion',
          'integration_provider_credential_task_read_failure_evidence_v1',
        'credentialReadEvidenceId',
          pg_temp.provider_read_evidence_id('phase8a0-provider-read-valid'),
        'diagnosticClass', 'expires_at_binding',
        'taskId', '38000000-0000-4000-8000-000000000102'
      ),
      'phase8a0-provider-read-forged-failure'
    )$$,
    '22023'
  ),
  'caller-forged task identity is not accepted by failure evidence'
);
select is(
  public.read_integration_provider_credential_v5(
    pg_temp.provider_read_command(
      '38000000-0000-4000-8000-000000000101',
      '48000000-0000-4000-8000-000000000101',
      'phase8a0-owner-a',
      2
    ),
    'phase8a0-provider-read-stale'
  ) ->> 'state',
  'credential_version_stale',
  'stale credential version is typed and not decrypted'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000102',
        '48000000-0000-4000-8000-000000000102',
        'phase8a0-owner-b'
      ),
      'phase8a0-provider-read-disconnected'
    )$$,
    '42501'
  ),
  'disconnected connection cannot read provider credentials'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'wrong-owner'
      ),
      'phase8a0-provider-read-owner-mismatch'
    )$$,
    '42501'
  ),
  'wrong task lease owner cannot read credentials'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000199',
        'phase8a0-owner-a'
      ),
      'phase8a0-provider-read-lease-mismatch'
    )$$,
    '42501'
  ),
  'wrong task lease ID cannot read credentials'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000104',
        '48000000-0000-4000-8000-000000000104',
        'phase8a0-owner-d'
      ),
      'phase8a0-provider-read-stale-delivery-generation'
    )$$,
    '42501'
  ),
  'stale delivery dispatch generation cannot receive credential authority'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a'
      ) || pg_catalog.jsonb_build_object(
        'taskDispatchGeneration', 99,
        'deliveryRetryCount', 99
      ),
      'phase8a0-provider-read-forged-delivery'
    )$$,
    '22023'
  ),
  'caller-forged task and delivery identity is rejected as malformed input'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a'
      ),
      'phase8a0-provider-read-evidence-collision'
    )$$,
    '23505'
  ),
  'credential authority fails closed when its atomic evidence append cannot commit'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_integration_provider_credential_v5(
      pg_temp.provider_read_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000102',
        'phase8a0-owner-b'
      ),
      'phase8a0-provider-read-cross-tenant-forgery'
    )$$,
    '42501'
  ),
  'copied cross-tenant lease and owner identifiers cannot widen credential discovery'
);
reset role;

select ok(
  (
    select evidence.workspace_id =
        'b8000000-0000-4000-8000-000000000001'
      and evidence.business_entity_id =
        'd8000000-0000-4000-8000-000000000001'
      and evidence.connection_id =
        'e8000000-0000-4000-8000-000000000101'
      and evidence.connection_generation = 1
      and evidence.mapping_id =
        'f8000000-0000-4000-8000-000000000101'
      and evidence.task_id =
        '38000000-0000-4000-8000-000000000101'
      and evidence.task_dispatch_generation = 1
      and evidence.delivery_dispatch_generation = 1
      and evidence.delivery_retry_count = 0
      and evidence.delivery_execution_count = 0
      and evidence.lease_id =
        '48000000-0000-4000-8000-000000000101'
      and evidence.lease_owner_fingerprint = extensions.digest(
        pg_catalog.convert_to('phase8a0-owner-a', 'UTF8'),
        'sha256'
      )
      and evidence.credential_id =
        '68000000-0000-4000-8000-000000000101'
      and evidence.credential_version = 1
      and evidence.provider_key = 'quickbooks_online'
      and evidence.provider_environment = 'sandbox'
      and evidence.granted_scopes =
        array['com.intuit.quickbooks.accounting']::text[]
      and evidence.credential_read_audit_event_id = audit.id
      and evidence.authorized_at = audit.occurred_at
      and evidence.created_at = evidence.authorized_at
    from private.integration_provider_credential_task_read_evidence as evidence
    inner join private.integration_audit_events as audit
      on audit.id = evidence.credential_read_audit_event_id
    where evidence.request_id = 'phase8a0-provider-read-valid'
  ),
  'successful read evidence binds exact tenant, task, delivery, lease, credential, scope, and audit authority'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_provider_credential_task_read_evidence
    where request_id = 'phase8a0-provider-read-valid'
  ),
  1,
  'one successful credential read creates exactly one evidence row'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_provider_credential_task_read_evidence
    where request_id in (
      'phase8a0-provider-read-stale',
      'phase8a0-provider-read-disconnected',
      'phase8a0-provider-read-owner-mismatch',
      'phase8a0-provider-read-lease-mismatch',
      'phase8a0-provider-read-stale-delivery-generation',
      'phase8a0-provider-read-forged-delivery',
      'phase8a0-provider-read-cross-tenant-forgery'
    )
  ),
  0,
  'denied, malformed, and stale reads create no task-bound authority evidence'
);
select ok(
  (
    select pg_catalog.count(*) = 1
    from private.integration_provider_credential_task_read_evidence
    where request_id = 'phase8a0-provider-read-evidence-collision'
  )
  and not exists (
    select 1
    from private.integration_audit_events
    where request_id = 'phase8a0-provider-read-evidence-collision'
  ),
  'failed evidence append rolls back its internal read audit and returns no new authority'
);
select ok(
  (
    select failure.task_id = read.task_id
      and failure.task_dispatch_generation = read.task_dispatch_generation
      and failure.delivery_dispatch_generation =
        read.delivery_dispatch_generation
      and failure.delivery_retry_count = read.delivery_retry_count
      and failure.delivery_execution_count = read.delivery_execution_count
      and failure.delivery_attempt_fingerprint =
        read.delivery_attempt_fingerprint
      and failure.lease_id = read.lease_id
      and failure.lease_owner_fingerprint = read.lease_owner_fingerprint
      and failure.credential_id = read.credential_id
      and failure.credential_version = read.credential_version
      and failure.diagnostic_class = 'expires_at_binding'
    from private.integration_provider_credential_task_read_failure_evidence
      as failure
    inner join private.integration_provider_credential_task_read_evidence
      as read on read.id = failure.credential_read_evidence_id
    where failure.request_id = 'phase8a0-provider-read-valid'
  ),
  'failure evidence copies exact immutable read authority without caller task identity'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.integration_provider_credential_task_read_evidence
      set task_id = '38000000-0000-4000-8000-000000000102'
      where request_id = 'phase8a0-provider-read-valid'$$,
    '55000'
  )
  and pg_temp.raises_sqlstate(
    $$delete from private.integration_provider_credential_task_read_failure_evidence
      where request_id = 'phase8a0-provider-read-valid'$$,
    '55000'
  ),
  'task-bound read and failure evidence are update/delete immutable'
);

select is(
  (
    select target_id
    from private.integration_audit_events
    where request_id = 'phase8a0-provider-read-valid'
      and action = 'credential_provider_read'
  ),
  '68000000-0000-4000-8000-000000000101',
  'sandbox task authority cannot select the separate production credential'
);
select is(
  (
    select row_version
    from private.integration_credentials
    where id = '68000000-0000-4000-8000-000000000101'
  ),
  1::bigint,
  'ordinary provider reads do not mutate credential state'
);
select ok(
  not exists (
    select 1
    from private.integration_audit_events
    where action = 'credential_provider_read'
      and (
        metadata::text ilike '%access_token%'
        or metadata::text ilike '%refresh_token%'
        or metadata::text ilike '%credential_ciphertext%'
      )
  ),
  'provider-read audit metadata contains no token or ciphertext material'
);

set local role integration_credential_broker_authority;
select is(
  public.read_integration_provider_credential_v5(
    pg_temp.provider_read_command(
      '38000000-0000-4000-8000-000000000101',
      '48000000-0000-4000-8000-000000000101',
      'phase8a0-owner-a',
      1,
      900
    ),
    'phase8a0-provider-read-near-expiry'
  ) ->> 'state',
  'refresh_required',
  'near-expiry credential returns refresh_required'
);
reset role;

set local role integration_provider_source_authority;
select is(
  public.commit_provider_external_source_record_version_v1(
    pg_temp.provider_source_command(
      '38000000-0000-4000-8000-000000000101',
      '48000000-0000-4000-8000-000000000101',
      'phase8a0-owner-a',
      'f8000000-0000-4000-8000-000000000101',
      pg_temp.fingerprint('qbo-invoice-1-identity'),
      pg_temp.provider_source_version(
        '78000000-0000-4000-8000-000000000101',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'e8000000-0000-4000-8000-000000000101',
        'sandbox',
        'synthetic_invoice_1',
        pg_temp.fingerprint('qbo-invoice-1-version')
      )
    ),
    'phase8a0-source-commit-valid'
  ) ->> 'validationState',
  'pending',
  'leased QBO task commits only a pending provider source version'
);
select is(
  public.commit_provider_external_source_record_version_v1(
    pg_temp.provider_source_command(
      '38000000-0000-4000-8000-000000000101',
      '48000000-0000-4000-8000-000000000101',
      'phase8a0-owner-a',
      'f8000000-0000-4000-8000-000000000101',
      pg_temp.fingerprint('qbo-invoice-1-identity'),
      pg_temp.provider_source_version(
        '78000000-0000-4000-8000-000000000101',
        'b8000000-0000-4000-8000-000000000001',
        'd8000000-0000-4000-8000-000000000001',
        'e8000000-0000-4000-8000-000000000101',
        'sandbox',
        'synthetic_invoice_1',
        pg_temp.fingerprint('qbo-invoice-1-version')
      )
    ),
    'phase8a0-source-commit-replay'
  ) ->> 'idempotent',
  'true',
  'provider-source replay is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a',
        'f8000000-0000-4000-8000-000000000101',
        pg_temp.fingerprint('cross-workspace'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000102',
          'b8000000-0000-4000-8000-000000000002',
          'd8000000-0000-4000-8000-000000000001',
          'e8000000-0000-4000-8000-000000000101',
          'sandbox',
          'synthetic_cross_workspace',
          pg_temp.fingerprint('cross-workspace-version')
        )
      ),
      'phase8a0-source-cross-workspace'
    )$$,
    '42501'
  ),
  'provider-source cross-workspace scope is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a',
        'f8000000-0000-4000-8000-000000000101',
        pg_temp.fingerprint('cross-business-entity'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000106',
          'b8000000-0000-4000-8000-000000000001',
          'd8000000-0000-4000-8000-000000000002',
          'e8000000-0000-4000-8000-000000000101',
          'sandbox',
          'synthetic_cross_business_entity',
          pg_temp.fingerprint('cross-business-entity-version')
        )
      ),
      'phase8a0-source-cross-business-entity'
    )$$,
    '42501'
  ),
  'provider-source cross-Business-Entity scope is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a',
        'f8000000-0000-4000-8000-000000000101',
        pg_temp.fingerprint('cross-connection'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000107',
          'b8000000-0000-4000-8000-000000000001',
          'd8000000-0000-4000-8000-000000000001',
          'e8000000-0000-4000-8000-000000000102',
          'sandbox',
          'synthetic_cross_connection',
          pg_temp.fingerprint('cross-connection-version')
        )
      ),
      'phase8a0-source-cross-connection'
    )$$,
    '42501'
  ),
  'provider-source cross-connection scope is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a',
        'f8000000-0000-4000-8000-000000000101',
        pg_temp.fingerprint('cross-environment'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000103',
          'b8000000-0000-4000-8000-000000000001',
          'd8000000-0000-4000-8000-000000000001',
          'e8000000-0000-4000-8000-000000000101',
          'production',
          'synthetic_cross_environment',
          pg_temp.fingerprint('cross-environment-version')
        )
      ),
      'phase8a0-source-cross-environment'
    )$$,
    '42501'
  ),
  'provider-source environment must exactly match the leased task'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000102',
        '48000000-0000-4000-8000-000000000102',
        'phase8a0-owner-b',
        'f8000000-0000-4000-8000-000000000102',
        pg_temp.fingerprint('disconnected-source'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000104',
          'b8000000-0000-4000-8000-000000000002',
          'd8000000-0000-4000-8000-000000000002',
          'e8000000-0000-4000-8000-000000000102',
          'production',
          'synthetic_disconnected',
          pg_temp.fingerprint('disconnected-source-version')
        )
      ),
      'phase8a0-source-disconnected'
    )$$,
    '42501'
  ),
  'disconnected connection cannot commit provider sources'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_provider_external_source_record_version_v1(
      pg_temp.provider_source_command(
        '38000000-0000-4000-8000-000000000101',
        '48000000-0000-4000-8000-000000000101',
        'phase8a0-owner-a',
        'f8000000-0000-4000-8000-000000000102',
        pg_temp.fingerprint('cross-mapping'),
        pg_temp.provider_source_version(
          '78000000-0000-4000-8000-000000000105',
          'b8000000-0000-4000-8000-000000000001',
          'd8000000-0000-4000-8000-000000000001',
          'e8000000-0000-4000-8000-000000000101',
          'sandbox',
          'synthetic_cross_mapping',
          pg_temp.fingerprint('cross-mapping-version')
        )
      ),
      'phase8a0-source-cross-mapping'
    )$$,
    '42501'
  ),
  'provider-source mapping substitution is denied'
);
reset role;

select is(
  (
    select count(*)::integer
    from private.external_source_record_versions
    where id = '78000000-0000-4000-8000-000000000101'
  ),
  1,
  'idempotent provider-source replay preserves one immutable version'
);
select ok(
  exists (
    select 1
    from private.external_source_record_versions
    where id = '78000000-0000-4000-8000-000000000101'
      and source_kind = 'provider'
      and provider_key = 'quickbooks_online'
      and trust = 'untrusted_external_input'
      and validation_state = 'pending'
      and sync_run_id = '28000000-0000-4000-8000-000000000101'
  ),
  'provider source preserves provider identity, sync provenance, untrusted trust, and pending validation'
);
select is(
  (select count(*)::integer from private.canonical_business_fact_versions),
  0,
  'provider-source authority creates no canonical fact'
);
select is(
  (select count(*)::integer from private.fact_contribution_events),
  0,
  'provider-source authority creates no contribution event'
);
select is(
  (select count(*)::integer from private.deterministic_aggregate_states),
  0,
  'provider-source authority creates no deterministic KPI state'
);

commit;

-- The fixture is synthetic and the entire database is disposable. Committing it
-- here makes it visible to independent dblink sessions for actual lock testing.
select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(
      current_setting('vaeroex.test_database_url_b64'),
      'base64'
    ),
    'UTF8'
  )
)
from (
  values
    ('phase8a0_read_concurrency_1'),
    ('phase8a0_read_concurrency_2'),
    ('phase8a0_refresh_concurrency')
) as connections(connection_name);

select extensions.dblink_exec(
  connection_name,
  'set role integration_credential_broker_authority'
)
from (
  values
    ('phase8a0_read_concurrency_1'),
    ('phase8a0_read_concurrency_2'),
    ('phase8a0_refresh_concurrency')
) as connections(connection_name);

select extensions.dblink_exec('phase8a0_read_concurrency_1', 'begin');

select is(
  result.state,
  'available',
  'the first ordinary provider read holds a transaction-scoped shared lock'
)
from extensions.dblink(
  'phase8a0_read_concurrency_1',
  $read_one$
    select public.read_integration_provider_credential_v5(
        jsonb_build_object(
          'contractVersion', 'integration_provider_credential_read_v1',
          'taskId', '38000000-0000-4000-8000-000000000101',
          'leaseId', '48000000-0000-4000-8000-000000000101',
          'leaseOwnerFingerprint',
            'sha256:' || encode(
              extensions.digest(convert_to('phase8a0-owner-a', 'UTF8'), 'sha256'),
              'hex'
            ),
          'expectedCredentialVersion', 1,
          'requiredScopes', jsonb_build_array(
            'com.intuit.quickbooks.accounting'
          ),
          'minimumValiditySeconds', 300,
          'requestedAt', to_char(
            transaction_timestamp(),
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        'phase8a0-concurrent-read-one'
      ) ->> 'state' as state
  $read_one$
) as result(state text);

select is(
  result.state,
  'available',
  'a second ordinary provider read completes while the first holds shared locks'
)
from extensions.dblink(
  'phase8a0_read_concurrency_2',
  $read_two$
    select public.read_integration_provider_credential_v5(
      jsonb_build_object(
        'contractVersion', 'integration_provider_credential_read_v1',
        'taskId', '38000000-0000-4000-8000-000000000103',
        'leaseId', '48000000-0000-4000-8000-000000000103',
        'leaseOwnerFingerprint',
          'sha256:' || encode(
            extensions.digest(convert_to('phase8a0-owner-c', 'UTF8'), 'sha256'),
            'hex'
          ),
        'expectedCredentialVersion', 1,
        'requiredScopes', jsonb_build_array(
          'com.intuit.quickbooks.accounting'
        ),
        'minimumValiditySeconds', 300,
        'requestedAt', to_char(
          transaction_timestamp(),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'phase8a0-concurrent-read-two'
    ) ->> 'state' as state
  $read_two$
) as result(state text);

select extensions.dblink_exec('phase8a0_read_concurrency_1', 'commit');

select ok(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct task_id) = 2
      and pg_catalog.count(distinct lease_id) = 2
      and pg_catalog.count(distinct evidence_fingerprint) = 2
      and pg_catalog.count(distinct credential_id) = 1
    from private.integration_provider_credential_task_read_evidence
    where request_id in (
      'phase8a0-concurrent-read-one',
      'phase8a0-concurrent-read-two'
    )
  ),
  'concurrent tasks sharing one credential create distinct non-cross-bound evidence'
);

select extensions.dblink_exec('phase8a0_read_concurrency_1', 'begin');
select is(
  result.state,
  'available',
  'ordinary read remains valid before a competing refresh mutation'
)
from extensions.dblink(
  'phase8a0_read_concurrency_1',
  $read_during_refresh$
    select public.read_integration_provider_credential_v5(
        jsonb_build_object(
          'contractVersion', 'integration_provider_credential_read_v1',
          'taskId', '38000000-0000-4000-8000-000000000101',
          'leaseId', '48000000-0000-4000-8000-000000000101',
          'leaseOwnerFingerprint',
            'sha256:' || encode(
              extensions.digest(convert_to('phase8a0-owner-a', 'UTF8'), 'sha256'),
              'hex'
            ),
          'expectedCredentialVersion', 1,
          'requiredScopes', jsonb_build_array(
            'com.intuit.quickbooks.accounting'
          ),
          'minimumValiditySeconds', 300,
          'requestedAt', to_char(
            transaction_timestamp(),
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        ),
        'phase8a0-read-during-refresh'
      ) ->> 'state' as state
  $read_during_refresh$
) as result(state text);

select extensions.dblink_send_query(
  'phase8a0_refresh_concurrency',
  $refresh$
    select public.acquire_integration_credential_refresh_lease_v1(
      jsonb_build_object(
        'workspaceId', 'b8000000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8000000-0000-4000-8000-000000000001',
        'connectionId', 'e8000000-0000-4000-8000-000000000101',
        'connectionGeneration', 1,
        'credentialId', '68000000-0000-4000-8000-000000000101',
        'expectedCredentialVersion', 1,
        'leaseId', '88000000-0000-4000-8000-000000000101',
        'leaseOwnerFingerprint',
          'sha256:' || encode(
            extensions.digest(convert_to('phase8a0-refresh-owner', 'UTF8'), 'sha256'),
            'hex'
          ),
        'acquiredAt', to_char(
          transaction_timestamp(),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'leaseExpiresAt', to_char(
          transaction_timestamp() + interval '2 minutes',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'phase8a0-concurrent-refresh'
    ) ->> 'acquired' as acquired
  $refresh$
);
select pg_catalog.pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('phase8a0_refresh_concurrency'),
  1,
  'refresh mutation waits while an ordinary read holds a shared credential lock'
);
select extensions.dblink_exec('phase8a0_read_concurrency_1', 'commit');
select is(
  result.acquired,
  'true',
  'refresh obtains its exclusive CAS lease after the reader releases safely'
)
from extensions.dblink_get_result('phase8a0_refresh_concurrency')
  as result(acquired text);

select extensions.dblink_disconnect('phase8a0_read_concurrency_1');
select extensions.dblink_disconnect('phase8a0_read_concurrency_2');
select extensions.dblink_disconnect('phase8a0_refresh_concurrency');

select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'company_info'
  ),
  'company_configuration',
  'QBO company streams map to the canonical company-configuration domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'accounts'
  ),
  'master_records',
  'QBO master-record streams map to the canonical master-records domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'qbo_invoice'
  ),
  'financial_transactions',
  'QBO transaction streams map to the canonical financial-transactions domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'qbo_balancesheet'
  ),
  'report_control_observations',
  'QBO report streams map to the canonical report-control domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'caller_controlled_stream'
  ),
  null,
  'unknown QBO streams fail closed without a freshness-domain mapping'
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
  configuration_version, authorized_at, status_changed_at,
  disconnected_at, deleted_at, last_transition_request_id,
  last_transition_request_fingerprint, row_version, created_by,
  created_at, updated_at
) values (
  'e8000000-0000-4000-8000-000000000201',
  'integration_connection_v1', 'integration_connection_control_v1',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000201', 1, null,
  'quickbooks_online', 'production',
  extensions.digest(
    convert_to('synthetic-qbo-activation-realm', 'UTF8'),
    'sha256'
  ),
  'initializing', 'initial_sync_pending',
  array['com.intuit.quickbooks.accounting']::text[],
  array['com.intuit.quickbooks.accounting']::text[],
  'Synthetic QBO Activation', 'vaeroex_provider_descriptors_v1',
  decode(
    '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
    'hex'
  ),
  decode(
    'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
    'hex'
  ),
  'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
  transaction_timestamp(), transaction_timestamp(), null, null,
  null, null, 1, 'a8000000-0000-4000-8000-000000000001',
  transaction_timestamp(), transaction_timestamp()
);

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, replaces_mapping_id, provider_key,
  provider_environment, provider_entity_type,
  provider_entity_reference_fingerprint, safe_display_name, mapping_role,
  status, verification_mode, verification_fingerprint, verified_at, mapped_by,
  mapped_at, last_transition_request_id, last_transition_request_fingerprint,
  row_version, created_at, updated_at
) values (
  'f8000000-0000-4000-8000-000000000201', 'provider_entity_mapping_v1',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000201',
  'f8000000-0000-4000-8000-000000000201', 1, null,
  'quickbooks_online', 'production', 'company',
  extensions.digest(convert_to('synthetic-qbo-activation-entity', 'UTF8'), 'sha256'),
  'Synthetic QBO Activation Entity', 'primary', 'active',
  'qbo_realm_mapping_v1',
  extensions.digest(convert_to('synthetic-qbo-activation-verified', 'UTF8'), 'sha256'),
  transaction_timestamp(), 'a8000000-0000-4000-8000-000000000001',
  transaction_timestamp(), null, null, 1,
  transaction_timestamp(), transaction_timestamp()
);

insert into private.integration_sync_runs (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, connection_generation, trigger_kind, mode, state,
  idempotency_fingerprint, window_start_at, window_end_at,
  provider_contract_version, adapter_version, policy_version,
  records_observed, records_accepted, records_rejected, facts_accepted,
  contributions_changed, error_category, error_code,
  last_transition_request_id, last_transition_request_fingerprint,
  created_at, started_at, finished_at, row_version, updated_at
) values (
  '28000000-0000-4000-8000-000000000201', 'integration_sync_run_v1',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000201',
  'f8000000-0000-4000-8000-000000000201', 1,
  'provider_initialization', 'initialization', 'succeeded',
  extensions.digest(convert_to('phase8a0-activation-run', 'UTF8'), 'sha256'),
  null, null, 'provider_adapter_v1', 'qbo_provider_adapter_v1',
  'qbo_historical_sync_policy_v1', 21, 21, 0, 0, 0, null, null,
  'phase8a0-activation-run',
  extensions.digest(convert_to('phase8a0-activation-run-request', 'UTF8'), 'sha256'),
  transaction_timestamp(), transaction_timestamp(), transaction_timestamp(), 3,
  transaction_timestamp()
);

with required_streams as (
  select required.stream_key, required.ordinality
  from pg_catalog.jsonb_array_elements_text(
    pg_temp.qbo_capability() -> 'requiredStreamKeys'
  ) with ordinality as required(stream_key, ordinality)
  where required.stream_key <> 'qbo_vendorcredit'
)
insert into private.integration_freshness_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, provider_key, domain, scope_key, provider_watermark_at,
  last_attempt_at, last_successful_sync_at, last_reconciled_at,
  observed_lag_seconds, status, blocking_level, reason_code, policy_version,
  current_max_age_seconds, stale_after_seconds, age_seconds, calculated_at,
  state_fingerprint, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at
)
select
  (
    '98000000-0000-4000-8000-'
    || pg_catalog.lpad(required.ordinality::text, 12, '0')
  )::uuid,
  'integration_freshness_v1',
  'b8000000-0000-4000-8000-000000000001'::uuid,
  'd8000000-0000-4000-8000-000000000001'::uuid,
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'f8000000-0000-4000-8000-000000000201'::uuid,
  'quickbooks_online',
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    required.stream_key
  ),
  required.stream_key,
  transaction_timestamp(), transaction_timestamp(), transaction_timestamp(),
  transaction_timestamp(), 0, 'current', 'none', 'within_current_threshold',
  'qbo_control_plane_freshness_policy_v1', 3600, 7200, 0,
  transaction_timestamp(),
  extensions.digest(
    convert_to('phase8a0-activation-' || required.stream_key, 'UTF8'),
    'sha256'
  ),
  'phase8a0-activation-' || required.stream_key,
  extensions.digest(
    convert_to('phase8a0-activation-request-' || required.stream_key, 'UTF8'),
    'sha256'
  ),
  1, transaction_timestamp(), transaction_timestamp()
from required_streams as required;

create or replace function pg_temp.qbo_activation_command()
returns jsonb
language sql
stable
as $function$
  select pg_catalog.jsonb_build_object(
    'workspaceId', 'b8000000-0000-4000-8000-000000000001',
    'businessEntityId', 'd8000000-0000-4000-8000-000000000001',
    'connectionId', 'e8000000-0000-4000-8000-000000000201',
    'expectedRowVersion', 1,
    'expectedGeneration', 1,
    'targetStatus', 'active',
    'stateReasonCode', 'healthy',
    'providerTenantReferenceFingerprint', 'synthetic-qbo-activation-realm',
    'grantedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'transitionedAt', transaction_timestamp()
  );
$function$;

set local role integration_control_plane_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.qbo_activation_command(),
      'phase8a0-activation-missing',
      'phase8a0-test'
    )$$,
    '55000'
  ),
  'a missing required QBO stream keeps activation fail closed'
);
reset role;

insert into private.integration_freshness_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_id, provider_key, domain, scope_key, provider_watermark_at,
  last_attempt_at, last_successful_sync_at, last_reconciled_at,
  observed_lag_seconds, status, blocking_level, reason_code, policy_version,
  current_max_age_seconds, stale_after_seconds, age_seconds, calculated_at,
  state_fingerprint, last_request_id, last_request_fingerprint, row_version,
  created_at, updated_at
) values (
  '98000000-0000-4000-8000-000000000021',
  'integration_freshness_v1',
  'b8000000-0000-4000-8000-000000000001',
  'd8000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000201',
  'f8000000-0000-4000-8000-000000000201',
  'quickbooks_online', 'financial_transactions', 'qbo_vendorcredit',
  transaction_timestamp(), transaction_timestamp(), transaction_timestamp(),
  null, 0, 'sync_error', 'current_intelligence', 'latest_sync_failed',
  'qbo_control_plane_freshness_policy_v1', 3600, 7200, 0,
  transaction_timestamp(),
  extensions.digest(convert_to('phase8a0-activation-failed', 'UTF8'), 'sha256'),
  'phase8a0-activation-failed',
  extensions.digest(
    convert_to('phase8a0-activation-failed-request', 'UTF8'),
    'sha256'
  ),
  1, transaction_timestamp(), transaction_timestamp()
);

set local role integration_control_plane_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.qbo_activation_command(),
      'phase8a0-activation-failed',
      'phase8a0-test'
    )$$,
    '55000'
  ),
  'a failed required QBO stream keeps activation fail closed'
);
reset role;

update private.integration_freshness_states
set status = 'unknown',
  blocking_level = 'all_derived',
  reason_code = 'source_quarantined',
  row_version = row_version + 1,
  updated_at = transaction_timestamp()
where id = '98000000-0000-4000-8000-000000000021';

set local role integration_control_plane_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.qbo_activation_command(),
      'phase8a0-activation-quarantined',
      'phase8a0-test'
    )$$,
    '55000'
  ),
  'a quarantined required QBO stream keeps activation fail closed'
);
reset role;

update private.integration_freshness_states
set status = 'stale',
  blocking_level = 'all_derived',
  reason_code = 'exceeds_stale_threshold',
  last_successful_sync_at = transaction_timestamp() - interval '3 hours',
  age_seconds = 10800,
  row_version = row_version + 1,
  updated_at = transaction_timestamp()
where id = '98000000-0000-4000-8000-000000000021';

set local role integration_control_plane_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.transition_integration_connection_v1(
      pg_temp.qbo_activation_command(),
      'phase8a0-activation-stale',
      'phase8a0-test'
    )$$,
    '55000'
  ),
  'a stale required QBO stream keeps activation fail closed'
);
reset role;

update private.integration_freshness_states
set status = 'current',
  blocking_level = 'none',
  reason_code = 'within_current_threshold',
  last_successful_sync_at = transaction_timestamp(),
  age_seconds = 0,
  row_version = row_version + 1,
  updated_at = transaction_timestamp()
where id = '98000000-0000-4000-8000-000000000021';

set local role integration_control_plane_authority;
select is(
  public.transition_integration_connection_v1(
    pg_temp.qbo_activation_command(),
    'phase8a0-activation-complete',
    'phase8a0-test'
  ) #>> '{connection,status}',
  'active',
  'a completed QBO initial synchronization can transition to active'
);
reset role;

select is(
  (
    select connection.status
    from private.integration_connections as connection
    where connection.id = 'e8000000-0000-4000-8000-000000000201'
  ),
  'active',
  'the positive activation transition is durably recorded'
);

select * from finish();
