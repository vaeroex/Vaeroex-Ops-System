import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';

export const HOST = 'square-sandbox.vaeroex.com';
export const ORIGIN = `https://${HOST}`;
export const CARD = '/evidence';
const routes = new Map([['/signin', 'GET'], ['/session', 'POST'], ['/signout', 'POST'], ['/workspace', 'POST'], [CARD, 'GET']]);
export const privacyHeaders = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

/** Examine the unnormalized HTTP target and every raw header before Next sees it. */
export function permitted(req, trusted = false) {
  const seen = new Set();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    if (name === 'forwarded' || name.startsWith('x-forwarded-')) {
      if (!trusted || !['x-forwarded-host', 'x-forwarded-proto'].includes(name)) return false;
    }
    if (['next-action', 'rsc', 'next-router-state-tree', 'next-router-prefetch', 'x-middleware-subrequest', 'upgrade', 'transfer-encoding'].includes(name)) return false;
  }
  if (req.headers.host !== HOST || (!trusted && req.socket.servername !== HOST)) return false;
  if (trusted && (req.headers['x-forwarded-host'] !== HOST || req.headers['x-forwarded-proto'] !== 'https')) return false;
  // No query strings, escapes, dot segments, absolute targets, or route normalization.
  if (routes.get(req.url) !== req.method) return false;
  if (req.method === 'POST') {
    if (req.headers.origin !== ORIGIN || req.headers['content-type'] !== 'application/x-www-form-urlencoded') return false;
    const length = req.headers['content-length'];
    if (!(req.url === '/signout' && length === '0') &&
        (!/^[1-9][0-9]{0,3}$/.test(length || '') || Number(length) > 4096)) return false;
  } else if (req.headers['content-length'] && req.headers['content-length'] !== '0') return false;
  return true;
}

export function deny(res, status = 404) { res.writeHead(status, privacyHeaders); res.end('Unavailable'); }

/** TLS terminator has no database client, tokens, credential provider, or logger. */
export function createFront({ key, cert, socketPath, deadline }) {
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now() + 3600000) throw Error('invalid_window');
  const context = tls.createSecureContext({ key, cert, minVersion: 'TLSv1.2' });
  let active = 0;
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2', maxHeaderSize: 8192,
    SNICallback(name, done) { done(name === HOST ? null : Error('unavailable'), name === HOST ? context : undefined); },
  }, (req, res) => {
    if (Date.now() >= deadline || !permitted(req) || active >= 8) return deny(res);
    active++;
    let finished = false;
    const release = () => { if (!finished) { finished = true; active--; } };
    res.once('close', release);
    const upstream = http.request({ socketPath, method: req.method, path: req.url,
      headers: { host: HOST, 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https',
        ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
        ...(req.method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', 'content-length': req.headers['content-length'] } : {}) },
    }, reply => {
      // Never forward arbitrary upstream headers, redirects, debug or cache metadata.
      const headers = { ...privacyHeaders, 'content-type': 'text/html; charset=utf-8' };
      if (reply.headers['set-cookie']) headers['set-cookie'] = reply.headers['set-cookie'];
      if (reply.headers.location && ['/signin', CARD].includes(reply.headers.location)) headers.location = reply.headers.location;
      res.writeHead(reply.statusCode || 503, headers);
      reply.pipe(res);
    });
    upstream.setTimeout(10000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) deny(res, 503); else res.destroy(); });
    res.once('close', () => upstream.destroy());
    req.once('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.headersTimeout = 5000; server.requestTimeout = 10000; server.keepAliveTimeout = 1000;
  server.maxConnections = 16;
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('tlsClientError', () => {});
  const timer = setTimeout(() => { server.closeAllConnections(); server.close(); }, deadline - Date.now());
  timer.unref(); server.once('close', () => clearTimeout(timer));
  return server;
}
