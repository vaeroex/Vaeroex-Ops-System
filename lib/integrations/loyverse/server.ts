import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const CALLBACK_PATH = "/api/integrations/loyverse/callback";
const SCOPE = "MERCHANT_READ RECEIPTS_READ";
const TOKEN_URL = "https://api.loyverse.com/oauth/token";
const API_URL = "https://api.loyverse.com/v1.0";

const tokenResponse = z.object({
  access_token: z.string().min(10).max(8192),
  refresh_token: z.string().min(10).max(8192),
  expires_in: z.number().int().min(60).max(86400),
  scope: z.string()
}).passthrough();
const savedToken = z.object({
  accessToken: z.string().min(10), refreshToken: z.string().min(10), expiresAt: z.string().datetime()
}).strict();
const merchantResponse = z.object({
  id: z.string().uuid(), business_name: z.string().min(1).max(200),
  country: z.literal("US"),
  currency: z.object({ code: z.string().regex(/^[A-Z]{3}$/) })
}).passthrough();
const receiptResponse = z.object({
  receipts: z.array(z.object({
    receipt_number: z.string().min(1).max(120),
    store_id: z.string().min(1).max(120),
    receipt_date: z.string().datetime({ offset: true }),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    receipt_type: z.enum(["SALE", "REFUND"]),
    total_money: z.number().finite(),
    total_tax: z.number().finite().nullish(),
    total_discount: z.number().finite().nullish(),
    cancelled_at: z.string().datetime({ offset: true }).nullish()
  }).passthrough()).max(250), cursor: z.string().nullish()
}).passthrough();

export type ReceiptFact = {
  receipt_number: string; store_id: string; receipt_date: string; created_at: string; updated_at: string;
  receipt_type: "SALE" | "REFUND"; total_money: number; total_tax: number;
  total_discount: number; cancelled: boolean;
};

export function config() {
  if (process.env.LOYVERSE_ENABLED !== "true") throw new Error("loyverse_disabled");
  const redirect = new URL(process.env.LOYVERSE_REDIRECT_URI ?? "");
  if (redirect.protocol !== "https:" || redirect.pathname !== CALLBACK_PATH || redirect.search || redirect.hash ||
      redirect.username || redirect.password) throw new Error("loyverse_redirect_invalid");
  const clientId = z.string().min(10).max(512).parse(process.env.LOYVERSE_CLIENT_ID);
  const clientSecret = z.string().min(10).max(512).parse(process.env.LOYVERSE_CLIENT_SECRET);
  const keyText = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).parse(process.env.LOYVERSE_TOKEN_ENCRYPTION_KEY);
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText) throw new Error("loyverse_key_invalid");
  if (process.env.VERCEL_ENV === "production" && redirect.origin !== "https://www.vaeroex.com")
    throw new Error("loyverse_origin_invalid");
  return { redirectUri: redirect.toString(), origin: redirect.origin, clientId, clientSecret, key };
}

export function enabled() {
  try { config(); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
  catch { return false; }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("loyverse_database_unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function assertOrigin(request: Request, callback = false) {
  const expected = config().origin, url = new URL(request.url);
  if (url.origin !== expected || request.headers.get("host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https" ||
      !callback && (request.method !== "POST" || request.headers.get("origin") !== expected || url.search ||
        request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))
    throw new Error("loyverse_origin_denied");
}

export function requireOwner(access: { membership?: { role?: string } | null; context?: { membership?: { role?: string } | null } }) {
  if ((access.membership ?? access.context?.membership)?.role !== "owner") throw new Error("loyverse_owner_required");
}

export function stateHash(state: string) { return createHash("sha256").update(state).digest("hex"); }

export function authorizationUrl(state: string) {
  const { clientId, redirectUri } = config();
  const url = new URL("https://api.loyverse.com/oauth/authorize");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", scope: SCOPE, state }).toString();
  return url.toString();
}

function verifyScope(scope: string) {
  if (scope.split(/\s+/).filter(Boolean).sort().join(" ") !== SCOPE.split(" ").sort().join(" "))
    throw new Error("loyverse_scope_mismatch");
}

async function tokenRequest(input: URLSearchParams) {
  const response = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: input, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "loyverse_authorization_required" : "loyverse_provider_unavailable");
  const payload = tokenResponse.parse(await response.json());
  verifyScope(payload.scope);
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString() };
}

export async function exchangeCode(code: string) {
  const c = config();
  return tokenRequest(new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, code, grant_type: "authorization_code" }));
}

export async function refreshToken(refreshToken: string) {
  const c = config();
  return tokenRequest(new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token" }));
}

export function encryptToken(workspaceId: string, connectionId: string, value: z.infer<typeof savedToken>) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config().key, iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(savedToken.parse(value))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptToken(workspaceId: string, connectionId: string, ciphertext: string) {
  const bytes = Buffer.from(ciphertext, "base64");
  if (bytes.length < 29) throw new Error("loyverse_token_invalid");
  const decipher = createDecipheriv("aes-256-gcm", config().key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return savedToken.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
}

async function apiGet(path: string, accessToken: string, signal?: AbortSignal) {
  const response = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "loyverse_authorization_required" : response.status === 429 ? "loyverse_quota_exceeded" : "loyverse_provider_unavailable");
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("loyverse_response_too_large");
  return JSON.parse(text) as unknown;
}

export async function merchant(accessToken: string) {
  return merchantResponse.parse(await apiGet("/merchant/", accessToken));
}

export async function recentReceipts(accessToken: string, windowStart: string, windowEnd: string, signal = AbortSignal.timeout(45_000)): Promise<ReceiptFact[]> {
  const facts: ReceiptFact[] = [], seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    // The API documents "after" for the lower boundary. Include midnight even
    // if that boundary is exclusive, then enforce our half-open interval below.
    const search = new URLSearchParams({ created_at_min: new Date(Date.parse(windowStart) - 1).toISOString(), created_at_max: windowEnd, limit: "250" });
    if (cursor) search.set("cursor", cursor);
    const result = receiptResponse.parse(await apiGet(`/receipts?${search.toString()}`, accessToken, signal));
    for (const item of result.receipts) {
      if (seen.has(item.receipt_number)) throw new Error("loyverse_duplicate_receipt");
      seen.add(item.receipt_number);
      const date = new Date(item.receipt_date).toISOString();
      const created = new Date(item.created_at).toISOString();
      // Loyverse filters server creation time, not the backdated receipt date.
      if (Date.parse(created) < Date.parse(windowStart) - 1 || created > windowEnd)
        throw new Error("loyverse_invalid_window");
      if (created < windowStart || created >= windowEnd) continue;
      facts.push({ receipt_number: item.receipt_number, store_id: item.store_id,
        receipt_date: date, created_at: created, updated_at: new Date(item.updated_at).toISOString(),
        receipt_type: item.receipt_type, total_money: item.total_money,
        total_tax: item.total_tax ?? 0, total_discount: item.total_discount ?? 0,
        cancelled: Boolean(item.cancelled_at) });
    }
    if (!result.cursor) return facts;
    if (cursors.has(result.cursor)) throw new Error("loyverse_pagination_invalid");
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  throw new Error("loyverse_receipt_limit_exceeded");
}

export function redirect(status: "connected" | "disconnected" | "error", error?: string) {
  const url = new URL("/app/integrations/loyverse", config().origin);
  url.searchParams.set("result", status);
  if (error) url.searchParams.set("error", error);
  return Response.redirect(url, 303);
}
