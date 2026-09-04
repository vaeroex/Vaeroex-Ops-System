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
const square = require("../lib/integrations/providers/square/index.ts");

let assertionCount = 0;
let fixtureScenarioCount = 0;

function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
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

const catalogFixtures = square.SQUARE_PHASE_2B1B2_CATALOG_FIXTURES;
const canaries = Object.values(square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES);
const catalogCanaryPattern = new RegExp(
  canaries.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
);
const sensitivePattern = new RegExp(
  [
    ...canaries,
    square.SQUARE_PHASE_2B1B2_SYNTHETIC_CURSOR,
    "SQ2B1B2MOD001",
    "SQ2B1B2MODLIST001",
    "SQ2B1B2DISC001",
    "SQ2B1B2TAX001",
    "SQ2B1B2LOC001"
  ]
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
);

function parserInput(response, operation = "list_catalog", overrides = {}) {
  return square.squarePhase2B1B2ParserInput(response, operation, overrides);
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

function findObject(response, catalogObjectType) {
  const item = response.items.find(
    (candidate) => candidate.catalogObjectType === catalogObjectType
  );
  ok(item, `${catalogObjectType} projection exists`);
  return item;
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
    /Milk|Oat|discount|tax|Coffee/i,
    `${message}: fingerprint does not expose business text`
  );
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
    /description|description_html|ecom_uri|url|contact|email|address|coordinates|twitter|facebook|instagram|custom_attribute|image_id|image_ids|internal_name|kitchen_name|hidden_online|hidden_from_customer|pin_required|label_color|included_resources|related_objects/i,
    `${message}: excluded provider field names do not survive`
  );
}

function expectFrozen(value, label) {
  ok(Object.isFrozen(value), `${label} is frozen`);
}

function withoutKey(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function withoutKeys(record, keys) {
  let copy = { ...record };
  for (const key of keys) {
    copy = withoutKey(copy, key);
  }
  return copy;
}

function deepObject(depth) {
  let value = { leaf: "safe" };
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value };
  }
  return value;
}

