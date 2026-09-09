import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleSecretManagerStagingStore } from "../secret-store.mjs";
import { createSyntheticProvisioningCoordinator } from "../lifecycle.mjs";

// Entirely in-memory synthetic client: no SDK, credentials, sockets or files.
const projectId = "synthetic-staging-project", projectNumber = "123456789";
const secretParent = `projects/${projectId}/secrets/synthetic-broker`;
const canonicalParent = `projects/${projectNumber}/secrets/synthetic-broker`;
const candidate = () => Buffer.alloc(128, 97);
const invocation = Object.freeze({ operation: "create", actor: "synthetic-operator",
  intent: "synthetic-intent", approvalId: "synthetic-approval", target: { role: "square_synthetic_broker" } });
const denied = error => error instanceof Error && error.message === "google_secret_manager_staging_denied" && !error.cause;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const zero = bytes => assert.ok(bytes.every(value => value === 0), "owned buffer was wiped");
const same = (left, right) => assert.ok(left.equals(right), "synthetic byte equality");

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function fixture({ overrides = {}, config = {} } = {}) {
  const records = new Map(), calls = [], requestPayloads = [], responsePayloads = [];
  let next = 0;
  const metadata = record => ({ name: record.name, state: record.state, etag: record.etag,
    clientSpecifiedPayloadChecksum: true });
  const base = {
    async addSecretVersion(request) {
      assert.equal(request.parent, secretParent);
      assert.equal(request.payload.dataCrc32c, crc(request.payload.data));
      requestPayloads.push(request.payload.data);
      const name = `${canonicalParent}/versions/${++next}`;
      const record = { name, state: "ENABLED", etag: `synthetic-${next}`, data: Buffer.from(request.payload.data) };
      records.set(name, record);
      return [metadata(record)];
    },
    async accessSecretVersion({ name }) {
      const record = records.get(name);
      if (!record || record.state !== "ENABLED") throw new Error("synthetic provider detail must not escape");
      const data = Buffer.from(record.data);
      responsePayloads.push(data);
      return [{ name, payload: { data, dataCrc32c: String(crc(data)) } }];
    },
    async getSecretVersion({ name }) {
      const record = records.get(name);
      if (!record) throw new Error("synthetic provider detail must not escape");
      return [metadata(record)];
    },
    async disableSecretVersion({ name, etag }) {
      const record = records.get(name);
      if (!record || etag !== record.etag) throw new Error("synthetic stale etag");
      record.state = "DISABLED";
      record.etag += "-disabled";
      return [metadata(record)];
    },
  };
  const client = Object.fromEntries(Object.keys(base).map(method => [method, (request, options) => {
    calls.push({ method, request, options });
    return (overrides[method] ?? base[method])(request, base, options);
  }]));
  const store = createGoogleSecretManagerStagingStore({ client, projectId, projectNumber, secretParent, timeoutMs: 50, ...config });
  return { store, client, records, calls, base, requestPayloads, responsePayloads,
    reserve: extra => store.reserve({ ...invocation, ...extra }),
    count: method => calls.filter(call => call.method === method).length };
}

async function stage(f, handle = f.reserve()) {
  const bytes = candidate();
  try {
    assert.equal((await f.store.stage(handle, bytes)).ack, true);
    assert.ok(bytes.every(value => value === 97), "caller candidate remains caller-owned");
    return handle;
  } finally { bytes.fill(0); }
}

async function readTwice(f, handle) {
  for (let index = 0; index < 2; index++) {
    let borrowed;
    assert.equal((await f.store.withCredential(handle, bytes => {
      borrowed = bytes;
      assert.ok(bytes.every(value => value === 97), "expected synthetic password");
    })).ack, true);
    zero(borrowed);
  }
}

