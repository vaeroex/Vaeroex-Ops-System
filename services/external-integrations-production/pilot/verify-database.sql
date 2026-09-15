\set ON_ERROR_STOP on

-- Read-only post-provisioning verification. This script creates no role, grant,
-- credential, table, function, connection, mapping or activation record.
begin transaction read only;

do $verification$
declare
  violation text;
begin
  with expected(login_name,authority_name) as (values
    ('square_production_oauth','square_production_oauth_authority'),
    ('square_production_broker','square_production_broker_authority'),
    ('square_production_scheduler','square_production_scheduler_authority'),
    ('square_production_webhook','square_production_webhook_authority'),
    ('square_production_runtime','square_production_runtime_authority'),
    ('square_production_evidence','square_production_evidence_authority')
  ), role_checks as (
    select 'login_attributes:'||expected.login_name check_name
    from expected left join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    where login_role.oid is null or not login_role.rolcanlogin or not login_role.rolinherit
      or login_role.rolsuper or login_role.rolcreatedb or login_role.rolcreaterole
      or login_role.rolreplication or login_role.rolbypassrls or login_role.rolconfig is not null
    union all
    select 'authority_attributes:'||expected.authority_name
    from expected left join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    where authority_role.oid is null or authority_role.rolcanlogin or authority_role.rolinherit
      or authority_role.rolsuper or authority_role.rolcreatedb or authority_role.rolcreaterole
      or authority_role.rolreplication or authority_role.rolbypassrls or authority_role.rolconfig is not null
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
  ), table_acl_checks as (
    select 'direct_table_acl:'||grantee.rolname||':'||namespace.nspname||'.'||relation.relname
    from expected
    join pg_catalog.pg_roles grantee on grantee.rolname in (expected.login_name,expected.authority_name)
    join pg_catalog.pg_class relation on true
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(relation.relacl) acl
    where acl.grantee=grantee.oid and namespace.nspname in ('private','public')
      and relation.relkind in ('r','p','v','m','f','S')
  ), authority_rpc_checks as (
    select 'authority_without_explicit_rpc:'||expected.authority_name
    from expected
    join pg_catalog.pg_roles authority_role on authority_role.rolname=expected.authority_name
    where not exists (
      select 1 from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
      where acl.grantee=authority_role.oid and acl.privilege_type='EXECUTE'
        and namespace.nspname in ('private','public')
    )
  ), direct_function_checks as (
    select 'direct_login_function_acl:'||login_role.rolname||':'||namespace.nspname||'.'||procedure.proname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_proc procedure on true
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(procedure.proacl) acl
    where acl.grantee=login_role.oid and namespace.nspname in ('private','public')
  ), direct_container_acl_checks as (
    select 'direct_login_schema_acl:'||login_role.rolname||':'||namespace.nspname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_namespace namespace on namespace.nspname in ('private','public')
    cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
    where acl.grantee=login_role.oid
    union all
    select 'direct_login_database_acl:'||login_role.rolname||':'||database.datname
    from expected
    join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_database database on database.datname=current_database()
    cross join lateral pg_catalog.aclexplode(database.datacl) acl
    where acl.grantee=login_role.oid
  ), ownership_checks as (
    select 'login_owns_relation:'||login_role.rolname||':'||namespace.nspname||'.'||relation.relname
    from expected join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_class relation on relation.relowner=login_role.oid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    union all
    select 'login_owns_function:'||login_role.rolname||':'||namespace.nspname||'.'||procedure.proname
    from expected join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_proc procedure on procedure.proowner=login_role.oid
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    union all
    select 'login_owns_schema:'||login_role.rolname||':'||namespace.nspname
    from expected join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_namespace namespace on namespace.nspowner=login_role.oid
    union all
    select 'login_owns_database:'||login_role.rolname||':'||database.datname
    from expected join pg_catalog.pg_roles login_role on login_role.rolname=expected.login_name
    join pg_catalog.pg_database database on database.datdba=login_role.oid
  ), violations as (
    select check_name from role_checks
    union all select * from membership_checks
    union all select * from table_acl_checks
    union all select * from authority_rpc_checks
    union all select * from direct_function_checks
    union all select * from direct_container_acl_checks
    union all select * from ownership_checks
  )
  select string_agg(check_name,',' order by check_name) into violation from violations;
  if violation is not null then
    raise exception using errcode='42501',message='square_production_login_verification_failed',detail=violation;
  end if;
end
$verification$;

select 'square_production_login_verification_passed' as nonsecret_result;
rollback;
