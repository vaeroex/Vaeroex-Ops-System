import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createSandboxSecretManagerRestClient } from "../secret-manager-rest.mjs";

const parent = "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db";
const numericParent = "projects/112579468800/secrets/square-sandbox-callback-db";
const name = `${numericParent}/versions/1`;
const permissions = ["secretmanager.versions.add", "secretmanager.versions.access", "secretmanager.versions.get", "secretmanager.versions.disable"];
const publicToken = "PUBLIC_SYNTHETIC_NEVER_ISSUED_TOKEN";
const publicSecret = "PUBLIC_SYNTHETIC_PRIVATE_PAYLOAD";
const failure = error => error.constructor === Error && error.message === "secret_manager_transport_denied" && error.cause === undefined;

// No sockets, credentials or providers. Copies are deliberate test-owned public
// fixtures so assertions can inspect the bytes after production buffers wipe.
function fixture({ body = {}, status = 200, mode, chunks, withAccessToken } = {}) {
  const calls = [], frames = [], responseChunks = [], tokens = [];
  const request = (options, callback) => {
    const req = new EventEmitter();
    req.destroyed = false;
    req.destroy = () => { req.destroyed = true; };
    req.end = bytes => {
      if (bytes) frames.push(bytes);
      const call = { options, body: bytes ? JSON.parse(bytes.toString("utf8")) : undefined, req };
      calls.push(call);
      queueMicrotask(() => {
        if (mode === "timeout") return;
        if (mode === "request_error") { req.emit("error", new Error(publicSecret)); return; }
        const res = new EventEmitter();
        res.statusCode = status; res.destroyed = false;
        res.headers = { location: "https://unrelated.invalid/never-follow" };
        res.destroy = () => { res.destroyed = true; };
        call.res = res;
        callback(res);
        if (res.destroyed) return;
        if (mode === "response_error") { res.emit("error", new Error(publicSecret)); return; }
        if (mode === "aborted") { res.emit("aborted"); return; }
        const response = chunks ?? [Buffer.from(JSON.stringify(body))];
        for (const part of response) {
          const chunk = Buffer.from(part);
          responseChunks.push(chunk); res.emit("data", chunk);
        }
        res.emit("end");
      });
    };
    return req;
  };
  const supplier = withAccessToken ?? (async consume => {
    const token = Buffer.from(publicToken); tokens.push(token);
    try { await consume(token); return { ack: true }; }
    finally { token.fill(0); }
  });
  return { client: createSandboxSecretManagerRestClient({ request, withAccessToken: supplier }),
    calls, frames, responseChunks, tokens };
}

test("preflight requests only dedicated-secret required permissions and no credential metadata", async () => {
  const f = fixture({ body: { permissions } });
  assert.deepEqual(await f.client.preflight(), { ack: true });
  assert.equal(f.calls.length, 1);
  const { options, body } = f.calls[0];
  assert.equal(options.protocol, "https:"); assert.equal(options.hostname, "secretmanager.googleapis.com");
  assert.equal(options.port, 443); assert.equal(options.path, `/v1/${parent}:testIamPermissions`);
  assert.equal(options.method, "POST"); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers.Authorization, `Bearer ${publicToken}`);
  assert.equal(options.headers["Cache-Control"], "no-store");
  assert.deepEqual(body, { permissions });
  assert.ok(!options.path.includes(publicToken));
  assert.ok(f.frames.every(bytes => bytes.every(byte => byte === 0)));
  assert.ok(f.tokens.every(bytes => bytes.every(byte => byte === 0)));
});

test("preflight rejects absent individual permissions; no grant or fallback occurs", async () => {
  for (let missing = 0; missing < permissions.length; missing++) {
    const f = fixture({ body: { permissions: permissions.filter((_, index) => index !== missing) } });
    await assert.rejects(f.client.preflight(), failure); assert.equal(f.calls.length, 1);
  }
  for (const body of [{}, { permissions: "all" }, { permissions: [] }]) {
    const f = fixture({ body }); await assert.rejects(f.client.preflight(), failure);
  }
});

