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

const controlPlane = require("../lib/integrations/control-plane/provider-registry.ts");
const registeredProviders = require("../lib/integrations/control-plane/registered-provider-registry.ts");
const credentials = require("../lib/integrations/credentials/index.ts");
const qbo = require("../lib/integrations/providers/qbo/index.ts");
const qboOAuth = require("../lib/integrations/provider-runtime/qbo/oauth-policy.ts");
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

const EXPECTED_QBO_DESCRIPTOR_FINGERPRINT =
  "sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f";
const EXPECTED_QBO_REGISTRY_FINGERPRINT =
  "sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad";
const EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT =
  "sha256:fe6cc473b1fb529bc07a7c5471baf5eae047ea9500cec7c12840876dfe666771";
const EXPECTED_CATALOG_OBJECT_TYPE_DATA_KEYS = [
  "item_data",
  "image_data",
  "category_data",
  "item_variation_data",
  "tax_data",
  "discount_data",
  "modifier_list_data",
  "modifier_data",
  "pricing_rule_data",
  "product_set_data",
  "time_period_data",
  "measurement_unit_data",
  "subscription_plan_variation_data",
  "item_option_data",
  "item_option_value_data",
  "custom_attribute_definition_data",
  "quick_amounts_settings_data",
  "subscription_plan_data",
  "availability_period_data"
];

