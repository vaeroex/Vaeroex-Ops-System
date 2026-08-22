import {
  QBO_PROVIDER_KEY,
  QBO_REPORT_CONTRACT_VERSION,
  QboAccountingBasisSchema,
  QboReportControlObservationSchema,
  QboReportTypeSchema,
  type QboProviderMetadata,
  type QboReportControlObservation,
  type QboReportType
} from "@/lib/integrations/providers/qbo/contracts";

type JsonRecord = Record<string, unknown>;

function fail(field: string): never {
  throw new Error(`qbo_report_contract_validation_failed:${field}`);
}

function object(value: unknown, field: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as JsonRecord;
}

function optionalObject(value: unknown, field: string): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return object(value, field);
}

function stringValue(value: unknown, field: string, required = true) {
  if (value === undefined || value === null) {
    if (required) fail(field);
    return null;
  }
  if (typeof value !== "string") fail(field);
  const trimmed = value.trim();
  if (trimmed === "" && required) fail(field);
  return trimmed === "" ? null : trimmed;
}

function dateValue(value: unknown, field: string) {
  const text = stringValue(value, field, false);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(field);
  return text;
}

function basis(value: unknown) {
  const text = stringValue(value, "Header.ReportBasis", false)?.toLowerCase();
  return QboAccountingBasisSchema.parse(text === "cash" ? "cash" : text === "accrual" ? "accrual" : "unknown");
}

function currency(value: unknown) {
  const text = stringValue(value, "Header.Currency", true)?.toUpperCase();
  if (!text || !/^[A-Z]{3}$/.test(text)) fail("Header.Currency");
  return text;
}

function provider(providerMetadata: QboProviderMetadata) {
  return {
    providerKey: QBO_PROVIDER_KEY,
    realmId: providerMetadata.realmId,
    sourceEnvironment: providerMetadata.sourceEnvironment
  } as const;
}

function columns(raw: JsonRecord) {
  const columnsObject = object(raw.Columns, "Columns");
  const rawColumns = columnsObject.Column;
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) fail("Columns.Column");
  return rawColumns.map((value, index) => {
    const column = object(value, `Columns.Column.${index}`);
    const key = stringValue(column.ColType, `Columns.Column.${index}.ColType`, false)
      ?? stringValue(column.ColTitle, `Columns.Column.${index}.ColTitle`, false)
      ?? `column_${index + 1}`;
    return {
      columnKey: key.replace(/[^A-Za-z0-9._:/-]/g, "_").slice(0, 128),
      title: stringValue(column.ColTitle, `Columns.Column.${index}.ColTitle`, false),
      type: stringValue(column.ColType, `Columns.Column.${index}.ColType`, false)
    };
  });
}

function cells(value: unknown, columnKeys: readonly string[], field: string) {
  const rawCells = value === undefined || value === null ? [] : value;
  if (!Array.isArray(rawCells)) fail(field);
  return rawCells.map((cellValue, index) => {
    const cell = object(cellValue, `${field}.${index}`);
    return {
      columnKey: columnKeys[index] ?? `column_${index + 1}`,
      value: stringValue(cell.value, `${field}.${index}.value`, false),
      id: stringValue(cell.id, `${field}.${index}.id`, false)
    };
  });
}

function rows(rawRows: unknown, columnKeys: readonly string[], field: string): QboReportControlObservation["rows"] {
  if (rawRows === undefined || rawRows === null) return [];
  if (!Array.isArray(rawRows)) fail(field);
  return rawRows.map((value, index) => {
    const row = object(value, `${field}.${index}`);
    const rowType = stringValue(row.type, `${field}.${index}.type`, false);
    const header = optionalObject(row.Header, `${field}.${index}.Header`);
    const summary = optionalObject(row.Summary, `${field}.${index}.Summary`);
    const nestedRows = optionalObject(row.Rows, `${field}.${index}.Rows`);
    const group = stringValue(row.group, `${field}.${index}.group`, false);
    if (nestedRows || rowType === "Section") {
      const headerCells = cells(header?.ColData, columnKeys, `${field}.${index}.Header.ColData`);
      const summaryCells = cells(summary?.ColData, columnKeys, `${field}.${index}.Summary.ColData`);
      const childRows = rows(nestedRows?.Row, columnKeys, `${field}.${index}.Rows.Row`);
      const summaryRow = summaryCells.length > 0
        ? [{ rowType: "summary" as const, group, cells: summaryCells, children: [] }]
        : [];
      return {
        rowType: "section" as const,
        group,
        cells: headerCells,
        children: [...childRows, ...summaryRow]
      };
    }
    return {
      rowType: "data" as const,
      group,
      cells: cells(row.ColData, columnKeys, `${field}.${index}.ColData`),
      children: []
    };
  });
}

export function parseQboReport(input: {
  reportType: QboReportType;
  raw: unknown;
  provider: QboProviderMetadata;
}) {
  const reportType = QboReportTypeSchema.parse(input.reportType);
  const raw = object(input.raw, reportType);
  const header = object(raw.Header, "Header");
  const parsedColumns = columns(raw);
  const columnKeys = parsedColumns.map((column) => column.columnKey);
  const rowsObject = object(raw.Rows, "Rows");
  const observation = {
    contractVersion: QBO_REPORT_CONTRACT_VERSION,
    provider: provider(input.provider),
    reportType,
    reportBasis: basis(header.ReportBasis),
    sourceCurrency: currency(header.Currency),
    periodStart: dateValue(header.StartPeriod, "Header.StartPeriod"),
    periodEnd: dateValue(header.EndPeriod, "Header.EndPeriod"),
    columns: parsedColumns,
    rows: rows(rowsObject.Row, columnKeys, "Rows.Row"),
    contributionFamily: "control_observation" as const,
    additive: false as const,
    parserVersion: "qbo_report_parser_v1" as const
  };
  return QboReportControlObservationSchema.parse(observation);
}

export function flattenQboReportRows(observation: QboReportControlObservation) {
  const flattened: Array<{ group: string | null; label: string | null; rowType: string }> = [];
  const visit = (rowsToVisit: QboReportControlObservation["rows"]) => {
    for (const row of rowsToVisit) {
      flattened.push({
        group: row.group,
        label: row.cells.find((cell) => cell.value !== null)?.value ?? null,
        rowType: row.rowType
      });
      visit(row.children as QboReportControlObservation["rows"]);
    }
  };
  visit(observation.rows);
  return flattened;
}
