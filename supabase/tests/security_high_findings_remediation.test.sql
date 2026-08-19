create extension if not exists dblink with schema extensions;

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

create or replace function pg_temp.affected_rows(p_sql text)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  execute p_sql;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

insert into public.profiles (id, email, full_name) values
  ('a6900000-0000-4000-8000-000000000001', 'security-owner@example.test', 'Security Owner'),
  ('a6900000-0000-4000-8000-000000000002', 'security-admin@example.test', 'Security Admin'),
  ('a6900000-0000-4000-8000-000000000003', 'security-staff@example.test', 'Security Staff'),
  ('a6900000-0000-4000-8000-000000000004', 'security-viewer@example.test', 'Security Viewer'),
  ('a6900000-0000-4000-8000-000000000005', 'security-candidate@example.test', 'Security Candidate'),
  ('a6900000-0000-4000-8000-000000000006', 'security-other-owner@example.test', 'Other Owner'),
  ('a6900000-0000-4000-8000-000000000007', 'security-other-member@example.test', 'Other Member');

insert into public.workspaces (id, name, created_by) values
  ('b6900000-0000-4000-8000-000000000001', 'Security Workspace A', 'a6900000-0000-4000-8000-000000000001'),
  ('b6900000-0000-4000-8000-000000000002', 'Security Workspace B', 'a6900000-0000-4000-8000-000000000006');

insert into public.workspace_members (id, workspace_id, user_id, role, status) values
  ('c6900000-0000-4000-8000-000000000001', 'b6900000-0000-4000-8000-000000000001', 'a6900000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('c6900000-0000-4000-8000-000000000002', 'b6900000-0000-4000-8000-000000000001', 'a6900000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('c6900000-0000-4000-8000-000000000003', 'b6900000-0000-4000-8000-000000000001', 'a6900000-0000-4000-8000-000000000003', 'staff', 'active'),
  ('c6900000-0000-4000-8000-000000000004', 'b6900000-0000-4000-8000-000000000001', 'a6900000-0000-4000-8000-000000000004', 'viewer', 'active'),
  ('c6900000-0000-4000-8000-000000000006', 'b6900000-0000-4000-8000-000000000002', 'a6900000-0000-4000-8000-000000000006', 'owner', 'active'),
  ('c6900000-0000-4000-8000-000000000007', 'b6900000-0000-4000-8000-000000000002', 'a6900000-0000-4000-8000-000000000007', 'staff', 'active');

insert into public.forms (id, workspace_id, name, is_public, public_slug, schema_json, created_by) values
  (
    'd6900000-0000-4000-8000-000000000001',
    'b6900000-0000-4000-8000-000000000001',
    'Security public form',
    true,
    'security-public-form',
    '[{"key":"summary","required":true}]'::jsonb,
    'a6900000-0000-4000-8000-000000000001'
  );

-- Production predates Supabase's opt-in Data API grant default. Current fresh
-- stacks therefore need a rollback-only adapter so these tests reach the same
-- RLS boundary instead of failing earlier at the object ACL. Grant only the
-- columns and operations exercised below; all grants disappear with rollback.
grant select (id, name) on table public.workspaces to authenticated;
grant select (id, workspace_id, user_id, role, status, invited_email, invited_by, created_at)
  on table public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role, status)
  on table public.workspace_members to authenticated;
grant update (role) on table public.workspace_members to authenticated;
grant insert (workspace_id, form_id, data_json)
  on table public.form_submissions to authenticated;

