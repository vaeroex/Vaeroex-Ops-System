const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
let loaded = false;
function loadSquareBrowserModules() {
  if (!loaded) {
    const ts = require("typescript");
    for (const extension of [".ts", ".tsx"]) require.extensions[extension] = function(module, filename) {
      module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename
      }).outputText, filename);
    };
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(request, parent, isMain, options) {
      if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
      return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
    };
    loaded = true;
  }
  return {
    ...require("../lib/integrations/control-plane/square-customer-routes.ts"),
    ...require("../components/integrations/SquareConnectionPanel.tsx"),
    React: require("react"),
    renderToStaticMarkup: require("react-dom/server").renderToStaticMarkup
  };
}

/**
 * A loopback-only disposable browser host. The caller supplies the authenticated
 * synthetic host session and real disposable-database service, not actor headers.
 * Neither fixture provider nor session endpoints are installed in Next/Vercel.
 */
async function createSquareBrowserQualificationServer(options) {
  const modules = loadSquareBrowserModules();
  if (!modules.squareLocalQualificationEnvironmentAllowed()) throw new Error("square_browser_qualification_environment_denied");
  const events = [];
  let handlers;
  let origin;
  let providerOrigin;
  const sockets = new Set();
  const server = http.createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    incoming.on("aborted", () => abort.abort());
    try {
      const applicationHost = new URL(origin).host;
      const providerHost = new URL(providerOrigin).host;
      const isProviderHost = providerOrigin !== origin && incoming.headers.host === providerHost;
      if ((incoming.headers.host !== applicationHost && !isProviderHost) || !modules.squareLocalQualificationEnvironmentAllowed()) {
        outgoing.writeHead(404, { "cache-control": "no-store" }); outgoing.end(); return;
      }
      const url = new URL(incoming.url, isProviderHost ? providerOrigin : origin);
      if (isProviderHost && !url.pathname.startsWith("/__square_synthetic_provider/")) {
        outgoing.writeHead(404, { "cache-control": "no-store" }); outgoing.end(); return;
      }
      const method = incoming.method ?? "GET";
      const request = new Request(url, {
        method,
        headers: new Headers(Object.entries(incoming.headers).flatMap(([key, value]) => value === undefined ? [] : [[key, Array.isArray(value) ? value.join(", ") : value]])),
        ...(method === "GET" || method === "HEAD" ? {} : { body: require("node:stream").Readable.toWeb(incoming), duplex: "half" }),
        signal: abort.signal
      });
      let response;
      if (url.pathname.startsWith("/__square_host_session/") && options.handleHostSession) {
        response = await options.handleHostSession(request);
        events.push("host_session_fixture");
      } else if (url.pathname.startsWith("/__square_synthetic_provider/")) {
        if (providerOrigin !== origin && !isProviderHost) {
          // Only the local fixture makes this second-site hop. The shared customer
          // handler still permits exactly its own local fixture navigation path.
          response = new Response(null, { status: 303, headers: { location: providerOrigin + url.pathname + url.search, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
        } else {
          response = await options.handleSyntheticProvider(request);
          const location = response.headers.get("location");
          if (isProviderHost && location?.startsWith(modules.SQUARE_CUSTOMER_CALLBACK_PATH + "?")) {
            // Relative fixture callbacks return to the application site, never
            // a customer/session endpoint on the synthetic provider's hostname.
            const headers = new Headers(response.headers);
            headers.set("location", origin + location);
            response = new Response(response.body, { status: response.status, headers });
          }
        }
        events.push("provider_fixture");
      } else if (url.pathname === modules.SQUARE_CUSTOMER_SETTINGS_PATH && method === "GET" && url.search === "") {
        const view = await handlers.view(request);
        if (!view) response = modules.squareCustomerConnectionsUnavailableResponse();
        else {
          const panel = modules.renderToStaticMarkup(modules.React.createElement(modules.SquareConnectionPanel, { view }));
          // The clean settings document needs its same-origin form Origin header.
          // no-referrer suppresses that header to "null" in Chromium navigations;
          // it is reserved for the standalone sensitive callback/handoff document.
          response = new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="same-origin"><title>Square connection qualification</title><style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:1rem;color:#172033}section,article,form{margin:1rem 0}article,form{border:1px solid #cad1da;padding:1rem}label{display:block;margin:.6rem 0}button,select{font:inherit;padding:.6rem}button{cursor:pointer}input[type=checkbox]{margin-right:.5rem}</style></head><body><main>${panel}</main></body></html>`, { headers: {
            "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "same-origin",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
          } });
        }
        events.push("settings_view");
      } else {
        const action = modules.SQUARE_CUSTOMER_ACTIONS.find((candidate) => url.pathname === `${modules.SQUARE_CUSTOMER_API_PATH}/${candidate}`);
        response = action ? await handlers.handle(action, request) : modules.squareCustomerConnectionsUnavailableResponse();
        events.push(action ? `customer_${action}` : "unavailable");
      }
      if (!(response instanceof Response)) throw new Error("square_browser_fixture_response_invalid");
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      events.push("request_failed");
      if (!outgoing.headersSent) outgoing.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store", "referrer-policy": "no-referrer" });
      outgoing.end("Square connection request could not be completed.");
    }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  providerOrigin = options.crossSiteProvider === true ? `http://localhost:${server.address().port}` : origin;
  try { handlers = modules.createSquareCustomerHandlers(await options.createDependencies(origin, providerOrigin)); }
  catch (error) { await new Promise((resolve) => server.close(resolve)); throw error; }
  return Object.freeze({
    origin,
    providerOrigin,
    safeEvents: () => [...events],
    close: () => new Promise((resolve, reject) => { for (const socket of sockets) socket.destroy(); server.close((error) => error ? reject(error) : resolve()); })
  });
}

