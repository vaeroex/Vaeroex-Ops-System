const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260902191325_square_production_internal_pilot_runtime.sql"
);
const overlayPath = path.join(
  root,
  "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");
const overlay = fs.readFileSync(overlayPath, "utf8");
const legacyGuard = fs.readFileSync(path.join(root,
  "supabase/migrations/20260915040500_integration_production_legacy_foundation_guard.sql"
), "utf8");
const qualificationRunner = fs.readFileSync(path.join(
  root, "scripts/run-square-production-internal-pilot-runtime-qualification.js"
), "utf8");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

assert.equal(
  sha256(overlay),
  "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f",
  "the reviewed Production overlay stays byte-identical"
);
assert.match(qualificationRunner,
  /\["127\.0\.0\.1", "localhost"\]\.includes\(parsed\.hostname\)[\s\S]*parsed\.username = "supabase_admin"/,
  "session-authorization fixture elevation is restricted to the disposable local Supabase administrator");
assert.match(qualificationRunner,
  /administrator_superuser: true, postgres_superuser: false[\s\S]*alter role postgres superuser[\s\S]*alter role postgres nosuperuser/,
  "the fixture proves the expected initial roles and restores postgres NOSUPERUSER");
assert.match(qualificationRunner,
  /try \{[\s\S]*dropRuntimeLogins\(client\)[\s\S]*restoreLocalSessionAuthorization\(\)[\s\S]*client\.end\(\)/,
  "runtime LOGIN cleanup, privilege restoration, and client closure remain nested fail-safe cleanup steps");
assert.match(migration, /requires_exact_103_version_baseline/);
assert.match(migration, /sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146/);
assert.doesNotMatch(migration, /(?:create table|insert into) private\.square_account_(?:configuration|connections|oauth_states|credentials|sync_tasks)/i,
  "the Production runtime does not import the Sandbox lifecycle");
assert.doesNotMatch(migration, /update\s+private\.square_production_configuration_generations/i,
  "the runtime cannot open a reviewed configuration generation");
assert.doesNotMatch(migration, /update\s+private\.integration_production_(platform_bindings|provider_bindings)/i,
  "the runtime cannot open provider-neutral activation gates");
assert.doesNotMatch(migration, /create\s+role|alter\s+role/i,
  "the database runtime migration does not create or activate LOGINs");
assert.doesNotMatch(migration, /integration_(sync_tasks|webhook_events|economic_facts)|quickbooks/i,
  "the one-page pilot has no shared scheduler, webhook, economics, AI, or QBO path");

const tables = [...migration.matchAll(/create table private\.(square_production_internal_[a-z_]+)\s*\(/g)]
  .map(match => match[1]);
assert.deepEqual(tables, [
  "square_production_internal_permits",
  "square_production_internal_oauth_states",
  "square_production_internal_credentials",
  "square_production_internal_scans",
  "square_production_internal_page_receipts",
  "square_production_internal_source_versions",
  "square_production_internal_fences",
  "square_production_internal_audit_events"
]);
for (const table of tables) {
  assert.match(migration, new RegExp(`alter table private\\.%I force row level security`),
    `${table} participates in the fixed FORCE-RLS loop`);
}
assert.match(migration, /relation\.relpersistence<>'p'/);
assert.match(migration, /relation\.relowner<>'postgres'::regrole::oid/);
assert.match(migration, /relation\.relforcerowsecurity/);
assert.match(migration, /pg_catalog\.pg_policy/);
assert.match(migration, /pg_catalog\.pg_inherits/);
assert.match(migration, /pg_catalog\.pg_publication_rel/);
const relationDigest = /select pg_catalog\.encode\(extensions\.digest\(pg_catalog\.convert_to\(\(pg_catalog\.jsonb_build_object\([\s\S]*?\)\)::text,'UTF8'\),'sha256'\),'hex'\) into strict schema_digest;/g;
const installedDigest = [...migration.matchAll(relationDigest)].at(-1)?.[0];
const retainedDigest = [...legacyGuard.matchAll(relationDigest)].at(-1)?.[0];
assert.ok(installedDigest && retainedDigest, "installation and later guard both hash the full relation catalog");
assert.equal(installedDigest.replace(/\s+/g, " "), retainedDigest.replace(/\s+/g, " "),
  "the later guard recomputes the exact installation-time relation contract");
const sourcePinnedDigest = "4258cd7206afd93115f8fdc8a7bf1244b684229c82f71d6e448bb19449e547bb";
assert.match(migration, new RegExp(`schema_digest is distinct from '${sourcePinnedDigest}'`));
assert.match(legacyGuard, new RegExp(`schema_digest is distinct from '${sourcePinnedDigest}'`));
assert.doesNotMatch(legacyGuard, /obj_description\('private\.square_production_internal_permits'/);
for (const protection of [
  "relowner=marker_owner", "relrowsecurity", "relforcerowsecurity", "pg_catalog.pg_policy",
  "pg_catalog.pg_inherits", "pg_catalog.pg_rewrite", "aclexplode(relation.relacl)", "aclexplode(attribute.attacl)",
  "pg_catalog.pg_publication_rel", "pg_catalog.pg_get_constraintdef",
  "pg_catalog.pg_get_indexdef", "pg_catalog.pg_get_triggerdef", "trigger_record.tgenabled",
  "attribute.attcollation", "collation_record.collprovider", "collation_record.collisdeterministic",
  "collation_record.collversion", "'internalTriggers'", "trigger_record.tgisinternal"
]) assert.ok(legacyGuard.includes(protection), `retained relations reject ${protection} drift`);
assert.match(qualificationRunner, /verifyInternalRelationGuard[\s\S]*no force row level security[\s\S]*grant select[\s\S]*create policy[\s\S]*disable trigger[\s\S]*drop constraint/,
  "disposable PostgreSQL exercises every protected relation against the guard");
assert.match(qualificationRunner, /forged mutable comment cannot replace the source-pinned relation contract/);
assert.match(qualificationRunner, /protected text-column collation/);
assert.match(qualificationRunner, /internal foreign-key trigger state/);

const publicFunctions = [...migration.matchAll(
  /create function public\.(square_production_internal_[a-z]+_v1)\(p_operation text,p_payload jsonb\)/g
)].map(match => match[1]).sort();
assert.deepEqual(publicFunctions, [
  "square_production_internal_broker_v1",
  "square_production_internal_evidence_v1",
  "square_production_internal_oauth_v1",
  "square_production_internal_runtime_v1"
]);
for (const [capability, operations] of Object.entries({
  oauth: ["create_state", "consume_state", "deny_state", "reconcile_state", "confirm_mapping", "cleanup"],
  broker: ["acquire_exchange", "reconcile_acquire", "commit_credential", "reconcile_exchange", "read_credential"],
  runtime: ["create_scan", "acquire_page", "commit_page", "release_page"],
  evidence: ["read"]
})) {
  assert.match(migration, new RegExp(
    `grant execute on function public\\.square_production_internal_${capability}_v1\\(text,jsonb\\) to square_production_${capability}_authority`
  ));
  for (const operation of operations) assert.match(migration, new RegExp(`p_operation='${operation}'|p_operation<>'${operation}'`));
}
for (const capability of ["oauth", "broker", "runtime", "evidence"]) {
  assert.match(migration, new RegExp(
    `revoke execute on function public\\.check_square_production_${capability}_authority_v1\\(text,text,text,bigint,text\\)\\s+from square_production_${capability}_authority`
  ), `${capability} replaces its staged authority check with one operational RPC`);
}
for (const capability of ["scheduler", "webhook"]) {
  assert.doesNotMatch(migration, new RegExp(
    `revoke execute on function public\\.check_square_production_${capability}_authority_v1`
  ), `${capability} retains its one staged authority-check RPC`);
}
assert.doesNotMatch(migration,
  /grant execute on function public\.square_production_internal_.* to square_production_(scheduler|webhook)_authority/,
  "dormant scheduler and webhook authorities receive no runtime RPC");
assert.match(migration, /each capability authority retains one exact non-grantable RPC|square_production_internal_rpc_acl_not_exact/,
  "the migration postflight closes the complete one-RPC-per-capability mapping");
assert.equal((migration.match(/security definer/g) || []).length >= 9, true);
assert.match(migration, /set search_path=''/);
assert.match(migration, /session_user::text<>login_name/);
assert.match(migration, /pg_catalog\.pg_has_role\(session_user,authority_name,'MEMBER'\)/);
assert.match(migration, /capability\.database_login::text=login_name/);
assert.match(migration, /capability\.database_secret_purpose='database_'\|\|p_capability/);
assert.match(migration, /'sq-prod-'\|\|p_capability\|\|'@vaeroex-integrations-prod\.iam\.gserviceaccount\.com'/);
assert.match(migration,
  /integration_production_provider_bindings provider_binding[\s\S]{0,500}for update;[\s\S]{0,900}square_production_runtime_bindings binding[\s\S]{0,300}for update;[\s\S]{0,700}square_production_configuration_generations configuration[\s\S]{0,350}for update;/,
  "runtime authorization locks the shared provider parent, exact binding, and configuration generation");
const permitLockHelper = migration.slice(
  migration.indexOf("create function private.square_production_internal_lock_permit_v1"),
  migration.indexOf("create function private.square_production_internal_install_permit_v1")
);
for (const lockedAuthority of ["auth.sessions session_record", "workspace_members member", "business_entities entity"]) {
  const lockStart = permitLockHelper.indexOf(lockedAuthority);
  assert.ok(lockStart >= 0 && permitLockHelper.indexOf("for update;", lockStart) > lockStart,
    `${lockedAuthority} is locked by the permit helper`);
}
assert.ok(permitLockHelper.indexOf("auth.sessions session_record")
  < permitLockHelper.indexOf("workspace_members member"));
assert.ok(permitLockHelper.indexOf("workspace_members member")
  < permitLockHelper.indexOf("business_entities entity"));
assert.ok(permitLockHelper.indexOf("business_entities entity")
  < permitLockHelper.indexOf("authorization_now:=clock_timestamp()"),
"operator authority locks precede wall-time evaluation");
assert.doesNotMatch(permitLockHelper, /statement_timestamp\(\)/,
"the shared permit boundary never uses a statement-start timestamp after a lock wait");
assert.match(permitLockHelper,
  /session_not_after is null or session_not_after<=authorization_now/,
  "runtime authorization rejects sessions without a finite expiration");
const permitInstaller = migration.slice(
  migration.indexOf("create function private.square_production_internal_install_permit_v1"),
  migration.indexOf("create function public.square_production_internal_oauth_v1")
);
assert.match(permitInstaller,
  /session_not_after is null or session_not_after<=installed_at/,
  "permit installation rejects sessions without a finite expiration");
for (const category of [
  "mapped_rpc_acl_cardinality", "unexpected_rpc_acl", "private_schema_usage",
  "non_system_schema_create", "unexpected_non_system_routine_execute",
  "unexpected_non_system_relation_privilege", "unexpected_non_system_column_privilege",
  "unexpected_non_system_sequence_privilege", "direct_database_acl",
  "public_or_direct_default_acl"
]) assert.ok(migration.includes(category), `authority preflight repeats overlay closure check ${category}`);
assert.match(qualificationRunner,
  /verifyPermitAuthoritySerialization[\s\S]*generation_fence[\s\S]*55P03[\s\S]*authority revoked during its lock wait[\s\S]*wall time after the lock wait/,
  "the disposable PostgreSQL qualification exercises generation, authority-row, and post-wait expiry fencing");
assert.match(qualificationRunner,
  /verifyNullSessionInstallation[\s\S]*not_after=null[\s\S]*null-expiration installation creates no permit/,
  "the disposable PostgreSQL qualification proves null-expiration installation fails closed");
assert.match(qualificationRunner,
  /verifyNullSessionRuntime[\s\S]*not_after=null[\s\S]*square_production_internal_operator_denied/,
  "the disposable PostgreSQL qualification proves null-expiration runtime access fails closed");
assert.match(qualificationRunner,
  /workspace_members set status='disabled'[\s\S]*authority revoked during its lock wait/,
  "the authority serialization fixture uses the schema-valid disabled membership state");

for (const token of [
  "state_hash", "state_already_consumed", "exchange_effect_latched", "exchange_outcome_uncertain",
  "credential_receipt_reconciled", "single_page_lease", "single_page_committed",
  "page_receipt_reconciled", "operator_cleanup", "square_production_internal_generation_stale"
]) assert.ok(migration.includes(token), `runtime pins ${token}`);
assert.match(migration, /state_hash text not null unique check\(state_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/,
  "opaque OAuth state hashes are raw lowercase SHA-256 hex");
assert.match(migration, /consume_request_fingerprint text check\(consume_request_fingerprint is null or consume_request_fingerprint ~ '\^sha256:/,
  "callback request fingerprints use the prefixed runtime fingerprint domain");
assert.match(migration,
  /p_operation='consume_state'[\s\S]{0,300}'consumeRequestFingerprint','stateHash'[\s\S]{0,800}'consume-state-v2',state_digest/,
  "consume request idempotency uses only the stable callback-known state hash");
assert.doesNotMatch(migration, /consumedAtMs|consumed_at_ms|consume_at/,
  "consume timing is database-owned rather than supplied by the caller");
assert.match(migration, /'consumeRequestFingerprint','stateHash'[\s\S]{0,500}where state_record\.state_hash=state_digest/,
  "lost-response reconciliation locates state by hash without requiring stateId");
assert.doesNotMatch(migration, /elsif p_operation='reconcile_state'[\s\S]{0,300}'stateId'/,
  "reconciliation never requires a stateId unavailable after a lost consume response");
assert.match(migration,
  /elsif p_operation='reconcile_acquire'[\s\S]{0,250}'exchangeRequestFingerprint','stateId'/,
  "lost acquire responses reconcile from the two values known before the call");
assert.match(migration,
  /state_row\.exchange_request_fingerprint is distinct from request_hash[\s\S]{0,300}state_row\.exchange_id is null[\s\S]{0,300}state_row\.exchange_receipt_fingerprint is null/,
  "acquire reconciliation requires the exact durable exchange effect");
assert.match(migration,
  /p_operation='reconcile_exchange'[\s\S]{0,250}'exchangeId','exchangeReceiptFingerprint','exchangeRequestFingerprint','stateId'/,
  "post-provider reconciliation requires both DB-generated exchange receipt values");
assert.match(migration,
  /'generation',permit_row\.generation,[\s\S]{0,180}'configurationFingerprint',permit_row\.configuration_fingerprint,[\s\S]{0,180}'consumeReceiptFingerprint',state_row\.consume_receipt_fingerprint/,
  "broker receipts retain the exact permit generation, configuration, and consume binding");
const credentialCommitBranch = migration.slice(
  migration.indexOf("elsif p_operation='commit_credential' then"),
  migration.indexOf("elsif p_operation='reconcile_exchange' then")
);
assert.ok(credentialCommitBranch.indexOf("credential_uuid:=(p_payload->>'credentialId')::uuid")
  < credentialCommitBranch.indexOf("if state_row.status='stored'"),
"credential replay parses and authenticates the complete semantic payload before returning a receipt");
for (const token of [
  "ciphertext!~'^[A-Za-z0-9+/]+={0,2}$'", "aad_hash is distinct from",
  "external_hash is distinct from", "scopes is distinct from", "expires_at<=issued_at"
]) assert.ok(credentialCommitBranch.includes(token), `credential replay revalidates ${token}`);
assert.match(migration,
  /elsif p_operation='reconcile_exchange'[\s\S]{0,1200}state_row\.status<>'uncertain'[\s\S]{0,700}'exchange_uncertain','blocked'[\s\S]{0,100}'exchange_outcome_uncertain'/,
  "first uncertain reconciliation emits the same sanitized audit as duplicate acquire");
const credentialReadBranch = migration.slice(
  migration.indexOf("elsif p_operation='read_credential' then"),
  migration.indexOf("create function private.square_production_internal_guard_lifecycle_update_v1")
);
assert.ok(credentialReadBranch.indexOf("select scan.* into scan_row")
  < credentialReadBranch.indexOf("square_production_internal_lock_permit_v1(scan_row.permit_id,'broker')"),
"credential reads use the shared scan-then-permit lock order");
const pageCommitBranch = migration.slice(
  migration.indexOf("elsif p_operation='commit_page' then"),
  migration.indexOf("elsif p_operation='release_page' then")
);
assert.ok(pageCommitBranch.indexOf("square_production_internal_require_keys_v1(observation")
  < pageCommitBranch.indexOf("if exists("),
"page replay validates every observation before receipt lookup");
assert.ok(pageCommitBranch.indexOf("'page-result-v2'") < pageCommitBranch.indexOf("if exists("),
  "page replay recomputes the canonical full-observation result before receipt lookup");
assert.match(pageCommitBranch,
  /receipt\.result_fingerprint=result_hash[\s\S]{0,160}receipt\.observation_count=pg_catalog\.jsonb_array_length/,
  "page replay matches the immutable result fingerprint and count");
assert.doesNotMatch(migration,
  /'commandFingerprint',command_hash,'replayed'/,
  "credential commit receipts use one exact semantic credential fingerprint field");
assert.match(migration,
  /elsif p_operation='deny_state' then[\s\S]{0,1800}state_row\.status<>'pending'[\s\S]{0,300}state_row\.expires_at<=now_at or permit_row\.state<>'consent_pending'/,
  "state denial mutates only an unexpired pending state on the current consent-pending permit");
for (const lifecycleField of [
  "consume_request_fingerprint", "consume_receipt_fingerprint",
  "deny_request_fingerprint", "denial_receipt_fingerprint",
  "exchange_id", "exchange_request_fingerprint", "exchange_receipt_fingerprint",
  "credential_command_fingerprint"
]) assert.match(migration, new RegExp(`'${lifecycleField}'`),
  `the OAuth identity guard permits only the reviewed ${lifecycleField} lifecycle mutation`);
assert.match(migration,
  /tg_table_name='square_production_internal_oauth_states'[\s\S]{0,900}'deny_request_fingerprint','denial_receipt_fingerprint'[\s\S]{0,200}'exchange_id','exchange_request_fingerprint','exchange_receipt_fingerprint'/,
  "the immutable-identity trigger permits the exact denial and exchange lifecycle columns");
assert.match(migration, /'actorId','businessEntityId','permitId','requestFingerprint','sessionId','workspaceId'/,
  "sanitized evidence remains bound to the exact operator session and tenant tuple");
assert.match(migration, /p_payload->>'workspaceId'\)::uuid<>permit_row\.workspace_id/);
assert.match(migration, /request_method text not null default 'GET' check\(request_method='GET'\)/);
assert.match(migration, /stream text not null default 'payments' check\(stream='payments'\)/);
assert.match(migration, /operation text not null default 'list_payments' check\(operation='list_payments'\)/);
assert.match(migration, /payment_window_end-payment_window_start<=interval '24 hours'/);
assert.match(migration, /pg_catalog\.jsonb_array_length\(p_payload->'observations'\)>100/);
assert.match(migration, /'continuationAllowed',false/);
const acquireBranch = migration.slice(migration.indexOf("elsif p_operation='acquire_page' then"),
  migration.indexOf("elsif p_operation='commit_page' then"));
for (const field of ["workspaceId", "businessEntityId", "actorId", "sessionId",
  "permitId", "generation", "scanRequestFingerprint", "requestFingerprint", "leaseId"]) {
  assert.ok(acquireBranch.includes(field), `page acquisition binds ${field}`);
}
assert.ok(acquireBranch.indexOf("square_production_internal_page_acquire_denied")
  < acquireBranch.indexOf("if scan_row.status='committed'"),
"tenant/request authority is checked before committed replay returns data");
assert.match(acquireBranch, /request_hash is distinct from scan_row\.acquire_request_fingerprint/);
assert.match(acquireBranch, /request_hash=scan_row\.acquire_request_fingerprint/);
assert.match(qualificationRunner, /leased replay rejects a changed request or tenant authority binding/);
assert.match(qualificationRunner, /committed replay cannot reveal another workspace scan or permit/);
assert.match(migration, /p_payload->>'continuation'\)::boolean/);
assert.doesNotMatch(migration, /\b(?:amount|currency|card|customer|email|phone)\b/i,
  "minimized payment evidence stores no economic, card, or customer attributes");
assert.match(migration, /ciphertext_base64/);
assert.match(migration, /aad_digest/);
assert.match(migration, /kms_key_resource/);
assert.doesNotMatch(migration, /access_token|refresh_token|client_secret|authorization_code/i,
  "the database contract never names or stores provider plaintext secrets");
assert.match(migration, /runtimeEnabled',false/);
assert.match(migration, /providerCallsEnabled',false/);
assert.match(migration, /customerOnboardingEnabled',false/);
assert.match(migration, /webhookIntakeEnabled',false/);
assert.match(migration, /economicContributionsEnabled',false/);
assert.match(migration, /aiDispatchEnabled',false/);
assert.match(migration, /if 11<>\(/);
assert.match(migration, /commit;\s*$/);

console.log(`square_production_internal_runtime_static_ok sha256:${sha256(migration)}`);
