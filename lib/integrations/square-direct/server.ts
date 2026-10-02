import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";
import handoff from "@/lib/integrations/control-plane/square-customer-handoff-policy.json";
import { DirectActorSchema, DirectHistoricalWindowSchema } from "./contracts";
import { createDirectSquareService } from "./service";
import { createDirectSquareProvider } from "./provider";
import { DirectPaymentBrowserSchema, parseDirectPaymentBrowseQuery } from "./payment-browse";

export const squareSettingsPath = "/app/settings/integrations/square";
const headers = { "cache-control": "no-store, max-age=0", "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff", vary: "Cookie" } as const;
const uuid = z.string().uuid();

/** A new, separately approved server deployment flag. The old native-role
 * activation flags are neither modified nor treated as permission here. */
export function squareDirectEnabled() {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production" &&
    process.env.SQUARE_CUSTOMER_BACKEND_ENABLED === "true";
}
export function directEncryptionKeyValid(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  try { return bytes.length === 32 && bytes.toString("base64") === value; }
  finally { bytes.fill(0); }
}
function config() {
  const applicationId = z.string().regex(/^sq0idp-[A-Za-z0-9_-]{1,184}$/).parse(process.env.SQUARE_CUSTOMER_APPLICATION_ID);
  const applicationSecret = z.string().min(16).max(16384).parse(process.env.SQUARE_CUSTOMER_APPLICATION_SECRET);
  const encryptionKey = process.env.SQUARE_CUSTOMER_ENCRYPTION_KEY;
  if (!directEncryptionKeyValid(encryptionKey)) throw new Error("square_customer_configuration_unavailable");
  return { applicationId, applicationSecret, encryptionKey };
}
async function ownerDatabase() {
  const { supabase, user } = await requireAuth(); // getUser validates the signed session with Supabase.
  const access = await getCurrentWorkspace();
  if (access.membership.role !== "owner" || access.membership.user_id !== user.id) throw new Error("square_customer_denied");
  const claims = await supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== user.id) throw new Error("square_customer_denied");
  const actor = DirectActorSchema.parse({ workspaceId: access.workspaceId, actorId: user.id, sessionId: claims.data.claims.session_id });
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("square_customer_configuration_unavailable");
  const call = admin.rpc.bind(admin) as unknown as (name: string, payload: Record<string, unknown>) =>
    Promise<{ data: unknown; error: unknown }>;
  return { actor, call };
}
async function service() {
  const settings = config();
  const { actor, call } = await ownerDatabase();
  return createDirectSquareService({ actor, encryptionKey: settings.encryptionKey,
    provider: authorize => createDirectSquareProvider({ ...settings, authorize }),
    rpc: async (operation, payload) => {
      // Identity is never accepted from a request body. SQL revalidates the
      // exact owner/session and paid-workspace eligibility on each dispatch.
      const result = await call("square_customer_backend_v1", { p_operation: operation,
        p_actor_id: actor.actorId, p_session_id: actor.sessionId, p_workspace_id: actor.workspaceId,
        p_application_id: settings.applicationId, p_payload: payload });
      if (result.error || result.data == null) throw new Error("square_customer_persistence_failed");
      return result.data;
    }
  });
}
export async function squareDirectView() {
  if (!squareDirectEnabled()) return null;
  try { return await (await service()).view(); } catch { return null; }
}
/** Saved-data browsing is read-only. It does not decrypt a seller credential,
 * contact Square, claim an import lease, or advance an ongoing checkpoint. */