test("inert construction/reserve, immutable pin, private reads and exact owned cleanup", async () => {
  const f = fixture();
  const handle = f.reserve();
  assert.equal(f.calls.length, 0);
  assert.equal(Object.isFrozen(handle), true);
  assert.deepEqual(Object.keys(handle), []);
  assert.equal(Object.getPrototypeOf(handle), null);
  await stage(f, handle);
  assert.deepEqual(f.calls.map(call => call.method), ["addSecretVersion", "accessSecretVersion"]);
  assert.equal(f.store.metadata(handle).state, "staged");
  assert.equal(f.store.metadata(handle).versionName, undefined);
  f.requestPayloads.forEach(zero); f.responsePayloads.forEach(zero);
  await readTwice(f, handle);
  const ready = await f.store.markStagedReady(handle);
  assert.deepEqual(ready, { ack: true, outcome: "staged_ready", credentialPublished: false,
    versionName: `${canonicalParent}/versions/1` });
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(f.store.metadata(handle).versionName, ready.versionName);
  await assert.rejects(f.store.withCredential(handle, () => assert.fail("ready is not a reader")), denied);
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.equal(f.records.get(ready.versionName).state, "DISABLED");
  assert.equal(f.store.metadata(handle).versionName, undefined);
  assert.equal(f.count("addSecretVersion"), 1);
  assert.equal(f.count("disableSecretVersion"), 1);
  for (const call of f.calls) {
    assert.equal(call.options.retry, null);
    assert.equal(call.options.timeout, 50);
    if (call.request.name) assert.equal(call.request.name, ready.versionName);
  }
});

test("codec covers actual stored bytes and wipes independent pooled buffers", async () => {
  const observed = [];
  const f = fixture({ config: { payloadCodec: {
    encode(bytes) { observed.push(bytes); const result = Buffer.from("123456789"); observed.push(result); return result; },
    decode(bytes) { observed.push(bytes); const result = candidate(); observed.push(result); return result; },
  } } });
  const handle = await stage(f);
  assert.equal(f.calls[0].request.payload.dataCrc32c, 0xe3069283);
  observed.forEach(zero);
  assert.equal(f.records.values().next().value.data.length, 9);
  await readTwice(f, handle);
  observed.forEach(zero);
  await f.store.discard(handle);
});

for (const [label, config] of [
  ["foreign parent", { secretParent: "projects/other-project/secrets/synthetic-broker" }],
  ["invalid parent", { secretParent: `${secretParent}/versions/1` }],
  ["missing number", { projectNumber: undefined }],
  ["invalid number", { projectNumber: "01" }],
  ["invalid project", { projectId: "bad" }],
  ["zero capacity", { capacity: 0 }],
  ["oversize capacity", { capacity: 257 }],
  ["zero timeout", { timeoutMs: 0 }],
  ["oversize timeout", { timeoutMs: 10001 }],
  ["missing client method", { client: {} }],
]) test(`invalid configuration rejected without I/O: ${label}`, () => assert.throws(() => fixture({ config }), denied));

test("reservation rejects duplicate intent, abort and capacity without I/O", async () => {
  const f = fixture({ config: { capacity: 1 } });
  const handle = f.reserve();
  assert.throws(() => f.reserve(), denied);
  assert.throws(() => f.reserve({ intent: "second" }), denied);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => f.reserve({ intent: "third", signal: controller.signal }), denied);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.throws(() => f.reserve(), denied);
  assert.ok(f.reserve({ intent: "second" }));
});

for (const [label, bytes] of [
  ["short", () => Buffer.alloc(127, 97)], ["uppercase", () => Buffer.alloc(128, 65)],
  ["nonhex", () => Buffer.alloc(128, 103)], ["string", () => "synthetic-not-buffer"],
  ["shared memory", () => Buffer.from(new SharedArrayBuffer(128)).fill(97)],
]) test(`reject non-native candidate before I/O: ${label}`, async () => {
  const f = fixture(), handle = f.reserve(), input = bytes();
  try { await assert.rejects(f.store.stage(handle, input), denied); }
  finally { if (Buffer.isBuffer(input)) input.fill(0); }
  assert.equal(f.calls.length, 0);
  await f.store.discard(handle);
});

for (const version of ["latest", "0", "01", "1/extra"]) {
  test(`unusable version ACK cannot authorize guessed cleanup: ${version}`, async () => {
    const f = fixture({ overrides: { async addSecretVersion(request, base) {
      const [reply] = await base.addSecretVersion(request); reply.name = `${canonicalParent}/versions/${version}`; return [reply];
    } } }), handle = f.reserve();
    await assert.rejects(stage(f, handle), denied);
    assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
    assert.equal(f.count("addSecretVersion"), 1);
    assert.equal(f.count("getSecretVersion"), 0);
    assert.equal(f.count("disableSecretVersion"), 0);
    assert.throws(() => f.reserve({ intent: "replacement" }), denied);
  });
}

