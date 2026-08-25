create extension if not exists dblink with schema extensions;

begin;

grant usage on schema extensions
  to integration_task_scheduler_authority,
    integration_task_dispatch_authority,
    integration_provider_runtime_authority;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.conversion_error(p_task_id uuid)
returns text
language plpgsql
as $function$
begin
  update private.integration_sync_tasks
  set
    delivery_attribution_state = 'attributed',
    last_delivery_dispatch_generation = dispatch_generation,
    row_version = row_version + 1,
    updated_at = pg_catalog.transaction_timestamp()
  where id = p_task_id;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$function$;

create or replace function pg_temp.statement_error(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$function$;

select is(
  (
    select pg_catalog.count(*)::integer
    from supabase_migrations.schema_migrations
    where version = '20260824193332'
  ),
  1,
  'the zero-based delivery migration is recorded exactly once'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.phase8b_zero_based_legacy_fixture_snapshot
  ),
  6,
  'the pre-migration fixture contains exactly six ambiguous task snapshots'
);

select is(
  (
    select pg_catalog.jsonb_object_agg(
      distribution.provider_environment || ':' || distribution.state,
      distribution.task_count
      order by distribution.provider_environment, distribution.state
    )
    from (
      select provider_environment, state, pg_catalog.count(*)::integer task_count
      from private.phase8b_zero_based_legacy_fixture_snapshot
      group by provider_environment, state
    ) as distribution
  ),
  '{"production:leased": 2, "production:pending": 1, "sandbox:leased": 2, "sandbox:pending": 1}'::jsonb,
  'the fixture has two leased and one pending task in each QBO environment label'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks as task
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = task.id
    where task.delivery_attribution_state = 'legacy_unattributed'
      and task.last_delivery_dispatch_generation is null
      and task.last_delivery_execution_count = 0
      and pg_catalog.octet_length(task.last_delivery_attempt_fingerprint) = 32
  ),
  6,
  'all six ambiguous rows become generation-null legacy_unattributed evidence'
);

select ok(
  (
    select task.delivery_attribution_state = 'attributed'
      and task.last_delivery_dispatch_generation = 1
      and task.last_delivery_execution_count = 1
      and pg_catalog.octet_length(
        task.last_delivery_attempt_fingerprint
      ) = 32
    from private.integration_sync_tasks as task
    where task.id = '38d00000-0000-4000-8000-000000000007'
  ),
  'successful historical lease evidence becomes generation-attributed'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks
    where id in (
      '38d00000-0000-4000-8000-000000000008',
      '38d00000-0000-4000-8000-000000000009'
    )
      and delivery_attribution_state = 'none'
      and last_delivery_dispatch_generation is null
      and last_delivery_execution_count is null
      and last_delivery_attempt_fingerprint is null
  ),
  2,
  'never-delivered controls remain generation-null none tuples'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    inner join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    inner join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'integration_task_dispatch_authority'
      and member_role.rolname = 'integration_task_scheduler_authority'
      and not membership.admin_option
      and not membership.inherit_option
      and not membership.set_option
  )
  and not pg_catalog.has_function_privilege(
    'integration_task_scheduler_authority',
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)',
    'EXECUTE'
  ),
  'scheduler membership cannot inherit or assume dispatcher recovery authority'
);

set local role integration_task_scheduler_authority;
select is(
  pg_catalog.jsonb_array_length(
    public.discover_integration_sync_dispatch_v1(
      'provider_interactive',
      100
    )
  )::text,
  '2',
  'global discovery returns only the two never-delivered controls'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_array_elements(
      public.discover_integration_sync_dispatch_v1(
        'provider_interactive',
        100
      )
    ) as candidate(value)
    where (candidate.value ->> 'taskId')::uuid in (
      '38d00000-0000-4000-8000-000000000001',
      '38d00000-0000-4000-8000-000000000002',
      '38d00000-0000-4000-8000-000000000003',
      '38d00000-0000-4000-8000-000000000004',
      '38d00000-0000-4000-8000-000000000005',
      '38d00000-0000-4000-8000-000000000006'
    )
  ),
  0,
  'global discovery excludes every legacy-unattributed fixture'
);
reset role;

