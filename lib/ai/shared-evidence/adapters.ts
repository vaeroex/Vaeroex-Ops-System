import { z } from "zod";
import { contextSchema, daySchema, decimalSchema, instantSchema, observation, parsed,
  type ParseContext, type ParsedEvidence, type PluginProvider } from "./contracts";

const count = z.number().int().nonnegative().safe();
const metric = z.object({ key: z.string(), value: decimalSchema, currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict();
const history = z.object({ hasHistory: z.boolean(), metrics: z.array(metric).max(100), records: count,
  coverage: z.object({ days: count, completeDays: count, incompleteDays: count, coveredThrough: instantSchema.nullable(),
    startDate: daySchema.nullable(), endDate: daySchema.nullable(), lastImportedAt: instantSchema.nullable() }).strict() }).strict();
const snapshot = z.object({ start: instantSchema, end: instantSchema, metrics: z.array(metric).max(20) }).strict();
const historyKeys = { xero: ["invoices", "billed", "outstanding", "bills", "purchases"],
  harvest: ["entries", "hours", "billable_hours", "running"], clockify: ["entries", "hours", "billable_hours", "running"] };
const snapshotKeys = { "zoho-inventory": ["items", "low_stock"], toggl: ["projects", "hours"], katana: ["stock_rows", "unavailable"] };
function days(context: ParseContext) { return (Date.parse(context.end) - Date.parse(context.start)) / 86_400_000 + 1; }
function boundedCoverage(context: ParseContext, covered: number, complete: number, first?: string | null, last?: string | null): ParseContext {
  if (complete > covered || covered > days(context) || first && first < context.start || last && last > context.end) throw new Error("invalid_coverage");
  return { ...context, coverage: context.coverage === "complete" && covered === days(context) && complete === covered ? "complete" : "partial" };
}

/** Parse the existing stored read_reporting_history response, never a provider request. */
export function parseReportingHistory(provider: keyof typeof historyKeys, raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = history.parse(raw);
  if (report.coverage.completeDays + report.coverage.incompleteDays !== report.coverage.days) throw new Error("invalid_coverage");
  const scoped = boundedCoverage(context, report.coverage.days, report.coverage.completeDays, report.coverage.startDate, report.coverage.endDate);
  if (!report.hasHistory || !report.coverage.days) return parsed(provider, { ...scoped, coverage: "unknown" }, [], ["No imported coverage; missing is not zero."]);
  const rows = report.metrics.map(row => {
    if (!historyKeys[provider].includes(row.key) || (provider === "xero") !== Boolean(row.currency)) throw new Error("invalid_metric");
    const monetary = ["billed", "outstanding", "purchases"].includes(row.key);
    const unit = monetary ? "currency" : row.key.includes("hours") ? "hours" : "count";
    if (Number(row.value) < 0 || unit === "count" && !Number.isSafeInteger(Number(row.value))) throw new Error("invalid_metric_value");
    return observation(provider, scoped, row.key, row.value, unit,
      provider === "xero" ? "invoice_or_bill_date" : provider === "clockify" ? "own_entries_utc_start" : "visible_entries_spent_date",
      row.key === "outstanding" ? "snapshot" : "period", monetary ? row.currency! : null, row.currency ?? null);
  });
  return parsed(provider, scoped, rows, [provider === "xero"
    ? "Invoices are not recognized revenue; outstanding is the balance when imported, not a historical balance."
    : provider === "clockify" ? "Connected user's completed time only; not team payroll or labor cost."
      : "Visible completed time depends on connected-user permissions; not payroll or a staffing schedule."]);
}

export function parseReportingSnapshot(provider: keyof typeof snapshotKeys, raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = snapshot.parse(raw);
  if (Date.parse(report.start) > Date.parse(report.end) || Date.parse(report.end) > Date.parse(context.observedAt)) throw new Error("invalid_snapshot_time");
  const scoped = { ...context, timeZone: "UTC", coverage: "snapshot" as const,
    start: new Date(report.start).toISOString().slice(0, 10), end: new Date(report.end).toISOString().slice(0, 10) };
  const rows = report.metrics.map(row => {
    if (!snapshotKeys[provider].includes(row.key) || row.currency) throw new Error("invalid_metric");
    if (Number(row.value) < 0 || row.key !== "hours" && !Number.isSafeInteger(Number(row.value))) throw new Error("invalid_metric_value");
    return observation(provider, scoped, row.key, row.value, row.key === "hours" ? "hours" : "count",
      provider === "toggl" ? "visible_active_projects" : "inventory_snapshot", provider === "toggl" && row.key === "hours" ? "lifetime" : "snapshot", null);
  });
  return parsed(provider, scoped, rows, [provider === "toggl" ? "Hours are lifetime totals of visible active projects, not this week's timesheet."
    : "Current counts only; item-level movement, valuation and historical trends are unavailable."]);
}

const loyverse = z.object({ sales: decimalSchema, refunds: decimalSchema, receipts: count, unknown_date_receipts: count,
  first_day: daySchema.nullable(), last_day: daySchema.nullable(), covered_days: count, complete_days: count,
  covered_through: instantSchema.nullable(), requested_days: count }).strict();
const zoho = z.object({ invoice_count: count, invoice_total: decimalSchema, outstanding_total: decimalSchema,
  expense_count: count, expense_total: decimalSchema, excluded_foreign_count: count,
  covered_days: count, complete_days: count, incomplete_days: count, latest_covered_through: instantSchema.nullable(),
  start: daySchema.nullable(), end: daySchema.nullable(), missing_days: count,
  legacy: z.object({ days: count, start: daySchema.nullable(), end: daySchema.nullable(), invoice_total: decimalSchema.nullable(),
    expense_total: decimalSchema.nullable(), outstanding_total: decimalSchema.nullable() }).strict() }).strict();
const wix = z.object({ totals: z.array(z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), order_count: count,
  total_amount: decimalSchema, paid_count: count }).strict()).max(20),
  coverage: z.array(z.object({ start_date: daySchema, end_date: daySchema, imported_through: instantSchema, complete: z.boolean() }).strict()).max(366),
  covered_days: count, complete_days: count, requested_days: count.nullable() }).strict();

