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
const operationPolicy = require("../lib/integrations/provider-runtime/read-only-operation-policy.ts");
const square = require("../lib/integrations/providers/square/index.ts");

let assertionCount = 0;
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
function doesNotThrow(callback, message) {
  assertionCount += 1;
  assert.doesNotThrow(callback, message);
}

const EXPECTED_QBO_DESCRIPTOR_FINGERPRINT =
  "sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f";
const EXPECTED_QBO_REGISTRY_FINGERPRINT =
  "sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad";
const EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT =
  "sha256:fe6cc473b1fb529bc07a7c5471baf5eae047ea9500cec7c12840876dfe666771";
const EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT =
  "sha256:79b16a44b07c214a0e0f3cf06f36a05bf67000ad27119e1955713d0a64fddd05";
const EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT =
  "sha256:8a219cd66c389b04e8a84a9b1602b863a75b7bd04ac80d5b5a119eccc09b8b6d";
const EXPECTED_SQUARE_READ_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ITEMS_READ",
  "INVENTORY_READ",
  "ORDERS_READ",
  "PAYMENTS_READ"
];
const EXPECTED_POST_PATHS = [
  "/v2/orders/search",
  "/v2/orders/batch-retrieve",
  "/v2/catalog/search",
  "/v2/catalog/batch-retrieve",
  "/v2/inventory/counts/batch-retrieve",
  "/v2/inventory/changes/batch-retrieve"
];
const EXPECTED_POST_BINDINGS = {
  "/v2/orders/search": {
    requestValidatorKey: "square_orders_search_request_v1",
    maximumRequestBodyBytes: 24 * 1024
  },
  "/v2/orders/batch-retrieve": {
    requestValidatorKey: "square_orders_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 16 * 1024
  },
  "/v2/catalog/search": {
    requestValidatorKey: "square_catalog_search_request_v1",
    maximumRequestBodyBytes: 24 * 1024
  },
  "/v2/catalog/batch-retrieve": {
    requestValidatorKey: "square_catalog_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024
  },
  "/v2/inventory/counts/batch-retrieve": {
    requestValidatorKey: "square_inventory_counts_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024
  },
  "/v2/inventory/changes/batch-retrieve": {
    requestValidatorKey: "square_inventory_changes_batch_retrieve_request_v1",
    maximumRequestBodyBytes: 32 * 1024
  }
};
const EXPECTED_UNCHANGED_POST_REQUEST_FINGERPRINTS = {
  "/v2/orders/batch-retrieve":
    "sha256:b81099ad43af09b7d855a21b024ff391a1c85739b41f56cb55c16e2ced2d9b7f",
  "/v2/catalog/search":
    "sha256:4f18f0cbb0523f6853cd4731364a67fcd81ef7bba91037a6a8ff021eeefc5f5b",
  "/v2/catalog/batch-retrieve":
    "sha256:37bc81a66ebb6ec5ff47a4e433751d8839752259cb9c020da5c3514263461673",
  "/v2/inventory/counts/batch-retrieve":
    "sha256:4cb0aa0e02d46fe8847e2ef788a5c54e1efd2957d2ead9c1e9de5bbe87ea75fc",
  "/v2/inventory/changes/batch-retrieve":
    "sha256:8efa4a97d92db5735186794a60cea78c0628521a7b4317bddf2d99f91f42a64e"
};
const sensitiveCanaries = [
  "phase2a-access-token-canary",
  "phase2a-refresh-token-canary",
  "phase2a-authorization-code-canary",
  "phase2a-client-secret-canary",
  "phase2a-location-raw-identity",
  "phase2a-cursor-canary",
  "phase2a-order-raw-identity",
  "phase2a-catalog-raw-identity",
  "phase2a-secret-search-value"
];
const sensitivePattern = new RegExp(sensitiveCanaries.join("|"));

function squareRequest(overrides = {}) {
  return {
    providerKey: square.SQUARE_PROVIDER_KEY,
    providerEnvironment: "sandbox",
    method: "POST",
    url: "https://connect.squareupsandbox.com/v2/orders/search",
    headers: {
      "Square-Version": square.SQUARE_API_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
      limit: 100
    }),
    ...overrides
  };
}

function getSquareRequest(url, overrides = {}) {
  return squareRequest({
    method: "GET",
    url,
    headers: { "Square-Version": square.SQUARE_API_VERSION },
    body: null,
    ...overrides
  });
}

function deniedSquare(overrides, message) {
  throws(
    () => square.assertSquareReadOperation(squareRequest(overrides)),
    /square_read_operation_denied/,
    message
  );
}

function deniedGet(url, message, overrides = {}) {
  throws(
    () => square.assertSquareReadOperation(getSquareRequest(url, overrides)),
    /square_read_operation_denied/,
    message
  );
}

function allowedSquare(overrides, message) {
  let decision;
  doesNotThrow(() => {
    decision = square.assertSquareReadOperation(squareRequest(overrides));
  }, message);
  return decision;
}

function body(value) {
  return JSON.stringify(value);
}

function repeatedBodies(count, factory) {
  return Array.from({ length: count }, (_, index) => factory(index));
}

