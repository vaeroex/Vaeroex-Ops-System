begin;

-- The hosted management connection is intentionally not a member of either
-- no-login authority role. Test-only membership remains transactional.
grant external_integrations_authority to current_user;
grant deterministic_calculation_authority to current_user;
grant usage on schema extensions to external_integrations_authority;
grant usage on schema extensions to deterministic_calculation_authority;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$function$;

create or replace function pg_temp.fingerprint(p_id uuid)
returns text
language sql
immutable
as $function$
  select 'sha256:' || replace(p_id::text, '-', '') || replace(p_id::text, '-', '');
$function$;

create or replace function pg_temp.decision(
  p_authority text default 'deterministic_policy',
  p_actor_id uuid default null,
  p_policy_version text default 'phase_3_reconciliation_v1'
)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'authority', p_authority,
    'policyVersion', case when p_authority = 'deterministic_policy' then p_policy_version else null end,
    'actorId', case when p_authority = 'deterministic_policy' then null else p_actor_id end,
    'decidedAt', '2026-08-21T17:00:00.000Z',
    'reasonCodes', jsonb_build_array('deterministic_reconciliation')
  );
$function$;

create or replace function pg_temp.source_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_actor_id uuid,
  p_version_id uuid,
  p_amount text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'external_source_record_version_v1',
    'id', p_version_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'connectionId', null,
    'immutableVersion', 1,
    'priorVersionId', null,
    'recordKind', 'manual_revenue_observation',
    'source', jsonb_build_object(
      'kind', 'manual',
      'actorId', p_actor_id,
      'entryReference', 'entry_' || replace(p_version_id::text, '-', '')
    ),
    'temporal', jsonb_build_object(
      'basis', 'event',
      'providerCreatedAt', null,
      'providerUpdatedAt', null,
      'observedAt', '2026-08-21T16:00:00.000Z',
      'synchronizedAt', '2026-08-21T16:00:01.000Z',
      'ingestedAt', '2026-08-21T16:00:02.000Z',
      'effectiveAt', '2026-08-20T19:00:00.000Z',
      'postingDate', '2026-08-20',
      'periodStart', null,
      'periodEnd', null,
      'sourceTimeZone', 'America/Los_Angeles'
    ),
    'accounting', jsonb_build_object('basis', 'accrual', 'currency', 'USD'),
    'normalizedSchemaVersion', 'revenue_observation_v1',
    'changeKind', 'created',
    'normalizedProjection', jsonb_build_object('amount', p_amount),
    'trust', 'untrusted_external_input',
    'validation', jsonb_build_object(
      'state', 'valid',
      'validatorVersion', 'phase_3_fixture_validator_v1',
      'issues', '[]'::jsonb
    ),
    'receivedAt', '2026-08-21T16:00:03.000Z',
    'sourceFingerprint', pg_temp.fingerprint(p_version_id)
  );
$function$;

create or replace function pg_temp.fact_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_version_id uuid,
  p_source_version_id uuid,
  p_fact_key text,
  p_amount text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'canonical_business_fact_version_v2',
    'id', p_version_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'immutableVersion', 1,
    'factKind', 'recognized_revenue',
    'factKey', p_fact_key,
    'dimensions', jsonb_build_array(
      jsonb_build_object('key', 'department', 'value', 'Operations')
    ),
    'temporal', jsonb_build_object(
      'effectiveAt', '2026-08-20T19:00:00.000Z',
      'postingDate', '2026-08-20',
      'periodStart', null,
      'periodEnd', null,
      'fiscalYear', 2026,
      'fiscalPeriod', 8,
      'sourceTimeZone', 'America/Los_Angeles',
      'closedPeriod', false
    ),
    'accounting', jsonb_build_object(
      'basis', 'accrual',
      'sourceCurrency', 'USD',
      'reportingCurrency', 'USD',
      'exchangeRate', null,
      'exchangeRateSource', null
    ),
    'value', jsonb_build_object('kind', 'money', 'amount', p_amount, 'currency', 'USD'),
    'reconciliationState', 'accepted',
    'validationState', 'valid',
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceRecordVersionId', p_source_version_id,
      'sourceFingerprint', pg_temp.fingerprint(p_source_version_id),
      'sourceRole', 'primary',
      'contributionWeight', '1'
    )),
    'decision', pg_temp.decision(),
    'normalizationVersion', 'recognized_revenue_normalization_v1',
    'transformationVersion', 'recognized_revenue_transformation_v1',
    'sourceObservedAt', '2026-08-21T16:00:00.000Z',
    'createdAt', '2026-08-21T16:01:01.000Z',
    'factFingerprint', pg_temp.fingerprint(p_version_id)
  );
$function$;

create or replace function pg_temp.commit_source(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_actor_id uuid,
  p_version_id uuid,
  p_amount text
)
returns uuid
language sql
as $function$
  select (
    public.commit_external_source_record_version_v1(
      pg_temp.fingerprint(p_version_id),
      pg_temp.source_payload(
        p_workspace_id,
        p_business_entity_id,
        p_actor_id,
        p_version_id,
        p_amount
      ),
      'source_' || replace(p_version_id::text, '-', ''),
      'phase_3_test_service'
    ) ->> 'sourceVersionId'
  )::uuid;
$function$;

create or replace function pg_temp.commit_fact(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_version_id uuid,
  p_source_version_id uuid,
  p_fact_key text,
  p_amount text
)
returns uuid
language sql
as $function$
  select (
    public.commit_canonical_business_fact_version_v2(
      pg_temp.fingerprint(p_version_id),
      pg_temp.fact_payload(
        p_workspace_id,
        p_business_entity_id,
        p_version_id,
        p_source_version_id,
        p_fact_key,
        p_amount
      ),
      'fact_' || replace(p_version_id::text, '-', ''),
      'phase_3_test_service'
    ) ->> 'factVersionId'
  )::uuid;