const catalogFixtures = square.SQUARE_PHASE_2B1B1_CATALOG_FIXTURES;
const catalogCanaryPattern = new RegExp(
  Object.values(square.SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
);
const sensitivePattern = new RegExp(
  [
    ...Object.values(square.SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES),
    square.SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR,
    "SQ2B1B1ITEM001",
    "SQ2B1B1VAR001",
    "SQ2B1B1CAT001",
    "SQ2B1B1LOC001"
  ]
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
);

function parserInput(response, operation = "list_catalog", overrides = {}) {
  return square.squarePhase2B1B1ParserInput(response, operation, overrides);
}

function parseCatalog(response, operation = "list_catalog", overrides = {}) {
  fixtureScenarioCount += 1;
  return square.parseSquareCatalogResponse(
    parserInput(response, operation, overrides)
  );
}

function parseCatalogRawInput(input) {
  fixtureScenarioCount += 1;
  return square.parseSquareCatalogResponse(input);
}

function assertSafeDiagnostics(result, message) {
  const serialized = JSON.stringify(result.diagnostics);
  doesNotMatch(
    serialized,
    sensitivePattern,
    `${message}: diagnostics omit raw payload data`
  );
  doesNotMatch(
    serialized,
    /bearer|token|detail/i,
    `${message}: diagnostics omit raw provider-error vocabulary`
  );
}

function expectOutcome(result, outcome, message) {
  equal(result.outcome, outcome, message);
  assertSafeDiagnostics(result, message);
  return result;
}

function accepted(result, message) {
  expectOutcome(result, "accepted", message);
  return result.value;
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

function assertProjectionClean(value, message) {
  const serialized = JSON.stringify(value);
  doesNotMatch(
    serialized,
    catalogCanaryPattern,
    `${message}: excluded canaries do not survive`
  );
  doesNotMatch(
    serialized,
    /description|description_html|ecom_uri|url|contact|email|address|coordinates|twitter|facebook|instagram|custom_attribute|modifier_list|tax_ids|reporting_category|product_type|path_to_root|included_resources|related_objects/i,
    `${message}: excluded provider field names do not survive`
  );
}

function assertFingerprintShape(fingerprint, message) {
  matches(fingerprint, /^sha256:[a-f0-9]{64}$/, `${message}: fingerprint shape`);
  doesNotMatch(
    fingerprint,
    sensitivePattern,
    `${message}: fingerprint does not expose raw identifiers`
  );
  doesNotMatch(
    fingerprint,
    /Ceremonial|Coffee|Tea|12 oz|Custom/i,
    `${message}: fingerprint does not expose business text`
  );
}

function expectFrozen(value, label) {
  ok(Object.isFrozen(value), `${label} is frozen`);
}

function noCursorListEnvelope() {
  const envelope = square.squarePhase2B1B1ListEnvelope();
  delete envelope.cursor;
  return envelope;
}

function firstCatalogObjectFingerprint(response, operation = "list_catalog") {
  const value = accepted(
    parseCatalog(response, operation),
    "catalog fingerprint input accepted"
  );
  return square.squareCatalogObjectFingerprint(value.items[0]);
}

function catalogResponseFingerprint(response, operation = "list_catalog") {
  const value = accepted(
    parseCatalog(response, operation),
    "catalog response fingerprint input accepted"
  );
  return square.squareCatalogResponseFingerprint(value);
}

function catalogVariationData(overrides = {}) {
  return {
    item_id: "SQ2B1B1ITEM001",
    name: "12 oz",
    sku: "TEA-12OZ",
    pricing_type: "FIXED_PRICING",
    price_money: { amount: 450, currency: "USD" },
    ordinal: 0,
    track_inventory: true,
    sellable: true,
    stockable: true,
    ...overrides
  };
}

function catalogItemData(overrides = {}) {
  return {
    name: "Ceremonial Tea",
    categories: [
      { id: "SQ2B1B1CATROOT", ordinal: 1 },
      { id: "SQ2B1B1CAT001", ordinal: 2 }
    ],
    variations: [square.squarePhase2B1B1ItemVariation()],
    ...overrides
  };
}

function singleVariationParentItem(variation, overrides = {}) {
  return square.squarePhase2B1B1Item({
    item_data: catalogItemData({ variations: [variation] }),
    ...overrides
  });
}

function duplicateRelationshipSearchEnvelope(nestedVariationOverrides = {}) {
  const primaryVariation = square.squarePhase2B1B1ItemVariation();
  const nestedVariation = square.squarePhase2B1B1ItemVariation(
    nestedVariationOverrides
  );
  return {
    objects: [primaryVariation],
    related_objects: [singleVariationParentItem(nestedVariation)]
  };
}

function testAcceptedEnvelopes() {
  const list = accepted(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog"),
    "ListCatalog envelope accepted"
  );
  equal(list.contractVersion, "square_catalog_response_minimized_v1", "Catalog response contract is explicit");
  equal(list.minimizationVersion, "square_catalog_minimizer_v1", "Catalog minimizer contract is explicit");
  equal(list.provider.providerKey, "square", "Catalog response provider is Square");
  equal(list.provider.providerEnvironment, "sandbox", "Catalog response binds sandbox");
  equal(list.provider.apiVersion, "2026-08-19", "Catalog response binds pinned API version");
  equal(list.operation, "list_catalog", "ListCatalog operation is retained");
  equal(list.itemCount, 2, "ListCatalog primary object count is retained");
  equal(list.relatedItemCount, 0, "ListCatalog has no related objects");
  equal(list.includedItemCount, 0, "ListCatalog has no included resources");
  equal(list.pagination.cursorPresent, true, "ListCatalog cursor presence is retained");
  assertFingerprintShape(list.pagination.cursorFingerprint, "ListCatalog cursor");
  equal(list.latestTime, null, "ListCatalog does not retain latest_time");

  const category = list.items[0];
  equal(category.entityType, "catalog_category", "CATEGORY maps to catalog_category");
  equal(category.catalogObjectType, "CATEGORY", "CATEGORY object type is retained");
  equal(category.entityVersion, 1, "Category entity version is contract-owned");
  equal(category.catalogVersion, "1787142000001", "Catalog provider version is serialized");
  equal(category.updatedAt, "2026-08-19T15:00:00.000Z", "Catalog updated_at is retained");
  equal(category.isDeleted, false, "Catalog category deletion state is retained");
  deepEqual(category.availability, { mode: "global" }, "Category availability is global");
  equal(category.displayName, "Coffee & Tea", "Category name is retained as trusted display text");
  deepEqual(
    category.parentCategory,
    { id: "SQ2B1B1CATROOT", ordinal: "0" },
    "Category parent reference is retained"
  );
  equal(category.isTopLevel, false, "Category hierarchy flag is retained");
  equal(category.authority.entityType, "catalog_category", "Category authority binds entity type");
  equal(category.authority.providerId, category.id, "Category authority binds provider identity");

  const item = list.items[1];
  equal(item.entityType, "catalog_item", "ITEM maps to catalog_item");
  equal(item.displayName, "Ceremonial Tea", "Item name is retained");
  deepEqual(
    item.availability,
    {
      mode: "all_locations_except",
      absentLocationIds: ["SQ2B1B1LOC009"]
    },
    "Item availability normalizes all-locations-except mode"
  );
  deepEqual(
    item.categoryReferences,
    [
      { id: "SQ2B1B1CATROOT", ordinal: "1" },
      { id: "SQ2B1B1CAT001", ordinal: "2" }
    ],
    "Item category references are sorted by ordinal then id"
  );
  equal(item.variationCount, 2, "Item variation count is explicit");
  deepEqual(
    item.variations.map((variation) => variation.id),
    ["SQ2B1B1VAR001", "SQ2B1B1VAR002"],
    "Nested variations are sorted by ordinal then id"
  );
  const fixedVariation = item.variations[0];
  equal(fixedVariation.entityType, "catalog_item_variation", "Nested variation maps to catalog_item_variation");
  equal(fixedVariation.parentItemId, item.id, "Variation parent item is retained");
  equal(fixedVariation.displayName, "12 oz", "Variation name is retained");
  equal(fixedVariation.sku, "TEA-12OZ", "Variation SKU is retained");
  equal(fixedVariation.pricingType, "FIXED_PRICING", "Fixed pricing type is retained");
  deepEqual(
    fixedVariation.price,
    { amountMinor: "450", currency: "USD" },
    "Fixed variation price is retained as minor-unit string"
  );
  deepEqual(
    fixedVariation.availability,
    {
      mode: "specific_locations",
      presentLocationIds: ["SQ2B1B1LOC001", "SQ2B1B1LOC002"]
    },
    "Variation availability normalizes specific locations"
  );
  equal(fixedVariation.ordinal, "0", "Variation ordinal is retained as a string");
  equal(fixedVariation.trackInventory, true, "Variation inventory tracking flag is retained");
  equal(fixedVariation.sellable, true, "Variation sellable flag is retained");
  equal(fixedVariation.stockable, true, "Variation stockable flag is retained");
  const variableVariation = item.variations[1];
  equal(variableVariation.pricingType, "VARIABLE_PRICING", "Variable pricing type is retained");
  equal(variableVariation.price, null, "Variable pricing omits price money");
  deepEqual(
    variableVariation.availability,
    {
      mode: "all_locations_except",
      absentLocationIds: ["SQ2B1B1LOC003", "SQ2B1B1LOC004"]
    },
    "Variation availability sorts absent locations"
  );

  const search = accepted(
    parseCatalog(catalogFixtures.searchCatalog, "catalog_search"),
    "SearchCatalogObjects envelope accepted"
  );
  equal(search.operation, "catalog_search", "Search operation is retained");
  equal(search.itemCount, 1, "Search primary object count is retained");
  equal(search.relatedItemCount, 1, "Search related object count is retained");
  equal(search.includedItemCount, 1, "Search included resource count is retained");
  equal(search.latestTime, "2026-08-19T15:10:00.000Z", "Search latest_time is retained");
  equal(search.pagination.cursorPresent, true, "Search cursor presence is retained");
  assertFingerprintShape(search.pagination.cursorFingerprint, "Search cursor");

  const retrieve = accepted(
    parseCatalog(
      catalogFixtures.retrieveCatalogObject,
      "retrieve_catalog_object"
    ),
    "RetrieveCatalogObject envelope accepted"
  );
  equal(retrieve.operation, "retrieve_catalog_object", "Retrieve operation is retained");
  equal(retrieve.itemCount, 1, "Retrieve maps object to one trusted item");
  equal(retrieve.relatedItemCount, 1, "Retrieve retains related objects");
  equal(retrieve.pagination.cursorPresent, false, "Retrieve has no documented cursor state");
  equal(retrieve.latestTime, null, "Retrieve has no latest_time state");

  const batch = accepted(
    parseCatalog(
      catalogFixtures.batchRetrieveCatalogObjects,
      "catalog_batch_retrieve"
    ),
    "BatchRetrieveCatalogObjects envelope accepted"
  );
  equal(batch.operation, "catalog_batch_retrieve", "Batch retrieve operation is retained");
  equal(batch.itemCount, 2, "Batch retrieve retains deleted primary objects");
  equal(batch.relatedItemCount, 1, "Batch retrieve retains deleted related objects");
  equal(batch.includedItemCount, 1, "Batch retrieve retains included resources");
  equal(batch.items[0].isDeleted, true, "Deleted category tombstone is retained");
  equal(batch.items[0].displayName, null, "Deleted category tombstone omits data fields");
  equal(batch.items[1].isDeleted, true, "Deleted item tombstone is retained");
  deepEqual(batch.items[1].variations, [], "Deleted item tombstone omits nested variations");
  equal(batch.relatedItems[0].isDeleted, true, "Deleted variation tombstone is retained");
  equal(batch.relatedItems[0].parentItemId, null, "Deleted variation tombstone omits parent data");

  const emptyList = accepted(parseCatalog(catalogFixtures.emptyList), "empty list accepted");
  equal(emptyList.itemCount, 0, "empty ListCatalog has zero items");
  equal(emptyList.pagination.cursorPresent, false, "empty ListCatalog has no cursor state");

  const emptySearch = accepted(
    parseCatalog(catalogFixtures.emptySearch, "catalog_search"),
    "empty search accepted"
  );
  equal(emptySearch.itemCount, 0, "empty SearchCatalogObjects has zero primary items");
  equal(emptySearch.relatedItemCount, 0, "empty SearchCatalogObjects has zero related items");
  equal(emptySearch.includedItemCount, 0, "empty SearchCatalogObjects has zero included items");
  equal(Object.prototype.hasOwnProperty.call(emptySearch, "errors"), false, "empty provider errors do not survive");

  const listWithoutObjects = accepted(
    parseCatalog(
      { cursor: square.SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR },
      "list_catalog"
    ),
    "ListCatalog absent objects accepted as empty"
  );
  equal(listWithoutObjects.itemCount, 0, "ListCatalog absent objects has zero items");
  equal(
    listWithoutObjects.pagination.cursorPresent,
    true,
    "ListCatalog absent objects preserves cursor state"
  );
  assertFingerprintShape(
    listWithoutObjects.pagination.cursorFingerprint,
    "ListCatalog absent objects cursor"
  );

  const searchWithoutObjects = accepted(
    parseCatalog(
      {
        related_objects: [
          square.squarePhase2B1B1Category({
            id: "SQ2B1B1CATREL002",
            category_data: { name: "Related Empty Search", is_top_level: true }
          })
        ],
        included_resources: { objects: [] },
        cursor: square.SQUARE_PHASE_2B1B1_SYNTHETIC_CURSOR,
        latest_time: "2026-08-19T15:10:00.000Z"
      },
      "catalog_search"
    ),
    "SearchCatalogObjects absent objects accepted as empty"
  );
  equal(searchWithoutObjects.itemCount, 0, "Search absent objects has zero primary items");
  equal(
    searchWithoutObjects.relatedItemCount,
    1,
    "Search absent objects still retains related objects"
  );
  equal(
    searchWithoutObjects.includedItemCount,
    0,
    "Search absent objects preserves empty included resources"
  );
  equal(
    searchWithoutObjects.latestTime,
    "2026-08-19T15:10:00.000Z",
    "Search absent objects preserves latest_time"
  );
  equal(
    searchWithoutObjects.pagination.cursorPresent,
    true,
    "Search absent objects preserves cursor state"
  );

  const batchWithoutObjects = accepted(
    parseCatalog(
      {
        related_objects: [square.squarePhase2B1B1DeletedVariation()],
        included_resources: { objects: [] }
      },
      "catalog_batch_retrieve"
    ),
    "BatchRetrieveCatalogObjects absent objects accepted as empty"
  );
  equal(batchWithoutObjects.itemCount, 0, "Batch absent objects has zero primary items");
  equal(
    batchWithoutObjects.relatedItemCount,
    1,
    "Batch absent objects still retains related objects"
  );
  equal(
    batchWithoutObjects.includedItemCount,
    0,
    "Batch absent objects preserves empty included resources"
  );
}

function testProviderAndVersionBoundaries() {
  incompatible(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      apiVersion: "2026-07-15"
    }),
    "Catalog parser rejects incompatible Square API version"
  );
  incompatible(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      apiVersion: "not-a-version"
    }),
    "Catalog parser rejects malformed Square API version as incompatible"
  );
  rejected(
    parseCatalogRawInput({
      providerEnvironment: "sandbox",
      apiVersion: "2026-08-19",
      operation: "list_catalog",
      response: catalogFixtures.listCatalog
    }),
    "Catalog parser rejects missing provider key"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: null
    }),
    "Catalog parser rejects null provider key"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: undefined
    }),
    "Catalog parser rejects undefined provider key"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: ""
    }),
    "Catalog parser rejects empty provider key"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: "quickbooks_online"
    }),
    "Catalog parser rejects another provider key"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerEnvironment: "staging"
    }),
    "Catalog parser rejects unknown provider environment"
  );
  rejected(
    parseCatalogRawInput({
      providerKey: "square",
      providerEnvironment: "sandbox",
      apiVersion: "2026-08-19",
      response: catalogFixtures.listCatalog
    }),
    "Catalog parser rejects missing operation"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      operation: "orders_search"
    }),
    "Catalog parser rejects unrelated operation"
  );
}

