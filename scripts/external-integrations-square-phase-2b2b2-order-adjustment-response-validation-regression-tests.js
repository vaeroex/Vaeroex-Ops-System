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
const squareResponseValidation = require("../lib/integrations/providers/square/response-validation.ts");
const square = require("../lib/integrations/providers/square/index.ts");

let assertionCount = 0;
let fixtureScenarioCount = 0;
const invokedParsers = new Set();
const adjustmentParserOutcomes = new Set();
let sampleDetailFingerprint;
let sampleResponseFingerprint;

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
const EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT =
  "sha256:667d21354e744d7b75687c36932b72b563f2093d25104b063eafca61ef5d284d";
const EXPECTED_ORDER_LINE_ITEM_RESPONSE_FINGERPRINT =
  "sha256:8c0b7b9ceda5b8cf1e18c06071a0de40221d3c2e228f7de45f67fc5741ce23dc";
const EXPECTED_ORDER_CORE_ENTITY_FINGERPRINT =
  "sha256:417e585883fad9634504dcae2290a568f62ac3b3ac6cea09f1b0bb94c1fd1a34";
const EXPECTED_ORDER_CORE_RESPONSE_FINGERPRINT =
  "sha256:f958b476d1bb34889c98a0af9293056edbb086d39c52cac54b9187f8888e3938";
const EXPECTED_ORDER_ADJUSTMENT_DETAIL_FINGERPRINT =
  "sha256:2b69a233bd2409059458a79bbcccc9018c4a7d6267a0fb1a9ba70e7b613d8335";
const EXPECTED_ORDER_ADJUSTMENT_RESPONSE_FINGERPRINT =
  "sha256:d2b5295118c3b8bccbc71d749620cc4cda4a089ff2d9f8954b8c49291f766cea";

const orderFixtures = square.SQUARE_PHASE_2B2B2_ORDER_FIXTURES;
const canaries = Object.values(square.SQUARE_PHASE_2B2B2_SYNTHETIC_CANARIES);
const sensitiveValues = [
  ...canaries,
  ...Object.values(square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS),
  ...Object.values(square.SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS),
  ...Object.values(square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS),
  square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
  "sq2b2b2OrderCursor001==",
  "sq2b2b2OpaqueCursorChanged==",
  "sq2b2b2-provider-secret",
  "sq2b2b2-attacker-key"
];
const sensitivePattern = new RegExp(
  sensitiveValues.map(escapeRegExp).join("|"),
  "i"
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clone(value) {
  return structuredClone(value);
}

function parserInput(response, operation = "retrieve_order", overrides = {}) {
  return square.squarePhase2B2B2ParserInput(response, operation, overrides);
}

function observeParserResult(result, parserName, adjustmentParser) {
  invokedParsers.add(parserName);
  if (adjustmentParser) adjustmentParserOutcomes.add(result.outcome);
  equal(Array.isArray(result.diagnostics), true, "every outcome has diagnostics");
  for (const diagnostic of result.diagnostics) {
    equal(
      diagnostic.field === "$input" || diagnostic.field === "$response",
      true,
      "every diagnostic uses a static root"
    );
  }
  const diagnostics = JSON.stringify(result.diagnostics);
  doesNotMatch(
    diagnostics,
    sensitivePattern,
    "diagnostics omit caller and provider values"
  );
  doesNotMatch(
    diagnostics,
    /payload|stack|cause|request body|response body|provider-secret/i,
    "diagnostics omit raw operational data"
  );
  return result;
}

function parseAdjustments(
  response,
  operation = "retrieve_order",
  overrides = {}
) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square.parseSquareOrderAdjustmentResponse(
      parserInput(response, operation, overrides)
    ),
    "parseSquareOrderAdjustmentResponse",
    true
  );
}

function parseAdjustmentInput(input) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square.parseSquareOrderAdjustmentResponse(input),
    "parseSquareOrderAdjustmentResponse",
    true
  );
}

function parseLineItems(response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square.parseSquareOrderLineItemResponse(
      parserInput(response, operation, overrides)
    ),
    "parseSquareOrderLineItemResponse",
    false
  );
}

function parseCore(response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square.parseSquareOrderCoreResponse(parserInput(response, operation, overrides)),
    "parseSquareOrderCoreResponse",
    false
  );
}

function expectOutcome(result, outcome, message) {
  equal(result.outcome, outcome, message);
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

function assertInternalRejection(result, message) {
  rejected(result, message);
  deepEqual(
    result.diagnostics,
    [
      {
        code: "square_response_internal_rejection",
        field: "$response"
      }
    ],
    `${message}: static fallback only`
  );
  assertDeeplyFrozen(result, `${message}: fallback`);
}

function assertDeeplyFrozen(value, message, seen = new Set()) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
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

function assertFingerprint(fingerprint, message) {
  matches(fingerprint, /^sha256:[a-f0-9]{64}$/, `${message}: SHA-256 shape`);
  doesNotMatch(fingerprint, sensitivePattern, `${message}: no raw provider value`);
}

function adjustmentItem(
  response,
  orderId = square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID
) {
  const item = response.items.find(
    (candidate) => candidate.lineItemDetail.core.id === orderId
  );
  ok(item, `response contains adjustment detail for ${orderId}`);
  return item;
}

function tax(detail, uid = square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order) {
  const item = detail.taxes.find((candidate) => candidate.uid === uid);
  ok(item, `detail contains tax ${uid}`);
  return item;
}

function discount(
  detail,
  uid = square.SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.orderPercentage
) {
  const item = detail.discounts.find((candidate) => candidate.uid === uid);
  ok(item, `detail contains discount ${uid}`);
  return item;
}

function serviceCharge(
  detail,
  uid = square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.subtotal
) {
  const item = detail.serviceCharges.find((candidate) => candidate.uid === uid);
  ok(item, `detail contains service charge ${uid}`);
  return item;
}

function lineApplication(
  detail,
  uid = square.SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID
) {
  const item = detail.lineItemApplications.find(
    (candidate) => candidate.lineItemUid === uid
  );
  ok(item, `detail contains applications for ${uid}`);
  return item;
}

function responseWithOrder(order) {
  return { order };
}

function declaredParserOutcomes() {
  const source = read("lib/integrations/providers/square/response-validation.ts");
  const sourceFile = ts.createSourceFile(
    "response-validation.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === "SquareResponseParserOutcome"
  );
  if (!declaration || !ts.isUnionTypeNode(declaration.type)) {
    throw new Error("Square parser outcome contract missing");
  }
  return declaration.type.types.map((type) => {
    if (!ts.isLiteralTypeNode(type) || !ts.isStringLiteral(type.literal)) {
      throw new Error("Square parser outcome contract is not a string union");
    }
    return type.literal.text;
  });
}

function exportedOrderParsers() {
  const source = read("lib/integrations/providers/square/order-responses.ts");
  const sourceFile = ts.createSourceFile(
    "order-responses.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const parserNames = [];
  for (const statement of sourceFile.statements) {
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      parserNames.push(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          parserNames.push(declaration.name.text);
        }
      }
    }
  }
  return parserNames.filter((name) =>
    /^parseSquareOrder[A-Za-z0-9]+Response$/.test(name)
  );
}

function assertProjectionMinimized(value, message) {
  const serialized = JSON.stringify(value);
  doesNotMatch(
    serialized,
    new RegExp(canaries.map(escapeRegExp).join("|"), "i"),
    `${message}: excluded canaries are discarded`
  );
  doesNotMatch(
    serialized,
    /"(?:metadata|rewardIds|pricingRuleId|futureField|customerId|providerPayload)"/i,
    `${message}: excluded fields are absent`
  );
}

function testEnvelopeCompositionAndNullability() {
  const retrieve = accepted(
    parseAdjustments(clone(orderFixtures.retrieve)),
    "Retrieve Order adjustment envelope is accepted"
  );
  const lineItems = accepted(
    parseLineItems(clone(orderFixtures.retrieve)),
    "the same response remains accepted by the line-item parser"
  );
  const core = accepted(
    parseCore(clone(orderFixtures.retrieve)),
    "the same response remains accepted by the core parser"
  );
  equal(retrieve.operation, "retrieve_order", "Retrieve operation remains bound");
  equal(retrieve.itemCount, 1, "Retrieve has one adjustment detail");
  const detail = adjustmentItem(retrieve);
  deepEqual(
    detail.lineItemDetail,
    lineItems.items[0],
    "adjustment detail composes the exact line-item projection"
  );
  deepEqual(
    detail.lineItemDetail.core,
    core.items[0],
    "composed line-item detail retains the exact core projection"
  );
  equal(detail.taxCount, 3, "three taxes are retained");
  equal(detail.discountCount, 4, "four discounts are retained");
  equal(detail.serviceChargeCount, 4, "four service charges are retained");
  equal(detail.lineItemApplicationCount, 2, "each line has an application owner");
  assertProjectionMinimized(retrieve, "Retrieve projection");

  const batch = accepted(
    parseAdjustments(clone(orderFixtures.batch), "orders_batch_retrieve"),
    "Batch Retrieve Orders adjustment envelope is accepted"
  );
  equal(batch.itemCount, 2, "Batch returns both Order details");
  deepEqual(
    batch.items.map((item) => item.lineItemDetail.core.id),
    [...batch.items]
      .map((item) => item.lineItemDetail.core.id)
      .sort((left, right) => left.localeCompare(right, "en")),
    "Batch details are deterministically ordered by Order authority"
  );

  const search = accepted(
    parseAdjustments(clone(orderFixtures.search), "orders_search"),
    "Search Orders complete-order adjustment envelope is accepted"
  );
  equal(search.pagination.cursorPresent, true, "Search preserves cursor presence");
  assertFingerprint(
    search.pagination.cursorFingerprint,
    "opaque Search cursor binding"
  );

  const normalized = [
    ["missing", orderFixtures.missingCollections],
    ["null", orderFixtures.nullCollections],
    ["empty", orderFixtures.emptyCollections]
  ].map(([label, fixture]) => {
    const value = accepted(
      parseAdjustments(clone(fixture)),
      `${label} optional-nullable collections are accepted`
    );
    const item = adjustmentItem(value);
    deepEqual(item.taxes, [], `${label} taxes normalize empty`);
    deepEqual(item.discounts, [], `${label} discounts normalize empty`);
    deepEqual(item.serviceCharges, [], `${label} service charges normalize empty`);
    const application = lineApplication(item);
    deepEqual(application.appliedTaxes, [], `${label} applied taxes normalize empty`);
    deepEqual(
      application.appliedDiscounts,
      [],
      `${label} applied discounts normalize empty`
    );
    deepEqual(
      application.appliedServiceCharges,
      [],
      `${label} applied service charges normalize empty`
    );
    return square.squareOrderAdjustmentDetailFingerprint(item);
  });
  equal(normalized[0], normalized[1], "missing and null collections normalize identically");
  equal(normalized[1], normalized[2], "null and empty collections normalize identically");

  for (const key of ["taxes", "discounts", "service_charges"]) {
    rejected(
      parseAdjustments(
        responseWithOrder(square.squarePhase2B2B2Order({ [key]: {} }))
      ),
      `malformed present ${key} rejects`
    );
  }
  for (const key of [
    "applied_taxes",
    "applied_discounts",
    "applied_service_charges"
  ]) {
    const order = square.squarePhase2B2B2Order();
    order.line_items[0][key] = {};
    rejected(
      parseAdjustments(responseWithOrder(order)),
      `malformed present line-item ${key} rejects`
    );
  }
  const malformedServiceTax = square.squarePhase2B2B2Order();
  malformedServiceTax.service_charges[0].applied_taxes = {};
  rejected(
    parseAdjustments(responseWithOrder(malformedServiceTax)),
    "malformed present service-charge applied_taxes rejects"
  );
}

