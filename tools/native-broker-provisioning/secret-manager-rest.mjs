import https from "node:https";

const fail = () => new Error("secret_manager_transport_denied");
const parent = "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db";
const numericParent = "projects/112579468800/secrets/square-sandbox-callback-db";
const permissions = Object.freeze(["secretmanager.versions.add", "secretmanager.versions.access", "secretmanager.versions.get", "secretmanager.versions.disable"]);

/** Fixed isolated maintenance transport. No redirects, retries, arbitrary URLs,
 * SDK logging or ambient credential lookup. withAccessToken supplies a borrowed
 * private Buffer; HTTPS necessarily makes transient header/JSON string copies.
 * These are not persisted or included in any returned failure. */
export function createSandboxSecretManagerRestClient({ withAccessToken, request = https.request } = {}) {
  if (typeof withAccessToken !== "function" || typeof request !== "function") throw fail();
  const version = name => {
    const match = typeof name === "string" && /^(projects\/[^/]+\/secrets\/[^/]+)\/versions\/([1-9][0-9]{0,20})$/.exec(name);
    if (!match || ![parent, numericParent].includes(match[1])) throw fail();
    return name;
  };
  async function call(path, body, timeout = 4000) {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10000) throw fail();
    let uses = 0, reply;
    try {
      const result = await withAccessToken(async token => {
        if (++uses !== 1 || !Buffer.isBuffer(token) || token.length < 16 || token.length > 8192 ||
            !token.every(b => b >= 33 && b <= 126)) throw fail();
        const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        try {
          reply = await new Promise((resolve, reject) => {
            let settled = false, response, size = 0;
            const chunks = [];
            const wipe = () => { for (const chunk of chunks) chunk.fill(0); chunks.length = 0; };
            let req, timer;
            const deny = () => {
              if (settled) return;
              settled = true; clearTimeout(timer); wipe(); response?.destroy(); req?.destroy(); reject(fail());
            };
            try {
              req = request({ protocol: "https:", hostname: "secretmanager.googleapis.com", port: 443,
                path: `/v1/${path}`, method: payload ? "POST" : "GET", agent: false,
                rejectUnauthorized: true, headers: { Authorization: `Bearer ${token.toString("ascii")}`,
                  "Content-Type": "application/json", "Cache-Control": "no-store",
                  ...(payload ? { "Content-Length": payload.length } : {}) } }, res => {
                response = res;
                if (res.statusCode !== 200) { deny(); return; }
                res.on("error", deny); res.on("aborted", deny);
                res.on("data", chunk => {
                  if (settled) { chunk.fill(0); return; }
                  size += chunk.length;
                  if (size > 32768 || chunks.length >= 256) { chunk.fill(0); deny(); return; }
                  chunks.push(chunk);
                });
                res.on("end", () => {
                  if (settled) return;
                  const bytes = Buffer.concat(chunks);
                  try {
                    const value = JSON.parse(bytes.toString("utf8"));
                    if (!value || typeof value !== "object" || Array.isArray(value)) throw fail();
                    settled = true; clearTimeout(timer); resolve(value);
                  } catch { deny(); }
                  finally { bytes.fill(0); wipe(); }
                });
              });
              req.on("error", deny);
              timer = setTimeout(deny, timeout);
              req.end(payload);
            } catch { deny(); }
          });
        } finally { payload?.fill(0); }
      });
      if (uses !== 1 || result?.ack !== true || !reply) throw fail();
      return reply;
    } catch { throw fail(); }
  }
  return Object.freeze({
    async preflight() {
      const reply = await call(`${parent}:testIamPermissions`, { permissions });
      if (!Array.isArray(reply.permissions) || permissions.some(p => !reply.permissions.includes(p))) throw fail();
      return Object.freeze({ ack: true });
    },
    async addSecretVersion({ parent: supplied, payload }, options = {}) {
      if (supplied !== parent || !Buffer.isBuffer(payload?.data) || payload.data.length > 8192) throw fail();
      return call(`${parent}:addVersion`, { payload: { data: payload.data.toString("base64"),
        dataCrc32c: String(payload.dataCrc32c) } }, options.timeout);
    },
    async accessSecretVersion({ name }, options = {}) {
      const reply = await call(`${version(name)}:access`, undefined, options.timeout);
      const encoded = reply.payload?.data;
      if (typeof encoded !== "string" || encoded.length > 10924 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw fail();
      reply.payload.data = Buffer.from(encoded, "base64");
      return reply;
    },
    async getSecretVersion({ name }, options = {}) { return call(version(name), undefined, options.timeout); },
    async disableSecretVersion({ name, etag }, options = {}) {
      if (typeof etag !== "string" || !etag.length || etag.length > 256 || /[\u0000-\u001f\u007f]/.test(etag)) throw fail();
      return call(`${version(name)}:disable`, { etag }, options.timeout);
    },
  });
}
