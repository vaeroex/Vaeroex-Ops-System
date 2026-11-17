import type { SquareRecurringView } from "@/lib/integrations/square-direct/recurring-contracts";
import { ReportingRefreshTime } from "./ReportingRecurringSettings";

const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vaeroex-blue";
function ConsentForm({ connectionId, enable, renew = false }: { connectionId: string; enable: boolean; renew?: boolean }) {
  return <form method="post" action="/api/integrations/square/recurring-settings" className="space-y-3" aria-label={renew ? "Renew automatic Payments authorization" : "Automatic Payments authorization"}>
    <input type="hidden" name="connectionId" value={connectionId}/><input type="hidden" name="enabled" value={enable ? "true" : "false"}/>
    <label className="flex min-h-11 items-start gap-2 text-sm leading-6"><input type="checkbox" name="confirmation" required
      value={enable ? "enable-recurring" : "disable-recurring"} className="mt-1 h-4 w-4 shrink-0"/>
      <span>{enable ? "I authorize Vaeroex to use this Square connection for recurring, read-only Payments updates at the selected location, until I turn this off or disconnect."
        : "Turn off automatic Payments updates for this connection. Keep Payments already saved in this workspace."}</span>
    </label>
    <button type="submit" className={button}>{renew ? "Renew automatic Payments authorization" : enable ? "Enable automatic Payments updates" : "Turn off automatic Payments updates"}</button>
  </form>;
}

export function SquareRecurringSettings({ view, timeZone, canRead, asOf = new Date().toISOString() }: {
  view: SquareRecurringView; timeZone: string; canRead: boolean; asOf?: string;
}) {
  const status = view.status;
  if (!status) return view.rolloutAllowed ? <p role="status" className="text-sm text-muted">Automatic Payments settings are unavailable. Existing manual reads and saved Payments are unchanged.</p> : null;
  if (!view.rolloutAllowed && !status.recurring_enabled) return null;
  const active = status.recurring_enabled && status.authorized && status.reason === "active" && view.rolloutAllowed;
  const renew = status.recurring_enabled && status.reason === "owner_unavailable" && view.rolloutAllowed && canRead;
  const lastComplete = status.last_successful_refresh_at;
  const stale = lastComplete && Date.parse(asOf) - Date.parse(lastComplete) > 75 * 60 * 1000;
  const pause = !view.rolloutAllowed ? "The current rollout does not permit automatic Payments reads."
    : status.reason === "owner_unavailable" ? "The owner who authorized automatic reads no longer has the required access. A current owner can authorize them again."
      : status.reason === "entitlement_unavailable" ? "The workspace does not currently have the required subscription access."
        : status.manual_read_in_progress ? "Finish the manual historical Payments read before automatic ongoing updates can resume."
          : status.reason === "configuration_unavailable" ? "Automatic reads are unavailable while Square configuration is paused."
            : "Check the Square connection and its authorization before further automatic reads.";
  return <section aria-labelledby="square-automatic-payments" className="min-w-0 space-y-3 rounded-md border border-line p-3 sm:p-4">
    <h3 id="square-automatic-payments" className="font-semibold">Automatic Payments updates</h3>
    <p className="text-sm">{status.recurring_enabled ? active ? "On" : "Paused" : "Off — enable only with your permission."}</p>
    <p className="text-sm text-muted">About once an hour, Vaeroex reads Payments updated at the selected Square location, overlapping the previous checkpoint by five minutes. The first read covers up to 30 days; catch-up reads cover at most 31 days at a time.</p>
    <p className="text-sm text-muted">Each scheduled attempt reads up to four pages. An unfinished automatic read resumes on a later scheduler check, normally every 15 minutes. A saved page is progress, not a completed search. Older Payments outside these windows require a separate historical import.</p>
    <dl className="space-y-2 text-sm">
      <div><dt className="text-muted">Last completed ongoing update</dt><dd><ReportingRefreshTime value={lastComplete} timeZone={timeZone}/></dd></div>
      {status.recurring_last_attempt_at ? <div><dt className="text-muted">Last automatic attempt</dt><dd><ReportingRefreshTime value={status.recurring_last_attempt_at} timeZone={timeZone}/></dd></div> : null}
      {active && status.recurring_next_refresh_at ? <div><dt className="text-muted">Next automatic attempt, no earlier than</dt><dd><ReportingRefreshTime value={status.recurring_next_refresh_at} timeZone={timeZone}/></dd></div> : null}
    </dl>
    {!lastComplete ? <p className="text-sm text-muted">No completed ongoing update has been recorded. This does not establish that there were no Payments.</p> : null}
    {status.has_more ? <p role="status" className="text-sm text-amber-800">The current search is incomplete. Saved pages remain available; the last completed update above does not advance until every page finishes.</p> : null}
    {stale ? <p className="text-sm text-amber-800">The completed update is older than the expected schedule. Treat saved Payments as last-known records and inspect the search coverage below.</p> : null}
    {status.recurring_failure_count > 0 ? <p role="status" className="text-sm text-amber-800">The latest automatic attempt did not finish. Saved Payments and the last complete checkpoint were kept. {active ? "A retry will wait for the required delay." : "Automatic retries are paused."}</p> : null}
    {status.recurring_enabled && !active ? <p className="text-sm text-muted">{pause} Your saved Payments are retained.</p> : null}
    <p className="text-xs text-muted">These are payment records, not accounting revenue, profit, cash flow, or settled deposits. A successful page save does not establish complete coverage.</p>
    {renew ? <ConsentForm connectionId={view.connectionId} enable renew/> : null}
    {status.recurring_enabled ? <ConsentForm connectionId={view.connectionId} enable={false}/>
      : view.rolloutAllowed && canRead && !status.manual_read_in_progress ? <ConsentForm connectionId={view.connectionId} enable/> : null}
  </section>;
}
