-- One-seller Square Production internal-pilot runtime authority.
-- This migration follows only the exact 102-migration Production foundation
-- and the adjacent Square overlay. It does not import the Sandbox lifecycle,
-- enable any general activation gate, create a LOGIN, seed a permit, handle a
-- webhook, schedule work, write economic facts, dispatch AI, or touch QBO.
begin;

do $exact_production_overlay$
declare
  version_count integer;
  version_fingerprint text;
  role_name text;
  role_record pg_catalog.pg_roles;
begin
  if current_user::text <> 'postgres' or session_user::text <> 'postgres'
    or current_setting('server_version_num')::integer < 170000
    or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'square_production_internal_runtime_requires_postgres_17_owner'
      using errcode='55000';
  end if;

  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'square_production_internal_runtime_requires_migration_ledger'
      using errcode='55000';
  end if;

  select count(*)::integer,
    'sha256:'||pg_catalog.encode(
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
  into strict version_count,version_fingerprint
  from supabase_migrations.schema_migrations
  where version<='20260902191324';

  if version_count<>103
    or version_fingerprint<>'sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146'
    or 1<>(select count(*) from supabase_migrations.schema_migrations where version='20260902191324')
    or exists(
      select 1 from supabase_migrations.schema_migrations
      where version>'20260902191324' and version<>'20260902191325'
    ) then
    raise exception 'square_production_internal_runtime_requires_exact_103_version_baseline'
      using errcode='55000';
  end if;

  if pg_catalog.to_regprocedure('private.integration_production_fingerprint_v1(text[])') is null
    or pg_catalog.to_regclass('private.integration_production_platform_bindings') is null
    or pg_catalog.to_regclass('private.integration_production_provider_bindings') is null
    or pg_catalog.to_regclass('private.integration_production_provider_secrets') is null
    or pg_catalog.to_regclass('private.integration_production_provider_capabilities') is null
    or pg_catalog.to_regclass('private.square_production_configuration_generations') is null
    or pg_catalog.to_regclass('private.square_production_runtime_bindings') is null
    or pg_catalog.to_regclass('private.square_production_generation_fences') is null
    or pg_catalog.to_regclass('private.square_production_lifecycle_audit_events') is null
    or pg_catalog.to_regprocedure('public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.check_square_production_broker_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regprocedure('public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)') is null
    or pg_catalog.to_regclass('private.square_account_configuration') is not null
    or pg_catalog.to_regclass('private.square_production_runtime_binding') is not null
    or pg_catalog.to_regprocedure('private.integration_production_foundation_split_marker_v1()') is not null
    or exists(
      select 1 from pg_catalog.pg_class relation
      where relation.oid=any(array[
        'private.integration_production_platform_bindings'::regclass,
        'private.integration_production_provider_bindings'::regclass,
        'private.integration_production_provider_secrets'::regclass,
        'private.integration_production_provider_capabilities'::regclass,
        'private.square_production_configuration_generations'::regclass,
        'private.square_production_runtime_bindings'::regclass,
        'private.square_production_generation_fences'::regclass,
        'private.square_production_lifecycle_audit_events'::regclass
      ]) and (
        relation.relkind<>'r' or relation.relpersistence<>'p'
        or relation.relowner<>'postgres'::regrole::oid
        or not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relhassubclass
      )
    ) then
    raise exception 'square_production_internal_runtime_overlay_invalid'
      using errcode='55000';
  end if;

  foreach role_name in array array[
    'square_production_oauth_authority','square_production_broker_authority',
    'square_production_scheduler_authority','square_production_webhook_authority',
    'square_production_runtime_authority','square_production_evidence_authority'
  ] loop
    select * into role_record from pg_catalog.pg_roles where rolname=role_name;
    if not found or role_record.rolcanlogin or role_record.rolinherit
      or role_record.rolsuper or role_record.rolcreatedb or role_record.rolcreaterole
      or role_record.rolreplication or role_record.rolbypassrls
      or role_record.rolconfig is not null
      or exists(
        select 1 from pg_catalog.pg_db_role_setting database_setting
        where database_setting.setrole=role_record.oid
      ) then
      raise exception 'square_production_internal_runtime_authority_role_drift'
        using errcode='42501';
    end if;
  end loop;

  if exists(
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='private'
      and relation.relname like 'square_production_internal_%'
  ) or exists(
    select 1
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
    where function_record.proname like 'square_production_internal_%'
      and namespace.nspname in ('private','public')
  ) then
    raise exception 'square_production_internal_runtime_already_present'
      using errcode='55000';
  end if;
end
$exact_production_overlay$;

create table private.square_production_internal_permits (
  permit_id uuid primary key,
  provider_key text not null default 'square' check(provider_key='square'),
  environment text not null default 'production' check(environment='production'),
  project_id text not null default 'vaeroex-integrations-prod' check(project_id='vaeroex-integrations-prod'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  operator_id uuid not null,
  operator_session_id uuid not null,
  expected_merchant_id text not null check(length(expected_merchant_id) between 1 and 100 and expected_merchant_id ~ '^[A-Za-z0-9._:-]+$'),
  expected_location_id text not null check(length(expected_location_id) between 1 and 100 and expected_location_id ~ '^[A-Za-z0-9._:-]+$'),
  verified_merchant_id text check(verified_merchant_id is null or verified_merchant_id=expected_merchant_id),
  verified_location_id text check(verified_location_id is null or verified_location_id=expected_location_id),
  credential_id uuid,
  credential_version bigint check(credential_version is null or credential_version between 1 and 9007199254740991),
  state text not null default 'prepared' check(state in (
    'prepared','consent_pending','mapping_required','mapped','syncing','synced','recovery_required','cleaned'
  )),
  row_version bigint not null default 1 check(row_version between 1 and 9007199254740991),
  mapped_at timestamptz check(mapped_at is null or isfinite(mapped_at)),
  sync_completed_at timestamptz check(sync_completed_at is null or isfinite(sync_completed_at)),
  approval_expires_at timestamptz not null check(isfinite(approval_expires_at)),
  installed_at timestamptz not null check(isfinite(installed_at)),
  permit_fingerprint text generated always as (
    private.integration_production_fingerprint_v1(array[
      'square-production-internal-permit-v1',permit_id::text,provider_key,environment,project_id,
      generation::text,configuration_fingerprint,workspace_id::text,business_entity_id::text,
      operator_id::text,operator_session_id::text,expected_merchant_id,expected_location_id,
      extract(epoch from pg_catalog.timezone('UTC',approval_expires_at))::text,
      extract(epoch from pg_catalog.timezone('UTC',installed_at))::text
    ])
  ) stored,
  foreign key(provider_key,environment,project_id,generation,configuration_fingerprint)
    references private.square_production_runtime_bindings(
      provider_key,environment,project_id,generation,configuration_fingerprint
    ) on update restrict on delete restrict,
  foreign key(workspace_id,business_entity_id)
    references public.business_entities(workspace_id,id) on update restrict on delete restrict,
  check((credential_id is null)=(credential_version is null)),
  check((verified_merchant_id is null)=(verified_location_id is null)),
  check((credential_id is null)=(verified_merchant_id is null)),
  check((state not in ('prepared','consent_pending') or credential_id is null)
    and (state not in ('mapping_required','mapped','syncing','synced') or credential_id is not null)),
  check((state in ('mapped','syncing','synced') and mapped_at is not null)
    or (state in ('prepared','consent_pending','mapping_required') and mapped_at is null)
    or state in ('recovery_required','cleaned')),
  check((state='synced' and sync_completed_at is not null)
    or (state not in ('synced','recovery_required','cleaned') and sync_completed_at is null)
    or state in ('recovery_required','cleaned')),
  check(approval_expires_at>installed_at),
  check(permit_fingerprint ~ '^sha256:[a-f0-9]{64}$')
);
create unique index square_production_internal_one_active_permit
  on private.square_production_internal_permits(provider_key,environment,project_id)
  where state<>'cleaned';
create index square_production_internal_permits_workspace
  on private.square_production_internal_permits(workspace_id,business_entity_id,permit_id);

create table private.square_production_internal_oauth_states (
  state_id uuid primary key,
  permit_id uuid not null references private.square_production_internal_permits(permit_id) on delete restrict,
  state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
  generation bigint not null check(generation between 1 and 9007199254740991),
  permit_row_version bigint not null check(permit_row_version between 1 and 9007199254740991),
  actor_id uuid not null,
  session_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  status text not null check(status in ('pending','exchanging','stored','denied','uncertain','cancelled')),
  expires_at timestamptz not null check(isfinite(expires_at)),
  consumed_at timestamptz check(consumed_at is null or isfinite(consumed_at)),
  exchange_started_at timestamptz check(exchange_started_at is null or isfinite(exchange_started_at)),
  stored_at timestamptz check(stored_at is null or isfinite(stored_at)),
  consume_request_fingerprint text check(consume_request_fingerprint is null or consume_request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  consume_receipt_fingerprint text check(consume_receipt_fingerprint is null or consume_receipt_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  deny_request_fingerprint text check(deny_request_fingerprint is null or deny_request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  denial_receipt_fingerprint text check(denial_receipt_fingerprint is null or denial_receipt_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  exchange_id uuid unique,
  exchange_request_fingerprint text check(exchange_request_fingerprint is null or exchange_request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  exchange_receipt_fingerprint text unique check(exchange_receipt_fingerprint is null or exchange_receipt_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  credential_command_fingerprint text check(credential_command_fingerprint is null or credential_command_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null check(isfinite(created_at)),
  check(expires_at>created_at),
  check((status in ('pending','denied','cancelled'))=(consumed_at is null)),
  check((status in ('exchanging','stored','uncertain'))=
    (consume_request_fingerprint is not null and consume_receipt_fingerprint is not null)),
  check((status='denied')=(deny_request_fingerprint is not null and denial_receipt_fingerprint is not null)),
  check((exchange_started_at is null and exchange_id is null and exchange_request_fingerprint is null
      and exchange_receipt_fingerprint is null)
    or (exchange_started_at is not null and exchange_id is not null and exchange_request_fingerprint is not null
      and exchange_receipt_fingerprint is not null)),
  check((status='stored')=(stored_at is not null and credential_command_fingerprint is not null))
);
create unique index square_production_internal_one_open_oauth_state
  on private.square_production_internal_oauth_states(permit_id)
  where status in ('pending','exchanging');

create table private.square_production_internal_credentials (
  credential_id uuid not null,
  credential_version bigint not null check(credential_version between 1 and 9007199254740991),
  permit_id uuid not null references private.square_production_internal_permits(permit_id) on delete restrict,
  oauth_state_id uuid not null unique references private.square_production_internal_oauth_states(state_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  ciphertext_base64 text not null check(length(ciphertext_base64) between 16 and 131072 and ciphertext_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  aad_context jsonb not null check(pg_catalog.jsonb_typeof(aad_context)='object' and pg_catalog.pg_column_size(aad_context)<=4096),
  aad_digest text not null check(aad_digest ~ '^sha256:[a-f0-9]{64}$'),
  kms_key_resource text not null check(kms_key_resource ~ '^projects/vaeroex-integrations-prod/locations/us-west1/keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$'),
  granted_scopes text[] not null check(granted_scopes=array[
    'INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'
  ]::text[]),
  external_entity_fingerprint text not null check(external_entity_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  command_fingerprint text not null check(command_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  provider_issued_at timestamptz not null check(isfinite(provider_issued_at)),
  access_expires_at timestamptz not null check(isfinite(access_expires_at) and access_expires_at>provider_issued_at),
  created_at timestamptz not null check(isfinite(created_at)),
  primary key(credential_id,credential_version),
  unique(permit_id,generation,command_fingerprint)
);

create table private.square_production_internal_scans (
  scan_id uuid primary key,
  task_id uuid not null unique,
  permit_id uuid not null unique references private.square_production_internal_permits(permit_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  stream text not null default 'payments' check(stream='payments'),
  operation text not null default 'list_payments' check(operation='list_payments'),
  request_method text not null default 'GET' check(request_method='GET'),
  payment_window_start timestamptz not null check(isfinite(payment_window_start)),
  payment_window_end timestamptz not null check(isfinite(payment_window_end)),
  request_fingerprint text not null check(request_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  lease_owner_fingerprint text not null check(lease_owner_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  status text not null default 'ready' check(status in ('ready','leased','committed','blocked','cleaned')),
  attempt integer not null default 0 check(attempt between 0 and 3),
  lease_id uuid,
  lease_expires_at timestamptz check(lease_expires_at is null or isfinite(lease_expires_at)),
  committed_at timestamptz check(committed_at is null or isfinite(committed_at)),
  created_at timestamptz not null check(isfinite(created_at)),
  row_version bigint not null default 1 check(row_version between 1 and 9007199254740991),
  check(payment_window_end>payment_window_start and payment_window_end<=created_at
    and payment_window_end-payment_window_start<=interval '24 hours'),
  check((status='leased')=(lease_id is not null and lease_expires_at is not null)),
  check((status='committed')=(committed_at is not null))
);

create table private.square_production_internal_page_receipts (
  scan_id uuid not null references private.square_production_internal_scans(scan_id) on delete restrict,
  page_id text not null check(page_id ~ '^sha256:[a-f0-9]{64}$'),
  permit_id uuid not null references private.square_production_internal_permits(permit_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  command_fingerprint text not null check(command_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  response_fingerprint text not null check(response_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  result_fingerprint text not null check(result_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  observation_count integer not null check(observation_count between 0 and 100),
  committed_at timestamptz not null check(isfinite(committed_at)),
  primary key(scan_id,page_id),
  unique(scan_id,command_fingerprint)
);

create table private.square_production_internal_source_versions (
  source_version_id uuid primary key,
  scan_id uuid not null,
  page_id text not null,
  permit_id uuid not null references private.square_production_internal_permits(permit_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  ordinal smallint not null check(ordinal between 1 and 100),
  payment_fingerprint text not null check(payment_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  version_fingerprint text not null check(version_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  location_fingerprint text not null check(location_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  payment_status text not null check(payment_status in ('approved','completed','canceled','failed','pending','unknown')),
  occurred_at timestamptz not null check(isfinite(occurred_at)),
  observed_at timestamptz not null check(isfinite(observed_at)),
  source_fingerprint text not null check(source_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  foreign key(scan_id,page_id)
    references private.square_production_internal_page_receipts(scan_id,page_id) on delete restrict,
  unique(scan_id,ordinal),
  unique(permit_id,payment_fingerprint,version_fingerprint),
  unique(source_fingerprint)
);

create table private.square_production_internal_fences (
  permit_id uuid primary key references private.square_production_internal_permits(permit_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  configuration_fingerprint text not null check(configuration_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  fence_kind text not null check(fence_kind in ('operator_cleanup','recovery_required')),
  reason_code text not null check(reason_code in ('internal_pilot_complete','manual_operator_stop','exchange_outcome_uncertain','provider_response_invalid')),
  cleanup_fingerprint text not null check(cleanup_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  fence_fingerprint text generated always as (
    private.integration_production_fingerprint_v1(array[
      'square-production-internal-fence-v1',permit_id::text,generation::text,
      configuration_fingerprint,fence_kind,reason_code,cleanup_fingerprint
    ])
  ) stored,
  fenced_at timestamptz not null check(isfinite(fenced_at)),
  check((fence_kind='operator_cleanup' and reason_code in ('internal_pilot_complete','manual_operator_stop'))
    or (fence_kind='recovery_required' and reason_code in ('exchange_outcome_uncertain','provider_response_invalid'))),
  check(fence_fingerprint ~ '^sha256:[a-f0-9]{64}$')
);

create table private.square_production_internal_audit_events (
  event_id uuid primary key,
  permit_id uuid not null references private.square_production_internal_permits(permit_id) on delete restrict,
  generation bigint not null check(generation between 1 and 9007199254740991),
  event_kind text not null check(event_kind in (
    'permit_installed','oauth_state_created','oauth_state_consumed','oauth_state_denied',
    'exchange_acquired','exchange_uncertain','credential_committed','credential_commit_replayed',
    'mapping_confirmed','scan_created','page_leased','page_committed','page_replayed',
    'page_released','credential_read','evidence_read','pilot_cleaned'
  )),
  outcome text not null check(outcome in ('recorded','accepted','replayed','blocked','fenced')),
  reason_code text not null check(reason_code in (
    'internal_permit_exact','state_hash_created','state_consumed_once','operator_denied',
    'exchange_effect_latched','exchange_outcome_uncertain','encrypted_credential_stored',
    'credential_receipt_reconciled','exact_location_confirmed','manual_payments_scan',
    'single_page_lease','single_page_committed','page_receipt_reconciled',
    'manual_retry_required','lease_bound_credential_read','sanitized_evidence_read',
    'internal_pilot_complete','manual_operator_stop','provider_response_invalid'
  )),
  subject_fingerprint text not null check(subject_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  event_fingerprint text not null unique check(event_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  recorded_at timestamptz not null check(isfinite(recorded_at))
);

do $force_rls$
declare table_name text;
begin
  foreach table_name in array array[
    'square_production_internal_permits','square_production_internal_oauth_states',
    'square_production_internal_credentials','square_production_internal_scans',
    'square_production_internal_page_receipts','square_production_internal_source_versions',
    'square_production_internal_fences','square_production_internal_audit_events'
  ] loop
    execute pg_catalog.format('alter table private.%I enable row level security',table_name);
    execute pg_catalog.format('alter table private.%I force row level security',table_name);
    execute pg_catalog.format(
      'revoke all on table private.%I from public,anon,authenticated,service_role,square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority',
      table_name
    );
  end loop;
end
$force_rls$;

create function private.square_production_internal_reject_immutable_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  raise exception 'square_production_internal_history_immutable' using errcode='55000';
end
$function$;

create function public.square_production_internal_broker_v1(p_operation text,p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_uuid uuid;
declare permit_row private.square_production_internal_permits;
declare state_uuid uuid;
declare exchange_uuid uuid;
declare scan_uuid uuid;
declare state_row private.square_production_internal_oauth_states;
declare scan_row private.square_production_internal_scans;
declare credential_row private.square_production_internal_credentials;
declare configuration_row private.square_production_configuration_generations;
declare now_at timestamptz:=statement_timestamp();
declare request_hash text;
declare exchange_receipt_hash text;
declare expected_hash text;
declare command_hash text;
declare aad_hash text;
declare external_hash text;
declare ciphertext text;
declare aad jsonb;
declare scopes text[];
declare credential_uuid uuid;
declare credential_version_number bigint;
declare issued_at timestamptz;
declare expires_at timestamptz;
declare audit_hash text;
declare application_secret_resource text;
declare lease_uuid uuid;
begin
  perform private.square_production_internal_require_login_v1('broker');
  if p_operation='acquire_exchange' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'exchangeRequestFingerprint','stateId'
    ]);
    state_uuid:=(p_payload->>'stateId')::uuid;
    request_hash:=p_payload->>'exchangeRequestFingerprint';
    select state_record.* into state_row
      from private.square_production_internal_oauth_states state_record
      where state_record.state_id=state_uuid for update;
    if not found then raise exception 'square_production_internal_exchange_denied' using errcode='42501'; end if;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'broker');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'acquire-exchange-v1',state_uuid::text,state_row.consume_receipt_fingerprint
    ]);
    if request_hash<>expected_hash or state_row.status not in ('exchanging','stored','uncertain') then
      raise exception 'square_production_internal_exchange_denied' using errcode='42501';
    end if;
    if state_row.status='stored' then
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'stateId',state_uuid,'status','stored',
        'generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
        'exchangeId',state_row.exchange_id,
        'exchangeRequestFingerprint',state_row.exchange_request_fingerprint,
        'exchangeReceiptFingerprint',state_row.exchange_receipt_fingerprint,
        'credentialCommandFingerprint',state_row.credential_command_fingerprint
      );
    elsif state_row.exchange_started_at is not null then
      if state_row.status<>'uncertain' then
        update private.square_production_internal_oauth_states set status='uncertain' where state_id=state_uuid;
        update private.square_production_internal_permits
          set state='recovery_required',row_version=row_version+1 where permit_id=permit_row.permit_id;
        perform private.square_production_internal_audit_v1(
          permit_row.permit_id,permit_row.generation,'exchange_uncertain','blocked',
          'exchange_outcome_uncertain',state_row.exchange_receipt_fingerprint,now_at
        );
      end if;
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'stateId',state_uuid,'status','uncertain',
        'generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
        'exchangeId',state_row.exchange_id,
        'exchangeRequestFingerprint',request_hash,
        'exchangeReceiptFingerprint',state_row.exchange_receipt_fingerprint
      );
    end if;
    exchange_uuid:=extensions.gen_random_uuid();
    exchange_receipt_hash:=private.square_production_internal_fingerprint_v1(array[
      'exchange-receipt-v1',state_uuid::text,exchange_uuid::text,request_hash,now_at::text
    ]);
    update private.square_production_internal_oauth_states
      set exchange_started_at=now_at,exchange_id=exchange_uuid,
        exchange_request_fingerprint=request_hash,exchange_receipt_fingerprint=exchange_receipt_hash
      where state_id=state_uuid;
    select configuration.* into strict configuration_row
      from private.square_production_configuration_generations configuration
      where configuration.provider_key='square' and configuration.environment='production'
        and configuration.project_id='vaeroex-integrations-prod'
        and configuration.generation=permit_row.generation;
    select secret_record.secret_version_resource into strict application_secret_resource
      from private.integration_production_provider_secrets secret_record
      where secret_record.provider_key='square' and secret_record.environment='production'
        and secret_record.project_id='vaeroex-integrations-prod'
        and secret_record.secret_purpose=configuration_row.application_secret_purpose;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'exchange_acquired','accepted',
      'exchange_effect_latched',exchange_receipt_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_uuid,'status','acquired',
      'generation',permit_row.generation,
      'configurationFingerprint',permit_row.configuration_fingerprint,
      'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
      'applicationId',configuration_row.application_id,
      'applicationSecretVersionResource',application_secret_resource,
      'kmsKeyResource',configuration_row.kms_key_resource,
      'requestedScopes',pg_catalog.to_jsonb(configuration_row.requested_scopes),
      'expectedMerchantId',permit_row.expected_merchant_id,
      'expectedLocationId',permit_row.expected_location_id,
      'exchangeId',exchange_uuid,'exchangeRequestFingerprint',request_hash,
      'exchangeReceiptFingerprint',exchange_receipt_hash,'auditFingerprint',audit_hash
    );
  elsif p_operation='reconcile_acquire' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'exchangeRequestFingerprint','stateId'
    ]);
    state_uuid:=(p_payload->>'stateId')::uuid;
    request_hash:=p_payload->>'exchangeRequestFingerprint';
    select state_record.* into state_row
      from private.square_production_internal_oauth_states state_record
      where state_record.state_id=state_uuid for update;
    if not found or state_row.exchange_request_fingerprint is distinct from request_hash
      or state_row.exchange_id is null or state_row.exchange_receipt_fingerprint is null then
      raise exception 'square_production_internal_exchange_acquire_receipt_denied' using errcode='42501';
    end if;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'broker');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'acquire-exchange-v1',state_uuid::text,state_row.consume_receipt_fingerprint
    ]);
    if request_hash<>expected_hash then
      raise exception 'square_production_internal_exchange_acquire_receipt_denied' using errcode='42501';
    end if;
    if state_row.status='stored' then
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'stateId',state_uuid,'status','stored',
        'generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
        'exchangeId',state_row.exchange_id,
        'exchangeRequestFingerprint',state_row.exchange_request_fingerprint,
        'exchangeReceiptFingerprint',state_row.exchange_receipt_fingerprint,
        'credentialCommandFingerprint',state_row.credential_command_fingerprint
      );
    elsif state_row.status<>'exchanging' then
      raise exception 'square_production_internal_exchange_acquire_uncertain' using errcode='55000';
    end if;
    select configuration.* into strict configuration_row
      from private.square_production_configuration_generations configuration
      where configuration.provider_key='square' and configuration.environment='production'
        and configuration.project_id='vaeroex-integrations-prod'
        and configuration.generation=permit_row.generation
        and configuration.configuration_fingerprint=permit_row.configuration_fingerprint;
    select secret_record.secret_version_resource into strict application_secret_resource
      from private.integration_production_provider_secrets secret_record
      where secret_record.provider_key='square' and secret_record.environment='production'
        and secret_record.project_id='vaeroex-integrations-prod'
        and secret_record.secret_purpose=configuration_row.application_secret_purpose;
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_uuid,'status','acquired',
      'generation',permit_row.generation,
      'configurationFingerprint',permit_row.configuration_fingerprint,
      'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
      'applicationId',configuration_row.application_id,
      'applicationSecretVersionResource',application_secret_resource,
      'kmsKeyResource',configuration_row.kms_key_resource,
      'requestedScopes',pg_catalog.to_jsonb(configuration_row.requested_scopes),
      'expectedMerchantId',permit_row.expected_merchant_id,
      'expectedLocationId',permit_row.expected_location_id,
      'exchangeId',state_row.exchange_id,
      'exchangeRequestFingerprint',state_row.exchange_request_fingerprint,
      'exchangeReceiptFingerprint',state_row.exchange_receipt_fingerprint
    );
  elsif p_operation='commit_credential' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'aadContext','aadDigest','accessExpiresAt','ciphertextBase64','commandFingerprint',
      'credentialId','credentialVersion','exchangeId','exchangeReceiptFingerprint',
      'externalEntityFingerprint','grantedScopes',
      'locationId','merchantId','providerIssuedAt','stateId'
    ]);
    state_uuid:=(p_payload->>'stateId')::uuid;
    exchange_uuid:=(p_payload->>'exchangeId')::uuid;
    exchange_receipt_hash:=p_payload->>'exchangeReceiptFingerprint';
    command_hash:=p_payload->>'commandFingerprint';
    select state_record.* into state_row
      from private.square_production_internal_oauth_states state_record
      where state_record.state_id=state_uuid for update;
    if not found then raise exception 'square_production_internal_credential_commit_denied' using errcode='42501'; end if;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'broker');
    if state_row.exchange_id is distinct from exchange_uuid
      or state_row.exchange_receipt_fingerprint is distinct from exchange_receipt_hash then
      raise exception 'square_production_internal_credential_commit_denied' using errcode='42501';
    end if;
    credential_uuid:=(p_payload->>'credentialId')::uuid;
    credential_version_number:=(p_payload->>'credentialVersion')::bigint;
    ciphertext:=p_payload->>'ciphertextBase64';
    aad:=p_payload->'aadContext';
    aad_hash:=p_payload->>'aadDigest';
    external_hash:=p_payload->>'externalEntityFingerprint';
    issued_at:=(p_payload->>'providerIssuedAt')::timestamptz;
    expires_at:=(p_payload->>'accessExpiresAt')::timestamptz;
    if pg_catalog.jsonb_typeof(p_payload->'grantedScopes') is distinct from 'array' then
      raise exception 'square_production_internal_credential_commit_denied' using errcode='22023';
    end if;
    select pg_catalog.array_agg(scope order by scope) into scopes
      from pg_catalog.jsonb_array_elements_text(p_payload->'grantedScopes') scope;
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'credential-command-v1',state_uuid::text,exchange_uuid::text,exchange_receipt_hash,
      credential_uuid::text,credential_version_number::text,
      private.square_production_internal_fingerprint_v1(array['ciphertext-v1',ciphertext]),
      aad_hash,external_hash,p_payload->>'providerIssuedAt',p_payload->>'accessExpiresAt',
      pg_catalog.array_to_string(scopes,',')
    ]);
    if command_hash is distinct from expected_hash
      or credential_uuid is null or credential_version_number is null
      or credential_version_number not between 1 and 9007199254740991
      or ciphertext is null or pg_catalog.length(ciphertext) not between 16 and 131072
      or ciphertext!~'^[A-Za-z0-9+/]+={0,2}$'
      or pg_catalog.jsonb_typeof(aad) is distinct from 'object'
      or pg_catalog.pg_column_size(aad)>4096
      or (select pg_catalog.array_agg(key order by key) from pg_catalog.jsonb_object_keys(aad) key)
        is distinct from array['credentialId','credentialVersion','environment','generation','permitId','projectId','providerKey']::text[]
      or aad->>'providerKey' is distinct from 'square'
      or aad->>'environment' is distinct from 'production'
      or aad->>'projectId' is distinct from 'vaeroex-integrations-prod'
      or (aad->>'generation')::bigint is distinct from permit_row.generation
      or (aad->>'permitId')::uuid is distinct from permit_row.permit_id
      or (aad->>'credentialId')::uuid is distinct from credential_uuid
      or (aad->>'credentialVersion')::bigint is distinct from credential_version_number
      or aad_hash is distinct from private.square_production_internal_fingerprint_v1(array[
        'aad-v1','square','production','vaeroex-integrations-prod',permit_row.generation::text,
        permit_row.permit_id::text,credential_uuid::text,credential_version_number::text
      ])
      or external_hash is distinct from private.square_production_internal_fingerprint_v1(array[
        'external-entity-v1',p_payload->>'merchantId',p_payload->>'locationId'
      ])
      or p_payload->>'merchantId' is distinct from permit_row.expected_merchant_id
      or p_payload->>'locationId' is distinct from permit_row.expected_location_id
      or scopes is distinct from array[
        'INVENTORY_READ','ITEMS_READ','MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ'
      ]::text[]
      or issued_at is null or not pg_catalog.isfinite(issued_at)
      or expires_at is null or not pg_catalog.isfinite(expires_at)
      or issued_at>now_at+interval '5 minutes' or expires_at<=now_at or expires_at<=issued_at then
      raise exception 'square_production_internal_credential_commit_denied' using errcode='42501';
    end if;
    if state_row.status='stored' and state_row.credential_command_fingerprint=command_hash then
      perform private.square_production_internal_audit_v1(
        permit_row.permit_id,permit_row.generation,'credential_commit_replayed','replayed',
        'credential_receipt_reconciled',command_hash,now_at
      );
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'stateId',state_uuid,'status','stored',
        'generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
        'exchangeId',exchange_uuid,
        'exchangeRequestFingerprint',state_row.exchange_request_fingerprint,
        'exchangeReceiptFingerprint',exchange_receipt_hash,
        'credentialCommandFingerprint',command_hash,'replayed',true
      );
    end if;
    if state_row.status not in ('exchanging','uncertain') or state_row.exchange_started_at is null then
      raise exception 'square_production_internal_credential_commit_denied' using errcode='42501';
    end if;
    select configuration.* into strict configuration_row
      from private.square_production_configuration_generations configuration
      where configuration.provider_key='square' and configuration.environment='production'
        and configuration.project_id='vaeroex-integrations-prod'
        and configuration.generation=permit_row.generation;
    insert into private.square_production_internal_credentials(
      credential_id,credential_version,permit_id,oauth_state_id,generation,ciphertext_base64,
      aad_context,aad_digest,kms_key_resource,granted_scopes,external_entity_fingerprint,
      command_fingerprint,provider_issued_at,access_expires_at,created_at
    ) values (
      credential_uuid,credential_version_number,permit_row.permit_id,state_uuid,permit_row.generation,
      ciphertext,aad,aad_hash,configuration_row.kms_key_resource,scopes,external_hash,
      command_hash,issued_at,expires_at,now_at
    );
    update private.square_production_internal_oauth_states
      set status='stored',stored_at=now_at,credential_command_fingerprint=command_hash
      where state_id=state_uuid;
    update private.square_production_internal_permits
      set verified_merchant_id=expected_merchant_id,verified_location_id=expected_location_id,
        credential_id=credential_uuid,credential_version=credential_version_number,
        state='mapping_required',row_version=row_version+1
      where permit_id=permit_row.permit_id;
    perform private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'credential_committed','accepted',
      'encrypted_credential_stored',command_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_uuid,'status','stored',
      'generation',permit_row.generation,
      'configurationFingerprint',permit_row.configuration_fingerprint,
      'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
      'exchangeId',exchange_uuid,
      'exchangeRequestFingerprint',state_row.exchange_request_fingerprint,
      'exchangeReceiptFingerprint',exchange_receipt_hash,
      'credentialCommandFingerprint',command_hash,'replayed',false
    );
  elsif p_operation='reconcile_exchange' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'exchangeId','exchangeReceiptFingerprint','exchangeRequestFingerprint','stateId'
    ]);
    state_uuid:=(p_payload->>'stateId')::uuid;
    exchange_uuid:=(p_payload->>'exchangeId')::uuid;
    request_hash:=p_payload->>'exchangeRequestFingerprint';
    exchange_receipt_hash:=p_payload->>'exchangeReceiptFingerprint';
    select state_record.* into state_row
      from private.square_production_internal_oauth_states state_record
      where state_record.state_id=state_uuid for update;
    if not found or state_row.exchange_id is distinct from exchange_uuid
      or state_row.exchange_request_fingerprint is distinct from request_hash
      or state_row.exchange_receipt_fingerprint is distinct from exchange_receipt_hash then
      raise exception 'square_production_internal_exchange_receipt_denied' using errcode='42501';
    end if;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'broker');
    if state_row.status<>'stored' then
      if state_row.status<>'uncertain' then
        update private.square_production_internal_oauth_states set status='uncertain' where state_id=state_uuid;
        update private.square_production_internal_permits
          set state='recovery_required',row_version=row_version+1 where permit_id=permit_row.permit_id;
        perform private.square_production_internal_audit_v1(
          permit_row.permit_id,permit_row.generation,'exchange_uncertain','blocked',
          'exchange_outcome_uncertain',exchange_receipt_hash,now_at
        );
      end if;
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'stateId',state_uuid,'status','uncertain',
        'generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
        'exchangeId',exchange_uuid,'exchangeRequestFingerprint',request_hash,
        'exchangeReceiptFingerprint',exchange_receipt_hash
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_uuid,'status','stored',
      'generation',permit_row.generation,
      'configurationFingerprint',permit_row.configuration_fingerprint,
      'consumeReceiptFingerprint',state_row.consume_receipt_fingerprint,
      'exchangeId',exchange_uuid,'exchangeRequestFingerprint',request_hash,
      'exchangeReceiptFingerprint',exchange_receipt_hash,
      'credentialCommandFingerprint',state_row.credential_command_fingerprint
    );
  elsif p_operation='read_credential' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'leaseId','leaseOwnerFingerprint','permitId','requestFingerprint','scanId'
    ]);
    permit_uuid:=(p_payload->>'permitId')::uuid;
    scan_uuid:=(p_payload->>'scanId')::uuid;
    lease_uuid:=(p_payload->>'leaseId')::uuid;
    request_hash:=p_payload->>'requestFingerprint';
    select scan.* into scan_row from private.square_production_internal_scans scan
      where scan.scan_id=scan_uuid and scan.permit_id=permit_uuid for update;
    if not found then
      raise exception 'square_production_internal_credential_read_denied' using errcode='42501';
    end if;
    permit_row:=private.square_production_internal_lock_permit_v1(scan_row.permit_id,'broker');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'read-credential-v1',scan_row.scan_id::text,lease_uuid::text,p_payload->>'leaseOwnerFingerprint',
      permit_row.credential_id::text,permit_row.credential_version::text
    ]);
    if permit_row.state<>'syncing' or scan_row.status<>'leased'
      or scan_row.lease_id<>lease_uuid or scan_row.lease_expires_at<=now_at
      or scan_row.lease_owner_fingerprint<>(p_payload->>'leaseOwnerFingerprint')
      or request_hash<>expected_hash then
      raise exception 'square_production_internal_credential_read_denied' using errcode='42501';
    end if;
    select credential.* into strict credential_row
      from private.square_production_internal_credentials credential
      where credential.credential_id=permit_row.credential_id
        and credential.credential_version=permit_row.credential_version
        and credential.permit_id=permit_uuid;
    if credential_row.access_expires_at<=now_at then
      raise exception 'square_production_internal_credential_expired' using errcode='42501';
    end if;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_uuid,permit_row.generation,'credential_read','accepted',
      'lease_bound_credential_read',request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_uuid,'scanId',scan_row.scan_id,'credentialId',credential_row.credential_id,
      'credentialVersion',credential_row.credential_version,'ciphertextBase64',credential_row.ciphertext_base64,
      'aadContext',credential_row.aad_context,'aadDigest',credential_row.aad_digest,
      'kmsKeyResource',credential_row.kms_key_resource,
      'externalEntityFingerprint',credential_row.external_entity_fingerprint,
      'accessExpiresAt',credential_row.access_expires_at,'auditFingerprint',audit_hash
    );
  else
    raise exception 'square_production_internal_broker_operation_invalid' using errcode='22023';
  end if;
