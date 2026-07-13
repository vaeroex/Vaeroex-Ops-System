const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const {
  isExactWorkspaceStoragePath,
  permanentWorkspaceResetPhrase,
  workspaceResetRedirectTarget,
  workspaceResetRequestSchema,
  workspaceStoragePrefix
} = require("../lib/workspaces/reset-policy.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const workspaceName = "Reset Test Workspace";

assert.equal(workspaceStoragePrefix(workspaceId), `${workspaceId}/`);
assert.equal(isExactWorkspaceStoragePath(workspaceId, `${workspaceId}/file-id/report.pdf`), true);
assert.equal(isExactWorkspaceStoragePath(workspaceId, `other/${workspaceId}/report.pdf`), false);
assert.equal(isExactWorkspaceStoragePath(workspaceId, `${workspaceId}//report.pdf`), false);
assert.equal(isExactWorkspaceStoragePath(workspaceId, `${workspaceId}/../other-workspace/report.pdf`), false);
assert.equal(isExactWorkspaceStoragePath(workspaceId, `${workspaceId}/folder\\report.pdf`), false);
assert.equal(permanentWorkspaceResetPhrase(workspaceName), `PERMANENTLY RESET ${workspaceName}`);
assert.equal(workspaceResetRedirectTarget("guided", operationId), `/app/setup?reset_operation=${operationId}`);

const baseRequest = {
  workspaceId,
  workspaceName,
  confirmationName: workspaceName,
  storageMode: "recoverable",
  setupMode: "blank",
  operationId,
  currentPassword: "staging-password"
};
assert.equal(workspaceResetRequestSchema.safeParse(baseRequest).success, true, "recoverable reset should validate without the permanent phrase");
assert.equal(
  workspaceResetRequestSchema.safeParse({ ...baseRequest, storageMode: "permanent" }).success,
  false,
  "permanent reset must require the exact irreversible phrase"
);
assert.equal(
  workspaceResetRequestSchema.safeParse({
    ...baseRequest,
    storageMode: "permanent",
    permanentPhrase: permanentWorkspaceResetPhrase(workspaceName)
  }).success,
  true
);
assert.equal(workspaceResetRequestSchema.safeParse({ ...baseRequest, confirmationName: "Wrong workspace" }).success, false);

const migration = read("supabase/migrations/202607120001_workspace_data_reset.sql");
const storage = read("lib/workspaces/reset-storage.ts");
const resetGuard = read("lib/workspaces/reset-guard.ts");
const fileActions = read("app/app/files/actions.ts");
const cron = read("app/api/cron/workspace-reset-purge/route.ts");

for (const table of ["workspace_reset_operations", "workspace_reset_record_backups", "workspace_reset_storage_objects"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} must be purpose-built`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} must have RLS`);
}

