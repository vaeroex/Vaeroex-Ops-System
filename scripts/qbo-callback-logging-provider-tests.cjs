/* eslint-disable @typescript-eslint/no-require-imports -- Isolated pinned-provider regression, no cloud access. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const terraform = process.argv[2];
const plugins = process.argv[3];
assert.ok(terraform && plugins, "Usage: node scripts/qbo-callback-logging-provider-tests.cjs <terraform> <installed-provider-directory>");
const moduleSource = fs.readFileSync(path.join(root, "services/external-integrations-qbo/infra/modules/callback/main.tf"), "utf8");
const plugin = moduleSource.slice(moduleSource.indexOf('resource "google_network_services_wasm_plugin"'), moduleSource.indexOf('resource "google_network_services_lb_edge_extension"'));
assert.ok(plugin.length > 0);
assert.doesNotMatch(plugin, /ignore_changes/);
assert.doesNotMatch(plugin, /\blog_config\s*\{/);
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-logging-provider-test-"));
const source = "a".repeat(40);
const version = `v${source.slice(0, 12)}`;
const image = `us-central1-docker.pkg.dev/fixture-project/fixture/edge@sha256:${"b".repeat(64)}`;
let logging, requests = 0, mutations = 0;
const server = http.createServer((request, response) => {
  requests++;
  if (request.method !== "GET") {
    mutations++;
    response.writeHead(405).end();
    return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/projects/fixture-project/locations/global/wasmPlugins/fixture-edge"
    || url.searchParams.get("view") !== "WASM_PLUGIN_VIEW_FULL") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({
    name: "projects/fixture-project/locations/global/wasmPlugins/fixture-edge",
    description: "Vaeroex QBO bounded OAuth callback and webhook edge",
    mainVersionId: version,
    ...(logging === undefined ? {} : { logConfig: logging }),
    versions: { [version]: {
      description: `Immutable callback edge for source ${source}`,
      imageUri: image,
      pluginConfigData: Buffer.from(JSON.stringify({ allowedHost: "integrations.example.test" })).toString("base64")
    } }
  }));
});
const env = {
  PATH: process.env.PATH, HOME: cwd, TMPDIR: os.tmpdir(),
  CHECKPOINT_DISABLE: "1", TF_IN_AUTOMATION: "1"
};
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(terraform, args, { cwd, env });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => stdout += value);
    child.stderr.on("data", value => stderr += value);
    child.on("error", reject);
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}
async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  fs.copyFileSync(path.join(root, "services/external-integrations-qbo/infra/bootstrap/.terraform.lock.hcl"), path.join(cwd, ".terraform.lock.hcl"));
  fs.writeFileSync(path.join(cwd, "main.tf"), `
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "7.39.0" }
  }
}
provider "google" {
  project = "fixture-project"
  deletion_policy = "PREVENT"
  access_token = "local-fixture-not-a-credential"
  network_services_custom_endpoint = "http://127.0.0.1:${server.address().port}/"
}
variable "callback_wasm_plugin_name" { default = "fixture-edge" }
variable "source_commit" { default = "${source}" }
variable "callback_edge_image_digest" { default = "${image}" }
variable "oauth_callback_hostname" { default = "integrations.example.test" }
${plugin}
import {
  to = google_network_services_wasm_plugin.callback
  id = "projects/fixture-project/locations/global/wasmPlugins/fixture-edge"
}
`);
  const init = await run(["init", "-input=false", "-no-color", "-lockfile=readonly", `-plugin-dir=${path.resolve(plugins)}`]);
  assert.equal(init.status, 0, init.stderr);
  for (const [name, response, expectedActions] of [
    ["omitted_disabled", undefined, ["no-op"]],
    ["empty_disabled", {}, ["no-op"]],
    ["explicitly_disabled", { enable: false }, ["update"]],
    ["enabled_drift", { enable: true, sampleRate: 1, minLogLevel: "INFO" }, ["update"]]
  ]) {
    logging = response;
    const plan = await run(["plan", "-input=false", "-no-color", "-out=fixture.tfplan"]);
    assert.equal(plan.status, 0, plan.stderr);
    const show = await run(["show", "-json", "fixture.tfplan"]);
    assert.equal(show.status, 0, show.stderr);
    const parsed = JSON.parse(show.stdout);
    assert.equal(parsed.errored, false);
    assert.equal(parsed.resource_changes.length, 1);
    const change = parsed.resource_changes[0].change;
    assert.deepEqual(change.actions, expectedActions, `${name}: ${JSON.stringify(Object.keys(change.after).filter(key => JSON.stringify(change.before[key]) !== JSON.stringify(change.after[key])).map(key => [key, change.before[key], change.after[key]]))}`);
    assert.deepEqual(change.after.log_config, [], name);
    if (response && Object.hasOwn(response, "enable")) {
      assert.equal(change.before.log_config[0].enable, response.enable, name);
    }
    assert.equal(mutations, 0);
    console.log(`${name}: ${expectedActions[0]}; actual google 7.39.0 refresh/plan; no apply`);
  }
  assert.ok(requests >= 4);
  assert.equal(mutations, 0);
  assert.equal(fs.existsSync(path.join(cwd, "terraform.tfstate")), false);
  console.log("Callback logging: 4 pinned-provider cases passed; enabled logging remains detectable; no cloud calls or state edits.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  server.close();
  fs.rmSync(cwd, { recursive: true, force: true });
});
