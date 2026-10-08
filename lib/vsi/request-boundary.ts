/** Validate browser mutations without trusting arbitrary forwarded headers.
 * Next development normalizes a loopback request URL to localhost, while the
 * browser's Origin/Host can legitimately be 127.0.0.1 on the same port. */
export function isVsiRequestOriginAllowed(request: Request, environment = process.env) {
  const originText = request.headers.get("origin");
  if (!originText || originText === "null") return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  try {
    const origin = new URL(originText), target = new URL(request.url);
    if (origin.origin !== originText || origin.username || origin.password) return false;
    const host = request.headers.get("host");
    if (host && host !== origin.host) return false;
    if (target.origin === origin.origin) return true;
    const local = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (environment.NODE_ENV !== "production" && local(target.hostname) && local(origin.hostname)
      && origin.protocol === target.protocol && origin.port === target.port) return true;
    const configured = [environment.NEXT_PUBLIC_APP_URL,
      environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined,
      environment.VERCEL_BRANCH_URL ? `https://${environment.VERCEL_BRANCH_URL}` : undefined];
    return configured.some(value => {
      if (!value) return false;
      const known = new URL(value);
      return known.protocol === "https:" && !known.username && !known.password && known.pathname === "/" && !known.search && !known.hash && known.origin === origin.origin;
    });
  } catch { return false; }
}

/** Stop reading oversized chunked bodies before they fill server memory. */
export async function readVsiJson(request: Request, maximumBytes = 32_000): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) throw new RangeError("request_too_large");
  if (!request.body) throw new SyntaxError("empty_request");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new RangeError("request_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
