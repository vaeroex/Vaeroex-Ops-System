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

commit;
