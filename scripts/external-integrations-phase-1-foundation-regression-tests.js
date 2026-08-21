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

const contracts = require("../lib/integrations/contracts/index.ts");
const identity = require("../lib/integrations/persistence/identity.ts");
const serializers = require("../lib/integrations/persistence/serializers.ts");

const migrationPath = path.join(
  root,
  "supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");
const repository = fs.readFileSync(
  path.join(root, "lib/integrations/persistence/repository.ts"),
  "utf8"
);
const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function notEqual(actual, expected, message) {
  assertionCount += 1;
  assert.notEqual(actual, expected, message);
}
function match(value, pattern, message) {
  assertionCount += 1;
  assert.match(value, pattern, message);
}
function doesNotMatch(value, pattern, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
}
function throws(callback, pattern, message) {
  assertionCount += 1;
  assert.throws(callback, pattern, message);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  otherWorkspace: "11111111-1111-4111-8111-111111111112",
  entity: "22222222-2222-4222-8222-222222222222",
  otherEntity: "22222222-2222-4222-8222-222222222223",
  connection: "33333333-3333-4333-8333-333333333333",
  actor: "44444444-4444-4444-8444-444444444444",
  sourceVersion: "55555555-5555-4555-8555-555555555555",
  factVersion: "66666666-6666-4666-8666-666666666666"
};

const manualSource = {
  contractVersion: contracts.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.sourceRecord,
  id: ids.sourceVersion,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  connectionId: null,
  immutableVersion: 1,
  priorVersionId: null,
  recordKind: "manual_journal_observation",
  source: {
    kind: "manual",
    actorId: ids.actor,
    entryReference: "journal_entry_2026_08_20"
  },
  temporal: {
    basis: "event",
    providerCreatedAt: null,
    providerUpdatedAt: null,
    observedAt: "2026-08-20T20:00:00.000Z",
    synchronizedAt: "2026-08-20T20:00:01.000Z",
    ingestedAt: "2026-08-20T20:00:02.000Z",
    effectiveAt: "2026-08-20T19:00:00.000Z",
    postingDate: "2026-08-20",
    periodStart: null,
    periodEnd: null,
    sourceTimeZone: "America/Los_Angeles"
  },
  accounting: { basis: "accrual", currency: "USD" },
  normalizedSchemaVersion: "manual_journal_observation_v1",
  changeKind: "created",
  normalizedProjection: { amount: "1234.5", accountKey: "revenue" },
  trust: "untrusted_external_input",
  validation: { state: "valid", validatorVersion: "manual_source_validator_v1", issues: [] },
  receivedAt: "2026-08-20T20:00:03.000Z"
};

const preparedSource = serializers.prepareExternalSourceVersionCommit(manualSource);
const canonicalFact = {
  contractVersion: contracts.EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact,
  id: ids.factVersion,
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  immutableVersion: 1,
  factKind: "recognized_revenue",
  factKey: "recognized_revenue:2026-08-20:manual_journal",
  dimensions: [{ key: "department", value: "Operations" }],
  temporal: {
    effectiveAt: "2026-08-20T19:00:00.000Z",
    postingDate: "2026-08-20",
    periodStart: null,
    periodEnd: null,
    fiscalYear: 2026,
    fiscalPeriod: 8,
    sourceTimeZone: "America/Los_Angeles",
    closedPeriod: false
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
      sourceRecordVersionId: ids.sourceVersion,
      sourceFingerprint: preparedSource.sourceFingerprint,
      sourceRole: "primary",
      contributionWeight: "1"
    }
  ],
  decision: {
    authority: "deterministic_policy",
    policyVersion: "phase_1_acceptance_policy_v1",
    actorId: null,
    decidedAt: "2026-08-20T20:01:00.000Z",
    reasonCodes: ["validated_source", "single_source_foundation"]
  },
  normalizationVersion: "recognized_revenue_normalization_v1",
  transformationVersion: "recognized_revenue_transformation_v1",
  sourceObservedAt: "2026-08-20T20:00:00.000Z",
  createdAt: "2026-08-20T20:01:01.000Z"
};

