begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_sqlstate(p_sql text, p_expected text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_expected;
end;
$$;

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ai_agent_runs_intelligence_briefing_generation_claim_uidx'
      and indexdef ilike '%unique%'
      and indexdef like '%generation_key%'
  ),
  'Intelligence Briefings have a durable unique generation claim'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'ai_agent_runs_intelligence_briefing_evidence_period_idx'
      and indexdef like '%effective_evidence_fingerprint%'
      and indexdef like '%period_start%'
      and indexdef like '%period_end%'
  ),
  'Intelligence Briefings have workspace-scoped evidence fingerprint and period lookup support'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_agent_runs'::regclass),
  'ai_agent_runs retains row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.reports'::regclass),
  'reports retains row-level security'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_agent_runs'
      and cmd = 'SELECT'
      and qual like '%is_workspace_member%'
  ),
  'briefing source artifacts retain workspace-member read isolation'
);

insert into public.profiles (id, email, full_name) values
  ('a8200000-0000-4000-8000-000000000001', 'briefing-owner@example.test', 'Briefing Owner');
insert into public.workspaces (id, name, created_by) values
  ('b8200000-0000-4000-8000-000000000001', 'Briefing workspace one', 'a8200000-0000-4000-8000-000000000001'),
  ('b8200000-0000-4000-8000-000000000002', 'Briefing workspace two', 'a8200000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, role, status) values
  ('b8200000-0000-4000-8000-000000000001', 'a8200000-0000-4000-8000-000000000001', 'owner', 'active');

insert into public.ai_agent_runs (workspace_id, agent_type, input_json, output_json, status, created_by) values
  ('b8200000-0000-4000-8000-000000000001', 'intelligence_briefing_v1', '{"briefing_type":"weekly","generation_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', '{}', 'processing', 'a8200000-0000-4000-8000-000000000001'),
  ('b8200000-0000-4000-8000-000000000002', 'intelligence_briefing_v1', '{"briefing_type":"weekly","generation_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', '{}', 'completed', 'a8200000-0000-4000-8000-000000000001');

select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.ai_agent_runs (workspace_id, agent_type, input_json, output_json, status, created_by) values (
      'b8200000-0000-4000-8000-000000000001',
      'intelligence_briefing_v1',
      '{"briefing_type":"weekly","generation_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      '{}',
      'completed',
      'a8200000-0000-4000-8000-000000000001'
    )$$,
    '23505'
  ),
  'concurrent identical generations cannot create a second active claim'
);

select set_config('request.jwt.claim.sub', 'a8200000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.ai_agent_runs where agent_type = 'intelligence_briefing_v1'),
  1,
  'an authenticated member cannot read another workspace briefing artifact'
);
reset role;

select ok(
  pg_get_functiondef('public.soft_delete_saved_analyses(uuid,uuid[],text)'::regprocedure) like '%weekly_briefing%'
  and pg_get_functiondef('public.soft_delete_saved_analyses(uuid,uuid[],text)'::regprocedure) like '%monthly_briefing%',
  'transactional Saved Analysis deletion recognizes weekly and monthly briefings'
);
select ok(
  not has_function_privilege('anon', 'public.soft_delete_saved_analyses(uuid,uuid[],text)', 'EXECUTE'),
  'anonymous callers cannot delete Saved Briefings'
);
select ok(
  has_function_privilege('authenticated', 'public.soft_delete_saved_analyses(uuid,uuid[],text)', 'EXECUTE'),
  'authenticated managers reach the existing authorization-enforcing deletion RPC'
);

select * from finish();
rollback;
