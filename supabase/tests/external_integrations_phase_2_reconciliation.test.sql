begin;

grant external_integrations_authority to current_user;
grant usage on schema extensions to external_integrations_authority;

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
  p_policy_version text default 'phase_2_reconciliation_v1'
)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'authority', p_authority,
    'policyVersion', case when p_authority = 'deterministic_policy' then p_policy_version else null end,
    'actorId', case when p_authority = 'deterministic_policy' then null else p_actor_id end,
    'decidedAt', '2026-08-20T20:10:00.000Z',
    'reasonCodes', jsonb_build_array('deterministic_reconciliation')
  );
$function$;

create or replace function pg_temp.source_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_actor_id uuid,
  p_version_id uuid,
  p_source_kind text,
  p_amount text default '100000',
  p_validation_state text default 'valid'
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
    'recordKind', case when p_source_kind = 'upload' then 'uploaded_revenue_observation' else 'manual_revenue_observation' end,
    'source', case
      when p_source_kind = 'upload' then jsonb_build_object(
        'kind', 'upload',
        'artifactFingerprint', pg_temp.fingerprint(p_version_id),
        'rowReference', 'row_' || replace(p_version_id::text, '-', '')
      )
      else jsonb_build_object(
        'kind', 'manual',
        'actorId', p_actor_id,
        'entryReference', 'entry_' || replace(p_version_id::text, '-', '')
      )
    end,
    'temporal', jsonb_build_object(
      'basis', 'event',
      'providerCreatedAt', null,
      'providerUpdatedAt', null,
      'observedAt', '2026-08-20T20:00:00.000Z',
      'synchronizedAt', '2026-08-20T20:00:01.000Z',
      'ingestedAt', '2026-08-20T20:00:02.000Z',
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
      'state', p_validation_state,
      'validatorVersion', 'phase_2_fixture_validator_v1',
      'issues', case when p_validation_state = 'valid' then '[]'::jsonb else jsonb_build_array(
        jsonb_build_object(
          'code', 'invalid_fixture',
          'severity', 'error',
          'field', null,
          'detail', 'Synthetic invalid source fixture'
        )
      ) end
    ),
    'receivedAt', '2026-08-20T20:00:03.000Z',
    'sourceFingerprint', pg_temp.fingerprint(p_version_id)
  );
$function$;

create or replace function pg_temp.fact_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_version_id uuid,
  p_source_version_id uuid,
  p_fact_key text,
  p_amount text default '100000',
  p_reconciliation_state text default 'accepted',
  p_validation_state text default 'valid',
  p_immutable_version bigint default 1,
  p_prior_version_id uuid default null
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'canonical_business_fact_version_v2',
    'id', p_version_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'immutableVersion', p_immutable_version,
    'factKind', 'recognized_revenue',
    'factKey', p_fact_key,
    'dimensions', jsonb_build_array(jsonb_build_object('key', 'department', 'value', 'Operations')),
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
    'value', case when p_reconciliation_state = 'tombstone' then null else
      jsonb_build_object('kind', 'money', 'amount', p_amount, 'currency', 'USD') end,
    'reconciliationState', p_reconciliation_state,
    'validationState', p_validation_state,
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceRecordVersionId', p_source_version_id,
      'sourceFingerprint', pg_temp.fingerprint(p_source_version_id),
      'sourceRole', 'primary',
      'contributionWeight', case when p_reconciliation_state = 'tombstone' then null else '1' end
    )),
    'decision', pg_temp.decision(),
    'normalizationVersion', 'recognized_revenue_normalization_v1',
    'transformationVersion', 'recognized_revenue_transformation_v1',
    'sourceObservedAt', '2026-08-20T20:00:00.000Z',
    'createdAt', '2026-08-20T20:01:01.000Z',
    'factFingerprint', pg_temp.fingerprint(p_version_id)
  );
$function$;

create or replace function pg_temp.commit_source(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_actor_id uuid,
  p_version_id uuid,
  p_source_kind text,
  p_amount text default '100000',
  p_validation_state text default 'valid'
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
        p_source_kind,
        p_amount,
        p_validation_state
      ),
      'source_' || replace(p_version_id::text, '-', ''),
      'phase_2_test_service'
    ) ->> 'sourceVersionId'
  )::uuid;
$function$;

create or replace function pg_temp.commit_fact(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_version_id uuid,
  p_source_version_id uuid,
  p_fact_key text,
  p_amount text default '100000',
  p_reconciliation_state text default 'accepted',
  p_validation_state text default 'valid',
  p_immutable_version bigint default 1,
  p_prior_version_id uuid default null
)
returns uuid
language sql
as $function$
  select (
    public.commit_canonical_business_fact_version_v2(
      pg_temp.fingerprint(
        coalesce(p_prior_version_id, p_version_id)
      ),
      pg_temp.fact_payload(
        p_workspace_id,
        p_business_entity_id,
        p_version_id,
        p_source_version_id,
        p_fact_key,
        p_amount,
        p_reconciliation_state,
        p_validation_state,
        p_immutable_version,
        p_prior_version_id
      ),
      'fact_' || replace(p_version_id::text, '-', ''),
      'phase_2_test_service'
    ) ->> 'factVersionId'
  )::uuid;
