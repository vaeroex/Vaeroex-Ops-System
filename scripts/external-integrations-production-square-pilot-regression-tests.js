const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pilot = path.join(root, "services/external-integrations-production/pilot");
const read = (name) => fs.readFileSync(path.join(pilot, name), "utf8");
const contract = JSON.parse(read("contract.json"));
const baselineSource = read("pilot-state.example.json");
const baseline = JSON.parse(baselineSource);
const model = read("model.mjs");
const tests = read("model.test.mjs");
const qualification = read("qualify.mjs");
const readme = read("README.md");
const handoff = read("PRIVATE-HANDOFF.md");
const nativeQualifier = fs.readFileSync(path.join(root,
  "tools/native-broker-provisioning/tests/production-native-qualify.cjs"), "utf8");
const ciWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const releasePins = fs.readFileSync(path.join(root,
  "services/external-integrations-production/infra/activation/production.tfvars.example"), "utf8");

function releasePin(name) {
  const match = releasePins.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, "m"));
  assert.ok(match, `${name} must have one exact quoted release pin`);
  return match[1];
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, `${command} failed: ${(result.stderr || result.stdout).slice(0, 1_000)}`);
  return result.stdout;
}

function sourceCollectionSha256(repository, commit, sourcePaths) {
  const digest = crypto.createHash("sha256");
  for (const relative of [...sourcePaths].sort()) {
    const result = spawnSync("git", ["-C", repository, "show", `${commit}:${relative}`], {
      encoding: null, env: { PATH: process.env.PATH }
    });
    assert.equal(result.status, 0, `synthetic source fixture is missing ${relative}`);
    const blob = result.stdout;
    digest.update(Buffer.from(`${Buffer.byteLength(relative)}:${relative}:${blob.length}:`, "utf8"));
    digest.update(blob);
  }
  return digest.digest("hex");
}

const productionSourcePins = JSON.parse(run(process.execPath, ["--input-type=module", "--eval",
  `import { productionSourcePins } from ${JSON.stringify(pathToFileURL(path.join(root,
    "tools/native-broker-provisioning/production-profile.mjs")).href)}; process.stdout.write(JSON.stringify(productionSourcePins));`
]));

