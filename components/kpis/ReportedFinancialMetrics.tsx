import Link from "next/link";
import type { Route } from "next";
import type { reportedFinancialMetrics } from "@/lib/integrations/qbo-customer/reported-financial-metrics";
import type { QboJournalPeriod } from "@/lib/integrations/qbo-customer/journal-accounting";

const labels: Record<string, string> = {
  revenue: "Revenue", costOfGoodsSold: "Cost of goods sold", grossProfit: "Gross profit",
  operatingExpenses: "Operating expenses", netIncome: "Net income"
};

export function ReportedFinancialMetricsView({ groups, limitations, journals = [] }: {
  groups: ReturnType<typeof reportedFinancialMetrics>; limitations: readonly string[];
  journals?: readonly QboJournalPeriod[];
}) {
  if (!groups.length) return null;
  return <section aria-labelledby="reported-financial-heading" className="rounded-xl border border-white/10 bg-slate-950/40 p-5">
    <h2 id="reported-financial-heading" className="text-lg font-semibold text-white">Reported P&amp;L metrics</h2>
    <p className="mt-2 text-sm text-slate-300">Saved accounting reports, shown separately from tracked KPIs. Revenue is not added to overlapping POS or other sales records. Report coverage and reconciliation are unverified; profit is not cash flow.</p>
    {journals.length ? <div className="mt-5 space-y-3"><h3 className="font-semibold text-white">Validated journal subtotals</h3>
      <p className="text-sm text-slate-300">Computed from admitted journal entries. These may cover only part of the ledger and are not added to the reported totals below.</p>
      {journals.map(p => <div key={p.receiptHash} className="rounded border border-cyan-300/20 p-3">
        <Link className="text-sm text-cyan-200 underline" href={(`/app/intelligence/briefings/financial?connectionId=${p.connectionId}&from=${p.periodStart}&to=${p.periodEnd}`) as Route}>{p.periodStart} – {p.periodEnd}: inspect contributing journals</Link>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{[["Revenue",p.recognizedRevenue],["Cost of goods sold",p.costOfGoodsSold],["Labor",p.labor],["Other operating costs",p.otherOperatingCosts],["Operating profit",p.operatingProfit]].map(([label,value]) => <div key={label}><dt className="text-slate-400">{label}</dt><dd>{p.currency} {value}</dd></div>)}</dl>
        <p className="mt-2 text-xs text-slate-400">{p.coverage.limitation}</p>
      </div>)}
    </div> : null}
    {groups.map(({ reports, calculations }) => <div key={reports[0].sourceId} className="mt-5 space-y-3">
      <h3 className="font-medium text-white">{reports[0].entity} · {reports[0].currency || "Currency unavailable"} · {reports[0].basis} basis</h3>
      {reports.map(report => <div key={report.sourceId} className="rounded-lg border border-white/10 p-3">
        <Link href={report.url as Route} className="text-sm text-cyan-200 underline">{report.periodStart} – {report.periodEnd}: inspect source report</Link>
        <p className="mt-2 text-sm"><Link className="text-cyan-200 underline" href={(`/app/intelligence/briefings/financial?connectionId=${report.connectionId}&from=${report.periodStart}&to=${report.periodEnd}`) as Route}>Inspect journal subtotals and private financial briefing</Link></p>
        {report.stale ? <p className="text-sm text-amber-200">Saved report is stale.</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-slate-400">{label}</dt><dd className="text-white">{report.totals[key] ? `${report.currency || ""} ${report.totals[key].amount}` : "Unavailable"}</dd></div>)}
          {calculations.margins.filter(row => row.sourceId === report.sourceId).map(row => <div key="margin"><dt className="text-slate-400">Net margin</dt><dd className="text-white">{row.netMargin.value === null ? "Unavailable" : `${row.netMargin.value}%`}</dd></div>)}
        </dl>
        {report.limitations.length ? <p className="mt-3 text-xs text-slate-400">{report.limitations.join(" ")}</p> : null}
      </div>)}
      {calculations.comparison.reason ? <p className="text-sm text-slate-300">{calculations.comparison.reason}</p> : <p className="text-sm text-slate-300">Net income change: {calculations.comparison.changes.find(change => change.category === "netIncome")?.change ?? "unavailable"} {reports[0].currency}. Inspect the source reports for the compared periods.</p>}
    </div>)}
    <p className="mt-4 text-xs text-slate-400">These reports do not establish an overall Business Health score or team labor and inventory coverage. Source links show the current stored report, which may change after a new import.</p>
    {limitations.length ? <p className="mt-2 text-xs text-slate-400">{limitations.join(" ")}</p> : null}
  </section>;
}

