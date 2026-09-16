import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSyntheticPilot, loadJson, qualifyPilotEvidence } from "./model.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const contract = loadJson(path.join(directory, "contract.json"));
const baseline = loadJson(path.join(directory, "pilot-state.example.json"));
const head = baseline.sourceCommit;
const overlaySourceCommit = "3".repeat(40);
const overlaySha256 = "a".repeat(64);
const sharedBootstrapSourceCommit = "9".repeat(40);
const sharedBootstrapImageDigest = `us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:${"8".repeat(64)}`;
const callbackEdgeSourceCommit = "b".repeat(40);
const callbackEdgeImageDigest = `us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:${"c".repeat(64)}`;
const oauthCallbackSourceCommit = "e".repeat(40);
const oauthCallbackImageDigest = `us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:${"d".repeat(64)}`;

function mapInternalPilot(pilot, expectedGeneration) {
  pilot.confirmMapping({
    expectedGeneration,
    workspaceId: pilot.state.workspaceId,
    businessEntityId: pilot.state.businessEntityId,
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_INTERNAL_1"]
  });
}

const observation = (providerId, sourceVersion, extra = {}) => ({
  resourceFamily: "payments",
  operation: "payments/list_payments",
  authorityScope: "internal",
  providerId,
  sourceVersion,
  ...extra
});

let authorizationStateSequence = 0;
function completeFreshAuthorization(pilot, now = 0) {
  const expectedGeneration = pilot.state.generation;
  const opaqueState = `AUTHORIZATION_STATE_${++authorizationStateSequence}`;
  pilot.beginAuthorization({ expectedGeneration, opaqueState, now, expiresAt: now + 60_000 });
  return pilot.completeAuthorization({ expectedGeneration, opaqueState, now: now + 1 });
}

function fullFinalAuthoritySurface(runtimeAuthorityRpcs) {
  return [...runtimeAuthorityRpcs].sort();
}

function fullFinalFunctionSurface(runtimeRequiredFunctions) {
  return [
    ...contract.productionRuntimeSurface.runtimeContract.catalogPostflight.requiredFunctions
      .filter((signature) => !contract.productionRuntimeSurface.runtimeContract.requiredFunctions.includes(signature)),
    ...runtimeRequiredFunctions
  ].sort();
}

function reviewedContract() {
  const reviewed = structuredClone(contract);
  reviewed.database.requiredOverlaySourceCommit = overlaySourceCommit;
  reviewed.database.requiredOverlaySha256 = overlaySha256;
  reviewed.reviewedProductionRelease = {
    sharedBootstrapSourceCommit, sharedBootstrapImageDigest,
    callbackEdgeSourceCommit, callbackEdgeImageDigest,
    oauthCallbackSourceCommit, oauthCallbackImageDigest
  };
  reviewed.priorProductionRelease = {
    sharedBootstrapSourceCommit, sharedBootstrapImageDigest,
    callbackEdgeSourceCommit: "1".repeat(40),
    callbackEdgeImageDigest: `us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:${"1".repeat(64)}`,
    oauthCallbackSourceCommit: "2".repeat(40),
    oauthCallbackImageDigest: `us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:${"2".repeat(64)}`
  };
  return reviewed;
}

function reviewCandidate(phaseName = "internal_consent_ready") {
  const evidence = structuredClone(baseline);
  const phase = contract.qualificationPhases[phaseName];
  evidence.database.ledgerHead = contract.database.requiredOverlayVersion;
  evidence.database.overlayPath = contract.database.requiredOverlayPath;
  evidence.database.overlaySourceCommit = overlaySourceCommit;
  evidence.database.overlaySha256 = overlaySha256;
  evidence.database.overlayObjectPostflight = contract.database.requiredPostflight;
  evidence.database.rolePostflight = phase.requiredDatabaseRolePostflight;
  evidence.productionReleaseDeployment = {
    sharedBootstrapSourceCommit, sharedBootstrapImageDigest,
    callbackEdgeSourceCommit, callbackEdgeImageDigest,
    oauthCallbackSourceCommit, oauthCallbackImageDigest
  };
  for (const slot of phase.enabledCredentialSlots) {
    evidence.credentialVersionsPresent[slot] = { version: 1, state: "ENABLED", totalCount: 1 };
  }
  const scopeCount = phase.requiresPilotScope ? 1 : 0;
  evidence.pilotScopeCounts = { allowlistEntryCount: scopeCount, distinctWorkspaceCount: scopeCount, distinctSellerCount: scopeCount };
  phase.requiredPhaseReceipts.forEach((receipt, index) => {
    evidence.phaseReceipts[receipt] = {
      marker: contract.phaseReceiptMarkers[receipt],
      fingerprint: `sha256:${(index + 1).toString(16).padStart(64, "0")}`
    };
  });
  for (const check of phase.requiredOperationalChecks) evidence.operationalChecks[check] = true;
  return evidence;
}

