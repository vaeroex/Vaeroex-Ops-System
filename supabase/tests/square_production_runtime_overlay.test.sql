begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create or replace function pg_temp.statement_error(p_sql text)
returns text
language plpgsql
as $function$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate||':'||sqlerrm;
end
$function$;

select is(current_setting('server_version_num')::integer / 10000,17,
  'qualification uses the Production PostgreSQL 17 major version');
select is((select count(*)::integer from supabase_migrations.schema_migrations),103,
  'disposable ledger contains only the exact 102-version baseline and adjacent overlay');
select is((select count(*)::integer from supabase_migrations.schema_migrations
  where version='20260902191324'),1,'Production overlay is recorded exactly once');
select ok(to_regclass('private.square_account_configuration') is null,
  'Sandbox account lifecycle is absent from the Production-shaped database');
select ok(to_regclass('private.square_production_runtime_binding') is null,
  'legacy singular Square overlay is absent from the Production-shaped database');
select ok(to_regprocedure('private.integration_production_foundation_split_marker_v1()') is null,
  'later historical compatibility marker is absent from the Production-shaped database');

select is((select count(*)::integer from pg_catalog.pg_roles where rolname in (
  'square_production_oauth_authority','square_production_broker_authority',
  'square_production_scheduler_authority','square_production_webhook_authority',
  'square_production_runtime_authority','square_production_evidence_authority'
) and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
  and not rolcreaterole and not rolreplication and not rolbypassrls and rolconfig is null),6,
  'all Square Production authority roles remain NOLOGIN, NOINHERIT and unprivileged');

select is((select count(*)::integer from (
  values
    ('private.square_production_configuration_generations'::regclass),
    ('private.square_production_runtime_bindings'::regclass),
    ('private.square_production_generation_fences'::regclass),
    ('private.square_production_lifecycle_audit_events'::regclass)
) target(object_id)
join pg_catalog.pg_class relation on relation.oid=target.object_id
where relation.relkind='r' and relation.relpersistence='p'
  and relation.relrowsecurity and relation.relforcerowsecurity
  and not relation.relhassubclass),4,
  'every overlay relation is permanent, non-inherited and FORCE RLS');
select is((select count(*)::integer from pg_catalog.pg_class relation
  where relation.oid=any(array[
    'private.integration_production_platform_bindings'::regclass,
    'private.integration_production_provider_bindings'::regclass,
    'private.integration_production_provider_secrets'::regclass,
    'private.integration_production_provider_capabilities'::regclass
  ]) and relation.relkind='r' and relation.relpersistence='p'),4,
  'the authenticated provider-neutral foundation contains only permanent relations');
select is((select count(*)::integer from pg_catalog.pg_inherits inheritance
  where inheritance.inhrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ]) or inheritance.inhparent=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'overlay tables have no inheritance edges');
select is((select count(*)::integer from pg_catalog.pg_rewrite rewrite_rule
  where rewrite_rule.ev_class=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'overlay tables have no rewrite rules');
select is((select count(*)::integer from pg_catalog.pg_policy policy
  where policy.polrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ])),0,'no dormant table has an RLS allow policy');
select is((select count(*)::integer from information_schema.role_table_grants
  where table_schema='private'
    and table_name like 'square_production_%'
    and grantee in ('anon','authenticated','service_role',
      'square_production_oauth_authority','square_production_broker_authority',
      'square_production_scheduler_authority','square_production_webhook_authority',
      'square_production_runtime_authority','square_production_evidence_authority')),0,
  'public, service and dormant Square roles receive no table privileges');
select ok(not pg_catalog.has_function_privilege('service_role',
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','execute'),
  'service role cannot invoke generation authority');
select ok(not pg_catalog.has_function_privilege('square_production_runtime_authority',
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)','execute'),
  'dormant runtime authority cannot invoke the shared private generation check');
select is((select function_record.provolatile::text||':'||function_record.proisstrict::text||':'||
    function_record.proparallel::text||':'||function_record.prosecdef::text
  from pg_catalog.pg_proc function_record
  where function_record.oid=
    'private.square_production_configuration_fingerprint_v1(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text[],text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean)'::regprocedure),
  'i:true:s:false','typed configuration fingerprint helper is immutable, strict, parallel safe and invoker scoped');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_broker_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_scheduler_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_webhook_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_runtime_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_evidence_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure)
) expected(role_name,rpc) where pg_catalog.has_function_privilege(role_name,rpc,'execute')),6,
  'each NOLOGIN authority receives exactly its distinct checked preflight RPC');
