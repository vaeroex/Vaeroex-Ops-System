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

function reviewCandidate() {
  const evidence = structuredClone(baseline);
  evidence.database.ledgerHead = contract.database.requiredOverlayVersion;
  evidence.database.overlayPath = contract.database.requiredOverlayPath;
  evidence.database.overlaySourceCommit = overlaySourceCommit;
  evidence.database.overlaySha256 = overlaySha256;
  evidence.database.overlayObjectPostflight = contract.database.requiredPostflight;
  evidence.productionReleaseDeployment = {
    sharedBootstrapSourceCommit, sharedBootstrapImageDigest,
    callbackEdgeSourceCommit, callbackEdgeImageDigest,
    oauthCallbackSourceCommit, oauthCallbackImageDigest
  };
  for (const slot of contract.credentialSlots) {
    evidence.credentialVersionsPresent[slot] = { version: 1, state: "ENABLED", totalCount: 1 };
  }
  evidence.pilotAllowlist = [{
    workspaceId: "11111111-1111-4111-8111-111111111111",
    merchantId: "MERCHANT_INTERNAL_1",
    businessEntityId: "ENTITY_INTERNAL_1",
    locationIds: ["LOCATION_INTERNAL_1"],
    internalSeller: true,
    mappingConfirmed: true
  }];
  for (const check of contract.requiredOperationalChecks) evidence.operationalChecks[check] = true;
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
  sourceOverlaySha256: overlaySha256
};

// Focused scenarios: initialSync, incrementalSync, pagination, replay, refresh,
// webhookDeduplication, disconnect, providerRevocation, cancellation, timeout,
// lostAcknowledgement.

test("the checked-in Production baseline is closed and accurately blocked", () => {
  const result = qualifyPilotEvidence(contract, baseline, head);
  assert.equal(result.readyForOneCustomerActivationReview, false);
  assert.equal(result.gatesRemainClosed, true);
  assert.ok(result.findings.includes("database_ledger_not_exact_overlay"));
  assert.ok(result.findings.includes("qualification_source_head_mismatch"));
  assert.ok(result.findings.includes("square_overlay_path_mismatch"));
  assert.ok(result.findings.includes("reviewed_overlay_source_not_in_qualification_head"));
  assert.ok(result.findings.includes("square_overlay_source_commit_mismatch"));
  assert.ok(result.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
  assert.ok(result.findings.includes("square_overlay_sha256_mismatch"));
  assert.ok(result.findings.includes("database_overlay_object_postflight_missing"));
  assert.ok(result.findings.includes("production_release_deployment_mismatch:sharedBootstrapSourceCommit"));
  assert.ok(result.findings.includes("exactly_one_workspace_required"));
  for (const slot of contract.credentialSlots) {
    assert.ok(result.findings.includes(`credential_version_not_one:${slot}`));
    assert.ok(result.findings.includes(`credential_version_not_enabled:${slot}`));
    assert.ok(result.findings.includes(`credential_version_count_not_one:${slot}`));
  }
});

test("one mapped internal seller can reach review while every gate stays closed", () => {
  const evidence = reviewCandidate();
  const result = qualifyPilotEvidence(reviewedContract(), evidence, head, reviewedSource);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.releasePairChanges, ["oauthCallback", "callbackEdge"]);
  assert.equal(result.readyForOneCustomerActivationReview, true);
  assert.equal(result.gatesRemainClosed, true);

  evidence.activationGates.economicContributionsEnabled = true;
  const economic = qualifyPilotEvidence(reviewedContract(), evidence, head, reviewedSource);
  assert.equal(economic.readyForOneCustomerActivationReview, false);
  assert.ok(economic.findings.includes("gate_must_remain_closed:economicContributionsEnabled"));
});

