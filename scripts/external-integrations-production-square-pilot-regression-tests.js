const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pilot = path.join(root, "services/external-integrations-production/pilot");
const read = (name) => fs.readFileSync(path.join(pilot, name), "utf8");
const contract = JSON.parse(read("contract.json"));
const baseline = JSON.parse(read("pilot-state.example.json"));
const model = read("model.mjs");
const tests = read("model.test.mjs");
const qualification = read("qualify.mjs");
const databaseVerification = read("verify-database.sql");
const secretStaging = read("stage-provider-secret.sh");
const readme = read("README.md");
const handoff = read("PRIVATE-HANDOFF.md");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, `${command} failed: ${(result.stderr || result.stdout).slice(0, 1_000)}`);
  return result.stdout;
}

assert.equal(contract.projectId, "vaeroex-integrations-prod");
assert.equal(contract.hostname, "square.vaeroex.com");
assert.equal(contract.callbackUrl, "https://square.vaeroex.com/api/integrations/square/callback");
assert.equal(contract.webhookUrl, "https://square.vaeroex.com/api/integrations/square/webhook");
assert.equal(contract.database.requiredFoundationVersion, "20260902191323");
assert.equal(contract.database.requiredOverlayVersion, "20260902191324");
assert.equal(contract.database.squareOverlayRequired, true);
assert.equal(contract.pilotPolicy.maximumAllowlistedWorkspaces, 1);
assert.equal(contract.pilotPolicy.maximumAllowlistedSellers, 1);
assert.equal(contract.pilotPolicy.economicContributionsAllowed, false);
assert.equal(contract.pilotPolicy.aiDispatchAllowed, false);
assert.equal(new Set(Object.keys(contract.database.loginBindings)).size, 6);
assert.equal(new Set(Object.values(contract.database.loginBindings)).size, 6);
assert.deepEqual(Object.values(baseline.activationGates), Array(contract.activationGates.length).fill(false));
assert.deepEqual(Object.values(baseline.credentialVersionsPresent), Array(contract.credentialSlots.length).fill(false));
assert.equal(baseline.database.squareOverlayApplied, false);
assert.equal(baseline.callbackLayerQualified, false);

for (const scenario of contract.requiredSyntheticScenarios) {
  assert.ok(tests.includes(scenario), `${scenario} has focused coverage`);
}
for (const action of contract.prohibitedActions) assert.ok(contract.prohibitedActions.includes(action));
assert.match(model, /credential material is forbidden/);
assert.match(model, /exactly_one_workspace_required/);
assert.match(model, /gate_must_remain_closed/);
assert.match(qualification, /never contacts Production/);

assert.match(databaseVerification, /begin transaction read only;/i);
assert.match(databaseVerification, /not membership\.set_option and not membership\.admin_option/);
assert.match(databaseVerification, /direct_table_acl/);
assert.match(databaseVerification, /direct_login_function_acl/);
assert.match(databaseVerification, /square_production_login_verification_passed/);
assert.doesNotMatch(databaseVerification, /^\s*(?:create|alter|drop|grant|revoke|insert|update|delete|truncate)\s/im,
  "the database verifier stays read-only");

assert.match(secretStaging, /^set \+x$/m);
assert.match(secretStaging, /^umask 077$/m);
assert.match(secretStaging, /ulimit -c 0/);
assert.match(secretStaging, /\[\[ -t 0 && -t 1 && -t 2 \]\]/);
assert.match(secretStaging, /VAEROEX_APPROVED_SECRET_WINDOW/);
assert.match(secretStaging, /gcloud config get-value project/);
assert.match(secretStaging, /vaeroex-integrations-prod/);
assert.match(secretStaging, /existing_versions/);
assert.match(secretStaging, /read -r -s/);
assert.match(secretStaging, /--data-file=-/);
assert.doesNotMatch(secretStaging, /--data-file=["']?\$|echo\s+\$secret|export\s+secret/i,
  "secret bytes never enter argv or the environment");

for (const document of [readme, handoff]) {
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/callback/);
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/webhook/);
}
assert.match(handoff, /only the minimum separately approved read-only\s+pilot gates/);
assert.match(handoff, /Do not enable a second\s+customer, economics, Vaeroex dispatch, QBO changes or additional\s+infrastructure/);
assert.equal(fs.readdirSync(pilot).filter((name) => /handoff/i.test(name)).length, 1,
  "personal actions remain in one consolidated handoff");

run("bash", ["-n", path.join(pilot, "stage-provider-secret.sh")]);
run(process.execPath, ["--test", path.join(pilot, "model.test.mjs")]);
const blockedOutput = run(process.execPath, [
  path.join(pilot, "qualify.mjs"),
  "--evidence", path.join(pilot, "pilot-state.example.json"),
  "--expect-head", baseline.sourceCommit,
  "--expect-blocked"
]);
const blocked = JSON.parse(blockedOutput);
assert.equal(blocked.readyForOneCustomerActivationReview, false);
assert.equal(blocked.gatesRemainClosed, true);
assert.ok(blocked.findings.includes("database_ledger_not_exact_overlay"));
assert.ok(blocked.findings.includes("square_overlay_missing"));

console.log("Production Square pilot package regression tests passed");
