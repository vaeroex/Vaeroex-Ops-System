const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const contractDirectory = path.join(root, "lib/integrations/contracts");
const contractFiles = fs.readdirSync(contractDirectory).filter((name) => name.endsWith(".ts")).sort();
const contractSource = contractFiles.map((name) => read(`lib/integrations/contracts/${name}`)).join("\n");
const adr = read("docs/architecture/adr-007-external-integrations-contract-foundation.md");
const alignment = read("docs/architecture/external-integrations-phase-0-1-contract-persistence-alignment.md");
const sourceFactContracts = read("lib/integrations/contracts/source-facts.ts");
const intelligenceContracts = read("lib/integrations/contracts/intelligence.ts");
const versionContracts = read("lib/integrations/contracts/versions.ts");
const packageJson = JSON.parse(read("package.json"));
const ciWorkflow = read(".github/workflows/ci.yml");
const databaseTestRunner = read("scripts/run-isolated-database-tests.js");
const zeroBasedUpgradeRunner = read(
  "scripts/run-phase8b-zero-based-delivery-migration-tests.js"
);
const zeroBasedFixture = read(
  "supabase/tests/fixtures/external_integrations_phase_8b_zero_based_legacy.sql"
);

let assertionCount = 0;
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function matches(value, pattern, message) {
  assertionCount += 1;
  assert.match(value, pattern, message);
}
function doesNotMatch(value, pattern, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
}

for (const requiredFile of [
  "canonical.ts",
  "control-plane.ts",
  "index.ts",
  "intelligence.ts",
  "primitives.ts",
  "provider-adapter.ts",
  "source-facts.ts",
  "versions.ts"
]) {
  ok(contractFiles.includes(requiredFile), `missing Phase 0 contract file: ${requiredFile}`);
}

