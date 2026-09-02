import {
  QBO_PROVIDER_KEY,
  QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE,
  QBO_REPORT_CONTRACT_VERSION,
  QboAccountingBasisSchema,
  QboReportControlObservationSchema,
  QboReportTypeSchema,
  type QboProviderMetadata,
  type QboReportControlObservation,
  type QboReportType
} from "@/lib/integrations/providers/qbo/contracts";

type JsonRecord = Record<string, unknown>;

export const QBO_REPORT_DIAGNOSTIC_CLASSES = [
  "report_header_shape",
  "report_columns_shape",
  "report_rows_shape",
  "report_cell_shape",
  "report_summary_shape",
  "report_metadata_shape"
] as const;

export type QboReportDiagnosticClass =
  (typeof QBO_REPORT_DIAGNOSTIC_CLASSES)[number];

type QboReportValueType =
  | "missing"
  | "null"
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "contract_mismatch";

function valueType(value: unknown): QboReportValueType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

export class QboReportContractError extends Error {
  readonly diagnosticClass: QboReportDiagnosticClass;
  readonly field: string;
  readonly expectedType: string;
  readonly actualType: QboReportValueType;

  constructor(input: {
    diagnosticClass: QboReportDiagnosticClass;
    field: string;
    expectedType: string;
    actualType: QboReportValueType;
  }) {
    super(
      `qbo_report_contract_validation_failed:${input.diagnosticClass}:${input.field}:${input.expectedType}:${input.actualType}`
    );
    this.name = "QboReportContractError";
    this.diagnosticClass = input.diagnosticClass;
    this.field = input.field;
    this.expectedType = input.expectedType;
    this.actualType = input.actualType;
  }
}

function fail(
  diagnosticClass: QboReportDiagnosticClass,
  field: string,
  expectedType: string,
  value: unknown
): never {
  throw new QboReportContractError({
    diagnosticClass,
    field,
    expectedType,
    actualType: valueType(value)
  });
}

function object(
  value: unknown,
  field: string,
  diagnosticClass: QboReportDiagnosticClass
): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(diagnosticClass, field, "object", value);
  }
  return value as JsonRecord;
}

function optionalObject(
  value: unknown,
  field: string,
  diagnosticClass: QboReportDiagnosticClass
): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return object(value, field, diagnosticClass);
}

function stringValue(
  value: unknown,
  field: string,
  diagnosticClass: QboReportDiagnosticClass,
  required = true
) {
  if (value === undefined || value === null) {
    if (required) fail(diagnosticClass, field, "nonempty_string", value);
    return null;
  }
  if (typeof value !== "string") fail(diagnosticClass, field, "string", value);
  const trimmed = value.trim();
  if (trimmed === "" && required) {
    fail(diagnosticClass, field, "nonempty_string", value);
  }
  return trimmed === "" ? null : trimmed;
}

function dateValue(value: unknown, field: string) {
  const text = stringValue(value, field, "report_metadata_shape", false);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail("report_metadata_shape", field, "iso_date", value);
  }
  return text;
}

function basis(value: unknown) {
  const text = stringValue(
    value,
    "Header.ReportBasis",
    "report_metadata_shape",
    false
  )?.toLowerCase();
  if (text === undefined || text === null) {
    return QboAccountingBasisSchema.parse("unknown");
  }
  if (text !== "cash" && text !== "accrual") {
    fail(
      "report_metadata_shape",
      "Header.ReportBasis",
      "cash_or_accrual",
      value
    );
  }
  return QboAccountingBasisSchema.parse(text);
}

function currency(value: unknown) {
  const text = stringValue(
    value,
    "Header.Currency",
    "report_metadata_shape",
    false
  )?.toUpperCase();
  if (text === undefined || text === null) return null;
  if (!/^[A-Z]{3}$/.test(text)) {
    fail("report_metadata_shape", "Header.Currency", "iso_currency_code", value);
  }
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
  const columnsObject = object(raw.Columns, "Columns", "report_columns_shape");
  const rawColumns = columnsObject.Column;
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    fail("report_columns_shape", "Columns.Column", "nonempty_array", rawColumns);
  }
  const usedKeys = new Set<string>();
  return rawColumns.map((value, index) => {
    const field = `Columns.Column.${index}`;
    const column = object(value, field, "report_columns_shape");
    const title = stringValue(
      column.ColTitle,
      `${field}.ColTitle`,
      "report_columns_shape",
      false
    );
    const type = stringValue(
      column.ColType,
      `${field}.ColType`,
      "report_columns_shape",
      false
    );
    const rawKey = title ?? type ?? `column_${index + 1}`;
    const sanitizedKey = rawKey
      .replace(/[^A-Za-z0-9._:/-]/g, "_")
      .slice(0, 112) || `column_${index + 1}`;
    const columnKey = usedKeys.has(sanitizedKey)
      ? `${sanitizedKey}_${index + 1}`
      : sanitizedKey;
    usedKeys.add(columnKey);
    return { columnKey, title, type };
  });
}