/** Exercises the actual shared forms. Provider/session fixture implementation stays with the DB harness. */
async function exerciseSquareConnectionBrowser(page, options) {
  const { SQUARE_CUSTOMER_SETTINGS_PATH } = loadSquareBrowserModules();
  const settings = options.origin + SQUARE_CUSTOMER_SETTINGS_PATH;
  await page.goto(settings);
  await page.getByRole("heading", { name: "Square connection", exact: true }).waitFor();
  await page.getByRole("combobox", { name: "Business Entity", exact: true }).selectOption(options.businessEntityId);
  await page.getByRole("button", { name: "Connect Square", exact: true }).click();
  await page.getByRole("button", { name: options.authorizeButtonLabel ?? "Approve synthetic Square authorization", exact: true }).click();
  await page.waitForURL(settings);
  await page.getByText("Mapping required", { exact: true }).waitFor();
  await page.getByLabel(options.locationLabel, { exact: true }).check();
  await page.getByLabel("I confirm these locations belong to the Business Entity shown above.", { exact: true }).check();
  await page.getByRole("button", { name: "Confirm location mapping", exact: true }).click();
  await page.waitForURL(settings);
  await page.getByText("Authorized · sync not yet qualified", { exact: true }).waitFor();
  if (options.afterMapping) await options.afterMapping();
  await page.getByLabel("Confirm this Square disconnect.", { exact: true }).check();
  await page.getByRole("button", { name: "Disconnect Square", exact: true }).click();
  await page.waitForURL(settings);
  await page.getByText(options.disconnectLabel ?? "Disconnected", { exact: true }).waitFor();
  if (options.afterDisconnect) await options.afterDisconnect();
  const html = await page.content();
  for (const canary of options.privacyCanaries ?? []) assert.ok(!html.includes(canary), "private canary absent from customer markup");
  assert.equal(new URL(page.url()).search, "", "clean customer URL after callback and mutation handoffs");
}

/** Keep only privacy verdicts, never raw callback URLs, headers or console text. */
function observeSquareBrowserPrivacy(page, options) {
  const canaries = options.privacyCanaries ?? [];
  let unsafeReferrer = false, unexpectedNetwork = false, unsafeConsole = false, pageError = false;
  let crossSiteCallback = false, callbackSessionCookie = false, providerSessionCookie = false;
  const pending = new Set();
  const providerOrigin = options.providerOrigin ?? options.origin;
  const onRequest = (request) => {
    const url = new URL(request.url());
    if (url.origin !== options.origin && !(url.origin === providerOrigin && url.pathname.startsWith("/__square_synthetic_provider/"))) unexpectedNetwork = true;
    const inspection = request.allHeaders().then((headers) => {
      const referrer = headers.referer ?? "";
      if (canaries.some((canary) => referrer.includes(canary)) || /[?&](?:code|access_token|refresh_token)=/.test(referrer)) unsafeReferrer = true;
      const hasSessionCookie = options.sessionCookieName && (headers.cookie ?? "").split(";").some((part) => part.trim().startsWith(options.sessionCookieName + "="));
      if (url.origin === providerOrigin && providerOrigin !== options.origin && hasSessionCookie) providerSessionCookie = true;
      if (url.origin === options.origin && url.pathname === "/api/integrations/square/callback") {
        if (headers["sec-fetch-site"] === "cross-site") crossSiteCallback = true;
        if (hasSessionCookie) callbackSessionCookie = true;
      }
    }).catch(() => { pageError = true; }).finally(() => pending.delete(inspection));
    pending.add(inspection);
  };
  const onConsole = (message) => { if (canaries.some((canary) => message.text().includes(canary))) unsafeConsole = true; };
  const onError = () => { pageError = true; };
  page.on("request", onRequest); page.on("console", onConsole); page.on("pageerror", onError);
  return Object.freeze({
    async verify() {
      await Promise.all([...pending]);
      assert.equal(unsafeReferrer, false, "no private callback material in referrers");
      assert.equal(unexpectedNetwork, false, "browser remains on the explicit synthetic loopback host");
      assert.equal(unsafeConsole, false, "no private material in browser console");
      assert.equal(pageError, false, "no browser page error");
      if (providerOrigin !== options.origin) {
        assert.equal(crossSiteCallback, true, "browser delivered an actual cross-site callback navigation");
        assert.equal(providerSessionCookie, false, "host session cookie was not sent to synthetic provider site");
        if (options.sessionCookieName) {
          assert.equal(callbackSessionCookie, true, "Lax host session cookie returns on top-level cross-site callback");
          const cookie = (await page.context().cookies(options.origin)).find((candidate) => candidate.name === options.sessionCookieName);
          assert.ok(cookie, "authenticated host session cookie exists");
          assert.equal(cookie.httpOnly, true, "host session cookie is HttpOnly");
          assert.equal(cookie.sameSite, "Lax", "host session cookie uses the intended top-level OAuth SameSite policy");
          const visibleToScript = await page.evaluate((name) => document.cookie.split(";").some((part) => part.trim().startsWith(name + "=")), options.sessionCookieName);
          assert.equal(visibleToScript, false, "host session cookie is not available to application JavaScript");
        }
      }
      const cdp = await page.context().newCDPSession(page);
      try {
        const history = await cdp.send("Page.getNavigationHistory");
        for (const entry of history.entries) {
          assert.ok(!canaries.some((canary) => entry.url.includes(canary)), "private callback canary absent from browser history");
          assert.ok(!/[?&](?:code|access_token|refresh_token)=/.test(entry.url), "private callback query absent from browser history");
        }
      } finally { await cdp.detach(); }
      const markup = await page.content();
      assert.ok(!canaries.some((canary) => markup.includes(canary)), "private callback canary absent from customer markup");
      assert.equal(new URL(page.url()).search, "", "ordinary customer page URL is clean");
    },
    stop() { page.off("request", onRequest); page.off("console", onConsole); page.off("pageerror", onError); }
  });
}

