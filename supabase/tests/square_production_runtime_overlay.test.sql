begin;

-- Capture the Production-shaped authority closure before installing pgTAP.
-- Supabase creates privileged extensions as supabase_admin; PostgreSQL REVOKE
-- by postgres cannot remove the extension owner's original PUBLIC grants.
-- Keeping the original predicates here tests the real 103-migration catalog
-- without hiding any privilege behind test-only extension instrumentation.
create temporary table square_production_pre_pgtap_authority_privileges
on commit drop
as
select
  (with authority(role_name) as (values
    ('square_production_oauth_authority'),('square_production_broker_authority'),
    ('square_production_scheduler_authority'),('square_production_webhook_authority'),
    ('square_production_runtime_authority'),('square_production_evidence_authority')
  ), application_relations as (
    select relation.oid,relation_namespace.nspname,relation.relname,relation.relkind
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace
    where relation_namespace.nspname<>'pg_catalog'
      and relation_namespace.nspname<>'information_schema'
      and relation_namespace.nspname not like 'pg\_toast%' escape '\'
      and relation_namespace.nspname not like 'pg\_temp%' escape '\'
      and relation.relkind in ('r','p','v','m','f')
  ), relation_privileges(privilege_type) as (values
    ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')
  )
    select count(*)::integer
    from authority
    cross join application_relations
    cross join relation_privileges
    where pg_catalog.has_table_privilege(
      authority.role_name,application_relations.oid,relation_privileges.privilege_type
    ) and not (
      relation_privileges.privilege_type='SELECT'
      and application_relations.nspname='extensions'
      and application_relations.relname=any(array['pg_stat_statements','pg_stat_statements_info'])
      and application_relations.relkind='v'
      and not pg_catalog.has_schema_privilege(authority.role_name,'extensions','USAGE')
      and not pg_catalog.pg_has_role(authority.role_name,'pg_read_all_stats','USAGE')
      and exists (
        select 1 from pg_catalog.pg_depend extension_dependency
        join pg_catalog.pg_extension extension_record
          on extension_record.oid=extension_dependency.refobjid
        where extension_dependency.classid='pg_catalog.pg_class'::regclass
          and extension_dependency.objid=application_relations.oid
          and extension_dependency.objsubid=0
          and extension_dependency.refclassid='pg_catalog.pg_extension'::regclass
          and extension_dependency.deptype='e'
          and extension_record.extname='pg_stat_statements'
      )
    )) as relation_privilege_count,
  (with authority(role_name) as (values
    ('square_production_oauth_authority'),('square_production_broker_authority'),
    ('square_production_scheduler_authority'),('square_production_webhook_authority'),
    ('square_production_runtime_authority'),('square_production_evidence_authority')
  ), application_columns as (
    select relation.oid,attribute.attnum,
      relation_namespace.nspname,relation.relname,relation.relkind
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace relation_namespace on relation_namespace.oid=relation.relnamespace
    join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
    where relation_namespace.nspname<>'pg_catalog'
      and relation_namespace.nspname<>'information_schema'
      and relation_namespace.nspname not like 'pg\_toast%' escape '\'
      and relation_namespace.nspname not like 'pg\_temp%' escape '\'
      and relation.relkind in ('r','p','v','m','f')
      and attribute.attnum>0 and not attribute.attisdropped
  ), column_privileges(privilege_type) as (values
    ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')
  )
    select count(*)::integer
    from authority
    cross join application_columns
    cross join column_privileges
    where pg_catalog.has_column_privilege(
      authority.role_name,application_columns.oid,
      application_columns.attnum,column_privileges.privilege_type
    ) and not (
      column_privileges.privilege_type='SELECT'
      and application_columns.nspname='extensions'
      and application_columns.relname=any(array['pg_stat_statements','pg_stat_statements_info'])
      and application_columns.relkind='v'
      and not pg_catalog.has_schema_privilege(authority.role_name,'extensions','USAGE')
      and not pg_catalog.pg_has_role(authority.role_name,'pg_read_all_stats','USAGE')
      and exists (
        select 1 from pg_catalog.pg_depend extension_dependency
        join pg_catalog.pg_extension extension_record
          on extension_record.oid=extension_dependency.refobjid
        where extension_dependency.classid='pg_catalog.pg_class'::regclass
          and extension_dependency.objid=application_columns.oid
          and extension_dependency.objsubid=0
          and extension_dependency.refclassid='pg_catalog.pg_extension'::regclass
          and extension_dependency.deptype='e'
          and extension_record.extname='pg_stat_statements'
      )
    )) as column_privilege_count;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create or replace function pg_temp.statement_error(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate||':'||sqlerrm;
end
$function$;

select is(current_setting('server_version_num')::integer / 10000,17,
  'qualification uses the Production PostgreSQL 17 major version');
select is((select count(*)::integer from supabase_migrations.schema_migrations),103,
  'disposable ledger contains only the exact 102-version baseline and adjacent overlay');
select is((select count(*)::integer from supabase_migrations.schema_migrations
  where version='20260902191324'),1,'Production overlay is recorded exactly once');
select ok(to_regclass('private.square_account_configuration') is null,
  'Sandbox account lifecycle is absent from the Production-shaped database');
select ok(to_regclass('private.square_production_runtime_binding') is null,
  'legacy singular Square overlay is absent from the Production-shaped database');
select ok(to_regprocedure('private.integration_production_foundation_split_marker_v1()') is null,
  'later historical compatibility marker is absent from the Production-shaped database');

select is((select count(*)::integer from pg_catalog.pg_roles where rolname in (
  'square_production_oauth_authority','square_production_broker_authority',
  'square_production_scheduler_authority','square_production_webhook_authority',
  'square_production_runtime_authority','square_production_evidence_authority'
) and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
  and not rolcreaterole and not rolreplication and not rolbypassrls and rolconfig is null),6,
  'all Square Production authority roles remain NOLOGIN, NOINHERIT and unprivileged');
select is((select count(*)::integer from pg_catalog.pg_db_role_setting database_setting
  where database_setting.setrole=any(array[
    'square_production_oauth_authority'::regrole::oid,
    'square_production_broker_authority'::regrole::oid,
    'square_production_scheduler_authority'::regrole::oid,
    'square_production_webhook_authority'::regrole::oid,
    'square_production_runtime_authority'::regrole::oid,
    'square_production_evidence_authority'::regrole::oid
  ])),0,'Square Production authorities have no database-scoped role settings');

select is((select count(*)::integer from (
  values
    ('private.square_production_configuration_generations'::regclass),
    ('private.square_production_runtime_bindings'::regclass),
    ('private.square_production_generation_fences'::regclass),
    ('private.square_production_lifecycle_audit_events'::regclass)
) target(object_id)
join pg_catalog.pg_class relation on relation.oid=target.object_id
where relation.relkind='r' and relation.relpersistence='p'
  and relation.relrowsecurity and relation.relforcerowsecurity
  and not relation.relhassubclass),4,
  'every overlay relation is permanent, non-inherited and FORCE RLS');
select is((select count(*)::integer from pg_catalog.pg_class relation
  where relation.oid=any(array[
    'private.integration_production_platform_bindings'::regclass,
    'private.integration_production_provider_bindings'::regclass,
    'private.integration_production_provider_secrets'::regclass,
    'private.integration_production_provider_capabilities'::regclass
  ]) and relation.relkind='r' and relation.relpersistence='p'),4,
  'the authenticated provider-neutral foundation contains only permanent relations');
select is((select count(*)::integer from pg_catalog.pg_inherits inheritance
  where inheritance.inhrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ]) or inheritance.inhparent=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'overlay tables have no inheritance edges');
