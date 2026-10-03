import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { applyReviewedPrivateAccessPlan } from "../scripts/apply-reviewed-private-access-plan.mjs";
import { startExecution, readExecution, recordProgress } from "../scripts/run-reviewed-private-access-plan.mjs";
import { OAUTH_PROOF_MODE, OAUTH_PROOF_ROLE, OAUTH_PROOF_PERMISSIONS, OAUTH_PROOF_TITLE,
  OAUTH_PROOF_DESCRIPTION, oauthProofCondition } from "../scripts/oauth-candidate-proof-contract.mjs";

const root = mkdtempSync(join(tmpdir(), "vaeroex-reviewed-apply-test-"));
const planPath = join(root, "candidate.tfplan");
writeFileSync(planPath, Buffer.from("opaque-saved-plan"), { mode: 0o600 });
const reviewedSha256 = createHash("sha256").update("opaque-saved-plan").digest("hex");
const closedPlanVariables = Object.freeze({
  administrative_access_enabled: { value: false },
  setup_https_enabled: { value: false },
  temporary_access_enabled: { value: false },
  temporary_access_profiles: { value: [] },
  previous_access_expires_at: { value: "2098-12-31T23:00:00Z" },
});
const openPlanVariables = Object.freeze({
  administrative_access_enabled: { value: true },
  setup_https_enabled: { value: false },
  temporary_access_enabled: { value: true },
  temporary_access_profiles: { value: ["oauth"] },
  previous_access_expires_at: { value: "2099-01-01T01:00:00Z" },
});
const administrativePlanVariables = Object.freeze({
  administrative_access_enabled: { value: true },
  setup_https_enabled: { value: false },
  temporary_access_enabled: { value: false },
  temporary_access_profiles: { value: [] },
  previous_access_expires_at: { value: "2099-01-01T01:00:00Z" },
});

const generation = {
  address: "terraform_data.private_access_generation",
  type: "terraform_data",
  name: "private_access_generation",
  change: {
    actions: ["create"],
    before: null,
    after: {
      input: {
        enabled: false,
        profiles: [],
        starts_at: "2099-01-01T00:00:00Z",
        expires_at: "2099-01-01T01:00:00Z",
        checkpoint_expires_at: "2098-12-31T23:00:00Z",
      },
    },
  },
};
const validJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: closedPlanVariables,
  resource_changes: [generation],
}));
const confirmedReconciliation = Object.freeze({
  status: "private_access_exact_direct_binding_reconciliation_confirmed",
  checked_secrets: "6",
  removed_bindings: "0",
});

const calls = [];
const success = applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  environment: {
    ...process.env,
    VAEROEX_SAFE_ENVIRONMENT_SENTINEL: "preserved",
    TF_LOG: "TRACE",
    TF_LOG_CORE: "DEBUG",
    TF_LOG_PROVIDER: "INFO",
    TF_LOG_PATH: join(root, "terraform.log"),
    TF_LOG_SDK: "TRACE",
    TF_LOG_SDK_PROTO_DATA_DIR: join(root, "terraform-protocol-logs"),
  },
  temporaryRoot: root,
  confirmClosedPrivateAccess() {
    return { status: "private_access_exact_direct_binding_absence_confirmed", checked_secrets: "6" };
  },
  waitForRevocationPropagation(milliseconds) { assert.equal(milliseconds, 600_000); },
  verifyEffectivePrivateAccess() {
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "0", checked_tuples: "6" };
  },
  runTerraform(args, options) {
    calls.push({ args, options, bytes: readFileSync(args.at(-1)) });
    return args[0] === "show"
      ? { status: 0, stdout: validJson, stderr: Buffer.from("raw-show-stderr-must-not-surface") }
      : {
          status: 0,
          stdout: Buffer.from("raw-apply-stdout-must-not-surface"),
          stderr: Buffer.from("raw-apply-stderr-must-not-surface"),
        };
  },
});
assert.equal(success.verificationLabel, "private_access_plan_closed_bootstrap_confirmed");
assert.equal(success.reconciliationLabel, "private_access_exact_direct_binding_absence_confirmed");
assert.equal(success.effectiveRevocationLabel, "policy_troubleshooter_closed_all_denied");
assert.equal(success.resultLabel, "private_access_verified_plan_apply_completed");
assert.match(success.planSha256, /^[a-f0-9]{64}$/);
assert.deepEqual(calls.map(call => call.args.slice(0, 2)), [["show", "-json"], ["apply", "-input=false"]]);
assert.deepEqual(calls[1].args.slice(0, -1), ["apply", "-input=false", "-json"]);
assert.equal(calls[0].args.at(-1), calls[1].args.at(-1));
assert.notEqual(calls[0].args.at(-1), planPath);
assert.deepEqual(calls[0].bytes, Buffer.from("opaque-saved-plan"));
assert.deepEqual(calls[1].bytes, Buffer.from("opaque-saved-plan"));
for (const call of calls) {
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(call.options.env.VAEROEX_SAFE_ENVIRONMENT_SENTINEL, "preserved");
  assert.equal(Object.keys(call.options.env).some(name => /^TF_LOG(?:_|$)/.test(name)), false);
}
assert.equal(JSON.stringify(success).includes("raw-"), false);
assert.equal(existsSync(join(root, "terraform.log")), false);
assert.equal(existsSync(join(root, "terraform-protocol-logs")), false);
assert.deepEqual(readdirSync(root), ["candidate.tfplan"]);

