import { z } from "zod";
import { NextResponse } from "next/server";
import { assertBusinessLabel, assertMapping, sheetColumn, sheetRange } from "@/lib/integrations/google-sheets/contracts";
import { requireSheetsManager, sheetsConnection } from "@/lib/integrations/google-sheets/route-helpers";
import { assertSheetsOrigin, readSheetsForm, sheetsMappedColumns } from "@/lib/integrations/google-sheets/server";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  try {
    assertSheetsOrigin(request);
    const input = z.object({ connectionId: z.string().uuid(), fieldMapping: z.string().max(12_000).optional() }).strict().parse(await readSheetsForm(request));
    const access = await requireSheetsManager(), connection = await sheetsConnection(access.workspaceId, input.connectionId);
    if (connection.status !== "connected" || !connection.spreadsheet_id || !connection.sheet_title) throw new Error("unavailable");
    const savedHeaders = z.array(z.string()).max(100).parse(connection.headers);
    const mapping = assertMapping(savedHeaders, input.fieldMapping ? JSON.parse(input.fieldMapping) : connection.field_mapping);
    const selected = [mapping.rowKeyColumn, mapping.dateColumn, ...(mapping.locationColumn === null ? [] : [mapping.locationColumn]), ...mapping.metrics.map(metric => metric.column)];
    const first = connection.header_row + 1;
    const columns = await sheetsMappedColumns(access.workspaceId, connection.id, connection.spreadsheet_id,
      selected.map(column => sheetRange(connection.sheet_title!, sheetColumn(column), first, first + 10)));
    const count = Math.min(10, Math.max(0, ...columns.map(column => column.length)));
    const rows = Array.from({ length: count }, (_, row) => columns.map(column => {
      const value = String(column[row]?.[0] ?? "");
      if (!value) return "";
      try { return assertBusinessLabel(value); } catch { return "[unavailable value]"; }
    }));
    return NextResponse.json({ ok: true, headers: selected.map(column => savedHeaders[column]), rows,
      sampleSize: count, truncated: columns.some(column => column.length > 10) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "Preview is unavailable. Check the connection, tab and selected columns." }, { status: 400, headers });
  }
}