function ordersSearchValidationResult(requestBody) {
  const operation = square.SQUARE_READ_ONLY_POST_OPERATIONS.find(
    (candidate) =>
      candidate.providerEnvironment === "sandbox" &&
      candidate.path === "/v2/orders/search"
  );
  if (!operation) throw new Error("orders search operation fixture missing");
  const validator =
    square.SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS[
      operationPolicy.providerReadOnlyPostValidatorRegistryKey(operation)
    ];
  if (!validator) throw new Error("orders search validator fixture missing");
  return validator({
    operation,
    queryParameters: [],
    body: requestBody,
    rawBodyByteLength: Buffer.byteLength(JSON.stringify(requestBody), "utf8")
  });
}

function assertSafeDiagnostic(value, message) {
  const serialized = JSON.stringify(value);
  doesNotMatch(serialized, sensitivePattern, message);
  doesNotMatch(
    serialized,
    /access[-_ ]?token|refresh[-_ ]?token|authorization[-_ ]?code|client[-_ ]?secret|bearer/i,
    `${message}: token vocabulary is redacted`
  );
}

function captureDeniedSquare(overrides) {
  try {
    square.assertSquareReadOperation(squareRequest(overrides));
  } catch (error) {
    assertionCount += 1;
    matches(error.message, /square_read_operation_denied/, "Square denial is generic");
    return { name: error.name, message: error.message };
  }
  assertionCount += 1;
  assert.fail("expected Square read operation denial");
}

function qboQueryDecision() {
  return qbo.assertQboReadOnlyOperation({
    method: "GET",
    path: "/v3/company/12345/query",
    queryText: "select * from Invoice"
  });
}

function testDescriptorAndScopes() {
  const descriptor = contract.ProviderDescriptorSchema.parse(
    square.SQUARE_PROVIDER_DESCRIPTOR
  );
  equal(descriptor.providerKey, "square", "Square descriptor uses the Square provider key");
  equal(descriptor.displayName, "Square", "Square descriptor display name is stable");
  equal(
    descriptor.adapterVersion,
    "square_phase_2a_dormant_provider_contract_v1",
    "Square descriptor is marked as Phase 2A dormant"
  );
  equal(
    descriptor.authorizationMode,
    "oauth2_confidential",
    "Square descriptor preserves the intended confidential OAuth mode"
  );
  equal(descriptor.accessMode, "read_only", "Square descriptor is read-only");
  deepEqual(
    descriptor.readMethodAllowlist,
    ["GET"],
    "Square descriptor preserves GET as the broad default"
  );
  deepEqual(
    descriptor.minimumScopes,
    EXPECTED_SQUARE_READ_SCOPES,
    "Square descriptor exposes the exact MVP read scope inventory"
  );
  deepEqual(descriptor.optionalScopes, [], "Square descriptor has no optional Phase 2A scopes");
  deepEqual(
    descriptor.hostnameAllowlist,
    ["connect.squareup.com", "connect.squareupsandbox.com"],
    "Square descriptor binds exact Production and Sandbox hosts"
  );
  ok(
    descriptor.officialDocumentationLinks.length > 20,
    "Square descriptor records the official documentation evidence set"
  );
  for (const link of descriptor.officialDocumentationLinks) {
    matches(
      link,
      /^https:\/\/developer\.squareup\.com\//,
      "Square references are official developer.squareup.com URLs"
    );
  }
  ok(
    descriptor.officialDocumentationLinks.includes(
      "https://developer.squareup.com/docs/changelog/connect-logs/2026-08-19"
    ),
    "Square descriptor records the verified 2026-08-19 release note"
  );
  equal(
    square.SQUARE_API_VERSION,
    "2026-08-19",
    "Square-Version is pinned to the verified current version"
  );
  equal(
    descriptor.webhookMode,
    "none",
    "Square Phase 2A does not introduce webhook behavior"
  );
  equal(
    descriptor.incrementalMode,
    "cursor",
    "Square Phase 2A records cursor-based readiness only"
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
    "Square descriptor does not register OAuth"
  );
  ok(
    descriptor.unsupportedCapabilities.includes("response_domain_minimizers"),
    "Square response minimizers are deferred to Phase 2B"
  );
  ok(
    descriptor.unsupportedCapabilities.includes("model_calls"),
    "Square descriptor explicitly excludes model calls"
  );
  equal(square.SQUARE_MODEL_CALL_COUNT, 0, "Square Phase 2A has zero model calls");

  const squareDescriptorRegistry =
    controlPlane.createProviderDescriptorRegistry([descriptor]);
  const squareDescriptorFingerprint =
    squareDescriptorRegistry.descriptors[0].descriptorFingerprint;
  matches(
    squareDescriptorFingerprint,
    /^sha256:[0-9a-f]{64}$/,
    "Square descriptor fingerprint is deterministic and canonical"
  );
  equal(
    squareDescriptorFingerprint,
    EXPECTED_SQUARE_DESCRIPTOR_FINGERPRINT,
    "Square descriptor fingerprint remains unchanged"
  );
  equal(
    controlPlane.createProviderDescriptorRegistry([descriptor]).descriptors[0]
      .descriptorFingerprint,
    squareDescriptorFingerprint,
    "Square descriptor fingerprint repeats exactly"
  );

  const operations = descriptor.readOnlyPostOperations ?? [];
  equal(operations.length, 12, "Square descriptor declares six POST reads per environment");
  for (const environment of ["production", "sandbox"]) {
    const expectedHost =
      environment === "production"
        ? "connect.squareup.com"
        : "connect.squareupsandbox.com";
    const environmentOperations = operations.filter(
      (operation) => operation.providerEnvironment === environment
    );
    deepEqual(
      environmentOperations.map((operation) => operation.path).sort(),
      [...EXPECTED_POST_PATHS].sort(),
      `Square ${environment} POST inventory is exact`
    );
    for (const operation of environmentOperations) {
      const expectedBinding = EXPECTED_POST_BINDINGS[operation.path];
      ok(expectedBinding, "Square POST path has an exact expected binding");
      equal(operation.providerKey, "square", "Square POST operation binds provider");
      equal(operation.hostname, expectedHost, "Square POST operation binds environment host");
      equal(operation.method, "POST", "Square POST operation is method exact");
      equal(
        operation.contentType,
        "application/json",
        "Square POST operation requires JSON content type"
      );
      matches(
        operation.requestValidatorKey,
        /^square_(orders|catalog|inventory)_[a-z_]+_request_v1$/,
        "Square POST operation binds a provider-owned validator key"
      );
      equal(
        operation.requestValidatorKey,
        expectedBinding.requestValidatorKey,
        "Square POST validator binding is unchanged"
      );
      equal(
        operation.maximumRequestBodyBytes,
        expectedBinding.maximumRequestBodyBytes,
        "Square POST request-body limit is unchanged"
      );
      equal(
        operation.maximumResponseBytes,
        64 * 1024 * 1024,
        "Square POST response-body limit is unchanged"
      );
      equal(operation.timeoutMs, 30000, "Square POST operation has a static timeout");
      equal(
        operation.retryClassification,
        "idempotent_read_with_backoff",
        "Square POST operation retry class is static"
      );
    }
  }
  equal(
    Object.keys(square.SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS).length,
    12,
    "Square registers one validator binding for every declared POST operation"
  );

  deepEqual(
    square.normalizeSquareOAuthScopes([
      "PAYMENTS_READ",
      "MERCHANT_PROFILE_READ",
      "ORDERS_READ",
      "INVENTORY_READ",
      "ITEMS_READ"
    ]),
    [...EXPECTED_SQUARE_READ_SCOPES].sort(),
    "Square scopes normalize to the exact five read scopes"
  );
  for (const badScopes of [
    ["MERCHANT_PROFILE_READ", "ITEMS_READ", "INVENTORY_READ", "ORDERS_READ"],
    [...EXPECTED_SQUARE_READ_SCOPES, "PAYMENTS_WRITE"],
    [...EXPECTED_SQUARE_READ_SCOPES, "CUSTOMERS_READ"],
    [...EXPECTED_SQUARE_READ_SCOPES, "ORDERS_WRITE"],
    [...EXPECTED_SQUARE_READ_SCOPES, "NOT_A_SCOPE"],
    [
      "MERCHANT_PROFILE_READ",
      "ITEMS_READ",
      "INVENTORY_READ",
      "ORDERS_READ",
      "ORDERS_READ"
    ]
  ]) {
    throws(
      () => square.normalizeSquareOAuthScopes(badScopes),
      /square_read_operation_denied/,
      "Square scopes reject missing, duplicate, write, deferred, or unknown scopes"
    );
  }
}

