const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const contract = require("../lib/integrations/contracts/index.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
function doesNotThrow(callback, message) {
  assertionCount += 1;
  assert.doesNotThrow(callback, message);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fingerprint(character) {
  return `sha256:${character.repeat(64)}`;
}

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  entity: "22222222-2222-4222-8222-222222222222",
  connection: "33333333-3333-4333-8333-333333333333",
  source: "44444444-4444-4444-8444-444444444444",
  fact: "55555555-5555-4555-8555-555555555555",
  delta: "66666666-6666-4666-8666-666666666666",
  actor: "77777777-7777-4777-8777-777777777777",
  secondConnection: "88888888-8888-4888-8888-888888888888",
  secondSource: "99999999-9999-4999-8999-999999999999",
  secondFact: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  mapping: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  secondMapping: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  changeSet: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
};

const entity = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.businessEntity,
  id: ids.entity,
  workspaceId: ids.workspace,
  parentBusinessEntityId: null,
  entityKey: "north_america_operations",
  displayName: "North America Operations",
  legalName: "Example Operations, Inc.",
  status: "active",
  baseCurrency: "USD",
  timeZone: "America/Los_Angeles",
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z"
};

const connection = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.connection,
  id: ids.connection,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  providerKey: "ledger_demo",
  providerEnvironment: "sandbox",
  providerTenantReferenceFingerprint: fingerprint("a"),
  status: "active",
  requestedScopes: ["ledger.read", "reports.read"],
  grantedScopes: ["ledger.read"],
  configurationVersion: 1,
  createdAt: "2026-08-20T12:00:00.000Z",
  statusChangedAt: "2026-08-20T12:05:00.000Z"
};

const source = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.sourceRecord,
  id: ids.source,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  connectionId: ids.connection,
  immutableVersion: 1,
  priorVersionId: null,
  recordKind: "financial_statement_line",
  source: {
    kind: "provider",
    providerKey: "ledger_demo",
    providerRecordType: "statement_line",
    providerRecordId: "line_100",
    providerVersionReference: "revision_7"
  },
  temporal: {
    basis: "period",
    providerCreatedAt: "2026-08-20T11:55:00.000Z",
    providerUpdatedAt: "2026-08-20T12:05:00.000Z",
    observedAt: "2026-08-20T12:10:00.000Z",
    synchronizedAt: "2026-08-20T12:10:30.000Z",
    ingestedAt: "2026-08-20T12:10:45.000Z",
    effectiveAt: null,
    postingDate: "2026-07-31",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    sourceTimeZone: "America/Los_Angeles"
  },
  accounting: { basis: "accrual", currency: "USD" },
  normalizedSchemaVersion: "financial_statement_line_v1",
  changeKind: "created",
  normalizedProjection: {
    accountClass: "revenue",
    amount: "1234.5",
    sequence: 7,
    dimensions: { department: "operations" }
  },
  trust: "untrusted_external_input",
  validation: { state: "valid", validatorVersion: "source_validator_v1", issues: [] },
  receivedAt: "2026-08-20T12:11:00.000Z"
};

const fact = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact,
  id: ids.fact,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  immutableVersion: 1,
  factKind: "recognized_revenue",
  factKey: "recognized_revenue:2026-07",
  dimensions: [
    { key: "department", value: "Operations" },
    { key: "region", value: "North America" }
  ],
  temporal: {
    effectiveAt: null,
    postingDate: "2026-07-31",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    fiscalYear: 2026,
    fiscalPeriod: 7,
    sourceTimeZone: "America/Los_Angeles",
    closedPeriod: true
  },
  accounting: {
    basis: "accrual",
    sourceCurrency: "USD",
    reportingCurrency: "USD",
    exchangeRate: null,
    exchangeRateSource: null
  },
  value: { kind: "money", amount: "1234.5", currency: "USD" },
  reconciliationState: "accepted",
  validationState: "valid",
  sources: [
    {
      sourceRecordVersionId: ids.source,
      sourceFingerprint: fingerprint("b"),
      sourceRole: "primary",
      contributionWeight: "0.5"
    },
    {
      sourceRecordVersionId: ids.secondSource,
      sourceFingerprint: fingerprint("c"),
      sourceRole: "corroborating",
      contributionWeight: "0.5"
    }
  ],
  decision: {
    authority: "deterministic_policy",
    policyVersion: "reconciliation_policy_v1",
    actorId: null,
    decidedAt: "2026-08-20T12:20:00.000Z",
    reasonCodes: ["cross_source_match", "policy_accept"]
  },
  normalizationVersion: "recognized_revenue_normalization_v1",
  transformationVersion: "recognized_revenue_transformation_v1",
  sourceObservedAt: "2026-08-20T12:10:00.000Z",
  createdAt: "2026-08-20T12:21:00.000Z"
};

