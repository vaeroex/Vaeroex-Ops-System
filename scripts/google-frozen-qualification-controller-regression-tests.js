const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read(
  "supabase/migrations/20260806180609_document_extraction_google_frozen_qualification_controller.sql"
);
const concreteFix = read(
  "supabase/migrations/20260807172710_document_extraction_google_frozen_qualification_concrete_fixes.sql"
);
const claimPhaseFix = read(
  "supabase/migrations/20260807181420_document_extraction_google_qualification_claim_phase_fix.sql"
);
const databaseTest = read(
  "supabase/tests/document_extraction_google_qualification_isolation.test.sql"
);
const multiFixtureTest = read(
  "supabase/tests/document_extraction_google_qualification_multifixture.test.sql"
);
const controller = read(
  "services/document-extraction-worker/src/vaeroex_document_worker/google_qualification_controller.py"
);
const runner = read(
  "services/document-extraction-worker/src/vaeroex_document_worker/runner.py"
);
const adapter = read(
  "services/document-extraction-worker/src/vaeroex_document_worker/google_document_ai_adapter.py"
);
const brokerService = read("lib/document-extraction/broker-service.ts");
const brokerStore = read("lib/document-extraction/broker-store.ts");
const brokerContracts = read("lib/document-extraction/broker-contracts.ts");
const runtimePolicy = read("lib/document-extraction/runtime-policy.ts");