select ok(
  not has_table_privilege('authenticated', 'public.workspaces', 'INSERT'),
  'ordinary authenticated users cannot create a workspace with forged entitlement state'
);
select ok(
  not has_column_privilege('authenticated', 'public.workspaces', 'manually_unlocked', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.workspaces', 'subscription_required', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.workspaces', 'subscription_status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.workspaces', 'plan_slug', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.workspaces', 'trial_ends_at', 'UPDATE'),
  'all workspace entitlement columns are protected from authenticated updates'
);
select ok(
  has_column_privilege('authenticated', 'public.workspaces', 'name', 'UPDATE'),
  'safe workspace presentation fields remain editable under RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.customer_subscriptions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.customer_subscriptions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.customer_subscriptions', 'DELETE'),
  'customer subscription authority is service-controlled'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_subscriptions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and 'authenticated' = any(roles)
  ),
  0,
  'no authenticated RLS policy offers an alternate subscription write path'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname in ('public', 'storage')
      and tablename in (
        'forms', 'form_submissions', 'checklists', 'checklist_runs', 'tasks',
        'issues', 'assets', 'asset_checks', 'file_uploads', 'file_imports',
        'file_import_rows', 'crm_leads', 'crm_lead_history', 'operational_metrics',
        'record_folders', 'file_processing_jobs', 'business_memory_chunks',
        'business_notes', 'kpis', 'business_health_snapshots', 'security_audit_events',
        'ai_usage', 'objects'
      )
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and 'authenticated' = any(roles)
      and (
        coalesce(qual, '') like '%is_workspace_member%'
        or coalesce(with_check, '') like '%is_workspace_member%'
      )
  ),
  0,
  'no protected contributor table retains a membership-only write policy'
);

select set_config('request.jwt.claim.sub', 'a6900000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select ok(
  not public.can_contribute_workspace('b6900000-0000-4000-8000-000000000001'),
  'Viewer is excluded from the contributor role helper'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.kpis (workspace_id, name, actual_value, metric_date)
      values ('b6900000-0000-4000-8000-000000000001', 'Viewer forged KPI', 1, current_date)$$,
    '42501'
  ),
  'Viewer cannot create KPI intelligence through the Data API role'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.form_submissions (workspace_id, form_id, data_json)
      values (
        'b6900000-0000-4000-8000-000000000001',
        'd6900000-0000-4000-8000-000000000001',
        '{"summary":"viewer mutation"}'::jsonb
      )$$,
    '42501'
  ),
  'Viewer cannot mutate a protected workspace submission'
);

reset role;
select set_config('request.jwt.claim.sub', 'a6900000-0000-4000-8000-000000000003', true);
set local role authenticated;

select ok(
  public.can_contribute_workspace('b6900000-0000-4000-8000-000000000001'),
  'Staff retains legitimate contribution access'
);
insert into public.kpis (workspace_id, name, actual_value, metric_date, created_by)
values (
  'b6900000-0000-4000-8000-000000000001',
  'Staff legitimate KPI',
  2,
  current_date,
  'a6900000-0000-4000-8000-000000000003'
);
select is(
  (select count(*)::integer from public.kpis where name = 'Staff legitimate KPI'),
  1,
  'a valid Staff KPI contribution still succeeds'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.kpis (workspace_id, name, actual_value, metric_date)
      values ('b6900000-0000-4000-8000-000000000002', 'Cross-tenant KPI', 3, current_date)$$,
    '42501'
  ),
  'a contributor cannot use a valid foreign workspace identifier'
);

reset role;
select set_config('request.jwt.claim.sub', 'a6900000-0000-4000-8000-000000000001', true);
set local role authenticated;

update public.workspaces
set name = 'Security Workspace A renamed'
where id = 'b6900000-0000-4000-8000-000000000001';
select is(
  (select name from public.workspaces where id = 'b6900000-0000-4000-8000-000000000001'),
  'Security Workspace A renamed',
  'an Owner can still update a safe workspace presentation field'
);
select ok(
  pg_temp.raises_sqlstate(
    $$update public.workspaces
      set manually_unlocked = true, subscription_required = false, subscription_status = 'active'
      where id = 'b6900000-0000-4000-8000-000000000001'$$,
    '42501'
  ),
  'an Owner cannot grant entitlement through a direct workspace update'
);

reset role;
select set_config('request.jwt.claim.sub', 'a6900000-0000-4000-8000-000000000002', true);
set local role authenticated;

