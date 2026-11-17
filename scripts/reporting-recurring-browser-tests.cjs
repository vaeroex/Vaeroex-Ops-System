/* eslint-disable @typescript-eslint/no-require-imports -- Production page rendering with synthetic DB/rollout and loopback-only browser. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), postcss = require('postcss'), tailwind = require('tailwindcss');
const { root, loadSource, React, renderToStaticMarkup } = require('./integrations-ui-test-support');
const { providers, isHistoricalProvider } = loadSource('lib/integrations/reporting/catalog.ts');
const workspace = '10000000-0000-4000-8000-000000000001', connection = '20000000-0000-4000-8000-000000000001';
const state = new Map();
const posts = [];

async function render(provider, options) {
  const enabled = options.mode !== 'off', allowed = options.scope !== 'off', owner = options.role !== 'viewer';
  const row = { id: connection, status: options.mode === 'reauth' ? 'reauthorization_required' : 'connected', created_by: 'synthetic-user',
    account: { id: '123', name: 'Synthetic account for isolated automatic refresh qualification' }, snapshot: null,
    last_sync_at: options.mode === 'empty' ? null : '2026-03-08T10:30:00Z', last_error_code: options.mode === 'failed' ? 'quota_exceeded' : null,
    next_sync_at: '2020-01-01T00:00:00Z' };
  const recurring = { recurring_enabled: state.has(provider) ? state.get(provider) : enabled,
    recurring_authorized_at: enabled ? '2026-03-07T10:30:00Z' : null, recurring_next_refresh_at: '2026-03-09T10:30:00Z',
    recurring_last_attempt_at: options.mode === 'empty' ? null : '2026-03-09T09:30:00Z', recurring_failure_count: options.mode === 'failed' ? 1 : 0,
    recurring_last_failure_at: options.mode === 'failed' ? '2026-03-09T09:30:00Z' : null };
  const db = { from(table) {
    assert.equal(table, 'reporting_connections');
    let columns = ''; const scope = [];
    const query = { select(value) { columns = value; return query; }, eq(...args) { scope.push(args); return query; }, neq() { return query; },
      async maybeSingle() {
        assert(scope.some(([key, value]) => key === 'workspace_id' && value === workspace));
        assert(scope.some(([key, value]) => key === 'provider' && value === provider));
        if (columns.startsWith('recurring_')) {
          assert(scope.some(([key, value]) => key === 'id' && value === connection));
          return options.schema === 'missing' ? { data: null, error: { code: '42703' } } : { data: recurring, error: null };
        }
        return { data: row, error: null };
      }
    }; return query;
  }, async rpc(name) {
    assert.equal(name, 'read_reporting_history');
    return { error: null, data: { hasHistory: false, metrics: [], records: 0,
      coverage: { days: 0, completeDays: 0, incompleteDays: 0, startDate: null, endDate: null, lastImportedAt: null, coveredThrough: null } } };
  } };
  const mocks = {
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { notFound() { throw new Error('NOT_FOUND'); } },
    '@/lib/workspaces/page-context': { requireWorkspacePage: async () => ({ workspaceId: workspace,
      context: { membership: { role: owner ? 'owner' : 'viewer', user_id: 'synthetic-user' }, activeWorkspace: { reporting_timezone: 'America/Los_Angeles' } }, supabase: db }) },
    '@/lib/integrations/reporting/security': { ...loadSource('lib/integrations/reporting/security.ts'), available: () => options.available !== 'off',
      admin: () => ({ async rpc(name, args) {
        assert.equal(name, 'reporting_recurring_status');
        assert.deepEqual(args, { p_workspace: workspace, p_provider: provider, p_connection: connection });
        if (options.authority === 'unavailable') return { data: null, error: { code: 'test_unavailable' } };
        const reason = options.authority || 'active';
        return { data: { authorized: reason === 'active', reason }, error: null };
      } }) },
    '@/lib/integrations/reporting/recurring-scope': { reportingRecurringAllowed: (scopeWorkspace, scopeProvider) => {
      assert.equal(scopeWorkspace, workspace); assert.equal(scopeProvider, provider); return allowed;
    } }
  };
  return renderToStaticMarkup(await loadSource('app/app/integrations/[provider]/page.tsx', mocks).default({
    params: Promise.resolve({ provider }), searchParams: Promise.resolve({})
  }));
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-reporting-recurring-browser-'));
  const config = loadSource('tailwind.config.ts').default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, 'app/app/integrations/[[]provider]/page.tsx'),
    path.join(root, 'components/operations/*.tsx'), path.join(root, 'components/integrations/*.tsx')] })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  let serverError;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST') {
        assert.match(url.pathname, /^\/api\/integrations\/(xero|harvest|clockify|toggl|katana|zoho-inventory)\/recurring-settings$/);
        let body = ''; for await (const chunk of request) body += chunk;
        const fields = Object.fromEntries(new URLSearchParams(body));
        assert.equal(fields.connectionId, connection);
        assert.deepEqual(Object.keys(fields).sort(), ['confirmation', 'connectionId', 'enabled']);
        assert.equal(fields.confirmation, fields.enabled === 'true' ? 'enable-recurring' : 'disable-recurring');
        const provider = url.pathname.split('/')[3]; posts.push({ provider, ...fields });
        state.set(provider, fields.enabled === 'true');
        response.writeHead(303, { location: `/?provider=${provider}&mode=off` }); response.end(); return;
      }
      const provider = url.searchParams.get('provider') || 'harvest';
      assert(providers.includes(provider));
      const content = await render(provider, Object.fromEntries(url.searchParams));
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recurring reporting fixture</title><style>${css}</style></head><body class="vaeroex-customer-workspace"><main class="workspace-main p-4">${content}</main></body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end('Synthetic fixture failed'); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    for (const width of [1280, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500 });
      const page = await context.newPage();
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      for (const provider of providers) {
        state.clear(); await page.goto(`${origin}/?provider=${provider}&mode=off`);
        const section = page.getByRole('region', { name: 'Automatic refresh' });
        await section.waitFor();
        assert((await section.innerText()).includes(isHistoricalProvider(provider) ? 'last seven completed UTC calendar dates' : 'Every six hours'));
        assert.equal(await section.getByRole('checkbox').isChecked(), false);
        assert((await section.innerText()).includes('Mar 8, 2026, 3:30 AM PDT'), 'configured workspace zone observes DST');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${provider}/${width} overflow`);
        const prior = posts.length;
        await section.getByRole('button', { name: 'Enable automatic refresh' }).click();
        assert.equal(posts.length, prior, 'native required consent blocks unchecked submit');
        const checkbox = section.getByRole('checkbox');
        if (width === 1280) { await checkbox.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Tab'); }
        else await checkbox.tap();
        const button = section.getByRole('button', { name: 'Enable automatic refresh' });
        assert((await button.boundingBox()).height >= 44, 'touch target >=44px');
        await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/recurring-settings')),
          width === 1280 ? page.keyboard.press('Enter') : button.tap()]);
        assert.equal(posts.length, prior + 1); assert.equal(posts.at(-1).enabled, 'true');
        await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
        await page.reload();
        await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
        const disable = page.getByRole('region', { name: 'Automatic refresh' });
        await disable.getByRole('checkbox').check();
        await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/recurring-settings')),
          disable.getByRole('button', { name: 'Turn off automatic refresh' }).click()]);
        assert.equal(posts.at(-1).enabled, 'false');
        await page.getByRole('button', { name: 'Enable automatic refresh' }).waitFor();
        await page.reload(); await page.getByRole('button', { name: 'Enable automatic refresh' }).waitFor();
      }
      state.clear();
      await page.goto(`${origin}/?provider=harvest&mode=failed`);
      assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('Previously saved information and its original date were kept'));
      assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('Treat the saved evidence as last-known information'));
      await page.screenshot({ path: path.join(output, `reporting-recurring-${width}.png`), fullPage: true });
      for (const options of ['scope=off', 'available=off', 'mode=reauth']) {
        await page.goto(`${origin}/?provider=harvest&${options}`);
        await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
        assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('Paused'));
        assert.equal(await page.getByRole('button', { name: 'Enable automatic refresh' }).count(), 0);
      }
      await page.goto(`${origin}/?provider=harvest&mode=off&scope=off`);
      assert.equal(await page.getByRole('region', { name: 'Automatic refresh' }).count(), 0);
      await page.goto(`${origin}/?provider=harvest&authority=owner_unavailable`);
      const renew = page.getByRole('form', { name: 'Renew automatic refresh authorization' });
      assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('Paused'));
      assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('owner who authorized it no longer has the required access'));
      assert.equal(await renew.getByRole('checkbox').isChecked(), false);
      const priorRenewal = posts.length;
      await renew.getByRole('button').click(); assert.equal(posts.length, priorRenewal, 'renewing requires fresh explicit consent');
      await renew.getByRole('checkbox').check();
      await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/recurring-settings')), renew.getByRole('button').click()]);
      assert.equal(posts.at(-1).enabled, 'true');
      await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
      state.clear();
      for (const authority of ['unavailable', 'entitlement_unavailable']) {
        await page.goto(`${origin}/?provider=harvest&authority=${authority}`);
        const content = await page.getByRole('region', { name: 'Automatic refresh' }).innerText();
        assert(content.includes(authority === 'unavailable' ? 'Status unavailable' : 'Paused'));
        assert(!content.split('\n').includes('On'), 'failed authority check never claims running');
        assert.equal(await page.getByRole('button', { name: 'Renew automatic refresh authorization' }).count(), 0);
        await page.getByRole('button', { name: 'Turn off automatic refresh' }).waitFor();
      }
      await page.goto(`${origin}/?provider=harvest&role=viewer`);
      assert.equal(await page.locator('form[method="post"]').count(), 0, 'viewer can inspect refresh but not authorize');
      await page.goto(`${origin}/?provider=harvest&mode=empty`);
      assert((await page.getByRole('region', { name: 'Automatic refresh' }).innerText()).includes('This does not establish that there was no activity'));
      await page.goto(`${origin}/?provider=harvest&schema=missing`);
      assert((await page.getByRole('status').innerText()).includes('Automatic refresh settings are unavailable'));
      assert.equal(await page.getByRole('button', { name: 'Enable automatic refresh' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Import selected dates' }).count(), 1, 'pre-migration connection retains manual import');
      assert.equal(await page.getByRole('button', { name: 'Disconnect', exact: true }).count(), 1);
      await context.close();
    }
    assert.equal(serverError, undefined);
    console.log(`PASS recurring reporting UI: six providers, 1280/390/320px, keyboard/touch native consent, saved fixture reload, owner/viewer, renewed owner authorization, unavailable/denied authority, paused/revoked setup, failure dates and pre-migration compatibility. Screenshots: ${output}. Synthetic DB/form server only; no authenticated hosted provider or model execution.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
