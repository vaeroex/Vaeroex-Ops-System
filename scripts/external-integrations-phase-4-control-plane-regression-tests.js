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

const canonicalControl = require("../lib/integrations/contracts/control-plane.ts");
const control = require("../lib/integrations/control-plane/index.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
function doesNotMatch(value, matcher, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, matcher, message);
}

function id(value) {
  const hex = value.toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
const hash = (value) =>
  `sha256:${require("node:crypto").createHash("sha256").update(value).digest("hex")}`;

const ids = {
  workspace: id(1),
  entity: id(2),
  connection: id(3),
  mapping: id(4),
  freshness: id(5)
};

const registry = control.PHASE_4_PROVIDER_REGISTRY;
equal(registry.registryVersion, "vaeroex_provider_descriptors_v1", "the provider registry version is exact");
ok(registry.registryFingerprint.startsWith("sha256:"), "the registry has a canonical SHA-256 fingerprint");
equal(registry.descriptors.length, 1, "Phase 4 registers only the synthetic provider fixture");
equal(registry.descriptors[0].descriptor.providerKey, "synthetic", "the fixture remains explicitly synthetic");
equal(registry.descriptors[0].descriptor.hostnameAllowlist.length, 0, "the synthetic provider has no network destination");
equal(registry.descriptors[0].descriptor.officialDocumentationLinks.length, 0, "the fixture has no external links");
equal(control.PHASE_4_MODEL_CALL_COUNT, 0, "Phase 4 makes zero model calls");
deepEqual(
  control.safeCapabilitySnapshot(registry.descriptors[0].descriptor),
  {
    operations: ["get_capabilities", "get_source_record", "list_entities", "list_source_records"],
    domains: ["general_ledger"],
    requiredStreamKeys: ["general_ledger"],
    supportsBackfill: true,
    webhookMode: "none",
    incrementalMode: "cursor"
  },
  "the safe capability snapshot is explicit and provider-neutral"
);
throws(
  () => control.assertProviderDescriptorRegistry({ ...registry, registryFingerprint: hash("forged") }),
  /fingerprint_mismatch/,
  "a forged provider registry fails closed"
);
throws(
  () => control.providerDescriptor("synthetic", "production"),
  /environment_not_registered/,
  "an unregistered provider environment fails closed"
);

const statuses = canonicalControl.IntegrationConnectionStatusSchema.options;
const expectedTransitions = {
  pending_authorization: ["authorized_unmapped", "error", "deleting"],
  authorized_unmapped: ["initializing", "reauthorization_required", "disconnecting", "deleting"],
  initializing: ["active", "degraded", "error", "reauthorization_required", "disconnecting", "deleting"],
  active: ["degraded", "reauthorization_required", "disconnecting", "deleting"],
  degraded: ["active", "error", "reauthorization_required", "disconnecting", "deleting"],
  error: ["pending_authorization", "initializing", "disconnected", "deleting"],
  reauthorization_required: ["pending_authorization", "disconnecting", "deleting"],
  disconnecting: ["disconnected", "deleting"],
  disconnected: ["pending_authorization", "deleting"],
  deleting: ["deleted"],
  deleted: []
};
for (const from of statuses) {
  for (const to of statuses) {
    equal(
      canonicalControl.isIntegrationConnectionTransitionAllowed(from, to),
      from === to || expectedTransitions[from].includes(to),
      `the exact canonical lifecycle matrix governs ${from} -> ${to}`
    );
  }
}

function connection(status = "initializing", overrides = {}) {
  return {
    contractVersion: "integration_connection_control_v1",
    connection: {
      contractVersion: "integration_connection_v1",
      id: ids.connection,
      workspaceId: ids.workspace,
      businessEntityId: ids.entity,
      providerKey: "synthetic",
      providerEnvironment: "test",
      providerTenantReferenceFingerprint:
        status === "pending_authorization" ? null : hash("tenant"),
      status,
      requestedScopes: ["read_synthetic_business_data"],
      grantedScopes:
        status === "pending_authorization" ? [] : ["read_synthetic_business_data"],
      configurationVersion: 1,
      createdAt: "2026-08-21T20:00:00.000Z",
      statusChangedAt: "2026-08-21T20:05:00.000Z"
    },
    safeDisplayName: "Synthetic Company",
    providerDescriptorRegistryVersion: registry.registryVersion,
    providerDescriptorRegistryFingerprint: registry.registryFingerprint,
    providerDescriptorFingerprint: registry.descriptors[0].descriptorFingerprint,
    adapterVersion: "synthetic_control_plane_adapter_v1",
    capabilitySnapshot: control.safeCapabilitySnapshot(registry.descriptors[0].descriptor),
    connectionSeriesId: ids.connection,
    connectionGeneration: 1,
    replacesConnectionId: null,
    stateReasonCode:
      status === "active" ? "healthy" :
      status === "disconnected" ? "disconnected" :
      status === "deleted" ? "deleted" :
      status === "deleting" ? "deletion_requested" :
      status === "pending_authorization" ? "authorization_pending" :
      status === "authorized_unmapped" ? "mapping_required" :
      status === "degraded" ? "freshness_warning" :
      status === "error" ? "control_plane_error" :
      status === "reauthorization_required" ? "authorization_required" :
      status === "disconnecting" ? "customer_disconnect_requested" :
      "initial_sync_pending",
    authorizedAt: status === "pending_authorization" ? null : "2026-08-21T20:01:00.000Z",
    disconnectedAt: status === "disconnected" ? "2026-08-21T20:05:00.000Z" : null,
    deletedAt: status === "deleted" ? "2026-08-21T20:05:00.000Z" : null,
    rowVersion: 3,
    ...overrides
  };
}

equal(
  control.assertConnectionLifecycleTransition({
    current: connection("initializing"),
    targetStatus: "active",
    targetReasonCode: "healthy",
    expectedRowVersion: 3,
    expectedGeneration: 1,
    requestId: "activate_1",
    lastTransitionRequestId: null,
    activationEvidence: {
      activeVerifiedMapping: true,
      successfulInitialSync: true,
      requiredFreshnessSatisfied: true
    }
  }).idempotent,
  false,
  "a fully gated activation transition succeeds"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("initializing"),
    targetStatus: "active",
    targetReasonCode: "healthy",
    expectedRowVersion: 3,
    expectedGeneration: 1,
    requestId: "activate_2",
    lastTransitionRequestId: null,
    activationEvidence: {
      activeVerifiedMapping: true,
      successfulInitialSync: false,
      requiredFreshnessSatisfied: true
    }
  }),
  /activation_gate_unsatisfied/,
  "active cannot be set without a successful initial sync"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("active"),
    targetStatus: "error",
    targetReasonCode: "control_plane_error",
    expectedRowVersion: 3,
    expectedGeneration: 1,
    requestId: "invalid_1",
    lastTransitionRequestId: null
  }),
  /Invalid integration connection transition/,
  "invalid connection transitions fail closed"
);
equal(
  control.assertConnectionLifecycleTransition({
    current: connection("degraded"),
    targetStatus: "degraded",
    targetReasonCode: "freshness_warning",
    expectedRowVersion: 2,
    expectedGeneration: 999,
    requestId: "replay_1",
    lastTransitionRequestId: "replay_1",
    requestFingerprint: hash("replay_1"),
    lastTransitionRequestFingerprint: hash("replay_1")
  }).idempotent,
  true,
  "the same transition request replays idempotently"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("degraded"),
    targetStatus: "active",
    targetReasonCode: "healthy",
    expectedRowVersion: 2,
    expectedGeneration: 1,
    requestId: "stale_row",
    lastTransitionRequestId: null
  }),
  /row_version_stale/,
  "a stale row version fails closed"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("degraded"),
    targetStatus: "active",
    targetReasonCode: "healthy",
    expectedRowVersion: 3,
    expectedGeneration: 2,
    requestId: "stale_generation",
    lastTransitionRequestId: null
  }),
  /generation_stale/,
  "a stale connection generation fails closed"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("disconnected"),
    targetStatus: "pending_authorization",
    targetReasonCode: "authorization_pending",
    expectedRowVersion: 3,
    expectedGeneration: 1,
    requestId: "in_place_reconnect",
    lastTransitionRequestId: null
  }),
  /replacement_generation_required/,
  "reconnect cannot rewrite an old authorization generation"
);
throws(
  () => control.assertConnectionLifecycleTransition({
    current: connection("deleted"),
    targetStatus: "deleting",
    targetReasonCode: "deletion_requested",
    expectedRowVersion: 3,
    expectedGeneration: 1,
    requestId: "deleted_mutation",
    lastTransitionRequestId: null
  }),
  /deleted_terminal/,
  "deleted connection state is terminal"
);

