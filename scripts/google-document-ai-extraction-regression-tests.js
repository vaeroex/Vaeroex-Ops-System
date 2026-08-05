const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const loadedTypeScriptModules = new Map();

function loadTypeScriptModule(relative) {
  if (loadedTypeScriptModules.has(relative)) return loadedTypeScriptModules.get(relative);
  const output = ts.transpileModule(read(relative), {
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

const contracts = loadTypeScriptModule("lib/document-extraction/contracts.ts");
const {
  buildNormalizedDocumentExtractionArtifact,
  buildNormalizedDocumentExtractionArtifactV2,
  criticalFieldManifestForArtifactV2WithProvenance,
  parseAnyNormalizedDocumentExtractionArtifact
} = loadTypeScriptModule("lib/document-extraction/artifact.ts");
const {
  buildDocumentExtractionIdentityV2
} = loadTypeScriptModule("lib/document-extraction/identity.ts");
const {
  buildDocumentExtractionReviewProvenanceV2
} = loadTypeScriptModule("lib/document-extraction/review-provenance.ts");
const {
  createManagedDocumentExtractionEncryptionProvider
} = loadTypeScriptModule("lib/document-extraction/encryption.ts");
const {
  resolveDocumentExtractionProviderRuntimeContract
} = loadTypeScriptModule("lib/document-extraction/provider-profile.ts");
const { routeDocumentExtraction } = loadTypeScriptModule("lib/document-extraction/routing.ts");

const googleEnvironment = {
  DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE: contracts.GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  DOCUMENT_EXTRACTION_GOOGLE_PROJECT_NUMBER: "123456789012",
  DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID: "0123456789abcdef",
  DOCUMENT_EXTRACTION_GOOGLE_LOCATION: contracts.GOOGLE_DOCUMENT_EXTRACTION_LOCATION,
  DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION: contracts.GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION,
  DOCUMENT_EXTRACTION_GOOGLE_MODEL: contracts.GOOGLE_DOCUMENT_EXTRACTION_MODEL,
  DOCUMENT_EXTRACTION_GOOGLE_CLIENT_REVISION: contracts.GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  DOCUMENT_EXTRACTION_GOOGLE_PARSER_REVISION: contracts.GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION
};
const googleRuntime = resolveDocumentExtractionProviderRuntimeContract(googleEnvironment);
assert.deepEqual(googleRuntime, {
  parserProvider: "google_document_ai",
  parserModel: "pretrained-ocr-v2.1-2024-08-07",
  parserRevision: "google_document_ai_enterprise_ocr_v1",
  clientRevision: "vaeroex_google_document_ai_rest_v1",
  providerProfile: "google_document_ai_enterprise_ocr_v1",
  processorType: "OCR_PROCESSOR",
  processorResource: "projects/123456789012/locations/us/processors/0123456789abcdef/processorVersions/pretrained-ocr-v2.1-2024-08-07",
  processorLocation: "us",
  processorVersion: "pretrained-ocr-v2.1-2024-08-07",
  endpointContractVersion: "google_document_ai_processor_version_process_v1",
  requestSerializerVersion: "google_document_ai_process_request_v1",
  responseValidatorVersion: "google_document_ai_process_response_v2",
  providerNormalizationVersion: "google_document_ai_layout_normalization_v2",
  compatibilityPolicyVersion: "google_document_ai_enterprise_ocr_strict_v1",
  tablePolicyVersion: "tables_if_present_strict_v1",
  confidencePolicyVersion: "preserve_for_review_never_authority_v1",
  selectionMarkPolicyVersion: "disabled_v1",
  extractionContractVersion: "document_extraction_artifact_v2",
  artifactNormalizationVersion: "document_extraction_normalization_v2"
});
for (const override of [
  { DOCUMENT_EXTRACTION_GOOGLE_LOCATION: "eu" },
  { DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_VERSION: "latest" },
  { DOCUMENT_EXTRACTION_GOOGLE_PROCESSOR_ID: "invalid" },
  { DOCUMENT_EXTRACTION_GOOGLE_MODEL: "unbound-model" },
  { DOCUMENT_EXTRACTION_ACTIVE_PROVIDER_PROFILE: "google_document_ai_auto" }
]) {
  assert.throws(
    () => resolveDocumentExtractionProviderRuntimeContract({ ...googleEnvironment, ...override }),
    /document_extraction_provider_(?:contract_mismatch|profile_not_approved)/
  );
}

const routingBase = {
  sourceByteLength: 100_000,
  pageCount: 1,
  googleQualificationScopeApproved: true
};
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "csv",
  assessedClass: "csv",
  nativeTextAssessment: "not_applicable"
}).provider, "deterministic_spreadsheet");
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "pdf",
  assessedClass: "invoice_like",
  nativeTextAssessment: "reliable"
}).route, "native");
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "pdf",
  assessedClass: "digital_pdf",
  nativeTextAssessment: "low_quality"
}).route, "google_fallback");
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "pdf",
  assessedClass: "scanned_pdf",
  nativeTextAssessment: "missing"
}).route, "google_primary");
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "jpeg",
  assessedClass: "printed_document_photo",
  nativeTextAssessment: "not_applicable"
}).route, "google_primary");
for (const assessedClass of [
  "typed_form",
  "invoice_like",
  "receipt_like",
  "printed_table_document"
]) {
  assert.equal(routeDocumentExtraction({
    ...routingBase,
    sourceKind: "png",
    assessedClass,
    nativeTextAssessment: "not_applicable"
  }).route, "google_primary");
}
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "docx",
  assessedClass: "typed_form",
  nativeTextAssessment: "low_quality"
}).reason, "unsupported_source_class");
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "png",
  assessedClass: "screenshot",
  nativeTextAssessment: "not_applicable"
}).reason, "future_visual_provider_required");
for (const assessedClass of [
  "phone_photo",
  "whiteboard",
  "highly_handwritten_note",
  "mixed_scene_photo"
]) {
  assert.equal(routeDocumentExtraction({
    ...routingBase,
    sourceKind: "jpeg",
    assessedClass,
    nativeTextAssessment: "not_applicable"
  }).reason, "future_visual_provider_required");
}
assert.equal(routeDocumentExtraction({
  ...routingBase,
  sourceKind: "pdf",
  assessedClass: "scanned_pdf",
  nativeTextAssessment: "missing",
  googleQualificationScopeApproved: false
}).reason, "qualification_scope_required");
for (const bounds of [
  { sourceByteLength: 0 },
  { sourceByteLength: contracts.GOOGLE_DOCUMENT_EXTRACTION_MAX_FILE_BYTES + 1 },
  { pageCount: 0 },
  { pageCount: contracts.GOOGLE_DOCUMENT_EXTRACTION_MAX_PAGES + 1 }
]) {
  assert.equal(routeDocumentExtraction({
    ...routingBase,
    ...bounds,
    sourceKind: "pdf",
    assessedClass: "scanned_pdf",
    nativeTextAssessment: "missing"
  }).reason, "source_bounds_exceeded");
}