/**
 * Full browser driver for the real disposable-DB runner. The runner creates a
 * fresh tenant/session and injects the actual checked service plus authenticated
 * host bootstrap; this helper never substitutes an in-memory lifecycle service.
 */
async function runSquareAccountBrowserQualification(options) {
  assert.ok(options.chromium && typeof options.chromium.launch === "function", "explicit local browser dependency is required");
  assert.equal(typeof options.afterMapping, "function", "real checked pending-ingestion assertions are required after mapping");
  assert.ok(/^\/__square_host_session\/[A-Za-z0-9_-]+$/.test(options.bootstrapPath), "bootstrap is an exact disposable host-session path");
  assert.ok(/^[A-Za-z0-9_-]{1,80}$/.test(options.sessionCookieName), "host session cookie name is explicit");
  const server = await createSquareBrowserQualificationServer({ ...options, crossSiteProvider: true });
  let browser, context, monitor;
  try {
    browser = await options.chromium.launch({ headless: true, ...(options.browserExecutable ? { executablePath: options.browserExecutable } : {}) });
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    // No browser request can escape the owned application/provider loopback sites.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === server.origin || (url.origin === server.providerOrigin && url.pathname.startsWith("/__square_synthetic_provider/")) ? route.continue() : route.abort();
    });
    monitor = observeSquareBrowserPrivacy(page, { origin: server.origin, providerOrigin: server.providerOrigin,
      sessionCookieName: options.sessionCookieName, privacyCanaries: options.privacyCanaries });
    await page.goto(server.origin + options.bootstrapPath);
    await exerciseSquareConnectionBrowser(page, { ...options, origin: server.origin });
    await monitor.verify();

    const settings = server.origin + "/app/settings/integrations/square";
    await page.getByRole("button", { name: "Reauthorize Square", exact: true }).click();
    await page.getByRole("button", { name: options.denyButtonLabel ?? "Deny synthetic Square authorization", exact: true }).click();
    await page.waitForURL(settings);
    await page.getByText(options.deniedStateLabel ?? /^(?:Authorization required|Reauthorization required|Disconnected)$/, { exact: true }).waitFor();
    if (options.afterDenial) await options.afterDenial();
    await monitor.verify();

    await page.getByRole("button", { name: "Reauthorize Square", exact: true }).click();
    await page.getByRole("button", { name: options.authorizeButtonLabel ?? "Approve synthetic Square authorization", exact: true }).click();
    await page.waitForURL(settings);
    await page.getByText("Mapping required", { exact: true }).waitFor();
    if (options.afterReauthorization) await options.afterReauthorization();
    await monitor.verify();
    assert.ok(server.safeEvents().every((event) => /^(?:host_session_fixture|provider_fixture|settings_view|customer_[a-z]+|unavailable|request_failed)$/.test(event)), "browser server retains only fixed safe event names");
    return Object.freeze({
      scenarios: ["authenticated_connect", "cross_site_callback_cookie", "verified_mapping", "checked_pending_ingestion", "confirmed_disconnect", "authorization_denial", "same_seller_reauthorization", "history_referrer_console_privacy"],
      evidence: "shared_routes_and_component_with_injected_disposable_database_service",
      transport: "exact_https_oauth_policy_mapped_only_to_owned_loopback_browser_fixture"
    });
  } finally {
    monitor?.stop();
    try { await context?.close(); } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  }
}

module.exports = { loadSquareBrowserModules, createSquareBrowserQualificationServer, exerciseSquareConnectionBrowser, observeSquareBrowserPrivacy, runSquareAccountBrowserQualification };
