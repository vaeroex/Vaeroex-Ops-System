-- External Integrations Phase 8B: QBO sandbox deterministic source validation
--
-- Provider runtime can read only its leased task's current minimized source
-- state. A separate validation authority may append an immutable validation
-- promotion version, but receives no canonical fact, reconciliation,
-- contribution, deterministic KPI, credential, or control-plane authority.

begin;

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_provider_validation_authority'
  ) then
    create role integration_provider_validation_authority nologin noinherit;
  end if;
end;
$roles$;

revoke integration_provider_validation_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on schema private from integration_provider_validation_authority;
revoke all on all tables in schema private
  from integration_provider_validation_authority;

create or replace function private.assert_integration_provider_validation_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_provider_validation_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_validation_authority_required';
  end if;
end;
$function$;

-- The Phase 5 consume RPC uses the database transaction timestamp as the
-- immutable consume time. Return that trusted value so credential issuance
-- cannot race or drift behind the stored state timestamp.
create or replace function public.consume_integration_oauth_state_v2(
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
  v_state_id uuid;
  v_consumed_at timestamptz;
begin
  v_result := public.consume_integration_oauth_state_v1(
    p_command,
    p_request_id
  );
  if not coalesce((v_result ->> 'accepted')::boolean, false) then
    return v_result;
  end if;

  v_state_id := (v_result ->> 'stateId')::uuid;
  select state.consumed_at
  into v_consumed_at
  from private.integration_oauth_states as state
  where state.id = v_state_id;
  if not found or v_consumed_at is null then
    raise exception using
      errcode = '55000',
      message = 'integration_oauth_state_consume_timestamp_missing';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'consumedAt', v_consumed_at
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_consume_payload_invalid';
end;
$function$;

create or replace function private.phase_8b_source_version_json_v1(
  p_version private.external_source_record_versions
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', p_version.contract_version,
    'id', p_version.id,
    'workspaceId', p_version.workspace_id,
    'businessEntityId', p_version.business_entity_id,
    'connectionId', p_version.connection_id,
    'immutableVersion', p_version.immutable_version,
    'priorVersionId', p_version.prior_version_id,
    'recordKind', p_version.record_kind,
    'source', pg_catalog.jsonb_build_object(
      'kind', p_version.source_kind,
      'providerKey', p_version.provider_key,
      'providerRecordType', p_version.provider_record_type,
      'providerRecordId', p_version.provider_record_id,
      'providerVersionReference', p_version.provider_version_reference
    ),
    'temporal', pg_catalog.jsonb_build_object(
      'basis', p_version.temporal_basis,
      'providerCreatedAt', case when p_version.provider_created_at is null then null else
        pg_catalog.to_char(p_version.provider_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'providerUpdatedAt', case when p_version.provider_updated_at is null then null else
        pg_catalog.to_char(p_version.provider_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'observedAt', pg_catalog.to_char(p_version.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'synchronizedAt', pg_catalog.to_char(p_version.synchronized_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ingestedAt', pg_catalog.to_char(p_version.ingested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'effectiveAt', case when p_version.effective_at is null then null else
        pg_catalog.to_char(p_version.effective_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'postingDate', p_version.posting_date::text,
      'periodStart', p_version.period_start::text,
      'periodEnd', p_version.period_end::text,
      'sourceTimeZone', p_version.source_timezone
    ),
    'accounting', pg_catalog.jsonb_build_object(
      'basis', p_version.accounting_basis,
      'currency', case when p_version.accounting_currency is null then null
        else pg_catalog.btrim(p_version.accounting_currency::text) end
    ),
    'normalizedSchemaVersion', p_version.normalized_schema_version,
    'changeKind', p_version.change_kind,
    'normalizedProjection', p_version.normalized_projection,
    'trust', p_version.trust,
    'validation', pg_catalog.jsonb_build_object(
      'state', p_version.validation_state,
      'validatorVersion', p_version.validator_version,
      'issues', p_version.validation_issues
    ),
    'receivedAt', pg_catalog.to_char(p_version.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceFingerprint', 'sha256:' || pg_catalog.encode(p_version.source_fingerprint, 'hex')
  );
$function$;

create or replace function private.is_qbo_phase_8b_validated_projection_v1(
  p_projection jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_contract text;
  v_provider jsonb;
begin
  if pg_catalog.jsonb_typeof(p_projection) <> 'object' then
    return false;
  end if;
  v_contract := p_projection ->> 'contractVersion';
  v_provider := p_projection -> 'provider';
  if not private.jsonb_has_exact_keys_v1(
      v_provider,
      array['providerKey', 'realmId', 'sourceEnvironment']
    )
    or v_provider ->> 'providerKey' <> 'quickbooks_online'
    or v_provider ->> 'sourceEnvironment' <> 'sandbox'
    or not private.is_bounded_identifier_v1(v_provider ->> 'realmId') then
    return false;
  end if;

  if v_contract = 'qbo_source_record_minimized_v1' then
    return coalesce(private.jsonb_has_exact_keys_v1(
        p_projection,
        array[
          'contractVersion', 'provider', 'recordType', 'id', 'displayName',
          'active', 'status', 'metadata', 'temporal', 'accounting',
          'relationships', 'amounts', 'lines', 'providerVersionReference',
          'minimizationVersion'
        ]
      )
      and p_projection ->> 'recordType' in (
        'CompanyInfo', 'Preferences', 'Account', 'Customer', 'Vendor', 'Item',
        'Invoice', 'SalesReceipt', 'Payment', 'CreditMemo', 'RefundReceipt',
        'Bill', 'BillPayment', 'Purchase', 'VendorCredit', 'Deposit',
        'JournalEntry', 'Transfer'
      )
      and private.is_bounded_identifier_v1(p_projection ->> 'id')
      and pg_catalog.jsonb_typeof(p_projection -> 'displayName') in ('string', 'null')
      and pg_catalog.jsonb_typeof(p_projection -> 'active') in ('boolean', 'null')
      and p_projection ->> 'status' in ('active', 'inactive', 'voided', 'deleted', 'unknown')
      and private.jsonb_has_exact_keys_v1(
        p_projection -> 'metadata',
        array['providerCreatedAt', 'providerUpdatedAt', 'syncToken']
      )
      and private.jsonb_has_exact_keys_v1(
        p_projection -> 'temporal',
        array['postingDate', 'providerCreatedAt', 'providerUpdatedAt']
      )
      and private.jsonb_has_exact_keys_v1(
        p_projection -> 'accounting',
        array['basis', 'sourceCurrency', 'homeCurrency', 'exchangeRate']
      )
      and p_projection #>> '{accounting,basis}' in ('accrual', 'cash', 'unknown')
      and pg_catalog.jsonb_typeof(p_projection -> 'relationships') = 'object'
      and pg_catalog.jsonb_typeof(p_projection -> 'amounts') = 'object'
      and pg_catalog.jsonb_typeof(p_projection -> 'lines') = 'array'
      and pg_catalog.jsonb_array_length(p_projection -> 'lines') <= 500
      and pg_catalog.jsonb_typeof(p_projection -> 'providerVersionReference') in ('string', 'null')
      and p_projection ->> 'minimizationVersion' = 'qbo_minimizer_v1',
      false
    );
  end if;

  if v_contract = 'qbo_report_control_observation_v1' then
    return coalesce(private.jsonb_has_exact_keys_v1(
        p_projection,
        array[
          'contractVersion', 'provider', 'reportType', 'reportBasis',
          'sourceCurrency', 'periodStart', 'periodEnd', 'columns', 'rows',
          'contributionFamily', 'additive', 'parserVersion'
        ]
      )
      and p_projection ->> 'reportType' in (
        'ProfitAndLoss', 'BalanceSheet', 'CashFlow', 'ARAgingSummary',
        'APAgingSummary', 'TrialBalance'
      )
      and p_projection ->> 'reportBasis' in ('accrual', 'cash', 'unknown')
      and (p_projection ->> 'sourceCurrency') ~ '^[A-Z]{3}$'
      and pg_catalog.jsonb_typeof(p_projection -> 'columns') = 'array'
      and pg_catalog.jsonb_array_length(p_projection -> 'columns') between 1 and 256
      and pg_catalog.jsonb_typeof(p_projection -> 'rows') = 'array'
      and pg_catalog.jsonb_array_length(p_projection -> 'rows') <= 2000
      and p_projection ->> 'contributionFamily' = 'control_observation'
      and p_projection -> 'additive' = 'false'::jsonb
      and p_projection ->> 'parserVersion' = 'qbo_report_parser_v1',
      false
    );
  end if;

  return false;
end;
$function$;

create or replace function private.qbo_phase_8b_realm_fingerprint_v1(
  p_realm_id text
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'provider_authorized_entity_reference',
      'fingerprintVersion',
        'provider_authorized_entity_reference_fingerprint_v1',
      'value', p_realm_id
    )
  );
$function$;

create or replace function private.enforce_qbo_phase_8b_source_realm_binding_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mapping private.provider_entity_mappings;
  v_realm_id text;
begin
  if new.source_kind <> 'provider'
    or new.provider_key <> 'quickbooks_online'
    or new.normalized_projection is null then
    return new;
  end if;

  v_realm_id := new.normalized_projection #>> '{provider,realmId}';
  select mapping.*
  into v_mapping
  from private.external_source_records as source_record
  join private.provider_entity_mappings as mapping
    on mapping.id = source_record.mapping_id
    and mapping.workspace_id = source_record.workspace_id
    and mapping.business_entity_id = source_record.business_entity_id
    and mapping.connection_id = source_record.connection_id
  where source_record.id = new.source_record_id
    and source_record.workspace_id = new.workspace_id
    and source_record.business_entity_id = new.business_entity_id
    and source_record.connection_id = new.connection_id
    and source_record.provider_key = 'quickbooks_online'
    and mapping.provider_key = 'quickbooks_online'
    and mapping.provider_environment = 'sandbox'
    and mapping.status = 'active'
  for share of mapping;

  if not found
    or not private.is_bounded_identifier_v1(v_realm_id)
    or v_mapping.provider_entity_reference_fingerprint <>
      private.qbo_phase_8b_realm_fingerprint_v1(v_realm_id) then
    raise exception using
      errcode = '42501',
      message = 'qbo_provider_source_realm_binding_denied';
  end if;
  return new;
end;
$function$;

drop trigger if exists enforce_qbo_phase_8b_source_realm_binding_v1
  on private.external_source_record_versions;
create trigger enforce_qbo_phase_8b_source_realm_binding_v1
before insert on private.external_source_record_versions
for each row execute function
  private.enforce_qbo_phase_8b_source_realm_binding_v1();

create or replace function public.read_qbo_sandbox_runtime_task_delivery_v1(
  p_task_id uuid,
  p_dispatcher_task_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
  v_credential private.integration_credentials;
begin
  perform private.assert_phase_6_authority_v1(
    'integration_provider_runtime_authority'
  );
  if p_dispatcher_task_name is null
    or p_dispatcher_task_name !~ '^[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_runtime_delivery_payload_invalid';
  end if;

  select task.*
  into v_task
  from private.integration_sync_tasks as task
  where task.id = p_task_id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
    and task.dispatcher_task_name = p_dispatcher_task_name;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_runtime_delivery_denied';
  end if;

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_task.workspace_id
    and credential.business_entity_id = v_task.business_entity_id
    and credential.connection_id = v_task.connection_id
    and credential.connection_generation = v_task.connection_generation
    and credential.provider_key = v_task.provider_key
    and credential.provider_environment = v_task.provider_environment
    and credential.status = 'active';
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_runtime_delivery_credential_denied';
  end if;

  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'workspaceId', v_task.workspace_id,
    'businessEntityId', v_task.business_entity_id,
    'connectionId', v_task.connection_id,
    'connectionGeneration', v_task.connection_generation,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'state', v_task.state,
    'rowVersion', v_task.row_version
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_runtime_delivery_payload_invalid';
end;
$function$;

create or replace function public.read_qbo_sandbox_dispatch_candidates_v1(
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
  if p_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_dispatch_query_invalid';
  end if;

  with last_served as (
    select
      served.workspace_id,
      pg_catalog.max(served.updated_at) as last_served_at
    from private.integration_sync_tasks as served
    where served.provider_key = 'quickbooks_online'
      and served.provider_environment = 'sandbox'
      and served.dispatch_generation > 0
    group by served.workspace_id
  ), ranked as (
    select
      task.*,
      last_served.last_served_at,
      pg_catalog.row_number() over (
        partition by task.workspace_id
        order by task.priority desc, task.created_at, task.id
      ) as workspace_ordinal
    from private.integration_sync_tasks as task
    left join last_served on last_served.workspace_id = task.workspace_id
    where task.provider_key = 'quickbooks_online'
      and task.provider_environment = 'sandbox'
      and task.queue_class in ('provider_interactive', 'provider_bulk')
      and task.state = 'pending'
      and task.available_at <= v_now
      and task.stream_key in (
        'accounts', 'company_info', 'preferences',
        'customers_minimized', 'vendors_minimized', 'items_minimized',
        'qbo_invoice', 'qbo_salesreceipt', 'qbo_payment', 'qbo_creditmemo',
        'qbo_refundreceipt', 'qbo_bill', 'qbo_billpayment', 'qbo_purchase',
        'qbo_vendorcredit', 'qbo_deposit', 'qbo_journalentry',
        'qbo_transfer', 'qbo_profitandloss', 'qbo_balancesheet',
        'qbo_cashflow', 'qbo_aragingsummary', 'qbo_apagingsummary',
        'qbo_trialbalance', 'qbo_cdc'
      )
  ), fair as (
    select ranked.*
    from ranked
    order by workspace_ordinal, last_served_at nulls first,
      workspace_id, priority desc, created_at, id
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
        'queueClass', fair.queue_class,
        'streamKey', fair.stream_key,
        'rowVersion', fair.row_version,
        'dispatchGeneration', fair.dispatch_generation
      ) order by fair.workspace_ordinal, fair.last_served_at nulls first,
        fair.workspace_id, fair.id
    ),
    '[]'::jsonb
  ) into v_result
  from fair;

  return v_result;
end;
$function$;

create or replace function public.read_qbo_sandbox_authorization_recovery_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection private.integration_connections;
  v_credential private.integration_credentials;
  v_mapping private.provider_entity_mappings;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'mappingId'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_authorization_recovery_v1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_authorization_recovery_payload_invalid';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('authorized_unmapped', 'initializing')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_authorization_recovery_denied';
  end if;

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
    and credential.status = 'active'
    and credential.credential_ciphertext is not null
    and credential.external_entity_reference_fingerprint is not null
    and credential.granted_scopes =
      array['com.intuit.quickbooks.accounting']::text[]
    and credential.access_expires_at >
      pg_catalog.transaction_timestamp() + interval '30 seconds'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_authorization_recovery_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.id = (p_command ->> 'mappingId')::uuid
  for share;
  if found and (
      v_mapping.provider_key <> v_connection.provider_key
      or v_mapping.provider_environment <> v_connection.provider_environment
      or v_mapping.provider_entity_reference_fingerprint <>
        v_credential.external_entity_reference_fingerprint
      or v_mapping.status not in ('pending_verification', 'active')
    ) then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_authorization_recovery_denied';
  end if;

  return pg_catalog.jsonb_build_object(
    'connectionStatus', v_connection.status,
    'connectionRowVersion', v_connection.row_version,
    'credential', pg_catalog.jsonb_build_object(
      'credentialId', v_credential.id,
      'credentialVersion', v_credential.credential_version,
      'ciphertextBase64',
        pg_catalog.replace(
          pg_catalog.encode(v_credential.credential_ciphertext, 'base64'),
          E'\n',
          ''
        ),
      'aadDigest',
        private.phase_5_fingerprint_text_v1(v_credential.aad_digest),
      'kmsKeyResource', v_credential.kms_key_resource,
      'aadContext', pg_catalog.jsonb_build_object(
        'schemaVersion', v_credential.aad_schema_version,
        'purpose', 'provider_oauth_credential',
        'environment', v_credential.provider_environment,
        'workspaceId', v_credential.workspace_id,
        'connectionId', v_credential.connection_id,
        'connectionGeneration', v_credential.connection_generation,
        'providerKey', v_credential.provider_key,
        'credentialId', v_credential.id
      ),
      'accessExpiresAt', pg_catalog.to_char(
        v_credential.access_expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'grantedScopes', pg_catalog.to_jsonb(v_credential.granted_scopes),
      'externalEntityReferenceFingerprint',
        private.phase_5_fingerprint_text_v1(
          v_credential.external_entity_reference_fingerprint
        ),
      'authorizedAt', pg_catalog.to_char(
        v_credential.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    'mapping', case when v_mapping.id is null then
      pg_catalog.jsonb_build_object('state', 'missing')
    else
      pg_catalog.jsonb_build_object(
        'state', 'available',
        'mappingId', v_mapping.id,
        'status', v_mapping.status,
        'rowVersion', v_mapping.row_version,
        'providerEntityReferenceFingerprint',
          private.phase_4_fingerprint_text_v1(
            v_mapping.provider_entity_reference_fingerprint
          ),
        'verificationFingerprint', case
          when v_mapping.verification_fingerprint is null then null
          else private.phase_4_fingerprint_text_v1(
            v_mapping.verification_fingerprint
          )
        end
      )
    end
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'qbo_sandbox_authorization_recovery_payload_invalid';
end;
$function$;

create or replace function public.complete_qbo_sandbox_runtime_task_v1(
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
  if p_request_id is null or pg_catalog.char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or pg_catalog.char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array['completion', 'continuation']
    )
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
      message = 'qbo_sandbox_task_completion_payload_invalid';
  end if;

  select task.*
  into v_parent
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
    or v_parent.provider_environment <> 'sandbox'
    or v_parent.queue_class not in ('provider_interactive', 'provider_bulk') then
    raise exception using
      errcode = '42501',
      message = 'qbo_sandbox_task_completion_denied';
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
      or (p_command #>> '{completion,checkpoint,expectedCheckpointVersion}')::bigint <>
        (v_parent.control_metadata ->> 'cursorVersion')::bigint
      or (p_command #>> '{completion,checkpoint,cursorVersion}')::bigint <>
        v_next_cursor_version then
      raise exception using
        errcode = '22023',
        message = 'qbo_sandbox_task_continuation_invalid';
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
      message = 'qbo_sandbox_task_continuation_invalid';
  end if;

  v_child_idempotency := extensions.digest(
    pg_catalog.convert_to(
      'qbo_sandbox_page_continuation_v1:' || v_parent.id::text || ':' ||
        v_next_page_ordinal::text,
      'UTF8'
    ),
    'sha256'
  );
  v_child_coalescing := extensions.digest(
    pg_catalog.convert_to(
      'qbo_sandbox_page_scope_v1:' || v_parent.sync_run_id::text || ':' ||
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

  select task.*
  into v_child
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
        message = 'qbo_sandbox_task_continuation_conflict';
    end if;
    return v_completion || pg_catalog.jsonb_build_object(
      'continuationTaskId', v_child.id,
      'continuationCreated', false,
      'continuationState', v_child.state,
      'continuationRowVersion', v_child.row_version
    );
  end if;

  select task.*
  into v_child
  from private.integration_sync_tasks as task
  where task.workspace_id = v_parent.workspace_id
    and task.business_entity_id = v_parent.business_entity_id
    and task.connection_id = v_parent.connection_id
    and task.connection_generation = v_parent.connection_generation
    and task.idempotency_fingerprint = v_child_idempotency
  for update;
  if found then
    raise exception using
      errcode = '23505',
      message = 'qbo_sandbox_task_continuation_conflict';
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
    greatest(v_parent.retention_expires_at, v_now + interval '1 day')
  )
  returning * into v_child;

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
      message = 'qbo_sandbox_task_completion_payload_invalid';
end;
$function$;

create or replace function public.read_qbo_sandbox_pending_source_versions_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mapping private.provider_entity_mappings;
  v_connection private.integration_connections;
  v_limit integer;
  v_result jsonb;
begin
  perform private.assert_integration_provider_validation_authority_v1();
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'maximumResults'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_pending_source_read_v1'
    or (p_command ->> 'maximumResults') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'provider_pending_source_read_payload_invalid';
  end if;
  v_limit := (p_command ->> 'maximumResults')::integer;
  if v_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = 'provider_pending_source_read_payload_invalid';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = (p_command ->> 'workspaceId')::uuid
    and mapping.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and mapping.connection_id = (p_command ->> 'connectionId')::uuid
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = 'quickbooks_online'
    and mapping.provider_environment = 'sandbox'
    and mapping.status = 'active'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_pending_source_read_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_mapping.workspace_id
    and connection.business_entity_id = v_mapping.business_entity_id
    and connection.id = v_mapping.connection_id
    and connection.provider_key = v_mapping.provider_key
    and connection.provider_environment = v_mapping.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_pending_source_read_denied';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(item.payload order by item.received_at, item.version_id),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      version.received_at,
      version.id as version_id,
      pg_catalog.jsonb_build_object(
        'sourceRecordId', source_record.id,
        'sourceIdentityFingerprint',
          'sha256:' || pg_catalog.encode(source_record.source_identity_fingerprint, 'hex'),
        'pendingVersion', private.phase_8b_source_version_json_v1(version)
      ) as payload
    from private.external_source_records as source_record
    join private.external_source_record_versions as version
      on version.source_record_id = source_record.id
      and version.id = source_record.current_version_id
    where source_record.workspace_id = v_mapping.workspace_id
      and source_record.business_entity_id = v_mapping.business_entity_id
      and source_record.connection_id = v_mapping.connection_id
      and source_record.mapping_id = v_mapping.id
      and source_record.provider_key = 'quickbooks_online'
      and version.source_kind = 'provider'
      and version.provider_key = 'quickbooks_online'
      and version.validation_state = 'pending'
    order by version.received_at, version.id
    limit v_limit
  ) as item;

  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_pending_source_read_payload_invalid';
end;
$function$;

create or replace function public.read_qbo_sandbox_current_valid_source_versions_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_mapping private.provider_entity_mappings;
  v_connection private.integration_connections;
  v_limit integer;
  v_result jsonb;
begin
  perform private.assert_integration_provider_validation_authority_v1();
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'maximumResults'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_current_valid_source_read_v1'
    or (p_command ->> 'maximumResults') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'provider_current_valid_source_read_payload_invalid';
  end if;
  v_limit := (p_command ->> 'maximumResults')::integer;
  if v_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = 'provider_current_valid_source_read_payload_invalid';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = (p_command ->> 'workspaceId')::uuid
    and mapping.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and mapping.connection_id = (p_command ->> 'connectionId')::uuid
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = 'quickbooks_online'
    and mapping.provider_environment = 'sandbox'
    and mapping.status = 'active'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_current_valid_source_read_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_mapping.workspace_id
    and connection.business_entity_id = v_mapping.business_entity_id
    and connection.id = v_mapping.connection_id
    and connection.provider_key = v_mapping.provider_key
    and connection.provider_environment = v_mapping.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_current_valid_source_read_denied';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(item.payload order by item.received_at, item.version_id),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      version.received_at,
      version.id as version_id,
      pg_catalog.jsonb_build_object(
        'sourceRecordId', source_record.id,
        'sourceIdentityFingerprint',
          'sha256:' || pg_catalog.encode(
            source_record.source_identity_fingerprint,
            'hex'
          ),
        'sourceVersion', private.phase_8b_source_version_json_v1(version)
      ) as payload
    from private.external_source_records as source_record
    join private.external_source_record_versions as version
      on version.source_record_id = source_record.id
      and version.id = source_record.current_version_id
    where source_record.workspace_id = v_mapping.workspace_id
      and source_record.business_entity_id = v_mapping.business_entity_id
      and source_record.connection_id = v_mapping.connection_id
      and source_record.mapping_id = v_mapping.id
      and source_record.provider_key = 'quickbooks_online'
      and version.source_kind = 'provider'
      and version.provider_key = 'quickbooks_online'
      and version.validation_state = 'valid'
      and version.change_kind = 'unchanged'
      and version.normalized_projection is not null
    order by version.received_at, version.id
    limit v_limit
  ) as item;

  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_current_valid_source_read_payload_invalid';
end;
$function$;

create or replace function public.read_provider_external_source_record_state_v1(
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.transaction_timestamp();
  v_task private.integration_sync_tasks;
  v_mapping private.provider_entity_mappings;
  v_source private.external_source_records;
  v_version private.external_source_record_versions;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'taskId',
        'leaseId',
        'leaseOwnerFingerprint',
        'mappingId',
        'providerRecordType',
        'providerRecordId'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_source_state_read_v1'
    or not private.is_sha256_fingerprint_v1(
      p_command ->> 'leaseOwnerFingerprint'
    )
    or not private.is_bounded_identifier_v1(
      p_command ->> 'providerRecordType'
    )
    or not private.is_bounded_identifier_v1(
      p_command ->> 'providerRecordId'
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_source_state_read_payload_invalid';
  end if;

  select task.*
  into v_task
  from private.integration_sync_tasks as task
  where task.id = (p_command ->> 'taskId')::uuid
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.queue_class not in ('provider_interactive', 'provider_bulk')
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <>
      private.sha256_fingerprint_bytes_v1(
        p_command ->> 'leaseOwnerFingerprint'
      )
    or v_task.lease_expires_at <= v_now
    or v_task.control_metadata -> 'mappingId' = 'null'::jsonb
    or v_task.control_metadata ->> 'mappingId' <> p_command ->> 'mappingId'
    or v_task.provider_key <> 'quickbooks_online'
    or v_task.provider_environment <> 'sandbox' then
    raise exception using
      errcode = '42501',
      message = 'provider_source_state_read_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_task.workspace_id
    and mapping.business_entity_id = v_task.business_entity_id
    and mapping.connection_id = v_task.connection_id
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = v_task.provider_key
    and mapping.provider_environment = v_task.provider_environment
    and mapping.status = 'active'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_source_state_read_denied';
  end if;

  select source_record.*
  into v_source
  from private.external_source_records as source_record
  where source_record.workspace_id = v_task.workspace_id
    and source_record.business_entity_id = v_task.business_entity_id
    and source_record.connection_id = v_task.connection_id
    and source_record.mapping_id = v_mapping.id
    and source_record.provider_key = v_task.provider_key
    and source_record.provider_record_type =
      p_command ->> 'providerRecordType'
    and source_record.provider_record_id =
      p_command ->> 'providerRecordId';

  if not found then
    return pg_catalog.jsonb_build_object('state', 'missing');
  end if;

  select source_version.*
  into strict v_version
  from private.external_source_record_versions as source_version
  where source_version.source_record_id = v_source.id
    and source_version.id = v_source.current_version_id;

  return pg_catalog.jsonb_build_object(
    'state', 'available',
    'sourceRecordId', v_source.id,
    'currentVersionId', v_version.id,
    'immutableVersion', v_version.immutable_version,
    'sourceFingerprint',
      'sha256:' || pg_catalog.encode(v_version.source_fingerprint, 'hex'),
    'validationState', v_version.validation_state,
    'changeKind', v_version.change_kind,
    'providerVersionReference', v_version.provider_version_reference,
    'normalizedProjection', v_version.normalized_projection
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_source_state_read_payload_invalid';
end;
$function$;

create or replace function public.validate_provider_external_source_record_version_v1(
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
  v_pending private.external_source_record_versions;
  v_source private.external_source_records;
  v_mapping private.provider_entity_mappings;
  v_existing private.external_source_record_versions;
  v_version jsonb;
  v_version_id uuid;
  v_source_fingerprint bytea;
  v_validation_state text;
begin
  perform private.assert_integration_provider_validation_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'pendingSourceVersionId',
        'expectedPendingSourceFingerprint',
        'validatedVersion'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_source_validation_v1'
    or not private.is_sha256_fingerprint_v1(
      p_command ->> 'expectedPendingSourceFingerprint'
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_source_validation_payload_invalid';
  end if;

  v_version := p_command -> 'validatedVersion';
  perform private.validate_source_version_payload_v1(v_version);
  v_version_id := (v_version ->> 'id')::uuid;
  v_source_fingerprint := private.sha256_fingerprint_bytes_v1(
    v_version ->> 'sourceFingerprint'
  );
  v_validation_state := v_version #>> '{validation,state}';

  if v_version #>> '{source,kind}' <> 'provider'
    or v_version #>> '{source,providerKey}' <> 'quickbooks_online'
    or v_version ->> 'trust' <> 'untrusted_external_input'
    or v_version #>> '{validation,validatorVersion}' <>
      'qbo_phase_8b_deterministic_validator_v1'
    or v_validation_state not in ('valid', 'quarantined')
    or (
      v_version ->> 'changeKind' = 'deleted'
      and (
        v_validation_state <> 'quarantined'
        or v_version -> 'normalizedProjection' <> 'null'::jsonb
        or not exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            v_version #> '{validation,issues}'
          ) as issue(value)
          where issue.value ->> 'code' = 'qbo_deleted_source_requires_review'
        )
      )
    )
    or (
      v_version ->> 'changeKind' <> 'deleted'
      and (
        v_version ->> 'changeKind' <> 'unchanged'
        or v_version -> 'normalizedProjection' = 'null'::jsonb
        or not private.is_qbo_phase_8b_validated_projection_v1(
          v_version -> 'normalizedProjection'
        )
        or (
          v_version #>> '{normalizedProjection,contractVersion}' =
            'qbo_source_record_minimized_v1'
          and v_version ->> 'normalizedSchemaVersion' <>
            v_version #>> '{normalizedProjection,minimizationVersion}'
        )
        or (
          v_version #>> '{normalizedProjection,contractVersion}' =
            'qbo_report_control_observation_v1'
          and v_version ->> 'normalizedSchemaVersion' <>
            v_version #>> '{normalizedProjection,parserVersion}'
        )
        or (
          v_version #>> '{normalizedProjection,contractVersion}' =
            'qbo_source_record_minimized_v1'
          and v_version #>> '{source,providerRecordType}' <>
            v_version #>> '{normalizedProjection,recordType}'
        )
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_source_validation_payload_invalid';
  end if;

  select source_version.*
  into v_pending
  from private.external_source_record_versions as source_version
  where source_version.id =
    (p_command ->> 'pendingSourceVersionId')::uuid
  for share;
  if not found
    or v_pending.source_kind <> 'provider'
    or v_pending.provider_key <> 'quickbooks_online'
    or v_pending.validation_state <> 'pending'
    or v_pending.change_kind = 'unchanged'
    or (
      v_pending.change_kind = 'deleted'
      and v_pending.normalized_projection is not null
    )
    or (
      v_pending.change_kind <> 'deleted'
      and v_pending.normalized_projection is null
    )
    or v_pending.source_fingerprint <>
      private.sha256_fingerprint_bytes_v1(
        p_command ->> 'expectedPendingSourceFingerprint'
      ) then
    raise exception using
      errcode = '42501',
      message = 'provider_source_validation_denied';
  end if;

  select source_record.*
  into v_source
  from private.external_source_records as source_record
  where source_record.id = v_pending.source_record_id
    and source_record.workspace_id = v_pending.workspace_id
    and source_record.business_entity_id = v_pending.business_entity_id
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_source_validation_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.id = v_source.mapping_id
    and mapping.workspace_id = v_pending.workspace_id
    and mapping.business_entity_id = v_pending.business_entity_id
    and mapping.connection_id = v_pending.connection_id
    and mapping.provider_key = 'quickbooks_online'
    and mapping.provider_environment = 'sandbox'
    and mapping.status = 'active'
  for share;
  if not found
    or (
      v_pending.change_kind <> 'deleted'
      and v_mapping.provider_entity_reference_fingerprint <>
        private.qbo_phase_8b_realm_fingerprint_v1(
          v_pending.normalized_projection #>> '{provider,realmId}'
        )
    ) then
    raise exception using
      errcode = '42501',
      message = 'provider_source_validation_denied';
  end if;

  if v_version ->> 'workspaceId' <> v_pending.workspace_id::text
    or v_version ->> 'businessEntityId' <>
      v_pending.business_entity_id::text
    or v_version ->> 'connectionId' <> v_pending.connection_id::text
    or (v_version ->> 'immutableVersion')::bigint <>
      v_pending.immutable_version + 1
    or (v_version ->> 'priorVersionId')::uuid <> v_pending.id
    or v_version ->> 'recordKind' <> v_pending.record_kind
    or v_version #>> '{source,providerRecordType}' <>
      v_pending.provider_record_type
    or v_version #>> '{source,providerRecordId}' <>
      v_pending.provider_record_id
    or v_version #>> '{source,providerVersionReference}' is distinct from
      v_pending.provider_version_reference
    or v_version #>> '{temporal,basis}' <> v_pending.temporal_basis
    or (v_version #>> '{temporal,providerCreatedAt}')::timestamptz
      is distinct from v_pending.provider_created_at
    or (v_version #>> '{temporal,providerUpdatedAt}')::timestamptz
      is distinct from v_pending.provider_updated_at
    or (v_version #>> '{temporal,observedAt}')::timestamptz <>
      v_pending.observed_at
    or (v_version #>> '{temporal,synchronizedAt}')::timestamptz <>
      v_pending.synchronized_at
    or (v_version #>> '{temporal,ingestedAt}')::timestamptz <>
      v_pending.ingested_at
    or (v_version #>> '{temporal,effectiveAt}')::timestamptz
      is distinct from v_pending.effective_at
    or (v_version #>> '{temporal,postingDate}')::date
      is distinct from v_pending.posting_date
    or (v_version #>> '{temporal,periodStart}')::date
      is distinct from v_pending.period_start
    or (v_version #>> '{temporal,periodEnd}')::date
      is distinct from v_pending.period_end
    or v_version #>> '{temporal,sourceTimeZone}' is distinct from
      v_pending.source_timezone
    or v_version #>> '{accounting,basis}' <> v_pending.accounting_basis
    or v_version #>> '{accounting,currency}' is distinct from
      pg_catalog.btrim(v_pending.accounting_currency::text)
    or v_version ->> 'normalizedSchemaVersion' <>
      v_pending.normalized_schema_version
    or (
      v_pending.change_kind = 'deleted'
      and v_version -> 'normalizedProjection' <> 'null'::jsonb
    )
    or (
      v_pending.change_kind <> 'deleted'
      and v_version -> 'normalizedProjection' <>
        v_pending.normalized_projection
    )
    or (v_version ->> 'receivedAt')::timestamptz < v_pending.received_at then
    raise exception using
      errcode = '42501',
      message = 'provider_source_validation_denied';
  end if;

  select source_version.*
  into v_existing
  from private.external_source_record_versions as source_version
  where source_version.id = v_version_id;
  if found then
    if v_existing.prior_version_id =
        (p_command ->> 'pendingSourceVersionId')::uuid
      and v_existing.source_fingerprint = v_source_fingerprint
      and v_existing.validation_state = v_validation_state
      and v_existing.validator_version =
        'qbo_phase_8b_deterministic_validator_v1' then
      return pg_catalog.jsonb_build_object(
        'sourceRecordId', v_existing.source_record_id,
        'sourceVersionId', v_existing.id,
        'immutableVersion', v_existing.immutable_version,
        'sourceFingerprint', v_version ->> 'sourceFingerprint',
        'validationState', v_existing.validation_state,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'provider_source_validation_version_conflict';
  end if;

  if v_source.current_version_id <> v_pending.id then
    raise exception using
      errcode = '40001',
      message = 'provider_source_validation_current_version_stale';
  end if;

  insert into private.external_source_record_versions (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    source_record_id,
    sync_run_id,
    immutable_version,
    prior_version_id,
    record_kind,
    source_kind,
    provider_key,
    provider_record_type,
    provider_record_id,
    provider_version_reference,
    temporal_basis,
    provider_created_at,
    provider_updated_at,
    observed_at,
    synchronized_at,
    ingested_at,
    effective_at,
    posting_date,
    period_start,
    period_end,
    source_timezone,
    accounting_basis,
    accounting_currency,
    normalized_schema_version,
    change_kind,
    normalized_projection,
    trust,
    validation_state,
    validator_version,
    validation_issues,
    received_at,
    source_fingerprint
  ) values (
    v_version_id,
    'external_source_record_version_v1',
    v_pending.workspace_id,
    v_pending.business_entity_id,
    v_pending.connection_id,
    v_pending.source_record_id,
    v_pending.sync_run_id,
    v_pending.immutable_version + 1,
    v_pending.id,
    v_pending.record_kind,
    'provider',
    'quickbooks_online',
    v_pending.provider_record_type,
    v_pending.provider_record_id,
    v_pending.provider_version_reference,
    v_pending.temporal_basis,
    v_pending.provider_created_at,
    v_pending.provider_updated_at,
    v_pending.observed_at,
    v_pending.synchronized_at,
    v_pending.ingested_at,
    v_pending.effective_at,
    v_pending.posting_date,
    v_pending.period_start,
    v_pending.period_end,
    v_pending.source_timezone,
    v_pending.accounting_basis,
    v_pending.accounting_currency,
    v_pending.normalized_schema_version,
    case when v_pending.change_kind = 'deleted' then 'deleted'
      else 'unchanged' end,
    v_pending.normalized_projection,
    'untrusted_external_input',
    v_validation_state,
    'qbo_phase_8b_deterministic_validator_v1',
    v_version #> '{validation,issues}',
    (v_version ->> 'receivedAt')::timestamptz,
    v_source_fingerprint
  );

  update private.external_source_records as source_record
  set
    current_version_id = v_version_id,
    updated_at = v_now
  where source_record.id = v_source.id;

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
    v_pending.workspace_id,
    v_pending.business_entity_id,
    v_pending.connection_id,
    'service',
    'integration_provider_validation_authority',
    'external_source_record_version.validate',
    case when v_validation_state = 'valid' then 'succeeded' else 'denied' end,
    'external_source_record_version',
    v_version_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'immutable_version', v_pending.immutable_version + 1,
      'prior_version_id', v_pending.id,
      'validation_state', v_validation_state
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'sourceRecordId', v_source.id,
    'sourceVersionId', v_version_id,
    'immutableVersion', v_pending.immutable_version + 1,
    'sourceFingerprint', v_version ->> 'sourceFingerprint',
    'validationState', v_validation_state,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_source_validation_payload_invalid';
end;
$function$;

revoke all on function public.read_provider_external_source_record_state_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_provider_external_source_record_state_v1(jsonb)
  to integration_provider_source_authority;

revoke all on function public.consume_integration_oauth_state_v2(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.consume_integration_oauth_state_v2(jsonb, text)
  to integration_oauth_ingress_authority;

revoke all on function public.validate_provider_external_source_record_version_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.validate_provider_external_source_record_version_v1(jsonb, text)
  to integration_provider_validation_authority;

revoke all on function public.read_qbo_sandbox_pending_source_versions_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_pending_source_versions_v1(jsonb)
  to integration_provider_validation_authority;

revoke all on function public.read_qbo_sandbox_current_valid_source_versions_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_current_valid_source_versions_v1(jsonb)
  to integration_provider_validation_authority;

revoke all on function public.read_qbo_sandbox_authorization_recovery_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_authorization_recovery_v1(jsonb)
  to integration_credential_broker_authority;

revoke all on function public.read_qbo_sandbox_runtime_task_delivery_v1(uuid, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_runtime_task_delivery_v1(uuid, text)
  to integration_provider_runtime_authority;

revoke all on function public.read_qbo_sandbox_dispatch_candidates_v1(integer)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.read_qbo_sandbox_dispatch_candidates_v1(integer)
  to integration_task_dispatch_authority;

revoke all on function public.complete_qbo_sandbox_runtime_task_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function public.complete_qbo_sandbox_runtime_task_v1(jsonb, text, text)
  to integration_provider_runtime_authority;

revoke all on function private.phase_8b_source_version_json_v1(
  private.external_source_record_versions
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

revoke all on function private.is_qbo_phase_8b_validated_projection_v1(jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

revoke all on function private.assert_integration_provider_validation_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

commit;
