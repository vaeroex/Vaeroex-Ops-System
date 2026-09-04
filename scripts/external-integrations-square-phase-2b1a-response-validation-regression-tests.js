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

const contract = require("../lib/integrations/contracts/index.ts");
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

const merchantFixtures = square.SQUARE_PHASE_2B1A_MERCHANT_FIXTURES;
const locationFixtures = square.SQUARE_PHASE_2B1A_LOCATION_FIXTURES;
const piiCanaryPattern = new RegExp(
  Object.values(square.SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
);
const sensitivePattern = new RegExp(
  [
    ...Object.values(square.SQUARE_PHASE_2B1A_SYNTHETIC_CANARIES),
    square.SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR,
    "SQ2B1AMERCHANT001",
    "SQ2B1ALOCATION001",
    "SQ2B1AMERCHANT003",
    "SQ2B1ALOCATION003"
  ]
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
);

function parserInput(response, overrides = {}) {
  return square.squarePhase2B1AParserInput(response, overrides);
}

function parseMerchant(response, overrides = {}) {
  fixtureScenarioCount += 1;
  return square.parseSquareMerchantResponse(parserInput(response, overrides));
}

function parseMerchantRawInput(input) {
  fixtureScenarioCount += 1;
  return square.parseSquareMerchantResponse(input);
}

function parseLocation(response, overrides = {}) {
  fixtureScenarioCount += 1;
  return square.parseSquareLocationResponse(parserInput(response, overrides));
}

function parseLocationRawInput(input) {
  fixtureScenarioCount += 1;
  return square.parseSquareLocationResponse(input);
}

function assertSafeDiagnostics(result, message) {
  const serialized = JSON.stringify(result.diagnostics);
  doesNotMatch(serialized, sensitivePattern, `${message}: diagnostics omit raw payload data`);
  doesNotMatch(
    serialized,
    /owner|email|phone|address|customer|coordinate|social|bearer|token/i,
    `${message}: diagnostics omit sensitive vocabulary`
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
  doesNotMatch(serialized, piiCanaryPattern, `${message}: PII canaries do not survive`);
  doesNotMatch(
    serialized,
    /owner_email|phone_number|business_email|address_line_1|postal_code|coordinates|business_hours|twitter_username|instagram_username|facebook_url|website_url|support_url|description|custom_receipt_text|return_policy|customer|account/i,
    `${message}: excluded fields do not survive`
  );
}

function assertFingerprintShape(fingerprint, message) {
  matches(fingerprint, /^sha256:[a-f0-9]{64}$/, `${message}: fingerprint shape`);
  doesNotMatch(fingerprint, sensitivePattern, `${message}: fingerprint does not expose raw data`);
  doesNotMatch(fingerprint, /Café|Tokyo|Grant|Park|Montréal|London/i, `${message}: fingerprint does not expose business text`);
}

function firstMerchantFingerprint(response, overrides = {}) {
  const value = accepted(parseMerchant(response, overrides), "merchant fingerprint input accepted");
  return square.squareMerchantFingerprint(value.items[0]);
}

function firstLocationFingerprint(response, overrides = {}) {
  const value = accepted(parseLocation(response, overrides), "location fingerprint input accepted");
  return square.squareLocationFingerprint(value.items[0]);
}

function testMerchantAcceptedProjection() {
  const active = accepted(parseMerchant(merchantFixtures.active), "active merchant accepted");
  equal(active.itemCount, 1, "active merchant item count is explicit");
  equal(active.provider.providerKey, "square", "merchant response provider is Square");
  equal(active.provider.providerEnvironment, "sandbox", "merchant response binds sandbox");
  equal(active.provider.apiVersion, "2026-08-19", "merchant response binds Square API version");
  equal(active.items[0].id, "SQ2B1AMERCHANT001", "merchant ID is retained");
  equal(active.items[0].authority.providerId, active.items[0].id, "merchant authority uses provider ID");
  equal(active.items[0].authority.entityType, "merchant", "merchant authority binds entity type");
  equal(active.items[0].status, "ACTIVE", "active merchant status is retained");
  equal(active.items[0].displayName, "Café São Paulo 東京 Ops", "international Unicode display name is retained");
  equal(active.items[0].country, "US", "merchant country is retained");
  equal(active.items[0].languageCode, "en-US", "merchant language is retained");
  equal(active.items[0].currency, "USD", "merchant currency is retained");
  equal(active.items[0].mainLocationId, "SQ2B1ALOCATION001", "merchant main location ID is retained");
  equal(active.items[0].createdAt, "2026-08-19T12:00:00.000Z", "merchant creation timestamp is retained");
  equal(active.items[0].entityVersion, 1, "merchant entity version is contract-owned");
  equal(Object.prototype.hasOwnProperty.call(active.items[0], "version"), false, "merchant provider version is not trusted output");
  doesNotMatch(JSON.stringify(active.items[0].authority), /displayName|business_name|Café/, "display name is not merchant authority");

  const inactive = accepted(parseMerchant(merchantFixtures.inactive), "inactive merchant accepted");
  equal(inactive.items[0].status, "INACTIVE", "inactive merchant status is retained");
  equal(inactive.items[0].currency, "CAD", "second merchant currency is retained");
  equal(inactive.items[0].country, "CA", "second merchant country is retained");
  equal(inactive.items[0].languageCode, "fr-CA", "second merchant language is retained");
  equal(inactive.items[0].entityVersion, 1, "second merchant version remains contract-owned");

  const multiple = accepted(parseMerchant(merchantFixtures.multiple), "multiple merchants accepted");
  equal(multiple.itemCount, 2, "multiple merchant envelope retains both records");
  deepEqual(
    multiple.items.map((item) => item.currency),
    ["USD", "JPY"],
    "multiple merchant currencies are retained"
  );
  deepEqual(
    multiple.items.map((item) => item.country),
    ["US", "JP"],
    "multiple merchant countries are retained"
  );

  const empty = accepted(parseMerchant(merchantFixtures.empty), "empty merchant envelope accepted");
  equal(empty.itemCount, 0, "empty merchant envelope has zero items");
  equal(Object.prototype.hasOwnProperty.call(empty, "cursor"), false, "empty merchant envelope has no trusted cursor state");

  const extraCursor = accepted(parseMerchant(merchantFixtures.extraCursor), "merchant envelope with extra cursor accepted");
  deepEqual(extraCursor, empty, "merchant cursor is discarded from trusted output");

  const optionalNulls = accepted(parseMerchant(merchantFixtures.optionalNulls), "merchant optional null fields accepted");
  equal(optionalNulls.items[0].displayName, null, "merchant nullable display name is explicit");
  equal(optionalNulls.items[0].languageCode, null, "merchant nullable language is explicit");
  equal(optionalNulls.items[0].currency, null, "merchant nullable currency is explicit");
  equal(optionalNulls.items[0].mainLocationId, null, "merchant nullable main location is explicit");
  equal(optionalNulls.items[0].createdAt, null, "merchant nullable creation timestamp is explicit");
}

function testLocationAcceptedProjection() {
  const active = accepted(parseLocation(locationFixtures.active), "active location accepted");
  equal(active.itemCount, 1, "active location item count is explicit");
  equal(active.provider.providerKey, "square", "location response provider is Square");
  equal(active.provider.providerEnvironment, "sandbox", "location response binds sandbox");
  equal(active.provider.apiVersion, "2026-08-19", "location response binds Square API version");
  equal(active.items[0].id, "SQ2B1ALOCATION001", "location ID is retained");
  equal(active.items[0].merchantId, "SQ2B1AMERCHANT001", "official location merchant relationship is retained");
  equal(active.items[0].authority.providerId, active.items[0].id, "location authority uses provider ID");
  equal(active.items[0].authority.entityType, "location", "location authority binds entity type");
  equal(active.items[0].status, "ACTIVE", "active location status is retained");
  equal(active.items[0].displayName, "Grant Park Café 東京", "international Unicode location name is retained");
  equal(active.items[0].timeZone, "America/Los_Angeles", "location IANA timezone is retained");
  equal(active.items[0].currency, "USD", "location currency is retained");
  equal(active.items[0].country, "US", "location country is retained");
  equal(active.items[0].locationType, "PHYSICAL", "location type is retained");
  equal(active.items[0].createdAt, "2026-08-19T12:30:00.000Z", "location creation timestamp is retained");
  equal(Object.prototype.hasOwnProperty.call(active.items[0], "updatedAt"), false, "location updated_at is not trusted output");
  equal(Object.prototype.hasOwnProperty.call(active.items[0], "version"), false, "location provider version is not trusted output");
  equal(active.items[0].entityVersion, 1, "location entity version is contract-owned");
  doesNotMatch(JSON.stringify(active.items[0].authority), /displayName|Grant|Park|name/, "display name is not location authority");

  const inactive = accepted(parseLocation(locationFixtures.inactive), "inactive location accepted");
  equal(inactive.items[0].status, "INACTIVE", "inactive location status is retained");
  equal(inactive.items[0].timeZone, "America/Toronto", "second location timezone is retained");
  equal(inactive.items[0].currency, "CAD", "second location currency is retained");
  equal(inactive.items[0].country, "CA", "second location country is retained");

  const multiple = accepted(parseLocation(locationFixtures.multiple), "multiple locations accepted");
  equal(multiple.itemCount, 3, "multiple location envelope retains all records");
  deepEqual(
    multiple.items.map((item) => item.timeZone),
    ["America/Los_Angeles", "Asia/Tokyo", "Europe/London"],
    "multiple location timezones are retained"
  );
  deepEqual(
    multiple.items.map((item) => item.locationType),
    ["PHYSICAL", "MOBILE", "PHYSICAL"],
    "multiple location types are retained"
  );

  const retrieveShape = accepted(
    parseLocation({ location: square.squarePhase2B1ALocation({ id: "SQ2B1ALOCATION007" }) }),
    "retrieve location envelope accepted"
  );
  equal(retrieveShape.itemCount, 1, "single location response maps to one item");

  const empty = accepted(parseLocation(locationFixtures.empty), "empty location envelope accepted");
  equal(empty.itemCount, 0, "empty location envelope has zero items");
  equal(Object.prototype.hasOwnProperty.call(empty, "cursor"), false, "empty location envelope has no trusted cursor state");

  const extraCursor = accepted(parseLocation(locationFixtures.extraCursor), "location envelope with extra cursor accepted");
  deepEqual(extraCursor, empty, "location cursor is discarded from trusted output");

  const optionalNulls = accepted(parseLocation(locationFixtures.optionalNulls), "location optional null fields accepted");
  equal(optionalNulls.items[0].merchantId, null, "location nullable merchant relationship is explicit");
  equal(optionalNulls.items[0].displayName, null, "location nullable display name is explicit");
  equal(optionalNulls.items[0].locationType, null, "location nullable type is explicit");
  equal(optionalNulls.items[0].createdAt, null, "location nullable creation timestamp is explicit");
  equal(Object.prototype.hasOwnProperty.call(optionalNulls.items[0], "updatedAt"), false, "location updated_at remains absent when input is null");
}

function testRejectedAndUnsupportedPayloads() {
  for (const [name, fixture] of [
    ["missing required merchant", merchantFixtures.missingRequired],
    ["unknown merchant status", merchantFixtures.unknownStatus],
    ["malformed merchant timestamp", merchantFixtures.malformedTimestamp],
    ["malformed merchant currency", merchantFixtures.malformedCurrency],
    ["oversized merchant display name", merchantFixtures.oversizedDisplayName],
    ["merchant HTML display name", merchantFixtures.htmlDisplayName],
    ["merchant bidirectional display name", merchantFixtures.bidirectionalDisplayName],
    ["merchant control display name", merchantFixtures.controlDisplayName],
    ["merchant prototype pollution", merchantFixtures.prototypePollution],
    ["duplicate merchant authorities", merchantFixtures.duplicateAuthorities],
    ["oversized merchant array", square.squarePhase2B1AOversizedMerchantArray()],
    ["oversized merchant cursor", square.squarePhase2B1AOversizedCursorEnvelope("merchant")],
    ["oversized merchant object", square.squarePhase2B1AOversizedObjectEnvelope("merchant")]
  ]) {
    rejected(parseMerchant(fixture), `${name} rejected`);
  }

  unsupported(
    parseMerchant({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1AMERCHANT001 synthetic detail"
        }
      ]
    }),
    "merchant provider error envelope is unsupported without leaking details"
  );
  unsupported(
    parseMerchant({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1AMERCHANT001 synthetic detail"
        }
      ],
      merchant: [square.squarePhase2B1AMerchant()]
    }),
    "merchant provider errors are not ignored when data is present"
  );
  rejected(
    parseMerchant({
      errors: {},
      merchant: [square.squarePhase2B1AMerchant()]
    }),
    "merchant malformed provider errors are rejected"
  );
  rejected(
    parseMerchant({
      errors: [null],
      merchant: [square.squarePhase2B1AMerchant()]
    }),
    "merchant malformed provider error entries are rejected"
  );
  const emptyMerchantErrors = accepted(
    parseMerchant({
      errors: [],
      merchant: [square.squarePhase2B1AMerchant()]
    }),
    "merchant explicitly empty provider errors are accepted"
  );
  deepEqual(emptyMerchantErrors, accepted(parseMerchant(merchantFixtures.active), "merchant without errors accepted"), "empty merchant errors do not enter trusted output");

  for (const [name, fixture] of [
    ["invalid location timezone", locationFixtures.invalidTimezone],
    ["unsupported location timezone alias", locationFixtures.unsupportedTimezoneAlias],
    ["missing required location", locationFixtures.missingRequired],
    ["unknown location status", locationFixtures.unknownStatus],
    ["unknown location type", locationFixtures.unknownType],
    ["malformed location timestamp", locationFixtures.malformedTimestamp],
    ["malformed location currency", locationFixtures.malformedCurrency],
    ["oversized location display name", locationFixtures.oversizedDisplayName],
    ["location HTML display name", locationFixtures.htmlDisplayName],
    ["location bidirectional display name", locationFixtures.bidirectionalDisplayName],
    ["location control display name", locationFixtures.controlDisplayName],
    ["location prototype pollution", locationFixtures.prototypePollution],
    ["duplicate location authorities", locationFixtures.duplicateAuthorities],
    ["oversized location array", square.squarePhase2B1AOversizedLocationArray()],
    ["oversized location cursor", square.squarePhase2B1AOversizedCursorEnvelope("location")],
    ["oversized location object", square.squarePhase2B1AOversizedObjectEnvelope("location")]
  ]) {
    rejected(parseLocation(fixture), `${name} rejected`);
  }

  unsupported(parseLocation(locationFixtures.missingTimezone), "missing location timezone is unsupported");
  unsupported(
    parseLocation({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1ALOCATION001 synthetic detail"
        }
      ]
    }),
    "location provider error envelope is unsupported without leaking details"
  );
  unsupported(
    parseLocation({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1ALOCATION001 synthetic detail"
        }
      ],
      location: square.squarePhase2B1ALocation()
    }),
    "location provider errors are not ignored when location data is present"
  );
  unsupported(
    parseLocation({
      errors: [
        {
          category: "AUTHENTICATION_ERROR",
          detail: "SQ2B1ALOCATION001 synthetic detail"
        }
      ],
      locations: [square.squarePhase2B1ALocation()]
    }),
    "location provider errors are not ignored when locations data is present"
  );
  rejected(
    parseLocation({
      errors: {},
      locations: [square.squarePhase2B1ALocation()]
    }),
    "location malformed provider errors are rejected"
  );
  rejected(
    parseLocation({
      errors: [null],
      locations: [square.squarePhase2B1ALocation()]
    }),
    "location malformed provider error entries are rejected"
  );
  const emptyLocationErrors = accepted(
    parseLocation({
      errors: [],
      locations: [square.squarePhase2B1ALocation()]
    }),
    "location explicitly empty provider errors are accepted"
  );
  deepEqual(emptyLocationErrors, accepted(parseLocation(locationFixtures.active), "location without errors accepted"), "empty location errors do not enter trusted output");
}

