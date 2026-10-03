import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { qboBrowseHref, type QboBrowser } from "./contracts";

export type QboCoverageDiagnostic = Pick<QboBrowser, "readAt" | "coverage" | "connectionId" | "metrics"> & {
  selectedConnection: QboBrowser["connections"][number] | null;
};

export function qboCoverageDiagnostic(browser: QboBrowser): QboCoverageDiagnostic {
  return { readAt: browser.readAt, coverage: browser.coverage, connectionId: browser.connectionId,
    metrics: browser.metrics,
    selectedConnection: browser.connections.find(connection => connection.connectionId === browser.connectionId) ?? null };
}

export function QboCoverageDiagnosticView({ diagnostic }: { diagnostic: QboCoverageDiagnostic | null }) {
  const metrics = diagnostic?.metrics;
  return <section aria-label="QuickBooks record status" className="space-y-3 border-t border-white/10 pt-6 text-sm text-slate-300">
    <h2 className="text-xl font-semibold text-white">QuickBooks record status</h2>
    <p>Reports and transactions are shown separately. Combined Square/QuickBooks revenue is unavailable.</p>
    {diagnostic ? <>
      <p className="break-words">{diagnostic.selectedConnection
        ? `${diagnostic.selectedConnection.label} / ${diagnostic.selectedConnection.entityLabel} / ${diagnostic.selectedConnection.state}`
        : "No stored QBO connection"}. QuickBooks Online / Production.</p>
      <p>Coverage: unknown. Import completeness and reconciliation are unconfirmed. Record counts for this connection include all pages.</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Stored sources", metrics?.currentSources], ["Transaction records", metrics?.transactionRecords],
          ["Report observations", metrics?.reportObservations], ["Validation passed", metrics?.validation.valid],
          ["Pending validation", metrics?.validation.pending], ["Invalid", metrics?.validation.invalid],
          ["Quarantined", metrics?.validation.quarantined], ["Review not recorded", metrics?.validationWork.absent],
          ["Voided", metrics?.lifecycle.voided], ["Deleted", metrics?.lifecycle.deleted],
          ["Missing currency", metrics?.missingCurrency], ["Unknown basis", metrics?.unknownAccountingBasis]].map(([label, count]) => <div key={label} className="min-w-0">
          <dt className="break-words text-slate-400">{label}</dt><dd className="break-words font-mono text-white">{count}</dd>
        </div>)}
      </dl>
      <p>Read at {diagnostic.readAt}. No stored records does not mean no business activity.</p>
    </> : <p role="status">QuickBooks record status is unavailable. Coverage and counts are unknown.</p>}
    <Link href={qboBrowseHref({ connectionId: diagnostic?.connectionId ?? null, kind: "all", sourceId: null, after: null })}
      className="inline-flex min-h-11 items-center gap-2 font-semibold text-cyan-200 hover:underline">
      View stored QuickBooks data<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
    </Link>
  </section>;
}