function testAcceptedCatalogObjectFamilies() {
  const list = accepted(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog"),
    "ListCatalog accepts modifier-list, discount, and tax objects"
  );
  equal(list.operation, "list_catalog", "ListCatalog operation is retained");
  equal(list.provider.providerKey, "square", "provider provenance is Square");
  equal(list.provider.apiVersion, "2026-08-19", "Catalog API version is pinned");
  equal(list.itemCount, 3, "ListCatalog primary object count is retained");
  deepEqual(
    list.items.map((item) => item.catalogObjectType),
    ["DISCOUNT", "MODIFIER_LIST", "TAX"],
    "ListCatalog trusted objects are sorted independently of provider order"
  );

  const modifierList = findObject(list, "MODIFIER_LIST");
  equal(
    modifierList.entityVersion,
    square.SQUARE_CATALOG_ENTITY_VERSION,
    "modifier-list entity version is contract-owned"
  );
  equal(modifierList.displayName, "Milk options", "modifier-list name is retained");
  equal(modifierList.selectionType, "MULTIPLE", "modifier-list selection type is retained");
  equal(modifierList.ordinal, "3", "modifier-list ordinal is retained");
  deepEqual(
    modifierList.availability,
    {
      mode: "specific_locations",
      presentLocationIds: ["SQ2B1B2LOC001", "SQ2B1B2LOC002"]
    },
    "modifier-list location availability is normalized"
  );
  equal(modifierList.modifierCount, 2, "nested modifier count is retained");
  deepEqual(
    modifierList.modifiers.map((modifier) => modifier.displayName),
    ["Oat milk", "Almond milk"],
    "nested modifiers are sorted by ordinal and id"
  );
  const modifier = modifierList.modifiers[0];
  equal(modifier.catalogObjectType, "MODIFIER", "nested object type is modifier");
  equal(modifier.price.amountMinor, "75", "modifier money is an exact minor-unit string");
  equal(modifier.price.currency, "USD", "modifier currency is retained");
  equal(modifier.onByDefault, false, "modifier default-selection state is retained");
  equal(
    modifier.parentModifierListAuthority.providerId,
    "SQ2B1B2MODLIST001",
    "modifier parent list authority is retained"
  );
  deepEqual(
    modifier.availability,
    modifierList.availability,
    "nested modifier availability follows parent list inheritance"
  );

  const discount = findObject(list, "DISCOUNT");
  equal(discount.displayName, "Neighborhood discount", "discount name is retained");
  equal(discount.discountType, "FIXED_PERCENTAGE", "discount type is retained");
  equal(discount.percentage, "7.5", "discount percentage is canonicalized");
  equal(discount.maximumAmount.amountMinor, "2000", "discount cap amount is retained");
  equal(discount.maximumAmount.currency, "USD", "discount cap currency is retained");
  equal(discount.taxBasis, "MODIFY_TAX_BASIS", "discount tax-basis behavior is retained");

  const tax = findObject(list, "TAX");
  equal(tax.displayName, "Local sales tax", "tax name is retained");
  equal(tax.calculationPhase, "TAX_SUBTOTAL_PHASE", "tax calculation phase is retained");
  equal(tax.inclusionType, "ADDITIVE", "tax inclusion type is retained");
  equal(tax.percentage, "8.25", "tax percentage is canonicalized");
  equal(tax.enabled, true, "tax enabled state is retained");
  equal(tax.appliesToCustomAmounts, true, "tax custom-amount applicability is retained");

  const search = accepted(
    parseCatalog(catalogFixtures.searchCatalog, "catalog_search"),
    "SearchCatalogObjects accepts all Phase 2B.1B-2 object variants"
  );
  equal(search.itemCount, 5, "SearchCatalogObjects primary count is retained");
  equal(search.relatedItemCount, 1, "SearchCatalogObjects related count is retained");
  equal(search.includedItemCount, 1, "SearchCatalogObjects included count is retained");
  equal(search.latestTime, "2026-08-19T17:30:00.000Z", "Search latest_time is retained");
  equal(
    findObject(search, "MODIFIER_LIST").selectionType,
    "SINGLE",
    "single-selection modifier-list variant is accepted"
  );
  const fixedAmountDiscount = search.items.find(
    (item) => item.catalogObjectType === "DISCOUNT" && item.discountType === "FIXED_AMOUNT"
  );
  ok(fixedAmountDiscount, "fixed-amount discount is accepted");
  equal(fixedAmountDiscount.amount.amountMinor, "500", "fixed-amount discount amount is retained");
  const variablePercentageDiscount = search.items.find(
    (item) =>
      item.catalogObjectType === "DISCOUNT" &&
      item.discountType === "VARIABLE_PERCENTAGE"
  );
  ok(variablePercentageDiscount, "variable-percentage discount is accepted");
  equal(variablePercentageDiscount.percentage, "0", "variable-percentage discount requires zero");
  const variableAmountDiscount = search.items.find(
    (item) => item.catalogObjectType === "DISCOUNT" && item.discountType === "VARIABLE_AMOUNT"
  );
  ok(variableAmountDiscount, "variable-amount discount is accepted");
  equal(variableAmountDiscount.amount.amountMinor, "0", "variable-amount discount requires zero amount");
  const inclusiveTax = search.items.find(
    (item) => item.catalogObjectType === "TAX" && item.inclusionType === "INCLUSIVE"
  );
  ok(inclusiveTax, "inclusive tax variant is accepted");
  equal(inclusiveTax.calculationPhase, "TAX_TOTAL_PHASE", "tax total phase is accepted");
  equal(inclusiveTax.enabled, false, "tax disabled state is retained");
  equal(inclusiveTax.appliesToCustomAmounts, false, "false custom-amount applicability is retained");

  accepted(
    parseCatalog(catalogFixtures.retrieveCatalogObject, "retrieve_catalog_object"),
    "RetrieveCatalogObject accepts a singular Phase 2B.1B-2 object"
  );
  const batch = accepted(
    parseCatalog(catalogFixtures.batchRetrieveCatalogObjects, "catalog_batch_retrieve"),
    "BatchRetrieveCatalogObjects accepts deleted Phase 2B.1B-2 tombstones"
  );
  equal(batch.itemCount, 4, "BatchRetrieveCatalogObjects deleted count is retained");
  for (const item of batch.items) {
    equal(item.isDeleted, true, `${item.catalogObjectType} tombstone is retained`);
  }

  const emptyErrors = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax()], errors: [] }),
    "empty provider error array is accepted when the envelope is otherwise valid"
  );
  doesNotMatch(
    JSON.stringify(emptyErrors),
    /errors/i,
    "empty provider error array disappears from trusted projection"
  );
}