function testUntrustedJsonBoundaries() {
  rejected(
    parseMerchant(square.squarePhase2B1AMerchantEnvelope({ nested: () => "bad" })),
    "function values are rejected"
  );
  rejected(
    parseMerchant(square.squarePhase2B1AMerchantEnvelope({ nested: Symbol("bad") })),
    "symbol values are rejected"
  );
  rejected(
    parseMerchant(square.squarePhase2B1AMerchantEnvelope({ nested_number: Number.NaN })),
    "NaN is rejected"
  );
  rejected(
    parseMerchant(square.squarePhase2B1AMerchantEnvelope({ nested_number: Number.POSITIVE_INFINITY })),
    "Infinity is rejected"
  );
  rejected(
    parseMerchant(square.squarePhase2B1AMerchantEnvelope({ description: "D".repeat(4_097) })),
    "oversized excluded merchant strings are rejected structurally"
  );
  rejected(
    parseLocation(square.squarePhase2B1ALocationEnvelope({ description: "L".repeat(4_097) })),
    "oversized excluded location strings are rejected structurally"
  );

  const accessorEnvelope = {};
  Object.defineProperty(accessorEnvelope, "merchant", {
    enumerable: true,
    get() {
      return [];
    }
  });
  rejected(parseMerchant(accessorEnvelope), "accessor properties are rejected");

  class SyntheticMerchantEnvelope {
    constructor() {
      this.merchant = [];
    }
  }
  rejected(parseMerchant(new SyntheticMerchantEnvelope()), "class instances are rejected");

  const cyclicEnvelope = square.squarePhase2B1AMerchantEnvelope();
  cyclicEnvelope.self = cyclicEnvelope;
  rejected(parseMerchant(cyclicEnvelope), "cyclic response data is rejected");

  const customArray = [square.squarePhase2B1AMerchant()];
  customArray.extra = "custom-array-property";
  rejected(parseMerchant({ merchant: customArray }), "arrays with custom properties are rejected");

  const arrayAccessor = [square.squarePhase2B1AMerchant()];
  Object.defineProperty(arrayAccessor, 0, {
    enumerable: true,
    get() {
      return square.squarePhase2B1AMerchant();
    }
  });
  rejected(parseMerchant({ merchant: arrayAccessor }), "array accessors are rejected");

  class SyntheticLocation {
    constructor() {
      Object.assign(this, square.squarePhase2B1ALocation());
    }
  }
  rejected(parseLocation({ locations: [new SyntheticLocation()] }), "nested class instances are rejected");

  const symbolKeyEnvelope = square.squarePhase2B1ALocationEnvelope();
  symbolKeyEnvelope.locations[0][Symbol.for("sq2b1a")] = "symbol-key";
  rejected(parseLocation(symbolKeyEnvelope), "symbol keys are rejected");

  equal({}.polluted, undefined, "prototype pollution did not affect Object before parsing");
  rejected(parseMerchant(merchantFixtures.prototypePollution), "merchant pollution payload rejected");
  rejected(parseLocation(locationFixtures.prototypePollution), "location pollution payload rejected");
  equal({}.polluted, undefined, "prototype pollution did not affect Object after parsing");
}

