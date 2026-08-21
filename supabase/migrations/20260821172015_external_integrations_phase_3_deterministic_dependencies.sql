-- External Integrations Phase 3: Incremental Deterministic Dependencies
--
-- This migration is provider-neutral and shadow-only. It persists rebuildable
-- deterministic aggregate/KPI state, bounded change-set lineage, and coalesced
-- dirty nodes. It introduces no connector, credential, queue, AI, UI, or
-- customer-visible KPI promotion behavior.

begin;

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'deterministic_calculation_authority'
  ) then
    create role deterministic_calculation_authority nologin noinherit;
  end if;
end;
$role$;

revoke deterministic_calculation_authority from anon, authenticated, service_role, external_integrations_authority;
revoke all on schema private from deterministic_calculation_authority;

create or replace function private.is_integration_audit_metadata_v3(p_value jsonb)
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
      'source_count',
      'domain_key',
      'policy_key',
      'conflict_behavior',
      'family_key',
      'registry_version',
      'contribution_mode',
      'classification',
      'match_tier',
      'case_state',
      'policy_version_id',
      'member_count',
      'reconciliation_case_id',
      'family_version_id',
      'inserted_events',
      'change_set_id',
      'execution_mode',
      'dirty_node_count',
      'completed_node_count',
      'equivalence_status',
      'result_state_fingerprint'
    ]::text[]) = '{}'::jsonb
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v3(metadata));

create or replace function private.assert_deterministic_calculation_authority_v1()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'deterministic_calculation_authority',
    'MEMBER'
  ) then
    raise exception using errcode = '42501', message = 'deterministic_calculation_authority_required';
  end if;
end;
$function$;

create or replace function private.phase_3_fingerprint_text_v1(p_value bytea)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(p_value, 'hex');
$function$;

create or replace function private.phase_3_canonical_json_v1(p_value jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(member.key)::text || ':'
            || private.phase_3_canonical_json_v1(member.value),
          ',' order by member.key collate "C"
        ),
        ''
      ) || '}'
      into v_result
      from pg_catalog.jsonb_each(p_value) as member(key, value);
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          private.phase_3_canonical_json_v1(member.value),
          ',' order by member.ordinality
        ),
        ''
      ) || ']'
      into v_result
      from pg_catalog.jsonb_array_elements(p_value) with ordinality
        as member(value, ordinality);
    else
      v_result := p_value::text;
  end case;
  return v_result;
end;
$function$;

create or replace function private.phase_3_contract_fingerprint_v1(p_value jsonb)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select extensions.digest(
    pg_catalog.convert_to(private.phase_3_canonical_json_v1(p_value), 'UTF8'),
    'sha256'
  );
$function$;

create or replace function private.phase_3_node_identity_fingerprint_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_node_key text,
  p_scope jsonb
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'deterministic_node_identity',
      'fingerprintVersion', 'deterministic_node_identity_v1',
      'payload', pg_catalog.jsonb_build_object(
        'workspaceId', p_workspace_id,
        'businessEntityId', p_business_entity_id,
        'nodeKey', p_node_key,
        'scope', p_scope
      )
    )
  );
$function$;

create or replace function private.phase_3_state_fingerprint_v1(p_states jsonb)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'deterministic_state',
      'fingerprintVersion', 'deterministic_state_fingerprint_v1',
      'payload', coalesce(
        (
          select pg_catalog.jsonb_agg(
            state.value order by state.value ->> 'nodeIdentityFingerprint'
          )
          from pg_catalog.jsonb_array_elements(p_states) as state(value)
        ),
        '[]'::jsonb
      )
    )
  );
$function$;

create or replace function private.phase_3_watermark_fingerprint_v1(
  p_input_contribution_fingerprint text,
  p_registry_version text,
  p_registry_fingerprint text,
  p_calculation_policy_version text,
  p_state_fingerprint text
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'deterministic_watermark',
      'fingerprintVersion', 'deterministic_watermark_v1',
      'payload', pg_catalog.jsonb_build_object(
        'contractVersion', 'deterministic_watermark_v1',
        'inputContributionFingerprint', p_input_contribution_fingerprint,
        'registryVersion', p_registry_version,
        'registryFingerprint', p_registry_fingerprint,
        'calculationPolicyVersion', p_calculation_policy_version,
        'stateFingerprint', p_state_fingerprint
      )
    )
  );
$function$;

create or replace function private.phase_3_failure_fingerprint_v1(
  p_change_set_fingerprint text,
  p_incremental_fingerprint text,
  p_clean_fingerprint text
)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select private.phase_3_contract_fingerprint_v1(
    pg_catalog.jsonb_build_object(
      'fingerprintPurpose', 'deterministic_integrity_failure',
      'fingerprintVersion', 'deterministic_integrity_failure_v1',
      'payload', pg_catalog.jsonb_build_object(
        'changeSetFingerprint', p_change_set_fingerprint,
        'incrementalFingerprint', p_incremental_fingerprint,
        'cleanFingerprint', p_clean_fingerprint
      )
    )
  );
$function$;

create or replace function private.is_phase_3_registered_node_v1(
  p_node_key text,
  p_node_kind text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select (p_node_key, p_node_kind) in (
    ('recognized_revenue_month_total', 'aggregate'),
    ('revenue', 'kpi'),
    ('business_health_revenue_invalidation', 'downstream'),
    ('deterministic_revenue_opportunity_invalidation', 'downstream'),
    ('deterministic_revenue_risk_invalidation', 'downstream'),
    ('snapshot_revenue_invalidation', 'downstream')
  );
$function$;

create or replace function private.is_unique_uuid_array_v1(
  p_values uuid[],
  p_maximum integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select pg_catalog.cardinality(p_values) <= p_maximum
    and pg_catalog.cardinality(p_values) = (
      select count(distinct item.value)::integer
      from pg_catalog.unnest(p_values) as item(value)
    );
$function$;

create or replace function private.is_deterministic_node_scope_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_period_start date;
  v_period_end date;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_value,
    array['periodStart', 'periodEnd', 'dimensions', 'accountingBasis', 'currency']
  )
    or pg_catalog.jsonb_typeof(p_value -> 'periodStart') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_value -> 'periodEnd') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_value -> 'dimensions') <> 'array'
    or pg_catalog.jsonb_typeof(p_value -> 'accountingBasis') <> 'string'
    or pg_catalog.jsonb_typeof(p_value -> 'currency') not in ('string', 'null')
    or not private.is_fact_dimensions_v1(p_value -> 'dimensions')
    or p_value ->> 'accountingBasis' not in ('accrual', 'cash', 'not_applicable', 'unknown')
    or (
      p_value -> 'currency' <> 'null'::jsonb
      and not private.is_currency_code_v1(p_value ->> 'currency')
    ) then
    return false;
  end if;

  if (p_value -> 'periodStart' = 'null'::jsonb) <> (p_value -> 'periodEnd' = 'null'::jsonb) then
    return false;
  end if;
  if p_value -> 'periodStart' <> 'null'::jsonb then
    v_period_start := (p_value ->> 'periodStart')::date;
    v_period_end := (p_value ->> 'periodEnd')::date;
    if v_period_end < v_period_start then
      return false;
    end if;
  end if;
  return true;
exception
  when invalid_datetime_format or datetime_field_overflow then
    return false;
end;
$function$;

