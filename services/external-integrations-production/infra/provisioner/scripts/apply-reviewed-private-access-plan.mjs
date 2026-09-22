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

import { verifyPrivateAccessPlan } from "./verify-private-access-plan.mjs";

const MAX_PLAN_BYTES = 128 * 1024 * 1024;
const TERRAFORM_DIAGNOSTIC_ENVIRONMENT = /^TF_LOG(?:_|$)/;

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
      reject("private_access_verified_plan_apply_failed");
    }

    return {
      verificationLabel,
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
  process.stdout.write(`${result.verificationLabel}\n${result.resultLabel}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.fixedLabel || "private_access_verified_plan_apply_failed"}\n`);
    process.exitCode = 1;
  }
}
