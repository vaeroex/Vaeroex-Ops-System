const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const workerRoot = path.join(root, "services/document-extraction-worker");
const readWorker = (relative) => read(`services/document-extraction-worker/${relative}`);

const dockerfile = readWorker("Dockerfile");
const dockerignore = readWorker(".dockerignore");
const poolTemplate = readWorker("cloud-run-worker-pool.yaml.template");
const deploy = readWorker("ops/deploy-preview-worker.sh");
const renderer = readWorker("ops/render-worker-pool.py");
const enable = readWorker("ops/set-preview-qualification-worker.sh");
const disable = readWorker("ops/disable-preview-worker.sh");
const provision = readWorker("ops/provision-preview-secrets.sh");
const verifySecretFiles = readWorker("ops/verify-secret-files.py");
const provisionRuntime = readWorker("ops/provision-preview-runtime.sh");
const buildImage = readWorker("ops/build-preview-image.sh");
const verifyWorker = readWorker("ops/verify-worker-pool.py");
const verifyDeployment = readWorker("ops/verify-preview-worker.sh");
const summarizeSignals = readWorker("ops/summarize-worker-signals.py");
const checkSignals = readWorker("ops/check-preview-worker-signals.sh");
const cleanup = readWorker("ops/cleanup-nvcf-assets.py");
const config = readWorker("src/vaeroex_document_worker/config.py");
const broker = readWorker("src/vaeroex_document_worker/broker.py");
const runner = readWorker("src/vaeroex_document_worker/runner.py");
const daemon = readWorker("src/vaeroex_document_worker/daemon.py");
const health = readWorker("src/vaeroex_document_worker/health.py");
const telemetry = readWorker("src/vaeroex_document_worker/telemetry.py");
const synthetic = readWorker("src/vaeroex_document_worker/synthetic.py");
const assetCleanup = readWorker("src/vaeroex_document_worker/asset_cleanup.py");
const migration = read("supabase/migrations/20260804010000_document_extraction_worker_phase_c1_protocol.sql");
const baseline = JSON.parse(readWorker("fixtures/current-baseline-v1.json"));
const runbook = read("docs/architecture/document-extraction-worker-deployment-phase-c1.md");

assert.match(dockerfile, /^FROM python:3\.12\.11-slim-bookworm@sha256:[0-9a-f]{64} AS runtime$/m);
assert.match(dockerfile, /pip install --require-hashes --no-deps -r requirements\.lock/);
assert.match(dockerfile, /COPY fixtures \.\/fixtures/);
assert.match(dockerfile, /USER 10001:10001/);
assert.match(dockerfile, /ENTRYPOINT \["python", "-m", "vaeroex_document_worker\.daemon"\]/);
assert.doesNotMatch(dockerfile, /EXPOSE|curl|wget|apt-get|latest/i);
assert.match(dockerignore, /^tests$/m);
assert.match(dockerignore, /^sbom\.cdx\.json$/m);

assert.match(poolTemplate, /kind: WorkerPool/);
assert.match(poolTemplate, /manualInstanceCount: "0"/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /memory: 2Gi/);
assert.match(poolTemplate, /mountPath: \/var\/tmp\/vaeroex-document-worker/);
assert.match(poolTemplate, /name: TMPDIR[\s\S]+value: \/var\/tmp\/vaeroex-document-worker/);
assert.match(poolTemplate, /emptyDir:[\s\S]+medium: Memory[\s\S]+sizeLimit: 768Mi/);
assert.match(poolTemplate, /startupProbe:[\s\S]+\/startup/);
assert.match(poolTemplate, /livenessProbe:[\s\S]+\/health/);
assert.doesNotMatch(poolTemplate, /^kind:\s*Service$/m);
assert.doesNotMatch(poolTemplate, /^\s*(?:ingress|loadBalancer|autoscaling):/m);

