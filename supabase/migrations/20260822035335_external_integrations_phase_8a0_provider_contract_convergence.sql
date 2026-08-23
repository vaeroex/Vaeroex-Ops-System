-- External Integrations Phase 8A.0: Provider Runtime Contract / Persistence Convergence
--
-- This forward-only migration aligns provider-defined environment keys, admits
-- the reviewed QBO descriptor into the private control plane, and introduces
-- narrow credential-read and provider-source authorities. It provisions no
-- provider, cloud, queue, route, UI, AI, or KPI-promotion runtime.

begin;

do $roles$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'integration_provider_source_authority'
  ) then
    create role integration_provider_source_authority nologin noinherit;
  end if;
end;
$roles$;

revoke integration_provider_source_authority
  from anon, authenticated, service_role, external_integrations_authority,
    deterministic_calculation_authority, integration_control_plane_authority,
    integration_oauth_ingress_authority, integration_credential_broker_authority,
    integration_webhook_ingress_authority, integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
revoke all on schema private from integration_provider_source_authority;

create or replace function private.assert_integration_provider_source_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'integration_provider_source_authority',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_source_authority_required';
  end if;
end;
$function$;

create or replace function public.commit_provider_external_source_record_version_v1(
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
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_version jsonb;
  v_version_id uuid;
  v_prior_version_id uuid;
  v_identity_fingerprint bytea;
  v_source_fingerprint bytea;
  v_source_record private.external_source_records;
  v_current_version private.external_source_record_versions;
  v_existing_version private.external_source_record_versions;
  v_expected_version bigint;
begin
  perform private.assert_integration_provider_source_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'taskId',
        'leaseId',
        'leaseOwnerFingerprint',
        'mappingId',
        'sourceIdentityFingerprint',
        'version'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_source_commit_v1'
    or not private.is_sha256_fingerprint_v1(
      p_command ->> 'leaseOwnerFingerprint'
    )
    or not private.is_sha256_fingerprint_v1(
      p_command ->> 'sourceIdentityFingerprint'
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_source_commit_payload_invalid';
  end if;

  v_version := p_command -> 'version';
  perform private.validate_source_version_payload_v1(v_version);
  if v_version #>> '{source,kind}' <> 'provider'
    or v_version ->> 'trust' <> 'untrusted_external_input'
    or v_version #>> '{validation,state}' <> 'pending'
    or v_version #>> '{source,providerKey}' <> 'quickbooks_online'
    or (
      v_version ->> 'changeKind' <> 'deleted'
      and (
        v_version #>> '{normalizedProjection,provider,providerKey}' <>
          'quickbooks_online'
        or v_version #>> '{normalizedProjection,provider,sourceEnvironment}'
          not in ('sandbox', 'production')
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'provider_source_commit_payload_invalid';
  end if;

  v_version_id := (v_version ->> 'id')::uuid;
  v_prior_version_id := (v_version ->> 'priorVersionId')::uuid;
  v_identity_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'sourceIdentityFingerprint'
  );
  v_source_fingerprint := private.sha256_fingerprint_bytes_v1(
    v_version ->> 'sourceFingerprint'
  );

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
    or v_task.provider_environment not in ('sandbox', 'production') then
    raise exception using
      errcode = '42501',
      message = 'provider_source_commit_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_task.workspace_id
    and connection.business_entity_id = v_task.business_entity_id
    and connection.id = v_task.connection_id
    and connection.connection_generation = v_task.connection_generation
    and connection.provider_key = v_task.provider_key
    and connection.provider_environment = v_task.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'provider_source_commit_denied';
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
  if not found
    or v_version ->> 'workspaceId' <> v_task.workspace_id::text
    or v_version ->> 'businessEntityId' <> v_task.business_entity_id::text
    or v_version ->> 'connectionId' <> v_task.connection_id::text
    or v_version #>> '{source,providerKey}' <> v_task.provider_key
    or (
      v_version ->> 'changeKind' <> 'deleted'
      and v_version #>> '{normalizedProjection,provider,sourceEnvironment}' <>
        v_task.provider_environment
    ) then
    raise exception using
      errcode = '42501',
      message = 'provider_source_commit_denied';
  end if;

  insert into private.external_source_records (
    workspace_id,
    business_entity_id,
    mapping_id,
    connection_id,
    source_kind,
    provider_key,
    provider_record_type,
    provider_record_id,
    source_identity_fingerprint,
    first_seen_at,
    last_seen_at
  ) values (
    v_task.workspace_id,
    v_task.business_entity_id,
    v_mapping.id,
    v_task.connection_id,
    'provider',
    v_task.provider_key,
    v_version #>> '{source,providerRecordType}',
    v_version #>> '{source,providerRecordId}',
    v_identity_fingerprint,
    (v_version #>> '{temporal,observedAt}')::timestamptz,
    (v_version #>> '{temporal,observedAt}')::timestamptz
  )
  on conflict (
    workspace_id,
    business_entity_id,
    source_identity_fingerprint
  ) do nothing;

  select source_record.*
  into v_source_record
  from private.external_source_records as source_record
  where source_record.workspace_id = v_task.workspace_id
    and source_record.business_entity_id = v_task.business_entity_id
    and source_record.source_identity_fingerprint = v_identity_fingerprint
  for update;
  if not found
    or v_source_record.source_kind <> 'provider'
    or v_source_record.connection_id <> v_task.connection_id
    or v_source_record.mapping_id <> v_mapping.id
    or v_source_record.provider_key <> v_task.provider_key
    or v_source_record.provider_record_type <>
      v_version #>> '{source,providerRecordType}'
    or v_source_record.provider_record_id <>
      v_version #>> '{source,providerRecordId}' then
    raise exception using
      errcode = '23505',
      message = 'source_identity_fingerprint_collision';
  end if;

  select version.*
  into v_existing_version
  from private.external_source_record_versions as version
  where version.source_record_id = v_source_record.id
    and version.source_fingerprint = v_source_fingerprint;
  if found then
    if v_existing_version.id <> v_version_id then
      raise exception using
        errcode = '23505',
        message = 'source_fingerprint_version_id_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'sourceRecordId', v_source_record.id,
      'sourceVersionId', v_existing_version.id,
      'immutableVersion', v_existing_version.immutable_version,
      'sourceIdentityFingerprint', p_command ->> 'sourceIdentityFingerprint',
      'sourceFingerprint', v_version ->> 'sourceFingerprint',
      'currentVersionId', v_source_record.current_version_id,
      'idempotent', true,
      'validationState', v_existing_version.validation_state,
      'trust', v_existing_version.trust
    );
  end if;

  if v_source_record.current_version_id is null then
    v_expected_version := 1;
    if v_prior_version_id is not null then
      raise exception using
        errcode = '23514',
        message = 'first_source_version_cannot_have_prior';
    end if;
  else
    select version.*
    into strict v_current_version
    from private.external_source_record_versions as version
    where version.id = v_source_record.current_version_id
      and version.source_record_id = v_source_record.id;
    v_expected_version := v_current_version.immutable_version + 1;
    if v_prior_version_id is distinct from v_current_version.id then
      raise exception using
        errcode = '40001',
        message = 'source_prior_version_stale';
    end if;
  end if;
  if (v_version ->> 'immutableVersion')::bigint <> v_expected_version then
    raise exception using
      errcode = '40001',
      message = 'source_immutable_version_stale';
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
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    v_source_record.id,
    v_task.sync_run_id,
    v_expected_version,
    v_prior_version_id,
    v_version ->> 'recordKind',
    'provider',
    v_task.provider_key,
    v_version #>> '{source,providerRecordType}',
    v_version #>> '{source,providerRecordId}',
    v_version #>> '{source,providerVersionReference}',
    v_version #>> '{temporal,basis}',
    (v_version #>> '{temporal,providerCreatedAt}')::timestamptz,
    (v_version #>> '{temporal,providerUpdatedAt}')::timestamptz,
    (v_version #>> '{temporal,observedAt}')::timestamptz,
    (v_version #>> '{temporal,synchronizedAt}')::timestamptz,
    (v_version #>> '{temporal,ingestedAt}')::timestamptz,
    (v_version #>> '{temporal,effectiveAt}')::timestamptz,
    (v_version #>> '{temporal,postingDate}')::date,
    (v_version #>> '{temporal,periodStart}')::date,
    (v_version #>> '{temporal,periodEnd}')::date,
    v_version #>> '{temporal,sourceTimeZone}',
    v_version #>> '{accounting,basis}',
    v_version #>> '{accounting,currency}',
    v_version ->> 'normalizedSchemaVersion',
    v_version ->> 'changeKind',
    case
      when pg_catalog.jsonb_typeof(v_version -> 'normalizedProjection') = 'null'
        then null
      else v_version -> 'normalizedProjection'
    end,
    'untrusted_external_input',
    'pending',
    v_version #>> '{validation,validatorVersion}',
    v_version #> '{validation,issues}',
    (v_version ->> 'receivedAt')::timestamptz,
    v_source_fingerprint
  );

  update private.external_source_records as source_record
  set
    current_version_id = v_version_id,
    lifecycle_state = case v_version ->> 'changeKind'
      when 'deleted' then 'deleted'
      when 'voided' then 'voided'
      else 'active'
    end,
    last_seen_at = (v_version #>> '{temporal,observedAt}')::timestamptz,
    updated_at = v_now
  where source_record.id = v_source_record.id
  returning source_record.* into v_source_record;

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
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    'service',
    'integration_provider_source_authority',
    'external_source_record_version.commit',
    'succeeded',
    'external_source_record_version',
    v_version_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'contract_version', 'external_source_record_version_v1',
      'immutable_version', v_expected_version,
      'source_kind', 'provider',
      'validation_state', 'pending',
      'prior_version_id', v_prior_version_id
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'sourceRecordId', v_source_record.id,
    'sourceVersionId', v_version_id,
    'immutableVersion', v_expected_version,
    'sourceIdentityFingerprint', p_command ->> 'sourceIdentityFingerprint',
    'sourceFingerprint', v_version ->> 'sourceFingerprint',
    'currentVersionId', v_source_record.current_version_id,
    'idempotent', false,
    'validationState', 'pending',
    'trust', 'untrusted_external_input'
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'provider_source_commit_payload_invalid';
end;
$function$;

-- Declared before the replacement freshness RPC so function-body validation
-- can resolve the provider-aware policy during forward migration.
create or replace function private.is_phase_8a0_provider_environment_v1(
  p_provider_key text,
  p_provider_environment text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.is_bounded_identifier_v1(p_provider_environment)
    and (
      (p_provider_key = 'synthetic' and p_provider_environment = 'test')
      or (
        p_provider_key = 'quickbooks_online'
        and p_provider_environment in ('sandbox', 'production')
      )
    );
$function$;

create or replace function private.is_phase_8a0_freshness_policy_v1(
  p_provider_key text,
  p_provider_environment text,
  p_domain text,
  p_policy_version text,
  p_current_max_age_seconds bigint,
  p_stale_after_seconds bigint,
  p_stale_blocking_level text
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
    and (
      (
        p_provider_key = 'synthetic'
        and p_domain = 'general_ledger'
        and p_policy_version = 'synthetic_freshness_policy_v1'
        and p_current_max_age_seconds = 3600
        and p_stale_after_seconds = 7200
        and p_stale_blocking_level = 'current_intelligence'
      )
      or (
        p_provider_key = 'quickbooks_online'
        and p_domain in (
          'change_hints',
          'company_configuration',
          'financial_transactions',
          'master_records',
          'report_control_observations'
        )
        and p_policy_version = 'qbo_control_plane_freshness_policy_v1'
        and p_current_max_age_seconds between 60 and 86400
        and p_stale_after_seconds > p_current_max_age_seconds
        and p_stale_after_seconds <= 604800
        and p_stale_blocking_level in ('current_intelligence', 'all_derived')
      )
    );
$function$;

create or replace function public.upsert_integration_freshness_v1(
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
  v_freshness private.integration_freshness_states;
  v_mapping_id uuid;
  v_provider_watermark_at timestamptz;
  v_last_attempt_at timestamptz;
  v_last_successful_sync_at timestamptz;
  v_last_reconciled_at timestamptz;
  v_observed_lag_seconds bigint;
  v_calculated_at timestamptz;
  v_age_seconds bigint;
  v_status text;
  v_blocking_level text;
  v_reason_code text;
  v_latest_sync_failed boolean;
  v_derived_last_attempt_at timestamptz;
  v_derived_last_successful_sync_at timestamptz;
  v_state_fingerprint bytea;
  v_request_fingerprint bytea;
  v_existing_expected bigint;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'domain',
        'scopeKey',
        'providerWatermarkAt',
        'lastAttemptAt',
        'lastSuccessfulSyncAt',
        'lastReconciledAt',
        'observedLagSeconds',
        'policyVersion',
        'currentMaxAgeSeconds',
        'staleAfterSeconds',
        'staleBlockingLevel',
        'calculatedAt',
        'expectedRowVersion'
      ]
    )
    or not private.is_bounded_identifier_v1(p_command ->> 'domain')
    or not private.is_bounded_identifier_v1(p_command ->> 'scopeKey') then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_payload_invalid';
  end if;

  v_mapping_id := case
    when p_command -> 'mappingId' = 'null'::jsonb then null
    else (p_command ->> 'mappingId')::uuid
  end;
  v_provider_watermark_at := case
    when p_command -> 'providerWatermarkAt' = 'null'::jsonb then null
    else (p_command ->> 'providerWatermarkAt')::timestamptz
  end;
  v_last_attempt_at := case
    when p_command -> 'lastAttemptAt' = 'null'::jsonb then null
    else (p_command ->> 'lastAttemptAt')::timestamptz
  end;
  v_last_successful_sync_at := case
    when p_command -> 'lastSuccessfulSyncAt' = 'null'::jsonb then null
    else (p_command ->> 'lastSuccessfulSyncAt')::timestamptz
  end;
  v_last_reconciled_at := case
    when p_command -> 'lastReconciledAt' = 'null'::jsonb then null
    else (p_command ->> 'lastReconciledAt')::timestamptz
  end;
  v_observed_lag_seconds := case
    when p_command -> 'observedLagSeconds' = 'null'::jsonb then null
    else (p_command ->> 'observedLagSeconds')::bigint
  end;
  v_calculated_at := (p_command ->> 'calculatedAt')::timestamptz;
  v_existing_expected := case
    when p_command -> 'expectedRowVersion' = 'null'::jsonb then null
    else (p_command ->> 'expectedRowVersion')::bigint
  end;
  if v_observed_lag_seconds is not null and v_observed_lag_seconds < 0 then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_lag_invalid';
  end if;
  if v_last_successful_sync_at is not null
    and v_last_successful_sync_at > v_calculated_at then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_timestamp_invalid';
  end if;
  v_age_seconds := case
    when v_last_successful_sync_at is null then null
    else pg_catalog.floor(
      extract(epoch from (v_calculated_at - v_last_successful_sync_at))
    )::bigint
  end;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
  for update;
  if not found
    or not private.is_phase_8a0_freshness_policy_v1(
      v_connection.provider_key,
      v_connection.provider_environment,
      p_command ->> 'domain',
      p_command ->> 'policyVersion',
      (p_command ->> 'currentMaxAgeSeconds')::bigint,
      (p_command ->> 'staleAfterSeconds')::bigint,
      p_command ->> 'staleBlockingLevel'
    )
    or not exists (
      select 1
      from private.integration_workspace_policies as policy
      where policy.workspace_id = v_connection.workspace_id
        and policy.provider_key = v_connection.provider_key
        and policy.provider_environment = v_connection.provider_environment
        and policy.state = 'enabled'
        and policy.sync_enabled
        and policy.freshness_policy_version = p_command ->> 'policyVersion'
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_freshness_denied';
  end if;
  if v_mapping_id is not null and not exists (
    select 1
    from private.provider_entity_mappings as mapping
    where mapping.workspace_id = v_connection.workspace_id
      and mapping.business_entity_id = v_connection.business_entity_id
      and mapping.connection_id = v_connection.id
      and mapping.id = v_mapping_id
      and mapping.provider_key = v_connection.provider_key
      and mapping.provider_environment = v_connection.provider_environment
      and mapping.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_freshness_denied';
  end if;

  select
    pg_catalog.max(coalesce(run.finished_at, run.started_at, run.created_at)),
    pg_catalog.max(run.finished_at) filter (
      where run.state in ('succeeded', 'partially_succeeded')
    )
  into v_derived_last_attempt_at, v_derived_last_successful_sync_at
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and (v_mapping_id is null or run.mapping_id = v_mapping_id);

  if v_last_attempt_at is distinct from v_derived_last_attempt_at
    or v_last_successful_sync_at is distinct from v_derived_last_successful_sync_at then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_sync_evidence_invalid';
  end if;

  select coalesce((
    select run.state = 'failed'
    from private.integration_sync_runs as run
    where run.workspace_id = v_connection.workspace_id
      and run.business_entity_id = v_connection.business_entity_id
      and run.connection_id = v_connection.id
      and (v_mapping_id is null or run.mapping_id = v_mapping_id)
      and run.state in (
        'succeeded', 'partially_succeeded', 'failed', 'cancelled'
      )
    order by run.finished_at desc, run.id desc
    limit 1
  ), false)
  into v_latest_sync_failed;

  if v_connection.status = 'reauthorization_required' then
    v_status := 'reauthorization_required';
    v_blocking_level := 'all_derived';
    v_reason_code := 'connection_reauthorization_required';
  elsif v_connection.status in (
    'disconnecting', 'disconnected', 'deleting', 'deleted'
  ) then
    v_status := 'disconnected';
    v_blocking_level := 'all_derived';
    v_reason_code := 'connection_disconnected';
  elsif v_latest_sync_failed or v_connection.status = 'error' then
    v_status := 'sync_error';
    v_blocking_level := 'current_intelligence';
    v_reason_code := 'latest_sync_failed';
  elsif v_age_seconds is null then
    v_status := 'unknown';
    v_blocking_level := 'current_intelligence';
    v_reason_code := 'no_successful_sync';
  elsif v_age_seconds <= (p_command ->> 'currentMaxAgeSeconds')::bigint then
    v_status := 'current';
    v_blocking_level := 'none';
    v_reason_code := 'within_current_threshold';
  elsif v_age_seconds <= (p_command ->> 'staleAfterSeconds')::bigint then
    v_status := 'aging';
    v_blocking_level := 'warning';
    v_reason_code := 'exceeds_current_threshold';
  else
    v_status := 'stale';
    v_blocking_level := p_command ->> 'staleBlockingLevel';
    v_reason_code := 'exceeds_stale_threshold';
  end if;

  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_state_fingerprint := private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'integration_freshness_v1',
      'workspaceId', v_connection.workspace_id,
      'businessEntityId', v_connection.business_entity_id,
      'connectionId', v_connection.id,
      'mappingId', v_mapping_id,
      'domain', p_command ->> 'domain',
      'scopeKey', p_command ->> 'scopeKey',
      'providerWatermarkAt', v_provider_watermark_at,
      'lastAttemptAt', v_last_attempt_at,
      'lastSuccessfulSyncAt', v_last_successful_sync_at,
      'lastReconciledAt', v_last_reconciled_at,
      'observedLagSeconds', v_observed_lag_seconds,
      'status', v_status,
      'blockingLevel', v_blocking_level,
      'reasonCode', v_reason_code,
      'policyVersion', p_command ->> 'policyVersion',
      'currentMaxAgeSeconds', (p_command ->> 'currentMaxAgeSeconds')::bigint,
      'staleAfterSeconds', (p_command ->> 'staleAfterSeconds')::bigint,
      'ageSeconds', v_age_seconds,
      'calculatedAt', v_calculated_at
    )
  );

  select freshness.*
  into v_freshness
  from private.integration_freshness_states as freshness
  where freshness.workspace_id = v_connection.workspace_id
    and freshness.business_entity_id = v_connection.business_entity_id
    and freshness.connection_id = v_connection.id
    and freshness.mapping_id is not distinct from v_mapping_id
    and freshness.domain = p_command ->> 'domain'
    and freshness.scope_key = p_command ->> 'scopeKey'
  for update;

  if found then
    if v_freshness.last_request_id = p_request_id
      and v_freshness.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'freshness', private.integration_freshness_summary_json_v1(v_freshness),
        'idempotent', true
      );
    end if;
    if v_freshness.id <> (p_command ->> 'id')::uuid then
      raise exception using
        errcode = '23505',
        message = 'integration_freshness_scope_conflict';
    end if;
    if v_existing_expected is null
      or v_freshness.row_version <> v_existing_expected then
      raise exception using
        errcode = '40001',
        message = 'integration_freshness_row_version_stale';
    end if;
    update private.integration_freshness_states as freshness
    set
      provider_watermark_at = v_provider_watermark_at,
      last_attempt_at = v_last_attempt_at,
      last_successful_sync_at = v_last_successful_sync_at,
      last_reconciled_at = v_last_reconciled_at,
      observed_lag_seconds = v_observed_lag_seconds,
      status = v_status,
      blocking_level = v_blocking_level,
      reason_code = v_reason_code,
      policy_version = p_command ->> 'policyVersion',
      current_max_age_seconds = (p_command ->> 'currentMaxAgeSeconds')::bigint,
      stale_after_seconds = (p_command ->> 'staleAfterSeconds')::bigint,
      age_seconds = v_age_seconds,
      calculated_at = v_calculated_at,
      state_fingerprint = v_state_fingerprint,
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = freshness.row_version + 1,
      updated_at = v_calculated_at
    where freshness.id = v_freshness.id
    returning freshness.* into v_freshness;
  else
    if v_existing_expected is not null then
      raise exception using
        errcode = '40001',
        message = 'integration_freshness_row_version_stale';
    end if;
    insert into private.integration_freshness_states (
      id,
      contract_version,
      workspace_id,
      business_entity_id,
      connection_id,
      mapping_id,
      provider_key,
      domain,
      scope_key,
      provider_watermark_at,
      last_attempt_at,
      last_successful_sync_at,
      last_reconciled_at,
      observed_lag_seconds,
      status,
      blocking_level,
      reason_code,
      policy_version,
      current_max_age_seconds,
      stale_after_seconds,
      age_seconds,
      calculated_at,
      state_fingerprint,
      last_request_id,
      last_request_fingerprint,
      row_version,
      created_at,
      updated_at
    ) values (
      (p_command ->> 'id')::uuid,
      'integration_freshness_v1',
      v_connection.workspace_id,
      v_connection.business_entity_id,
      v_connection.id,
      v_mapping_id,
      v_connection.provider_key,
      p_command ->> 'domain',
      p_command ->> 'scopeKey',
      v_provider_watermark_at,
      v_last_attempt_at,
      v_last_successful_sync_at,
      v_last_reconciled_at,
      v_observed_lag_seconds,
      v_status,
      v_blocking_level,
      v_reason_code,
      p_command ->> 'policyVersion',
      (p_command ->> 'currentMaxAgeSeconds')::bigint,
      (p_command ->> 'staleAfterSeconds')::bigint,
      v_age_seconds,
      v_calculated_at,
      v_state_fingerprint,
      p_request_id,
      v_request_fingerprint,
      1,
      v_calculated_at,
      v_calculated_at
    ) returning * into v_freshness;
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
    v_freshness.workspace_id,
    v_freshness.business_entity_id,
    v_freshness.connection_id,
    'service',
    p_actor_id,
    'integration_freshness.upsert',
    'succeeded',
    'integration_freshness',
    v_freshness.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'freshness_status', v_freshness.status,
      'blocking_level', v_freshness.blocking_level,
      'row_version', v_freshness.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'freshness', private.integration_freshness_summary_json_v1(v_freshness),
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_freshness_scope_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_freshness_payload_invalid';
end;
$function$;

create or replace function private.is_phase_8a0_provider_environment_v1(
  p_provider_key text,
  p_provider_environment text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.is_bounded_identifier_v1(p_provider_environment)
    and (
      (p_provider_key = 'synthetic' and p_provider_environment = 'test')
      or (
        p_provider_key = 'quickbooks_online'
        and p_provider_environment in ('sandbox', 'production')
      )
    );
$function$;

create or replace function private.is_phase_8a0_scope_set_v1(
  p_provider_key text,
  p_values text[]
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.is_bounded_identifier_array_v1(p_values, 64)
    and (
      (
        p_provider_key = 'synthetic'
        and p_values in (
          array['read_synthetic_business_data']::text[],
          array[
            'read_synthetic_business_data',
            'read_synthetic_reference_data'
          ]::text[]
        )
      )
      or (
        p_provider_key = 'quickbooks_online'
        and p_values = array['com.intuit.quickbooks.accounting']::text[]
      )
    );
$function$;

create or replace function private.is_phase_8a0_capability_snapshot_v1(
  p_provider_key text,
  p_value jsonb
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'operations',
        'domains',
        'requiredStreamKeys',
        'supportsBackfill',
        'webhookMode',
        'incrementalMode'
      ]
    )
    and (
      (
        p_provider_key = 'synthetic'
        and p_value = pg_catalog.jsonb_build_object(
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
        )
      )
      or (
        p_provider_key = 'quickbooks_online'
        and p_value = pg_catalog.jsonb_build_object(
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
        )
      )
    );
$function$;

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
        and p_registry_fingerprint = pg_catalog.decode(
          '6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758',
          'hex'
        )
        and p_descriptor_fingerprint = pg_catalog.decode(
          'e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac',
          'hex'
        )
        and p_adapter_version = 'qbo_provider_adapter_v1'
      )
    );
$function$;

create or replace function private.is_phase_8a0_workspace_policy_v1(
  p_provider_key text,
  p_provider_environment text,
  p_maximum_concurrency integer,
  p_freshness_policy_version text,
  p_retention_policy_version text
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
    and p_maximum_concurrency between 1 and 2
    and (
      (
        p_provider_key = 'synthetic'
        and p_freshness_policy_version = 'synthetic_freshness_policy_v1'
        and p_retention_policy_version = 'synthetic_metadata_retention_v1'
      )
      or (
        p_provider_key = 'quickbooks_online'
        and p_freshness_policy_version = 'qbo_control_plane_freshness_policy_v1'
        and p_retention_policy_version = 'qbo_metadata_retention_v1'
      )
    );
$function$;

create or replace function private.is_phase_8a0_freshness_policy_v1(
  p_provider_key text,
  p_provider_environment text,
  p_domain text,
  p_policy_version text,
  p_current_max_age_seconds bigint,
  p_stale_after_seconds bigint,
  p_stale_blocking_level text
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
    and (
      (
        p_provider_key = 'synthetic'
        and p_domain = 'general_ledger'
        and p_policy_version = 'synthetic_freshness_policy_v1'
        and p_current_max_age_seconds = 3600
        and p_stale_after_seconds = 7200
        and p_stale_blocking_level = 'current_intelligence'
      )
      or (
        p_provider_key = 'quickbooks_online'
        and p_domain in (
          'change_hints',
          'company_configuration',
          'financial_transactions',
          'master_records',
          'report_control_observations'
        )
        and p_policy_version = 'qbo_control_plane_freshness_policy_v1'
        and p_current_max_age_seconds between 60 and 86400
        and p_stale_after_seconds > p_current_max_age_seconds
        and p_stale_after_seconds <= 604800
        and p_stale_blocking_level in ('current_intelligence', 'all_derived')
      )
    );
$function$;

create or replace function private.is_phase_8a0_activation_trigger_v1(
  p_provider_key text,
  p_trigger_kind text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select (p_provider_key = 'synthetic' and p_trigger_kind = 'synthetic_verification')
    or (
      p_provider_key = 'quickbooks_online'
      and p_trigger_kind = 'provider_initialization'
    );
$function$;

-- Keep Phase 4 helper signatures for already-created constraints while
-- restricting accepted values to the two reviewed provider descriptors.
create or replace function private.is_phase_4_provider_descriptor_v1(
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
set search_path = ''
as $function$
  select private.is_phase_8a0_provider_descriptor_v1(
    p_provider_key,
    p_provider_environment,
    p_registry_version,
    p_registry_fingerprint,
    p_descriptor_fingerprint,
    p_adapter_version
  );
$function$;

create or replace function private.is_phase_4_capability_snapshot_v1(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_phase_8a0_capability_snapshot_v1('synthetic', p_value)
    or private.is_phase_8a0_capability_snapshot_v1('quickbooks_online', p_value);
$function$;

create or replace function private.is_phase_4_scope_set_v1(p_values text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_phase_8a0_scope_set_v1('synthetic', p_values)
    or private.is_phase_8a0_scope_set_v1('quickbooks_online', p_values);
$function$;

create or replace function private.is_phase_4_freshness_policy_v1(
  p_provider_key text,
  p_provider_environment text,
  p_policy_version text,
  p_current_max_age_seconds bigint,
  p_stale_after_seconds bigint,
  p_stale_blocking_level text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select private.is_phase_8a0_freshness_policy_v1(
    p_provider_key,
    p_provider_environment,
    case when p_provider_key = 'synthetic' then 'general_ledger'
      else 'financial_transactions' end,
    p_policy_version,
    p_current_max_age_seconds,
    p_stale_after_seconds,
    p_stale_blocking_level
  );
$function$;

alter table private.integration_connections
  add constraint integration_connections_phase_8a0_registry_check check (
    private.is_phase_8a0_provider_descriptor_v1(
      provider_key,
      provider_environment,
      provider_descriptor_registry_version,
      provider_descriptor_registry_fingerprint,
      provider_descriptor_fingerprint,
      adapter_version
    )
    and private.is_phase_8a0_scope_set_v1(provider_key, requested_scopes)
    and private.is_phase_8a0_capability_snapshot_v1(
      provider_key,
      capability_snapshot
    )
  );

alter table public.integration_connection_summaries
  add constraint integration_connection_summaries_phase_8a0_registry_check check (
    private.is_phase_8a0_provider_environment_v1(
      provider_key,
      provider_environment
    )
    and private.is_phase_8a0_scope_set_v1(provider_key, requested_scopes)
    and private.is_phase_8a0_capability_snapshot_v1(
      provider_key,
      capability_snapshot
    )
  );

alter table private.provider_entity_mappings
  drop constraint provider_entity_mappings_verification_mode_check;
alter table private.provider_entity_mappings
  add constraint provider_entity_mappings_phase_8a0_registry_check check (
    private.is_phase_8a0_provider_environment_v1(
      provider_key,
      provider_environment
    )
    and (
      (provider_key = 'synthetic' and verification_mode = 'synthetic_phase_4')
      or (
        provider_key = 'quickbooks_online'
        and verification_mode = 'qbo_realm_mapping_v1'
      )
    )
  );

create or replace function private.set_phase_8a0_mapping_verification_mode_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.verification_mode := case new.provider_key
    when 'synthetic' then 'synthetic_phase_4'
    when 'quickbooks_online' then 'qbo_realm_mapping_v1'
    else new.verification_mode
  end;
  return new;
end;
$function$;

create trigger set_phase_8a0_mapping_verification_mode_v1
before insert on private.provider_entity_mappings
for each row execute function private.set_phase_8a0_mapping_verification_mode_v1();

alter table private.integration_workspace_policies
  drop constraint integration_workspace_policies_synthetic_check;
alter table private.integration_workspace_policies
  add constraint integration_workspace_policies_phase_8a0_registry_check check (
    private.is_phase_8a0_workspace_policy_v1(
      provider_key,
      provider_environment,
      maximum_concurrency,
      freshness_policy_version,
      retention_policy_version
    )
  );

alter table private.integration_sync_runs
  drop constraint integration_sync_runs_trigger_kind_check;
alter table private.integration_sync_runs
  add constraint integration_sync_runs_trigger_kind_check check (
    trigger_kind in (
      'synthetic_verification',
      'provider_initialization',
      'manual',
      'recovery'
    )
  );

alter table private.integration_oauth_states
  drop constraint integration_oauth_states_provider_environment_check;
alter table private.integration_oauth_states
  add constraint integration_oauth_states_provider_environment_check check (
    private.is_phase_8a0_provider_environment_v1(
      provider_key,
      provider_environment
    )
  );
alter table private.integration_oauth_states
  add constraint integration_oauth_states_phase_8a0_scope_check check (
    private.is_phase_8a0_scope_set_v1(provider_key, requested_scopes)
  );

alter table private.integration_credentials
  drop constraint integration_credentials_provider_environment_check;
alter table private.integration_credentials
  add constraint integration_credentials_provider_environment_check check (
    private.is_phase_8a0_provider_environment_v1(
      provider_key,
      provider_environment
    )
  );
alter table private.integration_credentials
  add constraint integration_credentials_phase_8a0_scope_check check (
    private.is_phase_8a0_scope_set_v1(provider_key, granted_scopes)
  );

create or replace function public.create_integration_oauth_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_connection private.integration_connections;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_created_at timestamptz;
  v_expires_at timestamptz;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();

  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'returnIntent',
        'stateHash',
        'createdAt',
        'expiresAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_oauth_state_v1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'providerKey') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or not private.is_phase_8a0_provider_environment_v1(
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment'
    )
    or not private.is_phase_5_return_intent_v1(
      p_command ->> 'returnIntent'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes)
    or not private.is_phase_8a0_scope_set_v1(
      p_command ->> 'providerKey',
      v_scopes
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_created_at := (p_command ->> 'createdAt')::timestamptz;
  v_expires_at := (p_command ->> 'expiresAt')::timestamptz;
  if v_expires_at <= v_created_at
    or v_expires_at > v_created_at + interval '10 minutes' then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_expiry_invalid';
  end if;
  v_expires_at := pg_catalog.transaction_timestamp()
    + (v_expires_at - v_created_at);
  v_created_at := pg_catalog.transaction_timestamp();

  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select state.*
  into v_state
  from private.integration_oauth_states as state
  where state.creation_request_id = p_request_id;
  if found then
    if v_state.creation_request_fingerprint <> v_request_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'integration_oauth_state_request_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stateId', v_state.id,
      'idempotent', true
    );
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id = (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = p_command ->> 'providerKey'
    and connection.provider_environment = p_command ->> 'providerEnvironment'
  for share;
  if not found or v_connection.status <> 'pending_authorization' then
    raise exception using
      errcode = '42501',
      message = 'integration_oauth_state_connection_denied';
  end if;
  if v_connection.requested_scopes <> v_scopes
    or not exists (
      select 1
      from public.workspace_members as member
      where member.workspace_id = v_connection.workspace_id
        and member.user_id = (p_command ->> 'initiatedBy')::uuid
        and member.status = 'active'
        and member.role in ('owner', 'admin', 'manager')
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_oauth_state_initiator_denied';
  end if;

  insert into private.integration_oauth_states (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment,
    initiated_by,
    requested_scopes,
    return_intent,
    state_hash,
    status,
    creation_request_id,
    creation_request_fingerprint,
    created_at,
    expires_at,
    row_version
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_oauth_state_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_connection.connection_generation,
    v_connection.provider_key,
    v_connection.provider_environment,
    (p_command ->> 'initiatedBy')::uuid,
    v_scopes,
    p_command ->> 'returnIntent',
    v_state_hash,
    'pending',
    p_request_id,
    v_request_fingerprint,
    v_created_at,
    v_expires_at,
    1
  ) returning * into v_state;

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    'user',
    v_state.initiated_by::text,
    'oauth_state_created',
    'succeeded',
    'oauth_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status,
      'idempotent', false
    ),
    v_state.created_at
  );

  return pg_catalog.jsonb_build_object(
    'stateId', v_state.id,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_payload_invalid';
end;
$function$;

create or replace function public.consume_integration_oauth_state_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_scopes text[];
  v_state_hash bytea;
  v_request_fingerprint bytea;
  v_consumed_at timestamptz;
  v_reason text;
begin
  perform private.assert_integration_oauth_ingress_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'requestedScopes',
        'returnIntent',
        'stateHash',
        'consumedAt'
      ]
    )
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'providerKey') !~ '^[a-z][a-z0-9_-]{0,63}$'
    or not private.is_bounded_identifier_v1(
      p_command ->> 'providerEnvironment'
    )
    or not private.is_phase_5_return_intent_v1(
      p_command ->> 'returnIntent'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_consume_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'requestedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes) then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_scope_invalid';
  end if;
  v_state_hash := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'stateHash'
  );
  v_consumed_at := (p_command ->> 'consumedAt')::timestamptz;
  v_consumed_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select state.*
  into v_state
  from private.integration_oauth_states as state
  where state.state_hash = v_state_hash
  for update;
  if not found then
    perform private.phase_5_insert_audit_v1(
      null,
      null,
      null,
      'user',
      p_command ->> 'initiatedBy',
      'oauth_state_rejected',
      'denied',
      'oauth_state',
      null,
      p_request_id,
      'state_missing',
      pg_catalog.jsonb_build_object('oauth_state_status', 'missing'),
      v_consumed_at
    );
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', 'state_missing'
    );
  end if;

  if v_state.status = 'consumed' then
    v_reason := 'state_replayed';
  elsif v_state.status = 'expired' or v_consumed_at >= v_state.expires_at then
    v_reason := 'state_expired';
  elsif v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <> (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes
    or v_state.return_intent <> p_command ->> 'returnIntent'
    or not exists (
      select 1
      from private.integration_connections as connection
      where connection.workspace_id = v_state.workspace_id
        and connection.business_entity_id = v_state.business_entity_id
        and connection.id = v_state.connection_id
        and connection.connection_generation = v_state.connection_generation
        and connection.provider_key = v_state.provider_key
        and connection.provider_environment = v_state.provider_environment
        and connection.status = 'pending_authorization'
    ) then
    v_reason := 'state_invalid';
  end if;

  if v_reason is not null then
    if v_reason = 'state_expired' and v_state.status = 'pending' then
      update private.integration_oauth_states
      set status = 'expired',
          row_version = row_version + 1
      where id = v_state.id
      returning * into v_state;
    end if;
    perform private.phase_5_insert_audit_v1(
      v_state.workspace_id,
      v_state.business_entity_id,
      v_state.connection_id,
      'user',
      v_state.initiated_by::text,
      'oauth_state_rejected',
      'denied',
      'oauth_state',
      v_state.id::text,
      p_request_id,
      v_reason,
      pg_catalog.jsonb_build_object(
        'connection_generation', v_state.connection_generation,
        'oauth_state_status', v_state.status
      ),
      v_consumed_at
    );
    return pg_catalog.jsonb_build_object(
      'accepted', false,
      'reasonCode', v_reason
    );
  end if;

  update private.integration_oauth_states
  set status = 'consumed',
      consume_request_id = p_request_id,
      consume_request_fingerprint = v_request_fingerprint,
      consumed_at = v_consumed_at,
      row_version = row_version + 1
  where id = v_state.id
  returning * into v_state;

  perform private.phase_5_insert_audit_v1(
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    'user',
    v_state.initiated_by::text,
    'oauth_state_consumed',
    'succeeded',
    'oauth_state',
    v_state.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_state.connection_generation,
      'oauth_state_status', v_state.status
    ),
    v_consumed_at
  );

  return pg_catalog.jsonb_build_object(
    'accepted', true,
    'stateId', v_state.id,
    'workspaceId', v_state.workspace_id,
    'businessEntityId', v_state.business_entity_id,
    'connectionId', v_state.connection_id,
    'connectionGeneration', v_state.connection_generation,
    'providerKey', v_state.provider_key,
    'providerEnvironment', v_state.provider_environment,
    'requestedScopes', pg_catalog.to_jsonb(v_state.requested_scopes),
    'returnIntent', v_state.return_intent
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_oauth_state_consume_payload_invalid';
end;
$function$;

create or replace function public.store_integration_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state private.integration_oauth_states;
  v_connection private.integration_connections;
  v_credential private.integration_credentials;
  v_scopes text[];
  v_ciphertext bytea;
  v_aad_digest bytea;
  v_external_fingerprint bytea;
  v_request_fingerprint bytea;
  v_authorized_at timestamptz;
  v_access_expires_at timestamptz;
  v_refresh_expires_at timestamptz;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'oauthStateId',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'connectionGeneration',
        'providerKey',
        'providerEnvironment',
        'initiatedBy',
        'expectedConnectionRowVersion',
        'credentialVersion',
        'envelopeSchemaVersion',
        'aadSchemaVersion',
        'aadDigest',
        'kmsKeyResource',
        'ciphertextBase64',
        'accessExpiresAt',
        'refreshExpiresAt',
        'grantedScopes',
        'externalEntityReferenceFingerprint',
        'authorizedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_credential_authority_v1'
    or p_command ->> 'envelopeSchemaVersion' <>
      'oauth_credential_envelope_v1'
    or p_command ->> 'aadSchemaVersion' <> 'oauth_credential_aad_v1'
    or p_command ->> 'credentialVersion' <> '1'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedConnectionRowVersion') !~ '^[1-9][0-9]*$'
    or not private.is_phase_8a0_provider_environment_v1(
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment'
    )
    or not private.is_phase_5_kms_key_resource_v1(
      p_command ->> 'kmsKeyResource'
    )
    or (p_command ->> 'ciphertextBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.char_length(p_command ->> 'ciphertextBase64') > 131072 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_payload_invalid';
  end if;

  v_scopes := private.phase_5_text_array_v1(p_command -> 'grantedScopes');
  if not private.is_phase_5_scope_set_v1(v_scopes)
    or not private.is_phase_8a0_scope_set_v1(
      p_command ->> 'providerKey',
      v_scopes
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_scope_invalid';
  end if;
  begin
    v_ciphertext := pg_catalog.decode(
      p_command ->> 'ciphertextBase64',
      'base64'
    );
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end;
  if pg_catalog.octet_length(v_ciphertext) not between 16 and 98304 then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_ciphertext_invalid';
  end if;
  v_aad_digest := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'aadDigest'
  );
  v_external_fingerprint := case
    when p_command -> 'externalEntityReferenceFingerprint' = 'null'::jsonb
      then null
    else private.sha256_fingerprint_bytes_v1(
      p_command ->> 'externalEntityReferenceFingerprint'
    )
  end;
  v_authorized_at := (p_command ->> 'authorizedAt')::timestamptz;
  v_access_expires_at := (p_command ->> 'accessExpiresAt')::timestamptz;
  v_refresh_expires_at := case
    when p_command -> 'refreshExpiresAt' = 'null'::jsonb then null
    else (p_command ->> 'refreshExpiresAt')::timestamptz
  end;
  if v_access_expires_at <= v_authorized_at
    or (
      v_refresh_expires_at is not null
      and v_refresh_expires_at <= v_authorized_at
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_expiry_invalid';
  end if;
  v_access_expires_at := pg_catalog.transaction_timestamp()
    + (v_access_expires_at - v_authorized_at);
  v_refresh_expires_at := case
    when v_refresh_expires_at is null then null
    else pg_catalog.transaction_timestamp()
      + (v_refresh_expires_at - v_authorized_at)
  end;
  v_authorized_at := pg_catalog.transaction_timestamp();
  v_request_fingerprint := private.phase_5_request_fingerprint_v1(
    p_request_id,
    p_command
  );

  select credential.*
  into v_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'id')::uuid
     or credential.oauth_state_id = (p_command ->> 'oauthStateId')::uuid
  for update;
  if found then
    if v_credential.last_request_id = p_request_id
      and v_credential.last_request_fingerprint = v_request_fingerprint then
      select connection.*
      into v_connection
      from private.integration_connections as connection
      where connection.id = v_credential.connection_id;
      return pg_catalog.jsonb_build_object(
        'credentialId', v_credential.id,
        'credentialVersion', v_credential.credential_version,
        'credentialStatus', v_credential.status,
        'connectionStatus', v_connection.status,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_credential_request_conflict';
  end if;

  select state.*
  into v_state
  from private.integration_oauth_states as state
  where state.id = (p_command ->> 'oauthStateId')::uuid
  for update;
  if not found
    or v_state.status <> 'consumed'
    or v_state.workspace_id <> (p_command ->> 'workspaceId')::uuid
    or v_state.business_entity_id <> (p_command ->> 'businessEntityId')::uuid
    or v_state.connection_id <> (p_command ->> 'connectionId')::uuid
    or v_state.connection_generation <>
      (p_command ->> 'connectionGeneration')::bigint
    or v_state.provider_key <> p_command ->> 'providerKey'
    or v_state.provider_environment <> p_command ->> 'providerEnvironment'
    or v_state.initiated_by <> (p_command ->> 'initiatedBy')::uuid
    or v_state.requested_scopes <> v_scopes then
    raise exception using
      errcode = '42501',
      message = 'integration_credential_oauth_state_denied';
  end if;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_state.workspace_id
    and connection.business_entity_id = v_state.business_entity_id
    and connection.id = v_state.connection_id
    and connection.connection_generation = v_state.connection_generation
    and connection.provider_key = v_state.provider_key
    and connection.provider_environment = v_state.provider_environment
  for update;
  if not found
    or v_connection.status <> 'pending_authorization'
    or v_connection.row_version <>
      (p_command ->> 'expectedConnectionRowVersion')::bigint
    or v_connection.requested_scopes <> v_scopes
    or v_authorized_at < v_state.consumed_at then
    raise exception using
      errcode = '40001',
      message = 'integration_credential_connection_stale';
  end if;
  if v_aad_digest <> private.phase_5_credential_aad_digest_v1(
    v_state.provider_environment,
    v_state.workspace_id,
    v_state.connection_id,
    v_state.connection_generation,
    v_state.provider_key,
    (p_command ->> 'id')::uuid
  ) then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_aad_invalid';
  end if;

  insert into private.integration_credentials (
    id,
    contract_version,
    oauth_state_id,
    workspace_id,
    business_entity_id,
    connection_id,
    connection_generation,
    provider_key,
    provider_environment,
    initiated_by,
    credential_version,
    envelope_schema_version,
    aad_schema_version,
    aad_digest,
    kms_key_resource,
    credential_ciphertext,
    access_expires_at,
    refresh_expires_at,
    granted_scopes,
    external_entity_reference_fingerprint,
    status,
    last_request_id,
    last_request_fingerprint,
    row_version,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_credential_authority_v1',
    v_state.id,
    v_state.workspace_id,
    v_state.business_entity_id,
    v_state.connection_id,
    v_state.connection_generation,
    v_state.provider_key,
    v_state.provider_environment,
    v_state.initiated_by,
    1,
    'oauth_credential_envelope_v1',
    'oauth_credential_aad_v1',
    v_aad_digest,
    p_command ->> 'kmsKeyResource',
    v_ciphertext,
    v_access_expires_at,
    v_refresh_expires_at,
    v_scopes,
    v_external_fingerprint,
    'active',
    p_request_id,
    v_request_fingerprint,
    1,
    v_authorized_at,
    v_authorized_at
  ) returning * into v_credential;

  update private.integration_connections
  set provider_tenant_reference_fingerprint = v_external_fingerprint,
      status = 'authorized_unmapped',
      state_reason_code = 'mapping_required',
      granted_scopes = v_scopes,
      authorized_at = v_authorized_at,
      status_changed_at = v_authorized_at,
      last_transition_request_id = p_request_id,
      last_transition_request_fingerprint = v_request_fingerprint,
      row_version = row_version + 1,
      updated_at = v_authorized_at
  where id = v_connection.id
  returning * into v_connection;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_encrypted',
    'succeeded',
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    'authorized',
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'connection_status', v_connection.status,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'idempotent', false
    ),
    v_authorized_at
  );

  return pg_catalog.jsonb_build_object(
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'credentialStatus', v_credential.status,
    'connectionStatus', v_connection.status,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_credential_payload_invalid';
end;
$function$;

create or replace function public.read_integration_provider_credential_v1(
  p_command jsonb,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task private.integration_sync_tasks;
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_credential private.integration_credentials;
  v_required_scopes text[];
  v_lease_owner_fingerprint bytea;
  v_mapping_id uuid;
  v_minimum_validity_seconds integer;
  v_state text;
  v_now timestamptz := pg_catalog.transaction_timestamp();
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'taskId',
        'leaseId',
        'leaseOwnerFingerprint',
        'expectedCredentialVersion',
        'requiredScopes',
        'minimumValiditySeconds',
        'requestedAt'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_provider_credential_read_v1'
    or (p_command ->> 'expectedCredentialVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'minimumValiditySeconds') !~ '^[1-9][0-9]*$' then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_payload_invalid';
  end if;

  perform (p_command ->> 'requestedAt')::timestamptz;
  v_minimum_validity_seconds :=
    (p_command ->> 'minimumValiditySeconds')::integer;
  if v_minimum_validity_seconds not between 30 and 900 then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_safety_window_invalid';
  end if;
  v_required_scopes := private.phase_5_text_array_v1(
    p_command -> 'requiredScopes'
  );
  v_lease_owner_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'leaseOwnerFingerprint'
  );

  select task.*
  into v_task
  from private.integration_sync_tasks as task
  where task.id = (p_command ->> 'taskId')::uuid
  for share;
  if not found
    or v_task.state <> 'leased'
    or v_task.queue_class not in ('provider_interactive', 'provider_bulk')
    or v_task.lease_id <> (p_command ->> 'leaseId')::uuid
    or v_task.lease_owner_fingerprint <> v_lease_owner_fingerprint
    or v_task.lease_expires_at <= v_now
    or v_task.control_metadata -> 'mappingId' = 'null'::jsonb then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;
  v_mapping_id := (v_task.control_metadata ->> 'mappingId')::uuid;

  select connection.*
  into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = v_task.workspace_id
    and connection.business_entity_id = v_task.business_entity_id
    and connection.id = v_task.connection_id
    and connection.connection_generation = v_task.connection_generation
    and connection.provider_key = v_task.provider_key
    and connection.provider_environment = v_task.provider_environment
    and connection.status in ('initializing', 'active', 'degraded')
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  select mapping.*
  into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_task.workspace_id
    and mapping.business_entity_id = v_task.business_entity_id
    and mapping.connection_id = v_task.connection_id
    and mapping.id = v_mapping_id
    and mapping.provider_key = v_task.provider_key
    and mapping.provider_environment = v_task.provider_environment
    and mapping.status = 'active'
  for share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  if not private.is_phase_5_scope_set_v1(v_required_scopes)
    or not private.is_phase_8a0_scope_set_v1(
      v_task.provider_key,
      v_required_scopes
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
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
  for share;
  if not found
    or v_credential.status <> 'active'
    or v_credential.credential_ciphertext is null
    or not v_required_scopes <@ v_credential.granted_scopes then
    raise exception using
      errcode = '42501',
      message = 'integration_provider_credential_read_denied';
  end if;

  v_state := case
    when v_credential.credential_version <>
      (p_command ->> 'expectedCredentialVersion')::bigint
      then 'credential_version_stale'
    when v_credential.access_expires_at <= v_now
      + pg_catalog.make_interval(secs => v_minimum_validity_seconds)
      then 'refresh_required'
    else 'available'
  end;

  perform private.phase_5_insert_audit_v1(
    v_credential.workspace_id,
    v_credential.business_entity_id,
    v_credential.connection_id,
    'service',
    'integration_credential_broker',
    'credential_provider_read',
    case when v_state = 'available' then 'allowed' else 'denied' end,
    'integration_credential',
    v_credential.id::text,
    p_request_id,
    case
      when v_state = 'available' then 'authorized'
      when v_state = 'refresh_required' then 'credential_expired'
      else 'credential_version_stale'
    end,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_credential.connection_generation,
      'credential_status', v_credential.status,
      'credential_version', v_credential.credential_version,
      'task_state', v_task.state
    ),
    v_now
  );

  return pg_catalog.jsonb_build_object(
    'state', v_state,
    'credentialId', v_credential.id,
    'credentialVersion', v_credential.credential_version,
    'providerKey', v_credential.provider_key,
    'providerEnvironment', v_credential.provider_environment,
    'accessExpiresAt', pg_catalog.to_char(
      v_credential.access_expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) || case when v_state <> 'available' then '{}'::jsonb else
    pg_catalog.jsonb_build_object(
      'ciphertextBase64', pg_catalog.encode(
        v_credential.credential_ciphertext,
        'base64'
      ),
      'aadDigest', private.phase_5_fingerprint_text_v1(
        v_credential.aad_digest
      ),
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
      'grantedScopes', pg_catalog.to_jsonb(v_credential.granted_scopes)
    ) end;
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_provider_credential_read_payload_invalid';
end;
$function$;

create or replace function public.upsert_integration_workspace_policy_v1(
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
  v_policy private.integration_workspace_policies;
  v_request_fingerprint bytea;
  v_now timestamptz := pg_catalog.transaction_timestamp();
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'providerKey',
        'providerEnvironment',
        'state',
        'syncEnabled',
        'historyHorizonDays',
        'maximumConcurrency',
        'freshnessPolicyVersion',
        'retentionPolicyVersion',
        'rowVersion'
      ]
    )
    or p_command ->> 'contractVersion' <>
      'integration_workspace_policy_v1'
    or p_command ->> 'state' not in ('enabled', 'paused', 'disabled')
    or pg_catalog.jsonb_typeof(p_command -> 'syncEnabled') <> 'boolean'
    or ((p_command ->> 'state') = 'enabled') <>
      ((p_command ->> 'syncEnabled')::boolean)
    or (p_command ->> 'historyHorizonDays')::integer not between 1 and 3650
    or (p_command ->> 'rowVersion')::bigint <= 0
    or not private.is_phase_8a0_workspace_policy_v1(
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment',
      (p_command ->> 'maximumConcurrency')::integer,
      p_command ->> 'freshnessPolicyVersion',
      p_command ->> 'retentionPolicyVersion'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_workspace_policy_payload_invalid';
  end if;
  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = (p_command ->> 'workspaceId')::uuid
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_workspace_policy_denied';
  end if;

  v_request_fingerprint := private.phase_4_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  select policy.*
  into v_policy
  from private.integration_workspace_policies as policy
  where policy.workspace_id = (p_command ->> 'workspaceId')::uuid
    and policy.provider_key = p_command ->> 'providerKey'
    and policy.provider_environment = p_command ->> 'providerEnvironment'
  for update;

  if found then
    if v_policy.last_request_id = p_request_id
      and v_policy.last_request_fingerprint = v_request_fingerprint then
      return pg_catalog.jsonb_build_object(
        'policyId', v_policy.id,
        'rowVersion', v_policy.row_version,
        'idempotent', true,
        'updatedAt', pg_catalog.to_char(
          v_policy.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      );
    end if;
    if v_policy.id <> (p_command ->> 'id')::uuid then
      raise exception using
        errcode = '23505',
        message = 'integration_workspace_policy_conflict';
    end if;
    if v_policy.row_version <> (p_command ->> 'rowVersion')::bigint then
      raise exception using
        errcode = '40001',
        message = 'integration_workspace_policy_row_version_stale';
    end if;
    update private.integration_workspace_policies as policy
    set
      state = p_command ->> 'state',
      sync_enabled = (p_command ->> 'syncEnabled')::boolean,
      history_horizon_days = (p_command ->> 'historyHorizonDays')::integer,
      maximum_concurrency = (p_command ->> 'maximumConcurrency')::integer,
      freshness_policy_version = p_command ->> 'freshnessPolicyVersion',
      retention_policy_version = p_command ->> 'retentionPolicyVersion',
      last_request_id = p_request_id,
      last_request_fingerprint = v_request_fingerprint,
      row_version = policy.row_version + 1,
      updated_at = v_now
    where policy.id = v_policy.id
    returning policy.* into v_policy;
  else
    if (p_command ->> 'rowVersion')::bigint <> 1 then
      raise exception using
        errcode = '40001',
        message = 'integration_workspace_policy_row_version_stale';
    end if;
    insert into private.integration_workspace_policies (
      id,
      contract_version,
      workspace_id,
      provider_key,
      provider_environment,
      state,
      sync_enabled,
      history_horizon_days,
      maximum_concurrency,
      freshness_policy_version,
      retention_policy_version,
      row_version,
      last_request_id,
      last_request_fingerprint,
      created_at,
      updated_at
    ) values (
      (p_command ->> 'id')::uuid,
      'integration_workspace_policy_v1',
      (p_command ->> 'workspaceId')::uuid,
      p_command ->> 'providerKey',
      p_command ->> 'providerEnvironment',
      p_command ->> 'state',
      (p_command ->> 'syncEnabled')::boolean,
      (p_command ->> 'historyHorizonDays')::integer,
      (p_command ->> 'maximumConcurrency')::integer,
      p_command ->> 'freshnessPolicyVersion',
      p_command ->> 'retentionPolicyVersion',
      1,
      p_request_id,
      v_request_fingerprint,
      v_now,
      v_now
    ) returning * into v_policy;
  end if;

  insert into private.integration_audit_events (
    workspace_id,
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
    v_policy.workspace_id,
    'service',
    p_actor_id,
    'integration_workspace_policy.upsert',
    'succeeded',
    'integration_workspace_policy',
    v_policy.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'policy_state', v_policy.state,
      'row_version', v_policy.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'policyId', v_policy.id,
    'rowVersion', v_policy.row_version,
    'idempotent', false,
    'updatedAt', pg_catalog.to_char(
      v_policy.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_workspace_policy_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_workspace_policy_payload_invalid';
end;
$function$;

-- Preserve the Phase 4 lifecycle while selecting initialization evidence
-- from the exact reviewed provider registry.
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
        where not exists (
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
            and freshness.domain = required.stream_key
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

create or replace function public.create_integration_sync_run_v1(
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
  v_run private.integration_sync_runs;
  v_idempotency_fingerprint bytea;
  v_request_fingerprint bytea;
  v_mapping_id uuid;
  v_window_start_at timestamptz;
  v_window_end_at timestamptz;
  v_expected_policy text;
  v_expected_initial_trigger text;
begin
  perform private.assert_integration_control_plane_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion',
        'id',
        'workspaceId',
        'businessEntityId',
        'connectionId',
        'mappingId',
        'trigger',
        'mode',
        'idempotencyFingerprint',
        'windowStartAt',
        'windowEndAt',
        'providerContractVersion',
        'adapterVersion',
        'policyVersion',
        'createdAt'
      ]
    )
    or p_command ->> 'contractVersion' <> 'integration_sync_run_v1'
    or p_command ->> 'trigger' not in (
      'synthetic_verification',
      'provider_initialization',
      'manual',
      'recovery'
    )
    or p_command ->> 'mode' not in (
      'initialization', 'incremental', 'backfill', 'verification'
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_payload_invalid';
  end if;

  v_mapping_id := case
    when p_command -> 'mappingId' = 'null'::jsonb then null
    else (p_command ->> 'mappingId')::uuid
  end;
  v_window_start_at := case
    when p_command -> 'windowStartAt' = 'null'::jsonb then null
    else (p_command ->> 'windowStartAt')::timestamptz
  end;
  v_window_end_at := case
    when p_command -> 'windowEndAt' = 'null'::jsonb then null
    else (p_command ->> 'windowEndAt')::timestamptz
  end;
  if (v_window_start_at is null) <> (v_window_end_at is null)
    or (
      v_window_start_at is not null
      and v_window_end_at < v_window_start_at
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_window_invalid';
  end if;
  v_idempotency_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_command ->> 'idempotencyFingerprint'
  );
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
  if not found
    or v_connection.status not in ('initializing', 'active', 'degraded') then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  v_expected_policy := case v_connection.provider_key
    when 'synthetic' then 'synthetic_sync_policy_v1'
    when 'quickbooks_online' then 'qbo_historical_sync_policy_v1'
    else null
  end;
  v_expected_initial_trigger := case v_connection.provider_key
    when 'synthetic' then 'synthetic_verification'
    when 'quickbooks_online' then 'provider_initialization'
    else null
  end;
  if p_command ->> 'providerContractVersion' <> 'provider_adapter_v1'
    or p_command ->> 'adapterVersion' <> v_connection.adapter_version
    or p_command ->> 'policyVersion' <> v_expected_policy
    or not exists (
      select 1
      from private.integration_workspace_policies as policy
      where policy.workspace_id = v_connection.workspace_id
        and policy.provider_key = v_connection.provider_key
        and policy.provider_environment = v_connection.provider_environment
        and policy.state = 'enabled'
        and policy.sync_enabled
    ) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  if v_mapping_id is not null and not exists (
    select 1
    from private.provider_entity_mappings as mapping
    where mapping.workspace_id = v_connection.workspace_id
      and mapping.business_entity_id = v_connection.business_entity_id
      and mapping.connection_id = v_connection.id
      and mapping.id = v_mapping_id
      and mapping.provider_key = v_connection.provider_key
      and mapping.provider_environment = v_connection.provider_environment
      and mapping.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'integration_sync_run_denied';
  end if;
  if p_command ->> 'mode' = 'initialization'
    and (
      p_command ->> 'trigger' <> v_expected_initial_trigger
      or v_mapping_id is null
    ) then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_initialization_invalid';
  end if;

  select run.*
  into v_run
  from private.integration_sync_runs as run
  where run.workspace_id = v_connection.workspace_id
    and run.business_entity_id = v_connection.business_entity_id
    and run.connection_id = v_connection.id
    and run.idempotency_fingerprint = v_idempotency_fingerprint
  for update;
  if found then
    if v_run.id = (p_command ->> 'id')::uuid
      and v_run.mapping_id is not distinct from v_mapping_id
      and v_run.trigger_kind = p_command ->> 'trigger'
      and v_run.mode = p_command ->> 'mode' then
      return pg_catalog.jsonb_build_object(
        'syncRunId', v_run.id,
        'state', v_run.state,
        'rowVersion', v_run.row_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'integration_sync_run_idempotency_conflict';
  end if;

  insert into private.integration_sync_runs (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    mapping_id,
    connection_generation,
    trigger_kind,
    mode,
    state,
    idempotency_fingerprint,
    window_start_at,
    window_end_at,
    provider_contract_version,
    adapter_version,
    policy_version,
    last_transition_request_id,
    last_transition_request_fingerprint,
    created_at,
    updated_at
  ) values (
    (p_command ->> 'id')::uuid,
    'integration_sync_run_v1',
    v_connection.workspace_id,
    v_connection.business_entity_id,
    v_connection.id,
    v_mapping_id,
    v_connection.connection_generation,
    p_command ->> 'trigger',
    p_command ->> 'mode',
    'created',
    v_idempotency_fingerprint,
    v_window_start_at,
    v_window_end_at,
    p_command ->> 'providerContractVersion',
    p_command ->> 'adapterVersion',
    p_command ->> 'policyVersion',
    p_request_id,
    v_request_fingerprint,
    (p_command ->> 'createdAt')::timestamptz,
    (p_command ->> 'createdAt')::timestamptz
  ) returning * into v_run;

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
    v_run.workspace_id,
    v_run.business_entity_id,
    v_run.connection_id,
    'service',
    p_actor_id,
    'integration_sync_run.create',
    'succeeded',
    'integration_sync_run',
    v_run.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'connection_generation', v_run.connection_generation,
      'sync_run_state', v_run.state,
      'row_version', v_run.row_version,
      'idempotent', false
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'syncRunId', v_run.id,
    'state', v_run.state,
    'rowVersion', v_run.row_version,
    'idempotent', false
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'integration_sync_run_idempotency_conflict';
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'integration_sync_run_payload_invalid';
end;
$function$;

revoke all on function private.assert_integration_provider_source_authority_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_provider_environment_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_scope_set_v1(text, text[])
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_capability_snapshot_v1(text, jsonb)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_provider_descriptor_v1(
  text,
  text,
  text,
  bytea,
  bytea,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_workspace_policy_v1(
  text,
  text,
  integer,
  text,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_freshness_policy_v1(
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.is_phase_8a0_activation_trigger_v1(text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
revoke all on function private.set_phase_8a0_mapping_verification_mode_v1()
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;

revoke all on table private.external_source_records,
  private.external_source_record_versions,
  private.integration_connections,
  private.provider_entity_mappings,
  private.integration_sync_runs,
  private.integration_sync_tasks,
  private.integration_credentials,
  private.integration_oauth_states,
  private.integration_workspace_policies,
  private.integration_freshness_states,
  private.canonical_business_facts,
  private.canonical_business_fact_versions,
  private.fact_contribution_batches,
  private.fact_contribution_events,
  private.deterministic_change_sets,
  private.deterministic_aggregate_states,
  private.dependency_dirty_nodes
from integration_provider_source_authority;

revoke all on function public.create_integration_oauth_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.create_integration_oauth_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;

revoke all on function public.consume_integration_oauth_state_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.consume_integration_oauth_state_v1(jsonb, text)
  to integration_oauth_ingress_authority;

revoke all on function public.store_integration_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.store_integration_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.read_integration_provider_credential_v1(jsonb, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.read_integration_provider_credential_v1(jsonb, text)
  to integration_credential_broker_authority;

revoke all on function public.transition_integration_connection_v1(
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.transition_integration_connection_v1(
  jsonb,
  text,
  text
) to integration_control_plane_authority;

revoke all on function public.upsert_integration_workspace_policy_v1(
  jsonb,
  text,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.upsert_integration_workspace_policy_v1(
  jsonb,
  text,
  text
) to integration_control_plane_authority;

revoke all on function public.create_integration_sync_run_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.create_integration_sync_run_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.upsert_integration_freshness_v1(jsonb, text, text)
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority;
grant execute on function public.upsert_integration_freshness_v1(jsonb, text, text)
  to integration_control_plane_authority;

revoke all on function public.commit_provider_external_source_record_version_v1(
  jsonb,
  text
) from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority, integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority;
grant execute on function public.commit_provider_external_source_record_version_v1(
  jsonb,
  text
) to integration_provider_source_authority;

commit;
