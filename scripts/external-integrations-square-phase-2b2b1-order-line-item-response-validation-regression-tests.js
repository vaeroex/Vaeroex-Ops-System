const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const { withoutSquareQualificationPaths } = require("./square-dormant-scope-test-support.js");

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
const detailParserOutcomes = new Set();
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

const orderFixtures = square.SQUARE_PHASE_2B2B1_ORDER_FIXTURES;
const canaries = Object.values(square.SQUARE_PHASE_2B2B1_SYNTHETIC_CANARIES);
const sensitiveValues = [
  ...canaries,
  square.SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID,
  square.SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
  square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
  "sq2b2b1OrderCursor001==",
  "sq2b2b1OpaqueCursorChanged==",
  "sq2b2b1-provider-secret",
  "sq2b2b1-attacker-key"
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
  return square.squarePhase2B2B1ParserInput(response, operation, overrides);
}

function parseDetail(response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  invokedParsers.add("parseSquareOrderLineItemResponse");
  return observeParserResult(
    square.parseSquareOrderLineItemResponse(
      parserInput(response, operation, overrides)
    ),
    true
  );
}

function parseDetailInput(input) {
  fixtureScenarioCount += 1;
  invokedParsers.add("parseSquareOrderLineItemResponse");
  return observeParserResult(square.parseSquareOrderLineItemResponse(input), true);
}

function parseCore(response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  invokedParsers.add("parseSquareOrderCoreResponse");
  return observeParserResult(
    square.parseSquareOrderCoreResponse(parserInput(response, operation, overrides)),
    false
  );
}