function layout(text, start, end, coordinates) {
  const { x, y, width, height } = coordinates;
  return {
    text,
    textSegments: text ? [{ start, end }] : [],
    confidence: 0.9,
    orientation: "PAGE_UP",
    coordinates: { page: 1, x, y, width, height },
    polygon: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ]
  };
}

function googleDraft() {
  const pageLayout = layout("Metric Value", 0, 12, { x: 0.05, y: 0.05, width: 0.9, height: 0.9 });
  const lineLayout = layout("Metric Value", 0, 12, { x: 0.1, y: 0.2, width: 0.8, height: 0.1 });
  const metricLayout = layout("Metric", 0, 6, { x: 0.1, y: 0.2, width: 0.35, height: 0.1 });
  const tableLayout = layout("Metric Value", 0, 12, { x: 0.08, y: 0.18, width: 0.84, height: 0.16 });
  const emptyCellLayout = layout("", 0, 0, { x: 0.5, y: 0.2, width: 0.4, height: 0.1 });
  const languages = [{ languageCode: "en", confidence: 0.98 }];
  return {
    route: "google_primary",
    documentClass: "printed_table_document",
    pageCount: 1,
    pages: [{
      page: 1,
      blocks: [{
        id: "page-1-element-1",
        kind: "table",
        text: "Metric Value",
        coordinates: tableLayout.coordinates
      }],
      structure: {
        structureVersion: "provider_neutral_document_structure_v1",
        pageLayout,
        detectedLanguages: languages,
        blocks: [{ id: "page-1-block-1", kind: "block", layout: lineLayout, detectedLanguages: languages }],
        paragraphs: [{ id: "page-1-paragraph-1", kind: "paragraph", layout: lineLayout, detectedLanguages: languages }],
        lines: [{ id: "page-1-line-1", kind: "line", layout: lineLayout, detectedLanguages: languages }],
        tokens: [{
          id: "page-1-token-1",
          kind: "token",
          layout: metricLayout,
          detectedLanguages: languages,
          detectedBreak: "SPACE"
        }],
        tables: [{
          id: "page-1-table-1",
          kind: "table",
          layout: tableLayout,
          detectedLanguages: languages,
          headerRows: [],
          bodyRows: [{
            id: "page-1-table-1-body-row-1",
            cells: [{
              id: "page-1-table-1-body-row-1-cell-1",
              layout: emptyCellLayout,
              rowSpan: 1,
              colSpan: 1,
              detectedLanguages: []
            }]
          }]
        }],
        selectionMarks: [],
        imageQuality: {
          qualityScore: 0.92,
          detectedDefects: [{ type: "quality/defect_faint", confidence: 0.1 }]
        }
      }
    }],
    criticalFields: [],
    validationFindings: []
  };
}

