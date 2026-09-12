-- Separate, closed-by-default Square Production deployment authority. This
-- migration creates no LOGIN, secret, mapping, consent, task, provider call,
-- customer surface, economic contribution or AI dispatch.
begin;

do $roles$
declare role_name text;
declare role_record pg_catalog.pg_roles;
begin
  foreach role_name in array array[
    'square_production_oauth_authority',
    'square_production_broker_authority',
    'square_production_scheduler_authority',
    'square_production_webhook_authority',
    'square_production_runtime_authority',
    'square_production_evidence_authority'
  ] loop
    select * into role_record from pg_catalog.pg_roles where rolname=role_name;
    if not found then
      execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',role_name);
    elsif role_record.rolcanlogin or role_record.rolinherit or role_record.rolsuper or
      role_record.rolcreatedb or role_record.rolcreaterole or role_record.rolreplication or
      role_record.rolbypassrls or exists(
        select 1 from pg_catalog.pg_auth_members
        where roleid=role_record.oid or member=role_record.oid
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

alter table private.square_account_configuration add column square_production_binding_fingerprint text
  generated always as ('sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.length(environment)::text||':'||environment||
    pg_catalog.length(application_id)::text||':'||application_id||
    pg_catalog.length(redirect_uri)::text||':'||redirect_uri||
    pg_catalog.length(broker_login::text)::text||':'||broker_login::text||
    pg_catalog.length(enrollment_login::text)::text||':'||enrollment_login::text||
    pg_catalog.length(webhook_login::text)::text||':'||webhook_login::text||
    pg_catalog.length(kms_key_resource)::text||':'||kms_key_resource,'UTF8'),'sha256'),'hex')) stored;
alter table private.square_account_configuration add constraint square_account_configuration_production_fingerprint_check
  check(square_production_binding_fingerprint ~ '^sha256:[a-f0-9]{64}$');
create unique index square_account_configuration_production_binding_idx
  on private.square_account_configuration(environment,application_id,square_production_binding_fingerprint);

