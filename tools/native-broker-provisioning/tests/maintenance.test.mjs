import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { createGceMaintenanceIdentity } from "../maintenance-identity.mjs";
import { readPrivateAdministrator, releasePrivateAdministratorInput } from "../private-entry.mjs";
import { sandboxMaintenance as pin, sandboxTarget } from "../sandbox-profile.mjs";
import { maintenanceWindow, requireMutationWindow, requiresClearance, checkRecoveryClearance } from "../maintenance-policy.mjs";

// Only public, deterministic fixtures and in-memory streams. No metadata HTTP,
// actual terminal, environment credential, filesystem or remote account access.
const tokenText = "PUBLIC_SYNTHETIC_NEVER_ISSUED_ACCESS_TOKEN";
const rawError = () => new Error("UNTRUSTED_SYNTHETIC_DETAIL_MUST_NOT_ESCAPE");
const identityDenied = error => error instanceof Error && error.message === "maintenance_identity_denied" && !error.cause;
const entryDenied = error => error instanceof Error && error.message === "native_private_entry_denied" && !error.cause;
const policyDenied = error => error instanceof Error && error.message === "maintenance_policy_denied" && !error.cause;
const zero = bytes => assert.ok(bytes.every(value => value === 0), "borrowed synthetic bytes were wiped");
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const checks = new Map([
  ["project/project-id", pin.projectId], ["project/numeric-project-id", pin.projectNumber],
  ["instance/id", pin.instanceId], ["instance/zone", `projects/${pin.projectNumber}/zones/${pin.zone}`],
  ["instance/service-accounts/default/email", pin.serviceAccount],
]);
const tokenPath = `instance/service-accounts/${pin.serviceAccount}/token`;

function identityFixture({ alter = () => ({}), requestFailure = false } = {}) {
  const calls = [], chunks = [];
  const request = (options, callback) => {
    if (requestFailure) throw rawError();
    const req = new EventEmitter(); req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = () => {
      const path = options.path.slice("/computeMetadata/v1/".length);
      const call = { options, path, req }; calls.push(call);
      queueMicrotask(() => {
        const selected = alter(path, calls.length) ?? {};
        if (selected.mode === "stall") return;
        if (selected.mode === "request-error") { req.emit("error", rawError()); return; }
        const res = new EventEmitter(); res.destroyed = false;
        res.destroy = () => { res.destroyed = true; };
        res.statusCode = selected.status ?? 200;
        res.headers = selected.headers ?? { "metadata-flavor": "Google" };
        call.res = res; callback(res);
        if (res.destroyed) return;
        if (selected.mode === "response-error") { res.emit("error", rawError()); return; }
        if (selected.mode === "aborted") { res.emit("aborted"); return; }
        const body = Object.hasOwn(selected, "body") ? selected.body : checks.get(path) ??
          JSON.stringify({ token_type: "Bearer", access_token: tokenText, expires_in: 3600 });
        const parts = selected.parts ?? [Buffer.from(body)];
        for (const part of parts) {
          const bytes = Buffer.from(part); chunks.push(bytes); res.emit("data", bytes);
        }
        res.emit("end");
      });
    };
    return req;
  };
  return { identity: createGceMaintenanceIdentity({ request }), calls, chunks };
}

test("identity construction is inert; verification is fixed native host metadata only", async () => {
  const f = identityFixture(); assert.equal(f.calls.length, 0);
  await assert.rejects(f.identity.withAccessToken(() => assert.fail("unverified identity")), identityDenied);
  assert.deepEqual(await f.identity.verify(), { ack: true });
  assert.deepEqual(f.calls.map(call => call.path), [...checks.keys()]);
  for (const { options } of f.calls) {
    assert.equal(options.hostname, "169.254.169.254"); assert.equal(options.port, 80);
    assert.equal(options.method, "GET"); assert.equal(options.agent, false);
    assert.deepEqual(options.headers, { "Metadata-Flavor": "Google" });
    assert.equal(options.path.startsWith("/computeMetadata/v1/"), true);
  }
  f.chunks.forEach(zero);
  assert.throws(() => createGceMaintenanceIdentity({ request: null }), identityDenied);
});

