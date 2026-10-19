/* eslint-disable @typescript-eslint/no-require-imports -- Hydrated production date controls with synthetic local forms only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const root = path.resolve(__dirname, '..');
const source = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
const vendor = (pkg, file) => fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`, { paths: [path.dirname(require.resolve('react-dom/package.json')), root] })), 'cjs', file), 'utf8');
function bundle() {
  const modules = {
    react: vendor('react', 'react.development.js'), 'react/jsx-runtime': vendor('react', 'react-jsx-runtime.development.js'),
    'react-dom': vendor('react-dom', 'react-dom.development.js'), 'react-dom/client': vendor('react-dom', 'react-dom-client.development.js'), scheduler: vendor('scheduler', 'scheduler.development.js'),
    '@/components/integrations/DateRangeFields': source('components/integrations/DateRangeFields.tsx'), '@/lib/integrations/date-range': source('lib/integrations/date-range.ts'),
    'next/link': "exports.default=({children,...props})=>require('react').createElement('a',props,children);"
  };
  return `const process={env:{NODE_ENV:'development'}};const modules={${Object.entries(modules).map(([key, value]) => `${JSON.stringify(key)}:function(require,module,exports){${value}\n}`).join(',')}};const cache={};function require(key){if(cache[key])return cache[key].exports;if(!modules[key])throw new Error('Unexpected browser import '+key);const m={exports:{}};cache[key]=m;modules[key](require,m,m.exports);return m.exports;}const React=require('react');const controls=require('@/components/integrations/DateRangeFields');const create=React.createElement;require('react-dom/client').createRoot(document.getElementById('root')).render(create(React.Fragment,{},create('form',{action:'/import',method:'post',id:'import-form',className:'space-y-3 border border-line p-4'},create(controls.DateRangeFields,{idPrefix:'test-import',defaultStartDate:'2026-09-20',defaultEndDate:'2026-10-19',maxDate:'2026-10-19'}),create('button',{type:'submit',className:'min-h-10 rounded-md border border-line px-4 py-2'},'Import selected dates')),create(controls.SavedHistoryFilter,{action:'/history',startDate:null,endDate:null,maxDate:'2026-10-19'})));`;
}
async function main() {
  const configModule = { exports: {} }; Function('module', 'exports', source('tailwind.config.ts'))(configModule, configModule.exports);
  const css = (await postcss([tailwind({ ...configModule.exports.default, content: [path.join(root, 'components/integrations/DateRangeFields.tsx'), __filename] })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic historical import controls</title><style>${css}</style></head><body class="bg-white text-ink"><main class="mx-auto max-w-3xl space-y-4 p-4"><h1 class="text-2xl">Import and view history</h1><div id="root" class="space-y-4"></div></main><script src="/bundle.js"></script></body></html>`;
  const js = bundle(), posts = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { posts.push(Object.fromEntries(new URLSearchParams(body))); res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Synthetic import received'); }); return; }
    res.writeHead(200, { 'content-type': req.url === '/bundle.js' ? 'text/javascript' : 'text/html' }); res.end(req.url === '/bundle.js' ? js : html);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    fs.mkdirSync('/tmp/vaeroex-import-history-browser', { recursive: true });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(origin);
      const importForm = page.locator('#import-form');
      await page.getByLabel('Choose a period').waitFor();
      assert.equal(await importForm.getByLabel('From', { exact: true }).inputValue(), '2026-09-20');
      await page.getByLabel('Choose a period').selectOption('365');
      assert.equal(await importForm.getByLabel('From', { exact: true }).inputValue(), '2025-10-20');
      await page.getByLabel('Choose a period').selectOption('custom');
      assert.equal(await page.getByLabel('Choose a period').inputValue(), 'custom');
      await importForm.getByLabel('From', { exact: true }).fill('2018-01-01');
      await importForm.getByLabel('Through', { exact: true }).fill('2018-12-31');
      assert.equal(await page.locator('input[name="from"]').inputValue(), '', 'import choices do not change saved filters');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
      await page.screenshot({ path: `/tmp/vaeroex-import-history-browser/date-controls-${width}.png`, fullPage: true });
      await Promise.all([page.waitForURL('**/import'), page.getByRole('button', { name: 'Import selected dates' }).click()]);
      assert.deepEqual(posts.at(-1), { startDate: '2018-01-01', endDate: '2018-12-31' });
    }
    await page.goto(origin); await page.getByLabel('Choose a period').waitFor();
    await page.locator('input[name="from"]').fill('2018-01-01'); await page.locator('input[name="to"]').fill('2026-10-19');
    const before = posts.length;
    await Promise.all([page.waitForURL('**/history?from=2018-01-01&to=2026-10-19'), page.getByRole('button', { name: 'View saved dates' }).click()]);
    assert.equal(posts.length, before, 'saved-history browsing never submits an import');
    await page.getByRole('link', { name: 'All saved history' }).click(); await page.waitForURL('**/history');
    assert.deepEqual(errors, []);
    console.log('PASS: hydrated UTC presets, older custom dates, independent GET filters, native POST payload and 1280/390/320px layout. Screenshots: /tmp/vaeroex-import-history-browser');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
