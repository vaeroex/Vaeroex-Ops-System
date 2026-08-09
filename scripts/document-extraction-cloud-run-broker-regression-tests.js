const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const vercelRoute = read("app/api/internal/document-extraction/broker/route.ts");
const cloudRunAdapter = read("services/document-extraction-broker/src/adapter.ts");
const cloudRunServer = read("services/document-extraction-broker/src/server.ts");
const sharedHandler = read("lib/document-extraction/broker-http.ts");
const runtimePolicy = read("lib/document-extraction/runtime-policy.ts");
const workerBroker = read(
  "services/document-extraction-worker/src/vaeroex_document_worker/broker.py"
);
const workerConfig = read(
  "services/document-extraction-worker/src/vaeroex_document_worker/config.py"
);
const workerManifest = read(
  "services/document-extraction-worker/cloud-run-worker-pool.yaml.template"
);
const brokerDockerfile = read("services/document-extraction-broker/Dockerfile");
const brokerPackage = read("services/document-extraction-broker/package.json");
const brokerLock = read("services/document-extraction-broker/pnpm-lock.yaml");
const brokerCloudBuild = read("services/document-extraction-broker/cloudbuild.yaml");
const rootPackage = read("package.json");
const provisionBroker = read("services/document-extraction-broker/ops/provision-preview-broker-runtime.sh");
const provisionBrokerSecrets = read("services/document-extraction-broker/ops/add-preview-broker-secret-versions.mjs");
const cleanupBroker = read("services/document-extraction-broker/ops/cleanup-preview-broker.sh");
const brokerLicenses = read("services/document-extraction-broker/THIRD_PARTY_LICENSES.md");
const brokerSbom = JSON.parse(read("services/document-extraction-broker/sbom.cdx.json"));

assert.match(vercelRoute, /handleDocumentExtractionBrokerHttpRequest/);
assert.match(vercelRoute, /export const GET = handle/);
assert.match(vercelRoute, /export const POST = handle/);
assert.match(cloudRunAdapter, /handleDocumentExtractionBrokerHttpRequest/);
assert.match(cloudRunAdapter, /resolveBrokerDocumentExtractionRuntimeEnvironment/);
assert.match(cloudRunServer, /handleCloudRunBrokerWebRequest/);
assert.match(cloudRunServer, /MAX_TRANSPORT_BODY_BYTES = 8_500_000/);
assert.match(cloudRunAdapter, /url\.pathname !== BROKER_PATH/);
for (const adapter of [vercelRoute, cloudRunAdapter]) {
  assert.doesNotMatch(adapter, /consumeWorkerAssertion|createSignedUrl|handleDocumentExtractionBrokerOperation/);
}
assert.match(vercelRoute, /resolveVercelDocumentExtractionRuntimeEnvironment/);
assert.match(sharedHandler, /verifyWorkerAssertion/);
assert.match(sharedHandler, /consumeWorkerAssertion/);
assert.match(sharedHandler, /handleDocumentExtractionBrokerOperation/);
assert.match(sharedHandler, /createSignedUrl\(source\.storage_path, 30\)/);
assert.match(sharedHandler, /runtimeEnvironment/);
assert.match(runtimePolicy, /DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT/);

assert.match(workerBroker, /x-serverless-authorization/);
assert.match(workerBroker, /GoogleIdentityTokenProvider/);
assert.match(workerBroker, /headers\["authorization"\] = f"Bearer \{file_capability\}"/);
assert.match(workerBroker, /follow_redirects=False/);
assert.match(workerBroker, /trust_env=False/);
assert.match(workerConfig, /google_oidc_v1/);
assert.match(workerConfig, /\.run\.app/);
assert.match(workerConfig, /DOCUMENT_EXTRACTION_.+TOKEN\|SECRET\|PRIVATE_KEY\|CREDENTIALS/);
assert.match(workerManifest, /DOCUMENT_EXTRACTION_BROKER_AUDIENCE/);
assert.match(workerManifest, /DOCUMENT_EXTRACTION_BROKER_AUTH_MODE/);

