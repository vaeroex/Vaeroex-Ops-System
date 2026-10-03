import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertQboCustomerRequestOrigin, qboCustomerApplicationOrigin } from "@/lib/integrations/control-plane/qbo-customer-oauth";
import { qboCustomerConnectionsUnavailableResponse, qboProductionCustomerConnectionsEnabled } from "@/lib/integrations/control-plane/qbo-customer-availability";
import { cancelQboCustomerPendingConnection } from "@/lib/integrations/persistence/qbo-pending-connection-repository";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

const CancelSchema = z.object({ connectionId: z.string().uuid(), confirmation: z.literal("cancel") }).strict();

function managementRedirect(kind: "result" | "error", code: "cancelled" | "cancel_failed") {
  const target = new URL("/app/settings/integrations/quickbooks", qboCustomerApplicationOrigin());
  target.searchParams.set(kind, code);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!qboProductionCustomerConnectionsEnabled()) return qboCustomerConnectionsUnavailableResponse();
  const json = request.headers.get("accept")?.includes("application/json");
  try {
    assertQboCustomerRequestOrigin(request);
    const body = await request.arrayBuffer();
    if (body.byteLength > 1_024) throw new Error("qbo_cancel_request_invalid");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0];
    const input = CancelSchema.parse(contentType === "application/json" ? JSON.parse(text) :
      contentType === "application/x-www-form-urlencoded" ? Object.fromEntries(new URLSearchParams(text)) : null);
    const access = await requireWorkspaceAccess();
    if (access.membership.role !== "owner") throw new Error("qbo_cancel_denied");
    const { data: connection, error } = await access.supabase.from("integration_connection_summaries")
      .select("id,row_version").eq("workspace_id", access.workspaceId).eq("id", input.connectionId)
      .eq("provider_key", "quickbooks_online").eq("provider_environment", "production").maybeSingle();
    if (error || !connection) throw new Error("qbo_cancel_denied");
    await cancelQboCustomerPendingConnection({ workspaceId: access.workspaceId, connectionId: connection.id,
      expectedRowVersion: connection.row_version, requestId: `qbo_pending_cancel_${randomUUID().replaceAll("-", "")}` },
    access.supabase as unknown as ExternalIntegrationsRpcClient);
    if (json) return NextResponse.json({ ok: true, result: "cancelled" }, { headers: { "cache-control": "no-store" } });
    return managementRedirect("result", "cancelled");
  } catch {
    if (!json) return managementRedirect("error", "cancel_failed");
    return NextResponse.json({ ok: false, error: "This QuickBooks attempt could not be cancelled. Refresh and try again." },
      { status: 400, headers: { "cache-control": "no-store" } });
  }
}