const closedNoTransitionGeneration = {
  address: "terraform_data.private_access_generation",
  type: "terraform_data",
  name: "private_access_generation",
  change: {
    actions: ["no-op"],
    before: { input: {
      enabled: false,
      profiles: [],
      starts_at: "2099-01-01T00:00:00Z",
      expires_at: "2099-01-01T01:00:00Z",
      checkpoint_expires_at: "2099-01-01T01:00:00Z",
    } },
    after: { input: {
      enabled: false,
      profiles: [],
      starts_at: "2099-01-01T00:00:00Z",
      expires_at: "2099-01-01T01:00:00Z",
      checkpoint_expires_at: "2099-01-01T01:00:00Z",
    } },
  },
};
const closedNoTransitionJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: closedPlanVariables,
  resource_changes: [closedNoTransitionGeneration],
}));
const closedRecoveryOrder = [];
const closedRecovery = applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  confirmClosedPrivateAccess() {
    closedRecoveryOrder.push("confirm-closed");
    return { status: "private_access_exact_direct_binding_absence_confirmed", checked_secrets: "6" };
  },
  waitForRevocationPropagation(milliseconds) {
    closedRecoveryOrder.push("wait");
    assert.equal(milliseconds, 600_000);
  },
  verifyEffectivePrivateAccess(query) {
    closedRecoveryOrder.push("effective");
    assert.equal(query.phase, "closed");
    assert.equal(query.window_starts_at, "2099-01-01T00:00:00Z");
    assert.equal(query.window_expires_at, "2099-01-01T01:00:00Z");
    return {
      status: "policy_troubleshooter_closed_all_denied",
      checked_secrets: "6",
      checked_versions: "2",
      checked_tuples: "12",
    };
  },
  runTerraform(args) {
    closedRecoveryOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: closedNoTransitionJson, stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
});
assert.equal(closedRecovery.verificationLabel, "private_access_plan_closed_no_transition_confirmed");
assert.equal(closedRecovery.reconciliationLabel, "private_access_exact_direct_binding_absence_confirmed");
assert.equal(closedRecovery.effectiveRevocationLabel, "policy_troubleshooter_closed_all_denied");
assert.deepEqual(closedRecoveryOrder, ["show", "apply", "confirm-closed", "wait", "effective"]);

assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  confirmClosedPrivateAccess() { throw new Error("raw-residual-binding"); },
  runTerraform(args) {
    return args[0] === "show"
      ? { status: 0, stdout: closedNoTransitionJson, stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
}), error => error.fixedLabel === "private_access_exact_reconciliation_uncertain_after_cleanup_apply" &&
  !error.message.includes("raw-"));

assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  confirmClosedPrivateAccess() {
    return { status: "private_access_exact_direct_binding_absence_confirmed", checked_secrets: "6" };
  },
  waitForRevocationPropagation() {},
  verifyEffectivePrivateAccess() {
    return {
      status: "policy_troubleshooter_closed_all_denied",
      checked_secrets: "6",
      checked_versions: "2",
      checked_tuples: "11",
    };
  },
  runTerraform(args) {
    return args[0] === "show"
      ? { status: 0, stdout: closedNoTransitionJson, stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
}), error => error.fixedLabel === "private_access_effective_revocation_uncertain_after_cleanup_apply");

let wrongHashRunnerCalled = false;
assert.throws(
  () => applyReviewedPrivateAccessPlan(planPath, "0".repeat(64), {
    cwd: root,
    temporaryRoot: root,
    runTerraform() {
      wrongHashRunnerCalled = true;
      return { status: 0, stdout: validJson, stderr: Buffer.alloc(0) };
    },
  }),
  error => error.fixedLabel === "private_access_plan_reviewed_hash_mismatch",
);
assert.equal(wrongHashRunnerCalled, false);
assert.deepEqual(readdirSync(root), ["candidate.tfplan"]);

chmodSync(planPath, 0o640);
let nonprivatePlanRunnerCalled = false;
assert.throws(
  () => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root,
    temporaryRoot: root,
    runTerraform() {
      nonprivatePlanRunnerCalled = true;
      return { status: 0, stdout: validJson, stderr: Buffer.alloc(0) };
    },
  }),
  error => error.fixedLabel === "private_access_plan_permissions_not_private",
);
assert.equal(nonprivatePlanRunnerCalled, false);
chmodSync(planPath, 0o600);
assert.deepEqual(readdirSync(root), ["candidate.tfplan"]);