end
$function$;

create function private.square_production_internal_guard_lifecycle_update_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if tg_table_name='square_production_internal_permits' then
    if (pg_catalog.to_jsonb(new)-array[
      'verified_merchant_id','verified_location_id','credential_id','credential_version',
      'state','row_version','mapped_at','sync_completed_at','permit_fingerprint'
    ]) is distinct from (pg_catalog.to_jsonb(old)-array[
      'verified_merchant_id','verified_location_id','credential_id','credential_version',
      'state','row_version','mapped_at','sync_completed_at','permit_fingerprint'
    ]) or new.row_version<>old.row_version+1 then
      raise exception 'square_production_internal_permit_identity_immutable' using errcode='55000';
    end if;
  elsif tg_table_name='square_production_internal_oauth_states' then
    if (pg_catalog.to_jsonb(new)-array[
      'status','consumed_at','exchange_started_at','stored_at',
      'consume_request_fingerprint','consume_receipt_fingerprint',
      'deny_request_fingerprint','denial_receipt_fingerprint',
      'exchange_id','exchange_request_fingerprint','exchange_receipt_fingerprint',
      'credential_command_fingerprint'
    ]) is distinct from (pg_catalog.to_jsonb(old)-array[
      'status','consumed_at','exchange_started_at','stored_at',
      'consume_request_fingerprint','consume_receipt_fingerprint',
      'deny_request_fingerprint','denial_receipt_fingerprint',
      'exchange_id','exchange_request_fingerprint','exchange_receipt_fingerprint',
      'credential_command_fingerprint'
    ]) then
      raise exception 'square_production_internal_oauth_state_identity_immutable' using errcode='55000';
    end if;
  elsif tg_table_name='square_production_internal_scans' then
    if (pg_catalog.to_jsonb(new)-array[
      'status','attempt','lease_id','lease_expires_at','committed_at','row_version'
    ]) is distinct from (pg_catalog.to_jsonb(old)-array[
      'status','attempt','lease_id','lease_expires_at','committed_at','row_version'
    ]) or new.row_version<>old.row_version+1 then
      raise exception 'square_production_internal_scan_identity_immutable' using errcode='55000';
    end if;
  else
    raise exception 'square_production_internal_lifecycle_source_invalid' using errcode='55000';
  end if;
  return new;
