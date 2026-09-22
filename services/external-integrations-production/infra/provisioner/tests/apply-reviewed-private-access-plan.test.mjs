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
        checkpoint_expires_at: "2099-01-01T01:00:00Z",
      },
    },
  },
};
const validJson = Buffer.from(JSON.stringify({ format_version: "1.2", resource_changes: [generation] }));

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
    runTerraform(args) {
      if (args[0] === "apply") applyCalled = true;
      return { status: 0, stdout: Buffer.from('{"resource_changes":[]}'), stderr: Buffer.alloc(0) };
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

const fakeTerraformDirectory = join(root, "fake-terraform-bin");
mkdirSync(fakeTerraformDirectory, { mode: 0o700 });
const fakeTerraformPath = join(fakeTerraformDirectory, "terraform");
const encodedPlanJson = validJson.toString("base64");
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
  "private_access_plan_closed_bootstrap_confirmed\nprivate_access_verified_plan_apply_completed\n",
);
assert.equal(cliResult.stderr, "");
assert.equal(cliResult.stdout.includes("raw-"), false);
assert.equal(cliResult.stderr.includes("raw-"), false);
assert.equal(existsSync(join(root, "terraform-cli.log")), false);
assert.equal(existsSync(join(root, "terraform-cli-protocol-logs")), false);

rmSync(root, { recursive: true, force: true });
process.stdout.write("private_access_single_verified_apply_entrypoint_confirmed\n");
