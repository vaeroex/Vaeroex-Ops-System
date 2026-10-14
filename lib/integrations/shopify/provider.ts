import "server-only";
import { z } from "zod";
import {
  aggregateOrders,
  OrderSchema,
  SHOPIFY_API_VERSION,
  SHOPIFY_SCOPE,
  ShopSchema,
  TokenSchema,
} from "./contracts";

export async function boundedBody(response: Response, limit: number) {
  if (!response.body) throw new Error("shopify_empty_response");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit || chunks.length > 8192)
        throw new Error("shopify_response_too_large");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function json(url: string, init: RequestInit, limit = 2_000_000) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 401
        ? "shopify_reauthorize"
        : response.status === 429
          ? "shopify_rate_limited"
          : "shopify_provider_failed",
    );
  }
  return JSON.parse(
    (await boundedBody(response, limit)).toString("utf8"),
  ) as unknown;
}
const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive().max(86400),
  refresh_token_expires_in: z.number().int().positive().max(31536000),
  scope: z.string(),
});
export async function requestToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  grant: { code: string } | { refresh_token: string },
) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...("code" in grant
      ? { code: grant.code, expiring: "1" }
      : { grant_type: "refresh_token", refresh_token: grant.refresh_token }),
  });
  const token = TokenResponse.parse(
    await json(
      `https://${ShopSchema.parse(shop)}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      },
      64000,
    ),
  );
  if (
    token.scope
      .split(",")
      .map((s) => s.trim())
      .sort()
      .join(",") !== SHOPIFY_SCOPE
  )
    throw new Error("shopify_scope_mismatch");
  const now = Date.now();
  return TokenSchema.parse({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now + token.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(
      now + token.refresh_token_expires_in * 1000,
    ).toISOString(),
  });
}
export const ORDERS_QUERY = `query VaeroexOrders($after: String, $query: String!) {
 orders(first: 100, after: $after, sortKey: CREATED_AT, query: $query) {
  nodes { id createdAt test cancelledAt totalPriceSet { shopMoney { amount currencyCode } } totalRefundedSet { shopMoney { amount currencyCode } } }
  pageInfo { hasNextPage endCursor }
 }
}`;
export async function readReport(
  shop: string,
  token: string,
  now = new Date(),
  cutoff: string | null = null,
) {
  // Last 30 complete UTC days: fixed window, with no incomplete day presented as a trend.
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const start = new Date(
    Math.min(
      Date.parse(end),
      Math.max(
        Date.parse(end) - 30 * 86400000,
        cutoff ? Date.parse(cutoff) : 0,
      ),
    ),
  ).toISOString();
  if (start === end) throw new Error("shopify_privacy_window_pending");
  const rows: z.infer<typeof OrderSchema>[] = [];
  let after: string | null = null;
  const cursors = new Set<string>(),
    deadline = Date.now() + 180000;
  for (let page = 0; page < 100; page++) {
    if (Date.now() > deadline) throw new Error("shopify_report_too_large");
    const raw = await json(
      `https://${ShopSchema.parse(shop)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: {
            after,
            query: `created_at:>='${start}' created_at:<'${end}' test:false`,
          },
        }),
      },
    );
    const result = z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: z
          .object({
            orders: z.object({
              nodes: z.array(OrderSchema).max(100),
              pageInfo: z.object({
                hasNextPage: z.boolean(),
                endCursor: z.string().max(2048).nullable(),
              }),
            }),
          })
          .optional(),
      })
      .parse(raw);
    if (result.errors?.length || !result.data)
      throw new Error("shopify_graphql_failed");
    rows.push(...result.data.orders.nodes);
    const info = result.data.orders.pageInfo;
    if (!info.hasNextPage) return aggregateOrders(rows, start, end);
    if (
      !info.endCursor ||
      cursors.has(info.endCursor) ||
      !result.data.orders.nodes.length
    )
      throw new Error("shopify_pagination_invalid");
    cursors.add(info.endCursor);
    after = info.endCursor;
  }
  // Never publish a truncated report as a complete total.
  throw new Error("shopify_report_too_large");
}
