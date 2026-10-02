/* eslint-disable @typescript-eslint/no-require-imports -- Offline browser regression; every external request is intercepted. */
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os");
const path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright"), React = require("react"), { renderToString } = require("react-dom/server");
const { root, installLoader } = require("./qbo-customer-test-support.cjs");
installLoader();
const { QboAuthorizationForm } = require("../components/integrations/QboAuthorizationForm.tsx");
const { qboAuthorizationNavigationTarget } = require("../lib/integrations/control-plane/qbo-authorization-navigation.ts");

async function main() {
  const target = new URL("https://appcenter.intuit.com/connect/oauth2");
  target.search = new URLSearchParams({ client_id: "synthetic", response_type: "code", scope: "com.intuit.quickbooks.accounting",
    redirect_uri: "https://integrations.vaeroex.com/oauth/callback", state: `i1_${"x".repeat(43)}` }).toString();
  assert.equal(qboAuthorizationNavigationTarget(target.toString()), target.toString());
  for (const invalid of ["https://evil.invalid/connect/oauth2", target.toString().replace("appcenter.intuit.com", "appcenter.intuit.com.evil.invalid"),
    target.toString() + "&state=duplicate", target.toString().replace("/connect/oauth2", "/other"), target.toString().replace("synthetic", "")]) {
    assert.throws(() => qboAuthorizationNavigationTarget(invalid));
  }
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "qbo-connect-browser-"));
  const webpack = require("next/dist/compiled/webpack/webpack"); webpack.init();
  await new Promise((resolve, reject) => webpack.webpack({ mode: "production", context: root, target: "web", devtool: false, optimization: { minimize: false },
    entry: path.join(root, "scripts/test-stubs/qbo-connect-browser-entry.tsx"), output: { path: output, filename: "fixture.js" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": root } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(root, "scripts/test-stubs/qbo-browser-typescript-loader.cjs") }] }
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const config = (await import("../next.config.mjs")).default;
  const headers = Object.fromEntries((await config.headers())[0].headers.map(header => [header.key, header.value]));
  const markup = renderToString(React.createElement(QboAuthorizationForm, null,
    React.createElement("input", { name: "businessEntityId", type: "hidden", value: "synthetic-entity" })));
  let outcome = "success", posts = 0, reached = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") { response.writeHead(200, { "content-type": "application/javascript" }); response.end(fs.readFileSync(path.join(output, "fixture.js"))); return; }
    if (request.method === "POST") {
      posts++;
      if (request.url === "/legacy") { response.writeHead(303, { location: target.toString() }); response.end(); return; }
      assert.equal(request.headers.accept, "application/json");
      setTimeout(() => {
        response.writeHead(outcome === "conflict" ? 409 : 200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(outcome === "conflict" ? { ok: false } : {
          ok: true, authorizationUrl: outcome === "invalid" ? "https://evil.invalid/" : target.toString()
        }));
      }, 250);
      return;
    }
    response.writeHead(200, { ...headers, "content-type": "text/html" });
    response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QBO navigation fixture</title><body><main>${request.url === "/legacy"
      ? '<form action="/legacy" method="post"><button>Legacy connect</button></form>'
      : `<div id="fixture">${markup}</div><script src="/fixture.js"></script>`}</main></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage(), errors = [], policyErrors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", event => { if (/form-action/.test(event.text())) policyErrors.push("form-action"); });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === target.origin && url.pathname === target.pathname) {
        reached++; return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Synthetic Intuit boundary</h1>" });
      }
      return route.abort();
    });
    await page.goto(`${origin}/legacy`);
    await page.getByRole("button", { name: "Legacy connect" }).click();
    await page.waitForFunction(() => document.readyState === "complete");
    assert.equal(posts, 1); assert.equal(reached, 0); assert.equal(page.url(), `${origin}/legacy`);
    assert(policyErrors.length > 0, "Deployed CSP must reproduce the legacy redirect failure");
    for (const width of [1440, 390]) {
      posts = 0; outcome = "success";
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin);
      await page.getByRole("button", { name: "Connect QuickBooks" }).click();
      await page.getByRole("button", { name: "Opening Intuit..." }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Opening Intuit..." }).isDisabled(), true);
      // Duplicate same-tick submit events must not enqueue another request.
      await page.locator("form").evaluate(form => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      await page.getByRole("heading", { name: "Synthetic Intuit boundary" }).waitFor();
      assert.equal(posts, 1);
    }
    for (outcome of ["conflict", "invalid"]) {
      posts = 0;
      await page.goto(origin);
      await page.getByRole("button", { name: "Connect QuickBooks" }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button", { name: "Connect QuickBooks" }).isEnabled(), true);
      assert.equal(page.url(), `${origin}/`); assert.equal(posts, 1);
    }
    assert.deepEqual(errors, []);
    console.log("PASS: deployed CSP legacy failure reproduced; actual hydrated form navigates on desktop/mobile, one in-flight request, loading, errors, hostile-target denial; zero external requests.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
