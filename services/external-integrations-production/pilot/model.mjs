import assert from "node:assert/strict";
import fs from "node:fs";

const allowedEvidenceKeys = new Set([
  "contractVersion", "sourceCommit", "projectId", "region", "hostname", "callbackUrl", "webhookUrl",
  "database", "productionReleaseDeployment", "credentialVersionsPresent", "activationGates", "pilotScopeCounts",
  "phaseReceipts", "operationalChecks"
]);
const expectedQualificationBoundary = Object.freeze({
  scope: "sanitized_preflight_only",
  privateMappingVerification: "required_outside_qualifier",
  identifiersAllowedInEvidence: false,
  activationAuthority: "not_granted"
});
const runtimeAuthorityRpcs = Object.freeze([
  "square_production_oauth_authority=public.square_production_internal_oauth_v1(text,jsonb)",
  "square_production_broker_authority=public.square_production_internal_broker_v1(text,jsonb)",
  "square_production_scheduler_authority=public.check_square_production_scheduler_authority_v1(text,text,text,bigint,text)",
  "square_production_webhook_authority=public.check_square_production_webhook_authority_v1(text,text,text,bigint,text)",
  "square_production_runtime_authority=public.square_production_internal_runtime_v1(text,jsonb)",
  "square_production_evidence_authority=public.square_production_internal_evidence_v1(text,jsonb)"
].sort());
const runtimeRequiredFunctions = Object.freeze([
  "private.square_production_internal_reject_immutable_mutation_v1()",
  "private.square_production_internal_guard_lifecycle_update_v1()",
  "private.square_production_internal_require_keys_v1(jsonb,text[])",
  "private.square_production_internal_fingerprint_v1(text[])",
  "private.square_production_internal_audit_v1(uuid,bigint,text,text,text,text,timestamptz)",
  "private.square_production_internal_require_login_v1(text)",
  "private.square_production_internal_lock_permit_v1(uuid,text,boolean)",
  "private.square_production_internal_install_permit_v1(jsonb)",
  "public.square_production_internal_oauth_v1(text,jsonb)",
  "public.square_production_internal_broker_v1(text,jsonb)",
  "public.square_production_internal_runtime_v1(text,jsonb)",
  "public.square_production_internal_evidence_v1(text,jsonb)"
].sort());

function exactKeys(value, keys, label) {
  assert.equal(value && typeof value === "object" && !Array.isArray(value), true, `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys differ from the closed contract`);
}

function safeIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 191 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isImageDigest(value, repository) {
  return typeof value === "string" && value.startsWith(`${repository}@sha256:`) &&
    /^[a-f0-9]{64}$/.test(value.slice(`${repository}@sha256:`.length));
}