const freshness = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.freshness,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  connectionId: ids.connection,
  mappingId: ids.mapping,
  domain: "financial_reporting",
  scopeKey: "entity",
  providerWatermarkAt: "2026-08-20T12:55:00.000Z",
  lastAttemptAt: "2026-08-20T12:55:00.000Z",
  lastReconciledAt: "2026-08-20T12:58:00.000Z",
  policyVersion: "freshness_policy_v1",
  status: "current",
  blockingLevel: "none",
  reasonCode: null,
  calculatedAt: "2026-08-20T13:00:00.000Z",
  lastSuccessfulSyncAt: "2026-08-20T12:55:00.000Z",
  observedLagSeconds: 300,
  currentMaxAgeSeconds: 900,
  staleAfterSeconds: 3600,
  ageSeconds: 300,
  rowVersion: 1
};

const secondFreshness = {
  ...freshness,
  connectionId: ids.secondConnection,
  mappingId: ids.secondMapping,
  domain: "operational_metrics",
  providerWatermarkAt: "2026-08-20T12:50:00.000Z",
  lastSuccessfulSyncAt: "2026-08-20T12:50:00.000Z",
  currentMaxAgeSeconds: 1800,
  staleAfterSeconds: 7200,
  ageSeconds: 600,
  observedLagSeconds: 600
};

const evidence = {
  factVersionId: ids.fact,
  factFingerprint: fingerprint("d"),
  sourceFingerprints: [fingerprint("b"), fingerprint("c")]
};

const delta = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.businessStateDelta,
  id: ids.delta,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  changeSetId: ids.changeSet,
  fromDeterministicWatermark: fingerprint("4"),
  toDeterministicWatermark: fingerprint("5"),
  fromStateFingerprint: fingerprint("6"),
  toStateFingerprint: fingerprint("7"),
  asOf: "2026-08-20T13:05:00.000Z",
  window: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.000Z" },
  sourceWatermarks: [
    { providerKey: "ledger_demo", mappingId: ids.mapping, streamKey: "financial_reporting", watermarkAt: "2026-08-20T12:55:00.000Z" },
    { providerKey: "planning_demo", mappingId: ids.secondMapping, streamKey: "operational_metrics", watermarkAt: "2026-08-20T12:50:00.000Z" }
  ],
  freshness: [freshness, secondFreshness],
  changes: [
    {
      changeKey: "recognized_revenue:2026-07",
      changeKind: "created",
      nodeType: "aggregate",
      nodeKey: "recognized_revenue:2026-07",
      metricKey: "recognized_revenue",
      period: { start: "2026-07-01", end: "2026-07-31" },
      before: null,
      after: { kind: "money", amount: "1234.5", currency: "USD" },
      absoluteDelta: "1234.5",
      relativeDelta: null,
      unit: null,
      currency: "USD",
      thresholdTransition: "entered",
      severityBefore: "none",
      severityAfter: "medium",
      confidence: "1",
      evidence: [evidence]
    },
    {
      changeKey: "gross_margin_rate:2026-07",
      changeKind: "changed",
      nodeType: "kpi",
      nodeKey: "gross_margin_rate:2026-07",
      metricKey: "gross_margin_rate",
      period: { start: "2026-07-01", end: "2026-07-31" },
      before: { kind: "decimal", value: "0.25", unit: "ratio" },
      after: { kind: "decimal", value: "0.3", unit: "ratio" },
      absoluteDelta: "0.05",
      relativeDelta: "0.2",
      unit: "ratio",
      currency: null,
      thresholdTransition: "none",
      severityBefore: "low",
      severityAfter: "low",
      confidence: "0.9",
      evidence: [{ factVersionId: ids.secondFact, factFingerprint: fingerprint("2"), sourceFingerprints: [fingerprint("3")] }]
    }
  ],
  correlatedGroups: [
    {
      groupKey: "revenue_and_margin",
      memberChangeKeys: ["recognized_revenue:2026-07", "gross_margin_rate:2026-07"],
      deterministicReason: "The same reporting period changed in related financial measures."
    }
  ],
  deterministicOpportunities: [
    {
      developmentKey: "revenue_growth",
      priority: "medium",
      title: "Recognized revenue increased",
      summary: "Deterministic comparison found a material increase.",
      impactValue: "1234.5",
      evidenceFactFingerprints: [fingerprint("d")]
    }
  ],
  deterministicRisks: [
    {
      developmentKey: "margin_change",
      priority: "low",
      title: "Margin changed",
      summary: "Deterministic comparison found a margin change.",
      impactValue: "0.05",
      evidenceFactFingerprints: [fingerprint("2")]
    }
  ],
  materiality: {
    policyVersion: "materiality_policy_v1",
    fingerprint: fingerprint("8"),
    level: "meaningful",
    decision: "terra_eligible",
    reasons: ["absolute_change", "ratio_change"],
    persistenceState: "satisfied",
    cooldownState: "clear"
  },
  limitations: ["Currency conversion was not required.", "Only validated facts were considered."],
  eligibleRoutes: ["terra"]
};

