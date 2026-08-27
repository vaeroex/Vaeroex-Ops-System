-- QBO Production convergence.
--
-- This forward-only migration retains every Phase 8B qualification contract,
-- while adding customer-authenticated OAuth and database-derived multi-tenant
-- runtime authority for the permanent QBO service.

begin;

alter table private.integration_sync_tasks
  add column qbo_cloud_task_staged_dispatch_generation bigint,
  add column qbo_cloud_task_staged_name text,
  add column qbo_cloud_task_staged_at timestamptz,
  add column qbo_cloud_task_staging_outcome text,
  add constraint integration_sync_tasks_qbo_cloud_task_staging_check check (
    (
      qbo_cloud_task_staged_dispatch_generation is null
      and qbo_cloud_task_staged_name is null
      and qbo_cloud_task_staged_at is null
      and qbo_cloud_task_staging_outcome is null
    )
    or (
      qbo_cloud_task_staged_dispatch_generation is not null
      and qbo_cloud_task_staged_dispatch_generation > 0
      and qbo_cloud_task_staged_name is not null
      and qbo_cloud_task_staged_name ~
        '^projects/[a-z][a-z0-9-]{0,62}/locations/[a-z][a-z0-9-]{0,62}/queues/[a-z][a-z0-9-]{0,62}/tasks/[a-f0-9]{64}$'
      and qbo_cloud_task_staged_at is not null
      and qbo_cloud_task_staged_at >= created_at
      and qbo_cloud_task_staging_outcome is not null
      and qbo_cloud_task_staging_outcome in ('created', 'already_existing')
    )
  );

do $block$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_qbo_configuration_authority'
  ) then
    create role integration_qbo_configuration_authority nologin noinherit;
  end if;
end;
$block$;

alter role integration_qbo_configuration_authority nologin noinherit;

create or replace function private.integration_stream_freshness_domain_v1(
  p_provider_key text,
  p_stream_key text
)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select case
    when p_provider_key = 'synthetic' and p_stream_key = 'general_ledger'
      then 'general_ledger'
    when p_provider_key = 'quickbooks_online'
      and p_stream_key in ('company_info', 'preferences')
      then 'company_configuration'
    when p_provider_key = 'quickbooks_online'
      and p_stream_key in (
        'accounts',
        'customers_minimized',
        'items_minimized',
        'vendors_minimized'
      )
      then 'master_records'
    when p_provider_key = 'quickbooks_online'
      and p_stream_key in (
        'qbo_bill',
        'qbo_billpayment',
        'qbo_creditmemo',
        'qbo_deposit',
        'qbo_invoice',
        'qbo_journalentry',
        'qbo_payment',
        'qbo_purchase',
        'qbo_refundreceipt',
        'qbo_salesreceipt',
        'qbo_transfer',
        'qbo_vendorcredit'
      )
      then 'financial_transactions'
    when p_provider_key = 'quickbooks_online'
      and p_stream_key in (
        'qbo_apagingsummary',
        'qbo_aragingsummary',
        'qbo_balancesheet',
        'qbo_cashflow',
        'qbo_profitandloss',
        'qbo_trialbalance'
      )
      then 'report_control_observations'
    else null
  end;
$function$;

-- Pin both historical Phase 8A descriptor bytes and the reviewed Production
-- descriptor bytes. A registry fingerprint is valid only with the descriptor
-- fingerprint that actually produced it.
create or replace function private.is_phase_8a0_provider_descriptor_v1(
  p_provider_key text,
  p_provider_environment text,
  p_registry_version text,
  p_registry_fingerprint bytea,
  p_descriptor_fingerprint bytea,
  p_adapter_version text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.is_phase_8a0_provider_environment_v1(
      p_provider_key,
      p_provider_environment
    )
    and p_registry_version = 'vaeroex_provider_descriptors_v1'
    and (
      (
        p_provider_key = 'synthetic'
        and p_registry_fingerprint in (
          pg_catalog.decode(
            'f5a4e8f9b97b2bebf421ad13706f9a72d29c172c43905599d61dc19671f90a80',
            'hex'
          ),
          pg_catalog.decode(
            '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
            'hex'
          ),
          pg_catalog.decode(
            '2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad',
            'hex'
          )
        )
        and p_descriptor_fingerprint = pg_catalog.decode(
          'd5f9cfa622a8e0f8be7666770af9709ab65854ba985d485537e81b350ad175a1',
          'hex'
        )
        and p_adapter_version = 'synthetic_control_plane_adapter_v1'
      )
      or (
        p_provider_key = 'quickbooks_online'
        and (
          (
            p_registry_fingerprint = pg_catalog.decode(
              '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
              'hex'
            )
            and p_descriptor_fingerprint = pg_catalog.decode(
              'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
              'hex'
            )
          )
          or (
            p_registry_fingerprint = pg_catalog.decode(
              '2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad',
              'hex'
            )
            and p_descriptor_fingerprint = pg_catalog.decode(
              '1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f',
              'hex'
            )
          )
        )
        and p_adapter_version = 'qbo_provider_adapter_v1'
      )
    );
$function$;

create table private.integration_qbo_runtime_configurations (
  provider_environment text primary key check (
    provider_environment in ('sandbox', 'production')
  ),
  contract_version text not null check (
    contract_version = 'qbo_runtime_configuration_v2'
  ),
  deployment_tier text not null check (
    deployment_tier in ('qualification', 'production')
  ),
  configuration_version bigint not null check (configuration_version > 0),
  authorization_redirect_uri text not null check (
    pg_catalog.octet_length(authorization_redirect_uri) between 16 and 2048
  ),
  authorization_return_intent text not null check (
    private.is_phase_5_return_intent_v1(authorization_return_intent)
  ),
  provider_api_origin text not null check (
    provider_api_origin in (
      'https://sandbox-quickbooks.api.intuit.com',
      'https://quickbooks.api.intuit.com'
    )
  ),
  queue_name text not null check (
    queue_name ~ '^[a-z][a-z0-9-]{0,62}$'
  ),
  queue_audience text not null check (
    queue_audience ~ '^https://[A-Za-z0-9.-]+$'
  ),
  enabled boolean not null default false,
  created_at timestamptz not null,
  constraint integration_qbo_runtime_configuration_environment_check check (
    (
      provider_environment = 'sandbox'
      and deployment_tier = 'qualification'
      and provider_api_origin =
        'https://sandbox-quickbooks.api.intuit.com'
    ) or (
      provider_environment = 'production'
      and deployment_tier = 'production'
      and provider_api_origin = 'https://quickbooks.api.intuit.com'
      and authorization_redirect_uri not ilike '%sslip.io%'
      and authorization_redirect_uri not ilike '%sandbox%'
      and authorization_redirect_uri not ilike '%p8b%'
      and authorization_return_intent not ilike '%sandbox%'
      and authorization_return_intent not ilike '%phase8b%'
      and queue_name not ilike '%canary%'
      and queue_name not ilike 'p8b-%'
      and queue_audience not ilike '%sslip.io%'
      and queue_audience not ilike '%sandbox%'
      and queue_audience not ilike '%p8b%'
    )
  )
);

alter table private.integration_qbo_runtime_configurations
  enable row level security;
alter table private.integration_qbo_runtime_configurations
  force row level security;
create trigger reject_integration_qbo_runtime_configuration_mutation_v2
before update or delete
on private.integration_qbo_runtime_configurations
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();
revoke all on table private.integration_qbo_runtime_configurations
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

create or replace function public.register_qbo_runtime_configuration_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing private.integration_qbo_runtime_configurations;
  v_created_at timestamptz := pg_catalog.transaction_timestamp();
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_qbo_configuration_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_configuration_registration_denied';
  end if;
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'providerEnvironment', 'deploymentTier',
        'configurationVersion', 'authorizationRedirectUri',
        'authorizationReturnIntent', 'providerApiOrigin', 'queueName',
        'queueAudience'
      ]
    )
    or p_command ->> 'contractVersion' <> 'qbo_runtime_configuration_v2'
    or p_command ->> 'providerEnvironment' <> 'production'
    or p_command ->> 'deploymentTier' <> 'production'
    or (p_command ->> 'configurationVersion') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_configuration_registration_invalid';
  end if;
  select configuration.* into v_existing
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment =
    p_command ->> 'providerEnvironment'
  for share;
  if found then
    if v_existing.contract_version = p_command ->> 'contractVersion'
      and v_existing.deployment_tier = p_command ->> 'deploymentTier'
      and v_existing.configuration_version =
        (p_command ->> 'configurationVersion')::bigint
      and v_existing.authorization_redirect_uri =
        p_command ->> 'authorizationRedirectUri'
      and v_existing.authorization_return_intent =
        p_command ->> 'authorizationReturnIntent'
      and v_existing.provider_api_origin = p_command ->> 'providerApiOrigin'
      and v_existing.queue_name = p_command ->> 'queueName'
      and v_existing.queue_audience = p_command ->> 'queueAudience'
      and v_existing.enabled then
      return pg_catalog.jsonb_build_object(
        'providerEnvironment', v_existing.provider_environment,
        'configurationVersion', v_existing.configuration_version,
        'enabled', v_existing.enabled,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_runtime_configuration_registration_conflict';
  end if;
  insert into private.integration_qbo_runtime_configurations (
    provider_environment, contract_version, deployment_tier,
    configuration_version, authorization_redirect_uri,
    authorization_return_intent, provider_api_origin, queue_name,
    queue_audience, enabled, created_at
  ) values (
    p_command ->> 'providerEnvironment', p_command ->> 'contractVersion',
    p_command ->> 'deploymentTier',
    (p_command ->> 'configurationVersion')::bigint,
    p_command ->> 'authorizationRedirectUri',
    p_command ->> 'authorizationReturnIntent',
    p_command ->> 'providerApiOrigin', p_command ->> 'queueName',
    p_command ->> 'queueAudience', true, v_created_at
  ) returning * into v_existing;
  return pg_catalog.jsonb_build_object(
    'providerEnvironment', v_existing.provider_environment,
    'configurationVersion', v_existing.configuration_version,
    'enabled', v_existing.enabled,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_configuration_registration_invalid';
end;
$function$;

create table private.integration_qbo_oauth_state_bindings_v2 (
  oauth_state_id uuid primary key references
    private.integration_oauth_states(id) on delete restrict,
  contract_version text not null check (
    contract_version = 'qbo_customer_oauth_state_binding_v2'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  provider_key text not null check (provider_key = 'quickbooks_online'),
  provider_environment text not null check (
    provider_environment = 'production'
  ),
  configuration_version bigint not null check (configuration_version > 0),
  redirect_uri text not null check (
    pg_catalog.octet_length(redirect_uri) between 16 and 2048
  ),
  return_intent text not null check (
    private.is_phase_5_return_intent_v1(return_intent)
  ),
  expected_connection_row_version bigint not null check (
    expected_connection_row_version > 0
  ),
  created_at timestamptz not null,
  constraint integration_qbo_oauth_state_binding_scope_key unique (
    workspace_id, business_entity_id, connection_id,
    connection_generation, oauth_state_id
  ),
  constraint integration_qbo_oauth_state_binding_connection_fkey foreign key (
    workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment
  ) references private.integration_connections(
    workspace_id, business_entity_id, id,
    connection_generation, provider_key, provider_environment
  ) on delete restrict
);

alter table private.integration_qbo_oauth_state_bindings_v2
  enable row level security;
alter table private.integration_qbo_oauth_state_bindings_v2
  force row level security;
create trigger reject_integration_qbo_oauth_state_binding_mutation_v2
before update or delete
on private.integration_qbo_oauth_state_bindings_v2
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();
revoke all on table private.integration_qbo_oauth_state_bindings_v2
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;

create or replace function public.create_qbo_customer_oauth_state_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_actor_id uuid := auth.uid();
  v_connection private.integration_connections;
  v_state private.integration_oauth_states;
  v_configuration private.integration_qbo_runtime_configurations;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_requested_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_actor_id is null
    or not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'stateId', 'connectionId',
        'expectedConnectionGeneration', 'expectedConnectionRowVersion',
        'requestedScopes', 'redirectUri', 'returnIntent', 'stateHash',
        'requestedAt', 'expiresAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'qbo_customer_oauth_state_v2'
    or (p_command ->> 'expectedConnectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedConnectionRowVersion') !~ '^[1-9][0-9]*$'
    or not private.is_phase_5_return_intent_v1(
      p_command ->> 'returnIntent'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_oauth_state_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_requested_at := (p_command ->> 'requestedAt')::timestamptz;
  v_expires_at := (p_command ->> 'expiresAt')::timestamptz;
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[]
    or v_expires_at <= v_requested_at
    or v_expires_at > v_requested_at + interval '10 minutes'
    or v_requested_at < v_now - interval '1 minute'
    or v_requested_at > v_now + interval '1 minute' then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_oauth_state_payload_invalid';
  end if;

  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = 'production'
    and configuration.deployment_tier = 'production'
    and configuration.enabled
  for share;
  if not found
    or v_configuration.authorization_redirect_uri <>
      p_command ->> 'redirectUri'
    or v_configuration.authorization_return_intent <>
      p_command ->> 'returnIntent' then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_oauth_configuration_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or v_connection.provider_key <> 'quickbooks_online'
    or v_connection.provider_environment <> 'production'
    or v_connection.connection_generation <>
      (p_command ->> 'expectedConnectionGeneration')::bigint
    or v_connection.row_version <>
      (p_command ->> 'expectedConnectionRowVersion')::bigint
    or v_connection.status <> 'pending_authorization'
    or v_connection.requested_scopes <> v_scopes
    or not public.can_edit_operations(v_connection.workspace_id)
    or not exists (
      select 1
      from public.business_entities as entity
      where entity.workspace_id = v_connection.workspace_id
        and entity.id = v_connection.business_entity_id
        and entity.status = 'active'
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_oauth_state_denied';
  end if;

  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command || pg_catalog.jsonb_build_object('initiatedBy', v_actor_id)
  );
  select state.* into v_state
  from private.integration_oauth_states as state
  where state.creation_request_id = p_request_id;
  if found then
    if v_state.creation_request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'qbo_customer_oauth_state_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stateId', v_state.id,
      'connectionId', v_state.connection_id,
      'connectionGeneration', v_state.connection_generation,
      'expiresAt', v_state.expires_at,
      'idempotent', true
    );
  end if;
  if exists (
    select 1
    from private.integration_oauth_states as state
    join private.integration_qbo_oauth_state_bindings_v2 as binding
      on binding.oauth_state_id = state.id
    where state.connection_id = v_connection.id
      and state.connection_generation = v_connection.connection_generation
      and state.status = 'pending'
      and state.expires_at > v_now
  ) then
    raise exception using
      errcode = '55000',
      message = 'qbo_customer_oauth_state_pending';
  end if;

  insert into private.integration_oauth_states (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment, initiated_by,
    requested_scopes, return_intent, state_hash, status,
    creation_request_id, creation_request_fingerprint,
    created_at, expires_at, row_version
  ) values (
    (p_command ->> 'stateId')::uuid, 'integration_oauth_state_v1',
    v_connection.workspace_id, v_connection.business_entity_id,
    v_connection.id, v_connection.connection_generation,
    v_connection.provider_key, v_connection.provider_environment, v_actor_id,
    v_scopes, v_configuration.authorization_return_intent, v_state_hash,
    'pending', p_request_id, v_request_fingerprint, v_now,
    v_now + (v_expires_at - v_requested_at), 1
  ) returning * into v_state;

  insert into private.integration_qbo_oauth_state_bindings_v2 (
    oauth_state_id, contract_version, workspace_id, business_entity_id,
    connection_id, connection_generation, provider_key, provider_environment,
    configuration_version, redirect_uri, return_intent,
    expected_connection_row_version, created_at
  ) values (
    v_state.id, 'qbo_customer_oauth_state_binding_v2',
    v_state.workspace_id, v_state.business_entity_id, v_state.connection_id,
    v_state.connection_generation, v_state.provider_key,
    v_state.provider_environment,
    v_configuration.configuration_version,
    v_configuration.authorization_redirect_uri,
    v_configuration.authorization_return_intent,
    v_connection.row_version, v_now
  );

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id, v_state.business_entity_id, v_state.connection_id,
    'user', v_actor_id::text, 'oauth_state_created', 'succeeded',
    'oauth_state', v_state.id::text, p_request_id, 'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status,
      'contract_version', 'qbo_customer_oauth_state_v2',
      'idempotent', false
    ),
    v_now
  );
  return pg_catalog.jsonb_build_object(
    'stateId', v_state.id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'expiresAt', v_state.expires_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_oauth_state_payload_invalid';
end;
$function$;

create or replace function public.consume_qbo_customer_oauth_state_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_state private.integration_oauth_states;
  v_binding private.integration_qbo_oauth_state_bindings_v2;
  v_connection private.integration_connections;
  v_configuration private.integration_qbo_runtime_configurations;
  v_state_hash bytea;
  v_request_fingerprint bytea;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['contractVersion', 'stateHash', 'redirectUri']
    )
    or p_command ->> 'contractVersion' <>
      'qbo_customer_oauth_state_consume_v2' then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_oauth_state_consume_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select state.*
  into v_state
  from private.integration_oauth_states as state
  join private.integration_qbo_oauth_state_bindings_v2 as binding
    on binding.oauth_state_id = state.id
  where state.state_hash = v_state_hash
  for update of state;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', 'state_invalid'
    );
  end if;
  if v_state.status = 'consumed' then
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', 'state_replayed'
    );
  end if;
  if v_state.status <> 'pending' or v_state.expires_at <= v_now then
    if v_state.status = 'pending' then
      update private.integration_oauth_states as state
      set status = 'expired', row_version = state.row_version + 1
      where state.id = v_state.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', 'state_expired'
    );
  end if;

  select binding.* into v_binding
  from private.integration_qbo_oauth_state_bindings_v2 as binding
  where binding.oauth_state_id = v_state.id;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_oauth_state_consume_denied';
  end if;

  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = v_binding.provider_environment
    and configuration.configuration_version = v_binding.configuration_version
    and configuration.enabled
  for share;
  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
    and connection.id = v_state.connection_id
    and connection.connection_generation = v_state.connection_generation
  for share;
  if v_configuration.provider_environment is null
    or v_configuration.authorization_redirect_uri <>
      p_command ->> 'redirectUri'
    or v_binding.redirect_uri <> p_command ->> 'redirectUri'
    or v_binding.return_intent <> v_state.return_intent
    or v_connection.id is null
    or v_connection.row_version <> v_binding.expected_connection_row_version
    or v_connection.status <> 'pending_authorization'
    or v_connection.provider_key <> 'quickbooks_online'
    or v_connection.provider_environment <> 'production' then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_oauth_state_consume_denied';
  end if;

  update private.integration_oauth_states as state
  set status = 'consumed', consume_request_id = p_request_id,
      consume_request_fingerprint = v_request_fingerprint,
      consumed_at = v_now, row_version = state.row_version + 1
  where state.id = v_state.id
  returning state.* into v_state;

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id, v_state.business_entity_id, v_state.connection_id,
    'service', 'qbo_production_oauth_ingress', 'oauth_state_consumed',
    'succeeded', 'oauth_state', v_state.id::text, p_request_id, 'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status,
      'contract_version', 'qbo_customer_oauth_state_consume_v2',
      'idempotent', false
    ),
    v_now
  );
  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'stateId', v_state.id,
    'workspaceId', v_state.workspace_id,
    'businessEntityId', v_state.business_entity_id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'expectedConnectionRowVersion', v_binding.expected_connection_row_version,
    'providerKey', v_state.provider_key,
    'providerEnvironment', v_state.provider_environment,
    'initiatedBy', v_state.initiated_by,
    'requestedScopes', v_state.requested_scopes,
    'redirectUri', v_binding.redirect_uri,
    'returnIntent', v_binding.return_intent,
    'consumedAt', v_state.consumed_at
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_oauth_state_consume_invalid';
end;
$function$;