$function$;

create or replace function pg_temp.member(
  p_fact_version_id uuid,
  p_source_version_id uuid,
  p_economic_identity text,
  p_role text,
  p_rank integer,
  p_additive boolean,
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
    'additiveCandidate', p_additive,
    'canonicalValue', p_value
  );
$function$;

create or replace function pg_temp.features(
  p_exact boolean default true,
  p_value boolean default true,
  p_fuzzy boolean default false
)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'sourceIdentityMatch', false,
    'explicitLineageMatch', false,
    'economicIdentityMatch', p_exact,
    'valueMatch', p_value,
    'accountingBasisMatch', true,
    'currencyMatch', true,
    'periodMatch', true,
    'dimensionsMatch', true,
    'fuzzyProposalOnly', p_fuzzy
  );
$function$;

create or replace function pg_temp.case_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_policy_id uuid,
  p_classification text,
  p_state text,
  p_winner uuid,
  p_members jsonb,
  p_economic_match boolean default true,
  p_value_match boolean default true,
  p_fuzzy boolean default false,
  p_supersedes uuid default null,
  p_decision jsonb default pg_temp.decision()
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
    'supersedesCaseId', p_supersedes,
    'caseFingerprint', pg_temp.fingerprint(p_id),
    'evaluatedAt', '2026-08-20T20:10:00.000Z',
    'effectiveAt', '2026-08-20T19:00:00.000Z',
    'matchRuleVersion', 'deterministic_reconciliation_classifier_v1',
    'matchTier', case when p_fuzzy or not p_economic_match then 'ambiguous_review' else 'exact_canonical_economic_identity' end,
    'classification', p_classification,
    'caseState', p_state,
    'winningFactVersionId', p_winner,
    'deterministicFeatures', pg_temp.features(p_economic_match, p_value_match, p_fuzzy),
    'decision', p_decision,
    'members', p_members
  );
$function$;

create or replace function pg_temp.family_payload(
  p_id uuid,
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_family_key text,
  p_mode text
)
returns jsonb
language sql
as $function$
  select jsonb_build_object(
    'contractVersion', 'contribution_family_v1',
    'id', p_id,
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'familyKey', p_family_key,
    'immutableVersion', 1,
    'supersedesFamilyVersionId', null,
    'domainKey', 'posted_revenue',
    'measureKey', 'recognized_revenue',
    'aggregateKey', 'recognized_revenue_actual',
    'contributionMode', p_mode,
    'allowedFactKinds', jsonb_build_array('recognized_revenue'),
    'registryVersion', 'financial_contribution_registry_v1',
    'effectiveFrom', '2026-01-01T00:00:00.000Z',
    'decision', pg_temp.decision(),
    'familyFingerprint', pg_temp.fingerprint(p_id)
  );
$function$;

