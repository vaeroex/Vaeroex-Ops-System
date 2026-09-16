const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
const readme = read("README.md");
const handoff = read("PRIVATE-HANDOFF.md");
const releasePins = fs.readFileSync(path.join(root,
  "services/external-integrations-production/infra/activation/production.tfvars.example"), "utf8");

function releasePin(name) {
  const match = releasePins.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, "m"));
  assert.ok(match, `${name} must have one exact quoted release pin`);
  return match[1];
}

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
assert.equal(contract.database.requiredOverlayPath, "supabase/migrations/20260902191324_square_production_runtime_overlay.sql");
assert.equal(contract.database.requiredOverlaySourceCommit, "5e3fb044bf492e6a1d5c323e0030a58a9a63f553");
assert.equal(contract.database.requiredOverlaySha256, "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f");
assert.equal(contract.database.requiredPostflight, "square_production_overlay_object_and_authorization_postflight_passed");
assert.equal(contract.database.requiredOverlayObjects.relations.length, 4);
assert.equal(contract.database.requiredOverlayObjects.privateFunctions.length, 6);
for (const objectName of [
  ...contract.database.requiredOverlayObjects.relations,
  ...contract.database.requiredOverlayObjects.privateFunctions
]) assert.ok(databaseVerification.includes(`('${objectName}')`), `${objectName} is part of the exact overlay object postflight`);
assert.equal(contract.database.requiredOverlayObjects.triggers.length, 12);
for (const triggerBinding of contract.database.requiredOverlayObjects.triggers) {
  const [relationName, triggerName] = triggerBinding.split(":");
  assert.ok(databaseVerification.includes(`('${relationName}','${triggerName}',`), `${triggerBinding} is part of the exact trigger postflight`);
}
assert.equal(contract.pilotPolicy.maximumAllowlistedWorkspaces, 1);
assert.equal(contract.pilotPolicy.maximumAllowlistedSellers, 1);
assert.equal(contract.pilotPolicy.economicContributionsAllowed, false);
assert.equal(contract.pilotPolicy.aiDispatchAllowed, false);
assert.equal(new Set(Object.keys(contract.database.loginBindings)).size, 6);
assert.equal(new Set(Object.values(contract.database.loginBindings)).size, 6);
assert.deepEqual(contract.database.authorityRpcBindings, Object.fromEntries([
  "oauth", "broker", "scheduler", "webhook", "runtime", "evidence"
].map((capability) => [
  `square_production_${capability}_authority`,
  `public.check_square_production_${capability}_authority_v1(text,text,text,bigint,text)`
])));
assert.deepEqual(Object.values(baseline.activationGates), Array(contract.activationGates.length).fill(false));
for (const metadata of Object.values(baseline.credentialVersionsPresent)) {
  assert.deepEqual(metadata, { version: null, state: "ABSENT", totalCount: 0 });
}
assert.equal(baseline.database.overlaySha256, null);
assert.equal(baseline.database.overlaySourceCommit, null);
assert.deepEqual(baseline.productionReleaseDeployment, {
  sharedBootstrapSourceCommit: null,
  sharedBootstrapImageDigest: null,
  callbackEdgeSourceCommit: null,
  callbackEdgeImageDigest: null,
  oauthCallbackSourceCommit: null,
  oauthCallbackImageDigest: null
});
assert.deepEqual(Object.values(baseline.productionReleaseDeployment), Array(6).fill(null),
  "the checked-in example remains blocked without deployed release readbacks");