const reviewedSource = {
  qualificationSourcesExact: true,
  sourceCommitsIncluded: {
    sharedBootstrapSourceCommit: true,
    callbackEdgeSourceCommit: true,
    oauthCallbackSourceCommit: true
  },
  overlaySourceIncluded: true,
  sourceCommit: head,
  sourceOverlaySha256: overlaySha256,
  productionRuntimeBaselineSurface: {
    migrationCount: contract.productionRuntimeSurface.baselineMigrationCount,
    ledgerHead: contract.productionRuntimeSurface.baselineHead,
    sourceSha256: contract.productionRuntimeSurface.baselineMigrationSourceSha256,
    authorityRpcs: contract.productionRuntimeSurface.baselineAuthorityRpcs,
    blockingPredicates: contract.productionRuntimeSurface.baselineBlockingPredicates,
    definedFunctions: [],
    runtimeAuthorityRpcs: []
  },
  productionRuntimeSurface: {
    migrationCount: contract.productionRuntimeSurface.baselineMigrationCount,
    ledgerHead: contract.productionRuntimeSurface.baselineHead,
    sourceSha256: contract.productionRuntimeSurface.baselineMigrationSourceSha256,
    authorityRpcs: contract.productionRuntimeSurface.baselineAuthorityRpcs,
    blockingPredicates: contract.productionRuntimeSurface.baselineBlockingPredicates,
    definedFunctions: [],
    runtimeAuthorityRpcs: []
  },
  productionNativeProvisioning: {
    sourceExact: false, sourceCommit: null, sourceSha256: null, deploymentIdentityManifestSha256: null
  },
  productionRuntimeCatalogPostflight: null
};

const currentRuntimeSource = {
  ...reviewedSource,
  productionRuntimeBaselineSurface: { ...reviewedSource.productionRuntimeBaselineSurface, sourceSha256: "0".repeat(64) }
};

function internallyConsistentButUnattestedContract() {
  const reviewed = reviewedContract();
  const authorityRpcs = [...contract.productionRuntimeSurface.runtimeContract.authorityRpcs];
  const requiredFunctions = [...contract.productionRuntimeSurface.runtimeContract.requiredFunctions];
  reviewed.productionRuntimeSurface.runtimeContract = {
    status: "reviewed_runtime_migration",
    sourceCommit: "2".repeat(40),
    sourcePath: "supabase/migrations/synthetic-runtime.sql",
    migrationCount: 104,
    ledgerHead: "20260902191325",
    ledgerFingerprint: `sha256:${"3".repeat(64)}`,
    migrationSourceSha256: "4".repeat(64),
    authorityRpcs,
    requiredFunctions,
    catalogPostflight: {
      marker: "square_production_internal_pilot_catalog_postflight_passed",
      ledgerHead: "20260902191325",
      ledgerFingerprint: `sha256:${"3".repeat(64)}`,
      migrationSourceSha256: "4".repeat(64),
      authorityRpcs: fullFinalAuthoritySurface(authorityRpcs),
      requiredFunctions: fullFinalFunctionSurface(requiredFunctions)
    }
  };
  reviewed.productionNativeProvisioning = {
    status: "reviewed_production_native_profiles",
    sourceCommit: "5".repeat(40),
    sourceSha256: "6".repeat(64),
    sourcePaths: ["tools/native-broker-provisioning/production-profile.mjs"],
    profileNames: Object.keys(contract.database.loginBindings).sort(),
    deploymentIdentityManifestSha256: "7".repeat(64)
  };
  return reviewed;
}

function internallyConsistentButUnattestedSource() {
  const reviewed = internallyConsistentButUnattestedContract();
  const authorityRpcs = [...reviewed.productionRuntimeSurface.runtimeContract.authorityRpcs];
  return {
    ...reviewedSource,
    productionRuntimeSurface: {
      migrationCount: reviewed.productionRuntimeSurface.runtimeContract.migrationCount,
      ledgerHead: reviewed.productionRuntimeSurface.runtimeContract.ledgerHead,
      ledgerFingerprint: reviewed.productionRuntimeSurface.runtimeContract.ledgerFingerprint,
      sourceSha256: reviewed.productionRuntimeSurface.runtimeContract.migrationSourceSha256,
      authorityRpcs,
      blockingPredicates: contract.productionRuntimeSurface.baselineBlockingPredicates,
      definedFunctions: reviewed.productionRuntimeSurface.runtimeContract.requiredFunctions,
      runtimeAuthorityRpcs: authorityRpcs
    },
    productionNativeProvisioning: {
      sourceExact: true,
      sourceCommit: reviewed.productionNativeProvisioning.sourceCommit,
      sourceSha256: reviewed.productionNativeProvisioning.sourceSha256,
      deploymentIdentityManifestSha256: reviewed.productionNativeProvisioning.deploymentIdentityManifestSha256
    },
    productionRuntimeCatalogPostflight: reviewed.productionRuntimeSurface.runtimeContract.catalogPostflight
  };
}

// Focused scenarios: initialSync, incrementalSync, pagination, replay, refresh,
// webhookDeduplication, disconnect, providerRevocation, cancellation, timeout,
// lostAcknowledgement, generationFencing, atomicPageValidation,
// canonicalSourceVersion.

