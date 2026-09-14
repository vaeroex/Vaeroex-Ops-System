-- Square-specific Production runtime overlay.
-- This migration remains unapplied until the complete Square lifecycle schema
-- is independently present and qualified. It fails before mutation when its
-- prerequisites are absent; the provider-neutral foundation can be applied
-- independently to the existing Production database baseline.
begin;

do $prerequisites$
begin
  if pg_catalog.to_regclass('private.integration_production_provider_bindings') is null or
     pg_catalog.to_regclass('private.square_account_configuration') is null or
     not exists(select 1 from pg_catalog.pg_roles where rolname='square_production_runtime_authority') then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_prerequisite_missing';
  end if;
end
$prerequisites$;

-- The lifecycle configuration stores checked login names in PostgreSQL's name
-- type. Keep their conversions inside this immutable helper so generated-column
-- validation sees one immutable call and the fingerprint tracks the stored tuple.
create function private.square_production_configuration_fingerprint_v1(
  p_environment text,
  p_application_id text,
  p_redirect_uri text,
  p_broker_login name,
  p_enrollment_login name,
  p_webhook_login name,
  p_kms_key_resource text
)
returns text
language sql
immutable
strict
parallel safe
set search_path=''
as $function$
  select private.integration_production_fingerprint_v1(array[
    p_environment,
    p_application_id,
    p_redirect_uri,
    p_broker_login::text,
    p_enrollment_login::text,
    p_webhook_login::text,
    p_kms_key_resource
  ])
$function$;

revoke all on function private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text)
  from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

alter table private.square_account_configuration add column square_production_binding_fingerprint text
  generated always as (private.square_production_configuration_fingerprint_v1(
    environment,application_id,redirect_uri,broker_login,enrollment_login,webhook_login,kms_key_resource
  )) stored;
alter table private.square_account_configuration add column square_production_authority_fingerprint text
  generated always as (private.integration_production_fingerprint_v1(array[
    'square',environment,application_id,redirect_uri,kms_key_resource
  ])) stored;
alter table private.square_account_configuration add constraint square_account_configuration_production_fingerprint_check
  check(square_production_binding_fingerprint ~ '^sha256:[a-f0-9]{64}$'
    and square_production_authority_fingerprint ~ '^sha256:[a-f0-9]{64}$');
create unique index square_account_configuration_production_binding_idx
  on private.square_account_configuration(environment,square_production_authority_fingerprint,square_production_binding_fingerprint);

create table private.square_production_runtime_binding (
  provider_key text not null default 'square' check(provider_key='square'),
  environment text not null default 'production' check(environment='production'),
  application_id text not null check(application_id ~ '^sq0idp-[A-Za-z0-9_-]+$'),
  callback_uri text not null,
  api_version text not null check(api_version='2026-08-19'),
  authorization_endpoint text not null check(authorization_endpoint='https://connect.squareup.com/oauth2/authorize'),
  provider_origin text not null check(provider_origin='https://connect.squareup.com'),
  requested_scopes text[] not null check(requested_scopes=array['INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ']::text[]),
  kms_key_resource text not null,
  provider_authority_fingerprint text generated always as (private.integration_production_fingerprint_v1(array[
    provider_key,environment,application_id,callback_uri,kms_key_resource
  ])) stored,
  square_configuration_authority_fingerprint text generated always as (private.integration_production_fingerprint_v1(array[
    'square',environment,application_id,callback_uri,kms_key_resource
  ])) stored,
  square_configuration_fingerprint text not null,
  provider_policy_version text not null check(length(provider_policy_version) between 1 and 128),
  provider_policy_fingerprint text not null check(provider_policy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  primary key(provider_key,environment,application_id),
  foreign key(provider_key,environment)
    references private.integration_production_provider_bindings(provider_key,environment) on delete restrict,
  foreign key(provider_key,environment,provider_authority_fingerprint)
    references private.integration_production_provider_bindings(provider_key,environment,provider_authority_fingerprint) on delete restrict,
  constraint square_production_runtime_binding_configuration_fkey
    foreign key(environment,square_configuration_authority_fingerprint,square_configuration_fingerprint)
    references private.square_account_configuration(environment,square_production_authority_fingerprint,square_production_binding_fingerprint)
    on update restrict on delete restrict
);
alter table private.square_production_runtime_binding enable row level security;
alter table private.square_production_runtime_binding force row level security;
revoke all on table private.square_production_runtime_binding from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

commit;