const preparedFact = serializers.prepareCanonicalFactVersionCommit(canonicalFact);

equal(
  preparedSource.sourceIdentityFingerprint,
  "sha256:12c63710dbd1c31523fb854e20a0dd4f2857f95a171b28c800b83639789cdefe",
  "source identity fingerprint matches the reviewed golden value"
);
equal(
  preparedFact.identityFingerprint,
  "sha256:5b543d00bb40ff0384a5fdef59b2261941a377ca78fb1f2122a96a356f45ba67",
  "fact identity fingerprint matches the reviewed golden value"
);
equal(preparedSource.version.sourceFingerprint, preparedSource.sourceFingerprint, "source serializer attaches its checked hash");
equal(preparedFact.version.factFingerprint, preparedFact.factFingerprint, "fact serializer attaches its checked hash");
equal(
  serializers.prepareExternalSourceVersionCommit(manualSource).sourceIdentityFingerprint,
  preparedSource.sourceIdentityFingerprint,
  "identical source identity input is stable"
);
equal(
  serializers.prepareCanonicalFactVersionCommit(canonicalFact).identityFingerprint,
  preparedFact.identityFingerprint,
  "identical fact identity input is stable"
);
notEqual(
  serializers.prepareExternalSourceVersionCommit({ ...manualSource, workspaceId: ids.otherWorkspace }).sourceIdentityFingerprint,
  preparedSource.sourceIdentityFingerprint,
  "source identity is workspace-bound"
);
notEqual(
  serializers.prepareExternalSourceVersionCommit({ ...manualSource, businessEntityId: ids.otherEntity }).sourceIdentityFingerprint,
  preparedSource.sourceIdentityFingerprint,
  "source identity is Business-Entity-bound"
);
notEqual(
  serializers.prepareCanonicalFactVersionCommit({ ...canonicalFact, workspaceId: ids.otherWorkspace }).identityFingerprint,
  preparedFact.identityFingerprint,
  "fact identity is workspace-bound"
);
notEqual(
  serializers.prepareCanonicalFactVersionCommit({ ...canonicalFact, businessEntityId: ids.otherEntity }).identityFingerprint,
  preparedFact.identityFingerprint,
  "fact identity is Business-Entity-bound"
);
equal(
  serializers.prepareCanonicalFactVersionCommit({
    ...canonicalFact,
    dimensions: [{ key: "department", value: "Finance" }],
    value: { kind: "money", amount: "999", currency: "USD" }
  }).identityFingerprint,
  preparedFact.identityFingerprint,
  "fact identity excludes value and dimensions"
);
notEqual(
  serializers.prepareCanonicalFactVersionCommit({ ...canonicalFact, factKey: "recognized_revenue:other" }).identityFingerprint,
  preparedFact.identityFingerprint,
  "factKey is part of sole canonical identity"
);
notEqual(
  serializers.prepareCanonicalFactVersionCommit({ ...canonicalFact, factKind: "cash_receipt" }).identityFingerprint,
  preparedFact.identityFingerprint,
  "factKind is part of sole canonical identity"
);
notEqual(
  serializers.prepareCanonicalFactVersionCommit({
    ...canonicalFact,
    value: { kind: "money", amount: "1234.6", currency: "USD" }
  }).factFingerprint,
  preparedFact.factFingerprint,
  "fact semantic changes create a new fact fingerprint without changing identity"
);

const reorderedFact = clone(canonicalFact);
reorderedFact.decision.reasonCodes.reverse();
equal(
  serializers.prepareCanonicalFactVersionCommit(reorderedFact).factFingerprint,
  preparedFact.factFingerprint,
  "reason codes are a semantic set for canonical hashing"
);

