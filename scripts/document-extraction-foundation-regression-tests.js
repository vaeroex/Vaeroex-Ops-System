const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
function loadTypeScriptModule(relative) {
  const source = read(relative);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
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
const businessNotes = read("app/app/sources/business-notes/actions.ts");
const snapshotBuilder = read("lib/intelligence/snapshot/v1/builder.ts");

const requiredTables = [
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
assert.match(migration, /pages_reserved = pages_reserved \+ p_pages_qualified/);
assert.match(migration, /pages_consumed = pages_consumed \+ v_job\.reserved_page_count/);
assert.match(migration, /cache_hit', v_job\.status = 'completed'/);

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
assert.match(migration, /enforce_document_extraction_business_memory_authority/);
assert.match(migration, /enforce_document_extraction_kpi_authority/);
assert.match(migration, /enforce_document_extraction_operational_metric_authority/);
assert.match(
  migration,
  /update public\.file_uploads[\s\S]+document_extraction_job_id[\s\S]+document_extraction_authority/,
  "enqueue must atomically mark files as extraction-controlled before any downstream indexing"
);
assert.match(
  migration,
  /if p_status in \('approved', 'approved_with_corrections'\)[\s\S]+review_id[\s\S]+classification_fingerprint[\s\S]+review_version/,
  "authorized review must bind the complete approval envelope to every same-workspace file binding"
);

assert.ok(
  evidenceIndex.indexOf("assertDocumentExtractionAuthority") < evidenceIndex.indexOf("const normalized = normalizeText(extractedText)"),
  "authority must be checked before chunking"
);
assert.ok(
  evidenceIndex.indexOf("assertDocumentExtractionAuthority") < evidenceIndex.indexOf("createEmbeddings(chunks)"),
  "authority must be checked before embeddings"
);
assert.ok(
  evidenceIndex.indexOf("...extractionMetadata") < evidenceIndex.indexOf("business_memory_chunks\").upsert"),
  "reviewed fingerprints must accompany the authoritative Business Memory write"
);
assert.equal((fileActions.match(/resolveFileAnalysisExtractionAuthority\(file\.metadata_json\)/g) || []).length, 2, "both current file indexing paths must resolve the persisted extraction marker");
assert.doesNotMatch(businessNotes, /document-extraction|document_extraction/, "Business Notes remain on their contextual review path");
assert.doesNotMatch(snapshotBuilder, /document-extraction|document_extraction/, "unapproved extraction is not a snapshot input");

for (const field of [
  "kpi_name", "current_value", "target", "sign", "decimal", "currency",
  "percentage", "unit", "reporting_period", "page", "source_coordinates"
]) assert.match(contracts, new RegExp(`\\| \\\"${field}\\\"`));
for (const decision of ["confirmed", "corrected", "rejected", "unresolved"]) {
  assert.match(contracts, new RegExp(`\\\"${decision}\\\"`));
}
assert.match(approvalGuard, /mode: "existing_native_file_analysis"/);
assert.match(approvalGuard, /mode: "unapproved_document_extraction"/);
assert.match(approvalGuard, /mode: "reviewed_document_extraction"/);
assert.match(approvalGuard, /assert_document_extraction_authority_v1/);

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

const newRuntimeFiles = [
  "lib/document-extraction/contracts.ts",
  "lib/document-extraction/identity.ts",
  "lib/document-extraction/eligibility.ts",
  "lib/document-extraction/encryption.ts",
  "lib/document-extraction/approval-guard.ts"
].map(read).join("\n");
assert.doesNotMatch(newRuntimeFiles, /\bfetch\s*\(|openai|nemotron|nemo_retriever/i, "Phase A must contain no provider execution path");

console.log("Document extraction Phase A foundation regressions passed.");
