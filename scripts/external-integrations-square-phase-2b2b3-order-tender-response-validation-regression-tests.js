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
const tenderParserOutcomes = new Set();
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
const EXPECTED_ORDER_CORE_ENTITY_FINGERPRINT =
  "sha256:417e585883fad9634504dcae2290a568f62ac3b3ac6cea09f1b0bb94c1fd1a34";
const EXPECTED_ORDER_CORE_RESPONSE_FINGERPRINT =
  "sha256:f958b476d1bb34889c98a0af9293056edbb086d39c52cac54b9187f8888e3938";
const EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT =
  "sha256:667d21354e744d7b75687c36932b72b563f2093d25104b063eafca61ef5d284d";
const EXPECTED_ORDER_LINE_ITEM_RESPONSE_FINGERPRINT =
  "sha256:8c0b7b9ceda5b8cf1e18c06071a0de40221d3c2e228f7de45f67fc5741ce23dc";
const EXPECTED_ORDER_ADJUSTMENT_DETAIL_FINGERPRINT =
  "sha256:2b69a233bd2409059458a79bbcccc9018c4a7d6267a0fb1a9ba70e7b613d8335";
const EXPECTED_ORDER_ADJUSTMENT_RESPONSE_FINGERPRINT =
  "sha256:d2b5295118c3b8bccbc71d749620cc4cda4a089ff2d9f8954b8c49291f766cea";
const EXPECTED_ORDER_TENDER_DETAIL_FINGERPRINT =
  "sha256:d2ee980b11131a78e4ea1351f1677720b5b55ae53781a16c2230a02dd469f57c";
const EXPECTED_ORDER_TENDER_RESPONSE_FINGERPRINT =
  "sha256:dae08df69fe87134902a04b18726604b8d8c84dcceec82a928ebc9d01312a86e";

const orderFixtures = square.SQUARE_PHASE_2B2B3_ORDER_FIXTURES;
const canaries = Object.values(square.SQUARE_PHASE_2B2B3_SYNTHETIC_CANARIES);
const sensitiveValues = [
  ...canaries,
  ...Object.values(square.SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS),
  ...Object.values(square.SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS),
  "sq2b2b3OrderCursor001==",
  "sq2b2b3-provider-secret",
  "sq2b2b3-attacker-key"
];
const sensitivePattern = new RegExp(
  sensitiveValues.map(escapeRegExp).join("|"),
  "i"
);
const excludedValuePattern = new RegExp(
  canaries.map(escapeRegExp).join("|"),
  "i"
);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clone(value) {
  return structuredClone(value);
}

function jsonValueCount(value) {
  let count = 0;
  const pending = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    count += 1;
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
    } else if (candidate !== null && typeof candidate === "object") {
      pending.push(...Object.values(candidate));
    }
  }
  return count;
}

function freezeTreeForTest(value, skipped = new Set(), seen = new Set()) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    skipped.has(value) ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      freezeTreeForTest(descriptor.value, skipped, seen);
    }
  }
  Object.freeze(value);
  return value;
}

function parserInput(response, operation = "retrieve_order", overrides = {}) {
  return square.squarePhase2B2B3ParserInput(response, operation, overrides);
}

function observeParserResult(result, parserName, tenderParser) {
  invokedParsers.add(parserName);
  if (tenderParser) tenderParserOutcomes.add(result.outcome);
  equal(Array.isArray(result.diagnostics), true, "every outcome has diagnostics");
  for (const diagnostic of result.diagnostics) {
    equal(
      diagnostic.field === "$input" || diagnostic.field === "$response",
      true,
      "every diagnostic is reduced to a static root"
    );
  }
  const diagnostics = JSON.stringify(result.diagnostics);
  doesNotMatch(diagnostics, sensitivePattern, "diagnostics omit provider values");
  doesNotMatch(
    diagnostics,
    /payload|stack|cause|request body|response body|provider-secret/i,
    "diagnostics omit raw operational data"
  );
  return result;
}

function parseWith(parserName, response, operation = "retrieve_order", overrides = {}) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square[parserName](parserInput(response, operation, overrides)),
    parserName,
    parserName === "parseSquareOrderTenderResponse"
  );
}

function parseTenders(response, operation = "retrieve_order", overrides = {}) {
  return parseWith(
    "parseSquareOrderTenderResponse",
    response,
    operation,
    overrides
  );
}

function parseTenderInput(input) {
  fixtureScenarioCount += 1;
  return observeParserResult(
    square.parseSquareOrderTenderResponse(input),
    "parseSquareOrderTenderResponse",
    true
  );
}

function accepted(result, message) {
  equal(result.outcome, "accepted", message);
  return result.value;
}

function rejected(result, message) {
  equal(result.outcome, "rejected", message);
}

function unsupported(result, message) {
  equal(result.outcome, "unsupported", message);
}

function incompatible(result, message) {
  equal(result.outcome, "incompatible-version", message);
}

