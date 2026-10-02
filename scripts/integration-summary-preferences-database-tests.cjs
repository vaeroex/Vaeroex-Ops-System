/* eslint-disable @typescript-eslint/no-require-imports -- Isolated in-memory PostgreSQL qualification. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = "20261002182049_integration_summary_preferences.sql";

test("preference migration and SQL isolation assertions run only in fresh in-memory PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private;
      grant usage on schema auth, public to authenticated, anon, service_role;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.workspaces(id uuid primary key, name text, created_by uuid);
      create table public.workspace_members(workspace_id uuid, user_id uuid, role text, status text);
      grant select on public.workspaces to authenticated;
      grant select, update on public.workspaces to anon;
      grant update(name) on public.workspaces to authenticated;
      grant select, insert, update, delete on public.workspaces to service_role;
      insert into public.workspaces(id, name) values ('b9900000-0000-4000-8000-000000000001', 'Existing workspace');
    `);
    const foundation = read("supabase/migrations/202606170001_phase_1_schema_rls.sql");
    for (const name of ["set_updated_at", "is_workspace_member", "workspace_member_role", "has_workspace_role", "can_manage_workspace"]) {
      const match = foundation.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
      assert(match, `reuse the actual ${name} dependency`);
      await db.exec(match[0]);
    }
    await db.exec(`revoke execute on function public.has_workspace_role(uuid, text[]) from public, anon, service_role;
      grant execute on function public.has_workspace_role(uuid, text[]) to authenticated`);
    for (const label of ["members can read workspaces", "owners and admins can update workspaces"]) {
      const start = foundation.indexOf(`create policy "${label}"`);
      assert(start >= 0);
      await db.exec(foundation.slice(start, foundation.indexOf(";", start) + 1));
    }
    await db.exec("alter table public.workspaces enable row level security");
    const canonical = read("supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql");
    const helperStart = canonical.indexOf("create or replace function private.is_time_zone_v1(");
    const helperEnd = canonical.indexOf("$function$;", helperStart) + "$function$;".length;
    assert(helperStart >= 0 && helperEnd > helperStart);
    await db.exec(canonical.slice(helperStart, helperEnd));
    await db.exec("revoke execute on function private.is_time_zone_v1(text) from public, anon, authenticated, service_role");
    const policyQuery = "select * from pg_policies where schemaname='public' and tablename='workspaces' order by policyname";
    const policiesBefore = (await db.query(policyQuery)).rows;
    const productionPath = path.join(root, "supabase/production-migrations", migration);
    assert(fs.lstatSync(productionPath).isSymbolicLink());
    assert.equal(fs.readlinkSync(productionPath), `../migrations/${migration}`);
    await db.exec(read(`supabase/migrations/${migration}`));
    assert.deepEqual((await db.query(policyQuery)).rows, policiesBefore, "existing workspace RLS is unchanged");
    assert.equal((await db.query("select reporting_timezone from public.workspaces where id = 'b9900000-0000-4000-8000-000000000001'")).rows[0].reporting_timezone,
      null, "existing workspaces remain unconfigured without a backfill");
    // The first trigger invocation must be restricted service-role work, not a
    // superuser invocation that can warm the PL/pgSQL expression plan cache.
    await db.exec(`set role service_role;
      insert into public.workspaces(id, name) values ('b9900000-0000-4000-8000-000000000002', 'Cold service insert');
      update public.workspaces set name = 'Cold service update', reporting_timezone = 'UTC'
        where id = 'b9900000-0000-4000-8000-000000000002';
      reset role`);
    assert.deepEqual((await db.query("select name, reporting_timezone from public.workspaces where id = 'b9900000-0000-4000-8000-000000000002'")).rows,
      [{ name: "Cold service update", reporting_timezone: "UTC" }]);
    const result = await db.exec(read("supabase/tests/integration_summary_preferences.test.sql"));
    const assertions = result.flatMap(result => result.rows).filter(row => Object.hasOwn(row, "preference_assert"));
    assert.deepEqual(assertions.map(row => row.preference_assert), JSON.parse(read("supabase/tests/integration_summary_preferences.assertions.json")),
      "all 45 registered preference assertions execute exactly once in order");
    console.log(`Passed ${assertions.length} SQL preference assertions in isolated in-memory PostgreSQL.`);
    const timezoneResult = await db.exec(read("supabase/tests/workspace_reporting_timezone.test.sql"));
    const timezoneAssertions = timezoneResult.flatMap(result => result.rows).filter(row => Object.hasOwn(row, "preference_assert"));
    assert.deepEqual(timezoneAssertions.map(row => row.preference_assert), JSON.parse(read("supabase/tests/workspace_reporting_timezone.assertions.json")),
      "all 33 timezone assertions execute exactly once in order");
    console.log(`Passed ${timezoneAssertions.length} SQL owner-only reporting timezone assertions.`);
    for (const table of ["profiles", "workspace_members", "workspaces"]) {
      const { rows } = await db.query("select has_table_privilege('authenticated', $1, 'UPDATE') as writable", [`public.${table}`]);
      assert.equal(rows[0].writable, false, "migration must not grant auth-bearing row updates");
    }
    const { rows } = await db.query("select has_column_privilege('authenticated', 'public.workspaces', 'reporting_timezone', 'UPDATE') as writable, has_schema_privilege('authenticated', 'private', 'USAGE') as private_access");
    assert.equal(rows[0].writable, true, "only the reporting timezone column has the new update grant");
    assert.equal(rows[0].private_access, false, "private schema remains inaccessible");
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query("select has_function_privilege($1, 'private.is_time_zone_v1(text)', 'EXECUTE') as allowed", [role])).rows[0].allowed,
        false, "no private helper execute grant");
      assert.equal((await db.query("select has_function_privilege($1, 'public.guard_workspace_reporting_timezone_owner()', 'EXECUTE') as allowed", [role])).rows[0].allowed,
        false, "trigger guard is not an RPC");
    }
  } finally {
    await db.close();
  }
});