test("the checked-in Production baseline is closed and accurately blocked", () => {
  const result = qualifyPilotEvidence(contract, baseline, head);
  assert.equal(result.activationReadiness, false);
  assert.equal(result.gatesRemainClosed, true);
  assert.ok(result.findings.includes("database_ledger_not_exact_phase"));
  assert.ok(result.findings.includes("qualification_source_head_mismatch"));
  assert.ok(result.findings.includes("square_overlay_path_mismatch"));
  assert.ok(result.findings.includes("reviewed_overlay_source_not_in_qualification_head"));
  assert.ok(result.findings.includes("square_overlay_source_commit_mismatch"));
  assert.ok(result.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
  assert.ok(result.findings.includes("square_overlay_sha256_mismatch"));
  assert.ok(result.findings.includes("database_overlay_object_postflight_missing"));
  assert.ok(result.findings.includes("production_release_deployment_mismatch:sharedBootstrapSourceCommit"));
  assert.equal(result.targetPhase, "precredential_nonsecret");
  assert.equal(result.findings.some((finding) => finding.includes("exactly_one_allowlist") || finding.includes("exactly_one_workspace") || finding.includes("exactly_one_seller")), false,
    "the pilot scope stays empty before private selection");
  assert.equal(result.findings.some((finding) => finding.startsWith("credential_")), false,
    "an empty credential inventory is correct before the private handoff");
});

test("internal consent readiness defers webhook material but cannot outrun the missing authority contract", () => {
  const evidence = reviewCandidate();
  const result = qualifyPilotEvidence(reviewedContract(), evidence, head, reviewedSource, "internal_consent_ready");
  assert.ok(result.findings.includes("production_native_provisioning_profile_not_reviewed"));
  assert.deepEqual(result.releasePairChanges, ["oauthCallback", "callbackEdge"]);
  assert.equal(result.sourceCommit, head);
  assert.equal(result.qualificationScope, "sanitized_preflight_only");
  assert.equal(result.activationReadiness, false);
  assert.equal(result.privateMappingVerification, "required_outside_qualifier");
  assert.equal(result.activationAuthority, "not_granted");
  assert.equal(result.gatesRemainClosed, true);
  assert.equal(result.targetPhase, "internal_consent_ready");
  assert.deepEqual(evidence.credentialVersionsPresent.webhookSignature,
    { version: null, state: "ABSENT", totalCount: 0 });
  assert.equal(evidence.operationalChecks.credentialRefreshAlert, false);
  assert.equal(evidence.operationalChecks.signatureFailureAlert, false);
  assert.doesNotMatch(JSON.stringify(evidence), /workspaceId|merchantId|businessEntityId|locationIds/);
  assert.doesNotMatch(JSON.stringify(result), /workspaceId|merchantId|businessEntityId|locationIds/);

  evidence.activationGates.economicContributionsEnabled = true;
  const economic = qualifyPilotEvidence(reviewedContract(), evidence, head, reviewedSource, "internal_consent_ready");
  assert.equal(economic.activationReadiness, false);
  assert.ok(economic.findings.includes("gate_must_remain_closed:economicContributionsEnabled"));
});

test("sanitized receipts and operational booleans are assertions, never hosted qualification", () => {
  const reviewed = internallyConsistentButUnattestedContract();
  const evidence = reviewCandidate("internal_manual_sync_complete");
  const result = qualifyPilotEvidence(reviewed, evidence, head, internallyConsistentButUnattestedSource(),
    "internal_manual_sync_complete");
  assert.equal(typeof result.operatorAssertionsInternallyConsistent, "boolean",
    "sanitized assertions must produce a bounded consistency result");
  assert.equal(result.hostedQualificationProven, false,
    "arbitrary receipt digests and booleans cannot establish hosted execution");
  assert.equal(result.activationReadiness, false,
    "the offline checker cannot authorize a credential or consent transition");
  assert.equal("phasePreconditionsPassed" in result, false);
  assert.equal("sanitizedPreflightPassed" in result, false);
});

test("runtime source scanning cannot substitute for the exact-ledger catalog postflight", () => {
  const reviewed = internallyConsistentButUnattestedContract();
  const source = internallyConsistentButUnattestedSource();
  source.productionRuntimeCatalogPostflight = null;
  const result = qualifyPilotEvidence(reviewed, reviewCandidate("internal_manual_sync_complete"), head, source,
    "internal_manual_sync_complete");
  assert.ok(result.findings.includes("production_runtime_catalog_postflight_not_exact"));
  assert.equal(result.hostedQualificationProven, false);
  assert.equal(result.activationReadiness, false);
});

test("runtime catalog postflight covers the full final baseline and runtime authority surface", () => {
  const reviewed = internallyConsistentButUnattestedContract();
  const missingBaselineBinding = internallyConsistentButUnattestedSource();
  missingBaselineBinding.productionRuntimeCatalogPostflight = {
    ...missingBaselineBinding.productionRuntimeCatalogPostflight,
    authorityRpcs: missingBaselineBinding.productionRuntimeCatalogPostflight.authorityRpcs.slice(1)
  };
  const missingBindingResult = qualifyPilotEvidence(reviewed, reviewCandidate("internal_manual_sync_complete"), head,
    missingBaselineBinding, "internal_manual_sync_complete");
  assert.ok(missingBindingResult.findings.includes("production_runtime_catalog_postflight_not_exact"));

  const missingBaselineFunction = internallyConsistentButUnattestedSource();
  missingBaselineFunction.productionRuntimeCatalogPostflight = {
    ...missingBaselineFunction.productionRuntimeCatalogPostflight,
    requiredFunctions: missingBaselineFunction.productionRuntimeCatalogPostflight.requiredFunctions.slice(1)
  };
  const missingFunctionResult = qualifyPilotEvidence(reviewed, reviewCandidate("internal_manual_sync_complete"), head,
    missingBaselineFunction, "internal_manual_sync_complete");
  assert.ok(missingFunctionResult.findings.includes("production_runtime_catalog_postflight_not_exact"));
});

test("role postflight is phase-specific and never treats staged authority as active", () => {
  const staged = reviewCandidate("precredential_nonsecret");
  assert.equal(staged.database.rolePostflight, "square_production_internal_roles_closed_postflight_passed");
  const wrong = qualifyPilotEvidence(reviewedContract(), {
    ...staged,
    database: { ...staged.database, rolePostflight: "square_production_internal_roles_active_postflight_failed" }
  }, head, reviewedSource, "precredential_nonsecret");
  assert.ok(wrong.findings.includes("database_role_postflight_missing_or_wrong_phase"));
  const active = reviewCandidate("internal_consent_ready");
  assert.equal(active.database.rolePostflight, "square_production_internal_roles_closed_postflight_passed");
});

test("internal consent readiness requires exact release and only its phase credential metadata", () => {
  const reviewed = reviewedContract();
  const baselineCandidate = reviewCandidate();
  for (const [mutate, expected] of [
    [(e) => { e.database.overlayPath = "supabase/migrations/foreign.sql"; }, "square_overlay_path_mismatch"],
    [(e) => { e.database.overlaySourceCommit = "4".repeat(40); }, "square_overlay_source_commit_mismatch"],
    [(e) => { e.database.overlaySha256 = "e".repeat(64); }, "square_overlay_sha256_mismatch"],
    [(e) => { e.database.overlayObjectPostflight = null; }, "database_overlay_object_postflight_missing"],
    [(e) => { e.productionReleaseDeployment.sharedBootstrapSourceCommit = "7".repeat(40); }, "production_release_deployment_mismatch:sharedBootstrapSourceCommit"],
    [(e) => { e.productionReleaseDeployment.sharedBootstrapImageDigest = sharedBootstrapImageDigest.replace(/8/g, "7"); }, "production_release_deployment_mismatch:sharedBootstrapImageDigest"],
    [(e) => { e.productionReleaseDeployment.callbackEdgeSourceCommit = "e".repeat(40); }, "production_release_deployment_mismatch:callbackEdgeSourceCommit"],
    [(e) => { e.productionReleaseDeployment.callbackEdgeImageDigest = callbackEdgeImageDigest.replace(/c/g, "e"); }, "production_release_deployment_mismatch:callbackEdgeImageDigest"],
    [(e) => { e.productionReleaseDeployment.oauthCallbackSourceCommit = "f".repeat(40); }, "production_release_deployment_mismatch:oauthCallbackSourceCommit"],
    [(e) => { e.productionReleaseDeployment.oauthCallbackImageDigest = oauthCallbackImageDigest.replace(/d/g, "e"); }, "production_release_deployment_mismatch:oauthCallbackImageDigest"],
    [(e) => { e.credentialVersionsPresent.application.version = 2; }, "credential_version_not_one:application"],
    [(e) => { e.credentialVersionsPresent.application.state = "DISABLED"; }, "credential_version_not_enabled:application"],
    [(e) => { e.credentialVersionsPresent.application.totalCount = 2; }, "credential_version_count_not_one:application"],
    [(e) => { e.credentialVersionsPresent.webhookSignature = { version: 1, state: "ENABLED", totalCount: 1 }; }, "credential_version_must_remain_absent:webhookSignature"],
    [(e) => { e.pilotScopeCounts.allowlistEntryCount = 2; }, "exactly_one_allowlist_entry_required"],
    [(e) => { e.pilotScopeCounts.distinctWorkspaceCount = 2; }, "exactly_one_workspace_required"],
    [(e) => { e.pilotScopeCounts.distinctSellerCount = 2; }, "exactly_one_seller_required"]
  ]) {
    const evidence = structuredClone(baselineCandidate);
    mutate(evidence);
    const result = qualifyPilotEvidence(reviewed, evidence, head, reviewedSource, "internal_consent_ready");
    assert.equal(result.activationReadiness, false);
    assert.ok(result.findings.includes(expected), expected);
  }
});

test("phase gates separate readiness, completed manual sync, later lifecycle, and external customers", () => {
  const reviewed = reviewedContract();
  const precredential = qualifyPilotEvidence(reviewed, reviewCandidate("precredential_nonsecret"), head,
    reviewedSource, "precredential_nonsecret");
  assert.equal(precredential.activationReadiness, false,
    "credential entry stays blocked until every nonsecret runtime prerequisite exists");
  assert.ok(precredential.findings.includes("production_runtime_catalog_postflight_not_exact"));

  const blockedRuntime = qualifyPilotEvidence(reviewed, reviewCandidate(), head, currentRuntimeSource,
    "internal_consent_ready");
  assert.equal(blockedRuntime.activationReadiness, false);
  assert.ok(blockedRuntime.findings.includes("production_runtime_baseline_surface_not_exact"));
  assert.ok(blockedRuntime.findings.includes("production_runtime_catalog_postflight_not_exact"));

  const changedPrefix = {
    ...reviewedSource,
    productionRuntimeBaselineSurface: { ...reviewedSource.productionRuntimeBaselineSurface, sourceSha256: "0".repeat(64) }
  };
  assert.ok(qualifyPilotEvidence(reviewed, reviewCandidate(), head, changedPrefix,
    "internal_consent_ready").findings.includes("production_runtime_baseline_surface_not_exact"));

  const noReceipts = qualifyPilotEvidence(reviewed, reviewCandidate(), head, reviewedSource,
    "internal_manual_sync_complete");
  assert.equal(noReceipts.activationReadiness, false);
  assert.ok(noReceipts.findings.includes("phase_receipt_marker_missing:initialSync"));
  assert.ok(noReceipts.findings.includes("phase_receipt_fingerprint_missing:replay"));

  const manual = qualifyPilotEvidence(reviewed, reviewCandidate("internal_manual_sync_complete"), head,
    reviewedSource, "internal_manual_sync_complete");
  assert.equal(manual.activationReadiness, false);
  assert.ok(manual.findings.includes("production_native_provisioning_profile_not_reviewed"));
  assert.deepEqual(manual.releasePairChanges, ["oauthCallback", "callbackEdge"]);

  const replayedReceipt = reviewCandidate("internal_manual_sync_complete");
  replayedReceipt.phaseReceipts.replay.fingerprint = replayedReceipt.phaseReceipts.initialSync.fingerprint;
  assert.ok(qualifyPilotEvidence(reviewed, replayedReceipt, head, reviewedSource,
    "internal_manual_sync_complete").findings.includes("phase_receipt_fingerprint_reused"));

  const lifecycle = qualifyPilotEvidence(reviewed, reviewCandidate("post_initial_lifecycle"), head,
    reviewedSource, "post_initial_lifecycle");
  assert.equal(lifecycle.activationReadiness, false);
  assert.ok(lifecycle.findings.includes("production_native_provisioning_profile_not_reviewed"));
  assert.deepEqual(reviewCandidate("post_initial_lifecycle").credentialVersionsPresent.webhookSignature,
    { version: 1, state: "ENABLED", totalCount: 1 });

  const external = qualifyPilotEvidence(reviewed, reviewCandidate("external_customer_blocked"), head,
    reviewedSource, "external_customer_blocked");
  assert.equal(external.activationReadiness, false);
  assert.ok(external.findings.includes("external_customer_activation_forbidden"));
});

test("every phase schema classifies every credential slot exactly once", () => {
  const missing = reviewedContract();
  missing.qualificationPhases.internal_consent_ready.absentCredentialSlots = [];
  assert.throws(() => qualifyPilotEvidence(missing, reviewCandidate(), head, reviewedSource,
    "internal_consent_ready"), /must classify every credential slot exactly once/);

  const duplicate = reviewedContract();
  duplicate.qualificationPhases.internal_consent_ready.absentCredentialSlots.push("application");
  assert.throws(() => qualifyPilotEvidence(duplicate, reviewCandidate(), head, reviewedSource,
    "internal_consent_ready"), /credential slots must be unique/);

  const extraKey = reviewedContract();
  extraKey.qualificationPhases.internal_consent_ready.unreviewedOverride = true;
  assert.throws(() => qualifyPilotEvidence(extraKey, reviewCandidate(), head, reviewedSource,
    "internal_consent_ready"), /qualification phase\.internal_consent_ready keys differ from the closed contract/);

  const unknownReceipt = reviewedContract();
  unknownReceipt.qualificationPhases.internal_consent_ready.requiredPhaseReceipts = ["unreviewedReceipt"];
  assert.throws(() => qualifyPilotEvidence(unknownReceipt, reviewCandidate(), head, reviewedSource,
    "internal_consent_ready"), /contains an unknown phase receipt/);

  const unknownCheck = reviewedContract();
  unknownCheck.qualificationPhases.internal_consent_ready.requiredOperationalChecks.push("unreviewedCheck");
  assert.throws(() => qualifyPilotEvidence(unknownCheck, reviewCandidate(), head, reviewedSource,
    "internal_consent_ready"), /contains an unknown operational check/);
});

test("the reviewed overlay must exist in the source tree with the pinned bytes", () => {
  const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head, {}, "internal_consent_ready");
  assert.equal(result.activationReadiness, false);
  assert.ok(result.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
});

test("qualification logic and contract bytes must match the immutable head", () => {
  const source = { ...reviewedSource, qualificationSourcesExact: false };
  const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head, source, "internal_consent_ready");
  assert.equal(result.activationReadiness, false);
  assert.ok(result.findings.includes("qualification_sources_not_exact_head"));
});