$function$;

create or replace function pg_temp.member(
  p_fact_version_id uuid,
  p_source_version_id uuid,
  p_economic_identity text,
  p_role text,
  p_rank integer,
  p_value text
)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'factVersionId', p_fact_version_id,
    'sourceRecordVersionId', p_source_version_id,
    'sourceFingerprint', pg_temp.fingerprint(p_source_version_id),
    'economicIdentityFingerprint', p_economic_identity,
    'memberRole', p_role,
    'authorityRank', p_rank,
    'additiveCandidate', p_role <> 'excluded',
    'canonicalValue', p_value
  );
$function$;

create or replace function pg_temp.case_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_policy_id uuid,
  p_winner uuid,
  p_members jsonb
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'reconciliation_case_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'sourceAuthorityPolicyVersionId', p_policy_id,
    'supersedesCaseId', null,
    'caseFingerprint', pg_temp.fingerprint(p_id),
    'evaluatedAt', '2026-08-21T17:10:00.000Z',
    'effectiveAt', '2026-08-20T19:00:00.000Z',
    'matchRuleVersion', 'deterministic_reconciliation_classifier_v1',
    'matchTier', 'exact_canonical_economic_identity',
    'classification', 'same_fact_represented_twice',
    'caseState', 'resolved',
    'winningFactVersionId', p_winner,
    'deterministicFeatures', jsonb_build_object(
      'sourceIdentityMatch', false,
      'explicitLineageMatch', false,
      'economicIdentityMatch', true,
      'valueMatch', true,
      'accountingBasisMatch', true,
      'currencyMatch', true,
      'periodMatch', true,
      'dimensionsMatch', true,
      'fuzzyProposalOnly', false
    ),
    'decision', pg_temp.decision(),
    'members', p_members
  );
$function$;

create or replace function pg_temp.family_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'contribution_family_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'familyKey', 'recognized_revenue_transactions',
    'immutableVersion', 1,
    'supersedesFamilyVersionId', null,
    'domainKey', 'posted_revenue',
    'measureKey', 'recognized_revenue',
    'aggregateKey', 'recognized_revenue_actual',
    'contributionMode', 'additive_transaction',
    'allowedFactKinds', jsonb_build_array('recognized_revenue'),
    'registryVersion', 'financial_contribution_registry_v1',
    'effectiveFrom', '2026-01-01T00:00:00.000Z',
    'decision', pg_temp.decision(),
    'familyFingerprint', pg_temp.fingerprint(p_id)
  );
$function$;

create or replace function pg_temp.event_payload(
  p_id uuid,
  p_fact_version_id uuid,
  p_contribution_identity text,
  p_economic_identity text,
  p_value text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'fact_contribution_event_v1',
    'id', p_id,
    'eventKind', 'establish',
    'factVersionId', p_fact_version_id,
    'targetContributionEventId', null,
    'contributionIdentityFingerprint', p_contribution_identity,
    'economicIdentityFingerprint', p_economic_identity,
    'effectiveAt', '2026-08-20T19:00:00.000Z',
    'periodStart', null,
    'periodEnd', null,
    'dimensions', jsonb_build_array(
      jsonb_build_object('key', 'department', 'value', 'Operations')
    ),
    'accountingBasis', 'accrual',
    'currency', 'USD',
    'valueCanonical', p_value,
    'registryVersion', 'financial_contribution_registry_v1',
    'eventFingerprint', pg_temp.fingerprint(p_id)
  );
$function$;

create or replace function pg_temp.batch_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_case_id uuid,
  p_policy_id uuid,
  p_family_id uuid,
  p_event jsonb
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'fact_contribution_batch_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'reconciliationCaseId', p_case_id,
    'sourceAuthorityPolicyVersionId', p_policy_id,
    'contributionFamilyVersionId', p_family_id,
    'batchFingerprint', pg_temp.fingerprint(p_id),
    'decision', pg_temp.decision(),
    'events', jsonb_build_array(p_event)
  );
$function$;

create or replace function pg_temp.contract_fingerprint(p_value jsonb)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select private.phase_3_fingerprint_text_v1(
    private.phase_3_contract_fingerprint_v1(p_value)
  );
$function$;

create or replace function pg_temp.scope()
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'periodStart', '2026-08-01',
    'periodEnd', '2026-08-31',
    'dimensions', '[]'::jsonb,
    'accountingBasis', 'accrual',
    'currency', 'USD'
  );
$function$;