function cells(input: {
  value: unknown;
  columnKeys: readonly string[];
  field: string;
  diagnosticClass?: "report_cell_shape" | "report_summary_shape";
}) {
  const diagnosticClass = input.diagnosticClass ?? "report_cell_shape";
  const rawCells = input.value === undefined || input.value === null
    ? []
    : input.value;
  if (!Array.isArray(rawCells)) {
    fail(diagnosticClass, input.field, "array", rawCells);
  }
  if (rawCells.length > input.columnKeys.length) {
    fail(diagnosticClass, input.field, "column_bounded_array", rawCells);
  }
  return rawCells.map((cellValue, index) => {
    const field = `${input.field}.${index}`;
    const cell = object(cellValue, field, diagnosticClass);
    return {
      columnKey: input.columnKeys[index] ?? `column_${index + 1}`,
      value: stringValue(
        cell.value,
        `${field}.value`,
        diagnosticClass,
        false
      ),
      id: stringValue(cell.id, `${field}.id`, diagnosticClass, false)
    };
  });
}

function rows(
  rawRows: unknown,
  columnKeys: readonly string[],
  field: string,
  depth = 0
): QboReportControlObservation["rows"] {
  if (depth > 32) {
    fail("report_rows_shape", field, "bounded_hierarchy", rawRows);
  }
  if (rawRows === undefined || rawRows === null) return [];
  if (!Array.isArray(rawRows)) {
    fail("report_rows_shape", field, "array", rawRows);
  }
  return rawRows.map((value, index) => {
    const rowField = `${field}.${index}`;
    const row = object(value, rowField, "report_rows_shape");
    const rowType = stringValue(
      row.type,
      `${rowField}.type`,
      "report_rows_shape",
      false
    );
    if (rowType !== null && rowType !== "Data" && rowType !== "Section") {
      fail("report_rows_shape", `${rowField}.type`, "data_or_section", row.type);
    }
    const header = optionalObject(
      row.Header,
      `${rowField}.Header`,
      "report_rows_shape"
    );
    const summary = optionalObject(
      row.Summary,
      `${rowField}.Summary`,
      "report_summary_shape"
    );
    const nestedRows = optionalObject(
      row.Rows,
      `${rowField}.Rows`,
      "report_rows_shape"
    );
    const group = stringValue(
      row.group,
      `${rowField}.group`,
      "report_rows_shape",
      false
    );
    const sectionShape =
      rowType === "Section" || header !== null || summary !== null || nestedRows !== null;

    if (sectionShape) {
      if (row.ColData !== undefined && row.ColData !== null) {
        fail(
          "report_rows_shape",
          `${rowField}.ColData`,
          "section_without_direct_coldata",
          row.ColData
        );
      }
      const headerCells = cells({
        value: header?.ColData,
        columnKeys,
        field: `${rowField}.Header.ColData`
      });
      const summaryCells = cells({
        value: summary?.ColData,
        columnKeys,
        field: `${rowField}.Summary.ColData`,
        diagnosticClass: "report_summary_shape"
      });
      const childRows = rows(
        nestedRows?.Row,
        columnKeys,
        `${rowField}.Rows.Row`,
        depth + 1
      );
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

    if (row.ColData === undefined || row.ColData === null) {
      fail(
        "report_rows_shape",
        `${rowField}.ColData`,
        "data_row_coldata_array",
        row.ColData
      );
    }
    return {
      rowType: "data" as const,
      group,
      cells: cells({
        value: row.ColData,
        columnKeys,
        field: `${rowField}.ColData`
      }),
      children: []
    };
  });
}

function minimizedContractError(path: readonly PropertyKey[]): never {
  const field = path.length > 0 ? path.join(".").slice(0, 200) : "report";
  const diagnosticClass: QboReportDiagnosticClass =
    path[0] === "columns"
      ? "report_columns_shape"
      : path[0] === "rows"
        ? "report_rows_shape"
        : "report_metadata_shape";
  throw new QboReportContractError({
    diagnosticClass,
    field,
    expectedType: "bounded_minimized_contract",
    actualType: "contract_mismatch"
  });
}

export function parseQboReport(input: {
  reportType: QboReportType;
  raw: unknown;
  provider: QboProviderMetadata;
}) {
  const reportType = QboReportTypeSchema.parse(input.reportType);
  const raw = object(input.raw, reportType, "report_header_shape");
  const header = object(raw.Header, "Header", "report_header_shape");
  const reportName = stringValue(
    header.ReportName,
    "Header.ReportName",
    "report_metadata_shape",
    false
  );
  if (
    reportName !== null &&
    reportName !== QBO_PROVIDER_REPORT_IDENTIFIER_BY_TYPE[reportType]
  ) {
    fail(
      "report_metadata_shape",
      "Header.ReportName",
      "matching_provider_report_identifier",
      header.ReportName
    );
  }
  const parsedColumns = columns(raw);
  const columnKeys = parsedColumns.map((column) => column.columnKey);
  const rowsObject = object(raw.Rows, "Rows", "report_rows_shape");
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
  const parsed = QboReportControlObservationSchema.safeParse(observation);
  if (!parsed.success) minimizedContractError(parsed.error.issues[0]?.path ?? []);
  return parsed.data;
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
