import type { SpreadsheetWorksheet } from "@/lib/imports/spreadsheets";

export const WORKBOOK_DETECTION_VERSION = 2;

export function workbookDetectionVersion(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const version = Number((value as Record<string, unknown>).detection_version);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

export function workbookDetectionPlanIsStale(value: unknown) {
  return workbookDetectionVersion(value) < WORKBOOK_DETECTION_VERSION;
}

export type WorksheetType =
  | "company_profile"
  | "wide_time_series"
  | "kpis"
  | "sales"
  | "financials"
  | "inventory"
  | "orders"
  | "customers"
  | "employees"
  | "vendors"
  | "marketing"
  | "unknown";

export type WorksheetMapping = Record<string, string>;

export type WorksheetImportField = {
  key: string;
  label: string;
  required?: boolean;
  valueType?: "text" | "number" | "date";
  candidates: string[];
};

export const WORKSHEET_TYPE_OPTIONS: Array<{ value: WorksheetType; label: string }> = [
  { value: "company_profile", label: "Company Profile" },
  { value: "wide_time_series", label: "Time Series" },
  { value: "kpis", label: "KPIs" },
  { value: "sales", label: "Sales" },
  { value: "financials", label: "Financials" },
  { value: "inventory", label: "Inventory" },
  { value: "orders", label: "Orders" },
  { value: "customers", label: "Customers" },
  { value: "employees", label: "Employees" },
  { value: "vendors", label: "Vendors" },
  { value: "marketing", label: "Marketing" },
  { value: "unknown", label: "Unknown" }
];

const WORKSHEET_CONTEXT_LABELS: Record<WorksheetType, string> = {
  company_profile: "Company Context",
  wide_time_series: "Time Series",
  kpis: "KPIs",
  sales: "Sales",
  financials: "Financial",
  inventory: "Inventory",
  orders: "Operations",
  customers: "Customer Context",
  employees: "People",
  vendors: "Vendor Context",
  marketing: "Marketing",
  unknown: "Unknown / Context Only"
};

const COMMON_METRIC_FIELDS: WorksheetImportField[] = [
  { key: "metric_name", label: "Record or metric name", required: true, candidates: ["metric", "metric name", "name", "item", "record"] },
  { key: "value", label: "Primary numeric value", valueType: "number", candidates: ["value", "actual", "amount", "total", "count"] },
  { key: "category", label: "Category", candidates: ["category", "type", "status"] },
  { key: "metric_date", label: "Date", valueType: "date", candidates: ["date", "period", "month", "due date"] },
  { key: "owner", label: "Source or context", candidates: ["source", "store", "location", "channel", "supplier"] },
  { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "status"] }
];

