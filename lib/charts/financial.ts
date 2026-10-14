import { calculateFinancials, type FinancialReport } from "@/lib/vsi/financial-calculations";
import { parseComparisons, type Comparison } from "./comparison";

/** Called only with reports admitted by the authorized financial retrieval path. */
export function financialComparisons(reports: FinancialReport[]): Comparison[] {
  const result = calculateFinancials(reports);
  if (result.comparison.reason) return [];
  const [after, before] = [...reports].sort((a, b) => (b.periodEnd || "").localeCompare(a.periodEnd || ""));
  const titles: Record<string, string> = { revenue: "Revenue", operatingExpenses: "Operating expenses", netIncome: "Net income" };
  return parseComparisons([...result.comparison.changes].sort((a,b) => ["revenue", "netIncome", "operatingExpenses"].indexOf(a.category) - ["revenue", "netIncome", "operatingExpenses"].indexOf(b.category)).flatMap(change => {
    if (!titles[change.category] || !change.previous || !change.current || change.change === null) return [];
    return [{ version: 1, id: `${after.sourceId}:${change.category}`, title: titles[change.category], unit: "", currency: after.currency,
      before: { label: "Prior", value: Number(change.previous.amount), context: `${before.periodStart} – ${before.periodEnd}` },
      after: { label: "Latest", value: Number(change.current.amount), context: `${after.periodStart} – ${after.periodEnd}` },
      kind: "period", direction: change.category === "operatingExpenses" ? "neutral" : "maximize",
      context: `${after.entity} · ${after.currency} · ${after.basis} · ${before.periodStart}–${before.periodEnd} → ${after.periodStart}–${after.periodEnd}`,
      limitations: ["Reported P&L values; profit is not cash flow. Coverage and reconciliation are not established.", ...(before.stale || after.stale ? ["Includes a stale saved observation."] : [])],
      sources: [{ label: `Prior P&L · row ${change.previous.row}`, href: before.url }, { label: `Latest P&L · row ${change.current.row}`, href: after.url }] }];
  }));
}