function testMinimizationAndFingerprints() {
  const baseMerchant = accepted(parseMerchant(merchantFixtures.active), "base merchant accepted");
  const merchantWithSensitiveExtras = accepted(
    parseMerchant(merchantFixtures.contactAndOwnerCanaries),
    "merchant with sensitive extras accepted"
  );
  const merchantWithUnexpectedExtras = accepted(
    parseMerchant(merchantFixtures.unexpectedNestedFields),
    "merchant with unexpected extras accepted"
  );
  const merchantWithHostileExcludedFields = accepted(
    parseMerchant(merchantFixtures.excludedHostileFields),
    "merchant with hostile excluded fields accepted"
  );
  const merchantWithExtraCursor = accepted(
    parseMerchant(
      square.squarePhase2B1AMerchantEnvelope(
        {},
        { cursor: square.SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR }
      )
    ),
    "merchant with extra cursor accepted"
  );
  const merchantWithExtraVersion = accepted(
    parseMerchant(merchantFixtures.extraVersion),
    "merchant with undocumented extra version accepted"
  );
  const merchantWithFractionalExtraVersion = accepted(
    parseMerchant(merchantFixtures.extraFractionalVersion),
    "merchant with fractional undocumented extra version accepted"
  );
  assertProjectionClean(merchantWithSensitiveExtras, "merchant projection");
  assertProjectionClean(merchantWithUnexpectedExtras, "merchant unexpected projection");
  assertProjectionClean(merchantWithHostileExcludedFields, "merchant hostile excluded projection");
  deepEqual(
    merchantWithSensitiveExtras,
    baseMerchant,
    "merchant contact extras do not change projection"
  );
  deepEqual(
    merchantWithUnexpectedExtras,
    baseMerchant,
    "merchant unexpected extras do not change projection"
  );
  deepEqual(
    merchantWithHostileExcludedFields,
    baseMerchant,
    "merchant hostile excluded fields do not change projection"
  );
  deepEqual(
    merchantWithExtraCursor,
    baseMerchant,
    "merchant extra cursor does not change projection"
  );
  deepEqual(
    merchantWithExtraVersion,
    baseMerchant,
    "merchant undocumented version does not change projection"
  );
  deepEqual(
    merchantWithFractionalExtraVersion,
    baseMerchant,
    "merchant fractional undocumented version does not change projection"
  );

  const baseMerchantFingerprint = square.squareMerchantFingerprint(baseMerchant.items[0]);
  const sensitiveMerchantFingerprint = square.squareMerchantFingerprint(
    merchantWithSensitiveExtras.items[0]
  );
  const unexpectedMerchantFingerprint = square.squareMerchantFingerprint(
    merchantWithUnexpectedExtras.items[0]
  );
  const hostileExcludedMerchantFingerprint = square.squareMerchantFingerprint(
    merchantWithHostileExcludedFields.items[0]
  );
  assertFingerprintShape(baseMerchantFingerprint, "merchant");
  equal(
    sensitiveMerchantFingerprint,
    baseMerchantFingerprint,
    "merchant sensitive extras do not affect fingerprints"
  );
  equal(
    unexpectedMerchantFingerprint,
    baseMerchantFingerprint,
    "merchant unexpected extras do not affect fingerprints"
  );
  equal(
    hostileExcludedMerchantFingerprint,
    baseMerchantFingerprint,
    "merchant hostile excluded fields do not affect fingerprints"
  );
  equal(
    square.squareMerchantFingerprint(merchantWithExtraCursor.items[0]),
    baseMerchantFingerprint,
    "merchant extra cursor does not affect fingerprints"
  );
  equal(
    square.squareMerchantFingerprint(merchantWithExtraVersion.items[0]),
    baseMerchantFingerprint,
    "merchant undocumented version does not affect fingerprints"
  );
  equal(
    square.squareMerchantFingerprint(merchantWithFractionalExtraVersion.items[0]),
    baseMerchantFingerprint,
    "merchant fractional undocumented version does not affect fingerprints"
  );

  const repeatedMerchant = accepted(parseMerchant(merchantFixtures.active), "repeated merchant parse accepted");
  deepEqual(repeatedMerchant, baseMerchant, "repeated merchant parsing is deterministic");
  equal(
    square.squareMerchantFingerprint(repeatedMerchant.items[0]),
    baseMerchantFingerprint,
    "repeated merchant fingerprint is stable"
  );

  const productionMerchantFingerprint = firstMerchantFingerprint(
    merchantFixtures.active,
    { providerEnvironment: "production" }
  );
  notEqual(
    productionMerchantFingerprint,
    baseMerchantFingerprint,
    "merchant fingerprint binds provider environment"
  );
  notEqual(
    firstMerchantFingerprint(
      square.squarePhase2B1AMerchantEnvelope({ id: "SQ2B1AMERCHANT009" })
    ),
    baseMerchantFingerprint,
    "merchant fingerprint binds provider identity"
  );
  equal(
    firstMerchantFingerprint(square.squarePhase2B1AMerchantEnvelope({ version: 99 })),
    baseMerchantFingerprint,
    "merchant extra provider version remains excluded from fingerprints"
  );

  const baseLocation = accepted(parseLocation(locationFixtures.active), "base location accepted");
  const locationWithSensitiveExtras = accepted(
    parseLocation(locationFixtures.contactAddressAndSocialCanaries),
    "location with sensitive extras accepted"
  );
  const locationWithUnexpectedExtras = accepted(
    parseLocation(locationFixtures.unexpectedNestedFields),
    "location with unexpected extras accepted"
  );
  const locationWithHostileExcludedFields = accepted(
    parseLocation(locationFixtures.excludedHostileFields),
    "location with hostile excluded fields accepted"
  );
  const locationWithExtraCursor = accepted(
    parseLocation(
      square.squarePhase2B1ALocationEnvelope(
        {},
        { cursor: square.SQUARE_PHASE_2B1A_SYNTHETIC_CURSOR }
      )
    ),
    "location with extra cursor accepted"
  );
  const locationWithExtraUpdatedAt = accepted(
    parseLocation(locationFixtures.extraUpdatedAt),
    "location with undocumented extra updated_at accepted"
  );
  const locationWithExtraVersion = accepted(
    parseLocation(locationFixtures.extraVersion),
    "location with undocumented extra version accepted"
  );
  const locationWithFractionalExtraVersion = accepted(
    parseLocation(locationFixtures.extraFractionalVersion),
    "location with fractional undocumented extra version accepted"
  );
  assertProjectionClean(locationWithSensitiveExtras, "location projection");
  assertProjectionClean(locationWithUnexpectedExtras, "location unexpected projection");
  assertProjectionClean(locationWithHostileExcludedFields, "location hostile excluded projection");
  deepEqual(
    locationWithSensitiveExtras,
    baseLocation,
    "location contact extras do not change projection"
  );
  deepEqual(
    locationWithUnexpectedExtras,
    baseLocation,
    "location unexpected extras do not change projection"
  );
  deepEqual(
    locationWithHostileExcludedFields,
    baseLocation,
    "location hostile excluded fields do not change projection"
  );
  deepEqual(
    locationWithExtraCursor,
    baseLocation,
    "location extra cursor does not change projection"
  );
  deepEqual(
    locationWithExtraUpdatedAt,
    baseLocation,
    "location undocumented updated_at does not change projection"
  );
  deepEqual(
    locationWithExtraVersion,
    baseLocation,
    "location undocumented version does not change projection"
  );
  deepEqual(
    locationWithFractionalExtraVersion,
    baseLocation,
    "location fractional undocumented version does not change projection"
  );

  const baseLocationFingerprint = square.squareLocationFingerprint(baseLocation.items[0]);
  const sensitiveLocationFingerprint = square.squareLocationFingerprint(
    locationWithSensitiveExtras.items[0]
  );
  const unexpectedLocationFingerprint = square.squareLocationFingerprint(
    locationWithUnexpectedExtras.items[0]
  );
  const hostileExcludedLocationFingerprint = square.squareLocationFingerprint(
    locationWithHostileExcludedFields.items[0]
  );
  assertFingerprintShape(baseLocationFingerprint, "location");
  equal(
    sensitiveLocationFingerprint,
    baseLocationFingerprint,
    "location sensitive extras do not affect fingerprints"
  );
  equal(
    unexpectedLocationFingerprint,
    baseLocationFingerprint,
    "location unexpected extras do not affect fingerprints"
  );
  equal(
    hostileExcludedLocationFingerprint,
    baseLocationFingerprint,
    "location hostile excluded fields do not affect fingerprints"
  );
  equal(
    square.squareLocationFingerprint(locationWithExtraCursor.items[0]),
    baseLocationFingerprint,
    "location extra cursor does not affect fingerprints"
  );
  equal(
    square.squareLocationFingerprint(locationWithExtraUpdatedAt.items[0]),
    baseLocationFingerprint,
    "location undocumented updated_at does not affect fingerprints"
  );
  equal(
    square.squareLocationFingerprint(locationWithExtraVersion.items[0]),
    baseLocationFingerprint,
    "location undocumented version does not affect fingerprints"
  );
  equal(
    square.squareLocationFingerprint(locationWithFractionalExtraVersion.items[0]),
    baseLocationFingerprint,
    "location fractional undocumented version does not affect fingerprints"
  );

  const repeatedLocation = accepted(parseLocation(locationFixtures.active), "repeated location parse accepted");
  deepEqual(repeatedLocation, baseLocation, "repeated location parsing is deterministic");
  equal(
    square.squareLocationFingerprint(repeatedLocation.items[0]),
    baseLocationFingerprint,
    "repeated location fingerprint is stable"
  );

  const productionLocationFingerprint = firstLocationFingerprint(
    locationFixtures.active,
    { providerEnvironment: "production" }
  );
  notEqual(
    productionLocationFingerprint,
    baseLocationFingerprint,
    "location fingerprint binds provider environment"
  );
  notEqual(
    firstLocationFingerprint(
      square.squarePhase2B1ALocationEnvelope({ id: "SQ2B1ALOCATION009" })
    ),
    baseLocationFingerprint,
    "location fingerprint binds provider identity"
  );
  equal(
    firstLocationFingerprint(square.squarePhase2B1ALocationEnvelope({ updated_at: "2026-08-19T15:30:00.000Z" })),
    baseLocationFingerprint,
    "location extra updated_at remains excluded from fingerprints"
  );
  equal(
    firstLocationFingerprint(square.squarePhase2B1ALocationEnvelope({ version: 99 })),
    baseLocationFingerprint,
    "location extra provider version remains excluded from fingerprints"
  );
  notEqual(
    square.squareMerchantFingerprint(
      accepted(
        parseMerchant(square.squarePhase2B1AMerchantEnvelope({ id: "SQ2B1ALOCATION001" }))
      ).items[0]
    ),
    baseLocationFingerprint,
    "fingerprints bind entity type"
  );
}