end
$function$;

create trigger square_production_internal_permit_update_guard
before update on private.square_production_internal_permits
for each row execute function private.square_production_internal_guard_lifecycle_update_v1();
create trigger square_production_internal_permit_delete_guard
before delete or truncate on private.square_production_internal_permits
for each statement execute function private.square_production_internal_reject_immutable_mutation_v1();
create trigger square_production_internal_oauth_state_update_guard
before update on private.square_production_internal_oauth_states
for each row execute function private.square_production_internal_guard_lifecycle_update_v1();
create trigger square_production_internal_oauth_state_delete_guard
before delete or truncate on private.square_production_internal_oauth_states
for each statement execute function private.square_production_internal_reject_immutable_mutation_v1();
create trigger square_production_internal_scan_update_guard
before update on private.square_production_internal_scans
for each row execute function private.square_production_internal_guard_lifecycle_update_v1();
create trigger square_production_internal_scan_delete_guard
before delete or truncate on private.square_production_internal_scans
for each statement execute function private.square_production_internal_reject_immutable_mutation_v1();

do $immutable_history_triggers$
declare table_name text;
begin
  foreach table_name in array array[
    'square_production_internal_credentials','square_production_internal_page_receipts',
    'square_production_internal_source_versions','square_production_internal_fences',
    'square_production_internal_audit_events'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before update or delete or truncate on private.%I for each statement execute function private.square_production_internal_reject_immutable_mutation_v1()',
      table_name||'_immutable',table_name
    );
  end loop;
