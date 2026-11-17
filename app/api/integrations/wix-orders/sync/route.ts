import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { assertOrigin, requireOwner } from "@/lib/integrations/wix-orders/server";
import { resolveImportRange } from "@/lib/integrations/date-range";
import { runImportRefresh } from "@/lib/integrations/import-refresh/execution";

export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess(); requireOwner(access);
    const form = await request.formData(), connectionId = form.get("connectionId");
    if (typeof connectionId !== "string" || !/^[a-f0-9-]{36}$/i.test(connectionId)) throw new Error("wix_connection_invalid");
    const range = resolveImportRange(form.get("startDate"), form.get("endDate"));
    const result = await runImportRefresh({ provider: "wix-orders", workspaceId: access.workspaceId, connectionId,
      trigger: "manual", actorId: access.user.id, range });
    if (result !== "succeeded") throw new Error("wix_sync_busy");
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=synced", 303);
  } catch (error) {
    const result = error instanceof Error && error.message === "invalid_date_range" ? "invalid_range" :
      error instanceof Error && (error.message === "wix_too_many_orders" || error.name === "TimeoutError" || error.name === "AbortError") ? "range_too_large" : "error";
    return Response.redirect(`https://www.vaeroex.com/app/integrations/wix-orders?result=${result}`, 303);
  }
}