function testQboAndRegistryDormancy() {
  deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "QBO remains GET-only");
  ok(
    !Object.prototype.hasOwnProperty.call(
      qbo.QBO_PROVIDER_DESCRIPTOR,
      "readOnlyPostOperations"
    ),
    "QBO descriptor does not gain read-only POST operations"
  );
  doesNotThrow(qboQueryDecision, "existing permitted QBO GET query remains allowed");
  throws(
    () =>
      qbo.assertQboReadOnlyOperation({
        method: "POST",
        path: "/v3/company/12345/query"
      }),
    /qbo_read_only_violation:method/,
    "QBO adapter still rejects POST"
  );

  const phase7Registry = controlPlane.assertProviderDescriptorRegistry(
    qbo.QBO_PHASE_7_PROVIDER_REGISTRY
  );
  const qboDescriptorEntry = phase7Registry.descriptors.find(
    (entry) => entry.descriptor.providerKey === "quickbooks_online"
  );
  ok(qboDescriptorEntry, "QBO descriptor remains in the provider registry");
  equal(
    qboDescriptorEntry.descriptorFingerprint,
    EXPECTED_QBO_DESCRIPTOR_FINGERPRINT,
    "QBO descriptor fingerprint is unchanged"
  );
  equal(
    phase7Registry.registryFingerprint,
    EXPECTED_QBO_REGISTRY_FINGERPRINT,
    "QBO provider registry fingerprint is unchanged"
  );
  equal(
    registeredProviders.REGISTERED_PROVIDER_REGISTRY.registryFingerprint,
    EXPECTED_QBO_REGISTRY_FINGERPRINT,
    "active registered provider registry remains QBO-only"
  );
  throws(
    () =>
      controlPlane.providerDescriptor(
        "square",
        "sandbox",
        registeredProviders.REGISTERED_PROVIDER_REGISTRY
      ),
    /provider_descriptor_not_registered/,
    "Square descriptor is not reachable through the active provider registry"
  );

  const qboOnlyOAuthRegistry = credentials.createProviderOAuthPolicyRegistry([
    qboOAuth.QBO_PHASE_8B_OAUTH_POLICY,
    qboOAuth.QBO_PRODUCTION_OAUTH_POLICY
  ]);
  equal(
    qboOAuth.qboProviderOAuthPolicy("sandbox").providerKey,
    "quickbooks_online",
    "QBO OAuth lookup still works"
  );
  throws(
    () => credentials.providerOAuthPolicy(qboOnlyOAuthRegistry, "square", "sandbox"),
    /provider_oauth_policy_not_registered/,
    "Square OAuth policy lookup fails closed"
  );

  const registeredSource = read(
    "lib/integrations/control-plane/registered-provider-registry.ts"
  );
  doesNotMatch(
    registeredSource,
    /square/i,
    "active registered provider registry source does not mention Square"
  );
  const squareSourceFiles = [
    "lib/integrations/providers/square/contracts.ts",
    "lib/integrations/providers/square/descriptor.ts",
    "lib/integrations/providers/square/request-validators.ts",
    "lib/integrations/providers/square/index.ts"
  ].map(read);
  for (const source of squareSourceFiles) {
    doesNotMatch(
      source,
      /\bfetch\s*\(|axios|node:https|node:http|@supabase|supabase-js|process\.env|openai|generateText|streamText/i,
      "Square Phase 2A source has no network, database, environment, or model call path"
    );
  }
}

