import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticProvisioningCoordinator, createInMemorySyntheticSecretStore,
  realProvisioningEnabled, provisionRealBroker } from "../lifecycle.mjs";
import { createLocalSyntheticNativeAdapter } from "../adapter.mjs";

// Deliberately deterministic synthetic bytes, never a credential generator.
const target = Object.freeze({ projectReference: "synthetic-project", host: "127.0.0.1", port: 15432,
  database: "synthetic", role: "square_sandbox_synthetic_broker", systemIdentifier: "123456789",
  databaseOid: "123", adminRole: "synthetic_native_owner", capabilityRole: "square_account_broker_authority",
  rootCertificate: "/synthetic/ca.pem", roleOid: "0" });
const invocation = Object.freeze({ operation: "create", actor: "synthetic-operator", intent: "intent-1", approvalId: "synthetic-only" });
const acknowledged = () => ({ ack: true, authorityClosed: true });
const defer = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };

function fixture({ nativeOverrides = {}, storeOverrides = {}, auditOverride, configuredTarget = target } = {}) {
  const calls = [], events = [], delivered = [], readCopies = [], handles = [];
  const memory = createInMemorySyntheticSecretStore();
  let generation = 0, login = false, serverCredential;
  const secretStore = {
    reserve(context) { const value = memory.reserve(context); handles.push(value); calls.push("reserve"); return value; },
    async stage(handle, bytes) { calls.push("stage"); return memory.stage(handle, bytes); },
    async withCredential(handle, consume) {
      calls.push("read");
      return memory.withCredential(handle, bytes => { readCopies.push(bytes); return consume(bytes); });
    },
    async markStagedReady(handle) { calls.push("ready"); return memory.markStagedReady(handle); },
    async discard(handle) { calls.push("discard"); return memory.discard(handle); },
    ...storeOverrides,
  };
  const base = {
    async inspect() { return acknowledged(); },
    async prepare() { login = false; return { ...acknowledged(), committed: true, noLogin: true, roleOid: "42" }; },
    async fence() { login = false; return { ...acknowledged(), noLogin: true, sessionsTerminated: true }; },
    async assign({ deliver }) {
      const bytes = Buffer.alloc(48, ++generation);
      const privateCopy = Buffer.from(bytes);
      delivered.push(bytes);
      await deliver(bytes);
      serverCredential?.fill(0); serverCredential = privateCopy;
      return { ...acknowledged(), committed: true, storeAcknowledged: true };
    },
    async activate() { login = true; return { ...acknowledged(), noLogin: false }; },
    async authenticate({ target: destination, withCredential }) {
      assert.equal(login, true);
      await withCredential(bytes => assert.ok(bytes.equals(serverCredential)));
      return { ...acknowledged(), sessionUser: destination.role, target: destination };
    },
    async abortAndDrain() { return { ack: true, drained: true }; },
  };
  const native = Object.fromEntries(Object.keys(base).map(name => [name, async context => {
    calls.push(name);
    assert.equal(Object.isFrozen(context.target), true);
    return (nativeOverrides[name] ?? base[name])(context, base);
  }]));
  const audit = { async append(event) {
    events.push(event);
    if (auditOverride) return auditOverride(event);
    return { ack: true };
  } };
  const coordinator = createSyntheticProvisioningCoordinator({ target: configuredTarget, native, secretStore, audit, now: () => 1000 });
  return { coordinator, native, secretStore, calls, events, delivered, readCopies, handles, memory, get login() { return login; } };
}

test("real provisioning is permanently blocked and has no enabling option", () => {
  assert.equal(realProvisioningEnabled, false);
  assert.deepEqual(provisionRealBroker({ enabled: true, realProvisioningEnabled: true }),
    { outcome: "blocked", reason: "provider_provisioning_not_qualified" });
  assert.equal(Object.isFrozen(provisionRealBroker()), true);
});

