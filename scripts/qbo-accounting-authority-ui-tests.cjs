/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline execution of the actual authority helper, route and page. */
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path");
const { installLoader, ids, id, root } = require("./qbo-customer-test-support.cjs");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const origin = "https://qbo-accounting.test";
let state;
function reset() {
  process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = "true";
  process.env.QBO_APPLICATION_ORIGIN = origin;
  state = {
    role: "owner", member: ids.actor, workspace: ids.workspace, memberWorkspace: ids.workspace,
    status: "active", sub: ids.actor, session: ids.session, authCalls: 0, queries: [], calls: [],
    connection: { id: ids.connection, business_entity_id: ids.entity, workspace_id: ids.workspace,
      provider_key: "quickbooks_online", provider_environment: "production", status: "active",
      safe_display_name: "Acme QuickBooks" },
    authority: { connectionId: ids.connection, businessEntityId: ids.entity, businessEntityName: "Acme Operations",
      authorityId: null, enabled: false, effectiveFrom: null, currency: "USD", coverage: "not_assessed" }
  };
}
const supabase = {
  auth: { getClaims: async () => ({ data: { claims: { sub: state.sub, session_id: state.session } }, error: state.claimError }) },
  from: table => {
    assert.equal(table, "integration_connection_summaries");
    const query = { table, filters: [] }; state.queries.push(query);
    const result = list => {
      const matches = !state.noConnection && query.filters.every(([operator, key, value]) =>
        operator === "eq" ? state.connection[key] === value : state.connection[key] !== value);
      const row = matches ? Object.fromEntries(query.columns.split(",").map(key => [key, state.connection[key]])) : null;
      return { data: list ? (row ? [row] : []) : row, error: state.dbError ?? null };
    };
    const builder = {
      select: columns => { query.columns = columns; return builder; },
      eq: (key, value) => { query.filters.push(["eq", key, value]); return builder; },
      neq: (key, value) => { query.filters.push(["neq", key, value]); return builder; },
      maybeSingle: async () => result(false),
      order: async () => result(true)
    };
    return builder;
  },
  rpc: async (name, args) => {
    state.calls.push({ name, args });
    if (name === "read_qbo_customer_accounting_authority_v1") return { data: state.authority, error: state.readError ?? null };
    assert.equal(name, "set_qbo_customer_accounting_authority_v1");
    if (state.writeError) return { data: null, error: state.writeError };
    if (state.writeData) return { data: state.writeData, error: null };
    state.authority = { ...state.authority, authorityId: id(40), enabled: args.p_enabled, effectiveFrom: args.p_effective_from };
    return { data: { authorityId: id(40), enabled: args.p_enabled, idempotent: false }, error: null };
  }
};
installLoader({
  "@/lib/security/require-workspace-access": { requireWorkspaceAccess: async (...args) => {
    assert.deepEqual(args, [], "No caller-controlled workspace may be supplied");
    state.authCalls++;
    if (state.redirect) throw Error("AUTH_REDIRECT");
    return { supabase, user: { id: ids.actor }, workspaceId: state.workspace, membership: {
      role: state.role, user_id: state.member, status: state.status, workspace_id: state.memberWorkspace
    } };
  } },
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => { throw Error("Service-role access forbidden"); } },
  "next/navigation": { notFound: () => { throw Error("NOT_FOUND"); } },
  "@/components/operations/PageHeader": { PageHeader: ({ title, actions }) => createElement("header", null,
    createElement("h1", { className: "text-xl font-semibold" }, title), actions) }
});
global.fetch = async () => { throw Error("Live network access forbidden"); };
const helper = require("../lib/integrations/qbo-customer/accounting-authority.ts");
const route = require("../app/api/integrations/qbo/accounting-authority/route.ts");
const Page = require("../app/app/settings/integrations/quickbooks/accounting/page.tsx").default;
const enable = () => ({ action: "enable", connectionId: ids.connection, expectedAuthorityId: null,
  effectiveDate: "2026-01-15", policyConsent: helper.QBO_ACCOUNTING_CONSENT });