select is((select count(*)::integer from pg_catalog.pg_rewrite rewrite_rule
  where rewrite_rule.ev_class=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'overlay tables have no rewrite rules');
select is((select count(*)::integer from pg_catalog.pg_policy policy
  where policy.polrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'no dormant table has an RLS allow policy');
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema='private'
    and table_name like 'square_production_%'
    and grantee in ('anon','authenticated','service_role',
      'square_production_oauth_authority','square_production_broker_authority',
      'square_production_scheduler_authority','square_production_webhook_authority',
      'square_production_runtime_authority','square_production_evidence_authority')),0,
  'public, service and dormant Square roles receive no table privileges');
select ok(not pg_catalog.has_function_privilege('service_role',
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','execute'),
  'service role cannot invoke generation authority');
select ok(not pg_catalog.has_function_privilege('square_production_runtime_authority',
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','execute'),
  'dormant runtime authority cannot invoke the shared private generation check');
select is((select function_record.provolatile::text||':'||function_record.proisstrict::text||':'||
    function_record.proparallel::text||':'||function_record.prosecdef::text
  from pg_catalog.pg_proc function_record
  where function_record.oid=
    'private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)'::regprocedure),
  'i:true:s:false','typed configuration fingerprint helper is immutable, strict, parallel safe and invoker scoped');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_broker_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_scheduler_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_webhook_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_runtime_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_evidence_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure)
) expected(role_name,rpc) where pg_catalog.has_function_privilege(role_name,rpc,'execute')),6,
  'each NOLOGIN authority receives exactly its distinct checked preflight RPC');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_broker_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_scheduler_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_webhook_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_runtime_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_evidence_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure)
) denied(role_name,rpc) where pg_catalog.has_function_privilege(role_name,rpc,'execute')),0,
  'no authority inherits a different capability preflight RPC');