function testProviderAndVersionBoundaries() {
  rejected(
    parseCatalogRawInput(
      withoutKey(parserInput(catalogFixtures.listCatalog), "providerKey")
    ),
    "missing providerKey is rejected"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", { providerKey: null }),
    "null providerKey is rejected"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: undefined
    }),
    "undefined providerKey is rejected"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", { providerKey: "" }),
    "empty providerKey is rejected"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      providerKey: "quickbooks_online"
    }),
    "non-Square providerKey is rejected"
  );
  incompatible(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      apiVersion: "2026-08-20"
    }),
    "unpinned Square Catalog API version is rejected"
  );
  rejected(
    parseCatalog(catalogFixtures.listCatalog, "list_catalog", {
      operation: "orders_search"
    }),
    "non-Catalog operation is rejected"
  );
  deepEqual(
    [...square.SQUARE_PHASE_2B1B2_SUPPORTED_CATALOG_OBJECT_TYPES],
    [
      "CATEGORY",
      "ITEM",
      "ITEM_VARIATION",
      "MODIFIER_LIST",
      "MODIFIER",
      "DISCOUNT",
      "TAX"
    ],
    "Phase 2B.1B-2 supports exactly the reviewed Catalog object families"
  );
}

function testProviderErrors() {
  unsupported(
    parseCatalog(catalogFixtures.mixedProviderErrors),
    "nonempty provider errors fail closed even when objects are present"
  );
  rejected(
    parseCatalog(catalogFixtures.malformedProviderErrors),
    "malformed provider error collection is rejected"
  );
  unsupported(
    parseCatalog(
      {
        errors: [{ category: "AUTHENTICATION_ERROR", detail: "SQ2B1B2TAX001" }],
        object: square.squarePhase2B1B2Tax()
      },
      "retrieve_catalog_object"
    ),
    "provider errors fail closed with singular object data"
  );
  unsupported(
    parseCatalog(
      {
        errors: [{ category: "AUTHENTICATION_ERROR", detail: "SQ2B1B2MOD001" }],
        objects: [square.squarePhase2B1B2ModifierList()],
        related_objects: [square.squarePhase2B1B2Tax()],
        included_resources: { objects: [square.squarePhase2B1B2FixedAmountDiscount()] }
      },
      "catalog_search"
    ),
    "provider errors fail closed with primary, related, and included data"
  );
}

function testMinimizationAndFingerprints() {
  const baseModifierList = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B2ModifierList()] }),
    "base modifier-list accepted"
  ).items[0];
  const excludedModifierList = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2ModifierList(
          {},
          {
            image_ids: [square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierListImageId],
            internal_name:
              square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierListInternalName,
            hidden_from_customer: true,
            is_conversational: true,
            modifiers: [
              square.squarePhase2B1B2Modifier(
                {},
                {
                  kitchen_name:
                    square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierKitchenName,
                  image_id: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.modifierImageId,
                  hidden_online: true
                }
              ),
              square.squarePhase2B1B2SecondModifier()
            ]
          }
        )
      ]
    }),
    "modifier-list excluded fields accepted"
  ).items[0];
  deepEqual(
    excludedModifierList,
    baseModifierList,
    "modifier-list excluded fields do not change trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(excludedModifierList),
    square.squareCatalogObjectFingerprint(baseModifierList),
    "modifier-list excluded fields do not change object fingerprint"
  );

  const baseDiscount = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B2FixedPercentageDiscount()] }),
    "base discount accepted"
  ).items[0];
  const excludedDiscount = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2FixedPercentageDiscount(
          {},
          {
            pin_required: true,
            label_color: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.discountLabelColor,
            description: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.description,
            ecom_uri: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.url
          }
        )
      ]
    }),
    "discount excluded fields accepted"
  ).items[0];
  deepEqual(
    excludedDiscount,
    baseDiscount,
    "discount excluded fields do not change trusted projection"
  );
  equal(
    square.squareCatalogObjectFingerprint(excludedDiscount),
    square.squareCatalogObjectFingerprint(baseDiscount),
    "discount excluded fields do not change object fingerprint"
  );

  const baseTax = accepted(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax()] }),
    "base tax accepted"
  ).items[0];
  const excludedTax = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2Tax(
          {},
          {
            description: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.description,
            website_url: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.url,
            future_extra: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CANARIES.futureField
          }
        )
      ]
    }),
    "tax excluded fields accepted"
  ).items[0];
  deepEqual(excludedTax, baseTax, "tax excluded fields do not change trusted projection");
  equal(
    square.squareCatalogObjectFingerprint(excludedTax),
    square.squareCatalogObjectFingerprint(baseTax),
    "tax excluded fields do not change object fingerprint"
  );

  const objectOrderFingerprint = square.squareCatalogResponseFingerprint(
    accepted(
      parseCatalog({
        objects: [
          square.squarePhase2B1B2Tax(),
          square.squarePhase2B1B2ModifierList(),
          square.squarePhase2B1B2FixedPercentageDiscount()
        ],
        cursor: square.SQUARE_PHASE_2B1B2_SYNTHETIC_CURSOR
      }),
      "provider object order variant accepted"
    )
  );
  equal(
    objectOrderFingerprint,
    square.squareCatalogResponseFingerprint(
      accepted(parseCatalog(catalogFixtures.listCatalog), "base list accepted")
    ),
    "Catalog response fingerprint is independent of undocumented provider object order"
  );

  for (const [fixture, message] of [
    [
      catalogFixtures.excludedCanaries,
      "excluded descriptions, URLs, contacts, addresses, coordinates, social fields, and future extras are discarded"
    ],
    [
      catalogFixtures.hostileExcludedFields,
      "bounded hostile excluded text is structurally safe and discarded"
    ]
  ]) {
    assertProjectionClean(accepted(parseCatalog(fixture), message), message);
  }

  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2ModifierList(
          {},
          {
            name: "<script>alert('trusted')</script>"
          }
        )
      ]
    }),
    "hostile retained modifier-list display name is rejected"
  );
  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2Modifier(
          {},
          {
            name: "javascript:alert('trusted')"
          }
        )
      ]
    }),
    "hostile retained modifier display name is rejected"
  );
  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2FixedPercentageDiscount(
          {},
          {
            name: "<img src=x onerror=alert('trusted')>"
          }
        )
      ]
    }),
    "hostile retained discount display name is rejected"
  );
  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2Tax(
          {},
          {
            name: "data:text/html,<script>trusted</script>"
          }
        )
      ]
    }),
    "hostile retained tax display name is rejected"
  );

  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2ModifierList(
          {},
          {
            internal_name: "x".repeat(4_097)
          }
        )
      ]
    }),
    "oversized excluded modifier-list text is structurally rejected"
  );
  for (const fingerprint of [
    square.squareCatalogObjectFingerprint(baseModifierList),
    square.squareCatalogObjectFingerprint(baseDiscount),
    square.squareCatalogObjectFingerprint(baseTax)
  ]) {
    assertFingerprintShape(fingerprint, "Catalog object fingerprint");
  }
}

