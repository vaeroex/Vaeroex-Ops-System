const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return resolve.call(this, request === "server-only" ? path.join(root, "scripts/test-stubs/server-only.js") : request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const square = "../lib/integrations/providers/square/";
const { snapshotSquareDurableJson: snapshot, checkedSquareDurableTaskContext: context, SQUARE_DURABLE_JSON_LIMITS: limits } = require(square + "durable-contracts.ts");
const { createSquareDatabaseAuthority } = require(square + "durable-authority.ts");
const { createSquareDurablePageRepository } = require(square + "durable-page-repository.ts");
const { assertNoRemoteConfiguration, assertNoLinkedProject, validateLocalDatabaseUrl } = require("./run-square-durable-page-qualification.js");
let assertions = 0, scenarios = 0;
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const reject = (input, options) => { assertions++; assert.throws(() => snapshot(input, options), /square_durable_contract_invalid/); };
const task = { taskId: "10000000-0000-4000-8000-000000000001", leaseOwnerFingerprint: "sha256:" + "a".repeat(64) };
// 1 root + 22 arrays + 65,977 leaves = exactly 66,000 expanded containers.
function containerBoundary(extra = 0) {
  const result = [], shared = {};
  for (let n = 0; n < 22; n++) result.push(Array.from({ length: n === 21 ? 2977 + extra : 3000 }, () => shared));
  return result;
}
async function main() {
  const maximum = snapshot(containerBoundary());
  ok(Object.isFrozen(maximum) && Object.isFrozen(maximum[0][0]), "maximum container result deeply frozen");
  ok(maximum[0][0] !== maximum[0][1], "shared references are expanded independently");
  reject(containerBoundary(1)); scenarios++;
  const primitives = [null, true, false, 0, 9007199254740991, -9007199254740991, "é😀\n\u0000\\\"", { a: [1, 2] }];
  for (const input of primitives) {
    const bytes = Buffer.byteLength(JSON.stringify(input));
    ok(JSON.stringify(snapshot(input, { ...limits, bytes })) === JSON.stringify(input), "exact serialized UTF-8 boundary accepts");
    reject(input, { ...limits, bytes: bytes - 1 });
  }
  ok(snapshot([1, 2], { ...limits, values: 3 }).length === 2, "root counts toward values");
  reject([1, 2], { ...limits, values: 2 });
  ok(snapshot("x".repeat(4096)).length === 4096, "maximum string"); reject("x".repeat(4097));
  ok(snapshot(Array(3000).fill(null)).length === 3000, "maximum array"); reject(Array(3001).fill(null));
  const properties = Object.fromEntries(Array.from({ length: 64 }, (_, n) => ["k" + n, null]));
  ok(Object.keys(snapshot(properties)).length === 64, "maximum properties"); reject({ ...properties, extra: null });
  let deep = null; for (let n = 0; n < 64; n++) deep = [deep];
  ok(Array.isArray(snapshot(deep)), "depth 64 accepts"); reject([deep]); scenarios++;
  let getterCalls = 0, traps = 0;
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { getterCalls++; return 1; } });
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; }, getPrototypeOf() { traps++; return Object.prototype; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const cycle = {}; cycle.self = cycle;
  const hostile = [accessor, proxy, revoked.proxy, cycle, new Array(1), new Date(), NaN, Infinity, -0, 1.5, undefined, 1n, () => {}, { [Symbol("x")]: 1 }, Object.defineProperty({}, "x", { value: 1 }), JSON.parse('{"__proto__":{}}')];
  for (const input of hostile) reject(input);
  ok(getterCalls === 0 && traps === 0, "descriptor and Proxy rejection does not invoke attacker code"); scenarios++;
  const checked = context(task); ok(Object.isFrozen(checked), "task context frozen");
  assertions++; assert.throws(() => context({ ...task, sellerId: "not_authority" }));
  let calls = 0;
  const client = { async rpc() { calls++; return { data: null, error: null }; } };
  const authority = createSquareDatabaseAuthority({ ...task, client });
  for (const invocation of [accessor, proxy, revoked.proxy, { taskId: task.taskId, scope: {} }, { taskId: "20000000-0000-4000-8000-000000000001" }]) {
    ok(await authority.resolve(invocation) === null, "untrusted invocation fails closed");
  }
  ok(calls === 0, "invalid invocation rejected before RPC");
  const repository = createSquareDurablePageRepository({ ...task, client });
  for (const input of [accessor, proxy, revoked.proxy, containerBoundary(1)]) {
    assertions++; await assert.rejects(repository.commitPage(input));
  }
  ok(calls === 0 && getterCalls === 0 && traps === 0, "hostile page rejected before schema/hash/RPC"); scenarios++;
  const rejectedRpc = createSquareDurablePageRepository({ ...task, client: { async rpc() { throw new Error("SYNTHETIC_PRIVATE_REJECTED_PROMISE_CANARY"); } } });
  const validBinding = { scanKey: task.leaseOwnerFingerprint, scopeFingerprint: task.leaseOwnerFingerprint, queryFingerprint: task.leaseOwnerFingerprint, cursorBindingFingerprint: task.leaseOwnerFingerprint, generation: 1 };
  assertions++; await assert.rejects(rejectedRpc.acquire(validBinding, 0), error => error.message === "square_durable_page_failed");
  const hostileRpc = createSquareDurablePageRepository({ ...task, client: { async rpc() { return { data: revoked.proxy, error: null }; } } });
  assertions++; await assert.rejects(hostileRpc.acquire(validBinding, 0), /square_durable_contract_invalid/); scenarios++;
  for (const name of ["DATABASE_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGPASSFILE", "SUPABASE_TEST_DATABASE_URL", "SUPABASE_TEST_BRANCH_NAME", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SQUARE_ACCESS_TOKEN"]) {
    assertions++; assert.throws(() => assertNoRemoteConfiguration({ [name]: "synthetic_do_not_connect" }));
  }
  assertNoRemoteConfiguration({}); assertions++;
  assertNoLinkedProject(() => false); assertions++;
  assertions++; assert.throws(() => assertNoLinkedProject(() => true), /linked_project_configuration_forbidden/);
  for (const url of ["postgres://postgres:synthetic@example.invalid:5432/postgres", "postgres://postgres:synthetic@127.0.0.1:5432/other", "postgres://worker:synthetic@127.0.0.1:5432/postgres", "postgres://postgres:synthetic@127.0.0.1:5432/postgres?sslmode=require", "http://127.0.0.1:5432/postgres"]) {
    assertions++; assert.throws(() => validateLocalDatabaseUrl(url));
  }
  ok(validateLocalDatabaseUrl("postgres://postgres:synthetic@127.0.0.1:54322/postgres").host === "127.0.0.1", "only discovered loopback target grammar allowed"); scenarios++;
  console.log(`Square durable boundary regression: ${assertions} assertions across ${scenarios} scenarios.`);
}
main().catch(() => { process.stderr.write("Square durable boundary regression failed.\n"); process.exitCode = 1; });