select is((with expected(role_name,rpc) as (values
  ('square_production_oauth_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_broker_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_scheduler_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_webhook_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_runtime_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_evidence_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure)
), application_routines as (
  select function_record.oid,function_namespace.oid as namespace_oid
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace function_namespace
    on function_namespace.oid=function_record.pronamespace
  where function_namespace.nspname<>'pg_catalog'
    and function_namespace.nspname<>'information_schema'
    and function_namespace.nspname not like 'pg\_toast%' escape '\'
    and function_namespace.nspname not like 'pg\_temp%' escape '\'
)
  select count(*)::integer
  from expected
  cross join application_routines
  where application_routines.oid<>expected.rpc
    and pg_catalog.has_schema_privilege(expected.role_name,application_routines.namespace_oid,'usage')
    and pg_catalog.has_function_privilege(expected.role_name,application_routines.oid,'execute')),0,
  'each Square authority can call no non-system routine beyond its one mapped preflight RPC');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
) authority(role_name)
  where pg_catalog.has_schema_privilege(authority.role_name,'private','usage')),0,
  'Square authorities cannot use the private schema');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
), application_schemas as (
  select namespace.oid
  from pg_catalog.pg_namespace namespace
  where namespace.nspname<>'pg_catalog'
    and namespace.nspname<>'information_schema'
    and namespace.nspname not like 'pg\_toast%' escape '\'
    and namespace.nspname not like 'pg\_temp%' escape '\'
)
  select count(*)::integer
  from authority
  cross join application_schemas
  where pg_catalog.has_schema_privilege(
    authority.role_name,application_schemas.oid,'create'
  )),0,'Square authorities cannot create objects in any non-system schema');
select is((select relation_privilege_count
  from pg_temp.square_production_pre_pgtap_authority_privileges),0,
  'Square authorities inherit no table privilege beyond the exact unusable statistics metadata views');
