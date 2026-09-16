-- Dormant Square Production runtime overlay.
-- This migration must immediately follow the exact 102-version Production
-- ledger ending at 20260902191323. It records no application, secret,
-- capability, connection, task, provider call, customer enrollment, economic
-- contribution, or AI dispatch. Later activation requires a separate migration.
begin;

do $exact_production_baseline$
declare
  baseline_version_count integer;
  baseline_version_fingerprint text;
  function_record record;
  schema_digest text;
  role_name text;
  role_record pg_catalog.pg_roles;
begin
  if current_setting('server_version_num')::integer < 170000
    or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'square_production_overlay_requires_postgresql_17'
      using errcode='55000';
  end if;

  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'square_production_overlay_requires_migration_ledger'
      using errcode='55000';
  end if;

  select count(*)::integer into strict baseline_version_count
  from supabase_migrations.schema_migrations
  where version <= '20260902191323';

  select 'sha256:'||pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.string_agg(
          pg_catalog.length(version)::text||':'||version,
          '' order by version
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into strict baseline_version_fingerprint
  from supabase_migrations.schema_migrations
  where version <= '20260902191323';

  if baseline_version_count <> 102
    or baseline_version_fingerprint <> 'sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f'
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version='20260902191323'
    )
    or exists (
      select 1 from supabase_migrations.schema_migrations
      where version > '20260902191323'
        and version <> '20260902191324'
    ) then
    raise exception 'square_production_overlay_requires_exact_102_version_baseline'
      using errcode='55000';
  end if;

  if to_regprocedure('private.integration_production_fingerprint_v1(text[])') is null
    or to_regclass('private.integration_production_platform_bindings') is null
    or to_regclass('private.integration_production_provider_bindings') is null
    or to_regclass('private.integration_production_provider_secrets') is null
    or to_regclass('private.integration_production_provider_capabilities') is null
    or to_regclass('private.square_account_configuration') is not null
    or to_regclass('private.square_production_runtime_binding') is not null
    or to_regprocedure('private.integration_production_foundation_split_marker_v1()') is not null then
    raise exception 'square_production_overlay_foundation_or_legacy_state_invalid'
      using errcode='55000';
  end if;

  select fingerprint_function.proowner,fingerprint_function.provolatile,
      fingerprint_function.proisstrict,fingerprint_function.proparallel,
      fingerprint_function.prosecdef,fingerprint_function.proconfig,
      fingerprint_function.prosrc,fingerprint_function.prokind,
      fingerprint_function.pronargs,fingerprint_function.prorettype,
      function_language.lanname
    into strict function_record
  from pg_catalog.pg_proc fingerprint_function
  join pg_catalog.pg_language function_language
    on function_language.oid=fingerprint_function.prolang
  where fingerprint_function.oid=
    'private.integration_production_fingerprint_v1(text[])'::regprocedure;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ])
      and (relation.relkind <> 'r' or relation.relpersistence <> 'p'
        or relation.relowner <> current_user::regrole::oid
        or not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relhassubclass)
  ) or exists (
    select 1 from pg_catalog.pg_inherits inheritance
    where inheritance.inhrelid=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ]) or inheritance.inhparent=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ])
  ) or exists (
    select 1 from pg_catalog.pg_rewrite rewrite_rule
    where rewrite_rule.ev_class=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ])
  ) or exists (
    select 1 from pg_catalog.pg_publication publication where publication.puballtables
  ) or exists (
    select 1 from pg_catalog.pg_publication_rel publication_relation
    where publication_relation.prrelid=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ])
  ) or exists (
    select 1 from pg_catalog.pg_publication_namespace publication_namespace
    where publication_namespace.pnnspid='private'::regnamespace
  ) or exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(relation.relacl) relation_acl
    where relation.oid=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ]) and relation_acl.grantee<>relation.relowner
  ) or exists (
    select 1
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid=attribute.attrelid
    cross join lateral pg_catalog.aclexplode(attribute.attacl) column_acl
    where attribute.attrelid=any(array[
      'private.integration_production_platform_bindings'::regclass,
      'private.integration_production_provider_bindings'::regclass,
      'private.integration_production_provider_secrets'::regclass,
      'private.integration_production_provider_capabilities'::regclass
    ]) and attribute.attnum>0 and not attribute.attisdropped
      and column_acl.grantee<>relation.relowner
  ) or function_record.proowner <> current_user::regrole::oid
    or function_record.provolatile <> 'i'
    or not function_record.proisstrict
    or function_record.proparallel <> 's'
    or function_record.prosecdef
    or function_record.proconfig is distinct from array['search_path=""']::text[]
    or function_record.prokind <> 'f'
    or function_record.pronargs <> 1
    or function_record.prorettype <> 'text'::regtype
    or function_record.lanname <> 'sql'
    or pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(function_record.prosrc,'UTF8'),
        'sha256'
      ),
      'hex'
    ) <> '98a86fc4d75c479b10ae63900cdf1c03a5083fb59a52d61636cc3a886acfa096'
    or exists (
      select 1
      from pg_catalog.pg_proc fingerprint_function
      cross join lateral pg_catalog.aclexplode(fingerprint_function.proacl) function_acl
      where fingerprint_function.oid=
        'private.integration_production_fingerprint_v1(text[])'::regprocedure
        and function_acl.grantee<>fingerprint_function.proowner
    ) then
    raise exception 'square_production_overlay_foundation_authority_invalid'
      using errcode='55000';
  end if;

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
  if schema_digest <> '0fe4e1c2080fed1725db60ddb1643f4cd2d979a1a261c3445aae54c56788897e' then
    raise exception 'square_production_overlay_foundation_schema_invalid'
      using errcode='55000';
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
      raise exception 'square_production_overlay_authority_role_drift'
        using errcode='42501';
    end if;
  end loop;