for (const name of ["projects/987654321/secrets/synthetic-broker/versions/1",
  `projects/${projectNumber}/secrets/foreign-secret/versions/1`]) {
  test(`foreign resource ACK is never adopted: ${name.includes("foreign") ? "secret" : "project"}`, async () => {
    const f = fixture({ overrides: { async addSecretVersion(request, base) {
      const [reply] = await base.addSecretVersion(request); reply.name = name; return [reply];
    } } }), handle = f.reserve();
    await assert.rejects(stage(f, handle), denied);
    assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
    assert.equal(f.count("disableSecretVersion"), 0);
    assert.equal(f.store.metadata(handle).ownedVersionKnown, false);
  });
}

for (const variant of ["checksum-unconfirmed", "wrong-crc", "invalid-crc", "wrong-data", "wrong-version", "missing-payload", "oversized"]) {
  test(`stage integrity failure closes and disables only the ACKed owned version: ${variant}`, async () => {
    const f = fixture({ overrides: {
      async addSecretVersion(request, base) {
        const [reply] = await base.addSecretVersion(request);
        if (variant === "checksum-unconfirmed") reply.clientSpecifiedPayloadChecksum = false;
        return [reply];
      },
      async accessSecretVersion(request, base) {
        const [reply] = await base.accessSecretVersion(request);
        if (variant === "wrong-crc") reply.payload.dataCrc32c = 0;
        if (variant === "invalid-crc") reply.payload.dataCrc32c = "4294967296";
        if (variant === "wrong-data") { reply.payload.data[0] = 98; reply.payload.dataCrc32c = crc(reply.payload.data); }
        if (variant === "wrong-version") reply.name = `${canonicalParent}/versions/999`;
        if (variant === "missing-payload") { reply.payload.data.fill(0); delete reply.payload; }
        if (variant === "oversized") { reply.payload.data.fill(0); reply.payload.data = Buffer.alloc(8193); }
        return [reply];
      },
    } }), handle = f.reserve();
    await assert.rejects(stage(f, handle), denied);
    assert.equal(f.store.metadata(handle).state, "recovery_pending");
    assert.equal((await f.store.discard(handle)).ack, true);
    assert.equal(f.count("disableSecretVersion"), 1);
    assert.equal(f.records.get(`${canonicalParent}/versions/1`).state, "DISABLED");
    f.requestPayloads.forEach(zero); f.responsePayloads.forEach(zero);
  });
}

test("genuinely lost add ACK blocks new reservations and cannot guess a version", async () => {
  const f = fixture({ overrides: { async addSecretVersion(request, base) {
    await base.addSecretVersion(request); throw new Error("untrusted provider error with synthetic private details");
  } } }), handle = f.reserve();
  await assert.rejects(stage(f, handle), denied);
  assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
  assert.equal((await f.store.reconcile(handle)).outcome, "recovery_pending");
  assert.equal(f.count("addSecretVersion"), 1);
  assert.equal(f.count("disableSecretVersion"), 0);
  assert.equal(f.records.values().next().value.state, "ENABLED");
  assert.equal(f.store.metadata(handle).ownedVersionKnown, false);
  assert.throws(() => f.reserve({ intent: "replacement" }), denied);
});

test("late original ACK permits explicit exact-version cleanup, never late readiness or unrelated cleanup", async () => {
  const gate = deferred(); let originalAck;
  const f = fixture({ overrides: { async addSecretVersion(request, base) {
    originalAck = await base.addSecretVersion(request); await gate.promise; return originalAck;
  } }, config: { timeoutMs: 15 } }), handle = f.reserve();
  await assert.rejects(stage(f, handle), denied);
  assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
  const unrelated = `${canonicalParent}/versions/99`;
  f.records.set(unrelated, { name: unrelated, state: "ENABLED", etag: "unrelated", data: candidate() });
  const before = f.calls.length;
  gate.resolve(); await tick();
  assert.equal(f.calls.length, before, "late ACK launches no cloud I/O");
  assert.equal(f.store.metadata(handle).ownedVersionKnown, true);
  await assert.rejects(f.store.markStagedReady(handle), denied);
  assert.equal((await f.store.reconcile(handle)).ack, true);
  assert.equal(f.records.get(unrelated).state, "ENABLED");
  assert.equal(f.count("addSecretVersion"), 1);
  assert.equal(f.count("disableSecretVersion"), 1);
  assert.ok(f.reserve({ intent: "replacement" }));
});

