-- A database that previously applied the old all-in-one 20260912190000
-- migration can contain a Square-specific runtime overlay. Do not guess at or
-- silently rewrite that authority state. Abort the forward path until a
-- separately reviewed reconciliation migration is available.
begin;

do $legacy_overlay_guard$
declare
  marker_owner oid;
  object_name text;
  object_record record;
  role_name text;
  role_record record;
begin
  if to_regprocedure('private.integration_production_foundation_split_marker_v1()') is null then
    raise exception 'integration_production_legacy_foundation_requires_review'
      using errcode = '55000';
  end if;
  if private.integration_production_foundation_split_marker_v1()
      is distinct from '20260902191323_provider_neutral' then
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

  select proowner into strict marker_owner
  from pg_catalog.pg_proc
  where oid = 'private.integration_production_foundation_split_marker_v1()'::regprocedure;
  if marker_owner <> current_user::regrole::oid then
    raise exception 'integration_production_foundation_owner_drift'
      using errcode = '55000';
  end if;

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
      or 1 < (select count(*) from pg_catalog.pg_auth_members where roleid=role_record.oid)
    then
      raise exception 'integration_production_foundation_role_drift'
        using errcode = '55000';
    end if;
  end loop;
end
$legacy_overlay_guard$;

commit;
