import "server-only";
import { z } from "zod";
import type { Provider } from "./catalog";
import { config, type Credential } from "./security";
import { readJson } from "./transport";
import handoffPolicy from "../control-plane/square-customer-handoff-policy.json";

const oauth = {
  xero: { authorize: "https://login.xero.com/identity/connect/authorize", token: "https://identity.xero.com/connect/token",
    scope: "offline_access accounting.settings.read accounting.invoices.read" },
  harvest: { authorize: "https://id.getharvest.com/oauth2/authorize", token: "https://id.getharvest.com/api/v2/oauth2/token", scope: "" },
  "zoho-inventory": { authorize: "https://accounts.zoho.com/oauth/v2/auth", token: "https://accounts.zoho.com/oauth/v2/token",
    scope: "ZohoInventory.settings.READ,ZohoInventory.items.READ" }
};
function spec(provider: Provider) {
  if (!(provider in oauth)) throw new Error("invalid_provider");
  return oauth[provider as keyof typeof oauth];
}
export function authorizationUrl(provider: Provider, state: string) {
  const cfg = config(provider), settings = spec(provider), url = new URL(settings.authorize);
  url.search = new URLSearchParams({ client_id: cfg.clientId, response_type: "code", redirect_uri: cfg.callback, state }).toString();
  if (settings.scope) url.searchParams.set("scope", settings.scope);
  if (provider === "zoho-inventory") { url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); }
  return url.toString();
}
export function authorizationHandoff(provider: Provider, state: string) {
  // A native form's cross-origin 303 is blocked by the application's form-action
  // policy. Reuse Square's fixed, hash-authorized navigation document instead;
  // no provider origins or arbitrary scripts are added to the global policy.
  const target = authorizationUrl(provider, state);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Connect ${provider}</title></head><body><p id="square-handoff" data-target="${escape(target)}" data-clean-path="/app/integrations/${provider}">Opening provider authorization.</p><noscript>Enable JavaScript, then return to this plug-in to cancel the unfinished connection and try again. Do not share this address.</noscript><script>${handoffPolicy.script}</script></body></html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": handoffPolicy.csp,
      "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"
    }
  });
}
export async function exchange(provider: Provider, grant: { code: string } | { refresh: string }, signal: AbortSignal): Promise<Credential> {
  const cfg = config(provider), settings = spec(provider);
  const body = new URLSearchParams("code" in grant
    ? { grant_type: "authorization_code", code: grant.code, redirect_uri: cfg.callback }
    : { grant_type: "refresh_token", refresh_token: grant.refresh });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "Vaeroex Executive Intelligence (hq@vaeroex.com)" };
  if (provider === "xero") headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  else { body.set("client_id", cfg.clientId); body.set("client_secret", cfg.clientSecret); }
  const token = z.object({ access_token: z.string().min(10).max(8192), refresh_token: z.string().min(10).max(8192).optional(),
    expires_in: z.number().int().min(60).max(60 * 86400), token_type: z.string().optional(),
    api_domain: z.literal("https://www.zohoapis.com").optional(), scope: z.string().optional() }).parse(
    await readJson(new URL(settings.token), { method: "POST", headers, body }, signal));
  if (token.token_type && !/^(bearer)$/i.test(token.token_type)) throw new Error("invalid_token_type");
  if (provider === "xero" && token.scope) {
    const granted = token.scope.split(" ");
    for (const requested of settings.scope.split(" ")) if (!granted.includes(requested)) throw new Error("missing_scope");
    if (granted.some(s => !settings.scope.split(" ").includes(s))) throw new Error("unexpected_scope");
  }
  const refreshToken = token.refresh_token ?? ("refresh" in grant ? grant.refresh : undefined);
  if (!refreshToken) throw new Error("offline_access_required");
  return { accessToken: token.access_token, refreshToken, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() };
}
