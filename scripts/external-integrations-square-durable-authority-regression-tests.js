const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { createSquareDatabaseAuthority } = require("../lib/integrations/providers/square/durable-authority.ts");
const taskId = "10000000-0000-4000-8000-000000000001";
const otherTaskId = "10000000-0000-4000-8000-000000000002";
const fingerprint = `sha256:${"a".repeat(64)}`;
let assertions = 0;
const equal = (actual, expected, label) => { assertions++; assert.equal(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const throws = (run) => { assertions++; assert.throws(run, /square_durable_contract_invalid/); };
async function main() {
  let calls = 0, last, raw = {
    scope: { workspaceId: taskId, businessEntityId: taskId, connectionId: taskId,
      sellerId: "SELLER_SYNTHETIC", environment: "sandbox", authorizedLocationIds: ["LOC_1"], generation: 1 },
    stream: "payments", operation: "list_payments", scanId: taskId,
    request: { method: "GET", url: "https://connect.squareupsandbox.com/v2/payments?location_id=LOC_1", body: null },
    expiresAt: 1_900_000_000_000
  };
  const client = { async rpc(name, args) { calls++; last = { name, args }; return { data: raw, error: null }; } };
  const dependencies = { client, taskId, leaseOwnerFingerprint: fingerprint };
  const authority = createSquareDatabaseAuthority(dependencies);
  ok(Object.isFrozen(authority));
  const result = await authority.resolve({ taskId });
  equal(calls, 1); equal(last.name, "resolve_square_ingestion_authority_v1");
  equal(last.args.p_task_id, taskId); equal(last.args.p_lease_owner_fingerprint, fingerprint);
  ok(result !== raw); ok(Object.isFrozen(result)); ok(Object.isFrozen(result.scope));
  ok(Object.isFrozen(result.scope.authorizedLocationIds)); ok(Object.isFrozen(result.request));
  equal(result.scope.sellerId, raw.scope.sellerId);
  dependencies.taskId = otherTaskId; dependencies.leaseOwnerFingerprint = `sha256:${"b".repeat(64)}`;
  equal((await authority.resolve({ taskId })).scope.sellerId, raw.scope.sellerId);
  equal(last.args.p_task_id, taskId); equal(last.args.p_lease_owner_fingerprint, fingerprint);
  const beforeInvalid = calls;
  let traps = 0;
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const accessor = Object.defineProperty({}, "taskId", { enumerable: true, get() { traps++; return taskId; } });
  for (const invocation of [null, undefined, false, [], {}, taskId, { taskId: otherTaskId },
    { taskId, sellerId: "FAKE_AUTHORITY" }, accessor, revoked.proxy,
    new Proxy({}, { ownKeys() { traps++; return []; } }), { taskId: new String(taskId) }]) {
    equal(await authority.resolve(invocation), null);
  }
  equal(calls, beforeInvalid, "invalid invocations perform no RPC"); equal(traps, 0, "no accessors or proxy traps");
  for (const invalid of [revoked.proxy, new Proxy(dependencies, {}),
    { client, taskId, leaseOwnerFingerprint: "invalid" }, { client, taskId },
    { client, taskId, leaseOwnerFingerprint: fingerprint, extra: "ignored?" },
    Object.defineProperty({ client, leaseOwnerFingerprint: fingerprint }, "taskId", { enumerable: true, get() { traps++; return taskId; } })]) {
    throws(() => createSquareDatabaseAuthority(invalid));
  }
  equal(traps, 0);
  for (const rpc of [async () => { throw new Error("PRIVATE_CURSOR_CANARY"); },
    async () => ({ data: null, error: { code: "42501", message: "SELLER_CANARY" } }),
    async () => ({ data: null, error: null })]) {
    equal(await createSquareDatabaseAuthority({ client: { rpc }, taskId, leaseOwnerFingerprint: fingerprint }).resolve({ taskId }), null);
  }
  const saved = raw;
  for (const bad of [accessor, revoked.proxy, new Proxy({}, { ownKeys() { traps++; return []; } }),
    { data: "x".repeat(1_048_577) }, { data: new Array(1_001).fill(null) }, { data: 1.5 }]) {
    raw = bad; equal(await authority.resolve({ taskId }), null);
  }
  raw = { cycle: null }; raw.cycle = raw;
  equal(await authority.resolve({ taskId }), null); equal(traps, 0);
  raw = { ...saved, scope: { ...saved.scope, authorizedLocationIds: Array.from({ length: 1_000 }, (_, i) => `LOC_${i}`) },
    request: { ...saved.request, method: "POST", body: "x".repeat(1_048_576) } };
  const maximum = await authority.resolve({ taskId });
  equal(maximum.scope.authorizedLocationIds.length, 1_000); equal(maximum.request.body.length, 1_048_576);
  console.log(`Square durable authority regression tests passed: ${assertions} assertions.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