doesNotThrow(() => contract.BusinessEntitySchema.parse(entity), "valid Business Entity must parse");
doesNotThrow(() => contract.IntegrationConnectionSchema.parse(connection), "valid connection must parse");
doesNotThrow(() => contract.ExternalSourceRecordVersionSchema.parse(source), "valid source version must parse");
doesNotThrow(() => contract.CanonicalBusinessFactVersionSchema.parse(fact), "valid canonical fact must parse");
doesNotThrow(() => contract.FreshnessStateSchema.parse(freshness), "valid freshness must parse");
doesNotThrow(() => contract.BusinessStateDeltaV2Schema.parse(delta), "valid Business State Delta must parse");

const selfParent = { ...entity, parentBusinessEntityId: ids.entity };
throws(() => contract.BusinessEntitySchema.parse(selfParent), /cannot be its own parent/);
throws(() => contract.BusinessEntitySchema.parse({ ...entity, extra: true }), /unrecognized/i, "Business Entity must be strict");
throws(() => contract.IntegrationConnectionSchema.parse({ ...connection, grantedScopes: ["admin.write"] }), /not requested/);
ok(contract.isIntegrationConnectionTransitionAllowed("active", "degraded"), "active to degraded must be allowed");
ok(contract.isIntegrationConnectionTransitionAllowed("active", "active"), "same-state transitions must be idempotent");
ok(contract.isIntegrationConnectionTransitionAllowed("degraded", "error"), "nonretryable degraded state may enter error");
ok(contract.isIntegrationConnectionTransitionAllowed("error", "initializing"), "explicit error recovery may resume initialization");
throws(() => contract.assertIntegrationConnectionTransition("deleted", "active"), /Invalid integration connection transition/);

for (const invalidDecimal of ["01", "1.0", "1e3", "+1", "-0", "0.00"]) {
  throws(() => contract.CanonicalDecimalSchema.parse(invalidDecimal), undefined, `${invalidDecimal} must not be canonical`);
}
for (const validDecimal of ["0", "1", "-1", "0.01", "10.25", "-0.5"]) {
  equal(contract.CanonicalDecimalSchema.parse(validDecimal), validDecimal, `${validDecimal} must remain unchanged`);
}

