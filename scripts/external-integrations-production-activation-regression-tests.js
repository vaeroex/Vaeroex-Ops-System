const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const main = read("services/external-integrations-production/infra/activation/main.tf");
const variables = read("services/external-integrations-production/infra/activation/variables.tf");
const versions = read("services/external-integrations-production/infra/activation/versions.tf");
const outputs = read("services/external-integrations-production/infra/activation/outputs.tf");
const backend = read("services/external-integrations-production/infra/activation/backend.tf");
const dockerfile = read("services/external-integrations-production/bootstrap-runtime/Dockerfile");
const dockerignore = read("services/external-integrations-production/bootstrap-runtime/.dockerignore");
const serverPath = path.join(root, "services/external-integrations-production/bootstrap-runtime/server.mjs");
const serverSource = read("services/external-integrations-production/bootstrap-runtime/server.mjs");
const callbackBoundarySource = read("services/external-integrations-production/bootstrap-runtime/callback-boundary.mjs");
const bootstrapPackage = JSON.parse(read("services/external-integrations-production/bootstrap-runtime/package.json"));
const edgeCallback = read("services/external-integrations-production/callback-edge/callback.go");
const edgePlugin = read("services/external-integrations-production/callback-edge/plugin/main.go");
const edgeCloudBuild = read("services/external-integrations-production/callback-edge/cloudbuild.yaml");
const workflow = read(".github/workflows/ci.yml");
const activationReadme = read("services/external-integrations-production/infra/activation/README.md");
const releasePins = read("services/external-integrations-production/infra/activation/production.tfvars.example");
const activationPath = path.join(root, "services/external-integrations-production/infra/activation");

const reviewedSourceCommit = "f4915edadbe2abddd7993c74c1fc3e80e1d1f821";
const reviewedOauthCallbackSourceCommit = "45cc2193dd87270ef413f2e21c65cf3b05c1c255";
const reviewedCallbackEdgeSourceCommit = reviewedOauthCallbackSourceCommit;
const reviewedBootstrapDigest = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:d56fe933eab1322bb4fe905b183964a980d641af23d69904e15989add501dc6f";
const reviewedOauthCallbackDigest = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/production-bootstrap@sha256:ebd5e50ab854ca3de3f49ee51ea8fbef0dfa5510b74c19b0ec6e9c367fffeddf";
const reviewedCallbackEdgeDigest = "us-west1-docker.pkg.dev/vaeroex-integrations-prod/vaeroex-integrations-images/square-callback-edge@sha256:0a841f23b5a45edbbdca61ab4a8a5c2391a377cef1f5a5c00e113db1a33c5bf9";

function runTerraform(args) {
  const result = spawnSync(process.env.TERRAFORM_BIN || "terraform", args, {
    cwd: activationPath,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...(process.env.TF_DATA_DIR ? { TF_DATA_DIR: process.env.TF_DATA_DIR } : {}),
    },
  });
  assert.equal(result.status, 0, `terraform ${args[0]} failed: ${(result.stderr || result.stdout || "unknown").slice(0, 500)}`);
}

runTerraform(["fmt", "-check", "-recursive"]);
runTerraform(["init", "-backend=false", "-input=false"]);
runTerraform(["validate"]);
runTerraform(["test"]);

