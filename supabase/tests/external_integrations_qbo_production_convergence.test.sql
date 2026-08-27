begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_sqlstate(
  p_sql text,
  p_expected text
)
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
  p_business_entity_id uuid
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
    'providerEnvironment', 'production',
    'safeDisplayName', 'Production QBO connection',
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'providerDescriptorRegistryVersion',
      'vaeroex_provider_descriptors_v1',
    'providerDescriptorRegistryFingerprint',
      'sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad',
    'providerDescriptorFingerprint',
      'sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f',
    'adapterVersion', 'qbo_provider_adapter_v1',
    'capabilitySnapshot', pg_temp.qbo_capability(),
    'configurationVersion', 1,
    'requestedAt', pg_catalog.transaction_timestamp()
  );
$function$;

create or replace function pg_temp.customer_oauth_state_command(
  p_state_id uuid,
  p_connection_id uuid,
  p_state_value text,
  p_generation bigint default 1,
  p_row_version bigint default 1
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_customer_oauth_state_v2',
    'stateId', p_state_id,
    'connectionId', p_connection_id,
    'expectedConnectionGeneration', p_generation,
    'expectedConnectionRowVersion', p_row_version,
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'redirectUri', 'https://integrations.vaeroex.com/oauth/callback',
    'returnIntent', '/app/settings',
    'stateHash', pg_temp.fingerprint(p_state_value),
    'requestedAt', pg_catalog.transaction_timestamp(),
    'expiresAt', pg_catalog.transaction_timestamp() + interval '10 minutes'
  );
$function$;

create or replace function pg_temp.customer_reauthorization_command(
  p_state_id uuid,
  p_connection_id uuid,
  p_state_value text,
  p_generation bigint,
  p_row_version bigint
)
returns jsonb
language sql
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', 'qbo_customer_reauthorization_state_v2',
    'stateId', p_state_id,
    'connectionId', p_connection_id,
    'expectedConnectionGeneration', p_generation,
    'expectedConnectionRowVersion', p_row_version,
    'requestedScopes', pg_catalog.jsonb_build_array(
      'com.intuit.quickbooks.accounting'
    ),
    'redirectUri', 'https://integrations.vaeroex.com/oauth/callback',
    'returnIntent', '/app/settings',
    'stateHash', pg_temp.fingerprint(p_state_value),
    'requestedAt', pg_catalog.transaction_timestamp(),
    'expiresAt', pg_catalog.transaction_timestamp() + interval '10 minutes'
  );
$function$;

insert into public.profiles (id, email, full_name) values
  (
    'a9f00000-0000-4000-8000-000000000001',
    'qbo-production-owner-a@example.test',
    'QBO Production Owner A'
  ),
  (
    'a9f00000-0000-4000-8000-000000000002',
    'qbo-production-owner-b@example.test',
    'QBO Production Owner B'
  );

insert into public.workspaces (id, name, created_by) values
  (
    'b9f00000-0000-4000-8000-000000000001',
    'QBO Production Workspace A',
    'a9f00000-0000-4000-8000-000000000001'
  ),
  (
    'b9f00000-0000-4000-8000-000000000002',
    'QBO Production Workspace B',
    'a9f00000-0000-4000-8000-000000000002'
  );

insert into public.workspace_members (
  id,
  workspace_id,
  user_id,
  role,
  status
) values
  (
    'c9f00000-0000-4000-8000-000000000001',
    'b9f00000-0000-4000-8000-000000000001',
    'a9f00000-0000-4000-8000-000000000001',
    'owner',
    'active'
  ),
  (
    'c9f00000-0000-4000-8000-000000000002',
    'b9f00000-0000-4000-8000-000000000002',
    'a9f00000-0000-4000-8000-000000000002',
    'owner',
    'active'
  );

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
    'd9f00000-0000-4000-8000-000000000001',
    'b9f00000-0000-4000-8000-000000000001',
    'business_entity_v1',
    'qbo_production_company_a',
    'operating_company',
    'QBO Production Company A',
    'USD',
    'UTC',
    1,
    'active',
    'a9f00000-0000-4000-8000-000000000001',
    'a9f00000-0000-4000-8000-000000000001',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  ),
  (
    'd9f00000-0000-4000-8000-000000000002',
    'b9f00000-0000-4000-8000-000000000002',
    'business_entity_v1',
    'qbo_production_company_b',
    'operating_company',
    'QBO Production Company B',
    'USD',
    'UTC',
    1,
    'active',
    'a9f00000-0000-4000-8000-000000000002',
    'a9f00000-0000-4000-8000-000000000002',
    pg_catalog.transaction_timestamp(),
    pg_catalog.transaction_timestamp()
  );

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'integration_qbo_configuration_authority'
      and not rolcanlogin
      and not rolinherit
  ),
  'QBO configuration authority is NOLOGIN and NOINHERIT'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.integration_qbo_runtime_configurations',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role',
    'private.integration_qbo_runtime_configurations',
    'SELECT'
  ),
  'customer and service roles cannot read private QBO runtime configuration'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'private.integration_qbo_runtime_configurations'::regclass
  ),
  'QBO runtime configuration has forced RLS'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_qbo_customer_oauth_state_v2(jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.create_qbo_customer_oauth_state_v2(jsonb,text)',
    'EXECUTE'
  ),
  'customer OAuth is authenticated-only with no service-role shortcut'
);
select ok(
  pg_catalog.has_function_privilege(
    'integration_task_dispatch_authority',
    'public.discover_qbo_runtime_dispatch_v2(text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.discover_qbo_runtime_dispatch_v2(text,integer)',
    'EXECUTE'
  ),
  'multi-tenant dispatcher has one narrow authority and no service-role shortcut'
);
select ok(
  pg_catalog.has_function_privilege(
    'integration_task_dispatch_authority',
    'public.discover_qbo_runtime_dispatch_reconciliation_v2(text,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.discover_qbo_runtime_dispatch_reconciliation_v2(text,integer)',
    'EXECUTE'
  ),
  'dispatch reconciliation has one narrow authority and no service-role shortcut'
);
select ok(
  pg_catalog.has_function_privilege(
    'integration_task_dispatch_authority',
    'public.confirm_qbo_runtime_cloud_task_staged_v2(jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.confirm_qbo_runtime_cloud_task_staged_v2(jsonb,text)',
    'EXECUTE'
  ),
  'Cloud Task staging confirmation has one narrow authority and no service-role shortcut'
);
select ok(
  pg_catalog.has_function_privilege(
    'integration_provider_runtime_authority',
    'public.read_qbo_runtime_task_delivery_v2(uuid,text,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'integration_task_dispatch_authority',
    'public.read_qbo_runtime_task_delivery_v2(uuid,text,text)',
    'EXECUTE'
  ),
  'task delivery authority is isolated from dispatcher authority'
);