function testProviderErrors() {
  unsupported(
    parseCatalog({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1B1ITEM001 synthetic detail"
        }
      ]
    }),
    "Catalog provider error envelope is unsupported without leaking details"
  );
  unsupported(
    parseCatalog(catalogFixtures.mixedProviderErrors),
    "Catalog provider errors are not ignored when data is present"
  );
  unsupported(
    parseCatalog(
      {
        errors: [
          {
            category: "AUTHENTICATION_ERROR",
            detail: "SQ2B1B1VAR001 synthetic detail"
          }
        ],
        objects: [square.squarePhase2B1B1Item()],
        related_objects: [square.squarePhase2B1B1Category()],
        included_resources: { objects: [square.squarePhase2B1B1Category()] }
      },
      "catalog_search"
    ),
    "Catalog provider errors are not ignored in mixed related and included envelopes"
  );
  rejected(
    parseCatalog(catalogFixtures.malformedProviderErrors),
    "Catalog malformed provider errors are rejected"
  );
  rejected(
    parseCatalog({
      errors: [null],
      objects: [square.squarePhase2B1B1Category()]
    }),
    "Catalog malformed provider error entries are rejected"
  );
  const withEmptyErrors = accepted(
    parseCatalog({
      errors: [],
      objects: [square.squarePhase2B1B1Category()]
    }),
    "Catalog explicitly empty provider errors are accepted"
  );
  const withoutErrors = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B1Category()] }),
    "Catalog no-error envelope accepted"
  );
  deepEqual(
    withEmptyErrors,
    withoutErrors,
    "Catalog empty provider errors disappear entirely from trusted output"
  );
}

