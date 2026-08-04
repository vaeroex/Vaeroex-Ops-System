const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migrationName = fs.readdirSync(path.join(root, "supabase/migrations"))
  .find((name) => name.endsWith("_document_extraction_private_worker_phase_b.sql"));
assert.ok(migrationName, "the canonical Phase B migration must exist");
const migration = read(`supabase/migrations/${migrationName}`);
const circuitMigration = read("supabase/migrations/20260803181405_document_extraction_dispatch_unknown_circuit.sql");
const correctiveMigration = read("supabase/migrations/20260803204552_document_extraction_private_worker_phase_b_security_fixes.sql");
const dispatchSingleUseMigration = read("supabase/migrations/20260803205520_document_extraction_dispatch_authorization_single_use.sql");
const restAdapterMigration = read("supabase/migrations/20260803230226_document_extraction_rest_adapter_contract.sql");
const phaseC1Migration = read("supabase/migrations/20260804010000_document_extraction_worker_phase_c1_protocol.sql");
const route = read("app/api/internal/document-extraction/broker/route.ts");
const brokerHttp = read("lib/document-extraction/broker-http.ts");
const service = read("lib/document-extraction/broker-service.ts");
const policy = read("lib/document-extraction/runtime-policy.ts");
const encryption = read("lib/document-extraction/encryption.ts");
const workerConfig = read("services/document-extraction-worker/src/vaeroex_document_worker/config.py");
const workerProviderContract = read("services/document-extraction-worker/src/vaeroex_document_worker/provider_contract.py");
const workerProvider = read("services/document-extraction-worker/src/vaeroex_document_worker/rest_adapter.py");
const workerRenderer = read("services/document-extraction-worker/src/vaeroex_document_worker/renderer.py");
const workerRendererSubprocess = read("services/document-extraction-worker/src/vaeroex_document_worker/renderer_subprocess.py");
const workerRunner = read("services/document-extraction-worker/src/vaeroex_document_worker/runner.py");
const workerDaemon = read("services/document-extraction-worker/src/vaeroex_document_worker/daemon.py");
const workerDockerfile = read("services/document-extraction-worker/Dockerfile");
const workerProject = read("services/document-extraction-worker/pyproject.toml");
const dependencyRequirements = read("services/document-extraction-worker/requirements.txt");
const dependencyLock = read("services/document-extraction-worker/requirements.lock");
const buildRequirements = read("services/document-extraction-worker/build-requirements.txt");
const buildLock = read("services/document-extraction-worker/build-requirements.lock");
const dependencyInstaller = read("services/document-extraction-worker/install-worker-dependencies.sh");
const dependencyLicenses = read("services/document-extraction-worker/THIRD_PARTY_LICENSES.md");
const dependencySbom = JSON.parse(read("services/document-extraction-worker/sbom.cdx.json"));
const generatedTypes = read("lib/supabase/types.ts");

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
  documentExtractionAadDigest,
  encryptDocumentExtractionBytes,
  decryptDocumentExtractionBytes
} = loadTypeScriptModule("lib/document-extraction/crypto-core.ts");
const {
  buildNormalizedDocumentExtractionArtifact,
  parseNormalizedDocumentExtractionArtifact
} = loadTypeScriptModule("lib/document-extraction/artifact.ts");
const {
  canonicalWorkerAssertionPayload,
  verifyWorkerAssertion
} = loadTypeScriptModule("lib/document-extraction/broker-auth.ts");
const {
  createFileCapability,
  createFileGrantSecret,
  createLeaseCapability,
  verifyBrokerCapability
} = loadTypeScriptModule("lib/document-extraction/broker-capability.ts");
const {
  createManagedDocumentExtractionEncryptionProvider,
  loadManagedDocumentExtractionKeyring,
  rotateDocumentExtractionEncryption
} = loadTypeScriptModule("lib/document-extraction/encryption.ts");
const {
  assertDocumentExtractionProviderGateEnabled,
  assertDocumentExtractionProviderDispatchEnabled,
  resolveDocumentExtractionExecutionPolicy
} = loadTypeScriptModule("lib/document-extraction/runtime-policy.ts");
const {
  persistWithDocumentExtractionNonceRetry
} = loadTypeScriptModule("lib/document-extraction/nonce-retry.ts");

