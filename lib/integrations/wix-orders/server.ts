import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const CALLBACK_PATH = "/api/integrations/wix-orders/callback";
const API = "https://www.wixapis.com";
const uuid = z.string().uuid();

export function config() {
  if (process.env.WIX_ORDERS_ENABLED !== "true") throw new Error("wix_disabled");
  const origin = process.env.VERCEL_ENV === "production" ? "https://www.vaeroex.com" :
    z.string().url().parse(process.env.WIX_ORDERS_ORIGIN);
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("wix_origin_invalid");
  const appId = uuid.parse(process.env.WIX_ORDERS_APP_ID);
  const appSecret = z.string().min(16).max(1024).parse(process.env.WIX_ORDERS_APP_SECRET);
  const shareUrlId = uuid.parse(process.env.WIX_ORDERS_SHARE_URL_ID);
  const keyText = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).parse(process.env.WIX_ORDERS_ENCRYPTION_KEY);
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText) throw new Error("wix_key_invalid");
  return { origin: url.origin, appId, appSecret, shareUrlId, key };
}

export function enabled() {
  try { config(); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
  catch { return false; }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("wix_database_unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function assertOrigin(request: Request, callback = false) {
  const expected = config().origin, url = new URL(request.url);
  if (url.origin !== expected || request.headers.get("host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https" ||
      !callback && (request.method !== "POST" || request.headers.get("origin") !== expected || url.search ||
        request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))
    throw new Error("wix_origin_denied");
}

export function requireOwner(access: { membership?: { role?: string } | null; context?: { membership?: { role?: string } | null } }) {
  if ((access.membership ?? access.context?.membership)?.role !== "owner") throw new Error("wix_owner_required");
}

export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function installUrl(state: string) {
  const { origin, appId, shareUrlId } = config();
  const callback = new URL(CALLBACK_PATH, origin);
  callback.searchParams.set("state", state);
  const url = new URL("https://www.wix.com/app-installer");
  url.searchParams.set("appId", appId);
  url.searchParams.set("shareUrlId", shareUrlId);
  url.searchParams.set("postInstallationUrl", callback.toString());
  return url.toString();
}

const signedPayload = z.object({
  instanceId: uuid,
  uid: z.string().min(1),
  siteOwnerId: z.string().min(1),
  signDate: z.union([z.string(), z.number()])
}).passthrough();

export function verifySignedInstance(value: string) {
  if (value.length > 8192) throw new Error("wix_instance_invalid");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("wix_instance_invalid");
  const expected = createHmac("sha256", config().appSecret).update(parts[1]).digest();
  const actual = Buffer.from(parts[0], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("wix_instance_invalid");
  const payload = signedPayload.parse(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  const signedAt = typeof payload.signDate === "number" ? payload.signDate * (payload.signDate < 1e12 ? 1000 : 1) : Date.parse(payload.signDate);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > 20 * 60_000 || payload.uid !== payload.siteOwnerId)
    throw new Error("wix_instance_untrusted");
  return payload.instanceId;
}

export function encryptInstance(workspaceId: string, connectionId: string, instanceId: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config().key, iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  const encrypted = Buffer.concat([cipher.update(uuid.parse(instanceId)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptInstance(workspaceId: string, connectionId: string, ciphertext: string) {
  const bytes = Buffer.from(ciphertext, "base64");
  if (bytes.length < 29) throw new Error("wix_instance_invalid");
  const decipher = createDecipheriv("aes-256-gcm", config().key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return uuid.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}

export async function accessToken(instanceId: string) {
  const { appId, appSecret } = config();
  const response = await fetch(`${API}/oauth2/token`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: appId, client_secret: appSecret, instance_id: instanceId }),
    cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 || response.status === 403 ? "wix_authorization_required" : "wix_provider_unavailable");
  return z.object({ access_token: z.string().min(10).max(8192) }).parse(await response.json()).access_token;
}

const order = z.object({
  id: uuid.optional(), _id: uuid.optional(),
  createdDate: z.string().optional(), _createdDate: z.string().optional(),
  status: z.string().min(1).max(40), paymentStatus: z.string().min(1).max(40),
  currency: z.string().regex(/^[A-Z]{3}$/),
  priceSummary: z.object({ total: z.object({ amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/) }) })
}).passthrough();
const searchResponse = z.object({
  orders: z.array(order).max(100).default([]),
  metadata: z.object({ cursors: z.object({ next: z.string().max(16000).nullish() }).optional(), hasNext: z.boolean().optional() }).optional()
}).passthrough();

export type OrderFact = { order_id: string; created_at: string; total_amount: number; currency_code: string; payment_status: string };

export async function recentOrders(token: string, start: string, end: string): Promise<OrderFact[]> {
  const facts: OrderFact[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 50; page++) {
    const search = cursor ? { cursorPaging: { limit: 100, cursor } } :
      { filter: { _createdDate: { $gte: start, $lt: end }, status: "APPROVED" }, cursorPaging: { limit: 100 } };
    const response = await fetch(`${API}/ecom/v1/orders/search`, { method: "POST", headers: {
      authorization: token, "content-type": "application/json", accept: "application/json"
    }, body: JSON.stringify({ search }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "wix_authorization_required" : "wix_provider_unavailable");
    const body = await response.text();
    if (body.length > 4_000_000) throw new Error("wix_response_too_large");
    const parsed = searchResponse.parse(JSON.parse(body));
    for (const item of parsed.orders) {
      const orderId = item.id ?? item._id, createdAt = item.createdDate ?? item._createdDate;
      if (!orderId || !createdAt || !Number.isFinite(Date.parse(createdAt))) throw new Error("wix_order_invalid");
      if (item.status !== "APPROVED") continue;
      if (createdAt < start || createdAt >= end || seen.has(orderId)) continue;
      seen.add(orderId);
      const total = Number(item.priceSummary.total.amount);
      if (!Number.isFinite(total) || total < 0 || total > 1_000_000_000) throw new Error("wix_amount_invalid");
      facts.push({ order_id: orderId, created_at: createdAt, total_amount: total,
        currency_code: item.currency, payment_status: item.paymentStatus });
    }
    if (facts.length > 5000) throw new Error("wix_too_many_orders");
    const next = parsed.metadata?.cursors?.next ?? undefined;
    if (!next) {
      if (parsed.metadata?.hasNext) throw new Error("wix_pagination_invalid");
      return facts;
    }
    if (next === cursor) throw new Error("wix_pagination_invalid");
    cursor = next;
  }
  throw new Error("wix_too_many_orders");
}