const revoke = () => ({ action: "revoke", connectionId: ids.connection, expectedAuthorityId: id(39), confirmation: "revoke" });
const activeAuthority = () => { state.authority = { ...state.authority, authorityId: id(39), enabled: true,
  effectiveFrom: "2026-01-15T00:00:00.000Z" }; };
function request(value = enable(), headers = {}, suffix = "") {
  return new Request(origin + helper.QBO_ACCOUNTING_API_PATH + suffix, { method: "POST",
    headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
function formRequest(value) {
  const entries = Object.entries(value).map(([key, value]) => [key, value ?? ""]);
  return new Request(origin + helper.QBO_ACCOUNTING_API_PATH, { method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(entries) });
}
const render = async params => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params ?? { connectionId: ids.connection }) }));
beforeEach(reset);

test("disabled API and page fail closed before auth, query, origin config or DB", async () => {
  for (const gate of [undefined, "false", "TRUE", "1"]) {
    if (gate === undefined) delete process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED;
    else process.env.QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED = gate;
    delete process.env.QBO_APPLICATION_ORIGIN;
    for (const method of ["GET", "POST"]) {
      const response = await route[method](new Request(origin + helper.QBO_ACCOUNTING_API_PATH, { method }));
      assert.equal(response.status, 404); assert.equal(response.headers.get("cache-control"), "no-store");
    }
    await assert.rejects(() => Page({}), /NOT_FOUND/);
    await assert.rejects(() => helper.requireQboAccountingOwner(), /disabled/);
  }
  assert.equal(state.authCalls, 0); assert.deepEqual(state.queries, []); assert.deepEqual(state.calls, []);
});

test("mutations require an exact trusted Origin and same-origin Fetch Metadata before authentication", async () => {
  for (const badOrigin of ["", "null", "https://evil.test", `${origin}/`, `${origin}/path`,
    "https://user:password@qbo-accounting.test", `${origin}:443`, "https://qbo-accounting.test.evil.test"]) {
    assert.equal((await route.POST(request(enable(), { origin: badOrigin }))).status, 403, badOrigin);
  }
  const missing = request(); missing.headers.delete("origin");
  assert.equal((await route.POST(missing)).status, 403);
  for (const site of ["cross-site", "same-site", "none"]) {
    assert.equal((await route.POST(request(enable(), { "sec-fetch-site": site }))).status, 403);
  }
  assert.equal(state.authCalls, 0); assert.deepEqual(state.queries, []); assert.deepEqual(state.calls, []);
});

test("explicit consent, real effective date, bounded strict input and no tenant identifiers", async () => {
  const invalid = [
    { ...enable(), policyConsent: undefined }, { ...enable(), policyConsent: true },
    { ...enable(), effectiveDate: undefined }, { ...enable(), effectiveDate: "" },
    { ...enable(), effectiveDate: "2026-02-30" }, { ...enable(), effectiveDate: "9999-01-01" },
    { ...enable(), effectiveDate: "0000-01-01" }, { ...enable(), effectiveDate: "2026-01-15T00:00:00Z" },
    { ...enable(), expectedAuthorityId: undefined }, { ...enable(), connectionId: "bad" },
    { ...revoke(), confirmation: undefined }, { ...revoke(), expectedAuthorityId: null },
    { ...revoke(), effectiveDate: "2026-01-15" }
  ];
  for (const key of ["workspaceId", "workspace_id", "businessEntityId", "actorId", "sessionId", "rules", "amount"]) {
    invalid.push({ ...enable(), [key]: ids.workspace });
  }
  for (const value of invalid) assert.equal((await route.POST(request(value))).status, 400, JSON.stringify(value));
  for (const body of [new URLSearchParams({ ...enable(), expectedAuthorityId: "" }).toString() + "&action=revoke",
    "x=" + "a".repeat(4097)]) {
    const response = await route.POST(new Request(origin + helper.QBO_ACCOUNTING_API_PATH, { method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body }));
    assert.equal(response.status, 400);
  }
  assert.equal((await route.POST(request(enable(), { "content-type": "text/plain" }))).status, 400);
  assert.equal((await route.POST(request(enable(), {}, `?workspaceId=${ids.workspace}`))).status, 400);
  assert.equal(state.authCalls, 0); assert.deepEqual(state.calls, []);
});

