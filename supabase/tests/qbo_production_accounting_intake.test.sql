begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/qbo-production-native.sql

select is((select count(*)::int from private.qbo_accounting_authority_versions),0,'migration enables no financial authority');
select is((select count(*)::int from private.qbo_accounting_source_applications),0,'migration processes no customer sources');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.qbo_accounting_authority_versions'::regclass),'owner authority has forced RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='private.qbo_accounting_source_applications'::regclass),'financial receipts have forced RLS');
select ok(not has_function_privilege('service_role',
  'public.set_qbo_customer_accounting_authority_v1(uuid,uuid,boolean,timestamptz)','execute'),'service role cannot assign customer authority');
select ok(not has_function_privilege('integration_provider_source_authority',
  'public.set_qbo_customer_accounting_authority_v1(uuid,uuid,boolean,timestamptz)','execute'),'source worker cannot consent for a customer');
select ok(not has_function_privilege('integration_provider_source_authority',
  'private.commit_qbo_accounting_fact_internal_v1(text,jsonb,text,text)','execute'),'source worker cannot bypass QBO fact fence');
select ok(not has_function_privilege('authenticated',
  'public.commit_qbo_accounting_source_v1(uuid,uuid,uuid,uuid,text,text,text[],jsonb,text)','execute'),'customer cannot write financial facts');
select ok(not has_table_privilege('integration_provider_source_authority',
  'private.qbo_accounting_source_applications','insert'),'source worker cannot forge processing receipts');
select ok(not has_table_privilege('authenticated',
  'private.qbo_accounting_authority_versions','insert'),'customer cannot forge policy rows');
select is(jsonb_array_length(public.discover_qbo_accounting_connections_v1(null,25)),0,'no connection is discovered without consent');
select throws_ok($q$select public.read_qbo_accounting_page_v1('e9f00000-0000-4000-8000-000000000101',null,25)$q$,
  '42501','qbo_accounting_authority_required','valid connection alone is not accounting authority');

select set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
  'sub','a9f00000-0000-4000-8000-000000000001','session_id','79f00000-0000-4000-8000-000000000101')::text,true);
set local role authenticated;
select throws_ok($q$select public.set_qbo_customer_accounting_authority_v1(
  'e9f00000-0000-4000-8000-000000000103',null,true,'2026-09-01Z')$q$,
  '42501',null,'owner cannot assign another tenant financial authority');
select lives_ok($q$select public.set_qbo_customer_accounting_authority_v1(
  'e9f00000-0000-4000-8000-000000000101',null,true,'2026-09-01Z')$q$,'owner explicitly consents to posted-revenue policy');
select is(public.set_qbo_customer_accounting_authority_v1(
  'e9f00000-0000-4000-8000-000000000101',null,true,'2026-09-01Z')->>'idempotent','true','consent replay is idempotent');
reset role;
select is((select count(*)::int from private.qbo_accounting_authority_versions),1,'one immutable consent version');
select is((select count(*)::int from private.source_authority_policy_rules
  where authority_role='authoritative'),1,'only QBO transaction detail is authoritative');
select is((select count(*)::int from private.source_authority_policy_rules
  where authority_role='control_only' and contribution_mode='non_additive_control'),1,'reports remain non-additive');
select is((select count(*)::int from private.source_authority_policy_rules
  where authority_role='excluded'),3,'Square, manual, upload cannot double count revenue');
select is(jsonb_array_length(public.discover_qbo_accounting_connections_v1(null,25)),1,'only the explicitly consented connection is discovered');
select is((select count(*)::int from private.canonical_business_fact_versions),0,'consent itself creates no financial facts');
select is((select count(*)::int from private.fact_contribution_events),0,'consent itself creates no contributions');
select throws_ok($q$update private.qbo_accounting_authority_versions set enabled=false$q$,
  '55000',null,'consent history cannot be rewritten');
select * from finish();
rollback;