function assertInternalRejection(result, message) {
  rejected(result, message);
  deepEqual(
    result.diagnostics,
    [{ code: "square_response_internal_rejection", field: "$response" }],
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

function assertFingerprint(value, message) {
  matches(value, /^sha256:[a-f0-9]{64}$/, `${message}: SHA-256 shape`);
  doesNotMatch(value, sensitivePattern, `${message}: no raw provider value`);
}

function tenderDetail(
  response,
  orderId = square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID
) {
  const detail = response.items.find(
    (candidate) =>
      candidate.adjustmentDetail.lineItemDetail.core.id === orderId
  );
  ok(detail, `response contains Tender detail for ${orderId}`);
  return detail;
}

function tender(
  detail,
  id = square.SQUARE_PHASE_2B2B3_SYNTHETIC_TENDER_IDS.card
) {
  const value = detail.tenders.find((candidate) => candidate.id === id);
  ok(value, `detail contains Tender ${id}`);
  return value;
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
  return sourceFile.statements
    .filter(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    )
    .map((statement) => statement.name.text)
    .filter((name) => /^parseSquareOrder[A-Za-z0-9]+Response$/.test(name));
}

function testEnvelopeCompositionAndNullability() {
  const retrieve = accepted(
    parseTenders(clone(orderFixtures.retrieve)),
    "Retrieve Tender envelope is accepted"
  );
  const adjustments = accepted(
    parseWith(
      "parseSquareOrderAdjustmentResponse",
      clone(orderFixtures.retrieve)
    ),
    "the same response remains accepted by the adjustment parser"
  );
  deepEqual(
    retrieve.items[0].adjustmentDetail,
    adjustments.items[0],
    "Tender detail composes the unchanged adjustment projection"
  );
  equal(retrieve.operation, "retrieve_order", "Retrieve operation is bound");
  equal(retrieve.itemCount, 1, "Retrieve contains one Order detail");
  equal(
    retrieve.items[0].entityType,
    "order_tender_detail",
    "Tender detail type is explicit"
  );
  equal(retrieve.items[0].tenderCount, 10, "all pinned Tender types are retained");
  deepEqual(
    retrieve.items[0].tenders.map(({ type }) => type).sort(),
    [...square.SQUARE_ORDER_TENDER_TYPES].sort(),
    "every pinned Tender type is accepted without remapping"
  );

  const batch = accepted(
    parseTenders(clone(orderFixtures.batch), "orders_batch_retrieve"),
    "Batch Tender envelope is accepted"
  );
  equal(batch.itemCount, 2, "Batch retains both Orders");
  deepEqual(
    batch.items.map(
      ({ adjustmentDetail }) => adjustmentDetail.lineItemDetail.core.id
    ),
    [
      square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID,
      square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_ORDER_ID
    ],
    "Batch Orders are canonicalized by Order identity"
  );

  const search = accepted(
    parseTenders(clone(orderFixtures.search), "orders_search"),
    "Search Tender envelope is accepted"
  );
  equal(search.pagination.cursorPresent, true, "Search cursor presence is retained");
  assertFingerprint(
    search.pagination.cursorFingerprint,
    "Search cursor remains an opaque fingerprint"
  );
  doesNotMatch(
    JSON.stringify(search),
    /sq2b2b3OrderCursor001==/,
    "raw cursor is not retained"
  );

  for (const [name, fixture] of [
    ["missing", orderFixtures.missingTenders],
    ["null", orderFixtures.nullTenders],
    ["empty", orderFixtures.emptyTenders]
  ]) {
    const value = accepted(
      parseTenders(clone(fixture)),
      `${name} Tender collection is accepted`
    );
    deepEqual(value.items[0].tenders, [], `${name} Tenders normalize to empty`);
    equal(value.items[0].tenderCount, 0, `${name} Tender count is zero`);
  }

  const missing = tenderDetail(
    accepted(
      parseTenders(clone(orderFixtures.missingTenderFields)),
      "missing optional Tender fields are accepted"
    )
  ).tenders[0];
  const nullable = tenderDetail(
    accepted(
      parseTenders(clone(orderFixtures.nullTenderFields)),
      "null optional Tender fields are accepted"
    )
  ).tenders[0];
  deepEqual(missing, nullable, "missing and null optional Tender fields normalize identically");
  equal(missing.id, null, "missing Tender ID remains explicitly absent");
  equal(missing.authority.identityState, "absent", "missing ID grants no Tender identity");
  equal(missing.authority.tenderId, null, "missing ID is absent from authority");
  equal(missing.locationId, null, "missing Tender location remains absent");
  equal(missing.createdAt, null, "missing Tender timestamp remains absent");
  equal(missing.amountMoney, null, "missing Tender amount remains absent");
  equal(missing.tipMoney, null, "missing Tender tip remains absent");
  equal(missing.paymentReference, null, "missing Payment reference remains absent");
}

function testTenderIdentityTypesAndRelationships() {
  const parsed = accepted(
    parseTenders(clone(orderFixtures.retrieve)),
    "Tender relationship fixture is accepted"
  );
  const detail = tenderDetail(parsed);
  const card = tender(detail);
  equal(card.authority.entityType, "order_tender", "Tender authority type is explicit");
  equal(card.authority.orderId, square.SQUARE_PHASE_2B2A_SYNTHETIC_ORDER_ID, "Tender is bound to its Order");
  equal(card.authority.locationId, square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID, "Tender authority is bound to the authorized Order location");
  equal(card.authority.identityState, "provider_id", "present Tender ID is authoritative only as Tender identity");
  equal(card.authority.tenderId, card.id, "Tender authority retains its own ID");
  equal(card.locationId, square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID, "provider Tender location is retained when present");
  deepEqual(
    card.paymentReference,
    {
      providerKey: "square",
      providerEnvironment: "sandbox",
      referenceKind: "payment",
      reconciliationState: "unverified",
      providerId: square.SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS.card
    },
    "Payment ID remains a separate unverified reference"
  );
  equal("connectionId" in card.paymentReference, false, "Payment reference grants no connection authority");
  equal("locationId" in card.paymentReference, false, "Payment reference grants no location authority");
  equal("providerEntityId" in card.paymentReference, false, "Payment reference grants no merchant authority");

  for (const type of square.SQUARE_ORDER_TENDER_TYPES) {
    const order = square.squarePhase2B2B2Order({
      tenders: [square.squarePhase2B2B3Tender({ type })]
    });
    const value = accepted(
      parseTenders(responseWithOrder(order)),
      `${type} is accepted exactly as pinned`
    );
    equal(tenderDetail(value).tenders[0].type, type, `${type} is not remapped`);
  }
  for (const type of [undefined, null, "UNKNOWN", "EXTERNAL", 1, {}, []]) {
    const value = square.squarePhase2B2B3Tender({ type });
    if (type === undefined) delete value.type;
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [value] }))),
      "missing, null, malformed, or unknown Tender type rejects"
    );
  }

  const noSale = square.squarePhase2B2B3Tender({
    type: "NO_SALE",
    amount_money: null,
    tip_money: null,
    payment_id: null
  });
  accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [noSale] }))),
    "NO_SALE does not invent amount, tip, or Payment requirements"
  );

  for (const key of ["id", "payment_id"]) {
    for (const value of ["", 1, false, [], {}, "x".repeat(193), "bad\u0000id"] ) {
      rejected(
        parseTenders(responseWithOrder(square.squarePhase2B2B2Order({
          tenders: [square.squarePhase2B2B3Tender({ [key]: value })]
        }))),
        `malformed ${key} rejects`
      );
    }
  }

  const missingLocation = square.squarePhase2B2B3Tender();
  delete missingLocation.location_id;
  const missingLocationValue = accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [missingLocation] }))),
    "missing Tender location is permitted by the pinned serializer"
  );
  const missingLocationTender = tenderDetail(missingLocationValue).tenders[0];
  equal(missingLocationTender.locationId, null, "missing provider location stays absent");
  equal(missingLocationTender.authority.locationId, square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID, "containing Order still supplies the authorized location fence");
  rejected(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({
      tenders: [square.squarePhase2B2B3Tender({ location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID })]
    }))),
    "Tender cannot escape its containing Order location"
  );

  const duplicate = square.squarePhase2B2B3Tender();
  rejected(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [duplicate, clone(duplicate)] }))),
    "duplicate Tender ID in one Order rejects"
  );
  const sharedId = "SQ2B2B3CROSSORDERTENDER";
  rejected(
    parseTenders(
      {
        orders: [
          square.squarePhase2B2B3Order({ tenders: [square.squarePhase2B2B3Tender({ id: sharedId })] }),
          square.squarePhase2B2B3SecondOrder({ tenders: [square.squarePhase2B2B3Tender({
            id: sharedId,
            location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_SECOND_LOCATION_ID,
            amount_money: { amount: 1, currency: "CAD" },
            tip_money: null
          })] })
        ]
      },
      "orders_batch_retrieve"
    ),
    "one Tender ID cannot claim two Orders"
  );

  const sharedPaymentId = square.SQUARE_PHASE_2B2B3_SYNTHETIC_PAYMENT_IDS.shared;
  const sharedPayment = accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({
      tenders: [
        square.squarePhase2B2B3Tender({ id: "SQ2B2B3SHAREDA", payment_id: sharedPaymentId }),
        square.squarePhase2B2B3Tender({ id: "SQ2B2B3SHAREDB", payment_id: sharedPaymentId })
      ]
    }))),
    "the same Payment reference may appear on multiple distinct Tenders"
  );
  equal(
    tenderDetail(sharedPayment).tenders.filter(
      ({ paymentReference }) => paymentReference?.providerId === sharedPaymentId
    ).length,
    2,
    "Payment reference repetition is not mistaken for Tender identity"
  );

  for (const createdAt of ["not-a-time", "2026-08-19", "x".repeat(33), 1, {}, []]) {
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({
        tenders: [square.squarePhase2B2B3Tender({ created_at: createdAt })]
      }))),
      "invalid or overlong Tender timestamp rejects"
    );
  }
}