for (const path of checks.keys()) {
  test(`exact identity drift fails before token: ${path}`, async () => {
    const f = identityFixture({ alter: observed => observed === path ? { body: "synthetic-foreign-value" } : {} });
    await assert.rejects(f.identity.verify(), identityDenied);
    await assert.rejects(f.identity.withAccessToken(() => assert.fail("drifted identity")), identityDenied);
    assert.equal(f.calls.some(call => call.path.endsWith("/token")), false);
    f.chunks.forEach(zero);
  });
}

test("token acquisition rechecks all pins, uses exact service-account path and wipes borrowed data", async () => {
  const f = identityFixture(); await f.identity.verify(); let borrowed;
  assert.deepEqual(await f.identity.withAccessToken(bytes => {
    borrowed = bytes;
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(bytes.equals(Buffer.from(tokenText)), "synthetic token matches");
  }), { ack: true });
  assert.deepEqual(f.calls.map(call => call.path), [...checks.keys(), ...checks.keys(), tokenPath]);
  zero(borrowed); f.chunks.forEach(zero);
});

test("changed attached service account prevents token request even after prior verification", async () => {
  let drift = false;
  const f = identityFixture({ alter: path => drift && path.endsWith("/email") ? { body: "foreign-synthetic-identity" } : {} });
  await f.identity.verify(); drift = true;
  await assert.rejects(f.identity.withAccessToken(() => assert.fail("no foreign identity callback")), identityDenied);
  assert.equal(f.calls.some(call => call.path.endsWith("/token")), false);
  await assert.rejects(f.identity.withAccessToken(() => undefined), identityDenied);
  f.chunks.forEach(zero);
});

test("token callbacks cannot overlap and callback failure is sanitized with final wipe", async () => {
  const f = identityFixture(); await f.identity.verify();
  const gate = deferred(), started = deferred(); let borrowed;
  const running = f.identity.withAccessToken(bytes => { borrowed = bytes; started.resolve(); return gate.promise; });
  await started.promise;
  await assert.rejects(f.identity.withAccessToken(() => assert.fail("overlapping token callback")), identityDenied);
  gate.resolve(); assert.equal((await running).ack, true); zero(borrowed);
  await assert.rejects(f.identity.withAccessToken(bytes => { borrowed = bytes; throw rawError(); }), identityDenied);
  zero(borrowed); f.chunks.forEach(zero);
});

for (const [label, body] of [
  ["invalid JSON", "not-json"], ["null", "null"], ["wrong type", JSON.stringify({ token_type: "bearer", access_token: tokenText, expires_in: 3600 })],
  ["short", JSON.stringify({ token_type: "Bearer", access_token: "short", expires_in: 3600 })],
  ["oversized", JSON.stringify({ token_type: "Bearer", access_token: "a".repeat(8193), expires_in: 3600 })],
  ["whitespace", JSON.stringify({ token_type: "Bearer", access_token: "public synthetic token", expires_in: 3600 })],
  ["control", JSON.stringify({ token_type: "Bearer", access_token: tokenText + "\n", expires_in: 3600 })],
  ["missing expiry", JSON.stringify({ token_type: "Bearer", access_token: tokenText })],
  ["short expiry", JSON.stringify({ token_type: "Bearer", access_token: tokenText, expires_in: 59 })],
  ["string expiry", JSON.stringify({ token_type: "Bearer", access_token: tokenText, expires_in: "3600" })],
]) test(`malformed token never reaches consumer: ${label}`, async () => {
  const f = identityFixture({ alter: path => path.endsWith("/token") ? { body } : {} });
  await f.identity.verify();
  await assert.rejects(f.identity.withAccessToken(() => assert.fail("malformed token")), identityDenied);
  f.chunks.forEach(zero);
});

for (const status of [301, 302, 307, 308, 400, 401, 403, 404, 429, 500]) {
  test(`metadata status ${status} is not retried or redirected`, async () => {
    const f = identityFixture({ alter: () => ({ status }) });
    await assert.rejects(f.identity.verify(), identityDenied);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true); assert.equal(f.calls[0].res.destroyed, true);
  });
}

