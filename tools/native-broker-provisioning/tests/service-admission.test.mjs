import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { serviceAdmissionReceipt, superviseServiceAdmission, admissionOutput } from "../service-admission.mjs";
import { existingOAuthCandidate as pin, reconcileExistingOAuthCandidate } from "../existing-candidate-reconciliation.mjs";
import { productionProvisioningBuildProfile } from "../production-profile.mjs";
import { createPinnedSupabaseDsnCodec } from "../dsn-codec.mjs";

const parent = "projects/711446392261/secrets/square-production-oauth-db";
function proof() {
  return { profile: { kind: "production", name: "oauth", target: { role: "square_production_oauth" } },
    roleOid: "123", secretParent: parent, last: { kind: "maintenance_finished", outcome: "staged_ready", intent: "created_once",
      roleOid: "123", databaseCommit: "acknowledged", fenceConfirmed: true, requiresFreshReplacement: false,
      applicationAuthority: "verified_closed", secret: { targetRole: "square_production_oauth", intent: "created_once",
        state: "staged_ready", ownedVersionKnown: true, recoveryPending: false, credentialPublished: false,
        versionName: `${parent}/versions/1` } } };
}
test("admission requires the exact conclusive fenced provision/version-1 receipt", () => {
  assert.equal(serviceAdmissionReceipt(proof()), `${parent}/versions/1`);
  for (const change of [x => x.profile.kind = "sandbox", x => x.profile.name = "scheduler", x => x.profile.name = "webhook",
    x => x.roleOid = "124", x => x.last.databaseCommit = "uncertain", x => x.last.fenceConfirmed = false,
    x => x.last.requiresFreshReplacement = true, x => x.last.applicationAuthority = "unverified",
    x => x.last.kind = "maintenance_started", x => x.last.secret.intent = "other", x => x.last.secret.recoveryPending = true,
    x => x.last.secret.versionName = `${parent}/versions/2`, x => x.last.secret.targetRole = "square_production_broker",
    x => x.last.secret.credentialPublished = true]) {
    const x = proof(); change(x); assert.throws(() => serviceAdmissionReceipt(x), /admission_denied/);
  }
});

function existingProof(result) {
  const profile = productionProvisioningBuildProfile("oauth");
  const last = { kind: "existing_candidate_reconciliation_finished", intent: "synthetic_new_oauth_proof",
    approvalId: "synthetic_new_oauth_proof_approval", time: 1800000000000,
    ...(result ?? { outcome: "existing_candidate_verified_closed", failureStage: null, failureCategory: null,
      priorIntent: pin.priorIntent, roleOid: pin.roleOid, versionName: pin.versionName,
      candidateAuthenticated: true, fenceConfirmed: true, originalDatabaseCommit: "uncertain", credentialPublished: false }) };
  return { profile: { ...profile, target: { ...profile.target } }, last, roleOid: pin.roleOid, secretParent: parent,
    intent: "synthetic_new_oauth_admission", approvalId: "synthetic_new_oauth_admission_approval",
    prior: [{ kind: "maintenance_finished", intent: pin.priorIntent, approvalId: "synthetic_original_approval" },
      { kind: "existing_candidate_reconciliation_finished", intent: pin.retainedProofIntent,
        approvalId: pin.retainedProofApprovalId, outcome: "existing_candidate_reconciliation_uncertain" }, last] };
}