create table private.deterministic_change_sets (
  id uuid primary key,
  contract_version text not null check (contract_version = 'deterministic_change_set_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  execution_mode text not null check (execution_mode in ('incremental', 'clean_full')),
  input_contribution_fingerprint bytea not null check (octet_length(input_contribution_fingerprint) = 32),
  dependency_registry_version text not null
    check (dependency_registry_version = 'vaeroex_deterministic_dependencies_v1'),
  dependency_registry_fingerprint bytea not null
    check (
      dependency_registry_fingerprint = pg_catalog.decode(
        'fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5',
        'hex'
      )
    ),
  calculation_policy_version text not null
    check (calculation_policy_version = 'deterministic_calculation_policy_v1'),
  prior_deterministic_watermark bytea check (
    prior_deterministic_watermark is null or octet_length(prior_deterministic_watermark) = 32
  ),
  prior_state_fingerprint bytea check (
    prior_state_fingerprint is null or octet_length(prior_state_fingerprint) = 32
  ),
  change_set_fingerprint bytea not null check (octet_length(change_set_fingerprint) = 32),
  state text not null default 'running'
    check (state in ('running', 'completed', 'quarantined', 'failed')),
  dirty_node_count integer not null default 0 check (dirty_node_count >= 0),
  completed_node_count integer not null default 0
    check (completed_node_count >= 0 and completed_node_count <= dirty_node_count),
  result_deterministic_watermark bytea check (
    result_deterministic_watermark is null or octet_length(result_deterministic_watermark) = 32
  ),
  result_state_fingerprint bytea check (
    result_state_fingerprint is null or octet_length(result_state_fingerprint) = 32
  ),
  incremental_state_fingerprint bytea check (
    incremental_state_fingerprint is null or octet_length(incremental_state_fingerprint) = 32
  ),
  clean_state_fingerprint bytea check (
    clean_state_fingerprint is null or octet_length(clean_state_fingerprint) = 32
  ),
  equivalence_status text check (equivalence_status in ('matched', 'mismatched')),
  failure_code text check (failure_code is null or private.is_bounded_identifier_v1(failure_code)),
  failure_fingerprint bytea check (
    failure_fingerprint is null or octet_length(failure_fingerprint) = 32
  ),
  requested_by text not null check (char_length(requested_by) between 1 and 200),
  request_id text not null check (char_length(request_id) between 1 and 200),
  requested_at timestamptz not null,
  started_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  constraint deterministic_change_sets_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint deterministic_change_sets_input_idempotency_key unique (
    workspace_id,
    business_entity_id,
    input_contribution_fingerprint,
    dependency_registry_fingerprint,
    calculation_policy_version,
    execution_mode
  ),
  constraint deterministic_change_sets_fingerprint_key unique (
    workspace_id, business_entity_id, change_set_fingerprint
  ),
  constraint deterministic_change_sets_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint deterministic_change_sets_terminal_check check (
    (
      state = 'running'
      and completed_at is null
      and result_deterministic_watermark is null
      and result_state_fingerprint is null
      and incremental_state_fingerprint is null
      and clean_state_fingerprint is null
      and equivalence_status is null
      and failure_code is null
      and failure_fingerprint is null
    )
    or (
      state = 'completed'
      and completed_at is not null
      and result_deterministic_watermark is not null
      and result_state_fingerprint is not null
      and incremental_state_fingerprint = clean_state_fingerprint
      and result_state_fingerprint = clean_state_fingerprint
      and equivalence_status = 'matched'
      and failure_code is null
      and failure_fingerprint is null
      and completed_node_count = dirty_node_count
    )
    or (
      state = 'quarantined'
      and completed_at is not null
      and result_deterministic_watermark is null
      and result_state_fingerprint is null
      and incremental_state_fingerprint is distinct from clean_state_fingerprint
      and equivalence_status = 'mismatched'
      and failure_code is not null
      and failure_fingerprint is not null
      and completed_node_count = dirty_node_count
    )
    or (
      state = 'failed'
      and completed_at is not null
      and result_deterministic_watermark is null
      and result_state_fingerprint is null
      and failure_code is not null
      and failure_fingerprint is not null
    )
  )
);

create index deterministic_change_sets_scope_started_idx
  on private.deterministic_change_sets(
    workspace_id, business_entity_id, started_at desc, id desc
  );
create index deterministic_change_sets_state_idx
  on private.deterministic_change_sets(state, started_at)
  where state = 'running';

create table private.deterministic_aggregate_states (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (contract_version = 'deterministic_aggregate_state_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  node_key text not null check (private.is_bounded_identifier_v1(node_key)),
  node_kind text not null check (node_kind in ('aggregate', 'kpi')),
  node_identity_fingerprint bytea not null check (octet_length(node_identity_fingerprint) = 32),
  period_start date,
  period_end date,
  dimensions jsonb not null default '[]'::jsonb check (private.is_fact_dimensions_v1(dimensions)),
  accounting_basis text not null
    check (accounting_basis in ('accrual', 'cash', 'not_applicable', 'unknown')),
  currency character(3) check (currency is null or private.is_currency_code_v1(currency)),
  value_canonical text not null,
  value numeric(30,9) not null,
  supporting_contribution_count bigint not null check (supporting_contribution_count >= 0),
  source_contribution_accumulator bytea not null check (octet_length(source_contribution_accumulator) = 32),
  source_contribution_fingerprint bytea not null check (octet_length(source_contribution_fingerprint) = 32),
  dependency_registry_version text not null
    check (dependency_registry_version = 'vaeroex_deterministic_dependencies_v1'),
  dependency_registry_fingerprint bytea not null
    check (
      dependency_registry_fingerprint = pg_catalog.decode(
        'fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5',
        'hex'
      )
    ),
  calculation_policy_version text not null
    check (calculation_policy_version = 'deterministic_calculation_policy_v1'),
  calculation_version text not null check (private.is_bounded_identifier_v1(calculation_version)),
  node_state_fingerprint bytea not null check (octet_length(node_state_fingerprint) = 32),
  last_change_set_id uuid not null,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint deterministic_aggregate_states_scope_identity_key unique (
    workspace_id, business_entity_id, node_identity_fingerprint
  ),
  constraint deterministic_aggregate_states_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint deterministic_aggregate_states_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  ),
  constraint deterministic_aggregate_states_value_check check (
    private.canonical_numeric_matches_projection_v1(
      value_canonical, value, 30, 9, true, false, false
    )
  ),
  constraint deterministic_aggregate_states_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint deterministic_aggregate_states_change_set_fkey foreign key (
    workspace_id, business_entity_id, last_change_set_id
  ) references private.deterministic_change_sets(workspace_id, business_entity_id, id)
    on delete restrict
);

create index deterministic_aggregate_states_node_scope_idx
  on private.deterministic_aggregate_states(
    workspace_id,
    business_entity_id,
    node_key,
    period_start,
    period_end,
    accounting_basis,
    currency
  );
create index deterministic_aggregate_states_change_set_idx
  on private.deterministic_aggregate_states(
    workspace_id, business_entity_id, last_change_set_id
  );

create table private.dependency_dirty_nodes (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null check (contract_version = 'dependency_dirty_node_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  change_set_id uuid not null,
  node_key text not null check (private.is_bounded_identifier_v1(node_key)),
  node_kind text not null check (node_kind in ('aggregate', 'kpi', 'downstream')),
  node_identity_fingerprint bytea not null check (octet_length(node_identity_fingerprint) = 32),
  period_start date,
  period_end date,
  dimensions jsonb not null default '[]'::jsonb check (private.is_fact_dimensions_v1(dimensions)),
  accounting_basis text not null
    check (accounting_basis in ('accrual', 'cash', 'not_applicable', 'unknown')),
  currency character(3) check (currency is null or private.is_currency_code_v1(currency)),
  cause_count integer not null check (cause_count > 0),
  bounded_cause_contribution_event_ids uuid[] not null default '{}'::uuid[]
    check (private.is_unique_uuid_array_v1(bounded_cause_contribution_event_ids, 32)),
  cause_fingerprint bytea not null check (octet_length(cause_fingerprint) = 32),
  dependency_depth integer not null check (dependency_depth between 0 and 256),
  state text not null default 'dirty'
    check (state in ('dirty', 'completed', 'quarantined', 'failed')),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default transaction_timestamp(),
  updated_at timestamptz not null default transaction_timestamp(),
  constraint dependency_dirty_nodes_change_node_key unique (
    workspace_id, business_entity_id, change_set_id, node_identity_fingerprint
  ),
  constraint dependency_dirty_nodes_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint dependency_dirty_nodes_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  ),
  constraint dependency_dirty_nodes_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint dependency_dirty_nodes_change_set_fkey foreign key (
    workspace_id, business_entity_id, change_set_id
  ) references private.deterministic_change_sets(workspace_id, business_entity_id, id)
    on delete cascade
);

create index dependency_dirty_nodes_change_state_idx
  on private.dependency_dirty_nodes(
    workspace_id, business_entity_id, change_set_id, state, dependency_depth, node_key
  );

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'deterministic_change_sets',
    'deterministic_aggregate_states',
    'dependency_dirty_nodes'
  ]
  loop
    execute pg_catalog.format('alter table private.%I enable row level security', v_table);
    execute pg_catalog.format('alter table private.%I force row level security', v_table);
    execute pg_catalog.format(
      'revoke all on table private.%I from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority',
      v_table
    );
  end loop;
end;
$rls$;

