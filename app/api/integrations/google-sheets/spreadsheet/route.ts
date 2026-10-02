import { z } from "zod";
import { spreadsheetIdFromUrl } from "@/lib/integrations/google-sheets/contracts";
import { requireSheetsManager, sheetsConnection, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsLifecycle, sheetsMetadata } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), spreadsheetUrl: z.string().min(1).max(2048) }).strict().parse(await readSheetsForm(request, 3072));
    const access = await requireSheetsManager(), connection = await sheetsConnection(access.workspaceId, input.connectionId);
    if (connection.status !== "connected") return sheetsFailure(403);
    const spreadsheetId = spreadsheetIdFromUrl(input.spreadsheetUrl);
    const metadata = await sheetsMetadata(access.workspaceId, connection.id, spreadsheetId);
    if (metadata.tabs.length === 0) throw new Error("google_sheets_no_grid_tabs");
    await sheetsLifecycle("config", access.workspaceId, connection.id, { expectedUpdatedAt: connection.updated_at,
      configuration: { spreadsheetId, spreadsheetTitle: metadata.title, tabs: metadata.tabs,
        sheetId: null, sheetTitle: null, headerRow: 1, headers: [] } }, access.user.id, access.sessionId);
    return sheetsRedirect("result", "spreadsheet_saved");
  } catch (error) { return sheetsFailure(400, error); }
}