function testModifierListAndModifierSemantics() {
  const inherited = accepted(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2ModifierList(
          {},
          {
            modifiers: [
              withoutKeys(square.squarePhase2B1B2Modifier(), [
                "present_at_all_locations",
                "present_at_location_ids",
                "absent_at_location_ids"
              ])
            ]
          }
        )
      ]
    }),
    "nested modifier without explicit location scope inherits parent scope"
  ).items[0];
  deepEqual(
    inherited.modifiers[0].availability,
    inherited.availability,
    "modifier child inherits parent availability"
  );

  const repeated = accepted(
    parseCatalog(
      {
        objects: [square.squarePhase2B1B2ModifierList()],
        related_objects: [square.squarePhase2B1B2ModifierList()]
      },
      "catalog_search"
    ),
    "identical modifier-list authority can repeat across response buckets"
  );
  assertFingerprintShape(
    square.squareCatalogResponseFingerprint(repeated),
    "repeated modifier-list response fingerprint"
  );

  for (const [fixture, message] of [
    [catalogFixtures.duplicateNestedModifiers, "duplicate nested modifier authority is rejected"],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              modifiers: [
                square.squarePhase2B1B2Modifier(
                  {},
                  {
                    modifier_list_id: "SQ2B1B2OTHERLIST"
                  }
                )
              ]
            }
          )
        ]
      },
      "nested modifier parent-list mismatch is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              modifiers: [
                square.squarePhase2B1B2Modifier({
                  present_at_all_locations: true,
                  absent_at_location_ids: ["SQ2B1B2LOC999"]
                })
              ]
            }
          )
        ]
      },
      "nested modifier conflicting location scope is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              modifiers: [square.squarePhase2B1B1Category()]
            }
          )
        ]
      },
      "nested modifier-list child with the wrong CatalogObject type is rejected"
    ],
    [
      {
        objects: [
          withoutKey(square.squarePhase2B1B2ModifierList(), "modifier_list_data")
        ]
      },
      "non-deleted modifier-list missing modifier_list_data is rejected"
    ],
    [
      {
        objects: [
          withoutKey(square.squarePhase2B1B2Modifier(), "modifier_data")
        ]
      },
      "non-deleted modifier missing modifier_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList({
            id: "#SQ2B1B2TEMP"
          })
        ]
      },
      "temporary modifier-list IDs are rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              modifiers: [
                square.squarePhase2B1B2Modifier({
                  id: "#SQ2B1B2TEMP"
                })
              ]
            }
          )
        ]
      },
      "temporary nested modifier IDs are rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Modifier(
            {},
            {
              price_money: { amount: 75.5, currency: "USD" }
            }
          )
        ]
      },
      "modifier fractional money amount is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Modifier(
            {},
            {
              price_money: { amount: -1, currency: "USD" }
            }
          )
        ]
      },
      "modifier negative money amount is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Modifier(
            {},
            {
              price_money: { amount: Number.MAX_SAFE_INTEGER + 1, currency: "USD" }
            }
          )
        ]
      },
      "modifier unsafe money amount is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Modifier(
            {},
            {
              price_money: { amount: 75, currency: "NOT_A_CURRENCY" }
            }
          )
        ]
      },
      "modifier invalid money currency is rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture), message);
  }

  for (const [fixture, message] of [
    [catalogFixtures.textModifierList, "text-based modifier-list is unsupported"],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              allow_quantities: true
            }
          )
        ]
      },
      "modifier quantities are unsupported because they change financial meaning"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              min_selected_modifiers: 1
            }
          )
        ]
      },
      "modifier positive selection bounds are unsupported"
    ],
    [
      catalogFixtures.modifierWithLocationOverrides,
      "modifier location-specific price overrides are unsupported"
    ],
    [catalogFixtures.modifierWithChildLists, "modifier child lists are unsupported"]
  ]) {
    unsupported(parseCatalog(fixture), message);
  }

  rejected(
    parseCatalog(
      {
        objects: [square.squarePhase2B1B2ModifierList()],
        related_objects: [
          square.squarePhase2B1B2ModifierList(
            {},
            {
              modifiers: [
                square.squarePhase2B1B2Modifier(
                  {},
                  {
                    price_money: { amount: 125, currency: "USD" }
                  }
                ),
                square.squarePhase2B1B2SecondModifier()
              ]
            }
          )
        ]
      },
      "catalog_search"
    ),
    "conflicting repeated modifier-list authority is rejected"
  );
}