set local role integration_qbo_configuration_authority;
create temporary table qbo_production_configuration_create_result on commit drop as
select public.register_qbo_runtime_configuration_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_runtime_configuration_v2',
      'providerEnvironment', 'production',
      'deploymentTier', 'production',
      'configurationVersion', 1,
      'authorizationRedirectUri',
        'https://integrations.vaeroex.com/oauth/callback',
      'authorizationReturnIntent', '/app/settings',
      'providerApiOrigin', 'https://quickbooks.api.intuit.com',
      'queueName', 'qbo-production',
      'queueAudience', 'https://qbo-runtime.vaeroex.com'
    ),
    'qbo_prod_config_create'
  ) as result;
create temporary table qbo_production_configuration_replay_result on commit drop as
select public.register_qbo_runtime_configuration_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_runtime_configuration_v2',
      'providerEnvironment', 'production',
      'deploymentTier', 'production',
      'configurationVersion', 1,
      'authorizationRedirectUri',
        'https://integrations.vaeroex.com/oauth/callback',
      'authorizationReturnIntent', '/app/settings',
      'providerApiOrigin', 'https://quickbooks.api.intuit.com',
      'queueName', 'qbo-production',
      'queueAudience', 'https://qbo-runtime.vaeroex.com'
    ),
    'qbo_prod_config_replay'
  ) as result;
create temporary table qbo_production_configuration_invalid_result on commit drop as
select pg_temp.raises_sqlstate(
    $$select public.register_qbo_runtime_configuration_v2(
      jsonb_build_object(
        'contractVersion', 'qbo_runtime_configuration_v2',
        'providerEnvironment', 'production',
        'deploymentTier', 'production',
        'configurationVersion', 2,
        'authorizationRedirectUri',
          'https://p8b-oauth.example.test/oauth/callback',
        'authorizationReturnIntent', '/app/settings',
        'providerApiOrigin', 'https://quickbooks.api.intuit.com',
        'queueName', 'p8b-qbo',
        'queueAudience', 'https://p8b-runtime.example.test'
      ),
      'qbo_prod_config_invalid'
    )$$,
    '23505'
  ) as denied;
reset role;
set local search_path = public, extensions;

