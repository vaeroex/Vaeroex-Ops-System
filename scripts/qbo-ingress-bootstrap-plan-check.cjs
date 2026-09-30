/* eslint-disable @typescript-eslint/no-require-imports -- Read-only saved-plan allowlist. */
const fs = require("node:fs");
const assert = require("node:assert/strict");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const commit = process.argv[3];
assert.match(commit ?? "", /^[a-f0-9]{40}$/);
assert.equal(plan.variables.source_commit.value, commit);
const expected = new Map([
  ['google_service_account.service["oauth_ingress"]', ["account_id", "qbo-oauth-ingress"]],
  ['google_cloud_run_v2_service.service["oauth_ingress"]', ["name", "qbo-production-oauth-ingress"]],
  ["module.callback.google_compute_global_address.callback", ["name", "qbo-production-callback-ip"]],
  ["module.callback.google_compute_managed_ssl_certificate.callback", ["name", "qbo-production-callback-cert"]],
  ["module.callback.google_compute_region_network_endpoint_group.callback", ["name", "qbo-production-callback-neg"]],
  ["module.callback.google_compute_backend_service.callback", ["name", "qbo-production-callback-backend"]],
  ["module.callback.google_compute_url_map.callback", ["name", "qbo-production-callback-url-map"]],
  ["module.callback.google_compute_target_https_proxy.callback", ["name", "qbo-production-callback-https-proxy"]],
  ["module.callback.google_compute_global_forwarding_rule.callback", ["name", "qbo-production-callback-https"]],
  ["module.callback.google_network_services_wasm_plugin.callback", ["name", "qbo-production-callback-edge"]],
  ["module.callback.google_network_services_lb_edge_extension.callback", ["name", "qbo-production-callback-extension"]]
]);
assert.equal(plan.errored, false);
assert.equal(plan.complete, true);
assert.equal(plan.resource_changes.length, expected.size);
for (const resource of plan.resource_changes) {
  const identity = expected.get(resource.address);
  assert.ok(identity, `Unexpected resource: ${resource.address}`);
  assert.deepEqual(resource.change.actions, ["create"]);
  assert.equal(resource.change.after[identity[0]], identity[1]);
  assert.equal(resource.change.after.project, "vaeroex-qbo-prod-20260827");
  expected.delete(resource.address);
}
assert.equal(expected.size, 0);
const after = address => plan.resource_changes.find(item => item.address === address).change.after;
const run = after('google_cloud_run_v2_service.service["oauth_ingress"]');
assert.equal(run.location, "us-central1");
assert.equal(run.ingress, "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER");
assert.equal(run.default_uri_disabled, true);
assert.equal(run.invoker_iam_disabled, true);
assert.equal(run.template[0].scaling[0].min_instance_count, 0);
assert.equal(run.template[0].scaling[0].max_instance_count, 1);
assert.deepEqual(run.template[0].vpc_access, []);
const container = run.template[0].containers[0];
assert.equal(container.image, plan.variables.image_digest.value);
assert.match(container.image, /\/qbo-production\/runtime@sha256:[a-f0-9]{64}$/);
assert.deepEqual(Object.fromEntries(container.env.map(item => [item.name, item.value])), {
  QBO_INGRESS_BOOTSTRAP_ONLY: "true", QBO_SERVICE_MODE: "oauth_ingress", QBO_SOURCE_COMMIT: commit
});
assert.ok(container.env.every(item => item.value_source.length === 0));
const plugin = after("module.callback.google_network_services_wasm_plugin.callback");
assert.equal(plugin.versions[0].image_uri, plan.variables.callback_edge_image_digest.value);
assert.equal(plugin.log_config[0].enable, false);
assert.deepEqual(JSON.parse(Buffer.from(plugin.versions[0].plugin_config_data, "base64").toString()), { allowedHost: "integrations.vaeroex.com" });
assert.equal(after("module.callback.google_compute_backend_service.callback").log_config[0].enable, false);
assert.equal(after("module.callback.google_network_services_lb_edge_extension.callback").extension_chains[0].extensions[0].fail_open, false);
assert.deepEqual(plan.output_changes.processing_state.after, {
  bootstrapOnly: true, modelCallCount: 0, oauthProcessingEnabled: false,
  promotionAuthorized: false, readyForProviderProcessing: false, webhookProcessingEnabled: false
});
console.log("Saved plan qualified: exactly 11 ingress-only creates, 0 updates, 0 deletes; no secrets, database, broker, queues, schedulers, NAT or DNS.");