test("only the exact conclusive OAuth proof admits its existing version without rewriting historical uncertainty", () => {
  const proof = existingProof(), before = JSON.stringify(proof.prior);
  assert.equal(serviceAdmissionReceipt(proof), pin.versionName);
  assert.equal(JSON.stringify(proof.prior), before);
  assert.equal(proof.last.originalDatabaseCommit, "uncertain");
  assert.equal(proof.last.credentialPublished, false);
  assert.equal(Object.hasOwn(proof.last, "databaseCommit"), false);
  assert.equal(Object.hasOwn(proof.last, "secret"), false);
  for (const change of [
    x => x.profile.kind = "sandbox", x => x.profile.name = "broker", x => x.roleOid = "34221",
    x => x.secretParent = parent.replace("oauth", "broker"), x => x.last.roleOid = "34221",
    x => x.last.versionName = pin.versionName.replace(/1$/, "2"), x => x.last.priorIntent = "other",
    x => x.last.kind = "maintenance_finished", x => x.last.outcome = "existing_candidate_reconciliation_uncertain",
    x => x.last.candidateAuthenticated = false, x => x.last.fenceConfirmed = false,
    x => x.last.originalDatabaseCommit = "acknowledged", x => x.last.databaseCommit = "acknowledged",
    x => x.last.credentialPublished = true, x => x.last.secret = {},
    x => x.last.failureStage = "authentication", x => x.last.failureCategory = "database_connection",
    x => { delete x.last.failureStage; }, x => { delete x.last.failureCategory; },
    x => x.last.time = "1800000000000", x => x.last.intent = pin.priorIntent,
    x => x.last.intent = pin.retainedProofIntent, x => x.last.approvalId = pin.retainedProofApprovalId,
    x => x.last.intent = "bad intent", x => x.last.approvalId = "bad approval",
    x => x.intent = x.last.intent, x => x.intent = pin.priorIntent, x => x.intent = pin.retainedProofIntent,
    x => x.approvalId = x.last.approvalId, x => x.approvalId = pin.retainedProofApprovalId,
    x => x.approvalId = "synthetic_original_approval", x => x.intent = "bad intent", x => x.approvalId = "bad approval",
    x => { delete x.prior; }, x => x.prior.push({ kind: "service_admission" }),
    x => x.prior.unshift({ ...x.last, intent: "older_successful_proof" }),
  ]) {
    const value = existingProof(); change(value);
    assert.throws(() => serviceAdmissionReceipt(value), /native_service_admission_denied/);
  }
  for (const field of Object.keys(productionProvisioningBuildProfile("oauth").target).filter(key => key !== "roleOid")) {
    const value = existingProof(); value.profile.target[field] = "different";
    assert.throws(() => serviceAdmissionReceipt(value), /native_service_admission_denied/);
  }
  const extraTarget = existingProof(); extraTarget.profile.target.extra = true;
  assert.throws(() => serviceAdmissionReceipt(extraTarget), /native_service_admission_denied/);
});

test("actual proof result feeds supervised admission using only the retained candidate and existing native operations", async () => {
  const input = existingProof(), target = { ...input.profile.target, roleOid: pin.roleOid };
  const calls = [], buffers = [];
  const ack = { ack: true, committed: true, authorityClosed: true, roleOid: pin.roleOid };
  const native = {
    async inspect() { calls.push("inspect"); return ack; },
    async fence() { calls.push("fence"); return { ...ack, noLogin: true, sessionsTerminated: true }; },
    async activate() { calls.push("activate"); return { ...ack, noLogin: false }; },
    async authenticate(context) {
      calls.push("authenticate");
      await context.withCredential(async bytes => { assert.equal(bytes.length, 128); buffers.push(bytes); });
      return { ...ack, sessionUser: target.role, target };
    },
    async abortAndDrain() { calls.push("drain"); return { ack: true, drained: true }; },
    async prepare() { assert.fail("role creation forbidden"); }, async assign() { assert.fail("credential assignment forbidden"); },
  };
  const client = {
    async getSecretVersion({ name }) {
      calls.push("metadata"); assert.equal(name, pin.versionName);
      return { name, state: "ENABLED", createTime: pin.createTime };
    },
    async accessSecretVersion({ name }) {
      calls.push("access"); assert.equal(name, pin.versionName);
      const raw = Buffer.alloc(128, 97), data = createPinnedSupabaseDsnCodec(target).encode(raw); raw.fill(0); buffers.push(data);
      let crc = 0xffffffff;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
      }
      return { name, payload: { data, dataCrc32c: String((crc ^ 0xffffffff) >>> 0) } };
    },
    async addSecretVersion() { assert.fail("version creation forbidden"); },
    async disableSecretVersion() { assert.fail("version changes forbidden"); },
  };
  const result = await reconcileExistingOAuthCandidate({ native, client, target, intent: input.last.intent,
    approvalId: input.last.approvalId, signal: new AbortController().signal, async record() {} });
  assert.equal(result.outcome, "existing_candidate_verified_closed");
  const admission = existingProof(result);
  assert.equal(serviceAdmissionReceipt(admission), pin.versionName);
  assert.deepEqual(calls, ["inspect", "fence", "metadata", "activate", "authenticate", "access", "drain", "fence"]);
  assert.ok(buffers.every(bytes => bytes.every(byte => byte === 0)));
  const cancellation = new AbortController();
  const admitted = await superviseServiceAdmission({ native, target, intent: admission.intent, approvalId: admission.approvalId,
    signal: cancellation.signal, async record() {}, async notify() { setImmediate(() => cancellation.abort()); } });
  assert.equal(admitted.outcome, "service_closed");
  assert.equal(admitted.fenceConfirmed, true);
  assert.deepEqual(calls.slice(8), ["inspect", "activate", "drain", "fence"]);
  assert.equal(admission.last.originalDatabaseCommit, "uncertain");
  assert.equal(admission.last.credentialPublished, false);
});