function observeParserResult(result, detailParser) {
  if (detailParser) detailParserOutcomes.add(result.outcome);
  equal(
    Array.isArray(result.diagnostics),
    true,
    "every parser outcome exposes diagnostics"
  );
  for (const diagnostic of result.diagnostics) {
    equal(
      diagnostic.field === "$input" || diagnostic.field === "$response",
      true,
      "every emitted diagnostic field is a static root"
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

function detailItem(response, orderId = square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID) {
  const item = response.items.find((candidate) => candidate.core.id === orderId);
  ok(item, `detail response contains Order ${orderId}`);
  return item;
}

function lineItem(detail, uid = square.SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID) {
  const item = detail.lineItems.find((candidate) => candidate.uid === uid);
  ok(item, `detail contains line item ${uid}`);
  return item;
}

function responseWithLine(line, orderOverrides = {}) {
  return {
    order: square.squarePhase2B2B1Order({
      line_items: [line],
      ...orderOverrides
    })
  };
}

function catalogLine(overrides = {}) {
  return square.squarePhase2B2B1CatalogLineItem({ modifiers: [], ...overrides });
}

function adHocModifier(uid, parentModifierUid = null, overrides = {}) {
  return {
    uid,
    name: `Synthetic ${uid}`,
    quantity: "1",
    base_price_money: { amount: 1, currency: "USD" },
    total_price_money: { amount: 1, currency: "USD" },
    parent_modifier_uid: parentModifierUid,
    ...overrides
  };
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
    /"(?:note|metadata|appliedTaxes|appliedDiscounts|appliedServiceCharges|pricingBlocklists|futureUrl|customerId)"/i,
    `${message}: excluded fields are absent`
  );
}

function testEnvelopesAndCoreLayering() {
  const retrieveInput = clone(orderFixtures.retrieve);
  const detailResponse = accepted(
    parseDetail(retrieveInput),
    "Retrieve Order detail envelope is accepted"
  );
  const coreResponse = accepted(
    parseCore(clone(orderFixtures.retrieve)),
    "the same Retrieve envelope remains accepted by Order core"
  );
  equal(detailResponse.operation, "retrieve_order", "operation is bound");
  equal(detailResponse.itemCount, 1, "Retrieve has one detail projection");
  const detail = detailItem(detailResponse);
  deepEqual(
    detail.core,
    coreResponse.items[0],
    "detail composes the exact Phase 2B.2A core projection"
  );
  equal(
    square.squareOrderCoreFingerprint(detail.core),
    square.squareOrderCoreFingerprint(coreResponse.items[0]),
    "composed core fingerprint remains Phase 2B.2A-stable"
  );
  equal(
    square.squareOrderCoreFingerprint(detail.core),
    EXPECTED_ORDER_CORE_ENTITY_FINGERPRINT,
    "merged Phase 2B.2A sample entity fingerprint remains exact"
  );
  equal(
    square.squareOrderCoreResponseFingerprint(coreResponse),
    EXPECTED_ORDER_CORE_RESPONSE_FINGERPRINT,
    "merged Phase 2B.2A sample response fingerprint remains exact"
  );
  equal(
    detail.contractVersion,
    "square_order_line_item_response_v1",
    "detail contract is independently versioned"
  );
  equal(
    detail.projectionScope,
    "order_core_with_line_items",
    "detail scope does not claim final accounting facts"
  );
  deepEqual(
    detail.lineItems.map((item) => item.uid),
    [
      square.SQUARE_PHASE_2B2B1_SYNTHETIC_LINE_ITEM_ID,
      square.SQUARE_PHASE_2B2B1_SYNTHETIC_SECOND_LINE_ITEM_ID
    ],
    "line-item order is canonical by UID"
  );

  const catalog = lineItem(detail);
  equal(catalog.authority.orderId, detail.core.id, "line authority binds Order ID");
  equal(catalog.authority.lineItemUid, catalog.uid, "line authority binds UID");
  equal(catalog.sourceKind, "catalog_backed", "catalog-backed source is explicit");
  equal(
    catalog.catalogReference.referenceKind,
    "catalog_object",
    "catalog ID remains a generic external reference"
  );
  equal(
    catalog.catalogReference.reconciliationState,
    "unverified",
    "Catalog type is not claimed without reconciliation"
  );
  equal(
    catalog.catalogReference.providerVersion,
    "1724952893872",
    "Catalog int64 version is retained as an exact string"
  );
  equal(catalog.quantity, "1.250", "line quantity remains an exact string");
  deepEqual(
    catalog.quantityUnit.measurementUnit,
    { kind: "weight", type: "TYPE_WEIGHT", unit: "METRIC_KILOGRAM" },
    "measurement semantics are minimized"
  );
  equal(catalog.quantityUnit.precision, 3, "quantity precision is retained");
  deepEqual(
    catalog.modifiers.map((modifier) => modifier.uid),
    [
      square.SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID,
      square.SQUARE_PHASE_2B2B1_SYNTHETIC_CHILD_MODIFIER_ID,
      square.SQUARE_PHASE_2B2B1_SYNTHETIC_GRANDCHILD_MODIFIER_ID
    ],
    "modifiers are deterministically parent-before-child"
  );
  deepEqual(
    catalog.modifiers.map((modifier) => modifier.nestingDepth),
    [1, 2, 3],
    "documented three-level nesting is retained"
  );
  deepEqual(
    catalog.modifiers.map((modifier) => modifier.pricingSource),
    [
      "catalog_default_or_unknown",
      "ad_hoc_base_price",
      "catalog_base_price_override"
    ],
    "modifier pricing semantics distinguish Catalog defaults and overrides"
  );

  const adHoc = lineItem(
    detail,
    square.SQUARE_PHASE_2B2B1_SYNTHETIC_SECOND_LINE_ITEM_ID
  );
  equal(adHoc.sourceKind, "ad_hoc", "ad hoc line remains explicit");
  equal(adHoc.catalogReference, null, "ad hoc line invents no Catalog identity");
  equal(adHoc.quantity, ".50", "leading-dot decimal quantity is retained");
  deepEqual(
    adHoc.quantityUnit.measurementUnit,
    {
      kind: "custom",
      type: "TYPE_CUSTOM",
      custom: { name: "Synthetic scoop", abbreviation: "scp" }
    },
    "custom measurement identity is retained without conversion"
  );
  deepEqual(
    adHoc.basePriceMoney,
    { amountMinor: null, currency: null },
    "present empty Money remains distinct"
  );
  assertProjectionMinimized(detailResponse, "Retrieve detail response");

  const batch = accepted(
    parseDetail(clone(orderFixtures.batch), "orders_batch_retrieve"),
    "Batch Retrieve detail envelope is accepted"
  );
  equal(batch.itemCount, 2, "Batch returns both Orders");
  deepEqual(
    batch.items.map((item) => item.core.id),
    [
      square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
      square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID
    ],
    "Batch Order projections are canonical by authority"
  );
  equal(
    lineItem(detailItem(batch)).totalMoney.currency,
    "USD",
    "first Order retains USD"
  );
  equal(
    lineItem(detailItem(batch, square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID), "SQ2B2B1LINE003").totalMoney.currency,
    "CAD",
    "a separate Order may retain CAD"
  );

  const search = accepted(
    parseDetail(clone(orderFixtures.search), "orders_search"),
    "Search complete-Orders detail envelope is accepted"
  );
  equal(search.pagination.cursorPresent, true, "Search retains cursor presence");
  assertFingerprint(search.pagination.cursorFingerprint, "opaque cursor binding");
  doesNotMatch(
    JSON.stringify(search),
    /sq2b2b1OrderCursor001/i,
    "raw cursor does not enter the projection"
  );

  for (const [fixture, label] of [
    [orderFixtures.emptyLineItems, "empty"],
    [orderFixtures.missingLineItems, "missing"],
    [orderFixtures.nullLineItems, "null"]
  ]) {
    const normalized = detailItem(
      accepted(parseDetail(clone(fixture)), `${label} line_items is accepted`)
    );
    deepEqual(normalized.lineItems, [], `${label} line_items normalizes empty`);
    equal(normalized.lineItemCount, 0, `${label} line-item count is zero`);
  }

  for (const [response, operation, label] of [
    [{}, "orders_batch_retrieve", "missing Batch orders"],
    [{ orders: null }, "orders_batch_retrieve", "null Batch orders"],
    [{ orders: [] }, "orders_batch_retrieve", "empty Batch orders"],
    [{}, "orders_search", "missing Search orders"],
    [{ orders: null, order_entries: null }, "orders_search", "null Search orders"],
    [{ orders: [] }, "orders_search", "empty Search orders"]
  ]) {
    const normalized = accepted(
      parseDetail(response, operation),
      `${label} follows the core envelope contract`
    );
    equal(normalized.itemCount, 0, `${label} normalizes to zero items`);
  }

  const semanticallyInvalidDetail = responseWithLine(
    catalogLine({ quantity: "not-a-decimal" })
  );
  accepted(
    parseCore(clone(semanticallyInvalidDetail)),
    "core parser still discards structurally safe line-item semantics"
  );
  rejected(
    parseDetail(clone(semanticallyInvalidDetail)),
    "detail parser independently rejects malformed line-item semantics"
  );
}

function testQuantityAndMeasurementUnits() {
  const exactQuantities = ["0", "00", "1", "01", "1.0", ".50", "999999999999"];
  for (const quantity of exactQuantities) {
    const detail = detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({ quantity, quantity_unit: null })
          )
        ),
        `documented decimal quantity ${quantity} is accepted exactly`
      )
    );
    equal(
      lineItem(detail).quantity,
      quantity,
      `quantity ${quantity} is not converted or canonicalized`
    );
  }

  for (let precision = 0; precision <= 5; precision += 1) {
    const quantity = precision === 0 ? "1" : `1.${"0".repeat(precision)}`;
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(
            responseWithLine(
              catalogLine({
                quantity,
                quantity_unit: {
                  measurement_unit: {
                    weight_unit: "IMPERIAL_POUND",
                    type: "TYPE_WEIGHT"
                  },
                  precision
                }
              })
            )
          ),
          `precision ${precision} is accepted`
        )
      )
    );
    equal(item.quantity, quantity, `precision ${precision} preserves scale`);
    equal(item.quantityUnit.precision, precision, `precision ${precision} is retained`);
  }

  const unitCases = [
    ...square.SQUARE_ORDER_MEASUREMENT_AREA_UNITS.map((unit) => [
      "area_unit",
      unit,
      "TYPE_AREA",
      "area"
    ]),
    ...square.SQUARE_ORDER_MEASUREMENT_LENGTH_UNITS.map((unit) => [
      "length_unit",
      unit,
      "TYPE_LENGTH",
      "length"
    ]),
    ...square.SQUARE_ORDER_MEASUREMENT_VOLUME_UNITS.map((unit) => [
      "volume_unit",
      unit,
      "TYPE_VOLUME",
      "volume"
    ]),
    ...square.SQUARE_ORDER_MEASUREMENT_WEIGHT_UNITS.map((unit) => [
      "weight_unit",
      unit,
      "TYPE_WEIGHT",
      "weight"
    ]),
    ["generic_unit", "UNIT", "TYPE_GENERIC", "generic"],
    ...square.SQUARE_ORDER_MEASUREMENT_TIME_UNITS.map((unit) => [
      "time_unit",
      unit,
      null,
      "time"
    ])
  ];
  for (const [key, unit, type, kind] of unitCases) {
    const measurementUnit = { [key]: unit };
    if (type !== null) measurementUnit.type = type;
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(
            responseWithLine(
              catalogLine({
                quantity: "1",
                quantity_unit: {
                  measurement_unit: measurementUnit,
                  precision: 5
                }
              })
            )
          ),
          `${kind} unit ${unit} is accepted from the pinned enum`
        )
      )
    );
    equal(item.quantityUnit.measurementUnit.kind, kind, `${unit} binds ${kind}`);
    if (kind !== "custom") {
      equal(item.quantityUnit.measurementUnit.unit, unit, `${unit} is retained`);
    }
  }

  const emptyUnit = lineItem(
    detailItem(
      accepted(
        parseDetail(responseWithLine(catalogLine({ quantity_unit: {} }))),
        "present empty quantity_unit is accepted by the SDK shape"
      )
    )
  );
  deepEqual(
    emptyUnit.quantityUnit,
    { measurementUnit: null, precision: null, catalogReference: null },
    "empty quantity_unit remains distinct from absence"
  );
  const absentUnit = lineItem(
    detailItem(
      accepted(
        parseDetail(responseWithLine(catalogLine({ quantity_unit: null }))),
        "null quantity_unit is accepted"
      )
    )
  );
  equal(absentUnit.quantityUnit, null, "absent quantity-unit information is null");
  const integerScale = detailItem(
    accepted(
      parseDetail(
        responseWithLine(
          catalogLine({ quantity: "1", quantity_unit: { precision: 1 } })
        )
      ),
      "integer-scale fingerprint fixture is accepted"
    )
  );
  const decimalScale = detailItem(
    accepted(
      parseDetail(
        responseWithLine(
          catalogLine({ quantity: "1.0", quantity_unit: { precision: 1 } })
        )
      ),
      "decimal-scale fingerprint fixture is accepted"
    )
  );
  notEqual(
    square.squareOrderLineItemDetailFingerprint(integerScale),
    square.squareOrderLineItemDetailFingerprint(decimalScale),
    "semantically meaningful trailing-zero scale changes the fingerprint"
  );
  notEqual(
    square.squareOrderLineItemDetailFingerprint(
      detailItem(
        accepted(
          parseDetail(responseWithLine(catalogLine({ quantity_unit: {} }))),
          "empty-unit fingerprint fixture is accepted"
        )
      )
    ),
    square.squareOrderLineItemDetailFingerprint(
      detailItem(
        accepted(
          parseDetail(responseWithLine(catalogLine({ quantity_unit: null }))),
          "absent-unit fingerprint fixture is accepted"
        )
      )
    ),
    "present empty and absent quantity-unit structures fingerprint differently"
  );

  const fractionalWithoutUnit = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(catalogLine({ quantity: ".125", quantity_unit: null }))
        ),
        "fractional POS quantity without quantity_unit is accepted"
      )
    )
  );
  equal(
    fractionalWithoutUnit.quantity,
    ".125",
    "fractional quantity without unit remains exact"
  );

  for (const quantity of [
    null,
    1,
    "",
    "-1",
    "+1",
    "1e2",
    " 1",
    "1 ",
    "1.",
    ".",
    "1,0",
    "NaN",
    "Infinity",
    "1234567890123"
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ quantity }))),
      `malformed line quantity ${String(quantity)} fails closed`
    );
  }
  const missingQuantity = catalogLine();
  delete missingQuantity.quantity;
  rejected(
    parseDetail(responseWithLine(missingQuantity)),
    "missing required line quantity fails closed"
  );

  for (const precision of [-1, 6, 1.5, "2", false, {}, []]) {
    rejected(
      parseDetail(
        responseWithLine(
          catalogLine({
            quantity: "1",
            quantity_unit: { precision }
          })
        )
      ),
      `invalid precision ${JSON.stringify(precision)} fails closed`
    );
  }
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({ quantity: "1.01", quantity_unit: { precision: 1 } })
      )
    ),
    "quantity fractional scale cannot exceed declared precision"
  );

  const malformedMeasurements = [
    {},
    { weight_unit: "METRIC_GRAM", length_unit: "METRIC_METER" },
    { weight_unit: "NOT_A_UNIT", type: "TYPE_WEIGHT" },
    { weight_unit: "METRIC_GRAM", type: "TYPE_LENGTH" },
    { custom_unit: {} },
    { custom_unit: { name: "Unit" } },
    { generic_unit: "NOT_UNIT", type: "TYPE_GENERIC" }
  ];
  for (const measurement_unit of malformedMeasurements) {
    rejected(
      parseDetail(
        responseWithLine(
          catalogLine({
            quantity: "1",
            quantity_unit: { measurement_unit, precision: 2 }
          })
        )
      ),
      "malformed or contradictory measurement unit fails closed"
    );
  }
  unsupported(
    parseDetail(
      responseWithLine(
        catalogLine({
          quantity: "1",
          quantity_unit: {
            measurement_unit: {
              weight_unit: "METRIC_GRAM",
              type: "TYPE_PROVIDER_FUTURE"
            },
            precision: 2
          }
        })
      )
    ),
    "unknown open measurement-unit type is unsupported"
  );

  for (const version of [0, -1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(
            responseWithLine(catalogLine({ catalog_version: version }))
          ),
          `safe signed Catalog version ${version} is accepted without invented sign rules`
        )
      )
    );
    equal(
      item.catalogReference.providerVersion,
      String(version),
      `Catalog version ${version} remains exact`
    );
  }
  for (const overrides of [
    { catalog_object_id: "bad catalog id" },
    { catalog_object_id: "#temporary" },
    { catalog_object_id: null, catalog_version: 1 },
    { catalog_version: "1" },
    { catalog_version: 1.25 },
    { catalog_version: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine(overrides))),
      "invalid or unbound Catalog line-item reference fails closed"
    );
  }

  for (const quantity_unit of [
    { catalog_object_id: "bad unit id" },
    { catalog_object_id: null, catalog_version: 1 },
    { catalog_object_id: "SQ2B2B1CATUNIT", catalog_version: "1" },
    { catalog_object_id: "SQ2B2B1CATUNIT", catalog_version: 1.5 },
    "unit",
    []
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ quantity_unit }))),
      "invalid Catalog measurement reference or quantity-unit shape fails closed"
    );
  }

  const typelessUnit = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({
              quantity: "1",
              quantity_unit: {
                measurement_unit: { weight_unit: "METRIC_GRAM" },
                precision: 2
              }
            })
          )
        ),
        "SDK-optional measurement type may be absent"
      )
    )
  );
  equal(
    typelessUnit.quantityUnit.measurementUnit.type,
    null,
    "absent measurement type normalizes to null"
  );
}