export function parseLoyverse(raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = loyverse.parse(raw);
  const scoped = boundedCoverage(context, report.covered_days, report.complete_days, report.first_day, report.last_day);
  if (report.requested_days !== days(context)) throw new Error("invalid_coverage");
  if (!report.covered_days) return parsed("loyverse", { ...scoped, coverage: "unknown" }, [], ["No completed import; missing is not zero."]);
  const rows = [observation("loyverse", scoped, "receipts", report.receipts, "count", "server_creation_date", "period", null)];
  if (context.currency) for (const key of ["sales", "refunds"] as const) rows.push(observation("loyverse", scoped, key, report[key], "currency", "server_creation_date"));
  return parsed("loyverse", scoped, rows, ["Creation dates select imported receipts; backdated receipt dates differ. Sales and refunds remain separate.",
    ...(!context.currency ? ["Verified merchant currency is missing; monetary values excluded."] : []),
    ...(report.unknown_date_receipts ? ["Legacy receipts lack verified creation-date coverage."] : [])]);
}
export function parseZohoBooks(raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = zoho.parse(raw);
  const scoped = boundedCoverage(context, report.covered_days, report.complete_days, report.start, report.end);
  if (report.incomplete_days + report.complete_days !== report.covered_days || report.missing_days !== days(context) - report.covered_days) throw new Error("invalid_coverage");
  if (!report.covered_days) return parsed("zoho-books", { ...scoped, coverage: "unknown" }, [], ["No verified import coverage."]);
  const rows = (["invoice_total", "expense_total", "outstanding_total"] as const).map(key =>
    observation("zoho-books", scoped, key, report[key], "currency", "invoice_or_expense_date", key === "outstanding_total" ? "snapshot" : "period", "USD"));
  return parsed("zoho-books", scoped, rows, ["USD only. Billed amounts are not cash received or recognized revenue; these totals do not establish profit.",
    "Outstanding is observed on import. Legacy summaries are excluded from these totals."]);
}
export function parseWixOrders(raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = wix.parse(raw);
  if (report.requested_days !== days(context)) throw new Error("invalid_coverage");
  const scoped = boundedCoverage(context, report.covered_days, report.complete_days);
  let coveredDays = 0, completeDays = 0, previousEnd: string | null = null;
  for (const range of [...report.coverage].sort((left, right) => left.start_date.localeCompare(right.start_date))) {
    if (range.start_date > range.end_date || range.start_date < context.start || range.end_date > context.end
      || Date.parse(range.imported_through) > Date.parse(context.observedAt)) throw new Error("invalid_coverage");
    if (range.complete && Date.parse(range.imported_through) < Date.parse(range.end_date) + 86_400_000) throw new Error("invalid_coverage");
    if (previousEnd && range.start_date <= previousEnd) throw new Error("invalid_coverage");
    const rangeDays = (Date.parse(range.end_date) - Date.parse(range.start_date)) / 86_400_000 + 1;
    coveredDays += rangeDays; if (range.complete) completeDays += rangeDays;
    previousEnd = range.end_date;
  }
  if (coveredDays !== report.covered_days || completeDays !== report.complete_days) throw new Error("invalid_coverage");
  if (!report.covered_days) return parsed("wix-orders", { ...scoped, coverage: "unknown" }, [], ["No verified import coverage; legacy order totals omitted."]);
  return parsed("wix-orders", scoped, report.totals.flatMap(row => {
    if (row.paid_count > row.order_count) throw new Error("invalid_order_count");
    return [observation("wix-orders", scoped, "order_total", row.total_amount, "currency", "approved_order_date", "period", row.currency_code)];
  }), ["Order values are not net deposits, settlements or accounting revenue. Refund transactions are not included."]);
}

