import { EvidenceMappingLink } from "@/components/integrations/EvidenceMappingLink";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { DateRangeFields, SavedHistoryFilter } from "@/components/integrations/DateRangeFields";
import { resolveImportRange, resolveViewRange } from "@/lib/integrations/date-range";
import { admin, enabled } from "@/lib/integrations/loyverse/server";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ result?: string; error?: string; from?: string; to?: string }> };

export default async function LoyversePage({ searchParams }: PageProps) {
  const access = await requireWorkspacePage();
  const owner = access.context.membership?.role === "owner";
  const available = enabled();
  const params = await searchParams;
  const db = available ? admin() : null;
  const { data: connections, error: connectionError } = db
    ? await db.from("loyverse_connections").select("id,status,business_name,currency_code,last_sync_at,last_error_code,sync_lease_expires_at")
      .eq("workspace_id", access.workspaceId).neq("status", "disconnected").order("created_at", { ascending: false })
    : { data: [], error: null };
  const connection = connections?.[0];
  const defaults = resolveImportRange(null, null);
  let view = { startDate: null, endDate: null } as ReturnType<typeof resolveViewRange>;
  let invalidFilter = false;
  try { view = resolveViewRange(params?.from, params?.to); } catch { invalidFilter = true; }
  const { data: report, error: factsError } = db && connection && !invalidFilter
    ? await db.rpc("loyverse_saved_report", { p_workspace_id: access.workspaceId, p_connection_id: connection.id,
      p_start_date: view.startDate, p_end_date: view.endDate })
    : { data: null, error: null };
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: connection?.currency_code ?? "USD" }).format(n);
  const sales = Number(report?.sales ?? 0), refunds = Number(report?.refunds ?? 0);
  const coveredDays = Number(report?.covered_days ?? 0), requestedDays = Number(report?.requested_days ?? 0);
  const unknownDates = Number(report?.unknown_date_receipts ?? 0);
  const resultMessage = params?.result === "connected" ? "Loyverse connected. Choose a date range to import sales." :
    params?.result === "synced" ? "Selected sales history imported. Earlier imports are retained." :
    params?.result === "disconnected" ? "Loyverse disconnected and stored sales removed." :
    params?.result === "error" && params?.error === "merchant_mismatch"
      ? "This Loyverse merchant or its currency differs from the saved connection. Disconnect and remove saved sales before connecting it."
      : params?.result === "error" && params?.error === "invalid_date_range" ? "Choose a valid range of up to 366 days, ending today or earlier. Older periods are supported."
      : params?.result === "error" && params?.error === "range_too_large" ? "This period contains too many receipts for one import. Choose a smaller range. Saved history is unchanged."
      : params?.result === "error" && params?.error === "quota_exceeded" ? "Loyverse's request limit was reached. Wait before importing again. Saved history is unchanged."
      : params?.result === "error" ? "The Loyverse action could not be confirmed. Check saved history and the last import time before trying a smaller range or checking account access." : null;

  return <div className="workspace-page mx-auto max-w-5xl space-y-5">
    <PageHeader eyebrow="Plug-ins" title="Loyverse" description="Read only point of sale totals for your workspace."
      actions={<Link href="/app/integrations" aria-label="Back to plug-ins" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-white"><ArrowLeft aria-hidden="true" className="h-4 w-4" /></Link>} />
    {resultMessage ? <p role={params?.result === "error" ? "alert" : "status"} className="rounded-md border border-line p-3 text-sm">{resultMessage}</p> : null}
    {connection ? <EvidenceMappingLink workspaceId={access.workspaceId} provider={"loyverse"} connectionId={connection.id} owner={owner} status={connection.status}/> : null}
    <SectionCard title="Connection" description="For U.S. Loyverse merchants. Vaeroex requests merchant and receipt read permissions only.">
      {!available ? <p className="text-sm text-slate-600">Loyverse setup is not complete yet.</p> :
        connectionError ? <p role="alert" className="text-sm text-red-700">Connection status is unavailable.</p> :
        connection ? <div className="space-y-4">
          <div className="flex items-center gap-3"><StatusBadge value={connection.status === "connected" ? "Connected" : connection.status === "pending" ? "Waiting for authorization" : "Reauthorization required"} />
            <span className="text-sm text-slate-600">{connection.business_name ?? "Loyverse account"}</span></div>
          {connection.status === "pending" && owner ? <div className="space-y-3">
            <p className="text-sm text-slate-600">Finish authorization in Loyverse. If you closed that page, cancel this attempt and connect again.</p>
            <form method="post" action="/api/integrations/loyverse/disconnect">
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="confirmation" value="disconnect" />
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Cancel connection attempt</button>
            </form>
          </div> : null}
          {connection.last_error_code ? <p role="status" className="text-sm text-amber-800">The last import failed. Saved history is retained. Try a smaller range or reconnect if authorization has expired.</p> : null}
          {connection.status === "connected" && owner ? <div className="flex flex-wrap gap-3">
            <form method="post" action="/api/integrations/loyverse/sync" className="w-full space-y-3">
              <DateRangeFields idPrefix="loyverse-import" defaultStartDate={defaults.startDate} defaultEndDate={defaults.endDate} maxDate={defaults.endDate} />
              <p className="text-sm text-slate-600">Import up to 366 UTC calendar days at a time. You can choose older periods. Provider availability and request limits apply; busy periods may need smaller imports. No paid upgrade is started.</p>
              <input type="hidden" name="connectionId" value={connection.id} />
              <button type="submit" disabled={Boolean(connection.sync_lease_expires_at && Date.parse(connection.sync_lease_expires_at) > Date.now())}
                className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue disabled:opacity-50">Import selected dates</button>
            </form>
            <form method="post" action="/api/integrations/loyverse/disconnect">
              <input type="hidden" name="connectionId" value={connection.id} />
              <input type="hidden" name="confirmation" value="disconnect" />
              <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">Disconnect and remove sales</button>
            </form>
          </div> : null}
          {connection.status === "reauthorization_required" && owner ? <form method="post" action="/api/integrations/loyverse/connect">
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Reconnect Loyverse</button>
          </form> : null}
          {connection.status === "reauthorization_required" && owner ? <form method="post" action="/api/integrations/loyverse/disconnect">
            <input type="hidden" name="connectionId" value={connection.id} />
            <input type="hidden" name="confirmation" value="disconnect" />
            <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-red-700">Disconnect and remove sales</button>
          </form> : null}
          {connection.last_sync_at ? <p className="text-sm text-slate-600">Last sync: {new Date(connection.last_sync_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p> : null}
        </div> : owner ? <form method="post" action="/api/integrations/loyverse/connect">
          <button type="submit" className="min-h-11 rounded-md border border-line px-4 py-2 font-semibold text-vaeroex-blue">Connect Loyverse</button>
        </form> : <p className="text-sm text-slate-600">The workspace owner can connect Loyverse.</p>}
    </SectionCard>
    {connection && ["connected", "reauthorization_required"].includes(connection.status) ? <SectionCard title="Saved sales history" description="Totals by the date receipts were created on Loyverse's server, in UTC. This can differ from the receipt date used in Loyverse back-office reports.">
      <SavedHistoryFilter action="/app/integrations/loyverse" startDate={view.startDate} endDate={view.endDate} maxDate={defaults.endDate} />
      {invalidFilter ? <p role="alert" className="text-sm text-red-700">Choose a valid saved-history date range ending today or earlier.</p> :
        factsError ? <p role="alert" className="text-sm text-red-700">Sales data is unavailable.</p> :
        !coveredDays && (!unknownDates || view.startDate) ? <p className="text-sm text-slate-600">No completed import covers this period yet. Import it above to load available receipts; an unimported period does not mean zero sales. Older receipts with no saved server creation date are only shown in All saved history.</p> : <div className="space-y-4">
          {coveredDays ? <p className="text-sm text-slate-600">{coveredDays} of {requestedDays} days in this view have been imported. {Number(report?.complete_days ?? 0)} cover a full UTC day. Last covered time: {new Date(report.covered_through).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Coverage records completed provider reads, including days with no receipts.</p> : null}
          {coveredDays < requestedDays ? <p role="status" className="text-sm text-amber-800">This view has unimported dates. Totals include saved receipts only; import the missing periods before treating them as complete.</p> : null}
          {unknownDates ? <p role="status" className="text-sm text-amber-800">{unknownDates} receipts from earlier imports have no saved server creation date. All saved history includes them; date filters exclude them until they are re-imported. Their coverage is unverified.</p> : null}
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-sm text-slate-600">Net receipts</dt><dd className="text-2xl font-semibold text-ink">{money(sales - refunds)}</dd></div>
            <div><dt className="text-sm text-slate-600">Sales</dt><dd className="text-2xl font-semibold text-ink">{money(sales)}</dd></div>
            <div><dt className="text-sm text-slate-600">Refunds</dt><dd className="text-2xl font-semibold text-ink">{money(refunds)}</dd></div>
            <div><dt className="text-sm text-slate-600">Receipts</dt><dd className="text-2xl font-semibold text-ink">{Number(report?.receipts ?? 0)}</dd></div>
          </dl>
        </div>}
      <p className="mt-4 text-xs text-slate-600">Refunds reduce net sales; cancelled receipts are excluded. Totals include tax and tips where Loyverse includes them. Imports refresh only the selected period; saved history remains after logging out. Disconnecting removes it. This view does not store customer, employee, payment, note, or line item details.</p>
    </SectionCard> : null}
  </div>;
}
