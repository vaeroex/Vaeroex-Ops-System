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
const pgTap = fs.readFileSync(
  path.join(root, "supabase/tests/square_production_runtime_overlay.test.sql"),
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
const activationTerraform = fs.readFileSync(path.join(root,
  "services/external-integrations-production/infra/activation/main.tf"), "utf8");
for (const [capability, serviceAccount, databaseLogin, secretPurpose] of [
  ["broker", "sq-prod-broker@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_broker", "database_broker"],
  ["evidence", "sq-prod-evidence@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_evidence", "database_evidence"],
  ["oauth", "sq-prod-oauth@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_oauth", "database_oauth"],
  ["runtime", "sq-prod-runtime@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_runtime", "database_runtime"],
  ["scheduler", "sq-prod-scheduler@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_scheduler", "database_scheduler"],
  ["task_invoker", "sq-prod-task-invoker@vaeroex-integrations-prod.iam.gserviceaccount.com", "null", "null"],
  ["webhook", "sq-prod-webhook@vaeroex-integrations-prod.iam.gserviceaccount.com", "square_production_webhook", "database_webhook"]
]) {
  assert.match(activationTerraform, new RegExp(`\\b${capability}\\s*=\\s*"${serviceAccount.split("@")[0]}"`),
    `${capability} overlay identity must match the reviewed deployed Terraform account ID`);
  assert.ok(
    overlay.includes(`('${capability}','${serviceAccount}',${databaseLogin === "null" ? "null" : `'${databaseLogin}'`},${secretPurpose === "null" ? "null" : `'${secretPurpose}'`})`),
    `${capability} capability is pinned to its exact service account, database login and secret purpose`
  );
}
const failureCategories = ["rpc_definition", "mapped_rpc_acl_cardinality", "unexpected_rpc_acl",
  "mapped_rpc_execute_missing", "private_schema_usage", "non_system_schema_create",
  "unexpected_non_system_routine_execute", "unexpected_non_system_relation_privilege",
  "unexpected_non_system_column_privilege", "unexpected_non_system_sequence_privilege",
  "per_database_role_setting", "foreign_data_wrapper_usage", "foreign_server_usage",
  "tablespace_create", "current_database_connect_missing", "current_database_temp_missing",
  "current_database_create", "direct_database_acl", "non_public_other_database_connect",
  "public_or_direct_default_acl"];
const finiteClosure = overlay.slice(overlay.indexOf("authority_failure_categories :="),
  overlay.indexOf("if authority_failure_categories<>''"));
assert.deepEqual([...finiteClosure.matchAll(/then '([a-z_]+)' end/g)].map(match => match[1]),
  failureCategories, "closure exposes exactly twenty fixed invariant labels, never catalog values");
assert.match(overlay, /detail='failed_checks='\|\|authority_failure_categories/);
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
assert.match(overlay,
  /revoke execute on function\s+public\.match_business_memory_chunks\(uuid,extensions\.vector,integer,double precision\),\s+public\.set_updated_at\(\)\s+from public;/,
  "overlay removes only the two inherited legacy PUBLIC execution paths"
);
assert.doesNotMatch(overlay,
  /revoke execute on function\s+public\.match_business_memory_chunks\([^;]+from authenticated;/,
  "authenticated business-memory matching access is preserved"
);
assert.match(overlay,
  /application_namespace\.nspname<>'pg_catalog'[\s\S]*has_schema_privilege\([\s\S]*grantee_name,[\s\S]*application_namespace\.oid,[\s\S]*'USAGE'[\s\S]*has_function_privilege\([\s\S]*grantee_name,[\s\S]*application_function\.oid,[\s\S]*'EXECUTE'/,
  "each Square authority is closed against every callable unrelated non-system routine"
);
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
assert.match(runner, /await resetLocalFixture\(baseVersion\)/);
assert.match(runner, /await resetLocalFixture\(overlayVersion\)/);
assert.match(runner, /snapshotQboCatalog/);
assert.match(runner, /deepEqual\(afterQbo, beforeQbo/);
assert.match(runner, /snapshotPreservedRoutineAcls/);
assert.match(runner, /function_record\.oid<>all\(array\[[\s\S]*match_business_memory_chunks[\s\S]*set_updated_at/,
  "qualification excludes only the two intentional legacy ACL changes from its preservation snapshot");
assert.match(runner, /preserves every unrelated explicit routine grant/,
  "qualification preserves QBO and every other explicit routine grant");
assert.match(runner, /qualifySubstitutedLedger/);
assert.match(runner, /set version='20260826089999'[\s\S]*where version='20260826090000'/);
assert.match(runner,
  /qualifyPerDatabaseRoleSetting[\s\S]*alter role square_production_oauth_authority in database %I set statement_timeout[\s\S]*square_production_overlay_authority_role_drift/,
  "qualification rejects database-scoped authority settings before creating overlay objects");
assert.match(overlay, /pg_db_role_setting[\s\S]*setrole=role_record\.oid/,
  "migration preflight rejects database-scoped authority settings");
assert.match(overlay, /pg_db_role_setting[\s\S]*setrole=grantee_name::regrole::oid/,
  "migration postflight rejects database-scoped authority settings");
assert.match(runner,
  /qualifySequencePrivilegeDrift[\s\S]*grant usage on sequence[\s\S]*square_production_overlay_authority_rpc_not_closed/,
  "qualification proves effective application-sequence authority fails the overlay closure");
assert.match(runner,
  /qualifyMaintainPrivilegeDrift[\s\S]*grant maintain on table[\s\S]*square_production_overlay_authority_rpc_not_closed/,
  "qualification proves effective application-table MAINTAIN authority fails the overlay closure");
assert.match(runner,
  /qualifyCustomPgRoutineDrift[\s\S]*allow_system_table_mods=on[\s\S]*pg_square_qualification[\s\S]*square_production_overlay_authority_rpc_not_closed/,
  "qualification proves a callable routine in a custom pg_* schema is not treated as a system routine");

const pgTapAssertionFunctions = [...pgTap.matchAll(
  /^select\s+(?:\*\s+from\s+)?([a-z_][a-z0-9_]*)\s*\(/gmi
)]
  .map((match) => match[1].toLowerCase())
  .filter((name, index, names) => names.indexOf(name) === index)
  .sort();
assert.deepEqual(
  pgTapAssertionFunctions,
  ["finish", "is", "no_plan", "ok"],
  "PG17 qualification uses only pgTAP assertion signatures proven by the repository test corpus"
);
assert.doesNotMatch(pgTap, /^select\s+(?:un)?like\s*\(/gmi,
  "regex assertions use portable ok(expression [not] like pattern, description) forms");
assert.match(pgTap,
  /application_routines\.oid<>expected\.rpc[\s\S]*has_schema_privilege\(expected\.role_name,application_routines\.namespace_oid,'usage'\)[\s\S]*has_function_privilege\(expected\.role_name,application_routines\.oid,'execute'\)\),0/,
  "PG17 qualification rejects every unrelated callable non-system routine grant"
);
assert.match(pgTap,
  /has_schema_privilege\(authority\.role_name,'private','usage'\)[\s\S]*cannot use the private schema/,
  "PG17 qualification rejects private-schema usage"
);
assert.match(pgTap,
  /application_schemas\.oid,'create'[\s\S]*cannot create objects in any non-system schema/,
  "PG17 qualification rejects CREATE on every non-system schema"
);
assert.match(pgTap,
  /match_business_memory_chunks\(uuid,extensions\.vector,integer,double precision\)'::regprocedure::oid,[\s\S]*'public\.set_updated_at\(\)'::regprocedure::oid[\s\S]*function_acl\.grantee=0/,
  "PG17 qualification checks the two legacy PUBLIC ACLs directly"
);
assert.match(pgTap,
  /create trigger square_production_updated_at_probe_trigger[\s\S]*execute function public\.set_updated_at\(\)[\s\S]*updated_at>'2026-01-01T00:00:00Z'/,
  "PG17 qualification proves trigger execution still works"
);
assert.match(pgTap,
  /has_table_privilege\([\s\S]*Square authorities inherit no table privilege beyond the exact unusable statistics metadata views/,
  "PG17 qualification checks effective table privileges across all application relations"
);
assert.match(pgTap,
  /has_column_privilege\([\s\S]*Square authorities inherit no column privilege beyond the exact unusable statistics metadata views/,
  "PG17 qualification checks effective column privileges across all application relations"
);
assert.match(pgTap,
  /has_sequence_privilege\([\s\S]*Square authorities inherit no sequence privilege on any non-system application sequence/,
  "PG17 qualification checks effective sequence privileges across all application sequences"
);
assert.match(pgTap,
  /\('MAINTAIN'\)[\s\S]*has_table_privilege/,
  "PG17 qualification includes the PostgreSQL 17 MAINTAIN table privilege"
);
assert.match(pgTap,
  /has_foreign_data_wrapper_privilege\([\s\S]*no effective foreign-data-wrapper usage/,
  "PG17 qualification checks every foreign-data wrapper"
);
assert.match(pgTap,
  /has_server_privilege\([\s\S]*no effective foreign-server usage/,
  "PG17 qualification checks every foreign server"
);
assert.match(pgTap,
  /has_tablespace_privilege\([\s\S]*cannot create objects in any tablespace/,
  "PG17 qualification checks tablespace CREATE"
);
assert.match(pgTap,
  /has_database_privilege\(authority\.role_name,current_database\(\),'connect'\)[\s\S]*current-database CONNECT and TEMP/,
  "PG17 qualification pins current-database CONNECT and TEMP without CREATE"
);
assert.match(pgTap,
  /database_record\.datallowconn[\s\S]*database_acl\.grantee=0[\s\S]*standard PUBLIC default/,
  "PG17 qualification rejects non-PUBLIC authority to other connectable databases"
);
assert.match(pgTap,
  /pg_default_acl[\s\S]*defaclobjtype in \('r','S','f','n'\)[\s\S]*future relations, sequences, routines or schemas/,
  "PG17 qualification rejects material PUBLIC or target default ACLs"
);
assert.doesNotMatch(overlay, /nspname not like 'pg\\_%'/,
  "application catalog scans do not exempt arbitrary pg_* extension schemas");
assert.match(overlay, /nspname not like 'pg\\_toast%' escape '\\'/,
  "application catalog scans exclude only the exact pg_toast prefix");
assert.match(overlay, /nspname not like 'pg\\_temp%' escape '\\'/,
  "application catalog scans exclude only the exact pg_temp prefix");
assert.match(overlay, /large-object[\s\S]*trusted-runtime\/resource[\s\S]*deployment monitoring/,
  "migration documents the inherent catalog large-object boundary without global revocation");
assert.match(overlay,
  /attribute\.attcollation=0[\s\S]*collation_namespace\.nspname,collation_record\.collname[\s\S]*collprovider::text[\s\S]*collisdeterministic[\s\S]*collversion/,
  "overlay schema attestation binds schema-qualified collation identity and runtime properties");
assert.match(overlay, /2739c85b607701a5635c636112a32122ea7d244dc569273d5c9ea3fd05300d26/,
  "overlay schema attestation pins the exact collation-aware PG17 digest");
assert.match(overlay,
  /function_record\.proargnames is distinct from expected\.argument_names[\s\S]*function_record\.proargmodes is not null/,
  "overlay function attestation pins every argument name and the exact all-IN mode contract");
for (const argumentName of [
  "p_generation", "p_parts", "p_provider_key", "p_environment", "p_project_id",
  "p_configuration_fingerprint", "p_capability", "p_ai_dispatch_enabled"
]) {
  assert.ok(overlay.includes(`'${argumentName}'`), `${argumentName} is pinned in the function ABI postflight`);
}
assert.match(pgTap, /pg_db_role_setting[\s\S]*database-scoped role settings/,
  "PG17 qualification proves database-scoped authority settings are absent");
for (const metadataView of ["pg_stat_statements", "pg_stat_statements_info"]) {
  assert.ok(overlay.includes(metadataView), `migration allowlists exact ${metadataView} metadata view`);
  assert.ok(pgTap.includes(metadataView), `PG17 qualification binds exact ${metadataView} metadata view`);
}
assert.match(overlay,
  /relation_privilege\.privilege_type='SELECT'[\s\S]*not pg_catalog\.has_schema_privilege\(grantee_name,'extensions','USAGE'\)[\s\S]*not pg_catalog\.pg_has_role\(grantee_name,'pg_read_all_stats','USAGE'\)[\s\S]*extension_record\.extname='pg_stat_statements'/,
  "relation exception is limited to SELECT on the pg_stat_statements extension-owned views");
assert.match(overlay,
  /column_privilege\.privilege_type='SELECT'[\s\S]*not pg_catalog\.has_schema_privilege\(grantee_name,'extensions','USAGE'\)[\s\S]*not pg_catalog\.pg_has_role\(grantee_name,'pg_read_all_stats','USAGE'\)[\s\S]*extension_record\.extname='pg_stat_statements'/,
  "column exception is limited to SELECT inherited from the pg_stat_statements extension-owned views");
assert.match(pgTap, /canonical pg_stat_statements metadata views carry the allowed PUBLIC SELECT ACL/,
  "PG17 qualification proves the exact platform metadata ACL allowlist");
assert.match(pgTap, /cannot use the extensions schema containing the canonical metadata views/,
  "PG17 qualification proves the allowlisted metadata views remain unusable by Square authorities");
assert.match(pgTap, /cannot read unredacted PostgreSQL statistics/,
  "PG17 qualification proves no Square authority has pg_read_all_stats");
const secretPurposeRejection = pgTap.indexOf("set database_secret_purpose='database_evidence'");
const foundationValidCapabilityDrift = pgTap.indexOf(
  "set service_account='sq-prod-broker-drift@vaeroex-integrations-prod.iam.gserviceaccount.com'"
);
const overlayCapabilityRejection = pgTap.indexOf(
  "'23514:square_production_binding_capabilities_incomplete'"
);
assert.ok(
  secretPurposeRejection >= 0 &&
    secretPurposeRejection < foundationValidCapabilityDrift &&
    foundationValidCapabilityDrift < overlayCapabilityRejection,
  "secret-purpose drift is asserted at the foundation before foundation-valid identity drift reaches the overlay"
);
const foundationValidCapabilityDriftStatement = /update private\.integration_production_provider_capabilities\s+set service_account='sq-prod-broker-drift[^;]+;/s.exec(pgTap)?.[0];
assert.ok(foundationValidCapabilityDriftStatement, "foundation-valid identity drift fixture is present");
assert.doesNotMatch(foundationValidCapabilityDriftStatement, /database_secret_purpose/,
  "overlay identity drift does not trip the provider-neutral secret-purpose constraint first");
assert.match(pgTap, /is_generated='NEVER' and is_nullable='YES'\),0/,
  "catalog nullability review distinguishes writable columns from generated expressions");
for (const generatedFingerprint of [
  "square_production_configuration_generations.configuration_fingerprint",
  "square_production_configuration_generations.provider_authority_fingerprint",
  "square_production_generation_fences.fence_fingerprint",
  "square_production_lifecycle_audit_events.event_fingerprint",
  "square_production_runtime_bindings.binding_fingerprint"
]) {
  assert.ok(pgTap.includes(generatedFingerprint),
    `${generatedFingerprint} is explicit in the generated-column nullability contract`);
}
assert.deepEqual(
  [...overlay.matchAll(/^create trigger ([a-z0-9_]+)$/gmi)].map((match) => match[1]),
  [
    "square_production_configuration_immutable",
    "square_production_configuration_truncate_immutable",
    "square_production_configuration_audit",
    "square_production_binding_authority",
    "square_production_binding_immutable",
    "square_production_binding_truncate_immutable",
    "square_production_binding_audit",
    "square_production_fence_immutable",
    "square_production_fence_truncate_immutable",
    "square_production_fence_audit",
    "square_production_audit_immutable",
    "square_production_audit_truncate_immutable"
  ],
  "runtime trigger count is backed by the exact immutable, authority and sanitized-audit manifest"
);

const localFixture = require("./prepare-production-shaped-local-database.js");
const fixtureSource = fs.readFileSync(path.join(root, "scripts/prepare-production-shaped-local-database.js"), "utf8");
const savedCi = process.env.CI, savedActions = process.env.GITHUB_ACTIONS;
try {
  process.env.CI = "true";
  process.env.GITHUB_ACTIONS = "true";
  const config = 'project_id = "square-production-fixture"';
  const context = [{ Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } }];
  const container = [{ Name: "/supabase_db_square-production-fixture", State: { Running: true },
    Config: { Image: "public.ecr.aws/supabase/postgres:17.6.1.156" },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostPort: "54322" }] } } }];
  const url = "postgresql://postgres:synthetic-only@127.0.0.1:54322/postgres";
  assert.equal(localFixture.validateLocalTarget(config, context, container, url).host, "127.0.0.1");
  for (const deniedUrl of [url.replace("127.0.0.1", "database.example.com"),
    url.replace("/postgres", "/other"), `${url}?host=database.example.com`, url.replace("54322", "54323")]) {
    assert.throws(() => localFixture.validateLocalTarget(config, context, container, deniedUrl));
  }
  assert.throws(() => localFixture.validateLocalTarget(config,
    [{ Endpoints: { docker: { Host: "tcp://remote.example:2376" } } }], container, url));
  assert.throws(() => localFixture.validateLocalTarget(config, context,
    [{ ...container[0], Name: "/unrelated" }], url));
  process.env.CI = "false";
  assert.throws(() => localFixture.validateLocalTarget(config, context, container, url), /ci_fixture_only/);
} finally {
  if (savedCi === undefined) delete process.env.CI; else process.env.CI = savedCi;
  if (savedActions === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = savedActions;
}
assert.match(localFixture.normalizeSql, /exists\(select 1 from net\.http_request_queue\).*exists\(select 1 from net\._http_response\)/s);
assert.match(localFixture.normalizeSql, /drop extension pg_net restrict/);
assert.doesNotMatch(localFixture.normalizeSql, /cascade|grant |revoke /i);
assert.match(fixtureSource, /localConnection\(\); \/\/ Verify the current local container before destructive reset/);
assert.match(fixtureSource, /name\.split\("_", 1\)\[0\] <= version/);
assert.doesNotMatch(fixtureSource, /name\.slice\(0, 14\)|\\d\{14\}_.\+/);
const fixtureVersions = fs.readdirSync(path.join(root, "supabase/migrations"))
  .filter(name => /^\d+_.+\.sql$/.test(name)).sort().map(name => name.split("_", 1)[0])
  .filter(version => version <= "20260902191323");
assert.equal(fixtureVersions.length, 102, "CI fixture retains every variable-width canonical migration");
assert.equal(require("node:crypto").createHash("sha256").update(
  fixtureVersions.map(version => `${version.length}:${version}`).join("")
).digest("hex"), "3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f");
assert.match(fixtureSource, /"migration", "up", "--local", "--workdir", directory/);
assert.match(fixtureSource, /SUPABASE_DB_MIGRATIONS_ENABLED: "true"/);

console.log("Square Production runtime overlay regression tests passed");