for (const [label, selected] of [
  ["missing metadata flavor", { headers: {} }], ["wrong flavor", { headers: { "metadata-flavor": "not-Google" } }],
  ["oversize bytes", { parts: [Buffer.alloc(4097, 97)] }],
  ["too many fragments", { parts: Array.from({ length: 65 }, () => Buffer.from("a")) }],
  ["request error", { mode: "request-error" }], ["response error", { mode: "response-error" }], ["aborted", { mode: "aborted" }],
]) test(`metadata failure is bounded/sanitized: ${label}`, async () => {
  const f = identityFixture({ alter: () => selected });
  await assert.rejects(f.identity.verify(), identityDenied);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true); f.chunks.forEach(zero);
});

test("synchronous request exception is sanitized", async () => {
  const f = identityFixture({ requestFailure: true });
  await assert.rejects(f.identity.verify(), identityDenied); assert.equal(f.calls.length, 0);
});

test("metadata timeout destroys owned request once without retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = identityFixture({ alter: () => ({ mode: "stall" }) });
  const rejected = assert.rejects(f.identity.verify(), identityDenied);
  t.mock.timers.tick(3001); await rejected;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true);
});

test("stalled consumer times out and wipes its token; late completion cannot acknowledge", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = identityFixture(); await f.identity.verify();
  const started = deferred(), gate = deferred(); let borrowed;
  const rejected = assert.rejects(f.identity.withAccessToken(bytes => {
    borrowed = bytes; started.resolve(); return gate.promise;
  }), identityDenied);
  await started.promise; t.mock.timers.tick(10001); await rejected;
  zero(borrowed); f.chunks.forEach(zero); gate.resolve();
});

const fixtureInputs = new Set();
afterEach(() => {
  for (const input of fixtureInputs) {
    input.emit("end");
    releasePrivateAdministratorInput(input);
  }
  fixtureInputs.clear();
});

function heldUntilRelease(f) {
  assert.equal(f.input.paused, false);
  assert.equal(f.input.listenerCount("data"), 1);
  assert.equal(f.raw.at(-1), true);
  const writeCount = f.writes.length;
  const late = Buffer.alloc(10, 98); f.send(late); zero(late);
  assert.equal(f.writes.length, writeCount, "later input is not echoed to output");
  releasePrivateAdministratorInput(f.input);
  assert.equal(f.input.paused, true);
  assert.equal(f.input.listenerCount("data"), 0);
  assert.equal(f.raw.at(-1), false);
}

function entryFixture({ timeoutMs = 100, signal, configure = () => undefined } = {}) {
  const input = new EventEmitter(), raw = [], writes = [], chunks = [];
  input.isTTY = true; input.paused = false;
  input.setRawMode = value => { raw.push(value); };
  input.pause = () => { input.paused = true; };
  input.resume = () => { input.paused = false; };
  const output = { isTTY: true, write: value => { writes.push(value); } };
  configure({ input, output });
  fixtureInputs.add(input);
  const result = readPrivateAdministrator({ input, output, timeoutMs, signal });
  result.catch(() => undefined); // Test cleanup also handles assertions that fail before awaiting entry.
  const send = bytes => { chunks.push(bytes); input.emit("data", bytes); };
  return { input, output, raw, writes, chunks, result, send };
}

test("private entry accepts one nonempty bounded ASCII line with no value in output", async () => {
  const f = entryFixture();
  assert.equal(f.raw[0], true);
  f.send(Buffer.alloc(32, 73)); f.send(Buffer.from([13, 10]));
  const bytes = await f.result;
  assert.equal(bytes.length, 32); assert.ok(bytes.every(value => value === 73));
  assert.ok(f.writes.every(value => !value.includes("IIII")), "fixed prompt only");
  f.chunks.forEach(zero); bytes.fill(0);
  heldUntilRelease(f);
});