select ok(
  pg_temp.raises_sqlstate(
    $$update public.workspace_members
      set role = 'owner'
      where id = 'c6900000-0000-4000-8000-000000000002'$$,
    '42501'
  ),
  'an Admin cannot self-promote to Owner'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.workspace_members (workspace_id, user_id, role, status)
      values (
        'b6900000-0000-4000-8000-000000000001',
        'a6900000-0000-4000-8000-000000000005',
        'owner',
        'active'
      )$$,
    '42501'
  ),
  'an Admin cannot assign Owner to another member'
);
select is(
  pg_temp.affected_rows(
    $$update public.workspace_members
      set role = 'viewer'
      where id = 'c6900000-0000-4000-8000-000000000007'$$
  ),
  0,
  'an Admin cannot modify membership in another workspace'
);
insert into public.workspace_members (workspace_id, user_id, role, status)
values (
  'b6900000-0000-4000-8000-000000000001',
  'a6900000-0000-4000-8000-000000000005',
  'viewer',
  'active'
);
select is(
  (
    select role
    from public.workspace_members
    where workspace_id = 'b6900000-0000-4000-8000-000000000001'
      and user_id = 'a6900000-0000-4000-8000-000000000005'
  ),
  'viewer',
  'an Admin can still add a legitimate non-owner member'
);

reset role;
set local role anon;

