const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
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

const controlPlane = require("../lib/integrations/control-plane/provider-registry.ts");
const registeredProviders = require("../lib/integrations/control-plane/registered-provider-registry.ts");
const credentials = require("../lib/integrations/credentials/index.ts");
const qbo = require("../lib/integrations/providers/qbo/index.ts");
const qboOAuth = require("../lib/integrations/provider-runtime/qbo/oauth-policy.ts");
const operationPolicy = require("../lib/integrations/provider-runtime/read-only-operation-policy.ts");
const square = require("../lib/integrations/providers/square/index.ts");

let assertionCount = 0;
let fixtureScenarioCount = 0;

function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function notEqual(actual, expected, message) {
  assertionCount += 1;
  assert.notEqual(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function matches(value, pattern, message) {
  assertionCount += 1;
  assert.match(value, pattern, message);
}
function doesNotMatch(value, pattern, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}

const EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT =
  "sha256:79b16a44b07c214a0e0f3cf06f36a05bf67000ad27119e1955713d0a64fddd05";
const EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT =
  "sha256:8a219cd66c389b04e8a84a9b1602b863a75b7bd04ac80d5b5a119eccc09b8b6d";
const EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT =
  "sha256:fe6cc473b1fb529bc07a7c5471baf5eae047ea9500cec7c12840876dfe666771";
const EXPECTED_QBO_DESCRIPTOR_FINGERPRINT =
  "sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f";
const EXPECTED_ACTIVE_REGISTRY_FINGERPRINT =
  "sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad";

const orderFixtures = square.SQUARE_PHASE_2B2A_ORDER_FIXTURES;
const canaries = Object.values(square.SQUARE_PHASE_2B2A_SYNTHETIC_CANARIES);
const sensitiveValues = [
  ...canaries,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_CURSOR,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_CONNECTION_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_MERCHANT_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID,
  "sq2b2a-provider-error-secret",
  "sq2b2a-attacker-key"
];
const sensitivePattern = new RegExp(
  sensitiveValues.map(escapeRegExp).join("|"),
  "i"
);
const excludedFieldPattern =
  /customer|recipient|ticket|reference|metadata|line_items|taxes|discounts|service_charges|fulfillments|returns|tenders|refunds|rewards|pricing_options|rounding_adjustment|payment_ids|source|note|address|url|future_field/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clone(value) {
  return structuredClone(value);
}

function parserInput(response, operation = "retrieve_order", overrides = {}) {
  return square.squarePhase2B2AParserInput(response, operation, overrides);
}

function parseOrder(response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  return square.parseSquareOrderCoreResponse(
    parserInput(response, operation, overrides)
  );
}

function parseRawInput(input) {
  fixtureScenarioCount += 1;
  return square.parseSquareOrderCoreResponse(input);
}

function assertSafeDiagnostics(result, message) {
  const serialized = JSON.stringify(result.diagnostics);
  doesNotMatch(
    serialized,
    sensitivePattern,
    `${message}: diagnostics omit caller and provider values`
  );
  doesNotMatch(
    serialized,
    /bearer|credential|request body|response payload|cursor001|provider-error-secret/i,
    `${message}: diagnostics remain sanitized`
  );
}

function expectOutcome(result, outcome, message) {
  equal(result.outcome, outcome, message);
  assertSafeDiagnostics(result, message);
  return result;
}

function accepted(result, message) {
  return expectOutcome(result, "accepted", message).value;
}

function rejected(result, message) {
  expectOutcome(result, "rejected", message);
}

function unsupported(result, message) {
  expectOutcome(result, "unsupported", message);
}

function incompatible(result, message) {
  expectOutcome(result, "incompatible-version", message);
}

function assertFingerprintShape(fingerprint, message) {
  matches(fingerprint, /^sha256:[a-f0-9]{64}$/, `${message}: SHA-256 shape`);
  doesNotMatch(
    fingerprint,
    sensitivePattern,
    `${message}: no raw sensitive or authority value`
  );
}

function assertProjectionClean(value, message) {
  const serialized = JSON.stringify(value);
  doesNotMatch(serialized, new RegExp(canaries.map(escapeRegExp).join("|"), "i"), `${message}: excluded values do not survive`);
  doesNotMatch(serialized, excludedFieldPattern, `${message}: excluded field names do not survive`);
}

function assertDeeplyFrozen(value, message, seen = new Set()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  ok(Object.isFrozen(value), `${message} is frozen`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      assertDeeplyFrozen(descriptor.value, `${message}.${String(key)}`, seen);
    }
  }
}

function orderItem(value, id = square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID) {
  const item = value.items.find((candidate) => candidate.id === id);
  ok(item, `Order projection ${id} exists`);
  return item;
}

function testAcceptedResponseEnvelopes() {
  const retrieve = accepted(parseOrder(clone(orderFixtures.retrieve)), "Retrieve Order envelope is accepted");
  equal(retrieve.operation, "retrieve_order", "Retrieve projection binds its operation");
  equal(retrieve.itemCount, 1, "Retrieve emits one core projection");
  const retrievedOrder = orderItem(retrieve);
  equal(retrievedOrder.entityType, "order_core", "projection is explicitly Order core");
  equal(retrievedOrder.projectionScope, "core_summary_only", "projection does not claim complete transaction facts");
  equal(retrievedOrder.requestAuthorityVersion, square.SQUARE_ORDER_REQUEST_AUTHORITY_VERSION, "projection binds the request-authority contract version");
  equal(retrieve.requestAuthorityVersion, square.SQUARE_ORDER_REQUEST_AUTHORITY_VERSION, "envelope binds the request-authority contract version");
  equal(retrievedOrder.state, "COMPLETED", "completed lifecycle state is retained");
  equal(retrievedOrder.lifecycleClass, "completed_terminal", "completed lifecycle is terminal");
  equal(retrievedOrder.providerVersion, "17", "provider version is an exact integer string");
  equal(retrievedOrder.createdAt, "2026-08-19T09:10:11.123456-07:00", "fractional offset timestamp is retained exactly");
  equal(retrievedOrder.updatedAt, "2026-08-19T16:20:21.987654Z", "UTC fractional timestamp is retained exactly");
  equal(retrievedOrder.totalMoney.amountMinor, "1234", "total is an exact minor-unit string");
  equal(retrievedOrder.netAmountDueMoney.amountMinor, "0", "explicit zero remains explicit");
  equal(retrievedOrder.authority.providerId, retrievedOrder.id, "provider identity is fenced");
  equal(retrievedOrder.authority.locationId, retrievedOrder.locationId, "location authority is fenced");
  equal(retrievedOrder.authority.connectionId, square.SQUARE_PHASE_2B2A_SYNTHETIC_CONNECTION_ID, "connection authority is retained");
  assertProjectionClean(retrieve, "Retrieve minimized response");

  const batch = accepted(parseOrder(clone(orderFixtures.batch), "orders_batch_retrieve"), "Batch Retrieve Orders envelope is accepted");
  equal(batch.operation, "orders_batch_retrieve", "Batch projection binds its operation");
  equal(batch.itemCount, 2, "Batch emits both core projections");
  deepEqual(batch.items.map((item) => item.id), [square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID, square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID], "Batch projections are canonicalized by identity");
  const canceledOrder = orderItem(batch, square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID);
  equal(canceledOrder.state, "CANCELED", "canceled state is retained");
  equal(canceledOrder.lifecycleClass, "canceled_terminal", "canceled lifecycle is terminal");
  equal(canceledOrder.totalMoney.amountMinor, "-500", "signed aggregate is retained");
  equal(canceledOrder.totalMoney.currency, "CAD", "a separate Order may use another currency");

  const search = accepted(parseOrder(clone(orderFixtures.search), "orders_search"), "Search Orders envelope is accepted");
  equal(search.operation, "orders_search", "Search projection binds its operation");
  equal(search.pagination.cursorPresent, true, "Search exposes cursor presence as control metadata");
  assertFingerprintShape(search.pagination.cursorFingerprint, "Search cursor fingerprint");
  doesNotMatch(JSON.stringify(search), new RegExp(escapeRegExp(square.SQUARE_PHASE_2B2A_SYNTHETIC_CURSOR)), "raw cursor does not survive minimization");
  for (const item of search.items) {
    equal(item.requestAuthorityFingerprint, search.requestAuthorityFingerprint, "each Search item binds request authority");
    doesNotMatch(JSON.stringify(item), /cursor/i, "Order entity projection contains no cursor metadata");
  }

  const emptyCases = [
    [{}, "retrieve_order", "absent Retrieve order"],
    [{ order: null }, "retrieve_order", "null Retrieve order"],
    [orderFixtures.nullableRetrieve, "retrieve_order", "nullable Retrieve envelope"],
    [{}, "orders_batch_retrieve", "absent Batch orders"],
    [orderFixtures.emptyBatch, "orders_batch_retrieve", "empty Batch orders"],
    [orderFixtures.nullableBatch, "orders_batch_retrieve", "nullable Batch envelope"],
    [{}, "orders_search", "absent Search orders"],
    [orderFixtures.emptySearch, "orders_search", "empty Search orders"],
    [orderFixtures.nullableSearch, "orders_search", "nullable Search envelope"]
  ];
  for (const [response, operation, label] of emptyCases) {
    const value = accepted(parseOrder(clone(response), operation), `${label} is accepted`);
    equal(value.itemCount, 0, `${label} normalizes to no items`);
    deepEqual(value.items, [], `${label} has a canonical empty array`);
    equal(value.pagination.cursorPresent, false, `${label} has no continuation`);
    equal(value.pagination.cursorFingerprint, null, `${label} has no cursor fingerprint`);
  }

  for (const errors of [undefined, null, []]) {
    const response = { order: square.squarePhase2B2AOrder() };
    if (errors !== undefined) response.errors = errors;
    accepted(parseOrder(response), `official errors ${errors === undefined ? "omission" : JSON.stringify(errors)} is accepted`);
  }
}

function testLifecycleOptionalityAndMoney() {
  const lifecycleClasses = {
    OPEN: "open_nonterminal",
    DRAFT: "draft_nonterminal",
    COMPLETED: "completed_terminal",
    CANCELED: "canceled_terminal"
  };
  for (const [state, lifecycleClass] of Object.entries(lifecycleClasses)) {
    const requestContext = square.squarePhase2B2ARequestContext("orders_search", { states: [state] });
    const value = accepted(parseOrder({ orders: [square.squarePhase2B2AOrder({ state })] }, "orders_search", { requestContext }), `${state} is accepted under its requested lifecycle filter`);
    const item = orderItem(value);
    equal(item.state, state, `${state} is retained`);
    equal(item.lifecycleClass, lifecycleClass, `${state} is classified without claiming additive facts`);
  }

  const optionalOrder = {
    id: square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
    location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID
  };
  const absent = orderItem(accepted(parseOrder({ order: optionalOrder }), "all optional Order-core fields may be absent"));
  for (const key of ["state", "providerVersion", "createdAt", "updatedAt", "closedAt", "totalMoney", "totalTaxMoney", "totalDiscountMoney", "totalTipMoney", "totalServiceChargeMoney", "netAmountDueMoney"]) {
    equal(absent[key], null, `${key} omission normalizes to null`);
  }
  equal(absent.lifecycleClass, "unknown", "missing state remains unknown");

  const explicitNullOrder = {
    ...optionalOrder,
    state: null,
    version: null,
    created_at: null,
    updated_at: null,
    closed_at: null,
    total_money: null,
    total_tax_money: null,
    total_discount_money: null,
    total_tip_money: null,
    total_service_charge_money: null,
    net_amount_due_money: null
  };
  const explicitNull = orderItem(accepted(parseOrder({ order: explicitNullOrder }), "SDK-raw nullable optional Order fields are accepted"));
  deepEqual(explicitNull, absent, "absent and explicit-null optional core fields normalize identically");

  const emptyMoney = orderItem(accepted(parseOrder({ order: { ...optionalOrder, total_money: {} } }), "present Money with omitted optional members is accepted"));
  deepEqual(emptyMoney.totalMoney, { amountMinor: null, currency: null }, "present empty Money remains distinct from an absent total");
  const nullableMoney = orderItem(accepted(parseOrder({ order: { ...optionalOrder, total_money: { amount: null, currency: null } } }), "SDK-raw nullable Money members are accepted"));
  deepEqual(nullableMoney.totalMoney, emptyMoney.totalMoney, "absent and null Money members normalize identically");

  for (const version of [0, -7, Number.MAX_SAFE_INTEGER]) {
    const item = orderItem(accepted(parseOrder({ order: { ...optionalOrder, version } }), `provider version ${version} is accepted without an invented sign rule`));
    equal(item.providerVersion, String(version), `provider version ${version} canonicalizes exactly`);
  }

  const reversedTimestamps = orderItem(accepted(parseOrder({ order: { ...optionalOrder, created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-19T00:00:00Z", closed_at: "2026-08-18T00:00:00Z" } }), "timestamps are not subjected to undocumented ordering rules"));
  equal(reversedTimestamps.closedAt, "2026-08-18T00:00:00Z", "closed timestamp is retained without inferred ordering");

  const signedAmounts = [0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
  for (const amount of signedAmounts) {
    const item = orderItem(accepted(parseOrder({ order: { ...optionalOrder, total_money: { amount, currency: "USD" } } }), `signed safe Money amount ${amount} is accepted`));
    equal(item.totalMoney.amountMinor, String(amount), `Money amount ${amount} canonicalizes exactly`);
  }

  const missingTotal = orderItem(accepted(parseOrder({ order: optionalOrder }), "missing total comparison fixture"));
  const zeroTotal = orderItem(accepted(parseOrder({ order: { ...optionalOrder, total_money: { amount: 0, currency: "USD" } } }), "explicit zero total comparison fixture"));
  equal(missingTotal.totalMoney, null, "missing total remains absent");
  deepEqual(zeroTotal.totalMoney, { amountMinor: "0", currency: "USD" }, "explicit zero total remains present");
  notEqual(square.squareOrderCoreFingerprint(missingTotal), square.squareOrderCoreFingerprint(zeroTotal), "missing and explicit-zero totals fingerprint differently");
}

function testAuthorityAndRequestFences() {
  rejected(parseOrder({ order: square.squarePhase2B2AOrder({ id: "SQ2B2AORDERESCAPE" }) }), "Retrieve response cannot override path Order ID");
  rejected(parseOrder({ order: square.squarePhase2B2AOrder({ location_id: "SQ2B2ALOCESCAPE" }) }), "Retrieve response cannot escape authorized locations");
  rejected(parseOrder({ orders: [square.squarePhase2B2AOrder({ id: "SQ2B2AORDERESCAPE" })] }, "orders_batch_retrieve"), "Batch response ID must be requested");

  const constrainedBatchContext = square.squarePhase2B2ARequestContext("orders_batch_retrieve", { locationId: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID });
  accepted(parseOrder({ orders: [square.squarePhase2B2AOrder()] }, "orders_batch_retrieve", { requestContext: constrainedBatchContext }), "Batch result may match its explicit location constraint");
  rejected(parseOrder({ orders: [square.squarePhase2B2ASecondOrder()] }, "orders_batch_retrieve", { requestContext: constrainedBatchContext }), "Batch result cannot override its explicit location constraint");

  rejected(parseOrder({ orders: [square.squarePhase2B2AOrder({ location_id: "SQ2B2ALOCESCAPE" })] }, "orders_search"), "Search result cannot escape requested and authorized locations");
  const completedOnly = square.squarePhase2B2ARequestContext("orders_search", { states: ["COMPLETED"] });
  rejected(parseOrder({ orders: [square.squarePhase2B2AOrder({ state: "OPEN" })] }, "orders_search", { requestContext: completedOnly }), "Search result cannot override lifecycle filter");
  rejected(parseOrder({ orders: [{ id: square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID, location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID }] }, "orders_search", { requestContext: completedOnly }), "state omission cannot satisfy an explicit Search lifecycle filter");

  const unauthorizedSearchContext = square.squarePhase2B2ARequestContext("orders_search", { locationIds: ["SQ2B2ALOCESCAPE"] });
  rejected(parseOrder({ orders: [] }, "orders_search", { requestContext: unauthorizedSearchContext }), "Search request context must itself be authorized");
  const unauthorizedBatchContext = square.squarePhase2B2ARequestContext("orders_batch_retrieve", { locationId: "SQ2B2ALOCESCAPE" });
  rejected(parseOrder({ orders: [] }, "orders_batch_retrieve", { requestContext: unauthorizedBatchContext }), "Batch location context must itself be authorized");

  const duplicate = square.squarePhase2B2AOrder();
  rejected(parseOrder({ orders: [duplicate, clone(duplicate)] }, "orders_search"), "identical duplicate Order identities reject");
  rejected(parseOrder({ orders: [duplicate, square.squarePhase2B2AOrder({ version: 18 })] }, "orders_search"), "conflicting duplicate versions reject deterministically");
  rejected(parseOrder({ orders: [duplicate, square.squarePhase2B2AOrder({ location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID })] }, "orders_search"), "conflicting duplicate locations reject deterministically");
  rejected(parseOrder({ orders: [duplicate, square.squarePhase2B2AOrder({ state: "OPEN" })] }, "orders_search"), "conflicting duplicate lifecycle states reject deterministically");
  rejected(parseOrder({ orders: [duplicate, square.squarePhase2B2AOrder({ updated_at: "2026-08-21T00:00:00Z" })] }, "orders_search"), "conflicting duplicate timestamps reject deterministically");
  rejected(parseOrder({ orders: [duplicate, square.squarePhase2B2AOrder({ total_money: { amount: 2, currency: "USD" } })] }, "orders_search"), "conflicting duplicate totals reject deterministically");

  for (const id of [undefined, null]) {
    const order = square.squarePhase2B2AOrder();
    if (id === undefined) delete order.id;
    else order.id = id;
    unsupported(parseOrder({ order }), `SDK-optional Order ID ${id === undefined ? "omission" : "null"} is not trusted without identity authority`);
  }
  for (const locationId of [undefined, null]) {
    const order = square.squarePhase2B2AOrder();
    if (locationId === undefined) delete order.location_id;
    else order.location_id = locationId;
    rejected(parseOrder({ order }), `required location_id ${locationId === undefined ? "omission" : "null"} rejects`);
  }
}

function testEnvelopeErrorsAndOrderEntries() {
  for (const response of [
    { errors: [{ code: "BAD_REQUEST", detail: "sq2b2a-provider-error-secret" }] },
    { errors: [{ code: "BAD_REQUEST" }], order: square.squarePhase2B2AOrder() },
    { errors: [{ code: "BAD_REQUEST" }], orders: [square.squarePhase2B2AOrder()] }
  ]) {
    const operation = Object.prototype.hasOwnProperty.call(response, "orders") ? "orders_search" : "retrieve_order";
    unsupported(parseOrder(response, operation), "nonempty provider errors fail closed before mixed data can be trusted");
  }
  for (const errors of [{}, "error", 1, true, [null], ["error"], Array.from({ length: 101 }, () => ({}))]) {
    rejected(parseOrder({ errors }), "malformed present provider errors reject");
  }

  for (const orderEntries of [[], [{ order_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID }]]) {
    unsupported(parseOrder({ order_entries: orderEntries }, "orders_search"), "non-null order_entries is never interpreted as complete Orders");
  }
  for (const orderEntries of [{}, "entries", 1, true]) {
    rejected(parseOrder({ order_entries: orderEntries }, "orders_search"), "malformed order_entries rejects");
  }
  unsupported(parseOrder({ orders: [square.squarePhase2B2AOrder()], order_entries: [] }, "orders_search"), "mixed orders and order_entries cannot become trusted output");

  for (const [response, operation, label] of [
    [{ order: [] }, "retrieve_order", "Retrieve order array"],
    [{ order: "order" }, "retrieve_order", "Retrieve order string"],
    [{ orders: {} }, "orders_batch_retrieve", "Batch orders object"],
    [{ orders: "orders" }, "orders_search", "Search orders string"],
    [{ orders: [null] }, "orders_search", "null Search order item"],
    [{ cursor: 12 }, "orders_search", "numeric Search cursor"],
    [{ cursor: "cursor value with spaces" }, "orders_search", "malformed Search cursor"]
  ]) {
    rejected(parseOrder(response, operation), `${label} rejects`);
  }
  for (const [response, operation, label] of [
    [{ orders: null }, "retrieve_order", "Retrieve carrying Batch/Search orders"],
    [{ order_entries: null }, "retrieve_order", "Retrieve carrying Search order_entries"],
    [{ cursor: null }, "retrieve_order", "Retrieve carrying Search cursor"],
    [{ order: null }, "orders_batch_retrieve", "Batch carrying Retrieve order"],
    [{ order_entries: null }, "orders_batch_retrieve", "Batch carrying Search order_entries"],
    [{ cursor: null }, "orders_batch_retrieve", "Batch carrying Search cursor"],
    [{ order: null }, "orders_search", "Search carrying Retrieve order"]
  ]) {
    rejected(parseOrder(response, operation), `${label} rejects as a cross-operation envelope`);
  }

  const futureEnvelope = accepted(parseOrder({ order: square.squarePhase2B2AOrder(), future_control: "bounded future value" }), "unknown bounded envelope fields are safely discarded");
  doesNotMatch(JSON.stringify(futureEnvelope), /future_control|bounded future value/, "unknown envelope fields do not survive minimization");

  const batchOverflowContext = square.squarePhase2B2ARequestContext("orders_batch_retrieve", {
    orderIds: Array.from({ length: 100 }, (_, index) => `SQ2B2ABATCH${String(index).padStart(3, "0")}`)
  });
  const batchOverflow = Array.from({ length: 101 }, (_, index) => ({
    id: `SQ2B2ABATCH${String(index % 100).padStart(3, "0")}`,
    location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID
  }));
  rejected(parseOrder({ orders: batchOverflow }, "orders_batch_retrieve", { requestContext: batchOverflowContext }), "Batch envelope is bounded to 100 Orders");
  rejected(parseOrder({ orders: Array.from({ length: 1001 }, () => ({})) }, "orders_search"), "Search envelope is bounded to 1000 Orders");
  rejected(parseOrder({ cursor: "a".repeat(4097) }, "orders_search"), "Search cursor is bounded");
}

function testMalformedCoreFields() {
  for (const state of ["UNKNOWN", "completed", "", 1, {}, []]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ state }) }), "invalid Order state rejects");
  }
  for (const id of ["", "has space", "<order>", "x".repeat(192), 1, {}, []]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ id }) }), "invalid Order ID rejects");
  }
  for (const location_id of ["", "has space", "<location>", "x".repeat(192), 1, {}, []]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ location_id }) }), "invalid location ID rejects");
  }
  for (const version of [1.5, "1", "1e3", Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ version }) }), "invalid provider version rejects");
  }
  for (const [field, value] of [
    ["created_at", "2026-08-19"],
    ["updated_at", "2026-08-19T12:00:00"],
    ["closed_at", "not-a-timestamp"],
    ["created_at", 1],
    ["updated_at", {}],
    ["closed_at", []]
  ]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ [field]: value }) }), `invalid ${field} rejects`);
  }

  for (const total_money of ["money", 1, [], true]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ total_money }) }), "malformed Money object rejects");
  }
  for (const amount of [1.5, "100", "1e3", Number.MAX_SAFE_INTEGER + 1, {}, [], true]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ total_money: { amount, currency: "USD" } }) }), "unsafe, fractional, exponential-string, or malformed Money amount rejects");
  }
  for (const currency of ["usd", "US1", "ZZZ", "", 1, {}, []]) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ total_money: { amount: 1, currency } }) }), "invalid Money currency rejects");
  }
  rejected(parseOrder({ order: square.squarePhase2B2AOrder({ total_tax_money: { amount: 84, currency: "CAD" } }) }), "currency inconsistency within one Order rejects");
  accepted(parseOrder({ orders: [square.squarePhase2B2AOrder(), square.squarePhase2B2ASecondOrder()] }, "orders_search"), "different currencies across separate Orders remain valid");

  const malformedContexts = [
    { operation: "retrieve_order", requestContext: {} },
    { operation: "retrieve_order", requestContext: square.squarePhase2B2ARequestContext("retrieve_order", { extra: true }) },
    { operation: "orders_batch_retrieve", requestContext: square.squarePhase2B2ARequestContext("orders_batch_retrieve", { orderIds: [] }) },
    { operation: "orders_batch_retrieve", requestContext: square.squarePhase2B2ARequestContext("orders_batch_retrieve", { orderIds: [square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID, square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID] }) },
    { operation: "orders_search", requestContext: square.squarePhase2B2ARequestContext("orders_search", { locationIds: [] }) },
    { operation: "orders_search", requestContext: square.squarePhase2B2ARequestContext("orders_search", { states: [] }) },
    { operation: "orders_search", requestContext: square.squarePhase2B2ARequestContext("orders_search", { states: ["UNKNOWN"] }) },
    { operation: "orders_search", requestContext: square.squarePhase2B2ARequestContext("orders_search", { returnEntries: true }) },
    { operation: "orders_search", requestContext: square.squarePhase2B2ARequestContext("orders_search", { returnEntries: null }) }
  ];
  for (const { operation, requestContext } of malformedContexts) {
    rejected(parseOrder(operation === "retrieve_order" ? {} : { orders: [] }, operation, { requestContext }), "malformed or widened request authority rejects");
  }

  for (const connectionAuthority of [
    {},
    square.squarePhase2B2AConnectionAuthority({ connectionId: "not-a-uuid" }),
    square.squarePhase2B2AConnectionAuthority({ providerEntityType: "location" }),
    square.squarePhase2B2AConnectionAuthority({ providerEntityId: "has space" }),
    square.squarePhase2B2AConnectionAuthority({ extra: true })
  ]) {
    rejected(parseOrder({}, "retrieve_order", { connectionAuthority }), "malformed connection authority rejects");
  }

  rejected(parseRawInput({ ...parserInput({}), unexpected: "sq2b2a-attacker-key" }), "unknown parser input fields reject without echoing values");
  rejected(parseRawInput({ ...parserInput({}), operation: "list_orders" }), "unknown operation rejects");
  incompatible(parseOrder({}, "retrieve_order", { apiVersion: "2026-07-15" }), "unpinned API version is incompatible");
  rejected(parseOrder({}, "retrieve_order", { providerKey: "quickbooks_online" }), "provider mismatch rejects");
  rejected(parseOrder({}, "retrieve_order", { providerEnvironment: "staging" }), "environment mismatch rejects");
}

