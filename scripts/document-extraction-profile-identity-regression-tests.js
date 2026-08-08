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
  buildNormalizedDocumentExtractionArtifact,
  criticalFieldManifestForArtifact,
  criticalFieldManifestForArtifactWithProvenance
} = loadTypeScriptModule("lib/document-extraction/artifact.ts");
const {
  buildDocumentExtractionReviewProvenance,
  documentExtractionReviewProvenanceFingerprint
} = loadTypeScriptModule("lib/document-extraction/review-provenance.ts");

const artifact = buildNormalizedDocumentExtractionArtifact({
  route: "nvidia_primary",
  documentClass: "scanned_pdf",
  pageCount: 1,
  pages: [{
    page: 1,
    blocks: [{ id: "page-1-text-1", kind: "text", text: "Synthetic extraction", coordinates: null }]
  }],
  criticalFields: [],
  validationFindings: []
});
const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  cacheKey: "a".repeat(64),
  contentFingerprint: artifact.artifactFingerprint,
  pageCount: 1,
  parserRevision: "nemotron_parse_hosted_tool_call_rest_v2",
  clientRevision: "vaeroex_nemotron_parse_rest_v2",
  providerProfile: "hosted_tool_call_v2",
  endpointContractVersion: "nvidia_build_nemotron_parse_hosted_tool_call_v2",
  requestSerializerVersion: "nemotron_parse_hosted_request_v1",
  responseValidatorVersion: "nemotron_parse_hosted_response_v2",
  providerNormalizationVersion: "nemotron_parse_hosted_normalization_v1",
  compatibilityPolicyVersion: "hosted_tool_call_v2",
  modelAlias: "nvidia/nemotron-parse"
};

const v2 = buildDocumentExtractionReviewProvenance(base);
assert.deepEqual(
  buildDocumentExtractionReviewProvenance(base),
  v2,
  "identical content and provenance must be stable"
);

const hostedV1 = buildDocumentExtractionReviewProvenance({
  ...base,
  parserRevision: "nemotron_parse_hosted_tool_call_rest_v1",
  clientRevision: "vaeroex_nemotron_parse_rest_v1",
  providerProfile: "hosted_tool_call",
  endpointContractVersion: "nvidia_build_nemotron_parse_hosted_tool_call_v1",
  responseValidatorVersion: "nemotron_parse_hosted_response_v1",
  compatibilityPolicyVersion: "hosted_tool_call_v1"
});
assert.equal(
  hostedV1.provenance.content_fingerprint,
  v2.provenance.content_fingerprint,
  "normalized content equality remains independent of provider provenance"
);
assert.notEqual(
  hostedV1.reviewProvenanceFingerprint,
  v2.reviewProvenanceFingerprint,
  "hosted v1 and hosted v2 review provenance must never collide"
);

for (const [field, value] of [
  ["parserRevision", "parser-v3"],
  ["clientRevision", "client-v3"],
  ["providerProfile", "hosted_tool_call_v3"],
  ["endpointContractVersion", "endpoint-contract-v3"],
  ["requestSerializerVersion", "request-serializer-v2"],
  ["responseValidatorVersion", "response-validator-v3"],
  ["providerNormalizationVersion", "provider-normalization-v2"],
  ["compatibilityPolicyVersion", "compatibility-v3"],
  ["modelAlias", "nvidia/nemotron-parse-v3"],
  ["pageCount", 2],
  ["cacheKey", "b".repeat(64)],
  ["workspaceId", "33333333-3333-4333-8333-333333333333"],
  ["jobId", "44444444-4444-4444-8444-444444444444"]
]) {
  const changed = buildDocumentExtractionReviewProvenance({ ...base, [field]: value });
  assert.notEqual(
    changed.reviewProvenanceFingerprint,
    v2.reviewProvenanceFingerprint,
    `${field} must be review-provenance bound`
  );
}

assert.notEqual(
  documentExtractionReviewProvenanceFingerprint({ ...v2.provenance, review_version: 2 }),
  v2.reviewProvenanceFingerprint,
  "review contract changes must alter review provenance"
);
assert.notEqual(
  documentExtractionReviewProvenanceFingerprint({
    ...v2.provenance,
    artifact_normalization_version: "document_extraction_normalization_v2"
  }),
  v2.reviewProvenanceFingerprint,
  "artifact normalization changes must alter review provenance"
);

const historicalManifest = criticalFieldManifestForArtifact(artifact);
const v2Manifest = criticalFieldManifestForArtifactWithProvenance(
  artifact,
  v2.provenance,
  v2.reviewProvenanceFingerprint
);
assert.equal(historicalManifest.manifest_version, "document_extraction_critical_fields_v1");
assert.equal(v2Manifest.manifest_version, "document_extraction_critical_fields_v2");
assert.equal(v2Manifest.artifact_fingerprint, historicalManifest.artifact_fingerprint);
assert.equal(v2Manifest.review_provenance_fingerprint, v2.reviewProvenanceFingerprint);
assert.deepEqual(v2Manifest.fields, historicalManifest.fields);

const migrationName = fs.readdirSync(path.join(root, "supabase/migrations"))
  .find((name) => name.endsWith("_document_extraction_profile_bound_review_identity.sql"));
assert.ok(migrationName, "the profile-bound review identity migration must exist");
const migration = read(`supabase/migrations/${migrationName}`);
const brokerStore = read("lib/document-extraction/broker-store.ts");
const brokerService = read("lib/document-extraction/broker-service.ts");

for (const invariant of [
  /add column if not exists review_provenance_fingerprint text/,
  /document_extraction_critical_fields_v2/,
  /validate_document_extraction_review_provenance_v1/,
  /validate_document_extraction_critical_field_manifest_v2/,
  /complete_document_extraction_job_v3/,
  /mutate_document_extraction_review_v2/,
  /current_setting\('vaeroex\.document_extraction_review_provenance', true\)/,
  /job\.review_provenance_fingerprint is null[\s\S]+review\.review_provenance_fingerprint is null/,
  /review\.review_provenance_fingerprint = job\.review_provenance_fingerprint/,
  /Hosted tool-call v2 requires a provenance-bound manifest/,
  /Hosted tool-call v2 requires review-provenance completion/,
  /from public, anon, authenticated, service_role/
]) assert.match(migration, invariant);

assert.doesNotMatch(migration, /\b(drop table|truncate table|delete from)\b/i);
assert.doesNotMatch(migration, /insert into public\.document_extraction_(jobs|reviews)\s*\(/i);
assert.doesNotMatch(migration, /grant execute[^;]+complete_document_extraction_job_v3[^;]+authenticated/is);
assert.doesNotMatch(migration, /grant execute[^;]+mutate_document_extraction_review_v2[^;]+service_role/is);
assert.doesNotMatch(migration, /business_memory|business_health|intelligence_snapshot|saved_analys|trust_/i);
assert.match(brokerStore, /"complete_document_extraction_job_v3"/);
assert.match(brokerService, /buildDocumentExtractionReviewProvenance/);
assert.match(brokerService, /criticalFieldManifestForArtifactWithProvenance/);
assert.doesNotMatch(brokerService, /business_memory|business_health|intelligence_snapshot|saved_analys|trust_/i);

const generatedTypes = read("lib/supabase/types.ts");
assert.match(generatedTypes, /review_provenance_fingerprint: string \| null/);
assert.match(generatedTypes, /complete_document_extraction_job_v3/);
assert.match(generatedTypes, /mutate_document_extraction_review_v2/);

console.log("Document extraction profile-bound identity regressions passed.");