create or replace function private.validate_deterministic_change_set_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.state <> 'running' then
    raise exception using errcode = '55000', message = 'deterministic_change_set_terminal';
  end if;
  if new.id <> old.id
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.execution_mode <> old.execution_mode
    or new.input_contribution_fingerprint <> old.input_contribution_fingerprint
    or new.dependency_registry_version <> old.dependency_registry_version
    or new.dependency_registry_fingerprint <> old.dependency_registry_fingerprint
    or new.calculation_policy_version <> old.calculation_policy_version
    or new.prior_deterministic_watermark is distinct from old.prior_deterministic_watermark
    or new.prior_state_fingerprint is distinct from old.prior_state_fingerprint
    or new.change_set_fingerprint <> old.change_set_fingerprint
    or new.requested_at <> old.requested_at
    or new.requested_by <> old.requested_by
    or new.request_id <> old.request_id
    or new.started_at <> old.started_at
    or new.row_version <> old.row_version + 1 then
    raise exception using errcode = '55000', message = 'deterministic_change_set_immutable_fields';
  end if;
  return new;
end;
$function$;

create trigger validate_deterministic_change_set_mutation_v1
before update on private.deterministic_change_sets
for each row execute function private.validate_deterministic_change_set_mutation_v1();

create trigger reject_deterministic_change_set_delete_v1
before delete on private.deterministic_change_sets
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_dependency_dirty_node_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.state <> 'dirty' then
    raise exception using errcode = '55000', message = 'dependency_dirty_node_terminal';
  end if;
  if new.id <> old.id
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.change_set_id <> old.change_set_id
    or new.node_key <> old.node_key
    or new.node_kind <> old.node_kind
    or new.node_identity_fingerprint <> old.node_identity_fingerprint
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.dimensions <> old.dimensions
    or new.accounting_basis <> old.accounting_basis
    or new.currency is distinct from old.currency
    or new.dependency_depth <> old.dependency_depth
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1 then
    raise exception using errcode = '55000', message = 'dependency_dirty_node_immutable_fields';
  end if;
  return new;
end;
$function$;

create trigger validate_dependency_dirty_node_mutation_v1
before update on private.dependency_dirty_nodes
for each row execute function private.validate_dependency_dirty_node_mutation_v1();

create trigger reject_dependency_dirty_node_delete_v1
before delete on private.dependency_dirty_nodes
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_deterministic_aggregate_state_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id <> old.id
    or new.workspace_id <> old.workspace_id
    or new.business_entity_id <> old.business_entity_id
    or new.node_key <> old.node_key
    or new.node_kind <> old.node_kind
    or new.node_identity_fingerprint <> old.node_identity_fingerprint
    or new.period_start is distinct from old.period_start
    or new.period_end is distinct from old.period_end
    or new.dimensions <> old.dimensions
    or new.accounting_basis <> old.accounting_basis
    or new.currency is distinct from old.currency
    or new.created_at <> old.created_at
    or new.row_version <> old.row_version + 1 then
    raise exception using errcode = '55000', message = 'deterministic_aggregate_state_identity_immutable';
  end if;
  return new;
end;
$function$;

create trigger validate_deterministic_aggregate_state_mutation_v1
before update on private.deterministic_aggregate_states
for each row execute function private.validate_deterministic_aggregate_state_mutation_v1();

create trigger reject_deterministic_aggregate_state_delete_v1
before delete on private.deterministic_aggregate_states
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.current_contribution_state_fingerprint_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid
)
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select extensions.digest(
    pg_catalog.convert_to(
      'deterministic_contribution_state_v1' || chr(10) || coalesce(
        pg_catalog.string_agg(
          private.phase_3_fingerprint_text_v1(event.event_fingerprint),
          chr(10)
          order by event.event_fingerprint
        ),
        ''
      ),
      'UTF8'
    ),
    'sha256'
  )
  from private.fact_contribution_events as event
  where event.workspace_id = p_workspace_id
    and event.business_entity_id = p_business_entity_id
    and (
      event.event_kind = 'control_observation'
      or (
        event.event_kind = 'establish'
        and not exists (
          select 1
          from private.fact_contribution_events as retraction
          where retraction.workspace_id = event.workspace_id
            and retraction.business_entity_id = event.business_entity_id
            and retraction.event_kind = 'retract'
            and retraction.target_contribution_event_id = event.id
        )
      )
    );
$function$;

create or replace function public.read_current_contribution_state_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_deterministic_calculation_authority_v1();
  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = p_workspace_id
      and entity.id = p_business_entity_id
  ) then
    raise exception using errcode = '42501', message = 'deterministic_contribution_scope_denied';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(value.payload order by value.event_fingerprint),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      event.event_fingerprint,
      pg_catalog.jsonb_build_object(
        'id', event.id,
        'eventFingerprint', private.phase_3_fingerprint_text_v1(event.event_fingerprint),
        'sourceFactFingerprint', private.phase_3_fingerprint_text_v1(fact_version.fact_fingerprint),
        'workspaceId', event.workspace_id,
        'businessEntityId', event.business_entity_id,
        'contributionFamilyKey', family.family_key,
        'contributionFamilyKind', family.contribution_mode,
        'measureKey', event.measure_key,
        'aggregateKey', event.aggregate_key,
        'valueCanonical', event.value_canonical,
        'economicDate', coalesce(
          event.period_start,
          fact_version.period_start,
          fact_version.posting_date,
          (
            coalesce(event.effective_at, fact_version.effective_at)
              at time zone entity.timezone
          )::date
        ),
        'periodStart', event.period_start,
        'periodEnd', event.period_end,
        'dimensions', event.dimensions,
        'accountingBasis', event.accounting_basis,
        'currency', event.currency,
        'observationKind', case
          when event.event_kind = 'control_observation' then 'control_observation'
          else 'active_additive'
        end
      ) as payload
    from private.fact_contribution_events as event
    join private.contribution_family_versions as family
      on family.workspace_id = event.workspace_id
      and family.business_entity_id = event.business_entity_id
      and family.id = event.contribution_family_version_id
    join private.canonical_business_fact_versions as fact_version
      on fact_version.workspace_id = event.workspace_id
      and fact_version.business_entity_id = event.business_entity_id
      and fact_version.id = event.fact_version_id
    join public.business_entities as entity
      on entity.workspace_id = event.workspace_id
      and entity.id = event.business_entity_id
    where event.workspace_id = p_workspace_id
      and event.business_entity_id = p_business_entity_id
      and (
        event.event_kind = 'control_observation'
        or (
          event.event_kind = 'establish'
          and not exists (
            select 1
            from private.fact_contribution_events as retraction
            where retraction.workspace_id = event.workspace_id
              and retraction.business_entity_id = event.business_entity_id
              and retraction.event_kind = 'retract'
              and retraction.target_contribution_event_id = event.id
          )
        )
      )
  ) as value;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_result) as contribution(value)
    where contribution.value -> 'economicDate' = 'null'::jsonb
  ) then
    raise exception using errcode = '55000', message = 'deterministic_economic_date_missing';
  end if;
  return v_result;
end;
$function$;

create or replace function public.read_current_deterministic_state_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_latest private.deterministic_change_sets;
  v_states jsonb;
