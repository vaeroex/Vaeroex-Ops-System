import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  type FieldMapping, type SheetsNormalizedRow, GOOGLE_SHEETS_MAX_FACTS,
  assertBusinessLabel, mappedColumnIndexes, parseDateCell, parseNumericCell
} from "./contracts";

function percentFractionToPoints(value: string) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const digits = whole + fraction.padEnd(2, "0");
  const offset = whole.length + 2;
  return parseNumericCell(`${negative ? "-" : ""}${digits.slice(0, offset).replace(/^0+(?=\d)/, "")}${digits.length > offset ? `.${digits.slice(offset)}` : ""}`);
}

export function normalizeSheetsRows(input: {
  workspaceId: string; businessEntityId: string; connectionId: string; spreadsheetId: string;
  sheetId: number; headerRow: number; mapping: FieldMapping; rows: unknown[][];
}): SheetsNormalizedRow[] {
  const result: SheetsNormalizedRow[] = [];
  const seen = new Set<string>();
  let facts = 0;
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index];
    if (mappedColumnIndexes(input.mapping).every(column => row[column] === undefined || row[column] === null || row[column] === "")) continue;
    const rowNumber = input.headerRow + index + 1;
    const rawKey = row[input.mapping.rowKeyColumn];
    const key = typeof rawKey === "string" ? rawKey.trim() : typeof rawKey === "number" && Number.isSafeInteger(rawKey) ? String(rawKey) : "";
    if (!key || key.length > 200 || /[\u0000-\u001f]/.test(key)) throw new Error("google_sheets_row_key_invalid");
    // No arbitrary key text is persisted. A duplicate stable key is an ambiguous snapshot.
    const rowKey = contractSha256({ key });
    if (seen.has(rowKey)) throw new Error("google_sheets_duplicate_row_key");
    seen.add(rowKey);
    const issues: string[] = [];
    let date: string | null = null;
    try { date = parseDateCell(row[input.mapping.dateColumn], input.mapping.dateFormat); if (!date) issues.push("date_required"); }
    catch { issues.push("date_invalid"); }
    let location: string | null = null;
    if (input.mapping.locationColumn !== null) {
      try { location = assertBusinessLabel(String(row[input.mapping.locationColumn] ?? "").trim()); }
      catch { issues.push("location_invalid"); }
    }
    const metrics: SheetsNormalizedRow["metrics"] = [];
    for (const metric of input.mapping.metrics) {
      const value = row[metric.column];
      if (value === undefined || value === null || value === "") continue;
      try {
        const parsed = parseNumericCell(value);
        const numeric = metric.unit === "percent_fraction" ? percentFractionToPoints(parsed) : parsed;
        if (metric.unit === "count" && !/^-?\d+$/.test(numeric)) throw new Error("count_not_integer");
        metrics.push({ ...metric, value: numeric });
      } catch { issues.push(`numeric_column_${metric.column}_invalid`); }
    }
    if (!metrics.length) issues.push("numeric_values_required");
    facts += metrics.length;
    if (facts > GOOGLE_SHEETS_MAX_FACTS) throw new Error("google_sheets_observation_limit");
    const projection = { rowKey, date, location, validationState: issues.length ? "invalid" as const : "valid" as const, issues, metrics };
    result.push({
      ...projection, rowNumber,
      identity: contractSha256({ identityVersion: "external_source_identity_v1", workspaceId: input.workspaceId,
        businessEntityId: input.businessEntityId, connectionId: input.connectionId,
        source: { kind: "provider", providerKey: "google_sheets", providerRecordType: "worksheet_row",
          providerRecordId: `${input.spreadsheetId}:${input.sheetId}:${rowKey.slice(7)}` } }),
      fingerprint: contractSha256({ policy: "google_sheets_normalization_v1", ...projection,
        metrics: metrics.map(metric => ({ ...metric, target: metric.target === null ? null : String(metric.target) })) })
    });
  }
  return result;
}

export const SHEETS_SYNC_ERROR_CODES = new Set([
  "google_sheets_authorization_required", "google_sheets_headers_changed", "google_sheets_tab_missing",
  "google_sheets_row_limit", "google_sheets_observation_limit", "google_sheets_row_key_invalid",
  "google_sheets_duplicate_row_key", "google_sheets_provider_request_failed", "google_sheets_response_too_large",
  "google_sheets_sync_busy", "google_sheets_mapping_required", "google_sheets_workspace_capacity", "google_sheets_snapshot_changed"
]);
export function sheetsSyncErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return SHEETS_SYNC_ERROR_CODES.has(code) ? code.replace("google_sheets_", "") : "sync_failed";
}
