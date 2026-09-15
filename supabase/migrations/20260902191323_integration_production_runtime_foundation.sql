-- Closed-by-default Production Integration Platform composition authority.
-- Existing provider-neutral connection, task, checkpoint, webhook, rate-limit,
-- source, reconciliation and KPI tables remain the only durable data plane.
-- This migration creates no LOGIN, secret, connection, mapping, task, provider
-- call, customer surface, economic contribution or AI dispatch.
begin;

do $roles$
declare role_name text;
declare role_record pg_catalog.pg_roles;
begin
  foreach role_name in array array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    select * into role_record from pg_catalog.pg_roles where rolname=role_name;
    if not found then
      execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',role_name);
      select * into strict role_record from pg_catalog.pg_roles where rolname=role_name;
    end if;

    -- PostgreSQL 16+ records one automatic ADMIN-only membership for a
    -- non-superuser CREATEROLE actor. Its bootstrap-superuser grantor prevents
    -- that actor from revoking it. It grants neither INHERIT nor SET authority,
    -- and the member is already a role administrator. Permit at most that exact
    -- administrative edge; reject all assumable, inheritable, outbound,
    -- non-administrative, or additional memberships.
    if role_record.rolcanlogin or role_record.rolinherit or role_record.rolsuper or
      role_record.rolcreatedb or role_record.rolcreaterole or role_record.rolreplication or
      role_record.rolbypassrls or role_record.rolconfig is not null or exists(
        select 1
        from pg_catalog.pg_auth_members m
        left join pg_catalog.pg_roles member_role on member_role.oid=m.member
        where m.member=role_record.oid or (
          m.roleid=role_record.oid and (
            m.inherit_option or m.set_option or not m.admin_option or
            not (member_role.rolsuper or member_role.rolcreaterole)
          )
        )
      ) or exists(
        select 1
        from pg_catalog.pg_shdepend dependency
        where dependency.refclassid='pg_authid'::regclass
          and dependency.refobjid=role_record.oid
          and dependency.deptype in ('a','o')
      ) or 1 < (
        select count(*) from pg_catalog.pg_auth_members where roleid=role_record.oid
      ) then
      raise exception using errcode='42501',message='square_production_authority_role_drift';
    end if;
  end loop;
end
$roles$;

revoke all on schema private from
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;
grant usage on schema public to
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