function testStructuralSafety() {
  const oversizedObject = {};
  for (let index = 0; index < 65; index += 1) oversizedObject[`field_${index}`] = index;
  const nested = {};
  let cursor = nested;
  for (let depth = 0; depth < 14; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  let accessorCalls = 0;
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "sq2b2a-provider-error-secret";
    }
  });
  const pollution = {};
  Object.defineProperty(pollution, "__proto__", {
    enumerable: true,
    value: { polluted: true }
  });
  const symbolKey = { [Symbol("sq2b2a")]: "secret" };
  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = true;
  const sparseArray = [];
  sparseArray.length = 2;
  sparseArray[1] = "value";
  const customArray = [];
  customArray.extra = true;

  const attacks = [
    [oversizedObject, "oversized object"],
    ["x".repeat(4097), "oversized string"],
    [nested, "excessive nesting"],
    [cyclic, "cycle"],
    [accessor, "accessor"],
    [pollution, "pollution key"],
    [symbolKey, "symbol key"],
    [customPrototype, "custom prototype"],
    [sparseArray, "sparse array"],
    [customArray, "custom array property"],
    [Number.MAX_SAFE_INTEGER + 1, "unsafe number"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "infinity"],
    [-0, "negative zero"],
    [1n, "bigint"],
    [undefined, "undefined"],
    [() => true, "function"]
  ];
  for (const [attack, label] of attacks) {
    rejected(parseOrder({ order: square.squarePhase2B2AOrder({ future_field: attack }) }), `${label} in discarded detail rejects during bounded structural inspection`);
  }
  equal(accessorCalls, 0, "rejected accessor is never invoked");

  const inputAccessor = parserInput({});
  Object.defineProperty(inputAccessor, "operation", {
    enumerable: true,
    get() {
      throw new Error("must not run");
    }
  });
  rejected(parseRawInput(inputAccessor), "top-level parser accessor rejects without invocation");
}