function testMoneyAndTipSemantics() {
  const value = accepted(
    parseTenders(clone(orderFixtures.retrieve)),
    "Tender Money fixture is accepted"
  );
  const card = tender(tenderDetail(value));
  equal(card.amountMoney.amountMinor, "650", "Tender amount is retained exactly");
  equal(card.tipMoney.amountMinor, "150", "Tender tip is retained separately");
  equal("collectedMoney" in card, false, "no amount-plus-tip total is derived");
  equal("netSalesMoney" in card, false, "no accounting fact is derived");

  const moneyCases = [
    [{ amount: Number.MAX_SAFE_INTEGER, currency: "USD" }, String(Number.MAX_SAFE_INTEGER)],
    [{ amount: Number.MIN_SAFE_INTEGER, currency: "USD" }, String(Number.MIN_SAFE_INTEGER)],
    [{ amount: 0, currency: "USD" }, "0"],
    [{ amount: -250, currency: "USD" }, "-250"],
    [{}, null]
  ];
  for (const [amountMoney, expected] of moneyCases) {
    const parsed = accepted(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({
        tenders: [square.squarePhase2B2B3Tender({ amount_money: amountMoney, tip_money: null })]
      }))),
      "signed safe-integer or empty Tender Money is accepted"
    );
    equal(tenderDetail(parsed).tenders[0].amountMoney.amountMinor, expected, "Money amount is exact canonical text");
  }

  const absentMoneyTender = square.squarePhase2B2B3Tender();
  delete absentMoneyTender.amount_money;
  delete absentMoneyTender.tip_money;
  const absentMoney = tenderDetail(accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [absentMoneyTender] }))),
    "absent Money fields are accepted"
  )).tenders[0];
  const nullMoney = tenderDetail(accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({ amount_money: null, tip_money: null })] }))),
    "null Money fields are accepted"
  )).tenders[0];
  deepEqual(absentMoney, nullMoney, "absent and null Tender Money normalize identically");

  const emptyMoney = tenderDetail(accepted(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({ amount_money: {}, tip_money: {} })] }))),
    "empty Money objects are accepted distinctly"
  )).tenders[0];
  deepEqual(emptyMoney.amountMoney, { amountMinor: null, currency: null }, "empty amount Money remains present");
  deepEqual(emptyMoney.tipMoney, { amountMinor: null, currency: null }, "empty tip Money remains present");
  notEqual(JSON.stringify(emptyMoney.amountMoney), JSON.stringify(absentMoney.amountMoney), "empty and absent Money remain distinct");

  for (const amount of [1.5, Number.MAX_SAFE_INTEGER + 1, "1", 1e100, -0]) {
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({ amount_money: { amount, currency: "USD" } })] }))),
      "fractional, unsafe, string, non-finite-range, or negative-zero Money rejects"
    );
  }
  for (const money of [[], "money", 1, false]) {
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({ amount_money: money })] }))),
      "malformed present Tender Money rejects"
    );
  }
  rejected(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({
      amount_money: { amount: 650, currency: "USD" },
      tip_money: { amount: 150, currency: "CAD" }
    })] }))),
    "Tender amount and tip currencies must agree"
  );
  rejected(
    parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [square.squarePhase2B2B3Tender({
      amount_money: { amount: 650, currency: "CAD" },
      tip_money: null
    })] }))),
    "Tender currency cannot conflict with its containing Order"
  );
  accepted(
    parseTenders(clone(orderFixtures.batch), "orders_batch_retrieve"),
    "different currencies on separate Orders remain valid"
  );
}

