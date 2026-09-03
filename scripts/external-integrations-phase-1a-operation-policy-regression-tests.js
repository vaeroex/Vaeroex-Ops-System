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
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const contract = require("../lib/integrations/contracts/index.ts");
const controlPlane = require("../lib/integrations/control-plane/provider-registry.ts");
const qbo = require("../lib/integrations/providers/qbo/index.ts");
const operationPolicy = require("../lib/integrations/provider-runtime/read-only-operation-policy.ts");

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

function failRequest() {
  throw new Error("synthetic_request_invalid");
}

const syntheticReadOnlyPostOperation = {
  operationKey: "synthetic_search",
  providerKey: "synthetic_post",
  providerEnvironment: "test",
  hostname: "api.synthetic.example",
  path: "/v1/source-records/search",
  method: "POST",
  contentType: "application/json",
  maximumRequestBodyBytes: 256,
  requestValidatorKey: "synthetic_search_request_v1",
  maximumResponseBytes: 4096,
  timeoutMs: 30000,
  retryClassification: "idempotent_read_with_backoff"
};

const syntheticPostDescriptor = contract.ProviderDescriptorSchema.parse({
  ...controlPlane.SYNTHETIC_PROVIDER_DESCRIPTOR,
  providerKey: "synthetic_post",
  displayName: "Synthetic Post Provider",
  adapterVersion: "synthetic_post_adapter_v1",
  environments: [
    { key: "test", authorizationEndpointClass: "private" },
    { key: "sandbox", authorizationEndpointClass: "sandbox" }
  ],
  hostnameAllowlist: ["api.synthetic.example"],
  readOnlyPostOperations: [syntheticReadOnlyPostOperation],
  legalCommercialGateVersion: "synthetic_post_gate_v1"
});

function syntheticSearchValidator(input) {
  equal(input.operation.operationKey, "synthetic_search", "validator is bound to the declared operation");
  equal(input.rawBodyByteLength <= input.operation.maximumRequestBodyBytes, true, "validator sees a bounded body");
  const queryPairs = input.queryParameters;
  if (queryPairs.length > 1) failRequest();
  const normalizedQueryParameters = {};
  for (const [key, value] of queryPairs) {
    if (key !== "page" || value !== "next") failRequest();
    normalizedQueryParameters.page = value;
  }
  const body = input.body;
  const allowedBodyKeys = new Set(["cursor", "filter", "limit"]);
  const bodyKeys = Object.keys(body);
  if (bodyKeys.some((key) => !allowedBodyKeys.has(key))) failRequest();
  if (typeof body.limit !== "number" || body.limit < 1 || body.limit > 100) failRequest();
  if (body.cursor !== undefined && (typeof body.cursor !== "string" || !/^cursor_[A-Za-z0-9]+$/.test(body.cursor))) {
    failRequest();
  }
  if (body.filter === null || typeof body.filter !== "object" || Array.isArray(body.filter)) failRequest();
  const filter = body.filter;
  if (Object.keys(filter).length !== 1 || filter.status !== "active") failRequest();
  return {
    normalizedQueryParameters,
    normalizedBody: {
      cursor: body.cursor ?? null,
      filter: { status: filter.status },
      limit: body.limit
    }
  };
}

const validators = {
  [operationPolicy.providerReadOnlyPostValidatorRegistryKey(syntheticReadOnlyPostOperation)]: syntheticSearchValidator
};

const allowedRequest = {
  descriptor: syntheticPostDescriptor,
  providerKey: "synthetic_post",
  providerEnvironment: "test",
  method: "POST",
  url: "https://api.synthetic.example/v1/source-records/search?page=next",
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify({
    filter: { status: "active" },
    cursor: "cursor_01",
    limit: 25
  }),
  validators
};

function denied(overrides, message) {
  throws(
    () => operationPolicy.assertDeclaredReadOnlyPostOperation({ ...allowedRequest, ...overrides }),
    /provider_read_only_post_operation_denied/,
    message
  );
}