function fixture(options = {}) {
  const controller = new AbortController(), calls = [];
  const ack = { ack: true, committed: true, roleOid: "123" };
  const native = {
    async inspect() { calls.push("inspect"); return ack; },
    async activate() { calls.push("activate"); if (options.lostAck) throw Error("synthetic"); return { ...ack, noLogin: false }; },
    async abortAndDrain() { calls.push("drain"); },
    async fence(context) { calls.push("fence"); assert.equal(context.signal.aborted, false); assert.notEqual(context.signal, controller.signal);
      if (options.fenceFails) throw Error("synthetic"); return { ...ack, noLogin: true, sessionsTerminated: true }; }
  };
  return { calls, controller, run: () => superviseServiceAdmission({ native, target: { roleOid: "123" },
    intent: "admit_once", approvalId: "approved_once", signal: controller.signal,
    async record(stage) { calls.push(stage); if (options.receiptFailure === stage) throw Error("synthetic"); },
    async notify() { calls.push("notify");
      if (options.outputStalls) {
        const output = new Writable({ write() { setImmediate(() => controller.abort()); /* SSH remains open without draining. */ } });
        return admissionOutput(output, () => controller.abort())();
      }
      if (options.outputFails) {
        const output = new Writable({ write(_bytes, _encoding, callback) { callback(Object.assign(Error("synthetic"), { code: "EPIPE" })); } });
        return admissionOutput(output, () => controller.abort())();
      }
      if (options.notifyFails) throw Error("synthetic"); setImmediate(() => controller.abort()); } }) };
}
test("graceful cancellation fences after native admission and reports closure only after ACK", async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.outcome, "service_closed"); assert.equal(result.fenceConfirmed, true);
  assert.deepEqual(f.calls, ["inspect", "admission_started", "activate", "admission_opened", "notify", "drain", "fence", "admission_closed"]);
});
test("lost activation ACK and receipt/notification failure cannot suppress independent fencing", async () => {
  for (const options of [{ lostAck: true }, { notifyFails: true }, { outputFails: true }, { receiptFailure: "admission_opened" }, { receiptFailure: "admission_closed" }]) {
    const f = fixture(options), result = await f.run();
    assert.equal(result.outcome, "requires_checked_recovery"); assert.equal(result.fenceConfirmed, true);
    assert.equal(f.calls.filter(x => x === "activate").length, 1); assert.equal(f.calls.filter(x => x === "fence").length, 1);
  }
});
test("failed start receipt cannot activate; uncertain fence cannot claim closed or retry", async () => {
  const before = fixture({ receiptFailure: "admission_started" }); await before.run();
  assert.equal(before.calls.includes("activate"), false);
  const after = fixture({ fenceFails: true }), result = await after.run();
  assert.equal(result.outcome, "requires_checked_recovery"); assert.equal(result.fenceConfirmed, false);
  assert.equal(after.calls.filter(x => x === "fence").length, 1);
});

test("an open stalled output stream cannot block cancellation from reaching the fence", { timeout: 1000 }, async () => {
  const f = fixture({ outputStalls: true }); const result = await f.run();
  assert.equal(result.outcome, "requires_checked_recovery"); assert.equal(result.fenceConfirmed, true);
  assert.equal(f.calls.filter(x => x === "activate").length, 1);
  assert.deepEqual(f.calls.slice(-3), ["drain", "fence", "admission_closed"]);
});

test("a real SSH-style SIGHUP cancels supervised admission and awaits fencing", () => {
  const source = `import { admissionHangup, superviseServiceAdmission } from ${JSON.stringify(new URL("../service-admission.mjs", import.meta.url).href)};
    const cancellation = new AbortController(); const release = admissionHangup(() => cancellation.abort());
    const deadline = setTimeout(() => cancellation.abort(), 1000);
    let fenced = false;
    const ack = { ack:true, committed:true, roleOid:"123" };
    const result = await superviseServiceAdmission({ target:{roleOid:"123"}, intent:"synthetic", approvalId:"synthetic",
      signal:cancellation.signal, record:async()=>{}, notify:async()=>{process.kill(process.pid,"SIGHUP");},
      native:{inspect:async()=>ack, activate:async()=>({...ack,noLogin:false}),abortAndDrain:async()=>{},
        fence:async()=>{await new Promise(resolve=>setTimeout(resolve,10));fenced=true;return {...ack,noLogin:true,sessionsTerminated:true};}}});
    clearTimeout(deadline); release(); process.exitCode = fenced && result.outcome === "service_closed" ? 0 : 2;`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, "");
});