function testMinimizationAndFingerprints() {
  const base = accepted(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog"),
    "base catalog list accepted"
  );
  const excluded = accepted(
    parseCatalog(catalogFixtures.itemExcludedCanaries, "list_catalog"),
    "Catalog item with excluded fields accepted"
  );
  const hostileExcluded = accepted(
    parseCatalog(catalogFixtures.hostileExcludedFields, "list_catalog"),
    "Catalog hostile excluded fields accepted"
  );
  assertProjectionClean(excluded, "Catalog item projection");
  assertProjectionClean(hostileExcluded, "Catalog hostile excluded projection");
  deepEqual(excluded, base, "Catalog excluded item fields do not change projection");
  deepEqual(
    hostileExcluded,
    base,
    "Catalog hostile excluded fields do not change projection"
  );
  equal(
    square.squareCatalogResponseFingerprint(excluded),
    square.squareCatalogResponseFingerprint(base),
    "Catalog excluded item fields do not change response fingerprint"
  );
  equal(
    square.squareCatalogObjectFingerprint(excluded.items[1]),
    square.squareCatalogObjectFingerprint(base.items[1]),
    "Catalog excluded item fields do not change object fingerprint"
  );
  equal(
    square.squareCatalogObjectFingerprint(hostileExcluded.items[1]),
    square.squareCatalogObjectFingerprint(base.items[1]),
    "Catalog hostile excluded fields do not change object fingerprint"
  );

  const categoryBase = accepted(
    parseCatalog(
      square.squarePhase2B1B1ListEnvelope(
        {},
        { objects: [square.squarePhase2B1B1Category()] }
      )
    ),
    "base category accepted"
  );
  const categoryExcluded = accepted(
    parseCatalog(catalogFixtures.categoryExcludedCanaries),
    "Catalog category with excluded fields accepted"
  );
  assertProjectionClean(categoryExcluded, "Catalog category projection");
  deepEqual(
    categoryExcluded,
    categoryBase,
    "Catalog excluded category fields do not change projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(categoryExcluded.items[0]),
    square.squareCatalogObjectFingerprint(categoryBase.items[0]),
    "Catalog excluded category fields do not change fingerprint"
  );

  const baseItemFingerprint = square.squareCatalogObjectFingerprint(base.items[1]);
  assertFingerprintShape(baseItemFingerprint, "Catalog item");
  notEqual(
    firstCatalogObjectFingerprint(
      {
        objects: [
          square.squarePhase2B1B1Category({
            id: "SQ2B1B1CAT009",
            category_data: { name: "Changed", is_top_level: true }
          })
        ]
      },
      "list_catalog"
    ),
    square.squareCatalogObjectFingerprint(base.items[0]),
    "Catalog fingerprint binds provider identity"
  );
  notEqual(
    catalogResponseFingerprint(catalogFixtures.listCatalog, "list_catalog"),
    catalogResponseFingerprint(catalogFixtures.searchCatalog, "catalog_search"),
    "Catalog response fingerprint binds operation"
  );
  notEqual(
    square.squareCatalogObjectFingerprint(
      accepted(
        parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
          providerEnvironment: "production"
        }),
        "production catalog response accepted"
      ).items[1]
    ),
    baseItemFingerprint,
    "Catalog object fingerprint binds provider environment"
  );
  notEqual(
    square.squareCatalogObjectFingerprint(
      accepted(
        parseCatalog(
          square.squarePhase2B1B1ListEnvelope({ version: 1_787_142_240_002 }),
          "list_catalog"
        ),
        "Catalog provider version change accepted"
      ).items[1]
    ),
    baseItemFingerprint,
    "Catalog object fingerprint binds documented provider version"
  );
  notEqual(
    square.squareCatalogObjectFingerprint(
      accepted(
        parseCatalog(
          square.squarePhase2B1B1ListEnvelope({
            updated_at: "2026-08-19T15:04:01.000Z"
          }),
          "list_catalog"
        ),
        "Catalog updated_at change accepted"
      ).items[1]
    ),
    baseItemFingerprint,
    "Catalog object fingerprint binds documented updated_at"
  );
  notEqual(
    square.squareCatalogObjectFingerprint(
      accepted(
        parseCatalog(
          square.squarePhase2B1B1ListEnvelope({
            item_data: {
              name: "Changed Tea",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
              variations: [square.squarePhase2B1B1ItemVariation()]
            }
          }),
          "list_catalog"
        ),
        "Catalog retained display change accepted"
      ).items[1]
    ),
    baseItemFingerprint,
    "Catalog object fingerprint binds retained minimized content"
  );
  notEqual(
    square.squareCatalogObjectFingerprint(
      accepted(
        parseCatalog(
          square.squarePhase2B1B1ListEnvelope({
            item_data: {
              name: "Ceremonial Tea",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
              variations: [
                square.squarePhase2B1B1ItemVariation({
                  item_variation_data: {
                    item_id: "SQ2B1B1ITEM001",
                    name: "12 oz",
                    sku: "TEA-12OZ",
                    pricing_type: "FIXED_PRICING",
                    price_money: { amount: 451, currency: "USD" },
                    ordinal: 0,
                    track_inventory: true,
                    sellable: true,
                    stockable: true
                  }
                })
              ]
            }
          }),
          "list_catalog"
        ),
        "Catalog retained price change accepted"
      ).items[1]
    ),
    baseItemFingerprint,
    "Catalog object fingerprint binds retained price content"
  );

  const noCursor = accepted(
    parseCatalog(noCursorListEnvelope()),
    "ListCatalog without cursor accepted"
  );
  const alternateCursor = accepted(
    parseCatalog(
      square.squarePhase2B1B1ListEnvelope(
        {},
        { cursor: "sq2b1b1CatalogCursor002==" }
      )
    ),
    "ListCatalog alternate cursor accepted"
  );
  equal(noCursor.pagination.cursorPresent, false, "cursor absence is explicit");
  notEqual(
    square.squareCatalogResponseFingerprint(noCursor),
    square.squareCatalogResponseFingerprint(base),
    "Catalog response fingerprint changes when documented cursor state appears"
  );
  notEqual(
    alternateCursor.pagination.cursorFingerprint,
    base.pagination.cursorFingerprint,
    "Catalog cursor fingerprint changes when raw cursor changes"
  );

  const retrieveBase = accepted(
    parseCatalog(catalogFixtures.retrieveCatalogObject, "retrieve_catalog_object"),
    "base retrieve accepted for undocumented cursor check"
  );
  const retrieveWithExtras = accepted(
    parseCatalog(
      square.squarePhase2B1B1RetrieveEnvelope(square.squarePhase2B1B1Item(), {
        cursor: "sq2b1b1UndocumentedCursor==",
        latest_time: "not-a-timestamp"
      }),
      "retrieve_catalog_object"
    ),
    "Retrieve ignores undocumented cursor and latest_time"
  );
  deepEqual(
    retrieveWithExtras,
    retrieveBase,
    "Retrieve undocumented cursor and latest_time do not change projection"
  );
  equal(
    square.squareCatalogResponseFingerprint(retrieveWithExtras),
    square.squareCatalogResponseFingerprint(retrieveBase),
    "Retrieve undocumented cursor and latest_time do not change fingerprint"
  );

  const listWithLatestTime = accepted(
    parseCatalog(
      square.squarePhase2B1B1ListEnvelope({}, { latest_time: "not-a-timestamp" }),
      "list_catalog"
    ),
    "ListCatalog ignores undocumented latest_time"
  );
  deepEqual(
    listWithLatestTime,
    base,
    "ListCatalog undocumented latest_time does not change projection"
  );
  equal(
    square.squareCatalogResponseFingerprint(listWithLatestTime),
    square.squareCatalogResponseFingerprint(base),
    "ListCatalog undocumented latest_time does not change fingerprint"
  );

  const batchBase = accepted(
    parseCatalog(
      catalogFixtures.batchRetrieveCatalogObjects,
      "catalog_batch_retrieve"
    ),
    "base batch retrieve accepted for undocumented cursor check"
  );
  const batchWithCursor = accepted(
    parseCatalog(
      square.squarePhase2B1B1BatchEnvelope({
        cursor: "sq2b1b1UndocumentedBatchCursor=="
      }),
      "catalog_batch_retrieve"
    ),
    "Batch retrieve ignores undocumented cursor"
  );
  deepEqual(
    batchWithCursor,
    batchBase,
    "Batch retrieve undocumented cursor does not change projection"
  );
  equal(
    square.squareCatalogResponseFingerprint(batchWithCursor),
    square.squareCatalogResponseFingerprint(batchBase),
    "Batch retrieve undocumented cursor does not change fingerprint"
  );
}