let applyCalled = false;
assert.throws(
  () => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root,
    temporaryRoot: root,
    reconcilePrivateAccess() { return confirmedReconciliation; },
    runTerraform(args) {
      if (args[0] === "apply") applyCalled = true;
      return {
        status: 0,
        stdout: Buffer.from(JSON.stringify({ complete: true, variables: closedPlanVariables, resource_changes: [] })),
        stderr: Buffer.alloc(0),
      };
    },
  }),
  error => error.fixedLabel === "private_access_generation_missing_or_ambiguous",
);
assert.equal(applyCalled, false);
assert.deepEqual(readdirSync(root), ["candidate.tfplan"]);

assert.throws(
  () => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root,
    temporaryRoot: root,
    runTerraform(args) {
      return args[0] === "show"
        ? { status: 0, stdout: validJson, stderr: Buffer.alloc(0) }
        : { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("not exposed") };
    },
  }),
  error => error.fixedLabel === "private_access_verified_plan_apply_failed",
);
assert.deepEqual(readdirSync(root), ["candidate.tfplan"]);

const openInput = {
  enabled: true,
  profiles: ["oauth"],
  starts_at: "2099-01-02T00:00:00Z",
  expires_at: "2099-01-02T01:00:00Z",
  checkpoint_expires_at: "2099-01-02T01:00:00Z",
};
const closedInput = {
  enabled: false,
  profiles: [],
  starts_at: openInput.starts_at,
  expires_at: openInput.expires_at,
  checkpoint_expires_at: openInput.expires_at,
};
const recoveryGeneration = {
  address: "terraform_data.private_access_generation",
  type: "terraform_data",
  name: "private_access_generation",
  change: { actions: ["delete", "create"], before: { input: openInput }, after: { input: closedInput } },
};
const cleanupAddresses = [
  ["google_compute_instance_iam_member.operator_oslogin[0]", "google_compute_instance_iam_member", "operator_oslogin"],
  ["google_iap_tunnel_instance_iam_member.operator_tunnel[0]", "google_iap_tunnel_instance_iam_member", "operator_tunnel"],
  ["google_service_account_iam_member.operator_oslogin_service_account[0]", "google_service_account_iam_member", "operator_oslogin_service_account"],
  ["google_compute_firewall.iap_ssh[0]", "google_compute_firewall", "iap_ssh"],
  ["google_compute_firewall.pooler[0]", "google_compute_firewall", "pooler"],
  ["google_compute_firewall.google_api_https[0]", "google_compute_firewall", "google_api_https"],
];
const cleanupChanges = cleanupAddresses.map(([address, type, name]) => ({
  address, type, name, change: { actions: ["delete"], before: {}, after: null },
}));
const recoveryJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: closedPlanVariables,
  resource_changes: [recoveryGeneration, ...cleanupChanges],
}));
const recoveryOrder = [];
const recovered = applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  reconcilePrivateAccess(tuple) {
    recoveryOrder.push("reconcile");
    assert.deepEqual(tuple, {
      profile: "oauth",
      windowStartsAt: openInput.starts_at,
      windowExpiresAt: openInput.expires_at,
    });
    return confirmedReconciliation;
  },
  waitForRevocationPropagation(milliseconds) {
    recoveryOrder.push("wait");
    assert.equal(milliseconds, 600_000);
  },
  verifyEffectivePrivateAccess(query) {
    recoveryOrder.push("effective");
    assert.equal(query.phase, "closed");
    assert.equal(query.project_number, "711446392261");
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "0", checked_tuples: "6" };
  },
  runTerraform(args) {
    recoveryOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: recoveryJson, stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
});
assert.equal(recovered.verificationLabel, "private_access_open_generation_without_grant_to_closed_recovery_confirmed");
assert.equal(recovered.reconciliationLabel, "private_access_exact_direct_binding_reconciliation_confirmed");
assert.equal(recovered.effectiveRevocationLabel, "policy_troubleshooter_closed_all_denied");
assert.deepEqual(recoveryOrder, ["show", "reconcile", "apply", "wait", "effective"]);
assert.deepEqual(cleanupChanges.map(change => change.address), cleanupAddresses.map(([address]) => address));

let applyAfterFailedReconciliation = false;
assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  reconcilePrivateAccess() { throw new Error("raw-reconciliation-error"); },
  runTerraform(args) {
    if (args[0] === "apply") applyAfterFailedReconciliation = true;
    return { status: 0, stdout: args[0] === "show" ? recoveryJson : Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
}), error => error.fixedLabel === "private_access_exact_reconciliation_failed_before_cleanup_apply" &&
  !error.message.includes("raw-"));
assert.equal(applyAfterFailedReconciliation, false);

