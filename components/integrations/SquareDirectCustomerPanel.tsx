import Link from "next/link";
import type { DirectPayment, DirectView } from "@/lib/integrations/square-direct/contracts";
import type { DirectPaymentBrowser } from "@/lib/integrations/square-direct/payment-browse";

type Connection = DirectView["connections"][number];
const settingsPath = "/app/settings/integrations/square";
const connectionLabels = {
  consent_pending: "Waiting for Square authorization", exchanging: "Finishing Square authorization",
  mapping_required: "Choose a Square location", connected: "Connected", syncing: "Reading Square Payments",
  retry_required: "Payments update needs another attempt", reauthorization_required: "Square authorization needs renewal",
  disconnected: "Disconnected",
} as const;
const statusLabels = {
  COMPLETED: "Completed", FAILED: "Failed attempt", CANCELED: "Canceled attempt",
  APPROVED: "Approved", PENDING: "Pending", UNKNOWN: "Unknown",
} as const;
const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue";
const inputClass = "mt-1 block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink";
const cardClass = "rounded-lg border border-line bg-white p-4 shadow-panel sm:p-5";

/** Preserve Square's integer minor units without a floating-point conversion. */
export function squarePaymentAmount(amountMinor: string | null, currency: string | null): string {
  if (!amountMinor || !/^-?(?:0|[1-9]\d*)$/.test(amountMinor) || !currency || !/^[A-Z]{3}$/.test(currency)) return "Amount unavailable";
  try {
    const exponent = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (exponent === undefined) return "Amount unavailable";
    const amount = BigInt(amountMinor);
    const absolute = amount < BigInt(0) ? -amount : amount;
    const scale = BigInt(10) ** BigInt(exponent);
    const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(absolute / scale);
    const fraction = exponent ? `.${(absolute % scale).toString().padStart(exponent, "0")}` : "";
    return `${currency} ${amount < BigInt(0) ? "-" : ""}${whole}${fraction}`;
  } catch { return "Amount unavailable"; }
}

export function squareBusinessTime(value: string | null, timeZone: string): string {
  if (!value) return "Not yet updated";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
  } catch { return "Time unavailable"; }
}

function timestamp(value: string | null): string {
  if (!value) return "Not yet updated";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC");
}

function paymentWindow(read: { start: string; end: string; kind: "created" | "updated" }): string {
  return `Payments ${read.kind} from ${timestamp(read.start)} ${read.kind === "created" ? "up to (not including)" : "through"} ${timestamp(read.end)}`;
}

export function squarePaymentsHref(connectionId: string, filters: { startDate: string | null; endDate: string | null; status: string } = { startDate: null, endDate: null, status: "all" }, page = 1): string {
  const params = new URLSearchParams({ connectionId });
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.status !== "all") params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  return `${settingsPath}?${params.toString()}#saved-payments`;
}

function canRead(view: DirectView, connection: Connection): boolean {
  return view.available && !connection.recoveryRequired && (connection.state === "connected" || connection.state === "retry_required") && Boolean(connection.locationId) && !connection.revocationPending;
}

function CoverageDetails({ connection, timeZone }: { connection: Connection; timeZone: string }) {
  const read = connection.activeRead ?? connection.lastCompletedRead;
  return <details className="text-sm">
    <summary className="cursor-pointer py-2 font-medium text-vaeroex-blue">Search coverage and update details</summary>
    <div className="mt-2 space-y-2 text-muted">
      {connection.activeRead ? <p role="status">Current search: {paymentWindow(connection.activeRead)}. The search is incomplete until every page has been read.</p> : null}
      {connection.lastCompletedRead ? <p>Last completed search: {paymentWindow(connection.lastCompletedRead)}. Completed: {timestamp(connection.lastCompletedRead.completedAt)}. This covers only that date window and the selected location.</p> : null}
      {!read ? <p>No completed search dates are available, so this does not establish whether older Payments exist in Square.</p> : null}
      {connection.checkpointAt ? <p>Ongoing Payments updates resume from: {timestamp(connection.checkpointAt)}. Browsing saved Payments does not move this checkpoint.</p> : null}
      <p>Ongoing update completed: {squareBusinessTime(connection.lastSyncedAt, timeZone)} ({timeZone}). Historical imports do not change the ongoing-update checkpoint.</p>
      <p>These are Square Payment records, not revenue, profit, settlement totals, or accounting statements. Older saved records may not reflect later provider changes until the next successful update.</p>
    </div>
  </details>;
}