test("creation stages and verifies privately before commit, authenticates under closed authority, never publishes", async () => {
  const f = fixture();
  const result = await f.coordinator.run(invocation);
  assert.equal(result.outcome, "staged_ready");
  assert.equal(result.databaseCommit, "acknowledged");
  assert.equal(result.applicationAuthority, "verified_closed");
  assert.equal(result.credentialPublished, false);
  assert.deepEqual(f.calls, ["inspect", "reserve", "prepare", "fence", "assign", "stage", "read", "activate", "authenticate", "read", "abortAndDrain", "ready"]);
  assert.ok(f.delivered.every(bytes => bytes.every(value => value === 0)));
  assert.ok(f.readCopies.every(bytes => bytes.every(value => value === 0)));
  assert.equal(Object.isFrozen(result), true);
  for (const event of f.events) {
    assert.deepEqual(Object.keys(event), ["actor", "targetRole", "operation", "intent", "phase", "time", "outcome"]);
    assert.equal(Object.isFrozen(event), true);
  }
  assert.equal(JSON.stringify([result, f.events]).includes("rootCertificate"), false);
  await assert.rejects(f.memory.withCredential(f.handles[0], () => assert.fail("ready is not readable/publication")));
});

test("rotation uses the pinned existing OID and a fresh native candidate", async () => {
  const f = fixture({ configuredTarget: { ...target, roleOid: "42" } });
  const result = await f.coordinator.run({ ...invocation, operation: "rotate" });
  assert.equal(result.outcome, "staged_ready");
  assert.equal(f.calls.indexOf("fence") < f.calls.indexOf("assign"), true);
});

test("exact target is snapshotted, immutable, and preserves physical database identity", async () => {
  const input = { ...target };
  const f = fixture({ configuredTarget: input });
  input.host = "other.invalid"; input.databaseOid = "999";
  assert.equal(f.coordinator.target.host, target.host);
  assert.equal(f.coordinator.target.databaseOid, target.databaseOid);
  assert.throws(() => { f.coordinator.target.role = "postgres"; });
  assert.equal((await f.coordinator.run(invocation)).outcome, "staged_ready");
});

for (const field of Object.keys(target)) {
  test(`candidate cannot authenticate on another exact target: ${field}`, async () => {
    const f = fixture({ nativeOverrides: { async authenticate(context, base) {
      const value = await base.authenticate(context);
      return { ...value, target: { ...value.target, [field]: field === "port" ? 1234 : "other" } };
    } } });
    const result = await f.coordinator.run(invocation);
    assert.notEqual(result.outcome, "staged_ready");
    assert.equal(result.fenceConfirmed, true);
    assert.equal(f.login, false);
    assert.equal(f.calls.includes("ready"), false);
  });
}

test("current_user cannot substitute for actual session_user", async () => {
  const f = fixture({ nativeOverrides: { async authenticate(context, base) {
    const value = await base.authenticate(context);
    return { ...value, sessionUser: target.adminRole, currentUser: target.role };
  } } });
  const result = await f.coordinator.run(invocation);
  assert.notEqual(result.outcome, "staged_ready");
  assert.equal(f.login, false);
});

for (const method of ["inspect", "prepare", "fence", "assign", "activate", "authenticate", "abortAndDrain"]) {
  test(`sanitized native failure at ${method} cannot stage readiness`, async () => {
    const f = fixture({ nativeOverrides: { [method]: async () => { throw new Error("RAW_SYNTHETIC_SECRET_AND_PROVIDER_ERROR"); } } });
    const result = await f.coordinator.run(invocation);
    assert.notEqual(result.outcome, "staged_ready");
    assert.equal(result.credentialPublished, false);
    assert.equal(JSON.stringify([result, f.events]).includes("RAW_SYNTHETIC"), false);
    assert.equal(f.calls.includes("ready"), false);
  });
}

test("missing authority proof stops before private store, mutation or generation", async () => {
  const f = fixture({ nativeOverrides: { inspect: async () => ({ ack: true, authorityClosed: false }) } });
  const result = await f.coordinator.run(invocation);
  assert.equal(result.applicationAuthority, "unverified");
  assert.deepEqual(f.calls, ["inspect"]);
});

test("role OID reuse or replacement is rejected before generation", async () => {
  for (const operation of ["rotate", "recover"]) {
    const f = fixture({ configuredTarget: { ...target, roleOid: "43" }, nativeOverrides: {
      inspect: async () => ({ ack: false }),
    } });
    const result = await f.coordinator.run({ ...invocation, operation });
    assert.notEqual(result.outcome, "staged_ready");
    assert.equal(f.calls.includes("assign"), false);
  }
});

for (const metadata of [{ committed: false }, { storeAcknowledged: false }, { authorityClosed: false }, { ack: false }]) {
  test(`missing assignment acknowledgement ${Object.keys(metadata)[0]} is uncertain, not an audit-derived commit`, async () => {
    const f = fixture({ nativeOverrides: { async assign(context, base) { return { ...await base.assign(context), ...metadata }; } } });
    const result = await f.coordinator.run(invocation);
    assert.equal(result.outcome, "uncertain");
    assert.equal(result.databaseCommit, "uncertain");
    assert.equal(f.calls.includes("activate"), false);
    assert.equal(result.requiresFreshReplacement, true);
    assert.equal(result.fenceConfirmed, true);
  });
}