const providerSource = {
  ...manualSource,
  connectionId: ids.connection,
  source: {
    kind: "provider",
    providerKey: "ledger_demo",
    providerRecordType: "journal_entry",
    providerRecordId: "entry_100",
    providerVersionReference: "revision_1"
  }
};
equal(
  identity.externalSourceIdentityFingerprint(providerSource),
  identity.externalSourceIdentityFingerprint({
    ...providerSource,
    source: { ...providerSource.source, providerVersionReference: "revision_2" }
  }),
  "provider version references never redefine stable source identity"
);
notEqual(
  serializers.prepareExternalSourceVersionCommit(providerSource).sourceFingerprint,
  serializers.prepareExternalSourceVersionCommit({
    ...providerSource,
    source: { ...providerSource.source, providerVersionReference: "revision_2" }
  }).sourceFingerprint,
  "provider version references remain source-version semantics"
);

const oversizedFact = clone(canonicalFact);
oversizedFact.value.amount = "1234567890123456789012";
throws(
  () => serializers.prepareCanonicalFactVersionCommit(oversizedFact),
  /numeric\(30,9\)/,
  "one integer digit beyond numeric(30,9) is rejected before hashing"
);
const overScaleFact = clone(canonicalFact);
overScaleFact.value.amount = "1.1234567891";
throws(
  () => serializers.prepareCanonicalFactVersionCommit(overScaleFact),
  /numeric\(30,9\)/,
  "one decimal place beyond numeric(30,9) is rejected before hashing"
);
const trailingZeroFact = clone(canonicalFact);
trailingZeroFact.value.amount = "1.20";
throws(
  () => serializers.prepareCanonicalFactVersionCommit(trailingZeroFact),
  /Invalid/,
  "noncanonical trailing zeroes are rejected"
);
const exchangeRateFact = clone(canonicalFact);
exchangeRateFact.accounting.reportingCurrency = "EUR";
exchangeRateFact.accounting.exchangeRate = "1234567890123456789";
exchangeRateFact.accounting.exchangeRateSource = "daily_rate_v1";
throws(
  () => serializers.prepareCanonicalFactVersionCommit(exchangeRateFact),
  /numeric\(30,12\)/,
  "one integer digit beyond numeric(30,12) exchange-rate bounds is rejected"
);
throws(
  () => serializers.prepareExternalSourceVersionCommit({
    ...manualSource,
    sourceFingerprint: `sha256:${"f".repeat(64)}`
  }),
  /fingerprint_mismatch/,
  "a caller cannot substitute a source fingerprint"
);
throws(
  () => serializers.prepareCanonicalFactVersionCommit({
    ...canonicalFact,
    factFingerprint: `sha256:${"e".repeat(64)}`
  }),
  /fingerprint_mismatch/,
  "a caller cannot substitute a fact fingerprint"
);