export async function squareDirectPayments(searchParams: Record<string, string | string[] | undefined>, expectedWorkspaceId?: string) {
  if (!squareDirectEnabled()) return null;
  const query = parseDirectPaymentBrowseQuery(searchParams);
  const { actor, call } = await ownerDatabase();
  if (expectedWorkspaceId !== undefined && actor.workspaceId !== expectedWorkspaceId)
    throw new Error("square_customer_denied");
  const result = await call("square_customer_payments_v1", {
    p_actor_id: actor.actorId, p_session_id: actor.sessionId, p_workspace_id: actor.workspaceId,
    p_connection_id: query.connectionId, p_page: query.page,
    p_start_date: query.startDate, p_end_date: query.endDate, p_status: query.status
  });
  if (result.error || result.data == null) throw new Error("square_customer_payment_browse_unavailable");
  return DirectPaymentBrowserSchema.parse(result.data);
}
function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function navigate(target: string) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Square connection</title></head><body><p id="square-handoff" data-target="${escape(target)}" data-clean-path="${squareSettingsPath}">Returning to your Square connection.</p><noscript>Return to Square settings. Do not share this address.</noscript><script>${handoff.script}</script></body></html>`, {
    headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": handoff.csp }
  });
}

export function directRequestAllowed(action: string, request: Request) {
  const url = new URL(request.url), expected = new URL(PUBLIC_SITE_URL);
  return url.origin === PUBLIC_SITE_URL && request.headers.get("host") === expected.host &&
    (!request.headers.has("x-forwarded-host") || request.headers.get("x-forwarded-host") === expected.host) &&
    (!request.headers.has("x-forwarded-proto") || request.headers.get("x-forwarded-proto") === "https") &&
    !url.hash && url.pathname === `/api/integrations/square/${action}` &&
    (action === "callback" || !url.search) && request.method === (action === "status" || action === "callback" ? "GET" : "POST") &&
    (action === "status" || action === "callback" || request.headers.get("origin") === PUBLIC_SITE_URL &&
      (!request.headers.has("sec-fetch-site") || request.headers.get("sec-fetch-site") === "same-origin"));
}
export async function directForm(action: string, request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded" || !request.body)
    throw new Error("square_customer_form_denied");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) throw new Error("square_customer_form_denied");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, interrupted = false;
  const cancel = () => { interrupted = true; void reader.cancel().catch(() => undefined); };
  const timer = setTimeout(cancel, 5000);
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) cancel();
    for (;;) {
      const next = await reader.read();
      if (interrupted) throw new Error("square_customer_form_denied");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024 || chunks.length >= 32) throw new Error("square_customer_form_denied");
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    let text: string;
    try { text = new TextDecoder("utf8", { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
    for (const part of text.split("&")) for (const field of part.split("=")) decodeURIComponent(field.replace(/\+/g, " "));
    const form = new URLSearchParams(text), keys = [...form.keys()].sort().join(",");
    if (action === "connect" && keys === "businessEntityId") return { businessEntityId: uuid.parse(form.get("businessEntityId")) };
    if (action === "mapping" && keys === "connectionId,locationId") return { connectionId: uuid.parse(form.get("connectionId")),
      locationId: z.string().regex(/^[A-Za-z0-9._:-]{1,50}$/).parse(form.get("locationId")) };
    if (action === "read" && keys === "connectionId") return { connectionId: uuid.parse(form.get("connectionId")) };
    if (action === "read" && keys === "connectionId,endDate,startDate") {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const startDate = date.parse(form.get("startDate")), endDate = date.parse(form.get("endDate"));
      const start = new Date(`${startDate}T00:00:00.000Z`), end = new Date(`${endDate}T00:00:00.000Z`);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
          start.toISOString().slice(0, 10) !== startDate || end.toISOString().slice(0, 10) !== endDate) throw new Error("square_customer_form_denied");
      const historical = DirectHistoricalWindowSchema.parse({ windowStart: start.toISOString(),
        windowEnd: new Date(end.getTime() + 86_400_000).toISOString() });
      if (Date.parse(historical.windowEnd) > Date.now()) throw new Error("square_customer_form_denied");
      return { connectionId: uuid.parse(form.get("connectionId")), historical };
    }
    if (action === "disconnect" && keys === "confirmation,connectionId" && form.get("confirmation") === "disconnect")
      return { connectionId: uuid.parse(form.get("connectionId")) };
    throw new Error("square_customer_form_denied");
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel);
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}
export async function squareDirectRoute(action: string, request: Request) {
  if (!squareDirectEnabled()) return Response.json({ error: "Square is unavailable." }, { status: 404, headers });
  if (!["connect", "callback", "status", "mapping", "read", "disconnect"].includes(action) || !directRequestAllowed(action, request))
    return Response.json({ error: "Square request denied." }, { status: 403, headers });
  try {
    if ((action === "status" || action === "callback") && request.body !== null) throw new Error("body");
    const backend = await service();
    if (action === "status") return Response.json({ view: await backend.view() }, { headers });
    if (action === "callback") { await backend.callback(request.url); return navigate(squareSettingsPath); }
    const form = await directForm(action, request);
    if (action === "connect" && "businessEntityId" in form) return navigate(await backend.connect(form.businessEntityId!));
    if (!("connectionId" in form)) throw new Error("form");
    if (action === "mapping" && "locationId" in form) await backend.map(form.connectionId!, form.locationId!);
    else if (action === "read") await backend.read(form.connectionId!, "historical" in form ? form.historical : undefined);
    else if (action === "disconnect") await backend.disconnect(form.connectionId!);
    else throw new Error("form");
    return new Response(null, { status: 303, headers: { ...headers, location: squareSettingsPath } });
  } catch {
    if (action === "callback") return navigate(squareSettingsPath);
    return Response.json({ error: "Square request could not complete. Check connection status before trying again." }, { status: 409, headers });
  }
}