function containsCredentialMaterial(value, path = "$") {
  if (typeof value === "string") {
    if (/^(?:EAAA|sq0csp-|sq0atp-|sq0idb-|xox[baprs]-|sk_live_)/.test(value)) return path;
    if (/postgres(?:ql)?:\/\//i.test(value) || /-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(value)) return path;
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:password|accessToken|refreshToken|clientSecret|secretValue|privateKey|databaseUrl)/i.test(key)) return `${path}.${key}`;
    const found = containsCredentialMaterial(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function containsPrivateMappingMaterial(value, path = "$") {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (/^(?:workspaceId|merchantId|businessEntityId|locationIds?|sellerId)$/i.test(key)) return `${path}.${key}`;
    const found = containsPrivateMappingMaterial(nested, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function qualifyPilotEvidence(contract, evidence, expectedHead, sourceControl = {}, targetPhase = "precredential_nonsecret") {
  const privateMappingPath = containsPrivateMappingMaterial(evidence);
  if (privateMappingPath !== null) {
    throw new Error("private mapping identifiers are forbidden in sanitized pilot evidence");
  }
  exactKeys(evidence, allowedEvidenceKeys, "evidence");
  const credentialPath = containsCredentialMaterial(evidence);
  assert.equal(credentialPath, null, `credential material is forbidden in pilot evidence: ${credentialPath}`);
  assert.match(expectedHead, /^[a-f0-9]{40}$/, "expected head must be an immutable Git commit");

  const findings = [];
  const requireEqual = (actual, expected, code) => {
    if (actual !== expected) findings.push(code);
  };

  requireEqual(evidence.contractVersion, "square_production_internal_seller_pilot_evidence_v2", "evidence_contract_mismatch");
  const phaseNames = [
    "precredential_nonsecret", "internal_consent_ready", "internal_manual_sync_complete",
    "post_initial_lifecycle", "external_customer_blocked"
  ];
  exactKeys(contract.qualificationPhases, phaseNames, "qualification phases");
  const phaseKeys = [
    "enabledCredentialSlots", "absentCredentialSlots", "requiresPilotScope", "requiresProductionRuntime", "fixedBlocker", "requiredDatabaseRolePostflight",
    "requiredPhaseReceipts", "requiredOperationalChecks"
  ];
  for (const phaseName of phaseNames) {
    const candidatePhase = contract.qualificationPhases[phaseName];
    exactKeys(candidatePhase, phaseKeys, `qualification phase.${phaseName}`);
    assert.equal(Array.isArray(candidatePhase.enabledCredentialSlots), true,
      `qualification phase.${phaseName}.enabledCredentialSlots must be an array`);
    assert.equal(Array.isArray(candidatePhase.absentCredentialSlots), true,
      `qualification phase.${phaseName}.absentCredentialSlots must be an array`);
    assert.equal(Array.isArray(candidatePhase.requiredPhaseReceipts), true,
      `qualification phase.${phaseName}.requiredPhaseReceipts must be an array`);
    assert.equal(Array.isArray(candidatePhase.requiredOperationalChecks), true,
      `qualification phase.${phaseName}.requiredOperationalChecks must be an array`);
    assert.equal(typeof candidatePhase.requiresPilotScope, "boolean",
      `qualification phase.${phaseName}.requiresPilotScope must be a boolean`);
    assert.equal(typeof candidatePhase.requiresProductionRuntime, "boolean",
      `qualification phase.${phaseName}.requiresProductionRuntime must be a boolean`);
    assert.equal(candidatePhase.fixedBlocker === null || safeIdentifier(candidatePhase.fixedBlocker), true,
      `qualification phase.${phaseName}.fixedBlocker must be a fixed label or null`);
    assert.equal(candidatePhase.requiredDatabaseRolePostflight === null || safeIdentifier(candidatePhase.requiredDatabaseRolePostflight), true,
      `qualification phase.${phaseName}.requiredDatabaseRolePostflight must be a fixed marker or null`);
    const credentialPartition = [...candidatePhase.enabledCredentialSlots, ...candidatePhase.absentCredentialSlots];
    assert.equal(new Set(credentialPartition).size, credentialPartition.length,
      `qualification phase.${phaseName} credential slots must be unique`);
    assert.deepEqual([...credentialPartition].sort(), [...contract.credentialSlots].sort(),
      `qualification phase.${phaseName} must classify every credential slot exactly once`);
    assert.equal(new Set(candidatePhase.requiredPhaseReceipts).size, candidatePhase.requiredPhaseReceipts.length,
      `qualification phase.${phaseName} phase receipts must be unique`);
    assert.equal(candidatePhase.requiredPhaseReceipts.every(receipt => Object.hasOwn(contract.phaseReceiptMarkers, receipt)), true,
      `qualification phase.${phaseName} contains an unknown phase receipt`);
    assert.equal(new Set(candidatePhase.requiredOperationalChecks).size, candidatePhase.requiredOperationalChecks.length,
      `qualification phase.${phaseName} operational checks must be unique`);
    assert.equal(candidatePhase.requiredOperationalChecks.every(check => contract.requiredOperationalChecks.includes(check)), true,
      `qualification phase.${phaseName} contains an unknown operational check`);
  }
  assert.equal(phaseNames.includes(targetPhase), true, "target phase is not in the closed contract");
  const phase = contract.qualificationPhases[targetPhase];
  if (phase.fixedBlocker !== null) findings.push(phase.fixedBlocker);
  requireEqual(evidence.sourceCommit, expectedHead, "source_commit_mismatch");
  requireEqual(sourceControl.sourceCommit, expectedHead, "qualification_source_head_mismatch");
  requireEqual(sourceControl.qualificationSourcesExact, true, "qualification_sources_not_exact_head");
  for (const field of ["projectId", "region", "hostname", "callbackUrl", "webhookUrl"]) {
    requireEqual(evidence[field], contract[field], `${field}_mismatch`);
  }

  exactKeys(evidence.database, ["ledgerHead", "foundationVersion", "overlayPath", "overlaySourceCommit", "overlaySha256", "overlayObjectPostflight", "rolePostflight"], "database evidence");
  const expectedLedgerHead = phase.requiresProductionRuntime &&
    contract.productionRuntimeSurface.runtimeContract.status === "reviewed_runtime_migration"
    ? contract.productionRuntimeSurface.runtimeContract.ledgerHead
    : contract.productionRuntimeSurface.baselineHead;
  requireEqual(evidence.database.ledgerHead, expectedLedgerHead, "database_ledger_not_exact_phase");
  requireEqual(evidence.database.foundationVersion, contract.database.requiredFoundationVersion, "production_foundation_mismatch");
  requireEqual(evidence.database.overlayPath, contract.database.requiredOverlayPath, "square_overlay_path_mismatch");
  if (!/^[a-f0-9]{40}$/.test(contract.database.requiredOverlaySourceCommit ?? "")) {
    findings.push("reviewed_overlay_source_commit_pending");
  } else {
    requireEqual(sourceControl.overlaySourceIncluded, true, "reviewed_overlay_source_not_in_qualification_head");
    requireEqual(evidence.database.overlaySourceCommit, contract.database.requiredOverlaySourceCommit,
      "square_overlay_source_commit_mismatch");
  }
  if (!isSha256(contract.database.requiredOverlaySha256)) findings.push("reviewed_overlay_sha256_pending");
  else {
    requireEqual(sourceControl.sourceOverlaySha256, contract.database.requiredOverlaySha256,
      "reviewed_overlay_source_missing_or_mismatch");
    requireEqual(evidence.database.overlaySha256, contract.database.requiredOverlaySha256, "square_overlay_sha256_mismatch");
  }
  requireEqual(evidence.database.overlayObjectPostflight, contract.database.requiredPostflight, "database_overlay_object_postflight_missing");
  requireEqual(evidence.database.rolePostflight, phase.requiredDatabaseRolePostflight,
    phase.requiredDatabaseRolePostflight === null ? "database_role_postflight_not_permitted" : "database_role_postflight_missing_or_wrong_phase");

  const releaseKeys = [
    "sharedBootstrapSourceCommit", "sharedBootstrapImageDigest",
    "oauthCallbackSourceCommit", "oauthCallbackImageDigest",
    "callbackEdgeSourceCommit", "callbackEdgeImageDigest"
  ];
  exactKeys(evidence.productionReleaseDeployment, releaseKeys, "production release deployment evidence");
  exactKeys(contract.reviewedProductionRelease, releaseKeys, "reviewed production release");
  exactKeys(contract.priorProductionRelease, releaseKeys, "prior production release");
  exactKeys(contract.expectedReleasePairChanges, ["sharedBootstrap", "oauthCallback", "callbackEdge"],
    "expected release pair changes");
  requireEqual(contract.expectedReleasePairChanges.sharedBootstrap, false, "shared_bootstrap_release_must_remain_unchanged");
  requireEqual(contract.expectedReleasePairChanges.oauthCallback, true, "oauth_callback_release_must_advance");
  requireEqual(contract.expectedReleasePairChanges.callbackEdge, true, "callback_edge_release_must_advance");
  const reviewedRelease = contract.reviewedProductionRelease;
  const priorRelease = contract.priorProductionRelease;
  const releaseShapes = {
    sharedBootstrapSourceCommit: (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value),
    sharedBootstrapImageDigest: (value) => isImageDigest(value,
      "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap"),
    callbackEdgeSourceCommit: (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value),
    callbackEdgeImageDigest: (value) => isImageDigest(value,
      "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge"),
    oauthCallbackSourceCommit: (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value),
    oauthCallbackImageDigest: (value) => isImageDigest(value,
      "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap")
  };
  let releasePinsValid = true;
  for (const field of releaseKeys) {
    if (!releaseShapes[field](priorRelease[field])) {
      releasePinsValid = false;
      findings.push(`prior_production_release_invalid:${field}`);
    }
    if (!releaseShapes[field](reviewedRelease[field])) {
      releasePinsValid = false;
      findings.push(`reviewed_production_release_pending:${field}`);
    } else {
      if (field.endsWith("SourceCommit")) {
        requireEqual(sourceControl.sourceCommitsIncluded?.[field], true,
          `reviewed_release_source_not_in_qualification_head:${field}`);
      }
      requireEqual(evidence.productionReleaseDeployment[field], reviewedRelease[field],
        `production_release_deployment_mismatch:${field}`);
    }
  }
  const releasePairFields = {
    sharedBootstrap: ["sharedBootstrapSourceCommit", "sharedBootstrapImageDigest"],
    oauthCallback: ["oauthCallbackSourceCommit", "oauthCallbackImageDigest"],
    callbackEdge: ["callbackEdgeSourceCommit", "callbackEdgeImageDigest"]
  };
  const releasePairChanges = [];
  if (releasePinsValid) {
    for (const [pair, fields] of Object.entries(releasePairFields)) {
      const fieldChanges = fields.map((field) => reviewedRelease[field] !== priorRelease[field]);
      const pairMatches = contract.expectedReleasePairChanges[pair]
        ? fieldChanges.every(Boolean)
        : fieldChanges.every((changed) => !changed);
      requireEqual(pairMatches, true, `release_pair_change_mismatch:${pair}`);
      if (fieldChanges.every(Boolean)) releasePairChanges.push(pair);
    }
  }

  exactKeys(evidence.credentialVersionsPresent, contract.credentialSlots, "credential version evidence");
  for (const slot of contract.credentialSlots) {
    const metadata = evidence.credentialVersionsPresent[slot];
    exactKeys(metadata, ["version", "state", "totalCount"], `credential version evidence.${slot}`);
    if (phase.enabledCredentialSlots.includes(slot)) {
      requireEqual(metadata.version, 1, `credential_version_not_one:${slot}`);
      requireEqual(metadata.state, "ENABLED", `credential_version_not_enabled:${slot}`);
      requireEqual(metadata.totalCount, 1, `credential_version_count_not_one:${slot}`);
    } else if (phase.absentCredentialSlots.includes(slot)) {
      requireEqual(metadata.version, null, `credential_version_must_remain_absent:${slot}`);
      requireEqual(metadata.state, "ABSENT", `credential_state_must_remain_absent:${slot}`);
      requireEqual(metadata.totalCount, 0, `credential_count_must_remain_zero:${slot}`);
    }
  }

  exactKeys(evidence.activationGates, contract.activationGates, "activation gates");
  for (const gate of contract.activationGates) requireEqual(evidence.activationGates[gate], false, `gate_must_remain_closed:${gate}`);

  const pilotScopeCountKeys = ["allowlistEntryCount", "distinctWorkspaceCount", "distinctSellerCount"];
  exactKeys(evidence.pilotScopeCounts, pilotScopeCountKeys, "pilot scope count evidence");
  for (const key of pilotScopeCountKeys) {
    if (!Number.isSafeInteger(evidence.pilotScopeCounts[key]) || evidence.pilotScopeCounts[key] < 0) {
      findings.push(`invalid_pilot_scope_count:${key}`);
    }
  }
  requireEqual(contract.pilotPolicy.maximumAllowlistedWorkspaces, 1, "pilot_workspace_limit_not_one");
  requireEqual(contract.pilotPolicy.maximumAllowlistedSellers, 1, "pilot_seller_limit_not_one");
  requireEqual(contract.pilotPolicy.requiresInternalSeller, true, "pilot_must_require_internal_seller");
  requireEqual(contract.pilotPolicy.requiresExplicitBusinessEntityMapping, true,
    "pilot_must_require_explicit_business_entity_mapping");
  requireEqual(contract.pilotPolicy.requiresExplicitLocationMapping, true,
    "pilot_must_require_explicit_location_mapping");
  requireEqual(contract.pilotPolicy.automaticMapping, false, "pilot_automatic_mapping_must_remain_disabled");
  const expectedScopeCount = phase.requiresPilotScope ? 1 : 0;
  requireEqual(evidence.pilotScopeCounts.allowlistEntryCount, expectedScopeCount,
    phase.requiresPilotScope ? "exactly_one_allowlist_entry_required" : "pilot_allowlist_must_remain_empty");
  requireEqual(evidence.pilotScopeCounts.distinctWorkspaceCount, expectedScopeCount,
    phase.requiresPilotScope ? "exactly_one_workspace_required" : "pilot_workspace_scope_must_remain_empty");
  requireEqual(evidence.pilotScopeCounts.distinctSellerCount, expectedScopeCount,
    phase.requiresPilotScope ? "exactly_one_seller_required" : "pilot_seller_scope_must_remain_empty");

  exactKeys(evidence.phaseReceipts, Object.keys(contract.phaseReceiptMarkers), "phase receipts");
  const requiredReceiptFingerprints = [];
  for (const [receipt, marker] of Object.entries(contract.phaseReceiptMarkers)) {
    const value = evidence.phaseReceipts[receipt];
    exactKeys(value, ["marker", "fingerprint"], `phase receipt.${receipt}`);
    if (phase.requiredPhaseReceipts.includes(receipt)) {
      requireEqual(value.marker, marker, `phase_receipt_marker_missing:${receipt}`);
      if (typeof value.fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.fingerprint)) {
        findings.push(`phase_receipt_fingerprint_missing:${receipt}`);
      } else requiredReceiptFingerprints.push(value.fingerprint);
    } else if (value.marker !== null || value.fingerprint !== null) {
      findings.push(`phase_receipt_not_permitted:${receipt}`);
    }
  }
  if (new Set(requiredReceiptFingerprints).size !== requiredReceiptFingerprints.length) {
    findings.push("phase_receipt_fingerprint_reused");
  }

  exactKeys(contract.productionRuntimeSurface,
    ["baselineMigrationCount", "baselineHead", "baselineMigrationSourceSha256", "baselineAuthorityRpcs", "baselineBlockingPredicates",
      "runtimeContract"], "production runtime surface");
  const runtimeContract = contract.productionRuntimeSurface.runtimeContract;
  exactKeys(runtimeContract,
    ["status", "sourceCommit", "sourcePath", "migrationCount", "ledgerHead", "ledgerFingerprint", "migrationSourceSha256", "authorityRpcs", "requiredFunctions"],
    "production runtime contract");
  assert.equal(["pending_reviewed_runtime_migration", "reviewed_runtime_migration"].includes(runtimeContract.status), true,
    "production runtime contract status is not closed");
  assert.equal(Array.isArray(runtimeContract.authorityRpcs), true,
    "production runtime contract authority RPCs must be an array");
  assert.equal(Array.isArray(runtimeContract.requiredFunctions), true,
    "production runtime contract required functions must be an array");
  const baselineAuthorityRpcs = contract.productionRuntimeSurface.baselineAuthorityRpcs;
  assert.equal(Array.isArray(baselineAuthorityRpcs) && new Set(baselineAuthorityRpcs).size === baselineAuthorityRpcs.length,
    true, "baseline authority bindings must be unique");
  for (const binding of baselineAuthorityRpcs) {
    assert.equal(typeof binding, "string", "baseline authority binding must be a string");
    const separator = binding.indexOf("=");
    assert.ok(separator > 0 && separator < binding.length - 1,
      "baseline authority binding must include one function signature");
  }
  if (runtimeContract.status === "pending_reviewed_runtime_migration") {
    assert.equal(runtimeContract.sourceCommit, null, "pending production runtime must not name an unreviewed source");
    assert.equal(runtimeContract.sourcePath, null, "pending production runtime must not name an unreviewed source path");
    assert.equal(runtimeContract.migrationCount, null, "pending production runtime must not name an unreviewed migration count");
    assert.equal(runtimeContract.ledgerHead, null, "pending production runtime must not name an unreviewed ledger head");
    assert.equal(runtimeContract.ledgerFingerprint, null, "pending production runtime must not name an unreviewed ledger fingerprint");
    assert.equal(runtimeContract.migrationSourceSha256, null, "pending production runtime must not pin an unreviewed source");
    assert.deepEqual(runtimeContract.authorityRpcs, [], "pending production runtime must not invent authority grants");
    assert.deepEqual(runtimeContract.requiredFunctions, [], "pending production runtime must not invent a function surface");
  } else {
    assert.match(runtimeContract.sourceCommit, /^[a-f0-9]{40}$/, "reviewed runtime must pin its source commit");
    requireEqual(sourceControl.runtimeSourceIncluded, true, "reviewed_runtime_source_not_in_qualification_head");
    assert.equal(typeof runtimeContract.sourcePath === "string" && runtimeContract.sourcePath.startsWith("supabase/migrations/") &&
      !runtimeContract.sourcePath.includes(".."), true,
      "reviewed runtime must pin one safe source path");
    assert.equal(Number.isSafeInteger(runtimeContract.migrationCount) && runtimeContract.migrationCount > contract.productionRuntimeSurface.baselineMigrationCount,
      true, "reviewed production runtime must advance the exact baseline");
    assert.match(runtimeContract.ledgerHead, /^\d{14}$/,
      "reviewed production runtime must pin one exact ledger head");
    assert.match(runtimeContract.ledgerFingerprint, /^sha256:[a-f0-9]{64}$/,
      "reviewed production runtime must pin its exact ledger fingerprint");
    assert.equal(isSha256(runtimeContract.migrationSourceSha256), true,
      "reviewed production runtime must pin its exact source digest");
    assert.equal(new Set(runtimeContract.authorityRpcs).size, runtimeContract.authorityRpcs.length,
      "reviewed production runtime authority RPCs must be unique");
    assert.equal(new Set(runtimeContract.requiredFunctions).size, runtimeContract.requiredFunctions.length,
      "reviewed production runtime functions must be unique");
    assert.deepEqual([...runtimeContract.authorityRpcs].sort(), runtimeAuthorityRpcs,
      "reviewed production runtime must pin exactly one final RPC per authority");
    assert.deepEqual([...runtimeContract.requiredFunctions].sort(), runtimeRequiredFunctions,
      "reviewed production runtime must pin the exact internal function surface");
  }
  const sourcePins = sourceControl.productionSourcePins;
  const baseSourcePinsExact = sourcePins && sourcePins.baselineVersion === contract.database.requiredFoundationVersion &&
      sourcePins.overlayVersion === contract.database.requiredOverlayVersion &&
      sourcePins.overlayMigrationCount === contract.productionRuntimeSurface.baselineMigrationCount &&
      sourcePins.overlaySha256 === contract.database.requiredOverlaySha256 &&
      sourcePins.baselineMigrationCount === 102 &&
      /^sha256:[a-f0-9]{64}$/.test(sourcePins.baselineLedgerFingerprint ?? "") &&
      isSha256(sourcePins.foundationSha256);
  const reviewedRuntimePinsExact = runtimeContract.status !== "reviewed_runtime_migration" ||
    Boolean(sourcePins && sourcePins.internalRuntimeVersion === runtimeContract.ledgerHead &&
      sourcePins.internalRuntimeMigrationCount === runtimeContract.migrationCount &&
      sourcePins.internalRuntimeLedgerFingerprint === runtimeContract.ledgerFingerprint &&
      sourcePins.internalRuntimeSha256 === runtimeContract.migrationSourceSha256);
  if (!baseSourcePinsExact || !reviewedRuntimePinsExact) {
    findings.push("production_source_pins_not_exact");
  }
  const baselineMeasuredSurface = sourceControl.productionRuntimeBaselineSurface;
  if (!baselineMeasuredSurface || baselineMeasuredSurface.migrationCount !== contract.productionRuntimeSurface.baselineMigrationCount ||
    baselineMeasuredSurface.ledgerHead !== contract.productionRuntimeSurface.baselineHead ||
    baselineMeasuredSurface.sourceSha256 !== contract.productionRuntimeSurface.baselineMigrationSourceSha256 ||
    JSON.stringify(baselineMeasuredSurface.authorityRpcs) !== JSON.stringify(contract.productionRuntimeSurface.baselineAuthorityRpcs) ||
    JSON.stringify(baselineMeasuredSurface.blockingPredicates) !== JSON.stringify(contract.productionRuntimeSurface.baselineBlockingPredicates)) {
    findings.push("production_runtime_baseline_surface_not_exact");
  }
  if (phase.requiresProductionRuntime) {
    if (runtimeContract.status !== "reviewed_runtime_migration") {
      findings.push("production_runtime_authority_contract_not_reviewed");
      findings.push("production_runtime_internal_pilot_permit_missing");
    } else {
      // Source identity is an offline integrity assertion only. The merged
      // native/catalog qualification owns the exact-104 catalog contract; this
      // pilot checker neither recreates it nor turns CI into hosted proof.
      const measuredSurface = sourceControl.productionRuntimeSurface;
      const measuredRuntimeAuthorityRpcs = Array.isArray(measuredSurface?.runtimeAuthorityRpcs)
        ? [...measuredSurface.runtimeAuthorityRpcs].sort() : [];
      if (measuredSurface?.migrationCount !== runtimeContract.migrationCount ||
        measuredSurface?.ledgerHead !== runtimeContract.ledgerHead ||
        measuredSurface?.sourceSha256 !== runtimeContract.migrationSourceSha256 ||
        measuredSurface?.ledgerFingerprint !== runtimeContract.ledgerFingerprint ||
        JSON.stringify(measuredRuntimeAuthorityRpcs) !== JSON.stringify([...runtimeContract.authorityRpcs].sort())) {
        findings.push("production_runtime_source_integrity_not_exact");
      }
    }
  }

  exactKeys(contract.productionNativeProvisioning,
    ["status", "sourceCommit", "sourceSha256", "sourcePaths", "profileNames", "deploymentIdentityManifestSha256"],
    "production native provisioning");
  const productionNativeProvisioning = contract.productionNativeProvisioning;
  assert.equal(["pending_reviewed_production_native_profiles", "reviewed_source_pending_execution_environment", "reviewed_production_native_profiles"].includes(productionNativeProvisioning.status), true,
    "production native provisioning status is not closed");
  assert.equal(Array.isArray(productionNativeProvisioning.profileNames), true,
    "production native provisioning profile names must be an array");
  assert.equal(Array.isArray(productionNativeProvisioning.sourcePaths), true,
    "production native provisioning source paths must be an array");
  if (productionNativeProvisioning.status === "pending_reviewed_production_native_profiles") {
    assert.equal(productionNativeProvisioning.sourceCommit, null, "pending native provisioning must not pin unreviewed source");
    assert.equal(productionNativeProvisioning.sourceSha256, null, "pending native provisioning must not pin unreviewed source digest");
    assert.deepEqual(productionNativeProvisioning.sourcePaths, [], "pending native provisioning must not name unreviewed source paths");
    assert.deepEqual(productionNativeProvisioning.profileNames, [], "pending native provisioning must not name unreviewed profiles");
    assert.equal(productionNativeProvisioning.deploymentIdentityManifestSha256, null,
      "pending native provisioning must not pin an unreviewed deployment identity");
  } else {
    assert.match(productionNativeProvisioning.sourceCommit, /^[a-f0-9]{40}$/,
      "reviewed native provisioning must pin a source commit");
    assert.equal(isSha256(productionNativeProvisioning.sourceSha256), true,
      "reviewed native provisioning must pin its source digest");
    assert.equal(productionNativeProvisioning.sourcePaths.length > 0 &&
      new Set(productionNativeProvisioning.sourcePaths).size === productionNativeProvisioning.sourcePaths.length &&
      productionNativeProvisioning.sourcePaths.every((candidate) => typeof candidate === "string" &&
      !candidate.includes("..") && !candidate.endsWith("/") &&
      (candidate.startsWith("tools/native-broker-provisioning/") ||
       [".github/workflows/ci.yml", "package.json", "scripts/run-square-production-overlay-qualification.js"].includes(candidate))), true,
    "reviewed native provisioning must pin exact safe source paths");
    assert.deepEqual([...productionNativeProvisioning.profileNames].sort(), Object.keys(contract.database.loginBindings).sort(),
      "reviewed native provisioning must pin all and only the six Production profiles");
    assert.equal(productionNativeProvisioning.status === "reviewed_source_pending_execution_environment" ||
      isSha256(productionNativeProvisioning.deploymentIdentityManifestSha256), true,
      "reviewed native provisioning must pin its deployment identity before activation");
    requireEqual(sourceControl.productionNativeProvisioning?.sourceExact, true,
      "production_native_provisioning_source_not_exact");
    requireEqual(sourceControl.productionNativeProvisioning?.sourceCommit, productionNativeProvisioning.sourceCommit,
      "production_native_provisioning_source_commit_mismatch");
    requireEqual(sourceControl.productionNativeProvisioning?.sourceSha256, productionNativeProvisioning.sourceSha256,
      "production_native_provisioning_source_sha256_mismatch");
    if (productionNativeProvisioning.status === "reviewed_production_native_profiles") {
      requireEqual(sourceControl.productionNativeProvisioning?.deploymentIdentityManifestSha256,
        productionNativeProvisioning.deploymentIdentityManifestSha256,
        "production_native_provisioning_identity_manifest_mismatch");
    } else {
      findings.push("production_native_execution_identity_pending");
    }
  }
  if (phase.enabledCredentialSlots.some((slot) => slot.startsWith("database")) &&
    productionNativeProvisioning.status !== "reviewed_production_native_profiles") {
    findings.push("production_native_provisioning_profile_not_reviewed");
  }
  const callbackRelease = contract.pilotCallbackRelease;
  exactKeys(callbackRelease, ["status", "sourceCommit", "imageDigest", "scanMarker"], "pilot callback release");
  assert.equal(callbackRelease.status, "pending_immutable_callback_release",
    "pilot callback release must remain pending until the exact scanned image is pinned");
  assert.match(callbackRelease.sourceCommit, /^[a-f0-9]{40}$/, "pilot callback source must be an immutable commit");
  assert.equal(callbackRelease.imageDigest, null, "unscanned callback image must not be named");
  assert.equal(callbackRelease.scanMarker, null, "unscanned callback image must not be treated as eligible");
  if (phase.requiresProductionRuntime) findings.push("pilot_callback_release_not_pinned");

  exactKeys(contract.qualificationBoundary, Object.keys(expectedQualificationBoundary), "qualification boundary");
  requireEqual(contract.qualificationBoundary.scope, expectedQualificationBoundary.scope,
    "qualification_scope_not_sanitized_only");
  requireEqual(contract.qualificationBoundary.privateMappingVerification,
    expectedQualificationBoundary.privateMappingVerification,
    "private_mapping_boundary_not_explicit");
  requireEqual(contract.qualificationBoundary.identifiersAllowedInEvidence,
    expectedQualificationBoundary.identifiersAllowedInEvidence,
    "private_identifiers_must_be_forbidden");
  requireEqual(contract.qualificationBoundary.activationAuthority, expectedQualificationBoundary.activationAuthority,
    "qualification_must_not_grant_activation_authority");

  exactKeys(evidence.operationalChecks, contract.requiredOperationalChecks, "operational checks");
  for (const check of contract.requiredOperationalChecks) {
    if (phase.requiredOperationalChecks.includes(check)) {
      requireEqual(evidence.operationalChecks[check], true, `operational_check_missing:${check}`);
    } else {
      requireEqual(evidence.operationalChecks[check], false, `operational_check_not_permitted:${check}`);
    }
  }
  if (targetPhase === "external_customer_blocked") findings.push("external_customer_activation_forbidden");

  const operatorAssertionsInternallyConsistent = findings.length === 0;
  return Object.freeze({
    contractVersion: contract.contractVersion,
    sourceCommit: expectedHead,
    qualificationScope: expectedQualificationBoundary.scope,
    targetPhase,
    operatorAssertionsInternallyConsistent,
    hostedQualificationProven: false,
    activationReadiness: false,
    privateMappingVerification: expectedQualificationBoundary.privateMappingVerification,
    activationAuthority: expectedQualificationBoundary.activationAuthority,
    gatesRemainClosed: contract.activationGates.every((gate) => evidence.activationGates[gate] === false),
    releasePairChanges: Object.freeze(releasePairChanges),
    findings: Object.freeze([...new Set(findings)].sort())
  });
}

function canonicalJson(value, depth = 0) {
  assert.ok(depth <= 12, "observation nesting exceeds the bounded synthetic contract");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "observation number must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    assert.ok(value.length <= 128, "observation array exceeds the bounded synthetic contract");
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(",")}]`;
  }
  assert.equal(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, true,
    "observation must be a plain JSON object");
  const keys = Object.keys(value).sort();
  assert.ok(keys.length <= 64 && keys.every((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)),
    "observation keys exceed the bounded synthetic contract");
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
}

function canonicalObservation(observation) {
  assert.equal(observation && typeof observation === "object" && !Array.isArray(observation), true,
    "observation must be an object");
  assert.ok(safeIdentifier(observation.providerId), "provider id must be bounded");
  assert.ok(safeIdentifier(observation.sourceVersion), "source version must be bounded");
  assert.ok(safeIdentifier(observation.resourceFamily), "resource family must be bounded");
  assert.ok(typeof observation.operation === "string" && observation.operation.length >= 1 && observation.operation.length <= 191
    && /^[A-Za-z0-9_/-]+$/.test(observation.operation), "operation must be bounded");
  assert.ok(safeIdentifier(observation.authorityScope), "authority scope must be bounded");
  const canonical = canonicalJson(observation);
  assert.ok(Buffer.byteLength(canonical, "utf8") <= 16_384, "observation exceeds the bounded synthetic contract");
  return Object.freeze({
    identity: `${observation.resourceFamily}\u0000${observation.operation}\u0000${observation.authorityScope}\u0000${observation.providerId}\u0000${observation.sourceVersion}`,
    canonical,
    observation: Object.freeze(JSON.parse(canonical))
  });
}

export function createSyntheticPilot({
  workspaceId = "11111111-1111-4111-8111-111111111111",
  businessEntityId = "22222222-2222-4222-8222-222222222222",
  merchantId = "MERCHANT_INTERNAL_1"
} = {}) {
  const state = {
    workspaceId,
    businessEntityId,
    merchantId,
    generation: 0,
    lifecycle: "disconnected",
    pendingAuthorization: null,
    authorizationStates: new Set(),
    mapped: false,
    mappingFingerprint: null,
    locationIds: new Set(),
    checkpoint: null,
    scan: null,
    versions: new Map(),
    receipts: new Map(),
    webhookReceipts: new Set(),
    // Active-generation stores are separate from immutable historical
    // provenance. Evidence and replay checks must never read an older
    // generation after reauthorization.
    archivedVersions: new Map(),
    archivedReceipts: new Map(),
    archivedWebhookReceipts: new Set(),
    refreshes: 0
  };

  const requireCurrentGeneration = (expectedGeneration) => {
    // Generation zero is the deliberately disconnected initial epoch.  It is
    // valid only for beginning consent; every operational path also checks the
    // authorized lifecycle before it can do work.
    assert.ok(Number.isSafeInteger(expectedGeneration) && expectedGeneration >= 0, "expected generation is required");
    assert.equal(expectedGeneration, state.generation, "stale generation is fenced");
  };
  const requireAuthorized = (expectedGeneration) => {
    requireCurrentGeneration(expectedGeneration);
    assert.equal(state.lifecycle, "authorized", "connection is fenced");
  };
  const requireActive = (expectedGeneration) => {
    requireAuthorized(expectedGeneration);
    assert.equal(state.mapped, true, "seller mapping is required");
  };
  const requireAuthorizationTimestamp = (value, label) => {
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a safe timestamp`);
  };
  const clearPendingAuthorization = () => {
    state.pendingAuthorization = null;
  };
  const activateNextGeneration = () => {
    for (const [identity, entry] of state.versions) {
      state.archivedVersions.set(`${state.generation}:${identity}`, entry);
    }
    for (const [receipt, digest] of state.receipts) state.archivedReceipts.set(receipt, digest);
    for (const receipt of state.webhookReceipts) state.archivedWebhookReceipts.add(receipt);
    state.generation += 1;
    state.lifecycle = "authorized";
    state.mapped = false;
    state.locationIds = new Set();
    state.checkpoint = null;
    state.scan = null;
    state.mappingFingerprint = null;
    state.versions = new Map();
    state.receipts = new Map();
    state.webhookReceipts = new Set();
    return state.generation;
  };
  return Object.freeze({
    state,
    beginAuthorization({ expectedGeneration, opaqueState, now, expiresAt }) {
      requireCurrentGeneration(expectedGeneration);
      assert.ok(safeIdentifier(opaqueState), "authorization state must be bounded and opaque");
      requireAuthorizationTimestamp(now, "authorization start");
      requireAuthorizationTimestamp(expiresAt, "authorization expiry");
      assert.ok(expiresAt > now && expiresAt - now <= 600_000,
        "authorization expiry is outside the bounded window");
      assert.ok(!state.authorizationStates.has(opaqueState), "authorization state was already used or fenced");
      assert.ok(state.authorizationStates.size < 64, "authorization state capacity is exhausted");
      state.authorizationStates.add(opaqueState);
      state.pendingAuthorization = Object.freeze({ generation: expectedGeneration, opaqueState, expiresAt });
    },
    completeAuthorization({ expectedGeneration, opaqueState, now }) {
      requireCurrentGeneration(expectedGeneration);
      assert.ok(safeIdentifier(opaqueState), "authorization state must be bounded and opaque");
      requireAuthorizationTimestamp(now, "authorization completion");
      const pending = state.pendingAuthorization;
      assert.ok(pending, "authorization completion is not pending");
      assert.equal(pending.generation, expectedGeneration, "authorization completion is stale");
      assert.equal(pending.opaqueState, opaqueState, "authorization state does not match the current request");
      if (now >= pending.expiresAt) {
        clearPendingAuthorization();
        assert.fail("authorization state expired");
      }
      clearPendingAuthorization();
      return activateNextGeneration();
    },
    confirmMapping({ expectedGeneration, workspaceId: candidateWorkspace, businessEntityId: candidateBusinessEntity, merchantId: candidateMerchant, locationIds }) {
      requireAuthorized(expectedGeneration);
      assert.equal(candidateWorkspace, state.workspaceId, "workspace is not allowlisted");
      assert.equal(candidateBusinessEntity, state.businessEntityId, "business entity is not allowlisted");
      assert.equal(candidateMerchant, state.merchantId, "seller is not allowlisted");
      assert.ok(Array.isArray(locationIds) && locationIds.length > 0 && locationIds.length <= 32 &&
        locationIds.every(safeIdentifier) && new Set(locationIds).size === locationIds.length,
      "explicit location mapping is required");
      const mappingFingerprint = canonicalJson({ workspaceId: candidateWorkspace,
        businessEntityId: candidateBusinessEntity, merchantId: candidateMerchant,
        locationIds: [...locationIds].sort() });
      if (state.mapped) {
        assert.equal(state.mappingFingerprint, mappingFingerprint, "mapping is immutable for the current generation");
        return "replay";
      }
      state.mapped = true;
      state.locationIds = new Set(locationIds);
      state.mappingFingerprint = mappingFingerprint;
      return "confirmed";
    },
    startScan(kind, expectedGeneration, options = {}) {
      requireActive(expectedGeneration);
      assert.equal(state.scan, null, "a scan is already active");
      assert.ok(kind === "initial" || kind === "incremental", "unsupported scan kind");
      if (kind === "incremental") assert.notEqual(state.checkpoint, null, "incremental sync requires a durable checkpoint");
      const source = options.source ?? "payments/list_payments";
      assert.ok(typeof source === "string" && source.length >= 3 && source.length <= 191 &&
        /^[A-Za-z0-9_]+\/[A-Za-z0-9_/-]+$/.test(source), "scan source must be bounded");
      const resourceFamily = source.split("/", 1)[0];
      assert.ok(safeIdentifier(resourceFamily), "scan resource family must be bounded");
      const now = options.now ?? 0;
      const deadlineAt = options.deadlineAt ?? now + 86_400_000;
      const attempt = options.attempt ?? 1;
      if (kind === "initial") {
        assert.equal(source, "payments/list_payments", "initial pilot source must be payments/list_payments");
        assert.ok(Number.isSafeInteger(now) && Number.isSafeInteger(deadlineAt) && deadlineAt > now &&
          deadlineAt - now <= 86_400_000, "initial pilot deadline exceeds 24 hours");
        assert.ok(Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= 3, "initial pilot attempts are bounded");
      }
      state.scan = { kind, source, resourceFamily, deadlineAt, attempt, expectedCursor: null, pages: 0, complete: false, incomplete: false };
    },
    commitPage({ expectedGeneration, receiptId, cursor, nextCursor, observations, cancelled = false, timedOut = false }) {
      requireActive(expectedGeneration);
      assert.ok(state.scan, "no active scan");
      assert.equal(state.scan.incomplete, false, "incomplete scan requires explicit recovery");
      assert.ok(safeIdentifier(receiptId), "receiptId must be bounded");
      assert.ok(Array.isArray(observations), "observations must be an array");
      assert.ok(observations.length <= (state.scan?.kind === "initial" ? 100 : 256),
        "observation page exceeds the bounded synthetic contract");
      const staged = observations.map(canonicalObservation);
      const stagedByIdentity = new Map();
      for (const entry of staged) {
        assert.equal(entry.observation.resourceFamily, state.scan.resourceFamily,
          "observation resource family does not match scan source");
        assert.equal(entry.observation.operation, state.scan.source,
          "observation operation does not match scan source");
        const priorEntry = stagedByIdentity.get(entry.identity);
        assert.ok(!priorEntry || priorEntry.canonical === entry.canonical, "duplicate source version payload changed within page");
        stagedByIdentity.set(entry.identity, entry);
      }
      const receiptKey = `${expectedGeneration}:${receiptId}`;
      const digest = canonicalJson({ generation: expectedGeneration, cursor, nextCursor, observations: staged.map((entry) => entry.observation) });
      const prior = state.receipts.get(receiptKey);
      if (prior) {
        assert.equal(prior, digest, "receipt replay payload changed");
        return Object.freeze({ outcome: "replay", committed: true, inserted: 0 });
      }
      assert.equal(state.scan.complete, false, "no active scan");
      if (state.scan.kind === "initial") {
        assert.equal(cursor, null, "initial payments page must start at the empty cursor");
        assert.equal(nextCursor, null, "initial payments page must not continue pagination");
        assert.equal(state.scan.pages, 0, "initial payments scan accepts one page only");
      }
      assert.equal(cursor, state.scan.expectedCursor, "cursor does not match durable scan state");
      assert.ok(nextCursor === null || typeof nextCursor === "string" && nextCursor.length > 0 && nextCursor.length <= 4_096,
        "next cursor must be null or a bounded opaque value");
      if (cancelled || timedOut) {
        state.scan.incomplete = true;
        state.scan.outcome = cancelled ? "cancelled" : "timeout";
        return Object.freeze({ outcome: cancelled ? "cancelled" : "timeout", committed: false });
      }
      for (const entry of stagedByIdentity.values()) {
        const existing = state.versions.get(entry.identity);
        assert.ok(!existing || existing.canonical === entry.canonical, "immutable source version payload changed");
      }
      let inserted = 0;
      for (const entry of stagedByIdentity.values()) {
        if (!state.versions.has(entry.identity)) {
          state.versions.set(entry.identity, entry);
          inserted += 1;
        }
      }
      state.receipts.set(receiptKey, digest);
      state.scan.pages += 1;
      state.scan.expectedCursor = nextCursor;
      if (nextCursor === null) {
        state.scan.complete = true;
        state.checkpoint = `${state.generation}:${state.scan.kind}:${state.scan.pages}`;
      }
      return Object.freeze({ outcome: "committed", committed: true, inserted });
    },
    finishScan(expectedGeneration) {
      requireActive(expectedGeneration);
      assert.equal(state.scan?.incomplete, false, "incomplete scan requires explicit recovery");
      assert.equal(state.scan?.complete, true, "pagination is incomplete");
      state.scan = null;
      return state.checkpoint;
    },
    refresh({ expectedGeneration, outcome }) {
      requireActive(expectedGeneration);
      if (outcome !== "success") {
        state.lifecycle = "refresh_failed";
        state.scan = null;
        return false;
      }
      state.refreshes += 1;
      return true;
    },
    receiveWebhook({ expectedGeneration, eventId }) {
      requireActive(expectedGeneration);
      assert.ok(safeIdentifier(eventId), "event id must be bounded");
      const receiptKey = `${expectedGeneration}:${eventId}`;
      if (state.webhookReceipts.has(receiptKey)) return "duplicate";
      state.webhookReceipts.add(receiptKey);
      return "accepted";
    },
    readEvidence({ expectedGeneration, actorWorkspaceId, actorBusinessEntityId, actorMerchantId }) {
      requireActive(expectedGeneration);
      if (actorWorkspaceId !== state.workspaceId || actorBusinessEntityId !== state.businessEntityId
        || actorMerchantId !== state.merchantId) {
        assert.fail("evidence authority denied");
      }
      const byFamily = {};
      for (const entry of state.versions.values()) {
        const family = entry.observation.resourceFamily;
        byFamily[family] = (byFamily[family] ?? 0) + 1;
      }
      return Object.freeze({
        authority: "evidence_v1",
        status: "verified_non_economic_observations",
        observationCount: state.versions.size,
        observationsByFamily: Object.freeze(byFamily),
        checkpoint: state.checkpoint,
        incomplete: state.scan !== null && (!state.scan.complete || state.scan.incomplete),
        history: state.checkpoint === null ? "unknown" : "partial"
      });
    },
    disconnect({ expectedGeneration }) {
      requireCurrentGeneration(expectedGeneration);
      clearPendingAuthorization();
      state.lifecycle = "disconnected";
      state.mapped = false;
      state.locationIds = new Set();
      state.mappingFingerprint = null;
      state.scan = null;
    },
    revoke({ expectedGeneration }) {
      requireCurrentGeneration(expectedGeneration);
      clearPendingAuthorization();
      state.lifecycle = "revoked";
      state.mapped = false;
      state.locationIds = new Set();
      state.mappingFingerprint = null;
      state.scan = null;
    }
  });
}
