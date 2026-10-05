/* eslint-disable @typescript-eslint/no-require-imports -- Isolated production renderer hydration regression. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init();
const root = path.resolve(__dirname, '..');
const output = process.env.HYDRATION_REPLAY_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-hydration-replay-'));
assert(!fs.existsSync(path.join(output, 'result.json')), 'fresh_test_output_required');
fs.mkdirSync(output, { recursive: true });
const negative = process.argv.includes('--negative-control');
assert(process.argv.slice(2).every(arg => arg === '--negative-control'), 'unknown_option');
const rendererPath = path.join(path.dirname(require.resolve('next/package.json')), 'dist/compiled/react-dom/cjs/react-dom-client.production.js');
const installed = fs.readFileSync(rendererPath, 'utf8');
const renderer = path.join(output, 'renderer.js');
let source = installed;
if (negative) {
  // Reverse only #35494 in a disposable copy. The independent synchronous
  // action wakeup backport and installed renderer remain unchanged.
  const helper = /function popHydrationStateOnInterruptedWork\(fiber\) \{[\s\S]*?\n\}/g;
  assert.equal([...source.matchAll(helper)].length, 1, 'exact_hydration_helper_required_for_negative_control');
  const call = /\n\s+popHydrationStateOnInterruptedWork\(next\);/g;
  assert.equal([...source.matchAll(call)].length, 1, 'exact_host_replay_call_required_for_negative_control');
  source = source.replace(helper, '').replace(call, '');
}
fs.writeFileSync(renderer, source);
const checks = [], errors = [];
let server, browser;
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"><main id="outer"><p>Before</p><div id="target"><section id="child">Saved server content</section></div><p>After</p></main></div><script src="/fixture.js"></script></body></html>';
(async () => {
  try {
    await new Promise((resolve, reject) => webpack.webpack({ mode: 'production', context: root, target: 'web', devtool: false, optimization: { minimize: false }, entry: path.join(root, 'scripts/test-stubs/hydration-replay-entry.js'), output: { path: output, filename: 'fixture.js' }, resolve: { modules: [path.join(root, 'node_modules')], alias: { 'react-dom/client$': renderer } } }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
    server = http.createServer((req, res) => {
      res.setHeader('cache-control', 'no-store');
      if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'fixture.js'))); return; }
      res.setHeader('content-type', 'text/html'); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    for (const width of [1440, 390]) for (let iteration = 0; iteration < 10; iteration++) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.__HYDRATION_REPLAY_RESULT__), undefined, { timeout: 5000 });
      const observed = await page.evaluate(() => window.__HYDRATION_REPLAY_RESULT__);
      const passed = observed.lazyInitializations === 1 && observed.fulfilledChunks === 1 && observed.beforeRenders === 1 && observed.afterRenders === 1 && observed.recoverableErrors.length === 0 && observed.sameServerNodes.every(Boolean) && observed.sameServerHtml && pageErrors.length === 0;
      const check = { width, iteration, passed, ...observed, pageErrors };
      checks.push(check);
      console.log(JSON.stringify({ check: 'host_hydration_replay', width, iteration, passed, retainedServerDom: observed.sameServerNodes.every(Boolean), recoverableErrors: observed.recoverableErrors.length, negativeControl: negative }));
      await context.close();
    }
    assert.equal(checks.filter(check => !check.passed).length, 0, 'hydration_replay_must_retain_server_dom_without_errors');
    assert.equal(fs.readFileSync(rendererPath, 'utf8'), installed, 'installed_renderer_unchanged');
    console.log(JSON.stringify({ passed: true, checks: checks.length, negativeControl: negative, output }));
  } catch (error) { errors.push(error.message); process.exitCode = 1; console.error(error.message); }
  finally {
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: !errors.length && checks.length === 20, negativeControl: negative, rendererSha256: createHash('sha256').update(source).digest('hex'), installedRendererSha256: createHash('sha256').update(installed).digest('hex'), checks, errors, scope: 'Bundled production React renderer; microtask-resolved Flight-shaped lazy child; exact SSR node identity and HTML; no reload, state polling update, authentication or database.' }, null, 2)+'\n');
  }
})();