function testVersionAndProvenanceOutcomes() {
  incompatible(
    parseMerchant(merchantFixtures.active, { apiVersion: "2026-07-15" }),
    "merchant parser rejects incompatible Square API version"
  );
  incompatible(
    parseLocation(locationFixtures.active, { apiVersion: "not-a-version" }),
    "location parser rejects malformed Square API version as incompatible"
  );
  rejected(
    parseMerchantRawInput({
      providerEnvironment: "sandbox",
      apiVersion: "2026-08-19",
      response: merchantFixtures.active
    }),
    "merchant parser rejects missing provider key"
  );
  rejected(
    parseMerchant(merchantFixtures.active, { providerKey: null }),
    "merchant parser rejects null provider key"
  );
  rejected(
    parseMerchant(merchantFixtures.active, { providerKey: undefined }),
    "merchant parser rejects undefined provider key"
  );
  rejected(
    parseMerchant(merchantFixtures.active, { providerKey: "" }),
    "merchant parser rejects empty provider key"
  );
  rejected(
    parseMerchant(merchantFixtures.active, { providerKey: "not_square" }),
    "merchant parser rejects another provider key"
  );
  rejected(
    parseLocationRawInput({
      providerEnvironment: "sandbox",
      apiVersion: "2026-08-19",
      response: locationFixtures.active
    }),
    "location parser rejects missing provider key"
  );
  rejected(
    parseLocation(locationFixtures.active, { providerKey: null }),
    "location parser rejects null provider key"
  );
  rejected(
    parseLocation(locationFixtures.active, { providerKey: undefined }),
    "location parser rejects undefined provider key"
  );
  rejected(
    parseLocation(locationFixtures.active, { providerKey: "" }),
    "location parser rejects empty provider key"
  );
  rejected(
    parseLocation(locationFixtures.active, { providerKey: "quickbooks_online" }),
    "location parser rejects another provider key"
  );
  rejected(
    parseLocation(locationFixtures.active, { providerEnvironment: "staging" }),
    "location parser rejects unknown provider environment"
  );
}