test("review requires exact overlay, full production release and version-one credential metadata", () => {
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
    [(e) => { e.credentialVersionsPresent.application.totalCount = 2; }, "credential_version_count_not_one:application"]
  ]) {
    const evidence = structuredClone(baselineCandidate);
    mutate(evidence);
    const result = qualifyPilotEvidence(reviewed, evidence, head, reviewedSource);
    assert.equal(result.readyForOneCustomerActivationReview, false);
    assert.ok(result.findings.includes(expected), expected);
  }
});

test("the reviewed overlay must exist in the source tree with the pinned bytes", () => {
  const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head);
  assert.equal(result.readyForOneCustomerActivationReview, false);
  assert.ok(result.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
});

test("qualification logic and contract bytes must match the immutable head", () => {
  const source = { ...reviewedSource, qualificationSourcesExact: false };
  const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head, source);
  assert.equal(result.readyForOneCustomerActivationReview, false);
  assert.ok(result.findings.includes("qualification_sources_not_exact_head"));
});

test("every reviewed release source must be included in the qualification head", () => {
  for (const field of ["sharedBootstrapSourceCommit", "callbackEdgeSourceCommit", "oauthCallbackSourceCommit"]) {
    const source = {
      ...reviewedSource,
      sourceCommitsIncluded: { ...reviewedSource.sourceCommitsIncluded, [field]: false }
    };
    const result = qualifyPilotEvidence(reviewedContract(), reviewCandidate(), head, source);
    assert.equal(result.readyForOneCustomerActivationReview, false);
    assert.ok(result.findings.includes(`reviewed_release_source_not_in_qualification_head:${field}`));
  }
});

test("each changed release pair advances its source and digest together", () => {
  const reviewed = reviewedContract();
  reviewed.reviewedProductionRelease.oauthCallbackSourceCommit = reviewed.priorProductionRelease.oauthCallbackSourceCommit;
  const result = qualifyPilotEvidence(reviewed, reviewCandidate(), head, reviewedSource);
  assert.equal(result.readyForOneCustomerActivationReview, false);
  assert.ok(result.findings.includes("release_pair_change_mismatch:oauthCallback"));
});

test("evidence is exact, one-customer only, and cannot carry credential material", () => {
  assert.throws(() => qualifyPilotEvidence(contract, { ...baseline, password: "synthetic-canary" }, head), /closed contract/);
  const leaked = structuredClone(baseline);
  leaked.projectId = "postgresql://synthetic.example.invalid/db";
  assert.throws(() => qualifyPilotEvidence(contract, leaked, head), /credential material is forbidden/);
  assert.throws(() => qualifyPilotEvidence(contract, baseline, "main"), /immutable Git commit/);

  const duplicate = structuredClone(baseline);
  duplicate.pilotAllowlist = [0, 1].map(() => ({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    merchantId: "MERCHANT_INTERNAL_1",
    businessEntityId: "ENTITY_INTERNAL_1",
    locationIds: ["LOCATION_INTERNAL_1"],
    internalSeller: true,
    mappingConfirmed: true
  }));
  const result = qualifyPilotEvidence(contract, duplicate, head);
  assert.ok(result.findings.includes("exactly_one_workspace_required"));
  assert.ok(result.findings.includes("duplicate_workspace_allowlist_entry"));
  assert.ok(result.findings.includes("duplicate_merchant_allowlist_entry"));
});