equal(
  control.assertProviderEntityMappingTransition("pending_verification", "active", {
    hasSyntheticVerification: true
  }).idempotent,
  false,
  "synthetically verified mapping activation succeeds"
);
throws(
  () => control.assertProviderEntityMappingTransition("pending_verification", "active", {
    hasSyntheticVerification: false
  }),
  /verification_required/,
  "an unverified provider entity cannot become active"
);
throws(
  () => control.assertProviderEntityMappingTransition("replaced", "active", {
    hasSyntheticVerification: true
  }),
  /transition_invalid/,
  "a replaced mapping is terminal"
);
equal(
  control.assertIntegrationSyncRunTransition("created", "running").idempotent,
  false,
  "a created synthetic run can start"
);
equal(
  control.assertIntegrationSyncRunTransition("running", "succeeded").idempotent,
  false,
  "a running synthetic run can succeed"
);
throws(
  () => control.assertIntegrationSyncRunTransition("succeeded", "running"),
  /transition_invalid/,
  "a terminal sync run cannot restart"
);

function freshness(overrides) {
  return control.deriveIntegrationFreshness({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    connectionId: ids.connection,
    mappingId: ids.mapping,
    domain: "general_ledger",
    scopeKey: "synthetic_company",
    providerWatermarkAt: null,
    lastAttemptAt: "2026-08-21T20:00:00.000Z",
    lastSuccessfulSyncAt: "2026-08-21T20:00:00.000Z",
    lastReconciledAt: "2026-08-21T20:00:00.000Z",
    observedLagSeconds: 120,
    connectionStatus: "initializing",
    latestSyncFailed: false,
    policyVersion: "synthetic_freshness_policy_v1",
    currentMaxAgeSeconds: 3_600,
    staleAfterSeconds: 7_200,
    staleBlockingLevel: "current_intelligence",
    calculatedAt: "2026-08-21T20:30:00.000Z",
    rowVersion: 1,
    ...overrides
  });
}
equal(freshness({}).status, "current", "current freshness uses canonical vocabulary");
equal(freshness({ calculatedAt: "2026-08-21T21:30:00.000Z" }).status, "aging", "aging freshness uses canonical vocabulary");
equal(freshness({ calculatedAt: "2026-08-21T23:00:01.000Z" }).status, "stale", "stale freshness uses canonical vocabulary");
equal(freshness({ latestSyncFailed: true }).status, "sync_error", "sync failure overrides timer freshness");
equal(freshness({ connectionStatus: "reauthorization_required" }).status, "reauthorization_required", "reauthorization overrides freshness");
equal(freshness({ connectionStatus: "disconnected" }).status, "disconnected", "disconnect overrides freshness");
equal(freshness({ lastSuccessfulSyncAt: null }).status, "unknown", "missing success remains unknown");