assert.match(migration, /security definer/g, "privileged reset RPCs must declare their execution model");
assert.match(migration, /set search_path = public, pg_temp/g, "reset RPCs must use an explicit safe search_path");
assert.match(migration, /auth\.uid\(\)/, "reset RPCs must verify the authenticated user");
assert.match(migration, /wm\.role in \('owner', 'admin'\)/, "reset RPCs must require owner/admin membership");
assert.match(migration, /pg_try_advisory_xact_lock\(hashtextextended\(p_workspace_id::text, 0\)\)/, "reset must use a workspace advisory transaction lock");
assert.match(migration, /Workspace name confirmation does not match/, "the database must verify the exact workspace name");
assert.match(migration, /PERMANENTLY RESET/, "the database must verify the permanent phrase");
assert.match(migration, /workspace_reset_has_recent_auth/, "the database must require a recent JWT issue time");
assert.match(migration, /status in \('manifesting', 'in_progress', 'recoverable', 'database_reset', 'purging', 'partial', 'restoring'\)/, "active recovery and partial purge states must block overlapping resets");
assert.match(migration, /updated_at < now\(\) - interval '30 minutes'/, "stale pre-database manifest operations must be safely reclaimable");
assert.match(migration, /op\.status = 'failed'[\s\S]+op\.reset_completed_at is null/, "only failed pre-database manifests may be automatically minimized");
assert.match(migration, /Database reset and storage manifest must complete before finalization/, "an unexecuted reset must never be finalized");
assert.match(migration, /Workspace contains business content created after reset/, "restore must not merge an old snapshot into newer workspace content");
assert.match(migration, /status = 'restored'[\s\S]+workspace_context_before = '\{\}'::jsonb/, "restoration must remove recovery-only workspace context after it is used");
assert.match(migration, /if v_status = 'completed' then[\s\S]+delete from public\.workspace_reset_record_backups[\s\S]+delete from public\.workspace_reset_storage_objects/, "permanent finalization must atomically minimize recovery rows and exact object paths");
assert.match(migration, /information_schema\.columns[\s\S]+Workspace reset inventory requires review for table/, "unknown future workspace tables must fail closed");
assert.match(migration, /enforce_workspace_reset_mutation_guard/, "business mutations must be blocked while reset manifesting or restoration is active");
assert.match(migration, /current_setting\('vaeroex\.workspace_reset_operation'/, "the controlled reset transaction must identify itself to the mutation guard");
assert.match(migration, /revoke all on public\.workspace_reset_operations from public, anon, authenticated/, "reset ledgers must not inherit broad table grants");
assert.match(migration, /revoke all on function public\.reset_workspace_data[\s\S]+from public, anon/, "PUBLIC and anonymous RPC execution must be revoked");
assert.match(migration, /grant execute on function public\.reset_workspace_data[\s\S]+to authenticated/, "only authenticated callers may reach the guarded RPC");
assert.doesNotMatch(migration, /delete from storage\.objects|update storage\.objects|insert into storage\.objects/i, "SQL must never mutate storage.objects");
assert.match(migration, /workspace_reset_allows_storage_write/, "Storage RLS must block direct-client manifest races");
assert.match(
  migration,
  /workspace_reset_allows_storage_write\(\s*p_workspace_id uuid,\s*p_object_path text\s*\)/,
  "Storage write eligibility must receive the exact object path"
);
assert.match(migration, /workspace_reset_allows_storage_object_access/, "retained reset objects must be quarantined by exact object path");
assert.match(migration, /and case\s+when split_part\(name, '\/', 1\)/, "malformed Storage prefixes must fail closed before UUID casts");
assert.match(
  migration,
  /workspace_reset_allows_storage_object_access\([\s\S]+?from public\.file_uploads f[\s\S]+?f\.deleted_at is not null[\s\S]+?from public\.workspace_reset_storage_objects/,
  "normal soft-deleted source objects must leave authenticated product access immediately"
);
assert.match(migration, /protect_file_upload_lifecycle_fields/, "retention and legal-hold fields must reject direct client mutation");
assert.match(migration, /vaeroex\.source_file_lifecycle/, "the controlled source lifecycle RPC must identify trusted retention updates");
assert.match(migration, /p_action in \('archive', 'delete'\) and not public\.can_manage_workspace/, "source archive and delete must require owner or admin authorization in SQL");

for (const resettable of [
  "record_folders",
  "kpis",
  "kpi_settings",
  "kpi_alert_rules",
  "kpi_alert_events",
  "tasks",
  "issues",
  "sops",
  "reports",
  "scheduled_report_runs",
  "report_subscription_preferences",
  "forms",
  "form_submissions",
  "checklists",
  "checklist_runs",
  "workflow_maps",
  "business_intakes",
  "assets",
  "asset_checks",
  "people",
  "file_uploads",
  "file_imports",
  "file_import_rows",
  "file_processing_jobs",
  "business_memory_chunks",
  "business_health_snapshots",
  "ai_agent_runs",
  "crm_leads",
  "crm_lead_history",
  "operational_metrics",
  "notifications",
  "record_shares",
  "operational_assignments",
  "business_decisions",
  "vaeroex_recommendation_outcomes"
]) {
  assert.match(migration, new RegExp(`'${resettable}'`), `${resettable} must be in the explicit reset inventory`);
}

for (const preserved of [
  "profiles",
  "workspaces",
  "workspace_members",
  "legal_acceptances",
  "security_audit_events",
  "audit_logs",
  "ai_usage",
  "customer_subscriptions",
  "subscription_events",
  "support_requests",
  "request_rate_limits"
]) {
  assert.doesNotMatch(migration, new RegExp(`delete from public\\.${preserved}`), `${preserved} must not be deleted`);
}

assert.match(storage, /\.storage\.from\(WORKSPACE_RESET_STORAGE_BUCKET\)\.list/, "storage manifest must use the Storage API");
assert.match(storage, /\.storage[\s\S]+\.remove\(/, "permanent purge must use the Storage API remove method");
assert.match(storage, /isExactWorkspaceStoragePath/, "every listed and deleted object must pass exact-prefix validation");
assert.match(storage, /file\.storage_bucket !== WORKSPACE_RESET_STORAGE_BUCKET/, "unexpected buckets must be rejected");
assert.match(storage, /processDueSourceFilePurges/, "normal source retention purge must be deterministic");
assert.match(storage, /claimWorkspaceResetPurge/, "interactive and scheduled workspace purges must share one claim path");
assert.match(storage, /operation\.status === "purging"[\s\S]+\.lt\("updated_at", staleClaimCutoff\)/, "workspace purge claims must reject active workers and recover stale claims");
assert.match(storage, /if \(auditError\) throw new Error/, "scheduled storage purge audit failures must not be ignored");
assert.match(storage, /workspace_context_before: successful \? \{\} : operation\.workspace_context_before/, "expired recovery context must be minimized after verified purge");
assert.match(storage, /admin\.rpc\("claim_source_file_purge"/, "source purge must acquire a database-coordinated claim before Storage deletion");
assert.match(storage, /admin\.rpc\("finalize_source_file_purge"/, "source purge state and audit must finalize atomically after Storage verification");
assert.match(storage, /WORKSPACE_RESET_MAX_OBJECTS_PER_PURGE_RUN/, "each storage purge invocation must be bounded for serverless execution");
assert.match(storage, /allRows\.some\(\(row\) => row\.legal_hold\)/, "object-level legal holds must block purge finalization");
assert.match(storage, /legal_hold: fileByPath\.get\(object\.path\)\?\.legal_hold/, "source-level legal holds must be copied into the exact storage manifest");
assert.match(storage, /storageObjectExists/, "normal source purges must be verified after the Storage API call");
assert.match(storage, /\.exists\(objectPath\)/, "source purge verification must check the exact private object path");
assert.match(migration, /claim_source_file_purge[\s\S]+pg_try_advisory_xact_lock/, "source purge and workspace reset must share a workspace advisory lock");
assert.match(migration, /finalize_source_file_purge[\s\S]+source_file_storage_purged[\s\S]+system\.source_file_retention_purge/, "source purge finalization must retain operational and security audit records");
assert.match(migration, /grant execute on function public\.claim_source_file_purge\(uuid, uuid\) to service_role/, "only the service role may claim a scheduled source purge");
assert.match(storage, /workspace_reset_storage_objects"\)\s*\.delete\(\)/, "completed scheduled purges must minimize exact-path manifests");
assert.doesNotMatch(storage, /storage\.objects/, "application code must not write storage.objects directly");

assert.match(resetGuard, /workspace_reset_operations/, "application Storage uploads must check reset state before writing");
assert.match(resetGuard, /42P01[\s\S]+PGRST205/, "application code must remain deployable before the additive migration");
assert.match(resetGuard, /could not verify workspace write safety/, "unexpected capability-check failures must fail closed");
assert.match(fileActions, /assertWorkspaceBusinessWritesAllowed[\s\S]+storage\.from\(STORAGE_BUCKET\)\.upload[\s\S]+assertWorkspaceBusinessWritesAllowed/, "uploads must check reset state before and after the Storage API call");
assert.match(fileActions, /if \(error \|\| !data\) \{[\s\S]+storage\.from\(STORAGE_BUCKET\)\.remove\(\[storagePath\]\)/, "failed metadata writes must compensate by removing the just-uploaded object");
assert.match(migration, /Permanent reset is blocked by a private object under legal hold/, "permanent database deletion must not begin while manifested storage is under legal hold");
assert.match(migration, /v_total_records > 100000/, "interactive database resets must fail safely above the reviewed row bound");
for (const scopedMutation of [
  /update public\.workspace_reset_operations[\s\S]+where id = p_operation_id\s+and workspace_id = p_workspace_id/,
  /update public\.workspace_reset_storage_objects[\s\S]+where operation_id = p_operation_id\s+and workspace_id = p_workspace_id/,
  /delete from public\.workspace_reset_record_backups[\s\S]+where operation_id = p_operation_id\s+and workspace_id = p_workspace_id/
]) {
  assert.match(migration, scopedMutation, "reset ledger mutations must repeat the exact workspace scope");
}
assert.match(storage, /updateManifestRows\(\s*admin: AdminClient,\s*workspaceId: string[\s\S]+\.eq\("workspace_id", workspaceId\)/, "batched manifest mutations must be workspace scoped");
assert.match(migration, /starter_records_created', false/, "guided reset setup must not create sample business evidence");
assert.match(cron, /CRON_SECRET/, "the purge route must authenticate scheduled requests");
assert.match(cron, /processDueWorkspaceResetPurges/, "the purge route must process due reset manifests");
process.stdout.write("Workspace reset foundation regression tests passed.\n");
