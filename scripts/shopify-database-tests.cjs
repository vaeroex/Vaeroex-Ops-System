/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto"),
  { PGlite } = require("@electric-sql/pglite");
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table public.workspaces(id uuid primary key);
create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text);`);
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261014002542_shopify_read_only_connector.sql",
      "utf8",
    ),
  );
  const w = randomUUID(),
    w2 = randomUUID(),
    a = randomUUID(),
    b = randomUUID(),
    session = randomUUID(),
    session2 = randomUUID();
  await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
  await db.query("insert into auth.sessions values($1,$2,null),($3,$4,null)", [
    session,
    a,
    session2,
    b,
  ]);
  await db.query("insert into workspaces values($1),($2)", [w, w2]);
  await db.query(
    "insert into workspace_members values($1,$2,'owner','active'),($3,$4,'owner','active')",
    [w, a, w2, b],
  );
  const rpc = async (
    op,
    payload = {},
    workspace = w,
    actor = a,
    sid = session,
  ) => {
    await db.exec("set role service_role");
    try {
      return (
        await db.query(
          "select public.shopify_lifecycle_v1($1,$2,$3,$4,$5::jsonb) as result",
          [op, workspace, actor, sid, JSON.stringify(payload)],
        )
      ).rows[0].result;
    } finally {
      await db.exec("reset role");
    }
  };
  let count = 0;
  const test = async (name, fn) => {
    await fn();
    count++;
    console.log("PASS", name);
  };
  const begin = () =>
    rpc("begin", { shop: "test.myshopify.com", stateHash: "a".repeat(64) });
  let c,
    lease = randomUUID();
  await test("browser roles cannot call lifecycle or read private credentials", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query("select public.shopify_lifecycle_v1($1,$2,$3,$4,$5)", [
          "view",
          w,
          a,
          session,
          "{}",
        ]),
      );
      await assert.rejects(
        db.query("select * from private.shopify_connections"),
      );
      await db.exec("reset role");
    }
  });
  await test("service role still validates actor workspace and live session", async () => {
    await assert.rejects(
      rpc(
        "begin",
        { shop: "test.myshopify.com", stateHash: "a".repeat(64) },
        w,
        b,
        session2,
      ),
      /owner_denied/,
    );
    await assert.rejects(rpc("view", {}, w, a, randomUUID()), /owner_denied/);
  });
  await test("OAuth state binds shop, owner and session and consumes once", async () => {
    c = await begin();
    await assert.rejects(
      rpc("consume", {
        shop: "other.myshopify.com",
        stateHash: "a".repeat(64),
        leaseId: lease,
      }),
      /state_invalid/,
    );
    c = await rpc("consume", {
      shop: "test.myshopify.com",
      stateHash: "a".repeat(64),
      leaseId: lease,
    });
    await assert.rejects(
      rpc("consume", {
        shop: "test.myshopify.com",
        stateHash: "a".repeat(64),
        leaseId: lease,
      }),
      /state_invalid/,
    );
  });
  await test("credentials only complete current leased generation", async () => {
    await assert.rejects(
      rpc("complete", {
        generation: c.generation + 1,
        leaseId: lease,
        credentialVersion: 1,
        ciphertext: "sh1.synthetic",
      }),
      /lease_invalid/,
    );
    c = await rpc("complete", {
      generation: c.generation,
      leaseId: lease,
      credentialVersion: 1,
      ciphertext: "sh1.synthetic",
    });
    assert.equal(c.status, "connected");
    const view = await rpc("view");
    assert(!("ciphertext" in view));
  });
  await test("shop cannot be assigned to another workspace", async () => {
    await assert.rejects(
      rpc(
        "begin",
        { shop: "test.myshopify.com", stateHash: "b".repeat(64) },
        w2,
        b,
        session2,
      ),
      /unique|duplicate/,
    );
  });
  await test("sync lease serializes concurrent reads and refreshes", async () => {
    lease = randomUUID();
    c = await rpc("claim_sync", { leaseId: lease });
    await assert.rejects(
      rpc("claim_sync", { leaseId: randomUUID() }),
      /sync_unavailable/,
    );
    c = await rpc("refresh", {
      leaseId: lease,
      generation: c.generation,
      credentialVersion: 2,
      ciphertext: "sh1.refreshed",
    });
    assert.equal(c.credential_version, 2);
    await assert.rejects(
      rpc("refresh", {
        leaseId: lease,
        generation: c.generation,
        credentialVersion: 2,
        ciphertext: "sh1.replay",
      }),
      /credential_invalid/,
    );
  });
  const report = {
    start: "2026-09-14T00:00:00.000Z",
    end: "2026-10-14T00:00:00.000Z",
    syncedAt: "2026-10-14T00:00:00.000Z",
    orderCount: 1,
    days: [
      {
        day: "2026-10-01",
        currency: "USD",
        orders: 1,
        cancelled: 0,
        orderTotal: "10.000000",
        refunded: "1.000000",
      },
    ],
  };
  await test("only aggregate allowlisted report is persisted", async () => {
    await assert.rejects(
      rpc("report", {
        leaseId: lease,
        generation: c.generation,
        report: { ...report, customerEmail: "must-not-store" },
      }),
      /report_fields/,
    );
    await rpc("report", { leaseId: lease, generation: c.generation, report });
    assert.deepEqual((await rpc("view")).report, report);
  });
  await test("redaction removes aggregates and invalidates pending sync", async () => {
    lease = randomUUID();
    c = await rpc("claim_sync", { leaseId: lease });
    await rpc(
      "webhook",
      { shop: c.shop, topic: "customers/redact" },
      null,
      null,
      null,
    );
    await assert.rejects(
      rpc("report", { leaseId: lease, generation: c.generation, report }),
      /lease_invalid/,
    );
    const view = await rpc("view");
    assert.equal(view.report, null);
    assert.equal(view.status, "reauthorization_required");
  });
  await test("uninstall clears credentials, report and stale callbacks", async () => {
    await rpc(
      "webhook",
      { shop: "test.myshopify.com", topic: "app/uninstalled" },
      null,
      null,
      null,
    );
    assert.equal(await rpc("view"), null);
    await assert.rejects(
      rpc("complete", {
        leaseId: lease,
        generation: c.generation,
        credentialVersion: 3,
        ciphertext: "sh1.old",
      }),
      /connection_missing/,
    );
  });
  await test("privacy cutoff survives reconnect and prevents reimport", async () => {
    c = await begin();
    lease = randomUUID();
    c = await rpc("consume", {
      shop: "test.myshopify.com",
      stateHash: "a".repeat(64),
      leaseId: lease,
    });
    assert(c.privacy_cutoff);
    await rpc("complete", {
      leaseId: lease,
      generation: c.generation,
      credentialVersion: 1,
      ciphertext: "sh1.synthetic",
    });
    lease = randomUUID();
    c = await rpc("claim_sync", { leaseId: lease });
    await assert.rejects(
      rpc("report", { leaseId: lease, generation: c.generation, report }),
      /redaction_fence/,
    );
  });
  await test("disconnect removes all workspace connection data", async () => {
    await rpc("disconnect");
    assert.equal(await rpc("view"), null);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from private.shopify_connections",
        )
      ).rows[0].n,
      0,
    );
  });
  await test("RLS enabled and no browser table grants", async () => {
    const rows = (
      await db.query(
        "select relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='private' and relkind='r' and relname like 'shopify_%'",
      )
    ).rows;
    assert(rows.every((r) => r.relrowsecurity));
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','public.shopify_lifecycle_v1(text,uuid,uuid,uuid,jsonb)','execute') as allowed",
        )
      ).rows[0].allowed,
      false,
    );
  });
  await test("shop redaction also removes the domain cutoff", async()=>{
    await rpc("webhook",{shop:"test.myshopify.com",topic:"shop/redact"},null,null,null);
    assert.equal((await db.query("select count(*)::int as n from private.shopify_privacy_cutoffs")).rows[0].n,0);
  });
  await db.close();
  console.log(`${count} Shopify database groups passed.`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