end
$immutable_history_triggers$;

create function private.square_production_internal_require_keys_v1(
  p_payload jsonb,
  p_required_keys text[]
)
returns void
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path=''
as $function$
declare actual_keys text[];
begin
  if pg_catalog.jsonb_typeof(p_payload)<>'object' then
    raise exception 'square_production_internal_payload_invalid' using errcode='22023';
  end if;
  select pg_catalog.array_agg(key order by key) into actual_keys
  from pg_catalog.jsonb_object_keys(p_payload) key;
  if coalesce(actual_keys,array[]::text[])
    is distinct from (select pg_catalog.array_agg(key order by key) from pg_catalog.unnest(p_required_keys) key)
    or pg_catalog.cardinality(p_required_keys)<>(select count(distinct key) from pg_catalog.unnest(p_required_keys) key) then
    raise exception 'square_production_internal_payload_keys_invalid' using errcode='22023';
  end if;
end
$function$;

create function private.square_production_internal_fingerprint_v1(p_parts text[])
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path=''
as $function$
  select private.integration_production_fingerprint_v1(
    array['square-production-internal-runtime-v1']::text[]||p_parts
  )
$function$;

create function private.square_production_internal_audit_v1(
  p_permit_id uuid,
  p_generation bigint,
  p_event_kind text,
  p_outcome text,
  p_reason_code text,
  p_subject_fingerprint text,
  p_recorded_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare event_fingerprint text;
begin
  event_fingerprint:=private.square_production_internal_fingerprint_v1(array[
    'audit-v1',p_permit_id::text,p_generation::text,p_event_kind,p_outcome,
    p_reason_code,p_subject_fingerprint,p_recorded_at::text
  ]);
  insert into private.square_production_internal_audit_events(
    event_id,permit_id,generation,event_kind,outcome,reason_code,
    subject_fingerprint,event_fingerprint,recorded_at
  ) values (
    pg_catalog.gen_random_uuid(),p_permit_id,p_generation,p_event_kind,p_outcome,p_reason_code,
    p_subject_fingerprint,event_fingerprint,p_recorded_at
  );
  return event_fingerprint;
end
$function$;

create function private.square_production_internal_require_login_v1(p_capability text)
returns void
language plpgsql
stable
security definer
set search_path=''
as $function$
declare login_name text;
declare authority_name text;
begin
  if p_capability not in ('oauth','broker','runtime','evidence') then
    raise exception 'square_production_internal_capability_invalid' using errcode='42501';
  end if;
  login_name:='square_production_'||p_capability;
  authority_name:=login_name||'_authority';
  if session_user::text<>login_name
    or not pg_catalog.pg_has_role(session_user,authority_name,'MEMBER')
    or not exists(
      select 1
      from private.integration_production_provider_capabilities capability
      where capability.provider_key='square'
        and capability.environment='production'
        and capability.project_id='vaeroex-integrations-prod'
        and capability.capability=p_capability
        and capability.database_login::text=login_name
        and capability.database_secret_purpose='database_'||p_capability
        and capability.service_account=
          'sq-prod-'||p_capability||'@vaeroex-integrations-prod.iam.gserviceaccount.com'
    ) then
    raise exception 'square_production_internal_login_denied' using errcode='42501';
  end if;
end
$function$;

create function private.square_production_internal_lock_permit_v1(
  p_permit_id uuid,
  p_capability text,
  p_allow_internal_fence boolean default false
)
returns private.square_production_internal_permits
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_row private.square_production_internal_permits;
declare binding_row private.square_production_runtime_bindings;
declare configuration_row private.square_production_configuration_generations;
begin
  perform private.square_production_internal_require_login_v1(p_capability);
  select permit.* into permit_row
  from private.square_production_internal_permits permit
  where permit.permit_id=p_permit_id
  for update;
  if not found then
    raise exception 'square_production_internal_permit_denied' using errcode='42501';
  end if;

  select binding.* into binding_row
  from private.square_production_runtime_bindings binding
  where binding.provider_key='square' and binding.environment='production'
    and binding.project_id='vaeroex-integrations-prod'
  order by binding.generation desc
  limit 1;
  if not found or binding_row.generation<>permit_row.generation
    or binding_row.configuration_fingerprint<>permit_row.configuration_fingerprint then
    raise exception 'square_production_internal_generation_stale' using errcode='42501';
  end if;
  select configuration.* into strict configuration_row
  from private.square_production_configuration_generations configuration
  where configuration.provider_key='square' and configuration.environment='production'
    and configuration.project_id='vaeroex-integrations-prod'
    and configuration.generation=permit_row.generation
    and configuration.configuration_fingerprint=permit_row.configuration_fingerprint;

  if configuration_row.runtime_enabled or configuration_row.provider_calls_enabled
    or configuration_row.customer_onboarding_enabled or configuration_row.webhook_intake_enabled
    or configuration_row.evidence_enabled or configuration_row.economic_contributions_enabled
    or configuration_row.ai_dispatch_enabled
    or exists(
      select 1 from private.square_production_generation_fences fence
      where fence.provider_key='square' and fence.environment='production'
        and fence.project_id='vaeroex-integrations-prod' and fence.generation=permit_row.generation
    ) or (not p_allow_internal_fence and (
      exists(
        select 1 from private.square_production_internal_fences fence
        where fence.permit_id=permit_row.permit_id
      ) or permit_row.approval_expires_at<=statement_timestamp()
    )) then
    raise exception 'square_production_internal_permit_fenced' using errcode='42501';
  end if;

  if not exists(
    select 1 from auth.sessions session_record
    join public.workspace_members member
      on member.user_id=session_record.user_id and member.workspace_id=permit_row.workspace_id
    join public.business_entities entity
      on entity.id=permit_row.business_entity_id and entity.workspace_id=permit_row.workspace_id
    where session_record.id=permit_row.operator_session_id
      and session_record.user_id=permit_row.operator_id
      and session_record.not_after>statement_timestamp()
      and member.status='active' and member.role in ('owner','admin','manager')
      and entity.status='active'
  ) then
    raise exception 'square_production_internal_operator_denied' using errcode='42501';
  end if;
  perform private.square_production_internal_require_login_v1(p_capability);
  return permit_row;
end
$function$;

create function private.square_production_internal_install_permit_v1(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_uuid uuid;
declare generation_number bigint;
declare configuration_hash text;
declare workspace_uuid uuid;
declare entity_uuid uuid;
declare operator_uuid uuid;
declare session_uuid uuid;
declare expected_merchant text;
declare expected_location text;
declare expires_at timestamptz;
declare request_hash text;
declare installed_at timestamptz:=statement_timestamp();
declare binding_row private.square_production_runtime_bindings;
declare configuration_row private.square_production_configuration_generations;
declare expected_request_hash text;
declare permit_hash text;
begin
  if session_user::text<>'postgres' or current_user::text<>'postgres' then
    raise exception 'square_production_internal_permit_install_denied' using errcode='42501';
  end if;
  perform private.square_production_internal_require_keys_v1(p_payload,array[
    'approvalExpiresAt','businessEntityId','configurationFingerprint','expectedLocationId',
    'expectedMerchantId','generation','operatorId','operatorSessionId','permitId',
    'requestFingerprint','workspaceId'
  ]);
  permit_uuid:=(p_payload->>'permitId')::uuid;
  generation_number:=(p_payload->>'generation')::bigint;
  configuration_hash:=p_payload->>'configurationFingerprint';
  workspace_uuid:=(p_payload->>'workspaceId')::uuid;
  entity_uuid:=(p_payload->>'businessEntityId')::uuid;
  operator_uuid:=(p_payload->>'operatorId')::uuid;
  session_uuid:=(p_payload->>'operatorSessionId')::uuid;
  expected_merchant:=p_payload->>'expectedMerchantId';
  expected_location:=p_payload->>'expectedLocationId';
  expires_at:=(p_payload->>'approvalExpiresAt')::timestamptz;
  request_hash:=p_payload->>'requestFingerprint';
  expected_request_hash:=private.square_production_internal_fingerprint_v1(array[
    'install-permit-v1',permit_uuid::text,generation_number::text,configuration_hash,
    workspace_uuid::text,entity_uuid::text,operator_uuid::text,session_uuid::text,
    expected_merchant,expected_location,p_payload->>'approvalExpiresAt'
  ]);
  if request_hash is distinct from expected_request_hash
    or expires_at<=installed_at or expires_at>installed_at+interval '24 hours' then
    raise exception 'square_production_internal_permit_install_invalid' using errcode='22023';
  end if;

  select binding.* into binding_row
  from private.square_production_runtime_bindings binding
  where binding.provider_key='square' and binding.environment='production'
    and binding.project_id='vaeroex-integrations-prod'
  order by binding.generation desc limit 1;
  if not found or binding_row.generation<>generation_number
    or binding_row.configuration_fingerprint<>configuration_hash
    or exists(
      select 1 from private.square_production_generation_fences fence
      where fence.provider_key='square' and fence.environment='production'
        and fence.project_id='vaeroex-integrations-prod' and fence.generation=generation_number
    ) then
    raise exception 'square_production_internal_generation_stale' using errcode='42501';
  end if;
  select configuration.* into strict configuration_row
  from private.square_production_configuration_generations configuration
  where configuration.provider_key='square' and configuration.environment='production'
    and configuration.project_id='vaeroex-integrations-prod'
    and configuration.generation=generation_number
    and configuration.configuration_fingerprint=configuration_hash;
  if configuration_row.runtime_enabled or configuration_row.provider_calls_enabled
    or configuration_row.customer_onboarding_enabled or configuration_row.webhook_intake_enabled
    or configuration_row.evidence_enabled or configuration_row.economic_contributions_enabled
    or configuration_row.ai_dispatch_enabled then
    raise exception 'square_production_internal_general_gate_open' using errcode='42501';
  end if;
  if (select count(*) from private.integration_production_provider_capabilities capability
      where capability.provider_key='square' and capability.environment='production'
        and capability.project_id='vaeroex-integrations-prod'
        and (capability.capability,capability.service_account,capability.database_login::text,capability.database_secret_purpose)
          in (
            ('oauth','sq-prod-oauth@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_oauth','database_oauth'),
            ('broker','sq-prod-broker@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_broker','database_broker'),
            ('scheduler','sq-prod-scheduler@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_scheduler','database_scheduler'),
            ('webhook','sq-prod-webhook@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_webhook','database_webhook'),
            ('runtime','sq-prod-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_runtime','database_runtime'),
            ('evidence','sq-prod-evidence@vaeroex-integrations-prod.iam.gserviceaccount.com','square_production_evidence','database_evidence')
          ))<>6
    or not exists(
      select 1 from private.integration_production_provider_capabilities capability
      where capability.provider_key='square' and capability.environment='production'
        and capability.project_id='vaeroex-integrations-prod'
        and capability.capability='task_invoker'
        and capability.service_account='sq-prod-task-invoker@vaeroex-integrations-prod.iam.gserviceaccount.com'
        and capability.database_login is null and capability.database_secret_purpose is null
    ) then
    raise exception 'square_production_internal_native_profiles_incomplete' using errcode='42501';
  end if;
  if not exists(
    select 1 from auth.sessions session_record
    join public.workspace_members member
      on member.user_id=session_record.user_id and member.workspace_id=workspace_uuid
    join public.business_entities entity
      on entity.id=entity_uuid and entity.workspace_id=workspace_uuid
    where session_record.id=session_uuid and session_record.user_id=operator_uuid
      and session_record.not_after>installed_at
      and member.status='active' and member.role in ('owner','admin','manager')
      and entity.status='active'
  ) then
    raise exception 'square_production_internal_operator_denied' using errcode='42501';
  end if;

  insert into private.square_production_internal_permits(
    permit_id,generation,configuration_fingerprint,workspace_id,business_entity_id,
    operator_id,operator_session_id,expected_merchant_id,expected_location_id,
    approval_expires_at,installed_at
  ) values (
    permit_uuid,generation_number,configuration_hash,workspace_uuid,entity_uuid,
    operator_uuid,session_uuid,expected_merchant,expected_location,expires_at,installed_at
  ) returning permit_fingerprint into permit_hash;
  perform private.square_production_internal_audit_v1(
    permit_uuid,generation_number,'permit_installed','recorded','internal_permit_exact',
    permit_hash,installed_at
  );
  return pg_catalog.jsonb_build_object(
    'permitId',permit_uuid,'generation',generation_number,'permitFingerprint',permit_hash,
    'approvalExpiresAt',expires_at,'state','prepared'
  );
end
$function$;

create function public.square_production_internal_oauth_v1(p_operation text,p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_uuid uuid;
declare permit_row private.square_production_internal_permits;
declare state_uuid uuid;
declare state_row private.square_production_internal_oauth_states;
declare now_at timestamptz:=statement_timestamp();
declare request_hash text;
declare expected_hash text;
declare state_digest text;
declare expires_at timestamptz;
declare receipt_hash text;
declare actor_uuid uuid;
declare session_uuid uuid;
declare cleanup_reason text;
declare cleanup_hash text;
declare audit_hash text;
declare was_replay boolean:=false;
begin
  perform private.square_production_internal_require_login_v1('oauth');
  if p_operation='create_state' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'actorId','expiresAt','permitId','requestFingerprint','sessionId','stateHash','stateId'
    ]);
    permit_uuid:=(p_payload->>'permitId')::uuid;
    state_uuid:=(p_payload->>'stateId')::uuid;
    actor_uuid:=(p_payload->>'actorId')::uuid;
    session_uuid:=(p_payload->>'sessionId')::uuid;
    state_digest:=p_payload->>'stateHash';
    expires_at:=(p_payload->>'expiresAt')::timestamptz;
    request_hash:=p_payload->>'requestFingerprint';
    permit_row:=private.square_production_internal_lock_permit_v1(permit_uuid,'oauth');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'create-state-v1',permit_uuid::text,state_uuid::text,state_digest,
      actor_uuid::text,session_uuid::text,p_payload->>'expiresAt',permit_row.row_version::text
    ]);
    if permit_row.state<>'prepared' or actor_uuid<>permit_row.operator_id
      or session_uuid<>permit_row.operator_session_id or request_hash<>expected_hash
      or state_digest!~'^[a-f0-9]{64}$' or expires_at<=now_at
      or expires_at>least(permit_row.approval_expires_at,now_at+interval '10 minutes') then
      raise exception 'square_production_internal_state_create_denied' using errcode='42501';
    end if;
    insert into private.square_production_internal_oauth_states(
      state_id,permit_id,state_hash,generation,permit_row_version,actor_id,session_id,
      request_fingerprint,status,expires_at,created_at
    ) values (
      state_uuid,permit_uuid,state_digest,permit_row.generation,permit_row.row_version,
      actor_uuid,session_uuid,request_hash,'pending',expires_at,now_at
    );
    update private.square_production_internal_permits
      set state='consent_pending',row_version=row_version+1 where permit_id=permit_uuid;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_uuid,permit_row.generation,'oauth_state_created','accepted','state_hash_created',
      request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_uuid,'stateId',state_uuid,'state','consent_pending',
      'expiresAt',expires_at,'auditFingerprint',audit_hash
    );
  elsif p_operation='consume_state' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'consumeRequestFingerprint','stateHash'
    ]);
    state_digest:=p_payload->>'stateHash';
    request_hash:=p_payload->>'consumeRequestFingerprint';
    select state_record.* into state_row
    from private.square_production_internal_oauth_states state_record
    where state_record.state_hash=state_digest for update;
    if not found then
      raise exception 'square_production_internal_state_denied' using errcode='42501';
    end if;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'oauth');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'consume-state-v2',state_digest
    ]);
    if request_hash<>expected_hash then
      raise exception 'square_production_internal_state_denied' using errcode='42501';
    end if;
    if state_row.status='pending' then
      if state_row.expires_at<=now_at or permit_row.state<>'consent_pending' then
        raise exception 'square_production_internal_state_expired' using errcode='42501';
      end if;
      receipt_hash:=private.square_production_internal_fingerprint_v1(array[
        'state-consume-receipt-v1',state_row.state_id::text,request_hash,now_at::text
      ]);
      update private.square_production_internal_oauth_states
        set status='exchanging',consumed_at=now_at,consume_request_fingerprint=request_hash,
          consume_receipt_fingerprint=receipt_hash
        where state_id=state_row.state_id;
      perform private.square_production_internal_audit_v1(
        permit_row.permit_id,permit_row.generation,'oauth_state_consumed','accepted',
        'state_consumed_once',receipt_hash,now_at
      );
    elsif state_row.status in ('exchanging','stored','uncertain')
      and state_row.consume_request_fingerprint=request_hash
      and state_row.consume_receipt_fingerprint is not null then
      receipt_hash:=state_row.consume_receipt_fingerprint;
      was_replay:=true;
    else
      raise exception 'square_production_internal_state_already_consumed' using errcode='42501';
    end if;
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_row.state_id,
      'generation',permit_row.generation,'configurationFingerprint',permit_row.configuration_fingerprint,
      'consumeReceiptFingerprint',receipt_hash,
      'status',case when was_replay then 'replayed' else 'consumed' end
    );
  elsif p_operation='deny_state' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'denyRequestFingerprint','stateHash'
    ]);
    state_digest:=p_payload->>'stateHash';
    request_hash:=p_payload->>'denyRequestFingerprint';
    select state_record.* into state_row from private.square_production_internal_oauth_states state_record
      where state_record.state_hash=state_digest for update;
    if not found then raise exception 'square_production_internal_state_denied' using errcode='42501'; end if;
    state_uuid:=state_row.state_id;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'oauth');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'deny-state-v1',state_digest
    ]);
    if request_hash<>expected_hash then
      raise exception 'square_production_internal_state_denied' using errcode='42501';
    end if;
    if state_row.status='denied' and state_row.deny_request_fingerprint=request_hash
      and state_row.denial_receipt_fingerprint is not null then
      return pg_catalog.jsonb_build_object(
        'status','denied','generation',permit_row.generation,
        'configurationFingerprint',permit_row.configuration_fingerprint,
        'denialReceiptFingerprint',state_row.denial_receipt_fingerprint
      );
    elsif state_row.status<>'pending' then
      raise exception 'square_production_internal_state_denied' using errcode='42501';
    end if;
    if state_row.expires_at<=now_at or permit_row.state<>'consent_pending' then
      raise exception 'square_production_internal_state_expired' using errcode='42501';
    end if;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'oauth_state_denied','blocked','operator_denied',
      request_hash,now_at
    );
    update private.square_production_internal_oauth_states
      set status='denied',deny_request_fingerprint=request_hash,denial_receipt_fingerprint=audit_hash
      where state_id=state_uuid;
    update private.square_production_internal_permits
      set state='recovery_required',row_version=row_version+1 where permit_id=permit_row.permit_id;
    return pg_catalog.jsonb_build_object(
      'status','denied','generation',permit_row.generation,
      'configurationFingerprint',permit_row.configuration_fingerprint,
      'denialReceiptFingerprint',audit_hash
    );
  elsif p_operation='reconcile_state' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'consumeRequestFingerprint','stateHash'
    ]);
    state_digest:=p_payload->>'stateHash';
    request_hash:=p_payload->>'consumeRequestFingerprint';
    select state_record.* into state_row from private.square_production_internal_oauth_states state_record
      where state_record.state_hash=state_digest;
    if not found or request_hash!~'^sha256:[a-f0-9]{64}$'
      or state_row.status not in ('exchanging','stored','uncertain')
      or state_row.consume_request_fingerprint is distinct from request_hash then
      raise exception 'square_production_internal_state_receipt_denied' using errcode='42501';
    end if;
    state_uuid:=state_row.state_id;
    receipt_hash:=state_row.consume_receipt_fingerprint;
    permit_row:=private.square_production_internal_lock_permit_v1(state_row.permit_id,'oauth');
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'stateId',state_uuid,
      'generation',permit_row.generation,'configurationFingerprint',permit_row.configuration_fingerprint,
      'status',case when state_row.status='exchanging' then 'consumed' else state_row.status end,
      'consumeReceiptFingerprint',receipt_hash,
      'credentialCommandFingerprint',state_row.credential_command_fingerprint
    );
  elsif p_operation='confirm_mapping' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'actorId','locationId','mappingFingerprint','merchantId','permitId','sessionId'
    ]);
    permit_uuid:=(p_payload->>'permitId')::uuid;
    actor_uuid:=(p_payload->>'actorId')::uuid;
    session_uuid:=(p_payload->>'sessionId')::uuid;
    request_hash:=p_payload->>'mappingFingerprint';
    permit_row:=private.square_production_internal_lock_permit_v1(permit_uuid,'oauth');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'confirm-mapping-v1',permit_uuid::text,actor_uuid::text,session_uuid::text,
      p_payload->>'merchantId',p_payload->>'locationId',permit_row.row_version::text
    ]);
    if permit_row.state<>'mapping_required' or actor_uuid<>permit_row.operator_id
      or session_uuid<>permit_row.operator_session_id
      or (p_payload->>'merchantId')<>permit_row.expected_merchant_id
      or (p_payload->>'locationId')<>permit_row.expected_location_id
      or request_hash<>expected_hash then
      raise exception 'square_production_internal_mapping_denied' using errcode='42501';
    end if;
    update private.square_production_internal_permits
      set state='mapped',mapped_at=now_at,row_version=row_version+1 where permit_id=permit_uuid;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_uuid,permit_row.generation,'mapping_confirmed','accepted','exact_location_confirmed',
      request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_uuid,'state','mapped','mappingFingerprint',request_hash,
      'auditFingerprint',audit_hash
    );
  elsif p_operation='cleanup' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'cleanupFingerprint','permitId','reasonCode'
    ]);
    permit_uuid:=(p_payload->>'permitId')::uuid;
    cleanup_hash:=p_payload->>'cleanupFingerprint';
    cleanup_reason:=p_payload->>'reasonCode';
    permit_row:=private.square_production_internal_lock_permit_v1(permit_uuid,'oauth',true);
    if cleanup_reason not in ('internal_pilot_complete','manual_operator_stop') then
      raise exception 'square_production_internal_cleanup_denied' using errcode='42501';
    end if;
    if permit_row.state='cleaned' then
      if not exists(
        select 1 from private.square_production_internal_fences fence
        where fence.permit_id=permit_uuid and fence.fence_kind='operator_cleanup'
          and fence.reason_code=cleanup_reason and fence.cleanup_fingerprint=cleanup_hash
      ) then
        raise exception 'square_production_internal_cleanup_denied' using errcode='42501';
      end if;
      return pg_catalog.jsonb_build_object(
        'permitId',permit_uuid,'state','cleaned','fenceKind','operator_cleanup',
        'fenceFingerprint',(select fence_fingerprint from private.square_production_internal_fences where permit_id=permit_uuid),
        'auditFingerprint',(select event_fingerprint from private.square_production_internal_audit_events
          where permit_id=permit_uuid and event_kind='pilot_cleaned'
            and subject_fingerprint=cleanup_hash order by recorded_at desc limit 1),
        'replayed',true
      );
    end if;
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'cleanup-v1',permit_uuid::text,cleanup_reason,permit_row.row_version::text
    ]);
    if cleanup_hash<>expected_hash
      or (cleanup_reason='internal_pilot_complete' and permit_row.state<>'synced') then
      raise exception 'square_production_internal_cleanup_denied' using errcode='42501';
    end if;
    insert into private.square_production_internal_fences(
      permit_id,generation,configuration_fingerprint,fence_kind,reason_code,
      cleanup_fingerprint,fenced_at
    ) values (
      permit_uuid,permit_row.generation,permit_row.configuration_fingerprint,
      'operator_cleanup',cleanup_reason,cleanup_hash,now_at
    );
    update private.square_production_internal_permits
      set state='cleaned',row_version=row_version+1 where permit_id=permit_uuid;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_uuid,permit_row.generation,'pilot_cleaned','fenced',cleanup_reason,cleanup_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_uuid,'state','cleaned','fenceKind','operator_cleanup',
      'fenceFingerprint',(select fence_fingerprint from private.square_production_internal_fences where permit_id=permit_uuid),
      'auditFingerprint',audit_hash,'replayed',false
    );
  else
    raise exception 'square_production_internal_oauth_operation_invalid' using errcode='22023';
  end if;
