import Link from "next/link";
import { ArrowLeft, ArrowRight, Filter, FileText } from "lucide-react";
import { QBO_CUSTOMER_DATA_PATH, qboBrowseHref, type QboBrowser, type QboBrowseQuery, type QboPreview } from "./contracts";
import { QBO_REPORT_TYPES, QBO_TRANSACTION_RECORD_TYPES } from "@/lib/integrations/providers/qbo/contracts";
import { qboAccountingObservations, type QboAccountingObservations } from "./observations";

const words = (value: string) => value.replace(/_/g, " ");
const known = (value: string | null) => value ?? "Unknown";
const reviewLabel = (value: string) => value === "absent" ? "Not recorded" : value === "claimed" ? "In progress"
  : value === "conflict" ? "Review required" : words(value);
function time(value: string | null) {
  return value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC").replace(/Z$/, " UTC") : "Unknown";
}
export function QboStoredDataUnavailable({ reason }: { reason: "denied" | "query" | "unavailable" }) {
  const message = reason === "denied" ? "Workspace owner access and a current session are required."
    : reason === "query" ? "These source filters are invalid."
      : "Stored QuickBooks data could not be loaded. Coverage and record counts are unavailable.";
  return <section className="space-y-3" aria-label="Stored data unavailable">
    <p role="alert" className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">{message}</p>
    <p className="text-sm text-slate-600">Coverage and amounts are unavailable.</p>
    {reason !== "denied" ? <Link href={QBO_CUSTOMER_DATA_PATH} className="inline-flex min-h-10 items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />Return to first page</Link> : null}
  </section>;
}
function Preview({ value }: { value: QboPreview }) {
  if (value.kind === "record") return <section className="space-y-3" aria-label="Stored document amounts">
    <p className="text-sm">Document status: <strong>{words(value.status)}</strong>. Amounts are document fields, not recognized revenue.</p>
    <p className="text-sm">Basis: {value.accounting.basis} | Currency: {known(value.accounting.sourceCurrency)} | Posting date: {known(value.temporal.postingDate)}</p>
    <dl className="grid gap-3 sm:grid-cols-2">
      {(["total", "balance"] as const).map(key => <div key={key} className="border-l-2 border-line pl-3">
        <dt className="text-sm text-slate-600">Document {key}</dt>
        <dd className="break-words font-mono text-sm">{value.amounts[key] ? `${value.amounts[key].currency} ${value.amounts[key].amount}` : "Not stored"}</dd>
      </div>)}
    </dl>
  </section>;
  return <section className="space-y-3" aria-label="QBO-reported observation">
    <h3 className="text-base font-semibold">QBO-reported {value.reportType}</h3>
    <p className="text-sm">Nonadditive report observation | Basis: {value.reportBasis} | Currency: {known(value.sourceCurrency)} | Period: {known(value.periodStart)} to {known(value.periodEnd)}</p>
    <p className="text-sm text-slate-600">{value.truncated ? "Partial preview: limited to 200 rows, 16 columns and 12 nesting levels." : "All stored rows are shown for this report observation."} Report totals are not added to document amounts.</p>
    <div className="max-w-full overflow-x-auto border-y border-line" tabIndex={0} role="region" aria-label="Report table">
      <table className="w-full text-left text-sm">
        <thead><tr>{value.columns.map(column => <th key={column.columnKey} className="min-w-32 max-w-64 break-words p-3 font-medium">{column.title ?? "Untitled column"}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{value.rows.map((row, index) => <tr key={index} className={row.rowType === "summary" ? "bg-slate-50 font-semibold" : ""}>
          {value.columns.map((column, cellIndex) => <td key={column.columnKey} className="min-w-32 max-w-64 break-words p-3 align-top">
            {cellIndex === 0 && row.depth > 0 ? <span className="mr-2 text-slate-500" aria-label={`Nesting level ${row.depth}`}>{"/".repeat(row.depth)}</span> : null}
            {row.cells.find(cell => cell.columnKey === column.columnKey)?.value ?? "Not stored"}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function AccountingObservations({ output }: { output: QboAccountingObservations }) {
  const reasons: Record<NonNullable<QboAccountingObservations["reason"]>, string> = {
    source_not_selected: "Select a source to inspect its accounting observations.",
    source_not_active: "This source is not active. No active accounting observations are available.",
    validation_not_complete: "Accounting observations are unavailable until validation passes.",
    mapping_not_active: "This source belongs to a historical mapping. Current accounting observations are unavailable.",
    preview_unavailable: "The supported source fields are unavailable. No values have been inferred.",
    document_status_not_active: "The stored document is not explicitly active. No active accounting observations are available.",
    no_supported_fields: "No document total/balance or native report summary rows are stored. No values have been inferred."
  };
  return <section aria-label="Validated accounting observations" className="space-y-3 border-y border-line py-4">
    <h3 className="text-base font-semibold">Validated accounting observations</h3>
    <p className="text-sm text-slate-600">QBO-reported amounts, shown separately from other records and reports. Reconciliation is unconfirmed.</p>
    {output.reason ? <p className="text-sm text-amber-800">{reasons[output.reason]}</p> : null}
    {output.observations.map((observation, index) => <div key={index} className="space-y-2 border-l-2 border-line pl-3">
      {observation.kind === "document_field" ? <p className="break-words text-sm">QBO-reported document {observation.field}: <strong className="font-mono">{observation.money.currency} {observation.money.amount}</strong></p>
        : <><p className="text-sm font-medium">QBO-reported summary row {observation.rowNumber} | Nesting level {observation.depth}</p>
          <dl className="grid gap-2 sm:grid-cols-2">{observation.cells.map((cell, cellIndex) => <div key={cellIndex} className="min-w-0 text-sm">
            <dt className="break-words text-slate-600">{cell.column ?? "Untitled column"}</dt><dd className="break-words">{cell.value ?? "Not stored"}</dd>
          </div>)}</dl></>}
    </div>)}
    {output.truncated ? <p className="text-sm text-slate-600">Partial observations: at most 12 native summary rows from the bounded stored preview. No missing values have been inferred.</p> : null}
  </section>;
}

export function QboStoredDataView({ browser, query }: { browser: QboBrowser; query: QboBrowseQuery }) {
  const selected = browser.connections.find(connection => connection.connectionId === browser.connectionId);
  const scoped = { ...query, connectionId: browser.connectionId };
  const detail = browser.detail;
  const metrics = browser.metrics;
  return <div className="min-w-0 space-y-6">
    <div className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950" role="note">
      Coverage and reconciliation: unknown. Reports and transactions are not additive.
      Combined Square/QuickBooks revenue: unavailable.
    </div>
    <form action={QBO_CUSTOMER_DATA_PATH} method="get" className="flex flex-wrap items-end gap-3 border-b border-line pb-4">
      <label className="grid min-w-0 gap-1 text-sm sm:max-w-md">Connection / business entity
        <select name="connectionId" defaultValue={browser.connectionId ?? ""} className="h-10 w-full min-w-0 rounded-md border border-line bg-white px-2" disabled={!browser.connections.length}>
          {!browser.connections.length ? <option value="">No stored QBO connection</option> : null}
          {browser.connections.map(connection => <option key={connection.connectionId} value={connection.connectionId}>{connection.label} / {connection.entityLabel} ({words(connection.state)})</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Source category
        <select name="kind" defaultValue={browser.kind} className="h-10 rounded-md border border-line bg-white px-2">
          <option value="all">Reports and records</option><option value="reports">Reports only</option><option value="records">Records only</option>
        </select>
      </label>
      <button type="submit" title="Apply filters" aria-label="Apply filters" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line hover:bg-slate-50"><Filter className="h-4 w-4" /></button>
    </form>
    <div className="space-y-1 text-sm text-slate-600">
      <p className="break-words">QuickBooks Online / Production{selected ? ` / ${selected.label} / ${selected.entityLabel} / ${words(selected.state)}` : ""}</p>
      <p>Read: {time(browser.readAt)} | Current versions | 25 sources per page</p>
    </div>
    <section aria-label="Stored-data metrics" className="space-y-4 border-y border-line py-5">
      <h2 className="text-lg font-semibold">Stored-data coverage</h2>
      <p className="text-sm text-slate-600">Source records, not sales. This connection and category, all pages. Import completeness: unknown.</p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[["Current sources", metrics.currentSources], ["Transaction records", metrics.transactionRecords], ["Report observations", metrics.reportObservations]].map(([label, value]) => <div key={label}>
          <dt className="text-sm text-slate-600">{label}</dt><dd className="break-words text-2xl font-semibold tabular-nums">{value}</dd>
        </div>)}
      </dl>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><h3 className="text-sm font-semibold">Validation</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{Object.entries(metrics.validation).map(([status, value]) => <div key={status}><dt className="capitalize">{status}</dt><dd className="font-mono">{value}</dd></div>)}</dl></div>
        <div><h3 className="text-sm font-semibold">Lifecycle</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm">{Object.entries(metrics.lifecycle).map(([status, value]) => <div key={status}><dt className="capitalize">{status}</dt><dd className="font-mono">{value}</dd></div>)}</dl></div>
      </div>
      <div><h3 className="text-sm font-semibold">Source review</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{Object.entries(metrics.validationWork).map(([status, value]) => <div key={status}><dt className="capitalize">{reviewLabel(status)}</dt><dd className="font-mono">{value}</dd></div>)}</dl></div>
      <div className="grid gap-5 sm:grid-cols-2">
        {([{ label: "Transaction record counts", types: QBO_TRANSACTION_RECORD_TYPES, visible: browser.kind !== "reports" },
          { label: "QBO report observation counts", types: QBO_REPORT_TYPES, visible: browser.kind !== "records" }] as const).map(({ label, types, visible }) => <div key={label}>
          <h3 className="text-sm font-semibold">{label}</h3>
          {visible ? <dl className="mt-2 divide-y divide-line text-sm">{types.map(type => <div key={type} className="flex justify-between gap-3 py-1"><dt className="break-words">{type}</dt><dd className="font-mono">{metrics.byType.find(entry => entry.recordType === type)?.count ?? "0"}</dd></div>)}</dl>
            : <p className="mt-2 text-sm text-slate-600">Outside this category selection</p>}
        </div>)}
      </div>
      <div className="space-y-1 text-sm text-slate-600">
        <p>Missing currency: {metrics.missingCurrency} | Unknown accounting basis: {metrics.unknownAccountingBasis}</p>
        <p>Missing transaction posting date: {metrics.missingTransactionPostingDate} | Missing source time zone: {metrics.missingSourceTimeZone}</p>
        <p>Stored posting-date extent: {known(metrics.earliestPostingDate)} to {known(metrics.latestPostingDate)}</p>
        <p>Observed extent: {time(metrics.earliestObservedAt)} to {time(metrics.latestObservedAt)}</p>
        <p>Latest stored sync time: {time(metrics.latestSynchronizedAt)}. These extents do not establish continuous coverage or a completed sync.</p>
      </div>
    </section>
    <section id="stored-sources" aria-label="Stored sources" className="scroll-mt-6 divide-y divide-line border-y border-line">
      {!browser.sources.length ? <p className="py-6 text-sm text-slate-600">No stored sources in this selection. This does not mean zero activity or a complete import.</p> : null}
      {browser.sources.map(source => <article key={source.sourceId} className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-1 text-sm">
          <h2 className="break-words font-semibold text-ink">{source.recordType}{source.providerRecordId ? ` / ${source.providerRecordId}` : " / Report observation"}</h2>
          <p>Lifecycle: {source.lifecycle} | Validation: {source.validation} | Review: {reviewLabel(source.validationWork)} | Mapping: {source.mappingStatus}</p>
          <p>Basis: {words(source.accountingBasis)} | Currency: {known(source.currency)} | Time basis: {words(source.temporalBasis)}</p>
          <p>Posting date: {known(source.postingDate)} | Period: {known(source.periodStart)} to {known(source.periodEnd)}</p>
          <p>Effective: {time(source.effectiveAt)} | Source time zone: {known(source.sourceTimeZone)}</p>
          <p className="text-slate-600">Observed: {time(source.observedAt)} | Stored sync time: {time(source.synchronizedAt)}</p>
        </div>
        <Link href={qboBrowseHref({ ...scoped, sourceId: source.sourceId }, "source-detail")} aria-label={`Inspect ${source.recordType}${source.providerRecordId ? ` ${source.providerRecordId}` : ""}`} title="Inspect stored source" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line hover:bg-slate-50"><FileText className="h-4 w-4" /></Link>
      </article>)}
    </section>
    <nav className="flex items-center justify-between gap-3" aria-label="Source pagination">
      <Link href={qboBrowseHref({ ...scoped, after: null, sourceId: null })} className="inline-flex items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />First page</Link>
      {browser.nextAfter ? <Link href={qboBrowseHref({ ...scoped, after: browser.nextAfter, sourceId: null })} className="inline-flex items-center gap-2 text-sm">Next page<ArrowRight className="h-4 w-4" /></Link> : <span className="text-sm text-slate-500">End of current selection</span>}
    </nav>
    {detail ? <section id="source-detail" className="min-w-0 scroll-mt-6 space-y-4 border-t border-line pt-5" aria-label="Selected source">
      <h2 className="break-words text-lg font-semibold">{detail.source.recordType}{detail.source.providerRecordId ? ` / ${detail.source.providerRecordId}` : ""}</h2>
      <p className="text-sm">{detail.source.lifecycle} | Validation: {detail.source.validation} | Review: {reviewLabel(detail.source.validationWork)}</p>
      <p className="text-sm">Observed: {time(detail.source.observedAt)} | Stored sync time: {time(detail.source.synchronizedAt)}</p>
      <p className="text-sm">Time basis: {words(detail.source.temporalBasis)} | Effective: {time(detail.source.effectiveAt)} | Source time zone: {known(detail.source.sourceTimeZone)}</p>
      <p className="text-sm text-slate-600">This observation is not reconciled to Square payments or other QBO records. It cannot establish combined revenue.</p>
      {detail.source.lifecycle === "voided" ? <p className="text-sm font-semibold text-red-700">Voided source. Stored values are historical document fields, not active sales.</p> : null}
      {detail.source.validation === "pending" ? <p className="text-sm text-amber-800">Pending validation. These stored values are not approved accounting facts.</p> : null}
      <AccountingObservations output={qboAccountingObservations(browser)} />
      {detail.value ? <Preview value={detail.value} /> : <p className="text-sm text-slate-600">Preview unavailable ({detail.state}). No amount has been inferred.</p>}
      <Link href="#stored-sources" className="inline-flex items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />Back to sources</Link>
    </section> : null}
  </div>;
}
