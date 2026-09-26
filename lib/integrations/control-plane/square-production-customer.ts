import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { oauthStateHash } from "@/lib/integrations/credentials/oauth-state";
import { createSquareOAuthPolicy, squareAuthorizationUrl } from "@/lib/integrations/providers/square/account-connection-oauth";
import { ProductionSquareCustomerViewSchema } from "@/lib/integrations/control-plane/square-production-customer-view";
import handoffPolicy from "@/lib/integrations/control-plane/square-customer-handoff-policy.json";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const settingsPath = "/app/settings/integrations/square";
const callbackUri = "https://square.vaeroex.com/api/integrations/square/callback";
const uuid = z.string().uuid();
const positive = z.number().int().positive().safe();
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const preparedSchema = z.object({ connectionId: uuid, businessEntityId: uuid,
  generation: positive, rowVersion: positive,
  applicationId: z.string().regex(/^sq0idp-[A-Za-z0-9_-]{1,184}$/),
  configurationFingerprint: fingerprint }).strict();
const createdSchema = z.object({ stateId: uuid, expiresAt: z.string().datetime({ offset: true }),
  workspaceId: uuid, actorId: uuid, sessionId: uuid, businessEntityId: uuid,
  applicationId: z.string().regex(/^sq0idp-[A-Za-z0-9_-]{1,184}$/),
  configurationFingerprint: fingerprint, generation: positive }).strict();