create or replace function pg_temp.node_identity(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_node_key text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select private.phase_3_fingerprint_text_v1(
    private.phase_3_node_identity_fingerprint_v1(
      p_workspace_id,
      p_business_entity_id,
      p_node_key,
      pg_temp.scope()
    )
  );
$function$;

create or replace function pg_temp.xor_fingerprints(p_values text[])
returns text
language plpgsql
immutable
as $function$
declare
  v_result bytea := decode(repeat('0', 64), 'hex');
  v_value text;
  v_bytes bytea;
  v_index integer;
begin
  foreach v_value in array p_values
  loop
    v_bytes := decode(substring(v_value from 8), 'hex');
    for v_index in 0..31
    loop
      v_result := set_byte(
        v_result,
        v_index,
        get_byte(v_result, v_index) # get_byte(v_bytes, v_index)
      );
    end loop;
  end loop;
  return 'sha256:' || encode(v_result, 'hex');
end;
$function$;

create or replace function pg_temp.node_source_fingerprint(
  p_node_identity text,
  p_value text,
  p_count integer,
  p_accumulator text,
  p_dependencies jsonb
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select pg_temp.contract_fingerprint(jsonb_build_object(
    'fingerprintPurpose', 'deterministic_node_source',
    'fingerprintVersion', 'deterministic_node_source_v1',
    'payload', jsonb_build_object(
      'nodeIdentity', p_node_identity,
      'valueCanonical', p_value,
      'supportingContributionCount', p_count,
      'sourceContributionAccumulator', p_accumulator,
      'dependencyFingerprints', p_dependencies
    )
  ));
$function$;

create or replace function pg_temp.states(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_value text,
  p_event_fingerprints text[]
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
declare
  v_count integer := cardinality(p_event_fingerprints);
  v_accumulator text := pg_temp.xor_fingerprints(p_event_fingerprints);
  v_aggregate_identity text := pg_temp.node_identity(
    p_workspace_id, p_business_entity_id, 'recognized_revenue_month_total'
  );
  v_kpi_identity text := pg_temp.node_identity(
    p_workspace_id, p_business_entity_id, 'revenue'
  );
  v_aggregate_source text;
  v_kpi_source text;
begin
  v_aggregate_source := pg_temp.node_source_fingerprint(
    v_aggregate_identity,
    p_value,
    v_count,
    v_accumulator,
    '[]'::jsonb
  );
  v_kpi_source := pg_temp.node_source_fingerprint(
    v_kpi_identity,
    p_value,
    v_count,
    v_accumulator,
    jsonb_build_array(v_aggregate_source)
  );
  return jsonb_build_array(
    jsonb_build_object(
      'contractVersion', 'deterministic_aggregate_state_v1',
      'workspaceId', p_workspace_id,
      'businessEntityId', p_business_entity_id,
      'nodeKey', 'recognized_revenue_month_total',
      'nodeKind', 'aggregate',
      'nodeIdentityFingerprint', v_aggregate_identity,
      'scope', pg_temp.scope(),
      'valueCanonical', p_value,
      'supportingContributionCount', v_count,
      'sourceContributionAccumulator', v_accumulator,
      'sourceContributionFingerprint', v_aggregate_source,
      'registryVersion', 'vaeroex_deterministic_dependencies_v1',
      'registryFingerprint', 'sha256:fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5',
      'calculationPolicyVersion', 'deterministic_calculation_policy_v1',
      'calculationVersion', 'recognized_revenue_month_total_v1'
    ),
    jsonb_build_object(
      'contractVersion', 'deterministic_aggregate_state_v1',
      'workspaceId', p_workspace_id,
      'businessEntityId', p_business_entity_id,
      'nodeKey', 'revenue',
      'nodeKind', 'kpi',
      'nodeIdentityFingerprint', v_kpi_identity,
      'scope', pg_temp.scope(),
      'valueCanonical', p_value,
      'supportingContributionCount', v_count,
      'sourceContributionAccumulator', v_accumulator,
      'sourceContributionFingerprint', v_kpi_source,
      'registryVersion', 'vaeroex_deterministic_dependencies_v1',
      'registryFingerprint', 'sha256:fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5',
      'calculationPolicyVersion', 'deterministic_calculation_policy_v1',
      'calculationVersion', 'revenue_kpi_v1'
    )
  );
end;
$function$;

create or replace function pg_temp.current_input_fingerprint(
  p_workspace_id uuid,
  p_business_entity_id uuid
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select private.phase_3_fingerprint_text_v1(
    private.current_contribution_state_fingerprint_v1(
      p_workspace_id, p_business_entity_id
    )
  );
$function$;

create or replace function pg_temp.change_set_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_execution_mode text,
  p_prior_watermark text,
  p_prior_state_fingerprint text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select jsonb_build_object(
    'contractVersion', 'deterministic_change_set_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'executionMode', p_execution_mode,
    'inputContributionFingerprint', pg_temp.current_input_fingerprint(
      p_workspace_id, p_business_entity_id
    ),
    'dependencyRegistryVersion', 'vaeroex_deterministic_dependencies_v1',
    'dependencyRegistryFingerprint', 'sha256:fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5',
    'calculationPolicyVersion', 'deterministic_calculation_policy_v1',
    'priorDeterministicWatermark', p_prior_watermark,
    'priorStateFingerprint', p_prior_state_fingerprint,
    'changeSetFingerprint', pg_temp.fingerprint(p_id),
    'requestedAt', '2026-08-21T17:20:00.000Z'
  );
$function$;

create or replace function pg_temp.dirty_nodes(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_change_set_id uuid,
  p_event_id uuid
)
returns jsonb
language sql
immutable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
  select jsonb_agg(
    jsonb_build_object(
      'contractVersion', 'dependency_dirty_node_v1',
      'workspaceId', p_workspace_id,
      'businessEntityId', p_business_entity_id,
      'nodeKey', node.node_key,
      'nodeKind', node.node_kind,
      'nodeIdentityFingerprint', pg_temp.node_identity(
        p_workspace_id, p_business_entity_id, node.node_key
      ),
      'scope', pg_temp.scope(),
      'causeCount', 1,
      'boundedCauseContributionEventIds', jsonb_build_array(p_event_id),
      'causeFingerprint', pg_temp.contract_fingerprint(jsonb_build_object(
        'changeSetId', p_change_set_id,
        'nodeKey', node.node_key,
        'eventId', p_event_id
      )),
      'dependencyDepth', node.dependency_depth,
      'changeSetId', p_change_set_id
    ) order by node.dependency_depth, node.node_key
  )
  from (values
    ('recognized_revenue_month_total', 'aggregate', 0),
    ('revenue', 'kpi', 1),
    ('business_health_revenue_invalidation', 'downstream', 2),
    ('deterministic_revenue_opportunity_invalidation', 'downstream', 2),
    ('deterministic_revenue_risk_invalidation', 'downstream', 2),
    ('snapshot_revenue_invalidation', 'downstream', 3)
  ) as node(node_key, node_kind, dependency_depth);
$function$;

create or replace function pg_temp.matched_result(
  p_change_set_id uuid,
  p_states jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
declare
  v_change_set private.deterministic_change_sets;
  v_state_fingerprint text;
  v_watermark text;
begin
  select change_set.* into strict v_change_set
  from private.deterministic_change_sets as change_set
  where change_set.id = p_change_set_id;
  v_state_fingerprint := private.phase_3_fingerprint_text_v1(
    private.phase_3_state_fingerprint_v1(p_states)
  );
  v_watermark := private.phase_3_fingerprint_text_v1(
    private.phase_3_watermark_fingerprint_v1(
      private.phase_3_fingerprint_text_v1(v_change_set.input_contribution_fingerprint),
      v_change_set.dependency_registry_version,
      private.phase_3_fingerprint_text_v1(v_change_set.dependency_registry_fingerprint),
      v_change_set.calculation_policy_version,
      v_state_fingerprint
    )
  );
  return jsonb_build_object(
    'changeSetId', p_change_set_id,
    'expectedRowVersion', v_change_set.row_version,
    'inputContributionFingerprint', private.phase_3_fingerprint_text_v1(
      v_change_set.input_contribution_fingerprint
    ),
    'resultWatermark', v_watermark,
    'resultStateFingerprint', v_state_fingerprint,
    'incrementalStateFingerprint', v_state_fingerprint,
    'cleanStateFingerprint', v_state_fingerprint,
    'equivalenceStatus', 'matched',
    'failureCode', null,
    'failureFingerprint', null,
    'completedAt', '2026-08-21T17:30:00.000Z',
    'states', p_states
  );
end;
$function$;

create or replace function pg_temp.mismatched_result(p_change_set_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp, private, public
as $function$
declare
  v_change_set private.deterministic_change_sets;
  v_incremental text := 'sha256:' || repeat('a', 64);
  v_clean text := 'sha256:' || repeat('b', 64);
  v_failure text;
begin
  select change_set.* into strict v_change_set
  from private.deterministic_change_sets as change_set
  where change_set.id = p_change_set_id;
  v_failure := private.phase_3_fingerprint_text_v1(
    private.phase_3_failure_fingerprint_v1(
      private.phase_3_fingerprint_text_v1(v_change_set.change_set_fingerprint),
      v_incremental,
      v_clean
    )
  );
  return jsonb_build_object(
    'changeSetId', p_change_set_id,
    'expectedRowVersion', v_change_set.row_version,
    'inputContributionFingerprint', private.phase_3_fingerprint_text_v1(
      v_change_set.input_contribution_fingerprint
    ),
    'resultWatermark', null,
    'resultStateFingerprint', null,
    'incrementalStateFingerprint', v_incremental,
    'cleanStateFingerprint', v_clean,
    'equivalenceStatus', 'mismatched',
    'failureCode', 'deterministic_incremental_full_mismatch',
    'failureFingerprint', v_failure,
    'completedAt', '2026-08-21T17:40:00.000Z',
    'states', '[]'::jsonb
  );
end;
$function$;

create or replace function pg_temp.state_value(p_snapshot jsonb, p_node_key text)
returns text
language sql
immutable
as $function$
  select state.value ->> 'valueCanonical'
  from jsonb_array_elements(p_snapshot -> 'states') as state(value)
  where state.value ->> 'nodeKey' = p_node_key;
$function$;

insert into public.profiles (id, email, full_name) values
  ('a7300000-0000-4000-8000-000000000001', 'phase3-owner@example.test', 'Phase 3 Owner'),
  ('a7300000-0000-4000-8000-000000000002', 'phase3-manager@example.test', 'Phase 3 Manager'),
  ('a7300000-0000-4000-8000-000000000003', 'phase3-other@example.test', 'Phase 3 Other');

insert into public.workspaces (id, name, created_by) values
  ('b7300000-0000-4000-8000-000000000001', 'Phase 3 Workspace A', 'a7300000-0000-4000-8000-000000000001'),
  ('b7300000-0000-4000-8000-000000000002', 'Phase 3 Workspace B', 'a7300000-0000-4000-8000-000000000003');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c7300000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c7300000-0000-4000-8000-000000000002', 'b7300000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('c7300000-0000-4000-8000-000000000003', 'b7300000-0000-4000-8000-000000000002', 'a7300000-0000-4000-8000-000000000003', 'owner', 'active');

insert into public.business_entities (
  id, workspace_id, entity_key, display_name, base_currency, timezone, created_by, updated_by
) values
  ('d7300000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000001', 'primary_company', 'Primary Company', 'USD', 'America/Los_Angeles', 'a7300000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001'),
  ('d7300000-0000-4000-8000-000000000002', 'b7300000-0000-4000-8000-000000000001', 'division_b', 'Division B', 'USD', 'America/Los_Angeles', 'a7300000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001'),
  ('d7300000-0000-4000-8000-000000000003', 'b7300000-0000-4000-8000-000000000002', 'other_company', 'Other Company', 'USD', 'UTC', 'a7300000-0000-4000-8000-000000000003', 'a7300000-0000-4000-8000-000000000003');

select is(
  (select count(*)::integer
   from pg_catalog.pg_class as relation
   join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname = any(array[
       'deterministic_change_sets',
       'deterministic_aggregate_states',
       'dependency_dirty_nodes'
     ])),
  3,
  'Phase 3 introduces exactly three private persistence tables'
);
select is(
  (select count(*)::integer
   from pg_catalog.pg_class as relation
   join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'private'
     and relation.relname = any(array[
       'deterministic_change_sets',
       'deterministic_aggregate_states',
       'dependency_dirty_nodes'
     ])
     and relation.relrowsecurity
     and relation.relforcerowsecurity),
  3,
  'all Phase 3 persistence tables use forced RLS'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'private'
     and tablename = any(array[
       'deterministic_change_sets',
       'deterministic_aggregate_states',
       'dependency_dirty_nodes'
     ])),
  0,
  'private Phase 3 tables expose no policy path'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'deterministic_calculation_authority'
      and not rolcanlogin
      and not rolinherit
      and not rolsuper
      and not rolbypassrls
  ),
  'the deterministic authority is a non-login, no-inherit, non-bypass role'
);
select ok(
  not pg_catalog.pg_has_role('anon', 'deterministic_calculation_authority', 'MEMBER')
  and not pg_catalog.pg_has_role('authenticated', 'deterministic_calculation_authority', 'MEMBER')
  and not pg_catalog.pg_has_role('service_role', 'deterministic_calculation_authority', 'MEMBER')
  and not pg_catalog.pg_has_role('external_integrations_authority', 'deterministic_calculation_authority', 'MEMBER'),
  'no broad API or integration authority inherits deterministic authority'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('service_role', 'private', 'USAGE')
  and not has_schema_privilege('external_integrations_authority', 'private', 'USAGE')
  and not has_schema_privilege('deterministic_calculation_authority', 'private', 'USAGE'),
  'no runtime role receives private-schema usage'
);
select ok(
  not has_table_privilege('anon', 'private.deterministic_aggregate_states', 'SELECT')
  and not has_table_privilege('authenticated', 'private.deterministic_aggregate_states', 'SELECT')
  and not has_table_privilege('service_role', 'private.deterministic_aggregate_states', 'INSERT')
  and not has_table_privilege('external_integrations_authority', 'private.deterministic_change_sets', 'INSERT')
  and not has_table_privilege('deterministic_calculation_authority', 'private.dependency_dirty_nodes', 'INSERT'),
  'anonymous, members, server, integration, and deterministic roles have no direct table authority'
);
select ok(
  has_function_privilege('deterministic_calculation_authority', 'public.read_current_contribution_state_v1(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('deterministic_calculation_authority', 'public.begin_deterministic_change_set_v1(jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('deterministic_calculation_authority', 'public.coalesce_dependency_dirty_nodes_v1(jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('deterministic_calculation_authority', 'public.finalize_deterministic_change_set_v1(jsonb,text,text)', 'EXECUTE'),
  'only the narrow authority receives the checked deterministic RPCs'
);
select ok(
  not has_function_privilege('service_role', 'public.begin_deterministic_change_set_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('external_integrations_authority', 'public.begin_deterministic_change_set_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.read_current_deterministic_state_v1(uuid,uuid)', 'EXECUTE'),
  'broad server, integration, and workspace-member roles cannot invoke Phase 3 RPCs'
);

set local role external_integrations_authority;
select public.commit_source_authority_policy_version_v1(
  jsonb_build_object(
    'contractVersion', 'source_authority_policy_v1',
    'id', 'e7300000-0000-4000-8000-000000000001',
    'workspaceId', 'b7300000-0000-4000-8000-000000000001',
    'businessEntityId', 'd7300000-0000-4000-8000-000000000001',
    'domainKey', 'posted_revenue',
    'policyKey', 'posted_revenue_authority',
    'immutableVersion', 1,
    'supersedesPolicyVersionId', null,
    'effectiveFrom', '2026-01-01T00:00:00.000Z',
    'effectiveThrough', null,
    'conflictBehavior', 'hold_all',
    'fallbackMode', 'manual_upload_when_unowned',
    'rules', jsonb_build_array(
      jsonb_build_object(
        'sourceKind', 'manual',
        'providerKey', null,
        'sourceClass', 'manual_entry',
        'authorityRole', 'supplemental',
        'authorityRank', 1,
        'contributionMode', 'additive_transaction'
      )
    ),
    'decision', pg_temp.decision(
      'customer_authorized_user',
      'a7300000-0000-4000-8000-000000000001',
      null
    ),
    'policyFingerprint', pg_temp.fingerprint('e7300000-0000-4000-8000-000000000001')
  ),
  'phase3_policy_1',
  'a7300000-0000-4000-8000-000000000001'
);
select pg_temp.commit_source('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001','100000');
select pg_temp.commit_source('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000002','100000');
select pg_temp.commit_fact('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001','phase3_duplicate_a','100000');
select pg_temp.commit_fact('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000002','f7300000-0000-4000-8000-000000000002','phase3_duplicate_b','100000');
select public.commit_contribution_family_version_v1(
  pg_temp.family_payload(
    '27300000-0000-4000-8000-000000000001',
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ),
  'phase3_family_1',
  'phase_3_test_service'
);
select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37300000-0000-4000-8000-000000000001',
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    'e7300000-0000-4000-8000-000000000001',
    '17300000-0000-4000-8000-000000000002',
    jsonb_build_array(
      pg_temp.member('17300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,'100000'),
      pg_temp.member('17300000-0000-4000-8000-000000000002','f7300000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,'100000')
    )
  ),
  'phase3_case_1',
  'phase_3_test_service'
);
select public.commit_fact_contribution_batch_v1(
  pg_temp.batch_payload(
    '47300000-0000-4000-8000-000000000001',
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    '37300000-0000-4000-8000-000000000001',
    'e7300000-0000-4000-8000-000000000001',
    '27300000-0000-4000-8000-000000000001',
    pg_temp.event_payload(
      '57300000-0000-4000-8000-000000000001',
      '17300000-0000-4000-8000-000000000002',
      'sha256:' || repeat('b',64),
      'sha256:' || repeat('a',64),
      '100000'
    )
  ),
  'phase3_batch_1',
  'phase_3_test_service'
);
reset role;

set local role service_role;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_current_contribution_state_v1('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001')$$,
    '42501'
  ),
  'service_role cannot invoke deterministic reads'
);
reset role;

set local role authenticated;
select ok(
  pg_temp.raises_sqlstate($$select * from private.deterministic_aggregate_states$$, '42501'),
  'workspace viewers, staff, managers, admins, and owners cannot directly read private state'
);
reset role;

set local role deterministic_calculation_authority;
select is(
  jsonb_array_length(public.read_current_contribution_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  )),
  1,
  'the deterministic input boundary reads one accepted current contribution'
);
select is(
  public.read_current_contribution_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ) #>> '{0,valueCanonical}',
  '100000',
  'the input boundary preserves the canonical decimal string'
);
select is(
  public.read_current_contribution_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ) #>> '{0,contributionFamilyKey}',
  'recognized_revenue_transactions',
  'only the reconciled Phase 2 contribution family reaches Phase 3'
);
select ok(
  pg_temp.raises_sqlstate($$select * from private.deterministic_change_sets$$, '42501'),
  'the narrow authority cannot bypass checked RPCs with direct table access'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.read_current_contribution_state_v1('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000099')$$,
    '42501'
  ),
  'unknown Business Entity substitution is denied'
);

select is(
  public.begin_deterministic_change_set_v1(
    pg_temp.change_set_payload(
      '67300000-0000-4000-8000-000000000001',
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      'incremental',
      null,
      null
    ),
    'phase3_begin_1',
    'phase_3_test_service'
  ) ->> 'state',
  'running',
  'a current contribution fingerprint begins one bounded change set'
);
select ok(
  (public.begin_deterministic_change_set_v1(
    pg_temp.change_set_payload(
      '67300000-0000-4000-8000-000000000002',
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      'incremental',
      null,
      null
    ),
    'phase3_begin_replay',
    'phase_3_test_service'
  ) ->> 'idempotent')::boolean,
  'same-input incremental begin requests are idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.begin_deterministic_change_set_v1(%L::jsonb,'phase3_forged_registry','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.change_set_payload(
          '67300000-0000-4000-8000-000000000003',
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000001',
          'incremental', null, null
        ),
        '{dependencyRegistryFingerprint}',
        to_jsonb('sha256:' || repeat('9',64))
      )
    ),
    '22023'
  ),
  'forged dependency registries fail closed'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.begin_deterministic_change_set_v1(%L::jsonb,'phase3_cross_entity','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.change_set_payload(
          '67300000-0000-4000-8000-000000000004',
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000002',
          'incremental', null, null
        ),
        '{inputContributionFingerprint}',
        to_jsonb(pg_temp.current_input_fingerprint(
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000001'
        ))
      )
    ),
    '40001'
  ),
  'a contribution fingerprint from another Business Entity is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.begin_deterministic_change_set_v1(%L::jsonb,'phase3_bad_prior','phase_3_test_service')$$,
      pg_temp.change_set_payload(
        '67300000-0000-4000-8000-000000000005',
        'b7300000-0000-4000-8000-000000000002',
        'd7300000-0000-4000-8000-000000000003',
        'clean_full',
        'sha256:' || repeat('8',64),
        'sha256:' || repeat('7',64)
      )
    ),
    '40001'
  ),
  'current-watermark manipulation is rejected'
);
select is(
  public.begin_deterministic_change_set_v1(
    pg_temp.change_set_payload(
      '67300000-0000-4000-8000-000000000006',
      'b7300000-0000-4000-8000-000000000002',
      'd7300000-0000-4000-8000-000000000003',
      'incremental', null, null
    ),
    'phase3_begin_other',
    'phase_3_test_service'
  ) ->> 'state',
  'running',
  'a separate empty workspace has an isolated deterministic change set'
);

