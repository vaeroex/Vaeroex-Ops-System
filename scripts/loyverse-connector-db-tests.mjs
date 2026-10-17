import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261017013603_loyverse_read_only_connection.sql", import.meta.url);
const reconnectGuard = new URL("../supabase/migrations/20261017184954_loyverse_merchant_reconnect_guard.sql", import.meta.url);

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

test("Loyverse reconnect keeps one merchant's receipts and credentials together", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111";
  const otherWorkspace = "22222222-2222-4222-8222-222222222222";
  const user = "33333333-3333-4333-8333-333333333333";
  const connection = "44444444-4444-4444-8444-444444444444";
  const merchantA = "77777777-7777-4777-8777-777777777777";
  const merchantB = "88888888-8888-4888-8888-888888888888";
  const oldCiphertext = "A".repeat(40);
  const newCiphertext = "B".repeat(40);
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  const completion = (merchant, currency = "USD", ciphertext = newCiphertext, scope = workspace) =>
    db.query("select complete_loyverse_oauth($1,$2,$3,$4,$5,$6,$7) as connected",
      [scope, connection, merchant, "Synthetic merchant", currency, ciphertext, expires]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.workspaces(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    await db.exec(readFileSync(migration, "utf8"));
    await db.exec(readFileSync(reconnectGuard, "utf8"));
    const grants = await db.query(`select
      has_function_privilege('anon', 'public.complete_loyverse_oauth(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE') as anon,
      has_function_privilege('authenticated', 'public.complete_loyverse_oauth(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE') as authenticated,
      has_function_privilege('service_role', 'public.complete_loyverse_oauth(uuid,uuid,uuid,text,text,text,timestamptz)', 'EXECUTE') as service_role`);
    assert.deepEqual(grants.rows[0], { anon: false, authenticated: false, service_role: true });
    await db.query("insert into workspaces(id) values ($1),($2)", [workspace, otherWorkspace]);
    await db.query("insert into profiles(id) values ($1)", [user]);
    await db.query(`insert into loyverse_connections
      (id,workspace_id,created_by,status,merchant_id,business_name,currency_code,last_sync_at)
      values ($1,$2,$3,'pending',$4,'Merchant A','USD',now())`,
    [connection, workspace, user, merchantA]);
    await db.query(`insert into loyverse_credentials
      (workspace_id,connection_id,token_ciphertext,access_expires_at,scope)
      values ($1,$2,$3,$4,'MERCHANT_READ RECEIPTS_READ')`,
    [workspace, connection, oldCiphertext, expires]);
    await db.query(`insert into loyverse_receipt_facts
      (workspace_id,connection_id,receipt_number,store_id,receipt_date,updated_at,
       receipt_type,total_money,total_tax,total_discount,cancelled)
      values ($1,$2,'A-1','S-1',now(),now(),'SALE',12,1,0,false)`, [workspace, connection]);

    await assert.rejects(completion(merchantA), /loyverse_service_role_required/);
    await db.exec("set request.jwt.claim.role='service_role';");
    assert.equal((await completion(merchantA, "USD", newCiphertext, otherWorkspace)).rows[0].connected, false);
    await assert.rejects(completion(merchantB), /loyverse_merchant_mismatch/);
    await assert.rejects(completion(merchantA, "EUR"), /loyverse_currency_mismatch/);
    let saved = await db.query(`select c.status,c.merchant_id,c.currency_code,c.last_sync_at,
      k.token_ciphertext,(select count(*)::int from loyverse_receipt_facts f
        where f.workspace_id=c.workspace_id and f.connection_id=c.id) as receipts
      from loyverse_connections c join loyverse_credentials k on k.connection_id=c.id`);
    assert.equal(saved.rows[0].status, "pending");
    assert.equal(saved.rows[0].merchant_id, merchantA);
    assert.equal(saved.rows[0].currency_code, "USD");
    assert.equal(saved.rows[0].token_ciphertext, oldCiphertext);
    assert.equal(saved.rows[0].receipts, 1);
    const lastSync = saved.rows[0].last_sync_at;

    await db.exec(`create function fail_loyverse_finish() returns trigger language plpgsql as $$
      begin if new.status='connected' then raise exception 'synthetic_finish_failure'; end if;
      return new; end $$;
      create trigger fail_loyverse_finish before update on loyverse_connections
      for each row execute function fail_loyverse_finish();`);
    await assert.rejects(completion(merchantA), /synthetic_finish_failure/);
    await db.exec("drop trigger fail_loyverse_finish on loyverse_connections; drop function fail_loyverse_finish();");
    assert.equal((await db.query("select token_ciphertext from loyverse_credentials")).rows[0].token_ciphertext, oldCiphertext);
    assert.equal((await db.query("select status from loyverse_connections")).rows[0].status, "pending");

    const [same, different] = await Promise.allSettled([completion(merchantA), completion(merchantB)]);
    assert.equal(same.status, "fulfilled");
    assert.equal(same.value.rows[0].connected, true);
    if (different.status === "fulfilled") assert.equal(different.value.rows[0].connected, false);
    else assert.match(String(different.reason), /loyverse_merchant_mismatch/);
    assert.equal((await completion(merchantA)).rows[0].connected, false, "replayed completion cannot replace credentials");
    saved = await db.query(`select c.status,c.merchant_id,c.currency_code,c.last_sync_at,
      k.token_ciphertext,(select count(*)::int from loyverse_receipt_facts f
        where f.workspace_id=c.workspace_id and f.connection_id=c.id) as receipts
      from loyverse_connections c join loyverse_credentials k on k.connection_id=c.id`);
    assert.equal(saved.rows[0].status, "connected");
    assert.equal(saved.rows[0].merchant_id, merchantA);
    assert.equal(saved.rows[0].currency_code, "USD");
    assert.equal(saved.rows[0].token_ciphertext, newCiphertext);
    assert.equal(saved.rows[0].receipts, 1);
    assert.equal(saved.rows[0].last_sync_at.toISOString(), lastSync.toISOString());
  } finally { await db.close(); }
});