test("add sends only private base64/checksum to the exact fixed endpoint and wipes wire Buffer", async () => {
  const f = fixture({ body: { name, state: "ENABLED", clientSpecifiedPayloadChecksum: true } });
  const bytes = Buffer.from(publicSecret);
  const response = await f.client.addSecretVersion({ parent, payload: { data: bytes, dataCrc32c: 1234 } });
  assert.equal(response.name, name); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.path, `/v1/${parent}:addVersion`);
  assert.deepEqual(f.calls[0].body, { payload: { data: bytes.toString("base64"), dataCrc32c: "1234" } });
  assert.equal(f.calls[0].options.method, "POST");
  assert.ok(!f.calls[0].options.path.includes(publicSecret));
  assert.ok(f.frames[0].every(byte => byte === 0));
  assert.ok(f.responseChunks.every(chunk => chunk.every(byte => byte === 0)));
  assert.equal(bytes.toString(), publicSecret); bytes.fill(0);
});

test("access returns caller-owned decoded Buffer, not base64; source chunks wiped", async () => {
  const f = fixture({ body: { name, payload: { data: Buffer.from(publicSecret).toString("base64"), dataCrc32c: "1234" } } });
  const response = await f.client.accessSecretVersion({ name });
  assert.ok(Buffer.isBuffer(response.payload.data)); assert.equal(response.payload.data.toString(), publicSecret);
  assert.equal(f.calls[0].options.path, `/v1/${name}:access`);
  assert.equal(f.calls[0].options.method, "GET"); assert.equal(f.calls[0].body, undefined);
  assert.ok(f.responseChunks.every(chunk => chunk.every(byte => byte === 0)));
  response.payload.data.fill(0);
});

test("disable forwards the exact nonsecret etag precondition", async () => {
  const f = fixture({ body: { name, state: "DISABLED" } });
  await f.client.disableSecretVersion({ name, etag: '"public-etag-1"' });
  assert.equal(f.calls[0].options.path, `/v1/${name}:disable`);
  assert.equal(f.calls[0].options.method, "POST");
  assert.deepEqual(f.calls[0].body, { etag: '"public-etag-1"' });
  const conflict = fixture({ status: 409 });
  await assert.rejects(conflict.client.disableSecretVersion({ name, etag: '"stale-etag"' }), failure);
  assert.equal(conflict.calls.length, 1);
});

test("invalid disable preconditions and add targets fail before token acquisition or I/O", async () => {
  let tokenCalls = 0;
  const f = fixture({ withAccessToken: async () => { tokenCalls++; return { ack: true }; } });
  for (const etag of [undefined, null, "", 123, "x".repeat(257), "bad\netag", "bad\0etag"]) {
    await assert.rejects(f.client.disableSecretVersion({ name, etag }), failure);
  }
  for (const request of [{ parent: numericParent, payload: { data: Buffer.from(publicSecret) } },
    { parent: parent.replace("callback-db", "application"), payload: { data: Buffer.from(publicSecret) } },
    { parent, payload: { data: publicSecret } }, { parent, payload: { data: Buffer.alloc(8193) } }]) {
    await assert.rejects(f.client.addSecretVersion(request), failure);
  }
  assert.equal(tokenCalls, 0); assert.equal(f.calls.length, 0);
});

test("strict exact version path rejects traversal, extra segments, aliases and unrelated resources before I/O", async () => {
  const f = fixture();
  for (const invalid of [undefined, "", `${parent}/versions/latest`, `${parent}/versions/0`, `${parent}/versions/01`,
    `${parent}/versions/-1`, `${parent}/versions/1/versions/2`, `${parent}/versions/../../other/versions/1`,
    `${parent}/versions/%2e%2e/versions/1`, `${parent}/versions/1?x=1`, `${parent}/versions/1#x`,
    `${parent}/versions/1\n`, name.replace("112579468800", "999999999999"), name.replace("callback-db", "application")]) {
    await assert.rejects(f.client.getSecretVersion({ name: invalid }), failure);
    await assert.rejects(f.client.accessSecretVersion({ name: invalid }), failure);
    await assert.rejects(f.client.disableSecretVersion({ name: invalid, etag: "synthetic" }), failure);
  }
  assert.equal(f.calls.length, 0);
  for (const valid of [name, `${parent}/versions/2`]) await f.client.getSecretVersion({ name: valid });
  assert.equal(f.calls.length, 2);
});

