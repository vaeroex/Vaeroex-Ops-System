const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const loadedTypeScriptModules = new Map();
function loadTypeScriptModule(relative) {
  if (loadedTypeScriptModules.has(relative)) return loadedTypeScriptModules.get(relative);
  const source = read(relative);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} };
  loadedTypeScriptModules.set(relative, loaded.exports);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return loadTypeScriptModule(`${specifier.slice(2)}.ts`);
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  loadedTypeScriptModules.set(relative, loaded.exports);
  return loaded.exports;
}
const {
  buildDocumentExtractionIdentity,
  documentExtractionIdentityMatches
} = loadTypeScriptModule("lib/document-extraction/identity.ts");
const {
  evaluateDocumentExtractionEligibility,
  evaluatePhaseADocumentExtractionEligibility
} = loadTypeScriptModule("lib/document-extraction/eligibility.ts");
const { assertEncryptedDocumentExtractionEnvelope } = loadTypeScriptModule("lib/document-extraction/encryption.ts");
const migrationName = fs.readdirSync(path.join(root, "supabase/migrations"))
  .find((name) => name.endsWith("_document_extraction_production_foundation_phase_a.sql"));
assert.ok(migrationName, "the Phase A migration must be present");

const migration = read(`supabase/migrations/${migrationName}`);
const contracts = read("lib/document-extraction/contracts.ts");
const approvalGuard = read("lib/document-extraction/approval-guard.ts");
const evidenceIndex = read("lib/ai/evidence-index.ts");
const fileActions = read("app/app/files/actions.ts");
const generatedTypes = read("lib/supabase/types.ts");
const businessNotes = read("app/app/sources/business-notes/actions.ts");
const snapshotBuilder = read("lib/intelligence/snapshot/v1/builder.ts");
const functionSection = (name, nextName) => {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName ? migration.indexOf(`create or replace function public.${nextName}`, start + 1) : migration.length;
  assert.ok(start >= 0 && end > start, `${name} must be present in the canonical migration`);
  return migration.slice(start, end);
};
const requestIntake = functionSection("request_document_extraction_intake_v1", "enqueue_document_extraction_job_v1");
const privilegedEnqueue = functionSection("enqueue_document_extraction_job_v1", "claim_document_extraction_job_v1");
const reviewMutation = functionSection("mutate_document_extraction_review_v1", "document_extraction_authority_is_approved_v1");
const authorityResolver = functionSection("resolve_document_extraction_file_authority_v1", "protect_document_extraction_file_state_v1");
const manifestValidator = functionSection("validate_document_extraction_critical_field_manifest_v1", "complete_document_extraction_job_v1");

const requiredTables = [
  "document_extraction_intake_requests",
  "document_extraction_jobs",
  "document_extraction_file_bindings",
  "document_extraction_cache",
  "document_extraction_reviews",
  "document_extraction_events",
  "document_extraction_workspace_settings",
  "document_extraction_system_state"
];
for (const table of requiredTables) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} must be additive`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} must enable RLS`);
}

assert.match(migration, /globally_enabled boolean not null default false/);
assert.match(migration, /worker_enabled boolean not null default false/);
assert.match(migration, /provider_calls_enabled boolean not null default false/);
assert.match(migration, /is_entitled boolean not null default false/);
assert.match(migration, /is_enabled boolean not null default false/);
assert.match(migration, /monthly_page_limit integer not null default 0/);
assert.match(migration, /concurrent_job_limit integer not null default 1 check \(concurrent_job_limit = 1\)/);
assert.doesNotMatch(migration, /insert into public\.document_extraction_workspace_settings/i, "no workspace may be activated or backfilled");

