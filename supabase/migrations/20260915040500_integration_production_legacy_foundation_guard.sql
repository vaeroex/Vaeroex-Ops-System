-- A database that previously applied the old all-in-one 20260912190000
-- migration can contain a Square-specific runtime overlay. Do not guess at or
-- silently rewrite that authority state. Abort the forward path until a
-- separately reviewed reconciliation migration is available.
begin;

do $legacy_overlay_guard$
begin
  if to_regclass('private.square_production_runtime_binding') is not null
    or to_regprocedure('private.square_production_fingerprint_v1(text[])') is not null
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
end
$legacy_overlay_guard$;

commit;