begin
  perform private.assert_deterministic_calculation_authority_v1();
  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = p_workspace_id
      and entity.id = p_business_entity_id
  ) then
    raise exception using errcode = '42501', message = 'deterministic_state_scope_denied';
  end if;

  select change_set.*
  into v_latest
  from private.deterministic_change_sets as change_set
  where change_set.workspace_id = p_workspace_id
    and change_set.business_entity_id = p_business_entity_id
    and change_set.state = 'completed'
  order by change_set.completed_at desc, change_set.id desc
  limit 1;

  select coalesce(
    pg_catalog.jsonb_agg(value.payload order by value.node_identity_fingerprint),
    '[]'::jsonb
  )
  into v_states
  from (
    select
      state.node_identity_fingerprint,
      pg_catalog.jsonb_build_object(
        'contractVersion', state.contract_version,
        'workspaceId', state.workspace_id,
        'businessEntityId', state.business_entity_id,
        'nodeKey', state.node_key,
        'nodeKind', state.node_kind,
        'nodeIdentityFingerprint', private.phase_3_fingerprint_text_v1(state.node_identity_fingerprint),
        'scope', pg_catalog.jsonb_build_object(
          'periodStart', state.period_start,
          'periodEnd', state.period_end,
          'dimensions', state.dimensions,
          'accountingBasis', state.accounting_basis,
          'currency', state.currency
        ),
        'valueCanonical', state.value_canonical,
        'supportingContributionCount', state.supporting_contribution_count,
        'sourceContributionAccumulator', private.phase_3_fingerprint_text_v1(state.source_contribution_accumulator),
        'sourceContributionFingerprint', private.phase_3_fingerprint_text_v1(state.source_contribution_fingerprint),
        'registryVersion', state.dependency_registry_version,
        'registryFingerprint', private.phase_3_fingerprint_text_v1(state.dependency_registry_fingerprint),
        'calculationPolicyVersion', state.calculation_policy_version,
        'calculationVersion', state.calculation_version
      ) as payload
    from private.deterministic_aggregate_states as state
    where state.workspace_id = p_workspace_id
      and state.business_entity_id = p_business_entity_id
  ) as value;

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'states', v_states,
    'watermark', case when v_latest.id is null then null else pg_catalog.jsonb_build_object(
      'contractVersion', 'deterministic_watermark_v1',
      'inputContributionFingerprint', private.phase_3_fingerprint_text_v1(v_latest.input_contribution_fingerprint),
      'registryVersion', v_latest.dependency_registry_version,
      'registryFingerprint', private.phase_3_fingerprint_text_v1(v_latest.dependency_registry_fingerprint),
      'calculationPolicyVersion', v_latest.calculation_policy_version,
      'stateFingerprint', private.phase_3_fingerprint_text_v1(v_latest.result_state_fingerprint),
      'watermarkFingerprint', private.phase_3_fingerprint_text_v1(v_latest.result_deterministic_watermark)
    ) end
  );
end;
$function$;

create or replace function private.validate_deterministic_change_set_payload_v1(p_change_set jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
begin
  if not private.jsonb_has_exact_keys_v1(
    p_change_set,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'executionMode',
      'inputContributionFingerprint',
      'dependencyRegistryVersion',
      'dependencyRegistryFingerprint',
      'calculationPolicyVersion',
      'priorDeterministicWatermark',
      'priorStateFingerprint',
      'changeSetFingerprint',
      'requestedAt'
    ]
  )
    or pg_catalog.jsonb_typeof(p_change_set -> 'contractVersion') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'executionMode') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'inputContributionFingerprint') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'dependencyRegistryVersion') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'dependencyRegistryFingerprint') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'calculationPolicyVersion') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'changeSetFingerprint') <> 'string'
    or pg_catalog.jsonb_typeof(p_change_set -> 'requestedAt') <> 'string'
    or p_change_set ->> 'contractVersion' <> 'deterministic_change_set_v1'
    or p_change_set ->> 'executionMode' not in ('incremental', 'clean_full')
    or p_change_set ->> 'dependencyRegistryVersion' <> 'vaeroex_deterministic_dependencies_v1'
    or p_change_set ->> 'dependencyRegistryFingerprint' <>
      'sha256:fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5'
    or p_change_set ->> 'calculationPolicyVersion' <> 'deterministic_calculation_policy_v1'
    or not private.is_sha256_fingerprint_v1(p_change_set ->> 'inputContributionFingerprint')
    or not private.is_sha256_fingerprint_v1(p_change_set ->> 'dependencyRegistryFingerprint')
    or not private.is_sha256_fingerprint_v1(p_change_set ->> 'changeSetFingerprint')
    or pg_catalog.jsonb_typeof(p_change_set -> 'priorDeterministicWatermark') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_change_set -> 'priorStateFingerprint') not in ('string', 'null')
    or (
      p_change_set -> 'priorDeterministicWatermark' <> 'null'::jsonb
      and not private.is_sha256_fingerprint_v1(p_change_set ->> 'priorDeterministicWatermark')
    )
    or (
      p_change_set -> 'priorStateFingerprint' <> 'null'::jsonb
      and not private.is_sha256_fingerprint_v1(p_change_set ->> 'priorStateFingerprint')
    ) then
    raise exception using errcode = '22023', message = 'deterministic_change_set_payload_invalid';
  end if;
  perform (p_change_set ->> 'id')::uuid;
  perform (p_change_set ->> 'workspaceId')::uuid;
  perform (p_change_set ->> 'businessEntityId')::uuid;
  perform (p_change_set ->> 'requestedAt')::timestamptz;
exception
  when invalid_text_representation or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'deterministic_change_set_payload_invalid';
end;
$function$;

create or replace function public.begin_deterministic_change_set_v1(
  p_change_set jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_input_fingerprint bytea;
  v_existing private.deterministic_change_sets;
  v_latest private.deterministic_change_sets;
begin
  perform private.assert_deterministic_calculation_authority_v1();
  perform private.validate_deterministic_change_set_payload_v1(p_change_set);
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'deterministic_change_set_request_invalid';
  end if;

  v_id := (p_change_set ->> 'id')::uuid;
  v_workspace_id := (p_change_set ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_change_set ->> 'businessEntityId')::uuid;
  v_input_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_change_set ->> 'inputContributionFingerprint'
  );

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = v_workspace_id
      and entity.id = v_business_entity_id
      and entity.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'deterministic_change_set_scope_denied';
  end if;
  if private.current_contribution_state_fingerprint_v1(
    v_workspace_id,
    v_business_entity_id
  ) <> v_input_fingerprint then
    raise exception using errcode = '40001', message = 'deterministic_contribution_state_stale';
  end if;

  select change_set.*
  into v_latest
  from private.deterministic_change_sets as change_set
  where change_set.workspace_id = v_workspace_id
    and change_set.business_entity_id = v_business_entity_id
    and change_set.state = 'completed'
  order by change_set.completed_at desc, change_set.id desc
  limit 1;

  if v_latest.id is null then
    if p_change_set -> 'priorDeterministicWatermark' <> 'null'::jsonb
      or p_change_set -> 'priorStateFingerprint' <> 'null'::jsonb then
      raise exception using errcode = '40001', message = 'deterministic_prior_watermark_stale';
    end if;
  elsif private.phase_3_fingerprint_text_v1(v_latest.result_deterministic_watermark)
      is distinct from p_change_set ->> 'priorDeterministicWatermark'
    or private.phase_3_fingerprint_text_v1(v_latest.result_state_fingerprint)
      is distinct from p_change_set ->> 'priorStateFingerprint' then
    raise exception using errcode = '40001', message = 'deterministic_prior_watermark_stale';
  end if;

  if exists (
    select 1
    from private.deterministic_change_sets as change_set
    where change_set.id = v_id
      and (
        change_set.workspace_id <> v_workspace_id
        or change_set.business_entity_id <> v_business_entity_id
      )
  ) then
    raise exception using errcode = '42501', message = 'deterministic_change_set_scope_substitution_denied';
  end if;

  select change_set.*
  into v_existing
  from private.deterministic_change_sets as change_set
  where change_set.workspace_id = v_workspace_id
    and change_set.business_entity_id = v_business_entity_id
    and (
      change_set.id = v_id
      or (
        change_set.input_contribution_fingerprint = v_input_fingerprint
        and change_set.dependency_registry_fingerprint = private.sha256_fingerprint_bytes_v1(
          p_change_set ->> 'dependencyRegistryFingerprint'
        )
        and change_set.calculation_policy_version = p_change_set ->> 'calculationPolicyVersion'
        and change_set.execution_mode = p_change_set ->> 'executionMode'
      )
    )
  order by (change_set.id = v_id) desc
  limit 1;

  if found then
    if v_existing.id = v_id and (
      v_existing.workspace_id <> v_workspace_id
      or v_existing.business_entity_id <> v_business_entity_id
      or v_existing.execution_mode <> p_change_set ->> 'executionMode'
      or v_existing.input_contribution_fingerprint <> v_input_fingerprint
      or v_existing.change_set_fingerprint <> private.sha256_fingerprint_bytes_v1(
        p_change_set ->> 'changeSetFingerprint'
      )
    ) then
      raise exception using errcode = '23505', message = 'deterministic_change_set_id_conflict';
    end if;
    if v_existing.id = v_id
      or (
        v_existing.input_contribution_fingerprint = v_input_fingerprint
        and v_existing.execution_mode = p_change_set ->> 'executionMode'
      ) then
      return pg_catalog.jsonb_build_object(
        'changeSetId', v_existing.id,
        'state', v_existing.state,
        'rowVersion', v_existing.row_version,
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'deterministic_change_set_id_conflict';
  end if;

  if exists (
    select 1
    from private.deterministic_change_sets as change_set
    where change_set.id = v_id
  ) then
    raise exception using errcode = '42501', message = 'deterministic_change_set_scope_substitution_denied';
  end if;

  insert into private.deterministic_change_sets (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    execution_mode,
    input_contribution_fingerprint,
    dependency_registry_version,
    dependency_registry_fingerprint,
    calculation_policy_version,
    prior_deterministic_watermark,
    prior_state_fingerprint,
    change_set_fingerprint,
    requested_by,
    request_id,
    requested_at
  ) values (
    v_id,
    'deterministic_change_set_v1',
    v_workspace_id,
    v_business_entity_id,
    p_change_set ->> 'executionMode',
    v_input_fingerprint,
    p_change_set ->> 'dependencyRegistryVersion',
    private.sha256_fingerprint_bytes_v1(p_change_set ->> 'dependencyRegistryFingerprint'),
    p_change_set ->> 'calculationPolicyVersion',
    case when p_change_set -> 'priorDeterministicWatermark' = 'null'::jsonb then null
      else private.sha256_fingerprint_bytes_v1(p_change_set ->> 'priorDeterministicWatermark') end,
    case when p_change_set -> 'priorStateFingerprint' = 'null'::jsonb then null
      else private.sha256_fingerprint_bytes_v1(p_change_set ->> 'priorStateFingerprint') end,
    private.sha256_fingerprint_bytes_v1(p_change_set ->> 'changeSetFingerprint'),
    p_actor_id,
    p_request_id,
    (p_change_set ->> 'requestedAt')::timestamptz
  );

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
    'deterministic_change_set.begin',
    'succeeded',
    'deterministic_change_set',
    v_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'change_set_id', v_id,
      'execution_mode', p_change_set ->> 'executionMode',
      'registry_version', p_change_set ->> 'dependencyRegistryVersion'
    ),
    'security'
  );

  return pg_catalog.jsonb_build_object(
    'changeSetId', v_id,
    'state', 'running',
    'rowVersion', 1,
    'idempotent', false
  );