function testModifiersAndParentGraph() {
  for (const modifiers of [undefined, null, []]) {
    const line = catalogLine();
    if (modifiers === undefined) delete line.modifiers;
    else line.modifiers = modifiers;
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(responseWithLine(line)),
          `${String(modifiers)} modifiers normalize safely`
        )
      )
    );
    deepEqual(item.modifiers, [], "missing, null, and empty modifiers normalize empty");
    equal(item.modifierCount, 0, "empty modifier count is explicit");
  }

  const hugeExactQuantity = "9".repeat(4_096);
  const hugeModifier = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({
              modifiers: [
                adHocModifier("SQ2B2B1MODLONG", null, {
                  quantity: hugeExactQuantity
                })
              ]
            })
          )
        ),
        "modifier quantity uses only the structural string bound"
      )
    )
  ).modifiers[0];
  equal(
    hugeModifier.quantity,
    hugeExactQuantity,
    "large documented modifier quantity is not converted"
  );

  for (const quantity of ["0", "00", "1", "1.0", ".25", null]) {
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(
            responseWithLine(
              catalogLine({
                modifiers: [
                  adHocModifier("SQ2B2B1MODQTY", null, { quantity })
                ]
              })
            )
          ),
          `modifier quantity ${String(quantity)} is accepted exactly`
        )
      )
    );
    equal(
      item.modifiers[0].quantity,
      quantity,
      `modifier quantity ${String(quantity)} is retained`
    );
  }
  for (const quantity of [
    -1,
    "-1",
    "+1",
    "1e2",
    " 1",
    "1 ",
    "1.",
    ".",
    "NaN",
    "Infinity"
  ]) {
    rejected(
      parseDetail(
        responseWithLine(
          catalogLine({
            modifiers: [
              adHocModifier("SQ2B2B1MODBADQTY", null, { quantity })
            ]
          })
        )
      ),
      `invalid modifier quantity ${String(quantity)} fails closed`
    );
  }

  for (const missingPriceModifier of [
    { uid: "SQ2B2B1MODNOPRICE", name: "No price" },
    {
      uid: "SQ2B2B1MODNULLPRICE",
      name: "Null price",
      base_price_money: null
    }
  ]) {
    rejected(
      parseDetail(
        responseWithLine(
          catalogLine({ modifiers: [missingPriceModifier] })
        )
      ),
      "ad hoc modifier without present base_price_money fails closed"
    );
  }
  const emptyPrice = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({
              modifiers: [
                {
                  uid: "SQ2B2B1MODEMPTYPRICE",
                  base_price_money: {}
                }
              ]
            })
          )
        ),
        "present empty Money satisfies ad hoc modifier price presence"
      )
    )
  ).modifiers[0];
  deepEqual(
    emptyPrice.basePriceMoney,
    { amountMinor: null, currency: null },
    "empty modifier Money cannot masquerade as absence or zero"
  );
  equal(emptyPrice.pricingSource, "ad_hoc_base_price", "ad hoc price source is explicit");

  const catalogDefault = {
    uid: "SQ2B2B1MODCATDEFAULT",
    catalog_object_id: "SQ2B2B1CATMODDEFAULT",
    catalog_version: 9
  };
  const catalogOverride = {
    ...catalogDefault,
    uid: "SQ2B2B1MODCATOVERRIDE",
    base_price_money: { amount: 5, currency: "USD" }
  };
  const pricing = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({ modifiers: [catalogOverride, catalogDefault] })
          )
        ),
        "Catalog default and override modifier prices are accepted"
      )
    )
  );
  deepEqual(
    pricing.modifiers.map((modifier) => modifier.pricingSource),
    ["catalog_default_or_unknown", "catalog_base_price_override"],
    "Catalog price override does not rewrite Catalog authority"
  );

  const duplicateUid = "SQ2B2B1MODDUPLICATE";
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier(duplicateUid),
            adHocModifier(duplicateUid)
          ]
        })
      )
    ),
    "duplicate modifier UIDs within a line item fail closed"
  );
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier(duplicateUid),
            adHocModifier(duplicateUid, null, { name: "Conflicting parent" }),
            adHocModifier("SQ2B2B1MODAMBIGUOUS", duplicateUid)
          ]
        })
      )
    ),
    "a child cannot resolve an ambiguous duplicate parent UID"
  );
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        line_items: [
          catalogLine({
            uid: "SQ2B2B1LINEDUPMOD1",
            modifiers: [adHocModifier(duplicateUid)]
          }),
          catalogLine({
            uid: "SQ2B2B1LINEDUPMOD2",
            modifiers: [adHocModifier(duplicateUid)]
          })
        ]
      })
    }),
    "modifier UID uniqueness is enforced across the Order"
  );

  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier("SQ2B2B1MODORPHAN", "SQ2B2B1MODMISSING")
          ]
        })
      )
    ),
    "missing modifier parent fails closed"
  );
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier("SQ2B2B1MODSELF", "SQ2B2B1MODSELF")
          ]
        })
      )
    ),
    "self-parenting modifier fails closed"
  );
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier("SQ2B2B1MODCYCLE1", "SQ2B2B1MODCYCLE2"),
            adHocModifier("SQ2B2B1MODCYCLE2", "SQ2B2B1MODCYCLE1")
          ]
        })
      )
    ),
    "modifier parent cycle fails closed"
  );
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        line_items: [
          catalogLine({
            uid: "SQ2B2B1LINECROSS1",
            modifiers: [
              adHocModifier("SQ2B2B1MODCROSSCHILD", "SQ2B2B1MODCROSSPARENT")
            ]
          }),
          catalogLine({
            uid: "SQ2B2B1LINECROSS2",
            modifiers: [adHocModifier("SQ2B2B1MODCROSSPARENT")]
          })
        ]
      })
    }),
    "cross-line-item modifier parent fails closed"
  );

  const depthModifiers = [
    adHocModifier("SQ2B2B1MODDEPTH1"),
    adHocModifier("SQ2B2B1MODDEPTH2", "SQ2B2B1MODDEPTH1"),
    adHocModifier("SQ2B2B1MODDEPTH3", "SQ2B2B1MODDEPTH2"),
    adHocModifier("SQ2B2B1MODDEPTH4", "SQ2B2B1MODDEPTH3")
  ];
  rejected(
    parseDetail(
      responseWithLine(catalogLine({ modifiers: depthModifiers }))
    ),
    "fourth nested modifier level exceeds the pinned three-level contract"
  );

  const orderedTree = [
    adHocModifier("SQ2B2B1MODROOTB"),
    adHocModifier("SQ2B2B1MODCHILDB", "SQ2B2B1MODROOTB"),
    adHocModifier("SQ2B2B1MODROOTA"),
    adHocModifier("SQ2B2B1MODCHILDA", "SQ2B2B1MODROOTA")
  ];
  const forward = detailItem(
    accepted(
      parseDetail(
        responseWithLine(catalogLine({ modifiers: orderedTree }))
      ),
      "forward modifier tree is accepted"
    )
  );
  const reverse = detailItem(
    accepted(
      parseDetail(
        responseWithLine(catalogLine({ modifiers: [...orderedTree].reverse() }))
      ),
      "reverse modifier tree is accepted"
    )
  );
  deepEqual(
    lineItem(forward).modifiers.map((modifier) => modifier.uid),
    [
      "SQ2B2B1MODROOTA",
      "SQ2B2B1MODCHILDA",
      "SQ2B2B1MODROOTB",
      "SQ2B2B1MODCHILDB"
    ],
    "roots and siblings use deterministic lexical order"
  );
  equal(
    square.squareOrderLineItemDetailFingerprint(forward),
    square.squareOrderLineItemDetailFingerprint(reverse),
    "provider modifier array order is fingerprint-neutral"
  );

  for (const modifiers of ["bad", {}, [null], [1]]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ modifiers }))),
      "malformed modifier collection fails closed"
    );
  }
  unsupported(
    parseDetail(
      responseWithLine(
        catalogLine({ modifiers: [{ base_price_money: {} }] })
      )
    ),
    "modifier without response UID cannot become trusted authority"
  );
  for (const modifier of [
    adHocModifier("bad uid"),
    {
      uid: "SQ2B2B1MODBADCAT",
      catalog_object_id: "bad catalog id"
    },
    {
      uid: "SQ2B2B1MODBADVERSION",
      catalog_version: 1,
      base_price_money: {}
    },
    {
      uid: "SQ2B2B1MODBADVERSIONTYPE",
      catalog_object_id: "SQ2B2B1CATMOD",
      catalog_version: "1"
    },
    {
      uid: "SQ2B2B1MODBADVERSIONFRACTION",
      catalog_object_id: "SQ2B2B1CATMOD",
      catalog_version: 1.5
    }
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ modifiers: [modifier] }))),
      "invalid modifier authority or Catalog reference fails closed"
    );
  }
}