select is((select count(*)::integer from (values
  ('square_production_oauth_authority','public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_broker_authority','public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_scheduler_authority','public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_webhook_authority','public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_runtime_authority','public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure),
  ('square_production_evidence_authority','public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure)
) denied(role_name,rpc) where pg_catalog.has_function_privilege(role_name,rpc,'execute')),0,
  'no authority inherits a different capability preflight RPC');
select unlike(pg_catalog.pg_get_functiondef(
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'::regprocedure),
  '%economic_contributions_enabled%','operational authority is independent from economic contribution');
select unlike(pg_catalog.pg_get_functiondef(
  'private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'::regprocedure),
  '%ai_dispatch_enabled%','operational authority is independent from AI dispatch');

select is((select count(*)::integer from information_schema.columns
  where table_schema='private'
    and table_name in (
      'square_production_configuration_generations','square_production_runtime_bindings',
      'square_production_generation_fences','square_production_lifecycle_audit_events'
    ) and is_nullable='YES'),0,'overlay authority columns are deliberately non-nullable');
select is((select count(*)::integer from information_schema.columns
  where table_schema='private' and table_name='square_production_lifecycle_audit_events'
    and (data_type in ('json','jsonb') or column_name ~* '(payload|token|secret|credential|merchant|workspace|actor)')),0,
  'lifecycle audit has no raw, secret, provider-account or tenant payload field');
select is((select count(*)::integer from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid=any(array[
    'private.square_production_configuration_generations'::regclass,
    'private.square_production_runtime_bindings'::regclass,
    'private.square_production_generation_fences'::regclass,
    'private.square_production_lifecycle_audit_events'::regclass
  ]) and not trigger_record.tgisinternal and trigger_record.tgenabled='O'),12,
  'all immutable, authority and sanitized-audit triggers are enabled');

select is((select count(*)::integer from private.integration_production_platform_bindings),0,
  'overlay seeds no shared platform binding');
select is((select count(*)::integer from private.integration_production_provider_bindings),0,
  'overlay seeds no provider binding');
select is((select count(*)::integer from private.integration_production_provider_secrets),0,
  'Production secret references remain empty');
select is((select count(*)::integer from private.integration_production_provider_capabilities),0,
  'overlay creates no service or database capability assignment');
select is((select count(*)::integer from private.square_production_configuration_generations),0,
  'overlay fabricates no Square application configuration');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'overlay fabricates no runtime binding');
select is((select count(*)::integer from private.square_production_generation_fences),0,
  'overlay fabricates no fence event');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events),0,
  'overlay fabricates no audit history');

select like(pg_temp.statement_error($sql$
  insert into private.square_production_configuration_generations(
    generation,application_id,callback_origin,kms_key_resource,provider_policy_version,source_commit,prepared_at
  ) values (
    1,'sq0idp-production-fixture','https://foreign.example',
    'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
    'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:00:00Z'
  )
$sql$),'23514:%','foreign callback contract is rejected');

insert into private.square_production_configuration_generations(
  generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
) values (
  1,'sq0idp-production-fixture',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:00:00Z'
);

select is((select callback_method||':'||callback_path||':'||webhook_method||':'||webhook_path
  from private.square_production_configuration_generations where generation=1),
  'GET:/api/integrations/square/callback:POST:/api/integrations/square/webhook',
  'shared hostname contract pins GET callback and POST webhook paths');
select is((select runtime_enabled::text||':'||provider_calls_enabled::text||':'||
  customer_onboarding_enabled::text||':'||webhook_intake_enabled::text||':'||
  economic_contributions_enabled::text||':'||ai_dispatch_enabled::text
  from private.square_production_configuration_generations where generation=1),
  'false:false:false:false:false:false','all activation and product gates remain closed');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events
  where generation=1 and event_kind='configuration_prepared'
    and reason_code='activation_gates_closed'),1,
  'configuration lifecycle creates one sanitized closed-gate audit event');

select like(pg_temp.statement_error($sql$
  insert into private.square_production_runtime_bindings(
    provider_key,environment,project_id,region,generation,configuration_fingerprint,
    platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
  ) select provider_key,environment,project_id,region,generation,configuration_fingerprint,
    'vaeroex-production-integrations-v1',repeat('sha256:a',1),provider_authority_fingerprint,source_commit,
    '2026-09-15T00:01:00Z'
  from private.square_production_configuration_generations where generation=1
$sql$),'23514:%','binding fails atomically while provider authority and secret references are empty');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'failed authority binding rolls back the binding row');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events
  where event_kind='binding_recorded'),0,'failed authority binding emits no false audit event');

insert into private.integration_production_platform_bindings(
  binding_key,environment,project_id,project_number,region,network_name,subnet_name,router_name,nat_name,
  egress_address_name,ingress_address_name,task_queue_name,artifact_repository_name,database_authority_target,
  runtime_policy_version,retention_policy_version,observability_policy_version,backup_policy_version,source_commit
) values (
  'vaeroex-production-integrations-v1','production','vaeroex-integrations-prod','123456789012','us-west1',
  'vaeroex-integrations-production','vaeroex-integrations-us-west1','vaeroex-integrations-router',
  'vaeroex-integrations-nat','vaeroex-integrations-egress','vaeroex-integrations-ingress',
  'vaeroex-integrations-tasks','vaeroex-integrations-images','existing_production_postgres',
  'production_runtime_v1','production_retention_v1','production_observability_v1','production_backup_v1',repeat('a',40)
);