test("owner membership and signed session are required, auth redirects propagate", async () => {
  for (const [key, value] of [["role", "admin"], ["role", "manager"], ["role", "member"],
    ["member", id(90)], ["status", "inactive"], ["memberWorkspace", id(90)],
    ["sub", id(90)], ["session", "invalid"], ["session", undefined], ["claimError", { message: "private" }]]) {
    reset(); state[key] = value;
    assert.equal((await route.POST(request())).status, 403, key);
    assert.deepEqual(state.queries, []); assert.deepEqual(state.calls, []);
  }
  reset(); state.redirect = true;
  await assert.rejects(() => route.POST(request()), /AUTH_REDIRECT/);
  await assert.rejects(() => Page({}), /AUTH_REDIRECT/);
});

test("selected connection must belong to the current workspace and production QBO before native owner checks", async () => {
  for (const [key, value] of [["workspace_id", id(90)], ["provider_key", "square"],
    ["provider_environment", "sandbox"], ["status", "deleted"], ["id", id(90)]]) {
    reset(); state.connection[key] = value;
    assert.equal((await route.POST(request())).status, 403, key);
    assert.deepEqual(state.calls, []);
  }
  reset(); await route.POST(request());
  assert(state.queries[0].filters.some(filter => filter[1] === "workspace_id" && filter[2] === ids.workspace));
  assert.deepEqual(state.calls[0], { name: "read_qbo_customer_accounting_authority_v1", args: { p_connection_id: ids.connection } });
});

test("enable sends only native connection, expected authority, explicit date and fixed action", async () => {
  const response = await route.POST(request(enable(), { "sec-fetch-site": "same-origin" }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, authorityId: id(40), enabled: true, idempotent: false });
  assert.deepEqual(state.calls[1], { name: "set_qbo_customer_accounting_authority_v1", args: {
    p_connection_id: ids.connection, p_expected_authority_id: null, p_enabled: true, p_effective_from: "2026-01-15T00:00:00.000Z"
  } });
  reset(); const form = await route.POST(formRequest(enable()));
  assert.equal(form.status, 303);
  assert.equal(form.headers.get("location"), `${origin}${helper.QBO_ACCOUNTING_PATH}?connectionId=${ids.connection}`);
});

test("revocation uses explicit confirmation and observed effective date without deleting evidence", async () => {
  activeAuthority();
  const response = await route.POST(request(revoke()));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls[1].args, { p_connection_id: ids.connection, p_expected_authority_id: id(39),
    p_enabled: false, p_effective_from: "2026-01-15T00:00:00.000Z" });
  assert.equal(state.authority.enabled, false);
  assert.equal(state.calls.length, 2, "Only read and atomic native mutation RPCs");
  reset(); assert.equal((await route.POST(request(revoke()))).status, 409);
  assert.equal(state.calls.length, 1);
});

test("stale, conflicting and unavailable mutations are truthful and never leak SQL diagnostics", async () => {
  for (const [error, status] of [[{ code: "40001", message: "private" }, 409],
    [{ code: "42501", message: "qbo_accounting_authority_conflict" }, 409],
    [{ code: "42501", message: "qbo_accounting_family_conflict" }, 409],
    [{ code: "42501", message: "private" }, 403], [{ code: "PGRST202", message: "private" }, 503]]) {
    reset(); state.writeError = error;
    const response = await route.POST(request()); assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private|PGRST|42501|40001/);
    assert.equal(state.authority.enabled, false);
  }
  reset(); state.writeError = { code: "40001" };
  const form = await route.POST(formRequest(enable()));
  assert.equal(form.status, 303); assert.match(form.headers.get("location"), /error=stale$/);
  const html = await render({ connectionId: ids.connection, error: "stale" });
  assert.match(html, /Accounting authority changed/); assert.match(html, /name="effectiveDate"/);
  reset(); state.writeData = { authorityId: id(40), enabled: false, idempotent: true };
  assert.equal((await route.POST(request())).status, 503);
  state.writeData = { authorityId: id(40), enabled: true, idempotent: true };
  assert.equal((await (await route.POST(request())).json()).idempotent, true);
});