end
$function$;

create function public.square_production_internal_runtime_v1(p_operation text,p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_uuid uuid;
declare permit_row private.square_production_internal_permits;
declare scan_uuid uuid;
declare scan_row private.square_production_internal_scans;
declare task_uuid uuid;
declare lease_uuid uuid;
declare now_at timestamptz:=statement_timestamp();
declare window_start timestamptz;
declare window_end timestamptz;
declare request_hash text;
declare expected_hash text;
declare owner_hash text;
declare page_hash text;
declare response_hash text;
declare command_hash text;
declare result_hash text;
declare audit_hash text;
declare reason text;
declare observation jsonb;
declare observation_ordinal bigint;
declare expected_location_hash text;
declare expected_source_hash text;
begin
  perform private.square_production_internal_require_login_v1('runtime');
  if p_operation='create_scan' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'leaseOwnerFingerprint','paymentWindowEnd','paymentWindowStart','permitId',
      'requestFingerprint','scanId','taskId'
    ]);
    permit_uuid:=(p_payload->>'permitId')::uuid;
    scan_uuid:=(p_payload->>'scanId')::uuid;
    task_uuid:=(p_payload->>'taskId')::uuid;
    window_start:=(p_payload->>'paymentWindowStart')::timestamptz;
    window_end:=(p_payload->>'paymentWindowEnd')::timestamptz;
    owner_hash:=p_payload->>'leaseOwnerFingerprint';
    request_hash:=p_payload->>'requestFingerprint';
    permit_row:=private.square_production_internal_lock_permit_v1(permit_uuid,'runtime');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'create-scan-v1',permit_uuid::text,scan_uuid::text,task_uuid::text,
      p_payload->>'paymentWindowStart',p_payload->>'paymentWindowEnd',owner_hash,permit_row.row_version::text
    ]);
    if permit_row.state<>'mapped' or request_hash<>expected_hash
      or owner_hash!~'^sha256:[a-f0-9]{64}$'
      or window_end>now_at or window_end<=window_start
      or window_end-window_start>interval '24 hours' then
      raise exception 'square_production_internal_scan_create_denied' using errcode='42501';
    end if;
    insert into private.square_production_internal_scans(
      scan_id,task_id,permit_id,generation,payment_window_start,payment_window_end,
      request_fingerprint,lease_owner_fingerprint,created_at
    ) values (
      scan_uuid,task_uuid,permit_uuid,permit_row.generation,window_start,window_end,
      request_hash,owner_hash,now_at
    );
    update private.square_production_internal_permits
      set state='syncing',row_version=row_version+1 where permit_id=permit_uuid;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_uuid,permit_row.generation,'scan_created','accepted','manual_payments_scan',
      request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_uuid,'scanId',scan_uuid,'taskId',task_uuid,'status','ready',
      'stream','payments','operation','list_payments','auditFingerprint',audit_hash
    );
  elsif p_operation='acquire_page' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'leaseId','leaseOwnerFingerprint','requestFingerprint','scanId'
    ]);
    scan_uuid:=(p_payload->>'scanId')::uuid;
    lease_uuid:=(p_payload->>'leaseId')::uuid;
    owner_hash:=p_payload->>'leaseOwnerFingerprint';
    request_hash:=p_payload->>'requestFingerprint';
    select scan.* into scan_row from private.square_production_internal_scans scan
      where scan.scan_id=scan_uuid for update;
    if not found then raise exception 'square_production_internal_page_acquire_denied' using errcode='42501'; end if;
    permit_row:=private.square_production_internal_lock_permit_v1(scan_row.permit_id,'runtime');
    if scan_row.status='committed' then
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'scanId',scan_uuid,'status','committed','replayed',true
      );
    elsif scan_row.status='leased' and scan_row.lease_id=lease_uuid
      and scan_row.lease_owner_fingerprint=owner_hash and scan_row.lease_expires_at>now_at then
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'scanId',scan_uuid,'status','leased',
        'leaseId',lease_uuid,'leaseExpiresAt',scan_row.lease_expires_at,'replayed',true,
        'method','GET','path','/v2/payments','beginTime',scan_row.payment_window_start,
        'endTime',scan_row.payment_window_end,'continuationAllowed',false
      );
    end if;
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'acquire-page-v1',scan_uuid::text,lease_uuid::text,owner_hash,scan_row.row_version::text
    ]);
    if permit_row.state<>'syncing' or owner_hash<>scan_row.lease_owner_fingerprint
      or request_hash<>expected_hash or scan_row.attempt>=3
      or not (scan_row.status='ready' or (scan_row.status='leased' and scan_row.lease_expires_at<=now_at)) then
      raise exception 'square_production_internal_page_acquire_denied' using errcode='42501';
    end if;
    update private.square_production_internal_scans
      set status='leased',attempt=attempt+1,lease_id=lease_uuid,
        lease_expires_at=now_at+interval '2 minutes',row_version=row_version+1
      where scan_id=scan_uuid returning * into scan_row;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'page_leased','accepted','single_page_lease',
      request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'scanId',scan_uuid,'status','leased',
      'leaseId',lease_uuid,'leaseExpiresAt',scan_row.lease_expires_at,'replayed',false,
      'method','GET','path','/v2/payments','beginTime',scan_row.payment_window_start,
      'endTime',scan_row.payment_window_end,'continuationAllowed',false,
      'requestFingerprint',request_hash,'auditFingerprint',audit_hash
    );
  elsif p_operation='commit_page' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'commandFingerprint','continuation','leaseId','leaseOwnerFingerprint','observations',
      'pageId','responseFingerprint','scanId'
    ]);
    scan_uuid:=(p_payload->>'scanId')::uuid;
    lease_uuid:=(p_payload->>'leaseId')::uuid;
    owner_hash:=p_payload->>'leaseOwnerFingerprint';
    page_hash:=p_payload->>'pageId';
    response_hash:=p_payload->>'responseFingerprint';
    command_hash:=p_payload->>'commandFingerprint';
    if pg_catalog.jsonb_typeof(p_payload->'observations') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_payload->'observations')>100
      or (p_payload->>'continuation')::boolean is distinct from false then
      raise exception 'square_production_internal_page_commit_denied' using errcode='22023';
    end if;
    select scan.* into scan_row from private.square_production_internal_scans scan
      where scan.scan_id=scan_uuid for update;
    if not found then raise exception 'square_production_internal_page_commit_denied' using errcode='42501'; end if;
    permit_row:=private.square_production_internal_lock_permit_v1(scan_row.permit_id,'runtime');
    expected_location_hash:=private.square_production_internal_fingerprint_v1(array[
      'location-v1',permit_row.expected_location_id
    ]);
    for observation,observation_ordinal in
      select value,ordinality from pg_catalog.jsonb_array_elements(p_payload->'observations') with ordinality
    loop
      perform private.square_production_internal_require_keys_v1(observation,array[
        'locationFingerprint','observedAt','occurredAt','ordinal','paymentFingerprint',
        'paymentStatus','sourceFingerprint','sourceVersionId','versionFingerprint'
      ]);
      expected_source_hash:=private.square_production_internal_fingerprint_v1(array[
        'payment-observation-v1',scan_uuid::text,page_hash,(observation->>'ordinal'),
        observation->>'paymentFingerprint',observation->>'versionFingerprint',
        observation->>'locationFingerprint',observation->>'paymentStatus',
        observation->>'occurredAt',observation->>'observedAt'
      ]);
      if coalesce((observation->>'ordinal')::bigint,0)<>observation_ordinal
        or (observation->>'sourceVersionId') is null
        or (observation->>'sourceVersionId')::uuid is null
        or not coalesce((observation->>'paymentFingerprint')~'^sha256:[a-f0-9]{64}$',false)
        or not coalesce((observation->>'versionFingerprint')~'^sha256:[a-f0-9]{64}$',false)
        or observation->>'locationFingerprint' is distinct from expected_location_hash
        or not coalesce(observation->>'paymentStatus' in (
          'approved','completed','canceled','failed','pending','unknown'
        ),false)
        or observation->>'sourceFingerprint' is distinct from expected_source_hash
        or (observation->>'observedAt') is null
        or not pg_catalog.isfinite((observation->>'observedAt')::timestamptz)
        or (observation->>'occurredAt') is null
        or not pg_catalog.isfinite((observation->>'occurredAt')::timestamptz)
        or (observation->>'observedAt')::timestamptz>now_at+interval '5 minutes'
        or (observation->>'occurredAt')::timestamptz>(observation->>'observedAt')::timestamptz then
        raise exception 'square_production_internal_observation_denied' using errcode='42501';
      end if;
    end loop;
    select private.square_production_internal_fingerprint_v1(array[
      'page-result-v2',scan_uuid::text,page_hash,
      coalesce(pg_catalog.string_agg(
        private.square_production_internal_fingerprint_v1(array[
          'page-observation-v1',value->>'sourceVersionId',value->>'ordinal',
          value->>'paymentFingerprint',value->>'versionFingerprint',value->>'locationFingerprint',
          value->>'paymentStatus',value->>'occurredAt',value->>'observedAt',value->>'sourceFingerprint'
        ]),',' order by ordinality
      ),'')
    ]) into result_hash
    from pg_catalog.jsonb_array_elements(p_payload->'observations') with ordinality;
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'commit-page-v1',scan_uuid::text,lease_uuid::text,page_hash,response_hash,
      result_hash,'false'
    ]);
    if owner_hash is distinct from scan_row.lease_owner_fingerprint
      or not coalesce(response_hash~'^sha256:[a-f0-9]{64}$',false)
      or page_hash is distinct from private.square_production_internal_fingerprint_v1(array[
        'payments-page-v1',scan_uuid::text,response_hash
      ]) or command_hash is distinct from expected_hash then
      raise exception 'square_production_internal_page_commit_denied' using errcode='42501';
    end if;
    if exists(
      select 1 from private.square_production_internal_page_receipts receipt
      where receipt.scan_id=scan_uuid and receipt.command_fingerprint=command_hash
        and receipt.page_id=page_hash and receipt.response_fingerprint=response_hash
        and receipt.result_fingerprint=result_hash
        and receipt.observation_count=pg_catalog.jsonb_array_length(p_payload->'observations')
    ) then
      perform private.square_production_internal_audit_v1(
        permit_row.permit_id,permit_row.generation,'page_replayed','replayed',
        'page_receipt_reconciled',command_hash,now_at
      );
      return pg_catalog.jsonb_build_object(
        'permitId',permit_row.permit_id,'scanId',scan_uuid,'pageId',page_hash,
        'status','committed','replayed',true,'commandFingerprint',command_hash
      );
    end if;
    if permit_row.state<>'syncing' or scan_row.status<>'leased'
      or scan_row.lease_id<>lease_uuid or scan_row.lease_expires_at<=now_at
      or scan_row.lease_owner_fingerprint<>owner_hash then
      raise exception 'square_production_internal_page_commit_denied' using errcode='42501';
    end if;
    insert into private.square_production_internal_page_receipts(
      scan_id,page_id,permit_id,generation,command_fingerprint,response_fingerprint,
      result_fingerprint,observation_count,committed_at
    ) values (
      scan_uuid,page_hash,permit_row.permit_id,permit_row.generation,command_hash,response_hash,
      result_hash,pg_catalog.jsonb_array_length(p_payload->'observations'),now_at
    );
    for observation,observation_ordinal in
      select value,ordinality from pg_catalog.jsonb_array_elements(p_payload->'observations') with ordinality
    loop
      insert into private.square_production_internal_source_versions(
        source_version_id,scan_id,page_id,permit_id,generation,ordinal,payment_fingerprint,
        version_fingerprint,location_fingerprint,payment_status,occurred_at,observed_at,source_fingerprint
      ) values (
        (observation->>'sourceVersionId')::uuid,scan_uuid,page_hash,permit_row.permit_id,
        permit_row.generation,(observation->>'ordinal')::smallint,observation->>'paymentFingerprint',
        observation->>'versionFingerprint',observation->>'locationFingerprint',observation->>'paymentStatus',
        (observation->>'occurredAt')::timestamptz,(observation->>'observedAt')::timestamptz,
        observation->>'sourceFingerprint'
      );
    end loop;
    update private.square_production_internal_scans
      set status='committed',lease_id=null,lease_expires_at=null,committed_at=now_at,
        row_version=row_version+1 where scan_id=scan_uuid;
    update private.square_production_internal_permits
      set state='synced',sync_completed_at=now_at,row_version=row_version+1
      where permit_id=permit_row.permit_id;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'page_committed','accepted',
      'single_page_committed',command_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'scanId',scan_uuid,'pageId',page_hash,
      'status','committed','replayed',false,'commandFingerprint',command_hash,
      'resultFingerprint',result_hash,'observationCount',pg_catalog.jsonb_array_length(p_payload->'observations'),
      'auditFingerprint',audit_hash
    );
  elsif p_operation='release_page' then
    perform private.square_production_internal_require_keys_v1(p_payload,array[
      'leaseId','leaseOwnerFingerprint','reasonCode','releaseFingerprint','scanId'
    ]);
    scan_uuid:=(p_payload->>'scanId')::uuid;
    lease_uuid:=(p_payload->>'leaseId')::uuid;
    owner_hash:=p_payload->>'leaseOwnerFingerprint';
    reason:=p_payload->>'reasonCode';
    request_hash:=p_payload->>'releaseFingerprint';
    select scan.* into scan_row from private.square_production_internal_scans scan
      where scan.scan_id=scan_uuid for update;
    if not found then raise exception 'square_production_internal_page_release_denied' using errcode='42501'; end if;
    permit_row:=private.square_production_internal_lock_permit_v1(scan_row.permit_id,'runtime');
    expected_hash:=private.square_production_internal_fingerprint_v1(array[
      'release-page-v1',scan_uuid::text,lease_uuid::text,owner_hash,reason,scan_row.row_version::text
    ]);
    if scan_row.status<>'leased' or scan_row.lease_id<>lease_uuid
      or scan_row.lease_owner_fingerprint<>owner_hash or request_hash<>expected_hash
      or reason not in ('manual_retry_required','provider_response_invalid') then
      raise exception 'square_production_internal_page_release_denied' using errcode='42501';
    end if;
    if reason='manual_retry_required' and scan_row.attempt<3 then
      update private.square_production_internal_scans
        set status='ready',lease_id=null,lease_expires_at=null,row_version=row_version+1
        where scan_id=scan_uuid;
    else
      update private.square_production_internal_scans
        set status='blocked',lease_id=null,lease_expires_at=null,row_version=row_version+1
        where scan_id=scan_uuid;
      update private.square_production_internal_permits
        set state='recovery_required',row_version=row_version+1 where permit_id=permit_row.permit_id;
    end if;
    audit_hash:=private.square_production_internal_audit_v1(
      permit_row.permit_id,permit_row.generation,'page_released','blocked',reason,request_hash,now_at
    );
    return pg_catalog.jsonb_build_object(
      'permitId',permit_row.permit_id,'scanId',scan_uuid,
      'status',case when reason='manual_retry_required' and scan_row.attempt<3 then 'ready' else 'blocked' end,
      'reasonCode',reason,'auditFingerprint',audit_hash
    );
  else
    raise exception 'square_production_internal_runtime_operation_invalid' using errcode='22023';
  end if;
