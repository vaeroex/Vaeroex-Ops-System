import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  confirmExactPrivateAccessClosed,
  reconcileExactPrivateAccess,
} from "./reconcile-private-access.mjs";
import { verifyEffectivePrivateAccess } from "./verify-effective-private-access.mjs";
import { OAUTH_PROOF_MODE } from "./oauth-candidate-proof-contract.mjs";
import {
  privateAccessClosedBootstrapTuple,
  privateAccessClosedNoTransitionTuple,
  privateAccessOpeningTuple,
  privateAccessRecoveryTuple,
  verifyPrivateAccessPlan,
} from "./verify-private-access-plan.mjs";

const MAX_PLAN_BYTES = 128 * 1024 * 1024;
const TERRAFORM_DIAGNOSTIC_ENVIRONMENT = /^TF_LOG(?:_|$)/;
const RECOVERY_LABEL = "private_access_open_generation_without_grant_to_closed_recovery_confirmed";
const OPENING_LABEL = "private_access_closed_to_one_grant_confirmed";
const CLOSING_LABEL = "private_access_one_grant_to_closed_confirmed";
const CLOSED_NO_TRANSITION_LABEL = "private_access_plan_closed_no_transition_confirmed";
const CLOSED_BOOTSTRAP_LABEL = "private_access_plan_closed_bootstrap_confirmed";
const PROJECT_ID = "vaeroex-integrations-prod";
const PROJECT_NUMBER = "711446392261";
const REVOCATION_PROPAGATION_MS = 10 * 60 * 1000;
// Only addresses in this root can become receipt labels. Never derive a label
// from a provider message, path, identifier, expression value or progress hook.
const FAILURE_RESOURCES = new Map([
  ["terraform_data.private_access_generation", "generation"],
  ["time_sleep.private_access_propagation", "pre_open_propagation"],
  ["data.external.private_access_closed[0]", "pre_open_effective_access"],
  ["time_sleep.private_access_effective_propagation[0]", "post_open_propagation"],
  ["data.external.private_access_effective[0]", "post_open_effective_access"],
  ["terraform_data.private_access_effective_authority[0]", "effective_authority_receipt"],
  ["data.google_project.current[0]", "project_metadata"],
  ["google_project_iam_custom_role.private_versions", "role_definition"],
  ["google_project_iam_custom_role.oauth_candidate_proof", "role_definition"],
  ...["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"].flatMap(profile => [
    [`google_secret_manager_secret_iam_member.private_versions["${profile}"]`, "private_grant"],
    [`data.google_secret_manager_secret_iam_policy.private_versions["${profile}"]`, "direct_policy_check"],
  ]),
  ...["google_compute_instance_iam_member.operator_oslogin", "google_iap_tunnel_instance_iam_member.operator_tunnel",
    "google_service_account_iam_member.operator_oslogin_service_account"].map(address => [`${address}[0]`, "administrative_access"]),
  ...["iap_ssh", "pooler", "google_api_https", "setup_https"].map(name => [`google_compute_firewall.${name}[0]`, "network_access"]),
  ...["iap.googleapis.com", "policytroubleshooter.googleapis.com"].map(api => [`google_project_service.administration["${api}"]`, "api_enablement"]),
].map(([address, stage]) => [address, { stage, resource: address.replace(/[^a-z0-9]+/g, "_").replace(/_$/, "") }]));
const FAILURE_SUMMARIES = new Map([
  ["Error acquiring the state lock", "state_lock_acquisition_failed"],
  ["Error releasing the state lock", "state_lock_release_failed"],
  ["Failed to load state", "state_read_failed"],
  ["Failed to save state", "state_write_failed"],
  ["Failed to persist state to backend", "state_write_failed"],
  ["Error saving state", "state_write_failed"],
  ["Saved plan is stale", "saved_plan_stale"],
  ["Saved plan does not match the given state", "saved_plan_state_mismatch"],
  ["External Program Execution Failed", "external_program_failed"],
  ["Unexpected External Program Results", "external_program_result_invalid"],
  ["Resource precondition failed", "resource_precondition_failed"],
  ["Plugin did not respond", "provider_unresponsive"],
  ["Plugin error", "provider_error"],
  ["Failed to load plugin schemas", "provider_schema_failed"],
  ["Failed to instantiate provider", "provider_start_failed"],
  ["Invalid provider configuration", "provider_configuration_invalid"],
  ["Provider produced inconsistent result after apply", "provider_result_inconsistent"],
]);
const VERIFIER_FAILURES = new Set([
  "policy_troubleshooter_version_enumeration_failed", "policy_troubleshooter_response_invalid",
  "policy_troubleshooter_tuple_mismatch", "policy_troubleshooter_analysis_incomplete",
  "policy_troubleshooter_access_mismatch", "policy_troubleshooter_input_invalid",
  "policy_troubleshooter_window_inactive", "policy_troubleshooter_clock_invalid",
  "policy_troubleshooter_oauth_candidate_inventory_mismatch", "policy_troubleshooter_matrix_invalid",
  "policy_troubleshooter_process_failed",
]);
const API_FAILURES = new Map([
  ["400", "api_bad_request"], ["401", "api_unauthenticated"], ["403", "api_permission_denied"],
  ["404", "api_not_found"], ["409", "api_conflict"], ["412", "api_precondition_failed"],
  ["429", "api_rate_limited"], ["500", "api_server_error"], ["502", "api_server_error"],
  ["503", "api_unavailable"], ["504", "api_timeout"],
]);

