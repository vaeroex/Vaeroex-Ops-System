import assert from "node:assert/strict";

import {
  confirmExactPrivateAccessClosed,
  reconcileExactPrivateAccess,
} from "../scripts/reconcile-private-access.mjs";

const profiles = ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"];
const member = "serviceAccount:sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com";
const role = "projects/vaeroex-integrations-prod/roles/squareProductionPrivateVersions";
const condition = Object.freeze({
  title: "bounded-native-provisioning",
  description: "One exact database secret during the admitted maintenance window.",
  expression: "request.time >= timestamp('2099-01-01T00:00:00Z') && request.time < timestamp('2099-01-01T01:00:00Z')",
});
const recovery = Object.freeze({
  profile: "oauth",
  windowStartsAt: "2099-01-01T00:00:00Z",
  windowExpiresAt: "2099-01-01T01:00:00Z",
});

function exactBinding(overrides = {}) {
  return {
    role,
    members: [member],
    condition: { ...condition },
    ...overrides,
  };
}

function fixture({ removalStatus = 0, removalDisappears = true, binding = exactBinding(),
  bindingProfile = "oauth", malformedProfile } = {}) {
  const calls = [];
  const policies = Object.fromEntries(profiles.map(profile => [profile, { bindings: [] }]));
  if (binding) policies[bindingProfile].bindings.push(binding);
  policies.oauth.bindings.push({ role: "roles/viewer", members: ["user:other@example.com"] });
  return {
    calls,
    policies,
    run(command, args, options) {
      calls.push({ command, args, options });
      assert.equal(command, "gcloud");
      const profile = args[2]?.match(/^square-production-(oauth|broker|scheduler|webhook|runtime|evidence)-db$/)?.[1];
      assert.ok(profile);
      if (args[1] === "get-iam-policy") {
        if (profile === malformedProfile) return { status: 0, stdout: "not-json", stderr: "raw-malformed" };
        return { status: 0, stdout: JSON.stringify(policies[profile]), stderr: "raw-policy-must-not-surface" };
      }
      assert.equal(args[1], "remove-iam-policy-binding");
      assert.equal(args.includes("--project=vaeroex-integrations-prod"), true);
      assert.equal(args.includes(`--member=${member}`), true);
      assert.equal(args.includes(`--role=${role}`), true);
      assert.equal(args.includes(`--condition=expression=${condition.expression},title=${condition.title},description=${condition.description}`), true);
      if (removalDisappears) {
        policies[profile].bindings = policies[profile].bindings.flatMap(candidate => {
          if (candidate.role !== role || candidate.condition?.expression !== condition.expression) return [candidate];
          const members = candidate.members.filter(candidateMember => candidateMember !== member);
          return members.length ? [{ ...candidate, members }] : [];
        });
      }
      return { status: removalStatus, stdout: "raw-removal-must-not-surface", stderr: "raw-error-must-not-surface" };
    },
  };
}

const orphan = fixture({
  binding: exactBinding({ members: [member, "serviceAccount:unrelated@vaeroex-integrations-prod.iam.gserviceaccount.com"] }),
});
const reconciled = reconcileExactPrivateAccess(recovery, {
  run: orphan.run,
  environment: {
    CLOUDSDK_CONFIG: "/private/config",
    CLOUDSDK_CORE_LOG_HTTP: "true",
    CLOUDSDK_LOG_HTTP: "1",
    VAEROEX_SAFE_ENVIRONMENT_SENTINEL: "preserved",
  },
});
assert.deepEqual(reconciled, {
  status: "private_access_exact_direct_binding_reconciliation_confirmed",
  checked_secrets: "6",
  removed_bindings: "1",
});
assert.equal(orphan.calls.filter(call => call.args[1] === "get-iam-policy").length, 12);
assert.equal(orphan.calls.filter(call => call.args[1] === "remove-iam-policy-binding").length, 1);
assert.deepEqual(new Set(orphan.calls.filter(call => call.args[1] === "get-iam-policy").map(call => call.args[2])),
  new Set(profiles.map(profile => `square-production-${profile}-db`)));