function testAcceptedResultImmutability() {
  const merchantResult = parseMerchant(merchantFixtures.active);
  equal(merchantResult.outcome, "accepted", "merchant result is accepted for immutability checks");
  const merchantValue = merchantResult.value;
  ok(Object.isFrozen(merchantResult), "merchant accepted result is frozen");
  ok(Object.isFrozen(merchantResult.diagnostics), "merchant accepted diagnostics are frozen");
  ok(Object.isFrozen(merchantValue), "merchant response projection is frozen");
  ok(Object.isFrozen(merchantValue.provider), "merchant response provider provenance is frozen");
  ok(Object.isFrozen(merchantValue.items), "merchant response item array is frozen");
  ok(Object.isFrozen(merchantValue.items[0]), "merchant trusted item is frozen");
  ok(Object.isFrozen(merchantValue.items[0].authority), "merchant authority is frozen");
  const merchantSnapshot = JSON.stringify(merchantValue);
  try {
    merchantValue.items[0].displayName = "Mutated Merchant";
  } catch {}
  equal(JSON.stringify(merchantValue), merchantSnapshot, "merchant trusted projection cannot be mutated");
  throws(
    () => merchantValue.items.push(merchantValue.items[0]),
    /Cannot|read only|extensible|frozen/i,
    "merchant trusted item array cannot be extended"
  );

  const locationResult = parseLocation(locationFixtures.active);
  equal(locationResult.outcome, "accepted", "location result is accepted for immutability checks");
  const locationValue = locationResult.value;
  ok(Object.isFrozen(locationResult), "location accepted result is frozen");
  ok(Object.isFrozen(locationResult.diagnostics), "location accepted diagnostics are frozen");
  ok(Object.isFrozen(locationValue), "location response projection is frozen");
  ok(Object.isFrozen(locationValue.provider), "location response provider provenance is frozen");
  ok(Object.isFrozen(locationValue.items), "location response item array is frozen");
  ok(Object.isFrozen(locationValue.items[0]), "location trusted item is frozen");
  ok(Object.isFrozen(locationValue.items[0].authority), "location authority is frozen");
  const locationSnapshot = JSON.stringify(locationValue);
  try {
    locationValue.items[0].displayName = "Mutated Location";
  } catch {}
  equal(JSON.stringify(locationValue), locationSnapshot, "location trusted projection cannot be mutated");
  throws(
    () => locationValue.items.push(locationValue.items[0]),
    /Cannot|read only|extensible|frozen/i,
    "location trusted item array cannot be extended"
  );
}