test("every reviewed release source must be included in the qualification head", () => {
  for (const field of ["sharedBootstrapSourceCommit", "callbackEdgeSourceCommit", "oauthCallbackSourceCommit"]) {
    const source = {
      ...reviewedSource,
      sourceCommitsIncluded: { ...reviewedSource.sourceCommitsIncluded, [field]: false }
    };
    const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head, source, "internal_consent_ready");
    assert.equal(result.activationReadiness, false);
    assert.ok(result.findings.includes(`reviewed_release_source_not_in_qualification_head:${field}`));
  }
});

test("each changed release pair advances its source and digest together", () => {
  const reviewed = reviewedContract();
  reviewed.reviewedProductionRelease.oauthCallbackSourceCommit = reviewed.priorProductionRelease.oauthCallbackSourceCommit;
  const result = qualifyPilotEvidence(reviewed, reviewCandidate(), head, reviewedSource, "internal_consent_ready");
  assert.equal(result.activationReadiness, false);
  assert.ok(result.findings.includes("release_pair_change_mismatch:oauthCallback"));
});

test("qualification boundary drift cannot alter fail-safe output", () => {
  for (const [field, value, finding] of [
    ["scope", "activation_ready", "qualification_scope_not_sanitized_only"],
    ["privateMappingVerification", "confirmed", "private_mapping_boundary_not_explicit"],
    ["identifiersAllowedInEvidence", true, "private_identifiers_must_be_forbidden"],
    ["activationAuthority", "granted", "qualification_must_not_grant_activation_authority"]
  ]) {
    const drifted = reviewedContract();
    drifted.qualificationBoundary[field] = value;
    const result = qualifyPilotEvidence(drifted, reviewCandidate(), head, reviewedSource, "internal_consent_ready");
    assert.equal(result.activationReadiness, false);
    assert.ok(result.findings.includes(finding));
    assert.equal(result.qualificationScope, "sanitized_preflight_only");
    assert.equal(result.privateMappingVerification, "required_outside_qualifier");
    assert.equal(result.activationAuthority, "not_granted");
  }
});