assert.match(deploy, /WORKER_IMAGE_DIGEST must be immutable/);
assert.match(deploy, /WORKER_SECRET_VERSION/);
assert.match(deploy, /NVIDIA_SECRET_VERSION/);
assert.doesNotMatch(deploy, /:latest/);
assert.match(deploy, /gcloud run worker-pools replace/);
assert.match(deploy, /render-worker-pool\.py/);
assert.doesNotMatch(deploy, /--startup-probe|--liveness-probe/);
assert.match(renderer, /BROKER_URL must be an HTTPS Vercel Preview origin/);
assert.match(renderer, /Secret versions must be explicit positive integers/);
assert.match(renderer, /WORKER_IMAGE_DIGEST must be immutable/);
for (const mutatingPreviewScript of [deploy, enable, disable, provision, provisionRuntime, buildImage]) {
  assert.match(mutatingPreviewScript, /vaeroex-document-extraction-phase-c1-preview-only/);
}
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_WORKER_ENVIRONMENT[\s\S]+value: preview/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED[\s\S]+value: "false"/);
assert.match(poolTemplate, /secretKeyRef:[\s\S]+DOCUMENT_EXTRACTION_WORKER_SECRET_VERSION/);
assert.match(enable, /synthetic-preview-only-12-documents-13-pages/);
assert.match(enable, /--instances 1/);
assert.match(disable, /--instances 0[\s\S]+DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false/);
assert.match(provision, /--data-file/);
assert.match(provision, /verify-secret-files\.py/);
assert.match(provision, /roles\/secretmanager\.secretAccessor/);
assert.doesNotMatch(provision, /versions access|secrets versions access|cat |echo \$/i);
assert.match(verifySecretFiles, /stat\.S_IMODE\(metadata\.st_mode\) != 0o600/);
assert.match(verifySecretFiles, /stat\.S_ISLNK/);
assert.doesNotMatch(verifySecretFiles, /print\(/);
assert.match(provisionRuntime, /gcloud iam service-accounts create/);
assert.match(provisionRuntime, /unexpected project-level roles/);
assert.doesNotMatch(provisionRuntime, /add-iam-policy-binding/);
assert.match(buildImage, /gcloud builds submit/);
assert.match(buildImage, /image_summary\.digest/);
assert.doesNotMatch(buildImage, /:latest/);
assert.match(verifyDeployment, /gcloud run worker-pools describe/);
assert.match(verifyWorker, /worker_pool_environment_scope_invalid/);
assert.match(verifyWorker, /worker_pool_public_endpoint_unexpected/);
assert.match(verifyWorker, /secretValuesRead/);
assert.match(checkSignals, /resource\.type=\\"cloud_run_workerpool\\"/);
assert.match(summarizeSignals, /rawPayloadReturned/);
assert.doesNotMatch(summarizeSignals, /print\(.+(?:jsonPayload|document_text|raw_response)/i);

for (const forbidden of [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "DOCUMENT_EXTRACTION_ENCRYPTION_KEYS_JSON",
  "DOCUMENT_EXTRACTION_BROKER_CAPABILITY_KEYS_JSON",
  "VERCEL_BLOB_READ_WRITE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS"
]) {
  assert.match(config, new RegExp(forbidden));
}
assert.match(config, /runtime_environment == "preview"/);
assert.match(config, /DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED/);
assert.match(config, /DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED/);
assert.match(config, /Forbidden private-worker credential/);

assert.match(broker, /Ed25519PrivateKey/);
assert.match(broker, /x-vaeroex-worker-environment/);
assert.match(broker, /x-vaeroex-worker-deployment-id/);
assert.match(broker, /secrets\.token_hex\(16\)/);
assert.match(broker, /follow_redirects=False/);
assert.match(broker, /trust_env=False/);
assert.match(runner, /approved_fixture_for_source/);
assert.match(runner, /materialize_approved_pages/);
assert.match(runner, /check_provider_boundary/);
assert.match(runner, /lease = future\.result\(timeout=35\)/);
assert.match(runner, /progress_callback/);
assert.match(runner, /status="dispatch_in_flight"/);
assert.match(runner, /status=_required_string\(completion\.get\("status"\)/);
assert.match(daemon, /await _verify_broker\(config\)/);
assert.match(daemon, /max_cycles/);
assert.match(health, /\/startup/);
assert.match(health, /\/health/);

for (const forbiddenTelemetryField of [
  "workspace_id", "workspaceId", "filename", "asset_id", "assetId",
  "signed_url", "document_text", "raw_response", "assertion", "secret"
]) {
  assert.doesNotMatch(telemetry, new RegExp(`['\"]${forbiddenTelemetryField}['\"]`));
}
assert.match(telemetry, /_ALLOWED_FIELDS/);
assert.match(telemetry, /operational_telemetry_field_rejected/);

const fixtureRoot = path.join(workerRoot, "fixtures/synthetic-v1");
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
const digest = crypto.createHash("sha256");
for (const absolute of walk(fixtureRoot).sort()) {
  digest.update(path.relative(fixtureRoot, absolute));
  digest.update(Buffer.from([0]));
  digest.update(crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest());
}
assert.equal(digest.digest("hex"), "c0e6b1aa615e3674e5aa418436a84555889d8766d4d8a1e3401685dbe2495dec");
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "ground-truth.json"), "utf8"));
assert.equal(manifest.length, 12);
assert.equal(manifest.reduce((total, fixture) => total + fixture.renderedPageFiles.length, 0), 13);
assert.equal(
  manifest.filter((fixture) => !fixture.documentClasses.includes("corrupted_page"))
    .reduce((total, fixture) => total + fixture.renderedPageFiles.length, 0),
  12
);
assert.match(synthetic, /FIXTURE_SOURCE_COMMIT = "cc3c125b01ac41513b3b92213b6daa39fa5ba91f"/);
assert.match(synthetic, /synthetic_fixture_not_approved/);
assert.match(synthetic, /synthetic_fixture_locally_invalid/);
assert.match(synthetic, /"rawContentInTelemetry": False/);
assert.equal(baseline.benchmarkVersion, "document_intelligence_benchmark_v1");
assert.equal(baseline.sourceCommit, "cc3c125b01ac41513b3b92213b6daa39fa5ba91f");
assert.doesNotMatch(JSON.stringify(baseline), /documentId|rawText|normalizedText|sourceFile|workspace/i);