create or replace function pg_temp.event_payload(
  p_id uuid,
  p_kind text,
  p_fact_version_id uuid,
  p_target_event_id uuid,
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
    'eventKind', p_kind,
    'factVersionId', p_fact_version_id,
    'targetContributionEventId', p_target_event_id,
    'contributionIdentityFingerprint', p_contribution_identity,
    'economicIdentityFingerprint', p_economic_identity,
    'effectiveAt', '2026-08-20T19:00:00.000Z',
    'periodStart', null,
    'periodEnd', null,
    'dimensions', jsonb_build_array(jsonb_build_object('key', 'department', 'value', 'Operations')),
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
  p_events jsonb,
  p_decision jsonb default pg_temp.decision()
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
    'decision', p_decision,
    'events', p_events
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a7200000-0000-4000-8000-000000000001', 'phase2-owner@example.test', 'Phase 2 Owner'),
  ('a7200000-0000-4000-8000-000000000002', 'phase2-manager@example.test', 'Phase 2 Manager'),
  ('a7200000-0000-4000-8000-000000000003', 'phase2-staff@example.test', 'Phase 2 Staff'),
  ('a7200000-0000-4000-8000-000000000004', 'phase2-other@example.test', 'Phase 2 Other');

insert into public.workspaces (id, name, created_by) values
  ('b7200000-0000-4000-8000-000000000001', 'Phase 2 Workspace A', 'a7200000-0000-4000-8000-000000000001'),
  ('b7200000-0000-4000-8000-000000000002', 'Phase 2 Workspace B', 'a7200000-0000-4000-8000-000000000004');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c7200000-0000-4000-8000-000000000001', 'b7200000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c7200000-0000-4000-8000-000000000002', 'b7200000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('c7200000-0000-4000-8000-000000000003', 'b7200000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('c7200000-0000-4000-8000-000000000004', 'b7200000-0000-4000-8000-000000000002', 'a7200000-0000-4000-8000-000000000004', 'owner', 'active');

insert into public.business_entities (
  id, workspace_id, entity_key, display_name, base_currency, timezone, created_by, updated_by
) values
  ('d7200000-0000-4000-8000-000000000001', 'b7200000-0000-4000-8000-000000000001', 'primary_company', 'Primary Company', 'USD', 'America/Los_Angeles', 'a7200000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001'),
  ('d7200000-0000-4000-8000-000000000002', 'b7200000-0000-4000-8000-000000000002', 'other_company', 'Other Company', 'USD', 'UTC', 'a7200000-0000-4000-8000-000000000004', 'a7200000-0000-4000-8000-000000000004');

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = any(array[
      'source_authority_policy_versions', 'source_authority_policy_rules',
      'reconciliation_cases', 'reconciliation_case_members',
      'contribution_family_versions', 'fact_contribution_batches', 'fact_contribution_events'
    ])),
  7,
  'Phase 2 introduces exactly seven private authoritative tables'
);
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = any(array[
      'source_authority_policy_versions', 'source_authority_policy_rules',
      'reconciliation_cases', 'reconciliation_case_members',
      'contribution_family_versions', 'fact_contribution_batches', 'fact_contribution_events'
    ]) and c.relrowsecurity and c.relforcerowsecurity),
  7,
  'all Phase 2 authoritative tables use forced RLS'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'private' and tablename = any(array[
    'source_authority_policy_versions', 'source_authority_policy_rules',
    'reconciliation_cases', 'reconciliation_case_members',
    'contribution_family_versions', 'fact_contribution_batches', 'fact_contribution_events'
  ])),
  0,
  'private Phase 2 tables expose no RLS policy path'
);
select ok(
  not has_table_privilege('service_role', 'private.fact_contribution_events', 'SELECT')
  and not has_table_privilege('service_role', 'private.fact_contribution_events', 'INSERT')
  and not has_table_privilege('authenticated', 'private.reconciliation_cases', 'SELECT'),
  'client and broad server roles receive no direct Phase 2 table authority'
);
select ok(
  not has_function_privilege('service_role', 'public.commit_fact_contribution_batch_v1(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commit_reconciliation_case_v1(jsonb,text,text)', 'EXECUTE'),
  'service_role and authenticated cannot execute Phase 2 authority RPCs'
);
select ok(
  has_function_privilege('external_integrations_authority', 'public.commit_source_authority_policy_version_v1(jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('external_integrations_authority', 'public.commit_fact_contribution_batch_v1(jsonb,text,text)', 'EXECUTE'),
  'the no-login integration authority alone receives the checked RPCs'
);
select is(
  (select count(*)::integer from pg_trigger where not tgisinternal and tgname like 'reject_%_mutation_v1'
    and tgrelid = any(array[
      'private.source_authority_policy_versions'::regclass,
      'private.source_authority_policy_rules'::regclass,
      'private.reconciliation_cases'::regclass,
      'private.reconciliation_case_members'::regclass,
      'private.contribution_family_versions'::regclass,
      'private.fact_contribution_batches'::regclass,
      'private.fact_contribution_events'::regclass
    ])),
  7,
  'every Phase 2 table has an immutable update/delete trigger'
);

set local role external_integrations_authority;

select is(
  public.commit_source_authority_policy_version_v1(
    jsonb_build_object(
      'contractVersion', 'source_authority_policy_v1',
      'id', 'e7200000-0000-4000-8000-000000000001',
      'workspaceId', 'b7200000-0000-4000-8000-000000000001',
      'businessEntityId', 'd7200000-0000-4000-8000-000000000001',
      'domainKey', 'posted_revenue',
      'policyKey', 'posted_revenue_authority',
      'immutableVersion', 1,
      'supersedesPolicyVersionId', null,
      'effectiveFrom', '2026-01-01T00:00:00.000Z',
      'effectiveThrough', null,
      'conflictBehavior', 'hold_all',
      'fallbackMode', 'manual_upload_when_unowned',
      'rules', jsonb_build_array(
        jsonb_build_object('sourceKind', 'provider', 'providerKey', 'connected_ledger', 'sourceClass', 'transaction_detail', 'authorityRole', 'authoritative', 'authorityRank', 1, 'contributionMode', 'additive_transaction'),
        jsonb_build_object('sourceKind', 'upload', 'providerKey', null, 'sourceClass', 'upload_observation', 'authorityRole', 'supplemental', 'authorityRank', 2, 'contributionMode', 'additive_transaction'),
        jsonb_build_object('sourceKind', 'manual', 'providerKey', null, 'sourceClass', 'manual_entry', 'authorityRole', 'supplemental', 'authorityRank', 3, 'contributionMode', 'additive_transaction'),
        jsonb_build_object('sourceKind', 'provider', 'providerKey', 'connected_report', 'sourceClass', 'report_control', 'authorityRole', 'control_only', 'authorityRank', 4, 'contributionMode', 'non_additive_control')
      ),
      'decision', pg_temp.decision('customer_authorized_user', 'a7200000-0000-4000-8000-000000000001', null),
      'policyFingerprint', pg_temp.fingerprint('e7200000-0000-4000-8000-000000000001')
    ),
    'phase2_policy_1',
    'a7200000-0000-4000-8000-000000000001'
  ) ->> 'immutableVersion',
  '1',
  'an Owner records the first domain-specific authority policy version'
);
reset role;
select is(
  (select count(*)::integer from private.source_authority_policy_rules where policy_version_id = 'e7200000-0000-4000-8000-000000000001'),
  4,
  'the policy persists ranked additive, control, upload, and manual rules'
);
select results_eq(
  $$select authority_role, authority_rank from private.source_authority_policy_rules
    where policy_version_id = 'e7200000-0000-4000-8000-000000000001'
    order by authority_rank$$,
  $$values ('authoritative'::text, 1), ('supplemental'::text, 2), ('supplemental'::text, 3), ('control_only'::text, 4)$$,
  'authority role and rank are reconstructable rather than implied'
);
set local role external_integrations_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_source_authority_policy_version_v1(
      jsonb_set(
        (select jsonb_build_object(
          'contractVersion','source_authority_policy_v1','id','e7200000-0000-4000-8000-000000000009',
          'workspaceId','b7200000-0000-4000-8000-000000000001','businessEntityId','d7200000-0000-4000-8000-000000000001',
          'domainKey','pipeline','policyKey','forged','immutableVersion',1,'supersedesPolicyVersionId',null,
          'effectiveFrom','2026-01-01T00:00:00.000Z','effectiveThrough',null,'conflictBehavior','hold_all',
          'fallbackMode','review_required','rules',jsonb_build_array(jsonb_build_object(
            'sourceKind','manual','providerKey',null,'sourceClass','manual_entry','authorityRole','supplemental',
            'authorityRank',1,'contributionMode','additive_transaction')),
          'decision',pg_temp.decision('customer_authorized_user','a7200000-0000-4000-8000-000000000001',null),
          'policyFingerprint',pg_temp.fingerprint('e7200000-0000-4000-8000-000000000009'))),
        '{decision,actorId}', '"a7200000-0000-4000-8000-000000000003"'::jsonb
      ), 'forged_policy_actor', 'a7200000-0000-4000-8000-000000000001'
    )$$,
    '42501'
  ),
  'authority policy actors cannot be forged'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_source_authority_policy_version_v1(
      jsonb_build_object(
        'contractVersion','source_authority_policy_v1','id','e7200000-0000-4000-8000-000000000008',
        'workspaceId','b7200000-0000-4000-8000-000000000001','businessEntityId','d7200000-0000-4000-8000-000000000001',
        'domainKey','cash','policyKey','deterministic_forbidden','immutableVersion',1,'supersedesPolicyVersionId',null,
        'effectiveFrom','2026-01-01T00:00:00.000Z','effectiveThrough',null,'conflictBehavior','hold_all',
        'fallbackMode','review_required','rules',jsonb_build_array(jsonb_build_object(
          'sourceKind','manual','providerKey',null,'sourceClass','manual_entry','authorityRole','supplemental',
          'authorityRank',1,'contributionMode','additive_transaction')),
        'decision',pg_temp.decision(),'policyFingerprint',pg_temp.fingerprint('e7200000-0000-4000-8000-000000000008')
      ), 'deterministic_policy_change', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'domain authority changes require human or operator decision provenance'
);

