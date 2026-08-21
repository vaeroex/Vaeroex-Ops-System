begin;

-- The hosted management connection is intentionally not a member of the
-- no-login authority role. This test-only membership is transactional.
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

create or replace function pg_temp.deferred_provenance_raises(p_sql text, p_expected text)
returns boolean
language plpgsql
as $function$
declare
  v_state text;
begin
  execute p_sql;
  set constraints all immediate;
  set constraints all deferred;
  return false;
exception when others then
  v_state := sqlstate;
  set constraints all deferred;
  return v_state = p_expected;
end;
$function$;

create temporary table phase_1_test_ids (
  key text primary key,
  value text not null
);
grant select, insert, update, delete on table phase_1_test_ids
  to authenticated, service_role, external_integrations_authority;

create or replace function pg_temp.source_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_actor_id uuid,
  p_version_id uuid,
  p_entry_reference text,
  p_source_fingerprint text,
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
    'recordKind', 'manual_journal_observation',
    'source', jsonb_build_object(
      'kind', 'manual',
      'actorId', p_actor_id,
      'entryReference', p_entry_reference
    ),
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
    'normalizedSchemaVersion', 'manual_journal_observation_v1',
    'changeKind', 'created',
    'normalizedProjection', jsonb_build_object('accountKey', 'revenue', 'amount', '1234.5'),
    'trust', 'untrusted_external_input',
    'validation', jsonb_build_object(
      'state', p_validation_state,
      'validatorVersion', 'manual_source_validator_v1',
      'issues', case
        when p_validation_state = 'valid' then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'code', 'invalid_fixture',
          'severity', 'error',
          'field', null,
          'detail', 'Synthetic invalid source fixture'
        ))
      end
    ),
    'receivedAt', '2026-08-20T20:00:03.000Z',
    'sourceFingerprint', p_source_fingerprint
  );
$function$;

create or replace function pg_temp.fact_payload(
  p_workspace_id uuid,
  p_business_entity_id uuid,
  p_version_id uuid,
  p_source_version_id uuid,
  p_source_fingerprint text,
  p_fact_fingerprint text,
  p_fact_kind text default 'recognized_revenue',
  p_fact_key text default 'recognized_revenue:2026-08-20:manual_journal'
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
    'factKind', p_fact_kind,
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
    'value', jsonb_build_object('kind', 'money', 'amount', '1234.5', 'currency', 'USD'),
    'reconciliationState', 'accepted',
    'validationState', 'valid',
    'sources', jsonb_build_array(jsonb_build_object(
      'sourceRecordVersionId', p_source_version_id,
      'sourceFingerprint', p_source_fingerprint,
      'sourceRole', 'primary',
      'contributionWeight', '1'
    )),
    'decision', jsonb_build_object(
      'authority', 'deterministic_policy',
      'policyVersion', 'phase_1_acceptance_policy_v1',
      'actorId', null,
      'decidedAt', '2026-08-20T20:01:00.000Z',
      'reasonCodes', jsonb_build_array('validated_source', 'single_source_foundation')
    ),
    'normalizationVersion', 'recognized_revenue_normalization_v1',
    'transformationVersion', 'recognized_revenue_transformation_v1',
    'sourceObservedAt', '2026-08-20T20:00:00.000Z',
    'createdAt', '2026-08-20T20:01:01.000Z',
    'factFingerprint', p_fact_fingerprint
  );
$function$;

insert into public.profiles (id, email, full_name) values
  ('a7100000-0000-4000-8000-000000000001', 'phase1-owner@example.test', 'Phase 1 Owner'),
  ('a7100000-0000-4000-8000-000000000002', 'phase1-admin@example.test', 'Phase 1 Admin'),
  ('a7100000-0000-4000-8000-000000000003', 'phase1-manager@example.test', 'Phase 1 Manager'),
  ('a7100000-0000-4000-8000-000000000004', 'phase1-staff@example.test', 'Phase 1 Staff'),
  ('a7100000-0000-4000-8000-000000000005', 'phase1-viewer@example.test', 'Phase 1 Viewer'),
  ('a7100000-0000-4000-8000-000000000006', 'phase1-nonmember@example.test', 'Phase 1 Nonmember'),
  ('a7100000-0000-4000-8000-000000000007', 'phase1-other-owner@example.test', 'Phase 1 Other Owner');