function testMinimizationDeterminismAndFingerprints() {
  const baseline = accepted(
    parseTenders(clone(orderFixtures.retrieve)),
    "fingerprint baseline is accepted"
  );
  const detail = tenderDetail(baseline);
  const serialized = JSON.stringify(baseline);
  doesNotMatch(
    serialized,
    excludedValuePattern,
    "excluded-field canaries do not survive minimization"
  );
  doesNotMatch(
    serialized,
    /"(?:transactionId|note|processingFeeMoney|customerId|cardDetails|cashDetails|bankAccountDetails|buyNowPayLaterDetails|squareAccountDetails|additionalRecipients|pan|bin|lastFour|fingerprint|entryMethod|verification|giftCard|wallet)":/i,
    "instrument, customer, fee, transaction, and free-text fields are absent"
  );

  sampleDetailFingerprint = square.squareOrderTenderDetailFingerprint(detail);
  sampleResponseFingerprint = square.squareOrderTenderResponseFingerprint(baseline);
  assertFingerprint(sampleDetailFingerprint, "Tender detail fingerprint");
  assertFingerprint(sampleResponseFingerprint, "Tender response fingerprint");
  equal(sampleDetailFingerprint, EXPECTED_ORDER_TENDER_DETAIL_FINGERPRINT, "Tender detail fingerprint is pinned");
  equal(sampleResponseFingerprint, EXPECTED_ORDER_TENDER_RESPONSE_FINGERPRINT, "Tender response fingerprint is pinned");

  const reorderedOrder = clone(orderFixtures.retrieve.order);
  reorderedOrder.tenders.reverse();
  const reordered = accepted(
    parseTenders({ order: reorderedOrder }),
    "provider-reordered Tenders are accepted"
  );
  deepEqual(reordered, baseline, "Tender output is independent of provider ordering");
  equal(square.squareOrderTenderResponseFingerprint(reordered), sampleResponseFingerprint, "Tender response fingerprint is permutation-stable");

  const changedExcludedOrder = clone(orderFixtures.retrieve.order);
  const excluded = changedExcludedOrder.tenders[0];
  Object.assign(excluded, {
    transaction_id: "changed-transaction",
    note: "changed note",
    processing_fee_money: { amount: 999, currency: "EUR" },
    customer_id: "changed-customer",
    card_details: { card: { number: "changed-pan" } },
    cash_details: { changed: true },
    bank_account_details: { changed: true },
    buy_now_pay_later_details: { changed: true },
    square_account_details: { changed: true },
    additional_recipients: [{ description: "changed recipient" }],
    gift_card_details: { changed: true },
    wallet_details: { changed: true },
    future_provider_text: "changed free text"
  });
  const changedExcluded = accepted(
    parseTenders({ order: changedExcludedOrder }),
    "changed excluded Tender details remain safely discarded"
  );
  deepEqual(changedExcluded, baseline, "excluded details are projection-neutral");
  equal(square.squareOrderTenderResponseFingerprint(changedExcluded), sampleResponseFingerprint, "excluded details are fingerprint-neutral");

  const changes = [
    ["identity", { id: "SQ2B2B3TENDERCHANGED" }],
    ["location presence", { location_id: null }],
    ["timestamp", { created_at: "2026-08-19T16:20:31Z" }],
    ["type", { type: "CASH" }],
    ["amount", { amount_money: { amount: 651, currency: "USD" } }],
    ["tip", { tip_money: { amount: 151, currency: "USD" } }],
    ["Payment reference", { payment_id: "SQ2B2B3PAYMENTCHANGED" }]
  ];
  for (const [label, overrides] of changes) {
    const order = clone(orderFixtures.retrieve.order);
    Object.assign(order.tenders[0], overrides);
    const changed = accepted(parseTenders({ order }), `${label} change is accepted`);
    notEqual(
      square.squareOrderTenderDetailFingerprint(tenderDetail(changed)),
      sampleDetailFingerprint,
      `${label} changes the Tender detail fingerprint`
    );
  }

  const withoutCursor = accepted(
    parseTenders({ orders: [square.squarePhase2B2B3Order()] }, "orders_search"),
    "Search without cursor is accepted"
  );
  const withCursor = accepted(
    parseTenders({ orders: [square.squarePhase2B2B3Order()], cursor: "opaqueCursor==" }, "orders_search"),
    "Search with cursor is accepted"
  );
  equal(
    square.squareOrderTenderDetailFingerprint(tenderDetail(withoutCursor)),
    square.squareOrderTenderDetailFingerprint(tenderDetail(withCursor)),
    "cursor is outside the entity detail fingerprint"
  );
  notEqual(
    square.squareOrderTenderResponseFingerprint(withoutCursor),
    square.squareOrderTenderResponseFingerprint(withCursor),
    "cursor changes only the response control fingerprint"
  );

  const oldFixture = clone(square.SQUARE_PHASE_2B2B2_ORDER_FIXTURES.retrieve);
  const core = accepted(parseWith("parseSquareOrderCoreResponse", clone(oldFixture)), "preserved core fixture is accepted");
  const line = accepted(parseWith("parseSquareOrderLineItemResponse", clone(oldFixture)), "preserved line-item fixture is accepted");
  const adjustment = accepted(parseWith("parseSquareOrderAdjustmentResponse", clone(oldFixture)), "preserved adjustment fixture is accepted");
  equal(square.squareOrderCoreFingerprint(core.items[0]), EXPECTED_ORDER_CORE_ENTITY_FINGERPRINT, "core entity fingerprint is unchanged");
  equal(square.squareOrderCoreResponseFingerprint(core), EXPECTED_ORDER_CORE_RESPONSE_FINGERPRINT, "core response fingerprint is unchanged");
  equal(square.squareOrderLineItemDetailFingerprint(line.items[0]), EXPECTED_ORDER_LINE_ITEM_DETAIL_FINGERPRINT, "line-item detail fingerprint is unchanged");
  equal(square.squareOrderLineItemResponseFingerprint(line), EXPECTED_ORDER_LINE_ITEM_RESPONSE_FINGERPRINT, "line-item response fingerprint is unchanged");
  equal(square.squareOrderAdjustmentDetailFingerprint(adjustment.items[0]), EXPECTED_ORDER_ADJUSTMENT_DETAIL_FINGERPRINT, "adjustment detail fingerprint is unchanged");
  equal(square.squareOrderAdjustmentResponseFingerprint(adjustment), EXPECTED_ORDER_ADJUSTMENT_RESPONSE_FINGERPRINT, "adjustment response fingerprint is unchanged");
}