select is(
  (select result ->> 'idempotent'
   from qbo_production_configuration_create_result),
  'false',
  'Production runtime configuration is registered once'
);
select is(
  (select result ->> 'idempotent'
   from qbo_production_configuration_replay_result),
  'true',
  'identical Production runtime configuration replay is idempotent'
);
select ok(
  (select denied from qbo_production_configuration_invalid_result),
  'Production configuration cannot be replaced by a Phase 8B binding'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;
select is(
  public.create_integration_connection_intent_v1(
    pg_temp.qbo_connection_intent(
      'e9f00000-0000-4000-8000-000000000001',
      'b9f00000-0000-4000-8000-000000000001',
      'd9f00000-0000-4000-8000-000000000001'
    )
  ) -> 'connection' ->> 'workspaceId',
  'b9f00000-0000-4000-8000-000000000001',
  'Workspace A creates a connection only inside its authenticated workspace'
);
select is(
  public.create_qbo_customer_oauth_state_v2(
    pg_temp.customer_oauth_state_command(
      '09f00000-0000-4000-8000-000000000001',
      'e9f00000-0000-4000-8000-000000000001',
      'production-customer-state-a'
    ),
    'qbo_customer_oauth_a'
  ) ->> 'connectionId',
  'e9f00000-0000-4000-8000-000000000001',
  'Workspace A creates server-bound OAuth state for its own connection'
);
reset role;
set local search_path = public, extensions;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000002"}',
  true
);
set local role authenticated;
select is(
  public.create_integration_connection_intent_v1(
    pg_temp.qbo_connection_intent(
      'e9f00000-0000-4000-8000-000000000002',
      'b9f00000-0000-4000-8000-000000000002',
      'd9f00000-0000-4000-8000-000000000002'
    )
  ) -> 'connection' ->> 'workspaceId',
  'b9f00000-0000-4000-8000-000000000002',
  'Workspace B creates a separate authenticated connection'
);
select is(
  public.create_qbo_customer_oauth_state_v2(
    pg_temp.customer_oauth_state_command(
      '09f00000-0000-4000-8000-000000000002',
      'e9f00000-0000-4000-8000-000000000002',
      'production-customer-state-b'
    ),
    'qbo_customer_oauth_b'
  ) ->> 'connectionId',
  'e9f00000-0000-4000-8000-000000000002',
  'Workspace B receives a distinct OAuth state binding'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_qbo_customer_oauth_state_v2(
      pg_temp.customer_oauth_state_command(
        '09f00000-0000-4000-8000-000000000003',
        'e9f00000-0000-4000-8000-000000000001',
        'cross-tenant-oauth-state'
      ),
      'qbo_customer_oauth_cross_tenant'
    )$$,
    '42501'
  ),
  'Workspace B cannot create OAuth state for Workspace A connection'
);
select is(
  (
    select pg_catalog.count(*)::text
    from public.integration_connection_summaries as summary
    where summary.id = 'e9f00000-0000-4000-8000-000000000001'
  ),
  '0',
  'Workspace B cannot read Workspace A connection summary'
);
reset role;
set local search_path = public, extensions;