assert.match(migration, /constraint document_extraction_jobs_workspace_cache_unique unique \(workspace_id, cache_key\)/);
assert.match(migration, /constraint document_extraction_cache_workspace_key_unique unique \(workspace_id, cache_key\)/);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /document_extraction_jobs_one_active_nvidia_per_workspace_idx/);
assert.match(migration, /document_extraction_file_bindings_file_id_idx/);
assert.match(migration, /status = 'dispatch_unknown'/);
assert.match(migration, /provider_dispatched_at is null/);
assert.match(privilegedEnqueue, /pages_reserved = pages_reserved \+ p_page_count/);
assert.match(migration, /pages_consumed = pages_consumed \+ v_job\.reserved_page_count/);
assert.match(migration, /cache_hit', v_job\.status = 'completed'/);
assert.match(privilegedEnqueue, /pg_advisory_xact_lock/);
assert.match(privilegedEnqueue, /where intake_request_id = v_intake\.id for update/);
assert.match(privilegedEnqueue, /where workspace_id = v_intake\.workspace_id and cache_key = p_cache_key for update/);
assert.doesNotMatch(requestIntake, /page_count|pages_qualified|cache_key|parser_provider|parser_model|routing_policy_version|normalization_version/);
assert.match(requestIntake, /from public\.file_uploads/);
assert.match(requestIntake, /public\.is_workspace_member\(v_file\.workspace_id\)/);
assert.match(migration, /grant execute on function public\.request_document_extraction_intake_v1\(uuid, uuid\) to authenticated/);
assert.match(migration, /grant execute on function public\.enqueue_document_extraction_job_v1[^;]+to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.enqueue_document_extraction_job_v1[^;]+to authenticated/);
assert.match(migration, /grant execute on function public\.assert_document_extraction_authority_v1[^;]+to authenticated/);
assert.doesNotMatch(migration, /grant execute on function public\.assert_document_extraction_authority_v1[^;]+to authenticated, service_role/);

assert.match(migration, /payload_ciphertext bytea not null/);
assert.match(migration, /encryption_algorithm text not null check \(encryption_algorithm = 'aes-256-gcm'\)/);
assert.match(migration, /octet_length\(encryption_nonce\) = 12/);
assert.match(migration, /octet_length\(authentication_tag\) = 16/);
assert.doesNotMatch(migration, /normalized_payload\s+jsonb|raw_provider_(request|response)|plaintext_payload/i);
assert.doesNotMatch(migration, /grant select[^;]+document_extraction_cache to authenticated/is);
assert.match(migration, /revoke all privileges on table public\.document_extraction_cache from public, anon, authenticated, service_role/);

assert.match(migration, /workspace members read document extraction jobs[\s\S]+is_workspace_member\(workspace_id\)/);
assert.match(migration, /workspace members read document extraction reviews[\s\S]+is_workspace_member\(workspace_id\)/);
assert.match(migration, /clients cannot access document extraction system state[\s\S]+using \(false\) with check \(false\)/);
assert.match(migration, /clients cannot access document extraction cache[\s\S]+using \(false\) with check \(false\)/);
assert.match(migration, /has_workspace_role\(p_workspace_id, array\['owner', 'admin', 'manager'\]\)/);
assert.match(migration, /Document extraction events are append-only/);
assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]+document_extraction_(jobs|cache|reviews|events|workspace_settings|system_state) to authenticated/is);

