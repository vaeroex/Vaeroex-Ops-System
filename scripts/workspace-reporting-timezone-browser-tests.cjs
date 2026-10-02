/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual-form browser fixture; no live data or credentials. */
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright"), postcss = require("postcss"), tailwind = require("tailwindcss");
const { root, loadSource } = require("./integrations-ui-test-support");

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-reporting-timezone-browser-"));
  const entry = path.join(root, "scripts/test-stubs/workspace-reporting-timezone-browser-entry.tsx");
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({ mode: "production", context: root, target: "web", devtool: false,
    optimization: { minimize: false }, entry, output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: {
      "@/app/app/settings/reporting-timezone-action": entry, "@": root
    } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = loadSource("tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [entry, path.join(root, "components/settings/ReportingTimezoneForm.tsx"),
    path.join(root, "components/operations/SectionCard.tsx"), __filename] })])
    .process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(fs.readFileSync(path.join(output, "fixture.js"))); return;
    }
    if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace timezone fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-page workspace-settings mx-auto max-w-5xl p-4"><div class="workspace-settings-account-grid grid items-start gap-5 lg:grid-cols-2"><div id="fixture"></div></div></main><script src="/fixture.js"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (event.type() === "error") errors.push(event.text()); });
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin);
      const select = page.getByRole("combobox", { name: "Reporting timezone" });
      await select.waitFor(); assert.equal(await select.inputValue(), "");
      await select.selectOption("America/Los_Angeles");
      await page.getByRole("button", { name: "Save timezone" }).click();
      await page.getByRole("button", { name: "Saving..." }).waitFor();
      assert.equal(await select.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Saving..." }).isDisabled(), true);
      await page.evaluate(() => window.timezoneFixture.complete("success"));
      await page.getByRole("status").filter({ hasText: "Reporting timezone saved: America/Los_Angeles." }).waitFor();
      assert.equal(await select.inputValue(), "America/Los_Angeles");
      await select.selectOption("UTC");
      await page.getByRole("button", { name: "Save timezone" }).click();
      await page.getByRole("button", { name: "Saving..." }).waitFor();
      await page.evaluate(() => window.timezoneFixture.complete("error"));
      await page.getByRole("alert").filter({ hasText: "could not be saved" }).waitFor();
      assert.equal(await select.inputValue(), "UTC", "failed save preserves the selection for retry");
      await page.getByRole("button", { name: "Save timezone" }).click();
      await page.getByRole("button", { name: "Saving..." }).waitFor();
      await page.evaluate(() => window.timezoneFixture.complete("transport"));
      await page.getByRole("alert").filter({ hasText: "could not be confirmed" }).waitFor();
      await select.selectOption("");
      await page.getByRole("button", { name: "Save timezone" }).click();
      await page.getByRole("button", { name: "Saving..." }).waitFor();
      await page.evaluate(() => window.timezoneFixture.complete("success"));
      await page.getByRole("status").filter({ hasText: "Refresh timestamps use UTC until configured." }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.timezoneFixture.calls.map(call => Object.keys(call).sort())),
        Array.from({ length: 4 }, () => ["expectedWorkspaceId", "reportingTimezone"]));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await page.locator("main h2, main p, main button, main label").evaluateAll(elements =>
        elements.filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.textContent)), []);
      await page.screenshot({ path: path.join(output, `reporting-timezone-${width}.png`), fullPage: true });
      await page.evaluate(() => window.timezoneFixture.switchWorkspace());
      await page.waitForFunction(() => document.querySelector('input[name="expectedWorkspaceId"]').value.endsWith("2"));
      assert.equal(await select.inputValue(), "UTC");
      assert.equal(await page.getByRole("status").count(), 0, "workspace switch resets stale success state");
    }
    assert.deepEqual(errors, []);
    console.log(`Reporting timezone browser PASS: pending, success, failure, transport, clear, workspace switch at four widths; screenshots ${output}`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