assert.deepEqual(contract.reviewedProductionRelease, {
  sharedBootstrapSourceCommit: "f4915edadbe2abddd7993c74c1fc3e80e1d1f821",
  sharedBootstrapImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:d56fe933eab1322bb4fe905b183964a980d641af23d69904e15989add501dc6f",
  oauthCallbackSourceCommit: "45cc2193dd87270ef413f2e21c65cf3b05c1c255",
  oauthCallbackImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:ebd5e50ab854ca3de3f49ee51ea8fbef0dfa5510b74c19b0ec6e9c367fffeddf",
  callbackEdgeSourceCommit: "45cc2193dd87270ef413f2e21c65cf3b05c1c255",
  callbackEdgeImageDigest: "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:0a841f23b5a45edbbdca61ab4a8a5c2391a377cef1f5a5c00e113db1a33c5bf9"
});
assert.deepEqual(contract.expectedReleasePairChanges, {
  sharedBootstrap: false,
  oauthCallback: true,
  callbackEdge: true
});
assert.deepEqual({
  sharedBootstrapSourceCommit: releasePin("source_commit"),
  sharedBootstrapImageDigest: releasePin("bootstrap_image_digest"),
  oauthCallbackSourceCommit: releasePin("oauth_callback_source_commit"),
  oauthCallbackImageDigest: releasePin("oauth_callback_image_digest"),
  callbackEdgeSourceCommit: releasePin("callback_edge_source_commit"),
  callbackEdgeImageDigest: releasePin("callback_edge_image_digest")
}, contract.reviewedProductionRelease,
"the reviewed pilot contract and Terraform release inputs pin the same six deployed identities");
for (const [pair, [sourceField, digestField]] of Object.entries({
  sharedBootstrap: ["sharedBootstrapSourceCommit", "sharedBootstrapImageDigest"],
  oauthCallback: ["oauthCallbackSourceCommit", "oauthCallbackImageDigest"],
  callbackEdge: ["callbackEdgeSourceCommit", "callbackEdgeImageDigest"]
})) {
  const changed = contract.reviewedProductionRelease[sourceField] !== contract.priorProductionRelease[sourceField]
    && contract.reviewedProductionRelease[digestField] !== contract.priorProductionRelease[digestField];
  const unchanged = contract.reviewedProductionRelease[sourceField] === contract.priorProductionRelease[sourceField]
    && contract.reviewedProductionRelease[digestField] === contract.priorProductionRelease[digestField];
  assert.equal(contract.expectedReleasePairChanges[pair] ? changed : unchanged, true,
    `${pair} changes both source and digest together exactly as reviewed`);
}
assert.equal(contract.priorProductionRelease.sharedBootstrapSourceCommit, "f4915edadbe2abddd7993c74c1fc3e80e1d1f821");
assert.equal(contract.priorProductionRelease.oauthCallbackSourceCommit, "f4915edadbe2abddd7993c74c1fc3e80e1d1f821");
assert.equal(contract.priorProductionRelease.callbackEdgeSourceCommit, "bb4ad8d3653ca0eecdada88eeeea8a86fa76fc81");