for (const table of [
  "document_extraction_worker_assertions",
  "document_extraction_file_access_grants",
  "document_extraction_operational_telemetry"
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated, service_role`));
  assert.doesNotMatch(migration, new RegExp(`grant (select|insert|update|delete)[^;]+${table}`, "is"));
}

for (const operation of [
  "consume_document_extraction_worker_assertion_v1",
  "claim_document_extraction_job_v2",
  "resolve_document_extraction_job_lease_v1",
  "advance_document_extraction_job_v2",
  "issue_document_extraction_file_grant_v1",
  "consume_document_extraction_file_grant_v1",
  "authorize_document_extraction_dispatch_v2",
  "record_document_extraction_provider_outcome_v1",
  "authorize_document_extraction_retry_dispatch_v1",
  "complete_document_extraction_job_v2",
  "fail_document_extraction_job_v2",
  "record_document_extraction_telemetry_v1"
]) {
  assert.match(migration, new RegExp(`create or replace function public\\.${operation}`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${operation}[^;]+to service_role`, "s"));
  assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${operation}[^;]+to (?:anon|authenticated)`, "s"));
}

assert.match(migration, /for update of job skip locked/i);
assert.match(migration, /job\.route in \('nvidia_primary', 'nvidia_fallback'\)/);
assert.match(migration, /job\.review_required/);
assert.match(migration, /job\.page_count between 1 and 16/);
assert.match(migration, /intake\.file_size_bytes between 1 and 25000000/);
assert.match(migration, /job\.parser_model = 'nvidia\/nemotron-parse'/);
assert.match(migration, /job\.client_revision = '52886112cafab4c4bca1cda0d4f588785adfe4d3'/);
assert.match(migration, /provider_call_count between 0 and 2/);
assert.match(migration, /retry_count between 0 and 1/);
assert.match(migration, /p_result_class = 'ambiguous_dispatch'/);
assert.match(migration, /v_system\.consecutive_failures >= 3/);
assert.match(migration, /v_system\.rolling_failure_count >= 5/);
assert.match(migration, /Document extraction telemetry is append-only/);
assert.match(migration, /p_expires_at > p_asserted_at \+ interval '90 seconds'/);
assert.match(migration, /Worker assertion replay detected/);
assert.match(migration, /v_grant\.consumed_at is not null/);
assert.match(migration, /v_intake\.storage_path not like v_job\.workspace_id::text \|\| '\/%'/);
assert.doesNotMatch(migration, /insert into public\.document_extraction_workspace_settings/i);
assert.doesNotMatch(migration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);
assert.match(circuitMigration, /open_document_extraction_circuit_on_dispatch_unknown_v1/);
assert.match(circuitMigration, /new\.status = 'dispatch_unknown'/);
assert.match(circuitMigration, /circuit_state = 'open'/);
assert.match(circuitMigration, /circuit_reason_code = 'ambiguous_dispatch'/);
assert.match(circuitMigration, /event_type|provider_circuit_opened/);
assert.match(
  circuitMigration,
  /revoke execute on function public\.open_document_extraction_circuit_on_dispatch_unknown_v1\(\)[\s\S]+service_role/
);
assert.doesNotMatch(circuitMigration, /grant execute/i);
assert.doesNotMatch(circuitMigration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);

for (const table of [
  "document_extraction_provider_outcomes",
  "document_extraction_circuit_events"
]) {
  assert.match(correctiveMigration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(correctiveMigration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(correctiveMigration, new RegExp(`revoke all privileges on table public\\.${table}`));
  assert.doesNotMatch(correctiveMigration, new RegExp(`grant (?:select|insert|update|delete)[^;]+${table}`, "is"));
}
for (const stage of [
  "queued", "leased", "preparing", "dispatching", "provider_dispatched",
  "extracting", "normalizing", "validating", "encrypting", "awaiting_review",
  "classifying", "promoting", "terminal"
]) {
  assert.match(correctiveMigration, new RegExp(`'${stage}'`));
}
assert.match(correctiveMigration, /document_extraction_cache_key_version_nonce_unique_idx/);
assert.match(correctiveMigration, /encryption_key_version, encryption_nonce/);
assert.match(correctiveMigration, /result_class <> 'success'[\s\S]+interval '10 minutes'/);
assert.match(correctiveMigration, /v_consecutive >= 3/);
assert.match(correctiveMigration, /v_rolling >= 5/);
assert.match(correctiveMigration, /failure_window_reset_at/);
assert.match(correctiveMigration, /Document extraction security ledgers are append-only/);
assert.match(correctiveMigration, /v_constraint = 'document_extraction_cache_key_version_nonce_unique_idx'/);
assert.match(correctiveMigration, /'completed', false, 'reason', 'nonce_collision'/);
assert.match(correctiveMigration, /v_reason := public\.document_extraction_runtime_reason_v1[\s\S]+stage = 'provider_dispatched'/);
assert.doesNotMatch(correctiveMigration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);
assert.match(dispatchSingleUseMigration, /'authorized', false,[\s\S]+'dispatch_already_authorized'/);
assert.match(dispatchSingleUseMigration, /'idempotent', true/);
assert.match(
  dispatchSingleUseMigration,
  /revoke execute on function public\.authorize_document_extraction_dispatch_v2\(uuid, text, uuid\)[\s\S]+grant execute[\s\S]+to service_role/
);
assert.doesNotMatch(dispatchSingleUseMigration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);
assert.match(restAdapterMigration, /job\.parser_revision = 'nemotron_parse_hosted_tool_call_rest_v1'/);
assert.match(restAdapterMigration, /job\.client_revision = 'vaeroex_nemotron_parse_rest_v1'/);
assert.match(restAdapterMigration, /v_job\.parser_revision <> 'nemotron_parse_hosted_tool_call_rest_v1'/);
assert.match(restAdapterMigration, /v_job\.client_revision <> 'vaeroex_nemotron_parse_rest_v1'/);
assert.match(restAdapterMigration, /security definer[\s\S]+set search_path = ''/);
assert.match(
  restAdapterMigration,
  /revoke execute on function public\.claim_document_extraction_job_v2\(text, integer\)[\s\S]+grant execute[\s\S]+to service_role/
);
assert.match(
  restAdapterMigration,
  /revoke execute on function public\.authorize_document_extraction_dispatch_v2\(uuid, text, uuid\)[\s\S]+grant execute[\s\S]+to service_role/
);
assert.doesNotMatch(restAdapterMigration, /insert into public\.document_extraction_workspace_settings/i);
assert.doesNotMatch(restAdapterMigration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);
assert.match(phaseC1Migration, /broker_protocol_version = 'document_extraction_broker_v2'/);
assert.match(phaseC1Migration, /worker_runtime_version = 'document_extraction_worker_v2'/);
assert.match(phaseC1Migration, /create or replace function public\.check_document_extraction_provider_boundary_v1/);
assert.match(phaseC1Migration, /p_boundary not in \('asset_create', 'asset_upload', 'inference'\)/);
assert.match(phaseC1Migration, /security definer[\s\S]+set search_path = ''/);
assert.match(
  phaseC1Migration,
  /revoke execute on function public\.check_document_extraction_provider_boundary_v1\(uuid, text, text\)[\s\S]+grant execute[\s\S]+to service_role/
);
assert.doesNotMatch(phaseC1Migration, /grant execute[^;]+to (?:anon|authenticated)/i);
assert.doesNotMatch(phaseC1Migration, /\b(delete|truncate)\s+(?:table\s+)?public\./i);
assert.doesNotMatch(phaseC1Migration, /insert into public\.document_extraction_(?:workspace_settings|system_state)/i);

assert.match(route, /handleDocumentExtractionBrokerHttpRequest/);
assert.match(brokerHttp, /verifyWorkerAssertion/);
assert.match(brokerHttp, /consumeWorkerAssertion/);
assert.match(brokerHttp, /authorization\.startsWith\("Bearer "\)/);
assert.match(brokerHttp, /createSignedUrl\(source\.storage_path, 30\)/);
assert.match(brokerHttp, /handleGet[\s\S]+assertDocumentExtractionProviderDispatchEnabled/);
assert.doesNotMatch(route, /NVIDIA_API_KEY|nemo_retriever|create_ingestor/);
assert.match(service, /buildNormalizedDocumentExtractionArtifact/);
assert.match(service, /createManagedDocumentExtractionEncryptionProvider/);
assert.match(service, /artifact\.route !== context\.route/);
assert.match(service, /workspaceId: context\.workspace_id/);
assert.match(service, /assertDocumentExtractionProviderGateEnabled\(environment, runtimeEnvironment\)/);
assert.match(service, /issue_file_access[\s\S]+assertDocumentExtractionProviderDispatchEnabled\(environment, runtimeEnvironment\)/);
assert.match(service, /persistWithDocumentExtractionNonceRetry/);
assert.doesNotMatch(service, /console\.(log|error)|JSON\.stringify\(artifact/);

assert.match(policy, /privateWorkerEnabled: false/);
assert.match(policy, /providerExecutionEnabled: false/);
assert.match(policy, /syntheticQualificationEnabled: false/);
assert.match(policy, /DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL/);
assert.match(policy, /DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION/);
assert.match(encryption, /DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON/);
assert.match(encryption, /keys\.length > 3|entries\.length > 3/);
assert.doesNotMatch(encryption, /fallback|defaultKey|hard.?coded/i);

assert.match(workerConfig, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(workerConfig, /DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON/);
assert.match(workerConfig, /SUPABASE_URL/);
assert.match(workerConfig, /AWS_SECRET_ACCESS_KEY/);
assert.match(workerConfig, /AZURE_STORAGE_CONNECTION_STRING/);
assert.match(workerConfig, /GOOGLE_APPLICATION_CREDENTIALS/);
assert.match(workerConfig, /VERCEL_BLOB_READ_WRITE_TOKEN/);
assert.match(workerConfig, /Production document extraction approval is absent/);
assert.match(workerProviderContract, /REST_ADAPTER_VERSION = "vaeroex_nemotron_parse_rest_v1"/);
assert.match(workerProviderContract, /HOSTED_CONTRACT_VERSION = "nvidia_build_nemotron_parse_hosted_tool_call_v1"/);
assert.match(workerProviderContract, /V1_2_CONTRACT_VERSION = "nemotron_parse_v1_2_openai_chat_v1"/);
assert.match(workerProviderContract, /return HOSTED_CONTRACT/);
assert.match(workerProvider, /class NvidiaNemotronParseRestAdapter/);
assert.match(workerProvider, /NVCF-INPUT-ASSET-REFERENCES/);
assert.match(workerProvider, /"tools".*"markdown_bbox"/s);
assert.match(workerProvider, /trust_env=False/);
assert.match(workerProvider, /follow_redirects=False/);
assert.match(workerProvider, /provider_pending_without_approved_poll_contract/);
assert.match(workerProvider, /provider_dispatch_ambiguous/);
assert.match(workerProvider, /MAX_PROVIDER_RESPONSE_BYTES/);
assert.match(workerRenderer, /subprocess\.run/);
assert.match(workerRenderer, /RLIMIT_CPU/);
assert.match(workerRenderer, /RLIMIT_AS/);
assert.match(workerRendererSubprocess, /pypdfium2/);
assert.match(workerRendererSubprocess, /Image\.DecompressionBombWarning/);
assert.match(workerRunner, /authorize_dispatch/);
assert.equal((workerRunner.match(/"operation": "authorize_dispatch"/g) || []).length, 1);
assert.match(workerRunner, /dispatch_already_authorized/);
assert.match(workerRunner, /authorize_retry/);
assert.equal((workerRunner.match(/"operation": "authorize_retry"/g) || []).length, 1);
assert.match(workerRunner, /retry RPC is the atomic second-call claim/);
assert.match(workerRunner, /provider_outcome/);
assert.match(workerRunner, /check_provider_boundary/);
assert.match(workerDaemon, /Single-concurrency Cloud Run worker-pool process/);
assert.match(workerDaemon, /await run_one_job\([\s\S]+config,[\s\S]+progress_callback=/);
assert.match(workerDockerfile, /python:3\.12\.11-slim-bookworm@sha256:/);
assert.match(workerDockerfile, /USER 10001:10001/);
assert.doesNotMatch(workerProject, /tool\.vercel|workflow/i);
for (const dependency of [
  "cryptography==50.0.0",
  "httpx==0.28.1",
  "Pillow==12.3.0",
  "pypdfium2==5.12.1"
]) {
  assert.match(dependencyRequirements, new RegExp(`^${dependency.replace(".", "\\.")}$`, "m"));
}
for (const dependency of [
  "cryptography==50.0.0",
  "pillow==12.3.0",
  "pypdfium2==5.12.1"
]) {
  assert.match(dependencyLock.toLowerCase(), new RegExp(`^${dependency.replace(".", "\\.")}\\b`, "m"));
}
for (const removed of ["nemo-retriever", "ray", "starlette", "nltk", "open-clip", "torch"]) {
  assert.doesNotMatch(`${workerProject}\n${dependencyRequirements}\n${dependencyLock}`.toLowerCase(), new RegExp(`(^|[^a-z0-9_-])${removed}([^a-z0-9_-]|$)`));
}
assert.match(dependencyInstaller, /--require-hashes/);
assert.match(dependencyInstaller, /requirements\.lock/);
assert.match(dependencyInstaller, /build-requirements\.lock/);
assert.match(dependencyInstaller, /pip check/);
assert.deepEqual(
  buildRequirements.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")),
  ["pip==26.2"]
);
assert.match(buildLock, /^pip==26\.2 \\/m);
assert.match(buildLock, /--hash=sha256:/);
assert.ok(
  dependencyInstaller.indexOf("build-requirements.lock") < dependencyInstaller.indexOf("requirements.lock"),
  "patched hash-locked build tooling must install before runtime dependencies"
);

const normalizePackageName = (name) => name.toLowerCase().replace(/[_.-]+/g, "-");
const lockedPackages = new Map(
  [...`${dependencyLock}\n${buildLock}`.matchAll(/^([A-Za-z0-9_.-]+)==([^\s\\]+)/gm)]
    .map((match) => [normalizePackageName(match[1]), match[2]])
);
const sbomPackages = new Map(
  dependencySbom.components.map((component) => [normalizePackageName(component.name), component.version])
);
assert.equal(dependencySbom.specVersion, "1.6");
assert.equal(dependencySbom.metadata.component.name, "vaeroex-document-extraction-worker");
assert.deepEqual([...sbomPackages.entries()].sort(), [...lockedPackages.entries()].sort());
for (const [name, version] of lockedPackages) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    dependencyLicenses,
    new RegExp(`^\\| ${name.replace(/-/g, "[-_]")} \\| ${escapedVersion} \\|`, "mi")
  );
}
assert.equal(fs.existsSync(path.join(root, "services/document-extraction-worker/src/vaeroex_document_worker/official_client.py")), false);
assert.doesNotMatch(
  [workerConfig, workerProviderContract, workerProvider, workerRenderer, workerRendererSubprocess, workerRunner].join("\n"),
  /nemo_retriever|create_ingestor|_resolve_nemotron_parse_contract|\bimport ray\b|\bimport nltk\b|\bimport torch\b/
);
assert.doesNotMatch(
  [workerConfig, workerProvider, workerRunner].join("\n"),
  /^\s*print\(|logging\.(?:debug|info).*text|raw_response/im
);

assert.deepEqual(resolveDocumentExtractionExecutionPolicy({}), {
  environment: "development",
  brokerEnabled: false,
  providerExecutionEnabled: false,
  syntheticQualificationEnabled: false,
  productionApprovalValid: true
});
assert.equal(resolveDocumentExtractionExecutionPolicy({
  VERCEL_ENV: "production",
  DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED: "true",
  DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED: "true"
}).providerExecutionEnabled, false);
assert.throws(
  () => assertDocumentExtractionProviderGateEnabled({
    VERCEL_ENV: "preview",
    DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED: "true",
    DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED: "false"
  }),
  /provider_execution_disabled/
);
assert.throws(
  () => assertDocumentExtractionProviderDispatchEnabled({
    VERCEL_ENV: "production",
    DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED: "true",
    DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED: "true"
  }),
  /provider_execution_disabled/
);
assert.doesNotThrow(() => assertDocumentExtractionProviderDispatchEnabled({
  VERCEL_ENV: "production",
  DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED: "true",
  DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED: "true",
  DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL: "document_extraction_production_pilot_v1",
  DOCUMENT_EXTRACTION_NVIDIA_MODEL: "nvidia/nemotron-parse",
  DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION: "vaeroex_nemotron_parse_rest_v1",
  DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION: "nemotron_parse_hosted_tool_call_rest_v1",
  NVIDIA_API_KEY: "test-only-placeholder"
}));

for (const generatedSymbol of [
  "document_extraction_circuit_events",
  "document_extraction_provider_outcomes",
  "document_extraction_worker_assertions",
  "document_extraction_file_access_grants",
  "document_extraction_operational_telemetry",
  "claim_document_extraction_job_v2",
  "complete_document_extraction_job_v2",
  "record_document_extraction_telemetry_v1"
]) {
  assert.match(generatedTypes, new RegExp(generatedSymbol));
}
assert.match(generatedTypes, /failure_window_reset_at: string/);

const normalizedDraft = {
  route: "nvidia_primary",
  documentClass: "scanned_pdf",
  pageCount: 1,
  pages: [{
    page: 1,
    blocks: [{ id: "page-1-text-1", kind: "text", text: "Synthetic extraction", coordinates: null }]
  }],
  criticalFields: [],
  validationFindings: []
};
const normalizedArtifact = buildNormalizedDocumentExtractionArtifact(normalizedDraft);
assert.equal(parseNormalizedDocumentExtractionArtifact(normalizedArtifact).artifactFingerprint, normalizedArtifact.artifactFingerprint);
assert.throws(
  () => buildNormalizedDocumentExtractionArtifact({ ...normalizedDraft, rawProviderResponse: { text: "must not persist" } }),
  /Invalid normalized extraction artifact/
);
assert.throws(
  () => buildNormalizedDocumentExtractionArtifact({
    ...normalizedDraft,
    pages: [{
      page: 1,
      blocks: [{
        id: "page-1-text-1",
        kind: "text",
        text: "Synthetic extraction",
        coordinates: null,
        providerMetadata: "must not persist"
      }]
    }]
  }),
  /Invalid normalized extraction block/
);
assert.throws(
  () => buildNormalizedDocumentExtractionArtifact({
    ...normalizedDraft,
    criticalFields: [{
      id: "field-1",
      kind: "invented_provider_field",
      value: "synthetic",
      normalizedValue: "synthetic",
      page: 1,
      coordinates: null,
      confidence: 1,
      validationReasonCodes: []
    }]
  }),
  /Invalid normalized critical-field identity/
);
assert.throws(
  () => parseNormalizedDocumentExtractionArtifact({
    ...normalizedArtifact,
    pages: [{ ...normalizedArtifact.pages[0], blocks: [{ ...normalizedArtifact.pages[0].blocks[0], text: "Changed" }] }]
  }),
  /fingerprint is invalid/
);

const assertionNow = Date.now();
const assertionTimestamp = String(Math.floor(assertionNow / 1_000));
const assertionNonce = "1".repeat(32);
const assertionBody = Buffer.from('{"operation":"health"}', "utf8");
const assertionTarget = "/api/internal/document-extraction/broker";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const assertionCanonical = canonicalWorkerAssertionPayload({
  method: "POST",
  requestTarget: assertionTarget,
  bodyDigest: createHash("sha256").update(assertionBody).digest("hex"),
  workerId: "preview-worker-1",
  keyVersion: "worker-key-v1",
  workerEnvironment: "preview",
  deploymentId: "phase-c1-preview-1",
  timestamp: assertionTimestamp,
  nonce: assertionNonce
});
const assertionSignature = sign(null, Buffer.from(assertionCanonical, "utf8"), privateKey).toString("base64");
const assertionEnvironment = {
  VERCEL_ENV: "preview",
  DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON: JSON.stringify({
    "preview-worker-1": {
      keyVersion: "worker-key-v1",
      publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      environment: "preview",
      deploymentId: "phase-c1-preview-1"
    }
  })
};
const assertionRequest = new Request(`https://preview.example.test${assertionTarget}`, {
  method: "POST",
  headers: {
    "x-vaeroex-broker-protocol": "document_extraction_broker_v2",
    "x-vaeroex-worker-id": "preview-worker-1",
    "x-vaeroex-worker-key-version": "worker-key-v1",
    "x-vaeroex-worker-environment": "preview",
    "x-vaeroex-worker-deployment-id": "phase-c1-preview-1",
    "x-vaeroex-worker-timestamp": assertionTimestamp,
    "x-vaeroex-worker-nonce": assertionNonce,
    "x-vaeroex-worker-signature": assertionSignature
  },
  body: assertionBody
});
assert.equal(
  verifyWorkerAssertion({
    request: assertionRequest,
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow
  }).workerId,
  "preview-worker-1"
);
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequest,
    body: assertionBody,
    brokerEnvironment: "production",
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /identity_unknown/
);
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequest,
    body: Buffer.from('{"operation":"claim"}', "utf8"),
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /assertion_invalid/
);
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequest,
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow + 61_000
  }),
  /assertion_expired/
);

