import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyEffectivePrivateAccess } from "../scripts/verify-effective-private-access.mjs";

const requestTime = "2099-01-01T00:10:00Z";
const query = {
  project_id: "vaeroex-integrations-prod",
  project_number: "123456789012",
  phase: "closed",
  active_profile: "",
  window_starts_at: "2099-01-01T00:00:00Z",
  window_expires_at: "2099-01-01T01:00:00Z",
};

function parsedArgument(args, prefix) {
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function responseFor(args, state) {
  const fullResourceName = args[4];
  const resourceName = parsedArgument(args, "--resource-name=");
  return {
    overallAccessState: state,
    accessTuple: {
      principal: "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com",
      fullResourceName,
      permission: parsedArgument(args, "--permission="),
      permissionFqdn: `secretmanager.googleapis.com/${parsedArgument(args, "--permission=").slice("secretmanager.".length)}`,
      conditionContext: {
        request: { receiveTime: parsedArgument(args, "--request-time=") },
        resource: {
          name: resourceName,
          service: parsedArgument(args, "--resource-service="),
          type: parsedArgument(args, "--resource-type="),
        },
      },
    },
    allowPolicyExplanation: {
      allowAccessState: state === "CAN_ACCESS" ? "ALLOW_ACCESS_STATE_GRANTED" : "ALLOW_ACCESS_STATE_NOT_GRANTED",
      explainedPolicies: [],
    },
    denyPolicyExplanation: { denyAccessState: "DENY_ACCESS_STATE_NOT_DENIED", explainedResources: [] },
    pabPolicyExplanation: { explainedBindingsAndPolicies: [] },
  };
}

function profileFromList(args) {
  return args[3]?.match(/^square-production-(oauth|broker|scheduler|webhook|runtime|evidence)-db$/)?.[1];
}

function runnerFor(expectedOpenProfile = "", inventory = {}) {
  const calls = [];
  return {
    calls,
    run(command, args, options) {
      calls.push({ command, args, options });
      if (args[0] === "secrets") {
        const profile = profileFromList(args);
        return {
          status: 0,
          stdout: JSON.stringify((inventory[profile] ?? []).map(version => ({
            name: `projects/123456789012/secrets/square-production-${profile}-db/versions/${version}`,
          }))),
          stderr: "raw-enumeration-must-not-surface",
        };
      }
      const resource = args[4];
      const expected = expectedOpenProfile && resource.includes(`square-production-${expectedOpenProfile}-db`)
        ? "CAN_ACCESS"
        : "CANNOT_ACCESS";
      return { status: 0, stdout: JSON.stringify(responseFor(args, expected)), stderr: "raw-must-not-surface" };
    },
  };
}

const closedRunner = runnerFor();
const closed = verifyEffectivePrivateAccess(query, {
  run: closedRunner.run,
  now: new Date(requestTime),
  environment: { CLOUDSDK_CONFIG: "/private/config", CLOUDSDK_CORE_LOG_HTTP: "true", CLOUDSDK_LOG_HTTP: "1" },
});
assert.deepEqual(closed, {
  status: "policy_troubleshooter_closed_all_denied",
  checked_secrets: "6",
  checked_versions: "0",
  checked_tuples: "6",
});
assert.equal(closedRunner.calls.length, 12);
const closedAnalyses = closedRunner.calls.filter(call => call.args[0] === "beta");
assert.equal(new Set(closedAnalyses.map(call => `${call.args[4]}:${parsedArgument(call.args, "--permission=")}`)).size, 6);
assert.equal(closedAnalyses.every(call => parsedArgument(call.args, "--permission=") === "secretmanager.versions.add" && !call.args[4].includes("/versions/")), true);
assert.equal(closedRunner.calls.filter(call => call.args[0] === "secrets").length, 6);
for (const call of closedRunner.calls.filter(call => call.args[0] === "secrets")) {
  assert.deepEqual(call.args.slice(0, 3), ["secrets", "versions", "list"]);
  assert.equal(call.args.includes("--project=vaeroex-integrations-prod"), true);
  assert.equal(call.args.includes("--format=json(name)"), true);
  assert.equal(call.args.some(value => value.startsWith("--limit=")), false);
  assert.equal(call.options.env.CLOUDSDK_CONFIG, "/private/config");
  assert.equal("CLOUDSDK_CORE_LOG_HTTP" in call.options.env, false);
  assert.equal("CLOUDSDK_LOG_HTTP" in call.options.env, false);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(call.options.timeout, 120_000);
}
for (const call of closedAnalyses) {
  assert.equal(call.command, "gcloud");
  assert.deepEqual(call.args.slice(0, 4), ["beta", "policy-intelligence", "troubleshoot-policy", "iam"]);
  assert.equal(call.args.includes("--project=vaeroex-integrations-prod"), true);
  assert.equal(call.args.includes(`--request-time=${requestTime}`), true);
  assert.equal(call.args.includes("--format=json"), true);
  assert.equal(call.options.env.CLOUDSDK_CONFIG, "/private/config");
  assert.equal("CLOUDSDK_CORE_LOG_HTTP" in call.options.env, false);
  assert.equal("CLOUDSDK_LOG_HTTP" in call.options.env, false);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(call.options.timeout, 120_000);
  assert.equal(call.args.some(value => value.includes("testIamPermissions")), false);
}

const retriedReadRunner = runnerFor();
let failedReadOnce = false;
assert.equal(verifyEffectivePrivateAccess(query, {
  now: new Date(requestTime),
  run(command, args, options) {
    if (!failedReadOnce) {
      failedReadOnce = true;
      retriedReadRunner.calls.push({ command, args, options });
      return { status: 1, stdout: "", stderr: "raw-transient-read-error" };
    }
    return retriedReadRunner.run(command, args, options);
  },
}).status, "policy_troubleshooter_closed_all_denied");
assert.equal(retriedReadRunner.calls.length, 13);

const openRunner = runnerFor("oauth");
assert.deepEqual(verifyEffectivePrivateAccess({ ...query, phase: "open", active_profile: "oauth" }, {
  run: openRunner.run,
  now: new Date(requestTime),
}), {
  status: "policy_troubleshooter_oauth_only_confirmed",
  checked_secrets: "6",
  checked_versions: "0",
  checked_tuples: "6",
});
assert.equal(openRunner.calls.filter(call => call.args[0] === "beta" && call.args[4].includes("square-production-oauth-db")).length, 1);

const populatedOpenRunner = runnerFor("oauth", { oauth: ["1"], broker: ["2"] });
assert.deepEqual(verifyEffectivePrivateAccess({ ...query, phase: "open", active_profile: "oauth" }, {
  run: populatedOpenRunner.run,
  now: new Date(requestTime),
}), {
  status: "policy_troubleshooter_oauth_only_confirmed",
  checked_secrets: "6",
  checked_versions: "2",
  checked_tuples: "12",
});
assert.equal(populatedOpenRunner.calls.filter(call => call.args[0] === "beta" &&
  call.args[4].includes("square-production-oauth-db/versions/1")).length, 3);
assert.equal(populatedOpenRunner.calls.filter(call => call.args[0] === "beta" &&
  call.args[4].includes("square-production-broker-db/versions/2")).length, 3);

const populatedRunner = runnerFor("", { oauth: ["7", "1"], broker: ["2"] });
assert.deepEqual(verifyEffectivePrivateAccess(query, {
  run: populatedRunner.run,
  now: new Date(requestTime),
}), {
  status: "policy_troubleshooter_closed_all_denied",
  checked_secrets: "6",
  checked_versions: "3",
  checked_tuples: "15",
});
const populatedAnalyses = populatedRunner.calls.filter(call => call.args[0] === "beta");
assert.equal(populatedAnalyses.length, 15);
assert.equal(populatedAnalyses.some(call => call.args[4].includes("/versions/latest")), false);
assert.equal(populatedAnalyses.filter(call => call.args[4].endsWith("/versions/1")).length, 3);
assert.equal(populatedAnalyses.filter(call => call.args[4].endsWith("/versions/2")).length, 3);
assert.equal(populatedAnalyses.filter(call => call.args[4].endsWith("/versions/7")).length, 3);
assert.equal(populatedAnalyses.filter(call => parsedArgument(call.args, "--permission=") === "secretmanager.versions.add").length, 6);

function rejected(mutator, label, queryOverride = query) {
  const runner = runnerFor(queryOverride.phase === "open" ? queryOverride.active_profile : "");
  let index = 0;
  assert.throws(() => verifyEffectivePrivateAccess(queryOverride, {
    now: new Date(requestTime),
    run(command, args, options) {
      const base = runner.run(command, args, options);
      if (args[0] === "secrets") return base;
      const response = JSON.parse(base.stdout);
      mutator(response, args, index++);
      return { ...base, stdout: JSON.stringify(response) };
    },
  }), error => error.fixedLabel === label);
}

function verified(mutator, queryOverride = query, inventory = {}) {
  const runner = runnerFor(queryOverride.phase === "open" ? queryOverride.active_profile : "", inventory);
  let index = 0;
  return verifyEffectivePrivateAccess(queryOverride, {
    now: new Date(requestTime),
    run(command, args, options) {
      const base = runner.run(command, args, options);
      if (args[0] === "secrets") return base;
      const response = JSON.parse(base.stdout);
      mutator(response, args, index++);
      return { ...base, stdout: JSON.stringify(response) };
    },
  });
}

rejected((response, _args, index) => { if (index === 0) response.overallAccessState = "CAN_ACCESS"; },
  "policy_troubleshooter_access_mismatch");
rejected((response, _args, index) => { if (index === 4) response.overallAccessState = "UNKNOWN_INFO"; },
  "policy_troubleshooter_analysis_incomplete");
rejected((response, _args, index) => { if (index === 4) response.overallAccessState = "UNKNOWN_CONDITIONAL"; },
  "policy_troubleshooter_analysis_incomplete");
for (const invalidState of [undefined, null, "UNKNOWN", "OVERALL_ACCESS_STATE_UNSPECIFIED", "NOT_GRANTED"]) {
  rejected((response, _args, index) => {
    if (index !== 0) return;
    if (invalidState === undefined) delete response.overallAccessState;
    else response.overallAccessState = invalidState;
  }, "policy_troubleshooter_response_invalid");
}
rejected((response, _args, index) => { if (index === 0) response.accessTuple.permission = "secretmanager.secrets.get"; },
  "policy_troubleshooter_tuple_mismatch");
rejected((response, _args, index) => { if (index === 0) delete response.accessTuple; },
  "policy_troubleshooter_tuple_mismatch");
rejected((response, _args, index) => { if (index === 0) response.accessTuple.permissionFqdn = "secretmanager.googleapis.com/secrets.get"; },
  "policy_troubleshooter_tuple_mismatch");
rejected((response, _args, index) => {
  if (index === 0) response.accessTuple.principal = "other@vaeroex-integrations-prod.iam.gserviceaccount.com";
}, "policy_troubleshooter_tuple_mismatch");
rejected((response, _args, index) => {
  if (index === 0) response.accessTuple.fullResourceName += "-other";
}, "policy_troubleshooter_tuple_mismatch");
rejected((response, _args, index) => {
  if (index === 0) response.accessTuple.conditionContext.request.receiveTime = "2099-01-01T00:10:01Z";
}, "policy_troubleshooter_tuple_mismatch");
for (const field of ["name", "service", "type"]) {
  rejected((response, _args, index) => {
    if (index === 0) response.accessTuple.conditionContext.resource[field] += "-other";
  }, "policy_troubleshooter_tuple_mismatch");
}
assert.equal(verified((response, _args, index) => {
  if (index === 0) {
    delete response.allowPolicyExplanation;
    delete response.denyPolicyExplanation;
    delete response.pabPolicyExplanation;
  }
  if (index === 1) response.allowPolicyExplanation.allowAccessState = "ALLOW_ACCESS_STATE_UNKNOWN_INFO";
  if (index === 2) response.allowPolicyExplanation.errors = [{ code: 7 }];
  if (index === 3) response.allowPolicyExplanation.explainedPolicies.push({
    relevance: "HEURISTIC_RELEVANCE_HIGH",
    condition: { expression: "request.time < timestamp('2100-01-01T00:00:00Z')" },
    conditionExplanation: { value: null },
  });
}).status, "policy_troubleshooter_closed_all_denied");
assert.equal(verified((response, args) => {
  if (args[4].endsWith("/versions/7")) {
    delete response.allowPolicyExplanation;
    response.denyPolicyExplanation = { denyAccessState: "DENY_ACCESS_STATE_UNKNOWN_INFO" };
    response.pabPolicyExplanation = null;
  }
}, query, { oauth: ["7"] }).status, "policy_troubleshooter_closed_all_denied");

const openQuery = { ...query, phase: "open", active_profile: "oauth" };
assert.equal(verified((response, args) => {
  if (args[4].includes("square-production-oauth-db")) return;
  response.allowPolicyExplanation = null;
  response.denyPolicyExplanation = { denyAccessState: "DENY_ACCESS_STATE_UNKNOWN_INFO", errors: [{ code: 7 }] };
  response.pabPolicyExplanation = { principalAccessBoundaryAccessState: "PAB_ACCESS_STATE_UNKNOWN_INFO" };
}, openQuery).status, "policy_troubleshooter_oauth_only_confirmed");
rejected((response, args) => {
  if (args[4].includes("square-production-oauth-db")) delete response.pabPolicyExplanation;
}, "policy_troubleshooter_analysis_incomplete", openQuery);
rejected((response, args, index) => {
  if (index === 0 && args[4].includes("square-production-oauth-db")) response.overallAccessState = "CANNOT_ACCESS";
}, "policy_troubleshooter_access_mismatch", openQuery);
rejected((response, args) => {
  if (args[4].includes("square-production-broker-db")) response.overallAccessState = "CAN_ACCESS";
}, "policy_troubleshooter_access_mismatch", openQuery);

const inheritedNumericRunner = runnerFor("", { oauth: ["1"] });
assert.throws(() => verifyEffectivePrivateAccess(query, {
  now: new Date(requestTime),
  run(command, args, options) {
    const base = inheritedNumericRunner.run(command, args, options);
    if (args[0] === "beta" && args[4].endsWith("/versions/1") &&
        parsedArgument(args, "--permission=") === "secretmanager.versions.access") {
      const response = JSON.parse(base.stdout);
      response.overallAccessState = "CAN_ACCESS";
      response.allowPolicyExplanation.allowAccessState = "ALLOW_ACCESS_STATE_GRANTED";
      return { ...base, stdout: JSON.stringify(response) };
    }
    return base;
  },
}), error => error.fixedLabel === "policy_troubleshooter_access_mismatch");

const changingInventory = { oauth: [] };
const changingRunner = runnerFor("", changingInventory);
assert.equal(verifyEffectivePrivateAccess(query, { run: changingRunner.run, now: new Date(requestTime) }).checked_versions, "0");
changingInventory.oauth.push("1");
assert.equal(verifyEffectivePrivateAccess(query, { run: changingRunner.run, now: new Date(requestTime) }).checked_versions, "1");

for (const result of [
  { status: 1, stdout: "", stderr: "raw provider detail" },
  { status: 0, stdout: "not-json", stderr: "" },
  { status: 0, stdout: JSON.stringify([{ name: "projects/123456789012/secrets/square-production-oauth-db/versions/latest" }]), stderr: "" },
  { status: 0, stdout: JSON.stringify([{ name: "projects/123456789012/secrets/square-production-oauth-db/versions/1" }, { name: "projects/123456789012/secrets/square-production-oauth-db/versions/1" }]), stderr: "" },
  { status: 0, stdout: JSON.stringify([{ name: "projects/123456789012/secrets/square-production-broker-db/versions/1" }]), stderr: "" },
]) {
  assert.throws(() => verifyEffectivePrivateAccess(query, {
    now: new Date(requestTime),
    run(_command, args) {
      if (args[0] === "secrets") return result;
      throw new Error("analysis_must_not_run_after_failed_enumeration");
    },
  }), error => error.fixedLabel === "policy_troubleshooter_version_enumeration_failed");
}

for (const [analysis, label] of [
  [{ status: 1, stdout: "", stderr: "raw provider detail" }, "policy_troubleshooter_process_failed"],
  [{ status: 0, stdout: "not-json", stderr: "" }, "policy_troubleshooter_response_invalid"],
]) {
  assert.throws(() => verifyEffectivePrivateAccess(query, {
    now: new Date(requestTime),
    run(_command, args) {
      return args[0] === "secrets" ? { status: 0, stdout: "[]", stderr: "" } : analysis;
    },
  }), error => error.fixedLabel === label && !error.message.includes("provider detail"));
}
const expiredClosedRunner = runnerFor();
assert.equal(verifyEffectivePrivateAccess(query, {
  now: new Date("2099-01-01T02:00:00Z"),
  run: expiredClosedRunner.run,
}).status, "policy_troubleshooter_closed_all_denied");
assert.equal(expiredClosedRunner.calls.filter(call => call.args[0] === "beta")
  .every(call => call.args.includes("--request-time=2099-01-01T02:00:00Z")), true);
assert.throws(() => verifyEffectivePrivateAccess(openQuery, {
  now: new Date("2099-01-01T01:00:00Z"),
  run() { throw new Error("must_not_run"); },
}), error => error.fixedLabel === "policy_troubleshooter_window_inactive");
assert.throws(() => verifyEffectivePrivateAccess(query, {
  now: new Date("2098-12-31T23:59:59Z"),
  run() { throw new Error("must_not_run"); },
}), error => error.fixedLabel === "policy_troubleshooter_window_inactive");
assert.throws(() => verifyEffectivePrivateAccess({ ...query, project_id: "other" }, {
  now: new Date(requestTime),
  run() { throw new Error("must_not_run"); },
}), error => error.fixedLabel === "policy_troubleshooter_input_invalid");

const cliRoot = mkdtempSync(join(tmpdir(), "vaeroex-policy-troubleshooter-test-"));
try {
  const fakeGcloud = join(cliRoot, "gcloud");
  writeFileSync(fakeGcloud, `#!${process.execPath}\nprocess.stdout.write("raw-response-must-not-surface\\n");\nprocess.stderr.write("raw-provider-error-must-not-surface\\n");\nprocess.exit(19);\n`, { mode: 0o700 });
  const now = new Date();
  now.setMilliseconds(0);
  const start = new Date(now.getTime() - 60_000).toISOString().replace(".000Z", "Z");
  const expiry = new Date(now.getTime() + 3_600_000).toISOString().replace(".000Z", "Z");
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/verify-effective-private-access.mjs", import.meta.url))], {
    input: JSON.stringify({ ...query, window_starts_at: start, window_expires_at: expiry }),
    encoding: "utf8",
    env: { ...process.env, PATH: `${cliRoot}:${process.env.PATH ?? ""}` },
  });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, "");
  assert.equal(cli.stderr, "policy_troubleshooter_version_enumeration_failed\n");
} finally {
  rmSync(cliRoot, { recursive: true, force: true });
}

process.stdout.write("policy_troubleshooter_exact_live_version_matrix_confirmed\n");
