import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { activeToken, admin, assertOrigin, accountingFacts, requireOwner } from "@/lib/integrations/zoho-books/server";
import { resolveImportRange } from "@/lib/integrations/date-range";

export const maxDuration = 60;

export async function POST(request: Request) {
  let lease: { workspaceId: string; connectionId: string; leaseId: string } | null = null;
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const data = await request.formData();
    const connectionId = z.string().uuid().parse(data.get("connectionId"));
    const range = resolveImportRange(data.get("startDate"), data.get("endDate"));
    const db = admin(), now = new Date(), leaseId = randomUUID();
    const { data: connection, error: leaseError } = await db.from("zoho_books_connections")
      .update({ sync_lease_id: leaseId, sync_lease_expires_at: new Date(Date.now() + 65_000).toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "connected")
      .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
      .select("id,organization_id").maybeSingle();
    if (leaseError || !connection?.organization_id) throw new Error("zoho_books_sync_busy");
    lease = { workspaceId: access.workspaceId, connectionId, leaseId };
    const accessToken = await activeToken(access.workspaceId, connectionId);
    const facts = await accountingFacts(accessToken, connection.organization_id, range.startDate, range.endDate);
    const { error: applyError } = await db.rpc("apply_zoho_books_history", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId, p_lease_id: leaseId,
      p_start_date: range.startDate, p_end_date: range.endDate, p_observed_through: range.endAt, p_facts: facts
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
    const result = error instanceof Error && error.message === "invalid_date_range" ? "invalid_range" : "error";
    return Response.redirect(`https://www.vaeroex.com/app/integrations/zoho-books?result=${result}`, 303);
  }
}
