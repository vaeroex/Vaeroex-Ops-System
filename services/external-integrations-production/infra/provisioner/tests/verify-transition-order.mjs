import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const terraform = process.env.TERRAFORM_BIN || "terraform";
const providers = path.join(root, ".terraform/providers");
const scratch = mkdtempSync(path.join(os.tmpdir(), "vaeroex-provisioner-order-"));
const profiles = ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"];
const testFile = "tests/transition-order.tftest.hcl";
const firewall = "google_compute_firewall.setup_https[0]";
const generation = "terraform_data.private_access_generation";
const grant = profile => `google_secret_manager_secret_iam_member.private_versions["${profile}"]`;

// No backend, credential environment, external CLI configuration or provider
// download is admitted. The signed cached provider supplies schemas only;
// mock_provider intercepts every resource operation, including teardown.
const env = Object.fromEntries(["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]
  .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
env.TF_IN_AUTOMATION = "1";
env.CHECKPOINT_DISABLE = "1";
env.TF_CLI_CONFIG_FILE = path.join(scratch, "offline.tfrc");

function run(args, tracing = false) {
  const result = spawnSync(terraform, args, {
    cwd: scratch,
    env: { ...env, ...(tracing ? { TF_LOG_CORE: "TRACE" } : {}) },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.error, undefined, "local_mock_transition_process_failed");
  assert.equal(result.status, 0, "local_mock_transition_command_failed");
  return `${result.stdout}\n${result.stderr}`;
}

function section(trace, name) {
  const marker = `vertex "${testFile}.run.${name}": `;
  const start = trace.indexOf(`${marker}starting visit`);
  const end = trace.indexOf(`${marker}visit complete`, start);
  assert.ok(start >= 0 && end > start, "mock_transition_run_trace_missing");
  return trace.slice(start, end);
}

function events(sectionText) {
  const apply = sectionText.lastIndexOf("Starting graph walk: walkApply");
  assert.ok(apply >= 0, "mock_transition_apply_graph_missing");
  const result = [];
  for (const line of sectionText.slice(apply).split("\n")) {
    const match = /vertex "(.+)": (starting visit \(\*terraform\.(NodeApplyableResourceInstance|NodeDestroyResourceInstance)\)|visit complete)$/.exec(line);
    if (!match) continue;
    result.push({ node: JSON.parse(`"${match[1]}"`), event: match[2], kind: match[3] });
  }
  return result;
}

function completedBeforeStarted(eventList, predecessor, successor, failureLabel,
  successorKind = "NodeApplyableResourceInstance") {
  const complete = eventList.findIndex(event => event.node === predecessor && event.event === "visit complete");
  const start = eventList.findIndex(event => event.node === successor && event.kind === successorKind);
  assert.ok(complete >= 0, `${failureLabel}_predecessor_missing`);
  assert.ok(start >= 0, `${failureLabel}_successor_missing`);
  assert.ok(start > complete, failureLabel);
}

try {
  assert.ok(existsSync(providers), "run_terraform_init_with_the_pinned_provider_first");
  for (const file of ["main.tf", "variables.tf", "outputs.tf", "versions.tf", ".terraform.lock.hcl"]) {
    cpSync(path.join(root, file), path.join(scratch, file));
  }
  mkdirSync(path.join(scratch, "tests"));
  const fixture = readFileSync(path.join(root, testFile), "utf8");
  assert.ok(fixture.startsWith('mock_provider "google" {'), "mock_provider_required");
  writeFileSync(path.join(scratch, testFile), fixture);
  writeFileSync(env.TF_CLI_CONFIG_FILE, `provider_installation {\n  filesystem_mirror {\n    path = ${JSON.stringify(providers)}\n    include = ["registry.terraform.io/hashicorp/google"]\n  }\n}\n`);
  run(["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"]);
  const trace = run(["test", `-filter=${testFile}`, "-no-color"], true);
  assert.ok(trace.includes("Success! 8 passed, 0 failed."), "mock_transition_tests_incomplete");
  const forward = section(trace, "setup_removed_credentials_created");
  const reverse = section(trace, "credentials_removed_setup_created");
  const profileSwitch = section(trace, "oauth_destroyed_before_broker_created");
  const timeSwitch = section(trace, "broker_old_window_destroyed_before_new_window_created");
  const forwardEvents = events(forward);
  const reverseEvents = events(reverse);
  const profileSwitchEvents = events(profileSwitch);
  const timeSwitchEvents = events(timeSwitch);
  for (const profile of profiles) {
    // These are apply-graph edges, not an assertion about HCL text or a
    // coincidental ordering of fast mocked API calls.
    assert.ok(forward.includes(`${grant(profile)} has stored dependency of ${firewall} (destroy)`),
      "setup_removal_dependency_missing");
    assert.ok(reverse.includes(`${firewall} has stored dependency of ${grant(profile)} (destroy)`),
      "grant_removal_dependency_missing");
    completedBeforeStarted(forwardEvents, `${firewall} (destroy)`, grant(profile),
      "setup_removal_operation_order_unsafe");
    completedBeforeStarted(reverseEvents, `${grant(profile)} (destroy)`, firewall,
      "grant_removal_operation_order_unsafe");
  }
  assert.ok(profileSwitch.includes(`${generation} (destroy) has stored dependency of ${grant("oauth")} (destroy)`),
    "old_profile_revocation_dependency_missing");
  assert.ok(profileSwitch.includes(`${grant("broker")} has stored dependency of ${generation}`),
    "new_profile_generation_dependency_missing");
  completedBeforeStarted(profileSwitchEvents, `${grant("oauth")} (destroy)`, `${generation} (destroy)`,
    "old_profile_revocation_order_unsafe", "NodeDestroyResourceInstance");
  completedBeforeStarted(profileSwitchEvents, `${generation} (destroy)`, generation,
    "profile_generation_replacement_order_unsafe");
  completedBeforeStarted(profileSwitchEvents, generation, grant("broker"),
    "new_profile_grant_order_unsafe");
  completedBeforeStarted(timeSwitchEvents, `${grant("broker")} (destroy)`, `${generation} (destroy)`,
    "old_window_revocation_order_unsafe", "NodeDestroyResourceInstance");
  completedBeforeStarted(timeSwitchEvents, `${generation} (destroy)`, generation,
    "window_generation_replacement_order_unsafe");
  completedBeforeStarted(timeSwitchEvents, generation, grant("broker"),
    "new_window_grant_order_unsafe");
  process.stdout.write("provisioner_setup_destroy_before_all_six_grants_confirmed\n");
  process.stdout.write("provisioner_all_six_grants_destroy_before_setup_confirmed\n");
  process.stdout.write("provisioner_old_profile_destroy_before_new_profile_confirmed\n");
  process.stdout.write("provisioner_old_window_destroy_before_new_window_confirmed\n");
} catch (error) {
  // Terraform trace and assertion internals remain private to the disposable
  // mocked run; the caller receives only this fixed failure category.
  const fixedLabels = new Set([
    "local_mock_transition_process_failed", "local_mock_transition_command_failed",
    "mock_transition_run_trace_missing", "mock_transition_apply_graph_missing",
    "setup_removal_operation_order_unsafe", "grant_removal_operation_order_unsafe",
    "old_profile_revocation_order_unsafe", "new_profile_grant_order_unsafe",
    "profile_generation_replacement_order_unsafe", "old_window_revocation_order_unsafe",
    "window_generation_replacement_order_unsafe", "new_window_grant_order_unsafe",
    "setup_removal_operation_order_unsafe_predecessor_missing", "setup_removal_operation_order_unsafe_successor_missing",
    "grant_removal_operation_order_unsafe_predecessor_missing", "grant_removal_operation_order_unsafe_successor_missing",
    "old_profile_revocation_order_unsafe_predecessor_missing", "old_profile_revocation_order_unsafe_successor_missing",
    "new_profile_grant_order_unsafe_predecessor_missing", "new_profile_grant_order_unsafe_successor_missing",
    "profile_generation_replacement_order_unsafe_predecessor_missing", "profile_generation_replacement_order_unsafe_successor_missing",
    "old_window_revocation_order_unsafe_predecessor_missing", "old_window_revocation_order_unsafe_successor_missing",
    "window_generation_replacement_order_unsafe_predecessor_missing", "window_generation_replacement_order_unsafe_successor_missing",
    "new_window_grant_order_unsafe_predecessor_missing", "new_window_grant_order_unsafe_successor_missing",
    "run_terraform_init_with_the_pinned_provider_first",
    "mock_provider_required", "mock_transition_tests_incomplete",
    "setup_removal_dependency_missing", "grant_removal_dependency_missing",
    "old_profile_revocation_dependency_missing", "new_profile_generation_dependency_missing",
  ]);
  const label = String(error?.message).split("\n", 1)[0];
  process.stderr.write(`${fixedLabels.has(label) ? label : "mock_transition_verification_failed"}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