function testCatalogRelationshipIdentityOccurrences() {
  const relatedGraph = accepted(
    parseCatalog(duplicateRelationshipSearchEnvelope(), "catalog_search"),
    "Search accepts identical primary variation repeated under related parent item"
  );
  equal(relatedGraph.itemCount, 1, "relationship duplicate graph has one primary item");
  equal(
    relatedGraph.relatedItemCount,
    1,
    "relationship duplicate graph has one related parent item"
  );
  equal(
    relatedGraph.relatedItems[0].variationCount,
    1,
    "related parent retains one nested variation"
  );
  deepEqual(
    relatedGraph.relatedItems[0].variations[0],
    relatedGraph.items[0],
    "relationship duplicate is accepted only as the same trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(relatedGraph.relatedItems[0].variations[0]),
    square.squareCatalogObjectFingerprint(relatedGraph.items[0]),
    "relationship duplicate has the same trusted fingerprint"
  );
  assertFingerprintShape(
    square.squareCatalogResponseFingerprint(relatedGraph),
    "relationship duplicate response"
  );

  for (const [overrides, message] of [
    [
      {
        item_variation_data: catalogVariationData({
          price_money: { amount: 451, currency: "USD" }
        })
      },
      "relationship duplicate with conflicting pricing is rejected"
    ],
    [
      { version: 1_787_142_300_002 },
      "relationship duplicate with conflicting provider version is rejected"
    ],
    [
      {
        present_at_location_ids: ["SQ2B1B1LOC003"],
        item_variation_data: catalogVariationData()
      },
      "relationship duplicate with conflicting availability is rejected"
    ],
    [
      {
        is_deleted: true,
        item_variation_data: {}
      },
      "relationship duplicate with conflicting deletion state is rejected"
    ]
  ]) {
    rejected(
      parseCatalog(duplicateRelationshipSearchEnvelope(overrides), "catalog_search"),
      message
    );
  }

  for (const [fixture, operation, message] of [
    [
      { objects: [square.squarePhase2B1B1Category(), square.squarePhase2B1B1Category()] },
      "list_catalog",
      "identical duplicates within the primary bucket are rejected"
    ],
    [
      {
        objects: [],
        related_objects: [
          square.squarePhase2B1B1Category(),
          square.squarePhase2B1B1Category()
        ]
      },
      "catalog_search",
      "identical duplicates within the related bucket are rejected"
    ],
    [
      {
        objects: [],
        included_resources: {
          objects: [
            square.squarePhase2B1B1Category(),
            square.squarePhase2B1B1Category()
          ]
        }
      },
      "catalog_search",
      "identical duplicates within the included bucket are rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture, operation), message);
  }

  rejected(
    parseCatalog(
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: catalogItemData({
              variations: [
                square.squarePhase2B1B1ItemVariation(),
                square.squarePhase2B1B1ItemVariation()
              ]
            })
          })
        ]
      },
      "list_catalog"
    ),
    "identical duplicate variations within one parent item are rejected"
  );
}

