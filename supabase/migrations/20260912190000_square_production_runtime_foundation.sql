-- Historical version retained so databases that recorded the former all-in-one
-- migration keep a continuous ledger. New installations receive only the
-- provider-neutral foundation from 20260902191323; the Square overlay remains
-- deliberately deferred.
begin;

do $foundation_present$
begin
  if to_regprocedure('private.integration_production_fingerprint_v1(text[])') is null
    or to_regclass('private.integration_production_platform_bindings') is null
    or to_regclass('private.integration_production_provider_bindings') is null
    or to_regclass('private.integration_production_provider_secrets') is null
    or to_regclass('private.integration_production_provider_capabilities') is null then
    raise exception 'integration_production_foundation_missing'
      using errcode = '55000';
  end if;
end
$foundation_present$;

create function private.integration_production_foundation_split_marker_v1()
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select '20260902191323_provider_neutral'::text
$function$;

revoke all on function private.integration_production_foundation_split_marker_v1()
  from public, anon, authenticated, service_role;

do $closed_marker_acl$
declare
  marker_owner oid;
  grantee_oid oid;
  grantee_name name;
begin
  select proowner into strict marker_owner
  from pg_catalog.pg_proc
  where oid='private.integration_production_foundation_split_marker_v1()'::regprocedure;
  for grantee_oid in
    select distinct marker_acl.grantee
    from pg_catalog.pg_proc marker_function
    cross join lateral pg_catalog.aclexplode(marker_function.proacl) marker_acl
    where marker_function.oid=
      'private.integration_production_foundation_split_marker_v1()'::regprocedure
      and marker_acl.grantee<>marker_function.proowner
  loop
    if grantee_oid=0 then
      execute 'revoke all on function private.integration_production_foundation_split_marker_v1() from public';
    else
      select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
      execute pg_catalog.format(
        'revoke all on function private.integration_production_foundation_split_marker_v1() from %I',
        grantee_name
      );
    end if;
  end loop;
  if exists (
    select 1
    from pg_catalog.pg_proc marker_function
    cross join lateral pg_catalog.aclexplode(marker_function.proacl) marker_acl
    where marker_function.oid=
      'private.integration_production_foundation_split_marker_v1()'::regprocedure
      and marker_acl.grantee<>marker_owner
  ) then
    raise exception 'integration_production_foundation_marker_acl_not_closed'
      using errcode='42501';
  end if;
end
$closed_marker_acl$;

commit;
