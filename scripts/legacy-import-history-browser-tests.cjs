/* eslint-disable @typescript-eslint/no-require-imports -- Production pages rendered with isolated synthetic data; external requests are blocked. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const { root, loadSource, React, renderToStaticMarkup } = require('./integrations-ui-test-support');

const output = '/tmp/vaeroex-legacy-history-browser';
fs.mkdirSync(output, { recursive: true });
const workspace = 'synthetic-workspace', connection = 'synthetic-connection';
const providers = {
  'zoho-books': { title: 'Zoho Books', table: 'zoho_books_connections', rpc: 'read_zoho_books_history' },
  loyverse: { title: 'Loyverse', table: 'loyverse_connections', rpc: 'loyverse_saved_report' },
  'wix-orders': { title: 'Wix online orders', table: 'wix_order_connections', rpc: 'wix_order_history_report' }
};
function fixture(provider, mode) {
  const imported = !['legacy', 'unimported'].includes(mode);
  const covered = imported ? ['gaps', 'mixed'].includes(mode) ? 3 : 5 : 0;
  const complete = covered - (['partial', 'mixed'].includes(mode) ? 1 : 0);
  const legacy = ['legacy', 'mixed'].includes(mode);
  const empty = mode === 'empty' || mode === 'unimported';
  const first = covered ? '2024-01-01' : null, last = covered ? '2024-01-05' : null;
  const cutoff = covered ? `2024-01-${complete < covered ? '05T12' : '06T00'}:00:00Z` : null;
  if (provider === 'zoho-books') return {
    invoice_count: empty ? 0 : 12, invoice_total: empty ? 0 : 1234.5, outstanding_total: empty ? 0 : 234.5,
    expense_count: empty ? 0 : 4, expense_total: empty ? 0 : 99, excluded_foreign_count: 0,
    covered_days: covered, complete_days: complete, incomplete_days: covered - complete,
    latest_covered_through: cutoff, missing_days: 5 - covered, start: first, end: last,
    legacy: { days: legacy ? 7 : 0, start: '2023-12-01', end: '2023-12-07', invoice_total: 700, expense_total: 70, outstanding_total: 100 }
  };
  if (provider === 'loyverse') return {
    sales: empty ? 0 : 1234.5, refunds: empty ? 0 : 34.5, receipts: empty ? 0 : 12,
    unknown_date_receipts: legacy ? 2 : 0, first_day: first, last_day: last,
    covered_days: covered, complete_days: complete, covered_through: cutoff, requested_days: 5
  };
  return {
    totals: empty ? [] : [{ currency_code: 'USD', order_count: 12, total_amount: 1234.5, paid_count: 10 }],
    coverage: covered ? [{ start_date: '2024-01-01', end_date: '2024-01-02', imported_through: '2024-01-03T00:00:00Z', complete: true },
      { start_date: '2024-01-05', end_date: '2024-01-05', imported_through: cutoff, complete: complete === covered }] : [],
    covered_days: covered, complete_days: complete, requested_days: 5
  };
}
async function render(provider, role, mode, query) {
  const spec = providers[provider];
  assert(spec, 'Only known synthetic providers are available');
  let rpcCalls = 0;
  const db = {
    from(table) {
      assert.equal(table, spec.table, 'Pages must not read credentials or provider data');
      const calls = [];
      const q = { then(resolve) {
        assert(calls.some(([method, field, value]) => method === 'eq' && field === 'workspace_id' && value === workspace));
        return resolve({ error: null, data: [{ id: connection, status: mode === 'reauthorization' ? 'reauthorization_required' : 'connected', organization_name: 'Synthetic merchant',
          business_name: 'Synthetic merchant', currency_code: 'USD', last_sync_at: '2026-10-19T01:00:00Z',
          last_error_code: null, sync_lease_expires_at: null }] });
      } };
      for (const method of ['select', 'eq', 'neq', 'order']) q[method] = (...args) => { calls.push([method, ...args]); return q; };
      return q;
    },
    async rpc(name, args) {
      rpcCalls++;
      assert.equal(name, spec.rpc);
      const dates = provider === 'wix-orders' ? { p_from: query.from ?? null, p_to: query.to ?? null }
        : { p_start_date: query.from ?? null, p_end_date: query.to ?? null };
      assert.deepEqual(args, { p_workspace_id: workspace, p_connection_id: connection, ...dates });
      return { data: mode === 'error' ? null : fixture(provider, mode), error: mode === 'error' ? { message: 'private fixture failure' } : null };
    }
  };
  const mocks = {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/workspaces/page-context': { requireWorkspacePage: async () => ({ workspaceId: workspace, context: { membership: { role } } }) },
    [`@/lib/integrations/${provider}/server`]: { enabled: () => true, admin: () => db,
      activeToken: () => { throw new Error('credential_read_forbidden'); }, organizations: () => { throw new Error('provider_read_forbidden'); } }
  };
  const html = renderToStaticMarkup(await loadSource(`app/app/integrations/${provider}/page.tsx`, mocks).default({ searchParams: Promise.resolve(query) }));
  assert.equal(rpcCalls, query.from === 'invalid' ? 0 : 1, 'Invalid filters must never invoke the report RPC');
  return html;
}
(async () => {
  const config = loadSource('tailwind.config.ts').default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, 'app/app/integrations/**/*.tsx'),
    path.join(root, 'components/operations/*.tsx'), path.join(root, 'components/integrations/DateRangeFields.tsx')] })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  let serverError = null;
  const server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'GET', 'This browser regression never submits mutations');
      const url = new URL(req.url, 'http://127.0.0.1');
      const query = Object.fromEntries([...url.searchParams].filter(([key]) => ['from', 'to'].includes(key)));
      const body = await render(url.searchParams.get('provider') ?? 'loyverse', url.searchParams.get('role') ?? 'owner', url.searchParams.get('mode') ?? 'mixed', query);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Legacy import history fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main p-4">${body}</main></body></html>`);
    } catch (error) { serverError = error; res.writeHead(500); res.end('Synthetic fixture failed'); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const visit = async (provider, mode, role = 'owner', dates = true) => {
      await page.goto(`${origin}/?provider=${provider}&mode=${mode}&role=${role}${dates ? '&from=2024-01-01&to=2024-01-05' : ''}`);
      await page.getByRole('heading', { name: providers[provider].title, exact: true }).waitFor();
      assert.equal(serverError, null);
    };
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const provider of Object.keys(providers)) {
        await visit(provider, 'mixed');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${provider}/${width} page overflow`);
        assert.equal(await page.getByRole('button', { name: 'Import selected dates' }).count(), 1);
        assert.equal(await page.locator('form[method="post"] input[name="startDate"]').count(), 1);
        assert.equal(await page.locator('form[method="get"] input[name="from"]').inputValue(), '2024-01-01');
        assert.equal(await page.locator('form[method="get"] input[name="to"]').inputValue(), '2024-01-05');
        const importButton = await page.getByRole('button', { name: 'Import selected dates' }).boundingBox();
        assert(importButton.height >= 44, `${provider} import target remains usable`);
        if (width === 1280) await page.screenshot({ path: path.join(output, `${provider}.png`), fullPage: true });
        await visit(provider, 'mixed', 'viewer');
        assert.equal(await page.locator('form[method="post"]').count(), 0, `${provider} viewer has no mutations`);
        assert.equal(await page.locator('form[method="get"]').count(), 1, `${provider} viewer can browse saved history`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${provider}/viewer/${width} overflow`);
      }
    }
    for (const provider of Object.keys(providers)) {
      await visit(provider, 'reauthorization');
      assert.equal(await page.locator('form[method="get"]').count(), 1, `${provider} saved history remains accessible while authorization needs renewal`);
      assert.equal(await page.getByRole('button', { name: 'Import selected dates' }).count(), 0);
      await visit(provider, 'gaps');
      let text = await page.locator('body').innerText();
      assert.match(text, provider === 'zoho-books' ? /2 dates in this range have not been imported/ : provider === 'loyverse' ? /This view has unimported dates/ : /2 selected days have no completed import/);
      await visit(provider, 'partial'); text = await page.locator('body').innerText();
      assert.match(text, provider === 'zoho-books' ? /1 imported dates cover only part of the day/ : provider === 'loyverse' ? /4 cover a full UTC day/ : /1 partially imported days/);
      await visit(provider, 'empty'); text = await page.locator('body').innerText();
      if (provider === 'wix-orders') {
        assert.match(text, /5 complete imported days/); assert.match(text, /No saved approved orders in this view/);
      } else {
        assert.deepEqual(await page.locator('dl dd').allTextContents(), ['$0.00', '$0.00', '$0.00', '0']);
      }
      await visit(provider, 'unimported'); text = await page.locator('body').innerText();
      assert.match(text, provider === 'wix-orders' ? /No date range has a verified complete import yet/ : /No completed import covers/);
      assert.equal(await page.locator('dl').count(), 0, `${provider} must not display numerical zeros for unimported dates`);
      assert(!text.includes('$0.00'), `${provider} must not imply an unimported date had no activity`);
      await visit(provider, 'legacy', 'owner', false); text = await page.locator('body').innerText();
      if (provider === 'zoho-books') {
        assert.equal(await page.locator('dl').count(), 0, 'Legacy Books aggregate is not mixed into new history');
        const previous = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Earlier saved summary:' }) });
        await previous.locator('summary').click();
        assert.match(await previous.innerText(), /shown separately to avoid double counting/);
        assert.match(await previous.innerText(), /\$700\.00/);
      } else if (provider === 'loyverse') {
        assert.match(text, /2 receipts from earlier imports have no saved server creation date/);
        assert.match(text, /Their coverage is unverified/);
        await visit(provider, 'legacy');
        assert.equal(await page.locator('dl').count(), 0, 'Loyverse unknown creation dates must not become filtered zeros');
      } else {
        assert.match(text, /Earlier saved orders may appear in totals without verified coverage/);
        assert.match(text, /\$1,234\.50/);
      }
      await visit(provider, 'error');
      assert.match(await page.getByRole('alert').innerText(), /unavailable/);
      assert.equal(await page.locator('dl').count(), 0);
      await page.goto(`${origin}/?provider=${provider}&mode=mixed&from=invalid&to=2024-01-05`);
      assert.match(await page.getByRole('alert').innerText(), /Choose a valid/);
      assert.equal(await page.locator('dl').count(), 0);
    }
    assert.equal(serverError, null);
    console.log(`PASS: three legacy production pages at 1280/390/320px; owner/viewer controls, gap/partial coverage, legacy preservation, observed zeros versus missing dates, errors and invalid-filter RPC exclusion. Screenshots: ${output}`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
