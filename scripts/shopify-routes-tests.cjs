/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript"),
  crypto = require("node:crypto"),
  { PGlite } = require("@electric-sql/pglite");
const root = path.resolve(__dirname, ".."),
  db = new PGlite(),
  workspace = crypto.randomUUID(),
  actor = crypto.randomUUID(),
  session = crypto.randomUUID();
const access = {
  workspaceId: workspace,
  user: { id: actor },
  membership: {
    role: "owner",
    status: "active",
    workspace_id: workspace,
    user_id: actor,
  },
  supabase: {
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: actor, session_id: session } },
      }),
    },
  },
};
let cookie = null,
  providerCalls = 0;
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  );
const resolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...args) {
  return resolve.call(
    this,
    r.startsWith("@/") ? path.join(root, r.slice(2)) : r,
    ...args,
  );
};
const load = Module._load;
Module._load = function (r, ...args) {
  if (r === "server-only") return {};
  if (r === "next/headers")
    return {
      cookies: async () => ({
        get: () => (cookie ? { value: cookie } : undefined),
      }),
    };
  if (r === "@/lib/security/require-workspace-access")
    return { requireWorkspaceAccess: async () => access };
  if (r === "@/lib/security/require-auth")
    return { requireAuth: async () => access };
  if (r === "@/lib/security/get-current-workspace")
    return { getCurrentWorkspace: async () => access };
  if (r === "@/lib/supabase/admin")
    return {
      createSupabaseAdminClient: () => ({
        rpc: async (name, p) => {
          try {
            assert.equal(name, "shopify_lifecycle_v1");
            return {
              data: (
                await db.query(
                  "select public.shopify_lifecycle_v1($1,$2,$3,$4,$5::jsonb) as value",
                  [
                    p.p_operation,
                    p.p_workspace_id,
                    p.p_actor_id,
                    p.p_session_id,
                    JSON.stringify(p.p_payload),
                  ],
                )
              ).rows[0].value,
              error: null,
            };
          } catch {
            return { data: null, error: "database rejected" };
          }
        },
      }),
    };
  return load.call(this, r, ...args);
};
process.env.NEXT_PUBLIC_APP_URL = "https://vaeroex.com";
process.env.SHOPIFY_ENABLED = "true";
process.env.SHOPIFY_CLIENT_ID = "a".repeat(32);
process.env.SHOPIFY_CLIENT_SECRET = "synthetic-secret-123456789";
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString(
  "base64",
);
const routes = {};
for (const name of ["connect", "callback", "sync", "disconnect", "webhooks"])
  routes[name] = require(`../app/api/integrations/shopify/${name}/route.ts`);
