begin;
-- Supabase installs pgTAP in `extensions`; the standalone native qualifier
-- installs it in `public`. Keep the same test valid in both isolated targets.
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(34);

select is(
  (select count(*)::integer from supabase_migrations.schema_migrations where version<='20260902191325'),
  104,
  'exact Production prefix has 104 versions through the internal runtime'
);
select is(
  (select max(version)::text from supabase_migrations.schema_migrations where version<='20260902191325'),
  '20260902191325',
  'internal runtime is the adjacent Production head'
);

select is((
  select count(*)::integer
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='private'
    and relation.relname=any(array[
      'square_production_internal_permits','square_production_internal_oauth_states',
      'square_production_internal_credentials','square_production_internal_scans',
      'square_production_internal_page_receipts','square_production_internal_source_versions',
      'square_production_internal_fences','square_production_internal_audit_events'
    ])
    and relation.relkind='r' and relation.relpersistence='p'
    and relation.relowner='postgres'::regrole::oid
    and relation.relrowsecurity and relation.relforcerowsecurity
),8,'all eight private runtime relations are permanent, postgres-owned, and FORCE RLS');

select is((
  select count(*)::integer
  from pg_catalog.pg_policy policy
  where policy.polrelid=any(array[
    'private.square_production_internal_permits'::regclass,
    'private.square_production_internal_oauth_states'::regclass,
    'private.square_production_internal_credentials'::regclass,
    'private.square_production_internal_scans'::regclass,
    'private.square_production_internal_page_receipts'::regclass,
    'private.square_production_internal_source_versions'::regclass,
    'private.square_production_internal_fences'::regclass,
    'private.square_production_internal_audit_events'::regclass
  ])
),0,'runtime relations have no policy path around checked RPCs');

select is((
  select count(*)::integer
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) acl
  where relation.oid=any(array[
    'private.square_production_internal_permits'::regclass,
    'private.square_production_internal_oauth_states'::regclass,
    'private.square_production_internal_credentials'::regclass,
    'private.square_production_internal_scans'::regclass,
    'private.square_production_internal_page_receipts'::regclass,
    'private.square_production_internal_source_versions'::regclass,
    'private.square_production_internal_fences'::regclass,
    'private.square_production_internal_audit_events'::regclass
  ]) and acl.grantee<>relation.relowner
),0,'runtime relations have no non-owner table ACL');

select is((
  select count(*)::integer
  from pg_catalog.pg_attribute attribute
  cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
  where attribute.attrelid=any(array[
    'private.square_production_internal_permits'::regclass,
    'private.square_production_internal_oauth_states'::regclass,
    'private.square_production_internal_credentials'::regclass,
    'private.square_production_internal_scans'::regclass,
    'private.square_production_internal_page_receipts'::regclass,
    'private.square_production_internal_source_versions'::regclass,
    'private.square_production_internal_fences'::regclass,
    'private.square_production_internal_audit_events'::regclass
  ]) and not attribute.attisdropped
    and acl.grantee<>(select relowner from pg_catalog.pg_class where oid=attribute.attrelid)
),0,'runtime relations have no non-owner column ACL');

select is((
  select sum(row_count)::integer from (
    select count(*) row_count from private.square_production_internal_permits union all
    select count(*) from private.square_production_internal_oauth_states union all
    select count(*) from private.square_production_internal_credentials union all
    select count(*) from private.square_production_internal_scans union all
    select count(*) from private.square_production_internal_page_receipts union all
    select count(*) from private.square_production_internal_source_versions union all
    select count(*) from private.square_production_internal_fences union all
    select count(*) from private.square_production_internal_audit_events
  ) counts
),0,'migration seeds no permit, state, credential, scan, evidence, fence, or audit row');

select is((
  select count(*)::integer from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
  where namespace.nspname in ('private','public')
    and function_record.proname like 'square_production_internal_%'
),12,'runtime creates an exact twelve-function catalog surface');