select is((select column_privilege_count
  from pg_temp.square_production_pre_pgtap_authority_privileges),0,
  'Square authorities inherit no column privilege beyond the exact unusable statistics metadata views');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
), application_sequences as (
  select sequence_record.oid
  from pg_catalog.pg_class sequence_record
  join pg_catalog.pg_namespace sequence_namespace on sequence_namespace.oid=sequence_record.relnamespace
  where sequence_namespace.nspname<>'pg_catalog'
    and sequence_namespace.nspname<>'information_schema'
    and sequence_namespace.nspname not like 'pg\_toast%' escape '\'
    and sequence_namespace.nspname not like 'pg\_temp%' escape '\'
    and sequence_record.relkind='S'
), sequence_privileges(privilege_type) as (values ('USAGE'),('SELECT'),('UPDATE'))
  select count(*)::integer
  from authority
  cross join application_sequences
  cross join sequence_privileges
  where pg_catalog.has_sequence_privilege(
    authority.role_name,application_sequences.oid,sequence_privileges.privilege_type
  )),0,'Square authorities inherit no sequence privilege on any non-system application sequence');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
)
  select count(*)::integer
  from authority
  cross join pg_catalog.pg_foreign_data_wrapper foreign_wrapper
  where pg_catalog.has_foreign_data_wrapper_privilege(
    authority.role_name,foreign_wrapper.oid,'usage'
  )),0,'Square authorities have no effective foreign-data-wrapper usage');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
)
  select count(*)::integer
  from authority
  cross join pg_catalog.pg_foreign_server foreign_server
  where pg_catalog.has_server_privilege(
    authority.role_name,foreign_server.oid,'usage'
  )),0,'Square authorities have no effective foreign-server usage');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
)
  select count(*)::integer
  from authority
  cross join pg_catalog.pg_tablespace tablespace_record
  where pg_catalog.has_tablespace_privilege(
    authority.role_name,tablespace_record.oid,'create'
  )),0,'Square authorities cannot create objects in any tablespace');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
) authority(role_name)
  where pg_catalog.has_database_privilege(authority.role_name,current_database(),'connect')
    and pg_catalog.has_database_privilege(authority.role_name,current_database(),'temp')
    and not pg_catalog.has_database_privilege(authority.role_name,current_database(),'create')),6,
  'Square authorities retain only current-database CONNECT and TEMP at the database layer');
select is((with authority(role_name,role_oid) as (values
  ('square_production_oauth_authority','square_production_oauth_authority'::regrole::oid),
  ('square_production_broker_authority','square_production_broker_authority'::regrole::oid),
  ('square_production_scheduler_authority','square_production_scheduler_authority'::regrole::oid),
  ('square_production_webhook_authority','square_production_webhook_authority'::regrole::oid),
  ('square_production_runtime_authority','square_production_runtime_authority'::regrole::oid),
  ('square_production_evidence_authority','square_production_evidence_authority'::regrole::oid)
)
  select count(*)::integer
  from authority
  cross join pg_catalog.pg_database database_record
  cross join lateral pg_catalog.aclexplode(database_record.datacl) database_acl
  where database_acl.grantee=authority.role_oid),0,
  'Square authorities have no direct database ACL on any database');
select is((with authority(role_name) as (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
)
  select count(*)::integer
  from authority
  cross join pg_catalog.pg_database database_record
  where database_record.datallowconn
    and database_record.datname<>current_database()
    and pg_catalog.has_database_privilege(authority.role_name,database_record.oid,'connect')
    and not exists (
      select 1
      from pg_catalog.aclexplode(coalesce(
        database_record.datacl,
        pg_catalog.acldefault('d',database_record.datdba)
      )) database_acl
      where database_acl.grantee=0 and database_acl.privilege_type='CONNECT'
    )),0,
  'any inherited CONNECT to another connectable database is only the standard PUBLIC default');