assert.doesNotMatch(migration, /\b(?:drop|truncate)\s+(?:table|schema)\b/i);
assert.doesNotMatch(migration, /\b(?:alter|delete|update)\b[^;]*\b(?:kpis|business_notes|saved_analyses)\b/i);
assert.match(migration, /enabled boolean not null default false/);
assert.match(migration, /google_frozen_corpus_qualification_controller_v2/);
assert.match(
  migration,
  /p_confirmation <> \(case when p_enabled[\s\S]*?end\)/
);
assert.doesNotMatch(concreteFix, /\b(?:truncate)\s+(?:table|schema)\b/i);
assert.doesNotMatch(
  concreteFix,
  /\b(?:alter|delete|update)\b[^;]*\b(?:kpis|business_notes|saved_analyses)\b/i
);
assert.match(
  concreteFix,
  /document_extraction_google_qualification_processing_job_bindings/
);
assert.match(concreteFix, /deleted_file_processing_job_count/);
assert.match(concreteFix, /google_qualification_guard_context/);
assert.match(concreteFix, /'run_id', v_run\.id/);
assert.match(concreteFix, /'workspace_id', v_run\.workspace_id/);
assert.match(concreteFix, /'item_id', v_item\.id/);
assert.match(concreteFix, /'intake_request_id', v_item\.intake_request_id/);
assert.match(concreteFix, /'file_id', v_item\.file_id/);
assert.match(concreteFix, /'fixture_index', v_item\.fixture_index/);
assert.match(concreteFix, /'reservation_id', v_reservation\.id/);
assert.match(concreteFix, /'page_index', v_reservation\.page_index/);
assert.doesNotMatch(concreteFix, /order by fixture_index\s+limit 1/);
assert.match(
  concreteFix,
  /prepare_google_frozen_qualification_base_v1[\s\S]*?restart_latched/
);
assert.match(
  concreteFix,
  /delete from public\.file_processing_jobs processing_job[\s\S]*?file_processing_job_id/
);
assert.match(
  concreteFix,
  /deleted_file_processing_jobs[\s\S]*?v_processing_job_count/
);
assert.doesNotMatch(claimPhaseFix, /\b(?:truncate)\s+(?:table|schema)\b/i);
assert.doesNotMatch(
  claimPhaseFix,
  /\b(?:alter|delete|update)\b[^;]*\b(?:kpis|business_notes|saved_analyses)\b/i
);
assert.match(claimPhaseFix, /'claim_worker_id', p_worker_id/);
assert.match(claimPhaseFix, /'claim_lease_seconds', p_lease_seconds/);
assert.match(claimPhaseFix, /v_item\.status <> 'queued'/);
assert.match(claimPhaseFix, /v_item\.status <> 'processing'/);
assert.match(claimPhaseFix, /new\.event_type <> 'google_qualification_job_claimed'/);
assert.match(claimPhaseFix, /new\.lease_owner <> v_claim_worker_id/);
assert.match(claimPhaseFix, /v_claim_job\.attempts <> 1/);
assert.match(claimPhaseFix, /event\.event_type = 'google_qualification_job_claimed'/);
assert.match(
  claimPhaseFix,
  /assert_google_frozen_qualification_job_v1\([\s\S]*?'heartbeat'/
);
assert.doesNotMatch(claimPhaseFix, /create\s+(?:table|index|trigger)\b/i);
assert.match(controller, /restart_latched/);
assert.match(controller, /qualification_worker_restarted/);
assert.match(controller, /qualification_controller_failure/);
assert.match(multiFixtureTest, /fixture 1 reaches the existing successful review boundary/);
assert.match(multiFixtureTest, /fixture 2 enqueues after fixture 1/);
assert.match(multiFixtureTest, /guard resolves fixture 2 rather than fixture 1/);
assert.match(multiFixtureTest, /stale fixture 1 context cannot mutate fixture 2/);
assert.match(multiFixtureTest, /wrong intake cannot manufacture qualification context/);
assert.match(multiFixtureTest, /fixture 2 context cannot mutate fixture 1 job state/);
assert.match(multiFixtureTest, /fixture 2 context cannot mutate fixture 1 file state/);
assert.match(multiFixtureTest, /claimed event cannot be recorded while the item is still queued/);
assert.match(multiFixtureTest, /qualification item atomically enters processing/);
assert.match(multiFixtureTest, /qualification job has exactly the winning first lease/);
assert.match(multiFixtureTest, /exact post-transition claimed event is recorded once/);
assert.match(multiFixtureTest, /duplicate claimed event is rejected/);
assert.match(multiFixtureTest, /wrong claim worker fails/);
assert.match(multiFixtureTest, /wrong claim lease fails/);
assert.match(multiFixtureTest, /missing claim lease fails/);
assert.match(multiFixtureTest, /substituted claim run fails signed-context validation/);
assert.match(multiFixtureTest, /ordinary Google claim cannot receive the qualification job/);
assert.match(databaseTest, /create or replace function pg_temp\.google_qualification_assertion_reason/);
assert.match(databaseTest, /create or replace function pg_temp\.finish_google_qualification_rpc/);
assert.match(databaseTest, /create or replace function pg_temp\.new_google_qualification_run_id/);
assert.match(databaseTest, /create or replace function pg_temp\.assert_google_qualification_run_id_unused/);
assert.match(databaseTest, /v_run_id := gen_random_uuid\(\)/);
assert.match(databaseTest, /document_extraction_google_qualification_cleanup_audits/);
assert.match(databaseTest, /three qualification executions receive distinct random run identities/);
assert.match(databaseTest, /deliberate reuse of a cleaned run identity fails closed/);
assert.doesNotMatch(databaseTest, /f2650000-0000-4000-8000-000000000003/);
for (const reason of [
  "qualification_run_mismatch",
  "environment_binding_mismatch",
  "workspace_binding_mismatch",
  "fixture_binding_mismatch",
  "job_identity_mismatch",
  "job_state_mismatch",
  "lease_state_mismatch",
  "processor_identity_mismatch"
]) {
  assert.match(databaseTest, new RegExp(reason));
}

// Environment, processor, workspace, and source bytes are owner-installed
// database bindings. RPC callers cannot manufacture or mutate them.
assert.match(migration, /supabase_project_ref text not null[\s\S]*?zfpnhvcmuuvtswttmnjd/);
assert.match(migration, /production_project_ref_exclusion text not null[\s\S]*?mdiianhfrojmxqpwrflh/);
assert.match(migration, /synthetic_workspace_id uuid not null unique/);
assert.match(migration, /processor_id text not null check \(processor_id = '948f589143795629'\)/);
assert.match(
  migration,
  /processor_resource = 'projects\/626856681952\/locations\/us\/processors\/948f589143795629\/processorVersions\/pretrained-ocr-v2[.]1-2024-08-07'/
);
assert.match(migration, /verification_version = 'trusted_storage_sha256_v1'/);
assert.match(migration, /source_sha256 text not null check \(source_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
assert.doesNotMatch(
  migration,
  /insert into public\.document_extraction_google_qualification_environment/
);

for (const table of [
  "document_extraction_google_qualification_state",
  "document_extraction_google_qualification_environment",
  "document_extraction_google_qualification_sources",
  "document_extraction_google_qualification_runs",
  "document_extraction_google_qualification_items",
  "document_extraction_google_qualification_page_reservations",
  "document_extraction_google_qualification_job_bindings",
  "document_extraction_google_qualification_cleanup_audits"
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(
  migration,
  /revoke all on table public\.document_extraction_google_qualification_state,[\s\S]*?from public, anon, authenticated, service_role/
);

// Qualification identity is a separate, exact database class.
for (const field of [
  "run_id", "item_id", "source_binding_id", "job_id", "intake_request_id",
  "file_id", "workspace_id", "corpus_contract_version", "corpus_sha256",
  "fixture_identity_fingerprint", "source_sha256", "page_identity_fingerprints",
  "provider_profile", "processor_id", "processor_resource", "processor_version",
  "preview_project_ref", "controller_version"
]) {
  assert.match(
    migration.slice(
      migration.indexOf("create table if not exists public.document_extraction_google_qualification_job_bindings"),
      migration.indexOf("create table if not exists public.document_extraction_google_qualification_cleanup_audits")
    ),
    new RegExp(`\\b${field}\\b`)
  );
}
assert.match(migration, /insert into public\.document_extraction_google_qualification_job_bindings/);
assert.match(migration, /select public\.enqueue_google_document_extraction_job_base_v1/);

// The ordinary enqueue cannot even return a qualification job idempotently.
assert.match(
  migration,
  /Qualification sources require the qualification enqueue path[.]?'/
);
assert.match(
  migration,
  /revoke execute on function public\.enqueue_google_document_extraction_job_base_v1\([\s\S]*?from public, anon, authenticated, service_role/
);

// Ordinary service-role paths fail closed at the database boundary.
const ordinaryClaim = migration.slice(
  migration.indexOf("create or replace function public.claim_google_document_extraction_job_v1"),
  migration.indexOf("create or replace function public.resolve_google_document_extraction_job_lease_v1")
);
assert.match(ordinaryClaim, /not exists \([\s\S]*?document_extraction_google_qualification_job_bindings/);
const ordinaryLease = migration.slice(
  migration.indexOf("create or replace function public.resolve_google_document_extraction_job_lease_v1"),
  migration.indexOf("create or replace function public.resolve_google_frozen_qualification_job_lease_v1")
);
assert.match(ordinaryLease, /exists \([\s\S]*?document_extraction_google_qualification_job_bindings/);
const ordinaryBoundary = migration.slice(
  migration.indexOf("create or replace function public.check_google_document_extraction_provider_boundary_v1"),
  migration.indexOf("create or replace function public.reserve_google_frozen_qualification_page_v1")
);
assert.match(ordinaryBoundary, /Qualification jobs require the qualification provider boundary/);

for (const protectedTable of [
  "document_extraction_jobs", "document_extraction_file_bindings",
  "document_extraction_cache", "document_extraction_reviews",
  "document_extraction_events", "document_extraction_file_access_grants",
  "document_extraction_provider_outcomes", "document_extraction_intake_requests",
  "file_uploads", "document_extraction_workspace_settings", "workspace_members",
  "workspaces"
]) {
  assert.match(
    migration,
    new RegExp(`on public\\.${protectedTable};[\\s\\S]*?enforce_google_frozen_qualification_mutation_v1`)
  );
}
assert.match(
  migration,
  /revoke execute on function public\.begin_google_frozen_qualification_mutation_v1\(uuid, text\)[\s\S]*?from public, anon, authenticated, service_role/
);

// The worker can submit only immutable corpus identity, never execution state.
assert.match(migration, /\(select count\(\*\) from jsonb_object_keys\(v_item\)\) <> 7/);
for (const forbidden of [
  "intakeRequestId", "fileId", "workspaceId", "assessmentFingerprint",
  "contentHmac", "cacheKey", "processorResource", "previewProjectRef"
]) {
  assert.doesNotMatch(controller, new RegExp(`['\"]${forbidden}['\"]`));
}
assert.doesNotMatch(controller, /GOOGLE_FROZEN_INTAKE_BINDINGS_JSON/);

// Qualification reservation is serial, bounded, and precedes dispatch.
assert.match(migration, /eligible_document_limit integer not null default 8 check \(eligible_document_limit = 8\)/);
assert.match(migration, /eligible_page_limit integer not null default 9 check \(eligible_page_limit = 9\)/);
assert.match(migration, /provider_reservation_limit integer not null default 9 check \(provider_reservation_limit = 9\)/);
assert.match(migration, /provider_call_limit integer not null default 9 check \(provider_call_limit = 9\)/);
assert.match(migration, /retry_limit integer not null default 0 check \(retry_limit = 0\)/);
assert.match(migration, /concurrency_limit integer not null default 1 check \(concurrency_limit = 1\)/);
assert.match(migration, /document_extraction_google_qualification_one_active_page_idx[\s\S]*?where status = 'reserved'/);
const reserve = migration.slice(
  migration.indexOf("create or replace function public.reserve_google_frozen_qualification_page_v1"),
  migration.indexOf("create or replace function public.record_google_frozen_qualification_page_outcome_v1")
);
assert.ok(
  reserve.indexOf("insert into public.document_extraction_google_qualification_page_reservations")
    < reserve.indexOf("authorize_google_document_extraction_dispatch_v1")
);
assert.ok(
  reserve.indexOf("qualification_call_budget_exceeded")
    < reserve.indexOf("authorize_google_document_extraction_dispatch_v1")
);
assert.match(reserve, /p_page_index <> v_item\.provider_reservation_count \+ 1/);
assert.match(reserve, /qualification_duplicate_provider_reservation/);
assert.match(reserve, /p_dispatch_request_id/);
for (const binding of [
  "reservation_number", "dispatch_request_id", "worker_id", "lease_expires_at",
  "provider", "provider_profile", "processor_id", "processor_resource",
  "processor_version", "controller_version", "qualification_state_updated_at"
]) {
  assert.match(
    migration.slice(
      migration.indexOf("create table if not exists public.document_extraction_google_qualification_page_reservations"),
      migration.indexOf("create unique index if not exists document_extraction_google_qualification_one_active_page_idx")
    ),
    new RegExp(`\\b${binding}\\b`)
  );
}
assert.match(reserve, /v_run\.provider_reservation_count \+ 1/);
assert.match(reserve, /v_qualification_state_updated_at/);
assert.match(reserve, /v_job\.lease_expires_at, 'google_document_ai', v_run\.provider_profile/);
assert.match(brokerService, /document_extraction_qualification_dispatch_requires_page_reservation/);
assert.match(runner, /if not active_config\.google_frozen_qualification_controller_enabled:[\s\S]*?"operation": "authorize_dispatch"/);
assert.match(runner, /qualification_dispatch_request_id=\([\s\S]*?dispatch_request_id/);

// A stopped run cannot reach any qualification execution entry point.
assert.match(migration, /p_operation not in \('provider_outcome', 'fail'\)[\s\S]*?Google qualification job operation is not authorized/);
assert.match(reserve, /v_run\.status <> 'active'[\s\S]*?qualification_not_active/);
assert.match(migration, /where run\.status = 'active' and run\.active_fixture_index is not null/);

// Cleanup is two-phase, storage-verified, bounded, idempotent, and refuses
// unexpected references before deleting workspace/file records.
for (const name of [
  "cleanup_google_frozen_qualification_v1",
  "verify_google_frozen_qualification_storage_cleanup_v1",
  "finalize_google_frozen_qualification_cleanup_v1",
  "assert_google_frozen_qualification_no_fk_references_v1"
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
}
assert.match(migration, /storage_obligations/);
assert.match(migration, /storage_cleanup_verified_at is null/);
assert.match(migration, /Qualification cleanup found an unowned foreign-key reference/);
assert.match(migration, /document_extraction_google_qualification_cleanup_audits/);
for (const relation of [
  "document_extraction_file_access_grants", "document_extraction_provider_outcomes",
  "document_extraction_reviews", "document_extraction_file_bindings",
  "document_extraction_cache", "document_extraction_events",
  "document_extraction_jobs", "document_extraction_intake_requests",
  "file_uploads", "document_extraction_workspace_settings", "workspace_members",
  "workspaces"
]) {
  assert.match(migration, new RegExp(`(?:delete|update) from public\\.${relation}`));
}
assert.match(brokerStore, /storage[\s\S]*?\.remove\(\[obligation\.storagePath\]\)/);
assert.match(brokerStore, /\.list\(pathParts\.join\("\/"\), \{ limit: 2, search: objectName \}\)/);
assert.match(brokerStore, /document_extraction_qualification_storage_cleanup_unverified/);
assert.match(brokerStore, /verify_google_frozen_qualification_storage_cleanup_v1/);
assert.match(brokerStore, /finalize_google_frozen_qualification_cleanup_v1/);

// Existing provider, normalization, encryption, and review boundaries remain.
assert.match(runtimePolicy, /google_frozen_corpus_controller_v2/);
assert.match(runtimePolicy, /runtimeEnvironment === "preview"/);
assert.match(brokerContracts, /qualificationDispatchRequestId: uuid\.optional\(\)/);
assert.match(adapter, /self\._before_provider_boundary\("inference"\)[\s\S]*?_access_token/);
assert.match(adapter, /self\._provider_page_outcome\(page\.page, True, "success", True\)/);
assert.match(migration, /v_job\.status <> 'needs_review'[\s\S]*?v_job\.stage <> 'awaiting_review'[\s\S]*?v_job\.approval_status <> 'pending'/);
assert.doesNotMatch(migration, /\b(?:evidence|business_memory|business_health|intelligence_snapshot|saved_analysis)\b/i);

process.stdout.write("Google frozen qualification controller isolation regressions passed.\n");