function orderWithSingleDiscount(overrides = {}) {
  const order = square.squarePhase2B2B2Order();
  order.discounts = [square.squarePhase2B2B2Discount(overrides)];
  for (const lineItem of order.line_items) lineItem.applied_discounts = [];
  return order;
}

function orderWithSingleServiceCharge(overrides = {}) {
  const order = square.squarePhase2B2B2Order();
  order.service_charges = [square.squarePhase2B2B2ServiceCharge(overrides)];
  for (const lineItem of order.line_items) lineItem.applied_service_charges = [];
  return order;
}

function testAdjustmentFieldsAndCompatibility() {
  const response = accepted(
    parseAdjustments(clone(orderFixtures.retrieve)),
    "complete adjustment fixture is accepted"
  );
  const detail = adjustmentItem(response);
  const orderTax = tax(detail);
  equal(orderTax.entityType, "order_tax", "tax entity type is explicit");
  equal(orderTax.entityVersion, 1, "tax entity version is explicit");
  equal(orderTax.authority.orderId, detail.lineItemDetail.core.id, "tax binds Order");
  equal(orderTax.authority.taxUid, orderTax.uid, "tax authority binds its UID");
  equal(orderTax.sourceKind, "catalog_backed", "Catalog-backed tax is classified");
  equal(
    orderTax.catalogReference.reconciliationState,
    "unverified",
    "tax Catalog reference remains unverified"
  );
  equal(
    orderTax.catalogReference.providerVersion,
    "1724952893881",
    "tax Catalog version remains exact text"
  );
  equal(orderTax.percentage, "8.25", "tax percentage is canonical exact text");
  equal(orderTax.appliedMoney.amountMinor, "44", "tax Money remains exact text");
  equal(orderTax.autoApplied, true, "read-only tax auto-applied flag is retained");

  const lineTax = tax(detail, square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.line);
  equal(lineTax.sourceKind, "ad_hoc", "ad hoc tax is classified");
  equal(lineTax.type, "INCLUSIVE", "inclusive tax is retained");
  equal(lineTax.percentage, "-0.125", "signed tax percentage is retained exactly");
  equal(lineTax.appliedMoney.amountMinor, "-1", "signed tax Money is retained");
  const otherTax = tax(detail, square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.other);
  equal(otherTax.type, "UNKNOWN_TAX", "legacy tax type remains representable");
  equal(otherTax.scope, "OTHER_TAX_SCOPE", "reporting-only tax scope is retained");
  equal(otherTax.percentage, "0.00000001", "ten-character precision is retained");
  deepEqual(
    otherTax.appliedMoney,
    { amountMinor: null, currency: null },
    "present empty tax Money remains distinct"
  );

  const percentageDiscount = discount(detail);
  equal(percentageDiscount.type, "FIXED_PERCENTAGE", "fixed percentage is retained");
  equal(percentageDiscount.percentage, "12.5", "discount percentage canonicalizes");
  equal(percentageDiscount.amountMoney, null, "absent amount stays absent");
  const amountDiscount = discount(
    detail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.lineAmount
  );
  equal(amountDiscount.type, "FIXED_AMOUNT", "fixed amount is retained");
  equal(amountDiscount.percentage, null, "amount discount has no percentage");
  equal(amountDiscount.amountMoney.amountMinor, "-25", "signed amount is exact");
  const catalogDiscounts = detail.discounts.filter(
    (candidate) => candidate.catalogReference !== null
  );
  deepEqual(
    catalogDiscounts.map(({ type }) => type).sort(),
    ["VARIABLE_AMOUNT", "VARIABLE_PERCENTAGE"],
    "Catalog-backed variable discount variants are retained"
  );
  for (const item of catalogDiscounts) {
    equal(item.sourceKind, "catalog_backed", "Catalog discount is classified");
    equal(
      item.catalogReference.reconciliationState,
      "unverified",
      "discount Catalog reference grants no authority"
    );
  }

  deepEqual(
    [...new Set(detail.taxes.map(({ type }) => type))].sort(),
    [...square.SQUARE_ORDER_TAX_TYPES].sort(),
    "fixture covers every pinned tax type"
  );
  deepEqual(
    [...new Set(detail.taxes.map(({ scope }) => scope))].sort(),
    [...square.SQUARE_ORDER_TAX_SCOPES].sort(),
    "fixture covers every pinned tax scope"
  );
  deepEqual(
    [...new Set(detail.discounts.map(({ type }) => type))].sort(),
    ["FIXED_AMOUNT", "FIXED_PERCENTAGE", "VARIABLE_AMOUNT", "VARIABLE_PERCENTAGE"],
    "fixture covers every compatible discount form"
  );
  deepEqual(
    [...new Set(detail.discounts.map(({ scope }) => scope))].sort(),
    [...square.SQUARE_ORDER_DISCOUNT_SCOPES].sort(),
    "fixture covers every pinned discount scope"
  );
  deepEqual(
    [...new Set(detail.serviceCharges.map(({ calculationPhase }) => calculationPhase))].sort(),
    [...square.SQUARE_ORDER_SERVICE_CHARGE_CALCULATION_PHASES].sort(),
    "fixture covers every service-charge phase"
  );
  deepEqual(
    [...new Set(detail.serviceCharges.map(({ type }) => type))].sort(),
    [...square.SQUARE_ORDER_SERVICE_CHARGE_TYPES].sort(),
    "fixture covers every service-charge type"
  );
  deepEqual(
    [...new Set(detail.serviceCharges.map(({ treatmentType }) => treatmentType))].sort(),
    [...square.SQUARE_ORDER_SERVICE_CHARGE_TREATMENT_TYPES].sort(),
    "fixture covers every service-charge treatment"
  );
  deepEqual(
    [...new Set(detail.serviceCharges.map(({ scope }) => scope))].sort(),
    [...square.SQUARE_ORDER_SERVICE_CHARGE_SCOPES].sort(),
    "fixture covers every service-charge scope"
  );

  const subtotal = serviceCharge(detail);
  equal(subtotal.percentage, "1.5", "percentage service charge is canonical text");
  equal(subtotal.amountMoney, null, "percentage service charge omits amount");
  equal(subtotal.taxable, true, "taxable flag is retained");
  equal(subtotal.appliedTaxCount, 1, "service-charge tax relationship is retained");
  equal(
    subtotal.appliedTaxes[0].authority.serviceChargeUid,
    subtotal.uid,
    "service-charge tax authority binds its owner"
  );
  equal(
    subtotal.appliedTaxes[0].authority.taxUid,
    subtotal.appliedTaxes[0].taxUid,
    "service-charge tax authority binds its target"
  );
  const total = serviceCharge(
    detail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.total
  );
  equal(total.type, "AUTO_GRATUITY", "auto gratuity enum is retained");
  equal(total.name, null, "nullable auto-gratuity name is preserved");
  equal(total.amountMoney.amountMinor, "-3", "signed service amount is exact");
  deepEqual(
    total.totalTaxMoney,
    { amountMinor: null, currency: null },
    "empty service-charge Money remains present"
  );
  const apportioned = serviceCharge(
    detail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.apportionedAmount
  );
  equal(
    apportioned.appliedTaxCount,
    1,
    "pinned applied-tax data is retained even when Square ignores its effect"
  );

  for (const [kind, mutate] of [
    ["tax", (order) => { order.taxes[0].type = "FUTURE_TAX"; }],
    ["tax scope", (order) => { order.taxes[0].scope = "FUTURE_SCOPE"; }],
    ["discount", (order) => { order.discounts[0].type = "FUTURE_DISCOUNT"; }],
    ["discount scope", (order) => { order.discounts[0].scope = "FUTURE_SCOPE"; }],
    ["service phase", (order) => { order.service_charges[0].calculation_phase = "FUTURE_PHASE"; }],
    ["service type", (order) => { order.service_charges[0].type = "FUTURE_TYPE"; }],
    ["service treatment", (order) => { order.service_charges[0].treatment_type = "FUTURE_TREATMENT"; }],
    ["service scope", (order) => { order.service_charges[0].scope = "FUTURE_SCOPE"; }]
  ]) {
    const order = square.squarePhase2B2B2Order();
    mutate(order);
    rejected(
      parseAdjustments(responseWithOrder(order)),
      `unknown ${kind} enum fails closed`
    );
  }

  for (const value of [null, "true", 1, [], {}]) {
    const order = square.squarePhase2B2B2Order();
    order.taxes[0].auto_applied = value;
    if (value === null) {
      const acceptedNull = accepted(
        parseAdjustments(responseWithOrder(order)),
        "nullable SDK tax flag is accepted"
      );
      equal(tax(adjustmentItem(acceptedNull)).autoApplied, null, "null flag normalizes null");
    } else {
      rejected(
        parseAdjustments(responseWithOrder(order)),
        "malformed tax boolean fails closed"
      );
    }
  }

  for (const type of ["VARIABLE_PERCENTAGE", "VARIABLE_AMOUNT", "UNKNOWN_DISCOUNT", null]) {
    rejected(
      parseAdjustments(
        responseWithOrder(orderWithSingleDiscount({
          catalog_object_id: null,
          catalog_version: null,
          type,
          percentage: type === "VARIABLE_PERCENTAGE" ? "1" : null,
          amount_money: type === "VARIABLE_AMOUNT" ? { amount: 1, currency: "USD" } : null
        }))
      ),
      "non-Catalog discount is restricted to fixed types"
    );
  }
  for (const overrides of [
    { type: "FIXED_PERCENTAGE", amount_money: { amount: 1, currency: "USD" } },
    { type: "VARIABLE_PERCENTAGE", percentage: "1", amount_money: { amount: 1, currency: "USD" } },
    { type: "FIXED_AMOUNT", percentage: "1", amount_money: { amount: 1, currency: "USD" } },
    { type: "VARIABLE_AMOUNT", percentage: "1", amount_money: { amount: 1, currency: "USD" } }
  ]) {
    rejected(
      parseAdjustments(
        responseWithOrder(orderWithSingleDiscount({
          catalog_object_id: overrides.type.startsWith("VARIABLE")
            ? "SQ2B2B2CATDISC999"
            : null,
          catalog_version: overrides.type.startsWith("VARIABLE") ? 1 : null,
          ...overrides
        }))
      ),
      "discount percentage-versus-amount conflict fails closed"
    );
  }
  accepted(
    parseAdjustments(
      responseWithOrder(orderWithSingleDiscount({
        type: "FIXED_AMOUNT",
        percentage: null,
        amount_money: null
      }))
    ),
    "optional response fields are not made conditionally required"
  );
  accepted(
    parseAdjustments(
      responseWithOrder(orderWithSingleDiscount({
        catalog_object_id: "SQ2B2B2CATDISCUNKNOWN",
        catalog_version: 1,
        type: "UNKNOWN_DISCOUNT",
        percentage: null,
        amount_money: null
      }))
    ),
    "Catalog-backed UNKNOWN_DISCOUNT remains representable"
  );
  accepted(
    parseAdjustments(
      responseWithOrder(orderWithSingleDiscount({
        catalog_object_id: "SQ2B2B2CATDISCNUL",
        catalog_version: null,
        type: null,
        percentage: null,
        amount_money: null
      }))
    ),
    "nullable Catalog-backed discount fields remain optional"
  );

  for (const overrides of [
    { percentage: null, amount_money: null },
    { percentage: "1", amount_money: { amount: 1, currency: "USD" } },
    { calculation_phase: "TOTAL_PHASE", taxable: true, percentage: null, amount_money: { amount: 1, currency: "USD" } },
    { calculation_phase: "SUBTOTAL_PHASE", scope: "LINE_ITEM" },
    { calculation_phase: "TOTAL_PHASE", scope: "LINE_ITEM", taxable: false, percentage: null, amount_money: { amount: 1, currency: "USD" } },
    { calculation_phase: "APPORTIONED_AMOUNT_PHASE", treatment_type: "LINE_ITEM_TREATMENT", percentage: null, amount_money: { amount: 1, currency: "USD" } },
    { calculation_phase: "APPORTIONED_PERCENTAGE_PHASE", treatment_type: "LINE_ITEM_TREATMENT" },
    { calculation_phase: "APPORTIONED_AMOUNT_PHASE", percentage: "1", amount_money: null, treatment_type: "APPORTIONED_TREATMENT" },
    { calculation_phase: "APPORTIONED_PERCENTAGE_PHASE", percentage: null, amount_money: { amount: 1, currency: "USD" }, treatment_type: "APPORTIONED_TREATMENT" }
  ]) {
    rejected(
      parseAdjustments(
        responseWithOrder(orderWithSingleServiceCharge(overrides))
      ),
      "documented service-charge incompatibility fails closed"
    );
  }

  for (const [field, length] of [
    ["taxes", 255],
    ["discounts", 255],
    ["service_charges", 512]
  ]) {
    const order = square.squarePhase2B2B2Order();
    order[field][0].name = "x".repeat(length);
    accepted(
      parseAdjustments(responseWithOrder(order)),
      `${field} documented name bound is accepted`
    );
    order[field][0].name = "x".repeat(length + 1);
    rejected(
      parseAdjustments(responseWithOrder(order)),
      `${field} overlong name rejects`
    );
  }

  for (const [collection, referenceCollection, referenceField] of [
    ["taxes", "applied_taxes", "tax_uid"],
    ["discounts", "applied_discounts", "discount_uid"],
    ["service_charges", "applied_service_charges", "service_charge_uid"]
  ]) {
    const bounded = square.squarePhase2B2B2Order();
    const previousUid = bounded[collection][0].uid;
    const boundedUid = "U".repeat(60);
    bounded[collection][0].uid = boundedUid;
    for (const lineItem of bounded.line_items) {
      for (const applied of lineItem[referenceCollection]) {
        if (applied[referenceField] === previousUid) {
          applied[referenceField] = boundedUid;
        }
      }
    }
    if (collection === "taxes") {
      for (const item of bounded.service_charges) {
        for (const applied of item.applied_taxes ?? []) {
          if (applied.tax_uid === previousUid) applied.tax_uid = boundedUid;
        }
      }
    }
    accepted(
      parseAdjustments(responseWithOrder(bounded)),
      `${collection} 60-character UID is accepted`
    );

    const overlong = square.squarePhase2B2B2Order();
    overlong[collection][0].uid = "U".repeat(61);
    const overlongResult = parseAdjustments(responseWithOrder(overlong));
    equal(overlongResult.outcome === "accepted", false, `${collection} overlong UID fails closed`);

    const missing = square.squarePhase2B2B2Order();
    delete missing[collection][0].uid;
    const missingResult = parseAdjustments(responseWithOrder(missing));
    equal(missingResult.outcome === "accepted", false, `${collection} missing authority UID fails closed`);
  }

  const opaqueUid = square.squarePhase2B2B2Order();
  const previousOpaqueUid = opaqueUid.taxes[0].uid;
  opaqueUid.taxes[0].uid = "tax/opaque:+value=1";
  for (const lineItem of opaqueUid.line_items) {
    for (const applied of lineItem.applied_taxes) {
      if (applied.tax_uid === previousOpaqueUid) {
        applied.tax_uid = opaqueUid.taxes[0].uid;
      }
    }
  }
  for (const item of opaqueUid.service_charges) {
    for (const applied of item.applied_taxes ?? []) {
      if (applied.tax_uid === previousOpaqueUid) {
        applied.tax_uid = opaqueUid.taxes[0].uid;
      }
    }
  }
  const opaqueUidResult = accepted(
    parseAdjustments(responseWithOrder(opaqueUid)),
    "contract-valid opaque adjustment UID punctuation is accepted"
  );
  equal(
    tax(adjustmentItem(opaqueUidResult), "tax/opaque:+value=1").uid,
    "tax/opaque:+value=1",
    "opaque adjustment UID is retained exactly"
  );

  const boundedCatalog = square.squarePhase2B2B2Order();
  boundedCatalog.taxes[0].catalog_object_id = "C".repeat(192);
  accepted(
    parseAdjustments(responseWithOrder(boundedCatalog)),
    "192-character adjustment Catalog ID is accepted"
  );
  const overlongCatalog = square.squarePhase2B2B2Order();
  overlongCatalog.taxes[0].catalog_object_id = "C".repeat(193);
  rejected(
    parseAdjustments(responseWithOrder(overlongCatalog)),
    "overlong adjustment Catalog ID rejects"
  );
  const opaqueCatalog = square.squarePhase2B2B2Order();
  opaqueCatalog.taxes[0].catalog_object_id = "catalog/object:+opaque=1";
  const opaqueCatalogResult = accepted(
    parseAdjustments(responseWithOrder(opaqueCatalog)),
    "contract-valid opaque adjustment Catalog ID punctuation is accepted"
  );
  equal(
    tax(adjustmentItem(opaqueCatalogResult)).catalogReference.providerId,
    "catalog/object:+opaque=1",
    "opaque adjustment Catalog ID is retained exactly"
  );
  for (const version of ["1", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const order = square.squarePhase2B2B2Order();
    order.taxes[0].catalog_version = version;
    rejected(
      parseAdjustments(responseWithOrder(order)),
      "malformed adjustment Catalog version rejects"
    );
  }
  const orphanedCatalogVersion = square.squarePhase2B2B2Order();
  orphanedCatalogVersion.taxes[0].catalog_object_id = null;
  orphanedCatalogVersion.taxes[0].catalog_version = 1;
  rejected(
    parseAdjustments(responseWithOrder(orphanedCatalogVersion)),
    "Catalog version without Catalog ID rejects"
  );

  const boundedAppliedUid = square.squarePhase2B2B2Order();
  boundedAppliedUid.line_items[0].applied_taxes[0].uid = "A".repeat(60);
  accepted(
    parseAdjustments(responseWithOrder(boundedAppliedUid)),
    "60-character applied relationship UID is accepted"
  );
  const opaqueAppliedUid = square.squarePhase2B2B2Order();
  opaqueAppliedUid.line_items[0].applied_taxes[0].uid =
    "applied/tax:+opaque=1";
  const opaqueAppliedResult = accepted(
    parseAdjustments(responseWithOrder(opaqueAppliedUid)),
    "contract-valid opaque applied UID punctuation is accepted"
  );
  equal(
    lineApplication(adjustmentItem(opaqueAppliedResult)).appliedTaxes.find(
      ({ taxUid }) =>
        taxUid === square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order
    ).uid,
    "applied/tax:+opaque=1",
    "opaque applied UID is retained exactly"
  );
  const overlongAppliedUid = square.squarePhase2B2B2Order();
  overlongAppliedUid.line_items[0].applied_taxes[0].uid = "A".repeat(61);
  rejected(
    parseAdjustments(responseWithOrder(overlongAppliedUid)),
    "overlong applied relationship UID rejects"
  );
  const emptyAppliedReference = square.squarePhase2B2B2Order();
  emptyAppliedReference.line_items[0].applied_taxes[0].tax_uid = "";
  rejected(
    parseAdjustments(responseWithOrder(emptyAppliedReference)),
    "empty required applied reference rejects"
  );
}

function testAppliedRelationshipsAndAuthority() {
  const response = accepted(
    parseAdjustments(clone(orderFixtures.retrieve)),
    "relationship fixture is accepted"
  );
  const detail = adjustmentItem(response);
  const knownTaxUids = new Set(detail.taxes.map(({ uid }) => uid));
  const knownDiscountUids = new Set(detail.discounts.map(({ uid }) => uid));
  const knownServiceChargeUids = new Set(
    detail.serviceCharges.map(({ uid }) => uid)
  );
  const appliedTaxUids = new Set();
  const appliedDiscountUids = new Set();
  const appliedServiceChargeUids = new Set();

  for (const applications of detail.lineItemApplications) {
    equal(
      applications.authority.orderId,
      detail.lineItemDetail.core.id,
      "line application authority binds its Order"
    );
    equal(
      applications.authority.lineItemUid,
      applications.lineItemUid,
      "line application authority binds its line item"
    );
    equal(
      applications.appliedTaxCount,
      applications.appliedTaxes.length,
      "applied-tax count is derived"
    );
    equal(
      applications.appliedDiscountCount,
      applications.appliedDiscounts.length,
      "applied-discount count is derived"
    );
    equal(
      applications.appliedServiceChargeCount,
      applications.appliedServiceCharges.length,
      "applied-service-charge count is derived"
    );
    for (const applied of applications.appliedTaxes) {
      equal(knownTaxUids.has(applied.taxUid), true, "applied tax resolves locally");
      equal(applied.authority.orderId, detail.lineItemDetail.core.id, "tax ref binds Order");
      equal(applied.authority.lineItemUid, applications.lineItemUid, "tax ref binds line");
      equal(applied.authority.taxUid, applied.taxUid, "tax ref authority binds target");
      if (applied.uid !== null) {
        equal(appliedTaxUids.has(applied.uid), false, "applied tax UID is unique");
        appliedTaxUids.add(applied.uid);
      }
    }
    for (const applied of applications.appliedDiscounts) {
      equal(
        knownDiscountUids.has(applied.discountUid),
        true,
        "applied discount resolves locally"
      );
      equal(applied.authority.orderId, detail.lineItemDetail.core.id, "discount ref binds Order");
      equal(applied.authority.lineItemUid, applications.lineItemUid, "discount ref binds line");
      equal(
        applied.authority.discountUid,
        applied.discountUid,
        "discount ref authority binds target"
      );
      if (applied.uid !== null) {
        equal(
          appliedDiscountUids.has(applied.uid),
          false,
          "applied discount UID is unique"
        );
        appliedDiscountUids.add(applied.uid);
      }
    }
    for (const applied of applications.appliedServiceCharges) {
      equal(
        knownServiceChargeUids.has(applied.serviceChargeUid),
        true,
        "applied service charge resolves locally"
      );
      equal(applied.authority.orderId, detail.lineItemDetail.core.id, "service ref binds Order");
      equal(applied.authority.lineItemUid, applications.lineItemUid, "service ref binds line");
      equal(
        applied.authority.serviceChargeUid,
        applied.serviceChargeUid,
        "service ref authority binds target"
      );
      if (applied.uid !== null) {
        equal(
          appliedServiceChargeUids.has(applied.uid),
          false,
          "applied service charge UID is unique"
        );
        appliedServiceChargeUids.add(applied.uid);
      }
    }
  }
  for (const owner of detail.serviceCharges) {
    for (const applied of owner.appliedTaxes) {
      equal(knownTaxUids.has(applied.taxUid), true, "service tax resolves locally");
      equal(applied.authority.orderId, detail.lineItemDetail.core.id, "service tax binds Order");
      equal(applied.authority.serviceChargeUid, owner.uid, "service tax binds service owner");
      equal(applied.authority.taxUid, applied.taxUid, "service tax binds target");
      if (applied.uid !== null) {
        equal(appliedTaxUids.has(applied.uid), false, "service applied-tax UID is unique");
        appliedTaxUids.add(applied.uid);
      }
    }
  }

  const optionalUid = square.squarePhase2B2B2Order();
  delete optionalUid.line_items[0].applied_taxes[0].uid;
  optionalUid.line_items[0].applied_discounts[0].uid = null;
  delete optionalUid.line_items[0].applied_service_charges[0].uid;
  const optionalUidResult = accepted(
    parseAdjustments(responseWithOrder(optionalUid)),
    "SDK-optional applied UIDs may be missing or null"
  );
  const optionalApplications = lineApplication(adjustmentItem(optionalUidResult));
  equal(
    optionalApplications.appliedTaxes.find(
      ({ taxUid }) => taxUid === square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order
    ).uid,
    null,
    "missing applied-tax UID normalizes null"
  );
  equal(
    optionalApplications.appliedDiscounts.find(
      ({ discountUid }) =>
        discountUid === square.SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.orderPercentage
    ).uid,
    null,
    "null applied-discount UID stays null"
  );
  equal(
    optionalApplications.appliedServiceCharges.find(
      ({ serviceChargeUid }) =>
        serviceChargeUid ===
        square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.subtotal
    ).uid,
    null,
    "missing applied-service-charge UID normalizes null"
  );

  const omittedGeneratedRelationships = square.squarePhase2B2B2Order();
  for (const lineItem of omittedGeneratedRelationships.line_items) {
    lineItem.applied_taxes = [];
    lineItem.applied_discounts = [];
    lineItem.applied_service_charges = [];
  }
  for (const item of omittedGeneratedRelationships.service_charges) {
    item.applied_taxes = [];
  }
  accepted(
    parseAdjustments(responseWithOrder(omittedGeneratedRelationships)),
    "ORDER and LINE_ITEM scope records do not require response relationships"
  );

  for (const [collection, codeLabel] of [
    ["taxes", "tax"],
    ["discounts", "discount"],
    ["service_charges", "service charge"]
  ]) {
    const order = square.squarePhase2B2B2Order();
    order[collection].push(clone(order[collection][0]));
    rejected(
      parseAdjustments(responseWithOrder(order)),
      `duplicate ${codeLabel} authority is ambiguous and rejects`
    );
  }

  for (const [collection, targetField, label] of [
    ["applied_taxes", "tax_uid", "tax"],
    ["applied_discounts", "discount_uid", "discount"],
    ["applied_service_charges", "service_charge_uid", "service charge"]
  ]) {
    const missing = square.squarePhase2B2B2Order();
    delete missing.line_items[0][collection][0][targetField];
    rejected(
      parseAdjustments(responseWithOrder(missing)),
      `missing applied ${label} target rejects`
    );

    const nullTarget = square.squarePhase2B2B2Order();
    nullTarget.line_items[0][collection][0][targetField] = null;
    rejected(
      parseAdjustments(responseWithOrder(nullTarget)),
      `null applied ${label} target rejects`
    );

    const dangling = square.squarePhase2B2B2Order();
    dangling.line_items[0][collection][0][targetField] = `SQ2B2B2DANGLING${label.length}`;
    rejected(
      parseAdjustments(responseWithOrder(dangling)),
      `dangling applied ${label} target rejects`
    );

    const duplicate = square.squarePhase2B2B2Order();
    const copied = clone(duplicate.line_items[0][collection][0]);
    copied.uid = `SQ2B2B2DUP${label.length}`;
    duplicate.line_items[0][collection].push(copied);
    rejected(
      parseAdjustments(responseWithOrder(duplicate)),
      `duplicate applied ${label} reference on one owner rejects`
    );
  }

  const missingServiceTax = square.squarePhase2B2B2Order();
  delete missingServiceTax.service_charges[0].applied_taxes[0].tax_uid;
  rejected(
    parseAdjustments(responseWithOrder(missingServiceTax)),
    "missing service-charge applied-tax target rejects"
  );
  const danglingServiceTax = square.squarePhase2B2B2Order();
  danglingServiceTax.service_charges[0].applied_taxes[0].tax_uid =
    "SQ2B2B2DANGLINGSCTAX";
  rejected(
    parseAdjustments(responseWithOrder(danglingServiceTax)),
    "dangling service-charge applied-tax target rejects"
  );
  const duplicateServiceTax = square.squarePhase2B2B2Order();
  duplicateServiceTax.service_charges[0].applied_taxes.push({
    ...clone(duplicateServiceTax.service_charges[0].applied_taxes[0]),
    uid: "SQ2B2B2DUPSCTAX"
  });
  rejected(
    parseAdjustments(responseWithOrder(duplicateServiceTax)),
    "duplicate service-charge applied-tax target rejects"
  );

  for (const [collection, secondIndex, label] of [
    ["applied_taxes", 0, "tax"],
    ["applied_discounts", 0, "discount"],
    ["applied_service_charges", 0, "service charge"]
  ]) {
    const duplicateUid = square.squarePhase2B2B2Order();
    duplicateUid.line_items[1][collection][secondIndex].uid =
      duplicateUid.line_items[0][collection][0].uid;
    rejected(
      parseAdjustments(responseWithOrder(duplicateUid)),
      `duplicate Order-scoped applied ${label} UID rejects`
    );
  }
  const duplicateTaxAcrossOwnerTypes = square.squarePhase2B2B2Order();
  duplicateTaxAcrossOwnerTypes.service_charges[0].applied_taxes[0].uid =
    duplicateTaxAcrossOwnerTypes.line_items[0].applied_taxes[0].uid;
  rejected(
    parseAdjustments(responseWithOrder(duplicateTaxAcrossOwnerTypes)),
    "applied-tax UIDs remain unique across line and service owners"
  );

  const secondDiscountUid = "SQ2B2B2DISCCROSS";
  const secondServiceUid = "SQ2B2B2SVCCROSS";
  const secondOrder = square.squarePhase2B2B2SecondOrder({
    discounts: [
      square.squarePhase2B2B2Discount({
        uid: secondDiscountUid,
        catalog_object_id: null,
        catalog_version: null,
        type: "FIXED_AMOUNT",
        percentage: null,
        amount_money: { amount: 0, currency: "CAD" },
        applied_money: { amount: 0, currency: "CAD" }
      })
    ],
    service_charges: [
      square.squarePhase2B2B2ServiceCharge({
        uid: secondServiceUid,
        catalog_object_id: null,
        catalog_version: null,
        percentage: null,
        amount_money: { amount: 0, currency: "CAD" },
        applied_money: { amount: 0, currency: "CAD" },
        total_money: { amount: 0, currency: "CAD" },
        total_tax_money: null,
        taxable: false,
        applied_taxes: []
      })
    ]
  });
  for (const [collection, targetField, targetUid, label] of [
    ["applied_taxes", "tax_uid", square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.secondOrder, "tax"],
    ["applied_discounts", "discount_uid", secondDiscountUid, "discount"],
    ["applied_service_charges", "service_charge_uid", secondServiceUid, "service charge"]
  ]) {
    const primaryOrder = square.squarePhase2B2B2Order();
    primaryOrder.line_items[0][collection][0][targetField] = targetUid;
    rejected(
      parseAdjustments(
        { orders: [primaryOrder, clone(secondOrder)] },
        "orders_batch_retrieve"
      ),
      `cross-Order applied ${label} target rejects`
    );
  }
}

function testExactNumbersMoneyAndCurrencies() {
  const baseline = accepted(
    parseAdjustments(clone(orderFixtures.retrieve)),
    "exact-number baseline is accepted"
  );
  const baselineDetail = adjustmentItem(baseline);
  const explicitZero = serviceCharge(
    baselineDetail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.apportionedAmount
  ).totalTaxMoney;
  const presentEmpty = serviceCharge(
    baselineDetail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.total
  ).totalTaxMoney;
  const absent = serviceCharge(
    baselineDetail,
    square.SQUARE_PHASE_2B2B2_SYNTHETIC_SERVICE_CHARGE_IDS.apportionedPercentage
  ).totalTaxMoney;
  deepEqual(explicitZero, { amountMinor: "0", currency: "USD" }, "explicit zero is exact");
  deepEqual(
    presentEmpty,
    { amountMinor: null, currency: null },
    "present empty Money retains presence"
  );
  equal(absent, null, "absent Money remains absent");
  notEqual(
    JSON.stringify(explicitZero),
    JSON.stringify(presentEmpty),
    "explicit zero and empty Money remain distinct"
  );
  notEqual(
    JSON.stringify(presentEmpty),
    JSON.stringify(absent),
    "empty and absent Money remain distinct"
  );

  for (const percentage of ["-999999999", "0.00000001", "9999999999"]) {
    const order = square.squarePhase2B2B2Order();
    order.taxes[0].percentage = percentage;
    const value = accepted(
      parseAdjustments(responseWithOrder(order)),
      "signed or high-precision percentage inside the documented bound is accepted"
    );
    equal(tax(adjustmentItem(value)).percentage, percentage, "percentage text stays exact");
  }
  const trailingZeros = square.squarePhase2B2B2Order();
  trailingZeros.taxes[0].percentage = "7.2500";
  const canonicalTrailing = tax(
    adjustmentItem(
      accepted(
        parseAdjustments(responseWithOrder(trailingZeros)),
        "canonicalizable trailing zeros are accepted"
      )
    )
  );
  equal(canonicalTrailing.percentage, "7.25", "nonmeaningful percentage zeros are removed");

  for (const invalid of [
    1,
    "",
    " 1",
    "1 ",
    "+1",
    "01",
    ".5",
    "1.",
    "1e2",
    "1%",
    "-0",
    "-0.0",
    "12345678901",
    [],
    {}
  ]) {
    const order = square.squarePhase2B2B2Order();
    order.taxes[0].percentage = invalid;
    rejected(
      parseAdjustments(responseWithOrder(order)),
      "malformed or overlong percentage fails closed"
    );
  }

  const discountPercentageInvalid = orderWithSingleDiscount({
    percentage: "1e2"
  });
  rejected(
    parseAdjustments(responseWithOrder(discountPercentageInvalid)),
    "discount percentage uses the same exact decimal boundary"
  );
  const servicePercentageInvalid = orderWithSingleServiceCharge({
    percentage: "1e2"
  });
  rejected(
    parseAdjustments(responseWithOrder(servicePercentageInvalid)),
    "service-charge percentage uses the same exact decimal boundary"
  );

  for (const invalidMoney of [
    { amount: 1.5, currency: "USD" },
    { amount: "1", currency: "USD" },
    { amount: "1e2", currency: "USD" },
    { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    { amount: -0, currency: "USD" },
    { amount: 1, currency: "NOT" },
    [],
    "100"
  ]) {
    const order = square.squarePhase2B2B2Order();
    order.taxes[0].applied_money = invalidMoney;
    rejected(
      parseAdjustments(responseWithOrder(order)),
      "unsafe adjustment Money representation fails closed"
    );
  }

  for (const mutate of [
    (order) => { order.taxes[0].applied_money.currency = "EUR"; },
    (order) => { order.discounts[0].amount_money = { amount: 1, currency: "EUR" }; },
    (order) => { order.service_charges[0].applied_money.currency = "EUR"; },
    (order) => { order.service_charges[0].applied_taxes[0].applied_money.currency = "EUR"; },
    (order) => { order.line_items[0].applied_taxes[0].applied_money.currency = "EUR"; },
    (order) => { order.line_items[0].applied_discounts[0].applied_money.currency = "EUR"; },
    (order) => { order.line_items[0].applied_service_charges[0].applied_money.currency = "EUR"; }
  ]) {
    const order = square.squarePhase2B2B2Order();
    mutate(order);
    rejected(
      parseAdjustments(responseWithOrder(order)),
      "currency conflict across composed Order facts fails closed"
    );
  }

  const noArithmetic = square.squarePhase2B2B2Order();
  noArithmetic.taxes[0].applied_money.amount = -999;
  noArithmetic.discounts[0].applied_money.amount = 777;
  noArithmetic.service_charges[0].total_money.amount = -555;
  noArithmetic.line_items[0].applied_taxes[0].applied_money.amount = 333;
  accepted(
    parseAdjustments(responseWithOrder(noArithmetic)),
    "provider-returned allocations are not recomputed or given invented signs"
  );

  const serialized = JSON.stringify(baselineDetail);
  doesNotMatch(
    serialized,
    /"(?:amountMinor|percentage)":-?\d+(?:\.\d+)?(?:[,}])/,
    "trusted Money and percentages never become floating-point numbers"
  );
}

function reverseAllAdjustmentArrays(order) {
  order.taxes.reverse();
  order.discounts.reverse();
  order.service_charges.reverse();
  order.line_items.reverse();
  for (const lineItem of order.line_items) {
    lineItem.applied_taxes?.reverse();
    lineItem.applied_discounts?.reverse();
    lineItem.applied_service_charges?.reverse();
  }
  for (const item of order.service_charges) item.applied_taxes?.reverse();
  return order;
}

function testDeterminismMinimizationAndFingerprints() {
  const baselineResponse = accepted(
    parseAdjustments(clone(orderFixtures.retrieve)),
    "fingerprint baseline is accepted"
  );
  const baselineDetail = adjustmentItem(baselineResponse);
  sampleDetailFingerprint = square.squareOrderAdjustmentDetailFingerprint(
    baselineDetail
  );
  sampleResponseFingerprint = square.squareOrderAdjustmentResponseFingerprint(
    baselineResponse
  );
  assertFingerprint(sampleDetailFingerprint, "Order adjustment detail fingerprint");
  assertFingerprint(sampleResponseFingerprint, "Order adjustment response fingerprint");
  equal(
    sampleDetailFingerprint,
    EXPECTED_ORDER_ADJUSTMENT_DETAIL_FINGERPRINT,
    "sample Order adjustment detail fingerprint is pinned"
  );
  equal(
    sampleResponseFingerprint,
    EXPECTED_ORDER_ADJUSTMENT_RESPONSE_FINGERPRINT,
    "sample Order adjustment response fingerprint is pinned"
  );
  equal(
    square.squareOrderAdjustmentDetailFingerprint(baselineDetail),
    sampleDetailFingerprint,
    "detail fingerprint is repeatable"
  );
  equal(
    square.squareOrderAdjustmentResponseFingerprint(baselineResponse),
    sampleResponseFingerprint,
    "response fingerprint is repeatable"
  );

  const reversedResponse = accepted(
    parseAdjustments(
      responseWithOrder(reverseAllAdjustmentArrays(square.squarePhase2B2B2Order()))
    ),
    "provider-reordered adjustment arrays are accepted"
  );
  deepEqual(
    reversedResponse,
    baselineResponse,
    "all trusted adjustment and relationship arrays are canonically ordered"
  );
  equal(
    square.squareOrderAdjustmentResponseFingerprint(reversedResponse),
    sampleResponseFingerprint,
    "provider ordering is fingerprint-neutral"
  );

  const serviceTaxOrder = square.squarePhase2B2B2Order();
  serviceTaxOrder.service_charges[0].applied_taxes.push({
    uid: "SQ2B2B2SCTAXAPP003",
    tax_uid: square.SQUARE_PHASE_2B2B2_SYNTHETIC_TAX_IDS.order,
    applied_money: { amount: 1, currency: "USD" },
    auto_applied: true
  });
  const orderedServiceTaxes = accepted(
    parseAdjustments(responseWithOrder(clone(serviceTaxOrder))),
    "multi-tax service charge is accepted"
  );
  serviceTaxOrder.service_charges[0].applied_taxes.reverse();
  const reversedServiceTaxes = accepted(
    parseAdjustments(responseWithOrder(serviceTaxOrder)),
    "reordered service-charge taxes are accepted"
  );
  deepEqual(
    reversedServiceTaxes,
    orderedServiceTaxes,
    "service-charge applied taxes are deterministically ordered"
  );

  const excluded = square.squarePhase2B2B2Order();
  excluded.taxes[0].metadata = { changed: "excluded-tax-change" };
  excluded.discounts[0].metadata = { changed: "excluded-discount-change" };
  excluded.discounts[0].reward_ids = ["excluded-reward-change"];
  excluded.discounts[0].pricing_rule_id = "excluded-pricing-rule-change";
  excluded.service_charges[0].metadata = { changed: "excluded-service-change" };
  excluded.taxes[0].future_provider_field = { bounded: "future-tax-change" };
  excluded.discounts[0].future_provider_field = ["future-discount-change"];
  excluded.service_charges[0].future_provider_field = false;
  excluded.line_items[0].applied_taxes[0].future_provider_field = "future-applied-change";
  excluded.customer_id = "SQ2B2B2EXCLUDEDCUSTOMER";
  excluded.fulfillments = [{ uid: "SQ2B2B2EXCLUDEDFULFILLMENT" }];
  excluded.returns = [{ uid: "SQ2B2B2EXCLUDEDRETURN" }];
  excluded.tenders = [{ id: "SQ2B2B2EXCLUDEDTENDER" }];
  excluded.refunds = [{ id: "SQ2B2B2EXCLUDEDREFUND" }];
  const excludedResponse = accepted(
    parseAdjustments(responseWithOrder(excluded)),
    "bounded excluded and future adjustment fields are accepted"
  );
  equal(
    square.squareOrderAdjustmentDetailFingerprint(adjustmentItem(excludedResponse)),
    sampleDetailFingerprint,
    "excluded and future fields are fingerprint-neutral"
  );
  assertProjectionMinimized(excludedResponse, "excluded-field mutation");

  const trustedMutations = [
    ["tax type", (order) => { order.taxes[0].type = "INCLUSIVE"; }],
    ["tax percentage", (order) => { order.taxes[0].percentage = "8.26"; }],
    ["discount applied Money", (order) => { order.discounts[0].applied_money.amount = -51; }],
    ["service phase", (order) => { order.service_charges[0].calculation_phase = null; }],
    ["service total Money", (order) => { order.service_charges[0].total_money.amount = 23; }],
    ["line tax allocation", (order) => { order.line_items[0].applied_taxes[0].applied_money.amount = 45; }],
    ["line discount target", (order) => {
      order.line_items[0].applied_discounts[0].discount_uid =
        square.SQUARE_PHASE_2B2B2_SYNTHETIC_DISCOUNT_IDS.catalogAmount;
    }],
    ["line service allocation", (order) => { order.line_items[0].applied_service_charges[0].applied_money.amount = 21; }]
  ];
  for (const [label, mutate] of trustedMutations) {
    const order = square.squarePhase2B2B2Order();
    mutate(order);
    const changedResponse = accepted(
      parseAdjustments(responseWithOrder(order)),
      `${label} mutation is accepted`
    );
    notEqual(
      square.squareOrderAdjustmentDetailFingerprint(adjustmentItem(changedResponse)),
      sampleDetailFingerprint,
      `${label} changes the adjustment fingerprint`
    );
    const lineResponse = accepted(
      parseLineItems(responseWithOrder(clone(order))),
      `${label} remains accepted by prior line-item projection`
    );
    equal(
      square.squareOrderLineItemDetailFingerprint(lineResponse.items[0]),
      EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT,
      `${label} remains neutral to the Phase 2B.2B-1 fingerprint`
    );
  }

  const baselineLine = accepted(
    parseLineItems(clone(orderFixtures.retrieve)),
    "baseline line-item response is accepted"
  );
  const baselineCore = accepted(
    parseCore(clone(orderFixtures.retrieve)),
    "baseline core response is accepted"
  );
  equal(
    square.squareOrderLineItemDetailFingerprint(baselineLine.items[0]),
    EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT,
    "Phase 2B.2B-1 detail fingerprint remains byte-for-byte pinned"
  );
  equal(
    square.squareOrderLineItemResponseFingerprint(baselineLine),
    EXPECTED_ORDER_LINE_ITEM_RESPONSE_FINGERPRINT,
    "Phase 2B.2B-1 response fingerprint remains byte-for-byte pinned"
  );
  equal(
    square.squareOrderCoreFingerprint(baselineCore.items[0]),
    EXPECTED_ORDER_CORE_ENTITY_FINGERPRINT,
    "Phase 2B.2A entity fingerprint remains byte-for-byte pinned"
  );
  equal(
    square.squareOrderCoreResponseFingerprint(baselineCore),
    EXPECTED_ORDER_CORE_RESPONSE_FINGERPRINT,
    "Phase 2B.2A response fingerprint remains byte-for-byte pinned"
  );

  const searchBaseline = accepted(
    parseAdjustments(clone(orderFixtures.search), "orders_search"),
    "Search fingerprint baseline is accepted"
  );
  const changedCursorFixture = clone(orderFixtures.search);
  changedCursorFixture.cursor = "sq2b2b2OpaqueCursorChanged==";
  const changedCursor = accepted(
    parseAdjustments(changedCursorFixture, "orders_search"),
    "changed opaque Search cursor is accepted"
  );
  deepEqual(
    changedCursor.items,
    searchBaseline.items,
    "cursor remains outside every entity adjustment projection"
  );
  notEqual(
    square.squareOrderAdjustmentResponseFingerprint(changedCursor),
    square.squareOrderAdjustmentResponseFingerprint(searchBaseline),
    "cursor binding changes only the response fingerprint"
  );

  const reversedOrders = clone(orderFixtures.search);
  reversedOrders.orders.reverse();
  const reorderedSearch = accepted(
    parseAdjustments(reversedOrders, "orders_search"),
    "provider-reordered Search Orders are accepted"
  );
  deepEqual(reorderedSearch, searchBaseline, "Order ordering is deterministic");
}

function testEnvelopeFailuresAndStructuralSafety() {
  rejected(
    parseAdjustments({}),
    "Retrieve response without order or provider error fails closed"
  );
  rejected(
    parseAdjustments({ order: null }),
    "Retrieve response with null order or no provider error fails closed"
  );
  unsupported(
    parseAdjustments({ errors: [{ code: "NOT_FOUND" }] }),
    "provider error envelope is never trusted"
  );
  unsupported(
    parseAdjustments({
      errors: [{ code: "INTERNAL_ERROR" }],
      order: square.squarePhase2B2B2Order()
    }),
    "provider error and data mixture cannot produce trusted data"
  );
  unsupported(
    parseAdjustments(
      {
        errors: [{ code: "INTERNAL_ERROR" }],
        orders: [square.squarePhase2B2B2Order()]
      },
      "orders_search"
    ),
    "Search provider error and data mixture cannot produce trusted data"
  );
  for (const value of [[], {}, "entries", 1, false]) {
    const result = parseAdjustments(
      { orders: [square.squarePhase2B2B2Order()], order_entries: value },
      "orders_search"
    );
    equal(
      result.outcome === "rejected" || result.outcome === "unsupported",
      true,
      "every non-null order_entries representation fails closed"
    );
  }
  for (const value of [undefined, null]) {
    const response = { orders: [square.squarePhase2B2B2Order()] };
    if (value !== undefined) response.order_entries = value;
    accepted(
      parseAdjustments(response, "orders_search"),
      "missing or null order_entries remains absent"
    );
  }

  rejected(
    parseAdjustments({ orders: {} }, "orders_batch_retrieve"),
    "malformed Batch orders rejects"
  );
  rejected(
    parseAdjustments({ orders: {} }, "orders_search"),
    "malformed Search orders rejects"
  );
  for (const [operation, response] of [
    ["orders_batch_retrieve", {}],
    ["orders_batch_retrieve", { orders: null }],
    ["orders_batch_retrieve", { orders: [] }],
    ["orders_search", {}],
    ["orders_search", { orders: null }],
    ["orders_search", { orders: [] }]
  ]) {
    const value = accepted(
      parseAdjustments(response, operation),
      `${operation} optional empty orders shape is accepted`
    );
    deepEqual(value.items, [], `${operation} empty shape normalizes to no items`);
  }

  let accessorCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "sq2b2b2-provider-secret";
    }
  });
  const cycle = {};
  cycle.self = cycle;
  const polluted = {};
  Object.defineProperty(polluted, "__proto__", {
    enumerable: true,
    value: { polluted: true }
  });
  const sparse = [];
  sparse.length = 2;
  sparse[1] = "x";
  const customArray = [];
  customArray.extra = true;
  const symbolObject = { [Symbol("provider")]: "hidden" };
  const oversizedObject = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`k${index}`, index])
  );
  let deep = { value: true };
  for (let index = 0; index < 14; index += 1) deep = { nested: deep };
  const structuralAttacks = [
    accessor,
    Object.create({ inherited: true }),
    cycle,
    polluted,
    sparse,
    customArray,
    symbolObject,
    oversizedObject,
    deep,
    "x".repeat(4_097),
    Number.MAX_SAFE_INTEGER + 1,
    -0
  ];
  for (const attack of structuralAttacks) {
    const order = square.squarePhase2B2B2Order();
    order.discounts[0].metadata = { attack };
    rejected(
      parseAdjustments(responseWithOrder(order)),
      "hostile structure in an excluded field fails before minimization"
    );
  }
  equal(accessorCalls, 0, "provider accessor is never invoked");

  const oversizedArray = square.squarePhase2B2B2Order();
  oversizedArray.taxes = Array.from({ length: 1_001 }, () => ({}));
  rejected(
    parseAdjustments(responseWithOrder(oversizedArray)),
    "oversized adjustment array rejects within the safety bound"
  );

  const providerKeyOrder = square.squarePhase2B2B2Order();
  providerKeyOrder.taxes[0]["sq2b2b2-attacker-key"] = "x".repeat(4_097);
  const providerKeyResult = parseAdjustments(responseWithOrder(providerKeyOrder));
  rejected(providerKeyResult, "provider-controlled unknown key attack rejects");
  equal(
    providerKeyResult.diagnostics[0].field,
    "$response",
    "provider-controlled key cannot enter the diagnostic path"
  );

  rejected(
    parseAdjustmentInput({ ...parserInput({}), unknown_input: true }),
    "unknown caller input key rejects"
  );
  incompatible(
    parseAdjustmentInput(
      parserInput({}, "retrieve_order", { apiVersion: "2026-07-15" })
    ),
    "unreviewed API version is incompatible"
  );
}