test("evidence is exact, count-limited, and cannot carry credential material", () => {
  assert.throws(() => qualifyPilotEvidence(contract, { ...baseline, password: "synthetic-canary" }, head), /closed contract/);
  const leaked = structuredClone(baseline);
  leaked.projectId = "postgresql://synthetic.example.invalid/db";
  assert.throws(() => qualifyPilotEvidence(contract, leaked, head), /credential material is forbidden/);
  assert.throws(() => qualifyPilotEvidence(contract, baseline, "main"), /immutable Git commit/);

  const oversized = reviewCandidate();
  oversized.pilotScopeCounts = {
    allowlistEntryCount: 2,
    distinctWorkspaceCount: 2,
    distinctSellerCount: 2
  };
  const result = qualifyPilotEvidence(reviewedContract(), oversized, head, reviewedSource, "internal_consent_ready");
  assert.ok(result.findings.includes("exactly_one_allowlist_entry_required"));
  assert.ok(result.findings.includes("exactly_one_workspace_required"));
  assert.ok(result.findings.includes("exactly_one_seller_required"));
});

test("sanitized qualification rejects legacy allowlists and mapping claims", () => {
  const legacy = reviewCandidate();
  delete legacy.pilotScopeCounts;
  legacy.pilotAllowlist = [];
  assert.throws(() => qualifyPilotEvidence(reviewedContract(), legacy, head, reviewedSource), /closed contract/);

  const booleanClaim = reviewCandidate();
  booleanClaim.pilotScopeCounts.mappingConfirmed = true;
  assert.throws(() => qualifyPilotEvidence(reviewedContract(), booleanClaim, head, reviewedSource), /closed contract/);
});