const maxPersistedFactDecimal = `${"9".repeat(21)}.${"9".repeat(9)}`;
const maxNegativePersistedFactDecimal = `-${maxPersistedFactDecimal}`;
const overPrecisionFactDecimal = `${"9".repeat(22)}.${"9".repeat(9)}`;
const overScaleFactDecimal = `0.${"1".repeat(10)}`;
const maxPersistedExchangeRate = `${"9".repeat(18)}.${"9".repeat(12)}`;
const overPrecisionExchangeRate = `${"9".repeat(19)}.${"9".repeat(12)}`;
const overScaleExchangeRate = `0.${"1".repeat(13)}`;

for (const value of ["0", "0.123456789", maxPersistedFactDecimal, maxNegativePersistedFactDecimal]) {
  equal(contract.PersistedFactDecimalSchema.parse(value), value, `${value} must fit numeric(30,9) unchanged`);
}
doesNotThrow(
  () => contract.CanonicalDecimalSchema.parse(overPrecisionFactDecimal),
  "the generic decimal primitive may remain syntax-only"
);
throws(
  () => contract.PersistedFactDecimalSchema.parse(overPrecisionFactDecimal),
  /numeric\(30,9\).*without rounding/,
  "one digit beyond numeric(30,9) precision must fail"
);
throws(
  () => contract.PersistedFactDecimalSchema.parse(overScaleFactDecimal),
  /numeric\(30,9\).*without rounding/,
  "one decimal place beyond numeric(30,9) scale must fail"
);
throws(
  () => contract.PersistedFactDecimalSchema.parse("1.230000000"),
  undefined,
  "persisted decimals must reject noncanonical trailing zeroes"
);
equal(contract.PersistedFactIntegerSchema.parse("9".repeat(21)), "9".repeat(21), "maximum persisted integer must parse");
throws(
  () => contract.PersistedFactIntegerSchema.parse("9".repeat(22)),
  /numeric\(30,9\).*without rounding/,
  "persisted integers must fit the numeric(30,9) integer range"
);
equal(
  contract.PersistedNonNegativeFactDecimalSchema.parse(maxPersistedFactDecimal),
  maxPersistedFactDecimal,
  "maximum contribution weight representation must parse unchanged"
);
throws(
  () => contract.PersistedNonNegativeFactDecimalSchema.parse("-0.5"),
  /non-negative/,
  "contribution weights must remain non-negative"
);
for (const value of ["1", "0.999999999"]) {
  equal(contract.PersistedUnitIntervalDecimalSchema.parse(value), value, `${value} must fit the persisted unit interval`);
}
throws(() => contract.PersistedUnitIntervalDecimalSchema.parse("1.1"), /between zero and one/);
equal(
  contract.PersistedExchangeRateSchema.parse(maxPersistedExchangeRate),
  maxPersistedExchangeRate,
  "maximum numeric(30,12) exchange rate must parse unchanged"
);
throws(
  () => contract.PersistedExchangeRateSchema.parse(overPrecisionExchangeRate),
  /numeric\(30,12\).*without rounding/,
  "one digit beyond exchange-rate precision must fail"
);
throws(
  () => contract.PersistedExchangeRateSchema.parse(overScaleExchangeRate),
  /numeric\(30,12\).*without rounding/,
  "one decimal place beyond exchange-rate scale must fail"
);
throws(() => contract.PersistedExchangeRateSchema.parse("-1"), /positive/, "exchange rates must be positive");
throws(() => contract.Sha256FingerprintSchema.parse(`sha256:${"A".repeat(64)}`), undefined, "uppercase hashes must fail");

const acceptedSource = { ...source, trust: "accepted" };
throws(() => contract.ExternalSourceRecordVersionSchema.parse(acceptedSource), undefined, "external input cannot claim acceptance");
const foreignManualConnection = {
  ...source,
  source: { kind: "manual", actorId: ids.actor, entryReference: "manual_1" },
  connectionId: ids.connection
};
throws(() => contract.ExternalSourceRecordVersionSchema.parse(foreignManualConnection), /cannot claim a connection/);
throws(
  () => contract.ExternalSourceRecordVersionSchema.parse({ ...source, changeKind: "deleted" }),
  /Deleted source versions cannot contain a projection/
);
throws(
  () => contract.ExternalSourceRecordVersionSchema.parse({ ...source, unexpectedEvidenceState: "accepted" }),
  /unrecognized/i,
  "source versions must be strict"
);

throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({ ...fact, decision: { ...fact.decision, authority: "model" } }),
  undefined,
  "models cannot have numerical decision authority"
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({ ...fact, reconciliationState: "accepted", validationState: "invalid" }),
  /Accepted facts must be valid/
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({ ...fact, value: { kind: "money", amount: "01.0", currency: "USD" } }),
  undefined,
  "malformed accounting decimals must fail"
);
doesNotThrow(
  () => contract.CanonicalBusinessFactVersionSchema.parse({
    ...fact,
    value: { kind: "money", amount: maxPersistedFactDecimal, currency: "USD" }
  }),
  "maximum persisted money value must parse"
);
throws(
  () => contract.canonicalFactFingerprint({
    ...fact,
    value: { kind: "money", amount: overPrecisionFactDecimal, currency: "USD" }
  }),
  /numeric\(30,9\).*without rounding/,
  "out-of-range fact values must fail before canonical hashing"
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({
    ...fact,
    value: { kind: "integer", value: "9".repeat(22), unit: null },
    accounting: {
      ...fact.accounting,
      sourceCurrency: null,
      reportingCurrency: null
    }
  }),
  /numeric\(30,9\).*without rounding/,
  "integer facts must fit their persisted numeric column"
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({
    ...fact,
    accounting: { ...fact.accounting, reportingCurrency: "EUR", exchangeRate: null, exchangeRateSource: null }
  }),
  /Currency conversion requires a rate and rate source/
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({
    ...fact,
    accounting: { ...fact.accounting, exchangeRate: "1", exchangeRateSource: "provider_rate" }
  }),
  /Same-currency facts cannot carry conversion metadata/
);
throws(
  () => contract.CanonicalBusinessFactVersionSchema.parse({
    ...fact,
    decision: { ...fact.decision, authority: "customer_authorized_user", policyVersion: null, actorId: null }
  }),
  /Human decisions require an actor/
);

const providerDescriptor = {
  contractVersion: contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.providerAdapter,
  providerKey: "ledger_demo",
  displayName: "Ledger Demo",
  adapterVersion: "ledger_adapter_v1",
  authorizationMode: "oauth2_confidential",
  accessMode: "read_only",
  environments: [{ key: "sandbox", authorizationEndpointClass: "sandbox" }],
  minimumScopes: ["accounting.read"],
  optionalScopes: ["reports.read"],
  readMethodAllowlist: ["GET"],
  hostnameAllowlist: ["api.ledger.example"],
  capabilities: {
    operations: ["list_entities", "list_source_records", "get_source_record", "get_capabilities"],
    domains: ["financial_reporting"],
    supportsBackfill: true
  },
  objectStreams: [
    { streamKey: "financial_reporting", domain: "financial_reporting", mode: "incremental", requiredForActivation: true }
  ],
  webhookMode: "change_hints",
  incrementalMode: "cursor",
  rateLimitPolicy: { observationMode: "hybrid", maximumConcurrency: 4, defaultMinimumDelayMs: 100 },
  officialDocumentationLinks: ["https://docs.ledger.example/api"],
  legalCommercialGateVersion: "provider_gate_v1",
  unsupportedCapabilities: []
};

for (const [providerKey, displayName] of [
  ["ledger_demo", "Ledger Demo"],
  ["planning_demo", "Planning Demo"],
  ["archive_demo", "Archive Demo"],
  ["business_central", "Business Central"],
  ["netsuite", "NetSuite"]
]) {
  doesNotThrow(
    () => contract.ProviderDescriptorSchema.parse({ ...providerDescriptor, providerKey, displayName }),
    `${providerKey} must fit the provider-neutral contract`
  );
}