end
$exact_production_baseline$;

create function private.square_production_generation_fingerprint_v1(
  p_generation bigint,
  p_parts text[]
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path=''
as $function$
  select private.integration_production_fingerprint_v1(
    array['square-production-generation-v1',p_generation::text] || p_parts
  )
$function$;

create function private.square_production_configuration_fingerprint_v1(
  p_generation bigint,
  p_provider_key text,
  p_environment text,
  p_project_id text,
  p_region text,
  p_lifecycle_state text,
  p_application_id text,
  p_callback_origin text,
  p_callback_method text,
  p_callback_path text,
  p_callback_uri text,
  p_webhook_method text,
  p_webhook_path text,
  p_webhook_uri text,
  p_api_version text,
  p_authorization_endpoint text,
  p_provider_origin text,
  p_requested_scopes text[],
  p_kms_key_resource text,
  p_application_secret_purpose text,
  p_webhook_signature_secret_purpose text,
  p_database_secret_purposes text[],
  p_provider_policy_version text,
  p_source_commit text,
  p_runtime_enabled boolean,
  p_provider_calls_enabled boolean,
  p_customer_onboarding_enabled boolean,
  p_webhook_intake_enabled boolean,
  p_evidence_enabled boolean,
  p_economic_contributions_enabled boolean,
  p_ai_dispatch_enabled boolean
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path=''
as $function$
  select private.square_production_generation_fingerprint_v1(p_generation,array[
    p_provider_key,p_environment,p_project_id,p_region,p_lifecycle_state,p_application_id,
    p_callback_origin,p_callback_method,p_callback_path,p_callback_uri,
    p_webhook_method,p_webhook_path,p_webhook_uri,p_api_version,
    p_authorization_endpoint,p_provider_origin,
    pg_catalog.array_to_string(p_requested_scopes,','),p_kms_key_resource,
    p_application_secret_purpose,p_webhook_signature_secret_purpose,
    pg_catalog.array_to_string(p_database_secret_purposes,','),p_provider_policy_version,p_source_commit,
    p_runtime_enabled::text,p_provider_calls_enabled::text,p_customer_onboarding_enabled::text,
    p_webhook_intake_enabled::text,p_evidence_enabled::text,
    p_economic_contributions_enabled::text,p_ai_dispatch_enabled::text
  ])
$function$;

create table private.square_production_configuration_generations (
  provider_key text not null default 'square' check(provider_key='square'),
  environment text not null default 'production' check(environment='production'),
  project_id text not null default 'vaeroex-integrations-prod' check(project_id='vaeroex-integrations-prod'),
  region text not null default 'us-west1' check(region='us-west1'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  lifecycle_state text not null default 'prepared' check(lifecycle_state='prepared'),
  application_id text not null check(application_id ~ '^sq0idp-[A-Za-z0-9_-]+$' and length(application_id) between 8 and 512),
  callback_origin text not null default 'https://square.vaeroex.com' check(callback_origin='https://square.vaeroex.com'),
  callback_method text not null default 'GET' check(callback_method='GET'),
  callback_path text not null default '/api/integrations/square/callback' check(callback_path='/api/integrations/square/callback'),
  callback_uri text not null default 'https://square.vaeroex.com/api/integrations/square/callback'
    check(callback_uri=callback_origin||callback_path),
  webhook_method text not null default 'POST' check(webhook_method='POST'),
  webhook_path text not null default '/api/integrations/square/webhook' check(webhook_path='/api/integrations/square/webhook'),
  webhook_uri text not null default 'https://square.vaeroex.com/api/integrations/square/webhook'
    check(webhook_uri=callback_origin||webhook_path),
  api_version text not null default '2026-08-19' check(api_version='2026-08-19'),
  authorization_endpoint text not null default 'https://connect.squareup.com/oauth2/authorize'
    check(authorization_endpoint='https://connect.squareup.com/oauth2/authorize'),
  provider_origin text not null default 'https://connect.squareup.com'
    check(provider_origin='https://connect.squareup.com'),
  requested_scopes text[] not null default array[
    'INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'
  ]::text[] check(requested_scopes=array[
    'INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'
  ]::text[]),
  kms_key_resource text not null check(kms_key_resource ~
    '^projects/vaeroex-integrations-prod/locations/us-west1/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$'),
  application_secret_purpose text not null default 'application' check(application_secret_purpose='application'),
  webhook_signature_secret_purpose text not null default 'webhook_signature'
    check(webhook_signature_secret_purpose='webhook_signature'),
  database_secret_purposes text[] not null default array[
    'database_broker','database_evidence','database_oauth','database_runtime','database_scheduler','database_webhook'
  ]::text[] check(database_secret_purposes=array[
    'database_broker','database_evidence','database_oauth','database_runtime','database_scheduler','database_webhook'
  ]::text[]),
  provider_policy_version text not null check(provider_policy_version ~ '^square_production_[a-z0-9_]{1,96}_v[1-9][0-9]*$'),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  runtime_enabled boolean not null default false check(not runtime_enabled),
  provider_calls_enabled boolean not null default false check(not provider_calls_enabled),
  customer_onboarding_enabled boolean not null default false check(not customer_onboarding_enabled),
  webhook_intake_enabled boolean not null default false check(not webhook_intake_enabled),
  evidence_enabled boolean not null default false check(not evidence_enabled),
  economic_contributions_enabled boolean not null default false check(not economic_contributions_enabled),
  ai_dispatch_enabled boolean not null default false check(not ai_dispatch_enabled),
  prepared_at timestamptz not null check(isfinite(prepared_at)),
  provider_authority_fingerprint text generated always as (
    private.integration_production_fingerprint_v1(array[
      provider_key,environment,application_id,callback_uri,kms_key_resource
    ])
  ) stored,
  configuration_fingerprint text generated always as (
    private.square_production_configuration_fingerprint_v1(
      generation,provider_key,environment,project_id,region,lifecycle_state,application_id,
      callback_origin,callback_method,callback_path,callback_uri,
      webhook_method,webhook_path,webhook_uri,api_version,
      authorization_endpoint,provider_origin,requested_scopes,kms_key_resource,
      application_secret_purpose,webhook_signature_secret_purpose,
      database_secret_purposes,provider_policy_version,source_commit,
      runtime_enabled,provider_calls_enabled,customer_onboarding_enabled,
      webhook_intake_enabled,evidence_enabled,economic_contributions_enabled,ai_dispatch_enabled
    )
  ) stored,
  primary key(provider_key,environment,project_id,generation),
  unique(provider_key,environment,project_id,generation,configuration_fingerprint),
  check(provider_authority_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$')
);

create table private.square_production_runtime_bindings (
  provider_key text not null check(provider_key='square'),
  environment text not null check(environment='production'),
  project_id text not null check(project_id='vaeroex-integrations-prod'),
  region text not null check(region='us-west1'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  platform_binding_key text not null check(platform_binding_key='vaeroex-production-integrations-v1'),
  platform_fingerprint text not null check(platform_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  provider_authority_fingerprint text not null check(provider_authority_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  bound_at timestamptz not null check(isfinite(bound_at)),
  binding_fingerprint text generated always as (
    private.square_production_generation_fingerprint_v1(generation,array[
      provider_key,environment,project_id,region,configuration_fingerprint,
      platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit
    ])
  ) stored,
  primary key(provider_key,environment,project_id,generation),
  unique(provider_key,environment,project_id,generation,configuration_fingerprint),
  unique(binding_fingerprint),
  foreign key(provider_key,environment,project_id,generation,configuration_fingerprint)
    references private.square_production_configuration_generations(
      provider_key,environment,project_id,generation,configuration_fingerprint
    ) on update restrict on delete restrict,
  foreign key(platform_binding_key,project_id,region,source_commit)
    references private.integration_production_platform_bindings(
      binding_key,project_id,region,source_commit
    ) on update restrict on delete restrict,
  foreign key(platform_binding_key,platform_fingerprint)
    references private.integration_production_platform_bindings(
      binding_key,platform_fingerprint
    ) on update restrict on delete restrict,
  foreign key(provider_key,environment,project_id)
    references private.integration_production_provider_bindings(
      provider_key,environment,project_id
    ) on update restrict on delete restrict,
  foreign key(provider_key,environment,provider_authority_fingerprint)
    references private.integration_production_provider_bindings(
      provider_key,environment,provider_authority_fingerprint
    ) on update restrict on delete restrict
);

create table private.square_production_generation_fences (
  provider_key text not null check(provider_key='square'),
  environment text not null check(environment='production'),
  project_id text not null check(project_id='vaeroex-integrations-prod'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  fence_kind text not null check(fence_kind in ('configuration_invalid','operator_stop','provider_revoked','superseded')),
  reason_code text not null check(reason_code in (
    'configuration_drift','generation_superseded','manual_emergency_stop','provider_authoritative_revocation'
  )),
  fenced_at timestamptz not null check(isfinite(fenced_at)),
  fence_fingerprint text generated always as (
    private.square_production_generation_fingerprint_v1(generation,array[
      provider_key,environment,project_id,configuration_fingerprint,fence_kind,reason_code
    ])
  ) stored,
  primary key(provider_key,environment,project_id,generation),
  unique(fence_fingerprint),
  foreign key(provider_key,environment,project_id,generation,configuration_fingerprint)
    references private.square_production_runtime_bindings(
      provider_key,environment,project_id,generation,configuration_fingerprint
    ) on update restrict on delete restrict,
  check(
    (fence_kind='configuration_invalid' and reason_code='configuration_drift') or
    (fence_kind='operator_stop' and reason_code='manual_emergency_stop') or
    (fence_kind='provider_revoked' and reason_code='provider_authoritative_revocation') or
    (fence_kind='superseded' and reason_code='generation_superseded')
  )
);

create table private.square_production_lifecycle_audit_events (
  provider_key text not null check(provider_key='square'),
  environment text not null check(environment='production'),
  project_id text not null check(project_id='vaeroex-integrations-prod'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  event_kind text not null check(event_kind in ('binding_recorded','configuration_prepared','generation_fenced')),
  outcome text not null default 'recorded' check(outcome='recorded'),
  reason_code text not null check(reason_code in (
    'activation_gates_closed','configuration_drift','generation_superseded',
    'manual_emergency_stop','provider_authoritative_revocation'
  )),
  recorded_at timestamptz not null check(isfinite(recorded_at)),
  event_fingerprint text generated always as (
    private.square_production_generation_fingerprint_v1(generation,array[
      provider_key,environment,project_id,configuration_fingerprint,event_kind,outcome,reason_code
    ])
  ) stored,
  primary key(provider_key,environment,project_id,generation,event_kind),
  unique(event_fingerprint),
  foreign key(provider_key,environment,project_id,generation,configuration_fingerprint)
    references private.square_production_configuration_generations(
      provider_key,environment,project_id,generation,configuration_fingerprint
    ) on update restrict on delete restrict,
  check(
    (event_kind in ('binding_recorded','configuration_prepared') and reason_code='activation_gates_closed') or
    (event_kind='generation_fenced' and reason_code<>'activation_gates_closed')
  )
);

create function private.reject_square_production_immutable_mutation_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path=''
as $function$
begin
  raise exception 'square_production_history_immutable' using errcode='55000';
end
$function$;

create function private.validate_square_production_runtime_binding_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path=''
as $function$
declare
  configuration private.square_production_configuration_generations;
  observed_secret_purposes text[];
  observed_capabilities text[];
begin
  select * into configuration
  from private.square_production_configuration_generations candidate
  where candidate.provider_key=new.provider_key
    and candidate.environment=new.environment
    and candidate.project_id=new.project_id
    and candidate.generation=new.generation
    and candidate.configuration_fingerprint=new.configuration_fingerprint;

  if not found or configuration.region<>new.region
    or configuration.source_commit<>new.source_commit
    or configuration.provider_authority_fingerprint<>new.provider_authority_fingerprint then
    raise exception 'square_production_binding_authority_incomplete' using errcode='23514';
  end if;

  if not exists (
    select 1
    from private.integration_production_platform_bindings platform_binding
    where platform_binding.binding_key=new.platform_binding_key
      and platform_binding.environment='production'
      and platform_binding.project_id=new.project_id
      and platform_binding.region=new.region
      and platform_binding.source_commit=new.source_commit
      and platform_binding.platform_fingerprint=new.platform_fingerprint
      and not platform_binding.infrastructure_provisioned
      and not platform_binding.runtime_enabled
      and not platform_binding.economic_contributions_enabled
      and not platform_binding.ai_dispatch_enabled
  ) or not exists (
    select 1
    from private.integration_production_provider_bindings provider_binding
    where provider_binding.provider_key=new.provider_key
      and provider_binding.environment=new.environment
      and provider_binding.project_id=new.project_id
      and provider_binding.region=new.region
      and provider_binding.application_id=configuration.application_id
      and provider_binding.route_namespace='/api/integrations/square'
      and provider_binding.callback_uri=configuration.callback_uri
      and provider_binding.kms_key_resource=configuration.kms_key_resource
      and provider_binding.source_commit=new.source_commit
      and provider_binding.provider_authority_fingerprint=new.provider_authority_fingerprint
      and not provider_binding.enabled
      and not provider_binding.provider_calls_enabled
      and not provider_binding.customer_onboarding_enabled
      and not provider_binding.webhook_intake_enabled
      and not provider_binding.evidence_enabled
      and not provider_binding.economic_contributions_enabled
      and not provider_binding.ai_dispatch_enabled
  ) then
    raise exception 'square_production_binding_authority_incomplete' using errcode='23514';
  end if;

  select array_agg(provider_secret.secret_purpose order by provider_secret.secret_purpose)
  into observed_secret_purposes
  from private.integration_production_provider_secrets provider_secret
  where provider_secret.provider_key=new.provider_key
    and provider_secret.environment=new.environment
    and provider_secret.project_id=new.project_id;

  if observed_secret_purposes is distinct from
    array[configuration.application_secret_purpose] ||
    configuration.database_secret_purposes ||
    array[configuration.webhook_signature_secret_purpose] then
    raise exception 'square_production_binding_secret_references_incomplete' using errcode='23514';
  end if;

  select array_agg(capability.capability order by capability.capability)
  into observed_capabilities
  from private.integration_production_provider_capabilities capability
  where capability.provider_key=new.provider_key
    and capability.environment=new.environment
    and capability.project_id=new.project_id;

  if observed_capabilities is distinct from array[
    'broker','evidence','oauth','runtime','scheduler','task_invoker','webhook'
  ]::text[] or 7 <> (
    select count(*)
    from private.integration_production_provider_capabilities capability
    join (values
      ('broker','square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_broker','database_broker'),
      ('evidence','square-evidence@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_evidence','database_evidence'),
      ('oauth','square-oauth@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_oauth','database_oauth'),
      ('runtime','square-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_runtime','database_runtime'),
      ('scheduler','square-scheduler@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_scheduler','database_scheduler'),
      ('task_invoker','square-task-invoker@vaeroex-integrations-prod.iam.gserviceaccount.com',null,null),
      ('webhook','square-webhook@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_webhook','database_webhook')
    ) expected(capability,service_account,database_login,database_secret_purpose)
      on capability.capability=expected.capability
      and capability.service_account=expected.service_account
      and capability.database_login::text is not distinct from expected.database_login
      and capability.database_secret_purpose is not distinct from expected.database_secret_purpose
    where capability.provider_key=new.provider_key
      and capability.environment=new.environment
      and capability.project_id=new.project_id
  ) then
    raise exception 'square_production_binding_capabilities_incomplete' using errcode='23514';
  end if;

  return new;
end
$function$;

create function private.record_square_production_lifecycle_audit_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path=''
as $function$
begin
  if tg_table_name='square_production_configuration_generations' then
    insert into private.square_production_lifecycle_audit_events(
      provider_key,environment,project_id,generation,configuration_fingerprint,
      event_kind,outcome,reason_code,recorded_at
    ) values (
      new.provider_key,new.environment,new.project_id,new.generation,new.configuration_fingerprint,
      'configuration_prepared','recorded','activation_gates_closed',new.prepared_at
    );
  elsif tg_table_name='square_production_runtime_bindings' then
    insert into private.square_production_lifecycle_audit_events(
      provider_key,environment,project_id,generation,configuration_fingerprint,
      event_kind,outcome,reason_code,recorded_at
    ) values (
      new.provider_key,new.environment,new.project_id,new.generation,new.configuration_fingerprint,
      'binding_recorded','recorded','activation_gates_closed',new.bound_at
    );
  elsif tg_table_name='square_production_generation_fences' then
    insert into private.square_production_lifecycle_audit_events(
      provider_key,environment,project_id,generation,configuration_fingerprint,
      event_kind,outcome,reason_code,recorded_at
    ) values (
      new.provider_key,new.environment,new.project_id,new.generation,new.configuration_fingerprint,
      'generation_fenced','recorded',new.reason_code,new.fenced_at
    );
  else
    raise exception 'square_production_audit_source_invalid' using errcode='55000';
  end if;
  return new;
end
$function$;

create function private.check_square_production_operational_generation_v1(
  p_provider_key text,
  p_environment text,
  p_project_id text,
  p_generation bigint,
  p_configuration_fingerprint text,
  p_capability text
)
returns void
language plpgsql
stable
security invoker
set search_path=''
as $function$
declare
  current_binding private.square_production_runtime_bindings;
  current_configuration private.square_production_configuration_generations;
begin
  if p_provider_key is distinct from 'square'
    or p_environment is distinct from 'production'
    or p_project_id is distinct from 'vaeroex-integrations-prod'
    or p_generation is null or p_generation not between 1 and 9007199254740991
    or p_configuration_fingerprint is null
    or p_configuration_fingerprint !~ '^sha256:[a-f0-9]{64}$'
    or p_capability is null
    or p_capability not in ('broker','evidence','oauth','runtime','scheduler','webhook') then
    raise exception 'square_production_generation_stale' using errcode='42501';
  end if;

  select binding.* into current_binding
  from private.square_production_runtime_bindings binding
  where binding.provider_key=p_provider_key
    and binding.environment=p_environment
    and binding.project_id=p_project_id
  order by binding.generation desc
  limit 1;

  if not found or current_binding.generation<>p_generation
    or current_binding.configuration_fingerprint<>p_configuration_fingerprint then
    raise exception 'square_production_generation_stale' using errcode='42501';
  end if;

  if exists (
    select 1 from private.square_production_generation_fences fence
    where fence.provider_key=p_provider_key
      and fence.environment=p_environment
      and fence.project_id=p_project_id
      and fence.generation=p_generation
      and fence.configuration_fingerprint=p_configuration_fingerprint
  ) then
    raise exception 'square_production_generation_fenced' using errcode='42501';
  end if;

  select configuration.* into strict current_configuration
  from private.square_production_configuration_generations configuration
  where configuration.provider_key=p_provider_key
    and configuration.environment=p_environment
    and configuration.project_id=p_project_id
    and configuration.generation=p_generation
    and configuration.configuration_fingerprint=p_configuration_fingerprint;

  if not current_configuration.runtime_enabled
    or (p_capability in ('broker','oauth','runtime','scheduler')
      and not current_configuration.provider_calls_enabled)
    or (p_capability='oauth' and not current_configuration.customer_onboarding_enabled)
    or (p_capability='webhook' and not current_configuration.webhook_intake_enabled)
    or (p_capability='evidence' and not current_configuration.evidence_enabled) then
    raise exception 'square_production_runtime_disabled' using errcode='42501';
  end if;
end
$function$;

create function public.check_square_production_oauth_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_oauth_authority','MEMBER') then
    raise exception 'square_production_oauth_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'oauth');
end
$function$;

create function public.check_square_production_broker_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_broker_authority','MEMBER') then
    raise exception 'square_production_broker_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'broker');
end
$function$;

create function public.check_square_production_scheduler_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_scheduler_authority','MEMBER') then
    raise exception 'square_production_scheduler_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'scheduler');
end
$function$;

create function public.check_square_production_webhook_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_webhook_authority','MEMBER') then
    raise exception 'square_production_webhook_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'webhook');
end
$function$;

create function public.check_square_production_runtime_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_runtime_authority','MEMBER') then
    raise exception 'square_production_runtime_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'runtime');
end
$function$;

create function public.check_square_production_evidence_authority_v1(
  p_provider_key text,p_environment text,p_project_id text,
  p_generation bigint,p_configuration_fingerprint text
)
returns void language plpgsql stable security definer set search_path='' as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'square_production_evidence_authority','MEMBER') then
    raise exception 'square_production_evidence_authority_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'evidence');
end
$function$;

create trigger square_production_configuration_immutable
before update or delete on private.square_production_configuration_generations
for each row execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_configuration_truncate_immutable
before truncate on private.square_production_configuration_generations
for each statement execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_configuration_audit
after insert on private.square_production_configuration_generations
for each row execute function private.record_square_production_lifecycle_audit_v1();

create trigger square_production_binding_authority
before insert on private.square_production_runtime_bindings
for each row execute function private.validate_square_production_runtime_binding_v1();
create trigger square_production_binding_immutable
before update or delete on private.square_production_runtime_bindings
for each row execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_binding_truncate_immutable
before truncate on private.square_production_runtime_bindings
for each statement execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_binding_audit
after insert on private.square_production_runtime_bindings
for each row execute function private.record_square_production_lifecycle_audit_v1();

create trigger square_production_fence_immutable
before update or delete on private.square_production_generation_fences
for each row execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_fence_truncate_immutable
before truncate on private.square_production_generation_fences
for each statement execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_fence_audit
after insert on private.square_production_generation_fences
for each row execute function private.record_square_production_lifecycle_audit_v1();

create trigger square_production_audit_immutable
before update or delete on private.square_production_lifecycle_audit_events
for each row execute function private.reject_square_production_immutable_mutation_v1();
create trigger square_production_audit_truncate_immutable
before truncate on private.square_production_lifecycle_audit_events
for each statement execute function private.reject_square_production_immutable_mutation_v1();

alter table private.square_production_configuration_generations enable row level security;
alter table private.square_production_configuration_generations force row level security;
alter table private.square_production_runtime_bindings enable row level security;
alter table private.square_production_runtime_bindings force row level security;
alter table private.square_production_generation_fences enable row level security;
alter table private.square_production_generation_fences force row level security;
alter table private.square_production_lifecycle_audit_events enable row level security;
alter table private.square_production_lifecycle_audit_events force row level security;

-- The exact Production baseline leaves these two legacy routines executable by
-- PUBLIC. Close only that inherited authority while preserving the explicit
-- authenticated business-memory grant and trigger execution semantics.
revoke execute on function
  public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision),
  public.set_updated_at()
from public;

revoke all on table
  private.square_production_configuration_generations,
  private.square_production_runtime_bindings,
  private.square_production_generation_fences,
  private.square_production_lifecycle_audit_events
from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

revoke all on function
  private.square_production_generation_fingerprint_v1(bigint,text[]),
  private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean),
  private.reject_square_production_immutable_mutation_v1(),
  private.validate_square_production_runtime_binding_v1(),
  private.record_square_production_lifecycle_audit_v1(),
  private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)
from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

revoke all on function
  public.check_square_production_oauth_authority_v1(text,text,text,bigint,text),
  public.check_square_production_broker_authority_v1(text,text,text,bigint,text),
  public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text),
  public.check_square_production_webhook_authority_v1(text,text,text,bigint,text),
  public.check_square_production_runtime_authority_v1(text,text,text,bigint,text),
  public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)
from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

grant execute on function public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)
  to square_production_oauth_authority;
grant execute on function public.check_square_production_broker_authority_v1(text,text,text,bigint,text)
  to square_production_broker_authority;
grant execute on function public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)
  to square_production_scheduler_authority;
grant execute on function public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)
  to square_production_webhook_authority;
