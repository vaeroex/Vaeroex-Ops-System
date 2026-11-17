import { isHistoricalProvider, isProvider, type Provider } from "@/lib/integrations/reporting/catalog";
import { dashboardTimestamp } from "@/lib/integrations/dashboard/model";

export type ReportingRecurringState = {
  recurring_enabled: boolean;
  recurring_authorized_at: string | null;
  recurring_next_refresh_at: string | null;
  recurring_last_attempt_at: string | null;
  recurring_failure_count: number;
  recurring_last_failure_at: string | null;
};
export type ReportingRecurringAuthority = {
  authorized: boolean;
  reason: "active" | "owner_unavailable" | "entitlement_unavailable" | "disabled" | "connection_unavailable";
};

/** Match the integration dashboard: configured workspace zone, otherwise explicit UTC. */
export function ReportingRefreshTime({ value, timeZone }: { value: string | null; timeZone?: string | null }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <>Not yet recorded</>;
  let zone = timeZone || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); } catch { zone = "UTC"; }
  return <time dateTime={value} title={value}>{dashboardTimestamp(value, zone)}</time>;
}

const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50";

export function ReportingRecurringSettings({ provider, connectionId, state, authority, owner, allowed, connected, lastSuccess, timeZone, asOf }: {
  provider: Provider | "loyverse" | "zoho-books" | "wix-orders";
  connectionId: string;
  state: ReportingRecurringState;
  authority: ReportingRecurringAuthority | null;
  owner: boolean;
  allowed: boolean;
  connected: boolean;
  lastSuccess: string | null;
  timeZone?: string | null;
  asOf: string;
}) {
  const historical = isProvider(provider) ? isHistoricalProvider(provider) : true;
  const importCoverage = provider === "loyverse"
    ? "Receipts are selected by their creation date on Loyverse's server, which can differ from the receipt date. Totals are receipt activity, not accounting revenue or profit."
    : provider === "zoho-books"
      ? "Refresh covers supported USD invoices and expenses by their provider dates. Outstanding amounts are balances when imported, not historical closing balances."
      : provider === "wix-orders"
        ? "Refresh covers approved orders created in that window, separated by currency. Payment status is not bank settlement; refund transactions are not included."
        : null;
  const active = state.recurring_enabled && allowed && connected && authority?.authorized === true && authority.reason === "active";
  const authorityUnknown = state.recurring_enabled && allowed && connected && !authority;
  const renewalNeeded = state.recurring_enabled && allowed && connected && authority?.reason === "owner_unavailable";
  const cadenceMs = (historical ? 24 : 6) * 60 * 60 * 1000;
  const overdue = active && lastSuccess && Date.parse(asOf) - Date.parse(lastSuccess) > cadenceMs + 15 * 60 * 1000;
  return <section aria-labelledby={`${provider}-automatic-refresh`} className="min-w-0 space-y-3 rounded-md border border-line p-3 sm:p-4">
    <h3 id={`${provider}-automatic-refresh`} className="font-semibold">Automatic refresh</h3>
    <p className="text-sm">{state.recurring_enabled ? active ? "On" : authorityUnknown ? "Status unavailable" : "Paused" : "Off — enable only with your permission."}</p>
    <p className="text-sm text-slate-600">{historical
      ? "Once a day, Vaeroex rereads the last seven completed UTC calendar dates. This picks up changes within that window. Today and older dates are not refreshed automatically; you can import them separately below."
      : "Every six hours, Vaeroex reads the supported current snapshot. Each successful refresh replaces the snapshot; it does not reconstruct past inventory, project totals, or activity."}</p>
    {importCoverage ? <p className="text-sm text-slate-600">{importCoverage}</p> : null}
    <dl className="space-y-2 text-sm">
      <div><dt className="text-slate-600">Last successful refresh</dt><dd className="break-words"><ReportingRefreshTime value={lastSuccess} timeZone={timeZone}/></dd></div>
      {state.recurring_last_attempt_at ? <div><dt className="text-slate-600">Last automatic attempt</dt><dd className="break-words"><ReportingRefreshTime value={state.recurring_last_attempt_at} timeZone={timeZone}/></dd></div> : null}
      {active && state.recurring_next_refresh_at ? <div><dt className="text-slate-600">Next automatic attempt, no earlier than</dt><dd className="break-words"><ReportingRefreshTime value={state.recurring_next_refresh_at} timeZone={timeZone}/></dd></div> : null}
    </dl>
    {!lastSuccess ? <p className="text-sm text-slate-600">No successful refresh has been recorded. This does not establish that there was no activity.</p> : null}
    {overdue ? <p className="text-sm text-amber-700 dark:text-amber-300">The last successful refresh is older than the scheduled interval. Treat the saved evidence as last-known information.</p> : null}
    {state.recurring_failure_count > 0 ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">The latest automatic refresh did not complete. Previously saved information and its original date were kept. {active ? "Vaeroex will retry after a delay." : "Automatic retries are paused."}</p> : null}
    {state.recurring_enabled && !active ? <p className="text-sm text-slate-600">{authorityUnknown
      ? "Automatic refresh status could not be verified. Check again before relying on the schedule."
      : !connected ? "Automatic access is paused. Reconnect before scheduled reads can resume."
      : !allowed ? "Automatic access is paused. The current rollout does not permit scheduled reads."
      : renewalNeeded ? "Automatic access is paused because the owner who authorized it no longer has the required access. A current workspace owner can authorize it again."
      : authority?.reason === "entitlement_unavailable" ? "Automatic access is paused because this workspace does not currently have the required subscription access."
      : "Automatic access is paused. Check the connection and its authorization before trying again."} {owner ? "You can turn off your saved authorization below." : "A workspace owner can turn off the saved authorization."}</p> : null}
    <p className="text-xs text-slate-600">{historical ? "Report dates and coverage remain attached to each import." : "The capture time describes this snapshot, not a historical reporting period."} Refreshes can be delayed by provider limits or service availability. Failed attempts do not update the evidence date.</p>
    {owner && renewalNeeded ? <form method="post" action={`/api/integrations/${provider}/recurring-settings`} className="space-y-3" aria-label="Renew automatic refresh authorization">
      <input type="hidden" name="connectionId" value={connectionId}/>
      <input type="hidden" name="enabled" value="true"/>
      <label className="flex min-h-11 items-start gap-2 text-sm leading-6">
        <input type="checkbox" name="confirmation" value="enable-recurring" required className="mt-1 h-4 w-4 shrink-0"/>
        <span>I authorize Vaeroex to resume recurring, read-only access to the supported information described above, until I turn it off or disconnect.</span>
      </label>
      <button type="submit" className={button}>Renew automatic refresh authorization</button>
    </form> : null}
    {owner && (state.recurring_enabled || allowed && connected) ? <form method="post" action={`/api/integrations/${provider}/recurring-settings`} className="space-y-3" aria-label="Automatic refresh authorization">
      <input type="hidden" name="connectionId" value={connectionId}/>
      <input type="hidden" name="enabled" value={state.recurring_enabled ? "false" : "true"}/>
      <label className="flex min-h-11 items-start gap-2 text-sm leading-6">
        <input type="checkbox" name="confirmation" value={state.recurring_enabled ? "disable-recurring" : "enable-recurring"} required className="mt-1 h-4 w-4 shrink-0"/>
        <span>{state.recurring_enabled
          ? "Turn off scheduled reads for this connection. Keep information already saved in this workspace."
          : "I authorize Vaeroex to use this connection for recurring, read-only access to the supported information described above, until I turn it off or disconnect."}</span>
      </label>
      <button type="submit" className={button}>{state.recurring_enabled ? "Turn off automatic refresh" : "Enable automatic refresh"}</button>
    </form> : !owner ? <p className="text-sm text-slate-600">Only a workspace owner can change automatic refresh authorization.</p> : null}
  </section>;
}
