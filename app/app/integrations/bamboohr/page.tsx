import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { admin, enabled } from "@/lib/integrations/bamboohr/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ result?: string }> };

export default async function BambooHRPage({ searchParams }: PageProps) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const params = await searchParams;
  const { data: connections, error } = available && owner
    ? await admin().from("bamboohr_connections")
      .select("id,status,company_domain,last_sync_at,last_error_code,sync_lease_expires_at,active_headcount,roster_readable,roster_total,approved_time_off_requests")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected")
      .order("created_at", { ascending: false }).limit(2)
    : { data: [], error: null };
  const connection = connections?.[0];
  const resultMessage = params?.result === "connected" ? "BambooHR connected. Sync to view staffing counts." :
    params?.result === "synced" ? "Staffing counts updated." :
    params?.result === "disconnected" ? "BambooHR disconnected and stored counts removed." :
    params?.result === "error" ? "The BambooHR action did not complete. Check your company domain and permissions, then try again." : null;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Integrations" title="BambooHR" description="Read-only staffing signals for your workspace."
      actions={<Link href="/app/integrations" aria-label="Back to integrations" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {resultMessage ? <p role={params?.result === "error" ? "alert" : "status"} className="rounded-md border border-line p-3 text-sm">{resultMessage}</p> : null}
    <SectionCard title="Connection" description="Vaeroex requests employee roster and time-off read access only. Only the workspace owner can manage this connection.">
      {!owner ? <p className="text-sm text-slate-600">The workspace owner can view and manage BambooHR staffing data.</p> :
        !available ? <p className="text-sm text-slate-600">BambooHR setup is not complete yet.</p> :
        error ? <p role="alert" className="text-sm text-red-700">Connection status is unavailable.</p> :
        connection ? <div className="space-y-4">
          <div className="flex items-center gap-3">
            <StatusBadge value={connection.status === "connected" ? "Connected" : connection.status === "pending" ? "Waiting for authorization" : "Reauthorization required"} />
            <span className="text-sm text-slate-600">{connection.company_domain}.bamboohr.com</span>
          </div>
          {connection.status === "pending" ? <p className="text-sm text-slate-600">Finish authorization in BambooHR, or cancel this attempt and connect again.</p> : null}
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last update failed. Try again or reconnect if authorization has expired.</p> : null}
          <div className="flex flex-wrap gap-3">
            {connection.status === "connected" ? <form method="post" action="/api/integrations/bamboohr/sync">
              <input type="hidden" name="connectionId" value={connection.id} />
              <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
                className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Update staffing counts</button>
            </form> : null}
            {connection.status === "reauthorization_required" ? <form method="post" action="/api/integrations/bamboohr/connect">
              <input type="hidden" name="companyDomain" value={connection.company_domain} />
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Reconnect BambooHR</button>
            </form> : null}
            <form method="post" action="/api/integrations/bamboohr/disconnect">
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="confirmation" value="disconnect" />
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">
                {connection.status === "pending" ? "Cancel connection attempt" : "Disconnect and remove counts"}
              </button>
            </form>
          </div>
          {connection.last_sync_at ? <p className="text-sm text-slate-600">Last update: {new Date(connection.last_sync_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p> : null}
        </div> : <form method="post" action="/api/integrations/bamboohr/connect" className="flex flex-wrap items-end gap-3">
          <label className="block text-sm font-medium text-ink">BambooHR company domain
            <span className="mt-1 flex items-center gap-2"><input name="companyDomain" required maxLength={63} pattern="[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
              placeholder="yourcompany" autoComplete="off" className="h-11 rounded-md border border-line px-3" />
              <span className="text-slate-600">.bamboohr.com</span></span>
          </label>
          <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Connect BambooHR</button>
        </form>}
    </SectionCard>
    {owner && connection?.status === "connected" ? <SectionCard title="Staffing snapshot" description="Counts visible to the BambooHR account that authorized this connection.">
      {!connection.last_sync_at ? <p className="text-sm text-slate-600">Update staffing counts to see a snapshot.</p> :
        <div className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-slate-600">Active employees</dt><dd className="text-2xl font-semibold text-ink">{connection.active_headcount ?? "Incomplete"}</dd></div>
            <div><dt className="text-sm text-slate-600">Approved time-off requests visible in the next 14 days</dt><dd className="text-2xl font-semibold text-ink">{connection.approved_time_off_requests ?? "—"}</dd></div>
          </dl>
          {connection.active_headcount === null ? <p className="text-sm text-amber-800">BambooHR allowed access to {connection.roster_readable ?? 0} of {connection.roster_total ?? 0} employee statuses. Vaeroex will not present a partial roster as company headcount.</p> : null}
          <p className="text-xs text-slate-600">Time-off requests may be incomplete if the authorizing account cannot view every employee. Vaeroex stores only these counts; it does not store employee names, notes, or leave reasons.</p>
        </div>}
    </SectionCard> : null}
  </div>;
}