select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','upload');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000002','manual');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000003','upload');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000004','manual');

select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','uploaded_revenue_100k');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','connected_shaped_revenue_100k');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000003','f7200000-0000-4000-8000-000000000003','independent_transaction_a');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000004','f7200000-0000-4000-8000-000000000004','independent_transaction_b');

select is(
  public.commit_contribution_family_version_v1(
    pg_temp.family_payload('27200000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','recognized_revenue_duplicates','additive_transaction'),
    'family_duplicate', 'phase_2_test_service'
  ) ->> 'immutableVersion',
  '1',
  'the additive contribution family is persisted through the checked RPC'
);
select public.commit_contribution_family_version_v1(
  pg_temp.family_payload('27200000-0000-4000-8000-000000000002','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','recognized_revenue_independent','additive_transaction'),
  'family_independent', 'phase_2_test_service'
);

select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000001',
      'b7200000-0000-4000-8000-000000000001',
      'd7200000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001',
      'same_fact_represented_twice', 'resolved', '17200000-0000-4000-8000-000000000002',
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
        pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
      )
    ),
    'case_duplicate', 'phase_2_test_service'
  ) ->> 'memberCount',
  '2',
  'uploaded and connected-shaped representations persist as one resolved case with two provenance members'
);
select is(
  public.commit_fact_contribution_batch_v1(
    pg_temp.batch_payload(
      '47200000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
      '37200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
      jsonb_build_array(pg_temp.event_payload(
        '57200000-0000-4000-8000-000000000001','establish','17200000-0000-4000-8000-000000000002',null,
        'sha256:' || repeat('b',64),'sha256:' || repeat('a',64),'100000'
      ))
    ),
    'batch_duplicate', 'phase_2_test_service'
  ) ->> 'eventCount',
  '1',
  'the duplicate case establishes exactly one additive event'
);
select is(
  public.read_fact_contribution_aggregate_v1(
    'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001'
  ) ->> 'currentTotal',
  '100000',
  'uploaded $100k plus the same connected-shaped $100k contributes exactly $100k'
);
reset role;
select is(
  (select count(*)::integer from private.reconciliation_case_members where reconciliation_case_id = '37200000-0000-4000-8000-000000000001'),
  2,
  'both source/fact provenance paths remain reconstructable after de-duplication'
);
set local role external_integrations_authority;
select is(
  (public.commit_fact_contribution_batch_v1(
    pg_temp.batch_payload(
      '47200000-0000-4000-8000-000000000001','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
      '37200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
      jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000001','establish','17200000-0000-4000-8000-000000000002',null,'sha256:' || repeat('b',64),'sha256:' || repeat('a',64),'100000'))
    ), 'batch_duplicate_retry', 'phase_2_test_service'
  ) ->> 'idempotent')::boolean,
  true,
  'whole-batch retries are idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      pg_temp.batch_payload(
        '47200000-0000-4000-8000-000000000009','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
        '37200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
        jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000009','establish','17200000-0000-4000-8000-000000000002',null,'sha256:' || repeat('9',64),'sha256:' || repeat('a',64),'100000'))
      ), 'duplicate_active', 'phase_2_test_service'
    )$$,
    '23505'
  ),
  'a concurrent or later duplicate active contribution is rejected'
);

