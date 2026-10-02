import "server-only";
import { z } from "zod";
import {
  assertMapping, GOOGLE_SHEETS_MAX_ROWS, GOOGLE_SHEETS_READ_BATCH_ROWS,
  mappedColumnIndexes, sheetColumn, sheetRange
} from "./contracts";
import { normalizeSheetsRows, sheetsSyncErrorCode } from "./ingestion";
import { sheetsAdmin, sheetsHeaders, sheetsMappedColumns, sheetsMetadata } from "./server";

export async function runSheetsSync(input: {
  workspaceId: string; connectionId: string; actorId: string | null; sessionId: string | null;
  trigger: "manual" | "scheduled";
}) {
  const admin = sheetsAdmin();
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  const claimed = await rpc("claim_google_sheets_sync_v1", {
    p_workspace_id: input.workspaceId, p_connection_id: input.connectionId,
    p_actor_id: input.actorId, p_session_id: input.sessionId, p_trigger: input.trigger
  });
  if (claimed.error) {
    const message = claimed.error.message || "";
    throw new Error(message.includes("google_sheets_sync_busy") ? "google_sheets_sync_busy" : "google_sheets_mapping_required");
  }
  const { runId } = z.object({ runId: z.string().uuid() }).parse(claimed.data);
  try {
    const result = await admin.from("google_sheets_connections").select("*")
      .eq("workspace_id", input.workspaceId).eq("id", input.connectionId).single();
    if (result.error || !result.data) throw new Error("google_sheets_connection_unavailable");
    const connection = result.data;
    if (!connection.spreadsheet_id || connection.sheet_id === null || !connection.sheet_title) throw new Error("google_sheets_mapping_required");
    const spreadsheetId = connection.spreadsheet_id;
    const headers = z.array(z.string()).parse(connection.headers);
    const mapping = assertMapping(headers, connection.field_mapping);
    const metadata = await sheetsMetadata(input.workspaceId, input.connectionId, connection.spreadsheet_id);
    const tab = metadata.tabs.find(tab => tab.id === connection.sheet_id);
    if (!tab) throw new Error("google_sheets_tab_missing");
    // The grid boundary is explicit. Empty allocated rows do not silently widen a read.
    if (tab.rowCount > GOOGLE_SHEETS_MAX_ROWS + connection.header_row) throw new Error("google_sheets_row_limit");
    const freshHeaders = await sheetsHeaders(input.workspaceId, input.connectionId, spreadsheetId, tab.title, connection.header_row);
    if (JSON.stringify(headers) !== JSON.stringify(freshHeaders)) throw new Error("google_sheets_headers_changed");
    const columns = mappedColumnIndexes(mapping);
    const readSnapshot = async () => {
      const rows: unknown[][] = [];
    for (let from = connection.header_row + 1; from <= tab.rowCount; from += GOOGLE_SHEETS_READ_BATCH_ROWS) {
      const to = Math.min(tab.rowCount, from + GOOGLE_SHEETS_READ_BATCH_ROWS - 1);
      const values = await sheetsMappedColumns(input.workspaceId, input.connectionId, spreadsheetId,
        columns.map(column => sheetRange(tab.title, sheetColumn(column), from, to)), "UNFORMATTED_VALUE");
      for (let offset = 0; offset <= to - from; offset += 1) {
        const row: unknown[] = [];
        columns.forEach((column, index) => { row[column] = values[index][offset]?.[0] ?? null; });
        rows.push(row);
      }
    }

      return normalizeSheetsRows({ workspaceId: input.workspaceId, businessEntityId: connection.business_entity_id,
        connectionId: input.connectionId, spreadsheetId: spreadsheetId, sheetId: connection.sheet_id!,
        headerRow: connection.header_row, mapping, rows });
    };
    const first = await readSnapshot();
    const normalized = await readSnapshot();
    const signature = (rows: typeof normalized) => rows.map(row => `${row.identity}:${row.fingerprint}`).sort().join("\n");
    if (signature(first) !== signature(normalized)) throw new Error("google_sheets_snapshot_changed");
    const finalMetadata = await sheetsMetadata(input.workspaceId, input.connectionId, spreadsheetId);
    const finalTab = finalMetadata.tabs.find(candidate => candidate.id === tab.id);
    const finalHeaders = finalTab ? await sheetsHeaders(input.workspaceId, input.connectionId, spreadsheetId, finalTab.title, connection.header_row) : [];
    if (!finalTab || finalTab.title !== tab.title || finalTab.rowCount !== tab.rowCount || JSON.stringify(finalHeaders) !== JSON.stringify(headers)) {
      throw new Error("google_sheets_snapshot_changed");
    }
    // Both complete reads agree. Any failed/changed snapshot leaves the prior facts intact.
    const committed = await rpc("commit_google_sheets_sync_v1", {
      p_workspace_id: input.workspaceId, p_connection_id: input.connectionId, p_run_id: runId,
      p_rows: normalized, p_complete: true
    });
    if (committed.error) throw new Error(committed.error.message?.includes("google_sheets_workspace_capacity") ? "google_sheets_workspace_capacity" : "google_sheets_commit_failed");
    return z.object({ runId: z.string().uuid(), rowCount: z.number().int(), factCount: z.number().int(), rejectedCount: z.number().int(), conflictCount: z.number().int() }).parse(committed.data);
  } catch (error) {
    await rpc("fail_google_sheets_sync_v1", { p_workspace_id: input.workspaceId,
      p_connection_id: input.connectionId, p_run_id: runId, p_error_code: sheetsSyncErrorCode(error) });
    throw error;
  }
}