test("no retry, redirect following or raw provider error propagation", async () => {
  for (const status of [301, 302, 307, 308, 400, 401, 403, 404, 409, 429, 500, 503]) {
    const f = fixture({ status, body: { error: publicSecret } });
    await assert.rejects(f.client.getSecretVersion({ name }), failure);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true);
    assert.equal(f.calls[0].res.destroyed, true);
  }
  for (const mode of ["request_error", "response_error", "aborted"]) {
    const f = fixture({ mode }); await assert.rejects(f.client.getSecretVersion({ name }), failure);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true);
  }
  const synchronous = createSandboxSecretManagerRestClient({
    withAccessToken: async consume => { await consume(Buffer.from(publicToken)); return { ack: true }; },
    request: () => { throw new Error(publicSecret); },
  });
  await assert.rejects(synchronous.getSecretVersion({ name }), failure);
});

test("timeout is bounded, closes request and never retries", async () => {
  const f = fixture({ mode: "timeout" });
  await assert.rejects(f.client.getSecretVersion({ name }, { timeout: 5 }), failure);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].req.destroyed, true);
  const fresh = fixture();
  for (const timeout of [0, -1, 10001, NaN, "5"]) {
    await assert.rejects(fresh.client.getSecretVersion({ name }, { timeout }), failure);
  }
  assert.equal(fresh.calls.length, 0);
});

test("malformed JSON, oversized bodies and excessive fragments fail sanitized and wipe chunks", async () => {
  for (const chunks of [[Buffer.from("not JSON " + publicSecret)], [Buffer.from("[]")], [Buffer.from("null")],
    [Buffer.alloc(32769, 32)], Array.from({ length: 257 }, () => Buffer.from(" "))]) {
    const f = fixture({ chunks }); await assert.rejects(f.client.getSecretVersion({ name }), failure);
    assert.ok(f.responseChunks.every(chunk => chunk.every(byte => byte === 0)));
    assert.equal(f.calls.length, 1);
  }
  const exact = fixture({ chunks: [Buffer.from("{}" + " ".repeat(32766))] });
  assert.deepEqual(await exact.client.getSecretVersion({ name }), {});
});

test("invalid base64 payload cannot become a usable credential", async () => {
  for (const data of [undefined, 123, "*bad*", "YQ", "YQ=", "YQ===", "YQ==\n", "a".repeat(10928)]) {
    const f = fixture({ body: { name, payload: { data } } });
    await assert.rejects(f.client.accessSecretVersion({ name }), failure);
  }
});

test("token supplier must provide exactly one valid private Buffer and acknowledge consumption", async () => {
  for (const token of [publicToken, Buffer.from("short"), Buffer.alloc(8193, 97), Buffer.from("public token with spaces"), Buffer.from("public-token\nwith-newline")]) {
    const f = fixture({ withAccessToken: async consume => { await consume(token); return { ack: true }; } });
    await assert.rejects(f.client.getSecretVersion({ name }), failure); assert.equal(f.calls.length, 0);
  }
  const missing = fixture({ withAccessToken: async () => ({ ack: true }) });
  await assert.rejects(missing.client.getSecretVersion({ name }), failure); assert.equal(missing.calls.length, 0);
  const noAck = fixture({ withAccessToken: async consume => { await consume(Buffer.from(publicToken)); return { ack: false }; } });
  await assert.rejects(noAck.client.getSecretVersion({ name }), failure); assert.equal(noAck.calls.length, 1);
  const double = fixture({ withAccessToken: async consume => {
    const token = Buffer.from(publicToken);
    try { await consume(token); await consume(token); return { ack: true }; } finally { token.fill(0); }
  } });
  await assert.rejects(double.client.getSecretVersion({ name }), failure); assert.equal(double.calls.length, 1);
  const thrown = fixture({ withAccessToken: async () => { throw new Error(publicToken); } });
  await assert.rejects(thrown.client.getSecretVersion({ name }), failure); assert.equal(thrown.calls.length, 0);
});