function post(route, body, origin = "https://vaeroex.com") {
  return new Request(`https://vaeroex.com/api/integrations/shopify/${route}`, {
    method: "POST",
    headers: {
      host: "vaeroex.com",
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}
const signedCallback = () => {
  const q = new URLSearchParams({
    shop: "test.myshopify.com",
    code: "synthetic-code",
    state: cookie,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
  q.set(
    "hmac",
    crypto
      .createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET)
      .update(
        [...q]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => `${k}=${v}`)
          .join("&"),
      )
      .digest("hex"),
  );
  return new Request(
    "https://vaeroex.com/api/integrations/shopify/callback?" + q,
    { headers: { host: "vaeroex.com" } },
  );
};
(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create table workspaces(id uuid primary key);create table workspace_members(workspace_id uuid,user_id uuid,role text,status text);`);
  await db.exec(
    fs.readFileSync(
      "supabase/migrations/20261014002542_shopify_read_only_connector.sql",
      "utf8",
    ),
  );
  await db.query("insert into auth.users(id) values($1)", [actor]);
  await db.query("insert into auth.sessions values($1,$2,null)", [
    session,
    actor,
  ]);
  await db.query("insert into workspaces values($1)", [workspace]);
  await db.query(
    "insert into workspace_members values($1,$2,'owner','active')",
    [workspace, actor],
  );
  global.fetch = async (url) => {
    providerCalls++;
    if (url.endsWith("/oauth/access_token"))
      return new Response(
        JSON.stringify({
          access_token: "synthetic-access-token",
          refresh_token: "synthetic-refresh-token",
          scope: "read_orders",
          expires_in: 3600,
          refresh_token_expires_in: 7776000,
        }),
      );
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    return new Response(
      JSON.stringify({
        data: {
          orders: {
            nodes: [
              {
                id: "gid://shopify/Order/1",
                createdAt: yesterday,
                test: false,
                cancelledAt: null,
                totalPriceSet: {
                  shopMoney: { amount: "100.25", currencyCode: "USD" },
                },
                totalRefundedSet: {
                  shopMoney: { amount: "10.00", currencyCode: "USD" },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      }),
    );
  };
  let response = await routes.connect.POST(
    post(
      "connect",
      { shop: "test.myshopify.com", confirm: "yes" },
      "https://evil.test",
    ),
  );
  assert(!response.headers.get("location").includes("myshopify"));
  assert.equal(providerCalls, 0);
  response = await routes.connect.POST(
    post("connect", { shop: "test.myshopify.com", confirm: "yes" }),
  );
  assert.equal(response.status, 303);
  const authorization = new URL(response.headers.get("location"));
  assert.equal(authorization.hostname, "test.myshopify.com");
  cookie = authorization.searchParams.get("state");
  assert(response.headers.get("set-cookie").includes("HttpOnly"));
  const request = signedCallback();
  response = await routes.callback.GET(request);
  assert(response.headers.get("location").endsWith("result=connected"));
  assert.equal(providerCalls, 1);
  response = await routes.callback.GET(request);
  assert(response.headers.get("location").endsWith("result=failed"));
  assert.equal(providerCalls, 1, "callback replay never exchanges again");
  response = await routes.sync.POST(post("sync", { confirm: "yes" }));
  assert(response.headers.get("location").endsWith("result=synced"));
  const row = (
    await db.query("select report,ciphertext from private.shopify_connections")
  ).rows[0];
  assert.equal(row.report.days[0].orderTotal, "100.250000");
  assert(!row.ciphertext.includes("synthetic-access"));
  const payload = JSON.stringify({
    shop_domain: "test.myshopify.com",
    shop_id: 123,
    customer: { id: 456 },
    orders_to_redact: [1],
  });
  const hmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET)
    .update(payload)
    .digest("base64");
  const hook = (sig, shop = "test.myshopify.com") =>
    new Request("https://vaeroex.com/api/integrations/shopify/webhooks", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": sig,
        "x-shopify-shop-domain": shop,
        "x-shopify-topic": "customers/redact",
      },
      body: payload,
    });
  response = await routes.webhooks.POST(hook("invalid"));
  assert.equal(response.status, 401);
  response = await routes.webhooks.POST(hook(hmac, "other.myshopify.com"));
  assert.equal(response.status, 400);
  const wrongTopic=hook(hmac);
  wrongTopic.headers.set("x-shopify-topic","shop/redact");
  response=await routes.webhooks.POST(wrongTopic);
  assert.equal(response.status,400,"unsigned topic cannot turn a customer webhook into whole-shop erasure");
  response = await routes.webhooks.POST(hook(hmac));
  assert.equal(response.status, 200);
  assert.equal(
    (await db.query("select report from private.shopify_connections")).rows[0]
      .report,
    null,
  );
  response = await routes.disconnect.POST(
    post("disconnect", { confirm: "yes" }),
  );
  assert(response.headers.get("location").endsWith("result=disconnected"));
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from private.shopify_connections",
      )
    ).rows[0].n,
    0,
  );
  await db.close();
  console.log(
    "PASS route → OAuth → encrypted credential → paginated provider → aggregate database → signed redaction → disconnect; CSRF, replay and tampered webhook denied.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