function testGenericPostPolicyDefault() {
  throws(
    () =>
      contract.ProviderDescriptorSchema.parse({
        ...controlPlane.SYNTHETIC_PROVIDER_DESCRIPTOR,
        readMethodAllowlist: ["POST"]
      }),
    Error,
    "POST remains denied by the broad descriptor method allowlist"
  );
  throws(
    () =>
      operationPolicy.assertDeclaredReadOnlyPostOperation({
        descriptor: controlPlane.SYNTHETIC_PROVIDER_DESCRIPTOR,
        providerKey: "synthetic",
        providerEnvironment: "test",
        method: "POST",
        url: "https://api.synthetic.example/v1/search",
        contentType: "application/json",
        body: "{}",
        validators: {}
      }),
    /provider_read_only_post_operation_denied/,
    "generic POST policy denies descriptors without exact operation declarations"
  );
  throws(
    () =>
      operationPolicy.assertDeclaredReadOnlyPostOperation({
        descriptor: square.SQUARE_PROVIDER_DESCRIPTOR,
        providerKey: "square",
        providerEnvironment: "sandbox",
        method: "POST",
        url: "https://connect.squareupsandbox.com/v2/payments",
        contentType: "application/json",
        body: "{}",
        validators: square.SQUARE_READ_ONLY_POST_REQUEST_VALIDATORS,
        retryAttempt: {
          attempt: 3,
          priorRetryClassification: "idempotent_read_with_backoff"
        }
      }),
    /provider_read_only_post_operation_denied/,
    "retry metadata cannot authorize an undeclared Square POST"
  );
}