test("private single-line paste is accepted; raw no-echo input stays owned until explicit release", async () => {
  const f = entryFixture();
  f.send(Buffer.concat([Buffer.alloc(32, 97), Buffer.from([10])]));
  const bytes = await f.result; assert.equal(bytes.length, 32); bytes.fill(0);
  await assert.rejects(readPrivateAdministrator({ input: f.input, output: f.output, timeoutMs: 1 }), entryDenied);
  heldUntilRelease(f);
});

test("private entry supports byte-wise editing without leaking erased data", async () => {
  const f = entryFixture();
  f.send(Buffer.from([127, 97, 98, 8, 99, 127, 100, 10]));
  const bytes = await f.result;
  assert.ok(bytes.equals(Buffer.from([97, 100])), "edited synthetic bytes");
  bytes.fill(0); f.chunks.forEach(zero);
});

test("private entry accepts exactly 510 printable bytes and never truncates overflow", async () => {
  const f = entryFixture(); f.send(Buffer.alloc(510, 97)); f.send(Buffer.from([10]));
  const bytes = await f.result; assert.equal(bytes.length, 510); bytes.fill(0); f.chunks.forEach(zero);
  const overflow = entryFixture(); const rejected = assert.rejects(overflow.result, entryDenied);
  overflow.send(Buffer.alloc(511, 97)); await rejected; overflow.chunks.forEach(zero);
});

for (const [label, bytes] of [
  ["empty", [10]], ["Ctrl-C", [97, 3]], ["EOF byte", [97, 4]], ["NUL", [97, 0]],
  ["tab", [97, 9]], ["escape/paste-start", [27, 91, 50, 48, 48, 126, 97, 10]],
  ["non-ASCII", [97, 128]], ["trailing bytes", [97, 10, 98]], ["second newline", [97, 10, 10]],
  ["wrong CR trailer", [97, 13, 98]],
]) test(`private entry rejects and wipes invalid input: ${label}`, async () => {
  const f = entryFixture(); const rejected = assert.rejects(f.result, entryDenied);
  f.send(Buffer.from(bytes)); await rejected; f.chunks.forEach(zero);
  heldUntilRelease(f);
  assert.ok(f.writes.every(value => typeof value === "string" && !value.includes("UNTRUSTED")));
});

for (const event of ["end", "error"]) test(`private entry closes on stream ${event}`, async () => {
  const f = entryFixture(); const rejected = assert.rejects(f.result, entryDenied);
  f.send(Buffer.alloc(10, 97)); f.input.emit(event, rawError());
  await rejected; f.chunks.forEach(zero); heldUntilRelease(f);
});

test("non-Buffer stream data cannot be coerced into an administrator credential", async () => {
  const f = entryFixture(); const rejected = assert.rejects(f.result, entryDenied);
  f.input.emit("data", "public synthetic string"); await rejected;
});

test("private entry timeout is bounded and replaces entry listeners with held no-echo sink", async () => {
  const f = entryFixture({ timeoutMs: 5 }); const rejected = assert.rejects(f.result, entryDenied);
  f.send(Buffer.alloc(10, 97)); await rejected; f.chunks.forEach(zero);
  assert.equal(f.input.listenerCount("end"), 0); assert.equal(f.input.listenerCount("error"), 0);
  heldUntilRelease(f);
});

test("supervisor abort immediately closes active entry, wipes input and holds no-echo sink until release", async () => {
  const controller = new AbortController();
  const f = entryFixture({ signal: controller.signal, timeoutMs: 300000 });
  const rejected = assert.rejects(f.result, entryDenied);
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  f.send(Buffer.alloc(32, 97)); controller.abort();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(f.input.listenerCount("end"), 0);
  await rejected; f.chunks.forEach(zero); heldUntilRelease(f);
});

