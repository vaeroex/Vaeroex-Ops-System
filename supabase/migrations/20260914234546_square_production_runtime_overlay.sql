-- Square-specific Production runtime overlay.
-- This migration remains unapplied until the complete Square lifecycle schema
-- is independently present and qualified. It fails before mutation when its
-- prerequisites are absent; the provider-neutral foundation can be applied
-- independently to the existing Production database baseline.
begin;

do $prerequisites$
declare
  existing_objects integer;
  legacy_has_rows boolean;
  shared_fingerprint_proc pg_catalog.pg_proc;
begin
  if pg_catalog.to_regclass('private.integration_production_provider_bindings') is null or
     pg_catalog.to_regclass('private.square_account_configuration') is null or
     not exists(select 1 from pg_catalog.pg_roles where rolname='square_production_runtime_authority') then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_prerequisite_missing';
  end if;

  select * into strict shared_fingerprint_proc from pg_catalog.pg_proc
    where oid='private.integration_production_fingerprint_v1(text[])'::regprocedure;
  if shared_fingerprint_proc.provolatile<>'i' or not shared_fingerprint_proc.proisstrict or
     shared_fingerprint_proc.proparallel<>'s' or shared_fingerprint_proc.prosecdef or
     shared_fingerprint_proc.prolang<>(select oid from pg_catalog.pg_language where lanname='sql') or
     shared_fingerprint_proc.prorettype<>'text'::regtype or shared_fingerprint_proc.proretset or
     shared_fingerprint_proc.proowner<>(select relowner from pg_catalog.pg_class
       where oid='private.integration_production_provider_bindings'::regclass) or
     (shared_fingerprint_proc.proconfig is distinct from array['search_path=']::text[] and
       shared_fingerprint_proc.proconfig is distinct from array['search_path=""']::text[]) then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_shared_foundation_attributes_drifted';
  end if;
  if private.integration_production_fingerprint_v1(array['a','bc']) is distinct from
       'sha256:5310a58788781ab25d5ad7c3f85035824b4eb7bdfa394e0ac2186271472b5492' or
     private.integration_production_fingerprint_v1(array['ab','c']) is distinct from
       'sha256:430fb1b4ac43316eca81fab27a1930ab8eff8fef6a1dc7903dce44bbc2790dc5' or
     private.integration_production_fingerprint_v1(array['😀','é']) is distinct from
       'sha256:593164a79cde1d1952d300c7b69debdd616ca5be29a3acd918edc768cda6a719' or
     private.integration_production_fingerprint_v1(array[
       'square','production','sq0idp-Authority_App',
       'https://square.vaeroex.com/api/integrations/square/callback',
       'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/integration-production/cryptoKeys/square'
     ]) is distinct from
       'sha256:92e720a00023fd7fcfc813e41d43db2339591f8bfabd0da3292e465f7159d34a' or
     private.integration_production_fingerprint_v1(array[
       'production','sq0idp-Authority_App',
       'https://square.vaeroex.com/api/integrations/square/callback',
       'square_production_broker_login','square_production_enrollment_login',
       'square_production_webhook_login',
       'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/integration-production/cryptoKeys/square'
     ]) is distinct from
       'sha256:8e1b2ec3f53655304d7ed20ae67243fd8b8f1e8ad846148d7ce617006e5df1f0' then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_shared_foundation_semantics_drifted';
  end if;
  if not exists(
       select 1
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_attrdef definition
         on definition.adrelid=attribute.attrelid and definition.adnum=attribute.attnum
       where attribute.attrelid='private.integration_production_provider_bindings'::regclass
         and attribute.attname='provider_authority_fingerprint'
         and attribute.atttypid='text'::regtype
         and attribute.attgenerated='s'
         and not attribute.attisdropped
         and pg_catalog.regexp_replace(
           pg_catalog.pg_get_expr(definition.adbin,definition.adrelid,false),
           '[[:space:]]','','g'
         )='private.integration_production_fingerprint_v1(ARRAY[provider_key,environment,application_id,callback_uri,kms_key_resource])'
     ) then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_provider_fingerprint_definition_drifted';
  end if;
  if exists(select 1
       from pg_catalog.unnest(array[
         'anon','authenticated','service_role',
         'square_production_oauth_authority','square_production_broker_authority',
         'square_production_scheduler_authority','square_production_webhook_authority',
         'square_production_runtime_authority','square_production_evidence_authority'
       ]::text[]) denied_role(role_name)
       where pg_catalog.has_function_privilege(
         role_name,
         'private.integration_production_fingerprint_v1(text[])',
         'EXECUTE'
       )) then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_shared_foundation_acl_drifted';
  end if;

  select
    (pg_catalog.to_regprocedure('private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text)') is not null)::integer +
    exists(select 1 from pg_catalog.pg_attribute where attrelid='private.square_account_configuration'::regclass and attname='square_production_binding_fingerprint' and not attisdropped)::integer +
    exists(select 1 from pg_catalog.pg_attribute where attrelid='private.square_account_configuration'::regclass and attname='square_production_authority_fingerprint' and not attisdropped)::integer +
    exists(select 1 from pg_catalog.pg_constraint where conrelid='private.square_account_configuration'::regclass and conname='square_account_configuration_production_fingerprint_check')::integer +
    (pg_catalog.to_regclass('private.square_account_configuration_production_binding_idx') is not null)::integer +
    (pg_catalog.to_regclass('private.square_production_runtime_binding') is not null)::integer
  into existing_objects;

  if existing_objects not in (0,6) then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_partial_or_drifted';
  end if;

  if existing_objects=6 then
    execute 'lock table private.square_production_runtime_binding in access exclusive mode';
    execute 'select exists(select 1 from private.square_production_runtime_binding)' into legacy_has_rows;
    if legacy_has_rows then
      raise exception using
        errcode='55000',
        message='square_production_runtime_overlay_nonempty_reconciliation_required';
    end if;
  end if;