alter table private.integration_reauthorization_states
  drop constraint integration_reauthorization_states_contract_version_check,
  drop constraint integration_reauthorization_states_connection_generation_check,
  drop constraint integration_reauthorization_states_provider_environment_check,
  drop constraint integration_reauthorization_states_redirect_uri_check,
  drop constraint integration_reauthorization_states_return_intent_check;
alter table private.integration_reauthorization_states
  add constraint integration_reauthorization_states_contract_version_check
    check (contract_version in (
      'integration_reauthorization_state_v1',
      'integration_reauthorization_state_v2'
    )),
  add constraint integration_reauthorization_states_connection_generation_check
    check (connection_generation > 0),
  add constraint integration_reauthorization_states_provider_environment_check
    check (provider_environment in ('sandbox', 'production')),
  add constraint integration_reauthorization_states_redirect_uri_check check (
    (
      contract_version = 'integration_reauthorization_state_v1'
      and redirect_uri =
        'https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback'
    ) or (
      contract_version = 'integration_reauthorization_state_v2'
      and provider_environment = 'production'
      and pg_catalog.octet_length(redirect_uri) between 16 and 2048
      and redirect_uri not ilike '%sslip.io%'
      and redirect_uri not ilike '%sandbox%'
      and redirect_uri not ilike '%p8b%'
    )
  ),
  add constraint integration_reauthorization_states_return_intent_check check (
    (
      contract_version = 'integration_reauthorization_state_v1'
      and return_intent = '/phase8b/sandbox/reauthorized'
    ) or (
      contract_version = 'integration_reauthorization_state_v2'
      and private.is_phase_5_return_intent_v1(return_intent)
      and return_intent not ilike '%sandbox%'
      and return_intent not ilike '%phase8b%'
    )
  );

create or replace function public.create_qbo_customer_reauthorization_state_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_actor_id uuid := auth.uid();
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_credential private.integration_credentials;
  v_state private.integration_reauthorization_states;
  v_configuration private.integration_qbo_runtime_configurations;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_requested_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_actor_id is null
    or not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'stateId', 'connectionId',
        'expectedConnectionGeneration', 'expectedConnectionRowVersion',
        'requestedScopes', 'redirectUri', 'returnIntent', 'stateHash',
        'requestedAt', 'expiresAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_customer_reauthorization_state_v2'
    or (p_command ->> 'expectedConnectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedConnectionRowVersion') !~ '^[1-9][0-9]*$'
    or not private.is_phase_5_return_intent_v1(
      p_command ->> 'returnIntent'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_reauthorization_state_invalid';
  end if;
  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_requested_at := (p_command ->> 'requestedAt')::timestamptz;
  v_expires_at := (p_command ->> 'expiresAt')::timestamptz;
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[]
    or v_expires_at <= v_requested_at
    or v_expires_at > v_requested_at + interval '10 minutes'
    or v_requested_at < v_now - interval '1 minute'
    or v_requested_at > v_now + interval '1 minute' then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_reauthorization_state_invalid';
  end if;

  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = 'production'
    and configuration.deployment_tier = 'production'
    and configuration.enabled
  for share;
  if not found
    or v_configuration.authorization_redirect_uri <>
      p_command ->> 'redirectUri'
    or v_configuration.authorization_return_intent <>
      p_command ->> 'returnIntent' then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_reauthorization_configuration_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or v_connection.provider_key <> 'quickbooks_online'
    or v_connection.provider_environment <> 'production'
    or v_connection.connection_generation <>
      (p_command ->> 'expectedConnectionGeneration')::bigint
    or v_connection.row_version <>
      (p_command ->> 'expectedConnectionRowVersion')::bigint
    or v_connection.status <> 'reauthorization_required'
    or v_connection.state_reason_code <> 'authorization_required'
    or v_connection.granted_scopes <> v_scopes
    or v_connection.provider_tenant_reference_fingerprint is null
    or not public.can_edit_operations(v_connection.workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_reauthorization_state_denied';
  end if;

  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.provider_key = v_connection.provider_key
    and mapping.provider_environment = v_connection.provider_environment
    and mapping.status = 'active'
    and mapping.mapping_role = 'primary'
    and mapping.provider_entity_type = 'company'
  for share;
  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
    and credential.status = 'reauthorization_required'
  for update;
  if v_mapping.id is null
    or v_mapping.provider_entity_reference_fingerprint <>
      v_connection.provider_tenant_reference_fingerprint
    or v_mapping.verification_fingerprint is null
    or v_credential.id is null
    or v_credential.external_entity_reference_fingerprint <>
      v_mapping.provider_entity_reference_fingerprint
    or v_credential.granted_scopes <> v_scopes
    or v_credential.refresh_lease_id is not null
    or exists (
      select 1
      from private.integration_audit_events as audit
      where audit.workspace_id = v_connection.workspace_id
        and audit.business_entity_id = v_connection.business_entity_id
        and audit.connection_id = v_connection.id
        and audit.target_id = v_credential.id::text
        and audit.reason_code in ('invalid_grant', 'provider_revoked')
        and audit.occurred_at >= v_credential.created_at
    )
    or (
      select pg_catalog.count(*)
      from private.provider_entity_mappings as active_mapping
      where active_mapping.workspace_id = v_connection.workspace_id
        and active_mapping.business_entity_id = v_connection.business_entity_id
        and active_mapping.connection_id = v_connection.id
        and active_mapping.provider_key = v_connection.provider_key
        and active_mapping.provider_environment = v_connection.provider_environment
        and active_mapping.status = 'active'
        and active_mapping.mapping_role = 'primary'
        and active_mapping.provider_entity_type = 'company'
    ) <> 1
    or (
      select pg_catalog.count(*)
      from private.integration_credentials as recovery_credential
      where recovery_credential.workspace_id = v_connection.workspace_id
        and recovery_credential.business_entity_id = v_connection.business_entity_id
        and recovery_credential.connection_id = v_connection.id
        and recovery_credential.connection_generation = v_connection.connection_generation
        and recovery_credential.provider_key = v_connection.provider_key
        and recovery_credential.provider_environment = v_connection.provider_environment
        and recovery_credential.status = 'reauthorization_required'
    ) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_reauthorization_authority_denied';
  end if;

  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command || pg_catalog.jsonb_build_object('initiatedBy', v_actor_id)
  );
  select state.* into v_state
  from private.integration_reauthorization_states as state
  where state.creation_request_id = p_request_id;
  if found then
    if v_state.creation_request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'qbo_customer_reauthorization_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stateId', v_state.id,
      'connectionId', v_state.connection_id,
      'connectionGeneration', v_state.connection_generation,
      'expiresAt', v_state.expires_at,
      'idempotent', true
    );
  end if;
  if exists (
    select 1
    from private.integration_reauthorization_states as state
    where state.connection_id = v_connection.id
      and state.connection_generation = v_connection.connection_generation
      and state.status = 'pending'
      and state.expires_at > v_now
  ) then
    raise exception using
      errcode = '55000',
      message = 'qbo_customer_reauthorization_state_pending';
  end if;

  insert into private.integration_reauthorization_states (
    id, contract_version, authorization_purpose, reason_code,
    reauthorization_path, workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment, initiated_by,
    requested_scopes, redirect_uri, return_intent, state_hash,
    expected_connection_row_version, superseded_credential_id,
    superseded_credential_version, expected_credential_row_version,
    mapping_id, expected_mapping_row_version,
    provider_entity_reference_fingerprint,
    prior_mapping_verification_fingerprint, recovery_evidence_count,
    status, creation_request_id, creation_request_fingerprint,
    created_at, expires_at, row_version
  ) values (
    (p_command ->> 'stateId')::uuid,
    'integration_reauthorization_state_v2', 'reauthorization',
    'expired_credential_recovery', 'authorization_required_recovery',
    v_connection.workspace_id, v_connection.business_entity_id,
    v_connection.id, v_connection.connection_generation,
    v_connection.provider_key, v_connection.provider_environment, v_actor_id,
    v_scopes, v_configuration.authorization_redirect_uri,
    v_configuration.authorization_return_intent, v_state_hash,
    v_connection.row_version, v_credential.id,
    v_credential.credential_version, v_credential.row_version,
    v_mapping.id, v_mapping.row_version,
    v_mapping.provider_entity_reference_fingerprint,
    v_mapping.verification_fingerprint, 1, 'pending', p_request_id,
    v_request_fingerprint, v_now, v_now + (v_expires_at - v_requested_at), 1
  ) returning * into v_state;

  return pg_catalog.jsonb_build_object(
    'stateId', v_state.id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'expiresAt', v_state.expires_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_reauthorization_state_invalid';
end;
$function$;

create or replace function public.consume_qbo_customer_reauthorization_state_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_state private.integration_reauthorization_states;
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_credential private.integration_credentials;
  v_configuration private.integration_qbo_runtime_configurations;
  v_state_hash bytea;
  v_realm_fingerprint bytea;
  v_request_fingerprint bytea;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'stateHash', 'redirectUri',
        'providerEntityReferenceFingerprint'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_customer_reauthorization_state_consume_v2' then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_reauthorization_consume_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_realm_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerEntityReferenceFingerprint'
  );
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select state.* into v_state
  from private.integration_reauthorization_states as state
  where state.state_hash = v_state_hash
    and state.contract_version = 'integration_reauthorization_state_v2'
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reasonCode', 'state_invalid'
    );
  end if;
  if v_state.status in ('consumed', 'completed') then
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reasonCode', 'state_replayed'
    );
  end if;
  if v_state.status <> 'pending' or v_state.expires_at <= v_now then
    if v_state.status = 'pending' then
      update private.integration_reauthorization_states as state
      set status = 'expired', row_version = state.row_version + 1
      where state.id = v_state.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'accepted', false, 'reasonCode', 'state_expired'
    );
  end if;
  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = v_state.provider_environment
    and configuration.authorization_redirect_uri = v_state.redirect_uri
    and configuration.enabled
  for share;
  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.id = v_state.connection_id
    and connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
  for share;
  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.id = v_state.mapping_id
    and mapping.workspace_id = v_state.workspace_id
    and mapping.business_entity_id = v_state.business_entity_id
    and mapping.connection_id = v_state.connection_id
  for share;
  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.id = v_state.superseded_credential_id
  for share;
  if v_configuration.provider_environment is null
    or p_command ->> 'redirectUri' <> v_state.redirect_uri
    or v_realm_fingerprint <> v_state.provider_entity_reference_fingerprint
    or v_connection.id is null
    or v_connection.connection_generation <> v_state.connection_generation
    or v_connection.row_version <> v_state.expected_connection_row_version
    or v_connection.status <> 'reauthorization_required'
    or v_connection.state_reason_code <> 'authorization_required'
    or v_mapping.id is null
    or v_mapping.row_version <> v_state.expected_mapping_row_version
    or v_mapping.status <> 'active'
    or v_mapping.provider_entity_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_credential.id is null
    or v_credential.status <> 'reauthorization_required'
    or v_credential.credential_version <>
      v_state.superseded_credential_version
    or v_credential.row_version <> v_state.expected_credential_row_version
    or v_credential.refresh_lease_id is not null then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_reauthorization_consume_denied';
  end if;
  update private.integration_reauthorization_states as state
  set status = 'consumed', consume_request_id = p_request_id,
      consume_request_fingerprint = v_request_fingerprint,
      consumed_at = v_now, row_version = state.row_version + 1
  where state.id = v_state.id
  returning state.* into v_state;
  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'stateId', v_state.id,
    'workspaceId', v_state.workspace_id,
    'businessEntityId', v_state.business_entity_id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'mappingId', v_state.mapping_id,
    'providerKey', v_state.provider_key,
    'providerEnvironment', v_state.provider_environment,
    'initiatedBy', v_state.initiated_by,
    'requestedScopes', v_state.requested_scopes,
    'redirectUri', v_state.redirect_uri,
    'returnIntent', v_state.return_intent,
    'supersededCredentialId', v_state.superseded_credential_id,
    'supersededCredentialVersion', v_state.superseded_credential_version,
    'providerEntityReferenceFingerprint',
      private.phase_4_fingerprint_text_v1(
        v_state.provider_entity_reference_fingerprint
      ),
    'consumedAt', v_state.consumed_at
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_reauthorization_consume_invalid';
end;
$function$;