select ok(
  not has_table_privilege('anon', 'public.support_requests', 'INSERT')
  and not has_table_privilege('anon', 'public.support_requests', 'UPDATE')
  and not has_table_privilege('anon', 'public.support_requests', 'DELETE')
  and not has_table_privilege('anon', 'public.manual_activation_requests', 'INSERT')
  and not has_table_privilege('anon', 'public.manual_activation_requests', 'UPDATE')
  and not has_table_privilege('anon', 'public.manual_activation_requests', 'DELETE')
  and not has_table_privilege('anon', 'public.form_submissions', 'INSERT')
  and not has_table_privilege('anon', 'public.form_submissions', 'UPDATE')
  and not has_table_privilege('anon', 'public.form_submissions', 'DELETE'),
  'anonymous direct mutations are revoked from every public write table'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in ('support_requests', 'manual_activation_requests', 'form_submissions')
      and cmd in ('INSERT', 'ALL')
      and 'anon' = any(roles)
  ),
  0,
  'no anonymous insert policy bypass remains on a public write table'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.support_requests (name, email, issue_type, message, priority, status)
      values ('Attacker', 'attacker@example.test', 'Other', 'forged', 'Urgent', 'open')$$,
    '42501'
  ),
  'anonymous support inserts cannot bypass the validated server ingress'
);
select ok(
  pg_temp.raises_sqlstate(
    $$insert into public.manual_activation_requests (name, email, status)
      values ('Attacker', 'attacker@example.test', 'approved')$$,
    '42501'
  ),
  'anonymous callers cannot forge activation state'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.consume_request_rate_limit_v1(text,text,timestamptz,integer,jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot invoke the quota storage RPC directly'
);

reset role;
set local role service_role;

select results_eq(
  $$select allowed, request_count
    from public.consume_request_rate_limit_v1(
      'security.test',
      repeat('a', 64),
      '2026-08-19T17:00:00Z'::timestamptz,
      2,
      '{}'::jsonb
    )$$,
  $$values (true, 1)$$,
  'the first controlled submission consumes one quota atomically'
);
select results_eq(
  $$select allowed, request_count
    from public.consume_request_rate_limit_v1(
      'security.test',
      repeat('a', 64),
      '2026-08-19T17:00:00Z'::timestamptz,
      2,
      '{}'::jsonb
    )$$,
  $$values (true, 2)$$,
  'the last allowed submission reaches the exact quota'
);
select results_eq(
  $$select allowed, request_count
    from public.consume_request_rate_limit_v1(
      'security.test',
      repeat('a', 64),
      '2026-08-19T17:00:00Z'::timestamptz,
      2,
      '{}'::jsonb
    )$$,
  $$values (false, 2)$$,
  'repeated submissions fail closed after the quota is exhausted'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.review_manual_activation_request(uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'the legitimate service-role manual activation workflow remains authorized'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_workspace_with_signed_agreement(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,boolean,text,text,text,text,jsonb,text,timestamptz,text,text,text,bigint,text,text)',
    'EXECUTE'
  ),
  'the signed service-role workspace creation workflow remains authorized'
);

reset role;

create temporary table concurrent_rate_limit_results (
  allowed boolean not null,
  request_count integer not null
) on commit drop;

select extensions.dblink_connect_u(
  connection_name,
  -- The harness creates this extension as the isolated test runner. The
  -- unprivileged application roles are never granted its `_u` entry point.
  'dbname=' || current_database()
)
from (
  values
    ('rate_limit_concurrency_1'),
    ('rate_limit_concurrency_2'),
    ('rate_limit_concurrency_3'),
    ('rate_limit_concurrency_4'),
    ('rate_limit_concurrency_5'),
    ('rate_limit_concurrency_6'),
    ('rate_limit_concurrency_7'),
    ('rate_limit_concurrency_8')
) as connections(connection_name);

select extensions.dblink_exec(
  'rate_limit_concurrency_1',
  $cleanup$
    delete from public.request_rate_limits
    where action_key = 'security.concurrent-test'
      and identifier_hash = repeat('b', 64)
      and window_start = '2026-08-19T17:15:00Z'::timestamptz
  $cleanup$
);

select extensions.dblink_send_query(
  connection_name,
  $query$
    select allowed, request_count
    from public.consume_request_rate_limit_v1(
      'security.concurrent-test',
      repeat('b', 64),
      '2026-08-19T17:15:00Z'::timestamptz,
      3,
      '{}'::jsonb
    )
  $query$
)
from (
  values
    ('rate_limit_concurrency_1'),
    ('rate_limit_concurrency_2'),
    ('rate_limit_concurrency_3'),
    ('rate_limit_concurrency_4'),
    ('rate_limit_concurrency_5'),
    ('rate_limit_concurrency_6'),
    ('rate_limit_concurrency_7'),
    ('rate_limit_concurrency_8')
) as connections(connection_name);

insert into concurrent_rate_limit_results (allowed, request_count)
select result.allowed, result.request_count
from (
  values
    ('rate_limit_concurrency_1'),
    ('rate_limit_concurrency_2'),
    ('rate_limit_concurrency_3'),
    ('rate_limit_concurrency_4'),
    ('rate_limit_concurrency_5'),
    ('rate_limit_concurrency_6'),
    ('rate_limit_concurrency_7'),
    ('rate_limit_concurrency_8')
) as connections(connection_name)
cross join lateral extensions.dblink_get_result(connections.connection_name)
  as result(allowed boolean, request_count integer);

select is(
  (select count(*)::integer from concurrent_rate_limit_results),
  8,
  'all concurrent quota attempts return one authoritative result'
);
select is(
  (select count(*)::integer from concurrent_rate_limit_results where allowed),
  3,
  'concurrent quota attempts cannot consume more than the exact limit'
);
select is(
  (select max(request_count) from concurrent_rate_limit_results),
  3,
  'concurrent quota accounting never advances beyond the configured boundary'
);

select extensions.dblink_exec(
  'rate_limit_concurrency_1',
  $cleanup$
    delete from public.request_rate_limits
    where action_key = 'security.concurrent-test'
      and identifier_hash = repeat('b', 64)
      and window_start = '2026-08-19T17:15:00Z'::timestamptz
  $cleanup$
);

select extensions.dblink_disconnect(connection_name)
from (
  values
    ('rate_limit_concurrency_1'),
    ('rate_limit_concurrency_2'),
    ('rate_limit_concurrency_3'),
    ('rate_limit_concurrency_4'),
    ('rate_limit_concurrency_5'),
    ('rate_limit_concurrency_6'),
    ('rate_limit_concurrency_7'),
    ('rate_limit_concurrency_8')
) as connections(connection_name);

select * from finish();
rollback;
