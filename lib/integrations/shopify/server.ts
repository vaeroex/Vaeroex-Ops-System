import "server-only";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import {
  SHOPIFY_PATH,
  SHOPIFY_SCOPE,
  ShopSchema,
  TokenSchema,
} from "./contracts";

export function configuration() {
  const app = new URL(z.string().url().parse(process.env.NEXT_PUBLIC_APP_URL));
  if (
    app.protocol !== "https:" ||
    app.username ||
    app.password ||
    app.pathname !== "/" ||
    app.search ||
    app.hash
  )
    throw new Error("shopify_configuration_required");
  if (process.env.VERCEL_ENV === "production" && app.origin !== PUBLIC_SITE_URL)
    throw new Error("shopify_origin_invalid");
  const clientId = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(process.env.SHOPIFY_CLIENT_ID);
  const clientSecret = z
    .string()
    .min(16)
    .max(512)
    .parse(process.env.SHOPIFY_CLIENT_SECRET);
  const keyText = z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .parse(process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY);
  const key = Buffer.from(keyText, "base64");
  if (key.length !== 32 || key.toString("base64") !== keyText)
    throw new Error("shopify_key_invalid");
  return {
    origin: app.origin,
    clientId,
    clientSecret,
    key,
    redirectUri: new URL("/api/integrations/shopify/callback", app).toString(),
  };
}
export function shopifyEnabled() {
  if (process.env.SHOPIFY_ENABLED !== "true") return false;
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}
export async function manager(subscription = true) {
  const access = subscription
    ? await requireWorkspaceAccess()
    : { ...(await requireAuth()), ...(await getCurrentWorkspace()) };
  if (
    access.membership.role !== "owner" ||
    access.membership.status !== "active" ||
    access.membership.user_id !== access.user.id
  )
    throw new Error("shopify_owner_required");
  const claims = await access.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== access.user.id)
    throw new Error("shopify_session_denied");
  return {
    ...access,
    sessionId: z.string().uuid().parse(claims.data.claims.session_id),
  };
}
export type Access = Awaited<ReturnType<typeof manager>>;
export async function lifecycle(
  operation: string,
  access: Access | null,
  payload: Record<string, unknown> = {},
) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("shopify_database_unavailable");
  const rpc = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await rpc("shopify_lifecycle_v1", {
    p_operation: operation,
    p_workspace_id: access?.workspaceId ?? null,
    p_actor_id: access?.user.id ?? null,
    p_session_id: access?.sessionId ?? null,
    p_payload: payload,
  });
  if (result.error) throw new Error("shopify_database_failed");
  return result.data;
}
export function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}
export function authorizationUrl(shop: string, state: string) {
  const config = configuration(),
    url = new URL(`https://${ShopSchema.parse(shop)}/admin/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    scope: SHOPIFY_SCOPE,
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  return url.toString();
}
export function tokenCipher(
  workspace: string,
  shop: string,
  generation: number,
  version: number,
  value: unknown,
  decrypt = false,
) {
  const config = configuration(),
    aad = Buffer.from(
      JSON.stringify({
        provider: "shopify",
        workspace,
        shop,
        generation,
        version,
        origin: config.origin,
      }),
    );
  try {
    if (decrypt) {
      const encoded = z
          .string()
          .regex(/^sh1\.[A-Za-z0-9_-]+$/)
          .max(20000)
          .parse(value)
          .slice(4),
        data = Buffer.from(encoded, "base64url");
      if (data.length < 29 || data.toString("base64url") !== encoded)
        throw new Error("shopify_cipher_invalid");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        config.key,
        data.subarray(0, 12),
      );
      cipher.setAAD(aad);
      cipher.setAuthTag(data.subarray(12, 28));
      return TokenSchema.parse(
        JSON.parse(
          Buffer.concat([
            cipher.update(data.subarray(28)),
            cipher.final(),
          ]).toString("utf8"),
        ),
      );
    }
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", config.key, iv);
    cipher.setAAD(aad);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(TokenSchema.parse(value))),
      cipher.final(),
    ]);
    return `sh1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
  } finally {
    config.key.fill(0);
  }
}
export function assertOrigin(request: Request, callback = false) {
  const origin = configuration().origin,
    url = new URL(request.url);
  if (
    url.origin !== origin ||
    request.headers.get("host") !== new URL(origin).host ||
    (request.headers.has("x-forwarded-host") &&
      request.headers.get("x-forwarded-host") !== new URL(origin).host) ||
    (request.headers.has("x-forwarded-proto") &&
      request.headers.get("x-forwarded-proto") !== "https") ||
    (!callback &&
      (request.method !== "POST" ||
        request.headers.get("origin") !== origin ||
        url.search ||
        (request.headers.has("sec-fetch-site") &&
          request.headers.get("sec-fetch-site") !== "same-origin")))
  )
    throw new Error("shopify_origin_denied");
}
export async function form(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    throw new Error("shopify_form_invalid");
  const text = await readBody(request, 4096),
    params = new URLSearchParams(text.toString("utf8"));
  for (const key of params.keys())
    if (params.getAll(key).length !== 1)
      throw new Error("shopify_form_invalid");
  return Object.fromEntries(params);
}
export async function readBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("shopify_body_missing");
  let size = 0,
    expired = false;
  const chunks: Uint8Array[] = [];
  const timeout = setTimeout(() => {
    expired = true;
    void reader.cancel();
  }, 5000);
  try {
    for (;;) {
      const next = await reader.read();
      if (expired) throw new Error("shopify_body_timeout");
      if (next.done) break;
      size += next.value.length;
      if (size > max || chunks.length > 4096)
        throw new Error("shopify_body_large");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function redirectResult(result: string) {
  const url = new URL(SHOPIFY_PATH, configuration().origin);
  url.searchParams.set("result", result);
  return NextResponse.redirect(url, {
    status: 303,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
export function failure(error: unknown) {
  const codes: Record<string, string> = {
    shopify_privacy_window_pending: "privacy_window",
    shopify_report_too_large: "report_too_large",
    shopify_rate_limited: "rate_limited",
    shopify_reauthorize: "reconnect",
  };
  try {
    return redirectResult(
      error instanceof Error ? (codes[error.message] ?? "failed") : "failed",
    );
  } catch {
    return NextResponse.json(
      { error: "Shopify setup is not ready." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