function testGetAuthorization() {
  const locations = square.assertSquareReadOperation(
    getSquareRequest("https://connect.squareupsandbox.com/v2/locations")
  );
  equal(locations.operationKey, "list_locations", "Square locations GET is allowed");
  equal(locations.method, "GET", "Square locations operation is GET");
  equal(locations.contentType, null, "Square GET does not require a body content type");
  matches(
    locations.requestFingerprint,
    /^sha256:[0-9a-f]{64}$/,
    "Square GET request fingerprint is deterministic"
  );

  const production = square.assertSquareReadOperation(
    getSquareRequest("https://connect.squareup.com/v2/locations", {
      providerEnvironment: "production"
    })
  );
  equal(production.hostname, "connect.squareup.com", "Square Production GET binds the Production host");

  const catalog = square.assertSquareReadOperation(
    getSquareRequest(
      "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM,ITEM_VARIATION,CATEGORY"
    )
  );
  const catalogCursor = square.assertSquareReadOperation(
    getSquareRequest(
      "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM,ITEM_VARIATION,CATEGORY&cursor=phase2a-cursor-canary",
      { expectedCursorBindingFingerprint: catalog.cursorBindingFingerprint }
    )
  );
  equal(
    catalogCursor.cursorBindingFingerprint,
    catalog.cursorBindingFingerprint,
    "Square GET cursor stays bound to the original query shape"
  );
  deniedGet(
    "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM&cursor=phase2a-cursor-canary",
    "Square GET cursor rejects changed original query binding",
    { expectedCursorBindingFingerprint: catalog.cursorBindingFingerprint }
  );
  deniedGet(
    "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM&cursor=phase2a-cursor-canary",
    "Square GET cursor requires the expected binding fingerprint"
  );

  const payments = square.assertSquareReadOperation(
    getSquareRequest(
      "https://connect.squareupsandbox.com/v2/payments?limit=100&sort_order=DESC&updated_at_begin_time=2026-09-01T00:00:00.000Z&updated_at_end_time=2026-09-02T00:00:00.000Z&location_id=LOC_PHASE2A"
    )
  );
  equal(payments.operationKey, "list_payments", "Square payments GET query is allowed");
  const paymentCursor = square.assertSquareReadOperation(
    getSquareRequest(
      "https://connect.squareupsandbox.com/v2/payments?limit=100&sort_order=DESC&updated_at_begin_time=2026-09-01T00:00:00.000Z&updated_at_end_time=2026-09-02T00:00:00.000Z&location_id=LOC_PHASE2A&cursor=phase2a-cursor-canary",
      { expectedCursorBindingFingerprint: payments.cursorBindingFingerprint }
    )
  );
  equal(
    paymentCursor.cursorBindingFingerprint,
    payments.cursorBindingFingerprint,
    "Square payments GET cursor stays bound to the first-page query shape"
  );

  for (const [url, message] of [
    [
      "https://connect.squareupsandbox.com/v2/payments?last_4=1111",
      "card last-4 query is deferred"
    ],
    [
      "https://connect.squareupsandbox.com/v2/payments?card_brand=VISA",
      "card brand query is deferred"
    ],
    [
      "https://connect.squareupsandbox.com/v2/payments?limit=101",
      "payment limit is capped by docs"
    ],
    [
      "https://connect.squareupsandbox.com/v2/payments?updated_at_begin_time=not-a-date",
      "timestamps fail closed"
    ],
    [
      "https://connect.squareupsandbox.com/v2/payments?cursor=one&cursor=two",
      "duplicate query keys fail closed"
    ],
    [
      "https://connect.squareupsandbox.com/v2/payments?location_id=LOC%5FENCODED",
      "encoded query bypasses fail closed"
    ],
    [
      "https://connect.squareupsandbox.com/v2/catalog/list",
      "catalog list requires explicit types"
    ],
    [
      "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM,IMAGE",
      "catalog list rejects deferred object types"
    ],
    [
      "https://connect.squareupsandbox.com/v2/orders/batch-retrieve",
      "order batch-retrieve cannot be treated as an order ID"
    ],
    [
      "https://connect.squareupsandbox.com/v2/inventory/counts",
      "inventory counts family cannot be treated as a catalog object ID"
    ]
  ]) {
    deniedGet(url, message);
  }

  deniedGet(
    "https://connect.squareupsandbox.com/v2/locations",
    "Square-Version is required",
    { headers: {} }
  );
  deniedGet(
    "https://connect.squareupsandbox.com/v2/locations",
    "Square-Version mismatch fails closed",
    { headers: { "Square-Version": "2026-07-15" } }
  );

  for (const [url, message] of [
    ["http://connect.squareupsandbox.com/v2/locations", "non-HTTPS URL fails closed"],
    ["https://connect.squareupsandbox.com:443/v2/locations", "explicit ports fail closed"],
    [
      "https://token@connect.squareupsandbox.com/v2/locations",
      "credentials in URLs fail closed"
    ],
    ["https://connect.squareupsandbox.com./v2/locations", "trailing-dot hosts fail closed"],
    ["https://connect%2esquareupsandbox.com/v2/locations", "encoded hosts fail closed"],
    ["https://connect.squareupsandbox.com/v2/locations#frag", "fragments fail closed"],
    ["https://connect.squareupsandbox.com/v2/%6cocations", "encoded paths fail closed"],
    ["https://connect.squareupsandbox.com/v2//locations", "duplicate slashes fail closed"],
    ["https://connect.squareupsandbox.com/v2/../locations", "dot segments fail closed"],
    ["https://connect.squareupsandbox.com/v2\\locations", "backslashes fail closed"],
    ["https://connect.squareup.com/v2/locations", "environment and host mismatch fails closed"]
  ]) {
    deniedGet(url, message);
  }
}