function testMoneyMinimizationAndFingerprints() {
  const baselineResponse = accepted(
    parseDetail(clone(orderFixtures.retrieve)),
    "detail fingerprint baseline is accepted"
  );
  const baselineDetail = detailItem(baselineResponse);
  sampleDetailFingerprint = square.squareOrderLineItemDetailFingerprint(
    baselineDetail
  );
  sampleResponseFingerprint = square.squareOrderLineItemResponseFingerprint(
    baselineResponse
  );
  assertFingerprint(sampleDetailFingerprint, "Order line-item detail fingerprint");
  assertFingerprint(sampleResponseFingerprint, "Order line-item response fingerprint");
  equal(
    sampleDetailFingerprint,
    EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT,
    "sample Order line-item detail fingerprint is pinned"
  );
  equal(
    sampleResponseFingerprint,
    EXPECTED_ORDER_LINE_ITEM_RESPONSE_FINGERPRINT,
    "sample Order line-item response fingerprint is pinned"
  );
  equal(
    square.squareOrderLineItemDetailFingerprint(
      detailItem(
        accepted(
          parseDetail(clone(orderFixtures.retrieve)),
          "repeated detail fingerprint fixture is accepted"
        )
      )
    ),
    sampleDetailFingerprint,
    "detail fingerprint is deterministic"
  );

  const reorderedOrder = square.squarePhase2B2B1Order();
  reorderedOrder.line_items.reverse();
  for (const line of reorderedOrder.line_items) {
    if (Array.isArray(line.modifiers)) line.modifiers.reverse();
  }
  const reordered = accepted(
    parseDetail({ order: reorderedOrder }),
    "provider-reordered line and modifier arrays are accepted"
  );
  equal(
    square.squareOrderLineItemResponseFingerprint(reordered),
    sampleResponseFingerprint,
    "provider array order is response-fingerprint neutral"
  );

  const excludedMutation = square.squarePhase2B2B1Order();
  excludedMutation.customer_id = "SQ2B2B1CUSTOMERCHANGED";
  excludedMutation.line_items[0].note = "changed note";
  excludedMutation.line_items[0].metadata = { changed: "changed metadata" };
  excludedMutation.line_items[0].applied_taxes = [{ tax_uid: "CHANGED" }];
  excludedMutation.line_items[0].applied_discounts = [
    { discount_uid: "CHANGED" }
  ];
  excludedMutation.line_items[0].applied_service_charges = [
    { service_charge_uid: "CHANGED" }
  ];
  excludedMutation.line_items[0].pricing_blocklists = {
    blocked_taxes: ["CHANGED"]
  };
  excludedMutation.line_items[0].future_url =
    "https://example.test/changed-provider-url";
  excludedMutation.line_items[0].modifiers[0].metadata = {
    changed: "changed modifier metadata"
  };
  const excludedResult = accepted(
    parseDetail({ order: excludedMutation }),
    "bounded excluded details remain accepted"
  );
  equal(
    square.squareOrderLineItemResponseFingerprint(excludedResult),
    sampleResponseFingerprint,
    "notes, metadata, applied details, URLs, and customer data are fingerprint-neutral"
  );
  assertProjectionMinimized(excludedResult, "excluded-field mutation result");

  const trustedMutations = [
    ["line UID", (line) => { line.uid = "SQ2B2B1LINECHANGED"; }],
    ["line name", (line) => { line.name = "Changed trusted name"; }],
    ["variation name", (line) => { line.variation_name = "Changed variation"; }],
    ["item type", (line) => { line.item_type = "CUSTOM_AMOUNT"; }],
    ["quantity", (line) => { line.quantity = "1.251"; }],
    ["Catalog ID", (line) => { line.catalog_object_id = "SQ2B2B1CATVARCHANGED"; }],
    ["Catalog version", (line) => { line.catalog_version += 1; }],
    ["quantity precision", (line) => { line.quantity_unit.precision = 4; }],
    ["quantity-unit Catalog ID", (line) => {
      line.quantity_unit.catalog_object_id = "SQ2B2B1CATUNITCHANGED";
    }],
    ["quantity-unit Catalog version", (line) => {
      line.quantity_unit.catalog_version += 1;
    }],
    ["measurement unit", (line) => {
      line.quantity_unit.measurement_unit = {
        weight_unit: "IMPERIAL_POUND",
        type: "TYPE_WEIGHT"
      };
    }],
    ["line Money", (line) => { line.total_money.amount += 1; }],
    ["modifier name", (line) => { line.modifiers[0].name = "Changed modifier"; }],
    ["modifier Catalog ID", (line) => {
      line.modifiers[0].catalog_object_id = "SQ2B2B1CATMODCHANGED";
    }],
    ["modifier Catalog version", (line) => {
      line.modifiers[0].catalog_version += 1;
    }],
    ["modifier quantity", (line) => { line.modifiers[0].quantity = "1.0"; }],
    ["modifier parent", (line) => {
      line.modifiers[0].parent_modifier_uid =
        square.SQUARE_PHASE_2B2B1_SYNTHETIC_MODIFIER_ID;
    }],
    ["modifier Money", (line) => { line.modifiers[0].total_price_money.amount += 1; }]
  ];
  for (const [label, mutate] of trustedMutations) {
    const changedLine = square.squarePhase2B2B1CatalogLineItem();
    mutate(changedLine);
    const changed = detailItem(
      accepted(
        parseDetail(responseWithLine(changedLine)),
        `${label} mutation remains valid`
      )
    );
    notEqual(
      square.squareOrderLineItemDetailFingerprint(changed),
      square.squareOrderLineItemDetailFingerprint(
        detailItem(
          accepted(
            parseDetail(
              responseWithLine(square.squarePhase2B2B1CatalogLineItem())
            ),
            `${label} comparison baseline is valid`
          )
        )
      ),
      `${label} changes the detail fingerprint`
    );
  }

  const coreBaseline = accepted(
    parseCore(clone(orderFixtures.retrieve)),
    "core-neutrality baseline is accepted"
  );
  const coreWithChangedDetails = accepted(
    parseCore({
      order: square.squarePhase2B2B1Order({
        line_items: [
          square.squarePhase2B2B1CatalogLineItem({
            quantity: "9.999",
            name: "Changed but core-excluded detail"
          })
        ]
      })
    }),
    "core parser accepts changed trusted-detail fields as excluded core data"
  );
  equal(
    square.squareOrderCoreResponseFingerprint(coreWithChangedDetails),
    square.squareOrderCoreResponseFingerprint(coreBaseline),
    "trusted detail changes remain neutral to the Phase 2B.2A core fingerprint"
  );

  const searchWithoutCursor = accepted(
    parseDetail(
      { orders: [square.squarePhase2B2B1Order()] },
      "orders_search"
    ),
    "Search without cursor is accepted"
  );
  const searchWithCursor = accepted(
    parseDetail(
      {
        orders: [square.squarePhase2B2B1Order()],
        cursor: "sq2b2b1OpaqueCursorChanged=="
      },
      "orders_search"
    ),
    "Search with opaque cursor is accepted"
  );
  equal(
    square.squareOrderLineItemDetailFingerprint(detailItem(searchWithoutCursor)),
    square.squareOrderLineItemDetailFingerprint(detailItem(searchWithCursor)),
    "cursor remains outside the entity detail fingerprint"
  );
  notEqual(
    square.squareOrderLineItemResponseFingerprint(searchWithoutCursor),
    square.squareOrderLineItemResponseFingerprint(searchWithCursor),
    "cursor binding changes only the response fingerprint"
  );

  const moneyStates = [];
  for (const [label, base_price_money] of [
    ["absent", null],
    ["empty", {}],
    ["zero", { amount: 0, currency: "USD" }]
  ]) {
    const detail = detailItem(
      accepted(
        parseDetail(
          responseWithLine(catalogLine({ base_price_money }))
        ),
        `${label} line Money state is accepted`
      )
    );
    moneyStates.push(square.squareOrderLineItemDetailFingerprint(detail));
  }
  equal(new Set(moneyStates).size, 3, "absent, empty, and zero Money stay distinct");

  for (const amount of [
    Number.MIN_SAFE_INTEGER,
    -1,
    0,
    1,
    Number.MAX_SAFE_INTEGER
  ]) {
    const item = lineItem(
      detailItem(
        accepted(
          parseDetail(
            responseWithLine(
              catalogLine({
                total_money: { amount, currency: "USD" }
              })
            )
          ),
          `signed safe Money amount ${amount} is accepted`
        )
      )
    );
    equal(item.totalMoney.amountMinor, String(amount), `${amount} remains exact`);
  }

  for (const total_money of [
    { amount: 1.5, currency: "USD" },
    { amount: "1", currency: "USD" },
    { amount: "1e2", currency: "USD" },
    { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" },
    { amount: -0, currency: "USD" },
    { amount: 1, currency: "NOT" },
    "money",
    []
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ total_money }))),
      "malformed line-item Money fails closed"
    );
  }
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({ base_price_money: { amount: 1, currency: "EUR" } })
      )
    ),
    "currency conflict between Order and line item fails closed"
  );
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: [
            adHocModifier("SQ2B2B1MODEUR", null, {
              base_price_money: { amount: 1, currency: "EUR" }
            })
          ]
        })
      )
    ),
    "currency conflict in a modifier fails closed"
  );

  const boundedNames = lineItem(
    detailItem(
      accepted(
        parseDetail(
          responseWithLine(
            catalogLine({
              name: "N".repeat(512),
              variation_name: "V".repeat(400),
              modifiers: [
                adHocModifier("SQ2B2B1MODNAME", null, {
                  name: "M".repeat(255)
                })
              ]
            })
          )
        ),
        "documented display-text maxima are accepted"
      )
    )
  );
  equal(boundedNames.name.length, 512, "line name maximum is retained");
  equal(boundedNames.variationName.length, 400, "variation maximum is retained");
  equal(boundedNames.modifiers[0].name.length, 255, "modifier name maximum is retained");

  for (const overrides of [
    { name: "N".repeat(513) },
    { variation_name: "V".repeat(401) },
    { name: "<script>alert(1)</script>" },
    { name: "unsafe\u202Etext" },
    { name: "unsafe\u0000text" },
    {
      modifiers: [
        adHocModifier("SQ2B2B1MODBADNAME", null, { name: "M".repeat(256) })
      ]
    }
  ]) {
    rejected(
      parseDetail(responseWithLine(catalogLine(overrides))),
      "unsafe or oversized retained display text fails closed"
    );
  }
}

