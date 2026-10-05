/* eslint-disable @typescript-eslint/no-require-imports -- Browser fixtures, synthetic inputs and loopback traffic only. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { chromium } = require('playwright');
const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init();
const output = process.env.WORKFLOW_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-workflow-browser-'));
fs.mkdirSync(output, { recursive: true });
const fixture = name => path.join(root, 'scripts/test-stubs', name);
(async () => {
 await new Promise((resolve, reject) => webpack.webpack({ mode: 'production', context: root, target: 'web', devtool: false, optimization: { minimize: false }, entry: fixture('workspace-workflow-entry.tsx'), output: { path: output, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [root + '/node_modules', 'node_modules'], alias: { 'next/navigation$': fixture('workspace-workflow-navigation.tsx'), 'next/link$': fixture('current-integrations-link.tsx'), '@/components/app/ActivityProvider$': fixture('workspace-workflow-activity.tsx'), '@/app/app/operations/actions$': fixture('workspace-workflow-actions.tsx'), '@': root } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: fixture('qbo-browser-typescript-loader.cjs') }] } }, (error, stats) => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
 const postcss = require('postcss'), tailwind = require('tailwindcss');
 const tailwindConfig = require('./integrations-ui-test-support').loadSource('tailwind.config.ts').default;
 const css = (await postcss([tailwind({ ...tailwindConfig, content: [root + '/components/operations/{ModalDialog,RecordDetailDrawer,InternalFormSubmissionForm,FormControls,PendingSubmitButton}.tsx', root + '/components/app/GlobalSearch.tsx', fixture('workspace-workflow-entry.tsx')] })]).process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: undefined })).css;
 const submitted = [], requests = [], errors = [], results = [];
 const server = http.createServer(async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(fs.readFileSync(output + '/fixture.js')); return; }
  if (req.url === '/fixture-submit' && req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; submitted.push(JSON.parse(body)); await new Promise(resolve => setTimeout(resolve, 200)); res.end('{}'); return; }
  if (req.url.startsWith('/api/search')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ groups: [{ label: 'Sources', results: [{ id: 'synthetic-1', title: 'Synthetic evidence', href: '/app/sources', sourceType: 'File', preview: 'Synthetic fixture only' }] }] })); return; }
  const theme = new URL(req.url, 'http://127.0.0.1').searchParams.get('theme') === 'light' ? 'light' : 'pulsar';
  res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html class="${theme === 'pulsar' ? 'dark pulsar' : ''}" data-theme="${theme}" style="color-scheme:${theme === 'light' ? 'light' : 'dark'}"><head><title>Isolated workflow verification</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{padding:20px}main>button{padding:12px;border:1px solid #ccc;margin:8px}main>section{margin-top:40px}</style></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>`);
 });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 let browser;
 try {
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); requests.push(url.origin + url.pathname); return url.origin === origin ? route.continue() : route.abort(); });
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('dialog[open]'));
  for (const theme of ['light', 'pulsar']) for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/?theme=${theme}`); await page.getByRole('button', { name: 'Open synthetic record' }).waitFor();
   const trigger = page.getByRole('button', { name: 'Open synthetic record' });
   await trigger.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor();
   assert(await inside()); assert(await page.getByRole('dialog').evaluate(element => !!element.closest('.vaeroex-app-shell'))); assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
   const drawerTheme = await page.getByRole('dialog').evaluate(element => {
    const style = getComputedStyle(element), inputStyle = getComputedStyle(element.querySelector('input'));
    return { customerScope: !!element.closest('.vaeroex-customer-workspace'), surface: style.getPropertyValue('--workspace-surface').trim(), fontSize: style.fontSize, inputRadius: inputStyle.borderRadius, inputMinimum: inputStyle.minHeight, inputBackground: inputStyle.backgroundColor };
   });
   assert.equal(drawerTheme.customerScope, true);
   assert.equal(drawerTheme.surface, theme === 'light' ? '#ffffff' : '#111827');
   assert.equal(drawerTheme.fontSize, '14px');
   assert.equal(drawerTheme.inputRadius, '7px');
   assert.equal(drawerTheme.inputMinimum, '42px');
   if (theme === 'pulsar') assert.equal(drawerTheme.inputBackground, 'rgba(3, 7, 18, 0.78)');
   await page.locator('#inside-last').focus(); await page.keyboard.press('Tab'); assert(await inside());
   assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close');
   await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'inside-last');
   await page.evaluate(() => document.querySelector('#after').focus()); assert(await inside());
   await page.screenshot({ path: output + '/record-detail-' + theme + '-' + width + '.png' });
   await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
   assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open synthetic record');
   assert.equal(await page.evaluate(() => document.body.style.overflow), '');
   await page.locator('#before').focus(); await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor();
   assert.equal(await page.getByRole('dialog').count(), 1); assert.equal(await page.evaluate(() => document.activeElement.tagName), 'INPUT');
   const searchTheme = await page.getByRole('dialog').evaluate(element => ({ surface: getComputedStyle(element).getPropertyValue('--workspace-surface').trim(), inputRadius: getComputedStyle(element.querySelector('input')).borderRadius, customerScope: !!element.closest('.vaeroex-customer-workspace') }));
   assert.equal(searchTheme.customerScope, true); assert.equal(searchTheme.surface, drawerTheme.surface); assert.equal(searchTheme.inputRadius, '7px');
   for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert(await inside()); }
   await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'before');
   await page.locator('#external-search').click(); await page.getByRole('option', { name: /Synthetic evidence/ }).waitFor();
   assert.equal(await page.getByRole('dialog').count(), 1);
   for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); assert(await inside()); }
   await page.screenshot({ path: output + '/global-search-' + theme + '-' + width + '.png' });
   await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 0); assert.equal(await page.evaluate(() => document.activeElement.id), 'external-search');
   await trigger.click(); await page.locator('#nested-search').click(); await page.locator('dialog[open]').nth(1).waitFor();
   assert.equal(await page.locator('dialog[open]').count(), 2); await page.keyboard.press('Escape');
   assert.equal(await page.getByRole('dialog').count(), 1); assert.equal(await page.evaluate(() => document.activeElement.id), 'nested-search');
   assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden'); await page.keyboard.press('Escape');
   assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => document.body.style.overflow), '');
   await page.getByLabel('Business detail (required)').fill('Synthetic inspection'); await page.getByLabel('Inspection date (required)').fill('2026-10-04');
   await page.locator('select[name="field:priority"]').selectOption('High');
   await page.getByLabel('Form', { exact: true }).selectOption('00000000-0000-4000-8000-000000000002');
   assert.equal(await page.locator('[name="field:business-detail"]').count(), 0);
   await page.getByLabel('Form', { exact: true }).selectOption('00000000-0000-4000-8000-000000000001');
   assert.equal(await page.getByLabel('Business detail (required)').inputValue(), '');
   await page.getByLabel('Business detail (required)').fill('Synthetic inspection'); await page.getByLabel('Inspection date (required)').fill('2026-10-04');
   await page.locator('select[name="field:priority"]').selectOption('High');
   await page.getByLabel('Submitter name', { exact: true }).fill('Synthetic operator');
   const prior = submitted.length;
   await page.getByRole('button', { name: 'Save submission' }).click();
   assert.equal(await page.getByLabel('Submission summary').evaluate(input => input.validity.valueMissing), true);
   assert.equal(await page.getByLabel('Business detail (required)').inputValue(), 'Synthetic inspection');
   assert.equal(submitted.length, prior);
   await page.getByLabel('Submission summary').fill('Synthetic review');
   const responsePromise = page.waitForResponse(response => response.url().endsWith('/fixture-submit'));
   await page.getByRole('button', { name: 'Save submission' }).evaluate(button => { button.click(); button.click(); });
   await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]')?.disabled);
   await responsePromise;
   assert.equal(submitted.length, prior + 1); assert.equal(submitted.at(-1)['field:business-detail'], 'Synthetic inspection'); assert.equal(submitted.at(-1)['field:inspection-date'], '2026-10-04');
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   results.push({ theme, width, drawerTheme, searchTheme, passed: ['workspace_scoped_theme_inheritance', 'drawer_initial_focus_tab_wrap_inert_background_escape_restore', 'single_responsive_search_shortcut', 'search_results_tab_wrap_external_invoker_restore', 'nested_escape_scroll_lock_restore', 'schema_field_switch_reset_and_submission_payload', 'pending_repeat_click_single_request', 'native_validation_preserves_inputs', 'no_horizontal_overflow'] });
  }
  assert.deepEqual(errors, []); assert(requests.every(url => url.startsWith(origin + '/')));
  const result = { scope: 'Actual hydrated components, repository Tailwind config and app/globals.css under the exact workspace shell classes in light and pulsar themes, in a loopback-only synthetic fixture. Browser submission transport, search responses, navigation and activity are stubs; server actions and database persistence are tested separately. No auth or production/provider access.', results, errors, submittedCount: submitted.length };
  fs.writeFileSync(output + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, output }, null, 2));
 } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