function testEnvelopeStructuralAndDiagnosticSafety() {
  rejected(parseTenders({}), "Retrieve without Order or provider error fails closed");
  rejected(parseTenders({ order: null }), "Retrieve with null Order fails closed");
  unsupported(parseTenders({ errors: [{ code: "NOT_FOUND" }] }), "provider error envelope is unsupported");
  unsupported(
    parseTenders({ errors: [{ code: "INTERNAL" }], order: square.squarePhase2B2B3Order() }),
    "provider error and data cannot produce trusted output"
  );
  for (const value of [[], {}, "entries", 1, false]) {
    const result = parseTenders(
      { orders: [square.squarePhase2B2B3Order()], order_entries: value },
      "orders_search"
    );
    equal(
      result.outcome === "rejected" || result.outcome === "unsupported",
      true,
      "every non-null order_entries representation fails closed"
    );
  }
  for (const [operation, response] of [
    ["orders_batch_retrieve", {}],
    ["orders_batch_retrieve", { orders: null }],
    ["orders_batch_retrieve", { orders: [] }],
    ["orders_search", {}],
    ["orders_search", { orders: null }],
    ["orders_search", { orders: [] }]
  ]) {
    const value = accepted(parseTenders(response, operation), `${operation} empty shape is accepted`);
    deepEqual(value.items, [], `${operation} empty shape normalizes to no items`);
  }

  for (const tenders of [{}, "tenders", 1, false]) {
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders }))),
      "malformed Tender collection rejects"
    );
  }
  for (const item of [null, "tender", 1, false, []]) {
    rejected(
      parseTenders(responseWithOrder(square.squarePhase2B2B2Order({ tenders: [item] }))),
      "malformed Tender element rejects"
    );
  }

  let accessorCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "sq2b2b3-provider-secret";
    }
  });
  const cycle = {};
  cycle.self = cycle;
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
  for (const attack of [
    accessor,
    Object.create({ inherited: true }),
    cycle,
    sparse,
    customArray,
    symbolObject,
    oversizedObject,
    deep,
    "x".repeat(4_097),
    Number.MAX_SAFE_INTEGER + 1,
    -0
  ]) {
    const order = square.squarePhase2B2B3Order();
    order.tenders[0].card_details = { attack };
    rejected(
      parseTenders(responseWithOrder(order)),
      "hostile structure in excluded Tender detail fails before minimization"
    );
  }
  equal(accessorCalls, 0, "provider accessor is never invoked");

  const keyedOrder = square.squarePhase2B2B3Order();
  keyedOrder.tenders[0]["sq2b2b3-attacker-key"] = "x".repeat(4_097);
  const keyedResult = parseTenders(responseWithOrder(keyedOrder));
  rejected(keyedResult, "provider-controlled key attack rejects");
  equal(keyedResult.diagnostics[0].field, "$response", "provider key cannot enter diagnostic path");

  rejected(
    parseTenderInput({ ...parserInput({}), unknown_input: true }),
    "unknown caller input key rejects"
  );
  incompatible(
    parseTenderInput(parserInput({}, "retrieve_order", { apiVersion: "2026-07-15" })),
    "unreviewed API version is incompatible"
  );
}

