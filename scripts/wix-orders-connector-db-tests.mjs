import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261017051502_wix_orders_read_only_connection.sql", import.meta.url);

test("Wix order data is tenant-isolated, credentials stay private, and disconnect removes facts", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
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
    await db.exec(`insert into workspaces values ('${workspace}'),('${other}');
      insert into profiles values ('${user}');
      insert into workspace_members values ('${workspace}','${user}','active');
      insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash,sync_lease_id,sync_lease_expires_at)
      values ('${connection}','${workspace}','${user}','connected',repeat('a',64),'${lease}',now()+interval '10 minutes'),
             ('${otherConnection}','${other}','${user}','connected',repeat('b',64),null,null);
      insert into wix_order_credentials values ('${connection}','${workspace}',repeat('x',64));`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    const visible = await db.query("select workspace_id from wix_order_connections");
    assert.deepEqual(visible.rows.map((row) => row.workspace_id), [workspace]);
    await assert.rejects(db.query("select * from wix_order_credentials"));
    await assert.rejects(db.query("select apply_wix_order_snapshot($1,$2,$3,$4,$5,$6::jsonb)",
      [workspace, connection, lease, new Date(Date.now() - 7 * 86400000).toISOString(), new Date().toISOString(), "[]"]));
    await db.exec("reset role; set request.jwt.claim.role='service_role';");
    const order = { order_id: "77777777-7777-4777-8777-777777777777",
      created_at: new Date(Date.now() - 3600000).toISOString(), total_amount: 12.50,
      currency_code: "USD", payment_status: "PAID", buyer_email: "discard@example.com" };
    const args = [workspace, connection, lease, new Date(Date.now() - 7 * 86400000).toISOString(),
      new Date().toISOString(), JSON.stringify([order])];
    const result = await db.query("select apply_wix_order_snapshot($1,$2,$3,$4,$5,$6::jsonb) as applied", args);
    assert.equal(result.rows[0].applied, 1);
    const stored = await db.query("select workspace_id,total_amount from wix_order_facts");
    assert.deepEqual(stored.rows.map((row) => row.workspace_id), [workspace]);
    const fields = await db.query("select column_name from information_schema.columns where table_name='wix_order_facts'");
    assert.ok(!fields.rows.some((row) => /buyer|customer|address|phone|email|note|item/i.test(row.column_name)));
    assert.equal((await db.query("select disconnect_wix_order_connection($1,$2) as disconnected", [other, connection])).rows[0].disconnected, false);
    assert.equal((await db.query("select disconnect_wix_order_connection($1,$2) as disconnected", [workspace, connection])).rows[0].disconnected, true);
    assert.equal((await db.query("select count(*)::int as n from wix_order_facts")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from wix_order_credentials")).rows[0].n, 0);
  } finally { await db.close(); }
});