function assertionRequestWith(headers) {
  return new Request(`https://preview.example.test${assertionTarget}`, {
    method: "POST",
    headers,
    body: assertionBody
  });
}

function assertionHeaders(overrides = {}) {
  return {
    "x-vaeroex-broker-protocol": "document_extraction_broker_v2",
    "x-vaeroex-worker-id": "preview-worker-1",
    "x-vaeroex-worker-key-version": "worker-key-v1",
    "x-vaeroex-worker-environment": "preview",
    "x-vaeroex-worker-deployment-id": "phase-c1-preview-1",
    "x-vaeroex-worker-timestamp": assertionTimestamp,
    "x-vaeroex-worker-nonce": assertionNonce,
    "x-vaeroex-worker-signature": assertionSignature,
    ...overrides
  };
}

for (const [keyType, options] of [
  ["rsa", { modulusLength: 2048 }],
  ["rsa-pss", { modulusLength: 2048, hashAlgorithm: "sha256", mgf1HashAlgorithm: "sha256", saltLength: 32 }],
  ["ec", { namedCurve: "P-256" }],
  ["x25519", undefined]
]) {
  const pair = generateKeyPairSync(keyType, options);
  const unsupportedEnvironment = {
    VERCEL_ENV: "preview",
    DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON: JSON.stringify({
      "preview-worker-1": {
        keyVersion: "worker-key-v1",
        publicKeySpkiBase64: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
        environment: "preview",
        deploymentId: "phase-c1-preview-1"
      }
    })
  };
  assert.throws(
    () => verifyWorkerAssertion({
      request: assertionRequestWith(assertionHeaders()),
      body: assertionBody,
      brokerEnvironment: "preview",
      environment: unsupportedEnvironment,
      now: assertionNow
    }),
    /worker_keys_invalid|assertion_invalid/,
    `${keyType} worker keys must fail closed`
  );
}

assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequestWith(assertionHeaders()),
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: {
      VERCEL_ENV: "preview",
      DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON: JSON.stringify({
        "preview-worker-1": {
          keyVersion: "worker-key-v1",
          publicKeySpkiBase64: "not-base64",
          environment: "preview",
          deploymentId: "phase-c1-preview-1"
        }
      })
    },
    now: assertionNow
  }),
  /worker_keys_invalid/
);
const modifiedSignature = Buffer.from(assertionSignature, "base64");
modifiedSignature[0] ^= 1;
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequestWith(assertionHeaders({
      "x-vaeroex-worker-signature": modifiedSignature.toString("base64")
    })),
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /assertion_invalid/
);
const unsignedHeaders = assertionHeaders();
delete unsignedHeaders["x-vaeroex-worker-signature"];
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequestWith(unsignedHeaders),
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /assertion_invalid/
);
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequestWith(assertionHeaders({ "x-vaeroex-worker-id": "preview-worker-2" })),
    body: assertionBody,
    brokerEnvironment: "preview",
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /identity_unknown/
);

const capabilityEnvironment = {
  DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON: JSON.stringify({
    "broker-key-v1": Buffer.alloc(32, 6).toString("base64"),
    "broker-key-v2": Buffer.alloc(32, 7).toString("base64")
  }),
  DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION: "broker-key-v2"
};
const capabilityExpiry = new Date(assertionNow + 60_000).toISOString();
const leaseToken = createLeaseCapability({
  jobId: "11111111-1111-4111-8111-111111111111",
  workerId: "preview-worker-1",
  expiresAt: capabilityExpiry,
  environment: capabilityEnvironment
});
assert.equal(
  verifyBrokerCapability({
    token: leaseToken,
    workerId: "preview-worker-1",
    expectedKind: "lease",
    environment: capabilityEnvironment,
    now: assertionNow
  }).kind,
  "lease"
);
assert.throws(
  () => verifyBrokerCapability({
    token: leaseToken,
    workerId: "preview-worker-2",
    expectedKind: "lease",
    environment: capabilityEnvironment,
    now: assertionNow
  }),
  /expired_or_invalid/
);
const fileSecret = createFileGrantSecret();
const fileToken = createFileCapability({
  grantId: "22222222-2222-4222-8222-222222222222",
  workerId: "preview-worker-1",
  expiresAt: capabilityExpiry,
  secret: fileSecret,
  environment: capabilityEnvironment
});
assert.equal(
  verifyBrokerCapability({
    token: fileToken,
    workerId: "preview-worker-1",
    expectedKind: "file",
    environment: capabilityEnvironment,
    now: assertionNow
  }).kind,
  "file"
);
const priorCapabilityEnvironment = {
  ...capabilityEnvironment,
  DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION: "broker-key-v1"
};
const priorLeaseToken = createLeaseCapability({
  jobId: "33333333-3333-4333-8333-333333333333",
  workerId: "preview-worker-1",
  expiresAt: capabilityExpiry,
  environment: priorCapabilityEnvironment
});
assert.equal(
  verifyBrokerCapability({
    token: priorLeaseToken,
    workerId: "preview-worker-1",
    expectedKind: "lease",
    environment: capabilityEnvironment,
    now: assertionNow
  }).keyVersion,
  "broker-key-v1",
  "a retained prior broker key must verify during rotation overlap"
);
assert.throws(
  () => verifyBrokerCapability({
    token: priorLeaseToken,
    workerId: "preview-worker-1",
    expectedKind: "lease",
    environment: {
      DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON: JSON.stringify({
        "broker-key-v2": Buffer.alloc(32, 7).toString("base64")
      }),
      DOCUMENT_EXTRACTION_BROKER_CAPABILITY_CURRENT_KEY_VERSION: "broker-key-v2"
    },
    now: assertionNow
  }),
  /expired_or_invalid/,
  "a retired broker key must fail closed"
);