test("initial pagination, cancellation, timeout, replay and lost acknowledgement remain atomic", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, generation);
  pilot.startScan("initial", generation);

  const first = pilot.commitPage({
    expectedGeneration: generation, receiptId: "INITIAL_PAGE_1", cursor: null, nextCursor: null,
    observations: [observation("PAYMENT_1", "1")]
  });
  assert.deepEqual(first, { outcome: "committed", committed: true, inserted: 1 });
  const finalRequest = {
    expectedGeneration: generation, receiptId: "INITIAL_PAGE_1", cursor: null, nextCursor: null,
    observations: [observation("PAYMENT_1", "1")]
  };
  assert.equal(pilot.commitPage(finalRequest).outcome, "replay", "lost acknowledgement retries the identical receipt");
  assert.throws(() => pilot.commitPage({ ...finalRequest, observations: [observation("PAYMENT_CHANGED", "1")] }), /replay payload changed/);
  assert.match(pilot.finishScan(generation), /^1:initial:1$/);

  const cancelled = createSyntheticPilot();
  const cancelledGeneration = completeFreshAuthorization(cancelled);
  mapInternalPilot(cancelled, cancelledGeneration);
  cancelled.startScan("initial", cancelledGeneration);
  const beforeInterrupted = { versions: cancelled.state.versions.size, receipts: cancelled.state.receipts.size };
  assert.equal(cancelled.commitPage({ expectedGeneration: cancelledGeneration, receiptId: "INITIAL_CANCELLED", cursor: null,
    nextCursor: null, observations: [observation("PAYMENT_2", "1")], cancelled: true }).outcome, "cancelled");
  assert.deepEqual({ versions: cancelled.state.versions.size, receipts: cancelled.state.receipts.size }, beforeInterrupted);
});

test("incremental sync, refresh and webhook dedup preserve the active generation", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, generation);
  pilot.startScan("initial", generation);
  pilot.commitPage({ expectedGeneration: generation, receiptId: "BASELINE", cursor: null, nextCursor: null, observations: [observation("ORDER_1", "1")] });
  pilot.finishScan(generation);

  assert.equal(pilot.refresh({ expectedGeneration: generation, outcome: "success" }), true);
  assert.equal(pilot.state.generation, generation);
  pilot.startScan("incremental", generation);
  assert.equal(pilot.commitPage({
    expectedGeneration: generation, receiptId: "INCREMENTAL_1", cursor: null, nextCursor: null,
    observations: [observation("ORDER_1", "1"), observation("ORDER_2", "1")]
  }).inserted, 1, "overlap replay does not duplicate an immutable source version");
  pilot.finishScan(generation);
  assert.equal(pilot.receiveWebhook({ expectedGeneration: generation, eventId: "WEBHOOK_1" }), "accepted");
  assert.equal(pilot.receiveWebhook({ expectedGeneration: generation, eventId: "WEBHOOK_1" }), "duplicate");
});