-- PostgreSQL generated columns reject otherwise deterministic expression trees
-- containing casts whose catalog volatility is not immutable. Keep the compact
-- length-prefixed fingerprint in one explicitly immutable, private helper. Text
-- values cannot contain NUL, so the array preserves an unambiguous ordered input.
create function private.integration_production_fingerprint_v1(p_parts text[])
returns text
language sql
immutable
strict
parallel safe
set search_path=''
as $function$
  select 'sha256:'||pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.string_agg(
          pg_catalog.length(part)::text||':'||part,
          '' order by ordinal
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from pg_catalog.unnest(p_parts) with ordinality as ordered_parts(part,ordinal)
$function$;

revoke all on function private.integration_production_fingerprint_v1(text[]) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create table private.integration_production_platform_bindings (
  binding_key text primary key check(binding_key='vaeroex-production-integrations-v1'),
  environment text not null check(environment='production'),
  project_id text not null check(project_id ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' and project_id !~* '(sandbox|preview|qualification)'),
  project_number text not null check(project_number ~ '^[1-9][0-9]{5,19}$'),
  region text not null check(region ~ '^[a-z]+-[a-z]+[0-9]$'),
  network_name text not null check(network_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  subnet_name text not null check(subnet_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  router_name text not null check(router_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  nat_name text not null check(nat_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  egress_address_name text not null check(egress_address_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  ingress_address_name text not null check(ingress_address_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  task_queue_name text not null check(task_queue_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  artifact_repository_name text not null check(artifact_repository_name ~ '^[a-z][a-z0-9-]{0,61}[a-z0-9]$'),
  database_authority_target text not null check(database_authority_target='existing_production_postgres'),
  runtime_policy_version text not null check(length(runtime_policy_version) between 1 and 128),
  retention_policy_version text not null check(length(retention_policy_version) between 1 and 128),
  observability_policy_version text not null check(length(observability_policy_version) between 1 and 128),
  backup_policy_version text not null check(length(backup_policy_version) between 1 and 128),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  infrastructure_provisioned boolean not null default false check(not infrastructure_provisioned),
  runtime_enabled boolean not null default false check(not runtime_enabled),
  economic_contributions_enabled boolean not null default false check(not economic_contributions_enabled),
  ai_dispatch_enabled boolean not null default false check(not ai_dispatch_enabled),
  platform_fingerprint text generated always as (private.integration_production_fingerprint_v1(array[
    binding_key,project_id,project_number,region,source_commit
  ])) stored,
  unique(binding_key,project_id,region),
  unique(binding_key,project_id,region,source_commit),
  unique(binding_key,platform_fingerprint),
  check(network_name<>subnet_name and network_name<>router_name and network_name<>nat_name and
    network_name<>egress_address_name and network_name<>ingress_address_name and network_name<>task_queue_name and
    network_name<>artifact_repository_name)
);
alter table private.integration_production_platform_bindings enable row level security;
alter table private.integration_production_platform_bindings force row level security;
revoke all on table private.integration_production_platform_bindings from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create table private.integration_production_provider_bindings (
  provider_key text not null check(provider_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  environment text not null check(environment='production'),
  platform_binding_key text not null,
  project_id text not null,
  region text not null,
  application_id text not null unique check(length(application_id) between 8 and 512 and application_id ~ '^[A-Za-z0-9._-]+$'),
  route_namespace text not null check(route_namespace ~ '^/api/integrations/[a-z][a-z0-9_-]*$'),
  callback_uri text not null check(length(callback_uri) between 12 and 2048
    and callback_uri ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]/api/integrations/[a-z][a-z0-9_-]*/callback$'
    and callback_uri ~ '^https://[^/]+\.[^/]+/'
    and callback_uri !~* '(sandbox|preview|localhost|sslip\.io)'
    and callback_uri !~ '^https://[0-9]+(?:\.[0-9]+){3}/'
    and callback_uri !~ '^https://(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)'
    and callback_uri not like '%..%'),
  kms_key_resource text not null unique check(kms_key_resource ~
    '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/locations/[a-z]+-[a-z]+[0-9]/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$'),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  provider_authority_fingerprint text generated always as (private.integration_production_fingerprint_v1(array[
    provider_key,environment,application_id,callback_uri,kms_key_resource
  ])) stored,
  enabled boolean not null default false check(not enabled),
  provider_calls_enabled boolean not null default false check(not provider_calls_enabled),
  customer_onboarding_enabled boolean not null default false check(not customer_onboarding_enabled),
  webhook_intake_enabled boolean not null default false check(not webhook_intake_enabled),
  evidence_enabled boolean not null default false check(not evidence_enabled),
  economic_contributions_enabled boolean not null default false check(not economic_contributions_enabled),
  ai_dispatch_enabled boolean not null default false check(not ai_dispatch_enabled),
  primary key(provider_key,environment),
  unique(provider_key,environment,project_id),
  unique(provider_key,environment,provider_authority_fingerprint),
  foreign key(platform_binding_key,project_id,region,source_commit)
    references private.integration_production_platform_bindings(binding_key,project_id,region,source_commit) on delete restrict,
  check(route_namespace='/api/integrations/'||replace(provider_key,'_','-')),
  check(callback_uri ~ ('^https://[^/]+'||route_namespace||'/callback$')),
  check(split_part(kms_key_resource,'/',2)=project_id and split_part(kms_key_resource,'/',4)=region)
);
alter table private.integration_production_provider_bindings enable row level security;
alter table private.integration_production_provider_bindings force row level security;
revoke all on table private.integration_production_provider_bindings from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create table private.integration_production_provider_secrets (
  provider_key text not null,
  environment text not null,
  project_id text not null,
  secret_purpose text not null check(secret_purpose ~ '^[a-z][a-z0-9_]{0,63}$'),
  secret_version_resource text not null,
  primary key(provider_key,environment,secret_purpose),
  foreign key(provider_key,environment,project_id)
    references private.integration_production_provider_bindings(provider_key,environment,project_id) on delete restrict,
  constraint production_provider_secret_resource_key unique(secret_version_resource),
  check(secret_version_resource ~ '^projects/[a-z][a-z0-9-]{4,28}[a-z0-9]/secrets/[A-Za-z0-9_-]{1,255}/versions/[1-9][0-9]*$'
    and split_part(secret_version_resource,'/',2)=project_id and secret_version_resource !~ '/latest$')
);
alter table private.integration_production_provider_secrets enable row level security;
alter table private.integration_production_provider_secrets force row level security;
revoke all on table private.integration_production_provider_secrets from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create table private.integration_production_provider_capabilities (
  provider_key text not null,
  environment text not null,
  project_id text not null,
  capability text not null check(capability in ('oauth','broker','scheduler','webhook','runtime','evidence','task_invoker')),
  service_account text not null,
  database_login name,
  database_secret_purpose text,
  primary key(provider_key,environment,capability),
  foreign key(provider_key,environment,project_id)
    references private.integration_production_provider_bindings(provider_key,environment,project_id) on delete restrict,
  foreign key(provider_key,environment,database_secret_purpose)
    references private.integration_production_provider_secrets(provider_key,environment,secret_purpose) on delete restrict,
  constraint production_provider_capability_service_account_key unique(service_account),
  constraint production_provider_capability_database_login_key unique(database_login),
  check(length(service_account) <= 254
    and service_account ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$'
    and split_part(service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check((capability='task_invoker' and database_login is null and database_secret_purpose is null) or
    (capability<>'task_invoker' and database_login is not null and database_secret_purpose is not null
      and database_login::text like provider_key||'_production_%'
      and database_secret_purpose='database_'||capability))
);
alter table private.integration_production_provider_capabilities enable row level security;
alter table private.integration_production_provider_capabilities force row level security;
revoke all on table private.integration_production_provider_capabilities from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

-- Custom default privileges in the pre-existing private schema can name roles
-- outside the reviewed runtime list. Remove every explicit non-owner grant from
-- each newly created authority object, then prove that no table, column, or
-- function ACL remains for a non-owner.
do $closed_created_object_acls$
declare
  object_name text;
  object_owner oid;
  grantee_oid oid;
  grantee_name name;
  fingerprint_owner oid;
begin
  foreach object_name in array array[
    'private.integration_production_platform_bindings',
    'private.integration_production_provider_bindings',
    'private.integration_production_provider_secrets',
    'private.integration_production_provider_capabilities'
  ] loop
    select relowner into strict object_owner
      from pg_catalog.pg_class where oid=object_name::regclass;
    for grantee_oid in
      select distinct object_acl.grantee
      from pg_catalog.pg_class object_relation
      cross join lateral pg_catalog.aclexplode(object_relation.relacl) object_acl
      where object_relation.oid=object_name::regclass
        and object_acl.grantee<>object_relation.relowner
    loop
      if grantee_oid=0 then
        execute pg_catalog.format('revoke all on table %s from public',object_name);
      else
        select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
        execute pg_catalog.format('revoke all on table %s from %I',object_name,grantee_name);
      end if;
    end loop;
    if exists(
      select 1
      from pg_catalog.pg_class object_relation
      cross join lateral pg_catalog.aclexplode(object_relation.relacl) object_acl
      where object_relation.oid=object_name::regclass
        and object_acl.grantee<>object_owner
    ) or exists(
      select 1
      from pg_catalog.pg_attribute object_column
      cross join lateral pg_catalog.aclexplode(object_column.attacl) column_acl
      where object_column.attrelid=object_name::regclass
        and not object_column.attisdropped
        and column_acl.grantee<>object_owner
    ) then
      raise exception using errcode='42501',message='integration_production_foundation_acl_not_closed';
    end if;
  end loop;

  select proowner into strict fingerprint_owner from pg_catalog.pg_proc
    where oid='private.integration_production_fingerprint_v1(text[])'::regprocedure;
  for grantee_oid in
    select distinct function_acl.grantee
    from pg_catalog.pg_proc fingerprint_function
    cross join lateral pg_catalog.aclexplode(fingerprint_function.proacl) function_acl
    where fingerprint_function.oid='private.integration_production_fingerprint_v1(text[])'::regprocedure
      and function_acl.grantee<>fingerprint_function.proowner
  loop
    if grantee_oid=0 then
      execute 'revoke all on function private.integration_production_fingerprint_v1(text[]) from public';
    else
      select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
      execute pg_catalog.format(
        'revoke all on function private.integration_production_fingerprint_v1(text[]) from %I',grantee_name
      );
    end if;
  end loop;
  if exists(
    select 1
    from pg_catalog.pg_proc fingerprint_function
    cross join lateral pg_catalog.aclexplode(fingerprint_function.proacl) function_acl
    where fingerprint_function.oid='private.integration_production_fingerprint_v1(text[])'::regprocedure
      and function_acl.grantee<>fingerprint_owner
  ) then
    raise exception using errcode='42501',message='integration_production_foundation_function_acl_not_closed';
  end if;
end
$closed_created_object_acls$;

-- The shared data plane remains private.integration_sync_tasks,
-- private.integration_sync_checkpoints, private.integration_webhook_events and
-- private.integration_rate_limit_states. Square cannot enter it until a later
-- reviewed adapter proves provider/environment/workspace/entity/connection/
-- generation authority and grants each exact RPC to an exact native LOGIN.
commit;
