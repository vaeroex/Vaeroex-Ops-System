import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productionProvisioningBuildProfile } from "../production-profile.mjs";
import { createPinnedSupabaseDsnCodec } from "../dsn-codec.mjs";
import { checkExistingCandidateClearance, checkExistingCandidateMetadata, existingOAuthCandidate as pin,
  reconcileExistingOAuthCandidate } from "../existing-candidate-reconciliation.mjs";

const target = Object.freeze({ ...productionProvisioningBuildProfile("oauth").target, roleOid: pin.roleOid });
const intent = "synthetic_candidate_proof", approvalId = "synthetic_proof_approval";
function proof() {
  const now = 1800000000000;
  return { profile: { kind: "production", name: "oauth", target }, roleOid: pin.roleOid, intent, approvalId,
    journalSha256: "a".repeat(64), now,
    prior: [{ kind: "maintenance_started", intent: pin.priorIntent },
      { kind: "maintenance_finished", intent: pin.priorIntent, roleOid: pin.roleOid, phase: "assign_and_commit",
        outcome: "uncertain", databaseCommit: "uncertain", requiresFreshReplacement: true, applicationAuthority: "verified_closed" }],
    clearance: { schema: "oauth_existing_candidate_reconciliation_v1", priorIntent: pin.priorIntent, nextIntent: intent,
      approvalId, projectReference: target.projectReference, targetRole: target.role, roleOid: pin.roleOid,
      versionName: pin.versionName, createTime: pin.createTime, journalSha256: "a".repeat(64), roleFenced: true,
      sessions: 0, candidateState: "ENABLED", expiresAt: now + 600000 } };
}
test("unresolved candidate clearance binds exact retired journal, OID, version, intent and ten-minute expiry", () => {
  const p = proof(), before = JSON.stringify(p.prior);
  assert.equal(checkExistingCandidateClearance(p), p.clearance.expiresAt);
  assert.equal(JSON.stringify(p.prior), before);
  for (const mutate of [
    p => p.profile.kind = "sandbox", p => p.profile.name = "broker", p => p.roleOid = "34221",
    p => p.profile.target = { ...target, projectReference: "oysjpoondtcrqpghhrbd" },
    p => p.profile.target = { ...target, host: "other.invalid" },
    p => p.intent = pin.priorIntent, p => p.prior.push({ kind: "existing_candidate_reconciliation_finished" }),
    p => p.prior.unshift({ kind: "maintenance_started", intent: pin.priorIntent }),
    p => p.prior[1].phase = "verify_closed_authority", p => p.prior[1].roleOid = "2",
    p => p.prior[1].databaseCommit = "acknowledged", p => p.journalSha256 = "b".repeat(64),
    p => p.clearance.priorIntent = "other", p => p.clearance.nextIntent = "other", p => p.clearance.approvalId = "other",
    p => p.clearance.versionName = pin.versionName.replace(/1$/, "2"), p => p.clearance.roleFenced = false,
    p => p.clearance.sessions = 1, p => p.clearance.candidateState = "DISABLED", p => p.clearance.createTime = "other",
    p => p.clearance.expiresAt = p.now, p => p.clearance.expiresAt = p.now + 600001,
  ]) { const p = proof(); mutate(p); assert.throws(() => checkExistingCandidateClearance(p), /existing_oauth_candidate_denied/); }
});

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function fixture(options = {}) {
  const controller = new AbortController(), calls = [], buffers = [], events = [];
  const ack = { ack: true, committed: true, authorityClosed: true, roleOid: pin.roleOid };
  let fences = 0;
  const native = {
    async inspect() { calls.push("inspect"); if (options.inspectFails) throw Error("private synthetic error"); return ack; },
    async fence(context) {
      calls.push("fence"); fences++;
      if (fences === 2) assert.equal(context.signal.aborted, false);
      if (options.fenceFails && fences === 2) throw Error("private synthetic error");
      return { ...ack, noLogin: true, sessionsTerminated: true };
    },
    async activate() {
      calls.push("activate");
      if (options.lostActivateAck) throw Error("private synthetic error");
      return { ...ack, noLogin: false };
    },
    async authenticate(context) {
      calls.push("authenticate");
      const consume = async bytes => {
        calls.push("consume"); assert.equal(bytes.length, 128); buffers.push(bytes);
        if (options.authenticationFails) throw Error("private synthetic error");
        if (options.cancelDuringAuthentication) controller.abort();
      };
      await context.withCredential(consume);
      if (options.duplicateRead) await context.withCredential(consume);
      return { ...ack, sessionUser: options.wrongIdentity ? "wrong" : target.role,
        target: options.wrongOid ? { ...target, roleOid: "999" } : target };
    },
    async abortAndDrain() { calls.push("drain"); return { ack: true, drained: true }; },
    async assign() { assert.fail("assignment forbidden"); }, async prepare() { assert.fail("role creation forbidden"); },
  };
  const client = {
    async getSecretVersion(request) {
      calls.push("metadata"); assert.equal(request.name, pin.versionName);
      return { name: pin.versionName, state: options.disabled ? "DISABLED" : "ENABLED", createTime: pin.createTime };
    },
    async accessSecretVersion(request) {
      calls.push("access"); assert.equal(request.name, pin.versionName);
      const raw = Buffer.alloc(128, 97), data = createPinnedSupabaseDsnCodec(target).encode(raw); raw.fill(0); buffers.push(data);
      if (options.lateRead) {
        controller.abort();
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return { name: options.wrongVersion ? pin.versionName.replace(/1$/, "2") : pin.versionName,
        payload: { data, dataCrc32c: String(checksum(data) + (options.badChecksum ? 1 : 0)) } };
    },
    async addSecretVersion() { assert.fail("version creation forbidden"); },
    async disableSecretVersion() { assert.fail("version changes forbidden"); },
  };
  const run = () => reconcileExistingOAuthCandidate({ native, client, target, intent, approvalId,
    signal: controller.signal, async record(stage) {
      events.push(stage); if (options.recordFails === stage) throw Error("private synthetic error");
    } });
  return { run, calls, events, buffers, controller, native, client };
}

test("existing candidate authenticates once and always finishes fenced without assignment or version creation", async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.outcome, "existing_candidate_verified_closed");
  assert.equal(result.originalDatabaseCommit, "uncertain"); assert.equal(result.credentialPublished, false);
  assert.equal(result.fenceConfirmed, true); assert.equal(result.candidateAuthenticated, true);
  assert.deepEqual(f.calls, ["inspect", "fence", "metadata", "activate", "authenticate", "access", "consume", "drain", "fence"]);
  assert.deepEqual(f.events, ["started", "authentication_started", "candidate_authenticated", "fenced"]);
  assert.equal(f.buffers.every(b => b.every(x => x === 0)), true);
});
for (const key of ["lostActivateAck", "authenticationFails", "cancelDuringAuthentication", "duplicateRead", "badChecksum", "wrongVersion", "wrongIdentity", "wrongOid", "disabled"]) {
  test(`${key}: stop, fence, preserve candidate, no retry`, async () => {
    const f = fixture({ [key]: true }), result = await f.run();
    assert.equal(result.outcome, "existing_candidate_reconciliation_uncertain"); assert.equal(result.fenceConfirmed, true);
    assert.equal(f.calls.filter(x => x === "activate").length <= 1, true);
    assert.equal(f.calls.filter(x => x === "access").length <= 1, true);
    assert.deepEqual(f.calls.slice(-2), ["drain", "fence"]);
    assert.equal(f.buffers.every(b => b.every(x => x === 0)), true);
  });
}
test("receipt failure never skips final fencing or claims verified success", async () => {
  for (const stage of ["started", "authentication_started", "candidate_authenticated", "fenced"]) {
    const f = fixture({ recordFails: stage }), result = await f.run();
    assert.equal(result.outcome, "existing_candidate_reconciliation_uncertain");
    if (stage === "started") assert.deepEqual(f.calls, []);
    else { assert.equal(result.fenceConfirmed, true); assert.deepEqual(f.calls.slice(-2), ["drain", "fence"]); }
  }
});
test("uncertain final fence is never successful and is not retried", async () => {
  const f = fixture({ fenceFails: true }), result = await f.run();
  assert.equal(result.candidateAuthenticated, true); assert.equal(result.fenceConfirmed, false);
  assert.equal(result.outcome, "existing_candidate_reconciliation_uncertain");
  assert.equal(f.calls.filter(x => x === "fence").length, 2);
});
test("missing, negative or rejected drain acknowledgement still attempts an independent fence", async () => {
  for (const result of [undefined, { ack: false, drained: false }, "reject"]) {
    const f = fixture({ lostActivateAck: true });
    f.native.abortAndDrain = async () => {
      f.calls.push("drain");
      if (result === "reject") throw Error("synthetic reaped-worker acknowledgement loss");
      return result;
    };
    const proof = await f.run();
    assert.deepEqual(f.calls.slice(-2), ["drain", "fence"]);
    assert.equal(proof.fenceConfirmed, true);
    assert.equal(proof.outcome, "existing_candidate_reconciliation_uncertain");
    assert.equal(f.calls.filter(x => x === "activate").length, 1);
  }
});
test("drain timeout cannot consume the independent fencing deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ lostActivateAck: true });
  let drainStarted;
  const started = new Promise(resolve => { drainStarted = resolve; });
  f.native.abortAndDrain = () => { f.calls.push("drain"); drainStarted(); return new Promise(() => {}); };
  const pending = f.run();
  await started;
  t.mock.timers.tick(10000);
  const result = await pending;
  assert.deepEqual(f.calls.slice(-2), ["drain", "fence"]);
  assert.equal(result.fenceConfirmed, true);
  assert.equal(result.outcome, "existing_candidate_reconciliation_uncertain");
});
test("deadline cancellation during final fencing cannot interrupt its independent signal", async () => {
  const f = fixture();
  const fence = f.native.fence;
  let calls = 0;
  f.native.fence = async context => {
    if (++calls === 2) {
      // Same cancel-only handler installed for both reconciliation deadlines.
      setTimeout(() => f.controller.abort(), 0);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(f.controller.signal.aborted, true);
      assert.equal(context.signal.aborted, false);
    }
    return fence(context);
  };
  const result = await f.run();
  assert.equal(result.fenceConfirmed, true);
  assert.deepEqual(f.calls.slice(-2), ["drain", "fence"]);
  const code = readFileSync(new URL("../maintenance.mjs", import.meta.url), "utf8");
  assert.match(code, /hardTimer = setTimeout\(operation === "reconcile" \? cancel : \(\) => \{/);
});
test("late secret response is wiped and cannot authenticate after cancellation/fence", async () => {
  const f = fixture({ lateRead: true }), result = await f.run();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(result.outcome, "existing_candidate_reconciliation_uncertain"); assert.equal(result.fenceConfirmed, true);
  assert.equal(f.calls.includes("consume"), false); assert.equal(f.buffers.every(b => b.every(x => x === 0)), true);
});
test("exact metadata pin rejects changed creation time, state, version and project", () => {
  const metadata = { name: pin.versionName, state: "ENABLED", createTime: pin.createTime };
  checkExistingCandidateMetadata(metadata);
  for (const change of [{ createTime: "other" }, { state: "DISABLED" }, { name: pin.versionName.replace(/1$/, "2") },
    { name: pin.versionName.replace("711446392261", "111111111111") }]) {
    assert.throws(() => checkExistingCandidateMetadata({ ...metadata, ...change }), /existing_oauth_candidate_denied/);
  }
});
test("managed wiring returns before provisioning store creation and only appends distinct proof receipts", () => {
  const code = readFileSync(new URL("../maintenance.mjs", import.meta.url), "utf8");
  const start = code.indexOf("const result = await reconciliation.reconcileExistingOAuthCandidate");
  const end = code.indexOf("const underlyingStore", start);
  const branch = code.slice(start, end);
  assert.ok(start > 0 && end > start); assert.match(branch, /existing_candidate_reconciliation_finished/);
  assert.match(branch, /return;/); assert.doesNotMatch(branch, /coordinator\.run|\.assign\(|addSecretVersion/);
});