doesNotMatch(
  contractSource,
  /QuickBooks|Intuit|Microsoft|Business Central|Oracle|NetSuite|SAP/i,
  "generic contracts must not contain provider-specific names"
);
doesNotMatch(
  contractSource,
  /\bfetch\s*\(|axios|node:https|node:http|process\.env|@supabase|supabase-js|openai|stripe/i,
  "Phase 0 contracts must not contain network, database, environment, model, or billing dependencies"
);
doesNotMatch(contractSource, /["']use server["']|server-only|app\//i, "Phase 0 contracts must remain pure and route-free");
doesNotMatch(contractSource, /credential|access_token|refresh_token|client_secret/i, "generic contracts must not carry credentials");
matches(contractSource, /untrusted_external_input/, "provider output must be explicitly untrusted");
doesNotMatch(contractSource, /authority:\s*z\.enum\([^\n]*model/i, "model authority must not exist");
matches(contractSource, /Unsafe freshness must fail closed/, "freshness must fail closed before analysis routing");
matches(contractSource, /"aging"/, "freshness must include the approved aging state");
matches(contractSource, /current_intelligence/, "freshness must carry explicit blocking levels");
matches(contractSource, /fromDeterministicWatermark/, "Business State Delta must carry deterministic before/after watermarks");
matches(contractSource, /luna_eligible/, "materiality must express selective model-tier eligibility");
matches(contractSource, /pending_authorization[\s\S]+"error"/, "the connection lifecycle must include explicit error recovery");
matches(contractSource, /CanonicalDecimalSchema/, "accounting decimals must use the canonical string contract");
matches(contractSource, /PersistedFactDecimalSchema/, "persisted fact decimals must use a bounded semantic contract");
matches(contractSource, /PersistedExchangeRateSchema/, "exchange rates must use their bounded semantic contract");
doesNotMatch(
  `${sourceFactContracts}\n${intelligenceContracts}`,
  /\bCanonicalDecimalSchema\b|\bCanonicalIntegerSchema\b|\bPositiveCanonicalDecimalSchema\b|\bNonNegativeCanonicalDecimalSchema\b|\bUnitIntervalCanonicalDecimalSchema\b/,
  "persisted canonical truth must not use syntax-only decimal schemas"
);
matches(versionContracts, /canonical_business_fact_version_v2/, "the narrowed fact validation contract must be V2");
matches(versionContracts, /business_state_delta_v2/, "the narrowed delta validation contract must be V2");
matches(versionContracts, /external_integration_fingerprint_v1/, "the unchanged fingerprint algorithm must remain V1");
matches(contractSource, /workspaceId/, "tenant identity must be explicit");
matches(contractSource, /businessEntityId/, "Business Entity identity must be explicit");

matches(adr, /random per-object AES-256-GCM DEK/, "ADR must record per-object payload envelope encryption");
matches(adr, /KMS wrapping of the small DEK/, "ADR must limit KMS to wrapping payload DEKs");
matches(adr, /Small per-connection OAuth credential envelopes use direct Google Cloud KMS encryption/, "ADR must preserve direct KMS for small credentials");
matches(adr, /uniform bucket-level access/, "ADR must record private object access posture");
matches(adr, /soft delete disabled/, "ADR must record exceptional temporary-bucket deletion posture");
matches(adr, /modernized Intuit Reports API response is the canonical target/, "ADR must record the modernized report direction");
matches(adr, /launch defaults subject to sandbox\/load evidence, not architectural constants/, "freshness values must remain versioned defaults");
matches(adr, /Long-lived security\/authorization\/deletion audit duration pending legal\/compliance review/, "audit retention must remain pending");
matches(adr, /Phase 0 defines this boundary only\. It does not implement encryption or object storage\./, "ADR must keep storage outside Phase 0");
matches(adr, /Phase 0 includes no:/, "ADR must make the negative boundary explicit");
matches(adr, /Values outside the supported range fail before canonical hashing or persistence/, "ADR must reject unsupported decimals before hashing");
matches(adr, /CanonicalBusinessFactVersion from V1 to V2/, "ADR must document the fact version correction");
matches(adr, /BusinessStateDelta from V1 to V2/, "ADR must document the delta version correction");

matches(alignment, /UNIQUE \(workspace_id, entity_key\)/, "entity_key must be workspace-unique");
matches(alignment, /numeric column is never the lexical source for a contract or fingerprint/, "canonical decimal strings must remain persistence authority");
matches(alignment, /active, inactive, archived/, "Business Entity status must use the contract vocabulary");
doesNotMatch(
  alignment.match(/## BusinessEntity Field Audit[\s\S]*?## IntegrationConnection Field Audit/)?.[0] ?? "",
  /status[^\n]*deleting|status[^\n]*deleted/,
  "Business Entity status must not be overloaded with erasure states"
);
matches(alignment, /change_kind = 'deleted'.*normalized_projection IS NULL/, "deleted source versions must have null projections");
matches(alignment, /every non-deleted version requires a projection/i, "live source versions must have projections");
matches(alignment, /factKind plus factKey is the sole authoritative/, "factKind plus factKey must be the only canonical identity");
matches(alignment, /exact money, decimal, percentage, integer, boolean, date, text, structured vocabulary/, "fact value vocabulary must be exact");
matches(alignment, /exact valid, invalid vocabulary/, "fact validation vocabulary must be exact");
matches(alignment, /accepted, excluded_duplicate, excluded_authority, conflicted, tombstone vocabulary/, "reconciliation vocabulary must be exact");
matches(alignment, /deterministic_policy requires decision_policy_version/, "deterministic decisions must preserve policy version");
matches(alignment, /customer_authorized_user and operator require decision_actor_id/, "human decisions must preserve actor identity");
doesNotMatch(alignment, /decision_authority[^\n]*(?:ai|model)/i, "AI/model decision authority must not exist");
matches(alignment, /at least one valid same-tenant source edge/, "fact provenance must be nonempty at commit");
matches(alignment, /deferred constraint trigger/, "provenance atomicity must have a deferred invariant");
matches(alignment, /Business Central and NetSuite descriptors can express/, "future provider portability must remain explicit");
matches(alignment, /No migration, database, Supabase change/, "Phase 0.1 must preserve its negative boundary");

equal(
  packageJson.scripts["test:external-integrations-contracts"],
  "node scripts/external-integrations-contract-regression-tests.js",
  "contract test script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-architecture"],
  "node scripts/external-integrations-architecture-regression-tests.js",
  "architecture test script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-2"],
  "node scripts/external-integrations-phase-2-reconciliation-regression-tests.js",
  "Phase 2 reconciliation regression script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-4"],
  "node scripts/external-integrations-phase-4-control-plane-regression-tests.js",
  "Phase 4 control-plane regression script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-5"],
  "node scripts/external-integrations-phase-5-credential-security-regression-tests.js",
  "Phase 5 credential-security regression script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-6"],
  "node scripts/external-integrations-phase-6-durable-runtime-regression-tests.js",
  "Phase 6 durable-runtime regression script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-8a0"],
  "node scripts/external-integrations-phase-8a0-contract-convergence-regression-tests.js",
  "Phase 8A.0 contract-convergence regression script must be registered"
);
equal(
  packageJson.scripts["test:external-integrations-phase-8b"],
  "node scripts/external-integrations-phase-8b-qbo-sandbox-regression-tests.js",
  "Phase 8B QBO sandbox regression script must be registered"
);
matches(
  ciWorkflow,
  /external_integrations_phase_8b_zero_based_delivery_clean\.test\.sql/,
  "CI must exercise the clean zero-based migration path"
);
matches(
  ciWorkflow,
  /external_integrations_phase_8b_credential_binding_canary\.test\.sql/,
  "CI must exercise the credential-binding incident recovery and exact canary path"
);
matches(
  ciWorkflow,
  /external_integrations_phase_8b_credential_lineage_recovery\.test\.sql/,
  "CI must exercise historical/current credential-lineage recovery fencing"
);
matches(
  ciWorkflow,
  /external_integrations_phase_8b_precontract_retirement\.test\.sql/,
  "CI must exercise exact pre-contract task retirement and replacement planning"
);
matches(
  ciWorkflow,
  /external_integrations_phase_8b_provider_result_evidence\.test\.sql/,
  "CI must exercise task-bound provider and parser evidence with exact A/R recovery"
);
matches(
  ciWorkflow,
  /node scripts\/run-phase8b-zero-based-delivery-migration-tests\.js/,
  "CI must exercise the fixture-rich zero-based upgrade path"
);
matches(
  databaseTestRunner,
  /external_integrations_phase_8b_zero_based_delivery_upgrade\.test\.sql/,
  "the fixture-rich suite must retain the hosted/local database role adapter"
);
matches(
  zeroBasedUpgradeRunner,
  /const fixtureBaseVersion = "20260824083917";[\s\S]*const zeroBasedVersion = "20260824193332";[\s\S]*const retryExecutionVersion = "20260824233000";[\s\S]*const recoveryLifecycleVersion = "20260825180000";[\s\S]*const scopedRetryLifecycleVersion = "20260825190000";[\s\S]*const credentialBindingVersion = "20260826043610";[\s\S]*const credentialBindingCanaryVersion = "20260826090000";[\s\S]*const credentialLineageVersion = "20260826120000";[\s\S]*const precontractRetirementVersion = "20260826190801";[\s\S]*const targetVersion = "20260826222000";[\s\S]*"db",[\s\S]*"reset",[\s\S]*"--version",[\s\S]*fixtureBaseVersion/,
  "the fixture-rich runner must reset to the exact pre-migration boundary"
);
matches(
  zeroBasedUpgradeRunner,
  /run\(cli, \["migration", "up", "--local"\]\)/,
  "the fixture-rich runner must apply the ordered zero-based and retry-identity migrations"
);
matches(
  zeroBasedUpgradeRunner,
  /external_integrations_phase_6_durable_runtime\.test\.sql[\s\S]*external_integrations_phase_8b_credential_refresh_recovery\.test\.sql[\s\S]*external_integrations_phase_8b_same_generation_reauthorization\.test\.sql[\s\S]*external_integrations_phase_8b_credential_binding_canary\.test\.sql[\s\S]*external_integrations_phase_8b_credential_lineage_recovery\.test\.sql[\s\S]*external_integrations_phase_8b_precontract_retirement\.test\.sql[\s\S]*external_integrations_phase_8b_provider_result_evidence\.test\.sql/,
  "the fixture-rich runner must prove Phase 6 concurrency, retry compatibility, purchase recovery, and canary isolation together"
);
matches(
  zeroBasedFixture,
  /'sandbox', 'leased', 1[\s\S]*'sandbox', 'leased', 2[\s\S]*'sandbox', 'pending', 3/,
  "the fixture must preserve the exact sandbox 2-leased/1-pending shape"
);
matches(
  zeroBasedFixture,
  /'production', 'leased', 4[\s\S]*'production', 'leased', 5[\s\S]*'production', 'pending', 6/,
  "the fixture must preserve the exact production-labelled 2-leased/1-pending shape"
);

