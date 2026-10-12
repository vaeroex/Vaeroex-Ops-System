/* eslint-disable @typescript-eslint/no-require-imports -- Actual page, route, form parser, and owner guard with synthetic auth/RPC only. */
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const { renderToStaticMarkup, renderToString } = require("react-dom/server");
const { installLoader, ids, id } = require("./qbo-customer-test-support.cjs");

const origin = "https://www.vaeroex.com";
const requestId = id(20);
const scopeHash = "a".repeat(64);
const artifacts = [
  { table: "reports", id: id(21), action: "delete" },
  { table: "ai_agent_runs", id: id(22), action: "delete" },
  { table: "reports", id: id(23), action: "keep_unrelated" }
];
let fixture;
function reset() {
  fixture = {
    scope: { requestId, workspaceId: ids.workspace, connectionId: ids.connection, state: "prepared", scopeHash,
      counts: { imported_rows: 42, sync_runs: 3 }, artifacts: structuredClone(artifacts) },
    membership: { role: "owner", status: "active", user_id: ids.actor, workspace_id: ids.workspace },
    claims: { sub: ids.actor, session_id: ids.session }, calls: [], authCalls: 0, serviceCalls: 0, subscriptionCalls: 0,
    authenticated: true, readError: false, confirmError: false, throwRead: false, throwConfirm: false
  };
}
reset();
beforeEach(reset);

const userClient = {
  auth: { getClaims: async () => ({ data: { claims: fixture.claims }, error: fixture.claimsError ?? null }) },
  async rpc(name, args) {
    assert.equal(this, userClient, "RPC must keep the end user's client");
    fixture.calls.push({ name, args: structuredClone(args) });
    if (name === "read_google_sheets_erasure_request_v1") {
      if (fixture.throwRead) throw Error("private diagnostic");
      return { data: fixture.scope, error: fixture.readError ? { message: "private diagnostic" } : null };
    }
    assert.equal(name, "confirm_google_sheets_erasure_request_v1", "No execution, lifecycle, or other mutation RPC is allowed");
    if (fixture.throwConfirm) throw Error("private diagnostic");
    return { data: null, error: fixture.confirmError ? { message: "private diagnostic" } : null };
  }
};
installLoader({
  "@/lib/security/require-auth": { async requireAuth() {
    fixture.authCalls++;
    if (!fixture.authenticated) throw Error("redirect to login");
    return { user: { id: ids.actor }, supabase: userClient };
  } },
  "@/lib/security/get-current-workspace": { async getCurrentWorkspace(preferred) {
    assert.equal(preferred, undefined, "Workspace must come from the session, never request input");
    return { workspaceId: ids.workspace, membership: fixture.membership };
  } },
  "@/lib/security/require-workspace-access": { async requireWorkspaceAccess() {
    fixture.subscriptionCalls++; throw Error("Paid subscription is unavailable");
  } },
  "@/lib/supabase/admin": { createSupabaseAdminClient() {
    fixture.serviceCalls++; throw Error("Service client forbidden");
  } },
  "next/navigation": { notFound() { throw Error("NOT_FOUND"); } }
});
// Loading and using these paths must not require OAuth client secrets or connector enablement.
for (const name of ["GOOGLE_SHEETS_ENABLED", "GOOGLE_SHEETS_CLIENT_ID", "GOOGLE_SHEETS_CLIENT_SECRET",
  "GOOGLE_SHEETS_REDIRECT_URI", "GOOGLE_SHEETS_TOKEN_ENCRYPTION_KEY", "CRON_SECRET"]) delete process.env[name];
const route = require("../app/api/integrations/google-sheets/erasure/confirm/route.ts");
const pageModule = require("../app/app/settings/integrations/google-sheets/erasure/[requestId]/page.tsx");
const Page = pageModule.default;
const deletes = () => artifacts.filter(item => item.action === "delete").map(({ table, id }) => ({ table, id }));
function fields(changes = {}) {
  return { requestId, scopeHash, confirmation: "approve_erasure",
    ...Object.fromEntries(deletes().map((artifact, index) => [`artifact_${index}`, JSON.stringify(artifact)])), ...changes };
}
function request({ changes, headers: changedHeaders, omit = [], raw, url = `${origin}/api/integrations/google-sheets/erasure/confirm` } = {}) {
  const headers = new Headers({ origin, host: "www.vaeroex.com", "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded", ...changedHeaders });
  for (const name of omit) headers.delete(name);
  return new Request(url, { method: "POST", headers, body: raw ?? new URLSearchParams(fields(changes)).toString() });
}
async function postDenied(req, expectedStatus, beforeAuth = false) {
  const response = await route.POST(req);
  assert.equal(response.status, expectedStatus);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await response.json()).ok, false);
  assert(!fixture.calls.some(call => call.name === "confirm_google_sheets_erasure_request_v1"));
  if (beforeAuth) assert.equal(fixture.authCalls, 0);
}
const page = (value = requestId) => Page({ params: Promise.resolve({ requestId: value }) });

