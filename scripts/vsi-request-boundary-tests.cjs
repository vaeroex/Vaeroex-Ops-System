/* eslint-disable @typescript-eslint/no-require-imports -- Isolated actual-source test loader. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(require.resolve('../lib/vsi/request-boundary.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleValue = { exports: {} }; new Function('exports', 'module', source)(moduleValue.exports, moduleValue);
const { isVsiRequestOriginAllowed, readVsiJson } = moduleValue.exports;
const request = (url, origin, extra = {}) => new Request(url, { method: 'POST', headers: { ...(origin ? { origin } : {}), ...extra } });
async function run() {
  assert(isVsiRequestOriginAllowed(request('http://localhost:49941/api/vsi/conversations', 'http://127.0.0.1:49941', { host: '127.0.0.1:49941' }), { NODE_ENV: 'development' }));
  assert(!isVsiRequestOriginAllowed(request('http://localhost:49941/api/vsi/conversations', 'http://127.0.0.1:49941'), { NODE_ENV: 'production' }));
  assert(!isVsiRequestOriginAllowed(request('http://localhost:49941/api/vsi/conversations', 'http://127.0.0.1:49942'), { NODE_ENV: 'development' }));
  assert(isVsiRequestOriginAllowed(request('https://www.vaeroex.com/api/vsi/conversations', 'https://www.vaeroex.com', { host: 'www.vaeroex.com', 'sec-fetch-site': 'same-origin' }), { NODE_ENV: 'production' }));
  assert(isVsiRequestOriginAllowed(request('https://internal.vercel.app/api/vsi/conversations', 'https://feature.vercel.app', { host: 'feature.vercel.app' }), { NODE_ENV: 'production', VERCEL_URL: 'feature.vercel.app' }));
  assert(!isVsiRequestOriginAllowed(request('https://www.vaeroex.com/api/vsi/conversations', 'https://evil.example', { 'x-forwarded-host': 'evil.example' }), { NODE_ENV: 'production' }));
  assert(!isVsiRequestOriginAllowed(request('https://www.vaeroex.com/api/vsi/conversations', 'https://www.vaeroex.com', { 'sec-fetch-site': 'cross-site' }), { NODE_ENV: 'production' }));
  assert(!isVsiRequestOriginAllowed(request('https://www.vaeroex.com/api/vsi/conversations', null), { NODE_ENV: 'production' }));
  assert.deepEqual(await readVsiJson(new Request('http://localhost', { method: 'POST', body: '{"message":"hello"}' })), { message: 'hello' });
  await assert.rejects(() => readVsiJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(32001) })), RangeError);
  await assert.rejects(() => readVsiJson(new Request('http://localhost', { method: 'POST', body: '{' })), SyntaxError);
  console.log('VSI request boundary: 11 assertions passed (origin, proxy normalization, CSRF, bounded JSON).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
