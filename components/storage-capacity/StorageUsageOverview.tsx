import Link from "next/link";
import type { WorkspaceStorageUsage } from "@/lib/storage-capacity/contracts";
import { formatStorageBytes, storageWarning } from "@/lib/storage-capacity/policy";

function UsageMeter({ label, used, allowance, available, bytes = false, reserved = 0 }: {
  label: string; used: number; allowance: number; available: number; bytes?: boolean; reserved?: number;
}) {
  const percent = allowance > 0 ? Math.round(used / allowance * 100) : 100;
  const warning = storageWarning(used + reserved, allowance);
  const format = (value: number) => bytes ? formatStorageBytes(value, { gb: true }) : value.toLocaleString("en-US");
  return <section className="min-w-0 rounded-lg border border-line bg-white p-4 sm:p-5" aria-label={label}>
    <h2 className="text-base font-semibold text-ink">{label}</h2>
    <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">{format(used)} <span className="text-sm font-normal text-muted">used of {format(allowance)}</span></p>
    <div role="progressbar" aria-label={`${label} used`} aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100}
      aria-valuetext={`${format(used)} used of ${format(allowance)}; ${format(available)} available`}
      className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${warning === "full" || warning === "critical" ? "bg-red-600" : warning === "warning" ? "bg-amber-500" : "bg-vaeroex-blue"}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
    <p className="mt-2 text-sm text-muted"><span className="font-semibold text-ink">{format(available)}</span> available{bytes ? "" : " file slots"}</p>
    {reserved > 0 ? <p className="mt-1 text-xs text-muted">{format(reserved)} reserved for uploads in progress; already excluded from available capacity.</p> : null}
    {warning ? <p role="status" className={`mt-3 text-sm ${warning === "warning" ? "text-amber-800" : "text-red-700"}`}>
      {warning === "full" ? "At or above the allowance. Uploads that need more capacity are paused." : warning === "critical" ? "At least 95% committed. Review files or buy capacity before the next upload." : "At least 80% committed. Plan space for upcoming uploads."}
    </p> : null}
  </section>;
}