test("discard synchronously tombstones and wipes during an in-flight add", async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ overrides: { async addSecretVersion(request, base) {
    const reply = await base.addSecretVersion(request); started.resolve(); await gate.promise; return reply;
  } } }), handle = f.reserve();
  const staging = assert.rejects(stage(f, handle), denied);
  await started.promise;
  const cleanup = f.store.discard(handle);
  assert.equal(f.store.metadata(handle).state, "recovery_pending");
  f.requestPayloads.forEach(zero);
  await assert.rejects(f.store.withCredential(handle, () => assert.fail("terminal reservation")), denied);
  gate.resolve();
  assert.equal((await cleanup).ack, true);
  await staging;
  assert.equal(f.count("accessSecretVersion"), 0);
});

test("abort immediately wipes a borrowed callback buffer and prevents its late ACK", async () => {
  const controller = new AbortController(), gate = deferred(), started = deferred();
  const f = fixture(), handle = await stage(f, f.reserve({ signal: controller.signal }));
  let borrowed;
  const reading = assert.rejects(f.store.withCredential(handle, bytes => {
    borrowed = bytes; started.resolve(); return gate.promise;
  }), denied);
  await started.promise; controller.abort();
  zero(borrowed);
  assert.equal(f.store.metadata(handle).recoveryPending, true);
  gate.resolve(); await reading;
  assert.equal((await f.store.discard(handle)).ack, true);
});

test("an access reply after timeout is wiped without invoking the consumer", async () => {
  const gate = deferred(); let late, delay = false;
  const f = fixture({ overrides: { async accessSecretVersion(request, base) {
    const reply = await base.accessSecretVersion(request);
    if (delay) { late = reply[0].payload.data; await gate.promise; }
    return reply;
  } }, config: { timeoutMs: 15 } }), handle = await stage(f);
  // Mutation of the client's methods cannot replace the constructor snapshot.
  f.client.accessSecretVersion = () => assert.fail("constructor snapshots methods");
  delay = true;
  await assert.rejects(f.store.withCredential(handle, () => assert.fail("late read cannot deliver")), denied);
  assert.ok(late.some(value => value !== 0), "transport owns pending reply until it settles");
  gate.resolve(); await tick(); zero(late);
  await f.store.discard(handle);
});

test("lost disable ACK is settled by exact DISABLED readback with one write", async () => {
  const f = fixture({ overrides: { async disableSecretVersion(request, base) {
    await base.disableSecretVersion(request); throw new Error("synthetic lost acknowledgement");
  } } }), handle = await stage(f);
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.equal(f.count("disableSecretVersion"), 1);
  assert.equal(f.store.metadata(handle).recoveryPending, false);
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.equal(f.count("disableSecretVersion"), 1);
});

test("etag conflict remains explicit recovery pending without blind disable retry", async () => {
  const f = fixture({ overrides: { async disableSecretVersion() { throw new Error("synthetic conflict"); } } });
  const handle = await stage(f);
  assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
  assert.equal(f.count("disableSecretVersion"), 1);
  assert.equal(f.records.values().next().value.state, "ENABLED");
  assert.throws(() => f.reserve({ intent: "replacement" }), denied);
});

test("readiness requires two successful reads and current ENABLED metadata", async () => {
  const f = fixture(), handle = await stage(f);
  await assert.rejects(f.store.markStagedReady(handle), denied);
  await f.store.withCredential(handle, () => undefined);
  await assert.rejects(f.store.markStagedReady(handle), denied);
  await f.store.withCredential(handle, () => undefined);
  f.records.values().next().value.state = "DISABLED";
  await assert.rejects(f.store.markStagedReady(handle), denied);
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.equal(f.count("disableSecretVersion"), 0);
});

