import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import {
  CallbackBoundaryError,
  evaluateSquareProductionCallback,
  SQUARE_BACKEND_MAX_HEADER_COUNT,
  SQUARE_CALLBACK_PATH,
  SQUARE_EDGE_INPUT_MAX_HEADER_COUNT,
  SQUARE_HANDOFF_VERSION,
  SQUARE_PRODUCTION_HOST,
} from "./callback-boundary.mjs";

const state = "0123456789_abcdefghijklmnopqrstuvwxyz-ABCDE";
const stateHash = createHash("sha256").update(state).digest("hex");
const nowMs = 1_800_000_000_000;
const authorizedQuery = `state=${state}&code=synthetic-code`;

function encodeQuery(query) {
  return Buffer.from(query, "utf8").toString("base64url");
}

function paddingHeaders(count) {
  return Array.from({ length: count }, (_, index) => [`x-vaeroex-padding-${index}`, "x"]).flat();
}

function request(extra = [], overrides = {}, query = authorizedQuery) {
  return {
    method: "GET",
    url: SQUARE_CALLBACK_PATH,
    rawHeaders: [
      "host", SQUARE_PRODUCTION_HOST,
      "content-length", "0",
      "x-vaeroex-oauth-handoff-version", SQUARE_HANDOFF_VERSION,
      "x-vaeroex-oauth-query", encodeQuery(query),
      ...extra,
    ],
    ...overrides,
  };
}

function authority(overrides = {}) {
  let available = true;
  return {
    now: () => nowMs,
    consumeState: async ({ stateHash: candidate, nowMs: consumedAt }) => {
      if (!available) return null;
      available = false;
      return {
        accepted: true,
        consumedAtMs: consumedAt,
        csrfVerified: true,
        currentGeneration: 7,
        expiresAtMs: consumedAt + 60_000,
        generation: 7,
        stateHash: candidate,
        ...overrides,
      };
    },
  };
}

async function throughRealNodeParser(headerCount) {
  const headers = [
    ["Host", SQUARE_PRODUCTION_HOST],
    ["Content-Length", "0"],
    ["x-vaeroex-oauth-handoff-version", SQUARE_HANDOFF_VERSION],
    ["x-vaeroex-oauth-query", encodeQuery(authorizedQuery)],
  ];
  while (headers.length < headerCount) headers.push([`x-vaeroex-padding-${headers.length}`, "x"]);

  let finishObservation;
  let failObservation;
  const observation = new Promise((resolve, reject) => {
    finishObservation = resolve;
    failObservation = reject;
  });
  const server = http.createServer({ maxHeaderSize: 32_768 }, async (incoming, outgoing) => {
    incoming.resume();
    let accepted = true;
    try {
      await evaluateSquareProductionCallback({
        method: incoming.method,
        url: incoming.url,
        rawHeaders: incoming.rawHeaders,
      }, authority());
    } catch (error) {
      assert.ok(error instanceof CallbackBoundaryError);
      accepted = false;
    }
    finishObservation({ accepted, observedHeaderCount: incoming.rawHeaders.length / 2 });
    outgoing.writeHead(accepted ? 204 : 400, { "connection": "close" });
    outgoing.end();
  });
  server.maxHeadersCount = 0;
  server.on("clientError", failObservation);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    const payload = [
      `GET ${SQUARE_CALLBACK_PATH} HTTP/1.0`,
      ...headers.map(([name, value]) => `${name}: ${value}`),
      "",
      "",
    ].join("\r\n");
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("node_parser_harness_timeout"));
      }, 5_000);
      socket.once("connect", () => socket.end(payload));
      socket.on("data", () => {});
      socket.once("error", reject);
      socket.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return await observation;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function rejected(input, dependencies = authority()) {
  await assert.rejects(() => evaluateSquareProductionCallback(input, dependencies), CallbackBoundaryError);
}

test("accepts one exact edge handoff and atomically rejects replay", async () => {
  const stateAuthority = authority();
  assert.deepEqual(await evaluateSquareProductionCallback(request(), stateAuthority), {
    kind: "authorized",
    authorizationCode: "synthetic-code",
    generation: 7,
  });
  await rejected(request(), stateAuthority);
});

test("accepts the 64-header edge envelope plus two handoff headers and rejects a 67th backend header", async () => {
  assert.equal(SQUARE_EDGE_INPUT_MAX_HEADER_COUNT, 64);
  assert.equal(SQUARE_BACKEND_MAX_HEADER_COUNT, 66);

  // The request fixture already has four backend headers, including the two
  // headers appended by the edge. Add 62 ordinary inputs to exercise all 66.
  assert.deepEqual(await evaluateSquareProductionCallback(request(paddingHeaders(62)), authority()), {
    kind: "authorized",
    authorizationCode: "synthetic-code",
    generation: 7,
  });

  let calls = 0;
  await rejected(request(paddingHeaders(63)), {
    now: () => nowMs,
    consumeState: async () => { calls++; return null; },
  });
  assert.equal(calls, 0);
});

