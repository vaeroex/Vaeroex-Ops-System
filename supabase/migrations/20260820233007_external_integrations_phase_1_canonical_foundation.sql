-- External Integrations Phase 1: Business Entity and Canonical Source/Fact Foundation
--
-- This migration is additive and provider-neutral. It introduces no provider
-- connection, OAuth, credential, synchronization, reconciliation, queue, or UI
-- behavior. Authoritative source and fact rows are private and writable only
-- through the checked operations defined below.

begin;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated, service_role;

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'external_integrations_authority'
  ) then
    create role external_integrations_authority nologin noinherit;
  end if;
end;
$role$;

revoke external_integrations_authority from service_role;
revoke all on schema private from external_integrations_authority;

create or replace function private.is_bounded_identifier_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select char_length(p_value) between 1 and 128
    and p_value ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$';
$function$;

create or replace function private.is_bounded_label_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select char_length(p_value) between 1 and 200
    and p_value = pg_catalog.btrim(p_value);
$function$;

create or replace function private.is_bounded_text_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select char_length(p_value) <= 4000;
$function$;

create or replace function private.is_currency_code_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_value ~ '^[A-Z]{3}$';
$function$;

create or replace function private.is_time_zone_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select char_length(p_value) between 1 and 64
    and p_value ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9_+-]+)*$';
$function$;

create or replace function private.is_sha256_fingerprint_v1(p_value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select p_value ~ '^sha256:[a-f0-9]{64}$';
$function$;

create or replace function private.sha256_fingerprint_bytes_v1(p_value text)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $function$
begin
  if not private.is_sha256_fingerprint_v1(p_value) then
    raise exception using errcode = '22023', message = 'invalid_sha256_fingerprint';
  end if;

  return pg_catalog.decode(pg_catalog.substr(p_value, 8), 'hex');
end;
$function$;

create or replace function private.is_canonical_numeric_v1(
  p_value text,
  p_precision integer,
  p_scale integer,
  p_allow_negative boolean,
  p_positive_only boolean,
  p_integer_only boolean
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_unsigned text;
  v_integer text;
  v_fraction text;
begin
  if p_precision <= 0 or p_scale < 0 or p_scale >= p_precision then
    return false;
  end if;

  if p_integer_only then
    if p_value !~ '^-?(?:0|[1-9][0-9]*)$' then
      return false;
    end if;
  elsif p_value !~ '^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$' then
    return false;
  end if;

  if p_value = '-0' or (not p_allow_negative and p_value like '-%') then
    return false;
  end if;

  if p_positive_only and (p_value = '0' or p_value like '-%') then
    return false;
  end if;

  v_unsigned := case when p_value like '-%' then pg_catalog.substr(p_value, 2) else p_value end;
  v_integer := pg_catalog.split_part(v_unsigned, '.', 1);
  v_fraction := case when pg_catalog.strpos(v_unsigned, '.') > 0 then pg_catalog.split_part(v_unsigned, '.', 2) else '' end;

  return char_length(v_integer) <= p_precision - p_scale
    and char_length(v_fraction) <= p_scale;
end;
$function$;

create or replace function private.canonical_numeric_matches_projection_v1(
  p_value text,
  p_projection numeric,
  p_precision integer,
  p_scale integer,
  p_allow_negative boolean,
  p_positive_only boolean,
  p_integer_only boolean
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_value is null or p_projection is null then
    return p_value is null and p_projection is null;
  end if;

  if not private.is_canonical_numeric_v1(
    p_value,
    p_precision,
    p_scale,
    p_allow_negative,
    p_positive_only,
    p_integer_only
  ) then
    return false;
  end if;

  return p_projection = p_value::numeric;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$function$;

create or replace function private.jsonb_has_exact_keys_v1(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and p_value ?& p_keys
    and not exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_value) as actual(key)
      where not (actual.key = any(p_keys))
    );
$function$;

create or replace function private.is_bounded_identifier_array_v1(
  p_values text[],
  p_maximum integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.cardinality(p_values) <= p_maximum
    and not exists (
      select 1
      from pg_catalog.unnest(p_values) as item(value)
      where item.value is null
        or not private.is_bounded_identifier_v1(item.value)
    )
    and pg_catalog.cardinality(p_values) = (
      select count(distinct item.value)::integer
      from pg_catalog.unnest(p_values) as item(value)
    );
$function$;

create or replace function private.is_fact_dimensions_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_key text;
  v_keys text[] := '{}'::text[];
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or pg_catalog.jsonb_array_length(p_value) > 32 then
    return false;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_value)
  loop
    if not private.jsonb_has_exact_keys_v1(v_item, array['key', 'value'])
      or pg_catalog.jsonb_typeof(v_item -> 'key') <> 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'value') <> 'string'
      or not private.is_bounded_identifier_v1(v_item ->> 'key')
      or not private.is_bounded_label_v1(v_item ->> 'value') then
      return false;
    end if;

    v_key := v_item ->> 'key';
    if v_key = any(v_keys) then
      return false;
    end if;
    v_keys := pg_catalog.array_append(v_keys, v_key);
  end loop;

  return true;
end;
$function$;

create or replace function private.is_source_validation_issues_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or pg_catalog.jsonb_array_length(p_value) > 100 then
    return false;
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_value)
  loop
    if not private.jsonb_has_exact_keys_v1(v_item, array['code', 'severity', 'field', 'detail'])
      or pg_catalog.jsonb_typeof(v_item -> 'code') <> 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'severity') <> 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'detail') <> 'string'
      or pg_catalog.jsonb_typeof(v_item -> 'field') not in ('string', 'null')
      or not private.is_bounded_identifier_v1(v_item ->> 'code')
      or (v_item ->> 'severity') not in ('error', 'warning')
      or (
        pg_catalog.jsonb_typeof(v_item -> 'field') = 'string'
        and not private.is_bounded_identifier_v1(v_item ->> 'field')
      )
      or not private.is_bounded_text_v1(v_item ->> 'detail') then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

create or replace function private.is_integration_audit_metadata_v1(p_value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and (p_value - array[
      'contract_version',
      'immutable_version',
      'source_kind',
      'fact_kind',
      'reconciliation_state',
      'validation_state',
      'row_version',
      'prior_version_id',
      'source_count'
    ]::text[]) = '{}'::jsonb
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

create or replace function private.assert_external_integrations_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'external_integrations_authority',
    'MEMBER'
  ) then
    raise exception using errcode = '42501', message = 'external_integrations_authority_required';
  end if;
end;
$function$;

create or replace function private.reject_external_integration_immutable_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'external_integration_immutable_row';
end;
$function$;

create table public.business_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_business_entity_id uuid,
  contract_version text not null default 'business_entity_v1'
    check (contract_version = 'business_entity_v1'),
  entity_key text not null check (private.is_bounded_identifier_v1(entity_key)),
  entity_type text not null default 'operating_company'
    check (entity_type in ('operating_company', 'holding_company', 'division', 'consolidated_group')),
  display_name text not null check (private.is_bounded_label_v1(display_name)),
  legal_name text check (legal_name is null or private.is_bounded_label_v1(legal_name)),
  base_currency character(3) not null check (private.is_currency_code_v1(base_currency)),
  reporting_currency character(3)
    check (reporting_currency is null or private.is_currency_code_v1(reporting_currency)),
  timezone text not null check (private.is_time_zone_v1(timezone)),
  fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  consolidation_policy_version text
    check (
      consolidation_policy_version is null
      or private.is_bounded_identifier_v1(consolidation_policy_version)
    ),
  row_version bigint not null default 1 check (row_version > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint business_entities_workspace_id_id_key unique (workspace_id, id),
  constraint business_entities_workspace_entity_key_key unique (workspace_id, entity_key),
  constraint business_entities_parent_not_self_check check (parent_business_entity_id is distinct from id),
  constraint business_entities_parent_fkey foreign key (workspace_id, parent_business_entity_id)
    references public.business_entities(workspace_id, id) on delete restrict
);

create index business_entities_workspace_status_idx
  on public.business_entities(workspace_id, status);
create index business_entities_workspace_parent_idx
  on public.business_entities(workspace_id, parent_business_entity_id);
create index business_entities_created_by_idx
  on public.business_entities(created_by);
create index business_entities_updated_by_idx
  on public.business_entities(updated_by);

alter table public.business_entities enable row level security;
alter table public.business_entities force row level security;

create policy "workspace members read business entities"
  on public.business_entities for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on table public.business_entities from public, anon, authenticated, service_role;
grant select on table public.business_entities to authenticated;

create or replace function private.protect_business_entity_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.contract_version is distinct from old.contract_version
    or new.entity_key is distinct from old.entity_key
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'business_entity_identity_is_immutable';
  end if;

  return new;
end;
$function$;

create trigger protect_business_entity_identity_v1
before update on public.business_entities
for each row execute function private.protect_business_entity_identity_v1();