assert.match(brokerDockerfile, /node:22\.23\.1-bookworm-slim@sha256:[0-9a-f]{64}/);
assert.match(brokerDockerfile, /gcr\.io\/distroless\/nodejs22-debian12@sha256:[0-9a-f]{64}/);
assert.match(brokerDockerfile, /cd services\/document-extraction-broker/);
assert.match(brokerDockerfile, /\/app\/node_modules\/\.bin\/ncc build src\/server\.ts/);
assert.match(brokerDockerfile, /! grep -Fq '@\/lib\/' dist\/index\.js/);
assert.match(brokerDockerfile, /require\("\.\/dist\/index\.js"\)/);
assert.match(brokerDockerfile, /COPY services\/document-extraction-broker\/package\.json services\/document-extraction-broker\/pnpm-lock\.yaml/);
assert.doesNotMatch(brokerDockerfile, /COPY package\.json pnpm-lock\.yaml/);
assert.match(brokerDockerfile, /--external server-only/);
assert.match(brokerDockerfile, /server-only@0\.0\.1/);
assert.match(brokerDockerfile, /USER 65532:65532/);
assert.match(brokerDockerfile, /CMD \["--conditions=react-server", "index\.js"\]/);
assert.doesNotMatch(brokerDockerfile, /next build|\.next|sharp|postcss/);
assert.doesNotMatch(brokerDockerfile, /NVIDIA_API_KEY|SUPABASE_SERVICE_ROLE_KEY=/);
assert.match(brokerCloudBuild, /gcr\.io\/cloud-builders\/docker@sha256:[0-9a-f]{64}/);
assert.match(rootPackage, /"server-only": "0\.0\.1"/);
assert.match(brokerPackage, /--external server-only/);
for (const mutatingScript of [provisionBroker, provisionBrokerSecrets, cleanupBroker]) {
  assert.match(mutatingScript, /vaeroex-document-extraction-phase-c1-preview-only/);
  assert.match(mutatingScript, /vaeroex-document-worker/);
  assert.match(mutatingScript, /us-west1/);
  assert.doesNotMatch(mutatingScript, /mdiianhfrojmxqpwrflh/);
  assert.doesNotMatch(mutatingScript, /secrets versions access|service-accounts keys create/i);
}
assert.match(provisionBroker, /unexpected project-level roles/);
assert.match(provisionBroker, /roles\/secretmanager\.secretAccessor/);
assert.match(provisionBrokerSecrets, /claims\.ref !== "zfpnhvcmuuvtswttmnjd"/);
assert.match(provisionBrokerSecrets, /value\.startsWith\("sb_secret_"\)/);
assert.match(provisionBrokerSecrets, /https:\/\/zfpnhvcmuuvtswttmnjd\.supabase\.co\/rest\/v1\//);
assert.match(provisionBrokerSecrets, /await response\.body\?\.cancel\(\)/);
assert.match(provisionBrokerSecrets, /generateKeyPairSync\("ed25519"\)/);
assert.match(provisionBrokerSecrets, /--data-file=-/);
assert.doesNotMatch(provisionBrokerSecrets, /console\.log|process\.stderr\.write/);
assert.match(cleanupBroker, /remove-iam-policy-binding/);
assert.match(cleanupBroker, /secrets versions destroy/);
assert.match(cleanupBroker, /service-accounts delete/);
assert.match(cleanupBroker, /original Preview worker secret version must never be destroyed/);
assert.equal(brokerSbom.bomFormat, "CycloneDX");
assert.equal(brokerSbom.specVersion, "1.6");
const runtimeComponents = new Map(
  brokerSbom.components.map((component) => [component.name, component.version])
);
assert.deepEqual(
  [...runtimeComponents.entries()].sort(),
  [
    ["@supabase/auth-js", "2.65.0"],
    ["@supabase/functions-js", "2.4.1"],
    ["@supabase/node-fetch", "2.6.15"],
    ["@supabase/postgrest-js", "1.16.1"],
    ["@supabase/realtime-js", "2.10.2"],
    ["@supabase/storage-js", "2.7.0"],
    ["@supabase/supabase-js", "2.45.4"],
    ["gcr.io/distroless/nodejs22-debian12", "sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e"],
    ["server-only", "0.0.1"],
    ["tr46", "0.0.3"],
    ["webidl-conversions", "3.0.1"],
    ["whatwg-url", "5.0.0"],
    ["ws", "8.21.2"],
    ["zod", "3.25.76"]
  ].sort()
);
for (const [name, version] of runtimeComponents) {
  assert.match(brokerLicenses, new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*${version}`));
  if (name !== "gcr.io/distroless/nodejs22-debian12") {
    assert.match(brokerLock, new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@${version.replaceAll(".", "\\.")}`));
  }
}
assert.equal(brokerSbom.metadata.tools.components[0].name, "@vercel/ncc");

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

const {
  resolveBrokerDocumentExtractionRuntimeEnvironment,
  resolveDocumentExtractionExecutionPolicy
} = loadTypeScriptModule("lib/document-extraction/runtime-policy.ts");

assert.equal(
  resolveBrokerDocumentExtractionRuntimeEnvironment({
    DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT: "preview",
    VERCEL_ENV: "production"
  }),
  "preview"
);
assert.throws(
  () => resolveBrokerDocumentExtractionRuntimeEnvironment({ VERCEL_ENV: "preview" }),
  /broker_environment_invalid/
);
assert.equal(
  resolveDocumentExtractionExecutionPolicy(
    { VERCEL_ENV: "production", DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED: "true" },
    "preview"
  ).environment,
  "preview"
);

async function assertAdapterParity() {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT:
      process.env.DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT,
    DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED:
      process.env.DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED
  };
  process.env.VERCEL_ENV = "preview";
  process.env.DOCUMENT_EXTRACTION_BROKER_RUNTIME_ENVIRONMENT = "preview";
  process.env.DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED = "false";
  try {
    const vercelAdapter = loadTypeScriptModule(
      "app/api/internal/document-extraction/broker/route.ts"
    );
    const cloudAdapter = loadTypeScriptModule(
      "services/document-extraction-broker/src/adapter.ts"
    );
    const makeRequest = (origin) => new Request(
      `${origin}/api/internal/document-extraction/broker`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }
    );
    const vercelResponse = await vercelAdapter.POST(
      makeRequest("https://pr265.example.invalid")
    );
    const cloudRunResponse = await cloudAdapter.handleCloudRunBrokerWebRequest(
      makeRequest("https://broker.example.run.app")
    );
    assert.equal(vercelResponse.status, 404);
    assert.equal(cloudRunResponse.status, vercelResponse.status);
    assert.equal(await cloudRunResponse.text(), await vercelResponse.text());
    assert.equal(
      cloudRunResponse.headers.get("cache-control"),
      vercelResponse.headers.get("cache-control")
    );
    assert.equal(cloudRunResponse.headers.get("x-content-type-options"), "nosniff");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

assertAdapterParity()
  .then(() => console.log("Document extraction Cloud Run broker regressions passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
