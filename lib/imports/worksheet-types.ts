import type { SpreadsheetWorksheet } from "@/lib/imports/spreadsheets";

export type WorksheetType =
  | "company_profile"
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

export function worksheetTypeLabel(type: WorksheetType) {
  return WORKSHEET_CONTEXT_LABELS[type] || "Unknown / Context Only";
}

export function isWorksheetType(value: string): value is WorksheetType {
  return WORKSHEET_TYPE_OPTIONS.some((option) => option.value === value);
}

export function detectWorksheetType(worksheet: Pick<SpreadsheetWorksheet, "name" | "columns">): WorksheetType {
  const name = normalized(worksheet.name);
  const columns = normalized(worksheet.columns.join(" "));
  const combined = `${name} ${columns}`;

  if (includesAny(combined, ["company profile", "company context", "business profile"])) return "company_profile";
  if (includesAny(combined, ["inventory", "on hand", "reorder point", "stock level", "sku"])) return "inventory";
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