select is((
  select count(*)::integer from pg_catalog.pg_proc function_record
  where function_record.oid=any(array[
    'public.square_production_internal_oauth_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_broker_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_runtime_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_evidence_v1(text,jsonb)'::regprocedure
  ]) and function_record.proowner='postgres'::regrole::oid
    and function_record.prosecdef and function_record.provolatile='v'
    and function_record.proconfig=array['search_path=""']::text[]
),4,'all four authority RPCs are volatile postgres-owned SECURITY DEFINER with empty search_path');

select is((
  select count(*)::integer
  from (values
    ('public.square_production_internal_oauth_v1(text,jsonb)'::regprocedure,'square_production_oauth_authority'::regrole::oid),
    ('public.square_production_internal_broker_v1(text,jsonb)'::regprocedure,'square_production_broker_authority'::regrole::oid),
    ('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure,'square_production_scheduler_authority'::regrole::oid),
    ('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure,'square_production_webhook_authority'::regrole::oid),
    ('public.square_production_internal_runtime_v1(text,jsonb)'::regprocedure,'square_production_runtime_authority'::regrole::oid),
    ('public.square_production_internal_evidence_v1(text,jsonb)'::regprocedure,'square_production_evidence_authority'::regrole::oid)
  ) expected(function_oid,grantee_oid)
  where 1=(select count(*) from pg_catalog.pg_proc function_record
    cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
    where function_record.oid=expected.function_oid and acl.grantee=expected.grantee_oid
      and acl.privilege_type='EXECUTE' and not acl.is_grantable)
    and not exists(select 1 from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
      where function_record.oid=expected.function_oid
        and acl.grantee not in (function_record.proowner,expected.grantee_oid))
),6,'each capability authority retains one exact non-grantable RPC and no other non-owner ACL');

select is((
  select count(*)::integer
  from pg_catalog.pg_proc function_record
  cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
  where function_record.oid=any(array[
    'public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure
  ]) and acl.grantee<>function_record.proowner
),0,'activated capabilities no longer expose their staged authority-check RPCs');

select is((
  select count(*)::integer
  from pg_catalog.pg_proc function_record
  cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
  where function_record.oid=any(array[
    'public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure,
    'public.square_production_internal_oauth_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_broker_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_runtime_v1(text,jsonb)'::regprocedure,
    'public.square_production_internal_evidence_v1(text,jsonb)'::regprocedure
  ]) and acl.grantee<>function_record.proowner
),6,'the complete staged-plus-runtime surface has exactly one non-owner EXECUTE per capability');

select is((
  select count(*)::integer
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
  cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
  where namespace.nspname='private' and function_record.proname like 'square_production_internal_%'
    and acl.grantee<>function_record.proowner
),0,'all eight private runtime helpers remain owner-only');

select is((
  select count(*)::integer from pg_catalog.pg_trigger trigger_record
  join pg_catalog.pg_class relation on relation.oid=trigger_record.tgrelid
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  where namespace.nspname='private' and relation.relname like 'square_production_internal_%'
    and not trigger_record.tgisinternal
),11,'runtime pins eleven lifecycle and immutable-history triggers');

select is((
  select count(*)::integer
  from pg_catalog.pg_roles role_record
  where role_record.rolname=any(array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ]) and not role_record.rolcanlogin and not role_record.rolinherit
    and not role_record.rolsuper and not role_record.rolcreatedb and not role_record.rolcreaterole
    and not role_record.rolreplication and not role_record.rolbypassrls
    and role_record.rolconfig is null
),6,'all six authority roles remain closed NOLOGIN NOINHERIT roles');

select is((
  select count(*)::integer from pg_catalog.pg_db_role_setting setting
  where setting.setrole=any(array[
    'square_production_oauth_authority'::regrole::oid,'square_production_broker_authority'::regrole::oid,
    'square_production_scheduler_authority'::regrole::oid,'square_production_webhook_authority'::regrole::oid,
    'square_production_runtime_authority'::regrole::oid,'square_production_evidence_authority'::regrole::oid
  ])
),0,'authority roles have no database-scoped role settings');

select is((
  select count(*)::integer
  from pg_catalog.pg_roles role_record
  cross join lateral pg_catalog.unnest(array[
    'private.square_production_internal_permits'::regclass,
    'private.square_production_internal_oauth_states'::regclass,
    'private.square_production_internal_credentials'::regclass,
    'private.square_production_internal_scans'::regclass,
    'private.square_production_internal_page_receipts'::regclass,
    'private.square_production_internal_source_versions'::regclass,
    'private.square_production_internal_fences'::regclass,
    'private.square_production_internal_audit_events'::regclass
  ]) relation_oid
  cross join lateral pg_catalog.unnest(array[
    'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
  ]::text[]) relation_privilege
  where role_record.rolname=any(array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ]) and (
    pg_catalog.has_table_privilege(role_record.oid,relation_oid,relation_privilege)
    or pg_catalog.has_any_column_privilege(role_record.oid,relation_oid,'SELECT,INSERT,UPDATE,REFERENCES')
  )
),0,'no authority receives effective direct table or column access');

