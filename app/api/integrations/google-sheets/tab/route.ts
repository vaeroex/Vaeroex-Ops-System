import { z } from "zod";
import { HeaderRowSchema, SheetIdSchema } from "@/lib/integrations/google-sheets/contracts";
import { requireSheetsManager, sheetsConnection, sheetsFailure, sheetsRedirect } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsLifecycle, sheetsHeaders, sheetsMetadata } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  try {
    assertSheetsOrigin(request);
    const body = z.object({ connectionId: z.string().uuid(), sheetId: z.coerce.number(), headerRow: z.coerce.number() }).strict().parse(await readSheetsForm(request, 1024));
    const sheetId = SheetIdSchema.parse(body.sheetId), headerRow = HeaderRowSchema.parse(body.headerRow);
    const access = await requireSheetsManager(), connection = await sheetsConnection(access.workspaceId, body.connectionId);
    if (connection.status !== "connected" || !connection.spreadsheet_id) return sheetsFailure(403);
    const metadata = await sheetsMetadata(access.workspaceId, connection.id, connection.spreadsheet_id);
    const tab = metadata.tabs.find(item => item.id === sheetId);
    if (!tab || tab.rowCount < headerRow) throw new Error("google_sheets_tab_unavailable");
    const headers = await sheetsHeaders(access.workspaceId, connection.id, connection.spreadsheet_id, tab.title, headerRow);
    if (!headers.some(header => header && header !== "[restricted column]")) throw new Error("google_sheets_headers_unavailable");
    await sheetsLifecycle("config", access.workspaceId, connection.id, { expectedUpdatedAt: connection.updated_at,
      configuration: { spreadsheetId: connection.spreadsheet_id, spreadsheetTitle: metadata.title,
        tabs: metadata.tabs, sheetId: tab.id, sheetTitle: tab.title, headerRow, headers } }, access.user.id, access.sessionId);
    return sheetsRedirect("result", "headers_discovered");
  } catch (error) { return sheetsFailure(400, error); }
}