function terraformFailureLabels(applied) {
  const labels = [], seen = new Set();
  let supported = false, invalid = false, found = false;
  const add = (resource, diagnostic) => {
    const group = [
      `private_access_terraform_failure_stage_${resource?.stage ?? "unknown"}`,
      `private_access_terraform_failure_resource_${resource?.resource ?? "unknown"}`,
      `private_access_terraform_failure_diagnostic_${diagnostic}`,
    ];
    // Keep each diagnostic paired with its resource, even when stages repeat.
    const key = group.join("\n");
    if (!seen.has(key)) { seen.add(key); labels.push(...group); }
  };
  try {
    for (const output of [applied?.stdout, applied?.stderr]) {
      if (!Buffer.isBuffer(output) && typeof output !== "string") continue;
      for (const line of output.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        // Output is already bounded by the child buffer. Do not parse large
        // values/snippets, and never copy any portion of them into a receipt.
        if (line.length > 256 * 1024) { invalid = true; continue; }
        let event;
        try { event = JSON.parse(line); } catch { invalid = true; continue; }
        if (event?.["@module"] !== "terraform.ui") continue;
        if (event.type === "version") {
          supported = typeof event.ui === "string" && /^1\.[0-9]+$/.test(event.ui);
          if (!supported) invalid = true;
          continue;
        }
        if (event.type !== "diagnostic" || event.diagnostic?.severity !== "error") continue;
        if (!supported) { invalid = true; continue; }
        const diagnostic = event.diagnostic;
        const resource = FAILURE_RESOURCES.get(diagnostic.address);
        let category = FAILURE_SUMMARIES.get(diagnostic.summary) ?? "unknown";
        const detail = typeof diagnostic.detail === "string" ? diagnostic.detail : "";
        if (category === "external_program_failed" &&
            ["pre_open_effective_access", "post_open_effective_access"].includes(resource?.stage)) {
          const fixed = detail.match(/(?:^|\n)(?:Error Message: *)?(policy_troubleshooter_[a-z_]+)(?:\r?\n|$)/)?.[1];
          if (VERIFIER_FAILURES.has(fixed)) category = fixed;
        }
        const code = `${typeof diagnostic.summary === "string" ? diagnostic.summary : ""}\n${detail}`
          .match(/\bgoogleapi: Error (400|401|403|404|409|412|429|500|502|503|504)(?:[,\s:]|$)/)?.[1];
        const apiCategory = API_FAILURES.get(code);
        add(resource, category === "unknown" ? apiCategory ?? "unknown" : category);
        // A known Terraform summary must not hide a recognized API cause.
        if (apiCategory && category !== "unknown") add(resource, apiCategory);
        found = true;
      }
    }
  } catch { invalid = true; }
  if (!found) add(null, applied?.error ? "child_process_error" : invalid ? "machine_output_invalid" : "unknown");
  else if (invalid) labels.push("private_access_terraform_failure_diagnostic_machine_output_invalid");
  return labels;
}