end;
$function$;

create or replace function public.coalesce_dependency_dirty_nodes_v1(
  p_nodes jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_node jsonb;
  v_scope jsonb;
  v_change_set_id uuid;
  v_workspace_id uuid;
  v_business_entity_id uuid;
  v_change_set private.deterministic_change_sets;
  v_existing_dirty private.dependency_dirty_nodes;
  v_event_ids uuid[];
  v_changed integer := 0;
  v_row_count integer;
  v_dirty_count integer;
begin
  perform private.assert_deterministic_calculation_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or pg_catalog.jsonb_typeof(p_nodes) <> 'array'
    or pg_catalog.jsonb_array_length(p_nodes) not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'dependency_dirty_node_request_invalid';
  end if;

  for v_node in select value from pg_catalog.jsonb_array_elements(p_nodes)
  loop
    if not private.jsonb_has_exact_keys_v1(
      v_node,
      array[
        'contractVersion',
        'workspaceId',
        'businessEntityId',
        'nodeKey',
        'nodeKind',
        'nodeIdentityFingerprint',
        'scope',
        'causeCount',
        'boundedCauseContributionEventIds',
        'causeFingerprint',
        'dependencyDepth',
        'changeSetId'
      ]
    )
      or pg_catalog.jsonb_typeof(v_node -> 'contractVersion') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'workspaceId') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'businessEntityId') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'nodeKey') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'nodeKind') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'nodeIdentityFingerprint') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'scope') <> 'object'
      or pg_catalog.jsonb_typeof(v_node -> 'causeCount') <> 'number'
      or (v_node ->> 'causeCount') !~ '^[1-9][0-9]*$'
      or pg_catalog.jsonb_typeof(v_node -> 'causeFingerprint') <> 'string'
      or pg_catalog.jsonb_typeof(v_node -> 'dependencyDepth') <> 'number'
      or (v_node ->> 'dependencyDepth') !~ '^(0|[1-9][0-9]*)$'
      or pg_catalog.jsonb_typeof(v_node -> 'changeSetId') <> 'string'
      or v_node ->> 'contractVersion' <> 'dependency_dirty_node_v1'
      or v_node ->> 'nodeKind' not in ('aggregate', 'kpi', 'downstream')
      or not private.is_bounded_identifier_v1(v_node ->> 'nodeKey')
      or not private.is_phase_3_registered_node_v1(
        v_node ->> 'nodeKey', v_node ->> 'nodeKind'
      )
      or not private.is_sha256_fingerprint_v1(v_node ->> 'nodeIdentityFingerprint')
      or not private.is_sha256_fingerprint_v1(v_node ->> 'causeFingerprint')
      or pg_catalog.jsonb_typeof(v_node -> 'boundedCauseContributionEventIds') <> 'array'
      or pg_catalog.jsonb_array_length(v_node -> 'boundedCauseContributionEventIds') > 32
      or (v_node ->> 'causeCount')::integer < 1
      or (v_node ->> 'dependencyDepth')::integer not between 0 and 256 then
      raise exception using errcode = '22023', message = 'dependency_dirty_node_payload_invalid';
    end if;

    v_scope := v_node -> 'scope';
    if not private.is_deterministic_node_scope_v1(v_scope) then
      raise exception using errcode = '22023', message = 'dependency_dirty_node_scope_invalid';
    end if;

    if v_change_set_id is null then
      v_change_set_id := (v_node ->> 'changeSetId')::uuid;
      v_workspace_id := (v_node ->> 'workspaceId')::uuid;
      v_business_entity_id := (v_node ->> 'businessEntityId')::uuid;
      select change_set.*
      into v_change_set
      from private.deterministic_change_sets as change_set
      where change_set.id = v_change_set_id
        and change_set.workspace_id = v_workspace_id
        and change_set.business_entity_id = v_business_entity_id
      for update;
      if not found or v_change_set.state <> 'running' then
        raise exception using errcode = '42501', message = 'dependency_dirty_node_change_set_denied';
      end if;
      if private.current_contribution_state_fingerprint_v1(
        v_workspace_id,
        v_business_entity_id
      ) <> v_change_set.input_contribution_fingerprint then
        raise exception using errcode = '40001', message = 'deterministic_contribution_state_stale';
      end if;
    elsif (v_node ->> 'changeSetId')::uuid <> v_change_set_id
      or (v_node ->> 'workspaceId')::uuid <> v_workspace_id
      or (v_node ->> 'businessEntityId')::uuid <> v_business_entity_id then
      raise exception using errcode = '42501', message = 'dependency_dirty_node_scope_substitution_denied';
    end if;

    if private.phase_3_node_identity_fingerprint_v1(
      v_workspace_id,
      v_business_entity_id,
      v_node ->> 'nodeKey',
      v_scope
    ) <> private.sha256_fingerprint_bytes_v1(
      v_node ->> 'nodeIdentityFingerprint'
    ) then
      raise exception using errcode = '22023', message = 'dependency_dirty_node_identity_invalid';
    end if;

    select coalesce(
      pg_catalog.array_agg(value::text::uuid order by value collate "C"),
      '{}'::uuid[]
    )
    into v_event_ids
    from pg_catalog.jsonb_array_elements_text(
      v_node -> 'boundedCauseContributionEventIds'
    ) as item(value);
    if not private.is_unique_uuid_array_v1(v_event_ids, 32)
      or exists (
        select 1
        from pg_catalog.unnest(v_event_ids) as cause(event_id)
        where not exists (
          select 1
          from private.fact_contribution_events as event
          where event.id = cause.event_id
            and event.workspace_id = v_workspace_id
            and event.business_entity_id = v_business_entity_id
        )
      ) then
      raise exception using errcode = '42501', message = 'dependency_dirty_node_contribution_substitution_denied';
    end if;

    insert into private.dependency_dirty_nodes (
      contract_version,
      workspace_id,
      business_entity_id,
      change_set_id,
      node_key,
      node_kind,
      node_identity_fingerprint,
      period_start,
      period_end,
      dimensions,
      accounting_basis,
      currency,
      cause_count,
      bounded_cause_contribution_event_ids,
      cause_fingerprint,
      dependency_depth
    ) values (
      'dependency_dirty_node_v1',
      v_workspace_id,
      v_business_entity_id,
      v_change_set_id,
      v_node ->> 'nodeKey',
      v_node ->> 'nodeKind',
      private.sha256_fingerprint_bytes_v1(v_node ->> 'nodeIdentityFingerprint'),
      (v_scope ->> 'periodStart')::date,
      (v_scope ->> 'periodEnd')::date,
      v_scope -> 'dimensions',
      v_scope ->> 'accountingBasis',
      v_scope ->> 'currency',
      (v_node ->> 'causeCount')::integer,
      v_event_ids,
      private.sha256_fingerprint_bytes_v1(v_node ->> 'causeFingerprint'),
      (v_node ->> 'dependencyDepth')::integer
    )
    on conflict (
      workspace_id, business_entity_id, change_set_id, node_identity_fingerprint
    ) do nothing;
    get diagnostics v_row_count = row_count;
    if v_row_count = 0 then
      select dirty.*
      into v_existing_dirty
      from private.dependency_dirty_nodes as dirty
      where dirty.workspace_id = v_workspace_id
        and dirty.business_entity_id = v_business_entity_id
        and dirty.change_set_id = v_change_set_id
        and dirty.node_identity_fingerprint = private.sha256_fingerprint_bytes_v1(
          v_node ->> 'nodeIdentityFingerprint'
        );
      if v_existing_dirty.id is null
        or v_existing_dirty.state <> 'dirty'
        or v_existing_dirty.node_key <> v_node ->> 'nodeKey'
        or v_existing_dirty.node_kind <> v_node ->> 'nodeKind'
        or v_existing_dirty.period_start is distinct from (v_scope ->> 'periodStart')::date
        or v_existing_dirty.period_end is distinct from (v_scope ->> 'periodEnd')::date
        or v_existing_dirty.dimensions <> v_scope -> 'dimensions'
        or v_existing_dirty.accounting_basis <> v_scope ->> 'accountingBasis'
        or v_existing_dirty.currency is distinct from v_scope ->> 'currency'
        or v_existing_dirty.cause_count <> (v_node ->> 'causeCount')::integer
        or v_existing_dirty.bounded_cause_contribution_event_ids <> v_event_ids
        or v_existing_dirty.cause_fingerprint <> private.sha256_fingerprint_bytes_v1(
          v_node ->> 'causeFingerprint'
        )
        or v_existing_dirty.dependency_depth <> (v_node ->> 'dependencyDepth')::integer then
        raise exception using errcode = '23505', message = 'dependency_dirty_node_cause_conflict';
      end if;
    end if;
    v_changed := v_changed + v_row_count;
  end loop;

  select count(*)::integer
  into v_dirty_count
  from private.dependency_dirty_nodes as node
  where node.workspace_id = v_workspace_id
    and node.business_entity_id = v_business_entity_id
    and node.change_set_id = v_change_set_id;

  if v_changed > 0 then
    update private.deterministic_change_sets
    set dirty_node_count = v_dirty_count,
        row_version = row_version + 1
    where id = v_change_set_id
      and workspace_id = v_workspace_id
      and business_entity_id = v_business_entity_id;
  end if;

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
    'dependency_dirty_nodes.coalesce',
    'succeeded',
    'deterministic_change_set',
    v_change_set_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'change_set_id', v_change_set_id,
      'dirty_node_count', v_dirty_count
    ),
    'security'
  );

  return pg_catalog.jsonb_build_object(
    'changeSetId', v_change_set_id,
    'dirtyNodeCount', v_dirty_count,
    'coalescedInputCount', pg_catalog.jsonb_array_length(p_nodes),
    'idempotent', v_changed = 0
  );