function testRejectedAndUnsupportedCatalogPayloads() {
  for (const [fixture, message] of [
    [catalogFixtures.unsupportedModifierList, "deferred MODIFIER_LIST payload is unsupported"],
    [
      {
        objects: [
          square.squarePhase2B1B1Category(),
          catalogFixtures.unsupportedModifierList.objects[0]
        ]
      },
      "mixed supported and deferred payload is unsupported"
    ]
  ]) {
    unsupported(parseCatalog(fixture), message);
  }

  rejected(
    parseCatalog({}, "retrieve_catalog_object"),
    "RetrieveCatalogObject still requires a singular object"
  );

  for (const [operation, envelopeName] of [
    ["list_catalog", "ListCatalog"],
    ["catalog_search", "SearchCatalogObjects"],
    ["catalog_batch_retrieve", "BatchRetrieveCatalogObjects"]
  ]) {
    rejected(
      parseCatalog({ objects: null }, operation),
      `${envelopeName} present null objects are rejected`
    );
    rejected(
      parseCatalog({ objects: "not-an-array" }, operation),
      `${envelopeName} present non-array objects are rejected`
    );
  }

  for (const [fixture, message] of [
    [
      { objects: [square.squarePhase2B1B1Category({ id: "#TEMP" })] },
      "temporary category IDs are rejected"
    ],
    [
      { objects: [withoutKey(square.squarePhase2B1B1Category(), "version")] },
      "missing CatalogObject version is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ version: 1.5 })] },
      "fractional CatalogObject version is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ version: -1 })] },
      "negative CatalogObject version is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ version: Number.MAX_SAFE_INTEGER + 1 })] },
      "unsafe CatalogObject version is rejected structurally"
    ],
    [
      { objects: [withoutKey(square.squarePhase2B1B1Category(), "updated_at")] },
      "missing CatalogObject updated_at is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ updated_at: "2026-99-99T00:00:00Z" })] },
      "malformed CatalogObject updated_at is rejected"
    ],
    [
      { objects: [withoutKey(square.squarePhase2B1B1Category(), "is_deleted")] },
      "missing CatalogObject is_deleted is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ is_deleted: null })] },
      "nullable CatalogObject is_deleted is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            present_at_all_locations: false
          })
        ]
      },
      "location-scoped CATEGORY is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            absent_at_location_ids: ["SQ2B1B1LOC001"]
          })
        ]
      },
      "CATEGORY absent location list is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            present_at_location_ids: ["SQ2B1B1LOC001"]
          })
        ]
      },
      "CATEGORY present location list is rejected"
    ],
    [
      { objects: [square.squarePhase2B1B1Category({ category_data: null })] },
      "non-deleted category null data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            category_data: { name: "   " }
          })
        ]
      },
      "empty retained category name is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            category_data: { name: "<script>alert('x')</script>" }
          })
        ]
      },
      "hostile retained category name is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: {
              name: "Ceremonial Tea",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }]
            }
          })
        ]
      },
      "item missing variations is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: {
              name: "Ceremonial Tea",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
              variations: []
            }
          })
        ]
      },
      "item empty variations are rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: {
              name: "<img src=x onerror=alert('x')>",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
              variations: [square.squarePhase2B1B1ItemVariation()]
            }
          })
        ]
      },
      "hostile retained item name is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: {
              name: "Ceremonial Tea",
              categories: [
                { id: "SQ2B1B1CAT001", ordinal: 1 },
                { id: "SQ2B1B1CAT001", ordinal: 2 }
              ],
              variations: [square.squarePhase2B1B1ItemVariation()]
            }
          })
        ]
      },
      "duplicate item category references are rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            item_data: {
              name: "Ceremonial Tea",
              categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
              variations: [
                square.squarePhase2B1B1ItemVariation({
                  item_variation_data: {
                    item_id: "SQ2B1B1ITEM999",
                    name: "12 oz",
                    sku: "TEA-12OZ",
                    pricing_type: "FIXED_PRICING",
                    price_money: { amount: 450, currency: "USD" },
                    ordinal: 0
                  }
                })
              ]
            }
          })
        ]
      },
      "nested variation parent mismatch is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "12 oz",
              sku: "<script>alert('x')</script>",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 450, currency: "USD" },
              ordinal: 0
            }
          })
        ]
      },
      "hostile retained variation SKU is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "<script>alert('x')</script>",
              sku: "TEA-12OZ",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 450, currency: "USD" },
              ordinal: 0
            }
          })
        ]
      },
      "hostile retained variation name is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "12 oz",
              sku: "TEA-12OZ",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: -1, currency: "USD" },
              ordinal: 0
            }
          })
        ]
      },
      "negative fixed price is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "12 oz",
              sku: "TEA-12OZ",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 1.5, currency: "USD" },
              ordinal: 0
            }
          })
        ]
      },
      "fractional fixed price is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "12 oz",
              sku: "TEA-12OZ",
              pricing_type: "FIXED_PRICING",
              price_money: { amount: 450, currency: "US" },
              ordinal: 0
            }
          })
        ]
      },
      "malformed fixed price currency is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1VariablePriceVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "Custom amount",
              sku: "TEA-CUSTOM",
              pricing_type: "VARIABLE_PRICING",
              price_money: { amount: 450, currency: "USD" },
              ordinal: 1
            }
          })
        ]
      },
      "variable price variation cannot retain price_money"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1VariablePriceVariation({
            item_variation_data: {
              item_id: "SQ2B1B1ITEM001",
              name: "Custom amount",
              sku: "TEA-CUSTOM",
              pricing_type: "VARIABLE_PRICING",
              price_money: null,
              ordinal: 1
            }
          })
        ]
      },
      "variable price variation rejects nullable price_money"
    ],
    [catalogFixtures.duplicateTopLevelAuthority, "duplicate top-level authorities are rejected"],
    [catalogFixtures.duplicateNestedAuthority, "duplicate nested authorities are rejected"],
    [square.squarePhase2B1B1OversizedCatalogObjectArray(), "oversized Catalog object array is rejected"],
    [square.squarePhase2B1B1OversizedExcludedField(), "oversized excluded field is rejected structurally"]
  ]) {
    rejected(parseCatalog(fixture), message);
  }

  rejected(
    parseCatalog(
      {
        objects: [square.squarePhase2B1B1Category()],
        included_resources: {}
      },
      "catalog_search"
    ),
    "present included_resources without objects is rejected"
  );

  rejected(
    parseCatalog(
      {
        objects: [],
        cursor: ""
      },
      "list_catalog"
    ),
    "empty documented cursor is rejected"
  );
  rejected(
    parseCatalog(
      {
        objects: [],
        cursor: "x".repeat(4_097)
      },
      "list_catalog"
    ),
    "oversized documented cursor is rejected"
  );
  rejected(
    parseCatalog(
      {
        objects: [],
        latest_time: "not-a-timestamp"
      },
      "catalog_search"
    ),
    "malformed documented Search latest_time is rejected"
  );
}

function testCatalogObjectDiscriminatorExclusivity() {
  deepEqual(
    [...square.SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS],
    EXPECTED_CATALOG_OBJECT_TYPE_DATA_KEYS,
    "Catalog discriminator guard covers pinned type-specific data keys"
  );

  for (const [fixture, message] of [
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            item_data: catalogItemData()
          })
        ]
      },
      "CATEGORY with item_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Item({
            category_data: { name: "Wrong container" }
          })
        ]
      },
      "ITEM with category_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1ItemVariation({
            item_data: catalogItemData()
          })
        ]
      },
      "ITEM_VARIATION with item_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1Category({
            tax_data: { name: "Deferred tax container" }
          })
        ]
      },
      "supported object with deferred type-specific data is rejected"
    ],
    [
      {
        objects: [withoutKey(square.squarePhase2B1B1Category(), "category_data")]
      },
      "non-deleted CATEGORY missing category_data is rejected"
    ],
    [
      {
        objects: [withoutKey(square.squarePhase2B1B1Item(), "item_data")]
      },
      "non-deleted ITEM missing item_data is rejected"
    ],
    [
      {
        objects: [
          withoutKey(square.squarePhase2B1B1ItemVariation(), "item_variation_data")
        ]
      },
      "non-deleted ITEM_VARIATION missing item_variation_data is rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture), message);
  }

  for (const dataKey of square.SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS) {
    if (dataKey === "category_data") continue;
    rejected(
      parseCatalog({
        objects: [
          square.squarePhase2B1B1Category({
            [dataKey]: { safe: "nonmatching container" }
          })
        ]
      }),
      `CATEGORY rejects nonmatching ${dataKey}`
    );
  }

  const deletedCategoryBase = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B1DeletedCategory()] }),
    "deleted category without matching data accepted"
  ).items[0];
  const deletedCategoryWithData = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B1DeletedCategory({
          category_data: {
            name: "<script>discarded category tombstone data</script>",
            description: square.SQUARE_PHASE_2B1B1_SYNTHETIC_CANARIES.categoryDescription
          }
        })
      ]
    }),
    "deleted category with matching data accepted"
  ).items[0];
  deepEqual(
    deletedCategoryWithData,
    deletedCategoryBase,
    "deleted category matching data does not enter trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(deletedCategoryWithData),
    square.squareCatalogObjectFingerprint(deletedCategoryBase),
    "deleted category matching data does not change fingerprint"
  );

  const deletedItemBase = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B1DeletedItem()] }),
    "deleted item without matching data accepted"
  ).items[0];
  const deletedItemWithData = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B1DeletedItem({
          item_data: {
            name: "<script>discarded item tombstone data</script>",
            variations: [square.squarePhase2B1B1ItemVariation()]
          }
        })
      ]
    }),
    "deleted item with matching data accepted"
  ).items[0];
  deepEqual(
    deletedItemWithData,
    deletedItemBase,
    "deleted item matching data does not enter trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(deletedItemWithData),
    square.squareCatalogObjectFingerprint(deletedItemBase),
    "deleted item matching data does not change fingerprint"
  );

  const deletedVariationBase = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B1DeletedVariation()] }),
    "deleted variation without matching data accepted"
  ).items[0];
  const deletedVariationWithData = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B1DeletedVariation({
          item_variation_data: {
            item_id: "SQ2B1B1ITEM001",
            name: "<script>discarded variation tombstone data</script>",
            pricing_type: "FIXED_PRICING",
            price_money: { amount: 450, currency: "USD" }
          }
        })
      ]
    }),
    "deleted variation with matching data accepted"
  ).items[0];
  deepEqual(
    deletedVariationWithData,
    deletedVariationBase,
    "deleted variation matching data does not enter trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(deletedVariationWithData),
    square.squareCatalogObjectFingerprint(deletedVariationBase),
    "deleted variation matching data does not change fingerprint"
  );

  for (const [fixture, message] of [
    [
      {
        objects: [
          square.squarePhase2B1B1DeletedCategory({
            item_data: catalogItemData()
          })
        ]
      },
      "deleted CATEGORY with nonmatching item_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1DeletedItem({
            category_data: { name: "Wrong tombstone container" }
          })
        ]
      },
      "deleted ITEM with nonmatching category_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B1DeletedVariation({
            item_data: catalogItemData()
          })
        ]
      },
      "deleted ITEM_VARIATION with nonmatching item_data is rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture), message);
  }
}