const trackedCloseGrant = {
  address: 'google_secret_manager_secret_iam_member.private_versions["oauth"]',
  type: "google_secret_manager_secret_iam_member",
  name: "private_versions",
  index: "oauth",
  change: {
    actions: ["delete"],
    before: {
      project: "vaeroex-integrations-prod",
      secret_id: "square-production-oauth-db",
      role: "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions",
      member: "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com",
      condition: [{
        title: "bounded-native-provisioning",
        description: "One exact database secret during the admitted maintenance window.",
        expression: "request.time >= timestamp('2099-01-02T00:00:00Z') && request.time < timestamp('2099-01-02T01:00:00Z')",
      }],
    },
    after: null,
  },
};
const trackedCloseJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: closedPlanVariables,
  resource_changes: [recoveryGeneration, trackedCloseGrant, ...cleanupChanges],
}));
const trackedCloseOrder = [];
const trackedClose = applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  reconcilePrivateAccess(tuple) {
    trackedCloseOrder.push("reconcile");
    assert.deepEqual(tuple, {
      profile: "oauth",
      windowStartsAt: openInput.starts_at,
      windowExpiresAt: openInput.expires_at,
    });
    return confirmedReconciliation;
  },
  waitForRevocationPropagation() { trackedCloseOrder.push("wait"); },
  verifyEffectivePrivateAccess() {
    trackedCloseOrder.push("effective");
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "1", checked_tuples: "9" };
  },
  runTerraform(args) {
    trackedCloseOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: trackedCloseJson, stderr: Buffer.alloc(0) }
      : { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  },
});
assert.equal(trackedClose.verificationLabel, "private_access_one_grant_to_closed_confirmed");
assert.equal(trackedClose.reconciliationLabel, "private_access_exact_direct_binding_reconciliation_confirmed");
assert.equal(trackedClose.effectiveRevocationLabel, "policy_troubleshooter_closed_all_denied");
assert.deepEqual(trackedCloseOrder, ["show", "apply", "reconcile", "wait", "effective"]);

const failedCloseOrder = [];
assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  reconcilePrivateAccess() {
    failedCloseOrder.push("reconcile");
    return confirmedReconciliation;
  },
  waitForRevocationPropagation() { failedCloseOrder.push("wait"); },
  verifyEffectivePrivateAccess() {
    failedCloseOrder.push("effective");
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "0", checked_tuples: "6" };
  },
  runTerraform(args) {
    failedCloseOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: trackedCloseJson, stderr: Buffer.alloc(0) }
      : { status: 1, stdout: Buffer.from("raw-apply"), stderr: Buffer.from("raw-provider") };
  },
}), error => error.fixedLabel === "private_access_close_apply_failed_after_effective_revocation");
assert.deepEqual(failedCloseOrder, ["show", "apply", "reconcile", "wait", "effective"]);