const artifact = buildNormalizedDocumentExtractionArtifactV2(googleDraft());
assert.equal(artifact.contractVersion, "document_extraction_artifact_v2");
assert.equal(artifact.normalizationVersion, "document_extraction_normalization_v2");
assert.deepEqual(parseAnyNormalizedDocumentExtractionArtifact(artifact), artifact);
assert.deepEqual(buildNormalizedDocumentExtractionArtifactV2(googleDraft()), artifact);
for (const mutate of [
  (draft) => { draft.route = "nvidia_primary"; },
  (draft) => { draft.pages[0].structure.selectionMarks = [{ selected: true }]; },
  (draft) => { draft.pages[0].structure.imageQuality.detectedDefects[0].type = "FAINT"; },
  (draft) => { draft.pages[0].structure.tables[0].bodyRows[0].cells[0].id = "page-1-block-1"; },
  (draft) => {
    draft.pages[0].structure.pageLayout.polygon[0].x = 0.5;
    draft.pages[0].structure.pageLayout.polygon[3].x = 0.5;
  }
]) {
  const draft = googleDraft();
  mutate(draft);
  assert.throws(() => buildNormalizedDocumentExtractionArtifactV2(draft));
}

const identityInput = {
  secret: new Uint8Array(32).fill(21),
  workspaceId: "11111111-1111-4111-8111-111111111111",
  fileBytes: new TextEncoder().encode("synthetic printed fixture"),
  route: "google_primary",
  documentClass: "printed_table_document",
  provider: googleRuntime.parserProvider,
  modelRevision: googleRuntime.parserRevision,
  clientRevision: googleRuntime.clientRevision,
  routingPolicyVersion: contracts.DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
  extractionContractVersion: googleRuntime.extractionContractVersion,
  normalizationVersion: googleRuntime.artifactNormalizationVersion,
  providerIdentity: {
    providerProfile: googleRuntime.providerProfile,
    processorType: googleRuntime.processorType,
    processorResource: googleRuntime.processorResource,
    processorLocation: googleRuntime.processorLocation,
    processorVersion: googleRuntime.processorVersion,
    endpointContractVersion: googleRuntime.endpointContractVersion,
    requestSerializerVersion: googleRuntime.requestSerializerVersion,
    responseValidatorVersion: googleRuntime.responseValidatorVersion,
    providerNormalizationVersion: googleRuntime.providerNormalizationVersion,
    compatibilityPolicyVersion: googleRuntime.compatibilityPolicyVersion,
    tablePolicyVersion: googleRuntime.tablePolicyVersion,
    confidencePolicyVersion: googleRuntime.confidencePolicyVersion,
    selectionMarkPolicyVersion: googleRuntime.selectionMarkPolicyVersion
  }
};
const identity = buildDocumentExtractionIdentityV2(identityInput);
assert.deepEqual(buildDocumentExtractionIdentityV2(identityInput), identity);
assert.notEqual(buildDocumentExtractionIdentityV2({
  ...identityInput,
  workspaceId: "22222222-2222-4222-8222-222222222222"
}).cacheKey, identity.cacheKey);
assert.notEqual(buildDocumentExtractionIdentityV2({
  ...identityInput,
  providerIdentity: { ...identityInput.providerIdentity, processorResource: identityInput.providerIdentity.processorResource.replace("0123456789abcdef", "fedcba9876543210") }
}).cacheKey, identity.cacheKey);

const reviewInput = {
  workspaceId: identityInput.workspaceId,
  jobId: "33333333-3333-4333-8333-333333333333",
  cacheKey: identity.cacheKey,
  contentFingerprint: artifact.artifactFingerprint,
  pageCount: 1,
  processorResource: googleRuntime.processorResource
};
const review = buildDocumentExtractionReviewProvenanceV2(reviewInput);
assert.deepEqual(buildDocumentExtractionReviewProvenanceV2(reviewInput), review);
assert.notEqual(buildDocumentExtractionReviewProvenanceV2({
  ...reviewInput,
  jobId: "44444444-4444-4444-8444-444444444444"
}).reviewProvenanceFingerprint, review.reviewProvenanceFingerprint);
assert.notEqual(buildDocumentExtractionReviewProvenanceV2({
  ...reviewInput,
  processorResource: reviewInput.processorResource.replace("0123456789abcdef", "fedcba9876543210")
}).reviewProvenanceFingerprint, review.reviewProvenanceFingerprint);
const manifest = criticalFieldManifestForArtifactV2WithProvenance(
  artifact,
  review.provenance,
  review.reviewProvenanceFingerprint
);
assert.equal(manifest.manifest_version, "document_extraction_critical_fields_v3");
assert.equal(manifest.review_provenance_fingerprint, review.reviewProvenanceFingerprint);
assert.equal(manifest.artifact_fingerprint, artifact.artifactFingerprint);