select is((with authority(role_oid) as (values
  ('square_production_oauth_authority'::regrole::oid),
  ('square_production_broker_authority'::regrole::oid),
  ('square_production_scheduler_authority'::regrole::oid),
  ('square_production_webhook_authority'::regrole::oid),
  ('square_production_runtime_authority'::regrole::oid),
  ('square_production_evidence_authority'::regrole::oid)
)
  select count(*)::integer
  from pg_catalog.pg_default_acl default_acl
  cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) default_privilege
  where default_acl.defaclobjtype in ('r','S','f','n')
    and (default_privilege.grantee=0 or default_privilege.grantee=any(
      select authority.role_oid from authority
    ))),0,
  'no PUBLIC or Square-target default ACL can expose future relations, sequences, routines or schemas');
select is((select count(*)::integer
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
  join pg_catalog.pg_depend extension_dependency
    on extension_dependency.classid='pg_catalog.pg_class'::regclass
    and extension_dependency.objid=relation.oid
    and extension_dependency.objsubid=0
    and extension_dependency.refclassid='pg_catalog.pg_extension'::regclass
    and extension_dependency.deptype='e'
  join pg_catalog.pg_extension extension_record
    on extension_record.oid=extension_dependency.refobjid
  cross join lateral pg_catalog.aclexplode(relation.relacl) relation_acl
  where namespace.nspname='extensions'
    and relation.relname=any(array['pg_stat_statements','pg_stat_statements_info'])
    and relation.relkind='v'
    and extension_record.extname='pg_stat_statements'
    and relation_acl.grantee=0
    and relation_acl.privilege_type='SELECT'
    and not relation_acl.is_grantable),2,
  'only the two canonical pg_stat_statements metadata views carry the allowed PUBLIC SELECT ACL');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
) authority(role_name)
  where pg_catalog.has_schema_privilege(authority.role_name,'extensions','USAGE')),0,
  'Square authorities cannot use the extensions schema containing the canonical metadata views');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority'),('square_production_broker_authority'),
  ('square_production_scheduler_authority'),('square_production_webhook_authority'),
  ('square_production_runtime_authority'),('square_production_evidence_authority')
) authority(role_name)
  where pg_catalog.pg_has_role(authority.role_name,'pg_read_all_stats','USAGE')),0,
  'Square authorities cannot read unredacted PostgreSQL statistics');
select is((select count(*)::integer
  from pg_catalog.pg_proc function_record
  cross join lateral pg_catalog.aclexplode(coalesce(
    function_record.proacl,
    pg_catalog.acldefault('f',function_record.proowner)
  )) function_acl
  where function_record.oid=any(array[
    'public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision)'::regprocedure::oid,
    'public.set_updated_at()'::regprocedure::oid
  ]) and function_acl.grantee=0 and function_acl.privilege_type='EXECUTE'),0,
  'the only inherited legacy public routine grants are closed for Square authorities');
select ok(pg_catalog.has_function_privilege('authenticated',
  'public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision)','execute'),
  'authenticated retains its explicit business-memory matching grant');
select is((select count(*)::integer
  from pg_catalog.pg_trigger trigger_record
  where not trigger_record.tgisinternal
    and trigger_record.tgfoid='public.set_updated_at()'::regprocedure
    and trigger_record.tgenabled='O'),42,
  'all existing updated-at triggers remain enabled after removing PUBLIC function execution');

create temporary table square_production_updated_at_probe(
  probe_id integer primary key,
  probe_value text not null,
  updated_at timestamptz not null
);
create trigger square_production_updated_at_probe_trigger
before update on square_production_updated_at_probe
for each row execute function public.set_updated_at();
insert into square_production_updated_at_probe(probe_id,probe_value,updated_at)
values (1,'before','2026-01-01T00:00:00Z');
update square_production_updated_at_probe set probe_value='after' where probe_id=1;
select ok((select updated_at>'2026-01-01T00:00:00Z'::timestamptz
  from square_production_updated_at_probe where probe_id=1),
  'set_updated_at continues executing as a trigger after PUBLIC execution is revoked');