for (const variant of ["input", "overlapping-view", "non-buffer", "empty", "oversized", "shared-memory", "wrong-decode"]) {
  test(`trusted codec contract rejects unsafe output: ${variant}`, async () => {
    const f = fixture({ config: { payloadCodec: {
      encode(bytes) {
        if (variant === "input") return bytes;
        if (variant === "overlapping-view") return bytes.subarray(1);
        if (variant === "non-buffer") return "not-buffer";
        if (variant === "empty") return Buffer.alloc(0);
        if (variant === "oversized") return Buffer.alloc(8193);
        if (variant === "shared-memory") return Buffer.from(new SharedArrayBuffer(128)).fill(97);
        return Buffer.from(bytes);
      },
      decode() { return Buffer.alloc(128, 98); },
    } } }), handle = f.reserve();
    await assert.rejects(stage(f, handle), denied);
    assert.equal(f.count("addSecretVersion"), variant === "wrong-decode" ? 1 : 0);
    assert.equal((await f.store.discard(handle)).ack, true);
  });
}

for (const variant of ["resolved", "rejected"]) {
  test(`async codec is rejected, with late bytes or rejection consumed: ${variant}`, async () => {
    const gate = deferred(), eventual = candidate();
    const f = fixture({ config: { payloadCodec: {
      encode() { return gate.promise; }, decode: bytes => Buffer.from(bytes),
    } } }), handle = f.reserve();
    await assert.rejects(stage(f, handle), denied);
    assert.equal(f.calls.length, 0);
    if (variant === "resolved") gate.resolve(eventual);
    else { gate.reject(new Error("untrusted synthetic codec error")); eventual.fill(0); }
    await tick(); zero(eventual);
    assert.equal((await f.store.discard(handle)).ack, true);
  });
}

test("concurrent reads and readiness are rejected while one private consumer is active", async () => {
  const f = fixture(), handle = await stage(f), gate = deferred(), started = deferred();
  const first = f.store.withCredential(handle, () => { started.resolve(); return gate.promise; });
  await started.promise;
  await assert.rejects(f.store.withCredential(handle, () => assert.fail("concurrent callback")), denied);
  await assert.rejects(f.store.markStagedReady(handle), denied);
  gate.resolve(); assert.equal((await first).ack, true);
  await f.store.discard(handle);
});

test("concurrent explicit cleanup shares a single exact disable operation", async () => {
  const gate = deferred(), started = deferred();
  const f = fixture({ overrides: { async disableSecretVersion(request, base) {
    started.resolve(); await gate.promise; return base.disableSecretVersion(request);
  } } }), handle = await stage(f);
  const first = f.store.discard(handle);
  await started.promise;
  const second = f.store.reconcile(handle);
  assert.equal(first, second);
  gate.resolve();
  assert.equal((await first).ack, true);
  assert.equal((await second).ack, true);
  assert.equal(f.count("disableSecretVersion"), 1);
});

for (const variant of ["foreign-metadata", "unknown-state", "missing-etag", "malformed-etag"]) {
  test(`cleanup fails closed on unusable metadata: ${variant}`, async () => {
    const f = fixture({ overrides: { async getSecretVersion(request, base) {
      const [reply] = await base.getSecretVersion(request);
      if (variant === "foreign-metadata") reply.name = `${canonicalParent}/versions/999`;
      if (variant === "unknown-state") reply.state = "STATE_UNSPECIFIED";
      if (variant === "missing-etag") delete reply.etag;
      if (variant === "malformed-etag") reply.etag = "synthetic\ninvalid";
      return [reply];
    } } }), handle = await stage(f);
    assert.equal((await f.store.discard(handle)).outcome, "recovery_pending");
    assert.equal(f.count("disableSecretVersion"), 0);
    assert.equal(f.records.values().next().value.state, "ENABLED");
  });
}

test("already destroyed owned version is acknowledged without a mutation", async () => {
  const f = fixture(), handle = await stage(f);
  f.records.values().next().value.state = "DESTROYED";
  assert.equal((await f.store.discard(handle)).ack, true);
  assert.equal(f.count("disableSecretVersion"), 0);
});