function testExceptionContainedResultBoundary() {
  const throwingInput = new Proxy(parserInput({}), {
    ownKeys() {
      throw new Error("sq2b2b2-provider-secret");
    }
  });
  assertInternalRejection(
    parseAdjustmentInput(throwingInput),
    "raw parser exception is contained"
  );

  const hostileThrownValue = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("sq2b2b2-provider-secret");
    }
  });
  const doubleFaultInput = new Proxy(parserInput({}), {
    ownKeys() {
      throw hostileThrownValue;
    }
  });
  assertInternalRejection(
    parseAdjustmentInput(doubleFaultInput),
    "exception-classification double fault is contained"
  );

  const originalFailureResult = squareResponseValidation.squareFailureResult;
  const originalUnsupportedResult =
    squareResponseValidation.squareUnsupportedResult;
  try {
    squareResponseValidation.squareFailureResult = () => {
      throw new Error("sq2b2b2-provider-secret");
    };
    assertInternalRejection(
      parseAdjustmentInput(null),
      "failure factory exception is contained"
    );

    squareResponseValidation.squareFailureResult = () =>
      new Proxy(
        { outcome: "rejected", diagnostics: [] },
        {
          getOwnPropertyDescriptor(target, key) {
            if (key === "diagnostics") {
              throw new Error("sq2b2b2-provider-secret");
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          }
        }
      );
    assertInternalRejection(
      parseAdjustmentInput(null),
      "sanitizer exception is contained"
    );

    squareResponseValidation.squareFailureResult = () => ({
      outcome: "rejected",
      diagnostics: [
        {
          code: "sq2b2b2-provider-secret",
          field: "$response.sq2b2b2-attacker-key"
        }
      ]
    });
    assertInternalRejection(
      parseAdjustmentInput(null),
      "malformed hostile diagnostic object fails closed"
    );

    squareResponseValidation.squareFailureResult = () => ({
      outcome: "future-provider-outcome",
      diagnostics: [
        {
          code: "square_response_internal_rejection",
          field: "$response"
        }
      ]
    });
    assertInternalRejection(
      parseAdjustmentInput(null),
      "future undeclared outcome cannot bypass sanitation"
    );

    squareResponseValidation.squareFailureResult = originalFailureResult;
    squareResponseValidation.squareUnsupportedResult = () => {
      throw new Error("sq2b2b2-provider-secret");
    };
    assertInternalRejection(
      parseAdjustments({ errors: [{ code: "NOT_FOUND" }] }),
      "unsupported factory exception is contained"
    );
  } finally {
    squareResponseValidation.squareFailureResult = originalFailureResult;
    squareResponseValidation.squareUnsupportedResult = originalUnsupportedResult;
  }

  const originalAcceptedResult = squareResponseValidation.squareAcceptedResult;
  try {
    squareResponseValidation.squareAcceptedResult = (value) =>
      Object.freeze({
        outcome: "accepted",
        value,
        diagnostics: Object.freeze([
          Object.freeze({
            code: "sq2b2b2-provider-secret",
            field: "$response.sq2b2b2-attacker-key"
          })
        ])
      });
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "forged accepted result cannot carry diagnostics"
    );

    squareResponseValidation.squareAcceptedResult = (value) =>
      Object.freeze({
        outcome: "accepted",
        value,
        diagnostics: Object.freeze([])
      });
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "mutable nested accepted adjustment value is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      value.items.providerPayload = "sq2b2b2-provider-secret";
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "frozen accepted array with a custom property is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      Object.defineProperty(value.items[0], "providerPayload", {
        configurable: true,
        enumerable: false,
        value: "sq2b2b2-provider-secret",
        writable: true
      });
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "frozen accepted object with a hidden property is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      value.items[0][Symbol("providerPayload")] =
        "sq2b2b2-provider-secret";
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "frozen accepted object with a symbol property is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      Object.setPrototypeOf(value.items[0].taxes[0], {
        providerPayload: "sq2b2b2-provider-secret"
      });
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "frozen accepted object with a custom prototype is rejected"
    );

    squareResponseValidation.squareAcceptedResult = () =>
      Object.freeze({
        outcome: "accepted",
        value: Object.freeze({
          entityType: "forged",
          providerPayload: "sq2b2b2-provider-secret"
        }),
        diagnostics: Object.freeze([])
      });
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "schema-invalid accepted value is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      value.items[0].taxes[0].name =
        "<script>sq2b2b2-provider-secret</script>";
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "deeply frozen accepted value with unsafe text is rejected"
    );

    squareResponseValidation.squareAcceptedResult = () => {
      throw new Error("sq2b2b2-provider-secret");
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "accepted-result factory exception becomes static rejection"
    );

    squareResponseValidation.squareFailureResult = () => {
      throw new Error("sq2b2b2-provider-secret");
    };
    assertInternalRejection(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "accepted and failure factory double fault is contained"
    );
  } finally {
    squareResponseValidation.squareAcceptedResult = originalAcceptedResult;
    squareResponseValidation.squareFailureResult = originalFailureResult;
  }

  let legitimateResult;
  try {
    squareResponseValidation.squareAcceptedResult = (value) => {
      legitimateResult = originalAcceptedResult(value);
      return legitimateResult;
    };
    const returned = parseAdjustments(clone(orderFixtures.retrieve));
    equal(
      returned,
      legitimateResult,
      "legitimate deeply frozen accepted result crosses unchanged"
    );
    assertDeeplyFrozen(returned, "legitimate accepted adjustment result");
  } finally {
    squareResponseValidation.squareAcceptedResult = originalAcceptedResult;
  }
}