for (const scenario of contract.requiredSyntheticScenarios) {
  assert.ok(tests.includes(scenario), `${scenario} has focused coverage`);
}
for (const action of contract.prohibitedActions) assert.ok(contract.prohibitedActions.includes(action));
assert.match(model, /credential material is forbidden/);
assert.match(model, /exactly_one_workspace_required/);
assert.match(model, /gate_must_remain_closed/);
assert.match(qualification, /never contacts Production/);
assert.match(qualification, /createHash\("sha256"\)/);
assert.match(qualification, /gitOutput\(\["show"/);
assert.match(qualification, /merge-base", "--is-ancestor"/);
assert.match(qualification, /qualificationSourceHead/);
assert.match(qualification, /qualificationSourcesExact/);
assert.match(qualification, /status", "--porcelain=v1"/);
assert.doesNotMatch(readme, /6b5ccc4513150312e5c3a1dbcce81fab111571e7/,
  "the handoff command must resolve the exact current qualification head instead of a stale base");

assert.match(databaseVerification, /begin transaction read only;/i);
assert.match(databaseVerification, /set local search_path='';/i);
assert.match(databaseVerification, /current_setting\('server_version_num'\)::integer<170000/);
assert.match(databaseVerification, /current_setting\('server_version_num'\)::integer>=180000/);
assert.match(databaseVerification, /square_production_postgresql_major_not_exact/);
assert.match(databaseVerification, /version<='20260902191324'\)<>103/);
assert.match(databaseVerification, /224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146/);
assert.match(databaseVerification, /2739c85b607701a5635c636112a32122ea7d244dc569273d5c9ea3fd05300d26/,
  "the exact PostgreSQL 17 columns/defaults/generated expressions/constraints/indexes digest is pinned");
assert.match(databaseVerification, /attribute\.attcollation=0 then null else pg_catalog\.format\(/);
assert.match(databaseVerification, /collation_record\.collprovider::text/);
assert.match(databaseVerification, /collation_record\.collisdeterministic,collation_record\.collversion/);
for (const count of [65, 80, 9]) assert.match(databaseVerification, new RegExp(`or ${count}<>\\(select count\\(\\*\\)`));
assert.match(databaseVerification, /square_production_overlay_ledger_not_exact/);
assert.match(databaseVerification, /not membership\.set_option and not membership\.admin_option/);
assert.match(databaseVerification, /unexpected_login_member/);
for (const [authority, signature] of Object.entries(contract.database.authorityRpcBindings)) {
  assert.ok(databaseVerification.includes(`'${authority}','${signature}'`), `${authority} has one exact RPC signature`);
}
assert.match(databaseVerification, /1<>\(\s*select count\(\*\)[\s\S]*acl\.grantee=authority_role\.oid/);
assert.match(databaseVerification, /unexpected_rpc_grantee/);
assert.match(databaseVerification, /direct_relation_acl/);
assert.match(databaseVerification, /overlay_relation_acl/);
assert.match(databaseVerification, /pg_catalog\.pg_attribute attribute on attribute\.attacl is not null/);
assert.match(databaseVerification, /direct_column_acl/);
assert.match(databaseVerification, /overlay_column_acl/);
assert.match(databaseVerification, /effective_overlay_relation_privilege/);
assert.match(databaseVerification, /has_table_privilege\(/);
assert.match(databaseVerification, /\('MAINTAIN'\)/,
  "PostgreSQL 17 MAINTAIN is included in relation privilege closure");
assert.match(databaseVerification, /effective_overlay_column_privilege/);
assert.match(databaseVerification, /has_column_privilege\(/);
assert.match(databaseVerification, /effective_application_relation_privilege:/);
assert.match(databaseVerification, /effective_application_column_privilege:/);
for (const view of ["pg_stat_statements", "pg_stat_statements_info"]) {
  assert.match(databaseVerification, new RegExp(`\\('${view}'\\)`));
}
assert.match(databaseVerification, /relation\.relkind='v'/);
assert.match(databaseVerification, /extension_record\.extname='pg_stat_statements'/);
assert.match(databaseVerification, /acl\.grantee=0 and acl\.privilege_type='SELECT' and not acl\.is_grantable/);
assert.match(databaseVerification, /not exists\([\s\S]*pg_catalog\.has_schema_privilege\(target\.role_name,namespace\.oid,'USAGE'\)/);
assert.match(databaseVerification, /2<>\(select count\(\*\) from benign_stat_views\)/);
assert.match(databaseVerification, /privilege\.privilege_type='SELECT'[\s\S]*relation\.oid in \(select relation_oid from benign_stat_views\)/,
  "only the exact unreachable pg_stat_statements SELECT views are exempted");
assert.match(databaseVerification, /effective_sequence_privilege:/);
assert.match(databaseVerification, /has_sequence_privilege\(target\.role_name,relation\.oid,privilege\.privilege_type\)/);
assert.match(databaseVerification, /\(values \('USAGE'\),\('SELECT'\),\('UPDATE'\)\) privilege\(privilege_type\)/);
assert.equal((databaseVerification.match(/dependency\.deptype='e'/g) || []).length, 1,
  "extension membership is used only to bind the two literal pg_stat_statements views, never as a blanket exception");
assert.match(databaseVerification, /public_relation_acl:/);
assert.match(databaseVerification, /public_column_acl:/);
assert.match(databaseVerification, /namespace\.nspname='public'[\s\S]*acl\.grantee=0/,
  "ambient PUBLIC relation and column ACLs are rejected for every pilot role");
assert.match(databaseVerification, /direct_login_function_acl/);
assert.match(databaseVerification, /namespace\.nspname not in \('pg_catalog','information_schema','pg_toast'\)/);
assert.match(databaseVerification, /\^\(pg_temp_\[0-9\]\+\|pg_toast_temp_\[0-9\]\+\)\$/);
assert.doesNotMatch(databaseVerification, /namespace\.nspname!~'\^pg_'/,
  "non-system scans do not blanket-exempt application schemas prefixed pg_");
assert.match(databaseVerification, /effective_unexpected_routine/);
assert.match(databaseVerification, /has_schema_privilege\(target\.role_name,namespace\.oid,'USAGE'\)/);
assert.match(databaseVerification, /has_function_privilege\(target\.role_name,procedure\.oid,'EXECUTE'\)/);
assert.match(databaseVerification, /authority_schema_acl_not_exact/);
assert.match(databaseVerification, /has_schema_privilege\(target\.role_name,'public','CREATE'\)/);
assert.match(databaseVerification, /effective_schema_create/);
assert.match(databaseVerification, /direct_database_acl/);
assert.match(databaseVerification, /has_database_privilege\(target\.role_name,database\.oid,'CREATE'\)/);
assert.match(databaseVerification, /effective_database_connect_not_exact/);
assert.match(databaseVerification, /database\.datallowconn/);
assert.match(databaseVerification, /database\.datname=pg_catalog\.current_database\(\)[\s\S]*'CONNECT'/);
assert.match(databaseVerification, /effective_database_temporary_not_baseline/);
assert.match(databaseVerification, /database\.datname not in \(pg_catalog\.current_database\(\),'postgres'\)[\s\S]*'TEMPORARY'/);
assert.doesNotMatch(databaseVerification, /database\.datname<>pg_catalog\.current_database\(\)[\s\S]*'CONNECT'/,
  "inherited provider PUBLIC CONNECT is documented rather than globally revoked or misrepresented as a per-role deny");
assert.match(databaseVerification, /has_foreign_data_wrapper_privilege\(target\.role_name,wrapper\.oid,'USAGE'\)/);
assert.match(databaseVerification, /has_server_privilege\(target\.role_name,server\.oid,'USAGE'\)/);
assert.match(databaseVerification, /has_tablespace_privilege\(target\.role_name,tablespace\.oid,'CREATE'\)/);
assert.match(databaseVerification, /direct_default_acl/);
assert.match(databaseVerification, /public_material_default_acl:/);
assert.match(databaseVerification, /default_acl\.defaclobjtype in \('r','S','f','n'\) and acl\.grantee=0/);
assert.match(databaseVerification, /pg_catalog\.pg_parameter_acl parameter/);
assert.match(databaseVerification, /parameter_acl:/);
assert.match(databaseVerification, /pg_catalog\.pg_largeobject_metadata large_object/);
assert.match(databaseVerification, /large_object_acl:/);
assert.match(databaseVerification, /acl\.grantee=0 or exists\(/,
  "PUBLIC and direct target parameter/large-object ACLs are rejected");
assert.match(databaseVerification, /expected_acl_dependencies/);
assert.match(databaseVerification, /unexpected_acl_dependency/);
assert.match(databaseVerification, /missing_expected_acl_dependency/);
assert.match(databaseVerification, /dependency\.deptype='a'/,
  "all explicit ACL dependencies are closed across the PostgreSQL cluster");
assert.match(databaseVerification, /pg_catalog\.pg_db_role_setting setting on setting\.setrole=target_role\.oid/);
assert.match(databaseVerification, /database_role_setting:/);
assert.match(databaseVerification, /role_owns_catalog_object/);
assert.doesNotMatch(databaseVerification, /dependency\.dbid\s+in/,
  "role ownership is rejected cluster-wide, including objects in other databases");
assert.match(databaseVerification, /target_roles target join pg_catalog\.pg_roles target_role/);
assert.match(databaseVerification, /relation\.relowner<>'postgres'::regrole::oid/);
assert.match(databaseVerification, /procedure\.proowner<>'postgres'::regrole::oid/);
assert.match(databaseVerification, /overlay_trigger_inventory_not_exact/);
assert.match(databaseVerification, /overlay_relation_inventory_not_exact/);
assert.match(databaseVerification, /overlay_private_function_inventory_not_exact/);
assert.match(databaseVerification, /overlay_public_rpc_inventory_not_exact/);
assert.match(databaseVerification, /overlay_private_function_exposed/);
assert.match(databaseVerification, /acldefault\('f',procedure\.proowner\)/,
  "NULL private-function ACLs are expanded to PostgreSQL's default PUBLIC EXECUTE grant");
assert.match(databaseVerification, /overlay_private_function_unsafe/);
assert.match(databaseVerification, /overlay_function_definition_mismatch/);
assert.match(databaseVerification, /procedure\.prosrc/);
assert.match(databaseVerification, /procedure\.proargnames is distinct from expected_functions\.argument_names/);
assert.match(databaseVerification, /procedure\.proargmodes is not null or procedure\.proallargtypes is not null/);
assert.match(databaseVerification, /expected_triggers\.trigger_type/);
assert.match(databaseVerification, /expected_triggers\.trigger_function/);
assert.match(databaseVerification, /not procedure\.prosecdef or procedure\.provolatile<>'s'/);
assert.match(databaseVerification, /pg_catalog\.pg_policy/);
assert.match(databaseVerification, /pg_catalog\.pg_publication_namespace/);
assert.match(databaseVerification, /square_production_overlay_object_and_authorization_postflight_passed/);
assert.doesNotMatch(databaseVerification, /^\s*(?:create|alter|drop|grant|revoke|insert|update|delete|truncate)\s/im,
  "the database verifier stays read-only");

assert.equal(fs.existsSync(path.join(pilot, "stage-provider-secret.sh")), false,
  "local gcloud secret staging is forbidden; credentials use the provider-controlled private console procedure");

for (const document of [readme, handoff]) {
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/callback/);
  assert.match(document, /https:\/\/square\.vaeroex\.com\/api\/integrations\/square\/webhook/);
}
assert.match(handoff, /only the minimum separately approved read-only\s+pilot gates/);
assert.match(handoff, /Do not enable\s+a second\s+customer, economics, Vaeroex dispatch, QBO changes or additional\s+infrastructure/);
assert.match(readme, /No implementation\s+for creating and privately delivering the exact six Production LOGINs is\s+committed in this repository/);
assert.match(readme, /explicit readiness\s+blocker/);
assert.match(readme, /fixed six-profile Production extension of\s+`tools\/native-broker-provisioning`/);
assert.match(readme, /dedicated private Production\s+execution environment and identity/);
assert.match(readme, /Sandbox VM\/service account must not be repurposed/);
assert.match(readme, /plaintext textarea or unverified masking is not a no-echo path/i);
assert.match(readme, /consumeState` returns `null`/);
assert.match(readme, /lifecycle model tests[\s\S]*synthetic contract checks only/);
assert.match(readme, /executable Production binding\/runtime[\s\S]*fixed native provisioner/);
assert.match(handoff, /plaintext textarea or unverified\s+masking is not a no-echo path/i);
assert.match(handoff, /six-LOGIN native-SCRAM blocker or executable Production\s+binding\/runtime blocker is unresolved[\s\S]*must not begin/);
for (const document of [readme, handoff]) {
  assert.match(document, /isaac@vaeroex\.com/);
  assert.match(document, /square-production-application/);
  assert.match(document, /square-production-webhook-signature/);
  assert.match(document, /version `?1`?/i);
  assert.match(document, /metadata-only/i);
  assert.match(document, /do\s+not retry/i);
  assert.doesNotMatch(document, /stage-provider-secret\.sh|gcloud\s/i);
}
assert.equal(fs.readdirSync(pilot).filter((name) => /handoff/i.test(name)).length, 1,
  "personal actions remain in one consolidated handoff");

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
assert.ok(blocked.findings.includes("qualification_source_head_mismatch"));
assert.ok(blocked.findings.includes("qualification_sources_not_exact_head"));
assert.ok(blocked.findings.includes("square_overlay_sha256_mismatch"));
assert.ok(blocked.findings.includes("reviewed_overlay_source_not_in_qualification_head"));
assert.ok(blocked.findings.includes("square_overlay_source_commit_mismatch"));
assert.ok(blocked.findings.includes("reviewed_overlay_source_missing_or_mismatch"));
assert.ok(blocked.findings.includes("production_release_deployment_mismatch:sharedBootstrapSourceCommit"));

// Exercise the actual CLI in a synthetic repository. A stale or modified SQL
// verifier must not be able to reuse the fixed postflight marker as evidence.
const sourceFixture = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-pilot-source-pin-"));
try {
  const relativePilot = "services/external-integrations-production/pilot";
  const fixturePilot = path.join(sourceFixture, relativePilot);
  fs.mkdirSync(fixturePilot, { recursive: true });
  for (const name of ["contract.json", "model.mjs", "qualify.mjs", "verify-database.sql", "pilot-state.example.json"]) {
    fs.copyFileSync(path.join(pilot, name), path.join(fixturePilot, name));
  }
  const fixtureGit = (...args) => run("git", ["-C", sourceFixture,
    "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
    "-c", "user.name=Local synthetic fixture", "-c", "user.email=fixture@example.invalid", ...args]);
  fixtureGit("init", "--quiet");
  fixtureGit("add", ".");
  fixtureGit("commit", "--quiet", "-m", "Synthetic source-pin fixture");
  const fixtureHead = fixtureGit("rev-parse", "HEAD").trim();
  const qualifyFixture = () => JSON.parse(run(process.execPath, [
    path.join(fixturePilot, "qualify.mjs"), "--expect-head", fixtureHead,
    "--evidence", path.join(fixturePilot, "pilot-state.example.json"), "--expect-blocked"
  ]));
  assert.equal(qualifyFixture().findings.includes("qualification_sources_not_exact_head"), false);
  fs.appendFileSync(path.join(fixturePilot, "verify-database.sql"), "\n-- synthetic unreviewed verifier change\n");
  assert.ok(qualifyFixture().findings.includes("qualification_sources_not_exact_head"),
    "a dirty SQL verifier is rejected even when the fixed postflight marker is unchanged");
} finally {
  fs.rmSync(sourceFixture, { recursive: true, force: true });
}

console.log("Production Square pilot package regression tests passed");