function testStructuralJsonBoundaries() {
  accepted(
    parseCatalog(catalogFixtures.hostileExcludedFields),
    "bounded hostile excluded text is structurally safe and discarded"
  );
  accepted(
    parseCatalog(
      square.squarePhase2B1B1ListEnvelope({
        item_data: {
          name: "Ceremonial Tea",
          categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
          variations: [square.squarePhase2B1B1ItemVariation()],
          description: "ordinary multiline\ndescription with https://example.test"
        }
      })
    ),
    "ordinary excluded multiline text and URL-like text are discarded"
  );

  rejected(
    parseCatalog(square.squarePhase2B1B1ListEnvelope({ nested: () => "bad" })),
    "function values are rejected"
  );
  rejected(
    parseCatalog(square.squarePhase2B1B1ListEnvelope({ nested: Symbol("bad") })),
    "symbol values are rejected"
  );
  rejected(
    parseCatalog(square.squarePhase2B1B1ListEnvelope({ nested_number: Number.NaN })),
    "NaN is rejected"
  );
  rejected(
    parseCatalog(
      square.squarePhase2B1B1ListEnvelope({
        nested_number: Number.POSITIVE_INFINITY
      })
    ),
    "Infinity is rejected"
  );
  rejected(
    parseCatalog(square.squarePhase2B1B1ListEnvelope({ nested_number: -0 })),
    "negative zero is rejected"
  );

  const accessorEnvelope = {};
  Object.defineProperty(accessorEnvelope, "objects", {
    enumerable: true,
    get() {
      return [];
    }
  });
  rejected(parseCatalog(accessorEnvelope), "accessor properties are rejected");

  class SyntheticCatalogEnvelope {
    constructor() {
      this.objects = [];
    }
  }
  rejected(parseCatalog(new SyntheticCatalogEnvelope()), "class instances are rejected");

  const cyclicEnvelope = square.squarePhase2B1B1ListEnvelope();
  cyclicEnvelope.self = cyclicEnvelope;
  rejected(parseCatalog(cyclicEnvelope), "cyclic response data is rejected");

  const sparseObjects = [];
  sparseObjects.length = 1;
  rejected(parseCatalog({ objects: sparseObjects }), "sparse arrays are rejected");

  const customArray = [square.squarePhase2B1B1Category()];
  customArray.extra = "custom-array-property";
  rejected(parseCatalog({ objects: customArray }), "arrays with custom properties are rejected");

  const arrayAccessor = [square.squarePhase2B1B1Category()];
  Object.defineProperty(arrayAccessor, 0, {
    enumerable: true,
    get() {
      return square.squarePhase2B1B1Category();
    }
  });
  rejected(parseCatalog({ objects: arrayAccessor }), "array accessors are rejected");

  class SyntheticCatalogObject {
    constructor() {
      Object.assign(this, square.squarePhase2B1B1Category());
    }
  }
  rejected(
    parseCatalog({ objects: [new SyntheticCatalogObject()] }),
    "nested class instances are rejected"
  );

  const symbolKeyEnvelope = square.squarePhase2B1B1ListEnvelope();
  symbolKeyEnvelope.objects[0][Symbol.for("sq2b1b1")] = "symbol-key";
  rejected(parseCatalog(symbolKeyEnvelope), "symbol keys are rejected");

  const pollutionEnvelope = JSON.parse(
    `{"objects":[{"type":"CATEGORY","id":"SQ2B1B1CATPOLLUTE","updated_at":"2026-08-19T15:00:00.000Z","version":1787142000001,"is_deleted":false,"present_at_all_locations":true,"category_data":{"name":"Pollution Test"},"__proto__":{"polluted":true}}]}`
  );
  equal({}.polluted, undefined, "prototype pollution did not affect Object before parsing");
  rejected(parseCatalog(pollutionEnvelope), "prototype pollution key is rejected");
  equal({}.polluted, undefined, "prototype pollution did not affect Object after parsing");

  const tooDeep = square.squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [square.squarePhase2B1B1ItemVariation()],
      nested: deepObject(13)
    }
  });
  rejected(parseCatalog(tooDeep), "excessive nesting depth is rejected");

  const tooManyValues = square.squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [square.squarePhase2B1B1ItemVariation()],
      nested_values: Array.from({ length: 1_001 }, () => 1)
    }
  });
  rejected(parseCatalog(tooManyValues), "excessive nested array size is rejected structurally");

  const tooManyTotalValues = square.squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [square.squarePhase2B1B1ItemVariation()],
      nested_values: Array.from({ length: 1_000 }, () =>
        Array.from({ length: 25 }, () => 1)
      )
    }
  });
  rejected(parseCatalog(tooManyTotalValues), "excessive total value count is rejected structurally");

  const tooManyKeys = square.squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [square.squarePhase2B1B1ItemVariation()],
      nested_object: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`extra_${index}`, index])
      )
    }
  });
  rejected(parseCatalog(tooManyKeys), "excessive object key count is rejected structurally");

  const oversizedKey = square.squarePhase2B1B1ListEnvelope({
    item_data: {
      name: "Ceremonial Tea",
      categories: [{ id: "SQ2B1B1CAT001", ordinal: 2 }],
      variations: [square.squarePhase2B1B1ItemVariation()],
      nested_object: {
        ["k".repeat(129)]: "value"
      }
    }
  });
  rejected(parseCatalog(oversizedKey), "oversized object keys are rejected structurally");
}

