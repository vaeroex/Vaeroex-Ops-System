const assert = require("node:assert/strict");
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
const serverPath = path.join(root, "services/external-integrations-production/bootstrap-runtime/server.mjs");
const edgeCallback = read("services/external-integrations-production/callback-edge/callback.go");
const edgePlugin = read("services/external-integrations-production/callback-edge/plugin/main.go");
const edgeCloudBuild = read("services/external-integrations-production/callback-edge/cloudbuild.yaml");
const activationPath = path.join(root, "services/external-integrations-production/infra/activation");

function runTerraform(args) {
  const result = spawnSync(process.env.TERRAFORM_BIN || "terraform", args, {
    cwd: activationPath,
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, `terraform ${args[0]} failed: ${(result.stderr || result.stdout || "unknown").slice(0, 500)}`);
}

runTerraform(["fmt", "-check", "-recursive"]);
runTerraform(["init", "-backend=false", "-input=false"]);
runTerraform(["validate"]);

assert.match(versions, /version\s*=\s*"7\.34\.0"/, "the Google provider is pinned exactly");
assert.match(variables, /var\.project_id == "vaeroex-integrations-prod"/, "the activation cannot target another project");
assert.match(variables, /var\.region == "us-west1"/, "the activation cannot create an extra region");
assert.match(variables, /bootstrap_image_digest == null/, "the first apply creates no runtime");
assert.match(variables, /production-bootstrap@sha256:\[a-f0-9\]\{64\}/, "a runtime image must be an immutable digest in the isolated repository");
assert.match(variables, /square-callback-edge@sha256:\[a-f0-9\]\{64\}/, "the callback edge image must be an immutable digest in the isolated repository");
assert.match(main, /deployment_inputs_valid/, "runtime and callback-edge artifacts must be deployed together");
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
assert.match(main, /local\.deployment_enabled \? local\.public_modes : toset\(\[\]\)/, "only the two public modes can receive invoker bindings");
assert.match(main, /public_modes = toset\(\["oauth", "webhook"\]\)/);
assert.match(main, /INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER/);
assert.match(main, /INGRESS_TRAFFIC_INTERNAL_ONLY/);
assert.match(main, /member\s*=\s*"allUsers"/);

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
assert.match(main, /log_config\s*\{\s*enable\s*=\s*false\s*\}/, "callback query strings are not written to load-balancer request logs");
assert.match(main, /google_network_services_wasm_plugin" "square_callback"/, "Square callbacks use a managed immutable query-stripping edge");
assert.match(main, /google_network_services_lb_edge_extension" "square_callback"[\s\S]*fail_open\s*=\s*false/, "the callback edge fails closed");
assert.match(main, /forward_headers = \[[\s\S]*x-vaeroex-oauth-code[\s\S]*x-vaeroex-oauth-state[\s\S]*\]/, "only the bounded internal OAuth handoff headers cross the edge");
assert.match(edgeCallback, /CallbackPath\s*=\s*"\/api\/integrations\/square\/callback"/, "the edge accepts only the Square callback path");
assert.match(edgeCallback, /WebhookPath\s*=\s*"\/api\/integrations\/square\/webhook"/, "the edge permits only the exact queryless Square webhook pass-through");
assert.match(edgeCallback, /error_description/, "the edge recognizes provider denial descriptions without forwarding them");
assert.match(edgePlugin, /ReplaceHttpRequestHeader\(":path", callbackedge\.CallbackPath\)/, "the edge strips the OAuth query before Cloud Run request logging");
assert.match(edgePlugin, /clearReservedHandoffHeaders\(\)/, "client-forged handoff headers are removed before forwarding");
assert.doesNotMatch(edgePlugin, /AddHttpRequestHeader\([^\n]*error_description/, "provider error descriptions never enter the internal request");
assert.match(edgeCloudBuild, /_SOURCE_COMMIT[\s\S]*\^\[a-f0-9\]\{40\}\$/, "callback-edge publication validates the reviewed source revision");

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
assert.match(main, /roles\/cloudbuild\.builds\.editor/);
assert.match(main, /roles\/iam\.serviceAccountUser/);
assert.match(main, /roles\/iam\.serviceAccountTokenCreator/);
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
assert.match(dockerfile, /^COPY --chown=nonroot:nonroot package\.json server\.mjs \.\/$/m, "the bootstrap copies only its runtime files as the unprivileged identity");
assert.match(dockerfile, /^USER nonroot$/m, "the bootstrap does not run as root");
assert.match(dockerfile, /^CMD \["server\.mjs"\]$/m, "the distroless Node entrypoint receives only the reviewed runtime module");

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