// Source-specific projections below consume existing validated reader outputs,
// not arbitrary raw provider objects. Their runtime readers remain unchanged.
const namedMetric = z.object({ metric: z.string().min(1).max(80), value: decimalSchema, unit: z.string().min(1).max(40) }).strict();
export function parseCanonicalMetrics(provider: "google_sheets" | "file", raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), rows = z.array(namedMetric).min(1).max(100).parse(raw);
  return parsed(provider, context, rows.map(row => observation(provider, context, row.metric, row.value, row.unit, "approved_measured_fact", "period", row.unit === "currency" ? context.currency : null)),
    ["Current mapping or extraction authority must be independently verified before admission."]);
}
const financial = z.object({ basis: z.enum(["cash", "accrual"]), truncated: z.literal(false),
  totals: z.record(z.string(), decimalSchema) }).strict();
export function parseQuickBooksTotals(raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), report = financial.parse(raw);
  const allowed = ["revenue", "costOfGoodsSold", "grossProfit", "operatingExpenses", "netIncome"];
  if (!context.currency || Object.keys(report.totals).some(key => !allowed.includes(key))) throw new Error("invalid_financial_scope");
  return parsed("quickbooks_online", context, Object.entries(report.totals).map(([key, value]) =>
    observation("quickbooks_online", context, key, value, "currency", report.basis)), ["Stored P&L totals; never add overlapping payment, order or invoice totals."]);
}
const payments = z.array(z.object({ id: z.string().min(1).max(160), amount: decimalSchema,
  currency: z.string().regex(/^[A-Z]{3}$/), status: z.literal("COMPLETED") }).strict()).max(1000);
export function parseSquarePayments(raw: unknown, input: ParseContext): ParsedEvidence {
  const context = contextSchema.parse(input), rows = payments.parse(raw);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("duplicate_payment");
  // Preserve records; aggregation requires a separately proven complete interval.
  return parsed("square", context, rows.map(row => observation("square", { ...context, sourceId: row.id }, "completed_payment_amount", row.amount,
    "currency", "payment_date", "period", row.currency)), ["Completed payments are not posted revenue or settlements; pagination alone does not establish full import coverage."]);
}

export const adapterInventory: Record<PluginProvider, string> = {
  google_sheets: "approved canonical metrics", quickbooks_online: "validated P&L total projection", square: "validated completed-payment projection",
  loyverse: "loyverse_saved_report", "zoho-books": "read_zoho_books_history", "wix-orders": "wix_order_history_report",
  xero: "read_reporting_history", harvest: "read_reporting_history", clockify: "read_reporting_history",
  toggl: "validated reporting snapshot", "zoho-inventory": "validated reporting snapshot", katana: "validated reporting snapshot"
};
