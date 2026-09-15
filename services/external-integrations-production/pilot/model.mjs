import assert from "node:assert/strict";
import fs from "node:fs";

const allowedEvidenceKeys = new Set([
  "contractVersion", "sourceCommit", "projectId", "region", "hostname", "callbackUrl", "webhookUrl",
  "database", "callbackLayerQualified", "credentialVersionsPresent", "activationGates", "pilotAllowlist",
  "operationalChecks"
]);

function exactKeys(value, keys, label) {
  assert.equal(value && typeof value === "object" && !Array.isArray(value), true, `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys differ from the closed contract`);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 191 && /^[A-Za-z0-9_-]+$/.test(value);
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

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function qualifyPilotEvidence(contract, evidence, expectedHead) {
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
  for (const field of ["projectId", "region", "hostname", "callbackUrl", "webhookUrl"]) {
    requireEqual(evidence[field], contract[field], `${field}_mismatch`);
  }

  exactKeys(evidence.database, ["ledgerHead", "foundationApplied", "squareOverlayApplied", "loginBindingsVerified", "directTablePrivilegesAbsent"], "database evidence");
  requireEqual(evidence.database.ledgerHead, contract.database.requiredFoundationVersion, "database_ledger_not_exact_foundation");
  requireEqual(evidence.database.foundationApplied, true, "production_foundation_missing");
  requireEqual(evidence.database.squareOverlayApplied, true, "square_overlay_missing");
  requireEqual(evidence.database.loginBindingsVerified, true, "login_bindings_unverified");
  requireEqual(evidence.database.directTablePrivilegesAbsent, true, "direct_table_privilege_detected");
  requireEqual(evidence.callbackLayerQualified, true, "callback_layer_unqualified");

  exactKeys(evidence.credentialVersionsPresent, contract.credentialSlots, "credential version evidence");
  for (const slot of contract.credentialSlots) requireEqual(evidence.credentialVersionsPresent[slot], true, `credential_version_missing:${slot}`);

  exactKeys(evidence.activationGates, contract.activationGates, "activation gates");
  for (const gate of contract.activationGates) requireEqual(evidence.activationGates[gate], false, `gate_must_remain_closed:${gate}`);

  assert.equal(Array.isArray(evidence.pilotAllowlist), true, "pilotAllowlist must be an array");
  if (evidence.pilotAllowlist.length !== 1) findings.push("exactly_one_workspace_required");
  const sellerKeys = ["workspaceId", "merchantId", "businessEntityId", "locationIds", "internalSeller", "mappingConfirmed"];
  for (const [index, seller] of evidence.pilotAllowlist.entries()) {
    exactKeys(seller, sellerKeys, `pilotAllowlist[${index}]`);
    if (!isUuid(seller.workspaceId)) findings.push(`invalid_workspace_id:${index}`);
    for (const field of ["merchantId", "businessEntityId"]) if (!safeIdentifier(seller[field])) findings.push(`invalid_${field}:${index}`);
    if (!Array.isArray(seller.locationIds) || seller.locationIds.length < 1 ||
      new Set(seller.locationIds).size !== seller.locationIds.length || seller.locationIds.some((value) => !safeIdentifier(value))) {
      findings.push(`invalid_location_mapping:${index}`);
    }
    requireEqual(seller.internalSeller, true, `seller_not_internal:${index}`);
    requireEqual(seller.mappingConfirmed, true, `seller_mapping_unconfirmed:${index}`);
  }
  if (new Set(evidence.pilotAllowlist.map(({ workspaceId }) => workspaceId)).size !== evidence.pilotAllowlist.length) {
    findings.push("duplicate_workspace_allowlist_entry");
  }
  if (new Set(evidence.pilotAllowlist.map(({ merchantId }) => merchantId)).size !== evidence.pilotAllowlist.length) {
    findings.push("duplicate_merchant_allowlist_entry");
  }

  exactKeys(evidence.operationalChecks, contract.requiredOperationalChecks, "operational checks");
  for (const check of contract.requiredOperationalChecks) requireEqual(evidence.operationalChecks[check], true, `operational_check_missing:${check}`);

  return Object.freeze({
    contractVersion: contract.contractVersion,
    sourceCommit: evidence.sourceCommit,
    readyForOneCustomerActivationReview: findings.length === 0,
    gatesRemainClosed: contract.activationGates.every((gate) => evidence.activationGates[gate] === false),
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