function testAuthorityEnvelopesAndStructuralSafety() {
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        line_items: [catalogLine(), catalogLine()]
      })
    }),
    "duplicate line-item UIDs fail closed"
  );
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        line_items: [catalogLine(), catalogLine({ quantity: "2" })]
      })
    }),
    "conflicting representations of one Order/line authority fail closed"
  );
  unsupported(
    parseDetail(
      responseWithLine(catalogLine({ uid: null }))
    ),
    "line item without a non-null response UID cannot become trusted"
  );
  const missingUid = catalogLine();
  delete missingUid.uid;
  unsupported(
    parseDetail(responseWithLine(missingUid)),
    "missing line-item UID is unsupported"
  );
  for (const uid of ["bad uid", "#temporary", "x".repeat(61), 1, {}, []]) {
    rejected(
      parseDetail(responseWithLine(catalogLine({ uid }))),
      "malformed line-item authority fails closed"
    );
  }
  for (const line_items of ["bad", {}, [null], [1]]) {
    rejected(
      parseDetail({
        order: square.squarePhase2B2B1Order({ line_items })
      }),
      "malformed line-item collection fails closed"
    );
  }
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        line_items: Array.from({ length: 1_001 }, (_, index) =>
          catalogLine({ uid: `SQ2B2B1LINE${index}` })
        )
      })
    }),
    "oversized line-item array fails at the structural bound"
  );
  rejected(
    parseDetail(
      responseWithLine(
        catalogLine({
          modifiers: Array.from({ length: 1_001 }, (_, index) =>
            adHocModifier(`SQ2B2B1MOD${index}`)
          )
        })
      )
    ),
    "oversized modifier array fails at the structural bound"
  );

  rejected(
    parseDetail(
      responseWithLine(catalogLine({ item_type: "PROVIDER_FUTURE_TYPE" }))
    ),
    "unknown line-item enum cannot silently enter trusted output"
  );
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        id: "SQ2B2B1ORDERESCAPE"
      })
    }),
    "Retrieve Order ID fencing remains exact"
  );
  rejected(
    parseDetail({
      order: square.squarePhase2B2B1Order({
        location_id: "SQ2B2B1LOCATIONESCAPE"
      })
    }),
    "authorized-location fencing remains exact"
  );

  for (const response of [{}, { order: null }, { errors: [] }]) {
    rejected(
      parseDetail(response),
      "Retrieve without a valid Order fails closed absent provider error"
    );
  }
  for (const errors of [
    [{ code: "NOT_FOUND", detail: "sq2b2b1-provider-secret" }],
    [{ code: "INTERNAL_SERVER_ERROR", field: "sq2b2b1-attacker-key" }]
  ]) {
    unsupported(
      parseDetail({ errors }),
      "provider errors cannot become trusted detail data"
    );
    unsupported(
      parseDetail({ order: square.squarePhase2B2B1Order(), errors }),
      "mixed provider error and data envelope fails closed"
    );
  }
  for (const order_entries of [[], [{}], [{ order_id: "SECRET" }]]) {
    unsupported(
      parseDetail({ orders: [], order_entries }, "orders_search"),
      "every non-null order_entries representation is unsupported"
    );
  }
  accepted(
    parseDetail(
      { orders: [], order_entries: null },
      "orders_search"
    ),
    "null order_entries is treated as absent"
  );
  rejected(
    parseDetail(
      { orders: [], order_entries: "not-an-array" },
      "orders_search"
    ),
    "malformed order_entries fails closed"
  );
  rejected(
    parseDetail(
      { orders: [], cursor: "cursor value with spaces" },
      "orders_search"
    ),
    "invalid raw cursor is rejected without reflection"
  );

  const unknownFieldBaseline = detailItem(
    accepted(
      parseDetail(responseWithLine(catalogLine())),
      "unknown-field comparison baseline is accepted"
    )
  );
  const unknownFieldChanged = detailItem(
    accepted(
      parseDetail(
        responseWithLine(
          catalogLine({
            future_provider_object: {
              arbitrary: "bounded unknown value",
              future_nested: [true, null, 1]
            }
          })
        )
      ),
      "bounded unknown provider fields are structurally inspected then discarded"
    )
  );
  equal(
    square.squareOrderLineItemDetailFingerprint(unknownFieldChanged),
    square.squareOrderLineItemDetailFingerprint(unknownFieldBaseline),
    "unknown provider fields remain fingerprint-neutral"
  );

  const cyclic = {};
  cyclic.self = cyclic;
  const customPrototype = Object.create({ inherited: true });
  customPrototype.value = "x";
  const accessor = {};
  let accessorCalls = 0;
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "sq2b2b1-provider-secret";
    }
  });
  const symbolKey = { value: "x" };
  symbolKey[Symbol("sq2b2b1-provider-secret")] = true;
  const customArray = [];
  customArray.extra = "sq2b2b1-provider-secret";
  const structuralAttacks = [
    cyclic,
    customPrototype,
    accessor,
    symbolKey,
    customArray,
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0,
    undefined,
    () => true
  ];
  for (const attack of structuralAttacks) {
    rejected(
      parseDetail(
        responseWithLine(catalogLine({ future_provider_field: attack }))
      ),
      "structural attack in an excluded field fails before minimization"
    );
  }
  equal(accessorCalls, 0, "provider accessor is never invoked");

  const providerKeyAttack = catalogLine({
    "sq2b2b1-attacker-key": "x".repeat(4_097)
  });
  const providerKeyResult = parseDetail(responseWithLine(providerKeyAttack));
  rejected(providerKeyResult, "provider-controlled unknown key attack rejects");
  equal(
    providerKeyResult.diagnostics[0].field,
    "$response",
    "provider-controlled key never appears in diagnostic path"
  );

  rejected(
    parseDetailInput({ ...parserInput({}), unknown_input: true }),
    "unknown caller input field remains rejected"
  );
  incompatible(
    parseDetailInput(
      parserInput({}, "retrieve_order", { apiVersion: "2026-07-15" })
    ),
    "unreviewed API version is incompatible"
  );
}