function testMinimizationAndFingerprints() {
  const original = accepted(parseOrder(clone(orderFixtures.retrieve)), "fingerprint baseline is accepted");
  const repeated = accepted(parseOrder(clone(orderFixtures.retrieve)), "fingerprint repeat is accepted");
  const originalItem = orderItem(original);
  const repeatedItem = orderItem(repeated);
  const originalItemFingerprint = square.squareOrderCoreFingerprint(originalItem);
  const originalResponseFingerprint = square.squareOrderCoreResponseFingerprint(original);
  equal(square.squareOrderCoreFingerprint(repeatedItem), originalItemFingerprint, "Order core fingerprint is deterministic");
  equal(square.squareOrderCoreResponseFingerprint(repeated), originalResponseFingerprint, "Order response fingerprint is deterministic");
  assertFingerprintShape(originalItemFingerprint, "Order core fingerprint");
  assertFingerprintShape(originalResponseFingerprint, "Order response fingerprint");

  const changedDiscarded = square.squarePhase2B2AOrder({
    ...square.squarePhase2B2ADiscardedDetails({
      customer_id: "SQ2B2ACUSTOMERCHANGED",
      ticket_name: "changed ticket",
      metadata: { changed: "changed metadata" },
      line_items: [{ name: "changed line item" }],
      future_field: "changed future detail"
    })
  });
  const discardedValue = accepted(parseOrder({ order: changedDiscarded }), "bounded discarded details are accepted");
  equal(square.squareOrderCoreFingerprint(orderItem(discardedValue)), originalItemFingerprint, "discarded PII and unsupported detail is entity-fingerprint neutral");
  equal(square.squareOrderCoreResponseFingerprint(discardedValue), originalResponseFingerprint, "discarded PII and unsupported detail is response-fingerprint neutral");
  assertProjectionClean(discardedValue, "changed discarded details projection");

  const batchForward = accepted(parseOrder({ orders: [square.squarePhase2B2AOrder(), square.squarePhase2B2ASecondOrder()] }, "orders_batch_retrieve"), "forward Batch ordering is accepted");
  const batchReverse = accepted(parseOrder({ orders: [square.squarePhase2B2ASecondOrder(), square.squarePhase2B2AOrder()] }, "orders_batch_retrieve"), "reverse Batch ordering is accepted");
  equal(square.squareOrderCoreResponseFingerprint(batchForward), square.squareOrderCoreResponseFingerprint(batchReverse), "provider array order is response-fingerprint neutral");

  const trustedMutations = [
    ["state", { state: "OPEN" }],
    ["version", { version: 18 }],
    ["created timestamp", { created_at: "2026-08-19T09:10:12-07:00" }],
    ["updated timestamp", { updated_at: "2026-08-19T16:20:22Z" }],
    ["closed timestamp", { closed_at: "2026-08-19T09:20:22-07:00" }],
    ["location", { location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID }],
    ["total", { total_money: { amount: 1235, currency: "USD" } }],
    ["tax total", { total_tax_money: { amount: 85, currency: "USD" } }],
    ["discount total", { total_discount_money: { amount: 101, currency: "USD" } }],
    ["tip total", { total_tip_money: { amount: 151, currency: "USD" } }],
    ["service total", { total_service_charge_money: { amount: 51, currency: "USD" } }],
    ["net due total", { net_amount_due_money: { amount: 1, currency: "USD" } }]
  ];
  for (const [label, overrides] of trustedMutations) {
    const changed = accepted(parseOrder({ order: square.squarePhase2B2AOrder(overrides) }), `${label} mutation is accepted`);
    notEqual(square.squareOrderCoreFingerprint(orderItem(changed)), originalItemFingerprint, `${label} changes the Order core fingerprint`);
  }

  const searchWithoutCursor = accepted(parseOrder({ orders: [square.squarePhase2B2AOrder()] }, "orders_search"), "Search without cursor is accepted");
  const searchWithCursor = accepted(parseOrder({ orders: [square.squarePhase2B2AOrder()], cursor: square.SQUARE_PHASE_2B2A_SYNTHETIC_CURSOR }, "orders_search"), "Search with cursor is accepted");
  equal(square.squareOrderCoreFingerprint(orderItem(searchWithoutCursor)), square.squareOrderCoreFingerprint(orderItem(searchWithCursor)), "cursor never changes an Order entity fingerprint");
  notEqual(square.squareOrderCoreResponseFingerprint(searchWithoutCursor), square.squareOrderCoreResponseFingerprint(searchWithCursor), "opaque cursor control metadata changes only the response fingerprint");

  const absentCursor = accepted(parseOrder({ orders: [] }, "orders_search"), "absent cursor normalization fixture");
  const nullCursor = accepted(parseOrder({ orders: [], cursor: null }, "orders_search"), "null cursor normalization fixture");
  deepEqual(absentCursor.pagination, nullCursor.pagination, "absent and null Search cursors normalize identically");
  equal(square.squareOrderCoreResponseFingerprint(absentCursor), square.squareOrderCoreResponseFingerprint(nullCursor), "absent and null Search cursor fingerprints are identical");
}