test("lost commit ACK fences, discards delivery, blocks blind retry and recovers by fresh replacement", async () => {
  let lose = true;
  const f = fixture({ configuredTarget: { ...target, roleOid: "42" }, nativeOverrides: { async assign(context, base) {
    const result = await base.assign(context);
    if (lose) { lose = false; throw new Error("ack lost"); }
    return result;
  } } });
  const first = await f.coordinator.run({ ...invocation, operation: "rotate" });
  assert.equal(first.outcome, "uncertain");
  assert.equal(first.databaseCommit, "uncertain");
  await assert.rejects(f.memory.withCredential(f.handles[0], () => assert.fail()));
  const before = f.calls.length;
  assert.equal((await f.coordinator.run({ ...invocation, intent: "intent-blind-retry", operation: "rotate" })).outcome, "blocked");
  assert.equal((await f.coordinator.run({ ...invocation, operation: "recover" })).outcome, "blocked");
  assert.equal(f.calls.length, before);
  const recovered = await f.coordinator.run({ ...invocation, operation: "recover", intent: "intent-fresh-replacement" });
  assert.equal(recovered.outcome, "staged_ready");
  assert.equal(f.delivered.length, 2);
  assert.equal(f.calls.filter(value => value === "assign").length, 2);
  assert.equal(f.calls.filter(value => value === "fence").length, 3);
});

for (const kind of ["throw", "incorrect", "duplicate", "missing", "not_buffer", "too_small", "too_large"]) {
  test(`private delivery ${kind} does not allow activation`, async () => {
    let extra;
    const f = fixture({
      storeOverrides: kind === "throw" ? { stage: async () => { throw new Error("PRIVATE_VALUE"); } }
        : kind === "incorrect" ? { withCredential: async (_handle, consume) => { await consume(Buffer.alloc(48, 255)); return { ack: true }; } } : {},
      nativeOverrides: ["duplicate", "missing", "not_buffer", "too_small", "too_large"].includes(kind) ? {
        async assign(context, base) {
          if (kind === "missing") return { ...acknowledged(), committed: true, storeAcknowledged: true };
          if (kind === "duplicate") { await base.assign(context); extra = Buffer.alloc(48, 9); await context.deliver(extra); }
          else { extra = kind === "not_buffer" ? "never_a_real_secret" : Buffer.alloc(kind === "too_small" ? 31 : 1025, 9); await context.deliver(extra); }
          return { ...acknowledged(), committed: true, storeAcknowledged: true };
        },
      } : {},
    });
    const result = await f.coordinator.run(invocation);
    assert.notEqual(result.outcome, "staged_ready");
    assert.equal(f.calls.includes("activate"), false);
    assert.ok(f.delivered.every(bytes => bytes.every(value => value === 0)));
    if (Buffer.isBuffer(extra)) assert.ok(extra.every(value => value === 0));
  });
}

test("cancellation before start has no mutation, secret or native access", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture();
  const result = await f.coordinator.run({ ...invocation, signal: controller.signal });
  assert.equal(result.outcome, "cancelled");
  assert.deepEqual(f.calls, []);
});

test("cancellation during assignment wipes and drains before compensation; late delivery cannot publish", async () => {
  const controller = new AbortController(), outstanding = defer(), entered = defer();
  let delivery;
  const f = fixture({ nativeOverrides: {
    async assign({ deliver }) { delivery = deliver; entered.resolve(); return outstanding.promise; },
    async abortAndDrain() { outstanding.resolve({ ...acknowledged(), committed: true, storeAcknowledged: true }); return { ack: true, drained: true }; },
  } });
  const running = f.coordinator.run({ ...invocation, signal: controller.signal });
  await entered.promise; controller.abort();
  const result = await running;
  assert.equal(result.outcome, "uncertain");
  assert.equal(f.calls.at(-2), "abortAndDrain");
  assert.equal(f.calls.at(-1), "fence");
  const late = Buffer.alloc(48, 19);
  await assert.rejects(delivery(late));
  assert.ok(late.every(value => value === 0));
  assert.equal(f.calls.includes("activate"), false);
  assert.equal(result.databaseCommit, "uncertain");
});