test("refresh failure, disconnect and provider revocation fence later work", () => {
  for (const close of ["refresh", "disconnect", "revoke"]) {
    const pilot = createSyntheticPilot();
    const generation = completeFreshAuthorization(pilot);
    mapInternalPilot(pilot, generation);
    if (close === "refresh") assert.equal(pilot.refresh({ expectedGeneration: generation, outcome: "invalid_grant" }), false);
    else pilot[close]({ expectedGeneration: generation });
    assert.throws(() => pilot.startScan("initial", generation), /connection is fenced/, close);
    assert.throws(() => pilot.receiveWebhook({ expectedGeneration: generation, eventId: "WEBHOOK_AFTER_CLOSE" }), /connection is fenced/, close);
  }
});

test("mapping and incremental sync fail closed without explicit prerequisites", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  assert.throws(() => pilot.confirmMapping({
    expectedGeneration: generation,
    workspaceId: "22222222-2222-4222-8222-222222222222",
    businessEntityId: pilot.state.businessEntityId,
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_1"]
  }), /workspace is not allowlisted/);
  assert.throws(() => pilot.confirmMapping({
    expectedGeneration: generation,
    workspaceId: pilot.state.workspaceId,
    businessEntityId: "33333333-3333-4333-8333-333333333333",
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_1"]
  }), /business entity is not allowlisted/);
  mapInternalPilot(pilot, generation);
  assert.throws(() => pilot.startScan("incremental", generation), /durable checkpoint/);
});

test("mapping confirmation is immutable and exact replays are idempotent", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  const mapping = {
    expectedGeneration: generation,
    workspaceId: pilot.state.workspaceId,
    businessEntityId: pilot.state.businessEntityId,
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_INTERNAL_1"]
  };
  assert.equal(pilot.confirmMapping(mapping), "confirmed");
  assert.equal(pilot.confirmMapping({ ...mapping, locationIds: ["LOCATION_INTERNAL_1"] }), "replay");
  assert.throws(() => pilot.confirmMapping({ ...mapping, locationIds: ["LOCATION_INTERNAL_2"] }),
    /mapping is immutable for the current generation/);
  assert.throws(() => pilot.confirmMapping({ ...mapping, merchantId: "MERCHANT_OTHER" }),
    /seller is not allowlisted/);
});

test("generationFencing rejects stale mapping, page, refresh, webhook, disconnect and revocation after reauthorization", () => {
  const pilot = createSyntheticPilot();
  const previousGeneration = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, previousGeneration);
  pilot.startScan("initial", previousGeneration);
  const currentGeneration = completeFreshAuthorization(pilot);
  for (const staleAction of [
    () => pilot.confirmMapping({ expectedGeneration: previousGeneration, workspaceId: pilot.state.workspaceId,
      businessEntityId: pilot.state.businessEntityId, merchantId: pilot.state.merchantId, locationIds: ["LOCATION_1"] }),
    () => pilot.commitPage({ expectedGeneration: previousGeneration, receiptId: "STALE_PAGE", cursor: null, nextCursor: null,
      observations: [observation("ORDER_STALE", "1")] }),
    () => pilot.refresh({ expectedGeneration: previousGeneration, outcome: "invalid_grant" }),
    () => pilot.receiveWebhook({ expectedGeneration: previousGeneration, eventId: "STALE_WEBHOOK" }),
    () => pilot.disconnect({ expectedGeneration: previousGeneration }),
    () => pilot.revoke({ expectedGeneration: previousGeneration })
  ]) assert.throws(staleAction, /stale generation is fenced/);
  assert.equal(pilot.state.lifecycle, "authorized");
  mapInternalPilot(pilot, currentGeneration);
  assert.equal(pilot.state.mapped, true);
});

test("new authorization reads only its generation while preserving prior provenance separately", () => {
  const pilot = createSyntheticPilot();
  const firstGeneration = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, firstGeneration);
  pilot.startScan("initial", firstGeneration);
  pilot.commitPage({ expectedGeneration: firstGeneration, receiptId: "GENERATION_ONE_PAGE", cursor: null,
    nextCursor: null, observations: [observation("PAYMENT_GENERATION_ONE", "1")] });
  pilot.finishScan(firstGeneration);

  const secondGeneration = completeFreshAuthorization(pilot, 10);
  mapInternalPilot(pilot, secondGeneration);
  const evidence = pilot.readEvidence({ expectedGeneration: secondGeneration,
    actorWorkspaceId: pilot.state.workspaceId, actorBusinessEntityId: pilot.state.businessEntityId,
    actorMerchantId: pilot.state.merchantId });
  assert.equal(evidence.observationCount, 0);
  assert.deepEqual(evidence.observationsByFamily, {});
  assert.equal(evidence.checkpoint, null);
  assert.equal(pilot.state.archivedVersions.size, 1);
  assert.equal(pilot.state.versions.size, 0);
});

