const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const square = require("../lib/integrations/providers/square/index.ts");
const validation = require("../lib/integrations/providers/square/response-validation.ts");
const paymentModule = require("../lib/integrations/providers/square/payment-responses.ts");
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixture = square.squarePaymentFixture;
const input = square.squarePaymentParserInput;
const canaries = Object.values(square.SQUARE_PAYMENT_SYNTHETIC_CANARIES);
let assertions = 0;
let scenarios = 0;
const outcomes = new Set();
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const deepEqual = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const throws = (action, message) => { assertions++; assert.throws(action, undefined, message); };
const parse = (value) => {
  scenarios++;
  let result;
  let logCalls = 0;
  const silence = (action) => patch(console, "log", () => { logCalls++; }, () =>
    patch(console, "warn", () => { logCalls++; }, () =>
      patch(console, "error", () => { logCalls++; }, () =>
        patch(console, "info", () => { logCalls++; }, action))));
  assert.doesNotThrow(() => silence(() => { result = square.parseSquarePaymentResponse(value); }));
  equal(logCalls, 0, "parser emits no logs, including provider/fault canaries");
  outcomes.add(result.outcome);
  for (const diagnostic of result.diagnostics) {
    ok(diagnostic.field === "$input" || diagnostic.field === "$response", "root-only diagnostics");
  }
  for (const canary of canaries) ok(!JSON.stringify(result).includes(canary), "sensitive canary absent from trusted output/diagnostics");
  deeplyFrozen(result);
  return result;
};
const accepted = (result, message = "accepted") => { equal(result.outcome, "accepted", message + ": " + JSON.stringify(result.diagnostics)); return result.value; };
const rejected = (result, message = "rejected") => { equal(result.outcome, "rejected", message); };
const unsupported = (result, message = "unsupported") => { equal(result.outcome, "unsupported", message); };
const get = (payment = fixture()) => parse(input({ payment }));
const list = (payments = [fixture()], extras = {}, overrides = {}) => parse(input({ payments, ...extras }, "list_payments", overrides));
const internal = (result) => {
  rejected(result, "fault fails closed");
  deepEqual(result.diagnostics, [{ code: "square_response_internal_rejection", field: "$response" }], "static fallback");
};
function count(value, containersOnly = false) {
  if (value === null || typeof value !== "object") return containersOnly ? 0 : 1;
  return 1 + Object.values(value).reduce((total, item) => total + count(item, containersOnly), 0);
}
function deeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  assert.ok(Object.isFrozen(value));
  seen.add(value);
  Object.values(value).forEach((item) => deeplyFrozen(item, seen));
}
function freeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) freeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}
function patch(object, key, value, action) {
  const original = object[key];
  try { object[key] = value; return action(); } finally { object[key] = original; }
}
function requestDecision(context, environment = "sandbox", cursor = true) {
  const query = { ...context.query };
  if (!cursor) delete query.cursor;
  const parts = Object.keys(query).sort().map((key) => key + "=" + query[key]);
  const url = "https://" + square.SQUARE_ENVIRONMENTS[environment].hostname + "/v2/payments" + (parts.length ? "?" + parts.join("&") : "");
  return square.assertSquareReadOperation({
    providerKey: "square", providerEnvironment: environment, method: "GET",
    url, headers: { "Square-Version": square.SQUARE_API_VERSION },
    expectedCursorBindingFingerprint: context.expectedCursorBindingFingerprint
  });
}
function testContract() {
  const value = accepted(get());
  equal(value.items[0].id, "PAY_SYNTHETIC_1");
  equal(value.items[0].amountMoney.amountMinor, "1000");
  equal(value.items[0].tipMoney.amountMinor, "200");
  equal(value.items[0].totalMoney.amountMinor, "1200");
  equal(value.items[0].refundedMoney.amountMinor, "100");
  equal(value.items[0].refundedMoneySemantics, "provider_aggregate_not_verified_refunds");
  ok(value.items[0].processingFees.some((fee) => fee.amountMoney.amountMinor === "-5"), "signed fee adjustment");
  for (const status of square.SQUARE_PAYMENT_RESPONSE_STATUSES) {
    for (const source_type of square.SQUARE_PAYMENT_RESPONSE_SOURCE_TYPES) {
      const item = accepted(get(fixture({ status, source_type }))).items[0];
      equal(item.status, status);
      equal(item.sourceType, source_type);
    }
  }
  for (const key of square.SQUARE_PAYMENT_TRUSTED_FIELDS) {
    for (const mode of ["missing", "null"]) {
      const raw = fixture();
      if (mode === "missing") delete raw[key]; else raw[key] = null;
      const result = list([raw]);
      accepted(result, key + " " + mode + " optional");
    }
  }
  const absent = accepted(list([{}, {}])).items;
  equal(absent.length, 2, "ID-less records not collapsed");
  equal(absent[0].id, null);
  equal(absent[0].authority.identityState, "absent");
  equal(absent[0].authority.providerId, null);
  equal(absent[0].authority.locationState, "absent");
  equal(absent[0].authority.locationId, null);
  unsupported(get({}), "Get cannot assert requested ID from absent provider ID");
  unsupported(get({ id: null }));
  rejected(get(fixture({ id: "OTHER" })));
  for (const length of [191, 192]) {
    const id = "P".repeat(length);
    const invocation = input({ payment: { id } });
    invocation.requestContext.paymentId = id;
    const result = parse(invocation);
    if (length === 191) accepted(result, "existing request ID maximum");
    else rejected(result, "existing request path policy unchanged");
  }
  for (const key of ["id", "location_id", "order_id"]) {
    const max = key === "location_id" ? 50 : 192;
    const raw = fixture({ [key]: "X".repeat(max) });
    const originalInput = input({ payments: [raw] }, "list_payments");
    if (key === "location_id") {
      originalInput.requestContext.authorizedLocationIds = [raw[key]];
      originalInput.requestContext.locationId = raw[key];
      originalInput.requestContext.query.location_id = raw[key];
    }
    accepted(parse(originalInput), key + " exact API maximum");
    rejected(list([fixture({ [key]: "X".repeat(max + 1) })]), key + " above maximum");
    for (const invalid of ["", " has spaces ", "<script>", 1, false, {}, []]) rejected(list([fixture({ [key]: invalid })]));
  }
  for (const key of ["status", "source_type"]) {
    unsupported(get(fixture({ [key]: "FUTURE_VALUE" })));
    for (const invalid of ["", "X".repeat(51), "free text", "<script>", 0, false, {}, []]) rejected(get(fixture({ [key]: invalid })));
  }
  for (const key of ["created_at", "updated_at"]) {
    for (const timestamp of ["2026-09-01T12:00:00Z", "2026-09-01T12:00:00.123456Z", "2026-09-01T12:00:00-05:00"]) {
      accepted(get(fixture({ [key]: timestamp })));
    }
    for (const invalid of ["2026-02-30T12:00:00Z", "2026-09-01", "today", 1, false, {}, "2026-09-01T12:00:00.123456789012345Z"]) {
      rejected(get(fixture({ [key]: invalid })));
    }
  }
  accepted(get(fixture({ updated_at: "2025-01-01T00:00:00Z" })), "no invented timestamp ordering");
  const fields = ["amount_money", "tip_money", "total_money", "refunded_money"];
  for (const key of fields) {
    const camel = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    for (const [raw, expected] of [[null, null], [{}, { amountMinor: null, currency: null }], [{ amount: null, currency: null }, { amountMinor: null, currency: null }], [{ amount: 0 }, { amountMinor: "0", currency: null }]]) {
      deepEqual(accepted(get(fixture({ [key]: raw }))).items[0][camel], expected);
    }
    for (const amount of [-Number.MAX_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
      equal(accepted(get(fixture({ [key]: { amount } }))).items[0][camel].amountMinor, String(amount));
    }
    for (const amount of [0.5, -0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, "100"]) {
      rejected(get(fixture({ [key]: { amount } })));
    }
    for (const currency of ["usd", "US", "INVALID", 1, false]) rejected(get(fixture({ [key]: { currency } })));
  }
  accepted(get(fixture({
    amount_money: { amount: -8, currency: "USD" }, tip_money: { amount: 10, currency: "CAD" },
    total_money: { amount: 999, currency: "EUR" }, refunded_money: { amount: 10_000 }
  })), "provider Money remains independent; no arithmetic/currency/positivity inference");
  for (const processing_fee of [undefined, null, []]) {
    const raw = fixture();
    if (processing_fee === undefined) delete raw.processing_fee; else raw.processing_fee = processing_fee;
    deepEqual(accepted(get(raw)).items[0].processingFees, []);
  }
  for (const fee of [{}, { effective_at: null, type: null, amount_money: null }, { amount_money: {} }]) accepted(get(fixture({ processing_fee: [fee] })));
  for (const type of square.SQUARE_PAYMENT_PROCESSING_FEE_TYPES) accepted(get(fixture({ processing_fee: [{ type, amount_money: { amount: -10 } }] })));
  unsupported(get(fixture({ processing_fee: [{ type: "FUTURE" }] })));
  rejected(get(fixture({ processing_fee: [{ effective_at: "2026-02-30T00:00:00Z" }] })));
  for (const bad of [{}, 1, false, "fee", [null], [[]], [1]]) rejected(get(fixture({ processing_fee: bad })));
  rejected(get(fixture({ processing_fee: Array.from({ length: 1_001 }, () => ({})) })));
  equal(accepted(get(fixture({ processing_fee: [{ type: "ADJUSTMENT" }, { type: "ADJUSTMENT" }] }))).items[0].processingFeeCount, 2);
  const reordered = fixture();
  reordered.processing_fee.reverse();
  equal(square.squarePaymentFingerprint(value.items[0]), square.squarePaymentFingerprint(accepted(get(reordered)).items[0]), "fee order neutral");
}
function testEnvelopeAuthorityPagination() {
  for (const response of [{}, { payments: null }, { payments: [] }]) equal(accepted(parse(input(response, "list_payments"))).itemCount, 0);
  for (const response of [{}, { payment: null }]) rejected(parse(input(response)), "missing Get response");
  for (const errors of [undefined, null, []]) {
    const response = { payment: fixture() };
    if (errors !== undefined) response.errors = errors;
    accepted(parse(input(response)));
  }
  for (const response of [{ errors: [{ detail: canaries[0] }] }, { payment: fixture(), errors: [{}] }]) unsupported(parse(input(response)));
  for (const errors of [{}, 1, false, ["secret"], [null], Array.from({ length: 101 }, () => ({}))]) rejected(parse(input({ payment: fixture(), errors })));
  for (const extra of [{ payments: [] }, { cursor: null }, { cursor: "" }]) rejected(parse(input({ payment: fixture(), ...extra })));
  rejected(list([], { payment: null }));
  rejected(list(Array.from({ length: 101 }, () => ({}))));
  rejected(list([fixture(), fixture()]), "duplicate ID");
  rejected(list([fixture(), fixture({ location_id: "LOC_SYNTHETIC_2" })]));
  rejected(get(fixture({ location_id: "UNAUTHORIZED" })));
  rejected(list([fixture({ location_id: "LOC_SYNTHETIC_2" })]), "authorized but outside query location");
  const missingLocation = fixture(); delete missingLocation.location_id;
  equal(accepted(get(missingLocation)).items[0].authority.locationId, null);
  const reference = accepted(get()).items[0].orderReference;
  deepEqual(Object.keys(reference).sort(), ["entityType", "providerEnvironment", "providerId", "providerKey", "referenceType"].sort(), "reference cannot grant tenant/connection/location/merchant authority");
  const scopes = ["workspaceId", "connectionId", "providerEntityId"];
  for (const field of scopes) {
    const original = input({ payment: fixture() });
    const before = accepted(parse(original));
    const afterInput = clone(original);
    afterInput.connectionAuthority[field] = field === "providerEntityId" ? "OTHER_MERCHANT" : "30000000-0000-4000-8000-000000000001";
    const after = accepted(parse(afterInput));
    ok(before.requestAuthorityFingerprint !== after.requestAuthorityFingerprint);
    equal(after.items[0].authority[field], afterInput.connectionAuthority[field]);
    const providerInjected = fixture({ [field]: afterInput.connectionAuthority[field], connectionAuthority: afterInput.connectionAuthority });
    equal(square.squarePaymentFingerprint(accepted(get(providerInjected)).items[0]), square.squarePaymentFingerprint(accepted(get()).items[0]));
  }
  const context = input({}, "list_payments").requestContext;
  const queries = [
    {},
    { location_id: "LOC_SYNTHETIC_1" },
    { ...context.query, begin_time: "2026-01-01T00:00:00Z", end_time: "2026-09-01T00:00:00Z", sort_order: "ASC", total: "123", is_offline_payment: "true", offline_begin_time: "2026-01-01T00:00:00Z", offline_end_time: "2026-09-01T00:00:00Z", updated_at_begin_time: "2026-01-01T00:00:00Z", updated_at_end_time: "2026-09-01T00:00:00Z", sort_field: "UPDATED_AT" }
  ];
  for (const query of queries) {
    const requestContext = { ...context, query };
    const first = accepted(list([fixture()], { cursor: "CURSOR_synthetic==" }, { requestContext }));
    const decision = requestDecision(requestContext);
    equal(first.requestFingerprint, decision.requestFingerprint, "existing request fingerprint exact");
    equal(first.cursorBindingFingerprint, decision.cursorBindingFingerprint, "existing cursor fingerprint exact");
    const continuation = {
      ...requestContext, query: { ...query, cursor: "CURSOR_synthetic==" },
      expectedCursorBindingFingerprint: first.cursorBindingFingerprint,
      expectedResponseCursorFingerprint: first.pagination.cursorFingerprint
    };
    const next = accepted(list([fixture()], {}, { requestContext: continuation }));
    equal(next.requestAuthorityFingerprint, first.requestAuthorityFingerprint, "cursor-independent full query authority");
    for (const changed of [
      { ...continuation, query: { ...continuation.query, cursor: "DIFFERENT" } },
      { ...continuation, query: { ...continuation.query, total: "456" } },
      { ...continuation, query: { ...continuation.query, sort_field: "CREATED_AT" } },
      { ...continuation, query: { ...continuation.query, is_offline_payment: "false" } },
      { ...continuation, query: { ...continuation.query, offline_begin_time: "2025-01-01T00:00:00Z" } },
      { ...continuation, expectedResponseCursorFingerprint: null },
      { ...continuation, expectedCursorBindingFingerprint: null }
    ]) {
      // A no-op change is allowed; each actual changed filter must invalidate binding.
      if (JSON.stringify(changed.query) === JSON.stringify(continuation.query) && changed.expectedResponseCursorFingerprint === continuation.expectedResponseCursorFingerprint && changed.expectedCursorBindingFingerprint === continuation.expectedCursorBindingFingerprint) continue;
      rejected(list([], {}, { requestContext: changed }), "continuation mismatch");
    }
    const moved = input({ payments: [] }, "list_payments", { requestContext: continuation });
    moved.connectionAuthority.workspaceId = "30000000-0000-4000-8000-000000000001";
    rejected(parse(moved), "cursor bound to workspace");
  }
  for (const cursor of [undefined, null, ""]) {
    const extras = cursor === undefined ? {} : { cursor };
    deepEqual(accepted(list([], extras)).pagination, { cursorPresent: false, cursorFingerprint: null });
  }
  for (const cursor of [0, {}, [], "bad cursor", "x".repeat(4097)]) rejected(list([], { cursor }));
  const limited = { ...context, query: { ...context.query, limit: "1" } };
  rejected(list([{}, {}], {}, { requestContext: limited }));
  for (const requestContext of [
    { ...context, authorizedLocationIds: [] },
    { ...context, authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_1"] },
    { ...context, locationId: "UNAUTHORIZED" },
    { ...context, query: { location_id: "LOC_SYNTHETIC_2" } },
    { ...context, query: { limit: 1 } },
    { ...context, query: { last_4: "1111" } },
    { ...context, query: { unknown: "x" } },
    { ...context, unknown: "x" }
  ]) rejected(list([], {}, { requestContext }));
  for (const query of [{ limit: "0" }, { limit: "101" }, { sort_order: "BAD" }, { sort_field: "BAD" }, { total: "-1" }, { is_offline_payment: "maybe" }, { begin_time: "yesterday" }]) {
    rejected(list([], {}, { requestContext: { ...context, query } }));
  }
  const ordered = [fixture({ id: "PAY_B" }), fixture({ id: "PAY_A" }), {}];
  equal(square.squarePaymentResponseFingerprint(accepted(list(ordered))), square.squarePaymentResponseFingerprint(accepted(list([...ordered].reverse()))));
  const invocation = input({ payment: fixture() });
  const initialAuthority = accepted(parse(invocation)).requestAuthorityFingerprint;
  invocation.requestContext.authorizedLocationIds.reverse();
  equal(accepted(parse(invocation)).requestAuthorityFingerprint, initialAuthority, "authorization set order neutral");
  invocation.providerEnvironment = "production";
  const production = accepted(parse(invocation));
  equal(production.items[0].authority.providerEnvironment, "production");
  ok(production.requestAuthorityFingerprint !== initialAuthority, "environment bound to authority");
}
function testPrivacyAndRawSafety() {
  const excluded = [
    "customer_id", "employee_id", "team_member_id", "buyer_email_address", "billing_address", "shipping_address",
    "card_details", "cash_details", "bank_account_details", "electronic_money_details", "external_details",
    "wallet_details", "buy_now_pay_later_details", "square_account_details", "gift_card_details",
    "receipt_number", "receipt_url", "note", "reference_id", "refund_ids", "risk_evaluation",
    "terminal_checkout_id", "statement_description_identifier", "capabilities", "device_details", "application_details",
    "buyer_currency_exchange", "is_offline_payment", "offline_payment_details", "version_token",
    "app_fee_money", "app_fee_allocations", "approved_money", "future_field"
  ];
  const baseline = square.squarePaymentResponseFingerprint(accepted(get()));
  for (let i = 0; i < excluded.length; i++) {
    const raw = fixture({ [excluded[i]]: { nested: [canaries[i % canaries.length]] } });
    equal(square.squarePaymentResponseFingerprint(accepted(get(raw))), baseline, excluded[i] + " fingerprint neutral");
  }
  const raw = fixture();
  for (const money of [raw.amount_money, raw.tip_money, raw.total_money, raw.refunded_money, raw.processing_fee[0].amount_money]) money.note = canaries[0];
  raw.processing_fee[0].metadata = canaries[1];
  equal(square.squarePaymentResponseFingerprint(accepted(get(raw))), baseline, "nested Money/fee exclusions neutral");
  let getterCalls = 0, trapCalls = 0;
  const accessor = {}; Object.defineProperty(accessor, "secret", { enumerable: true, get() { getterCalls++; return canaries[0]; } });
  const cycle = {}; cycle.self = cycle;
  const sparse = new Array(2); sparse[1] = 1;
  const custom = []; custom.extra = 1;
  const symbol = { [Symbol("secret")]: canaries[0] };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const proxy = new Proxy({}, {
    getPrototypeOf() { trapCalls++; throw new Error(canaries[0]); },
    ownKeys() { trapCalls++; return []; }, get() { trapCalls++; return null; }
  });
  let deep = {}; for (let i = 0; i < 13; i++) deep = { deep };
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  for (const payload of [accessor, cycle, sparse, custom, symbol, revoked.proxy, proxy, deep, dangerous,
    Object.create({ inherited: true }), { own: undefined }, () => 0, Symbol("x"), 1n, NaN, Infinity, -0,
    "x".repeat(4097), Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["k"+i, 0])),
    { ["x".repeat(129)]: 1 }, Array.from({ length: 1001 }, () => 0)]) {
    rejected(get(fixture({ note: payload })), "excluded raw attack still rejects");
  }
  equal(getterCalls, 0); equal(trapCalls, 0);
  for (const payload of [proxy, revoked.proxy, accessor, null, 0, [], {}, () => 0]) rejected(parse(payload));
  for (const field of ["connectionAuthority", "requestContext", "response", "operation"]) {
    const source = input({ payment: fixture() }); source[field] = proxy;
    rejected(parse(source)); equal(trapCalls, 0, "nested Proxy not reflected");
  }
  const inheritedNull = Object.assign(Object.create(null), fixture());
  accepted(get(inheritedNull), "raw null-prototype object normalizes safely");
  const version = input({ payment: fixture() }); version.apiVersion = "2025-01-01";
  equal(parse(version).outcome, "incompatible-version");
  for (const field of ["providerKey", "providerEnvironment", "operation"]) {
    const source = input({ payment: fixture() }); source[field] = "bad"; rejected(parse(source));
  }
  const snapshotInput = input({ payment: fixture() });
  const result = parse(snapshotInput); accepted(result);
  const snapshot = JSON.stringify(result);
  snapshotInput.response.payment.amount_money.amount = 7;
  equal(JSON.stringify(result), snapshot, "caller mutation isolated");
  throws(() => result.value.items.push({}));
  throws(() => Object.defineProperty(result.value.items[0].authority, "connectionId", { value: "changed" }));
}
function testDerivedBounds() {
  // Exhaustive allocation proof, with optimistic productive values; all omitted
  // scalar/unknown fields only reduce this upper bound.
  let maximum = 0, allocation = null, pairs = 0;
  for (let p = 0; p <= 100; p++) {
    for (let arrays = 0; arrays <= p; arrays++) {
      pairs++;
      const upper = Math.min(20_005 + 3*p - arrays, 7 + 9*p + 2_000*arrays);
      if (upper > maximum) { maximum = upper; allocation = [p, arrays]; }
    }
  }
  equal(pairs, 5151);
  equal(maximum, 20_295);
  deepEqual(allocation, [100, 10]);
  equal(square.SQUARE_PAYMENT_MAXIMUM_RESULT_CONTAINERS, maximum);
  const started = performance.now();
  const maximumList = square.squarePaymentMaximumListEnvelope();
  equal(count(maximumList), 20_000, "List literal raw ceiling");
  const listResult = parse(input(maximumList, "list_payments"));
  equal(accepted(listResult).itemCount, 100);
  equal(count(listResult, true), maximum, "attains derived global maximum");
  const maximumGet = square.squarePaymentMaximumGetEnvelope();
  equal(count(maximumGet), 20_000, "Get literal raw ceiling");
  const getResult = parse(input(maximumGet));
  equal(accepted(getResult).items[0].processingFeeCount, 1000);
  equal(count(getResult, true), 2016, "attains schema cardinality maximum");
  maximumList.future = true;
  equal(count(maximumList), 20_001);
  rejected(parse(input(maximumList, "list_payments")), "first raw value above limit");
  maximumGet.future = true;
  rejected(parse(input(maximumGet)), "Get first raw value above limit");

  // Same unique object repeated: the raw budget counts occurrences, not identities.
  const branch = Array.from({ length: 99 }, () => 0); // 100 values per occurrence
  const aliases = Array.from({ length: 199 }, () => branch); // 19,901
  const aliasRaw = { payment: { id: "PAY_SYNTHETIC_1" }, future: aliases, tail: Array.from({ length: 95 }, () => 0) };
  equal(count(aliasRaw), 20_000);
  accepted(parse(input(aliasRaw)), "expanded aliases exactly raw cap");
  aliasRaw.tail.push(0);
  rejected(parse(input(aliasRaw)), "expanded aliases cannot bypass raw cap");
  console.log("Payment derived-bound witnesses:", JSON.stringify({ list: maximum, get: 2016, elapsedMs: Math.round(performance.now()-started) }));
}
function repeatedGraph(containers) {
  // At most 1,000 aliases; each shared branch contains 30 containers.
  const branch = [ ...Array.from({ length: 29 }, () => ({})) ];
  const copies = Math.floor((containers - 1) / 30);
  const remainder = (containers - 1) % 30;
  return [ ...Array.from({ length: copies }, () => branch), ...Array.from({ length: remainder }, () => ({})) ];
}
function testResultBoundaryFaults() {
  const originalAccepted = validation.squareAcceptedResult;
  const originalFailure = validation.squareFailureResult;
  const originalHash = validation.squareMinimizedProjectionFingerprint;
  const originalSafeParse = square.SquarePaymentResponseSchema.safeParse;
  const replay = parse(input({ payment: fixture() }));
  accepted(replay);
  for (const factory of [
    () => replay,
    () => freeze({ outcome: "accepted", diagnostics: [], value: clone(replay.value) }),
    () => ({ outcome: "accepted", diagnostics: [], value: {} }),
    (value) => ({ outcome: "accepted", value, diagnostics: [] }),
    (value) => freeze({ outcome: "accepted", value, diagnostics: [{}] }),
    (value) => { value.items[0].id = "FORGED"; return originalAccepted(value); }
  ]) patch(validation, "squareAcceptedResult", factory, () => internal(get()));
  let factoryResult;
  patch(validation, "squareAcceptedResult", (value) => factoryResult = originalAccepted(value), () => equal(get(), factoryResult, "legitimate accepted identity"));
  let trapCalls = 0, getterCalls = 0;
  const proxy = (value) => new Proxy(value, { getPrototypeOf() { trapCalls++; throw new Error(canaries[0]); }, ownKeys() { trapCalls++; return []; } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const factory of [
    (value) => proxy(originalAccepted(value)),
    () => revoked.proxy,
    (value) => { value.provider = revoked.proxy; return { outcome: "accepted", value, diagnostics: [] }; },
    (value) => { Object.defineProperty(value.items[0], "id", { enumerable: true, get() { getterCalls++; throw new Error(canaries[0]); } }); return originalAccepted(value); },
    (value) => { value.provider = value; return originalAccepted(value); },
    (value) => { value.items.length += 1; return originalAccepted(value); },
    (value) => { value.items.extra = 1; return originalAccepted(value); }
  ]) patch(validation, "squareAcceptedResult", factory, () => internal(get()));
  // Isolate the boundary from test helpers: never reflect the injected Proxy.
  patch(validation, "squareAcceptedResult", (value) => {
    value.provider = proxy({});
    Object.freeze(value);
    return Object.freeze({ outcome: "accepted", value, diagnostics: Object.freeze([]) });
  }, () => internal(get()));
  equal(trapCalls, 0, "boundary never reflects Proxy"); equal(getterCalls, 0);

  for (const target of [20_295, 20_296]) {
    let returned = false, postSchema = 0, postHash = 0, actualCount = 0;
    try {
      square.SquarePaymentResponseSchema.safeParse = (...args) => {
        if (returned) { postSchema++; return { success: true, data: args[0] }; }
        return originalSafeParse(...args);
      };
      validation.squareMinimizedProjectionFingerprint = (...args) => {
        if (returned) postHash++;
        return originalHash(...args);
      };
      validation.squareAcceptedResult = (value) => {
        value.provider = repeatedGraph(target - count(value, true) - 1);
        const result = originalAccepted(value);
        actualCount = count(result, true);
        returned = true;
        return result;
      };
      internal(get());
      equal(actualCount, target, "expanded repeated-container count exact");
      equal(postSchema, target === 20_295 ? 1 : 0, "inclusive boundary before schema");
      equal(postHash, target === 20_295 ? 1 : 0, "above cap rejects before fingerprint");
    } finally {
      validation.squareAcceptedResult = originalAccepted;
      validation.squareMinimizedProjectionFingerprint = originalHash;
      square.SquarePaymentResponseSchema.safeParse = originalSafeParse;
    }
  }
  // Inject into the initial schema result: wrapper-inclusive preflight must reject
  // before the accepted factory or its fingerprint work.
  const originalParse = square.SquarePaymentResponseSchema.parse;
  let injected = false, factoryCalls = 0, hashesAfterInjection = 0;
  try {
    square.SquarePaymentResponseSchema.parse = (...args) => {
      const value = originalParse(...args);
      value.provider = repeatedGraph(20_296 - count(value, true) - 1);
      injected = true; return value;
    };
    validation.squareAcceptedResult = (value) => { factoryCalls++; return originalAccepted(value); };
    validation.squareMinimizedProjectionFingerprint = (...args) => {
      if (injected) hashesAfterInjection++;
      return originalHash(...args);
    };
    internal(get());
    equal(factoryCalls, 0); equal(hashesAfterInjection, 0);
  } finally {
    square.SquarePaymentResponseSchema.parse = originalParse;
    validation.squareAcceptedResult = originalAccepted;
    validation.squareMinimizedProjectionFingerprint = originalHash;
  }
  for (const failure of [
    () => { throw new Error(canaries[0]); },
    () => proxy({}),
    () => revoked.proxy,
    () => ({ outcome: "rejected", diagnostics: [{ code: canaries[0], field: "$response" }] }),
    () => ({ outcome: "accepted", value: replay.value, diagnostics: [] }),
    () => ({ outcome: "unknown", diagnostics: [] }),
    () => ({ outcome: "rejected", diagnostics: new Array(2) })
  ]) patch(validation, "squareFailureResult", failure, () => internal(get(fixture({ id: 1 }))));
  patch(validation, "squareAcceptedResult", () => { throw new Error(canaries[0]); }, () => {
    internal(get());
    patch(validation, "squareFailureResult", () => { throw new Error(canaries[1]); }, () => internal(get()));
  });
  for (const sanitizer of [
    () => { throw new Error(canaries[0]); },
    () => { throw revoked.proxy; },
    () => proxy({}), () => revoked.proxy
  ]) patch(validation, "squareSafeJsonObject", sanitizer, () => {
    rejected(get());
    patch(validation, "squareFailureResult", () => { throw new Error(canaries[1]); }, () => internal(get()));
  });
  // Fault output can use only whitelisted static diagnostics, reduced to a root.
  patch(validation, "squareFailureResult", () => ({ outcome: "rejected", diagnostics: [{ code: "square_identifier_invalid", field: "$input.nested" }] }), () => {
    deepEqual(get(fixture({ id: 1 })).diagnostics, [{ code: "square_identifier_invalid", field: "$input" }]);
  });
  validation.squareFailureResult = originalFailure;
}
function testCompatibilityAndScope() {
  equal(square.SQUARE_API_VERSION, "2026-08-19");
  equal(square.SQUARE_PAYMENT_RESPONSE_SDK_VERSION, "45.1.0");
  equal(square.SQUARE_PAYMENT_RESPONSE_SDK_REVISION, "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76");
  const registry = require("../lib/integrations/control-plane/registered-provider-registry.ts");
  const control = require("../lib/integrations/control-plane/provider-registry.ts");
  throws(() => control.providerDescriptor("square", "sandbox", registry.REGISTERED_PROVIDER_REGISTRY), "Square unregistered");
  const source = read("lib/integrations/providers/square/payment-responses.ts");
  ok(source.startsWith('import "server-only";'));
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|node:https|node:http|process\.env|@supabase|generateText|streamText/);
  equal(square.SQUARE_MODEL_CALL_COUNT, 0);
  let calls = 0;
  patch(global, "fetch", () => { calls++; throw new Error("unexpected transport"); }, () => accepted(get()));
  equal(calls, 0);
  const baseline = accepted(get());
  const fingerprints = {
    entity: square.squarePaymentFingerprint(baseline.items[0]),
    response: square.squarePaymentResponseFingerprint(baseline),
    request: baseline.requestFingerprint, cursor: baseline.cursorBindingFingerprint
  };
  deepEqual(fingerprints, {
    entity: "sha256:5fd44df5ae0a440845c0a2aa9e6a4fc67adb27b6ff88f070f811b9c179200ba0",
    response: "sha256:1282fff4b53dd89fb7409ccc14fa5c849ea76157c86ffc563b5364a4a9b07b10",
    request: "sha256:4d582b7f0856c4aefc5ca7e1e605d3b5469e785ac222a2a1228d2775490c5180",
    cursor: "sha256:623b8c79ed75af5471e7b9cd4c24e0380115cfefd0eed76e62d6567694476619"
  }, "versioned Payment and established request/cursor fingerprints exact");
  console.log("Payment fingerprints:", JSON.stringify(fingerprints));
  equal(typeof paymentModule.parseSquarePaymentResponse, "function");
}
testContract();
testEnvelopeAuthorityPagination();
testPrivacyAndRawSafety();
testDerivedBounds();
testResultBoundaryFaults();
testCompatibilityAndScope();
deepEqual([...outcomes].sort(), ["accepted", "incompatible-version", "rejected", "unsupported"]);
console.log("Square Payment response regressions: " + assertions + " assertions passed across " + scenarios + " parser scenarios.");
