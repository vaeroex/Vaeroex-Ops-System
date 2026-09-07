const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  return resolve.call(this, request === "server-only" ? path.join(root, "scripts/test-stubs/server-only.js") : request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const squarePath = "../lib/integrations/providers/square/";
const { createSquareDormantIngestionAdapter } = require(squarePath + "ingestion-adapter.ts");
const { createSquareSyntheticPageRepository } = require(squarePath + "ingestion-page-repository.ts");
const { squareIngestionScopeFingerprint } = require(squarePath + "ingestion-contracts.ts");
const { squarePhase2B2B3Order } = require(squarePath + "fixtures/phase-2b2b3.ts");
const { squarePaymentFixture } = require(squarePath + "fixtures/payment-responses.ts");
const { squareRefundFixture } = require(squarePath + "fixtures/refund-responses.ts");
const { squareCatalogValidationFixture } = require(squarePath + "fixtures/catalog-response-validation.ts");
const inventory = require(squarePath + "fixtures/inventory-responses.ts");
const clone = value => JSON.parse(JSON.stringify(value));
const epoch = Date.parse("2026-09-06T00:00:00Z");
const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001", businessEntityId: "30000000-0000-4000-8000-000000000001",
  connectionId: "20000000-0000-4000-8000-000000000001", sellerId: "MERCHANT_SYNTHETIC_1", environment: "sandbox",
  authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2", "SQ2B2ALOC001", "SQ2B2ALOC002"], generation: 1
};
let serial = 0, scenarios = 0, assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const ok = (actual, message) => { assertions++; assert.ok(actual, message); };
const scanId = () => `40000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`;
const grant = (stream, operation, endpoint, body = null) => ({
  scope: clone(scope), stream, operation, scanId: scanId(), expiresAt: epoch + 7_200_000,
  request: { method: body === null ? "GET" : "POST", url: "https://connect.squareupsandbox.com" + endpoint, body: body === null ? null : JSON.stringify(body) }
});
function harness(initialGrant, response, options = {}) {
  const token = Object.freeze({});
  let current = initialGrant, clock = epoch, calls = 0, cancellations = 0, resolves = 0;
  const model = options.model ?? createSquareSyntheticPageRepository();
  model.setCurrentGeneration(squareIngestionScopeFingerprint(initialGrant.scope), initialGrant.scope.generation);
  const authority = { async resolve(value) {
    resolves++; if (options.onResolve) options.onResolve(resolves);
    return value === token ? current : null;
  } };
  const transport = async request => {
    calls++;
    equal(request.redirect, "manual", "transport cannot follow redirects");
    equal(request.headers["Square-Version"], "2026-08-19", "pinned header");
    equal(request.headers.Authorization, "Bearer square-synthetic-fixture", "synthetic credential only");
    const payload = typeof response === "function" ? await response(request, calls) : response;
    return { status: 200, url: request.url, redirected: false, headers: { "content-type": "application/json" },
      body: { async *[Symbol.asyncIterator]() {
        const bytes = Buffer.from(JSON.stringify(payload));
        for (let index = 0; index < bytes.length; index += 17) yield bytes.subarray(index, index + 17);
      } }, cancel() { cancellations++; } };
  };
  const deps = { authority, transport, repository: model.repository, now: () => clock };
  let adapter = createSquareDormantIngestionAdapter(deps);
  return {
    model, token, deps, setGrant(value) { current = value; }, advance(ms) { clock += ms; },
    restart() { adapter = createSquareDormantIngestionAdapter(deps); },
    run(value = token, signal) { scenarios++; return adapter.run(value, signal); },
    get calls() { return calls; }, get cancellations() { return cancellations; }
  };
}
const order = squarePhase2B2B3Order();
const orderRequests = [
  ["retrieve_order", "/v2/orders/" + order.id, null, { order }],
  ["orders_batch_retrieve", "/v2/orders/batch-retrieve", { order_ids: [order.id] }, { orders: [order] }],
  ["orders_search", "/v2/orders/search", { location_ids: [order.location_id], return_entries: false }, { orders: [order] }]
];
const cases = [];
for (const stream of ["order_core", "order_line_items", "order_adjustments", "order_tenders"]) {
  for (const [operation, endpoint, body, response] of orderRequests) cases.push([grant(stream, operation, endpoint, body), response]);
}
for (const [stream, operation, endpoint, response] of [
  ["payments", "retrieve_payment", "/v2/payments/PAY_SYNTHETIC_1", { payment: squarePaymentFixture() }],
  ["payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1", { payments: [squarePaymentFixture()] }],
  ["refunds", "retrieve_payment_refund", "/v2/refunds/REFUND_SYNTHETIC_1", { refund: squareRefundFixture() }],
  ["refunds", "list_payment_refunds", "/v2/refunds", { refunds: [squareRefundFixture()] }],
  ["catalog", "retrieve_catalog_object", "/v2/catalog/object/SQ2B1B1CAT001", { object: squareCatalogValidationFixture() }],
  ["catalog", "list_catalog", "/v2/catalog/list?types=CATEGORY", { objects: [squareCatalogValidationFixture()] }],
  ["inventory", "retrieve_inventory_count", "/v2/inventory/CATALOG_SYNTHETIC_1", { counts: [inventory.squareInventoryCountFixture()] }],
  ["inventory", "retrieve_inventory_adjustment", "/v2/inventory/adjustments/ADJUSTMENT_SYNTHETIC_1", { adjustment: inventory.squareInventoryAdjustmentFixture() }],
  ["inventory", "retrieve_inventory_physical_count", "/v2/inventory/physical-counts/PHYSICAL_SYNTHETIC_1", { count: inventory.squareInventoryPhysicalCountFixture() }]
]) cases.push([grant(stream, operation, endpoint), response]);
cases.push(
  [grant("catalog", "catalog_search", "/v2/catalog/search", { object_types: ["CATEGORY"] }), { objects: [squareCatalogValidationFixture()] }],
  [grant("catalog", "catalog_batch_retrieve", "/v2/catalog/batch-retrieve", { object_ids: ["SQ2B1B1CAT001"] }), { objects: [squareCatalogValidationFixture()] }],
  [grant("inventory", "inventory_counts_batch_retrieve", "/v2/inventory/counts/batch-retrieve", { location_ids: ["LOC_SYNTHETIC_1"] }), { counts: [inventory.squareInventoryCountFixture()] }],
  [grant("inventory", "inventory_changes_batch_retrieve", "/v2/inventory/changes/batch-retrieve", { location_ids: ["LOC_SYNTHETIC_1"] }), { changes: [inventory.squareInventoryChangeFixture()] }]
);