assert.equal(contract.projectId, "vaeroex-integrations-prod");
assert.equal(contract.hostname, "square.vaeroex.com");
assert.equal(contract.callbackUrl, "https://square.vaeroex.com/api/integrations/square/callback");
assert.equal(contract.webhookUrl, "https://square.vaeroex.com/api/integrations/square/webhook");
assert.equal(contract.database.requiredFoundationVersion, "20260902191323");
assert.equal(contract.database.requiredOverlayVersion, "20260902191324");
assert.equal(contract.database.requiredOverlayPath, "supabase/migrations/20260902191324_square_production_runtime_overlay.sql");
assert.equal(contract.database.requiredOverlaySourceCommit, "aec44f42f216ceeb447b2b909eb2c6c78c02340e");
assert.equal(contract.database.requiredOverlaySha256, "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f");
assert.equal(contract.database.requiredPostflight, "square_production_overlay_structural_and_authorization_postflight_passed");
assert.equal(contract.database.requiredOverlayObjects.relations.length, 4);
assert.equal(contract.database.requiredOverlayObjects.privateFunctions.length, 6);
assert.equal(contract.database.requiredOverlayObjects.triggers.length, 12);
assert.equal(contract.pilotPolicy.maximumAllowlistedWorkspaces, 1);
assert.equal(contract.pilotPolicy.maximumAllowlistedSellers, 1);
assert.equal(contract.pilotPolicy.requiresInternalSeller, true);
assert.equal(contract.pilotPolicy.requiresExplicitBusinessEntityMapping, true);
assert.equal(contract.pilotPolicy.requiresExplicitLocationMapping, true);
assert.equal(contract.pilotPolicy.automaticMapping, false);
assert.equal(contract.pilotPolicy.economicContributionsAllowed, false);
assert.equal(contract.pilotPolicy.aiDispatchAllowed, false);
assert.deepEqual(contract.qualificationBoundary, {
  scope: "sanitized_preflight_only",
  privateMappingVerification: "required_outside_qualifier",
  identifiersAllowedInEvidence: false,
  activationAuthority: "not_granted"
});
assert.deepEqual(baseline.pilotScopeCounts, {
  allowlistEntryCount: 0,
  distinctWorkspaceCount: 0,
  distinctSellerCount: 0
});
assert.equal("pilotAllowlist" in baseline, false);
assert.equal(contract.requiredOperationalChecks.includes("productionWorkspaceReadback"), false);
for (const field of ["workspaceId", "merchantId", "businessEntityId", "locationIds"]) {
  assert.doesNotMatch(baselineSource, new RegExp(`"${field}"`), `${field} is forbidden in sanitized example evidence`);
}
assert.equal(new Set(Object.keys(contract.database.loginBindings)).size, 6);
assert.equal(new Set(Object.values(contract.database.loginBindings)).size, 6);
assert.deepEqual(contract.database.authorityRpcBindings, Object.fromEntries([
  "oauth", "broker", "scheduler", "webhook", "runtime", "evidence"
].map((capability) => [
  `square_production_${capability}_authority`,
  `public.check_square_production_${capability}_authority_v1(text,text,text,bigint,text)`
])));
assert.deepEqual(Object.values(baseline.activationGates), Array(contract.activationGates.length).fill(false));
for (const metadata of Object.values(baseline.credentialVersionsPresent)) {
  assert.deepEqual(metadata, { version: null, state: "ABSENT", totalCount: 0 });
}
assert.equal(baseline.database.overlaySha256, null);
assert.equal(baseline.database.overlaySourceCommit, null);
assert.deepEqual(baseline.productionReleaseDeployment, {
  sharedBootstrapSourceCommit: null,
  sharedBootstrapImageDigest: null,
  callbackEdgeSourceCommit: null,
  callbackEdgeImageDigest: null,
  oauthCallbackSourceCommit: null,
  oauthCallbackImageDigest: null
});
assert.deepEqual(Object.values(baseline.productionReleaseDeployment), Array(6).fill(null),
  "the checked-in example remains blocked without deployed release readbacks");
assert.deepEqual(contract.reviewedProductionRelease, {
  sharedBootstrapSourceCommit: "f4915edadbe2abddd7993c74c1fc3e80e1d1f821",
  sharedBootstrapImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:d56fe933eab1322bb4fe905b183964a980d641af23d69904e15989add501dc6f",
  oauthCallbackSourceCommit: "45cc2193dd87270ef413f2e21c65cf3b05c1c255",
  oauthCallbackImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:ebd5e50ab854ca3de3f49ee51ea8fbef0dfa5510b74c19b0ec6e9c367fffeddf",
  callbackEdgeSourceCommit: "45cc2193dd87270ef413f2e21c65cf3b05c1c255",
  callbackEdgeImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:0a841f23b5a45edbbdca61ab4a8a5c2391a377cef1f5a5c00e113db1a33c5bf9"
});
assert.deepEqual(contract.expectedReleasePairChanges, {
  sharedBootstrap: false,
  oauthCallback: true,
  callbackEdge: true
});
assert.deepEqual({
  sharedBootstrapSourceCommit: releasePin("source_commit"),
  sharedBootstrapImageDigest: releasePin("bootstrap_image_digest"),
  oauthCallbackSourceCommit: releasePin("oauth_callback_source_commit"),
  oauthCallbackImageDigest: releasePin("oauth_callback_image_digest"),
  callbackEdgeSourceCommit: releasePin("callback_edge_source_commit"),
  callbackEdgeImageDigest: releasePin("callback_edge_image_digest")
}, contract.reviewedProductionRelease,
"the reviewed pilot contract and Terraform release inputs pin the same six deployed identities");
for (const [pair, [sourceField, digestField]] of Object.entries({
  sharedBootstrap: ["sharedBootstrapSourceCommit", "sharedBootstrapImageDigest"],
  oauthCallback: ["oauthCallbackSourceCommit", "oauthCallbackImageDigest"],
  callbackEdge: ["callbackEdgeSourceCommit", "callbackEdgeImageDigest"]
})) {
  const changed = contract.reviewedProductionRelease[sourceField] !== contract.priorProductionRelease[sourceField]
    && contract.reviewedProductionRelease[digestField] !== contract.priorProductionRelease[digestField];
  const unchanged = contract.reviewedProductionRelease[sourceField] === contract.priorProductionRelease[sourceField]
    && contract.reviewedProductionRelease[digestField] === contract.priorProductionRelease[digestField];
  assert.equal(contract.expectedReleasePairChanges[pair] ? changed : unchanged, true,
    `${pair} changes both source and digest together exactly as reviewed`);
}
assert.equal(contract.priorProductionRelease.sharedBootstrapSourceCommit, "f4915edadbe2abddd7993c74c1fc3e80e1d1f821");
assert.equal(contract.priorProductionRelease.oauthCallbackSourceCommit, "f4915edadbe2abddd7993c74c1fc3e80e1d1f821");
assert.equal(contract.priorProductionRelease.callbackEdgeSourceCommit, "bb4ad8d3653ca0eecdada88eeeea8a86fa76fc81");