select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000002','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
      'independent_facts','resolved',null,
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000003','f7200000-0000-4000-8000-000000000003','sha256:' || repeat('c',64),'candidate',2,true,'100000'),
        pg_temp.member('17200000-0000-4000-8000-000000000004','f7200000-0000-4000-8000-000000000004','sha256:' || repeat('d',64),'candidate',1,true,'100000')
      )
    ), 'case_independent', 'phase_2_test_service'
  ) ->> 'classification',
  'independent_facts',
  'two explicit independent facts persist without a synthetic winner'
);
select is(
  public.commit_fact_contribution_batch_v1(
    pg_temp.batch_payload(
      '47200000-0000-4000-8000-000000000002','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
      '37200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
      jsonb_build_array(
        pg_temp.event_payload('57200000-0000-4000-8000-000000000002','establish','17200000-0000-4000-8000-000000000003',null,'sha256:' || repeat('e',64),'sha256:' || repeat('c',64),'100000'),
        pg_temp.event_payload('57200000-0000-4000-8000-000000000003','establish','17200000-0000-4000-8000-000000000004',null,'sha256:' || repeat('f',64),'sha256:' || repeat('d',64),'100000')
      )
    ), 'batch_independent', 'phase_2_test_service'
  ) ->> 'eventCount',
  '2',
  'independent facts establish two distinct contribution identities'
);
select is(
  public.read_fact_contribution_aggregate_v1(
    'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002'
  ) ->> 'currentTotal',
  '200000',
  'two legitimate independent $100k facts remain additive at $200k'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000010','b7200000-0000-4000-8000-000000000002','d7200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001',
        'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
        )
      ), 'cross_workspace_case', 'phase_2_test_service'
    )$$,
    '42501'
  ),
  'cross-workspace authority-policy substitution is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000011','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
        'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000004','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
        )
      ), 'source_fact_substitution', 'phase_2_test_service'
    )$$,
    '42501'
  ),
  'a source/fact pair without an exact provenance edge is denied'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000012','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
        'ambiguous_review','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'candidate',2,false,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
        ), false, true, true
      ), 'fuzzy_numerical_truth', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'fuzzy proposals cannot establish numerical truth'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000013','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
        'conflicting_sources','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100001')
        ), true, false, false
      ), 'silent_conflict_sum', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'hold-all policy rejects a resolved conflicting-source winner'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      pg_temp.batch_payload(
        '47200000-0000-4000-8000-000000000010','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
        '37200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
        jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000010','establish','17200000-0000-4000-8000-000000000002',null,'sha256:' || repeat('1',64),'sha256:' || repeat('a',64),'100000')),
        pg_temp.decision('operator','a7200000-0000-4000-8000-000000000002',null)
      ), 'decision_case_mismatch', 'a7200000-0000-4000-8000-000000000002'
    )$$,
    '42501'
  ),
  'contribution decision authority cannot diverge from its reconciliation case'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      jsonb_set(
        pg_temp.batch_payload(
          '47200000-0000-4000-8000-000000000011','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
          '37200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
          jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000011','establish','17200000-0000-4000-8000-000000000003',null,'sha256:' || repeat('2',64),'sha256:' || repeat('c',64),'100000'))
        ),
        '{events,0,currency}', '"EUR"'::jsonb
      ), 'currency_substitution', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'currency mismatch is rejected before contribution persistence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      jsonb_set(
        pg_temp.batch_payload(
          '47200000-0000-4000-8000-000000000012','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
          '37200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
          jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000012','establish','17200000-0000-4000-8000-000000000003',null,'sha256:' || repeat('3',64),'sha256:' || repeat('c',64),'100000'))
        ),
        '{events,0,dimensions}', '[{"key":"department","value":"Sales"}]'::jsonb
      ), 'dimension_substitution', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'dimension mismatch is rejected before contribution persistence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      jsonb_set(
        pg_temp.batch_payload(
          '47200000-0000-4000-8000-000000000013','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
          '37200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
          jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000013','establish','17200000-0000-4000-8000-000000000003',null,'sha256:' || repeat('4',64),'sha256:' || repeat('c',64),'100000'))
        ),
        '{events,0,accountingBasis}', '"cash"'::jsonb
      ), 'accounting_basis_substitution', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'accounting-basis mismatch is rejected before contribution persistence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      jsonb_set(
        jsonb_set(
          pg_temp.batch_payload(
            '47200000-0000-4000-8000-000000000014','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
            '37200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000002',
            jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000014','establish','17200000-0000-4000-8000-000000000003',null,'sha256:' || repeat('5',64),'sha256:' || repeat('c',64),'100000'))
          ),
          '{events,0,periodStart}', '"2026-08-01"'::jsonb
        ),
        '{events,0,periodEnd}', '"2026-08-31"'::jsonb
      ), 'period_substitution', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'period mismatch is rejected before contribution persistence'
);