function testDiscountSemantics() {
  for (const [fixture, message] of [
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              amount_money: { amount: 100, currency: "USD" }
            }
          )
        ]
      },
      "fixed-percentage discount rejects amount_money"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              percentage: null
            }
          )
        ]
      },
      "fixed-percentage discount requires percentage"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2VariablePercentageDiscount(
            {},
            {
              percentage: "5"
            }
          )
        ]
      },
      "variable-percentage discount requires zero percentage"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedAmountDiscount(
            {},
            {
              percentage: "5"
            }
          )
        ]
      },
      "fixed-amount discount rejects percentage"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedAmountDiscount(
            {},
            {
              amount_money: null
            }
          )
        ]
      },
      "fixed-amount discount requires amount_money"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2VariableAmountDiscount(
            {},
            {
              amount_money: { amount: 1, currency: "USD" }
            }
          )
        ]
      },
      "variable-amount discount requires zero amount"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2VariableAmountDiscount(
            {},
            {
              maximum_amount_money: { amount: 100, currency: "USD" }
            }
          )
        ]
      },
      "amount-based discount rejects maximum_amount_money"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              discount_type: "BOGO"
            }
          )
        ]
      },
      "unsupported discount type is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              modify_tax_basis: "MAYBE"
            }
          )
        ]
      },
      "unsupported discount tax-basis enum is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              maximum_amount_money: { amount: 1.25, currency: "USD" }
            }
          )
        ]
      },
      "discount cap fractional amount is rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture), message);
  }

  for (const badPercentage of [
    7.5,
    "1e1",
    "7.5%",
    " 7.5",
    "7.5 ",
    "-1",
    "100.000001",
    "100.1",
    "101",
    "7.1234567"
  ]) {
    rejected(
      parseCatalog({
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount(
            {},
            {
              percentage: badPercentage
            }
          )
        ]
      }),
      `invalid discount percentage ${String(badPercentage)} is rejected`
    );
  }
}

