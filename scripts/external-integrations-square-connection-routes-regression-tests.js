const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadSquareBrowserModules } = require("./square-account-browser-test-support.js");
const modules = loadSquareBrowserModules();
const { createSquareCustomerHandlers, SQUARE_CUSTOMER_SETTINGS_PATH, SQUARE_CUSTOMER_API_PATH } = modules;
const root = path.resolve(__dirname, "..");
const origin = "http://127.0.0.1:31999";
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const actor = { actorId: uuid(1), workspaceId: uuid(2), sessionId: uuid(3), role: "owner" };
const connectionId = uuid(4), businessEntityId = uuid(5);
const code = "SQUARE_AUTH_CODE_PRIVATE_CANARY", state = "S".repeat(43);
const view = { canManage: true, businessEntities: [{ id: businessEntityId, label: "Synthetic business" }], connections: [{ connectionId, businessEntityId, state: "mapping_required", sellerLabel: "Verified synthetic seller", locations: [{ id: "LOC_SYNTHETIC", label: "Synthetic location" }], mappedLocationIds: [], retentionApproved: true, revocationPending: false }] };
let calls = [], authenticateCalls = 0, currentActor = actor, currentView = view;
let assertions = 0;
const equal = (a, b, label) => { assertions++; assert.equal(a, b, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const service = {
  async initiate(a, input) { calls.push({ operation: "initiate", actor: a, input }); return { authorizationUrl: "https://connect.squareupsandbox.com/oauth2/authorize?state=fixture" }; },
  async complete(a, input) { calls.push({ operation: "complete", actor: a, input }); },
  async snapshot(a) { calls.push({ operation: "snapshot", actor: a }); return currentView; },
  async confirmMapping(a, input) { calls.push({ operation: "mapping", actor: a, input }); },
  async disconnect(a, input) { calls.push({ operation: "disconnect", actor: a, input }); }
};
const configuration = { qualification: "disposable_local_synthetic_only", applicationOrigin: origin,
  async authenticate() { authenticateCalls++; return currentActor; }, service,
  resolveAuthorizationNavigation: () => `${origin}/__square_synthetic_provider/authorize?fixture=1` };
const request = (action, body, headers = {}, options = {}) => new Request(`${origin}${SQUARE_CUSTOMER_API_PATH}/${action}`, {
  method: action === "status" || action === "callback" ? "GET" : "POST",
  headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", ...headers },
  ...(body === undefined ? {} : { body }), ...options
});
const form = (value) => new URLSearchParams(value).toString();
async function main() {
  const handlers = createSquareCustomerHandlers(configuration);
  const availability = require("../lib/integrations/control-plane/square-customer-availability.ts");
  for (const action of modules.SQUARE_CUSTOMER_ACTIONS) {
    const entry = require(`../app/api/integrations/square/${action}/route.ts`);
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      equal((await entry[method](new Request(`${origin}${SQUARE_CUSTOMER_API_PATH}/${action}`, { method }))).status, 404, "every disabled method is 404");
    }
  }
  equal(authenticateCalls, 0, "disabled wrappers do not authenticate");
  equal((await handlers.handle("webhook", request("webhook", "{}"))).status, 404, "unconfigured webhook stays closed");
  let notificationCalls = 0, signedBody;
  const notifications = createSquareCustomerHandlers({ ...configuration, notify: async (incoming) => {
    notificationCalls++; signedBody = await incoming.text();
    return new Response("PRIVATE_WEBHOOK_RESULT_CANARY", { status: 202, headers: { "x-private": "PRIVATE_HEADER_CANARY" } });
  } });
  const authBeforeNotification = authenticateCalls;
  const rawNotification = "{ \"synthetic\": \"\\u0041\" }";
  const acknowledgment = await notifications.handle("webhook", request("webhook", rawNotification, { origin: "https://provider.example", "content-type": "application/json", "sec-fetch-site": "cross-site" }));
  equal(acknowledgment.status, 202); equal(notificationCalls, 1); equal(signedBody, rawNotification);
  equal(authenticateCalls, authBeforeNotification, "signature host handles notifications without customer cookies");
  equal(await acknowledgment.text(), ""); equal(acknowledgment.headers.get("x-private"), null);
  equal((await notifications.handle("webhook", new Request(`${origin}${SQUARE_CUSTOMER_API_PATH}/webhook`))).status, 400);
  equal(notificationCalls, 1, "wrong notification method cannot dispatch");
  equal(await availability.squareCustomerPageView(new Request(origin + SQUARE_CUSTOMER_SETTINGS_PATH)), null);
  const restore = availability.installSquareLocalQualification(configuration);
  equal(availability.squareCustomerConnectionsEnabled(), true);
  equal((await availability.squareCustomerRoute("status", request("status"))).status, 200);
  restore(); equal(availability.squareCustomerConnectionsEnabled(), false);
  for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV", "VERCEL_REGION", "NODE_ENV"]) {
    const previous = process.env[key]; process.env[key] = key === "NODE_ENV" ? "production" : "0";
    try {
      const before = authenticateCalls;
      equal((await handlers.handle("status", request("status"))).status, 404);
      equal(authenticateCalls, before, "environment closure precedes auth");
      assertions++; assert.throws(() => createSquareCustomerHandlers(configuration), /configuration_invalid/);
    } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  }
  for (const applicationOrigin of ["https://app.example.com", "http://127.0.0.1:31999/", "http://user@127.0.0.1:31999", "http://127.0.0.1.evil.test:31999", "http://localhost:31999/path", "http://127.0.0.1:31999?flag=true"]) {
    assertions++; assert.throws(() => createSquareCustomerHandlers({ ...configuration, applicationOrigin }));
  }
  equal((await handlers.handle("status", new Request(`https://www.vaeroex.com${SQUARE_CUSTOMER_API_PATH}/status`))).status, 404);
  const connected = await handlers.handle("connect", request("connect", form({ businessEntityId })));
  equal(connected.status, 200);
  const connectedHtml = await connected.text();
  ok(connectedHtml.includes("history.replaceState") && connectedHtml.includes("location.replace"));
  ok(!connectedHtml.includes("<form"), "handoff avoids inherited form-action redirect constraints");
  equal(connected.headers.get("referrer-policy"), "no-referrer");
  ok(connected.headers.get("content-security-policy").includes("default-src 'none'"));
  const good = calls.at(-1); equal(good.actor.actorId, actor.actorId); equal(good.actor.sessionId, actor.sessionId);
  equal(good.input.businessEntityId, businessEntityId);
  for (const [body, headers] of [
    [form({ businessEntityId }), { origin: "https://foreign.example" }],
    [form({ businessEntityId }), { "sec-fetch-site": "cross-site" }],
    [`businessEntityId=${businessEntityId}&businessEntityId=${businessEntityId}`, {}],
    [`businessEntityId=${businessEntityId}&actorId=${uuid(9)}`, {}],
    [`businessEntityId=${businessEntityId}&sessionId=${uuid(9)}`, {}],
    [`businessEntityId=${businessEntityId}&extra=%ZZ`, {}],
    ["x".repeat(278529), {}],
    [form({ businessEntityId }), { "content-type": "application/json" }],
    [form({ businessEntityId }), { "content-length": "278529" }]
  ]) {
    const before = calls.length;
    ok((await handlers.handle("connect", request("connect", body, headers))).status >= 400);
    equal(calls.length, before, "invalid/CSRF body does not invoke lifecycle");
  }
  for (const role of ["staff", "viewer"]) {
    currentActor = { ...actor, role };
    equal((await handlers.handle("connect", request("connect", form({ businessEntityId })))).status, 403);
    const result = await (await handlers.handle("status", request("status"))).json();
    equal(result.view.canManage, false);
  }
  currentActor = null; equal((await handlers.handle("status", request("status"))).status, 400); currentActor = actor;
  const callback = (suffix) => new Request(`${origin}${SQUARE_CUSTOMER_API_PATH}/callback?${suffix}`, { headers: { "sec-fetch-site": "cross-site" } });
  const result = await handlers.handle("callback", callback(form({ state, code })));
  equal(calls.at(-1).operation, "complete"); equal(calls.at(-1).input.code, code);
  const html = await result.text();
  for (const canary of [state, code, "PRIVATE_PROVIDER_ERROR_CANARY"]) ok(!html.includes(canary));
  equal(result.headers.get("location"), null);
  ok(html.includes(`history.replaceState(null,\"\",\"${SQUARE_CUSTOMER_API_PATH}/callback\")`));
  ok(html.includes(`location.replace(\"${SQUARE_CUSTOMER_SETTINGS_PATH}\")`));
  await handlers.handle("callback", callback(form({ state, error: "access_denied", error_description: "PRIVATE_PROVIDER_ERROR_CANARY" })));
  equal(calls.at(-1).input.error, "access_denied"); ok(!JSON.stringify(calls.at(-1)).includes("PRIVATE_PROVIDER_ERROR_CANARY"));
  await handlers.handle("callback", callback(form({ state, code, response_type: "code" })));
  equal(calls.at(-1).input.code, code, "documented optional response_type=code is accepted");
  await handlers.handle("callback", callback(form({ state: `r1_${state}`, code })));
  equal(calls.at(-1).input.state, `r1_${state}`, "reauthorization state format remains exact");
  await handlers.handle("callback", callback(form({ state, error: "PRIVATE_OTHER_PROVIDER_ERROR" })));
  equal(calls.at(-1).input.error, "access_denied", "other provider rejection is a fixed denial, never raw output");
  for (const suffix of [`state=${state}&code=${code}&code=second`, `state=${state}&state=${state}&code=${code}`, `state=${state}`, `state=${state}&code=${code}&error=access_denied`, `state=${state}&error=`, `state=${state}&code=${code}&merchant_id=FORGED`, `state=${state}&code=${code}&error_description=untrusted`, `state=${state}&code=${code}&response_type=token`, `state=${state}&error=access_denied&response_type=code`, `state=${state}&code=${"c".repeat(192)}`]) {
    const before = calls.length;
    const rejected = await handlers.handle("callback", callback(suffix)); equal(rejected.status, 200);
    equal(calls.length, before, "malformed callback is scrubbed without lifecycle work");
    const rejectedHtml = await rejected.text(); ok(!rejectedHtml.includes(code));
  }
  const mapping = { connectionId, businessEntityId, locationIds: "LOC_SYNTHETIC", confirmation: "map" };
  equal((await handlers.handle("mapping", request("mapping", form(mapping)))).status, 303);
  equal(calls.at(-1).input.locationIds[0], "LOC_SYNTHETIC");
  equal((await handlers.handle("mapping", request("mapping", form({ ...mapping, locationIds: "LOC:1.2-3_4" })))).status, 303);
  equal(calls.at(-1).input.locationIds[0], "LOC:1.2-3_4", "verified location punctuation survives customer mapping");
  const maximumMapping = new URLSearchParams({ connectionId, businessEntityId, confirmation: "map" });
  for (let i = 0; i < 500; i++) maximumMapping.append("locationIds", `${":".repeat(29)}${i.toString(16).padStart(3, "0")}`);
  equal(maximumMapping.toString().length, 51620, "maximum cardinality/length mapping stresses percent-encoding under the proven 54620-byte ceiling");
  equal((await handlers.handle("mapping", request("mapping", maximumMapping.toString()))).status, 303);
  equal(calls.at(-1).input.locationIds.length, 500, "every supported location can be explicitly mapped together");
  for (const body of [form({ ...mapping, confirmation: "no" }), form(mapping) + "&locationIds=LOC_SYNTHETIC", form({ connectionId, businessEntityId, confirmation: "map" })]) {
    const before = calls.length; equal((await handlers.handle("mapping", request("mapping", body))).status, 400); equal(calls.length, before);
  }
  equal((await handlers.handle("disconnect", request("disconnect", form({ connectionId })))).status, 400);
  equal((await handlers.handle("disconnect", request("disconnect", form({ connectionId, confirmation: "disconnect" })))).status, 303);
  equal((await handlers.handle("reauthorize", request("reauthorize", form({ connectionId, businessEntityId })))).status, 200);
  equal(calls.at(-1).input.operation, "reauthorize");
  let cancelled = false;
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(278529)); }, cancel() { cancelled = true; } });
  equal((await handlers.handle("connect", request("connect", oversized, {}, { duplex: "half" }))).status, 400); ok(cancelled);
  const aborted = new AbortController(); aborted.abort();
  equal((await handlers.handle("connect", request("connect", new ReadableStream({ cancel() { cancelled = true; } }), {}, { duplex: "half", signal: aborted.signal }))).status, 400);
  const tiny = new ReadableStream({ start(controller) { for (let i = 0; i < 1025; i++) controller.enqueue(new Uint8Array()); controller.close(); } });
  equal((await handlers.handle("connect", request("connect", tiny, {}, { duplex: "half" }))).status, 400);
  let stalledCancelled = false;
  const stalled = new ReadableStream({ cancel() { stalledCancelled = true; } });
  equal((await handlers.handle("connect", request("connect", stalled, {}, { duplex: "half" }))).status, 400);
  ok(stalledCancelled, "one request-lifetime deadline cancels an outstanding body read");
  equal((await handlers.handle("connect", request("connect", "&".repeat(1004)))).status, 400, "field count rejects before form-object expansion");
  currentView = { ...view, raw: "PRIVATE_PROVIDER_CANARY" };
  const unsafe = await handlers.handle("status", request("status")); equal(unsafe.status, 400); ok(!(await unsafe.text()).includes("PRIVATE_PROVIDER_CANARY")); currentView = view;
  const rendered = modules.renderToStaticMarkup(modules.React.createElement(modules.SquareConnectionPanel, { view }));
  ok(rendered.includes("Mapping required")); ok(rendered.includes("Confirm location mapping"));
  ok(rendered.includes("including its other connections"), "confirmed disconnect explains merchant/application-wide revocation");
  ok(!rendered.includes("Last successful sync") && !rendered.includes(">Current<") && !rendered.includes(">Synced<"));
  const escaped = modules.renderToStaticMarkup(modules.React.createElement(modules.SquareConnectionPanel, { view: { ...view, connections: [{ ...view.connections[0], sellerLabel: "<script>PRIVATE_DISPLAY_CANARY</script>" }] } }));
  ok(!escaped.includes("<script>PRIVATE_DISPLAY_CANARY</script>"));
  const gatedPage = fs.readFileSync(path.join(root, "app/(square-connection)/app/settings/integrations/square/page.tsx"), "utf8");
  ok(gatedPage.indexOf("if (!squareCustomerConnectionsEnabled()) notFound()") < gatedPage.indexOf("await headers()"));
  ok(!fs.existsSync(path.join(root, "app/app/settings/integrations/square/page.tsx")), "disabled page bypasses protected parent authentication");
  console.log(`Square connection route regression tests passed: ${assertions} assertions.`);
}
main().catch(() => { console.error("Square connection route regression tests failed."); process.exitCode = 1; });