deepEqual(qbo.QBO_PROVIDER_DESCRIPTOR.readMethodAllowlist, ["GET"], "QBO descriptor remains GET-only");
ok(
  !Object.prototype.hasOwnProperty.call(qbo.QBO_PROVIDER_DESCRIPTOR, "readOnlyPostOperations"),
  "QBO descriptor does not opt in to read-only POST operations"
);
doesNotThrow(
  () =>
    qbo.assertQboReadOnlyOperation({
      method: "GET",
      path: "/v3/company/12345/query",
      queryText: "select * from Invoice"
    }),
  "existing permitted QBO query GET remains allowed"
);
doesNotThrow(
  () =>
    qbo.assertQboReadOnlyOperation({
      method: "GET",
      path: "/v3/company/12345/reports/ProfitAndLoss",
      queryText: "start_date=2026-01-01&end_date=2026-01-31"
    }),
  "existing permitted QBO report GET remains allowed"
);
throws(
  () => qbo.assertQboReadOnlyOperation({ method: "POST", path: "/v3/company/12345/query" }),
  /qbo_read_only_violation:method/,
  "QBO adapter still rejects POST"
);

const phase7Registry = controlPlane.assertProviderDescriptorRegistry(qbo.QBO_PHASE_7_PROVIDER_REGISTRY);
const qboDescriptorEntry = phase7Registry.descriptors.find((entry) => entry.descriptor.providerKey === "quickbooks_online");
ok(qboDescriptorEntry, "QBO descriptor remains in the provider registry");
equal(
  qboDescriptorEntry.descriptorFingerprint,
  "sha256:1812bfa5fb9903583a672028aeefb40855211b19f2ce423f608c49f86db77b7f",
  "QBO descriptor fingerprint is unchanged"
);
equal(
  phase7Registry.registryFingerprint,
  "sha256:2099f06e90a53e632acbe55ee4d95cfd2f7fac7c2c994bb733ec332f7d09dfad",
  "QBO-inclusive registry fingerprint is unchanged"
);

throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...controlPlane.SYNTHETIC_PROVIDER_DESCRIPTOR,
      readMethodAllowlist: ["POST"]
    }),
  Error,
  "POST remains denied by the broad method allowlist"
);
denied(
  {
    descriptor: controlPlane.SYNTHETIC_PROVIDER_DESCRIPTOR,
    providerKey: "synthetic"
  },
  "POST is denied when a descriptor has no explicit operation declaration"
);

const decision = operationPolicy.assertDeclaredReadOnlyPostOperation(allowedRequest);
equal(decision.readOnly, true, "declared synthetic POST search is authorized as read-only");
equal(decision.providerKey, "synthetic_post", "decision is provider-bound");
equal(decision.providerEnvironment, "test", "decision is environment-bound");
equal(decision.hostname, "api.synthetic.example", "decision is exact-host-bound");
equal(decision.path, "/v1/source-records/search", "decision is exact-path-bound");
equal(decision.method, "POST", "decision is exact-method-bound");
equal(decision.maximumResponseBytes, 4096, "decision carries the declared response ceiling");
equal(decision.timeoutMs, 30000, "decision carries the declared timeout");
equal(decision.retryClassification, "idempotent_read_with_backoff", "decision carries the declared retry class");
equal(decision.redirectPolicy, "manual", "decision requires manual redirect handling");
matches(decision.requestFingerprint, /^sha256:[a-f0-9]{64}$/, "authorized request receives only a fingerprint");
doesNotMatch(
  JSON.stringify(decision),
  /cursor_01|active|page":"next|sk_test_phase1a_secret/i,
  "operation decisions do not expose raw body, query, or credential values"
);