set local role integration_task_dispatch_authority;
select is(
  public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
      'workspaceId', 'b8d00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8d00000-0000-4000-8000-000000000001',
      'connectionId', 'e8d00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'maximumTasks', 100
    )
  ) -> 0 ->> 'taskId',
  '38d00000-0000-4000-8000-000000000008',
  'scoped discovery returns the sandbox never-delivered control'
);
select is(
  pg_catalog.jsonb_array_length(
    public.read_qbo_sandbox_scoped_dispatch_candidates_v1(
      pg_catalog.jsonb_build_object(
        'contractVersion', 'qbo_sandbox_scoped_dispatch_discovery_v1',
        'workspaceId', 'b8d00000-0000-4000-8000-000000000001',
        'businessEntityId', 'd8d00000-0000-4000-8000-000000000001',
        'connectionId', 'e8d00000-0000-4000-8000-000000000001',
        'connectionGeneration', 1,
        'maximumTasks', 100
      )
    )
  )::text,
  '1',
  'scoped discovery excludes the sandbox legacy-unattributed pending fixture'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks as task
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = task.id
    where row(
      task.contract_version, task.workspace_id, task.business_entity_id,
      task.connection_id, task.connection_generation, task.sync_run_id,
      task.parent_task_id, task.provider_key, task.provider_environment,
      task.queue_class, task.task_kind, task.stream_key, task.state,
      task.priority, task.control_metadata, task.idempotency_fingerprint,
      task.coalescing_fingerprint, task.dispatcher_task_name,
      task.dispatch_generation, task.last_delivery_execution_count,
      task.last_delivery_attempt_fingerprint, task.attempt_count,
      task.maximum_attempts, task.available_at, task.lease_id,
      task.lease_owner_fingerprint, task.lease_expires_at,
      task.heartbeat_at, task.cancel_requested_at, task.failure_category,
      task.failure_code, task.durable_effect_fingerprint,
      task.last_request_id, task.last_request_fingerprint, task.row_version,
      task.created_at, task.updated_at, task.completed_at,
      task.retention_expires_at
    ) is distinct from row(
      snapshot.contract_version, snapshot.workspace_id,
      snapshot.business_entity_id, snapshot.connection_id,
      snapshot.connection_generation, snapshot.sync_run_id,
      snapshot.parent_task_id, snapshot.provider_key,
      snapshot.provider_environment, snapshot.queue_class,
      snapshot.task_kind, snapshot.stream_key, snapshot.state,
      snapshot.priority, snapshot.control_metadata,
      snapshot.idempotency_fingerprint, snapshot.coalescing_fingerprint,
      snapshot.dispatcher_task_name, snapshot.dispatch_generation,
      snapshot.last_delivery_execution_count,
      snapshot.last_delivery_attempt_fingerprint, snapshot.attempt_count,
      snapshot.maximum_attempts, snapshot.available_at, snapshot.lease_id,
      snapshot.lease_owner_fingerprint, snapshot.lease_expires_at,
      snapshot.heartbeat_at, snapshot.cancel_requested_at,
      snapshot.failure_category, snapshot.failure_code,
      snapshot.durable_effect_fingerprint, snapshot.last_request_id,
      snapshot.last_request_fingerprint, snapshot.row_version,
      snapshot.created_at, snapshot.updated_at, snapshot.completed_at,
      snapshot.retention_expires_at
    )
  ),
  0,
  'the upgrade preserves every pre-existing task value and evidence byte'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_task_delivery_attribution_events as event
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = event.task_id
    where event.contract_version =
        'integration_sync_task_delivery_attribution_migration_v1'
      and event.delivery_attribution_state = 'legacy_unattributed'
      and event.delivery_dispatch_generation is null
      and event.delivery_execution_count =
        snapshot.last_delivery_execution_count
      and event.delivery_attempt_fingerprint =
        snapshot.last_delivery_attempt_fingerprint
      and event.task_row_version = snapshot.row_version
      and event.attempt_count = snapshot.attempt_count
      and event.reason_code = 'successful_lease_audit_missing'
      and event.durable_effect_present = false
      and event.completed_at is not distinct from snapshot.completed_at
      and event.lease_id_fingerprint is not distinct from case
        when snapshot.lease_id is null then null
        else extensions.digest(
          pg_catalog.convert_to(snapshot.lease_id::text, 'UTF8'),
          'sha256'
        )
      end
  ),
  6,
  'six immutable redacted attribution events preserve the ambiguous evidence'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_task_delivery_attribution_events
  ),
  6,
  'only the six ambiguous rows receive legacy-attribution migration evidence'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_task_delivery_attribution_events as event
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = event.task_id
    where (snapshot.state = 'leased') =
      (event.lease_id_fingerprint is not null)
  ),
  6,
  'lease identifiers are retained only as redacted fingerprints'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    inner join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname =
        'integration_sync_task_delivery_attribution_events'
  ),
  'attribution evidence is protected by enabled and forced RLS'
);

