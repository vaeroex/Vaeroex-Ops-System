import assert from "node:assert/strict";
import fs from "node:fs";

const allowedEvidenceKeys = new Set([
  "contractVersion", "sourceCommit", "projectId", "region", "hostname", "callbackUrl", "webhookUrl",
  "database", "productionReleaseDeployment", "credentialVersionsPresent", "activationGates", "pilotScopeCounts",
  "operationalChecks"
]);
const expectedQualificationBoundary = Object.freeze({
  scope: "sanitized_preflight_only",
  privateMappingVerification: "required_outside_qualifier",
  identifiersAllowedInEvidence: false,
  activationAuthority: "not_granted"
});

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

export function qualifyPilotEvidence(contract, evidence, expectedHead, sourceControl = {}) {
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

  requireEqual(evidence.contractVersion, "square_production_internal_seller_pilot_evidence_v1", "evidence_contract_mismatch");
  requireEqual(evidence.sourceCommit, expectedHead, "source_commit_mismatch");
  requireEqual(sourceControl.sourceCommit, expectedHead, "qualification_source_head_mismatch");
  requireEqual(sourceControl.qualificationSourcesExact, true, "qualification_sources_not_exact_head");
  for (const field of ["projectId", "region", "hostname", "callbackUrl", "webhookUrl"]) {
    requireEqual(evidence[field], contract[field], `${field}_mismatch`);
  }

  exactKeys(evidence.database, ["ledgerHead", "foundationVersion", "overlayPath", "overlaySourceCommit", "overlaySha256", "overlayObjectPostflight"], "database evidence");
  requireEqual(evidence.database.ledgerHead, contract.database.requiredOverlayVersion, "database_ledger_not_exact_overlay");
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
    requireEqual(metadata.version, 1, `credential_version_not_one:${slot}`);
    requireEqual(metadata.state, "ENABLED", `credential_version_not_enabled:${slot}`);
    requireEqual(metadata.totalCount, 1, `credential_version_count_not_one:${slot}`);
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
  requireEqual(evidence.pilotScopeCounts.allowlistEntryCount, 1, "exactly_one_allowlist_entry_required");
  requireEqual(evidence.pilotScopeCounts.distinctWorkspaceCount, 1, "exactly_one_workspace_required");
  requireEqual(evidence.pilotScopeCounts.distinctSellerCount, 1, "exactly_one_seller_required");

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
  for (const check of contract.requiredOperationalChecks) requireEqual(evidence.operationalChecks[check], true, `operational_check_missing:${check}`);

  return Object.freeze({
    contractVersion: contract.contractVersion,
    sourceCommit: expectedHead,
    qualificationScope: expectedQualificationBoundary.scope,
    sanitizedPreflightPassed: findings.length === 0,
    privateMappingVerification: expectedQualificationBoundary.privateMappingVerification,
    activationAuthority: expectedQualificationBoundary.activationAuthority,
    gatesRemainClosed: contract.activationGates.every((gate) => evidence.activationGates[gate] === false),
    releasePairChanges: Object.freeze(releasePairChanges),
    findings: Object.freeze([...new Set(findings)].sort())
  });
}

export function createSyntheticPilot({ workspaceId = "11111111-1111-4111-8111-111111111111", merchantId = "MERCHANT_INTERNAL_1" } = {}) {
  const state = {
    workspaceId,
    merchantId,
    generation: 0,
    lifecycle: "disconnected",
    mapped: false,
    checkpoint: null,
    scan: null,
    versions: new Map(),
    receipts: new Map(),
    webhookReceipts: new Set(),
    refreshes: 0
  };

  const requireActive = () => {
    assert.equal(state.lifecycle, "authorized", "connection is fenced");
    assert.equal(state.mapped, true, "seller mapping is required");
  };
  return Object.freeze({
    state,
    authorize() {
      state.generation += 1;
      state.lifecycle = "authorized";
      state.mapped = false;
      state.checkpoint = null;
      state.scan = null;
      return state.generation;
    },
    confirmMapping({ workspaceId: candidateWorkspace, merchantId: candidateMerchant, locationIds }) {
      assert.equal(candidateWorkspace, state.workspaceId, "workspace is not allowlisted");
      assert.equal(candidateMerchant, state.merchantId, "seller is not allowlisted");
      assert.ok(Array.isArray(locationIds) && locationIds.length > 0, "explicit location mapping is required");
      state.mapped = true;
    },
    startScan(kind) {
      requireActive();
      assert.equal(state.scan, null, "a scan is already active");
      assert.ok(kind === "initial" || kind === "incremental", "unsupported scan kind");
      if (kind === "incremental") assert.notEqual(state.checkpoint, null, "incremental sync requires a durable checkpoint");
      state.scan = { kind, expectedCursor: null, pages: 0, complete: false };
    },
    commitPage({ receiptId, cursor, nextCursor, observations, cancelled = false, timedOut = false }) {
      requireActive();
      assert.ok(safeIdentifier(receiptId), "receiptId must be bounded");
      assert.ok(Array.isArray(observations), "observations must be an array");
      const prior = state.receipts.get(receiptId);
      const digest = JSON.stringify({ generation: state.generation, cursor, nextCursor, observations });
      if (prior) {
        assert.equal(prior, digest, "receipt replay payload changed");
        return Object.freeze({ outcome: "replay", committed: true, inserted: 0 });
      }
      assert.ok(state.scan && !state.scan.complete, "no active scan");
      assert.equal(cursor, state.scan.expectedCursor, "cursor does not match durable scan state");
      assert.ok(nextCursor === null || typeof nextCursor === "string" && nextCursor.length > 0 && nextCursor.length <= 4_096,
        "next cursor must be null or a bounded opaque value");
      if (cancelled || timedOut) return Object.freeze({ outcome: cancelled ? "cancelled" : "timeout", committed: false });
      let inserted = 0;
      for (const observation of observations) {
        assert.ok(safeIdentifier(observation.id), "observation id must be bounded");
        const identity = JSON.stringify(observation);
        if (!state.versions.has(identity)) {
          state.versions.set(identity, Object.freeze({ ...observation }));
          inserted += 1;
        }
      }
      state.receipts.set(receiptId, digest);
      state.scan.pages += 1;
      state.scan.expectedCursor = nextCursor;
      if (nextCursor === null) {
        state.scan.complete = true;
        state.checkpoint = `${state.generation}:${state.scan.kind}:${state.scan.pages}`;
      }
      return Object.freeze({ outcome: "committed", committed: true, inserted });
    },
    finishScan() {
      assert.equal(state.scan?.complete, true, "pagination is incomplete");
      state.scan = null;
      return state.checkpoint;
    },
    refresh(outcome) {
      requireActive();
      if (outcome !== "success") {
        state.lifecycle = "refresh_failed";
        state.scan = null;
        return false;
      }
      state.refreshes += 1;
      return true;
    },
    receiveWebhook(eventId) {
      requireActive();
      assert.ok(safeIdentifier(eventId), "event id must be bounded");
      if (state.webhookReceipts.has(eventId)) return "duplicate";
      state.webhookReceipts.add(eventId);
      return "accepted";
    },
    disconnect() {
      state.lifecycle = "disconnected";
      state.scan = null;
    },
    revoke() {
      state.lifecycle = "revoked";
      state.scan = null;
    }
  });
}