function testOrdersSearchFullResponseGuard() {
  const omittedBody = JSON.parse(squareRequest().body);
  const explicitFalseBody = { ...omittedBody, return_entries: false };
  const omittedValidation = ordersSearchValidationResult(omittedBody);
  const explicitFalseValidation = ordersSearchValidationResult(explicitFalseBody);

  deepEqual(
    explicitFalseValidation.normalizedBody,
    omittedValidation.normalizedBody,
    "omitted and explicit-false Orders Search bodies normalize identically"
  );
  ok(
    Object.prototype.hasOwnProperty.call(
      omittedValidation.normalizedBody,
      "return_entries"
    ),
    "Orders Search normalization emits the full-order selector explicitly"
  );
  equal(
    omittedValidation.normalizedBody.return_entries,
    false,
    "omitted return_entries normalizes to false"
  );
  equal(
    explicitFalseValidation.normalizedBody.return_entries,
    false,
    "explicit-false return_entries remains false"
  );
  ok(
    Object.isFrozen(omittedValidation.normalizedBody),
    "the normalized Orders Search body is frozen"
  );
  ok(
    Object.isFrozen(explicitFalseValidation.normalizedBody),
    "the explicit-false normalized Orders Search body is frozen"
  );

  const omittedDecision = allowedSquare(
    { body: body(omittedBody) },
    "omitted return_entries is accepted"
  );
  const explicitFalseDecision = allowedSquare(
    { body: body(explicitFalseBody) },
    "explicit-false return_entries is accepted"
  );
  equal(
    explicitFalseDecision.requestFingerprint,
    omittedDecision.requestFingerprint,
    "omitted and explicit-false Orders Search requests fingerprint identically"
  );
  equal(
    omittedDecision.requestFingerprint,
    EXPECTED_ORDERS_SEARCH_REQUEST_FINGERPRINT,
    "the canonical full-response Orders Search request fingerprint is pinned"
  );
  equal(
    explicitFalseDecision.cursorBindingFingerprint,
    omittedDecision.cursorBindingFingerprint,
    "omitted and explicit-false Orders Search cursor bindings are identical"
  );
  equal(
    omittedDecision.cursorBindingFingerprint,
    EXPECTED_ORDERS_SEARCH_CURSOR_BINDING_FINGERPRINT,
    "the enforced-false Orders Search cursor binding is pinned"
  );

  const mutableInput = { ...explicitFalseBody };
  const immutableValidation = ordersSearchValidationResult(mutableInput);
  mutableInput.return_entries = true;
  equal(
    immutableValidation.normalizedBody.return_entries,
    false,
    "caller mutation cannot override the normalized full-order selector"
  );
  equal(
    Reflect.set(immutableValidation.normalizedBody, "return_entries", true),
    false,
    "normalized body mutation cannot set return_entries to true"
  );
  equal(
    immutableValidation.normalizedBody.return_entries,
    false,
    "the normalized full-order selector remains false after mutation attempts"
  );

  deniedSquare(
    { body: body({ ...omittedBody, return_entries: true }) },
    "explicit-true return_entries fails closed"
  );
  for (const malformed of [
    null,
    "false",
    "true",
    "",
    0,
    1,
    -1,
    [],
    [false],
    {},
    { value: false }
  ]) {
    deniedSquare(
      { body: body({ ...omittedBody, return_entries: malformed }) },
      "malformed return_entries representations fail closed"
    );
  }

  const cursorBody = {
    ...omittedBody,
    cursor: "phase2a-cursor-canary"
  };
  const cursorOmitted = allowedSquare(
    {
      body: body(cursorBody),
      expectedCursorBindingFingerprint: omittedDecision.cursorBindingFingerprint
    },
    "cursor continuation accepts an omitted return_entries selector"
  );
  const cursorFalse = allowedSquare(
    {
      body: body({ ...cursorBody, return_entries: false }),
      expectedCursorBindingFingerprint: omittedDecision.cursorBindingFingerprint
    },
    "cursor continuation accepts an explicit-false return_entries selector"
  );
  equal(
    cursorOmitted.cursorBindingFingerprint,
    omittedDecision.cursorBindingFingerprint,
    "cursor continuation retains the enforced-false binding"
  );
  equal(
    cursorFalse.cursorBindingFingerprint,
    omittedDecision.cursorBindingFingerprint,
    "explicit-false cursor continuation retains the original binding"
  );
  equal(
    cursorFalse.requestFingerprint,
    cursorOmitted.requestFingerprint,
    "cursor omission and explicit false fingerprint identically"
  );
  equal(
    ordersSearchValidationResult(cursorBody).normalizedBody.return_entries,
    false,
    "cursor normalization emits only the full-order selector"
  );
  deniedSquare(
    {
      body: body({ ...cursorBody, return_entries: true }),
      expectedCursorBindingFingerprint: omittedDecision.cursorBindingFingerprint
    },
    "cursor continuation cannot introduce return_entries true"
  );
  deniedSquare(
    { body: body({ ...omittedBody, unexpected_selector: false }) },
    "Orders Search unknown fields remain denied"
  );
}