function testDormancyAndRegistration() {
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Square response validation makes zero model calls");
  equal(square.SQUARE_API_VERSION, "2026-08-19", "Square response validation uses the required API version");

  const squareDescriptorRegistry = controlPlane.createProviderDescriptorRegistry([
    square.SQUARE_PROVIDER_DESCRIPTOR
  ]);
  const squareDescriptorFingerprint =
    squareDescriptorRegistry.descriptors[0].descriptorFingerprint;
  equal(
    squareDescriptorFingerprint,
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

  const squarePhase2B1ASources = [
    "lib/integrations/providers/square/response-validation.ts",
    "lib/integrations/providers/square/merchant-responses.ts",
    "lib/integrations/providers/square/location-responses.ts",
    "lib/integrations/providers/square/fixtures/phase-2b1a.ts"
  ].map(read).join("\n");
  doesNotMatch(
    squarePhase2B1ASources,
    /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|openai|generateText|streamText/i,
    "Square Phase 2B.1A source has no network, database, environment, or model call path"
  );
  doesNotMatch(
    squarePhase2B1ASources,
    /\bCatalog\b|catalog_response|catalog_minimizer/i,
    "Square Phase 2B.1A source does not start Catalog response validation"
  );
  equal(
    fs.existsSync(path.join(root, "lib/integrations/providers/square/catalog-responses.ts")),
    true,
    "Catalog response module is owned by Phase 2B.1B-1"
  );

  const packageJson = JSON.parse(read("package.json"));
  const ciWorkflow = read(".github/workflows/ci.yml");
  equal(
    packageJson.scripts["test:external-integrations-square-phase-2b1a"],
    "node scripts/external-integrations-square-phase-2b1a-response-validation-regression-tests.js",
    "Square Phase 2B.1A test script is registered"
  );
  matches(
    ciWorkflow,
    /pnpm test:external-integrations-square-phase-2b1a/,
    "CI exercises the Square Phase 2B.1A response validation suite"
  );

  const descriptor = contract.ProviderDescriptorSchema.parse(
    square.SQUARE_PROVIDER_DESCRIPTOR
  );
  ok(
    descriptor.unsupportedCapabilities.includes("live_provider_access"),
    "Square descriptor remains non-executable"
  );
  ok(
    descriptor.unsupportedCapabilities.includes("database_registration"),
    "Square descriptor remains outside database registration"
  );
  ok(
    descriptor.unsupportedCapabilities.includes("oauth_policy_registration"),
    "Square descriptor still does not register OAuth"
  );
}

testMerchantAcceptedProjection();
testLocationAcceptedProjection();
testRejectedAndUnsupportedPayloads();
testUntrustedJsonBoundaries();
testMinimizationAndFingerprints();
testVersionAndProvenanceOutcomes();
testAcceptedResultImmutability();
testDormancyAndRegistration();

const fixtureInventory =
  Object.keys(merchantFixtures).length +
  Object.keys(locationFixtures).length +
  10;

console.log(
  `External integrations Square Phase 2B.1A response validation regressions: ${assertionCount} assertions passed across ${fixtureScenarioCount} parser scenarios and ${fixtureInventory} fixture definitions. Square descriptor ${EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT}; QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}; active registry ${EXPECTED_QBO_REGISTRY_FINGERPRINT}.`
);