grant execute on function public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)
  to square_production_runtime_authority;
grant execute on function public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)
  to square_production_evidence_authority;

-- Close custom default ACLs, publication, inheritance, rewrite, ownership and
-- trigger drift before committing any new Production authority surface.
do $closed_square_production_overlay$
declare
  object_name text;
  function_name text;
  object_owner oid;
  grantee_oid oid;
  grantee_name name;
  expected_trigger_count integer;
begin
  foreach object_name in array array[
    'private.square_production_configuration_generations',
    'private.square_production_runtime_bindings',
    'private.square_production_generation_fences',
    'private.square_production_lifecycle_audit_events'
  ] loop
    select relation.relowner into strict object_owner
    from pg_catalog.pg_class relation where relation.oid=object_name::regclass;

    for grantee_oid in
      select distinct object_acl.grantee
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) object_acl
      where relation.oid=object_name::regclass and object_acl.grantee<>relation.relowner
    loop
      if grantee_oid=0 then
        execute pg_catalog.format('revoke all on table %s from public',object_name);
      else
        select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
        execute pg_catalog.format('revoke all on table %s from %I',object_name,grantee_name);
      end if;
    end loop;

    expected_trigger_count := case object_name
      when 'private.square_production_configuration_generations' then 3
      when 'private.square_production_runtime_bindings' then 4
      when 'private.square_production_generation_fences' then 3
      else 2
    end;

    if exists (
      select 1 from pg_catalog.pg_class relation
      where relation.oid=object_name::regclass and (
        relation.relkind<>'r' or relation.relpersistence<>'p'
        or relation.relowner<>current_user::regrole::oid
        or not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relhassubclass
      )
    ) or exists (
      select 1 from pg_catalog.pg_inherits inheritance
      where inheritance.inhrelid=object_name::regclass
        or inheritance.inhparent=object_name::regclass
    ) or exists (
      select 1 from pg_catalog.pg_rewrite rewrite_rule
      where rewrite_rule.ev_class=object_name::regclass
    ) or exists (
      select 1 from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) object_acl
      where relation.oid=object_name::regclass and object_acl.grantee<>object_owner
    ) or exists (
      select 1 from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) column_acl
      where attribute.attrelid=object_name::regclass
        and not attribute.attisdropped and column_acl.grantee<>object_owner
    ) or exists (
      select 1 from pg_catalog.pg_policy policy where policy.polrelid=object_name::regclass
    ) or exists (
      select 1 from pg_catalog.pg_publication publication where publication.puballtables
    ) or exists (
      select 1 from pg_catalog.pg_publication_rel publication_relation
      where publication_relation.prrelid=object_name::regclass
    ) or exists (
      select 1 from pg_catalog.pg_publication_namespace publication_namespace
      where publication_namespace.pnnspid='private'::regnamespace
    ) or expected_trigger_count <> (
      select count(*) from pg_catalog.pg_trigger trigger_record
      where trigger_record.tgrelid=object_name::regclass
        and not trigger_record.tgisinternal and trigger_record.tgenabled='O'
    ) then
      raise exception 'square_production_overlay_relation_not_closed' using errcode='42501';
    end if;
  end loop;

  foreach function_name in array array[
    'private.square_production_generation_fingerprint_v1(bigint,text[])',
    'private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)',
    'private.reject_square_production_immutable_mutation_v1()',
    'private.validate_square_production_runtime_binding_v1()',
    'private.record_square_production_lifecycle_audit_v1()',
    'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'
  ] loop
    for grantee_oid in
      select distinct function_acl.grantee
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid=function_name::regprocedure
        and function_acl.grantee<>function_record.proowner
    loop
      if grantee_oid=0 then
        execute pg_catalog.format('revoke all on function %s from public',function_name);
      else
        select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
        execute pg_catalog.format('revoke all on function %s from %I',function_name,grantee_name);
      end if;
    end loop;

    if exists (
      select 1 from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid=function_name::regprocedure
        and function_acl.grantee<>function_record.proowner
    ) or exists (
      select 1 from pg_catalog.pg_proc function_record
      where function_record.oid=function_name::regprocedure and (
        function_record.proowner<>current_user::regrole::oid
        or function_record.prosecdef
        or function_record.proconfig is distinct from array['search_path=""']::text[]
      )
    ) then
      raise exception 'square_production_overlay_function_not_closed' using errcode='42501';
    end if;
  end loop;

  foreach function_name in array array[
    'public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_broker_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)',
    'public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'
  ] loop
    grantee_name := case
      when function_name like '%_oauth_authority_v1%' then 'square_production_oauth_authority'
      when function_name like '%_broker_authority_v1%' then 'square_production_broker_authority'
      when function_name like '%_scheduler_authority_v1%' then 'square_production_scheduler_authority'
      when function_name like '%_webhook_authority_v1%' then 'square_production_webhook_authority'
      when function_name like '%_runtime_authority_v1%' then 'square_production_runtime_authority'
      else 'square_production_evidence_authority'
    end;

    for grantee_oid in
      select distinct function_acl.grantee
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid=function_name::regprocedure
        and function_acl.grantee<>function_record.proowner
        and function_acl.grantee<>grantee_name::regrole::oid
    loop
      if grantee_oid=0 then
        execute pg_catalog.format('revoke all on function %s from public',function_name);
      else
        select rolname into strict grantee_name from pg_catalog.pg_roles where oid=grantee_oid;
        execute pg_catalog.format('revoke all on function %s from %I',function_name,grantee_name);
      end if;
    end loop;

    grantee_name := case
      when function_name like '%_oauth_authority_v1%' then 'square_production_oauth_authority'
      when function_name like '%_broker_authority_v1%' then 'square_production_broker_authority'
      when function_name like '%_scheduler_authority_v1%' then 'square_production_scheduler_authority'
      when function_name like '%_webhook_authority_v1%' then 'square_production_webhook_authority'
      when function_name like '%_runtime_authority_v1%' then 'square_production_runtime_authority'
      else 'square_production_evidence_authority'
    end;

    if exists (
      select 1 from pg_catalog.pg_proc function_record
      where function_record.oid=function_name::regprocedure and (
        function_record.proowner<>current_user::regrole::oid
        or not function_record.prosecdef
        or function_record.provolatile<>'s'
        or function_record.proconfig is distinct from array['search_path=""']::text[]
      )
    ) or 1 <> (
      select count(*)
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid=function_name::regprocedure
        and function_acl.grantee=grantee_name::regrole::oid
        and function_acl.privilege_type='EXECUTE'
        and not function_acl.is_grantable
    ) or exists (
      select 1
      from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      where function_record.oid=function_name::regprocedure
        and function_acl.grantee<>function_record.proowner
        and function_acl.grantee<>grantee_name::regrole::oid
    ) or not pg_catalog.has_function_privilege(
      grantee_name,
      function_name::regprocedure,
      'EXECUTE'
    ) or 1 <> (
      select count(*)
      from pg_catalog.pg_proc public_function
      join pg_catalog.pg_namespace public_namespace
        on public_namespace.oid=public_function.pronamespace
      where public_namespace.nspname='public'
        and pg_catalog.has_function_privilege(
          grantee_name,
          public_function.oid,
          'EXECUTE'
        )
    ) or exists (
      select 1
      from pg_catalog.pg_class application_relation
      join pg_catalog.pg_namespace application_namespace
        on application_namespace.oid=application_relation.relnamespace
      cross join (values
        ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
        ('TRUNCATE'),('REFERENCES'),('TRIGGER')
      ) relation_privilege(privilege_type)
      where application_namespace.nspname not like 'pg\_%' escape '\'
        and application_namespace.nspname<>'information_schema'
        and application_relation.relkind in ('r','p','v','m','f')
        and pg_catalog.has_table_privilege(
          grantee_name,
          application_relation.oid,
          relation_privilege.privilege_type
        )
    ) or exists (
      select 1
      from pg_catalog.pg_class application_relation
      join pg_catalog.pg_namespace application_namespace
        on application_namespace.oid=application_relation.relnamespace
      join pg_catalog.pg_attribute application_column
        on application_column.attrelid=application_relation.oid
      cross join (values
        ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')
      ) column_privilege(privilege_type)
      where application_namespace.nspname not like 'pg\_%' escape '\'
        and application_namespace.nspname<>'information_schema'
        and application_relation.relkind in ('r','p','v','m','f')
        and application_column.attnum>0
        and not application_column.attisdropped
        and pg_catalog.has_column_privilege(
          grantee_name,
          application_relation.oid,
          application_column.attnum,
          column_privilege.privilege_type
        )
    ) then
      raise exception 'square_production_overlay_authority_rpc_not_closed' using errcode='42501';
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc legacy_function
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        legacy_function.proacl,
        pg_catalog.acldefault('f',legacy_function.proowner)
      )
    ) function_acl
    where legacy_function.oid=any(array[
      'public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision)'::regprocedure::oid,
      'public.set_updated_at()'::regprocedure::oid
    ])
      and function_acl.grantee=0
      and function_acl.privilege_type='EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision)',
    'EXECUTE'
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgfoid='public.set_updated_at()'::regprocedure
      and trigger_record.tgenabled='O'
  ) or exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where not trigger_record.tgisinternal
      and trigger_record.tgfoid='public.set_updated_at()'::regprocedure
      and trigger_record.tgenabled<>'O'
  ) then
    raise exception 'square_production_overlay_legacy_public_execute_not_closed'
      using errcode='42501';
  end if;
end
$closed_square_production_overlay$;

commit;