const openingGeneration = {
  address: "terraform_data.private_access_generation",
  type: "terraform_data",
  name: "private_access_generation",
  change: {
    actions: ["delete", "create"],
    before: { input: { ...closedInput, starts_at: "2099-01-01T00:00:00Z", expires_at: "2099-01-01T01:00:00Z", checkpoint_expires_at: "2099-01-01T01:00:00Z" } },
    after: { input: openInput },
  },
};
const openingGrant = {
  address: 'google_secret_manager_secret_iam_member.private_versions["oauth"]',
  type: "google_secret_manager_secret_iam_member",
  name: "private_versions",
  index: "oauth",
  change: {
    actions: ["create"],
    before: null,
    after: {
      project: "vaeroex-integrations-prod",
      secret_id: "square-production-oauth-db",
      role: "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions",
      member: "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com",
      condition: [{
        title: "bounded-native-provisioning",
        description: "One exact database secret during the admitted maintenance window.",
        expression: "request.time >= timestamp('2099-01-02T00:00:00Z') && request.time < timestamp('2099-01-02T01:00:00Z')",
      }],
    },
  },
};
const openingJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: openPlanVariables,
  resource_changes: [openingGeneration, openingGrant, ...[
    ["google_compute_instance_iam_member.operator_oslogin[0]", ""],
    ["google_iap_tunnel_instance_iam_member.operator_tunnel[0]", " && destination.port == 22"],
    ["google_service_account_iam_member.operator_oslogin_service_account[0]", ""],
  ].map(([address, suffix]) => ({
    address,
    change: { actions: ["create"], before: null, after: { condition: [{
      expression: "request.time >= timestamp('2099-01-02T00:00:00Z') && request.time < timestamp('2099-01-02T01:00:00Z')" + suffix,
    }] } },
  }))],
}));
const machineOutput = (...events) => Buffer.from([
  { type: "version", ui: "1.2" }, ...events,
].map(event => JSON.stringify({ "@module": "terraform.ui", ...event })).join("\n") + "\n");
const diagnosticEvent = (address, summary, detail = "") => ({
  type: "diagnostic", diagnostic: { severity: "error", address, summary, detail },
});
const sensitiveSentinel = "SYNTHETIC_RAW_CREDENTIAL_VALUE_MUST_NOT_PERSIST";
const postOpenFailureOutput = machineOutput(
  { type: "apply_progress", hook: { resource: { addr: "time_sleep.private_access_propagation" } },
    "@message": sensitiveSentinel },
  { type: "outputs", outputs: { secret: { sensitive: true, value: sensitiveSentinel } } },
  diagnosticEvent("data.external.private_access_effective[0]", "External Program Execution Failed",
    `Program: /sensitive/${sensitiveSentinel}\nError Message: policy_troubleshooter_access_mismatch\n\nState: exit status 1`),
);
const postOpenFailureLabels = [
  "private_access_terraform_failure_stage_post_open_effective_access",
  "private_access_terraform_failure_resource_data_external_private_access_effective_0",
  "private_access_terraform_failure_diagnostic_policy_troubleshooter_access_mismatch",
];
const failedOpenOrder = [];
const failedOpenProgress = [];
assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  onProgress(label, detail) { failedOpenProgress.push({ label, detail }); },
  reconcilePrivateAccess(tuple) {
    failedOpenOrder.push("reconcile");
    assert.equal(tuple.profile, "oauth");
    return confirmedReconciliation;
  },
  waitForRevocationPropagation(milliseconds) {
    failedOpenOrder.push("wait");
    assert.equal(milliseconds, 600_000);
    assert.deepEqual(failedOpenProgress.find(row => row.label === "private_access_terraform_apply_returned")?.detail,
      { exitCode: 1, processError: null, successful: false });
    assert.equal(failedOpenProgress.at(-1).label, "private_access_revocation_wait_started");
  },
  verifyEffectivePrivateAccess() {
    failedOpenOrder.push("effective");
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "2", checked_tuples: "12" };
  },
  runTerraform(args) {
    failedOpenOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: openingJson, stderr: Buffer.alloc(0) }
      : { status: 1, stdout: postOpenFailureOutput, stderr: Buffer.alloc(0) };
  },
}), error => error.fixedLabel === "private_access_open_apply_failed_after_effective_revocation");
assert.deepEqual(failedOpenOrder, ["show", "apply", "reconcile", "wait", "effective"]);
assert.deepEqual(failedOpenProgress.map(row => row.label), [
  "private_access_plan_verified", "private_access_terraform_apply_started", "private_access_terraform_apply_returned",
  ...postOpenFailureLabels,
  "private_access_failed_apply_reconciliation_started", "private_access_failed_apply_reconciliation_confirmed",
  "private_access_revocation_wait_started", "private_access_revocation_wait_completed",
  "private_access_effective_revocation_check_started", "private_access_effective_revocation_confirmed",
]);
assert.doesNotMatch(JSON.stringify(failedOpenProgress), /raw-apply|raw-provider|SYNTHETIC_RAW_CREDENTIAL/);

// A broken outcome/recovery receipt must never bypass the existing safety work.
for (const brokenStage of failedOpenProgress.slice(2).map(row => row.label)) {
  const order = [];
  assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root, temporaryRoot: root,
    onProgress(label) { if (label === brokenStage) throw Error("synthetic_receipt_io_failure"); },
    reconcilePrivateAccess() { order.push("reconcile"); return confirmedReconciliation; },
    waitForRevocationPropagation(ms) { assert.equal(ms, 600_000); order.push("wait"); },
    verifyEffectivePrivateAccess() {
      order.push("effective");
      return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "0", checked_tuples: "6" };
    },
    runTerraform(args) {
      order.push(args[0]);
      return { status: args[0] === "show" ? 0 : 1, stdout: args[0] === "show" ? openingJson : postOpenFailureOutput };
    },
  }), error => error.fixedLabel === "private_access_open_apply_failed_after_effective_revocation", brokenStage);
  assert.deepEqual(order, ["show", "apply", "reconcile", "wait", "effective"], brokenStage);
}

