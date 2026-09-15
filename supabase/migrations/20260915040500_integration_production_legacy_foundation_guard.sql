-- A database that previously applied the old all-in-one 20260912190000
-- migration can contain a Square-specific runtime overlay. Do not guess at or
-- silently rewrite that authority state. Abort the forward path until a
-- separately reviewed reconciliation migration is available.
begin;

do $legacy_overlay_guard$
declare
  marker_owner oid;
  marker_record record;
  object_name text;
  object_record record;
  role_name text;
  role_record record;
  schema_digest text;
begin
  if to_regprocedure('private.integration_production_foundation_split_marker_v1()') is null then
    raise exception 'integration_production_legacy_foundation_requires_review'
      using errcode = '55000';
  end if;
  select marker_function.proowner,marker_function.provolatile,
      marker_function.proisstrict,marker_function.proparallel,
      marker_function.prosecdef,marker_function.proconfig,marker_function.prosrc,
      marker_function.prokind,marker_function.pronargs,marker_function.prorettype,
      marker_language.lanname
    into strict marker_record
  from pg_catalog.pg_proc marker_function
  join pg_catalog.pg_language marker_language on marker_language.oid=marker_function.prolang
  where marker_function.oid=
    'private.integration_production_foundation_split_marker_v1()'::regprocedure;
  if marker_record.proowner <> current_user::regrole::oid
    or marker_record.provolatile <> 'i'
    or marker_record.proisstrict
    or marker_record.proparallel <> 's'
    or marker_record.prosecdef
    or marker_record.proconfig is distinct from array['search_path=""']
    or marker_record.prokind <> 'f'
    or marker_record.pronargs <> 0
    or marker_record.prorettype <> 'text'::regtype
    or marker_record.lanname <> 'sql'
    or pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(marker_record.prosrc,'UTF8'),'sha256'),
      'hex'
    ) <> 'dfd23104a61cf287a6f4425453ff83008c80fa1214884ac13f0c8bf948723ecf'
    or exists (
      select 1
      from pg_catalog.pg_proc marker_function
      cross join lateral pg_catalog.aclexplode(marker_function.proacl) marker_acl
      where marker_function.oid=
        'private.integration_production_foundation_split_marker_v1()'::regprocedure
        and marker_acl.grantee<>marker_function.proowner
    ) then
    raise exception 'integration_production_legacy_foundation_requires_review'
      using errcode = '55000';
  end if;

  if to_regclass('private.square_production_runtime_binding') is not null
    or to_regprocedure('private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text)') is not null
    or exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = to_regclass('private.square_account_configuration')
        and attname in (
          'square_production_binding_fingerprint',
          'square_production_authority_fingerprint'
        )
        and not attisdropped
    ) then
    raise exception 'integration_production_legacy_overlay_requires_review'
      using errcode = '55000';
  end if;

  if to_regprocedure('private.integration_production_fingerprint_v1(text[])') is null
    or to_regclass('private.integration_production_platform_bindings') is null
    or to_regclass('private.integration_production_provider_bindings') is null
    or to_regclass('private.integration_production_provider_secrets') is null
    or to_regclass('private.integration_production_provider_capabilities') is null then
    raise exception 'integration_production_foundation_missing'
      using errcode = '55000';
  end if;

  marker_owner := marker_record.proowner;

  foreach object_name in array array[
    'private.integration_production_platform_bindings',
    'private.integration_production_provider_bindings',
    'private.integration_production_provider_secrets',
    'private.integration_production_provider_capabilities'
  ] loop
    select relkind,relowner,relrowsecurity,relforcerowsecurity
      into strict object_record
    from pg_catalog.pg_class
    where oid=object_name::regclass;
    if object_record.relkind <> 'r'
      or object_record.relowner <> marker_owner
      or not object_record.relrowsecurity
      or not object_record.relforcerowsecurity
      or exists (
        select 1
        from pg_catalog.pg_inherits inheritance
        where inheritance.inhrelid=object_name::regclass
          or inheritance.inhparent=object_name::regclass
      )
      or exists (
        select 1
        from pg_catalog.pg_class relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) relation_acl
        where relation.oid=object_name::regclass
          and relation_acl.grantee<>relation.relowner
      )
      or exists (
        select 1
        from pg_catalog.pg_attribute attribute
        cross join lateral pg_catalog.aclexplode(attribute.attacl) column_acl
        where attribute.attrelid=object_name::regclass
          and not attribute.attisdropped
          and column_acl.grantee<>object_record.relowner
      ) then
      raise exception 'integration_production_foundation_relation_drift'
        using errcode = '55000';
    end if;

    foreach role_name in array array[
      'anon','authenticated','service_role',
      'square_production_oauth_authority','square_production_broker_authority',
      'square_production_scheduler_authority','square_production_webhook_authority',
      'square_production_runtime_authority','square_production_evidence_authority'
    ] loop
      if to_regrole(role_name) is not null and (
        pg_catalog.has_table_privilege(role_name,object_name,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid=object_name::regclass
            and attribute.attnum>0
            and not attribute.attisdropped
            and pg_catalog.has_column_privilege(role_name,object_name,attribute.attname,
              'SELECT,INSERT,UPDATE,REFERENCES')
        )
      ) then
        raise exception 'integration_production_foundation_effective_acl_drift'
          using errcode = '55000';
      end if;
    end loop;
  end loop;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to((pg_catalog.jsonb_build_object(
    'columns',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        relation.relname,attribute.attnum,attribute.attname,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        attribute.attnotnull,attribute.attidentity,attribute.attgenerated,
        pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true)
      ) order by relation.relname,attribute.attnum)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
      left join pg_catalog.pg_attrdef default_value
        on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
      where namespace.nspname='private'
        and relation.relname=any(array[
          'integration_production_platform_bindings','integration_production_provider_bindings',
          'integration_production_provider_secrets','integration_production_provider_capabilities'
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
        'integration_production_platform_bindings','integration_production_provider_bindings',
        'integration_production_provider_secrets','integration_production_provider_capabilities'
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
        'integration_production_platform_bindings','integration_production_provider_bindings',
        'integration_production_provider_secrets','integration_production_provider_capabilities'
      ])
    ),'[]'::jsonb),
    'policy_count',(select count(*) from pg_catalog.pg_policy policy_record
      where policy_record.polrelid=any(array[
        'private.integration_production_platform_bindings'::regclass,
        'private.integration_production_provider_bindings'::regclass,
        'private.integration_production_provider_secrets'::regclass,
        'private.integration_production_provider_capabilities'::regclass
      ])),
    'trigger_count',(select count(*) from pg_catalog.pg_trigger trigger_record
      where not trigger_record.tgisinternal and trigger_record.tgrelid=any(array[
        'private.integration_production_platform_bindings'::regclass,
        'private.integration_production_provider_bindings'::regclass,
        'private.integration_production_provider_secrets'::regclass,
        'private.integration_production_provider_capabilities'::regclass
      ]))
  ))::text,'UTF8'),'sha256'),'hex') into strict schema_digest;
  if schema_digest <> 'e4ee030adb2300c1c360569d45e5f057066539d60b9522c08cfa6e2f43c28dc8' then
    raise exception 'integration_production_foundation_schema_drift'
      using errcode='55000';
  end if;

  select proowner,provolatile,proisstrict,proparallel,prosecdef,proconfig,prosrc
    into strict object_record
  from pg_catalog.pg_proc
  where oid='private.integration_production_fingerprint_v1(text[])'::regprocedure;
  if object_record.proowner <> marker_owner
    or object_record.provolatile <> 'i'
    or not object_record.proisstrict
    or object_record.proparallel <> 's'
    or object_record.prosecdef
    or object_record.proconfig is distinct from array['search_path=""']
    or pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(object_record.prosrc,'UTF8'),'sha256'),
      'hex'
    ) <> '98a86fc4d75c479b10ae63900cdf1c03a5083fb59a52d61636cc3a886acfa096'
    or exists (
      select 1
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid='private.integration_production_fingerprint_v1(text[])'::regprocedure
        and function_acl.grantee<>function_record.proowner
    ) then
    raise exception 'integration_production_foundation_function_drift'
      using errcode = '55000';
  end if;
  foreach role_name in array array[
    'anon','authenticated','service_role',
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    if to_regrole(role_name) is not null
      and pg_catalog.has_function_privilege(
        role_name,'private.integration_production_fingerprint_v1(text[])','EXECUTE') then
      raise exception 'integration_production_foundation_function_acl_drift'
        using errcode = '55000';
    end if;
  end loop;

  -- Stored generated values are not recomputed when an immutable helper is
  -- replaced and later restored. Authenticate every retained value against the
  -- reviewed helper before a later provider overlay may rely on these columns.
  -- `row_security=off` never weakens access: PostgreSQL either gives a
  -- BYPASSRLS-capable migration actor the physical rows or raises rather than
  -- silently applying a policy. Thus inability to prove the values aborts.
  perform pg_catalog.set_config('row_security','off',true);
  if exists (
    select 1
    from private.integration_production_platform_bindings platform_binding
    where platform_binding.platform_fingerprint is distinct from
      private.integration_production_fingerprint_v1(array[
        platform_binding.binding_key,platform_binding.project_id,
        platform_binding.project_number,platform_binding.region,
        platform_binding.source_commit
      ])
  ) or exists (
    select 1
    from private.integration_production_provider_bindings provider_binding
    where provider_binding.provider_authority_fingerprint is distinct from
      private.integration_production_fingerprint_v1(array[
        provider_binding.provider_key,provider_binding.environment,
        provider_binding.application_id,provider_binding.callback_uri,
        provider_binding.kms_key_resource
      ])
  ) then
    raise exception 'integration_production_foundation_stored_fingerprint_drift'
      using errcode = '55000';
  end if;

  foreach role_name in array array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    select * into role_record from pg_catalog.pg_roles where rolname=role_name;
    if not found
      or role_record.rolcanlogin or role_record.rolinherit or role_record.rolsuper
      or role_record.rolcreatedb or role_record.rolcreaterole
      or role_record.rolreplication or role_record.rolbypassrls
      or role_record.rolconfig is not null
      or exists (
        select 1
        from pg_catalog.pg_auth_members membership
        left join pg_catalog.pg_roles member_role on member_role.oid=membership.member
        where membership.member=role_record.oid or (
          membership.roleid=role_record.oid and (
            membership.inherit_option or membership.set_option
            or not membership.admin_option
            or not (member_role.rolsuper or member_role.rolcreaterole)
          )
        )
      )
      or exists (
        select 1
        from pg_catalog.pg_shdepend dependency
        where dependency.refclassid='pg_authid'::regclass
          and dependency.refobjid=role_record.oid
          and dependency.deptype in ('a','o')
          and not (
            dependency.deptype='a'
            and dependency.dbid=(select oid from pg_catalog.pg_database where datname=current_database())
            and dependency.classid='pg_namespace'::regclass
            and dependency.objid='public'::regnamespace
            and dependency.objsubid=0
          )
      )
      or 1 <> (
        select count(*)
        from pg_catalog.pg_namespace public_schema
        cross join lateral pg_catalog.aclexplode(public_schema.nspacl) schema_acl
        where public_schema.oid='public'::regnamespace
          and schema_acl.grantee=role_record.oid
          and schema_acl.privilege_type='USAGE'
          and not schema_acl.is_grantable
      )
      or pg_catalog.has_schema_privilege(role_name,'public','CREATE')
      or 1 < (select count(*) from pg_catalog.pg_auth_members where roleid=role_record.oid)
    then
      raise exception 'integration_production_foundation_role_drift'
        using errcode = '55000';
    end if;
  end loop;
end
$legacy_overlay_guard$;

commit;