create table private.square_production_runtime_binding (
  binding_key text primary key check(binding_key='square-production-v1'),
  environment text not null check(environment='production'),
  api_version text not null check(api_version='2026-08-19'),
  application_id text not null check(application_id ~ '^sq0idp-[A-Za-z0-9_-]+$'),
  application_origin text not null check(
    application_origin ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$' and application_origin ~ '^https://[^.]+\..+$'
    and application_origin !~* '(sandbox|preview|localhost|sslip\.io)'
    and application_origin !~ '^https://[0-9]+(?:\.[0-9]+){3}$'
    and application_origin !~ '^https://(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)'
    and application_origin not like '%..%'),
  callback_origin text not null check(
    callback_origin ~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9]$' and callback_origin ~ '^https://[^.]+\..+$'
    and callback_origin !~* '(sandbox|preview|localhost|sslip\.io)'
    and callback_origin !~ '^https://[0-9]+(?:\.[0-9]+){3}$'
    and callback_origin !~ '^https://(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)'
    and callback_origin not like '%..%'),
  callback_uri text not null check(callback_uri=callback_origin||'/api/integrations/square/callback'),
  project_id text not null check(project_id ~ '^[a-z][a-z0-9-]+[a-z0-9]$' and project_id !~* 'sandbox'),
  project_number text not null check(project_number ~ '^[1-9][0-9]{5,19}$'),
  region text not null check(region ~ '^[a-z]+-[a-z]+[0-9]$'),
  kms_key_resource text not null,
  application_secret_version_resource text not null,
  webhook_signature_version_resource text not null,
  oauth_database_secret_version_resource text not null,
  broker_database_secret_version_resource text not null,
  scheduler_database_secret_version_resource text not null,
  webhook_database_secret_version_resource text not null,
  runtime_database_secret_version_resource text not null,
  evidence_database_secret_version_resource text not null,
  oauth_service_account text not null,
  broker_service_account text not null,
  scheduler_service_account text not null,
  webhook_service_account text not null,
  runtime_service_account text not null,
  evidence_service_account text not null,
  task_invoker_service_account text not null,
  queue_resource text not null,
  oauth_login name not null check(oauth_login::text ~ '^square_production_[a-z_]{1,39}$'),
  broker_login name not null check(broker_login::text ~ '^square_production_[a-z_]{1,39}$'),
  scheduler_login name not null check(scheduler_login::text ~ '^square_production_[a-z_]{1,39}$'),
  webhook_login name not null check(webhook_login::text ~ '^square_production_[a-z_]{1,39}$'),
  runtime_login name not null check(runtime_login::text ~ '^square_production_[a-z_]{1,39}$'),
  evidence_login name not null check(evidence_login::text ~ '^square_production_[a-z_]{1,39}$'),
  enabled boolean not null default false,
  provider_calls_enabled boolean not null default false,
  customer_onboarding_enabled boolean not null default false,
  evidence_enabled boolean not null default false,
  economic_contributions_enabled boolean not null default false check(not economic_contributions_enabled),
  ai_dispatch_enabled boolean not null default false check(not ai_dispatch_enabled),
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
  policy_version text not null check(length(policy_version) between 1 and 128),
  policy_fingerprint text not null check(policy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  square_production_binding_fingerprint text generated always as ('sha256:'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.length(environment)::text||':'||environment||
    pg_catalog.length(application_id)::text||':'||application_id||
    pg_catalog.length(callback_uri)::text||':'||callback_uri||
    pg_catalog.length(broker_login::text)::text||':'||broker_login::text||
    pg_catalog.length(oauth_login::text)::text||':'||oauth_login::text||
    pg_catalog.length(webhook_login::text)::text||':'||webhook_login::text||
    pg_catalog.length(kms_key_resource)::text||':'||kms_key_resource,'UTF8'),'sha256'),'hex')) stored,
  check(kms_key_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/locations/[a-z]+-[a-z]+[0-9]/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+$'
    and split_part(kms_key_resource,'/',2)=project_id and split_part(kms_key_resource,'/',4)=region),
  check(application_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(application_secret_version_resource,'/',2)=project_id),
  check(webhook_signature_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(webhook_signature_version_resource,'/',2)=project_id),
  check(oauth_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(oauth_database_secret_version_resource,'/',2)=project_id),
  check(broker_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(broker_database_secret_version_resource,'/',2)=project_id),
  check(scheduler_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(scheduler_database_secret_version_resource,'/',2)=project_id),
  check(webhook_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(webhook_database_secret_version_resource,'/',2)=project_id),
  check(runtime_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(runtime_database_secret_version_resource,'/',2)=project_id),
  check(evidence_database_secret_version_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$'
    and split_part(evidence_database_secret_version_resource,'/',2)=project_id),
  check(oauth_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(oauth_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(broker_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(broker_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(scheduler_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(scheduler_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(webhook_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(webhook_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(runtime_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(runtime_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(evidence_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(evidence_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(task_invoker_service_account ~ '^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$'
    and split_part(task_invoker_service_account,'@',2)=project_id||'.iam.gserviceaccount.com'),
  check(queue_resource ~ '^projects/[a-z][a-z0-9-]+[a-z0-9]/locations/[a-z]+-[a-z]+[0-9]/queues/square-production-[a-z0-9-]+$'
    and split_part(queue_resource,'/',2)=project_id and split_part(queue_resource,'/',4)=region),
  check(oauth_login<>all(array[broker_login,scheduler_login,webhook_login,runtime_login,evidence_login])
    and broker_login<>all(array[scheduler_login,webhook_login,runtime_login,evidence_login])
    and scheduler_login<>all(array[webhook_login,runtime_login,evidence_login])
    and webhook_login<>all(array[runtime_login,evidence_login])
    and runtime_login<>evidence_login),
  check(not customer_onboarding_enabled or provider_calls_enabled),
  check(not evidence_enabled or provider_calls_enabled),
  constraint square_production_runtime_binding_configuration_fkey
    foreign key(environment,application_id,square_production_binding_fingerprint)
    references private.square_account_configuration(environment,application_id,square_production_binding_fingerprint)
    on update restrict on delete restrict
);
alter table private.square_production_runtime_binding enable row level security;
alter table private.square_production_runtime_binding force row level security;
create unique index square_production_runtime_binding_application_idx
  on private.square_production_runtime_binding(environment,application_id);
revoke all on table private.square_production_runtime_binding from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create unique index square_account_connections_production_schedule_authority_idx
  on private.square_account_connections(workspace_id,business_entity_id,connection_id,generation,environment,application_id);
create unique index square_connections_production_schedule_environment_idx
  on private.square_connections(workspace_id,business_entity_id,connection_id,environment);

create table private.square_production_sync_schedule (
  connection_id uuid not null,
  connection_generation bigint not null check(connection_generation>0),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  environment text not null default 'production' check(environment='production'),
  application_id text not null check(application_id ~ '^sq0idp-[A-Za-z0-9_-]+$'),
  next_refresh_at timestamptz not null,
  next_sync_at timestamptz not null,
  schedule_version bigint not null default 1 check(schedule_version>0),
  state text not null check(state in ('ready','leased','blocked','revoked')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,connection_generation),
  foreign key(workspace_id,business_entity_id,connection_id,connection_generation)
    references private.square_connection_generations(workspace_id,business_entity_id,connection_id,connection_generation) on delete restrict,
  foreign key(workspace_id,business_entity_id,connection_id,connection_generation,environment,application_id)
    references private.square_account_connections(workspace_id,business_entity_id,connection_id,generation,environment,application_id) on delete restrict,
  foreign key(workspace_id,business_entity_id,connection_id,environment)
    references private.square_connections(workspace_id,business_entity_id,connection_id,environment) on update restrict on delete restrict
);
alter table private.square_production_sync_schedule enable row level security;
alter table private.square_production_sync_schedule force row level security;
create index square_production_sync_schedule_due_idx
  on private.square_production_sync_schedule(next_sync_at,connection_id,connection_generation)
  where state='ready';
create index square_production_refresh_due_idx
  on private.square_production_sync_schedule(next_refresh_at,connection_id,connection_generation)
  where state='ready';
revoke all on table private.square_production_sync_schedule from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

create table private.square_production_webhook_receipts (
  event_id text primary key check(length(event_id) between 1 and 191),
  event_type text not null check(event_type in (
    'oauth.authorization.revoked','payment.created','payment.updated',
    'refund.created','refund.updated','order.created','order.updated',
    'order.fulfillment.updated','catalog.version.updated','inventory.count.updated')),
  environment text not null default 'production' check(environment='production'),
  application_id text not null,
  merchant_id text,
  received_at timestamptz not null default clock_timestamp(),
  payload_fingerprint text not null check(payload_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  processing_state text not null check(processing_state in ('accepted','duplicate','scheduled','blocked','rejected')),
  processing_reason text not null check(length(processing_reason) between 1 and 96),
  foreign key(environment,application_id) references private.square_account_configuration(environment,application_id) on delete restrict
);
alter table private.square_production_webhook_receipts enable row level security;
alter table private.square_production_webhook_receipts force row level security;
create index square_production_webhook_application_idx
  on private.square_production_webhook_receipts(environment,application_id,received_at);
revoke all on table private.square_production_webhook_receipts from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,
  square_production_scheduler_authority,square_production_webhook_authority,
  square_production_runtime_authority,square_production_evidence_authority;

-- No function or table grant is installed yet. A later reviewed composition
-- migration grants each role only its fixed checked RPC after hosted identities,
-- retention and recovery controls are approved.
commit;