function testAcceptedResultImmutability() {
  const result = parseCatalog(catalogFixtures.listCatalog, "list_catalog");
  equal(result.outcome, "accepted", "Catalog result is accepted for immutability checks");
  const value = result.value;
  expectFrozen(result, "Catalog accepted result");
  expectFrozen(result.diagnostics, "Catalog accepted diagnostics");
  expectFrozen(value, "Catalog response projection");
  expectFrozen(value.provider, "Catalog response provider provenance");
  expectFrozen(value.pagination, "Catalog pagination state");
  expectFrozen(value.items, "Catalog primary object array");
  expectFrozen(value.relatedItems, "Catalog related object array");
  expectFrozen(value.includedItems, "Catalog included object array");
  expectFrozen(value.items[0], "Catalog category projection");
  expectFrozen(value.items[0].authority, "Catalog category authority");
  expectFrozen(value.items[0].provider, "Catalog category provenance");
  expectFrozen(value.items[0].parentCategory, "Catalog parent category reference");
  expectFrozen(value.items[1], "Catalog item projection");
  expectFrozen(value.items[1].authority, "Catalog item authority");
  expectFrozen(value.items[1].provider, "Catalog item provenance");
  expectFrozen(value.items[1].availability, "Catalog item availability");
  expectFrozen(value.items[1].categoryReferences, "Catalog item category references");
  expectFrozen(value.items[1].categoryReferences[0], "Catalog item category reference");
  expectFrozen(value.items[1].variations, "Catalog nested variation array");
  expectFrozen(value.items[1].variations[0], "Catalog nested variation projection");
  expectFrozen(value.items[1].variations[0].authority, "Catalog nested variation authority");
  expectFrozen(value.items[1].variations[0].provider, "Catalog nested variation provenance");
  expectFrozen(value.items[1].variations[0].availability, "Catalog nested variation availability");
  expectFrozen(value.items[1].variations[0].price, "Catalog nested variation price");

  const snapshot = JSON.stringify(value);
  try {
    value.items[1].displayName = "Mutated Item";
  } catch {}
  try {
    value.items[1].variations[0].price.amountMinor = "999";
  } catch {}
  equal(JSON.stringify(value), snapshot, "Catalog trusted projection cannot be mutated");
  throws(
    () => value.items.push(value.items[0]),
    /Cannot|read only|extensible|frozen/i,
    "Catalog trusted item array cannot be extended"
  );
  throws(
    () => value.items[1].variations.push(value.items[1].variations[0]),
    /Cannot|read only|extensible|frozen/i,
    "Catalog nested variation array cannot be extended"
  );
}

function testDormancyAndRegistration() {
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Square Catalog response validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "Square Catalog response validation uses the pinned API version");
  deepEqual(
    [...square.SQUARE_PHASE_2B1B1_SUPPORTED_CATALOG_OBJECT_TYPES],
    ["CATEGORY", "ITEM", "ITEM_VARIATION"],
    "Phase 2B.1B-1 only supports Category, Item, and Item Variation"
  );
  deepEqual(
    [...square.SQUARE_CATALOG_RESPONSE_OPERATION_KEYS],
    [
      "list_catalog",
      "catalog_search",
      "retrieve_catalog_object",
      "catalog_batch_retrieve"
    ],
    "Phase 2B.1B-1 response parser covers the four Catalog envelopes"
  );

  const squareDescriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  equal(
    squareDescriptorRegistry.descriptors[0].descriptorFingerprint,
    EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT,
    "Square Phase 2A descriptor fingerprint is unchanged"
  );
  const qboRegistry = controlPlane.assertProviderDescriptorRegistry(
    qbo.QBO_PHASE_7_PROVIDER_REGISTRY
  );
  const qboEntry = qboRegistry.descriptors.find(
    (entry) => entry.descriptor.providerKey === "quickbooks_online"
  );
  ok(qboEntry, "QBO descriptor is still present");
  equal(
    qboEntry.descriptorFingerprint,
    EXPECTED_QBO_DESCRIPTOR_FINGERPRINT,
    "QBO descriptor fingerprint is unchanged"
  );
  equal(
    qboRegistry.registryFingerprint,
    EXPECTED_QBO_REGISTRY_FINGERPRINT,
    "QBO descriptor registry fingerprint is unchanged"
  );
  equal(
    registeredProviders.REGISTERED_PROVIDER_REGISTRY.registryFingerprint,
    EXPECTED_QBO_REGISTRY_FINGERPRINT,
    "active registry fingerprint is unchanged"
  );
  throws(
    () =>
      controlPlane.providerDescriptor(
        "square",
        "sandbox",
        registeredProviders.REGISTERED_PROVIDER_REGISTRY
      ),
    /provider_descriptor_not_registered/,
    "Square remains unreachable from active provider registry"
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

  const registeredSource = read(
    "lib/integrations/control-plane/registered-provider-registry.ts"
  );
  doesNotMatch(
    registeredSource,
    /square/i,
    "active registered provider registry source still omits Square"
  );

  const squarePhase2B1B1Sources = [
    "lib/integrations/providers/square/catalog-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b1b1.ts"
  ].map(read).join("\n");
  doesNotMatch(
    squarePhase2B1B1Sources,
    /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|openai|generateText|streamText/i,
    "Square Phase 2B.1B-1 source has no network, database, environment, or model call path"
  );
  doesNotMatch(
    squarePhase2B1B1Sources,
    /parseSquare(?:Modifier|Discount|Tax)|minimizeSquare(?:Modifier|Discount|Tax)|CatalogModifier|CatalogDiscount|CatalogTax/i,
    "Square Phase 2B.1B-2 object minimizers are not started"
  );

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b1b1"],
    "node scripts/external-integrations-square-phase-2b1b1-catalog-response-validation-regression-tests.js",
    "Square Phase 2B.1B-1 test script is registered"
  );
  matches(
    ciWorkflow,
    /pnpm test:external-integrations-square-phase-2b1b1/,
    "CI exercises the Square Phase 2B.1B-1 response validation suite"
  );
}

function withoutKey(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function deepObject(depth) {
  let value = { leaf: "safe" };
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value };
  }
  return value;
}

testAcceptedEnvelopes();
testProviderAndVersionBoundaries();
testProviderErrors();
testMinimizationAndFingerprints();
testCatalogRelationshipIdentityOccurrences();
testRejectedAndUnsupportedCatalogPayloads();
testCatalogObjectDiscriminatorExclusivity();
testStructuralJsonBoundaries();
testAcceptedResultImmutability();
testDormancyAndRegistration();

const fixtureInventory =
  Object.keys(catalogFixtures).length +
  8;

console.log(
  `External integrations Square Phase 2B.1B-1 Catalog response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} fixture definitions. Square descriptor ${EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT}; QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}; active registry ${EXPECTED_QBO_REGISTRY_FINGERPRINT}.`
);
