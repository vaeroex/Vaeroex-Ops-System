/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-component preview; provider and workspace data are synthetic. */
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const React = require("react"), { renderToString, renderToStaticMarkup } = require("react-dom/server");
const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
const { root, installLoader, ids } = require("./qbo-customer-test-support.cjs");
let scenario = "connected";
const mapping = { dateColumn: 1, dateFormat: "iso", rowKeyColumn: 0, locationColumn: 2,
  metrics: [{ column: 3, name: "Orders", unit: "count", category: "Operations", target: 100 }, { column: 4, name: "Revenue", unit: "currency", category: "Financial", target: null }] };
const headers = ["Record ID", "Date", "Location", "Orders", "Revenue", "Gross margin", "[restricted column]"];
const connection = { id: ids.connection, workspace_id: ids.workspace, business_entity_id: ids.entity, display_name: "Operations metrics", status: "connected",
  spreadsheet_id: "synthetic_spreadsheet_identifier", spreadsheet_title: "Weekly business results", sheet_id: 0, sheet_title: "Business metrics", header_row: 1,
  tabs: [{ id: 0, title: "Business metrics", rowCount: 400 }], headers, field_mapping: mapping,
  active_approval_id: ids.mapping, automatic_refresh_enabled: true, next_sync_at: "2026-10-02T09:15:00Z", last_sync_at: "2026-10-02T09:00:00Z",
  last_sync_row_count: 100, last_sync_fact_count: 192, last_sync_rejected_count: 3, last_sync_conflict_count: 5, last_error_code: null,
  sync_lease_expires_at: null, revocation_pending: false, authorization_uncertain: false, updated_at: "2026-10-02T09:00:00Z" };
