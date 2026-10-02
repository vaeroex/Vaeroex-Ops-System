import Link from "next/link";
import { qboBrowseHref } from "./contracts";
import type { QboAccountingIntelligenceLoad } from "./accounting-intelligence-server";

export function QboAccountingIntelligenceView({ result }: { result: QboAccountingIntelligenceLoad }) {
  if (result.state === "hidden") return null;
  if (result.state === "unavailable") return <section aria-label="QuickBooks accounting" className="border-t border-white/10 py-4 text-sm text-slate-300">
    QuickBooks accounting summary unavailable. No subtotal is shown.
  </section>;
  const summaries = result.data.summaries.filter((summary) => result.connections.some((connection) =>
    connection.connectionId === summary.connectionId && connection.visibility.visible));
  if (!summaries.length) return null;
  return <section aria-labelledby="qbo-admitted-subtotal-heading" className="min-w-0 space-y-4 border-t border-white/10 py-4">
    <div>
      <h2 id="qbo-admitted-subtotal-heading" className="text-lg font-semibold text-white">QuickBooks</h2>
    </div>
    {result.connectionsTruncated ? <p className="text-sm text-amber-200">Connection coverage is limited; additional connections are not represented.</p> : null}
    {summaries.map((summary) => {
      const connection = result.connections.find((row) => row.connectionId === summary.connectionId);
      if (!connection?.visibility.visible) return null;
      const { visibility } = connection;
      return <div key={summary.connectionId} className="min-w-0 space-y-2 border-t border-white/10 pt-4">
      <h3 className="break-words text-base font-semibold text-white">{summary.businessEntityName} / {connection.label}</h3>
      {visibility.status ? <p className="text-sm text-slate-300">{visibility.status}</p> : null}
      {visibility.lastSuccessfulSyncAt ? <p className="text-xs text-slate-400">Last successful sync: <time dateTime={visibility.lastSuccessfulSyncAt}>{new Date(visibility.lastSuccessfulSyncAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></p> : null}
      <Link className="inline-flex min-h-11 items-center text-sm text-cyan-200 underline" href={qboBrowseHref({ connectionId: summary.connectionId, after: null, sourceId: null, kind: "all" })}>View imported data</Link>
      {visibility.requiresReconnect ? <Link className="ml-4 inline-flex min-h-11 items-center text-sm text-cyan-200 underline" href="/app/settings/integrations/quickbooks">Reconnect QuickBooks</Link> : null}
      {summary.calculationState === "disabled" ? null
        : summary.calculationState === "pending" ? <p className="text-sm text-slate-300">Revenue results are being updated. Previous subtotals are withheld.</p>
          : <>
            {summary.months.length ? <p className="text-sm text-slate-300">Partial posted revenue subtotal, not total posted revenue. Only approved accrual contributions are included. Reports are separate checks; Square payments are not combined.</p> : null}
            {summary.months.map((month) => <div key={month.stateId} className="grid min-w-0 gap-2 border-b border-white/10 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="text-sm text-slate-300"><time dateTime={month.periodStart}>{month.periodStart}</time> to <time dateTime={month.periodEnd}>{month.periodEnd}</time></p>
                <p className="break-all font-mono text-base text-white">{month.currency} {month.valueCanonical}</p>
              </div>
              <div className="min-w-0 text-sm">
                {month.provenance.length ? <details>
                  <summary className="cursor-pointer text-cyan-200 focus-visible:outline focus-visible:outline-2">View supporting records</summary>
                  <ul className="mt-2 space-y-2">
                    {month.provenance.map((ref, i) => <li key={ref.factVersionId}>
                      <Link className="inline-flex min-h-11 items-center text-cyan-200 underline" href={qboBrowseHref({ connectionId: summary.connectionId,
                        after: null, sourceId: ref.sourceRecordId, kind: "records" }, "source-detail")}>Stored source {i + 1}</Link>
                    </li>)}
                  </ul>
                </details> : null}
              </div>
            </div>)}
          </>}
    </div>; })}
    {result.data.withheldMetricIds.length ? <p className="text-sm text-amber-200">Some numeric snapshot observations are withheld to preserve decimal precision. Exact subtotals remain shown above.</p> : null}
  </section>;
}
