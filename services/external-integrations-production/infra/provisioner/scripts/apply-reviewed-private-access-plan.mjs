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

function effectiveClosedResult(result) {
  if (result?.status !== "policy_troubleshooter_closed_all_denied" || result?.checked_secrets !== "6" ||
      typeof result?.checked_versions !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(result.checked_versions) ||
      typeof result?.checked_tuples !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(result.checked_tuples)) return false;
  return BigInt(result.checked_tuples) === 6n + 3n * BigInt(result.checked_versions);
}

function reconcilePrivateAccess(recovery, options) {
  const reconcile = options.reconcilePrivateAccess ?? reconcileExactPrivateAccess;
  const result = reconcile(recovery, {
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
  });
  if (result?.status !== "private_access_exact_direct_binding_reconciliation_confirmed" ||
      result?.checked_secrets !== "6") throw new Error("invalid reconciliation result");
  return result.status;
}

function confirmPrivateAccessClosed(options) {
  const confirmClosed = options.confirmClosedPrivateAccess ?? confirmExactPrivateAccessClosed;
  const result = confirmClosed({
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
  });
  if (result?.status !== "private_access_exact_direct_binding_absence_confirmed" ||
      result?.checked_secrets !== "6") throw new Error("invalid closed-access result");
  return result.status;
}

function verifyEffectiveRevocation(recovery, options) {
  const waitForRevocationPropagation = options.waitForRevocationPropagation ?? defaultWaitForRevocationPropagation;
  waitForRevocationPropagation(REVOCATION_PROPAGATION_MS);
  const verifyEffective = options.verifyEffectivePrivateAccess ?? verifyEffectivePrivateAccess;
  const result = verifyEffective({
    project_id: PROJECT_ID,
    project_number: PROJECT_NUMBER,
    phase: "closed",
    active_profile: "",
    window_starts_at: recovery.windowStartsAt,
    window_expires_at: recovery.windowExpiresAt,
  }, {
    environment: options.environment ?? process.env,
    ...(options.runGcloud ? { run: options.runGcloud } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (!effectiveClosedResult(result)) throw new Error("invalid effective revocation result");
  return result.status;
}

export function applyReviewedPrivateAccessPlan(planPath, reviewedSha256, options = {}) {
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

    const applied = runTerraform(["apply", "-input=false", immutableCopy], {
      cwd,
      env: terraformEnvironment,
      input: undefined,
      maxBuffer: MAX_PLAN_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (applied?.error || applied?.status !== 0) {
      const failedTransition = opening ?? closing;
      if (failedTransition) {
        try {
          reconcilePrivateAccess(failedTransition, options);
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
        reconciliationLabel = confirmPrivateAccessClosed(options);
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