denied({ url: "https://api.synthetic.example/v1/source-records/create?page=next" }, "undeclared POST endpoint fails closed");
denied({ url: "https://api.synthetic.example/v1/source-records/delete?page=next" }, "write-like POST endpoint fails closed");
denied({ method: "GET" }, "declared POST permission does not authorize other methods");
denied({ body: "{\"filter\":" }, "malformed JSON body fails closed");
denied({ body: JSON.stringify([{ filter: { status: "active" }, limit: 25 }]) }, "non-object JSON body fails closed");
denied(
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, customer_secret: "sk_test_phase1a_secret" }) },
  "unknown body fields fail closed"
);
denied(
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, delete: true }) },
  "forbidden write-like body fields fail closed through provider validation"
);
denied(
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, hostname: "evil.synthetic.example" }) },
  "body fields cannot override the approved host"
);
denied(
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, providerEnvironment: "sandbox" }) },
  "body fields cannot override the approved provider environment"
);
denied(
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, padding: "x".repeat(260) }) },
  "oversized request body fails closed before validation"
);
denied({ contentType: "application/x-www-form-urlencoded" }, "unsupported content type fails closed");
denied({ contentType: "application/json; boundary=forbidden" }, "malformed JSON content type parameters fail closed");
denied({ contentType: "application/json;" }, "empty JSON content type parameters fail closed");
denied({ contentType: "application/json; charset=\"utf-8" }, "unbalanced JSON content type parameters fail closed");
denied({ url: "https://evil.synthetic.example/v1/source-records/search?page=next" }, "wrong host fails closed");
denied({ url: "https://api.synthetic.example./v1/source-records/search?page=next" }, "trailing-dot host normalization fails closed");
denied({ url: "https://api%2Esynthetic.example/v1/source-records/search?page=next" }, "encoded host normalization fails closed");
denied({ providerEnvironment: "sandbox" }, "wrong provider environment fails closed");
denied({ providerKey: "synthetic" }, "wrong provider fails closed");
denied({ providerEnvironment: "sk_test_phase1a_secret" }, "malformed provider environment fails closed with a safe error");
denied({ providerKey: "sk_test_phase1a_secret" }, "malformed provider key fails closed with a safe error");
denied({ url: "http://api.synthetic.example/v1/source-records/search?page=next" }, "non-HTTPS URL fails closed");
denied({ url: "https://api.synthetic.example:443/v1/source-records/search?page=next" }, "explicit port path confusion fails closed");
denied({ url: "https://user:pass@api.synthetic.example/v1/source-records/search?page=next" }, "URL credentials fail closed");
denied({ url: "https://api.synthetic.example/v1/source-records/search#fragment" }, "URL fragments fail closed");
denied({ url: "https://api.synthetic.example/v1/source-records/%73earch?page=next" }, "encoded path segment fails closed");
denied({ url: "https://api.synthetic.example/v1/source-records%2Fsearch?page=next" }, "encoded slash bypass fails closed");
denied({ url: "https://api.synthetic.example/v1//source-records/search?page=next" }, "duplicate slash bypass fails closed");
denied({ url: "https://api.synthetic.example/v1/source-records/../source-records/search?page=next" }, "dot segment bypass fails closed");
denied({ url: "https://api.synthetic.example/v1/source-records/search?access_token=sk_test_phase1a_secret" }, "unknown query parameter fails closed");
denied({ url: "https://api.synthetic.example/v1/source-records/search?page=next&page=next" }, "duplicate pagination query fails closed");
denied(
  { body: JSON.stringify({ filter: { status: "active" }, cursor: "../cursor", limit: 25 }) },
  "malformed pagination cursor fails closed"
);
denied(
  {
    url: "https://api.synthetic.example/v1/source-records/delete?page=next",
    retryAttempt: {
      attempt: 2,
      priorRetryClassification: "idempotent_read_with_backoff"
    }
  },
  "retry metadata cannot convert a denied operation into an allowed one"
);
denied(
  {
    validators: {},
    body: JSON.stringify({ filter: { status: "active" }, limit: 25 })
  },
  "missing provider-owned validator fails closed"
);

const deniedMessages = [];
for (const badInput of [
  { body: JSON.stringify({ filter: { status: "active" }, limit: 25, access_token: "sk_test_phase1a_secret" }) },
  { descriptor: { ...syntheticPostDescriptor, client_secret: "sk_test_phase1a_secret" } },
  { url: "https://api.synthetic.example/v1/source-records/search?client_secret=sk_test_phase1a_secret" },
  { url: "https://Bearer:sk_test_phase1a_secret@api.synthetic.example/v1/source-records/search?page=next" }
]) {
  try {
    operationPolicy.assertDeclaredReadOnlyPostOperation({ ...allowedRequest, ...badInput });
  } catch (error) {
    deniedMessages.push(error instanceof Error ? error.message : String(error));
  }
}
const safeAuditOutput = JSON.stringify({ decision, deniedMessages });
doesNotMatch(
  safeAuditOutput,
  /sk_test_phase1a_secret|Bearer|access_token|refresh_token|client_secret|authorization/i,
  "operation decisions, errors, and audit-shaped output do not leak credentials"
);
equal(qbo.QBO_MODEL_CALL_COUNT, 0, "QBO package still reports zero model calls");
doesNotMatch(
  read("lib/integrations/provider-runtime/read-only-operation-policy.ts"),
  /\b(?:openai|chat\.completions|responses\.create|generateText|streamText)\b/i,
  "generic read-only POST policy contains no model-call surface"
);

console.log(`External integration Phase 1A operation-policy regressions: ${assertionCount} assertions passed.`);