insert into public.workspaces (id, name, created_by) values
  ('b7100000-0000-4000-8000-000000000001', 'Phase 1 Workspace A', 'a7100000-0000-4000-8000-000000000001'),
  ('b7100000-0000-4000-8000-000000000002', 'Phase 1 Workspace B', 'a7100000-0000-4000-8000-000000000007');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c7100000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c7100000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('c7100000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000003', 'manager', 'active'),
  ('c7100000-0000-4000-8000-000000000004', 'b7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000004', 'staff', 'active'),
  ('c7100000-0000-4000-8000-000000000005', 'b7100000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000005', 'viewer', 'active'),
  ('c7100000-0000-4000-8000-000000000007', 'b7100000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000007', 'owner', 'active');

select ok(
  exists (select 1 from pg_namespace where nspname = 'private'),
  'the authoritative private schema exists'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.business_entities'::regclass),
  'Business Entities have forced RLS'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'business_entities'),
  1,
  'Business Entities expose only the member-read RLS policy'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('service_role', 'private', 'USAGE')
  and not has_schema_privilege('external_integrations_authority', 'private', 'USAGE'),
  'no API role has private-schema usage'
);
select ok(
  not has_table_privilege('anon', 'private.external_source_record_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'private.external_source_record_versions', 'SELECT')
  and not has_table_privilege('service_role', 'private.external_source_record_versions', 'SELECT'),
  'source versions have no direct API read grant'
);
select ok(
  not has_table_privilege('service_role', 'private.canonical_business_fact_versions', 'INSERT')
  and not has_table_privilege('service_role', 'private.canonical_business_fact_versions', 'UPDATE')
  and not has_table_privilege('service_role', 'private.canonical_business_fact_versions', 'DELETE'),
  'server authority cannot bypass fact RPCs with direct table writes'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.commit_external_source_record_version_v1(text,jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.commit_canonical_business_fact_version_v2(text,jsonb,text,text)',
    'EXECUTE'
  ),
  'the broad service role receives no Phase 1 commit authority'
);
select ok(
  has_function_privilege(
    'external_integrations_authority',
    'public.commit_external_source_record_version_v1(text,jsonb,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'external_integrations_authority',
    'public.commit_canonical_business_fact_version_v2(text,jsonb,text,text)',
    'EXECUTE'
  ),
  'only the narrow integration authority receives checked commit RPCs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.commit_external_source_record_version_v1(text,jsonb,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.commit_canonical_business_fact_version_v2(text,jsonb,text,text)',
    'EXECUTE'
  ),
  'client roles cannot execute source or fact authority RPCs'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;

insert into phase_1_test_ids(key, value)
select 'entity_a', result ->> 'id'
from (
  select public.create_business_entity_v1(
    'b7100000-0000-4000-8000-000000000001',
    null,
    'primary_company',
    'operating_company',
    'Primary Company',
    'Primary Company, Inc.',
    'USD',
    null,
    'America/Los_Angeles',
    1::smallint,
    null
  ) as result
) as created;

select is(
  (select count(*)::integer from public.business_entities),
  1,
  'an Owner creates the first Business Entity through the checked RPC'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.business_entities (
        workspace_id, entity_key, display_name, base_currency, timezone, created_by, updated_by
      ) values (
        'b7100000-0000-4000-8000-000000000001',
        'forged_entity',
        'Forged Entity',
        'USD',
        'UTC',
        'a7100000-0000-4000-8000-000000000001',
        'a7100000-0000-4000-8000-000000000001'
      )$$,
    '42501'
  ),
  'an Owner cannot insert a Business Entity directly'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from public.business_entities
      where id = (select value::uuid from phase_1_test_ids where key = 'entity_a')$$,
    '42501'
  ),
  'an Owner has no direct Business Entity deletion path'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.update_business_entity_v1(
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      1,
      '{"entityKey":"replacement_key"}'::jsonb
    )$$,
    '22023'
  ),
  'entityKey cannot be patched after creation'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.update_business_entity_v1(
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      1,
      '{"displayName":1}'::jsonb
    )$$,
    '22023'
  ),
  'Business Entity patches reject JSON type confusion before assignment'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000003"}',
  true
);
set local role authenticated;

