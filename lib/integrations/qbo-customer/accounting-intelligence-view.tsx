import Link from "next/link";
import { qboBrowseHref } from "./contracts";
import type { QboAccountingIntelligenceLoad } from "./accounting-intelligence-server";

export function QboAccountingIntelligenceView({ result }: { result: QboAccountingIntelligenceLoad }) {
  if (result.state === "hidden") return null;
  if (result.state === "unavailable") return <section aria-label="QuickBooks accounting" className="border-t border-white/10 py-4 text-sm text-slate-300">
    QuickBooks accounting summary unavailable. No subtotal is shown.
  </section>;
  if (!result.data.summaries.length) return null;
  return <section aria-labelledby="qbo-admitted-subtotal-heading" className="min-w-0 space-y-4 border-t border-white/10 py-4">
    <div>
      <h2 id="qbo-admitted-subtotal-heading" className="text-lg font-semibold text-white">QuickBooks admitted posted revenue subtotal</h2>
      <p className="mt-1 text-sm text-slate-300">Partial coverage. Accrual contributions only, not total posted revenue. Reports are non-additive controls; Square payments are not combined.</p>
    </div>
    {result.connectionsTruncated ? <p className="text-sm text-amber-200">Connection coverage is limited; additional connections are not represented.</p> : null}
    {result.data.summaries.map((summary) => <div key={summary.connectionId} className="min-w-0 space-y-2 border-t border-white/10 pt-4">
      <h3 className="break-words text-base font-semibold text-white">{summary.businessEntityName}</h3>
      <p className="break-words text-xs text-slate-400">Entity {summary.businessEntityId}</p>
      <p className="text-sm text-slate-300">Mapped {summary.counts.mapped} &middot; Review required {summary.counts.reviewRequired} &middot; Non-contributing {summary.counts.nonContributing} &middot; Withdrawn {summary.counts.withdrawn}</p>
      {summary.calculationState === "disabled" ? <p className="text-sm text-slate-300">Accounting authority is disabled. No subtotal is shown.</p>
        : summary.calculationState === "pending" ? <p className="text-sm text-slate-300">Calculation pending. Previous subtotals are withheld.</p>
          : <>
            <p className="text-xs text-slate-400">Calculated <time dateTime={summary.calculatedAt!}>{summary.calculatedAt}</time></p>
            {!summary.months.length ? <p className="text-sm text-slate-300">No admitted monthly subtotal is available.</p> : null}
            {summary.months.map((month) => <div key={month.stateId} className="grid min-w-0 gap-2 border-b border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="text-sm text-slate-300"><time dateTime={month.periodStart}>{month.periodStart}</time> to <time dateTime={month.periodEnd}>{month.periodEnd}</time></p>
                <p className="break-all font-mono text-base text-white">{month.currency} {month.valueCanonical}</p>
                <p className="text-xs text-slate-400">Partial admitted subtotal &middot; {month.supportingContributionCount} contributions</p>
              </div>
              <div className="min-w-0 text-sm">
                {month.provenance.length ? <details>
                  <summary className="cursor-pointer text-cyan-200 focus-visible:outline focus-visible:outline-2">Bounded source references ({month.provenance.length})</summary>
                  <ul className="mt-2 space-y-2">
                    {month.provenance.map((ref, i) => <li key={ref.factVersionId}>
                      <Link className="inline-flex min-h-11 items-center text-cyan-200 underline" href={qboBrowseHref({ connectionId: summary.connectionId,
                        after: null, sourceId: ref.sourceRecordId, kind: "records" }, "source-detail")}>Stored source {i + 1}</Link>
                      <span className="block break-all text-xs text-slate-400">Fact {ref.factVersionId} &middot; Source version {ref.sourceVersionId}</span>
                    </li>)}
                  </ul>
                </details> : <p className="text-slate-400">No active contributing fact references.</p>}
              </div>
            </div>)}
          </>}
    </div>)}
    {result.data.withheldMetricIds.length ? <p className="text-sm text-amber-200">Some numeric snapshot observations are withheld to preserve decimal precision. Exact subtotals remain shown above.</p> : null}
  </section>;
}
