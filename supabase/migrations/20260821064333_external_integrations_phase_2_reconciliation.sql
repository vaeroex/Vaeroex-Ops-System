-- External Integrations Phase 2: Cross-Source Reconciliation and Contributions
--
-- This migration is additive and provider-neutral. It does not create provider
-- connectivity, OAuth, credentials, queues, KPI dependency state, routes, UI,
-- or changes to existing upload/manual ingestion. All authoritative Phase 2
-- rows are private, append-only, forced-RLS records written through the same
-- narrow authority boundary established by Phase 1.

create or replace function private.is_integration_audit_metadata_v2(p_value jsonb)
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
      'inserted_events'
    ]::text[]) = '{}'::jsonb
    and pg_catalog.octet_length(p_value::text) <= 4096;
$function$;

alter table private.integration_audit_events
  drop constraint integration_audit_events_metadata_check;
alter table private.integration_audit_events
  add constraint integration_audit_events_metadata_check
  check (private.is_integration_audit_metadata_v2(metadata));

create or replace function private.is_phase_2_decision_v1(p_value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    private.jsonb_has_exact_keys_v1(
      p_value,
      array['authority', 'policyVersion', 'actorId', 'decidedAt', 'reasonCodes']
    )
    and p_value ->> 'authority' in (
      'deterministic_policy',
      'customer_authorized_user',
      'operator'
    )
    and pg_catalog.jsonb_typeof(p_value -> 'policyVersion') in ('string', 'null')
    and pg_catalog.jsonb_typeof(p_value -> 'actorId') in ('string', 'null')
    and pg_catalog.jsonb_typeof(p_value -> 'decidedAt') = 'string'
    and pg_catalog.jsonb_typeof(p_value -> 'reasonCodes') = 'array'
    and private.is_bounded_identifier_array_v1(
      array(
        select pg_catalog.jsonb_array_elements_text(p_value -> 'reasonCodes')
      ),
      32
    )
    and (
      (p_value ->> 'authority' = 'deterministic_policy'
        and private.is_bounded_identifier_v1(p_value ->> 'policyVersion')
        and p_value -> 'actorId' = 'null'::jsonb)
      or
      (p_value ->> 'authority' in ('customer_authorized_user', 'operator')
        and p_value -> 'policyVersion' = 'null'::jsonb
        and pg_catalog.jsonb_typeof(p_value -> 'actorId') = 'string')
    );
$function$;

create or replace function private.is_reconciliation_features_v1(p_value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select
    private.jsonb_has_exact_keys_v1(
      p_value,
      array[
        'sourceIdentityMatch',
        'explicitLineageMatch',
        'economicIdentityMatch',
        'valueMatch',
        'accountingBasisMatch',
        'currencyMatch',
        'periodMatch',
        'dimensionsMatch',
        'fuzzyProposalOnly'
      ]
    )
    and not exists (
      select 1
      from pg_catalog.jsonb_each(p_value) as feature
      where pg_catalog.jsonb_typeof(feature.value) <> 'boolean'
    );
$function$;

create or replace function private.integration_actor_has_role_v1(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_id
      and member.status = 'active'
      and member.role = any(p_allowed_roles)
  );
$function$;

create or replace function private.phase_2_decision_actor_v1(
  p_workspace_id uuid,
  p_decision jsonb,
  p_rpc_actor_id text,
  p_allowed_customer_roles text[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_authority text := p_decision ->> 'authority';
  v_actor_id uuid;
begin
  if not private.is_phase_2_decision_v1(p_decision) then
    raise exception using errcode = '22023', message = 'phase_2_decision_invalid';
  end if;

  if v_authority = 'deterministic_policy' then
    return null;
  end if;

  begin
    v_actor_id := (p_decision ->> 'actorId')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'phase_2_decision_actor_invalid';
  end;

  if p_rpc_actor_id is distinct from v_actor_id::text then
    raise exception using errcode = '42501', message = 'phase_2_decision_actor_forged';
  end if;

  if v_authority = 'customer_authorized_user'
    and not private.integration_actor_has_role_v1(
      p_workspace_id,
      v_actor_id,
      p_allowed_customer_roles
    ) then
    raise exception using errcode = '42501', message = 'phase_2_customer_authority_denied';
  end if;

  if v_authority = 'operator'
    and not exists (select 1 from public.profiles where id = v_actor_id) then
    raise exception using errcode = '42501', message = 'phase_2_operator_authority_denied';
  end if;

  return v_actor_id;
end;
$function$;

create or replace function private.validate_reconciliation_case_payload_v1(p_case jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_member jsonb;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_case,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'sourceAuthorityPolicyVersionId',
      'supersedesCaseId',
      'caseFingerprint',
      'evaluatedAt',
      'effectiveAt',
      'matchRuleVersion',
      'matchTier',
      'classification',
      'caseState',
      'winningFactVersionId',
      'deterministicFeatures',
      'decision',
      'members'
    ]
  )
    or p_case ->> 'contractVersion' <> 'reconciliation_case_v1'
    or pg_catalog.jsonb_typeof(p_case -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_case -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_case -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_case -> 'sourceAuthorityPolicyVersionId') <> 'string'
    or pg_catalog.jsonb_typeof(p_case -> 'supersedesCaseId') not in ('string', 'null')
    or not private.is_sha256_fingerprint_v1(p_case ->> 'caseFingerprint')
    or pg_catalog.jsonb_typeof(p_case -> 'evaluatedAt') <> 'string'
    or pg_catalog.jsonb_typeof(p_case -> 'effectiveAt') <> 'string'
    or not private.is_bounded_identifier_v1(p_case ->> 'matchRuleVersion')
    or p_case ->> 'matchTier' not in (
      'exact_source_identity_version',
      'explicit_known_lineage',
      'exact_canonical_economic_identity',
      'ambiguous_review'
    )
    or p_case ->> 'classification' not in (
      'same_fact_represented_twice',
      'duplicate_evidence',
      'independent_facts',
      'source_correction',
      'authority_excluded_representation',
      'manual_override',
      'conflicting_sources',
      'ambiguous_review',
      'control_observation_vs_additive_detail'
    )
    or p_case ->> 'caseState' not in ('resolved', 'review_required')
    or pg_catalog.jsonb_typeof(p_case -> 'winningFactVersionId') not in ('string', 'null')
    or not private.is_reconciliation_features_v1(p_case -> 'deterministicFeatures')
    or not private.is_phase_2_decision_v1(p_case -> 'decision')
    or pg_catalog.jsonb_typeof(p_case -> 'members') <> 'array'
    or pg_catalog.jsonb_array_length(p_case -> 'members') not between 2 and 100 then
    raise exception using errcode = '22023', message = 'reconciliation_case_payload_invalid';
  end if;

  for v_member in select value from pg_catalog.jsonb_array_elements(p_case -> 'members')
  loop
    if not private.jsonb_has_exact_keys_v1(
      v_member,
      array[
        'factVersionId',
        'sourceRecordVersionId',
        'sourceFingerprint',
        'economicIdentityFingerprint',
        'memberRole',
        'authorityRank',
        'additiveCandidate',
        'canonicalValue'
      ]
    )
      or pg_catalog.jsonb_typeof(v_member -> 'factVersionId') <> 'string'
      or pg_catalog.jsonb_typeof(v_member -> 'sourceRecordVersionId') <> 'string'
      or not private.is_sha256_fingerprint_v1(v_member ->> 'sourceFingerprint')
      or not private.is_sha256_fingerprint_v1(v_member ->> 'economicIdentityFingerprint')
      or v_member ->> 'memberRole' not in (
        'candidate',
        'winner',
        'excluded',
        'correction_prior',
        'correction_current',
        'control_observation'
      )
      or pg_catalog.jsonb_typeof(v_member -> 'authorityRank') <> 'number'
      or (v_member ->> 'authorityRank') !~ '^[1-9][0-9]{0,5}$'
      or pg_catalog.jsonb_typeof(v_member -> 'additiveCandidate') <> 'boolean'
      or pg_catalog.jsonb_typeof(v_member -> 'canonicalValue') not in ('string', 'null')
      or (
        pg_catalog.jsonb_typeof(v_member -> 'canonicalValue') = 'string'
        and not private.is_canonical_numeric_v1(
          v_member ->> 'canonicalValue',
          30,
          9,
          true,
          false,
          false
        )
      ) then
      raise exception using errcode = '22023', message = 'reconciliation_case_member_invalid';
    end if;
  end loop;
end;
$function$;

create or replace function public.commit_reconciliation_case_v1(
  p_case jsonb,
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
  v_case_id uuid;
  v_policy_version_id uuid;
  v_supersedes_case_id uuid;
  v_winning_fact_version_id uuid;
  v_case_fingerprint bytea;
  v_effective_at timestamptz;
  v_decision_actor_id uuid;
  v_policy record;
  v_existing record;
  v_member jsonb;
  v_ordinal bigint;
  v_winner_members integer;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_reconciliation_case_payload_v1(p_case);

  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'reconciliation_case_request_invalid';
  end if;

  v_workspace_id := (p_case ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_case ->> 'businessEntityId')::uuid;
  v_case_id := (p_case ->> 'id')::uuid;
  v_policy_version_id := (p_case ->> 'sourceAuthorityPolicyVersionId')::uuid;
  v_supersedes_case_id := (p_case ->> 'supersedesCaseId')::uuid;
  v_winning_fact_version_id := (p_case ->> 'winningFactVersionId')::uuid;
  v_case_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_case ->> 'caseFingerprint'
  );
  v_effective_at := (p_case ->> 'effectiveAt')::timestamptz;

  select policy.*
  into v_policy
  from private.source_authority_policy_versions as policy
  where policy.workspace_id = v_workspace_id
    and policy.business_entity_id = v_business_entity_id
    and policy.id = v_policy_version_id
    and policy.effective_from <= v_effective_at
    and (policy.effective_through is null or policy.effective_through > v_effective_at);

  if not found then
    raise exception using errcode = '42501', message = 'reconciliation_case_policy_substitution_denied';
  end if;

  if exists (
    select 1
    from private.source_authority_policy_versions as newer
    where newer.workspace_id = v_policy.workspace_id
      and newer.business_entity_id = v_policy.business_entity_id
      and newer.domain_key = v_policy.domain_key
      and newer.policy_key = v_policy.policy_key
      and newer.effective_from <= v_effective_at
      and (newer.effective_through is null or newer.effective_through > v_effective_at)
      and (
        newer.effective_from > v_policy.effective_from
        or (
          newer.effective_from = v_policy.effective_from
          and newer.immutable_version > v_policy.immutable_version
        )
      )
  ) then
    raise exception using errcode = '40001', message = 'reconciliation_case_policy_version_stale';
  end if;

  v_decision_actor_id := private.phase_2_decision_actor_v1(
    v_workspace_id,
    p_case -> 'decision',
    p_actor_id,
    array['owner', 'admin', 'manager']::text[]
  );

  if p_case ->> 'classification' = 'manual_override'
    and p_case #>> '{decision,authority}' = 'deterministic_policy' then
    raise exception using errcode = '22023', message = 'manual_override_requires_human_decision';
  end if;

  if p_case ->> 'classification' = 'ambiguous_review'
    and (
      p_case ->> 'matchTier' <> 'ambiguous_review'
      or p_case ->> 'caseState' <> 'review_required'
      or v_winning_fact_version_id is not null
    ) then
    raise exception using errcode = '22023', message = 'ambiguous_reconciliation_must_fail_closed';
  end if;

  if p_case ->> 'classification' = 'conflicting_sources' then
    if v_policy.conflict_behavior = 'hold_all'
      and (
        p_case ->> 'caseState' <> 'review_required'
        or v_winning_fact_version_id is not null
      ) then
      raise exception using errcode = '22023', message = 'conflict_hold_policy_violated';
    elsif v_policy.conflict_behavior = 'allow_authoritative_and_flag'
      and (
        p_case ->> 'caseState' <> 'resolved'
        or v_winning_fact_version_id is null
      ) then
      raise exception using errcode = '22023', message = 'conflict_authoritative_policy_violated';
    end if;
  elsif p_case ->> 'classification' = 'independent_facts' then
    if p_case ->> 'caseState' <> 'resolved' or v_winning_fact_version_id is not null then
      raise exception using errcode = '22023', message = 'independent_reconciliation_winner_invalid';
    end if;
  elsif p_case ->> 'classification' <> 'ambiguous_review'
    and (p_case ->> 'caseState' <> 'resolved' or v_winning_fact_version_id is null) then
    raise exception using errcode = '22023', message = 'resolved_reconciliation_winner_required';
  end if;

  select count(*)::integer
  into v_winner_members
  from pg_catalog.jsonb_array_elements(p_case -> 'members') as member
  where member.value ->> 'memberRole' = 'winner'
    and (member.value ->> 'factVersionId')::uuid is not distinct from v_winning_fact_version_id;

  if (v_winning_fact_version_id is null and v_winner_members <> 0)
    or (v_winning_fact_version_id is not null and v_winner_members <> 1) then
    raise exception using errcode = '22023', message = 'reconciliation_case_winner_membership_invalid';
  end if;

  if v_supersedes_case_id is not null and not exists (
    select 1
    from private.reconciliation_cases as prior_case
    where prior_case.workspace_id = v_workspace_id
      and prior_case.business_entity_id = v_business_entity_id
      and prior_case.id = v_supersedes_case_id
  ) then
    raise exception using errcode = '42501', message = 'reconciliation_case_supersedes_substitution_denied';
  end if;

  select reconciliation_case.*
  into v_existing
  from private.reconciliation_cases as reconciliation_case
  where reconciliation_case.id = v_case_id;

  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id = v_business_entity_id
      and v_existing.case_fingerprint = v_case_fingerprint then
      return pg_catalog.jsonb_build_object(
        'reconciliationCaseId', v_existing.id,
        'classification', v_existing.classification,
        'caseState', v_existing.case_state,
        'memberCount', (
          select count(*)
          from private.reconciliation_case_members as member
          where member.reconciliation_case_id = v_existing.id
        ),
        'caseFingerprint', p_case ->> 'caseFingerprint',
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'reconciliation_case_id_conflict';
  end if;

  insert into private.reconciliation_cases (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    source_authority_policy_version_id,
    supersedes_case_id,
    case_fingerprint,
    evaluated_at,
    effective_at,
    match_rule_version,
    match_tier,
    classification,
    case_state,
    winning_fact_version_id,
    deterministic_features,
    decision_authority,
    decision_policy_version,
    decision_actor_id,
    decision_decided_at,
    decision_reason_codes
  ) values (
    v_case_id,
    'reconciliation_case_v1',
    v_workspace_id,
    v_business_entity_id,
    v_policy_version_id,
    v_supersedes_case_id,
    v_case_fingerprint,
    (p_case ->> 'evaluatedAt')::timestamptz,
    v_effective_at,
    p_case ->> 'matchRuleVersion',
    p_case ->> 'matchTier',
    p_case ->> 'classification',
    p_case ->> 'caseState',
    v_winning_fact_version_id,
    p_case -> 'deterministicFeatures',
    p_case #>> '{decision,authority}',
    p_case #>> '{decision,policyVersion}',
    v_decision_actor_id,
    (p_case #>> '{decision,decidedAt}')::timestamptz,
    array(select pg_catalog.jsonb_array_elements_text(p_case #> '{decision,reasonCodes}'))
  );

  for v_member, v_ordinal in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(p_case -> 'members')
      with ordinality as item(value, ordinality)
  loop
    if not exists (
      select 1
      from private.canonical_business_fact_versions as fact_version
      join private.business_fact_sources as fact_source
        on fact_source.workspace_id = fact_version.workspace_id
        and fact_source.business_entity_id = fact_version.business_entity_id
        and fact_source.fact_version_id = fact_version.id
      join private.external_source_record_versions as source_version
        on source_version.workspace_id = fact_source.workspace_id
        and source_version.business_entity_id = fact_source.business_entity_id
        and source_version.id = fact_source.source_record_version_id
        and source_version.source_fingerprint = fact_source.source_fingerprint
      where fact_version.workspace_id = v_workspace_id
        and fact_version.business_entity_id = v_business_entity_id
        and fact_version.id = (v_member ->> 'factVersionId')::uuid
        and source_version.id = (v_member ->> 'sourceRecordVersionId')::uuid
        and source_version.source_fingerprint = private.sha256_fingerprint_bytes_v1(
          v_member ->> 'sourceFingerprint'
        )
    ) then
      raise exception using errcode = '42501', message = 'reconciliation_member_source_fact_substitution_denied';
    end if;

    insert into private.reconciliation_case_members (
      workspace_id,
      business_entity_id,
      reconciliation_case_id,
      member_order,
      fact_version_id,
      source_record_version_id,
      source_fingerprint,
      economic_identity_fingerprint,
      member_role,
      authority_rank,
      additive_candidate,
      canonical_value
    ) values (
      v_workspace_id,
      v_business_entity_id,
      v_case_id,
      v_ordinal::smallint,
      (v_member ->> 'factVersionId')::uuid,
      (v_member ->> 'sourceRecordVersionId')::uuid,
      private.sha256_fingerprint_bytes_v1(v_member ->> 'sourceFingerprint'),
      private.sha256_fingerprint_bytes_v1(v_member ->> 'economicIdentityFingerprint'),
      v_member ->> 'memberRole',
      (v_member ->> 'authorityRank')::integer,
      (v_member ->> 'additiveCandidate')::boolean,
      v_member ->> 'canonicalValue'
    );
  end loop;

  if v_winning_fact_version_id is not null and not exists (
    select 1
    from private.reconciliation_case_members as member
    where member.reconciliation_case_id = v_case_id
      and member.fact_version_id = v_winning_fact_version_id
      and member.member_role = 'winner'
  ) then
    raise exception using errcode = '22023', message = 'reconciliation_case_winner_not_persisted';
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
    case when v_decision_actor_id is null then 'service' else 'user' end,
    p_actor_id,
    'reconciliation_case.commit',
    'succeeded',
    'reconciliation_case',
    v_case_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'classification', p_case ->> 'classification',
      'match_tier', p_case ->> 'matchTier',
      'case_state', p_case ->> 'caseState',
      'policy_version_id', v_policy_version_id,
      'member_count', pg_catalog.jsonb_array_length(p_case -> 'members')
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'reconciliationCaseId', v_case_id,
    'classification', p_case ->> 'classification',
    'caseState', p_case ->> 'caseState',
    'memberCount', pg_catalog.jsonb_array_length(p_case -> 'members'),
    'caseFingerprint', p_case ->> 'caseFingerprint',
    'idempotent', false
  );
end;
$function$;

create or replace function private.validate_contribution_family_payload_v1(p_family jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
begin
  if not private.jsonb_has_exact_keys_v1(
    p_family,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'familyKey',
      'immutableVersion',
      'supersedesFamilyVersionId',
      'domainKey',
      'measureKey',
      'aggregateKey',
      'contributionMode',
      'allowedFactKinds',
      'registryVersion',
      'effectiveFrom',
      'decision',
      'familyFingerprint'
    ]
  )
    or p_family ->> 'contractVersion' <> 'contribution_family_v1'
    or pg_catalog.jsonb_typeof(p_family -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'familyKey') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'immutableVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_family -> 'supersedesFamilyVersionId') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_family -> 'domainKey') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'measureKey') <> 'string'
    or pg_catalog.jsonb_typeof(p_family -> 'aggregateKey') <> 'string'
    or p_family ->> 'contributionMode' not in (
      'additive_transaction', 'non_additive_control'
    )
    or pg_catalog.jsonb_typeof(p_family -> 'allowedFactKinds') <> 'array'
    or not private.is_bounded_identifier_array_v1(
      array(select pg_catalog.jsonb_array_elements_text(p_family -> 'allowedFactKinds')),
      100
    )
    or pg_catalog.jsonb_array_length(p_family -> 'allowedFactKinds') < 1
    or not private.is_bounded_identifier_v1(p_family ->> 'familyKey')
    or not private.is_bounded_identifier_v1(p_family ->> 'domainKey')
    or not private.is_bounded_identifier_v1(p_family ->> 'measureKey')
    or not private.is_bounded_identifier_v1(p_family ->> 'aggregateKey')
    or not private.is_bounded_identifier_v1(p_family ->> 'registryVersion')
    or (p_family ->> 'immutableVersion') !~ '^[1-9][0-9]{0,18}$'
    or not private.is_phase_2_decision_v1(p_family -> 'decision')
    or not private.is_sha256_fingerprint_v1(p_family ->> 'familyFingerprint') then
    raise exception using errcode = '22023', message = 'contribution_family_payload_invalid';
  end if;
end;
$function$;

create or replace function public.commit_contribution_family_version_v1(
  p_family jsonb,
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
  v_family_id uuid;
  v_immutable_version bigint;
  v_supersedes_id uuid;
  v_family_fingerprint bytea;
  v_decision_actor_id uuid;
  v_previous record;
  v_existing record;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_contribution_family_payload_v1(p_family);

  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'contribution_family_request_invalid';
  end if;

  v_workspace_id := (p_family ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_family ->> 'businessEntityId')::uuid;
  v_family_id := (p_family ->> 'id')::uuid;
  v_immutable_version := (p_family ->> 'immutableVersion')::bigint;
  v_supersedes_id := (p_family ->> 'supersedesFamilyVersionId')::uuid;
  v_family_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_family ->> 'familyFingerprint'
  );

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = v_workspace_id
      and entity.id = v_business_entity_id
      and entity.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'contribution_family_entity_denied';
  end if;

  v_decision_actor_id := private.phase_2_decision_actor_v1(
    v_workspace_id,
    p_family -> 'decision',
    p_actor_id,
    array['owner', 'admin']::text[]
  );

  select family.*
  into v_existing
  from private.contribution_family_versions as family
  where family.id = v_family_id;

  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id = v_business_entity_id
      and v_existing.family_fingerprint = v_family_fingerprint then
      return pg_catalog.jsonb_build_object(
        'familyVersionId', v_existing.id,
        'immutableVersion', v_existing.immutable_version,
        'familyFingerprint', p_family ->> 'familyFingerprint',
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'contribution_family_id_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_workspace_id::text || ':' || v_business_entity_id::text || ':'
        || (p_family ->> 'familyKey'),
      0
    )
  );

  select family.*
  into v_previous
  from private.contribution_family_versions as family
  where family.workspace_id = v_workspace_id
    and family.business_entity_id = v_business_entity_id
    and family.family_key = p_family ->> 'familyKey'
  order by family.immutable_version desc
  limit 1;

  if not found then
    if v_immutable_version <> 1 or v_supersedes_id is not null then
      raise exception using errcode = '22023', message = 'contribution_family_first_version_invalid';
    end if;
  elsif v_immutable_version <> v_previous.immutable_version + 1
    or v_supersedes_id is distinct from v_previous.id then
    raise exception using errcode = '40001', message = 'contribution_family_version_stale';
  end if;

  insert into private.contribution_family_versions (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    family_key,
    immutable_version,
    supersedes_family_version_id,
    domain_key,
    measure_key,
    aggregate_key,
    contribution_mode,
    allowed_fact_kinds,
    registry_version,
    effective_from,
    decision_authority,
    decision_policy_version,
    decision_actor_id,
    decision_decided_at,
    decision_reason_codes,
    family_fingerprint
  ) values (
    v_family_id,
    'contribution_family_v1',
    v_workspace_id,
    v_business_entity_id,
    p_family ->> 'familyKey',
    v_immutable_version,
    v_supersedes_id,
    p_family ->> 'domainKey',
    p_family ->> 'measureKey',
    p_family ->> 'aggregateKey',
    p_family ->> 'contributionMode',
    array(select pg_catalog.jsonb_array_elements_text(p_family -> 'allowedFactKinds')),
    p_family ->> 'registryVersion',
    (p_family ->> 'effectiveFrom')::timestamptz,
    p_family #>> '{decision,authority}',
    p_family #>> '{decision,policyVersion}',
    v_decision_actor_id,
    (p_family #>> '{decision,decidedAt}')::timestamptz,
    array(select pg_catalog.jsonb_array_elements_text(p_family #> '{decision,reasonCodes}')),
    v_family_fingerprint
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
    case when v_decision_actor_id is null then 'service' else 'user' end,
    p_actor_id,
    'contribution_family.commit',
    'succeeded',
    'contribution_family_version',
    v_family_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'family_key', p_family ->> 'familyKey',
      'immutable_version', v_immutable_version,
      'registry_version', p_family ->> 'registryVersion',
      'contribution_mode', p_family ->> 'contributionMode'
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'familyVersionId', v_family_id,
    'immutableVersion', v_immutable_version,
    'familyFingerprint', p_family ->> 'familyFingerprint',
    'idempotent', false
  );
end;
$function$;

create table private.source_authority_policy_versions (
  id uuid primary key,
  contract_version text not null check (contract_version = 'source_authority_policy_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  domain_key text not null check (private.is_bounded_identifier_v1(domain_key)),
  policy_key text not null check (private.is_bounded_identifier_v1(policy_key)),
  immutable_version bigint not null check (immutable_version > 0),
  supersedes_policy_version_id uuid,
  effective_from timestamptz not null,
  effective_through timestamptz,
  conflict_behavior text not null
    check (conflict_behavior in ('hold_all', 'allow_authoritative_and_flag')),
  fallback_mode text not null
    check (fallback_mode in ('manual_upload_when_unowned', 'review_required')),
  decision_authority text not null check (
    decision_authority in ('deterministic_policy', 'customer_authorized_user', 'operator')
  ),
  decision_policy_version text check (
    decision_policy_version is null
    or private.is_bounded_identifier_v1(decision_policy_version)
  ),
  decision_actor_id uuid references public.profiles(id) on delete restrict,
  decision_decided_at timestamptz not null,
  decision_reason_codes text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(decision_reason_codes, 32)),
  policy_fingerprint bytea not null check (octet_length(policy_fingerprint) = 32),
  created_at timestamptz not null default transaction_timestamp(),
  constraint source_authority_policy_versions_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint source_authority_policy_versions_identity_key unique (
    workspace_id, business_entity_id, domain_key, policy_key, immutable_version
  ),
  constraint source_authority_policy_versions_fingerprint_key unique (
    workspace_id, business_entity_id, policy_fingerprint
  ),
  constraint source_authority_policy_versions_effective_check check (
    effective_through is null or effective_through > effective_from
  ),
  constraint source_authority_policy_versions_decision_check check (
    (decision_authority = 'deterministic_policy'
      and decision_policy_version is not null
      and decision_actor_id is null)
    or
    (decision_authority in ('customer_authorized_user', 'operator')
      and decision_policy_version is null
      and decision_actor_id is not null)
  ),
  constraint source_authority_policy_versions_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint source_authority_policy_versions_supersedes_fkey foreign key (
    workspace_id, business_entity_id, supersedes_policy_version_id
  ) references private.source_authority_policy_versions(workspace_id, business_entity_id, id)
    on delete restrict
);

create index source_authority_policy_versions_effective_idx
  on private.source_authority_policy_versions(
    workspace_id,
    business_entity_id,
    domain_key,
    policy_key,
    effective_from desc,
    immutable_version desc
  );
create index source_authority_policy_versions_supersedes_scope_idx
  on private.source_authority_policy_versions(
    workspace_id,
    business_entity_id,
    supersedes_policy_version_id
  )
  where supersedes_policy_version_id is not null;
create index source_authority_policy_versions_actor_idx
  on private.source_authority_policy_versions(decision_actor_id)
  where decision_actor_id is not null;

create table private.source_authority_policy_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  policy_version_id uuid not null,
  rule_order smallint not null check (rule_order > 0),
  source_kind text not null check (source_kind in ('provider', 'upload', 'manual')),
  provider_key text check (
    provider_key is null
    or (char_length(provider_key) between 1 and 64 and provider_key ~ '^[a-z][a-z0-9_-]*$')
  ),
  source_class text not null check (
    source_class in (
      'transaction_detail',
      'report_control',
      'manual_entry',
      'upload_observation'
    )
  ),
  authority_role text not null check (
    authority_role in ('authoritative', 'supplemental', 'control_only', 'excluded')
  ),
  authority_rank integer not null check (authority_rank between 1 and 1000000),
  contribution_mode text not null check (
    contribution_mode in ('additive_transaction', 'non_additive_control', 'both')
  ),
  created_at timestamptz not null default transaction_timestamp(),
  constraint source_authority_policy_rules_policy_order_key unique (
    policy_version_id, rule_order
  ),
  constraint source_authority_policy_rules_policy_source_key unique nulls not distinct (
    policy_version_id, source_kind, provider_key, source_class
  ),
  constraint source_authority_policy_rules_variant_check check (
    (source_kind = 'provider' and provider_key is not null)
    or (source_kind <> 'provider' and provider_key is null)
  ),
  constraint source_authority_policy_rules_policy_fkey foreign key (
    workspace_id, business_entity_id, policy_version_id
  ) references private.source_authority_policy_versions(workspace_id, business_entity_id, id)
    on delete cascade
);

create index source_authority_policy_rules_lookup_idx
  on private.source_authority_policy_rules(
    workspace_id,
    business_entity_id,
    policy_version_id,
    source_kind,
    provider_key,
    source_class
  );

create table private.reconciliation_cases (
  id uuid primary key,
  contract_version text not null check (contract_version = 'reconciliation_case_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  source_authority_policy_version_id uuid not null,
  supersedes_case_id uuid,
  case_fingerprint bytea not null check (octet_length(case_fingerprint) = 32),
  evaluated_at timestamptz not null,
  effective_at timestamptz not null,
  match_rule_version text not null check (private.is_bounded_identifier_v1(match_rule_version)),
  match_tier text not null check (
    match_tier in (
      'exact_source_identity_version',
      'explicit_known_lineage',
      'exact_canonical_economic_identity',
      'ambiguous_review'
    )
  ),
  classification text not null check (
    classification in (
      'same_fact_represented_twice',
      'duplicate_evidence',
      'independent_facts',
      'source_correction',
      'authority_excluded_representation',
      'manual_override',
      'conflicting_sources',
      'ambiguous_review',
      'control_observation_vs_additive_detail'
    )
  ),
  case_state text not null check (case_state in ('resolved', 'review_required')),
  winning_fact_version_id uuid,
  deterministic_features jsonb not null
    check (private.is_reconciliation_features_v1(deterministic_features)),
  decision_authority text not null check (
    decision_authority in ('deterministic_policy', 'customer_authorized_user', 'operator')
  ),
  decision_policy_version text check (
    decision_policy_version is null
    or private.is_bounded_identifier_v1(decision_policy_version)
  ),
  decision_actor_id uuid references public.profiles(id) on delete restrict,
  decision_decided_at timestamptz not null,
  decision_reason_codes text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(decision_reason_codes, 32)),
  created_at timestamptz not null default transaction_timestamp(),
  constraint reconciliation_cases_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint reconciliation_cases_fingerprint_key unique (
    workspace_id, business_entity_id, case_fingerprint
  ),
  constraint reconciliation_cases_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint reconciliation_cases_policy_fkey foreign key (
    workspace_id, business_entity_id, source_authority_policy_version_id
  ) references private.source_authority_policy_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint reconciliation_cases_supersedes_fkey foreign key (
    workspace_id, business_entity_id, supersedes_case_id
  ) references private.reconciliation_cases(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint reconciliation_cases_winner_fkey foreign key (
    workspace_id, business_entity_id, winning_fact_version_id
  ) references private.canonical_business_fact_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint reconciliation_cases_decision_check check (
    (decision_authority = 'deterministic_policy'
      and decision_policy_version is not null
      and decision_actor_id is null)
    or
    (decision_authority in ('customer_authorized_user', 'operator')
      and decision_policy_version is null
      and decision_actor_id is not null)
  ),
  constraint reconciliation_cases_review_check check (
    (
      classification = 'ambiguous_review'
      and match_tier = 'ambiguous_review'
      and case_state = 'review_required'
      and winning_fact_version_id is null
    )
    or classification <> 'ambiguous_review'
  ),
  constraint reconciliation_cases_fuzzy_fail_closed_check check (
    not coalesce((deterministic_features ->> 'fuzzyProposalOnly')::boolean, false)
    or (
      classification = 'ambiguous_review'
      and case_state = 'review_required'
      and winning_fact_version_id is null
    )
  )
);

create index reconciliation_cases_policy_effective_idx
  on private.reconciliation_cases(
    workspace_id,
    business_entity_id,
    source_authority_policy_version_id,
    effective_at
  );
create index reconciliation_cases_state_evaluated_idx
  on private.reconciliation_cases(case_state, evaluated_at);
create index reconciliation_cases_supersedes_scope_idx
  on private.reconciliation_cases(workspace_id, business_entity_id, supersedes_case_id)
  where supersedes_case_id is not null;
create index reconciliation_cases_winner_scope_idx
  on private.reconciliation_cases(workspace_id, business_entity_id, winning_fact_version_id)
  where winning_fact_version_id is not null;
create index reconciliation_cases_actor_idx
  on private.reconciliation_cases(decision_actor_id)
  where decision_actor_id is not null;

create table private.reconciliation_case_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  reconciliation_case_id uuid not null,
  member_order smallint not null check (member_order > 0),
  fact_version_id uuid not null,
  source_record_version_id uuid not null,
  source_fingerprint bytea not null check (octet_length(source_fingerprint) = 32),
  economic_identity_fingerprint bytea not null check (
    octet_length(economic_identity_fingerprint) = 32
  ),
  member_role text not null check (
    member_role in (
      'candidate',
      'winner',
      'excluded',
      'correction_prior',
      'correction_current',
      'control_observation'
    )
  ),
  authority_rank integer not null check (authority_rank between 1 and 1000000),
  additive_candidate boolean not null,
  canonical_value text check (
    canonical_value is null
    or private.is_canonical_numeric_v1(canonical_value, 30, 9, true, false, false)
  ),
  created_at timestamptz not null default transaction_timestamp(),
  constraint reconciliation_case_members_case_order_key unique (
    reconciliation_case_id, member_order
  ),
  constraint reconciliation_case_members_case_fact_source_key unique (
    reconciliation_case_id, fact_version_id, source_record_version_id
  ),
  constraint reconciliation_case_members_case_fkey foreign key (
    workspace_id, business_entity_id, reconciliation_case_id
  ) references private.reconciliation_cases(workspace_id, business_entity_id, id)
    on delete cascade,
  constraint reconciliation_case_members_fact_fkey foreign key (
    workspace_id, business_entity_id, fact_version_id
  ) references private.canonical_business_fact_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint reconciliation_case_members_source_fkey foreign key (
    workspace_id, business_entity_id, source_record_version_id, source_fingerprint
  ) references private.external_source_record_versions(
    workspace_id, business_entity_id, id, source_fingerprint
  ) on delete restrict,
  constraint reconciliation_case_members_fact_source_fkey foreign key (
    fact_version_id, source_record_version_id
  ) references private.business_fact_sources(fact_version_id, source_record_version_id)
    on delete restrict
);

create index reconciliation_case_members_fact_idx
  on private.reconciliation_case_members(workspace_id, business_entity_id, fact_version_id);
create index reconciliation_case_members_source_idx
  on private.reconciliation_case_members(
    workspace_id,
    business_entity_id,
    source_record_version_id,
    source_fingerprint
  );
create index reconciliation_case_members_fact_source_idx
  on private.reconciliation_case_members(fact_version_id, source_record_version_id);
create index reconciliation_case_members_case_scope_idx
  on private.reconciliation_case_members(
    workspace_id,
    business_entity_id,
    reconciliation_case_id
  );
create index reconciliation_case_members_economic_identity_idx
  on private.reconciliation_case_members(
    workspace_id,
    business_entity_id,
    economic_identity_fingerprint
  );

create table private.contribution_family_versions (
  id uuid primary key,
  contract_version text not null check (contract_version = 'contribution_family_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  family_key text not null check (private.is_bounded_identifier_v1(family_key)),
  immutable_version bigint not null check (immutable_version > 0),
  supersedes_family_version_id uuid,
  domain_key text not null check (private.is_bounded_identifier_v1(domain_key)),
  measure_key text not null check (private.is_bounded_identifier_v1(measure_key)),
  aggregate_key text not null check (private.is_bounded_identifier_v1(aggregate_key)),
  contribution_mode text not null check (
    contribution_mode in ('additive_transaction', 'non_additive_control')
  ),
  allowed_fact_kinds text[] not null
    check (
      cardinality(allowed_fact_kinds) between 1 and 100
      and private.is_bounded_identifier_array_v1(allowed_fact_kinds, 100)
    ),
  registry_version text not null check (private.is_bounded_identifier_v1(registry_version)),
  effective_from timestamptz not null,
  decision_authority text not null check (
    decision_authority in ('deterministic_policy', 'customer_authorized_user', 'operator')
  ),
  decision_policy_version text check (
    decision_policy_version is null
    or private.is_bounded_identifier_v1(decision_policy_version)
  ),
  decision_actor_id uuid references public.profiles(id) on delete restrict,
  decision_decided_at timestamptz not null,
  decision_reason_codes text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(decision_reason_codes, 32)),
  family_fingerprint bytea not null check (octet_length(family_fingerprint) = 32),
  created_at timestamptz not null default transaction_timestamp(),
  constraint contribution_family_versions_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint contribution_family_versions_identity_key unique (
    workspace_id, business_entity_id, family_key, immutable_version
  ),
  constraint contribution_family_versions_fingerprint_key unique (
    workspace_id, business_entity_id, family_fingerprint
  ),
  constraint contribution_family_versions_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint contribution_family_versions_supersedes_fkey foreign key (
    workspace_id, business_entity_id, supersedes_family_version_id
  ) references private.contribution_family_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint contribution_family_versions_decision_check check (
    (decision_authority = 'deterministic_policy'
      and decision_policy_version is not null
      and decision_actor_id is null)
    or
    (decision_authority in ('customer_authorized_user', 'operator')
      and decision_policy_version is null
      and decision_actor_id is not null)
  )
);

create index contribution_family_versions_lookup_idx
  on private.contribution_family_versions(
    workspace_id,
    business_entity_id,
    family_key,
    effective_from desc,
    immutable_version desc
  );
create index contribution_family_versions_supersedes_scope_idx
  on private.contribution_family_versions(
    workspace_id,
    business_entity_id,
    supersedes_family_version_id
  )
  where supersedes_family_version_id is not null;
create index contribution_family_versions_actor_idx
  on private.contribution_family_versions(decision_actor_id)
  where decision_actor_id is not null;

create table private.fact_contribution_batches (
  id uuid primary key,
  contract_version text not null check (contract_version = 'fact_contribution_batch_v1'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_entity_id uuid not null,
  reconciliation_case_id uuid not null,
  source_authority_policy_version_id uuid not null,
  contribution_family_version_id uuid not null,
  batch_fingerprint bytea not null check (octet_length(batch_fingerprint) = 32),
  decision_authority text not null check (
    decision_authority in ('deterministic_policy', 'customer_authorized_user', 'operator')
  ),
  decision_policy_version text check (
    decision_policy_version is null
    or private.is_bounded_identifier_v1(decision_policy_version)
  ),
  decision_actor_id uuid references public.profiles(id) on delete restrict,
  decision_decided_at timestamptz not null,
  decision_reason_codes text[] not null default '{}'::text[]
    check (private.is_bounded_identifier_array_v1(decision_reason_codes, 32)),
  created_at timestamptz not null default transaction_timestamp(),
  constraint fact_contribution_batches_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint fact_contribution_batches_fingerprint_key unique (
    workspace_id, business_entity_id, batch_fingerprint
  ),
  constraint fact_contribution_batches_entity_fkey foreign key (
    workspace_id, business_entity_id
  ) references public.business_entities(workspace_id, id) on delete cascade,
  constraint fact_contribution_batches_case_fkey foreign key (
    workspace_id, business_entity_id, reconciliation_case_id
  ) references private.reconciliation_cases(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_batches_policy_fkey foreign key (
    workspace_id, business_entity_id, source_authority_policy_version_id
  ) references private.source_authority_policy_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_batches_family_fkey foreign key (
    workspace_id, business_entity_id, contribution_family_version_id
  ) references private.contribution_family_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_batches_decision_check check (
    (decision_authority = 'deterministic_policy'
      and decision_policy_version is not null
      and decision_actor_id is null)
    or
    (decision_authority in ('customer_authorized_user', 'operator')
      and decision_policy_version is null
      and decision_actor_id is not null)
  )
);

create index fact_contribution_batches_case_idx
  on private.fact_contribution_batches(
    workspace_id,
    business_entity_id,
    reconciliation_case_id
  );
create index fact_contribution_batches_policy_idx
  on private.fact_contribution_batches(
    workspace_id,
    business_entity_id,
    source_authority_policy_version_id
  );
create index fact_contribution_batches_family_idx
  on private.fact_contribution_batches(
    workspace_id,
    business_entity_id,
    contribution_family_version_id
  );
create index fact_contribution_batches_actor_idx
  on private.fact_contribution_batches(decision_actor_id)
  where decision_actor_id is not null;

create table private.fact_contribution_events (
  id uuid primary key,
  contract_version text not null check (contract_version = 'fact_contribution_event_v1'),
  workspace_id uuid not null,
  business_entity_id uuid not null,
  contribution_batch_id uuid not null,
  reconciliation_case_id uuid not null,
  source_authority_policy_version_id uuid not null,
  contribution_family_version_id uuid not null,
  fact_version_id uuid not null,
  event_kind text not null check (
    event_kind in ('establish', 'retract', 'control_observation')
  ),
  target_contribution_event_id uuid,
  contribution_identity_fingerprint bytea not null check (
    octet_length(contribution_identity_fingerprint) = 32
  ),
  economic_identity_fingerprint bytea not null check (
    octet_length(economic_identity_fingerprint) = 32
  ),
  measure_key text not null check (private.is_bounded_identifier_v1(measure_key)),
  aggregate_key text not null check (private.is_bounded_identifier_v1(aggregate_key)),
  effective_at timestamptz,
  period_start date,
  period_end date,
  dimensions jsonb not null default '[]'::jsonb
    check (private.is_fact_dimensions_v1(dimensions)),
  accounting_basis text not null
    check (accounting_basis in ('accrual', 'cash', 'not_applicable', 'unknown')),
  currency character(3) check (currency is null or private.is_currency_code_v1(currency)),
  value_canonical text not null,
  value numeric(30,9) not null,
  signed_value numeric(30,9) generated always as (
    case
      when event_kind = 'establish' then value
      when event_kind = 'retract' then -value
      else 0::numeric
    end
  ) stored,
  registry_version text not null check (private.is_bounded_identifier_v1(registry_version)),
  event_fingerprint bytea not null check (octet_length(event_fingerprint) = 32),
  created_at timestamptz not null default transaction_timestamp(),
  constraint fact_contribution_events_workspace_entity_id_key unique (
    workspace_id, business_entity_id, id
  ),
  constraint fact_contribution_events_fingerprint_key unique (
    workspace_id, business_entity_id, event_fingerprint
  ),
  constraint fact_contribution_events_batch_order_key unique (
    contribution_batch_id, id
  ),
  constraint fact_contribution_events_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  ),
  constraint fact_contribution_events_value_check check (
    private.canonical_numeric_matches_projection_v1(
      value_canonical,
      value,
      30,
      9,
      true,
      false,
      false
    )
  ),
  constraint fact_contribution_events_retraction_check check (
    (event_kind = 'retract' and target_contribution_event_id is not null)
    or (event_kind <> 'retract' and target_contribution_event_id is null)
  ),
  constraint fact_contribution_events_batch_fkey foreign key (
    workspace_id, business_entity_id, contribution_batch_id
  ) references private.fact_contribution_batches(workspace_id, business_entity_id, id)
    on delete cascade,
  constraint fact_contribution_events_case_fkey foreign key (
    workspace_id, business_entity_id, reconciliation_case_id
  ) references private.reconciliation_cases(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_events_policy_fkey foreign key (
    workspace_id, business_entity_id, source_authority_policy_version_id
  ) references private.source_authority_policy_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_events_family_fkey foreign key (
    workspace_id, business_entity_id, contribution_family_version_id
  ) references private.contribution_family_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_events_fact_fkey foreign key (
    workspace_id, business_entity_id, fact_version_id
  ) references private.canonical_business_fact_versions(workspace_id, business_entity_id, id)
    on delete restrict,
  constraint fact_contribution_events_target_fkey foreign key (
    workspace_id, business_entity_id, target_contribution_event_id
  ) references private.fact_contribution_events(workspace_id, business_entity_id, id)
    on delete restrict
);

create index fact_contribution_events_current_identity_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    contribution_family_version_id,
    contribution_identity_fingerprint,
    event_kind
  );
create index fact_contribution_events_fact_idx
  on private.fact_contribution_events(workspace_id, business_entity_id, fact_version_id);
create index fact_contribution_events_target_scope_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    target_contribution_event_id
  )
  where target_contribution_event_id is not null;
create index fact_contribution_events_batch_scope_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    contribution_batch_id
  );
create index fact_contribution_events_case_scope_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    reconciliation_case_id
  );
create index fact_contribution_events_policy_scope_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    source_authority_policy_version_id
  );
create index fact_contribution_events_aggregate_idx
  on private.fact_contribution_events(
    workspace_id,
    business_entity_id,
    contribution_family_version_id,
    measure_key,
    aggregate_key,
    period_start,
    period_end,
    accounting_basis,
    currency
  );

do $rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'source_authority_policy_versions',
    'source_authority_policy_rules',
    'reconciliation_cases',
    'reconciliation_case_members',
    'contribution_family_versions',
    'fact_contribution_batches',
    'fact_contribution_events'
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

create trigger reject_source_authority_policy_version_mutation_v1
before update or delete on private.source_authority_policy_versions
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_source_authority_policy_rule_mutation_v1
before update or delete on private.source_authority_policy_rules
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_reconciliation_case_mutation_v1
before update or delete on private.reconciliation_cases
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_reconciliation_case_member_mutation_v1
before update or delete on private.reconciliation_case_members
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_contribution_family_version_mutation_v1
before update or delete on private.contribution_family_versions
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_fact_contribution_batch_mutation_v1
before update or delete on private.fact_contribution_batches
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create trigger reject_fact_contribution_event_mutation_v1
before update or delete on private.fact_contribution_events
for each row execute function private.reject_external_integration_immutable_mutation_v1();

create or replace function private.validate_source_authority_policy_payload_v1(p_policy jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_rule jsonb;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_policy,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'domainKey',
      'policyKey',
      'immutableVersion',
      'supersedesPolicyVersionId',
      'effectiveFrom',
      'effectiveThrough',
      'conflictBehavior',
      'fallbackMode',
      'rules',
      'decision',
      'policyFingerprint'
    ]
  )
    or p_policy ->> 'contractVersion' <> 'source_authority_policy_v1'
    or pg_catalog.jsonb_typeof(p_policy -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'domainKey') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'policyKey') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'immutableVersion') <> 'number'
    or pg_catalog.jsonb_typeof(p_policy -> 'supersedesPolicyVersionId') not in ('string', 'null')
    or pg_catalog.jsonb_typeof(p_policy -> 'effectiveFrom') <> 'string'
    or pg_catalog.jsonb_typeof(p_policy -> 'effectiveThrough') not in ('string', 'null')
    or p_policy ->> 'conflictBehavior' not in ('hold_all', 'allow_authoritative_and_flag')
    or p_policy ->> 'fallbackMode' not in ('manual_upload_when_unowned', 'review_required')
    or pg_catalog.jsonb_typeof(p_policy -> 'rules') <> 'array'
    or pg_catalog.jsonb_array_length(p_policy -> 'rules') not between 1 and 100
    or not private.is_phase_2_decision_v1(p_policy -> 'decision')
    or not private.is_sha256_fingerprint_v1(p_policy ->> 'policyFingerprint') then
    raise exception using errcode = '22023', message = 'source_authority_policy_payload_invalid';
  end if;

  if not private.is_bounded_identifier_v1(p_policy ->> 'domainKey')
    or not private.is_bounded_identifier_v1(p_policy ->> 'policyKey')
    or (p_policy ->> 'immutableVersion') !~ '^[1-9][0-9]{0,18}$' then
    raise exception using errcode = '22023', message = 'source_authority_policy_identity_invalid';
  end if;

  for v_rule in select value from pg_catalog.jsonb_array_elements(p_policy -> 'rules')
  loop
    if not private.jsonb_has_exact_keys_v1(
      v_rule,
      array[
        'sourceKind',
        'providerKey',
        'sourceClass',
        'authorityRole',
        'authorityRank',
        'contributionMode'
      ]
    )
      or v_rule ->> 'sourceKind' not in ('provider', 'upload', 'manual')
      or pg_catalog.jsonb_typeof(v_rule -> 'providerKey') not in ('string', 'null')
      or v_rule ->> 'sourceClass' not in (
        'transaction_detail', 'report_control', 'manual_entry', 'upload_observation'
      )
      or v_rule ->> 'authorityRole' not in (
        'authoritative', 'supplemental', 'control_only', 'excluded'
      )
      or pg_catalog.jsonb_typeof(v_rule -> 'authorityRank') <> 'number'
      or (v_rule ->> 'authorityRank') !~ '^[1-9][0-9]{0,5}$'
      or v_rule ->> 'contributionMode' not in (
        'additive_transaction', 'non_additive_control', 'both'
      )
      or (
        v_rule ->> 'sourceKind' = 'provider'
        and (
          pg_catalog.jsonb_typeof(v_rule -> 'providerKey') <> 'string'
          or char_length(v_rule ->> 'providerKey') not between 1 and 64
          or (v_rule ->> 'providerKey') !~ '^[a-z][a-z0-9_-]*$'
        )
      )
      or (
        v_rule ->> 'sourceKind' <> 'provider'
        and v_rule -> 'providerKey' <> 'null'::jsonb
      ) then
      raise exception using errcode = '22023', message = 'source_authority_policy_rule_invalid';
    end if;
  end loop;
end;
$function$;

create or replace function public.commit_source_authority_policy_version_v1(
  p_policy jsonb,
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
  v_policy_id uuid;
  v_immutable_version bigint;
  v_supersedes_id uuid;
  v_policy_fingerprint bytea;
  v_decision_actor_id uuid;
  v_previous private.source_authority_policy_versions;
  v_existing private.source_authority_policy_versions;
  v_rule jsonb;
  v_ordinal bigint;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_source_authority_policy_payload_v1(p_policy);

  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'source_authority_policy_request_invalid';
  end if;

  v_workspace_id := (p_policy ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_policy ->> 'businessEntityId')::uuid;
  v_policy_id := (p_policy ->> 'id')::uuid;
  v_immutable_version := (p_policy ->> 'immutableVersion')::bigint;
  v_supersedes_id := (p_policy ->> 'supersedesPolicyVersionId')::uuid;
  v_policy_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_policy ->> 'policyFingerprint'
  );

  if not exists (
    select 1
    from public.business_entities as entity
    where entity.workspace_id = v_workspace_id
      and entity.id = v_business_entity_id
      and entity.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'source_authority_policy_entity_denied';
  end if;

  v_decision_actor_id := private.phase_2_decision_actor_v1(
    v_workspace_id,
    p_policy -> 'decision',
    p_actor_id,
    array['owner', 'admin']::text[]
  );

  if p_policy #>> '{decision,authority}' = 'deterministic_policy' then
    raise exception using errcode = '22023', message = 'source_authority_policy_human_decision_required';
  end if;

  select policy.*
  into v_existing
  from private.source_authority_policy_versions as policy
  where policy.id = v_policy_id;

  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id = v_business_entity_id
      and v_existing.policy_fingerprint = v_policy_fingerprint then
      return pg_catalog.jsonb_build_object(
        'policyVersionId', v_existing.id,
        'immutableVersion', v_existing.immutable_version,
        'policyFingerprint', p_policy ->> 'policyFingerprint',
        'ruleCount', (
          select count(*)
          from private.source_authority_policy_rules as rule
          where rule.policy_version_id = v_existing.id
        ),
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'source_authority_policy_id_conflict';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_workspace_id::text || ':' || v_business_entity_id::text || ':'
        || (p_policy ->> 'domainKey') || ':' || (p_policy ->> 'policyKey'),
      0
    )
  );

  select policy.*
  into v_previous
  from private.source_authority_policy_versions as policy
  where policy.workspace_id = v_workspace_id
    and policy.business_entity_id = v_business_entity_id
    and policy.domain_key = p_policy ->> 'domainKey'
    and policy.policy_key = p_policy ->> 'policyKey'
  order by policy.immutable_version desc
  limit 1;

  if not found then
    if v_immutable_version <> 1 or v_supersedes_id is not null then
      raise exception using errcode = '22023', message = 'source_authority_policy_first_version_invalid';
    end if;
  elsif v_immutable_version <> v_previous.immutable_version + 1
    or v_supersedes_id is distinct from v_previous.id then
    raise exception using errcode = '40001', message = 'source_authority_policy_version_stale';
  end if;

  insert into private.source_authority_policy_versions (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    domain_key,
    policy_key,
    immutable_version,
    supersedes_policy_version_id,
    effective_from,
    effective_through,
    conflict_behavior,
    fallback_mode,
    decision_authority,
    decision_policy_version,
    decision_actor_id,
    decision_decided_at,
    decision_reason_codes,
    policy_fingerprint
  ) values (
    v_policy_id,
    'source_authority_policy_v1',
    v_workspace_id,
    v_business_entity_id,
    p_policy ->> 'domainKey',
    p_policy ->> 'policyKey',
    v_immutable_version,
    v_supersedes_id,
    (p_policy ->> 'effectiveFrom')::timestamptz,
    (p_policy ->> 'effectiveThrough')::timestamptz,
    p_policy ->> 'conflictBehavior',
    p_policy ->> 'fallbackMode',
    p_policy #>> '{decision,authority}',
    p_policy #>> '{decision,policyVersion}',
    v_decision_actor_id,
    (p_policy #>> '{decision,decidedAt}')::timestamptz,
    array(
      select pg_catalog.jsonb_array_elements_text(p_policy #> '{decision,reasonCodes}')
    ),
    v_policy_fingerprint
  );

  for v_rule, v_ordinal in
    select item.value, item.ordinality
    from pg_catalog.jsonb_array_elements(p_policy -> 'rules')
      with ordinality as item(value, ordinality)
  loop
    insert into private.source_authority_policy_rules (
      workspace_id,
      business_entity_id,
      policy_version_id,
      rule_order,
      source_kind,
      provider_key,
      source_class,
      authority_role,
      authority_rank,
      contribution_mode
    ) values (
      v_workspace_id,
      v_business_entity_id,
      v_policy_id,
      v_ordinal::smallint,
      v_rule ->> 'sourceKind',
      v_rule ->> 'providerKey',
      v_rule ->> 'sourceClass',
      v_rule ->> 'authorityRole',
      (v_rule ->> 'authorityRank')::integer,
      v_rule ->> 'contributionMode'
    );
  end loop;

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
    case when v_decision_actor_id is null then 'service' else 'user' end,
    p_actor_id,
    'source_authority_policy.commit',
    'succeeded',
    'source_authority_policy_version',
    v_policy_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'domain_key', p_policy ->> 'domainKey',
      'policy_key', p_policy ->> 'policyKey',
      'immutable_version', v_immutable_version,
      'conflict_behavior', p_policy ->> 'conflictBehavior'
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'policyVersionId', v_policy_id,
    'immutableVersion', v_immutable_version,
    'policyFingerprint', p_policy ->> 'policyFingerprint',
    'ruleCount', pg_catalog.jsonb_array_length(p_policy -> 'rules'),
    'idempotent', false
  );
end;
$function$;

create or replace function private.validate_fact_contribution_batch_payload_v1(p_batch jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_event jsonb;
begin
  if not private.jsonb_has_exact_keys_v1(
    p_batch,
    array[
      'contractVersion',
      'id',
      'workspaceId',
      'businessEntityId',
      'reconciliationCaseId',
      'sourceAuthorityPolicyVersionId',
      'contributionFamilyVersionId',
      'batchFingerprint',
      'decision',
      'events'
    ]
  )
    or p_batch ->> 'contractVersion' <> 'fact_contribution_batch_v1'
    or pg_catalog.jsonb_typeof(p_batch -> 'id') <> 'string'
    or pg_catalog.jsonb_typeof(p_batch -> 'workspaceId') <> 'string'
    or pg_catalog.jsonb_typeof(p_batch -> 'businessEntityId') <> 'string'
    or pg_catalog.jsonb_typeof(p_batch -> 'reconciliationCaseId') <> 'string'
    or pg_catalog.jsonb_typeof(p_batch -> 'sourceAuthorityPolicyVersionId') <> 'string'
    or pg_catalog.jsonb_typeof(p_batch -> 'contributionFamilyVersionId') <> 'string'
    or not private.is_sha256_fingerprint_v1(p_batch ->> 'batchFingerprint')
    or not private.is_phase_2_decision_v1(p_batch -> 'decision')
    or pg_catalog.jsonb_typeof(p_batch -> 'events') <> 'array'
    or pg_catalog.jsonb_array_length(p_batch -> 'events') not between 1 and 100 then
    raise exception using errcode = '22023', message = 'fact_contribution_batch_payload_invalid';
  end if;

  for v_event in select value from pg_catalog.jsonb_array_elements(p_batch -> 'events')
  loop
    if not private.jsonb_has_exact_keys_v1(
      v_event,
      array[
        'contractVersion',
        'id',
        'eventKind',
        'factVersionId',
        'targetContributionEventId',
        'contributionIdentityFingerprint',
        'economicIdentityFingerprint',
        'effectiveAt',
        'periodStart',
        'periodEnd',
        'dimensions',
        'accountingBasis',
        'currency',
        'valueCanonical',
        'registryVersion',
        'eventFingerprint'
      ]
    )
      or v_event ->> 'contractVersion' <> 'fact_contribution_event_v1'
      or pg_catalog.jsonb_typeof(v_event -> 'id') <> 'string'
      or v_event ->> 'eventKind' not in ('establish', 'retract', 'control_observation')
      or pg_catalog.jsonb_typeof(v_event -> 'factVersionId') <> 'string'
      or pg_catalog.jsonb_typeof(v_event -> 'targetContributionEventId') not in ('string', 'null')
      or not private.is_sha256_fingerprint_v1(
        v_event ->> 'contributionIdentityFingerprint'
      )
      or not private.is_sha256_fingerprint_v1(
        v_event ->> 'economicIdentityFingerprint'
      )
      or pg_catalog.jsonb_typeof(v_event -> 'effectiveAt') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_event -> 'periodStart') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_event -> 'periodEnd') not in ('string', 'null')
      or not private.is_fact_dimensions_v1(v_event -> 'dimensions')
      or v_event ->> 'accountingBasis' not in ('accrual', 'cash', 'not_applicable', 'unknown')
      or pg_catalog.jsonb_typeof(v_event -> 'currency') not in ('string', 'null')
      or pg_catalog.jsonb_typeof(v_event -> 'valueCanonical') <> 'string'
      or not private.is_canonical_numeric_v1(
        v_event ->> 'valueCanonical',
        30,
        9,
        true,
        false,
        false
      )
      or not private.is_bounded_identifier_v1(v_event ->> 'registryVersion')
      or not private.is_sha256_fingerprint_v1(v_event ->> 'eventFingerprint')
      or (
        v_event ->> 'eventKind' = 'retract'
        and pg_catalog.jsonb_typeof(v_event -> 'targetContributionEventId') <> 'string'
      )
      or (
        v_event ->> 'eventKind' <> 'retract'
        and v_event -> 'targetContributionEventId' <> 'null'::jsonb
      )
      or ((v_event -> 'periodStart' = 'null'::jsonb) <> (v_event -> 'periodEnd' = 'null'::jsonb)) then
      raise exception using errcode = '22023', message = 'fact_contribution_event_payload_invalid';
    end if;
  end loop;
end;
$function$;

create or replace function public.commit_fact_contribution_batch_v1(
  p_batch jsonb,
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
  v_batch_id uuid;
  v_case_id uuid;
  v_policy_version_id uuid;
  v_family_version_id uuid;
  v_batch_fingerprint bytea;
  v_decision_actor_id uuid;
  v_case private.reconciliation_cases;
  v_family private.contribution_family_versions;
  v_existing private.fact_contribution_batches;
  v_event jsonb;
  v_event_id uuid;
  v_fact_version_id uuid;
  v_target_event_id uuid;
  v_event_kind text;
  v_contribution_identity bytea;
  v_economic_identity bytea;
  v_event_fingerprint bytea;
  v_fact record;
  v_target private.fact_contribution_events;
  v_value numeric(30,9);
  v_inserted integer := 0;
begin
  perform private.assert_external_integrations_authority_v1();
  perform private.validate_fact_contribution_batch_payload_v1(p_batch);

  if p_actor_id is null or char_length(p_actor_id) not between 1 and 200
    or p_request_id is null or char_length(p_request_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'fact_contribution_batch_request_invalid';
  end if;

  v_workspace_id := (p_batch ->> 'workspaceId')::uuid;
  v_business_entity_id := (p_batch ->> 'businessEntityId')::uuid;
  v_batch_id := (p_batch ->> 'id')::uuid;
  v_case_id := (p_batch ->> 'reconciliationCaseId')::uuid;
  v_policy_version_id := (p_batch ->> 'sourceAuthorityPolicyVersionId')::uuid;
  v_family_version_id := (p_batch ->> 'contributionFamilyVersionId')::uuid;
  v_batch_fingerprint := private.sha256_fingerprint_bytes_v1(
    p_batch ->> 'batchFingerprint'
  );

  select reconciliation_case.*
  into v_case
  from private.reconciliation_cases as reconciliation_case
  where reconciliation_case.workspace_id = v_workspace_id
    and reconciliation_case.business_entity_id = v_business_entity_id
    and reconciliation_case.id = v_case_id
    and reconciliation_case.source_authority_policy_version_id = v_policy_version_id;

  if not found then
    raise exception using errcode = '42501', message = 'fact_contribution_case_policy_substitution_denied';
  end if;

  if v_case.case_state <> 'resolved' then
    raise exception using errcode = '55000', message = 'review_required_case_cannot_contribute';
  end if;

  select family.*
  into v_family
  from private.contribution_family_versions as family
  where family.workspace_id = v_workspace_id
    and family.business_entity_id = v_business_entity_id
    and family.id = v_family_version_id
    and family.domain_key = (
      select policy.domain_key
      from private.source_authority_policy_versions as policy
      where policy.id = v_policy_version_id
        and policy.workspace_id = v_workspace_id
        and policy.business_entity_id = v_business_entity_id
    )
    and family.effective_from <= v_case.effective_at;

  if not found then
    raise exception using errcode = '42501', message = 'fact_contribution_family_substitution_denied';
  end if;

  if exists (
    select 1
    from private.contribution_family_versions as newer
    where newer.workspace_id = v_family.workspace_id
      and newer.business_entity_id = v_family.business_entity_id
      and newer.family_key = v_family.family_key
      and newer.effective_from <= v_case.effective_at
      and (
        newer.effective_from > v_family.effective_from
        or (
          newer.effective_from = v_family.effective_from
          and newer.immutable_version > v_family.immutable_version
        )
      )
  ) then
    raise exception using errcode = '40001', message = 'fact_contribution_family_version_stale';
  end if;

  v_decision_actor_id := private.phase_2_decision_actor_v1(
    v_workspace_id,
    p_batch -> 'decision',
    p_actor_id,
    array['owner', 'admin', 'manager']::text[]
  );

  if p_batch #>> '{decision,authority}' is distinct from v_case.decision_authority
    or p_batch #>> '{decision,policyVersion}' is distinct from v_case.decision_policy_version
    or v_decision_actor_id is distinct from v_case.decision_actor_id then
    raise exception using errcode = '42501', message = 'fact_contribution_decision_case_mismatch';
  end if;

  select batch.*
  into v_existing
  from private.fact_contribution_batches as batch
  where batch.id = v_batch_id;

  if found then
    if v_existing.workspace_id = v_workspace_id
      and v_existing.business_entity_id = v_business_entity_id
      and v_existing.batch_fingerprint = v_batch_fingerprint then
      return pg_catalog.jsonb_build_object(
        'contributionBatchId', v_existing.id,
        'eventCount', (
          select count(*)
          from private.fact_contribution_events as event
          where event.contribution_batch_id = v_existing.id
        ),
        'batchFingerprint', p_batch ->> 'batchFingerprint',
        'idempotent', true
      );
    end if;
    raise exception using errcode = '23505', message = 'fact_contribution_batch_id_conflict';
  end if;

  if v_case.classification = 'source_correction' then
    if (
      select count(*)
      from pg_catalog.jsonb_array_elements(p_batch -> 'events') as event
      where event.value ->> 'eventKind' = 'retract'
    ) <> 1
      or (
        select count(*)
        from pg_catalog.jsonb_array_elements(p_batch -> 'events') as event
        where event.value ->> 'eventKind' = 'establish'
      ) <> 1 then
      raise exception using errcode = '22023', message = 'source_correction_contribution_pair_required';
    end if;
  end if;

  if v_case.classification = 'independent_facts'
    and (
      select count(*)
      from pg_catalog.jsonb_array_elements(p_batch -> 'events') as event
      where event.value ->> 'eventKind' = 'establish'
    ) < 2 then
    raise exception using errcode = '22023', message = 'independent_fact_contributions_required';
  end if;

  insert into private.fact_contribution_batches (
    id,
    contract_version,
    workspace_id,
    business_entity_id,
    reconciliation_case_id,
    source_authority_policy_version_id,
    contribution_family_version_id,
    batch_fingerprint,
    decision_authority,
    decision_policy_version,
    decision_actor_id,
    decision_decided_at,
    decision_reason_codes
  ) values (
    v_batch_id,
    'fact_contribution_batch_v1',
    v_workspace_id,
    v_business_entity_id,
    v_case_id,
    v_policy_version_id,
    v_family_version_id,
    v_batch_fingerprint,
    p_batch #>> '{decision,authority}',
    p_batch #>> '{decision,policyVersion}',
    v_decision_actor_id,
    (p_batch #>> '{decision,decidedAt}')::timestamptz,
    array(select pg_catalog.jsonb_array_elements_text(p_batch #> '{decision,reasonCodes}'))
  );

  for v_event in select value from pg_catalog.jsonb_array_elements(p_batch -> 'events')
  loop
    v_event_id := (v_event ->> 'id')::uuid;
    v_fact_version_id := (v_event ->> 'factVersionId')::uuid;
    v_target_event_id := (v_event ->> 'targetContributionEventId')::uuid;
    v_event_kind := v_event ->> 'eventKind';
    v_contribution_identity := private.sha256_fingerprint_bytes_v1(
      v_event ->> 'contributionIdentityFingerprint'
    );
    v_economic_identity := private.sha256_fingerprint_bytes_v1(
      v_event ->> 'economicIdentityFingerprint'
    );
    v_event_fingerprint := private.sha256_fingerprint_bytes_v1(
      v_event ->> 'eventFingerprint'
    );
    v_value := (v_event ->> 'valueCanonical')::numeric(30,9);

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_workspace_id::text || ':' || v_business_entity_id::text || ':'
          || v_family_version_id::text || ':'
          || pg_catalog.encode(v_economic_identity, 'hex'),
        0
      )
    );

    if exists (
      select 1 from private.fact_contribution_events where id = v_event_id
    ) then
      raise exception using errcode = '23505', message = 'fact_contribution_event_id_conflict';
    end if;

    select
      fact_version.*,
      fact.fact_kind,
      fact.current_version_id
    into v_fact
    from private.canonical_business_fact_versions as fact_version
    join private.canonical_business_facts as fact
      on fact.workspace_id = fact_version.workspace_id
      and fact.business_entity_id = fact_version.business_entity_id
      and fact.id = fact_version.fact_id
    join private.reconciliation_case_members as member
      on member.workspace_id = fact_version.workspace_id
      and member.business_entity_id = fact_version.business_entity_id
      and member.reconciliation_case_id = v_case_id
      and member.fact_version_id = fact_version.id
    where fact_version.workspace_id = v_workspace_id
      and fact_version.business_entity_id = v_business_entity_id
      and fact_version.id = v_fact_version_id
      and member.economic_identity_fingerprint = v_economic_identity;

    if not found then
      raise exception using errcode = '42501', message = 'fact_contribution_fact_substitution_denied';
    end if;

    if not (v_fact.fact_kind = any(v_family.allowed_fact_kinds)) then
      raise exception using errcode = '22023', message = 'fact_contribution_kind_not_registered';
    end if;

    if v_event_kind = 'establish' then
      if v_family.contribution_mode <> 'additive_transaction'
        or v_fact.reconciliation_state <> 'accepted'
        or v_fact.validation_state <> 'valid'
        or v_fact.current_version_id <> v_fact_version_id
        or (
          v_case.winning_fact_version_id is not null
          and v_case.winning_fact_version_id <> v_fact_version_id
        ) then
        raise exception using errcode = '55000', message = 'fact_contribution_establish_ineligible';
      end if;
    elsif v_event_kind = 'control_observation' then
      if v_family.contribution_mode <> 'non_additive_control'
        or v_fact.reconciliation_state = 'tombstone'
        or v_fact.validation_state <> 'valid' then
        raise exception using errcode = '55000', message = 'fact_control_observation_ineligible';
      end if;
    elsif v_family.contribution_mode <> 'additive_transaction' then
      raise exception using errcode = '55000', message = 'fact_contribution_retraction_ineligible';
    end if;

    if v_fact.value_kind not in ('money', 'decimal', 'percentage', 'integer')
      or v_fact.numeric_value_canonical is distinct from v_event ->> 'valueCanonical'
      or v_fact.dimensions is distinct from v_event -> 'dimensions'
      or v_fact.effective_at is distinct from (v_event ->> 'effectiveAt')::timestamptz
      or v_fact.period_start is distinct from (v_event ->> 'periodStart')::date
      or v_fact.period_end is distinct from (v_event ->> 'periodEnd')::date
      or v_fact.accounting_basis is distinct from v_event ->> 'accountingBasis'
      or (
        v_fact.value_kind = 'money'
        and (
          v_fact.source_currency is distinct from v_fact.reporting_currency
          or pg_catalog.btrim(v_fact.value_currency) is distinct from v_event ->> 'currency'
        )
      )
      or (
        v_fact.value_kind <> 'money'
        and v_event -> 'currency' <> 'null'::jsonb
      )
      or v_family.registry_version is distinct from v_event ->> 'registryVersion' then
      raise exception using errcode = '22023', message = 'fact_contribution_semantics_mismatch';
    end if;

    if v_event_kind = 'establish' and exists (
      select 1
      from private.fact_contribution_events as established
      where established.workspace_id = v_workspace_id
        and established.business_entity_id = v_business_entity_id
        and established.contribution_family_version_id = v_family_version_id
        and established.economic_identity_fingerprint = v_economic_identity
        and established.event_kind = 'establish'
        and not exists (
          select 1
          from private.fact_contribution_events as retraction
          where retraction.workspace_id = established.workspace_id
            and retraction.business_entity_id = established.business_entity_id
            and retraction.event_kind = 'retract'
            and retraction.target_contribution_event_id = established.id
        )
    ) then
      raise exception using errcode = '23505', message = 'duplicate_active_fact_contribution';
    end if;

    if v_event_kind = 'retract' then
      select target.*
      into v_target
      from private.fact_contribution_events as target
      where target.workspace_id = v_workspace_id
        and target.business_entity_id = v_business_entity_id
        and target.id = v_target_event_id
        and target.event_kind = 'establish'
        and target.contribution_family_version_id = v_family_version_id
        and target.contribution_identity_fingerprint = v_contribution_identity;

      if not found
        or v_target.value_canonical is distinct from v_event ->> 'valueCanonical'
        or v_target.economic_identity_fingerprint is distinct from v_economic_identity
        or v_target.measure_key is distinct from v_family.measure_key
        or v_target.aggregate_key is distinct from v_family.aggregate_key
        or exists (
          select 1
          from private.fact_contribution_events as prior_retraction
          where prior_retraction.workspace_id = v_workspace_id
            and prior_retraction.business_entity_id = v_business_entity_id
            and prior_retraction.event_kind = 'retract'
            and prior_retraction.target_contribution_event_id = v_target_event_id
        ) then
        raise exception using errcode = '55000', message = 'fact_contribution_retraction_invalid';
      end if;
    end if;

    insert into private.fact_contribution_events (
      id,
      contract_version,
      workspace_id,
      business_entity_id,
      contribution_batch_id,
      reconciliation_case_id,
      source_authority_policy_version_id,
      contribution_family_version_id,
      fact_version_id,
      event_kind,
      target_contribution_event_id,
      contribution_identity_fingerprint,
      economic_identity_fingerprint,
      measure_key,
      aggregate_key,
      effective_at,
      period_start,
      period_end,
      dimensions,
      accounting_basis,
      currency,
      value_canonical,
      value,
      registry_version,
      event_fingerprint
    ) values (
      v_event_id,
      'fact_contribution_event_v1',
      v_workspace_id,
      v_business_entity_id,
      v_batch_id,
      v_case_id,
      v_policy_version_id,
      v_family_version_id,
      v_fact_version_id,
      v_event_kind,
      v_target_event_id,
      v_contribution_identity,
      v_economic_identity,
      v_family.measure_key,
      v_family.aggregate_key,
      (v_event ->> 'effectiveAt')::timestamptz,
      (v_event ->> 'periodStart')::date,
      (v_event ->> 'periodEnd')::date,
      v_event -> 'dimensions',
      v_event ->> 'accountingBasis',
      v_event ->> 'currency',
      v_event ->> 'valueCanonical',
      v_value,
      v_event ->> 'registryVersion',
      v_event_fingerprint
    );
    v_inserted := v_inserted + 1;
  end loop;

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
    case when v_decision_actor_id is null then 'service' else 'user' end,
    p_actor_id,
    'fact_contribution_batch.commit',
    'succeeded',
    'fact_contribution_batch',
    v_batch_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'reconciliation_case_id', v_case_id,
      'family_version_id', v_family_version_id,
      'inserted_events', v_inserted
    ),
    'authorization'
  );

  return pg_catalog.jsonb_build_object(
    'contributionBatchId', v_batch_id,
    'eventCount', v_inserted,
    'insertedEventCount', v_inserted,
    'batchFingerprint', p_batch ->> 'batchFingerprint',
    'idempotent', false
  );
end;
$function$;

create or replace function public.read_fact_contribution_aggregate_v1(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_contribution_family_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_family private.contribution_family_versions;
  v_total numeric(30,9);
  v_established bigint;
  v_retracted bigint;
  v_controls bigint;
begin
  perform private.assert_external_integrations_authority_v1();

  select family.*
  into v_family
  from private.contribution_family_versions as family
  where family.workspace_id = p_workspace_id
    and family.business_entity_id = p_business_entity_id
    and family.id = p_contribution_family_version_id;

  if not found then
    raise exception using errcode = '42501', message = 'fact_contribution_aggregate_scope_denied';
  end if;

  select
    coalesce(sum(event.signed_value), 0::numeric),
    count(*) filter (where event.event_kind = 'establish'),
    count(*) filter (where event.event_kind = 'retract'),
    count(*) filter (where event.event_kind = 'control_observation')
  into v_total, v_established, v_retracted, v_controls
  from private.fact_contribution_events as event
  where event.workspace_id = p_workspace_id
    and event.business_entity_id = p_business_entity_id
    and event.contribution_family_version_id = p_contribution_family_version_id;

  return pg_catalog.jsonb_build_object(
    'workspaceId', p_workspace_id,
    'businessEntityId', p_business_entity_id,
    'contributionFamilyVersionId', p_contribution_family_version_id,
    'familyKey', v_family.family_key,
    'measureKey', v_family.measure_key,
    'aggregateKey', v_family.aggregate_key,
    'contributionMode', v_family.contribution_mode,
    'registryVersion', v_family.registry_version,
    'currentTotal', pg_catalog.trim_scale(v_total)::text,
    'establishedCount', v_established,
    'retractedCount', v_retracted,
    'controlObservationCount', v_controls
  );
end;
$function$;

revoke all on function public.commit_source_authority_policy_version_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_source_authority_policy_version_v1(jsonb, text, text)
  to external_integrations_authority;

revoke all on function public.commit_contribution_family_version_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_contribution_family_version_v1(jsonb, text, text)
  to external_integrations_authority;

revoke all on function public.commit_reconciliation_case_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_reconciliation_case_v1(jsonb, text, text)
  to external_integrations_authority;

revoke all on function public.commit_fact_contribution_batch_v1(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_fact_contribution_batch_v1(jsonb, text, text)
  to external_integrations_authority;

revoke all on function public.read_fact_contribution_aggregate_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_fact_contribution_aggregate_v1(uuid, uuid, uuid)
  to external_integrations_authority;
