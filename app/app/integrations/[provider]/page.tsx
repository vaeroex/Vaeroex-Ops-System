import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import { catalog, isProvider, type Account } from "@/lib/integrations/reporting/catalog";
import { admin, available, unseal, accountSchema } from "@/lib/integrations/reporting/security";
import { validateSnapshot } from "@/lib/integrations/reporting/adapters";

export const dynamic = "force-dynamic";
const messages: Record<string,string> = {
  connected: "Connected. Sync to load your report.", choose_account: "Choose which account to connect to this workspace.",
  synced: "Report updated.", disconnected: "Disconnected. Stored credentials and report removed from this workspace. Revoke the app or key in the provider's settings to remove its permission there.",
  configuration_required: "Setup is not complete yet.", connection_exists: "A connection already exists. Finish or cancel it before starting again.",
  sync_wait: "A sync is running or the hourly reading window has not reopened yet.", quota_exceeded: "The provider's free API quota was reached. Wait before syncing again; no upgrade was requested.",
  snapshot_too_large: "This account exceeds the current report size limit. The previous complete report was kept.",
  authorization_required: "Authorization expired. Disconnect this connection and authorize it again.", authorization_failed: "Authorization did not finish. Cancel any pending connection and try again.",
  sync_failed: "The action did not complete. Any previous complete report was kept. Please try again when the next sync is available."
};
const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-semibold text-vaeroex-blue disabled:opacity-50";
export default async function ReportingPage({ params, searchParams }: { params: Promise<{provider:string}>; searchParams: Promise<{result?:string}> }) {
  const {provider} = await params; if (!isProvider(provider)) notFound();
  const access = await requireWorkspacePage(), owner = access.context.membership?.role === "owner";
  const info = catalog[provider], enabled = available(provider), query = await searchParams;
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
  const savedAccount = accountSchema.safeParse(row?.account);
  const path = `/api/integrations/${provider}`;
  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title={info.name} description={info.description} actions={<Link href="/app/integrations" className={button}>All plug-ins</Link>} />
    {query.result && messages[query.result] ? <p role="status" className="rounded-md border border-line p-3 text-sm">{messages[query.result]}</p> : null}
    <SectionCard title="Connection" description={info.permission}>
      {error ? <p role="alert">Connection status is unavailable.</p> : row ? <div className="space-y-4">
        <p className="font-semibold">{row.status === "connected" ? "Connected" : row.status === "pending" ? "Waiting for authorization" : row.status === "choose_account" ? "Choose an account" : "Reauthorization required"}{savedAccount.success ? ` · ${savedAccount.data.name}` : ""}</p>
        {choiceError ? <p role="alert">Account choices are unavailable. Cancel this connection and try again.</p> : null}
        {choices.map(a => <form key={`${a.parent ?? ""}:${a.id}`} method="post" action={`${path}/select-account`}>
          <input type="hidden" name="connectionId" value={row.id}/><input type="hidden" name="accountId" value={a.id}/><input type="hidden" name="parent" value={a.parent ?? ""}/>
          <input type="hidden" name="confirmation" value="select"/><button className={button} type="submit">Connect {a.name}</button>
        </form>)}
        {row.last_error_code ? <p role="alert">{messages[row.last_error_code] ?? messages.sync_failed}</p> : null}
        {owner && row.status === "connected" && enabled ? <form method="post" action={`${path}/sync`}>
          <input type="hidden" name="connectionId" value={row.id}/><button className={button} type="submit" disabled={Date.parse(row.next_sync_at)>Date.now()}>Sync report</button>
          <p className="mt-2 text-xs text-slate-600">Manual updates are limited to once per hour. {Date.parse(row.next_sync_at)>Date.now() ? `Next available: ${new Date(row.next_sync_at).toISOString()}` : ""}</p>
        </form> : null}
        {owner ? <form method="post" action={`${path}/disconnect`} className="space-y-3">
          <input type="hidden" name="connectionId" value={row.id}/>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmation" value="disconnect" required className="h-4 w-4 shrink-0"/>Remove this connection, its stored credentials, and its report.</label>
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
    {report && row ? <SectionCard title="Last complete report" description={report.start === report.end ? `Snapshot at ${report.end}` : `${report.start.slice(0,10)} through ${report.end.slice(0,10)}. ${provider === "clockify" ? "Completed entries starting in this UTC date range; today is partial." : "Provider calendar dates; the current date is partial."}`}>
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{report.metrics.map(m => <div key={`${m.key}:${m.currency ?? ""}`}><dt className="text-sm text-slate-600">{info.metrics[m.key]}{m.currency ? ` (${m.currency})` : ""}</dt><dd className="text-2xl font-semibold">{new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(m.value)}</dd></div>)}</dl>
      <p className="mt-4 text-xs text-slate-600">Last successful sync: {row.last_sync_at}. These provider summaries are shown here; they are not combined with other plug-ins, added to financial KPIs, or sent to VSI chat.</p>
    </SectionCard> : null}
  </div>;
}
