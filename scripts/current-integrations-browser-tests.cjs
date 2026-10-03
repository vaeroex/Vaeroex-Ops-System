/* eslint-disable @typescript-eslint/no-require-imports -- Hydrated offline browser fixture; all non-loopback traffic is denied. */
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
const { root, loadSource, React } = require("./integrations-ui-test-support");
const { renderToString } = require("react-dom/server");
const { CurrentIntegrations } = loadSource("components/integrations/CurrentIntegrations.tsx", {
  "next/link": { __esModule: true, default: props => React.createElement("a", props) }
});
const workspaceId = "10000000-0000-4000-8000-000000000001";
const now = "2026-10-02T18:05:00.000Z", key = `square:${"a".repeat(64)}`;
function fixture(scenario, hidden) {
  const row = { key, provider: "Square", name: "North company", href: "/app/settings/integrations/square",
    connectionState: "connected", lastSuccessfulRefreshAt: "2026-10-02T18:00:00.000Z", currentUntil: "2026-10-02T18:15:00.000Z",
    freshness: "current", unchangedCheck: scenario === "unchanged", cadence: "Automatic checks every 15 minutes.", hidden,
    results: [{ label: "Completed payment", value: "USD 125.20", period: "Reporting date: Oct 1, 2026", href: "/app/integrations", limitation: "Not a revenue total." }] };
  if (scenario === "disconnected") row.connectionState = "disconnected";
  if (scenario === "stale") row.currentUntil = "2026-10-02T18:04:00.000Z";
  if (scenario === "reauthorization") row.connectionState = "reauthorization_required";
  if (scenario === "first-import") { row.lastSuccessfulRefreshAt = null; row.results = []; }
  const entries = scenario === "never" ? [] : [row];
  if (scenario === "distinct") entries.push({ ...row, key: `square:${"b".repeat(64)}`, name: "South company" });
  return { workspaceId, observedAt: now, timeZone: "America/Los_Angeles", timeZoneConfirmed: true, preferencesAvailable: true, entries, unavailable: [] };
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "current-integrations-browser-"));
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({ mode: "production", context: root, target: "web", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "scripts/test-stubs/current-integrations-browser-entry.tsx"), output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root, "next/link": path.join(root, "scripts/test-stubs/current-integrations-link.tsx") } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = loadSource("tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, "components/integrations/CurrentIntegrations.tsx"), __filename] })])
    .process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  let hidden = false, gets = 0, patches = 0, serverError = null, scenario = "disconnected", failed = false;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(fs.readFileSync(path.join(output, "fixture.js"))); return; }
      if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      if (url.pathname === "/api/integrations/dashboard/preferences") {
        assert.equal(request.method, "PATCH"); const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        assert.deepEqual(Object.keys(body).sort(), ["expectedWorkspaceId", "hiddenWhenDisconnected", "summaryKey"]);
        assert.equal(body.expectedWorkspaceId, workspaceId); assert.equal(body.summaryKey, key); patches++;
        hidden = body.hiddenWhenDisconnected;
        response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ workspaceId, summaryKey: key, hiddenWhenDisconnected: hidden })); return;
      }
      assert.equal(request.method, "GET");
      if (url.pathname === "/api/integrations/dashboard") {
        assert.equal(url.searchParams.get("workspaceId"), workspaceId); gets++;
        response.writeHead(failed ? 503 : 200, { "content-type": "application/json" });
        response.end(JSON.stringify(failed ? { error: "status_unavailable" } : fixture(scenario, hidden))); return;
      }
      scenario = url.searchParams.get("scenario") ?? "disconnected";
      const data = fixture(scenario, hidden);
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      response.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current integrations fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main workspace-intelligence mx-auto max-w-5xl p-4"><div id="fixture">${renderToString(React.createElement(CurrentIntegrations, { initial: data }))}</div></main><script id="fixture-data" type="application/json">${JSON.stringify(data)}</script><script src="/fixture.js"></script></body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end("Fixture failed"); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error" && !event.text().includes("503")) errors.push(event.text()); });
    await page.route("**/*", route => {
      const url = new URL(route.request().url()); requests.push({ origin: url.origin, method: route.request().method(), path: url.pathname });
      return url.origin === origin ? route.continue() : route.abort();
    });
    await page.clock.install({ time: new Date(now) });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const state of ["never", "current", "unchanged", "stale", "first-import", "reauthorization", "disconnected", "distinct"]) {
        await page.goto(`${origin}/?scenario=${state}`);
        await page.getByRole("heading", { name: "Current integrations" }).waitFor();
        if (state === "disconnected") {
          assert.equal(await page.getByText("No active integrations", { exact: true }).count(), 1);
          assert.equal(await page.getByText("USD 125.20", { exact: true }).count(), 0);
          await page.getByRole("button", { name: /Hide from this page/ }).click();
          await page.getByText("Hidden integrations (1)", { exact: true }).waitFor();
          await page.reload();
          assert.equal(await page.getByRole("heading", { name: "Previously connected" }).count(), 0);
          await page.getByText("Hidden integrations (1)", { exact: true }).click();
          await page.getByRole("button", { name: /Restore/ }).click();
          await page.getByRole("heading", { name: "Previously connected" }).waitFor();
        }
        if (state === "distinct") assert.equal(await page.getByRole("article").count(), 2);
        if (state === "stale") assert.equal(await page.getByText("Last-known values, not included in current totals.", { exact: true }).count(), 1);
        if (state === "unchanged") assert.equal(await page.getByText("Up to date - no new data since the last successful check", { exact: true }).count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(await page.locator("main h2, main h3, main p, main button, main a").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.textContent)), []);
      }
      await page.screenshot({ path: path.join(output, `current-integrations-${width}.png`), fullPage: true });
    }
    await page.goto(`${origin}/?scenario=current`);
    gets = 0;
    for (let check = 0; check < 10; check++) {
      const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/integrations/dashboard");
      await page.clock.runFor(60_000);
      await response;
      await page.getByText("Checking saved status...").waitFor({ state: "hidden" });
    }
    await page.clock.runFor(60_000);
    assert.equal(gets, 10, "automatic reads stop at the ten-check bound");
    await page.clock.runFor(2 * 60_000);
    assert.equal(gets, 10);
    await page.getByRole("button", { name: "Refresh integration status" }).click();
    await page.getByText("Checking saved status...").waitFor({ state: "hidden" });
    assert.equal(gets, 11, "manual refresh works without a reload");
    await page.clock.runFor(11_000); failed = true;
    await page.getByRole("button", { name: "Refresh integration status" }).click();
    await page.getByText("Status could not be refreshed. Values below are last-known data.", { exact: true }).waitFor();
    assert.equal(patches, 8); assert.equal(serverError, null); assert.deepEqual(errors, []);
    assert(requests.every(request => request.origin === origin && ["GET", "PATCH"].includes(request.method)), "no provider import, reconnect or model call");
    console.log(`Current integrations browser PASS: 8 states x 4 widths, hydrated hide/restore persistence, 10-check bound, manual refresh, error state; screenshots ${output}`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