async function main() {
  // All 25 operation/scope combinations use the real bounded decoder, fresh parser,
  // mapper, generic pending serializer and atomic model—not stubbed accepted results.
  for (const [input, response] of cases) {
    const h = harness(input, response);
    const result = await h.run();
    equal(result.outcome, "committed", `${input.stream}/${input.operation}: ${JSON.stringify(result)}`);
    equal(result.sourceCount, 1, "one root source");
    equal(result.completeness.historical, "unknown"); equal(result.completeness.economic, "blocked");
    equal(result.completeness.pageSequence, "finished");
    if (input.stream.startsWith("order_")) ok(result.completeness.reasons.includes("returns_unknown"));
    const stored = h.model.inspect().sources[0];
    equal(stored.version.validation.state, "pending"); equal(stored.version.trust, "untrusted_external_input");
    equal(stored.version.businessEntityId, scope.businessEntityId); ok(Object.isFrozen(stored.version.normalizedProjection));
    h.restart(); equal((await h.run()).outcome, "finished"); equal(h.calls, 1, "finished restart performs no new read");
  }

  // Pagination and private custody across process-like adapter reconstruction,
  // including literal '+' and '=' cursor bytes (never URLSearchParams decoding).
  for (const index of [2, 13, 15, 17, 18, 21, 23, 24]) {
    const [input, response] = cases[index];
    const h = harness(input, request => {
      const hasCursor = request.body ? JSON.parse(request.body).cursor : new URL(request.url).searchParams.has("cursor");
      return hasCursor ? response : { ...response, cursor: "next+Cursor==" };
    });
    const first = await h.run();
    equal(first.outcome, "committed", `${input.operation} first`); ok(first.continuation); equal(first.completeness.pageSequence, "partial");
    ok(!JSON.stringify(first).includes("next+Cursor")); ok(!JSON.stringify(h.model.inspect()).includes("next+Cursor"));
    h.restart();
    const second = await h.run(); equal(second.outcome, "committed", `${input.operation} continuation: ${JSON.stringify(second)}`);
    equal(second.continuation, false); equal(h.model.inspect().sourceVersionCount, 1, "same content from another page is one version");
  }

  const paymentGrant = grant("payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1");
  for (const fault of ["before_stage", "during_stage", "after_commit"]) {
    const h = harness(paymentGrant, { payments: [squarePaymentFixture()] }); h.model.injectFault(fault);
    equal((await h.run()).outcome, "retry", fault);
    equal(h.model.inspect().sourceVersionCount, fault === "after_commit" ? 1 : 0);
    h.advance(30_001); h.restart();
    equal((await h.run()).outcome, fault === "after_commit" ? "finished" : "committed", "recovery follows atomic state");
    equal(h.model.inspect().sourceVersionCount, 1);
  }

  // Content-addressed observations survive duplicate/correction/late delivery;
  // only a provider-ordered observation changes the model's current pointer.
  let payment = squarePaymentFixture();
  const lifecycle = harness(paymentGrant, () => ({ payments: [payment] }));
  await lifecycle.run();
  for (const [updatedAt, amount] of [["2026-09-01T12:01:00Z", 1_000], ["2026-09-01T12:02:00Z", 2_000], ["2026-09-01T12:00:00Z", 500], ["2026-09-01T12:02:00Z", 3_000]]) {
    payment = squarePaymentFixture({ updated_at: updatedAt, amount_money: { amount, currency: "USD" } });
    lifecycle.setGrant({ ...paymentGrant, scanId: scanId() }); lifecycle.advance(1_000); await lifecycle.run();
  }
  const state = lifecycle.model.inspect(); equal(state.sourceVersionCount, 4);
  ok(state.sources.some(source => source.ordering === "older")); ok(state.sources.some(source => source.ordering === "conflict"));
  const current = state.sources.find(source => source.pending.versionKey === state.resources[0].currentVersionKey);
  equal(current.pending.projection.data.amountMoney.amountMinor, "2000", "late/equal-clock changes cannot overwrite current");
  const resumed = await lifecycle.run(); equal(resumed.outcome, "finished");
  ok(resumed.completeness.reasons.includes("unordered_provider_revision"), "restart preserves stored conflict limitation");

  const capped = harness(paymentGrant, { payments: [squarePaymentFixture()], cursor: "nextPage==" }, {
    model: createSquareSyntheticPageRepository({ maximumPagesPerScan: 1 })
  });
  const limited = await capped.run(); equal(limited.outcome, "committed"); equal(limited.continuation, false);
  equal(limited.completeness.pageSequence, "blocked", "page-cap stop reported in the successful atomic result");
  ok(limited.completeness.reasons.includes("interrupted_scan"));
  const limitRestart = await capped.run(); equal(limitRestart.outcome, "blocked"); equal(limitRestart.completeness.pageSequence, "blocked");

  const rate = harness(paymentGrant, {});
  rate.deps.transport = async request => ({ status: 429, url: request.url, redirected: false,
    headers: { "retry-after": "2" }, body: { async *[Symbol.asyncIterator]() {} }, cancel() {} });
  const retry = await rate.run(); equal(retry.outcome, "retry"); equal(retry.retryAfterMs, 2_000);
  const deferred = await rate.run(); equal(deferred.outcome, "retry"); equal(deferred.retryAfterMs, 2_000);
  ok(deferred.completeness.reasons.includes("interrupted_scan"), "deferred retry exposes stored limitation");
  for (const status of [401, 403, 500]) {
    const failed = harness(paymentGrant, {});
    failed.deps.transport = async request => ({ status, url: request.url, redirected: false, headers: {},
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from("private-error-canary"); } }, cancel() {} });
    const result = await failed.run(); equal(result.outcome, status === 500 ? "retry" : "blocked");
    equal(result.code, status === 500 ? "transient" : "authorization"); equal(failed.model.inspect().sourceVersionCount, 0);
    equal(failed.model.inspect().scans[0].checkpointVersion, 0); ok(!JSON.stringify(result).includes("private-error-canary"));
  }
  const maximumCursor = "x".repeat(4_094) + "==";
  const fullCursor = harness(paymentGrant, request => ({ payments: [squarePaymentFixture()],
    ...(request.url.includes("cursor=") ? {} : { cursor: maximumCursor }) }));
  equal((await fullCursor.run()).outcome, "committed"); fullCursor.restart();
  equal((await fullCursor.run()).outcome, "committed", "existing 4096-character cursor works without truncation");

  const midAbort = new AbortController();
  let opened;
  const opening = new Promise(resolve => { opened = resolve; });
  const cancelledRead = harness(paymentGrant, {});
  cancelledRead.deps.transport = async request => {
    opened();
    return { status: 200, url: request.url, redirected: false, headers: {},
      body: { [Symbol.asyncIterator]() { return { next: () => new Promise(resolve => {
        if (request.signal.aborted) resolve({ done: true });
        else request.signal.addEventListener("abort", () => resolve({ done: true }), { once: true });
      }) }; } }, cancel() {} };
  };
  const cancelling = cancelledRead.run(cancelledRead.token, midAbort.signal); await opening; midAbort.abort();
  equal((await cancelling).code, "cancelled");
  await new Promise(resolve => setImmediate(resolve));
  equal(cancelledRead.model.inspect().sourceVersionCount, 0, "cancellation cannot leave a late committed page");

  // A delayed grant/acquisition starts the lease AFTER the outer deadline clock.
  // Honor the returned retry delay; it must not encounter the still-active lease.
  const originalSetTimeout = global.setTimeout, originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  let deadlineHarness, openDeadline;
  const deadlineOpened = new Promise(resolve => { openDeadline = resolve; });
  deadlineHarness = harness(paymentGrant, { payments: [squarePaymentFixture()] }, {
    onResolve(count) { if (count === 1) deadlineHarness.advance(2_000); }
  });
  const normalTransport = deadlineHarness.deps.transport;
  deadlineHarness.deps.transport = () => { openDeadline(); return new Promise(() => {}); };
  let timedOut;
  try {
    global.setTimeout = (callback, delay) => { const timer = { callback, delay }; scheduled.push(timer); return timer; };
    global.clearTimeout = () => {};
    const running = deadlineHarness.run(); await deadlineOpened;
    equal(scheduled[0].delay, 30_000, "outer deadline remains bounded");
    deadlineHarness.advance(28_000); scheduled[0].callback(); timedOut = await running;
    equal(timedOut.code, "invocation_deadline"); equal(timedOut.retryAfterMs, 30_000);
  } finally { global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout; }
  await new Promise(resolve => setImmediate(resolve));
  deadlineHarness.advance(timedOut.retryAfterMs); deadlineHarness.deps.transport = normalTransport;
  equal((await deadlineHarness.run()).outcome, "committed", "deadline retry waits past delayed acquisition lease");
  equal(deadlineHarness.model.inspect().sourceVersionCount, 1);

  let cat = squareCatalogValidationFixture();
  const catGrant = grant("catalog", "retrieve_catalog_object", "/v2/catalog/object/SQ2B1B1CAT001");
  const tombstones = harness(catGrant, () => ({ object: cat })); await tombstones.run();
  cat = { type: "CATEGORY", id: cat.id, version: cat.version + 1, updated_at: "2026-09-06T00:00:00Z", is_deleted: true };
  tombstones.setGrant({ ...catGrant, scanId: scanId() }); equal((await tombstones.run()).outcome, "committed");
  const deleted = tombstones.model.inspect().sources.find(source => source.pending.deleted);
  ok(deleted); equal(deleted.version.changeKind, "deleted"); equal(deleted.version.normalizedProjection, null);

  for (const payload of [
    { payments: [squarePaymentFixture(), {}] }, // parser-supported absent ID cannot become anonymous source
    { payments: [squarePaymentFixture({ source_type: "FUTURE_VARIANT" })] },
    { payment: squarePaymentFixture() } // wrong operation envelope
  ]) {
    const h = harness(paymentGrant, payload); equal((await h.run()).outcome, "blocked");
    equal(h.model.inspect().sourceVersionCount, 0); equal(h.model.inspect().scans[0].checkpointVersion, 0);
    ok((await h.run()).completeness.reasons.includes("unsupported_page"), "unsupported limitation survives restart");
  }

  // Caller data is not an authority factory, and no cross-scope/stale grant gets a read.
  const h = harness(paymentGrant, { payments: [squarePaymentFixture()] });
  equal((await h.run({ ...paymentGrant })).outcome, "rejected"); equal(h.calls, 0);
  for (const [key, value] of [["workspaceId", "90000000-0000-4000-8000-000000000001"], ["businessEntityId", "90000000-0000-4000-8000-000000000002"], ["connectionId", "90000000-0000-4000-8000-000000000003"], ["sellerId", "FOREIGN"], ["environment", "production"], ["generation", 2], ["authorizedLocationIds", ["FOREIGN"]]]) {
    h.setGrant({ ...paymentGrant, scope: { ...scope, [key]: value } });
    ok(["rejected", "conflict", "blocked"].includes((await h.run()).outcome), key); equal(h.calls, 0);
  }
  h.setGrant({ ...paymentGrant, operation: "list_payment_refunds" }); equal((await h.run()).outcome, "rejected"); equal(h.calls, 0);
  h.setGrant({ ...paymentGrant, expiresAt: epoch }); equal((await h.run()).outcome, "rejected");

  const swap = harness(paymentGrant, { payments: [squarePaymentFixture()], cursor: "privateCursor==" });
  equal((await swap.run()).outcome, "committed");
  swap.setGrant({ ...paymentGrant, request: { ...paymentGrant.request, url: paymentGrant.request.url + "&limit=10" } });
  equal((await swap.run()).outcome, "conflict"); equal(swap.calls, 1, "query-swapped scan cannot consume private cursor");

  let revoking;
  revoking = harness(paymentGrant, () => {
    revoking.setGrant({ ...paymentGrant, scope: { ...scope, generation: 2 } });
    revoking.model.setCurrentGeneration(squareIngestionScopeFingerprint(scope), 2);
    return { payments: [squarePaymentFixture()] };
  });
  equal((await revoking.run()).outcome, "retry"); equal(revoking.model.inspect().sourceVersionCount, 0, "revocation during read fences commit");

  let traps = 0;
  for (const poisoned of [new Proxy({}, { ownKeys() { traps++; throw Error("secret"); } }), Object.defineProperty(clone(paymentGrant), "scope", { get() { traps++; throw Error("secret"); } })]) {
    const poison = harness(paymentGrant, {}); poison.setGrant(poisoned); equal((await poison.run()).outcome, "rejected"); equal(poison.calls, 0);
  }
  equal(traps, 0, "grant preflight never invokes hostile hooks");
  const abort = new AbortController(); abort.abort(); equal((await h.run(h.token, abort.signal)).code, "cancelled");
  const omitted = grant("payments", "list_payments", "/v2/payments");
  equal((await harness(omitted, {}).run()).outcome, "rejected", "no invented default location");
  equal((await harness({ ...omitted, resolvedDefaultLocationId: "LOC_SYNTHETIC_1" }, {}).run()).outcome, "committed", "explicit trusted default supported");

  const canaries = ["private-customer-canary", "private-contact@example.invalid", "private-token-canary"];
  const privacy = harness(paymentGrant, { payments: [squarePaymentFixture({ customer_id: canaries[0], buyer_email_address: canaries[1], note: canaries[2] })] });
  const publicResult = await privacy.run(); equal(publicResult.outcome, "committed");
  for (const canary of canaries) ok(!JSON.stringify([publicResult, privacy.model.inspect()]).includes(canary), "minimization precedes persistence/telemetry");
  console.log(`Square dormant ingestion integration: ${assertions} assertions / ${scenarios} scenarios passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
