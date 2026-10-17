import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261017023221_zoho_books_read_only_connection.sql", import.meta.url);

test("Zoho Books summary is tenant-safe, bounded, atomic, and erasable", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111";
  const otherWorkspace = "22222222-2222-4222-8222-222222222222";
  const user = "33333333-3333-4333-8333-333333333333";
  const connection = "44444444-4444-4444-8444-444444444444";
  const lease = "66666666-6666-4666-8666-666666666666";
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const daily = Array.from({ length: 7 }, (_, i) => ({
    day: new Date(Date.parse(`${startDate}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10),
    invoice_count: 1, invoice_total: 12, outstanding_total: 4,
    expense_count: 1, expense_total: 3, excluded_foreign_count: 0,
    customer_name: "must never be stored"
  }));
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.workspaces(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    await db.exec(readFileSync(migration, "utf8"));
    await db.exec(`insert into workspaces values ('${workspace}'),('${otherWorkspace}');
      insert into profiles values ('${user}');
      insert into workspace_members values ('${workspace}','${user}','active');
      insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,organization_name,currency_code,sync_lease_id,sync_lease_expires_at)
      values ('${connection}','${workspace}','${user}','connected','123456789','Test Books','USD','${lease}',now()+interval '10 minutes');`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_connections")).rows[0].n, 1);
    await assert.rejects(db.query("select * from zoho_books_credentials"));
    await assert.rejects(db.query("select apply_zoho_books_summary($1,$2,$3,$4,$5,$6::jsonb)",
      [workspace, connection, lease, startDate, endDate, JSON.stringify(daily)]));
    await db.exec("reset role; set request.jwt.claim.role='service_role';");
    const args = [workspace, connection, lease, startDate, endDate, JSON.stringify(daily)];
    assert.equal((await db.query("select apply_zoho_books_summary($1,$2,$3,$4,$5,$6::jsonb) as n", args)).rows[0].n, 7);
    const stored = await db.query("select count(*)::int as n,sum(invoice_total)::numeric as invoices from zoho_books_daily_summaries");
    assert.equal(stored.rows[0].n, 7);
    assert.equal(Number(stored.rows[0].invoices), 84);
    const fields = await db.query("select column_name from information_schema.columns where table_name='zoho_books_daily_summaries'");
    assert.ok(!fields.rows.some((row) => /customer|vendor|invoice_id|expense_id|note/i.test(row.column_name)));
    assert.equal((await db.query("select disconnect_zoho_books_connection($1,$2) as done", [otherWorkspace, connection])).rows[0].done, false);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_daily_summaries")).rows[0].n, 7);
    assert.equal((await db.query("select disconnect_zoho_books_connection($1,$2) as done", [workspace, connection])).rows[0].done, true);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_daily_summaries")).rows[0].n, 0);
  } finally { await db.close(); }
});
