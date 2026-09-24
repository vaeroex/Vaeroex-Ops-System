import "server-only";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { SQUARE_OAUTH_SCOPES } from "@/lib/integrations/providers/square/account-connection-oauth";
import policy from "@/lib/integrations/control-plane/square-customer-handoff-policy.json";
import { PUBLIC_SITE_URL } from "@/lib/seo/public-seo";

const SettingsSchema = z.object({
  operatorId: z.string().uuid(), operatorSessionId: z.string().uuid(), workspaceId: z.string().uuid(),
  applicationId: z.string().regex(/^sq0idp-[A-Za-z0-9_-]+$/), approvalExpiresAt: z.string().datetime()
}).strict();
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const denied = () => Response.json({ error: "Square internal pilot is unavailable." }, { status: 404, headers });
async function boundedResult(response: Response) {
  if (!response.ok || !response.body) throw new Error("square_internal_handoff_denied");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8192 || chunks.length >= 64) throw new Error("square_internal_handoff_denied");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function squareInternalPilotConfigured() {
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production" &&
    !!process.env.SQUARE_INTERNAL_PILOT_WORKSPACE;
}
export async function squareInternalPilotAccess() {
  if (!squareInternalPilotConfigured()) return null;
  try {
    const config = SettingsSchema.parse(JSON.parse(process.env.SQUARE_INTERNAL_PILOT_WORKSPACE!));
    if (Date.parse(config.approvalExpiresAt) <= Date.now()) return null;
    const access = await requireWorkspaceAccess();
    const { data, error } = await access.supabase.auth.getClaims();
    if (error || !data || access.user.id !== config.operatorId || data.claims.sub !== access.user.id ||
      data.claims.session_id !== config.operatorSessionId || access.workspaceId !== config.workspaceId ||
      !["owner", "admin", "manager"].includes(access.membership.role)) return null;
    return { access, config };
  } catch { return null; }
}
export async function initiateSquareInternalPilot(request: Request) {
  // This is a dedicated internal route, never the general customer onboarding
  // path. Only the existing authenticated workspace session is forwarded.
  if (!squareInternalPilotConfigured() || request.method !== "POST" ||
    request.headers.get("origin") !== PUBLIC_SITE_URL ||
    request.headers.get("host") !== new URL(PUBLIC_SITE_URL).host || new URL(request.url).origin !== PUBLIC_SITE_URL || new URL(request.url).search ||
    (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return denied();
  const approved = await squareInternalPilotAccess();
  if (!approved) return denied();
  try {
    const { data, error } = await approved.access.supabase.auth.getSession();
    if (error || !data.session || data.session.user.id !== approved.config.operatorId) return denied();
    // getClaims/requireWorkspaceAccess above authorize; getSession supplies
    // only the already-validated token. The isolated service verifies it again.
    const response = await fetch("https://square.vaeroex.com/api/integrations/square/connect", {
      method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000)
    });
    const result = z.object({ authorizationUrl: z.string().max(4096), expiresAt: z.string().datetime() }).strict().parse(await boundedResult(response));
    const url = new URL(result.authorizationUrl);
    const keys = [...url.searchParams.keys()].sort();
    if (url.origin !== "https://connect.squareup.com" || url.pathname !== "/oauth2/authorize" || url.username || url.password || url.hash ||
      keys.join(",") !== "client_id,redirect_uri,scope,session,state" ||
      url.searchParams.get("client_id") !== approved.config.applicationId || url.searchParams.get("session") !== "false" ||
      url.searchParams.get("redirect_uri") !== "https://square.vaeroex.com/api/integrations/square/callback" ||
      url.searchParams.get("scope") !== SQUARE_OAUTH_SCOPES.join(" ") || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "") ||
      Date.parse(result.expiresAt) <= Date.now() || Date.parse(result.expiresAt) > Date.parse(approved.config.approvalExpiresAt)) return denied();
    const escaped = url.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Reuse the existing credential-free, no-referrer handoff script/CSP.
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Square internal pilot</title></head><body><p id="square-handoff" data-target="${escaped}" data-clean-path="/app/settings/integrations/square/internal">Opening Square authorization for the approved internal seller.</p><script>${policy.script}</script></body></html>`, {
      headers: { ...headers, "content-type": "text/html; charset=utf-8", "content-security-policy": policy.csp }
    });
  } catch { return denied(); }
}