function testTaxSemantics() {
  for (const [fixture, outcome, message] of [
    [catalogFixtures.taxWithProductSet, "unsupported", "tax product-set scoping is unsupported"],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              applies_to_product_set_id: "#TEMP"
            }
          )
        ]
      },
      "rejected",
      "temporary tax product-set ids are rejected before trust"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              calculation_phase: "AFTER_TOTAL"
            }
          )
        ]
      },
      "rejected",
      "unsupported tax calculation phase is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              inclusion_type: "EMBEDDED"
            }
          )
        ]
      },
      "rejected",
      "unsupported tax inclusion type is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              percentage: "8.2500001"
            }
          )
        ]
      },
      "rejected",
      "tax percentage over precision is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              percentage: "101"
            }
          )
        ]
      },
      "rejected",
      "tax percentage over range is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              percentage: 8.25
            }
          )
        ]
      },
      "rejected",
      "numeric tax percentage is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              enabled: "true"
            }
          )
        ]
      },
      "rejected",
      "tax enabled must be boolean when present"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(
            {},
            {
              applies_to_custom_amounts: "false"
            }
          )
        ]
      },
      "rejected",
      "tax custom-amount applicability must be boolean when present"
    ],
    [
      {
        objects: [withoutKey(square.squarePhase2B1B2Tax(), "tax_data")]
      },
      "rejected",
      "non-deleted tax missing tax_data is rejected"
    ]
  ]) {
    if (outcome === "unsupported") {
      unsupported(parseCatalog(fixture), message);
    } else {
      rejected(parseCatalog(fixture), message);
    }
  }
}

function testDiscriminatorTombstonesAndDuplicates() {
  ok(
    Object.isFrozen(square.SQUARE_CATALOG_OBJECT_TYPE_DATA_KEY_BY_TYPE),
    "Catalog discriminator type-data map is frozen"
  );
  ok(
    Object.isFrozen(square.SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS),
    "Catalog discriminator type-data key array is frozen"
  );
  deepEqual(
    [...square.SQUARE_CATALOG_OBJECT_TYPE_DATA_KEYS],
    EXPECTED_CATALOG_OBJECT_TYPE_DATA_KEYS,
    "Catalog discriminator guard covers all reviewed type-data keys"
  );

  for (const [fixture, message] of [
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList({
            modifier_data: { name: "Wrong container" }
          })
        ]
      },
      "MODIFIER_LIST with modifier_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Modifier({
            modifier_list_data: { name: "Wrong container" }
          })
        ]
      },
      "MODIFIER with modifier_list_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2FixedPercentageDiscount({
            tax_data: { name: "Wrong container" }
          })
        ]
      },
      "DISCOUNT with tax_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax({
            discount_data: { name: "Wrong container" }
          })
        ]
      },
      "TAX with discount_data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2DeletedModifierList({
            modifier_data: { name: "Wrong tombstone container" }
          })
        ]
      },
      "deleted MODIFIER_LIST with nonmatching data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2DeletedModifier({
            modifier_list_data: { name: "Wrong tombstone container" }
          })
        ]
      },
      "deleted MODIFIER with nonmatching data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2DeletedDiscount({
            tax_data: { name: "Wrong tombstone container" }
          })
        ]
      },
      "deleted DISCOUNT with nonmatching data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2DeletedTax({
            discount_data: { name: "Wrong tombstone container" }
          })
        ]
      },
      "deleted TAX with nonmatching data is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2ModifierList(),
          square.squarePhase2B1B2ModifierList()
        ]
      },
      "duplicate modifier-list authority in a single envelope bucket is rejected"
    ],
    [
      {
        objects: [
          square.squarePhase2B1B2Tax(),
          square.squarePhase2B1B2Tax()
        ]
      },
      "duplicate tax authority in a single envelope bucket is rejected"
    ]
  ]) {
    rejected(parseCatalog(fixture), message);
  }

  for (const [baseObject, objectWithData, message] of [
    [
      square.squarePhase2B1B2DeletedModifierList(),
      square.squarePhase2B1B2DeletedModifierList({
        modifier_list_data: {
          name: "<script>discarded tombstone data</script>",
          modifiers: [square.squarePhase2B1B2Modifier()]
        }
      }),
      "deleted modifier-list matching data is ignored"
    ],
    [
      square.squarePhase2B1B2DeletedModifier(),
      square.squarePhase2B1B2DeletedModifier({
        modifier_data: {
          name: "<script>discarded tombstone data</script>",
          price_money: { amount: 999, currency: "USD" },
          modifier_list_id: "SQ2B1B2MODLIST001"
        }
      }),
      "deleted modifier matching data is ignored"
    ],
    [
      square.squarePhase2B1B2DeletedDiscount(),
      square.squarePhase2B1B2DeletedDiscount({
        discount_data: {
          name: "<script>discarded tombstone data</script>",
          discount_type: "FIXED_PERCENTAGE",
          percentage: "99"
        }
      }),
      "deleted discount matching data is ignored"
    ],
    [
      square.squarePhase2B1B2DeletedTax(),
      square.squarePhase2B1B2DeletedTax({
        tax_data: {
          name: "<script>discarded tombstone data</script>",
          calculation_phase: "TAX_TOTAL_PHASE",
          inclusion_type: "INCLUSIVE",
          percentage: "99"
        }
      }),
      "deleted tax matching data is ignored"
    ]
  ]) {
    const base = accepted(parseCatalog({ objects: [baseObject] }), message).items[0];
    const withData = accepted(parseCatalog({ objects: [objectWithData] }), message).items[0];
    deepEqual(withData, base, `${message}: trusted projection is unchanged`);
    equal(
      square.squareCatalogObjectFingerprint(withData),
      square.squareCatalogObjectFingerprint(base),
      `${message}: fingerprint is unchanged`
    );
  }
}

