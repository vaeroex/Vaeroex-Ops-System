import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import { serviceAdmissionReceipt, superviseServiceAdmission, admissionOutput } from "../service-admission.mjs";

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