set local role integration_oauth_ingress_authority;
select is(
  public.consume_qbo_customer_oauth_state_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_customer_oauth_state_consume_v2',
      'stateHash', pg_temp.fingerprint('production-customer-state-a'),
      'redirectUri', 'https://integrations.vaeroex.com/oauth/callback'
    ),
    'qbo_customer_oauth_consume_a'
  ) ->> 'connectionId',
  'e9f00000-0000-4000-8000-000000000001',
  'callback state resolves only its exact tenant and connection binding'
);
select is(
  public.consume_qbo_customer_oauth_state_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_customer_oauth_state_consume_v2',
      'stateHash', pg_temp.fingerprint('production-customer-state-a'),
      'redirectUri', 'https://integrations.vaeroex.com/oauth/callback'
    ),
    'qbo_customer_oauth_replay_a'
  ) ->> 'reasonCode',
  'state_replayed',
  'customer OAuth state replay fails closed'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select status
      from private.integration_oauth_states
      where id = '09f00000-0000-4000-8000-000000000002'$$,
    '42501'
  ),
  'OAuth ingress cannot directly inspect another connection private state'
);
reset role;
set local search_path = public, extensions;
select is(
  (
    select status
    from private.integration_oauth_states
    where id = '09f00000-0000-4000-8000-000000000002'
  ),
  'pending',
  'consuming Workspace A state does not mutate Workspace B state'
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
) values
  (
    'e9f00000-0000-4000-8000-000000000101',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000101', 1, null,
    'quickbooks_online', 'production',
    extensions.digest(convert_to('production-realm-a', 'UTF8'), 'sha256'),
    'initializing', 'initial_sync_pending',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Production Runtime A', 'vaeroex_provider_descriptors_v1',
    decode('2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad', 'hex'),
    decode('1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(), null, null,
    null, null, 1, 'a9f00000-0000-4000-8000-000000000001',
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'e9f00000-0000-4000-8000-000000000102',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b9f00000-0000-4000-8000-000000000002',
    'd9f00000-0000-4000-8000-000000000002',
    'e9f00000-0000-4000-8000-000000000102', 1, null,
    'quickbooks_online', 'production',
    extensions.digest(convert_to('production-realm-b', 'UTF8'), 'sha256'),
    'disconnected', 'disconnected',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Production Runtime B generation 1',
    'vaeroex_provider_descriptors_v1',
    decode('2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad', 'hex'),
    decode('1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(),
    transaction_timestamp(), null, null, null, 1,
    'a9f00000-0000-4000-8000-000000000002',
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'e9f00000-0000-4000-8000-000000000103',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b9f00000-0000-4000-8000-000000000002',
    'd9f00000-0000-4000-8000-000000000002',
    'e9f00000-0000-4000-8000-000000000102', 2,
    'e9f00000-0000-4000-8000-000000000102',
    'quickbooks_online', 'production',
    extensions.digest(convert_to('production-realm-b', 'UTF8'), 'sha256'),
    'initializing', 'initial_sync_pending',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Production Runtime B generation 2',
    'vaeroex_provider_descriptors_v1',
    decode('2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad', 'hex'),
    decode('1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(), null, null,
    null, null, 1, 'a9f00000-0000-4000-8000-000000000002',
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'e9f00000-0000-4000-8000-000000000201',
    'integration_connection_v1', 'integration_connection_control_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000201', 1, null,
    'quickbooks_online', 'production',
    extensions.digest(
      convert_to('production-reauthorization-realm-a', 'UTF8'),
      'sha256'
    ),
    'reauthorization_required', 'authorization_required',
    array['com.intuit.quickbooks.accounting']::text[],
    array['com.intuit.quickbooks.accounting']::text[],
    'Production Reauthorization A',
    'vaeroex_provider_descriptors_v1',
    decode('2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad', 'hex'),
    decode('1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f', 'hex'),
    'qbo_provider_adapter_v1', pg_temp.qbo_capability(), 1,
    transaction_timestamp(), transaction_timestamp(), null, null,
    null, null, 1, 'a9f00000-0000-4000-8000-000000000001',
    transaction_timestamp(), transaction_timestamp()
  );

insert into private.provider_entity_mappings (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  mapping_series_id, mapping_version, replaces_mapping_id, provider_key,
  provider_environment, provider_entity_type,
  provider_entity_reference_fingerprint, safe_display_name, mapping_role,
  status, verification_mode, verification_fingerprint, verified_at,
  mapped_by, mapped_at, last_transition_request_id,
  last_transition_request_fingerprint, row_version, created_at, updated_at
) values
  (
    'f9f00000-0000-4000-8000-000000000101',
    'provider_entity_mapping_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000101',
    'f9f00000-0000-4000-8000-000000000101', 1, null,
    'quickbooks_online', 'production', 'company',
    extensions.digest(convert_to('production-realm-a', 'UTF8'), 'sha256'),
    'Production Company A', 'primary', 'active', 'qbo_realm_mapping_v1',
    extensions.digest(convert_to('verified-a', 'UTF8'), 'sha256'),
    transaction_timestamp(), 'a9f00000-0000-4000-8000-000000000001',
    transaction_timestamp(), null, null, 1,
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'f9f00000-0000-4000-8000-000000000103',
    'provider_entity_mapping_v1',
    'b9f00000-0000-4000-8000-000000000002',
    'd9f00000-0000-4000-8000-000000000002',
    'e9f00000-0000-4000-8000-000000000103',
    'f9f00000-0000-4000-8000-000000000103', 1, null,
    'quickbooks_online', 'production', 'company',
    extensions.digest(convert_to('production-realm-b', 'UTF8'), 'sha256'),
    'Production Company B', 'primary', 'active', 'qbo_realm_mapping_v1',
    extensions.digest(convert_to('verified-b', 'UTF8'), 'sha256'),
    transaction_timestamp(), 'a9f00000-0000-4000-8000-000000000002',
    transaction_timestamp(), null, null, 1,
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    'f9f00000-0000-4000-8000-000000000201',
    'provider_entity_mapping_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000201',
    'f9f00000-0000-4000-8000-000000000201', 1, null,
    'quickbooks_online', 'production', 'company',
    extensions.digest(
      convert_to('production-reauthorization-realm-a', 'UTF8'),
      'sha256'
    ),
    'Production Reauthorization Company A', 'primary', 'active',
    'qbo_realm_mapping_v1',
    extensions.digest(convert_to('verified-reauthorization-a', 'UTF8'), 'sha256'),
    transaction_timestamp(), 'a9f00000-0000-4000-8000-000000000001',
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
    '19f00000-0000-4000-8000-000000000101',
    'integration_workspace_policy_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'quickbooks_online', 'production', 'enabled', true, 365, 2,
    'qbo_control_plane_freshness_policy_v1',
    'qbo_metadata_retention_v1', 1, 'qbo-prod-policy-a',
    extensions.digest(convert_to('qbo-prod-policy-a', 'UTF8'), 'sha256'),
    transaction_timestamp(), transaction_timestamp()
  ),
  (
    '19f00000-0000-4000-8000-000000000103',
    'integration_workspace_policy_v1',
    'b9f00000-0000-4000-8000-000000000002',
    'quickbooks_online', 'production', 'enabled', true, 365, 2,
    'qbo_control_plane_freshness_policy_v1',
    'qbo_metadata_retention_v1', 1, 'qbo-prod-policy-b',
    extensions.digest(convert_to('qbo-prod-policy-b', 'UTF8'), 'sha256'),
    transaction_timestamp(), transaction_timestamp()
  );

insert into private.integration_oauth_states (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, provider_key, provider_environment, initiated_by,
  requested_scopes, return_intent, state_hash, status, creation_request_id,
  creation_request_fingerprint, consume_request_id,
  consume_request_fingerprint, created_at, expires_at, consumed_at,
  row_version
) values
  (
    '59f00000-0000-4000-8000-000000000101',
    'integration_oauth_state_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000101', 1,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000001',
    array['com.intuit.quickbooks.accounting']::text[], '/app/settings',
    extensions.digest(convert_to('runtime-state-a', 'UTF8'), 'sha256'),
    'consumed', 'runtime-state-a-create',
    extensions.digest(convert_to('runtime-state-a-create', 'UTF8'), 'sha256'),
    'runtime-state-a-consume',
    extensions.digest(convert_to('runtime-state-a-consume', 'UTF8'), 'sha256'),
    transaction_timestamp() - interval '1 minute',
    transaction_timestamp() + interval '9 minutes',
    transaction_timestamp(), 2
  ),
  (
    '59f00000-0000-4000-8000-000000000103',
    'integration_oauth_state_v1',
    'b9f00000-0000-4000-8000-000000000002',
    'd9f00000-0000-4000-8000-000000000002',
    'e9f00000-0000-4000-8000-000000000103', 2,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000002',
    array['com.intuit.quickbooks.accounting']::text[], '/app/settings',
    extensions.digest(convert_to('runtime-state-b', 'UTF8'), 'sha256'),
    'consumed', 'runtime-state-b-create',
    extensions.digest(convert_to('runtime-state-b-create', 'UTF8'), 'sha256'),
    'runtime-state-b-consume',
    extensions.digest(convert_to('runtime-state-b-consume', 'UTF8'), 'sha256'),
    transaction_timestamp() - interval '1 minute',
    transaction_timestamp() + interval '9 minutes',
    transaction_timestamp(), 2
  ),
  (
    '59f00000-0000-4000-8000-000000000201',
    'integration_oauth_state_v1',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000201', 1,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000001',
    array['com.intuit.quickbooks.accounting']::text[], '/app/settings',
    extensions.digest(convert_to('reauthorization-state-a', 'UTF8'), 'sha256'),
    'consumed', 'reauthorization-state-a-create',
    extensions.digest(
      convert_to('reauthorization-state-a-create', 'UTF8'),
      'sha256'
    ),
    'reauthorization-state-a-consume',
    extensions.digest(
      convert_to('reauthorization-state-a-consume', 'UTF8'),
      'sha256'
    ),
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
    '69f00000-0000-4000-8000-000000000101',
    'integration_credential_authority_v1',
    '59f00000-0000-4000-8000-000000000101',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000101', 1,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000001', 3,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'production',
      'b9f00000-0000-4000-8000-000000000001',
      'e9f00000-0000-4000-8000-000000000101',
      1,
      'quickbooks_online',
      '69f00000-0000-4000-8000-000000000101'
    ),
    'projects/vaeroex-prod/locations/us-central1/keyRings/qbo/cryptoKeys/oauth',
    decode(repeat('ab', 32), 'hex'),
    transaction_timestamp() + interval '30 minutes',
    transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    extensions.digest(convert_to('production-realm-a', 'UTF8'), 'sha256'),
    'active', 'credential-a-seed',
    extensions.digest(convert_to('credential-a-seed', 'UTF8'), 'sha256'),
    1, transaction_timestamp(), transaction_timestamp()
  ),
  (
    '69f00000-0000-4000-8000-000000000103',
    'integration_credential_authority_v1',
    '59f00000-0000-4000-8000-000000000103',
    'b9f00000-0000-4000-8000-000000000002',
    'd9f00000-0000-4000-8000-000000000002',
    'e9f00000-0000-4000-8000-000000000103', 2,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000002', 7,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'production',
      'b9f00000-0000-4000-8000-000000000002',
      'e9f00000-0000-4000-8000-000000000103',
      2,
      'quickbooks_online',
      '69f00000-0000-4000-8000-000000000103'
    ),
    'projects/vaeroex-prod/locations/us-central1/keyRings/qbo/cryptoKeys/oauth',
    decode(repeat('cd', 32), 'hex'),
    transaction_timestamp() + interval '30 minutes',
    transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    extensions.digest(convert_to('production-realm-b', 'UTF8'), 'sha256'),
    'active', 'credential-b-seed',
    extensions.digest(convert_to('credential-b-seed', 'UTF8'), 'sha256'),
    1, transaction_timestamp(), transaction_timestamp()
  ),
  (
    '69f00000-0000-4000-8000-000000000201',
    'integration_credential_authority_v1',
    '59f00000-0000-4000-8000-000000000201',
    'b9f00000-0000-4000-8000-000000000001',
    'd9f00000-0000-4000-8000-000000000001',
    'e9f00000-0000-4000-8000-000000000201', 1,
    'quickbooks_online', 'production',
    'a9f00000-0000-4000-8000-000000000001', 5,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    private.phase_5_credential_aad_digest_v1(
      'production',
      'b9f00000-0000-4000-8000-000000000001',
      'e9f00000-0000-4000-8000-000000000201',
      1,
      'quickbooks_online',
      '69f00000-0000-4000-8000-000000000201'
    ),
    'projects/vaeroex-prod/locations/us-central1/keyRings/qbo/cryptoKeys/oauth',
    decode(repeat('ef', 32), 'hex'),
    transaction_timestamp() - interval '1 minute',
    transaction_timestamp() + interval '30 days',
    array['com.intuit.quickbooks.accounting']::text[],
    extensions.digest(
      convert_to('production-reauthorization-realm-a', 'UTF8'),
      'sha256'
    ),
    'reauthorization_required', 'credential-reauthorization-a-seed',
    extensions.digest(
      convert_to('credential-reauthorization-a-seed', 'UTF8'),
      'sha256'
    ),
    1,
    transaction_timestamp() - interval '2 hours',
    transaction_timestamp() - interval '1 minute'
  );

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000002"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_qbo_customer_reauthorization_state_v2(
      pg_temp.customer_reauthorization_command(
        '09f00000-0000-4000-8000-000000000201',
        'e9f00000-0000-4000-8000-000000000201',
        'production-reauthorization-state-a',
        1,
        1
      ),
      'qbo_customer_reauthorization_cross_tenant'
    )$$,
    '42501'
  ),
  'Workspace B cannot begin reauthorization for Workspace A connection'
);
reset role;
set local search_path = public, extensions;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a9f00000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;
select is(
  public.create_qbo_customer_reauthorization_state_v2(
    pg_temp.customer_reauthorization_command(
      '09f00000-0000-4000-8000-000000000201',
      'e9f00000-0000-4000-8000-000000000201',
      'production-reauthorization-state-a',
      1,
      1
    ),
    'qbo_customer_reauthorization_a'
  ) ->> 'connectionId',
  'e9f00000-0000-4000-8000-000000000201',
  'Workspace A begins reauthorization only for its exact connection snapshot'
);
reset role;
set local search_path = public, extensions;

