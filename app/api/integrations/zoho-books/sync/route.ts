import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { assertOrigin, requireOwner } from "@/lib/integrations/zoho-books/server";
import { resolveImportRange } from "@/lib/integrations/date-range";
import { runImportRefresh } from "@/lib/integrations/import-refresh/execution";

export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess(); requireOwner(access);
    const data = await request.formData(), connectionId = z.string().uuid().parse(data.get("connectionId"));
    const range = resolveImportRange(data.get("startDate"), data.get("endDate"));
    const result = await runImportRefresh({ provider: "zoho-books", workspaceId: access.workspaceId, connectionId,
      trigger: "manual", actorId: access.user.id, range });
    if (result !== "succeeded") throw new Error("zoho_books_sync_busy");
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=synced", 303);
  } catch (error) {
    const result = error instanceof Error && error.message === "invalid_date_range" ? "invalid_range" : "error";
    return Response.redirect(`https://www.vaeroex.com/app/integrations/zoho-books?result=${result}`, 303);
  }
}