select is(
  public.update_business_entity_v1(
    (select value::uuid from phase_1_test_ids where key = 'entity_a'),
    1,
    '{"displayName":"Primary Company Updated","status":"inactive"}'::jsonb
  ) ->> 'displayName',
  'Primary Company Updated',
  'a Manager may update safe Business Entity fields through CAS RPC'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.update_business_entity_v1(
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      1,
      '{"status":"active"}'::jsonb
    )$$,
    '40001'
  ),
  'a stale Business Entity row version is rejected'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000004"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.update_business_entity_v1(
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      2,
      '{"status":"active"}'::jsonb
    )$$,
    '42501'
  ),
  'a Staff contributor cannot mutate the Business Entity boundary'
);
select is(
  (select count(*)::integer from public.business_entities),
  1,
  'a Staff member can read only the authorized workspace entity'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000006"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::integer from public.business_entities),
  0,
  'an authenticated nonmember reads no Business Entity rows'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_business_entity_v1(
      'b7100000-0000-4000-8000-000000000001', null, 'forged', 'operating_company',
      'Forged', null, 'USD', null, 'UTC', 1::smallint, null
    )$$,
    '42501'
  ),
  'an authenticated nonmember cannot forge Business Entity ownership'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000007"}',
  true
);
set local role authenticated;
insert into phase_1_test_ids(key, value)
select 'entity_b', result ->> 'id'
from (
  select public.create_business_entity_v1(
    'b7100000-0000-4000-8000-000000000002', null, 'other_company', 'operating_company',
    'Other Company', null, 'USD', null, 'UTC', 1::smallint, null
  ) as result
) as created;
select is(
  (select count(*)::integer from public.business_entities),
  1,
  'Workspace B owner sees only Workspace B entity'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000001"}',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_sqlstate(
    $$select public.create_business_entity_v1(
      'b7100000-0000-4000-8000-000000000001',
      (select value::uuid from phase_1_test_ids where key = 'entity_b'),
      'forged_child',
      'division',
      'Forged Child',
      null,
      'USD',
      null,
      'UTC',
      1::smallint,
      null
    )$$,
    '23503'
  ),
  'a valid foreign parent ID cannot cross the workspace composite boundary'
);

reset role;
set local role anon;
select ok(
  not has_function_privilege(
    'anon',
    'public.create_business_entity_v1(uuid,uuid,text,text,text,text,text,text,text,smallint,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot create Business Entities'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"external_integrations_authority","sub":"a7100000-0000-4000-8000-000000000001"}',
  true
);
set local role external_integrations_authority;

insert into phase_1_test_ids(key, value)
select 'source_a', result ->> 'sourceVersionId'
from (
  select public.commit_external_source_record_version_v1(
    'sha256:' || repeat('a', 64),
    pg_temp.source_payload(
      'b7100000-0000-4000-8000-000000000001',
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      'a7100000-0000-4000-8000-000000000001',
      'd7100000-0000-4000-8000-000000000001',
      'journal_entry_1',
      'sha256:' || repeat('b', 64)
    ),
    'phase1_source_request_1',
    'phase1_test_service'
  ) as result
) as committed;

select is(
  (
    public.commit_external_source_record_version_v1(
      'sha256:' || repeat('a', 64),
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'a7100000-0000-4000-8000-000000000001',
        'd7100000-0000-4000-8000-000000000001',
        'journal_entry_1',
        'sha256:' || repeat('b', 64)
      ),
      'phase1_source_request_1_retry',
      'phase1_test_service'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'replaying an identical source commit is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_external_source_record_version_v1(
      'not-a-hash',
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'a7100000-0000-4000-8000-000000000001',
        'd7100000-0000-4000-8000-000000000009',
        'journal_entry_bad_hash',
        'sha256:' || repeat('c', 64)
      ),
      'phase1_bad_hash',
      'phase1_test_service'
    )$$,
    '22023'
  ),
  'malformed identity hashes are rejected'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_external_source_record_version_v1(
      'sha256:' || repeat('c', 64),
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_b'),
        'a7100000-0000-4000-8000-000000000001',
        'd7100000-0000-4000-8000-000000000010',
        'journal_entry_cross_entity',
        'sha256:' || repeat('d', 64)
      ),
      'phase1_cross_entity',
      'phase1_test_service'
    )$$,
    '23503'
  ),
  'a Business Entity from another workspace cannot be substituted into a source commit'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_external_source_record_version_v1(
      'sha256:' || repeat('c', 64),
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'a7100000-0000-4000-8000-000000000007',
        'd7100000-0000-4000-8000-000000000011',
        'journal_entry_cross_actor',
        'sha256:' || repeat('d', 64)
      ),
      'phase1_cross_actor',
      'phase1_test_service'
    )$$,
    '42501'
  ),
  'manual source actors must belong to the source workspace'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_external_source_record_version_v1(
      'sha256:' || repeat('c', 64),
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'a7100000-0000-4000-8000-000000000001',
        'd7100000-0000-4000-8000-000000000012',
        'journal_entry_deleted_projection',
        'sha256:' || repeat('d', 64)
      ) || '{"changeKind":"deleted"}'::jsonb,
      'phase1_deleted_projection',
      'phase1_test_service'
    )$$,
    '23514'
  ),
  'deleted source versions cannot retain normalized projections'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_external_source_record_version_v1(
      'sha256:' || repeat('c', 64),
      pg_temp.source_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'a7100000-0000-4000-8000-000000000001',
        'd7100000-0000-4000-8000-000000000013',
        'journal_entry_provider_deferred',
        'sha256:' || repeat('d', 64)
      ) || jsonb_build_object(
        'connectionId', 'e7100000-0000-4000-8000-000000000001',
        'source', jsonb_build_object(
          'kind', 'provider',
          'providerKey', 'ledger_demo',
          'providerRecordType', 'journal_entry',
          'providerRecordId', 'entry_1',
          'providerVersionReference', 'revision_1'
        )
      ),
      'phase1_provider_deferred',
      'phase1_test_service'
    )$$,
    '0A000'
  ),
  'provider source commits fail closed until a tenant-bound connection authority exists'
);

