const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync, sign } = require("node:crypto");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migrationName = fs.readdirSync(path.join(root, "supabase/migrations"))
  .find((name) => name.endsWith("_document_extraction_private_worker_phase_b.sql"));
assert.ok(migrationName, "the canonical Phase B migration must exist");
const migration = read(`supabase/migrations/${migrationName}`);
const circuitMigration = read("supabase/migrations/20260803181405_document_extraction_dispatch_unknown_circuit.sql");
const route = read("app/api/internal/document-extraction/broker/route.ts");
const service = read("lib/document-extraction/broker-service.ts");
const policy = read("lib/document-extraction/runtime-policy.ts");
const encryption = read("lib/document-extraction/encryption.ts");
const workerConfig = read("services/document-extraction-worker/src/vaeroex_document_worker/config.py");
const workerProvider = read("services/document-extraction-worker/src/vaeroex_document_worker/official_client.py");
const workerRunner = read("services/document-extraction-worker/src/vaeroex_document_worker/runner.py");
const workflow = read("services/document-extraction-worker/src/vaeroex_document_worker/workflow.py");
const workerProject = read("services/document-extraction-worker/pyproject.toml");
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
  assertDocumentExtractionProviderDispatchEnabled,
  resolveDocumentExtractionExecutionPolicy
} = loadTypeScriptModule("lib/document-extraction/runtime-policy.ts");

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

assert.match(route, /verifyWorkerAssertion/);
assert.match(route, /consumeWorkerAssertion/);
assert.match(route, /authorization\.startsWith\("Bearer "\)/);
assert.match(route, /createSignedUrl\(source\.storage_path, 30\)/);
assert.doesNotMatch(route, /NVIDIA_API_KEY|nemo_retriever|create_ingestor/);
assert.match(service, /buildNormalizedDocumentExtractionArtifact/);
assert.match(service, /createManagedDocumentExtractionEncryptionProvider/);
assert.match(service, /artifact\.route !== context\.route/);
assert.match(service, /workspaceId: context\.workspace_id/);
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
assert.match(workerConfig, /Production document extraction approval is absent/);
assert.match(workerProvider, /from nemo_retriever import create_ingestor/);
assert.match(workerProvider, /method="nemotron_parse"/);
assert.match(workerProvider, /remote_max_retries=0/);
assert.match(workerProvider, /remote_max_429_retries=0/);
assert.match(workerRunner, /authorize_dispatch/);
assert.match(workerRunner, /authorize_retry/);
assert.match(workerRunner, /provider_outcome/);
assert.match(workflow, /Workflows\(namespace="vaeroexdocumentextractionprivatev1"\)/);
assert.match(workflow, /@workflows\.step\(max_retries=0\)/);
assert.match(workerProject, /\[\[tool\.vercel\.workflows\]\]/);
assert.match(workerProject, /entrypoint = "vaeroex_document_worker\.workflow:workflows"/);
assert.match(workerProject, /Pillow==12\.2\.0/);
assert.doesNotMatch([workerConfig, workerProvider, workerRunner].join("\n"), /print\(|logging\.(?:debug|info).*text|raw_response/i);

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
  DOCUMENT_EXTRACTION_NVIDIA_CLIENT_REVISION: "52886112cafab4c4bca1cda0d4f588785adfe4d3",
  DOCUMENT_EXTRACTION_NVIDIA_PARSER_REVISION: "nemo_retriever_multimodal_extraction_v1",
  NVIDIA_API_KEY: "test-only-placeholder"
}));

for (const generatedSymbol of [
  "document_extraction_worker_assertions",
  "document_extraction_file_access_grants",
  "document_extraction_operational_telemetry",
  "claim_document_extraction_job_v2",
  "complete_document_extraction_job_v2",
  "record_document_extraction_telemetry_v1"
]) {
  assert.match(generatedTypes, new RegExp(generatedSymbol));
}

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
  bodyDigest: require("node:crypto").createHash("sha256").update(assertionBody).digest("hex"),
  workerId: "preview-worker-1",
  keyVersion: "worker-key-v1",
  timestamp: assertionTimestamp,
  nonce: assertionNonce
});
const assertionSignature = sign(null, Buffer.from(assertionCanonical, "utf8"), privateKey).toString("base64");
const assertionEnvironment = {
  DOCUMENT_EXTRACTION_WORKER_PUBLIC_KEYS_JSON: JSON.stringify({
    "preview-worker-1": {
      keyVersion: "worker-key-v1",
      publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64")
    }
  })
};
const assertionRequest = new Request(`https://preview.example.test${assertionTarget}`, {
  method: "POST",
  headers: {
    "x-vaeroex-broker-protocol": "document_extraction_broker_v1",
    "x-vaeroex-worker-id": "preview-worker-1",
    "x-vaeroex-worker-key-version": "worker-key-v1",
    "x-vaeroex-worker-timestamp": assertionTimestamp,
    "x-vaeroex-worker-nonce": assertionNonce,
    "x-vaeroex-worker-signature": assertionSignature
  },
  body: assertionBody
});
assert.equal(
  verifyWorkerAssertion({ request: assertionRequest, body: assertionBody, environment: assertionEnvironment, now: assertionNow }).workerId,
  "preview-worker-1"
);
assert.throws(
  () => verifyWorkerAssertion({
    request: assertionRequest,
    body: Buffer.from('{"operation":"claim"}', "utf8"),
    environment: assertionEnvironment,
    now: assertionNow
  }),
  /assertion_invalid/
);
assert.throws(
  () => verifyWorkerAssertion({ request: assertionRequest, body: assertionBody, environment: assertionEnvironment, now: assertionNow + 61_000 }),
  /assertion_expired/
);

const capabilityEnvironment = {
  DOCUMENT_EXTRACTION_BROKER_CAPABILITY_SECRET: Buffer.alloc(32, 7).toString("base64")
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

verifyManagedRotation()
  .then(() => console.log("Document extraction private-worker Phase B regressions passed."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Phase B regression failed.");
    process.exitCode = 1;
  });