function DisconnectControl({ connection }: { connection: Connection }) {
  if (connection.recoveryRequired || (connection.state === "disconnected" && !connection.revocationPending)) return null;
  return <details className="border-t border-line pt-2 text-sm">
    <summary className="cursor-pointer py-2 font-medium">Manage connection</summary>
    <details className="mt-2 rounded-md border border-line p-3">
      <summary className="cursor-pointer font-medium text-red-700">{connection.revocationPending ? "Retry Square revocation" : "Disconnect Square"}</summary>
      <form action="/api/integrations/square/disconnect" method="post" className="mt-3 space-y-3">
        <input type="hidden" name="connectionId" value={connection.connectionId} />
        <label className="flex items-start gap-2"><input type="checkbox" name="confirmation" value="disconnect" required className="mt-1" />
          <span>I confirm disconnecting this Square connection. Saved Payments are retained; further reads stop.</span>
        </label>
        <button type="submit" className={`${buttonClass} text-red-700`}>{connection.revocationPending ? "Confirm revocation retry" : "Confirm disconnect"}</button>
      </form>
    </details>
  </details>;
}

function ConnectionPanel({ view, connection, entity, timeZone, timeZoneFallback }: { view: DirectView; connection: Connection; entity: string; timeZone: string; timeZoneFallback: boolean }) {
  const readable = canRead(view, connection);
  const updateTimes = [connection.lastSyncedAt, connection.lastCompletedRead?.completedAt].filter((value): value is string => Boolean(value));
  const lastUpdate = updateTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return <section className={`${cardClass} space-y-4`} aria-labelledby="current-square-connection">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Current connection</p>
        <h2 id="current-square-connection" className="break-words text-lg font-semibold text-ink">{connection.sellerLabel ?? "Square account"}</h2>
        <p className="text-sm text-muted">Business Entity: {entity}</p>
      </div>
      <span role="status" className={`rounded-full px-3 py-1 text-xs font-semibold ${connection.state === "connected" && !connection.recoveryRequired ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
        {connection.recoveryRequired ? "Authorization recovery required" : connection.revocationPending ? "Revocation pending" : connectionLabels[connection.state]}
      </span>
    </div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-muted">Location</dt><dd className="mt-1 font-medium">{connection.locationId ? connection.locations.find(location => location.id === connection.locationId)?.label ?? "Selected Square location" : "Not selected yet"}</dd></div>
      <div><dt className="text-muted">Last successful update</dt><dd className="mt-1 font-medium">{squareBusinessTime(lastUpdate, timeZone)}<span className="mt-0.5 block text-xs font-normal text-muted">{timeZone}{timeZoneFallback ? " · Fallback; business timezone unavailable" : ""}</span></dd></div>
    </dl>
    {connection.lastError ? <p role="status" className="text-sm text-amber-800">The last attempt did not finish. Your last successfully saved Payments remain below.</p> : null}
    {connection.recoveryRequired ? <p role="status" className="text-sm">Square authorization outcome and this workspace’s account connection are unconfirmed. Contact support for checked recovery before taking any further connection action.</p> : null}
    {view.available && !connection.recoveryRequired && connection.state === "mapping_required" ? <form action="/api/integrations/square/mapping" method="post" className="space-y-3 border-t border-line pt-4">
      <input type="hidden" name="connectionId" value={connection.connectionId} />
      <label className="block text-sm font-semibold">Square location
        <select name="locationId" required defaultValue="" className={inputClass}>
          <option value="" disabled>Select a location</option>
          {connection.locations.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted">Only Payments for the selected location will be saved to this Business Entity.</p>
      <button type="submit" disabled={connection.locations.length === 0} className={buttonClass}>Confirm location</button>
      {connection.locations.length === 0 ? <p role="status">No available Square location was returned. Disconnect before connecting a different account.</p> : null}
    </form> : null}
    {readable ? <div className="space-y-3">
      <form action="/api/integrations/square/read" method="post">
        <input type="hidden" name="connectionId" value={connection.connectionId} />
        <button type="submit" className={`${buttonClass} border-transparent bg-vaeroex-blue text-white`}>{connection.hasMore ? "Read next Payments page" : connection.activeRead ? "Continue Payments read" : connection.lastSyncedAt ? "Update Payments" : "Read Payments"}</button>
      </form>
      {connection.hasMore || connection.activeRead ? <p role="status" className="text-sm text-amber-800">Current import is incomplete. Continue its next page to finish the searched dates.</p> : null}
      {view.historyAvailable && !connection.activeRead && !connection.hasMore ? <details className="text-sm">
        <summary className="cursor-pointer py-1 font-medium text-vaeroex-blue">Import older Payments</summary>
        <form action="/api/integrations/square/read" method="post" className="mt-3 space-y-3 rounded-md border border-line p-4">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <h3 className="font-semibold">Import historical Payments</h3>
          <p id={`history-dates-${connection.connectionId}`} className="text-muted">Choose 1–31 calendar days, including both dates, in UTC. This searches when Payments were created at the selected location and keeps the saved checkpoint for ongoing updates.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block font-semibold">Start date (UTC)<input type="date" name="startDate" required aria-describedby={`history-dates-${connection.connectionId}`} className={inputClass} /></label>
            <label className="block font-semibold">End date (UTC)<input type="date" name="endDate" required aria-describedby={`history-dates-${connection.connectionId}`} className={inputClass} /></label>
          </div>
          <p className="text-muted">Each request imports one page of up to 100 Payments. Continue with “Read next Payments page” if more results remain. Browsing saved Payments below never starts an import.</p>
          <button type="submit" className={buttonClass}>Import historical Payments</button>
        </form>
      </details> : null}
    </div> : null}
    {connection.state === "syncing" || connection.state === "exchanging" ? <a href={settingsPath} className={`${buttonClass} text-vaeroex-blue`}>Refresh connection status</a> : null}
    {!connection.recoveryRequired && connection.state === "reauthorization_required" ? <p className="text-sm">Disconnect this connection, then connect again to renew Square authorization.</p> : null}
    {!connection.recoveryRequired && connection.revocationPending ? <p role="status" className="text-sm">Disconnected locally. Square authorization revocation is still pending; reconnect is blocked until it completes.</p> : null}
    <CoverageDetails connection={connection} timeZone={timeZone} />
    <DisconnectControl connection={connection} />
  </section>;
}

function PaymentStatus({ status }: { status: DirectPayment["status"] }) {
  const color = status === "COMPLETED" ? "bg-emerald-50 text-emerald-800" : status === "FAILED" || status === "CANCELED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800";
  return <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${color}`}>{statusLabels[status]}</span>;
}