set local role integration_oauth_ingress_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.consume_qbo_customer_reauthorization_state_v2(
      jsonb_build_object(
        'contractVersion',
          'qbo_customer_reauthorization_state_consume_v2',
        'stateHash',
          pg_temp.fingerprint('production-reauthorization-state-a'),
        'redirectUri', 'https://integrations.vaeroex.com/oauth/callback',
        'providerEntityReferenceFingerprint',
          pg_temp.fingerprint('wrong-production-realm')
      ),
      'qbo_customer_reauthorization_wrong_realm'
    )$$,
    '42501'
  ),
  'reauthorization callback cannot substitute the mapped provider realm'
);
select is(
  public.consume_qbo_customer_reauthorization_state_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_customer_reauthorization_state_consume_v2',
      'stateHash',
        pg_temp.fingerprint('production-reauthorization-state-a'),
      'redirectUri', 'https://integrations.vaeroex.com/oauth/callback',
      'providerEntityReferenceFingerprint',
        pg_temp.fingerprint('production-reauthorization-realm-a')
    ),
    'qbo_customer_reauthorization_consume_a'
  ) ->> 'accepted',
  'true',
  'reauthorization callback requires exact tenant, generation, mapping, and realm'
);
select is(
  public.consume_qbo_customer_reauthorization_state_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_customer_reauthorization_state_consume_v2',
      'stateHash',
        pg_temp.fingerprint('production-reauthorization-state-a'),
      'redirectUri', 'https://integrations.vaeroex.com/oauth/callback',
      'providerEntityReferenceFingerprint',
        pg_temp.fingerprint('production-reauthorization-realm-a')
    ),
    'qbo_customer_reauthorization_replay_a'
  ) ->> 'reasonCode',
  'state_replayed',
  'reauthorization state remains single-use'
);
reset role;
set local search_path = public, extensions;

