\set ON_ERROR_STOP on

-- Read-only post-provisioning verification. This script creates no role, grant,
-- credential, table, function, connection, mapping or activation record.
begin transaction read only;
set local search_path='';

do $verification$
declare
  violation text;
  ledger_fingerprint text;
  schema_fingerprint text;
begin
  if pg_catalog.current_setting('server_version_num')::integer<170000
    or pg_catalog.current_setting('server_version_num')::integer>=180000 then
    raise exception using errcode='55000',message='square_production_postgresql_major_not_exact';
  end if;

  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception using errcode='55000',message='square_production_overlay_ledger_missing';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.string_agg(
    pg_catalog.length(version)::text||':'||version,'' order by version
  ),'UTF8'),'sha256'),'hex') into strict ledger_fingerprint
  from supabase_migrations.schema_migrations where version<='20260902191325';

  if (select count(*) from supabase_migrations.schema_migrations where version<='20260902191325')<>104
    or ledger_fingerprint<>'7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f'
    or not exists(select 1 from supabase_migrations.schema_migrations where version='20260902191323')
    or not exists(select 1 from supabase_migrations.schema_migrations where version='20260902191324')
    or not exists(select 1 from supabase_migrations.schema_migrations where version='20260902191325')
    or exists(select 1 from supabase_migrations.schema_migrations where version>'20260902191325') then
    raise exception using errcode='55000',message='square_production_overlay_ledger_not_exact';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
    'columns',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,attribute.attnum,attribute.attname,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        attribute.attnotnull,attribute.attidentity,attribute.attgenerated,
        pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true),
        case when attribute.attcollation=0 then null else pg_catalog.format(
          '%I.%I',collation_namespace.nspname,collation_record.collname
        ) end,collation_record.collprovider::text,
        collation_record.collisdeterministic,collation_record.collversion
      ) order by relation.relname,attribute.attnum)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
      left join pg_catalog.pg_collation collation_record on collation_record.oid=attribute.attcollation
      left join pg_catalog.pg_namespace collation_namespace on collation_namespace.oid=collation_record.collnamespace
      where namespace.nspname='private'
        and relation.relname=any(array[
          'square_production_configuration_generations','square_production_runtime_bindings',
          'square_production_generation_fences','square_production_lifecycle_audit_events'
        ]) and attribute.attnum>0 and not attribute.attisdropped
    ),'[]'::jsonb),
    'constraints',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,constraint_record.conname,constraint_record.contype,
        constraint_record.condeferrable,constraint_record.condeferred,
        constraint_record.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_record.oid,true)
      ) order by relation.relname,constraint_record.conname)
      from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class relation on relation.oid=constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'square_production_configuration_generations','square_production_runtime_bindings',
        'square_production_generation_fences','square_production_lifecycle_audit_events'
      ])
    ),'[]'::jsonb),
    'indexes',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,index_relation.relname,
        pg_catalog.pg_get_indexdef(index_record.indexrelid,0,true)
      ) order by relation.relname,index_relation.relname)
      from pg_catalog.pg_index index_record
      join pg_catalog.pg_class relation on relation.oid=index_record.indrelid
      join pg_catalog.pg_class index_relation on index_relation.oid=index_record.indexrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'square_production_configuration_generations','square_production_runtime_bindings',
        'square_production_generation_fences','square_production_lifecycle_audit_events'
      ])
    ),'[]'::jsonb),
    'policy_count',(select count(*) from pg_catalog.pg_policy policy_record
      where policy_record.polrelid=any(array[
        'private.square_production_configuration_generations'::regclass,
        'private.square_production_runtime_bindings'::regclass,
        'private.square_production_generation_fences'::regclass,
        'private.square_production_lifecycle_audit_events'::regclass
      ])),
    'trigger_count',(select count(*) from pg_catalog.pg_trigger trigger_record
      where not trigger_record.tgisinternal and trigger_record.tgrelid=any(array[
        'private.square_production_configuration_generations'::regclass,
        'private.square_production_runtime_bindings'::regclass,
        'private.square_production_generation_fences'::regclass,
        'private.square_production_lifecycle_audit_events'::regclass
      ]))
  ))::text,'UTF8'),'sha256'),'hex') into strict schema_fingerprint;
  if schema_fingerprint<>'2739c85b607701a5635c636112a32122ea7d244dc569273d5c9ea3fd05300d26'
    or 65<>(select count(*) from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid=attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private'
        and relation.relname=any(array[
          'square_production_configuration_generations','square_production_runtime_bindings',
          'square_production_generation_fences','square_production_lifecycle_audit_events'
        ]) and attribute.attnum>0 and not attribute.attisdropped)
    or 80<>(select count(*) from pg_catalog.pg_constraint constraint_record
      join pg_catalog.pg_class relation on relation.oid=constraint_record.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'square_production_configuration_generations','square_production_runtime_bindings',
        'square_production_generation_fences','square_production_lifecycle_audit_events'
      ]))
    or 9<>(select count(*) from pg_catalog.pg_index index_record
      join pg_catalog.pg_class relation on relation.oid=index_record.indrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=any(array[
        'square_production_configuration_generations','square_production_runtime_bindings',
        'square_production_generation_fences','square_production_lifecycle_audit_events'
      ])) then
    raise exception using errcode='55000',message='square_production_overlay_schema_not_exact';
  end if;

  with expected(login_name,authority_name,rpc_signature) as (values
    ('square_production_oauth','square_production_oauth_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'),
    ('square_production_broker','square_production_broker_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'),
    ('square_production_scheduler','square_production_scheduler_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'),
    ('square_production_webhook','square_production_webhook_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'),
    ('square_production_runtime','square_production_runtime_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'),
    ('square_production_evidence','square_production_evidence_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)')
  ), target_roles as (
    select expected.login_name role_name,'login' role_kind from expected
    union all
    select expected.authority_name,'authority' from expected
  ), expected_acl_dependencies(role_name,dbid,classid,objid,objsubid) as (
    select expected.authority_name,database.oid,'pg_catalog.pg_namespace'::regclass,namespace.oid,0
    from expected
    join pg_catalog.pg_database database on database.datname=pg_catalog.current_database()
    join pg_catalog.pg_namespace namespace on namespace.nspname='public'
    union all
    select expected.authority_name,database.oid,'pg_catalog.pg_proc'::regclass,
      to_regprocedure(expected.rpc_signature),0
    from expected
    join pg_catalog.pg_database database on database.datname=pg_catalog.current_database()
  ), expected_stat_views(view_name) as (values
    ('pg_stat_statements'),('pg_stat_statements_info')
  ), benign_stat_views as (
    select relation.oid relation_oid
    from expected_stat_views expected_view
    join pg_catalog.pg_namespace namespace on namespace.nspname='extensions'
    join pg_catalog.pg_class relation on relation.relnamespace=namespace.oid
      and relation.relname=expected_view.view_name and relation.relkind='v'
    join pg_catalog.pg_depend dependency on dependency.classid='pg_catalog.pg_class'::regclass
      and dependency.objid=relation.oid and dependency.objsubid=0
      and dependency.refclassid='pg_catalog.pg_extension'::regclass and dependency.deptype='e'
    join pg_catalog.pg_extension extension_record on extension_record.oid=dependency.refobjid
      and extension_record.extname='pg_stat_statements'
    where exists(
      select 1 from pg_catalog.aclexplode(relation.relacl) acl
      where acl.grantee=0 and acl.privilege_type='SELECT' and not acl.is_grantable
    ) and not exists(
      select 1 from pg_catalog.aclexplode(relation.relacl) acl
      where acl.grantee=0 and (acl.privilege_type<>'SELECT' or acl.is_grantable)
    ) and not exists(
      select 1 from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
      where attribute.attrelid=relation.oid and attribute.attnum>0
        and not attribute.attisdropped and acl.grantee=0
    ) and not exists(
      select 1 from target_roles target
      where pg_catalog.has_schema_privilege(target.role_name,namespace.oid,'USAGE')
    )
  ), expected_relations(relation_name) as (values
    ('private.square_production_configuration_generations'),
    ('private.square_production_runtime_bindings'),
    ('private.square_production_generation_fences'),
    ('private.square_production_lifecycle_audit_events')
  ), expected_private_functions(function_signature) as (values
    ('private.square_production_generation_fingerprint_v1(bigint,text[])'),
    ('private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)'),
    ('private.reject_square_production_immutable_mutation_v1()'),
    ('private.validate_square_production_runtime_binding_v1()'),
    ('private.record_square_production_lifecycle_audit_v1()'),
    ('private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)')
  ), expected_functions(function_signature,language_name,volatility,is_strict,parallel_mode,is_definer,return_type,body_sha256,argument_names) as (values
    ('private.square_production_generation_fingerprint_v1(bigint,text[])','sql','i',true,'s',false,'text','def74b5d5cad41db546e9d892226a2cc83c76d19274e2a021f04b13d640bc71d',array['p_generation','p_parts']::text[]),
    ('private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)','sql','i',true,'s',false,'text','5d7db71e0b5586089ac422a2eea3b0a0e85b1439314e6dcb238f1b91b85a8bea',array['p_generation','p_provider_key','p_environment','p_project_id','p_region','p_lifecycle_state','p_application_id','p_callback_origin','p_callback_method','p_callback_path','p_callback_uri','p_webhook_method','p_webhook_path','p_webhook_uri','p_api_version','p_authorization_endpoint','p_provider_origin','p_requested_scopes','p_kms_key_resource','p_application_secret_purpose','p_webhook_signature_secret_purpose','p_database_secret_purposes','p_provider_policy_version','p_source_commit','p_runtime_enabled','p_provider_calls_enabled','p_customer_onboarding_enabled','p_webhook_intake_enabled','p_evidence_enabled','p_economic_contributions_enabled','p_ai_dispatch_enabled']::text[]),
    ('private.reject_square_production_immutable_mutation_v1()','plpgsql','v',false,'u',false,'trigger','9aeed7ebf8d8f94a6d1a368296e90c9db1e1eecaf5c87adcf095c1149f9612f8',null::text[]),
    ('private.validate_square_production_runtime_binding_v1()','plpgsql','v',false,'u',false,'trigger','58e0806b2d796690b3be6c4d1939f81c84ed9481aa4a4cdac10210f22d0dc2f7',null::text[]),
    ('private.record_square_production_lifecycle_audit_v1()','plpgsql','v',false,'u',false,'trigger','81460db3bc5c19b6e6b27e119be59cf5d172427790fb4deaef7194195e2c85d4',null::text[]),
    ('private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','plpgsql','s',false,'u',false,'void','9f88e3f2787d4e7a30f66e4a42b00a8044b0c51cd69f9368b4bb9f45c0f8fdab',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint','p_capability']::text[]),
    ('public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','7a2a9d6a500e1bd376495401aae118757fe91e312125f9b78164234b0d399953',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[]),
    ('public.check_square_production_broker_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','ebd3a8f77b8226348dd85691b67ab8fd2655b98ba3bd99e841f40fae77ba4f30',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[]),
    ('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','11109f0da98d21d8f4a6cd3545723ad4f2c89743aeaa0364f98617e9d55a9946',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[]),
    ('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','4437e85187c56b476c7f36f59d07d1b379f06bee375b5f7c7470c952852cd68b',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[]),
    ('public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','1d77d48393a423f3dea91257b39b0d4934fc477de1af11ee35314ad0c3fcef6f',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[]),
    ('public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)','plpgsql','s',false,'u',true,'void','d2387dd8955b9032d88ef00887a0db8078c028ad42066b2bcfe972b108d1824a',array['p_provider_key','p_environment','p_project_id','p_generation','p_configuration_fingerprint']::text[])
  ), expected_triggers(relation_name,trigger_name,trigger_type,trigger_function) as (values
    ('private.square_production_configuration_generations','square_production_configuration_immutable',27,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_configuration_generations','square_production_configuration_truncate_immutable',34,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_configuration_generations','square_production_configuration_audit',5,'private.record_square_production_lifecycle_audit_v1()'),
    ('private.square_production_runtime_bindings','square_production_binding_authority',7,'private.validate_square_production_runtime_binding_v1()'),
    ('private.square_production_runtime_bindings','square_production_binding_immutable',27,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_runtime_bindings','square_production_binding_truncate_immutable',34,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_runtime_bindings','square_production_binding_audit',5,'private.record_square_production_lifecycle_audit_v1()'),
    ('private.square_production_generation_fences','square_production_fence_immutable',27,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_generation_fences','square_production_fence_truncate_immutable',34,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_generation_fences','square_production_fence_audit',5,'private.record_square_production_lifecycle_audit_v1()'),
    ('private.square_production_lifecycle_audit_events','square_production_audit_immutable',27,'private.reject_square_production_immutable_mutation_v1()'),
    ('private.square_production_lifecycle_audit_events','square_production_audit_truncate_immutable',34,'private.reject_square_production_immutable_mutation_v1()')
  ), overlay_object_checks as (
    select 'benign_pg_stat_statements_view_exception_not_exact' check_name
    where 2<>(select count(*) from benign_stat_views)
    union all
    select 'overlay_relation_inventory_not_exact' check_name
    where 4<>(
      select count(*) from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relkind in ('r','p','v','m','f','S')
        and relation.relname like 'square!_production!_%' escape '!'
    )
    union all
    select 'overlay_private_function_inventory_not_exact'
    where 6<>(
      select count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='private' and procedure.proname like '%square!_production!_%' escape '!'
    )
    union all
    select 'overlay_public_rpc_inventory_not_exact'
    where 6<>(
      select count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public'
        and procedure.proname like 'check!_square!_production!_%!_authority!_v1' escape '!'
    )
    union all
    select 'overlay_relation_missing_or_unsafe:'||expected_relations.relation_name check_name
    from expected_relations
    left join pg_catalog.pg_class relation on relation.oid=to_regclass(expected_relations.relation_name)
    where relation.oid is null or relation.relkind<>'r'
      or relation.relpersistence<>'p' or relation.relhassubclass
      or relation.relowner<>'postgres'::regrole::oid
      or not relation.relrowsecurity or not relation.relforcerowsecurity
      or exists(
        select 1 from pg_catalog.pg_inherits inheritance
        where inheritance.inhrelid=relation.oid or inheritance.inhparent=relation.oid
      )
      or exists(
        select 1 from pg_catalog.pg_rewrite rewrite_rule where rewrite_rule.ev_class=relation.oid
      )
      or exists(
        select 1 from pg_catalog.pg_policy policy where policy.polrelid=relation.oid
      )
      or exists(
        select 1 from pg_catalog.pg_publication publication where publication.puballtables
      )
      or exists(
        select 1 from pg_catalog.pg_publication_rel publication_relation
        where publication_relation.prrelid=relation.oid
      )
      or exists(
        select 1 from pg_catalog.pg_publication_namespace publication_namespace
        where publication_namespace.pnnspid=relation.relnamespace
      )
    union all
    select 'overlay_function_missing:'||expected_private_functions.function_signature
    from expected_private_functions
    where to_regprocedure(expected_private_functions.function_signature) is null
    union all
    select 'overlay_private_function_exposed:'||expected_private_functions.function_signature
    from expected_private_functions
    join pg_catalog.pg_proc procedure on procedure.oid=to_regprocedure(expected_private_functions.function_signature)
    cross join lateral pg_catalog.aclexplode(coalesce(
      procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
    )) acl
    where acl.grantee<>procedure.proowner
    union all
    select 'overlay_private_function_unsafe:'||expected_private_functions.function_signature
    from expected_private_functions
    join pg_catalog.pg_proc procedure on procedure.oid=to_regprocedure(expected_private_functions.function_signature)
    where procedure.prosecdef
      or procedure.proconfig is distinct from array['search_path=""']::text[]
    union all
    select 'overlay_function_definition_mismatch:'||expected_functions.function_signature
    from expected_functions
    left join pg_catalog.pg_proc procedure
      on procedure.oid=to_regprocedure(expected_functions.function_signature)
    left join pg_catalog.pg_language function_language on function_language.oid=procedure.prolang
    where procedure.oid is null
      or procedure.proowner<>'postgres'::regrole::oid
      or function_language.lanname<>expected_functions.language_name
      or procedure.provolatile<>expected_functions.volatility
      or procedure.proisstrict<>expected_functions.is_strict
      or procedure.proparallel<>expected_functions.parallel_mode
      or procedure.prosecdef<>expected_functions.is_definer
      or procedure.prorettype<>expected_functions.return_type::regtype
      or procedure.prokind<>'f' or procedure.proretset or procedure.proleakproof
      or procedure.pronargdefaults<>0 or procedure.provariadic<>0
      or procedure.proargnames is distinct from expected_functions.argument_names
      or procedure.proargmodes is not null or procedure.proallargtypes is not null
      or procedure.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(procedure.prosrc,'UTF8'),'sha256'
      ),'hex')<>expected_functions.body_sha256
    union all
    select 'overlay_trigger_inventory_not_exact'
    where 12<>(
      select count(*)
      from pg_catalog.pg_trigger trigger_record
      where not trigger_record.tgisinternal
        and trigger_record.tgrelid=any(array[
          'private.square_production_configuration_generations'::regclass,
          'private.square_production_runtime_bindings'::regclass,
          'private.square_production_generation_fences'::regclass,
          'private.square_production_lifecycle_audit_events'::regclass
        ])
    ) or exists(
      select 1
      from expected_triggers
      left join pg_catalog.pg_trigger trigger_record
        on trigger_record.tgrelid=to_regclass(expected_triggers.relation_name)
        and trigger_record.tgname=expected_triggers.trigger_name
        and not trigger_record.tgisinternal
      where trigger_record.oid is null or trigger_record.tgenabled<>'O'
        or trigger_record.tgtype<>expected_triggers.trigger_type
        or trigger_record.tgfoid<>to_regprocedure(expected_triggers.trigger_function)
        or trigger_record.tgnargs<>0 or pg_catalog.octet_length(trigger_record.tgargs)<>0
        or trigger_record.tgattr::text<>'' or trigger_record.tgqual is not null
        or trigger_record.tgoldtable is not null or trigger_record.tgnewtable is not null
        or trigger_record.tgconstraint<>0 or trigger_record.tgconstrrelid<>0
        or trigger_record.tgparentid<>0 or trigger_record.tgdeferrable
        or trigger_record.tginitdeferred
    ) or exists(
      select 1
      from pg_catalog.pg_trigger trigger_record
      join expected_relations on trigger_record.tgrelid=to_regclass(expected_relations.relation_name)
      left join expected_triggers on expected_triggers.relation_name=expected_relations.relation_name
        and expected_triggers.trigger_name=trigger_record.tgname
      where not trigger_record.tgisinternal and expected_triggers.trigger_name is null
    )
  ), role_checks as (
    select 'login_attributes:'||expected.login_name check_name
    from expected left join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    where login_role.oid is null or login_role.rolsuper or login_role.rolcreatedb or login_role.rolcreaterole
      or login_role.rolreplication or login_role.rolbypassrls or login_role.rolconfig is not null
    union all
    select 'authority_attributes:'||expected.authority_name
    from expected left join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    where authority_role.oid is null or authority_role.rolcanlogin or authority_role.rolinherit
      or authority_role.rolsuper or authority_role.rolcreatedb or authority_role.rolcreaterole
      or authority_role.rolreplication or authority_role.rolbypassrls or authority_role.rolconfig is not null
  ), role_phase_checks as (
    select 'login_phase_not_uniform_or_safe'
    from (
      select count(login_role.oid) role_count,
        bool_and(not login_role.rolcanlogin and not login_role.rolinherit) all_staged,
        bool_and(login_role.rolcanlogin and login_role.rolinherit) all_active
      from expected
      left join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    ) phase
    where phase.role_count<>6 or not (phase.all_staged or phase.all_active)
  ), role_setting_checks as (
    select 'database_role_setting:'||target.role_name||':'||setting.setdatabase::text
    from target_roles target
    join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_db_role_setting setting on setting.setrole=target_role.oid
  ), expected_memberships as (
    select expected.login_name,expected.authority_name,count(membership.roleid) membership_count
    from expected
    left join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    left join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    left join pg_catalog.pg_auth_members membership on membership.member=login_role.oid
      and membership.roleid=authority_role.oid and membership.inherit_option
      and not membership.set_option and not membership.admin_option
    group by expected.login_name,expected.authority_name
  ), membership_checks as (
    select 'missing_exact_membership:'||login_name from expected_memberships where membership_count<>1
    union all
    select 'unexpected_login_membership:'||login_role.rolname||':'||granted_role.rolname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_auth_members membership on membership.member=login_role.oid
    join pg_catalog.pg_roles granted_role on granted_role.oid=membership.roleid
    where granted_role.rolname<>expected.authority_name
       or not membership.inherit_option or membership.set_option or membership.admin_option
    union all
    select 'unexpected_login_member:'||login_role.rolname||':'||member_role.rolname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_auth_members membership on membership.roleid=login_role.oid
    join pg_catalog.pg_roles member_role on member_role.oid=membership.member
    where membership.inherit_option or membership.set_option or not membership.admin_option
      or not (member_role.rolsuper or member_role.rolcreaterole)
    union all
    select 'unexpected_authority_membership:'||authority_role.rolname||':'||granted_role.rolname
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    join pg_catalog.pg_auth_members membership on membership.member=authority_role.oid
    join pg_catalog.pg_roles granted_role on granted_role.oid=membership.roleid
    union all
    select 'unexpected_authority_member:'||authority_role.rolname||':'||member_role.rolname
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    join pg_catalog.pg_auth_members membership on membership.roleid=authority_role.oid
    join pg_catalog.pg_roles member_role on member_role.oid=membership.member
    where member_role.rolname<>expected.login_name
      and (membership.inherit_option or membership.set_option or not membership.admin_option
        or not (member_role.rolsuper or member_role.rolcreaterole))
  ), relation_acl_checks as (
    select 'direct_relation_acl:'||target.role_name||':'||namespace.nspname||'.'||relation.relname
    from target_roles target
    join pg_catalog.pg_roles grantee on grantee.rolname=target.role_name
    join pg_catalog.pg_class relation on true
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(relation.relacl) acl
    where acl.grantee=grantee.oid and relation.relkind in ('r','p','v','m','f','S')
  ), column_acl_checks as (
    select 'direct_column_acl:'||target.role_name||':'||namespace.nspname||'.'||relation.relname||'.'||attribute.attname
    from target_roles target
    join pg_catalog.pg_roles grantee on grantee.rolname=target.role_name
    join pg_catalog.pg_attribute attribute on attribute.attacl is not null and not attribute.attisdropped
    join pg_catalog.pg_class relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    where acl.grantee=grantee.oid
  ), public_relation_acl_checks as (
    select 'public_relation_acl:'||namespace.nspname||'.'||relation.relname||':'||acl.privilege_type
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault(
          (case when relation.relkind='S' then 'S' else 'r' end)::"char",relation.relowner
        )
      )
    ) acl
    where namespace.nspname='public'
      and relation.relkind in ('r','p','v','m','f','S')
      and acl.grantee=0
  ), public_column_acl_checks as (
    select 'public_column_acl:'||namespace.nspname||'.'||relation.relname||'.'||attribute.attname||':'||acl.privilege_type
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid=attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    where namespace.nspname='public'
      and relation.relkind in ('r','p','v','m','f')
      and attribute.attnum>0 and not attribute.attisdropped
      and acl.grantee=0
  ), overlay_relation_acl_checks as (
    select 'overlay_relation_acl:'||expected_relations.relation_name||':'||coalesce(grantee.rolname,'PUBLIC')
    from expected_relations
    join pg_catalog.pg_class relation on relation.oid=to_regclass(expected_relations.relation_name)
    cross join lateral pg_catalog.aclexplode(relation.relacl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where acl.grantee<>relation.relowner
  ), overlay_column_acl_checks as (
    select 'overlay_column_acl:'||expected_relations.relation_name||'.'||attribute.attname||':'||coalesce(grantee.rolname,'PUBLIC')
    from expected_relations
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid=to_regclass(expected_relations.relation_name)
      and attribute.attacl is not null and not attribute.attisdropped
    join pg_catalog.pg_class relation on relation.oid=attribute.attrelid
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where acl.grantee<>relation.relowner
  ), effective_overlay_relation_checks as (
    select 'effective_overlay_relation_privilege:'||target.role_name||':'||expected_relations.relation_name||':'||privilege.privilege_type
    from target_roles target
    cross join expected_relations
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) privilege(privilege_type)
    where pg_catalog.has_table_privilege(
      target.role_name,to_regclass(expected_relations.relation_name),privilege.privilege_type
    )
  ), effective_overlay_column_checks as (
    select 'effective_overlay_column_privilege:'||target.role_name||':'||expected_relations.relation_name||'.'||attribute.attname||':'||privilege.privilege_type
    from target_roles target
    cross join expected_relations
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid=to_regclass(expected_relations.relation_name)
      and attribute.attnum>0 and not attribute.attisdropped
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(privilege_type)
    where pg_catalog.has_column_privilege(
      target.role_name,attribute.attrelid,attribute.attnum,privilege.privilege_type
    )
  ), effective_application_relation_checks as (
    select 'effective_application_relation_privilege:'||target.role_name||':'||namespace.nspname||'.'||
      relation.relname||':'||privilege.privilege_type
    from target_roles target
    cross join pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) privilege(privilege_type)
    where relation.relkind in ('r','p','v','m','f')
      and namespace.nspname not in ('pg_catalog','information_schema','pg_toast')
      and namespace.nspname!~'^(pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'
      and pg_catalog.has_table_privilege(target.role_name,relation.oid,privilege.privilege_type)
      and not (
        privilege.privilege_type='SELECT'
        and relation.oid in (select relation_oid from benign_stat_views)
      )
  ), effective_application_column_checks as (
    select 'effective_application_column_privilege:'||target.role_name||':'||namespace.nspname||'.'||
      relation.relname||'.'||attribute.attname||':'||privilege.privilege_type
    from target_roles target
    cross join pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
      and attribute.attnum>0 and not attribute.attisdropped
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) privilege(privilege_type)
    where relation.relkind in ('r','p','v','m','f')
      and namespace.nspname not in ('pg_catalog','information_schema','pg_toast')
      and namespace.nspname!~'^(pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'
      and pg_catalog.has_column_privilege(
        target.role_name,relation.oid,attribute.attnum,privilege.privilege_type
      )
      and not (
        privilege.privilege_type='SELECT'
        and relation.oid in (select relation_oid from benign_stat_views)
      )
  ), effective_sequence_checks as (
    select 'effective_sequence_privilege:'||target.role_name||':'||namespace.nspname||'.'||
      relation.relname||':'||privilege.privilege_type
    from target_roles target
    cross join pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join (values ('USAGE'),('SELECT'),('UPDATE')) privilege(privilege_type)
    where relation.relkind='S'
      and namespace.nspname not in ('pg_catalog','information_schema','pg_toast')
      and namespace.nspname!~'^(pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'
      and pg_catalog.has_sequence_privilege(target.role_name,relation.oid,privilege.privilege_type)
  ), authority_rpc_checks as (
    select 'authority_rpc_not_exact:'||expected.authority_name||':'||expected.rpc_signature
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    where to_regprocedure(expected.rpc_signature) is null
      or exists(
        select 1 from pg_catalog.pg_proc procedure
        where procedure.oid=to_regprocedure(expected.rpc_signature)
          and (not procedure.prosecdef or procedure.provolatile<>'s'
            or procedure.prokind<>'f' or procedure.prorettype<>'void'::regtype
            or procedure.proconfig is distinct from array['search_path=""']::text[])
      )
      or 1<>(
        select count(*)
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
        cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
        where acl.grantee=authority_role.oid and acl.privilege_type='EXECUTE'
      )
      or not exists(
        select 1
        from pg_catalog.pg_proc procedure
        cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
        where procedure.oid=to_regprocedure(expected.rpc_signature)
          and acl.grantee=authority_role.oid and acl.privilege_type='EXECUTE'
          and not acl.is_grantable
      )
  ), expected_rpc_exposure_checks as (
    select 'unexpected_rpc_grantee:'||expected.rpc_signature||':'||coalesce(grantee.rolname,'PUBLIC')
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    join pg_catalog.pg_proc procedure on procedure.oid=to_regprocedure(expected.rpc_signature)
    cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where acl.privilege_type='EXECUTE'
      and acl.grantee not in (procedure.proowner,authority_role.oid)
  ), direct_login_function_checks as (
    select 'direct_login_function_acl:'||login_role.rolname||':'||namespace.nspname||'.'||procedure.proname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_proc procedure on true
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
    where acl.grantee=login_role.oid
  ), effective_routine_checks as (
    select 'effective_unexpected_routine:'||target.role_name||':'||
      namespace.nspname||'.'||procedure.proname||'('||
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)||')'
    from target_roles target
    join expected on target.role_name in (expected.login_name,expected.authority_name)
    cross join pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname not in ('pg_catalog','information_schema','pg_toast')
      and namespace.nspname!~'^(pg_temp_[0-9]+|pg_toast_temp_[0-9]+)$'
      and pg_catalog.has_schema_privilege(target.role_name,namespace.oid,'USAGE')
      and pg_catalog.has_function_privilege(target.role_name,procedure.oid,'EXECUTE')
      and not (
        namespace.nspname='public'
        and procedure.oid=to_regprocedure(expected.rpc_signature)
      )
  ), schema_acl_checks as (
    select 'direct_login_schema_acl:'||login_role.rolname||':'||namespace.nspname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_namespace namespace on true
    cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
    where acl.grantee=login_role.oid
    union all
    select 'authority_schema_acl_not_exact:'||authority_role.rolname
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    where 1<>(
      select count(*)
      from pg_catalog.pg_namespace namespace
      cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
      where acl.grantee=authority_role.oid
    ) or not exists(
      select 1
      from pg_catalog.pg_namespace namespace
      cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
      where namespace.nspname='public' and acl.grantee=authority_role.oid
        and acl.privilege_type='USAGE' and not acl.is_grantable
    )
  ), effective_schema_checks as (
    select 'effective_schema_privilege:'||target.role_name
    from target_roles target
    where not pg_catalog.has_schema_privilege(target.role_name,'public','USAGE')
      or pg_catalog.has_schema_privilege(target.role_name,'public','CREATE')
      or pg_catalog.has_schema_privilege(target.role_name,'private','USAGE')
      or pg_catalog.has_schema_privilege(target.role_name,'private','CREATE')
    union all
    select 'effective_schema_create:'||target.role_name||':'||namespace.nspname
    from target_roles target
    cross join pg_catalog.pg_namespace namespace
    where pg_catalog.has_schema_privilege(target.role_name,namespace.oid,'CREATE')
  ), database_acl_checks as (
    select 'direct_database_acl:'||target.role_name||':'||database.datname
    from target_roles target
    join pg_catalog.pg_roles grantee on grantee.rolname=target.role_name
    join pg_catalog.pg_database database on true
    cross join lateral pg_catalog.aclexplode(database.datacl) acl
    where acl.grantee=grantee.oid
    union all
    select 'effective_database_create:'||target.role_name||':'||database.datname
    from target_roles target
    cross join pg_catalog.pg_database database
    where pg_catalog.has_database_privilege(target.role_name,database.oid,'CREATE')
  ), effective_database_connect_checks as (
    select 'effective_database_connect_not_exact:'||target.role_name||':'||database.datname
    from target_roles target
    cross join pg_catalog.pg_database database
    where database.datname=pg_catalog.current_database()
      and (not database.datallowconn
        or not pg_catalog.has_database_privilege(target.role_name,database.oid,'CONNECT'))
    union all
    select 'effective_database_temporary_not_baseline:'||target.role_name||':'||database.datname
    from target_roles target
    cross join pg_catalog.pg_database database
    where database.datname not in (pg_catalog.current_database(),'postgres')
      and pg_catalog.has_database_privilege(target.role_name,database.oid,'TEMPORARY')
  ), effective_foreign_access_checks as (
    select 'effective_foreign_data_wrapper_usage:'||target.role_name||':'||wrapper.fdwname
    from target_roles target
    cross join pg_catalog.pg_foreign_data_wrapper wrapper
    where pg_catalog.has_foreign_data_wrapper_privilege(target.role_name,wrapper.oid,'USAGE')
    union all
    select 'effective_foreign_server_usage:'||target.role_name||':'||server.srvname
    from target_roles target
    cross join pg_catalog.pg_foreign_server server
    where pg_catalog.has_server_privilege(target.role_name,server.oid,'USAGE')
  ), effective_tablespace_checks as (
    select 'effective_tablespace_create:'||target.role_name||':'||tablespace.spcname
    from target_roles target
    cross join pg_catalog.pg_tablespace tablespace
    where pg_catalog.has_tablespace_privilege(target.role_name,tablespace.oid,'CREATE')
  ), default_acl_checks as (
    select 'direct_default_acl:'||target.role_name||':'||default_acl.defaclobjtype||':'||coalesce(namespace.nspname,'*')
    from target_roles target
    join pg_catalog.pg_roles grantee on grantee.rolname=target.role_name
    join pg_catalog.pg_default_acl default_acl on true
    left join pg_catalog.pg_namespace namespace on namespace.oid=default_acl.defaclnamespace
    cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) acl
    where acl.grantee=grantee.oid
  ), public_material_default_acl_checks as (
    select 'public_material_default_acl:'||default_acl.defaclrole::text||':'||
      default_acl.defaclobjtype||':'||coalesce(namespace.nspname,'*')||':'||acl.privilege_type
    from pg_catalog.pg_default_acl default_acl
    left join pg_catalog.pg_namespace namespace on namespace.oid=default_acl.defaclnamespace
    cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) acl
    where default_acl.defaclobjtype in ('r','S','f','n') and acl.grantee=0
  ), parameter_acl_checks as (
    select 'parameter_acl:'||parameter.parname||':'||coalesce(grantee.rolname,'PUBLIC')||':'||acl.privilege_type
    from pg_catalog.pg_parameter_acl parameter
    cross join lateral pg_catalog.aclexplode(parameter.paracl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where acl.grantee=0 or exists(
      select 1 from target_roles target where target.role_name=grantee.rolname
    )
  ), large_object_acl_checks as (
    select 'large_object_acl:'||large_object.oid::text||':'||coalesce(grantee.rolname,'PUBLIC')||':'||acl.privilege_type
    from pg_catalog.pg_largeobject_metadata large_object
    cross join lateral pg_catalog.aclexplode(large_object.lomacl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid=acl.grantee
    where acl.grantee=0 or exists(
      select 1 from target_roles target where target.role_name=grantee.rolname
    )
  ), acl_dependency_checks as (
    select 'unexpected_acl_dependency:'||target.role_name||':'||dependency.dbid::text||':'||
      dependency.classid::text||':'||dependency.objid::text||':'||dependency.objsubid::text
    from target_roles target
    join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_shdepend dependency on dependency.refclassid='pg_catalog.pg_authid'::regclass
      and dependency.refobjid=target_role.oid and dependency.deptype='a'
    left join expected_acl_dependencies allowed
      on allowed.role_name=target.role_name and allowed.dbid=dependency.dbid
      and allowed.classid=dependency.classid and allowed.objid=dependency.objid
      and allowed.objsubid=dependency.objsubid
    where allowed.role_name is null
    union all
    select 'missing_expected_acl_dependency:'||allowed.role_name||':'||allowed.classid::text||':'||allowed.objid::text
    from expected_acl_dependencies allowed
    left join pg_catalog.pg_roles target_role on target_role.rolname=allowed.role_name
    left join pg_catalog.pg_shdepend dependency on dependency.refclassid='pg_catalog.pg_authid'::regclass
      and dependency.refobjid=target_role.oid and dependency.deptype='a'
      and dependency.dbid=allowed.dbid and dependency.classid=allowed.classid
      and dependency.objid=allowed.objid and dependency.objsubid=allowed.objsubid
    where dependency.objid is null
  ), ownership_checks as (
    select 'role_owns_relation:'||target.role_name||':'||namespace.nspname||'.'||relation.relname
    from target_roles target join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_class relation on relation.relowner=target_role.oid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    union all
    select 'role_owns_function:'||target.role_name||':'||namespace.nspname||'.'||procedure.proname
    from target_roles target join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_proc procedure on procedure.proowner=target_role.oid
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    union all
    select 'role_owns_schema:'||target.role_name||':'||namespace.nspname
    from target_roles target join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_namespace namespace on namespace.nspowner=target_role.oid
    union all
    select 'role_owns_database:'||target.role_name||':'||database.datname
    from target_roles target join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_database database on database.datdba=target_role.oid
    union all
    select 'role_owns_catalog_object:'||target.role_name||':'||dependency.dbid::text||':'||
      dependency.classid::regclass::text||':'||dependency.objid::text
    from target_roles target join pg_catalog.pg_roles target_role on target_role.rolname=target.role_name
    join pg_catalog.pg_shdepend dependency on dependency.refclassid='pg_authid'::regclass
      and dependency.refobjid=target_role.oid and dependency.deptype='o'
  ), violations as (
    select check_name from overlay_object_checks
    union all select check_name from role_checks
    union all select * from role_phase_checks
    union all select * from role_setting_checks
    union all select * from membership_checks
    union all select * from relation_acl_checks
    union all select * from column_acl_checks
    union all select * from public_relation_acl_checks
    union all select * from public_column_acl_checks
    union all select * from overlay_relation_acl_checks
    union all select * from overlay_column_acl_checks
    union all select * from effective_overlay_relation_checks
    union all select * from effective_overlay_column_checks
    union all select * from effective_application_relation_checks
    union all select * from effective_application_column_checks
    union all select * from effective_sequence_checks
    union all select * from authority_rpc_checks
    union all select * from expected_rpc_exposure_checks
    union all select * from direct_login_function_checks
    union all select * from effective_routine_checks
    union all select * from schema_acl_checks
    union all select * from effective_schema_checks
    union all select * from database_acl_checks
    union all select * from effective_database_connect_checks
    union all select * from effective_foreign_access_checks
    union all select * from effective_tablespace_checks
    union all select * from default_acl_checks
    union all select * from public_material_default_acl_checks
    union all select * from parameter_acl_checks
    union all select * from large_object_acl_checks
    union all select * from acl_dependency_checks
    union all select * from ownership_checks
  )
  select string_agg(check_name,',' order by check_name) into violation from violations;
  if violation is not null then
    raise exception using errcode='42501',message='square_production_login_verification_failed',detail=violation;
  end if;
end
$verification$;

select 'square_production_overlay_structural_and_authorization_postflight_passed' as nonsecret_result;

select case
  when bool_and(not rolcanlogin and not rolinherit)
    then 'square_production_overlay_staged_role_postflight_passed'
  when bool_and(rolcanlogin and rolinherit)
    then 'square_production_overlay_active_role_postflight_passed'
  else 'square_production_overlay_role_postflight_unreachable'
end as nonsecret_result
from pg_catalog.pg_roles
where rolname=any(array[
  'square_production_oauth','square_production_broker','square_production_scheduler',
  'square_production_webhook','square_production_runtime','square_production_evidence'
]);

-- Final 104-migration runtime catalog and authority checks.  This second
-- verifier is deliberately explicit so a future overlay cannot be mistaken
-- for the internal runtime surface.
do $runtime_catalog$
declare
  relation_name text;
  function_signature text;
  relation_oid oid;
  procedure_oid oid;
  role_oid oid;
  authority_oid oid;
  acl_count integer;
  map record;
  expected_relations text[] := array[
    'private.integration_production_platform_bindings',
    'private.integration_production_provider_bindings',
    'private.integration_production_provider_secrets',
    'private.integration_production_provider_capabilities',
    'private.square_production_configuration_generations',
    'private.square_production_runtime_bindings',
    'private.square_production_generation_fences',
    'private.square_production_lifecycle_audit_events',
    'private.square_production_internal_permits',
    'private.square_production_internal_oauth_states',
    'private.square_production_internal_credentials',
    'private.square_production_internal_scans',
    'private.square_production_internal_page_receipts',
    'private.square_production_internal_source_versions',
    'private.square_production_internal_fences',
    'private.square_production_internal_audit_events'
  ];
  expected_private_functions text[] := array[
    'private.square_production_internal_reject_immutable_mutation_v1()',
    'private.square_production_internal_guard_lifecycle_update_v1()',
    'private.square_production_internal_require_keys_v1(text,text[])',
    'private.square_production_internal_fingerprint_v1(text[])',
    'private.square_production_internal_audit_v1(text,text,text,text,bigint,text,jsonb)',
    'private.square_production_internal_require_login_v1(text)',
    'private.square_production_internal_lock_permit_v1(uuid,text,boolean)',
    'private.square_production_internal_install_permit_v1(jsonb)'
  ];
begin
  foreach relation_name in array expected_relations loop
    relation_oid := to_regclass(relation_name);
    if relation_oid is null or not exists(
      select 1 from pg_class c where c.oid=relation_oid and c.relkind='r'
        and c.relpersistence='p' and c.relowner='postgres'::regrole
        and c.relrowsecurity and c.relforcerowsecurity and not c.relhassubclass
    ) then
      raise exception using errcode='55000',message='square_production_internal_relation_not_exact',detail=relation_name;
    end if;
    if exists(select 1 from pg_policy p where p.polrelid=relation_oid)
      or exists(select 1 from pg_inherits i where i.inhrelid=relation_oid or i.inhparent=relation_oid) then
      raise exception using errcode='55000',message='square_production_internal_relation_boundary_not_exact',detail=relation_name;
    end if;
    if exists(select 1 from aclexplode((select c.relacl from pg_class c where c.oid=relation_oid)) a
      where a.grantee<>('postgres'::regrole)::oid) then
      raise exception using errcode='55000',message='square_production_internal_direct_table_acl_present',detail=relation_name;
    end if;
  end loop;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid=any(
    array(select to_regclass(relation_name_value.name)
      from unnest(expected_relations) as relation_name_value(name)))) <> 23 then
    raise exception using errcode='55000',message='square_production_internal_trigger_inventory_not_exact';
  end if;

  foreach function_signature in array expected_private_functions loop
    procedure_oid := to_regprocedure(function_signature);
    if procedure_oid is null or not exists(select 1 from pg_proc p where p.oid=procedure_oid
      and p.proowner='postgres'::regrole
      and p.prosecdef=(function_signature not like 'private.square_production_internal_require_keys_v1%'
        and function_signature not like 'private.square_production_internal_fingerprint_v1%')
      and p.provolatile in ('i','s','v')
      and p.proconfig @> array['search_path=""']::text[]) then
      raise exception using errcode='55000',message='square_production_internal_private_function_not_exact',detail=function_signature;
    end if;
  end loop;

  for map in select * from (values
    ('public.square_production_internal_oauth_v1(text,jsonb)','square_production_oauth_authority'),
    ('public.square_production_internal_broker_v1(text,jsonb)','square_production_broker_authority'),
    ('public.square_production_internal_runtime_v1(text,jsonb)','square_production_runtime_authority'),
    ('public.square_production_internal_evidence_v1(text,jsonb)','square_production_evidence_authority'),
    ('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)','square_production_scheduler_authority'),
    ('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)','square_production_webhook_authority')
  ) as authority_map(function_signature,authority_name) loop
    procedure_oid := to_regprocedure(map.function_signature);
    authority_oid := (map.authority_name)::regrole::oid;
    if procedure_oid is null then
      raise exception using errcode='55000',message='square_production_public_rpc_missing',detail=map.function_signature;
    end if;
    if map.function_signature like 'public.check_square%' then
      if not exists(select 1 from pg_proc p where p.oid=procedure_oid
        and p.proowner='postgres'::regrole and p.prosecdef and p.prorettype='void'::regtype
        and p.proconfig @> array['search_path=""']::text[]) then
        raise exception using errcode='55000',message='square_production_legacy_rpc_not_exact',detail=map.function_signature;
      end if;
    elsif not exists(select 1 from pg_proc p where p.oid=procedure_oid
      and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v'
      and p.prorettype='jsonb'::regtype and p.proconfig @> array['search_path=""']::text[]) then
      raise exception using errcode='55000',message='square_production_internal_public_rpc_not_exact',detail=map.function_signature;
    end if;
    select count(*) into acl_count from aclexplode((select p.proacl from pg_proc p where p.oid=procedure_oid)) a
      where a.grantee=authority_oid and a.privilege_type='EXECUTE' and not a.is_grantable;
    if acl_count<>1 or exists(select 1 from aclexplode((select p.proacl from pg_proc p where p.oid=procedure_oid)) a
      where a.grantee not in (authority_oid,('postgres'::regrole)::oid)) then
      raise exception using errcode='55000',message='square_production_public_rpc_acl_not_exact',detail=map.function_signature;
    end if;
  end loop;

  foreach relation_name in array array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    role_oid := (relation_name)::regrole::oid;
    if exists(select 1 from pg_roles r where r.oid=role_oid and
      (r.rolcanlogin or r.rolinherit or r.rolsuper or r.rolcreatedb or r.rolcreaterole
       or r.rolreplication or r.rolbypassrls or r.rolconfig is not null)) then
      raise exception using errcode='55000',message='square_production_authority_role_not_fenced',detail=relation_name;
    end if;
    if exists(select 1 from pg_auth_members m where m.member=role_oid
      and (m.inherit_option or m.set_option or m.admin_option)) then
      raise exception using errcode='55000',message='square_production_authority_membership_not_fenced',detail=relation_name;
    end if;
  end loop;
end
$runtime_catalog$;

select 'square_production_internal_runtime_catalog_postflight_passed' as nonsecret_result,
  '20260902191325' as ledger_head,
  'sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f' as ledger_fingerprint,
  'db502e7671028fc9867d49c1b8c198b694d1f07674fe8312bdbc032d80570716' as migration_source_sha256,
  array[
    'public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)',
    'public.square_production_internal_broker_v1(text,jsonb)',
    'public.square_production_internal_evidence_v1(text,jsonb)',
    'public.square_production_internal_oauth_v1(text,jsonb)',
    'public.square_production_internal_runtime_v1(text,jsonb)'
  ]::text[] as authority_rpcs,
  array[
    'private.square_production_internal_reject_immutable_mutation_v1()',
    'private.square_production_internal_guard_lifecycle_update_v1()',
    'private.square_production_internal_require_keys_v1(text,text[])',
    'private.square_production_internal_fingerprint_v1(text[])',
    'private.square_production_internal_audit_v1(text,text,text,text,bigint,text,jsonb)',
    'private.square_production_internal_require_login_v1(text)',
    'private.square_production_internal_lock_permit_v1(uuid,bigint)',
    'private.square_production_internal_install_permit_v1(jsonb)',
    'public.square_production_internal_oauth_v1(text,jsonb)',
    'public.square_production_internal_broker_v1(text,jsonb)',
    'public.square_production_internal_runtime_v1(text,jsonb)',
    'public.square_production_internal_evidence_v1(text,jsonb)'
  ]::text[] as required_functions;
rollback;