end
$function$;

create function public.square_production_internal_evidence_v1(p_operation text,p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare permit_uuid uuid;
declare permit_row private.square_production_internal_permits;
declare request_hash text;
declare expected_hash text;
declare audit_hash text;
declare now_at timestamptz:=statement_timestamp();
declare oauth_state_count integer;
declare credential_count integer;
declare scan_count integer;
declare page_count integer;
declare observation_count integer;
declare event_count integer;
declare fence_hash text;
begin
  perform private.square_production_internal_require_login_v1('evidence');
  if p_operation<>'read' then
    raise exception 'square_production_internal_evidence_operation_invalid' using errcode='22023';
  end if;
  perform private.square_production_internal_require_keys_v1(p_payload,array[
    'actorId','businessEntityId','permitId','requestFingerprint','sessionId','workspaceId'
  ]);
  permit_uuid:=(p_payload->>'permitId')::uuid;
  request_hash:=p_payload->>'requestFingerprint';
  permit_row:=private.square_production_internal_lock_permit_v1(permit_uuid,'evidence',true);
  expected_hash:=private.square_production_internal_fingerprint_v1(array[
    'read-evidence-v1',permit_uuid::text,permit_row.generation::text,
    permit_row.configuration_fingerprint,permit_row.row_version::text,
    p_payload->>'workspaceId',p_payload->>'businessEntityId',
    p_payload->>'actorId',p_payload->>'sessionId'
  ]);
  if request_hash<>expected_hash
    or (p_payload->>'workspaceId')::uuid<>permit_row.workspace_id
    or (p_payload->>'businessEntityId')::uuid<>permit_row.business_entity_id
    or (p_payload->>'actorId')::uuid<>permit_row.operator_id
    or (p_payload->>'sessionId')::uuid<>permit_row.operator_session_id then
    raise exception 'square_production_internal_evidence_denied' using errcode='42501';
  end if;
  select count(*)::integer into oauth_state_count
    from private.square_production_internal_oauth_states where permit_id=permit_uuid;
  select count(*)::integer into credential_count
    from private.square_production_internal_credentials where permit_id=permit_uuid;
  select count(*)::integer into scan_count
    from private.square_production_internal_scans where permit_id=permit_uuid;
  select count(*)::integer into page_count
    from private.square_production_internal_page_receipts where permit_id=permit_uuid;
  select count(*)::integer into observation_count
    from private.square_production_internal_source_versions where permit_id=permit_uuid;
  select count(*)::integer into event_count
    from private.square_production_internal_audit_events where permit_id=permit_uuid;
  select fence_fingerprint into fence_hash
    from private.square_production_internal_fences where permit_id=permit_uuid;
  audit_hash:=private.square_production_internal_audit_v1(
    permit_uuid,permit_row.generation,'evidence_read','accepted','sanitized_evidence_read',
    request_hash,now_at
  );
  return pg_catalog.jsonb_build_object(
    'permitId',permit_uuid,'generation',permit_row.generation,
    'configurationFingerprint',permit_row.configuration_fingerprint,
    'permitFingerprint',permit_row.permit_fingerprint,'state',permit_row.state,
    'rowVersion',permit_row.row_version,'oauthStateCount',oauth_state_count,
    'credentialVersionCount',credential_count,'scanCount',scan_count,
    'pageReceiptCount',page_count,'observationCount',observation_count,
    'auditEventCount',event_count+1,'fenced',fence_hash is not null,
    'fenceFingerprint',fence_hash,'runtimeEnabled',false,'providerCallsEnabled',false,
    'customerOnboardingEnabled',false,'webhookIntakeEnabled',false,
    'economicContributionsEnabled',false,'aiDispatchEnabled',false,
    'auditFingerprint',audit_hash
  );
end
$function$;

revoke all on function private.square_production_internal_reject_immutable_mutation_v1() from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_guard_lifecycle_update_v1() from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_require_keys_v1(jsonb,text[]) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_fingerprint_v1(text[]) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_require_login_v1(text) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_lock_permit_v1(uuid,text,boolean) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function private.square_production_internal_install_permit_v1(jsonb) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;

revoke all on function public.square_production_internal_oauth_v1(text,jsonb) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function public.square_production_internal_broker_v1(text,jsonb) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function public.square_production_internal_runtime_v1(text,jsonb) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;
revoke all on function public.square_production_internal_evidence_v1(text,jsonb) from public,anon,authenticated,service_role,
  square_production_oauth_authority,square_production_broker_authority,square_production_scheduler_authority,
  square_production_webhook_authority,square_production_runtime_authority,square_production_evidence_authority;

-- The reviewed overlay stages one authority-check RPC per capability.  The
-- internal pilot runtime replaces that staged RPC for the four capabilities
-- it activates so every authority retains exactly one executable entry point.
-- Scheduler and webhook stay staged on their original checks and receive no
-- internal-pilot runtime RPC.
revoke execute on function public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)
  from square_production_oauth_authority;
