import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { activeToken, admin, assertOrigin, recentSummaries, requireOwner } from "@/lib/integrations/zoho-books/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  let lease: { workspaceId: string; connectionId: string; leaseId: string } | null = null;
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const data = await request.formData();
    const connectionId = z.string().uuid().parse(data.get("connectionId"));
    const db = admin(), now = new Date(), leaseId = randomUUID();
    const { data: connection, error: leaseError } = await db.from("zoho_books_connections")
      .update({ sync_lease_id: leaseId, sync_lease_expires_at: new Date(Date.now() + 65_000).toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "connected")
      .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
      .select("id,organization_id").maybeSingle();
    if (leaseError || !connection?.organization_id) throw new Error("zoho_books_sync_busy");
    lease = { workspaceId: access.workspaceId, connectionId, leaseId };
    const accessToken = await activeToken(access.workspaceId, connectionId);
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const daily = await recentSummaries(accessToken, connection.organization_id, startDate, endDate);
    const { error: applyError } = await db.rpc("apply_zoho_books_summary", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId, p_lease_id: leaseId,
      p_start_date: startDate, p_end_date: endDate, p_daily: daily
    });
    if (applyError) throw new Error("zoho_books_sync_failed");
    lease = null;
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=synced", 303);
  } catch (error) {
    if (lease) {
      const code = error instanceof Error && error.message === "zoho_books_authorization_required"
        ? "authorization_required" : "sync_failed";
      await admin().from("zoho_books_connections").update({
        sync_lease_id: null, sync_lease_expires_at: null, last_error_code: code,
        ...(code === "authorization_required" ? { status: "reauthorization_required" } : {})
      }).eq("workspace_id", lease.workspaceId).eq("id", lease.connectionId).eq("sync_lease_id", lease.leaseId);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=error", 303);
  }
}