assert.deepEqual(Object.keys(contract.qualificationPhases), [
  "precredential_nonsecret", "internal_consent_ready", "internal_manual_sync_complete",
  "post_initial_lifecycle", "external_customer_blocked"
]);
assert.deepEqual(contract.qualificationPhases.precredential_nonsecret.enabledCredentialSlots, []);
assert.deepEqual(contract.qualificationPhases.precredential_nonsecret.absentCredentialSlots, contract.credentialSlots);
assert.equal(contract.qualificationPhases.precredential_nonsecret.requiresProductionRuntime, true,
  "private credential entry waits for every nonsecret runtime prerequisite");
assert.deepEqual(contract.qualificationPhases.internal_consent_ready.absentCredentialSlots,
  ["webhookSignature", "databaseScheduler", "databaseWebhook", "databaseRuntime", "databaseEvidence"]);
assert.equal(contract.qualificationPhases.internal_consent_ready.requiredOperationalChecks.includes("credentialRefreshAlert"), false);
assert.equal(contract.qualificationPhases.internal_consent_ready.requiredOperationalChecks.includes("signatureFailureAlert"), false);
assert.equal(contract.qualificationPhases.post_initial_lifecycle.enabledCredentialSlots.includes("webhookSignature"), true);
assert.equal(contract.qualificationPhases.post_initial_lifecycle.requiredOperationalChecks.includes("credentialRefreshAlert"), true);
assert.equal(contract.qualificationPhases.post_initial_lifecycle.requiredOperationalChecks.includes("signatureFailureAlert"), true);
assert.equal(contract.qualificationPhases.post_initial_lifecycle.fixedBlocker,
  "post_initial_lifecycle_runtime_not_implemented");
for (const phase of ["precredential_nonsecret", "internal_consent_ready", "internal_manual_sync_complete", "post_initial_lifecycle"]) {
  assert.equal(contract.qualificationPhases[phase].requiredDatabaseRolePostflight,
    "square_production_native_all_profiles_fenced_assertion");
}
assert.equal(contract.productionRuntimeSurface.runtimeContract.status, "pending_reviewed_runtime_migration");
for (const field of ["sourceCommit", "sourcePath", "migrationCount", "ledgerHead", "ledgerFingerprint", "migrationSourceSha256"]) {
  assert.equal(contract.productionRuntimeSurface.runtimeContract[field], null);
}
assert.deepEqual(contract.productionRuntimeSurface.runtimeContract.authorityRpcs, []);
assert.deepEqual(contract.productionRuntimeSurface.runtimeContract.requiredFunctions, []);
assert.equal(contract.productionNativeProvisioning.status, "reviewed_source_pending_execution_environment");
assert.equal(contract.productionNativeProvisioning.sourceCommit, "0efed0c395335b74af480fcc367ecdf5e0694f23");
assert.equal(contract.productionNativeProvisioning.sourceSha256,
  "09fcf252cf11eb733505664a6ea55ab2d1df1bc4e1eafc9de7d618d280f6801b");
