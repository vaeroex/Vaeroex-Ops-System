import type { QboBrowser } from "@/lib/integrations/qbo-customer/contracts";

export type FinancialReport = { sourceId: string; connectionId: string; entity: string; url: string; periodStart: string | null; periodEnd: string | null;
  currency: string | null; basis: string; observedAt: string; synchronizedAt: string; stale: boolean; truncated: boolean;
  rows: { row: number; depth: number; kind: string; path: string[]; label: string; amount: string | null }[];
  totals: Record<string, { amount: string; row: number }>; limitations: string[] };
const scale = BigInt(1_000_000);
function decimal(value: string | null): bigint | null {
  if (value === null || !/^-?\d{1,15}(?:\.\d{1,6})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(/^-/, "").split(".");
  return (BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"))) * (value.trim().startsWith("-") ? -BigInt(1) : BigInt(1));
}
function rounded(value: bigint, divisor = BigInt(10_000)) {
  const absolute = value < BigInt(0) ? -value : value;
  const cents = (absolute + divisor / BigInt(2)) / divisor;
  return `${value < BigInt(0) && cents ? "-" : ""}${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
const names: Record<string, RegExp> = {
  revenue: /^(total (income|revenue|sales)|net sales)$/i,
  costOfGoodsSold: /^(total (cost of goods sold|cost of sales|cogs))$/i,
  grossProfit: /^gross profit$/i,
  operatingExpenses: /^total (expenses|operating expenses)$/i,
  netIncome: /^net income$/i
};
const sections: Record<string, RegExp> = {
  revenue: /^(income|revenue|sales)$/i, costOfGoodsSold: /^(cost of goods sold|cost of sales|cogs)$/i,
  operatingExpenses: /^(expenses|operating expenses)$/i
};
/** Preserve report rows verbatim. Explicit totals only; never sum parents and children. */
export function financialReport(browser: QboBrowser, url: string, stale: boolean): FinancialReport | null {
  const detail = browser.detail, source = detail?.source, preview = detail?.value;
  if (!source || !preview || preview.kind !== "report" || preview.reportType !== "ProfitAndLoss" || !browser.connectionId) return null;
  const limitations: string[] = [];
  const columns = preview.columns;
  const supported = columns.length === 2 && /^(account|distribution account)$/i.test(columns[0].title || "")
    && /^(total|amount|[A-Z]{3})$/i.test(columns[1].title || "");
  if (!supported) limitations.push("Unsupported or ambiguous report columns; no numeric interpretation or calculations.");
  const parents: string[] = [];
  const rows = preview.rows.map((row, index) => {
    const label = row.cells.find(cell => cell.columnKey === columns[0]?.columnKey)?.value || "Unlabelled row";
    parents.length = Math.min(parents.length, row.depth);
    const path = [...parents, label];
    if (row.rowType === "section") parents[row.depth] = label;
    const raw = supported ? row.cells.find(cell => cell.columnKey === columns[1]?.columnKey)?.value ?? null : null;
    return { row: index + 1, depth: row.depth, kind: row.rowType, path, label, amount: decimal(raw) === null ? null : raw };
  });
  const totals: FinancialReport["totals"] = {};
  // QBO emits report-level totals such as GrossProfit/NetIncome as a Section
  // with only Summary (no Header or Rows). Preserve the provider rows and their
  // citation numbers, but treat that single empty wrapper as report scope.
  // Do not promote a named account, nested section, or multi-child subtotal.
  const isReportSummaryWrapper = (row: FinancialReport["rows"][number]) => {
    if (row.depth !== 1 || row.kind !== "summary") return false;
    const parent = preview.rows[row.row - 2], following = preview.rows[row.row];
    return parent?.rowType === "section" && parent.depth === 0
      && parent.cells.every(cell => cell.value === null || cell.value.trim() === "")
      && (!following || following.depth === 0);
  };
  if (!preview.truncated && supported) for (const [key, name] of Object.entries(names)) {
    const matching = rows.filter(row => name.test(row.label) && row.amount !== null
      && (row.path.length === 1 || row.path.length === 2 && sections[key]?.test(row.path[0])
        || isReportSummaryWrapper(row)) && row.kind === "summary");
    if (matching.length === 1) totals[key] = { amount: matching[0].amount!, row: matching[0].row };
    else limitations.push(`${key}: ${matching.length ? "ambiguous reported totals" : "no supported reported total"}; not treated as zero.`);
  }
  if (preview.truncated) limitations.push("Truncated report; totals, ratios and comparisons are unavailable.");
  return { sourceId: source.sourceId, connectionId: browser.connectionId,
    entity: browser.connections.find(row => row.connectionId === browser.connectionId)?.entityLabel || "Unknown entity", url,
    periodStart: source.periodStart, periodEnd: source.periodEnd, currency: source.currency, basis: source.accountingBasis,
    observedAt: source.observedAt, synchronizedAt: source.synchronizedAt, stale, truncated: preview.truncated,
    rows, totals, limitations };
}
function ratio(numerator: bigint | null, denominator: bigint | null) {
  if (numerator === null || denominator === null) return { value: null, reason: "Missing supported input; not zero." };
  if (denominator <= BigInt(0)) return { value: null, reason: "Zero or negative denominator; percentage is not meaningful." };
  return { value: rounded(numerator * BigInt(1_000_000) / denominator, BigInt(100)), unit: "percent" };
}
const amount = (report: FinancialReport, key: string) => decimal(report.totals[key]?.amount ?? null);
function periodDays(report: FinancialReport) {
  if (!report.periodStart || !report.periodEnd) return null;
  const start = Date.parse(report.periodStart), end = Date.parse(report.periodEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 86_400_000 + 1 : null;
}
function fullMonth(report: FinancialReport) {
  if (!report.periodStart || !report.periodEnd) return false;
  const start = new Date(report.periodStart), end = new Date(report.periodEnd);
  return start.getUTCDate() === 1 && start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()
    && end.getUTCDate() === new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
}
export function calculateFinancials(reports: FinancialReport[]) {
  const margins = reports.map(report => {
    const scopeReason = report.truncated || !periodDays(report) || !report.currency || !["cash", "accrual"].includes(report.basis)
      ? "Incomplete report, reporting period, currency or accounting basis; ratio unavailable." : null;
    const scopedRatio = (key: string) => scopeReason ? { value: null, reason: scopeReason } : ratio(amount(report, key), amount(report, "revenue"));
    return { sourceId: report.sourceId, url: report.url, period: [report.periodStart, report.periodEnd],
    stale: report.stale, currency: report.currency, accountingBasis: report.basis,
    inputs: report.totals, grossMargin: scopedRatio("grossProfit"), netMargin: scopedRatio("netIncome"),
    costRatio: scopedRatio("costOfGoodsSold"), operatingExpenseRatio: scopedRatio("operatingExpenses") };
  });
  const ordered = [...reports].sort((a, b) => (b.periodEnd || "").localeCompare(a.periodEnd || ""));
  const [current, previous] = ordered;
  let reason: string | null = null;
  if (!current || !previous) reason = "Two eligible reports are required for a comparison.";
  else if (current.connectionId !== previous.connectionId || current.entity !== previous.entity) reason = "Different entities or connections; no combined comparison.";
  else if (!current.currency || current.currency !== previous.currency) reason = "Missing or different currencies; no conversion assumed.";
  else if (!["cash", "accrual"].includes(current.basis) || current.basis !== previous.basis) reason = "Missing or different accounting bases; cash and accrual cannot be compared.";
  else if (current.truncated || previous.truncated) reason = "Incomplete report projection.";
  else if (!periodDays(current) || !periodDays(previous) || previous.periodEnd! >= current.periodStart!
    || !(periodDays(current) === periodDays(previous) || fullMonth(current) && fullMonth(previous))) reason = "Overlapping, missing or unlike reporting periods; comparison unavailable.";
  const changes = !reason && current && previous ? Object.keys(names).map(key => {
    const before = amount(previous, key), after = amount(current, key);
    return { category: key, previous: previous.totals[key] ?? null, current: current.totals[key] ?? null,
      change: before === null || after === null ? null : rounded(after - before), percentChange: ratio(before === null || after === null ? null : after - before, before) };
  }) : [];
  const lineChanges = !reason && current && previous ? current.rows.filter(row => row.kind === "data").flatMap(row => {
    const matches = previous.rows.filter(old => old.kind === "data" && JSON.stringify(old.path) === JSON.stringify(row.path));
    const currentMatches = current.rows.filter(candidate => candidate.kind === "data" && JSON.stringify(candidate.path) === JSON.stringify(row.path));
    const a = currentMatches.length === 1 ? decimal(row.amount) : null, b = matches.length === 1 ? decimal(matches[0].amount) : null;
    if (a === null || b === null) return [];
    return [{ path: row.path, previousRow: matches[0].row, currentRow: row.row, previous: matches[0].amount, current: row.amount, change: rounded(a - b), previousPercentOfRevenue: ratio(b, amount(previous, "revenue")), currentPercentOfRevenue: ratio(a, amount(current, "revenue")) }];
  }) : [];
  const marginChanges = !reason && current && previous ? ["grossProfit", "netIncome"].map(key => {
    const a = amount(current, key), b = amount(previous, key), ca = amount(current, "revenue"), cb = amount(previous, "revenue");
    return { category: key, percentagePoints: a !== null && b !== null && ca !== null && cb !== null && ca > BigInt(0) && cb > BigInt(0)
      ? rounded((a * cb - b * ca) * scale / (ca * cb), BigInt(100)) : null };
  }) : [];
  return { method: "Application decimal calculations v1; money rounded to 2 decimals, percentages to 2 decimals. Reported totals only; no missing-input substitution.",
    margins, comparison: { reason, inputs: current && previous ? [previous.url, current.url] : [], changes, marginChanges, lineChanges },
    limitations: ["P&L profit is not cash flow. Report coverage and reconciliation remain unknown.", "Do not add Square payments, spreadsheet sales or uploaded sales to overlapping QuickBooks revenue.",
      "Line changes are not automatically an exhaustive profit bridge. Do not sum parent totals and constituent rows.", "Dish, SKU, location and channel profitability require matching costs and an allocation basis; not established here."] };
}