function testExceptionContainedResultBoundary() {
  const throwingInput = new Proxy(parserInput({}), {
    ownKeys() {
      throw new Error("sq2b2b1-provider-secret");
    }
  });
  assertInternalRejection(
    parseDetailInput(throwingInput),
    "raw parser exception is contained"
  );

  const hostileThrownValue = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("sq2b2b1-provider-secret");
    }
  });
  const doubleFaultInput = new Proxy(parserInput({}), {
    ownKeys() {
      throw hostileThrownValue;
    }
  });
  assertInternalRejection(
    parseDetailInput(doubleFaultInput),
    "exception-classification double fault is contained"
  );

  const originalFailureResult = squareResponseValidation.squareFailureResult;
  const originalUnsupportedResult =
    squareResponseValidation.squareUnsupportedResult;
  try {
    squareResponseValidation.squareFailureResult = () => {
      throw new Error("sq2b2b1-provider-secret");
    };
    assertInternalRejection(
      parseDetailInput(null),
      "failure-factory exception is contained"
    );

    squareResponseValidation.squareFailureResult = () =>
      new Proxy(
        { outcome: "rejected", diagnostics: [] },
        {
          getOwnPropertyDescriptor(target, key) {
            if (key === "diagnostics") {
              throw new Error("sq2b2b1-provider-secret");
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          }
        }
      );
    assertInternalRejection(
      parseDetailInput(null),
      "sanitizer exception is contained"
    );

    squareResponseValidation.squareFailureResult = () => ({
      outcome: "rejected",
      diagnostics: [
        {
          code: "sq2b2b1-provider-secret",
          field: "$response.sq2b2b1-attacker-key"
        }
      ]
    });
    assertInternalRejection(
      parseDetailInput(null),
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
      parseDetailInput(null),
      "future undeclared outcome cannot bypass sanitation"
    );

    squareResponseValidation.squareFailureResult = originalFailureResult;
    squareResponseValidation.squareUnsupportedResult = () => {
      throw new Error("sq2b2b1-provider-secret");
    };
    assertInternalRejection(
      parseDetail({ errors: [{ code: "NOT_FOUND" }] }),
      "unsupported-result factory exception is contained"
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
            code: "sq2b2b1-provider-secret",
            field: "$response.sq2b2b1-attacker-key"
          })
        ])
      });
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
      "forged accepted result cannot carry diagnostics"
    );

    squareResponseValidation.squareAcceptedResult = (value) =>
      Object.freeze({
        outcome: "accepted",
        value,
        diagnostics: Object.freeze([])
      });
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
      "mutable nested accepted value is rejected"
    );

    squareResponseValidation.squareAcceptedResult = () =>
      Object.freeze({
        outcome: "accepted",
        value: Object.freeze({
          entityType: "forged",
          providerPayload: "sq2b2b1-provider-secret"
        }),
        diagnostics: Object.freeze([])
      });
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
      "schema-invalid accepted value is rejected"
    );

    squareResponseValidation.squareAcceptedResult = (value) => {
      value.items[0].lineItems[0].name =
        "<script>sq2b2b1-provider-secret</script>";
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
      "deeply frozen accepted detail with unsafe display text is rejected"
    );

    squareResponseValidation.squareAcceptedResult = () => {
      throw new Error("sq2b2b1-provider-secret");
    };
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
      "accepted-result factory exception becomes static rejection"
    );

    squareResponseValidation.squareFailureResult = () => {
      throw new Error("sq2b2b1-provider-secret");
    };
    assertInternalRejection(
      parseDetail(clone(orderFixtures.retrieve)),
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
    const returned = parseDetail(clone(orderFixtures.retrieve));
    equal(
      returned,
      legitimateResult,
      "legitimate deeply frozen accepted result crosses the boundary unchanged"
    );
    assertDeeplyFrozen(returned, "legitimate accepted result");
  } finally {
    squareResponseValidation.squareAcceptedResult = originalAcceptedResult;
  }
}

