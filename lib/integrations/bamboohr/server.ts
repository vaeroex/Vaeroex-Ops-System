import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { collectStaffingSnapshot } from "./snapshot";

const CALLBACK_PATH = "/api/integrations/bamboohr/callback";
const SCOPES = ["employee", "employee:job", "time_off", "offline_access"] as const;
const companyDomainSchema = z.string().min(1).max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

const tokenResponse = z.object({
  access_token: z.string().min(10).max(8192),
  refresh_token: z.string().min(10).max(8192),
  expires_in: z.number().int().min(60).max(86400),
  scope: z.string().min(1),
  companyDomain: z.string().optional()
}).passthrough();
const savedToken = z.object({
  accessToken: z.string().min(10), refreshToken: z.string().min(10), expiresAt: z.string().datetime()
}).strict();

export function companyDomain(value: unknown) {
  return companyDomainSchema.parse(value);
}

export function config() {
  if (process.env.BAMBOOHR_ENABLED !== "true") throw new Error("bamboohr_disabled");
  const redirect = new URL(process.env.BAMBOOHR_REDIRECT_URI ?? "");
  if (redirect.protocol !== "https:" || redirect.pathname !== CALLBACK_PATH || redirect.search || redirect.hash ||
      redirect.username || redirect.password) throw new Error("bamboohr_redirect_invalid");
  const clientId = z.string().min(3).max(512).parse(process.env.BAMBOOHR_CLIENT_ID);
  const clientSecret = z.string().min(10).max(512).parse(process.env.BAMBOOHR_CLIENT_SECRET);
  const keyText = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).parse(process.env.BAMBOOHR_TOKEN_ENCRYPTION_KEY);
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText) throw new Error("bamboohr_key_invalid");
  if (process.env.VERCEL_ENV === "production" && redirect.origin !== "https://www.vaeroex.com")
    throw new Error("bamboohr_origin_invalid");
  return { redirectUri: redirect.toString(), origin: redirect.origin, clientId, clientSecret, key };
}

export function enabled() {
  try { config(); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); }
  catch { return false; }
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("bamboohr_database_unavailable");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function assertOrigin(request: Request, callback = false) {
  const expected = config().origin, url = new URL(request.url);
  if (url.origin !== expected || request.headers.get("host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-host") && request.headers.get("x-forwarded-host") !== new URL(expected).host ||
      request.headers.get("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https" ||
      !callback && (request.method !== "POST" || request.headers.get("origin") !== expected || url.search ||
        request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))
    throw new Error("bamboohr_origin_denied");
}

export function requireOwner(access: { membership?: { role?: string } | null; context?: { membership?: { role?: string } | null } }) {
  if ((access.membership ?? access.context?.membership)?.role !== "owner") throw new Error("bamboohr_owner_required");
}

export function stateHash(state: string) { return createHash("sha256").update(state).digest("hex"); }

export function authorizationUrl(domain: string, state: string) {
  const { clientId, redirectUri } = config();
  const url = new URL(`https://${companyDomain(domain)}.bamboohr.com/authorize.php`);
  url.search = new URLSearchParams({ request: "authorize", response_type: "code", state,
    client_id: clientId, redirect_uri: redirectUri, scope: SCOPES.join(" ") }).toString();
  return url.toString();
}

function verifyScope(scope: string) {
  const received = new Set(scope.split(/\s+/).filter(Boolean));
  if (SCOPES.some((required) => !received.has(required)) ||
      [...received].some((value) => value.endsWith(".write") || value.endsWith(":write")))
    throw new Error("bamboohr_scope_mismatch");
}

async function tokenRequest(domain: string, input: URLSearchParams) {
  const response = await fetch(`https://${companyDomain(domain)}.bamboohr.com/token.php?request=token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: input, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401
    ? "bamboohr_authorization_required" : "bamboohr_provider_unavailable");
  const payload = tokenResponse.parse(await response.json());
  verifyScope(payload.scope);
  if (payload.companyDomain && payload.companyDomain.toLowerCase() !== domain)
    throw new Error("bamboohr_domain_mismatch");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString() };
}

export async function exchangeCode(domain: string, code: string) {
  const c = config();
  return tokenRequest(domain, new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, code, grant_type: "authorization_code" }));
}

export async function refreshToken(domain: string, refreshTokenValue: string) {
  const c = config();
  return tokenRequest(domain, new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, refresh_token: refreshTokenValue, grant_type: "refresh_token" }));
}

export function encryptToken(workspaceId: string, connectionId: string, value: z.infer<typeof savedToken>) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config().key, iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(savedToken.parse(value))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptToken(workspaceId: string, connectionId: string, ciphertext: string) {
  const bytes = Buffer.from(ciphertext, "base64");
  if (bytes.length < 29) throw new Error("bamboohr_token_invalid");
  const decipher = createDecipheriv("aes-256-gcm", config().key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${workspaceId}:${connectionId}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return savedToken.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")));
}

async function apiGet(domain: string, path: string, accessToken: string) {
  const response = await fetch(`https://${companyDomain(domain)}.bamboohr.com/api/v1/${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "bamboohr_authorization_required" : "bamboohr_provider_unavailable");
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error("bamboohr_response_too_large");
  return JSON.parse(text) as unknown;
}

export async function staffingSnapshot(domain: string, accessToken: string) {
  return collectStaffingSnapshot((path) => apiGet(domain, path, accessToken), new Date());
}

export function redirect(status: "connected" | "disconnected" | "error" | "synced") {
  const url = new URL("/app/integrations/bamboohr", config().origin);
  url.searchParams.set("result", status);
  return Response.redirect(url, 303);
}
