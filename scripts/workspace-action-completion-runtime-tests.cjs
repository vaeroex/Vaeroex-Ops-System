/* eslint-disable @typescript-eslint/no-require-imports -- Isolated browser regression for the production renderer. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init();
const root = path.resolve(__dirname, '..');
const output = process.env.ACTION_COMPLETION_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-action-runtime-'));
assert(!fs.existsSync(path.join(output, 'result.json')), 'fresh_test_output_required');
fs.mkdirSync(output, { recursive: true });
const negative = process.argv.includes('--negative-control');
assert(process.argv.slice(2).every(arg => arg === '--negative-control'), 'unknown_option');
const rendererPath = path.join(path.dirname(require.resolve('next/package.json')), 'dist/compiled/react-dom/cjs/react-dom-client.production.js');
const installed = fs.readFileSync(rendererPath, 'utf8');
const renderer = path.join(output, 'renderer.js');
let source = installed;
if (negative) {
  const fixed = '? 0 === (executionContext & 2)\n        ? prepareFreshStack(root, 0)\n        : (workInProgressRootPingedLanes |= pingedLanes)';
  assert.equal(source.split(fixed).length, 2, 'exact_backport_required_for_negative_control');
  source = source.replace(fixed, '? 0 === (executionContext & 2) && prepareFreshStack(root, 0)');
}
fs.writeFileSync(renderer, source);
const checks = [], errors = [];
let server, browser;
(async () => {
  try {
    await new Promise((resolve, reject) => webpack.webpack({ mode: 'production', context: root, target: 'web', devtool: false, optimization: { minimize: false }, entry: path.join(root, 'scripts/test-stubs/action-completion-runtime-entry.js'), output: { path: output, filename: 'fixture.js' }, resolve: { modules: [path.join(root, 'node_modules')], alias: { 'react-dom/client$': renderer } } }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
    server = http.createServer((req, res) => {
      res.setHeader('cache-control', 'no-store');
      if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
      res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    for (const width of [1440, 390]) for (let iteration = 0; iteration < 10; iteration++) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.locator('output[data-result="initial"]').waitFor();
      await page.getByRole('button', { name: 'Advance' }).click();
      try { await page.locator('output[data-result="updated"]').waitFor({ timeout: 3000 }); }
      catch { await page.screenshot({ path: path.join(output, 'failed-render.png') }); throw Error(`synchronous_wakeup_did_not_complete:${width}:${iteration}`); }
      checks.push({ width, iteration, passed: true }); await context.close();
    }
    assert.equal(errors.length, 0); console.log(JSON.stringify({ passed: true, checks: checks.length, negativeControl: negative }));
  } catch (error) { errors.push(error.message); process.exitCode = 1; console.error(error.message); }
  finally {
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: !errors.length, negativeControl: negative, rendererSha256: createHash('sha256').update(source).digest('hex'), installedRendererSha256: createHash('sha256').update(installed).digest('hex'), checks, errors, scope: 'Bundled production React renderer; no simulated API, reload, polling state update, authentication or database.' }, null, 2)+'\n');
  }
})();