const parsedProviderDescriptor = contract.ProviderDescriptorSchema.parse(providerDescriptor);
ok(
  !Object.prototype.hasOwnProperty.call(parsedProviderDescriptor, "readOnlyPostOperations"),
  "GET-only descriptors do not acquire implicit read-only POST operations"
);
const readOnlyPostOperation = {
  operationKey: "ledger_search",
  providerKey: "ledger_demo",
  providerEnvironment: "sandbox",
  hostname: "api.ledger.example",
  path: "/v1/records/search",
  method: "POST",
  contentType: "application/json",
  maximumRequestBodyBytes: 4096,
  requestValidatorKey: "ledger_search_request_v1",
  maximumResponseBytes: 1048576,
  timeoutMs: 30000,
  retryClassification: "idempotent_read_with_backoff"
};
doesNotThrow(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [readOnlyPostOperation]
    }),
  "provider descriptors can declare exact semantically read-only POST operations"
);
throws(
  () => contract.ProviderDescriptorSchema.parse({ ...providerDescriptor, readMethodAllowlist: ["POST"] }),
  undefined,
  "provider data methods must remain read-only"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, providerKey: "archive_demo" }]
    }),
  /must match the descriptor provider/,
  "read-only POST operations must be bound to the descriptor provider"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, providerEnvironment: "production" }]
    }),
  /declared environment/,
  "read-only POST operations must be bound to a declared provider environment"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, hostname: "write.ledger.example" }]
    }),
  /declared hostname/,
  "read-only POST operations must be bound to a declared hostname"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [
        readOnlyPostOperation,
        { ...readOnlyPostOperation, operationKey: "ledger_search_duplicate" }
      ]
    }),
  /destinations must be unique/,
  "duplicate read-only POST destinations are ambiguous and fail closed"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, method: "GET" }]
    }),
  undefined,
  "read-only POST operation declarations cannot authorize another method"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, contentType: "application/x-www-form-urlencoded" }]
    }),
  undefined,
  "read-only POST operations must declare JSON request validation"
);
throws(
  () =>
    contract.ProviderDescriptorSchema.parse({
      ...providerDescriptor,
      readOnlyPostOperations: [{ ...readOnlyPostOperation, maximumRequestBodyBytes: 0 }]
    }),
  undefined,
  "read-only POST operations must declare a positive request-body ceiling"
);
for (const malformedPath of [
  "/v1//records/search",
  "/v1/records/%73earch",
  "/v1/records/../search",
  "v1/records/search"
]) {
  throws(
    () =>
      contract.ProviderDescriptorSchema.parse({
        ...providerDescriptor,
        readOnlyPostOperations: [{ ...readOnlyPostOperation, path: malformedPath }]
      }),
    /operation paths/,
    `malformed read-only POST path ${malformedPath} fails descriptor validation`
  );
}
throws(
  () => contract.ProviderDescriptorSchema.parse({ ...providerDescriptor, optionalScopes: ["accounting.read"] }),
  /must not overlap/,
  "minimum and optional scopes must remain disjoint"
);

const adapterContext = {
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  connectionId: ids.connection,
  providerKey: "ledger_demo",
  providerEnvironment: "sandbox",
  providerTenantReferenceFingerprint: fingerprint("a"),
  connectionConfigurationVersion: 1,
  mappingVersion: 1
};
for (const providerKey of ["business_central", "netsuite"]) {
  doesNotThrow(
    () => contract.IntegrationConnectionSchema.parse({ ...connection, providerKey }),
    `${providerKey} must fit the provider-neutral connection contract`
  );
  doesNotThrow(
    () => contract.ProviderAdapterContextSchema.parse({ ...adapterContext, providerKey }),
    `${providerKey} must fit the tenant-bound provider adapter context`
  );
}
const adapterResult = {
  outcome: "success",
  operation: "list_source_records",
  context: adapterContext,
  trust: "untrusted_external_input",
  payload: { kind: "source_records", items: [source] },
  completedAt: "2026-08-20T12:12:00.000Z"
};
doesNotThrow(() => contract.ProviderAdapterResultSchema.parse(adapterResult), "tenant-bound adapter result must parse");
const crossWorkspaceAdapterResult = clone(adapterResult);
crossWorkspaceAdapterResult.payload.items[0].workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
throws(() => contract.ProviderAdapterResultSchema.parse(crossWorkspaceAdapterResult), /bound tenant and provider context/);
throws(
  () => contract.ProviderAdapterResultSchema.parse({ ...adapterResult, operation: "list_entities" }),
  /payload does not match its operation/
);
throws(
  () => contract.ProviderAdapterResultSchema.parse({ ...adapterResult, accepted: true }),
  /unrecognized/i,
  "adapter output cannot claim accepted truth"
);