test("a cancel-request acknowledgement is not a drain barrier and cannot race compensation", async () => {
  const controller = new AbortController(), entered = defer(), pending = defer();
  const f = fixture({ nativeOverrides: {
    async activate() { entered.resolve(); return pending.promise; },
    async abortAndDrain() { return { ack: true, cancellationRequested: true }; },
  } });
  const running = f.coordinator.run({ ...invocation, signal: controller.signal });
  await entered.promise; controller.abort();
  const result = await running;
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.fenceConfirmed, false);
  assert.equal(f.calls.filter(value => value === "fence").length, 1);
  pending.resolve({ ...acknowledged(), noLogin: false });
  await Promise.resolve();
  assert.equal(f.calls.includes("authenticate"), false);
});

test("deadline and unavailable cleanup return uncertain without an unbounded wait", async () => {
  const pending = defer();
  const f = fixture({ nativeOverrides: { assign: () => pending.promise, abortAndDrain: () => pending.promise } });
  const result = await f.coordinator.run({ ...invocation, deadlineMs: 5, cleanupTimeoutMs: 5 });
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.fenceConfirmed, false);
  pending.resolve({ ack: false });
});

test("cancellation during private stage wipes the borrowed Buffer before stage settles", async () => {
  const controller = new AbortController(), pending = defer(), entered = defer();
  let borrowed;
  const f = fixture({ storeOverrides: { async stage(_handle, bytes) { borrowed = bytes; entered.resolve(); await pending.promise; return { ack: true }; } } });
  const running = f.coordinator.run({ ...invocation, signal: controller.signal });
  await entered.promise; controller.abort();
  const result = await running;
  assert.equal(result.outcome, "uncertain");
  assert.ok(borrowed.every(value => value === 0));
  pending.resolve();
  await Promise.resolve();
  assert.equal(f.calls.includes("activate"), false);
});

for (const at of ["verify_closed_authority", "assign_and_commit", "staged_ready"]) {
  test(`audit failure at ${at} cannot silently report readiness or prove commit`, async () => {
    const f = fixture({ auditOverride: event => {
      if (event.phase === at && event.outcome === "acknowledged") throw new Error("AUDIT_SENSITIVE_FAILURE");
      return { ack: true };
    } });
    const result = await f.coordinator.run(invocation);
    assert.notEqual(result.outcome, "staged_ready");
    assert.equal(result.auditComplete, false);
    if (at !== "verify_closed_authority") assert.equal(result.databaseCommit, "acknowledged");
    assert.equal(JSON.stringify(result).includes("AUDIT_SENSITIVE"), false);
    if (f.handles.length) await assert.rejects(f.memory.withCredential(f.handles[0], () => assert.fail()));
  });
}

test("discard uncertainty leaves a fenced result uncertain and requires replacement", async () => {
  const f = fixture({ nativeOverrides: { activate: async () => { throw new Error("failure"); } }, storeOverrides: { discard: async () => ({ ack: false }) } });
  const result = await f.coordinator.run(invocation);
  assert.equal(result.outcome, "uncertain");
  assert.equal(result.fenceConfirmed, true);
  assert.equal(result.requiresFreshReplacement, true);
});

test("concurrent operation and reused intent are blocked before side effects", async () => {
  const entered = defer(), pending = defer();
  const f = fixture({ nativeOverrides: { async inspect() { entered.resolve(); await pending.promise; return acknowledged(); } } });
  const first = f.coordinator.run(invocation);
  await entered.promise;
  assert.equal((await f.coordinator.run({ ...invocation, intent: "other" })).outcome, "blocked");
  assert.equal(f.calls.length, 1);
  pending.resolve();
  assert.equal((await first).outcome, "staged_ready");
  assert.equal((await f.coordinator.run(invocation)).outcome, "blocked");
});

test("memory reservations are private, one-stage, terminal on discard, and bounded", async () => {
  const store = createInMemorySyntheticSecretStore({ capacity: 1 });
  const handle = store.reserve({ target, intent: "one" });
  assert.equal(JSON.stringify(handle), "{}");
  assert.throws(() => store.reserve({ target, intent: "two" }));
  const input = Buffer.alloc(48, 7);
  await store.stage(handle, input); input.fill(0);
  let copy;
  await store.withCredential(handle, bytes => { copy = bytes; assert.equal(bytes[0], 7); });
  assert.ok(copy.every(value => value === 0));
  await assert.rejects(store.stage(handle, Buffer.alloc(48)));
  await store.discard(handle);
  await assert.rejects(store.stage(handle, Buffer.alloc(48)));
  await assert.rejects(store.withCredential(handle, () => assert.fail()));
  assert.throws(() => store.reserve({ target, intent: "one" }));
  const another = store.reserve({ target, intent: "two" });
  assert.notEqual(another, handle);
});