create table private.external_source_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  mapping_id uuid,
  connection_id uuid,
  source_kind text not null check (source_kind in ('provider', 'upload', 'manual')),
  provider_key text check (
    provider_key is null
    or (char_length(provider_key) between 1 and 64 and provider_key ~ '^[a-z][a-z0-9_-]*$')
  ),
  provider_record_type text check (
    provider_record_type is null
    or private.is_bounded_identifier_v1(provider_record_type)
  ),
  provider_record_id text check (
    provider_record_id is null
    or private.is_bounded_identifier_v1(provider_record_id)
  ),
  artifact_fingerprint bytea check (
    artifact_fingerprint is null or octet_length(artifact_fingerprint) = 32
  ),
  row_reference text check (row_reference is null or private.is_bounded_identifier_v1(row_reference)),
  manual_actor_id uuid references public.profiles(id) on delete restrict,
  entry_reference text check (entry_reference is null or private.is_bounded_identifier_v1(entry_reference)),
  source_identity_fingerprint bytea not null check (octet_length(source_identity_fingerprint) = 32),
  current_version_id uuid,
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'voided', 'deleted', 'unavailable')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint external_source_records_workspace_id_id_key unique (workspace_id, id),
  constraint external_source_records_workspace_entity_id_key unique (workspace_id, business_entity_id, id),
  constraint external_source_records_identity_key unique (
    workspace_id,
    business_entity_id,
    source_identity_fingerprint
  ),
  constraint external_source_records_entity_fkey foreign key (workspace_id, business_entity_id)
    references public.business_entities(workspace_id, id) on delete cascade,
  constraint external_source_records_seen_order_check check (last_seen_at >= first_seen_at),
  constraint external_source_records_variant_check check (
    (
      source_kind = 'provider'
      and connection_id is not null
      and provider_key is not null
      and provider_record_type is not null
      and provider_record_id is not null
      and artifact_fingerprint is null
      and row_reference is null
      and manual_actor_id is null
      and entry_reference is null
    )
    or (
      source_kind = 'upload'
      and mapping_id is null
      and connection_id is null
      and provider_key is null
      and provider_record_type is null
      and provider_record_id is null
      and artifact_fingerprint is not null
      and row_reference is not null
      and manual_actor_id is null
      and entry_reference is null
    )
    or (
      source_kind = 'manual'
      and mapping_id is null
      and connection_id is null
      and provider_key is null
      and provider_record_type is null
      and provider_record_id is null
      and artifact_fingerprint is null
      and row_reference is null
      and manual_actor_id is not null
      and entry_reference is not null
    )
  )
);

create index external_source_records_workspace_entity_kind_idx
  on private.external_source_records(workspace_id, business_entity_id, source_kind);
create index external_source_records_mapping_record_idx
  on private.external_source_records(mapping_id, provider_record_id)
  where mapping_id is not null;
create index external_source_records_lifecycle_seen_idx
  on private.external_source_records(lifecycle_state, last_seen_at);
create index external_source_records_manual_actor_idx
  on private.external_source_records(manual_actor_id)
  where manual_actor_id is not null;