exception
  when invalid_text_representation or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'dependency_dirty_node_payload_invalid';
end;
$function$;

create or replace function public.finalize_deterministic_change_set_v1(
  p_result jsonb,
  p_request_id text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_change_set_id uuid;
  v_change_set private.deterministic_change_sets;
  v_latest private.deterministic_change_sets;
  v_state jsonb;
  v_scope jsonb;
  v_node_identity bytea;
  v_node_state_fingerprint bytea;
  v_existing private.deterministic_aggregate_states;
  v_matched boolean;
  v_published integer := 0;
  v_terminal_state text;
  v_result_state_fingerprint bytea;
  v_result_watermark bytea;
  v_incremental_fingerprint bytea;
  v_clean_fingerprint bytea;
  v_failure_fingerprint bytea;
begin
  perform private.assert_deterministic_calculation_authority_v1();
  if p_request_id is null or char_length(p_request_id) not between 1 and 200
    or p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or not private.jsonb_has_exact_keys_v1(
      p_result,
      array[
        'changeSetId',
        'expectedRowVersion',
        'inputContributionFingerprint',
        'resultWatermark',
        'resultStateFingerprint',
        'incrementalStateFingerprint',
        'cleanStateFingerprint',
        'equivalenceStatus',
        'failureCode',
        'failureFingerprint',
        'completedAt',
        'states'
      ]
    )
    or pg_catalog.jsonb_typeof(p_result -> 'states') <> 'array'
    or pg_catalog.jsonb_array_length(p_result -> 'states') > 10000
    or pg_catalog.jsonb_typeof(p_result -> 'expectedRowVersion') <> 'number'
    or (p_result ->> 'expectedRowVersion') !~ '^[1-9][0-9]*$'
    or pg_catalog.jsonb_typeof(p_result -> 'resultWatermark') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_result -> 'resultStateFingerprint') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_result -> 'failureCode') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_result -> 'failureFingerprint') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_result -> 'completedAt') <> 'string'
    or p_result ->> 'equivalenceStatus' not in ('matched', 'mismatched')
    or not private.is_sha256_fingerprint_v1(p_result ->> 'inputContributionFingerprint')
    or not private.is_sha256_fingerprint_v1(p_result ->> 'incrementalStateFingerprint')
    or not private.is_sha256_fingerprint_v1(p_result ->> 'cleanStateFingerprint')
    or (
      p_result -> 'resultWatermark' <> 'null'::jsonb
      and not private.is_sha256_fingerprint_v1(p_result ->> 'resultWatermark')
    )
    or (
      p_result -> 'resultStateFingerprint' <> 'null'::jsonb
      and not private.is_sha256_fingerprint_v1(p_result ->> 'resultStateFingerprint')
    )
    or (
      p_result -> 'failureCode' <> 'null'::jsonb
      and not private.is_bounded_identifier_v1(p_result ->> 'failureCode')
    )
    or (
      p_result -> 'failureFingerprint' <> 'null'::jsonb
      and not private.is_sha256_fingerprint_v1(p_result ->> 'failureFingerprint')
    ) then
    raise exception using errcode = '22023', message = 'deterministic_result_payload_invalid';
  end if;

  v_change_set_id := (p_result ->> 'changeSetId')::uuid;
  v_matched := p_result ->> 'equivalenceStatus' = 'matched';
  v_incremental_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_result ->> 'incrementalStateFingerprint'
  );
  v_clean_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_result ->> 'cleanStateFingerprint'
  );
  v_result_state_fingerprint := case when p_result -> 'resultStateFingerprint' = 'null'::jsonb
    then null else private.sha256_fingerprint_bytes_v1(p_result ->> 'resultStateFingerprint') end;
  v_result_watermark := case when p_result -> 'resultWatermark' = 'null'::jsonb
    then null else private.sha256_fingerprint_bytes_v1(p_result ->> 'resultWatermark') end;
  v_failure_fingerprint := case when p_result -> 'failureFingerprint' = 'null'::jsonb
    then null else private.sha256_fingerprint_bytes_v1(p_result ->> 'failureFingerprint') end;

  if v_matched then
    if v_incremental_fingerprint <> v_clean_fingerprint
      or v_result_state_fingerprint is null
      or v_result_state_fingerprint <> v_clean_fingerprint
      or v_result_watermark is null
      or p_result -> 'failureCode' <> 'null'::jsonb
      or p_result -> 'failureFingerprint' <> 'null'::jsonb then
      raise exception using errcode = '22023', message = 'deterministic_result_equivalence_invalid';
    end if;
  elsif v_incremental_fingerprint = v_clean_fingerprint
    or v_result_state_fingerprint is not null
    or v_result_watermark is not null
    or p_result ->> 'failureCode' <> 'deterministic_incremental_full_mismatch'
    or v_failure_fingerprint is null
    or pg_catalog.jsonb_array_length(p_result -> 'states') <> 0 then
    raise exception using errcode = '22023', message = 'deterministic_result_equivalence_invalid';
  end if;

  select change_set.*
  into v_change_set
  from private.deterministic_change_sets as change_set
  where change_set.id = v_change_set_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'deterministic_result_change_set_denied';
  end if;

  if v_change_set.state in ('completed', 'quarantined') then
    if v_change_set.incremental_state_fingerprint = v_incremental_fingerprint
      and v_change_set.clean_state_fingerprint = v_clean_fingerprint
      and v_change_set.result_state_fingerprint is not distinct from v_result_state_fingerprint
      and v_change_set.failure_fingerprint is not distinct from v_failure_fingerprint then
      return pg_catalog.jsonb_build_object(
        'changeSetId', v_change_set.id,
        'state', v_change_set.state,
        'publishedStateCount', 0,
        'rowVersion', v_change_set.row_version,
        'idempotent', true
      );
    end if;
    raise exception using errcode = '55000', message = 'deterministic_change_set_terminal';
  end if;
  if v_change_set.state <> 'running'
    or v_change_set.row_version <> (p_result ->> 'expectedRowVersion')::bigint
    or v_change_set.input_contribution_fingerprint <>
      private.sha256_fingerprint_bytes_v1(p_result ->> 'inputContributionFingerprint') then
    raise exception using errcode = '40001', message = 'deterministic_change_set_version_stale';
  end if;

  -- Prevent a Phase 2 contribution insert from racing the final fingerprint
  -- check and publication. The lock is held only for this short transaction.
  lock table private.fact_contribution_events in share mode;
  if private.current_contribution_state_fingerprint_v1(
    v_change_set.workspace_id,
    v_change_set.business_entity_id
  ) <> v_change_set.input_contribution_fingerprint then
    raise exception using errcode = '40001', message = 'deterministic_contribution_state_stale';
  end if;

  select change_set.*
  into v_latest
  from private.deterministic_change_sets as change_set
  where change_set.workspace_id = v_change_set.workspace_id
    and change_set.business_entity_id = v_change_set.business_entity_id
    and change_set.state = 'completed'
  order by change_set.completed_at desc, change_set.id desc
  limit 1;
  if v_latest.id is null then
    if v_change_set.prior_deterministic_watermark is not null
      or v_change_set.prior_state_fingerprint is not null then
      raise exception using errcode = '40001', message = 'deterministic_prior_watermark_stale';
    end if;
  elsif v_change_set.prior_deterministic_watermark is distinct from v_latest.result_deterministic_watermark
    or v_change_set.prior_state_fingerprint is distinct from v_latest.result_state_fingerprint then
    raise exception using errcode = '40001', message = 'deterministic_prior_watermark_stale';
  end if;

  if v_matched then
    if (
      select count(*) <> count(distinct state.value ->> 'nodeIdentityFingerprint')
      from pg_catalog.jsonb_array_elements(p_result -> 'states') as state(value)
    ) then
      raise exception using errcode = '22023', message = 'deterministic_state_identity_duplicate';
    end if;
    if private.phase_3_state_fingerprint_v1(p_result -> 'states') <>
      v_result_state_fingerprint then
      raise exception using errcode = '22023', message = 'deterministic_state_fingerprint_invalid';
    end if;
    if private.phase_3_watermark_fingerprint_v1(
      p_result ->> 'inputContributionFingerprint',
      v_change_set.dependency_registry_version,
      private.phase_3_fingerprint_text_v1(v_change_set.dependency_registry_fingerprint),
      v_change_set.calculation_policy_version,
      p_result ->> 'resultStateFingerprint'
    ) <> v_result_watermark then
      raise exception using errcode = '22023', message = 'deterministic_watermark_fingerprint_invalid';
    end if;
    if exists (
      select 1
      from private.deterministic_aggregate_states as existing_state
      where existing_state.workspace_id = v_change_set.workspace_id
        and existing_state.business_entity_id = v_change_set.business_entity_id
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_result -> 'states') as state(value)
          where private.sha256_fingerprint_bytes_v1(
            state.value ->> 'nodeIdentityFingerprint'
          ) = existing_state.node_identity_fingerprint
        )
    ) then
      raise exception using errcode = '55000', message = 'deterministic_state_snapshot_incomplete';
    end if;

    for v_state in select value from pg_catalog.jsonb_array_elements(p_result -> 'states')
    loop
      if not private.jsonb_has_exact_keys_v1(
        v_state,
        array[
          'contractVersion',
          'workspaceId',
          'businessEntityId',
          'nodeKey',
          'nodeKind',
          'nodeIdentityFingerprint',
          'scope',
          'valueCanonical',
          'supportingContributionCount',
          'sourceContributionAccumulator',
          'sourceContributionFingerprint',
          'registryVersion',
          'registryFingerprint',
          'calculationPolicyVersion',
          'calculationVersion'
        ]
      )
        or pg_catalog.jsonb_typeof(v_state -> 'contractVersion') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'workspaceId') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'businessEntityId') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'nodeKey') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'nodeKind') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'nodeIdentityFingerprint') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'scope') <> 'object'
        or pg_catalog.jsonb_typeof(v_state -> 'valueCanonical') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'supportingContributionCount') <> 'number'
        or (v_state ->> 'supportingContributionCount') !~ '^(0|[1-9][0-9]*)$'
        or pg_catalog.jsonb_typeof(v_state -> 'sourceContributionAccumulator') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'sourceContributionFingerprint') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'registryVersion') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'registryFingerprint') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'calculationPolicyVersion') <> 'string'
        or pg_catalog.jsonb_typeof(v_state -> 'calculationVersion') <> 'string'
        or v_state ->> 'contractVersion' <> 'deterministic_aggregate_state_v1'
        or (v_state ->> 'workspaceId')::uuid <> v_change_set.workspace_id
        or (v_state ->> 'businessEntityId')::uuid <> v_change_set.business_entity_id
        or v_state ->> 'nodeKind' not in ('aggregate', 'kpi')
        or not private.is_bounded_identifier_v1(v_state ->> 'nodeKey')
        or not private.is_phase_3_registered_node_v1(
          v_state ->> 'nodeKey', v_state ->> 'nodeKind'
        )
        or not private.is_bounded_identifier_v1(v_state ->> 'calculationVersion')
        or not private.is_sha256_fingerprint_v1(v_state ->> 'nodeIdentityFingerprint')
        or not private.is_sha256_fingerprint_v1(v_state ->> 'sourceContributionAccumulator')
        or not private.is_sha256_fingerprint_v1(v_state ->> 'sourceContributionFingerprint')
        or v_state ->> 'registryVersion' <> v_change_set.dependency_registry_version
        or private.sha256_fingerprint_bytes_v1(v_state ->> 'registryFingerprint') <>
          v_change_set.dependency_registry_fingerprint
        or v_state ->> 'calculationPolicyVersion' <> v_change_set.calculation_policy_version
        or not private.is_canonical_numeric_v1(
          v_state ->> 'valueCanonical', 30, 9, true, false, false
        )
        or (v_state ->> 'supportingContributionCount')::bigint < 0
        or not private.is_deterministic_node_scope_v1(v_state -> 'scope') then
        raise exception using errcode = '22023', message = 'deterministic_state_payload_invalid';
      end if;

      v_scope := v_state -> 'scope';
      v_node_identity := private.sha256_fingerprint_bytes_v1(
        v_state ->> 'nodeIdentityFingerprint'
      );
      if private.phase_3_node_identity_fingerprint_v1(
        v_change_set.workspace_id,
        v_change_set.business_entity_id,
        v_state ->> 'nodeKey',
        v_scope
      ) <> v_node_identity then
        raise exception using errcode = '22023', message = 'deterministic_state_identity_invalid';
      end if;
      v_node_state_fingerprint := private.phase_3_contract_fingerprint_v1(v_state);
      select state.*
      into v_existing
      from private.deterministic_aggregate_states as state
      where state.workspace_id = v_change_set.workspace_id
        and state.business_entity_id = v_change_set.business_entity_id
        and state.node_identity_fingerprint = v_node_identity;

      if not exists (
        select 1
        from private.dependency_dirty_nodes as dirty
        where dirty.workspace_id = v_change_set.workspace_id
          and dirty.business_entity_id = v_change_set.business_entity_id
          and dirty.change_set_id = v_change_set.id
          and dirty.node_identity_fingerprint = v_node_identity
          and dirty.node_key = v_state ->> 'nodeKey'
          and dirty.node_kind = v_state ->> 'nodeKind'
          and dirty.period_start is not distinct from (v_scope ->> 'periodStart')::date
          and dirty.period_end is not distinct from (v_scope ->> 'periodEnd')::date
          and dirty.dimensions = v_scope -> 'dimensions'
          and dirty.accounting_basis = v_scope ->> 'accountingBasis'
          and dirty.currency is not distinct from v_scope ->> 'currency'
      ) then
        if v_existing.id is null
          or v_existing.node_state_fingerprint <> v_node_state_fingerprint then
          raise exception using errcode = '55000', message = 'deterministic_unchanged_state_mismatch';
        end if;
        continue;
      end if;

      if v_existing.id is not null and (
        v_existing.node_key <> v_state ->> 'nodeKey'
        or v_existing.node_kind <> v_state ->> 'nodeKind'
        or v_existing.period_start is distinct from (v_scope ->> 'periodStart')::date
        or v_existing.period_end is distinct from (v_scope ->> 'periodEnd')::date
        or v_existing.dimensions <> v_scope -> 'dimensions'
        or v_existing.accounting_basis <> v_scope ->> 'accountingBasis'
        or v_existing.currency is distinct from v_scope ->> 'currency'
      ) then
        raise exception using errcode = '42501', message = 'deterministic_state_identity_substitution_denied';
      end if;

      insert into private.deterministic_aggregate_states (
        contract_version,
        workspace_id,
        business_entity_id,
        node_key,
        node_kind,
        node_identity_fingerprint,
        period_start,
        period_end,
        dimensions,
        accounting_basis,
        currency,
        value_canonical,
        value,
        supporting_contribution_count,
        source_contribution_accumulator,
        source_contribution_fingerprint,
        dependency_registry_version,
        dependency_registry_fingerprint,
        calculation_policy_version,
        calculation_version,
        node_state_fingerprint,
        last_change_set_id
      ) values (
        'deterministic_aggregate_state_v1',
        v_change_set.workspace_id,
        v_change_set.business_entity_id,
        v_state ->> 'nodeKey',
        v_state ->> 'nodeKind',
        v_node_identity,
        (v_scope ->> 'periodStart')::date,
        (v_scope ->> 'periodEnd')::date,
        v_scope -> 'dimensions',
        v_scope ->> 'accountingBasis',
        v_scope ->> 'currency',
        v_state ->> 'valueCanonical',
        (v_state ->> 'valueCanonical')::numeric(30,9),
        (v_state ->> 'supportingContributionCount')::bigint,
        private.sha256_fingerprint_bytes_v1(v_state ->> 'sourceContributionAccumulator'),
        private.sha256_fingerprint_bytes_v1(v_state ->> 'sourceContributionFingerprint'),
        v_state ->> 'registryVersion',
        private.sha256_fingerprint_bytes_v1(v_state ->> 'registryFingerprint'),
        v_state ->> 'calculationPolicyVersion',
        v_state ->> 'calculationVersion',
        v_node_state_fingerprint,
        v_change_set.id
      )
      on conflict (workspace_id, business_entity_id, node_identity_fingerprint)
      do update set
        value_canonical = excluded.value_canonical,
        value = excluded.value,
        supporting_contribution_count = excluded.supporting_contribution_count,
        source_contribution_accumulator = excluded.source_contribution_accumulator,
        source_contribution_fingerprint = excluded.source_contribution_fingerprint,
        dependency_registry_version = excluded.dependency_registry_version,
        dependency_registry_fingerprint = excluded.dependency_registry_fingerprint,
        calculation_policy_version = excluded.calculation_policy_version,
        calculation_version = excluded.calculation_version,
        node_state_fingerprint = excluded.node_state_fingerprint,
        last_change_set_id = excluded.last_change_set_id,
        row_version = deterministic_aggregate_states.row_version + 1,
        updated_at = transaction_timestamp();
      v_published := v_published + 1;
    end loop;

    if exists (
      select 1
      from private.dependency_dirty_nodes as dirty
      where dirty.workspace_id = v_change_set.workspace_id
        and dirty.business_entity_id = v_change_set.business_entity_id
        and dirty.change_set_id = v_change_set.id
        and dirty.node_kind in ('aggregate', 'kpi')
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_result -> 'states') as state(value)
          where private.sha256_fingerprint_bytes_v1(
            state.value ->> 'nodeIdentityFingerprint'
          ) = dirty.node_identity_fingerprint
        )
    ) then
      raise exception using errcode = '55000', message = 'deterministic_dirty_state_missing';
    end if;
  elsif private.phase_3_failure_fingerprint_v1(
    private.phase_3_fingerprint_text_v1(v_change_set.change_set_fingerprint),
    p_result ->> 'incrementalStateFingerprint',
    p_result ->> 'cleanStateFingerprint'
  ) <> v_failure_fingerprint then
    raise exception using errcode = '22023', message = 'deterministic_failure_fingerprint_invalid';
  end if;

  v_terminal_state := case when v_matched then 'completed' else 'quarantined' end;
  update private.dependency_dirty_nodes
  set state = v_terminal_state,
      row_version = row_version + 1,
      updated_at = transaction_timestamp()
  where workspace_id = v_change_set.workspace_id
    and business_entity_id = v_change_set.business_entity_id
    and change_set_id = v_change_set.id
    and state = 'dirty';

  update private.deterministic_change_sets
  set state = v_terminal_state,
      completed_node_count = dirty_node_count,
      result_deterministic_watermark = v_result_watermark,
      result_state_fingerprint = v_result_state_fingerprint,
      incremental_state_fingerprint = v_incremental_fingerprint,
      clean_state_fingerprint = v_clean_fingerprint,
      equivalence_status = p_result ->> 'equivalenceStatus',
      failure_code = p_result ->> 'failureCode',
      failure_fingerprint = v_failure_fingerprint,
      completed_at = (p_result ->> 'completedAt')::timestamptz,
      row_version = row_version + 1
  where id = v_change_set.id;

  select change_set.*
  into v_change_set
  from private.deterministic_change_sets as change_set
  where change_set.id = v_change_set_id;

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
    v_change_set.workspace_id,
    v_change_set.business_entity_id,
    'service',
    p_actor_id,
    'deterministic_change_set.finalize',
    case when v_matched then 'succeeded' else 'failed' end,
    'deterministic_change_set',
    v_change_set.id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'change_set_id', v_change_set.id,
      'dirty_node_count', v_change_set.dirty_node_count,
      'completed_node_count', v_change_set.completed_node_count,
      'equivalence_status', v_change_set.equivalence_status,
      'result_state_fingerprint', case when v_result_state_fingerprint is null then null
        else private.phase_3_fingerprint_text_v1(v_result_state_fingerprint) end
    ),
    'security'
  );

  return pg_catalog.jsonb_build_object(
    'changeSetId', v_change_set.id,
    'state', v_change_set.state,
    'publishedStateCount', v_published,
    'rowVersion', v_change_set.row_version,
    'idempotent', false
  );
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'deterministic_result_payload_invalid';
end;
$function$;