test("GET page only reads the owner's bounded scope; no approval or erasure, subscription, admin, or OAuth config", async () => {
  const html = renderToStaticMarkup(await page());
  assert.deepEqual(fixture.calls, [{ name: "read_google_sheets_erasure_request_v1", args: { p_request_id: requestId } }]);
  assert.equal(fixture.serviceCalls, 0); assert.equal(fixture.subscriptionCalls, 0);
  assert.equal(pageModule.dynamic, "force-dynamic");
  assert.equal(pageModule.metadata.referrer, "no-referrer");
  assert.match(html, /42/); assert.match(html, /Google-derived imports and history/);
  assert.match(html, /deleted in full only with your approval/); assert.match(html, /underlying unrelated sources are preserved/);
  assert.match(html, /Google spreadsheet will not be modified/); assert.match(html, /Revoking the Google access grant is required/);
  assert.match(html, /same Google account/); assert.match(html, /remain disconnected/);
  assert.match(html, /does not execute erasure/);
  assert.match(html, /Connection ID/); assert(html.includes(ids.connection));
  assert.match(html, /Request ID/); assert(html.includes(requestId));
  for (const artifact of artifacts) assert(html.includes(artifact.id));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((html.match(/required=""/g) ?? []).length, 3);
  assert(!html.includes('checked=""'), "No deletion consent is preselected");
  assert(!html.includes('name="artifact_2"'), "Unrelated artifacts are not selectable");
});

test("confirmation endpoint exports POST only and rejects directly invoked GET without RPC", async () => {
  assert.equal(route.GET, undefined); assert.equal(route.HEAD, undefined);
  await postDenied(new Request(`${origin}/api/integrations/google-sheets/erasure/confirm`, { headers: { origin, host: "www.vaeroex.com" } }), 403, true);
  assert.deepEqual(fixture.calls, []);
});

test("exact approval uses the authenticated user's read and confirm RPCs without caller authority", async () => {
  const response = await route.POST(request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(fixture.calls, [
    { name: "read_google_sheets_erasure_request_v1", args: { p_request_id: requestId } },
    { name: "confirm_google_sheets_erasure_request_v1", args: { p_request_id: requestId, p_scope_hash: scopeHash, p_delete_artifacts: deletes() } }
  ]);
  assert.equal(fixture.serviceCalls, 0); assert.equal(fixture.subscriptionCalls, 0);
});

test("same-origin CSRF gate rejects foreign, missing, null, same-site, and spoofed proxy headers before auth", async () => {
  for (const options of [
    { omit: ["origin"] }, { headers: { origin: "null" } }, { headers: { origin: "https://attacker.invalid" } },
    { headers: { origin: "https://vaeroex.com" } }, { headers: { origin: `${origin}/` } },
    { headers: { "sec-fetch-site": "cross-site" } }, { headers: { "sec-fetch-site": "same-site" } },
    { headers: { "sec-fetch-site": "none" } }, { omit: ["host"] }, { headers: { host: "attacker.invalid" } },
    { headers: { "x-forwarded-host": "attacker.invalid" } }, { headers: { "x-forwarded-proto": "http" } },
    { url: "https://attacker.invalid/api/integrations/google-sheets/erasure/confirm" },
    { url: `${origin}/api/integrations/google-sheets/erasure/confirm?requestId=${requestId}` }
  ]) { reset(); await postDenied(request(options), 403, true); assert.deepEqual(fixture.calls, []); }
  reset(); assert.equal((await route.POST(request({ omit: ["sec-fetch-site"] }))).status, 200, "Exact Origin remains required when fetch metadata is absent");
});

test("strict bounded form rejects malformed, oversized, duplicate, and caller-supplied authority fields", async () => {
  for (const options of [
    { headers: { "content-type": "application/json" } }, { omit: ["content-type"] },
    { headers: { "content-length": "262145" } }, { headers: { "content-length": "bad" } },
    { raw: "a".repeat(262145) }, { raw: "requestId=%FF" }, { raw: "requestId=%" },
    { raw: new URLSearchParams(fields()).toString() + `&requestId=${requestId}` },
    { raw: new URLSearchParams(fields()).toString() + "&artifact_0=%7B%7D" },
    { changes: { requestId: "not-a-uuid" } }, { changes: { scopeHash: "a".repeat(63) } },
    { changes: { confirmation: "" } }, { changes: { artifact_0: "null" } },
    { changes: { artifact_0: JSON.stringify({ ...deletes()[0], action: "delete" }) } },
    { changes: { workspaceId: id(99) } }, { changes: { userId: ids.actor } }, { changes: { sessionId: ids.session } },
    { changes: { deleteArtifacts: "[]" } }, { changes: { artifact_01: JSON.stringify(deletes()[0]) } },
    { changes: { artifact_1: JSON.stringify(deletes()[0]) } }
  ]) { reset(); await postDenied(request(options), 400, true); assert.deepEqual(fixture.calls, []); }
});

test("streaming body limits cancel input before authentication, including aborted requests", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(100_000)); }, cancel() { cancelled = true; } });
  await postDenied(new Request(request().url, { method: "POST", headers: request().headers, body: stream, duplex: "half" }), 400, true);
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  await postDenied(new Request(request(), { signal: controller.signal }), 400, true);
});