export function StorageUsageOverview({ usage }: { usage: WorkspaceStorageUsage }) {
  const breakdown = [
    { label: "Active", group: usage.active, slots: true },
    { label: "Archived", group: usage.archived, slots: true },
    { label: "Trash", group: usage.trash, slots: true },
    { label: "Protected historical Trash", group: usage.historicalTrash, slots: true },
  ];
  return <div className="space-y-5">
    <section className="rounded-lg border border-line bg-white p-4 text-sm sm:p-5" aria-labelledby="included-storage-heading">
      <h2 id="included-storage-heading" className="font-semibold text-ink">Included with this workspace</h2>
      <p className="mt-1 text-muted"><strong className="font-semibold text-ink">{formatStorageBytes(usage.includedBytes, { gb: true })} and {usage.includedFiles.toLocaleString("en-US")} file slots</strong>. This allowance belongs to this workspace alone. Capacity is never pooled across businesses.</p>
      <p className="mt-2 text-muted">{usage.paidPacks.toLocaleString("en-US")} paid {usage.paidPacks === 1 ? "pack currently provides" : "packs currently provide"} capacity. Each pack adds 10 GB and 500 file slots for $5 USD/month.</p>
      <p className="mt-2 text-xs text-muted">1 GB = 1,000,000,000 bytes. Maximum original file size: 25 MiB (26,214,400 bytes). Processing allowances are separate.</p>
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <UsageMeter label="Uploaded-file storage" used={usage.usedBytes} allowance={usage.allowanceBytes} available={usage.availableBytes} reserved={usage.reservedBytes} bytes />
      <UsageMeter label="File slots" used={usage.usedFiles} allowance={usage.allowanceFiles} available={usage.availableFiles} reserved={usage.reservedFiles} />
    </div>
    {usage.reconciled === false ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Storage reconciliation is in progress. Usage will be confirmed against the stored originals before the new byte allowance is enforced.</p> : null}
    <section aria-labelledby="storage-breakdown-heading" className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <h2 id="storage-breakdown-heading" className="text-base font-semibold text-ink">Where your uploaded-file storage is used</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Uploaded originals by lifecycle state</caption>
          <thead><tr className="border-b border-line text-xs text-muted"><th scope="col" className="pb-2 font-medium">State</th><th scope="col" className="px-3 pb-2 text-right font-medium">Files</th><th scope="col" className="px-3 pb-2 text-right font-medium">Bytes retained</th><th scope="col" className="pb-2 text-right font-medium">Uses file slots</th></tr></thead>
          <tbody>{breakdown.map(({ label, group, slots }) => <tr key={label} className="border-b border-line last:border-0">
            <th scope="row" className="py-3 font-medium text-ink">{label}</th><td className="px-3 py-3 text-right tabular-nums">{group.files.toLocaleString("en-US")}</td><td className="px-3 py-3 text-right tabular-nums">{formatStorageBytes(group.bytes)}</td><td className="py-3 text-right text-muted">{slots ? "Yes" : "No"}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted">Every retained original uses both bytes and a file slot, including archived files and Trash. Both are released only after permanent deletion. New deletions stay recoverable for 30 days, and retained originals can be restored even when the workspace is over its allowance.</p>
      {usage.historicalTrash.files > 0 ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-ink">Historical deleted files are protected from permanent deletion pending advance notice and a recovery/export window. You can restore or download their retained originals.</p> : null}
      {usage.unlinkedBytes > 0 ? <p role="status" className="mt-3 text-sm text-amber-800">{formatStorageBytes(usage.unlinkedBytes)} of retained originals are awaiting a matching file record. These bytes remain included in usage while reconciliation completes.</p> : null}
      {usage.missingFiles > 0 ? <p role="status" className="mt-3 text-sm text-amber-800">{usage.missingFiles.toLocaleString("en-US")} file {usage.missingFiles === 1 ? "record has" : "records have"} no matching stored original. Missing originals do not use bytes or file slots and cannot be downloaded or restored.</p> : null}
    </section>
    <section aria-labelledby="separate-data-heading" className="rounded-lg border border-line bg-white p-4 sm:p-5">
      <h2 id="separate-data-heading" className="text-base font-semibold text-ink">Other workspace data</h2>
      <p className="mt-1 text-sm text-muted">Synced plug-in data, chats, saved analyses, extracted text, and derived database records are outside the paid uploaded-file quota. No file-storage overage charge applies to this data.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Separately measured database data, excluded from uploaded-file capacity</caption>
        <thead><tr className="border-b border-line text-xs text-muted"><th scope="col" className="pb-2 font-medium">Category</th><th scope="col" className="px-3 pb-2 text-right font-medium">Records</th><th scope="col" className="pb-2 text-right font-medium">Estimated data size</th></tr></thead>
        <tbody>{usage.separateData.map(item => <tr key={item.label} className="border-b border-line last:border-0">
          <th scope="row" className="py-3 font-medium text-ink">{item.label}{item.explanation ? <span className="mt-1 block max-w-lg text-xs font-normal text-muted">{item.explanation}</span> : null}</th>
          <td className="px-3 py-3 text-right tabular-nums text-muted">{item.records === null ? "Not measured" : item.records.toLocaleString("en-US")}</td>
          <td className="py-3 text-right tabular-nums text-muted">{item.estimatedBytes === null ? "Not measured" : formatStorageBytes(item.estimatedBytes)}</td>
        </tr>)}</tbody>
      </table></div>
      {usage.separateData.length === 0 ? <p className="mt-3 text-sm text-muted">Database usage has not been measured yet. It is not zero usage.</p> : null}
      <p className="mt-3 text-xs leading-5 text-muted">Estimates describe attributed data payloads, not physical database disk, indexes, or backups. Private chat contents are never shown here. Plug-in sync and processing limits remain separate.</p>
    </section>
    <section className="text-sm text-muted" aria-label="What remains available at the limit">
      <p>At the allowance, existing files remain available to view, download, search, export, and restore. You can delete files, use ordinary workspace features, and continue plug-ins and analyses within their separate limits. Only new uploads that need unavailable capacity are blocked.</p>
      <p className="mt-2">There are no automatic purchases or overage charges. <Link href="/app/sources" className="font-semibold text-vaeroex-blue underline underline-offset-2">Manage source files</Link>.</p>
    </section>
  </div>;
}