function testRawAndProjectionBoundsAcrossParsers() {
  const maximumTenders = Array.from({ length: 1_000 }, (_, index) => ({
    id: `SQ2B2B3MAXTENDER${String(index).padStart(4, "0")}`,
    location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
    created_at: "2026-08-19T16:20:21Z",
    type: "CARD",
    amount_money: { amount: index, currency: "USD" },
    tip_money: { amount: 0, currency: "USD" },
    payment_id: `SQ2B2B3MAXPAYMENT${String(index).padStart(4, "0")}`
  }));
  const maximumTenderResponse = responseWithOrder(
    square.squarePhase2B2B2Order({ tenders: maximumTenders })
  );
  for (const parserName of exportedOrderParsers()) {
    const value = accepted(
      parseWith(parserName, clone(maximumTenderResponse)),
      `${parserName} accepts the maximum bounded Tender array`
    );
    equal(value.itemCount, 1, `${parserName} retains the containing Order`);
  }
  const oversizedTenderResponse = responseWithOrder(
    square.squarePhase2B2B2Order({
      tenders: [...maximumTenders, { id: "SQ2B2B3MAXTENDER1000", type: "NO_SALE" }]
    })
  );
  for (const parserName of exportedOrderParsers()) {
    rejected(
      parseWith(parserName, clone(oversizedTenderResponse)),
      `${parserName} rejects a raw array above the shared 1,000-item bound`
    );
  }

  const orderIds = Array.from({ length: 5 }, (_, index) => `SQ2B2B3MAXORDER${index}`);
  const counts = [1_000, 1_000, 1_000, 1_000, 994];
  const rawBudgetOrders = counts.map((count, orderIndex) => ({
    id: orderIds[orderIndex],
    location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID,
    line_items: Array.from({ length: count }, (_, lineIndex) => ({
      uid: `M${orderIndex}${lineIndex}`,
      quantity: "1",
      base_price_money: {}
    }))
  }));
  const requestContext = {
    orderIds,
    locationId: null,
    authorizedLocationIds: [square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID]
  };
  for (const parserName of exportedOrderParsers()) {
    const value = accepted(
      parseWith(
        parserName,
        { orders: clone(rawBudgetOrders) },
        "orders_batch_retrieve",
        { requestContext }
      ),
      `${parserName} accepts the 19,998-value bounded response maximum`
    );
    equal(value.itemCount, 5, `${parserName} preserves all raw-budget probe Orders`);
  }
  rawBudgetOrders[4].line_items.push({
    uid: "M4OVER",
    quantity: "1",
    base_price_money: {}
  });
  for (const parserName of exportedOrderParsers()) {
    rejected(
      parseWith(
        parserName,
        { orders: clone(rawBudgetOrders) },
        "orders_batch_retrieve",
        { requestContext }
      ),
      `${parserName} rejects before projection when the 20,000-value raw budget is exceeded`
    );
  }

  const maximumSearchOrders = Array.from({ length: 1_000 }, (_, index) => ({
    id: `SQ2B2B3MAXSEARCHORDER${String(index).padStart(4, "0")}`,
    location_id: square.SQUARE_PHASE_2B2A_SYNTHETIC_LOCATION_ID
  }));
  const maximumSearchLineItemCounts = [1_000, 1_000, 1_000, 1_000, 248];
  maximumSearchLineItemCounts.forEach((count, orderIndex) => {
    maximumSearchOrders[orderIndex].line_items = Array.from(
      { length: count },
      (_, lineIndex) => ({
        uid: `S${orderIndex}${lineIndex}`,
        quantity: "1",
        base_price_money: {}
      })
    );
  });
  maximumSearchOrders[999].future_provider_field = true;
  const maximumSearchResponse = { orders: maximumSearchOrders };
  equal(
    jsonValueCount(maximumSearchResponse),
    20_000,
    "maximum Search regression reaches the accepted raw-value ceiling"
  );
  let maximumSearchTender;
  for (const parserName of exportedOrderParsers()) {
    const value = accepted(
      parseWith(
        parserName,
        clone(maximumSearchResponse),
        "orders_search"
      ),
      `${parserName} accepts the 20,000-value maximum Search response`
    );
    equal(
      value.itemCount,
      1_000,
      `${parserName} retains all maximum Search Orders`
    );
    if (parserName === "parseSquareOrderTenderResponse") {
      maximumSearchTender = value;
    }
  }
  ok(maximumSearchTender, "maximum Search response reaches the Tender parser");
  ok(
    maximumSearchTender.items.every(
      ({ tenderCount, tenders }) => tenderCount === 0 && tenders.length === 0
    ),
    "omitted Tenders stay empty across every maximum Search Order"
  );
  deepEqual(
    maximumSearchTender.items[999].tenders,
    [],
    "omitted Tenders remain an empty collection at the maximum Search bound"
  );
}