test("the real Node HTTP parser preserves 66 headers and exposes the 67th for explicit rejection", async () => {
  assert.deepEqual(await throughRealNodeParser(66), { accepted: true, observedHeaderCount: 66 });
  assert.deepEqual(await throughRealNodeParser(67), { accepted: false, observedHeaderCount: 67 });
});

test("accepts the optional exact code response type", async () => {
  assert.deepEqual(await evaluateSquareProductionCallback(request([], {}, `state=${state}&code=synthetic-code&response_type=code`), authority()), {
    kind: "authorized",
    authorizationCode: "synthetic-code",
    generation: 7,
  });
});

test("consumes an exact provider denial without retaining provider text", async () => {
  const input = request([], {}, `state=${state}&error=access_denied&error_description=provider%20text`);
  assert.deepEqual(await evaluateSquareProductionCallback(input, authority()), { kind: "denied", generation: 7 });
});

test("rejects direct Cloud Run authority, forwarding authority, queries, methods, and bodies before state IO", async () => {
  const candidates = [
    request([], { method: "POST" }),
    request([], { url: `${SQUARE_CALLBACK_PATH}?state=${state}&code=synthetic-code` }),
    request([], { rawHeaders: request().rawHeaders.with(1, "square-production-oauth-abc-uw.a.run.app") }),
    request(["forwarded", "host=square.vaeroex.com"]),
    request(["x-forwarded-host", SQUARE_PRODUCTION_HOST]),
    request(["transfer-encoding", "chunked"]),
    request([], { rawHeaders: request().rawHeaders.with(3, "1") }),
  ];
  for (const candidate of candidates) {
    let calls = 0;
    await rejected(candidate, { now: () => nowMs, consumeState: async () => { calls++; return null; } });
    assert.equal(calls, 0);
  }
});

test("rejects malformed, duplicate, conflicting, and unknown internal handoff headers", async () => {
  const base = request().rawHeaders;
  const candidates = [
    request([], { rawHeaders: base.concat("x-vaeroex-oauth-query", encodeQuery(authorizedQuery)) }),
    request([], { rawHeaders: base.concat("x-vaeroex-oauth-code", "legacy") }),
    request([], { rawHeaders: base.concat("x-vaeroex-oauth-state", state) }),
    request([], { rawHeaders: base.concat("x-vaeroex-oauth-denied", "1") }),
    request([], { rawHeaders: base.concat("x-vaeroex-oauth-extra", "unknown") }),
    request([], { rawHeaders: base.with(5, "wrong-version") }),
    request([], { rawHeaders: base.with(7, "abc=") }),
    request([], { rawHeaders: base.with(7, "A") }),
    request([], { rawHeaders: base.with(7, encodeQuery("x".repeat(8_193))) }),
    request([], { rawHeaders: base.slice(0, -2) }),
    request([], { rawHeaders: ["host", SQUARE_PRODUCTION_HOST, ...base] }),
  ];
  for (const candidate of candidates) await rejected(candidate);
});

test("backend alone rejects duplicate, unknown, conflicting, malformed, and unsafe OAuth query semantics", async () => {
  const queries = [
    `state=${state}&code=x&code=y`,
    `state=${state}&code=x&scope=unknown`,
    `state=${state}&code=x&error=access_denied`,
    `state=${state}&code=x&response_type=token`,
    `state=${state}&code=x&error_description=unexpected`,
    `state=${state}&code=%0d%0aforged`,
    `state=${state}&code=%ZZ`,
    "state=short&code=x",
    `code=x&response_type=code`,
    `state=${state}&error=access_denied&response_type=code`,
  ];
  for (const query of queries) {
    let calls = 0;
    await rejected(request([], {}, query), { now: () => nowMs, consumeState: async () => { calls++; return null; } });
    assert.equal(calls, 0, query);
  }
});

test("rejects failed CSRF binding, stale generation, expiry, and mismatched state authority", async () => {
  for (const changed of [
    { csrfVerified: false },
    { currentGeneration: 8 },
    { expiresAtMs: nowMs },
    { consumedAtMs: nowMs - 1 },
    { stateHash: "0".repeat(64) },
    { accepted: false },
  ]) await rejected(request(), authority(changed));
  assert.notEqual(stateHash, "0".repeat(64));
});