function testDeepFreeze() {
  const value = accepted(parseOrder(clone(orderFixtures.search), "orders_search"), "deep-freeze fixture is accepted");
  assertDeeplyFrozen(value, "accepted Order response");
  const snapshot = JSON.stringify(value);
  const item = orderItem(value);
  throws(
    () => value.items.push(item),
    /Cannot|read only|extensible|frozen/i,
    "accepted item array resists extension"
  );
  for (const mutate of [
    () => { value.pagination.cursorPresent = false; },
    () => { value.provider.apiVersion = "2026-07-15"; },
    () => { value.connectionAuthority.providerEntityId = "CHANGED"; },
    () => { item.state = "OPEN"; },
    () => { item.authority.locationId = "CHANGED"; },
    () => { item.totalMoney.amountMinor = "999"; }
  ]) {
    mutate();
  }
  equal(JSON.stringify(value), snapshot, "mutation attempts leave the accepted response unchanged");

  const mutableResponse = clone(orderFixtures.retrieve);
  const acceptedBeforeMutation = accepted(parseOrder(mutableResponse), "caller-mutation fixture is accepted");
  const beforeMutation = JSON.stringify(acceptedBeforeMutation);
  mutableResponse.order.state = "OPEN";
  mutableResponse.order.total_money.amount = 999;
  equal(JSON.stringify(acceptedBeforeMutation), beforeMutation, "caller mutation cannot alter a minimized accepted result");
}