function testExceptionContainedAcceptedBoundary() {
  const throwingInput = new Proxy(parserInput({}), {
    ownKeys() {
      throw new Error("sq2b2b3-provider-secret");
    }
  });
  assertInternalRejection(
    parseTenderInput(throwingInput),
    "raw parser exception is contained"
  );

  const originalFailureResult = squareResponseValidation.squareFailureResult;
  const originalAcceptedResult = squareResponseValidation.squareAcceptedResult;
  const replayCandidate = parseTenders(clone(orderFixtures.retrieve));
  accepted(replayCandidate, "accepted replay candidate is available");
  try {
    squareResponseValidation.squareAcceptedResult = () => replayCandidate;
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "accepted result cannot be replayed across invocations"
    );

    const forgedValue = freezeTreeForTest(clone(replayCandidate.value));
    squareResponseValidation.squareAcceptedResult = () => Object.freeze({
      outcome: "accepted",
      value: forgedValue,
      diagnostics: Object.freeze([])
    });
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "shape-correct frozen forgery lacks current-invocation authentication"
    );

    let proxyTrapCalls = 0;
    squareResponseValidation.squareAcceptedResult = (value) =>
      new Proxy(originalAcceptedResult(value), {
        getPrototypeOf(target) {
          proxyTrapCalls += 1;
          return Reflect.getPrototypeOf(target);
        }
      });
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "proxied accepted result rejects before reflection"
    );
    equal(proxyTrapCalls, 0, "accepted-result Proxy trap is never invoked");

    let accessorCalls = 0;
    squareResponseValidation.squareAcceptedResult = (value) => {
      Object.defineProperty(value.items[0], "entityType", {
        configurable: true,
        enumerable: true,
        get() {
          accessorCalls += 1;
          throw new Error("sq2b2b3-provider-secret");
        }
      });
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "accepted accessor rejects without execution"
    );
    equal(accessorCalls, 0, "accepted accessor is never invoked");

    squareResponseValidation.squareAcceptedResult = (value) => {
      value.provider = value;
      return originalAcceptedResult(value);
    };
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "cyclic accepted result rejects deterministically"
    );

    const originalSchemaSafeParse = square.SquareOrderTenderResponseSchema.safeParse;
    let safeParseCalls = 0;
    try {
      square.SquareOrderTenderResponseSchema.safeParse = (...args) => {
        safeParseCalls += 1;
        return originalSchemaSafeParse(...args);
      };
      squareResponseValidation.squareAcceptedResult = (value) => {
        const shared = Array.from({ length: 52 }, () => ({}));
        value.provider = Array.from({ length: 1_000 }, () => shared);
        return originalAcceptedResult(value);
      };
      assertInternalRejection(
        parseTenders(clone(orderFixtures.retrieve)),
        "expanded shared-container graph rejects at the canonical preflight"
      );
      equal(safeParseCalls, 1, "oversized canonical graph rejects before boundary schema revalidation");
    } finally {
      square.SquareOrderTenderResponseSchema.safeParse = originalSchemaSafeParse;
    }

    squareResponseValidation.squareAcceptedResult = () => {
      throw new Error("sq2b2b3-provider-secret");
    };
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
      "accepted-result factory exception becomes static rejection"
    );
    squareResponseValidation.squareFailureResult = () => {
      throw new Error("sq2b2b3-provider-secret");
    };
    assertInternalRejection(
      parseTenders(clone(orderFixtures.retrieve)),
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
    const returned = parseTenders(clone(orderFixtures.retrieve));
    equal(returned, legitimateResult, "legitimate Tender accepted result retains identity");
    assertDeeplyFrozen(returned, "legitimate Tender accepted result");
  } finally {
    squareResponseValidation.squareAcceptedResult = originalAcceptedResult;
  }
}