assert.match(assetCleanup, /MAX_CLEANUP_WINDOW = timedelta\(hours=2\)/);
assert.match(assetCleanup, /asset\.get\("description"\) != NVCF_ASSET_DESCRIPTION/);
assert.match(assetCleanup, /asset\.get\("contentType"\) != "image\/png"/);
assert.match(assetCleanup, /DELETE_CONFIRMATION/);
assert.match(cleanup, /--api-key-file/);
assert.doesNotMatch(`${assetCleanup}\n${cleanup}`, /print\(.+(?:api_key|asset_id)/i);

assert.match(migration, /document_extraction_broker_v2/);
assert.match(migration, /document_extraction_worker_v2/);
assert.match(migration, /drop constraint if exists document_extraction_jobs_phase_b_versions_check/);
assert.match(migration, /document_extraction_broker_v1'[\s\S]+'document_extraction_broker_v2'/);
assert.match(migration, /document_extraction_worker_v1'[\s\S]+'document_extraction_worker_v2'/);
assert.match(migration, /check_document_extraction_provider_boundary_v1/);
assert.match(migration, /lease_expires_at = now\(\) \+ interval '5 minutes'/);
assert.match(migration, /set search_path = ''/);
assert.doesNotMatch(migration, /create table|insert into public\.document_extraction_(?:workspace_settings|system_state)/i);
assert.equal((migration.match(/alter table public\.document_extraction_jobs/g) || []).length, 2);
assert.doesNotMatch(migration, /alter table public\.(?!document_extraction_jobs\b)/i);
assert.doesNotMatch(migration, /\b(?:add|drop)\s+column\b/i);
assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|authenticated)/i);
assert.doesNotMatch(migration, /\b(?:delete|truncate)\b/i);

const appFiles = walk(path.join(root, "app")).map((file) => path.relative(root, file));
assert.deepEqual(
  appFiles.filter((file) => /document-extraction/i.test(file)),
  ["app/api/internal/document-extraction/broker/route.ts"],
  "Phase C1 must retain only the authenticated broker and no customer or runner route"
);
assert.equal(fs.existsSync(path.join(workerRoot, "src/vaeroex_document_worker/workflow.py")), false);
assert.equal(fs.existsSync(path.join(workerRoot, "api/health.py")), false);

assert.match(runbook, /^# Document Extraction Worker Deployment and Synthetic Qualification - Phase C1$/m);
assert.match(runbook, /```mermaid[\s\S]+Cloud Run control plane[\s\S]+Awaiting human review[\s\S]+```/);
for (const heading of [
  "Deployment target",
  "Topology and authority boundary",
  "Private broker authentication",
  "Secrets and environment scope",
  "Rotation and emergency revocation",
  "Resource and concurrency controls",
  "Health, monitoring, and privacy",
  "Operator recovery runbook",
  "Kill-switch drill",
  "Synthetic Preview qualification",
  "Post-qualification cleanup",
  "Deployment and rollback commands",
  "Phase C2 prerequisites"
]) {
  assert.match(runbook, new RegExp(`^## ${heading}$`, "m"));
}
assert.match(runbook, /provider may have occurred/i);
assert.match(runbook, /manual review mandatory/i);
assert.match(runbook, /zero instances/i);
assert.match(runbook, /cost is reported as unknown/i);
assert.match(runbook, /Production remained untouched/i);
assert.match(runbook, /Customer uploads, arbitrary images, public routes, Production provider calls/);

process.stdout.write("Document extraction worker deployment Phase C1 regressions passed.\n");