test("real owner guard rejects missing auth, inactive/non-owner membership, foreign identity, and invalid signed session", async () => {
  for (const override of [
    { authenticated: false }, { membership: { role: "admin" } }, { membership: { role: "member" } },
    { membership: { status: "disabled" } }, { membership: { user_id: id(99) } }, { membership: { workspace_id: id(99) } },
    { claims: { sub: id(99), session_id: ids.session } }, { claims: { sub: ids.actor } },
    { claims: { sub: ids.actor, session_id: "invalid" } }, { claimsError: { message: "invalid JWT" } }
  ]) {
    reset(); const membership = { ...fixture.membership, ...override.membership }; Object.assign(fixture, override, { membership });
    await postDenied(request(), 403); await assert.rejects(page(), /NOT_FOUND/);
    assert.deepEqual(fixture.calls, []); assert.equal(fixture.serviceCalls, 0); assert.equal(fixture.subscriptionCalls, 0);
  }
});

test("read errors and foreign or malformed RPC scopes are not found and never confirmed", async () => {
  for (const override of [
    { readError: true }, { throwRead: true }, { scope: null }, { scope: {} },
    { scope: { ...fixture.scope, workspaceId: id(99) } }, { scope: { ...fixture.scope, requestId: id(99) } },
    { scope: { ...fixture.scope, scopeHash: "bad" } }, { scope: { ...fixture.scope, counts: { rows: -1 } } },
    { scope: { ...fixture.scope, values: "must never render" } },
    { scope: { ...fixture.scope, artifacts: [{ ...artifacts[0], secret: "must never render" }] } },
    { scope: { ...fixture.scope, artifacts: [artifacts[0], artifacts[0]] } }
  ]) {
    reset(); Object.assign(fixture, override);
    await postDenied(request(), 404); await assert.rejects(page(), /NOT_FOUND/);
  }
  reset(); await assert.rejects(page("invalid"), /NOT_FOUND/); assert.equal(fixture.authCalls, 0);
});

test("every delete candidate is required and unrelated, injected, substituted, or duplicate artifacts are rejected", async () => {
  const base = fields(); delete base.artifact_1;
  for (const options of [
    { raw: new URLSearchParams(base) },
    { changes: { artifact_1: JSON.stringify({ table: artifacts[2].table, id: artifacts[2].id }) } },
    { changes: { artifact_1: JSON.stringify({ table: "reports", id: artifacts[1].id }) } },
    { changes: { artifact_2: JSON.stringify({ table: "reports", id: id(99) }) } },
    { changes: { artifact_0: JSON.stringify({ table: "reports", id: id(99) }) } }
  ]) { reset(); await postDenied(request(options), 400); }
  reset(); assert.equal((await route.POST(request({ changes: { artifact_0: JSON.stringify(deletes()[1]), artifact_1: JSON.stringify(deletes()[0]) } }))).status, 200, "Exact set may be reordered");
});

