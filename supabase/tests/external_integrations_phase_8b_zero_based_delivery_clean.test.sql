begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is(
  (
    select pg_catalog.count(*)::integer
    from supabase_migrations.schema_migrations
    where version = '20260824193332'
  ),
  1,
  'the clean canonical database records the zero-based migration exactly once'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'integration_sync_tasks'
      and column_name in (
        'delivery_attribution_state',
        'last_delivery_dispatch_generation'
      )
  ),
  2,
  'the clean task schema contains both delivery-attribution columns'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'integration_sync_tasks'
      and column_name = 'delivery_attribution_state'
  ),
  '''none''::text',
  'new canonical tasks default explicitly to no delivery evidence'
);

select ok(
  (
    select is_nullable = 'NO'
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'integration_sync_tasks'
      and column_name = 'delivery_attribution_state'
  ),
  'delivery attribution state is mandatory after the clean migration'
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
  'clean migration creates forced-RLS attribution evidence'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from private.integration_sync_task_delivery_attribution_events
  ),
  0,
  'a clean canonical migration fabricates no legacy attribution evidence'
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
  )
  and not pg_catalog.has_table_privilege(
    'integration_task_dispatch_authority',
    'private.integration_sync_task_delivery_attribution_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'clean migration grants no direct attribution-event table shortcut'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.lease_integration_sync_task_v1(jsonb,text,text)'::regprocedure
  ) like '%integration_sync_task_delivery_attribution_unresolved%',
  'lease authority fails closed on legacy-unattributed evidence'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'private.validate_integration_sync_task_mutation_v1()'::regprocedure
  ) like '%integration_sync_task_delivery_attribution_unresolved%',
  'the task mutation boundary freezes legacy-unattributed rows'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)'::regprocedure
  ) like '%delivery_attribution_state in (''none'', ''attributed'')%'
  and pg_catalog.pg_get_functiondef(
    'public.recover_qbo_sandbox_zero_based_deliveries_v1(jsonb,text,text)'::regprocedure
  ) not like '%delivery_attribution_state in (%legacy_unattributed%',
  'zero-based recovery accepts only none/attributed evidence states'
);

select ok(
  pg_catalog.pg_get_functiondef(
    'public.discover_integration_sync_dispatch_v1(text,integer)'::regprocedure
  ) like '%delivery_attribution_state <> ''legacy_unattributed''%'
  and pg_catalog.pg_get_functiondef(
    'public.read_qbo_sandbox_scoped_dispatch_candidates_v1(jsonb)'::regprocedure
  ) like '%delivery_attribution_state <> ''legacy_unattributed''%'
  and pg_catalog.pg_get_functiondef(
    'public.sweep_integration_sync_tasks_v1(integer,text,text)'::regprocedure
  ) like '%delivery_attribution_state <> ''legacy_unattributed''%'
  and pg_catalog.pg_get_functiondef(
    'public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1(jsonb,text,text)'::regprocedure
  ) like '%delivery_attribution_state <> ''legacy_unattributed''%',
  'discovery and sweep SQL boundaries exclude legacy-unattributed tasks'
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
  ),
  'scheduler membership cannot inherit or assume dispatcher authority'
);

select * from finish();
rollback;