test("authorization completion is current-generation-bound, expiring, one-use and fenced by newer lifecycle events", () => {
  const pilot = createSyntheticPilot();
  pilot.beginAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_OLD", now: 0, expiresAt: 60_000 });
  pilot.disconnect({ expectedGeneration: 0 });
  assert.throws(() => pilot.completeAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_OLD", now: 1 }),
    /not pending/);
  assert.throws(() => pilot.beginAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_OLD", now: 2, expiresAt: 60_002 }),
    /already used or fenced/);

  pilot.beginAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_NEWER", now: 3, expiresAt: 60_003 });
  pilot.beginAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_LATEST", now: 4, expiresAt: 60_004 });
  assert.throws(() => pilot.completeAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_NEWER", now: 5 }),
    /does not match/);
  const generation = pilot.completeAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_LATEST", now: 5 });
  assert.equal(generation, 1);
  assert.throws(() => pilot.completeAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_LATEST", now: 6 }),
    /stale generation is fenced/);

  pilot.beginAuthorization({ expectedGeneration: generation, opaqueState: "AUTHORIZATION_REVOKED", now: 7, expiresAt: 60_007 });
  pilot.revoke({ expectedGeneration: generation });
  assert.throws(() => pilot.completeAuthorization({ expectedGeneration: generation, opaqueState: "AUTHORIZATION_REVOKED", now: 8 }),
    /not pending/);

  const expiring = createSyntheticPilot();
  expiring.beginAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_EXPIRES", now: 10, expiresAt: 11 });
  assert.throws(() => expiring.completeAuthorization({ expectedGeneration: 0, opaqueState: "AUTHORIZATION_EXPIRES", now: 11 }),
    /expired/);
  assert.equal(expiring.state.pendingAuthorization, null);
});

test("atomicPageValidation rejects a malformed later observation without source, receipt or cursor mutation", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, generation);
  pilot.startScan("initial", generation);
  assert.throws(() => pilot.commitPage({ expectedGeneration: generation, receiptId: "MALFORMED_PAGE", cursor: null, nextCursor: null,
    observations: [observation("PAYMENT_1", "1"), { resourceFamily: "payments", operation: "payments/list_payments", authorityScope: "internal", providerId: "PAYMENT_2" }] }), /source version must be bounded/);
  assert.equal(pilot.state.versions.size, 0);
  assert.equal(pilot.state.receipts.size, 0);
  assert.deepEqual(pilot.state.scan, { kind: "initial", source: "payments/list_payments", deadlineAt: 86_400_000,
    attempt: 1, expectedCursor: null, pages: 0, complete: false, incomplete: false });
});

test("canonicalSourceVersion deduplicates reordered payload keys and rejects immutable conflicts", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, generation);
  pilot.startScan("initial", generation);
  const original = { resourceFamily: "payments", operation: "payments/list_payments", authorityScope: "internal", providerId: "PAYMENT_1", sourceVersion: "1", status: "COMPLETED", details: { b: 2, a: 1 } };
  assert.equal(pilot.commitPage({ expectedGeneration: generation, receiptId: "CANONICAL_1", cursor: null, nextCursor: null, observations: [original] }).inserted, 1);
  const reordered = { details: { a: 1, b: 2 }, status: "COMPLETED", authorityScope: "internal", operation: "payments/list_payments", resourceFamily: "payments", sourceVersion: "1", providerId: "PAYMENT_1" };
  assert.equal(pilot.commitPage({ expectedGeneration: generation, receiptId: "CANONICAL_1", cursor: null, nextCursor: null, observations: [reordered] }).inserted, 0);
  pilot.finishScan(generation);
  pilot.startScan("incremental", generation);
  assert.throws(() => pilot.commitPage({ expectedGeneration: generation, receiptId: "CANONICAL_CONFLICT", cursor: null, nextCursor: null,
    observations: [observation("PAYMENT_1", "1", { status: "CANCELLED" })] }), /immutable source version payload changed/);
  assert.equal(pilot.state.versions.size, 1);
});

test("evidence authority returns only sanitized mapped-generation counts", () => {
  const pilot = createSyntheticPilot();
  const generation = completeFreshAuthorization(pilot);
  mapInternalPilot(pilot, generation);
  pilot.startScan("initial", generation);
  pilot.commitPage({ expectedGeneration: generation, receiptId: "EVIDENCE_PAGE", cursor: null, nextCursor: null,
    observations: [observation("PAYMENT_1", "1"), observation("ORDER_1", "1", {
      resourceFamily: "orders", operation: "orders/list_orders"
    })] });
  pilot.finishScan(generation);
  const evidence = pilot.readEvidence({ expectedGeneration: generation,
    actorWorkspaceId: pilot.state.workspaceId, actorBusinessEntityId: pilot.state.businessEntityId,
    actorMerchantId: pilot.state.merchantId });
  assert.deepEqual(evidence, {
    authority: "evidence_v1",
    status: "verified_non_economic_observations",
    observationCount: 2,
    observationsByFamily: { payments: 1, orders: 1 },
    checkpoint: "1:initial:1",
    incomplete: false,
    history: "partial"
  });
  assert.throws(() => pilot.readEvidence({ expectedGeneration: generation,
    actorWorkspaceId: "33333333-3333-4333-8333-333333333333",
    actorBusinessEntityId: pilot.state.businessEntityId, actorMerchantId: pilot.state.merchantId
  }), /evidence authority denied/);
  assert.doesNotMatch(JSON.stringify(evidence), /PAYMENT_1|ORDER_1|workspaceId|merchantId|cursor/);
});