select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000005','manual');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000006','manual');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000007','manual');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000005','f7200000-0000-4000-8000-000000000005','invalid_revenue','100000','excluded_authority','invalid');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000006','f7200000-0000-4000-8000-000000000006','conflicted_revenue','100000','conflicted','valid');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000007','f7200000-0000-4000-8000-000000000007','tombstoned_revenue','0','tombstone','valid');

select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37200000-0000-4000-8000-000000000015','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
    'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000005',
    jsonb_build_array(
      pg_temp.member('17200000-0000-4000-8000-000000000005','f7200000-0000-4000-8000-000000000005','sha256:' || repeat('6',64),'winner',1,true,'100000'),
      pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('6',64),'excluded',2,true,'100000')
    )
  ), 'case_invalid_fact', 'phase_2_test_service'
);
select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37200000-0000-4000-8000-000000000016','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
    'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000006',
    jsonb_build_array(
      pg_temp.member('17200000-0000-4000-8000-000000000006','f7200000-0000-4000-8000-000000000006','sha256:' || repeat('7',64),'winner',1,true,'100000'),
      pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('7',64),'excluded',2,true,'100000')
    )
  ), 'case_conflicted_fact', 'phase_2_test_service'
);
select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37200000-0000-4000-8000-000000000017','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
    'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000007',
    jsonb_build_array(
      pg_temp.member('17200000-0000-4000-8000-000000000007','f7200000-0000-4000-8000-000000000007','sha256:' || repeat('8',64),'winner',1,true,null),
      pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('8',64),'excluded',2,true,'100000')
    )
  ), 'case_tombstone_fact', 'phase_2_test_service'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      pg_temp.batch_payload(
        '47200000-0000-4000-8000-000000000015','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000015','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
        jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000015','establish','17200000-0000-4000-8000-000000000005',null,'sha256:' || repeat('6',64),'sha256:' || repeat('6',64),'100000'))
      ), 'invalid_fact_contribution', 'phase_2_test_service'
    )$$,
    '55000'
  ),
  'invalid facts cannot establish numerical contributions'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      pg_temp.batch_payload(
        '47200000-0000-4000-8000-000000000016','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000016','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
        jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000016','establish','17200000-0000-4000-8000-000000000006',null,'sha256:' || repeat('7',64),'sha256:' || repeat('7',64),'100000'))
      ), 'conflicted_fact_contribution', 'phase_2_test_service'
    )$$,
    '55000'
  ),
  'conflicted facts cannot establish numerical contributions'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_fact_contribution_batch_v1(
      pg_temp.batch_payload(
        '47200000-0000-4000-8000-000000000017','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000017','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
        jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000017','establish','17200000-0000-4000-8000-000000000007',null,'sha256:' || repeat('8',64),'sha256:' || repeat('8',64),'0'))
      ), 'tombstone_fact_contribution', 'phase_2_test_service'
    )$$,
    '55000'
  ),
  'tombstoned facts cannot establish numerical contributions'
);

select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000008','upload');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000008','f7200000-0000-4000-8000-000000000008','report_control_revenue');
select public.commit_contribution_family_version_v1(
  pg_temp.family_payload('27200000-0000-4000-8000-000000000003','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','recognized_revenue_report_control','non_additive_control'),
  'family_control', 'phase_2_test_service'
);
select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000018','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
      'control_observation_vs_additive_detail','resolved','17200000-0000-4000-8000-000000000002',
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000'),
        pg_temp.member('17200000-0000-4000-8000-000000000008','f7200000-0000-4000-8000-000000000008','sha256:' || repeat('a',64),'control_observation',4,false,'100000')
      )
    ), 'case_control', 'phase_2_test_service'
  ) ->> 'classification',
  'control_observation_vs_additive_detail',
  'transaction detail and report totals persist as an explicit additive/control case'
);
select is(
  public.commit_fact_contribution_batch_v1(
    pg_temp.batch_payload(
      '47200000-0000-4000-8000-000000000018','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000018','e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000003',
      jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000018','control_observation','17200000-0000-4000-8000-000000000008',null,'sha256:' || repeat('8',64),'sha256:' || repeat('a',64),'100000'))
    ), 'batch_control', 'phase_2_test_service'
  ) ->> 'eventCount',
  '1',
  'a report total persists only as a control observation'
);
select is(
  public.read_fact_contribution_aggregate_v1(
    'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000003'
  ) ->> 'currentTotal',
  '0',
  'control observations never add to the numerical aggregate'
);