insert into phase_1_test_ids(key, value)
select 'source_invalid', result ->> 'sourceVersionId'
from (
  select public.commit_external_source_record_version_v1(
    'sha256:' || repeat('c', 64),
    pg_temp.source_payload(
      'b7100000-0000-4000-8000-000000000001',
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      'a7100000-0000-4000-8000-000000000001',
      'd7100000-0000-4000-8000-000000000002',
      'journal_entry_invalid',
      'sha256:' || repeat('d', 64),
      'invalid'
    ),
    'phase1_source_invalid',
    'phase1_test_service'
  ) as result
) as committed;

reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000007"}',
  true
);
set local role authenticated;
select set_config(
  'phase1.entity_b',
  (select value from phase_1_test_ids where key = 'entity_b'),
  true
);
reset role;
select set_config(
  'request.jwt.claims',
  '{"role":"external_integrations_authority","sub":"a7100000-0000-4000-8000-000000000007"}',
  true
);
set local role external_integrations_authority;
insert into phase_1_test_ids(key, value)
select 'source_b', result ->> 'sourceVersionId'
from (
  select public.commit_external_source_record_version_v1(
    'sha256:' || repeat('e', 64),
    pg_temp.source_payload(
      'b7100000-0000-4000-8000-000000000002',
      current_setting('phase1.entity_b')::uuid,
      'a7100000-0000-4000-8000-000000000007',
      'd7100000-0000-4000-8000-000000000003',
      'journal_entry_workspace_b',
      'sha256:' || repeat('f', 64)
    ),
    'phase1_source_b',
    'phase1_test_service'
  ) as result
) as committed;

insert into phase_1_test_ids(key, value)
select 'fact_a', result ->> 'factVersionId'
from (
  select public.commit_canonical_business_fact_version_v2(
    'sha256:' || repeat('1', 64),
    pg_temp.fact_payload(
      'b7100000-0000-4000-8000-000000000001',
      (select value::uuid from phase_1_test_ids where key = 'entity_a'),
      'f7100000-0000-4000-8000-000000000001',
      (select value::uuid from phase_1_test_ids where key = 'source_a'),
      'sha256:' || repeat('b', 64),
      'sha256:' || repeat('2', 64)
    ),
    'phase1_fact_request_1',
    'phase1_test_service'
  ) as result
) as committed;