set local role integration_task_scheduler_authority;
create temporary table qbo_production_schedule_result on commit drop as
select public.schedule_qbo_initialization_v2(
    2,
    'qbo_prod_schedule_two_connections'
  ) as result;
reset role;
set local search_path = public, extensions;
select is(
  (select result ->> 'scheduledConnectionCount'
   from qbo_production_schedule_result),
  '2',
  'scheduler discovers two eligible Production connections from the database'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks as task
    where task.connection_id in (
      'e9f00000-0000-4000-8000-000000000101',
      'e9f00000-0000-4000-8000-000000000103'
    )
  ),
  '48',
  'scheduler creates the exact 24-stream task set for each connection'
);
select is(
  (
    select pg_catalog.count(*)::text
    from private.integration_sync_tasks as task
    where task.connection_id = 'e9f00000-0000-4000-8000-000000000103'
      and task.connection_generation = 2
  ),
  '24',
  'Production scheduling supports a legitimate generation-2 connection'
);

set local role integration_task_dispatch_authority;
create temporary table qbo_production_dispatch_discovery_results (
  observation text primary key,
  result jsonb not null
) on commit drop;
insert into qbo_production_dispatch_discovery_results (observation, result)
values
  ('two', public.discover_qbo_runtime_dispatch_v2('provider_bulk', 2)),
  ('four', public.discover_qbo_runtime_dispatch_v2('provider_bulk', 4)),
  ('all', public.discover_qbo_runtime_dispatch_v2('provider_bulk', 100));