select ok(pg_catalog.pg_get_functiondef(
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'::regprocedure)
  not like '%economic_contributions_enabled%',
  'operational authority is independent from economic contribution');
select ok(pg_catalog.pg_get_functiondef(
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'::regprocedure)
  not like '%ai_dispatch_enabled%',
  'operational authority is independent from AI dispatch');

select is((select count(*)::integer from information_schema.columns
  where table_schema='private'
    and table_name in (
      'square_production_configuration_generations','square_production_runtime_bindings',
      'square_production_generation_fences','square_production_lifecycle_audit_events'
    ) and is_generated='NEVER' and is_nullable='YES'),0,
  'all writable overlay authority columns are deliberately non-nullable');
select is((select string_agg(table_name||'.'||column_name,',' order by table_name,column_name)
  from information_schema.columns
  where table_schema='private'
    and table_name in (
      'square_production_configuration_generations','square_production_runtime_bindings',
      'square_production_generation_fences','square_production_lifecycle_audit_events'
    ) and is_generated='ALWAYS' and is_nullable='YES'),
  'square_production_configuration_generations.configuration_fingerprint,'||
  'square_production_configuration_generations.provider_authority_fingerprint,'||
  'square_production_generation_fences.fence_fingerprint,'||
  'square_production_lifecycle_audit_events.event_fingerprint,'||
  'square_production_runtime_bindings.binding_fingerprint',
  'only the exact five derived fingerprint columns retain catalog-generated nullability');
select is((select count(*)::integer from information_schema.columns
  where table_schema='private' and table_name='square_production_lifecycle_audit_events'
    and (data_type in ('json','jsonb') or column_name ~* '(payload|token|secret|credential|merchant|workspace|actor)')),0,
  'lifecycle audit has no raw, secret, provider-account or tenant payload field');
select is((select count(*)::integer from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ]) and not trigger_record.tgisinternal and trigger_record.tgenabled='O'),12,
  'all immutable, authority and sanitized-audit triggers are enabled');

select is((select count(*)::integer from private.integration_production_platform_bindings),0,
  'overlay seeds no shared platform binding');
select is((select count(*)::integer from private.integration_production_provider_bindings),0,
  'overlay seeds no provider binding');
select is((select count(*)::integer from private.integration_production_provider_secrets),0,
  'Production secret references remain empty');
select is((select count(*)::integer from private.integration_production_provider_capabilities),0,
  'overlay creates no service or database capability assignment');
select is((select count(*)::integer from private.square_production_configuration_generations),0,
  'overlay fabricates no Square application configuration');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'overlay fabricates no runtime binding');
select is((select count(*)::integer from private.square_production_generation_fences),0,
  'overlay fabricates no fence event');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events),0,
  'overlay fabricates no audit history');

select ok(pg_temp.statement_error($sql$
  insert into private.square_production_configuration_generations(
    generation,application_id,callback_origin,kms_key_resource,provider_policy_version,source_commit,prepared_at
  ) values (
    1,'sq0idp-production-fixture','https://foreign.example',
    'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
    'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:00:00Z'
  )
$sql$) like '23514:%','foreign callback contract is rejected');

insert into private.square_production_configuration_generations(
  generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
) values (
  1,'sq0idp-production-fixture',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:00:00Z'
);

select is((select callback_method||':'||callback_path||':'||webhook_method||':'||webhook_path
  from private.square_production_configuration_generations where generation=1),
  'GET:/api/integrations/square/callback:POST:/api/integrations/square/webhook',
  'shared hostname contract pins GET callback and POST webhook paths');
select is((select runtime_enabled::text||':'||provider_calls_enabled::text||':'||
  customer_onboarding_enabled::text||':'||webhook_intake_enabled::text||':'||
  economic_contributions_enabled::text||':'||ai_dispatch_enabled::text
  from private.square_production_configuration_generations where generation=1),
  'false:false:false:false:false:false','all activation and product gates remain closed');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events
  where generation=1 and event_kind='configuration_prepared'
    and reason_code='activation_gates_closed'),1,
  'configuration lifecycle creates one sanitized closed-gate audit event');