select is(
  (
    public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('1', 64),
      pg_temp.fact_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'f7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'source_a'),
        'sha256:' || repeat('b', 64),
        'sha256:' || repeat('2', 64)
      ),
      'phase1_fact_request_1_retry',
      'phase1_test_service'
    ) ->> 'idempotent'
  )::boolean,
  true,
  'replaying an identical fact commit is idempotent'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      pg_temp.fact_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'f7100000-0000-4000-8000-000000000002',
        (select value::uuid from phase_1_test_ids where key = 'source_b'),
        'sha256:' || repeat('f', 64),
        'sha256:' || repeat('4', 64),
        'cross_workspace_fact',
        'cross_workspace_fact:1'
      ),
      'phase1_fact_cross_source',
      'phase1_test_service'
    )$$,
    '23503'
  ),
  'a source version from another workspace cannot be substituted into a fact'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      pg_temp.fact_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'f7100000-0000-4000-8000-000000000003',
        (select value::uuid from phase_1_test_ids where key = 'source_a'),
        'sha256:' || repeat('9', 64),
        'sha256:' || repeat('4', 64),
        'fingerprint_substitution',
        'fingerprint_substitution:1'
      ),
      'phase1_fact_bad_source_hash',
      'phase1_test_service'
    )$$,
    '23503'
  ),
  'a forged source fingerprint cannot satisfy provenance'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      pg_temp.fact_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'f7100000-0000-4000-8000-000000000004',
        (select value::uuid from phase_1_test_ids where key = 'source_invalid'),
        'sha256:' || repeat('d', 64),
        'sha256:' || repeat('4', 64),
        'invalid_source_fact',
        'invalid_source_fact:1'
      ),
      'phase1_fact_invalid_source',
      'phase1_test_service'
    )$$,
    '23514'
  ),
  'an invalid source cannot produce an accepted fact'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      jsonb_set(
        pg_temp.fact_payload(
          'b7100000-0000-4000-8000-000000000001',
          (select value::uuid from phase_1_test_ids where key = 'entity_a'),
          'f7100000-0000-4000-8000-000000000005',
          (select value::uuid from phase_1_test_ids where key = 'source_a'),
          'sha256:' || repeat('b', 64),
          'sha256:' || repeat('4', 64),
          'empty_source_fact',
          'empty_source_fact:1'
        ),
        '{sources}',
        '[]'::jsonb
      ),
      'phase1_fact_empty_sources',
      'phase1_test_service'
    )$$,
    '22023'
  ),
  'the checked fact RPC rejects an empty source set before insertion'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      jsonb_set(
        pg_temp.fact_payload(
          'b7100000-0000-4000-8000-000000000001',
          (select value::uuid from phase_1_test_ids where key = 'entity_a'),
          'f7100000-0000-4000-8000-000000000006',
          (select value::uuid from phase_1_test_ids where key = 'source_a'),
          'sha256:' || repeat('b', 64),
          'sha256:' || repeat('4', 64),
          'oversized_decimal_fact',
          'oversized_decimal_fact:1'
        ),
        '{value,amount}',
        '"1234567890123456789012"'::jsonb
      ),
      'phase1_fact_oversized_decimal',
      'phase1_test_service'
    )$$,
    '22023'
  ),
  'numeric(30,9) overflow is rejected before casting or persistence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('3', 64),
      jsonb_set(
        jsonb_set(
          jsonb_set(
            pg_temp.fact_payload(
              'b7100000-0000-4000-8000-000000000001',
              (select value::uuid from phase_1_test_ids where key = 'entity_a'),
              'f7100000-0000-4000-8000-000000000007',
              (select value::uuid from phase_1_test_ids where key = 'source_a'),
              'sha256:' || repeat('b', 64),
              'sha256:' || repeat('4', 64),
              'oversized_rate_fact',
              'oversized_rate_fact:1'
            ),
            '{accounting,reportingCurrency}',
            '"EUR"'::jsonb
          ),
          '{accounting,exchangeRate}',
          '"1234567890123456789"'::jsonb
        ),
        '{accounting,exchangeRateSource}',
        '"daily_rate_v1"'::jsonb
      ),
      'phase1_fact_oversized_rate',
      'phase1_test_service'
    )$$,
    '22023'
  ),
  'numeric(30,12) exchange-rate overflow is rejected before casting or persistence'
);
select ok(
  pg_temp.raises_sqlstate(
    $$select public.commit_canonical_business_fact_version_v2(
      'sha256:' || repeat('8', 64),
      pg_temp.fact_payload(
        'b7100000-0000-4000-8000-000000000001',
        (select value::uuid from phase_1_test_ids where key = 'entity_a'),
        'f7100000-0000-4000-8000-000000000008',
        (select value::uuid from phase_1_test_ids where key = 'source_a'),
        'sha256:' || repeat('b', 64),
        'sha256:' || repeat('8', 64)
      ),
      'phase1_fact_identity_mismatch',
      'phase1_test_service'
    )$$,
    '23505'
  ),
  'the same factKind and factKey cannot acquire a competing identity fingerprint'
);

