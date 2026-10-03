// Temporary HTTP-01 bootstrap only. No OAuth, credentials, outbound network,
// request logging, environment-dependent configuration, or HTTP redirects.
import { createServer } from 'node:http';
import { openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function createAcmeBootstrap({ webroot, hostname, ownerUid = 0 }) {
  if (typeof webroot !== 'string' || !webroot.startsWith('/') ||
      hostname !== 'square-sandbox.vaeroex.com' || !Number.isInteger(ownerUid)) {
    throw new Error('acme_configuration_denied');
  }
  for (const path of [webroot, `${webroot}/.well-known`, `${webroot}/.well-known/acme-challenge`]) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o022) !== 0) {
      throw new Error('acme_configuration_denied');
    }
  }
  const sockets = new Set();
  const server = createServer({ maxHeaderSize: 1024, requestTimeout: 5000,
    headersTimeout: 5000, keepAliveTimeout: 1, connectionsCheckingInterval: 1000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Connection', 'close');
    response.on('error', () => request.socket.destroy());
    request.on('error', () => request.socket.destroy());
    const deny = () => { response.writeHead(404); response.end(); };
    if (request.method !== 'GET' || ![hostname, `${hostname}:80`].includes(request.headers.host) ||
        request.headers['transfer-encoding'] !== undefined || request.headers['content-length'] !== undefined ||
        request.rawHeaders.length > 32 || typeof request.url !== 'string') return deny();
    const match = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]{43})$/.exec(request.url);
    if (!match) return deny();
    let fd;
    try {
      fd = openSync(`${webroot}/.well-known/acme-challenge/${match[1]}`, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.uid !== ownerUid || stat.size < 87 || stat.size > 88 || (stat.mode & 0o022) !== 0) return deny();
      const buffer = Buffer.alloc(89);
      const size = readSync(fd, buffer, 0, buffer.length, 0);
      const value = buffer.subarray(0, size).toString('utf8');
      if (size !== stat.size || !new RegExp(`^${match[1]}\\.[A-Za-z0-9_-]{43}\\n?$`).test(value)) return deny();
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': size });
      response.end(buffer.subarray(0, size));
    } catch { deny(); } finally { if (fd !== undefined) closeSync(fd); }
  });
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 1;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('error', () => { for (const socket of sockets) socket.destroy(); });
  return server;
}

// Canonicalize both paths: --preserve-symlinks-main can retain /current in import.meta.url.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 2 || process.platform !== 'linux') throw new Error('acme_start_denied');
    const server = createAcmeBootstrap({ webroot: '/var/lib/vaeroex-square-acme', hostname: 'square-sandbox.vaeroex.com' });
    server.on('error', () => { process.exitCode = 78; });
    server.listen(80, '0.0.0.0');
    process.once('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  } catch { process.exitCode = 78; }
}
