/* eslint-disable @typescript-eslint/no-require-imports -- Offline optimized Next/Chromium regression; provider requests are intercepted, never sent. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { root, loadSource } = require('./integrations-ui-test-support');
const policy = require('../lib/integrations/control-plane/square-customer-handoff-policy.json');
const providers = ['xero', 'harvest', 'zoho-inventory'];
const routePath = provider => `/api/integrations/${provider}/connect`;
const { authorizationHandoff, authorizationUrl } = loadSource('lib/integrations/reporting/oauth.ts', {
  '../control-plane/square-customer-handoff-policy.json': policy
});
const cleanEnv = enforce => ({ PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CI: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'https://reporting-db.synthetic.invalid', ...(enforce ? { VAEROEX_ENFORCE_CSP: 'true' } : {}) });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function child(args, cwd, env) {
  const process = spawn(processExec, [require.resolve('next/dist/bin/next'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; process.stdout.on('data', d => { output += d; }); process.stderr.on('data', d => { output += d; });
  const finished = new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', code => resolve(code)); });
  return { process, finished, output: () => output };
}
const processExec = process.execPath;
async function main() {
  process.env.REPORTING_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 1).toString('base64');
  for (const prefix of ['XERO', 'HARVEST', 'ZOHO_INVENTORY']) {
    process.env[`${prefix}_REPORTING_ENABLED`] = 'true';
    process.env[`${prefix}_CLIENT_ID`] = 'synthetic-client'; process.env[`${prefix}_CLIENT_SECRET`] = 'synthetic-secret';
  }
  const hash = createHash('sha256').update(policy.script).digest('base64');
  assert.equal(policy.csp, `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  const fixtures = {}, targets = {};
  for (const provider of providers) {
    const state = 'S'.repeat(43), response = authorizationHandoff(provider, state);
    fixtures[provider] = { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    targets[provider] = authorizationUrl(provider, state);
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('content-security-policy'), policy.csp);
    assert.deepEqual([...fixtures[provider].body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]), [policy.script]);
    assert(fixtures[provider].body.includes('&amp;'), 'query separators remain inert HTML attribute data');
    const hostile = await authorizationHandoff(provider, '\"><script>INERT_CANARY</script>').text();
    assert.equal((hostile.match(/<script>/g) ?? []).length, 1, 'input never adds an executable script');
  }
  for (const provider of ['clockify', 'toggl', 'katana', 'https://evil.invalid']) assert.throws(() => authorizationHandoff(provider, 'S'.repeat(43)));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-handoff-next-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'reporting-offline-handoff-fixture', private: true }));
  fs.writeFileSync(path.join(directory, 'responses.json'), JSON.stringify(fixtures));
  fs.writeFileSync(path.join(directory, 'next.config.mjs'), `import baseline from ${JSON.stringify(pathToFileURL(path.join(root, 'next.config.mjs')).href)};
export default {...baseline,typedRoutes:false,outputFileTracingRoot:${JSON.stringify(directory)},outputFileTracingIncludes:{}};\n`);
  const writeRoute = (pathname, source) => { const target = path.join(directory, 'app', pathname, 'route.js'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); };
  const entryBody = '<!doctype html><html><head><title>Offline reporting handoff</title></head><body>' + providers.map(provider =>
    `<form method="post" action="${routePath(provider)}"><button>${provider}</button></form>`).join('') +
    '<form method="post" action="/legacy"><button>Legacy connect</button></form></body></html>';
  writeRoute('', `export function GET(){return new Response(${JSON.stringify(entryBody)},{headers:{'Content-Type':'text/html'}});}`);
  writeRoute('legacy', `export function POST(){return new Response(null,{status:303,headers:{Location:${JSON.stringify(targets.harvest)}}});}`);
  for (const provider of providers) {
    const routeDirectory = path.join(directory, 'app', routePath(provider));
    const relative = path.relative(routeDirectory, path.join(directory, 'responses.json')).split(path.sep).join('/');
    writeRoute(routePath(provider), `import fixtures from ${JSON.stringify(relative)};
export const dynamic='force-dynamic';
export async function POST(request){const f=fixtures[${JSON.stringify(provider)}];const form=await request.formData();
return new Response(form.has('tamper')?f.body.replace(${JSON.stringify(policy.script)},'document.body.dataset.executed="bad";'):f.body,{status:f.status,headers:f.headers});}`);
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QBO_TEST_CHROME_EXECUTABLE ? { executablePath: process.env.QBO_TEST_CHROME_EXECUTABLE } : {}) });
    for (const enforce of [false, true]) {
      const env = cleanEnv(enforce), build = child(['build'], directory, env);
      const deadline = setTimeout(() => build.process.kill('SIGKILL'), 120000);
      try { assert.equal(await build.finished, 0, build.output()); } finally { clearTimeout(deadline); }
      const server = child(['start', '-H', '127.0.0.1', '-p', '0'], directory, env);
      try {
        const until = Date.now() + 15000;
        while (!server.output().includes('Ready in')) {
          assert.equal(server.process.exitCode, null, server.output()); assert(Date.now() < until, 'Next startup deadline'); await wait(50);
        }
        const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(server.output())?.[0]; assert(origin, server.output());
        const global = await fetch(origin), globalCsp = global.headers.get('content-security-policy');
        assert(globalCsp.includes("form-action 'self' https://checkout.stripe.com https://*.stripe.com"));
        assert(!globalCsp.includes('getharvest.com')); assert(!globalCsp.includes('xero.com')); assert(!globalCsp.includes('zoho.com'));
        for (const provider of providers) {
          const response = await fetch(origin + routePath(provider), { method: 'POST', body: new URLSearchParams(), redirect: 'manual' });
          assert.equal(response.status, 200); assert.equal(await response.text(), fixtures[provider].body);
          assert.equal(response.headers.get('content-security-policy'), policy.csp);
          assert.equal(response.headers.get('content-security-policy-report-only'), policy.csp);
          assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
          assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
          const variant = await fetch(origin + routePath(provider).replace('/connect', '/CONNECT'));
          assert.equal(variant.status, 404); assert.equal(variant.headers.get('content-security-policy'), policy.csp);
        }
        for (const neighbor of ['/api/integrations/clockify/connect', '/api/integrations/toggl/connect', '/api/integrations/katana/connect',
          '/api/integrations/harvest/callback', '/api/integrations/harvest/connect-extra', '/api/integrations/harvest/connect/nested']) {
          const response = await fetch(origin + neighbor); assert.equal(response.status, 404); assert.equal(response.headers.get('content-security-policy'), globalCsp);
        }
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const page = await context.newPage(), navigation = [], violations = [];
          page.setDefaultTimeout(5000);
          page.on('console', message => { if (message.text().includes('form-action')) violations.push(message.text()); });
          await context.route('**/*', route => {
            const request = route.request(); if (new URL(request.url()).origin === origin) return route.continue();
            const provider = providers.find(p => request.url() === targets[p]);
            if (provider && request.isNavigationRequest()) {
              navigation.push({ provider, referrer: request.headers().referer });
              return route.fulfill({ status: 200, contentType: 'text/html', body: `<h1>Synthetic ${provider} boundary</h1>` });
            }
            return route.abort();
          });
          await page.goto(origin); await page.getByRole('button', { name: 'Legacy connect', exact: true }).click();
          await page.waitForFunction(() => document.readyState === 'complete');
          assert.equal(page.url(), origin + '/'); assert.equal(navigation.length, 0); assert(violations.length > 0, 'old cross-origin 303 is blocked by actual global CSP');
          for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const provider of providers) {
              await page.goto(origin); await page.getByRole('button', { name: provider, exact: true }).click();
              await page.getByRole('heading', { name: `Synthetic ${provider} boundary` }).waitFor();
              assert.equal(navigation.at(-1).provider, provider); assert.equal(navigation.at(-1).referrer, undefined);
            }
          }
          await page.goto(origin);
          await page.locator('form').filter({ has: page.getByRole('button', { name: 'harvest', exact: true }) }).evaluate(form => {
            const hidden = document.createElement('input'); hidden.name = 'tamper'; hidden.value = '1'; form.appendChild(hidden);
          });
          const before = navigation.length;
          await page.getByRole('button', { name: 'harvest', exact: true }).click();
          await page.waitForURL('**/api/integrations/harvest/connect');
          await page.waitForLoadState('load');
          assert.equal(await page.evaluate(() => document.body.dataset.executed), undefined, 'altered script denied by fixed hash');
          assert.equal(navigation.length, before, 'altered script cannot navigate');
        } finally { await context.close(); }
        console.log(`PASS: optimized Next ${enforce ? 'enforced' : 'baseline/report-only'} headers, legacy CSP reproduction, three OAuth handoffs on desktop/mobile, no referrer, hash denial and neighboring routes; zero provider requests sent.`);
      } finally { server.process.kill('SIGTERM'); await server.finished; }
    }
  } finally { await browser?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