equal(contract.isFreshnessEligibleForCurrentAnalysis(freshness), true, "current required data must be eligible");
throws(
  () => contract.FreshnessStateSchema.parse({ ...freshness, ageSeconds: 901 }),
  /exceeds its current threshold/
);
const agingFreshness = { ...freshness, status: "aging", blockingLevel: "warning", ageSeconds: 1200 };
equal(contract.isFreshnessEligibleForCurrentAnalysis(agingFreshness), true, "aging data remains usable with a warning");
throws(
  () => contract.FreshnessStateSchema.parse({ ...freshness, status: "sync_error", blockingLevel: "warning" }),
  /Override freshness states must fail closed/
);
const staleFreshness = { ...freshness, status: "stale", blockingLevel: "current_intelligence", ageSeconds: 3601 };
equal(contract.isFreshnessEligibleForCurrentAnalysis(staleFreshness), false, "stale required data must fail closed");
const staleDelta = clone(delta);
staleDelta.freshness[0] = staleFreshness;
throws(() => contract.BusinessStateDeltaV2Schema.parse(staleDelta), /Unsafe freshness must fail closed/);
staleDelta.eligibleRoutes = [];
staleDelta.materiality = { ...staleDelta.materiality, decision: "no_ai" };
doesNotThrow(() => contract.BusinessStateDeltaV2Schema.parse(staleDelta), "stale data may produce a no-analysis delta");
throws(
  () => contract.BusinessStateDeltaV2Schema.parse({
    ...delta,
    materiality: { ...delta.materiality, decision: "luna_eligible" },
    eligibleRoutes: ["terra"]
  }),
  /requires its matching route/
);
throws(
  () => contract.BusinessStateDeltaV2Schema.parse({ ...delta, providerPayload: { token: "secret" } }),
  /unrecognized/i,
  "Business State Delta must reject provider payloads"
);
const overRangeDelta = clone(delta);
overRangeDelta.changes[0].absoluteDelta = overPrecisionFactDecimal;
throws(
  () => contract.businessStateDeltaFingerprint(overRangeDelta),
  /numeric\(30,9\).*without rounding/,
  "out-of-range delta values must fail before canonical hashing"
);

equal(contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.sourceRecord, "external_source_record_version_v1");
equal(contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact, "canonical_business_fact_version_v2");
equal(contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.businessStateDelta, "business_state_delta_v2");
equal(contract.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.fingerprint, "external_integration_fingerprint_v1");

equal(contract.canonicalContractJson({ z: 1, a: { y: true, b: "value" } }), '{"a":{"b":"value","y":true},"z":1}');
equal(
  contract.canonicalContractJson(Object.fromEntries([["a", { b: "value", y: true }], ["z", 1]])),
  contract.canonicalContractJson({ z: 1, a: { y: true, b: "value" } }),
  "object insertion order must not matter"
);
throws(() => contract.canonicalContractJson({ value: undefined }), /Unsupported canonical contract value/);
throws(() => contract.canonicalContractJson([1, , 2]), /cannot be sparse/);
throws(() => contract.canonicalContractJson({ value: 0.1 }), /canonical decimal strings/);
throws(() => contract.canonicalContractJson({ value: Number.NaN }), /canonical decimal strings/);
throws(() => contract.canonicalContractJson({ value: BigInt(1) }), /Unsupported canonical contract value/);
throws(() => contract.canonicalContractJson({ value: new Date("2026-08-20T00:00:00.000Z") }), /plain objects/);
const cyclic = {};
cyclic.self = cyclic;
throws(() => contract.canonicalContractJson(cyclic), /cannot contain cycles/);
const hidden = {};
Object.defineProperty(hidden, "value", { enumerable: false, value: undefined });
throws(() => contract.canonicalContractJson(hidden), /enumerable data properties only/);
const accessor = {};
Object.defineProperty(accessor, "value", { enumerable: true, get: () => "hidden" });
throws(() => contract.canonicalContractJson(accessor), /enumerable data properties only/);

