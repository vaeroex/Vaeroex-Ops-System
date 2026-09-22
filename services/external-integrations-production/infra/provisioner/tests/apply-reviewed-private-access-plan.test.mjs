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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { applyReviewedPrivateAccessPlan } from "../scripts/apply-reviewed-private-access-plan.mjs";

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
  resource_changes: [openingGeneration, openingGrant],
}));
const failedOpenOrder = [];
assert.throws(() => applyReviewedPrivateAccessPlan(planPath, reviewedSha256, {
  cwd: root,
  temporaryRoot: root,
  reconcilePrivateAccess(tuple) {
    failedOpenOrder.push("reconcile");
    assert.equal(tuple.profile, "oauth");
    return confirmedReconciliation;
  },
  waitForRevocationPropagation() { failedOpenOrder.push("wait"); },
  verifyEffectivePrivateAccess() {
    failedOpenOrder.push("effective");
    return { status: "policy_troubleshooter_closed_all_denied", checked_secrets: "6", checked_versions: "2", checked_tuples: "12" };
  },
  runTerraform(args) {
    failedOpenOrder.push(args[0]);
    return args[0] === "show"
      ? { status: 0, stdout: openingJson, stderr: Buffer.alloc(0) }
      : { status: 1, stdout: Buffer.from("raw-apply"), stderr: Buffer.from("raw-provider") };
  },
}), error => error.fixedLabel === "private_access_open_apply_failed_after_effective_revocation");
assert.deepEqual(failedOpenOrder, ["show", "apply", "reconcile", "wait", "effective"]);

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

rmSync(root, { recursive: true, force: true });
process.stdout.write("private_access_single_verified_apply_entrypoint_confirmed\n");