create or replace function public.store_qbo_customer_reauthorized_credential_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_completed_at timestamptz := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.clock_timestamp()
  );
  v_state private.integration_reauthorization_states;
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_old_credential private.integration_credentials;
  v_new_credential private.integration_credentials;
  v_scopes text[];
  v_ciphertext bytea;
  v_aad_digest bytea;
  v_external_fingerprint bytea;
  v_mapping_fingerprint bytea;
  v_request_fingerprint bytea;
  v_reauthorized_at timestamptz;
  v_access_expires_at timestamptz;
  v_refresh_expires_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'id', 'reauthorizationStateId', 'workspaceId',
        'businessEntityId', 'connectionId', 'connectionGeneration',
        'mappingId', 'providerKey', 'providerEnvironment', 'initiatedBy',
        'envelopeSchemaVersion', 'aadSchemaVersion', 'aadDigest',
        'kmsKeyResource', 'ciphertextBase64', 'accessExpiresAt',
        'refreshExpiresAt', 'grantedScopes',
        'externalEntityReferenceFingerprint',
        'mappingRevalidationFingerprint', 'reauthorizedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_customer_credential_reauthorization_v2'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or p_command ->> 'providerKey' <> 'quickbooks_online'
    or p_command ->> 'providerEnvironment' <> 'production'
    or p_command ->> 'envelopeSchemaVersion' <>
      'oauth_credential_envelope_v1'
    or p_command ->> 'aadSchemaVersion' <> 'oauth_credential_aad_v1'
    or not private.is_phase_5_kms_key_resource_v1(
      p_command ->> 'kmsKeyResource'
    )
    or (p_command ->> 'ciphertextBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.char_length(p_command ->> 'ciphertextBase64') > 131072 then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
  end if;
  v_scopes := private.phase_5_text_array_v1(p_command -> 'grantedScopes');
  if v_scopes <> array['com.intuit.quickbooks.accounting']::text[] then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
  end if;
  begin
    v_ciphertext := pg_catalog.decode(p_command ->> 'ciphertextBase64', 'base64');
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
  end;
  if pg_catalog.octet_length(v_ciphertext) not between 16 and 98304 then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
  end if;
  v_aad_digest := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'aadDigest'
  );
  v_external_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'externalEntityReferenceFingerprint'
  );
  v_mapping_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'mappingRevalidationFingerprint'
  );
  v_reauthorized_at := (p_command ->> 'reauthorizedAt')::timestamptz;
  v_access_expires_at := (p_command ->> 'accessExpiresAt')::timestamptz;
  v_refresh_expires_at := case
    when p_command -> 'refreshExpiresAt' = 'null'::jsonb then null
    else (p_command ->> 'refreshExpiresAt')::timestamptz
  end;
  if v_access_expires_at <= v_reauthorized_at
    or (
      v_refresh_expires_at is not null
      and v_refresh_expires_at <= v_reauthorized_at
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
  end if;
  v_access_expires_at := v_completed_at
    + (v_access_expires_at - v_reauthorized_at);
  v_refresh_expires_at := case
    when v_refresh_expires_at is null then null
    else v_completed_at + (v_refresh_expires_at - v_reauthorized_at)
  end;
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id, p_command
  );

  select credential.* into v_new_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'id')::uuid
    or credential.reauthorization_state_id =
      (p_command ->> 'reauthorizationStateId')::uuid
  for update;
  if found then
    if v_new_credential.last_request_id = p_request_id
      and v_new_credential.last_request_fingerprint = v_request_fingerprint
      and v_new_credential.status = 'active' then
      select connection.* into v_connection
      from private.integration_connections as connection
      where connection.id = v_new_credential.connection_id;
      return pg_catalog.jsonb_build_object(
        'credentialId', v_new_credential.id,
        'credentialVersion', v_new_credential.credential_version,
        'credentialStatus', v_new_credential.status,
        'supersededCredentialId', v_new_credential.supersedes_credential_id,
        'connectionStatus', v_connection.status,
        'connectionRowVersion', v_connection.row_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_customer_credential_reauthorization_conflict';
  end if;

  select state.* into v_state
  from private.integration_reauthorization_states as state
  where state.id = (p_command ->> 'reauthorizationStateId')::uuid
  for update;
  if not found
    or v_state.contract_version <> 'integration_reauthorization_state_v2'
    or v_state.status <> 'consumed'
    or v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <>
      (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_state.mapping_id <> (p_command ->> 'mappingId')::uuid
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes
    or v_state.reauthorization_path <> 'authorization_required_recovery'
    or v_reauthorized_at <> v_state.consumed_at then
    raise exception using
      errcode = '42501',
      message = 'qbo_customer_credential_reauthorization_denied';
  end if;
  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.id = v_state.connection_id
    and connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
    and connection.connection_generation = v_state.connection_generation
  for update;
  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.id = v_state.mapping_id
    and mapping.workspace_id = v_state.workspace_id
    and mapping.business_entity_id = v_state.business_entity_id
    and mapping.connection_id = v_state.connection_id
  for update;
  select credential.* into v_old_credential
  from private.integration_credentials as credential
  where credential.id = v_state.superseded_credential_id
    and credential.workspace_id = v_state.workspace_id
    and credential.business_entity_id = v_state.business_entity_id
    and credential.connection_id = v_state.connection_id
    and credential.connection_generation = v_state.connection_generation
  for update;
  if v_connection.id is null
    or v_connection.status <> 'reauthorization_required'
    or v_connection.state_reason_code <> 'authorization_required'
    or v_connection.row_version <> v_state.expected_connection_row_version
    or v_connection.provider_tenant_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_mapping.id is null
    or v_mapping.status <> 'active'
    or v_mapping.row_version <> v_state.expected_mapping_row_version
    or v_mapping.provider_entity_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_mapping.verification_fingerprint <>
      v_state.prior_mapping_verification_fingerprint
    or v_mapping_fingerprint <> v_mapping.verification_fingerprint
    or v_external_fingerprint <>
      v_state.provider_entity_reference_fingerprint
    or v_old_credential.id is null
    or v_old_credential.status <> 'reauthorization_required'
    or v_old_credential.credential_version <>
      v_state.superseded_credential_version
    or v_old_credential.row_version <> v_state.expected_credential_row_version
    or v_old_credential.refresh_lease_id is not null
    or v_old_credential.external_entity_reference_fingerprint <>
      v_state.provider_entity_reference_fingerprint then
    raise exception using
      errcode = '40001',
      message = 'qbo_customer_credential_reauthorization_stale';
  end if;
  if v_aad_digest <> private.phase_5_credential_aad_digest_v1(
    v_state.provider_environment, v_state.workspace_id, v_state.connection_id,
    v_state.connection_generation, v_state.provider_key,
    (p_command ->> 'id')::uuid
  ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_aad_invalid';
  end if;

  update private.integration_credentials as credential
  set status = 'superseded', superseded_at = v_completed_at,
      row_version = credential.row_version + 1
  where credential.id = v_old_credential.id
    and credential.row_version = v_state.expected_credential_row_version
  returning credential.* into v_old_credential;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'qbo_customer_credential_reauthorization_stale';
  end if;
  insert into private.integration_credentials (
    id, contract_version, oauth_state_id, reauthorization_state_id,
    supersedes_credential_id, workspace_id, business_entity_id, connection_id,
    connection_generation, provider_key, provider_environment, initiated_by,
    credential_version, envelope_schema_version, aad_schema_version,
    aad_digest, kms_key_resource, credential_ciphertext, access_expires_at,
    refresh_expires_at, granted_scopes,
    external_entity_reference_fingerprint, status, last_request_id,
    last_request_fingerprint, row_version, created_at, updated_at
  ) values (
    (p_command ->> 'id')::uuid, 'integration_credential_authority_v1',
    null, v_state.id, v_old_credential.id, v_state.workspace_id,
    v_state.business_entity_id, v_state.connection_id,
    v_state.connection_generation, v_state.provider_key,
    v_state.provider_environment, v_state.initiated_by,
    v_state.superseded_credential_version + 1,
    'oauth_credential_envelope_v1', 'oauth_credential_aad_v1',
    v_aad_digest, p_command ->> 'kmsKeyResource', v_ciphertext,
    v_access_expires_at, v_refresh_expires_at, v_scopes,
    v_external_fingerprint, 'active', p_request_id, v_request_fingerprint,
    1, v_completed_at, v_completed_at
  ) returning * into v_new_credential;
  update private.integration_reauthorization_states as state
  set status = 'completed', completion_request_id = p_request_id,
      completion_request_fingerprint = v_request_fingerprint,
      replacement_credential_id = v_new_credential.id,
      mapping_revalidation_fingerprint = v_mapping_fingerprint,
      completed_at = v_completed_at, row_version = state.row_version + 1
  where state.id = v_state.id
    and state.status = 'consumed'
    and state.row_version = v_state.row_version
  returning state.* into v_state;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'qbo_customer_credential_reauthorization_stale';
  end if;
  update private.integration_connections as connection
  set status = 'initializing', state_reason_code = 'initial_sync_pending',
      status_changed_at = v_completed_at,
      last_transition_request_id = p_request_id,
      last_transition_request_fingerprint = v_request_fingerprint,
      row_version = connection.row_version + 1,
      updated_at = v_completed_at
  where connection.id = v_state.connection_id
    and connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
    and connection.connection_generation = v_state.connection_generation
    and connection.status = 'reauthorization_required'
    and connection.state_reason_code = 'authorization_required'
    and connection.row_version = v_state.expected_connection_row_version
  returning connection.* into v_connection;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'qbo_customer_credential_reauthorization_stale';
  end if;
  perform private.phase_5_insert_audit_v1(
    v_new_credential.workspace_id, v_new_credential.business_entity_id,
    v_new_credential.connection_id, 'service',
    'qbo_production_credential_broker', 'credential_encrypted', 'succeeded',
    'integration_credential', v_new_credential.id::text, p_request_id,
    'authorized', pg_catalog.jsonb_build_object(
      'connection_generation', v_new_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_new_credential.status,
      'credential_version', v_new_credential.credential_version,
      'mapping_status', v_mapping.status,
      'oauth_state_status', v_state.status,
      'contract_version', 'qbo_customer_credential_reauthorization_v2',
      'idempotent', false
    ), v_completed_at
  );
  return pg_catalog.jsonb_build_object(
    'credentialId', v_new_credential.id,
    'credentialVersion', v_new_credential.credential_version,
    'credentialStatus', v_new_credential.status,
    'supersededCredentialId', v_old_credential.id,
    'connectionStatus', v_connection.status,
    'connectionRowVersion', v_connection.row_version,
    'mappingId', v_mapping.id,
    'mappingStatus', v_mapping.status,
    'mappingRowVersion', v_mapping.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_customer_credential_reauthorization_invalid';
end;
$function$;

alter table private.integration_qbo_provider_task_result_evidence
  drop constraint integration_qbo_provider_task_result_evi_contract_version_check;
alter table private.integration_qbo_provider_task_result_evidence
  add constraint integration_qbo_provider_result_contract_check
  check (contract_version in (
    'qbo_sandbox_provider_result_evidence_v1',
    'qbo_provider_result_evidence_v2'
  ));
alter table private.integration_qbo_provider_task_result_evidence
  drop constraint integration_qbo_provider_task_result_provider_environment_check;
alter table private.integration_qbo_provider_task_result_evidence
  add constraint integration_qbo_provider_result_environment_check
  check (provider_environment in ('sandbox', 'production'));

alter table private.integration_qbo_report_parser_result_evidence
  drop constraint integration_qbo_report_parser_result_evi_contract_version_check;
alter table private.integration_qbo_report_parser_result_evidence
  add constraint integration_qbo_parser_result_contract_check
  check (contract_version in (
    'qbo_sandbox_report_parser_result_evidence_v1',
    'qbo_report_parser_result_evidence_v2'
  ));
alter table private.integration_qbo_report_parser_result_evidence
  drop constraint integration_qbo_report_parser_result_provider_environment_check;
alter table private.integration_qbo_report_parser_result_evidence
  add constraint integration_qbo_parser_result_environment_check
  check (provider_environment in ('sandbox', 'production'));

create or replace function public.read_qbo_runtime_configuration_v2(
  p_provider_environment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_configuration private.integration_qbo_runtime_configurations;
begin
  if not (
    pg_catalog.pg_has_role(
      session_user,
      'integration_oauth_ingress_authority',
      'MEMBER'
    )
    or pg_catalog.pg_has_role(
      session_user,
      'integration_credential_broker_authority',
      'MEMBER'
    )
    or pg_catalog.pg_has_role(
      session_user,
      'integration_task_dispatch_authority',
      'MEMBER'
    )
    or pg_catalog.pg_has_role(
      session_user,
      'integration_task_scheduler_authority',
      'MEMBER'
    )
    or pg_catalog.pg_has_role(
      session_user,
      'integration_provider_runtime_authority',
      'MEMBER'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_configuration_denied';
  end if;
  if p_provider_environment not in ('sandbox', 'production') then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_configuration_invalid';
  end if;
  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = p_provider_environment
    and configuration.enabled
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_configuration_denied';
  end if;
  return pg_catalog.jsonb_build_object(
    'contractVersion', v_configuration.contract_version,
    'providerEnvironment', v_configuration.provider_environment,
    'deploymentTier', v_configuration.deployment_tier,
    'configurationVersion', v_configuration.configuration_version,
    'authorizationRedirectUri', v_configuration.authorization_redirect_uri,
    'authorizationReturnIntent', v_configuration.authorization_return_intent,
    'providerApiOrigin', v_configuration.provider_api_origin,
    'queueName', v_configuration.queue_name,
    'queueAudience', v_configuration.queue_audience
  );
end;
$function$;

create or replace function public.schedule_qbo_initialization_v2(
  p_limit integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_candidate record;
  v_stream_key text;
  v_run_id uuid;
  v_task_id uuid;
  v_checkpoint_id uuid;
  v_task_count integer;
  v_scheduled_connections integer := 0;
  v_scheduled_tasks integer := 0;
  v_runs jsonb := '[]'::jsonb;
  v_streams text[] := array[
    'company_info',
    'preferences',
    'accounts',
    'customers_minimized',
    'vendors_minimized',
    'items_minimized',
    'qbo_bill',
    'qbo_billpayment',
    'qbo_creditmemo',
    'qbo_deposit',
    'qbo_invoice',
    'qbo_journalentry',
    'qbo_payment',
    'qbo_purchase',
    'qbo_refundreceipt',
    'qbo_salesreceipt',
    'qbo_transfer',
    'qbo_vendorcredit',
    'qbo_apagingsummary',
    'qbo_aragingsummary',
    'qbo_balancesheet',
    'qbo_cashflow',
    'qbo_profitandloss',
    'qbo_trialbalance'
  ]::text[];
begin
  if not pg_catalog.pg_has_role(
      session_user,
      'integration_task_scheduler_authority',
      'MEMBER'
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_initialization_scheduler_denied';
  end if;
  if p_limit not between 1 and 25
    or not private.is_bounded_identifier_v1(p_request_id) then
    raise exception using
      errcode = '22023',
      message = 'qbo_initialization_scheduler_invalid';
  end if;

  for v_candidate in
    select
      connection.*,
      mapping.id as active_mapping_id,
      policy.history_horizon_days
    from private.integration_connections as connection
    join private.provider_entity_mappings as mapping
      on mapping.workspace_id = connection.workspace_id
      and mapping.business_entity_id = connection.business_entity_id
      and mapping.connection_id = connection.id
      and mapping.provider_key = connection.provider_key
      and mapping.provider_environment = connection.provider_environment
      and mapping.provider_entity_reference_fingerprint =
        connection.provider_tenant_reference_fingerprint
      and mapping.status = 'active'
    join private.integration_workspace_policies as policy
      on policy.workspace_id = connection.workspace_id
      and policy.provider_key = connection.provider_key
      and policy.provider_environment = connection.provider_environment
      and policy.state = 'enabled'
      and policy.sync_enabled
      and policy.freshness_policy_version =
        'qbo_control_plane_freshness_policy_v1'
      and policy.retention_policy_version = 'qbo_metadata_retention_v1'
    join private.integration_qbo_runtime_configurations as configuration
      on configuration.provider_environment = connection.provider_environment
      and configuration.deployment_tier = 'production'
      and configuration.enabled
    where connection.provider_key = 'quickbooks_online'
      and connection.provider_environment = 'production'
      and connection.status = 'initializing'
      and connection.state_reason_code = 'initial_sync_pending'
      and connection.disconnected_at is null
      and connection.deleted_at is null
      and (
        select pg_catalog.count(*)
        from private.integration_credentials as credential
        where credential.workspace_id = connection.workspace_id
          and credential.business_entity_id = connection.business_entity_id
          and credential.connection_id = connection.id
          and credential.connection_generation =
            connection.connection_generation
          and credential.provider_key = connection.provider_key
          and credential.provider_environment = connection.provider_environment
          and credential.status = 'active'
          and credential.external_entity_reference_fingerprint =
            mapping.provider_entity_reference_fingerprint
          and credential.granted_scopes =
            array['com.intuit.quickbooks.accounting']::text[]
      ) = 1
      and not exists (
        select 1
        from private.integration_sync_runs as existing_run
        where existing_run.workspace_id = connection.workspace_id
          and existing_run.business_entity_id = connection.business_entity_id
          and existing_run.connection_id = connection.id
          and existing_run.connection_generation =
            connection.connection_generation
          and existing_run.mode = 'initialization'
      )
    order by
      connection.status_changed_at,
      connection.workspace_id,
      connection.business_entity_id,
      connection.id
    limit p_limit
    for update of connection skip locked
  loop
    v_run_id := pg_catalog.gen_random_uuid();
    insert into private.integration_sync_runs (
      id, contract_version, workspace_id, business_entity_id,
      connection_id, mapping_id, connection_generation, trigger_kind,
      mode, state, idempotency_fingerprint, window_start_at,
      window_end_at, provider_contract_version, adapter_version,
      policy_version, last_transition_request_id,
      last_transition_request_fingerprint, created_at, started_at,
      updated_at
    ) values (
      v_run_id,
      'integration_sync_run_v1',
      v_candidate.workspace_id,
      v_candidate.business_entity_id,
      v_candidate.id,
      v_candidate.active_mapping_id,
      v_candidate.connection_generation,
      'provider_initialization',
      'initialization',
      'running',
      extensions.digest(
        pg_catalog.convert_to(
          'qbo_production_initialization_v2:' || v_candidate.id::text || ':' ||
            v_candidate.connection_generation::text,
          'UTF8'
        ),
        'sha256'
      ),
      v_now - (v_candidate.history_horizon_days * interval '1 day'),
      v_now,
      'provider_adapter_v1',
      v_candidate.adapter_version,
      'qbo_historical_sync_policy_v1',
      p_request_id,
      private.phase_4_request_fingerprint_v1(
        p_request_id,
        pg_catalog.jsonb_build_object(
          'contractVersion', 'qbo_initialization_scheduler_v2',
          'connectionId', v_candidate.id,
          'connectionGeneration', v_candidate.connection_generation,
          'syncRunId', v_run_id
        )
      ),
      v_now,
      v_now,
      v_now
    );

    perform private.phase_6_insert_audit_v1(
      v_candidate.workspace_id,
      v_candidate.business_entity_id,
      v_candidate.id,
      'qbo_initialization_scheduler',
      'integration_sync_run.create',
      'succeeded',
      'integration_sync_run',
      v_run_id::text,
      p_request_id,
      pg_catalog.jsonb_build_object(
        'contract_version', 'qbo_initialization_scheduler_v2',
        'connection_generation', v_candidate.connection_generation,
        'row_version', 1,
        'idempotent', false
      )
    );

    v_task_count := 0;
    foreach v_stream_key in array v_streams
    loop
      if private.qbo_provider_endpoint_binding_v1(v_stream_key) is null then
        raise exception using
          errcode = '55000',
          message = 'qbo_initialization_stream_contract_missing';
      end if;
      v_task_id := pg_catalog.gen_random_uuid();
      v_checkpoint_id := pg_catalog.gen_random_uuid();
      insert into private.integration_sync_tasks (
        id, contract_version, workspace_id, business_entity_id,
        connection_id, connection_generation, sync_run_id, parent_task_id,
        provider_key, provider_environment, queue_class, task_kind,
        stream_key, state, priority, control_metadata,
        idempotency_fingerprint, coalescing_fingerprint, maximum_attempts,
        available_at, last_request_id, last_request_fingerprint,
        created_at, updated_at, retention_expires_at
      ) values (
        v_task_id,
        'integration_sync_task_v1',
        v_candidate.workspace_id,
        v_candidate.business_entity_id,
        v_candidate.id,
        v_candidate.connection_generation,
        v_run_id,
        null,
        'quickbooks_online',
        'production',
        'provider_bulk',
        'initial_historical',
        v_stream_key,
        'pending',
        50,
        pg_catalog.jsonb_build_object(
          'checkpointId', v_checkpoint_id,
          'mappingId', v_candidate.active_mapping_id,
          'eventId', null,
          'pageOrdinal', 0,
          'cursorVersion', 0,
          'windowStartAt', v_now -
            (v_candidate.history_horizon_days * interval '1 day'),
          'windowEndAt', v_now,
          'reasonCode', 'qbo_production_initialization',
          'recordHintCount', 0,
          'coalescedEventCount', 1
        ),
        extensions.digest(
          pg_catalog.convert_to(
            'qbo_production_initialization_task_v2:' || v_run_id::text || ':' ||
              v_stream_key,
            'UTF8'
          ),
          'sha256'
        ),
        extensions.digest(
          pg_catalog.convert_to(
            'qbo_production_initialization_stream_v2:' ||
              v_candidate.id::text || ':' ||
              v_candidate.connection_generation::text || ':' ||
              v_stream_key,
            'UTF8'
          ),
          'sha256'
        ),
        8,
        v_now,
        p_request_id,
        private.phase_6_request_fingerprint_v1(
          p_request_id,
          pg_catalog.jsonb_build_object(
            'contractVersion', 'qbo_initialization_scheduler_v2',
            'syncRunId', v_run_id,
            'taskId', v_task_id,
            'streamKey', v_stream_key,
            'checkpointId', v_checkpoint_id
          )
        ),
        v_now,
        v_now,
        v_now + interval '90 days'
      );
      perform private.phase_6_insert_audit_v1(
        v_candidate.workspace_id,
        v_candidate.business_entity_id,
        v_candidate.id,
        'qbo_initialization_scheduler',
        'integration_sync_task.create',
        'succeeded',
        'integration_sync_task',
        v_task_id::text,
        p_request_id,
        pg_catalog.jsonb_build_object(
          'task_state', 'pending',
          'task_kind', 'initial_historical',
          'queue_class', 'provider_bulk',
          'attempt_count', 0,
          'dispatch_generation', 0,
          'row_version', 1,
          'idempotent', false
        )
      );
      v_task_count := v_task_count + 1;
    end loop;

    if v_task_count <> 24 then
      raise exception using
        errcode = '55000',
        message = 'qbo_initialization_task_set_incomplete';
    end if;
    v_scheduled_connections := v_scheduled_connections + 1;
    v_scheduled_tasks := v_scheduled_tasks + v_task_count;
    v_runs := v_runs || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'workspaceId', v_candidate.workspace_id,
        'businessEntityId', v_candidate.business_entity_id,
        'connectionId', v_candidate.id,
        'connectionGeneration', v_candidate.connection_generation,
        'syncRunId', v_run_id,
        'taskCount', v_task_count
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'scheduledConnectionCount', v_scheduled_connections,
    'scheduledTaskCount', v_scheduled_tasks,
    'runs', v_runs
  );
end;
$function$;

create or replace function public.discover_qbo_runtime_dispatch_v2(
  p_queue_class text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_result jsonb;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_queue_class not in ('provider_interactive', 'provider_bulk')
    or p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_dispatch_query_invalid';
  end if;

  with last_served as (
    select
      served.workspace_id,
      served.connection_id,
      pg_catalog.max(served.updated_at) as last_served_at
    from private.integration_sync_tasks as served
    where served.provider_key = 'quickbooks_online'
      and served.provider_environment = 'production'
      and served.queue_class = p_queue_class
      and served.dispatch_generation > 0
      and served.delivery_attribution_state <> 'legacy_unattributed'
    group by served.workspace_id, served.connection_id
  ), eligible as (
    select
      task.*,
      last_served.last_served_at,
      pg_catalog.row_number() over (
        partition by task.workspace_id, task.connection_id
        order by task.priority desc, task.available_at, task.created_at, task.id
      ) as connection_ordinal
    from private.integration_sync_tasks as task
    join private.integration_connections as connection
      on connection.workspace_id = task.workspace_id
      and connection.business_entity_id = task.business_entity_id
      and connection.id = task.connection_id
      and connection.connection_generation = task.connection_generation
      and connection.provider_key = task.provider_key
      and connection.provider_environment = task.provider_environment
    join private.integration_sync_runs as run
      on run.workspace_id = task.workspace_id
      and run.business_entity_id = task.business_entity_id
      and run.connection_id = task.connection_id
      and run.id = task.sync_run_id
      and run.connection_generation = task.connection_generation
    join private.integration_qbo_runtime_configurations as configuration
      on configuration.provider_environment = task.provider_environment
      and configuration.deployment_tier = 'production'
      and configuration.enabled
    left join last_served
      on last_served.workspace_id = task.workspace_id
      and last_served.connection_id = task.connection_id
    where task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'production'
      and task.queue_class = p_queue_class
      and task.state = 'pending'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.available_at <= v_now
      and connection.status in ('initializing', 'active', 'degraded')
      and connection.disconnected_at is null
      and connection.deleted_at is null
      and run.state in ('created', 'running')
      and private.qbo_provider_endpoint_binding_v1(task.stream_key) is not null
  ), fair as (
    select eligible.*
    from eligible
    order by
      eligible.connection_ordinal,
      eligible.last_served_at nulls first,
      eligible.workspace_id,
      eligible.connection_id,
      eligible.priority desc,
      eligible.available_at,
      eligible.id
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', fair.id,
        'workspaceId', fair.workspace_id,
        'businessEntityId', fair.business_entity_id,
        'connectionId', fair.connection_id,
        'connectionGeneration', fair.connection_generation,
        'syncRunId', fair.sync_run_id,
        'providerEnvironment', fair.provider_environment,
        'queueClass', fair.queue_class,
        'streamKey', fair.stream_key,
        'availableAt', fair.available_at,
        'rowVersion', fair.row_version,
        'dispatchGeneration', fair.dispatch_generation
      ) order by
        fair.connection_ordinal,
        fair.last_served_at nulls first,
        fair.workspace_id,
        fair.connection_id,
        fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;
  return v_result;
end;
$function$;

create or replace function public.discover_qbo_runtime_dispatch_reconciliation_v2(
  p_queue_class text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_queue_class not in ('provider_interactive', 'provider_bulk')
    or p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_dispatch_reconciliation_query_invalid';
  end if;

  with eligible as (
    select
      task.*,
      configuration.queue_name,
      configuration.queue_audience,
      pg_catalog.row_number() over (
        partition by task.workspace_id, task.connection_id
        order by task.updated_at, task.created_at, task.id
      ) as connection_ordinal
    from private.integration_sync_tasks as task
    join private.integration_connections as connection
      on connection.workspace_id = task.workspace_id
      and connection.business_entity_id = task.business_entity_id
      and connection.id = task.connection_id
      and connection.connection_generation = task.connection_generation
      and connection.provider_key = task.provider_key
      and connection.provider_environment = task.provider_environment
    join private.integration_sync_runs as run
      on run.workspace_id = task.workspace_id
      and run.business_entity_id = task.business_entity_id
      and run.connection_id = task.connection_id
      and run.id = task.sync_run_id
      and run.connection_generation = task.connection_generation
    join private.integration_qbo_runtime_configurations as configuration
      on configuration.provider_environment = task.provider_environment
      and configuration.deployment_tier = 'production'
      and configuration.enabled
    where task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'production'
      and task.queue_class = p_queue_class
      and task.state = 'dispatched'
      and task.delivery_attribution_state <> 'legacy_unattributed'
      and task.dispatch_generation > 0
      and task.last_delivery_dispatch_generation is distinct from
        task.dispatch_generation
      and (
        task.qbo_cloud_task_staged_dispatch_generation is distinct from
          task.dispatch_generation
        or task.qbo_cloud_task_staged_name is distinct from
          task.dispatcher_task_name
      )
      and task.lease_id is null
      and task.durable_effect_fingerprint is null
      and task.dispatcher_task_name ~ (
        '^projects/[a-z][a-z0-9-]{0,62}/locations/' ||
        '[a-z][a-z0-9-]{0,62}/queues/' ||
        configuration.queue_name || '/tasks/[a-f0-9]{64}$'
      )
      and connection.status in ('initializing', 'active', 'degraded')
      and connection.disconnected_at is null
      and connection.deleted_at is null
      and run.state in ('created', 'running')
      and private.qbo_provider_endpoint_binding_v1(task.stream_key) is not null
  ), fair as (
    select eligible.*
    from eligible
    order by
      eligible.connection_ordinal,
      eligible.updated_at,
      eligible.workspace_id,
      eligible.connection_id,
      eligible.id
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'taskId', fair.id,
        'workspaceId', fair.workspace_id,
        'businessEntityId', fair.business_entity_id,
        'connectionId', fair.connection_id,
        'connectionGeneration', fair.connection_generation,
        'syncRunId', fair.sync_run_id,
        'providerEnvironment', fair.provider_environment,
        'queueClass', fair.queue_class,
        'streamKey', fair.stream_key,
        'dispatcherTaskName', fair.dispatcher_task_name,
        'dispatchGeneration', fair.dispatch_generation,
        'rowVersion', fair.row_version,
        'queueName', fair.queue_name,
        'queueAudience', fair.queue_audience
      ) order by
        fair.connection_ordinal,
        fair.updated_at,
        fair.workspace_id,
        fair.connection_id,
        fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;
  return v_result;
end;
$function$;

create or replace function public.confirm_qbo_runtime_cloud_task_staged_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_task private.integration_sync_tasks;
  v_configuration private.integration_qbo_runtime_configurations;
  v_request_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_task_dispatch_authority'
  );
  if p_request_id is null
    or pg_catalog.char_length(p_request_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'taskId', 'expectedRowVersion',
        'dispatcherTaskName', 'dispatchGeneration', 'stagingOutcome'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_runtime_cloud_task_staging_v2'
    or p_command ->> 'taskId' is null
    or p_command ->> 'expectedRowVersion' is null
    or p_command ->> 'dispatcherTaskName' is null
    or p_command ->> 'dispatchGeneration' is null
    or p_command ->> 'stagingOutcome' is null
    or (p_command ->> 'expectedRowVersion')::bigint < 1
    or (p_command ->> 'dispatchGeneration')::bigint < 1
    or p_command ->> 'dispatcherTaskName' !~
      '^projects/[a-z][a-z0-9-]{0,62}/locations/[a-z][a-z0-9-]{0,62}/queues/[a-z][a-z0-9-]{0,62}/tasks/[a-f0-9]{64}$'
    or p_command ->> 'stagingOutcome' not in ('created', 'already_existing')
    then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_cloud_task_staging_payload_invalid';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.id = (p_command ->> 'taskId')::uuid
  for update;
  if not found
    or v_task.provider_key <> 'quickbooks_online'
    or v_task.provider_environment <> 'production' then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_cloud_task_staging_denied';
  end if;

  select configuration.* into strict v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = v_task.provider_environment
    and configuration.deployment_tier = 'production'
    and configuration.enabled;

  if v_task.dispatcher_task_name <> p_command ->> 'dispatcherTaskName'
    or v_task.dispatch_generation <>
      (p_command ->> 'dispatchGeneration')::bigint
    or v_task.dispatcher_task_name !~ (
      '^projects/[a-z][a-z0-9-]{0,62}/locations/' ||
      '[a-z][a-z0-9-]{0,62}/queues/' ||
      v_configuration.queue_name || '/tasks/[a-f0-9]{64}$'
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_cloud_task_staging_denied';
  end if;

  if v_task.qbo_cloud_task_staged_dispatch_generation =
      v_task.dispatch_generation
    and v_task.qbo_cloud_task_staged_name = v_task.dispatcher_task_name then
    return pg_catalog.jsonb_build_object(
      'taskId', v_task.id,
      'dispatchGeneration', v_task.dispatch_generation,
      'dispatcherTaskName', v_task.dispatcher_task_name,
      'stagingOutcome', v_task.qbo_cloud_task_staging_outcome,
      'rowVersion', v_task.row_version,
      'idempotent', true
    );
  end if;

  if v_task.delivery_attribution_state = 'attributed'
    and v_task.last_delivery_dispatch_generation =
      v_task.dispatch_generation then
    return pg_catalog.jsonb_build_object(
      'taskId', v_task.id,
      'dispatchGeneration', v_task.dispatch_generation,
      'dispatcherTaskName', v_task.dispatcher_task_name,
      'stagingOutcome', 'delivery_observed',
      'rowVersion', v_task.row_version,
      'idempotent', true
    );
  end if;

  if v_task.state <> 'dispatched'
    or v_task.row_version <>
      (p_command ->> 'expectedRowVersion')::bigint
    or v_task.lease_id is not null
    or v_task.durable_effect_fingerprint is not null then
    raise exception using
      errcode = '40001',
      message = 'qbo_runtime_cloud_task_staging_stale';
  end if;

  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  update private.integration_sync_tasks as task
  set
    qbo_cloud_task_staged_dispatch_generation = task.dispatch_generation,
    qbo_cloud_task_staged_name = task.dispatcher_task_name,
    qbo_cloud_task_staged_at = v_now,
    qbo_cloud_task_staging_outcome = p_command ->> 'stagingOutcome',
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
  returning task.* into v_task;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    'qbo_task_dispatcher',
    'integration_sync_task.cloud_task_staged',
    'succeeded',
    'integration_sync_task',
    v_task.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'idempotent', false
    )
  );
  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'dispatchGeneration', v_task.dispatch_generation,
    'dispatcherTaskName', v_task.dispatcher_task_name,
    'stagingOutcome', v_task.qbo_cloud_task_staging_outcome,
    'rowVersion', v_task.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range
    or no_data_found or too_many_rows then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_cloud_task_staging_payload_invalid';
end;
$function$;

create or replace function public.read_qbo_runtime_task_delivery_v2(
  p_task_id uuid,
  p_dispatcher_task_name text,
  p_queue_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
  v_credential private.integration_credentials;
  v_mapping private.provider_entity_mappings;
  v_connection private.integration_connections;
  v_configuration private.integration_qbo_runtime_configurations;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if p_dispatcher_task_name is null
    or p_dispatcher_task_name !~
      '^projects/[a-z][a-z0-9-]{0,62}/locations/[a-z][a-z0-9-]{0,62}/queues/[a-z][a-z0-9-]{0,62}/tasks/[a-f0-9]{64}$'
    or p_queue_name is null
    or p_queue_name !~ '^[a-z][a-z0-9-]{0,62}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_delivery_payload_invalid';
  end if;
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.id = p_task_id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'production'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
    and task.dispatch_generation > 0
    and task.delivery_attribution_state <> 'legacy_unattributed'
    and task.dispatcher_task_name = p_dispatcher_task_name;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_delivery_denied';
  end if;
  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_task.workspace_id
    and connection.business_entity_id = v_task.business_entity_id
    and connection.id = v_task.connection_id
    and connection.connection_generation = v_task.connection_generation
    and connection.provider_key = v_task.provider_key
    and connection.provider_environment = v_task.provider_environment
    and connection.status in ('initializing', 'active', 'degraded');
  select configuration.* into v_configuration
  from private.integration_qbo_runtime_configurations as configuration
  where configuration.provider_environment = v_task.provider_environment
    and configuration.deployment_tier = 'production'
    and configuration.enabled
    and configuration.queue_name = p_queue_name;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_delivery_queue_denied';
  end if;
  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_task.workspace_id
    and mapping.business_entity_id = v_task.business_entity_id
    and mapping.connection_id = v_task.connection_id
    and mapping.id = (v_task.control_metadata ->> 'mappingId')::uuid
    and mapping.provider_key = v_task.provider_key
    and mapping.provider_environment = v_task.provider_environment
    and mapping.status = 'active';
  select credential.* into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_task.workspace_id
    and credential.business_entity_id = v_task.business_entity_id
    and credential.connection_id = v_task.connection_id
    and credential.connection_generation = v_task.connection_generation
    and credential.provider_key = v_task.provider_key
    and credential.provider_environment = v_task.provider_environment
    and credential.status = 'active';
  if v_connection.id is null
    or v_mapping.id is null
    or v_credential.id is null
    or v_mapping.provider_entity_reference_fingerprint <>
      v_connection.provider_tenant_reference_fingerprint
    or v_credential.external_entity_reference_fingerprint <>
      v_mapping.provider_entity_reference_fingerprint
    or v_credential.granted_scopes <>
      array['com.intuit.quickbooks.accounting']::text[]
    or (
    select pg_catalog.count(*)
    from private.integration_credentials as active
    where active.workspace_id = v_task.workspace_id
      and active.business_entity_id = v_task.business_entity_id
      and active.connection_id = v_task.connection_id
      and active.connection_generation = v_task.connection_generation
      and active.provider_key = v_task.provider_key
      and active.provider_environment = v_task.provider_environment
      and active.status = 'active'
  ) <> 1 then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_delivery_credential_denied';
  end if;
  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'workspaceId', v_task.workspace_id,
    'businessEntityId', v_task.business_entity_id,
    'connectionId', v_task.connection_id,
    'connectionGeneration', v_task.connection_generation,
    'syncRunId', v_task.sync_run_id,
    'mappingId', v_mapping.id,
    'providerEnvironment', v_task.provider_environment,
    'queueClass', v_task.queue_class,
    'streamKey', v_task.stream_key,
    'taskKind', v_task.task_kind,
    'controlMetadata', v_task.control_metadata,
    'connectionConfigurationVersion', v_connection.configuration_version,
    'mappingVersion', v_mapping.mapping_version,
    'providerTenantReferenceFingerprint',
      private.phase_4_fingerprint_text_v1(
        v_mapping.provider_entity_reference_fingerprint
      ),
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'dispatchGeneration', v_task.dispatch_generation,
    'state', v_task.state,
    'rowVersion', v_task.row_version,
    'queueAudience', v_configuration.queue_audience
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_delivery_payload_invalid';
end;
$function$;

create or replace function public.record_qbo_provider_result_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_read private.integration_provider_credential_task_read_evidence;
  v_task private.integration_sync_tasks;
  v_expected_endpoint jsonb;
  v_existing private.integration_qbo_provider_task_result_evidence;
  v_request_fingerprint bytea;
  v_provider_request_fingerprint bytea;
  v_evidence_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'credentialReadEvidenceId', 'requestOrdinal',
        'endpointDomain', 'endpointClass', 'providerRequestFingerprint',
        'providerOutcome'
      ]
    )
    or p_command ->> 'contractVersion' <> 'qbo_provider_result_evidence_v2'
    or (p_command ->> 'requestOrdinal') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'requestOrdinal')::integer not between 1 and 128
    or p_command ->> 'endpointDomain' not in (
      'company_info', 'entity_query', 'report', 'cdc'
    )
    or p_command ->> 'providerOutcome' not in (
      'provider_success', 'provider_fault', 'provider_transport_failure',
      'provider_schema_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_provider_result_evidence_invalid';
  end if;
  perform (p_command ->> 'credentialReadEvidenceId')::uuid;
  v_provider_request_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'providerRequestFingerprint'
  );
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select evidence.* into v_read
  from private.integration_provider_credential_task_read_evidence as evidence
  where evidence.id = (p_command ->> 'credentialReadEvidenceId')::uuid
    and evidence.provider_key = 'quickbooks_online'
    and evidence.provider_environment = 'production'
    and evidence.authority_role = 'integration_credential_broker_authority'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_evidence_denied';
  end if;
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_read.workspace_id
    and task.business_entity_id = v_read.business_entity_id
    and task.connection_id = v_read.connection_id
    and task.connection_generation = v_read.connection_generation
    and task.sync_run_id = v_read.sync_run_id
    and task.id = v_read.task_id
    and task.provider_key = v_read.provider_key
    and task.provider_environment = v_read.provider_environment
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.row_version <> v_read.task_row_version
    or v_task.dispatch_generation <> v_read.task_dispatch_generation
    or v_task.dispatcher_task_name <> v_read.dispatcher_task_name
    or v_task.delivery_attribution_state <> 'attributed'
    or v_task.last_delivery_dispatch_generation <>
      v_read.delivery_dispatch_generation
    or v_task.last_delivery_retry_count <> v_read.delivery_retry_count
    or v_task.last_delivery_execution_count <> v_read.delivery_execution_count
    or v_task.last_delivery_attempt_fingerprint <>
      v_read.delivery_attempt_fingerprint
    or v_task.lease_id <> v_read.lease_id
    or v_task.lease_owner_fingerprint <> v_read.lease_owner_fingerprint
    or v_task.lease_expires_at <> v_read.lease_expires_at
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_evidence_denied';
  end if;
  v_expected_endpoint := private.qbo_provider_endpoint_binding_v1(
    v_task.stream_key
  );
  if v_expected_endpoint is null
    or p_command ->> 'endpointDomain' <>
      v_expected_endpoint ->> 'endpointDomain'
    or p_command ->> 'endpointClass' <>
      v_expected_endpoint ->> 'endpointClass' then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_result_endpoint_denied';
  end if;
  select evidence.* into v_existing
  from private.integration_qbo_provider_task_result_evidence as evidence
  where (
      evidence.credential_read_evidence_id = v_read.id
      and evidence.request_ordinal =
        (p_command ->> 'requestOrdinal')::integer
    ) or evidence.request_id = p_request_id
  order by evidence.id
  limit 1;
  if found then
    if v_existing.contract_version = 'qbo_provider_result_evidence_v2'
      and v_existing.credential_read_evidence_id = v_read.id
      and v_existing.request_ordinal =
        (p_command ->> 'requestOrdinal')::integer
      and v_existing.endpoint_domain = p_command ->> 'endpointDomain'
      and v_existing.endpoint_class = p_command ->> 'endpointClass'
      and v_existing.provider_request_fingerprint =
        v_provider_request_fingerprint
      and v_existing.provider_outcome = p_command ->> 'providerOutcome'
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'providerResultEvidenceId', v_existing.id,
        'credentialReadEvidenceId', v_existing.credential_read_evidence_id,
        'requestOrdinal', v_existing.request_ordinal,
        'endpointDomain', v_existing.endpoint_domain,
        'endpointClass', v_existing.endpoint_class,
        'providerOutcome', v_existing.provider_outcome,
        'observedAt', v_existing.observed_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_provider_result_evidence_conflict';
  end if;
  v_evidence_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_provider_result_evidence_v2',
      'credentialReadEvidenceId', v_read.id,
      'requestOrdinal', (p_command ->> 'requestOrdinal')::integer,
      'endpointDomain', p_command ->> 'endpointDomain',
      'endpointClass', p_command ->> 'endpointClass',
      'providerRequestFingerprint',
        pg_catalog.encode(v_provider_request_fingerprint, 'hex'),
      'providerOutcome', p_command ->> 'providerOutcome',
      'observedAt', v_now
    )
  );
  insert into private.integration_qbo_provider_task_result_evidence (
    contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, task_id, task_row_version,
    task_dispatch_generation, dispatcher_task_name,
    delivery_attribution_state, delivery_dispatch_generation,
    delivery_retry_count, delivery_execution_count,
    delivery_attempt_fingerprint, lease_id, lease_owner_fingerprint,
    lease_expires_at, credential_read_evidence_id, credential_id,
    credential_version, provider_key, provider_environment,
    endpoint_domain, endpoint_class, request_ordinal,
    provider_request_fingerprint, provider_outcome, request_id,
    request_fingerprint, evidence_fingerprint, authority_role,
    observed_at, created_at
  ) values (
    'qbo_provider_result_evidence_v2',
    v_read.workspace_id, v_read.business_entity_id, v_read.connection_id,
    v_read.connection_generation, v_read.sync_run_id, v_read.task_id,
    v_read.task_row_version, v_read.task_dispatch_generation,
    v_read.dispatcher_task_name, v_read.delivery_attribution_state,
    v_read.delivery_dispatch_generation, v_read.delivery_retry_count,
    v_read.delivery_execution_count, v_read.delivery_attempt_fingerprint,
    v_read.lease_id, v_read.lease_owner_fingerprint, v_read.lease_expires_at,
    v_read.id, v_read.credential_id, v_read.credential_version,
    v_read.provider_key, v_read.provider_environment,
    p_command ->> 'endpointDomain', p_command ->> 'endpointClass',
    (p_command ->> 'requestOrdinal')::integer,
    v_provider_request_fingerprint, p_command ->> 'providerOutcome',
    p_request_id, v_request_fingerprint, v_evidence_fingerprint,
    'integration_provider_runtime_authority', v_now, v_now
  ) returning * into v_existing;
  return pg_catalog.jsonb_build_object(
    'providerResultEvidenceId', v_existing.id,
    'credentialReadEvidenceId', v_existing.credential_read_evidence_id,
    'requestOrdinal', v_existing.request_ordinal,
    'endpointDomain', v_existing.endpoint_domain,
    'endpointClass', v_existing.endpoint_class,
    'providerOutcome', v_existing.provider_outcome,
    'observedAt', v_existing.observed_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_provider_result_evidence_invalid';
end;
$function$;

create or replace function public.record_qbo_report_parser_result_v2(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_provider private.integration_qbo_provider_task_result_evidence;
  v_task private.integration_sync_tasks;
  v_existing private.integration_qbo_report_parser_result_evidence;
  v_request_fingerprint bytea;
  v_evidence_fingerprint bytea;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['contractVersion', 'providerResultEvidenceId', 'parserOutcome']
    )
    or p_command ->> 'contractVersion' <>
      'qbo_report_parser_result_evidence_v2'
    or p_command ->> 'parserOutcome' not in (
      'parser_success', 'report_header_shape', 'report_columns_shape',
      'report_rows_shape', 'report_cell_shape', 'report_summary_shape',
      'report_metadata_shape', 'minimization_failure'
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_report_parser_result_evidence_invalid';
  end if;
  perform (p_command ->> 'providerResultEvidenceId')::uuid;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select evidence.* into v_provider
  from private.integration_qbo_provider_task_result_evidence as evidence
  where evidence.id = (p_command ->> 'providerResultEvidenceId')::uuid
    and evidence.contract_version = 'qbo_provider_result_evidence_v2'
    and evidence.provider_environment = 'production'
    and evidence.endpoint_domain = 'report'
    and evidence.endpoint_class like 'qbo_report_%'
    and evidence.provider_outcome = 'provider_success'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_report_parser_result_evidence_denied';
  end if;
  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_provider.workspace_id
    and task.business_entity_id = v_provider.business_entity_id
    and task.connection_id = v_provider.connection_id
    and task.connection_generation = v_provider.connection_generation
    and task.sync_run_id = v_provider.sync_run_id
    and task.id = v_provider.task_id
    and task.provider_key = v_provider.provider_key
    and task.provider_environment = v_provider.provider_environment
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.row_version <> v_provider.task_row_version
    or v_task.dispatch_generation <> v_provider.task_dispatch_generation
    or v_task.dispatcher_task_name <> v_provider.dispatcher_task_name
    or v_task.last_delivery_dispatch_generation <>
      v_provider.delivery_dispatch_generation
    or v_task.last_delivery_retry_count <> v_provider.delivery_retry_count
    or v_task.last_delivery_execution_count <>
      v_provider.delivery_execution_count
    or v_task.last_delivery_attempt_fingerprint <>
      v_provider.delivery_attempt_fingerprint
    or v_task.lease_id <> v_provider.lease_id
    or v_task.lease_owner_fingerprint <> v_provider.lease_owner_fingerprint
    or v_task.lease_expires_at <= v_now then
    raise exception using
      errcode = '42501',
      message = 'qbo_report_parser_result_evidence_denied';
  end if;
  select evidence.* into v_existing
  from private.integration_qbo_report_parser_result_evidence as evidence
  where evidence.provider_result_evidence_id = v_provider.id
    or evidence.request_id = p_request_id
  order by evidence.id
  limit 1;
  if found then
    if v_existing.contract_version = 'qbo_report_parser_result_evidence_v2'
      and v_existing.provider_result_evidence_id = v_provider.id
      and v_existing.parser_outcome = p_command ->> 'parserOutcome'
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'parserResultEvidenceId', v_existing.id,
        'providerResultEvidenceId', v_existing.provider_result_evidence_id,
        'parserOutcome', v_existing.parser_outcome,
        'observedAt', v_existing.observed_at,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'qbo_report_parser_result_evidence_conflict';
  end if;
  v_evidence_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_report_parser_result_evidence_v2',
      'providerResultEvidenceId', v_provider.id,
      'parserOutcome', p_command ->> 'parserOutcome',
      'observedAt', v_now
    )
  );
  insert into private.integration_qbo_report_parser_result_evidence (
    contract_version, provider_result_evidence_id,
    credential_read_evidence_id, workspace_id, business_entity_id,
    connection_id, connection_generation, sync_run_id, task_id,
    task_row_version, task_dispatch_generation, dispatcher_task_name,
    delivery_dispatch_generation, delivery_retry_count,
    delivery_execution_count, delivery_attempt_fingerprint, lease_id,
    lease_owner_fingerprint, credential_id, credential_version,
    provider_key, provider_environment, endpoint_class,
    provider_request_fingerprint, parser_outcome, request_id,
    request_fingerprint, evidence_fingerprint, authority_role,
    observed_at, created_at
  ) values (
    'qbo_report_parser_result_evidence_v2', v_provider.id,
    v_provider.credential_read_evidence_id, v_provider.workspace_id,
    v_provider.business_entity_id, v_provider.connection_id,
    v_provider.connection_generation, v_provider.sync_run_id,
    v_provider.task_id, v_provider.task_row_version,
    v_provider.task_dispatch_generation, v_provider.dispatcher_task_name,
    v_provider.delivery_dispatch_generation, v_provider.delivery_retry_count,
    v_provider.delivery_execution_count,
    v_provider.delivery_attempt_fingerprint, v_provider.lease_id,
    v_provider.lease_owner_fingerprint, v_provider.credential_id,
    v_provider.credential_version, v_provider.provider_key,
    v_provider.provider_environment, v_provider.endpoint_class,
    v_provider.provider_request_fingerprint, p_command ->> 'parserOutcome',
    p_request_id, v_request_fingerprint, v_evidence_fingerprint,
    'integration_provider_runtime_authority', v_now, v_now
  ) returning * into v_existing;
  return pg_catalog.jsonb_build_object(
    'parserResultEvidenceId', v_existing.id,
    'providerResultEvidenceId', v_existing.provider_result_evidence_id,
    'parserOutcome', v_existing.parser_outcome,
    'observedAt', v_existing.observed_at,
    'idempotent', false
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_report_parser_result_evidence_invalid';
end;
$function$;

create or replace function public.complete_qbo_runtime_task_v2(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_completion jsonb;
  v_parent private.integration_sync_tasks;
  v_child private.integration_sync_tasks;
  v_continuation jsonb;
  v_child_id uuid;
  v_child_control jsonb;
  v_child_idempotency bytea;
  v_child_coalescing bytea;
  v_child_request_fingerprint bytea;
  v_next_page_ordinal bigint;
  v_next_cursor_version bigint;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['contractVersion', 'completion', 'continuation']
    )
    or p_command ->> 'contractVersion' <> 'qbo_runtime_task_completion_v2'
    or pg_catalog.jsonb_typeof(p_command -> 'completion') <> 'object'
    or (
      p_command -> 'continuation' <> 'null'::jsonb
      and (
        not private.jsonb_has_exact_keys_v1(
          p_command -> 'continuation',
          array['kind', 'childTaskId']
        )
        or p_command #>> '{continuation,kind}' <> 'next_page'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_task_completion_payload_invalid';
  end if;
  select task.* into v_parent
  from private.integration_sync_tasks as task
  where task.workspace_id =
      (p_command #>> '{completion,workspaceId}')::uuid
    and task.business_entity_id =
      (p_command #>> '{completion,businessEntityId}')::uuid
    and task.connection_id =
      (p_command #>> '{completion,connectionId}')::uuid
    and task.connection_generation =
      (p_command #>> '{completion,connectionGeneration}')::bigint
    and task.id = (p_command #>> '{completion,taskId}')::uuid
  for update;
  if not found
    or v_parent.provider_key <> 'quickbooks_online'
    or v_parent.provider_environment <> 'production'
    or v_parent.queue_class not in ('provider_interactive', 'provider_bulk')
    or not exists (
      select 1
      from private.integration_qbo_runtime_configurations as configuration
      where configuration.provider_environment = v_parent.provider_environment
        and configuration.deployment_tier = 'production'
        and configuration.enabled
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_runtime_task_completion_denied';
  end if;
  v_continuation := p_command -> 'continuation';
  if v_continuation <> 'null'::jsonb then
    v_child_id := (v_continuation ->> 'childTaskId')::uuid;
    v_next_page_ordinal :=
      (v_parent.control_metadata ->> 'pageOrdinal')::bigint + 1;
    v_next_cursor_version :=
      (v_parent.control_metadata ->> 'cursorVersion')::bigint + 1;
    if v_parent.stream_key = 'qbo_cdc'
      or v_next_page_ordinal > 1000000
      or v_next_cursor_version > 1000000000
      or v_parent.control_metadata -> 'checkpointId' = 'null'::jsonb
      or p_command #> '{completion,checkpoint}' = 'null'::jsonb
      or p_command #>> '{completion,checkpoint,checkpointId}' <>
        v_parent.control_metadata ->> 'checkpointId'
      or (p_command #>>
          '{completion,checkpoint,expectedCheckpointVersion}')::bigint <>
        (v_parent.control_metadata ->> 'cursorVersion')::bigint
      or (p_command #>> '{completion,checkpoint,cursorVersion}')::bigint <>
        v_next_cursor_version then
      raise exception using
        errcode = '22023',
        message = 'qbo_runtime_task_continuation_invalid';
    end if;
  end if;
  v_completion := public.complete_integration_sync_task_v1(
    p_command -> 'completion',
    p_request_id,
    p_actor_id
  );
  if v_continuation = 'null'::jsonb then
    return v_completion || pg_catalog.jsonb_build_object(
      'continuationTaskId', null,
      'continuationCreated', false
    );
  end if;
  v_child_control := pg_catalog.jsonb_build_object(
    'checkpointId', v_parent.control_metadata -> 'checkpointId',
    'mappingId', v_parent.control_metadata -> 'mappingId',
    'eventId', null,
    'pageOrdinal', v_next_page_ordinal,
    'cursorVersion', v_next_cursor_version,
    'windowStartAt', v_parent.control_metadata -> 'windowStartAt',
    'windowEndAt', v_parent.control_metadata -> 'windowEndAt',
    'reasonCode', 'qbo_page_continuation',
    'recordHintCount', 0,
    'coalescedEventCount', 1
  );
  if not private.is_phase_6_control_metadata_v1(v_child_control) then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_task_continuation_invalid';
  end if;
  v_child_idempotency := extensions.digest(
    pg_catalog.convert_to(
      'qbo_production_page_continuation_v2:' || v_parent.id::text || ':' ||
        v_next_page_ordinal::text,
      'UTF8'
    ),
    'sha256'
  );
  v_child_coalescing := extensions.digest(
    pg_catalog.convert_to(
      'qbo_production_page_scope_v2:' || v_parent.sync_run_id::text || ':' ||
        v_parent.stream_key || ':' || v_next_page_ordinal::text,
      'UTF8'
    ),
    'sha256'
  );
  v_child_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    pg_catalog.jsonb_build_object(
      'parentTaskId', v_parent.id,
      'childTaskId', v_child_id,
      'controlMetadata', v_child_control
    )
  );
  select task.* into v_child
  from private.integration_sync_tasks as task
  where task.workspace_id = v_parent.workspace_id
    and task.business_entity_id = v_parent.business_entity_id
    and task.connection_id = v_parent.connection_id
    and task.id = v_child_id
  for update;
  if found then
    if v_child.parent_task_id <> v_parent.id
      or v_child.sync_run_id <> v_parent.sync_run_id
      or v_child.connection_generation <> v_parent.connection_generation
      or v_child.provider_key <> v_parent.provider_key
      or v_child.provider_environment <> v_parent.provider_environment
      or v_child.queue_class <> v_parent.queue_class
      or v_child.task_kind <> v_parent.task_kind
      or v_child.stream_key <> v_parent.stream_key
      or v_child.control_metadata <> v_child_control
      or v_child.idempotency_fingerprint <> v_child_idempotency then
      raise exception using
        errcode = '23505',
        message = 'qbo_runtime_task_continuation_conflict';
    end if;
    return v_completion || pg_catalog.jsonb_build_object(
      'continuationTaskId', v_child.id,
      'continuationCreated', false,
      'continuationState', v_child.state,
      'continuationRowVersion', v_child.row_version
    );
  end if;
  if exists (
    select 1
    from private.integration_sync_tasks as task
    where task.workspace_id = v_parent.workspace_id
      and task.business_entity_id = v_parent.business_entity_id
      and task.connection_id = v_parent.connection_id
      and task.connection_generation = v_parent.connection_generation
      and task.idempotency_fingerprint = v_child_idempotency
  ) then
    raise exception using
      errcode = '23505',
      message = 'qbo_runtime_task_continuation_conflict';
  end if;
  insert into private.integration_sync_tasks (
    id, contract_version, workspace_id, business_entity_id, connection_id,
    connection_generation, sync_run_id, parent_task_id, provider_key,
    provider_environment, queue_class, task_kind, stream_key, state, priority,
    control_metadata, idempotency_fingerprint, coalescing_fingerprint,
    maximum_attempts, available_at, last_request_id,
    last_request_fingerprint, created_at, updated_at, retention_expires_at
  ) values (
    v_child_id, 'integration_sync_task_v1', v_parent.workspace_id,
    v_parent.business_entity_id, v_parent.connection_id,
    v_parent.connection_generation, v_parent.sync_run_id, v_parent.id,
    v_parent.provider_key, v_parent.provider_environment,
    v_parent.queue_class, v_parent.task_kind, v_parent.stream_key,
    'pending', v_parent.priority, v_child_control, v_child_idempotency,
    v_child_coalescing, v_parent.maximum_attempts, v_now, p_request_id,
    v_child_request_fingerprint, v_now, v_now,
    greatest(
      v_parent.retention_expires_at,
      v_now + interval '1 day'
    )
  ) returning * into v_child;
  perform private.phase_6_insert_audit_v1(
    v_child.workspace_id,
    v_child.business_entity_id,
    v_child.connection_id,
    p_actor_id,
    'integration_sync_task.create',
    'succeeded',
    'integration_sync_task',
    v_child.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_child.state,
      'task_kind', v_child.task_kind,
      'queue_class', v_child.queue_class,
      'attempt_count', v_child.attempt_count,
      'dispatch_generation', v_child.dispatch_generation,
      'row_version', v_child.row_version,
      'idempotent', false
    )
  );
  return v_completion || pg_catalog.jsonb_build_object(
    'continuationTaskId', v_child.id,
    'continuationCreated', true,
    'continuationState', v_child.state,
    'continuationRowVersion', v_child.row_version
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_runtime_task_completion_payload_invalid';
end;
$function$;

create or replace function private.validate_qbo_task_result_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_count bigint;
  v_provider_success_count bigint;
  v_parser_success_count bigint;
  v_parser_failure_count bigint;
begin
  if old.provider_key <> 'quickbooks_online'
    or old.provider_environment not in ('sandbox', 'production')
    or old.state <> 'leased' then
    return new;
  end if;
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where evidence.provider_outcome = 'provider_success'
    )
  into v_provider_count, v_provider_success_count
  from private.integration_qbo_provider_task_result_evidence as evidence
  where evidence.workspace_id = old.workspace_id
    and evidence.business_entity_id = old.business_entity_id
    and evidence.connection_id = old.connection_id
    and evidence.connection_generation = old.connection_generation
    and evidence.sync_run_id = old.sync_run_id
    and evidence.task_id = old.id
    and evidence.task_row_version = old.row_version
    and evidence.task_dispatch_generation = old.dispatch_generation
    and evidence.dispatcher_task_name = old.dispatcher_task_name
    and evidence.delivery_dispatch_generation =
      old.last_delivery_dispatch_generation
    and evidence.delivery_retry_count = old.last_delivery_retry_count
    and evidence.delivery_execution_count = old.last_delivery_execution_count
    and evidence.delivery_attempt_fingerprint =
      old.last_delivery_attempt_fingerprint
    and evidence.lease_id = old.lease_id
    and evidence.lease_owner_fingerprint = old.lease_owner_fingerprint
    and evidence.provider_environment = old.provider_environment;
  if new.state = 'succeeded' then
    if v_provider_count < 1
      or v_provider_success_count <> v_provider_count then
      raise exception using
        errcode = '55000',
        message = 'qbo_task_provider_result_evidence_required';
    end if;
    if private.qbo_provider_endpoint_binding_v1(old.stream_key)
        ->> 'endpointDomain' = 'report' then
      select
        pg_catalog.count(*) filter (
          where parser.parser_outcome = 'parser_success'
        ),
        pg_catalog.count(*) filter (
          where parser.parser_outcome <> 'parser_success'
        )
      into v_parser_success_count, v_parser_failure_count
      from private.integration_qbo_report_parser_result_evidence as parser
      join private.integration_qbo_provider_task_result_evidence as provider
        on provider.id = parser.provider_result_evidence_id
      where provider.task_id = old.id
        and provider.task_row_version = old.row_version
        and provider.lease_id = old.lease_id
        and provider.delivery_attempt_fingerprint =
          old.last_delivery_attempt_fingerprint
        and provider.provider_environment = old.provider_environment
        and parser.provider_environment = old.provider_environment;
      if v_provider_count <> 1
        or v_parser_success_count <> 1
        or v_parser_failure_count <> 0 then
        raise exception using
          errcode = '55000',
          message = 'qbo_task_report_parser_evidence_required';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function private.integration_stream_freshness_domain_v1(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.transition_integration_connection_v1(
  p_command jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection private.integration_connections;
  v_target_status text;
  v_reason text;
  v_granted_scopes text[];
  v_tenant_fingerprint bytea;
  v_request_fingerprint bytea;
  v_transitioned_at timestamptz;
  v_missing_activation_gate boolean;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'expectedRowVersion',
        'expectedGeneration',
        'targetStatus',
        'stateReasonCode',
        'providerTenantReferenceFingerprint',
        'grantedScopes',
        'transitionedAt'
      ]
    )
    or pg_catalog.jsonb_typeof(p_command -> 'grantedScopes') <> 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_command -> 'grantedScopes') as item(value)
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_transition_payload_invalid';
  end if;

  v_target_status := p_command ->> 'targetStatus';
  v_reason := p_command ->> 'stateReasonCode';
  v_transitioned_at := (p_command ->> 'transitionedAt')::timestamptz;
  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinality),
    '{}'::text[]
  )
  into v_granted_scopes
  from pg_catalog.jsonb_array_elements_text(p_command -> 'grantedScopes')
    with ordinality as item(value, ordinality);
  v_tenant_fingerprint := case
    when p_command -> 'providerTenantReferenceFingerprint' = 'null'::jsonb then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'providerTenantReferenceFingerprint'
    )
  end;
  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_connection_transition_denied';
  end if;
  if v_connection.status = v_target_status
    and v_connection.last_transition_request_id = p_request_id
    and v_connection.last_transition_request_fingerprint = v_request_fingerprint then
    return pg_catalog.jsonb_build_object(
      'connection', private.integration_connection_summary_json_v1(v_connection),
      'idempotent', true
    );
  end if;
  if v_connection.row_version <> (p_command ->> 'expectedRowVersion')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_row_version_stale';
  end if;
  if v_connection.connection_generation <> (p_command ->> 'expectedGeneration')::bigint then
    raise exception using
      errcode = '40001',
      message = 'integration_connection_generation_stale';
  end if;
  if v_connection.status = 'deleted' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_deleted_terminal';
  end if;
  if v_connection.status = 'disconnected'
    and v_target_status = 'pending_authorization' then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_replacement_generation_required';
  end if;
  if not private.is_integration_connection_transition_v1(
      v_connection.status,
      v_target_status
    )
    or not private.is_integration_connection_reason_v1(
      v_target_status,
      v_reason
    ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_transition_invalid';
  end if;

  if v_target_status = 'pending_authorization' then
    if v_tenant_fingerprint is not null
      or pg_catalog.cardinality(v_granted_scopes) <> 0 then
      raise exception using
        errcode = '22023',
        message = 'integration_connection_authorization_evidence_invalid';
    end if;
  elsif v_target_status = 'authorized_unmapped' then
    if v_tenant_fingerprint is null
      or pg_catalog.cardinality(v_granted_scopes) = 0
      or not private.is_bounded_identifier_array_v1(v_granted_scopes, 64)
      or not v_granted_scopes <@ v_connection.requested_scopes then
      raise exception using
        errcode = '22023',
        message = 'integration_connection_authorization_evidence_invalid';
    end if;
  elsif v_tenant_fingerprint is distinct from v_connection.provider_tenant_reference_fingerprint
    or v_granted_scopes <> v_connection.granted_scopes then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_authorization_evidence_invalid';
  end if;

  if v_target_status = 'initializing' then
    if v_connection.provider_tenant_reference_fingerprint is null
      or v_connection.authorized_at is null then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_authorization_gate_unsatisfied';
    end if;
    if not exists (
      select 1
      from private.provider_entity_mappings as mapping
      where mapping.workspace_id = v_connection.workspace_id
        and mapping.business_entity_id = v_connection.business_entity_id
        and mapping.connection_id = v_connection.id
        and mapping.status = 'active'
    ) then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_mapping_gate_unsatisfied';
    end if;
  end if;

  if v_target_status = 'active' then
    select not (
      exists (
        select 1
        from private.provider_entity_mappings as mapping
        where mapping.workspace_id = v_connection.workspace_id
          and mapping.business_entity_id = v_connection.business_entity_id
          and mapping.connection_id = v_connection.id
          and mapping.status = 'active'
      )
      and exists (
        select 1
        from private.integration_sync_runs as run
        join private.provider_entity_mappings as mapping
          on mapping.workspace_id = run.workspace_id
          and mapping.business_entity_id = run.business_entity_id
          and mapping.connection_id = run.connection_id
          and mapping.id = run.mapping_id
        where run.workspace_id = v_connection.workspace_id
          and run.business_entity_id = v_connection.business_entity_id
          and run.connection_id = v_connection.id
          and run.connection_generation = v_connection.connection_generation
          and private.is_phase_8a0_activation_trigger_v1(
            v_connection.provider_key,
            run.trigger_kind
          )
          and run.mode = 'initialization'
          and run.state = 'succeeded'
          and mapping.status = 'active'
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          v_connection.capability_snapshot -> 'requiredStreamKeys'
        ) as required(stream_key)
        where private.integration_stream_freshness_domain_v1(
            v_connection.provider_key,
            required.stream_key
          ) is null
          or not exists (
            select 1
            from private.integration_freshness_states as freshness
            join private.provider_entity_mappings as mapping
              on mapping.workspace_id = freshness.workspace_id
              and mapping.business_entity_id = freshness.business_entity_id
              and mapping.connection_id = freshness.connection_id
              and mapping.id = freshness.mapping_id
            where freshness.workspace_id = v_connection.workspace_id
              and freshness.business_entity_id = v_connection.business_entity_id
              and freshness.connection_id = v_connection.id
              and freshness.domain = private.integration_stream_freshness_domain_v1(
                v_connection.provider_key,
                required.stream_key
              )
              and (
                v_connection.provider_key <> 'quickbooks_online'
                or freshness.scope_key = required.stream_key
              )
              and freshness.status in ('current', 'aging')
              and freshness.blocking_level in ('none', 'warning')
              and mapping.status = 'active'
          )
      )
    )
    into v_missing_activation_gate;
    if v_missing_activation_gate then
      raise exception using
        errcode = '55000',
        message = 'integration_connection_activation_gate_unsatisfied';
    end if;
  end if;

  if v_target_status = 'deleted' and (
    exists (
      select 1
      from private.provider_entity_mappings as mapping
      where mapping.workspace_id = v_connection.workspace_id
        and mapping.business_entity_id = v_connection.business_entity_id
        and mapping.connection_id = v_connection.id
        and mapping.status in ('pending_verification', 'active')
    )
    or exists (
      select 1
      from private.integration_sync_runs as run
      where run.workspace_id = v_connection.workspace_id
        and run.business_entity_id = v_connection.business_entity_id
        and run.connection_id = v_connection.id
        and run.state in ('created', 'running')
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'integration_connection_deletion_gate_unsatisfied';
  end if;

  update private.integration_connections as connection
  set
    status = v_target_status,
    state_reason_code = v_reason,
    provider_tenant_reference_fingerprint = case
      when v_target_status = 'pending_authorization' then null
      else v_tenant_fingerprint
    end,
    granted_scopes = v_granted_scopes,
    authorized_at = case
      when v_target_status = 'pending_authorization' then null
      when v_target_status = 'authorized_unmapped' then v_transitioned_at
      else connection.authorized_at
    end,
    status_changed_at = v_transitioned_at,
    disconnected_at = case
      when v_target_status = 'disconnected' then v_transitioned_at
      else connection.disconnected_at
    end,
    deleted_at = case
      when v_target_status = 'deleted' then v_transitioned_at
      else null
    end,
    last_transition_request_id = p_request_id,
    last_transition_request_fingerprint = v_request_fingerprint,
    row_version = connection.row_version + 1,
    updated_at = v_transitioned_at
  where connection.id = v_connection.id
  returning connection.* into v_connection;

  if v_target_status in (
    'error',
    'reauthorization_required',
    'disconnecting',
    'disconnected',
    'deleting',
    'deleted'
  ) then
    update private.integration_freshness_states as freshness
    set
      status = case
        when v_target_status = 'error' then 'sync_error'
        when v_target_status = 'reauthorization_required' then 'reauthorization_required'
        else 'disconnected'
      end,
      blocking_level = case
        when v_target_status = 'error' then 'current_intelligence'
        else 'all_derived'
      end,
      reason_code = case
        when v_target_status = 'error' then 'latest_sync_failed'
        when v_target_status = 'reauthorization_required' then 'connection_reauthorization_required'
        else 'connection_disconnected'
      end,
      calculated_at = v_transitioned_at,
      state_fingerprint = private.phase_3_contract_fingerprint_v1(
        pg_catalog.jsonb_build_object(
          'freshnessId', freshness.id,
          'connectionStatus', v_target_status,
          'requestFingerprint', private.phase_4_fingerprint_text_v1(v_request_fingerprint)
        )
      ),
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = freshness.row_version + 1,
      updated_at = v_transitioned_at
    where freshness.workspace_id = v_connection.workspace_id
      and freshness.business_entity_id = v_connection.business_entity_id
      and freshness.connection_id = v_connection.id;
  end if;

  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    connection_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    request_id,
    metadata,
    retention_class
  ) values (
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    'service',
    p_actor_id,
    'integration_connection.transition',
    'succeeded',
    'integration_connection',
    v_connection.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_connection.connection_generation,
      'connection_status', v_connection.status,
      'row_version', v_connection.row_version,
      'idempotent', false
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'connection', private.integration_connection_summary_json_v1(v_connection),
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_connection_transition_payload_invalid';
end;
$function$;

revoke all on function public.register_qbo_runtime_configuration_v2(jsonb, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function
  public.register_qbo_runtime_configuration_v2(jsonb, text)
to integration_qbo_configuration_authority;

revoke all on function
  public.create_qbo_customer_oauth_state_v2(jsonb, text),
  public.create_qbo_customer_reauthorization_state_v2(jsonb, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function
  public.create_qbo_customer_oauth_state_v2(jsonb, text),
  public.create_qbo_customer_reauthorization_state_v2(jsonb, text)
to authenticated;

revoke all on function
  public.consume_qbo_customer_oauth_state_v2(jsonb, text),
  public.consume_qbo_customer_reauthorization_state_v2(jsonb, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function
  public.consume_qbo_customer_oauth_state_v2(jsonb, text),
  public.consume_qbo_customer_reauthorization_state_v2(jsonb, text)
to integration_oauth_ingress_authority;

revoke all on function
  public.store_qbo_customer_reauthorized_credential_v2(jsonb, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function
  public.store_qbo_customer_reauthorized_credential_v2(jsonb, text)
to integration_credential_broker_authority;

revoke all on function
  public.read_qbo_runtime_configuration_v2(text),
  public.schedule_qbo_initialization_v2(integer, text),
  public.discover_qbo_runtime_dispatch_v2(text, integer),
  public.discover_qbo_runtime_dispatch_reconciliation_v2(text, integer),
  public.confirm_qbo_runtime_cloud_task_staged_v2(jsonb, text),
  public.read_qbo_runtime_task_delivery_v2(uuid, text, text),
  public.record_qbo_provider_result_v2(jsonb, text),
  public.record_qbo_report_parser_result_v2(jsonb, text),
  public.complete_qbo_runtime_task_v2(jsonb, text, text)
from public, anon, authenticated, service_role,
  external_integrations_authority, deterministic_calculation_authority,
  integration_control_plane_authority,
  integration_qbo_configuration_authority,
  integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_webhook_ingress_authority,
  integration_task_dispatch_authority,
  integration_task_scheduler_authority,
  integration_provider_runtime_authority,
  integration_deterministic_runtime_authority,
  integration_provider_source_authority,
  integration_provider_validation_authority;
grant execute on function public.read_qbo_runtime_configuration_v2(text)
to integration_oauth_ingress_authority,
  integration_credential_broker_authority,
  integration_task_scheduler_authority,
  integration_task_dispatch_authority,
  integration_provider_runtime_authority;
grant execute on function public.schedule_qbo_initialization_v2(integer, text)
to integration_task_scheduler_authority;
grant execute on function public.discover_qbo_runtime_dispatch_v2(text, integer)
to integration_task_dispatch_authority;
grant execute on function
  public.discover_qbo_runtime_dispatch_reconciliation_v2(text, integer)
to integration_task_dispatch_authority;
grant execute on function
  public.confirm_qbo_runtime_cloud_task_staged_v2(jsonb, text)
to integration_task_dispatch_authority;
grant execute on function
  public.read_qbo_runtime_task_delivery_v2(uuid, text, text),
  public.record_qbo_provider_result_v2(jsonb, text),
  public.record_qbo_report_parser_result_v2(jsonb, text),
  public.complete_qbo_runtime_task_v2(jsonb, text, text)
to integration_provider_runtime_authority;

commit;
