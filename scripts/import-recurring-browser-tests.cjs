/* eslint-disable @typescript-eslint/no-require-imports -- Production pages with isolated synthetic DB and loopback-only browser. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), postcss = require('postcss'), tailwind = require('tailwindcss');
const { root, loadSource, React, renderToStaticMarkup } = require('./integrations-ui-test-support');
const workspace = '11111111-1111-4111-8111-111111111111', connection = '33333333-3333-4333-8333-333333333333';
const specs = {
  loyverse: { table: 'loyverse_connections', rpc: 'loyverse_saved_report', timing: "creation date on Loyverse's server",
    report: { covered_days: 0, requested_days: 7, unknown_date_receipts: 0 } },
  'zoho-books': { table: 'zoho_books_connections', rpc: 'read_zoho_books_history', timing: 'invoices and expenses by their provider dates',
    report: { covered_days: 0, legacy: { days: 0 } } },
  'wix-orders': { table: 'wix_order_connections', rpc: 'wix_order_history_report', timing: 'approved orders created in that window',
    report: { totals: [], coverage: [], covered_days: 0, complete_days: 0, requested_days: 7 } }
};
const state = new Map(), posts = [];

async function render(provider, options) {
  const spec = specs[provider], enabled = state.has(provider) ? state.get(provider) : options.mode !== 'off';
  const row = { id: connection, status: options.mode === 'reauth' ? 'reauthorization_required' : 'connected',
    business_name: 'Fictional merchant', organization_name: 'Fictional organization', currency_code: 'USD',
    last_sync_at: options.mode === 'empty' ? null : '2026-03-08T10:30:00Z', last_error_code: options.mode === 'failed' ? 'sync_failed' : null,
    sync_lease_expires_at: null };
  const recurring = { recurring_enabled: enabled, recurring_authorized_at: enabled ? '2026-03-07T10:30:00Z' : null,
    recurring_next_refresh_at: '2026-03-09T10:30:00Z', recurring_last_attempt_at: options.mode === 'empty' ? null : '2026-03-09T09:30:00Z',
    recurring_failure_count: options.mode === 'failed' ? 1 : 0, recurring_last_failure_at: options.mode === 'failed' ? '2026-03-09T09:30:00Z' : null,
    refresh_not_before: options.mode === 'failed' ? new Date(Date.now() + 7200000).toISOString() : null };
  const db = { from(table) {
    assert.equal(table, spec.table, 'only scoped connection metadata is read');
    const filters = []; let columns;
    const query = { select(value) { columns = value; return query; }, eq(...args) { filters.push(args); return query; }, neq() { return query; }, order() { return query; },
      then(resolve) {
        assert(filters.some(([key, value]) => key === 'workspace_id' && value === workspace));
        return resolve({ data: [row], error: null });
      }, async maybeSingle() {
        assert(columns.startsWith('recurring_'));
        assert(filters.some(([key, value]) => key === 'workspace_id' && value === workspace));
        assert(filters.some(([key, value]) => key === 'id' && value === connection));
        return options.schema === 'missing' ? { data: null, error: { code: '42703' } } : { data: recurring, error: null };
      }
    }; return query;
  }, async rpc(name, args) {
    if (name === 'import_recurring_status') {
      assert.deepEqual(args, { p_workspace: workspace, p_provider: provider, p_connection: connection });
      if (options.authority === 'unavailable') return { data: null, error: { code: 'TEST' } };
      const reason = options.authority || 'active'; return { data: { authorized: reason === 'active', reason }, error: null };
    }
    assert.equal(name, spec.rpc); assert.equal(args.p_workspace_id, workspace); assert.equal(args.p_connection_id, connection);
    return { data: spec.report, error: null };
  } };
  const mocks = {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/workspaces/page-context': { requireWorkspacePage: async () => ({ workspaceId: workspace,
      context: { membership: { role: options.role === 'viewer' ? 'viewer' : 'owner' }, activeWorkspace: { reporting_timezone: 'America/Los_Angeles' } } }) },
    [`@/lib/integrations/${provider}/server`]: { admin: () => db, enabled: () => options.available !== 'off',
      activeToken() { throw Error('credential_read_forbidden'); }, organizations() { throw Error('provider_read_forbidden'); } },
    '@/lib/integrations/import-refresh/scope': { importRecurringAllowed: (scopeWorkspace, scopeProvider) => {
      assert.equal(scopeWorkspace, workspace); assert.equal(scopeProvider, provider); return options.scope !== 'off';
    } }
  };
  return renderToStaticMarkup(await loadSource(`app/app/integrations/${provider}/page.tsx`, mocks).default({ searchParams: Promise.resolve({}) }));
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-import-recurring-browser-'));
  const config = loadSource('tailwind.config.ts').default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, 'app/app/integrations/**/*.tsx'),
    path.join(root, 'components/operations/*.tsx'), path.join(root, 'components/integrations/*.tsx')] })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  let serverError;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST') {
        assert.match(url.pathname, /^\/api\/integrations\/(loyverse|zoho-books|wix-orders)\/recurring-settings$/);
        let body = ''; for await (const chunk of request) body += chunk;
        const fields = Object.fromEntries(new URLSearchParams(body));
        assert.equal(fields.connectionId, connection); assert.deepEqual(Object.keys(fields).sort(), ['confirmation', 'connectionId', 'enabled']);
        assert.equal(fields.confirmation, fields.enabled === 'true' ? 'enable-recurring' : 'disable-recurring');
        const provider = url.pathname.split('/')[3]; posts.push({ provider, ...fields }); state.set(provider, fields.enabled === 'true');
        response.writeHead(303, { location: `/?provider=${provider}&mode=off` }); response.end(); return;
      }
      const provider = url.searchParams.get('provider') || 'loyverse'; assert(specs[provider]);
      const content = await render(provider, Object.fromEntries(url.searchParams));
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Import recurring fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main p-4">${content}</main></body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end('Synthetic fixture failed'); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    for (const width of [1280, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500 });
      const page = await context.newPage();
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const submit = action => Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/recurring-settings')), action()]);
      for (const provider of Object.keys(specs)) {
        state.clear(); await page.goto(`${origin}/?provider=${provider}&mode=off`);
        const section = page.getByRole('region', { name: 'Automatic refresh' }); await section.waitFor();
        const content = await section.innerText(); assert(content.includes('last seven completed UTC calendar dates')); assert(content.includes(specs[provider].timing));
        assert(content.includes('Mar 8, 2026, 3:30 AM PDT')); assert.equal(await section.getByRole('checkbox').isChecked(), false);
        const prior = posts.length;
        await section.getByRole('button', { name: 'Enable automatic refresh' }).click(); assert.equal(posts.length, prior);
        if (width === 1280) { await section.getByRole('checkbox').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Tab'); }
        else await section.getByRole('checkbox').tap();
        await submit(() => width === 1280 ? page.keyboard.press('Enter') : section.getByRole('button', { name: 'Enable automatic refresh' }).tap());
        assert.equal(posts.at(-1).enabled, 'true'); await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
        await page.reload(); await section.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
        await section.getByRole('checkbox').check(); await submit(() => section.getByRole('button', { name: 'Turn off automatic refresh' }).click());
        assert.equal(posts.at(-1).enabled, 'false'); await page.getByRole('button', { name: 'Enable automatic refresh' }).waitFor();
        await page.reload(); await section.getByRole('button', { name: 'Enable automatic refresh' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${provider}/${width} overflow`);
        state.clear(); await page.goto(`${origin}/?provider=${provider}&mode=failed`);
        assert((await section.innerText()).includes('Previously saved information and its original date were kept'));
        assert.equal(await page.getByRole('button', { name: 'Import selected dates' }).isDisabled(), true, 'provider backoff covers manual action');
        await page.screenshot({ path: path.join(output, `${provider}-${width}.png`), fullPage: true });
        for (const options of ['scope=off', 'available=off', 'mode=reauth']) {
          await page.goto(`${origin}/?provider=${provider}&${options}`); await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
          assert((await section.innerText()).includes('Paused'));
        }
        await page.goto(`${origin}/?provider=${provider}&authority=owner_unavailable`);
        const renew = page.getByRole('form', { name: 'Renew automatic refresh authorization' });
        const priorRenew = posts.length; await renew.getByRole('button').click(); assert.equal(posts.length, priorRenew);
        await renew.getByRole('checkbox').check(); await submit(() => renew.getByRole('button').click());
        await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor(); state.clear();
        for (const authority of ['unavailable', 'entitlement_unavailable']) {
          await page.goto(`${origin}/?provider=${provider}&authority=${authority}`);
          const text = await section.innerText(); assert(text.includes(authority === 'unavailable' ? 'Status unavailable' : 'Paused')); assert(!text.split('\n').includes('On'));
        }
        await page.goto(`${origin}/?provider=${provider}&role=viewer`); assert.equal(await page.locator('form[method="post"]').count(), 0);
        await page.goto(`${origin}/?provider=${provider}&schema=missing`);
        assert((await page.getByRole('status').filter({ hasText: 'Automatic refresh settings are unavailable' }).innerText()).includes('saved history are unchanged'));
        assert.equal(await page.getByRole('button', { name: 'Import selected dates' }).isEnabled(), true);
        assert.equal(await page.getByRole('button', { name: 'Enable automatic refresh' }).count(), 0);
        await page.goto(`${origin}/?provider=${provider}&mode=empty`); assert((await section.innerText()).includes('This does not establish that there was no activity'));
      }
      await context.close();
    }
    assert.equal(serverError, undefined);
    console.log(`PASS import recurring UI: Loyverse, Zoho Books, Wix at1280/390/320; keyboard/touch consent, fixture persistence, owner renewal, unavailable/revoked status, failure/backoff, provider timing and pre-migration manual import. Screenshots ${output}. Synthetic DB/form server; no hosted authentication or real provider/model execution.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