const sourceHash = contract.externalSourceFingerprint(source);
const factHash = contract.canonicalFactFingerprint(fact);
const deltaHash = contract.businessStateDeltaFingerprint(delta);
equal(sourceHash, "sha256:b092d645674a3db05695c9c27d48e5231167c3f55e2822478b00e6d309f5949e", "source golden fingerprint changed");
equal(factHash, "sha256:7cac62c9b19aad2d03c5e0715718bd50f93a940b9f3a9b8d5bb36344d4197443", "fact golden fingerprint changed");
equal(deltaHash, "sha256:9fa5ad874baf6038070f5170fc4b14b43a4de671b8adfd643956ac3f71a74e17", "delta golden fingerprint changed");

const reorderedSource = Object.fromEntries(Object.entries(source).reverse());
equal(contract.externalSourceFingerprint(reorderedSource), sourceHash, "source key order must not change its fingerprint");
equal(
  contract.externalSourceFingerprint({
    ...source,
    id: ids.secondSource,
    immutableVersion: 99,
    receivedAt: "2026-08-21T12:11:00.000Z",
    temporal: {
      ...source.temporal,
      synchronizedAt: "2026-08-21T12:10:30.000Z",
      ingestedAt: "2026-08-21T12:10:45.000Z"
    }
  }),
  sourceHash,
  "source persistence and receipt identity must not change semantic truth"
);
ok(
  contract.externalSourceFingerprint({ ...source, normalizedProjection: { ...source.normalizedProjection, amount: "1235" } }) !== sourceHash,
  "source semantic changes must change its fingerprint"
);

const permutedFact = clone(fact);
permutedFact.dimensions.reverse();
permutedFact.sources.reverse();
permutedFact.decision.reasonCodes.reverse();
permutedFact.decision.decidedAt = "2026-08-21T12:20:00.000Z";
permutedFact.createdAt = "2026-08-21T12:21:00.000Z";
equal(contract.canonicalFactFingerprint(permutedFact), factHash, "fact semantic sets and receipt times must be stable");
ok(
  contract.canonicalFactFingerprint({ ...fact, value: { kind: "money", amount: "1235", currency: "USD" } }) !== factHash,
  "fact truth changes must change its fingerprint"
);

const permutedDelta = clone(delta);
permutedDelta.sourceWatermarks.reverse();
permutedDelta.freshness.reverse();
permutedDelta.changes.reverse();
for (const change of permutedDelta.changes) {
  change.evidence.reverse();
  for (const reference of change.evidence) reference.sourceFingerprints.reverse();
}
permutedDelta.correlatedGroups.reverse();
for (const group of permutedDelta.correlatedGroups) group.memberChangeKeys.reverse();
permutedDelta.deterministicRisks.reverse();
permutedDelta.deterministicOpportunities.reverse();
permutedDelta.materiality.reasons.reverse();
permutedDelta.limitations.reverse();
permutedDelta.eligibleRoutes.reverse();
permutedDelta.asOf = "2026-08-21T13:05:00.000Z";
permutedDelta.freshness[0].calculatedAt = "2026-08-21T13:05:00.000Z";
permutedDelta.freshness[0].ageSeconds = 700;
equal(contract.businessStateDeltaFingerprint(permutedDelta), deltaHash, "delta semantic sets and evaluation times must be stable");
const changedDelta = clone(delta);
changedDelta.changes[0].after.amount = "1235";
ok(contract.businessStateDeltaFingerprint(changedDelta) !== deltaHash, "material delta changes must change its fingerprint");

console.log(`External integration Phase 0 contract regressions: ${assertionCount} assertions passed.`);