select ok(
  not pg_catalog.has_table_privilege(
    'service_role',
    'private.integration_sync_task_delivery_attribution_events',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'integration_provider_runtime_authority',
    'private.integration_sync_task_delivery_attribution_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service_role and provider runtime receive no direct attribution-event authority'
);

select is(
  pg_temp.statement_error(
    $$update private.integration_sync_task_delivery_attribution_events
      set reason_code = reason_code
      where task_id = '38d00000-0000-4000-8000-000000000001'$$
  ),
  '55000:external_integration_immutable_row',
  'attribution evidence rejects update even when values are unchanged'
);

select is(
  pg_temp.statement_error(
    $$delete from private.integration_sync_task_delivery_attribution_events
      where task_id = '38d00000-0000-4000-8000-000000000001'$$
  ),
  '55000:external_integration_immutable_row',
  'attribution evidence rejects deletion'
);

select extensions.dblink_connect(
  connection_name,
  pg_catalog.convert_from(
    pg_catalog.decode(
      pg_catalog.current_setting('vaeroex.test_database_url_b64'),
      'base64'
    ),
    'UTF8'
  )
)
from (values
  ('phase8b_zero_based_quarantine_1'),
  ('phase8b_zero_based_quarantine_2')
) as connections(connection_name);

select extensions.dblink_send_query(
  'phase8b_zero_based_quarantine_1',
  $query$
    select private.phase8b_zero_based_fixture_lease_result(
      '38d00000-0000-4000-8000-000000000003',
      '68d00000-0000-4000-8000-000000000001',
      'phase8b-zero-based-concurrent-1'
    )
  $query$
);
select extensions.dblink_send_query(
  'phase8b_zero_based_quarantine_2',
  $query$
    select private.phase8b_zero_based_fixture_lease_result(
      '38d00000-0000-4000-8000-000000000003',
      '68d00000-0000-4000-8000-000000000002',
      'phase8b-zero-based-concurrent-2'
    )
  $query$
);

create temporary table phase8b_zero_based_concurrent_results (
  result jsonb not null
) on commit drop;

insert into phase8b_zero_based_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_zero_based_quarantine_1')
  as response(result jsonb);
insert into phase8b_zero_based_concurrent_results(result)
select result
from extensions.dblink_get_result('phase8b_zero_based_quarantine_2')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_zero_based_quarantine_1')
  as response(result jsonb);
select pg_catalog.count(*)
from extensions.dblink_get_result('phase8b_zero_based_quarantine_2')
  as response(result jsonb);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_zero_based_concurrent_results
    where result ->> 'sqlstate' = '55000'
      and result ->> 'message' =
        'integration_sync_task_delivery_attribution_unresolved'
  ),
  2,
  'hosted/local concurrent lease attempts both fail closed on quarantine'
);

create temporary table phase8b_zero_based_all_lease_denials (
  task_id uuid primary key,
  result jsonb not null
) on commit drop;

insert into phase8b_zero_based_all_lease_denials(task_id, result)
select snapshot.task_id, response.result
from (
  select fixture.task_id, pg_catalog.row_number() over (
    order by fixture.task_id
  ) as fixture_ordinal
  from private.phase8b_zero_based_legacy_fixture_snapshot as fixture
) as snapshot
cross join lateral extensions.dblink(
  'phase8b_zero_based_quarantine_1',
  pg_catalog.format(
    $query$
      select private.phase8b_zero_based_fixture_lease_result(
        %L::uuid,
        %L::uuid,
        %L::text
      )
    $query$,
    snapshot.task_id::text,
    '78d00000-0000-4000-8000-' || pg_catalog.lpad(
      snapshot.fixture_ordinal::text,
      12,
      '0'
    ),
    'phase8b-zero-based-all-lease-' || snapshot.task_id::text
  )
) as response(result jsonb);

select is(
  (
    select pg_catalog.count(*)::integer
    from phase8b_zero_based_all_lease_denials
    where result ->> 'sqlstate' = '55000'
      and result ->> 'message' =
        'integration_sync_task_delivery_attribution_unresolved'
  ),
  6,
  'all six legacy-unattributed tasks are denied by isolated lease boundaries'
);

select extensions.dblink_disconnect(connection_name)
from (values
  ('phase8b_zero_based_quarantine_1'),
  ('phase8b_zero_based_quarantine_2')
) as connections(connection_name);