test("empty candidate scope still requires explicit final consent", async () => {
  fixture.scope.artifacts = [artifacts[2]];
  const raw = new URLSearchParams({ requestId, scopeHash, confirmation: "approve_erasure" });
  assert.equal((await route.POST(request({ raw }))).status, 200);
  assert.deepEqual(fixture.calls[1].args.p_delete_artifacts, []);
  reset(); fixture.scope.artifacts = []; raw.delete("confirmation");
  await postDenied(request({ raw }), 400, true);
});

test("matching already-approved retries reach the idempotent RPC; changed selections or hashes do not", async () => {
  fixture.scope.state = "approved";
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(fixture.calls[1].name, "confirm_google_sheets_erasure_request_v1");
  assert.deepEqual(fixture.calls[1].args.p_delete_artifacts, deletes());
  reset(); fixture.scope.state = "approved";
  await postDenied(request({ changes: { scopeHash: "b".repeat(64) } }), 409);
  reset(); fixture.scope.state = "approved";
  const partial = fields(); delete partial.artifact_1;
  await postDenied(request({ raw: new URLSearchParams(partial) }), 400);
});

test("stale scope and terminal requests cannot be approved; saved approval stays read-only in the UI", async () => {
  await postDenied(request({ changes: { scopeHash: "b".repeat(64) } }), 409);
  for (const state of ["approved", "completed", "withdrawn"]) {
    reset(); fixture.scope.state = state;
    if (state !== "approved") await postDenied(request(), 409);
    const html = renderToStaticMarkup(await page());
    assert(!html.includes('type="submit"')); assert(!html.includes('name="confirmation"'));
    assert.match(html, state === "approved" ? /Scope approved/ : state === "withdrawn" ? /Request withdrawn/ : /Erasure completed/);
  }
});

test("database confirmation rejection or transport failure never claims approval or exposes diagnostics", async () => {
  for (const override of [{ confirmError: true }, { throwConfirm: true }]) {
    reset(); Object.assign(fixture, override);
    const response = await route.POST(request());
    assert(response.status >= 400);
    const body = await response.text(); assert(!body.includes("private diagnostic")); assert.equal(JSON.parse(body).ok, false);
    assert.equal(fixture.calls.length, 2); assert.equal(fixture.serviceCalls, 0);
  }
});