assert.match(versions, /version\s*=\s*"7\.39\.0"/, "the Google provider is pinned to the first release supporting explicit edge-extension attributes");
assert.match(variables, /var\.project_id == "vaeroex-integrations-prod"/, "the activation cannot target another project");
assert.match(variables, /var\.region == "us-west1"/, "the activation cannot create an extra region");
assert.match(variables, /bootstrap_image_digest == null/, "the first apply creates no runtime");
assert.match(variables, /production-bootstrap@sha256:\[a-f0-9\]\{64\}/, "a runtime image must be an immutable digest in the isolated repository");
assert.match(variables, /variable "oauth_callback_image_digest"[\s\S]*production-bootstrap@sha256:\[a-f0-9\]\{64\}/, "the OAuth callback runtime has its own immutable disabled-bootstrap input");
assert.match(variables, /variable "oauth_callback_source_commit"[\s\S]*\^\[a-f0-9\]\{40\}\$/, "OAuth callback provenance requires an exact separate source revision");
assert.match(variables, /square-callback-edge@sha256:\[a-f0-9\]\{64\}/, "the callback edge image must be an immutable digest in the isolated repository");
assert.match(main, /deployment_inputs_valid/, "runtime and callback-edge artifacts must be deployed together");
assert.match(main, /callback_edge_source_commit == null/, "a callback edge cannot be deployed without exact source provenance");
assert.match(main, /oauth_callback_source_commit == null/, "first-stage infrastructure cannot claim an OAuth runtime revision");
assert.match(main, /value\s*=\s*each\.key == "oauth" \? var\.oauth_callback_source_commit : var\.source_commit/, "OAuth source provenance is separate without revising peer services");
assert.match(main, /image\s*=\s*each\.key == "oauth" \? var\.oauth_callback_image_digest : var\.bootstrap_image_digest/, "only the existing OAuth service selects the callback-specific image");
assert.match(main, /for_each\s*=\s*local\.deployment_enabled \? local\.modes : toset\(\[\]\)/, "the callback-specific image introduces no Cloud Run resource");
assert.match(main, /"containerscanning\.googleapis\.com"/, "release images require automatic vulnerability scanning");

for (const gate of [
  "runtime_enabled",
  "provider_calls_enabled",
  "customer_onboarding_enabled",
  "webhook_intake_enabled",
  "economic_contributions_enabled",
  "ai_dispatch_enabled",
]) {
  assert.match(variables, new RegExp(`variable "${gate}"[\\s\\S]*condition\\s*=\\s*!var\\.${gate}`), `${gate} is structurally closed`);
}

for (const sharedName of [
  "vaeroex-integrations-production",
  "vaeroex-integrations-us-west1",
  "vaeroex-integrations-router",
  "vaeroex-integrations-nat",
  "vaeroex-integrations-egress",
  "vaeroex-integrations-ingress",
  "vaeroex-integrations-tasks",
  "vaeroex-integrations-images",
]) assert.match(main, new RegExp(sharedName), `${sharedName} remains a provider-neutral shared resource`);

for (const mode of ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"]) {
  assert.match(main, new RegExp(`${mode}\\s*=\\s*"sq-prod-${mode}"`), `${mode} uses a Square-specific service identity`);
  assert.match(main, new RegExp(`mode => "square-production-\\$\\{mode\\}-db"`), "database secret names remain provider-specific");
}
assert.match(main, /task_invoker\s*=\s*"sq-prod-task-invoker"/);
assert.match(main, /local\.deployment_enabled \? local\.modes : toset\(\[\]\)/, "no image means no Cloud Run services");
assert.match(main, /public_modes = toset\(\["oauth", "webhook"\]\)/);
assert.match(main, /INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER/);
assert.match(main, /INGRESS_TRAFFIC_INTERNAL_ONLY/);
assert.match(main, /invoker_iam_disabled\s*=\s*contains\(local\.public_modes, each\.key\) \? true : null/, "only load-balancer-backed public modes disable the Cloud Run invoker check");
assert.doesNotMatch(main, /google_cloud_run_v2_service_iam_(?:member|binding)[\s\S]*allUsers/, "domain-restricted projects never require an allUsers IAM grant");

