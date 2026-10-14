// Fictional accounting observations for isolated VSI qualification only. Never used by website builds.
import { metrics } from "./data";
export const financialQuestion = "Sales have increased, but are we keeping more of that money? What changed in our costs and profitability, and what should I focus on next?";
export const financialHistory = [
  { start: "2026-09-29", end: "2026-10-05", index: -2, otherExpenses: 1800 },
  { start: "2026-10-06", end: "2026-10-12", index: -1, otherExpenses: 2400 }
].map(period => {
  const sales = metrics[0].values.at(period.index)!;
  const cogs = Math.round(sales * (100 - metrics[1].values.at(period.index)!)) / 100;
  const labor = Math.round(sales * metrics[2].values.at(period.index)!) / 100;
  const gross = sales - cogs, expenses = labor + period.otherExpenses;
  const cells = (label: string, amount: number | null) => [{ columnKey: "label", value: label, id: null },
    { columnKey: "amount", value: amount === null ? null : amount.toFixed(2), id: null }];
  const leaf = (label: string, amount: number, rowType = "data") => ({ rowType, group: null, cells: cells(label, amount), children: [] });
  const section = (label: string, group: string, detail: ReturnType<typeof leaf>[], total: number) => ({ rowType: "section", group, cells: cells(label, null),
    children: [...detail, leaf(`Total ${label}`, total, "summary")] });
  return { ...period, sales, cogs, labor, gross, expenses, net: gross - expenses,
    projection: { contractVersion: "qbo_report_control_observation_v1", reportType: "ProfitAndLoss", reportBasis: "accrual", sourceCurrency: "USD",
      periodStart: period.start, periodEnd: period.end,
      columns: [{ columnKey: "label", title: "Account", type: "Account" }, { columnKey: "amount", title: "Total", type: "Money" }],
      rows: [section("Income", "Income", [leaf("Food and beverage sales", sales)], sales),
        section("Cost of Goods Sold", "COGS", [leaf("Food and beverage cost", cogs)], cogs), leaf("Gross Profit", gross, "summary"),
        section("Expenses", "Expenses", [leaf("Labor expense", labor), leaf("Other operating expenses", period.otherExpenses)], expenses), leaf("Net Income", gross - expenses, "summary")],
      contributionFamily: "control_observation", additive: false, parserVersion: "qbo_report_parser_v1",
      provider: { providerKey: "quickbooks_online", sourceEnvironment: "production", realmId: "synthetic-production-realm-a" } }
  };
});