revoke all on function public.read_current_contribution_state_v1(uuid, uuid)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
grant execute on function public.read_current_contribution_state_v1(uuid, uuid)
  to deterministic_calculation_authority;

revoke all on function public.read_current_deterministic_state_v1(uuid, uuid)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
grant execute on function public.read_current_deterministic_state_v1(uuid, uuid)
  to deterministic_calculation_authority;

revoke all on function public.begin_deterministic_change_set_v1(jsonb, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
grant execute on function public.begin_deterministic_change_set_v1(jsonb, text, text)
  to deterministic_calculation_authority;

revoke all on function public.coalesce_dependency_dirty_nodes_v1(jsonb, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
grant execute on function public.coalesce_dependency_dirty_nodes_v1(jsonb, text, text)
  to deterministic_calculation_authority;

revoke all on function public.finalize_deterministic_change_set_v1(jsonb, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
grant execute on function public.finalize_deterministic_change_set_v1(jsonb, text, text)
  to deterministic_calculation_authority;

revoke all on function private.assert_deterministic_calculation_authority_v1()
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.current_contribution_state_fingerprint_v1(uuid, uuid)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.is_integration_audit_metadata_v3(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_fingerprint_text_v1(bytea)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_canonical_json_v1(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_contract_fingerprint_v1(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_node_identity_fingerprint_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_state_fingerprint_v1(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_watermark_fingerprint_v1(text, text, text, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.phase_3_failure_fingerprint_v1(text, text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.is_phase_3_registered_node_v1(text, text)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.is_unique_uuid_array_v1(uuid[], integer)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.is_deterministic_node_scope_v1(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.validate_deterministic_change_set_mutation_v1()
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.validate_dependency_dirty_node_mutation_v1()
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.validate_deterministic_aggregate_state_mutation_v1()
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;
revoke all on function private.validate_deterministic_change_set_payload_v1(jsonb)
  from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority;

commit;
