import "server-only";

import { z } from "zod";
import { NextResponse } from "next/server";
import { GOOGLE_SHEETS_SETTINGS_PATH } from "@/lib/integrations/google-sheets/contracts";
import { sheetsAdmin, sheetsConfiguration } from "@/lib/integrations/google-sheets/server";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";

export function sheetsRedirect(kind: "result" | "error", code: string) {
  const url = new URL(GOOGLE_SHEETS_SETTINGS_PATH, sheetsConfiguration().appOrigin);
  url.searchParams.set(kind, code);
  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

/** Same owner and live signed-session boundary as the current Square connector. */
export async function requireSheetsManager(workspaceId?: string, requireSubscription = true) {
  const access = requireSubscription ? await requireWorkspaceAccess(workspaceId) : {
    ...await requireAuth(), ...await getCurrentWorkspace(workspaceId)
  };
  if (access.membership.role !== "owner" || access.membership.status !== "active" ||
      access.membership.user_id !== access.user.id || access.membership.workspace_id !== access.workspaceId) {
    throw new Error("google_sheets_management_denied");
  }
  const claims = await access.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== access.user.id) throw new Error("google_sheets_session_denied");
  const sessionId = z.string().uuid().parse(claims.data.claims.session_id);
  return { ...access, sessionId };
}

export async function sheetsConnection(workspaceId: string, connectionId: string) {
  const id = z.string().uuid().parse(connectionId);
  const { data, error } = await sheetsAdmin().from("google_sheets_connections")
    .select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("google_sheets_connection_unavailable");
  return data;
}

const actionable = new Map([
  ["google_sheets_authorization_required", "reconnect_required"],
  ["google_sheets_revocation_pending", "revocation_pending"],
  ["google_sheets_response_too_large", "report_too_large"],
  ["google_sheets_provider_request_failed", "provider_unavailable"],
  ["google_sheets_headers_unavailable", "headers_unavailable"]
]);
export function sheetsFailure(status = 400, error?: unknown) {
  if (status === 400) {
    try { return sheetsRedirect("error", error instanceof Error ? actionable.get(error.message) ?? "request_failed" : "request_failed"); }
    catch { /* Closed response when unconfigured. */ }
  }
  return NextResponse.json({ ok: false, error: "Google Sheets request could not be completed." }, {
    status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" }
  });
}