test("pre-aborted entry cannot prompt or return credential bytes", async () => {
  const controller = new AbortController(); controller.abort();
  const f = entryFixture({ signal: controller.signal });
  await assert.rejects(f.result, entryDenied);
  assert.equal(f.writes.some(value => value.includes("native_private_administrator_entry")), false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  heldUntilRelease(f);
});

test("successful entry removes abort listener without releasing its sink or caller-owned password", async () => {
  const controller = new AbortController(), f = entryFixture({ signal: controller.signal });
  f.send(Buffer.from([97, 98, 10])); const bytes = await f.result;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  assert.ok(bytes.equals(Buffer.from([97, 98])), "supervisor owns returned buffer lifecycle");
  bytes.fill(0); heldUntilRelease(f);
});

for (const [label, options] of [
  ["stdin is not TTY", { configure: ({ input }) => { input.isTTY = false; } }],
  ["stdout is not TTY", { configure: ({ output }) => { output.isTTY = false; } }],
  ["no raw mode", { configure: ({ input }) => { input.setRawMode = undefined; } }],
  ["zero timeout", { timeoutMs: 0 }], ["oversized timeout", { timeoutMs: 300001 }],
  ["invalid signal", { signal: {} }],
]) test(`private entry refuses unsupported channel before prompting: ${label}`, async () => {
  const f = entryFixture(options); await assert.rejects(f.result, entryDenied);
  assert.equal(f.writes.length, 0); assert.equal(f.raw.length, 0);
});

test("private raw-mode setup failure returns only sanitized failure", async () => {
  const f = entryFixture({ configure: ({ input }) => { input.setRawMode = () => { throw rawError(); }; } });
  await assert.rejects(f.result, entryDenied);
});

const policyNow = 1000000;
const interrupted = Object.freeze({ kind: "lifecycle", intent: "synthetic-prior", phase: "assign_and_commit" });
function recovery(overrides = {}) {
  const clearance = { priorIntent: interrupted.intent, nextIntent: "synthetic-next", approvalId: "synthetic-approved",
    projectReference: sandboxTarget.projectReference, targetRole: sandboxTarget.role, roleOid: "42",
    roleFenced: true, sessions: 0, unresolvedSecretVersions: false, expiresAt: policyNow + 600000 };
  return { last: interrupted, operation: "recover", roleOid: "42", intent: "synthetic-next",
    approvalId: "synthetic-approved", now: policyNow, clearance, ...overrides };
}

test("maintenance deadline derives a finite soft stop, hard stop and reserved entry budget", () => {
  const shortest = maintenanceWindow(policyNow + 180000, policyNow);
  assert.deepEqual(shortest, { softCancelAfterMs: 120000, hardStopAfterMs: 180000, entryTimeoutMs: 60000 });
  assert.equal(Object.isFrozen(shortest), true);
  assert.deepEqual(maintenanceWindow(policyNow + 3600000, policyNow),
    { softCancelAfterMs: 3540000, hardStopAfterMs: 3600000, entryTimeoutMs: 300000 });
  assert.equal(maintenanceWindow(policyNow + 420000, policyNow).entryTimeoutMs, 300000);
  assert.equal(maintenanceWindow(policyNow + 419999, policyNow).entryTimeoutMs, 299999);
});

for (const [label, deadline, now] of [
  ["under admission reserve", policyNow + 179999, policyNow], ["over one hour", policyNow + 3600001, policyNow],
  ["elapsed", policyNow, policyNow], ["negative time", 180000, -1],
  ["fraction", policyNow + 180000.5, policyNow], ["invalid clock", policyNow + 180000, NaN],
  ["unsafe deadline", Number.MAX_SAFE_INTEGER + 1, policyNow],
]) test(`maintenance window rejects invalid timing: ${label}`, () => {
  assert.throws(() => maintenanceWindow(deadline, now), policyDenied);
});

test("mutation admission preserves two minutes and rechecks clearance after private entry", () => {
  assert.equal(requireMutationWindow(policyNow + 120000, Infinity, policyNow), undefined);
  assert.equal(requireMutationWindow(policyNow + 120000, policyNow + 30000, policyNow), undefined);
  assert.throws(() => requireMutationWindow(policyNow + 119999, Infinity, policyNow), policyDenied);
  assert.throws(() => requireMutationWindow(policyNow + 120000, policyNow + 29999, policyNow), policyDenied);
  const expiry = checkRecoveryClearance(recovery({ clearance: { ...recovery().clearance, expiresAt: policyNow + 45000 } }));
  assert.equal(requireMutationWindow(policyNow + 300000, expiry, policyNow + 15000), undefined);
  assert.throws(() => requireMutationWindow(policyNow + 300000, expiry, policyNow + 15001), policyDenied);
  for (const invalid of [undefined, null, "Infinity", NaN, -Infinity]) {
    assert.throws(() => requireMutationWindow(policyNow + 300000, invalid, policyNow), policyDenied);
  }
});

test("only clean finished or genuinely pre-mutation final records avoid fresh clearance", () => {
  for (const operation of ["create", "rotate"]) {
    assert.equal(requiresClearance(undefined, operation), false);
    assert.equal(requiresClearance({ kind: "maintenance_finished", outcome: "staged_ready" }, operation), false);
    assert.equal(requiresClearance({ kind: "maintenance_finished", outcome: "fenced_failure",
      databaseCommit: "not_attempted", requiresFreshReplacement: false }, operation), false);
    for (const prior of [interrupted,
      { kind: "maintenance_finished", outcome: "uncertain", databaseCommit: "uncertain", requiresFreshReplacement: true },
      { kind: "maintenance_finished", databaseCommit: "not_attempted", requiresFreshReplacement: true },
      { kind: "maintenance_finished", databaseCommit: "not_attempted" },
      { kind: "maintenance_finished", databaseCommit: "acknowledged", requiresFreshReplacement: false },
    ]) assert.equal(requiresClearance(prior, operation), true);
  }
  assert.equal(requiresClearance(undefined, "recover"), true);
  assert.throws(() => requiresClearance(interrupted, "delete"), policyDenied);
  assert.throws(() => checkRecoveryClearance(recovery({ operation: "rotate" })), policyDenied);
});

test("exact recovery clearance requires acknowledged fence, empty sessions and no unresolved versions", () => {
  const input = recovery();
  assert.equal(checkRecoveryClearance(input), policyNow + 600000);
  assert.equal(checkRecoveryClearance({ ...input, last: undefined, operation: "create", roleOid: "0", clearance: undefined }), Infinity);
  assert.throws(() => checkRecoveryClearance({ ...input, last: undefined }), policyDenied);
});

for (const [field, value] of [
  ["priorIntent", "synthetic-other"], ["nextIntent", "synthetic-other"], ["approvalId", "synthetic-other"],
  ["projectReference", "synthetic-other"], ["targetRole", "square_synthetic_other"], ["roleOid", "43"],
  ["roleFenced", false], ["roleFenced", undefined], ["sessions", 1], ["sessions", "0"],
  ["unresolvedSecretVersions", true], ["unresolvedSecretVersions", undefined],
  ["expiresAt", policyNow], ["expiresAt", policyNow - 1], ["expiresAt", policyNow + 600001],
  ["expiresAt", String(policyNow + 600000)], ["expiresAt", Infinity],
]) test(`recovery clearance rejects changed/missing proof: ${field}-${String(value)}`, () => {
  const input = recovery(); input.clearance = { ...input.clearance, [field]: value };
  assert.throws(() => checkRecoveryClearance(input), policyDenied);
});

test("an interrupted absent-role create has its own explicit, pinned absence clearance", () => {
  const input = recovery({ operation: "create", roleOid: "0" });
  input.clearance = { ...input.clearance, roleOid: "0", roleAbsent: true };
  delete input.clearance.roleFenced;
  assert.equal(checkRecoveryClearance(input), policyNow + 600000);
  assert.throws(() => checkRecoveryClearance({ ...input, clearance: { ...input.clearance, roleAbsent: false } }), policyDenied);
  assert.throws(() => checkRecoveryClearance({ ...input, roleOid: "42", clearance: { ...input.clearance, roleOid: "42" } }), policyDenied);
  assert.throws(() => checkRecoveryClearance({ ...input, operation: "recover", clearance: { ...input.clearance, roleFenced: true } }), policyDenied);
  assert.throws(() => checkRecoveryClearance({ ...input, clearance: { ...input.clearance, unresolvedSecretVersions: true } }), policyDenied);
});