select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000019','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
        'manual_override','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
        )
      ), 'deterministic_manual_override', 'phase_2_test_service'
    )$$,
    '22023'
  ),
  'manual overrides cannot be attributed to deterministic policy'
);
select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000020','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
      'manual_override','resolved','17200000-0000-4000-8000-000000000002',
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
        pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
      ), true, true, false, null,
      pg_temp.decision('customer_authorized_user','a7200000-0000-4000-8000-000000000001',null)
    ), 'human_manual_override', 'a7200000-0000-4000-8000-000000000001'
  ) ->> 'classification',
  'manual_override',
  'an authorized human manual override retains actor-bound decision history'
);

select is(
  public.commit_source_authority_policy_version_v1(
    jsonb_build_object(
      'contractVersion','source_authority_policy_v1','id','e7200000-0000-4000-8000-000000000002',
      'workspaceId','b7200000-0000-4000-8000-000000000001','businessEntityId','d7200000-0000-4000-8000-000000000001',
      'domainKey','posted_revenue','policyKey','posted_revenue_authority','immutableVersion',2,
      'supersedesPolicyVersionId','e7200000-0000-4000-8000-000000000001',
      'effectiveFrom','2026-08-01T00:00:00.000Z','effectiveThrough',null,'conflictBehavior','allow_authoritative_and_flag',
      'fallbackMode','review_required','rules',jsonb_build_array(
        jsonb_build_object('sourceKind','provider','providerKey','connected_ledger','sourceClass','transaction_detail','authorityRole','supplemental','authorityRank',2,'contributionMode','additive_transaction'),
        jsonb_build_object('sourceKind','upload','providerKey',null,'sourceClass','upload_observation','authorityRole','authoritative','authorityRank',1,'contributionMode','additive_transaction')
      ),
      'decision',pg_temp.decision('customer_authorized_user','a7200000-0000-4000-8000-000000000001',null),
      'policyFingerprint',pg_temp.fingerprint('e7200000-0000-4000-8000-000000000002')
    ), 'policy_v2', 'a7200000-0000-4000-8000-000000000001'
  ) ->> 'immutableVersion',
  '2',
  'a later source-authority version supersedes the original without mutation'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_reconciliation_case_v1(
      pg_temp.case_payload(
        '37200000-0000-4000-8000-000000000021','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000001',
        'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000002',
        jsonb_build_array(
          pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'excluded',2,true,'100000'),
          pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'winner',1,true,'100000')
        )
      ), 'stale_policy_case', 'phase_2_test_service'
    )$$,
    '40001'
  ),
  'facts cannot be reprocessed under a stale effective authority policy'
);
select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000022','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000002',
      'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000001',
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000001','sha256:' || repeat('a',64),'winner',1,true,'100000'),
        pg_temp.member('17200000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002','sha256:' || repeat('a',64),'excluded',2,true,'100000')
      ), true, true, false, '37200000-0000-4000-8000-000000000001'
    ), 'policy_v2_reprocess', 'phase_2_test_service'
  ) ->> 'caseState',
  'resolved',
  'a later policy reprocesses the facts through a new immutable case'
);