revoke execute on function public.check_square_production_broker_authority_v1(text,text,text,bigint,text)
  from square_production_broker_authority;
revoke execute on function public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)
  from square_production_runtime_authority;
revoke execute on function public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)
  from square_production_evidence_authority;
grant execute on function public.square_production_internal_oauth_v1(text,jsonb) to square_production_oauth_authority;
grant execute on function public.square_production_internal_broker_v1(text,jsonb) to square_production_broker_authority;
grant execute on function public.square_production_internal_runtime_v1(text,jsonb) to square_production_runtime_authority;
grant execute on function public.square_production_internal_evidence_v1(text,jsonb) to square_production_evidence_authority;

do $square_production_internal_postflight$
declare relation_name text;
declare function_identity text;
declare relation_owner oid;
declare function_owner oid;
declare relation_count bigint;
begin
  foreach relation_name in array array[
    'private.square_production_internal_permits','private.square_production_internal_oauth_states',
    'private.square_production_internal_credentials','private.square_production_internal_scans',
    'private.square_production_internal_page_receipts','private.square_production_internal_source_versions',
    'private.square_production_internal_fences','private.square_production_internal_audit_events'
  ] loop
    select relowner into strict relation_owner from pg_catalog.pg_class where oid=relation_name::regclass;
    if relation_owner<>'postgres'::regrole::oid or exists(
      select 1 from pg_catalog.pg_class relation
      where relation.oid=relation_name::regclass and (
        relation.relkind<>'r' or relation.relpersistence<>'p'
        or not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relhassubclass
      )
    ) or exists(
      select 1 from pg_catalog.pg_policy policy where policy.polrelid=relation_name::regclass
    ) or exists(
      select 1 from pg_catalog.pg_inherits inheritance where inheritance.inhrelid=relation_name::regclass
        or inheritance.inhparent=relation_name::regclass
    ) or exists(
      select 1 from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) acl
      where relation.oid=relation_name::regclass and acl.grantee<>relation_owner
    ) or exists(
      select 1 from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
      where attribute.attrelid=relation_name::regclass and not attribute.attisdropped
        and acl.grantee<>relation_owner
    ) or exists(
      select 1 from pg_catalog.pg_publication publication where publication.puballtables
    ) or exists(
      select 1 from pg_catalog.pg_publication_rel publication_relation
      where publication_relation.prrelid=relation_name::regclass
    ) or exists(
      select 1 from pg_catalog.pg_publication_namespace publication_namespace
      where publication_namespace.pnnspid='private'::regnamespace
    ) then
      raise exception 'square_production_internal_relation_not_closed' using errcode='42501';
    end if;
    execute pg_catalog.format('select count(*) from %s',relation_name) into relation_count;
    if relation_count<>0 then
      raise exception 'square_production_internal_relation_seeded' using errcode='55000';
    end if;
  end loop;

  foreach function_identity in array array[
    'private.square_production_internal_reject_immutable_mutation_v1()',
    'private.square_production_internal_guard_lifecycle_update_v1()',
    'private.square_production_internal_require_keys_v1(jsonb,text[])',
    'private.square_production_internal_fingerprint_v1(text[])',
    'private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz)',
    'private.square_production_internal_require_login_v1(text)',
    'private.square_production_internal_lock_permit_v1(uuid,text,boolean)',
    'private.square_production_internal_install_permit_v1(jsonb)',
    'public.square_production_internal_oauth_v1(text,jsonb)',
    'public.square_production_internal_broker_v1(text,jsonb)',
    'public.square_production_internal_runtime_v1(text,jsonb)',
    'public.square_production_internal_evidence_v1(text,jsonb)'
  ] loop
    select proowner into strict function_owner from pg_catalog.pg_proc
      where oid=function_identity::regprocedure;
    if function_owner<>'postgres'::regrole::oid then
      raise exception 'square_production_internal_function_owner_invalid' using errcode='42501';
    end if;
  end loop;

  if exists(
    select 1 from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
    cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
    where function_record.oid=any(array[
      'private.square_production_internal_reject_immutable_mutation_v1()'::regprocedure,
      'private.square_production_internal_guard_lifecycle_update_v1()'::regprocedure,
      'private.square_production_internal_require_keys_v1(jsonb,text[])'::regprocedure,
      'private.square_production_internal_fingerprint_v1(text[])'::regprocedure,
      'private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz)'::regprocedure,
      'private.square_production_internal_require_login_v1(text)'::regprocedure,
      'private.square_production_internal_lock_permit_v1(uuid,text,boolean)'::regprocedure,
      'private.square_production_internal_install_permit_v1(jsonb)'::regprocedure
    ]) and acl.grantee<>function_record.proowner
  ) then
    raise exception 'square_production_internal_private_function_acl_open' using errcode='42501';
  end if;

  if exists(
    with expected(function_oid,grantee_oid) as (values
      ('public.square_production_internal_oauth_v1(text,jsonb)'::regprocedure,'square_production_oauth_authority'::regrole::oid),
      ('public.square_production_internal_broker_v1(text,jsonb)'::regprocedure,'square_production_broker_authority'::regrole::oid),
      ('public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)'::regprocedure,'square_production_scheduler_authority'::regrole::oid),
      ('public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)'::regprocedure,'square_production_webhook_authority'::regrole::oid),
      ('public.square_production_internal_runtime_v1(text,jsonb)'::regprocedure,'square_production_runtime_authority'::regrole::oid),
      ('public.square_production_internal_evidence_v1(text,jsonb)'::regprocedure,'square_production_evidence_authority'::regrole::oid),
      ('public.check_square_production_oauth_authority_v1(text,text,text,bigint,text)'::regprocedure,null::oid),
      ('public.check_square_production_broker_authority_v1(text,text,text,bigint,text)'::regprocedure,null::oid),
      ('public.check_square_production_runtime_authority_v1(text,text,text,bigint,text)'::regprocedure,null::oid),
      ('public.check_square_production_evidence_authority_v1(text,text,text,bigint,text)'::regprocedure,null::oid)
    )
    select 1 from expected
    where (expected.grantee_oid is null and exists(
      select 1 from pg_catalog.pg_proc function_record
      cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
      where function_record.oid=expected.function_oid and acl.grantee<>function_record.proowner
    )) or (expected.grantee_oid is not null and (
      1<>(
        select count(*) from pg_catalog.pg_proc function_record
        cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
        where function_record.oid=expected.function_oid and acl.grantee=expected.grantee_oid
          and acl.privilege_type='EXECUTE' and not acl.is_grantable
      ) or exists(
        select 1 from pg_catalog.pg_proc function_record
        cross join lateral pg_catalog.aclexplode(function_record.proacl) acl
        where function_record.oid=expected.function_oid
          and acl.grantee not in (function_record.proowner,expected.grantee_oid)
      )
    ))
  ) then
    raise exception 'square_production_internal_rpc_acl_not_exact' using errcode='42501';
  end if;
  if exists(
    select 1 from pg_catalog.pg_proc function_record
    where function_record.oid=any(array[
      'public.square_production_internal_oauth_v1(text,jsonb)'::regprocedure,
      'public.square_production_internal_broker_v1(text,jsonb)'::regprocedure,
      'public.square_production_internal_runtime_v1(text,jsonb)'::regprocedure,
      'public.square_production_internal_evidence_v1(text,jsonb)'::regprocedure
    ]) and (not function_record.prosecdef or function_record.provolatile<>'v'
      or function_record.proconfig is distinct from array['search_path=""']::text[])
  ) then
    raise exception 'square_production_internal_rpc_definition_invalid' using errcode='42501';
  end if;
  if 11<>(
    select count(*) from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation on relation.oid=trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='private' and relation.relname like 'square_production_internal_%'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'square_production_internal_trigger_manifest_invalid' using errcode='55000';
  end if;
end
$square_production_internal_postflight$;

commit;