function PaymentsTable({ payments, timeZone }: { payments: DirectPayment[]; timeZone: string }) {
  return <div className="overflow-x-auto rounded-md border border-line">
    <table className="block w-full text-left text-sm sm:table">
      <caption className="sr-only">Stored Square Payments. Dates use {timeZone}. Completed payments are distinct from failed attempts.</caption>
      <thead className="sr-only bg-slate-50 text-muted sm:not-sr-only"><tr><th scope="col" className="px-3 py-3 font-medium">Date</th><th scope="col" className="px-3 py-3 font-medium">Status</th><th scope="col" className="px-3 py-3 text-right font-medium">Amount</th><th scope="col" className="px-3 py-3 font-medium">Details</th></tr></thead>
      <tbody className="block sm:table-row-group">{payments.map(payment => <tr key={payment.id} className="grid grid-cols-2 border-t border-line align-top sm:table-row" data-payment-row="true">
        <td className="order-1 min-w-0 px-3 pt-3 pb-1 sm:order-none sm:py-3"><time dateTime={payment.createdAt}>{squareBusinessTime(payment.createdAt, timeZone)}</time></td>
        <td className="order-3 min-w-0 px-3 pt-1 pb-3 sm:order-none sm:py-3"><PaymentStatus status={payment.status} /></td>
        <td className="order-2 min-w-0 break-words px-3 pt-3 pb-1 text-right font-medium tabular-nums sm:order-none sm:whitespace-nowrap sm:py-3">{squarePaymentAmount(payment.amountMinor, payment.currency)}</td>
        <td className="order-4 min-w-0 px-3 pt-1 pb-3 text-right sm:order-none sm:py-3 sm:text-left"><details className="text-xs">
          <summary className="cursor-pointer font-medium text-vaeroex-blue">Details<span className="sr-only"> for {squareBusinessTime(payment.createdAt, timeZone)} {statusLabels[payment.status]} payment</span></summary>
          <dl className="mt-3 max-w-xs space-y-2 break-words">
            <div><dt className="text-muted">Payment ID</dt><dd className="break-all">{payment.id}</dd></div>
            <div><dt className="text-muted">Created (UTC)</dt><dd>{timestamp(payment.createdAt)}</dd></div>
            <div><dt className="text-muted">Last updated by Square (UTC)</dt><dd>{timestamp(payment.updatedAt)}</dd></div>
            <div><dt className="text-muted">Square status</dt><dd>{payment.status}</dd></div>
            <div><dt className="text-muted">Location ID</dt><dd className="break-all">{payment.locationId}</dd></div>
          </dl>
        </details></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function SavedPayments({ browser, connection, browseError }: { browser: DirectPaymentBrowser | null; connection: Connection | null; browseError: string | null }) {
  const selected = browser?.connections.find(item => item.connectionId === browser.connectionId);
  const timeZone = browser?.timeZone ?? "UTC";
  const payments = browser?.payments ?? connection?.payments ?? [];
  const filters = browser?.filters;
  return <section id="saved-payments" className={`${cardClass} scroll-mt-6 space-y-4`} aria-labelledby="saved-payments-heading">
    <div>
      <h2 id="saved-payments-heading" className="text-lg font-semibold text-ink">Saved Payments</h2>
      <p className="mt-1 text-sm text-muted">{selected?.sellerLabel ?? connection?.sellerLabel ?? "Square"}{selected?.locationLabel ? ` · ${selected.locationLabel}` : ""}{selected?.state === "disconnected" ? " · Previous connection" : ""}</p>
      <p className="mt-1 text-xs text-muted">Dates in {timeZone}{browser && !browser.timeZoneFallback ? " · Business timezone" : " · Fallback; business timezone unavailable"}. Browsing only—no import or update is triggered.</p>
    </div>
    {browseError ? <div className="space-y-2 text-sm"><p role="status" className="text-amber-800">{browseError}</p><a href={connection ? squarePaymentsHref(connection.connectionId) : settingsPath} className="font-medium text-vaeroex-blue underline">Reset saved-payment filters</a></div> : null}
    {browser?.connectionId && filters ? <form action={`${settingsPath}#saved-payments`} method="get" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
      <input type="hidden" name="connectionId" value={browser.connectionId} />
      <label className="block text-xs font-semibold">From date<input type="date" name="startDate" defaultValue={filters.startDate ?? ""} className={inputClass} /></label>
      <label className="block text-xs font-semibold">Through date<input type="date" name="endDate" defaultValue={filters.endDate ?? ""} className={inputClass} /></label>
      <label className="block text-xs font-semibold">Payment status<select name="status" defaultValue={filters.status} className={inputClass}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" className={buttonClass}>Filter saved Payments</button><a href={squarePaymentsHref(browser.connectionId)} className="text-sm text-vaeroex-blue underline">Clear</a></div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-4">Filters search all matching saved Payments by creation date, including both dates in {timeZone}. They do not search Square for new records.</p>
    </form> : null}
    {!browser ? <p role="status" className="text-sm text-muted">Showing the existing saved-record preview only. Full-history filters and 25-row pagination are unavailable until payment browsing is ready; this is not all matching stored Payments.</p> : null}
    {browser ? <p className="text-sm text-muted">{browser.totalCount === 0 ? "0 matching saved Payments" : `${(browser.page - 1) * 25 + 1}–${Math.min(browser.page * 25, browser.totalCount)} of ${browser.totalCount} matching saved Payments`}</p> : null}
    {payments.length ? <PaymentsTable payments={payments} timeZone={timeZone} /> : <div className="rounded-md border border-dashed border-line p-5 text-sm text-muted">
      <p>No saved Payments match{filters && (filters.startDate || filters.endDate || filters.status !== "all") ? " these filters" : " this connection"}.</p>
      {filters?.startDate || filters?.endDate ? <p className="mt-2">Searched stored creation dates: {filters.startDate ?? "earliest saved date"} through {filters.endDate ?? "latest saved date"}, inclusive ({timeZone}).</p> : null}
      {connection?.activeRead ? <p className="mt-2">This search is still incomplete. {paymentWindow(connection.activeRead)}.</p> : connection?.lastCompletedRead ? <p className="mt-2">The last completed search checked {paymentWindow(connection.lastCompletedRead)}. Older Payments may be outside these dates.</p> : <p className="mt-2">No completed search dates are available; this does not establish whether older Payments exist in Square.</p>}
    </div>}
    <p className="text-xs text-muted">Only “Completed” is a completed payment. Failed and canceled attempts are not additional successful payments; approved and pending records are not yet completed.</p>
    {browser?.connectionId && filters && browser.totalPages > 1 ? <nav aria-label="Saved Payments pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      {browser.page > 1 ? <a className={buttonClass} href={squarePaymentsHref(browser.connectionId, filters, browser.page - 1)}>← Previous 25</a> : <span className={`${buttonClass} text-muted`} aria-disabled="true">← Previous 25</span>}
      <span className="text-sm text-muted">Page {browser.page} of {browser.totalPages}</span>
      {browser.page < browser.totalPages ? <a className={buttonClass} href={squarePaymentsHref(browser.connectionId, filters, browser.page + 1)}>Next 25 →</a> : <span className={`${buttonClass} text-muted`} aria-disabled="true">Next 25 →</span>}
    </nav> : null}
  </section>;
}

export function SquareDirectCustomerPanel({ view, browser = null, browseError = null, browseConnectionId = null }: { view: DirectView; browser?: DirectPaymentBrowser | null; browseError?: string | null; browseConnectionId?: string | null }) {
  const entities = new Map(view.businessEntities.map(entity => [entity.id, entity.label]));
  const current = browser ? browser.currentConnection : view.connections.find(connection => connection.state !== "disconnected" || connection.revocationPending || connection.recoveryRequired) ?? null;
  const history = browser ? browser.connections.filter(connection => connection.connectionId !== current?.connectionId) : view.connections.filter(connection => connection.connectionId !== current?.connectionId).map(connection => ({
    connectionId: connection.connectionId, businessEntityId: connection.businessEntityId,
    businessEntityLabel: entities.get(connection.businessEntityId) ?? "Business Entity unavailable",
    sellerLabel: connection.sellerLabel, state: connection.state, paymentCount: null,
  }));
  const selectedId = browser?.connectionId ?? browseConnectionId;
  const selected = selectedId ? (current?.connectionId === selectedId ? current : view.connections.find(connection => connection.connectionId === selectedId) ?? null) : current ?? view.connections.find(connection => connection.payments.length > 0) ?? null;
  const currentMetadata = browser?.connections.find(connection => connection.connectionId === current?.connectionId);
  const timeZone = currentMetadata?.timeZone ?? "UTC";
  const connectableEntities = view.connections.every(connection => connection.state === "disconnected" && !connection.revocationPending && !connection.recoveryRequired) ? view.businessEntities : [];
  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 text-ink sm:p-6">
    <Link href="/app/settings" prefetch={false} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-vaeroex-blue shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">← Back to Settings</Link>
    <header className="space-y-1"><h1 className="text-2xl font-semibold">Square</h1><p className="text-sm text-muted">Manage this workspace’s optional Square connection and saved Payments.</p></header>
    {!view.available ? <p role="status" className="rounded-md bg-slate-100 p-3 text-sm">New Square connections and Payments updates are unavailable for this workspace. Saved Payments and existing connection status remain available.</p> : null}
    {current ? <ConnectionPanel view={view} connection={current} entity={entities.get(current.businessEntityId) ?? currentMetadata?.businessEntityLabel ?? "Unavailable"} timeZone={timeZone} timeZoneFallback={currentMetadata?.timeZoneFallback ?? true} /> : <section className={`${cardClass} space-y-3`}>
      <h2 className="text-lg font-semibold">Connect Square</h2><p role="status" className="text-sm text-muted">No Square account is connected to this workspace. Previous saved Payments are retained in Connection history.</p>
      {view.available && connectableEntities.length > 0 ? <form action="/api/integrations/square/connect" method="post" className="space-y-3">
        <label className="block text-sm font-semibold">Business Entity<select name="businessEntityId" required defaultValue="" className={inputClass}><option value="" disabled>Select a Business Entity</option>{connectableEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.label}</option>)}</select></label>
        <p className="text-sm text-muted">Only an eligible owner of this workspace can connect. You will authorize access on Square; never enter your Square password or access token in Vaeroex.</p>
        <button type="submit" className={`${buttonClass} border-transparent bg-vaeroex-blue text-white`}>Connect Square</button>
      </form> : null}
    </section>}
    {selected || browser?.connectionId ? <SavedPayments browser={browser} connection={selected} browseError={browseError} /> : browseError ? <div className="space-y-2 text-sm"><p role="status">{browseError}</p><a href={settingsPath} className="font-medium text-vaeroex-blue underline">Reset saved-payment filters</a></div> : null}
    {history.length ? <details className={cardClass}>
      <summary className="cursor-pointer font-semibold">Connection history <span className="font-normal text-muted">({history.length})</span></summary>
      <p className="mt-3 text-sm text-muted">Previous connections and unused attempts. Their saved Payments are preserved.</p>
      <ul className="mt-3 divide-y divide-line">{history.map(connection => {
        return <li key={connection.connectionId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div className="min-w-0"><p className="break-words font-medium">{connection.sellerLabel ?? "Unused Square attempt"}</p><p className="text-xs text-muted">{connection.businessEntityLabel} · {connectionLabels[connection.state]}{connection.paymentCount !== null ? ` · ${connection.paymentCount} saved Payments` : ""}</p></div>
          <a className="text-sm font-medium text-vaeroex-blue underline" href={squarePaymentsHref(connection.connectionId)}>View saved Payments</a>
        </li>;
      })}</ul>
    </details> : null}
    <p className="text-xs text-muted">Source: Square Production. Square is optional; other workspace inputs remain available.</p>
  </main>;
}
