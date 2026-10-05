/* eslint-disable @typescript-eslint/no-require-imports -- Node-only isolated test preload. */
// Test-process preload only. Never imported by application code.
const net = require('node:net');
const local = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (host && !local(host)) throw new Error('closeout_nonlocal_socket_denied');
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) throw new Error('closeout_nonlocal_fetch_denied');
  return originalFetch(input, options);
};