function testDeepFreezeAndCallerIsolation() {
  const mutableResponse = clone(orderFixtures.retrieve);
  const parsed = parseAdjustments(mutableResponse);
  const value = accepted(parsed, "deep-freeze fixture is accepted");
  assertDeeplyFrozen(parsed, "accepted adjustment parser result");
  const detail = adjustmentItem(value);
  const applications = lineApplication(detail);
  const snapshot = JSON.stringify(value);

  for (const mutate of [
    () => value.items.push(detail),
    () => Object.defineProperty(value.provider, "apiVersion", { value: "changed" }),
    () => Object.defineProperty(detail.lineItemDetail.core, "state", { value: "OPEN" }),
    () => Object.defineProperty(detail.taxes[0], "percentage", { value: "999" }),
    () => Object.defineProperty(detail.taxes[0].authority, "taxUid", { value: "changed" }),
    () => Object.defineProperty(detail.discounts[0].appliedMoney, "amountMinor", { value: "999" }),
    () => { detail.serviceCharges[0].appliedTaxes.push(detail.serviceCharges[0].appliedTaxes[0]); },
    () => Object.defineProperty(applications.appliedTaxes[0], "taxUid", { value: "changed" }),
    () => Object.defineProperty(applications.appliedDiscounts, "length", { value: 0 }),
    () => Object.defineProperty(
      applications.appliedServiceCharges[0].appliedMoney,
      "currency",
      { value: "EUR" }
    )
  ]) {
    throws(
      mutate,
      /Cannot|read only|extensible|frozen/i,
      "trusted adjustment tree resists mutation"
    );
  }
  equal(JSON.stringify(value), snapshot, "mutation attempts leave result unchanged");

  mutableResponse.order.taxes[0].percentage = "99";
  mutableResponse.order.discounts[0].name = "Caller mutation";
  mutableResponse.order.line_items[0].applied_taxes[0].tax_uid = "CHANGED";
  equal(
    JSON.stringify(value),
    snapshot,
    "caller mutation cannot alter accepted minimized adjustment data"
  );
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
  const validator =
    square.SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS[
      operationPolicy.providerReadOnlyPostValidatorRegistryKey(operation)
    ];
  return validator({
    operation,
    queryParameters: [],
    body,
    rawBodyByteLength: Buffer.byteLength(JSON.stringify(body), "utf8")
  });
}