const key = Uint8Array.from({ length: 32 }, (_, index) => index);
const nonce = Uint8Array.from({ length: 12 }, (_, index) => index + 32);
const context = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  cacheKey: "a".repeat(64),
  artifactFingerprint: "b".repeat(64),
  extractionContractVersion: "document_extraction_artifact_v1",
  normalizationVersion: "document_extraction_normalization_v1",
  encryptionKeyVersion: "managed-key-v1"
};
const plaintext = new TextEncoder().encode("deterministic extraction encryption vector");
const envelope = encryptDocumentExtractionBytes({ plaintext, key, context, nonce });
assert.equal(Buffer.from(envelope.nonce).toString("hex"), "202122232425262728292a2b");
assert.equal(envelope.aadDigest, documentExtractionAadDigest(context));
assert.deepEqual(decryptDocumentExtractionBytes({ envelope, key, context }), plaintext);
assert.throws(
  () => decryptDocumentExtractionBytes({
    envelope: { ...envelope, ciphertext: Uint8Array.from(envelope.ciphertext, (value, index) => index ? value : value ^ 1) },
    key,
    context
  }),
  /failed authentication/
);
assert.throws(
  () => decryptDocumentExtractionBytes({
    envelope,
    key,
    context: { ...context, workspaceId: "22222222-2222-4222-8222-222222222222" }
  }),
  /metadata does not match/
);
assert.throws(
  () => decryptDocumentExtractionBytes({ envelope, key: new Uint8Array(32).fill(9), context }),
  /failed authentication/
);
const rotated = encryptDocumentExtractionBytes({
  plaintext: decryptDocumentExtractionBytes({ envelope, key, context }),
  key: new Uint8Array(32).fill(7),
  context: { ...context, encryptionKeyVersion: "managed-key-v2" },
  nonce: new Uint8Array(12).fill(3)
});
assert.deepEqual(
  decryptDocumentExtractionBytes({
    envelope: rotated,
    key: new Uint8Array(32).fill(7),
    context: { ...context, encryptionKeyVersion: "managed-key-v2" }
  }),
  plaintext,
  "rotation must preserve the normalized artifact bytes"
);