test("initial pagination, cancellation, timeout, replay and lost acknowledgement remain atomic", () => {
  const pilot = createSyntheticPilot();
  pilot.authorize();
  pilot.confirmMapping({
    workspaceId: pilot.state.workspaceId,
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_INTERNAL_1"]
  });
  pilot.startScan("initial");

  const first = pilot.commitPage({
    receiptId: "INITIAL_PAGE_1", cursor: null, nextCursor: "CURSOR_1",
    observations: [{ id: "PAYMENT_1", revision: "1" }]
  });
  assert.deepEqual(first, { outcome: "committed", committed: true, inserted: 1 });
  const beforeInterrupted = { versions: pilot.state.versions.size, receipts: pilot.state.receipts.size };
  assert.equal(pilot.commitPage({
    receiptId: "INITIAL_PAGE_2_CANCELLED", cursor: "CURSOR_1", nextCursor: null,
    observations: [{ id: "PAYMENT_2", revision: "1" }], cancelled: true
  }).outcome, "cancelled");
  assert.equal(pilot.commitPage({
    receiptId: "INITIAL_PAGE_2_TIMEOUT", cursor: "CURSOR_1", nextCursor: null,
    observations: [{ id: "PAYMENT_2", revision: "1" }], timedOut: true
  }).outcome, "timeout");
  assert.deepEqual({ versions: pilot.state.versions.size, receipts: pilot.state.receipts.size }, beforeInterrupted);

  const finalRequest = {
    receiptId: "INITIAL_PAGE_2", cursor: "CURSOR_1", nextCursor: null,
    observations: [{ id: "PAYMENT_2", revision: "1" }]
  };
  assert.equal(pilot.commitPage(finalRequest).outcome, "committed");
  assert.equal(pilot.commitPage(finalRequest).outcome, "replay", "lost acknowledgement retries the identical receipt");
  assert.throws(() => pilot.commitPage({ ...finalRequest, observations: [{ id: "PAYMENT_CHANGED" }] }), /replay payload changed/);
  assert.match(pilot.finishScan(), /^1:initial:2$/);
});

test("incremental sync, refresh and webhook dedup preserve the active generation", () => {
  const pilot = createSyntheticPilot();
  const generation = pilot.authorize();
  pilot.confirmMapping({ workspaceId: pilot.state.workspaceId, merchantId: pilot.state.merchantId, locationIds: ["LOCATION_1"] });
  pilot.startScan("initial");
  pilot.commitPage({ receiptId: "BASELINE", cursor: null, nextCursor: null, observations: [{ id: "ORDER_1" }] });
  pilot.finishScan();

  assert.equal(pilot.refresh("success"), true);
  assert.equal(pilot.state.generation, generation);
  pilot.startScan("incremental");
  assert.equal(pilot.commitPage({
    receiptId: "INCREMENTAL_1", cursor: null, nextCursor: null,
    observations: [{ id: "ORDER_1" }, { id: "ORDER_2" }]
  }).inserted, 1, "overlap replay does not duplicate an immutable source version");
  pilot.finishScan();
  assert.equal(pilot.receiveWebhook("WEBHOOK_1"), "accepted");
  assert.equal(pilot.receiveWebhook("WEBHOOK_1"), "duplicate");
});

test("refresh failure, disconnect and provider revocation fence later work", () => {
  for (const close of ["refresh", "disconnect", "revoke"]) {
    const pilot = createSyntheticPilot();
    pilot.authorize();
    pilot.confirmMapping({ workspaceId: pilot.state.workspaceId, merchantId: pilot.state.merchantId, locationIds: ["LOCATION_1"] });
    if (close === "refresh") assert.equal(pilot.refresh("invalid_grant"), false);
    else pilot[close]();
    assert.throws(() => pilot.startScan("initial"), /connection is fenced/, close);
    assert.throws(() => pilot.receiveWebhook("WEBHOOK_AFTER_CLOSE"), /connection is fenced/, close);
  }
});

test("mapping and incremental sync fail closed without explicit prerequisites", () => {
  const pilot = createSyntheticPilot();
  pilot.authorize();
  assert.throws(() => pilot.confirmMapping({
    workspaceId: "22222222-2222-4222-8222-222222222222",
    merchantId: pilot.state.merchantId,
    locationIds: ["LOCATION_1"]
  }), /workspace is not allowlisted/);
  pilot.confirmMapping({ workspaceId: pilot.state.workspaceId, merchantId: pilot.state.merchantId, locationIds: ["LOCATION_1"] });
  assert.throws(() => pilot.startScan("incremental"), /durable checkpoint/);
});