select is(
  (public.coalesce_dependency_dirty_nodes_v1(
    pg_temp.dirty_nodes(
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      '67300000-0000-4000-8000-000000000001',
      '57300000-0000-4000-8000-000000000001'
    ),
    'phase3_dirty_1',
    'phase_3_test_service'
  ) ->> 'dirtyNodeCount')::integer,
  6,
  'one accepted contribution coalesces to six registered dependency nodes'
);
select ok(
  (public.coalesce_dependency_dirty_nodes_v1(
    pg_temp.dirty_nodes(
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      '67300000-0000-4000-8000-000000000001',
      '57300000-0000-4000-8000-000000000001'
    ),
    'phase3_dirty_replay',
    'phase_3_test_service'
  ) ->> 'idempotent')::boolean,
  'duplicate dirty-node delivery is idempotent without replacing causal coverage'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.coalesce_dependency_dirty_nodes_v1(%L::jsonb,'phase3_dirty_forged','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.dirty_nodes(
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000001',
          '67300000-0000-4000-8000-000000000001',
          '57300000-0000-4000-8000-000000000001'
        ),
        '{0,nodeIdentityFingerprint}',
        to_jsonb('sha256:' || repeat('9',64))
      )
    ),
    '22023'
  ),
  'forged dirty-node identity is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.coalesce_dependency_dirty_nodes_v1(%L::jsonb,'phase3_dirty_scope','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.dirty_nodes(
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000001',
          '67300000-0000-4000-8000-000000000001',
          '57300000-0000-4000-8000-000000000001'
        ),
        '{0,workspaceId}',
        to_jsonb('b7300000-0000-4000-8000-000000000002'::text)
      )
    ),
    '42501'
  ),
  'dirty-node workspace substitution is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.coalesce_dependency_dirty_nodes_v1(%L::jsonb,'phase3_cross_workspace_event','phase_3_test_service')$$,
      pg_temp.dirty_nodes(
        'b7300000-0000-4000-8000-000000000002',
        'd7300000-0000-4000-8000-000000000003',
        '67300000-0000-4000-8000-000000000006',
        '57300000-0000-4000-8000-000000000001'
      )
    ),
    '42501'
  ),
  'an existing contribution event from another workspace is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.coalesce_dependency_dirty_nodes_v1(%L::jsonb,'phase3_cause_conflict','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.dirty_nodes(
          'b7300000-0000-4000-8000-000000000001',
          'd7300000-0000-4000-8000-000000000001',
          '67300000-0000-4000-8000-000000000001',
          '57300000-0000-4000-8000-000000000001'
        ),
        '{0,causeFingerprint}',
        to_jsonb('sha256:' || repeat('6',64))
      )
    ),
    '23505'
  ),
  'a conflicting dirty-node replay cannot erase prior causal evidence'
);