function testDeepFreezeAndCallerIsolation() {
  const mutableResponse = clone(orderFixtures.retrieve);
  const parsed = parseTenders(mutableResponse);
  const value = accepted(parsed, "deep-freeze fixture is accepted");
  assertDeeplyFrozen(parsed, "Tender parser result");
  const detail = tenderDetail(value);
  const card = tender(detail);
  const snapshot = JSON.stringify(value);
  for (const mutate of [
    () => value.items.push(detail),
    () => detail.tenders.push(card),
    () => Object.defineProperty(card, "type", { value: "CASH" }),
    () => Object.defineProperty(card.authority, "tenderId", { value: "changed" }),
    () => Object.defineProperty(card.paymentReference, "providerId", { value: "changed" }),
    () => Object.defineProperty(card.amountMoney, "amountMinor", { value: "999" }),
    () => Object.defineProperty(card.tipMoney, "currency", { value: "CAD" }),
    () => Object.defineProperty(detail.adjustmentDetail.lineItemDetail.core, "id", { value: "changed" })
  ]) {
    throws(mutate, /Cannot|read only|extensible|frozen/i, "trusted Tender tree resists mutation");
  }
  equal(JSON.stringify(value), snapshot, "mutation attempts leave Tender result unchanged");
  mutableResponse.order.tenders[0].amount_money.amount = 999;
  mutableResponse.order.tenders[0].payment_id = "caller-change";
  equal(JSON.stringify(value), snapshot, "caller mutation cannot change accepted projection");
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
  equal(square.SQUARE_API_VERSION, "2026-08-19", "Square API version is pinned");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_VERSION, "45.1.0", "SDK version is pinned");
  equal(square.SQUARE_ORDER_RESPONSE_SDK_REVISION, "e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76", "SDK revision is pinned");
  equal(square.SQUARE_ORDER_TENDER_RESPONSE_CONTRACT_VERSION, "square_order_tender_response_v1", "Tender response contract is separate");
  equal(square.SQUARE_ORDER_TENDER_MINIMIZATION_VERSION, "square_order_tender_minimizer_v1", "Tender minimizer is separate");
  equal(square.SQUARE_ORDER_TENDER_ENTITY_VERSION, 1, "Tender entity version is explicit");
  deepEqual(
    square.SQUARE_ORDER_TENDER_TRUSTED_RESPONSE_FIELDS,
    ["id", "location_id", "created_at", "type", "amount_money", "tip_money", "payment_id"],
    "trusted Tender field inventory is minimal and explicit"
  );
  deepEqual(
    square.SQUARE_ORDER_TENDER_DISCARDED_RESPONSE_FIELDS,
    ["transaction_id", "note", "processing_fee_money", "customer_id", "card_details", "cash_details", "bank_account_details", "buy_now_pay_later_details", "square_account_details", "additional_recipients"],
    "documented sensitive and later-Payment Tender fields are discarded"
  );
  deepEqual(
    square.SQUARE_ORDER_TENDER_TYPES,
    ["CARD", "CASH", "THIRD_PARTY_CARD", "SQUARE_GIFT_CARD", "NO_SALE", "BANK_ACCOUNT", "WALLET", "BUY_NOW_PAY_LATER", "SQUARE_ACCOUNT", "OTHER"],
    "Tender type inventory matches the pinned serializer exactly"
  );
  equal(square.SQUARE_ORDER_TENDER_RESPONSE_OFFICIAL_REFERENCES.length, 18, "official Tender reference inventory is complete");
  for (const reference of square.SQUARE_ORDER_TENDER_RESPONSE_OFFICIAL_REFERENCES) {
    matches(reference, /^https:\/\/(?:developer\.squareup\.com|github\.com\/square\/square-nodejs-sdk)\//, "only official Square references are recorded");
  }

  const omitted = normalizedOrdersSearch(ordersSearchRequestBody());
  const explicitFalse = normalizedOrdersSearch(ordersSearchRequestBody({ return_entries: false }));
  deepEqual(omitted.normalizedBody, explicitFalse.normalizedBody, "Orders Search omission and false remain identical");
  equal(omitted.normalizedBody.return_entries, false, "Orders Search remains frozen to complete Orders");
  const requestDecision = ordersSearchDecision(ordersSearchRequestBody());
  equal(requestDecision.requestFingerprint, EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT, "Orders Search fingerprint is unchanged");
  equal(requestDecision.cursorBindingFingerprint, EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT, "cursor binding is unchanged");
  const continuation = ordersSearchDecision(
    ordersSearchRequestBody({ cursor: "phase2b2b3-cursor" }),
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT
  );
  equal(continuation.cursorBindingFingerprint, EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT, "cursor continuation retains the complete-Order binding");

  const descriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  equal(descriptorRegistry.descriptors[0].descriptorFingerprint, EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT, "Square descriptor fingerprint is unchanged");
  const qboRegistry = controlPlane.assertProviderDescriptorRegistry(qbo.QBO_PHASE_7_PROVIDER_REGISTRY);
  const qboEntry = qboRegistry.descriptors.find(({ descriptor }) => descriptor.providerKey === "quickbooks_online");
  ok(qboEntry, "QBO descriptor remains present");
  equal(qboEntry.descriptorFingerprint, EXPECTED_QBO_DESCRIPTOR_FINGERPRINT, "QBO descriptor fingerprint is unchanged");
  equal(qboRegistry.registryFingerprint, EXPECTED_ACTIVE_REGISTRY_FINGERPRINT, "active registry fingerprint is unchanged");
  equal(registeredProviders.REGISTERED_PROVIDER_REGISTRY.registryFingerprint, EXPECTED_ACTIVE_REGISTRY_FINGERPRINT, "registered provider fingerprint is unchanged");
  deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "QBO remains GET-only");
  throws(
    () => controlPlane.providerDescriptor("square", "sandbox", registeredProviders.REGISTERED_PROVIDER_REGISTRY),
    /provider_descriptor_not_registered/,
    "Square remains unreachable from the active registry"
  );
  throws(
    () => credentials.providerOAuthPolicy(
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

  let networkCalls = 0;
  const originalFetch = global.fetch;
  try {
    global.fetch = () => {
      networkCalls += 1;
      throw new Error("network call forbidden");
    };
    accepted(parseTenders(clone(orderFixtures.retrieve)), "Tender parser remains pure under network tripwire");
  } finally {
    global.fetch = originalFetch;
  }
  equal(networkCalls, 0, "Tender validation makes zero network calls");
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Tender validation makes zero model calls");

  const changedFiles = childProcess.execFileSync(
    "git",
    ["diff", "--name-only", "origin/main"],
    { cwd: root, encoding: "utf8" }
  ).trim();
  doesNotMatch(changedFiles, /^(app|components|supabase|services|lib\/supabase|vercel\.json)(?:\/|$)/m, "Tender phase adds no runtime, UI, database, or deployment scope");
  doesNotMatch(changedFiles, /^lib\/integrations\/providers\/(?:qbo|square\/(?:descriptor|request-validators))\//m, "QBO, Square descriptor, and request validators remain untouched");
  const tenderSources = [
    "lib/integrations/providers/square/order-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b2b3.ts"
  ].map(read).join("\n");
  doesNotMatch(tenderSources, /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|generateText|streamText|access[_-]?token|refresh[_-]?token/i, "Tender sources contain no network, database, environment, credential, or model path");
  doesNotMatch(tenderSources, /parseSquarePayment|PaymentRefund|OrderReturn|webhook|queue|migration|persist/i, "Tender sources contain no standalone Payment, refund, return, or runtime implementation");

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b2b3"],
    "node scripts/external-integrations-square-phase-2b2b3-order-tender-response-validation-regression-tests.js",
    "Tender suite is registered"
  );
  matches(ciWorkflow, /pnpm test:external-integrations-square-phase-2b2b3/, "CI runs the Tender suite");
}

testEnvelopeCompositionAndNullability();
testTenderIdentityTypesAndRelationships();
testMoneyAndTipSemantics();
testMinimizationDeterminismAndFingerprints();
testEnvelopeStructuralAndDiagnosticSafety();
testRawAndProjectionBoundsAcrossParsers();
testExceptionContainedAcceptedBoundary();
testDeepFreezeAndCallerIsolation();
testPinnedContractsDormancyAndRegistration();

deepEqual(
  [...tenderParserOutcomes].sort(),
  declaredParserOutcomes().sort(),
  "Tender suite observes every declared parser outcome"
);
deepEqual(
  [...invokedParsers].sort(),
  exportedOrderParsers().sort(),
  "Tender suite invokes every exported Order response parser"
);

const fixtureInventory = Object.keys(orderFixtures).length;
console.log(
  `External integrations Square Phase 2B.2B-3 Order Tender response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} synthetic fixture definitions. Detail ${sampleDetailFingerprint}; response ${sampleResponseFingerprint}.`
);
