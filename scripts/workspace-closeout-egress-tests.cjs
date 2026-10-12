/* eslint-disable @typescript-eslint/no-require-imports -- Tests local-only audit preload. */
require('./workspace-closeout-egress.cjs');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
(async () => {
  assert.throws(() => fetch('https://example.invalid/'), /closeout_nonlocal_fetch_denied/);
  assert.throws(() => net.Socket.prototype.connect.call({}, { host: 'example.invalid', port: 443 }), /closeout_nonlocal_socket_denied/);
  assert.throws(() => net.Socket.prototype.connect.call({}, 443, 'example.invalid'), /closeout_nonlocal_socket_denied/);
  const server = http.createServer((_, res) => res.end('local'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}`)).text(), 'local'); }
  finally { await new Promise(resolve => server.close(resolve)); }
  console.log('closeout_egress_preload:4_checks_passed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