test("hydrated approval form requires every checkbox, prevents duplicate submits, and announces results on desktop/mobile", {
  skip: process.env.GOOGLE_SHEETS_ERASURE_BROWSER !== "1", timeout: 60_000
}, async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
  const { root } = require("./qbo-customer-test-support.cjs");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "sheets-erasure-approval-"));
  const screenshotDir = process.env.GOOGLE_SHEETS_ERASURE_SCREENSHOT_DIR ? path.resolve(process.env.GOOGLE_SHEETS_ERASURE_SCREENSHOT_DIR) : output;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({
    mode: "production", context: root, target: "web", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "scripts/test-stubs/google-sheets-erasure-browser-entry.tsx"), output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const sourcePaths = ["app/app/settings/integrations/google-sheets/erasure/[requestId]/page.tsx", "app/app/settings/integrations/google-sheets/erasure/[requestId]/ErasureApprovalForm.tsx"];
  const css = (await postcss([tailwind({ ...require("../tailwind.config.ts").default,
    content: [{ raw: sourcePaths.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n"), extension: "tsx" }]
  })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const browser = await chromium.launch({ headless: true, timeout: 20_000, ...(process.env.GOOGLE_SHEETS_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.GOOGLE_SHEETS_TEST_CHROME_EXECUTABLE } : {}) });
  try {
    const tab = await browser.newPage(), errors = [];
    tab.setDefaultTimeout(10_000);
    tab.on("pageerror", error => errors.push(error.message));
    let posts = 0, releasePost = null, rejectPost = false;
    const escape = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
    const url = `${origin}/app/settings/integrations/google-sheets/erasure/${requestId}`;
    await tab.route("**/*", async intercepted => {
      const req = intercepted.request();
      if (req.url() === `${origin}/fixture.js`) return intercepted.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(output, "fixture.js"), "utf8") });
      if (req.url() === `${origin}/fixture.css`) return intercepted.fulfill({ contentType: "text/css", body: css });
      if (req.url() === `${origin}/api/integrations/google-sheets/erasure/confirm`) {
        posts++;
        const headers = await req.allHeaders();
        assert.equal(req.method(), "POST"); assert.equal(headers.origin, origin);
        // Chromium may add Fetch Metadata after interception; the route suite covers its rejection cases.
        if (headers["sec-fetch-site"]) assert.equal(headers["sec-fetch-site"], "same-origin");
        const body = new URLSearchParams(req.postData());
        assert.deepEqual(Object.fromEntries(body), fields());
        await new Promise(resolve => { releasePost = resolve; });
        if (rejectPost) return intercepted.fulfill({ status: 409, contentType: "application/json", body: '{"ok":false}' });
        const response = await route.POST(new Request(req.url(), { method: "POST", headers: { ...headers, host: "www.vaeroex.com" }, body: req.postData() }));
        return intercepted.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
      }
      if (req.url() === url) {
        const markup = renderToString(await page()).replace("<form", `<div id="approval" data-scope="${escape(JSON.stringify(fixture.scope))}"><form`).replace("</form>", "</form></div>");
        return intercepted.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body class="vaeroex-customer-workspace vaeroex-app-shell"><main class="workspace-main" style="padding:20px">${markup}</main><script src="/fixture.js"></script></body></html>` });
      }
      return intercepted.abort();
    });
    const waitForPost = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (releasePost) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail("Form did not submit within one second");
    };
    for (const width of [1440, 390]) {
      reset(); posts = 0; releasePost = null;
      await tab.setViewportSize({ width, height: 1000 });
      await tab.goto(url);
      const submit = tab.getByRole("button", { name: "Approve erasure scope", exact: true });
      await submit.waitFor();
      assert.equal(await tab.locator("dl").first().innerText(), `Connection ID\n${ids.connection}\nRequest ID\n${requestId}`);
      assert(await tab.locator("code").filter({ hasText: `reports / ${artifacts[0].id}` }).isVisible());
      assert(await tab.locator("code").filter({ hasText: `ai_agent_runs / ${artifacts[1].id}` }).isVisible());
      assert.equal(posts, 0, "GET never submits consent");
      await submit.click(); assert.equal(posts, 0, "Empty approval must not submit");
      await tab.locator('[name="confirmation"]').check();
      await tab.locator('[name="artifact_0"]').check();
      await submit.click(); assert.equal(posts, 0, "Partial artifact approval must not submit");
      await tab.locator('[name="artifact_1"]').check();
      await submit.focus();
      await tab.keyboard.press("Escape");
      assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await tab.screenshot({ path: path.join(screenshotDir, `approval-${width}.png`), fullPage: true });
      await submit.click();
      await tab.getByRole("button", { name: "Recording approval...", exact: true }).waitFor();
      assert.equal(await tab.locator("form").getAttribute("aria-busy"), "true");
      await tab.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await waitForPost();
      assert.equal(posts, 1); releasePost();
      await tab.getByRole("status").filter({ hasText: "Scope approved." }).waitFor();
      assert.equal(await tab.getByRole("button", { name: "Approve erasure scope" }).count(), 0);
      assert.equal(await tab.locator('[role="status"]').evaluate(element => element === document.activeElement), true);
    }
    reset(); posts = 0; releasePost = null; rejectPost = true;
    await tab.goto(url);
    for (const name of ["artifact_0", "artifact_1", "confirmation"]) await tab.locator(`[name="${name}"]`).check();
    await tab.getByRole("button", { name: "Approve erasure scope" }).click();
    await waitForPost(); releasePost();
    await tab.getByRole("alert").waitFor();
    assert.match(await tab.getByRole("alert").innerText(), /Refresh this page/);
    assert.equal(await tab.getByRole("alert").evaluate(element => element === document.activeElement), true);
    assert(await tab.getByRole("button", { name: "Approve erasure scope" }).isEnabled());
    assert.deepEqual(errors, []);
    console.log(`Erasure approval desktop/mobile screenshots: ${screenshotDir}`);
  } finally { await browser.close(); }
});
