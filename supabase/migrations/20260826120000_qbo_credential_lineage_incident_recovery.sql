-- Phase 8B credential-envelope incident recovery lineage convergence.
--
-- Refreshes advance credential_version on one immutable credential row. A
-- reauthorization creates a different row linked through supersedes_credential_id.
-- This recovery contract therefore uses integration_credentials.id as its
-- refresh-lineage anchor and proves every version advance with immutable refresh
-- audit evidence. It does not authorize recovery across reauthorization rows.

begin;

create table private.integration_sync_task_credential_lineage_recovery_events (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (
    contract_version =
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v2'
  ),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid not null,
  connection_generation bigint not null check (connection_generation > 0),
  sync_run_id uuid not null,
  task_id uuid not null,
  mapping_id uuid not null,
  credential_lineage_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  historical_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  historical_credential_version bigint not null check (
    historical_credential_version > 0
  ),
  current_credential_id uuid not null references
    private.integration_credentials(id) on delete restrict,
  current_credential_version bigint not null check (
    current_credential_version >= historical_credential_version
  ),
  current_credential_row_version bigint not null check (
    current_credential_row_version > 0
  ),
  credential_created_version bigint not null check (
    credential_created_version > 0
      and credential_created_version <= historical_credential_version
  ),
  refresh_advancement_count integer not null check (
    refresh_advancement_count >= 0
      and refresh_advancement_count =
        current_credential_version - historical_credential_version
  ),
  prior_expired_recovery_event_id uuid not null references
    private.integration_sync_task_recovery_events(id) on delete restrict,
  task_lease_audit_event_id uuid not null references
    private.integration_audit_events(id) on delete restrict,
  failure_audit_event_id uuid not null references
    private.integration_audit_events(id) on delete restrict,
  credential_read_audit_event_id uuid not null references
    private.integration_audit_events(id) on delete restrict,
  diagnostic_class text not null check (
    diagnostic_class = 'expires_at_binding'
  ),
  external_evidence_fingerprint bytea not null check (
    pg_catalog.octet_length(external_evidence_fingerprint) = 32
  ),
  prior_state text not null check (prior_state = 'failed'),
  prior_failure_category text not null check (
    prior_failure_category = 'contract'
  ),
  prior_failure_code text not null check (
    prior_failure_code = 'phase8b_provider_task_failed'
  ),
  prior_row_version bigint not null check (prior_row_version > 0),
  prior_completed_at timestamptz not null,
  prior_dispatch_generation bigint not null check (
    prior_dispatch_generation > 0
  ),
  prior_delivery_attribution_state text not null check (
    prior_delivery_attribution_state = 'attributed'
  ),
  prior_delivery_dispatch_generation bigint not null check (
    prior_delivery_dispatch_generation > 0
  ),
  prior_delivery_retry_count integer not null check (
    prior_delivery_retry_count between 0 and 100
  ),
  prior_delivery_execution_count integer not null check (
    prior_delivery_execution_count between 0 and prior_delivery_retry_count
  ),
  prior_delivery_attempt_fingerprint bytea not null check (
    pg_catalog.octet_length(prior_delivery_attempt_fingerprint) = 32
  ),
  prior_attempt_count integer not null check (prior_attempt_count > 0),
  retry_after_seconds integer not null check (
    retry_after_seconds between 1 and 3600
  ),
  reason_code text not null check (
    reason_code = 'credential_refresh_lineage_convergence'
  ),
  request_id text not null check (
    private.is_bounded_identifier_v1(request_id)
  ),
  request_fingerprint bytea not null check (
    pg_catalog.octet_length(request_fingerprint) = 32
  ),
  actor_id text not null check (private.is_bounded_identifier_v1(actor_id)),
  recovered_at timestamptz not null,
  created_at timestamptz not null,
  constraint integration_sync_task_credential_lineage_recovery_task_key
    unique (task_id),
  constraint integration_sync_task_credential_lineage_recovery_request_key
    unique (request_id),
  constraint integration_sync_task_credential_lineage_recovery_anchor_check
    check (
      credential_lineage_id = historical_credential_id
      and credential_lineage_id = current_credential_id
    ),
  constraint integration_sync_task_credential_lineage_recovery_task_fkey
    foreign key (workspace_id, business_entity_id, connection_id, task_id)
    references private.integration_sync_tasks(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_lineage_recovery_run_fkey
    foreign key (workspace_id, business_entity_id, connection_id, sync_run_id)
    references private.integration_sync_runs(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_lineage_recovery_mapping_fkey
    foreign key (workspace_id, business_entity_id, connection_id, mapping_id)
    references private.provider_entity_mappings(
      workspace_id, business_entity_id, connection_id, id
    ) on delete restrict,
  constraint integration_sync_task_credential_lineage_recovery_time_check
    check (recovered_at >= prior_completed_at and created_at = recovered_at)
);

create index integration_sync_task_credential_lineage_recovery_scope_idx
  on private.integration_sync_task_credential_lineage_recovery_events(
    workspace_id, business_entity_id, connection_id,
    connection_generation, recovered_at
  );

alter table private.integration_sync_task_credential_lineage_recovery_events
  enable row level security;
alter table private.integration_sync_task_credential_lineage_recovery_events
  force row level security;

revoke all on table
  private.integration_sync_task_credential_lineage_recovery_events
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;

create trigger reject_integration_sync_task_credential_lineage_recovery_mutation_v1
before update or delete
on private.integration_sync_task_credential_lineage_recovery_events
for each row execute function
  private.reject_external_integration_immutable_mutation_v1();

create or replace function
  public.recover_qbo_sandbox_credential_binding_incident_task_v2(
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
  v_connection private.integration_connections;
  v_mapping private.provider_entity_mappings;
  v_current_credential private.integration_credentials;
  v_predecessor private.integration_credentials;
  v_reauthorization_state private.integration_reauthorization_states;
  v_run private.integration_sync_runs;
  v_task private.integration_sync_tasks;
  v_previous_recovery private.integration_sync_task_recovery_events;
  v_task_lease_audit private.integration_audit_events;
  v_failure_audit private.integration_audit_events;
  v_credential_read_audit private.integration_audit_events;
  v_existing
    private.integration_sync_task_credential_lineage_recovery_events;
  v_request_fingerprint bytea;
  v_external_evidence_fingerprint bytea;
  v_historical_credential_version bigint;
  v_historical_persisted_at timestamptz;
  v_created_credential_version bigint;
  v_refresh_advancement_count integer;
begin
  perform private.assert_integration_credential_broker_authority_v1();
  if not private.is_bounded_identifier_v1(p_request_id)
    or not private.is_bounded_identifier_v1(p_actor_id)
    or not private.jsonb_has_exact_keys_v1(
      p_command,
      array[
        'contractVersion', 'workspaceId', 'businessEntityId',
        'connectionId', 'connectionGeneration', 'mappingId',
        'expectedMappingRowVersion', 'historicalCredentialId',
        'expectedHistoricalCredentialVersion', 'currentCredentialId',
        'expectedCurrentCredentialVersion',
        'expectedCurrentCredentialRowVersion', 'taskId',
        'expectedTaskRowVersion', 'expectedDispatchGeneration',
        'failureAuditEventId', 'credentialReadAuditEventId',
        'diagnosticClass', 'externalEvidenceFingerprint',
        'retryAfterSeconds'
      ]
    )
    or p_command ->> 'contractVersion' is null
    or p_command ->> 'contractVersion' <>
      'qbo_sandbox_credential_envelope_binding_incident_recovery_v2'
    or p_command ->> 'diagnosticClass' is null
    or p_command ->> 'diagnosticClass' <> 'expires_at_binding'
    or pg_catalog.jsonb_typeof(
      p_command -> 'connectionGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedMappingRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedHistoricalCredentialVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedCurrentCredentialVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedCurrentCredentialRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedTaskRowVersion'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'expectedDispatchGeneration'
    ) <> 'number'
    or pg_catalog.jsonb_typeof(
      p_command -> 'retryAfterSeconds'
    ) <> 'number'
    or (p_command ->> 'connectionGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedMappingRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedHistoricalCredentialVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCurrentCredentialVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedCurrentCredentialRowVersion')
      !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedTaskRowVersion') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'expectedDispatchGeneration') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds') !~ '^[1-9][0-9]*$'
    or (p_command ->> 'retryAfterSeconds')::integer not between 1 and 3600
    or p_command ->> 'externalEvidenceFingerprint' is null
    or p_command ->> 'externalEvidenceFingerprint'
      !~ '^sha256:[a-f0-9]{64}$' then
    raise exception using
      errcode = '22023',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_invalid';
  end if;

  perform (p_command ->> 'workspaceId')::uuid;
  perform (p_command ->> 'businessEntityId')::uuid;
  perform (p_command ->> 'connectionId')::uuid;
  perform (p_command ->> 'mappingId')::uuid;
  perform (p_command ->> 'historicalCredentialId')::uuid;
  perform (p_command ->> 'currentCredentialId')::uuid;
  perform (p_command ->> 'taskId')::uuid;
  perform (p_command ->> 'failureAuditEventId')::uuid;
  perform (p_command ->> 'credentialReadAuditEventId')::uuid;

  v_historical_credential_version :=
    (p_command ->> 'expectedHistoricalCredentialVersion')::bigint;
  v_request_fingerprint := private.phase_6_request_fingerprint_v1(
    p_request_id,
    p_command
  );
  v_external_evidence_fingerprint :=
    private.sha256_fingerprint_bytes_v1(
      p_command ->> 'externalEvidenceFingerprint'
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'qbo_sandbox_credential_binding_incident_lineage_recovery:'
        || (p_command ->> 'taskId'),
      0
    )
  );

  select event.* into v_existing
  from private.integration_sync_task_credential_lineage_recovery_events
    as event
  where event.task_id = (p_command ->> 'taskId')::uuid
    or event.request_id = p_request_id
  order by event.task_id
  limit 1;
  if found then
    if v_existing.workspace_id = (p_command ->> 'workspaceId')::uuid
      and v_existing.business_entity_id =
        (p_command ->> 'businessEntityId')::uuid
      and v_existing.connection_id = (p_command ->> 'connectionId')::uuid
      and v_existing.connection_generation =
        (p_command ->> 'connectionGeneration')::bigint
      and v_existing.mapping_id = (p_command ->> 'mappingId')::uuid
      and v_existing.historical_credential_id =
        (p_command ->> 'historicalCredentialId')::uuid
      and v_existing.historical_credential_version =
        v_historical_credential_version
      and v_existing.current_credential_id =
        (p_command ->> 'currentCredentialId')::uuid
      and v_existing.current_credential_version =
        (p_command ->> 'expectedCurrentCredentialVersion')::bigint
      and v_existing.current_credential_row_version =
        (p_command ->> 'expectedCurrentCredentialRowVersion')::bigint
      and v_existing.task_id = (p_command ->> 'taskId')::uuid
      and v_existing.prior_row_version =
        (p_command ->> 'expectedTaskRowVersion')::bigint
      and v_existing.prior_dispatch_generation =
        (p_command ->> 'expectedDispatchGeneration')::bigint
      and v_existing.failure_audit_event_id =
        (p_command ->> 'failureAuditEventId')::uuid
      and v_existing.credential_read_audit_event_id =
        (p_command ->> 'credentialReadAuditEventId')::uuid
      and v_existing.diagnostic_class = p_command ->> 'diagnosticClass'
      and v_existing.external_evidence_fingerprint =
        v_external_evidence_fingerprint
      and v_existing.retry_after_seconds =
        (p_command ->> 'retryAfterSeconds')::integer
      and v_existing.request_id = p_request_id
      and v_existing.request_fingerprint = v_request_fingerprint
      and v_existing.actor_id = p_actor_id then
      return pg_catalog.jsonb_build_object(
        'taskId', v_existing.task_id,
        'recoveredAt', v_existing.recovered_at,
        'state', 'retry_wait',
        'rowVersion', v_existing.prior_row_version + 1,
        'historicalCredentialVersion',
          v_existing.historical_credential_version,
        'currentCredentialVersion', v_existing.current_credential_version,
        'idempotent', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_conflict';
  end if;

  if exists (
    select 1
    from private.integration_sync_task_credential_binding_recovery_events
      as event
    where event.task_id = (p_command ->> 'taskId')::uuid
  ) then
    raise exception using
      errcode = '23505',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_conflict';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = (p_command ->> 'workspaceId')::uuid
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_denied';
  end if;

  select connection.* into v_connection
  from private.integration_connections as connection
  where connection.workspace_id = (p_command ->> 'workspaceId')::uuid
    and connection.business_entity_id =
      (p_command ->> 'businessEntityId')::uuid
    and connection.id = (p_command ->> 'connectionId')::uuid
    and connection.connection_generation =
      (p_command ->> 'connectionGeneration')::bigint
    and connection.provider_key = 'quickbooks_online'
    and connection.provider_environment = 'sandbox'
    and connection.status in ('initializing', 'active', 'degraded')
    and connection.disconnected_at is null
    and connection.deleted_at is null
  for update;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_denied';
  end if;

  select credential.* into v_current_credential
  from private.integration_credentials as credential
  where credential.id = (p_command ->> 'currentCredentialId')::uuid
    and credential.workspace_id = v_connection.workspace_id
    and credential.business_entity_id = v_connection.business_entity_id
    and credential.connection_id = v_connection.id
    and credential.connection_generation = v_connection.connection_generation
    and credential.provider_key = v_connection.provider_key
    and credential.provider_environment = v_connection.provider_environment
  for share;
  if not found
    or v_current_credential.status <> 'active'
    or v_current_credential.credential_version <>
      (p_command ->> 'expectedCurrentCredentialVersion')::bigint
    or v_current_credential.row_version <>
      (p_command ->> 'expectedCurrentCredentialRowVersion')::bigint
    or v_current_credential.credential_ciphertext is null
    or v_current_credential.granted_scopes <>
      array['com.intuit.quickbooks.accounting']::text[]
    or v_current_credential.external_entity_reference_fingerprint is null
    or (
      v_current_credential.access_expires_at <= v_now + interval '30 seconds'
      and v_current_credential.refresh_expires_at is not null
      and v_current_credential.refresh_expires_at <= v_now
    )
    or v_current_credential.refresh_lease_id is not null
    or v_current_credential.refresh_lease_owner_fingerprint is not null
    or v_current_credential.refresh_lease_acquired_at is not null
    or v_current_credential.refresh_lease_expires_at is not null then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_credential_denied';
  end if;

  if (p_command ->> 'historicalCredentialId')::uuid <>
      v_current_credential.id
    or v_historical_credential_version >
      v_current_credential.credential_version then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
  end if;

  if v_current_credential.supersedes_credential_id is null then
    if v_current_credential.oauth_state_id is null
      or v_current_credential.reauthorization_state_id is not null then
      raise exception using
        errcode = '42501',
        message =
          'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
    end if;
    v_created_credential_version := 1;
  else
    select predecessor.* into v_predecessor
    from private.integration_credentials as predecessor
    where predecessor.id = v_current_credential.supersedes_credential_id
      and predecessor.workspace_id = v_current_credential.workspace_id
      and predecessor.business_entity_id =
        v_current_credential.business_entity_id
      and predecessor.connection_id = v_current_credential.connection_id
      and predecessor.connection_generation =
        v_current_credential.connection_generation
      and predecessor.provider_key = v_current_credential.provider_key
      and predecessor.provider_environment =
        v_current_credential.provider_environment
      and predecessor.status = 'superseded'
    for share;
    if not found then
      raise exception using
        errcode = '42501',
        message =
          'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
    end if;

    select state.* into v_reauthorization_state
    from private.integration_reauthorization_states as state
    where state.id = v_current_credential.reauthorization_state_id
      and state.workspace_id = v_current_credential.workspace_id
      and state.business_entity_id = v_current_credential.business_entity_id
      and state.connection_id = v_current_credential.connection_id
      and state.connection_generation =
        v_current_credential.connection_generation
      and state.provider_key = v_current_credential.provider_key
      and state.provider_environment =
        v_current_credential.provider_environment
      and state.superseded_credential_id = v_predecessor.id
      and state.superseded_credential_version =
        v_predecessor.credential_version
      and state.replacement_credential_id = v_current_credential.id
      and state.requested_scopes = v_current_credential.granted_scopes
      and state.status = 'completed'
      and state.completed_at is not null
    for share;
    if not found then
      raise exception using
        errcode = '42501',
        message =
          'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
    end if;
    v_created_credential_version :=
      v_reauthorization_state.superseded_credential_version + 1;
  end if;

  if v_historical_credential_version < v_created_credential_version
    or exists (
      select 1
      from pg_catalog.generate_series(
        v_created_credential_version + 1,
        v_current_credential.credential_version
      ) as expected(version)
      where (
        select pg_catalog.count(*)
        from private.integration_audit_events as audit
        where audit.workspace_id = v_current_credential.workspace_id
          and audit.business_entity_id =
            v_current_credential.business_entity_id
          and audit.connection_id = v_current_credential.connection_id
          and audit.action = 'credential_rotated'
          and audit.outcome = 'succeeded'
          and audit.target_type = 'integration_credential'
          and audit.target_id = v_current_credential.id::text
          and audit.reason_code = 'refresh_succeeded'
          and audit.metadata ->> 'connection_generation' =
            v_current_credential.connection_generation::text
          and audit.metadata ->> 'credential_status' = 'active'
          and audit.metadata ->> 'credential_version' = expected.version::text
          and audit.occurred_at between v_current_credential.created_at
            and v_current_credential.updated_at
      ) <> 1
    ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
  end if;
  v_refresh_advancement_count :=
    (v_current_credential.credential_version
      - v_historical_credential_version)::integer;

  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_current_credential.workspace_id
      and audit.business_entity_id = v_current_credential.business_entity_id
      and audit.connection_id = v_current_credential.connection_id
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_current_credential.id::text
      and audit.reason_code in ('invalid_grant', 'provider_revoked')
      and audit.occurred_at >= v_current_credential.created_at
  ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_revoked';
  end if;

  select mapping.* into v_mapping
  from private.provider_entity_mappings as mapping
  where mapping.workspace_id = v_connection.workspace_id
    and mapping.business_entity_id = v_connection.business_entity_id
    and mapping.connection_id = v_connection.id
    and mapping.id = (p_command ->> 'mappingId')::uuid
    and mapping.provider_key = v_connection.provider_key
    and mapping.provider_environment = v_connection.provider_environment
  for share;
  if not found
    or v_mapping.status <> 'active'
    or v_mapping.row_version <>
      (p_command ->> 'expectedMappingRowVersion')::bigint
    or v_mapping.provider_entity_reference_fingerprint <>
      v_current_credential.external_entity_reference_fingerprint then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_mapping_denied';
  end if;

  select run.* into v_run
  from private.integration_sync_tasks as candidate
  inner join private.integration_sync_runs as run
    on run.workspace_id = candidate.workspace_id
    and run.business_entity_id = candidate.business_entity_id
    and run.connection_id = candidate.connection_id
    and run.connection_generation = candidate.connection_generation
    and run.id = candidate.sync_run_id
  where candidate.workspace_id = v_connection.workspace_id
    and candidate.business_entity_id = v_connection.business_entity_id
    and candidate.connection_id = v_connection.id
    and candidate.connection_generation = v_connection.connection_generation
    and candidate.id = (p_command ->> 'taskId')::uuid
  for share of run;
  if not found
    or v_run.state <> 'running'
    or v_run.mode <> 'initialization'
    or v_run.mapping_id <> v_mapping.id then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_run_denied';
  end if;

  select task.* into v_task
  from private.integration_sync_tasks as task
  where task.workspace_id = v_connection.workspace_id
    and task.business_entity_id = v_connection.business_entity_id
    and task.connection_id = v_connection.id
    and task.connection_generation = v_connection.connection_generation
    and task.id = (p_command ->> 'taskId')::uuid
    and task.sync_run_id = v_run.id
    and task.provider_key = 'quickbooks_online'
    and task.provider_environment = 'sandbox'
    and task.queue_class in ('provider_interactive', 'provider_bulk')
  for update;
  if not found
    or v_task.state <> 'failed'
    or v_task.row_version <>
      (p_command ->> 'expectedTaskRowVersion')::bigint
    or v_task.dispatch_generation <>
      (p_command ->> 'expectedDispatchGeneration')::bigint
    or v_task.delivery_attribution_state <> 'attributed'
    or v_task.last_delivery_dispatch_generation is null
    or v_task.last_delivery_dispatch_generation <> v_task.dispatch_generation
    or v_task.last_delivery_retry_count is null
    or v_task.last_delivery_execution_count is null
    or v_task.last_delivery_attempt_fingerprint is null
    or v_task.failure_category <> 'contract'
    or v_task.failure_code <> 'phase8b_provider_task_failed'
    or v_task.completed_at is null
    or v_task.durable_effect_fingerprint is not null
    or v_task.attempt_count >= v_task.maximum_attempts
    or v_task.lease_id is not null
    or v_task.lease_owner_fingerprint is not null
    or v_task.lease_expires_at is not null
    or v_task.heartbeat_at is not null
    or v_task.dispatcher_task_name is not null then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_task_denied';
  end if;

  select recovery.* into v_previous_recovery
  from private.integration_sync_task_recovery_events as recovery
  where recovery.workspace_id = v_task.workspace_id
    and recovery.business_entity_id = v_task.business_entity_id
    and recovery.connection_id = v_task.connection_id
    and recovery.connection_generation = v_task.connection_generation
    and recovery.task_id = v_task.id
    and recovery.contract_version =
      'qbo_sandbox_expired_credential_recovery_v1'
    and recovery.recovered_at < v_task.completed_at
  order by recovery.recovery_generation desc
  limit 1;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
  end if;

  select audit.* into v_failure_audit
  from private.integration_audit_events as audit
  where audit.id = (p_command ->> 'failureAuditEventId')::uuid
    and audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'integration_sync_task.fail'
    and audit.outcome = 'failed'
    and audit.target_type = 'integration_sync_task'
    and audit.target_id = v_task.id::text
    and audit.occurred_at = v_task.completed_at;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_failure_denied';
  end if;

  select audit.* into v_credential_read_audit
  from private.integration_audit_events as audit
  where audit.id = (p_command ->> 'credentialReadAuditEventId')::uuid
    and audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'credential_provider_read'
    and audit.outcome = 'allowed'
    and audit.target_type = 'integration_credential'
    and audit.target_id = (p_command ->> 'historicalCredentialId')
    and audit.reason_code = 'authorized'
    and audit.metadata ->> 'connection_generation' =
      v_task.connection_generation::text
    and audit.metadata ->> 'credential_status' = 'active'
    and audit.metadata ->> 'credential_version' =
      v_historical_credential_version::text
    and audit.metadata ->> 'task_state' = 'leased'
    and (
      not (audit.metadata ? 'task_id')
      or audit.metadata ->> 'task_id' = v_task.id::text
    )
    and audit.occurred_at >= v_previous_recovery.recovered_at
    and audit.occurred_at <= v_task.completed_at;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_read_denied';
  end if;

  if v_historical_credential_version = v_created_credential_version then
    v_historical_persisted_at := v_current_credential.created_at;
  else
    select audit.occurred_at into v_historical_persisted_at
    from private.integration_audit_events as audit
    where audit.workspace_id = v_current_credential.workspace_id
      and audit.business_entity_id = v_current_credential.business_entity_id
      and audit.connection_id = v_current_credential.connection_id
      and audit.action = 'credential_rotated'
      and audit.outcome = 'succeeded'
      and audit.target_type = 'integration_credential'
      and audit.target_id = v_current_credential.id::text
      and audit.reason_code = 'refresh_succeeded'
      and audit.metadata ->> 'connection_generation' =
        v_current_credential.connection_generation::text
      and audit.metadata ->> 'credential_status' = 'active'
      and audit.metadata ->> 'credential_version' =
        v_historical_credential_version::text;
  end if;
  if v_historical_persisted_at is null
    or v_historical_persisted_at > v_credential_read_audit.occurred_at
    or exists (
      select 1
      from private.integration_audit_events as audit
      where audit.workspace_id = v_current_credential.workspace_id
        and audit.business_entity_id = v_current_credential.business_entity_id
        and audit.connection_id = v_current_credential.connection_id
        and audit.action = 'credential_rotated'
        and audit.outcome = 'succeeded'
        and audit.target_type = 'integration_credential'
        and audit.target_id = v_current_credential.id::text
        and audit.reason_code = 'refresh_succeeded'
        and audit.metadata ->> 'connection_generation' =
          v_current_credential.connection_generation::text
        and audit.metadata ->> 'credential_status' = 'active'
        and (audit.metadata ->> 'credential_version')::bigint >
          v_historical_credential_version
        and audit.occurred_at <= v_credential_read_audit.occurred_at
    ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_recovery_lineage_denied';
  end if;

  select audit.* into v_task_lease_audit
  from private.integration_audit_events as audit
  where audit.workspace_id = v_task.workspace_id
    and audit.business_entity_id = v_task.business_entity_id
    and audit.connection_id = v_task.connection_id
    and audit.action = 'integration_sync_task.lease'
    and audit.outcome = 'succeeded'
    and audit.target_type = 'integration_sync_task'
    and audit.target_id = v_task.id::text
    and audit.metadata ->> 'task_state' = 'leased'
    and audit.metadata ->> 'dispatch_generation' =
      v_task.dispatch_generation::text
    and audit.metadata ->> 'attempt_count' = v_task.attempt_count::text
    and audit.occurred_at >= v_previous_recovery.recovered_at
    and audit.occurred_at <= v_credential_read_audit.occurred_at
  order by audit.occurred_at desc
  limit 1;
  if not found then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_read_denied';
  end if;

  if exists (
    select 1
    from private.integration_audit_events as audit
    where audit.workspace_id = v_task.workspace_id
      and audit.business_entity_id = v_task.business_entity_id
      and audit.connection_id = v_task.connection_id
      and audit.action = 'integration_sync_task.complete'
      and audit.outcome = 'succeeded'
      and audit.target_type = 'integration_sync_task'
      and audit.target_id = v_task.id::text
      and audit.occurred_at >= v_previous_recovery.recovered_at
  ) or exists (
    select 1
    from private.external_source_record_versions as version
    where version.workspace_id = v_task.workspace_id
      and version.business_entity_id = v_task.business_entity_id
      and version.connection_id = v_task.connection_id
      and version.sync_run_id = v_task.sync_run_id
      and version.created_at >= v_previous_recovery.recovered_at
      and version.created_at <= v_task.completed_at
  ) then
    raise exception using
      errcode = '42501',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_effect_denied';
  end if;

  insert into
    private.integration_sync_task_credential_lineage_recovery_events (
      contract_version, workspace_id, business_entity_id, connection_id,
      connection_generation, sync_run_id, task_id, mapping_id,
      credential_lineage_id, historical_credential_id,
      historical_credential_version, current_credential_id,
      current_credential_version, current_credential_row_version,
      credential_created_version, refresh_advancement_count,
      prior_expired_recovery_event_id, task_lease_audit_event_id,
      failure_audit_event_id, credential_read_audit_event_id,
      diagnostic_class, external_evidence_fingerprint,
      prior_state, prior_failure_category, prior_failure_code,
      prior_row_version, prior_completed_at, prior_dispatch_generation,
      prior_delivery_attribution_state,
      prior_delivery_dispatch_generation, prior_delivery_retry_count,
      prior_delivery_execution_count, prior_delivery_attempt_fingerprint,
      prior_attempt_count, retry_after_seconds, reason_code,
      request_id, request_fingerprint, actor_id, recovered_at, created_at
    )
  values (
    'qbo_sandbox_credential_envelope_binding_incident_recovery_v2',
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    v_task.connection_generation,
    v_task.sync_run_id,
    v_task.id,
    v_mapping.id,
    v_current_credential.id,
    v_current_credential.id,
    v_historical_credential_version,
    v_current_credential.id,
    v_current_credential.credential_version,
    v_current_credential.row_version,
    v_created_credential_version,
    v_refresh_advancement_count,
    v_previous_recovery.id,
    v_task_lease_audit.id,
    v_failure_audit.id,
    v_credential_read_audit.id,
    'expires_at_binding',
    v_external_evidence_fingerprint,
    v_task.state,
    v_task.failure_category,
    v_task.failure_code,
    v_task.row_version,
    v_task.completed_at,
    v_task.dispatch_generation,
    v_task.delivery_attribution_state,
    v_task.last_delivery_dispatch_generation,
    v_task.last_delivery_retry_count,
    v_task.last_delivery_execution_count,
    v_task.last_delivery_attempt_fingerprint,
    v_task.attempt_count,
    (p_command ->> 'retryAfterSeconds')::integer,
    'credential_refresh_lineage_convergence',
    p_request_id,
    v_request_fingerprint,
    p_actor_id,
    v_now,
    v_now
  );

  update private.integration_sync_tasks as task
  set
    state = 'retry_wait',
    available_at = v_now + pg_catalog.make_interval(
      secs => (p_command ->> 'retryAfterSeconds')::integer
    ),
    failure_category = null,
    failure_code = null,
    completed_at = null,
    last_request_id = p_request_id,
    last_request_fingerprint = v_request_fingerprint,
    row_version = task.row_version + 1,
    updated_at = v_now
  where task.id = v_task.id
    and task.row_version = v_task.row_version
  returning task.* into v_task;
  if not found then
    raise exception using
      errcode = '40001',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_stale';
  end if;

  perform private.phase_6_insert_audit_v1(
    v_task.workspace_id,
    v_task.business_entity_id,
    v_task.connection_id,
    p_actor_id,
    'integration_sync_task.credential_binding_lineage_recover',
    'succeeded',
    'integration_sync_task',
    v_task.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'task_state', v_task.state,
      'queue_class', v_task.queue_class,
      'attempt_count', v_task.attempt_count,
      'dispatch_generation', v_task.dispatch_generation,
      'row_version', v_task.row_version,
      'credential_lineage_id', v_current_credential.id,
      'historical_credential_version', v_historical_credential_version,
      'current_credential_version', v_current_credential.credential_version,
      'refresh_advancement_count', v_refresh_advancement_count,
      'recovery_generation', v_previous_recovery.recovery_generation,
      'prior_failure_category', 'contract',
      'prior_failure_code', 'phase8b_provider_task_failed',
      'idempotent', false
    )
  );

  return pg_catalog.jsonb_build_object(
    'taskId', v_task.id,
    'recoveredAt', v_now,
    'state', v_task.state,
    'rowVersion', v_task.row_version,
    'historicalCredentialVersion', v_historical_credential_version,
    'currentCredentialVersion', v_current_credential.credential_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format
    or datetime_field_overflow or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message =
        'qbo_sandbox_credential_binding_incident_lineage_recovery_invalid';
end;
$function$;

revoke all on function
  public.recover_qbo_sandbox_credential_binding_incident_task_v2(
    jsonb, text, text
  )
  from public, anon, authenticated, service_role,
    external_integrations_authority, deterministic_calculation_authority,
    integration_control_plane_authority,
    integration_oauth_ingress_authority,
    integration_credential_broker_authority,
    integration_webhook_ingress_authority,
    integration_task_dispatch_authority,
    integration_task_scheduler_authority,
    integration_qbo_canary_dispatch_authority,
    integration_provider_runtime_authority,
    integration_deterministic_runtime_authority,
    integration_provider_source_authority,
    integration_provider_validation_authority;
grant execute on function
  public.recover_qbo_sandbox_credential_binding_incident_task_v2(
    jsonb, text, text
  )
  to integration_credential_broker_authority;

commit;
