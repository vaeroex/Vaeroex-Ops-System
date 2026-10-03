const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { root, harness, connection, loadSource, React, renderToStaticMarkup } = require("./integrations-ui-test-support");

async function main() {
  const config = loadSource("tailwind.config.ts").default;
  const css = (await postcss([tailwind({ ...config, content: [
    path.join(root, "app/app/integrations/*.tsx"), path.join(root, "app/app/settings/page.tsx"),
    path.join(root, "app/app/settings/integrations/quickbooks/page.tsx"),
    path.join(root, "components/app/AppNavigation.tsx"), path.join(root, "components/operations/*.tsx"),
    path.join(root, "components/integrations/*.tsx"), __filename
  ] })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
  const routes = {
    "/app/integrations": "app/app/integrations/page.tsx",
    "/app/settings": "app/app/settings/page.tsx",
    "/app/settings/integrations/quickbooks": "app/app/settings/integrations/quickbooks/page.tsx"
  };
  let serverError = null;
  const server = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, "GET", "preview forbids mutations");
      const url = new URL(request.url, "http://127.0.0.1");
      assert(Object.hasOwn(routes, url.pathname));
      const h = harness({ pathname: url.pathname, connections: url.searchParams.has("empty") ? [] : [connection("pending_authorization")],
        cancellations: [{ connection_id: "connection-a", can_cancel: true }] });
      const { AppNavigation } = h.load("components/app/AppNavigation.tsx");
      const sections = [{ label: "Primary", collapsible: false, items: [
        { href: "/app/integrations", label: "Integrations" }, { href: "/app/settings", label: "Settings" }
      ] }];
      const nav = mobile => renderToStaticMarkup(React.createElement(AppNavigation, { sections, mobile }));
      response.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'" });
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Integrations synthetic preview</title><style>${css}</style></head><body class="bg-white text-ink"><div class="hidden lg:block fixed inset-y-0 left-0 w-64 bg-vaeroex-navy p-3">${nav(false)}</div><div class="lg:pl-64"><nav class="lg:hidden p-3">${nav(true)}</nav><main class="p-3 sm:p-5">${await h.render(routes[url.pathname])}</main></div></body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end("Synthetic preview failed"); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.INTEGRATIONS_TEST_CHROME_EXECUTABLE;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().method() === "GET" && new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/app/settings`);
      await page.getByRole("link", { name: "Manage integrations", exact: true }).click();
      await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
      assert.equal(await page.getByRole("article").count(), 3);
      assert.equal(await page.getByRole("article", { name: "Google Sheets", exact: true }).count(), 1);
      assert.equal(await page.getByText("Configuration required", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("link", { name: "View Google Sheets setup", exact: true }).getAttribute("href"), "/app/settings/integrations/google-sheets");
      assert.equal(await page.getByText("Pending authorization", { exact: true }).count(), 1);
      assert.equal(await page.locator("main form").count(), 0);
      const cards = await page.locator("article").evaluateAll(elements => elements.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height };
      }));
      if (viewport.width >= 768) {
        assert.equal(cards[0].y, cards[1].y); assert.equal(cards[0].height, cards[1].height);
        assert(cards[2].y >= cards[0].y + cards[0].height);
      } else {
        for (let index = 1; index < cards.length; index++) assert(cards[index].y >= cards[index - 1].y + cards[index - 1].height);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/integrations-ui-${viewport.width}.png`, fullPage: true });
      await page.getByRole("link", { name: "Manage QuickBooks", exact: true }).click();
      await page.getByRole("heading", { name: "QuickBooks Online", exact: true }).waitFor();
      assert.equal(await page.getByText("Synthetic company", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Cancel attempt", exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await page.locator("main h1, main h2, main p, main button, main a").evaluateAll(elements => elements
        .filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.textContent)), []);
      await page.screenshot({ path: `/tmp/integrations-qbo-management-${viewport.width}.png`, fullPage: true });
      await page.getByRole("link", { name: "Back to integrations", exact: true }).click();
      if (viewport.width < 1024) {
        await page.locator("summary").filter({ hasText: "Menu" }).click();
        assert.equal(await page.getByRole("link", { name: "Integrations", exact: true }).filter({ visible: true }).getAttribute("aria-current"), "page");
      }
      await page.goto(`${origin}/app/integrations?empty=1`);
      assert.equal(await page.getByRole("link", { name: "Connect QuickBooks", exact: true }).count(), 1);
      console.log(`Integrations synthetic browser passed ${viewport.width}px: Settings entry, cards, management navigation, no overflow.`);
    }
    assert.equal(serverError, null);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