create table private.external_source_record_versions (
  id uuid primary key,
  contract_version text not null check (contract_version = 'external_source_record_version_v1'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  connection_id uuid,
  source_record_id uuid not null,
  sync_run_id uuid,
  immutable_version bigint not null check (immutable_version > 0),
  prior_version_id uuid,
  record_kind text not null check (private.is_bounded_identifier_v1(record_kind)),
  source_kind text not null check (source_kind in ('provider', 'upload', 'manual')),
  provider_key text check (
    provider_key is null
    or (char_length(provider_key) between 1 and 64 and provider_key ~ '^[a-z][a-z0-9_-]*$')
  ),
  provider_record_type text check (
    provider_record_type is null
    or private.is_bounded_identifier_v1(provider_record_type)
  ),
  provider_record_id text check (
    provider_record_id is null
    or private.is_bounded_identifier_v1(provider_record_id)
  ),
  provider_version_reference text check (
    provider_version_reference is null
    or private.is_bounded_identifier_v1(provider_version_reference)
  ),
  artifact_fingerprint bytea check (
    artifact_fingerprint is null or octet_length(artifact_fingerprint) = 32
  ),
  row_reference text check (row_reference is null or private.is_bounded_identifier_v1(row_reference)),
  manual_actor_id uuid references public.profiles(id) on delete restrict,
  entry_reference text check (entry_reference is null or private.is_bounded_identifier_v1(entry_reference)),
  temporal_basis text not null check (temporal_basis in ('event', 'point_in_time', 'period')),
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  observed_at timestamptz not null,
  synchronized_at timestamptz not null,
  ingested_at timestamptz not null,
  effective_at timestamptz,
  posting_date date,
  period_start date,
  period_end date,
  source_timezone text check (source_timezone is null or private.is_time_zone_v1(source_timezone)),
  accounting_basis text not null check (accounting_basis in ('accrual', 'cash', 'not_applicable', 'unknown')),
  accounting_currency character(3)
    check (accounting_currency is null or private.is_currency_code_v1(accounting_currency)),
  normalized_schema_version text not null
    check (private.is_bounded_identifier_v1(normalized_schema_version)),
  change_kind text not null
    check (change_kind in ('created', 'updated', 'corrected', 'voided', 'deleted', 'unchanged')),
  normalized_projection jsonb,
  trust text not null check (trust = 'untrusted_external_input'),
  validation_state text not null check (validation_state in ('pending', 'valid', 'invalid', 'quarantined')),
  validator_version text not null check (private.is_bounded_identifier_v1(validator_version)),
  validation_issues jsonb not null default '[]'::jsonb
    check (private.is_source_validation_issues_v1(validation_issues)),
  received_at timestamptz not null,
  source_fingerprint bytea not null check (octet_length(source_fingerprint) = 32),
  created_at timestamptz not null default transaction_timestamp(),
  constraint external_source_record_versions_record_version_key unique (source_record_id, immutable_version),
  constraint external_source_record_versions_record_fingerprint_key unique (source_record_id, source_fingerprint),
  constraint external_source_record_versions_record_id_key unique (source_record_id, id),
  constraint external_source_record_versions_tenant_record_id_key unique (
    workspace_id,
    business_entity_id,
    source_record_id,
    id
  ),
  constraint external_source_record_versions_tenant_id_fingerprint_key unique (
    workspace_id,
    business_entity_id,
    id,
    source_fingerprint
  ),
  constraint external_source_record_versions_record_fkey foreign key (
    workspace_id,
    business_entity_id,
    source_record_id
  ) references private.external_source_records(workspace_id, business_entity_id, id) on delete cascade,
  constraint external_source_record_versions_prior_fkey foreign key (source_record_id, prior_version_id)
    references private.external_source_record_versions(source_record_id, id) on delete restrict,
  constraint external_source_record_versions_period_check check (
    (
      temporal_basis = 'period'
      and period_start is not null
      and period_end is not null
      and period_end >= period_start
    )
    or (
      temporal_basis <> 'period'
      and period_start is null
      and period_end is null
    )
  ),
  constraint external_source_record_versions_projection_check check (
    (change_kind = 'deleted' and normalized_projection is null)
    or (
      change_kind <> 'deleted'
      and normalized_projection is not null
      and jsonb_typeof(normalized_projection) = 'object'
      and octet_length(normalized_projection::text) <= 1048576
    )
  ),
  constraint external_source_record_versions_variant_check check (
    (
      source_kind = 'provider'
      and connection_id is not null
      and provider_key is not null
      and provider_record_type is not null
      and provider_record_id is not null
      and artifact_fingerprint is null
      and row_reference is null
      and manual_actor_id is null
      and entry_reference is null
    )
    or (
      source_kind = 'upload'
      and connection_id is null
      and provider_key is null
      and provider_record_type is null
      and provider_record_id is null
      and provider_version_reference is null
      and artifact_fingerprint is not null
      and row_reference is not null
      and manual_actor_id is null
      and entry_reference is null
    )
    or (
      source_kind = 'manual'
      and connection_id is null
      and provider_key is null
      and provider_record_type is null
      and provider_record_id is null
      and provider_version_reference is null
      and artifact_fingerprint is null
      and row_reference is null
      and manual_actor_id is not null
      and entry_reference is not null
    )
  )
);

create index external_source_record_versions_workspace_entity_effective_idx
  on private.external_source_record_versions(workspace_id, business_entity_id, effective_at);
create index external_source_record_versions_record_version_idx
  on private.external_source_record_versions(source_record_id, immutable_version desc);
create index external_source_record_versions_validation_ingested_idx
  on private.external_source_record_versions(validation_state, ingested_at);
create index external_source_record_versions_sync_run_idx
  on private.external_source_record_versions(sync_run_id)
  where sync_run_id is not null;
create index external_source_record_versions_prior_idx
  on private.external_source_record_versions(source_record_id, prior_version_id)
  where prior_version_id is not null;
create index external_source_record_versions_manual_actor_idx
  on private.external_source_record_versions(manual_actor_id)
  where manual_actor_id is not null;

alter table private.external_source_records
  add constraint external_source_records_current_version_fkey foreign key (
    workspace_id,
    business_entity_id,
    id,
    current_version_id
  ) references private.external_source_record_versions(
    workspace_id,
    business_entity_id,
    source_record_id,
    id
  ) on delete restrict deferrable initially deferred;

create index external_source_records_current_version_idx
  on private.external_source_records(
    workspace_id,
    business_entity_id,
    id,
    current_version_id
  )
  where current_version_id is not null;

create table private.canonical_business_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  fact_kind text not null check (private.is_bounded_identifier_v1(fact_kind)),
  fact_key text not null check (private.is_bounded_identifier_v1(fact_key)),
  identity_fingerprint bytea not null check (octet_length(identity_fingerprint) = 32),
  current_version_id uuid,
  version_counter bigint not null default 0 check (version_counter >= 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint canonical_business_facts_workspace_id_id_key unique (workspace_id, id),
  constraint canonical_business_facts_workspace_entity_id_key unique (
    workspace_id,
    business_entity_id,
    id
  ),
  constraint canonical_business_facts_identity_key unique (
    workspace_id,
    business_entity_id,
    fact_kind,
    fact_key
  ),
  constraint canonical_business_facts_fingerprint_key unique (
    workspace_id,
    business_entity_id,
    identity_fingerprint
  ),
  constraint canonical_business_facts_entity_fkey foreign key (workspace_id, business_entity_id)
    references public.business_entities(workspace_id, id) on delete cascade
);

create index canonical_business_facts_workspace_entity_kind_idx
  on private.canonical_business_facts(workspace_id, business_entity_id, fact_kind);
create index canonical_business_facts_workspace_entity_key_idx
  on private.canonical_business_facts(workspace_id, business_entity_id, fact_key);

create table private.canonical_business_fact_versions (
  id uuid primary key,
  contract_version text not null check (contract_version = 'canonical_business_fact_version_v2'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  fact_id uuid not null,
  immutable_version bigint not null check (immutable_version > 0),
  prior_version_id uuid,
  dimensions jsonb not null default '[]'::jsonb
    check (private.is_fact_dimensions_v1(dimensions)),
  effective_at timestamptz,
  posting_date date,
  period_start date,
  period_end date,
  fiscal_year integer check (fiscal_year is null or fiscal_year between 1900 and 9999),
  fiscal_period smallint check (fiscal_period is null or fiscal_period between 1 and 53),
  source_timezone text check (source_timezone is null or private.is_time_zone_v1(source_timezone)),
  closed_period boolean not null,
  accounting_basis text not null check (accounting_basis in ('accrual', 'cash', 'not_applicable', 'unknown')),
  source_currency character(3)
    check (source_currency is null or private.is_currency_code_v1(source_currency)),
  reporting_currency character(3)
    check (reporting_currency is null or private.is_currency_code_v1(reporting_currency)),
  exchange_rate_canonical text,
  exchange_rate numeric(30,12),
  exchange_rate_source text check (
    exchange_rate_source is null or private.is_bounded_identifier_v1(exchange_rate_source)
  ),
  value_kind text check (
    value_kind is null
    or value_kind in ('money', 'decimal', 'percentage', 'integer', 'boolean', 'date', 'text', 'structured')
  ),
  numeric_value_canonical text,
  numeric_value numeric(30,9),
  text_value text check (text_value is null or private.is_bounded_label_v1(text_value)),
  date_value date,
  boolean_value boolean,
  structured_value jsonb,
  value_currency character(3)
    check (value_currency is null or private.is_currency_code_v1(value_currency)),
  unit text check (unit is null or private.is_bounded_identifier_v1(unit)),
  reconciliation_state text not null check (
    reconciliation_state in ('accepted', 'excluded_duplicate', 'excluded_authority', 'conflicted', 'tombstone')
  ),
  validation_state text not null check (validation_state in ('valid', 'invalid')),
  decision_authority text not null check (
    decision_authority in ('deterministic_policy', 'customer_authorized_user', 'operator')
  ),
  decision_policy_version text check (
    decision_policy_version is null or private.is_bounded_identifier_v1(decision_policy_version)
  ),
  decision_actor_id uuid references public.profiles(id) on delete restrict,
  decision_decided_at timestamptz not null,
  decision_reason_codes text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(decision_reason_codes, 32)),
  normalization_version text not null check (private.is_bounded_identifier_v1(normalization_version)),
  transformation_version text not null check (private.is_bounded_identifier_v1(transformation_version)),
  source_observed_at timestamptz not null,
  created_at timestamptz not null,
  fact_fingerprint bytea not null check (octet_length(fact_fingerprint) = 32),
  constraint canonical_business_fact_versions_fact_version_key unique (fact_id, immutable_version),
  constraint canonical_business_fact_versions_fact_fingerprint_key unique (fact_id, fact_fingerprint),
  constraint canonical_business_fact_versions_fact_id_key unique (fact_id, id),
  constraint canonical_business_fact_versions_tenant_fact_id_key unique (
    workspace_id,
    business_entity_id,
    fact_id,
    id
  ),
  constraint canonical_business_fact_versions_tenant_id_key unique (
    workspace_id,
    business_entity_id,
    id
  ),
  constraint canonical_business_fact_versions_fact_fkey foreign key (
    workspace_id,
    business_entity_id,
    fact_id
  ) references private.canonical_business_facts(workspace_id, business_entity_id, id) on delete cascade,
  constraint canonical_business_fact_versions_prior_fkey foreign key (fact_id, prior_version_id)
    references private.canonical_business_fact_versions(fact_id, id) on delete restrict,
  constraint canonical_business_fact_versions_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  ),
  constraint canonical_business_fact_versions_exchange_rate_check check (
    private.canonical_numeric_matches_projection_v1(
      exchange_rate_canonical,
      exchange_rate,
      30,
      12,
      false,
      true,
      false
    )
  ),
  constraint canonical_business_fact_versions_numeric_value_check check (
    private.canonical_numeric_matches_projection_v1(
      numeric_value_canonical,
      numeric_value,
      30,
      9,
      true,
      false,
      value_kind = 'integer'
    )
  ),
  constraint canonical_business_fact_versions_value_check check (
    (
      reconciliation_state = 'tombstone'
      and value_kind is null
      and numeric_value_canonical is null
      and numeric_value is null
      and text_value is null
      and date_value is null
      and boolean_value is null
      and structured_value is null
      and value_currency is null
      and unit is null
    )
    or (
      reconciliation_state <> 'tombstone'
      and (
        (
          value_kind = 'money'
          and numeric_value_canonical is not null
          and numeric_value is not null
          and value_currency is not null
          and unit is null
          and text_value is null
          and date_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'decimal'
          and numeric_value_canonical is not null
          and numeric_value is not null
          and unit is not null
          and value_currency is null
          and text_value is null
          and date_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'percentage'
          and numeric_value_canonical is not null
          and numeric_value is not null
          and unit is null
          and value_currency is null
          and text_value is null
          and date_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'integer'
          and numeric_value_canonical is not null
          and numeric_value is not null
          and value_currency is null
          and text_value is null
          and date_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'boolean'
          and boolean_value is not null
          and numeric_value_canonical is null
          and numeric_value is null
          and value_currency is null
          and unit is null
          and text_value is null
          and date_value is null
          and structured_value is null
        )
        or (
          value_kind = 'date'
          and date_value is not null
          and numeric_value_canonical is null
          and numeric_value is null
          and value_currency is null
          and unit is null
          and text_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'text'
          and text_value is not null
          and numeric_value_canonical is null
          and numeric_value is null
          and value_currency is null
          and unit is null
          and date_value is null
          and boolean_value is null
          and structured_value is null
        )
        or (
          value_kind = 'structured'
          and structured_value is not null
          and jsonb_typeof(structured_value) = 'object'
          and octet_length(structured_value::text) <= 1048576
          and numeric_value_canonical is null
          and numeric_value is null
          and value_currency is null
          and unit is null
          and text_value is null
          and date_value is null
          and boolean_value is null
        )
      )
    )
  ),
  constraint canonical_business_fact_versions_accounting_check check (
    (
      value_kind = 'money'
      and source_currency = value_currency
      and reporting_currency is not null
      and (
        (
          reporting_currency = source_currency
          and exchange_rate_canonical is null
          and exchange_rate is null
          and exchange_rate_source is null
        )
        or (
          reporting_currency <> source_currency
          and exchange_rate_canonical is not null
          and exchange_rate is not null
          and exchange_rate_source is not null
        )
      )
    )
    or (
      value_kind is distinct from 'money'
      and source_currency is null
      and reporting_currency is null
      and exchange_rate_canonical is null
      and exchange_rate is null
      and exchange_rate_source is null
    )
  ),
  constraint canonical_business_fact_versions_decision_check check (
    (decision_authority = 'deterministic_policy' and decision_policy_version is not null)
    or (decision_authority in ('customer_authorized_user', 'operator') and decision_actor_id is not null)
  ),
  constraint canonical_business_fact_versions_accepted_valid_check check (
    reconciliation_state <> 'accepted' or validation_state = 'valid'
  )
);