test("GET is bounded, owner-only, read-only and returns validated not-assessed coverage", async () => {
  const url = `${origin}${helper.QBO_ACCOUNTING_API_PATH}?connectionId=${ids.connection}`;
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, authority: state.authority });
  assert.equal(state.calls.length, 1);
  for (const suffix of ["", `?connectionId=${ids.connection}&connectionId=${ids.connection}`,
    `?connectionId=${ids.connection}&workspaceId=${ids.workspace}`, "?connectionId=bad"]) {
    reset(); assert.equal((await route.GET(new Request(origin + helper.QBO_ACCOUNTING_API_PATH + suffix))).status, 400);
    assert.equal(state.authCalls, 0);
  }
  reset(); assert.equal((await route.GET(new Request(url, { headers: { origin: "https://evil.test" } }))).status, 403);
  assert.equal(state.authCalls, 0);
  for (const change of [{ connectionId: id(90) }, { businessEntityId: id(90) }, { enabled: true },
    { coverage: "complete" }, { currency: null }, { realmId: "private" }]) {
    reset(); Object.assign(state.authority, change);
    assert.equal((await route.GET(new Request(url))).status, 503);
  }
});

test("page requires a selection, never preselects date/consent and explains fixed policy and partial coverage", async () => {
  let html = await render({});
  assert.doesNotMatch(html, /name="effectiveDate"|name="policyConsent"/);
  assert.equal(state.calls.length, 0);
  html = await render();
  for (const term of helper.QBO_ACCOUNTING_POLICY) assert(html.includes(term));
  assert.match(html, /Not assessed/); assert.match(html, /Coverage may be partial/);
  assert.match(html, /name="expectedAuthorityId" value=""/);
  const date = html.match(/<input[^>]*type="date"[^>]*>/)[0];
  assert.match(date, /required/); assert.doesNotMatch(date, /\svalue=/);
  assert.doesNotMatch(html, /checked|name="workspaceId"|name="businessEntityId"|name="actorId"/);
  activeAuthority(); html = await render();
  assert.match(html, /Revoke accounting authority/); assert.match(html, /audit evidence are preserved/);
  assert.match(html, /name="confirmation" value="revoke"/);
  assert.doesNotMatch(html, /checked/);
  state.connection.status = "disconnected"; html = await render();
  assert.doesNotMatch(html, /name="effectiveDate"/); assert.match(html, /Revoke accounting authority/);
});