match(migration, /create table public\.business_entities\b/, "Phase 1 creates Business Entities");
match(migration, /create table private\.external_source_records\b/, "Phase 1 creates source identity");
match(migration, /create table private\.external_source_record_versions\b/, "Phase 1 creates immutable source versions");
match(migration, /create table private\.canonical_business_facts\b/, "Phase 1 creates canonical fact identity");
match(migration, /create table private\.canonical_business_fact_versions\b/, "Phase 1 creates immutable fact versions");
match(migration, /create table private\.business_fact_sources\b/, "Phase 1 creates normalized source provenance");
match(migration, /create table private\.integration_audit_events\b/, "Phase 1 creates audit foundation");
match(migration, /canonical_business_fact_version_v2/, "V2 is the only persisted canonical fact contract");
doesNotMatch(migration, /canonical_business_fact_version_v1/, "superseded fact V1 is absent");
match(migration, /unique \(\s*workspace_id,\s*business_entity_id,\s*fact_kind,\s*fact_key\s*\)/, "factKind plus factKey is the database identity");
match(migration, /identity_fingerprint bytea/, "identity hash is only a contract-derived index");
match(migration, /entity_key text not null/, "stable entityKey is persisted directly");
match(migration, /status in \('active', 'inactive', 'archived'\)/, "Business Entity vocabulary stays exact");
match(migration, /numeric\(30,9\)/, "fact numeric query projections use numeric(30,9)");
match(migration, /numeric\(30,12\)/, "exchange-rate query projections use numeric(30,12)");
match(migration, /fact_decimal_out_of_bounds/, "fact bounds are checked before numeric casts");
match(migration, /fact_exchange_rate_out_of_bounds/, "exchange-rate bounds are checked before numeric casts");
match(migration, /canonical_fact_version_provenance_v1[\s\S]+deferrable initially deferred/, "nonempty provenance has a deferred constraint trigger");
match(migration, /reject_external_source_record_version_mutation_v1/, "source history rejects mutation");
match(migration, /reject_canonical_business_fact_version_mutation_v1/, "fact history rejects mutation");
match(migration, /reject_business_fact_source_mutation_v1/, "provenance edges reject replacement");
match(migration, /foreach v_table[\s\S]+canonical_business_fact_versions[\s\S]+alter table private\.%I enable row level security/, "private fact versions are included in mandatory RLS setup");
match(migration, /revoke all on table private\.%I from public, anon, authenticated, service_role, external_integrations_authority/, "private tables revoke every API authority");
match(migration, /revoke external_integrations_authority from service_role/, "the broad service role cannot inherit integration commit authority");
match(migration, /security definer\s+set search_path = ''/g, "hardened functions have empty search paths");
match(migration, /phase_1_provider_source_authority_deferred/, "provider writes remain fail-closed in Phase 1");
match(migration, /accepted_fact_requires_valid_sources/, "accepted facts require validated provenance");
match(migration, /business_fact_sources_fact_tenant_idx/, "fact provenance has a tenant-bound foreign-key index");
match(migration, /business_fact_sources_source_tenant_idx/, "source provenance has a tenant-bound foreign-key index");
match(migration, /decision_authority in \('deterministic_policy', 'customer_authorized_user', 'operator'\)/, "decision authority vocabulary is exact");
doesNotMatch(migration, /create table (?:public|private)\.integration_connections\b/, "Phase 1 does not create provider connections");
doesNotMatch(migration, /create table (?:public|private)\.integration_credentials\b/, "Phase 1 does not create credentials");
doesNotMatch(migration, /create table (?:public|private)\.source_authority_policies\b/, "Phase 2 source authority is absent");
doesNotMatch(migration, /create table (?:public|private)\.reconciliation_cases\b/, "Phase 2 reconciliation cases are absent");
doesNotMatch(migration, /create table (?:public|private)\.fact_contributions\b/, "Phase 2 fact contributions are absent");
doesNotMatch(migration, /create table (?:public|private)\.business_state_deltas\b/, "Business State Delta storage is absent");
doesNotMatch(migration, /create table (?:public|private)\.integration_sync_tasks\b/, "sync tasks are absent");
doesNotMatch(migration, /create (?:table|function)[\s\S]{0,120}(?:oauth|cloud_tasks|cloud_run|secret_manager|kms)/i, "provider and cloud infrastructure objects are absent");

match(repository, /^import "server-only";/, "the repository cannot enter a client bundle");
doesNotMatch(repository, /\.from\s*\(/, "the repository cannot bypass checked RPCs with direct table access");
doesNotMatch(repository, /createSupabaseAdminClient/, "the repository cannot fall back to the broad Supabase admin client");
match(repository, /external_integrations_checked_rpc_client_required/, "every mutation requires an explicitly injected checked RPC client");
match(repository, /prepareExternalSourceVersionCommit\(input\)/, "source validation and hashing precede RPC execution");
match(repository, /prepareCanonicalFactVersionCommit\(input\)/, "fact V2 validation and hashing precede RPC execution");
match(workflow, /pnpm test:external-integrations-phase-1/, "CI registers pure Phase 1 regressions");
match(workflow, /external_integrations_phase_1_canonical_foundation\.test\.sql/, "CI registers Phase 1 database authorization tests");

process.stdout.write(`External Integrations Phase 1 foundation checks passed: ${assertionCount} assertions.\n`);
