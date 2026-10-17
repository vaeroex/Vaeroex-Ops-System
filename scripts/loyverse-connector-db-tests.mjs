import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261017013000_loyverse_read_only_connection.sql", import.meta.url);

test("Loyverse migration isolates workspaces and atomically applies bounded receipts", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111";
  const otherWorkspace = "22222222-2222-4222-8222-222222222222";
  const user = "33333333-3333-4333-8333-333333333333";
  const connection = "44444444-4444-4444-8444-444444444444";
  const otherConnection = "55555555-5555-4555-8555-555555555555";
  const lease = "66666666-6666-4666-8666-666666666666";
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
      insert into loyverse_connections(id,workspace_id,created_by,status,sync_lease_id,sync_lease_expires_at)
      values ('${connection}','${workspace}','${user}','connected','${lease}',now()+interval '10 minutes'),
             ('${otherConnection}','${otherWorkspace}','${user}','connected',null,null);`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    const visible = await db.query("select workspace_id from loyverse_connections");
    assert.deepEqual(visible.rows.map((row) => row.workspace_id), [workspace]);
    await assert.rejects(db.query("select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb)",
      [workspace, connection, lease, new Date(Date.now() - 7 * 86400000).toISOString(), new Date().toISOString(), "[]"]));
    await db.exec("reset role; set request.jwt.claim.role='service_role';");
    const receipt = { receipt_number: "R-1", store_id: "S-1",
      receipt_date: new Date(Date.now() - 3600000).toISOString(), updated_at: new Date().toISOString(),
      receipt_type: "SALE", total_money: 12, total_tax: 1, total_discount: 0, cancelled: false,
      customer_id: "discarded", employee_id: "discarded" };
    const args = [workspace, connection, lease, new Date(Date.now() - 7 * 86400000).toISOString(),
      new Date().toISOString(), JSON.stringify([receipt])];
    const result = await db.query("select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb) as applied", args);
    assert.equal(result.rows[0].applied, 1);
    const stored = await db.query("select workspace_id,receipt_number,total_money from loyverse_receipt_facts");
    assert.deepEqual(stored.rows.map((row) => row.workspace_id), [workspace]);
    assert.equal(stored.rows[0].receipt_number, "R-1");
    const fields = await db.query("select column_name from information_schema.columns where table_name='loyverse_receipt_facts'");
    assert.ok(!fields.rows.some((row) => /customer|employee|payment|note/i.test(row.column_name)));
    await assert.rejects(db.query("select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb)", args));
    assert.equal((await db.query("select count(*)::int as n from loyverse_receipt_facts")).rows[0].n, 1);
    const wrongTenant = await db.query("select disconnect_loyverse_connection($1,$2) as disconnected", [otherWorkspace, connection]);
    assert.equal(wrongTenant.rows[0].disconnected, false);
    assert.equal((await db.query("select count(*)::int as n from loyverse_receipt_facts")).rows[0].n, 1);
    const disconnected = await db.query("select disconnect_loyverse_connection($1,$2) as disconnected", [workspace, connection]);
    assert.equal(disconnected.rows[0].disconnected, true);
    assert.equal((await db.query("select count(*)::int as n from loyverse_receipt_facts")).rows[0].n, 0);
    await assert.rejects(db.query("select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb)", args));
  } finally { await db.close(); }
});
