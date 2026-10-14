/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(
    this,
    request.startsWith("@/") ? path.join(root, request.slice(2)) : request,
    ...args,
  );
};
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === "server-only") return {};
  if (request === "@/lib/supabase/admin") return {};
  if (request.startsWith("@/lib/security/")) return {};
  return load.call(this, request, ...args);
};
const c = require("../lib/integrations/shopify/contracts.ts"),
  p = require("../lib/integrations/shopify/provider.ts"),
  s = require("../lib/integrations/shopify/server.ts");
const secret = "synthetic-secret-123456789",
  now = Date.parse("2026-10-14T00:00:00Z");
process.env.NEXT_PUBLIC_APP_URL = "https://vaeroex.com";
process.env.SHOPIFY_CLIENT_ID = "a".repeat(32);
process.env.SHOPIFY_CLIENT_SECRET = secret;
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
  "base64",
);
let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log("PASS", name);
};
function signed(params) {
  const q = new URLSearchParams(params);
  const message = [...q]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  q.set(
    "hmac",
    crypto.createHmac("sha256", secret).update(message).digest("hex"),
  );
  return q;
}
const order = (id, amount = "10.10", extra = {}) => ({
  id: `gid://shopify/Order/${id}`,
  createdAt: "2026-10-01T12:00:00.000Z",
  test: false,
  cancelledAt: null,
  totalPriceSet: { shopMoney: { amount, currencyCode: "USD" } },
  totalRefundedSet: { shopMoney: { amount: "1.10", currencyCode: "USD" } },
  ...extra,
});
(async () => {
  await test("shop host rejects URLs, credentials, ports, paths and subdomains", () => {
    for (const value of [
      "https://x.myshopify.com",
      "x.myshopify.com.evil.test",
      "x@evil.test",
      "x.myshopify.com:443",
      "x.myshopify.com/",
      "a.b.myshopify.com",
      "localhost",
    ])
      assert.throws(() => c.normalizeShop(value));
    assert.equal(c.normalizeShop(" TEST.myshopify.com "), "test.myshopify.com");
  });
  const query = signed({
    shop: "test.myshopify.com",
    code: "a-code",
    state: "a".repeat(43),
    timestamp: String(now / 1000),
  });
  await test("signed callback, expiration, tampering, duplicate parameters", () => {
    assert.equal(
      c.verifyCallback(query, secret, now).shop,
      "test.myshopify.com",
    );
    assert.throws(() => c.verifyCallback(query, secret, now + 301000));
    const forged = new URLSearchParams(query);
    forged.set("shop", "attacker.myshopify.com");
    assert.throws(() => c.verifyCallback(forged, secret, now));
    const duplicate = new URLSearchParams(query);
    duplicate.append("code", "evil");
    assert.throws(() => c.verifyCallback(duplicate, secret, now));
  });
  await test("webhooks authenticate exact raw bytes", () => {
    const b = Buffer.from('{"shop_domain":"test.myshopify.com"}'),
      h = crypto.createHmac("sha256", secret).update(b).digest("base64");
    assert(c.verifyWebhook(b, h, secret));
    assert(!c.verifyWebhook(Buffer.concat([b, Buffer.from(" ")]), h, secret));
    assert(!c.verifyWebhook(b, "invalid", secret));
  });
  const tokens = {
    accessToken: "synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: new Date(now + 3600000).toISOString(),
    refreshExpiresAt: new Date(now + 86400000).toISOString(),
  };
  await test("encrypted credentials are bound to workspace, shop, generation and version", () => {
    const value = s.tokenCipher(
      "workspace-a",
      "test.myshopify.com",
      1,
      1,
      tokens,
    );
    assert(!value.includes(tokens.accessToken));
    assert.deepEqual(
      s.tokenCipher("workspace-a", "test.myshopify.com", 1, 1, value, true),
      tokens,
    );
    for (const args of [
      ["workspace-b", "test.myshopify.com", 1, 1],
      ["workspace-a", "other.myshopify.com", 1, 1],
      ["workspace-a", "test.myshopify.com", 2, 1],
      ["workspace-a", "test.myshopify.com", 1, 2],
    ])
      assert.throws(() => s.tokenCipher(...args, value, true));
  });
  await test("exact decimal aggregates drop all identifiers and separate currencies", () => {
    const rows = [
      order(1, "0.10"),
      order(2, "0.20"),
      order(3, "9.00", { test: true }),
      order(4, "4.50", {
        totalPriceSet: { shopMoney: { amount: "4.50", currencyCode: "EUR" } },
        totalRefundedSet: { shopMoney: { amount: "0", currencyCode: "EUR" } },
      }),
    ];
    const report = c.aggregateOrders(
      rows,
      "2026-09-14T00:00:00.000Z",
      "2026-10-14T00:00:00.000Z",
    );
    assert.equal(report.orderCount, 3);
    assert.equal(
      report.days.find((d) => d.currency === "USD").orderTotal,
      "0.300000",
    );
    assert(!JSON.stringify(report).includes("gid://"));
    assert.throws(() =>
      c.aggregateOrders([order(1), order(1)], report.start, report.end),
    );
  });
  await test("bounds, currencies and date window reject malformed provider data", () => {
    assert.throws(() => c.units("1e5"));
    assert.throws(() => c.units("-10"));
    assert.throws(() =>
      c.aggregateOrders(
        [order(1, "5", { createdAt: "2020-01-01T00:00:00.000Z" })],
        "2026-09-14T00:00:00.000Z",
        "2026-10-14T00:00:00.000Z",
      ),
    );
    assert.throws(() =>
      c.aggregateOrders(
        [
          order(1, "5", {
            totalRefundedSet: {
              shopMoney: { amount: "1", currencyCode: "EUR" },
            },
          }),
        ],
        "2026-09-14T00:00:00.000Z",
        "2026-10-14T00:00:00.000Z",
      ),
    );
  });
  await test("provider follows all pages without persisting raw order data", async () => {
    let calls = 0;
    global.fetch = async (url, init) => {
      assert.equal(
        url,
        "https://test.myshopify.com/admin/api/2026-10/graphql.json",
      );
      assert.equal(init.redirect, "error");
      const input = JSON.parse(init.body);
      assert.equal(input.variables.after, calls ? "cursor-1" : null);
      calls++;
      return new Response(
        JSON.stringify({
          data: {
            orders: {
              nodes: [order(calls)],
              pageInfo: {
                hasNextPage: calls === 1,
                endCursor: calls === 1 ? "cursor-1" : null,
              },
            },
          },
        }),
      );
    };
    const report = await p.readReport(
      "test.myshopify.com",
      "synthetic-access",
      new Date(now),
    );
    assert.equal(report.orderCount, 2);
    assert.equal(calls, 2);
  });
  await test("GraphQL errors and repeated cursors fail rather than returning partial success", async () => {
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          errors: [{ message: "denied" }],
          data: {
            orders: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      );
    await assert.rejects(
      p.readReport("test.myshopify.com", "token", new Date(now)),
      /graphql/,
    );
    global.fetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            orders: {
              nodes: [order(1)],
              pageInfo: { hasNextPage: true, endCursor: "same" },
            },
          },
        }),
      );
    await assert.rejects(
      p.readReport("test.myshopify.com", "token", new Date(now)),
      /pagination/,
    );
  });
  await test("rate limit, size limit, redaction window and HTTP 401 fail closed", async () => {
    global.fetch = async () => new Response("{}", { status: 429 });
    await assert.rejects(
      p.readReport("test.myshopify.com", "token", new Date(now)),
      /rate_limited/,
    );
    global.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(
      p.readReport("test.myshopify.com", "token", new Date(now)),
      /reauthorize/,
    );
    await assert.rejects(
      p.boundedBody(new Response("too large"), 2),
      /too_large/,
    );
    await assert.rejects(
      p.readReport(
        "test.myshopify.com",
        "token",
        new Date(now),
        "2026-10-14T00:00:01Z",
      ),
      /privacy_window/,
    );
  });
  await test("expiring token exchange accepts only the requested read scope", async () => {
    let scope = "read_orders";
    global.fetch = async (url, init) => {
      assert(init.body.has("expiring"));
      return new Response(
        JSON.stringify({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
          scope,
        }),
      );
    };
    assert.equal(
      (
        await p.requestToken("test.myshopify.com", "id", secret, {
          code: "code",
        })
      ).refreshToken,
      tokens.refreshToken,
    );
    scope = "read_orders,write_orders";
    await assert.rejects(
      p.requestToken("test.myshopify.com", "id", secret, { code: "code" }),
      /scope/,
    );
  });
  await test("same-origin POST validation rejects forged origin and proxy headers", () => {
    const req = (headers) =>
      new Request("https://vaeroex.com/api/integrations/shopify/sync", {
        method: "POST",
        headers: {
          host: "vaeroex.com",
          origin: "https://vaeroex.com",
          ...headers,
        },
      });
    s.assertOrigin(req({}));
    assert.throws(() => s.assertOrigin(req({ origin: "https://evil.test" })));
    assert.throws(() =>
      s.assertOrigin(req({ "x-forwarded-host": "evil.test" })),
    );
  });
  console.log(`${passed} Shopify connector groups passed.`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