function testPinnedContractsDormancyAndRegistration() {
  const omittedBody = ordersSearchRequestBody();
  const falseBody = ordersSearchRequestBody({ return_entries: false });
  const omitted = normalizedOrdersSearch(omittedBody);
  const explicitFalse = normalizedOrdersSearch(falseBody);
  deepEqual(
    omitted.normalizedBody,
    explicitFalse.normalizedBody,
    "Orders Search omission and false remain canonically identical"
  );
  equal(
    omitted.normalizedBody.return_entries,
    false,
    "Orders Search remains frozen to complete Order responses"
  );
  const omittedDecision = ordersSearchDecision(omittedBody);
  const falseDecision = ordersSearchDecision(falseBody);
  equal(
    omittedDecision.requestFingerprint,
    falseDecision.requestFingerprint,
    "Orders Search omission and false fingerprints remain identical"
  );
  equal(
    omittedDecision.requestFingerprint,
    EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT,
    "Orders Search request fingerprint remains pinned"
  );
  equal(
    omittedDecision.cursorBindingFingerprint,
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT,
    "Orders Search cursor binding remains pinned"
  );
  const continuation = ordersSearchDecision(
    ordersSearchRequestBody({ cursor: "phase2b2b2-cursor-canary" }),
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT
  );
  equal(
    continuation.cursorBindingFingerprint,
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT,
    "cursor continuation retains the complete-Order binding"
  );
  throws(
    () => ordersSearchDecision(ordersSearchRequestBody({ return_entries: true })),
    /square_read_operation_denied/,
    "return_entries true remains unreachable"
  );

  const descriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  equal(
    descriptorRegistry.descriptors[0].descriptorFingerprint,
    EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT,
    "Square descriptor fingerprint is unchanged"
  );
  const qboRegistry = controlPlane.assertProviderDescriptorRegistry(
    qbo.QBO_PHASE_7_PROVIDER_REGISTRY
  );
  const qboEntry = qboRegistry.descriptors.find(
    (entry) => entry.descriptor.providerKey === "quickbooks_online"
  );
  ok(qboEntry, "QBO descriptor remains present");
  equal(
    qboEntry.descriptorFingerprint,
    EXPECTED_QBO_DESCRIPTOR_FINGERPRINT,
    "QBO descriptor fingerprint is unchanged"
  );
  equal(
    qboRegistry.registryFingerprint,
    EXPECTED_ACTIVE_REGISTRY_FINGERPRINT,
    "active registry fingerprint is unchanged"
  );
  equal(
    registeredProviders.REGISTERED_PROVIDER_REGISTRY.registryFingerprint,
    EXPECTED_ACTIVE_REGISTRY_FINGERPRINT,
    "registered provider fingerprint is unchanged"
  );
  deepEqual(
    qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist,
    ["GET"],
    "QBO remains GET-only"
  );
  throws(
    () =>
      controlPlane.providerDescriptor(
        "square",
        "sandbox",
        registeredProviders.REGISTERED_PROVIDER_REGISTRY
      ),
    /provider_descriptor_not_registered/,
    "Square remains unreachable from the active registry"
  );
  throws(
    () =>
      credentials.providerOAuthPolicy(
        credentials.createProviderOAuthPolicyRegistry([
          qboOAuth.QBO_PHASE_8B_OAUTH_POLICY,
          qboOAuth.QBO_PRODUCTION_OAUTH_POLICY
        ]),
        "square",
        "sandbox"
      ),
    /provider_oauth_policy_not_registered/,
    "Square OAuth remains unregistered"
  );

  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "adjustment validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "reviewed API version is pinned");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_VERSION, "45.1.0", "SDK version is pinned");
  equal(
    square.SQUARE_ORDER_RESPONSE_SDK_REVISION,
    "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76",
    "SDK revision is pinned"
  );
  equal(
    square.SQUARE_ORDER_ADJUSTMENT_RESPONSE_CONTRACT_VERSION,
    "square_order_adjustment_response_v1",
    "adjustment response contract is separately versioned"
  );
  equal(
    square.SQUARE_ORDER_ADJUSTMENT_MINIMIZATION_VERSION,
    "square_order_adjustment_minimizer_v1",
    "adjustment minimizer is separately versioned"
  );
  equal(square.SQUARE_ORDER_ADJUSTMENT_ENTITY_VERSION, 1, "entity version is explicit");

  deepEqual(
    square.SQUARE_ORDER_TAX_TRUSTED_RESPONSE_FIELDS,
    [
      "uid",
      "catalog_object_id",
      "catalog_version",
      "name",
      "type",
      "percentage",
      "applied_money",
      "scope",
      "auto_applied"
    ],
    "trusted tax field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_DISCOUNT_TRUSTED_RESPONSE_FIELDS,
    [
      "uid",
      "catalog_object_id",
      "catalog_version",
      "name",
      "type",
      "percentage",
      "amount_money",
      "applied_money",
      "scope"
    ],
    "trusted discount field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_DISCOUNT_DISCARDED_RESPONSE_FIELDS,
    ["metadata", "reward_ids", "pricing_rule_id"],
    "loyalty and pricing-rule discount fields are explicitly discarded"
  );
  deepEqual(
    square.SQUARE_ORDER_SERVICE_CHARGE_TRUSTED_RESPONSE_FIELDS,
    [
      "uid",
      "name",
      "catalog_object_id",
      "catalog_version",
      "percentage",
      "amount_money",
      "applied_money",
      "total_money",
      "total_tax_money",
      "calculation_phase",
      "taxable",
      "applied_taxes",
      "type",
      "treatment_type",
      "scope"
    ],
    "trusted service-charge field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_SERVICE_CHARGE_DISCARDED_RESPONSE_FIELDS,
    ["metadata"],
    "service-charge metadata is explicitly discarded"
  );
  deepEqual(
    square.SQUARE_ORDER_APPLIED_TAX_TRUSTED_RESPONSE_FIELDS,
    ["uid", "tax_uid", "applied_money", "auto_applied"],
    "applied-tax field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_APPLIED_DISCOUNT_TRUSTED_RESPONSE_FIELDS,
    ["uid", "discount_uid", "applied_money"],
    "applied-discount field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_APPLIED_SERVICE_CHARGE_TRUSTED_RESPONSE_FIELDS,
    ["uid", "service_charge_uid", "applied_money"],
    "applied-service-charge field inventory is explicit"
  );

  let networkCalls = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = () => {
      networkCalls += 1;
      throw new Error("network call forbidden");
    };
    accepted(
      parseAdjustments(clone(orderFixtures.retrieve)),
      "parser remains pure under a network-call tripwire"
    );
  } finally {
    global.fetch = originalFetch;
  }
  equal(networkCalls, 0, "adjustment validation makes zero network calls");

  const changedFiles = childProcess
    .execFileSync("git", ["diff", "--name-only", "origin/main"], {
      cwd: root,
      encoding: "utf8"
    })
    .trim();
  doesNotMatch(
    changedFiles,
    /^(app|components|supabase|services|lib\/supabase|vercel\.json)(?:\/|$)/m,
    "adjustment phase adds no runtime, UI, database, or deployment scope"
  );
  doesNotMatch(
    changedFiles,
    /^lib\/integrations\/providers\/(?:qbo|square\/(?:descriptor|request-validators))\//m,
    "QBO, Square descriptor, and request validators remain untouched"
  );
  const adjustmentSources = [
    "lib/integrations/providers/square/order-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b2b2.ts"
  ].map(read).join("\n");
  doesNotMatch(
    adjustmentSources,
    /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|generateText|streamText|access[_-]?token|refresh[_-]?token/i,
    "adjustment sources contain no network, database, environment, credential, or model path"
  );
  doesNotMatch(
    adjustmentSources,
    /payments:|refunds:|fulfillments:|tenders:|webhook|queue|migration|persist|inventory/i,
    "adjustment sources contain no later transaction or runtime scope"
  );

  equal(
    square.SQUARE_ORDER_ADJUSTMENT_RESPONSE_OFFICIAL_REFERENCES.length,
    25,
    "official adjustment reference inventory is complete"
  );
  for (const reference of square.SQUARE_ORDER_ADJUSTMENT_RESPONSE_OFFICIAL_REFERENCES) {
    matches(
      reference,
      /^https:\/\/(?:developer\.squareup\.com|github\.com\/square\/square-nodejs-sdk)\//,
      "only official Square sources are recorded"
    );
  }
  const referenceText = square.SQUARE_ORDER_ADJUSTMENT_RESPONSE_OFFICIAL_REFERENCES.join("\n");
  for (const file of [
    "OrderLineItemTax.ts",
    "OrderLineItemDiscount.ts",
    "OrderServiceCharge.ts",
    "OrderLineItemAppliedTax.ts",
    "OrderLineItemAppliedDiscount.ts",
    "OrderLineItemAppliedServiceCharge.ts"
  ]) {
    matches(referenceText, new RegExp(file.replace(".", "\\.")), `${file} is pinned`);
  }

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b2b2"],
    "node scripts/external-integrations-square-phase-2b2b2-order-adjustment-response-validation-regression-tests.js",
    "adjustment suite is registered"
  );
  matches(
    ciWorkflow,
    /pnpm test:external-integrations-square-phase-2b2b2/,
    "CI runs the adjustment suite"
  );
}

testEnvelopeCompositionAndNullability();
testAdjustmentFieldsAndCompatibility();
testAppliedRelationshipsAndAuthority();
testExactNumbersMoneyAndCurrencies();
testDeterminismMinimizationAndFingerprints();
testEnvelopeFailuresAndStructuralSafety();
testExceptionContainedResultBoundary();
testDeepFreezeAndCallerIsolation();
testPinnedContractsDormancyAndRegistration();

deepEqual(
  [...adjustmentParserOutcomes].sort(),
  declaredParserOutcomes().sort(),
  "adjustment suite observes every declared parser outcome"
);
deepEqual(
  [...invokedParsers].sort(),
  exportedOrderParsers().sort(),
  "suite invokes every exported Order response parser"
);

const fixtureInventory = Object.keys(orderFixtures).length;
console.log(
  `External integrations Square Phase 2B.2B-2 Order adjustment response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} synthetic fixture definitions. Detail ${sampleDetailFingerprint}; response ${sampleResponseFingerprint}.`
);
