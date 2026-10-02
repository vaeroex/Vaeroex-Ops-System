import { z } from "zod";
import { requireSheetsManager, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm } from "@/lib/integrations/google-sheets/server";
import { runSheetsSync } from "@/lib/integrations/google-sheets/sync";
import { sheetsSyncErrorCode } from "@/lib/integrations/google-sheets/ingestion";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), confirmation: z.literal("sync") }).strict().parse(await readSheetsForm(request, 1024));
    const access = await requireSheetsManager();
    await runSheetsSync({ workspaceId: access.workspaceId, connectionId: input.connectionId,
      actorId: access.user.id, sessionId: access.sessionId, trigger: "manual" });
    return sheetsRedirect("result", "synced");
  } catch (error) {
    try { return sheetsRedirect("error", sheetsSyncErrorCode(error)); }
    catch { return sheetsFailure(400, error); }
  }
}
