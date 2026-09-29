import type { DirectView } from "@/lib/integrations/square-direct/contracts";

const connectionLabels = {
  consent_pending: "Waiting for Square authorization",
  exchanging: "Finishing Square authorization",
  mapping_required: "Choose a Square location",
  connected: "Connected",
  syncing: "Reading Square Payments",
  retry_required: "Payments update needs another attempt",
  reauthorization_required: "Square authorization needs renewal",
  disconnected: "Disconnected",
} as const;

/** Preserve Square's integer minor units without a floating-point conversion. */
export function squarePaymentAmount(amountMinor: string | null, currency: string | null): string {
  if (!amountMinor || !/^-?(?:0|[1-9]\d*)$/.test(amountMinor) || !currency || !/^[A-Z]{3}$/.test(currency)) {
    return "Amount unavailable";
  }
  try {
    const exponent = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (exponent === undefined) return "Amount unavailable";
    const amount = BigInt(amountMinor);
    const absolute = amount < BigInt(0) ? -amount : amount;
    const scale = BigInt(10) ** BigInt(exponent);
    const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(absolute / scale);
    const fraction = exponent ? `.${(absolute % scale).toString().padStart(exponent, "0")}` : "";
    return `${currency} ${amount < BigInt(0) ? "-" : ""}${whole}${fraction}`;
  } catch {
    return "Amount unavailable";
  }
}

function timestamp(value: string | null): string {
  if (!value) return "Not yet synced";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Time unavailable" : parsed.toISOString().replace("T", " ").replace(/(?:\.000)?Z$/, " UTC");
}

function paymentWindow(read: { start: string; end: string; kind: "created" | "updated" }): string {
  return `Payments ${read.kind} from ${timestamp(read.start)} ${read.kind === "created" ? "up to (not including)" : "through"} ${timestamp(read.end)}`;
}

function emptyPaymentsExplanation(connection: DirectView["connections"][number]): string {
  if (connection.activeRead) {
    return `No Payments have been saved for this connection yet. The current search checks ${paymentWindow(connection.activeRead)}. This search is still incomplete.`;
  }
  if (connection.lastCompletedRead) {
    return `No Payments have been saved for this connection. The last completed search checked ${paymentWindow(connection.lastCompletedRead)} for the selected location. Older Payments may be outside these dates.`;
  }
  return "No Payments have been saved for this connection. No completed search dates are available, so this does not establish whether older Payments exist in Square.";
}

const buttonClass = "rounded-md border border-line px-4 py-2 text-sm font-semibold";