// Only error diagnostics in the supported JSON UI can identify a failure.
// These local fixtures never invoke Terraform, gcloud, credentials or a wait.
const unknownFailure = diagnostic => [
  "private_access_terraform_failure_stage_unknown",
  "private_access_terraform_failure_resource_unknown",
  `private_access_terraform_failure_diagnostic_${diagnostic}`,
];
const failureCases = [
  ["post-open verifier", postOpenFailureOutput, postOpenFailureLabels],
  ["pre-open verifier", machineOutput(diagnosticEvent("data.external.private_access_closed[0]",
    "External Program Execution Failed", "Error Message: policy_troubleshooter_version_enumeration_failed\n\nState: exit status 1")), [
    "private_access_terraform_failure_stage_pre_open_effective_access",
    "private_access_terraform_failure_resource_data_external_private_access_closed_0",
    "private_access_terraform_failure_diagnostic_policy_troubleshooter_version_enumeration_failed",
  ]],
  ["state lock", machineOutput(diagnosticEvent(undefined, "Error acquiring the state lock", sensitiveSentinel)),
    unknownFailure("state_lock_acquisition_failed")],
  ["lock release", machineOutput(diagnosticEvent(undefined, "Error releasing the state lock", sensitiveSentinel)),
    unknownFailure("state_lock_release_failed")],
  ...["Failed to save state", "Failed to persist state to backend", "Error saving state"].map(summary => [
    summary, machineOutput(diagnosticEvent(undefined, summary, sensitiveSentinel)), unknownFailure("state_write_failed"),
  ]),
  ["state write and lock release", machineOutput(
    diagnosticEvent(undefined, "Failed to persist state to backend", sensitiveSentinel),
    diagnosticEvent(undefined, "Error releasing the state lock", sensitiveSentinel)),
    [...unknownFailure("state_write_failed"), ...unknownFailure("state_lock_release_failed")]],
  ["state write with API cause", machineOutput(diagnosticEvent(undefined, "Failed to persist state to backend",
    `googleapi: Error 403: ${sensitiveSentinel}`)),
    [...unknownFailure("state_write_failed"), ...unknownFailure("api_permission_denied")]],
  ["provider failure", machineOutput(diagnosticEvent(undefined, "Plugin did not respond", sensitiveSentinel)),
    unknownFailure("provider_unresponsive")],
  ["API denied", machineOutput(diagnosticEvent('google_secret_manager_secret_iam_member.private_versions["oauth"]',
    `Error applying IAM policy: googleapi: Error 403: ${sensitiveSentinel}`)), [
    "private_access_terraform_failure_stage_private_grant",
    "private_access_terraform_failure_resource_google_secret_manager_secret_iam_member_private_versions_oauth",
    "private_access_terraform_failure_diagnostic_api_permission_denied",
  ]],
  ["unknown resource", machineOutput(diagnosticEvent(`module.${sensitiveSentinel}.resource`, sensitiveSentinel)), unknownFailure("unknown")],
  ["unknown verifier label", machineOutput(diagnosticEvent("data.external.private_access_effective[0]", "External Program Execution Failed",
    "Error Message: policy_troubleshooter_access_mismatch_unrecognized\n")),
    [...postOpenFailureLabels.slice(0, 2), "private_access_terraform_failure_diagnostic_external_program_failed"]],
  ["unrelated progress", machineOutput({ type: "apply_progress", hook: { resource: { addr: "data.external.private_access_closed[0]" } },
    "@message": "policy_troubleshooter_access_mismatch" },
    { ...diagnosticEvent("data.external.private_access_effective[0]", "External Program Execution Failed", "policy_troubleshooter_access_mismatch"),
      diagnostic: { severity: "warning", address: "data.external.private_access_effective[0]", summary: "Plugin error" } },
    { type: "log", "@message": `Error acquiring the state lock ${sensitiveSentinel}` }), unknownFailure("unknown")],
  ["unrelated message field", machineOutput({ ...diagnosticEvent(undefined, sensitiveSentinel),
    "@message": "data.external.private_access_effective[0]: policy_troubleshooter_access_mismatch" }), unknownFailure("unknown")],
  ["malformed", Buffer.from(`{${sensitiveSentinel}`), unknownFailure("machine_output_invalid")],
  ["missing output", undefined, unknownFailure("unknown")],
  ["missing schema", Buffer.from(JSON.stringify({ "@module": "terraform.ui",
    ...diagnosticEvent("data.external.private_access_closed[0]", "Plugin error") })), unknownFailure("machine_output_invalid")],
  ["unsupported schema", machineOutput({ type: "version", ui: "2.0" },
    diagnosticEvent("data.external.private_access_closed[0]", "Plugin error")), unknownFailure("machine_output_invalid")],
  ["oversized record", machineOutput(diagnosticEvent("data.external.private_access_closed[0]", "Plugin error", "x".repeat(256 * 1024))),
    unknownFailure("machine_output_invalid")],
  ["valid diagnostic before truncated record", Buffer.concat([postOpenFailureOutput, Buffer.from(`{${sensitiveSentinel}`)]),
    [...postOpenFailureLabels, "private_access_terraform_failure_diagnostic_machine_output_invalid"]],
];
const failureReceiptDirectory = join(root, "sanitized-failure-receipt");
mkdirSync(failureReceiptDirectory, { mode: 0o700 });
for (const [name, output, expectedLabels] of failureCases) {
  const progress = [], order = [];
  assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root, temporaryRoot: root,
    onProgress(label, detail) {
      progress.push({ label, detail });
      if (name === "post-open verifier") recordProgress(failureReceiptDirectory, label, detail);
    },
    reconcilePrivateAccess() { order.push("reconcile"); return confirmedReconciliation; },
    waitForRevocationPropagation(ms) {
      assert.equal(ms, 600_000); order.push("wait");
      assert.deepEqual(progress.map(row => row.label).filter(label => label.startsWith("private_access_terraform_failure_")), expectedLabels, name);
      if (name === "post-open verifier") {
        const persisted = readFileSync(join(failureReceiptDirectory, "progress.jsonl"), "utf8");
        for (const label of expectedLabels) assert.ok(persisted.includes(label));
      }
    },
    verifyEffectivePrivateAccess() {
      order.push("effective");
      return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "0", checked_tuples: "6" };
    },
    runTerraform(args) {
      order.push(args[0]);
      if (args[0] === "apply") assert.deepEqual(args.slice(0, -1), ["apply", "-input=false", "-json"]);
      return args[0] === "show" ? { status: 0, stdout: openingJson } : { status: 1, stdout: output };
    },
  }), error => error.fixedLabel === "private_access_open_apply_failed_after_effective_revocation", name);
  assert.deepEqual(order, ["show", "apply", "reconcile", "wait", "effective"], name);
  assert.doesNotMatch(JSON.stringify(progress), /SYNTHETIC_RAW_CREDENTIAL|\/sensitive\//, name);
  assert.equal(readdirSync(root).some(name => name.startsWith("vaeroex-private-access-plan-")), false, name);
}
const persistedFailurePath = join(failureReceiptDirectory, "progress.jsonl");
assert.equal(statSync(persistedFailurePath).mode & 0o777, 0o600);
const persistedFailure = readFileSync(persistedFailurePath, "utf8");
assert.doesNotMatch(persistedFailure, /SYNTHETIC_RAW_CREDENTIAL|\/sensitive\//);
for (const row of persistedFailure.trim().split("\n").map(JSON.parse).filter(row => row.label.startsWith("private_access_terraform_failure_"))) {
  assert.deepEqual(Object.keys(row).sort(), ["label", "utc"]);
}

let receiptFailureApplies = 0;
assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root, temporaryRoot: root,
  onProgress() { throw Error("synthetic_receipt_io_failure"); },
  runTerraform(args) {
    if (args[0] === "apply") receiptFailureApplies++;
    return { status: 0, stdout: openingJson };
  },
}), error => error.fixedLabel === "private_access_receipt_failed_before_apply");
assert.equal(receiptFailureApplies, 0);

assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root, temporaryRoot: root,
  onProgress(label) { if (label === "private_access_terraform_apply_returned") throw Error("synthetic_receipt_io_failure"); },
  runTerraform(args) { return { status: 0, stdout: args[0] === "show" ? openingJson : Buffer.alloc(0) }; },
}), error => error.fixedLabel === "private_access_receipt_failed_requires_reconciliation");

const fakeTerraformDirectory = join(root, "fake-terraform-bin");
mkdirSync(fakeTerraformDirectory, { mode: 0o700 });
const fakeTerraformPath = join(fakeTerraformDirectory, "terraform");
const fakeGcloudPath = join(fakeTerraformDirectory, "gcloud");
const administrativeJson = Buffer.from(JSON.stringify({
  format_version: "1.2",
  complete: true,
  variables: administrativePlanVariables,
  resource_changes: [closedNoTransitionGeneration],
}));
const encodedPlanJson = administrativeJson.toString("base64");
writeFileSync(
  fakeTerraformPath,
  `#!${process.execPath}
const diagnosticName = Object.keys(process.env).find(name => /^TF_LOG(?:_|$)/.test(name));
if (diagnosticName) {
  process.stdout.write("raw-hostile-environment-stdout\\n");
  process.stderr.write("raw-hostile-environment-stderr\\n");
  process.exit(70);
}
if (process.argv[2] === "show") {
  process.stdout.write(Buffer.from(${JSON.stringify(encodedPlanJson)}, "base64"));
  process.stderr.write("raw-show-stderr-must-not-surface\\n");
  process.exit(0);
}
if (process.argv[2] === "apply") {
  process.stdout.write("raw-apply-stdout-must-not-surface\\n");
  process.stderr.write("raw-apply-stderr-must-not-surface\\n");
  process.exit(0);
}
process.exit(71);
`,
  { mode: 0o700 },
);
writeFileSync(
  fakeGcloudPath,
  `#!${process.execPath}
if (process.argv[2] === "secrets" && process.argv[3] === "get-iam-policy") {
  process.stdout.write('{"bindings":[]}');
  process.exit(0);
}
process.exit(72);
`,
  { mode: 0o700 },
);
const wrapperPath = fileURLToPath(new URL("../scripts/apply-reviewed-private-access-plan.mjs", import.meta.url));
const cliResult = spawnSync(process.execPath, [wrapperPath, planPath, reviewedSha256], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    PATH: `${fakeTerraformDirectory}:${process.env.PATH ?? ""}`,
    TF_LOG: "TRACE",
    TF_LOG_PATH: join(root, "terraform-cli.log"),
    TF_LOG_SDK_PROTO_DATA_DIR: join(root, "terraform-cli-protocol-logs"),
  },
});
assert.equal(cliResult.status, 0);
assert.equal(
  cliResult.stdout,
  "private_access_administrative_phase_confirmed\nprivate_access_verified_plan_apply_completed\n",
);
assert.equal(cliResult.stderr, "");
assert.equal(cliResult.stdout.includes("raw-"), false);
assert.equal(cliResult.stderr.includes("raw-"), false);
assert.equal(existsSync(join(root, "terraform-cli.log")), false);
assert.equal(existsSync(join(root, "terraform-cli-protocol-logs")), false);