select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.finalize_deterministic_change_set_v1(%L::jsonb,'phase3_bad_state_hash','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.matched_result(
          '67300000-0000-4000-8000-000000000001',
          pg_temp.states(
            'b7300000-0000-4000-8000-000000000001',
            'd7300000-0000-4000-8000-000000000001',
            '100000',
            array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
          )
        ),
        '{states,0,valueCanonical}',
        to_jsonb('999999'::text)
      )
    ),
    '22023'
  ),
  'a malformed state snapshot cannot reuse a valid state hash'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.finalize_deterministic_change_set_v1(%L::jsonb,'phase3_bad_watermark','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.matched_result(
          '67300000-0000-4000-8000-000000000001',
          pg_temp.states(
            'b7300000-0000-4000-8000-000000000001',
            'd7300000-0000-4000-8000-000000000001',
            '100000',
            array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
          )
        ),
        '{resultWatermark}',
        to_jsonb('sha256:' || repeat('9',64))
      )
    ),
    '22023'
  ),
  'deterministic watermark tampering is rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.finalize_deterministic_change_set_v1(%L::jsonb,'phase3_bad_identity','phase_3_test_service')$$,
      pg_temp.matched_result(
        '67300000-0000-4000-8000-000000000001',
        jsonb_set(
          pg_temp.states(
            'b7300000-0000-4000-8000-000000000001',
            'd7300000-0000-4000-8000-000000000001',
            '100000',
            array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
          ),
          '{0,nodeIdentityFingerprint}',
          to_jsonb('sha256:' || repeat('9',64))
        )
      )
    ),
    '22023'
  ),
  'a forged node identity is rejected even with a self-consistent snapshot hash'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.finalize_deterministic_change_set_v1(%L::jsonb,'phase3_bad_decimal','phase_3_test_service')$$,
      pg_temp.matched_result(
        '67300000-0000-4000-8000-000000000001',
        jsonb_set(
          pg_temp.states(
            'b7300000-0000-4000-8000-000000000001',
            'd7300000-0000-4000-8000-000000000001',
            '100000',
            array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
          ),
          '{0,valueCanonical}',
          to_jsonb('01'::text)
        )
      )
    ),
    '22023'
  ),
  'non-canonical decimal snapshots are rejected before persistence'
);
select is(
  public.finalize_deterministic_change_set_v1(
    pg_temp.matched_result(
      '67300000-0000-4000-8000-000000000001',
      pg_temp.states(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001',
        '100000',
        array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
      )
    ),
    'phase3_finalize_1',
    'phase_3_test_service'
  ) ->> 'state',
  'completed',
  'matched incremental and clean fingerprints publish deterministic state'
);
select is(
  pg_temp.state_value(public.read_current_deterministic_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ), 'revenue'),
  '100000',
  'the current deterministic KPI state preserves exact accounting truth'
);
select is(
  jsonb_array_length(public.read_current_deterministic_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ) -> 'states'),
  2,
  'only aggregate and KPI state are published; downstream nodes remain invalidations'
);
select ok(
  (public.finalize_deterministic_change_set_v1(
    pg_temp.matched_result(
      '67300000-0000-4000-8000-000000000001',
      pg_temp.states(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001',
        '100000',
        array[pg_temp.fingerprint('57300000-0000-4000-8000-000000000001')]
      )
    ),
    'phase3_finalize_replay',
    'phase_3_test_service'
  ) ->> 'idempotent')::boolean,
  'repeated terminal finalization is idempotent and creates no duplicate state'
);
select ok(
  pg_temp.raises_sqlstate($$update private.deterministic_aggregate_states set value_canonical = '1'$$, '42501'),
  'the deterministic authority cannot directly mutate aggregate state'
);
reset role;