create temporary table qbo_production_dispatch_mark_results on commit drop as
with candidates as (
  select candidate
  from qbo_production_dispatch_discovery_results as discovery
  cross join lateral pg_catalog.jsonb_array_elements(
    discovery.result
  ) as item(candidate)
  where discovery.observation = 'all'
    and candidate ->> 'streamKey' = 'accounts'
    and candidate ->> 'connectionId' in (
      'e9f00000-0000-4000-8000-000000000101',
      'e9f00000-0000-4000-8000-000000000103'
    )
)
select
  candidate ->> 'connectionId' as connection_id,
  public.mark_integration_sync_task_dispatched_v1(
    pg_catalog.jsonb_build_object(
      'workspaceId', candidate ->> 'workspaceId',
      'businessEntityId', candidate ->> 'businessEntityId',
      'connectionId', candidate ->> 'connectionId',
      'connectionGeneration', candidate ->> 'connectionGeneration',
      'taskId', candidate ->> 'taskId',
      'expectedRowVersion', candidate ->> 'rowVersion',
      'dispatcherTaskName',
        'projects/vaeroex-prod/locations/us-central1/queues/' ||
          'qbo-production/tasks/' || case
            when candidate ->> 'connectionId' =
              'e9f00000-0000-4000-8000-000000000101'
              then pg_catalog.repeat('a', 64)
            else pg_catalog.repeat('b', 64)
          end
    ),
    case
      when candidate ->> 'connectionId' =
        'e9f00000-0000-4000-8000-000000000101'
        then 'qbo_prod_dispatch_a'
      else 'qbo_prod_dispatch_b'
    end,
    'qbo_production_dispatcher'
  ) as result
from candidates;

create temporary table qbo_production_reconciliation_before on commit drop as
select public.discover_qbo_runtime_dispatch_reconciliation_v2(
    'provider_bulk',
    2
  ) as result;

create temporary table qbo_production_staging_confirmation on commit drop as
select public.confirm_qbo_runtime_cloud_task_staged_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_runtime_cloud_task_staging_v2',
      'taskId', reservation ->> 'taskId',
      'expectedRowVersion', reservation ->> 'rowVersion',
      'dispatcherTaskName', reservation ->> 'dispatcherTaskName',
      'dispatchGeneration', reservation ->> 'dispatchGeneration',
      'stagingOutcome', 'created'
    ),
    'qbo_prod_stage_confirm_a'
  ) as result
from qbo_production_reconciliation_before as reconciliation
cross join lateral pg_catalog.jsonb_array_elements(
  reconciliation.result
) as item(reservation)
where reservation ->> 'connectionId' =
  'e9f00000-0000-4000-8000-000000000101';

create temporary table qbo_production_reconciliation_after on commit drop as
select public.discover_qbo_runtime_dispatch_reconciliation_v2(
    'provider_bulk',
    2
  ) as result;

create temporary table qbo_production_staging_replay on commit drop as
select public.confirm_qbo_runtime_cloud_task_staged_v2(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_runtime_cloud_task_staging_v2',
      'taskId', result ->> 'taskId',
      'expectedRowVersion', (result ->> 'rowVersion')::bigint - 1,
      'dispatcherTaskName', result ->> 'dispatcherTaskName',
      'dispatchGeneration', result ->> 'dispatchGeneration',
      'stagingOutcome', 'already_existing'
    ),
    'qbo_prod_stage_confirm_a_replay'
  ) as result
from qbo_production_staging_confirmation;
reset role;
set local search_path = public, extensions;

select is(
  (
    select pg_catalog.count(distinct candidate ->> 'connectionId')::text
    from qbo_production_dispatch_discovery_results as discovery
    cross join lateral pg_catalog.jsonb_array_elements(
      discovery.result
    ) as item(candidate)
    where discovery.observation = 'two'
  ),
  '2',
  'bounded dispatcher gives the first two slots to distinct connections'
);
select ok(
  (
    select pg_catalog.count(*) = 4
      and pg_catalog.count(distinct connection_id) = 2
      and pg_catalog.min(per_connection) = 2
      and pg_catalog.max(per_connection) = 2
    from (
      select candidate ->> 'connectionId' as connection_id,
        pg_catalog.count(*) over (
          partition by candidate ->> 'connectionId'
        ) as per_connection
      from qbo_production_dispatch_discovery_results as discovery
      cross join lateral pg_catalog.jsonb_array_elements(
        discovery.result
      ) as item(candidate)
      where discovery.observation = 'four'
    ) as discovered
  ),
  'fair dispatcher returns two tasks per connection for a four-task bound'
);
select ok(
  not exists (
    select 1
    from qbo_production_dispatch_discovery_results as discovery
    cross join lateral pg_catalog.jsonb_array_elements(
      discovery.result
    ) as item(candidate)
    where discovery.observation = 'all'
      and candidate ->> 'providerEnvironment' <> 'production'
  ),
  'Production dispatcher cannot cross into another provider environment'
);