function testPostAuthorizationAndValidators() {
  const operations = [
    {
      path: "/v2/orders/search",
      key: "sandbox_orders_search",
      validator: "square_orders_search_request_v1",
      body: {
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
        limit: 100
      }
    },
    {
      path: "/v2/orders/batch-retrieve",
      key: "sandbox_orders_batch_retrieve",
      validator: "square_orders_batch_retrieve_request_v1",
      body: { order_ids: ["ORD_PHASE2A"], location_id: "LOC_PHASE2A" }
    },
    {
      path: "/v2/catalog/search",
      key: "sandbox_catalog_search",
      validator: "square_catalog_search_request_v1",
      body: { object_types: ["ITEM"], limit: 100 }
    },
    {
      path: "/v2/catalog/batch-retrieve",
      key: "sandbox_catalog_batch_retrieve",
      validator: "square_catalog_batch_retrieve_request_v1",
      body: { object_ids: ["ITEM_PHASE2A"], include_related_objects: true }
    },
    {
      path: "/v2/inventory/counts/batch-retrieve",
      key: "sandbox_inventory_counts_batch_retrieve",
      validator: "square_inventory_counts_batch_retrieve_request_v1",
      body: { location_ids: ["LOC_PHASE2A"], states: ["IN_STOCK"], limit: 100 }
    },
    {
      path: "/v2/inventory/changes/batch-retrieve",
      key: "sandbox_inventory_changes_batch_retrieve",
      validator: "square_inventory_changes_batch_retrieve_request_v1",
      body: {
        catalog_object_ids: ["ITEMVAR_PHASE2A"],
        types: ["ADJUSTMENT"],
        updated_after: "2026-09-01T00:00:00.000Z",
        sort: { field: "OCCURRED_AT", order: "ASC" },
        limit: 100
      }
    }
  ];

  for (const operation of operations) {
    const decision = allowedSquare(
      {
        url: `https://connect.squareupsandbox.com${operation.path}`,
        body: body(operation.body)
      },
      `${operation.path} is authorized only as a declared read-only POST`
    );
    equal(decision.operationKey, operation.key, "Square POST operation key is exact");
    equal(decision.providerKey, "square", "Square POST decision provider is unchanged");
    equal(
      decision.providerEnvironment,
      "sandbox",
      "Square POST decision environment is unchanged"
    );
    equal(decision.requestValidatorKey, operation.validator, "Square POST validator key is exact");
    equal(decision.method, "POST", "Square POST method is exact");
    equal(decision.hostname, "connect.squareupsandbox.com", "Square POST host is exact");
    equal(decision.pathTemplate, operation.path, "Square POST path binding is exact");
    equal(decision.contentType, "application/json", "Square POST content type is exact");
    equal(
      decision.maximumResponseBytes,
      64 * 1024 * 1024,
      "Square POST response limit is unchanged"
    );
    equal(decision.timeoutMs, 30000, "Square POST timeout is unchanged");
    equal(
      decision.retryClassification,
      "idempotent_read_with_backoff",
      "Square POST retry binding is unchanged"
    );
    equal(
      decision.squareVersion,
      "2026-08-19",
      "Square POST decision pins the verified Square-Version"
    );
    equal(
      decision.providerReadOnlyPostPolicyVersion,
      "provider_read_only_post_operation_policy_v1",
      "Square POST decision passes through Phase 1A policy"
    );
    matches(
      decision.requestFingerprint,
      /^sha256:[0-9a-f]{64}$/,
      "Square POST request fingerprint is deterministic"
    );
    if (operation.path !== "/v2/orders/search") {
      equal(
        decision.requestFingerprint,
        EXPECTED_UNCHANGED_POST_REQUEST_FINGERPRINTS[operation.path],
        "non-Orders-Search POST request fingerprint is unchanged"
      );
    }
  }

  const firstPage = square.assertSquareReadOperation(squareRequest());
  const cursorBody = {
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
    cursor: "phase2a-cursor-canary"
  };
  const secondPage = square.assertSquareReadOperation(
    squareRequest({
      body: body(cursorBody),
      expectedCursorBindingFingerprint: firstPage.cursorBindingFingerprint
    })
  );
  equal(
    secondPage.cursorBindingFingerprint,
    firstPage.cursorBindingFingerprint,
    "Square POST cursor stays bound to the first-page body shape"
  );
  deniedSquare(
    {
      body: body({ ...cursorBody, limit: 101 }),
      expectedCursorBindingFingerprint: firstPage.cursorBindingFingerprint
    },
    "Square POST cursor rejects changed body binding"
  );
  deniedSquare(
    { body: body(cursorBody) },
    "Square POST cursor requires an expected binding fingerprint"
  );

  for (const [overrides, message] of [
    [{ url: "https://connect.squareupsandbox.com/v2/payments" }, "undeclared POST fails closed"],
    [{ url: "https://connect.squareupsandbox.com/v2/refunds" }, "write-like refund POST fails closed"],
    [
      {
        method: "PUT",
        url: "https://connect.squareupsandbox.com/v2/orders/search"
      },
      "PUT write method fails closed"
    ],
    [
      {
        method: "DELETE",
        url: "https://connect.squareupsandbox.com/v2/catalog/search"
      },
      "DELETE write method fails closed"
    ],
    [
      {
        method: "GET",
        url: "https://connect.squareupsandbox.com/v2/orders/search",
        body: null
      },
      "GET cannot borrow a declared POST operation"
    ],
    [
      { headers: { "Square-Version": square.SQUARE_API_VERSION } },
      "POST content type is required"
    ],
    [
      {
        headers: {
          "Square-Version": square.SQUARE_API_VERSION,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      },
      "form content types fail closed"
    ],
    [
      {
        headers: {
          "Square-Version": square.SQUARE_API_VERSION,
          "Content-Type": "multipart/form-data; boundary=x"
        }
      },
      "multipart content types fail closed"
    ],
    [
      {
        headers: {
          "Square-Version": square.SQUARE_API_VERSION,
          "Content-Type": "application/json; charset=utf-16"
        }
      },
      "unexpected charsets fail closed"
    ],
    [{ body: "{not-json" }, "malformed JSON fails closed"],
    [{ body: "[]" }, "array bodies fail closed"],
    [{ body: body({ location_ids: ["LOC_PHASE2A"], unknown: true }) }, "unknown fields fail closed"],
    [
      { body: body({ location_ids: ["LOC_PHASE2A"], idempotency_key: "key" }) },
      "write-shaped idempotency keys fail closed"
    ],
    [
      { body: body({ location_ids: ["LOC_PHASE2A"], provider: "quickbooks_online" }) },
      "body cannot override provider"
    ],
    [
      { body: body({ location_ids: ["LOC_PHASE2A"], hostname: "connect.squareup.com" }) },
      "body cannot override hostname"
    ],
    [
      { body: body({ location_ids: ["LOC_PHASE2A"], amount_money: { amount: 1, currency: "USD" } }) },
      "write-shaped amount payloads fail closed"
    ],
    [
      { body: body({ location_ids: ["LOC_PHASE2A"], customer_id: "CUS_PHASE2A" }) },
      "deferred customer identifiers fail closed"
    ],
    [
      { body: body({ location_ids: repeatedBodies(11, (index) => `LOC_${index}`) }) },
      "orders search location_ids limit is enforced"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/orders/batch-retrieve",
        body: body({ order_ids: repeatedBodies(101, (index) => `ORD_${index}`) })
      },
      "orders batch-retrieve order_ids limit is enforced"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/catalog/search",
        body: body({
          object_types: ["ITEM"],
          include_deleted_objects: true,
          include_category_path_to_root: true
        })
      },
      "catalog contradictory include flags fail closed"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/catalog/search",
        body: body({ object_types: ["IMAGE"] })
      },
      "catalog search rejects deferred object types"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/inventory/changes/batch-retrieve",
        body: body({ types: ["TRANSFER"] })
      },
      "retired inventory transfer type fails closed"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/inventory/changes/batch-retrieve",
        body: body({ sort: {} })
      },
      "empty inventory sort fails closed"
    ],
    [
      {
        url: "https://connect.squareupsandbox.com/v2/inventory/counts/batch-retrieve",
        body: body({})
      },
      "inventory count request requires at least one bounded selector"
    ],
    [
      {
        body: `${body({
          location_ids: ["LOC_PHASE2A"]
        })}${" ".repeat(24 * 1024)}`
      },
      "oversized bodies fail closed"
    ],
    [
      {
        retryAttempt: {
          attempt: 3,
          priorRetryClassification: "idempotent_read_with_backoff"
        },
        url: "https://connect.squareupsandbox.com/v2/refunds"
      },
      "retry classification cannot turn denied POST into an executable request"
    ]
  ]) {
    deniedSquare(overrides, message);
  }
}

