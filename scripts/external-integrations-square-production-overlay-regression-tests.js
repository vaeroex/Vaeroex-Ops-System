const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const baseName = "20260902191323_integration_production_runtime_foundation.sql";
const overlayName = "20260902191324_square_production_runtime_overlay.sql";
const firstExcludedName = "20260907042202_square_dormant_trusted_authority.sql";
const migrationDirectory = path.join(root, "supabase/migrations");
const migrations = fs.readdirSync(migrationDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const overlay = fs.readFileSync(path.join(migrationDirectory, overlayName), "utf8");
const legacyGuard = fs.readFileSync(
  path.join(migrationDirectory, "20260915040500_integration_production_legacy_foundation_guard.sql"),
  "utf8"
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const runner = fs.readFileSync(
  path.join(root, "scripts/run-square-production-overlay-qualification.js"),
  "utf8"
);

assert.equal(migrations.indexOf(baseName), 101, "Production foundation remains migration 102");
assert.equal(migrations[102], overlayName, "Production overlay is the adjacent migration 103");
assert.equal(migrations[103], firstExcludedName, "Sandbox migrations remain later and excluded");
assert.equal(
  migrations.filter((name) => name <= baseName).length,
  102,
  "the exact Production prefix contains 102 migrations"
);
const baselineVersions = migrations
  .filter((name) => name <= baseName)
  .map((name) => name.split("_", 1)[0]);
const baselineFingerprint = `sha256:${crypto.createHash("sha256").update(
  baselineVersions.map((version) => `${version.length}:${version}`).join("")
).digest("hex")}`;
assert.equal(
  baselineFingerprint,
  "sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f",
  "checked-in Production prefix retains its fixed ordered-ledger fingerprint"
);

assert.ok(overlay.trimStart().startsWith("-- Dormant Square Production runtime overlay."));
assert.ok(overlay.trimEnd().endsWith("commit;"));
assert.match(overlay, /baseline_version_count <> 102/);
assert.match(overlay, /sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f/);
assert.match(overlay, /version='20260902191323'/);
assert.match(overlay, /version <> '20260902191324'/);
assert.match(overlay, /square_production_overlay_requires_postgresql_17/);
assert.match(overlay, /relation\.relkind <> 'r' or relation\.relpersistence <> 'p'/,
  "overlay rejects non-permanent provider-neutral foundation relations");
assert.match(overlay, /to_regclass\('private\.square_account_configuration'\) is not null/);
assert.match(overlay, /to_regclass\('private\.square_production_runtime_binding'\) is not null/);
assert.doesNotMatch(overlay, /create table private\.square_account_/i);
assert.doesNotMatch(overlay, /create table private\.square_production_runtime_binding\s*\(/i);
assert.doesNotMatch(overlay, /squareupsandbox|sandbox-sq0id|oysjpoondtcrqpghhrbd/i);
assert.doesNotMatch(overlay, /quickbooks|\bqbo\b/i, "the overlay cannot change QBO");

assert.match(overlay, /callback_origin text not null default 'https:\/\/square\.vaeroex\.com'/);
assert.match(overlay, /callback_method text not null default 'GET'/);
assert.match(overlay, /callback_path text not null default '\/api\/integrations\/square\/callback'/);
assert.match(overlay, /webhook_method text not null default 'POST'/);
assert.match(overlay, /webhook_path text not null default '\/api\/integrations\/square\/webhook'/);
assert.match(overlay, /project_id text not null default 'vaeroex-integrations-prod'/);
assert.match(overlay, /environment text not null default 'production'/);
assert.match(overlay, /provider_key text not null default 'square'/);
assert.match(overlay, /api_version text not null default '2026-08-19'/);
assert.match(overlay, /provider_origin text not null default 'https:\/\/connect\.squareup\.com'/);

for (const gate of [
  "runtime_enabled",
  "provider_calls_enabled",
  "customer_onboarding_enabled",
  "webhook_intake_enabled",
  "evidence_enabled",
  "economic_contributions_enabled",
  "ai_dispatch_enabled"
]) {
  assert.match(
    overlay,
    new RegExp(`${gate} boolean not null default false check\\(not ${gate}\\)`),
    `${gate} is structurally closed`
  );
}

assert.doesNotMatch(overlay, /create role\b/i);
assert.doesNotMatch(overlay, /\blogin\b(?! names)/i);
assert.doesNotMatch(
  overlay,
  /insert into private\.integration_production_provider_(?:bindings|secrets|capabilities)/i,
  "Production provider resources and secret references remain empty"
);
assert.doesNotMatch(overlay, /(?:secret|token|credential)_(?:value|plaintext|ciphertext)|raw_payload/i);
assert.match(overlay, /application_secret_purpose text not null/);
assert.match(overlay, /webhook_signature_secret_purpose text not null/);
assert.match(overlay, /database_secret_purposes text\[\] not null/);

for (const table of [
  "square_production_configuration_generations",
  "square_production_runtime_bindings",
  "square_production_generation_fences",
  "square_production_lifecycle_audit_events"
]) {
  assert.match(overlay, new RegExp(`alter table private\\.${table} force row level security`));
}
assert.match(overlay, /square_production_history_immutable/);
assert.match(overlay, /before truncate on private\.square_production_/);
assert.match(overlay, /square_production_generation_stale/);
assert.match(overlay, /square_production_generation_fenced/);
assert.match(overlay, /square_production_runtime_disabled/);
assert.match(overlay, /check_square_production_operational_generation_v1/);
assert.doesNotMatch(overlay,
  /check_square_production_operational_generation_v1[\s\S]*economic_contributions_enabled[\s\S]*raise exception 'square_production_runtime_disabled'/,
  "operational generation authority is not coupled to economics or AI"
);
assert.match(overlay, /square_production_binding_secret_references_incomplete/);
assert.match(overlay, /square_production_binding_capabilities_incomplete/);
assert.match(overlay, /create function private\.square_production_configuration_fingerprint_v1\(/);
assert.match(overlay, /language sql\s+immutable\s+strict\s+parallel safe\s+security invoker/);
const configurationTable = /create table private\.square_production_configuration_generations \([\s\S]*?\n\);/.exec(overlay)?.[0];
assert.ok(configurationTable, "typed configuration table is present");
assert.match(configurationTable, /private\.square_production_configuration_fingerprint_v1\(/);
const generatedConfigurationFingerprint = /configuration_fingerprint text generated always as \([\s\S]*?\n  \) stored,/.exec(configurationTable)?.[0];
assert.ok(generatedConfigurationFingerprint, "configuration generated expression is present");
assert.doesNotMatch(generatedConfigurationFingerprint, /array_to_string|::text/,
  "generated configuration fingerprint delegates all normalization to its immutable typed helper");
for (const [capability, serviceAccount, databaseLogin, secretPurpose] of [
  ["broker", "square-broker@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_broker", "database_broker"],
  ["evidence", "square-evidence@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_evidence", "database_evidence"],
  ["oauth", "square-oauth@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_oauth", "database_oauth"],
  ["runtime", "square-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_runtime", "database_runtime"],
  ["scheduler", "square-scheduler@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_scheduler", "database_scheduler"],
  ["task_invoker", "square-task-invoker@vaeroex-integrations-prod.iam.gserviceaccount.com", "null", "null"],
  ["webhook", "square-webhook@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_webhook", "database_webhook"]
]) {
  assert.ok(
    overlay.includes(`('${capability}','${serviceAccount}',${databaseLogin === "null" ? "null" : `'${databaseLogin}'`},${secretPurpose === "null" ? "null" : `'${secretPurpose}'`})`),
    `${capability} capability is pinned to its exact service account, database login and secret purpose`
  );
}
assert.match(overlay, /create table private\.square_production_lifecycle_audit_events/);
const auditTable = /create table private\.square_production_lifecycle_audit_events \([\s\S]*?\n\);/.exec(overlay)?.[0];
assert.ok(auditTable, "sanitized lifecycle audit table is present");
assert.doesNotMatch(auditTable, /\bjsonb?\b/i, "sanitized audit stores no open-ended payload");
assert.doesNotMatch(auditTable, /payload|token|secret|credential|merchant|workspace|actor/i,
  "sanitized audit stores no secret, provider-account, tenant, or actor fields");
assert.match(overlay, /pg_catalog\.pg_inherits/);
assert.match(overlay, /pg_catalog\.pg_rewrite/);
assert.match(overlay, /pg_catalog\.pg_publication_namespace/);
assert.match(overlay, /pg_catalog\.aclexplode\(attribute\.attacl\)/);
assert.doesNotMatch(overlay, /create policy|grant (?:select|insert|update|delete|all)/i);
for (const capability of ["oauth","broker","scheduler","webhook","runtime","evidence"]) {
  const functionName = `check_square_production_${capability}_authority_v1`;
  assert.match(overlay, new RegExp(`create function public\\.${functionName}\\(`));
  assert.match(overlay, new RegExp(
    `grant execute on function public\\.${functionName}\\(text,text,text,bigint,text\\)\\s+to square_production_${capability}_authority`
  ));
  assert.match(overlay, new RegExp(
    `pg_has_role\\(session_user,'square_production_${capability}_authority','MEMBER'\\)`
  ));
}
assert.match(legacyGuard, /dependency\.classid='pg_proc'::regclass/,
  "later legacy guard recognizes only reviewed function ACL dependencies");
assert.match(legacyGuard, /relkind <> 'r'[\s\S]*relpersistence <> 'p'[\s\S]*relowner <> marker_owner/,
  "later legacy guard continues requiring permanent provider-neutral relations");
for (const capability of ["oauth","broker","scheduler","webhook","runtime","evidence"]) {
  assert.match(legacyGuard, new RegExp(
    `when 'square_production_${capability}_authority' then pg_catalog\\.to_regprocedure\\('public\\.check_square_production_${capability}_authority_v1\\(text,text,text,bigint,text\\)'\\)`
  ), `${capability} authority maps only to its distinct preflight RPC dependency`);
}
assert.match(legacyGuard, /expected_rpc is null[\s\S]*aclexplode\(rpc\.proacl\)[\s\S]*rpc_acl\.grantee<>rpc\.proowner[\s\S]*rpc_acl\.grantee=role_record\.oid[\s\S]*not rpc_acl\.is_grantable/,
  "later legacy guard requires the exact non-grantable sole non-owner RPC ACL");

assert.equal(
  packageJson.scripts["test:external-integrations-square-production-overlay"],
  "node scripts/external-integrations-square-production-overlay-regression-tests.js"
);
assert.match(ci, /run: node scripts\/run-square-production-overlay-qualification\.js/);
assert.match(runner, /const baseVersion = "20260902191323"/);
assert.match(runner, /const overlayVersion = "20260902191324"/);
assert.match(runner, /filter\(\(name\) => \/\^\\d\+_\.\+\\\.sql\$\/\.test\(name\)\)/,
  "qualification includes legacy variable-width migration versions");
assert.match(runner, /baselineVersions\.length, 102/);
assert.match(runner, /sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f/);
assert.match(runner, /"db", "reset", "--local", "--no-seed", "--version", baseVersion/);
assert.match(runner, /"db", "reset", "--local", "--no-seed", "--version", overlayVersion/);
assert.match(runner, /snapshotQboCatalog/);
assert.match(runner, /deepEqual\(afterQbo, beforeQbo/);
assert.match(runner, /qualifySubstitutedLedger/);
assert.match(runner, /set version='20260826089999'[\s\S]*where version='20260826090000'/);

console.log("Square Production runtime overlay regression tests passed");