reset role;
select results_eq(
  $$select
      fact.fact_kind,
      fact.fact_key,
      version.contract_version,
      version.numeric_value_canonical,
      version.numeric_value::text,
      version.decision_authority,
      count(edge.id)::bigint
    from private.canonical_business_facts as fact
    join private.canonical_business_fact_versions as version
      on version.id = fact.current_version_id
    join private.business_fact_sources as edge
      on edge.fact_version_id = version.id
    where fact.workspace_id = 'b7100000-0000-4000-8000-000000000001'
      and fact.business_entity_id = (select value::uuid from phase_1_test_ids where key = 'entity_a')
    group by fact.fact_kind, fact.fact_key, version.contract_version,
      version.numeric_value_canonical, version.numeric_value, version.decision_authority$$,
  $$values (
    'recognized_revenue'::text,
    'recognized_revenue:2026-08-20:manual_journal'::text,
    'canonical_business_fact_version_v2'::text,
    '1234.5'::text,
    '1234.500000000'::text,
    'deterministic_policy'::text,
    1::bigint
  )$$,
  'V2 fact truth, exact canonical decimal, query projection, decision, and provenance reconstruct together'
);
select results_eq(
  $$select
      version.change_kind,
      version.validation_state,
      version.normalized_projection ->> 'amount',
      encode(version.source_fingerprint, 'hex')
    from private.external_source_record_versions as version
    where version.id = (select value::uuid from phase_1_test_ids where key = 'source_a')$$,
  $$values ('created'::text, 'valid'::text, '1234.5'::text, repeat('b', 64)::text)$$,
  'the immutable source version reconstructs normalized truth and its exact fingerprint'
);

set local role external_integrations_authority;
select ok(
  pg_temp.raises_sqlstate(
    $$select * from private.canonical_business_fact_versions$$,
    '42501'
  ),
  'the narrow authority cannot directly read private fact rows'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.canonical_business_facts set current_version_id = null$$,
    '42501'
  ),
  'the narrow authority cannot manipulate canonical fact pointers directly'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.external_source_records set current_version_id = null$$,
    '42501'
  ),
  'the narrow authority cannot manipulate source pointers directly'
);

reset role;
select ok(
  pg_temp.raises_sqlstate(
    $$update private.external_source_record_versions
      set validation_state = 'invalid'
      where id = 'd7100000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'source version history is immutable even to direct database maintenance paths'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.canonical_business_fact_versions
      where id = 'f7100000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'fact version history cannot be deleted'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update private.business_fact_sources
      set source_role = 'corroborating'
      where fact_version_id = 'f7100000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'provenance edges cannot be replaced'
);
select ok(
  pg_temp.raises_sqlstate(
    $$delete from private.integration_audit_events
      where target_id = 'f7100000-0000-4000-8000-000000000001'$$,
    '55000'
  ),
  'integration audit events are immutable'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.business_entities
      set entity_key = 'rewritten_identity'
      where id = (select value::uuid from phase_1_test_ids where key = 'entity_a')$$,
    '55000'
  ),
  'entityKey remains immutable below the RPC layer'
);
select ok(
  pg_temp.deferred_provenance_raises(
    $$insert into private.canonical_business_fact_versions (
      id, contract_version, workspace_id, business_entity_id, fact_id, immutable_version,
      prior_version_id, dimensions, closed_period, accounting_basis, reconciliation_state,
      validation_state, decision_authority, decision_policy_version, decision_decided_at,
      decision_reason_codes, normalization_version, transformation_version,
      source_observed_at, created_at, fact_fingerprint
    )
    select
      'f7100000-0000-4000-8000-000000000099',
      contract_version,
      workspace_id,
      business_entity_id,
      fact_id,
      2,
      id,
      '[]'::jsonb,
      false,
      'unknown',
      'tombstone',
      'valid',
      'deterministic_policy',
      'phase_1_acceptance_policy_v1',
      transaction_timestamp(),
      '{}'::text[],
      'recognized_revenue_normalization_v1',
      'recognized_revenue_transformation_v1',
      transaction_timestamp(),
      transaction_timestamp(),
      decode(repeat('9', 64), 'hex')
    from private.canonical_business_fact_versions
    where id = 'f7100000-0000-4000-8000-000000000001'$$,
    '23514'
  ),
  'the deferred constraint rejects a directly inserted fact version with no provenance'
);

select * from finish();
rollback;