select ok(pg_temp.statement_error($sql$
  insert into private.square_production_runtime_bindings(
    provider_key,environment,project_id,region,generation,configuration_fingerprint,
    platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
  ) select provider_key,environment,project_id,region,generation,configuration_fingerprint,
    'vaeroex-production-integrations-v1',repeat('sha256:a',1),provider_authority_fingerprint,source_commit,
    '2026-09-15T00:01:00Z'
  from private.square_production_configuration_generations where generation=1
$sql$) like '23514:%','binding fails atomically while provider authority and secret references are empty');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'failed authority binding rolls back the binding row');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events
  where event_kind='binding_recorded'),0,'failed authority binding emits no false audit event');

insert into private.integration_production_platform_bindings(
  binding_key,environment,project_id,project_number,region,network_name,subnet_name,router_name,nat_name,
  egress_address_name,ingress_address_name,task_queue_name,artifact_repository_name,database_authority_target,
  runtime_policy_version,retention_policy_version,observability_policy_version,backup_policy_version,source_commit
) values (
  'vaeroex-production-integrations-v1','production','vaeroex-integrations-prod','123456789012','us-west1',
  'vaeroex-integrations-production','vaeroex-integrations-us-west1','vaeroex-integrations-router',
  'vaeroex-integrations-nat','vaeroex-integrations-egress','vaeroex-integrations-ingress',
  'vaeroex-integrations-tasks','vaeroex-integrations-images','existing_production_postgres',
  'production_runtime_v1','production_retention_v1','production_observability_v1','production_backup_v1',repeat('a',40)
);

insert into private.integration_production_provider_bindings(
  provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,
  callback_uri,kms_key_resource,source_commit
) values (
  'square','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
  'sq0idp-production-fixture','/api/integrations/square',
  'https://square.vaeroex.com/api/integrations/square/callback',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  repeat('a',40)
);

insert into private.integration_production_provider_secrets(
  provider_key,environment,project_id,secret_purpose,secret_version_resource
)
select 'square','production','vaeroex-integrations-prod',purpose,
  'projects/vaeroex-integrations-prod/secrets/square-production-'||replace(purpose,'_','-')||'/versions/1'
from unnest(array[
  'application','database_broker','database_evidence','database_oauth','database_runtime',
  'database_scheduler','database_webhook','webhook_signature'
]::text[]) purpose;

insert into private.integration_production_provider_capabilities(
  provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose
)
select 'square','production','vaeroex-integrations-prod',capability,
  'sq-prod-'||replace(capability,'_','-')||'@vaeroex-integrations-prod.iam.gserviceaccount.com',
  case when capability='task_invoker' then null else ('square_production_'||capability)::name end,
  case when capability='task_invoker' then null else 'database_'||capability end
from unnest(array['broker','evidence','oauth','runtime','scheduler','task_invoker','webhook']::text[]) capability;

select ok(pg_temp.statement_error($sql$
  update private.integration_production_provider_capabilities
  set database_secret_purpose='database_evidence'
  where provider_key='square' and environment='production'
    and project_id='vaeroex-integrations-prod' and capability='broker'
$sql$) like '23514:%',
  'provider-neutral foundation rejects a capability-to-secret-purpose mismatch before overlay evaluation');

update private.integration_production_provider_capabilities
set service_account='sq-prod-broker-drift@vaeroex-integrations-prod.iam.gserviceaccount.com',
  database_login='square_production_broker_drift'
where provider_key='square' and environment='production'
  and project_id='vaeroex-integrations-prod' and capability='broker';

