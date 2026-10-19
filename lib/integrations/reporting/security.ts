import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { catalog, type Provider } from "./catalog";

export const origin = "https://www.vaeroex.com";
export const accountSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), name: z.string().min(1).max(200),
  parent: z.string().regex(/^\d{1,20}$/).optional(), user: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional() }).strict();
export const credentialSchema = z.object({ accessToken: z.string().min(10).max(8192), refreshToken: z.string().min(10).max(8192).optional(),
  expiresAt: z.string().datetime().optional(), accounts: z.array(accountSchema).max(100).optional() }).strict();
export type Credential = z.infer<typeof credentialSchema>;
export function prefix(provider: Provider) { return provider.replaceAll("-", "_").toUpperCase(); }
function key() {
  const raw = process.env.REPORTING_CONNECTOR_TOKEN_KEY ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) throw new Error("configuration_required");
  return key;
}
export function config(provider: Provider) {
  const name = prefix(provider);
  if (process.env[`${name}_REPORTING_ENABLED`] !== "true") throw new Error("configuration_required");
  key();
  const oauth = catalog[provider].auth === "oauth";
  const clientId = oauth ? z.string().min(8).max(512).parse(process.env[`${name}_CLIENT_ID`]) : "";
  const clientSecret = oauth ? z.string().min(8).max(512).parse(process.env[`${name}_CLIENT_SECRET`]) : "";
  return { clientId, clientSecret, callback: `${origin}/api/integrations/${provider}/callback` };
}
export function available(provider: Provider) {
  try { config(provider); return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY); } catch { return false; }
}
export function admin() {
  return createClient(z.string().url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL),
    z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY), { auth: { persistSession: false, autoRefreshToken: false } });
}
export function requireOwner(access: { membership?: { role?: string } | null }) {
  if (access.membership?.role !== "owner") throw new Error("owner_required");
}
export function assertRequest(request: Request, callback = false) {
  const url = new URL(request.url);
  if (url.origin !== origin || request.headers.get("host") !== "www.vaeroex.com" ||
    (request.headers.has("x-forwarded-host") && request.headers.get("x-forwarded-host") !== "www.vaeroex.com") ||
    (request.headers.has("x-forwarded-proto") && request.headers.get("x-forwarded-proto") !== "https")) throw new Error("invalid_origin");
  if (!callback && (request.method !== "POST" || url.search || request.headers.get("origin") !== origin ||
    (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))) throw new Error("invalid_origin");
}
export async function formData(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("invalid_form");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_form");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > 12000) throw new Error("invalid_form"); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new Error("invalid_form");
  return form;
}
export function hashState(state: string) { return createHash("sha256").update(state).digest("hex"); }
export function seal(provider: Provider, workspace: string, connection: string, credential: Credential) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${provider}:${workspace}:${connection}:v1`));
  const data = Buffer.concat([cipher.update(JSON.stringify(credentialSchema.parse(credential)), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function unseal(provider: Provider, workspace: string, connection: string, ciphertext: string): Credential {
  const bytes = Buffer.from(ciphertext, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(`${provider}:${workspace}:${connection}:v1`)); cipher.setAuthTag(bytes.subarray(12, 28));
  return credentialSchema.parse(JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8")));
}
export function redirect(provider: Provider, result: string) {
  return new Response(null, { status: 303, headers: { Location: `${origin}/app/integrations/${provider}?result=${encodeURIComponent(result)}`,
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