const keyringEnvironment = {
  DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON: JSON.stringify({
    "managed-key-v1": Buffer.from(key).toString("base64"),
    "managed-key-v2": Buffer.alloc(32, 7).toString("base64")
  }),
  DOCUMENT_EXTRACTION_ENCRYPTION_CURRENT_KEY_VERSION: "managed-key-v2"
};
assert.equal(loadManagedDocumentExtractionKeyring(keyringEnvironment).keys.size, 2);
assert.throws(() => loadManagedDocumentExtractionKeyring({}), /not configured/);

async function verifyManagedRotation() {
  const oldProvider = createManagedDocumentExtractionEncryptionProvider({
    currentKeyVersion: "managed-key-v1",
    keys: new Map([
      ["managed-key-v1", key],
      ["managed-key-v2", new Uint8Array(32).fill(7)]
    ])
  });
  const newProvider = createManagedDocumentExtractionEncryptionProvider({
    currentKeyVersion: "managed-key-v2",
    keys: new Map([
      ["managed-key-v1", key],
      ["managed-key-v2", new Uint8Array(32).fill(7)]
    ])
  });
  const managedContext = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    cacheKey: "a".repeat(64),
    artifactFingerprint: normalizedArtifact.artifactFingerprint,
    extractionContractVersion: "document_extraction_artifact_v1",
    normalizationVersion: "document_extraction_normalization_v1"
  };
  const oldEnvelope = await oldProvider.encrypt(normalizedArtifact, managedContext);
  const rotation = await rotateDocumentExtractionEncryption({
    envelope: oldEnvelope,
    context: managedContext,
    provider: newProvider
  });
  assert.equal(rotation.rotated, true);
  assert.equal(rotation.envelope.keyVersion, "managed-key-v2");
  assert.equal(
    (await newProvider.decrypt(rotation.envelope, managedContext)).artifactFingerprint,
    normalizedArtifact.artifactFingerprint
  );
  await assert.rejects(
    () => newProvider.decrypt(rotation.envelope, {
      ...managedContext,
      workspaceId: "22222222-2222-4222-8222-222222222222"
    }),
    /metadata does not match/
  );
}

async function verifyNonceCollisionRetry() {
  const seen = [];
  const result = await persistWithDocumentExtractionNonceRetry(
    async () => {
      const nonce = seen.length === 0 ? "nonce-collision" : "nonce-fresh";
      seen.push(nonce);
      return { nonce };
    },
    async (candidate) => candidate.nonce === "nonce-collision"
      ? { completed: false, reason: "nonce_collision" }
      : { completed: true, status: "needs_review" }
  );
  assert.equal(result.completed, true);
  assert.deepEqual(seen, ["nonce-collision", "nonce-fresh"]);

  let attempts = 0;
  await assert.rejects(
    () => persistWithDocumentExtractionNonceRetry(
      async () => ({ nonce: `collision-${attempts += 1}` }),
      async () => ({ completed: false, reason: "nonce_collision" })
    ),
    /nonce_collision_retry_exhausted/
  );
  assert.equal(attempts, 3);
}

Promise.all([verifyManagedRotation(), verifyNonceCollisionRetry()])
  .then(() => console.log("Document extraction private-worker Phase B regressions passed."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Phase B regression failed.");
    process.exitCode = 1;
  });
