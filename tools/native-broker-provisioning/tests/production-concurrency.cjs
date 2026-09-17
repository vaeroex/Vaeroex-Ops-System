"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Disposable native PostgreSQL qualification. */
const { setTimeout: delay } = require("node:timers/promises");

// Called only after createFixture has verified the pinned local engine and
// extensions. No remote inputs, credentials, SQL text or driver errors escape.
module.exports = async function qualifyConcurrency({ fixture, native, createPeer, target, check, definition, source }) {
  const control = fixture.control;
  const catalogs = ["pg_proc", "pg_authid", "pg_auth_members", "pg_db_role_setting"];
  const context = intent => ({ target, intent, approvalId: "synthetic-production", signal: new AbortController().signal });
  const cases = [
    ["function", "pg_proc", `CREATE OR REPLACE FUNCTION ${definition} RETURNS void
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$${source}$function$`],
    ["role_attribute", "pg_authid", "ALTER ROLE square_production_evidence_authority LOGIN"],
    ["membership", "pg_auth_members", "GRANT square_production_scheduler_authority TO synthetic_unprivileged WITH ADMIN FALSE, INHERIT TRUE, SET FALSE"],
    ["database_role_setting", "pg_db_role_setting", "ALTER ROLE square_production_oauth_authority IN DATABASE postgres SET statement_timeout='1s'"],
  ];
  const observe = (name, expected, actual) => {
    process.stdout.write(JSON.stringify({ outcome: "production_concurrency", case: name, expected, actual }) + "\n");
    check(actual === expected, name);
  };
  async function until(predicate, label) {
    const deadline = Date.now() + 1200;
    do { if (await predicate()) return; await delay(10); } while (Date.now() < deadline);
    check(false, label);
  }
  async function nativePid() {
    const rows = (await control.query(`SELECT pid FROM pg_stat_activity
      WHERE application_name='vaeroex-native-provisioner' AND pid<>pg_backend_pid()`)).rows;
    check(rows.length === 1, "concurrency_one_native_session");
    return rows[0].pid;
  }
  async function held(pid) {
    const row = (await control.query(`SELECT count(DISTINCT relation)::int n FROM pg_locks
      WHERE pid=$1 AND granted AND mode='ShareRowExclusiveLock'
      AND relation=ANY($2::regclass[])`, [pid, catalogs.map(name => `pg_catalog.${name}`)])).rows[0];
    return row.n === 4;
  }
  async function waiting(pid, relation, blocker) {
    return (await control.query(`SELECT EXISTS(SELECT FROM pg_locks WHERE pid=$1
      AND NOT granted AND relation=$2::regclass) AND $3=ANY(pg_blocking_pids($1)) ok`,
    [pid, `pg_catalog.${relation}`, blocker])).rows[0].ok;
  }
  async function released(pid, label) {
    observe(label, true, !(await control.query("SELECT EXISTS(SELECT FROM pg_locks WHERE pid=$1) present", [pid])).rows[0].present);
  }
  async function fenced(label) {
    const result = await native.fence(context(`concurrency-fence-${label}`));
    const row = (await control.query(`SELECT NOT rolcanlogin AND NOT rolinherit
      AND NOT EXISTS(SELECT FROM pg_stat_activity WHERE usename=$1) ok FROM pg_roles WHERE rolname=$1`, [target.role])).rows[0];
    observe(`${label}_checked_fence`, true, result.ack === true && result.committed === true && row?.ok === true);
  }

  // Bounded reproduction of the final-review ACL race. Roll back each
  // competing grant before acknowledging private delivery; report no SQL.
  const aclCases = [
    ["schema", "GRANT CREATE ON SCHEMA public TO square_production_runtime_authority"],
    ["relation", "GRANT SELECT ON private.square_production_generation_fences TO square_production_runtime_authority"],
    ["database", "GRANT CREATE ON DATABASE postgres TO square_production_runtime_authority"],
    ["parameter", "GRANT SET ON PARAMETER session_replication_role TO PUBLIC"],
    ["default", "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO square_production_runtime_authority"],
  ];
  let aclBlocked = true, aclObserved = 0;
  const aclAssignment = await native.assign({ ...context("concurrency-acl-review"), async deliver() {
    for (const [name, sql] of aclCases) {
      const client = await fixture.connect();
      await client.query("BEGIN; SET LOCAL lock_timeout='100ms'");
      let outcome = "applied";
      try { await client.query(sql); }
      catch (error) { outcome = error?.code === "55P03" ? "lock_timeout" : error?.code === "40P01" ? "deadlock" : "failed"; }
      await client.query("ROLLBACK"); await client.end();
      process.stdout.write(JSON.stringify({ outcome: "production_concurrency", case: `acl_${name}`,
        expected: "lock_timeout", actual: outcome }) + "\n");
      aclBlocked &&= outcome === "lock_timeout"; aclObserved++;
    }
    return { ack: true };
  } });
  observe("all_checked_acl_mutations_blocked", true,
    aclBlocked && aclObserved === aclCases.length && aclAssignment.committed === true);

  // All four actual DDL paths wait on native-held locks. No fixture lock masks
  // protection. Completion is coordinated by pg_locks, not a lucky sleep.
  for (const exit of ["commit", "rollback", "timeout"]) {
    let pid, delivery = false, releaseDelivery;
    const pendingDelivery = new Promise(resolve => { releaseDelivery = resolve; });
    const waiters = [];
    let acknowledged = false, observedAllWaits = false, deliveryAt;
    try {
      const result = await native.assign({ ...context(`concurrency-${exit}`), async deliver() {
        delivery = true; deliveryAt = Date.now(); pid = await nativePid();
        observe(`${exit}_native_holds_all_catalogs`, true, await held(pid));
        for (const [name, relation, sql] of cases) {
          const client = await fixture.connect();
          await client.query("BEGIN; SET LOCAL lock_timeout='6000ms'; SET LOCAL statement_timeout='6500ms'");
          const waiterPid = (await client.query("SELECT pg_backend_pid() pid")).rows[0].pid;
          const completion = client.query(sql).then(() => "applied", error =>
            error?.code === "40P01" ? "deadlock" : error?.code === "55P03" ? "lock_timeout" : "failed");
          waiters.push({ name, client, completion });
          await until(() => waiting(waiterPid, relation, pid), `${exit}_${name}_wait_observed`);
          observe(`${exit}_${name}_blocked_by_native`, true, await held(pid));
        }
        observedAllWaits = true;
        if (exit === "rollback") throw new Error("synthetic_store_rejection");
        if (exit === "timeout") await pendingDelivery; // Native's fixed 5s acknowledgement deadline.
        return { ack: true };
      } });
      acknowledged = result.ack === true && result.committed === true;
    } catch { acknowledged = false; }
    finally { releaseDelivery(); }
    observe(`${exit}_delivery_reached`, true, delivery);
    observe(`${exit}_all_four_waits_observed`, true, observedAllWaits);
    if (exit === "timeout") observe("native_ack_deadline_exercised", true,
      Date.now() - deliveryAt >= 4500 && Date.now() - deliveryAt < 10000);
    observe(`${exit}_acknowledged`, exit === "commit", acknowledged);
    for (const { name, client, completion } of waiters) {
      const outcome = await completion;
      await client.query("ROLLBACK"); await client.end();
      observe(`${exit}_${name}_released`, "applied", outcome);
    }
    await released(pid, `${exit}_all_locks_released`);
    await fenced(exit);
  }

  // Native/native overlap: a fence and inspect queued at the first catalog
  // must finish after assignment commits, without a membership lock upgrade.
  let queued = [], assignPid;
  const assigned = await native.assign({ ...context("concurrency-native-peers"), async deliver() {
    assignPid = await nativePid();
    // Each adapter deliberately refuses overlap within its own process.
    // Independent adapters model the separate native workers under test.
    queued = ["fence", "inspect"].map(op => createPeer()[op](context(`concurrency-peer-${op}`)).then(
      result => result.ack === true, () => false));
    await until(async () => (await control.query(`SELECT count(*)::int n FROM pg_locks
      WHERE relation='pg_proc'::regclass AND NOT granted AND $1=ANY(pg_blocking_pids(pid))`, [assignPid])).rows[0].n === 2,
    "native_peers_wait_at_first_catalog");
    return { ack: true };
  } });
  observe("native_assignment_commits", true, assigned.committed === true);
  const peers = await Promise.all(queued);
  observe("native_fence_and_inspect_finish", true, peers.every(Boolean));
  await released(assignPid, "native_overlap_releases_locks");

  // Competing order: native is observed waiting for a later catalog; the
  // competing session then requests the first catalog with a shorter bounded
  // timeout. Its rollback must let native finish. Also cover same-order and
  // native-first-lock timeout without credential generation/delivery.
  for (const relation of catalogs) {
    const client = await fixture.connect();
    await client.query(`BEGIN; SET LOCAL lock_timeout='100ms'; LOCK TABLE pg_catalog.${relation} IN ROW EXCLUSIVE MODE`);
    const blocker = (await client.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    let delivered = false;
    const operation = native.assign({ ...context(`concurrency-order-${relation}`), async deliver() { delivered = true; return { ack: true }; } })
      .then(result => result.committed === true, () => false);
    let pid;
    await until(async () => {
      const rows = (await control.query(`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a USING(pid)
        WHERE NOT l.granted AND l.relation=$1::regclass AND a.application_name='vaeroex-native-provisioner'
        AND $2=ANY(pg_blocking_pids(l.pid))`, [`pg_catalog.${relation}`, blocker])).rows;
      pid = rows[0]?.pid; return rows.length === 1;
    }, `order_${relation}_native_wait_observed`);
    let competing = "acquired";
    try { await client.query("LOCK TABLE pg_catalog.pg_proc IN ROW EXCLUSIVE MODE"); }
    catch (error) { competing = error?.code === "55P03" ? "lock_timeout" : error?.code === "40P01" ? "deadlock" : "failed"; }
    await client.query("ROLLBACK"); await client.end();
    observe(`order_${relation}_competing`, relation === "pg_proc" ? "acquired" : "lock_timeout", competing);
    observe(`order_${relation}_native_finishes`, true, await operation);
    observe(`order_${relation}_delivery_after_release`, true, delivered);
    await released(pid, `order_${relation}_locks_released`);
  }
  const blocker = await fixture.connect();
  await blocker.query("BEGIN; LOCK TABLE pg_catalog.pg_proc IN ROW EXCLUSIVE MODE");
  let delivered = false, denied = false;
  try { await native.assign({ ...context("concurrency-native-lock-timeout"), async deliver() { delivered = true; return { ack: true }; } }); }
  catch { denied = true; }
  await blocker.query("ROLLBACK"); await blocker.end();
  observe("native_lock_timeout_denied_before_delivery", true, denied && !delivered);
  await fenced("native_lock_timeout");
};