select is((
  select runtime_enabled::text||':'||provider_calls_enabled::text||':'||
    customer_onboarding_enabled::text||':'||webhook_intake_enabled::text||':'||
    evidence_enabled::text||':'||economic_contributions_enabled::text||':'||ai_dispatch_enabled::text
  from private.square_production_configuration_generations
  order by generation desc limit 1
),null::text,'empty migration cannot fabricate or activate a Square configuration');

select ok(pg_catalog.to_regclass('private.square_account_oauth_states') is null,
  'Sandbox OAuth state table remains absent from the exact Production prefix');
select ok(pg_catalog.to_regclass('private.square_account_credentials') is null,
  'Sandbox credential table remains absent from the exact Production prefix');
select ok(pg_catalog.to_regclass('private.integration_sync_tasks') is not null,
  'provider-neutral shared task table remains present but untouched');
select ok(pg_catalog.to_regclass('private.integration_webhook_events') is not null,
  'provider-neutral shared webhook table remains present but untouched');

select ok(pg_catalog.to_regprocedure('public.square_production_internal_oauth_v1(text,jsonb)') is not null,
  'oauth internal-pilot RPC exists');
select ok(pg_catalog.to_regprocedure('public.square_production_internal_broker_v1(text,jsonb)') is not null,
  'broker internal-pilot RPC exists');
select ok(pg_catalog.to_regprocedure('public.square_production_internal_runtime_v1(text,jsonb)') is not null,
  'runtime internal-pilot RPC exists');
select ok(pg_catalog.to_regprocedure('public.square_production_internal_evidence_v1(text,jsonb)') is not null,
  'evidence internal-pilot RPC exists');
select ok(pg_catalog.to_regprocedure('private.square_production_internal_install_permit_v1(jsonb)') is not null,
  'owner-only exact permit installer exists');

select alike(
  pg_catalog.pg_get_functiondef('public.square_production_internal_broker_v1(text,jsonb)'::regprocedure),
  '%elsif p_operation=''reconcile_acquire'' then%',
  'broker exposes a distinct lost-acquire-response reconciliation operation'
);

select ok(not pg_catalog.has_function_privilege('square_production_scheduler_authority',
  'public.square_production_internal_runtime_v1(text,jsonb)','EXECUTE'),
  'scheduler authority cannot call the manual runtime RPC');
select ok(not pg_catalog.has_function_privilege('square_production_webhook_authority',
  'public.square_production_internal_oauth_v1(text,jsonb)','EXECUTE'),
  'webhook authority cannot enter the consent runtime');
select ok(not pg_catalog.has_function_privilege('authenticated',
  'public.square_production_internal_oauth_v1(text,jsonb)','EXECUTE'),
  'authenticated users cannot call the internal consent runtime');
select ok(not pg_catalog.has_function_privilege('service_role',
  'public.square_production_internal_broker_v1(text,jsonb)','EXECUTE'),
  'service_role cannot call the internal broker runtime');

select is((
  select count(*)::integer from private.square_production_configuration_generations
),0,'all general Square configuration remains empty after the runtime migration');
select is((
  select count(*)::integer from private.square_production_runtime_bindings
),0,'all Square runtime bindings remain empty after the runtime migration');

select * from finish();
rollback;