assert.match(migration, /assert_document_extraction_authority_v1/);
assert.match(migration, /document_extraction_authority_is_approved_v1/);
assert.match(migration, /review\.unresolved_field_count = 0/);
assert.match(migration, /review\.rejected_field_count = 0/);
assert.match(migration, /review\.review_version = job\.required_review_version/);
assert.match(migration, /cache\.invalidated_at is null/);
assert.match(reviewMutation, /p_action text/);
assert.doesNotMatch(reviewMutation, /p_status text|p_critical_field_count|p_confirmed_field_count|p_corrected_field_count|p_rejected_field_count|p_unresolved_field_count/);
assert.match(reviewMutation, /p_action is null or p_action not in/);
assert.match(reviewMutation, /p_review_version is distinct from v_job\.required_review_version/);
assert.match(reviewMutation, /v_decision_kind is null/);
assert.match(reviewMutation, /coalesce\(jsonb_typeof\(p_decision_summary_json -> 'fields'\) <> 'array', true\)/);
assert.match(reviewMutation, /Exactly one decision is required for every critical field/);
assert.match(reviewMutation, /Duplicate or invalid critical-field decision/);
assert.match(reviewMutation, /unknown critical field/);
assert.match(reviewMutation, /Malformed corrected/);
assert.match(reviewMutation, /v_status := case when v_corrected_field_count > 0 then 'approved_with_corrections' else 'approved' end/);
assert.match(reviewMutation, /p_extraction_contract_version is distinct from v_job\.extraction_contract_version/);
assert.match(reviewMutation, /critical_field_manifest_fingerprint/);
assert.match(manifestValidator, /manifest_version' is distinct from 'document_extraction_critical_fields_v1'/);
assert.match(manifestValidator, /coalesce\(jsonb_typeof\(p_manifest -> 'fields'\) <> 'array', true\)/);
assert.match(migration, /enforce_document_extraction_business_memory_authority/);
assert.match(migration, /enforce_document_extraction_kpi_authority/);
assert.match(migration, /enforce_document_extraction_operational_metric_authority/);
assert.match(authorityResolver, /join public\.document_extraction_jobs job[\s\S]+job\.review_required/);
assert.match(authorityResolver, /and is_current/);
assert.match(migration, /protect_document_extraction_file_state/);
for (const reservedKey of [
  "document_extraction_job_id",
  "document_extraction_review_id",
  "document_extraction_artifact_fingerprint",
  "document_extraction_classification_fingerprint",
  "document_extraction_review_version",
  "document_extraction_authority"
]) assert.match(migration, new RegExp(`'${reservedKey}'`));

assert.ok(
  evidenceIndex.indexOf("assertDocumentExtractionAuthority") < evidenceIndex.indexOf("const normalized = normalizeText(extractedText)"),
  "authority must be checked before chunking"
);
assert.ok(
  evidenceIndex.indexOf("assertDocumentExtractionAuthority") < evidenceIndex.indexOf("createEmbeddings(chunks)"),
  "authority must be checked before embeddings"
);
assert.match(evidenceIndex, /const extractionAuthority = extractionEligibility\.authority/);
assert.ok(
  evidenceIndex.indexOf("...extractionMetadata") < evidenceIndex.indexOf("business_memory_chunks\").upsert"),
  "reviewed fingerprints must accompany the authoritative Business Memory write"
);
assert.doesNotMatch(fileActions, /resolveFileAnalysisExtractionAuthority|extractionAuthority:/, "file actions must not interpret client-editable extraction markers");
assert.doesNotMatch(businessNotes, /document-extraction|document_extraction/, "Business Notes remain on their contextual review path");
assert.doesNotMatch(snapshotBuilder, /document-extraction|document_extraction/, "unapproved extraction is not a snapshot input");

for (const field of [
  "kpi_name", "current_value", "target", "sign", "decimal", "currency",
  "percentage", "unit", "reporting_period", "page", "source_coordinates"
]) assert.match(contracts, new RegExp(`\| \"${field}\"`));
for (const decision of ["confirmed", "corrected", "rejected", "unresolved"]) {
  assert.match(contracts, new RegExp(`\"${decision}\"`));
}
assert.match(approvalGuard, /mode: "existing_native_file_analysis"/);
assert.match(approvalGuard, /mode: "unapproved_document_extraction"/);
assert.match(approvalGuard, /mode: "reviewed_document_extraction"/);
assert.match(approvalGuard, /resolve_document_extraction_file_authority_v1/);
assert.doesNotMatch(approvalGuard, /metadata\.document_extraction|record\.document_extraction|pendingDocumentExtractionAuthorityMetadata/);
assert.match(contracts, /DocumentExtractionCriticalFieldManifestV1/);
assert.match(contracts, /DocumentExtractionReviewAction = "save" \| "approve" \| "reject"/);

for (const relationship of [
  "document_extraction_jobs_intake_request_id_fkey",
  "document_extraction_file_bindings_file_id_fkey",
  "document_extraction_file_bindings_job_id_fkey",
  "document_extraction_reviews_job_id_fkey",
  "document_extraction_cache_source_job_id_fkey"
]) {
  assert.match(generatedTypes, new RegExp(`foreignKeyName: "${relationship}"`), `${relationship} must be generated from Preview`);
}
assert.match(generatedTypes, /request_document_extraction_intake_v1:\s*\{[\s\S]+p_file_id: string; p_request_id: string/);
assert.match(generatedTypes, /enqueue_document_extraction_job_v1:\s*\{[\s\S]+p_intake_request_id: string[\s\S]+p_page_count: number/);
assert.doesNotMatch(
  generatedTypes.match(/enqueue_document_extraction_job_v1:\s*\{[\s\S]+?Returns: Json\s*\}/)?.[0] ?? "",
  /p_pages_qualified|p_workspace_id|p_file_id|p_requested_by/
);
assert.match(generatedTypes, /mutate_document_extraction_review_v1:\s*\{[\s\S]+p_action: string[\s\S]+p_decision_summary_json: Json/);
assert.doesNotMatch(
  generatedTypes.match(/mutate_document_extraction_review_v1:\s*\{[\s\S]+?Returns: Json\s*\}/)?.[0] ?? "",
  /p_status|p_critical_field_count|p_confirmed_field_count|p_corrected_field_count|p_rejected_field_count|p_unresolved_field_count/
);

const secret = new Uint8Array(32).fill(17);
const baseIdentity = {
  secret,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  fileBytes: new TextEncoder().encode("same stored document bytes"),
  route: "nvidia_primary",
  documentClass: "scanned_pdf",
  provider: "provider-neutral-test",
  modelRevision: "model-revision-1",
  clientRevision: "client-revision-1",
  routingPolicyVersion: "routing-v1",
  extractionContractVersion: "artifact-v1",
  normalizationVersion: "normalization-v1"
};
const first = buildDocumentExtractionIdentity(baseIdentity);
const replay = buildDocumentExtractionIdentity(baseIdentity);
assert.deepEqual(replay, first, "identical workspace input must be idempotent");
assert.ok(documentExtractionIdentityMatches(first.cacheKey, replay.cacheKey));
assert.notEqual(
  buildDocumentExtractionIdentity({ ...baseIdentity, workspaceId: "22222222-2222-4222-8222-222222222222" }).cacheKey,
  first.cacheKey,
  "cache identities must never cross workspace boundaries"
);
assert.notEqual(
  buildDocumentExtractionIdentity({ ...baseIdentity, extractionContractVersion: "artifact-v2" }).cacheKey,
  first.cacheKey,
  "contract changes must invalidate cache identity"
);
assert.notEqual(
  buildDocumentExtractionIdentity({ ...baseIdentity, clientRevision: "vaeroex_nemotron_parse_rest_v2" }).cacheKey,
  buildDocumentExtractionIdentity({ ...baseIdentity, clientRevision: "vaeroex_nemotron_parse_rest_v1" }).cacheKey,
  "hosted compatibility revisions must never share cache identity"
);
assert.notEqual(
  buildDocumentExtractionIdentity({ ...baseIdentity, fileBytes: new TextEncoder().encode("different document bytes") }).contentHmac,
  first.contentHmac,
  "content changes must change the keyed identity"
);
assert.throws(() => buildDocumentExtractionIdentity({ ...baseIdentity, secret: new Uint8Array(8) }), /256 bits/);

const allGates = {
  globallyEnabled: true,
  workerEnabled: true,
  providerCallsEnabled: true,
  workspaceEntitled: true,
  workspaceEnabled: true,
  allowedDocumentClasses: ["scanned_pdf"],
  documentClass: "scanned_pdf",
  circuitState: "closed",
  requiredPages: 2,
  remainingPages: 10,
  activeProviderJobs: 0,
  concurrentJobLimit: 1
};
assert.deepEqual(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true }), { eligible: true, reason: "eligible" });
assert.deepEqual(evaluatePhaseADocumentExtractionEligibility(allGates), { eligible: false, reason: "phase_a_inert" });
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, globallyEnabled: false }).reason, "globally_disabled");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, workerEnabled: false }).reason, "worker_disabled");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, providerCallsEnabled: false }).reason, "provider_calls_disabled");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, workspaceEntitled: false }).reason, "workspace_not_entitled");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, remainingPages: 1 }).reason, "quota_exhausted");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, circuitState: "open" }).reason, "circuit_open");
assert.equal(evaluateDocumentExtractionEligibility({ ...allGates, runtimeAvailable: true, activeProviderJobs: 1 }).reason, "concurrency_limit_reached");

const validEnvelope = {
  algorithm: "aes-256-gcm",
  keyVersion: "managed-key-v1",
  nonce: new Uint8Array(12),
  authenticationTag: new Uint8Array(16),
  aadDigest: "a".repeat(64),
  ciphertext: new Uint8Array([1, 2, 3])
};
assert.equal(assertEncryptedDocumentExtractionEnvelope(validEnvelope), validEnvelope);
assert.throws(() => assertEncryptedDocumentExtractionEnvelope({ ...validEnvelope, nonce: new Uint8Array(8) }), /96-bit nonce/);
assert.throws(() => assertEncryptedDocumentExtractionEnvelope({ ...validEnvelope, ciphertext: new Uint8Array() }), /Plaintext or empty/);

const phaseAAuthorityFiles = [
  "lib/document-extraction/identity.ts",
  "lib/document-extraction/eligibility.ts",
  "lib/document-extraction/approval-guard.ts"
].map(read).join("\n");
assert.doesNotMatch(
  phaseAAuthorityFiles,
  /\bfetch\s*\(|openai|nemotron|nemo_retriever/i,
  "Phase A identity, eligibility, and authority guards must contain no provider execution path"
);

console.log("Document extraction Phase A foundation regressions passed.");