assert.ok(contract.productionNativeProvisioning.sourcePaths.includes(
  "tools/native-broker-provisioning/tests/production-concurrency.cjs"));
assert.equal(contract.productionRuntimeSurface.baselineMigrationCount, 103);
assert.equal(contract.productionRuntimeSurface.baselineHead, contract.database.requiredOverlayVersion);
assert.match(contract.productionRuntimeSurface.baselineMigrationSourceSha256, /^[a-f0-9]{64}$/);
assert.deepEqual(contract.productionRuntimeSurface.baselineBlockingPredicates, [
  "customer_onboarding_enabled_constrained_false", "oauth_requires_customer_onboarding_enabled",
  "provider_calls_enabled_constrained_false", "runtime_enabled_constrained_false"
]);
assert.deepEqual(contract.productionRuntimeSurface.baselineAuthorityRpcs,
  Object.entries(contract.database.authorityRpcBindings).map(([role, signature]) => `${role}=${signature}`).sort());
assert.equal(productionSourcePins.overlayVersion, contract.database.requiredOverlayVersion);
assert.equal(productionSourcePins.overlayMigrationCount, contract.productionRuntimeSurface.baselineMigrationCount);
assert.equal(productionSourcePins.overlaySha256, contract.database.requiredOverlaySha256);
assert.equal(productionSourcePins.internalRuntimeVersion, "20260902191325");
assert.equal(productionSourcePins.internalRuntimeMigrationCount, 104);
assert.equal(productionSourcePins.internalRuntimeLedgerFingerprint,
  "sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f");
assert.equal(productionSourcePins.internalRuntimeSha256,
  "ff2182044f28d6901f1582db3d31ef20d027a1e4590f0b295a7a64a1ad4c1325");
assert.match(ciWorkflow,
  /VAEROEX_NATIVE_TEST_DEPENDENCIES="\$native_manifest" node tools\/native-broker-provisioning\/tests\/production-native-qualify\.cjs/);
assert.match(ciWorkflow,
  /VAEROEX_NATIVE_TEST_DEPENDENCIES="\$native_manifest" pnpm test:native-broker-production-catalog/);
assert.match(nativeQualifier, /require\("\.\/production-concurrency\.cjs"\)/,
  "the exact native qualification includes the final ACL-race regression");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root,
  contract.database.requiredOverlayPath))).digest("hex"), contract.database.requiredOverlaySha256,
"phase qualification cannot alter the reviewed overlay bytes");