test("normalized responses, numeric enums, project-ID alias and protobuf Long CRC are accepted", async () => {
  const f = fixture({ overrides: {
    async addSecretVersion(request, base) {
      const [reply] = await base.addSecretVersion(request);
      reply.name = `${secretParent}/versions/1`; reply.state = 1; return reply;
    },
    async accessSecretVersion(request, base) {
      const [reply] = await base.accessSecretVersion(request);
      reply.payload.dataCrc32c = { low: Number(reply.payload.dataCrc32c) | 0, high: 0, unsigned: false };
      return reply;
    },
  } }), handle = await stage(f);
  await readTwice(f, handle);
  assert.equal((await f.store.markStagedReady(handle)).versionName, `${canonicalParent}/versions/1`);
  await f.store.discard(handle);
});

test("foreign handles, repeated stages and bounded reads cannot add extra versions", async () => {
  const f = fixture(), handle = await stage(f), bytes = candidate();
  await assert.rejects(f.store.stage({}, bytes), denied);
  await assert.rejects(f.store.stage(handle, bytes), denied);
  assert.throws(() => f.store.metadata({}), denied);
  assert.throws(() => f.store.discard({}), denied);
  for (let index = 0; index < 4; index++) await f.store.withCredential(handle, () => undefined);
  await assert.rejects(f.store.withCredential(handle, () => assert.fail("read bound")), denied);
  assert.equal(f.count("addSecretVersion"), 1);
  assert.equal(f.count("accessSecretVersion"), 5);
  bytes.fill(0); await f.store.discard(handle);
});

test("full lifecycle stages encoded payload, verifies native password, and returns unpublished readiness", async () => {
  const prefix = Buffer.from("synthetic-dsn-prefix:");
  const f = fixture({ config: { payloadCodec: {
    encode: bytes => Buffer.concat([prefix, bytes]),
    decode(bytes) {
      if (bytes.length !== prefix.length + 128 || !bytes.subarray(0, prefix.length).equals(prefix)) throw new Error("synthetic codec rejection");
      return Buffer.from(bytes.subarray(prefix.length));
    },
  } } });
  const target = { projectReference: "synthetic-local", host: "127.0.0.1", port: 15432, database: "postgres",
    role: invocation.target.role, systemIdentifier: "123456789", databaseOid: "5", adminRole: "synthetic_admin",
    capabilityRole: "square_account_broker_authority", rootCertificate: "/synthetic/certificate.pem", roleOid: "0" };
  const closed = { ack: true, authorityClosed: true };
  const handles = [], events = [], nativeBuffers = [];
  const secretStore = { ...f.store, reserve(context) { const handle = f.store.reserve(context); handles.push(handle); return handle; } };
  const native = {
    async inspect() { return closed; },
    async prepare() { return { ...closed, committed: true, noLogin: true, roleOid: "42" }; },
    async fence() { return { ...closed, noLogin: true, sessionsTerminated: true }; },
    async assign({ deliver }) { const bytes = candidate(); nativeBuffers.push(bytes); await deliver(bytes); return { ...closed, committed: true, storeAcknowledged: true }; },
    async activate() { return { ...closed, noLogin: false }; },
    async authenticate(context) {
      await context.withCredential(bytes => { nativeBuffers.push(bytes); const expected = candidate(); same(bytes, expected); expected.fill(0); });
      return { ...closed, sessionUser: target.role, target: context.target };
    },
    async abortAndDrain() { return { ack: true, drained: true }; },
  };
  const coordinator = createSyntheticProvisioningCoordinator({ target, native, secretStore,
    audit: { async append(event) { events.push(event); return { ack: true }; } } });
  const result = await coordinator.run({ ...invocation, target: undefined });
  assert.equal(result.outcome, "staged_ready");
  assert.equal(result.databaseCommit, "acknowledged");
  assert.equal(result.credentialPublished, false);
  assert.equal(result.applicationAuthority, "verified_closed");
  assert.equal(f.store.metadata(handles[0]).state, "staged_ready");
  assert.equal(f.records.values().next().value.data.length, prefix.length + 128);
  assert.equal(f.count("addSecretVersion"), 1);
  assert.equal(f.count("accessSecretVersion"), 3);
  nativeBuffers.forEach(zero); f.requestPayloads.forEach(zero); f.responsePayloads.forEach(zero);
  assert.ok(events.every(event => Object.keys(event).join(",") === "actor,targetRole,operation,intent,phase,time,outcome"));
  assert.equal(JSON.stringify([events, result, f.store.metadata(handles[0])]).includes("synthetic-dsn-prefix"), false);
  await f.store.discard(handles[0]);
});