const historicalArtifact = buildNormalizedDocumentExtractionArtifact({
  route: "nvidia_primary",
  documentClass: "scanned_pdf",
  pageCount: 1,
  pages: [{ page: 1, blocks: [{ id: "page-1-text-1", kind: "text", text: "Historical", coordinates: null }] }],
  criticalFields: [],
  validationFindings: []
});
assert.deepEqual(parseAnyNormalizedDocumentExtractionArtifact(historicalArtifact), historicalArtifact);

const migration = read("supabase/migrations/20260805163333_google_document_ai_enterprise_ocr_v1.sql");
for (const invariant of [
  /google_document_ai_enterprise_ocr_v1/,
  /pretrained-ocr-v2[.]1-2024-08-07/,
  /google_document_ai_process_response_v2/,
  /document_extraction_artifact_v2/,
  /document_extraction_normalization_v2/,
  /page_count between 1 and 15/,
  /max_attempts = 1/,
  /and review_required/,
  /document_extraction_jobs_one_active_provider_per_workspace_idx/,
  /security definer[\s\S]+set search_path = ''/,
  /revoke execute on function public[.]document_extraction_runtime_reason_v2[\s\S]+from public, anon, authenticated, service_role/
]) assert.match(migration, invariant);
assert.doesNotMatch(migration, /\b(?:drop table|drop column|truncate|delete from|update public[.]|insert into public[.])\b/i);
assert.doesNotMatch(migration, /grant\s+(?:execute|select|insert|update|delete)/i);
assert.doesNotMatch(migration, /(?:globally_enabled|worker_enabled|provider_calls_enabled|is_entitled|is_enabled)\s*=\s*true/i);
assert.doesNotMatch(migration, /create or replace function public[.](?:enqueue|claim|authorize|complete|mutate)_document_extraction/i);

const architectureDoc = read("docs/architecture/google-document-ai-enterprise-ocr-v1.md");
assert.match(architectureDoc, /first 1,000 Enterprise OCR pages per account[\s\S]+at no charge/);
assert.match(architectureDoc, /marginal paid-tier cost of approximately \$0[.]0015/);
assert.doesNotMatch(architectureDoc, /one-page qualification is therefore approximately \$0[.]0015/);

const activeRunner = read("services/document-extraction-worker/src/vaeroex_document_worker/runner.py");
const activeContract = read("services/document-extraction-worker/src/vaeroex_document_worker/provider_contract.py");
const brokerService = read("lib/document-extraction/broker-service.ts");
assert.doesNotMatch(activeRunner, /google_document_ai/);
assert.doesNotMatch(brokerService, /google_document_ai|google_primary|google_fallback/);
assert.match(activeContract, /return HOSTED_CONTRACT/);
assert.doesNotMatch(activeContract, /GoogleDocumentAiContract/);
for (const authorityFile of [
  "lib/ai/evidence-index.ts",
  "lib/intelligence/snapshot/v1/builder.ts",
  "app/app/sources/business-notes/actions.ts",
  "lib/ai/business-health-explanation/service.ts",
  "lib/ai/trust/workflows/business-health.ts"
]) {
  const source = read(authorityFile);
  assert.doesNotMatch(source, /google_document_ai|document_extraction_artifact_v2|google_primary|google_fallback/);
}

async function verifyEncryption() {
  const key = new Uint8Array(32).fill(29);
  const provider = createManagedDocumentExtractionEncryptionProvider(
    { currentKeyVersion: "test-key-v1", keys: new Map([["test-key-v1", key]]) },
    { nonceFactory: () => new Uint8Array(12).fill(7) }
  );
  const context = {
    workspaceId: identityInput.workspaceId,
    cacheKey: identity.cacheKey,
    artifactFingerprint: artifact.artifactFingerprint,
    extractionContractVersion: artifact.contractVersion,
    normalizationVersion: artifact.normalizationVersion
  };
  const envelope = await provider.encrypt(artifact, context);
  assert.deepEqual(await provider.decrypt(envelope, context), artifact);
  for (const changed of [
    { workspaceId: "22222222-2222-4222-8222-222222222222" },
    { cacheKey: "f".repeat(64) },
    { extractionContractVersion: "document_extraction_artifact_v3" },
    { normalizationVersion: "document_extraction_normalization_v3" }
  ]) {
    await assert.rejects(() => provider.decrypt(envelope, { ...context, ...changed }));
  }
}

verifyEncryption()
  .then(() => console.log("Google Document AI inert extraction regressions passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