create index canonical_business_fact_versions_workspace_entity_created_idx
  on private.canonical_business_fact_versions(workspace_id, business_entity_id, created_at);
create index canonical_business_fact_versions_fact_version_idx
  on private.canonical_business_fact_versions(fact_id, immutable_version desc);
create index canonical_business_fact_versions_state_effective_idx
  on private.canonical_business_fact_versions(reconciliation_state, effective_at);
create index canonical_business_fact_versions_period_idx
  on private.canonical_business_fact_versions(period_start, period_end);
create index canonical_business_fact_versions_prior_idx
  on private.canonical_business_fact_versions(fact_id, prior_version_id)
  where prior_version_id is not null;
create index canonical_business_fact_versions_decision_actor_idx
  on private.canonical_business_fact_versions(decision_actor_id)
  where decision_actor_id is not null;

create table private.business_fact_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  fact_version_id uuid not null,
  source_record_version_id uuid not null,
  source_fingerprint bytea not null check (octet_length(source_fingerprint) = 32),
  source_role text not null check (
    source_role in (
      'primary',
      'corroborating',
      'duplicate_representation',
      'correction',
      'manual_override',
      'control_observation'
    )
  ),
  contribution_weight_canonical text,
  contribution_weight numeric(30,9),
  source_field_paths text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(source_field_paths, 100)),
  transformation_version text check (
    transformation_version is null or private.is_bounded_identifier_v1(transformation_version)
  ),
  created_at timestamptz not null default transaction_timestamp(),
  constraint business_fact_sources_fact_source_key unique (
    fact_version_id,
    source_record_version_id
  ),
  constraint business_fact_sources_fact_fkey foreign key (
    workspace_id,
    business_entity_id,
    fact_version_id
  ) references private.canonical_business_fact_versions(workspace_id, business_entity_id, id) on delete cascade,
  constraint business_fact_sources_source_fkey foreign key (
    workspace_id,
    business_entity_id,
    source_record_version_id,
    source_fingerprint
  ) references private.external_source_record_versions(
    workspace_id,
    business_entity_id,
    id,
    source_fingerprint
  ) on delete restrict,
  constraint business_fact_sources_weight_check check (
    private.canonical_numeric_matches_projection_v1(
      contribution_weight_canonical,
      contribution_weight,
      30,
      9,
      false,
      false,
      false
    )
  )
);

create index business_fact_sources_workspace_fact_idx
  on private.business_fact_sources(workspace_id, fact_version_id);
create index business_fact_sources_source_version_idx
  on private.business_fact_sources(source_record_version_id);
create index business_fact_sources_source_role_idx
  on private.business_fact_sources(source_role);
create index business_fact_sources_fact_tenant_idx
  on private.business_fact_sources(workspace_id, business_entity_id, fact_version_id);
create index business_fact_sources_source_tenant_idx
  on private.business_fact_sources(
    workspace_id,
    business_entity_id,
    source_record_version_id,
    source_fingerprint
  );

alter table private.canonical_business_facts
  add constraint canonical_business_facts_current_version_fkey foreign key (
    workspace_id,
    business_entity_id,
    id,
    current_version_id
  ) references private.canonical_business_fact_versions(
    workspace_id,
    business_entity_id,
    fact_id,
    id
  ) on delete restrict deferrable initially deferred;

create index canonical_business_facts_current_version_idx
  on private.canonical_business_facts(
    workspace_id,
    business_entity_id,
    id,
    current_version_id
  )
  where current_version_id is not null;

create table private.integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  business_entity_id uuid,
  connection_id uuid,
  actor_type text not null check (actor_type in ('user', 'service', 'operator', 'provider', 'system')),
  actor_id text check (actor_id is null or char_length(actor_id) between 1 and 200),
  action text not null check (private.is_bounded_identifier_v1(action)),
  outcome text not null check (outcome in ('allowed', 'denied', 'succeeded', 'failed')),
  target_type text not null check (private.is_bounded_identifier_v1(target_type)),
  target_id text check (target_id is null or char_length(target_id) between 1 and 200),
  request_id text check (request_id is null or char_length(request_id) between 1 and 200),
  reason_code text check (reason_code is null or private.is_bounded_identifier_v1(reason_code)),
  metadata jsonb not null default '{}'::jsonb
    check (private.is_integration_audit_metadata_v1(metadata)),
  occurred_at timestamptz not null default transaction_timestamp(),
  retention_class text not null check (
    retention_class in ('operational', 'security', 'authorization', 'deletion', 'legal')
  ),
  expires_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  constraint integration_audit_events_entity_fkey foreign key (workspace_id, business_entity_id)
    references public.business_entities(workspace_id, id) on delete set null
);

create index integration_audit_events_workspace_occurred_idx
  on private.integration_audit_events(workspace_id, occurred_at desc);
create index integration_audit_events_connection_occurred_idx
  on private.integration_audit_events(connection_id, occurred_at desc)
  where connection_id is not null;
create index integration_audit_events_action_outcome_occurred_idx
  on private.integration_audit_events(action, outcome, occurred_at desc);
create index integration_audit_events_expires_idx
  on private.integration_audit_events(expires_at)
  where expires_at is not null;
create index integration_audit_events_entity_idx
  on private.integration_audit_events(workspace_id, business_entity_id)
  where business_entity_id is not null;

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'external_source_records',
    'external_source_record_versions',
    'canonical_business_facts',
    'canonical_business_fact_versions',
    'business_fact_sources',
    'integration_audit_events'
  ]
  loop
    execute pg_catalog.format('alter table private.%I enable row level security', v_table);
    execute pg_catalog.format('alter table private.%I force row level security', v_table);
    execute pg_catalog.format(
      'revoke all on table private.%I from public, anon, authenticated, service_role, external_integrations_authority',
      v_table
    );
  end loop;
end;
$rls$;

create trigger reject_external_source_record_version_mutation_v1
before update or delete on private.external_source_record_versions
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_canonical_business_fact_version_mutation_v1
before update or delete on private.canonical_business_fact_versions
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_business_fact_source_mutation_v1
before update or delete on private.business_fact_sources
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_integration_audit_event_mutation_v1
before update or delete on private.integration_audit_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.enforce_canonical_fact_provenance_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_fact_version_id uuid;
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_reconciliation_state text;
  v_source_count integer;
  v_invalid_source_count integer;
begin
  if tg_table_name = 'canonical_business_facts' then
    if new.current_version_id is null then
      return null;
    end if;
    v_fact_version_id := new.current_version_id;
    v_workspace_id := new.workspace_id;
    v_business_entity_id := new.business_entity_id;
  else
    v_fact_version_id := new.id;
    v_workspace_id := new.workspace_id;
    v_business_entity_id := new.business_entity_id;
  end if;

  select version.reconciliation_state
  into v_reconciliation_state
  from private.canonical_business_fact_versions as version
  where version.id = v_fact_version_id
    and version.workspace_id = v_workspace_id
    and version.business_entity_id = v_business_entity_id;

  select
    count(*)::integer,
    count(*) filter (where source_version.validation_state <> 'valid')::integer
  into v_source_count, v_invalid_source_count
  from private.business_fact_sources as edge
  join private.external_source_record_versions as source_version
    on source_version.id = edge.source_record_version_id
   and source_version.workspace_id = edge.workspace_id
   and source_version.business_entity_id = edge.business_entity_id
  where edge.fact_version_id = v_fact_version_id
    and edge.workspace_id = v_workspace_id
    and edge.business_entity_id = v_business_entity_id;

  if coalesce(v_source_count, 0) = 0 then
    raise exception using errcode = '23514', message = 'canonical_fact_requires_source_provenance';
  end if;

  if v_reconciliation_state = 'accepted' and coalesce(v_invalid_source_count, 0) > 0 then
    raise exception using errcode = '23514', message = 'accepted_fact_requires_valid_sources';
  end if;

  return null;
end;
$function$;

create constraint trigger canonical_fact_version_provenance_v1
after insert on private.canonical_business_fact_versions
deferrable initially deferred
for each row execute function private.enforce_canonical_fact_provenance_v1();

create constraint trigger canonical_fact_current_provenance_v1
after insert or update of current_version_id on private.canonical_business_facts
deferrable initially deferred
for each row execute function private.enforce_canonical_fact_provenance_v1();