function ordersSearchRequestBody(overrides = {}) {
  return {
    location_ids: ["LOC_PHASE2A"],
    query: {
      filter: {
        state_filter: { states: ["COMPLETED"] },
        date_time_filter: {
          updated_at: { start_at: "2026-09-01T00:00:00.000Z" }
        }
      },
      sort: { sort_field: "UPDATED_AT", sort_order: "ASC" }
    },
    limit: 100,
    ...overrides
  };
}

function ordersSearchDecision(body, expectedCursorBindingFingerprint) {
  return square.assertSquareReadOperation({
    providerKey: "square",
    providerEnvironment: "sandbox",
    method: "POST",
    url: "https://connect.squareupsandbox.com/v2/orders/search",
    headers: {
      "Square-Version": square.SQUARE_API_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    ...(expectedCursorBindingFingerprint
      ? { expectedCursorBindingFingerprint }
      : {})
  });
}

function normalizedOrdersSearch(body) {
  const operation = square.SQUARE_READ_ONLY_POST_OPERATIONS.find(
    (candidate) =>
      candidate.providerEnvironment === "sandbox" &&
      candidate.path === "/v2/orders/search"
  );
  if (!operation) throw new Error("Orders Search operation missing");
  const validator =
    square.SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS[
      operationPolicy.providerReadOnlyPostValidatorRegistryKey(operation)
    ];
  if (!validator) throw new Error("Orders Search validator missing");
  return validator({
    operation,
    queryParameters: [],
    body,
    rawBodyByteLength: Buffer.byteLength(JSON.stringify(body), "utf8")
  });
}

function testMergedFullOrderRequestGuard() {
  const omittedBody = ordersSearchRequestBody();
  const falseBody = ordersSearchRequestBody({ return_entries: false });
  const omitted = normalizedOrdersSearch(omittedBody);
  const explicitFalse = normalizedOrdersSearch(falseBody);
  deepEqual(omitted.normalizedBody, explicitFalse.normalizedBody, "omission and explicit false retain one canonical Search request body");
  equal(omitted.normalizedBody.return_entries, false, "normalized Search body enforces complete Orders");
  ok(Object.isFrozen(omitted.normalizedBody), "normalized Search body remains frozen");
  equal(Reflect.set(omitted.normalizedBody, "return_entries", true), false, "caller cannot mutate normalized Search body to order_entries");

  const omittedDecision = ordersSearchDecision(omittedBody);
  const falseDecision = ordersSearchDecision(falseBody);
  equal(omittedDecision.requestFingerprint, falseDecision.requestFingerprint, "omission and explicit false retain the same request fingerprint");
  equal(omittedDecision.requestFingerprint, EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT, "merged Orders Search request fingerprint is exact");
  equal(omittedDecision.cursorBindingFingerprint, falseDecision.cursorBindingFingerprint, "omission and explicit false retain the same cursor binding fingerprint");
  equal(omittedDecision.cursorBindingFingerprint, EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT, "merged Orders Search cursor binding fingerprint is exact");

  const continuation = normalizedOrdersSearch(ordersSearchRequestBody({ cursor: "phase2a-cursor-canary" }));
  equal(continuation.normalizedBody.return_entries, false, "cursor continuation retains complete Orders");
  const continuationDecision = ordersSearchDecision(ordersSearchRequestBody({ cursor: "phase2a-cursor-canary" }), EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT);
  equal(continuationDecision.cursorBindingFingerprint, EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT, "cursor continuation retains the exact binding fingerprint");
  throws(() => ordersSearchDecision(ordersSearchRequestBody({ return_entries: true })), /square_read_operation_denied/, "explicit return_entries true remains denied");
  throws(() => ordersSearchDecision(ordersSearchRequestBody({ cursor: "phase2a-cursor-canary", return_entries: true }), EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT), /square_read_operation_denied/, "cursor continuation cannot introduce return_entries true");
}

function testDormancyInvariantsAndSources() {
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Order-core validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "Order-core validation pins the reviewed API version");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_VERSION, "45.1.0", "official generated SDK version is recorded");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_REVISION, "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76", "official generated SDK revision is immutable");
  equal(square.SQUARE_ORDER_CORE_ENTITY_VERSION, 1, "contract-owned entity version remains separate from provider version");
  deepEqual(square.SQUARE_ORDER_RESPONSE_OPERATION_KEYS, ["retrieve_order", "orders_batch_retrieve", "orders_search"], "only the three declared Order response operations are supported");
  deepEqual(square.SQUARE_ORDER_CORE_TRUSTED_RESPONSE_FIELDS, ["id", "location_id", "state", "version", "created_at", "updated_at", "closed_at", "total_money", "total_tax_money", "total_discount_money", "total_tip_money", "total_service_charge_money", "net_amount_due_money"], "trusted Order-core response fields are explicit and narrow");
  deepEqual(square.SQUARE_ORDER_CORE_DISCARDED_RESPONSE_FIELDS, ["reference_id", "source", "customer_id", "line_items", "taxes", "discounts", "service_charges", "fulfillments", "returns", "return_amounts", "net_amounts", "rounding_adjustment", "tenders", "refunds", "metadata", "ticket_name", "pricing_options", "rewards"], "documented detailed and personal fields are explicitly discarded whole");

  const descriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  equal(descriptorRegistry.descriptors[0].descriptorFingerprint, EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT, "Square Phase 2A descriptor fingerprint is unchanged");
  const qboRegistry = controlPlane.assertProviderDescriptorRegistry(qbo.QBO_PHASE_7_PROVIDER_REGISTRY);
  const qboEntry = qboRegistry.descriptors.find((entry) => entry.descriptor.providerKey === "quickbooks_online");
  ok(qboEntry, "QBO descriptor remains present");
  equal(qboEntry.descriptorFingerprint, EXPECTED_QBO_DESCRIPTOR_FINGERPRINT, "QBO descriptor fingerprint is unchanged");
  equal(qboRegistry.registryFingerprint, EXPECTED_ACTIVE_REGISTRY_FINGERPRINT, "QBO registry fingerprint is unchanged");
  equal(registeredProviders.REGISTERED_PROVIDER_REGISTRY.registryFingerprint, EXPECTED_ACTIVE_REGISTRY_FINGERPRINT, "active registry fingerprint is unchanged");
  deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "QBO remains GET-only");
  throws(() => controlPlane.providerDescriptor("square", "sandbox", registeredProviders.REGISTERED_PROVIDER_REGISTRY), /provider_descriptor_not_registered/, "Square remains unreachable from the active registry");
  throws(() => credentials.providerOAuthPolicy(credentials.createProviderOAuthPolicyRegistry([qboOAuth.QBO_PHASE_8B_OAUTH_POLICY, qboOAuth.QBO_PRODUCTION_OAUTH_POLICY]), "square", "sandbox"), /provider_oauth_policy_not_registered/, "Square OAuth remains unregistered");

  const changedFiles = childProcess.execFileSync("git", ["diff", "--name-only", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
  doesNotMatch(changedFiles, /^(app|components|supabase|services|lib\/supabase|vercel\.json)(?:\/|$)/m, "Phase 2B.2A adds no routes, UI, migrations, services, database, or deployment config");
  doesNotMatch(changedFiles, /^lib\/integrations\/providers\/(?:qbo|square\/(?:descriptor|request-validators))\//m, "QBO, Square descriptor, and merged request validator remain untouched");

  const orderSources = [
    "lib/integrations/providers/square/order-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b2a.ts"
  ].map(read).join("\n");
  doesNotMatch(orderSources, /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|openai|generateText|streamText|credential|secret|access[_-]?token|refresh[_-]?token/i, "Phase 2B.2A source has no network, database, environment, credential, or model call path");
  const responseSource = read("lib/integrations/providers/square/order-responses.ts");
  doesNotMatch(responseSource, /lineItems:|payments:|refunds:|fulfillments:|tenders:|webhook|queue|migration|persist/i, "trusted response implementation adds no detailed transaction normalization or runtime scope");
}

function testExportsDocumentationAndRegistration() {
  ok(square.SquareMinimizedOrderCoreSchema, "Order core schema is exported");
  ok(square.SquareOrderCoreResponseSchema, "Order response schema is exported");
  ok(square.SquareOrderMoneySchema, "Order Money schema is exported");
  ok(square.parseSquareOrderCoreResponse, "Order response parser is exported");
  ok(square.squareOrderCoreFingerprint, "Order core fingerprint helper is exported");
  ok(square.squareOrderCoreResponseFingerprint, "Order response fingerprint helper is exported");
  equal(square.SQUARE_ORDER_RESPONSE_OFFICIAL_REFERENCES.length, 9, "official reference inventory is complete");
  for (const reference of square.SQUARE_ORDER_RESPONSE_OFFICIAL_REFERENCES) {
    matches(reference, /^https:\/\/(?:developer\.squareup\.com|github\.com\/square\/square-nodejs-sdk)\//, "only official Square references are recorded");
  }

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(packageJson.scripts["test:external-integrations-square-phase-2b2a"], "node scripts/external-integrations-square-phase-2b2a-order-core-response-validation-regression-tests.js", "Phase 2B.2A suite is registered");
  matches(ciWorkflow, /pnpm test:external-integrations-square-phase-2b2a/, "CI runs the Phase 2B.2A suite");
}

testAcceptedResponseEnvelopes();
testLifecycleOptionalityAndMoney();
testAuthorityAndRequestFences();
testEnvelopeErrorsAndOrderEntries();
testMalformedCoreFields();
testStructuralSafety();
testMinimizationAndFingerprints();
testDeepFreeze();
testMergedFullOrderRequestGuard();
testDormancyInvariantsAndSources();
testExportsDocumentationAndRegistration();

const fixtureInventory = Object.keys(orderFixtures).length + 7;

console.log(
  `External integrations Square Phase 2B.2A Order-core response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} synthetic fixture definitions. Orders Search ${EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT}; cursor binding ${EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT}; Square descriptor ${EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT}; QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}; active registry ${EXPECTED_ACTIVE_REGISTRY_FINGERPRINT}.`
);