function testDeepFreezeAndCallerIsolation() {
  const mutableResponse = clone(orderFixtures.retrieve);
  const result = accepted(
    parseDetail(mutableResponse),
    "deep-freeze fixture is accepted"
  );
  assertDeeplyFrozen(result, "accepted line-item response");
  const snapshot = JSON.stringify(result);
  const detail = detailItem(result);
  const item = lineItem(detail);
  throws(
    () => result.items.push(detail),
    /Cannot|read only|extensible|frozen/i,
    "accepted detail array resists extension"
  );
  for (const mutate of [
    () => { result.provider.apiVersion = "changed"; },
    () => { result.connectionAuthority.providerEntityId = "changed"; },
    () => { detail.core.state = "OPEN"; },
    () => { detail.lineItems.push(item); },
    () => { item.quantity = "999"; },
    () => { item.quantityUnit.precision = 0; },
    () => { item.modifiers[0].parentModifierUid = null; },
    () => { item.modifiers[0].totalPriceMoney.amountMinor = "999"; }
  ]) {
    try {
      mutate();
    } catch {}
  }
  equal(JSON.stringify(result), snapshot, "mutation attempts leave result unchanged");

  mutableResponse.order.line_items[0].quantity = "999";
  mutableResponse.order.line_items[0].modifiers[0].name = "changed";
  equal(
    JSON.stringify(result),
    snapshot,
    "caller mutation cannot alter accepted minimized data"
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

function testPinnedContractsAndDormancy() {
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
    "Orders Search request fingerprints remain identical"
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
  const continuationDecision = ordersSearchDecision(
    ordersSearchRequestBody({ cursor: "phase2b2b1-cursor-canary" }),
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT
  );
  equal(
    continuationDecision.cursorBindingFingerprint,
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT,
    "cursor continuation retains the pinned binding"
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
  deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "QBO remains GET-only");
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

  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "detail validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "reviewed API version is pinned");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_VERSION, "45.1.0", "SDK version is pinned");
  equal(
    square.SQUARE_ORDER_RESPONSE_SDK_REVISION,
    "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76",
    "SDK revision is pinned"
  );
  equal(square.SQUARE_ORDER_LINE_ITEM_ENTITY_VERSION, 1, "detail entity version is explicit");
  deepEqual(
    square.SQUARE_ORDER_LINE_ITEM_TRUSTED_RESPONSE_FIELDS,
    [
      "uid",
      "catalog_object_id",
      "catalog_version",
      "name",
      "variation_name",
      "item_type",
      "quantity",
      "quantity_unit",
      "modifiers",
      "base_price_money",
      "variation_total_price_money",
      "gross_sales_money",
      "total_tax_money",
      "total_discount_money",
      "total_service_charge_money",
      "total_money"
    ],
    "trusted detail field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_LINE_ITEM_DISCARDED_RESPONSE_FIELDS,
    [
      "note",
      "metadata",
      "applied_taxes",
      "applied_discounts",
      "applied_service_charges",
      "pricing_blocklists"
    ],
    "discarded line-item field inventory is explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_LINE_ITEM_MODIFIER_DISCARDED_RESPONSE_FIELDS,
    ["metadata"],
    "modifier metadata is explicitly discarded"
  );

  let networkCalls = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = () => {
      networkCalls += 1;
      throw new Error("network call forbidden");
    };
    accepted(
      parseDetail(clone(orderFixtures.retrieve)),
      "parser remains pure under a network-call tripwire"
    );
  } finally {
    global.fetch = originalFetch;
  }
  equal(networkCalls, 0, "detail validation makes zero network calls");

  const changedFiles = childProcess
    .execFileSync("git", ["diff", "--name-only", "origin/main"], {
      cwd: root,
      encoding: "utf8"
    })
    .trim();
  doesNotMatch(
    withoutSquareQualificationPaths(changedFiles),
    /^(app|components|supabase|services|lib\/supabase|vercel\.json)(?:\/|$)/m,
    "Square remains dormant outside the exact authorized database qualification files"
  );
  doesNotMatch(
    changedFiles,
    /^lib\/integrations\/providers\/(?:qbo|square\/(?:descriptor|request-validators))\//m,
    "QBO, Square descriptor, and request validators remain untouched"
  );
  const detailSources = [
    "lib/integrations/providers/square/order-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b2b1.ts"
  ].map(read).join("\n");
  doesNotMatch(
    detailSources,
    /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|generateText|streamText|access[_-]?token|refresh[_-]?token/i,
    "detail sources contain no network, database, environment, credential, or model path"
  );
  doesNotMatch(
    detailSources,
    /payments:|refunds:|fulfillments:|webhook|queue|migration|persist/i,
    "detail sources contain no later transaction or runtime scope"
  );

  equal(
    square.SQUARE_ORDER_LINE_ITEM_RESPONSE_OFFICIAL_REFERENCES.length,
    16,
    "official detail reference inventory is complete"
  );
  for (const reference of square.SQUARE_ORDER_LINE_ITEM_RESPONSE_OFFICIAL_REFERENCES) {
    matches(
      reference,
      /^https:\/\/(?:developer\.squareup\.com|github\.com\/square\/square-nodejs-sdk)\//,
      "only official Square sources are recorded"
    );
  }
  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b2b1"],
    "node scripts/external-integrations-square-phase-2b2b1-order-line-item-response-validation-regression-tests.js",
    "detail suite is registered"
  );
  matches(
    ciWorkflow,
    /pnpm test:external-integrations-square-phase-2b2b1/,
    "CI runs the detail suite"
  );
}