select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000009','manual','90000');
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-00000000000a','upload','90000');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-000000000009','f7200000-0000-4000-8000-000000000009','corrected_transaction','90000');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-00000000000a','f7200000-0000-4000-8000-00000000000a','correction_corroboration','90000');
select public.commit_contribution_family_version_v1(
  pg_temp.family_payload('27200000-0000-4000-8000-000000000004','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','recognized_revenue_corrections','additive_transaction'),
  'family_correction', 'phase_2_test_service'
);
select public.commit_reconciliation_case_v1(
  pg_temp.case_payload(
    '37200000-0000-4000-8000-000000000023','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000002',
    'same_fact_represented_twice','resolved','17200000-0000-4000-8000-000000000009',
    jsonb_build_array(
      pg_temp.member('17200000-0000-4000-8000-000000000009','f7200000-0000-4000-8000-000000000009','sha256:' || repeat('b',64),'winner',1,true,'90000'),
      pg_temp.member('17200000-0000-4000-8000-00000000000a','f7200000-0000-4000-8000-00000000000a','sha256:' || repeat('b',64),'excluded',2,true,'90000')
    )
  ), 'case_correction_prior', 'phase_2_test_service'
);
select public.commit_fact_contribution_batch_v1(
  pg_temp.batch_payload(
    '47200000-0000-4000-8000-000000000023','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000023','e7200000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000004',
    jsonb_build_array(pg_temp.event_payload('57200000-0000-4000-8000-000000000023','establish','17200000-0000-4000-8000-000000000009',null,'sha256:' || repeat('c',64),'sha256:' || repeat('b',64),'90000'))
  ), 'batch_correction_prior', 'phase_2_test_service'
);
select pg_temp.commit_source('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','a7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-00000000000b','manual','100000');
select pg_temp.commit_fact('b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','17200000-0000-4000-8000-00000000000b','f7200000-0000-4000-8000-00000000000b','corrected_transaction','100000','accepted','valid',2,'17200000-0000-4000-8000-000000000009');
select is(
  public.commit_reconciliation_case_v1(
    pg_temp.case_payload(
      '37200000-0000-4000-8000-000000000024','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','e7200000-0000-4000-8000-000000000002',
      'source_correction','resolved','17200000-0000-4000-8000-00000000000b',
      jsonb_build_array(
        pg_temp.member('17200000-0000-4000-8000-000000000009','f7200000-0000-4000-8000-000000000009','sha256:' || repeat('b',64),'correction_prior',1,true,'90000'),
        pg_temp.member('17200000-0000-4000-8000-00000000000b','f7200000-0000-4000-8000-00000000000b','sha256:' || repeat('b',64),'winner',1,true,'100000')
      ), true, false, false, '37200000-0000-4000-8000-000000000023'
    ), 'case_correction', 'phase_2_test_service'
  ) ->> 'classification',
  'source_correction',
  'a correction persists old and corrected immutable fact lineage'
);
select is(
  public.commit_fact_contribution_batch_v1(
    pg_temp.batch_payload(
      '47200000-0000-4000-8000-000000000024','b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000024','e7200000-0000-4000-8000-000000000002','27200000-0000-4000-8000-000000000004',
      jsonb_build_array(
        pg_temp.event_payload('57200000-0000-4000-8000-000000000024','retract','17200000-0000-4000-8000-000000000009','57200000-0000-4000-8000-000000000023','sha256:' || repeat('c',64),'sha256:' || repeat('b',64),'90000'),
        pg_temp.event_payload('57200000-0000-4000-8000-000000000025','establish','17200000-0000-4000-8000-00000000000b',null,'sha256:' || repeat('c',64),'sha256:' || repeat('b',64),'100000')
      )
    ), 'batch_correction', 'phase_2_test_service'
  ) ->> 'eventCount',
  '2',
  'a correction atomically retracts the prior amount and establishes the corrected amount'
);
select is(
  public.read_fact_contribution_aggregate_v1(
    'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000004'
  ) ->> 'currentTotal',
  '100000',
  'append-only correction history resolves to the corrected exact amount'
);
select is(
  (public.read_fact_contribution_aggregate_v1(
    'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000004'
  ) ->> 'establishedCount')::integer,
  2,
  'both old and corrected establishment history remains reconstructable'
);

reset role;
select ok(
  pg_temp.raises_sqlstate(
    $$update private.fact_contribution_events set value_canonical = '200000'
      where id = '57200000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'contribution history is append-only even for database maintenance paths'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.reconciliation_cases where id = '37200000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'reconciliation decisions cannot be rewritten or deleted'
);

set local role external_integrations_authority;
select ok(
  pg_temp.raises_sqlstate($$select * from private.fact_contribution_events$$, '42501'),
  'the narrow authority cannot directly read private contribution rows'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into private.fact_contribution_events (
      id, contract_version, workspace_id, business_entity_id, contribution_batch_id,
      reconciliation_case_id, source_authority_policy_version_id, contribution_family_version_id,
      fact_version_id, event_kind, contribution_identity_fingerprint, economic_identity_fingerprint,
      measure_key, aggregate_key, dimensions, accounting_basis, value_canonical, value,
      registry_version, event_fingerprint
    ) values (
      '57200000-0000-4000-8000-000000000099','fact_contribution_event_v1',
      'b7200000-0000-4000-8000-000000000001','d7200000-0000-4000-8000-000000000001',
      '47200000-0000-4000-8000-000000000001','37200000-0000-4000-8000-000000000001',
      'e7200000-0000-4000-8000-000000000001','27200000-0000-4000-8000-000000000001',
      '17200000-0000-4000-8000-000000000002','establish',decode(repeat('9',64),'hex'),decode(repeat('9',64),'hex'),
      'recognized_revenue','recognized_revenue_actual','[]'::jsonb,'accrual','1',1,
      'financial_contribution_registry_v1',decode(repeat('9',64),'hex')
    )$$,
    '42501'
  ),
  'attempted direct contribution insertion is denied'
);

reset role;
select is(
  (select count(*)::integer from private.integration_audit_events where action = any(array[
    'source_authority_policy.commit', 'contribution_family.commit',
    'reconciliation_case.commit', 'fact_contribution_batch.commit'
  ])),
  21,
  'successful Phase 2 policy, family, case, and contribution decisions are auditable'
);
select is(
  (select count(*)::integer from private.fact_contribution_events where event_kind = 'establish'),
  5,
  'only approved duplicate, independent, and correction establishments are recorded'
);

select * from finish();
rollback;