const safeConnection = control.connectionCustomerSummary(connection("active"));
const safeFreshness = control.freshnessCustomerSummary({
  id: ids.freshness,
  providerKey: "synthetic",
  state: freshness({}),
  stateFingerprint: hash("freshness")
});
const safeJson = JSON.stringify({ safeConnection, safeFreshness });
doesNotMatch(safeJson, /tenantReference|descriptorFingerprint|providerWatermark|mappingId|errorCategory/i, "customer summaries omit private operational identifiers");
doesNotMatch(safeJson, /accessToken|refreshToken|clientSecret|authorizationCode|rawPayload/i, "customer summaries cannot carry secret or payload fields");

const phase4OwnedPaths = [
  "lib/integrations/control-plane/contracts.ts",
  "lib/integrations/control-plane/provider-registry.ts",
  "lib/integrations/control-plane/lifecycle.ts",
  "supabase/migrations/20260821201220_external_integrations_phase_4_control_plane.sql"
];
const phase4Source = phase4OwnedPaths.map(read).join("\n");
doesNotMatch(phase4Source, /QuickBooks|Intuit|Business Central|NetSuite|SAP|CAKE/i, "Phase 4 remains provider-neutral");
doesNotMatch(phase4Source, /access[_ ]?token|refresh[_ ]?token|client[_ ]?secret|authorization[_ ]?code/i, "Phase 4-owned source has no provider-secret surface");
doesNotMatch(phase4Source, /raw[_ ]?(?:provider[_ ]?)?payload|provider[_ ]?payload/i, "Phase 4-owned source stores no provider payload");
doesNotMatch(phase4Source, /cloud tasks|cloud run|scheduler|webhook route|business_state_delta|openai|embedding|rerank/i, "Phase 4 introduces no runtime, delta, or AI infrastructure");
doesNotMatch(phase4Source, /\bfetch\s*\(|axios|node:https|node:http/i, "Phase 4 makes no provider network calls");
doesNotMatch(
  phase4Source,
  /@\/lib\/integrations\/(?:credentials|persistence|provider-runtime|providers\/qbo|runtime)(?:\/|["'])/,
  "Phase 4-owned source does not import later provider, runtime, credential, or persistence implementations"
);
doesNotMatch(phase4Source, /promotionAuthorized\s*:\s*true/, "Phase 4 cannot authorize KPI promotion");

const phase3Adapter = read("lib/integrations/deterministic/legacy-kpi-shadow-adapter.ts");
ok(/promotionAuthorized:\s*false/.test(phase3Adapter), "Phase 3 promotion remains disabled");

const packageJson = JSON.parse(read("package.json"));
equal(
  packageJson.scripts["test:external-integrations-phase-4"],
  "node scripts/external-integrations-phase-4-control-plane-regression-tests.js",
  "the Phase 4 deterministic regression suite is registered"
);
const ci = read(".github/workflows/ci.yml");
ok(ci.includes("supabase/tests/external_integrations_phase_4_control_plane.test.sql"), "the full Phase 4 database suite is a CI merge gate");

console.log(
  `External integration Phase 4 control-plane regressions: ${assertionCount} assertions passed. Registry ${registry.registryFingerprint}; descriptor ${registry.descriptors[0].descriptorFingerprint}.`
);
