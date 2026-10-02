// Keep browser navigation separate from a form redirect: form-action deliberately
// does not grant a cross-origin form submission to the OAuth provider.
export function qboAuthorizationNavigationTarget(value: unknown): string {
  if (typeof value !== "string") throw new Error("qbo_authorization_target_invalid");
  const target = new URL(value);
  const keys = [...target.searchParams.keys()].sort();
  if (
    target.origin !== "https://appcenter.intuit.com" ||
    target.pathname !== "/connect/oauth2" || target.username || target.password || target.hash ||
    JSON.stringify(keys) !== JSON.stringify(["client_id", "redirect_uri", "response_type", "scope", "state"]) ||
    !target.searchParams.get("client_id") ||
    target.searchParams.get("response_type") !== "code" ||
    target.searchParams.get("scope") !== "com.intuit.quickbooks.accounting" ||
    target.searchParams.get("redirect_uri") !== "https://integrations.vaeroex.com/oauth/callback" ||
    !/^[ir]1_[A-Za-z0-9_-]{43}$/.test(target.searchParams.get("state") ?? "")
  ) throw new Error("qbo_authorization_target_invalid");
  return target.toString();
}
