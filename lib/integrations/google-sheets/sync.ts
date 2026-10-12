import "server-only";
import { z } from "zod";
import type { SheetsScheduledAdmission } from "./scheduler";
import {
  assertMapping, GOOGLE_SHEETS_MAX_ROWS, GOOGLE_SHEETS_READ_BATCH_ROWS,
  mappedColumnIndexes, sheetColumn, sheetRange
} from "./contracts";
import { normalizeSheetsRows, sheetsSyncErrorCode } from "./ingestion";
import { sheetsAdmin, sheetsHeaders, sheetsMappedColumns, sheetsMetadata } from "./server";
import { assertSheetsTimeRemaining, withSheetsRequest, type SheetsAbortableResult, type SheetsExecutionBudget } from "./execution";

export async function runSheetsSync(input: {
  workspaceId: string; connectionId: string; actorId: string | null; sessionId: string | null;
  trigger: "manual" | "scheduled"; execution?: SheetsExecutionBudget; admission?: SheetsScheduledAdmission;
}) {
  const startedAt = Date.now();
  // Manual runs share the route's five-minute ceiling. Scheduled runs inherit
  // the tick's remaining budget rather than resetting it for each connection.
  const execution = input.execution ?? { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const admin = sheetsAdmin();
  const rawRpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) =>
    SheetsAbortableResult<{ data: unknown; error: { message?: string } | null }>;
  const rpc = (name: string, args: Record<string, unknown>, deadlineAt = execution.deadlineAt, timeoutMs = 10_000) =>
    withSheetsRequest(deadlineAt, timeoutMs, signal => rawRpc(name, args).abortSignal(signal));
  const claim = async () => {
    const claimed = await rpc("claim_google_sheets_sync_v1", {
      p_workspace_id: input.workspaceId, p_connection_id: input.connectionId,
      p_actor_id: input.actorId, p_session_id: input.sessionId, p_trigger: input.trigger
    });
    if (claimed.error) {
      const message = claimed.error.message || "";
      const admissionBusy = message.match(/google_sheets_(?:capacity|workspace|sync)_busy/)?.[0];
      throw new Error(admissionBusy ?? "google_sheets_mapping_required");
    }
    return claimed;
  };
  const claimed = input.trigger === "scheduled" && input.admission ? await input.admission.run(claim) : await claim();
  const { runId } = z.object({ runId: z.string().uuid() }).parse(claimed.data);
  try {
    const result = await withSheetsRequest(execution.deadlineAt, 10_000, signal => admin.from("google_sheets_connections").select("*")
      .eq("workspace_id", input.workspaceId).eq("id", input.connectionId).abortSignal(signal).single());
    if (result.error || !result.data) throw new Error("google_sheets_connection_unavailable");
    const connection = result.data;
    if (!connection.spreadsheet_id || connection.sheet_id === null || !connection.sheet_title) throw new Error("google_sheets_mapping_required");
    const spreadsheetId = connection.spreadsheet_id;
    const headers = z.array(z.string()).parse(connection.headers);
    const mapping = assertMapping(headers, connection.field_mapping);
    const metadata = await sheetsMetadata(input.workspaceId, input.connectionId, connection.spreadsheet_id, execution);
    const tab = metadata.tabs.find(tab => tab.id === connection.sheet_id);
    if (!tab) throw new Error("google_sheets_tab_missing");
    // The grid boundary is explicit. Empty allocated rows do not silently widen a read.
    if (tab.rowCount > GOOGLE_SHEETS_MAX_ROWS + connection.header_row) throw new Error("google_sheets_row_limit");
    const freshHeaders = await sheetsHeaders(input.workspaceId, input.connectionId, spreadsheetId, tab.title, connection.header_row, execution);
    if (JSON.stringify(headers) !== JSON.stringify(freshHeaders)) throw new Error("google_sheets_headers_changed");
    const columns = mappedColumnIndexes(mapping);
    const readSnapshot = async () => {
      const rows: unknown[][] = [];
      for (let from = connection.header_row + 1; from <= tab.rowCount; from += GOOGLE_SHEETS_READ_BATCH_ROWS) {
        assertSheetsTimeRemaining(execution.deadlineAt);
        const to = Math.min(tab.rowCount, from + GOOGLE_SHEETS_READ_BATCH_ROWS - 1);
        const values = await sheetsMappedColumns(input.workspaceId, input.connectionId, spreadsheetId,
          columns.map(column => sheetRange(tab.title, sheetColumn(column), from, to)), "UNFORMATTED_VALUE", execution);
        for (let offset = 0; offset <= to - from; offset += 1) {
          const row: unknown[] = [];
          columns.forEach((column, index) => { row[column] = values[index][offset]?.[0] ?? null; });
          rows.push(row);
        }
      }

      assertSheetsTimeRemaining(execution.deadlineAt);
      return normalizeSheetsRows({ workspaceId: input.workspaceId, businessEntityId: connection.business_entity_id,
        connectionId: input.connectionId, spreadsheetId: spreadsheetId, sheetId: connection.sheet_id!,
        headerRow: connection.header_row, mapping, rows });
    };
    const first = await readSnapshot();
    const normalized = await readSnapshot();
    const signature = (rows: typeof normalized) => rows.map(row => `${row.identity}:${row.fingerprint}`).sort().join("\n");
    if (signature(first) !== signature(normalized)) throw new Error("google_sheets_snapshot_changed");
    const finalMetadata = await sheetsMetadata(input.workspaceId, input.connectionId, spreadsheetId, execution);
    const finalTab = finalMetadata.tabs.find(candidate => candidate.id === tab.id);
    const finalHeaders = finalTab ? await sheetsHeaders(input.workspaceId, input.connectionId, spreadsheetId, finalTab.title, connection.header_row, execution) : [];
    if (!finalTab || finalTab.title !== tab.title || finalTab.rowCount !== tab.rowCount || JSON.stringify(finalHeaders) !== JSON.stringify(headers)) {
      throw new Error("google_sheets_snapshot_changed");
    }
    // Both complete reads agree. Any failed/changed snapshot leaves the prior facts intact.
    assertSheetsTimeRemaining(execution.deadlineAt);
    const committed = await rpc("commit_google_sheets_sync_v1", {
      p_workspace_id: input.workspaceId, p_connection_id: input.connectionId, p_run_id: runId,
      p_rows: normalized, p_complete: true
    }, execution.deadlineAt, 120_000);
    if (committed.error) throw new Error(committed.error.message?.includes("google_sheets_workspace_capacity") ? "google_sheets_workspace_capacity" : "google_sheets_commit_failed");
    return z.object({ runId: z.string().uuid(), rowCount: z.number().int(), factCount: z.number().int(), rejectedCount: z.number().int(), conflictCount: z.number().int() }).parse(committed.data);
  } catch (error) {
    // Use the reserved cleanup budget, not the expired read signal. If a commit
    // acknowledgement was lost, SQL's run status and lease fence keep a committed
    // result authoritative; failure cannot overwrite an already completed run.
    await rpc("fail_google_sheets_sync_v1", { p_workspace_id: input.workspaceId,
      p_connection_id: input.connectionId, p_run_id: runId, p_error_code: sheetsSyncErrorCode(error) },
      execution.cleanupDeadlineAt).catch(() => undefined);
    throw error;
  }
}