-- Rollback-only overdue controls isolate the two sweep boundaries without
-- leaving discoverable work in the persistent fixture-rich database.
insert into private.integration_sync_tasks (
  id, contract_version, workspace_id, business_entity_id, connection_id,
  connection_generation, sync_run_id, parent_task_id, provider_key,
  provider_environment, queue_class, task_kind, stream_key, state, priority,
  control_metadata, idempotency_fingerprint, coalescing_fingerprint,
  dispatcher_task_name, dispatch_generation, delivery_attribution_state,
  last_delivery_dispatch_generation, last_delivery_execution_count,
  last_delivery_attempt_fingerprint, attempt_count, maximum_attempts,
  available_at, lease_id, lease_owner_fingerprint, lease_expires_at,
  heartbeat_at, cancel_requested_at, failure_category, failure_code,
  durable_effect_fingerprint, last_request_id, last_request_fingerprint,
  row_version, created_at, updated_at, completed_at, retention_expires_at
)
select
  control.task_id,
  source.contract_version,
  source.workspace_id,
  source.business_entity_id,
  source.connection_id,
  source.connection_generation,
  source.sync_run_id,
  source.parent_task_id,
  source.provider_key,
  source.provider_environment,
  source.queue_class,
  source.task_kind,
  source.stream_key,
  'pending',
  source.priority,
  source.control_metadata,
  extensions.digest(
    pg_catalog.convert_to('phase8b-zero-sweep-' || control.task_id::text, 'UTF8'),
    'sha256'
  ),
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-zero-sweep-coalesce-' || control.task_id::text,
      'UTF8'
    ),
    'sha256'
  ),
  null,
  1,
  'none',
  null,
  null,
  null,
  0,
  source.maximum_attempts,
  pg_catalog.transaction_timestamp(),
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  'phase8b-zero-sweep-' || control.task_id::text,
  extensions.digest(
    pg_catalog.convert_to(
      'phase8b-zero-sweep-request-' || control.task_id::text,
      'UTF8'
    ),
    'sha256'
  ),
  1,
  pg_catalog.transaction_timestamp() - interval '8 days',
  pg_catalog.transaction_timestamp(),
  null,
  pg_catalog.transaction_timestamp() - interval '1 day'
from (values
  (
    '38d00000-0000-4000-8000-000000000008'::uuid,
    '38d00000-0000-4000-8000-000000000010'::uuid
  ),
  (
    '38d00000-0000-4000-8000-000000000009'::uuid,
    '38d00000-0000-4000-8000-000000000011'::uuid
  )
) as control(source_task_id, task_id)
inner join private.integration_sync_tasks as source
  on source.id = control.source_task_id;

set local role integration_task_dispatch_authority;
select is(
  public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(
    pg_catalog.jsonb_build_object(
      'contractVersion', 'qbo_sandbox_scoped_dispatch_recovery_v1',
      'workspaceId', 'b8d00000-0000-4000-8000-000000000001',
      'businessEntityId', 'd8d00000-0000-4000-8000-000000000001',
      'connectionId', 'e8d00000-0000-4000-8000-000000000001',
      'connectionGeneration', 1,
      'maximumTasks', 100
    ),
    'phase8b-zero-based-scoped-sweep',
    'phase8b-zero-based-dispatcher'
  ) ->> 'recoveredTaskCount',
  '1',
  'scoped sweep processes only the sandbox never-delivered control'
);
reset role;

set local role integration_task_scheduler_authority;
select is(
  public.sweep_integration_sync_tasks_v1(
    100,
    'phase8b-zero-based-global-sweep',
    'phase8b-zero-based-scheduler'
  ) ->> 'recoveredTaskCount',
  '1',
  'global sweep processes only the production-labelled never-delivered control'
);
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks
    where id in (
      '38d00000-0000-4000-8000-000000000010',
      '38d00000-0000-4000-8000-000000000011'
    )
      and state = 'cancelled'
      and delivery_attribution_state = 'none'
  ),
  2,
  'both sweep boundaries remain usable for unambiguous never-delivered work'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
    where pg_temp.conversion_error(snapshot.task_id) =
      '55000:integration_sync_task_delivery_attribution_unresolved'
  ),
  6,
  'all six legacy-unattributed tasks reject ordinary conversion'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_tasks as task
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = task.id
    where task.delivery_attribution_state = 'legacy_unattributed'
      and task.state = snapshot.state
      and task.row_version = snapshot.row_version
      and task.last_delivery_execution_count =
        snapshot.last_delivery_execution_count
      and task.last_delivery_attempt_fingerprint =
        snapshot.last_delivery_attempt_fingerprint
  ),
  6,
  'denied lease and conversion attempts leave all six rows unchanged'
);

select ok(
  (
    select task.delivery_attribution_state = 'legacy_unattributed'
      and task.state = snapshot.state
      and task.row_version = snapshot.row_version
      and task.last_delivery_dispatch_generation is null
      and task.last_delivery_execution_count =
        snapshot.last_delivery_execution_count
      and task.last_delivery_attempt_fingerprint =
        snapshot.last_delivery_attempt_fingerprint
    from private.integration_sync_tasks as task
    inner join private.phase8b_zero_based_legacy_fixture_snapshot as snapshot
      on snapshot.task_id = task.id
    where task.id = '38d00000-0000-4000-8000-000000000003'
  ),
  'concurrent denial cannot lease, convert, or mutate the quarantined task'
);

select * from finish();
rollback;