const protectedDiff = childProcess.execFileSync(
  "git",
  ["diff", "--name-only", "origin/main", "--", "app", "components", "supabase", "lib/supabase", "services", "vercel.json"],
  { cwd: root, encoding: "utf8" }
).trim();
const approvedProtectedPaths = new Set([
  "lib/supabase/types.ts",
  "supabase/migrations/20260820233007_external_integrations_phase_1_canonical_foundation.sql",
  "supabase/tests/external_integrations_phase_1_canonical_foundation.test.sql",
  "supabase/migrations/20260821064333_external_integrations_phase_2_reconciliation.sql",
  "supabase/tests/external_integrations_phase_2_reconciliation.test.sql",
  "supabase/migrations/20260821172015_external_integrations_phase_3_deterministic_dependencies.sql",
  "supabase/tests/external_integrations_phase_3_deterministic_dependencies.test.sql",
  "supabase/migrations/20260821201220_external_integrations_phase_4_control_plane.sql",
  "supabase/tests/external_integrations_phase_4_control_plane.test.sql",
  "supabase/migrations/20260821220853_external_integrations_phase_5_credential_security.sql",
  "supabase/tests/external_integrations_phase_5_credential_security.test.sql",
  "supabase/migrations/20260822012253_external_integrations_phase_6_durable_runtime.sql",
  "supabase/tests/external_integrations_phase_6_durable_runtime.test.sql",
  "supabase/migrations/20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql",
  "supabase/tests/external_integrations_phase_8a0_contract_convergence.test.sql",
  "supabase/migrations/20260823042718_external_integrations_phase_8b_qbo_sandbox_validation.sql",
  "supabase/migrations/20260823111004_scope_qbo_sandbox_dispatch_candidates.sql",
  "supabase/migrations/20260823113832_qbo_sandbox_scoped_dispatch_recovery.sql",
  "supabase/migrations/20260823115807_reserve_qbo_sandbox_scoped_dispatch.sql",
  "supabase/migrations/20260823121454_qbo_sandbox_dispatch_run_lock.sql",
  "supabase/migrations/20260823205806_qbo_sandbox_credential_refresh_recovery.sql",
  "supabase/migrations/20260824071101_qbo_sandbox_same_generation_reauthorization.sql",
  "supabase/migrations/20260824083917_qbo_sandbox_expired_refresh_lease_reclamation.sql",
  "supabase/migrations/20260824193332_qbo_cloud_tasks_zero_based_delivery.sql",
  "supabase/migrations/20260824233000_qbo_retry_execution_and_reauthorization_recovery.sql",
  "supabase/migrations/20260825180000_qbo_reauthorization_required_lifecycle.sql",
  "supabase/migrations/20260825190000_qbo_scoped_dispatch_retry_lifecycle.sql",
  "supabase/migrations/20260826043610_qbo_credential_envelope_binding_convergence.sql",
  "supabase/migrations/20260826090000_qbo_credential_envelope_binding_incident_canary.sql",
  "supabase/migrations/20260826120000_qbo_credential_lineage_incident_recovery.sql",
  "supabase/migrations/20260826190801_qbo_precontract_initialization_retirement.sql",
  "supabase/migrations/20260826222000_qbo_provider_result_evidence_and_ar_aging_recovery.sql",
  "supabase/tests/external_integrations_phase_8b_qbo_sandbox_validation.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_refresh_recovery.test.sql",
  "supabase/tests/external_integrations_phase_8b_same_generation_reauthorization.test.sql",
  "supabase/tests/external_integrations_phase_8b_expired_refresh_lease_reclamation.test.sql",
  "supabase/tests/external_integrations_phase_8b_zero_based_delivery_clean.test.sql",
  "supabase/tests/external_integrations_phase_8b_zero_based_delivery_upgrade.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_binding_canary.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_lineage_recovery.test.sql",
  "supabase/tests/external_integrations_phase_8b_precontract_retirement.test.sql",
  "supabase/tests/external_integrations_phase_8b_provider_result_evidence.test.sql",
  "lib/integrations/control-plane/qbo-precontract-retirement.ts",
  "supabase/tests/fixtures/external_integrations_phase_8b_zero_based_legacy.sql",
  "services/external-integrations-qbo-sandbox/Dockerfile",
  "services/external-integrations-qbo-sandbox/package.json",
  "services/external-integrations-qbo-sandbox/edge/callback.go",
  "services/external-integrations-qbo-sandbox/edge/callback_test.go",
  "services/external-integrations-qbo-sandbox/edge/cloudbuild.yaml",
  "services/external-integrations-qbo-sandbox/edge/go.mod",
  "services/external-integrations-qbo-sandbox/edge/go.sum",
  "services/external-integrations-qbo-sandbox/edge/lb-traffic-extension.yaml",
  "services/external-integrations-qbo-sandbox/edge/package/Dockerfile",
  "services/external-integrations-qbo-sandbox/edge/plugin/main.go",
  "services/external-integrations-qbo-sandbox/ops/build-oauth-callback-edge.sh",
  "services/external-integrations-qbo-sandbox/ops/cleanup-oauth-callback-edge.sh",
  "services/external-integrations-qbo-sandbox/ops/provision-oauth-callback-edge.sh",
  "services/external-integrations-qbo-sandbox/ops/provision-qbo-canary.sh",
  "services/external-integrations-qbo-sandbox/ops/verify-oauth-callback-edge.sh",
  "services/external-integrations-qbo-sandbox/src/cloud-task-delivery.ts",
  "services/external-integrations-qbo-sandbox/src/database.ts",
  "services/external-integrations-qbo-sandbox/src/google.ts",
  "services/external-integrations-qbo-sandbox/src/server.ts"
]);
const unexpectedProtectedDiff = protectedDiff
  .split("\n")
  .filter(Boolean)
  .filter((file) => !approvedProtectedPaths.has(file))
  .join("\n");
equal(
  unexpectedProtectedDiff,
  "",
  "Phase 0 through Phase 8B may change only registered migrations, tests, and the isolated QBO sandbox service"
);

const untrackedMigrations = childProcess.execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "supabase/migrations"],
  { cwd: root, encoding: "utf8" }
).trim();
const unexpectedUntrackedMigrations = untrackedMigrations
  .split("\n")
  .filter(Boolean)
  .filter((file) => !approvedProtectedPaths.has(file))
  .join("\n");
equal(
  unexpectedUntrackedMigrations,
  "",
  "only the approved Phase 1 through Phase 8B migrations may extend the Phase 0 baseline"
);

console.log(`External integration Phase 0 architecture regressions: ${assertionCount} assertions passed.`);