select ok(
  pg_temp.raises_sqlstate(
    $$update private.deterministic_change_sets set requested_by = 'forged', row_version = row_version + 1 where id = '67300000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'terminal deterministic change-set history is immutable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.dependency_dirty_nodes where change_set_id = '67300000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'completed dirty-node history cannot be deleted'
);

set local role external_integrations_authority;
select pg_temp.commit_source('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000003','50000');
select pg_temp.commit_source('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','a7300000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000004','50000');
select pg_temp.commit_fact('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000003','f7300000-0000-4000-8000-000000000003','phase3_second_duplicate_a','50000');
select pg_temp.commit_fact('b7300000-0000-4000-8000-000000000001','d7300000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000004','f7300000-0000-4000-8000-000000000004','phase3_second_duplicate_b','50000');
select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37300000-0000-4000-8000-000000000002',
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    'e7300000-0000-4000-8000-000000000001',
    '17300000-0000-4000-8000-000000000004',
    jsonb_build_array(
      pg_temp.member('17300000-0000-4000-8000-000000000003','f7300000-0000-4000-8000-000000000003','sha256:' || repeat('d',64),'excluded',2,'50000'),
      pg_temp.member('17300000-0000-4000-8000-000000000004','f7300000-0000-4000-8000-000000000004','sha256:' || repeat('d',64),'winner',1,'50000')
    )
  ),
  'phase3_case_2',
  'phase_3_test_service'
);
select public.commit_fact_contribution_batch_v1(
  pg_temp.batch_payload(
    '47300000-0000-4000-8000-000000000002',
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    '37300000-0000-4000-8000-000000000002',
    'e7300000-0000-4000-8000-000000000001',
    '27300000-0000-4000-8000-000000000001',
    pg_temp.event_payload(
      '57300000-0000-4000-8000-000000000002',
      '17300000-0000-4000-8000-000000000004',
      'sha256:' || repeat('c',64),
      'sha256:' || repeat('d',64),
      '50000'
    )
  ),
  'phase3_batch_2',
  'phase_3_test_service'
);
reset role;

