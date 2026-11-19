/* eslint-disable @typescript-eslint/no-require-imports -- Actual customer component, isolated state and localhost-only requests. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright'), postcss = require('postcss'), tailwind = require('tailwindcss');
const { root, loadSource, React, renderToStaticMarkup } = require('./integrations-ui-test-support');
const connectionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', entityId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const { SquareDirectCustomerPanel } = loadSource('components/integrations/SquareDirectCustomerPanel.tsx', {
  'next/link': { __esModule: true, default: ({ children, prefetch, ...props }) => { assert.equal(prefetch, false); return React.createElement('a', props, children); } }
});
const posts = [];
let savedConsent;
function render(options) {
  const partial = options.mode === 'partial' || options.mode === 'failed' || options.mode === 'manual';
  const enabled = savedConsent ?? options.mode !== 'off';
  const baseTime = '2026-03-08T10:30:00Z';
  const connection = { connectionId, businessEntityId: entityId, state: options.mode === 'reauth' ? 'reauthorization_required' : 'connected',
    sellerLabel: 'Fictional Square seller', locations: [{ id: 'fictional-location', label: 'Fictional location' }], locationId: 'fictional-location',
    lastSyncedAt: baseTime, checkpointAt: '2026-03-08T10:25:00Z',
    // The later historical import must not be presented as a newer ongoing update.
    lastCompletedRead: { start: '2026-02-01T00:00:00Z', end: '2026-02-02T00:00:00Z', kind: 'created', completedAt: '2026-03-09T10:30:00Z' },
    activeRead: partial ? { start: '2026-03-08T10:20:00Z', end: '2026-03-09T10:30:00Z', kind: options.mode === 'manual' ? 'created' : 'updated' } : null,
    lastError: options.mode === 'failed' ? 'retry_required' : null, hasMore: partial, revocationPending: false, recoveryRequired: false,
    payments: [{ id: 'fictional-payment', locationId: 'fictional-location', status: 'COMPLETED', createdAt: '2026-03-08T10:00:00Z',
      updatedAt: baseTime, amountMinor: '12345', currency: 'USD' }] };
  const view = { available: true, historyAvailable: true, businessEntities: [{ id: entityId, label: 'Fictional entity' }], connections: [connection] };
  const browser = { connectionId, currentConnection: connection, timeZone: 'America/Los_Angeles', timeZoneFallback: false,
    page: 1, pageSize: 25, totalCount: 1, totalPages: 1, filters: { startDate: null, endDate: null, status: 'all' }, payments: connection.payments,
    connections: [{ connectionId, businessEntityId: entityId, businessEntityLabel: 'Fictional entity', sellerLabel: connection.sellerLabel,
      locationLabel: 'Fictional location', state: connection.state, timeZone: 'America/Los_Angeles', timeZoneFallback: false,
      createdAt: '2026-03-01T00:00:00Z', paymentCount: 1 }] };
  const reason = options.reason || (options.mode === 'manual' ? 'manual_read_in_progress' : options.mode === 'reauth' ? 'connection_unavailable' : enabled ? 'active' : 'disabled');
  const recurring = { connectionId, rolloutAllowed: options.scope !== 'off', status: options.schema === 'missing' ? null : {
    recurring_enabled: enabled, recurring_next_refresh_at: '2026-03-09T12:30:00Z', recurring_last_attempt_at: '2026-03-09T10:30:00Z',
    recurring_failure_count: options.mode === 'failed' ? 1 : 0, recurring_last_failure_at: options.mode === 'failed' ? '2026-03-09T10:30:00Z' : null,
    recurring_last_error_code: options.mode === 'failed' ? 'retry_required' : null, authorized: reason === 'active', reason,
    last_successful_refresh_at: options.mode === 'empty' ? null : baseTime, has_more: partial, manual_read_in_progress: options.mode === 'manual'
  } };
  return renderToStaticMarkup(React.createElement(SquareDirectCustomerPanel, { view, browser, recurring, recurringResult: options.result || null }));
}
async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vaeroex-square-recurring-browser-'));
  const config = loadSource('tailwind.config.ts').default;
  const css = (await postcss([tailwind({ ...config, content: [path.join(root, 'components/integrations/*.tsx')] })])
    .process(fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') })).css;
  let serverError;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST') {
        assert.equal(url.pathname, '/api/integrations/square/recurring-settings');
        let body = ''; for await (const chunk of request) body += chunk;
        const fields = Object.fromEntries(new URLSearchParams(body)); assert.equal(fields.connectionId, connectionId);
        assert.deepEqual(Object.keys(fields).sort(), ['confirmation', 'connectionId', 'enabled']);
        assert.equal(fields.confirmation, fields.enabled === 'true' ? 'enable-recurring' : 'disable-recurring');
        posts.push(fields); savedConsent = fields.enabled === 'true';
        response.writeHead(303, { location: '/?mode=off' }); response.end(); return;
      }
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      response.end(`<!doctype html><html lang="en" class="pulsar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Square automatic updates fixture</title><style>${css}</style></head><body>${render(Object.fromEntries(url.searchParams))}</body></html>`);
    } catch (error) { serverError = error; response.writeHead(500); response.end('Synthetic fixture failed'); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    for (const width of [1280, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500 });
      const page = await context.newPage(); await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const submit = action => Promise.all([page.waitForResponse(response => response.request().method() === 'POST'), action()]);
      savedConsent = undefined; await page.goto(`${origin}/?mode=off`);
      const section = page.getByRole('region', { name: 'Automatic Payments updates' }); await section.waitFor();
      let content = await section.innerText(); assert(content.includes('About once an hour')); assert(content.includes('five minutes')); assert(content.includes('up to four pages'));
      assert(content.includes('Mar 8, 2026, 3:30 AM PDT'), 'automatic completion uses actual ongoing success, not later historical success');
      assert.equal(await section.getByRole('checkbox').isChecked(), false);
      const prior = posts.length; await section.getByRole('button').click(); assert.equal(posts.length, prior);
      if (width === 1280) { await section.getByRole('checkbox').focus(); await page.keyboard.press('Space'); await page.keyboard.press('Tab'); }
      else await section.getByRole('checkbox').tap();
      await submit(() => width === 1280 ? page.keyboard.press('Enter') : section.getByRole('button').tap());
      await page.getByRole('button', { name: 'Turn off automatic Payments updates' }).waitFor(); await page.reload();
      assert.equal(posts.at(-1).enabled, 'true');
      await section.getByRole('checkbox').check(); await submit(() => section.getByRole('button').click());
      await page.getByRole('button', { name: 'Enable automatic Payments updates' }).waitFor(); await page.reload(); assert.equal(posts.at(-1).enabled, 'false');
      savedConsent = undefined; await page.goto(`${origin}/?mode=failed`);
      content = await section.innerText(); assert(content.includes('The current search is incomplete')); assert(content.includes('last complete checkpoint were kept'));
      assert.equal(await page.getByRole('button', { name: 'Read next Payments page' }).isDisabled(), true);
      assert.equal(await page.locator('[data-payment-row="true"]').count(), 1, 'saved payment remains available after failure');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Square/${width} overflow`);
      await page.screenshot({ path: path.join(output, `square-recurring-${width}.png`), fullPage: true });
      await page.goto(`${origin}/?mode=manual`); assert((await section.innerText()).includes('Finish the manual historical Payments read'));
      assert.equal(await page.getByRole('button', { name: 'Read next Payments page' }).isEnabled(), true, 'manual history can finish while automation waits');
      for (const options of ['scope=off', 'mode=reauth', 'reason=entitlement_unavailable', 'reason=configuration_unavailable']) {
        await page.goto(`${origin}/?${options}`); assert((await section.innerText()).includes('Paused'));
        await section.getByRole('button', { name: 'Turn off automatic Payments updates' }).waitFor();
      }
      await page.goto(`${origin}/?reason=owner_unavailable`); const renew = page.getByRole('form', { name: 'Renew automatic Payments authorization' });
      assert.equal(await renew.getByRole('checkbox').isChecked(), false); const priorRenew = posts.length;
      await renew.getByRole('button').click(); assert.equal(posts.length, priorRenew);
      await renew.getByRole('checkbox').check(); await submit(() => renew.getByRole('button').click());
      await page.getByRole('button', { name: 'Turn off automatic Payments updates' }).waitFor(); savedConsent = undefined;
      await page.goto(`${origin}/?schema=missing`);
      assert((await page.getByRole('status').filter({ hasText: 'Automatic Payments settings are unavailable' }).innerText()).includes('manual reads and saved Payments are unchanged'));
      assert.equal(await page.getByRole('button', { name: 'Update Payments', exact: true }).isEnabled(), true);
      assert.equal(await page.locator('[data-payment-row="true"]').count(), 1);
      await page.goto(`${origin}/?mode=off&result=enabled`);
      assert.equal(await page.getByRole('status').filter({ hasText: 'Automatic Payments updates are authorized' }).count(), 0, 'URL does not manufacture saved consent');
      await page.goto(`${origin}/?mode=empty`); assert((await section.innerText()).includes('does not establish that there were no Payments'));
      await context.close();
    }
    assert.equal(serverError, undefined);
    console.log(`PASS Square recurring browser at1280/390/320: native keyboard/touch consent and reload, owner renewal, revoked/paused states, failed partial pages, completed ongoing versus historical timing, manual history continuation and missing migration fallback. Screenshots ${output}. Synthetic state/server only; no hosted auth, provider or model execution.`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