export function SquareDirectCustomerPanel({ view }: { view: DirectView }) {
  const entities = new Map(view.businessEntities.map(entity => [entity.id, entity.label]));
  const connectableEntities = view.connections.every(connection =>
    connection.state === "disconnected" && !connection.revocationPending && !connection.recoveryRequired) ? view.businessEntities : [];

  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold text-ink">Square connection and Payments</h1>
      <p className="text-sm text-muted">Connect your Square account, choose its location, and view that location’s Payments in this workspace.</p>
    </header>
    {!view.available ? <p role="status">New Square connections and Payments updates are unavailable for this workspace. Saved Payments and existing connection status remain available.</p> : null}
      {view.connections.length === 0 ? <p role="status">No Square account is connected to this workspace.</p> : null}
      {view.connections.map(connection => <section key={connection.connectionId} className="space-y-4 rounded-lg border border-line p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{connection.sellerLabel ?? "Square account"}</h2>
          <p>Business Entity: {entities.get(connection.businessEntityId) ?? "Unavailable"}</p>
          <p role="status">{connection.recoveryRequired ? "Authorization recovery required" : connectionLabels[connection.state]}</p>
          <p className="text-sm text-muted">Source: Square Production · Last successful sync: {timestamp(connection.lastSyncedAt)}</p>
          {connection.checkpointAt ? <p className="text-sm text-muted">Ongoing Payments updates resume from: {timestamp(connection.checkpointAt)}</p> : null}
          {connection.lastError ? <p role="status">The last attempt did not finish. Your last successfully saved Payments remain below.</p> : null}
        </div>
        {connection.recoveryRequired ? <p role="status">Square authorization outcome and this workspace’s account connection are unconfirmed. Contact support for checked recovery before taking any further connection action.</p> : null}

        {view.available && !connection.recoveryRequired && connection.state === "mapping_required" ? <form action="/api/integrations/square/mapping" method="post" className="space-y-3">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <label className="block font-semibold">Square location
            <select name="locationId" required defaultValue="" className="mt-2 block w-full rounded-md border border-line px-3 py-2">
              <option value="" disabled>Select a location</option>
              {connection.locations.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </label>
          <p className="text-sm">Only Payments for the selected location will be saved to this Business Entity.</p>
          <button type="submit" disabled={connection.locations.length === 0} className={buttonClass}>Confirm location</button>
          {connection.locations.length === 0 ? <p role="status">No available Square location was returned. Disconnect before connecting a different account.</p> : null}
        </form> : null}

        {connection.locationId ? <p>Location: {connection.locations.find(location => location.id === connection.locationId)?.label ?? "Selected Square location"}</p> : null}
        {connection.activeRead ? <p role="status" className="text-sm">Current search: {paymentWindow(connection.activeRead)}. The search is incomplete until every page has been read.</p> : null}
        {connection.lastCompletedRead ? <p className="text-sm text-muted">Last completed search: {paymentWindow(connection.lastCompletedRead)}. Completed: {timestamp(connection.lastCompletedRead.completedAt)}. This covers only that date window and the selected location.</p> : null}
        {view.available && !connection.recoveryRequired && (connection.state === "connected" || connection.state === "retry_required") && connection.locationId && !connection.revocationPending ? <form action="/api/integrations/square/read" method="post" className="space-y-2">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <button type="submit" className={buttonClass}>{connection.hasMore ? "Read next Payments page" : connection.activeRead ? "Continue Payments read" : connection.lastSyncedAt ? "Update Payments" : "Read Payments"}</button>
          <p className="text-sm text-muted">Each request reads one page of up to 100 Payments. {connection.hasMore || connection.activeRead ? "Continue the current search to finish its date window." : "Updates search by the date a Payment was updated, resuming from the saved checkpoint. Older Payments may need a historical import."}</p>
        </form> : null}
        {view.available && view.historyAvailable && !connection.recoveryRequired && (connection.state === "connected" || connection.state === "retry_required") && connection.locationId && !connection.revocationPending && !connection.activeRead && !connection.hasMore ? <form action="/api/integrations/square/read" method="post" className="space-y-3 rounded-md border border-line p-4">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <h3 className="font-semibold">Import historical Payments</h3>
          <p id={`history-dates-${connection.connectionId}`} className="text-sm text-muted">Choose 1–31 calendar days, including both dates, in UTC. This searches when Payments were created at the selected location and keeps the saved checkpoint for ongoing updates.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">Start date (UTC)
              <input type="date" name="startDate" required aria-describedby={`history-dates-${connection.connectionId}`} className="mt-2 block w-full rounded-md border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-semibold">End date (UTC)
              <input type="date" name="endDate" required aria-describedby={`history-dates-${connection.connectionId}`} className="mt-2 block w-full rounded-md border border-line px-3 py-2" />
            </label>
          </div>
          <p className="text-sm text-muted">Each request imports one page of up to 100 Payments. Continue with “Read next Payments page” if more results remain.</p>
          <button type="submit" className={buttonClass}>Import historical Payments</button>
        </form> : null}
        {connection.state === "syncing" || connection.state === "exchanging" ? <form action="/app/settings/integrations/square" method="get">
          <button type="submit" className="text-sm underline">Refresh connection status</button>
        </form> : null}
        {!connection.recoveryRequired && connection.state === "reauthorization_required" ? <p>Disconnect this connection, then connect again to renew Square authorization.</p> : null}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="pb-2 text-left font-semibold">Saved Square Payments · {connection.payments.length} shown</caption>
            <thead><tr className="border-b border-line"><th scope="col" className="px-2 py-2">Payment</th><th scope="col" className="px-2 py-2">Created (UTC)</th><th scope="col" className="px-2 py-2">Square status</th><th scope="col" className="px-2 py-2">Payment amount</th></tr></thead>
            <tbody>{connection.payments.map(payment => <tr key={payment.id} className="border-b border-line">
              <td className="break-all px-2 py-2">{payment.id}</td>
              <td className="whitespace-nowrap px-2 py-2">{timestamp(payment.createdAt)}</td>
              <td className="px-2 py-2">{payment.status}</td>
              <td className="whitespace-nowrap px-2 py-2">{squarePaymentAmount(payment.amountMinor, payment.currency)}</td>
            </tr>)}</tbody>
          </table>
          {connection.payments.length === 0 ? <p className="py-3 text-sm">{emptyPaymentsExplanation(connection)}</p> : null}
        </div>
        <p className="text-xs text-muted">These are Square Payment records, not revenue, profit, settlement totals, or accounting statements. Older saved records may not reflect later provider changes until the next successful update.</p>

        {!connection.recoveryRequired && connection.revocationPending ? <p role="status">Disconnected locally. Square authorization revocation is still pending; reconnect is blocked until it completes.</p> : null}
        {!connection.recoveryRequired && (connection.state !== "disconnected" || connection.revocationPending) ? <form action="/api/integrations/square/disconnect" method="post" className="space-y-3 border-t border-line pt-4">
          <input type="hidden" name="connectionId" value={connection.connectionId} />
          <label className="flex gap-2"><input type="checkbox" name="confirmation" value="disconnect" required />
            <span>I confirm disconnecting this Square connection. Saved Payments are retained; further reads stop.</span>
          </label>
          <button type="submit" className={`${buttonClass} text-red-700`}>{connection.revocationPending ? "Retry Square revocation" : "Disconnect Square"}</button>
        </form> : null}
      </section>)}
      {view.available && connectableEntities.length > 0 ? <form action="/api/integrations/square/connect" method="post" className="space-y-3 rounded-lg border border-line p-4">
        <label className="block font-semibold">Business Entity
          <select name="businessEntityId" required defaultValue="" className="mt-2 block w-full rounded-md border border-line px-3 py-2">
            <option value="" disabled>Select a Business Entity</option>
            {connectableEntities.map(entity => <option key={entity.id} value={entity.id}>{entity.label}</option>)}
          </select>
        </label>
        <p className="text-sm">Only an eligible owner of this workspace can connect. You will authorize access on Square; never enter your Square password or access token in Vaeroex.</p>
        <button type="submit" className="rounded-md bg-vaeroex-blue px-4 py-2 font-semibold text-white">Connect Square</button>
      </form> : null}
  </main>;
}