select ok(pg_temp.statement_error($sql$
  insert into private.square_production_runtime_bindings(
    provider_key,environment,project_id,region,generation,configuration_fingerprint,
    platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
  )
  select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
    configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
    platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
    '2026-09-15T00:01:00Z'
  from private.square_production_configuration_generations configuration
  cross join private.integration_production_platform_bindings platform
  where configuration.generation=1
$sql$) like '23514:square_production_binding_capabilities_incomplete',
  'binding rejects foundation-valid drift in the capability service account and database login mapping');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'capability mapping rejection leaves no partial runtime binding');

update private.integration_production_provider_capabilities
set service_account='sq-prod-broker@vaeroex-integrations-prod.iam.gserviceaccount.com',
  database_login='square_production_broker'
where provider_key='square' and environment='production'
  and project_id='vaeroex-integrations-prod' and capability='broker';

insert into private.square_production_runtime_bindings(
  provider_key,environment,project_id,region,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
)
select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
  '2026-09-15T00:01:00Z'
from private.square_production_configuration_generations configuration
cross join private.integration_production_platform_bindings platform
where configuration.generation=1;

select ok(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',1,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=1),
    'runtime'
  )
$sql$) like '42501:square_production_runtime_disabled','current generation stays unusable while gates are closed');

insert into private.square_production_configuration_generations(
  generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
) values (
  2,'sq0idp-production-fixture',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:02:00Z'
);
insert into private.square_production_runtime_bindings(
  provider_key,environment,project_id,region,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
)
select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
  '2026-09-15T00:03:00Z'
from private.square_production_configuration_generations configuration
cross join private.integration_production_platform_bindings platform
where configuration.generation=2;

select ok(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',1,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=1),
    'runtime'
  )
$sql$) like '42501:square_production_generation_stale','superseded generation is rejected before runtime use');

insert into private.square_production_generation_fences(
  provider_key,environment,project_id,generation,configuration_fingerprint,
  fence_kind,reason_code,fenced_at
)
select provider_key,environment,project_id,generation,configuration_fingerprint,
  'operator_stop','manual_emergency_stop','2026-09-15T00:04:00Z'
from private.square_production_runtime_bindings where generation=2;

select ok(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',2,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=2),
    'runtime'
  )
$sql$) like '42501:square_production_generation_fenced','latest fenced generation is rejected before gate evaluation');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events),5,
  'two configurations, two bindings and one fence emit exact sanitized lifecycle audit history');

select ok(pg_temp.statement_error($sql$
  update private.square_production_configuration_generations set prepared_at='2026-09-16T00:00:00Z' where generation=1
$sql$) like '55000:square_production_history_immutable','configuration generations cannot be rewritten');
select ok(pg_temp.statement_error($sql$
  delete from private.square_production_runtime_bindings where generation=1
$sql$) like '55000:square_production_history_immutable','runtime bindings cannot be deleted');
select ok(pg_temp.statement_error($sql$
  truncate private.square_production_lifecycle_audit_events
$sql$) like '55000:square_production_history_immutable','sanitized lifecycle audit cannot be truncated');

-- pg_net's two composite types also have pg_class rows (relkind c). The
-- disposable-CI normalizer must inventory data relations, not mistake these
-- documented type descriptors for extra queue tables.
create schema net;
create unlogged table net.http_request_queue(id bigserial);
create unlogged table net._http_response(created timestamptz);
create index on net._http_response(created);
create type net.http_response as (status integer);
create type net.http_response_result as (response net.http_response);
select is((select count(*)::integer from pg_catalog.pg_class where relnamespace='net'::regnamespace),6,
  'pg_net-shaped fixture includes two composite-type catalog rows');
select is((select count(*)::integer from pg_catalog.pg_class where relnamespace='net'::regnamespace
  and relkind in ('r','p','v','m','f','S','i','I')),4,
  'local fixture data-relation inventory excludes only non-data composite descriptors');

select * from finish();
rollback;