test("synthetic API rejects missing immutable-target fields and unbounded deadlines", async () => {
  assert.throws(() => fixture({ configuredTarget: { ...target, roleOid: undefined } }));
  assert.throws(() => fixture({ configuredTarget: { ...target, arbitrary: true } }));
  const f = fixture();
  await assert.rejects(f.coordinator.run({ ...invocation, deadlineMs: 30001 }));
  await assert.rejects(f.coordinator.run({ ...invocation, approvalId: undefined }));
  assert.deepEqual(f.calls, []);
});

test("native adapter cannot target a remote provider or receive an admin credential", () => {
  for (const patch of [{ host: "db.example.invalid" }, { host: "localhost" },
    { projectReference: "oysjpoondtcrqpghhrbd" }, { adminRole: {} }, { role: "postgres" },
    { role: "square_qbo_broker" }, { adminPassword: "synthetic-rejected" }]) {
    assert.throws(() => createLocalSyntheticNativeAdapter({ executable: "/synthetic/native", target: { ...target, ...patch } }));
  }
});

test("authentication requires completed private-store read, not an unawaited callback", async () => {
  const pending = defer();
  const f = fixture({ nativeOverrides: { async authenticate(context) {
    context.withCredential(async () => pending.promise).catch(() => undefined);
    return { ...acknowledged(), sessionUser: context.target.role, target: context.target };
  } } });
  const result = await f.coordinator.run(invocation);
  assert.notEqual(result.outcome, "staged_ready");
  assert.equal(result.fenceConfirmed, true);
  assert.ok(f.readCopies.every(bytes => bytes.every(value => value === 0)));
  pending.resolve();
  await Promise.resolve();
  assert.equal(f.calls.includes("ready"), false);
});

test("uncertain create with acknowledged role identity recovers without recreating it", async () => {
  let lose = true;
  const f = fixture({ nativeOverrides: { async assign(context, base) {
    const assigned = await base.assign(context);
    if (lose) { lose = false; throw new Error("lost commit ack"); }
    return assigned;
  } } });
  assert.equal((await f.coordinator.run(invocation)).outcome, "uncertain");
  const recovered = await f.coordinator.run({ ...invocation, operation: "recover", intent: "fresh-create-recovery" });
  assert.equal(recovered.outcome, "staged_ready");
  assert.equal(f.calls.filter(value => value === "prepare").length, 1);
  assert.equal(f.calls.filter(value => value === "assign").length, 2);
});

for (const failure of ["audit_rejection", "audit_cancellation"]) {
  test(`committed prepare OID survives ${failure} before recovery`, async () => {
    const controller = new AbortController();
    let fail = true;
    const f = fixture({ auditOverride: event => {
      if (fail && event.phase === "prepare_no_login" && event.outcome === "acknowledged") {
        fail = false;
        if (failure === "audit_cancellation") controller.abort();
        else throw new Error("synthetic audit unavailable");
      }
      return { ack: true };
    }, nativeOverrides: {
      async fence(context, base) {
        assert.equal(context.target.roleOid, "42", "compensation must use acknowledged role OID");
        return base.fence(context);
      },
      async inspect(context, base) {
        if (!fail) assert.equal(context.target.roleOid, "42", "recovery must use acknowledged role OID");
        return base.inspect(context);
      },
    } });
    const first = await f.coordinator.run({ ...invocation, signal: controller.signal });
    assert.notEqual(first.outcome, "staged_ready");
    assert.equal(first.fenceConfirmed, true);
    assert.equal(first.requiresFreshReplacement, true);
    assert.equal(f.calls.includes("assign"), false);
    const second = await f.coordinator.run({ ...invocation, operation: "recover", intent: `recover-${failure}` });
    assert.equal(second.outcome, "staged_ready");
    assert.equal(f.calls.filter(value => value === "prepare").length, 1);
  });
}