function testSensitiveValuesAndDeterminism() {
  const decision = square.assertSquareReadOperation(
    squareRequest({
      body: body({
        location_ids: ["phase2a-location-raw-identity"],
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: {
              updated_at: { start_at: "2026-09-01T00:00:00.000Z" }
            }
          },
          sort: { sort_field: "UPDATED_AT", sort_order: "ASC" }
        },
        limit: 100
      })
    })
  );
  const repeat = square.assertSquareReadOperation(
    squareRequest({
      body: body({
        location_ids: ["phase2a-location-raw-identity"],
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: {
              updated_at: { start_at: "2026-09-01T00:00:00.000Z" }
            }
          },
          sort: { sort_field: "UPDATED_AT", sort_order: "ASC" }
        },
        limit: 100
      })
    })
  );
  equal(
    repeat.requestFingerprint,
    decision.requestFingerprint,
    "Square request fingerprints are deterministic"
  );
  assertSafeDiagnostic(decision, "Square success decisions exclude raw identity values");

  const errors = [];
  for (const overrides of [
    { body: body({ location_ids: ["LOC_PHASE2A"], cursor: "phase2a-cursor-canary" }) },
    {
      body: body({
        location_ids: ["LOC_PHASE2A"],
        query: { exact_query: { attribute_name: "name", attribute_value: "phase2a-secret-search-value" } }
      })
    },
    { headers: { Authorization: "Bearer phase2a-access-token-canary" } },
    { body: body({ location_ids: ["LOC_PHASE2A"], access_token: "phase2a-access-token-canary" }) },
    { body: body({ location_ids: ["LOC_PHASE2A"], refresh_token: "phase2a-refresh-token-canary" }) },
    { body: body({ location_ids: ["LOC_PHASE2A"], code: "phase2a-authorization-code-canary" }) },
    { body: body({ location_ids: ["LOC_PHASE2A"], client_secret: "phase2a-client-secret-canary" }) }
  ]) {
    errors.push(captureDeniedSquare(overrides));
  }
  assertSafeDiagnostic(errors, "Square denied diagnostics exclude raw secrets and identifiers");
}

testDescriptorAndScopes();
testQboAndRegistryDormancy();
testGenericPostPolicyDefault();
testGetAuthorization();
testOrdersSearchFullResponseGuard();
testPostAuthorizationAndValidators();
testSensitiveValuesAndDeterminism();

const squareDescriptorFingerprint = controlPlane.createProviderDescriptorRegistry([
  square.SQUARE_PROVIDER_DESCRIPTOR
]).descriptors[0].descriptorFingerprint;

console.log(
  `External integrations Square Phase 2A regressions: ${assertionCount} assertions passed. Square descriptor ${squareDescriptorFingerprint}. QBO descriptor ${EXPECTED_QBO_DESCRIPTOR_FINGERPRINT}. Active registry ${EXPECTED_QBO_REGISTRY_FINGERPRINT}.`
);
