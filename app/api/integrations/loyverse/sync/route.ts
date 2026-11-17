import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { resolveImportRange } from "@/lib/integrations/date-range";
import { assertOrigin, requireOwner } from "@/lib/integrations/loyverse/server";
import { runImportRefresh } from "@/lib/integrations/import-refresh/execution";

export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess(); requireOwner(access);
    const data = await request.formData(), connectionId = data.get("connectionId");
    if (typeof connectionId !== "string" || !/^[a-f0-9-]{36}$/i.test(connectionId)) throw new Error("invalid_connection");
    const range = resolveImportRange(data.get("startDate"), data.get("endDate"));
    const result = await runImportRefresh({ provider: "loyverse", workspaceId: access.workspaceId, connectionId,
      trigger: "manual", actorId: access.user.id, range });
    if (result !== "succeeded") throw new Error("loyverse_sync_busy");
    const destination = new URL("https://www.vaeroex.com/app/integrations/loyverse?result=synced");
    destination.searchParams.set("from", range.startDate); destination.searchParams.set("to", range.endDate);
    return Response.redirect(destination, 303);
  } catch (error) {
    const code = error instanceof Error && error.message === "invalid_date_range" ? "invalid_date_range" :
      error instanceof Error && ["loyverse_receipt_limit_exceeded", "loyverse_response_too_large"].includes(error.message) ? "range_too_large" :
      error instanceof Error && error.message === "loyverse_quota_exceeded" ? "quota_exceeded" : "sync_failed";
    return Response.redirect(`https://www.vaeroex.com/app/integrations/loyverse?result=error&error=${code}`, 303);
  }
}