create or replace function private.business_entity_contract_json_v1(
  p_entity public.business_entities
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contractVersion', p_entity.contract_version,
    'id', p_entity.id,
    'workspaceId', p_entity.workspace_id,
    'parentBusinessEntityId', p_entity.parent_business_entity_id,
    'entityKey', p_entity.entity_key,
    'displayName', p_entity.display_name,
    'legalName', p_entity.legal_name,
    'status', p_entity.status,
    'baseCurrency', pg_catalog.btrim(p_entity.base_currency),
    'timeZone', p_entity.timezone,
    'createdAt', pg_catalog.to_char(p_entity.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', pg_catalog.to_char(p_entity.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$function$;

create or replace function public.create_business_entity_v1(
  p_workspace_id uuid,
  p_parent_business_entity_id uuid,
  p_entity_key text,
  p_entity_type text,
  p_display_name text,
  p_legal_name text,
  p_base_currency text,
  p_reporting_currency text,
  p_time_zone text,
  p_fiscal_year_start_month smallint,
  p_consolidation_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_entity public.business_entities;
begin
  if v_actor_id is null or not public.can_edit_operations(p_workspace_id) then
    raise exception using errcode = '42501', message = 'business_entity_create_denied';
  end if;

  if p_parent_business_entity_id is not null and not exists (
    select 1
    from public.business_entities as parent
    where parent.workspace_id = p_workspace_id
      and parent.id = p_parent_business_entity_id
  ) then
    raise exception using errcode = '23503', message = 'business_entity_parent_scope_mismatch';
  end if;

  insert into public.business_entities (
    workspace_id,
    parent_business_entity_id,
    contract_version,
    entity_key,
    entity_type,
    display_name,
    legal_name,
    base_currency,
    reporting_currency,
    timezone,
    fiscal_year_start_month,
    status,
    consolidation_policy_version,
    created_by,
    updated_by
  ) values (
    p_workspace_id,
    p_parent_business_entity_id,
    'business_entity_v1',
    p_entity_key,
    p_entity_type,
    p_display_name,
    p_legal_name,
    p_base_currency,
    p_reporting_currency,
    p_time_zone,
    p_fiscal_year_start_month,
    'active',
    p_consolidation_policy_version,
    v_actor_id,
    v_actor_id
  )
  returning * into v_entity;

  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    metadata,
    retention_class
  ) values (
    v_entity.workspace_id,
    v_entity.id,
    'user',
    v_actor_id::text,
    'business_entity.create',
    'succeeded',
    'business_entity',
    v_entity.id::text,
    pg_catalog.jsonb_build_object(
      'contract_version', v_entity.contract_version,
      'row_version', v_entity.row_version
    ),
    'operational'
  );

  return private.business_entity_contract_json_v1(v_entity);
end;
$function$;

create or replace function public.update_business_entity_v1(
  p_entity_id uuid,
  p_expected_row_version bigint,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_entity public.business_entities;
begin
  if pg_catalog.jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or (p_patch - array[
      'parentBusinessEntityId',
      'entityType',
      'displayName',
      'legalName',
      'baseCurrency',
      'reportingCurrency',
      'timeZone',
      'fiscalYearStartMonth',
      'status',
      'consolidationPolicyVersion'
    ]::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'business_entity_patch_invalid';
  end if;

  if (p_patch ? 'parentBusinessEntityId'
      and pg_catalog.jsonb_typeof(p_patch -> 'parentBusinessEntityId') not in ('string', 'null'))
    or (p_patch ? 'entityType' and pg_catalog.jsonb_typeof(p_patch -> 'entityType') <> 'string')
    or (p_patch ? 'displayName' and pg_catalog.jsonb_typeof(p_patch -> 'displayName') <> 'string')
    or (p_patch ? 'legalName' and pg_catalog.jsonb_typeof(p_patch -> 'legalName') not in ('string', 'null'))
    or (p_patch ? 'baseCurrency' and pg_catalog.jsonb_typeof(p_patch -> 'baseCurrency') <> 'string')
    or (p_patch ? 'reportingCurrency'
      and pg_catalog.jsonb_typeof(p_patch -> 'reportingCurrency') not in ('string', 'null'))
    or (p_patch ? 'timeZone' and pg_catalog.jsonb_typeof(p_patch -> 'timeZone') <> 'string')
    or (p_patch ? 'fiscalYearStartMonth'
      and (
        pg_catalog.jsonb_typeof(p_patch -> 'fiscalYearStartMonth') <> 'number'
        or (p_patch ->> 'fiscalYearStartMonth') !~ '^(?:[1-9]|1[0-2])$'
      ))
    or (p_patch ? 'status' and pg_catalog.jsonb_typeof(p_patch -> 'status') <> 'string')
    or (p_patch ? 'consolidationPolicyVersion'
      and pg_catalog.jsonb_typeof(p_patch -> 'consolidationPolicyVersion') not in ('string', 'null')) then
    raise exception using errcode = '22023', message = 'business_entity_patch_type_invalid';
  end if;

  select entity.*
  into v_entity
  from public.business_entities as entity
  where entity.id = p_entity_id
  for update;

  if not found
    or v_actor_id is null
    or not public.can_edit_operations(v_entity.workspace_id) then
    raise exception using errcode = '42501', message = 'business_entity_update_denied';
  end if;

  if v_entity.row_version <> p_expected_row_version then
    raise exception using errcode = '40001', message = 'business_entity_row_version_stale';
  end if;

  if p_patch ? 'parentBusinessEntityId'
    and p_patch -> 'parentBusinessEntityId' <> 'null'::jsonb
    and not exists (
      select 1
      from public.business_entities as parent
      where parent.workspace_id = v_entity.workspace_id
        and parent.id = (p_patch ->> 'parentBusinessEntityId')::uuid
    ) then
    raise exception using errcode = '23503', message = 'business_entity_parent_scope_mismatch';
  end if;

  update public.business_entities as entity
  set
    parent_business_entity_id = case
      when p_patch ? 'parentBusinessEntityId' then (p_patch ->> 'parentBusinessEntityId')::uuid
      else entity.parent_business_entity_id
    end,
    entity_type = case when p_patch ? 'entityType' then p_patch ->> 'entityType' else entity.entity_type end,
    display_name = case when p_patch ? 'displayName' then p_patch ->> 'displayName' else entity.display_name end,
    legal_name = case when p_patch ? 'legalName' then p_patch ->> 'legalName' else entity.legal_name end,
    base_currency = case when p_patch ? 'baseCurrency' then p_patch ->> 'baseCurrency' else entity.base_currency end,
    reporting_currency = case
      when p_patch ? 'reportingCurrency' then p_patch ->> 'reportingCurrency'
      else entity.reporting_currency
    end,
    timezone = case when p_patch ? 'timeZone' then p_patch ->> 'timeZone' else entity.timezone end,
    fiscal_year_start_month = case
      when p_patch ? 'fiscalYearStartMonth' then (p_patch ->> 'fiscalYearStartMonth')::smallint
      else entity.fiscal_year_start_month
    end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else entity.status end,
    consolidation_policy_version = case
      when p_patch ? 'consolidationPolicyVersion' then p_patch ->> 'consolidationPolicyVersion'
      else entity.consolidation_policy_version
    end,
    row_version = entity.row_version + 1,
    updated_by = v_actor_id,
    updated_at = transaction_timestamp()
  where entity.id = p_entity_id
  returning entity.* into v_entity;

  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    metadata,
    retention_class
  ) values (
    v_entity.workspace_id,
    v_entity.id,
    'user',
    v_actor_id::text,
    'business_entity.update',
    'succeeded',
    'business_entity',
    v_entity.id::text,
    pg_catalog.jsonb_build_object(
      'contract_version', v_entity.contract_version,
      'row_version', v_entity.row_version
    ),
    'operational'
  );

  return private.business_entity_contract_json_v1(v_entity);
end;
$function$;

create or replace function private.validate_source_version_payload_v1(p_version jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_source_kind text;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_version,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'connectionId',
      'immutableVersion',
      'priorVersionId',
      'recordKind',
      'source',
      'temporal',
      'accounting',
      'normalizedSchemaVersion',
      'changeKind',
      'normalizedProjection',
      'trust',
      'validation',
      'receivedAt',
      'sourceFingerprint'
    ]
  )
    or p_version ->> 'contractVersion' <> 'external_source_record_version_v1'
    or pg_catalog.jsonb_typeof(p_version -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'connectionId') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_version -> 'immutableVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_version -> 'priorVersionId') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_version -> 'recordKind') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'normalizedSchemaVersion') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'changeKind') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'trust') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'receivedAt') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'sourceFingerprint') <> 'string'
    or not private.jsonb_has_exact_keys_v1(
      p_version -> 'temporal',
      array[
        'basis',
        'providerCreatedAt',
        'providerUpdatedAt',
        'observedAt',
        'synchronizedAt',
        'ingestedAt',
        'effectiveAt',
        'postingDate',
        'periodStart',
        'periodEnd',
        'sourceTimeZone'
      ]
    )
    or not private.jsonb_has_exact_keys_v1(p_version -> 'accounting', array['basis', 'currency'])
    or not private.jsonb_has_exact_keys_v1(
      p_version -> 'validation',
      array['state', 'validatorVersion', 'issues']
    ) then
    raise exception using errcode = '22023', message = 'source_version_payload_invalid';
  end if;

  v_source_kind := p_version #>> '{source,kind}';
  if (
    v_source_kind = 'provider'
    and not private.jsonb_has_exact_keys_v1(
      p_version -> 'source',
      array['kind', 'providerKey', 'providerRecordType', 'providerRecordId', 'providerVersionReference']
    )
  ) or (
    v_source_kind = 'upload'
    and not private.jsonb_has_exact_keys_v1(
      p_version -> 'source',
      array['kind', 'artifactFingerprint', 'rowReference']
    )
  ) or (
    v_source_kind = 'manual'
    and not private.jsonb_has_exact_keys_v1(
      p_version -> 'source',
      array['kind', 'actorId', 'entryReference']
    )
  ) or v_source_kind not in ('provider', 'upload', 'manual') then
    raise exception using errcode = '22023', message = 'source_descriptor_invalid';
  end if;
end;
$function$;

create or replace function public.commit_external_source_record_version_v1(
  p_source_identity_fingerprint text,
  p_version jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_version_id uuid;
  v_connection_id uuid;
  v_prior_version_id uuid;
  v_source_kind text;
  v_identity_fingerprint bytea;
  v_source_fingerprint bytea;
  v_artifact_fingerprint bytea;
  v_manual_actor_id uuid;
  v_source_record private.external_source_records;
  v_current_version private.external_source_record_versions;
  v_existing_version private.external_source_record_versions;
  v_expected_version bigint;
  v_idempotent boolean := false;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_source_version_payload_v1(p_version);

  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception using errcode = '22023', message = 'source_request_id_invalid';
  end if;
  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'source_actor_id_invalid';
  end if;

  v_workspace_id := (p_version ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_version ->> 'businessEntityId')::uuid;
  v_version_id := (p_version ->> 'id')::uuid;
  v_connection_id := (p_version ->> 'connectionId')::uuid;
  v_prior_version_id := (p_version ->> 'priorVersionId')::uuid;
  v_source_kind := p_version #>> '{source,kind}';
  v_identity_fingerprint := private.sha256_fingerprint_bytes_v1(p_source_identity_fingerprint);
  v_source_fingerprint := private.sha256_fingerprint_bytes_v1(p_version ->> 'sourceFingerprint');

  if v_source_kind = 'provider' then
    raise exception using
      errcode = '0A000',
      message = 'phase_1_provider_source_authority_deferred';
  end if;

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = v_workspace_id
      and entity.id = v_business_entity_id
  ) then
    raise exception using errcode = '23503', message = 'source_business_entity_scope_mismatch';
  end if;

  if v_source_kind = 'upload' then
    v_artifact_fingerprint := private.sha256_fingerprint_bytes_v1(
      p_version #>> '{source,artifactFingerprint}'
    );
  else
    v_manual_actor_id := (p_version #>> '{source,actorId}')::uuid;
    if not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = v_workspace_id
        and membership.user_id = v_manual_actor_id
        and membership.status = 'active'
    ) then
      raise exception using errcode = '42501', message = 'manual_source_actor_scope_mismatch';
    end if;
  end if;

  insert into private.external_source_records (
    workspace_id,
    business_entity_id,
    source_kind,
    artifact_fingerprint,
    row_reference,
    manual_actor_id,
    entry_reference,
    source_identity_fingerprint,
    first_seen_at,
    last_seen_at
  ) values (
    v_workspace_id,
    v_business_entity_id,
    v_source_kind,
    v_artifact_fingerprint,
    case when v_source_kind = 'upload' then p_version #>> '{source,rowReference}' end,
    v_manual_actor_id,
    case when v_source_kind = 'manual' then p_version #>> '{source,entryReference}' end,
    v_identity_fingerprint,
    (p_version #>> '{temporal,observedAt}')::timestamptz,
    (p_version #>> '{temporal,observedAt}')::timestamptz
  )
  on conflict (workspace_id, business_entity_id, source_identity_fingerprint) do nothing;

  select source_record.*
  into v_source_record
  from private.external_source_records as source_record
  where source_record.workspace_id = v_workspace_id
    and source_record.business_entity_id = v_business_entity_id
    and source_record.source_identity_fingerprint = v_identity_fingerprint
  for update;

  if not found
    or v_source_record.source_kind <> v_source_kind
    or v_source_record.connection_id is distinct from v_connection_id
    or v_source_record.artifact_fingerprint is distinct from v_artifact_fingerprint
    or v_source_record.row_reference is distinct from (case
      when v_source_kind = 'upload' then p_version #>> '{source,rowReference}'
    end)
    or v_source_record.manual_actor_id is distinct from v_manual_actor_id
    or v_source_record.entry_reference is distinct from (case
      when v_source_kind = 'manual' then p_version #>> '{source,entryReference}'
    end) then
    raise exception using errcode = '23505', message = 'source_identity_fingerprint_collision';
  end if;

  select version.*
  into v_existing_version
  from private.external_source_record_versions as version
  where version.source_record_id = v_source_record.id
    and version.source_fingerprint = v_source_fingerprint;

  if found then
    if v_existing_version.id <> v_version_id then
      raise exception using errcode = '23505', message = 'source_fingerprint_version_id_conflict';
    end if;
    v_idempotent := true;
    return pg_catalog.jsonb_build_object(
      'sourceRecordId', v_source_record.id,
      'sourceVersionId', v_existing_version.id,
      'immutableVersion', v_existing_version.immutable_version,
      'sourceIdentityFingerprint', p_source_identity_fingerprint,
      'sourceFingerprint', p_version ->> 'sourceFingerprint',
      'currentVersionId', v_source_record.current_version_id,
      'idempotent', v_idempotent
    );
  end if;

  if v_source_record.current_version_id is null then
    v_expected_version := 1;
    if v_prior_version_id is not null then
      raise exception using errcode = '23514', message = 'first_source_version_cannot_have_prior';
    end if;
  else
    select version.*
    into strict v_current_version
    from private.external_source_record_versions as version
    where version.id = v_source_record.current_version_id
      and version.source_record_id = v_source_record.id;
    v_expected_version := v_current_version.immutable_version + 1;
    if v_prior_version_id is distinct from v_current_version.id then
      raise exception using errcode = '40001', message = 'source_prior_version_stale';
    end if;
  end if;

  if (p_version ->> 'immutableVersion')::bigint <> v_expected_version then
    raise exception using errcode = '40001', message = 'source_immutable_version_stale';
  end if;

  insert into private.external_source_record_versions (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    connection_id,
    source_record_id,
    immutable_version,
    prior_version_id,
    record_kind,
    source_kind,
    artifact_fingerprint,
    row_reference,
    manual_actor_id,
    entry_reference,
    temporal_basis,
    provider_created_at,
    provider_updated_at,
    observed_at,
    synchronized_at,
    ingested_at,
    effective_at,
    posting_date,
    period_start,
    period_end,
    source_timezone,
    accounting_basis,
    accounting_currency,
    normalized_schema_version,
    change_kind,
    normalized_projection,
    trust,
    validation_state,
    validator_version,
    validation_issues,
    received_at,
    source_fingerprint
  ) values (
    v_version_id,
    p_version ->> 'contractVersion',
    v_workspace_id,
    v_business_entity_id,
    v_connection_id,
    v_source_record.id,
    (p_version ->> 'immutableVersion')::bigint,
    v_prior_version_id,
    p_version ->> 'recordKind',
    v_source_kind,
    v_artifact_fingerprint,
    case when v_source_kind = 'upload' then p_version #>> '{source,rowReference}' end,
    v_manual_actor_id,
    case when v_source_kind = 'manual' then p_version #>> '{source,entryReference}' end,
    p_version #>> '{temporal,basis}',
    (p_version #>> '{temporal,providerCreatedAt}')::timestamptz,
    (p_version #>> '{temporal,providerUpdatedAt}')::timestamptz,
    (p_version #>> '{temporal,observedAt}')::timestamptz,
    (p_version #>> '{temporal,synchronizedAt}')::timestamptz,
    (p_version #>> '{temporal,ingestedAt}')::timestamptz,
    (p_version #>> '{temporal,effectiveAt}')::timestamptz,
    (p_version #>> '{temporal,postingDate}')::date,
    (p_version #>> '{temporal,periodStart}')::date,
    (p_version #>> '{temporal,periodEnd}')::date,
    p_version #>> '{temporal,sourceTimeZone}',
    p_version #>> '{accounting,basis}',
    p_version #>> '{accounting,currency}',
    p_version ->> 'normalizedSchemaVersion',
    p_version ->> 'changeKind',
    case
      when pg_catalog.jsonb_typeof(p_version -> 'normalizedProjection') = 'null' then null
      else p_version -> 'normalizedProjection'
    end,
    p_version ->> 'trust',
    p_version #>> '{validation,state}',
    p_version #>> '{validation,validatorVersion}',
    p_version #> '{validation,issues}',
    (p_version ->> 'receivedAt')::timestamptz,
    v_source_fingerprint
  );

  update private.external_source_records as source_record
  set
    current_version_id = v_version_id,
    lifecycle_state = case p_version ->> 'changeKind'
      when 'deleted' then 'deleted'
      when 'voided' then 'voided'
      else 'active'
    end,
    last_seen_at = (p_version #>> '{temporal,observedAt}')::timestamptz,
    updated_at = transaction_timestamp()
  where source_record.id = v_source_record.id
  returning source_record.* into v_source_record;

  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    request_id,
    metadata,
    retention_class
  ) values (
    v_workspace_id,
    v_business_entity_id,
    'service',
    p_actor_id,
    'external_source_record_version.commit',
    'succeeded',
    'external_source_record_version',
    v_version_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'contract_version', p_version ->> 'contractVersion',
      'immutable_version', (p_version ->> 'immutableVersion')::bigint,
      'source_kind', v_source_kind,
      'validation_state', p_version #>> '{validation,state}',
      'prior_version_id', v_prior_version_id
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'sourceRecordId', v_source_record.id,
    'sourceVersionId', v_version_id,
    'immutableVersion', v_expected_version,
    'sourceIdentityFingerprint', p_source_identity_fingerprint,
    'sourceFingerprint', p_version ->> 'sourceFingerprint',
    'currentVersionId', v_source_record.current_version_id,
    'idempotent', v_idempotent
  );
end;
$function$;

create or replace function private.validate_canonical_fact_payload_v2(p_version jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_value_kind text;
  v_source jsonb;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_version,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'immutableVersion',
      'factKind',
      'factKey',
      'dimensions',
      'temporal',
      'accounting',
      'value',
      'reconciliationState',
      'validationState',
      'sources',
      'decision',
      'normalizationVersion',
      'transformationVersion',
      'sourceObservedAt',
      'createdAt',
      'factFingerprint'
    ]
  )
    or p_version ->> 'contractVersion' <> 'canonical_business_fact_version_v2'
    or pg_catalog.jsonb_typeof(p_version -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'immutableVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_version -> 'factKind') <> 'string'
    or pg_catalog.jsonb_typeof(p_version -> 'factKey') <> 'string'
    or not private.is_fact_dimensions_v1(p_version -> 'dimensions')
    or not private.jsonb_has_exact_keys_v1(
      p_version -> 'temporal',
      array[
        'effectiveAt',
        'postingDate',
        'periodStart',
        'periodEnd',
        'fiscalYear',
        'fiscalPeriod',
        'sourceTimeZone',
        'closedPeriod'
      ]
    )
    or not private.jsonb_has_exact_keys_v1(
      p_version -> 'accounting',
      array['basis', 'sourceCurrency', 'reportingCurrency', 'exchangeRate', 'exchangeRateSource']
    )
    or not private.jsonb_has_exact_keys_v1(
      p_version -> 'decision',
      array['authority', 'policyVersion', 'actorId', 'decidedAt', 'reasonCodes']
    )
    or pg_catalog.jsonb_typeof(p_version -> 'sources') <> 'array'
    or pg_catalog.jsonb_array_length(p_version -> 'sources') not between 1 and 100
    or pg_catalog.jsonb_typeof(p_version -> 'factFingerprint') <> 'string' then
    raise exception using errcode = '22023', message = 'canonical_fact_payload_invalid';
  end if;

  if p_version ->> 'reconciliationState' = 'tombstone' then
    if pg_catalog.jsonb_typeof(p_version -> 'value') <> 'null' then
      raise exception using errcode = '22023', message = 'canonical_fact_tombstone_value_invalid';
    end if;
  else
    if pg_catalog.jsonb_typeof(p_version -> 'value') <> 'object' then
      raise exception using errcode = '22023', message = 'canonical_fact_value_invalid';
    end if;

    v_value_kind := p_version #>> '{value,kind}';
    if (v_value_kind = 'money' and not private.jsonb_has_exact_keys_v1(
      p_version -> 'value', array['kind', 'amount', 'currency']
    ))
      or (v_value_kind = 'decimal' and not private.jsonb_has_exact_keys_v1(
        p_version -> 'value', array['kind', 'value', 'unit']
      ))
      or (v_value_kind = 'percentage' and not private.jsonb_has_exact_keys_v1(
        p_version -> 'value', array['kind', 'value']
      ))
      or (v_value_kind = 'integer' and not private.jsonb_has_exact_keys_v1(
        p_version -> 'value', array['kind', 'value', 'unit']
      ))
      or (v_value_kind in ('boolean', 'date', 'text', 'structured') and not private.jsonb_has_exact_keys_v1(
        p_version -> 'value', array['kind', 'value']
      ))
      or v_value_kind not in ('money', 'decimal', 'percentage', 'integer', 'boolean', 'date', 'text', 'structured') then
      raise exception using errcode = '22023', message = 'canonical_fact_value_invalid';
    end if;
  end if;

  for v_source in select value from pg_catalog.jsonb_array_elements(p_version -> 'sources')
  loop
    if not private.jsonb_has_exact_keys_v1(
      v_source,
      array['sourceRecordVersionId', 'sourceFingerprint', 'sourceRole', 'contributionWeight']
    ) then
      raise exception using errcode = '22023', message = 'canonical_fact_source_invalid';
    end if;
  end loop;
end;
$function$;

create or replace function public.commit_canonical_business_fact_version_v2(
  p_identity_fingerprint text,
  p_version jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_version_id uuid;
  v_identity_fingerprint bytea;
  v_fact_fingerprint bytea;
  v_fact private.canonical_business_facts;
  v_existing_version private.canonical_business_fact_versions;
  v_source_version private.external_source_record_versions;
  v_source jsonb;
  v_prior_version_id uuid;
  v_expected_version bigint;
  v_value_kind text;
  v_numeric_value text;
  v_exchange_rate text;
  v_contribution_weight text;
  v_source_count integer := 0;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_canonical_fact_payload_v2(p_version);

  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception using errcode = '22023', message = 'fact_request_id_invalid';
  end if;
  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'fact_actor_id_invalid';
  end if;

  v_workspace_id := (p_version ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_version ->> 'businessEntityId')::uuid;
  v_version_id := (p_version ->> 'id')::uuid;
  v_identity_fingerprint := private.sha256_fingerprint_bytes_v1(p_identity_fingerprint);
  v_fact_fingerprint := private.sha256_fingerprint_bytes_v1(p_version ->> 'factFingerprint');
  v_value_kind := p_version #>> '{value,kind}';
  v_exchange_rate := p_version #>> '{accounting,exchangeRate}';

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = v_workspace_id
      and entity.id = v_business_entity_id
  ) then
    raise exception using errcode = '23503', message = 'fact_business_entity_scope_mismatch';
  end if;

  if p_version #>> '{decision,authority}' = 'customer_authorized_user'
    and not exists (
      select 1
      from public.workspace_members as membership
      where membership.workspace_id = v_workspace_id
        and membership.user_id = (p_version #>> '{decision,actorId}')::uuid
        and membership.status = 'active'
    ) then
    raise exception using errcode = '42501', message = 'fact_decision_actor_scope_mismatch';
  end if;

  if p_version #>> '{decision,authority}' = 'operator'
    and not exists (
      select 1
      from public.profiles as profile
      where profile.id = (p_version #>> '{decision,actorId}')::uuid
    ) then
    raise exception using errcode = '23503', message = 'fact_operator_actor_missing';
  end if;

  if v_value_kind = 'money' then
    v_numeric_value := p_version #>> '{value,amount}';
  elsif v_value_kind in ('decimal', 'percentage', 'integer') then
    v_numeric_value := p_version #>> '{value,value}';
  end if;

  if v_numeric_value is not null and not private.is_canonical_numeric_v1(
    v_numeric_value,
    30,
    9,
    true,
    false,
    v_value_kind = 'integer'
  ) then
    raise exception using errcode = '22023', message = 'fact_decimal_out_of_bounds';
  end if;

  if v_exchange_rate is not null and not private.is_canonical_numeric_v1(
    v_exchange_rate,
    30,
    12,
    false,
    true,
    false
  ) then
    raise exception using errcode = '22023', message = 'fact_exchange_rate_out_of_bounds';
  end if;

  insert into private.canonical_business_facts (
    workspace_id,
    business_entity_id,
    fact_kind,
    fact_key,
    identity_fingerprint
  ) values (
    v_workspace_id,
    v_business_entity_id,
    p_version ->> 'factKind',
    p_version ->> 'factKey',
    v_identity_fingerprint
  )
  on conflict (workspace_id, business_entity_id, fact_kind, fact_key) do nothing;

  select fact.*
  into v_fact
  from private.canonical_business_facts as fact
  where fact.workspace_id = v_workspace_id
    and fact.business_entity_id = v_business_entity_id
    and fact.fact_kind = p_version ->> 'factKind'
    and fact.fact_key = p_version ->> 'factKey'
  for update;

  if not found or v_fact.identity_fingerprint <> v_identity_fingerprint then
    raise exception using errcode = '23505', message = 'canonical_fact_identity_fingerprint_mismatch';
  end if;

  select version.*
  into v_existing_version
  from private.canonical_business_fact_versions as version
  where version.fact_id = v_fact.id
    and version.fact_fingerprint = v_fact_fingerprint;

  if found then
    if v_existing_version.id <> v_version_id then
      raise exception using errcode = '23505', message = 'fact_fingerprint_version_id_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'factId', v_fact.id,
      'factVersionId', v_existing_version.id,
      'immutableVersion', v_existing_version.immutable_version,
      'identityFingerprint', p_identity_fingerprint,
      'factFingerprint', p_version ->> 'factFingerprint',
      'currentVersionId', v_fact.current_version_id,
      'sourceCount', (
        select count(*)
        from private.business_fact_sources as edge
        where edge.fact_version_id = v_existing_version.id
      ),
      'idempotent', true
    );
  end if;

  v_expected_version := v_fact.version_counter + 1;
  v_prior_version_id := v_fact.current_version_id;
  if (p_version ->> 'immutableVersion')::bigint <> v_expected_version then
    raise exception using errcode = '40001', message = 'fact_immutable_version_stale';
  end if;

  insert into private.canonical_business_fact_versions (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    fact_id,
    immutable_version,
    prior_version_id,
    dimensions,
    effective_at,
    posting_date,
    period_start,
    period_end,
    fiscal_year,
    fiscal_period,
    source_timezone,
    closed_period,
    accounting_basis,
    source_currency,
    reporting_currency,
    exchange_rate_canonical,
    exchange_rate,
    exchange_rate_source,
    value_kind,
    numeric_value_canonical,
    numeric_value,
    text_value,
    date_value,
    boolean_value,
    structured_value,
    value_currency,
    unit,
    reconciliation_state,
    validation_state,
    decision_authority,
    decision_policy_version,
    decision_actor_id,
    decision_decided_at,
    decision_reason_codes,
    normalization_version,
    transformation_version,
    source_observed_at,
    created_at,
    fact_fingerprint
  ) values (
    v_version_id,
    p_version ->> 'contractVersion',
    v_workspace_id,
    v_business_entity_id,
    v_fact.id,
    (p_version ->> 'immutableVersion')::bigint,
    v_prior_version_id,
    p_version -> 'dimensions',
    (p_version #>> '{temporal,effectiveAt}')::timestamptz,
    (p_version #>> '{temporal,postingDate}')::date,
    (p_version #>> '{temporal,periodStart}')::date,
    (p_version #>> '{temporal,periodEnd}')::date,
    (p_version #>> '{temporal,fiscalYear}')::integer,
    (p_version #>> '{temporal,fiscalPeriod}')::smallint,
    p_version #>> '{temporal,sourceTimeZone}',
    (p_version #>> '{temporal,closedPeriod}')::boolean,
    p_version #>> '{accounting,basis}',
    p_version #>> '{accounting,sourceCurrency}',
    p_version #>> '{accounting,reportingCurrency}',
    v_exchange_rate,
    case when v_exchange_rate is not null then v_exchange_rate::numeric(30,12) end,
    p_version #>> '{accounting,exchangeRateSource}',
    v_value_kind,
    v_numeric_value,
    case when v_numeric_value is not null then v_numeric_value::numeric(30,9) end,
    case when v_value_kind = 'text' then p_version #>> '{value,value}' end,
    case when v_value_kind = 'date' then (p_version #>> '{value,value}')::date end,
    case when v_value_kind = 'boolean' then (p_version #>> '{value,value}')::boolean end,
    case when v_value_kind = 'structured' then p_version #> '{value,value}' end,
    case when v_value_kind = 'money' then p_version #>> '{value,currency}' end,
    case when v_value_kind in ('decimal', 'integer') then p_version #>> '{value,unit}' end,
    p_version ->> 'reconciliationState',
    p_version ->> 'validationState',
    p_version #>> '{decision,authority}',
    p_version #>> '{decision,policyVersion}',
    (p_version #>> '{decision,actorId}')::uuid,
    (p_version #>> '{decision,decidedAt}')::timestamptz,
    array(
      select value
      from pg_catalog.jsonb_array_elements_text(p_version #> '{decision,reasonCodes}') as reason(value)
    ),
    p_version ->> 'normalizationVersion',
    p_version ->> 'transformationVersion',
    (p_version ->> 'sourceObservedAt')::timestamptz,
    (p_version ->> 'createdAt')::timestamptz,
    v_fact_fingerprint
  );

  for v_source in select value from pg_catalog.jsonb_array_elements(p_version -> 'sources')
  loop
    v_contribution_weight := v_source ->> 'contributionWeight';
    if v_contribution_weight is not null and not private.is_canonical_numeric_v1(
      v_contribution_weight,
      30,
      9,
      false,
      false,
      false
    ) then
      raise exception using errcode = '22023', message = 'fact_source_weight_out_of_bounds';
    end if;

    select source_version.*
    into v_source_version
    from private.external_source_record_versions as source_version
    where source_version.id = (v_source ->> 'sourceRecordVersionId')::uuid
      and source_version.workspace_id = v_workspace_id
      and source_version.business_entity_id = v_business_entity_id
      and source_version.source_fingerprint = private.sha256_fingerprint_bytes_v1(
        v_source ->> 'sourceFingerprint'
      );

    if not found then
      raise exception using errcode = '23503', message = 'fact_source_scope_or_fingerprint_mismatch';
    end if;

    if p_version ->> 'reconciliationState' = 'accepted'
      and v_source_version.validation_state <> 'valid' then
      raise exception using errcode = '23514', message = 'accepted_fact_requires_valid_sources';
    end if;

    insert into private.business_fact_sources (
      workspace_id,
      business_entity_id,
      fact_version_id,
      source_record_version_id,
      source_fingerprint,
      source_role,
      contribution_weight_canonical,
      contribution_weight
    ) values (
      v_workspace_id,
      v_business_entity_id,
      v_version_id,
      v_source_version.id,
      v_source_version.source_fingerprint,
      v_source ->> 'sourceRole',
      v_contribution_weight,
      case when v_contribution_weight is not null then v_contribution_weight::numeric(30,9) end
    );
    v_source_count := v_source_count + 1;
  end loop;

  if v_source_count = 0 then
    raise exception using errcode = '23514', message = 'canonical_fact_requires_source_provenance';
  end if;

  update private.canonical_business_facts as fact
  set
    current_version_id = v_version_id,
    version_counter = v_expected_version,
    updated_at = transaction_timestamp()
  where fact.id = v_fact.id
  returning fact.* into v_fact;

  insert into private.integration_audit_events (
    workspace_id,
    business_entity_id,
    actor_type,
    actor_id,
    action,
    outcome,
    target_type,
    target_id,
    request_id,
    metadata,
    retention_class
  ) values (
    v_workspace_id,
    v_business_entity_id,
    'service',
    p_actor_id,
    'canonical_business_fact_version.commit',
    'succeeded',
    'canonical_business_fact_version',
    v_version_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'contract_version', p_version ->> 'contractVersion',
      'immutable_version', v_expected_version,
      'fact_kind', p_version ->> 'factKind',
      'reconciliation_state', p_version ->> 'reconciliationState',
      'validation_state', p_version ->> 'validationState',
      'prior_version_id', v_prior_version_id,
      'source_count', v_source_count
    ),
    'operational'
  );

  return pg_catalog.jsonb_build_object(
    'factId', v_fact.id,
    'factVersionId', v_version_id,
    'immutableVersion', v_expected_version,
    'identityFingerprint', p_identity_fingerprint,
    'factFingerprint', p_version ->> 'factFingerprint',
    'currentVersionId', v_fact.current_version_id,
    'sourceCount', v_source_count,
    'idempotent', false
  );
end;
$function$;

revoke execute on all functions in schema private
  from public, anon, authenticated, service_role, external_integrations_authority;

revoke all on function public.create_business_entity_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  smallint,
  text
) from public, anon, authenticated, service_role, external_integrations_authority;
grant execute on function public.create_business_entity_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  smallint,
  text
) to authenticated;

revoke all on function public.update_business_entity_v1(uuid, bigint, jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority;
grant execute on function public.update_business_entity_v1(uuid, bigint, jsonb)
  to authenticated;

revoke all on function public.commit_external_source_record_version_v1(text, jsonb, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority;
grant execute on function public.commit_external_source_record_version_v1(text, jsonb, text, text)
  to external_integrations_authority;

revoke all on function public.commit_canonical_business_fact_version_v2(text, jsonb, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority;
grant execute on function public.commit_canonical_business_fact_version_v2(text, jsonb, text, text)
  to external_integrations_authority;

commit;