const privateHeaders = { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff" } as const;

/** Explicitly dormant until the separately reviewed Production migration,
 * service image and deployment gates have been qualified. No provider call or
 * credential is available to this workspace-side module.
 */
export function productionSquareCustomerEnabled() {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production" &&
    process.env.SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS === "enabled";
}

function unavailable() { return Response.json({ error: "Square connection unavailable." }, { status: 404, headers: privateHeaders }); }
function denied() { return Response.json({ error: "Square connection request denied." }, { status: 403, headers: privateHeaders }); }
function fingerprintParts(parts: readonly (string | number)[]) {
  const values = parts.map(String);
  if (values.some(value => !/^[\x20-\x7e]*$/.test(value))) throw new Error("square_customer_fingerprint_denied");
  return `sha256:${createHash("sha256").update(values.map(value => `${value.length}:${value}`).join(""), "utf8").digest("hex")}`;
}
function escaped(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function owner() {
  const access = await requireWorkspaceAccess();
  if (access.membership.role !== "owner") throw new Error("square_customer_owner_denied");
  const claims = await access.supabase.auth.getClaims();
  if (claims.error || !claims.data || claims.data.claims.sub !== access.user.id ||
    !uuid.safeParse(claims.data.claims.session_id).success) throw new Error("square_customer_session_denied");
  // This is the user's existing cookie-bound Supabase client. No bearer token
  // is read or sent to the separate Square host. The RPC rechecks the current
  // auth.sessions row, active owner membership, entity and workspace itself.
  return { ...access, sessionId: claims.data.claims.session_id as string };
}

async function rpc(access: Awaited<ReturnType<typeof owner>>, operation: string, command: Record<string, unknown>) {
  const call = access.supabase.rpc.bind(access.supabase) as unknown as
    (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const result = await call("square_production_customer_v1", { p_operation: operation, p_payload: command });
  if (result.error || result.data === null || result.data === undefined) throw new Error("square_customer_rpc_denied");
  return result.data;
}

async function boundedIdentifier(request: Request, name: "businessEntityId" | "connectionId") {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const length = request.headers.get("content-length");
  if (contentType !== "application/x-www-form-urlencoded" ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > 160)) || !request.body)
    throw new Error("square_customer_form_denied");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 160 || chunks.length > 4) throw new Error("square_customer_form_denied");
      chunks.push(Uint8Array.from(next.value));
    }
    const text = new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks));
    const form = new URLSearchParams(text);
    const names = [...form.keys()].sort();
    if (name === "connectionId") {
      if (names.join(",") !== "confirmation,connectionId" || form.getAll("confirmation").length !== 1 ||
        form.get("confirmation") !== "disconnect") throw new Error("square_customer_form_denied");
    } else if (names.join(",") !== "businessEntityId") throw new Error("square_customer_form_denied");
    if (form.getAll(name).length !== 1) throw new Error("square_customer_form_denied");
    return uuid.parse(form.get(name));
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function sameOrigin(request: Request, action: "status" | "connect" | "disconnect") {
  const url = new URL(request.url);
  return url.origin === PUBLIC_SITE_URL && request.headers.get("host") === new URL(PUBLIC_SITE_URL).host &&
    url.pathname === `/api/integrations/square/${action}` && !url.search && !url.hash &&
    (action === "status" || request.headers.get("origin") === PUBLIC_SITE_URL) &&
    (action === "status" || !request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin");
}

export async function productionSquareCustomerView() {
  if (!productionSquareCustomerEnabled()) return null;
  try {
    const access = await owner();
    return ProductionSquareCustomerViewSchema.parse(await rpc(access, "status", { workspaceId: access.workspaceId }));
  } catch { return null; }
}

export async function productionSquareCustomerAction(action: "status" | "connect" | "disconnect", request: Request) {
  if (!productionSquareCustomerEnabled()) return unavailable();
  if (request.method !== (action === "status" ? "GET" : "POST") || !sameOrigin(request, action)) return denied();
  try {
    const access = await owner();
    if (action === "status") {
      if (request.body !== null) return denied();
      const view = ProductionSquareCustomerViewSchema.parse(await rpc(access, "status", { workspaceId: access.workspaceId }));
      return Response.json({ ok: true, view }, { headers: privateHeaders });
    }
    const identifier = await boundedIdentifier(request, action === "connect" ? "businessEntityId" : "connectionId");
    if (action === "disconnect") {
      z.object({ fenced: z.literal(true) }).strict().parse(await rpc(access, "disconnect", {
        workspaceId: access.workspaceId, connectionId: identifier, confirmation: "disconnect"
      }));
      return new Response(null, { status: 303, headers: { ...privateHeaders, location: settingsPath } });
    }
    const connectionId = randomUUID();
    const prepared = preparedSchema.parse(await rpc(access, "prepare", {
      workspaceId: access.workspaceId, businessEntityId: identifier, connectionId
    }));
    if (prepared.connectionId !== connectionId || prepared.businessEntityId !== identifier) return denied();
    const state = randomBytes(32).toString("base64url"), stateId = randomUUID();
    const stateHash = oauthStateHash(state);
    const expiresAt = new Date(Date.now() + 9 * 60_000).toISOString();
    const created = createdSchema.parse(await rpc(access, "create_state", {
      workspaceId: access.workspaceId, connectionId, stateId, stateHash, expiresAt,
      requestFingerprint: fingerprintParts(["square-production-customer-state-v1", connectionId, stateId,
        stateHash, access.user.id, access.sessionId,
        prepared.generation, prepared.rowVersion])
    }));
    if (created.stateId !== stateId || created.workspaceId !== access.workspaceId ||
      created.actorId !== access.user.id || created.sessionId !== access.sessionId ||
      created.businessEntityId !== identifier || Date.parse(created.expiresAt) !== Date.parse(expiresAt) ||
      created.generation !== prepared.generation || created.applicationId !== prepared.applicationId ||
      created.configurationFingerprint !== prepared.configurationFingerprint ||
      Date.parse(created.expiresAt) <= Date.now() || Date.parse(created.expiresAt) > Date.now() + 10 * 60_000) return denied();
    const policy = createSquareOAuthPolicy({ environment: "production", applicationId: created.applicationId,
      redirectUri: callbackUri, returnPath: settingsPath });
    const authorizationUrl = squareAuthorizationUrl({ policy, applicationId: created.applicationId, state });
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Square connection</title></head><body><p id="square-handoff" data-target="${escaped(authorizationUrl)}" data-clean-path="${settingsPath}">Opening Square authorization.</p><script>${handoffPolicy.script}</script></body></html>`, {
      headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8", "content-security-policy": handoffPolicy.csp }
    });
  } catch { return denied(); }
}