test("page handles denied, unavailable, missing and untrusted labels without presenting consent as saved", async () => {
  state.role = "admin"; let html = await render();
  assert.match(html, /Workspace owner access/); assert.doesNotMatch(html, /<form/);
  assert.deepEqual(state.queries, []);
  reset(); state.readError = { code: "PGRST202", message: "PRIVATE_SQL" }; html = await render();
  assert.match(html, /status and coverage have not been verified/);
  assert.doesNotMatch(html, /PRIVATE_SQL|name="policyConsent"|Accounting authority<\/dt>/);
  reset(); state.noConnection = true; html = await render({});
  assert.match(html, /No QuickBooks connection/); assert.doesNotMatch(html, /<form/);
  reset(); state.authority.businessEntityName = "<script>alert('untrusted')</script>";
  html = await render(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  reset(); html = await render({ connectionId: [ids.connection] });
  assert.match(html, /selection is invalid/); assert.equal(state.calls.length, 0);
});

test("synthetic desktop/mobile forms enforce consent and date, then enable and revoke via the actual route", {
  skip: !process.argv.includes("--browser"), timeout: 45000
}, async () => {
  const { chromium } = require("playwright");
  const https = require("node:https");
  const { createHash, generateKeyPairSync } = require("node:crypto");
  const { execFileSync } = require("node:child_process");
  const postcss = require("postcss"), tailwind = require("tailwindcss");
  const config = require("../tailwind.config.ts").default;
  const pagePath = "app/app/settings/integrations/quickbooks/accounting/page.tsx";
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, pagePath)] })])
    .process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  // Playwright routes only the first URL in a redirect chain; serve every hop over loopback TLS.
  // The one-run key stays in memory and Chromium trusts only its SPKI, not arbitrary certificates.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = privateKey.export({ type: "pkcs8", format: "pem" });
  const cert = execFileSync("openssl", ["req", "-new", "-x509", "-key", "/dev/stdin", "-sha256",
    "-subj", "/CN=qbo-accounting.test", "-addext", "subjectAltName=DNS:qbo-accounting.test", "-days", "1"],
  { input: key, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
  const spki = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64");
  const failures = [], pageErrors = [], traffic = [];
  const server = https.createServer({ key, cert }, async (req, res) => {
    try {
      assert.equal(req.headers.host, new URL(origin).host);
      const url = new URL(req.url, origin);
      assert.equal(url.origin, origin, "All requests stay in the synthetic fixture");
      traffic.push({ method: req.method, url: url.href, enabled: state.authority.enabled });
      if (req.method === "POST") {
        assert.equal(url.pathname, helper.QBO_ACCOUNTING_API_PATH);
        assert.equal(req.headers.origin, origin);
        assert.equal(req.headers["sec-fetch-site"], "same-origin");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await route.POST(new Request(url, {
          method: "POST", headers: req.headers, body: Buffer.concat(chunks)
        }));
        const location = response.headers.get("location");
        if (location) assert.equal(location, `${origin}${helper.QBO_ACCOUNTING_PATH}?connectionId=${ids.connection}`);
        const body = await response.text();
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(body);
      } else {
        assert.equal(req.method, "GET");
        assert.equal(url.pathname, helper.QBO_ACCOUNTING_PATH);
        const html = await render(Object.fromEntries(url.searchParams));
        res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
        res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>${css}</style></head><body><main class="p-4">${html}</main></body></html>`);
      }
    } catch (error) { failures.push(error); res.writeHead(500); res.end("Fixture failed"); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const executablePath = process.env.QBO_TEST_CHROME_EXECUTABLE;
    browser = await chromium.launch({ headless: true, args: [
      `--host-resolver-rules=MAP qbo-accounting.test 127.0.0.1:${server.address().port}, MAP * ~NOTFOUND`,
      "--no-proxy-server", `--ignore-certificate-errors-spki-list=${spki}`
    ], ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", async interception => {
      const url = new URL(interception.request().url());
      if (url.origin === origin && [helper.QBO_ACCOUNTING_API_PATH, helper.QBO_ACCOUNTING_PATH].includes(url.pathname)) {
        await interception.continue();
      } else {
        failures.push(Error("Request outside the synthetic fixture")); await interception.abort();
      }
    });
    const page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("requestfailed", request => failures.push(Error(request.failure()?.errorText)));
    const pageUrl = `${origin}${helper.QBO_ACCOUNTING_PATH}?connectionId=${ids.connection}`;
    const apiUrl = `${origin}${helper.QBO_ACCOUNTING_API_PATH}`;
    const mutations = () => state.calls.filter(call => call.name.startsWith("set_"));
    const submit = async name => {
      const [submitted, redirected] = await Promise.all([
        page.waitForResponse(response => response.url() === apiUrl && response.request().method() === "POST"),
        page.waitForResponse(response => response.request().redirectedFrom()?.url() === apiUrl),
        page.getByRole("button", { name, exact: true }).click()
      ]);
      assert.equal(submitted.status(), 303);
      assert.equal(submitted.headers().location, pageUrl);
      const headers = await submitted.request().allHeaders();
      assert.equal(headers.origin, origin);
      assert.equal(redirected.request().redirectedFrom(), submitted.request());
      assert.equal(submitted.request().redirectedTo(), redirected.request());
      assert.equal(redirected.request().method(), "GET");
      assert.equal(redirected.request().postData(), null);
      assert.equal(redirected.url(), pageUrl); assert.equal(redirected.status(), 200);
      assert.equal(await redirected.finished(), null);
      await page.waitForLoadState("load"); assert.equal(page.url(), pageUrl);
    };
    for (const width of [1440, 390, 320]) {
      traffic.length = 0;
      reset(); await page.setViewportSize({ width, height: 1000 });
      const initialAuthority = { ...state.authority };
      await page.goto(pageUrl);
      assert.equal(await page.locator('input[name="effectiveDate"]').inputValue(), "");
      assert.equal(await page.locator('input[name="policyConsent"]').isChecked(), false);
      await page.getByRole("button", { name: "Enable accounting authority", exact: true }).click();
      assert.equal(mutations().length, 0);
      await page.locator('input[name="policyConsent"]').check();
      await page.getByRole("button", { name: "Enable accounting authority", exact: true }).click();
      assert.equal(mutations().length, 0);
      await page.locator('input[name="policyConsent"]').uncheck();
      await page.locator('input[name="effectiveDate"]').fill("2026-01-15");
      await page.getByRole("button", { name: "Enable accounting authority", exact: true }).click();
      assert.equal(mutations().length, 0);
      assert.deepEqual(state.authority, initialAuthority);
      assert.deepEqual(traffic, [{ method: "GET", url: pageUrl, enabled: false }]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const overflow = await page.locator("h1,h2,p,li,dt,dd,button,label").evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.textContent));
      assert.deepEqual(overflow, []);
      await page.screenshot({ path: `/tmp/qbo-accounting-authority-${width}.png`, fullPage: true });
      await page.locator('input[name="policyConsent"]').check();
      await submit("Enable accounting authority");
      await page.getByRole("heading", { name: "Revoke accounting authority", exact: true }).waitFor();
      const enabledAuthority = { ...initialAuthority, authorityId: id(40), enabled: true, effectiveFrom: "2026-01-15T00:00:00.000Z" };
      assert.deepEqual(state.authority, enabledAuthority);
      assert.deepEqual(mutations(), [{ name: "set_qbo_customer_accounting_authority_v1", args: {
        p_connection_id: ids.connection, p_expected_authority_id: null, p_enabled: true, p_effective_from: enabledAuthority.effectiveFrom
      } }]);
      assert.deepEqual(traffic, [
        { method: "GET", url: pageUrl, enabled: false }, { method: "POST", url: apiUrl, enabled: false },
        { method: "GET", url: pageUrl, enabled: true }
      ]);
      assert.equal(await page.locator('input[name="confirmation"]').isChecked(), false);
      await page.getByRole("button", { name: "Revoke accounting authority", exact: true }).click();
      assert.deepEqual(state.authority, enabledAuthority); assert.equal(mutations().length, 1);
      assert.equal(traffic.length, 3);
      await page.screenshot({ path: `/tmp/qbo-accounting-authority-enabled-${width}.png`, fullPage: true });
      await page.locator('input[name="confirmation"]').check();
      await submit("Revoke accounting authority");
      await page.getByRole("button", { name: "Enable accounting authority", exact: true }).waitFor();
      assert.deepEqual(state.authority, { ...enabledAuthority, enabled: false });
      assert.equal(mutations().length, 2);
      assert.deepEqual(mutations()[1], { name: "set_qbo_customer_accounting_authority_v1", args: {
        p_connection_id: ids.connection, p_expected_authority_id: id(40), p_enabled: false, p_effective_from: enabledAuthority.effectiveFrom
      } });
      assert.deepEqual(traffic, [
        { method: "GET", url: pageUrl, enabled: false }, { method: "POST", url: apiUrl, enabled: false },
        { method: "GET", url: pageUrl, enabled: true }, { method: "POST", url: apiUrl, enabled: true },
        { method: "GET", url: pageUrl, enabled: false }
      ]);
    }
    assert.deepEqual(failures, []); assert.deepEqual(pageErrors, []);
  } finally {
    try { if (browser) await browser.close(); }
    finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
