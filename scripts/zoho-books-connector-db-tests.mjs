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

const historyMigration = new URL("../supabase/migrations/20261019070949_zoho_books_import_history.sql", import.meta.url);
test("Zoho Books historical facts correct by identity, preserve outside ranges, and expose complete coverage without truncation", async () => {
  const db = new PGlite();
  const workspace = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
  const user = "33333333-3333-4333-8333-333333333333", connection = "44444444-4444-4444-8444-444444444444";
  const otherConnection = "55555555-5555-4555-8555-555555555555", lease = "66666666-6666-4666-8666-666666666666";
  const fact = (source_id, day, total, extra = {}) => ({ kind: "invoice", source_id, day, counted: true, currency: "USD", total, outstanding: total, ...extra });
  const renew = async () => db.query("update zoho_books_connections set sync_lease_id=$1,sync_lease_expires_at=clock_timestamp()+interval '1 minute' where id=$2", [lease, connection]);
  const apply = async (start, end, facts, ws = workspace, cutoff = new Date(Date.parse(`${end}T00:00:00Z`)+86400000).toISOString()) => db.query("select apply_zoho_books_history($1,$2,$3,$4,$5,$6,$7::jsonb) as n", [ws, connection, lease, start, end, cutoff, JSON.stringify(facts)]);
  const read = async (start = null, end = null) => (await db.query("select read_zoho_books_history($1,$2,$3,$4) as value", [workspace, connection, start, end])).rows[0].value;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
      create table public.workspaces(id uuid primary key); create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    await db.exec(readFileSync(migration, "utf8"));
    await db.exec(readFileSync(historyMigration, "utf8"));
    assert.equal((await db.query("select has_function_privilege('service_role','public.apply_zoho_books_summary(uuid,uuid,uuid,date,date,jsonb)','EXECUTE') as allowed")).rows[0].allowed,false, "retired destructive writer is no longer callable by deployed service clients");
    await db.exec(`insert into workspaces values ('${workspace}'),('${other}'); insert into profiles values ('${user}');
      insert into workspace_members values ('${workspace}','${user}','active');
      insert into zoho_books_connections(id,workspace_id,created_by,status,organization_id,currency_code)
        values ('${connection}','${workspace}','${user}','connected','123456789','USD'),('${otherConnection}','${other}','${user}','connected','987654321','USD');
      insert into zoho_books_daily_summaries values ('${workspace}','${connection}','2020-01-01',1,12,3,0,0,0),('${workspace}','${connection}','2020-01-02',1,20,4,0,0,0);`);
    await renew();
    await assert.rejects(apply('2020-01-01','2020-01-01',[]), /service_role_required/);
    await db.exec(`set request.jwt.claims='{"role":"service_role"}';`);
    await assert.rejects(apply('2020-01-01','2020-01-01',[],other), /lease_invalid/);
    await apply('2020-01-01','2020-01-01',[fact('1','2020-01-01',12),fact('2','2020-01-01',0,{currency:'EUR',outstanding:0}),fact('3','2020-01-01',4,{kind:'expense',outstanding:0}),fact('4','2020-01-01',0,{counted:false,outstanding:0})]);
    let report = await read();
    assert.equal(report.invoice_count,1); assert.equal(report.invoice_total,12); assert.equal(report.expense_total,4);
    assert.equal(report.excluded_foreign_count,1); assert.equal(report.covered_days,1); assert.equal(report.legacy.days,1);
    assert.equal(report.legacy.invoice_total,20, 'legacy remains separate rather than duplicating stable-ID facts');
    await renew();
    await apply('2020-02-01','2020-02-02',[fact('1','2020-02-01',25)]);
    report = await read();
    assert.equal(report.invoice_total,25,'same invoice moved across months is replaced globally, not duplicated');
    assert.equal(report.expense_total,4,'unrelated historical expense survives');
    assert.equal(report.covered_days,3); assert.equal(report.missing_days,30);
    assert.equal((await read('2020-01-01','2020-01-01')).invoice_total,0);
    assert.equal((await read('2020-02-02','2020-02-02')).covered_days,1,'empty days have explicit coverage');
    assert.equal((await read('2019-01-01','2019-01-10')).covered_days,0);
    assert.equal((await read('2019-01-01','2019-01-10')).missing_days,10,'unimported dates are not falsely complete');
    await renew();
    await assert.rejects(apply('2020-02-01','2020-02-02',[fact('1','2020-02-01',99),fact('1','2020-02-01',88)]),/fact_invalid/);
    await assert.rejects(apply('2020-02-01','2020-02-02',[fact('1','2020-02-01',99,{customer_name:'not allowed'})]),/fact_invalid/);
    await assert.rejects(apply('2020-02-01','2020-02-02',[fact('1','2020-02-03',99)]),/fact_invalid/);
    await assert.rejects(apply('2019-01-01','2020-01-02',[]),/history_invalid/);
    assert.equal((await read()).invoice_total,25,'rejected import leaves all history unchanged');
    await apply('2020-02-01','2020-02-02',[]);
    assert.equal((await read()).invoice_total,0,'successful empty replacement removes deleted records');
    assert.equal((await read()).expense_total,4);
    await renew();
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    await apply(yesterday,yesterday,[],workspace,`${yesterday}T12:00:00Z`);
    const partial = await read(yesterday,yesterday);
    assert.equal(partial.covered_days,1); assert.equal(partial.complete_days,0); assert.equal(partial.incomplete_days,1,
      'a noon cutoff on an earlier day remains partial even though that calendar day has ended');
    assert.equal(Date.parse(partial.latest_covered_through),Date.parse(`${yesterday}T12:00:00Z`));
    await renew();
    await assert.rejects(apply(yesterday,yesterday,[],workspace,'2099-01-01T00:00:00Z'),/history_invalid/);
    await apply(yesterday,yesterday,[]);
    assert.equal((await read(yesterday,yesterday)).complete_days,1,'a completed reimport can fill a previously partial day');
    await renew();
    const many = Array.from({length:2001},(_,i)=>fact(String(100+i),'2020-03-01',1));
    await apply('2020-03-01','2020-03-01',many);
    assert.equal((await read()).invoice_count,2001,'SQL aggregate does not truncate at REST row limits');
    const savedBeforeReauthorization = await read();
    await renew();
    await db.query("update zoho_books_connections set status='reauthorization_required' where id=$1",[connection]);
    assert.deepEqual(await read(),savedBeforeReauthorization,'expired provider authorization does not hide saved history');
    await assert.rejects(apply('2020-03-01','2020-03-01',[]),/lease_invalid/,
      'reauthorization status blocks new imports even with an otherwise valid lease');
    assert.deepEqual(await read(),savedBeforeReauthorization,'blocked import preserves saved facts and coverage');
    await assert.rejects(db.query("select read_zoho_books_history($1,$2)",[other,connection]),/connection_invalid/,
      'reauthorization does not weaken the workspace and connection binding');
    await assert.rejects(db.query("select read_zoho_books_history($1,$2)",[workspace,otherConnection]),/connection_invalid/);
    for (const status of ['pending','choose_organization']) {
      await db.query("update zoho_books_connections set status=$1 where id=$2",[status,connection]);
      await assert.rejects(read(),/connection_invalid/,'unfinished connection states do not expose history');
    }
    await db.query("update zoho_books_connections set status='connected' where id=$1",[connection]);
    await renew();
    await db.query("update zoho_books_connections set sync_lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[connection]);
    await assert.rejects(apply('2020-03-01','2020-03-01',[]),/lease_invalid/);
    await db.exec(`insert into zoho_books_history_facts values ('${other}','${otherConnection}','invoice','999','2020-03-01',true,'USD',900,900);
      set role authenticated; set request.jwt.claim.sub='${user}';`);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_history_facts")).rows[0].n,2004);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_history_facts where workspace_id=$1",[other])).rows[0].n,0);
    await assert.rejects(read()); await assert.rejects(apply('2020-03-01','2020-03-01',[]));
    await assert.rejects(db.query("delete from zoho_books_history_facts"));
    await db.exec("reset role;");
    assert.equal((await db.query("select disconnect_zoho_books_connection($1,$2) as ok",[other,connection])).rows[0].ok,false);
    assert.equal((await db.query("select disconnect_zoho_books_connection($1,$2) as ok",[workspace,connection])).rows[0].ok,true);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_history_facts where workspace_id=$1",[workspace])).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_history_coverage")).rows[0].n,0);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_daily_summaries")).rows[0].n,0);
    await assert.rejects(read(),/connection_invalid/,'disconnect prevents saved-history reads');
    await assert.rejects(apply('2020-03-01','2020-03-01',many),/lease_invalid/);
    assert.equal((await db.query("select count(*)::int as n from zoho_books_history_facts where workspace_id=$1",[other])).rows[0].n,1);
  } finally { await db.close(); }
});