export const WORKSHEET_IMPORT_FIELDS: Record<WorksheetType, WorksheetImportField[]> = {
  company_profile: [
    { key: "label", label: "Context field", required: true, candidates: ["field", "attribute", "company", "item", "name"] },
    { key: "value", label: "Context value", required: true, candidates: ["value", "detail", "description", "information"] }
  ],
  wide_time_series: [
    { key: "period", label: "Date or period", required: true, valueType: "date", candidates: ["date", "period", "month", "week", "quarter", "year"] }
  ],
  kpis: [
    { key: "name", label: "KPI name", required: true, candidates: ["kpi", "kpi name", "metric", "metric name", "month", "store", "name"] },
    { key: "actual_value", label: "Actual value", required: true, valueType: "number", candidates: ["actual value", "actual", "value", "revenue", "monthly revenue", "gross margin %", "customer rating", "amount", "total", "count"] },
    { key: "target", label: "Target", valueType: "number", candidates: ["target", "target revenue", "goal"] },
    { key: "metric_date", label: "Date or period", valueType: "date", candidates: ["date", "metric date", "period", "month"] },
    { key: "category", label: "Category", candidates: ["category", "type", "department", "store"] },
    { key: "owner", label: "Source or context", candidates: ["source", "store", "location", "team"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "status"] }
  ],
  sales: [
    { ...COMMON_METRIC_FIELDS[0], candidates: ["month", "date", "store", "channel", "product", "sales", "revenue"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Sales value", candidates: ["revenue", "sales", "net sales", "transactions", "units sold", "amount", "value"] },
    ...COMMON_METRIC_FIELDS.slice(2)
  ],
  financials: [
    { ...COMMON_METRIC_FIELDS[0], candidates: ["invoice", "account", "line item", "supplier", "vendor", "metric", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Financial value", candidates: ["amount", "balance", "cost", "expense", "revenue", "profit", "margin", "value"] },
    ...COMMON_METRIC_FIELDS.slice(2)
  ],
  inventory: [
    { ...COMMON_METRIC_FIELDS[0], label: "Item or SKU", candidates: ["sku", "item", "product", "inventory item", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Inventory value", candidates: ["on hand", "quantity", "qty", "stock", "inventory value", "30 day sales", "value"] },
    { ...COMMON_METRIC_FIELDS[2], candidates: ["category", "status", "supplier"] },
    ...COMMON_METRIC_FIELDS.slice(3)
  ],
  orders: [
    { ...COMMON_METRIC_FIELDS[0], label: "Order or operation", candidates: ["order", "order id", "operation", "shipment", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Operational value", candidates: ["days to deliver", "quantity", "amount", "total", "value"] },
    { ...COMMON_METRIC_FIELDS[2], candidates: ["status", "carrier", "category"] },
    ...COMMON_METRIC_FIELDS.slice(3)
  ],
  customers: [
    { ...COMMON_METRIC_FIELDS[0], label: "Customer or measure", candidates: ["customer", "account", "segment", "measure", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Customer value", candidates: ["rating", "score", "revenue", "orders", "value", "count"] },
    { ...COMMON_METRIC_FIELDS[2], candidates: ["category", "channel", "status"] },
    ...COMMON_METRIC_FIELDS.slice(3)
  ],
  employees: [
    { ...COMMON_METRIC_FIELDS[0], label: "Employee or people measure", candidates: ["employee", "role", "team", "department", "measure", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "People value", candidates: ["ot hours", "overtime hours", "training hours", "headcount", "hours", "value"] },
    { ...COMMON_METRIC_FIELDS[2], candidates: ["role", "department", "status"] },
    ...COMMON_METRIC_FIELDS.slice(3)
  ],
  vendors: [
    { ...COMMON_METRIC_FIELDS[0], label: "Vendor or supplier", candidates: ["vendor", "supplier", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Vendor value", candidates: ["amount", "spend", "orders", "lead time", "rating", "value"] },
    ...COMMON_METRIC_FIELDS.slice(2)
  ],
  marketing: [
    { ...COMMON_METRIC_FIELDS[0], label: "Campaign or measure", candidates: ["campaign", "channel", "metric", "name"] },
    { ...COMMON_METRIC_FIELDS[1], label: "Marketing value", candidates: ["spend", "leads", "conversions", "revenue", "impressions", "clicks", "value"] },
    ...COMMON_METRIC_FIELDS.slice(2)
  ],
  unknown: []
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

const PERIOD_COLUMNS = ["date", "period", "month", "week", "quarter", "year"];
const MONTH_NUMBERS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};
const ENTITY_IDENTITY_COLUMNS = [
  "sku",
  "item",
  "item id",
  "item name",
  "inventory item",
  "inventory id",
  "product",
  "product id",
  "product name",
  "customer",
  "order id",
  "order number",
  "employee",
  "customer id",
  "customer name",
  "employee id",
  "employee name",
  "vendor",
  "vendor id",
  "vendor name",
  "supplier",
  "supplier id",
  "supplier name"
];

export function parseWorksheetNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  const negative = /^\(.*\)$/.test(candidate);
  const parsed = Number(candidate.replace(/[()$,%\s,]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function parseWorksheetPeriod(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString().slice(0, 10);
  }

  const candidate = String(value ?? "").trim();
  if (!candidate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const yearMonth = candidate.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`;
  const monthYearNumeric = candidate.match(/^(0?[1-9]|1[0-2])[/-](\d{4})$/);
  if (monthYearNumeric) return `${monthYearNumeric[2]}-${String(Number(monthYearNumeric[1])).padStart(2, "0")}-01`;
  if (/^\d{4}$/.test(candidate)) return `${candidate}-01-01`;
  const quarter = candidate.match(/^Q([1-4])\s*[-/]?\s*(\d{4})$/i) || candidate.match(/^(\d{4})\s*[-/]?\s*Q([1-4])$/i);
  if (quarter) {
    const startsWithQuarter = /^Q/i.test(candidate);
    const quarterNumber = Number(startsWithQuarter ? quarter[1] : quarter[2]);
    const year = startsWithQuarter ? quarter[2] : quarter[1];
    return `${year}-${String((quarterNumber - 1) * 3 + 1).padStart(2, "0")}-01`;
  }

  const namedMonth = candidate.match(/^([A-Za-z]+)(?:[\s,/-]+(\d{4}))?$/);
  if (namedMonth) {
    const month = MONTH_NUMBERS[namedMonth[1].toLowerCase()];
    if (month) {
      return namedMonth[2]
        ? `${namedMonth[2]}-${String(month).padStart(2, "0")}-01`
        : `month:${String(month).padStart(2, "0")}`;
    }
  }

  // Date.parse may infer the current year for vague month labels, so only use it
  // after an explicit year has been established by the source value.
  if (!/\b\d{4}\b/.test(candidate)) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function worksheetPeriodDate(value: unknown) {
  const period = parseWorksheetPeriod(value);
  return period && /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : null;
}

function monthOnlyNumber(value: unknown) {
  const period = parseWorksheetPeriod(value);
  const match = period?.match(/^month:(\d{2})$/);
  return match ? Number(match[1]) : null;
}

function isRecognizableMonthSequence(values: unknown[]) {
  const months = values.map(monthOnlyNumber);
  if (months.length < 2 || months.some((month) => month === null)) return false;
  return months.every((month, index) => index === 0 || month === ((months[index - 1]! % 12) + 1));
}

function exactColumn(columns: string[], candidates: string[]) {
  return columns.find((column) => candidates.includes(normalized(column)))
    || columns.find((column) => {
      const words = normalized(column).split(" ");
      return candidates.some((candidate) => words.includes(candidate));
    });
}

export function inferWideTimeSeriesMetricColumns(
  worksheet: Pick<SpreadsheetWorksheet, "columns"> & Partial<Pick<SpreadsheetWorksheet, "rows">>,
  periodColumn = exactColumn(worksheet.columns, PERIOD_COLUMNS)
) {
  if (!periodColumn) return [];
  const candidates = worksheet.columns.filter((column) => column !== periodColumn);
  const rows = worksheet.rows || [];

  if (!rows.length) {
    return candidates.filter((column) => !ENTITY_IDENTITY_COLUMNS.includes(normalized(column)));
  }

  return candidates.filter((column) => {
    const populated = rows.map((row) => row.values[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
    if (!populated.length) return false;
    return populated.filter((value) => parseWorksheetNumber(value) !== null).length / populated.length >= 0.5;
  });
}

export function wideTimeSeriesTargetColumn(metricColumn: string, columns: string[]) {
  const metric = normalized(metricColumn);
  if (metric.startsWith("target ") || metric.endsWith(" target")) return null;
  return columns.find((column) => {
    const candidate = normalized(column);
    return candidate === `target ${metric}` || candidate === `${metric} target`;
  }) || null;
}

export function evaluateWideTimeSeriesCells(values: Record<string, unknown>, metricColumns: string[]) {
  const metrics: Array<{ column: string; value: number }> = [];
  const invalidColumns: string[] = [];
  for (const column of metricColumns) {
    const rawValue = values[column];
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") continue;
    const value = parseWorksheetNumber(rawValue);
    if (value === null) invalidColumns.push(column);
    else metrics.push({ column, value });
  }
  return { metrics, invalidColumns };
}

export function isWideTimeSeriesWorksheet(
  worksheet: Pick<SpreadsheetWorksheet, "columns"> & Partial<Pick<SpreadsheetWorksheet, "rows">>
) {
  const periodColumn = exactColumn(worksheet.columns, PERIOD_COLUMNS);
  if (!periodColumn) return false;
  if (worksheet.columns.some((column) => ENTITY_IDENTITY_COLUMNS.includes(normalized(column)))) return false;
  const rows = worksheet.rows || [];
  if (rows.length) {
    const populatedPeriods = rows
      .map((row) => row.values[periodColumn])
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
    const parsedPeriods = populatedPeriods.map(parseWorksheetPeriod).filter(Boolean);
    if (!populatedPeriods.length || parsedPeriods.length / populatedPeriods.length < 0.5) {
      return false;
    }
    if (parsedPeriods.every((period) => period?.startsWith("month:"))) {
      const monthOnlyValues = populatedPeriods.filter((value) => monthOnlyNumber(value) !== null);
      if (!isRecognizableMonthSequence(monthOnlyValues)) return false;
    }
  }
  return inferWideTimeSeriesMetricColumns(worksheet, periodColumn).length >= 2;
}

function isInventoryWorksheet(name: string, columns: string[]) {
  const normalizedColumns = columns.map(normalized);
  const hasIdentity = normalizedColumns.some((column) => [
    "sku",
    "item",
    "item id",
    "item name",
    "inventory item",
    "inventory id",
    "product",
    "product id",
    "product name"
  ].includes(column));
  if (!hasIdentity) return false;

  const hasInventoryStructure = normalizedColumns.some((column) => [
    "on hand",
    "reorder point",
    "stock",
    "stock level",
    "quantity",
    "qty",
    "supplier",
    "supplier id"
  ].includes(column));
  return name.includes("inventory") || hasInventoryStructure;
}

export function worksheetTypeLabel(type: WorksheetType) {
  return WORKSHEET_CONTEXT_LABELS[type] || "Unknown / Context Only";
}

export function isWorksheetType(value: string): value is WorksheetType {
  return WORKSHEET_TYPE_OPTIONS.some((option) => option.value === value);
}

export function detectWorksheetType(
  worksheet: Pick<SpreadsheetWorksheet, "name" | "columns"> & Partial<Pick<SpreadsheetWorksheet, "rows">>
): WorksheetType {
  const name = normalized(worksheet.name);
  const columns = normalized(worksheet.columns.join(" "));
  const combined = `${name} ${columns}`;

  if (includesAny(combined, ["company profile", "company context", "business profile"])) return "company_profile";
  if (isWideTimeSeriesWorksheet(worksheet)) return "wide_time_series";
  if (isInventoryWorksheet(name, worksheet.columns)) return "inventory";
  if (includesAny(combined, ["customer feedback", "customer rating", "customer satisfaction", "support feedback"])) return "customers";
  if (includesAny(combined, ["employee", "employees", "overtime hours", "training hours", "headcount"])) return "employees";
  if (includesAny(combined, ["supplier invoice", "vendor invoice", "invoices", "accounts payable", "financial", "profit and loss", "expenses"])) return "financials";
  if (includesAny(combined, ["marketing", "campaign", "impressions", "conversions", "ad spend"])) return "marketing";
  if (includesAny(combined, ["orders", "order status", "days to deliver", "shipments"])) return "orders";
  const kpiCandidate = includesAny(combined, ["kpi", "scorecard", "performance"])
    || name.includes("monthly sales")
    || (columns.includes("target") && includesAny(columns, ["actual", "revenue", "value"]));
  const kpiMapping = kpiCandidate ? inferWorksheetMapping("kpis", worksheet.columns) : {};
  if (kpiCandidate && kpiMapping.name && kpiMapping.actual_value) return "kpis";
  if (includesAny(combined, ["sales", "revenue", "transactions", "average basket"])) return "sales";
  if (includesAny(combined, ["vendor", "supplier", "lead time", "procurement"])) return "vendors";
  if (includesAny(combined, ["customer", "account", "retention", "churn"])) return "customers";
  return "unknown";
}

export function inferWorksheetMapping(type: WorksheetType, columns: string[]): WorksheetMapping {
  if (type === "company_profile" && columns.length >= 2) {
    return { label: columns[0], value: columns[1] };
  }

  return WORKSHEET_IMPORT_FIELDS[type].reduce<WorksheetMapping>((mapping, field) => {
    const candidates = field.candidates.map(normalized);
    const exact = columns.find((column) => candidates.includes(normalized(column)));
    const loose = columns.find((column) => candidates.some((candidate) => normalized(column).includes(candidate)));
    const match = exact || loose;
    if (match) mapping[field.key] = match;
    return mapping;
  }, {});
}
