import { readFile, lstat, chmod } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { X509Certificate } from 'node:crypto';
import { publicKey } from './src/config.ts';
import { createFront, permitted, deny } from './boundary.mjs';

// One unprivileged, dedicated service. No TCP upstream, generic Next launcher,
// credential provider or normal application directory is used.
const directory = fileURLToPath(new URL('.', import.meta.url));
const socketPath = '/run/vaeroex-square-evidence/upstream.sock';
try {
  const deadline = Number(process.env.SQUARE_EVIDENCE_DEADLINE);
  if (process.getuid() === 0 || process.env.NODE_ENV !== 'production' || process.env.SQUARE_EVIDENCE_HOST !== 'gcp-square-sandbox-workspace-v1' ||
      process.env.NEXT_PUBLIC_APP_URL !== 'https://square-sandbox.vaeroex.com' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://oysjpoondtcrqpghhrbd.supabase.co' ||
      !publicKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > Date.now()+3600000 ||
      Object.keys(process.env).some(k => /^(VERCEL|OPENAI|ANTHROPIC|GOOGLE_APPLICATION_CREDENTIALS|SUPABASE_SERVICE_ROLE|DATABASE_URL|VAEROEX_ADMIN_EMAILS)/.test(k))) throw Error();
  const dir = await lstat('/run/vaeroex-square-evidence');
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid() || (dir.mode & 0o777) !== 0o700) throw Error();
  // Existing socket is an error, not permission to unlink another process's endpoint.
  const app = next({dev:false,dir:directory,quiet:true});
  await app.prepare();
  const handler = app.getRequestHandler();
  let active = 0;
  const upstream = http.createServer({maxHeaderSize:8192}, (req,res) => {
    if (Date.now() >= deadline || active >= 8 || !permitted(req,true)) return deny(res);
    active++;
    Promise.resolve(handler(req,res)).catch(() => { if (!res.headersSent) deny(res,503); else res.destroy(); }).finally(() => active--);
  });
  await new Promise((resolve,reject) => { upstream.once('error',reject); upstream.listen(socketPath,resolve); });
  await chmod(socketPath,0o600);
  const cert = await readFile('/etc/vaeroex-square-evidence/tls.pem');
  const parsed = new X509Certificate(cert);
  if (!parsed.checkHost('square-sandbox.vaeroex.com') || Date.parse(parsed.validTo) <= deadline || Date.parse(parsed.validFrom) > Date.now()) throw Error();
  const front = createFront({key:await readFile('/etc/vaeroex-square-evidence/tls.key'),cert,socketPath,deadline});
  const stop = () => { front.closeAllConnections(); front.close(); upstream.closeAllConnections(); upstream.close(); process.exit(0); };
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
  setTimeout(stop,deadline-Date.now()).unref();
  front.listen(443,'0.0.0.0');
  front.on('error',stop);
} catch { process.stderr.write('square_evidence_startup_rejected\n'); process.exit(1); }