function reject(label) {
  const error = new Error(label);
  error.fixedLabel = label;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultTerraformRun(args, options) {
  return spawnSync("terraform", args, options);
}

function sanitizedTerraformEnvironment(environment) {
  const sanitized = { ...environment };
  for (const name of Object.keys(sanitized)) {
    if (TERRAFORM_DIAGNOSTIC_ENVIRONMENT.test(name)) delete sanitized[name];
  }
  return sanitized;
}

function defaultWaitForRevocationPropagation(milliseconds) {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  if (Atomics.wait(gate, 0, 0, milliseconds) !== "timed-out") {
    reject("private_access_revocation_propagation_wait_failed");
  }
}

function effectiveClosedResult(result, proof) {
  if (result?.status !== "policy_troubleshooter_closed_all_denied" || result?.checked_secrets !== (proof ? "7" : "6") ||
      typeof result?.checked_versions !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(result.checked_versions) ||
      typeof result?.checked_tuples !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(result.checked_tuples)) return false;
  return BigInt(result.checked_tuples) === (proof ? 7n : 6n) + (proof ? 5n : 3n) * BigInt(result.checked_versions);
}

function reconcilePrivateAccess(recovery, options) {
  const reconcile = options.reconcilePrivateAccess ?? reconcileExactPrivateAccess;
  const result = reconcile(recovery, {
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
  });
  if (result?.status !== "private_access_exact_direct_binding_reconciliation_confirmed" ||
      result?.checked_secrets !== (recovery.accessMode === OAUTH_PROOF_MODE ? "7" : "6")) throw new Error("invalid reconciliation result");
  return result.status;
}

function confirmPrivateAccessClosed(options, tuple) {
  const confirmClosed = options.confirmClosedPrivateAccess ?? confirmExactPrivateAccessClosed;
  const result = confirmClosed({
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
    ...(tuple.accessMode === OAUTH_PROOF_MODE ? { accessMode: OAUTH_PROOF_MODE } : {}),
  });
  if (result?.status !== "private_access_exact_direct_binding_absence_confirmed" ||
      result?.checked_secrets !== (tuple.accessMode === OAUTH_PROOF_MODE ? "7" : "6")) throw new Error("invalid closed-access result");
  return result.status;
}

function verifyEffectiveRevocation(recovery, options) {
  const waitForRevocationPropagation = options.waitForRevocationPropagation ?? defaultWaitForRevocationPropagation;
  options.onProgress?.("private_access_revocation_wait_started");
  waitForRevocationPropagation(REVOCATION_PROPAGATION_MS);
  options.onProgress?.("private_access_revocation_wait_completed");
  const verifyEffective = options.verifyEffectivePrivateAccess ?? verifyEffectivePrivateAccess;
  options.onProgress?.("private_access_effective_revocation_check_started");
  const result = verifyEffective({
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    phase: "closed",
    active_profile: "",
    ...(recovery.accessMode === OAUTH_PROOF_MODE ? { access_mode: OAUTH_PROOF_MODE } : {}),
    window_starts_at: recovery.windowStartsAt,
    window_expires_at: recovery.windowExpiresAt,
  }, {
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (!effectiveClosedResult(result, recovery.accessMode === OAUTH_PROOF_MODE)) throw new Error("invalid effective revocation result");
  options.onProgress?.("private_access_effective_revocation_confirmed");
  return result.status;
}

export function applyReviewedPrivateAccessPlan(planPath, reviewedSha256, options = {}) {
  const observer = options.onProgress;
  let receiptFailed = false;
  options = { ...options, onProgress(label, detail) {
    try { observer?.(label, detail); }
    catch { receiptFailed = true; }
  } };
  const cwd = resolve(options.cwd ?? process.cwd());
  const runTerraform = options.runTerraform ?? defaultTerraformRun;
  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  const sourcePath = resolve(cwd, planPath);
  const terraformEnvironment = sanitizedTerraformEnvironment(options.environment ?? process.env);
  let temporaryDirectory;

  try {
    const metadata = lstatSync(sourcePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_PLAN_BYTES) {
      reject("private_access_plan_file_invalid");
    }
    if ((metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0) {
      reject("private_access_plan_permissions_not_private");
    }

    const planBytes = readFileSync(sourcePath);
    const expectedHash = sha256(planBytes);
    if (!/^[a-f0-9]{64}$/.test(reviewedSha256 ?? "") || reviewedSha256 !== expectedHash) {
      reject("private_access_plan_reviewed_hash_mismatch");
    }
    temporaryDirectory = mkdtempSync(join(temporaryRoot, "vaeroex-private-access-plan-"));
    chmodSync(temporaryDirectory, 0o700);
    const immutableCopy = join(temporaryDirectory, basename(sourcePath));
    writeFileSync(immutableCopy, planBytes, { flag: "wx", mode: 0o600 });

    const shown = runTerraform(["show", "-json", immutableCopy], {
      cwd,
      env: terraformEnvironment,
      input: undefined,
      maxBuffer: MAX_PLAN_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (shown?.error || shown?.status !== 0 || !Buffer.isBuffer(shown?.stdout)) {
      reject("private_access_plan_show_failed");
    }

    let rendered;
    try {
      rendered = JSON.parse(shown.stdout.toString("utf8"));
    } catch {
      reject("private_access_plan_json_invalid");
    }
    const verificationLabel = verifyPrivateAccessPlan(rendered);
    options.onProgress?.("private_access_plan_verified");
    let reconciliationLabel;
    let effectiveRevocationLabel;
    let recovery;
    let closing;
    let opening;
    let closedBootstrap;
    let closedNoTransition;
    if (verificationLabel === RECOVERY_LABEL) {
      recovery = privateAccessRecoveryTuple(rendered);
      try {
        reconciliationLabel = reconcilePrivateAccess(recovery, options);
      } catch {
        reject("private_access_exact_reconciliation_failed_before_cleanup_apply");
      }
    } else if (verificationLabel === CLOSING_LABEL) {
      closing = privateAccessRecoveryTuple(rendered);
    } else if (verificationLabel === OPENING_LABEL) {
      opening = privateAccessOpeningTuple(rendered);
    } else if (verificationLabel === CLOSED_BOOTSTRAP_LABEL) {
      closedBootstrap = privateAccessClosedBootstrapTuple(rendered);
    } else if (verificationLabel === CLOSED_NO_TRANSITION_LABEL) {
      closedNoTransition = privateAccessClosedNoTransitionTuple(rendered);
    }

    if (sha256(readFileSync(immutableCopy)) !== expectedHash) {
      reject("private_access_plan_copy_changed_before_apply");
    }

    options.onProgress?.("private_access_terraform_apply_started");
    if (receiptFailed) reject("private_access_receipt_failed_before_apply");
    const applied = runTerraform(["apply", "-input=false", "-json", immutableCopy], {
      cwd,
      env: terraformEnvironment,
      input: undefined,
      maxBuffer: MAX_PLAN_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Persist the child outcome before checked recovery's ten-minute wait.
    // Never forward Terraform output or provider error messages to the observer.
    options.onProgress?.("private_access_terraform_apply_returned", {
      exitCode: Number.isInteger(applied?.status) ? applied.status : null,
      processError: applied?.error ? "child_process_error" : null,
      successful: !applied?.error && applied?.status === 0,
    });
    if (applied?.error || applied?.status !== 0) {
      // Persist only finite fixed labels before recovery. Receipt I/O failure
      // is guarded by onProgress and cannot skip reconciliation or its wait.
      for (const label of terraformFailureLabels(applied)) options.onProgress?.(label);
      const failedTransition = opening ?? closing;
      if (failedTransition) {
        try {
          options.onProgress?.("private_access_failed_apply_reconciliation_started");
          reconcilePrivateAccess(failedTransition, options);
          options.onProgress?.("private_access_failed_apply_reconciliation_confirmed");
        } catch {
          reject(opening
            ? "private_access_open_apply_failed_reconciliation_incomplete"
            : "private_access_close_apply_failed_reconciliation_incomplete");
        }
        try {
          verifyEffectiveRevocation(failedTransition, options);
        } catch {
          reject(opening
            ? "private_access_open_apply_failed_revocation_uncertain"
            : "private_access_close_apply_failed_revocation_uncertain");
        }
        reject(opening
          ? "private_access_open_apply_failed_after_effective_revocation"
          : "private_access_close_apply_failed_after_effective_revocation");
      }
      reject("private_access_verified_plan_apply_failed");
    }
    const closedTransition = recovery ?? closing ?? closedBootstrap ?? closedNoTransition;
    if (closing) {
      try {
        reconciliationLabel = reconcilePrivateAccess(closing, options);
      } catch {
        reject("private_access_exact_reconciliation_uncertain_after_cleanup_apply");
      }
    }
    if (closedBootstrap || closedNoTransition) {
      try {
        reconciliationLabel = confirmPrivateAccessClosed(options, closedBootstrap ?? closedNoTransition);
      } catch {
        reject("private_access_exact_reconciliation_uncertain_after_cleanup_apply");
      }
    }
    if (closedTransition) {
      try {
        effectiveRevocationLabel = verifyEffectiveRevocation(closedTransition, options);
      } catch {
        // The close plan has already removed temporary OS Login, IAP and firewall
        // access and converged state. Never undo it or report effective closure
        // when the post-propagation numeric-version matrix is unknown.
        reject("private_access_effective_revocation_uncertain_after_cleanup_apply");
      }
    }

    // Once apply has run, receipt I/O must not interrupt checked recovery or
    // closure verification. It also must not turn an unrecorded run into success.
    if (receiptFailed) reject("private_access_receipt_failed_requires_reconciliation");
    return {
      verificationLabel,
      ...(reconciliationLabel ? { reconciliationLabel } : {}),
      ...(effectiveRevocationLabel ? { effectiveRevocationLabel } : {}),
      resultLabel: "private_access_verified_plan_apply_completed",
      planSha256: expectedHash,
    };
  } catch (error) {
    if (error?.fixedLabel) throw error;
    reject("private_access_verified_plan_apply_failed");
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function main() {
  if (process.argv.length !== 4) reject("private_access_apply_requires_plan_and_reviewed_sha256");
  const result = applyReviewedPrivateAccessPlan(process.argv[2], process.argv[3]);
  process.stdout.write(`${[
    result.verificationLabel,
    result.reconciliationLabel,
    result.effectiveRevocationLabel,
    result.resultLabel,
  ].filter(Boolean).join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.fixedLabel || "private_access_verified_plan_apply_failed"}\n`);
    process.exitCode = 1;
  }
}
