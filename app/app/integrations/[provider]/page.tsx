import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { DateRangeFields, SavedHistoryFilter } from "@/components/integrations/DateRangeFields";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { catalog, isHistoricalProvider, isProvider, type Account, type Metric, type Provider, type Snapshot } from "@/lib/integrations/reporting/catalog";
import { admin, available, unseal, accountSchema } from "@/lib/integrations/reporting/security";
import { validateSnapshot } from "@/lib/integrations/reporting/adapters";
import { resolveImportRange, resolveViewRange } from "@/lib/integrations/date-range";
import { z } from "zod";

export const dynamic = "force-dynamic";
const messages: Record<string,string> = {
  connected: "Connected. Sync to load your report.", choose_account: "Choose which account to connect to this workspace.",
  synced: "Report updated.", disconnected: "Disconnected. Stored credentials and report removed from this workspace. Revoke the app or key in the provider's settings to remove its permission there.",
  configuration_required: "Setup is not complete yet.", connection_exists: "A connection already exists. Finish or cancel it before starting again.",
  sync_wait: "A sync is running or the hourly reading window has not reopened yet.", quota_exceeded: "The provider's free API quota was reached. Wait before syncing again; no upgrade was requested.",
  snapshot_too_large: "This account exceeds the current report size limit. The previous complete report was kept.",
  invalid_date_range: "Choose valid start and end dates, with no future dates and no more than 366 calendar days per import. Older dates are welcome.",
  authorization_required: "Authorization expired. Disconnect this connection and authorize it again.", authorization_failed: "Authorization did not finish. Cancel any pending connection and try again.",
  sync_failed: "The action could not be confirmed. Check the saved report and last import time before trying again when the next sync is available."
};
const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50";
const historySchema = z.object({
  hasHistory: z.boolean(),
  metrics: z.array(z.object({ key: z.string(), value: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict()),
  coverage: z.object({
    days: z.number().int().nonnegative(), completeDays: z.number().int().nonnegative(), incompleteDays: z.number().int().nonnegative(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    lastImportedAt: z.string().nullable(), coveredThrough: z.string().nullable()
  }).strict(),
  records: z.number().int().nonnegative()
}).strict();
type HistoryReport = z.infer<typeof historySchema>;

function Metrics({ provider, metrics, label = "Report totals" }: { provider: Provider; metrics: Metric[]; label?: string }) {
  return <dl aria-label={label} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(metric => <div key={`${metric.key}:${metric.currency ?? ""}`}>
    <dt className="text-sm text-slate-600">{catalog[provider].metrics[metric.key]}{metric.currency ? ` (${metric.currency})` : ""}</dt>
    <dd className="text-2xl font-semibold">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(metric.value)}</dd>
  </div>)}</dl>;
}

function LegacySummary({ provider, report }: { provider: Provider; report: Snapshot }) {
  return <div className="space-y-3">
    <p className="text-sm text-slate-600">Saved before historical imports were available: {report.start.slice(0, 10)} through {report.end.slice(0, 10)}. This older summary is separate from the filter and totals above. Import these dates again to include them in searchable history.</p>
    <Metrics provider={provider} metrics={report.metrics} label="Earlier summary totals"/>
  </div>;
}

function coverageDescription(history: HistoryReport, startDate: string | null, endDate: string | null) {
  const coverage = history.coverage;
  if (!coverage.days || !coverage.startDate || !coverage.endDate) return "No dates have been imported for this selection. This does not mean there was no business activity.";
  const first = startDate ?? coverage.startDate, last = endDate ?? coverage.endDate;
  const selectedDays = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
  const missingDays = Math.max(0, selectedDays - coverage.days);
  const missing = missingDays
    ? `${missingDays} ${missingDays === 1 ? "date has" : "dates have"} not been imported in ${startDate ? "this selection" : "that span"}; totals cover imported dates only.`
    : coverage.incompleteDays === 0 ? "Every date in this selection has a complete import." : "";
  const partial = coverage.incompleteDays > 0
    ? `${coverage.incompleteDays} imported ${coverage.incompleteDays === 1 ? "date has" : "dates have"} partial coverage, containing only data available through its import cutoff. Reimport those dates to refresh them; zero totals on partial dates are not full-day totals.`
    : "";
  return `${coverage.days} calendar ${coverage.days === 1 ? "date" : "dates"} imported, from ${coverage.startDate} through ${coverage.endDate}. ${missing} ${partial}`.trim();
}

export default async function ReportingPage({ params, searchParams }: { params: Promise<{provider:string}>; searchParams: Promise<{result?:string;from?:string;to?:string}> }) {
  const {provider} = await params; if (!isProvider(provider)) notFound();
  const access = await requireWorkspacePage(), owner = access.context.membership?.role === "owner";
  const info = catalog[provider], enabled = available(provider), query = await searchParams;
  const historical = isHistoricalProvider(provider), now = new Date(), maxDate = now.toISOString().slice(0, 10);
  const messageFor = (code: string) => historical && code === "snapshot_too_large"
    ? "This import exceeds the current report size limit. Choose a smaller date range. Previously imported history and the last complete report were kept."
    : messages[code] ?? messages.sync_failed;
  const defaultImport = resolveImportRange(undefined, undefined, now);
  let viewRange: { startDate: string | null; endDate: string | null } = { startDate: null, endDate: null }, invalidView = false;
  try { viewRange = resolveViewRange(query.from, query.to, now); } catch { invalidView = true; }
  const {data: row,error} = await access.supabase.from("reporting_connections").select("id,status,account,snapshot,last_sync_at,last_error_code,next_sync_at,created_by")
    .eq("workspace_id", access.workspaceId).eq("provider", provider).neq("status","disconnected").maybeSingle();
  let choices: Account[] = [], choiceError = false;
  if (owner && enabled && row?.status === "choose_account" && row.created_by === access.context.membership?.user_id) {
    try {
      const saved = await admin().from("reporting_credentials").select("ciphertext").eq("workspace_id",access.workspaceId).eq("provider",provider).eq("connection_id",row.id).single();
      if (saved.error || !saved.data) throw new Error("missing_credential");
      choices = unseal(provider,access.workspaceId,row.id,saved.data.ciphertext).accounts ?? [];
    } catch { choiceError = true; }
  }
  let report = null;
  try { if(row?.snapshot) report = validateSnapshot(provider,row.snapshot); } catch { /* Unvalidated snapshots never render. */ }
  let history: HistoryReport | null = null, historyError = false;
  if (historical && row && !invalidView) {
    const saved = await access.supabase.rpc("read_reporting_history", {
      p_workspace: access.workspaceId, p_provider: provider, p_connection: row.id,
      p_start_date: viewRange.startDate, p_end_date: viewRange.endDate
    });
    const parsed = historySchema.safeParse(saved.data);
    if (saved.error || !parsed.success || parsed.data.metrics.some(metric => !(metric.key in info.metrics) || (provider === "xero") !== Boolean(metric.currency))) historyError = true;
    else history = parsed.data;
  }
  const savedAccount = accountSchema.safeParse(row?.account);
  const path = `/api/integrations/${provider}`;
  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title={info.name} description={info.description} actions={<Link href="/app/integrations" className={button}>All plug-ins</Link>} />
    {query.result && messages[query.result] ? <p role="status" className="rounded-md border border-line p-3 text-sm">{query.result === "synced" && historical ? "Import complete. Your saved history is ready to filter below." : messageFor(query.result)}</p> : null}
    <SectionCard title="Connection" description={info.permission}>
      {error ? <p role="alert">Connection status is unavailable.</p> : row ? <div className="space-y-4">
        <p className="font-semibold">{row.status === "connected" ? "Connected" : row.status === "pending" ? "Waiting for authorization" : row.status === "choose_account" ? "Choose an account" : "Reauthorization required"}{savedAccount.success ? ` · ${savedAccount.data.name}` : ""}</p>
        {choiceError ? <p role="alert">Account choices are unavailable. Cancel this connection and try again.</p> : null}
        {choices.map(a => <form key={`${a.parent ?? ""}:${a.id}`} method="post" action={`${path}/select-account`}>
          <input type="hidden" name="connectionId" value={row.id}/><input type="hidden" name="accountId" value={a.id}/><input type="hidden" name="parent" value={a.parent ?? ""}/>
          <input type="hidden" name="confirmation" value="select"/><button className={button} type="submit">Connect {a.name}</button>
        </form>)}
        {row.last_error_code ? <p role="alert">{messageFor(row.last_error_code)}</p> : null}
        {owner && row.status === "connected" && enabled ? <form method="post" action={`${path}/sync`} className="space-y-3">
          <input type="hidden" name="connectionId" value={row.id}/>
          {historical ? <>
            <h3 className="font-semibold">Import business history</h3>
            <p className="text-sm text-slate-600">Import additional ranges to build your history. Reimporting a range updates those records; saved history outside it is kept.</p>
            <DateRangeFields idPrefix={`${provider}-import`} defaultStartDate={defaultImport.startDate} defaultEndDate={defaultImport.endDate} maxDate={maxDate}/>
            <p className="text-xs text-slate-600">Availability depends on the provider and your account permissions. If a range is too large for one import, choose a smaller range.</p>
          </> : null}
          <button className={button} type="submit" disabled={Date.parse(row.next_sync_at)>Date.now()}>{historical ? "Import selected dates" : "Sync report"}</button>
          <p className="mt-2 text-xs text-slate-600">Manual updates are limited to once per hour. {Date.parse(row.next_sync_at)>Date.now() ? `Next available: ${new Date(row.next_sync_at).toISOString()}` : ""}</p>
        </form> : null}
        {owner ? <form method="post" action={`${path}/disconnect`} className="space-y-3">
          <input type="hidden" name="connectionId" value={row.id}/>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmation" value="disconnect" required className="h-4 w-4 shrink-0"/>{historical ? "Remove this connection, its stored credentials, and all its imported history." : "Remove this connection, its stored credentials, and its report."}</label>
          <button className={button} type="submit">{row.status === "pending" || row.status === "choose_account" ? "Cancel connection" : "Disconnect"}</button>
        </form> : null}
      </div> : !enabled ? <p className="text-sm text-slate-600">Setup is not complete yet. This plug-in will become available after its secure configuration and provider checks are finished.</p> : owner ?
        <form method="post" action={`${path}/connect`} className="space-y-4">
          {info.auth === "key" ? <label className="block text-sm">API key<input className="mt-1 block w-full rounded-md border border-line p-3" type="password" name="apiKey" autoComplete="off" minLength={10} maxLength={8192} required/></label> : null}
          {provider === "toggl" ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Toggl organization ID<input className="mt-1 block w-full rounded-md border border-line p-3" name="organizationId" pattern="[0-9]{1,15}" required/></label>
            <label className="text-sm">Toggl workspace ID<input className="mt-1 block w-full rounded-md border border-line p-3" name="accountId" pattern="[0-9]{1,15}" required/></label>
          </div> : null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmation" value="connect" required className="mt-1 h-4 w-4 shrink-0"/>I authorize Vaeroex to read the described data and securely store this connection for this workspace.</label>
          <button className={button} type="submit">Connect {info.name}</button>
        </form> : <p>The workspace owner can connect this plug-in.</p>}
    </SectionCard>
    {historical && row ? <SectionCard title="Saved report history" description="Filter dates already imported into this workspace. Changing this filter does not request data from the provider.">
      <div className="space-y-4">
        <SavedHistoryFilter action={`/app/integrations/${provider}`} startDate={viewRange.startDate} endDate={viewRange.endDate} maxDate={maxDate}/>
        {invalidView ? <p role="alert">Choose valid start and end dates for the report filter, or select all imported history.</p>
          : historyError ? <p role="alert">Saved history is unavailable right now. Your imported data has not been removed.</p>
          : history ? <>
            <p className="text-sm">{coverageDescription(history, viewRange.startDate, viewRange.endDate)}</p>
            {history.coverage.days > 0 ? <>
              <Metrics provider={provider} metrics={history.metrics} label="Saved history totals"/>
              <p className="text-xs text-slate-600">{provider === "xero" ? "Invoices and bills are grouped by their provider dates. Outstanding amounts are the balances when those invoices were last imported, not historical balances as of the selected dates."
                : provider === "clockify" ? "Completed entries are grouped by their start date in UTC and cover the API key owner's entries only."
                : "Time entries are grouped by their Harvest spent date and limited by the connected user's permissions."} Today may be partial. Reimport a period to pick up later changes.</p>
              <p className="text-xs text-slate-600">Most recent import affecting this selection: {history.coverage.lastImportedAt ?? "Unavailable"}.</p>
            </> : null}
          </> : null}
        {report ? history?.hasHistory === false ? <div className="space-y-3 rounded-md border border-line p-4">
          <h3 className="font-semibold">Previous seven-day report</h3>
          <LegacySummary provider={provider} report={report}/>
        </div> : <details className="space-y-3 rounded-md border border-line p-4">
          <summary className="cursor-pointer font-semibold">Earlier saved summary</summary>
          <LegacySummary provider={provider} report={report}/>
        </details> : null}
        <p className="text-xs text-slate-600">Imported history stays saved when you log out or import another period. Disconnecting with removal deletes it. {provider === "clockify" ? "Saved summaries may provide VSI context, with their scope and freshness limits. They are not combined into financial KPIs or Business Health." : "These provider summaries are shown here; they are not combined with other plug-ins, added to financial KPIs, or sent to VSI chat."}</p>
      </div>
    </SectionCard> : null}
    {!historical && report && row ? <SectionCard title="Last complete report" description={report.start === report.end ? `Snapshot at ${report.end}` : `${report.start.slice(0,10)} through ${report.end.slice(0,10)}.`}>
      <Metrics provider={provider} metrics={report.metrics}/>
      <p className="mt-4 text-xs text-slate-600">Last successful sync: {row.last_sync_at}. {provider === "zoho-inventory" ? "Saved summaries may provide VSI context, with their scope and freshness limits. They are not combined into financial KPIs or Business Health." : "These provider summaries are shown here; they are not combined with other plug-ins, added to financial KPIs, or sent to VSI chat."}</p>
    </SectionCard> : null}
  </div>;
}