function testStructuralJsonBoundaries() {
  accepted(
    parseCatalog(catalogFixtures.hostileExcludedFields),
    "bounded hostile excluded fields do not fail structural JSON validation"
  );

  rejected(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax({ nested: () => "bad" })] }),
    "function values are rejected"
  );
  rejected(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax({ nested: Symbol("bad") })] }),
    "symbol values are rejected"
  );
  rejected(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax({ nested_number: Number.NaN })] }),
    "NaN is rejected"
  );
  rejected(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax({ nested_number: Infinity })] }),
    "Infinity is rejected"
  );
  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2Tax({
          nested_number: Number.MAX_SAFE_INTEGER + 1
        })
      ]
    }),
    "unsafe numeric representation is rejected"
  );

  const cyclic = square.squarePhase2B1B2ListEnvelope();
  cyclic.self = cyclic;
  rejected(parseCatalog(cyclic), "cyclic responses are rejected");

  const polluted = square.squarePhase2B1B2ListEnvelope();
  Object.defineProperty(polluted, "__proto__", {
    enumerable: true,
    configurable: true,
    value: { polluted: true }
  });
  rejected(parseCatalog(polluted), "pollution keys are rejected");

  const accessor = square.squarePhase2B1B2ListEnvelope();
  Object.defineProperty(accessor, "secret", {
    enumerable: true,
    get() {
      return "nope";
    }
  });
  rejected(parseCatalog(accessor), "accessor properties are rejected");

  const symbolKey = square.squarePhase2B1B2ListEnvelope();
  symbolKey[Symbol("secret")] = "nope";
  rejected(parseCatalog(symbolKey), "symbol keys are rejected");

  const unexpectedPrototype = Object.create({ inherited: "bad" });
  unexpectedPrototype.objects = [square.squarePhase2B1B2Tax()];
  rejected(parseCatalog(unexpectedPrototype), "unexpected object prototypes are rejected");

  rejected(
    parseCatalog({ objects: [square.squarePhase2B1B2Tax({ extra: deepObject(20) })] }),
    "excessive nesting depth is rejected"
  );
  rejected(
    parseCatalog({
      objects: [
        square.squarePhase2B1B2Tax({
          tax_data: {
            ...square.squarePhase2B1B2Tax().tax_data,
            future_extra: "x".repeat(4_097)
          }
        })
      ]
    }),
    "oversized discarded tax field is rejected structurally"
  );
}