for (const scenario of contract.requiredSyntheticScenarios) {
  assert.ok(tests.includes(scenario), `${scenario} has focused coverage`);
}
for (const action of contract.prohibitedActions) assert.ok(contract.prohibitedActions.includes(action));
assert.match(model, /credential material is forbidden/);
assert.match(model, /private mapping identifiers are forbidden in sanitized pilot evidence/);
assert.match(model, /exactly_one_allowlist_entry_required/);
assert.match(model, /exactly_one_workspace_required/);
assert.match(model, /exactly_one_seller_required/);
assert.match(model, /gate_must_remain_closed/);
assert.match(qualification, /never contacts Production/);
assert.match(qualification, /createHash\("sha256"\)/);
assert.match(qualification, /gitOutput\(\["show"/);
assert.match(qualification, /gitOutput\(\["ls-tree"/,
  "the runtime surface is derived from the immutable expected head, not unchecked working files");
assert.doesNotMatch(qualification, /readdirSync\(migrationDirectory\)/);
assert.match(model, /production_source_pins_not_exact/);
assert.match(model, /production_runtime_source_integrity_not_exact/);
assert.match(model, /reviewed_runtime_source_not_in_qualification_head/);
assert.match(model, /external_customer_activation_forbidden/);
assert.match(model, /beginAuthorization\(/);
assert.match(model, /completeAuthorization\(/);
assert.doesNotMatch(model, /\bauthorize\(\)\s*\{/,
  "authorization must complete only through the bounded pending-state flow");
assert.match(model, /authorization state was already used or fenced/);
assert.match(model, /readEvidence\(/);
assert.match(tests, /evidence authority returns only sanitized mapped-generation counts/);
assert.match(tests, /authorization completion is current-generation-bound/);
assert.match(tests, /reuses the merged native production source pins/);
assert.match(qualification, /merge-base", "--is-ancestor"/);
assert.match(qualification, /runtimeSourceIncluded/);
assert.match(qualification, /qualificationSourceHead/);
assert.match(qualification, /qualificationSourcesExact/);
assert.match(qualification, /status", "--porcelain=v1"/);
assert.match(qualification, /pilot qualification input rejected/);
assert.doesNotMatch(readme, /6b5ccc4513150312e5c3a1dbcce81fab111571e7/,
  "the handoff command must resolve the exact current qualification head instead of a stale base");

assert.equal(fs.existsSync(path.join(pilot, "verify-database.sql")), false,
  "the pilot package must reuse the merged native/catalog contract instead of maintaining a duplicate SQL attestor");

assert.equal(fs.existsSync(path.join(pilot, "stage-provider-secret.sh")), false,
  "local gcloud secret staging is forbidden; credentials use the provider-controlled private console procedure");

for (const document of [readme, handoff]) {
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/callback/);
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/webhook/);
}
assert.match(handoff, /only the minimum separately approved read-only\s+pilot gates/);
assert.match(handoff, /Do not enable\s+a second\s+customer, economics, Vaeroex dispatch, QBO changes or additional\s+infrastructure/);
assert.match(readme, /aggregate counts[\s\S]*do not prove[\s\S]*exact business[\s\S]*entity and location mapping/);
assert.match(readme, /qualifier rejects identifier fields and mapping\s+booleans/);
assert.match(readme, /privateMappingVerification:[\s\S]*required_outside_qualifier/);
assert.match(readme, /activationAuthority:[\s\S]*not_granted/);
assert.match(handoff, /Those counts\s+do not prove the mapping/);
assert.match(handoff, /Neither record substitutes for the other/);
assert.match(readme, /pins the exact\s+six-profile source at `0efed0c395335b74af480fcc367ecdf5e0694f23`[\s\S]*deployment-identity\s+manifest remains pending/);
assert.match(readme, /callback-only Terraform plan[\s\S]*no create, destroy or replacement action[\s\S]*no IAM, peer-service,\s+routing or gate change/);
assert.doesNotMatch(readme, /only the three reviewed in-place updates/,
  "the operator sequence cannot reuse a prior callback plan's update count");
assert.match(readme, /authoritative database source and catalog checks are the merged[\s\S]*`productionSourcePins`[\s\S]*`production-native-qualify\.cjs`[\s\S]*`production-catalog-qualify\.cjs`/);
assert.match(readme, /`20260902191325` is now delivered[\s\S]*remains unapplied[\s\S]*not activation evidence/);
assert.match(readme, /Do not apply `20260902191325` merely because its source is merged[\s\S]*exactly 103 entries[\s\S]*separate bounded authorization/);
assert.match(handoff, /`20260902191325` is source-controlled[\s\S]*remains unapplied[\s\S]*do not authorize applying it or creating LOGINs/);
assert.match(readme, /all six profiles must be fenced `NOLOGIN NOINHERIT`/);
assert.match(readme, /CI\/source qualification remains nonauthorizing/);
assert.match(readme, /fixed six-profile Production extension of\s+`tools\/native-broker-provisioning`/);
assert.match(readme, /dedicated private Production\s+execution environment and identity/);
assert.match(readme, /Sandbox VM\/service\s+account must not be repurposed/);
assert.match(readme, /plaintext textarea or unverified masking is not a no-echo path/i);
assert.match(readme, /consumeState` returns `null`/);
assert.match(readme, /lifecycle model tests[\s\S]*synthetic contract checks only/);
assert.match(readme, /executable Production binding\/runtime[\s\S]*fixed native provisioner/);
assert.match(handoff, /plaintext textarea or unverified\s+masking is not a no-echo path/i);
assert.match(handoff, /six-LOGIN native-SCRAM blocker or executable Production\s+binding\/runtime blocker is unresolved[\s\S]*must not begin/);
assert.match(handoff, /Do not enter the webhook signature under this package/);
for (const document of [readme, handoff]) {
  assert.match(document, /isaac@vaeroex\.com/);
  assert.match(document, /square-production-application/);
  assert.match(document, /square-production-webhook-signature/);
  assert.match(document, /version `?1`?/i);
  assert.match(document, /metadata-only/i);
  assert.match(document, /do\s+not retry/i);
  assert.doesNotMatch(document, /stage-provider-secret\.sh|gcloud\s/i);
}
assert.equal(fs.readdirSync(pilot).filter((name) => /handoff/i.test(name)).length, 1,
  "personal actions remain in one consolidated handoff");

run(process.execPath, ["--test", path.join(pilot, "model.test.mjs")]);
const blockedOutput = run(process.execPath, [
  path.join(pilot, "qualify.mjs"),
  "--evidence", path.join(pilot, "pilot-state.example.json"),
  "--expect-head", baseline.sourceCommit,
  "--phase", "precredential_nonsecret",
  "--expect-blocked"
]);
const blocked = JSON.parse(blockedOutput);
assert.equal(blocked.qualificationScope, "sanitized_preflight_only");
assert.equal(blocked.activationReadiness, false);
assert.equal(blocked.hostedQualificationProven, false);
assert.equal(blocked.privateMappingVerification, "required_outside_qualifier");
assert.equal(blocked.activationAuthority, "not_granted");
assert.equal(blocked.gatesRemainClosed, true);
assert.ok(blocked.findings.includes("database_ledger_not_exact_phase"));
assert.ok(blocked.findings.includes("qualification_source_head_mismatch"));
assert.ok(blocked.findings.includes("qualification_sources_not_exact_head"));
assert.ok(blocked.findings.includes("square_overlay_sha256_mismatch"));
assert.ok(blocked.findings.includes("reviewed_overlay_source_not_in_qualification_head"));
assert.ok(blocked.findings.includes("square_overlay_source_commit_mismatch"));
assert.ok(blocked.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
assert.ok(blocked.findings.includes("production_release_deployment_mismatch:sharedBootstrapSourceCommit"));

const currentHead = run("git", ["rev-parse", "HEAD"]).trim();
const currentEvidenceFixture = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-pilot-current-overlay-"));
try {
  const currentEvidence = structuredClone(baseline);
  currentEvidence.sourceCommit = currentHead;
  currentEvidence.database = {
    ledgerHead: contract.productionRuntimeSurface.baselineHead,
    foundationVersion: contract.database.requiredFoundationVersion,
    overlayPath: contract.database.requiredOverlayPath,
    overlaySourceCommit: contract.database.requiredOverlaySourceCommit,
    overlaySha256: contract.database.requiredOverlaySha256,
    overlayObjectPostflight: contract.database.requiredPostflight,
    rolePostflight: contract.qualificationPhases.internal_consent_ready.requiredDatabaseRolePostflight
  };
  currentEvidence.productionReleaseDeployment = structuredClone(contract.reviewedProductionRelease);
  const currentEvidencePath = path.join(currentEvidenceFixture, "current-overlay.json");
  fs.writeFileSync(currentEvidencePath, JSON.stringify(currentEvidence));
  const internalBlocked = JSON.parse(run(process.execPath, [
    path.join(pilot, "qualify.mjs"),
    "--evidence", currentEvidencePath,
    "--expect-head", currentHead,
    "--phase", "internal_consent_ready",
    "--expect-blocked"
  ]));
  assert.equal(internalBlocked.targetPhase, "internal_consent_ready");
  assert.ok(internalBlocked.findings.includes("production_runtime_authority_contract_not_reviewed"));
  assert.ok(internalBlocked.findings.includes("production_runtime_internal_pilot_permit_missing"));
  assert.equal(internalBlocked.findings.includes("database_ledger_not_exact_phase"), false,
    "the pending runtime keeps the exact overlay as the expected ledger head");
  assert.equal(internalBlocked.findings.includes("production_runtime_source_integrity_not_exact"), false,
    "a pending runtime cannot create a false reviewed-source mismatch");
  assert.equal(internalBlocked.findings.includes("production_runtime_baseline_surface_not_exact"), false,
    "the exact 103-migration overlay baseline remains independently pinned");
  assert.equal(internalBlocked.findings.includes("production_source_pins_not_exact"), false,
    "future planning pins are not compared to a pending null runtime contract");
  assert.equal(internalBlocked.findings.some((finding) => finding.startsWith("production_runtime_function_missing:")), false,
    "the baseline verifier must not pretend that an unreviewed future runtime migration is absent from its own cut-off");
  assert.ok(internalBlocked.findings.includes("production_native_provisioning_profile_not_reviewed"));
} finally {
  fs.rmSync(currentEvidenceFixture, { recursive: true, force: true });
}

// Malformed or closed-contract evidence must fail with one fixed label. Neither
// parser/assertion details nor private-looking canaries may reach stdout/stderr.
const rejectionFixture = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-pilot-rejected-evidence-"));
try {
  const canary = "RAW_IDENTIFIER_CANARY_MUST_NOT_APPEAR";
  const qualifyEvidence = (name, contents) => {
    const evidencePath = path.join(rejectionFixture, name);
    fs.writeFileSync(evidencePath, contents);
    return spawnSync(process.execPath, [
      path.join(pilot, "qualify.mjs"), "--evidence", evidencePath,
      "--expect-head", baseline.sourceCommit, "--phase", "precredential_nonsecret", "--expect-blocked"
    ], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  };
  const unknown = structuredClone(baseline);
  unknown[canary] = true;
  const rawIdentifierCases = ["workspaceId", "merchantId", "businessEntityId", "locationIds"].map((field) => {
    const evidence = structuredClone(baseline);
    evidence.pilotScopeCounts[field] = field === "locationIds" ? [canary] : canary;
    return [`raw-${field}.json`, JSON.stringify(evidence)];
  });
  const mappingClaimCases = ["mappingConfirmed", "internalSeller"].map((field) => {
    const evidence = structuredClone(baseline);
    evidence.pilotScopeCounts[field] = true;
    return [`mapping-${field}.json`, JSON.stringify(evidence)];
  });
  for (const [name, contents] of [
    ["malformed.json", `{"value":"${canary}"`],
    ["unknown.json", JSON.stringify(unknown)],
    ...rawIdentifierCases,
    ...mappingClaimCases
  ]) {
    const rejected = qualifyEvidence(name, contents);
    assert.notEqual(rejected.status, 0, `${name} must be rejected`);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "pilot qualification input rejected\n");
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, new RegExp(canary));
  }

  const invalidSource = structuredClone(baseline);
  invalidSource.sourceCommit = canary;
  const sanitized = qualifyEvidence("invalid-source.json", JSON.stringify(invalidSource));
  assert.equal(sanitized.status, 0);
  assert.equal(sanitized.stderr, "");
  assert.doesNotMatch(sanitized.stdout, new RegExp(canary));
  const sanitizedResult = JSON.parse(sanitized.stdout);
  assert.equal(sanitizedResult.sourceCommit, baseline.sourceCommit);
  assert.ok(sanitizedResult.findings.includes("source_commit_mismatch"));
} finally {
  fs.rmSync(rejectionFixture, { recursive: true, force: true });
}

// Exercise the actual CLI in a synthetic repository. A dirty qualifier or the
// native source-pin modules cannot be treated as exact immutable evidence.
const sourceFixture = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-pilot-source-pin-"));
try {
  const relativePilot = "services/external-integrations-production/pilot";
  const fixturePilot = path.join(sourceFixture, relativePilot);
  fs.mkdirSync(fixturePilot, { recursive: true });
  for (const name of ["contract.json", "model.mjs", "qualify.mjs", "pilot-state.example.json"]) {
    fs.copyFileSync(path.join(pilot, name), path.join(fixturePilot, name));
  }
  for (const relative of contract.productionNativeProvisioning.sourcePaths) {
    const destination = path.join(sourceFixture, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
  }
  const fixtureGit = (...args) => run("git", ["-C", sourceFixture,
    "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
    "-c", "user.name=Local synthetic fixture", "-c", "user.email=fixture@example.invalid", ...args]);
  fixtureGit("init", "--quiet");
  fixtureGit("add", ".");
  fixtureGit("commit", "--quiet", "-m", "Synthetic reviewed native source");
  const reviewedNativeHead = fixtureGit("rev-parse", "HEAD").trim();
  const fixtureContractPath = path.join(fixturePilot, "contract.json");
  const fixtureContract = JSON.parse(fs.readFileSync(fixtureContractPath, "utf8"));
  fixtureContract.productionNativeProvisioning.sourceCommit = reviewedNativeHead;
  fixtureContract.productionNativeProvisioning.sourceSha256 = sourceCollectionSha256(sourceFixture,
    reviewedNativeHead, fixtureContract.productionNativeProvisioning.sourcePaths);
  fs.writeFileSync(fixtureContractPath, `${JSON.stringify(fixtureContract, null, 2)}\n`);
  fixtureGit("add", `${relativePilot}/contract.json`);
  fixtureGit("commit", "--quiet", "-m", "Pin synthetic reviewed native source");
  let fixtureHead = fixtureGit("rev-parse", "HEAD").trim();
  const qualifyFixture = () => JSON.parse(run(process.execPath, [
    path.join(fixturePilot, "qualify.mjs"), "--expect-head", fixtureHead,
    "--evidence", path.join(fixturePilot, "pilot-state.example.json"),
    "--phase", "precredential_nonsecret", "--expect-blocked"
  ]));
  const pinnedNative = qualifyFixture();
  assert.equal(pinnedNative.findings.includes("qualification_sources_not_exact_head"), false);
  assert.equal(pinnedNative.findings.includes("production_native_provisioning_source_not_exact"), false);
  assert.equal(pinnedNative.findings.includes("production_native_provisioning_source_sha256_mismatch"), false);
  fs.appendFileSync(path.join(fixturePilot, "qualify.mjs"), "\n// synthetic unreviewed qualifier change\n");
  assert.ok(qualifyFixture().findings.includes("qualification_sources_not_exact_head"),
    "a dirty offline qualifier is rejected without minting hosted proof");
  fs.copyFileSync(path.join(pilot, "qualify.mjs"), path.join(fixturePilot, "qualify.mjs"));

  const driftedNativePath = path.join(sourceFixture, "tools/native-broker-provisioning/native.c");
  fs.appendFileSync(driftedNativePath, "\n/* synthetic descendant drift */\n");
  fixtureGit("add", "tools/native-broker-provisioning/native.c");
  fixtureGit("commit", "--quiet", "-m", "Drift one reviewed native source path");
  fixtureHead = fixtureGit("rev-parse", "HEAD").trim();
  const driftedNative = qualifyFixture();
  assert.equal(driftedNative.findings.includes("qualification_sources_not_exact_head"), false,
    "the descendant still contains the exact qualifier source");
  assert.ok(driftedNative.findings.includes("production_native_provisioning_source_not_exact"),
    "an ancestor pin cannot authorize changed native bytes at the qualification head");
  assert.ok(driftedNative.findings.includes("production_native_provisioning_source_sha256_mismatch"),
    "the measured native source digest must describe the qualification head");
} finally {
  fs.rmSync(sourceFixture, { recursive: true, force: true });
}

console.log("Production Square pilot package regression tests passed");
