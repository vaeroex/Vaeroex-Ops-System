import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261017051502_wix_orders_read_only_connection.sql", import.meta.url);
const historyMigration = new URL("../supabase/migrations/20261019071008_wix_orders_import_history.sql", import.meta.url);

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
      create function auth.role() returns text language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
          nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
      create table public.workspaces(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    await db.exec(readFileSync(migration, "utf8"));
    await db.exec(readFileSync(historyMigration, "utf8"));
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

test("Wix imports retain older history, correct overlapping/moved orders, track empty days, and aggregate all rows", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  const user = "33333333-3333-4333-8333-333333333333", connection = "44444444-4444-4444-8444-444444444444";
  const otherConnection = "55555555-5555-4555-8555-555555555555", lease = "66666666-6666-4666-8666-666666666666";
  const id = n => `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`;
  const fact = (n, day, amount = 10) => ({order_id:id(n),created_at:`${day}T12:00:00Z`,total_amount:amount,currency_code:"USD",payment_status:"PAID"});
  const apply = async (start, end, facts, overrides = {}) => {
    await db.query("update wix_order_connections set sync_lease_id=$1,sync_lease_expires_at=now()+interval '10 minutes' where id=$2", [lease,connection]);
    return db.query("select apply_wix_order_snapshot($1,$2,$3,$4,$5,$6::jsonb) as n",
      [overrides.workspace ?? workspace,connection,overrides.lease ?? lease,`${start}T00:00:00Z`,`${end}T00:00:00Z`,JSON.stringify(facts)]);
  };
  const report = async (from = null, to = null, w = workspace, c = connection) =>
    (await db.query("select wix_order_history_report($1,$2,$3,$4) as r", [w,c,from,to])).rows[0].r;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
      create table public.workspaces(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    await db.exec(readFileSync(migration,"utf8"));
    await db.exec(readFileSync(historyMigration,"utf8"));
    await db.exec(`insert into workspaces values ('${workspace}'),('${other}'); insert into profiles values ('${user}');
      insert into workspace_members values ('${workspace}','${user}','active');
      insert into wix_order_connections(id,workspace_id,created_by,status,instance_hash) values
        ('${connection}','${workspace}','${user}','connected',repeat('a',64)),('${otherConnection}','${other}','${user}','connected',repeat('b',64));
      set request.jwt.claims='{"role":"service_role"}';`);
    await apply("2020-01-01","2020-01-04",[fact(1,"2020-01-01"),fact(2,"2020-01-02"),fact(3,"2020-01-03")]);
    assert.equal((await report()).covered_days,3);
    await apply("2020-01-02","2020-01-04",[fact(2,"2020-01-02",20)]);
    assert.equal((await report()).totals[0].order_count,2,"missing order removed only in refreshed period");
    assert.equal(Number((await report()).totals[0].total_amount),30,"outside period preserved and correction applied");
    await apply("2021-01-01","2021-01-02",[fact(1,"2021-01-01",40)]);
    assert.equal((await report()).totals[0].order_count,2,"moved identity not duplicated");
    assert.equal((await report("2020-01-01","2020-01-01")).totals.length,0,"old date corrected by identity upsert");
    await apply("2020-01-02","2020-01-04",[]);
    assert.equal((await report()).totals[0].order_count,1,"empty refresh removes selected stale data");
    const empty = await report("2020-01-02","2020-01-03");
    assert.equal(empty.covered_days,2); assert.equal(empty.complete_days,2); assert.equal(empty.totals.length,0);
    const gap = await report("2020-01-01","2020-01-05");
    assert.equal(gap.requested_days,5); assert.equal(gap.covered_days,3);
    const before = JSON.stringify(await report());
    await assert.rejects(apply("2022-01-01","2022-01-02",[fact(9,"2022-01-02")]),/snapshot_invalid/);
    await assert.rejects(apply("2022-01-01","2022-01-02",[fact(9,"2022-01-01"),fact(9,"2022-01-01")]),/snapshot_invalid/);
    await assert.rejects(apply("2022-01-01","2022-01-02",[fact(9,"2022-01-01")],{workspace:other}),/lease_invalid/);
    await assert.rejects(apply("2022-01-01","2022-01-02",[],{lease:otherConnection}),/lease_invalid/);
    await assert.rejects(apply("2022-01-01","2024-01-02",[]),/snapshot_invalid/);
    assert.equal(JSON.stringify(await report()),before,"failed imports preserve history and coverage");
    await db.exec("set request.jwt.claims='{}';");
    await assert.rejects(apply("2022-01-01","2022-01-02",[]),/service_role_required/);
    await db.exec("set request.jwt.claims='{\"role\":\"service_role\"}';");
    const many = Array.from({length:1201},(_,n)=>fact(n+100,"2022-01-01",1));
    await apply("2022-01-01","2022-01-02",many);
    assert.equal((await report("2022-01-01","2022-01-01")).totals[0].order_count,1201);
    assert.equal(Number((await report("2022-01-01","2022-01-01")).totals[0].total_amount),1201);
    await db.query("update wix_order_connections set sync_lease_id=$1,sync_lease_expires_at=now()+interval '10 minutes' where id=$2",[lease,connection]);
    await db.query("select apply_wix_order_snapshot($1,$2,$3,'2023-01-01T12:00:00Z','2023-01-03T12:00:00Z','[]'::jsonb)",[workspace,connection,lease]);
    const partial = await report("2023-01-01","2023-01-03");
    assert.equal(partial.covered_days,2,"rolling client cannot claim complete coverage for its first partial day");
    assert.equal(partial.complete_days,1,"final partial day remains marked incomplete");
    assert.equal(partial.coverage.length,2,"partial coverage is separate from complete days");
    assert.equal(partial.coverage[1].complete,false);
    await apply("2023-01-03","2023-01-04",[]);
    assert.equal((await report("2023-01-02","2023-01-03")).complete_days,2);
    await db.query("update wix_order_connections set sync_lease_id=$1,sync_lease_expires_at=now()-interval '1 second' where id=$2",[lease,connection]);
    await assert.rejects(db.query("select apply_wix_order_snapshot($1,$2,$3,'2023-01-03 UTC','2023-01-04 UTC','[]'::jsonb)",[workspace,connection,lease]),/lease_invalid/);
    await db.exec(`insert into wix_order_import_days values ('${other}','${otherConnection}','2020-01-01','2020-01-02 UTC',now());
      set role authenticated; set request.jwt.claim.sub='${user}';`);
    assert.equal((await db.query("select count(*)::int as n from wix_order_import_days")).rows[0].n,7);
    assert.equal((await report(null,null,other,otherConnection)).covered_days,0,"RLS applies inside invoker report");
    await assert.rejects(db.query("delete from wix_order_import_days"));
    await assert.rejects(db.query("select disconnect_wix_order_connection($1,$2)",[workspace,connection]));
    await db.exec("reset role;");
    assert.equal((await db.query("select disconnect_wix_order_connection($1,$2) as d",[workspace,connection])).rows[0].d,true);
    assert.equal((await report()).covered_days,0);
    assert.equal((await report()).totals.length,0);
    await assert.rejects(apply("2022-01-01","2022-01-02",many),/lease_invalid/);
  } finally { await db.close(); }
});