test("committed prepare ACK arriving during abort drain is pinned before fresh fence and recovery", async () => {
  const controller = new AbortController(), delivery = defer();
  const f = fixture({ nativeOverrides: {
    async prepare(context, base) {
      const prepared = await base.prepare(context);
      controller.abort();
      await delivery.promise;
      return prepared;
    },
    async abortAndDrain(_context, base) {
      delivery.resolve();
      return base.abortAndDrain();
    },
    async fence(context, base) {
      assert.equal(context.target.roleOid, "42", "drained prepare identity must precede compensation");
      return base.fence(context);
    },
  } });
  const cancelled = await f.coordinator.run({ ...invocation, signal: controller.signal });
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.fenceConfirmed, true);
  assert.equal(f.calls.includes("assign"), false);
  const recovered = await f.coordinator.run({ ...invocation, operation: "recover", intent: "recover-drained-prepare" });
  assert.equal(recovered.outcome, "staged_ready");
  assert.equal(f.calls.filter(value => value === "prepare").length, 1);
});

test("deadline after prepare commit consumes authenticated ACK within the bounded drain window", async () => {
  const delivery = defer();
  const f = fixture({ nativeOverrides: {
    async prepare(context, base) { const prepared = await base.prepare(context); await delivery.promise; return prepared; },
    async abortAndDrain(_context, base) { setImmediate(() => delivery.resolve()); return base.abortAndDrain(); },
    async fence(context, base) {
      assert.equal(context.target.roleOid, "42");
      return base.fence(context);
    },
  } });
  const cancelled = await f.coordinator.run({ ...invocation, deadlineMs: 5, cleanupTimeoutMs: 100 });
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.fenceConfirmed, true);
  assert.equal(f.calls.includes("assign"), false);
  const recovered = await f.coordinator.run({ ...invocation, operation: "recover", intent: "recover-deadline-prepare" });
  assert.equal(recovered.outcome, "staged_ready");
  assert.equal(f.calls.filter(value => value === "prepare").length, 1);
});

test("prepare ACK after bounded drain expiry cannot mutate finalized identity or enable blind recovery", async () => {
  const controller = new AbortController(), delivery = defer();
  const seenOids = [];
  const f = fixture({ nativeOverrides: {
    async prepare(context, base) {
      const prepared = await base.prepare(context);
      controller.abort();
      await delivery.promise;
      return prepared;
    },
    async fence(context) { seenOids.push(context.target.roleOid); return { ack: false }; },
    async inspect(context, base) {
      if (context.operation === "recover") {
        seenOids.push(context.target.roleOid);
        return { ack: false }; // Existing role cannot be adopted by its name.
      }
      return base.inspect(context);
    },
  } });
  const unresolved = await f.coordinator.run({ ...invocation, signal: controller.signal, cleanupTimeoutMs: 5 });
  assert.equal(unresolved.outcome, "uncertain");
  assert.equal(unresolved.fenceConfirmed, false);
  const snapshot = JSON.stringify(unresolved);
  delivery.resolve();
  await new Promise(resolve => setImmediate(resolve));
  const recovery = await f.coordinator.run({ ...invocation, operation: "recover", intent: "unknown-oid-recovery" });
  assert.notEqual(recovery.outcome, "staged_ready");
  assert.deepEqual(seenOids, ["0", "0"]);
  assert.equal(JSON.stringify(unresolved), snapshot);
  assert.equal(f.calls.includes("assign"), false);
  assert.equal(f.calls.filter(value => value === "prepare").length, 1);
});

for (const proof of ["commit_missing", "commit_false", "drain_missing"]) {
  test(`late prepare identity is not adopted with ${proof}`, async () => {
    const controller = new AbortController(), delivery = defer();
    const f = fixture({ nativeOverrides: {
      async prepare(context, base) {
        const prepared = await base.prepare(context);
        if (proof === "commit_missing") delete prepared.committed;
        if (proof === "commit_false") prepared.committed = false;
        controller.abort();
        await delivery.promise;
        return prepared;
      },
      async abortAndDrain(_context, base) {
        delivery.resolve();
        return proof === "drain_missing" ? { ack: true, cancellationRequested: true } : base.abortAndDrain();
      },
      async fence(context) { assert.equal(context.target.roleOid, "0"); return { ack: false }; },
    } });
    const result = await f.coordinator.run({ ...invocation, signal: controller.signal });
    assert.equal(result.outcome, "uncertain");
    assert.equal(result.fenceConfirmed, false);
    assert.equal(f.calls.includes("assign"), false);
    if (proof === "drain_missing") assert.equal(f.calls.includes("fence"), false);
  });
}