function currentConnection() {
  return { ...connection, ...(scenario === "reauth" ? { status: "reauthorization_required" } : {}), ...(scenario === "revocation" ? { status: "disconnected", revocation_pending: true } : {}),
    ...(scenario === "uncertain" ? { status: "pending_authorization", authorization_uncertain: true } : {}), ...(scenario === "running" ? { sync_lease_expires_at: "2099-01-01T00:00:00Z" } : {}) };
}
function query(table) {
  return { select() { return this; }, eq(column, value) { if (column === "workspace_id") assert.equal(value, ids.workspace); return this; }, order() { return this; }, limit(value) { assert(value <= 40); return this; },
    then(resolve) { return Promise.resolve({ data: table === "google_sheets_connections" ? [currentConnection()] : table === "business_entities" ? scenario === "empty" ? [] : [{ id: ids.entity, display_name: "Northstar Coffee" }] : [{ id: "run-1", connection_id: ids.connection, trigger_kind: "scheduled", status: "succeeded", row_count: 100, fact_count: 192, rejected_count: 3, conflict_count: 5, started_at: "2026-10-02T09:00:00Z", error_code: null, review_issues: [{ rowNumber: 4, metricName: "Revenue", reason: "numeric_column_4_invalid" }] }], error: null }).then(resolve); } };
}
installLoader({
  "@/lib/integrations/google-sheets/server": { sheetsEnabled: () => scenario !== "disabled" },
  "@/lib/workspaces/page-context": { requireWorkspacePage: async () => ({ context: { membership: { role: scenario === "viewer" ? "viewer" : "owner" } }, workspaceId: ids.workspace, supabase: { from: query } }) }
});
const Page = require("../app/app/settings/integrations/google-sheets/page.tsx").default;
const { GoogleSheetsMappingEditor } = require("../components/integrations/google-sheets/GoogleSheetsMappingEditor.tsx");
const { GoogleSheetsAuthorizationForm, googleSheetsAuthorizationTarget } = require("../components/integrations/google-sheets/GoogleSheetsAuthorizationForm.tsx");
const { GOOGLE_SHEETS_READ_SCOPE } = require("../lib/integrations/google-sheets/contracts.ts");

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "google-sheets-ui-"));
  const screenshotDir = process.env.GOOGLE_SHEETS_SCREENSHOT_DIR || output;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({ mode: "production", context: root, target: "web", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "scripts/test-stubs/google-sheets-browser-entry.tsx"), output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = (await import("../next.config.mjs")).default;
  const securityHeaders = Object.fromEntries((await config.headers())[0].headers.map(header => [header.key, header.value]));
  const tailwindConfig = require("../tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...tailwindConfig, content: [{ raw: ["app/app/settings/integrations/google-sheets/page.tsx", "components/integrations/google-sheets/GoogleSheetsMappingEditor.tsx", "components/integrations/google-sheets/GoogleSheetsAuthorizationForm.tsx", "components/operations/PageHeader.tsx", "components/operations/DecisionPageHeader.tsx", "components/operations/SectionCard.tsx", "components/operations/StatusBadge.tsx"].map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n"), extension: "tsx" }] })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({ client_id: "synthetic", response_type: "code", scope: GOOGLE_SHEETS_READ_SCOPE, redirect_uri: "https://www.vaeroex.com/api/integrations/google-sheets/callback", access_type: "offline", prompt: "consent", include_granted_scopes: "false", state: "x".repeat(43) }).toString();
  assert.equal(googleSheetsAuthorizationTarget(target.toString()), target.toString());
  for (const invalid of [target.toString().replace("accounts.google.com", "evil.invalid"), target.toString() + "&state=duplicate", target.toString().replace("spreadsheets.readonly", "drive"), target.toString().replace("/o/oauth2/v2/auth", "/other")]) assert.throws(() => googleSheetsAuthorizationTarget(invalid));
  let previewPosts = 0, authorizationPosts = 0, formPosts = [], failPreview = false, failAuthorization = false;
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(fs.readFileSync(path.join(output, "fixture.js"))); return; }
      if (request.url === "/fixture.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(css); return; }
      if (request.method === "POST") {
        let body = ""; for await (const part of request) body += part;
        const input = new URLSearchParams(body);
        if (request.url === "/api/integrations/google-sheets/preview") {
          previewPosts++; assert.equal(input.get("connectionId"), ids.connection); assert(JSON.parse(input.get("fieldMapping")).metrics.length >= 2);
          response.writeHead(failPreview ? 400 : 200, { "content-type": "application/json" }); response.end(JSON.stringify(failPreview ? { ok: false } : { ok: true, headers: ["Record ID", "Date", "Location", "Orders", "Revenue"], rows: [["record-1", "2026-10-01", "North", "120", "1200.50"]], sampleSize: 1, truncated: true })); return;
        }
        if (/\/(connect|reconnect)$/.test(request.url)) {
          authorizationPosts++; assert.equal(request.headers.accept, "application/json");
          await new Promise(resolve => setTimeout(resolve, 200));
          response.writeHead(failAuthorization ? 409 : 200, { "content-type": "application/json" }); response.end(JSON.stringify(failAuthorization ? { ok: false } : { ok: true, authorizationUrl: target.toString() })); return;
        }
        formPosts.push({ path: request.url, fields: Object.fromEntries(input) });
        response.writeHead(200, { "content-type": "text/html" }); response.end("<h1>Synthetic form received</h1>"); return;
      }
      const pathname = new URL(request.url, "http://localhost").pathname;
      let markup;
      if (pathname === "/mapping") {
        const props = { connectionId: ids.connection, headers, savedMapping: mapping, automaticEnabled: true, approved: true };
        markup = `<h1>Google Sheets mapping</h1><div id="fixture" data-kind="mapping" data-props="${escape(JSON.stringify(props))}">${renderToString(React.createElement(GoogleSheetsMappingEditor, props))}</div><script src="/fixture.js"></script>`;
      } else if (pathname === "/connect" || pathname === "/reconnect") {
        const props = { mode: pathname.slice(1), entityId: ids.entity, connectionId: ids.connection };
        const children = props.mode === "connect" ? React.createElement(React.Fragment, null, React.createElement("input", { name: "businessEntityId", type: "hidden", value: ids.entity }), React.createElement("input", { name: "displayName", type: "hidden", value: "Operations metrics" })) : React.createElement("input", { name: "connectionId", type: "hidden", value: ids.connection });
        markup = `<h1>Google Sheets</h1><div id="fixture" data-kind="authorization" data-props="${escape(JSON.stringify(props))}">${renderToString(React.createElement(GoogleSheetsAuthorizationForm, { mode: props.mode }, children))}</div><script src="/fixture.js"></script>`;
      } else {
        scenario = pathname.slice(1) || "connected";
        markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
      }
      response.writeHead(200, { ...securityHeaders, "content-type": "text/html" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Sheets local preview</title><link rel="stylesheet" href="/fixture.css"></head><body class="vaeroex-customer-workspace vaeroex-app-shell"><main class="workspace-main" style="max-width:1100px;margin:auto;padding:20px">${markup}</main></body></html>`);
    } catch (error) { response.writeHead(500); response.end("Fixture failure"); console.error(error); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.GOOGLE_SHEETS_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.GOOGLE_SHEETS_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage(); const errors = [], external = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      external.push(url.origin);
      if (url.origin === target.origin && url.pathname === target.pathname) return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Synthetic Google consent</h1>" });
      return route.abort();
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`${origin}/connected`);
      assert.equal(await page.getByRole("button", { name: "Sync now", exact: true }).count(), 1);
      assert.equal(await page.getByText("192", { exact: true }).count(), 1);
      assert.equal(await page.locator("dd").filter({ hasText: "Every 15 minutes" }).count(), 1);
      assert(await page.getByText("Held metrics overlap", { exact: false }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(screenshotDir, `google-sheets-status-${width}.png`), fullPage: true });
      await page.goto(`${origin}/empty`);
      const entityForm = page.locator('form[action="/api/integrations/google-sheets/entity"]');
      assert(await entityForm.getByRole("button", { name: "Create business entity" }).isVisible());
      await entityForm.getByLabel("Entity display name", { exact: true }).fill("Test Reporting");
      assert.equal(await entityForm.locator('[name="baseCurrency"]').inputValue(), "USD");
      assert.equal(await entityForm.locator('[name="timeZone"]').inputValue(), "UTC");
      await entityForm.locator('[name="timeZone"]').fill("America/Los_Angeles");
      await entityForm.getByRole("checkbox").check();
      await entityForm.getByRole("button", { name: "Create business entity" }).click();
      await page.getByRole("heading", { name: "Synthetic form received" }).waitFor();
      assert.equal(formPosts.at(-1).path, "/api/integrations/google-sheets/entity");
      assert.equal(formPosts.at(-1).fields.confirmation, "create_entity");
      assert.equal(formPosts.at(-1).fields.timeZone, "America/Los_Angeles");
      await page.goto(`${origin}/mapping`);
      const save = page.getByRole("button", { name: "Approve and save mapping" });
      assert(await save.isDisabled());
      assert(await page.getByRole("checkbox", { name: /Refresh every 15 minutes/ }).isChecked());
      await page.getByRole("button", { name: "Preview selected columns" }).click();
      await page.getByRole("table").waitFor(); assert(await page.getByText("record-1", { exact: true }).isVisible());
      await page.getByRole("button", { name: "Add numeric metric", exact: false }).click();
      assert.equal(await page.getByRole("table").count(), 0, "Changing mapping clears stale preview");
      assert.equal(await page.getByRole("group").count(), 3);
      await page.getByLabel("Metric name", { exact: true }).nth(2).fill("Gross margin");
      await page.getByRole("combobox", { name: /^Unit/ }).nth(2).selectOption("percent_fraction");
      await page.getByRole("button", { name: "Preview selected columns" }).click();
      await page.getByRole("table").waitFor();
      await page.getByRole("checkbox", { name: /I confirm these columns/ }).check();
      assert(await save.isEnabled());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(screenshotDir, `google-sheets-mapping-${width}.png`), fullPage: true });
      await save.click(); await page.getByRole("heading", { name: "Synthetic form received" }).waitFor();
      const saved = formPosts.at(-1); assert.equal(saved.path, "/api/integrations/google-sheets/mapping"); assert.equal(saved.fields.confirmation, "approve"); assert.equal(saved.fields.automaticRefresh, "true"); assert.equal(JSON.parse(saved.fields.fieldMapping).metrics.length, 3);
      for (const mode of ["connect", "reconnect"]) {
        authorizationPosts = 0;
        await page.goto(`${origin}/${mode}`);
        await page.getByRole("button", { name: mode === "connect" ? "Connect Google Sheets" : "Reconnect Google Sheets" }).click();
        await page.getByRole("button", { name: "Opening Google…" }).waitFor();
        await page.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        await page.getByRole("heading", { name: "Synthetic Google consent" }).waitFor();
        assert.equal(authorizationPosts, 1, "Repeated submit must not create duplicate authorization attempts");
      }
    }
    failPreview = true; await page.goto(`${origin}/mapping`); await page.getByRole("button", { name: "Preview selected columns" }).click(); await page.getByRole("alert").waitFor(); assert(await page.getByRole("button", { name: "Preview selected columns" }).isEnabled());
    failAuthorization = true; await page.goto(`${origin}/connect`); await page.getByRole("button", { name: "Connect Google Sheets" }).click(); await page.getByRole("alert").waitFor(); assert(await page.getByRole("button", { name: "Connect Google Sheets" }).isEnabled());
    for (const mode of ["disabled", "viewer", "reauth", "revocation", "uncertain", "running"]) {
      await page.goto(`${origin}/${mode}`);
      assert.equal(await page.getByRole("button", { name: "Sync now", exact: true }).count(), 0, `${mode} must not offer sync`);
      if (mode === "reauth") assert.equal(await page.getByRole("button", { name: "Reconnect Google Sheets" }).count(), 1);
      if (mode === "viewer" || mode === "disabled") assert.equal(await page.locator("form").count(), 0);
      if (mode === "uncertain") {
        await page.getByRole("checkbox", { name: "I removed Vaeroex access from the Google account used for this attempt." }).check();
        await page.getByRole("button", { name: "Confirm access removed" }).click();
        await page.getByRole("heading", { name: "Synthetic form received" }).waitFor();
        assert.equal(formPosts.at(-1).path, "/api/integrations/google-sheets/recovery");
        assert.equal(formPosts.at(-1).fields.confirmation, "access_removed");
      }
      if (mode === "revocation") { await page.getByText("Finish disconnecting", { exact: true }).click(); assert.equal(await page.getByRole("button", { name: "Retry disconnect" }).count(), 1); }
    }
    assert.deepEqual(errors, []); assert(external.every(origin => origin === target.origin)); assert.equal(previewPosts, 5);
    console.log(`PASS: real Google Sheets page and hydrated mapping/OAuth components; desktop/mobile layout, empty-workspace entity creation, preview, approval, multiple metrics, percent scale, 15-minute automatic refresh preference, CSP consent navigation, duplicate-submit prevention, recovery/disabled/viewer states. Screenshots: ${screenshotDir}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (screenshotDir !== output) fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