// Exercise the actual detached supervisor -> reviewed wrapper -> result reader,
// using only the existing harmless local Terraform executable above.
const executionDirectory = join(root, "durable-execution");
const originalPath = process.env.PATH;
process.env.PATH = `${fakeTerraformDirectory}:${originalPath ?? ""}`;
try {
  await startExecution({ planPath, reviewedSha256, directory: executionDirectory,
    deadlineMs: Date.now() + 5000, cwd: root });
} finally { process.env.PATH = originalPath; }
const end = Date.now() + 7000;
while (!existsSync(join(executionDirectory, "result.json")) && Date.now() < end) {
  await new Promise(done => setTimeout(done, 20));
}
assert.equal(readExecution(executionDirectory).state, "succeeded");
const durableProgress = readFileSync(join(executionDirectory, "progress.jsonl"), "utf8");
assert.match(durableProgress, /private_access_terraform_apply_returned/);
assert.match(durableProgress, /"exitCode":0/);
assert.doesNotMatch(durableProgress, /raw-|hostile/);

// The same one-shot recovery must retain proof mode and deny the application
// secret as well as every DB profile. These are local subprocess/API fixtures.
for (const [sourceJson, applyStatus, expectedOrder, expectedFailure] of [
  [openingJson, 1, ["show", "apply", "reconcile", "wait", "effective"], "private_access_open_apply_failed_after_effective_revocation"],
  [trackedCloseJson, 0, ["show", "apply", "reconcile", "wait", "effective"], null],
  [trackedCloseJson, 1, ["show", "apply", "reconcile", "wait", "effective"], "private_access_close_apply_failed_after_effective_revocation"],
  [recoveryJson, 0, ["show", "reconcile", "apply", "wait", "effective"], null],
  [closedNoTransitionJson, 0, ["show", "apply", "confirm", "wait", "effective"], null],
]) {
  const value = JSON.parse(sourceJson);
  value.variables.oauth_candidate_proof_enabled = { value: true };
  for (const resource of value.resource_changes) {
    for (const side of ["before", "after"]) {
      const item = resource.change[side];
      if (item?.input) item.input.access_mode = OAUTH_PROOF_MODE;
      if (item?.secret_id) {
        item.role = OAUTH_PROOF_ROLE;
        item.condition = [{ title: OAUTH_PROOF_TITLE, description: OAUTH_PROOF_DESCRIPTION,
          expression: oauthProofCondition(openInput.starts_at, openInput.expires_at) }];
      }
    }
  }
  const roleValue = { project: "vaeroex-integrations-prod", role_id: "squareProductionOAuthCandidateProof",
    permissions: [...OAUTH_PROOF_PERMISSIONS], deleted: false };
  value.resource_changes.push({ address: "google_project_iam_custom_role.oauth_candidate_proof", type: "google_project_iam_custom_role",
    change: { actions: ["no-op"], before: roleValue, after: roleValue } });
  const order = [];
  const execute = () => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
    cwd: root, temporaryRoot: root,
    reconcilePrivateAccess(tuple) {
      order.push("reconcile"); assert.equal(tuple.accessMode, OAUTH_PROOF_MODE);
      return { ...confirmedReconciliation, checked_secrets: "7" };
    },
    confirmClosedPrivateAccess(options) {
      order.push("confirm"); assert.equal(options.accessMode, OAUTH_PROOF_MODE);
      return { status: "private_access_exact_direct_binding_absence_confirmed", checked_secrets: "7" };
    },
    waitForRevocationPropagation(ms) { order.push("wait"); assert.equal(ms, 600_000); },
    verifyEffectivePrivateAccess(query) {
      order.push("effective"); assert.equal(query.access_mode, OAUTH_PROOF_MODE); assert.equal(query.phase, "closed");
      return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "7", checked_versions: "2", checked_tuples: "17" };
    },
    runTerraform(args) {
      order.push(args[0]);
      return { status: args[0] === "show" ? 0 : applyStatus,
        stdout: args[0] === "show" ? Buffer.from(JSON.stringify(value)) : Buffer.alloc(0) };
    },
  });
  if (expectedFailure) assert.throws(execute, error => error.fixedLabel === expectedFailure);
  else assert.equal(execute().effectiveRevocationLabel, "policy_troubleshooter_closed_all_denied");
  assert.deepEqual(order, expectedOrder);
}

rmSync(root, { recursive: true, force: true });
process.stdout.write("private_access_single_verified_apply_entrypoint_confirmed\n");