assert.deepEqual(orphan.policies.oauth.bindings, [
  exactBinding({ members: ["serviceAccount:unrelated@vaeroex-integrations-prod.iam.gserviceaccount.com"] }),
  { role: "roles/viewer", members: ["user:other@example.com"] },
]);
for (const call of orphan.calls) {
  assert.equal(call.options.env.CLOUDSDK_CONFIG, "/private/config");
  assert.equal(call.options.env.VAEROEX_SAFE_ENVIRONMENT_SENTINEL, "preserved");
  assert.equal("CLOUDSDK_CORE_LOG_HTTP" in call.options.env, false);
  assert.equal("CLOUDSDK_LOG_HTTP" in call.options.env, false);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
}

const beforeSecondPass = orphan.calls.length;
assert.deepEqual(reconcileExactPrivateAccess(recovery, { run: orphan.run }), {
  status: "private_access_exact_direct_binding_reconciliation_confirmed",
  checked_secrets: "6",
  removed_bindings: "0",
});
assert.equal(orphan.calls.slice(beforeSecondPass).filter(call => call.args[1] === "remove-iam-policy-binding").length, 0);

const racedRemoval = fixture({ removalStatus: 1, removalDisappears: true });
assert.deepEqual(reconcileExactPrivateAccess(recovery, { run: racedRemoval.run }), {
  status: "private_access_exact_direct_binding_reconciliation_confirmed",
  checked_secrets: "6",
  removed_bindings: "1",
});
assert.equal(racedRemoval.calls.filter(call => call.args[1] === "get-iam-policy").length, 12);

for (const unsafe of [
  { binding: exactBinding({ role: "roles/secretmanager.secretAccessor" }) },
  { binding: exactBinding({ condition: { ...condition, title: "other" } }) },
  { binding: exactBinding({ condition: { ...condition, description: "other" } }) },
  { binding: exactBinding({ condition: { ...condition, expression: "request.time < timestamp('2099-01-01T01:00:00Z')" } }) },
  { binding: exactBinding(), bindingProfile: "broker" },
]) {
  const unsafeFixture = fixture(unsafe);
  assert.throws(() => reconcileExactPrivateAccess(recovery, { run: unsafeFixture.run }),
    error => error.fixedLabel === "private_access_exact_reconciliation_failed" &&
      !error.message.includes("raw-"));
  assert.equal(unsafeFixture.calls.some(call => call.args[1] === "remove-iam-policy-binding"), false);
}

const retained = fixture({ removalStatus: 1, removalDisappears: false });
assert.throws(() => reconcileExactPrivateAccess(recovery, { run: retained.run }),
  error => error.fixedLabel === "private_access_exact_reconciliation_failed" &&
    !error.message.includes("raw-"));

const lateMalformed = fixture({ malformedProfile: "evidence" });
assert.throws(() => reconcileExactPrivateAccess(recovery, { run: lateMalformed.run }),
  error => error.fixedLabel === "private_access_exact_reconciliation_failed");
assert.equal(lateMalformed.calls.some(call => call.args[1] === "remove-iam-policy-binding"), false);

const alreadyClosed = fixture({ binding: null });
assert.deepEqual(confirmExactPrivateAccessClosed({ run: alreadyClosed.run }), {
  status: "private_access_exact_direct_binding_absence_confirmed",
  checked_secrets: "6",
});
assert.equal(alreadyClosed.calls.filter(call => call.args[1] === "get-iam-policy").length, 6);
assert.equal(alreadyClosed.calls.some(call => call.args[1] === "remove-iam-policy-binding"), false);

const residualWhileClosed = fixture();
assert.throws(() => confirmExactPrivateAccessClosed({ run: residualWhileClosed.run }),
  error => error.fixedLabel === "private_access_exact_reconciliation_failed");
assert.equal(residualWhileClosed.calls.filter(call => call.args[1] === "get-iam-policy").length, 6);
assert.equal(residualWhileClosed.calls.some(call => call.args[1] === "remove-iam-policy-binding"), false);

process.stdout.write("private_access_post_accept_orphan_exact_reconciliation_confirmed\n");
