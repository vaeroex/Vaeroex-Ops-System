/* eslint-disable @typescript-eslint/no-require-imports -- Local interactive catalog; production cards with synthetic data and no provider requests. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const ts = require('typescript'), { chromium } = require('playwright'), postcss = require('postcss'), tailwind = require('tailwindcss');
const { root, loadSource } = require('./integrations-ui-test-support');
const { catalogFixture } = require('./plugin-catalog-test-support.cjs');
const source = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
const vendor = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [path.dirname(require.resolve('react-dom/package.json')), root] })), 'cjs', file), 'utf8');
function bundle(entries) {
  const modules = {
    react: vendor('react', 'react.development.js'), 'react/jsx-runtime': vendor('react', 'react-jsx-runtime.development.js'),
    'react-dom': vendor('react-dom', 'react-dom.development.js'), 'react-dom/client': vendor('react-dom', 'react-dom-client.development.js'), scheduler: vendor('scheduler', 'scheduler.development.js'),
    './_PluginCatalog': source('app/app/integrations/_PluginCatalog.tsx'), './_catalog': source('app/app/integrations/_catalog.ts')
  };
  return `const process={env:{NODE_ENV:'development'}};const modules={${Object.entries(modules).map(([key, value]) => `${JSON.stringify(key)}:function(require,module,exports){${value}\n}`).join(',')}};const cache={};function require(key){if(cache[key])return cache[key].exports;if(!modules[key])throw new Error('Unexpected browser import '+key);const m={exports:{}};cache[key]=m;modules[key](require,m,m.exports);return m.exports;}
    const React=require('react');
    // Reconstitute the server-rendered card DOM as immutable React children.
    // No provider code or fixture-only replacement card runs in the browser.
    function node(element,key){if(element.nodeType===3)return element.textContent;const props={key};for(const attr of element.attributes){const name=attr.name==='class'?'className':attr.name.startsWith('aria-')||attr.name.startsWith('data-')?attr.name:attr.name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());props[name]=attr.value;}return React.createElement(element.localName,props,...Array.from(element.childNodes).map(node));}
    const entries=${JSON.stringify(entries).replace(/</g, '\\u003c')}.map(entry=>{const template=document.createElement('template');template.innerHTML=entry.html;return {...entry,content:node(template.content.firstChild,entry.id)};});
    require('react-dom/client').createRoot(document.getElementById('root')).render(React.createElement(require('./_PluginCatalog').PluginCatalog,{entries}));`;
}
async function main() {
  const output = process.env.PLUGIN_CATALOG_SCREENSHOTS || '/tmp/vaeroex-plugin-catalog-browser';
  fs.mkdirSync(output, { recursive: true });
  const { entries } = await catalogFixture({ reportingEnabled: ['xero', 'harvest', 'zoho-inventory', 'clockify', 'toggl', 'katana'],
    legacyEnabled: ['loyverse', 'zoho-books', 'wix-orders'], sheetsEnabled: true,
    rows: { reporting_connections: [{ provider: 'harvest', status: 'connected' }, { provider: 'xero', status: 'pending' }] } });
  const disabled = (await catalogFixture({ qboEnabled: false, squareEnabled: false })).entries;
  const config = loadSource('tailwind.config.ts').default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, 'app/app/integrations/*.tsx'), path.join(root, 'components/operations/*.tsx'), __filename] })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (req.url.startsWith('/bundle.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle(req.url.includes('disabled') ? disabled : entries)); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html lang="en" class="${req.url.includes('light') ? '' : 'pulsar'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plug-ins — synthetic workspace fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main p-4"><div class="workspace-page mx-auto max-w-5xl space-y-5"><header><p class="text-xs text-muted">WORKSPACE · SYNTHETIC TEST DATA</p><h1 class="text-3xl font-semibold text-ink">Plug-ins</h1><p class="mt-2 text-sm text-muted">Find plug-ins by the work you do. View connection status and manage your workspace data.</p></header><div id="root"></div></div></main><script src="/bundle.js${req.url.includes('disabled') ? '?disabled' : ''}"></script></body></html>`);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(Number(process.env.PLUGIN_CATALOG_PORT || 0), '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (process.env.PLUGIN_CATALOG_SERVE === '1') { console.log(`Catalog fixture: ${origin}`); await new Promise(resolve => process.once('SIGINT', resolve)); return; }
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(origin);
      const input = page.getByRole('searchbox', { name: 'Search plug-ins' });
      await input.waitFor();
      assert.equal(await page.getByRole('article').count(), 12);
      assert.equal(await page.getByRole('button', { name: 'All (12)', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
      const columns = await page.locator('#plugin-results').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width >= 768 ? 2 : 1);
      if (width === 1440 || width === 390) await page.screenshot({ path: path.join(output, `catalog-${width}.png`), fullPage: false });
      await page.getByRole('button', { name: 'Time tracking & project work (3)' }).click();
      assert.deepEqual(await page.getByRole('article').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label'))), ['Harvest', 'Clockify', 'Toggl 2.0']);
      await input.fill('  BILLABLE hours ');
      assert.equal(await page.getByRole('article').count(), 2);
      assert.equal(await page.getByRole('button', { name: 'Accounting & bookkeeping (0)' }).count(), 1);
      await page.getByRole('button', { name: 'Accounting & bookkeeping (0)' }).click();
      await page.getByRole('heading', { name: 'No matching plug-ins' }).waitFor();
      assert.equal(await page.getByRole('article').count(), 0);
      if (width === 390) await page.screenshot({ path: path.join(output, 'empty-390.png'), fullPage: true });
      await page.getByRole('button', { name: 'Clear filters' }).click();
      assert.equal(await input.inputValue(), '');
      assert.equal(await input.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.getByRole('article').count(), 12);
      await input.fill('x'.repeat(150));
      const summary = page.getByRole('status');
      assert.equal(await summary.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}px long query must wrap, not be clipped by the workspace shell`);
      assert.equal(await page.getByRole('article').count(), 0);
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await input.fill('e-commerce');
      assert.equal(await page.getByRole('article').count(), 1);
      assert.equal(await page.getByRole('link', { name: 'Manage Wix' }).getAttribute('href'), '/app/integrations/wix-orders');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      // Real keyboard navigation uses native buttons: Tab, Enter, Space.
      await input.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'All (12)', exact: true }).evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('button', { name: 'Accounting & bookkeeping (3)' }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByRole('article').count(), 3);
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Space');
      assert.equal(await page.getByRole('article').count(), 12);
      for (const entry of entries) {
        await input.fill(entry.name);
        const card = page.getByRole('article', { name: entry.name, exact: true });
        const expected = [...entry.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
        assert.deepEqual(await card.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))), expected);
      }
    }
    await page.goto(`${origin}/?disabled`); await page.getByRole('searchbox').waitFor();
    await page.getByRole('searchbox').fill('harvest');
    assert((await page.getByRole('article').innerText()).includes('Configuration required'));
    assert(!(await page.getByRole('article').innerText()).includes('Not connected'));
    await page.getByRole('link', { name: 'View Harvest setup' }).click(); await page.waitForURL('**/app/integrations/harvest');
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${origin}/?light`); await page.getByRole('searchbox').waitFor();
    await page.getByRole('button', { name: 'Inventory & manufacturing (2)' }).click();
    await page.screenshot({ path: path.join(output, 'inventory-light-1440.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS: real catalog controls and server-rendered cards, 1440/768/390/320px, light/Pulsar themes, category counts, combined search, empty/reset, keyboard focus and all card destinations. Screenshots: ${output}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