end
$prerequisites$;

-- A previous repository revision installed the Square overlay inside the
-- historical foundation migration. Its dormant table was required to remain
-- empty. Rebuild that exact empty overlay transactionally so ACL, column,
-- generated-expression and constraint drift cannot survive this split. No
-- CASCADE is used: any unknown dependency aborts the migration intact.
drop table if exists private.square_production_runtime_binding;
drop index if exists private.square_account_configuration_production_binding_idx;
alter table private.square_account_configuration
  drop constraint if exists square_account_configuration_production_fingerprint_check;
alter table private.square_account_configuration
  drop column if exists square_production_binding_fingerprint;
alter table private.square_account_configuration
  drop column if exists square_production_authority_fingerprint;
drop function if exists private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text);

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

do $validated$
declare
  fingerprint_proc pg_catalog.pg_proc;
  binding_column pg_catalog.pg_attribute;
  authority_column pg_catalog.pg_attribute;
begin
  select * into strict fingerprint_proc from pg_catalog.pg_proc
    where oid='private.square_production_configuration_fingerprint_v1(text,text,text,name,name,name,text)'::regprocedure;
  select * into strict binding_column from pg_catalog.pg_attribute
    where attrelid='private.square_account_configuration'::regclass
      and attname='square_production_binding_fingerprint' and not attisdropped;
  select * into strict authority_column from pg_catalog.pg_attribute
    where attrelid='private.square_account_configuration'::regclass
      and attname='square_production_authority_fingerprint' and not attisdropped;

  if fingerprint_proc.provolatile<>'i' or not fingerprint_proc.proisstrict or
     fingerprint_proc.proparallel<>'s' or fingerprint_proc.prosecdef or
     fingerprint_proc.proconfig<>array['search_path=']::text[] and
       fingerprint_proc.proconfig<>array['search_path=""']::text[] or
     binding_column.atttypid<>'text'::regtype or binding_column.attgenerated<>'s' or
     authority_column.atttypid<>'text'::regtype or authority_column.attgenerated<>'s' or
     not exists(select 1 from pg_catalog.pg_constraint
       where conrelid='private.square_account_configuration'::regclass
         and conname='square_account_configuration_production_fingerprint_check'
         and contype='c' and convalidated) or
     not exists(select 1 from pg_catalog.pg_index
       where indexrelid='private.square_account_configuration_production_binding_idx'::regclass
         and indrelid='private.square_account_configuration'::regclass
         and indisunique and indisvalid and indislive) or
     not exists(select 1 from pg_catalog.pg_class
       where oid='private.square_production_runtime_binding'::regclass
         and relkind='r' and relrowsecurity and relforcerowsecurity) or
     not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='private.square_production_runtime_binding'::regclass
         and c.contype='p' and c.convalidated
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.conkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
           =array['provider_key','environment','application_id']::text[]) or
     not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='private.square_production_runtime_binding'::regclass
         and c.contype='f' and c.convalidated
         and c.confrelid='private.integration_production_provider_bindings'::regclass
         and c.confupdtype='a' and c.confdeltype='r'
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.conkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
           =array['provider_key','environment']::text[]
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.confkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
           =array['provider_key','environment']::text[]) or
     not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='private.square_production_runtime_binding'::regclass
         and c.contype='f' and c.convalidated
         and c.confrelid='private.integration_production_provider_bindings'::regclass
         and c.confupdtype='a' and c.confdeltype='r'
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.conkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
           =array['provider_key','environment','provider_authority_fingerprint']::text[]
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.confkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
           =array['provider_key','environment','provider_authority_fingerprint']::text[]) or
     not exists(select 1 from pg_catalog.pg_constraint c
       where c.conrelid='private.square_production_runtime_binding'::regclass
         and c.conname='square_production_runtime_binding_configuration_fkey'
         and c.contype='f' and c.convalidated
         and c.confrelid='private.square_account_configuration'::regclass
         and c.confupdtype='r' and c.confdeltype='r'
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.conkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
           =array['environment','square_configuration_authority_fingerprint','square_configuration_fingerprint']::text[]
         and (select pg_catalog.array_agg(a.attname::text order by k.ordinality)
           from pg_catalog.unnest(c.confkey) with ordinality k(attnum,ordinality)
           join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)
           =array['environment','square_production_authority_fingerprint','square_production_binding_fingerprint']::text[]) or
     exists(select 1
       from pg_catalog.unnest(array[
         'anon','authenticated','service_role',
         'square_production_oauth_authority','square_production_broker_authority',
         'square_production_scheduler_authority','square_production_webhook_authority',
         'square_production_runtime_authority','square_production_evidence_authority'
       ]::text[]) denied_role(role_name)
       cross join pg_catalog.unnest(array[
         'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
       ]::text[]) denied_privilege(privilege_name)
       where pg_catalog.has_table_privilege(role_name,'private.square_production_runtime_binding',privilege_name)) or
     exists(select 1
       from pg_catalog.unnest(array[
         'anon','authenticated','service_role',
         'square_production_oauth_authority','square_production_broker_authority',
         'square_production_scheduler_authority','square_production_webhook_authority',
         'square_production_runtime_authority','square_production_evidence_authority'
       ]::text[]) denied_role(role_name)
       cross join pg_catalog.unnest(array[
         'SELECT','INSERT','UPDATE','REFERENCES'
       ]::text[]) denied_column_privilege(privilege_name)
       where pg_catalog.has_any_column_privilege(role_name,'private.square_production_runtime_binding',privilege_name)) then
    raise exception using
      errcode='55000',
      message='square_production_runtime_overlay_partial_or_drifted';
  end if;
end
$validated$;

commit;