assert.match(main, /request\.headers\['host'\] != '\$\{var\.production_hostname\}'/, "Cloud Armor requires the exact approved host");
assert.match(main, /has\(request\.headers\['forwarded'\]\).*has\(request\.headers\['x-forwarded-host'\]\)/, "client-supplied forwarding authority is rejected");
for (const allowedPath of ["/healthz", "/api/integrations/square/callback", "/api/integrations/square/webhook"]) {
  assert.match(main, new RegExp(`request\\.path != '${allowedPath.replaceAll("/", "\\/")}'`), `${allowedPath} is in the exhaustive edge allowlist`);
}
assert.match(main, /request\.path == '\/healthz'.*request\.method != 'GET'.*request\.method != 'HEAD'/, "health accepts only GET and HEAD");
assert.match(main, /request\.path == '\/api\/integrations\/square\/callback'.*request\.method != 'GET'/, "the callback accepts only GET");
assert.match(main, /request\.path == '\/api\/integrations\/square\/webhook'.*request\.method != 'POST'/, "the webhook accepts only POST");
assert.match(main, /action\s*=\s*"deny\(404\)"\s*\n\s*priority\s*=\s*1150/, "unsupported methods use a Cloud Armor-supported fail-closed status");
assert.doesNotMatch(main, /action\s*=\s*"deny\(405\)"/, "Cloud Armor does not support deny(405)");
assert.match(main, /action\s*=\s*"rate_based_ban"/, "public paths are rate bounded");
assert.match(main, /google_compute_backend_service" "public"[\s\S]*log_config\s*\{\s*enable\s*=\s*false\s*\}/, "callback query strings are not written to load-balancer request logs");
assert.match(main, /google_network_services_wasm_plugin" "square_callback"/, "Square callbacks use a managed immutable query-stripping edge");
assert.doesNotMatch(main, /google_network_services_wasm_plugin" "square_callback"[\s\S]*?log_config\s*\{/, "the Wasm plugin relies on the API's fail-closed default-disabled logging state without a non-round-tripping block");
assert.match(activationReadme, /Network Services API defaults it to disabled/, "the provider-convergent default-disabled Wasm logging contract is documented");
assert.match(activationReadme, /No `allUsers` IAM binding is created/, "the domain-restricted public ingress contract is documented");
assert.match(main, /google_network_services_lb_edge_extension" "square_callback"[\s\S]*fail_open\s*=\s*false/, "the callback edge fails closed");
assert.match(main, /forward_attributes = \[\s*"request.method",\s*"request.path",\s*"request.query",\s*\]/, "only the exact method, path, and query attributes are forwarded to the callback plugin");
assert.doesNotMatch(main, /forward_headers\s*=/, "the edge plugin receives the complete client header map instead of a selected subset");
assert.match(edgeCallback, /CallbackPath\s*=\s*"\/api\/integrations\/square\/callback"/, "the edge accepts only the Square callback path");
assert.match(edgeCallback, /WebhookPath\s*=\s*"\/api\/integrations\/square\/webhook"/, "the edge permits only the exact queryless Square webhook pass-through");
assert.doesNotMatch(edgeCallback, /error_description|response_type|QueryUnescape|validState|validCode/, "OAuth query semantics are not interpreted at the edge");
assert.doesNotMatch(edgeCallback, /endOfStream/, "the header-only managed extension does not mistake its platform callback flag for request-body evidence");
assert.match(edgeCallback, /HasForbiddenCallbackBodyHeaders/, "request-body indicators are rejected by a unit-tested bounded header contract");
assert.match(edgeCallback, /MaxInputHeaderBytes\s*=\s*16384/, "the complete edge header map retains an aggregate byte bound");
for (const header of ["forwarded", "x-forwarded-host", "x-original-url", "x-rewrite-url"]) {
  assert.match(edgeCallback, new RegExp(`"${header}"`), `${header} is rejected from the complete client header map`);
}
assert.match(edgeCallback, /for _, reserved := range ReservedHandoffHeaders/, "client-supplied internal handoff headers fail closed");
assert.match(edgePlugin, /ReplaceHttpRequestHeader\(":path", callbackedge\.CallbackPath\)/, "the edge strips the OAuth query before Cloud Run request logging");
assert.match(edgePlugin, /GetHttpRequestHeaders\(\)/, "the edge reads the complete bounded header map before parsing callbacks");
assert.match(edgePlugin, /headersError != nil/, "header retrieval failure fails closed");
assert.match(edgePlugin, /callbackedge\.ParseForwardedHeaderCallback\([\s\S]*headers,/, "the plugin uses the unit-tested combined query and body-indicator contract");
assert.doesNotMatch(edgePlugin, /diagnostic|callback_predicate|vaeroex_public_synthetic_predicate/, "the temporary public callback diagnostic is absent");
assert.match(edgePlugin, /if err := proxywasm\.SendHttpResponse\([\s\S]*err != nil \{[\s\S]*panic\(err\)/, "a failed local rejection response escalates to fail_open=false plugin failure");
assert.match(edgePlugin, /clearReservedHandoffHeaders\(\)/, "reserved handoff headers receive a defense-in-depth purge before the trusted pair is appended");
assert.match(edgePlugin, /AddHttpRequestHeader\(callbackedge\.HandoffQueryHeader, handoff\.EncodedQuery\)/, "the edge forwards one safely encoded raw-query handoff");
assert.doesNotMatch(edgePlugin, /AddHttpRequestHeader\([^\n]*error_description/, "provider error descriptions never enter the internal request");
assert.match(edgeCloudBuild, /_SOURCE_COMMIT[\s\S]*\^\[a-f0-9\]\{40\}\$/, "callback-edge publication validates the reviewed source revision");
assert.match(edgeCloudBuild, /go test -count=1 \.\/\.\.\./, "the source-bound callback-edge build runs parser and plugin orchestration tests");
assert.match(workflow, /External integrations Square Production callback edge tests[\s\S]*go test -count=1 \.\/\.\.\./, "required CI runs parser and plugin orchestration tests");
assert.match(activationReadme, /Direct human build submission remains closed/, "manual callback-edge publication is explicitly closed");
assert.match(activationReadme, /only configured rebuild path is the `vaeroex-production-images` GitHub push trigger/, "future publication requires the source-bound reviewed trigger");
assert.match(releasePins, new RegExp(`source_commit\\s*=\\s*"${reviewedSourceCommit}"`), "the second-stage release is pinned to the reviewed source revision");
assert.match(releasePins, new RegExp(`oauth_callback_source_commit\\s*=\\s*"${reviewedOauthCallbackSourceCommit}"`), "the OAuth callback is pinned to its separately reviewed source revision");
assert.match(releasePins, new RegExp(`callback_edge_source_commit\\s*=\\s*"${reviewedCallbackEdgeSourceCommit}"`), "the callback edge is pinned to its distinct reviewed source revision");
assert.match(releasePins, new RegExp(`bootstrap_image_digest\\s*=\\s*"${reviewedBootstrapDigest}"`), "the reviewed bootstrap digest is pinned exactly");
assert.match(releasePins, new RegExp(`oauth_callback_image_digest\\s*=\\s*"${reviewedOauthCallbackDigest}"`), "the OAuth callback uses its separately scanned reviewed digest without revising peer services");
assert.match(releasePins, new RegExp(`callback_edge_image_digest\\s*=\\s*"${reviewedCallbackEdgeDigest}"`), "the independently scanned callback edge digest is pinned exactly");
for (const gate of [
  "runtime_enabled",
  "provider_calls_enabled",
  "customer_onboarding_enabled",
  "webhook_intake_enabled",
  "economic_contributions_enabled",
  "ai_dispatch_enabled",
]) {
  assert.match(releasePins, new RegExp(`${gate}\\s*=\\s*false`), `${gate} remains false in the pinned second-stage release`);
}

assert.match(main, /rotation_period\s*=\s*"7776000s"/);
assert.match(main, /roles\/cloudkms\.cryptoKeyEncrypterDecrypter/);
assert.match(main, /application-version-1-only/);
assert.match(main, /webhook-version-1-only/);
assert.match(main, /database-version-1-only/);
assert.match(main, /resource\.name == '\$\{local\.secret_version_names\.application\}'/);
assert.match(main, /resource\.name == '\$\{local\.secret_version_names\.webhook\}'/);
assert.match(main, /resource\.name == '\$\{local\.secret_version_names\.database\[each\.key\]\}'/);
assert.doesNotMatch(main, /resource\s+"google_secret_manager_secret_version"/, "Terraform never handles credential values");
assert.doesNotMatch(main, /secret_data|password|access_token|refresh_token/i, "Terraform has no credential inputs");

assert.match(main, /retention_days\s*=\s*30/, "configured application-platform logs have bounded retention");
assert.match(backend, /bucket\s*=\s*"vaeroex-integrations-prod-terraform-state"/, "Production state is isolated in its reviewed bucket");
assert.match(main, /name\s*=\s*"vaeroex-integrations-prod-build"/);
assert.match(main, /public_access_prevention\s*=\s*"enforced"/);
assert.match(main, /uniform_bucket_level_access\s*=\s*true/);
assert.match(main, /roles\/artifactregistry\.writer/);
assert.match(main, /roles\/iam\.serviceAccountUser/);
assert.match(main, /roles\/iam\.serviceAccountTokenCreator/);
assert.doesNotMatch(main, /roles\/cloudbuild\.builds\.editor/, "the operator cannot submit arbitrary builds");
assert.doesNotMatch(main, /operator_build_user/, "the operator cannot act as the dedicated builder");
assert.match(main, /resource "google_storage_bucket_iam_member" "build_candidate_writer"[\s\S]*role\s*=\s*"roles\/storage\.objectCreator"[\s\S]*release-candidates\//, "the builder can create only reviewed candidate records");
assert.doesNotMatch(main, /member\s*=\s*"user:\$\{var\.operator_email\}"[\s\S]{0,250}roles\/storage\.objectCreator|roles\/storage\.objectCreator[\s\S]{0,250}member\s*=\s*"user:\$\{var\.operator_email\}"/, "the operator cannot upload arbitrary staging source");
assert.match(main, /google_monitoring_notification_channel/);
assert.match(main, /validate_ssl\s*=\s*true/);
assert.match(main, /monitoring\.googleapis\.com\/uptime_check\/check_passed/);
assert.match(main, /max_concurrent_dispatches\s*=\s*10/);
assert.match(main, /max_dispatches_per_second\s*=\s*5/);
assert.match(main, /max_attempts\s*=\s*8/);
assert.match(main, /prevent_destroy\s*=\s*true/g);
assert.doesNotMatch(main, /quickbooks|qbo/i, "activation cannot mutate QBO resources");
assert.doesNotMatch(main, /supabase|migration|postgres/i, "cloud activation cannot apply database changes");
assert.doesNotMatch(outputs, /secret_data|password|token/i, "outputs remain non-secret");

assert.match(dockerfile, /^FROM gcr\.io\/distroless\/nodejs22-debian13@sha256:[a-f0-9]{64}$/m, "the bootstrap uses an immutable minimal runtime-only base image");
assert.match(dockerfile, /^COPY --chown=nonroot:nonroot package\.json callback-boundary\.mjs server\.mjs \.\/$/m, "the bootstrap copies only its runtime files as the unprivileged identity");
assert.deepEqual(dockerignore.trimEnd().split("\n"), ["*", "!package.json", "!callback-boundary.mjs", "!server.mjs"], "the minimal build context admits every and only Dockerfile COPY input");
assert.match(dockerfile, /^USER nonroot$/m, "the bootstrap does not run as root");
assert.match(dockerfile, /^CMD \["server\.mjs"\]$/m, "the distroless Node entrypoint receives only the reviewed runtime module");
// The remaining no-fix CVE-2026-85091 finding requires zlib's non-blocking
// gzwrite path. This dormant HTTP responder must not make that path reachable.
assert.equal(
  createHash("sha256").update(dockerfile).digest("hex"),
  "a94896fde4c3a4f423b5b09cb7b899809089bd5ee9f8f25ea73e70a022ac8867",
  "every executable bootstrap image change requires an explicit reviewed fingerprint update",
);
assert.equal(
  createHash("sha256").update(serverSource).digest("hex"),
  "9df82e10ee028ccb895ec4b95452d1a0b635013135821f444f1e7a2fd2f582f0",
  "every executable bootstrap server change requires an explicit reviewed fingerprint update",
);
assert.equal(
  createHash("sha256").update(callbackBoundarySource).digest("hex"),
  "dcad858b2abd699ee64f0b2b566a3d70f818fad2ceb3e2fbeee252efb673a69a",
  "every executable callback boundary change requires an explicit reviewed fingerprint update",
);
assert.deepEqual(bootstrapPackage.dependencies ?? {}, {}, "the bootstrap has no runtime package dependency that could add compression");
assert.match(callbackBoundarySource, /SQUARE_PRODUCTION_HOST = "square\.vaeroex\.com"/, "the backend accepts only the exact Production TLS host");
assert.match(callbackBoundarySource, /SQUARE_EDGE_INPUT_MAX_HEADER_COUNT = 64/, "the edge input envelope is explicitly bounded at 64 headers");
assert.match(callbackBoundarySource, /SQUARE_BACKEND_MAX_HEADER_COUNT = SQUARE_EDGE_INPUT_MAX_HEADER_COUNT \+ 2/, "the backend admits only the edge envelope plus its two trusted handoff headers");
assert.match(serverSource, /http\.createServer\(\{ maxHeaderSize: 32_768 \}/, "the Node parser retains an explicit 32 KiB aggregate header byte ceiling");
assert.match(serverSource, /server\.maxHeadersCount = 0/, "Node preserves complete raw headers so the callback boundary can apply the explicit 66-header cap without truncation");
assert.match(callbackBoundarySource, /input\.method !== "GET" \|\| input\.url !== SQUARE_CALLBACK_PATH/, "the backend independently requires the exact queryless GET callback route");
assert.match(callbackBoundarySource, /\["forwarded", "x-forwarded-host", "x-original-url", "x-rewrite-url"\]/, "forwarded authority cannot select the Production callback backend");
assert.match(callbackBoundarySource, /csrfVerified !== true[\s\S]*currentGeneration !== value\.generation[\s\S]*expiresAtMs <= nowMs[\s\S]*consumedAtMs !== nowMs/, "state consumption binds CSRF, current generation, expiry, and first-use time");
assert.match(callbackBoundarySource, /consumeState\(Object\.freeze\(\{ stateHash, nowMs \}\)\)/, "the backend delegates one hashed state consumption without forwarding raw state");
assert.doesNotMatch(callbackBoundarySource, /fetch\(|https:\/\/connect\.square|secret|credential/i, "the disabled backend boundary has no provider or credential capability");

async function exerciseBootstrap() {
  const port = 19_000 + Math.floor(Math.random() * 1_000);
  const sourceCommit = "b".repeat(40);
  const child = spawn(process.execPath, [serverPath], {
    env: { PATH: process.env.PATH, PORT: String(port), VAEROEX_SOURCE_COMMIT: sourceCommit },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childExited = new Promise((resolve) => child.once("exit", resolve));
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/integrations/square/callback?code=synthetic-sensitive`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "synthetic-body",
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.ok(response, `bootstrap did not start: ${stderr.slice(0, 120)}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-vaeroex-source-commit"), sourceCommit);
    assert.deepEqual(await response.json(), { error: "production_integration_runtime_disabled" });

    const state = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE";
    const callbackHeaders = {
      host: "square.vaeroex.com",
      "x-vaeroex-oauth-handoff-version": "square_oauth_callback_handoff_v1",
      "x-vaeroex-oauth-query": Buffer.from(`state=${state}&code=synthetic-code`).toString("base64url"),
    };
    const validHandoff = await fetch(`http://127.0.0.1:${port}/api/integrations/square/callback`, { headers: callbackHeaders });
    assert.equal(validHandoff.status, 404, "the exact edge output reaches only the disabled callback backend");
    assert.deepEqual(await validHandoff.json(), { error: "production_integration_runtime_disabled" });

    const malformedHandoff = await fetch(`http://127.0.0.1:${port}/api/integrations/square/callback`, { headers: {
      ...callbackHeaders,
      "x-vaeroex-oauth-query": Buffer.from(`state=${state}&code=x&code=y`).toString("base64url"),
    } });
    assert.equal(malformedHandoff.status, 404, "backend OAuth semantics fail without a public parsing oracle");
    assert.deepEqual(await malformedHandoff.json(), { error: "production_integration_runtime_disabled" });

    const forgedHandoff = await fetch(`http://127.0.0.1:${port}/api/integrations/square/callback`, { headers: {
      ...callbackHeaders,
      "x-vaeroex-oauth-state": state,
    } });
    assert.equal(forgedHandoff.status, 404, "legacy or forged internal handoffs fail without a public parsing oracle");
    assert.deepEqual(await forgedHandoff.json(), { error: "production_integration_runtime_disabled" });

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "disabled" });
    const head = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    for (const candidate of ["/", "/health", "/metrics", "/admin", "/api/integrations/square/webhook"]) {
      const denied = await fetch(`http://127.0.0.1:${port}${candidate}`);
      assert.equal(denied.status, 404, `${candidate} remains unavailable`);
      assert.deepEqual(await denied.json(), { error: "production_integration_runtime_disabled" });
    }
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await childExited;
  }
  assert.equal(stderr, "", "the dormant runtime emits no request data or diagnostics");
}

exerciseBootstrap().then(
  () => console.log("production integration activation regression tests passed"),
  (error) => {
    console.error(error instanceof Error ? error.message : "production integration activation regression tests failed");
    process.exitCode = 1;
  },
);
