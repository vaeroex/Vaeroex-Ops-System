const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read(
  "supabase/migrations/20260806180609_document_extraction_google_frozen_qualification_controller.sql"
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
const brokerContracts = read("lib/document-extraction/broker-contracts.ts");
const runtimePolicy = read("lib/document-extraction/runtime-policy.ts");

assert.doesNotMatch(migration, /\b(?:drop|truncate)\s+(?:table|schema)\b/i);
assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.(?!document_extraction_google_qualification_runs\b)/i);
assert.doesNotMatch(migration, /mdiianhfrojmxqpwrflh/);
assert.match(migration, /enabled boolean not null default false/);
assert.match(migration, /p_preview_project_ref <> 'zfpnhvcmuuvtswttmnjd'/);
assert.match(migration, /controller_version = 'google_frozen_corpus_qualification_controller_v1'/);

for (const table of [
  "document_extraction_google_qualification_state",
  "document_extraction_google_qualification_runs",
  "document_extraction_google_qualification_items",
  "document_extraction_google_qualification_page_reservations"
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(
    migration,
    new RegExp(`revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`)
  );
}

const securityDefinerFunctions = [
  "set_google_frozen_qualification_enabled_v1",
  "prepare_google_frozen_qualification_v1",
  "enqueue_next_google_frozen_qualification_item_v1",
  "claim_google_frozen_qualification_job_v1",
  "assert_google_frozen_qualification_job_v1",
  "reserve_google_frozen_qualification_page_v1",
  "record_google_frozen_qualification_page_outcome_v1",
  "finish_google_frozen_qualification_item_v1",
  "stop_google_frozen_qualification_v1",
  "complete_google_frozen_qualification_v1",
  "get_google_frozen_qualification_status_v1",
  "cleanup_google_frozen_qualification_v1"
];
for (const name of securityDefinerFunctions) {
  const declaration = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`
  );
  assert.match(migration, declaration);
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`)
  );
  assert.match(
    migration,
    new RegExp(`revoke execute on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role`)
  );
}

assert.match(migration, /eligible_document_limit integer not null default 8 check \(eligible_document_limit = 8\)/);
assert.match(migration, /eligible_page_limit integer not null default 9 check \(eligible_page_limit = 9\)/);
assert.match(migration, /provider_reservation_limit integer not null default 9 check \(provider_reservation_limit = 9\)/);
assert.match(migration, /provider_call_limit integer not null default 9 check \(provider_call_limit = 9\)/);
assert.match(migration, /retry_limit integer not null default 0 check \(retry_limit = 0\)/);
assert.match(migration, /concurrency_limit integer not null default 1 check \(concurrency_limit = 1\)/);
assert.equal((migration.match(/^\s*\((?:[1-9]|1[0-2]), '[0-9a-f]{64}'/gm) || []).length, 12);
for (const fixtureIndex of [5, 8, 9, 12]) {
  assert.match(
    migration,
    new RegExp(`\\(${fixtureIndex}, '[0-9a-f]{64}', '[0-9a-f]{64}', array\\[[^\\n]+, 1, false,`)
  );
}
assert.match(migration, /not provider_eligible[\s\S]*?intake_request_id is null[\s\S]*?job_id is null[\s\S]*?provider_reservation_count = 0[\s\S]*?provider_call_count = 0/);
assert.match(migration, /where run_id = v_run\.id and provider_eligible and status = 'planned'/);
assert.match(migration, /v_eligible_documents <> 8 or v_eligible_pages <> 9/);

assert.match(migration, /for update of run/);
assert.match(migration, /document_extraction_google_qualification_one_active_page_idx[\s\S]*?where status = 'reserved'/);
assert.match(migration, /p_page_index <> v_item\.provider_reservation_count \+ 1/);
assert.match(migration, /v_run\.provider_reservation_count >= v_run\.provider_reservation_limit[\s\S]*?v_run\.provider_call_count >= v_run\.provider_call_limit/);
assert.match(migration, /qualification_duplicate_provider_reservation/);
assert.match(migration, /qualification_call_budget_exceeded/);
assert.match(migration, /set status = 'stopped', stop_reason = coalesce\(stop_reason, v_reason\)/);
assert.match(migration, /provider_call_count < provider_call_limit/);
assert.match(migration, /provider_call_count < provider_reservation_count/);
assert.match(migration, /v_job\.retry_count <> 0 or v_run\.retry_count <> 0/);
assert.match(migration, /v_job\.status <> 'needs_review'[\s\S]*?v_job\.stage <> 'awaiting_review'[\s\S]*?v_job\.approval_status <> 'pending'/);

const runController = controller.slice(
  controller.indexOf("async def run_google_frozen_qualification")
);
assert.ok(
  runController.indexOf("plan = google_qualification_plan")
    < runController.indexOf("async with BrokerClient(config) as broker")
);
assert.match(runController, /expected_fixtures = \[[\s\S]*?fixture\.fixture_index for fixture in plan\.eligible_fixtures/);
assert.match(runController, /before\.active_fixture_index is not None/);
assert.match(runController, /result\.status != "needs_review" or result\.retry_count != 0/);
assert.match(runController, /"operation": "qualification_stop"/);
assert.doesNotMatch(runController, /nvidia|fallback/i);

assert.match(runtimePolicy, /google_frozen_corpus_controller_v1/);
assert.match(runtimePolicy, /runtimeEnvironment === "preview"/);
assert.match(runtimePolicy, /GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE/);
assert.match(brokerContracts, /qualificationPageIndex: z\.number\(\)\.int\(\)\.min\(1\)\.max\(2\)\.optional\(\)/);
assert.match(brokerContracts, /qualificationReservationRequestId: uuid\.optional\(\)/);

const qualificationBoundaryStart = brokerService.indexOf(
  "if (policy.googleFrozenQualificationControllerEnabled) {",
  brokerService.indexOf('request.operation === "check_provider_boundary"')
);
const qualificationBoundaryEnd = brokerService.indexOf("} else if (", qualificationBoundaryStart);
const qualificationBoundary = brokerService.slice(
  qualificationBoundaryStart,
  qualificationBoundaryEnd
);
assert.match(qualificationBoundary, /reserveGoogleFrozenQualificationPage/);
assert.doesNotMatch(qualificationBoundary, /checkDocumentExtractionProviderBoundary/);
assert.match(
  brokerService.slice(qualificationBoundaryEnd, brokerService.indexOf("if \(!result.allowed", qualificationBoundaryEnd)),
  /checkDocumentExtractionProviderBoundary/
);

assert.match(runner, /google_frozen_qualification_controller_enabled[\s\S]*?qualification_page_cursor \+= 1/);
assert.match(runner, /qualification_page_outcome/);
assert.match(adapter, /self\._before_provider_boundary\("inference"\)[\s\S]*?_access_token/);
assert.match(adapter, /self\._provider_page_outcome\(page\.page, True, "success", True\)/);
assert.match(adapter, /self\._provider_page_outcome\([\s\S]*?failure\.provider_request_started/);

process.stdout.write("Google frozen qualification controller regressions passed.\n");