set local role deterministic_calculation_authority;
select is(
  pg_temp.state_value(public.read_current_deterministic_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ), 'revenue'),
  '100000',
  'new accepted input does not mutate prior safe state before equivalence validation'
);
select is(
  public.begin_deterministic_change_set_v1(
    pg_temp.change_set_payload(
      '67300000-0000-4000-8000-000000000007',
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      'incremental',
      public.read_current_deterministic_state_v1(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001'
      ) #>> '{watermark,watermarkFingerprint}',
      public.read_current_deterministic_state_v1(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001'
      ) #>> '{watermark,stateFingerprint}'
    ),
    'phase3_begin_mismatch',
    'phase_3_test_service'
  ) ->> 'state',
  'running',
  'a new accepted contribution fingerprint creates a new incremental change set'
);
select public.coalesce_dependency_dirty_nodes_v1(
  pg_temp.dirty_nodes(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    '67300000-0000-4000-8000-000000000007',
    '57300000-0000-4000-8000-000000000002'
  ),
  'phase3_dirty_mismatch',
  'phase_3_test_service'
);
select is(
  public.finalize_deterministic_change_set_v1(
    pg_temp.mismatched_result('67300000-0000-4000-8000-000000000007'),
    'phase3_finalize_mismatch',
    'phase_3_test_service'
  ) ->> 'state',
  'quarantined',
  'incremental/full mismatch is quarantined instead of published'
);
select is(
  pg_temp.state_value(public.read_current_deterministic_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ), 'revenue'),
  '100000',
  'quarantine preserves the prior known-safe deterministic state'
);
select is(
  public.begin_deterministic_change_set_v1(
    pg_temp.change_set_payload(
      '67300000-0000-4000-8000-000000000008',
      'b7300000-0000-4000-8000-000000000001',
      'd7300000-0000-4000-8000-000000000001',
      'clean_full',
      public.read_current_deterministic_state_v1(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001'
      ) #>> '{watermark,watermarkFingerprint}',
      public.read_current_deterministic_state_v1(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001'
      ) #>> '{watermark,stateFingerprint}'
    ),
    'phase3_begin_clean_fallback',
    'phase_3_test_service'
  ) ->> 'state',
  'running',
  'quarantine evidence remains while a separate clean-full fallback is permitted'
);
select public.coalesce_dependency_dirty_nodes_v1(
  pg_temp.dirty_nodes(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001',
    '67300000-0000-4000-8000-000000000008',
    '57300000-0000-4000-8000-000000000002'
  ),
  'phase3_dirty_clean_fallback',
  'phase_3_test_service'
);
select is(
  public.finalize_deterministic_change_set_v1(
    pg_temp.matched_result(
      '67300000-0000-4000-8000-000000000008',
      pg_temp.states(
        'b7300000-0000-4000-8000-000000000001',
        'd7300000-0000-4000-8000-000000000001',
        '150000',
        array[
          pg_temp.fingerprint('57300000-0000-4000-8000-000000000001'),
          pg_temp.fingerprint('57300000-0000-4000-8000-000000000002')
        ]
      )
    ),
    'phase3_finalize_clean_fallback',
    'phase_3_test_service'
  ) ->> 'state',
  'completed',
  'a separately recorded clean-full equivalence run can restore progress'
);
select is(
  pg_temp.state_value(public.read_current_deterministic_state_v1(
    'b7300000-0000-4000-8000-000000000001',
    'd7300000-0000-4000-8000-000000000001'
  ), 'revenue'),
  '150000',
  'clean-full recovery publishes the exact current accepted total'
);
select ok(
  pg_temp.raises_sqlstate(
    format(
      $$select public.finalize_deterministic_change_set_v1(%L::jsonb,'phase3_stale_version','phase_3_test_service')$$,
      jsonb_set(
        pg_temp.matched_result(
          '67300000-0000-4000-8000-000000000006',
          '[]'::jsonb
        ),
        '{expectedRowVersion}',
        '999'::jsonb
      )
    ),
    '40001'
  ),
  'stale running change-set replay is rejected by row-version CAS'
);
reset role;

select is(
  (select state from private.deterministic_change_sets where id = '67300000-0000-4000-8000-000000000007'),
  'quarantined',
  'the mismatch remains immutable operator-visible history after clean recovery'
);
select is(
  (select count(*)::integer from private.deterministic_aggregate_states
   where workspace_id = 'b7300000-0000-4000-8000-000000000001'
     and business_entity_id = 'd7300000-0000-4000-8000-000000000001'),
  2,
  'incremental updates retain one current row per stable aggregate/KPI identity'
);
select is(
  (select count(*)::integer from private.integration_audit_events
   where action = 'deterministic_change_set.finalize'
     and workspace_id = 'b7300000-0000-4000-8000-000000000001'),
  3,
  'successful, quarantined, and clean-recovery finalizations are auditable'
);

select * from finish();
rollback;
