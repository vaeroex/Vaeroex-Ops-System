import { parseSquareWorkspaceEvidence } from "@/lib/integrations/providers/square/workspace-evidence";
import { SectionCard } from "@/components/operations/SectionCard";

const labels = { payment: "Payment", refund: "Refund", order: "Orders", catalog: "Catalog variations", inventory: "Inventory observations" };
const utc = (value: string) => new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");

/** Server-rendered, read-only; only the bounded identifier-free DTO enters JSX. */
export function SquareEvidenceCard({ evidence }: { evidence: unknown }) {
  const view = parseSquareWorkspaceEvidence(evidence);
  if (!view) return null;
  return <SectionCard title="Square Sandbox evidence" description="Verified, non-economic provider observations · Read-only">
    <div className="space-y-4 text-sm text-ink">
      <p>These observations belong to this workspace’s authorized Sandbox connection. Counts cover the admitted source set, not the seller’s complete history.</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Admitted observations">
        {Object.entries(labels).map(([kind, label]) => <div key={kind} className="rounded-lg border border-line p-3">
          <dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold">{view.counts[kind as keyof typeof labels]}</dd>
        </div>)}
      </dl>
      <div><h4 className="font-semibold">Checkpoint and provenance</h4>
        <p>Interpretation checkpoint {view.checkpointRevision} · {utc(view.interpretedAt)}</p>
        <p>Last verified source observation: {utc(view.lastObservedAt)}</p>
        <p>Current sync health: unknown. Observation time is not proof of a recent successful sync.</p>
        <p>Policy: {view.policy}. Immutable source versions were checked against current authority when this view was read.</p>
      </div>
      <div role="note"><h4 className="font-semibold">Uncertainty and limits</h4>
        <ul className="list-disc space-y-1 pl-5">
          <li>{view.relationships.unresolvedLocation} unresolved location relationships; {view.relationships.conflict} reference conflict{view.relationships.conflict === 1 ? "" : "s"}.</li>
          <li>{view.relationships.idMatch} observed ID matches only—not financial reconciliation. {view.relationships.otherUncertain} other uncertain relationships.</li>
          <li>Historical completeness: unknown. Catalog is seller-scoped with location applicability; inventory observations are not calculated stock.</li>
          <li>No revenue, profit, netting, inventory valuation, stock calculation, or complete-history claim is made. Economic contributions remain blocked.</li>
        </ul>
      </div>
      <details><summary className="cursor-pointer font-semibold">Source-version provenance</summary>
        <p className="my-2">Square Sandbox · Identifiers and source payloads are intentionally withheld. Each row is a distinct admitted source version; provider resource types remain separate.</p>
        <table className="w-full text-left"><caption className="sr-only">Immutable observation provenance</caption>
          <thead><tr><th scope="col">Resource</th><th scope="col">Version</th><th scope="col">Observed (UTC)</th></tr></thead>
          <tbody>{view.provenance.map((item, index) => <tr key={index}><td>{labels[item.kind]}</td><td>{item.sourceVersion}</td><td>{utc(item.observedAt)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  </SectionCard>;
}