insert into private.integration_production_provider_bindings(
  provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,
  callback_uri,kms_key_resource,source_commit
) values (
  'square','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
  'sq0idp-production-fixture','/api/integrations/square',
  'https://square.vaeroex.com/api/integrations/square/callback',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  repeat('a',40)
);

insert into private.integration_production_provider_secrets(
  provider_key,environment,project_id,secret_purpose,secret_version_resource
)
select 'square','production','vaeroex-integrations-prod',purpose,
  'projects/vaeroex-integrations-prod/secrets/square-production-'||replace(purpose,'_','-')||'/versions/1'
from unnest(array[
  'application','database_broker','database_evidence','database_oauth','database_runtime',
  'database_scheduler','database_webhook','webhook_signature'
]::text[]) purpose;

insert into private.integration_production_provider_capabilities(
  provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose
)
select 'square','production','vaeroex-integrations-prod',capability,
  'square-'||replace(capability,'_','-')||'@vaeroex-integrations-prod.iam.gserviceaccount.com',
  case when capability='task_invoker' then null else ('square_production_'||capability)::name end,
  case when capability='task_invoker' then null else 'database_'||capability end
from unnest(array['broker','evidence','oauth','runtime','scheduler','task_invoker','webhook']::text[]) capability;

update private.integration_production_provider_capabilities
set service_account='square-broker-drift@vaeroex-integrations-prod.iam.gserviceaccount.com',
  database_login='square_production_broker_drift',
  database_secret_purpose='database_evidence'
where provider_key='square' and environment='production'
  and project_id='vaeroex-integrations-prod' and capability='broker';

select like(pg_temp.statement_error($sql$
  insert into private.square_production_runtime_bindings(
    provider_key,environment,project_id,region,generation,configuration_fingerprint,
    platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
  )
  select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
    configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
    platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
    '2026-09-15T00:01:00Z'
  from private.square_production_configuration_generations configuration
  cross join private.integration_production_platform_bindings platform
  where configuration.generation=1
$sql$),'23514:square_production_binding_capabilities_incomplete',
  'binding rejects drift in the capability service account, database login and secret purpose mapping');
select is((select count(*)::integer from private.square_production_runtime_bindings),0,
  'capability mapping rejection leaves no partial runtime binding');

update private.integration_production_provider_capabilities
set service_account='square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com',
  database_login='square_production_broker',
  database_secret_purpose='database_broker'
where provider_key='square' and environment='production'
  and project_id='vaeroex-integrations-prod' and capability='broker';

insert into private.square_production_runtime_bindings(
  provider_key,environment,project_id,region,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
)
select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
  '2026-09-15T00:01:00Z'
from private.square_production_configuration_generations configuration
cross join private.integration_production_platform_bindings platform
where configuration.generation=1;

select like(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',1,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=1),
    'runtime'
  )
$sql$),'42501:square_production_runtime_disabled','current generation stays unusable while gates are closed');

insert into private.square_production_configuration_generations(
  generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
) values (
  2,'sq0idp-production-fixture',
  'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
  'square_production_read_only_v1',repeat('a',40),'2026-09-15T00:02:00Z'
);
insert into private.square_production_runtime_bindings(
  provider_key,environment,project_id,region,generation,configuration_fingerprint,
  platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
)
select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
  configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
  platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
  '2026-09-15T00:03:00Z'
from private.square_production_configuration_generations configuration
cross join private.integration_production_platform_bindings platform
where configuration.generation=2;

select like(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',1,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=1),
    'runtime'
  )
$sql$),'42501:square_production_generation_stale','superseded generation is rejected before runtime use');

insert into private.square_production_generation_fences(
  provider_key,environment,project_id,generation,configuration_fingerprint,
  fence_kind,reason_code,fenced_at
)
select provider_key,environment,project_id,generation,configuration_fingerprint,
  'operator_stop','manual_emergency_stop','2026-09-15T00:04:00Z'
from private.square_production_runtime_bindings where generation=2;

select like(pg_temp.statement_error($sql$
  select private.check_square_production_operational_generation_v1(
    'square','production','vaeroex-integrations-prod',2,
    (select configuration_fingerprint from private.square_production_configuration_generations where generation=2),
    'runtime'
  )
$sql$),'42501:square_production_generation_fenced','latest fenced generation is rejected before gate evaluation');
select is((select count(*)::integer from private.square_production_lifecycle_audit_events),5,
  'two configurations, two bindings and one fence emit exact sanitized lifecycle audit history');

select like(pg_temp.statement_error($sql$
  update private.square_production_configuration_generations set prepared_at='2026-09-16T00:00:00Z' where generation=1
$sql$),'55000:square_production_history_immutable','configuration generations cannot be rewritten');
select like(pg_temp.statement_error($sql$
  delete from private.square_production_runtime_bindings where generation=1
$sql$),'55000:square_production_history_immutable','runtime bindings cannot be deleted');
select like(pg_temp.statement_error($sql$
  truncate private.square_production_lifecycle_audit_events
$sql$),'55000:square_production_history_immutable','sanitized lifecycle audit cannot be truncated');

select * from finish();
rollback;
