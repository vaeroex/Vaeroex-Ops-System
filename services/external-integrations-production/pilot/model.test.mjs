import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSyntheticPilot, loadJson, qualifyPilotEvidence } from "./model.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const contract = loadJson(path.join(directory, "contract.json"));
const baseline = loadJson(path.join(directory, "pilot-state.example.json"));
const head = baseline.sourceCommit;

// Focused scenarios: initialSync, incrementalSync, pagination, replay, refresh,
// webhookDeduplication, disconnect, providerRevocation, cancellation, timeout,
// lostAcknowledgement.

test("the checked-in Production baseline is closed and accurately blocked", () => {
  const result = qualifyPilotEvidence(contract, baseline, head);
  assert.equal(result.readyForOneCustomerActivationReview, false);
  assert.equal(result.gatesRemainClosed, true);
  assert.ok(result.findings.includes("square_overlay_missing"));
  assert.ok(result.findings.includes("callback_layer_unqualified"));
  assert.ok(result.findings.includes("exactly_one_workspace_required"));
  for (const slot of contract.credentialSlots) assert.ok(result.findings.includes(`credential_version_missing:${slot}`));
});

test("one mapped internal seller can reach review while every gate stays closed", () => {
  const evidence = structuredClone(baseline);
  evidence.database.squareOverlayApplied = true;
  evidence.database.loginBindingsVerified = true;
  evidence.callbackLayerQualified = true;
  for (const slot of contract.credentialSlots) evidence.credentialVersionsPresent[slot] = true;
  evidence.pilotAllowlist = [{
    workspaceId: "11111111-1111-4111-8111-111111111111",
    merchantId: "MERCHANT_INTERNAL_1",
    businessEntityId: "ENTITY_INTERNAL_1",
    locationIds: ["LOCATION_INTERNAL_1"],
    internalSeller: true,
    mappingConfirmed: true
  }];
  for (const check of contract.requiredOperationalChecks) evidence.operationalChecks[check] = true;
  const result = qualifyPilotEvidence(contract, evidence, head);
  assert.deepEqual(result.findings, []);
  assert.equal(result.readyForOneCustomerActivationReview, true);
  assert.equal(result.gatesRemainClosed, true);

  evidence.activationGates.economicContributionsEnabled = true;
  const economic = qualifyPilotEvidence(contract, evidence, head);
  assert.equal(economic.readyForOneCustomerActivationReview, false);
  assert.ok(economic.findings.includes("gate_must_remain_closed:economicContributionsEnabled"));
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
