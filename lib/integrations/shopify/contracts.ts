import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SHOPIFY_SCOPE = "read_orders";
export const SHOPIFY_API_VERSION = "2026-10";
export const SHOPIFY_PATH = "/app/settings/integrations/shopify";
export const ShopSchema = z
  .string()
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);
export const AmountSchema = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
export const TokenSchema = z
  .object({
    accessToken: z.string().min(10).max(4096),
    refreshToken: z.string().min(10).max(4096),
    expiresAt: z.string().datetime(),
    refreshExpiresAt: z.string().datetime(),
  })
  .strict();
export const DaySchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    orders: z.number().int().min(0).max(10000),
    cancelled: z.number().int().min(0).max(10000),
    orderTotal: AmountSchema,
    refunded: AmountSchema,
  })
  .strict();
export const ReportSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    syncedAt: z.string().datetime(),
    days: z.array(DaySchema).max(930),
    orderCount: z.number().int().min(0).max(10000),
  })
  .strict();
export type Report = z.infer<typeof ReportSchema>;
export const ConnectionSchema = z.object({
  workspace_id: z.string().uuid(),
  shop: ShopSchema,
  generation: z.number().int().positive(),
  status: z.enum([
    "pending",
    "exchanging",
    "connected",
    "reauthorization_required",
    "disconnected",
  ]),
  ciphertext: z.string().nullable(),
  report: ReportSchema.nullable(),
  lease_id: z.string().uuid().nullable(),
  credential_version: z.number().int().nonnegative(),
  updated_at: z.string(),
});

export function normalizeShop(input: string) {
  return ShopSchema.parse(input.trim().toLowerCase());
}
export function verifyCallback(
  params: URLSearchParams,
  secret: string,
  now = Date.now(),
) {
  for (const key of params.keys())
    if (params.getAll(key).length !== 1)
      throw new Error("shopify_callback_invalid");
  const hmac = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(params.get("hmac"));
  const timestamp = z
    .string()
    .regex(/^\d{10}$/)
    .parse(params.get("timestamp"));
  if (Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error("shopify_callback_expired");
  const message = [...params]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expected = createHmac("sha256", secret).update(message).digest();
  if (!timingSafeEqual(expected, Buffer.from(hmac, "hex")))
    throw new Error("shopify_signature_invalid");
  return {
    shop: ShopSchema.parse(params.get("shop")),
    state: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .parse(params.get("state")),
    code: z.string().min(1).max(4096).parse(params.get("code")),
  };
}
export function verifyWebhook(
  body: Buffer,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const actual = Buffer.from(signature, "base64");
  return (
    actual.length === 32 &&
    timingSafeEqual(actual, createHmac("sha256", secret).update(body).digest())
  );
}
const MoneySchema = z.object({
  shopMoney: z.object({
    amount: AmountSchema,
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
  }),
});
export const OrderSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/),
  createdAt: z.string().datetime(),
  test: z.boolean(),
  cancelledAt: z.string().datetime().nullable(),
  totalPriceSet: MoneySchema,
  totalRefundedSet: MoneySchema,
});
export function units(value: string) {
  const [whole, fraction = ""] = AmountSchema.parse(value).split(".");
  return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
}
export function decimal(value: bigint) {
  return `${value / BigInt(1000000)}.${(value % BigInt(1000000)).toString().padStart(6, "0")}`;
}
export function aggregateOrders(
  rows: z.infer<typeof OrderSchema>[],
  start: string,
  end: string,
  now = new Date().toISOString(),
): Report {
  const groups = new Map<
    string,
    {
      day: string;
      currency: string;
      orders: number;
      cancelled: number;
      orderTotal: bigint;
      refunded: bigint;
    }
  >();
  const seen = new Set<string>();
  for (const raw of rows) {
    const order = OrderSchema.parse(raw);
    if (seen.has(order.id)) throw new Error("shopify_duplicate_order");
    seen.add(order.id);
    if (order.test) continue;
    if (
      Date.parse(order.createdAt) < Date.parse(start) ||
      Date.parse(order.createdAt) >= Date.parse(end)
    )
      throw new Error("shopify_window_mismatch");
    const day = order.createdAt.slice(0, 10),
      currency = order.totalPriceSet.shopMoney.currencyCode;
    if (currency !== order.totalRefundedSet.shopMoney.currencyCode)
      throw new Error("shopify_currency_mismatch");
    const key = `${day}:${currency}`,
      group = groups.get(key) ?? {
        day,
        currency,
        orders: 0,
        cancelled: 0,
        orderTotal: BigInt(0),
        refunded: BigInt(0),
      };
    group.orders++;
    if (order.cancelledAt) group.cancelled++;
    group.orderTotal += units(order.totalPriceSet.shopMoney.amount);
    group.refunded += units(order.totalRefundedSet.shopMoney.amount);
    groups.set(key, group);
  }
  return ReportSchema.parse({
    start,
    end,
    syncedAt: now,
    orderCount: [...groups.values()].reduce((sum, g) => sum + g.orders, 0),
    days: [...groups.values()]
      .sort((a, b) =>
        `${a.day}${a.currency}`.localeCompare(`${b.day}${b.currency}`),
      )
      .map((g) => ({
        ...g,
        orderTotal: decimal(g.orderTotal),
        refunded: decimal(g.refunded),
      })),
  });
}