function testAcceptedResultImmutability() {
  const value = accepted(
    parseCatalog(catalogFixtures.listCatalog),
    "immutability fixture accepted"
  );
  const modifierList = findObject(value, "MODIFIER_LIST");
  const discount = findObject(value, "DISCOUNT");
  const tax = findObject(value, "TAX");

  for (const [item, label] of [
    [value, "Catalog response"],
    [value.provider, "Catalog response provider provenance"],
    [value.pagination, "Catalog pagination state"],
    [value.items, "Catalog primary object array"],
    [modifierList, "Catalog modifier-list projection"],
    [modifierList.authority, "Catalog modifier-list authority"],
    [modifierList.provider, "Catalog modifier-list provenance"],
    [modifierList.availability, "Catalog modifier-list availability"],
    [modifierList.modifiers, "Catalog modifier-list nested modifier array"],
    [modifierList.modifiers[0], "Catalog modifier projection"],
    [modifierList.modifiers[0].authority, "Catalog modifier authority"],
    [modifierList.modifiers[0].provider, "Catalog modifier provenance"],
    [
      modifierList.modifiers[0].parentModifierListAuthority,
      "Catalog modifier parent-list authority"
    ],
    [modifierList.modifiers[0].price, "Catalog modifier price"],
    [discount, "Catalog discount projection"],
    [discount.authority, "Catalog discount authority"],
    [discount.provider, "Catalog discount provenance"],
    [discount.maximumAmount, "Catalog discount maximum amount"],
    [tax, "Catalog tax projection"],
    [tax.authority, "Catalog tax authority"],
    [tax.provider, "Catalog tax provenance"]
  ]) {
    expectFrozen(item, label);
  }

  const snapshot = JSON.stringify(value);
  try {
    modifierList.displayName = "Mutated list";
  } catch {}
  try {
    modifierList.modifiers[0].price.amountMinor = "999";
  } catch {}
  try {
    modifierList.modifiers[0].parentModifierListAuthority.providerId = "CHANGED";
  } catch {}
  try {
    discount.maximumAmount.amountMinor = "1";
  } catch {}
  try {
    tax.provider.apiVersion = "2026-08-20";
  } catch {}
  equal(JSON.stringify(value), snapshot, "accepted Catalog result cannot be mutated");
  throws(
    () => value.items.push(discount),
    /Cannot|read only|extensible|frozen/i,
    "Catalog response item array cannot be extended"
  );
  throws(
    () => modifierList.modifiers.pop(),
    /Cannot|read only|extensible|frozen/i,
    "nested modifier array cannot be popped"
  );
}

function testDormancyAndRegistration() {
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Square Catalog validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "Square Catalog validation uses pinned API version");
  equal(
    square.SQUARE_CATALOG_ENTITY_VERSION,
    1,
    "Catalog entity version is the contract-owned constant"
  );
  const descriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  equal(
    descriptorRegistry.descriptors[0].descriptorFingerprint,
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

  const changedFiles = childProcess.execFileSync(
    "git",
    ["diff", "--name-only", "origin/main"],
    { cwd: root, encoding: "utf8" }
  ).trim();
  doesNotMatch(
    changedFiles,
    /^(app|components|supabase|services|lib\/supabase|vercel\.json)(?:\/|$)/m,
    "Square Phase 2B.1B-2 does not add runtime routes, UI, migrations, services, or live config"
  );

  const squareSources = [
    "lib/integrations/providers/square/catalog-responses.ts",
    "lib/integrations/providers/square/contracts.ts",
    "lib/integrations/providers/square/fixtures/phase-2b1b1.ts",
    "lib/integrations/providers/square/fixtures/phase-2b1b2.ts"
  ].map(read).join("\n");
  doesNotMatch(
    squareSources,
    /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|openai|generateText|streamText/i,
    "Square Phase 2B.1B-2 source has no network, database, environment, or model call path"
  );
}

function testSchemaExportsAndDocs() {
  ok(square.SquareMinimizedCatalogModifierListSchema, "modifier-list schema is exported");
  ok(square.SquareMinimizedCatalogModifierSchema, "modifier schema is exported");
  ok(square.SquareMinimizedCatalogDiscountSchema, "discount schema is exported");
  ok(square.SquareMinimizedCatalogTaxSchema, "tax schema is exported");

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b1b2"],
    "node scripts/external-integrations-square-phase-2b1b2-catalog-response-validation-regression-tests.js",
    "Square Phase 2B.1B-2 test script is registered"
  );
  matches(
    ciWorkflow,
    /pnpm test:external-integrations-square-phase-2b1b2/,
    "CI exercises the Square Phase 2B.1B-2 response validation suite"
  );
}

testAcceptedCatalogObjectFamilies();
testProviderAndVersionBoundaries();
testProviderErrors();
testMinimizationAndFingerprints();
testModifierListAndModifierSemantics();
testDiscountSemantics();
testTaxSemantics();
testDiscriminatorTombstonesAndDuplicates();
testStructuralJsonBoundaries();
testAcceptedResultImmutability();
testDormancyAndRegistration();
testSchemaExportsAndDocs();

const fixtureInventory =
  Object.keys(catalogFixtures).length +
  10;

console.log(
  `External integrations Square Phase 2B.1B-2 Catalog response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} fixture definitions. Square descriptor ${EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT}; QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}; active registry ${EXPECTED_QBO_REGISTRY_FINGERPRINT}.`
);