testEnvelopesAndCoreLayering();
testQuantityAndMeasurementUnits();
testModifiersAndParentGraph();
testMoneyMinimizationAndFingerprints();
testAuthorityEnvelopesAndStructuralSafety();
testExceptionContainedResultBoundary();
testDeepFreezeAndCallerIsolation();
testPinnedContractsAndDormancy();

fixtureScenarioCount += 1;
invokedParsers.add("parseSquareOrderAdjustmentResponse");
observeParserResult(square.parseSquareOrderAdjustmentResponse(null), false);
invokedParsers.add("parseSquareOrderTenderResponse");
observeParserResult(square.parseSquareOrderTenderResponse(null), false);

deepEqual(
  [...detailParserOutcomes].sort(),
  declaredParserOutcomes().sort(),
  "detail suite observes every declared parser outcome"
);
deepEqual(
  [...invokedParsers].sort(),
  exportedOrderParsers().sort(),
  "suite invokes every exported Order response parser"
);

const fixtureInventory = Object.keys(orderFixtures).length;
console.log(
  `External integrations Square Phase 2B.2B-1 Order line-item response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} synthetic fixture definitions. Detail ${sampleDetailFingerprint}; response ${sampleResponseFingerprint}; Orders Search ${EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT}; cursor binding ${EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT}; Square descriptor ${EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT}; QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}; active registry ${EXPECTED_ACTIVE_REGISTRY_FINGERPRINT}.`
);
