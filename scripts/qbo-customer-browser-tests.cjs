/* eslint-disable @typescript-eslint/no-require-imports -- Local synthetic HTTP preview of the actual component and RPC. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const support = require("./qbo-customer-test-support.cjs");
support.installLoader();
const { QboStoredDataUnavailable, QboStoredDataView } = require("../lib/integrations/qbo-customer/view.tsx");
const { QboCoverageDiagnosticView, qboCoverageDiagnostic } = require("../lib/integrations/qbo-customer/diagnostic-view.tsx");
const { parseQboBrowser, parseQboBrowseQuery, QBO_CUSTOMER_DATA_PATH } = require("../lib/integrations/qbo-customer/contracts.ts");
const { id, ids, root, insertSource, record, report, browse } = support;

async function verifyGateOff(origin, boundary = "not-found") {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, "Gate-off smoke accepts an explicitly supplied loopback origin only");
  assert(["not-found", "configuration"].includes(boundary), "Declare the expected application boundary explicitly");
  const routes = [QBO_CUSTOMER_DATA_PATH, "/app/settings/integrations/quickbooks/disconnect"];
  const executablePath = process.env.QBO_TEST_CHROME_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      return request.method() === "GET" && url.origin === origin &&
        (routes.includes(url.pathname) || url.pathname.startsWith("/_next/static/")) ? route.continue() : route.abort();
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        const response = await page.goto(`${origin}${route}`);
        const heading = boundary === "configuration" ? /^Connect Supabase to continue$/
          : /^(This workspace page is not available|Page not found)$/;
        await page.getByRole("heading", { name: heading }).waitFor();
        assert.equal(await page.getByRole("heading", { name: /Stored QuickBooks data|Disconnect QuickBooks|QuickBooks record status/ }).count(), 0);
        assert.equal(await page.getByRole("region", { name: /Stored-data metrics|Stored sources|Selected source|QuickBooks record status/ }).count(), 0);
        assert.equal(await page.locator('form[action*="/api/integrations/qbo"]').count(), 0);
        assert.equal(await page.getByRole("button", { name: /Connect QuickBooks|Disconnect QuickBooks|Reauthorize QuickBooks/ }).count(), 0);
        assert.doesNotMatch(await page.locator("body").innerText(), /QBO-reported|Document total|Current sources/);
        await page.screenshot({ path: `/tmp/qbo-gate-off-${route.endsWith("/data") ? "data" : "disconnect"}-${width}.png` });
        console.log(`Gate-off DOM passed ${route} ${width}px; boundary=${boundary}; HTTP ${response.status()} (HTTP status is not the gate assertion).`);
      }
    }
  } finally { await browser.close(); }
}

async function main() {
  const gateOrigin = process.argv.find(argument => argument.startsWith("--gate-off-origin="));
  const gateBoundary = process.argv.find(argument => argument.startsWith("--gate-off-boundary="));
  if (gateOrigin) return verifyGateOff(gateOrigin.slice("--gate-off-origin=".length), gateBoundary?.slice("--gate-off-boundary=".length));
  const db = await support.database();
  const config = require("../tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, "lib/integrations/qbo-customer/*.tsx"), __filename] })])
    .process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  for (let n = 100; n < 130; n++) await insertSource(db, n, record(n % 2 ? "Payment" : "Invoice"));
  await insertSource(db, 140, report(), { validation: "valid" });
  await db.query("insert into private.qbo_production_source_validation_work values ($1,$2,$3,$4,$5,$6,'valid',null)",
    [id(100140), id(140), ids.workspace, ids.entity, ids.connection, ids.mapping]);
  await insertSource(db, 150, record("Invoice", "voided"), { lifecycle: "voided", changeKind: "voided" });
  let serverError = null;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      assert.equal(url.pathname, QBO_CUSTOMER_DATA_PATH);
      const fixture = url.searchParams.get("fixture");
      const query = parseQboBrowseQuery(Object.fromEntries(url.searchParams));
      const data = parseQboBrowser(await browse(db, { connectionId: query.connectionId, after: query.after, sourceId: query.sourceId, kind: query.kind }));
      const diagnostic = ["intelligence", "intelligence-unavailable"].includes(fixture);
      const body = renderToStaticMarkup(diagnostic
        ? createElement(QboCoverageDiagnosticView, { diagnostic: fixture === "intelligence" ? qboCoverageDiagnostic(data) : null })
        : ["denied", "query", "unavailable"].includes(fixture)
          ? createElement(QboStoredDataUnavailable, { reason: fixture }) : createElement(QboStoredDataView, { browser: data, query }));
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stored QBO fixture</title><style>${css}</style></head><body${diagnostic ? ' style="background:#111827"' : ""}><main class="mx-auto max-w-6xl p-4"><h1 class="mb-5 text-2xl font-semibold${diagnostic ? " text-white" : ""}">${diagnostic ? "Intelligence diagnostic fixture" : "Stored QuickBooks data"}</h1>${body}</main></body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end("Synthetic preview failed"); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`Synthetic-only preview: ${origin}${QBO_CUSTOMER_DATA_PATH}`);
    if (process.argv.includes("--serve")) {
      console.log(`Report: ${origin}${QBO_CUSTOMER_DATA_PATH}?connectionId=${ids.connection}&sourceId=${id(140)}#source-detail`);
      console.log(`Blocked: ${origin}${QBO_CUSTOMER_DATA_PATH}?fixture=unavailable`);
      console.log(`Intelligence diagnostic: ${origin}${QBO_CUSTOMER_DATA_PATH}?fixture=intelligence`);
      console.log("Only synthetic fixture data. Stop with Ctrl-C. No .env or live app clients are loaded.");
      await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
      return;
    }
    const executablePath = process.env.QBO_TEST_CHROME_EXECUTABLE;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 768, height: 1024 },
      { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}?connectionId=${ids.connection}&sourceId=${id(140)}`);
      await page.getByRole("heading", { name: "QBO-reported ProfitAndLoss", exact: true }).waitFor();
      assert.equal(await page.locator("article").count(), 25);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(await page.getByRole("region", { name: "QBO-reported observation" }).getByText("100.00", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("region", { name: "Validated accounting observations" }).getByText("100.00", { exact: true }).count(), 1);
      assert.match(await page.getByRole("region", { name: "Validated accounting observations" }).innerText(), /Reconciliation is unconfirmed/);
      const overflow = await page.locator("h1,h2,h3,p,dt,dd,button,select").evaluateAll(elements => elements
        .filter(element => element.tagName !== "SELECT" && element.scrollWidth > element.clientWidth + 2)
        .map(element => element.textContent?.slice(0, 80)));
      assert.deepEqual(overflow, [], "text must fit within its containers");
      await page.screenshot({ path: `/tmp/qbo-customer-${viewport.width}.png` });
      await page.locator("#source-detail").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/qbo-customer-report-${viewport.width}.png` });
      await page.getByRole("link", { name: "Next page" }).click();
      assert.equal(await page.locator("article").count(), 7);
      await page.getByRole("link", { name: "First page" }).click();
      assert.equal(await page.locator("article").count(), 25);
      await page.locator('select[name="kind"]').selectOption("reports");
      await page.getByRole("button", { name: "Apply filters" }).click();
      assert.equal(await page.locator("article").count(), 1);
      await page.getByRole("link", { name: "Inspect ProfitAndLoss", exact: true }).click();
      await page.getByRole("heading", { name: "QBO-reported ProfitAndLoss", exact: true }).waitFor();
      await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}?fixture=unavailable`);
      assert.match(await page.getByRole("alert").innerText(), /counts are unavailable/);
      assert.equal(await page.locator("article").count(), 0);
      await page.screenshot({ path: `/tmp/qbo-customer-blocked-${viewport.width}.png` });
      await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}?fixture=intelligence`);
      await page.getByRole("heading", { name: "QuickBooks record status", exact: true }).waitFor();
      assert.match(await page.getByRole("region", { name: "QuickBooks record status" }).innerText(), /Combined Square\/QuickBooks revenue is unavailable/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `/tmp/qbo-customer-intelligence-${viewport.width}.png` });
      await page.getByRole("link", { name: "View stored QuickBooks data" }).click();
      assert.equal(await page.locator("article").count(), 25);
      await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}?fixture=intelligence-unavailable`);
      assert.match(await page.getByRole("status").innerText(), /Coverage and counts are unknown/);
      assert.equal(await page.locator("dd").count(), 0);
    }
    await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}?connectionId=${ids.connection}&sourceId=${id(150)}`);
    assert.match(await page.locator("body").innerText(), /Voided source/);
    await db.exec("update private.integration_connections set status='deleted'");
    await page.goto(`${origin}${QBO_CUSTOMER_DATA_PATH}`);
    assert.match(await page.locator("body").innerText(), /No stored sources/);
    await page.screenshot({ path: "/tmp/qbo-customer-empty-320.png" });
    assert.deepEqual(errors, []); assert.equal(serverError, null);
    console.log("Browser checks passed: real RPC + components, desktop/tablet/mobile, filters, paging, validated observations, report, void, empty, blocked and Intelligence diagnostic drill-through. No live auth/provider/model calls.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