select ok(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct reservation ->> 'connectionId') = 2
      and pg_catalog.count(distinct reservation ->> 'dispatcherTaskName') = 2
      and pg_catalog.bool_and(
        reservation ->> 'queueName' = 'qbo-production'
      )
    from qbo_production_reconciliation_before as reconciliation
    cross join lateral pg_catalog.jsonb_array_elements(
      reconciliation.result
    ) as item(reservation)
  ),
  'never-delivered reservations are fairly and exactly rediscovered for idempotent envelope reconciliation'
);
select ok(
  not (select (result ->> 'idempotent')::boolean
       from qbo_production_staging_confirmation),
  'dispatcher atomically confirms one current-generation Cloud Task envelope'
);
select is(
  (
    select pg_catalog.count(*)::text
    from qbo_production_reconciliation_after as reconciliation
    cross join lateral pg_catalog.jsonb_array_elements(
      reconciliation.result
    ) as item(reservation)
  ),
  '1',
  'confirmed envelope is no longer rediscovered while the unconfirmed reservation remains eligible'
);
select ok(
  (select (result ->> 'idempotent')::boolean
   from qbo_production_staging_replay),
  'staging confirmation replay is idempotent without changing authoritative outcome'
);

create temporary table qbo_production_runtime_delivery_inputs on commit drop as
select task.id as task_id, task.connection_id, task.dispatcher_task_name
from private.integration_sync_tasks as task
where task.connection_id in (
    'e9f00000-0000-4000-8000-000000000101',
    'e9f00000-0000-4000-8000-000000000103'
  )
  and task.stream_key = 'accounts';
grant select on qbo_production_runtime_delivery_inputs
to integration_provider_runtime_authority;

set local role integration_provider_runtime_authority;
create temporary table qbo_production_runtime_delivery_results on commit drop as
select input.connection_id,
  public.read_qbo_runtime_task_delivery_v2(
    input.task_id,
    input.dispatcher_task_name,
    'qbo-production'
  ) as result
from qbo_production_runtime_delivery_inputs as input;
create temporary table qbo_production_runtime_delivery_denials on commit drop as
select
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_runtime_task_delivery_v2(
      input.task_id,
      substituted.dispatcher_task_name,
      'qbo-production'
    )
    from pg_temp.qbo_production_runtime_delivery_inputs as input
    cross join pg_temp.qbo_production_runtime_delivery_inputs as substituted
    where input.connection_id =
        'e9f00000-0000-4000-8000-000000000101'
      and substituted.connection_id =
        'e9f00000-0000-4000-8000-000000000103'$$,
    '42501'
  ) as cross_tenant_task_denied,
  pg_temp.raises_sqlstate(
    $$select public.read_qbo_runtime_task_delivery_v2(
      input.task_id,
      input.dispatcher_task_name,
      'qbo-production-other'
    )
    from pg_temp.qbo_production_runtime_delivery_inputs as input
    where input.connection_id =
      'e9f00000-0000-4000-8000-000000000101'$$,
    '42501'
  ) as wrong_queue_denied;
reset role;
set local search_path = public, extensions;

select is(
  (select result ->> 'credentialId'
   from qbo_production_runtime_delivery_results
   where connection_id = 'e9f00000-0000-4000-8000-000000000101'),
  '69f00000-0000-4000-8000-000000000101',
  'tenant A delivery resolves only tenant A active credential'
);
select is(
  (select result ->> 'connectionGeneration'
   from qbo_production_runtime_delivery_results
   where connection_id = 'e9f00000-0000-4000-8000-000000000103'),
  '2',
  'generation-2 delivery derives generation authority from the task'
);
select ok(
  (select cross_tenant_task_denied
   from qbo_production_runtime_delivery_denials),
  'tenant B Cloud Task identity cannot be substituted onto tenant A task'
);
select ok(
  (select wrong_queue_denied
   from qbo_production_runtime_delivery_denials),
  'queue delivery cannot substitute the configured queue name'
);

select ok(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct connection_id) = 2
      and pg_catalog.count(distinct credential_id) = 2
    from (
      select
        task.connection_id,
        (
          select credential.id
          from private.integration_credentials as credential
          where credential.workspace_id = task.workspace_id
            and credential.business_entity_id = task.business_entity_id
            and credential.connection_id = task.connection_id
            and credential.connection_generation = task.connection_generation
            and credential.status = 'active'
        ) as credential_id
      from private.integration_sync_tasks as task
      where task.stream_key = 'accounts'
        and task.connection_id in (
          'e9f00000-0000-4000-8000-000000000101',
          'e9f00000-0000-4000-8000-000000000103'
        )
    ) as binding
  ),
  'task and credential authority remain one-to-one across customer tenants'
);
select ok(
  (
    select procedure.pronargs = 2
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.discover_qbo_runtime_dispatch_v2(text,integer)'::regprocedure
  ),
  'dispatcher accepts only queue class and bound, never caller tenant IDs'
);
select ok(
  (
    select procedure.pronargs = 3
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'public.read_qbo_runtime_task_delivery_v2(uuid,text,text)'::regprocedure
  ),
  'runtime delivery accepts only task and Cloud Tasks identity inputs'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'qbo_invoice'
  ),
  'financial_transactions',
  'QBO transaction stream maps to its canonical freshness domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'qbo_balancesheet'
  ),
  'report_control_observations',
  'QBO report stream maps to its non-additive freshness domain'
);
select is(
  private.integration_stream_freshness_domain_v1(
    'quickbooks_online',
    'unknown_stream'
  ),
  null,
  'unknown QBO stream has no activation freshness authority'
);

select * from finish();
rollback;
